import type { HealingEvent } from '@prisma/client';
import type { GraderResult } from './types';

type L1CheckResult = {
  name: string;
  passed: boolean;
  value: number;
  threshold: number;
  message: string;
};

export function checkSchemaValidation(
  event: HealingEvent
): L1CheckResult {
  const passed = event.schemaPassed === true;
  return {
    name: 'schemaValidation',
    passed,
    value: passed ? 1 : 0,
    threshold: 1,
    message: passed
      ? 'Schema validation passed'
      : 'Schema validation failed — output does not match expected schema',
  };
}

export function checkHealthPassed(
  event: HealingEvent
): L1CheckResult {
  const passed = event.healthPassed === true;
  return {
    name: 'healthCheck',
    passed,
    value: passed ? 1 : 0,
    threshold: 1,
    message: passed
      ? 'Health check passed'
      : 'Health check failed — service did not recover to healthy state',
  };
}

export function checkStepAccuracy(
  event: HealingEvent,
  threshold: number = 0.6
): L1CheckResult {
  const ratio =
    event.totalSteps > 0 ? event.correctSteps / event.totalSteps : 0;
  const passed = ratio >= threshold;
  return {
    name: 'stepAccuracy',
    passed,
    value: Math.round(ratio * 10000) / 10000,
    threshold,
    message: passed
      ? `Step accuracy ${ratio.toFixed(4)} >= threshold ${threshold}`
      : `Step accuracy ${ratio.toFixed(4)} below threshold ${threshold}`,
  };
}

export function checkNoDoomLoop(
  event: HealingEvent & { doomLoopEvents?: Array<{ doomLoopTriggered: boolean }> }
): L1CheckResult {
  const doomEvents = event.doomLoopEvents ?? [];
  const doomTriggered = doomEvents.some((d) => d.doomLoopTriggered === true);
  const passed = !doomTriggered;
  return {
    name: 'noDoomLoop',
    passed,
    value: passed ? 1 : 0,
    threshold: 1,
    message: passed
      ? 'No doom-loop detected'
      : 'Doom-loop was triggered during healing execution',
  };
}

export function checkCostWithinBudget(
  event: HealingEvent,
  maxCost: number = 1.0
): L1CheckResult {
  const cost = event.totalCostUsd ? Number(event.totalCostUsd) : 0;
  const passed = cost <= maxCost;
  return {
    name: 'costBudget',
    passed,
    value: cost,
    threshold: maxCost,
    message: passed
      ? `Total cost $${cost.toFixed(4)} within budget $${maxCost.toFixed(4)}`
      : `Total cost $${cost.toFixed(4)} exceeds budget $${maxCost.toFixed(4)}`,
  };
}

export function checkMTTRWithinSLA(
  event: HealingEvent,
  maxMs: number = 300000
): L1CheckResult {
  const mttr = event.mttrMs ? Number(event.mttrMs) : 0;
  const passed = mttr > 0 && mttr <= maxMs;
  return {
    name: 'mttrSLA',
    passed,
    value: mttr,
    threshold: maxMs,
    message: passed
      ? `MTTR ${mttr}ms within SLA ${maxMs}ms`
      : mttr === 0
        ? 'MTTR not recorded — cannot evaluate SLA'
        : `MTTR ${mttr}ms exceeds SLA ${maxMs}ms`,
  };
}

export async function runL1Grader(
  event: HealingEvent & {
    doomLoopEvents?: Array<{ doomLoopTriggered: boolean }>;
  },
  options?: {
    stepAccuracyThreshold?: number;
    maxCost?: number;
    maxMttrMs?: number;
  }
): Promise<GraderResult> {
  const stepThreshold = options?.stepAccuracyThreshold ?? 0.6;
  const maxCost = options?.maxCost ?? 1.0;
  const maxMttrMs = options?.maxMttrMs ?? 300000;

  const checks: L1CheckResult[] = [
    checkSchemaValidation(event),
    checkHealthPassed(event),
    checkStepAccuracy(event, stepThreshold),
    checkNoDoomLoop(event),
    checkCostWithinBudget(event, maxCost),
    checkMTTRWithinSLA(event, maxMttrMs),
  ];

  const passedCount = checks.filter((c) => c.passed).length;
  const totalCount = checks.length;
  const score = totalCount > 0 ? passedCount / totalCount : 0;

  const allPassed = passedCount === totalCount;

  const detailMap: Record<string, any> = {};
  for (const check of checks) {
    detailMap[check.name] = {
      passed: check.passed,
      value: check.value,
      threshold: check.threshold,
      message: check.message,
    };
  }

  const failedChecks = checks
    .filter((c) => !c.passed)
    .map((c) => c.name);

  return {
    level: 'L1',
    passed: allPassed,
    score: Math.round(score * 10000) / 10000,
    details: {
      checks: detailMap,
      passedCount,
      totalCount,
      failedChecks,
    },
    reasoning: allPassed
      ? 'All L1 deterministic checks passed'
      : `L1 grading: ${passedCount}/${totalCount} checks passed. Failed: ${failedChecks.join(', ')}`,
  };
}
