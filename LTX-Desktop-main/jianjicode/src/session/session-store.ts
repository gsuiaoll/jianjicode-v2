/**
 * jianjicode 持久化 Session 存储
 *
 * 将 ChatMessage 以 JSONL（JSON Lines）格式持久化到磁盘，
 * 确保 HTTP 服务器重启后会话不丢失。
 *
 * 存储结构：
 *   ~/.jianjicode/sessions/{sessionId}.jsonl     — 消息追加日志
 *   ~/.jianjicode/sessions/{sessionId}.meta.json  — 会话元数据（createdAt, lastActive, compactedSummary）
 *
 * JSONL 格式优势：
 *   - 追加 O(1)，无需加载全量到内存重写
 *   - 可人工阅读和调试
 *   - 读取时逐行解析，容错性强（坏行不影响其他行）
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import { homedir } from "os"
import { join } from "path"
import type { ChatMessage } from "../core/chat-session.js"

// ============================================================================
// 类型
// ============================================================================

export interface SessionMeta {
  createdAt: string
  lastActive: string
  compactedSummary?: string
}

export interface SessionStoreStats {
  sessionCount: number
  totalSizeBytes: number
}

// ============================================================================
// FileSessionStore
// ============================================================================

const DEFAULT_BASE_DIR = join(homedir(), ".jianjicode", "sessions")

export class FileSessionStore {
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir || DEFAULT_BASE_DIR
    this.ensureDir()
  }

  getBaseDir(): string {
    return this.baseDir
  }

  // ---- 内部路径 ----

  private messagesPath(sessionId: string): string {
    return join(this.baseDir, `${sanitizeId(sessionId)}.jsonl`)
  }

  private metaPath(sessionId: string): string {
    return join(this.baseDir, `${sanitizeId(sessionId)}.meta.json`)
  }

  private ensureDir(): void {
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }
  }

  // ---- 写入 ----

  /** 追加一条消息到 JSONL 文件（同步写，保证原子性） */
  append(sessionId: string, message: ChatMessage): void {
    this.ensureDir()
    const line =
      JSON.stringify({
        ...message,
        _timestamp: new Date().toISOString(),
      }) + "\n"
    appendFileSync(this.messagesPath(sessionId), line, "utf-8")
  }

  /** 写入/更新会话元数据 */
  writeMeta(sessionId: string, meta: SessionMeta): void {
    this.ensureDir()
    writeFileSync(
      this.metaPath(sessionId),
      JSON.stringify(meta, null, 2),
      "utf-8",
    )
  }

  // ---- 读取 ----

  /** 读取完整会话消息列表 */
  read(sessionId: string): ChatMessage[] {
    const path = this.messagesPath(sessionId)
    if (!existsSync(path)) return []

    const content = readFileSync(path, "utf-8")
    const messages: ChatMessage[] = []

    for (const line of content.split("\n").filter(Boolean)) {
      try {
        const parsed = JSON.parse(line)
        const { _timestamp: _, ...message } = parsed
        messages.push(message as ChatMessage)
      } catch {
        // 跳过损坏的行，不影响其他行
      }
    }

    return messages
  }

  /** 读取会话元数据 */
  readMeta(sessionId: string): SessionMeta | null {
    const path = this.metaPath(sessionId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, "utf-8"))
    } catch {
      return null
    }
  }

  // ---- 查询 ----

  /** 列出所有有持久化数据的会话 ID */
  listActive(): string[] {
    if (!existsSync(this.baseDir)) return []
    const files = readdirSync(this.baseDir)
    const ids = new Set<string>()
    for (const file of files) {
      if (file.endsWith(".jsonl")) {
        ids.add(file.slice(0, -6)) // 去掉 .jsonl
      }
    }
    return [...ids]
  }

  /** 获取存储统计信息 */
  getStats(): SessionStoreStats {
    if (!existsSync(this.baseDir)) return { sessionCount: 0, totalSizeBytes: 0 }

    const ids = this.listActive()
    let totalSizeBytes = 0

    for (const id of ids) {
      const msgPath = this.messagesPath(id)
      const metaPath = this.metaPath(id)
      if (existsSync(msgPath)) {
        totalSizeBytes += readFileSync(msgPath).length
      }
      if (existsSync(metaPath)) {
        totalSizeBytes += readFileSync(metaPath).length
      }
    }

    return { sessionCount: ids.length, totalSizeBytes }
  }

  // ---- 清理 ----

  /** 删除指定会话的所有文件 */
  deleteSession(sessionId: string): boolean {
    let found = false
    const msgPath = this.messagesPath(sessionId)
    const mPath = this.metaPath(sessionId)
    if (existsSync(msgPath)) {
      unlinkSync(msgPath)
      found = true
    }
    if (existsSync(mPath)) {
      unlinkSync(mPath)
      found = true
    }
    return found
  }

  /**
   * 清理超过指定毫秒未活跃的会话。
   * @returns 清理的会话数
   */
  cleanup(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs
    let removed = 0
    for (const id of this.listActive()) {
      const meta = this.readMeta(id)
      if (meta) {
        const lastActive = new Date(meta.lastActive).getTime()
        if (lastActive < cutoff) {
          this.deleteSession(id)
          removed++
        }
      }
    }
    return removed
  }
}

// ============================================================================
// 工具
// ============================================================================

/** 确保 sessionId 不包含非法文件名字符 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}
