"""生成演示数据：一套电商微服务的实体拓扑 + 30 条运行快照 + 10 个四层真值案例。

设计成"开箱即有结论"：跑完之后大盘有趋势、案例库有黄金案例与 BadCase、
优化建议队列里已经有 3 条待确认的 skill/prompt 补丁。
"""
from __future__ import annotations

import random
import time

from . import optimizer, store
from .scoring import canonical_fault_type, fault_group_of, normalize_entity

random.seed(20260530)

# 统一实体模型：app → middleware → k8s → cloud 四层
ENTITIES = [
    ("frontend", "service", "app", ""),
    ("cart-service", "service", "app", "frontend"),
    ("checkout-service", "service", "app", "frontend"),
    ("product-catalog-service", "service", "app", "frontend"),
    ("currency-service", "service", "app", "frontend"),
    ("payment-service", "service", "app", "checkout-service"),
    ("shipping-service", "service", "app", "checkout-service"),
    ("email-service", "service", "app", "checkout-service"),
    ("recommendation-service", "service", "app", "frontend"),
    ("ad-service", "service", "app", "frontend"),
    ("cart-db", "redis", "middleware", "cart-service"),
    ("checkout-db", "mysql", "middleware", "checkout-service"),
    ("payment-db", "mysql", "middleware", "payment-service"),
    ("order-queue", "kafka", "middleware", "checkout-service"),
    ("promo-cache", "redis", "middleware", "recommendation-service"),
    ("ack-node-01", "node", "cloud", ""),
    ("ack-node-02", "node", "cloud", ""),
    ("ack-node-03", "node", "cloud", ""),
]

PODS = {
    "cart-service": "ack-node-01", "checkout-service": "ack-node-02",
    "payment-service": "ack-node-03", "product-catalog-service": "ack-node-01",
}


def _alias(base: str, env: str = "prod") -> str:
    """模拟其他运维系统里的命名口径差异。"""
    if base.startswith("ack-"):
        return base
    return f"{env}-{base}"


