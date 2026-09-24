#!/usr/bin/env python3
"""示例：一个可被 Harness「live 回放」调用的本地 Agent 服务。

Harness 的 live 回放会把案例的可观测数据摘要 POST 到这里，
本服务返回结构化诊断结论（prediction），Harness 再用确定性打分器给分。

启动：
    python3 examples/local_agent.py --port 8899

在网页「设置 → 被测 Agent 地址」里填 http://127.0.0.1:8899/diagnose ，
然后在案例详情页点「回放（live）」即可。

本示例刻意做得「有点笨」：只看 p99 和连接数两个指标，且把慢 SQL
误判成连接池耗尽，用来演示 BadCase 是怎么被自动识别出来的。
"""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def diagnose(payload: dict) -> dict:
    """一个极其朴素（但可复现）的规则式诊断器。"""
    obs = payload.get("observability") or {}
    metrics = obs.get("metric") or []

    def peak(name: str) -> float:
        vals = [float(m.get("value") or 0) for m in metrics
                if name.lower() in str(m.get("name", "")).lower()]
        return max(vals) if vals else 0.0

    p99 = peak("p99")
    conn = peak("conn")
    restarts = peak("restart")
    entity = (metrics[0].get("entity") if metrics else "") or (payload.get("topology") or [""])[0]

    # —— 这里故意留了一个错误分支：慢 SQL 被当成连接池耗尽 ——
    if restarts >= 1:
        return {"fault_type": "podCrashLoop", "entity": entity,
                "causal_chain": ["pod restart", "readiness probe failed", "pod crash loop"],
                "evidence": [{"name": "restart 次数", "value": f"{restarts:.0f}"}]}
    if conn >= 80:
        return {"fault_type": "connectionPoolExhausted", "entity": entity,
                "causal_chain": ["连接数打满", "请求排队", "响应变慢"],
                "evidence": [{"name": "连接数", "value": f"{conn:.0f}"}]}
    if p99 >= 1000:
        # 慢 SQL 场景会走到这里，但故障类型判断是错的（应为 slowSQL）
        return {"fault_type": "connectionPoolExhausted", "entity": entity,
                "causal_chain": ["p99 升高", "数据库响应变慢"],
                "evidence": [{"name": "p99 延迟", "value": f"{p99:.0f}ms"}]}
    return {"fault_type": "unknown", "entity": entity, "causal_chain": [], "evidence": []}


class Handler(BaseHTTPRequestHandler):
    server_version = "LocalAgent/0.1"

    def _json(self, code: int, body: dict) -> None:
        raw = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            self._json(200, {"ok": True, "agent": "local-demo-agent"})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length).decode() if length else "{}"
        try:
            payload = json.loads(raw or "{}")
        except ValueError:
            self._json(400, {"error": "invalid json"})
            return
        prediction = diagnose(payload)
        print(f"[local-agent] task={payload.get('task')!r} → "
              f"{prediction['fault_type']} @ {prediction['entity']}", flush=True)
        self._json(200, {"prediction": prediction})

    def log_message(self, fmt: str, *args) -> None:
        pass  # 静音默认访问日志


def main() -> None:
    ap = argparse.ArgumentParser(description="示例：本地被测 Agent 服务")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8899)
    args = ap.parse_args()

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"本地示例 Agent 已启动：http://{args.host}:{args.port}/diagnose")
    print("把它填到 Harness「设置 → 被测 Agent 地址」即可做 live 回放。Ctrl+C 退出。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
