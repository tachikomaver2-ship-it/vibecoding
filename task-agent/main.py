#!/usr/bin/env python3
"""
TaskFlow Agent — 轻量级自主任务规划 Agent

蒸馏自 yoheinakajima/babyagi (22k+ stars on GitHub)。
核心循环: Plan → Execute → Reflect → Replan

用法:
    export OPENAI_API_KEY="sk-..."
    python main.py "你的目标"

可选环境变量:
    OPENAI_BASE_URL  - 自定义 API 端点（兼容 OpenAI 接口的服务）
    MAX_TOKENS       - 单次运行 token 上限（默认 100000）
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from dag import CycleError, Task, TaskDAG, TaskStatus
from tools import execute_tool, get_tool_descriptions, set_work_dir

# ======================================================================
# 配置
# ======================================================================

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get(
    "OPENAI_BASE_URL", "https://api.openai.com/v1"
).rstrip("/")
MODEL_NAME = os.environ.get("TASK_AGENT_MODEL", "gpt-4o-mini")
MAX_TOKENS_BUDGET = int(os.environ.get("MAX_TOKENS", "100000"))
MAX_REPLAN_ROUNDS = int(os.environ.get("MAX_REPLAN_ROUNDS", "3"))
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", "4"))

# 颜色代码（终端输出）
class C:
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    RED    = "\033[91m"
    GREEN  = "\033[92m"
    YELLOW = "\033[93m"
    BLUE   = "\033[94m"
    CYAN   = "\033[96m"
    GRAY   = "\033[90m"
    MAGENTA = "\033[95m"


# ======================================================================
# Token 预算追踪
# ======================================================================

class BudgetTracker:
    """追踪 token 使用量，超出预算时中止运行"""

    def __init__(self, max_tokens: int = MAX_TOKENS_BUDGET) -> None:
        self.max_tokens = max_tokens
        self.used = 0

    def consume(self, tokens: int) -> None:
        self.used += tokens

    @property
    def remaining(self) -> int:
        return max(0, self.max_tokens - self.used)

    @property
    def exceeded(self) -> bool:
        return self.used >= self.max_tokens

    def summary(self) -> str:
        pct = (self.used / self.max_tokens * 100) if self.max_tokens else 0
        bar_len = 20
        filled = int(bar_len * self.used / self.max_tokens) if self.max_tokens else 0
        bar = "█" * filled + "░" * (bar_len - filled)
        return f"[{bar}] {self.used:,}/{self.max_tokens:,} ({pct:.1f}%)"


# ======================================================================
# LLM 调用封装
# ======================================================================

def call_llm(
    messages: list[dict[str, str]],
    budget: BudgetTracker,
    temperature: float = 0.7,
    response_format: dict | None = None,
) -> str:
    """
    调用 OpenAI Chat Completions API。
    自动追踪 token 消耗，超预算时抛出异常。
    """
    if budget.exceeded:
        raise RuntimeError(
            f"Token 预算已耗尽（已使用 {budget.used:,} tokens）"
        )

    try:
        from openai import OpenAI
    except ImportError:
        print(f"{C.RED}错误: 请先安装 openai 库{C.RESET}")
        print("  pip install openai")
        sys.exit(1)

    client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

    kwargs: dict[str, Any] = {
        "model": MODEL_NAME,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format:
        kwargs["response_format"] = response_format

    response = client.chat.completions.create(**kwargs)

    # 追踪 token 用量
    usage = response.usage
    if usage:
        tokens = usage.total_tokens
        budget.consume(tokens)

    return response.choices[0].message.content or ""


# ======================================================================
# Prompt 模板
# ======================================================================

PLAN_PROMPT = """\
你是一个任务规划专家。请将以下目标分解为具体的子任务，形成一个有向无环图（DAG）。

## 目标
{goal}

## 要求
- 每个任务应具体、可执行、可验证
- 明确任务间的依赖关系（哪些任务可以并行，哪些必须串行）
- 任务数量控制在 3~12 个
- 最后一个任务应为"汇总交付物"

## 可用工具
{tools}

## 输出格式（严格 JSON）
```json
{{
  "tasks": [
    {{
      "id": "task_1",
      "name": "任务简称",
      "description": "详细的任务描述，包含具体执行步骤",
      "dependencies": []
    }},
    {{
      "id": "task_2",
      "name": "任务简称",
      "description": "详细描述",
      "dependencies": ["task_1"]
    }}
  ]
}}
```

只输出 JSON，不要其他内容。"""

EXECUTE_PROMPT = """\
你是一个任务执行专家。请完成以下任务。

