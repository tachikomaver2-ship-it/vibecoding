// ── Metric Computation Engine ────────────────────────────────────────────────
// Implements 23 metric computation functions across 6 evaluation dimensions.
// Each function takes a PrismaClient and optional filters, returning MetricResult.

import { PrismaClient, Prisma } from '@prisma/client';
import type {
  MetricResult,
  MetricFilters,
  MetricDefinition,
  HealingTimeDistribution,
} from './types';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a Prisma where clause from optional filters. */
function buildWhereClause(filters?: MetricFilters): Prisma.HealingEventWhereInput {
  if (!filters) return {};
  const where: Prisma.HealingEventWhereInput = {};

  if (filters.dateRange) {
    where.errorOccurredAt = {
      gte: filters.dateRange.from,
      lte: filters.dateRange.to,
    };
  }
  if (filters.layer) {
    where.errorLayer = filters.layer;
  }
  if (filters.tenantId) {
    where.tenant = { tenantId: filters.tenantId };
  }
  if (filters.environment) {
    where.environment = filters.environment;
  }

  return where;
}

/** Safe division: returns 0 when denominator is 0. */
function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

/** Convert Prisma Decimal (string | Decimal) to number. */
function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  return Number(val);
}

/** Percentage rounded to 2 decimal places. */
function pct(numerator: number, denominator: number): number {
  return Math.round(safeDivide(numerator, denominator) * 10000) / 100;
}

// ── Outcome Metrics (结果指标) ──────────────────────────────────────────────

/**
 * 1. Self-Healing Success Rate (自愈成功率)
 * Formula: SUCCESS count / total events, with breakdown by L1-L5
 */
export async function computeSelfHealingSuccessRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, successCount, layerCounts] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({ where: { ...where, outcome: 'SUCCESS' } }),
    Promise.all(
      (['L1', 'L2', 'L3', 'L4', 'L5'] as const).map(async (layer) => {
        const layerWhere = { ...where, errorLayer: layer };
        const [layerTotal, layerSuccess] = await Promise.all([
          prisma.healingEvent.count({ where: layerWhere }),
          prisma.healingEvent.count({ where: { ...layerWhere, outcome: 'SUCCESS' } }),
        ]);
        return { layer, rate: pct(layerSuccess, layerTotal) };
      }),
    ),
  ]);

  const breakdown: Record<string, number> = {};
  for (const { layer, rate } of layerCounts) {
    breakdown[layer] = rate;
  }

  return {
    name: 'self_healing_success_rate',
    value: pct(successCount, total),
    unit: '%',
    dimension: 'outcome',
    breakdown,
  };
}

/**
 * 2. Verification Pass Rate (修复验证通过率)
 * Formula: verified=true / total SUCCESS events
 */
export async function computeVerificationPassRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);
  const successWhere = { ...where, outcome: 'SUCCESS' as const };

  const [totalSuccess, verifiedCount] = await Promise.all([
    prisma.healingEvent.count({ where: successWhere }),
    prisma.healingEvent.count({ where: { ...successWhere, verified: true } }),
  ]);

  return {
    name: 'verification_pass_rate',
    value: pct(verifiedCount, totalSuccess),
    unit: '%',
    dimension: 'outcome',
  };
}

/**
 * 3. GSB Score (Good/Same/Bad 评分)
 * Formula: GOOD count / total review scores → Good Rate
 */
export async function computeGsbScore(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const eventWhere = buildWhereClause(filters);

  const reviewWhere: Prisma.ReviewScoreWhereInput = {
    healingEvent: eventWhere,
  };

  const [totalReviews, goodCount, sameCount, badCount] = await Promise.all([
    prisma.reviewScore.count({ where: reviewWhere }),
    prisma.reviewScore.count({ where: { ...reviewWhere, gsbScore: 'GOOD' } }),
    prisma.reviewScore.count({ where: { ...reviewWhere, gsbScore: 'SAME' } }),
    prisma.reviewScore.count({ where: { ...reviewWhere, gsbScore: 'BAD' } }),
  ]);

  return {
    name: 'gsb_good_rate',
    value: pct(goodCount, totalReviews),
    unit: '%',
    dimension: 'outcome',
    breakdown: {
      good: goodCount,
      same: sameCount,
      bad: badCount,
    },
  };
}

