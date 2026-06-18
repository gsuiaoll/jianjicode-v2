/**
 * jianjicode 工具输出截断
 *
 * 基于 OpenCode ai/tool/truncate.ts 模式：
 *   - 输出超过 MAX_LINES 或 MAX_BYTES 时截断
 *   - 完整内容写入 ~/.jianjicode/truncated/
 *   - 返回预览 + 提示用户用 Grep/Read 查看完整内容
 */

import { mkdir, writeFile } from "fs/promises"
import os from "os"
import path from "path"

// ============================================================================
// 常量
// ============================================================================

export const MAX_LINES = 2000
export const MAX_BYTES = 50 * 1024
export const TRUNCATION_DIR = path.join(
  os.homedir(),
  ".jianjicode",
  "truncated",
)

// ============================================================================
// 类型
// ============================================================================

export type TruncateResult =
  | { content: string; truncated: false }
  | { content: string; truncated: true; outputPath: string }

export interface TruncateOptions {
  maxLines?: number
  maxBytes?: number
  direction?: "head" | "tail"
}

// ============================================================================
// ID 生成
// ============================================================================

let counter = 0

function ascendingID(): string {
  counter++
  const ts = Date.now().toString(36)
  const seq = counter.toString(36).padStart(4, "0")
  return `tool_${ts}_${seq}`
}

// ============================================================================
// 截断实现
// ============================================================================

/**
 * 截断工具输出。如果内容在限制内则原样返回，
 * 否则写入完整内容到截断目录并返回预览。
 */
export async function truncateOutput(
  text: string,
  options: TruncateOptions = {},
): Promise<TruncateResult> {
  const maxLines = options.maxLines ?? MAX_LINES
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const direction = options.direction ?? "head"
  const lines = text.split("\n")
  const totalBytes = Buffer.byteLength(text, "utf-8")

  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false }
  }

  // 截断
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
  const outputFile = path.join(TRUNCATION_DIR, ascendingID())

  // 确保目录存在并写入完整输出
  try {
    await mkdir(TRUNCATION_DIR, { recursive: true })
    await writeFile(outputFile, text, "utf-8")
  } catch (err) {
    console.error(`[truncate] Failed to write full output: ${err}`)
  }

  const hint =
    `The tool call succeeded but the output was truncated. Full output saved to: ${outputFile}\n` +
    `Use Grep to search the full content or Read with offset/limit to view specific sections.`

  return {
    content:
      direction === "head"
        ? `${preview}\n\n...${removed} ${unit} truncated...\n\n${hint}`
        : `...${removed} ${unit} truncated...\n\n${hint}\n\n${preview}`,
    truncated: true,
    outputPath: outputFile,
  }
}
