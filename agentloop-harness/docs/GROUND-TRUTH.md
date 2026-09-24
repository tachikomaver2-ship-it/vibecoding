# 四层真值与打分协议

这份文档定义平台的**评测语义**：什么是"对的答案"，以及"对到什么程度"。

设计目标只有一句话：**同一份作答，永远得同一个分；每一分的来历都能被逐条复算。**

## 一、为什么需要"四层"

线上故障复盘最怕两种失败：**说不清是什么病**、**指不出是谁的病**。
传统 Agent 评测常见做法是让大模型打个 1~5 分，结果是"今天说 4 分、明天说 3 分"，无法做回归门禁。

所以我们把"一次合格的诊断"拆成四层可独立校验的结构，对齐 RCA Benchmark 的 Ground Truth 设计：

| 层 | 字段 | 回答的问题 | 归属评分维度 |
|---|---|---|---|
| **L1** | `fault_type` | 是什么类型的故障？ | **定因 40%** |
| **L2** | `root_cause_entity` | 根因落在哪个实体上？ | **定界 30%** |
| **L3** | `causal_chain` | 故障是怎么一步步传开的？ | **过程 30%**（占 60%） |
| **L4** | `evidence` | 你凭什么这么说？ | **过程 30%**（占 40%） |

L1、L2 是"结论层"，错了就是错了；L3、L4 是"论证层"，用来区分**蒙对**和**真的查出来了**。

## 二、L1 故障类型：受控词表 + 语义距离

### 6 大族 27 类

故障类型不是自由文本，而是一棵**两层分类树**。这样既覆盖常见故障，又能让"差一点"和"完全错"得到不同分数。

| 族 | 类型 |
|---|---|
| `application-logic` | httpError5xx, rateLimiting, trafficSurge, trafficHotspot, nullPointerException, loadBalancerFailure, codeDefect |
| `jvm-runtime` | memoryPressure, threadExhaustion, fullGC, cpuDeadLoop |
| `middleware-db` | **slowSQL**, redisUnavailable, dbNetworkLatency, messageQueueBacklog, cacheBreakdown |
| `k8s-lifecycle` | replicaScaleDown, **podCrashLoop**, podPendingUnschedulable, podRestartFlapping, resourceLimitMisconfig, networkPolicyIsolation, dnsResolutionFailure |
| `cloud-resource` | nodeCpuHigh, nodeDown, nodeMemoryOOM, diskIOHigh |
| `resource-perf` | cpuFullLoad, memoryFullLoad, ioHigh |

### 中英别名自动归一

Agent 爱写中文，也爱写口语。`canonical_fault_type()` 会把它们映射回规范值：

```
"慢查询" / "慢SQL" / "MySQL慢查询" / "slow query"   →  slowSQL
"容器崩溃" / "CrashLoopBackOff"                    →  podCrashLoop
"OOM" / "内存打满"                                 →  memoryPressure
"限流" / "429"                                     →  rateLimiting
```

一共 60+ 条别名规则，见 `scoring.FAULT_ALIASES`。

### 得分 = 分类树上的距离

```
精确匹配                    →  1.00
同一族                      →  0.60
相邻族（按 FAULT_GROUPS 顺序）→  0.30
隔两族                      →  0.12
隔三族及以上 / 未命中        →  0.05
空作答                      →  0.00
```

**为什么同族只给 0.6？** 因为同族往往意味着"方向对、判断错"。比如把 `slowSQL` 答成 `redisUnavailable`（同属 middleware-db），方向没错，但根因实体和修复动作完全不同——0.6 让它拿不到"通过"，但比答成 `podCrashLoop`（跨 2 族，0.12）明显更好。

族顺序有意安排成**语义相邻**：`middleware-db` 夹在 `jvm-runtime` 和 `k8s-lifecycle` 之间，因为"数据库慢"经常被误判成"JVM 卡"或"Pod 有问题"，这类近邻误判值得给 0.3 的部分分。

## 三、L2 根因实体：归一化 + 拓扑距离

### 先归一化，再比对

线上实体名带一堆噪音，直接字符串比对必然误判：

```
prod-cart-service-5f7c9d-x2k4   ┐
cart_service:8080               ├─→  cart-service
PROD/cart-service               ┘
```

`normalize_entity()` 的处理管道：

