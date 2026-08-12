import Chart from 'chart.js/auto'
import type { AgentInput, AgentRunResult, AgentType } from '../../agents/index.js'
import type { AgentArtifact } from '../../agents/types.js'

// The API exposed by preload/contextBridge.
interface AgentApi {
  runAgent: (type: AgentType, input: AgentInput) => Promise<{ results: AgentRunResult[] }>
  onLog: (cb: (msg: string) => void) => void
}
declare global {
  interface Window {
    agentApi: AgentApi
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const els = {
  type: $<HTMLSelectElement>('agentType'),
  goal: $<HTMLTextAreaElement>('goal'),
  brand: $<HTMLInputElement>('brand'),
  industry: $<HTMLInputElement>('industry'),
  audience: $<HTMLInputElement>('audience'),
  budget: $<HTMLInputElement>('budget'),
  csvFile: $<HTMLInputElement>('csvFile'),
  runBtn: $<HTMLButtonElement>('runBtn'),
  status: $<HTMLDivElement>('status'),
  log: $<HTMLPreElement>('log'),
  results: $<HTMLDivElement>('results')
}

function setStatus(msg: string) {
  els.status.textContent = msg
}

window.agentApi.onLog((msg) => {
  els.log.textContent += msg + '\n'
  els.log.scrollTop = els.log.scrollHeight
})

els.runBtn.addEventListener('click', async () => {
  els.runBtn.disabled = true
  els.log.textContent = ''
  els.results.innerHTML = ''
  setStatus('运行中…')

  let csv: string | undefined
  const file = els.csvFile.files?.[0]
  if (file) {
    csv = await file.text()
  }

  const input: AgentInput = {
    goal: els.goal.value || '为新型 productivity SaaS 制定营销方案',
    brand: els.brand.value || undefined,
    industry: els.industry.value || undefined,
    audience: els.audience.value || undefined,
    budget: els.budget.value || undefined,
    csv
  }

  try {
    const { results } = await window.agentApi.runAgent(els.type.value as AgentType, input)
    renderResults(results)
    setStatus(`完成：${results.length} 个产出`)
  } catch (e: any) {
    setStatus('出错：' + (e?.message ?? e))
  } finally {
    els.runBtn.disabled = false
  }
})

function renderResults(results: AgentRunResult[]) {
  for (const r of results) {
    const card = document.createElement('div')
    card.className = 'result-card'
    const title = document.createElement('h3')
    title.textContent = r.taskId
    card.appendChild(title)

    const artifacts = r.artifacts ?? []
    if (artifacts.length === 0) {
      card.appendChild(docBlock(r.output))
    }
    for (const a of artifacts) {
      card.appendChild(renderArtifact(a))
    }
    els.results.appendChild(card)
  }
}

function docBlock(text: string): HTMLElement {
  const div = document.createElement('div')
  div.className = 'doc'
  div.innerHTML = renderMarkdown(text)
  return div
}

function renderArtifact(a: AgentArtifact): HTMLElement {
  if (a.type === 'markdown') return docBlock(a.content)
  if (a.type === 'chart') {
    const wrap = document.createElement('div')
    wrap.className = 'chart-wrap'
    const canvas = document.createElement('canvas')
    wrap.appendChild(canvas)
    setTimeout(() => {
      try {
        const cfg = JSON.parse(a.content)
        new Chart(canvas, cfg)
      } catch (e) {
        wrap.textContent = '图表解析失败: ' + (e as Error).message
      }
    }, 0)
    return wrap
  }
  // json / csv
  const pre = document.createElement('pre')
  pre.textContent = a.content
  return pre
}

// ---- Minimal markdown -> HTML (no external dependency) ----
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split('\n')
  let html = ''
  let inCode = false
  let listBuf: string[] = []

  const flushList = () => {
    if (listBuf.length) {
      html += '<ul>' + listBuf.map((i) => `<li>${i}</li>`).join('') + '</ul>'
      listBuf = []
    }
  }

  for (const raw of lines) {
    const line = raw
    if (line.startsWith('```')) {
      if (!inCode) {
        flushList()
        html += '<pre>'
        inCode = true
      } else {
        html += '</pre>'
        inCode = false
      }
      continue
    }
    if (inCode) {
      html += line + '\n'
      continue
    }
    if (/^###\s+/.test(line)) {
      flushList()
      html += `<h4>${line.replace(/^###\s+/, '')}</h4>`
    } else if (/^##\s+/.test(line)) {
      flushList()
      html += `<h3>${line.replace(/^##\s+/, '')}</h3>`
    } else if (/^#\s+/.test(line)) {
      flushList()
      html += `<h2>${line.replace(/^#\s+/, '')}</h2>`
    } else if (/^>\s?/.test(line)) {
      flushList()
      html += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`
    } else if (/^[-*]\s+/.test(line)) {
      listBuf.push(inline(line.replace(/^[-*]\s+/, '')))
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      html += `<p>${inline(line)}</p>`
    }
  }
  flushList()
  if (inCode) html += '</pre>'
  return html
}

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}
