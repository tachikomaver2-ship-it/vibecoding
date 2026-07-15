// ── Metric Types ─────────────────────────────────────────────────────────────
// Defines TypeScript interfaces for the 23-metric SRE Agent evaluation system.
// Covers 6 dimensions: outcome, process, efficiency, security, learning, business.

import type { PrismaClient } from '@prisma/client';

// ── Dimensions ──────────────────────────────────────────────────────────────

export type MetricDimension =
  | 'outcome'
  | 'process'
  | 'efficiency'
  | 'security'
  | 'learning'
  | 'business';

export const METRIC_DIMENSIONS: MetricDimension[] = [
  'outcome',
  'process',
  'efficiency',
  'security',
  'learning',
  'business',
];

export const DIMENSION_LABELS: Record<MetricDimension, { zh: string; en: string }> = {
  outcome:    { zh: '结果指标', en: 'Outcome' },
  process:    { zh: '过程指标', en: 'Process' },
  efficiency: { zh: '效率指标', en: 'Efficiency' },
  security:   { zh: '安全指标', en: 'Security' },
  learning:   { zh: '学习指标', en: 'Learning' },
  business:   { zh: '业务指标', en: 'Business' },
};

// ── Core metric result ──────────────────────────────────────────────────────

export interface MetricResult {
  /** Metric identifier, e.g. "self_healing_success_rate" */
  name: string;
  /** Computed numeric value */
  value: number;
  /** Display unit, e.g. "%", "ms", "USD" */
  unit: string;
  /** Which of the 6 evaluation dimensions this belongs to */
  dimension: MetricDimension;
  /** Optional layer breakdown key (L1–L5) */
  layer?: string;
  /** Optional time period label (e.g. "2024-W03", "2024-01-15") */
  period?: string;
  /** Sub-breakdowns for metrics that return per-layer or per-bucket data */
  breakdown?: Record<string, number>;
}

// ── Filters ─────────────────────────────────────────────────────────────────

export interface DateRange {
  from: Date;
  to: Date;
}

export interface MetricFilters {
  dateRange?: DateRange;
  layer?: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
  tenantId?: string;
  environment?: 'prod' | 'staging' | 'eval';
}

// ── Metric function signature ───────────────────────────────────────────────

export type MetricComputationFn = (
  prisma: PrismaClient,
  filters?: MetricFilters,
) => Promise<MetricResult>;

// ── Metric definition (static metadata) ─────────────────────────────────────

export interface MetricTarget {
  phase1: number;
  phase2: number;
  phase3: number;
}

export interface MetricDefinition {
  /** Unique kebab-case identifier */
  id: string;
  /** Chinese display name */
  nameZh: string;
  /** English display name */
  nameEn: string;
  /** Which dimension this metric belongs to */
  dimension: MetricDimension;
  /** Human-readable formula description */
  formula: string;
  /** Display unit */
  unit: string;
  /** Phase targets: phase1 = initial, phase2 = growth, phase3 = mature */
  targets: MetricTarget;
  /** Whether higher is better (true) or lower is better (false) */
  higherIsBetter: boolean;
}

// ── Healing time distribution breakdown ─────────────────────────────────────

export interface HealingTimeDistribution {
  avgDetectionMs: number;
  avgDiagnosisMs: number;
  avgHealingMs: number;
  avgVerificationMs: number;
  avgTotalMs: number;
}

// ── Dashboard view ──────────────────────────────────────────────────────────

export interface DimensionSummary {
  dimension: MetricDimension;
  label: { zh: string; en: string };
  metrics: MetricResult[];
}

export interface DashboardMetrics {
  /** When the dashboard was computed */
  computedAt: Date;
  /** Filters that were applied */
  filters: MetricFilters;
  /** Flat list of all 23 metric results */
  metrics: MetricResult[];
  /** Metrics grouped by dimension */
  dimensions: DimensionSummary[];
  /** Per-layer breakdown (L1–L5) */
  byLayer?: Record<string, MetricResult[]>;
}

// ── Time-series data point ──────────────────────────────────────────────────

export interface MetricTimeSeriesPoint {
  period: string;
  timestamp: Date;
  value: number;
}

export interface MetricTrend {
  metricId: string;
  points: MetricTimeSeriesPoint[];
}

// ── Per-layer breakdown ─────────────────────────────────────────────────────

export interface LayerBreakdown {
  layer: string;
  metrics: MetricResult[];
}
