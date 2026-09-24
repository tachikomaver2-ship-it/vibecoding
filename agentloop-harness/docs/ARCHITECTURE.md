# 架构说明

## 一、总体形状

平台是**单进程单体**：一个 FastAPI 应用，同时提供 REST API、静态控制台，并把所有状态放在一个 SQLite 文件里。

```
                        ┌───────────────────────────────┐
   浏览器控制台  ─────▶ │  FastAPI (uvicorn)            │
   (web/ 原生 SPA)      │                               │
                        │  /api/v1/*   41 个路由         │
   本地上报 SDK  ─────▶ │  /           StaticFiles(web) │
   (sdk/harness)        │  /api/docs   OpenAPI 文档      │
                        │                               │
   任意 HTTP 客户端 ──▶ │  lifespan → store.init_db()   │
                        └───────────┬───────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
  data/harness.db            GitHub REST API            被测 Agent 端点
  (唯一有状态依赖)            (仅在提交建议时触达)          (仅在 live 回放时触达)
```

**关键取舍**：数据库选 SQLite 而不是 Postgres，是为了让"拷走一个文件 = 完成迁移/备份/分发"成立。评测平台的数据量级（万级运行、千级案例）远未到 SQLite 的瓶颈，但"能一条命令跑起来"的价值极高。

## 二、分层

```
backend/app/
├── api.py            ← 传输层：路由、鉴权依赖、参数校验、HTTP 错误映射
├── ingest.py         ← 领域层：快照摄入、四层真值初稿抽取   【不 import fastapi】
├── scoring.py        ← 领域层：归一化、打分、门禁           【纯函数，无 IO】
├── graph.py          ← 领域层：实体图、拓扑、聚类
├── replay.py         ← 领域层：回放编排（唯一会调外部 HTTP 的地方）
├── optimizer.py      ← 领域层：规则引擎 → diff 补丁
├── github_client.py  ← 基础设施：GitHub REST 封装
├── security.py       ← 基础设施：口令哈希、会话签名、Token、本地加密
├── store.py          ← 基础设施：SQLite 连接与 schema
└── seed.py           ← 演示数据
```

**为什么要把 `ingest` 从 `api` 里抽出来？** 因为初期 `ingest` 逻辑写在 `api.py` 里，导致 `scripts/selfcheck.py` 必须先把 fastapi 装好才能跑。抽出来后，自检脚本只 import `store / scoring / ingest / seed / replay / optimizer`，**在零 Web 依赖的环境里也能跑完 35 项断言**——打分器的正确性不该被 Web 框架绑架。

分层纪律：

- `api.py` 里**不允许**出现业务判断逻辑，只做"取参数 → 调领域函数 → 包装 HTTP 响应"。
- `scoring.py` **不允许**有 IO，是纯函数集合（这也是它能被离线穷举测试的前提）。
- `replay.py` 是唯一会发外部 HTTP 请求的领域模块（live 回放）。

## 三、数据模型（13 张表）

### 快照层 —— 原样存下来

| 表 | 关键字段 | 说明 |
|---|---|---|
| `runs` | `external_run_id`, `agent_id`, `task`, `status`, `env`, `model`, `agent_version`, `duration_ms`, `tokens_in/out`, `cost_usd`, `tool_calls`, `steps`, `error_type`, `snapshot_json`, `meta_json` | 一次 Agent 执行。`external_run_id` 由上报方生成，用来幂等 upsert |
| `spans` | `run_id`, `name`, `kind`, `entity_key`, `start_ms`, `duration_ms`, `status`, `attrs_json` | 调用树节点，用来画瀑布图 |
| `signals` | `run_id`, `modality`, `entity_key`, `entity_type`, `name`, `ts_ms`, `value`, `text`, `severity`, `payload_json` | **统一信号表**：metric/log/trace/event/alert/topology 都进这张表，用 `modality` 区分 |

**为什么把 7 种模态塞进一张表？** 因为它们的使用方式高度一致：按时间排序、按实体过滤、按严重度聚合。分成 7 张表会让每个统计查询都变成 union，得不偿失。真正需要区分的是 `modality` 字段，而不是物理表。

`signals` 重建策略：每次上报同一 `external_run_id`，会**先删后插**该 run 的 spans / signals。这样重复上报不会产生重复信号，实现真正的幂等。

### 语义层 —— 让数据变得可推理

| 表 | 关键字段 | 说明 |
|---|---|---|
| `agents` | `user_id`, `name`, `agent_type`, `version`, `framework`, `meta_json` | 被测 Agent 登记 |
| `entities` | `user_id`, `entity_key`, `entity_type`, `parent_key`, `labels_json` | 统一实体模型（UModel 思路）。`parent_key` 是显式拓扑边 |