## 当前任务
- 名称: {task_name}
- 描述: {task_description}

## 总体目标
{goal}

## 已完成的上游任务结果
{upstream_results}

## 可用工具
调用工具请使用 JSON 格式：
```json
{{"tool": "工具名", "params": {{参数}}}}
```
{tools}

## 输出要求
1. 先简要说明你的执行计划
2. 如需使用工具，按上述 JSON 格式调用
3. 最后给出任务执行结果（以 `## 结果` 开头）

请开始执行。"""

REFLECT_PROMPT = """\
你是一个任务评估专家。请评估以下任务的执行结果。

## 任务
- 名称: {task_name}
- 描述: {task_description}

## 执行结果
{result}

## 总体目标
{goal}

## 请判断
1. 任务是否成功完成？(completed / failed / partial)
2. 结果质量如何？(1-5分)
3. 是否需要重新规划后续任务？(yes / no)
4. 如需重规划，建议添加/修改/删除哪些任务？

## 输出格式（严格 JSON）
```json
{{
  "status": "completed",
  "quality_score": 4,
  "need_replan": false,
  "replan_suggestions": "如需重规划，在此描述"
}}
```

只输出 JSON，不要其他内容。"""

REPLAN_PROMPT = """\
你是一个任务重规划专家。根据执行反馈，调整当前的任务 DAG。

## 总体目标
{goal}

## 当前任务 DAG
{current_dag}

## 触发重规划的反馈
{feedback}

## 操作说明
你可以：
- 添加新任务（add）
- 修改已有 pending 任务的描述（modify）
- 删除 pending 任务（remove）
- 不做修改（none）

## 输出格式（严格 JSON）
```json
{{
  "action": "add|modify|remove|none",
  "tasks": [
    {{
      "id": "task_x",
      "name": "新任务",
      "description": "描述",
      "dependencies": ["task_1"],
      "operation": "add"
    }}
  ],
  "reason": "重规划的原因"
}}
```

