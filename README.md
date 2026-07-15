# Agent Eval — SRE Agent 评测系统

开源 Agent 任务评测系统，参考 Langfuse 架构设计，实现面向 SRE Agent 的 **6 维度 23 项度量指标**评估框架。支持多层级自愈事件追踪、Benchmark 用例管理、三级 Grader 引擎评分以及 Pass@k / Pass^k 试验评估。

## 核心特性

- **6 维度 23 项度量指标** — 覆盖 Outcome / Process / Efficiency / Security / Learning / Business 六大评估维度
- **三级 Grader 引擎** — L1 代码检测（Schema/Health 校验）、L2 模型评测（步骤评分 + 路径相似度）、L3 人工审核（GSB 评分）
- **197 字段评测宽表** — 完整数据模型，从错误分类到业务影响全链路覆盖
- **Pass@k / Pass^k 试验评估** — 统计显著性检验，量化 Agent 版本迭代效果
- **实时监控大盘** — 自愈成功率、MTTD、MTTR、Token 消耗、成本趋势一目了然
- **Benchmark 用例管理** — 多层级（L1-L5）标准测试集，支持历史、手工、Runbook 注入等多种来源
- **Runbook 知识库** — 自愈 Runbook 管理、使用追踪、质量评分
- **Doom-Loop 检测** — 死循环识别与 Rescue Agent 自动干预
- **日报 / 周报** — 定时生成评测报告，推送到 IM 渠道

## 技术架构

```
┌──────────────────────────────────────────────┐
│              Frontend (Next.js 14)            │
│   Tailwind CSS + Recharts + lucide-react      │
├──────────────────────────────────────────────┤
│           API Routes (Next.js)                │
│          Prisma ORM (TypeScript)              │
├──────────────┬───────────────────────────────┤
│  PostgreSQL  │      Redis (optional)          │
│    (数据层)   │      (缓存 / 限流)             │
└──────────────┴───────────────────────────────┘
```

| 层级     | 技术选型                        |
|----------|-------------------------------|
| 前端     | Next.js 14 + Tailwind CSS + Recharts |
| 后端     | Next.js API Routes + Prisma ORM |
| 数据库   | PostgreSQL 16                  |
| 缓存     | Redis 7（可选）                 |
| 运行时   | Node.js 20+ / TypeScript 5     |

## 快速开始

```bash
# 1. 克隆项目并安装依赖
git clone <repo-url> && cd agent-eval
npm install

# 2. 启动数据库（PostgreSQL + Redis）
docker compose up -d

# 3. 推送数据库 Schema 并导入种子数据
npm run db:push
npm run db:seed

# 4. 启动开发服务器
npm run dev
```

