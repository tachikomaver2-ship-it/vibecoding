import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { runAgent } from '../agents/index.js'
import { getProvider } from '../agents/llmProvider.js'
import { IPC } from '../shared/protocol.js'
import { loadSettings, saveSettings } from './settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const isDev = !app.isPackaged

// Persona used for the conversational chat window — keeps the assistant in the
// "marketing team" lane (mirrors the role framing of high-star marketing agents).
const CHAT_SYSTEM_PROMPT =
  'You are "AI Marketing Team", a senior marketing copilot. ' +
  'You help with growth, paid/organic acquisition, content strategy, copywriting, ' +
  'SEO, positioning, and campaign planning. ' +
  'Be concise and concrete: lead with the recommendation, then the reasoning. ' +
  'Use short markdown (headings, bullets, tables) and include 1–2 actionable next steps. ' +
  'If the user asks to "generate a plan / 方案 / 营销方案", summarize what a full ' +
  'multi-agent run would produce and suggest using the 📋 生成营销方案 button. ' +
  'Respond in the user’s language (Chinese if they write in Chinese).'

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/index.js')
  if (isDev) {
    console.log('[main] preload path:', preloadPath)
    try {
      fs.accessSync(preloadPath)
    } catch {
      console.error('[main] ⚠️ preload script NOT FOUND at', preloadPath)
    }
  }
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: '#0f1220',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // ---- Agent task runner (uses the configured provider) ----
  ipcMain.handle(IPC.RUN_AGENT, async (event, req) => {
    const log = (msg: string) => event.sender.send(IPC.LOG, msg)
    const results = await runAgent(req.type, req.input, log, loadSettings())
    return { results }
  })

  // ---- Chat (conversational window) with streaming deltas ----
  ipcMain.handle(IPC.CHAT, async (event, req) => {
    const settings = loadSettings()
    const provider = getProvider(settings)
    const system = req.system || CHAT_SYSTEM_PROMPT
    let full = ''
    try {
      full = await provider.chat(req.messages, {
        system,
        onDelta: (d) => event.sender.send(IPC.CHAT_DELTA, d)
      })
    } catch (e: any) {
      const errMsg = `\n\n> ⚠️ 模型调用失败：${e?.message ?? e}\n> 请检查 ⚙️ 设置中的 API Key / baseURL / 网络。`
      event.sender.send(IPC.CHAT_DELTA, errMsg)
      full += errMsg
    }
    event.sender.send(IPC.CHAT_DONE, full)
    return full
  })

  // ---- Settings persistence ----
  ipcMain.handle(IPC.SETTINGS_GET, () => loadSettings())
  ipcMain.handle(IPC.SETTINGS_SAVE, (_e, s) => saveSettings(s))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
