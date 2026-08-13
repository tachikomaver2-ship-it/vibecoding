# VibeFlow · Vibe Coding Board

一款 **Electron 桌面客户端**，把 **Codex（AI 编码代理）** 与 **Slack（频道 / 知识库 / 协作）** 的特点融合在一起：

- 像 Codex 一样，每个目标可以由 AI 代理推进「开发 → 测试 → 部署」；
- 像 Slack 一样，用「频道 / 收件箱」把各平台的信息沉淀成产品想法；
- 用一条 **五阶段流水线**（想法 → 需求 → 开发 → 测试 → 部署）把零散的 vibe coding 变成可追踪、可审计的产品开发过程。

> 灵感来自 GitHub 上 5 个高赞 vibe coding / AI 编码项目（见文末「借鉴来源」）。

---

## 它解决了什么

Vibe coding 最大的痛点是「想法乱成一团、过程不可追踪」。VibeFlow 让每一个**目标（Goal）**都拥有：

| 需求 | 实现 |
| --- | --- |
| 展示开发阶段 | 看板按 5 个阶段分列：想法 / 需求 / 开发 / 测试 / 部署上线 |
| 卡片直观进度条 | 每张目标卡片带进度条（阶段基线 + 任务完成度） |
| 点开看历史与进度 | 目标详情抽屉：任务清单（进度）+ 历史修改记录时间线 + 来源灵感 |
| 连接器作为知识库 | 多连接器（剪贴板 / 文件 / Webhook / GitHub / Slack）把信息沉淀为「灵感」 |
| 想法经人工审核进入需求 | 灵感审核通过 → 生成「想法」阶段目标；想法 → 需求 **必须经过人工审核** |

---

## 快速开始

```bash
# 1. 安装依赖（会下载 Electron 二进制）
npm install

# 2. 开发模式（Vite 热更新 + 自动启动 Electron）
npm run dev

# 或者：先构建再启动
npm run build
npm start
```

首次启动会自动写入示例数据（5 个分属不同阶段的演示目标 + 灵感收件箱）。

---

## 核心功能

### 1. 目标看板（五阶段泳道）
- 顶部 5 列分别对应：想法 → 需求 → 开发 → 测试 → 部署上线，每列标注阶段说明。
- 目标卡片显示：阶段标签、进度条、任务完成度、关联灵感数、最近更新时间。
- 点击卡片打开详情抽屉。

### 2. 目标详情抽屉
- **进度条**：综合阶段基线与任务完成度。
- **描述**：可编辑保存。
- **任务清单**：增 / 删 / 勾选，实时影响进度。
- **历史修改记录**：时间线展示创建、阶段流转、任务变更、Codex 运行等事件（借鉴 Aider 的「改动即记录」）。
- **来源灵感**：展示该目标关联的收件箱条目（知识库沉淀）。
- **阶段操作**：
  - 想法阶段 → 必须「提交审核」（填审核人 + 意见）才能进入需求；
  - 需求 / 开发 / 测试 → 一键「推进到下一阶段」；
  - 「🤖 Codex 规划 / 生成任务」：离线启发式代理自动产出任务并写入历史（不依赖外部）。
  - 「⚡ Vibe Coding」：调用本地开源引擎（Aider + 本地模型）根据需求生成可运行代码；「📦 离线脚手架」为无 LLM 的模板回退。

### 3. 灵感收件箱（连接器知识库）
- 手动添加灵感（标题 / 内容 / 来源 / 频道）。
- 从文件批量导入（按空行拆分，首行作标题）。
- 从 GitHub Issues 导入（需本机已 `gh` 登录）。
- 每条灵感可「审核通过 → 进入想法阶段」或「忽略」。

### 4. 连接器配置
- **手动剪贴板 / 文件**：通用入口。
- **Webhook 接收**：内置 HTTP 服务（`http://127.0.0.1:18720/webhook`），Slack / Discord / Zapier / 浏览器插件均可 POST 灵感进来。
  ```bash
  curl -X POST http://127.0.0.1:18720/webhook \
    -H 'Content-Type: application/json' \
    -d '{"title":"一个新想法","content":"...","source":"slack","channelId":"c_inspire"}'
  ```
- **GitHub Issues / Slack**：配置仓库或 webhook 地址后启用。

