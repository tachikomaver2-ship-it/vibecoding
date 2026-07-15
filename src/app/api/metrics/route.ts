import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  computeSelfHealingSuccessRate,
  computeMttd,
  computeMttr,
  computeTokenEfficiency,
  computeCostPerHealing,
  computeRunbookHitRate,
} from '@/lib/metrics/engine';
import {
  computeMetricsByLayer,
  computeMetricsTrend,
  computeAllMetrics,
} from '@/lib/metrics/aggregator';
import type { MetricFilters, MetricTrend } from '@/lib/metrics/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dimension = searchParams.get('dimension');
    const layer = searchParams.get('layer');
    const period = searchParams.get('period');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const tenantId = searchParams.get('tenantId');

    const filters: MetricFilters = {};
    if (layer && ['L1', 'L2', 'L3', 'L4', 'L5'].includes(layer)) {
      filters.layer = layer as 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
    }
    if (startDate && endDate) {
      filters.dateRange = {
        from: new Date(startDate),
        to: new Date(endDate),
      };
    }
    if (tenantId) {
      filters.tenantId = tenantId;
    }

    if (dimension) {
      switch (dimension) {
        case 'successRate':
          return NextResponse.json(
            await computeSelfHealingSuccessRate(prisma, filters),
          );
        case 'mttd':
          return NextResponse.json(await computeMttd(prisma, filters));
        case 'mttr':
          return NextResponse.json(await computeMttr(prisma, filters));
        case 'tokens':
          return NextResponse.json(
            await computeTokenEfficiency(prisma, filters),
          );
        case 'cost':
          return NextResponse.json(
            await computeCostPerHealing(prisma, filters),
          );
        case 'runbookHitRate':
          return NextResponse.json(
            await computeRunbookHitRate(prisma, filters),
          );
        case 'layerSuccessRate':
          return NextResponse.json(
            await computeMetricsByLayer(prisma, filters),
          );
        case 'successTrend':
        case 'tokenTrend':
        case 'runbookTrend': {
          const trendId =
            dimension === 'successTrend'
              ? 'self_healing_success_rate'
              : dimension === 'tokenTrend'
                ? 'token_efficiency'
                : 'runbook_hit_rate';
          const trends = await computeMetricsTrend(prisma, 'daily', filters);
          const target = trends.find((t: MetricTrend) => t.metricId === trendId);
          return NextResponse.json(target?.points ?? []);
        }
        default:
          return NextResponse.json(
            { error: `Unknown dimension: ${dimension}` },
            { status: 400 },
          );
      }
    }

    // No dimension specified — return full dashboard with all 23 metrics
    const dashboard = await computeAllMetrics(prisma, filters);

    return NextResponse.json(dashboard);
  } catch (error) {
    console.error('GET /api/metrics error:', error);
    return NextResponse.json(
      { error: 'Failed to compute metrics' },
      { status: 500 },
    );
  }
}
