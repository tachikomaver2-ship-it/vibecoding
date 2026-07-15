import { PrismaClient, type GSBScore } from '@prisma/client';
import { runL1Grader } from './l1-code-grader';
import { runL2Grader } from './l2-model-grader';
import { computeFinalScore } from './l3-human-review';
import type { GraderResult } from './types';

export { runL1Grader } from './l1-code-grader';
export { runL2Grader, evaluateStepQuality, evaluatePathSimilarity, evaluateGSB } from './l2-model-grader';
export { createReviewTask, submitReview, computeFinalScore } from './l3-human-review';
export type { GraderResult } from './types';

/**
 * Run the full grading pipeline (L1 + L2) for a healing event.
 * Stores the results in the GraderScore table and returns the aggregated score.
 * L3 is excluded from this pipeline — it is submitted separately via human review.
 */
export async function runFullGradingPipeline(
  prisma: PrismaClient,
  eventId: string,
  options?: {
    stepAccuracyThreshold?: number;
    maxCost?: number;
    maxMttrMs?: number;
    standardPath?: string[];
  }
): Promise<{
  l1: GraderResult;
  l2: GraderResult;
  finalScore: number;
  graderScoreId: string;
}> {
  const event = await prisma.healingEvent.findUnique({
    where: { id: eventId },
    include: {
      healingSteps: { orderBy: { stepSeq: 'asc' } },
      doomLoopEvents: true,
    },
  });

  if (!event) {
    throw new Error(`HealingEvent not found: ${eventId}`);
  }

  // Run L1 deterministic checks
  const l1 = await runL1Grader(event, {
    stepAccuracyThreshold: options?.stepAccuracyThreshold,
    maxCost: options?.maxCost,
    maxMttrMs: options?.maxMttrMs,
  });

  // Run L2 model-based evaluation
  const l2 = await runL2Grader(event, options?.standardPath);

  // Compute final score (without L3 — use weighted L1+L2)
  const { finalScore } = computeFinalScore(l1, l2);

  // Determine grader level based on what was completed
  const graderLevel: 'L1' | 'L2' | 'L3' = 'L2';

  // Map GSB string to enum
  const gsbEnum: GSBScore | undefined = l2.details?.gsb as GSBScore | undefined;

  // Persist to GraderScore table
  const graderScore = await prisma.graderScore.create({
    data: {
      graderL1Pass: l1.passed,
      graderL2StepScore: l2.details?.stepScore ?? null,
      graderL2PathScore: l2.details?.pathScore ?? null,
      graderL2Gsb: gsbEnum ?? null,
      graderL2Reason: l2.reasoning ?? null,
      finalScore: finalScore,
      graderLevel: graderLevel,
      healingEventId: eventId,
    },
  });

  return {
    l1,
    l2,
    finalScore,
    graderScoreId: graderScore.id,
  };
}
