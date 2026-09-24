"""运行期记录器：把本地 Agent 的执行过程录成可回放的快照。"""
from __future__ import annotations

import getpass
import os
import platform
import socket
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

from .client import HarnessClient, HarnessError

SNAPSHOT_COLLECTOR = "harness-sdk"


class RunRecorder:
    """一次 Agent 执行的记录器。退出上下文时自动上报快照。"""

    def __init__(self, harness: "Harness", task: str, external_run_id: str = "",
                 agent: str = "", agent_version: str = "", env: str = "",
                 model: str = "", session_id: str = "", meta: dict | None = None,
                 report: bool = True, auto_case: bool = False,
                 answer: dict | None = None):
        self.harness = harness
        self.run: dict[str, Any] = {
            "external_run_id": external_run_id or f"{agent or harness.agent}-{int(time.time())}-{uuid.uuid4().hex[:6]}",
            "agent": agent or harness.agent,
            "session_id": session_id or f"session-{uuid.uuid4().hex[:8]}",
            "task": task,
            "status": "success",
            "env": env or harness.env,
            "model": model or harness.model,
            "agent_version": agent_version or harness.agent_version,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "ended_at": "",
            "duration_ms": 0,
            "tokens_in": 0,
            "tokens_out": 0,
            "cost_usd": 0.0,
            "tool_calls": 0,
            "steps": 0,
            "error_type": "",
            "error_message": "",
            "meta": {
                "host": socket.gethostname(),
                "user": getpass.getuser(),
                "python": platform.python_version(),
                "platform": platform.platform(),
                **(meta or {}),
            },
        }
        self.signals: list[dict] = []
        self.spans: list[dict] = []
        self.answer_payload: dict = answer or {}
        self._report = report
        self._auto_case = auto_case
        self._t0 = time.time() * 1000
        self.result: dict | None = None
        self._span_seq = 0

    # -------------------------------------------------------- 记录原语

    def _add(self, modality: str, name: str, *, entity: str = "", entity_type: str = "",
             value: float | None = None, text: str = "", severity: str = "info",
             ts_ms: int | None = None, payload: dict | None = None) -> None:
        self.signals.append({
            "modality": modality, "entity_key": entity, "entity_type": entity_type,
            "name": name, "ts_ms": ts_ms or int(time.time() * 1000),
            "value": value, "text": text, "severity": severity, "payload": payload or {},
        })

    def metric(self, entity: str, name: str, value: float, severity: str = "info", entity_type: str = "") -> None:
        self._add("metric", name, entity=entity, entity_type=entity_type, value=value, severity=severity)

    def log(self, entity: str, text: str, severity: str = "info", name: str = "agent_log") -> None:
        self._add("log", name, entity=entity, text=text, severity=severity)

    def trace(self, step: str, entity: str = "", severity: str = "info", text: str = "") -> None:
        self._add("trace", step, entity=entity, severity=severity, text=text)

    def event(self, text: str, entity: str = "", severity: str = "info", name: str = "k8s_event") -> None:
        self._add("event", name, entity=entity, text=text, severity=severity)

    def alert(self, text: str, entity: str = "", severity: str = "critical", name: str = "entry_alert") -> None:
        self._add("alert", name, entity=entity, text=text, severity=severity)

    def topology(self, text: str, entity: str = "") -> None:
        self._add("topology", "entity_relation", entity=entity, text=text)

    def usage(self, tokens_in: int = 0, tokens_out: int = 0, cost_usd: float = 0.0) -> None:
        self.run["tokens_in"] += int(tokens_in)
        self.run["tokens_out"] += int(tokens_out)
        self.run["cost_usd"] = round(self.run["cost_usd"] + float(cost_usd), 6)

    def answer(self, fault_type: str = "", entity: str = "", causal_chain: list[str] | None = None,
               evidence: list[dict] | None = None, **extra) -> None:
        """记录 Agent 最终作答，离线回放时直接使用。"""
        self.answer_payload = {
            "fault_type": fault_type, "entity": entity,
            "causal_chain": causal_chain or [], "evidence": evidence or [], **extra,
        }

    def fail(self, error_type: str, message: str = "") -> None:
        self.run["status"] = "failed"
        self.run["error_type"] = error_type
        self.run["error_message"] = message

    def partial(self, error_type: str = "", message: str = "") -> None:
        self.run["status"] = "partial"
        self.run["error_type"] = error_type or self.run["error_type"]
        self.run["error_message"] = message or self.run["error_message"]

    @contextmanager
    def span(self, name: str, kind: str = "step", entity: str = "", **attributes: Any) -> Iterator[dict]:
        """记录一段工具/模型/步骤的执行耗时。"""
        self._span_seq += 1
        sid = f"s{self._span_seq}"
        start = int(time.time() * 1000)
        holder: dict[str, Any] = {"status": "ok", "attributes": attributes}
        try:
            yield holder
        except Exception as exc:  # noqa: BLE001
            holder["status"] = "error"
            holder.setdefault("attributes", {})["error"] = str(exc)
            raise
        finally:
            end = int(time.time() * 1000)
            self.spans.append({
                "span_id": sid, "parent_span_id": "", "name": name, "kind": kind,
                "status": holder["status"], "start_ms": start, "end_ms": end,
                "duration_ms": end - start,
                "attributes": {"entity": entity, **holder.get("attributes", {})},
            })
            self.run["steps"] += 1
            if kind == "tool":
                self.run["tool_calls"] += 1

    def tool_call(self, name: str, entity: str = "", ok: bool = True, **attributes: Any) -> None:
        self.run["tool_calls"] += 1
        now = int(time.time() * 1000)
        self.spans.append({
            "span_id": f"s{self._span_seq + 1}", "parent_span_id": "", "name": name,
            "kind": "tool", "status": "ok" if ok else "error",
            "start_ms": now, "end_ms": now, "duration_ms": 0,
            "attributes": {"entity": entity, **attributes},
        })
        self._span_seq += 1

    # -------------------------------------------------------- 上报

    def bundle(self) -> dict:
        self.run["ended_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        self.run["duration_ms"] = int(time.time() * 1000 - self._t0)
        modalities = sorted({s["modality"] for s in self.signals})
        return {
            "run": self.run,
            "spans": self.spans,
            "signals": self.signals,
            "snapshot": {
                "collector": SNAPSHOT_COLLECTOR,
                "sdk_version": "1.0.0",
                "modalities": modalities,
                "window_minutes": max(1, self.run["duration_ms"] // 60000),
                "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "answer": self.answer_payload,
            },
        }

    def flush(self) -> dict:
        payload = self.bundle()
        if not self._report:
            self.result = payload
            return payload
        result = self.harness.client.report_run(payload)
        self.result = result
        if self._auto_case and self.answer_payload:
            case = self.harness.client.create_case(result["run_id"])
            result["case"] = case
        return result

    def __enter__(self) -> "RunRecorder":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if exc_type is not None:
            self.fail(exc_type.__name__, str(exc))
        self.flush()
        return False


class Harness:
    """上报入口。

    h = Harness(token="hnx_...")
    with h.run(task="下单接口 P99 飙升", agent="ops-agent") as rec:
        rec.metric("checkout-db", "p99", 3800, severity="critical")
        rec.log("checkout-db", "slow query ...", severity="error")
        with rec.span("query-metrics", kind="tool"):
            ...
        rec.answer(fault_type="slowSQL", entity="checkout-db", causal_chain=["..."], evidence=[...])
    """

    def __init__(self, endpoint: str = "", token: str = "", agent: str = "ops-agent",
                 agent_version: str = "", env: str = "prod", model: str = ""):
        self.client = HarnessClient(endpoint=endpoint, token=token)
        self.agent = agent or os.environ.get("HARNESS_AGENT") or "ops-agent"
        self.agent_version = agent_version or os.environ.get("HARNESS_AGENT_VERSION") or "v0.0.1"
        self.env = env
        self.model = model

    def run(self, task: str, **kwargs) -> RunRecorder:
        kwargs.setdefault("agent", self.agent)
        kwargs.setdefault("agent_version", self.agent_version)
        kwargs.setdefault("env", self.env)
        kwargs.setdefault("model", self.model)
        return RunRecorder(self, task, **kwargs)

    # 便捷代理
    def create_case(self, run_id: int, **kwargs) -> dict:
        return self.client.create_case(run_id, **kwargs)

    def replay(self, case_id: int, mode: str = "offline", **kwargs) -> dict:
        return self.client.replay(case_id, mode=mode, **kwargs)

    def analyze(self) -> dict:
        return self.client.analyze()

    def stats(self) -> dict:
        return self.client.stats()


def record_process(argv: list[str], task: str = "", agent: str = "ops-agent") -> int:
    """包裹式录制：跑一个子进程，把输出与耗时报成一组信号。"""
    import subprocess

    harness = Harness(agent=agent)
    with harness.run(task=task or " ".join(argv), agent=agent) as rec:
        proc = subprocess.run(argv, capture_output=True, text=True)
        for line in (proc.stdout or "").splitlines():
            if line.strip():
                rec.log("process", line.strip()[:500], name="stdout")
        for line in (proc.stderr or "").splitlines():
            if line.strip():
                rec.log("process", line.strip()[:500], severity="warn", name="stderr")
        rec.metric("process", "exit_code", proc.returncode, severity="info" if proc.returncode == 0 else "error")
        if proc.returncode != 0:
            rec.fail("ProcessExitNonZero", (proc.stderr or "")[-500:])
    if rec.result:
        print(f"已上报 run_id={rec.result.get('run_id')} signals={rec.result.get('signals')}")
    return proc.returncode


def ensure_token(token: str) -> str:
    if not token:
        raise HarnessError("缺少 API Token：请执行 harness login --endpoint ... --token ...，或设置 HARNESS_TOKEN")
    return token
