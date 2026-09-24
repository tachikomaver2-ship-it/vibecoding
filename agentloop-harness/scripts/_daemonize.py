#!/usr/bin/env python3
"""双 fork 守护化启动器（macOS 无 setsid(1)，用这个替代）。

用法：
    _daemonize.py <logfile> <command> [args...]

父进程打印守护进程 PID 后退出；守护进程脱离会话并重定向日志。
"""
import os
import sys


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit("usage: _daemonize.py <logfile> <command> [args...]")
    logfile, cmd = sys.argv[1], sys.argv[2:]

    if os.fork() > 0:
        return  # 祖进程直接退出；PID 由中间进程负责回传
    # 中间进程：新会话，脱离控制终端
    os.setsid()
    pid2 = os.fork()
    if pid2 > 0:
        # 真正的守护进程是孙进程，把它的 PID 打给调用方后退出
        print(pid2)
        sys.stdout.flush()
        os._exit(0)
    # 孙进程：重定向 stdio 后 exec 目标命令
    log = open(logfile, "ab", buffering=0)
    os.chdir("/")
    os.dup2(log.fileno(), 1)
    os.dup2(log.fileno(), 2)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.execvp(cmd[0], cmd)


if __name__ == "__main__":
    main()
