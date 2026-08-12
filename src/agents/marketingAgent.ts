// Marketing multi-agent.
// Architecture mirrors high-star CrewAI / LangGraph marketing agents:
//   Head of Marketing (research + strategy) -> Content Strategist
//   -> Copywriter (social / ad copy) -> SEO Specialist.
// Each role is a pipeline step executed by the orchestrator.

import { runPipeline, type PipelineStep } from './orchestrator.js'
import type { AgentRunResult, AgentArtifact, RunContext } from './types.js'

function ctxBlock(ctx: RunContext): string {
  const i = ctx.input
  return [
    `Goal: ${i.goal}`,
    i.brand ? `Brand: ${i.brand}` : '',
    i.product ? `Product: ${i.product}` : '',
    i.productDescription ? `Product description: ${i.productDescription}` : '',
    i.industry ? `Industry: ${i.industry}` : '',
    i.audience ? `Target audience: ${i.audience}` : '',
    i.budget ? `Budget: ${i.budget}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

const steps: PipelineStep[] = [
  {
    role: 'market_researcher',
    key: 'market_research',
    title: 'Market & competitor research',
    prompt: (ctx) =>
      `[TASK] Market & Competitor Research\n${ctxBlock(ctx)}\n\n` +
      `Analyze the market: identify 3–5 competitors, key trends, customer needs, ` +
      `and whitespace opportunities. Output a concise research brief with bullet lists.`
  },
  {
    role: 'content_strategist',
    key: 'marketing_strategy',
    title: 'Marketing strategy & content calendar',
    prompt: (ctx) =>
      `[TASK] Marketing Strategy & Content Calendar\n${ctxBlock(ctx)}\n\n` +
      `Based on the research, define messaging, positioning, channel mix, and a ` +
      `2-week content calendar (blogs, reels, social posts, email). Use a markdown table.`
  },
  {
    role: 'copywriter',
    key: 'social_posts',
    title: 'Social & ad copy',
    prompt: (ctx) =>
      `[TASK] Social & Ad Copy\n${ctxBlock(ctx)}\n\n` +
      `Write 3 ready-to-publish posts (LinkedIn, Instagram, Email) plus one ad headline + body. ` +
      `Keep each under 200 words.`
  },
  {
    role: 'seo_specialist',
    key: 'seo',
    title: 'SEO optimization',
    prompt: (ctx) =>
      `[TASK] SEO Optimization\n${ctxBlock(ctx)}\n\n` +
      `Provide 10 target keywords, a meta title/description, and 3 internal-link suggestions ` +
      `for the campaign landing page.`
  }
]

export async function runMarketingAgent(ctx: RunContext): Promise<AgentRunResult[]> {
  const results = await runPipeline(steps, ctx)
  // Attach a markdown artifact per result so the UI can render them as documents.
  for (const r of results) {
    r.artifacts = [
      { type: 'markdown', title: titleFor(r.taskId), content: r.output }
    ] as AgentArtifact[]
  }
  return results
}

function titleFor(key: string): string {
  return (
    {
      market_research: '市场研究报告',
      marketing_strategy: '营销策略与内容日历',
      social_posts: '社媒与广告文案',
      seo: 'SEO 优化方案'
    } as Record<string, string>
  )[key] ?? key
}
