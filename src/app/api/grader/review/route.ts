import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { submitReview, computeFinalScore } from '@/lib/grader';
import type { GSBScore } from '@prisma/client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.eventId) {
      return NextResponse.json(
        { error: 'Missing required field: eventId' },
        { status: 400 }
      );
    }

    if (!body.gsbScore) {
      return NextResponse.json(
        { error: 'Missing required field: gsbScore' },
        { status: 400 }
      );
    }

    const validGsb: GSBScore[] = ['GOOD', 'SAME', 'BAD'];
    if (!validGsb.includes(body.gsbScore)) {
      return NextResponse.json(
        { error: `Invalid gsbScore. Must be one of: ${validGsb.join(', ')}` },
        { status: 400 }
      );
    }

    // Resolve event
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

    // Submit the L3 review
    const l3Result = await submitReview(prisma, event.id, {
      gsbScore: body.gsbScore,
      reasoning: body.reasoning,
      overrideFinalScore: body.overrideFinalScore ?? undefined,
    });

    // Fetch existing grader scores to recompute final
    const existingGrader = await prisma.graderScore.findFirst({
      where: { healingEventId: event.id },
      orderBy: { createdAt: 'desc' },
    });

    let recomputedFinalScore: number | null = null;

    if (existingGrader) {
      const l1Result = {
        level: 'L1' as const,
        passed: existingGrader.graderL1Pass ?? false,
        score: existingGrader.graderL1Pass ? 1 : 0,
        details: {},
      };

      const l2Result = {
        level: 'L2' as const,
        passed: true,
        score:
          ((Number(existingGrader.graderL2StepScore) ?? 0) * 0.4 +
            (Number(existingGrader.graderL2PathScore) ?? 0) * 0.4 +
            (existingGrader.graderL2Gsb === 'GOOD'
              ? 1.0
              : existingGrader.graderL2Gsb === 'SAME'
                ? 0.5
                : 0.0) *
              0.2),
        details: {
          stepScore: Number(existingGrader.graderL2StepScore) ?? 0,
          pathScore: Number(existingGrader.graderL2PathScore) ?? 0,
          gsb: existingGrader.graderL2Gsb,
        },
      };

      const finalResult = computeFinalScore(l1Result, l2Result, l3Result);
      recomputedFinalScore = finalResult.finalScore;

      // Update the grader score with L3 data
      await prisma.graderScore.update({
        where: { id: existingGrader.id },
        data: {
          graderL3Reviewed: true,
          graderL3Override: l3Result.details?.override ?? false,
          graderL3Reason: l3Result.reasoning ?? null,
          finalScore: recomputedFinalScore,
          graderLevel: 'L3',
        },
      });
    }

    return NextResponse.json({
      l3: l3Result,
      recomputedFinalScore,
      graderScoreId: existingGrader?.id ?? null,
    });
  } catch (error) {
    console.error('POST /api/grader/review error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to submit review';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
