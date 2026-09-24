"""Agent 健康监控与告警：确定性规则引擎。

设计原则与打分模块保持一致——**不做任何模型调用**。同一份数据、同一个时间窗，
任何时候评估出来的结果完全一致，因此可以直接纳入 CI 做回归门禁，也便于审计。

告警对象是「Agent 这个被测系统本身」，而不是「案例的作答质量」：
前者回答「我的 Agent 最近健不健康」，后者回答「它答得对不对」。
"""
from __future__ import annotations

import json
import time
from typing import Any

from . import store

# ------------------------------------------------------------------ 规则定义
#
# op 语义：把 (当前值 op 阈值) 判为「违反」，即告警条件成立。
#   lt  → 当前值低于阈值时告警（掉下去了）
#   gt  → 当前值高于阈值时告警（涨上去了）
# unit 只用于前端展示与文档，不参与计算。

DEFAULT_RULES: tuple[dict[str, Any], ...] = (
    {
        "key": "success_rate_drop", "severity": "critical", "metric": "success_rate",
        "op": "lt", "threshold": 0.60, "min_samples": 3, "unit": "ratio",
        "name_zh": "成功率跌破下限", "name_en": "Success rate below floor",
        "desc_zh": "时间窗内运行成功率低于阈值，说明 Agent 大面积任务跑不通。",
        "desc_en": "Run success rate in the window is below the threshold, indicating widespread failures.",
        "hint_zh": "先按 status=failed 过滤运行记录，看是否集中在同一类故障或同一个 Agent 版本；"
                   "若集中在某个版本，优先回滚或针对该版本做定向评测。",
        "hint_en": "Filter runs by status=failed to see whether failures cluster on one fault type or one "
                   "agent version. If they cluster on a version, roll back or run a targeted evaluation.",
    },
    {
        "key": "error_spike", "severity": "critical", "metric": "error_rate",
        "op": "gt", "threshold": 0.30, "min_samples": 3, "unit": "ratio",
        "name_zh": "报错率异常升高", "name_en": "Error rate spike",
        "desc_zh": "带 error_type 的运行占比过高，属于典型的故障爆发信号。",
        "desc_en": "Share of runs carrying an error_type is too high — a classic fault-burst signal.",
        "hint_zh": "到「运行记录」按 error_type 聚合，比对故障词表看是否出现新的故障类型；"
                   "新出现的故障类型应尽快补进词表与实体别名表。",
        "hint_en": "Group runs by error_type and compare against the fault taxonomy to spot new fault types. "
                   "Add new types to the taxonomy and entity alias table promptly.",
    },
    {
        "key": "replay_pass_drop", "severity": "critical", "metric": "replay_pass_rate",
        "op": "lt", "threshold": 0.60, "min_samples": 2, "unit": "ratio",
        "name_zh": "回放通过率跌破下限", "name_en": "Replay pass rate below floor",
        "desc_zh": "在已有案例上回归跑分通过率过低，通常意味着能力退化而非单次偶发。",
        "desc_en": "Pass rate on the existing case set is too low — usually capability regression, not a one-off.",
        "hint_zh": "到「回放评测」跑一次黄金案例全量套件，定位是哪个维度掉分（定因 / 定界 / 过程），"
                   "再据此决定改 prompt 还是改 skill 流程。",
        "hint_en": "Run the full golden-case suite in Replay to locate the failing dimension "
                   "(fault / entity / process), then decide whether to change the prompt or the skill procedure.",
    },
    {
        "key": "latency_spike", "severity": "warning", "metric": "p95_duration_ms",
        "op": "gt", "threshold": 600_000, "min_samples": 3, "unit": "ms",
        "name_zh": "P95 耗时超过 10 分钟", "name_en": "P95 duration above 10 minutes",
        "desc_zh": "尾部耗时过长，用户可感知，且往往伴随成本上升。",
        "desc_en": "Tail latency is excessive — user-visible, and usually accompanied by rising cost.",
        "hint_zh": "看运行详情里的瀑布图，找跨越多个步骤的长 span；常见原因是上下文过长或工具调用重试。",
        "hint_en": "Inspect the waterfall chart in run detail for long spans crossing multiple steps. "
                   "Common causes are oversized context or tool-call retries.",
    },
    {
        "key": "tool_call_runaway", "severity": "warning", "metric": "max_tool_calls",
        "op": "gte", "threshold": 20, "min_samples": 1, "unit": "count",
        "name_zh": "单次运行工具调用过多（疑似打转）", "name_en": "Excessive tool calls in a single run (possible loop)",
        "desc_zh": "单次运行工具调用次数过高，通常是 Agent 在同一个结论上反复试探。",
        "desc_en": "A single run made too many tool calls — often the agent probing the same conclusion repeatedly.",
        "hint_zh": "到该运行的详情页看调用序列是否重复；若是，给 prompt 加「同一结论不得重复取证」的收敛约束。",
        "hint_en": "Check the call sequence in the run detail page for repetition. If found, add a convergence "
                   "constraint to the prompt forbidding repeated evidence gathering for the same conclusion.",
    },
    {
        "key": "token_runaway", "severity": "warning", "metric": "max_tokens_out",
        "op": "gte", "threshold": 100_000, "min_samples": 1, "unit": "tokens",
        "name_zh": "单次运行输出 token 过高", "name_en": "Excessive output tokens in a single run",
        "desc_zh": "输出 token 异常高，通常是把大段原始日志直接塞进了上下文。",
        "desc_en": "Abnormally high output tokens — usually raw logs dumped into context.",
        "hint_zh": "检查是否把大段原始日志整体喂给了模型；改为先聚合再取摘要，可显著降本。",
        "hint_en": "Check whether bulk raw logs are being fed to the model verbatim. Aggregate first, then summarize.",
    },
    {
        "key": "cost_budget", "severity": "warning", "metric": "cost_usd",
        "op": "gt", "threshold": 5.0, "min_samples": 1, "unit": "usd",
        "name_zh": "时间窗成本超出预算", "name_en": "Window cost over budget",
        "desc_zh": "窗口内累计花费超过预算线，需要确认是否由异常运行拉动。",
        "desc_en": "Cumulative spend in the window exceeded the budget line — verify whether abnormal runs drove it.",
        "hint_zh": "按成本倒序看运行记录，确认是量涨还是单价涨；量涨属正常，单价涨要看 token 结构。",
        "hint_en": "Sort runs by cost descending. Volume growth is normal; unit-cost growth warrants a token-mix review.",
    },
    {
        "key": "new_badcase", "severity": "warning", "metric": "new_badcase",
        "op": "gte", "threshold": 1, "min_samples": 1, "unit": "count",
        "name_zh": "出现新的 BadCase", "name_en": "New BadCase detected",
        "desc_zh": "窗口内有案例被判为 BadCase，说明存在可复现的能力缺口。",
        "desc_en": "Cases were triaged as BadCase within the window — a reproducible capability gap exists.",
        "hint_zh": "到「优化建议」点一次重新分析，让引擎基于这些 BadCase 生成带 diff 的补丁。",
        "hint_en": "Click re-analyze in Optimization Suggestions so the engine emits diff-based patches from these BadCases.",
    },
    {
        "key": "agent_silent", "severity": "info", "metric": "silent_agents",
        "op": "gte", "threshold": 1, "min_samples": 1, "unit": "count",
        "name_zh": "有 Agent 未上报", "name_en": "Agent has not reported",
        "desc_zh": "已登记的 Agent 在本时间窗内没有任何运行上报，可能是接入断了或任务停了。",
        "desc_en": "A registered agent reported no runs in the window — the integration may be broken or idle.",
        "hint_zh": "确认该 Agent 的 SDK 是否还在跑、Token 是否被吊销、上报端点是否可达。",
        "hint_en": "Verify the SDK is still running, the token is not revoked, and the ingest endpoint is reachable.",
    },
    {
        "key": "no_data", "severity": "info", "metric": "runs",
        "op": "lt", "threshold": 1, "min_samples": 0, "unit": "count",
        "name_zh": "时间窗内没有运行数据", "name_en": "No runs in the window",
        "desc_zh": "窗口内一条运行记录都没有，其余指标都不可信，先解决数据接入问题。",
        "desc_en": "No runs at all in the window; every other metric is unreliable until ingestion works.",
        "hint_zh": "先看「接入与设置」页的接入方式与 Token，再用 SDK 的 status 命令自检连通性。",
        "hint_en": "Check the integration method and token in Settings, then self-check connectivity with the SDK status command.",
    },
)

