// Supervisor / orchestrator.
// Mirrors the "Supervisor Agent" pattern from high-star marketing-agent projects:
// it decomposes a goal into a sequence of role-specialized tasks and executes
// them in order, collecting structured artifacts.

import type { AgentRole, AgentRunResult, RunContext } from './types.js'

export interface PipelineStep {
  role: AgentRole
  key: string
  title: string
  /** Build the prompt for this step from the run context. */
  prompt: (ctx: RunContext) => string
  system?: string
}

const DEFAULT_SYSTEM =
  'You are a senior marketing professional. Be concise, structured, and actionable. ' +
  'Use markdown headings and bullet lists. Avoid fluff.'

export async function runPipeline(
  steps: PipelineStep[],
  ctx: RunContext
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = []
  for (const step of steps) {
    ctx.log(`▶ [${step.role}] ${step.title}`)
    const system = step.system ?? DEFAULT_SYSTEM
    const text = await ctx.provider.complete(step.prompt(ctx), { system })
    results.push({ taskId: step.key, role: step.role, output: text })
    ctx.log(`✓ [${step.role}] ${step.title} — ${text.length} chars`)
  }
  return results
}

/** Lightweight intent classifier so the host can auto-route a goal. */
export function classifyIntent(goal: string): 'marketing' | 'analytics' | 'both' {
  const g = goal.toLowerCase()
  const analytic = /(data|分析|图表|可视|chart|analy|dashboard|报表|统计|csv|趋势|trend|visuali)/.test(g)
  const market = /(marketing|营销|campaign|内容|社媒|social|seo|品牌|brand|广告|copy|文案|推广)/.test(g)
  if (analytic && market) return 'both'
  if (analytic) return 'analytics'
  return 'marketing'
}
