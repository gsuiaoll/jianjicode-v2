/**
 * localStorage-based chat session persistence.
 *
 * Keys:
 *   jianjicode:sessions         → StoredSession[]   (session list metadata)
 *   jianjicode:session:{id}     → SessionPayload     (one session's messages)
 *   jianjicode:store-version    → number             (global format version)
 */

import { logger } from './logger'

const STORE_VERSION = 1
const VERSION_KEY = 'jianjicode:store-version'
const SESSIONS_KEY = 'jianjicode:sessions'
const SESSION_PREFIX = 'jianjicode:session:'
const MAX_SESSIONS = 50
const SAVE_DEBOUNCE_MS = 300

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredSession {
  id: string
  title: string
  createdAt: number
  lastActive: number
  messageCount: number
  searchText: string
  projectId?: string
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  msgType: string
  toolCalls?: string[]
  timestamp: number
  finished: boolean
  reasoning?: string
  toolName?: string
  toolStatus?: string
  toolMessage?: string
  phase?: string | null
  toolPhaseName?: string
  stepNumber?: number
  statusText?: string
  toolInputParams?: Record<string, unknown>
  toolOutputResult?: unknown
  toolErrorMessage?: string
}

interface SessionPayload {
  version: number
  messages: StoredMessage[]
}

// ---------------------------------------------------------------------------
// Debounced writes
// ---------------------------------------------------------------------------

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()

function flushSave(id: string, messages: StoredMessage[], projectId?: string): void {
  const raw: SessionPayload = { version: STORE_VERSION, messages }
  try {
    localStorage.setItem(SESSION_PREFIX + id, JSON.stringify(raw))
  } catch (e) {
    logger.error(`[chat-store] Failed to save session ${id}: ${e}`)
  }
  upsertSessionMeta(id, messages, projectId)
}

function scheduleSave(id: string, messages: StoredMessage[], projectId?: string): void {
  const existing = pendingSaves.get(id)
  if (existing) clearTimeout(existing)
  pendingSaves.set(id, setTimeout(() => {
    pendingSaves.delete(id)
    flushSave(id, messages, projectId)
  }, SAVE_DEBOUNCE_MS))
}

// ---------------------------------------------------------------------------
// Session metadata helpers
// ---------------------------------------------------------------------------

function readSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
  } catch (e) {
    logger.error(`[chat-store] Failed to read sessions: ${e}`)
  }
  return []
}

function writeSessions(sessions: StoredSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  } catch (e) {
    logger.error(`[chat-store] Failed to write sessions: ${e}`)
  }
}

function buildSearchText(messages: StoredMessage[]): string {
  return messages
    .map(m => typeof m.content === 'string' ? m.content : '')
    .filter(Boolean)
    .join(' ')
    .slice(0, 2000)
    .toLowerCase()
}

function upsertSessionMeta(id: string, messages: StoredMessage[], projectId?: string): void {
  const sessions = readSessions()
  const idx = sessions.findIndex(s => s.id === id)
  const firstUser = messages.find(m => m.role === 'user')
  const title = firstUser ? firstUser.content.slice(0, 60) : id.slice(0, 8)
  const existingProjectId = (idx >= 0) ? sessions[idx].projectId : undefined

  const entry: StoredSession = {
    id,
    title,
    createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
    lastActive: Date.now(),
    messageCount: messages.length,
    searchText: buildSearchText(messages),
    projectId: projectId ?? existingProjectId,
  }

  if (idx >= 0) {
    sessions[idx] = entry
  } else {
    sessions.unshift(entry)
  }

  // Enforce max session count
  if (sessions.length > MAX_SESSIONS) {
    const removed = sessions.splice(MAX_SESSIONS)
    for (const r of removed) {
      try { localStorage.removeItem(SESSION_PREFIX + r.id) } catch { /* ignore */ }
    }
  }

  writeSessions(sessions)
}

// ---------------------------------------------------------------------------
// Version migration
// ---------------------------------------------------------------------------