RULES_BY_KEY = {r["key"]: r for r in DEFAULT_RULES}
SEVERITY_RANK = {"critical": 0, "warning": 1, "info": 2}
_OPS = {"lt", "gt", "gte", "lte", "eq"}

# 可被用户覆盖的字段（规则本身的语义不允许改，避免出现无法解释的状态）
OVERRIDABLE = ("enabled", "threshold", "severity")

SETTINGS_KEY = "alert_rules"


# ------------------------------------------------------------------ 工具

def _iso_ago(seconds: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() - seconds))


def _ratio(numerator: Any, denominator: Any) -> float:
    d = denominator or 0
    return round((numerator or 0) / d, 4) if d else 0.0


def _cmp_hit(value: float, op: str, threshold: float) -> bool:
    if op == "lt":
        return value < threshold
    if op == "gt":
        return value > threshold
    if op == "gte":
        return value >= threshold
    if op == "lte":
        return value <= threshold
    if op == "eq":
        return value == threshold
    return False


def _compare_zh(op: str) -> str:
    return {"lt": "低于", "gt": "高于", "gte": "不低于", "lte": "不高于", "eq": "等于"}.get(op, op)


def _compare_en(op: str) -> str:
    return {"lt": "below", "gt": "above", "gte": "at or above", "lte": "at or below", "eq": "equal to"}.get(op, op)


