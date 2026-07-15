# TaskFlow Agent — 任务流 Agent

> 蒸馏自 [yoheinakajima/babyagi](https://github.com/yoheinakajima/babyagi) (22k+ stars)

一个轻量级自主任务规划 Agent。接收自然语言目标，自动分解为 DAG 任务图，按依赖顺序执行，并在执行过程中反思和动态重规划，最终产出交付物。

## 架构概览

```
目标输入 → Plan（DAG 分解）→ Execute（拓扑并行执行）→ Reflect（结果评估）→ Replan（动态调整）→ 交付物
                                  ↑___________________________________________|
```

## 与 BabyAGI 的优化差异

| 特性 | BabyAGI 原版 | TaskFlow Agent |
|------|-------------|----------------|
| 任务结构 | 线性队列 | **DAG 依赖图**（支持并行） |
| 执行模式 | 串行逐个执行 | **拓扑排序 + 并行执行** |
| 反馈机制 | 无重规划 | **Reflect + Replan 循环** |
| 持久化 | 依赖向量数据库 | **JSON 文件**（零依赖） |
| 工具系统 | 无 | **5 个内置工具**（含沙箱代码执行） |
| 预算控制 | 无 | **Token 实时追踪与上限控制** |
| 可视化 | 无 | **终端 DAG 进度图** |
| 断点恢复 | 不支持 | **支持 `--resume` 恢复** |

## 快速开始

### 环境要求

- Python 3.10+
- OpenAI API Key（或兼容接口）

### 安装与运行

```bash
# 1. 安装依赖
pip install openai

# 2. 设置 API Key
export OPENAI_API_KEY="sk-..."

# 3. 运行
python main.py "写一个 Python 贪吃蛇游戏"
```

### 可选配置

```bash
# 使用自定义 API 端点（兼容 OpenAI 接口的服务）
export OPENAI_BASE_URL="https://your-api-endpoint.com/v1"

# 调整模型（默认 gpt-4o-mini）
export TASK_AGENT_MODEL="gpt-4o"

# 调整 Token 预算上限（默认 100000）
export MAX_TOKENS=50000

# 调整最大并行任务数（默认 4）
export MAX_WORKERS=2

# 调整最大重规划轮次（默认 3）
export MAX_REPLAN_ROUNDS=5
```

### 断点恢复

```bash
# 从中断处恢复执行
python main.py --resume
```

## 内置工具

Agent 在执行任务时可以调用以下工具：

| 工具 | 用途 |
|------|------|
| `think(thought)` | 结构化推理，在复杂决策前进行显式思考 |
| `write_file(path, content)` | 将内容写入输出目录 |
| `read_file(path)` | 读取已生成的文件 |
| `search(query)` | 通过 DuckDuckGo 搜索信息 |
| `code_execute(code)` | 在沙箱中执行 Python 代码（超时保护） |

## 项目结构

```
task-agent/
├── main.py        # 主入口：Agent 循环、LLM 调用、进度可视化
├── dag.py         # DAG 实现：任务节点、环检测、拓扑排序
├── tools.py       # 工具集：think/write_file/read_file/search/code_execute
├── README.md      # 本文件
├── tasks.json     # 运行时生成的状态存档
└── output/        # 运行时生成的工具输出目录
```

## 核心流程详解

### 1. Plan（规划）

LLM 将目标分解为 3~12 个子任务，每个任务带有依赖关系，形成 DAG 结构。添加任务时自动进行环检测，确保图的合法性。

### 2. Execute（执行）

通过 `get_ready_tasks()` 找出所有依赖已满足的任务，使用线程池并行执行。每个任务执行时：
- 收集上游任务结果作为上下文
- LLM 生成执行方案
- 解析并调用工具
- LLM 整合工具输出，产出最终结果

### 3. Reflect（反思）

每批任务执行后，对结果进行评估：
- 完成状态（completed / failed / partial）
- 质量评分（1-5 分）
- 是否需要重规划

### 4. Replan（重规划）

如果 Reflect 判断需要调整，LLM 会：
- 添加新的补救任务
- 修改待执行任务的描述
- 删除不再需要的任务

最多进行 `MAX_REPLAN_ROUNDS` 轮重规划，防止无限循环。

## 示例输出

```
  ╔══════════════════════════════════════╗
  ║       TaskFlow Agent v1.0            ║
  ║   蒸馏自 BabyAGI · DAG 任务引擎     ║
  ╚══════════════════════════════════════╝

目标: 用 Python 实现一个 Markdown 转 HTML 的命令行工具
模型: gpt-4o-mini  预算: 100,000 tokens

============================================================
  📋 阶段: Plan — 任务分解
============================================================

  + task_1: 需求分析  依赖: 无
  + task_2: 核心解析器设计  依赖: ['task_1']
  + task_3: 编写解析器代码  依赖: ['task_2']
  + task_4: 编写 CLI 入口  依赖: ['task_2']
  + task_5: 编写测试用例  依赖: ['task_3']
  + task_6: 集成测试与文档  依赖: ['task_3', 'task_4', 'task_5']

  共 6 个任务，预算: [██░░░░░░░░░░░░░░░░░░] 1,200/100,000 (1.2%)

──────────────────────────────────────────────────────────────
  📊 任务进度  Token: [██░░░░░░░░░░░░░░░░░░] 1,200/100,000 (1.2%)
──────────────────────────────────────────────────────────────
  ○ task_1: 需求分析
  ○ task_2: 核心解析器设计 ← [task_1]
  ○ task_3: 编写解析器代码 ← [task_2]
  ○ task_4: 编写 CLI 入口 ← [task_2]
  ○ task_5: 编写测试用例 ← [task_3]
  ○ task_6: 集成测试与文档 ← [task_3, task_4, task_5]
──────────────────────────────────────────────────────────────
```

## 许可

MIT License
