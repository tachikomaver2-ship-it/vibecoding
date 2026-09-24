"""回放引擎：把案例快照重新喂给被测 Agent（或打分器），产出可复跑、可对比的分数。"""
from __future__ import annotations

import time
from typing import Any

from . import store
from .graph import load_edges
from .scoring import score_case

MODES = ("offline", "live", "snapshot")


def build_replay_input(case: dict, signals: list[dict]) -> dict:
    """构造被测 Agent 可见的输入：任务描述 + 观测数据摘要（不含真值）。"""
    summary: dict[str, list[dict]] = {}
    for s in signals:
        summary.setdefault(s.get("modality", "unknown"), []).append({
            "entity": s.get("entity_key"),
            "name": s.get("name"),
            "value": s.get("value"),
            "text": s.get("text"),
            "severity": s.get("severity"),
            "ts_ms": s.get("ts_ms"),
        })
    return {
        "task": case.get("title") or case.get("case_key"),
        "case_key": case.get("case_key"),
        "alert": (case.get("expected") or {}).get("alert") or "",
        "observability": {k: v[:200] for k, v in summary.items()},
        "topology": (case.get("expected") or {}).get("topology") or [],
        "output_contract": {
            "fault_type": "<规范故障类型>",
            "entity": "<归一化根因实体键>",
            "causal_chain": ["step-1", "step-2"],
            "evidence": [{"name": "checkpoint", "value": "..."}],
        },
    }


def _recorded_prediction(case: dict) -> dict:
    """offline 模式：使用快照中已记录的 Agent 作答（用于验证打分链路与建立基线）。"""
    replay = case.get("replay") or {}
    pred = replay.get("last_answer") or replay.get("recorded_answer") or {}
    if pred:
        return pred
    exp = case.get("expected") or {}
    return exp.get("recorded_answer") or {}