def _fmt(value: Any, unit: str) -> str:
    if value is None:
        return "—"
    if unit == "ratio":
        return f"{value * 100:.1f}%"
    if unit == "ms":
        return f"{value / 1000:.1f}s"
    if unit == "usd":
        return f"${value:.3f}"
    if unit == "tokens":
        return f"{int(value):,}"
    return f"{value:g}" if isinstance(value, float) else f"{value:,}"


def _signature(metric: str, value: Any, unit: str) -> str:
    """告警签名按量纲量化。

    签名是「已确认」状态的锚点：签名变了就意味着情况真的变了，需要重新告警。
    直接用原始浮点会让 0.5106→0.5107 这种抖动反复触发，所以按量纲取有效精度：
    比率保留到 0.1%，金额到分，耗时到秒。
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return f"{metric}={value}"
    if unit == "ratio":
        q: Any = round(v, 3)
    elif unit == "usd":
        q = round(v, 2)
    elif unit == "ms":
        q = int(round(v / 1000.0) * 1000)
    else:
        q = int(v)
    return f"{metric}={q}"


# ------------------------------------------------------------------ 规则覆盖

def effective_rules(user_id: int) -> list[dict]:
    """默认规则 + 用户覆盖，输出按 key 稳定排序，保证评估结果可复现。"""
    raw = store.query_one("SELECT value FROM settings WHERE user_id=? AND key=?", (user_id, SETTINGS_KEY))
    overrides: dict[str, Any] = {}
    if raw and raw.get("value"):
        try:
            parsed = json.loads(raw["value"])
            if isinstance(parsed, dict):
                overrides = parsed
        except (TypeError, ValueError):
            overrides = {}
    out = []
    for base in DEFAULT_RULES:
        rule = dict(base)
        ov = overrides.get(rule["key"]) if isinstance(overrides.get(rule["key"]), dict) else {}
        rule["default_threshold"] = base["threshold"]
        rule["default_severity"] = base["severity"]
        rule["enabled"] = bool(ov.get("enabled", True))
        if isinstance(ov.get("threshold"), (int, float)) and not isinstance(ov.get("threshold"), bool):
            rule["threshold"] = float(ov["threshold"])
        if ov.get("severity") in SEVERITY_RANK:
            rule["severity"] = ov["severity"]
        rule["overridden"] = bool(ov)
        out.append(rule)
    return out


def save_rules(user_id: int, patch: dict) -> list[dict]:
    """只接受 enabled / threshold / severity 三个字段的覆盖。"""
    raw = store.query_one("SELECT value FROM settings WHERE user_id=? AND key=?", (user_id, SETTINGS_KEY))
    current: dict[str, Any] = {}
    if raw and raw.get("value"):
        try:
            parsed = json.loads(raw["value"])
            if isinstance(parsed, dict):
                current = parsed
        except (TypeError, ValueError):
            current = {}
    for key, changes in (patch or {}).items():
        if key not in RULES_BY_KEY or not isinstance(changes, dict):
            continue
        entry = dict(current.get(key) or {})
        for field in OVERRIDABLE:
            if field not in changes:
                continue
            value = changes[field]
            if field == "enabled":
                entry["enabled"] = bool(value)
            elif field == "severity":
                if value in SEVERITY_RANK:
                    entry["severity"] = value
                    if value == RULES_BY_KEY[key]["severity"]:
                        entry.pop("severity", None)
            elif field == "threshold":
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    entry["threshold"] = float(value)
                    if float(value) == float(RULES_BY_KEY[key]["threshold"]):
                        entry.pop("threshold", None)
        if entry:
            current[key] = entry
        else:
            current.pop(key, None)
    store.execute(
        "INSERT INTO settings (user_id,key,value) VALUES (?,?,?) "
        "ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",
        (user_id, SETTINGS_KEY, json.dumps(current, ensure_ascii=False)),
    )
    return effective_rules(user_id)


# ------------------------------------------------------------------ 指标计算

def compute_metrics(user_id: int, window_hours: float = 24.0) -> dict:
    since = _iso_ago(window_hours * 3600)

    r = store.query_one(
        """SELECT COUNT(*) AS n,
                  COALESCE(SUM(status='success'),0) AS success,
                  COALESCE(SUM(status='failed'),0)  AS failed,
                  COALESCE(SUM(status='partial'),0) AS partial,
                  COALESCE(SUM(error_type<>''),0)   AS errors,
                  COALESCE(AVG(duration_ms),0)      AS avg_duration,
                  COALESCE(MAX(duration_ms),0)      AS max_duration,
                  COALESCE(AVG(tool_calls),0)       AS avg_tools,
                  COALESCE(MAX(tool_calls),0)       AS max_tools,
                  COALESCE(SUM(tokens_in+tokens_out),0) AS tokens,
                  COALESCE(MAX(tokens_out),0)       AS max_tokens_out,
                  COALESCE(SUM(cost_usd),0)         AS cost
           FROM runs WHERE user_id=? AND created_at>=?""",
        (user_id, since),
    ) or {}

    durs = [row["duration_ms"] or 0 for row in store.query(
        "SELECT duration_ms FROM runs WHERE user_id=? AND created_at>=? ORDER BY duration_ms",
        (user_id, since),
    )]
    p95 = durs[min(len(durs) - 1, int(len(durs) * 0.95))] if durs else 0

    cr = store.query_one(
        """SELECT COUNT(*) AS n, COALESCE(AVG(score),0) AS avg_score,
                  COALESCE(SUM(verdict='pass'),0) AS passed,
                  COALESCE(SUM(verdict='fail'),0) AS failed
           FROM case_runs WHERE user_id=? AND created_at>=?""",
        (user_id, since),
    ) or {}

    bad = store.query(
        "SELECT id,case_key,title,fault_type FROM cases "
        "WHERE user_id=? AND status='badcase' AND updated_at>=? ORDER BY updated_at DESC",
        (user_id, since),
    )
    pool = store.query_one(
        """SELECT COALESCE(SUM(status='golden'),0) AS golden,
                  COALESCE(SUM(status='badcase'),0) AS badcase,
                  COALESCE(SUM(status='candidate'),0) AS candidate
           FROM cases WHERE user_id=?""", (user_id,)) or {}

    runs = r.get("n") or 0
    replays = cr.get("n") or 0
    metrics = {
        "window_hours": window_hours,
        "since": since,
        "runs": runs,
        "success": r.get("success") or 0,
        "failed": r.get("failed") or 0,
        "partial": r.get("partial") or 0,
        "success_rate": _ratio(r.get("success"), runs),
        "fail_rate": _ratio(r.get("failed"), runs),
        "error_rate": _ratio(r.get("errors"), runs),
        "avg_duration_ms": int(r.get("avg_duration") or 0),
        "max_duration_ms": int(r.get("max_duration") or 0),
        "p95_duration_ms": int(p95 or 0),
        "avg_tool_calls": round(r.get("avg_tools") or 0, 1),
        "max_tool_calls": int(r.get("max_tools") or 0),
        "tokens": int(r.get("tokens") or 0),
        "max_tokens_out": int(r.get("max_tokens_out") or 0),
        "cost_usd": round(r.get("cost") or 0, 4),
        "replays": replays,
        "avg_score": round(cr.get("avg_score") or 0, 3),
        "replay_pass_rate": _ratio(cr.get("passed"), replays),
        "replay_failed": cr.get("failed") or 0,
        "new_badcase": len(bad),
        "golden_total": pool.get("golden") or 0,
        "badcase_total": pool.get("badcase") or 0,
        "candidate_total": pool.get("candidate") or 0,
    }
    metrics["_new_badcase_rows"] = bad
    return metrics


def agent_health(user_id: int, window_hours: float = 24.0) -> list[dict]:
    """每个 Agent 的健康快照——告警页的主视图。"""
    since = _iso_ago(window_hours * 3600)
    rows = store.query(
        """SELECT a.id, a.name, a.agent_type, a.version,
                  COUNT(r.id) AS total_runs, MAX(r.created_at) AS last_seen
           FROM agents a LEFT JOIN runs r ON r.agent_id=a.id
           WHERE a.user_id=? GROUP BY a.id ORDER BY a.name""",
        (user_id,),
    )
    per = {x["agent_id"]: x for x in store.query(
        """SELECT agent_id, COUNT(*) AS n,
                  COALESCE(SUM(status='success'),0) AS ok,
                  COALESCE(AVG(duration_ms),0) AS avg_dur,
                  COALESCE(SUM(cost_usd),0) AS cost,
                  COALESCE(MAX(tool_calls),0) AS max_tools
           FROM runs WHERE user_id=? AND created_at>=? GROUP BY agent_id""",
        (user_id, since),
    )}
    out = []
    for row in rows:
        w = per.get(row["id"]) or {}
        runs = w.get("n") or 0
        success_rate = _ratio(w.get("ok"), runs)
        last_seen = row.get("last_seen") or ""
        silent = runs == 0
        if silent:
            status = "silent"
        elif success_rate < 0.60:
            status = "degraded"
        else:
            status = "healthy"
        out.append({
            "agent": row["name"],
            "agent_type": row.get("agent_type") or "",
            "version": row.get("version") or "",
            "runs_in_window": runs,
            "total_runs": row.get("total_runs") or 0,
            "success_rate": success_rate,
            "avg_duration_ms": int(w.get("avg_dur") or 0),
            "max_tool_calls": int(w.get("max_tools") or 0),
            "cost_usd": round(w.get("cost") or 0, 4),
            "last_seen": last_seen,
            "silent": silent,
            "status": status,
        })
    return out


def _refs_for(rule_key: str, user_id: int, since: str, threshold: float) -> list[dict]:
    """告警指向的证据：能点到具体运行 / 具体案例，而不是只给一个数字。"""
    if rule_key in ("tool_call_runaway", "token_runaway"):
        col = "tool_calls" if rule_key == "tool_call_runaway" else "tokens_out"
        return store.query(
            f"""SELECT id, external_run_id, task, {col} AS value, tool_calls, tokens_out, status
                FROM runs WHERE user_id=? AND created_at>=? AND {col}>=?
                ORDER BY {col} DESC LIMIT 5""",
            (user_id, since, threshold),
        )
    if rule_key == "new_badcase":
        return store.query(
            """SELECT id, case_key, title, fault_type, status FROM cases
               WHERE user_id=? AND status='badcase' AND updated_at>=?
               ORDER BY updated_at DESC LIMIT 10""",
            (user_id, since),
        )
    if rule_key in ("success_rate_drop", "error_spike"):
        return store.query(
            """SELECT id, external_run_id, task, status, error_type FROM runs
               WHERE user_id=? AND created_at>=? AND (status='failed' OR error_type<>'')
               ORDER BY created_at DESC LIMIT 5""",
            (user_id, since),
        )
    if rule_key == "latency_spike":
        return store.query(
            """SELECT id, external_run_id, task, duration_ms AS value, tool_calls FROM runs
               WHERE user_id=? AND created_at>=? ORDER BY duration_ms DESC LIMIT 5""",
            (user_id, since),
        )
    if rule_key == "replay_pass_drop":
        return store.query(
            """SELECT cr.id, cr.case_id, c.case_key, c.title, cr.score, cr.verdict
               FROM case_runs cr LEFT JOIN cases c ON c.id=cr.case_id
               WHERE cr.user_id=? AND cr.created_at>=? AND cr.verdict IN ('fail','partial')
               ORDER BY cr.created_at DESC LIMIT 5""",
            (user_id, since),
        )
    if rule_key == "agent_silent":
        return []
    if rule_key == "cost_budget":
        return store.query(
            """SELECT id, external_run_id, task, cost_usd AS value, tokens_out FROM runs
               WHERE user_id=? AND created_at>=? ORDER BY cost_usd DESC LIMIT 5""",
            (user_id, since),
        )
    return []


# ------------------------------------------------------------------ 评估

def _acks(user_id: int) -> dict[str, str]:
    rows = store.query(
        "SELECT rule_key, signature, acked_at FROM alert_acks WHERE user_id=?", (user_id,))
    return {f"{r['rule_key']}::{r['signature']}": r["acked_at"] for r in rows}


def evaluate(user_id: int, window_hours: float = 24.0) -> dict:
    metrics = compute_metrics(user_id, window_hours)
    since = metrics["since"]
    health = agent_health(user_id, window_hours)
    silent = [h for h in health if h["silent"]]
    metrics["silent_agents"] = len(silent)

    acked = _acks(user_id)
    alerts: list[dict] = []
    skipped: list[dict] = []

    for rule in effective_rules(user_id):
        if not rule["enabled"]:
            continue
        key = rule["key"]
        if key == "agent_silent":
            value: Any = metrics.get("silent_agents")
            sample = len(health)
            refs: list[dict] = [{"agent": h["agent"], "last_seen": h["last_seen"]} for h in silent]
        else:
            value = metrics.get(rule["metric"])
            # 比率类指标的分母不同：回放规则看回放次数，其余看运行次数
            sample = metrics["replays"] if key.startswith("replay") else metrics["runs"]
            refs = []

        if value is None:
            continue
        if sample < rule["min_samples"]:
            skipped.append({
                "rule_key": key, "reason": "insufficient_samples",
                "sample": sample, "min_samples": rule["min_samples"],
                "name_zh": rule["name_zh"], "name_en": rule["name_en"],
            })
            continue
        if not _cmp_hit(float(value), rule["op"], float(rule["threshold"])):
            continue
        if key != "agent_silent" and not refs:
            refs = _refs_for(key, user_id, since, float(rule["threshold"]))

        signature = _signature(rule["metric"], value, rule["unit"])
        alert = {
            "rule_key": key,
            "severity": rule["severity"],
            "metric": rule["metric"],
            "unit": rule["unit"],
            "op": rule["op"],
            "current": value,
            "threshold": rule["threshold"],
            "default_threshold": rule["default_threshold"],
            "overridden": rule["overridden"],
            "current_text": _fmt(value, rule["unit"]),
            "threshold_text": _fmt(rule["threshold"], rule["unit"]),
            "name_zh": rule["name_zh"], "name_en": rule["name_en"],
            "desc_zh": rule["desc_zh"], "desc_en": rule["desc_en"],
            "hint_zh": rule["hint_zh"], "hint_en": rule["hint_en"],
            "compare_zh": _compare_zh(rule["op"]),
            "compare_en": _compare_en(rule["op"]),
            "sample": sample,
            "refs": refs,
            "signature": signature,
            "acknowledged": f"{key}::{signature}" in acked,
            "acked_at": acked.get(f"{key}::{signature}"),
        }
        alerts.append(alert)

    alerts.sort(key=lambda a: (SEVERITY_RANK.get(a["severity"], 9), a["rule_key"]))
    counts = {"critical": 0, "warning": 0, "info": 0}
    for a in alerts:
        counts[a["severity"]] = counts.get(a["severity"], 0) + 1

    return {
        "evaluated_at": store.now(),
        "window_hours": window_hours,
        "since": since,
        "alerts": alerts,
        "skipped_rules": skipped,
        "summary": dict(counts, total=len(alerts),
                        acknowledged=sum(1 for a in alerts if a["acknowledged"]),
                        open=sum(1 for a in alerts if not a["acknowledged"])),
        "metrics": {k: v for k, v in metrics.items() if not k.startswith("_")},
        "agent_health": health,
        "rules": effective_rules(user_id),
    }


def ack(user_id: int, rule_key: str, signature: str, note: str = "") -> dict:
    if rule_key not in RULES_BY_KEY:
        raise ValueError(f"未知规则：{rule_key}")
    existing = store.query_one(
        "SELECT id FROM alert_acks WHERE user_id=? AND rule_key=? AND signature=?",
        (user_id, rule_key, signature),
    )
    if existing:
        store.execute("UPDATE alert_acks SET acked_at=?, note=? WHERE id=?",
                      (store.now(), note, existing["id"]))
    else:
        store.execute(
            "INSERT INTO alert_acks (user_id,rule_key,signature,note,acked_at) VALUES (?,?,?,?,?)",
            (user_id, rule_key, signature, note, store.now()),
        )
    return {"rule_key": rule_key, "signature": signature, "acked_at": store.now()}


def unack(user_id: int, rule_key: str) -> int:
    before = store.query_one(
        "SELECT COUNT(*) AS n FROM alert_acks WHERE user_id=? AND rule_key=?",
        (user_id, rule_key),
    ) or {}
    store.execute("DELETE FROM alert_acks WHERE user_id=? AND rule_key=?", (user_id, rule_key))
    return before.get("n") or 0
