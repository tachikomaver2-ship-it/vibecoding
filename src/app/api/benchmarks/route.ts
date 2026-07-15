import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { v4 as uuidv4 } from 'uuid';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const difficulty = searchParams.get('difficulty');
    const source = searchParams.get('source');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

    const where: Record<string, unknown> = {};
    if (difficulty) where.bmDifficulty = difficulty;
    if (source) where.bmSource = source;

    const [cases, total] = await Promise.all([
      prisma.benchmarkCase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          taskInstance: {
            select: { taskId: true, taskInstanceId: true, taskType: true },
          },
          _count: { select: { healingEvents: true } },
        },
      }),
      prisma.benchmarkCase.count({ where }),
    ]);

    return NextResponse.json({
      benchmarks: cases,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('GET /api/benchmarks error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch benchmark cases' },
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

    const benchmarkCaseId =
      body.benchmarkCaseId ?? `BM-${uuidv4().slice(0, 8)}`;

    const benchmark = await prisma.benchmarkCase.create({
      data: {
        benchmarkCaseId,
        bmDifficulty: body.bmDifficulty ?? 'medium',
        bmTags: body.bmTags ?? undefined,
        bmSource: body.bmSource ?? 'manual',
        taskInstanceId: taskInstance.id,
      },
    });

    return NextResponse.json(benchmark, { status: 201 });
  } catch (error) {
    console.error('POST /api/benchmarks error:', error);
    return NextResponse.json(
      { error: 'Failed to create benchmark case' },
      { status: 500 }
    );
  }
}
