"""
CodeForge Agent — 终端 diff 查看器

提供文件树展示、彩色 unified diff 输出和统计摘要。
使用 ANSI 转义码实现终端着色，无需外部依赖。
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# ANSI 颜色代码
_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_RED = "\033[31m"
_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_BLUE = "\033[34m"
_CYAN = "\033[36m"
_MAGENTA = "\033[35m"


@dataclass
class DiffStats:
    """差异统计信息"""
    total_files: int = 0
    total_lines_added: int = 0
    total_lines_removed: int = 0
    total_tokens_used: int = 0


# ──────────────────────────────────────────────
# 文件树展示
# ──────────────────────────────────────────────

# 文件类型对应的图标（类似 vscode 风格）
_FILE_ICONS: dict[str, str] = {
    ".py": "🐍",
    ".js": "📜",
    ".ts": "📘",
    ".tsx": "⚛️",
    ".jsx": "⚛️",
    ".go": "🔵",
    ".json": "📋",
    ".md": "📝",
    ".txt": "📄",
    ".yml": "⚙️",
    ".yaml": "⚙️",
    ".toml": "⚙️",
    ".html": "🌐",
    ".css": "🎨",
}
_DEFAULT_ICON = "📄"


def print_file_tree(file_paths: list[str]) -> None:
    """
    在终端打印文件树结构，带文件类型图标。

    参数:
        file_paths: 所有生成文件的相对路径列表
    """
    print(f"\n{_BOLD}{_CYAN}📁 生成的文件树{_RESET}")
    print(f"{_DIM}{'─' * 50}{_RESET}")

    # 按目录排序，构建树结构
    sorted_paths = sorted(file_paths)
    for i, path in enumerate(sorted_paths):
        is_last = i == len(sorted_paths) - 1
        ext = os.path.splitext(path)[1]
        icon = _FILE_ICONS.get(ext, _DEFAULT_ICON)
        connector = "└── " if is_last else "├── "
        print(f"  {connector}{icon} {path}")

    print(f"{_DIM}{'─' * 50}{_RESET}")
    print(f"  共 {_BOLD}{len(file_paths)}{_RESET} 个文件\n")


# ──────────────────────────────────────────────
# 彩色 diff 输出
# ──────────────────────────────────────────────

def print_diff(file_path: str, old_lines: list[str], new_lines: list[str]) -> None:
    """
    打印单个文件的 unified diff（类似 git diff 格式），带 ANSI 着色。

    参数:
        file_path: 文件路径
        old_lines: 旧版本的行列表（骨架代码）
        new_lines: 新版本的行列表（完整实现）
    """
    print(f"\n{_BOLD}diff --codeforge a/{file_path} b/{file_path}{_RESET}")
    print(f"{_CYAN}--- a/{file_path}{_RESET}")
    print(f"{_CYAN}+++ b/{file_path}{_RESET}")

    # 简单的逐行对比（不做完整 LCS diff，保持轻量）
    max_lines = max(len(old_lines), len(new_lines))
    chunk_start = 1
    print(f"{_DIM}@@ -{chunk_start},{len(old_lines)} +{chunk_start},{len(new_lines)} @@{_RESET}")

    # 先输出移除的行（在旧版本中但不在新版本中）
    old_set = set(old_lines)
    new_set = set(new_lines)

    for line in old_lines:
        if line not in new_set:
            print(f"{_RED}- {line}{_RESET}")

    for line in new_lines:
        if line not in old_set:
            print(f"{_GREEN}+ {line}{_RESET}")
        else:
            print(f"  {line}")


def print_file_content(file_path: str, code: str) -> None:
    """
    直接打印文件内容（用于首次生成时无"旧版本"可对比的场景）。

    参数:
        file_path: 文件路径
        code: 文件代码内容
    """
    lines = code.split("\n")
    print(f"\n{_BOLD}{_GREEN}+ {file_path}{_RESET} ({len(lines)} 行)")
    # 只显示前 30 行，避免终端刷屏
    display_lines = lines[:30]
    for line in display_lines:
        print(f"{_GREEN}+ {line}{_RESET}")
    if len(lines) > 30:
        print(f"{_DIM}  ... 省略 {len(lines) - 30} 行 ...{_RESET}")


# ──────────────────────────────────────────────
# 统计摘要
# ──────────────────────────────────────────────

def print_summary(stats: DiffStats, phase_tokens: dict[str, int]) -> None:
    """
    打印生成结果的统计摘要。

    参数:
        stats: 文件与行数的统计信息
        phase_tokens: 各阶段消耗的 token 数 {阶段名: token数}
    """
    print(f"\n{'═' * 55}")
    print(f"{_BOLD}{_CYAN}  📊 生成摘要{_RESET}")
    print(f"{'═' * 55}")
    print(f"  📁 文件总数:    {_BOLD}{stats.total_files}{_RESET}")
    print(f"  ➕ 新增行数:    {_GREEN}{stats.total_lines_added}{_RESET}")
    if stats.total_lines_removed > 0:
        print(f"  ➖ 删除行数:    {_RED}{stats.total_lines_removed}{_RESET}")
    print(f"  🔤 Token 总量:  {_BOLD}{stats.total_tokens_used}{_RESET}")
    print()

    if phase_tokens:
        print(f"  {_DIM}各阶段 Token 消耗:{_RESET}")
        for phase_name, tokens in phase_tokens.items():
            bar_len = min(int(tokens / max(phase_tokens.values()) * 20), 20) if phase_tokens else 0
            bar = "█" * bar_len + "░" * (20 - bar_len)
            print(f"    {_YELLOW}{phase_name:<12}{_RESET} {bar} {tokens:,}")
        print()

    print(f"{'═' * 55}\n")


def compute_stats(files: list[tuple[str, str]]) -> DiffStats:
    """
    根据文件列表计算统计信息。

    参数:
        files: [(文件路径, 文件内容), ...]

    返回:
        DiffStats 统计对象
    """
    total_lines = 0
    for _, code in files:
        total_lines += len(code.split("\n"))

    return DiffStats(
        total_files=len(files),
        total_lines_added=total_lines,
    )
