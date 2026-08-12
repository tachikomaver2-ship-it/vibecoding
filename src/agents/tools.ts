// Lightweight, dependency-free tools used by the agents:
//  - minimal CSV parser + summary statistics (for the analytics agent)
//  - chart-spec builder that emits Chart.js v4 config JSON (rendered in the UI)
//  - a web-search stub (real providers can be wired in later)

import { readFile } from 'node:fs/promises'
import type { AgentArtifact } from './types.js'

export interface CsvStats {
  rows: number
  columns: string[]
  numeric: Record<string, { min: number; max: number; mean: number; sum: number }>
  sample: Record<string, string>[]
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = splitLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => (obj[h] = cells[i] ?? ''))
    return obj
  })
  return { headers, rows }
}

function splitLine(line: string): string[] {
  // Handles simple comma separation; good enough for demo / typical exports.
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes
    else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

export function summarizeCsv(text: string): CsvStats {
  const { headers, rows } = parseCsv(text)
  const numeric: CsvStats['numeric'] = {}
  for (const h of headers) {
    const nums = rows
      .map((r) => parseFloat(r[h]))
      .filter((n) => !Number.isNaN(n))
    if (nums.length > 0) {
      const sum = nums.reduce((a, b) => a + b, 0)
      numeric[h] = {
        min: Math.min(...nums),
        max: Math.max(...nums),
        mean: sum / nums.length,
        sum
      }
    }
  }
  return {
    rows: rows.length,
    columns: headers,
    numeric,
    sample: rows.slice(0, 5)
  }
}

/**
 * Build a Chart.js v4 config from a CSV column.
 * Returns a JSON string so it can be carried as an `chart` artifact.
 */
export function buildBarChartCsv(
  text: string,
  labelColumn: string,
  valueColumn: string,
  title: string
): AgentArtifact {
  const { rows } = parseCsv(text)
  const labels = rows.map((r) => r[labelColumn] ?? '')
  const data = rows.map((r) => parseFloat(r[valueColumn]) || 0)
  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: valueColumn, data, backgroundColor: 'rgba(56,128,255,0.6)' }]
    },
    options: { responsive: true, plugins: { title: { display: true, text: title } } }
  }
  return {
    type: 'chart',
    title,
    content: JSON.stringify(config),
    mime: 'application/json'
  }
}

export async function readCsvFromPath(path?: string): Promise<string> {
  if (!path) return ''
  return readFile(path, 'utf-8')
}

export interface WebSearchResult {
  query: string
  results: { title: string; snippet: string }[]
}

/** Stub web search. Replace with Serper / Tavily / Brave in production. */
export async function webSearch(query: string): Promise<WebSearchResult> {
  return {
    query,
    results: [
      { title: `[stub] Top results for "${query}"`, snippet: 'Wire a real search API here.' }
    ]
  }
}
