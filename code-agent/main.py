#!/usr/bin/env python3
"""
CodeForge Agent — 代码锻造 Agent 主入口

蒸馏自 smol-ai/developer (14k+ stars)，
以五阶段流水线（架构→骨架→实现→审查→测试）生成完整项目代码。

用法:
    python main.py "开发一个待办事项命令行工具" --lang python
    python main.py "构建 Markdown 博客生成器" --lang typescript --output ./blog
    python main.py "实现 HTTP 短链接服务" --lang go --model gpt-4o
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# 确保可以从同目录导入模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from phases import (
    Architecture,
    FileSpec,
    ReviewResult,
    architect_prompt,
    implement_prompt,
    parse_architect_response,
    parse_implement_response,
    parse_review_response,
    parse_scaffold_response,
    parse_test_response,
    review_prompt,
    scaffold_prompt,
    test_prompt,
)
from diff_view import (
    DiffStats,
    compute_stats,
    print_diff,
    print_file_content,
    print_file_tree,
    print_summary,
)

# ──────────────────────────────────────────────
# 终端颜色常量
# ──────────────────────────────────────────────
_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_RED = "\033[31m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_BLUE = "\033[34m"
_CYAN = "\033[36m"
_MAGENTA = "\033[35m"

# 每阶段的图标
_PHASE_ICONS = {
    "architect": "🏗️",
    "scaffold": "🦴",
    "implement": "⚒️",
    "review": "🔍",
    "test": "🧪",
}


# ──────────────────────────────────────────────
# OpenAI 客户端封装
# ──────────────────────────────────────────────

class LLMClient:
    """
    OpenAI API 客户端封装。
    支持通过环境变量配置 API Key 和 Base URL。
    内置 token 使用量追踪。
    """

    def __init__(self, model: str = "gpt-4o", budget: int = 8000):
        """
        初始化 LLM 客户端。

        参数:
            model: OpenAI 模型名称
            budget: 单次调用的 token 预算上限
        """
        try:
            from openai import OpenAI
        except ImportError:
            print(f"{_RED}错误: 请先安装 openai 包: pip install openai{_RESET}")
            sys.exit(1)

        api_key = os.environ.get("OPENAI_API_KEY")
        base_url = os.environ.get("OPENAI_BASE_URL")

        if not api_key:
            print(f"{_RED}错误: 请设置 OPENAI_API_KEY 环境变量{_RESET}")
            sys.exit(1)

        # 构建客户端参数
        client_kwargs = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url

        self.client = OpenAI(**client_kwargs)
        self.model = model
        self.budget = budget
        # 各阶段 token 使用量追踪
        self.token_usage: dict[str, int] = {}

    def call(self, prompt: str, phase: str, temperature: float = 0.3) -> str:
        """
        调用 OpenAI API 并追踪 token 使用量。

        参数:
            prompt: 完整的 system + user prompt
            phase: 当前阶段名称（用于 token 追踪）
            temperature: 生成温度

        返回:
            LLM 响应文本
        """
        log_phase(phase, f"调用 {self.model}，预算 {self.budget} tokens...")

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是 CodeForge Agent，一个专业的代码生成助手。"
                        "请严格按照要求的格式输出，不要添加多余的解释。"
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            max_tokens=self.budget,
            temperature=temperature,
        )

        # 追踪 token 使用
        usage = response.usage
        total_tokens = usage.total_tokens if usage else 0
        self.token_usage[phase] = self.token_usage.get(phase, 0) + total_tokens

        log_phase(phase, f"消耗 {total_tokens:,} tokens（输入: {usage.prompt_tokens:,}, 输出: {usage.completion_tokens:,}）")

        return response.choices[0].message.content or ""


# ──────────────────────────────────────────────
# 日志与进度显示
# ──────────────────────────────────────────────

def log_phase(phase: str, message: str) -> None:
    """打印阶段日志，带阶段图标和颜色"""
    icon = _PHASE_ICONS.get(phase, "•")
    print(f"{_DIM}[{icon} {phase}]{_RESET} {message}")


def log_header(title: str) -> None:
    """打印阶段标题"""
    print(f"\n{_BOLD}{_CYAN}{'─' * 55}{_RESET}")
    print(f"{_BOLD}{_CYAN}  {title}{_RESET}")
    print(f"{_BOLD}{_CYAN}{'─' * 55}{_RESET}")


def log_success(message: str) -> None:
    """打印成功消息"""
    print(f"  {_GREEN}✓{_RESET} {message}")


def log_warning(message: str) -> None:
    """打印警告消息"""
    print(f"  {_YELLOW}⚠{_RESET} {message}")


def log_error(message: str) -> None:
    """打印错误消息"""
    print(f"  {_RED}✗{_RESET} {message}")


# ──────────────────────────────────────────────
# 文件写入
# ──────────────────────────────────────────────

def write_files(output_dir: Path, files: list[FileSpec]) -> list[str]:
    """
    将文件列表写入输出目录。

    参数:
        output_dir: 输出根目录
        files: 文件列表

    返回:
        写入的文件路径列表（相对路径）
    """
    written: list[str] = []

    for f in files:
        file_path = output_dir / f.path
        # 确保父目录存在
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(f.code, encoding="utf-8")
        written.append(f.path)
        log_success(f"写入 {f.path}")

    return written


# ──────────────────────────────────────────────
# 五阶段流水线
# ──────────────────────────────────────────────

def run_pipeline(
    requirement: str,
    language: str,
    output_dir: Path,
    model: str,
    budget: int,
    skip_review: bool = False,
    skip_tests: bool = False,
) -> None:
    """
    执行完整的五阶段代码生成流水线。

    参数:
        requirement: 产品需求描述
        language: 目标编程语言
        output_dir: 输出目录
        model: OpenAI 模型名称
        budget: 每阶段 token 预算
        skip_review: 是否跳过审查阶段
        skip_tests: 是否跳过测试阶段
    """
    start_time = time.time()

    print(f"\n{_BOLD}{_MAGENTA}{'═' * 55}{_RESET}")
    print(f"{_BOLD}{_MAGENTA}  🔥 CodeForge Agent — 代码锻造启动{_RESET}")
    print(f"{_BOLD}{_MAGENTA}{'═' * 55}{_RESET}")
    print(f"  📝 需求: {requirement[:80]}{'...' if len(requirement) > 80 else ''}")
    print(f"  🗣️  语言: {language}")
    print(f"  📂 输出: {output_dir}")
    print(f"  🤖 模型: {model}")
    print(f"  💰 预算: {budget:,} tokens/阶段")

    llm = LLMClient(model=model, budget=budget)

    # ── 阶段 1: 架构师 ────────────────────────
    log_header("🏗️  阶段 1/5: 架构规划")
    log_phase("architect", "分析需求，规划项目结构...")

    arch_prompt = architect_prompt(requirement, language)
    arch_raw = llm.call(arch_prompt, "architect")
    architecture = parse_architect_response(arch_raw)

    log_phase("architect", f"技术栈: {architecture.tech_stack}")
    log_phase("architect", f"规划推理: {architecture.reasoning[:100]}...")
    log_phase("architect", f"规划 {len(architecture.files)} 个文件:")
    for f in architecture.files:
        print(f"    {_DIM}•{_RESET} {f.path} — {f.purpose}")

    # ── 阶段 2: 脚手架 ────────────────────────
    log_header("🦴 阶段 2/5: 骨架搭建")
    log_phase("scaffold", "生成各文件的骨架代码...")

    scaff_prompt = scaffold_prompt(architecture, language)
    scaff_raw = llm.call(scaff_prompt, "scaffold")
    scaffolds = parse_scaffold_response(scaff_raw)

    if not scaffolds:
        log_warning("骨架阶段未解析到文件，尝试将文件列表作为占位传递")
        # 回退：使用空骨架
        scaffolds = [FileSpec(path=f.path, purpose=f.purpose, code=f"# TODO: 实现 {f.purpose}\n") for f in architecture.files]

    log_phase("scaffold", f"生成 {len(scaffolds)} 个文件的骨架代码")
    for s in scaffolds:
        lines = len(s.code.split("\n"))
        print(f"    {_DIM}•{_RESET} {s.path} ({lines} 行)")

    # ── 阶段 3: 实现 ──────────────────────────
    log_header("⚒️  阶段 3/5: 完整实现")
    log_phase("implement", "填充完整业务逻辑...")

    impl_prompt = implement_prompt(scaffolds, architecture)
    impl_raw = llm.call(impl_prompt, "implement", temperature=0.2)
    implementations = parse_implement_response(impl_raw)

    if not implementations:
        log_warning("实现阶段未解析到文件，使用骨架代码作为最终输出")
        implementations = scaffolds

    log_phase("implement", f"完成 {len(implementations)} 个文件的实现")
    for impl in implementations:
        lines = len(impl.code.split("\n"))
        print(f"    {_DIM}•{_RESET} {impl.path} ({lines} 行)")

    # ── 阶段 4: 自审查 ────────────────────────
    review_result: ReviewResult | None = None
    if not skip_review:
        log_header("🔍 阶段 4/5: 代码审查")
        log_phase("review", "检查 bug、缺失导入、一致性问题...")

        rev_prompt = review_prompt(implementations)
        rev_raw = llm.call(rev_prompt, "review")
        review_result = parse_review_response(rev_raw)

        log_phase("review", f"审查结论: {review_result.reasoning}")

        if review_result.issues:
            log_phase("review", f"发现 {len(review_result.issues)} 个问题:")
            for iss in review_result.issues:
                print(f"    {_YELLOW}⚠{_RESET} {iss.file}:{iss.line} — {iss.description}")
                print(f"      {_DIM}修复: {iss.fix[:80]}{_RESET}")

            if not review_result.passes_review:
                log_phase("review", "审查未通过，尝试自动修复...")
                implementations = _apply_fixes(llm, implementations, review_result)
        else:
            log_success("审查通过，未发现严重问题")
    else:
        log_header("🔍 阶段 4/5: 代码审查 (已跳过)")

    # ── 阶段 5: 测试生成 ──────────────────────
    test_files: list[FileSpec] = []
    if not skip_tests:
        log_header("🧪 阶段 5/5: 测试生成")
        log_phase("test", "为核心模块生成单元测试...")

        tst_prompt = test_prompt(implementations, language)
        tst_raw = llm.call(tst_prompt, "test")
        test_files = parse_test_response(tst_raw)

        if test_files:
            log_phase("test", f"生成 {len(test_files)} 个测试文件:")
            for t in test_files:
                lines = len(t.code.split("\n"))
                print(f"    {_DIM}•{_RESET} {t.path} ({lines} 行)")
        else:
            log_warning("测试阶段未生成测试文件")
    else:
        log_header("🧪 阶段 5/5: 测试生成 (已跳过)")

    # ── 输出文件 ──────────────────────────────
    log_header("📂 写入输出目录")

    # 确保输出目录存在
    output_dir.mkdir(parents=True, exist_ok=True)

    # 写入实现文件
    impl_paths = write_files(output_dir, implementations)
    # 写入测试文件
    test_paths = write_files(output_dir, test_files) if test_files else []

    all_paths = impl_paths + test_paths

    # ── 终端展示 ──────────────────────────────
    # 打印文件树
    print_file_tree(all_paths)

    # 打印 diff 预览（骨架 vs 实现）
    log_header("📋 Diff 预览 (骨架 → 实现)")
    for impl in implementations:
        # 找到对应的骨架代码
        scaffold_code = ""
        for s in scaffolds:
            if s.path == impl.path:
                scaffold_code = s.code
                break

        if scaffold_code:
            print_diff(
                impl.path,
                scaffold_code.split("\n"),
                impl.code.split("\n"),
            )
        else:
            print_file_content(impl.path, impl.code)

    # ── 统计摘要 ──────────────────────────────
    all_files_data = [(f.path, f.code) for f in implementations + test_files]
    stats = compute_stats(all_files_data)
    stats.total_tokens_used = sum(llm.token_usage.values())
    print_summary(stats, llm.token_usage)

    elapsed = time.time() - start_time
    print(f"  {_DIM}总耗时: {elapsed:.1f} 秒{_RESET}")
    print(f"  {_GREEN}{_BOLD}✅ 生成完成！代码已写入: {output_dir}{_RESET}\n")


# ──────────────────────────────────────────────
# 自审查修复逻辑
# ──────────────────────────────────────────────

def _apply_fixes(
    llm: LLMClient,
    files: list[FileSpec],
    review: ReviewResult,
) -> list[FileSpec]:
    """
    根据审查结果修复代码中的问题。

    策略：将所有问题及对应文件发给 LLM，让它返回修复后的完整文件。

    参数:
        llm: LLM 客户端
        files: 当前文件列表
        review: 审查结果

    返回:
        修复后的文件列表
    """
    # 构建受影响的文件集合
    affected_paths = {iss.file for iss in review.issues}
    affected_files = [f for f in files if f.path in affected_paths]

    if not affected_files:
        log_warning("没有需要修复的文件")
        return files

    # 构建修复 prompt
    issues_text = ""
    for iss in review.issues:
        issues_text += f"- {iss.file}:{iss.line} — {iss.description}\n  修复建议: {iss.fix}\n"

    code_text = ""
    for f in affected_files:
        code_text += f"\n### FILE: {f.path}\n```\n{f.code}\n```\n"

    fix_prompt = f"""请根据以下审查问题修复代码。

