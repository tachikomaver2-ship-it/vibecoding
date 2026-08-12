// IPC contract between Electron main (runs agents) and the renderer (UI).
import type { AgentInput, AgentRunResult, AgentType } from '../agents/index.js'

export const IPC = {
  RUN_AGENT: 'agent:run',
  LOG: 'agent:log',
  DONE: 'agent:done'
} as const

export interface RunAgentRequest {
  type: AgentType
  input: AgentInput
}

export interface RunAgentResponse {
  results: AgentRunResult[]
}
