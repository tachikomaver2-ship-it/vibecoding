# API 与 SDK 参考

服务默认地址 `http://127.0.0.1:8848`，交互式文档在 `/api/docs`（Swagger UI），OpenAPI JSON 在 `/api/openapi.json`。

## 一、鉴权

两种方式，任选其一：

```
Authorization: Bearer <session_token>     # 网页登录后签发，7 天有效
X-Api-Token: hnx_xxxxxxxxxxxxxxxx         # 长期 Token，SDK / CI 用
```

### 获取凭据

```bash
# 注册（首个用户成为 owner）
curl -sX POST http://127.0.0.1:8848/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"ops","password":"your-password"}'
# → {"token":"...","user":{"id":2,"username":"ops",...}}

# 登录
curl -sX POST http://127.0.0.1:8848/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"ops","password":"your-password"}'

# 生成长期 API Token（返回的明文只出现这一次）
curl -sX POST http://127.0.0.1:8848/api/v1/tokens \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"ci-runner"}'
# → {"id":1,"token":"hnx_...","name":"ci-runner"}
```

### 错误码

| 码 | 含义 |
|---|---|
| 400 | 参数不合法（如 `run.external_run_id` 为空、GitHub 未配置） |
| 401 | 未鉴权 / Token 失效 |
| 404 | 资源不存在或不属于当前用户 |
| 500 | 服务端异常 |

---

## 二、上报接口

### `POST /api/v1/ingest/run` —— 上报一次运行

幂等：同一 `run.external_run_id` 重复上报会**覆盖**该运行及其 spans / signals。

```json
{
  "run": {
    "external_run_id": "ci-20260924-001",
    "agent": "ops-agent",
    "agent_version": "v0.3.0",
    "agent_type": "custom",
    "framework": "langgraph",
    "session_id": "sess-9f2a",
    "task": "checkout-service 下单接口 P99 从 180ms 飙到 3.8s",
    "status": "failed",
    "env": "prod",
    "model": "qwen3-max",
    "started_at": "2026-09-24T14:20:00",
    "ended_at": "2026-09-24T14:22:31",
    "duration_ms": 151000,
    "tokens_in": 8420,
    "tokens_out": 1160,
    "cost_usd": 0.0421,
    "tool_calls": 7,
    "steps": 12,
    "error_type": "slowSQL",
    "error_message": "final answer rejected by SLO gate",
    "meta": {"k8s_namespace": "prod"}
  },
  "signals": [
    {"modality": "metric", "entity": "prod-checkout-db:3306", "entity_type": "middleware",
     "name": "db_conn_active", "value": 94, "severity": "error", "ts_ms": 1758891220000},
    {"modality": "log", "entity": "PROD/checkout-db",
     "text": "[ERROR] slow query took 3721ms", "severity": "error", "ts_ms": 1758891205000},
    {"modality": "trace", "name": "slow-sql-found", "entity": "checkout-db",
     "text": "orders 表全表扫描", "ts_ms": 1758891215000}
  ],
  "spans": [
    {"name": "query-metrics", "kind": "tool", "entity": "checkout-db",
     "start_ms": 1758891200000, "duration_ms": 210, "status": "ok",
     "attrs": {"rows": 200}}
  ],
  "snapshot": {"collector": "my-agent/v0.3", "note": "线上故障复盘"}
}
```

响应：

```json
{"run_id": 97, "external_run_id": "ci-20260924-001", "spans": 1, "signals": 3, "updated": false}
```

**字段说明**

| 字段 | 必填 | 说明 |
|---|---|---|
| `run.external_run_id` | ✅ | 幂等键，上报方保证唯一 |
| `run.agent` | — | 缺省 `unknown-agent` |
| `run.status` | — | `success` / `failed` / `partial` / `unknown`，缺省 `unknown` |
| `signals[].modality` | — | `metric` / `log` / `trace` / `event` / `alert` / `topology` / `span`，缺省 `unknown` |
| `signals[].entity` | — | **可以写线上原始形态**（`prod-cart-service-5f7c9d-x2k4`），平台会自动归一化 |
| `spans[].kind` | — | `step` / `tool` / `llm` / `http` 等自由字符串 |

