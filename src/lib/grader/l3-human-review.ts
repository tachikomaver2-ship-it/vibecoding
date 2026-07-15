import { PrismaClient, type GSBScore } from '@prisma/client';
import type { GraderResult } from './types';

type L3ReviewInput = {
  gsbScore: GSBScore;
  reasoning?: string;
  overrideFinalScore?: number;
};

type WeightedScores = {
  l1Score: number;
  l2Score: number;
  l3Score: number;
  l3Override: boolean;
  finalScore: number;
};

/**
 * Create a pending L3 human review task for a healing event.
 * Records the assignment in the ReviewScore table with a default 'SAME' score
 * that the reviewer will later update.
 */
export async function createReviewTask(
  prisma: PrismaClient,
  eventId: string,
  reviewerId: string
): Promise<{ taskId: string; eventId: string; reviewerId: string; status: string }> {
  const event = await prisma.healingEvent.findUnique({
    where: { id: eventId },
    select: { id: true, healingEventId: true },
  });

  if (!event) {
    throw new Error(`HealingEvent not found: ${eventId}`);
  }

  const review = await prisma.reviewScore.create({
    data: {
      gsbScore: 'SAME',
      reasoning: `Review assigned to ${reviewerId} — pending submission`,
      healingEventId: eventId,
    },
  });

  return {
    taskId: review.id,
    eventId: event.healingEventId,
    reviewerId,
    status: 'pending',
  };
}

/**
 * Submit an L3 human review for a healing event.
 * Updates (or creates) the ReviewScore record and returns the L3 GraderResult.
 * If overrideFinalScore is provided, it takes precedence over weighted computation.
 */
export async function submitReview(
  prisma: PrismaClient,
  eventId: string,
  review: L3ReviewInput
): Promise<GraderResult> {
  const event = await prisma.healingEvent.findUnique({
    where: { id: eventId },
    select: { id: true, healingEventId: true },
  });

  if (!event) {
    throw new Error(`HealingEvent not found: ${eventId}`);
  }

  const gsbNumeric =
    review.gsbScore === 'GOOD'
      ? 1.0
      : review.gsbScore === 'SAME'
        ? 0.5
        : 0.0;

  // Upsert the review score — take the most recent review for this event
  const existing = await prisma.reviewScore.findFirst({
    where: { healingEventId: eventId },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    await prisma.reviewScore.update({
      where: { id: existing.id },
      data: {
        gsbScore: review.gsbScore,
        reasoning: review.reasoning ?? null,
      },
    });
  } else {
    await prisma.reviewScore.create({
      data: {
        gsbScore: review.gsbScore,
        reasoning: review.reasoning ?? null,
        healingEventId: eventId,
      },
    });
  }

  const hasOverride =
    review.overrideFinalScore != null &&
    review.overrideFinalScore >= 0 &&
    review.overrideFinalScore <= 1;

  return {
    level: 'L3',
    passed: gsbNumeric > 0,
    score: gsbNumeric,
    details: {
      gsbScore: review.gsbScore,
      override: hasOverride,
      overrideScore: review.overrideFinalScore ?? null,
    },
    reasoning: review.reasoning ?? `Human review: ${review.gsbScore}`,
  };
}

/**
 * Compute the final weighted score from L1, L2, and L3 results.
 * Weights: L1 = 0.3, L2 = 0.4, L3 = 0.3
 * If L3 provides an override score, it replaces the weighted result entirely.
 */
export function computeFinalScore(
  l1: GraderResult,
  l2: GraderResult,
  l3?: GraderResult
): WeightedScores {
  const W_L1 = 0.3;
  const W_L2 = 0.4;
  const W_L3 = 0.3;

  const l3Score = l3?.score ?? 0.5; // default to neutral if no L3 review
  const l3Override =
    l3?.details?.override === true &&
    l3?.details?.overrideScore != null;

  let finalScore: number;

  if (l3Override) {
    finalScore = l3!.details.overrideScore;
  } else if (l3) {
    finalScore = l1.score * W_L1 + l2.score * W_L2 + l3Score * W_L3;
  } else {
    // No L3: redistribute weights proportionally
    finalScore = l1.score * (W_L1 / (W_L1 + W_L2)) + l2.score * (W_L2 / (W_L1 + W_L2));
  }

  return {
    l1Score: l1.score,
    l2Score: l2.score,
    l3Score: l3Score,
    l3Override,
    finalScore: Math.round(finalScore * 10000) / 10000,
  };
}
