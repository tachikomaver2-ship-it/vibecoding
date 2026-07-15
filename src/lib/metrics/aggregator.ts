// ── Metrics Aggregator ───────────────────────────────────────────────────────
// Orchestrates computation of all 23 metrics and provides dashboard-level views:
// - computeAllMetrics: flat + grouped by dimension
// - computeMetricsByLayer: per-layer (L1-L5) breakdown
// - computeMetricsTrend: time-series across configurable periods

import { PrismaClient } from '@prisma/client';
import type {
  MetricResult,
  MetricFilters,
  DashboardMetrics,
  DimensionSummary,
  LayerBreakdown,
  MetricTrend,
  MetricTimeSeriesPoint,
  MetricDimension,
  DateRange,
} from './types';
import { METRIC_DIMENSIONS, DIMENSION_LABELS } from './types';
import { METRIC_FUNCTIONS } from './engine';

// ── computeAllMetrics ───────────────────────────────────────────────────────

/**
 * Run all 23 metric computations in parallel and return a structured
 * DashboardMetrics object with both a flat list and dimension-grouped view.
 */
export async function computeAllMetrics(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<DashboardMetrics> {
  const results = await Promise.all(
    METRIC_FUNCTIONS.map(async ({ fn }) => {
      try {
        return await fn(prisma, filters);
      } catch (error) {
        // Return a zero-valued result on computation failure so the dashboard
        // remains fully populated even if individual queries fail.
        const name = getMetricIdFromError(error);
        return {
          name,
          value: 0,
          unit: '',
          dimension: 'outcome' as MetricDimension,
        } satisfies MetricResult;
      }
    }),
  );

  const dimensions: DimensionSummary[] = METRIC_DIMENSIONS.map((dim) => ({
    dimension: dim,
    label: DIMENSION_LABELS[dim],
    metrics: results.filter((r) => r.dimension === dim),
  }));

  return {
    computedAt: new Date(),
    filters: filters ?? {},
    metrics: results,
    dimensions,
  };
}

// ── computeMetricsByLayer ───────────────────────────────────────────────────

const LAYERS = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;

/**
 * Compute all 23 metrics once per error layer (L1-L5), returning a
 * record mapping each layer to its metric results.
 */
export async function computeMetricsByLayer(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<Record<string, MetricResult[]>> {
  const layerResults: Record<string, MetricResult[]> = {};

  for (const layer of LAYERS) {
    const layerFilters: MetricFilters = {
      ...filters,
      layer,
    };

    const metrics = await Promise.all(
      METRIC_FUNCTIONS.map(async ({ fn }) => {
        try {
          const result = await fn(prisma, layerFilters);
          return { ...result, layer };
        } catch {
          return {
            name: 'unknown',
            value: 0,
            unit: '',
            dimension: 'outcome' as MetricDimension,
            layer,
          } satisfies MetricResult;
        }
      }),
    );

    layerResults[layer] = metrics;
  }

  return layerResults;
}

/**
 * Convenience wrapper that returns LayerBreakdown[] instead of a raw record.
 */
export async function computeLayerBreakdowns(
  prisma: PrismaClient,
  filters?: MetricFilters,
): Promise<LayerBreakdown[]> {
  const byLayer = await computeMetricsByLayer(prisma, filters);
  return LAYERS.map((layer) => ({
    layer,
    metrics: byLayer[layer] ?? [],
  }));
}

// ── computeMetricsTrend ─────────────────────────────────────────────────────

export type TrendPeriod = 'daily' | 'weekly' | 'monthly';

/**
 * Split a date range into time buckets and compute all metrics for each bucket,
 * producing a time-series suitable for trend charts.
 */
export async function computeMetricsTrend(
  prisma: PrismaClient,
  period: TrendPeriod,
  filters?: MetricFilters,
): Promise<MetricTrend[]> {
  const dateRange = filters?.dateRange ?? defaultDateRange();
  const buckets = splitIntoBuckets(dateRange, period);

  if (buckets.length === 0) return [];

  // For each bucket, compute all metrics in parallel
  const bucketResults = await Promise.all(
    buckets.map(async (bucket) => {
      const bucketFilters: MetricFilters = {
        ...filters,
        dateRange: bucket.range,
      };
      const metrics = await Promise.all(
        METRIC_FUNCTIONS.map(async ({ id, fn }) => {
          try {
            const result = await fn(prisma, bucketFilters);
            return { id, value: result.value };
          } catch {
            return { id, value: 0 };
          }
        }),
      );
      return { bucket, metrics };
    }),
  );

  // Pivot: group by metric id, then list points chronologically
  const trendMap = new Map<string, MetricTimeSeriesPoint[]>();

  for (const { bucket, metrics } of bucketResults) {
    for (const { id, value } of metrics) {
      if (!trendMap.has(id)) trendMap.set(id, []);
      trendMap.get(id)!.push({
        period: bucket.label,
        timestamp: bucket.range.from,
        value,
      });
    }
  }

  return Array.from(trendMap.entries()).map(([metricId, points]) => ({
    metricId,
    points,
  }));
}

// ── computeDashboardWithTrend ───────────────────────────────────────────────

/**
 * Full dashboard computation: all metrics + per-layer breakdown + trend data.
 * This is the top-level entry point used by API routes.
 */
export async function computeFullDashboard(
  prisma: PrismaClient,
  filters?: MetricFilters,
  trendPeriod: TrendPeriod = 'daily',
): Promise<DashboardMetrics & { byLayer: Record<string, MetricResult[]>; trends: MetricTrend[] }> {
  const [dashboard, byLayer, trends] = await Promise.all([
    computeAllMetrics(prisma, filters),
    computeMetricsByLayer(prisma, filters),
    computeMetricsTrend(prisma, trendPeriod, filters),
  ]);

  return {
    ...dashboard,
    byLayer,
    trends,
  };
}

// ── Internal helpers ────────────────────────────────────────────────────────

interface Bucket {
  label: string;
  range: DateRange;
}

function splitIntoBuckets(range: DateRange, period: TrendPeriod): Bucket[] {
  const buckets: Bucket[] = [];
  const cursor = new Date(range.from);

  while (cursor < range.to) {
    let next: Date;
    let label: string;

    switch (period) {
      case 'daily': {
        next = new Date(cursor);
        next.setDate(next.getDate() + 1);
        label = cursor.toISOString().slice(0, 10);
        break;
      }
      case 'weekly': {
        next = new Date(cursor);
        next.setDate(next.getDate() + 7);
        const weekNum = getWeekNumber(cursor);
        label = `${cursor.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        break;
      }
      case 'monthly': {
        next = new Date(cursor);
        next.setMonth(next.getMonth() + 1);
        label = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
        break;
      }
    }

    if (next > range.to) {
      next = new Date(range.to);
    }

    buckets.push({
      label,
      range: { from: new Date(cursor), to: next },
    });

    cursor.setTime(next.getTime());
  }

  return buckets;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function defaultDateRange(): DateRange {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from, to };
}

/** Best-effort extraction of metric name from an error for fallback results. */
function getMetricIdFromError(_error: unknown): string {
  return 'unknown_metric';
}
