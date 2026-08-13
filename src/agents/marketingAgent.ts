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
    system:
      'You are the Market Research Lead of a marketing agency. Output ONLY a tight, ' +
      'evidence-based research brief. Use markdown with headings and bullet lists. ' +
      'No preamble.',
    prompt: (ctx) =>
      `[TASK] Market & Competitor Research\n${ctxBlock(ctx)}\n\n` +
      `Act as a senior market researcher. Deliver:\n` +
      `1. Target audience profile (needs, pains, trigger moments, where they spend time).\n` +
      `2. 3–5 direct/indirect competitors with one-line positioning each + our differentiation.\n` +
      `3. 3 key market trends relevant to this product.\n` +
      `4. Whitespace opportunities (underserved segments or messages).\n` +
      `5. A single recommended positioning statement.\n` +
      `Keep it concise and scannable.`
  },
  {
    role: 'content_strategist',
    key: 'marketing_strategy',
    title: 'Marketing strategy & content calendar',
    system:
      'You are the Head of Content Strategy. Produce an actionable strategy and a ' +
      'concrete content calendar. Use markdown. Be specific about channels, cadence, and KPIs.',
    prompt: (ctx) =>
      `[TASK] Marketing Strategy & Content Calendar\n${ctxBlock(ctx)}\n\n` +
      `Based on the research above, define:\n` +
      `1. Core messaging pillars (3) and the one north-star value proposition.\n` +
      `2. Channel mix with % budget allocation (e.g. LinkedIn 30%, SEO 25%, ...).\n` +
      `3. Funnel-aligned content plan.\n` +
      `4. A 2-week day-by-day content calendar as a markdown TABLE ` +
      `(Date | Channel | Format | Topic | CTA).\n` +
      `5. 3 KPIs to measure success.`
  },
  {
    role: 'copywriter',
    key: 'social_posts',
    title: 'Social & ad copy',
    system:
      'You are a conversion-focused copywriter. Write publish-ready copy that is punchy, ' +
      'on-brand, and includes a clear CTA. Use markdown.',
    prompt: (ctx) =>
      `[TASK] Social & Ad Copy\n${ctxBlock(ctx)}\n\n` +
      `Write the following, each clearly labeled:\n` +
      `- 1 LinkedIn post (thought-leadership, <180 words)\n` +
      `- 1 Instagram caption (hook + 3 emojis + hashtags)\n` +
      `- 1 Email (subject line + 120-word body + CTA)\n` +
      `- 1 ad: headline (<=30 chars) + 2-line body + CTA\n` +
      `Keep each tight and ready to publish.`
  },
  {
    role: 'seo_specialist',
    key: 'seo',
    title: 'SEO optimization',
    system:
      'You are an SEO specialist. Deliver a practical on-page + keyword plan. Use markdown lists.',
    prompt: (ctx) =>
      `[TASK] SEO Optimization\n${ctxBlock(ctx)}\n\n` +
      `Provide:\n` +
      `1. 10 target keywords (mix of head + long-tail) with search intent.\n` +
      `2. Meta title (<=60 chars) and meta description (<=155 chars) for the landing page.\n` +
      `3. 3 internal-link suggestions and 2 backlink outreach angles.\n` +
      `4. One quick technical SEO win.`
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
