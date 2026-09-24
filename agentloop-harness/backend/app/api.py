"""AgentLoop Harness API。"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import os

from . import github_client, graph, optimizer, replay as replay_mod, security, store
from .ingest import auto_fill_from_run as _auto_fill_from_run, ingest_run
from .scoring import (
    FAULT_GROUPS, canonical_fault_type, fault_group_of, normalize_entity, quality_gate,
)

api = APIRouter(prefix="/api/v1")
app = FastAPI(title="AgentLoop Harness", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")

SUGGESTED_SETTINGS = {
    "github_token": "", "github_owner": "", "github_repo": "", "github_base_branch": "main",
    "agent_endpoint": "", "agent_token": "", "default_agent": "ops-agent",
    "pass_threshold": "0.75", "collection": "default",
}


# ------------------------------------------------------------------ 鉴权

def current_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    tok = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    uid = security.read_session(tok) if tok else None
    if uid is None:
        api_tok = request.headers.get("x-api-token", "").strip()
        if api_tok:
            row = store.query_one(
                "SELECT * FROM api_tokens WHERE token=? AND revoked=0", (api_tok,),
            )
            if row:
                store.execute("UPDATE api_tokens SET last_used_at=? WHERE id=?", (store.now(), row["id"]))
                uid = row["user_id"]
    if uid is None:
        raise HTTPException(status_code=401, detail="未登录或凭证已失效")
    user = store.query_one("SELECT * FROM users WHERE id=?", (uid,))
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


def _setting(user_id: int, key: str, default: str = "") -> str:
    row = store.query_one("SELECT value FROM settings WHERE user_id=? AND key=?", (user_id, key))
    return row["value"] if row and row["value"] is not None else default


def _put_setting(user_id: int, key: str, value: str) -> None:
    store.execute(
        "INSERT INTO settings (user_id,key,value) VALUES (?,?,?) "
        "ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",
        (user_id, key, value),
    )


# ------------------------------------------------------------------ 认证接口

@api.post("/auth/register")
def register(payload: dict = Body(...)) -> dict:
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    if len(username) < 3 or len(password) < 6:
        raise HTTPException(400, "用户名至少 3 位，密码至少 6 位")
    if store.query_one("SELECT id FROM users WHERE username=?", (username,)):
        raise HTTPException(409, "用户名已存在")
    uid = store.execute(
        "INSERT INTO users (username,password_hash,display_name,role,created_at) VALUES (?,?,?,?,?)",
        (username, security.hash_password(password), payload.get("display_name") or username, "owner", store.now()),
    )
    for k, v in SUGGESTED_SETTINGS.items():
        _put_setting(uid, k, v)
    _put_setting(uid, "default_agent", username + "-agent")
    store.audit(uid, "register", username)
    return {"token": security.issue_session(uid), "user": {"id": uid, "username": username}}


@api.post("/auth/login")
def login(payload: dict = Body(...)) -> dict:
    username = (payload.get("username") or "").strip()
    user = store.query_one("SELECT * FROM users WHERE username=?", (username,))
    if not user or not security.verify_password(payload.get("password") or "", user["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    store.audit(user["id"], "login", username)
    return {
        "token": security.issue_session(user["id"]),
        "user": {"id": user["id"], "username": user["username"], "display_name": user["display_name"]},
    }


@api.get("/auth/me")
def me(user: dict = Depends(current_user)) -> dict:
    return {"id": user["id"], "username": user["username"], "display_name": user["display_name"]}


# ------------------------------------------------------------------ Token / 设置

@api.get("/tokens")
def list_tokens(user: dict = Depends(current_user)) -> list[dict]:
    rows = store.query("SELECT id,name,token,created_at,last_used_at,revoked FROM api_tokens WHERE user_id=? ORDER BY id DESC", (user["id"],))
    for r in rows:
        r["token_masked"] = security.mask(r["token"])
        r.pop("token")
    return rows


@api.post("/tokens")
def create_token(payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    tok = security.new_api_token()
    tid = store.execute(
        "INSERT INTO api_tokens (user_id,name,token,created_at) VALUES (?,?,?,?)",
        (user["id"], payload.get("name") or "sdk", tok, store.now()),
    )
    store.audit(user["id"], "token.create", str(tid))
    return {"id": tid, "token": tok, "name": payload.get("name") or "sdk"}


@api.delete("/tokens/{tid}")
def revoke_token(tid: int, user: dict = Depends(current_user)) -> dict:
    store.execute("UPDATE api_tokens SET revoked=1 WHERE id=? AND user_id=?", (tid, user["id"]))
    store.audit(user["id"], "token.revoke", str(tid))
    return {"ok": True}


@api.get("/settings")
def get_settings(user: dict = Depends(current_user)) -> dict:
    rows = store.query("SELECT key,value FROM settings WHERE user_id=?", (user["id"],))
    data = {r["key"]: r["value"] for r in rows}
    for k in list(SUGGESTED_SETTINGS):
        data.setdefault(k, SUGGESTED_SETTINGS[k])
    for secret_key in ("github_token", "agent_token"):
        if data.get(secret_key):
            data[secret_key + "_set"] = True
            data[secret_key] = security.mask(security.decrypt_local(data[secret_key]), 6)
    for extra in [r["key"] for r in rows if r["key"].startswith("file:")]:
        data[extra] = (store.query_one("SELECT value FROM settings WHERE user_id=? AND key=?", (user["id"], extra)) or {}).get("value", "")
    return data


@api.put("/settings")
def put_settings(payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    for k, v in payload.items():
        if k.endswith("_set"):
            continue
        if k in ("github_token", "agent_token") and (not v or v.endswith("…") or "…" in str(v)):
            continue
        if k in ("github_token", "agent_token"):
            _put_setting(user["id"], k, security.encrypt_local(str(v)))
        else:
            _put_setting(user["id"], k, "" if v is None else str(v))
    store.audit(user["id"], "settings.update", ",".join(payload.keys()))
    return {"ok": True}


@api.post("/github/verify")
def github_verify(user: dict = Depends(current_user)) -> dict:
    token = security.decrypt_local(_setting(user["id"], "github_token"))
    owner, repo = _setting(user["id"], "github_owner"), _setting(user["id"], "github_repo")
    if not token:
        raise HTTPException(400, "未配置 GitHub Token")
    if not owner or not repo:
        raise HTTPException(400, "未配置 GitHub owner / repo")
    try:
        me_ = github_client.whoami(token)
        rp = github_client.get_repo(token, owner, repo)
    except github_client.GitHubError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {
        "login": me_.get("login"), "repo": rp.get("full_name"),
        "default_branch": rp.get("default_branch"), "private": rp.get("private"),
        "permissions": rp.get("permissions", {}),
    }


# ------------------------------------------------------------------ 上报（实现见 ingest.py）

def _ingest_or_400(user_id: int, bundle: dict) -> dict:
    try:
        return ingest_run(user_id, bundle)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

@api.post("/ingest/run")
def api_ingest_run(bundle: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    return _ingest_or_400(user["id"], bundle)


@api.post("/ingest/batch")
def api_ingest_batch(payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    results = [_ingest_or_400(user["id"], b) for b in payload.get("runs") or []]
    return {"count": len(results), "results": results}


# ------------------------------------------------------------------ 运行记录

@api.get("/agents")
def list_agents(user: dict = Depends(current_user)) -> list[dict]:
    return store.dec_many(store.query(
        """SELECT a.*, (SELECT COUNT(*) FROM runs r WHERE r.agent_id=a.id) AS run_count,
                  (SELECT COALESCE(SUM(r.cost_usd),0) FROM runs r WHERE r.agent_id=a.id) AS cost_usd
           FROM agents a WHERE a.user_id=? ORDER BY run_count DESC""", (user["id"],)))


@api.get("/runs")
def list_runs(user: dict = Depends(current_user), status: str = "", agent: str = "",
              q: str = "", limit: int = Query(50, le=500), offset: int = 0) -> dict:
    where = ["r.user_id=?"]
    params: list[Any] = [user["id"]]
    if status:
        where.append("r.status=?")
        params.append(status)
    if agent:
        where.append("a.name=?")
        params.append(agent)
    if q:
        where.append("(r.task LIKE ? OR r.error_type LIKE ? OR r.external_run_id LIKE ?)")
        params += [f"%{q}%"] * 3
    clause = " AND ".join(where)
    total = store.query_one(f"SELECT COUNT(*) AS n FROM runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE {clause}", params)["n"]
    rows = store.dec_many(store.query(
        f"""SELECT r.*, a.name AS agent_name, a.agent_type,
                   (SELECT COUNT(*) FROM signals s WHERE s.run_id=r.id) AS signal_count,
                   (SELECT COUNT(*) FROM spans s WHERE s.run_id=r.id) AS span_count,
                   (SELECT COUNT(*) FROM cases c WHERE c.source_run_id=r.id) AS case_count
            FROM runs r LEFT JOIN agents a ON a.id=r.agent_id
            WHERE {clause} ORDER BY r.created_at DESC, r.id DESC LIMIT ? OFFSET ?""",
        (*params, limit, offset),
    ))
    return {"total": total, "items": rows}


@api.get("/runs/{run_id}")
def run_detail(run_id: int, user: dict = Depends(current_user)) -> dict:
    run = store.query_one(
        "SELECT r.*, a.name AS agent_name, a.agent_type FROM runs r LEFT JOIN agents a ON a.id=r.agent_id "
        "WHERE r.id=? AND r.user_id=?", (run_id, user["id"]),
    )
    if not run:
        raise HTTPException(404, "运行记录不存在")
    run = store.dec(run)
    run["spans"] = store.dec_many(store.query("SELECT * FROM spans WHERE run_id=? ORDER BY start_ms, id", (run_id,)))
    run["signals"] = store.dec_many(store.query("SELECT * FROM signals WHERE run_id=? ORDER BY ts_ms, id LIMIT 800", (run_id,)))
    run["cases"] = store.dec_many(store.query(
        "SELECT id,case_key,title,status,fault_type FROM cases WHERE source_run_id=?", (run_id,)))
    run["modality_breakdown"] = [
        {"modality": r["modality"], "count": r["n"]}
        for r in store.query(
            "SELECT modality, COUNT(*) AS n FROM signals WHERE run_id=? GROUP BY modality", (run_id,))
    ]
    return run


@api.post("/demo/seed")
def demo_seed(request: Request, payload: dict = Body(default={})) -> dict:
    """一键生成演示数据。

    初始化引导语义：库里还没有任何用户时（首次部署）允许匿名调用并自动创建 admin；
    一旦存在用户，就必须登录后才能调用。
    """
    existing = store.query_one("SELECT id FROM users ORDER BY id LIMIT 1")
    uid = current_user(request)["id"] if existing else None
    from .seed import seed
    result = seed(user_id=uid) if uid else seed()
    store.audit(result["user_id"], "demo.seed", "",
                {k: v for k, v in result.items() if k != "optimize_summary"})
    return result


# ------------------------------------------------------------------ 统计

@api.get("/stats/overview")
def stats_overview(user: dict = Depends(current_user)) -> dict:
    uid = user["id"]
    r = store.query_one(
        """SELECT COUNT(*) AS runs,
                  SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success,
                  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
                  SUM(CASE WHEN status='partial' THEN 1 ELSE 0 END) AS partial,
                  COALESCE(SUM(tokens_in+tokens_out),0) AS tokens,
                  COALESCE(SUM(cost_usd),0) AS cost,
                  COALESCE(AVG(duration_ms),0) AS avg_duration,
                  COALESCE(AVG(tool_calls),0) AS avg_tools,
                  COALESCE(SUM(CASE WHEN error_type<>'' THEN 1 ELSE 0 END),0) AS with_error
           FROM runs WHERE user_id=?""", (uid,)) or {}
    c = store.query_one(
        """SELECT COUNT(*) AS cases,
                  SUM(CASE WHEN status='golden' THEN 1 ELSE 0 END) AS golden,
                  SUM(CASE WHEN status='badcase' THEN 1 ELSE 0 END) AS badcase,
                  SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft
           FROM cases WHERE user_id=?""", (uid,)) or {}
    cr = store.query_one(
        """SELECT COUNT(*) AS replays, COALESCE(AVG(score),0) AS avg_score,
                  SUM(CASE WHEN verdict='pass' THEN 1 ELSE 0 END) AS passed,
                  SUM(CASE WHEN verdict='fail' THEN 1 ELSE 0 END) AS failed
           FROM case_runs WHERE user_id=?""", (uid,)) or {}
    opt = store.query_one(
        """SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS pending,
                  SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted
           FROM optimizations WHERE user_id=?""", (uid,)) or {}
    runs = r.get("runs") or 0
    return {
        "runs": runs,
        "success_rate": round((r.get("success") or 0) / runs, 3) if runs else 0,
        "failed": r.get("failed") or 0,
        "partial": r.get("partial") or 0,
        "with_error": r.get("with_error") or 0,
        "tokens": r.get("tokens") or 0,
        "cost_usd": round(r.get("cost") or 0, 4),
        "avg_duration_ms": int(r.get("avg_duration") or 0),
        "avg_tool_calls": round(r.get("avg_tools") or 0, 1),
        "cases": c.get("cases") or 0,
        "golden": c.get("golden") or 0,
        "badcase": c.get("badcase") or 0,
        "draft": c.get("draft") or 0,
        "replays": cr.get("replays") or 0,
        "avg_score": round(cr.get("avg_score") or 0, 3),
        "replay_pass_rate": round((cr.get("passed") or 0) / (cr.get("replays") or 1), 3),
        "optimizations": opt.get("total") or 0,
        "optimizations_pending": opt.get("pending") or 0,
        "optimizations_submitted": opt.get("submitted") or 0,
    }


@api.get("/stats/trend")
def stats_trend(user: dict = Depends(current_user), days: int = Query(14, le=90)) -> dict:
    runs = store.query(
        """SELECT substr(COALESCE(NULLIF(started_at,''), created_at),1,10) AS day,
                  COUNT(*) AS n, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok,
                  COALESCE(SUM(tokens_in+tokens_out),0) AS tokens,
                  COALESCE(SUM(cost_usd),0) AS cost
           FROM runs WHERE user_id=? GROUP BY day ORDER BY day DESC LIMIT ?""",
        (user["id"], days),
    )
    scores = store.query(
        """SELECT substr(created_at,1,10) AS day, COALESCE(AVG(score),0) AS avg_score, COUNT(*) AS n
           FROM case_runs WHERE user_id=? GROUP BY day ORDER BY day DESC LIMIT ?""",
        (user["id"], days),
    )
    by_day = {r["day"]: r for r in scores}
    items = []
    for r in sorted(runs, key=lambda x: x["day"]):
        s = by_day.get(r["day"], {})
        items.append({
            "day": r["day"], "runs": r["n"], "success": r["ok"],
            "tokens": r["tokens"], "cost": round(r["cost"], 4),
            "avg_score": round(s.get("avg_score") or 0, 3), "replays": s.get("n") or 0,
        })
    return {"items": items}


@api.get("/stats/faults")
def stats_faults(user: dict = Depends(current_user)) -> dict:
    uid = user["id"]
    cases = store.query("SELECT fault_type, status FROM cases WHERE user_id=?", (uid,))
    by_group: dict[str, dict] = {}
    by_type: dict[str, int] = {}
    for c in cases:
        t = canonical_fault_type(c["fault_type"]) or "unclassified"
        g = fault_group_of(t) or "unclassified"
        by_group.setdefault(g, {"group": g, "total": 0, "golden": 0, "badcase": 0})
        by_group[g]["total"] += 1
        if c["status"] == "golden":
            by_group[g]["golden"] += 1
        if c["status"] == "badcase":
            by_group[g]["badcase"] += 1
        by_type[t] = by_type.get(t, 0) + 1
    errors = store.query(
        """SELECT error_type, COUNT(*) AS n FROM runs WHERE user_id=? AND error_type<>''
           GROUP BY error_type ORDER BY n DESC LIMIT 15""", (uid,))
    return {
        "by_group": sorted(by_group.values(), key=lambda x: -x["total"]),
        "by_type": sorted(({"type": k, "count": v} for k, v in by_type.items()), key=lambda x: -x["count"]),
        "top_errors": errors,
        "declared_groups": list(FAULT_GROUPS.keys()),
    }


@api.get("/stats/dimensions")
def stats_dimensions(user: dict = Depends(current_user)) -> dict:
    rows = store.query(
        """SELECT agent_version, mode, score, score_fault, score_entity, score_process, verdict, created_at
           FROM case_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 500""", (user["id"],))
    if not rows:
        return {"items": [], "latest": None}
    mode_map: dict[str, dict] = {}
    for r in rows:
        m = r["mode"]
        d = mode_map.setdefault(m, {"mode": m, "n": 0, "fault": 0.0, "entity": 0.0, "process": 0.0, "score": 0.0})
        d["n"] += 1
        d["fault"] += r["score_fault"] or 0
        d["entity"] += r["score_entity"] or 0
        d["process"] += r["score_process"] or 0
        d["score"] += r["score"] or 0
    for d in mode_map.values():
        n = d["n"] or 1
        d["fault"] = round(d["fault"] / n, 3)
        d["entity"] = round(d["entity"] / n, 3)
        d["process"] = round(d["process"] / n, 3)
        d["score"] = round(d["score"] / n, 3)
    return {"items": list(mode_map.values()), "latest": rows[0]}


# ------------------------------------------------------------------ 实体与分类

@api.get("/entities")
def list_entities(user: dict = Depends(current_user)) -> dict:
    edges = graph.load_edges(user["id"])
    return {"items": graph.entity_catalog(user["id"], edges), "edge_count": sum(len(v) for v in edges.values()) // 2}


@api.post("/entities")
def create_entity(payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    key = normalize_entity(payload.get("entity_key") or payload.get("canonical") or "")
    if not key:
        raise HTTPException(400, "entity_key 必填")
    store.execute(
        """INSERT INTO entities (user_id,entity_key,canonical,etype,layer,aliases_json,parent_key,meta_json)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id,entity_key) DO UPDATE SET canonical=excluded.canonical, etype=excluded.etype,
             layer=excluded.layer, aliases_json=excluded.aliases_json, parent_key=excluded.parent_key""",
        (user["id"], key, payload.get("canonical") or key, payload.get("etype") or "service",
         payload.get("layer") or "app", store.jdump(payload.get("aliases") or [], "[]"),
         normalize_entity(payload.get("parent_key") or ""), store.jdump(payload.get("meta") or {})),
    )
    return {"ok": True, "entity_key": key}


@api.get("/entities/topology")
def topology(user: dict = Depends(current_user)) -> dict:
    edges = graph.load_edges(user["id"])
    nodes = [{"key": k, "degree": len(v)} for k, v in edges.items()]
    links = []
    seen = set()
    for a, nbs in edges.items():
        for b in nbs:
            sig = tuple(sorted((a, b)))
            if sig in seen:
                continue
            seen.add(sig)
            links.append({"source": a, "target": b})
    return {"nodes": nodes, "links": links}


@api.get("/taxonomy")
def taxonomy() -> dict:
    return graph.fault_taxonomy_payload()


# ------------------------------------------------------------------ 案例库

def _case_full(user_id: int, case_id: int) -> dict:
    row = store.query_one("SELECT * FROM cases WHERE id=? AND user_id=?", (case_id, user_id))
    if not row:
        raise HTTPException(404, "案例不存在")
    case = store.dec(row)
    if case.get("source_run_id"):
        case["run"] = store.dec(store.query_one(
            "SELECT r.*, a.name AS agent_name FROM runs r LEFT JOIN agents a ON a.id=r.agent_id WHERE r.id=?",
            (case["source_run_id"],)))
        case["signals"] = store.dec_many(store.query(
            "SELECT * FROM signals WHERE run_id=? ORDER BY ts_ms LIMIT 500", (case["source_run_id"],)))
        case["spans"] = store.dec_many(store.query(
            "SELECT * FROM spans WHERE run_id=? ORDER BY start_ms LIMIT 300", (case["source_run_id"],)))
    else:
        case["run"] = None
        case["signals"] = []
        case["spans"] = []
    case["history"] = replay_mod.case_run_history(case_id)
    case["latest_run"] = case["history"][0] if case["history"] else None
    case["optimizations"] = store.dec_many(store.query(
        "SELECT id,title,status,category FROM optimizations WHERE user_id=? AND case_ids_json LIKE ?",
        (user_id, f"%{case_id}%")))
    return case


@api.get("/cases")
def list_cases(user: dict = Depends(current_user), status: str = "", group: str = "",
               q: str = "", limit: int = Query(200, le=1000)) -> dict:
    where = ["c.user_id=?"]
    params: list[Any] = [user["id"]]
    if status:
        where.append("c.status=?")
        params.append(status)
    if group:
        where.append("c.fault_group=?")
        params.append(group)
    if q:
        where.append("(c.title LIKE ? OR c.case_key LIKE ? OR c.fault_type LIKE ?)")
        params += [f"%{q}%"] * 3
    rows = store.dec_many(store.query(
        f"""SELECT c.*, r.score AS last_score, r.verdict AS last_verdict, r.score_fault, r.score_entity,
                   r.score_process, r.created_at AS last_run_at, r.id AS last_run_id,
                   (SELECT COUNT(*) FROM case_runs cr WHERE cr.case_id=c.id) AS replay_count
            FROM cases c
            LEFT JOIN case_runs r ON r.id=(SELECT id FROM case_runs WHERE case_id=c.id ORDER BY created_at DESC, id DESC LIMIT 1)
            WHERE {' AND '.join(where)} ORDER BY c.updated_at DESC LIMIT ?""",
        (*params, limit),
    ))
    counts = store.query_one(
        """SELECT SUM(CASE WHEN status='golden' THEN 1 ELSE 0 END) AS golden,
                  SUM(CASE WHEN status='badcase' THEN 1 ELSE 0 END) AS badcase,
                  SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) AS draft,
                  COUNT(*) AS total FROM cases WHERE user_id=?""", (user["id"],)) or {}
    return {"items": rows, "counts": counts}


@api.post("/cases")
def create_case(payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    run = None
    if payload.get("source_run_id"):
        run = store.dec(store.query_one("SELECT * FROM runs WHERE id=? AND user_id=?",
                                        (payload["source_run_id"], user["id"])))
        if not run:
            raise HTTPException(404, "来源运行记录不存在")
    auto = _auto_fill_from_run(user["id"], run) if run else {}
    seq = (store.query_one("SELECT COUNT(*) AS n FROM cases WHERE user_id=?", (user["id"],))["n"] or 0) + 1
    case_key = payload.get("case_key") or f"{run['external_run_id'] if run else 'case'}-{seq:03d}"
    fault = canonical_fault_type(payload.get("fault_type") or auto.get("fault_type") or "") or (payload.get("fault_type") or "")
    entity = normalize_entity(payload.get("root_cause_entity") or payload.get("entity_key") or auto.get("entity_key") or "")
    cid = store.execute(
        """INSERT INTO cases (user_id,case_key,title,source_run_id,status,difficulty,tags_json,fault_type,
           fault_group,root_cause_entity,entity_key,expected_json,causal_chain_json,evidence_json,
           replay_json,quality_json,notes,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            user["id"], case_key,
            payload.get("title") or (run.get("task") if run else "未命名案例") or "未命名案例",
            payload.get("source_run_id"), payload.get("status") or "draft",
            payload.get("difficulty") or "L2", store.jdump(payload.get("tags") or [], "[]"),
            fault, fault_group_of(fault), entity or (auto.get("root_cause_entity") or ""), entity,
            store.jdump(payload.get("expected") or {"alert": (run.get("error_message") if run else "") or ""}),
            store.jdump(payload.get("causal_chain") or auto.get("causal_chain") or [], "[]"),
            store.jdump(payload.get("evidence") or auto.get("evidence") or [], "[]"),
            store.jdump(payload.get("replay") or {}, "{}"), store.jdump({}, "{}"),
            payload.get("notes") or "", store.now(), store.now(),
        ),
    )
    store.audit(user["id"], "case.create", case_key)
    gate = quality_gate(store.dec(store.query_one("SELECT * FROM cases WHERE id=?", (cid,))),
                        store.dec_many(store.query("SELECT * FROM signals WHERE run_id=?",
                                                   (payload.get("source_run_id"),))) if payload.get("source_run_id") else [],
                        graph.load_edges(user["id"]))
    store.execute("UPDATE cases SET quality_json=?, updated_at=? WHERE id=?",
                  (store.jdump(gate), store.now(), cid))
    return {"id": cid, "case_key": case_key, "quality": gate}


