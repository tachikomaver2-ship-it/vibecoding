// Headless runner for the agents — no Electron / GUI required.
// Usage:
//   npm run agent:run -- --type marketing --goal "..." --brand "Acme"
//   npm run agent:run -- --type analytics --csvPath ./data/sample_campaign.csv
//
// Defaults to the demo LLM provider (no API key). Set AGENT_LLM=openai and
// OPENAI_API_KEY to use a real model.

import { runAgent, type AgentType, type AgentInput } from '../src/agents/index.js'

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      out[key] = val
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const type = (args.type || 'auto') as AgentType
  const input: AgentInput = {
    goal: args.goal || 'Launch a marketing campaign for a new productivity SaaS',
    brand: args.brand,
    industry: args.industry,
    audience: args.audience,
    budget: args.budget,
    product: args.product,
    productDescription: args.productDescription,
    csvPath: args.csvPath,
    csv: args.csv
  }

  console.log(`\n=== Running agent (type=${type}, llm=${process.env.AGENT_LLM || 'demo'}) ===\n`)
  const results = await runAgent(type, input, (m) => console.log(m))

  console.log('\n=== RESULTS ===\n')
  for (const r of results) {
    console.log(`\n--- ${r.taskId} (${r.role}) ---\n`)
    console.log(r.output)
    if (r.artifacts) {
      for (const a of r.artifacts) {
        if (a.type !== 'markdown') {
          console.log(`\n[artifact:${a.type}] ${a.title} (${a.content.length} chars)`)
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
