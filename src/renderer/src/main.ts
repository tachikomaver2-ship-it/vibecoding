import Chart from 'chart.js/auto'
import type {
  AgentInput,
  AgentRunResult,
  AgentType,
  ChatMessage
} from '../../agents/index.js'
import type { Settings } from '../../shared/protocol.js'
import type { AgentArtifact } from '../../agents/types.js'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null

// ---------------------------------------------------------------------------
// Safe access to the API exposed by preload/contextBridge.
// If the preload script failed to load, every UI interaction must still work
// (tabs, opening settings, typing) — only the network-bound actions error out
// with a clear message instead of silently breaking the whole module.
// ---------------------------------------------------------------------------
function getApi(): AgentApi | null {
  return (window as unknown as { agentApi?: AgentApi }).agentApi ?? null
}

interface AgentApi {
  runAgent: (type: AgentType, input: AgentInput) => Promise<{ results: AgentRunResult[] }>
  onLog: (cb: (msg: string) => void) => void
  chat: (messages: ChatMessage[], system?: string) => Promise<string>
  onChatDelta: (cb: (delta: string) => void) => void
  onChatDone: (cb: (full: string) => void) => void
  getSettings: () => Promise<Settings>
  saveSettings: (s: Settings) => Promise<Settings>
}

// ---------------------------------------------------------------------------
// Markdown rendering (no external dependency)
// ---------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
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