`raw` 原始对象会完整存进 `signals.payload_json`，不会被丢弃。

### `POST /api/v1/ingest/batch`

```json
{"runs": [ {...}, {...} ]}
```

### `POST /api/v1/demo/seed` —— 写演示数据

当 `users` 表为空时**允许匿名调用**（引导流程）；已有用户时需鉴权。

---

## 三、案例接口

### `POST /api/v1/cases` —— 创建案例（标注四层真值）

```json
{
  "source_run_id": 97,
  "title": "checkout-service P99 飙升（慢 SQL）",
  "difficulty": "L2",
  "tags": ["middleware", "prod"],
  "status": "candidate",

  "fault_type": "slowSQL",
  "root_cause_entity": "prod-checkout-db:3306",

  "causal_chain": [
    "orders 表缺失 user_id 索引",
    "慢查询占用连接",
    "连接池活跃数打满",
    "checkout-service P99 飙升"
  ],
  "evidence": [
    {"name": "checkout-db 慢查询日志",
     "entity": "checkout-db", "metric": "p99_latency_ms",
     "keywords": ["union", "orders", "lock wait"]},
    {"name": "连接池水位", "entity": "checkout-db", "metric": "db_conn_active"}
  ],
  "replay": {
    "recorded_answer": {
      "fault_type": "slowSQL",
      "entity": "checkout-db",
      "causal_chain": ["...", "..."],
      "evidence": [{"name": "慢查询日志", "value": "took 3721ms"}]
    }
  },
  "notes": "真值已人工复核"
}
```

**省略的字段会自动抽初稿**（`auto_fill_from_run`）：不传 `fault_type` 就从 `run.error_type` 推、再退回扫信号名；不传 `root_cause_entity` 就取首个 `critical` 信号的实体；不传 `causal_chain` / `evidence` 就从信号生成。

⚠️ **初稿不是真值，必须人工复核后再提升状态。**

响应（含即时门禁结果）：

```json
{
  "id": 12,
  "case_key": "ci-20260924-001-012",
  "quality": {
    "passed": true,
    "score": 1.0,
    "checks": [
      {"layer": "Structure",  "name": "结构规范",   "passed": true, "note": "标题 / 规范化故障类型 / 归一化根因实体齐备"},
      {"layer": "Signal",     "name": "信号有效性", "passed": true, "note": "模态 ['log','metric','trace']，共 3 条"},
      {"layer": "TimeWindow", "name": "时间窗口",   "passed": true, "note": "观测窗口 0.2 分钟"},
      {"layer": "Openness",   "name": "开放适配性", "passed": true, "note": "根因实体存在于统一实体模型，可跨域映射"}
    ]
  }
}
```

### 其他案例接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/cases?status=badcase&limit=50` | 列表（可按状态过滤）|
| `GET` | `/cases/{id}` | 详情（真值 + 门禁 + 来源运行 + 最近回放）|
| `PUT` | `/cases/{id}` | 修改真值 / 标题 / 难度 / 标签 |
| `POST` | `/cases/{id}/gate` | 重跑 GSTO 门禁 |
| `POST` | `/cases/{id}/status` | 手动流转状态：`{"status":"golden"}` |
| `GET` | `/cases/{id}/runs` | 回放历史（分数曲线数据源）|
| `GET` | `/cases/{id}/export` | 导出案例包 JSON |
| `DELETE` | `/cases/{id}` | 删除 |

导出格式（`schema: agentloop-harness/case@1`）：

