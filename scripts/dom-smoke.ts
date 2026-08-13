// Headless DOM smoke test for the renderer (no GUI needed).
// Loads the real renderer markup, injects a mock agentApi, then asserts the two
// behaviors that were broken before: settings button opens the modal, and the
// Enter key sends a chat message.
import { JSDOM } from 'jsdom'
import fs from 'node:fs'
import path from 'node:path'

async function main() {
  const htmlPath = path.resolve('out/renderer/index.html')
  let html = fs.readFileSync(htmlPath, 'utf-8')
  html = html.replace(/<script[^>]*src="\.\/src\/main\.ts"[^>]*><\/script>/, '')

  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' })
  const { window } = dom

  const g: any = globalThis
  g.window = window
  g.document = window.document
  g.HTMLElement = window.HTMLElement
  g.HTMLDivElement = window.HTMLDivElement
  g.HTMLButtonElement = window.HTMLButtonElement
  g.HTMLTextAreaElement = window.HTMLTextAreaElement
  g.HTMLSelectElement = window.HTMLSelectElement
  g.HTMLSpanElement = window.HTMLSpanElement
  g.HTMLPreElement = window.HTMLPreElement
  g.Element = window.Element
  g.Node = window.Node
  g.MouseEvent = window.MouseEvent
  g.KeyboardEvent = window.KeyboardEvent
  g.Event = window.Event
  ;(window.HTMLCanvasElement.prototype as any).getContext = () => null

  const calls: any = {
    chat: 0,
    getSettings: 0,
    saveSettings: 0,
    runAgent: 0,
    onLog: 0,
    onChatDelta: 0,
    onChatDone: 0
  }
  ;(window as any).agentApi = {
    runAgent: async () => {
      calls.runAgent++
      return { results: [{ taskId: 'market_research', role: 'market_researcher', output: '# research' }] }
    },
    onLog: () => {
      calls.onLog++
    },
    chat: async (msgs: any[]) => {
      calls.chat++
      return 'mock reply (' + msgs.length + ' msgs)'
    },
    onChatDelta: () => {
      calls.onChatDelta++
    },
    onChatDone: () => {
      calls.onChatDone++
    },
    getSettings: async () => {
      calls.getSettings++
      return { provider: 'demo' }
    },
    saveSettings: async (s: any) => {
      calls.saveSettings++
      return s
    }
  }

  try {
    await import('../src/renderer/src/main.ts')
  } catch (e) {
    console.error('FATAL: failed to import renderer main.ts:', e)
    process.exit(1)
  }

  if (window.document.readyState === 'loading') {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // ---- TEST 1: settings button opens modal ----
  const settingsBtn = window.document.getElementById('settingsBtn')!
  const modal = window.document.getElementById('settingsModal')!
  const hiddenBefore = modal.classList.contains('hidden')
  settingsBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(50)
  const hiddenAfter = modal.classList.contains('hidden')
  console.log('[settings] hidden before:', hiddenBefore, '| after click:', hiddenAfter, '| getSettings called:', calls.getSettings > 0)

  // ---- TEST 2: Enter key sends a message ----
  const chatInput = window.document.getElementById('chatInput') as HTMLTextAreaElement
  const messages = window.document.getElementById('messages')!
  const before = messages.querySelectorAll('.msg').length
  chatInput.value = 'hello test'
  chatInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await sleep(50)
  const after = messages.querySelectorAll('.msg').length
  const userRendered = [...messages.querySelectorAll('.msg.user .bubble')].some((b) =>
    (b.textContent ?? '').includes('hello test')
  )
  console.log('[chat] before:', before, '| after Enter:', after, '| chat called:', calls.chat > 0, '| user rendered:', userRendered)

  // ---- TEST 3: tabs switch ----
  const tasksTab = [...window.document.querySelectorAll('.tab')].find(
    (t) => (t as HTMLElement).dataset.tab === 'tasks'
  )!
  tasksTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  const tasksView = window.document.getElementById('view-tasks')!
  console.log('[tabs] tasks view active after click:', tasksView.classList.contains('active'))

  // ---- TEST 4: quick "generate marketing plan" summons the agent ----
  const quick = window.document.getElementById('quickMarketing')!
  const beforeQuick = messages.querySelectorAll('.msg').length
  quick.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await sleep(50)
  const afterQuick = messages.querySelectorAll('.msg').length
  console.log('[quick] before:', beforeQuick, '| after click:', afterQuick, '| runAgent called:', calls.runAgent > 0)

  const result = {
    settingsOpens: !hiddenAfter && calls.getSettings > 0,
    enterSends: after > before && calls.chat > 0 && userRendered,
    tabSwitches: tasksView.classList.contains('active'),
    quickAgent: afterQuick > beforeQuick && calls.runAgent > 0
  }
  console.log('\nRESULT', JSON.stringify(result))
  const ok = Object.values(result).every(Boolean)
  console.log(ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
}

main()
