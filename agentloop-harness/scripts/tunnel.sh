#!/usr/bin/env bash
# AgentLoop Harness 公网隧道入口（供 launchd 调用）
#
# 启动 cloudflared Quick Tunnel，并把当前公网地址抓出来写到
#   data/public_url.txt   —— 外部脚本/告警可以读这个文件拿到最新地址
#   data/tunnel.log       —— 隧道完整日志
#
# 依赖：cloudflared（brew install cloudflared）
# 注意：Quick Tunnel 每次重启都会换域名，地址以 public_url.txt 为准。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/data"
LOG="$ROOT/data/tunnel.log"
URLFILE="$ROOT/data/public_url.txt"

CF_BIN="${CF_BIN:-$(command -v cloudflared || true)}"
if [ -z "$CF_BIN" ]; then
  for c in /opt/homebrew/bin/cloudflared /usr/local/bin/cloudflared; do
    [ -x "$c" ] && CF_BIN="$c" && break
  done
fi
if [ -z "${CF_BIN:-}" ]; then
  echo "FATAL: 找不到 cloudflared（brew install cloudflared）" >&2
  exit 66  # EX_NOINPUT
fi

PORT="${PORT:-8848}"
: > "$LOG"

# 子进程盯日志，抓到 trycloudflare.com 地址就落盘（最多等 60s）
(
  for _ in $(seq 1 60); do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)
    if [ -n "$url" ]; then
      echo "$url" > "$URLFILE"
      exit 0
    fi
    sleep 1
  done
) &

exec "$CF_BIN" tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate 2>>"$LOG"
