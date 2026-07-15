import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────
function daysAgo(days: number, hoursOffset = 0, minutesOffset = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hoursOffset);
  d.setMinutes(d.getMinutes() - minutesOffset);
  return d;
}

function addMs(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function dec(v: number): number {
  return parseFloat(v.toFixed(4));
}

function costFromTokens(tokens: number, model: string): number {
  const ratePer1k = model.includes('gpt-4o') ? 0.015 : model.includes('qwen') ? 0.004 : 0.01;
  return parseFloat(((tokens / 1000) * ratePer1k).toFixed(4));
}

// ── Seed Data Builders ───────────────────────────────────────

async function main() {
  console.log('Seeding database...');

  // Clean existing data
  await prisma.trialGroupItem.deleteMany();
  await prisma.trialGroup.deleteMany();
  await prisma.graderScore.deleteMany();
  await prisma.reviewScore.deleteMany();
  await prisma.experienceRecord.deleteMany();
  await prisma.runbookUsageLog.deleteMany();
  await prisma.doomLoopEvent.deleteMany();
  await prisma.freshContextLog.deleteMany();
  await prisma.runbookUsageLog.deleteMany();
  await prisma.stateSnapshot.deleteMany();
  await prisma.circuitBreakerLog.deleteMany();
  await prisma.validationLog.deleteMany();
  await prisma.llmCallLog.deleteMany();
  await prisma.healingStep.deleteMany();
  await prisma.healingAction.deleteMany();
  await prisma.healingEvent.deleteMany();
  await prisma.runbookEntry.deleteMany();
  await prisma.benchmarkCase.deleteMany();
  await prisma.taskInstance.deleteMany();
  await prisma.agentConfig.deleteMany();
  await prisma.tenant.deleteMany();

  // ─── 1. Tenant ──────────────────────────────────────────
  const tenant = await prisma.tenant.create({
    data: {
      tenantId: 'tenant-demo-org',
      userId: 'user-admin-001',
      orgName: 'Demo Organization',
      planType: 'pro',
    },
  });

  // ─── 2. Agent Configs ───────────────────────────────────
  const agentV1 = await prisma.agentConfig.create({
    data: {
      agentId: 'sre-agent',
      agentVersion: '1.0.0',
      agentModel: 'gpt-4o',
      agentConfigSnapshot: {
        model: 'gpt-4o',
        temperature: 0.2,
        maxTokens: 4096,
        tools: ['k8s-operator', 'log-analyzer', 'metric-query', 'config-patcher'],
        timeout: 30000,
        retryPolicy: { maxRetries: 3, backoff: 'exponential' },
      },
      tenantId: tenant.id,
    },
  });

  const agentV2 = await prisma.agentConfig.create({
    data: {
      agentId: 'sre-agent',
      agentVersion: '2.0.0',
      agentModel: 'qwen-max',
      agentConfigSnapshot: {
        model: 'qwen-max',
        temperature: 0.1,
        maxTokens: 8192,
        tools: ['k8s-operator', 'log-analyzer', 'metric-query', 'config-patcher', 'runbook-search'],
        timeout: 60000,
        retryPolicy: { maxRetries: 5, backoff: 'exponential' },
        doomLoopDetection: true,
        freshContextEnabled: true,
      },
      tenantId: tenant.id,
    },
  });

  // ─── 3. Task Instances ──────────────────────────────────
  const taskSre = await prisma.taskInstance.create({
    data: {
      taskId: 'task-sre-001',
      taskInstanceId: 'ti-sre-001',
      taskType: 'sre',
      taskDescription: 'Kubernetes pod OOMKilled recovery with cascading dependency check',
      taskComplexity: 'high',
      taskStatus: 'completed',
      tenantId: tenant.id,
      agentConfigId: agentV1.id,
    },
  });

  const taskCoding = await prisma.taskInstance.create({
    data: {
      taskId: 'task-coding-001',
      taskInstanceId: 'ti-coding-001',
      taskType: 'coding',
      taskDescription: 'Deploy hotfix for API gateway timeout handling in payment service',
      taskComplexity: 'medium',
      taskStatus: 'completed',
      tenantId: tenant.id,
      agentConfigId: agentV2.id,
    },
  });

  const taskGeneral = await prisma.taskInstance.create({
    data: {
      taskId: 'task-general-001',
      taskInstanceId: 'ti-general-001',
      taskType: 'general',
      taskDescription: 'Multi-service health check and capacity planning for Q3 traffic surge',
      taskComplexity: 'critical',
      taskStatus: 'completed',
      tenantId: tenant.id,
      agentConfigId: agentV2.id,
    },
  });

  // ─── 4. Benchmark Cases ─────────────────────────────────
  const bmL1 = await prisma.benchmarkCase.create({
    data: {
      benchmarkCaseId: 'bm-L1-001',
      bmDifficulty: 'low',
      bmTags: ['container', 'restart', 'oomkill', 'sandbox'],
      bmSource: 'historical',
      taskInstanceId: taskSre.id,
    },
  });

  const bmL2 = await prisma.benchmarkCase.create({
    data: {
      benchmarkCaseId: 'bm-L2-001',
      bmDifficulty: 'medium',
      bmTags: ['rate-limit', 'model-fallback', '429', 'gateway'],
      bmSource: 'manual',
      taskInstanceId: taskCoding.id,
    },
  });

  const bmL3 = await prisma.benchmarkCase.create({
    data: {
      benchmarkCaseId: 'bm-L3-001',
      bmDifficulty: 'medium',
      bmTags: ['mcp-tool', 'tool-failure', 'replacement', 'timeout'],
      bmSource: 'manual',
      taskInstanceId: taskSre.id,
    },
  });

  const bmL4 = await prisma.benchmarkCase.create({
    data: {
      benchmarkCaseId: 'bm-L4-001',
      bmDifficulty: 'high',
      bmTags: ['jvm', 'memory', 'gc-pause', 'config-patch'],
      bmSource: 'historical',
      taskInstanceId: taskGeneral.id,
    },
  });

  const bmL5 = await prisma.benchmarkCase.create({
    data: {
      benchmarkCaseId: 'bm-L5-001',
      bmDifficulty: 'high',
      bmTags: ['skill', 'version-rollback', 'regression', 'deployment'],
      bmSource: 'runbook',
      taskInstanceId: taskGeneral.id,
    },
  });

  // ─── 5. Runbook Entries ─────────────────────────────────
  const runbooks = await Promise.all([
    prisma.runbookEntry.create({
      data: {
        title: 'Pod OOMKilled Recovery',
        errorPattern: 'container OOMKilled exit code 137, memory limit exceeded',
        resolution: 'Increase memory limit to 2x current, restart pod, verify stable for 5 minutes',
        quality: 0.920,
        status: 'active',
        metadata: { layer: 'L1', avgMttr: '45s', successRate: 0.91 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'Container CrashLoopBackOff',
        errorPattern: 'CrashLoopBackOff back-off restarting failed container',
        resolution: 'Check logs, identify root cause, apply config fix or rollback image version',
        quality: 0.880,
        status: 'active',
        metadata: { layer: 'L1', avgMttr: '90s', successRate: 0.85 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'GPT-4o Rate Limit 429',
        errorPattern: 'HTTP 429 Too Many Requests from openai API, rate limit exceeded',
        resolution: 'Switch to fallback model qwen-max, implement exponential backoff, queue requests',
        quality: 0.950,
        status: 'active',
        metadata: { layer: 'L2', avgMttr: '15s', successRate: 0.95 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'Model Gateway Timeout',
        errorPattern: 'HTTP 504 Gateway Timeout from model inference endpoint',
        resolution: 'Reduce prompt size, switch to faster model variant, increase timeout threshold',
        quality: 0.850,
        status: 'active',
        metadata: { layer: 'L2', avgMttr: '30s', successRate: 0.82 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'MCP Tool Connection Failure',
        errorPattern: 'MCP tool server unreachable, connection refused or timeout',
        resolution: 'Restart MCP proxy, verify tool server health, fallback to alternative tool',
        quality: 0.870,
        status: 'active',
        metadata: { layer: 'L3', avgMttr: '60s', successRate: 0.78 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'K8s API Server Overload',
        errorPattern: 'kubernetes API server returning 503, request throttled',
        resolution: 'Reduce request rate, use cached reads, batch operations, wait for API server recovery',
        quality: 0.800,
        status: 'review',
        metadata: { layer: 'L3', avgMttr: '120s', successRate: 0.70 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'JVM Heap Memory Exhaustion',
        errorPattern: 'java.lang.OutOfMemoryError: Java heap space, GC overhead limit exceeded',
        resolution: 'Increase JVM heap size via -Xmx, trigger GC, analyze memory leak with heap dump',
        quality: 0.910,
        status: 'active',
        metadata: { layer: 'L4', avgMttr: '180s', successRate: 0.88 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'HikariCP Connection Pool Exhausted',
        errorPattern: 'HikariPool - Connection is not available, request timed out',
        resolution: 'Increase pool size, check for connection leaks, restart affected service',
        quality: 0.860,
        status: 'active',
        metadata: { layer: 'L4', avgMttr: '90s', successRate: 0.85 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'Skill Version Regression',
        errorPattern: 'deployed skill version causing errors, performance regression detected',
        resolution: 'Rollback to previous stable version, create incident report, schedule fix',
        quality: 0.780,
        status: 'active',
        metadata: { layer: 'L5', avgMttr: '300s', successRate: 0.65 },
      },
    }),
    prisma.runbookEntry.create({
      data: {
        title: 'Disk Space Critical',
        errorPattern: 'disk usage above 90%, no space left on device',
        resolution: 'Clean old logs, rotate log files, expand PVC if needed, archive old data',
        quality: 0.930,
        status: 'active',
        metadata: { layer: 'L1', avgMttr: '60s', successRate: 0.95 },
      },
    }),
  ]);

  // ─── 6. Healing Events ──────────────────────────────────

  // Helper to create a complete healing event with sub-records
  async function createHealingEvent(params: {
    eventNum: number;
    layer: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
    errorType: string;
    errorCode: string;
    errorMessage: string;
    severity: 'P0' | 'P1' | 'P2' | 'P3';
    agentConfig: typeof agentV1;
    taskInstance: typeof taskSre;
    benchmarkCase?: typeof bmL1;
    daysBack: number;
    hoursBack: number;
    mttdMs: number;
    mttrMs: number;
    outcome: 'SUCCESS' | 'FAILED' | 'PARTIAL' | 'ESCALATED';
    totalSteps: number;
    correctSteps: number;
    optimalSteps: number;
    pathSimilarity: number;
    tokens: number;
    model: string;
    runbookHit: boolean;
    runbookEntry?: typeof runbooks[0];
    doomLoop: boolean;
    doomLoopReason?: 'SAME_ERROR' | 'RECURRENCE' | 'QUALITY_DROP' | 'TOKEN_NO_PROGRESS';
    approvalRequired: boolean;
    degraded: boolean;
    environment: 'prod' | 'staging' | 'eval';
    namespace: string;
    podName: string;
  }) {
    const {
      eventNum, layer, errorType, errorCode, errorMessage, severity,
      agentConfig, taskInstance, benchmarkCase, daysBack, hoursBack,
      mttdMs, mttrMs, outcome, totalSteps, correctSteps, optimalSteps,
      pathSimilarity, tokens, model, runbookHit, runbookEntry,
      doomLoop, doomLoopReason, approvalRequired, degraded,
      environment, namespace, podName,
    } = params;

    const errorTime = daysAgo(daysBack, hoursBack);
    const detectedTime = addMs(errorTime, mttdMs);
    const diagDuration = randInt(1000, 5000);
    const diagDone = addMs(detectedTime, diagDuration);
    const healingStart = addMs(diagDone, randInt(500, 2000));
    const healingDuration = mttrMs - mttdMs - diagDuration;
    const healingDone = addMs(healingStart, Math.max(healingDuration, 1000));
    const verifyDuration = randInt(2000, 10000);
    const verifyDone = addMs(healingDone, verifyDuration);
    const recoveredTime = outcome === 'SUCCESS' ? verifyDone : null;

    const stepAccuracy = totalSteps > 0 ? correctSteps / totalSteps : 0;
    const stepEfficiency = optimalSteps > 0 ? optimalSteps / Math.max(totalSteps, 1) : 0;

    const diagTokens = Math.floor(tokens * 0.3);
    const healingTokens = Math.floor(tokens * 0.5);
    const verifyTokens = tokens - diagTokens - healingTokens;
    const llmCost = costFromTokens(tokens, model);
    const computeCost = parseFloat((randInt(1, 5) * 0.001).toFixed(4));
    const totalCost = parseFloat((llmCost + computeCost).toFixed(4));
    const tokenEfficiency = tokens > 0 ? correctSteps / (tokens / 1000) : 0;

    const verified = outcome === 'SUCCESS' || outcome === 'PARTIAL';
    const schemaPassed = verified;
    const healthPassed = outcome === 'SUCCESS';
    const businessPassed = outcome === 'SUCCESS';

    const eventId = `he-${layer.toLowerCase()}-${String(eventNum).padStart(3, '0')}`;

    const event = await prisma.healingEvent.create({
      data: {
        healingEventId: eventId,
        errorLayer: layer,
        errorType,
        errorCode,
        errorMessage,
        errorOccurredAt: errorTime,
        errorSeverity: severity,
        isCompositeError: layer === 'L4' || layer === 'L5',
        rootCauseLayer: layer === 'L4' ? 'L1' : layer === 'L5' ? 'L3' : null,
        causalChain: (layer === 'L4' || layer === 'L5')
          ? { chain: [`${layer} -> L1 memory pressure -> container restart`, 'cascading timeout in downstream services'] }
          : Prisma.DbNull,

        detectedAt: detectedTime,
        mttdMs: BigInt(mttdMs),
        detectionSource: layer === 'L1' ? 'k8s_event' : layer === 'L2' ? 'mcp_proxy' : layer === 'L3' ? 'mcp_proxy' : layer === 'L4' ? 'jmx' : 'skill_hook',
        diagnosisStrategy: layer === 'L1' ? 'log_pattern_match' : layer === 'L2' ? 'response_code_analysis' : 'multi_signal_correlation',
        runbookHit,
        runbookId: runbookHit && runbookEntry ? `rb-${runbookEntry.id.slice(0, 8)}` : null,
        runbookScore: runbookHit ? dec(0.7 + Math.random() * 0.25) : null,
        alertGroupId: severity === 'P0' || severity === 'P1' ? `ag-${eventNum}` : null,
        rootCauseConfidence: dec(0.65 + Math.random() * 0.3),

        healingStrategy: runbookHit ? 'runbook_guided' : 'llm_reasoning',
        totalSteps,
        correctSteps,
        stepAccuracy: dec(stepAccuracy),
        optimalSteps,
        stepEfficiencyRatio: dec(stepEfficiency),
        pathSimilarity: dec(pathSimilarity),
        degraded,
        degradationType: degraded ? 'graceful_fallback' : null,
        rollbackTriggered: outcome === 'FAILED',
        sagaCompensationLog: outcome === 'FAILED' ? { compensated: ['step-1', 'step-2'], reason: 'healing failed' } : Prisma.DbNull,

        outcome,
        verified,
        verificationType: verified ? 'automated_health_check' : null,
        schemaPassed,
        healthPassed,
        businessPassed,
        newAlertsAfter: outcome === 'SUCCESS' ? 0 : randInt(1, 3),
        affectedScope: severity === 'P0' ? randInt(5, 20) : severity === 'P1' ? randInt(2, 5) : randInt(0, 2),
        affectedUsers: severity === 'P0' ? randInt(100, 5000) : severity === 'P1' ? randInt(10, 100) : randInt(0, 10),

        totalTokens: tokens,
        diagnosisTokens: diagTokens,
        healingTokens: healingTokens,
        verificationTokens: verifyTokens,
        llmCallCount: randInt(2, 8),
        mcpToolCallCount: randInt(1, 5),
        llmApiCostUsd: llmCost,
        computeCostUsd: computeCost,
        totalCostUsd: totalCost,
        tokenEfficiency: dec(tokenEfficiency),

        diagnosisCompletedAt: diagDone,
        healingStartedAt: healingStart,
        healingCompletedAt: healingDone,
        verificationCompletedAt: verified ? verifyDone : null,
        recoveredAt: recoveredTime,
        mttrMs: BigInt(mttrMs),
        diagnosisDurationMs: BigInt(diagDuration),
        healingDurationMs: BigInt(Math.max(healingDuration, 1000)),
        verificationDurationMs: BigInt(verifyDuration),
        totalDurationMs: BigInt(mttrMs + verifyDuration),

        environment,
        k8sNamespace: namespace,
        k8sNode: `node-${randInt(1, 5)}.prod.internal`,
        podName,
        podCpuRequest: `${randInt(1, 4)}00m`,
        podMemoryRequest: `${randInt(1, 8)}Gi`,
        jvmHeapUsedMb: layer === 'L4' ? randInt(1500, 3800) : null,
        jvmThreadCount: layer === 'L4' ? randInt(200, 500) : null,
        hikariActive: layer === 'L4' ? randInt(8, 20) : null,
        hikariTotal: layer === 'L4' ? 20 : null,

        approvalRequired,
        approvalStatus: approvalRequired ? (outcome === 'SUCCESS' ? 'approved' : 'pending') : 'auto_approved',
        approvalRespondedAt: approvalRequired && outcome === 'SUCCESS' ? addMs(detectedTime, randInt(5000, 30000)) : null,
        auditLogId: `audit-${eventNum}`,
        snapshotBefore: `snap-before-${eventNum}`,
        snapshotRestored: outcome === 'FAILED',

        runbookStatus: runbookHit ? 'active' : null,
        runbookSuccessRate: runbookHit ? dec(0.7 + Math.random() * 0.25) : null,
        runbookTotalUses: runbookHit ? randInt(3, 15) : 0,
        runbookUsedAt: runbookHit ? addMs(detectedTime, randInt(500, 3000)) : null,

        experienceRecorded: outcome === 'SUCCESS' || outcome === 'PARTIAL',
        expelInsightGenerated: Math.random() > 0.5,
        runbookCreatedFrom: null,
        runbookUpdatedFrom: runbookHit ? `he-${eventNum}` : null,
        reflexionReviewed: Math.random() > 0.6,

        userVisibleImpact: severity === 'P0' || severity === 'P1',
        impactDurationMs: severity === 'P0' ? BigInt(randInt(30000, 300000)) : severity === 'P1' ? BigInt(randInt(5000, 30000)) : null,
        escalatedToHuman: outcome === 'ESCALATED' || outcome === 'FAILED',
        escalationReason: outcome === 'ESCALATED' ? 'healing_failed_after_max_retries' : outcome === 'FAILED' ? 'manual_intervention_required' : null,
        slaBreach: severity === 'P0' && outcome !== 'SUCCESS',

        tenantId: tenant.id,
        agentConfigId: agentConfig.id,
        taskInstanceId: taskInstance.id,
        benchmarkCaseId: benchmarkCase?.id ?? null,
      },
    });

    // ── Healing Actions ──
    const actionTypes = ['k8s_patch', 'config_update', 'restart', 'fallback'] as const;
    const phases = ['detect', 'recover', 'degrade', 'prevent'] as const;
    for (let i = 0; i < Math.min(totalSteps, 4); i++) {
      await prisma.healingAction.create({
        data: {
          healingPhase: phases[Math.min(i, phases.length - 1)],
          healingActionDetail: `Step ${i + 1}: ${layer} healing action for ${errorType}`,
          healingActionType: actionTypes[i % actionTypes.length],
          healingTargetResource: `pod/${podName}`,
          healingCommand: i === 0 ? `kubectl get pod ${podName} -n ${namespace}` : `kubectl patch pod ${podName} --type=merge -p '{"spec":{"containers":[{"name":"main","resources":{"limits":{"memory":"4Gi"}}}]}}'`,
          healingOutput: i < correctSteps ? 'success: resource patched' : (i < totalSteps ? 'warning: partial success' : 'error: operation failed'),
          healingExitCode: i < correctSteps ? 0 : 1,
          healingDurationMs: BigInt(randInt(1000, 30000)),
          healingIsIdempotent: true,
          healingDrivenBy: runbookHit ? 'runbook_step' : 'llm_reasoning',
          stateMachineTransition: `state_${i} -> state_${i + 1}`,
          retryCount: i < correctSteps ? 0 : randInt(1, 3),
          healingEventId: event.id,
        },
      });
    }

    // ── Healing Steps ──
    for (let i = 1; i <= totalSteps; i++) {
      await prisma.healingStep.create({
        data: {
          stepSeq: i,
          stepType: i <= 2 ? 'diagnosis' : 'remediation',
          action: `Execute ${i <= 2 ? 'diagnostic query' : 'healing command'} step ${i}`,
          result: i <= correctSteps ? 'completed successfully' : 'failed or skipped',
          isCorrect: i <= correctSteps,
          healingEventId: event.id,
        },
      });
    }

    // ── LLM Call Logs ──
    const callCount = randInt(2, 6);
    for (let i = 0; i < callCount; i++) {
      const promptTk = Math.floor(tokens / callCount * (0.8 + Math.random() * 0.4));
      const completionTk = Math.floor(promptTk * 0.3);
      await prisma.llmCallLog.create({
        data: {
          modelName: model,
          promptTokens: promptTk,
          completionTokens: completionTk,
          totalTokens: promptTk + completionTk,
          latencyMs: randInt(500, 8000),
          cost: costFromTokens(promptTk + completionTk, model),
          healingEventId: event.id,
        },
      });
    }

    // ── Validation Log ──
    await prisma.validationLog.create({
      data: {
        healthCheckIntervalMs: BigInt(5000),
        healthCheckTotal: 5,
        healthCheckPassed: healthPassed ? 5 : 2,
        healthCheckFailed: healthPassed ? 0 : 3,
        stabilityWindowMs: BigInt(60000),
        recoveryVerificationStages: ['schema_check', 'health_probe', 'smoke_test'],
        schemaValidationDetail: { passed: schemaPassed, fieldsChecked: 12 },
        healthCheckEndpoint: `/health/${namespace}/${podName}`,
        businessValidationMethod: 'synthetic_transaction',
        verificationAutoOrManual: 'automatic',
        verificationLatencyMs: BigInt(verifyDuration),
        postHealingQuietPeriodMs: BigInt(30000),
        healingEventId: event.id,
      },
    });

    // ── Circuit Breaker ──
    if (layer === 'L2' || layer === 'L3') {
      await prisma.circuitBreakerLog.create({
        data: {
          circuitBreakerName: layer === 'L2' ? 'model-gateway-cb' : 'mcp-tool-cb',
          circuitBreakerStateBefore: 'CLOSED',
          circuitBreakerStateAfter: outcome === 'SUCCESS' ? 'CLOSED' : 'HALF_OPEN',
          circuitBreakerFailureRate: dec(outcome === 'SUCCESS' ? 0.1 : 0.45),
          circuitBreakerThreshold: 0.5,
          circuitBreakerTransitions: outcome === 'SUCCESS' ? 0 : 1,
          modelFallbackChain: layer === 'L2' ? ['gpt-4o', 'gpt-4o-mini', 'qwen-max'] : Prisma.DbNull,
          modelFallbackDepth: layer === 'L2' ? (outcome === 'SUCCESS' ? 1 : 2) : 0,
          modelOriginal: layer === 'L2' ? 'gpt-4o' : null,
          modelFinal: layer === 'L2' ? (outcome === 'SUCCESS' ? 'gpt-4o' : 'qwen-max') : null,
          toolFallbackUsed: layer === 'L3' && outcome === 'PARTIAL',
          toolOriginal: layer === 'L3' ? 'k8s-operator' : null,
          toolFinal: layer === 'L3' && outcome === 'PARTIAL' ? 'kubectl-direct' : null,
          halfOpenProbeResult: outcome === 'SUCCESS' ? 'success' : 'not_probed',
          healingEventId: event.id,
        },
      });
    }

    // ── State Snapshot ──
    await prisma.stateSnapshot.create({
      data: {
        preHealingState: { status: 'error', cpu: '85%', memory: '92%', errorCount: randInt(1, 10) },
        postHealingState: { status: outcome === 'SUCCESS' ? 'healthy' : 'degraded', cpu: '45%', memory: '60%', errorCount: outcome === 'SUCCESS' ? 0 : randInt(1, 3) },
        stateDiff: { cpuDelta: '-40%', memoryDelta: '-32%', errorDelta: outcome === 'SUCCESS' ? 'cleared' : 'reduced' },
        resourcesBefore: { cpu: '850m', memory: '3.2Gi' },
        resourcesAfter: { cpu: '450m', memory: outcome === 'SUCCESS' ? '1.8Gi' : '2.4Gi' },
        configChanges: [{ field: 'memory.limit', before: '2Gi', after: '4Gi' }],
        snapshotId: `snap-${eventNum}`,
        rollbackAvailable: true,
        rollbackExecuted: outcome === 'FAILED',
        rollbackReason: outcome === 'FAILED' ? 'healing steps failed verification' : null,
        rollbackDurationMs: outcome === 'FAILED' ? BigInt(randInt(5000, 15000)) : null,
        rollbackSuccess: outcome === 'FAILED',
        healingEventId: event.id,
      },
    });

    // ── Doom Loop ──
    if (doomLoop) {
      await prisma.doomLoopEvent.create({
        data: {
          doomLoopTriggered: true,
          doomLoopReason: doomLoopReason ?? 'SAME_ERROR',
          doomLoopCount: randInt(3, 7),
          rescueAgentTriggered: true,
          rescueAgentSuccess: outcome === 'SUCCESS' || outcome === 'PARTIAL',
          rescueAgentSteps: randInt(2, 5),
          rescueAgentTokens: randInt(2000, 5000),
          healingEventId: event.id,
        },
      });
    }

    // ── Grader Score ──
    const l1Pass = outcome === 'SUCCESS';
    const l2StepScore = stepAccuracy;
    const l2PathScore = pathSimilarity;
    const finalScore = dec((l2StepScore * 0.4 + l2PathScore * 0.3 + (l1Pass ? 1 : 0) * 0.3));

    await prisma.graderScore.create({
      data: {
        graderL1Pass: l1Pass,
        graderL2StepScore: dec(l2StepScore),
        graderL2PathScore: dec(l2PathScore),
        graderL2Gsb: finalScore >= 0.7 ? 'GOOD' : finalScore >= 0.4 ? 'SAME' : 'BAD',
        graderL2Reason: `Step accuracy: ${(l2StepScore * 100).toFixed(1)}%, Path similarity: ${(l2PathScore * 100).toFixed(1)}%. ${runbookHit ? 'Runbook-guided recovery.' : 'LLM-reasoned healing.'}`,
        graderL3Reviewed: severity === 'P0' || severity === 'P1',
        graderL3Override: false,
        graderL3Reason: (severity === 'P0' || severity === 'P1') ? `Human review: ${outcome === 'SUCCESS' ? 'approved healing actions' : 'flagged for investigation'}` : null,
        finalScore,
        graderLevel: (severity === 'P0' || severity === 'P1') ? 'L3' : 'L2',
        healingEventId: event.id,
      },
    });

    // ── Runbook Usage Log ──
    if (runbookHit && runbookEntry) {
      await prisma.runbookUsageLog.create({
        data: {
          outcome,
          duration: randInt(10, 120),
          entryId: runbookEntry.id,
          healingEventId: event.id,
        },
      });
    }

    // ── Experience Record ──
    if (outcome === 'SUCCESS' || outcome === 'PARTIAL') {
      await prisma.experienceRecord.create({
        data: {
          errorType,
          action: `${layer} healing: ${runbookHit ? 'runbook-guided' : 'llm-reasoned'} recovery for ${errorType}`,
          outcome,
          duration: Math.floor(mttrMs / 1000),
          contextHash: `ctx-${event.id.slice(0, 8)}`,
          healingEventId: event.id,
        },
      });
    }

    return event;
  }

  // ─── L1 Events (8): Sandbox / Container ─────────────────
  // ~90% success rate, <5s detect, <120s recover
  const l1Events = [];

  l1Events.push(await createHealingEvent({
    eventNum: 1, layer: 'L1', errorType: 'container_oomkill', errorCode: 'OOM_137',
    errorMessage: 'Pod killed due to OOM: memory limit 2Gi exceeded, container used 2.1Gi',
    severity: 'P1', agentConfig: agentV1, taskInstance: taskSre, benchmarkCase: bmL1,
    daysBack: 6, hoursBack: 2, mttdMs: 2000, mttrMs: 45000,
    outcome: 'SUCCESS', totalSteps: 4, correctSteps: 4, optimalSteps: 3,
    pathSimilarity: 0.92, tokens: 2800, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[0],
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'default', podName: 'payment-svc-7d8f9-abc12',
  }));

  l1Events.push(await createHealingEvent({
    eventNum: 2, layer: 'L1', errorType: 'container_crashloop', errorCode: 'CLBO_001',
    errorMessage: 'Back-off restarting failed container: CrashLoopBackOff for 15 minutes',
    severity: 'P2', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 5, hoursBack: 8, mttdMs: 3000, mttrMs: 78000,
    outcome: 'SUCCESS', totalSteps: 5, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.85, tokens: 3200, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[1],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'default', podName: 'auth-svc-5c6d7-def34',
  }));

  l1Events.push(await createHealingEvent({
    eventNum: 3, layer: 'L1', errorType: 'container_oomkill', errorCode: 'OOM_137',
    errorMessage: 'Container main exceeded memory limit 4Gi, OOMKilled by kernel',
    severity: 'P2', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 5, hoursBack: 3, mttdMs: 1500, mttrMs: 38000,
    outcome: 'SUCCESS', totalSteps: 3, correctSteps: 3, optimalSteps: 3,
    pathSimilarity: 0.95, tokens: 2100, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[0],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'order-svc', podName: 'order-svc-8e9f0-ghi56',
  }));

  l1Events.push(await createHealingEvent({
    eventNum: 4, layer: 'L1', errorType: 'disk_pressure', errorCode: 'DISK_090',
    errorMessage: 'Node disk pressure: /dev/sda1 usage at 94%, eviction threshold 85%',
    severity: 'P2', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 4, hoursBack: 6, mttdMs: 4000, mttrMs: 65000,
    outcome: 'SUCCESS', totalSteps: 4, correctSteps: 4, optimalSteps: 3,
    pathSimilarity: 0.88, tokens: 2500, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[9],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'staging', namespace: 'data-pipeline', podName: 'etl-worker-3a4b5-jkl78',
  }));

  l1Events.push(await createHealingEvent({
    eventNum: 5, layer: 'L1', errorType: 'container_oomkill', errorCode: 'OOM_137',
    errorMessage: 'Sidecar proxy container OOMKilled, istio-proxy memory limit 512Mi exceeded',
    severity: 'P3', agentConfig: agentV2, taskInstance: taskGeneral,
    daysBack: 3, hoursBack: 10, mttdMs: 2500, mttrMs: 52000,
    outcome: 'SUCCESS', totalSteps: 3, correctSteps: 3, optimalSteps: 2,
    pathSimilarity: 0.90, tokens: 1800, model: 'qwen-max',
    runbookHit: false,
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'gateway', podName: 'api-gw-1b2c3-mno90',
  }));

  l1Events.push(await createHealingEvent({
    eventNum: 6, layer: 'L1', errorType: 'container_crashloop', errorCode: 'CLBO_001',
    errorMessage: 'Container config-reloader in CrashLoopBackOff, configmap not found',
    severity: 'P2', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 2, hoursBack: 4, mttdMs: 3500, mttrMs: 95000,
    outcome: 'PARTIAL', totalSteps: 6, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.72, tokens: 3800, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[1],
    doomLoop: false, approvalRequired: false, degraded: true,
    environment: 'prod', namespace: 'config-svc', podName: 'config-loader-9d0e1-pqr12',
  }));

  l1Events.push(await createHealingEvent({
    eventNum: 7, layer: 'L1', errorType: 'container_oomkill', errorCode: 'OOM_137',
    errorMessage: 'Batch processing pod OOMKilled during nightly ETL, memory spike to 8.2Gi',
    severity: 'P1', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 1, hoursBack: 14, mttdMs: 1800, mttrMs: 110000,
    outcome: 'FAILED', totalSteps: 5, correctSteps: 2, optimalSteps: 4,
    pathSimilarity: 0.45, tokens: 4200, model: 'gpt-4o',
    runbookHit: false,
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'data-pipeline', podName: 'batch-etl-6f7g8-stu34',
  }));

  l1Events.push(await createHealingEvent({
    eventNum: 8, layer: 'L1', errorType: 'pod_eviction', errorCode: 'EVICT_001',
    errorMessage: 'Pod evicted due to node memory pressure, rescheduled to node-3',
    severity: 'P2', agentConfig: agentV2, taskInstance: taskGeneral,
    daysBack: 0, hoursBack: 6, mttdMs: 4500, mttrMs: 72000,
    outcome: 'SUCCESS', totalSteps: 4, correctSteps: 3, optimalSteps: 3,
    pathSimilarity: 0.82, tokens: 2400, model: 'qwen-max',
    runbookHit: false,
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'default', podName: 'frontend-2h3i9-vwx56',
  }));

  // ─── L2 Events (8): Model Gateway ───────────────────────
  // GPT-4o 429 rate limits, model fallback, ~80% success
  const l2Events = [];

  l2Events.push(await createHealingEvent({
    eventNum: 9, layer: 'L2', errorType: 'rate_limit_429', errorCode: 'HTTP_429',
    errorMessage: 'OpenAI API rate limit exceeded: 429 Too Many Requests, retry after 30s',
    severity: 'P2', agentConfig: agentV1, taskInstance: taskSre, benchmarkCase: bmL2,
    daysBack: 6, hoursBack: 5, mttdMs: 8000, mttrMs: 45000,
    outcome: 'SUCCESS', totalSteps: 3, correctSteps: 3, optimalSteps: 2,
    pathSimilarity: 0.90, tokens: 2600, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[2],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'agent-runtime', podName: 'sre-agent-4j5k0-yza78',
  }));

  l2Events.push(await createHealingEvent({
    eventNum: 10, layer: 'L2', errorType: 'rate_limit_429', errorCode: 'HTTP_429',
    errorMessage: 'Concurrent request limit hit: max 60 RPM exceeded, current 78 RPM',
    severity: 'P2', agentConfig: agentV1, taskInstance: taskCoding,
    daysBack: 5, hoursBack: 12, mttdMs: 5000, mttrMs: 35000,
    outcome: 'SUCCESS', totalSteps: 3, correctSteps: 3, optimalSteps: 2,
    pathSimilarity: 0.88, tokens: 2200, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[2],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'agent-runtime', podName: 'sre-agent-7l8m1-bcd90',
  }));

  l2Events.push(await createHealingEvent({
    eventNum: 11, layer: 'L2', errorType: 'gateway_timeout_504', errorCode: 'HTTP_504',
    errorMessage: 'Model inference gateway timeout: request exceeded 120s limit',
    severity: 'P1', agentConfig: agentV2, taskInstance: taskGeneral,
    daysBack: 4, hoursBack: 1, mttdMs: 25000, mttrMs: 85000,
    outcome: 'SUCCESS', totalSteps: 5, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.78, tokens: 3600, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[3],
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'agent-runtime', podName: 'sre-agent-1n2o3-efg12',
  }));

  l2Events.push(await createHealingEvent({
    eventNum: 12, layer: 'L2', errorType: 'rate_limit_429', errorCode: 'HTTP_429',
    errorMessage: 'Token budget exhausted: daily token limit of 1M reached at 14:30 UTC',
    severity: 'P1', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 3, hoursBack: 7, mttdMs: 15000, mttrMs: 95000,
    outcome: 'PARTIAL', totalSteps: 6, correctSteps: 3, optimalSteps: 4,
    pathSimilarity: 0.62, tokens: 4500, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[2],
    doomLoop: true, doomLoopReason: 'TOKEN_NO_PROGRESS',
    approvalRequired: true, degraded: true,
    environment: 'prod', namespace: 'agent-runtime', podName: 'sre-agent-4p5q6-hij34',
  }));

  l2Events.push(await createHealingEvent({
    eventNum: 13, layer: 'L2', errorType: 'model_error_500', errorCode: 'HTTP_500',
    errorMessage: 'Internal server error from GPT-4o endpoint: model overloaded',
    severity: 'P2', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 3, hoursBack: 2, mttdMs: 12000, mttrMs: 55000,
    outcome: 'SUCCESS', totalSteps: 4, correctSteps: 3, optimalSteps: 3,
    pathSimilarity: 0.80, tokens: 2900, model: 'qwen-max',
    runbookHit: false,
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'staging', namespace: 'agent-runtime', podName: 'sre-agent-7r8s9-klm56',
  }));

  l2Events.push(await createHealingEvent({
    eventNum: 14, layer: 'L2', errorType: 'rate_limit_429', errorCode: 'HTTP_429',
    errorMessage: 'Rate limit cascade: primary and fallback models both rate limited',
    severity: 'P2', agentConfig: agentV2, taskInstance: taskGeneral,
    daysBack: 2, hoursBack: 9, mttdMs: 10000, mttrMs: 110000,
    outcome: 'FAILED', totalSteps: 7, correctSteps: 2, optimalSteps: 4,
    pathSimilarity: 0.38, tokens: 4800, model: 'qwen-max',
    runbookHit: false,
    doomLoop: true, doomLoopReason: 'SAME_ERROR',
    approvalRequired: false, degraded: true,
    environment: 'prod', namespace: 'agent-runtime', podName: 'sre-agent-0t1u2-nop78',
  }));

  l2Events.push(await createHealingEvent({
    eventNum: 15, layer: 'L2', errorType: 'gateway_timeout_504', errorCode: 'HTTP_504',
    errorMessage: 'Streaming response interrupted: gateway timeout after 90s of silence',
    severity: 'P3', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 1, hoursBack: 5, mttdMs: 20000, mttrMs: 68000,
    outcome: 'SUCCESS', totalSteps: 4, correctSteps: 3, optimalSteps: 3,
    pathSimilarity: 0.82, tokens: 2400, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[3],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'agent-runtime', podName: 'sre-agent-3v4w5-qrs90',
  }));

  l2Events.push(await createHealingEvent({
    eventNum: 16, layer: 'L2', errorType: 'model_error_503', errorCode: 'HTTP_503',
    errorMessage: 'Model service unavailable: upstream health check failed for gpt-4o',
    severity: 'P2', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 0, hoursBack: 3, mttdMs: 18000, mttrMs: 72000,
    outcome: 'SUCCESS', totalSteps: 4, correctSteps: 3, optimalSteps: 3,
    pathSimilarity: 0.76, tokens: 2700, model: 'qwen-max',
    runbookHit: false,
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'agent-runtime', podName: 'sre-agent-6x7y8-tuv12',
  }));

  // ─── L3 Events (6): MCP Tools ───────────────────────────
  // Tool failures, replacements, ~70% success
  const l3Events = [];

  l3Events.push(await createHealingEvent({
    eventNum: 17, layer: 'L3', errorType: 'mcp_tool_timeout', errorCode: 'MCP_TIMEOUT',
    errorMessage: 'MCP tool k8s-operator timed out after 30s: API server slow response',
    severity: 'P2', agentConfig: agentV1, taskInstance: taskSre, benchmarkCase: bmL3,
    daysBack: 6, hoursBack: 1, mttdMs: 32000, mttrMs: 85000,
    outcome: 'SUCCESS', totalSteps: 5, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.78, tokens: 3400, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[4],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'mcp-proxy', podName: 'mcp-k8s-9z0a1-wxy34',
  }));

  l3Events.push(await createHealingEvent({
    eventNum: 18, layer: 'L3', errorType: 'mcp_connection_refused', errorCode: 'MCP_CONN',
    errorMessage: 'MCP proxy connection refused: log-analyzer tool server down on port 8080',
    severity: 'P1', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 4, hoursBack: 10, mttdMs: 15000, mttrMs: 92000,
    outcome: 'PARTIAL', totalSteps: 6, correctSteps: 4, optimalSteps: 5,
    pathSimilarity: 0.65, tokens: 3900, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[4],
    doomLoop: false, approvalRequired: true, degraded: true,
    environment: 'prod', namespace: 'mcp-proxy', podName: 'mcp-log-2b3c4-zab56',
  }));

  l3Events.push(await createHealingEvent({
    eventNum: 19, layer: 'L3', errorType: 'mcp_tool_error', errorCode: 'MCP_ERR_500',
    errorMessage: 'MCP tool metric-query returned 500: Prometheus backend unreachable',
    severity: 'P2', agentConfig: agentV2, taskInstance: taskGeneral,
    daysBack: 3, hoursBack: 5, mttdMs: 20000, mttrMs: 78000,
    outcome: 'SUCCESS', totalSteps: 4, correctSteps: 3, optimalSteps: 3,
    pathSimilarity: 0.72, tokens: 3100, model: 'qwen-max',
    runbookHit: false,
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'mcp-proxy', podName: 'mcp-metric-5d6e7-bcd78',
  }));

  l3Events.push(await createHealingEvent({
    eventNum: 20, layer: 'L3', errorType: 'k8s_api_throttle', errorCode: 'K8S_429',
    errorMessage: 'Kubernetes API server throttling: too many requests from service account',
    severity: 'P2', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 2, hoursBack: 7, mttdMs: 25000, mttrMs: 120000,
    outcome: 'FAILED', totalSteps: 8, correctSteps: 3, optimalSteps: 5,
    pathSimilarity: 0.42, tokens: 4600, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[5],
    doomLoop: false, approvalRequired: false, degraded: true,
    environment: 'prod', namespace: 'kube-system', podName: 'mcp-k8s-8f9g0-efg90',
  }));

  l3Events.push(await createHealingEvent({
    eventNum: 21, layer: 'L3', errorType: 'mcp_tool_timeout', errorCode: 'MCP_TIMEOUT',
    errorMessage: 'Config-patcher tool execution timeout: complex patch taking >60s',
    severity: 'P3', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 1, hoursBack: 11, mttdMs: 28000, mttrMs: 95000,
    outcome: 'SUCCESS', totalSteps: 5, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.75, tokens: 3300, model: 'qwen-max',
    runbookHit: false,
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'staging', namespace: 'mcp-proxy', podName: 'mcp-config-1h2i3-hij12',
  }));

  l3Events.push(await createHealingEvent({
    eventNum: 22, layer: 'L3', errorType: 'mcp_schema_mismatch', errorCode: 'MCP_SCHEMA',
    errorMessage: 'MCP tool response schema mismatch: expected array got object from runbook-search',
    severity: 'P3', agentConfig: agentV2, taskInstance: taskGeneral,
    daysBack: 0, hoursBack: 8, mttdMs: 12000, mttrMs: 55000,
    outcome: 'SUCCESS', totalSteps: 3, correctSteps: 3, optimalSteps: 2,
    pathSimilarity: 0.85, tokens: 2000, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[4],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'mcp-proxy', podName: 'mcp-runbook-4j5k6-klm34',
  }));

  // ─── L4 Events (5): Platform ────────────────────────────
  // JVM memory issues, config patches, ~85% success
  const l4Events = [];

  l4Events.push(await createHealingEvent({
    eventNum: 23, layer: 'L4', errorType: 'jvm_oom', errorCode: 'JVM_OOM',
    errorMessage: 'java.lang.OutOfMemoryError: Java heap space in order-service, GC overhead 98%',
    severity: 'P0', agentConfig: agentV1, taskInstance: taskGeneral, benchmarkCase: bmL4,
    daysBack: 5, hoursBack: 6, mttdMs: 8000, mttrMs: 180000,
    outcome: 'SUCCESS', totalSteps: 6, correctSteps: 5, optimalSteps: 5,
    pathSimilarity: 0.82, tokens: 4200, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[6],
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'order-svc', podName: 'order-java-7l8m9-nop56',
  }));

  l4Events.push(await createHealingEvent({
    eventNum: 24, layer: 'L4', errorType: 'hikari_pool_exhausted', errorCode: 'HIKARI_EXH',
    errorMessage: 'HikariPool-1: Connection is not available, request timed out after 30000ms, active=20/20',
    severity: 'P1', agentConfig: agentV2, taskInstance: taskSre,
    daysBack: 4, hoursBack: 3, mttdMs: 12000, mttrMs: 95000,
    outcome: 'SUCCESS', totalSteps: 5, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.78, tokens: 3800, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[7],
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'payment-svc', podName: 'payment-java-0n1o2-qrs78',
  }));

  l4Events.push(await createHealingEvent({
    eventNum: 25, layer: 'L4', errorType: 'gc_pause_long', errorCode: 'GC_LONG',
    errorMessage: 'GC pause (G1 Evacuation Pause) 4.2s, causing request timeouts in inventory-service',
    severity: 'P1', agentConfig: agentV2, taskInstance: taskGeneral,
    daysBack: 3, hoursBack: 1, mttdMs: 15000, mttrMs: 120000,
    outcome: 'SUCCESS', totalSteps: 5, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.75, tokens: 3600, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[6],
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'inventory-svc', podName: 'inventory-java-3p4q5-tuv90',
  }));

  l4Events.push(await createHealingEvent({
    eventNum: 26, layer: 'L4', errorType: 'thread_deadlock', errorCode: 'THREAD_DL',
    errorMessage: 'Thread deadlock detected in user-service: 12 threads blocked on connection pool',
    severity: 'P0', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 2, hoursBack: 0, mttdMs: 20000, mttrMs: 240000,
    outcome: 'ESCALATED', totalSteps: 8, correctSteps: 3, optimalSteps: 6,
    pathSimilarity: 0.35, tokens: 5000, model: 'gpt-4o',
    runbookHit: false,
    doomLoop: false, approvalRequired: true, degraded: true,
    environment: 'prod', namespace: 'user-svc', podName: 'user-java-6r7s8-wxy12',
  }));

  l4Events.push(await createHealingEvent({
    eventNum: 27, layer: 'L4', errorType: 'jvm_oom', errorCode: 'JVM_OOM',
    errorMessage: 'java.lang.OutOfMemoryError: Metaspace in notification-service, class loader leak suspected',
    severity: 'P1', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 1, hoursBack: 2, mttdMs: 10000, mttrMs: 150000,
    outcome: 'SUCCESS', totalSteps: 5, correctSteps: 5, optimalSteps: 4,
    pathSimilarity: 0.88, tokens: 3400, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[6],
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'notification-svc', podName: 'notify-java-9t0u1-zab34',
  }));

  // ─── L5 Events (3): Skill ──────────────────────────────
  // Version rollbacks, ~60% success
  const l5Events = [];

  l5Events.push(await createHealingEvent({
    eventNum: 28, layer: 'L5', errorType: 'skill_version_regression', errorCode: 'SKILL_REG',
    errorMessage: 'Skill k8s-operator v2.3.1 regression: new RBAC policy breaking pod creation for non-admin users',
    severity: 'P0', agentConfig: agentV2, taskInstance: taskGeneral, benchmarkCase: bmL5,
    daysBack: 4, hoursBack: 8, mttdMs: 45000, mttrMs: 300000,
    outcome: 'SUCCESS', totalSteps: 7, correctSteps: 5, optimalSteps: 5,
    pathSimilarity: 0.68, tokens: 4800, model: 'qwen-max',
    runbookHit: true, runbookEntry: runbooks[8],
    doomLoop: false, approvalRequired: true, degraded: false,
    environment: 'prod', namespace: 'skill-runtime', podName: 'skill-runner-2v3w4-bcd56',
  }));

  l5Events.push(await createHealingEvent({
    eventNum: 29, layer: 'L5', errorType: 'skill_deployment_failure', errorCode: 'SKILL_DEP',
    errorMessage: 'Skill deployment failed: health check failing for log-analyzer v1.5.0 after rolling update',
    severity: 'P1', agentConfig: agentV2, taskInstance: taskCoding,
    daysBack: 2, hoursBack: 5, mttdMs: 60000, mttrMs: 360000,
    outcome: 'FAILED', totalSteps: 9, correctSteps: 3, optimalSteps: 6,
    pathSimilarity: 0.32, tokens: 5200, model: 'qwen-max',
    runbookHit: false,
    doomLoop: false, approvalRequired: true, degraded: true,
    environment: 'prod', namespace: 'skill-runtime', podName: 'skill-runner-5x6y7-efg78',
  }));

  l5Events.push(await createHealingEvent({
    eventNum: 30, layer: 'L5', errorType: 'skill_config_drift', errorCode: 'SKILL_CFG',
    errorMessage: 'Skill config drift detected: metric-query using stale Prometheus endpoint after cluster migration',
    severity: 'P2', agentConfig: agentV1, taskInstance: taskSre,
    daysBack: 0, hoursBack: 12, mttdMs: 30000, mttrMs: 180000,
    outcome: 'PARTIAL', totalSteps: 6, correctSteps: 4, optimalSteps: 4,
    pathSimilarity: 0.60, tokens: 3800, model: 'gpt-4o',
    runbookHit: true, runbookEntry: runbooks[8],
    doomLoop: false, approvalRequired: false, degraded: false,
    environment: 'prod', namespace: 'skill-runtime', podName: 'skill-runner-8z9a0-hij90',
  }));

  // ─── 7. Review Scores (GSB) ─────────────────────────────
  const allEvents = [...l1Events, ...l2Events, ...l3Events, ...l4Events, ...l5Events];
  const reviewCandidates = allEvents.filter((_, i) => i % 3 === 0).slice(0, 10);

  for (const evt of reviewCandidates) {
    const score = evt.outcome === 'SUCCESS'
      ? (Math.random() > 0.3 ? 'GOOD' : 'SAME')
      : evt.outcome === 'PARTIAL'
        ? 'SAME'
        : 'BAD';

    await prisma.reviewScore.create({
      data: {
        gsbScore: score as 'GOOD' | 'SAME' | 'BAD',
        reasoning: score === 'GOOD'
          ? 'Agent resolved the issue efficiently with minimal steps and no user impact.'
          : score === 'SAME'
            ? 'Agent performance was comparable to baseline. Some steps were suboptimal but outcome was acceptable.'
            : 'Agent failed to resolve the issue within acceptable time bounds. Manual intervention was required.',
        healingEventId: evt.id,
      },
    });
  }

  // ─── 8. Trial Groups (3 groups, k=3) ────────────────────
  // Each group picks 3 events and computes Pass@k and Pass^k

  function computePassAtK(results: boolean[], k: number): number {
    const n = results.length;
    if (n === 0) return 0;
    const c = results.filter(r => !r).length; // failures
    if (n - c < k) return 1;
    let product = 1;
    for (let i = 0; i < k; i++) {
      product *= (c - i) / (n - i);
    }
    return parseFloat((1 - product).toFixed(4));
  }

  function computePassPowK(results: boolean[], k: number): number {
    if (results.length === 0) return 0;
    const allFirstK = results.slice(0, k);
    return allFirstK.every(r => r) ? 1 : 0;
  }

  const trialConfigs = [
    { groupId: 'tg-sre-v1', taskInstance: taskSre, eventPool: [l1Events[0], l1Events[1], l2Events[0], l3Events[0], l4Events[0]] },
    { groupId: 'tg-code-v2', taskInstance: taskCoding, eventPool: [l1Events[3], l2Events[2], l2Events[4], l3Events[1], l5Events[1]] },
    { groupId: 'tg-gen-v2', taskInstance: taskGeneral, eventPool: [l1Events[4], l2Events[3], l3Events[2], l4Events[2], l5Events[0]] },
  ];

  for (const cfg of trialConfigs) {
    const k = 3;
    const results = cfg.eventPool.map(e => e.outcome === 'SUCCESS');
    const passAtK = computePassAtK(results, k);
    const passPowK = computePassPowK(results, k);
    const successes = results.filter(r => r).length;
    const gap = parseFloat((passAtK - passPowK).toFixed(4));

    const trialGroup = await prisma.trialGroup.create({
      data: {
        trialGroupId: cfg.groupId,
        trialGroupN: cfg.eventPool.length,
        trialGroupC: successes,
        passAtK: dec(passAtK),
        passPowK: dec(passPowK),
        gap: dec(Math.abs(gap)),
        taskInstanceId: cfg.taskInstance.id,
      },
    });

    for (let i = 0; i < Math.min(k, cfg.eventPool.length); i++) {
      await prisma.trialGroupItem.create({
        data: {
          trialSequence: i + 1,
          trialK: k,
          trialGroupId: trialGroup.id,
          healingEventId: cfg.eventPool[i].id,
        },
      });
    }
  }

  console.log('Seed completed successfully!');
  console.log(`  Tenant:       1`);
  console.log(`  AgentConfigs: 2`);
  console.log(`  TaskInstances:3`);
  console.log(`  Benchmarks:   5`);
  console.log(`  Runbooks:     ${runbooks.length}`);
  console.log(`  HealingEvents:${allEvents.length}`);
  console.log(`  TrialGroups:  3`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
