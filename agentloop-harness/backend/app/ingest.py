"""摄入领域逻辑：Agent 登记、运行快照入库、四层真值初稿抽取。

刻意不依赖 Web 框架，便于离线自检、批处理导入与单元测试。
"""
from __future__ import annotations

from typing import Any

from . import store
from .scoring import canonical_fault_type, normalize_entity


def upsert_agent(user_id: int, name: str, meta: dict | None = None) -> int:
    meta = meta or {}
    name = name or "unknown-agent"
    row = store.query_one("SELECT id FROM agents WHERE user_id=? AND name=?", (user_id, name))
    if row:
        if meta:
            store.execute(
                "UPDATE agents SET agent_type=?, version=?, framework=?, meta_json=? WHERE id=?",
                (meta.get("agent_type", "custom"), meta.get("version", ""),
                 meta.get("framework", ""), store.jdump(meta.get("meta", {})), row["id"]),
            )
        return row["id"]
    return store.execute(
        "INSERT INTO agents (user_id,name,agent_type,version,framework,meta_json,created_at) VALUES (?,?,?,?,?,?,?)",
        (user_id, name, meta.get("agent_type", "custom"), meta.get("version", ""),
         meta.get("framework", ""), store.jdump(meta.get("meta", {})), store.now()),
    )


RUN_FIELDS = (
    "agent_id", "session_id", "task", "status", "env", "model", "agent_version",
    "started_at", "ended_at", "duration_ms", "tokens_in", "tokens_out", "cost_usd",
    "tool_calls", "steps", "error_type", "error_message", "snapshot_json", "meta_json",
)


def ingest_run(user_id: int, bundle: dict) -> dict:
    """写入或覆盖一条运行快照（run + spans + signals）。"""
    run_meta = bundle.get("run") or {}
    if not run_meta.get("external_run_id"):
        raise ValueError("run.external_run_id 必填")
    agent_id = upsert_agent(user_id, run_meta.get("agent") or "unknown-agent", run_meta)

    existing = store.query_one(
        "SELECT id FROM runs WHERE user_id=? AND external_run_id=?",
        (user_id, run_meta["external_run_id"]),
    )
    values: dict[str, Any] = {
        "agent_id": agent_id,
        "session_id": run_meta.get("session_id") or "",
        "task": run_meta.get("task") or "",
        "status": run_meta.get("status") or "unknown",
        "env": run_meta.get("env") or "prod",
        "model": run_meta.get("model") or "",
        "agent_version": run_meta.get("agent_version") or "",
        "started_at": run_meta.get("started_at") or "",
        "ended_at": run_meta.get("ended_at") or "",
        "duration_ms": int(run_meta.get("duration_ms") or 0),
        "tokens_in": int(run_meta.get("tokens_in") or 0),
        "tokens_out": int(run_meta.get("tokens_out") or 0),
        "cost_usd": float(run_meta.get("cost_usd") or 0),
        "tool_calls": int(run_meta.get("tool_calls") or 0),
        "steps": int(run_meta.get("steps") or 0),
        "error_type": run_meta.get("error_type") or "",
        "error_message": (run_meta.get("error_message") or "")[:2000],
        "snapshot_json": store.jdump(bundle.get("snapshot") or {}, "{}"),
        "meta_json": store.jdump(run_meta.get("meta") or {}, "{}"),
    }

    if existing:
        run_id = existing["id"]
        assignments = ", ".join(f"{f}=?" for f in RUN_FIELDS)
        store.execute(f"UPDATE runs SET {assignments} WHERE id=?",
                      tuple(values[f] for f in RUN_FIELDS) + (run_id,))
        store.execute("DELETE FROM spans WHERE run_id=?", (run_id,))
        store.execute("DELETE FROM signals WHERE run_id=?", (run_id,))
    else:
        cols = ", ".join(("user_id", "external_run_id", *RUN_FIELDS, "created_at"))
        placeholders = ", ".join("?" for _ in range(len(RUN_FIELDS) + 3))
        run_id = store.execute(
            f"INSERT INTO runs ({cols}) VALUES ({placeholders})",
            (user_id, run_meta["external_run_id"], *(values[f] for f in RUN_FIELDS), store.now()),
        )

    span_rows = []
    for s in bundle.get("spans") or []:
        start, end = int(s.get("start_ms") or 0), int(s.get("end_ms") or 0)
        span_rows.append((
            run_id, s.get("span_id") or "", s.get("parent_span_id") or "", s.get("name") or "",
            s.get("kind") or "step", s.get("status") or "ok", start, end,
            int(s.get("duration_ms") or max(0, end - start)), store.jdump(s.get("attributes") or {}),
        ))
    if span_rows:
        store.execute_many(
            """INSERT INTO spans (run_id,span_id,parent_span_id,name,kind,status,start_ms,end_ms,duration_ms,attributes_json)
               VALUES (?,?,?,?,?,?,?,?,?,?)""", span_rows,
        )

    sig_rows = []
    for s in bundle.get("signals") or []:
        sig_rows.append((
            run_id, s.get("modality") or "log", normalize_entity(s.get("entity_key") or ""),
            s.get("entity_type") or "", s.get("name") or "", int(s.get("ts_ms") or 0),
            s.get("value"), (s.get("text") or "")[:4000], s.get("severity") or "info",
            store.jdump(s.get("payload") or {}),
        ))
    if sig_rows:
        store.execute_many(
            """INSERT INTO signals (run_id,modality,entity_key,entity_type,name,ts_ms,value,text,severity,payload_json)
               VALUES (?,?,?,?,?,?,?,?,?,?)""", sig_rows,
        )

    return {"run_id": run_id, "external_run_id": run_meta["external_run_id"],
            "spans": len(span_rows), "signals": len(sig_rows), "updated": bool(existing)}


def auto_fill_from_run(user_id: int, run: dict) -> dict:
    """从运行快照里抽取四层真值初稿，降低人工标注成本（人工复核后才是真值）。"""
    signals = store.dec_many(store.query(
        "SELECT * FROM signals WHERE run_id=? ORDER BY ts_ms", (run["id"],)))
    fault = canonical_fault_type(run.get("error_type") or "")
    if not fault:
        for s in signals:
            t = canonical_fault_type(s.get("name") or "")
            if t:
                fault = t
                break
    entity = ""
    for s in signals:
        if s.get("severity") in ("critical", "error") and s.get("entity_key"):
            entity = s["entity_key"]
            break
    if not entity:
        entity = next((s["entity_key"] for s in signals if s.get("entity_key")), "")
    chain = [s.get("name") for s in signals if s.get("name")][:8]
    evidence = [
        {"name": f"{s.get('entity_key')}·{s.get('name')}",
         "entity": s.get("entity_key"), "metric": s.get("name"),
         "keywords": [s.get("name")] if s.get("name") else []}
        for s in signals if s.get("severity") in ("critical", "error", "warn")
    ][:6]
    return {
        "fault_type": fault,
        "root_cause_entity": entity,
        "entity_key": normalize_entity(entity),
        "causal_chain": chain,
        "evidence": evidence,
    }
