"""故障类型分类树 + 实体归一化 + 四层真值评分引擎 + GSTO 质量门禁。

四层真值（对齐 RCA Benchmark 的结构化 Ground Truth）：
  L1 故障类型 fault_type      → 定因
  L2 归一化根因实体 entity     → 定界
  L3 因果传播链 causal_chain   → 过程
  L4 关键证据检查点 evidence    → 过程

综合分 = 定因 40% + 定界 30% + 过程 30%，其中约七成来自确定性计算
（故障类型语义距离 / 实体拓扑距离 / 链路 LCS / 证据命中），
不依赖大模型评审，保证可复现、可审计。
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

# ---------------------------------------------------------------- 故障分类树

# 组内顺序也用于计算"相邻组"距离
FAULT_GROUPS: dict[str, list[str]] = {
    "application-logic": [
        "httpError5xx", "rateLimiting", "trafficSurge", "trafficHotspot",
        "nullPointerException", "loadBalancerFailure", "codeDefect",
    ],
    "jvm-runtime": ["memoryPressure", "threadExhaustion", "fullGC", "cpuDeadLoop"],
    "middleware-db": [
        "slowSQL", "redisUnavailable", "dbNetworkLatency",
        "messageQueueBacklog", "cacheBreakdown",
    ],
    "k8s-lifecycle": [
        "replicaScaleDown", "podCrashLoop", "podPendingUnschedulable",
        "podRestartFlapping", "resourceLimitMisconfig", "networkPolicyIsolation",
        "dnsResolutionFailure",
    ],
    "cloud-resource": ["nodeCpuHigh", "nodeDown", "nodeMemoryOOM", "diskIOHigh"],
    "resource-perf": ["cpuFullLoad", "memoryFullLoad", "ioHigh"],
}

GROUP_ORDER = list(FAULT_GROUPS.keys())

# 中文/口语别名 → 规范类型
FAULT_ALIASES: dict[str, str] = {
    "慢查询": "slowSQL", "慢sql": "slowSQL", "mysql慢查询": "slowSQL", "sql慢": "slowSQL",
    "数据库慢": "slowSQL", "slow query": "slowSQL",
    "5xx": "httpError5xx", "报错5xx": "httpError5xx", "前端报错": "httpError5xx",
    "服务端错误": "httpError5xx", "http500": "httpError5xx",
    "限流": "rateLimiting", "流控": "rateLimiting", "429": "rateLimiting",
    "流量暴涨": "trafficSurge", "流量突增": "trafficSurge", "流量激增": "trafficSurge",
    "热点": "trafficHotspot", "热点key": "trafficHotspot",
    "空指针": "nullPointerException", "npe": "nullPointerException",
    "负载均衡失败": "loadBalancerFailure",
    "代码缺陷": "codeDefect", "代码bug": "codeDefect",
    "内存打满": "memoryPressure", "内存压力": "memoryPressure", "oom": "memoryPressure",
    "线程耗尽": "threadExhaustion", "线程池满": "threadExhaustion",
    "fullgc": "fullGC", "gc停顿": "fullGC", "gc": "fullGC",
    "cpu死循环": "cpuDeadLoop", "死循环": "cpuDeadLoop",
    "redis不可用": "redisUnavailable", "缓存不可用": "redisUnavailable",
    "缓存击穿": "cacheBreakdown", "缓存穿透": "cacheBreakdown",
    "db网络延迟": "dbNetworkLatency", "数据库网络抖动": "dbNetworkLatency",
    "消息积压": "messageQueueBacklog", "mq积压": "messageQueueBacklog",
    "副本缩容": "replicaScaleDown", "实例减少": "replicaScaleDown",
    "容器重启": "podRestartFlapping", "pod重启": "podRestartFlapping",
    "crashloop": "podCrashLoop", "容器崩溃": "podCrashLoop",
    "调度失败": "podPendingUnschedulable", "pod pending": "podPendingUnschedulable",
    "资源限制错误": "resourceLimitMisconfig", "limit配置错误": "resourceLimitMisconfig",
    "网络策略隔离": "networkPolicyIsolation",
    "dns解析失败": "dnsResolutionFailure", "dns故障": "dnsResolutionFailure",
    "节点cpu高": "nodeCpuHigh", "宿主机cpu高": "nodeCpuHigh",
    "节点宕机": "nodeDown", "节点不可用": "nodeDown",
    "节点内存oom": "nodeMemoryOOM",
    "磁盘io高": "diskIOHigh", "io高": "diskIOHigh",
    "cpu打满": "cpuFullLoad", "cpu利用率太高": "cpuFullLoad", "cpu饱和": "cpuFullLoad",
    "内存占满": "memoryFullLoad",
}

TYPE_TO_GROUP: dict[str, str] = {
    t: g for g, types in FAULT_GROUPS.items() for t in types
}


def canonical_fault_type(raw: str) -> str:
    """把用户/Agent 给出的故障类型描述归一化到规范类型。"""
    if not raw:
        return ""
    s = str(raw).strip()
    if s in TYPE_TO_GROUP:
        return s
    low = s.lower().replace("_", "").replace("-", "").replace(" ", "")
    for t in TYPE_TO_GROUP:
        if t.lower().replace("_", "").replace("-", "") == low:
            return t
    for alias, t in FAULT_ALIASES.items():
        if alias and alias in s.lower():
            return t
    # 宽松包含匹配
    for t in TYPE_TO_GROUP:
        if t.lower() in low:
            return t
    return s if s in TYPE_TO_GROUP else ""


def fault_group_of(fault_type: str) -> str:
    return TYPE_TO_GROUP.get(canonical_fault_type(fault_type), "")


def fault_type_score(expected: str, actual: str) -> tuple[float, str]:
    """定因素分：完全命中 1.0 / 同组 0.6 / 相邻组 0.3 / 跨两组 0.12 / 未命中 0.05。"""
    e, a = canonical_fault_type(expected), canonical_fault_type(actual)
    if not a:
        return 0.0, "未给出故障类型"
    if not e:
        return 0.0, "样本缺少真值故障类型"
    if e == a:
        return 1.0, f"故障类型精确命中 {e}"
    ge, ga = fault_group_of(e), fault_group_of(a)
    if ge and ge == ga:
        return 0.6, f"同组命中：{a} ⊂ {ge}（真值 {e}）"
    if ge and ga and ge in GROUP_ORDER and ga in GROUP_ORDER:
        d = abs(GROUP_ORDER.index(ge) - GROUP_ORDER.index(ga))
        if d == 1:
            return 0.3, f"相邻组命中：{ga} ↔ {ge}"
        if d == 2:
            return 0.12, f"跨组相近：{ga} ↔ {ge}"
    return 0.05, f"故障类型偏差较大：{a} vs {e}"


# ---------------------------------------------------------------- 实体归一化

_POD_SUFFIX = re.compile(r"-[0-9a-f]{6,10}-[a-z0-9]{4,6}$")
_PORT_SUFFIX = re.compile(r":\d{2,5}$")
_ENV_PREFIX = re.compile(r"^(prod|prd|stg|stage|test|dev|uat|pre|gray|canary)[-_/]")


def normalize_entity(raw: str) -> str:
    """跨域唯一主键归一化：去环境前缀 / 去 Pod 哈希 / 去端口 / 统一分隔符与大小写。

    让 APM 里的 `prod-cart-service-5f7c9d-x2k4`、K8s 里的 `cart-service`、
    云资源里的 `cart_service:8080` 收敛到同一个 `cart-service`。
    """
    if not raw:
        return ""
    s = str(raw).strip().lower()
    s = _PORT_SUFFIX.sub("", s)
    s = s.split("/")[-1]
    s = _ENV_PREFIX.sub("", s)
    s = _POD_SUFFIX.sub("", s)
    s = re.sub(r"[\s_\.]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s


def entity_alias_lookup(raw: str, alias_map: dict[str, str]) -> str:
    key = normalize_entity(raw)
    if key in alias_map:
        return normalize_entity(alias_map[key])
    for alias, target in alias_map.items():
        if normalize_entity(alias) == key or alias in str(raw).lower():
            return normalize_entity(target)
    return key


def topology_distance(a: str, b: str, edges: dict[str, set[str]], max_depth: int = 4) -> int | None:
    """在实体拓扑上求最短距离，未知返回 None。"""
    a, b = normalize_entity(a), normalize_entity(b)
    if not a or not b:
        return None
    if a == b:
        return 0
    seen = {a}
    frontier = [a]
    for depth in range(1, max_depth + 1):
        nxt: list[str] = []
        for node in frontier:
            for nb in edges.get(node, set()):
                if nb == b:
                    return depth
                if nb not in seen:
                    seen.add(nb)
                    nxt.append(nb)
        if not nxt:
            return None
        frontier = nxt
    return None


def entity_score(expected: str, actual: str, edges: dict[str, set[str]],
                 expected_type: str = "", actual_type: str = "") -> tuple[float, str]:
    """定界素分：按拓扑距离量化，距离 0 → 1.0，每跳衰减 0.25。"""
    if not actual:
        return 0.0, "未给出根因实体"
    if not expected:
        return 0.0, "样本缺少真值实体"
    d = topology_distance(expected, actual, edges)
    if d == 0:
        return 1.0, f"实体精确命中 {normalize_entity(expected)}"
    if d is not None:
        return max(0.1, 1.0 - 0.25 * d), f"实体拓扑距离 {d}（{normalize_entity(actual)} → {normalize_entity(expected)}）"
    # 拓扑不可达时退化为名称相似度 + 类型一致性
    sim = SequenceMatcher(None, normalize_entity(expected), normalize_entity(actual)).ratio()
    same_type = bool(expected_type) and expected_type == actual_type
    score = min(0.45, sim * 0.5 + (0.15 if same_type else 0.0))
    return round(score, 3), f"拓扑不可达，名称相似度 {sim:.2f}{'，类型一致' if same_type else ''}"


# ---------------------------------------------------------------- 链路与证据

def _norm_step(s: str) -> str:
    return re.sub(r"[\s_\-]+", "-", str(s).strip().lower())


def causal_chain_score(expected: list[str], actual: list[str]) -> tuple[float, str]:
    """过程素分（链路）：基于最长公共子序列的有序覆盖率。"""
    if not expected:
        return 0.0, "样本缺少真值因果链"
    if not actual:
        return 0.0, "未给出因果链"
    e = [_norm_step(x) for x in expected]
    a = [_norm_step(x) for x in actual]
    sm = SequenceMatcher(None, e, a)
    matched = sum(blk.size for blk in sm.get_matching_blocks())
    seq_ratio = matched / len(e)
    order_penalty = 1.0 if seq_ratio > 0 else 0.0
    # 顺序正确性：命中项在 a 中是否保持 e 的相对次序
    if matched:
        idx = [a.index(x) for x in e if x in a]
        ordered = all(idx[i] < idx[i + 1] for i in range(len(idx) - 1))
        order_penalty = 1.0 if ordered else 0.7
    score = round(min(1.0, seq_ratio * order_penalty), 3)
    return score, f"链路命中 {matched}/{len(e)} 步，顺序{'正确' if order_penalty == 1.0 else '错乱'}"


def evidence_score(expected: list[dict], actual: list[dict]) -> tuple[float, str]:
    """过程素分（证据）：关键证据检查点命中率。

    命中规则（满足其一即算命中，避免因表述差异误杀正确取证）：
      A. 关键词命中：检查点的任一 keywords 出现在证据文本里；
      B. 实体 + 指标同时命中：证据里同时出现根因实体与判别性指标名。
    """
    if not expected:
        return 0.0, "样本缺少关键证据检查点"
    if not actual:
        return 0.0, "未给出诊断证据"
    hit = 0
    details: list[str] = []
    for ck in expected:
        keys = [str(k).lower() for k in (ck.get("keywords") or []) if k]
        ent = normalize_entity(ck.get("entity", ""))
        metric = str(ck.get("metric") or "").lower()
        found = False
        for ev in actual:
            blob = json_dumps_lower(ev)
            if keys and any(k in blob for k in keys):
                found = True
            elif (ent or metric) and (not ent or ent in blob) and (not metric or metric in blob):
                found = True
            elif not keys and not ent and not metric:
                found = True
            if found:
                break
        if found:
            hit += 1
        else:
            details.append(ck.get("name") or (",".join(keys) if keys else ent or "未命名检查点"))
    score = round(hit / len(expected), 3)
    miss = f"，未命中：{'、'.join(details[:3])}" if details else ""
    return score, f"证据检查点命中 {hit}/{len(expected)}{miss}"


def json_dumps_lower(obj) -> str:
    import json
    try:
        return json.dumps(obj, ensure_ascii=False).lower()
    except (TypeError, ValueError):
        return str(obj).lower()


# ---------------------------------------------------------------- 综合评分

WEIGHTS = {"fault": 0.4, "entity": 0.3, "process": 0.3}


def score_case(case: dict, prediction: dict, edges: dict[str, set[str]]) -> dict:
    """对一次 Agent 作答按四层真值评分。prediction 结构：
    {fault_type, entity, entity_type, causal_chain[], evidence[]}
    """
    f_score, f_note = fault_type_score(case.get("fault_type", ""), prediction.get("fault_type", ""))
    e_score, e_note = entity_score(
        case.get("root_cause_entity", "") or case.get("entity_key", ""),
        prediction.get("entity", ""),
        edges,
        expected_type=case.get("fault_group", ""),
        actual_type=prediction.get("entity_type", ""),
    )
    c_score, c_note = causal_chain_score(case.get("causal_chain") or [], prediction.get("causal_chain") or [])
    v_score, v_note = evidence_score(case.get("evidence") or [], prediction.get("evidence") or [])

    process = round(c_score * 0.6 + v_score * 0.4, 3)
    total = round(f_score * WEIGHTS["fault"] + e_score * WEIGHTS["entity"] + process * WEIGHTS["process"], 3)
    verdict = "pass" if total >= 0.75 else ("partial" if total >= 0.5 else "fail")
    return {
        "score": total,
        "score_fault": f_score,
        "score_entity": e_score,
        "score_process": process,
        "verdict": verdict,
        "detail": {
            "weights": WEIGHTS,
            "fault": {"score": f_score, "note": f_note},
            "entity": {"score": e_score, "note": e_note},
            "chain": {"score": c_score, "note": c_note, "weight_in_process": 0.6},
            "evidence": {"score": v_score, "note": v_note, "weight_in_process": 0.4},
            "deterministic_ratio": round(
                (WEIGHTS["fault"] + WEIGHTS["entity"] + WEIGHTS["process"] * 0.6), 3
            ),
        },
    }


# ---------------------------------------------------------------- GSTO 质量门禁

def quality_gate(case: dict, signals: list[dict] | None = None, edges: dict[str, set[str]] | None = None) -> dict:
    """四层准入校验：Structure / Signal / TimeWindow / Openness。

    结构规范、信号有效性、时间窗口、开放适配性。只有四层全过的样本才允许沉淀为黄金案例。
    """
    checks: list[dict] = []
    signals = signals or []
    edges = edges or {}

    ok_struct = bool(case.get("title")) and bool(canonical_fault_type(case.get("fault_type", "")))
    ok_struct = ok_struct and bool(normalize_entity(case.get("root_cause_entity", "") or case.get("entity_key", "")))
    checks.append({
        "layer": "Structure",
        "name": "结构规范",
        "passed": ok_struct,
        "note": "标题 / 规范化故障类型 / 归一化根因实体齐备" if ok_struct else "缺标题、故障类型或归一化根因实体",
    })

    modalities = {s.get("modality") for s in signals}
    need = {"metric", "log", "trace"}
    ok_signal = need.issubset(modalities) and len(signals) >= 5
    checks.append({
        "layer": "Signal",
        "name": "信号有效性",
        "passed": ok_signal,
        "note": f"模态 {sorted(m for m in modalities if m)}，共 {len(signals)} 条" if ok_signal
                else f"需至少 metric/log/trace 三模态且 ≥5 条信号，当前 {sorted(m for m in modalities if m)} / {len(signals)} 条",
    })

    ts = [int(s.get("ts_ms") or 0) for s in signals if s.get("ts_ms")]
    span = (max(ts) - min(ts)) if ts else 0
    ok_time = bool(ts) and span <= 6 * 3600 * 1000
    checks.append({
        "layer": "TimeWindow",
        "name": "时间窗口",
        "passed": ok_time,
        "note": f"观测窗口 {round(span / 60000, 1)} 分钟" if ok_time else "缺少时间戳或窗口超过 6 小时",
    })

    ent = normalize_entity(case.get("root_cause_entity", "") or case.get("entity_key", ""))
    ok_open = bool(ent) and (not edges or ent in edges)
    checks.append({
        "layer": "Openness",
        "name": "开放适配性",
        "passed": ok_open,
        "note": "根因实体存在于统一实体模型，可跨域映射" if ok_open else "根因实体未在统一实体模型（UModel）中登记，无法计算拓扑距离",
    })

    passed = all(c["passed"] for c in checks)
    return {"passed": passed, "checks": checks, "score": round(sum(c["passed"] for c in checks) / len(checks), 3)}