// ── Process Metrics (过程指标) ──────────────────────────────────────────────

/**
 * 4. Step Accuracy (步骤准确率)
 * Formula: SUM(correct_steps) / SUM(total_steps) across matching events
 */
export async function computeStepAccuracy(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const events = await prisma.healingEvent.findMany({
    where,
    select: { correctSteps: true, totalSteps: true },
  });

  let totalCorrect = 0;
  let totalSteps = 0;
  for (const ev of events) {
    totalCorrect += ev.correctSteps;
    totalSteps += ev.totalSteps;
  }

  return {
    name: 'step_accuracy',
    value: pct(totalCorrect, totalSteps),
    unit: '%',
    dimension: 'process',
  };
}

/**
 * 5. Step Efficiency Ratio (步骤效率比)
 * Formula: SUM(optimal_steps) / SUM(total_steps) across matching events
 */
export async function computeStepEfficiencyRatio(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const events = await prisma.healingEvent.findMany({
    where,
    select: { optimalSteps: true, totalSteps: true },
  });

  let totalOptimal = 0;
  let totalSteps = 0;
  for (const ev of events) {
    totalOptimal += ev.optimalSteps;
    totalSteps += ev.totalSteps;
  }

  return {
    name: 'step_efficiency_ratio',
    value: pct(totalOptimal, totalSteps),
    unit: '%',
    dimension: 'process',
  };
}

/**
 * 6. Path Similarity (路径相似度)
 * Formula: AVG(path_similarity) across matching events
 */
export async function computePathSimilarity(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const result = await prisma.healingEvent.aggregate({
    where: { ...where, pathSimilarity: { not: null } },
    _avg: { pathSimilarity: true },
  });

  return {
    name: 'path_similarity',
    value: Math.round(toNumber(result._avg.pathSimilarity) * 10000) / 100,
    unit: '%',
    dimension: 'process',
  };
}

/**
 * 7. Doom-Loop Detection Rate (Doom-Loop 检测率)
 * Formula: events with doom_loop triggered / total events
 */
export async function computeDoomLoopDetectionRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [totalEvents, doomLoopEvents] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.doomLoopEvent.count({
      where: {
        doomLoopTriggered: true,
        healingEvent: where,
      },
    }),
  ]);

  return {
    name: 'doom_loop_detection_rate',
    value: pct(doomLoopEvents, totalEvents),
    unit: '%',
    dimension: 'process',
  };
}

// ── Efficiency Metrics (效率指标) ────────────────────────────────────────────

/**
 * 8. MTTD (Mean Time To Detect)
 * Formula: AVG(mttdMs), with breakdown by layer
 */
export async function computeMttd(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const events = await prisma.healingEvent.findMany({
    where: { ...where, mttdMs: { not: null } },
    select: { mttdMs: true, errorLayer: true },
  });

  let totalMs = 0;
  const layerTotals: Record<string, { sum: number; count: number }> = {};

  for (const ev of events) {
    const ms = Number(ev.mttdMs);
    totalMs += ms;
    const layer = ev.errorLayer;
    if (!layerTotals[layer]) layerTotals[layer] = { sum: 0, count: 0 };
    layerTotals[layer].sum += ms;
    layerTotals[layer].count += 1;
  }

  const avgMs = safeDivide(totalMs, events.length);

  const breakdown: Record<string, number> = {};
  for (const [layer, { sum, count }] of Object.entries(layerTotals)) {
    breakdown[layer] = Math.round(safeDivide(sum, count));
  }

  return {
    name: 'mttd',
    value: Math.round(avgMs),
    unit: 'ms',
    dimension: 'efficiency',
    breakdown,
  };
}

