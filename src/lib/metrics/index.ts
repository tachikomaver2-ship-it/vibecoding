// ── Metrics module barrel export ─────────────────────────────────────────────

export type {
  MetricDimension,
  MetricResult,
  MetricFilters,
  DateRange,
  MetricComputationFn,
  MetricTarget,
  MetricDefinition,
  HealingTimeDistribution,
  DimensionSummary,
  DashboardMetrics,
  MetricTimeSeriesPoint,
  MetricTrend,
  LayerBreakdown,
} from './types';

export { METRIC_DIMENSIONS, DIMENSION_LABELS } from './types';

export {
  computeSelfHealingSuccessRate,
  computeVerificationPassRate,
  computeGsbScore,
  computeStepAccuracy,
  computeStepEfficiencyRatio,
  computePathSimilarity,
  computeDoomLoopDetectionRate,
  computeMttd,
  computeMttr,
  computeTokenEfficiency,
  computeCostPerHealing,
  computeHealingTimeDistribution,
  computeBlastRadius,
  computeErrorRate,
  computeApprovalGateTriggerRate,
  computeRollbackRate,
  computeRunbookHitRate,
  computeSelfHealingRateTrendWoW,
  computeKnowledgeRetentionRate,
  computeRunbookDecayRate,
  computeHumanEscalationRate,
  computeUserUnawarenessRate,
  computeAvailabilityUplift,
  METRIC_FUNCTIONS,
  METRIC_DEFINITIONS,
} from './engine';

export {
  computeAllMetrics,
  computeMetricsByLayer,
  computeLayerBreakdowns,
  computeMetricsTrend,
  computeFullDashboard,
} from './aggregator';

export type { TrendPeriod } from './aggregator';