实体图 `graph.load_edges()` 同时使用两个来源：

1. `entities.parent_key` —— 人工/自动登记的显式父子关系
2. **同一 run 内的信号共现** —— 如果 `checkout-service` 和 `checkout-db` 总在同一次运行里被观测到，它们之间就有一条边

第二条是自动发现拓扑的关键：**不需要你先把拓扑图画全，平台从数据里自己长出边来**。

### 评测层 —— 案例与历史

| 表 | 关键字段 | 说明 |
|---|---|---|
| `cases` | `case_key`, `title`, `source_run_id`, `status`, `difficulty`, `fault_type`, `fault_group`, `root_cause_entity`, `entity_key`, `expected_json`, `causal_chain_json`, `evidence_json`, `replay_json`, `quality_json` | 四层真值 + 状态机 + 门禁结果 |
| `case_runs` | `case_id`, `mode`, `agent_version`, `verdict`, `score`, `score_fault/entity/process`, `baseline_score`, `detail_json`, `transcript_json`, `latency_ms` | 每次回放一条历史，`baseline_score` 记录当时的上一条分数，用来算 delta |
| `optimizations` | `category`, `target_path`, `old_content`, `new_content`, `diff`, `case_ids_json`, `status`, `pr_url` | 优化建议 + 目标文件的旧/新内容 + diff + 关联案例 |

### 支撑层

| 表 | 说明 |
|---|---|
| `users` | PBKDF2-SHA256（12 万轮）口令哈希 |
| `api_tokens` | `hnx_` 前缀 Token，存哈希，可吊销 |
| `settings` | 每用户键值对。GitHub / Agent 端点 / 阈值 / **`file:<path>`（保存优化建议生成前的文件版本快照）** |
| `audit_log` | 所有写操作的审计流水 |

`settings.file:<path>` 这个约定值得单独说：优化器生成建议时需要"目标文件的旧内容"来做 diff，但那个文件在 GitHub 上、不在本地。于是每次生成建议时把读到的内容按 `file:<path>` 存进 settings，下次同一文件再出建议时就有旧版本可比。**用一张已有的键值表，换掉了引入一个文件版本管理子系统。**

## 四、一次上报的完整链路

```
POST /api/v1/ingest/run
  │
  ├─ current_user(request)               ← Bearer JWT-ish 或 X-Api-Token
  │
  ├─ ingest.ingest_run(user_id, bundle)
  │    ├─ 校验 run.external_run_id 非空（否则 400）
  │    ├─ upsert_agent()                  ← 按 name 找，有则更新 meta
  │    ├─ 按 (user_id, external_run_id) 找 run
  │    │    ├─ 存在 → UPDATE runs，DELETE 该 run 的 spans/signals
  │    │    └─ 不存在 → INSERT runs
  │    ├─ 批量 INSERT spans
  │    └─ 批量 INSERT signals
  │
  └─ 返回 {run_id, external_run_id, spans, signals, updated}
```

注意 `api.py` 里对这层做了薄封装：

```python
def _ingest_or_400(user_id: int, bundle: dict) -> dict:
    try:
        return ingest_run(user_id, bundle)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
```

领域层抛 `ValueError` 表达"数据不合法"，传输层负责翻译成 HTTP 400。领域层不需要知道 HTTP 的存在。

## 五、一次回放的完整链路

```
POST /api/v1/replay/case/{id}  {mode: offline|live|snapshot}
  │
  ├─ 取案例
  ├─ 按 source_run_id 取该 run 的所有 signals（按 ts_ms 排序）
  ├─ edges = graph.load_edges(user_id)          ← 实体拓扑
  │
  ├─ build_replay_input(case, signals)          ← 构造【被测 Agent 可见】的输入
  │    ⚠️ 严格剔除四层真值。只给：任务描述 / 告警 / 观测摘要 / 拓扑 / 输出契约
  │
  ├─ 按模式取 prediction
  │    ├─ offline  → _recorded_prediction()     快照里记录的作答
  │    ├─ snapshot → 同上（语义上用于真值改动后重算）
  │    └─ live     → _call_agent(endpoint, ...) POST 给被测 Agent
  │
  ├─ scoring.score_case(case, prediction, edges) → total / verdict / detail
  ├─ 查上一条 case_run 的 score 作 baseline → delta → regression(delta < -0.05)
  ├─ INSERT case_runs                            ← 历史留痕
  ├─ 状态反哺
  │    ├─ verdict == fail                      → badcase
  │    ├─ verdict == pass 且原状态 badcase/draft → golden
  │    └─ mark_status 显式指定则优先
  └─ 返回完整分数明细 + prediction + error + case_status
```

