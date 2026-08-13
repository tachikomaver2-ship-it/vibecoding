// IPC contract between Electron main (runs agents) and the renderer (UI).
import type { AgentInput, AgentRunResult, AgentType, ChatMessage } from '../agents/index.js'

export const IPC = {
  RUN_AGENT: 'agent:run',
  LOG: 'agent:log',
  DONE: 'agent:done',
  // Chat (conversational window)
  CHAT: 'chat:send',
  CHAT_DELTA: 'chat:delta',
  CHAT_DONE: 'chat:done',
  // Model / provider settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save'
} as const

export interface RunAgentRequest {
  type: AgentType
  input: AgentInput
}

export interface RunAgentResponse {
  results: AgentRunResult[]
}

export interface ChatRequest {
  messages: ChatMessage[]
  /** optional system prompt override */
  system?: string
}

export type ProviderKind = 'demo' | 'openai' | 'anthropic'

export interface Settings {
  provider: ProviderKind
  apiKey?: string
  model?: string
  /** OpenAI-compatible base URL (DeepSeek, Moonshot, local vLLM, ...). */
  baseURL?: string
}
