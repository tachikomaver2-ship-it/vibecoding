"""
CodeForge Agent — 各阶段实现

五阶段流水线中每个阶段的 Prompt 构建与结果解析逻辑。
每个阶段都是纯函数：接收结构化输入，返回结构化输出。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

# ──────────────────────────────────────────────
# 数据结构定义
# ──────────────────────────────────────────────

@dataclass
class FileSpec:
    """单个文件的描述"""
    path: str
    purpose: str = ""
    code: str = ""


@dataclass
class Architecture:
    """架构阶段的输出"""
    tech_stack: str = ""
    files: list[FileSpec] = field(default_factory=list)
    reasoning: str = ""


@dataclass
class ReviewIssue:
    """审查阶段发现的单个问题"""
    file: str
    line: int
    description: str
    fix: str


@dataclass
class ReviewResult:
    """审查阶段的完整输出"""
    issues: list[ReviewIssue] = field(default_factory=list)
    passes_review: bool = True
    reasoning: str = ""


# ──────────────────────────────────────────────
# 语言适配配置
# ──────────────────────────────────────────────

LANG_CONFIG: dict[str, dict[str, Any]] = {
    "python": {
        "ext": ".py",
        "test_prefix": "test_",
        "test_framework": "pytest",
        "common_files": ["__init__.py", "main.py", "requirements.txt"],
    },
    "javascript": {
        "ext": ".js",
        "test_prefix": "",
        "test_suffix": ".test.js",
        "test_framework": "jest",
        "common_files": ["package.json", "index.js"],
    },
    "typescript": {
        "ext": ".ts",
        "test_prefix": "",
        "test_suffix": ".test.ts",
        "test_framework": "jest + ts-jest",
        "common_files": ["package.json", "tsconfig.json", "src/index.ts"],
    },
    "go": {
        "ext": ".go",
        "test_suffix": "_test.go",
        "test_framework": "testing",
        "common_files": ["go.mod", "main.go"],
    },
}


# ──────────────────────────────────────────────
# 阶段 1: 架构师 — 分析需求，规划项目结构
# ──────────────────────────────────────────────

def architect_prompt(requirement: str, language: str) -> str:
    """构建架构阶段的 Prompt"""
    lang_cfg = LANG_CONFIG.get(language, LANG_CONFIG["python"])
    return f"""你是一位资深软件架构师。请分析以下产品需求，设计项目结构。

## 产品需求
{requirement}

## 目标语言
{language}（常见文件: {', '.join(lang_cfg['common_files'])}）

## 输出要求
请严格按以下 JSON 格式输出，不要添加任何其他文字：

```json
{{
  "reasoning": "你对需求的分析、技术选型理由、模块划分思路（200字以内）",
  "tech_stack": "选定的技术栈描述（一行）",
  "files": [
    {{"path": "相对路径", "purpose": "该文件的职责（一句话）"}}
  ]
}}
```

注意事项：
- 文件数量控制在 5-15 个之间
- 每个文件应有明确的单一职责
- 包含配置文件（如 {lang_cfg['common_files'][0]}）
- 路径使用正斜杠，不要以 / 开头
"""


def parse_architect_response(text: str) -> Architecture:
    """解析架构阶段的 LLM 响应"""
    json_str = _extract_json(text)
    data = json.loads(json_str)

    files = [FileSpec(path=f["path"], purpose=f.get("purpose", "")) for f in data.get("files", [])]
    return Architecture(
        tech_stack=data.get("tech_stack", ""),
        files=files,
        reasoning=data.get("reasoning", ""),
    )


# ──────────────────────────────────────────────
# 阶段 2: 脚手架 — 生成骨架代码
# ──────────────────────────────────────────────

def scaffold_prompt(architecture: Architecture, language: str) -> str:
    """构建脚手架阶段的 Prompt"""
    file_list = "\n".join(f"- {f.path}: {f.purpose}" for f in architecture.files)
    return f"""你是一位高级软件工程师。请为以下项目结构生成骨架代码。

## 技术栈
{architecture.tech_stack}

## 文件列表
{file_list}

## 骨架代码要求
- 只生成接口定义、类型、类声明、函数签名
- 函数体只包含 docstring / 注释说明意图，用 `pass` 或 `TODO` 占位
- 包含必要的 import 语句
- 配置文件（如 requirements.txt, package.json）直接生成完整内容

## 输出格式
对每个文件，按以下格式输出：

### FILE: <文件路径>
```
<骨架代码>
```

请严格按上述格式输出所有文件。
"""


def parse_scaffold_response(text: str) -> list[FileSpec]:
    """解析脚手架阶段的 LLM 响应，提取各文件的骨架代码"""
    return _extract_files(text)


# ──────────────────────────────────────────────
# 阶段 3: 实现 — 填充完整代码
# ──────────────────────────────────────────────

def implement_prompt(scaffolds: list[FileSpec], architecture: Architecture) -> str:
    """构建实现阶段的 Prompt"""
    scaffold_block = ""
    for f in scaffolds:
        scaffold_block += f"\n### FILE: {f.path}\n```\n{f.code}\n```\n"

    return f"""你是一位高级软件工程师。请将以下骨架代码填充为完整实现。