def _call_agent(endpoint: str, token: str, payload: dict, timeout: float = 60.0) -> dict:
    try:
        import httpx
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("live 回放需要 httpx：pip install httpx") from exc
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # httpx 默认 trust_env=True 会读取 HTTP_PROXY/HTTPS_PROXY。开发机上（Docker Desktop、
    # 公司代理）常见把 127.0.0.1 也代理掉，导致本地被测 Agent 连不上。
    # 因此对回环地址显式绕过代理；远端端点仍保留代理能力。
    from urllib.parse import urlparse
    host = (urlparse(endpoint).hostname or "").lower()
    trust_env = host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0")
    with httpx.Client(timeout=timeout, trust_env=trust_env) as c:
        r = c.post(endpoint, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
    if isinstance(data, dict) and "prediction" in data:
        return data["prediction"] or {}
    return data if isinstance(data, dict) else {}


def run_replay(user_id: int, case: dict, mode: str = "offline",
               endpoint: str = "", agent_token: str = "", agent_version: str = "",
               mark_status: str | None = None) -> dict:
    signals = store.dec_many(store.query(
        "SELECT * FROM signals WHERE run_id=(SELECT source_run_id FROM cases WHERE id=?) ORDER BY ts_ms",
        (case["id"],),
    )) if case.get("source_run_id") else []
    edges = load_edges(user_id)

    started = time.time()
    error = ""
    transcript: dict[str, Any] = {"mode": mode, "input": build_replay_input(case, signals)}
    if mode in ("offline", "snapshot"):
        prediction = _recorded_prediction(case)
        if not prediction:
            error = "该案例未记录 Agent 作答，无法离线回放。请用 live 模式指向你的 Agent 端点，或先通过 SDK 上报带作答的快照。"
    elif mode == "live":
        if not endpoint:
            error = "live 模式需要在设置中配置 Agent 端点（agent_endpoint）。"
            prediction = {}
        else:
            try:
                prediction = _call_agent(endpoint, agent_token, transcript["input"])
            except Exception as exc:  # noqa: BLE001
                error = f"调用 Agent 端点失败：{exc}"
                prediction = {}
    else:
        prediction = {}
        error = f"不支持的回放模式：{mode}"

    latency_ms = int((time.time() - started) * 1000)
    transcript["prediction"] = prediction
    transcript["error"] = error

    if error and not prediction:
        result = {
            "score": 0.0, "score_fault": 0.0, "score_entity": 0.0, "score_process": 0.0,
            "verdict": "error",
            "detail": {"error": error, "weights": {"fault": 0.4, "entity": 0.3, "process": 0.3}},
        }
    else:
        result = score_case(case, prediction, edges)

    base = store.query_one(
        "SELECT score FROM case_runs WHERE case_id=? AND verdict <> 'error' ORDER BY created_at DESC, id DESC LIMIT 1",
        (case["id"],),
    )
    baseline = base["score"] if base else None
    delta = None if baseline is None else round(result["score"] - baseline, 3)
    regression = bool(baseline is not None and delta is not None and delta < -0.05)

    rid = store.execute(
        """INSERT INTO case_runs (case_id,user_id,mode,agent_version,verdict,score,score_fault,
           score_entity,score_process,baseline_score,detail_json,transcript_json,latency_ms,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            case["id"], user_id, mode, agent_version or "", result["verdict"], result["score"],
            result["score_fault"], result["score_entity"], result["score_process"], baseline,
            store.jdump(result["detail"]), store.jdump(transcript), latency_ms, store.now(),
        ),
    )

    # 回放结果反哺案例状态：连续未达标自动进 BadCase 池，达标自动进黄金案例池
    new_status = case.get("status")
    if mark_status:
        new_status = mark_status
    elif result["verdict"] == "fail":
        new_status = "badcase"
    elif result["verdict"] == "pass" and case.get("status") in ("badcase", "draft"):
        new_status = "golden"
    if new_status != case.get("status"):
        store.execute("UPDATE cases SET status=?, updated_at=? WHERE id=?", (new_status, store.now(), case["id"]))

    return {
        "case_run_id": rid,
        "case_id": case["id"],
        "case_key": case.get("case_key"),
        "mode": mode,
        "verdict": result["verdict"],
        "score": result["score"],
        "score_fault": result["score_fault"],
        "score_entity": result["score_entity"],
        "score_process": result["score_process"],
        "baseline_score": baseline,
        "delta": delta,
        "regression": regression,
        "latency_ms": latency_ms,
        "detail": result["detail"],
        "prediction": prediction,
        "error": error,
        "case_status": new_status,
    }


def run_suite(user_id: int, case_ids: list[int], mode: str = "offline",
              endpoint: str = "", agent_version: str = "") -> dict:
    setting = store.query_one("SELECT value FROM settings WHERE user_id=? AND key='agent_token'", (user_id,))
    agent_token = setting["value"] if setting else ""
    results = []
    for cid in case_ids:
        row = store.query_one("SELECT * FROM cases WHERE id=? AND user_id=?", (cid, user_id))
        if not row:
            continue
        results.append(run_replay(user_id, store.dec(row), mode=mode, endpoint=endpoint,
                                  agent_token=agent_token, agent_version=agent_version))
    passed = sum(1 for r in results if r["verdict"] == "pass")
    avg = round(sum(r["score"] for r in results) / len(results), 3) if results else 0
    return {
        "total": len(results),
        "passed": passed,
        "pass_rate": round(passed / len(results), 3) if results else 0,
        "avg_score": avg,
        "regressions": [r for r in results if r["regression"]],
        "results": results,
    }


def case_run_history(case_id: int, limit: int = 50) -> list[dict]:
    rows = store.dec_many(store.query(
        "SELECT * FROM case_runs WHERE case_id=? ORDER BY created_at DESC, id DESC LIMIT ?",
        (case_id, limit),
    ))
    for r in rows:
        r["delta"] = None if r.get("baseline_score") is None else round((r.get("score") or 0) - (r["baseline_score"] or 0), 3)
    return rows


def export_case(case: dict, run: dict | None = None) -> dict:
    """导出可回放、可复跑的案例包（含快照索引与四层真值）。"""
    signals = []
    if case.get("source_run_id"):
        signals = store.dec_many(store.query(
            "SELECT modality,entity_key,entity_type,name,ts_ms,value,text,severity,payload_json FROM signals WHERE run_id=?",
            (case["source_run_id"],),
        ))
    return {
        "schema": "agentloop-harness/case@1",
        "case_key": case.get("case_key"),
        "title": case.get("title"),
        "status": case.get("status"),
        "difficulty": case.get("difficulty"),
        "tags": case.get("tags") or [],
        "ground_truth": {
            "fault_type": case.get("fault_type"),
            "fault_group": case.get("fault_group"),
            "root_cause_entity": case.get("root_cause_entity"),
            "entity_key": case.get("entity_key"),
            "causal_chain": case.get("causal_chain") or [],
            "evidence": case.get("evidence") or [],
        },
        "expected": case.get("expected") or {},
        "quality": case.get("quality") or {},
        "snapshot": {
            "run_id": case.get("source_run_id"),
            "signal_count": len(signals),
            "signals": signals[:500],
        },
        "last_run": None if not run else {
            "verdict": run.get("verdict"), "score": run.get("score"),
            "score_fault": run.get("score_fault"), "score_entity": run.get("score_entity"),
            "score_process": run.get("score_process"), "mode": run.get("mode"),
        },
    }
