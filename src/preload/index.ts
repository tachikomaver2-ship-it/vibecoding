import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/protocol.js'
import type {
  AgentInput,
  AgentRunResult,
  AgentType,
  ChatMessage
} from '../agents/index.js'
import type { Settings } from '../shared/protocol.js'

export interface AgentApi {
  runAgent: (
    type: AgentType,
    input: AgentInput
  ) => Promise<{ results: AgentRunResult[] }>
  onLog: (cb: (msg: string) => void) => void

  // Chat
  chat: (messages: ChatMessage[], system?: string) => Promise<string>
  onChatDelta: (cb: (delta: string) => void) => void
  onChatDone: (cb: (full: string) => void) => void

  // Settings
  getSettings: () => Promise<Settings>
  saveSettings: (s: Settings) => Promise<Settings>
}

const api: AgentApi = {
  runAgent: (type, input) => ipcRenderer.invoke(IPC.RUN_AGENT, { type, input }),
  onLog: (cb) => {
    ipcRenderer.removeAllListeners(IPC.LOG)
    ipcRenderer.on(IPC.LOG, (_e, msg: string) => cb(msg))
  },

  chat: (messages, system) => ipcRenderer.invoke(IPC.CHAT, { messages, system }),
  onChatDelta: (cb) => {
    ipcRenderer.removeAllListeners(IPC.CHAT_DELTA)
    ipcRenderer.on(IPC.CHAT_DELTA, (_e, d: string) => cb(d))
  },
  onChatDone: (cb) => {
    ipcRenderer.removeAllListeners(IPC.CHAT_DONE)
    ipcRenderer.on(IPC.CHAT_DONE, (_e, full: string) => cb(full))
  },

  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (s) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, s)
}

contextBridge.exposeInMainWorld('agentApi', api)
