// Public surface of the agent system.
import { runMarketingAgent } from './marketingAgent.js'
import { runAnalyticsAgent } from './analyticsAgent.js'
import { classifyIntent } from './orchestrator.js'
import { getProvider, type LLMConfig } from './llmProvider.js'
import type { AgentInput, AgentRunResult, RunContext } from './types.js'

export { runMarketingAgent, runAnalyticsAgent, classifyIntent, getProvider }
export * from './types.js'
export type { LLMConfig }

export type AgentType = 'marketing' | 'analytics' | 'auto'

export async function runAgent(
  type: AgentType,
  input: AgentInput,
  log: (msg: string) => void,
  providerConfig?: LLMConfig
): Promise<AgentRunResult[]> {
  const provider = getProvider(providerConfig)
  const ctx: RunContext = { input, provider, log }
  const resolved = type === 'auto' ? classifyIntent(input.goal) : type
  if (resolved === 'analytics') return runAnalyticsAgent(ctx)
  if (resolved === 'both') {
    const m = await runMarketingAgent(ctx)
    const a = await runAnalyticsAgent(ctx)
    return [...m, ...a]
  }
  return runMarketingAgent(ctx)
}