### 5. ⚡ Vibe Coding 引擎（本地·开源，**不依赖外部**）
点击目标详情里的「⚡ 用 Aider 本地生成代码」，会根据该目标的**需求（标题 / 描述 / 任务 / 灵感）**调用本地开源 coding agent **Aider**（[github.com/Aider-AI/aider](https://github.com/Aider-AI/aider)，MIT 协议）生成可运行项目，写入 `projects/<goalId>/`，并自动从「需求」推进到「开发」阶段。

- **默认完全离线**：Aider 后端用本地模型（如 Ollama 跑 `qwen2.5-coder`），全程不调用任何外部服务。
- **零依赖回退**：「📦 离线脚手架」用内置模板立即生成基础项目（无 LLM）。
- **可选云端**：连接器页「云端兼容接口」默认关闭；仅当你主动开启并填入 Key 时才走 OpenAI 兼容接口。

#### 本地引擎一次性安装
```bash
# 1. 安装 Aider（开源 coding agent）
pip install aider-chat

# 2. 安装并启动本地模型（以 Ollama 为例）
brew install ollama
ollama pull qwen2.5-coder        # 或 deepseek-coder / codellama
ollama serve                      # 默认监听 11434

# 3. 在 VibeFlow「连接器 → Vibe Coding 引擎」中确认命令(aider)与模型(ollama/qwen2.5-coder:latest)
```
> 引擎命令 / 模型都可在「连接器」页修改；若检测到命令不存在，详情页会直接给出上述安装提示。

### 6. 拖拽流转
看板卡片可直接拖到任意阶段列；从「想法」拖出仍会触发**人工审核门禁**（弹窗填审核人），其余方向直接移动。

---

## 技术架构

```
vibeflow/
├── electron/
│   ├── main.js        # Electron 主进程：窗口 + IPC 路由
│   ├── preload.js     # contextBridge 安全暴露 window.vibeAPI
│   ├── store.js       # 状态模型 / 持久化 / 进度与历史逻辑
│   ├── seed.js        # 首次启动的示例数据
│   ├── vibecode.js    # Vibe Coding 引擎（默认本地 Aider + 本地模型，可选云端回退）
│   ├── codex.js       # 离线启发式任务规划（不依赖外部）
│   ├── github.js      # 通过 gh CLI 拉取 Issue
│   └── webhook.js     # 本地 Webhook 接收服务
├── shared/
│   └── stages.json    # 阶段定义（顺序 / 颜色 / 基线进度 / 说明）
├── src/               # React 渲染进程（Vite）
│   ├── App.jsx
│   ├── api.js         # 封装 window.vibeAPI
│   ├── components/    # Sidebar / Board / GoalCard / GoalDetail / Inbox / Connectors / Activity ...
│   └── lib/format.js
└── scripts/dev.mjs    # 开发启动器（Vite + Electron）
```

- **持久化**：主进程把状态写成 JSON 文件（`userData/vibeflow-data.json`），通过 IPC 暴露，渲染进程不直接碰文件系统。
- **安全**：`contextIsolation: true` + `nodeIntegration: false`，仅通过 preload 的 `contextBridge` 暴露必要方法。
- **无原生依赖**：纯 JSON 存储 + 内置 `http` 模块，安装即用，避免原生模块编译问题。

---

## 借鉴来源（GitHub 高赞项目）

| 项目 | Star（约） | 借鉴点 |
| --- | --- | --- |
| [datawhalechina/easy-vibe](https://github.com/datawhalechina/easy-vibe) | 16.8K | 「想法 → 全栈 → MCP/Skills/Agent」的成长路径 → 五阶段流水线 + 连接器知识沉淀 |
| [vibe-coding-cn](https://github.com/tradecatlabs/vibe-coding-cn) | 14K | 道法术器方法论、Memory Bank、上下文优先 → 阶段化工作流 + 历史/记忆沉淀 |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | 77K+ | 自主软件工程 agent（ticket → PR）→ 自动化 开发/测试/部署 闭环 |
| [Cline](https://github.com/cline/cline) | 63K | plan/act 分离 + 人工审批关卡 → **想法 → 需求 的人工审核门禁** |
| [Aider](https://github.com/Aider-AI/aider) | 46K | 终端结对编程、git 原生、每次改动即记录 → 目标的「历史修改记录」 |

---

## 后续可扩展
- 多人实时协作（Slack 风格的频道消息流可升级为实时同步）。
- 目标与 Git 仓库 / Issue 双向联动（借鉴 Aider 的 git 原生能力）。
- 在容器内接入 OpenHands / Cline 作为可切换的编码引擎后端。
