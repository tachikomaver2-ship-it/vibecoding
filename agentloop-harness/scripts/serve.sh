#!/usr/bin/env bash
# AgentLoop Harness 常驻服务入口（供 launchd / systemd / nohup 调用）
#
# 与 run.sh 的区别：不打印横幅、不交互、日志走 stderr，
# 保证被进程管理器拉起时行为可预测。
#
#   scripts/serve.sh            # 前台启动（launchd 直接执行这个）
#   PORT=9000 scripts/serve.sh  # 自定义端口
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8848}"
VENV="${VENV:-$ROOT/.venv}"

if [ ! -x "$VENV/bin/python" ]; then
  echo "FATAL: $VENV 不存在，先运行 ./run.sh 完成首次安装" >&2
  exit 78  # EX_CONFIG
fi

export HARNESS_DB="${HARNESS_DB:-$ROOT/data/harness.db}"
export HARNESS_SECRET="${HARNESS_SECRET:-}"
export PYTHONPATH="$ROOT/backend:$ROOT/sdk${PYTHONPATH:+:$PYTHONPATH}"

exec "$VENV/bin/python" -m uvicorn app.api:app \
  --host "$HOST" --port "$PORT" --app-dir "$ROOT/backend"
