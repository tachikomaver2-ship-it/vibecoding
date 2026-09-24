#!/usr/bin/env bash
# 守护进程监督器：崩溃自动重启（launchd KeepAlive 的脚本版）
#
#   supervise.sh <name> <command> [args...]
#
# - TERM/INT 时把信号转发给子进程并优雅退出
# - 子进程意外退出后等 5 秒重启，重启事件记入 data/supervisor.log
set -u

NAME="$1"; shift
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/data/supervisor.log"
CHILD=""

on_term() {
  [ -n "$CHILD" ] && kill -TERM "$CHILD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  echo "$(date '+%F %T') [$NAME] 收到停止信号，退出" >>"$LOG"
  exit 0
}
trap on_term TERM INT

mkdir -p "$ROOT/data"
echo "$(date '+%F %T') [$NAME] supervisor 启动：$*" >>"$LOG"

while true; do
  "$@" &
  CHILD=$!
  wait "$CHILD"
  CODE=$?
  echo "$(date '+%F %T') [$NAME] 子进程退出 code=${CODE}，5 秒后重启" >>"$LOG"
  sleep 5
done