/**
 * 9. MTTR (Mean Time To Recovery)
 * Formula: AVG(mttrMs) for SUCCESS events only
 */
export async function computeMttr(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const events = await prisma.healingEvent.findMany({
    where: { ...where, outcome: 'SUCCESS', mttrMs: { not: null } },
    select: { mttrMs: true, errorLayer: true },
  });

  let totalMs = 0;
  const layerTotals: Record<string, { sum: number; count: number }> = {};

  for (const ev of events) {
    const ms = Number(ev.mttrMs);
    totalMs += ms;
    const layer = ev.errorLayer;
    if (!layerTotals[layer]) layerTotals[layer] = { sum: 0, count: 0 };
    layerTotals[layer].sum += ms;
    layerTotals[layer].count += 1;
  }

  const avgMs = safeDivide(totalMs, events.length);

  const breakdown: Record<string, number> = {};
  for (const [layer, { sum, count }] of Object.entries(layerTotals)) {
    breakdown[layer] = Math.round(safeDivide(sum, count));
  }

  return {
    name: 'mttr',
    value: Math.round(avgMs),
    unit: 'ms',
    dimension: 'efficiency',
    breakdown,
  };
}

/**
 * 10. Token Efficiency (Token 消耗效率)
 * Formula: success_rate / (avg_total_tokens / 1000)
 * Higher means more success per 1K tokens consumed.
 */
export async function computeTokenEfficiency(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, successCount, tokenAgg] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({ where: { ...where, outcome: 'SUCCESS' } }),
    prisma.healingEvent.aggregate({
      where: { ...where, totalTokens: { gt: 0 } },
      _avg: { totalTokens: true },
    }),
  ]);

  const successRate = safeDivide(successCount, total);
  const avgTokensK = safeDivide(toNumber(tokenAgg._avg.totalTokens), 1000);
  const efficiency = safeDivide(successRate, avgTokensK);

  return {
    name: 'token_efficiency',
    value: Math.round(efficiency * 10000) / 10000,
    unit: 'rate/K-tokens',
    dimension: 'efficiency',
  };
}

/**
 * 11. Cost Per Healing (单次自愈成本)
 * Formula: AVG(totalCostUsd) across all events
 */
export async function computeCostPerHealing(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const result = await prisma.healingEvent.aggregate({
    where: { ...where, totalCostUsd: { not: null } },
    _avg: { totalCostUsd: true },
    _sum: { totalCostUsd: true },
    _count: true,
  });

  return {
    name: 'cost_per_healing',
    value: Math.round(toNumber(result._avg.totalCostUsd) * 10000) / 10000,
    unit: 'USD',
    dimension: 'efficiency',
  };
}

/**
 * 12. Healing Time Distribution (自愈时间分布)
 * Formula: AVG of detection / diagnosis / healing / verification durations
 */
export async function computeHealingTimeDistribution(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const events = await prisma.healingEvent.findMany({
    where,
    select: {
      mttdMs: true,
      diagnosisDurationMs: true,
      healingDurationMs: true,
      verificationDurationMs: true,
      totalDurationMs: true,
    },
  });

  let detectSum = 0;
  let diagnosisSum = 0;
  let healingSum = 0;
  let verifySum = 0;
  let totalSum = 0;
  const count = events.length;

  for (const ev of events) {
    detectSum += Number(ev.mttdMs ?? 0);
    diagnosisSum += Number(ev.diagnosisDurationMs ?? 0);
    healingSum += Number(ev.healingDurationMs ?? 0);
    verifySum += Number(ev.verificationDurationMs ?? 0);
    totalSum += Number(ev.totalDurationMs ?? 0);
  }

  const distribution: HealingTimeDistribution = {
    avgDetectionMs: Math.round(safeDivide(detectSum, count)),
    avgDiagnosisMs: Math.round(safeDivide(diagnosisSum, count)),
    avgHealingMs: Math.round(safeDivide(healingSum, count)),
    avgVerificationMs: Math.round(safeDivide(verifySum, count)),
    avgTotalMs: Math.round(safeDivide(totalSum, count)),
  };

  return {
    name: 'healing_time_distribution',
    value: distribution.avgTotalMs,
    unit: 'ms',
    dimension: 'efficiency',
    breakdown: {
      detectionMs: distribution.avgDetectionMs,
      diagnosisMs: distribution.avgDiagnosisMs,
      healingMs: distribution.avgHealingMs,
      verificationMs: distribution.avgVerificationMs,
    },
  };
}

