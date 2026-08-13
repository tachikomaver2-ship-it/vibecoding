import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { runAgent } from '../agents/index.js'
import { getProvider } from '../agents/llmProvider.js'
import { IPC } from '../shared/protocol.js'
import { loadSettings, saveSettings } from './settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    backgroundColor: '#0f1220',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
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
    let full = ''
    try {
      full = await provider.chat(req.messages, {
        system: req.system,
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
