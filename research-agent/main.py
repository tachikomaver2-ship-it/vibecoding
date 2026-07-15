#!/usr/bin/env python3
"""
main.py - Deep Research Agent 主入口
=====================================
一个蒸馏自 gpt-researcher 的轻量级研究 Agent。
采用 ReAct（Reasoning + Acting）循环驱动，
具备显式 token 预算管理、结构化引用追踪和中英双语报告输出。

用法:
    export OPENAI_API_KEY="sk-..."
    export OPENAI_BASE_URL="https://your-proxy.com/v1"  # 可选，用于中国代理
    python main.py "你的研究问题"

Python 3.10+ | 仅依赖 openai SDK
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any

try:
    from openai import OpenAI
except ImportError:
    print(
        "\033[91m[错误] 缺少 openai SDK，请执行: pip install openai\033[0m"
    )
    sys.exit(1)

from tools import format_citation, read_url, web_search

# ===========================================================================
# 配置
# ===========================================================================

@dataclass
class AgentConfig:
    """Agent 运行配置。"""

    # --- LLM ---
    model: str = os.getenv("RESEARCH_MODEL", "gpt-4o")
    temperature: float = 0.3
    max_output_tokens: int = 4096  # 单次 LLM 调用最大输出

    # --- 预算 ---
    token_budget: int = 50_000  # 总 token 预算
    max_iterations: int = 20  # ReAct 最大循环次数
    max_searches: int = 15  # 最大搜索次数

    # --- 搜索 ---
    search_results_per_query: int = 5

    # --- 报告 ---
    report_language: str = "auto"  # auto / zh / en


# ===========================================================================
# 彩色终端日志
# ===========================================================================

class Logger:
    """终端彩色日志输出。"""

    COLORS = {
        "think": "\033[95m",   # 紫色 - 思考
        "action": "\033[96m",  # 青色 - 行动
        "observe": "\033[92m", # 绿色 - 观察
        "warn": "\033[93m",    # 黄色 - 警告
        "error": "\033[91m",   # 红色 - 错误
        "info": "\033[94m",    # 蓝色 - 信息
        "budget": "\033[33m",  # 暗黄 - 预算
        "reset": "\033[0m",
        "bold": "\033[1m",
    }

    @classmethod
    def _log(cls, tag: str, color_key: str, msg: str) -> None:
        c = cls.COLORS.get(color_key, "")
        r = cls.COLORS["reset"]
        ts = time.strftime("%H:%M:%S")
        print(f"{c}[{ts}] [{tag}]{r} {msg}")

    @classmethod
    def think(cls, msg: str) -> None:
        cls._log("THINK", "think", msg)

    @classmethod
    def action(cls, msg: str) -> None:
        cls._log("ACTION", "action", msg)

    @classmethod
    def observe(cls, msg: str) -> None:
        cls._log("OBSERVE", "observe", msg)

    @classmethod
    def warn(cls, msg: str) -> None:
        cls._log("WARN", "warn", msg)

    @classmethod
    def error(cls, msg: str) -> None:
        cls._log("ERROR", "error", msg)

    @classmethod
    def info(cls, msg: str) -> None:
        cls._log("INFO", "info", msg)

    @classmethod
    def budget(cls, used: int, total: int) -> None:
        pct = used / total * 100 if total else 0
        bar_len = 20
        filled = int(bar_len * used / total) if total else 0
        bar = "█" * filled + "░" * (bar_len - filled)
        cls._log(
            "BUDGET", "budget",
            f"|{bar}| {used:,} / {total:,} tokens ({pct:.1f}%)"
        )


log = Logger()

# ===========================================================================
# 引用追踪
# ===========================================================================

@dataclass
class Source:
    """一条引用来源。"""
    title: str
    url: str
    snippet: str
    relevance_score: float = 0.0  # 0-1，由 LLM 评分

    @property
    def dedup_key(self) -> str:
        """用于去重的唯一键（基于 URL）。"""
        return self.url.rstrip("/").lower()


@dataclass
class SourceTracker:
    """结构化引用追踪器，负责去重和相关性评分。"""

    sources: list[Source] = field(default_factory=list)
    _seen_keys: set[str] = field(default_factory=set)

    def add(self, source: Source) -> bool:
        """添加来源，自动去重。返回 True 表示新增成功。"""
        key = source.dedup_key
        if key in self._seen_keys:
            return False
        self._seen_keys.add(key)
        self.sources.append(source)
        return True

    def add_batch(self, items: list[dict[str, str]]) -> int:
        """批量添加搜索结果，返回新增数量。"""
        count = 0
        for item in items:
            s = Source(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("snippet", ""),
            )
            if self.add(s):
                count += 1
        return count

    def get_top(self, n: int = 20) -> list[Source]:
        """按相关性评分返回 Top N 来源。"""
        return sorted(self.sources, key=lambda s: s.relevance_score, reverse=True)[:n]

    def to_markdown(self) -> str:
        """将所有来源格式化为 Markdown 引用列表。"""
        lines: list[str] = []
        for i, src in enumerate(self.get_top(), 1):
            lines.append(format_citation(
                {"title": src.title, "url": src.url, "snippet": src.snippet},
                index=i,
            ))
        return "\n\n".join(lines)


# ===========================================================================
# 预算管理
# ===========================================================================

class BudgetManager:
    """实时 token 预算追踪。"""

    def __init__(self, total: int) -> None:
        self.total = total
        self.used = 0
        self._history: list[dict[str, Any]] = []

    @property
    def remaining(self) -> int:
        return max(0, self.total - self.used)

    @property
    def exhausted(self) -> bool:
        return self.remaining <= 0

    def consume(self, tokens: int, label: str = "") -> None:
        """消耗 token 并记录历史。"""
        self.used += tokens
        self._history.append({"tokens": tokens, "label": label, "total": self.used})
        log.budget(self.used, self.total)

    def can_afford(self, tokens: int) -> bool:
        """判断是否有足够预算。"""
        return self.remaining >= tokens


# ===========================================================================
# 语言检测
# ===========================================================================

def detect_language(query: str) -> str:
    """检测查询语言，返回 'zh' 或 'en'。"""
    cn_chars = len(re.findall(r"[\u4e00-\u9fff]", query))
    total = len(query.strip())
    return "zh" if total > 0 and cn_chars / total > 0.2 else "en"


# ===========================================================================
# 研究 Agent 核心
# ===========================================================================

class ResearchAgent:
    """ReAct 驱动的深度研究 Agent。"""

    def __init__(self, config: AgentConfig | None = None) -> None:
        self.cfg = config or AgentConfig()

        # 初始化 OpenAI 客户端（支持 OPENAI_BASE_URL 环境变量，兼容中国代理）
        self.client = OpenAI(
            api_key=os.getenv("OPENAI_API_KEY", ""),
            base_url=os.getenv("OPENAI_BASE_URL") or None,
        )

        self.tracker = SourceTracker()
        self.budget = BudgetManager(self.cfg.token_budget)
        self.iteration = 0
        self.search_count = 0
        self.findings: list[str] = []  # 收集到的研究发现片段

        # ReAct 对话历史
        self.messages: list[dict[str, str]] = []

    # ------------------------------------------------------------------
    # LLM 调用
    # ------------------------------------------------------------------

    def _call_llm(
        self,
        messages: list[dict[str, str]],
        *,
        label: str = "llm",
        temperature: float | None = None,
    ) -> str:
        """调用 LLM 并追踪 token 预算。"""
        if self.budget.exhausted:
            log.warn("Token 预算已耗尽，跳过 LLM 调用")
            return ""

        try:
            resp = self.client.chat.completions.create(
                model=self.cfg.model,
                messages=messages,
                temperature=temperature if temperature is not None else self.cfg.temperature,
                max_tokens=min(self.cfg.max_output_tokens, self.budget.remaining),
            )
        except Exception as e:
            log.error(f"LLM 调用失败: {e}")
            return ""

        # 追踪 token 使用
        usage = resp.usage
        total_tokens = 0
        if usage:
            total_tokens = (usage.prompt_tokens or 0) + (usage.completion_tokens or 0)

        self.budget.consume(total_tokens, label=label)

        content = resp.choices[0].message.content or ""
        return content.strip()

    # ------------------------------------------------------------------
    # 工具调用
    # ------------------------------------------------------------------

    def _tool_web_search(self, query: str) -> str:
        """执行网络搜索并追踪来源。"""
        if self.search_count >= self.cfg.max_searches:
            return json.dumps({"error": f"已达最大搜索次数限制 ({self.cfg.max_searches})"})

        log.action(f"web_search(\"{query}\")")
        result = web_search(query, num_results=self.cfg.search_results_per_query)

        self.search_count += 1
        self.budget.consume(result.get("tokens_used", 0), label="search")

        if result["success"]:
            added = self.tracker.add_batch(result["data"])
            log.observe(
                f"搜索完成: {len(result['data'])} 条结果, "
                f"{added} 条新增 (去重后), 来源: {result.get('source', 'unknown')}"
            )
            if result.get("source") == "stub":
                log.warn("使用了模拟搜索结果（网络不可用或搜索 API 未配置）")
        else:
            log.error(f"搜索失败: {result['error']}")

        return json.dumps(result, ensure_ascii=False, indent=2)

    def _tool_read_url(self, url: str) -> str:
        """读取 URL 内容。"""
        log.action(f"read_url(\"{url[:80]}...\")")
        result = read_url(url)

        self.budget.consume(result.get("tokens_used", 0), label="read_url")

        if result["success"]:
            log.observe(f"页面读取成功: {len(result['data'])} 字符")
        else:
            log.error(f"页面读取失败: {result['error']}")

        return json.dumps(result, ensure_ascii=False, indent=2)

    def _tool_ask_question(self, sub_question: str) -> str:
        """将研究分解为子问题，利用 LLM 回答。"""
        log.action(f"ask_question(\"{sub_question[:80]}...\")")

        # 构建上下文：包含已收集的研究发现
        context_parts = [f"研究主题: {self.research_query}\n"]
        if self.findings:
            context_parts.append("已收集的信息:")
            for i, f in enumerate(self.findings[-5:], 1):
                context_parts.append(f"  {i}. {f[:300]}")
        context_parts.append(f"\n子问题: {sub_question}")

        messages = [
            {
                "role": "system",
                "content": (
                    "你是一位专业的研究分析师。请根据已有信息回答子问题。\n"
                    "如果信息不足，请明确指出需要进一步调查的方向。\n"
                    "回答要简洁、有事实依据，100-200字以内。"
                ),
            },
            {"role": "user", "content": "\n".join(context_parts)},
        ]
        answer = self._call_llm(messages, label="ask_question")

        if answer:
            self.findings.append(f"Q: {sub_question}\nA: {answer}")
            log.observe(f"子问题回答: {answer[:100]}...")

        return json.dumps({"success": True, "data": answer}, ensure_ascii=False)

    # ------------------------------------------------------------------
    # ReAct 循环
    # ------------------------------------------------------------------

    _SYSTEM_PROMPT_TEMPLATE = """你是一位专业的深度研究 Agent。你的任务是对给定的研究问题进行深入分析，