```json
{
  "schema": "agentloop-harness/case@1",
  "case_key": "ci-20260924-001-012",
  "title": "...", "status": "golden", "difficulty": "L2", "tags": [],
  "ground_truth": {
    "fault_type": "slowSQL", "fault_group": "middleware-db",
    "root_cause_entity": "prod-checkout-db:3306", "entity_key": "checkout-db",
    "causal_chain": [...], "evidence": [...]
  },
  "expected": {}, "quality": {},
  "snapshot": {"run_id": 97, "signal_count": 15, "signals": [ ... 最多 500 条 ... ]},
  "last_run": {"verdict": "pass", "score": 1.0, "score_fault": 1.0, "score_entity": 1.0,
               "score_process": 1.0, "mode": "offline"}
}
```

这个格式是**自包含**的：拿到一个 JSON 就拿到了真值、证据和原始快照，可以在别处重放。

---

## 四、回放接口

### `POST /api/v1/replay/case/{id}`

```json
{"mode": "offline", "agent_version": "v0.3.1", "mark_status": ""}
```

| 字段 | 取值 | 说明 |
|---|---|---|
| `mode` | `offline` / `live` / `snapshot` | `offline` 用快照记录的作答；`live` 调「设置」里配置的 Agent 端点；`snapshot` 用于真值改动后重算 |
| `agent_version` | 任意字符串 | 记进历史，用来区分版本 |
| `mark_status` | 空 / `golden` / `badcase` / `candidate` | 显式指定流转；留空则按 verdict 自动判定 |

响应：

```json
{
  "case_run_id": 44, "case_id": 12, "case_key": "ci-20260924-001-012",
  "mode": "offline", "verdict": "pass",
  "score": 1.0, "score_fault": 1.0, "score_entity": 1.0, "score_process": 1.0,
  "baseline_score": 0.525, "delta": 0.475, "regression": false,
  "latency_ms": 3,
  "detail": {
    "weights": {"fault": 0.4, "entity": 0.3, "process": 0.3},
    "fault":  {"score": 1.0, "reason": "故障类型精确匹配：slowSQL"},
    "entity": {"score": 1.0, "reason": "根因实体归一化后完全一致：checkout-db"},
    "process": {
      "score": 1.0,
      "chain":    {"score": 1.0, "reason": "因果链覆盖率 100%，顺序一致"},
      "evidence": {"score": 1.0, "reason": "证据检查点命中 2/2"}
    },
    "deterministic_ratio": 1.0
  },
  "prediction": { "fault_type": "slowSQL", "entity": "checkout-db", "causal_chain": [], "evidence": [] },
  "error": "",
  "case_status": "golden"
}
```

`regression` 在 `delta < -0.05` 时为 `true`——**这是回归告警的核心信号**：新版本 Agent 在某个案例上比上一版掉分超过 5 个点。

### `POST /api/v1/replay/suite` —— 批量套件回放

```json
{"status": "golden", "mode": "offline"}
```

按状态批量跑（`golden` 跑黄金集做回归门禁，`badcase` 跑 BadCase 集看修复进展）。也可传 `case_ids: [1,2,3]` 指定集合。

---

## 五、优化接口

### `POST /api/v1/optimize/analyze`

跑聚类 + 规则引擎，生成建议（**只写库，不碰 GitHub**）。