## 项目背景
{architecture.reasoning}

## 技术栈
{architecture.tech_stack}

## 骨架代码
{scaffold_block}

## 实现要求
- 保持原有接口不变，只填充函数体
- 包含完整的错误处理
- 添加必要的注释（中文）
- 确保所有 import 完整正确
- 每个文件的实现应是完整可运行的，不是增量 diff

## 输出格式
对每个文件，按以下格式输出完整代码：

### FILE: <文件路径>
```
<完整代码>
```

请严格按上述格式输出所有文件。
"""


def parse_implement_response(text: str) -> list[FileSpec]:
    """解析实现阶段的 LLM 响应"""
    return _extract_files(text)


# ──────────────────────────────────────────────
# 阶段 4: 审查 — 自审查并生成修复补丁
# ──────────────────────────────────────────────

def review_prompt(files: list[FileSpec]) -> str:
    """构建审查阶段的 Prompt"""
    code_block = ""
    for f in files:
        code_block += f"\n### FILE: {f.path}\n```\n{f.code}\n```\n"

    return f"""你是一位严格的代码审查员。请审查以下代码，找出问题并给出修复方案。

## 待审查代码
{code_block}

## 审查重点
1. **导入问题**: 缺失的 import、循环导入、未使用的导入
2. **逻辑错误**: 边界条件、空值处理、类型不匹配
3. **一致性问题**: 命名风格不统一、接口调用参数不匹配
4. **安全问题**: 硬编码密钥、SQL 注入、路径遍历
5. **健壮性**: 缺失的错误处理、资源未释放

## 输出格式
请严格按以下 JSON 格式输出：

```json
{{
  "reasoning": "整体评价（100字以内）",
  "passes_review": true/false,
  "issues": [
    {{
      "file": "文件路径",
      "line": 行号(整数),
      "description": "问题描述",
      "fix": "修复方案（具体代码或说明）"
    }}
  ]
}}
```

如果没有严重问题，将 passes_review 设为 true。
issues 数组最多列出 10 个最重要的问题。
"""


def parse_review_response(text: str) -> ReviewResult:
    """解析审查阶段的 LLM 响应"""
    json_str = _extract_json(text)
    data = json.loads(json_str)

    issues = [
        ReviewIssue(
            file=iss.get("file", ""),
            line=iss.get("line", 0),
            description=iss.get("description", ""),
            fix=iss.get("fix", ""),
        )
        for iss in data.get("issues", [])
    ]

    return ReviewResult(
        issues=issues,
        passes_review=data.get("passes_review", True),
        reasoning=data.get("reasoning", ""),
    )


# ──────────────────────────────────────────────
# 阶段 5: 测试 — 生成单元测试
# ──────────────────────────────────────────────

def test_prompt(files: list[FileSpec], language: str) -> str:
    """构建测试阶段的 Prompt"""
    lang_cfg = LANG_CONFIG.get(language, LANG_CONFIG["python"])
    code_block = ""
    for f in files:
        code_block += f"\n### FILE: {f.path}\n```\n{f.code}\n```\n"

    return f"""你是一位测试工程师。请为以下代码生成单元测试。

## 代码
{code_block}

## 测试框架
{lang_cfg['test_framework']}

## 测试要求
- 为核心模块的每个公共函数/方法至少写 2-3 个测试用例
- 包含正常路径和异常路径的测试
- 使用 mock/stub 隔离外部依赖
- 测试文件路径应与源文件对应（如 src/foo.py -> tests/test_foo.py）

## 输出格式
对每个测试文件，按以下格式输出：

### FILE: <测试文件路径>
```
<测试代码>
```

请严格按上述格式输出。
"""


def parse_test_response(text: str) -> list[FileSpec]:
    """解析测试阶段的 LLM 响应"""
    return _extract_files(text)


# ──────────────────────────────────────────────
# 内部工具函数
# ──────────────────────────────────────────────

def _extract_json(text: str) -> str:
    """从 LLM 响应中提取 JSON 字符串（支持 ```json ... ``` 包裹）"""
    # 尝试提取 markdown 代码块中的 JSON
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    # 回退：尝试直接解析整个文本中的第一个 { ... }
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        return match.group(0)
    raise ValueError("无法从 LLM 响应中提取 JSON 数据")


def _extract_files(text: str) -> list[FileSpec]:
    """
    从 LLM 响应中提取所有文件代码块。
    匹配格式: ### FILE: <路径>\n```<可选语言>\n<代码>\n```
    """
    pattern = r"###\s*FILE:\s*(.+?)\s*\n```(?:\w*)\n(.*?)```"
    matches = re.findall(pattern, text, re.DOTALL)

    files: list[FileSpec] = []
    for path, code in matches:
        files.append(FileSpec(path=path.strip(), code=code.strip()))

    if not files:
        # 回退：尝试更宽松的模式（不带 ### 前缀）
        pattern_fallback = r"FILE:\s*(.+?)\s*\n```(?:\w*)\n(.*?)```"
        matches = re.findall(pattern_fallback, text, re.DOTALL)
        for path, code in matches:
            files.append(FileSpec(path=path.strip(), code=code.strip()))

    return files
