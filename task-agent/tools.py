"""
TaskFlow Agent — 内置工具集

提供 Agent 可调用的工具函数，每个工具返回统一格式：
{success: bool, output: str, tokens_used: int}

工具列表：
- think: 结构化推理
- write_file: 写入文件
- read_file: 读取文件
- search: 网络搜索（基于 DuckDuckGo）
- code_execute: 沙箱执行 Python 代码
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

# 工具返回类型
ToolResult = dict[str, Any]

# 工作目录，由 main.py 在启动时设置
WORK_DIR: Path = Path("./output")


def set_work_dir(path: str | Path) -> None:
    """设置工具的工作目录"""
    global WORK_DIR
    WORK_DIR = Path(path)
    WORK_DIR.mkdir(parents=True, exist_ok=True)


# ======================================================================
# 工具实现
# ======================================================================

def think(thought: str) -> ToolResult:
    """
    结构化推理工具。
    让 Agent 在做出行动前进行显式思考，有助于提升推理质量。
    """
    return {
        "success": True,
        "output": f"[思考记录] {thought}",
        "tokens_used": 0,  # think 不消耗额外 token
    }


def write_file(path: str, content: str) -> ToolResult:
    """
    将内容写入指定文件。路径相对于 WORK_DIR。
    自动创建中间目录。
    """
    try:
        file_path = WORK_DIR / path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(content, encoding="utf-8")
        return {
            "success": True,
            "output": f"文件已写入: {file_path}（{len(content)} 字符）",
            "tokens_used": 0,
        }
    except Exception as e:
        return {
            "success": False,
            "output": f"写入文件失败: {e}",
            "tokens_used": 0,
        }


def read_file(path: str) -> ToolResult:
    """
    读取指定文件内容。路径相对于 WORK_DIR。
    """
    try:
        file_path = WORK_DIR / path
        if not file_path.exists():
            return {
                "success": False,
                "output": f"文件不存在: {file_path}",
                "tokens_used": 0,
            }
        content = file_path.read_text(encoding="utf-8")
        # 截断过长内容，避免 token 浪费
        max_chars = 8000
        if len(content) > max_chars:
            content = content[:max_chars] + f"\n... (已截断，共 {len(content)} 字符)"
        return {
            "success": True,
            "output": content,
            "tokens_used": 0,
        }
    except Exception as e:
        return {
            "success": False,
            "output": f"读取文件失败: {e}",
            "tokens_used": 0,
        }


def search(query: str) -> ToolResult:
    """
    网络搜索工具。使用 DuckDuckGo 即时答案 API（无需 API Key）。
    注意：返回的是摘要信息，非完整搜索结果页面。
    """
    try:
        import urllib.parse
        import urllib.request

        url = (
            "https://api.duckduckgo.com/?"
            + urllib.parse.urlencode({"q": query, "format": "json", "no_html": 1})
        )
        req = urllib.request.Request(url, headers={"User-Agent": "TaskFlowAgent/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        parts: list[str] = []
        # 提取即时答案
        if data.get("AbstractText"):
            parts.append(f"摘要: {data['AbstractText']}")
        if data.get("Answer"):
            parts.append(f"答案: {data['Answer']}")
        # 提取相关主题
        for topic in data.get("RelatedTopics", [])[:5]:
            if isinstance(topic, dict) and "Text" in topic:
                parts.append(f"- {topic['Text']}")

        output = "\n".join(parts) if parts else "未找到相关结果"
        return {"success": True, "output": output, "tokens_used": 0}

    except Exception as e:
        return {
            "success": False,
            "output": f"搜索失败: {e}",
            "tokens_used": 0,
        }


def code_execute(code: str, timeout: int = 15) -> ToolResult:
    """
    在独立子进程中执行 Python 代码。
    - 捕获 stdout/stderr
    - 超时保护（默认 15 秒）
    - 使用子进程隔离，避免影响主进程
    """
    import subprocess

    # 构建沙箱包装脚本：限制内置函数，然后执行用户代码
    allowed_builtins = [
        "print", "len", "range", "enumerate", "zip", "map", "filter",
        "sorted", "reversed", "sum", "min", "max", "abs", "round",
        "int", "float", "str", "bool", "list", "dict", "set", "tuple",
        "isinstance", "type", "hasattr", "getattr",
        "True", "False", "None",
        "__import__", "open", "iter", "next", "repr", "chr", "ord",
        "hex", "oct", "bin", "format", "any", "all", "frozenset",
        "bytes", "bytearray", "complex", "divmod", "pow", "slice",
        "Exception", "ValueError", "TypeError", "KeyError",
        "IndexError", "AttributeError", "RuntimeError", "StopIteration",
    ]
    wrapper = (
        "import builtins as _b\n"
        f"_allowed = {allowed_builtins!r}\n"
        "_orig = {k: getattr(_b, k) for k in _allowed if hasattr(_b, k)}\n"
        "__builtins__ = _orig\n"
        "# --- 用户代码开始 ---\n"
        f"{code}\n"
        "# --- 用户代码结束 ---\n"
    )

    # 将包装后的代码写入临时文件以避免 shell 转义问题
    tmp_dir = str(WORK_DIR)
    script_path = Path(tmp_dir) / "_sandbox_tmp.py"
    try:
        script_path.write_text(wrapper, encoding="utf-8")

        proc = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=tmp_dir,
            env={
                **os.environ,
                "PYTHONDONTWRITEBYTECODE": "1",
            },
        )

        stdout_text = proc.stdout or ""
        stderr_text = proc.stderr or ""

        if proc.returncode != 0:
            return {
                "success": False,
                "output": f"执行错误 (exit={proc.returncode}):\n{stderr_text}",
                "tokens_used": 0,
            }

        output_parts: list[str] = []
        if stdout_text:
            output_parts.append(f"stdout:\n{stdout_text}")
        if stderr_text:
            output_parts.append(f"stderr:\n{stderr_text}")
        output = "\n".join(output_parts) if output_parts else "（代码执行成功，无输出）"

        return {"success": True, "output": output, "tokens_used": 0}

    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "output": f"代码执行超时（>{timeout}秒），已终止",
            "tokens_used": 0,
        }
    except Exception as e:
        return {
            "success": False,
            "output": f"执行失败: {e}",
            "tokens_used": 0,
        }
    finally:
        # 清理临时文件
        if script_path.exists():
            script_path.unlink()


# ======================================================================
# 工具注册表
# ======================================================================

TOOL_REGISTRY: dict[str, dict[str, Any]] = {
    "think": {
        "func": think,
        "description": "结构化推理：在行动前进行显式思考",
        "params": {"thought": "思考内容"},
    },
    "write_file": {
        "func": write_file,
        "description": "写入文件到输出目录",
        "params": {"path": "相对路径", "content": "文件内容"},
    },
    "read_file": {
        "func": read_file,
        "description": "读取输出目录中的文件",
        "params": {"path": "相对路径"},
    },
    "search": {
        "func": search,
        "description": "使用 DuckDuckGo 搜索信息",
        "params": {"query": "搜索关键词"},
    },
    "code_execute": {
        "func": code_execute,
        "description": "在沙箱中执行 Python 代码",
        "params": {"code": "Python 代码"},
    },
}


def get_tool_descriptions() -> str:
    """生成工具描述文本，供 LLM prompt 使用"""
    lines: list[str] = []
    for name, info in TOOL_REGISTRY.items():
        params_str = ", ".join(f"{k}: {v}" for k, v in info["params"].items())
        lines.append(f"- {name}({params_str}): {info['description']}")
    return "\n".join(lines)


def execute_tool(name: str, **kwargs: Any) -> ToolResult:
    """通过名称调用工具"""
    if name not in TOOL_REGISTRY:
        return {
            "success": False,
            "output": f"未知工具: {name}，可用工具: {list(TOOL_REGISTRY.keys())}",
            "tokens_used": 0,
        }
    try:
        return TOOL_REGISTRY[name]["func"](**kwargs)
    except TypeError as e:
        return {
            "success": False,
            "output": f"工具参数错误: {e}",
            "tokens_used": 0,
        }
