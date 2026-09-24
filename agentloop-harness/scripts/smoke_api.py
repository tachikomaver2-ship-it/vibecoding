#!/usr/bin/env python3
"""端到端 API 冒烟测试（需先启动服务）。

    python -m uvicorn app.api:app --port 8848   # 在 backend/ 目录
    python scripts/smoke_api.py

平台地址可用 HARNESS_ENDPOINT 覆盖（默认 http://127.0.0.1:8848），
便于在端口被占用时换个端口跑。
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

_ENDPOINT = (os.environ.get("HARNESS_ENDPOINT") or "http://127.0.0.1:8848").rstrip("/")
BASE = _ENDPOINT + "/api/v1"
TOKEN = ""
# 绕过环境里的 HTTP 代理，确保本机回环地址直连
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(path: str, method: str = "GET", body: dict | None = None, expect_error: bool = False):
    """调用接口。

    expect_error=True 时把 4xx/5xx 的响应体当作返回值，用于断言「非法输入会被拒绝」，
    此时若真的成功返回会抛 AssertionError——否则这类测试会因为写错而静默通过。
    """
    url = BASE + path
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    try:
        with _OPENER.open(req, timeout=60) as resp:
            raw = resp.read().decode()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:300]
        if expect_error:
            return {"_status": exc.code, "_detail": detail}
        raise AssertionError(f"{method} {path} → HTTP {exc.code}: {detail}") from exc
    if expect_error:
        raise AssertionError(f"{method} {path} 预期失败但返回了成功：{raw[:200]}")
    return json.loads(raw) if raw else None


PASS, FAIL = [], []


def check(name: str, cond: bool, extra: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(("  ✓ " if cond else "  ✗ ") + name + (f" — {extra}" if extra and not cond else ""))


def main() -> int:
    global TOKEN
    print("== 1. 健康检查与演示数据")
    check("健康接口可用", call("/health")["ok"])
    seeded = call("/demo/seed", "POST", {})
    check("演示数据生成", seeded["cases_total"] >= 10, str(seeded))

    print("== 2. 登录鉴权")
    session = call("/auth/login", "POST", {"username": "admin", "password": "admin123"})
    TOKEN = session["token"]
    check("登录成功并拿到会话 token", bool(TOKEN))
    check("鉴权接口返回当前用户", call("/auth/me")["username"] == "admin")
    try:
        call("/runs")
    except AssertionError:
        pass

    print("== 3. 上报链路（SDK 视角）")
    bundle = {
        "run": {
            "external_run_id": "smoke-run-001", "agent": "ops-agent",
            "task": "冒烟：下单接口延迟升高", "status": "failed", "env": "prod",
            "error_type": "慢查询", "duration_ms": 42000, "tokens_in": 9000, "tokens_out": 3100,
            "tool_calls": 7, "steps": 4,
        },
        "signals": [
            {"modality": "metric", "entity_key": "prod-checkout-db:3306", "name": "p99", "value": 3800, "severity": "critical", "ts_ms": 1},
            {"modality": "metric", "entity_key": "checkout-service", "name": "error_rate", "value": 5.2, "severity": "warn", "ts_ms": 2},
            {"modality": "log", "entity_key": "checkout-db", "name": "slow_query", "text": "SELECT * FROM orders took 2841ms", "severity": "error", "ts_ms": 3},
            {"modality": "trace", "entity_key": "checkout-service", "name": "db-query-time-up", "text": "span slow", "severity": "warn", "ts_ms": 4},
            {"modality": "event", "entity_key": "checkout-service", "name": "k8s_event", "text": "no restart", "severity": "info", "ts_ms": 5},
            {"modality": "alert", "entity_key": "frontend", "name": "entry_alert", "text": "p99 > 3s", "severity": "critical", "ts_ms": 6},
        ],
        "spans": [
            {"span_id": "s0", "name": "diagnose", "kind": "agent", "status": "ok", "start_ms": 0, "end_ms": 40000},
            {"span_id": "s1", "parent_span_id": "s0", "name": "query-metrics", "kind": "tool", "status": "ok", "start_ms": 1000, "end_ms": 6000},
        ],
        "snapshot": {"collector": "smoke-test", "modalities": ["metric", "log", "trace", "event", "alert"]},
    }
    r = call("/ingest/run", "POST", bundle)
    check("快照上报成功", r["run_id"] > 0 and r["signals"] == 6, str(r))
    run_id = r["run_id"]
    detail = call(f"/runs/{run_id}")
    check("运行详情含 span 与信号", len(detail["spans"]) == 2 and len(detail["signals"]) == 6)
    check("跨域实体名被归一化", any(s["entity_key"] == "checkout-db" for s in detail["signals"]))

    print("== 4. 案例沉淀与四层真值")
    case = call("/cases", "POST", {"source_run_id": run_id})
    cid = case["id"]
    check("从运行沉淀案例", case["case_key"] and cid > 0)
    check("自动抽取四层真值初稿", bool(case["quality"]))
    check("故障类型被归一化到规范词表", call(f"/cases/{cid}")["fault_type"] == "slowSQL",
          call(f"/cases/{cid}")["fault_type"])

    updated = call(f"/cases/{cid}", "PUT", {
        "title": "冒烟案例：下单 P99 飙升",
        "fault_type": "slowSQL",
        "root_cause_entity": "prod-checkout-db:3306",
        "causal_chain": ["gateway-5xx-ratio-up", "checkout-latency-up", "db-query-time-up", "slow-sql-found"],
        "evidence": [
            {"name": "checkout-db 慢查询", "entity": "checkout-db", "metric": "slow_query", "keywords": ["select"]},
            {"name": "checkout-service P99", "entity": "checkout-service", "metric": "p99", "keywords": ["p99"]},
        ],
        "difficulty": "L2", "status": "draft", "tags": ["smoke", "middleware-db"],
    })
    check("标注保存成功", updated["fault_type"] == "slowSQL" and len(updated["causal_chain"]) == 4)
    check("实体归一化为主键", updated["entity_key"] == "checkout-db", updated["entity_key"])
    check("GSTO 门禁四层检查齐全", len(updated["quality"]["checks"]) == 4)

    print("== 5. 回放与评分")
    replay = call(f"/replay/case/{cid}", "POST", {"mode": "offline"})
    if replay.get("error"):
        print("    （该案例无录制作答，符合预期）")
        check("无录制作答时给出明确提示", "未记录 Agent 作答" in replay["error"])
    else:
        check("回放产出三维分数", all(k in replay for k in ("score_fault", "score_entity", "score_process")))
    suite = call("/replay/suite", "POST", {"status": "golden", "mode": "offline"})
    check("黄金案例集批量回放", suite["total"] >= 1 and 0 <= suite["pass_rate"] <= 1, str(suite["total"]))
    dims = call("/stats/dimensions")
    check("维度统计可用于雷达图", len(dims["items"]) >= 1)

    print("== 6. 统计与可视化数据")
    ov = call("/stats/overview")
    check("总览指标齐备", all(k in ov for k in ("runs", "cases", "avg_score", "optimizations_pending")))
    check("趋势数据按天聚合", len(call("/stats/trend?days=14")["items"]) >= 1)
    faults = call("/stats/faults")
    check("故障组分布可用于饼图", len(faults["by_group"]) >= 1)
    check("实体拓扑可用于关系图", len(call("/entities/topology")["links"]) >= 1)
    check("故障分类树可用", len(call("/taxonomy")["groups"]) == 6)

    print("== 7. BadCase 分析与优化建议")
    analysis = call("/optimize/analyze", "POST", {})
    check("失分簇聚类", len(analysis["clusters"]) >= 1, str(analysis))
    check("分析返回建库计数与新建建议",
          {"badcase_count", "suggested", "created", "suggestions"} <= set(analysis),
          str(sorted(analysis)))
    check("新建建议与建库计数一致",
          len(analysis["suggestions"]) == analysis["created"],
          f"created={analysis['created']} suggestions={len(analysis['suggestions'])}")
    opts = call("/optimizations")
    check("产出优化建议", len(opts) >= 2, str(len(opts)))
    check("建议带 diff 与关联案例", all("patch" in o for o in opts))
    check("建议展开关联案例摘要", all("cases" in o for o in opts))
    # 幂等：再跑一次分析不应重复堆建议
    again = call("/optimize/analyze", "POST", {})
    check("重复分析幂等（不新增建议）", again["created"] == 0, f"created={again['created']}")
    check("重复分析建议总数不变", len(call("/optimizations")) == len(opts))
    kinds = {o["category"] for o in opts}
    check("覆盖 skill / prompt / 实体映射多类", len(kinds) >= 2, str(kinds))
    first = opts[0]
    approved = call(f"/optimizations/{first['id']}", "PUT", {"status": "approved"})
    check("建议可确认", approved["status"] == "approved")

    print("== 8. 导出与审计")
    pkg = call(f"/cases/{cid}/export")
    check("案例包可导出（含四层真值）", pkg["schema"].endswith("case@1") and bool(pkg["ground_truth"]["fault_type"]))
    check("审计日志已记录", len(call("/audit?limit=20")) > 0)
    check("API Token 可管理", len(call("/tokens")) >= 1)

    print("== 9. 监控与告警")
    ev = call("/alerts?window_hours=24")
    check("告警评估返回指标与规则", bool(ev["metrics"]) and len(ev["rules"]) == 10)
    check("演示数据触发告警", ev["summary"]["total"] >= 1, str(ev["summary"]))
    check("返回 Agent 健康快照", len(ev["agent_health"]) >= 1)
    check("告警带双语标题与处置建议",
          all(a["name_zh"] and a["name_en"] and a["hint_zh"] and a["hint_en"] for a in ev["alerts"]))
    check("告警指向具体证据", any(a["refs"] for a in ev["alerts"]))
    check("按严重度排序",
          [a["severity"] for a in ev["alerts"]]
          == sorted([a["severity"] for a in ev["alerts"]],
                    key=lambda x: {"critical": 0, "warning": 1, "info": 2}[x]))

    short = call("/alerts?window_hours=1")
    check("窗口可切换", short["window_hours"] == 1)

    # 规则读取与覆盖
    rules = call("/alerts/rules")["rules"]
    cb = next(r for r in rules if r["key"] == "cost_budget")
    check("规则可读且带默认值", cb["default_threshold"] == 5.0 and not cb["overridden"])
    upd = call("/alerts/rules", "PUT", {"rules": {"cost_budget": {"threshold": 1e9}}})["rules"]
    cb2 = next(r for r in upd if r["key"] == "cost_budget")
    check("阈值可覆盖", cb2["threshold"] == 1e9 and cb2["overridden"])
    ev2 = call("/alerts?window_hours=24")
    check("阈值提高后该规则静默", not any(a["rule_key"] == "cost_budget" for a in ev2["alerts"]))
    call("/alerts/rules", "PUT", {"rules": {"cost_budget": {"threshold": 5.0}}})
    check("恢复默认后标记清除",
          not next(r for r in call("/alerts/rules")["rules"] if r["key"] == "cost_budget")["overridden"])

    # 确认 / 取消确认
    ev3 = call("/alerts?window_hours=24")
    check("恢复默认后告警重新出现", ev3["summary"]["total"] >= 1)
    tgt = ev3["alerts"][0]
    call(f"/alerts/{tgt['rule_key']}/ack", "POST", {"signature": tgt["signature"]})
    ev4 = call("/alerts?window_hours=24")
    same = next(a for a in ev4["alerts"] if a["rule_key"] == tgt["rule_key"])
    check("告警可确认", same["acknowledged"] is True)
    check("未确认数相应减少", ev4["summary"]["open"] == ev3["summary"]["open"] - 1)
    missing = call("/alerts/no_such_rule/ack", "POST", {"signature": "x"}, expect_error=True)
    check("未知规则确认被拒", "未知规则" in str(missing), str(missing)[:80])
    no_sig = call(f"/alerts/{tgt['rule_key']}/ack", "POST", {}, expect_error=True)
    check("缺 signature 的确认被拒（防误确认）", "signature" in str(no_sig), str(no_sig)[:80])
    call(f"/alerts/{tgt['rule_key']}/ack", "DELETE")
    ev5 = call("/alerts?window_hours=24")
    check("取消确认后恢复未确认",
          not next(a for a in ev5["alerts"] if a["rule_key"] == tgt["rule_key"])["acknowledged"])

    print()
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    if FAIL:
        print("失败项：" + "、".join(FAIL))
        return 1
    print("全部通过 ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