启动后访问 [http://localhost:3000](http://localhost:3000) 即可进入评测大盘。

### 数据库管理

```bash
# 打开 Prisma Studio 可视化编辑数据
npm run db:studio

# 重新生成 Prisma Client
npm run db:generate

# 重置种子数据
npm run db:seed
```

## 项目结构

```
agent-eval/
├── prisma/
│   ├── schema.prisma      # 数据模型定义（197字段宽表）
│   └── seed.ts            # 种子数据脚本
├── src/
│   ├── app/
│   │   ├── layout.tsx     # 全局布局（暗色主题）
│   │   ├── page.tsx       # 首页（重定向到 Dashboard）
│   │   ├── dashboard/     # 实时监控大盘
│   │   ├── api/           # API 路由
│   │   └── globals.css    # 全局样式
│   └── lib/               # 工具函数与共享模块
├── docker-compose.yml     # PostgreSQL + Redis 本地环境
├── package.json           # 依赖与脚本
├── tsconfig.json          # TypeScript 配置
└── next.config.ts         # Next.js 配置
```

## 度量指标体系

### Outcome（结果维度）

| 指标               | 公式 / 说明                                    |
|--------------------|----------------------------------------------|
| 自愈成功率          | SUCCESS events / total events                 |
| 部分成功率          | PARTIAL events / total events                 |
| 验证通过率          | (schemaPassed AND healthPassed AND businessPassed) / verified |
| 回滚率             | rollbackTriggered / total events              |
| 新增告警数          | SUM(newAlertsAfter) per event                 |

### Process（过程维度）

| 指标               | 公式 / 说明                                    |
|--------------------|----------------------------------------------|
| 步骤准确率          | correctSteps / totalSteps                     |
| 步骤效率比          | optimalSteps / totalSteps                     |
| 路径相似度          | cosine_similarity(actual_path, optimal_path)   |
| Doom-Loop 触发率   | doomLoopTriggered / total events              |
| Rescue Agent 成功率 | rescueAgentSuccess / rescueAgentTriggered      |

### Efficiency（效率维度）

| 指标               | 公式 / 说明                                    |
|--------------------|----------------------------------------------|
| MTTD（平均检测时间） | AVG(detectedAt - errorOccurredAt)              |
| MTTR（平均恢复时间） | AVG(recoveredAt - errorOccurredAt)             |
| Token 效率         | correctSteps / (totalTokens / 1000)            |
| 单次成本           | totalCostUsd per event                         |
| LLM 调用次数       | llmCallCount per event                         |

### Security（安全维度）

| 指标               | 公式 / 说明                                    |
|--------------------|----------------------------------------------|
| 审批通过率          | approved / approvalRequired                    |
| 快照恢复率          | snapshotRestored / total events                |
| SLA 违约率         | slaBreach / P0 events                          |

### Learning（学习维度）

| 指标               | 公式 / 说明                                    |
|--------------------|----------------------------------------------|
| 经验记录率          | experienceRecorded / eligible events            |
| Runbook 命中率     | runbookHit / total events                      |
| Runbook 成功率     | AVG(runbookSuccessRate) where runbookHit       |
| Reflexion 回顾率   | reflexionReviewed / total events               |

### Business（业务维度）

| 指标               | 公式 / 说明                                    |
|--------------------|----------------------------------------------|
| 用户可见影响率       | userVisibleImpact / total events               |
| 人工升级率          | escalatedToHuman / total events                |
| 影响用户数          | SUM(affectedUsers) per severity                |

## 错误层级分类（L1-L5）

| 层级 | 名称        | 典型场景                         | 检测目标 MTTD | 恢复目标 MTTR |
|------|-------------|--------------------------------|-------------|-------------|
| L1   | Sandbox     | 容器 OOMKilled、CrashLoop       | < 5s        | < 120s      |
| L2   | Model GW    | 429 限流、504 超时、模型降级      | < 30s       | < 120s      |
| L3   | MCP Tools   | 工具连接失败、超时、Schema 不匹配  | < 30s       | < 180s      |
| L4   | Platform    | JVM OOM、GC 停顿、连接池耗尽     | < 60s       | < 300s      |
| L5   | Skill       | 版本回归、部署失败、配置漂移       | < 120s      | < 600s      |

## API 参考

| 端点                          | 方法   | 说明                 |
|-------------------------------|--------|--------------------|
| `/api/healing-events`         | GET    | 查询自愈事件列表      |
| `/api/healing-events/:id`     | GET    | 查询单个事件详情      |
| `/api/dashboard/stats`        | GET    | 获取大盘统计数据      |
| `/api/dashboard/timeseries`   | GET    | 获取时序趋势数据      |
| `/api/benchmarks`             | GET    | 查询 Benchmark 用例  |
| `/api/runbooks`               | GET    | 查询 Runbook 知识库  |
| `/api/trials`                 | GET    | 查询试验组结果       |
| `/api/grader-scores`          | GET    | 查询 Grader 评分    |

## 数据模型

系统核心数据模型 `HealingEvent` 包含 197 个字段，覆盖以下维度：

- **错误分类**（L1-L5 层级、类型、严重级别、因果链）
- **检测与诊断**（MTTD、检测源、Runbook 匹配、根因置信度）
- **自愈执行**（策略、步骤、准确率、效率比、降级、回滚）
- **结果验证**（Schema / Health / Business 三重验证）
- **资源消耗**（Token 分布、LLM 调用、成本核算）
- **时间线**（全链路时间戳、MTTR 分解）
- **环境信息**（K8s 命名空间、节点、Pod、JVM 指标）
- **安全审计**（审批流、快照、回滚）
- **学习与业务影响**

## License

MIT
