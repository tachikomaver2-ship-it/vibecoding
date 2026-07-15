import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const layer = searchParams.get('layer');
    const outcome = searchParams.get('outcome');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

    const where: Prisma.HealingEventWhereInput = {};

    if (layer) {
      where.errorLayer = layer as Prisma.EnumErrorLayerFilter;
    }

    if (outcome) {
      where.outcome = outcome as Prisma.EnumHealingOutcomeFilter;
    }

    if (startDate || endDate) {
      const dateFilter: { gte?: Date; lte?: Date } = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      where.errorOccurredAt = dateFilter;
    }

    const [events, total] = await Promise.all([
      prisma.healingEvent.findMany({
        where,
        orderBy: { errorOccurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          healingEventId: true,
          errorLayer: true,
          errorType: true,
          errorCode: true,
          errorSeverity: true,
          outcome: true,
          mttrMs: true,
          mttdMs: true,
          totalCostUsd: true,
          totalTokens: true,
          stepAccuracy: true,
          errorOccurredAt: true,
          runbookHit: true,
          degraded: true,
          createdAt: true,
        },
      }),
      prisma.healingEvent.count({ where }),
    ]);

    return NextResponse.json({
      events,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('GET /api/events error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch healing events' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const required = ['errorLayer', 'errorType', 'errorOccurredAt', 'tenantId', 'agentConfigId', 'taskInstanceId'];
    for (const field of required) {
      if (body[field] == null) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    const healingEventId = body.healingEventId ?? `HE-${uuidv4().slice(0, 8)}`;

    const event = await prisma.healingEvent.create({
      data: {
        healingEventId,
        errorLayer: body.errorLayer,
        errorType: body.errorType,
        errorCode: body.errorCode ?? null,
        errorMessage: body.errorMessage ?? null,
        errorOccurredAt: new Date(body.errorOccurredAt),
        errorSeverity: body.errorSeverity ?? 'P2',
        isCompositeError: body.isCompositeError ?? false,
        rootCauseLayer: body.rootCauseLayer ?? null,
        causalChain: body.causalChain ?? undefined,

        detectedAt: body.detectedAt ? new Date(body.detectedAt) : null,
        mttdMs: body.mttdMs != null ? BigInt(body.mttdMs) : null,
        detectionSource: body.detectionSource ?? 'k8s_event',
        diagnosisStrategy: body.diagnosisStrategy ?? null,
        runbookHit: body.runbookHit ?? false,
        runbookId: body.runbookId ?? null,
        runbookScore: body.runbookScore != null ? body.runbookScore : null,
        alertGroupId: body.alertGroupId ?? null,
        rootCauseConfidence: body.rootCauseConfidence != null ? body.rootCauseConfidence : null,

        healingStrategy: body.healingStrategy ?? null,
        totalSteps: body.totalSteps ?? 0,
        correctSteps: body.correctSteps ?? 0,
        stepAccuracy: body.stepAccuracy != null ? body.stepAccuracy : null,
        optimalSteps: body.optimalSteps ?? 0,
        stepEfficiencyRatio: body.stepEfficiencyRatio != null ? body.stepEfficiencyRatio : null,
        pathSimilarity: body.pathSimilarity != null ? body.pathSimilarity : null,
        degraded: body.degraded ?? false,
        degradationType: body.degradationType ?? null,
        rollbackTriggered: body.rollbackTriggered ?? false,
        sagaCompensationLog: body.sagaCompensationLog ?? undefined,

        outcome: body.outcome ?? 'FAILED',
        verified: body.verified ?? false,
        verificationType: body.verificationType ?? null,
        schemaPassed: body.schemaPassed ?? false,
        healthPassed: body.healthPassed ?? false,
        businessPassed: body.businessPassed ?? false,
        newAlertsAfter: body.newAlertsAfter ?? 0,
        affectedScope: body.affectedScope ?? 0,
        affectedUsers: body.affectedUsers ?? 0,

        totalTokens: body.totalTokens ?? 0,
        diagnosisTokens: body.diagnosisTokens ?? 0,
        healingTokens: body.healingTokens ?? 0,
        verificationTokens: body.verificationTokens ?? 0,
        llmCallCount: body.llmCallCount ?? 0,
        mcpToolCallCount: body.mcpToolCallCount ?? 0,
        llmApiCostUsd: body.llmApiCostUsd != null ? body.llmApiCostUsd : null,
        computeCostUsd: body.computeCostUsd != null ? body.computeCostUsd : null,
        totalCostUsd: body.totalCostUsd != null ? body.totalCostUsd : null,
        tokenEfficiency: body.tokenEfficiency != null ? body.tokenEfficiency : null,

        diagnosisCompletedAt: body.diagnosisCompletedAt ? new Date(body.diagnosisCompletedAt) : null,
        healingStartedAt: body.healingStartedAt ? new Date(body.healingStartedAt) : null,
        healingCompletedAt: body.healingCompletedAt ? new Date(body.healingCompletedAt) : null,
        verificationCompletedAt: body.verificationCompletedAt ? new Date(body.verificationCompletedAt) : null,
        recoveredAt: body.recoveredAt ? new Date(body.recoveredAt) : null,
        mttrMs: body.mttrMs != null ? BigInt(body.mttrMs) : null,
        diagnosisDurationMs: body.diagnosisDurationMs != null ? BigInt(body.diagnosisDurationMs) : null,
        healingDurationMs: body.healingDurationMs != null ? BigInt(body.healingDurationMs) : null,
        verificationDurationMs: body.verificationDurationMs != null ? BigInt(body.verificationDurationMs) : null,
        totalDurationMs: body.totalDurationMs != null ? BigInt(body.totalDurationMs) : null,

        environment: body.environment ?? 'prod',
        k8sNamespace: body.k8sNamespace ?? null,
        k8sNode: body.k8sNode ?? null,
        podName: body.podName ?? null,
        podCpuRequest: body.podCpuRequest ?? null,
        podMemoryRequest: body.podMemoryRequest ?? null,
        jvmHeapUsedMb: body.jvmHeapUsedMb ?? null,
        jvmThreadCount: body.jvmThreadCount ?? null,
        hikariActive: body.hikariActive ?? null,
        hikariTotal: body.hikariTotal ?? null,

        approvalRequired: body.approvalRequired ?? false,
        approvalStatus: body.approvalStatus ?? 'auto_approved',
        approvalRespondedAt: body.approvalRespondedAt ? new Date(body.approvalRespondedAt) : null,
        auditLogId: body.auditLogId ?? null,
        snapshotBefore: body.snapshotBefore ?? null,
        snapshotRestored: body.snapshotRestored ?? false,

        runbookStatus: body.runbookStatus ?? null,
        runbookSuccessRate: body.runbookSuccessRate != null ? body.runbookSuccessRate : null,
        runbookTotalUses: body.runbookTotalUses ?? 0,
        runbookUsedAt: body.runbookUsedAt ? new Date(body.runbookUsedAt) : null,

        experienceRecorded: body.experienceRecorded ?? false,
        expelInsightGenerated: body.expelInsightGenerated ?? false,
        runbookCreatedFrom: body.runbookCreatedFrom ?? null,
        runbookUpdatedFrom: body.runbookUpdatedFrom ?? null,
        reflexionReviewed: body.reflexionReviewed ?? false,

        userVisibleImpact: body.userVisibleImpact ?? false,
        impactDurationMs: body.impactDurationMs != null ? BigInt(body.impactDurationMs) : null,
        escalatedToHuman: body.escalatedToHuman ?? false,
        escalationReason: body.escalationReason ?? null,
        slaBreach: body.slaBreach ?? false,

        tenantId: body.tenantId,
        agentConfigId: body.agentConfigId,
        taskInstanceId: body.taskInstanceId,
        benchmarkCaseId: body.benchmarkCaseId ?? null,
      },
    });

    return NextResponse.json(event, { status: 201 });
  } catch (error) {
    console.error('POST /api/events error:', error);
    return NextResponse.json(
      { error: 'Failed to create healing event' },
      { status: 500 }
    );
  }
}