@api.get("/cases/{case_id}")
def get_case(case_id: int, user: dict = Depends(current_user)) -> dict:
    return _case_full(user["id"], case_id)


@api.put("/cases/{case_id}")
def update_case(case_id: int, payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    row = store.query_one("SELECT * FROM cases WHERE id=? AND user_id=?", (case_id, user["id"]))
    if not row:
        raise HTTPException(404, "案例不存在")
    case = store.dec(row)
    fault = payload.get("fault_type", case.get("fault_type") or "")
    fault = canonical_fault_type(fault) or fault
    entity = normalize_entity(payload.get("root_cause_entity", case.get("root_cause_entity") or "")
                              or payload.get("entity_key", "") or "")
    store.execute(
        """UPDATE cases SET title=?, status=?, difficulty=?, tags_json=?, fault_type=?, fault_group=?,
           root_cause_entity=?, entity_key=?, expected_json=?, causal_chain_json=?, evidence_json=?,
           replay_json=?, notes=?, updated_at=? WHERE id=?""",
        (
            payload.get("title", case.get("title")),
            payload.get("status", case.get("status")),
            payload.get("difficulty", case.get("difficulty")),
            store.jdump(payload.get("tags", case.get("tags") or []), "[]"),
            fault, fault_group_of(fault),
            payload.get("root_cause_entity", case.get("root_cause_entity")) or entity, entity,
            store.jdump(payload.get("expected", case.get("expected") or {})),
            store.jdump(payload.get("causal_chain", case.get("causal_chain") or []), "[]"),
            store.jdump(payload.get("evidence", case.get("evidence") or []), "[]"),
            store.jdump(payload.get("replay", case.get("replay") or {}), "{}"),
            payload.get("notes", case.get("notes")), store.now(), case_id,
        ),
    )
    full = _case_full(user["id"], case_id)
    gate = quality_gate(full, full.get("signals") or [], graph.load_edges(user["id"]))
    store.execute("UPDATE cases SET quality_json=?, updated_at=? WHERE id=?",
                  (store.jdump(gate), store.now(), case_id))
    store.audit(user["id"], "case.update", case["case_key"])
    full["quality"] = gate
    return full


@api.post("/cases/{case_id}/gate")
def run_gate(case_id: int, user: dict = Depends(current_user)) -> dict:
    full = _case_full(user["id"], case_id)
    gate = quality_gate(full, full.get("signals") or [], graph.load_edges(user["id"]))
    store.execute("UPDATE cases SET quality_json=?, updated_at=? WHERE id=?",
                  (store.jdump(gate), store.now(), case_id))
    return gate


@api.post("/cases/{case_id}/status")
def set_case_status(case_id: int, payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    status = payload.get("status") or "draft"
    if status not in ("draft", "golden", "badcase", "deprecated", "candidate"):
        raise HTTPException(400, "非法状态")
    row = store.query_one("SELECT * FROM cases WHERE id=? AND user_id=?", (case_id, user["id"]))
    if not row:
        raise HTTPException(404, "案例不存在")
    if status == "golden":
        full = _case_full(user["id"], case_id)
        gate = quality_gate(full, full.get("signals") or [], graph.load_edges(user["id"]))
        if not gate["passed"]:
            raise HTTPException(400, "未通过 GSTO 质量门禁，不能沉淀为黄金案例：" +
                                "；".join(f"{c['name']}({c['note']})" for c in gate["checks"] if not c["passed"]))
    store.execute("UPDATE cases SET status=?, updated_at=? WHERE id=?", (status, store.now(), case_id))
    store.audit(user["id"], "case.status", f"{row['case_key']} → {status}")
    return {"ok": True, "status": status}


@api.delete("/cases/{case_id}")
def delete_case(case_id: int, user: dict = Depends(current_user)) -> dict:
    store.execute("DELETE FROM case_runs WHERE case_id=? AND user_id=?", (case_id, user["id"]))
    store.execute("DELETE FROM cases WHERE id=? AND user_id=?", (case_id, user["id"]))
    store.audit(user["id"], "case.delete", str(case_id))
    return {"ok": True}


@api.get("/cases/{case_id}/export")
def export_case(case_id: int, user: dict = Depends(current_user)) -> JSONResponse:
    full = _case_full(user["id"], case_id)
    return JSONResponse(replay_mod.export_case(full, full.get("latest_run")))


@api.get("/cases/{case_id}/runs")
def case_runs(case_id: int, user: dict = Depends(current_user)) -> list[dict]:
    return replay_mod.case_run_history(case_id)


# ------------------------------------------------------------------ 回放

@api.post("/replay/case/{case_id}")
def replay_case(case_id: int, payload: dict = Body(default={}), user: dict = Depends(current_user)) -> dict:
    row = store.query_one("SELECT * FROM cases WHERE id=? AND user_id=?", (case_id, user["id"]))
    if not row:
        raise HTTPException(404, "案例不存在")
    mode = payload.get("mode") or "offline"
    endpoint = payload.get("endpoint") or _setting(user["id"], "agent_endpoint")
    return replay_mod.run_replay(
        user["id"], store.dec(row), mode=mode, endpoint=endpoint,
        agent_version=payload.get("agent_version") or "manual", mark_status=payload.get("mark_status"),
    )


@api.post("/replay/suite")
def replay_suite(payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    ids = payload.get("case_ids") or []
    if not ids:
        status = payload.get("status") or "golden"
        rows = store.query("SELECT id FROM cases WHERE user_id=? AND status=?", (user["id"], status))
        ids = [r["id"] for r in rows]
    if not ids:
        raise HTTPException(400, "没有可回放的案例")
    return replay_mod.run_suite(
        user["id"], ids, mode=payload.get("mode") or "offline",
        endpoint=payload.get("endpoint") or _setting(user["id"], "agent_endpoint"),
        agent_version=payload.get("agent_version") or "manual",
    )


# ------------------------------------------------------------------ 优化建议

@api.post("/optimize/analyze")
def optimize_analyze(payload: dict = Body(default={}), user: dict = Depends(current_user)) -> dict:
    statuses = tuple(payload.get("statuses") or ["badcase"])
    result = optimizer.analyze(user["id"], statuses)
    store.audit(user["id"], "optimize.analyze", ",".join(statuses), result["clusters"])
    return result


@api.get("/optimizations")
def list_optimizations(user: dict = Depends(current_user), status: str = "") -> list[dict]:
    sql = "SELECT * FROM optimizations WHERE user_id=?"
    params: list[Any] = [user["id"]]
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY created_at DESC, id DESC"
    return [optimizer.optimization_view(r) for r in store.query(sql, params)]


@api.get("/optimizations/{oid}")
def get_optimization(oid: int, user: dict = Depends(current_user)) -> dict:
    row = store.query_one("SELECT * FROM optimizations WHERE id=? AND user_id=?", (oid, user["id"]))
    if not row:
        raise HTTPException(404, "优化建议不存在")
    return optimizer.optimization_view(row)


@api.put("/optimizations/{oid}")
def update_optimization(oid: int, payload: dict = Body(...), user: dict = Depends(current_user)) -> dict:
    row = store.query_one("SELECT * FROM optimizations WHERE id=? AND user_id=?", (oid, user["id"]))
    if not row:
        raise HTTPException(404, "优化建议不存在")
    cur = store.dec(row)
    fields = {
        "title": payload.get("title", cur.get("title")),
        "status": payload.get("status", cur.get("status")),
        "new_content": payload.get("new_content", cur.get("new_content")),
        "patch": payload.get("patch", cur.get("patch")),
        "target_path": payload.get("target_path", cur.get("target_path")),
        "rationale": payload.get("rationale", cur.get("rationale")),
    }
    store.execute(
        """UPDATE optimizations SET title=?,status=?,new_content=?,patch=?,target_path=?,rationale=?,
           updated_at=? WHERE id=?""",
        (*fields.values(), store.now(), oid),
    )
    if fields["status"] not in ("draft", "approved", "submitted", "rejected"):
        raise HTTPException(400, "非法状态")
    store.audit(user["id"], "optimization.update", f"#{oid} → {fields['status']}")
    return optimizer.optimization_view(store.query_one("SELECT * FROM optimizations WHERE id=?", (oid,)))


@api.post("/optimizations/{oid}/submit")
def submit_optimization(oid: int, payload: dict = Body(default={}), user: dict = Depends(current_user)) -> dict:
    row = store.query_one("SELECT * FROM optimizations WHERE id=? AND user_id=?", (oid, user["id"]))
    if not row:
        raise HTTPException(404, "优化建议不存在")
    opt = optimizer.optimization_view(row)
    if opt.get("status") == "rejected":
        raise HTTPException(400, "已拒绝的建议不能提交")
    token = security.decrypt_local(_setting(user["id"], "github_token"))
    owner = payload.get("owner") or _setting(user["id"], "github_owner")
    repo = payload.get("repo") or _setting(user["id"], "github_repo")
    base = payload.get("base_branch") or _setting(user["id"], "github_base_branch") or "main"
    if not token:
        raise HTTPException(400, "请先在「设置」中配置 GitHub Token")
    if not owner or not repo:
        raise HTTPException(400, "请先配置 GitHub owner / repo")
    case_index = {}
    for cid in opt.get("case_ids") or []:
        full = _case_full(user["id"], cid)
        case_index[cid] = replay_mod.export_case(full, full.get("latest_run"))
    try:
        result = github_client.submit_optimization(token, owner, repo, base, opt, case_index)
    except github_client.GitHubError as exc:
        store.audit(user["id"], "optimization.submit.failed", f"#{oid}", {"error": str(exc)})
        raise HTTPException(400, str(exc)) from exc
    store.execute(
        "UPDATE optimizations SET status='submitted', gh_branch=?, gh_commit=?, gh_pr=?, updated_at=? WHERE id=?",
        (result["branch"], result["files"][0]["commit"] if result["files"] else "",
         str(result.get("pr_number") or ""), store.now(), oid),
    )
    store.audit(user["id"], "optimization.submit", f"#{oid} → {result['branch']}", result)
    return result


@api.get("/audit")
def audit_log(user: dict = Depends(current_user), limit: int = Query(100, le=500)) -> list[dict]:
    return store.dec_many(store.query(
        "SELECT * FROM audit_log WHERE user_id=? ORDER BY id DESC LIMIT ?", (user["id"], limit)))


@api.get("/health")
def health() -> dict:
    return {"ok": True, "ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "service": "agentloop-harness"}


# ------------------------------------------------------------------ 路由挂载

app.include_router(api)

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "web")


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.init_db()
    yield


app.router.lifespan_context = lifespan
store.init_db()  # 直接 import 本模块（SDK / 自检场景）也能拿到可用 schema

if os.path.isdir(WEB_DIR):
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
