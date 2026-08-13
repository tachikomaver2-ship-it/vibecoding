// Persists model/provider settings to <userData>/settings.json.
// No extra dependency — just fs. Safe to call after app.ready().
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../shared/protocol.js'

const DEFAULTS: Settings = { provider: 'demo' }

export function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8')
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): Settings {
  const merged: Settings = { ...DEFAULTS, ...s, provider: s.provider || 'demo' }
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
  } catch (e) {
    console.warn('[settings] failed to save:', e)
  }
  return merged
}