## 审查问题
{issues_text}

## 需要修复的代码
{code_text}

## 要求
- 修复所有列出的问题
- 保持其他代码不变
- 输出修复后的完整文件

## 输出格式
### FILE: <文件路径>
```
<修复后的完整代码>
```
"""

    log_phase("review", "正在应用修复...")
    fix_raw = llm.call(fix_prompt, "review", temperature=0.1)
    fixed_files = parse_implement_response(fix_raw)

    if not fixed_files:
        log_warning("修复阶段未返回有效结果，保留原代码")
        return files

    # 合并修复结果：修复过的文件替换原文件，未修复的保留
    fixed_map = {f.path: f for f in fixed_files}
    result: list[FileSpec] = []
    for f in files:
        if f.path in fixed_map:
            result.append(fixed_map[f.path])
            log_success(f"已修复 {f.path}")
        else:
            result.append(f)

    return result


# ──────────────────────────────────────────────
# 命令行入口
# ──────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    """解析命令行参数"""
    parser = argparse.ArgumentParser(
        description="CodeForge Agent — AI 驱动的代码锻造 Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python main.py "开发一个待办事项 CLI 工具"
  python main.py "构建 Markdown 博客" --lang typescript
  python main.py "HTTP 短链接服务" --lang go --output ./shorturl
  python main.py "JSON 数据校验器" --model gpt-4o --budget 12000
        """,
    )
    parser.add_argument(
        "requirement",
        type=str,
        help="产品需求描述（必填）",
    )
    parser.add_argument(
        "--lang",
        type=str,
        default="python",
        choices=["python", "javascript", "typescript", "go"],
        help="目标编程语言（默认: python）",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="./output",
        help="输出目录（默认: ./output/）",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="gpt-4o",
        help="OpenAI 模型名称（默认: gpt-4o）",
    )
    parser.add_argument(
        "--no-review",
        action="store_true",
        help="跳过代码审查阶段",
    )
    parser.add_argument(
        "--no-tests",
        action="store_true",
        help="跳过测试生成阶段",
    )
    parser.add_argument(
        "--budget",
        type=int,
        default=8000,
        help="每阶段 token 预算上限（默认: 8000）",
    )

    return parser.parse_args()


def main() -> None:
    """主入口函数"""
    args = parse_args()

    # 标准化语言名称
    lang = args.lang.lower().strip()

    # 构建输出目录
    output_dir = Path(args.output).resolve()

    # 执行流水线
    run_pipeline(
        requirement=args.requirement,
        language=lang,
        output_dir=output_dir,
        model=args.model,
        budget=args.budget,
        skip_review=args.no_review,
        skip_tests=args.no_tests,
    )


if __name__ == "__main__":
    main()
