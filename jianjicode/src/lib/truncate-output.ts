/**
 * 轻量截断实现 — 零外部运行时依赖（仅 node:fs/promises + node:os + node:path）。
 *
 * 从 truncate.ts 拆出，避免 tool.ts 等轻量核心文件被迫加载
 * effect / AppFileSystem 等重依赖。
 */

import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

// ============================================================================
// 常量
// ============================================================================

export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export const DIR = join(homedir(), ".jianjicode", "tool-output")

// ============================================================================
// 类型
// ============================================================================

export interface Options {
  maxLines?: number
  maxBytes?: number
  direction?: "head" | "tail"
}

export type Result =
  | { content: string; truncated: false }
  | { content: string; truncated: true; outputPath: string }

// ============================================================================
// 核心逻辑 — 原样迁移自 truncate.ts
// ============================================================================

export async function output(
  text: string,
  options: Options = {},
  _agent?: unknown,
): Promise<Result> {
  const maxLines = options.maxLines ?? MAX_LINES
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const direction = options.direction ?? "head"
  const lines = text.split("\n")
  const totalBytes = Buffer.byteLength(text, "utf-8")

  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false }
  }

  // --- 截断 ---
  const out: string[] = []
  let i = 0
  let bytes = 0
  let hitBytes = false

  if (direction === "head") {
    for (i = 0; i < lines.length && i < maxLines; i++) {
      const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0)
      if (bytes + size > maxBytes) {
        hitBytes = true
        break
      }
      out.push(lines[i])
      bytes += size
    }
  } else {
    for (i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
      const size =
        Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
      if (bytes + size > maxBytes) {
        hitBytes = true
        break
      }
      out.unshift(lines[i])
      bytes += size
    }
  }

  const removed = hitBytes ? totalBytes - bytes : lines.length - out.length
  const unit = hitBytes ? "bytes" : "lines"
  const preview = out.join("\n")
  const file = join(
    DIR,
    `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  )

  await mkdir(DIR, { recursive: true })
  await writeFile(file, text, "utf-8")

  const hint =
    `The tool call succeeded but the output was truncated (${removed} ${unit} removed). ` +
    `Full output saved to: ${file}\n` +
    `Use Grep to search the full content or Read with offset/limit to view specific sections.`

  return {
    content:
      direction === "head"
        ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
        : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
    truncated: true,
    outputPath: file,
  }
}