```json
{
  "badcase_count": 3,
  "suggested": 4,
  "created": 2,
  "clusters": [
    {
      "signature": "middleware-db::fault::checkout-db",
      "fault_group": "middleware-db", "weak_dimension": "fault",
      "entity_key": "checkout-db", "avg_score": 0.335,
      "case_ids": [12, 15], "count": 2
    }
  ],
  "suggestions": [
    {
      "id": 7, "category": "fault",
      "target_path": "prompts/ops-agent.md",
      "patch": "--- a/prompts/ops-agent.md\n+++ b/prompts/ops-agent.md\n@@ ...",
      "case_ids": [12, 15], "status": "draft"
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `badcase_count` | 参与分析的 BadCase 数 |
| `clusters` | 失分簇（聚类结果）|
| `suggested` | 本轮规则引擎产出的建议总数（含被去重跳过的）|
| `created` | **实际新建**的建议数 |
| `suggestions` | 本次新建的建议对象（可直接渲染，不用再查列表）|

去重签名是 `目标文件路径::类别::关联案例ID`。重复调用 `analyze` 不会堆积重复建议；只有出现**新的 BadCase 组合**才会产生新建议——所以 `created` 为 0 是正常的幂等表现，不代表分析失败。完整建议列表请查 `GET /optimizations`。

### `GET /api/v1/optimizations?status=draft`

返回建议列表（含完整列 + 展开字段）：

```json
[
  {
    "id": 7,
    "title": "补充 middleware-db 故障类型判定表",
    "category": "fault",
    "target_type": "prompt",
    "target_path": "prompts/ops-agent.md",
    "rationale": "2 个 BadCase 在 middleware-db 族内定因失分，平均分 0.335",
    "patch": "--- a/prompts/ops-agent.md\n+++ b/prompts/ops-agent.md\n@@ ...",
    "new_content": "...",
    "case_ids": [12, 15],
    "cases": [
      {"id": 12, "case_key": "ci-20260924-001-012", "title": "...",
       "status": "badcase", "fault_type": "slowSQL"}
    ],
    "signature": "prompts/ops-agent.md::fault::12,15",
    "status": "draft",
    "evidence": {"weak_dimension": "fault", "avg_score": 0.335, "signature": "..."},
    "created_at": "2026-09-24T14:30:12", "updated_at": "2026-09-24T14:30:12"
  }
]
```

| 字段 | 说明 |
|---|---|
| `patch` | `difflib.unified_diff` 生成的统一 diff 文本（**字段名是 `patch`，不是 `diff`**）|
| `new_content` | 目标文件的完整新内容 |
| `cases` | 关联案例摘要（由 `case_ids` 展开，省去前端再查）|
| `signature` | 去重签名，从 `evidence` 中提取 |
| `category` | `fault` / `entity` / `process` / `efficiency` |
| `status` | `draft` → `approved` → `submitted`（或 `rejected`）|

### `PUT /api/v1/optimizations/{id}`

修改建议内容或状态：`{"status":"approved"}` / `{"new_content":"..."}`。

### `POST /api/v1/optimizations/{id}/submit` —— 提交到 GitHub

**唯一会写 GitHub 的操作。** 建议先 `PUT` 改成 `approved` 再提交（平台在网页上强制这一步确认）。`status='rejected'` 的建议不允许提交。

可在 body 里覆盖目标仓库：`{"owner":"...","repo":"...","base_branch":"main"}`；不传则用「设置」里的配置。

响应：

```json
{
  "branch": "harness/opt-7-20260924T143012",
  "base": "main",
  "pr_number": 8,
  "pr_url": "https://github.com/tachikomaver2-ship-it/vibecoding/pull/8",
  "files": [
    {"path": "prompts/ops-agent.md",
     "commit": "a1b2c3...", "html_url": "https://github.com/.../blob/harness/opt-7-.../prompts/ops-agent.md"},
    {"path": "harness/optimizations/7-middleware-db-fault.md", "commit": "...", "html_url": "..."},
    {"path": "harness/cases/ci-20260924-001-012.json", "commit": "...", "html_url": "..."}
  ]
}
```

提交成功后，`optimizations` 行会回写 `status='submitted'`、`gh_branch`、`gh_commit`、`gh_pr`。

---

## 六、监控与告警接口

监控的对象是**被测 Agent 这个系统本身**（它最近健不健康），不是案例的作答质量（那叫测评）。评估完全确定性：同一份数据、同一个窗口，任何时候结果一致，可直接用于 CI 门禁。

### `GET /api/v1/alerts?window_hours=24`

评估全部规则。`window_hours` 支持 `(0, 2160]`（90 天）。

```json
{
  "evaluated_at": "2026-09-24T16:05:00",
  "window_hours": 24,
  "since": "2026-09-23T16:05:00",
  "summary": { "critical": 2, "warning": 5, "info": 1, "total": 8, "open": 8, "acknowledged": 0 },
  "metrics": {
    "runs": 94, "success_rate": 0.5106, "error_rate": 0.383,
    "p95_duration_ms": 640000, "max_tool_calls": 33, "max_tokens_out": 161100,
    "cost_usd": 20.672, "replays": 10, "replay_pass_rate": 0.6,
    "new_badcase": 2, "silent_agents": 1
  },
  "alerts": [
    {
      "rule_key": "success_rate_drop", "severity": "critical",
      "metric": "success_rate", "unit": "ratio", "op": "lt",
      "current": 0.5106, "threshold": 0.6,
      "current_text": "51.1%", "threshold_text": "60.0%",
      "compare_zh": "低于", "compare_en": "below",
      "name_zh": "成功率跌破下限", "name_en": "Success rate below floor",
      "desc_zh": "…", "desc_en": "…", "hint_zh": "…", "hint_en": "…",
      "sample": 94,
      "refs": [ { "id": 31, "external_run_id": "run-20260924-01", "status": "failed" } ],
      "signature": "success_rate=0.511",
      "acknowledged": false, "overridden": false, "default_threshold": 0.6
    }
  ],
  "skipped_rules": [
    { "rule_key": "replay_pass_drop", "reason": "insufficient_samples", "sample": 0, "min_samples": 2 }
  ],
  "agent_health": [
    { "agent": "ops-agent", "status": "degraded", "runs_in_window": 94, "total_runs": 94,
      "success_rate": 0.5106, "avg_duration_ms": 320851, "max_tool_calls": 33,
      "cost_usd": 20.672, "last_seen": "2026-09-24T15:40:00", "silent": false }
  ],
  "rules": [ { "key": "cost_budget", "threshold": 5.0, "default_threshold": 5.0,
               "severity": "warning", "enabled": true, "overridden": false, "…": "…" } ]
}
```

要点：

- **refs** 指向具体运行或具体案例，可直接下钻，不给孤零零一个数字。
- **signature** 是「规则 + 量化后的指标值」。确认时按它记录，指标一变就重新告警；量化精度按量纲取（比率 0.1%、金额到分、耗时到秒），避免数值微抖动反复打扰。
- **skipped_rules** 让你看见「样本不足被跳过」的规则——是跳过，不是通过。
- **agent_health** 的状态机：窗口内有上报且成功率 ≥ 0.6 → `healthy`；有上报但成功率 < 0.6 → `degraded`；一条都没有 → `silent`。

### `GET /api/v1/alerts/rules` / `PUT /api/v1/alerts/rules`

读取与覆盖规则。**只有 `enabled` / `threshold` / `severity` 三个字段可覆盖**，规则语义（指标、比较符）不可改，避免出现无法解释的状态。

```json
PUT /api/v1/alerts/rules
{ "rules": { "cost_budget": { "threshold": 20, "severity": "info" } } }
```

把 `threshold` 设回默认值会自动清掉覆盖标记；`enabled: false` 停用规则。每次改动写审计日志。

### `POST /api/v1/alerts/{rule_key}/ack` / `DELETE /api/v1/alerts/{rule_key}/ack`

```json
POST /api/v1/alerts/cost_budget/ack
{ "signature": "cost_usd=20.67", "note": "已知悉，压测导致" }
```

`signature` 必填——防止把「已经变化了的告警」误确认掉。`DELETE` 会清掉该规则的全部确认记录。

### 内置 10 条规则

| 规则 | 指标 | 触发 | 默认阈值 | 严重度 | 样本下限 |
|---|---|---|---|---|---|
| `success_rate_drop` | `success_rate` | 低于 | 60% | critical | 3 |
| `error_spike` | `error_rate` | 高于 | 30% | critical | 3 |
| `replay_pass_drop` | `replay_pass_rate` | 低于 | 60% | critical | 2 |
| `latency_spike` | `p95_duration_ms` | 高于 | 600s | warning | 3 |
| `tool_call_runaway` | `max_tool_calls` | 不低于 | 20 | warning | 1 |
| `token_runaway` | `max_tokens_out` | 不低于 | 100,000 | warning | 1 |
| `cost_budget` | `cost_usd` | 高于 | $5.00 | warning | 1 |
| `new_badcase` | `new_badcase` | 不低于 | 1 | warning | 1 |
| `agent_silent` | `silent_agents` | 不低于 | 1 | info | 1 |
| `no_data` | `runs` | 低于 | 1 | info | 0 |

> 注意：告警只在**打开页面或调用接口时**计算，没有后台常驻调度器，暂无邮件 / IM 推送。接 CI 请定时拉 `GET /alerts` 并按 `summary.open` 判断。

---

## 七、统计与查询

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/stats/overview` | KPI：运行数、通过率、黄金数、BadCase 数、平均耗时、总成本 |
| `GET` | `/stats/trend?days=14` | 按天的运行量 / 通过率 / 平均分趋势 |
| `GET` | `/stats/faults` | 故障类型与故障族分布 |
| `GET` | `/stats/dimensions` | 三维雷达（定因 / 定界 / 过程平均分）|
| `GET` | `/runs?limit=50&agent=&status=` | 运行列表 |
| `GET` | `/runs/{id}` | 运行详情（含 spans 瀑布 + signals 时间线）|
| `GET` | `/agents` | Agent 列表 |
| `GET` | `/entities` | 实体目录 |
| `POST` | `/entities` | 登记实体（`{"entity_key":"cart-db","entity_type":"middleware","parent_key":"cart-service"}`）|
| `GET` | `/entities/topology` | 拓扑边（力导向图数据）|
| `GET` | `/taxonomy` | 故障词表（6 族 27 类 + 别名）|
| `GET` | `/audit?limit=100` | 审计日志 |
| `GET` | `/health` | 健康检查（无需鉴权）|