收集信息，并生成一份结构化的研究报告。

## 研究方法：ReAct（Reasoning + Acting）
每一步你需要：
1. **Thought（思考）**: 分析当前状态，决定下一步行动
2. **Action（行动）**: 调用工具收集信息
3. **Observation（观察）**: 分析工具返回的结果

## 可用工具
- `web_search(query)` - 网络搜索，返回搜索结果
- `read_url(url)` - 读取指定 URL 的页面内容
- `ask_question(sub_question)` - 让 LLM 回答一个子问题

## 输出格式
请严格按照以下格式输出每一步：
```
Thought: <你的思考过程>
Action: <工具名称>("<参数>")
```

## 研究策略
1. 首先将研究问题分解为 3-5 个子问题
2. 对每个子问题进行搜索和信息收集
3. 交叉验证信息，确保准确性
4. 当信息充分时，输出 FINAL_REPORT

## 完成条件
当你认为已收集到足够信息时，输出：
```
Thought: 信息已充分，开始生成报告
Action: FINAL_REPORT
```

## 注意事项
- 始终标注信息来源
- 对不确定的信息标注 [待验证]
- 预算有限时优先搜索核心问题
"""

    def _build_react_prompt(self) -> str:
        """构建 ReAct 系统提示。"""
        lang_hint = ""
        if self.language == "zh":
            lang_hint = "\n请用中文进行思考和回答。"
        else:
            lang_hint = "\nPlease think and respond in English."

        return self._SYSTEM_PROMPT_TEMPLATE + lang_hint

    def _parse_action(self, llm_output: str) -> tuple[str, str]:
        """从 LLM 输出中解析 Action。

        Returns:
            (action_name, action_param) 元组
        """
        # 尝试匹配 Action: tool_name("param") 或 Action: tool_name('param')
        # 也支持 Action: tool_name(param) 不带引号
        pattern = r'Action:\s*(\w+)\s*\(\s*["\']?(.*?)["\']?\s*\)\s*$'
        match = re.search(pattern, llm_output, re.DOTALL | re.MULTILINE)
        if match:
            return match.group(1).strip(), match.group(2).strip()

        # 检查是否为 FINAL_REPORT
        if "FINAL_REPORT" in llm_output:
            return "FINAL_REPORT", ""

        # 无法解析
        return "unknown", llm_output

    def _extract_thought(self, llm_output: str) -> str:
        """从 LLM 输出中提取思考过程。"""
        match = re.search(r"Thought:\s*(.*?)(?=Action:|$)", llm_output, re.DOTALL)
        return match.group(1).strip() if match else ""

    def run(self, query: str) -> str:
        """执行完整的研究流程。

        Args:
            query: 研究问题

        Returns:
            Markdown 格式的研究报告
        """
        self.research_query = query
        self.language = (
            detect_language(query)
            if self.cfg.report_language == "auto"
            else self.cfg.report_language
        )

        log.info(f"{'=' * 60}")
        log.info(f"研究问题: {query}")
        log.info(f"报告语言: {self.language}")
        log.info(f"模型: {self.cfg.model}")
        log.info(f"Token 预算: {self.cfg.token_budget:,}")
        log.info(f"{'=' * 60}")

        # 初始化对话
        system_prompt = self._build_react_prompt()
        self.messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"请对以下问题进行深度研究:\n\n{query}\n\n"
                    f"请开始你的 ReAct 分析流程。"
                ),
            },
        ]

        # === ReAct 主循环 ===
        for i in range(1, self.cfg.max_iterations + 1):
            self.iteration = i
            log.info(f"\n{'─' * 40} 第 {i} 轮 {'─' * 40}")

            # 预算检查
            if self.budget.exhausted:
                log.warn("Token 预算耗尽，提前终止研究循环")
                break

            # 调用 LLM
            llm_output = self._call_llm(self.messages, label=f"react-{i}")
            if not llm_output:
                log.error("LLM 返回空内容，跳过本轮")
                continue

            # 解析输出
            thought = self._extract_thought(llm_output)
            action_name, action_param = self._parse_action(llm_output)

            if thought:
                log.think(thought[:200])

            # 检查是否结束
            if action_name == "FINAL_REPORT":
                log.info("Agent 决定生成最终报告")
                break

            # 执行工具
            observation = ""
            if action_name == "web_search":
                observation = self._tool_web_search(action_param)
            elif action_name == "read_url":
                observation = self._tool_read_url(action_param)
            elif action_name == "ask_question":
                observation = self._tool_ask_question(action_param)
            else:
                observation = json.dumps({
                    "error": f"未知工具: {action_name}",
                    "hint": "可用工具: web_search, read_url, ask_question, FINAL_REPORT",
                })
                log.warn(f"无法识别的动作: {action_name}")

            # 将结果加入对话历史
            self.messages.append({"role": "assistant", "content": llm_output})
            self.messages.append({
                "role": "user",
                "content": f"Observation:\n{observation}\n\n请继续分析。",
            })

        # === 生成最终报告 ===
        log.info(f"\n{'═' * 60}")
        log.info("开始生成最终研究报告...")
        report = self._generate_report()

        log.info(f"\n{'═' * 60}")
        log.info("研究完成!")
        log.info(f"总轮次: {self.iteration}")
        log.info(f"搜索次数: {self.search_count}")
        log.info(f"收集来源: {len(self.tracker.sources)} 条")
        log.budget(self.budget.used, self.budget.total)

        return report

    # ------------------------------------------------------------------
    # 报告生成
    # ------------------------------------------------------------------

    def _generate_report(self) -> str:
        """基于收集的信息生成最终 Markdown 报告。"""
        # 构建来源列表文本
        sources_text = "\n".join(
            f"- [{s.title}]({s.url}): {s.snippet[:150]}"
            for s in self.tracker.sources
        ) or "（未收集到外部来源）"

        # 构建研究发现文本
        findings_text = "\n\n".join(self.findings) if self.findings else "（无独立研究发现）"

        lang_instruction = (
            "请用中文撰写报告。" if self.language == "zh" else "Write the report in English."
        )

        prompt_messages = [
            {
                "role": "system",
                "content": (
                    "你是一位专业的研究报告撰写者。请基于收集到的信息，生成一份结构化的 Markdown 研究报告。\n"
                    f"{lang_instruction}\n\n"
                    "## 报告结构要求\n"
                    "1. **执行摘要 (Executive Summary)** - 150字以内的核心发现\n"
                    "2. **关键发现 (Key Findings)** - 3-5个要点列表\n"
                    "3. **详细分析 (Detailed Analysis)** - 按主题分节展开\n"
                    "4. **来源 (Sources)** - 列出所有引用来源\n\n"
                    "## 格式要求\n"
                    "- 使用 Markdown 格式\n"
                    "- 在正文中使用 [1]、[2] 等标注引用来源\n"
                    "- 对不确定的信息标注 [待验证]\n"
                    "- 报告总长度控制在 1500-3000 字"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"## 研究问题\n{self.research_query}\n\n"
                    f"## 收集的研究发现\n{findings_text}\n\n"
                    f"## 引用来源\n{sources_text}\n\n"
                    f"## 搜索统计\n"
                    f"- 搜索次数: {self.search_count}\n"
                    f"- 来源数量: {len(self.tracker.sources)}\n"
                    f"- 研究轮次: {self.iteration}\n\n"
                    "请生成完整的研究报告。"
                ),
            },
        ]

        report = self._call_llm(
            prompt_messages,
            label="final-report",
            temperature=0.4,
        )

        if not report:
            # LLM 调用失败时的降级报告
            report = self._fallback_report()

        # 确保来源部分完整
        if "## Sources" not in report and "## 来源" not in report:
            report += "\n\n---\n\n## 来源 (Sources)\n\n"
            report += self.tracker.to_markdown()

        return report

    def _fallback_report(self) -> str:
        """当 LLM 不可用时生成降级报告。"""
        zh = self.language == "zh"
        title = "研究报告" if zh else "Research Report"
        summary_title = "执行摘要" if zh else "Executive Summary"
        findings_title = "关键发现" if zh else "Key Findings"
        analysis_title = "详细分析" if zh else "Detailed Analysis"
        sources_title = "来源" if zh else "Sources"

        disclaimer = (
            "⚠️ **免责声明**: 本报告基于 LLM 内部知识生成，未经外部来源验证。请自行核实关键事实。"
            if zh else
            "⚠️ **Disclaimer**: This report is based on LLM internal knowledge without external verification. Please verify key facts independently."
        )

        return f"""# {title}: {self.research_query}

