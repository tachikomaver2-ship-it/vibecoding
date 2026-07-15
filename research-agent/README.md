# Deep Research Agent — 深度研究 Agent

> 蒸馏自 [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)（28k+ ⭐）的轻量级独立研究 Agent

## 项目简介

Deep Research Agent 是一个**单文件、零框架依赖**的研究 Agent。给定一个研究问题，它会通过 ReAct（Reasoning + Acting）循环自动搜索网络、阅读来源、分析信息，最终输出一份带引用的结构化 Markdown 研究报告。

```
用户输入研究问题 → 分解子问题 → 搜索/阅读/分析 → 交叉验证 → 生成报告
```

## 与原版 gpt-researcher 的优化差异

| 维度 | gpt-researcher | Deep Research Agent |
|------|---------------|---------------------|
| **依赖** | LangChain + 多个第三方库 | 仅 `openai` SDK |
| **文件数** | 数十个模块 | 2 个核心文件 (`main.py` + `tools.py`) |
| **推理方式** | 隐式 Chain | 显式 ReAct 推理链（日志可见） |
| **预算控制** | 无显式限制 | 50k token 默认预算，实时追踪 |
| **引用管理** | 松散列表 | 结构化去重 + 相关性评分 |
| **语言支持** | 英文为主 | 中英双语，自动检测 |
| **降级策略** | 部分工具失败可能中断 | 全链路优雅降级 |

### 核心优化

1. **零依赖**: 仅依赖 `openai` SDK，网络搜索和 HTML 解析均使用 Python 标准库
2. **ReAct 推理链**: 每一步 Think → Search → Analyze → Decide 均在终端日志中可视化输出，便于调试
3. **结构化引用追踪**: 自动去重、相关性评分、格式化引用
4. **成本预算控制**: 显式 token 预算（默认 50k），实时进度条，预算耗尽自动终止
5. **中英双语报告**: 根据查询语言自动切换输出语言
6. **优雅降级**: 搜索失败时回退到 LLM 知识 + 免责声明，不中断流程

## 快速开始

### 安装依赖

```bash
pip install openai
```

### 配置环境变量

```bash
# 必需
export OPENAI_API_KEY="sk-your-api-key"

# 可选：使用中国代理（兼容国内网络环境）
export OPENAI_BASE_URL="https://your-proxy.com/v1"

# 可选：指定模型（默认 gpt-4o）
export RESEARCH_MODEL="gpt-4o-mini"
```

### 运行

```bash
# 中文研究
python main.py "2024年大模型发展趋势分析"

# 英文研究
python main.py "What are the latest breakthroughs in AI safety?"

# 技术调研
python main.py "Rust vs Go: 系统编程语言对比"
```

### 输出示例

```
[14:32:01] [INFO] ============================================================
[14:32:01] [INFO] 研究问题: 2024年大模型发展趋势分析
[14:32:01] [INFO] 报告语言: zh
[14:32:01] [INFO] 模型: gpt-4o
[14:32:01] [INFO] Token 预算: 50,000
[14:32:01] [INFO] ============================================================
[14:32:01] [INFO] ──────────────────── 第 1 轮 ────────────────────
[14:32:03] [THINK] 首先需要将研究问题分解为子问题...
[14:32:03] [ACTION] ask_question("2024年大模型在架构方面有哪些主要趋势？")
[14:32:05] [OBSERVE] 子问题回答: 2024年大模型架构趋势主要包括...
[14:32:05] [BUDGET] |████░░░░░░░░░░░░░░░░| 2,150 / 50,000 tokens (4.3%)
...
[14:33:42] [INFO] 研究完成!
[14:33:42] [INFO] 总轮次: 12
[14:33:42] [INFO] 搜索次数: 8
[14:33:42] [INFO] 收集来源: 23 条
[14:33:42] [BUDGET] |████████████████░░░░| 41,200 / 50,000 tokens (82.4%)
```

报告自动保存为 `report_研究问题_时间戳.md`。

## 项目结构

```
research-agent/
├── README.md      # 本文件
├── main.py        # 主入口：Agent 核心、ReAct 循环、报告生成（~400 行）
└── tools.py       # 工具集：网络搜索、URL 阅读、引用格式化（~150 行）
```

## 配置参数

在 `main.py` 的 `AgentConfig` 类中可调整以下参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `model` | `gpt-4o` | LLM 模型名称 |
| `temperature` | `0.3` | 生成温度（低 = 更确定） |
| `token_budget` | `50,000` | 总 token 预算上限 |
| `max_iterations` | `20` | ReAct 最大循环次数 |
| `max_searches` | `15` | 最大网络搜索次数 |
| `search_results_per_query` | `5` | 每次搜索返回结果数 |
| `report_language` | `auto` | 报告语言 (auto/zh/en) |

## 工具扩展

`tools.py` 中的搜索工具支持替换为真实 API：

```python
# 替换为 SerpAPI
def web_search(query, num_results=5, *, search_api_url=None):
    api_url = f"https://serpapi.com/search?q={query}&api_key={SERP_API_KEY}"
    ...

# 替换为 Bing Search API
def web_search(query, num_results=5, *, search_api_url=None):
    api_url = f"https://api.bing.microsoft.com/v7.0/search?q={query}"
    ...
```

## 注意事项

- **API 费用**: 一次完整研究大约消耗 30k-50k tokens（约 $0.15-$0.50，取决于模型）
- **搜索质量**: 默认的 DuckDuckGo 搜索可能被限速，建议配置专业搜索 API
- **免责声明**: 当搜索不可用时，Agent 会使用 LLM 知识生成报告，并自动添加免责声明
- **Python 版本**: 需要 Python 3.10+

## 许可证

MIT License
