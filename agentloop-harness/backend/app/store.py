"""SQLite 存储层：建表 + 通用读写助手。"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any, Iterable

DB_PATH = os.environ.get("HARNESS_DB", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "harness.db"))

_local = threading.local()

SCHEMA = """
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  role TEXT DEFAULT 'owner',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT DEFAULT '',
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  agent_type TEXT DEFAULT 'custom',
  version TEXT DEFAULT '',
  framework TEXT DEFAULT '',
  meta_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  agent_id INTEGER,
  external_run_id TEXT NOT NULL,
  session_id TEXT DEFAULT '',
  task TEXT DEFAULT '',
  status TEXT DEFAULT 'unknown',
  env TEXT DEFAULT 'prod',
  model TEXT DEFAULT '',
  agent_version TEXT DEFAULT '',
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  steps INTEGER DEFAULT 0,
  error_type TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  snapshot_json TEXT DEFAULT '{}',
  meta_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, external_run_id)
);

CREATE TABLE IF NOT EXISTS spans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'step',
  status TEXT DEFAULT 'ok',
  start_ms INTEGER DEFAULT 0,
  end_ms INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  attributes_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  modality TEXT NOT NULL,
  entity_key TEXT DEFAULT '',
  entity_type TEXT DEFAULT '',
  name TEXT DEFAULT '',
  ts_ms INTEGER DEFAULT 0,
  value REAL,
  text TEXT DEFAULT '',
  severity TEXT DEFAULT 'info',
  payload_json TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  entity_key TEXT NOT NULL,
  canonical TEXT NOT NULL,
  etype TEXT DEFAULT 'service',
  layer TEXT DEFAULT 'app',
  aliases_json TEXT DEFAULT '[]',
  parent_key TEXT DEFAULT '',
  meta_json TEXT DEFAULT '{}',
  UNIQUE (user_id, entity_key)
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  case_key TEXT NOT NULL,
  title TEXT NOT NULL,
  source_run_id INTEGER,
  status TEXT DEFAULT 'draft',
  difficulty TEXT DEFAULT 'L2',
  tags_json TEXT DEFAULT '[]',
  fault_type TEXT DEFAULT '',
  fault_group TEXT DEFAULT '',
  root_cause_entity TEXT DEFAULT '',
  entity_key TEXT DEFAULT '',
  expected_json TEXT DEFAULT '{}',
  causal_chain_json TEXT DEFAULT '[]',
  evidence_json TEXT DEFAULT '[]',
  replay_json TEXT DEFAULT '{}',
  quality_json TEXT DEFAULT '{}',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, case_key)
);

CREATE TABLE IF NOT EXISTS case_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  mode TEXT DEFAULT 'offline',
  agent_version TEXT DEFAULT '',
  verdict TEXT DEFAULT 'unknown',
  score REAL DEFAULT 0,
  score_fault REAL DEFAULT 0,
  score_entity REAL DEFAULT 0,
  score_process REAL DEFAULT 0,
  baseline_score REAL,
  detail_json TEXT DEFAULT '{}',
  transcript_json TEXT DEFAULT '{}',
  latency_ms INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS optimizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'prompt',
  target_type TEXT DEFAULT 'prompt',
  target_path TEXT DEFAULT '',
  rationale TEXT DEFAULT '',
  patch TEXT DEFAULT '',
  new_content TEXT DEFAULT '',
  case_ids_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  evidence_json TEXT DEFAULT '{}',
  gh_branch TEXT DEFAULT '',
  gh_commit TEXT DEFAULT '',
  gh_pr TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_run ON spans(run_id);
CREATE INDEX IF NOT EXISTS idx_signals_run ON signals(run_id, modality);
CREATE INDEX IF NOT EXISTS idx_cases_user ON cases(user_id, status);
CREATE INDEX IF NOT EXISTS idx_case_runs_case ON case_runs(case_id, created_at DESC);
"""


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        c = sqlite3.connect(DB_PATH, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        _local.conn = c
    return c


def init_db() -> None:
    c = conn()
    c.executescript(SCHEMA)
    c.commit()


def query(sql: str, params: Iterable[Any] = ()) -> list[dict]:
    cur = conn().execute(sql, tuple(params))
    return [dict(r) for r in cur.fetchall()]


def query_one(sql: str, params: Iterable[Any] = ()) -> dict | None:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    c = conn()
    cur = c.execute(sql, tuple(params))
    c.commit()
    return cur.lastrowid


def execute_many(sql: str, seq: Iterable[Iterable[Any]]) -> None:
    c = conn()
    c.executemany(sql, [tuple(s) for s in seq])
    c.commit()


JSON_FIELDS = {
    "meta_json", "snapshot_json", "attributes_json", "payload_json", "aliases_json",
    "tags_json", "expected_json", "causal_chain_json", "evidence_json", "replay_json",
    "quality_json", "detail_json", "transcript_json", "case_ids_json", "evidence_json",
}


def dec(row: dict) -> dict:
    """把 *_json 字段解码成 Python 对象，并去掉后缀方便前端使用。"""
    out: dict[str, Any] = {}
    for k, v in row.items():
        if k.endswith("_json"):
            key = k[: -len("_json")]
            try:
                out[key] = json.loads(v) if v else None
            except (TypeError, ValueError):
                out[key] = v
        else:
            out[k] = v
    return out


def dec_many(rows: list[dict]) -> list[dict]:
    return [dec(r) for r in rows]


def jdump(value: Any, default: str = "{}") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def audit(user_id: int | None, action: str, target: str = "", detail: Any = None) -> None:
    execute(
        "INSERT INTO audit_log (user_id, action, target, detail_json, created_at) VALUES (?,?,?,?,?)",
        (user_id, action, target, jdump(detail, "{}"), now()),
    )