1. 取路径末段（`PROD/cart-service` → `cart-service`）
2. 去端口（`:8080`、`:3306`）
3. 去环境前缀（`prod-`、`staging-`、`test-`）
4. 去 K8s Pod 随机后缀（`-5f7c9d-x2k4` 这类 5~10 位十六进制/短哈希）
5. 下划线/空格 → 连字符，转小写

### 得分 = 拓扑距离

实体不是孤立的，`graph.load_edges()` 从两个来源构图：

- **显式拓扑**：`entities.parent_key` 声明的父子关系
- **隐式共现**：同一次运行里被同时观测到的实体之间连边

于是"答错实体"也分程度：

```
归一化后完全一致           →  1.00
拓扑上距离 1 跳            →  0.75
距离 2 跳                  →  0.50
距离 3 跳                  →  0.25
距离 4 跳                  →  0.00
不连通                     →  退化为字符串相似度，上限 0.45
```

**为什么"不连通就用相似度、还封顶 0.45"？** 因为不连通意味着这个实体可能压根不在当前拓扑里。给个相似度是容忍拼写差异（`checkout-db` vs `checkoutdb`），但封顶 0.45 是为了保证它**永远拿不到及格分**——定界错了就是错了。

`SequenceMatcher` 相似度上限 0.45 这条规则，配合权重 30%，意味着**只要定界彻底跑偏，综合分就不可能达到 0.75 通过线**。这是有意为之的硬约束。

### 别名表可被优化器修正

如果某个 Agent 反复把 `cart-db` 写成 `cart_service_db`，优化器会生成 `skills/<agent>/entity-aliases.yaml` 并在打分时通过 `entity_alias_lookup()` 优先查表。也就是说：**优化建议能直接改善分数**，形成闭环。

## 四、L3 因果链：LCS 覆盖率 + 顺序惩罚

因果链是一个**有序**步骤列表。评分用最长公共子序列（LCS）：

```
覆盖率 = LCS(期望链, 实际链).length / len(期望链)
顺序惩罚 = 若实际链中公共步骤的相对顺序与期望链不一致 → 覆盖率 × 0.7
```

步骤比对前会先 `_norm_step()` 归一化（去空白、转小写、统一分隔符），避免 `"db-query-time-up"` 和 `"DB Query Time Up"` 被判成两个不同步骤。

举例：

| 期望链 | 实际链 | 覆盖率 | 顺序 | 得分 |
|---|---|---|---|---|
| A B C D | A B C D | 1.00 | 一致 | **1.00** |
| A B C D | A B D | 0.75 | 一致 | **0.75** |
| A B C D | D C B A | 1.00 | 错乱 | **0.70** |
| A B C D | X Y | 0.00 | — | **0.00** |

注意第三行：**全说对了但顺序说反**，仍然只有 0.70。因为"因果链"的核心价值就在于**传播方向**——把因果讲反和没讲出来，对定位问题的帮助是两回事。

## 五、L4 证据检查点：三种命中规则

真值里的每条证据检查点长这样：

```json
{
  "name": "checkout-db 慢查询日志",
  "entity": "checkout-db",
  "metric": "p99_latency_ms",
  "keywords": ["union", "orders", "lock wait"]
}
```

判定命中采用**三条规则取"或"**（早期版本是"且"，导致真命中被判漏，已修正）：

1. **关键词命中**：作答文本里出现任一 `keywords`
2. **实体 + 指标命中**：作答里同时提到该 `entity` 和 `metric`
3. **空检查点视为命中**：真值没给判定条件时，不惩罚作答

`evidence_score = 命中数 / 检查点总数`。

**为什么改成"或"？** 因为"证据"的表达方式天然多样。Agent 可能引用日志原文（命中关键词），也可能引用指标（命中实体+指标）。要求两者同时满足，会把大量**真实有效的举证**判为无效，进而把好案例误判成 BadCase，污染后续优化器的输入。宁可放宽，也不能让假阴性顺着流水线放大。

## 六、综合分与判定

```
process  = causal_chain_score × 0.6 + evidence_score × 0.4
total    = fault × 0.40 + entity × 0.30 + process × 0.30

verdict:
  total ≥ 0.75  →  pass     （通过；回放通过则案例转为「黄金」）
  total ≥ 0.50  →  partial  （部分正确；保留为「候选」）
  total <  0.50 →  fail     （失败；回放失败则案例转为「BadCase」）
```

