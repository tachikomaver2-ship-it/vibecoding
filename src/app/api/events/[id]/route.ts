import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const event = await prisma.healingEvent.findFirst({
      where: {
        OR: [{ id }, { healingEventId: id }],
      },
      include: {
        healingActions: { orderBy: { createdAt: 'asc' } },
        healingSteps: { orderBy: { stepSeq: 'asc' } },
        llmCallLogs: { orderBy: { createdAt: 'asc' } },
        validationLogs: { orderBy: { createdAt: 'asc' } },
        circuitBreakerLogs: { orderBy: { createdAt: 'asc' } },
        stateSnapshots: { orderBy: { createdAt: 'asc' } },
        doomLoopEvents: { orderBy: { createdAt: 'asc' } },
        freshContextLogs: { orderBy: { createdAt: 'asc' } },
        runbookUsageLogs: { orderBy: { usedAt: 'asc' } },
        reviewScores: { orderBy: { createdAt: 'desc' } },
        graderScores: { orderBy: { createdAt: 'desc' } },
        tenant: { select: { tenantId: true, orgName: true } },
        agentConfig: { select: { agentId: true, agentVersion: true, agentModel: true } },
        taskInstance: { select: { taskId: true, taskInstanceId: true, taskType: true } },
        benchmarkCase: { select: { benchmarkCaseId: true, bmDifficulty: true, bmTags: true } },
      },
    });

    if (!event) {
      return NextResponse.json(
        { error: 'Healing event not found' },
        { status: 404 }
      );
    }

    // Serialize BigInt fields to strings for JSON response
    const serialized = JSON.parse(
      JSON.stringify(event, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    );

    return NextResponse.json(serialized);
  } catch (error) {
    console.error('GET /api/events/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch healing event' },
      { status: 500 }
    );
  }
}