**真值隔离是硬约束**：`build_replay_input()` 只输出任务描述、告警文案、按模态分组的观测摘要（每种模态截前 200 条）、拓扑、输出契约示例。**不含** `fault_type`、`root_cause_entity`、`causal_chain`、`evidence`。如果哪天要在 live 模式里做防作弊检查，这个函数就是唯一的审计点。

## 六、BadCase 聚类

`graph.cluster_badcases()` 对 `status='badcase'` 的案例做无监督分组，分组键是三元组：

```
(fault_group, 失分维度, 共同关联实体)
```

其中**失分维度**取 `score_fault / score_entity / score_process` 三者中得分最低的那个——因为优化方向完全取决于"哪里丢分"：

- `fault` 最低 → 这是定因问题 → 该改 prompt 里的判定规则
- `entity` 最低 → 这是定界问题 → 该补实体别名表
- `process` 最低 → 这是论证问题 → 该补诊断流程

聚类结果里带 `avg_score`、`case_ids`，直接喂给优化器的四条规则。

## 七、优化器：规则引擎而非大模型

`optimizer.analyze()` 遍历聚类结果，对每个簇套用四条规则：

```python
_rule_fault_prompt()      # 定因失分 → 注入故障类型判定表到 prompts/<agent>.md
_rule_entity_mapping()    # 定界失分 → 生成 skills/<agent>/entity-aliases.yaml
_rule_skill_procedure()   # 过程失分 → 追加诊断流程章节到 skills/<agent>/SKILL.md
_rule_efficiency()        # 效率失分 → 注入防打转/上下文裁剪规则
```

每条规则产出：

```python
{
  "category": "fault",              # fault / entity / process / efficiency
  "target_path": "skills/ops-agent/SKILL.md",
  "old_content": "...",             # 从 settings["file:<path>"] 读上次版本
  "new_content": "...",
  "patch": "--- a/... \n+++ b/...",   # difflib.unified_diff（落库字段名是 patch）
  "case_ids": [3, 7],
  "signature": "path::category::case_ids",
  "status": "draft",
}
```

去重靠 `signature = path::category::case_ids`，同一目标的同类建议不会重复堆积。因此 `POST /optimize/analyze` 反复调用是**幂等**的：只有出现新的 BadCase 组合才会新增建议，响应里的 `created` 会是 0——这是正常表现，不是失败。

**为什么不用大模型生成建议？** 三个理由：

1. **可审计**：规则产出的 diff 是确定性的，工程师 review 时能一眼看出"这条建议为什么出现"。大模型产出的改动理由往往不可追溯。
2. **零成本、零延迟**：分析可以随时跑，不需要 API Key，也不受配额限制。
3. **可测试**：`selfcheck.py` 能断言"给定这组 BadCase，必须生成 4 类建议"，大模型输出无法这样断言。

代价是**建议的表达灵活性有限**。这是有意的取舍：这是一个**回归门禁**产品，稳定性优先于创造性。如果将来要加 LLM 增强，应该作为**第二组建议**并列展示，而不是替换规则引擎。

## 八、发布链路

```
POST /api/v1/optimizations/{id}/submit
  │
  ├─ 读用户配置：github_token / owner / repo / base_branch
  ├─ github_client.submit_optimization(...)
  │    ├─ ensure_branch("harness/opt-<id>-<ts>", from=base_branch)
  │    │    ├─ 分支已存在 → 直接复用
  │    │    └─ 不存在     → 读 base 分支的 ref SHA → POST /git/refs 建分支
  │    ├─ 提交 ① 目标文件（skill / prompt / aliases）
  │    │        ② harness/optimizations/<slug>.md  说明 + diff + 关联案例
  │    │        ③ harness/cases/<case_key>.json    案例冻结快照
  │    │     （每个文件先 GET 拿 sha，有则带 sha 更新，无则新建）
  │    └─ create_pr(head=branch, base=base_branch, title, body)
  └─ 回写 optimizations.status='submitted', pr_url
```

**三维一体的提交**：光提交改好的 skill 文件，reviewer 无法判断改动是否合理；把**说明文档**和**触发这次改动的案例快照**一起提交，PR 就成了一个自包含的证据包。reviewer 可以直接打开 `harness/cases/<key>.json` 看真值和作答，不需要回到平台查。

