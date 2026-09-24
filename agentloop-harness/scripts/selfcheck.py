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

from app import graph, optimizer, store  # noqa: E402
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

    print()
    print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
    if FAIL:
        print("失败项：" + "、".join(FAIL))
        return 1
    print("全部通过 ✅（数据库位于 " + TMP + "）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