# 场景库：故障类型 → 实体 → 期望因果链 → 关键证据检查点
SCENARIOS = [
    {
        "fault_type": "slowSQL", "entity": "checkout-db", "difficulty": "L2",
        "task": "下单接口 P99 从 420ms 涨到 3.8s，前端报错率上升",
        "alert": "entry-api p99 latency > 3s (5m)",
        "chain": ["gateway-5xx-ratio-up", "checkout-latency-up", "db-query-time-up", "slow-sql-found"],
        "evidence": [
            {"name": "checkout-db 慢查询语句", "entity": "checkout-db", "metric": "slow_query", "keywords": ["select", "orders"]},
            {"name": "checkout-service P99 曲线", "entity": "checkout-service", "metric": "p99", "keywords": ["p99"]},
        ],
        "answer": {"fault_type": "slowSQL", "entity": "prod-checkout-db:3306",
                   "causal_chain": ["gateway-5xx-ratio-up", "checkout-latency-up", "db-query-time-up", "slow-sql-found"],
                   "evidence": [{"name": "checkout-db 慢查询语句", "value": "SELECT ... FROM orders WHERE ..."},
                                {"name": "checkout-service P99 曲线", "value": "p99 3.8s"}]},
    },
    {
        "fault_type": "nodeCpuHigh", "entity": "ack-node-02", "difficulty": "L3",
        "task": "多个服务同时抖动，宿主机层面排查",
        "alert": "node ack-node-02 cpu utilization > 92% (10m)",
        "chain": ["node-cpu-up", "pod-throttling", "multi-service-latency-up", "frontend-5xx"],
        "evidence": [
            {"name": "节点 CPU 水位", "entity": "ack-node-02", "metric": "cpu_util", "keywords": ["cpu"]},
            {"name": "容器 throttling 计数", "entity": "checkout-service", "metric": "throttled", "keywords": ["throttl"]},
        ],
        "answer": {"fault_type": "cpuFullLoad", "entity": "ack-node-02",
                   "causal_chain": ["node-cpu-up", "pod-throttling", "multi-service-latency-up"],
                   "evidence": [{"name": "节点 CPU 水位", "value": "cpu 94%"}]},
    },
    {
        "fault_type": "redisUnavailable", "entity": "cart-db", "difficulty": "L2",
        "task": "购物车接口出现大量 500，命中缓存的操作超时",
        "alert": "cart-service 5xx ratio > 12% (3m)",
        "chain": ["cart-redis-timeout", "cart-service-5xx", "frontend-error-rate-up"],
        "evidence": [
            {"name": "Redis 连接超时日志", "entity": "cart-db", "metric": "conn_timeout", "keywords": ["timeout", "redis"]},
            {"name": "cart-service 错误率", "entity": "cart-service", "metric": "error_rate", "keywords": ["5xx"]},
        ],
        "answer": {"fault_type": "podCrashLoop", "entity": "prod-cart-service-5f7c9d-x2k4",
                   "causal_chain": ["cart-service-5xx"],
                   "evidence": [{"name": "Pod 重启事件", "value": "no restart found"}]},
    },
    {
        "fault_type": "trafficSurge", "entity": "frontend", "difficulty": "L1",
        "task": "大促开始后入口 QPS 翻倍，延迟轻微上升但无错误",
        "alert": "entry qps 2.1x baseline (5m)",
        "chain": ["traffic-surge", "entry-qps-up", "upstream-capacity-tight"],
        "evidence": [
            {"name": "入口 QPS 曲线", "entity": "frontend", "metric": "qps", "keywords": ["qps"]},
            {"name": "限流触发计数", "entity": "frontend", "metric": "rate_limit", "keywords": ["limit"]},
        ],
        "answer": {"fault_type": "trafficSurge", "entity": "frontend",
                   "causal_chain": ["traffic-surge", "entry-qps-up", "upstream-capacity-tight"],
                   "evidence": [{"name": "入口 QPS 曲线", "value": "2100 rps"}, {"name": "限流触发计数", "value": "38"}]},
    },
    {
        "fault_type": "podRestartFlapping", "entity": "payment-service", "difficulty": "L3",
        "task": "支付成功率下跌，支付服务实例频繁重启",
        "alert": "pod payment-service restarts > 5 (15m)",
        "chain": ["pod-oomkilled", "pod-restart", "payment-instance-reduced", "payment-success-rate-down"],
        "evidence": [
            {"name": "Pod 重启事件", "entity": "payment-service", "metric": "restart_count", "keywords": ["restart", "oomkilled"]},
            {"name": "支付成功率", "entity": "payment-service", "metric": "success_rate", "keywords": ["success"]},
        ],
        "answer": {"fault_type": "memoryPressure", "entity": "payment-pod-7d9f8c-xk2l4",
                   "causal_chain": ["pod-oomkilled", "pod-restart", "payment-success-rate-down"],
                   "evidence": [{"name": "Pod 重启事件", "value": "OOMKilled x6"}]},
    },
    {
        "fault_type": "messageQueueBacklog", "entity": "order-queue", "difficulty": "L2",
        "task": "订单履约延迟，用户收到发货通知很慢",
        "alert": "kafka lag order-queue > 120k",
        "chain": ["mq-lag-up", "consumer-stalled", "shipping-delay", "user-notification-late"],
        "evidence": [
            {"name": "MQ 堆积量", "entity": "order-queue", "metric": "consumer_lag", "keywords": ["lag", "backlog"]},
            {"name": "消费者处理速率", "entity": "shipping-service", "metric": "consume_rate", "keywords": ["consume"]},
        ],
        "answer": {"fault_type": "数据库慢查询", "entity": "order-queue",
                   "causal_chain": ["mq-lag-up", "shipping-delay"],
                   "evidence": [{"name": "MQ 堆积量", "value": "lag 128000"}]},
    },
    {
        "fault_type": "fullGC", "entity": "product-catalog-service", "difficulty": "L3",
        "task": "商品详情页周期性卡顿，20 秒一次尖刺",
        "alert": "product-catalog-service p99 spike every 20s",
        "chain": ["heap-pressure", "fullgc-pause", "catalog-latency-spike", "page-slow"],
        "evidence": [
            {"name": "GC 停顿时间", "entity": "product-catalog-service", "metric": "gc_pause", "keywords": ["gc", "pause"]},
            {"name": "堆内存曲线", "entity": "product-catalog-service", "metric": "heap_used", "keywords": ["heap"]},
        ],
        "answer": {"fault_type": "fullGC", "entity": "product-catalog-service",
                   "causal_chain": ["heap-pressure", "fullgc-pause", "catalog-latency-spike", "page-slow"],
                   "evidence": [{"name": "GC 停顿时间", "value": "1.8s"}, {"name": "堆内存曲线", "value": "97%"}]},
    },
    {
        "fault_type": "dnsResolutionFailure", "entity": "recommendation-service", "difficulty": "L3",
        "task": "推荐位大面积空白，推荐服务调用下游全部失败",
        "alert": "recommendation-service upstream call failure > 60%",
        "chain": ["dns-resolve-fail", "upstream-call-fail", "recommend-slot-empty"],
        "evidence": [
            {"name": "DNS 解析失败日志", "entity": "recommendation-service", "metric": "dns_fail", "keywords": ["no such host", "dns"]},
            {"name": "下游调用失败率", "entity": "recommendation-service", "metric": "call_fail_rate", "keywords": ["fail"]},
        ],
        "answer": {"fault_type": "dns解析失败", "entity": "recommendation-service",
                   "causal_chain": ["dns-resolve-fail", "upstream-call-fail"],
                   "evidence": [{"name": "DNS 解析失败日志", "value": "no such host recommendation-db"}]},
    },
    {
        "fault_type": "slowSQL", "entity": "payment-db", "difficulty": "L2",
        "task": "支付回调批量超时，对账数据延迟",
        "alert": "payment callback timeout ratio > 8%",
        "chain": ["payment-db-slow", "callback-timeout", "reconcile-lag"],
        "evidence": [
            {"name": "payment-db 慢查询", "entity": "payment-db", "metric": "slow_query", "keywords": ["select", "payment"]},
            {"name": "回调超时率", "entity": "payment-service", "metric": "timeout_rate", "keywords": ["timeout"]},
        ],
        "answer": {"fault_type": "slowSQL", "entity": "payment-db",
                   "causal_chain": ["payment-db-slow", "callback-timeout", "reconcile-lag"],
                   "evidence": [{"name": "payment-db 慢查询", "value": "SELECT ... FROM payment_txn"}]},
    },
    {
        "fault_type": "rateLimiting", "entity": "frontend", "difficulty": "L2",
        "task": "网关开始返回 429，部分用户无法下单",
        "alert": "gateway 429 ratio > 5%",
        "chain": ["gateway-rate-limit", "429-spike", "partial-user-blocked"],
        "evidence": [
            {"name": "网关 429 比例", "entity": "frontend", "metric": "http_429", "keywords": ["429"]},
            {"name": "限流规则变更记录", "entity": "frontend", "metric": "config_change", "keywords": ["limit"]},
        ],
        "answer": {"fault_type": "rateLimiting", "entity": "frontend",
                   "causal_chain": ["gateway-rate-limit", "429-spike", "partial-user-blocked"],
                   "evidence": [{"name": "网关 429 比例", "value": "6.2%"}]},
    },
]

