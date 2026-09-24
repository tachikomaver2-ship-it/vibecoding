#!/usr/bin/env python3
"""离线自检：不需要 Web 框架，验证四层真值评分、GSTO 门禁、摄入与 BadCase 优化链路。

用法：
    python scripts/selfcheck.py
"""
from __future__ import annotations

import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

TMP = tempfile.mkdtemp(prefix="harness-selfcheck-")
os.environ["HARNESS_DB"] = os.path.join(TMP, "harness.db")

from app import alerts, graph, optimizer, store  # noqa: E402
from app.replay import export_case, run_replay, run_suite  # noqa: E402
from app.scoring import (  # noqa: E402
    canonical_fault_type, entity_score, fault_type_score, normalize_entity, quality_gate, score_case,
)

PASS, FAIL = [], []


def check(name: str, cond: bool, extra: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(("  ✓ " if cond else "  ✗ ") + name + ((" — " + extra) if extra and not cond else ""))


def main() -> int:
    print("== 1. 实体归一化（跨域唯一主键）")
    cases = [
        ("prod-cart-service-5f7c9d-x2k4", "cart-service"),
        ("cart_service:8080", "cart-service"),
        ("PROD/cart-service", "cart-service"),
        ("cart-service.prod.svc.cluster.local", "cart-service-prod-svc-cluster-local"),
    ]
    for raw, expect in cases[:3]:
        got = normalize_entity(raw)
        check(f"归一化 {raw} → {got}", got == expect, f"期望 {expect}")

    print("== 2. 定因评分（故障类型语义距离）")
    s, note = fault_type_score("slowSQL", "slowSQL")
    check("精确命中 = 1.0", s == 1.0, note)
    s2, note2 = fault_type_score("slowSQL", "redisUnavailable")
    check("同组命中 = 0.6", s2 == 0.6, note2)
    s3, note3 = fault_type_score("slowSQL", "memoryPressure")
    check("跨组显著衰减 ≤ 0.3", s3 <= 0.3, note3)
    s4, _ = fault_type_score("rateLimiting", "限流")
    check("中文别名归一到规范类型", canonical_fault_type("限流") == "rateLimiting" and s4 == 1.0)

    print("== 3. 定界评分（实体拓扑距离）")
    store.init_db()
    uid = store.execute(
        "INSERT INTO users (username,password_hash,display_name,created_at) VALUES (?,?,?,?)",
        ("selfcheck", "x", "selfcheck", store.now()),
    )
    for key, parent in [("checkout-service", ""), ("frontend", ""), ("checkout-db", "checkout-service")]:
        store.execute(
            "INSERT INTO entities (user_id,entity_key,canonical,etype,layer,parent_key) VALUES (?,?,?,?,?,?)",
            (uid, key, key, "service", "app", parent),
        )
    edges = graph.load_edges(uid)
    check("拓扑边已建立", "checkout-db" in edges.get("checkout-service", set()))
    s0, n0 = entity_score("checkout-db", "prod-checkout-db:3306", edges)
    check("同实体（不同命名口径）→ 1.0", s0 == 1.0, n0)
    s1, n1 = entity_score("checkout-db", "checkout-service", edges)
    check("一跳距离 → 0.75", abs(s1 - 0.75) < 1e-6, f"{s1} {n1}")
    s2, n2 = entity_score("checkout-db", "frontend", edges)
    check("不可达时降级为相似度分", s2 <= 0.45, f"{s2} {n2}")

    print("== 4. 四层真值综合评分（定因 40% / 定界 30% / 过程 30%）")
    case = {
        "fault_type": "slowSQL", "fault_group": "middleware-db", "root_cause_entity": "checkout-db",
        "causal_chain": ["a-1", "b-2", "c-3", "d-4"],
        "evidence": [
            {"name": "慢查询", "entity": "checkout-db", "metric": "slow_query", "keywords": ["select"]},
            {"name": "P99", "entity": "checkout-service", "metric": "p99", "keywords": ["p99"]},
        ],
    }
    perfect = {
        "fault_type": "slowSQL", "entity": "prod-checkout-db:3306",
        "causal_chain": ["a-1", "b-2", "c-3", "d-4"],
        "evidence": [{"name": "慢查询", "value": "SELECT * FROM orders"},
                     {"name": "P99", "value": "p99=3800"}],
    }
    r = score_case(case, perfect, edges)
    check("完美作答综合分 = 1.0", r["score"] == 1.0, str(r))
    check("完美作答判定 pass", r["verdict"] == "pass")
    check("约 70% 分数来自确定性计算", r["detail"]["deterministic_ratio"] >= 0.7,
          str(r["detail"]["deterministic_ratio"]))

    wrong = {
        "fault_type": "memoryPressure", "entity": "payment-service",
        "causal_chain": ["a-1"], "evidence": [],
    }
    r2 = score_case(case, wrong, edges)
    check("误判作答综合分显著下降", r2["score"] < 0.4, str(r2["score"]))
    check("误判作答判定 fail", r2["verdict"] == "fail")
    check("综合分等于加权和", abs(r2["score"] - (r2["score_fault"] * 0.4 + r2["score_entity"] * 0.3 + r2["score_process"] * 0.3)) < 0.002)

    print("== 5. GSTO 质量门禁")
    signals = [
        {"modality": "metric", "ts_ms": 1000, "entity_key": "checkout-db"},
        {"modality": "log", "ts_ms": 2000, "entity_key": "checkout-db"},
        {"modality": "trace", "ts_ms": 3000, "entity_key": "checkout-db"},
        {"modality": "metric", "ts_ms": 4000, "entity_key": "checkout-service"},
        {"modality": "log", "ts_ms": 5000, "entity_key": "checkout-service"},
    ]
    full = {"title": "下单 P99 飙升", "fault_type": "slowSQL", "root_cause_entity": "checkout-db", "entity_key": "checkout-db"}
    g = quality_gate(full, signals, edges)
    check("四层齐备 → 门禁通过", g["passed"], str([c for c in g["checks"] if not c["passed"]]))
    g2 = quality_gate({**full, "root_cause_entity": "unknown-svc", "entity_key": "unknown-svc"}, signals, edges)
    check("实体未登记 → 开放适配性不通过", not g2["passed"])
    check("门禁含四层检查", len(g["checks"]) == 4)

    print("== 6. 快照摄入 + 案例沉淀 + 回放 + BadCase 优化")
    from app.ingest import ingest_run
    from app.seed import seed

    result = seed(user_id=uid, fresh=True)
    check("演示数据生成成功", result["runs_created"] > 20, str(result["runs_created"]))
    check("案例已沉淀", result["cases_total"] >= 10, str(result["cases_total"]))
    check("基线回放已建立", result["case_runs"] >= 10, str(result["case_runs"]))

    bad = store.query("SELECT * FROM cases WHERE user_id=? AND status='badcase'", (uid,))
    golden = store.query("SELECT * FROM cases WHERE user_id=? AND status='golden'", (uid,))
    cand = store.query("SELECT * FROM cases WHERE user_id=? AND status='candidate'", (uid,))
    check("已自动识别出 BadCase", len(bad) >= 2, str(len(bad)))
    check("已沉淀黄金案例", len(golden) >= 4, str(len(golden)))
    check("灰色地带进 candidate 待复核", len(cand) >= 1, str(len(cand)))
    check("案例状态三元分布完整", len(bad) + len(golden) + len(cand) == len(store.query("SELECT id FROM cases WHERE user_id=?", (uid,))))

    if bad:
        c = store.dec(bad[0])
        rr = run_replay(uid, c, mode="offline", agent_version="selfcheck")
        check("离线回放可复跑并产出分数", rr["score"] >= 0 and rr["verdict"] in ("pass", "partial", "fail"), str(rr.get("error")))

    suite = run_suite(uid, [r["id"] for r in store.query("SELECT id FROM cases WHERE user_id=?", (uid,))], mode="offline")
    check("案例集批量回放", suite["total"] >= 10 and 0 <= suite["pass_rate"] <= 1, str(suite["total"]))

    analysis = optimizer.analyze(uid)
    check("BadCase 分析产出簇", len(analysis["clusters"]) >= 1, str(analysis))
    opts = store.query("SELECT * FROM optimizations WHERE user_id=?", (uid,))
    check("自动生成优化建议", len(opts) >= 2, str(len(opts)))
    kinds = {o["category"] for o in opts}
    check("建议覆盖 skill / prompt / 实体映射", len(kinds) >= 2, str(kinds))
    for o in opts:
        if o["patch"]:
            check(f"建议 #{o['id']} 含可审阅 diff", "+++" in o["patch"] or o["patch"].startswith("--- /dev/null"))
            break
    check("建议记录了关联 BadCase", any(o["case_ids_json"] not in ("[]", "", None) for o in opts))

    case_row = store.dec(store.query_one("SELECT * FROM cases WHERE user_id=? LIMIT 1", (uid,)))
    pkg = export_case(case_row, None)
    check("案例包含四层真值与快照", pkg["ground_truth"]["fault_type"] and pkg["snapshot"]["signal_count"] > 0)

    # ---------------------------------------------------------- 8 监控告警
    print("== 7. 监控告警（确定性规则引擎）")
    ev = alerts.evaluate(uid, 24)
    m = ev["metrics"]
    check("窗口内指标可算", m["runs"] > 0 and 0 <= m["success_rate"] <= 1, str(m["success_rate"]))
    check("回放通过率进入指标", "replay_pass_rate" in m and m["replays"] > 0, str(m["replays"]))
    check("告警规则共 10 条", len(ev["rules"]) == 10, str(len(ev["rules"])))
    check("演示数据应触发告警（含严重级）", ev["summary"]["critical"] >= 1, str(ev["summary"]))
    check("告警按严重度排序",
          [a["severity"] for a in ev["alerts"]]
          == sorted([a["severity"] for a in ev["alerts"]], key=lambda x: alerts.SEVERITY_RANK[x]))
    check("每条告警都有中英双语标题与处置建议",
          all(a["name_zh"] and a["name_en"] and a["hint_zh"] and a["hint_en"] for a in ev["alerts"]))
    check("告警指向具体证据 refs", any(a["refs"] for a in ev["alerts"]))
    check("Agent 健康快照覆盖全部 Agent", len(ev["agent_health"]) >= 2)
    check("静默 Agent 被识别", any(h["silent"] for h in ev["agent_health"]))
    check("健康状态取值合法",
          all(h["status"] in ("healthy", "degraded", "silent") for h in ev["agent_health"]))

    # 评估必须确定性：同窗口重跑结果一致
    ev_again = alerts.evaluate(uid, 24)
    sig1 = [(x["rule_key"], x["signature"]) for x in ev["alerts"]]
    sig2 = [(x["rule_key"], x["signature"]) for x in ev_again["alerts"]]
    check("重复评估结果一致（确定性）", sig1 == sig2, f"{len(sig1)} vs {len(sig2)}")

    # 样本不足要跳过而不是误报。时间戳精度只到秒，切不出「空窗口」，
    # 所以用一个没有任何数据的 user_id 来验证，顺便覆盖多租户隔离。
    empty_uid = uid + 100000
    empty = alerts.evaluate(empty_uid, 24)
    check("无数据用户不产生业务告警", empty["metrics"]["runs"] == 0 and not empty["agent_health"])
    check("样本不足时规则被跳过而非误报",
          empty["skipped_rules"] and not any(
              a["rule_key"] in ("success_rate_drop", "error_spike", "replay_pass_drop")
              for a in empty["alerts"]),
          str([s["rule_key"] for s in empty["skipped_rules"]]))
    check("无数据时触发 no_data 提示",
          any(a["rule_key"] == "no_data" for a in empty["alerts"]),
          str([a["rule_key"] for a in empty["alerts"]]))
    check("多租户隔离：他人数据不串入", empty["metrics"]["runs"] != m["runs"])

    # 确认 / 取消确认
    target = next((a for a in ev["alerts"] if a["rule_key"] == "cost_budget"), ev["alerts"][0])
    alerts.ack(uid, target["rule_key"], target["signature"], "已知悉")
    ev_acked = alerts.evaluate(uid, 24)
    same = next(a for a in ev_acked["alerts"] if a["rule_key"] == target["rule_key"])
    check("确认后该告警标记为已确认", same["acknowledged"] is True)
    check("确认不影响其他告警",
          ev_acked["summary"]["open"] == ev["summary"]["open"] - 1,
          f"{ev_acked['summary']['open']} vs {ev['summary']['open']}")
    alerts.unack(uid, target["rule_key"])
    check("取消确认后恢复未确认",
          not next(a for a in alerts.evaluate(uid, 24)["alerts"]
                   if a["rule_key"] == target["rule_key"])["acknowledged"])

    # 签名量化：数值微抖动不应重新告警
    s_ratio = alerts._signature("success_rate", 0.51064, "ratio")
    check("比率签名按 0.1% 量化（微抖动不重触发）",
          s_ratio == alerts._signature("success_rate", 0.51061, "ratio"), s_ratio)
    check("比率签名对真实变化敏感", s_ratio != alerts._signature("success_rate", 0.62, "ratio"))

    # 阈值覆盖
    rules = alerts.save_rules(uid, {"cost_budget": {"threshold": 999, "severity": "info"}})
    r = next(x for x in rules if x["key"] == "cost_budget")
    check("阈值可覆盖并标记来源", r["threshold"] == 999 and r["severity"] == "info" and r["overridden"])
    check("覆盖后仍保留默认值", r["default_threshold"] == 5.0)
    check("提高阈值后该规则不再触发",
          not any(a["rule_key"] == "cost_budget" for a in alerts.evaluate(uid, 24)["alerts"]))
    check("规则语义字段不可覆盖", "op" not in alerts.OVERRIDABLE and "metric" not in alerts.OVERRIDABLE)
    alerts.save_rules(uid, {"cost_budget": {"threshold": 5.0, "severity": "warning"}})
    restored = next(x for x in alerts.effective_rules(uid) if x["key"] == "cost_budget")
    check("恢复默认值后去掉自定义标记", not restored["overridden"], str(restored))

    # 启停
    alerts.save_rules(uid, {"no_data": {"enabled": False}})
    check("规则可停用",
          not next(x for x in alerts.effective_rules(uid) if x["key"] == "no_data")["enabled"])
    alerts.save_rules(uid, {"no_data": {"enabled": True}})

    print()
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    if FAIL:
        print("失败项：" + "、".join(FAIL))
        return 1
    print("全部通过 ✅（数据库位于 " + TMP + "）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