// ── Security Metrics (安全指标) ──────────────────────────────────────────────

/**
 * 13. Blast Radius (爆炸半径)
 * Formula: AVG(affected_scope); constrained to ≤ 1 in mature phase
 */
export async function computeBlastRadius(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const result = await prisma.healingEvent.aggregate({
    where,
    _avg: { affectedScope: true },
    _max: { affectedScope: true },
  });

  return {
    name: 'blast_radius',
    value: Math.round(toNumber(result._avg.affectedScope) * 100) / 100,
    unit: 'scope',
    dimension: 'security',
    breakdown: {
      avgScope: Math.round(toNumber(result._avg.affectedScope) * 100) / 100,
      maxScope: result._max.affectedScope ?? 0,
    },
  };
}

/**
 * 14. Error Rate (误操作率)
 * Formula: events with newAlertsAfter > 0 / total events
 */
export async function computeErrorRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, withNewAlerts] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({
      where: { ...where, newAlertsAfter: { gt: 0 } },
    }),
  ]);

  return {
    name: 'error_rate',
    value: pct(withNewAlerts, total),
    unit: '%',
    dimension: 'security',
  };
}

/**
 * 15. Approval Gate Trigger Rate (审批门触发率)
 * Formula: approvalRequired=true / total events
 */
export async function computeApprovalGateTriggerRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, approvalRequired] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({ where: { ...where, approvalRequired: true } }),
  ]);

  return {
    name: 'approval_gate_trigger_rate',
    value: pct(approvalRequired, total),
    unit: '%',
    dimension: 'security',
  };
}

/**
 * 16. Rollback Rate (回滚率)
 * Formula: rollbackTriggered / total events
 */
export async function computeRollbackRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, rolledBack] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({ where: { ...where, rollbackTriggered: true } }),
  ]);

  return {
    name: 'rollback_rate',
    value: pct(rolledBack, total),
    unit: '%',
    dimension: 'security',
  };
}

// ── Learning Metrics (学习指标) ──────────────────────────────────────────────

/**
 * 17. Runbook Hit Rate (Runbook 命中率)
 * Formula: runbookHit=true / total events
 */
export async function computeRunbookHitRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, hits] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({ where: { ...where, runbookHit: true } }),
  ]);

  return {
    name: 'runbook_hit_rate',
    value: pct(hits, total),
    unit: '%',
    dimension: 'learning',
  };
}

/**
 * 18. Self-Healing Rate Trend WoW (自愈率趋势 周环比)
 * Formula: (currentWeekRate - previousWeekRate) / previousWeekRate * 100
 */
