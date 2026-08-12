// Data-analysis & visualization agent.
// Loads a CSV (provided text or file path), computes summary statistics,
// writes a markdown analysis report, and emits Chart.js chart artifacts
// that the Electron renderer renders interactively.

import { runPipeline, type PipelineStep } from './orchestrator.js'
import { summarizeCsv, buildBarChartCsv, readCsvFromPath } from './tools.js'
import type { AgentRunResult, AgentArtifact, RunContext } from './types.js'

const steps: PipelineStep[] = [
  {
    role: 'data_analyst',
    key: 'data_summary',
    title: 'Data summary & insights',
    prompt: (ctx) =>
      `[TASK] Data Analysis\nGoal: ${ctx.input.goal}\n\n` +
      `Given the dataset statistics provided in context, write a concise analysis: ` +
      `headline metrics, notable trends, and 3 recommended actions. Use markdown.`,
    // The actual numbers are injected by the analytics runner below.
  }
]

export async function runAnalyticsAgent(ctx: RunContext): Promise<AgentRunResult[]> {
  const csvText = ctx.input.csv ?? (await readCsvFromPath(ctx.input.csvPath))
  if (!csvText) {
    throw new Error('Analytics agent requires `csv` text or a `csvPath`.')
  }

  const stats = summarizeCsv(csvText)

  // Inject the real numbers into the analyst prompt context.
  const analystStep: PipelineStep = {
    ...steps[0],
    prompt: (c) =>
      `[TASK] Data Analysis\nGoal: ${c.input.goal}\n\n` +
      `Dataset: ${stats.rows} rows, columns: ${stats.columns.join(', ')}.\n` +
      `Numeric summaries:\n` +
      Object.entries(stats.numeric)
        .map(([k, v]) => `- ${k}: min=${v.min}, max=${v.max}, mean=${v.mean.toFixed(2)}, sum=${v.sum}`)
        .join('\n') +
      `\n\nWrite a concise analysis with headline metrics, trends, and 3 recommended actions.`
  }

  const results = await runPipeline([analystStep], ctx)

  // Build chart artifacts from the first two numeric columns (demo heuristic).
  const numericCols = Object.keys(stats.numeric)
  const artifacts: AgentArtifact[] = []
  if (numericCols.length >= 1 && stats.columns.length >= 2) {
    const labelCol = stats.columns[0]
    const valueCol = numericCols[0]
    artifacts.push(
      buildBarChartCsv(csvText, labelCol, valueCol, `Distribution of ${valueCol} by ${labelCol}`)
    )
  }

  results.push({
    taskId: 'charts',
    role: 'visualizer',
    output: `Generated ${artifacts.length} chart(s).`,
    artifacts
  })

  // Also surface the raw stats as a JSON artifact for transparency.
  results[0].artifacts = [
    { type: 'markdown', title: '数据分析报告', content: results[0].output },
    {
      type: 'json',
      title: '数据集统计',
      content: JSON.stringify(stats, null, 2),
      mime: 'application/json'
    },
    ...artifacts
  ]

  return results
}
