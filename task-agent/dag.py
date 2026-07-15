"""
TaskFlow Agent — DAG 任务依赖图实现

提供 TaskDAG 类，用于管理任务的有向无环图（DAG）。
核心能力：添加任务、环检测、拓扑排序、获取可执行任务。
"""

from __future__ import annotations

import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TaskStatus(str, Enum):
    """任务状态枚举"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class Task:
    """任务节点，包含元数据与运行时状态"""
    id: str
    name: str
    description: str
    dependencies: list[str] = field(default_factory=list)
    status: TaskStatus = TaskStatus.PENDING
    result: str | None = None
    tools_used: list[str] = field(default_factory=list)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """序列化为字典，用于 JSON 持久化"""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "dependencies": self.dependencies,
            "status": self.status.value,
            "result": self.result,
            "tools_used": self.tools_used,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Task:
        """从字典反序列化"""
        return cls(
            id=data["id"],
            name=data["name"],
            description=data["description"],
            dependencies=data.get("dependencies", []),
            status=TaskStatus(data.get("status", "pending")),
            result=data.get("result"),
            tools_used=data.get("tools_used", []),
            error=data.get("error"),
        )


class CycleError(Exception):
    """添加任务时会形成环时抛出"""
    pass


class TaskDAG:
    """
    有向无环图（DAG）任务管理器。

    - 添加任务时自动检测环
    - 支持拓扑排序获取执行顺序
    - get_ready_tasks() 返回当前可并行执行的任务
    - 线程安全的状态更新
    """

    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # 任务增删
    # ------------------------------------------------------------------

    def add_task(self, task: Task) -> None:
        """
        添加任务到 DAG。如果该任务会导致环，则抛出 CycleError 并回滚。
        """
        with self._lock:
            # 先临时插入，再做环检测；若检测到环则回滚
            if task.id in self._tasks:
                raise ValueError(f"任务 '{task.id}' 已存在")

            # 检查依赖是否存在
            for dep_id in task.dependencies:
                if dep_id not in self._tasks:
                    raise ValueError(
                        f"任务 '{task.id}' 依赖的 '{dep_id}' 不存在"
                    )

            self._tasks[task.id] = task

            if self._has_cycle():
                # 回滚：移除刚插入的任务
                del self._tasks[task.id]
                raise CycleError(
                    f"添加任务 '{task.id}' 会形成环，已回滚"
                )

    def remove_task(self, task_id: str) -> None:
        """移除任务（同时清除其他任务对它的依赖引用）"""
        with self._lock:
            if task_id not in self._tasks:
                return
            del self._tasks[task_id]
            for t in self._tasks.values():
                if task_id in t.dependencies:
                    t.dependencies.remove(task_id)

    def get_task(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    @property
    def tasks(self) -> list[Task]:
        return list(self._tasks.values())

    # ------------------------------------------------------------------
    # 调度查询
    # ------------------------------------------------------------------

    def get_ready_tasks(self) -> list[Task]:
        """
        返回所有「就绪」任务：状态为 pending 且所有依赖均已 completed。
        这些任务可以并行执行。
        """
        with self._lock:
            ready: list[Task] = []
            for task in self._tasks.values():
                if task.status != TaskStatus.PENDING:
                    continue
                deps_met = all(
                    self._tasks[dep_id].status == TaskStatus.COMPLETED
                    for dep_id in task.dependencies
                    if dep_id in self._tasks
                )
                if deps_met:
                    ready.append(task)
            return ready

    def topological_sort(self) -> list[Task]:
        """
        Kahn 算法拓扑排序，返回完整执行顺序。
        仅用于展示/调试，实际调度使用 get_ready_tasks()。
        """
        in_degree: dict[str, int] = {tid: 0 for tid in self._tasks}
        for task in self._tasks.values():
            for dep_id in task.dependencies:
                if dep_id in in_degree:
                    in_degree[task.id] += 1

        queue: deque[str] = deque(
            tid for tid, deg in in_degree.items() if deg == 0
        )
        order: list[Task] = []

        while queue:
            tid = queue.popleft()
            order.append(self._tasks[tid])
            # 找到以当前节点为依赖的下游节点
            for task in self._tasks.values():
                if tid in task.dependencies:
                    in_degree[task.id] -= 1
                    if in_degree[task.id] == 0:
                        queue.append(task.id)

        return order

    def is_all_done(self) -> bool:
        """所有任务是否都已结束（completed / failed / skipped）"""
        terminal = {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.SKIPPED}
        return all(t.status in terminal for t in self._tasks.values())

    # ------------------------------------------------------------------
    # 状态更新
    # ------------------------------------------------------------------

    def update_status(
        self,
        task_id: str,
        status: TaskStatus,
        result: str | None = None,
        error: str | None = None,
        tools_used: list[str] | None = None,
    ) -> None:
        """更新任务状态及结果"""
        with self._lock:
            task = self._tasks[task_id]
            task.status = status
            if result is not None:
                task.result = result
            if error is not None:
                task.error = error
            if tools_used is not None:
                task.tools_used = tools_used

    # ------------------------------------------------------------------
    # 序列化
    # ------------------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {tid: t.to_dict() for tid, t in self._tasks.items()}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> TaskDAG:
        dag = cls()
        for tid, tdata in data.items():
            dag._tasks[tid] = Task.from_dict(tdata)
        return dag

    # ------------------------------------------------------------------
    # 内部：环检测（DFS）
    # ------------------------------------------------------------------

    def _has_cycle(self) -> bool:
        """使用 DFS 三色标记法检测图中是否存在环"""
        WHITE, GRAY, BLACK = 0, 1, 2
        color: dict[str, int] = {tid: WHITE for tid in self._tasks}

        def dfs(node_id: str) -> bool:
            color[node_id] = GRAY
            for task in self._tasks.values():
                if node_id in task.dependencies:
                    # node_id 是 task 的前驱；但我们需要正向边
                    pass
            # 正向边：从依赖指向被依赖方的下游
            # 即 dep -> task（dep 完成后 task 才能开始）
            # 所以邻接表是 dep_id -> [task_ids that depend on dep_id]
            for downstream in self._downstream(node_id):
                if color[downstream] == GRAY:
                    return True  # 发现环
                if color[downstream] == WHITE and dfs(downstream):
                    return True
            color[node_id] = BLACK
            return False

        for tid in self._tasks:
            if color[tid] == WHITE:
                if dfs(tid):
                    return True
        return False

    def _downstream(self, task_id: str) -> list[str]:
        """获取直接下游任务 ID 列表（即依赖 task_id 的任务）"""
        return [
            t.id for t in self._tasks.values()
            if task_id in t.dependencies
        ]