SERVICES = [e[0] for e in ENTITIES if e[1] == "service"]


def _signals_for(scenario: dict, base_ts: int) -> list[dict]:
    entity = scenario["entity"]
    group = fault_group_of(scenario["fault_type"])
    out: list[dict] = []
    t = base_ts

    def add(modality, name, value=None, text="", sev="info", ent=None, etype=""):
        out.append({
            "modality": modality, "entity_key": _alias(ent or entity), "entity_type": etype,
            "name": name, "ts_ms": t, "value": value, "text": text, "severity": sev,
            "payload": {"fault_group": group},
        })

    # metrics
    for i, (name, base, peak) in enumerate([
        ("cpu_util", 42, 94 if group in ("cloud-resource", "resource-perf") else 61),
        ("p99", 380, 3800 if scenario["fault_type"] == "slowSQL" else 900),
        ("error_rate", 0.3, 12.4 if scenario["fault_type"] in ("redisUnavailable", "rateLimiting") else 2.1),
        ("qps", 1000, 2100 if scenario["fault_type"] == "trafficSurge" else 1150),
    ]):
        t = base_ts + i * 60_000
        add("metric", name, round(base + (peak - base) * 0.7, 2), sev="warn" if peak > 90 or name == "p99" else "info",
            ent=entity, etype="middleware" if entity.endswith("db") else "service")
        t += 5_000
        add("metric", name, peak, sev="critical" if name in ("error_rate", "p99") else "warn",
            ent=entity, etype="middleware" if entity.endswith("db") else "service")

    # logs
    log_text = {
        "slowSQL": "slow query detected: SELECT * FROM orders WHERE status=? took 2841ms",
        "nodeCpuHigh": "container cpu throttled: 62% of period, node ack-node-02 cpu 94%",
        "redisUnavailable": "redis connection timeout after 2000ms host=cart-db:6379",
        "trafficSurge": "rate limit triggered for route /cart, current qps 2100 > limit 1500",
        "podRestartFlapping": "pod payment-service-7d9f8c-xk2l4 OOMKilled, restart count 6",
        "messageQueueBacklog": "consumer lag growing: order-queue lag=128000, consume rate 120/s",
        "fullGC": "Full GC pause 1.82s heap 97% used, allocation rate high",
        "dnsResolutionFailure": "lookup recommendation-db on 10.96.0.10:53: no such host",
        "rateLimiting": "gateway returned 429 for 6.2% requests, limit rule changed at 10:02",
    }.get(scenario["fault_type"], "abnormal signal detected")
    t = base_ts + 90_000
    add("log", "error_log", None, log_text, "error")
    t += 10_000
    add("log", "warning_log", None, f"upstream degradation suspected near {entity}", "warn")

    # traces
    for step in scenario["chain"]:
        t += 8_000
        add("trace", step, None, f"span {step} slow", "warn" if "fail" not in step else "error")

    # events / alerts / topology
    t += 6_000
    add("event", "k8s_event", None, f"BackOff restarting failed container {entity}", "warn")
    t += 4_000
    add("alert", "entry_alert", None, scenario["alert"], "critical", ent="frontend", etype="service")
    t += 2_000
    add("topology", "entity_relation", None,
        f"{entity} -> {PODS.get(entity, 'ack-node-01')} -> frontend", "info")
    return out


