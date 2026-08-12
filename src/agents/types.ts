// Shared types for the agent system.
// These are pure data structures with no Electron / Node-only dependencies,
// so the agent core can run headless (CLI) or inside the Electron main process.

export type AgentRole =
  | 'supervisor'
  | 'market_researcher'
  | 'content_strategist'
  | 'copywriter'
  | 'seo_specialist'
  | 'data_analyst'
  | 'visualizer'

export interface AgentArtifact {
  type: 'markdown' | 'chart' | 'csv' | 'json'
  title: string
  /** markdown text, or a JSON string for `chart` / `csv` / `json` artifacts */
  content: string
  mime?: string
}

export interface AgentRunResult {
  taskId: string
  role: AgentRole
  output: string
  artifacts?: AgentArtifact[]
  meta?: Record<string, unknown>
}

export interface AgentInput {
  goal: string
  brand?: string
  industry?: string
  audience?: string
  budget?: string
  product?: string
  productDescription?: string
  /** raw CSV text, or a path that analytics agent will read */
  csv?: string
  csvPath?: string
  extra?: Record<string, unknown>
}

export interface LLMProvider {
  name: string
  complete(prompt: string, opts?: { system?: string; json?: boolean }): Promise<string>
}

export interface RunContext {
  input: AgentInput
  provider: LLMProvider
  log: (msg: string) => void
}
