/**
 * jianjicode 权限系统 — Always-allow 持久化存储
 *
 * 使用 JSONL 格式存储用户已批准"always allow"的规则。
 * 每条规则一行 JSON，可追加写入。
 *
 * 文件锁：用 fs.promises.mkdir 原子性创建 .lock 目录作为锁。
 * 冲突时指数退避重试（最多 3 次），避免并发写入损坏 JSONL。
 *
 * 存储路径：~/.jianjicode/permissions.jsonl
 */

import { existsSync, readFileSync } from "fs"
import { mkdir, rename, unlink, writeFile } from "fs/promises"
import os from "os"
import path from "path"
import type { PermissionRule, Ruleset } from "./types.js"

// ============================================================================
// 常量
// ============================================================================

const LOCK_RETRIES = 3
const LOCK_BASE_DELAY = 200
const DEFAULT_STORE_PATH = path.join(
  os.homedir(),
  ".jianjicode",
  "permissions.jsonl",
)

// ============================================================================
// Store 接口
// ============================================================================

export interface AlwaysAllowStore {
  /** 获取所有已持久化的规则 */
  getAll(): Ruleset
  /** 添加一条规则并持久化 */
  add(rule: PermissionRule): void
  /** 移除匹配的规则 */
  remove(target: string, pattern: string): boolean
  /** 强制同步到磁盘 */
  flush(): Promise<void>
}

// ============================================================================
// 文件锁（简易版）
// ============================================================================

const LOCK_DIR = path.join(os.homedir(), ".jianjicode", ".permissions.lock")

async function acquireLock(): Promise<boolean> {
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      await mkdir(LOCK_DIR, { recursive: false })
      return true
    } catch {
      if (attempt < LOCK_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, LOCK_BASE_DELAY * 2 ** attempt))
      }
    }
  }
  return false
}

async function releaseLock(): Promise<void> {
  try {
    await unlink(LOCK_DIR)
  } catch {
    /* ignore */
  }
}

// ============================================================================
// 工厂
// ============================================================================

export function createFileStore(filePath?: string): AlwaysAllowStore {
  const storePath = filePath || DEFAULT_STORE_PATH
  let cache: Ruleset | null = null

  // 确保目录存在
  mkdir(path.dirname(storePath), { recursive: true }).catch(() => {})

  function ensureLoaded(): Ruleset {
    if (cache !== null) return cache
    cache = []
    try {
      if (existsSync(storePath)) {
        const content = readFileSync(storePath, "utf-8")
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const rule = JSON.parse(line) as PermissionRule
            if (rule.target && rule.pattern && rule.action) {
              cache.push(rule)
            }
          } catch {
            /* skip malformed lines */
          }
        }
      }
    } catch {
      /* ignore read errors */
    }
    return cache
  }

  const store: AlwaysAllowStore = {
    getAll(): Ruleset {
      return [...ensureLoaded()]
    },

    add(rule: PermissionRule): void {
      ensureLoaded().push(rule)
      store.flush().catch((err) => {
        console.error(`[permission:store] Flush failed: ${err}`)
      })
    },

    remove(target: string, pattern: string): boolean {
      const rules = ensureLoaded()
      const idx = rules.findIndex(
        (r) => r.target === target && r.pattern === pattern,
      )
      if (idx === -1) return false
      rules.splice(idx, 1)
      store.flush().catch((err) => {
        console.error(`[permission:store] Flush failed: ${err}`)
      })
      return true
    },

    async flush(): Promise<void> {
      const rules = cache
      if (!rules) return

      const locked = await acquireLock()
      if (!locked) {
        console.warn(
          "[permission:store] Could not acquire lock, writing anyway",
        )
      }

      try {
        const lines = rules.map((r) => JSON.stringify(r) + "\n").join("")
        const tmpPath = storePath + ".tmp"
        await writeFile(tmpPath, lines, "utf-8")
        await rename(tmpPath, storePath)
      } catch (err) {
        console.error(`[permission:store] Write failed: ${err}`)
      } finally {
        if (locked) await releaseLock()
      }
    },
  }

  return store
}
