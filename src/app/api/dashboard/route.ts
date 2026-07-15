import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  computeSelfHealingSuccessRate,
  computeMttd,
  computeMttr,
} from '@/lib/metrics/engine';
import { computeMetricsTrend } from '@/lib/metrics/aggregator';
import type { MetricFilters, MetricTrend } from '@/lib/metrics/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const filters: MetricFilters = {};
    if (startDate && endDate) {
      filters.dateRange = {
        from: new Date(startDate),
        to: new Date(endDate),
      };
    }

    // Core KPIs
    const [
      successRate,
      eventCount,
      mttd,
      mttr,
      pendingManual,
    ] = await Promise.all([
      computeSelfHealingSuccessRate(prisma, filters),
      prisma.healingEvent.count(),
      computeMttd(prisma, filters),
      computeMttr(prisma, filters),
      prisma.healingEvent.count({
        where: { escalatedToHuman: true, outcome: { not: 'SUCCESS' } },
      }),
    ]);

    // Per-layer success rates from the breakdown in success rate metric
    const layerSuccessRates = successRate.breakdown ?? {};

    // Time series trends
    const allTrends = await computeMetricsTrend(prisma, 'daily', filters);
    const findTrendPoints = (metricId: string) =>
      allTrends.find((t) => t.metricId === metricId)?.points ?? [];

    const successTrend = findTrendPoints('self_healing_success_rate');
    const tokenTrend = findTrendPoints('token_efficiency');
    const runbookTrend = findTrendPoints('runbook_hit_rate');

    // Alerts: recent doom-loop triggers
    const recentDoomLoops = await prisma.doomLoopEvent.findMany({
      where: { doomLoopTriggered: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        healingEvent: {
          select: {
            healingEventId: true,
            errorLayer: true,
            errorType: true,
            errorOccurredAt: true,
          },
        },
      },
    });

    // Alerts: high-latency tools (LLM calls > 10s)
    const highLatencyCalls = await prisma.llmCallLog.findMany({
      where: { latencyMs: { gt: 10000 } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        healingEvent: {
          select: {
            healingEventId: true,
            errorLayer: true,
            errorType: true,
          },
        },
      },
    });

    return NextResponse.json({
      kpis: {
        successRate: successRate.value,
        eventCount,
        mttdAvgMs: mttd.value,
        mttdByLayer: mttd.breakdown,
        mttrAvgMs: mttr.value,
        mttrByLayer: mttr.breakdown,
        pendingManual,
      },
      layerSuccessRates,
      trends: {
        successRate: successTrend,
        tokenConsumption: tokenTrend,
        runbookHitRate: runbookTrend,
      },
      alerts: {
        doomLoopTriggers: recentDoomLoops.map((d) => ({
          id: d.id,
          reason: d.doomLoopReason,
          count: d.doomLoopCount,
          rescueTriggered: d.rescueAgentTriggered,
          rescueSuccess: d.rescueAgentSuccess,
          healingEventId: d.healingEvent.healingEventId,
          errorLayer: d.healingEvent.errorLayer,
          errorType: d.healingEvent.errorType,
          occurredAt: d.healingEvent.errorOccurredAt,
        })),
        highLatencyTools: highLatencyCalls.map((c) => ({
          id: c.id,
          modelName: c.modelName,
          latencyMs: c.latencyMs,
          totalTokens: c.totalTokens,
          healingEventId: c.healingEvent.healingEventId,
          errorLayer: c.healingEvent.errorLayer,
        })),
      },
    });
  } catch (error) {
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 },
    );
  }
}