def _spans_for(scenario: dict, base_ms: int) -> list[dict]:
    spans = []
    tid = f"trace-{base_ms}"
    spans.append({"span_id": "s0", "parent_span_id": "", "name": "diagnose-task", "kind": "agent",
                  "status": "ok", "start_ms": base_ms, "end_ms": base_ms + 42_000,
                  "attributes": {"task": scenario["task"], "trace_id": tid}})
    for i, step in enumerate(scenario["chain"], 1):
        spans.append({"span_id": f"s{i}", "parent_span_id": "s0", "name": step,
                      "kind": "tool" if i % 2 else "llm", "status": "error" if "fail" in step else "ok",
                      "start_ms": base_ms + i * 6_000, "end_ms": base_ms + i * 6_000 + 5_000,
                      "attributes": {"entity": _alias(scenario["entity"]), "tool": "query_" + step.split("-")[0]}})
    return spans


def seed(user_id: int | None = None, fresh: bool = False) -> dict:
    store.init_db()
    if fresh:
        for t in ("case_runs", "cases", "signals", "spans", "runs", "agents", "entities",
                  "optimizations", "api_tokens", "settings", "audit_log", "users"):
            store.execute(f"DELETE FROM {t}")

    from .security import hash_password, new_api_token
    user = store.query_one("SELECT * FROM users WHERE username='admin'")
    if not user:
        uid = store.execute(
            "INSERT INTO users (username,password_hash,display_name,role,created_at) VALUES (?,?,?,?,?)",
            ("admin", hash_password("admin123"), "平台管理员", "owner", store.now()),
        )
    else:
        uid = user["id"]
    user_id = user_id or uid

    defaults = {
        "github_owner": "tachikomaver2-ship-it", "github_repo": "vibecoding", "github_base_branch": "main",
        "agent_endpoint": "", "default_agent": "ops-agent", "pass_threshold": "0.75", "collection": "demo",
    }
    for k, v in defaults.items():
        store.execute("INSERT INTO settings (user_id,key,value) VALUES (?,?,?) "
                      "ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value", (user_id, k, v))
    if not store.query_one("SELECT id FROM api_tokens WHERE user_id=?", (user_id,)):
        store.execute("INSERT INTO api_tokens (user_id,name,token,created_at) VALUES (?,?,?,?)",
                      (user_id, "demo-sdk", new_api_token(), store.now()))

    if not store.query_one("SELECT id FROM entities WHERE user_id=?", (user_id,)):
        for key, etype, layer, parent in ENTITIES:
            store.execute(
                """INSERT OR IGNORE INTO entities (user_id,entity_key,canonical,etype,layer,aliases_json,parent_key)
                   VALUES (?,?,?,?,?,?,?)""",
                (user_id, key, key, etype, layer,
                 store.jdump([_alias(key), f"{key}:8080", f"{key}.prod.svc.cluster.local"], "[]"),
                 normalize_entity(parent)),
            )
        for pod_svc, node in PODS.items():
            store.execute(
                """INSERT OR IGNORE INTO entities (user_id,entity_key,canonical,etype,layer,aliases_json,parent_key)
                   VALUES (?,?,?,?,?,?,?)""",
                (user_id, f"{pod_svc}-pod", pod_svc, "pod", "k8s",
                 store.jdump([f"prod-{pod_svc}-7d9f8c-xk2l4"], "[]"), normalize_entity(node)),
            )

    from .ingest import ingest_run, upsert_agent as _upsert_agent
    agent_id = _upsert_agent(user_id, "ops-agent",
                             {"agent_type": "ops", "version": "v1.4.2", "framework": "react-loop"})
    _upsert_agent(user_id, "coding-agent",
                  {"agent_type": "coding", "version": "v0.9.1", "framework": "claude-code"})

    now = time.time()
    created_runs = 0
    if not store.query_one("SELECT id FROM runs WHERE user_id=?", (user_id,)):
        for day in range(13, -1, -1):
            for idx, sc in enumerate(SCENARIOS):
                if (day + idx) % 3 == 2:
                    continue
                started = now - day * 86400 - (idx % 6) * 3600
                base_ts = int(started * 1000)
                run_id = f"run-{time.strftime('%Y%m%d', time.localtime(started))}-{idx:02d}"
                failing = idx in (1, 4, 5, 7)
                heavy = (day + idx) % 5 == 0
                bundle = {
                    "run": {
                        "external_run_id": run_id,
                        "agent": "ops-agent",
                        "session_id": f"session-{day}-{idx}",
                        "task": sc["task"],
                        "status": "failed" if failing else ("partial" if idx % 4 == 3 else "success"),
                        "env": "prod",
                        "model": "qwen-max",
                        "agent_version": "v1.4.2" if day % 4 else "v1.4.1",
                        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(started)),
                        "ended_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(started + 240)),
                        "duration_ms": 240_000 if not heavy else 640_000,
                        "tokens_in": 12_000 + idx * 900,
                        "tokens_out": 4_800 + idx * 700 + (150_000 if heavy else 0),
                        "cost_usd": round(0.02 + idx * 0.004 + (0.9 if heavy else 0), 4),
                        "tool_calls": 6 + idx + (18 if heavy else 0),
                        "steps": len(sc["chain"]),
                        "error_type": canonical_fault_type(sc["fault_type"]) if failing else "",
                        "error_message": sc["alert"] if failing else "",
                        "meta": {"env": "ACK", "namespace": "prod", "region": "cn-hangzhou"},
                    },
                    "spans": _spans_for(sc, base_ts),
                    "signals": _signals_for(sc, base_ts),
                    "snapshot": {
                        "trace_ids": [f"trace-{base_ts}"],
                        "window_minutes": 30,
                        "collector": "loongsuite-pilot",
                        "recorded_by": "harness-sdk/1.0.0",
                        "modalities": ["metric", "log", "trace", "event", "alert", "topology"],
                    },
                }
                ingest_run(user_id, bundle)
                created_runs += 1

    # 案例：从运行快照生成，附四层真值与录制作答
    case_count = store.query_one("SELECT COUNT(*) AS n FROM cases WHERE user_id=?", (user_id,))["n"]
    created_cases = 0
    if not case_count:
        from .ingest import auto_fill_from_run as _auto_fill_from_run
        runs = store.query(
            "SELECT r.* FROM runs r WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 200",
            (user_id,),
        )
        used: set[str] = set()
        for i, sc in enumerate(SCENARIOS):
            run = next((r for r in runs if r["task"] == sc["task"]
                        and r["external_run_id"] not in used), None)
            if not run:
                continue
            used.add(run["external_run_id"])
            run = store.dec(run)
            auto = _auto_fill_from_run(user_id, run)
            case_key = f"RCA-{i + 1:03d}"
            cid = store.execute(
                """INSERT INTO cases (user_id,case_key,title,source_run_id,status,difficulty,tags_json,
                   fault_type,fault_group,root_cause_entity,entity_key,expected_json,causal_chain_json,
                   evidence_json,replay_json,quality_json,notes,created_at,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    user_id, case_key, sc["task"], run["id"], "draft", sc["difficulty"],
                    store.jdump([fault_group_of(sc["fault_type"]), "demo"], "[]"),
                    canonical_fault_type(sc["fault_type"]), fault_group_of(sc["fault_type"]),
                    sc["entity"], normalize_entity(sc["entity"]),
                    store.jdump({"alert": sc["alert"], "topology": [sc["entity"], PODS.get(sc["entity"], "ack-node-01")]}, "{}"),
                    store.jdump(sc["chain"], "[]"), store.jdump(sc["evidence"], "[]"),
                    store.jdump({"last_answer": sc["answer"], "auto_filled": auto}, "{}"),
                    store.jdump({}, "{}"),
                    "由运行快照自动生成初稿的四层真值，人工复核后沉淀。", store.now(), store.now(),
                ),
            )
            created_cases += 1

    # 建立基线回放：offline 模式跑一遍，形成黄金案例 / BadCase 分布
    from .replay import run_replay
    replay_count = store.query_one("SELECT COUNT(*) AS n FROM case_runs WHERE user_id=?", (user_id,))["n"]
    if not replay_count:
        for row in store.query("SELECT * FROM cases WHERE user_id=? ORDER BY id", (user_id,)):
            case = store.dec(row)
            run_replay(user_id, case, mode="offline", agent_version="v1.4.2")
        for row in store.query("SELECT * FROM cases WHERE user_id=? ORDER BY id", (user_id,)):
            case = store.dec(row)
            if case["status"] != "draft":
                continue
            from .graph import load_edges
            from .scoring import quality_gate
            sigs = store.dec_many(store.query("SELECT * FROM signals WHERE run_id=?", (case["source_run_id"],)))
            gate = quality_gate(case, sigs, load_edges(user_id))
            store.execute("UPDATE cases SET quality_json=? WHERE id=?", (store.jdump(gate), case["id"]))
            latest = store.query_one(
                "SELECT verdict FROM case_runs WHERE case_id=? ORDER BY created_at DESC, id DESC LIMIT 1",
                (case["id"],))
            verdict = (latest or {}).get("verdict")
            # 只有回放通过且门禁通过才沉淀为黄金案例；通过门禁但结论未达标的留在 candidate 待人工复核
            if gate["passed"] and verdict == "pass":
                store.execute("UPDATE cases SET status='golden' WHERE id=?", (case["id"],))
            else:
                store.execute("UPDATE cases SET status='candidate' WHERE id=?", (case["id"],))

    # 跑一次 BadCase 分析，让优化队列里直接有东西可审
    opt = optimizer.analyze(user_id)

    entity_n = store.query_one("SELECT COUNT(*) AS n FROM entities WHERE user_id=?", (user_id,))["n"]
    return {
        "user_id": user_id, "username": "admin", "password": "admin123",
        "entities": entity_n, "runs_created": created_runs,
        "cases_created": created_cases,
        "cases_total": store.query_one("SELECT COUNT(*) AS n FROM cases WHERE user_id=?", (user_id,))["n"],
        "case_runs": store.query_one("SELECT COUNT(*) AS n FROM case_runs WHERE user_id=?", (user_id,))["n"],
        "optimizations": store.query_one("SELECT COUNT(*) AS n FROM optimizations WHERE user_id=?", (user_id,))["n"],
        "optimize_summary": opt,
    }


if __name__ == "__main__":
    import json
    import sys
    fresh = "--fresh" in sys.argv
    print(json.dumps(seed(fresh=fresh), ensure_ascii=False, indent=2))
