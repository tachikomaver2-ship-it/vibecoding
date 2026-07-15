import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runFullGradingPipeline } from '@/lib/grader';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.eventId) {
      return NextResponse.json(
        { error: 'Missing required field: eventId' },
        { status: 400 }
      );
    }

    // Resolve event — accept either internal id or healingEventId
    const event = await prisma.healingEvent.findFirst({
      where: {
        OR: [{ id: body.eventId }, { healingEventId: body.eventId }],
      },
      select: { id: true },
    });

    if (!event) {
      return NextResponse.json(
        { error: 'Healing event not found' },
        { status: 404 }
      );
    }

    const result = await runFullGradingPipeline(prisma, event.id, {
      stepAccuracyThreshold: body.stepAccuracyThreshold ?? 0.6,
      maxCost: body.maxCost ?? 1.0,
      maxMttrMs: body.maxMttrMs ?? 300000,
      standardPath: body.standardPath ?? undefined,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('POST /api/grader error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to run grading pipeline';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