export async function computeSelfHealingRateTrendWoW(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const now = filters?.dateRange?.to ?? new Date();
  const currentWeekEnd = now;
  const currentWeekStart = new Date(currentWeekEnd);
  currentWeekStart.setDate(currentWeekStart.getDate() - 7);
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);

  const baseWhere = buildWhereClause({
    ...filters,
    dateRange: undefined,
  });

  const [currentTotal, currentSuccess, previousTotal, previousSuccess] = await Promise.all([
    prisma.healingEvent.count({
      where: { ...baseWhere, errorOccurredAt: { gte: currentWeekStart, lte: currentWeekEnd } },
    }),
    prisma.healingEvent.count({
      where: {
        ...baseWhere,
        outcome: 'SUCCESS',
        errorOccurredAt: { gte: currentWeekStart, lte: currentWeekEnd },
      },
    }),
    prisma.healingEvent.count({
      where: { ...baseWhere, errorOccurredAt: { gte: previousWeekStart, lt: currentWeekStart } },
    }),
    prisma.healingEvent.count({
      where: {
        ...baseWhere,
        outcome: 'SUCCESS',
        errorOccurredAt: { gte: previousWeekStart, lt: currentWeekStart },
      },
    }),
  ]);

  const currentRate = safeDivide(currentSuccess, currentTotal);
  const previousRate = safeDivide(previousSuccess, previousTotal);
  const wowChange = previousRate === 0 ? 0 : ((currentRate - previousRate) / previousRate) * 100;

  return {
    name: 'self_healing_rate_trend_wow',
    value: Math.round(wowChange * 100) / 100,
    unit: '%',
    dimension: 'learning',
    breakdown: {
      currentWeekRate: pct(currentSuccess, currentTotal),
      previousWeekRate: pct(previousSuccess, previousTotal),
    },
  };
}

/**
 * 19. Knowledge Retention Rate (新知识沉淀率)
 * Formula: new RunbookEntry records / missed (FAILED + ESCALATED) events
 */
export async function computeKnowledgeRetentionRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const missedWhere: Prisma.HealingEventWhereInput = {
    ...where,
    outcome: { in: ['FAILED', 'ESCALATED'] },
  };

  const [missedEvents, newRunbookEntries] = await Promise.all([
    prisma.healingEvent.count({ where: missedWhere }),
    prisma.runbookEntry.count({
      where: filters?.dateRange
        ? {
            createdAt: {
              gte: filters.dateRange.from,
              lte: filters.dateRange.to,
            },
          }
        : {},
    }),
  ]);

  return {
    name: 'knowledge_retention_rate',
    value: pct(newRunbookEntries, missedEvents),
    unit: '%',
    dimension: 'learning',
    breakdown: {
      missedEvents,
      newRunbookEntries,
    },
  };
}

/**
 * 20. Runbook Decay Rate (Runbook 条目衰减率)
 * Formula: deprecated entries / total entries
 */
export async function computeRunbookDecayRate(
  prisma: PrismaClient,
  _filters?: MetricFilters,
): Promise<MetricResult> {
  const [totalEntries, deprecatedEntries, dormantEntries] = await Promise.all([
    prisma.runbookEntry.count(),
    prisma.runbookEntry.count({ where: { status: 'deprecated' } }),
    prisma.runbookEntry.count({ where: { status: 'dormant' } }),
  ]);

  return {
    name: 'runbook_decay_rate',
    value: pct(deprecatedEntries, totalEntries),
    unit: '%',
    dimension: 'learning',
    breakdown: {
      total: totalEntries,
      deprecated: deprecatedEntries,
      dormant: dormantEntries,
    },
  };
}

// ── Business Metrics (业务指标) ──────────────────────────────────────────────

/**
 * 21. Human Escalation Rate (人工升级率)
 * Formula: escalatedToHuman / total events
 */
export async function computeHumanEscalationRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, escalated] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({ where: { ...where, escalatedToHuman: true } }),
  ]);

  return {
    name: 'human_escalation_rate',
    value: pct(escalated, total),
    unit: '%',
    dimension: 'business',
  };
}

/**
 * 22. User Unawareness Rate (用户无感知率)
 * Formula: !userVisibleImpact / total events
 */
export async function computeUserUnawarenessRate(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const [total, noImpact] = await Promise.all([
    prisma.healingEvent.count({ where }),
    prisma.healingEvent.count({ where: { ...where, userVisibleImpact: false } }),
  ]);

  return {
    name: 'user_unawareness_rate',
    value: pct(noImpact, total),
    unit: '%',
    dimension: 'business',
  };
}

