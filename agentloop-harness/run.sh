#!/usr/bin/env bash
# AgentLoop Harness 一键启动脚本
#
#   ./run.sh              # 启动服务（默认 127.0.0.1:8848）
#   ./run.sh --seed       # 先用内置演示数据初始化，再启动
#   ./run.sh --selfcheck  # 只跑离线自检，不启动服务
#   PORT=9000 ./run.sh    # 自定义端口
#
# 首次运行会自动创建 .venv 并安装 requirements.txt。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8848}"
VENV="${VENV:-$ROOT/.venv}"
PY_BIN="${PY_BIN:-python3}"

SEED=0
SELFCHECK=0
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --selfcheck) SELFCHECK=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$arg（可用：--seed / --selfcheck）" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------- 环境准备
if [ ! -x "$VENV/bin/python" ]; then
  echo "==> 创建虚拟环境 $VENV"
  "$PY_BIN" -m venv "$VENV"
fi

if ! "$VENV/bin/python" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "==> 安装依赖（首次运行，可能需要一两分钟）"
  "$VENV/bin/python" -m pip install --quiet --upgrade pip
  "$VENV/bin/python" -m pip install --quiet -r requirements.txt
fi

PY="$VENV/bin/python"
export HARNESS_DB="${HARNESS_DB:-$ROOT/data/harness.db}"
export PYTHONPATH="$ROOT/backend:$ROOT/sdk${PYTHONPATH:+:$PYTHONPATH}"

# ---------------------------------------------------------------- 自检模式
if [ "$SELFCHECK" = "1" ]; then
  echo "==> 离线自检（不启动服务）"
  exec "$PY" scripts/selfcheck.py
fi

# ---------------------------------------------------------------- 演示数据
if [ "$SEED" = "1" ]; then
  echo "==> 写入演示数据（14 天运行历史 / 10 个故障场景 / 实体拓扑）"
  "$PY" -c "from app import store, seed; store.init_db(); print(seed.seed())"
fi

echo "==> 启动 AgentLoop Harness"
echo "    控制台   http://$HOST:$PORT/"
echo "    API 文档 http://$HOST:$PORT/api/docs"
echo "    数据库   $HARNESS_DB"
echo "    演示账号 admin / admin123（仅在 --seed 后存在）"
echo

exec "$PY" -m uvicorn app.api:app --host "$HOST" --port "$PORT" --app-dir "$ROOT/backend"
