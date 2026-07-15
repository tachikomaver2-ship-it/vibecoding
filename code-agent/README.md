# CodeForge Agent — 代码锻造 Agent

> **蒸馏自 [smol-ai/developer](https://github.com/smol-ai/developer) (14k+ stars)**
>
> 将原项目的核心思路提炼为五阶段流水线，以更可控、可审查、可测试的方式生成完整项目代码。

---

## 项目简介

CodeForge Agent 是一个结构化的 AI 代码生成代理。给定一段产品需求描述，它会自动完成：

1. **架构规划** — 分析需求、选定技术栈、生成文件树
2. **骨架搭建** — 为每个文件生成接口、类型定义、函数签名
3. **完整实现** — 逐文件填充完整的业务逻辑
4. **自审查** — 检查 bug、缺失导入、不一致问题，生成修复补丁
5. **测试生成** — 为核心模块生成单元测试

---

## 与原版 smol-ai/developer 的优化差异

| 特性 | smol-ai/developer | CodeForge Agent |
|------|-------------------|-----------------|
| 生成方式 | 单次生成全部代码 | 五阶段流水线（规划→骨架→填充→审查→测试） |
| 自审查 | 无 | 第四阶段自动审查，发现问题自动修复 |
| 测试生成 | 无 | 第五阶段自动生成单元测试 |
| diff 预览 | 无 | 终端彩色 diff 输出（类似 git diff） |
| 多语言支持 | 仅 Python | Python / JavaScript+TypeScript / Go |
| 成本控制 | 无 | 每阶段 token 预算追踪 |
| 透明度 | 低 | 每阶段输出推理日志 |

---

## 快速开始

### 1. 安装依赖

```bash
pip install openai
```

### 2. 配置环境变量

```bash
export OPENAI_API_KEY="sk-your-key-here"
# 如果使用自定义端点（如 Azure、本地代理等），可选设置：
export OPENAI_BASE_URL="https://your-api-endpoint/v1"
```

### 3. 运行

```bash
# 生成 Python 项目（默认）
python main.py "开发一个待办事项命令行工具，支持添加、删除、列出、标记完成"

# 生成 TypeScript 项目
python main.py "构建一个 Markdown 博客生成器，将 md 文件转为 HTML 站点" --lang typescript

# 生成 Go 项目，指定输出目录
python main.py "实现一个 HTTP 短链接服务" --lang go --output ./my-project
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `requirement` (位置参数) | 产品需求描述 | 必填 |
| `--lang` | 目标语言: `python` / `javascript` / `typescript` / `go` | `python` |
| `--output` | 输出目录 | `./output/` |
| `--model` | OpenAI 模型名称 | `gpt-4o` |
| `--no-review` | 跳过审查阶段 | `false` |
| `--no-tests` | 跳过测试生成阶段 | `false` |
| `--budget` | 每阶段 token 预算上限 | `8000` |

---

## 项目结构

```
code-agent/
├── README.md        # 本文件
├── main.py          # 主入口，五阶段流水线编排
├── phases.py        # 各阶段的 Prompt 与解析逻辑
└── diff_view.py     # 终端 diff 查看器（彩色输出）
```

---

## 设计理念

- **分阶段优于一次性**：将复杂任务拆解为多个专注阶段，每阶段产出可审查的中间结果
- **自审查是必须的**：AI 生成的代码一定会有 bug，让 AI 自己先过一遍能显著减少低级错误
- **测试不是可选的**：生成代码不生成测试 = 交付不可靠的代码
- **透明度**：每阶段的推理过程对用户可见，便于理解和调试

---

## License

MIT