{disclaimer}

## {summary_title}

（LLM 报告生成失败，以下为基于收集信息的简要总结）

共进行了 {self.search_count} 次搜索，收集了 {len(self.tracker.sources)} 条来源。

## {findings_title}

{chr(10).join(f"- {f[:200]}" for f in self.findings) if self.findings else "- 未收集到独立研究发现"}

## {analysis_title}

{chr(10).join(f"### 发现 {i+1}{chr(10)}{f}" for i, f in enumerate(self.findings)) if self.findings else "（无分析内容）"}

## {sources_title}

{self.tracker.to_markdown()}
"""


# ===========================================================================
# 入口
# ===========================================================================

def main() -> None:
    """主入口函数。"""
    # 解析命令行参数
    if len(sys.argv) < 2:
        print(
            "用法: python main.py \"你的研究问题\"\n\n"
            "环境变量:\n"
            "  OPENAI_API_KEY    - OpenAI API 密钥（必需）\n"
            "  OPENAI_BASE_URL   - API 代理地址（可选，用于中国代理）\n"
            "  RESEARCH_MODEL    - LLM 模型名称（默认: gpt-4o）\n\n"
            "示例:\n"
            '  python main.py "2024年大模型发展趋势分析"\n'
            '  OPENAI_BASE_URL=https://proxy.example.com/v1 python main.py "AI safety research"\n'
        )
        sys.exit(1)

    query = " ".join(sys.argv[1:])

    # 检查 API Key
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        log.error("未设置 OPENAI_API_KEY 环境变量")
        log.info("请执行: export OPENAI_API_KEY='sk-...'")
        sys.exit(1)

    # 创建并运行 Agent
    config = AgentConfig()
    agent = ResearchAgent(config)

    try:
        report = agent.run(query)
    except KeyboardInterrupt:
        log.warn("\n用户中断，正在生成已收集的报告...")
        report = agent._fallback_report()

    # 输出报告
    print(f"\n{'═' * 60}")
    print(report)

    # 同时保存到文件
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    safe_name = re.sub(r'[^\w\u4e00-\u9fff]', '_', query[:30])
    filename = f"report_{safe_name}_{timestamp}.md"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(report)

    log.info(f"报告已保存至: {filename}")


if __name__ == "__main__":
    main()