---

## 八、设置接口

### `GET /api/v1/settings`

敏感字段返回**脱敏值**（`gho_****…`）。

```json
{
  "github_token": "gho_****…", "github_owner": "tachikomaver2-ship-it",
  "github_repo": "vibecoding", "github_base_branch": "main",
  "agent_endpoint": "", "agent_token": "", "default_agent": "ops-agent",
  "pass_threshold": "0.75", "collection": "default"
}
```

### `PUT /api/v1/settings`

```json
{"github_token": "gho_real_token", "github_owner": "...", "github_repo": "...",
 "github_base_branch": "main", "agent_endpoint": "http://127.0.0.1:8899/diagnose"}
```

**脱敏值保护**：如果提交的值里含 `…`（即前端没改、把掩码原样传回），后端会**跳过写入**，避免把 `gho_****…` 存成真 Token。

### `POST /api/v1/github/verify`

验证 Token + 仓库可访问：

```json
{"login":"tachikomaver2-ship-it","repo":"tachikomaver2-ship-it/vibecoding",
 "default_branch":"main","private":false,"permissions":{"admin":true,"push":true,"pull":true}}
```

---

## 九、Python SDK

```bash
pip install -e ./sdk      # 零第三方依赖
```

```python
from harness import Harness

h = Harness(endpoint="http://127.0.0.1:8848", token="hnx_xxx",
            agent="ops-agent", agent_version="v0.3.0", env="prod")

# ── 录制一次运行 ──────────────────────────────────────
with h.run(task="checkout P99 飙升", external_run_id="ci-001") as rec:
    rec.alert("【P1】P99 > 3s", entity="prod-checkout-service-7d9f-x2k4")
    rec.metric("prod-checkout-db:3306", "p99_latency_ms", 3800, severity="critical")
    rec.log("PROD/checkout-db", "[ERROR] slow query 3721ms", severity="error")
    rec.trace("slow-sql-found", entity="checkout-db")
    rec.event("K8s: 无重启，排除 Pod 生命周期问题")
    rec.topology("checkout-service → checkout-db → mysql-orders-0")

    with rec.span("query-metrics", kind="tool", entity="checkout-db"):
        ...                                   # 自动计时
    rec.tool_call("kubectl_get_events", ok=True)
    rec.usage(tokens_in=8420, tokens_out=1160, cost_usd=0.0421)

    rec.answer(fault_type="slowSQL", entity="checkout-db",
               causal_chain=["缺索引", "慢查询", "连接打满", "P99 飙升"],
               evidence=[{"name": "慢查询日志", "value": "3721ms"}])

print(rec.result)          # {"run_id": 97, "status": "failed", ...}

# ── 便捷代理 ──────────────────────────────────────────
case = h.create_case(97, title="checkout P99 飙升", difficulty="L2")
rp   = h.replay(case["id"], mode="offline")
res  = h.analyze()
print(h.stats())
```