/**
 * 23. Availability Uplift (可用性提升)
 * Formula: SUM(downtime_saved) / total_period_in_ms
 * downtime_saved = events where SUCCESS: sum(mttrMs - impactDurationMs) when positive
 * total_period = dateRange duration, or 30 days default
 */
export async function computeAvailabilityUplift(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<MetricResult> {
  const where = buildWhereClause(filters);

  const successEvents = await prisma.healingEvent.findMany({
    where: { ...where, outcome: 'SUCCESS' },
    select: { mttrMs: true, impactDurationMs: true },
  });

  let downtimeSavedMs = 0;
  for (const ev of successEvents) {
    const mttr = Number(ev.mttrMs ?? 0);
    const impact = Number(ev.impactDurationMs ?? 0);
    const saved = mttr - impact;
    if (saved > 0) {
      downtimeSavedMs += saved;
    }
  }

  const now = filters?.dateRange?.to ?? new Date();
  const rangeStart = filters?.dateRange?.from ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const totalPeriodMs = now.getTime() - rangeStart.getTime();

  const uplift = safeDivide(downtimeSavedMs, totalPeriodMs) * 100;

  return {
    name: 'availability_uplift',
    value: Math.round(uplift * 10000) / 10000,
    unit: '%',
    dimension: 'business',
    breakdown: {
      downtimeSavedMs,
      totalPeriodMs,
    },
  };
}

// ── All metric functions in a single array for iteration ────────────────────

export const METRIC_FUNCTIONS: Array<{
  id: string;
  fn: (prisma: PrismaClient, filters?: MetricFilters) => Promise<MetricResult>;
}> = [
  { id: 'self_healing_success_rate', fn: computeSelfHealingSuccessRate },
  { id: 'verification_pass_rate', fn: computeVerificationPassRate },
  { id: 'gsb_good_rate', fn: computeGsbScore },
  { id: 'step_accuracy', fn: computeStepAccuracy },
  { id: 'step_efficiency_ratio', fn: computeStepEfficiencyRatio },
  { id: 'path_similarity', fn: computePathSimilarity },
  { id: 'doom_loop_detection_rate', fn: computeDoomLoopDetectionRate },
  { id: 'mttd', fn: computeMttd },
  { id: 'mttr', fn: computeMttr },
  { id: 'token_efficiency', fn: computeTokenEfficiency },
  { id: 'cost_per_healing', fn: computeCostPerHealing },
  { id: 'healing_time_distribution', fn: computeHealingTimeDistribution },
  { id: 'blast_radius', fn: computeBlastRadius },
  { id: 'error_rate', fn: computeErrorRate },
  { id: 'approval_gate_trigger_rate', fn: computeApprovalGateTriggerRate },
  { id: 'rollback_rate', fn: computeRollbackRate },
  { id: 'runbook_hit_rate', fn: computeRunbookHitRate },
  { id: 'self_healing_rate_trend_wow', fn: computeSelfHealingRateTrendWoW },
  { id: 'knowledge_retention_rate', fn: computeKnowledgeRetentionRate },
  { id: 'runbook_decay_rate', fn: computeRunbookDecayRate },
  { id: 'human_escalation_rate', fn: computeHumanEscalationRate },
  { id: 'user_unawareness_rate', fn: computeUserUnawarenessRate },
  { id: 'availability_uplift', fn: computeAvailabilityUplift },
];

// ── Metric Definitions (static metadata for all 23 metrics) ─────────────────

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // ── Outcome ──
  {
    id: 'self_healing_success_rate',
    nameZh: '自愈成功率',
    nameEn: 'Self-Healing Success Rate',
    dimension: 'outcome',
    formula: 'SUCCESS count / total events',
    unit: '%',
    targets: { phase1: 60, phase2: 80, phase3: 95 },
    higherIsBetter: true,
  },
  {
    id: 'verification_pass_rate',
    nameZh: '修复验证通过率',
    nameEn: 'Verification Pass Rate',
    dimension: 'outcome',
    formula: 'verified=true / total SUCCESS events',
    unit: '%',
    targets: { phase1: 70, phase2: 85, phase3: 95 },
    higherIsBetter: true,
  },
  {
    id: 'gsb_good_rate',
    nameZh: 'GSB 评分 (Good Rate)',
    nameEn: 'GSB Good Rate',
    dimension: 'outcome',
    formula: 'GOOD review count / total review scores',
    unit: '%',
    targets: { phase1: 50, phase2: 70, phase3: 85 },
    higherIsBetter: true,
  },

  // ── Process ──
  {
    id: 'step_accuracy',
    nameZh: '步骤准确率',
    nameEn: 'Step Accuracy',
    dimension: 'process',
    formula: 'SUM(correct_steps) / SUM(total_steps)',
    unit: '%',
    targets: { phase1: 65, phase2: 80, phase3: 92 },
    higherIsBetter: true,
  },
  {
    id: 'step_efficiency_ratio',
    nameZh: '步骤效率比',
    nameEn: 'Step Efficiency Ratio',
    dimension: 'process',
    formula: 'SUM(optimal_steps) / SUM(total_steps)',
    unit: '%',
    targets: { phase1: 50, phase2: 70, phase3: 85 },
    higherIsBetter: true,
  },
  {
    id: 'path_similarity',
    nameZh: '路径相似度',
    nameEn: 'Path Similarity',
    dimension: 'process',
    formula: 'AVG(path_similarity)',
    unit: '%',
    targets: { phase1: 50, phase2: 70, phase3: 85 },
    higherIsBetter: true,
  },
  {
    id: 'doom_loop_detection_rate',
    nameZh: 'Doom-Loop 检测率',
    nameEn: 'Doom-Loop Detection Rate',
    dimension: 'process',
    formula: 'doom_loop triggered events / total events',
    unit: '%',
    targets: { phase1: 90, phase2: 95, phase3: 99 },
    higherIsBetter: true,
  },

  // ── Efficiency ──
  {
    id: 'mttd',
    nameZh: '平均检测时间 (MTTD)',
    nameEn: 'Mean Time To Detect',
    dimension: 'efficiency',
    formula: 'AVG(mttdMs)',
    unit: 'ms',
    targets: { phase1: 30000, phase2: 10000, phase3: 3000 },
    higherIsBetter: false,
  },
  {
    id: 'mttr',
    nameZh: '平均恢复时间 (MTTR)',
    nameEn: 'Mean Time To Recovery',
    dimension: 'efficiency',
    formula: 'AVG(mttrMs) for SUCCESS events',
    unit: 'ms',
    targets: { phase1: 300000, phase2: 120000, phase3: 60000 },
    higherIsBetter: false,
  },
  {
    id: 'token_efficiency',
    nameZh: 'Token 消耗效率',
    nameEn: 'Token Efficiency',
    dimension: 'efficiency',
    formula: 'success_rate / (avg_total_tokens / 1000)',
    unit: 'rate/K-tokens',
    targets: { phase1: 0.05, phase2: 0.15, phase3: 0.3 },
    higherIsBetter: true,
  },
  {
    id: 'cost_per_healing',
    nameZh: '单次自愈成本',
    nameEn: 'Cost Per Healing',
    dimension: 'efficiency',
    formula: 'AVG(totalCostUsd)',
    unit: 'USD',
    targets: { phase1: 2.0, phase2: 0.8, phase3: 0.3 },
    higherIsBetter: false,
  },
  {
    id: 'healing_time_distribution',
    nameZh: '自愈时间分布',
    nameEn: 'Healing Time Distribution',
    dimension: 'efficiency',
    formula: 'AVG of detection / diagnosis / healing / verification durations',
    unit: 'ms',
    targets: { phase1: 600000, phase2: 300000, phase3: 120000 },
    higherIsBetter: false,
  },

  // ── Security ──
  {
    id: 'blast_radius',
    nameZh: '爆炸半径',
    nameEn: 'Blast Radius',
    dimension: 'security',
    formula: 'AVG(affected_scope), constrained to <= 1',
    unit: 'scope',
    targets: { phase1: 3, phase2: 1.5, phase3: 1 },
    higherIsBetter: false,
  },
  {
    id: 'error_rate',
    nameZh: '误操作率',
    nameEn: 'Error Rate',
    dimension: 'security',
    formula: 'events with newAlertsAfter > 0 / total events',
    unit: '%',
    targets: { phase1: 10, phase2: 3, phase3: 1 },
    higherIsBetter: false,
  },
  {
    id: 'approval_gate_trigger_rate',
    nameZh: '审批门触发率',
    nameEn: 'Approval Gate Trigger Rate',
    dimension: 'security',
    formula: 'approvalRequired=true / total events',
    unit: '%',
    targets: { phase1: 30, phase2: 20, phase3: 10 },
    higherIsBetter: false,
  },
  {
    id: 'rollback_rate',
    nameZh: '回滚率',
    nameEn: 'Rollback Rate',
    dimension: 'security',
    formula: 'rollbackTriggered / total events',
    unit: '%',
    targets: { phase1: 15, phase2: 8, phase3: 3 },
    higherIsBetter: false,
  },

  // ── Learning ──
  {
    id: 'runbook_hit_rate',
    nameZh: 'Runbook 命中率',
    nameEn: 'Runbook Hit Rate',
    dimension: 'learning',
    formula: 'runbookHit=true / total events',
    unit: '%',
    targets: { phase1: 30, phase2: 55, phase3: 80 },
    higherIsBetter: true,
  },
  {
    id: 'self_healing_rate_trend_wow',
    nameZh: '自愈率趋势 (周环比)',
    nameEn: 'Self-Healing Rate Trend WoW',
    dimension: 'learning',
    formula: '(currentWeekRate - previousWeekRate) / previousWeekRate * 100',
    unit: '%',
    targets: { phase1: 0, phase2: 5, phase3: 10 },
    higherIsBetter: true,
  },
  {
    id: 'knowledge_retention_rate',
    nameZh: '新知识沉淀率',
    nameEn: 'Knowledge Retention Rate',
    dimension: 'learning',
    formula: 'new RunbookEntry records / missed (FAILED + ESCALATED) events',
    unit: '%',
    targets: { phase1: 20, phase2: 50, phase3: 80 },
    higherIsBetter: true,
  },
  {
    id: 'runbook_decay_rate',
    nameZh: 'Runbook 条目衰减率',
    nameEn: 'Runbook Decay Rate',
    dimension: 'learning',
    formula: 'deprecated entries / total entries',
    unit: '%',
    targets: { phase1: 20, phase2: 10, phase3: 5 },
    higherIsBetter: false,
  },

  // ── Business ──
  {
    id: 'human_escalation_rate',
    nameZh: '人工升级率',
    nameEn: 'Human Escalation Rate',
    dimension: 'business',
    formula: 'escalatedToHuman / total events',
    unit: '%',
    targets: { phase1: 40, phase2: 20, phase3: 5 },
    higherIsBetter: false,
  },
  {
    id: 'user_unawareness_rate',
    nameZh: '用户无感知率',
    nameEn: 'User Unawareness Rate',
    dimension: 'business',
    formula: '!userVisibleImpact / total events',
    unit: '%',
    targets: { phase1: 50, phase2: 75, phase3: 95 },
    higherIsBetter: true,
  },
  {
    id: 'availability_uplift',
    nameZh: '可用性提升',
    nameEn: 'Availability Uplift',
    dimension: 'business',
    formula: 'SUM(downtime_saved) / total_period * 100',
    unit: '%',
    targets: { phase1: 0.01, phase2: 0.05, phase3: 0.1 },
    higherIsBetter: true,
  },
];
