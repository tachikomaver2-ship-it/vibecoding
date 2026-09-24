"""实体拓扑图、快照装载与故障聚类辅助。"""
from __future__ import annotations

from collections import defaultdict

from . import store
from .scoring import FAULT_GROUPS, canonical_fault_type, fault_group_of, normalize_entity


def load_edges(user_id: int) -> dict[str, set[str]]:
    """从统一实体模型构建无向拓扑图（含 signals 中观测到的实体关联）。"""
    edges: dict[str, set[str]] = defaultdict(set)
    for row in store.query("SELECT entity_key, parent_key FROM entities WHERE user_id=?", (user_id,)):
        key = normalize_entity(row["entity_key"])
        if not key:
            continue
        edges.setdefault(key, set())
        parent = normalize_entity(row["parent_key"] or "")
        if parent:
            edges[key].add(parent)
            edges[parent].add(key)
    # 同一 run 内共同出现的实体视为一跳关联，补齐拓扑
    co = store.query(
        """SELECT run_id, GROUP_CONCAT(DISTINCT entity_key) AS keys
           FROM signals WHERE entity_key <> '' AND run_id IN
             (SELECT id FROM runs WHERE user_id=?) GROUP BY run_id""",
        (user_id,),
    )
    for row in co:
        keys = [normalize_entity(k) for k in (row["keys"] or "").split(",") if k]
        for i, a in enumerate(keys):
            edges.setdefault(a, set())
            for b in keys[i + 1:]:
                edges.setdefault(b, set())
                edges[a].add(b)
                edges[b].add(a)
    return edges


def entity_catalog(user_id: int, edges: dict[str, set[str]] | None = None) -> list[dict]:
    edges = edges if edges is not None else load_edges(user_id)
    rows = store.dec_many(store.query(
        "SELECT * FROM entities WHERE user_id=? ORDER BY etype, entity_key", (user_id,)
    ))
    for r in rows:
        r["degree"] = len(edges.get(normalize_entity(r["entity_key"]), set()))
        r["neighbors"] = sorted(edges.get(normalize_entity(r["entity_key"]), set()))[:12]
    return rows


def load_run_signals(run_id: int) -> list[dict]:
    return store.dec_many(store.query(
        "SELECT * FROM signals WHERE run_id=? ORDER BY ts_ms LIMIT 2000", (run_id,)
    ))


def group_fault(fault_type: str) -> str:
    return fault_group_of(fault_type)


def cluster_badcases(rows: list[dict]) -> list[dict]:
    """按故障组 + 主要失分维度聚类，返回排序后的簇。"""
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        group = fault_group_of(r.get("fault_type", "")) or "unclassified"
        weak = r.get("weak_dimension") or "unknown"
        buckets[(group, weak)].append(r)
    out = []
    for (group, weak), items in buckets.items():
        out.append({
            "fault_group": group,
            "fault_group_label": FAULT_GROUPS.get(group) and group or group,
            "weak_dimension": weak,
            "count": len(items),
            "avg_score": round(sum(i.get("score") or 0 for i in items) / len(items), 3),
            "case_ids": [i["id"] for i in items],
            "cases": [{"id": i["id"], "case_key": i.get("case_key"), "title": i.get("title")} for i in items],
        })
    out.sort(key=lambda x: (-x["count"], x["avg_score"]))
    return out


def fault_taxonomy_payload() -> dict:
    return {
        "groups": [
            {"group": g, "types": [{"type": t, "label": t} for t in types]}
            for g, types in FAULT_GROUPS.items()
        ],
        "canonical_types": sorted({t for types in FAULT_GROUPS.values() for t in types}),
    }


def canonicalize(payload: dict) -> dict:
    if payload.get("fault_type"):
        payload["fault_type"] = canonical_fault_type(payload["fault_type"]) or payload["fault_type"]
    return payload
