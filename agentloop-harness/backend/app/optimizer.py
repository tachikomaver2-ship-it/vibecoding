"""BadCase 驱动优化引擎：失分维度聚类 → 生成 skill / prompt 补丁建议。

设计原则：
  1. 一切结论都能追溯到具体 BadCase 与具体失分维度（证据可回放）；
  2. 建议以"可审阅的 diff"形态产出，人工确认后才走 GitHub 提交；
  3. 规则确定性优先，不依赖模型生成，保证同类 BadCase 重复分析结论稳定。
"""
from __future__ import annotations

import difflib
from collections import Counter, defaultdict
from typing import Any

from . import store
from .graph import cluster_badcases, group_fault
from .scoring import FAULT_GROUPS, canonical_fault_type, normalize_entity

WEAK_DIMENSIONS = {
    "fault": "定因",
    "entity": "定界",
    "chain": "过程·因果链",
    "evidence": "过程·证据",
}

GROUP_EVIDENCE_HINT = {
    "application-logic": "入口 QPS/错误率、网关 5xx 比例、限流与熔断事件",
    "jvm-runtime": "JVM heap/GC 停顿、线程池活跃数与排队、单实例 CPU",
    "middleware-db": "DB 慢查询语句与执行计划、连接池饱和、Redis 命中率与延迟、MQ 堆积量",
    "k8s-lifecycle": "Pod 重启与 Ready 事件、调度失败原因、副本数与 HPA 记录、网络策略变更",
    "cloud-resource": "节点 CPU/内存水位、磁盘 IO util、节点 NotReady 事件",
    "resource-perf": "容器 CPU throttling、内存 RSS 曲线、磁盘 IO 等待",
}


# ------------------------------------------------------------------ 数据装载

def latest_case_runs(user_id: int, statuses: tuple[str, ...] = ("badcase",)) -> list[dict]:
    placeholders = ",".join("?" for _ in statuses)
    rows = store.dec_many(store.query(
        f"""SELECT c.*, r.score AS score, r.score_fault AS score_fault, r.score_entity AS score_entity,
                   r.score_process AS score_process, r.detail_json AS detail_json, r.verdict AS verdict,
                   r.id AS run_result_id
            FROM cases c
            LEFT JOIN case_runs r ON r.id = (
                SELECT id FROM case_runs WHERE case_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1)
            WHERE c.user_id=? AND c.status IN ({placeholders})
            ORDER BY c.updated_at DESC""",
        (user_id, *statuses),
    ))
    for r in rows:
        detail = r.get("detail") or {}
        weakness = []
        if (r.get("score_fault") or 0) < 0.6:
            weakness.append("fault")
        if (r.get("score_entity") or 0) < 0.6:
            weakness.append("entity")
        ev = (detail.get("evidence") or {}).get("score")
        ch = (detail.get("chain") or {}).get("score")
        if ch is not None and ch < 0.7:
            weakness.append("chain")
        if ev is not None and ev < 0.7:
            weakness.append("evidence")
        r["weakness"] = weakness
        r["weak_dimension"] = weakness[0] if weakness else "unknown"
    return rows