权重 40/30/30 的取舍：

- **定因最重（40%）**：故障类型错了，修复方案必然错，这是最致命的。
- **定界次重（30%）**：实体错了意味着工程师被指到错误的机器前，代价高但比定因错稍微可挽回。
- **过程合计 30%**：保证"过程正确"不能替代"结论正确"——一个把因果链背得滚瓜烂熟但结论答错的 Agent，不该通过评测。

### deterministic_ratio

每次评分结果都返回这个字段，表示分数中来自确定性计算的比例。当前实现下**全部为 1.0**（无大模型参与）。保留这个字段是为了将来如果要引入可选的主观维度（如"解释可读性"），能明确标出哪部分是硬规则、哪部分是软判断。

## 七、GSTO 四层准入门禁

一条案例即使创建了，也**未必有资格进黄金集**。创建时立刻跑四层校验：

| 层 | 检查 | 通过条件 | 不过意味着 |
|---|---|---|---|
| **S**tructure | 结构规范 | 有标题 + 故障类型能规范到受控词表 + 根因实体能归一化 | 真值本身残缺，无法评分 |
| **S**ignal | 信号有效性 | 至少覆盖 `metric/log/trace` 三模态且 ≥5 条信号 | 观测数据不足以支撑诊断，案例"没法考" |
| **T**imeWindow | 时间窗口 | 有 `ts_ms` 且跨度 ≤ 6 小时 | 信号散落在过长时间里，可能混入多次故障 |
| **O**penness | 开放适配性 | 根因实体已登记在统一实体模型（entity catalog） | 无法计算拓扑距离，定界分不可信 |

`passed = 四层全过`，同时返回 `score = 通过层数 / 4` 作为"完整度"参考。

**门禁与状态机的关系**：案例创建时状态是 `draft` / `candidate`。只有 **门禁全过 + 回放 verdict 为 pass**，才会被提升为 `golden`；**门禁不过或回放 fail** 则落到 `badcase`。

```
            ┌──────────┐
 创建案例 → │ candidate│
            └────┬─────┘
      回放 pass  │  回放 fail
      ┌──────────┴──────────┐
      ▼                     ▼
 ┌─────────┐          ┌──────────┐
 │ golden  │          │ badcase  │ ← 优化器的输入
 └─────────┘          └──────────┘
```

这个状态机是**双向**的：被优化过的 Agent 重新回放通过后，BadCase 会自动升级为黄金案例。**BadCase 池子会随着 Agent 变好而萎缩**，这本身就是进度指标。

## 八、一条完整案例的生命周期

```
① 线上故障发生
      │  SDK / snapshot / HTTP 上报
      ▼
② runs + spans + signals 入库          （raw 快照，可追溯）
      │  POST /cases {source_run_id}
      ▼
③ auto_fill_from_run() 抽真值初稿       （降低标注成本：故障类型取 error_type →
                                         若空则扫信号名；根因实体取首个 critical 信号；
                                         因果链取信号名前 8 条；证据取 error/warn 信号）
      │  人工复核修正                       ⚠️ 初稿不是真值，必须复核
      ▼
④ GSTO 四层门禁 → quality_json          （不过门禁的进不了黄金集）
      │  POST /replay/case/{id}
      ▼
⑤ 回放（offline / live / snapshot）
      │  打分 → case_runs 落历史 → 基线 delta → 自动流转状态
      ▼
⑥ BadCase 聚类 + 规则引擎出建议
      │  人工在网页 review diff 并确认
      ▼
⑦ GitHub 建分支 + 提交 patch + 开 PR
      │  合并 → 新版本 Agent → 回到 ⑤ 重新回放
      ▼
   （循环，BadCase 池逐轮收敛）
```

## 九、想扩展的话

- **加故障类型**：改 `FAULT_GROUPS`（注意：组间顺序参与距离计算，插入位置要慎重）+ `FAULT_ALIASES`。
- **改权重**：`scoring.WEIGHTS`，但请同步更新本文档与 README 的权重表。
- **换判定阈值**：设置页可改 `pass_threshold`（默认 0.75）。
- **加检查点类型**：扩展 `evidence_score()` 的命中规则，务必保持"或"语义，避免假阴性。