### `RunRecorder` 方法表

| 方法 | 说明 |
|---|---|
| `alert(text, entity, severity="critical")` | 入口告警 |
| `metric(entity, name, value, severity="info")` | 指标 |
| `log(entity, text, severity="info")` | 日志 |
| `trace(step, entity="", severity="info")` | 因果链步骤（会成为 `causal_chain` 的推断来源）|
| `event(text, entity)` | K8s 事件等 |
| `topology(text, entity)` | 拓扑描述 |
| `span(name, kind="step", entity="", **attrs)` | 上下文管理器，自动计时 |
| `tool_call(name, entity="", ok=True, **attrs)` | 工具调用记录 |
| `usage(tokens_in, tokens_out, cost_usd)` | 资源消耗 |
| `answer(fault_type, entity, causal_chain, evidence, **extra)` | 最终作答（offline 回放直接用它）|
| `fail(error_type, message)` | 标记运行失败 |
| `partial(error_type, message)` | 标记部分完成 |
| `bundle()` / `flush()` | 取包 / 上报 |

### `HarnessClient` 方法表

`health()` `me()` `whoami()` `report_run(bundle)` `report_batch(runs)` `create_case(run_id, **kw)` `list_cases(status)` `get_case(id)` `update_case(id, **kw)` `replay(id, mode=...)` `replay_suite(status, mode)` `analyze()` `optimizations(status)` `submit_optimization(id)` `stats()`