function scrollBottom(el: HTMLElement) {
  el.scrollTop = el.scrollHeight
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function boot() {
  // Surface a clear banner if the preload API never attached, instead of failing
  // silently (this is exactly what made "settings" and "Enter-to-send" appear dead).
  if (!getApi()) {
    const warn = document.createElement('div')
    warn.className = 'api-warn'
    warn.textContent =
      '⚠️ 模型接口未加载（preload 未就绪）。对话与 Agent 功能暂不可用。请重启应用；' +
      '若仍无效，请在本机重新执行 npm install 并确保 Electron 完整安装。'
    document.body.prepend(warn)
  }

  // ===== Tabs (registered first — must always work) =====
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

  // ===== Settings =====
  const settingsModal = $<HTMLDivElement>('settingsModal')
  const providerBadge = $<HTMLSpanElement>('providerBadge')
  const settingsStatus = $<HTMLSpanElement>('settingsStatus')

  function applyBadge(s: Settings) {
    const map: Record<string, [string, string]> = {
      demo: ['Demo', 'badge-demo'],
      openai: ['OpenAI', 'badge-openai'],
      anthropic: ['Anthropic', 'badge-anthropic']
    }
    const [label, cls] = map[s.provider] ?? map.demo
    if (providerBadge) {
      providerBadge.textContent = label
      providerBadge.className = `badge ${cls}`
    }
  }

  $<HTMLButtonElement>('settingsBtn')?.addEventListener('click', async () => {
    const api = getApi()
    if (!api) {
      window.alert('模型接口尚未就绪（agentApi 未加载）。请确认应用已正常启动后重启。')
      return
    }
    try {
      const s = await api.getSettings()
      const setProvider = $<HTMLSelectElement>('setProvider')
      const setApiKey = $<HTMLInputElement>('setApiKey')
      const setModel = $<HTMLInputElement>('setModel')
      const setBaseURL = $<HTMLInputElement>('setBaseURL')
      if (setProvider) setProvider.value = s.provider
      if (setApiKey) setApiKey.value = s.apiKey ?? ''
      if (setModel) setModel.value = s.model ?? ''
      if (setBaseURL) setBaseURL.value = s.baseURL ?? ''
      settingsModal?.classList.remove('hidden')
    } catch (e: any) {
      window.alert('读取设置失败：' + (e?.message ?? e))
    }
  })

  $<HTMLButtonElement>('closeSettings')?.addEventListener('click', () =>
    settingsModal?.classList.add('hidden')
  )
  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.classList.add('hidden')
  })

  $<HTMLButtonElement>('saveSettings')?.addEventListener('click', async () => {
    const api = getApi()
    if (!api || !settingsStatus) return
    const s: Settings = {
      provider: ($<HTMLSelectElement>('setProvider')?.value ?? 'demo') as Settings['provider'],
      apiKey: $<HTMLInputElement>('setApiKey')?.value.trim() || undefined,
      model: $<HTMLInputElement>('setModel')?.value.trim() || undefined,
      baseURL: $<HTMLInputElement>('setBaseURL')?.value.trim() || undefined
    }
    try {
      const saved = await api.saveSettings(s)
      applyBadge(saved)
      settingsStatus.textContent = '✅ 已保存'
      setTimeout(() => {
        settingsModal?.classList.add('hidden')
        settingsStatus.textContent = ''
      }, 600)
    } catch (e: any) {
      settingsStatus.textContent = '❌ 保存失败：' + (e?.message ?? e)
    }
  })

  // ===== Chat =====
  const messagesEl = $<HTMLDivElement>('messages')
  const chatInput = $<HTMLTextAreaElement>('chatInput')
  const sendBtn = $<HTMLButtonElement>('sendBtn')
  const chatStatus = $<HTMLSpanElement>('chatStatus')

  const messages: ChatMessage[] = []
  let streaming = false

  function addMessage(role: 'user' | 'assistant', text: string, stream = false): HTMLElement | null {
    if (!messagesEl) return null
    const wrap = document.createElement('div')
    wrap.className = `msg ${role}${stream ? ' live' : ''}`
    const bubble = document.createElement('div')
    bubble.className = 'bubble'
    if (stream) {
      bubble.dataset.raw = ''
      bubble.innerHTML = '<span class="typing">思考中…</span>'
    } else {
      bubble.innerHTML = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text)
    }
    wrap.appendChild(bubble)
    messagesEl.appendChild(wrap)
    scrollBottom(messagesEl)
    return wrap
  }

  async function sendMessage() {
    if (!chatInput) return
    const text = chatInput.value.trim()
    if (!text || streaming) return
    const api = getApi()
    chatInput.value = ''
    addMessage('user', text)
    messages.push({ role: 'user', content: text })

    if (!api) {
      addMessage('assistant', '⚠️ 模型接口未就绪（agentApi 缺失）。请确认应用已正常加载后重启。')
      return
    }

    streaming = true
    if (sendBtn) sendBtn.disabled = true
    if (chatInput) chatInput.disabled = true
    if (chatStatus) chatStatus.textContent = 'AI 正在输入…'

    const live = addMessage('assistant', '', true)
    const bubble = live?.querySelector<HTMLElement>('.bubble')
    let full = ''
    try {
      full = await api.chat(messages)
      if (bubble) {
        bubble.dataset.raw = full
        bubble.innerHTML = renderMarkdown(full)
      }
    } catch (e: any) {
      if (bubble) bubble.innerHTML = `<span class="err">出错了：${escapeHtml(e?.message ?? e)}</span>`
    } finally {
      live?.classList.remove('live')
      streaming = false
      if (sendBtn) sendBtn.disabled = false
      if (chatInput) chatInput.disabled = false
      if (chatStatus) chatStatus.textContent = ''
      if (messagesEl) scrollBottom(messagesEl)
    }
  }

  sendBtn?.addEventListener('click', sendMessage)
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

  // ===== Quick actions: summon the marketing / analytics team from the chat =====
  async function runAgentInChat(type: AgentType, input: AgentInput, label: string) {
    const api = getApi()
    if (!api || !messagesEl) {
      addMessage('assistant', '⚠️ 接口未就绪，无法运行 Agent。')
      return
    }
    addMessage('user', `▶ ${label}：${input.goal}`)
    if (chatStatus) chatStatus.textContent = `${label} 运行中…`
    const live = addMessage('assistant', '', true)
    const bubble = live?.querySelector<HTMLElement>('.bubble')
    try {
      const { results } = await api.runAgent(type, input)
      const md = results
        .map((r) => `### ${titleFor(r.taskId)}\n\n${r.output}`)
        .join('\n\n---\n\n')
      const finalText = md || '(无产出)'
      if (bubble) {
        bubble.dataset.raw = finalText
        bubble.innerHTML = renderMarkdown(finalText)
      }
      messages.push({ role: 'assistant', content: finalText })
    } catch (e: any) {
      if (bubble) bubble.innerHTML = `<span class="err">运行失败：${escapeHtml(e?.message ?? e)}</span>`
    } finally {
      live?.classList.remove('live')
      if (chatStatus) chatStatus.textContent = ''
      if (messagesEl) scrollBottom(messagesEl)
    }
  }

  function titleFor(key: string): string {
    return (
      {
        market_research: '🔍 市场研究报告',
        marketing_strategy: '🧭 营销策略与内容日历',
        social_posts: '✍️ 社媒与广告文案',
        seo: '🔎 SEO 优化方案',
        data_summary: '📈 数据分析报告',
        charts: '📊 可视化图表',
        market_analysis: '📊 市场分析'
      } as Record<string, string>
    )[key] ?? key
  }

  $<HTMLButtonElement>('quickMarketing')?.addEventListener('click', () => {
    const goal = chatInput?.value.trim() || '为我们的新产品制定一套完整的社交媒体营销方案'
    runAgentInChat(
      'marketing',
      { goal, brand: '我们的品牌', industry: '消费科技', audience: '年轻职场人群' },
      '营销团队'
    )
  })

  $<HTMLButtonElement>('quickAnalytics')?.addEventListener('click', () => {
    // Analytics needs a CSV — guide the user to the Tasks tab where upload lives.
    addMessage(
      'assistant',
      '📊 数据分析 Agent 需要一份 CSV 数据。请切到 **🛠 任务 Agent** 标签页，上传 CSV 文件并选择「数据分析 / 可视化 Agent」运行，产出会自动带可视化图表。'
    )
    const tasksTab = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab')).find(
      (t) => t.dataset.tab === 'tasks'
    )
    tasksTab?.click()
  })

  // ===== Tasks (existing agent runner) —— guarded =====
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

  let logHandlerBound = false
  els.runBtn?.addEventListener('click', async () => {
    const api = getApi()
    if (!api) {
      if (els.status) els.status.textContent = '⚠️ 模型接口未就绪，无法运行 Agent。'
      return
    }
    if (els.runBtn) els.runBtn.disabled = true
    if (els.log) els.log.textContent = ''
    if (els.results) els.results.innerHTML = ''
    if (els.status) els.status.textContent = '运行中…'

    if (!logHandlerBound) {
      api.onLog((msg) => {
        if (els.log) {
          els.log.textContent += msg + '\n'
          scrollBottom(els.log)
        }
      })
      logHandlerBound = true
    }

    let csv: string | undefined
    const file = els.csvFile?.files?.[0]
    if (file) csv = await file.text()

    const input: AgentInput = {
      goal: els.goal?.value || '为新型 productivity SaaS 制定营销方案',
      brand: els.brand?.value || undefined,
      industry: els.industry?.value || undefined,
      audience: els.audience?.value || undefined,
      budget: els.budget?.value || undefined,
      csv
    }

    try {
      const { results } = await api.runAgent((els.type?.value ?? 'auto') as AgentType, input)
      renderResults(results)
      if (els.status) els.status.textContent = `完成：${results.length} 个产出`
    } catch (e: any) {
      if (els.status) els.status.textContent = '出错：' + (e?.message ?? e)
    } finally {
      if (els.runBtn) els.runBtn.disabled = false
    }
  })

  function renderResults(results: AgentRunResult[]) {
    if (!els.results) return
    for (const r of results) {
      const card = document.createElement('div')
      card.className = 'result-card'
      const title = document.createElement('h3')
      title.textContent = `${titleFor(r.taskId)} · ${r.role}`
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

  // ===== Register IPC streaming listeners (safe even if api missing) =====
  const api = getApi()
  if (api) {
    api.onChatDelta((delta) => {
      const live = messagesEl?.querySelector<HTMLElement>('.msg.assistant.live .bubble')
      if (live) {
        const raw = (live.dataset.raw ?? '') + delta
        live.dataset.raw = raw
        live.innerHTML = renderMarkdown(raw)
        if (messagesEl) scrollBottom(messagesEl)
      }
    })
    api.onChatDone((full) => {
      const live = messagesEl?.querySelector<HTMLElement>('.msg.assistant.live')
      const bubble = live?.querySelector<HTMLElement>('.bubble')
      if (bubble && bubble.dataset.raw === undefined) bubble.innerHTML = renderMarkdown(full)
      live?.classList.remove('live')
    })
  } else {
    console.warn('[renderer] agentApi not available — chat/agent actions will be limited.')
  }

  // ===== Boot: reflect current provider badge =====
  ;(async () => {
    const a = getApi()
    if (a) {
      try {
        applyBadge(await a.getSettings())
      } catch {
        /* ignore */
      }
    }
  })()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot)
} else {
  boot()
}
