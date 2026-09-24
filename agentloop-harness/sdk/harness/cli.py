"""命令行入口：harness login / record / report / case / replay / analyze / submit。"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys
import time

from .client import CONFIG_PATH, HarnessClient, HarnessError, load_config, save_config
from .recorder import Harness, ensure_token, record_process


def _client(args) -> HarnessClient:
    cfg = load_config()
    endpoint = getattr(args, "endpoint", "") or cfg.get("endpoint") or "http://127.0.0.1:8848"
    token = getattr(args, "token", "") or cfg.get("token") or ""
    return HarnessClient(endpoint=endpoint, token=token)


def _print(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- 命令实现

def cmd_login(args) -> int:
    cfg = load_config()
    endpoint = (args.endpoint or cfg.get("endpoint") or "http://127.0.0.1:8848").rstrip("/")
    token = args.token or cfg.get("token") or ""
    client = HarnessClient(endpoint=endpoint, token=token)
    try:
        me = client.whoami()
    except HarnessError as exc:
        print(f"连接失败：{exc}", file=sys.stderr)
        return 1
    save_config({"endpoint": endpoint, "token": token})
    print(f"已连接 {endpoint} · 用户 {me.get('username')} · 配置写入 {CONFIG_PATH}")
    return 0


def cmd_status(args) -> int:
    client = _client(args)
    try:
        _print({"health": client.health(), "stats": client.stats()})
    except HarnessError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


def cmd_record(args) -> int:
    if not args.command:
        print("用法：harness record [--task 描述] -- <命令>", file=sys.stderr)
        return 2
    return record_process(args.command, task=args.task or "", agent=args.agent)


def cmd_report(args) -> int:
    client = _client(args)
    if args.file:
        with open(args.file, encoding="utf-8") as f:
            bundle = json.load(f)
        _print(client.report_run(bundle))
        return 0
    if not args.run_id:
        print("需要 --file bundle.json 或 --run-id", file=sys.stderr)
        return 2
    print(f"run_id={args.run_id} 已在平台侧，无需重复上报（用 case create 沉淀案例）")
    return 0


def cmd_snapshot(args) -> int:
    """把本地目录里的 trace/metrics/logs 快照文件（jsonl/json）打包上报。"""
    client = _client(args)
    files = []
    for pattern in (args.glob or []):
        files.extend(glob.glob(os.path.join(args.dir or ".", pattern), recursive=True))
    if not files:
        print(f"目录 {args.dir} 下没有匹配 {args.glob} 的文件", file=sys.stderr)
        return 1
    signals = []
    for path in files:
        modality = os.path.basename(path).split(".")[0]
        modality = {"metrics": "metric", "logs": "log", "traces": "trace", "events": "event",
                    "alerts": "alert", "topology": "topology"}.get(modality, modality)
        with open(path, encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f):
                line = line.strip().rstrip(",")
                if not line or line in "[]":
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    obj = {"text": line}
                if not isinstance(obj, dict):
                    obj = {"text": json.dumps(obj, ensure_ascii=False)}
                signals.append({
                    "modality": modality,
                    "entity_key": obj.get("entity") or obj.get("entity_key") or "",
                    "entity_type": obj.get("entity_type", ""),
                    "name": obj.get("name") or obj.get("metric") or os.path.basename(path),
                    "ts_ms": obj.get("ts_ms") or obj.get("timestamp") or int(time.time() * 1000),
                    "value": obj.get("value"),
                    "text": obj.get("text") or obj.get("message") or obj.get("log") or "",
                    "severity": obj.get("severity", "info"),
                    "payload": obj,
                })
    bundle = {
        "run": {
            "external_run_id": args.run_id or f"snapshot-{int(time.time())}",
            "agent": args.agent, "task": args.task or f"离线快照导入（{len(files)} 个文件）",
            "status": args.status, "env": args.env, "agent_version": args.version,
            "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "ended_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "error_type": args.error_type or "", "error_message": args.error_message or "",
        },
        "signals": signals,
        "spans": [],
        "snapshot": {"collector": "harness-cli/snapshot", "files": files, "modalities": sorted({s["modality"] for s in signals})},
    }
    result = client.report_run(bundle)
    _print(result)
    return 0


def cmd_case(args) -> int:
    client = _client(args)
    if args.action == "create":
        if not args.run_id:
            print("需要 --run-id", file=sys.stderr)
            return 2
        payload = {"source_run_id": int(args.run_id)}
        if args.status:
            payload["status"] = args.status
        if args.title:
            payload["title"] = args.title
        c = client.create_case(**payload)
        _print(c)
        return 0
    if args.action == "list":
        _print(client.list_cases(status=args.status or ""))
        return 0
    if args.action == "show":
        if not args.case_id:
            print("需要 --case-id", file=sys.stderr)
            return 2
        _print(client.get_case(args.case_id))
        return 0
    if args.action == "promote":
        if not args.case_id:
            print("需要 --case-id", file=sys.stderr)
            return 2
        client._call(f"/cases/{args.case_id}/status", "POST", {"status": args.status or "golden"})
        print(f"case {args.case_id} → {args.status or 'golden'}")
        return 0
    print("未知动作", file=sys.stderr)
    return 2


def cmd_replay(args) -> int:
    client = _client(args)
    if args.suite:
        _print(client.replay_suite(status=args.suite, mode=args.mode))
        return 0
    if not args.case_id:
        print("需要 --case-id 或 --suite", file=sys.stderr)
        return 2
    _print(client.replay(int(args.case_id), mode=args.mode, agent_version=args.version or "cli"))
    return 0


def cmd_analyze(args) -> int:
    client = _client(args)
    result = client.analyze()
    _print(result)
    if args.verbose:
        _print(client.optimizations(status="draft"))
    return 0


def cmd_submit(args) -> int:
    client = _client(args)
    if not args.id:
        print("需要 --id <优化建议ID>", file=sys.stderr)
        return 2
    _print(client.submit_optimization(int(args.id)))
    return 0


def cmd_demo(args) -> int:
    """跑一个演示故障场景，把快照上报，用于打通链路。"""
    harness = Harness(agent=args.agent)
    ensure_token(harness.client.token)
    with harness.run(task="下单接口 P99 从 420ms 涨到 3.8s，前端 5xx 上升", agent=args.agent,
                     auto_case=True) as rec:
        rec.alert("entry-api p99 > 3s (5m)", entity="frontend")
        rec.metric("frontend", "error_rate", 5.6, severity="warn")
        rec.metric("checkout-service", "p99", 3800, severity="critical")
        rec.log("checkout-db", "slow query detected: SELECT * FROM orders WHERE status=? took 2841ms", severity="error")
        rec.trace("gateway-5xx-ratio-up")
        rec.trace("checkout-latency-up")
        rec.trace("db-query-time-up")
        rec.trace("slow-sql-found")
        rec.event("K8s: no restarts observed, rule out pod lifecycle", entity="checkout-service")
        rec.topology("checkout-db -> ack-node-02 -> checkout-service -> frontend")
        with rec.span("query-metrics", kind="tool", entity="checkout-db"):
            time.sleep(0.2)
        with rec.span("query-logs", kind="tool", entity="checkout-db"):
            time.sleep(0.2)
        rec.usage(tokens_in=12000, tokens_out=5200, cost_usd=0.031)
        rec.answer(
            fault_type="slowSQL", entity="prod-checkout-db:3306",
            causal_chain=["gateway-5xx-ratio-up", "checkout-latency-up", "db-query-time-up", "slow-sql-found"],
            evidence=[{"name": "checkout-db 慢查询语句", "value": "SELECT ... FROM orders"}],
        )
    _print(rec.result or {})
    return 0


# ---------------------------------------------------------------- 参数解析

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="harness", description="AgentLoop Harness 本地上报与回放 SDK")
    p.add_argument("--endpoint", default="", help="平台地址，默认 http://127.0.0.1:8848")
    p.add_argument("--token", default="", help="API Token（也可用环境变量 HARNESS_TOKEN）")
    # 让 --endpoint / --token 放在子命令后面也能被识别（harness login --token xxx）
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--endpoint", default="", help="平台地址")
    common.add_argument("--token", default="", help="API Token")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("login", help="保存平台地址与 Token", parents=[common])
    s.set_defaults(func=cmd_login)

    s = sub.add_parser("status", help="查看连通性与平台统计", parents=[common])
    s.set_defaults(func=cmd_status)

    s = sub.add_parser("record", help="包裹式录制一个子进程", parents=[common])
    s.add_argument("--task", default="")
    s.add_argument("--agent", default="ops-agent")
    s.add_argument("command", nargs=argparse.REMAINDER)
    s.set_defaults(func=cmd_record)

    s = sub.add_parser("report", help="上报一个快照 bundle.json", parents=[common])
    s.add_argument("--file", default="")
    s.add_argument("--run-id", default="")
    s.set_defaults(func=cmd_report)

    s = sub.add_parser("snapshot", help="把本地 trace/metrics/logs 快照目录打包上报", parents=[common])
    s.add_argument("--dir", default=".")
    s.add_argument("--glob", action="append", default=["*.jsonl", "*.json"])
    s.add_argument("--run-id", default="")
    s.add_argument("--task", default="")
    s.add_argument("--agent", default="ops-agent")
    s.add_argument("--status", default="failed")
    s.add_argument("--env", default="prod")
    s.add_argument("--version", default="v0.0.1")
    s.add_argument("--error-type", dest="error_type", default="")
    s.add_argument("--error-message", dest="error_message", default="")
    s.set_defaults(func=cmd_snapshot)

    s = sub.add_parser("case", help="案例操作", parents=[common])
    s.add_argument("action", choices=["create", "list", "show", "promote"])
    s.add_argument("--run-id", default="")
    s.add_argument("--case-id", type=int, default=0)
    s.add_argument("--status", default="")
    s.add_argument("--title", default="")
    s.set_defaults(func=cmd_case)

    s = sub.add_parser("replay", help="回放案例或案例集", parents=[common])
    s.add_argument("--case-id", default="")
    s.add_argument("--suite", default="", help="按状态批量回放：golden / badcase")
    s.add_argument("--mode", default="offline", choices=["offline", "live", "snapshot"])
    s.add_argument("--version", default="")
    s.set_defaults(func=cmd_replay)

    s = sub.add_parser("analyze", help="跑 BadCase 分析，生成 skill/prompt 优化建议", parents=[common])
    s.add_argument("--verbose", action="store_true")
    s.set_defaults(func=cmd_analyze)

    s = sub.add_parser("submit", help="把确认后的建议提交到 GitHub（新分支 + PR）", parents=[common])
    s.add_argument("--id", default="")
    s.set_defaults(func=cmd_submit)

    s = sub.add_parser("demo", help="跑一个演示故障场景并上报", parents=[common])
    s.add_argument("--agent", default="ops-agent")
    s.set_defaults(func=cmd_demo)
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except HarnessError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