**强制的写屏障**：`submit` 是唯一的 GitHub 写操作入口，且**必须由用户在网页上点确认后才触发**（`status` 从 `draft` 变为 `approved` 才允许提交）。平台不会自动 push 任何东西。

## 九、安全模型

| 关注点 | 做法 |
|---|---|
| 口令 | PBKDF2-HMAC-SHA256，12 万轮，独立随机盐 |
| 会话 | HMAC-SHA256 签名的 token，7 天 TTL，密钥从环境变量/本地文件派生 |
| API Token | `hnx_` 前缀，只存哈希，可吊销，可设名称 |
| GitHub / Agent Token | 落库前异或 + base64 混淆；接口返回一律脱敏成 `gho_****…`；前端提交脱敏值时后端识别并跳过覆盖（避免把掩码写回去） |
| 越权 | 所有查询带 `user_id` 条件；`current_user()` 作为 FastAPI 依赖注入 |
| 审计 | 所有写操作写 `audit_log`；网页设置页可查 |

**关于本地加密的诚实说明**：`security.encrypt_local()` 是**异或 + base64**，不是真正的加密。它的目的是**避免 Token 以明文出现在 DB 文件和日志里**，而不是抵御能读到 DB 文件本身的攻击者——能做到后者的人本来也能读到密钥。**生产环境的正确做法是把密钥放到独立的密钥管理服务里**，当前实现是"单机自托管、可接受风险"的取舍，代码里已如此注释。

## 十、前端

`web/` 是一个**零构建**的原生 SPA：

- `index.html` —— 登录视图 + 侧边栏骨架 + 容器 + toast + modal
- `app.js` —— 992 行，`router()` 维护 9 个页面，每个 `page*()` 函数渲染并挂 ECharts
- `styles.css` —— 扁平浅色主题、KPI 卡、表格、chip/badge、分数胶囊、瀑布图

**为什么不用 React/Vue？** 评测平台的特点是**页面多、状态浅、图表多**。每次改一个统计口径，用原生 DOM 改 20 行比配 webpack 快得多。`api()` 是一个带 Bearer token 的 fetch 封装，页面切换就是 `innerHTML` 替换 + 图表重建——在这个数据量级下完全够用。

图表统一走 ECharts 5.5.1（jsdelivr CDN）。

**一个已知的"假阳性"**：如果用正则去 `index.html` 里核对 `app.js` 引用的 DOM id，会报出 50+ 个"缺失 id"。这是正常的——那些 id 由 `page*()` 渲染函数**动态注入**，不在静态 HTML 里。验证前端请用 `node --check web/app.js` 检查语法。

## 十一、测试策略

| 脚本 | 依赖 | 断言数 | 覆盖 |
|---|---|---|---|
| `scripts/selfcheck.py` | **仅标准库 + 本项目领域层** | 35 | 实体归一化、故障词表、三维打分、GSTO 门禁、摄入、seed、回放、优化器 |
| `scripts/smoke_api.py` | 需要 fastapi 起来 | 29 | 真实 HTTP 端到端全链路 |

两层测试**故意不重叠**：selfcheck 验证"算法对不对"，smoke 验证"接线通不通"。

`smoke_api.py` 有个必须注意的细节：它用

```python
urllib.request.build_opener(urllib.request.ProxyHandler({}))
```

显式**绕过系统代理**。因为开发机上常有 Docker/公司代理把 `127.0.0.1` 也代理掉，导致连本地服务都报 502。SDK 的 `client.py` 里也做了同样处理——这是踩过的坑，值得保留。

另外，`smoke_api.py` 必须在**同一次 shell 调用**里启动服务并跑测试，因为后台进程不会跨工具调用存活。

## 十二、扩展点

| 想做什么 | 改哪里 |
|---|---|
| 换存储（Postgres/MySQL） | `store.py` 是唯一 SQL 出口，替换连接与方言即可 |
| 加故障类型族 | `scoring.FAULT_GROUPS` + `FAULT_ALIASES`（注意组序参与距离计算）|
| 加信号模态 | `ingest` 里透传即可（`signals.modality` 是自由字符串）；若参与门禁需改 `quality_gate` |
| 加优化规则 | `optimizer.py` 加一个 `_rule_*` 并在 `analyze()` 里注册 |
| 对接别的代码托管 | 抽一个与 `github_client` 同签名的模块，在 `api.py` 里切换 |
| 加 LLM 主观维度 | `scoring.score_case` 增加可选维度，并在结果里通过 `deterministic_ratio` 标注软硬比例 |