出错统一抛 `HarnessError`。

---

## 十、命令行

```bash
harness login    --endpoint http://127.0.0.1:8848 --token hnx_xxx
harness status
harness record   --task "跑诊断脚本" --agent ops-agent -- python3 my_agent.py
harness report   --file bundle.json
harness snapshot --dir ./snapshots --glob '*.jsonl' --task "..." --error-type slowSQL
harness case     create|list|show|promote  [--run-id N] [--case-id N] [--status golden]
harness replay   --case-id 12 --mode offline
harness replay   --suite golden --mode live
harness analyze  --verbose
harness submit   --id 7
harness demo     --agent ops-agent
```

`--endpoint` / `--token` 在**任何位置**都可用（前置或跟在子命令后），也可用环境变量 `HARNESS_ENDPOINT` / `HARNESS_TOKEN`，或配置文件 `~/.agentloop-harness.json`。

### `snapshot` 的文件名约定

文件名第一段决定模态：

```
snapshots/
├── metrics.jsonl   →  modality = metric
├── logs.jsonl      →  modality = log
├── traces.jsonl    →  modality = trace
├── events.jsonl    →  modality = event
├── alerts.jsonl    →  modality = alert
└── topology.jsonl  →  modality = topology
```

每行一个 JSON 对象，字段名与 `signals` 一致（`entity` / `name` / `value` / `text` / `severity` / `ts_ms`）。解析失败的行走降级路径，整行内容存进 `text`，**不会丢弃数据**。

参考 `examples/snapshot/` 可直接跑通：

```bash
harness snapshot --dir examples/snapshot --task "checkout P99 飙升" --error-type slowSQL
```
