import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/protocol.js'
import type { AgentInput, AgentRunResult, AgentType } from '../agents/index.js'

export interface AgentApi {
  runAgent: (
    type: AgentType,
    input: AgentInput
  ) => Promise<{ results: AgentRunResult[] }>
  onLog: (cb: (msg: string) => void) => void
}

const api: AgentApi = {
  runAgent: (type, input) => ipcRenderer.invoke(IPC.RUN_AGENT, { type, input }),
  onLog: (cb) => {
    ipcRenderer.removeAllListeners(IPC.LOG)
    ipcRenderer.on(IPC.LOG, (_e, msg: string) => cb(msg))
  }
}

contextBridge.exposeInMainWorld('agentApi', api)
