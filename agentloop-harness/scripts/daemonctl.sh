#!/usr/bin/env bash
# AgentLoop Harness 常驻服务管理器
#
#   scripts/daemonctl.sh start    # 启动 server + tunnel（未运行才启）
#   scripts/daemonctl.sh stop     # 停止全部
#   scripts/daemonctl.sh restart  # 重启全部
#   scripts/daemonctl.sh status   # 查看状态与当前公网地址
#
# 守护方式：双 fork 脱离会话 + supervise.sh 崩溃自动重启。
# 服务日志：data/server.log / data/tunnel.log
# 监督日志：data/supervisor.log
# 公网地址：data/public_url.txt（Quick Tunnel 每次重启会换域名）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
mkdir -p data

PY="${PY:-$ROOT/.venv/bin/python}"
[ -x "$PY" ] || PY=python3

SERVICES=(server tunnel)
pid_of() { [ -f "data/$1.pid" ] && cat "data/$1.pid" || true; }
alive()  { local p; p="$(pid_of "$1")"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

start_one() {
  local name="$1"
  if alive "$name"; then
    echo "$name: 已在运行 (pid $(pid_of "$name"))"
    return
  fi
  local log pid
  local -a args
  case "$name" in
    server) log=data/server.log; args=(server bash "$ROOT/scripts/serve.sh") ;;
    tunnel) log=data/tunnel.log; args=(tunnel bash "$ROOT/scripts/tunnel.sh") ;;
  esac
  pid="$("$PY" scripts/_daemonize.py "$ROOT/$log" \
    /bin/bash "$ROOT/scripts/supervise.sh" "${args[@]}")"
  echo "$pid" >"data/$name.pid"
  echo "$name: 已启动 (pid $pid)"
}

stop_one() {
  local name="$1" p
  p="$(pid_of "$name")"
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
    kill -TERM "$p" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$p" 2>/dev/null || break
      sleep 0.25
    done
    echo "$name: 已停止 (pid $p)"
  else
    echo "$name: 未在运行"
  fi
  rm -f "data/$name.pid"
}

status() {
  local rc=0
  for name in "${SERVICES[@]}"; do
    if alive "$name"; then
      echo "$name: 运行中 (pid $(pid_of "$name"))"
    else
      echo "$name: 未运行"
      rc=1
    fi
  done
  curl -s --noproxy '*' -o /dev/null -m 3 http://127.0.0.1:8848/api/v1/health \
    && echo "health: http://127.0.0.1:8848 OK" || echo "health: 不可达"
  if [ -f data/public_url.txt ]; then
    echo "公网地址: $(cat data/public_url.txt)"
  else
    echo "公网地址: 尚未就绪（tunnel 启动后约 5-10 秒生成）"
  fi
  exit $rc
}

case "${1:-help}" in
  start)   for n in "${SERVICES[@]}"; do start_one "$n"; done ;;
  stop)    for n in "${SERVICES[@]}"; do stop_one "$n"; done ;;
  restart) for n in "${SERVICES[@]}"; do stop_one "$n"; done
           sleep 1
           for n in "${SERVICES[@]}"; do start_one "$n"; done ;;
  status)  status ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac
