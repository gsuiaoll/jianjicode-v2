import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"

// ============================================================================
// ToolState — 文件级工具状态持久化
//
// 映射 OpenCode 的 Tool Metadata Persistence 模式:
// 关键 tool 结果存结构化存储, 后续 tool 自己读, 不靠模型在步骤间传数据。
//
// 预定义 namespace:
//   "ffmpeg"    → { outputs: string[], lastOperation: string }
//   "pipeline"  → { stepResults: StepResult[], currentStep: number }
//   "vision"    → { analysis: string, timestamps: SceneTimestamp[] }
// ============================================================================

const STATE_DIR = join(homedir(), ".jianjicode", "tool-state")
const stateCache = new Map<string, Record<string, Record<string, unknown>>>()

function ensureDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true })
  }
}

function sanitizeId(id: string): string {
  return id.replace(/[<>:"/\\|?*]/g, "_")
}

function filePath(sessionId: string): string {
  ensureDir()
  return join(STATE_DIR, `${sanitizeId(sessionId)}.json`)
}

function loadEntry(sessionId: string): Record<string, Record<string, unknown>> {
  const cached = stateCache.get(sessionId)
  if (cached) return cached

  try {
    const fp = filePath(sessionId)
    if (existsSync(fp)) {
      const raw = readFileSync(fp, "utf-8")
      const entry = JSON.parse(raw) as Record<string, Record<string, unknown>>
      stateCache.set(sessionId, entry)
      return entry
    }
  } catch {
    // 解析失败则重置
  }
  const entry: Record<string, Record<string, unknown>> = {}
  stateCache.set(sessionId, entry)
  return entry
}

function saveEntry(sessionId: string, entry: Record<string, Record<string, unknown>>) {
  stateCache.set(sessionId, entry)
  try {
    ensureDir()
    writeFileSync(filePath(sessionId), JSON.stringify(entry, null, 2), "utf-8")
  } catch {
    // 写盘失败不阻塞
  }
}

export class ToolState {
  private sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  get<T = unknown>(namespace: string, key: string): T | undefined {
    const entry = loadEntry(this.sessionId)
    return entry[namespace]?.[key] as T | undefined
  }

  set<T = unknown>(namespace: string, key: string, value: T): void {
    const entry = loadEntry(this.sessionId)
    if (!entry[namespace]) entry[namespace] = {}
    entry[namespace][key] = value
    saveEntry(this.sessionId, entry)
  }

  getNamespace(namespace: string): Record<string, unknown> {
    const entry = loadEntry(this.sessionId)
    return entry[namespace] ? { ...entry[namespace] } : {}
  }

  clearNamespace(namespace: string): void {
    const entry = loadEntry(this.sessionId)
    delete entry[namespace]
    saveEntry(this.sessionId, entry)
  }

  clear(): void {
    stateCache.delete(this.sessionId)
    try {
      const fp = filePath(this.sessionId)
      if (existsSync(fp)) unlinkSync(fp)
    } catch {
      // 清理失败不阻塞
    }
  }
}

export function getToolState(sessionId: string): ToolState {
  return new ToolState(sessionId)
}

export function deleteToolState(sessionId: string): void {
  new ToolState(sessionId).clear()
}
