"""HTTP 客户端：只依赖标准库 urllib。"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

CONFIG_PATH = os.path.expanduser("~/.agentloop-harness.json")


class HarnessError(RuntimeError):
    pass


def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}
    return {}


def save_config(data: dict) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


class HarnessClient:
    def __init__(self, endpoint: str = "", token: str = "", timeout: float = 30.0):
        cfg = load_config()
        self.endpoint = (endpoint or os.environ.get("HARNESS_ENDPOINT") or cfg.get("endpoint") or "http://127.0.0.1:8848").rstrip("/")
        self.token = token or os.environ.get("HARNESS_TOKEN") or cfg.get("token") or ""
        self.timeout = timeout

    # ------------------------------------------------------------ 底层请求

    def _call(self, path: str, method: str = "GET", body: dict | None = None) -> dict:
        url = f"{self.endpoint}/api/v1{path}"
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("X-Api-Token", self.token)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise HarnessError(f"{method} {path} → HTTP {exc.code}: {detail[:300]}") from exc
        except urllib.error.URLError as exc:
            raise HarnessError(f"无法连接 {self.endpoint}：{exc.reason}") from exc
        return json.loads(raw) if raw else {}

    # ------------------------------------------------------------ 业务接口

    def health(self) -> dict:
        return self._call("/health")

    def me(self) -> dict:
        return self._call("/auth/me")

    def whoami(self) -> dict:
        url = f"{self.endpoint}/api/v1/auth/me"
        req = urllib.request.Request(url)
        req.add_header("X-Api-Token", self.token)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            raise HarnessError(f"Token 校验失败：HTTP {exc.code}") from exc

    def report_run(self, bundle: dict) -> dict:
        return self._call("/ingest/run", "POST", bundle)

    def report_batch(self, runs: list[dict]) -> dict:
        return self._call("/ingest/batch", "POST", {"runs": runs})

    def create_case(self, source_run_id: int, **kwargs) -> dict:
        return self._call("/cases", "POST", {"source_run_id": source_run_id, **kwargs})

    def list_cases(self, status: str = "") -> dict:
        return self._call(f"/cases?status={status}")

    def get_case(self, case_id: int) -> dict:
        return self._call(f"/cases/{case_id}")

    def update_case(self, case_id: int, **kwargs) -> dict:
        return self._call(f"/cases/{case_id}", "PUT", kwargs)

    def replay(self, case_id: int, mode: str = "offline", **kwargs) -> dict:
        return self._call(f"/replay/case/{case_id}", "POST", {"mode": mode, **kwargs})

    def replay_suite(self, status: str = "golden", mode: str = "offline", case_ids: list[int] | None = None) -> dict:
        return self._call("/replay/suite", "POST", {"status": status, "mode": mode, "case_ids": case_ids or []})

    def analyze(self) -> dict:
        return self._call("/optimize/analyze", "POST", {})

    def optimizations(self, status: str = "") -> list:
        return self._call(f"/optimizations?status={status}")

    def submit_optimization(self, opt_id: int, **kwargs) -> dict:
        return self._call(f"/optimizations/{opt_id}/submit", "POST", kwargs)

    def stats(self) -> dict:
        return self._call("/stats/overview")
