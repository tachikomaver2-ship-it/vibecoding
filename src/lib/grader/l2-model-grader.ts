import type { HealingEvent, HealingStep, GSBScore } from '@prisma/client';
import type { GraderResult } from './types';

/**
 * Compute the Longest Common Subsequence length between two string arrays.
 * Classic DP approach — O(m*n) time, O(m*n) space.
 */
function lcsLength(a: string[], b: string[]): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Compute path similarity using LCS.
 * similarity = LCS(actual, standard).length / standard.length
 * Returns 0 if standard path is empty.
 */
function computePathSimilarity(
  actualPath: string[],
  standardPath: string[]
): number {
  if (standardPath.length === 0) return 0;
  return lcsLength(actualPath, standardPath) / standardPath.length;
}

/**
 * Evaluate step quality by comparing actual healing steps against the standard path.
 * Uses LCS-based similarity: how many steps in the actual execution align with the
 * expected standard path.
 */
export function evaluateStepQuality(
  steps: Array<{ stepType?: string | null; action?: string | null; isCorrect: boolean }>,
  standardPath: string[]
): { score: number; lcsLen: number; matchedSteps: string[] } {
  const actualPath = steps
    .filter((s) => s.stepType != null)
    .map((s) => s.stepType as string);

  if (actualPath.length === 0 || standardPath.length === 0) {
    return { score: 0, lcsLen: 0, matchedSteps: [] };
  }

  const lcsLen = lcsLength(actualPath, standardPath);
  const score = lcsLen / standardPath.length;

  // Reconstruct matched steps from LCS
  const matchedSteps = reconstructLCS(actualPath, standardPath);

  return {
    score: Math.round(score * 10000) / 10000,
    lcsLen,
    matchedSteps,
  };
}

/**
 * Reconstruct the actual LCS sequence (not just length).
 */
function reconstructLCS(a: string[], b: string[]): string[] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

/**
 * Evaluate path similarity between the actual execution path and the standard path.
 * Uses LCS-based similarity metric.
 */
export function evaluatePathSimilarity(
  actual: string[],
  standard: string[]
): { similarity: number; lcsLen: number; lcsSequence: string[] } {
  if (standard.length === 0) {
    return { similarity: 0, lcsLen: 0, lcsSequence: [] };
  }

  const lcsLen = lcsLength(actual, standard);
  const lcsSequence = reconstructLCS(actual, standard);
  const similarity = lcsLen / standard.length;

  return {
    similarity: Math.round(similarity * 10000) / 10000,
    lcsLen,
    lcsSequence,
  };
}

/**
 * Evaluate GSB (Good / Same / Bad) classification.
 * Deterministic heuristic based on event metrics:
 *  - GOOD: outcome is SUCCESS and step accuracy >= 0.8
 *  - BAD: outcome is FAILED or doom-loop triggered
 *  - SAME: everything else (mediocre / partial)
 */
export function evaluateGSB(
  event: HealingEvent & {
    doomLoopEvents?: Array<{ doomLoopTriggered: boolean }>;
  }
): { gsb: GSBScore; reasoning: string } {
  const doomTriggered =
    event.doomLoopEvents?.some((d) => d.doomLoopTriggered) ?? false;

  if (event.outcome === 'FAILED' || doomTriggered) {
    return {
      gsb: 'BAD',
      reasoning: doomTriggered
        ? 'Doom-loop detected during execution'
        : 'Healing outcome was FAILED',
    };
  }

  const accuracy =
    event.totalSteps > 0 ? event.correctSteps / event.totalSteps : 0;

  if (event.outcome === 'SUCCESS' && accuracy >= 0.8) {
    return {
      gsb: 'GOOD',
      reasoning: `Successful healing with high step accuracy (${accuracy.toFixed(4)})`,
    };
  }

  return {
    gsb: 'SAME',
    reasoning: `Outcome ${event.outcome} with step accuracy ${accuracy.toFixed(4)} — neither clearly good nor bad`,
  };
}

export async function runL2Grader(
  event: HealingEvent & {
    healingSteps?: HealingStep[];
    doomLoopEvents?: Array<{ doomLoopTriggered: boolean }>;
  },
  standardPath?: string[]
): Promise<GraderResult> {
  const steps = event.healingSteps ?? [];
  const path = standardPath ?? [];

  const stepResult = evaluateStepQuality(steps, path);
  const pathResult = evaluatePathSimilarity(
    steps.filter((s) => s.stepType != null).map((s) => s.stepType as string),
    path
  );
  const gsbResult = evaluateGSB(event);

  // Weighted L2 score: 40% step quality, 40% path similarity, 20% GSB
  const gsbNumeric =
    gsbResult.gsb === 'GOOD' ? 1.0 : gsbResult.gsb === 'SAME' ? 0.5 : 0.0;

  const score =
    stepResult.score * 0.4 +
    pathResult.similarity * 0.4 +
    gsbNumeric * 0.2;

  const passed = score >= 0.5;

  return {
    level: 'L2',
    passed,
    score: Math.round(score * 10000) / 10000,
    details: {
      stepScore: stepResult.score,
      stepLcsLen: stepResult.lcsLen,
      stepMatchedSteps: stepResult.matchedSteps,
      pathScore: pathResult.similarity,
      pathLcsLen: pathResult.lcsLen,
      pathLcsSequence: pathResult.lcsSequence,
      gsb: gsbResult.gsb,
      gsbReasoning: gsbResult.reasoning,
    },
    reasoning: `L2 grading: stepScore=${stepResult.score.toFixed(4)}, pathScore=${pathResult.similarity.toFixed(4)}, GSB=${gsbResult.gsb}. ${gsbResult.reasoning}`,
  };
}