只输出 JSON，不要其他内容。"""


# ======================================================================
# 核心 Agent 逻辑
# ======================================================================

def parse_json_from_text(text: str) -> dict:
    """从 LLM 输出中提取 JSON（兼容 markdown 代码块包裹的情况）"""
    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 尝试从 ```json ... ``` 代码块中提取
    match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # 尝试提取第一个 { ... } 块
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    raise ValueError(f"无法从 LLM 输出中解析 JSON:\n{text[:500]}")


def plan(goal: str, budget: BudgetTracker) -> TaskDAG:
    """
    阶段一：Plan — 将目标分解为 DAG 任务图
    """
    print(f"\n{C.CYAN}{'='*60}")
    print(f"  📋 阶段: Plan — 任务分解")
    print(f"{'='*60}{C.RESET}\n")

    messages = [
        {"role": "system", "content": "你是一个专业的任务规划 AI，擅长将复杂目标分解为可执行的子任务。"},
        {"role": "user", "content": PLAN_PROMPT.format(
            goal=goal,
            tools=get_tool_descriptions(),
        )},
    ]

    raw = call_llm(messages, budget, temperature=0.7, response_format={"type": "json_object"})
    data = parse_json_from_text(raw)

    dag = TaskDAG()
    for item in data.get("tasks", []):
        task = Task(
            id=item["id"],
            name=item["name"],
            description=item["description"],
            dependencies=item.get("dependencies", []),
        )
        try:
            dag.add_task(task)
            print(f"  {C.GREEN}+{C.RESET} {task.id}: {task.name}  "
                  f"{C.GRAY}依赖: {task.dependencies or '无'}{C.RESET}")
        except (CycleError, ValueError) as e:
            print(f"  {C.RED}✗{C.RESET} 跳过 {task.id}: {e}")

    print(f"\n  共 {len(dag.tasks)} 个任务，预算: {budget.summary()}")
    return dag


def execute_task(task: Task, goal: str, dag: TaskDAG, budget: BudgetTracker) -> str:
    """
    执行单个任务：构建 prompt → 调用 LLM → 解析工具调用 → 返回结果。
    """
    # 收集上游任务结果
    upstream_results = "无"
    if task.dependencies:
        parts: list[str] = []
        for dep_id in task.dependencies:
            dep = dag.get_task(dep_id)
            if dep and dep.result:
                # 截断过长的结果
                result_preview = dep.result[:2000]
                parts.append(f"### {dep.name}\n{result_preview}")
        upstream_results = "\n\n".join(parts) if parts else "无"

    messages = [
        {"role": "system", "content": "你是一个高效的任务执行 AI，能够利用工具完成具体任务。"},
        {"role": "user", "content": EXECUTE_PROMPT.format(
            task_name=task.name,
            task_description=task.description,
            goal=goal,
            upstream_results=upstream_results,
            tools=get_tool_descriptions(),
        )},
    ]

    raw = call_llm(messages, budget, temperature=0.5)

    # 解析并执行工具调用
    tools_used: list[str] = []
    tool_outputs: list[str] = []
    tool_pattern = re.compile(r'\{"tool"\s*:\s*"(\w+)"\s*,\s*"params"\s*:\s*(\{.*?\})\}', re.DOTALL)

    for match in tool_pattern.finditer(raw):
        tool_name = match.group(1)
        try:
            params = json.loads(match.group(2))
        except json.JSONDecodeError:
            tool_outputs.append(f"工具 {tool_name} 参数解析失败")
            continue

        tools_used.append(tool_name)
        result = execute_tool(tool_name, **params)
        tool_outputs.append(
            f"[{tool_name}] {'成功' if result['success'] else '失败'}: {result['output'][:1000]}"
        )

    # 如果有工具输出，让 LLM 整合结果
    if tool_outputs:
        messages.append({"role": "assistant", "content": raw})
        messages.append({
            "role": "user",
            "content": (
                "工具执行结果如下：\n"
                + "\n\n".join(tool_outputs)
                + "\n\n请根据工具结果，给出最终的任务执行结果（以 `## 结果` 开头）。"
            ),
        })
        raw = call_llm(messages, budget, temperature=0.5)

    return raw


def reflect(
    task: Task, goal: str, budget: BudgetTracker
) -> dict[str, Any]:
    """
    阶段: Reflect — 评估任务执行结果，决定是否需要重规划
    """
    messages = [
        {"role": "system", "content": "你是一个严谨的任务评估 AI。"},
        {"role": "user", "content": REFLECT_PROMPT.format(
            task_name=task.name,
            task_description=task.description,
            result=(task.result or "")[:3000],
            goal=goal,
        )},
    ]

    raw = call_llm(messages, budget, temperature=0.3, response_format={"type": "json_object"})
    return parse_json_from_text(raw)


def replan(
    dag: TaskDAG,
    goal: str,
    feedback: str,
    budget: BudgetTracker,
) -> bool:
    """
    阶段: Replan — 根据反馈调整任务 DAG。
    返回 True 表示进行了修改。
    """
    # 序列化当前 DAG
    dag_summary = json.dumps(dag.to_dict(), ensure_ascii=False, indent=2)[:4000]

    messages = [
        {"role": "system", "content": "你是一个任务重规划 AI，能够根据执行反馈动态调整任务计划。"},
        {"role": "user", "content": REPLAN_PROMPT.format(
            goal=goal,
            current_dag=dag_summary,
            feedback=feedback,
        )},
    ]

    raw = call_llm(messages, budget, temperature=0.5, response_format={"type": "json_object"})
    data = parse_json_from_text(raw)

    if data.get("action") == "none":
        return False

    modified = False
    for item in data.get("tasks", []):
        op = item.get("operation", "add")
        if op == "add":
            try:
                task = Task(
                    id=item["id"],
                    name=item["name"],
                    description=item["description"],
                    dependencies=item.get("dependencies", []),
                )
                dag.add_task(task)
                print(f"    {C.GREEN}+ 新增{C.RESET} {task.id}: {task.name}")
                modified = True
            except (CycleError, ValueError) as e:
                print(f"    {C.RED}✗ 新增失败{C.RESET} {item.get('id', '?')}: {e}")
        elif op == "modify":
            t = dag.get_task(item["id"])
            if t and t.status == TaskStatus.PENDING:
                t.description = item.get("description", t.description)
                t.name = item.get("name", t.name)
                print(f"    {C.YELLOW}~ 修改{C.RESET} {t.id}: {t.name}")
                modified = True
        elif op == "remove":
            t = dag.get_task(item["id"])
            if t and t.status == TaskStatus.PENDING:
                dag.remove_task(item["id"])
                print(f"    {C.RED}- 删除{C.RESET} {item['id']}")
                modified = True

    reason = data.get("reason", "未说明")
    if modified:
        print(f"    {C.GRAY}原因: {reason}{C.RESET}")

    return modified


# ======================================================================
# 进度可视化
# ======================================================================

def display_progress(dag: TaskDAG, budget: BudgetTracker) -> None:
    """在终端显示 DAG 进度图"""
    status_icons = {
        TaskStatus.PENDING:   f"{C.GRAY}○{C.RESET}",
        TaskStatus.RUNNING:   f"{C.YELLOW}◉{C.RESET}",
        TaskStatus.COMPLETED: f"{C.GREEN}●{C.RESET}",
        TaskStatus.FAILED:    f"{C.RED}✗{C.RESET}",
        TaskStatus.SKIPPED:   f"{C.GRAY}⊘{C.RESET}",
    }

    print(f"\n{C.BOLD}{'─'*60}")
    print(f"  📊 任务进度  Token: {budget.summary()}")
    print(f"{'─'*60}{C.RESET}")

    order = dag.topological_sort()
    for task in order:
        icon = status_icons.get(task.status, "?")
        deps_str = ""
        if task.dependencies:
            deps_str = f" {C.GRAY}← [{', '.join(task.dependencies)}]{C.RESET}"
        print(f"  {icon} {task.id}: {task.name}{deps_str}")

    print(f"{'─'*60}\n")


# ======================================================================
# JSON 持久化
# ======================================================================

def save_state(dag: TaskDAG, goal: str, budget: BudgetTracker, path: Path) -> None:
    """保存当前状态到 JSON 文件（支持断点恢复）"""
    state = {
        "goal": goal,
        "budget_used": budget.used,
        "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "dag": dag.to_dict(),
    }
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def load_state(path: Path) -> tuple[TaskDAG, str, int] | None:
    """从 JSON 文件恢复状态"""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        dag = TaskDAG.from_dict(data["dag"])
        return dag, data["goal"], data.get("budget_used", 0)
    except (json.JSONDecodeError, KeyError) as e:
        print(f"{C.YELLOW}警告: 无法加载存档 ({e})，将重新开始{C.RESET}")
        return None


# ======================================================================
# 主循环
# ======================================================================

def run_agent(
    goal: str,
    dag: TaskDAG | None = None,
    budget: BudgetTracker | None = None,
    save_path: Path = Path("tasks.json"),
) -> str:
    """
    Agent 主循环：Plan → Execute → Reflect → Replan

    返回最终交付物文本。
    """
    if budget is None:
        budget = BudgetTracker()

    # ---- Plan 阶段 ----
    if dag is None:
        dag = plan(goal, budget)
        save_state(dag, goal, budget, save_path)
        display_progress(dag, budget)

    replan_count = 0

    # ---- Execute + Reflect + Replan 循环 ----
    while not dag.is_all_done():
        if budget.exceeded:
            print(f"\n{C.RED}⚠ Token 预算已耗尽，停止执行{C.RESET}")
            break

        ready = dag.get_ready_tasks()
        if not ready:
            # 无就绪任务但 DAG 未完成 → 可能有失败的上游任务
            pending = [t for t in dag.tasks if t.status == TaskStatus.PENDING]
            if pending:
                print(f"\n{C.YELLOW}⚠ {len(pending)} 个任务因上游失败被跳过{C.RESET}")
                for t in pending:
                    dag.update_status(t.id, TaskStatus.SKIPPED)
            break

        # 并行执行就绪任务
        print(f"\n{C.CYAN}⚡ 执行 {len(ready)} 个就绪任务{C.RESET}")

        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(ready))) as pool:
            future_to_task = {}
            for task in ready:
                dag.update_status(task.id, TaskStatus.RUNNING)
                print(f"  {C.YELLOW}▶{C.RESET} {task.id}: {task.name}")
                future = pool.submit(execute_task, task, goal, dag, budget)
                future_to_task[future] = task

            for future in as_completed(future_to_task):
                task = future_to_task[future]
                try:
                    result = future.result()
                    dag.update_status(
                        task.id,
                        TaskStatus.COMPLETED,
                        result=result,
                    )
                    print(f"  {C.GREEN}✓{C.RESET} {task.id}: {task.name}")
                except Exception as e:
                    dag.update_status(
                        task.id,
                        TaskStatus.FAILED,
                        error=str(e),
                    )
                    print(f"  {C.RED}✗{C.RESET} {task.id}: {task.name} — {e}")

        # 持久化
        save_state(dag, goal, budget, save_path)
        display_progress(dag, budget)

        # ---- Reflect 阶段 ----
        # 对刚完成的任务做反思（取最后一个完成的任务作为代表）
        last_completed = [
            t for t in dag.tasks if t.status == TaskStatus.COMPLETED
        ]
        if last_completed:
            reflect_task = last_completed[-1]
            print(f"{C.MAGENTA}🔍 Reflect: 评估 '{reflect_task.name}'{C.RESET}")

            try:
                reflection = reflect(reflect_task, goal, budget)
                need_replan = reflection.get("need_replan", False)
                quality = reflection.get("quality_score", 0)
                status = reflection.get("status", "unknown")
                print(f"  状态: {status}  质量: {quality}/5  重规划: {'是' if need_replan else '否'}")

                # ---- Replan 阶段 ----
                if need_replan and replan_count < MAX_REPLAN_ROUNDS:
                    replan_count += 1
                    feedback = reflection.get("replan_suggestions", "需要调整后续任务")
                    print(f"\n{C.CYAN}🔄 Replan 第 {replan_count}/{MAX_REPLAN_ROUNDS} 轮{C.RESET}")
                    replan(dag, goal, feedback, budget)
                    save_state(dag, goal, budget, save_path)
                    display_progress(dag, budget)
                elif need_replan:
                    print(f"  {C.YELLOW}已达最大重规划次数 ({MAX_REPLAN_ROUNDS})，继续执行{C.RESET}")

            except Exception as e:
                print(f"  {C.YELLOW}Reflect 失败: {e}，继续执行{C.RESET}")

    # ---- 汇总交付物 ----
    print(f"\n{C.CYAN}{'='*60}")
    print(f"  🏁 任务完成")
    print(f"{'='*60}{C.RESET}\n")

    completed = [t for t in dag.tasks if t.status == TaskStatus.COMPLETED]
    failed = [t for t in dag.tasks if t.status == TaskStatus.FAILED]
    skipped = [t for t in dag.tasks if t.status == TaskStatus.SKIPPED]

    print(f"  {C.GREEN}完成: {len(completed)}{C.RESET}  "
          f"{C.RED}失败: {len(failed)}{C.RESET}  "
          f"{C.GRAY}跳过: {len(skipped)}{C.RESET}")
    print(f"  Token: {budget.summary()}")

    # 最终交付物 = 最后一个完成任务的结果
    final_deliverable = ""
    if completed:
        last_task = completed[-1]
        final_deliverable = last_task.result or ""
        print(f"\n{C.BOLD}最终交付物 ({last_task.name}):{C.RESET}")
        print(f"{final_deliverable[:2000]}")

    # 保存最终状态
    save_state(dag, goal, budget, save_path)
    print(f"\n{C.GRAY}状态已保存到 {save_path}{C.RESET}")

    return final_deliverable


# ======================================================================
# CLI 入口
# ======================================================================

def main() -> None:
    """命令行入口"""
    print(f"{C.BOLD}{C.CYAN}")
    print("  ╔══════════════════════════════════════╗")
    print("  ║       TaskFlow Agent v1.0            ║")
    print("  ║   蒸馏自 BabyAGI · DAG 任务引擎     ║")
    print("  ╚══════════════════════════════════════╝")
    print(f"{C.RESET}")

    # 检查 API Key
    if not OPENAI_API_KEY:
        print(f"{C.RED}错误: 请设置 OPENAI_API_KEY 环境变量{C.RESET}")
        print("  export OPENAI_API_KEY='sk-...'")
        sys.exit(1)

    # 解析参数
    goal = ""
    resume = False

    args = sys.argv[1:]
    if "--resume" in args:
        resume = True
        args.remove("--resume")
    if args:
        goal = " ".join(args)

    # 设置工作目录
    work_dir = Path("./output")
    work_dir.mkdir(exist_ok=True)
    set_work_dir(work_dir)

    save_path = Path("tasks.json")

    # 尝试恢复
    if resume:
        state = load_state(save_path)
        if state:
            dag, saved_goal, budget_used = state
            budget = BudgetTracker()
            budget.consume(budget_used)
            goal = goal or saved_goal
            print(f"{C.YELLOW}✓ 从存档恢复（已使用 {budget_used:,} tokens）{C.RESET}")
            run_agent(goal, dag=dag, budget=budget, save_path=save_path)
            return
        else:
            print(f"{C.YELLOW}未找到存档，从头开始{C.RESET}")

    if not goal:
        print(f"{C.RED}用法: python main.py \"你的目标\"{C.RESET}")
        print(f"  恢复: python main.py --resume")
        sys.exit(1)

    print(f"{C.BOLD}目标:{C.RESET} {goal}")
    print(f"{C.GRAY}模型: {MODEL_NAME}  预算: {MAX_TOKENS_BUDGET:,} tokens{C.RESET}")

    run_agent(goal, save_path=save_path)


if __name__ == "__main__":
    main()
