import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const group = await prisma.trialGroup.findFirst({
      where: {
        OR: [{ id }, { trialGroupId: id }],
      },
      include: {
        taskInstance: {
          select: {
            taskId: true,
            taskInstanceId: true,
            taskType: true,
            taskDescription: true,
          },
        },
        items: {
          orderBy: { trialSequence: 'asc' },
          include: {
            healingEvent: {
              select: {
                id: true,
                healingEventId: true,
                errorLayer: true,
                errorType: true,
                outcome: true,
                mttrMs: true,
                stepAccuracy: true,
                totalTokens: true,
                totalCostUsd: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      return NextResponse.json(
        { error: 'Trial group not found' },
        { status: 404 }
      );
    }

    // Serialize BigInt fields
    const serialized = JSON.parse(
      JSON.stringify(group, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )
    );

    return NextResponse.json(serialized);
  } catch (error) {
    console.error('GET /api/trials/[id] error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trial group' },
      { status: 500 }
    );
  }
}
