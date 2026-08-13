import Chart from 'chart.js/auto'
import type {
  AgentInput,
  AgentRunResult,
  AgentType,
  ChatMessage
} from '../../agents/index.js'
import type { Settings } from '../../shared/protocol.js'
import type { AgentArtifact } from '../../agents/types.js'

// The API exposed by preload/contextBridge.
interface AgentApi {
  runAgent: (type: AgentType, input: AgentInput) => Promise<{ results: AgentRunResult[] }>
  onLog: (cb: (msg: string) => void) => void
  chat: (messages: ChatMessage[], system?: string) => Promise<string>
  onChatDelta: (cb: (delta: string) => void) => void
  onChatDone: (cb: (full: string) => void) => void
  getSettings: () => Promise<Settings>
  saveSettings: (s: Settings) => Promise<Settings>
}
declare global {
  interface Window {
    agentApi: AgentApi
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'))
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'))
    tab.classList.add('active')
    const name = tab.dataset.tab!
    document.querySelectorAll<HTMLElement>('.view').forEach((v) => {
      v.classList.toggle('active', v.id === `view-${name}`)
    })
  })
})

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const settingsModal = $<HTMLDivElement>('settingsModal')
const providerBadge = $<HTMLSpanElement>('providerBadge')

function applyBadge(s: Settings) {
  const map: Record<string, [string, string]> = {
    demo: ['Demo', 'badge-demo'],
    openai: ['OpenAI', 'badge-openai'],
    anthropic: ['Anthropic', 'badge-anthropic']
  }
  const [label, cls] = map[s.provider] ?? map.demo
  providerBadge.textContent = label
  providerBadge.className = `badge ${cls}`
}

$<HTMLButtonElement>('settingsBtn').addEventListener('click', async () => {
  const s = await window.agentApi.getSettings()
  ;($<HTMLSelectElement>('setProvider')).value = s.provider
  ;($<HTMLInputElement>('setApiKey')).value = s.apiKey ?? ''
  ;($<HTMLInputElement>('setModel')).value = s.model ?? ''
  ;($<HTMLInputElement>('setBaseURL')).value = s.baseURL ?? ''
  settingsModal.classList.remove('hidden')
})
$<HTMLButtonElement>('closeSettings').addEventListener('click', () =>
  settingsModal.classList.add('hidden')
)
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden')
})
$<HTMLButtonElement>('saveSettings').addEventListener('click', async () => {
  const s: Settings = {
    provider: $<HTMLSelectElement>('setProvider').value as Settings['provider'],
    apiKey: $<HTMLInputElement>('setApiKey').value.trim() || undefined,
    model: $<HTMLInputElement>('setModel').value.trim() || undefined,
    baseURL: $<HTMLInputElement>('setBaseURL').value.trim() || undefined
  }
  const saved = await window.agentApi.saveSettings(s)
  applyBadge(saved)
  $<HTMLSpanElement>('settingsStatus').textContent = '✅ 已保存'
  setTimeout(() => settingsModal.classList.add('hidden'), 500)
})

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const messagesEl = $<HTMLDivElement>('messages')
const chatInput = $<HTMLTextAreaElement>('chatInput')
const sendBtn = $<HTMLButtonElement>('sendBtn')

const messages: ChatMessage[] = []
let streaming = false

window.agentApi.onChatDelta((delta) => {
  const live = messagesEl.querySelector<HTMLElement>('.msg.assistant.live .bubble')
  if (live) live.innerHTML = renderMarkdown((live.dataset.raw ?? '') + delta)
})

window.agentApi.onChatDone(() => {
  const live = messagesEl.querySelector<HTMLElement>('.msg.assistant.live')
  if (live) live.classList.remove('live')
  streaming = false
  sendBtn.disabled = false
  chatInput.disabled = false
})

function addMessage(role: 'user' | 'assistant', text: string, stream = false) {
  const wrap = document.createElement('div')
  wrap.className = `msg ${role}${stream ? ' live' : ''}`
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  if (stream) {
    bubble.dataset.raw = ''
    bubble.innerHTML = ''
  } else {
    bubble.innerHTML = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text)
  }
  wrap.appendChild(bubble)
  messagesEl.appendChild(wrap)
  messagesEl.scrollTop = messagesEl.scrollHeight
  return wrap
}

async function sendMessage() {
  const text = chatInput.value.trim()
  if (!text || streaming) return
  chatInput.value = ''
  addMessage('user', text)
  messages.push({ role: 'user', content: text })

  streaming = true
  sendBtn.disabled = true
  chatInput.disabled = true
  const live = addMessage('assistant', '', true)
  const bubble = live.querySelector<HTMLElement>('.bubble')!

  try {
    const full = await window.agentApi.chat(messages)
    // onChatDone already finalizes; ensure final text is captured
    bubble.dataset.raw = full
  } catch (e: any) {
    bubble.innerHTML = `<span class="err">出错了：${escapeHtml(e?.message ?? e)}</span>`
    streaming = false
    sendBtn.disabled = false
    chatInput.disabled = false
  }
}

sendBtn.addEventListener('click', sendMessage)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
})

// ---------------------------------------------------------------------------
// Tasks (existing agent runner)
// ---------------------------------------------------------------------------
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

window.agentApi.onLog((msg) => {
  els.log.textContent += msg + '\n'
  els.log.scrollTop = els.log.scrollHeight
})

els.runBtn.addEventListener('click', async () => {
  els.runBtn.disabled = true
  els.log.textContent = ''
  els.results.innerHTML = ''
  els.status.textContent = '运行中…'

  let csv: string | undefined
  const file = els.csvFile.files?.[0]
  if (file) csv = await file.text()

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
    els.status.textContent = `完成：${results.length} 个产出`
  } catch (e: any) {
    els.status.textContent = '出错：' + (e?.message ?? e)
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
    if (artifacts.length === 0) card.appendChild(docBlock(r.output))
    for (const a of artifacts) card.appendChild(renderArtifact(a))
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
  const pre = document.createElement('pre')
  pre.textContent = a.content
  return pre
}

// ---- Minimal markdown -> HTML (no external dependency) ----
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
;(async () => {
  const s = await window.agentApi.getSettings()
  applyBadge(s)
})()