function migratePayload(raw: unknown): SessionPayload {
  if (raw == null) return { version: STORE_VERSION, messages: [] }
  if (typeof raw !== 'object') return { version: STORE_VERSION, messages: [] }

  const obj = raw as Record<string, unknown>

  // Has version field → check and migrate
  if (typeof obj.version === 'number') {
    let payload = raw as SessionPayload
    // v1 is current — no migration needed yet
    // Future: if payload.version < STORE_VERSION, apply sequential migrations
    return payload
  }

  // No version field → v0 data (raw array of messages)
  if (Array.isArray(raw)) {
    return { version: STORE_VERSION, messages: raw as StoredMessage[] }
  }

  // Unknown shape → empty
  return { version: STORE_VERSION, messages: [] }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateSessionId(): string {
  const suffix = Math.random().toString(36).slice(2, 6)
  return `session-${Date.now().toString(36)}-${suffix}`
}

export function getSessions(projectId?: string): StoredSession[] {
  let sessions = readSessions()
  if (projectId) {
    sessions = sessions.filter(
      (s) => !s.projectId || s.projectId === projectId,
    )
  }
  return sessions.sort((a, b) => b.lastActive - a.lastActive)
}

export function getSessionMessages(id: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + id)
    if (!raw) return []
    const payload = migratePayload(JSON.parse(raw))
    return payload.messages
  } catch (e) {
    logger.error(`[chat-store] Failed to read session ${id}: ${e}`)
    return []
  }
}

export function saveSession(id: string, messages: StoredMessage[], projectId?: string): void {
  scheduleSave(id, messages, projectId)
}

/** Immediately flush to localStorage — bypasses debounce. */
export function saveSessionNow(id: string, messages: StoredMessage[], projectId?: string): void {
  const existing = pendingSaves.get(id)
  if (existing) clearTimeout(existing)
  pendingSaves.delete(id)
  flushSave(id, messages, projectId)
}

export function deleteSession(id: string): void {
  try { localStorage.removeItem(SESSION_PREFIX + id) } catch { /* ignore */ }
  const sessions = readSessions().filter(s => s.id !== id)
  writeSessions(sessions)
}

export function renameSession(id: string, newTitle: string): void {
  const sessions = readSessions()
  const idx = sessions.findIndex(s => s.id === id)
  if (idx < 0) return
  sessions[idx] = { ...sessions[idx], title: newTitle }
  writeSessions(sessions)
}

export function exportAllSessions(): string {
  const sessions = readSessions()
  const data: Record<string, SessionPayload> = {}
  for (const s of sessions) {
    try {
      const raw = localStorage.getItem(SESSION_PREFIX + s.id)
      if (raw) data[s.id] = JSON.parse(raw)
    } catch { /* skip corrupt session */ }
  }
  const result = {
    version: STORE_VERSION,
    exportedAt: new Date().toISOString(),
    sessions,
    data,
  }
  return JSON.stringify(result, null, 2)
}

export function importSessions(json: string): number {
  let parsed: { version?: number; sessions?: StoredSession[]; data?: Record<string, SessionPayload> }
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('Invalid JSON file')
  }
  if (!parsed.sessions || !parsed.data) {
    throw new Error('File does not contain session data')
  }

  const existing = readSessions()
  const existingIds = new Set(existing.map(s => s.id))
  let imported = 0

  for (const s of parsed.sessions) {
    if (existingIds.has(s.id)) continue // skip duplicates
    const payload = parsed.data[s.id]
    if (!payload) continue
    const migrated = migratePayload(payload)
    try {
      localStorage.setItem(SESSION_PREFIX + s.id, JSON.stringify(migrated))
      imported++
    } catch { /* skip */ }
  }

  const merged = [...parsed.sessions.filter(s => !existingIds.has(s.id)), ...existing]
  writeSessions(merged)
  return imported
}

// Init: write version key if not present
try {
  if (!localStorage.getItem(VERSION_KEY)) {
    localStorage.setItem(VERSION_KEY, String(STORE_VERSION))
  }
} catch { /* read-only storage */ }
