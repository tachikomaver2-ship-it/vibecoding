import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

    const [groups, total] = await Promise.all([
      prisma.trialGroup.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          taskInstance: {
            select: { taskId: true, taskInstanceId: true, taskType: true },
          },
          _count: { select: { items: true } },
        },
      }),
      prisma.trialGroup.count(),
    ]);

    const serialized = groups.map((g) => ({
      ...g,
      passAtK: g.passAtK != null ? Number(g.passAtK) : null,
      passPowK: g.passPowK != null ? Number(g.passPowK) : null,
      gap: g.gap != null ? Number(g.gap) : null,
      itemCount: g._count.items,
    }));

    return NextResponse.json({
      trialGroups: serialized,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('GET /api/trials error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trial groups' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.taskInstanceId) {
      return NextResponse.json(
        { error: 'Missing required field: taskInstanceId' },
        { status: 400 }
      );
    }

    const taskInstance = await prisma.taskInstance.findFirst({
      where: {
        OR: [
          { id: body.taskInstanceId },
          { taskInstanceId: body.taskInstanceId },
        ],
      },
    });

    if (!taskInstance) {
      return NextResponse.json(
        { error: 'TaskInstance not found' },
        { status: 404 }
      );
    }

    const trialGroupId = body.trialGroupId ?? `TG-${uuidv4().slice(0, 8)}`;

    const group = await prisma.trialGroup.create({
      data: {
        trialGroupId,
        trialGroupN: body.trialGroupN ?? 0,
        trialGroupC: body.trialGroupC ?? 0,
        passAtK: body.passAtK != null ? body.passAtK : null,
        passPowK: body.passPowK != null ? body.passPowK : null,
        gap: body.gap != null ? body.gap : null,
        taskInstanceId: taskInstance.id,
      },
    });

    // If healing event IDs are provided, create trial group items
    if (Array.isArray(body.healingEventIds) && body.healingEventIds.length > 0) {
      const events = await prisma.healingEvent.findMany({
        where: {
          OR: [
            { id: { in: body.healingEventIds } },
            { healingEventId: { in: body.healingEventIds } },
          ],
        },
        select: { id: true, healingEventId: true },
      });

      const items = events.map((event, index) => ({
        trialSequence: index + 1,
        trialK: body.trialK ?? 3,
        trialGroupId: group.id,
        healingEventId: event.id,
      }));

      if (items.length > 0) {
        await prisma.trialGroupItem.createMany({ data: items });
      }
    }

    const created = await prisma.trialGroup.findUnique({
      where: { id: group.id },
      include: {
        items: {
          include: {
            healingEvent: {
              select: {
                healingEventId: true,
                outcome: true,
                errorLayer: true,
              },
            },
          },
          orderBy: { trialSequence: 'asc' },
        },
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('POST /api/trials error:', error);
    return NextResponse.json(
      { error: 'Failed to create trial group' },
      { status: 500 }
    );
  }
}
