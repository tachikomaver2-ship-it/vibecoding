#!/usr/bin/env python3
"""示例：用 SDK 把一次「线上故障排查」的全过程上报到 Harness。

演示三件事：
  1. 用 with h.run(...) 包裹 Agent 执行，自动收敛耗时/token；
  2. 把 trace / metrics / logs 以信号形式记下来；
  3. 落一个结构化作答（四层真值的「预测侧」）。

运行（需先启动平台并获得 API Token，网页「设置 → API Token」可生成）：
    export HARNESS_ENDPOINT=http://127.0.0.1:8848
    export HARNESS_TOKEN=hnx_xxxxxxxx
    python3 examples/sdk_demo.py

若设置了 PYTHONPATH=sdk，可直接 `from harness import Harness`；
否则本文件会自动把 ../sdk 加进 sys.path。
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "sdk"))

from harness import Harness  # noqa: E402


def main() -> int:
    h = Harness(
        endpoint=os.environ.get("HARNESS_ENDPOINT", "http://127.0.0.1:8848"),
        token=os.environ.get("HARNESS_TOKEN", ""),
        agent="ops-agent",
        agent_version="v0.3.0",
        env="prod",
    )

    with h.run(task="checkout-service 下单接口 P99 从 180ms 飙到 3.8s",
               external_run_id=f"demo-{int(time.time())}") as rec:
        # 1) 入口告警
        rec.alert("【P1】checkout-service P99 延迟突增，超阈值 3.8s",
                  entity="prod-checkout-service-7d9f-x2k4")

        # 2) 指标（注意：实体名故意写成线上原始形态，平台会自动归一化）
        rec.metric("prod-checkout-service-7d9f-x2k4", "p99_latency_ms", 3800, severity="critical")
        rec.metric("prod-checkout-db:3306", "db_conn_active", 92, severity="error")
        rec.metric("prod-checkout-db:3306", "innodb_row_lock_waits", 41, severity="warn")

        # 3) 日志
        rec.log("PROD/checkout-db", "[ERROR] SELECT * FROM orders WHERE user_id=? ... "
                                   "took 3721ms; lock wait timeout exceeded.", severity="error")

        # 4) trace（用 span 记录一次工具调用，会自动计时）
        with rec.span("query-metrics", kind="tool", entity="prod-checkout-db:3306"):
            time.sleep(0.05)
        with rec.span("fetch-topology", kind="tool"):
            time.sleep(0.02)
        rec.tool_call("kubectl_get_events", entity="prod-checkout-service-7d9f-x2k4", ok=True)

        # 5) 拓扑
        rec.topology("checkout-service → checkout-db → mysql-orders-0", entity="prod-checkout-db:3306")

        # 6) 资源消耗
        rec.usage(tokens_in=8420, tokens_out=1160, cost_usd=0.0421)

        # 7) 最终作答（四层真值的预测侧）
        rec.answer(
            fault_type="slowSQL",
            entity="checkout-db",
            causal_chain=[
                "orders 表缺失 user_id 索引",
                "慢查询占用连接",
                "连接池活跃数打满",
                "checkout-service P99 飙升",
            ],
            evidence=[
                {"name": "慢查询日志", "value": "took 3721ms; lock wait timeout exceeded",
                 "entity": "checkout-db", "metric": "p99_latency_ms"},
                {"name": "连接池", "value": "db_conn_active=92", "entity": "checkout-db",
                 "metric": "db_conn_active"},
            ],
        )

    run = rec.result or {}
    run_id = run.get("run_id")
    print(f"✓ 已上报运行 run_id={run_id}（状态 {run.get('status')}）")

    # 从这次运行直接生成一个待标注案例（四层真值会自动抽初稿）
    case = h.create_case(run_id, title="checkout-service P99 飙升（慢 SQL）", difficulty="L2")
    print(f"✓ 已生成案例 case_id={case['id']}  质量门禁："
          f"{'通过' if case['quality']['passed'] else '未通过'}")
    for item in case["quality"]["checks"]:
        print(f"    - {item['layer']:<12} {'✓' if item['passed'] else '✗'}  {item['detail']}")

    # 回放一次（offline = 用快照里记录的作答，验证打分链路）
    rp = h.replay(case["id"], mode="offline")
    print(f"✓ 回放完成：总分 {rp['score']['total']:.3f} → {rp['score']['verdict']}"
          f"（自动判定 {rp.get('status', 'n/a')}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
