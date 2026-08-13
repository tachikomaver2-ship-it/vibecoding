# AI Marketing Team

A multi-agent AI system for **marketing automation** and **data analysis / visualization**,
packaged as a cross-platform **Electron** desktop app.

This project was scaffolded on the `marketing-agent` branch of
[`tachikomaver2-ship-it/vibecoding`](https://github.com/tachikomaver2-ship-it/vibecoding),
inspired by high-star open-source marketing-agent projects:

- [my-marketing-crew](https://github.com/ranveer0323/my-marketing-crew) (CrewAI)
- [Agentic-AI-CrewAI-Gemini-Autonomous-Marketing-Workflow](https://github.com/Subitha-Murugesan/Agentic-AI-CrewAI-Gemini-Autonomous-Marketing-Workflow)
- [Marketing_Multi_Agent_System](https://github.com/haitezaz/Marketing_Multi_Agent_System) (LangGraph + Supabase + MCP)
- [Marketing-Agent-Framework](https://github.com/SouravM47/Marketing-Agent-Framework) (LangGraph)

## Architecture

```
┌─────────────────────────────────────────────┐
│  Electron (desktop host)                     │
│  ├─ main process  → runs the agents         │
│  ├─ preload      → contextBridge IPC        │
│  └─ renderer     → UI + Chart.js rendering   │
└─────────────────────────────────────────────┘
                  │ invoke(IPC.RUN_AGENT)
                  ▼
        ┌──────────────────────────┐
        │  Agent Orchestrator       │  (Supervisor)
        │  classifyIntent(goal)     │
        └──────────────────────────┘
           ├─ Marketing Agent        (researcher → strategist → copywriter → SEO)
           └─ Analytics Agent        (data summary → charts)
                  │
        ┌──────────────────────────┐
        │  Pluggable LLM Provider   │  demo | openai | anthropic
        └──────────────────────────┘
```

## Agents

1. **营销 Agent (Marketing Agent)** — a role-specialized pipeline:
   Market Researcher → Content Strategist → Copywriter → SEO Specialist.
   Produces a research brief, a 2-week content calendar, social/ad copy, and an SEO plan.
2. **数据分析与可视化 Agent (Analytics Agent)** — loads a CSV, computes summary
   statistics, writes a markdown analysis, and emits interactive Chart.js charts.

Both run inside the Electron main process and stream logs to the UI.

## 对话窗口 & 接入 AI 模型

桌面端内置一个**对话窗口**（顶部 Tab「💬 对话」），以及一个**模型设置面板**
（右上角「⚙️ 设置」）。配置会持久化到 `<userData>/settings.json`，即时生效。

- **Demo（默认）**：无需任何 Key，使用模板式回复，开箱即用，方便本地调试。
- **OpenAI / 兼容**：填入 API Key + 模型名（默认 `gpt-4o-mini`）；可填 **Base URL** 接入
  任意 OpenAI 兼容服务（DeepSeek、Moonshot、本地 vLLM 等）。
- **Anthropic**：填入 API Key + 模型名（默认 `claude-3-5-sonnet-20241022`）。

对话通过 `chat:send` IPC 调用主进程的 `provider.chat()`，以**流式**（token-by-token）回传
（`chat:delta` → `chat:done`），渲染层实时拼接气泡内容。「🛠 任务 Agent」标签页同样会
使用这里配置的模型。

> 也可走环境变量方式（见下文「Use a real LLM」），二者二选一；界面设置优先级更高。

## Quick start (no API key)

The default LLM provider is `demo` (template-based), so everything runs out of the box.

```bash
npm install
npm run dev          # launch the Electron app (GUI)
```

Headless (no GUI):

```bash
npm run agent:run -- --type marketing --goal "为新的 SaaS 产品做社媒营销" --brand "Acme"
npm run agent:run -- --type analytics --csvPath ./data/sample_campaign.csv
```

## Local debugging

Everything runs on your machine — no backend required (default `demo` LLM provider).

### 1. Launch the GUI (Electron)

```bash
npm install
npm run dev            # launches the Electron window with DevTools available
```

In the Electron window, open DevTools any time with **Cmd + Option + I** (macOS) to
inspect the renderer (UI logic, Chart.js, IPC calls).

### 2. Debug the main process (agents running in Node)

`npm run debug` launches Electron with the Node inspector on port **5858**:

```bash
npm run debug
```

Then in VS Code run the **"Debug Main Process"** attach config (`.vscode/launch.json`).
You can now set breakpoints in `src/main/`, `src/agents/`, `src/shared/`.

### 3. Debug an agent without the GUI

The **"Run Headless Agent (debug)"** VS Code config launches the CLI runner under the
debugger. Or from the terminal:

```bash
npm run agent:run -- --type marketing --goal "为新的 SaaS 产品做社媒营销" --brand "Acme"
npm run agent:run -- --type analytics --csvPath ./data/sample_campaign.csv
```

### 4. Type-check only

```bash
npm run typecheck
```

## Use a real LLM

```bash
export AGENT_LLM=openai        # or: anthropic
export OPENAI_API_KEY=sk-...   # or: ANTHROPIC_API_KEY=...
npm run agent:run -- --type marketing --goal "..."
```

`openai` and `@anthropic-ai/sdk` are optional dependencies and only loaded when selected.

## Project layout

```
package.json            scripts & deps (electron-vite + tsx)
electron.vite.config.ts build config
src/agents/             agent core (provider, orchestrator, marketing, analytics, tools)
src/main/               Electron main process (runs agents)
src/preload/            contextBridge IPC
src/renderer/           UI (HTML/CSS/TS) + Chart.js
src/shared/             IPC protocol types
scripts/run-headless.ts CLI runner
data/sample_campaign.csv sample dataset for the analytics agent
```

## License

MIT
