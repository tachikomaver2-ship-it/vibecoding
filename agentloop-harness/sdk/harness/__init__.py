"""AgentLoop Harness 上报 SDK。

两种用法：
  1. 代码埋点：Harness(...).run() 上下文管理器，自动收集 trace/metrics/logs 快照并上报；
  2. 包裹式录制：harness record -- python your_agent.py，捕获进程输出与耗时为信号。

零依赖（只用标准库），可嵌进任何本地 Agent。
"""
__version__ = "1.0.0"

from .client import HarnessClient, HarnessError  # noqa: F401
from .recorder import Harness, RunRecorder  # noqa: F401

__all__ = ["Harness", "RunRecorder", "HarnessClient", "HarnessError", "__version__"]