def _add_suggestion(user_id: int, sig: str, payload: dict[str, Any]) -> int | None:
    """落库一条建议；若同签名（目标文件+类别+关联案例）已存在则跳过。

    返回新建建议的 id，跳过时返回 None。
    """
    exists = store.query_one(
        "SELECT id FROM optimizations WHERE user_id=? AND status IN ('draft','approved') "
        "AND json_extract(evidence_json,'$.signature')=?",
        (user_id, sig),
    )
    if exists:
        return None
    oid = store.execute(
        """INSERT INTO optimizations (user_id,title,category,target_type,target_path,rationale,patch,
           new_content,case_ids_json,status,evidence_json,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            user_id, payload["title"], payload.get("category", "prompt"),
            payload.get("target_type", "prompt"), payload.get("target_path", ""),
            payload.get("rationale", ""), payload.get("patch", ""), payload.get("new_content", ""),
            store.jdump(payload.get("case_ids", []), "[]"), "draft",
            store.jdump({**payload.get("evidence", {}), "signature": sig}),
            store.now(), store.now(),
        ),
    )
    return oid


def make_patch(path: str, old: str, new: str) -> str:
    if not old:
        return f"--- /dev/null\n+++ b/{path}\n" + "\n".join(
            f"+{line}" for line in (new.splitlines() or [""])
        ) + "\n"
    diff = difflib.unified_diff(
        old.splitlines(), new.splitlines(),
        fromfile=f"a/{path}", tofile=f"b/{path}", lineterm="",
    )
    return "\n".join(diff) + "\n"


def _read_target(user_id: int, path: str) -> str:
    row = store.query_one("SELECT value FROM settings WHERE user_id=? AND key=?", (user_id, f"file:{path}"))
    return row["value"] if row else ""


def _agent_target(user_id: int) -> str:
    row = store.query_one("SELECT value FROM settings WHERE user_id=? AND key='default_agent'", (user_id,))
    return (row or {}).get("value") or "agent"


# ------------------------------------------------------------------ 规则引擎

def _rule_entity_mapping(user_id: int, bad: list[dict], out: list[dict]) -> None:
    """定界失分 → 生成实体别名映射表。"""
    relevant = [c for c in bad if "entity" in c["weakness"]]
    if len(relevant) < 1:
        return
    alias: Counter = Counter()
    for c in relevant:
        raw = (c.get("detail") or {}).get("entity", {}).get("note", "")
        expected = normalize_entity(c.get("root_cause_entity") or c.get("entity_key") or "")
        for token in _entity_tokens_from_note(raw):
            if token and token != expected:
                alias[(token, expected)] += 1
    if not alias:
        return
    path = f"skills/{_agent_target(user_id)}/entity-aliases.yaml"
    lines = ["# 由 AgentLoop Harness 依据 BadCase 自动生成：跨域实体归一化映射",
             "# 目的：消除 APM / K8s / 云资源层命名口径差异，使定界评分可计算",
             "aliases:"]
    for (src, dst), n in alias.most_common(30):
        lines.append(f'  "{src}": "{dst}"   # 命中 {n} 个 BadCase')
    new_content = "\n".join(lines) + "\n"
    old = _read_target(user_id, path)
    out.append({
        "title": f"补齐实体归一化映射表（{len(alias)} 条别名）",
        "category": "entity-mapping",
        "target_type": "entity-map",
        "target_path": path,
        "rationale": (
            f"发现 {len(relevant)} 个 BadCase 的失分维度含「定界」。Agent 定位到的实体名称与真值"
            f"根因实体在拓扑上不可达或距离过远，根因是跨域实体标识未归一。"
            f"例如：{'；'.join(f'{s} → {d}' for (s, d), _ in alias.most_common(3))}。"
            "补齐映射后，定界评分可从名称相似度回退升级为拓扑距离量化。"
        ),
        "patch": make_patch(path, old, new_content),
        "new_content": new_content,
        "case_ids": [c["id"] for c in relevant],
        "evidence": {"dimension": "entity", "alias_count": len(alias)},
    })


def _entity_tokens_from_note(note: str) -> list[str]:
    if not note:
        return []
    import re
    tokens = re.findall(r"[a-zA-Z0-9_.\-:]{3,}", note)
    return [normalize_entity(t) for t in tokens][:6]


def _rule_skill_procedure(user_id: int, bad: list[dict], out: list[dict]) -> None:
    """过程失分（因果链 / 证据）→ 改写 Skill 的诊断流程章节。"""
    relevant = [c for c in bad if {"chain", "evidence"} & set(c["weakness"])]
    if not relevant:
        return
    chains: list[list[str]] = []
    checkpoints: list[str] = []
    groups: Counter = Counter()
    for c in relevant:
        if c.get("causal_chain"):
            chains.append(list(c["causal_chain"]))
        for ck in (c.get("evidence") or []):
            label = ck.get("name") or ck.get("entity") or (ck.get("keywords") or [""])[0]
            if label and label not in checkpoints:
                checkpoints.append(label)
        g = group_fault(c.get("fault_type", ""))
        if g:
            groups[g] += 1

    merged: list[str] = []
    for chain in sorted(chains, key=len, reverse=True):
        for step in chain:
            if step not in merged:
                merged.append(step)
    merged = merged[:12]

    path = f"skills/{_agent_target(user_id)}/SKILL.md"
    old = _read_target(user_id, path)
    block = [
        "",
        "## 诊断流程（由 AgentLoop Harness 依据 BadCase 自动补全）",
        "",
        "> 该章节来自 " + str(len(relevant)) + " 个回放未达标的案例，问题集中在"
        + "、".join(sorted({WEAK_DIMENSIONS[w] for c in relevant for w in c["weakness"] if w in WEAK_DIMENSIONS}))
        + "。每一步都必须落成一次显式查询或断言，避免直接跳到结论。",
        "",
        "### 标准因果链（有序，不得跳步）",
    ]
    for i, step in enumerate(merged, 1):
        block.append(f"{i}. {step}")
    block += ["", "### 关键证据检查点（缺一即判定过程失分）"]
    for ck in checkpoints[:10]:
        block.append(f"- [ ] {ck}")
    if groups:
        block += ["", "### 高频故障类型与首要取证信号"]
        for g, n in groups.most_common(4):
            hint = GROUP_EVIDENCE_HINT.get(g, "")
            block.append(f"- **{g}**（{n} 个 BadCase）：{hint}")
    block += [
        "",
        "### 结论输出契约",
        "```json",
        '{"fault_type":"<规范化类型>","entity":"<归一化实体键>",',
        ' "causal_chain":["step-1","step-2"],"evidence":[{"name":"checkpoint","value":"..."}]}',
        "```",
        "未填写 `entity` 或 `causal_chain` 一律视为未完成诊断。",
        "",
    ]
    new_content = (old.rstrip() + "\n" if old else "# Skill: 诊断能力\n") + "\n".join(block)
    out.append({
        "title": f"补全 Skill 诊断流程章节（{len(merged)} 步链路 / {len(checkpoints[:10])} 个证据检查点）",
        "category": "skill",
        "target_type": "skill",
        "target_path": path,
        "rationale": (
            f"{len(relevant)} 个 BadCase 的过程维度未达阈值：Agent 的因果链跳步或缺关键取证，"
            f"导致即使结论方向正确也无法通过过程评分（过程占综合分 30%，其中链路 60%、证据 40%）。"
            "该补丁把多案例的期望因果链做去重合并后固化进 Skill，把'靠运气答对'变成'按流程必然答对'。"
        ),
        "patch": make_patch(path, old, new_content),
        "new_content": new_content,
        "case_ids": [c["id"] for c in relevant],
        "evidence": {"dimension": "process", "chain_steps": len(merged), "checkpoints": len(checkpoints)},
    })


def _rule_fault_prompt(user_id: int, bad: list[dict], out: list[dict]) -> None:
    """定因失分 → 在 Prompt 中加入故障类型判定表。"""
    relevant = [c for c in bad if "fault" in c["weakness"]]
    if not relevant:
        return
    seen_groups = []
    for c in relevant:
        g = group_fault(c.get("fault_type", ""))
        if g and g not in seen_groups:
            seen_groups.append(g)
    path = f"prompts/{_agent_target(user_id)}.md"
    old = _read_target(user_id, path)
    block = [
        "",
        "## 故障类型判定表（由 AgentLoop Harness 依据 BadCase 自动注入）",
        "",
        "先按信号特征归组，再在组内收敛到具体类型；禁止使用未在表中的自造类型名。",
        "",
        "| 故障组 | 规范类型 | 判别性证据 |",
        "| --- | --- | --- |",
    ]
    for g in (seen_groups or list(FAULT_GROUPS.keys())[:4]):
        types = FAULT_GROUPS.get(g, [])[:4]
        block.append(f"| {g} | {', '.join(types)} | {GROUP_EVIDENCE_HINT.get(g, '')} |")
    examples = "\n".join(
        f"- 真值 `{canonical_fault_type(c.get('fault_type',''))}` ← 本案例 Agent 误判，得分 {(c.get('score_fault') or 0):.2f}"
        for c in relevant[:5]
    )
    new_content = (old.rstrip() + "\n" if old else "# Prompt: 诊断助手\n") + "\n".join(block) + "\n\n### 历史误判案例\n" + examples + "\n"
    out.append({
        "title": f"注入故障类型判定表（覆盖 {len(seen_groups) or 4} 个故障组）",
        "category": "prompt",
        "target_type": "prompt",
        "target_path": path,
        "rationale": (
            f"{len(relevant)} 个 BadCase 的定因未达阈值（定因占综合分 40%，权重最高）。"
            "Agent 给出的类型名不在规范分类树内，或跨组混淆，评分只能落到 0.05~0.35。"
            "注入判定表 + 历史误判案例可把类型收敛约束在受控词表内。"
        ),
        "patch": make_patch(path, old, new_content),
        "new_content": new_content,
        "case_ids": [c["id"] for c in relevant],
        "evidence": {"dimension": "fault", "groups": seen_groups},
    })


def _rule_efficiency(user_id: int, bad: list[dict], out: list[dict]) -> None:
    """成本/循环异常 → Prompt 增加循环熔断与上下文裁剪规则。"""
    runs = store.dec_many(store.query(
        """SELECT r.id, r.external_run_id, r.tool_calls, r.tokens_in, r.tokens_out, r.duration_ms
           FROM runs r WHERE r.user_id=? AND r.status IN ('failed','partial')
           ORDER BY r.tokens_out DESC LIMIT 20""",
        (user_id,),
    ))
    loops = [r for r in runs if (r.get("tool_calls") or 0) >= 15 or (r.get("tokens_out") or 0) >= 120000]
    if len(loops) < 3:
        return
    path = f"prompts/{_agent_target(user_id)}.md"
    old = _read_target(user_id, path)
    block = [
        "",
        "## 循环熔断与上下文裁剪（由 AgentLoop Harness 自动注入）",
        "",
        "1. 同一工具连续失败 2 次，必须更换取证途径或先缩小故障域，禁止原样重试。",
        "2. 单次任务的工具调用上限 12 次；触达上限先输出阶段性结论与未消除的不确定性。",
        "3. 只保留最近 3 轮工具原始输出，更早的输出压缩为结论句，抑制 Token 黑洞。",
        "",
    ]
    new_content = (old.rstrip() + "\n" if old else "# Prompt: 诊断助手\n") + "\n".join(block)
    out.append({
        "title": f"增加循环熔断与上下文裁剪规则（{len(loops)} 条高消耗轨迹）",
        "category": "prompt",
        "target_type": "prompt",
        "target_path": path,
        "rationale": (
            f"检出 {len(loops)} 条失败轨迹存在工具调用 ≥15 次或输出 Token ≥120k 的 Token 黑洞特征，"
            f"最高一条达 {max(r['tool_calls'] for r in loops)} 次工具调用 / {max(r['tokens_out'] for r in loops)} 输出 Token。"
            "这些轨迹往往在错误的方向上反复取证，既拉高成本也拉长 MTTR。"
        ),
        "patch": make_patch(path, old, new_content),
        "new_content": new_content,
        "case_ids": [],
        "evidence": {"dimension": "efficiency", "run_ids": [r["external_run_id"] for r in loops[:10]]},
    })


def analyze(user_id: int, include_statuses: tuple[str, ...] = ("badcase",)) -> dict:
    """跑一遍 BadCase 分析，产出（并落库）优化建议。"""
    bad = latest_case_runs(user_id, include_statuses)
    out: list[dict] = []
    _rule_fault_prompt(user_id, bad, out)
    _rule_entity_mapping(user_id, bad, out)
    _rule_skill_procedure(user_id, bad, out)
    _rule_efficiency(user_id, bad, out)

    created_ids: list[int] = []
    for payload in out:
        sig = f"{payload['target_path']}::{payload['category']}::" + ",".join(
            str(i) for i in sorted(payload.get("case_ids", []))
        )
        oid = _add_suggestion(user_id, sig, payload)
        if oid:
            created_ids.append(oid)

    # 列表接口是权威来源；这里额外把本次新建的建议回传，省去前端再查一次
    suggestions = []
    for oid in created_ids:
        row = store.query_one("SELECT * FROM optimizations WHERE id=?", (oid,))
        if row:
            suggestions.append(optimization_view(row))

    return {
        "badcase_count": len(bad),
        "clusters": cluster_badcases(bad),
        "suggested": len(out),
        "created": len(created_ids),
        "suggestions": suggestions,
    }


def optimization_view(row: dict) -> dict:
    r = store.dec(row)
    r["case_ids"] = r.get("case_ids") or []
    ev = r.get("evidence") or {}
    r["signature"] = ev.get("signature", "")
    case_ids = r["case_ids"]
    if case_ids:
        placeholders = ",".join("?" for _ in case_ids)
        r["cases"] = store.dec_many(store.query(
            f"SELECT id, case_key, title, status, fault_type FROM cases WHERE id IN ({placeholders})",
            case_ids,
        ))
    else:
        r["cases"] = []
    return r
