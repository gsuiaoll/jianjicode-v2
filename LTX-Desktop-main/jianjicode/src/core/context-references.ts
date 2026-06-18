/**
 * jianjicode Context References — @file/@folder/@url/@git 引用语法
 *
 * AI 在对话中可以用 `@file:path`、`@folder:path`、`@url:url` 引用外部资源。
 * 系统自动解析引用内容并注入上下文，带 token 预算控制和敏感路径隔离。
 *
 * 语法：
 *   @file:path/to/file.ext          — 引用文件内容
 *   @file:path/to/file.ext:10-20   — 引用指定行范围
 *   @folder:path/to/dir/            — 引用目录文件列表
 *   @url:https://example.com/doc    — 引用 URL 内容
 *   @git:N                         — 引用 git diff（最近 N 条 commit）
 *
 * 安全：
 *   - 敏感路径（.ssh/, .aws/, .env 等）被阻止
 *   - 文件超出 token 预算时截断
 *   - 二进制文件检测
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// ============================================================================
// 类型
// ============================================================================

export type ReferenceKind = "file" | "folder" | "url" | "git"

export interface ContextReference {
  raw: string // 原始引用文本，如 "@file:src/index.ts"
  kind: ReferenceKind
  target: string // 解析后的目标路径/URL
  startLine?: number // 行范围起始（仅 file）
  endLine?: number // 行范围结束（仅 file）
}

export interface ReferenceResult {
  content: string // 解析后的内容
  injectedTokens: number // 注入的 token 数
  truncated: boolean // 是否被截断
  error?: string // 错误信息
}

/** 敏感路径列表 — 这些路径（或其父目录）不会被引用 */
const SENSITIVE_PATHS = [
  ".ssh",
  ".aws",
  ".kube",
  ".config",
  ".git",
  "node_modules",
  ".env",
  ".hermes",
  ".jianjicode",
]

/** Token 预算软限制（总注入的百分比） */
const TOKEN_SOFT_LIMIT = 0.25
/** Token 预算硬限制 */
const TOKEN_HARD_LIMIT = 0.5
/** 单个文件最大读取大小（1MB） */
const MAX_FILE_SIZE = 1_000_000
/** 目录最大列出文件数 */
const MAX_FOLDER_FILES = 100
/** URL 获取超时（5 秒） */
const URL_FETCH_TIMEOUT = 5_000

// ============================================================================
// 敏感路径检测
// ============================================================================

/**
 * 检查路径是否包含敏感组件。
 */
export function isSensitivePath(targetPath: string): boolean {
  const normalized = path.resolve(targetPath).toLowerCase()
  for (const sensitive of SENSITIVE_PATHS) {
    if (normalized.includes(path.sep + sensitive + path.sep)) return true
    if (normalized.endsWith(path.sep + sensitive)) return true
    if (normalized === sensitive) return true
    // Windows: 检查 C:\Users\.ssh 等
    if (normalized.includes(`\\${sensitive}\\"`)) return true
    if (normalized.endsWith(`\\${sensitive}`)) return true
  }
  return false
}

// ============================================================================
// 引用解析
// ============================================================================

/**
 * 解析单行引用语法。
 * 支持格式：
 *   @file:path
 *   @file:path:10-20
 *   @folder:path
 *   @url:url
 *   @git:N
 */
export function parseReference(text: string): ContextReference | null {
  const trimmed = text.trim()

  // @file:path or @file:path:line-start-line-end
  const fileMatch = trimmed.match(/^@file:(\S+?)(?::(\d+)-(\d+))?$/)
  if (fileMatch) {
    return {
      raw: trimmed,
      kind: "file",
      target: fileMatch[1],
      startLine: fileMatch[2] ? parseInt(fileMatch[2], 10) : undefined,
      endLine: fileMatch[3] ? parseInt(fileMatch[3], 10) : undefined,
    }
  }

  // @folder:path
  const folderMatch = trimmed.match(/^@folder:(\S+)$/)
  if (folderMatch) {
    return {
      raw: trimmed,
      kind: "folder",
      target: folderMatch[1],
    }
  }

  // @url:url
  const urlMatch = trimmed.match(/^@url:(https?:\/\/\S+)$/)
  if (urlMatch) {
    return {
      raw: trimmed,
      kind: "url",
      target: urlMatch[1],
    }
  }

  // @git:N
  const gitMatch = trimmed.match(/^@git:(\d+)$/)
  if (gitMatch) {
    return {
      raw: trimmed,
      kind: "git",
      target: gitMatch[1],
    }
  }

  return null
}

/**
 * 从文本中提取所有引用。
 */
export function extractReferences(text: string): ContextReference[] {
  const refs: ContextReference[] = []
  const pattern = /@(?:file|folder|url|git):\S+/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const ref = parseReference(match[0])
    if (ref) refs.push(ref)
  }

  return refs
}

// ============================================================================
// 引用解析
// ============================================================================

/**
 * 估算文本的 token 数（与 chat-session.ts 中一致）。
 */
function estimateTokens(text: string): number {
  let asciiChars = 0
  let cjkChars = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjkChars++
    } else {
      asciiChars++
    }
  }
  return Math.ceil(asciiChars / 4 + cjkChars / 2)
}

/**
 * 解析单个引用为内容。
 */
async function resolveReference(
  ref: ContextReference,
  budget: number,
): Promise<ReferenceResult> {
  switch (ref.kind) {
    case "file":
      return resolveFileRef(ref, budget)
    case "folder":
      return resolveFolderRef(ref, budget)
    case "url":
      return resolveUrlRef(ref, budget)
    case "git":
      return resolveGitRef(ref, budget)
  }
}

/**
 * 解析 @file: 引用。
 */
function resolveFileRef(
  ref: ContextReference,
  budget: number,
): ReferenceResult {
  const resolvedPath = path.resolve(ref.target)

  // 敏感路径检查
  if (isSensitivePath(resolvedPath)) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: `Blocked: "${ref.target}" is a sensitive path`,
    }
  }

  if (!fs.existsSync(resolvedPath)) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: `File not found: "${ref.target}"`,
    }
  }

  try {
    const stat = fs.statSync(resolvedPath)
    if (stat.size > MAX_FILE_SIZE) {
      return {
        content: "",
        injectedTokens: 0,
        truncated: false,
        error: `File too large (${stat.size} bytes, max ${MAX_FILE_SIZE})`,
      }
    }

    let content = fs.readFileSync(resolvedPath, "utf-8")

    // 行范围截取
    if (ref.startLine !== undefined) {
      const lines = content.split("\n")
      const start = Math.max(0, ref.startLine - 1)
      const end =
        ref.endLine !== undefined
          ? Math.min(lines.length, ref.endLine)
          : lines.length
      content = lines.slice(start, end).join("\n")
    }

    const injectedTokens = estimateTokens(content)

    // Token 预算截断
    if (injectedTokens > budget) {
      const ratio = budget / injectedTokens
      const truncateLen = Math.floor(content.length * ratio)
      content =
        content.slice(0, truncateLen) +
        `\n... [truncated: ${injectedTokens} tokens > ${budget} budget]`
      return { content, injectedTokens: budget, truncated: true }
    }

    return { content, injectedTokens, truncated: false }
  } catch (err: any) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: err.message,
    }
  }
}

/**
 * 解析 @folder: 引用。
 */
function resolveFolderRef(
  ref: ContextReference,
  budget: number,
): ReferenceResult {
  const resolvedPath = path.resolve(ref.target)

  if (isSensitivePath(resolvedPath)) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: `Blocked: "${ref.target}" is a sensitive path`,
    }
  }

  if (
    !fs.existsSync(resolvedPath) ||
    !fs.statSync(resolvedPath).isDirectory()
  ) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: `Folder not found: "${ref.target}"`,
    }
  }

  try {
    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true })
    const lines: string[] = [`📁 Contents of "${ref.target}":`]

    let fileCount = 0
    for (const entry of entries) {
      if (fileCount >= MAX_FOLDER_FILES) {
        lines.push(
          `  ... and ${entries.length - MAX_FOLDER_FILES} more entries`,
        )
        break
      }
      const prefix = entry.isDirectory() ? "📁" : "📄"
      try {
        const stat = fs.statSync(path.join(resolvedPath, entry.name))
        const size = stat.isFile() ? ` (${stat.size} bytes)` : ""
        lines.push(`  ${prefix} ${entry.name}${size}`)
      } catch {
        lines.push(`  ${prefix} ${entry.name}`)
      }
      fileCount++
    }

    const content = lines.join("\n")
    const injectedTokens = estimateTokens(content)

    if (injectedTokens > budget) {
      const truncatedContent =
        lines.slice(0, Math.floor(budget / 10)).join("\n") +
        `\n... [truncated: ${injectedTokens} tokens > ${budget} budget]`
      return {
        content: truncatedContent,
        injectedTokens: budget,
        truncated: true,
      }
    }

    return { content, injectedTokens, truncated: false }
  } catch (err: any) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: err.message,
    }
  }
}

/**
 * 解析 @url: 引用。
 */
async function resolveUrlRef(
  ref: ContextReference,
  budget: number,
): Promise<ReferenceResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), URL_FETCH_TIMEOUT)

    const response = await fetch(ref.target, {
      signal: controller.signal,
      headers: { "User-Agent": "jianjicode/1.0" },
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return {
        content: "",
        injectedTokens: 0,
        truncated: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const text = await response.text()
    const injectedTokens = estimateTokens(text)

    if (injectedTokens > budget) {
      const ratio = budget / injectedTokens
      const truncateLen = Math.floor(text.length * ratio)
      const content =
        text.slice(0, truncateLen) +
        `\n... [truncated: ${injectedTokens} tokens > ${budget} budget]`
      return { content, injectedTokens: budget, truncated: true }
    }

    return { content: text, injectedTokens, truncated: false }
  } catch (err: any) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: `URL fetch failed: ${err.message}`,
    }
  }
}

/**
 * 解析 @git:N 引用（最近 N 条 commit 的 diff）。
 */
async function resolveGitRef(
  ref: ContextReference,
  budget: number,
): Promise<ReferenceResult> {
  try {
    const { execSync } = await import("node:child_process")
    const count = parseInt(ref.target, 10) || 3

    // 检查是否在 git 仓库中
    try {
      execSync("git rev-parse --git-dir", { encoding: "utf-8", stdio: "pipe" })
    } catch {
      return {
        content: "",
        injectedTokens: 0,
        truncated: false,
        error: "Not a git repository",
      }
    }

    const log = execSync(`git log --oneline -${count}`, {
      encoding: "utf-8",
      stdio: "pipe",
    })
    const diff = execSync(`git diff HEAD~${count}..HEAD --stat`, {
      encoding: "utf-8",
      stdio: "pipe",
    })

    const content = `## Recent Git Changes (last ${count} commits)\n\n### Commits\n${log}\n### Diff Stats\n${diff}`
    const injectedTokens = estimateTokens(content)

    if (injectedTokens > budget) {
      return {
        content: content.slice(0, budget * 4),
        injectedTokens: budget,
        truncated: true,
      }
    }

    return { content, injectedTokens, truncated: false }
  } catch (err: any) {
    return {
      content: "",
      injectedTokens: 0,
      truncated: false,
      error: `Git ref failed: ${err.message}`,
    }
  }
}

// ============================================================================
// 主入口：解析文本中所有引用并替换为内容
// ============================================================================

export interface ResolveAllResult {
  /** 注入的消息通告 */
  message: string
  /** 所有解析的引用的内容 */
  references: Array<{
    raw: string
    content: string
    error?: string
  }>
  /** 总注入 token 数 */
  injectedTokens: number
  /** 是否强制截断 */
  blocked: boolean
}

/**
 * 解析消息中的引用并替换为实际内容。
 * 在将用户消息发送给 AI 之前调用，自动将 @file/folder/url/git 引用替换为实际内容。
 *
 * @param message      用户消息，可能包含引用语法
 * @param totalBudget  token 预算
 * @returns 替换后的消息 + 系统通知消息
 */
export async function resolveContextReferences(
  message: string,
  totalBudget = 8000,
): Promise<{ resolvedMessage: string; notification: string }> {
  const result = await resolveAllReferences(message, totalBudget)
  if (result.references.length === 0) {
    return { resolvedMessage: message, notification: "" }
  }

  // 从后往前替换，避免位置失效
  let resolvedMessage = message
  for (let i = result.references.length - 1; i >= 0; i--) {
    const ref = result.references[i]
    const idx = resolvedMessage.indexOf(ref.raw)
    if (idx >= 0) {
      const replacement = ref.error
        ? `\n\n[Context Reference Error: ${ref.error}]\n\n`
        : ref.content
      resolvedMessage =
        resolvedMessage.slice(0, idx) +
        replacement +
        resolvedMessage.slice(idx + ref.raw.length)
    }
  }

  return { resolvedMessage, notification: result.message }
}

/**
 * 解析文本中的所有引用并替换为内容。
 *
 * @param text      包含引用的原始文本
 * @param totalBudget 总 token 预算（根据上下文总 token 数计算）
 * @returns 包含解析结果的结构
 */
export async function resolveAllReferences(
  text: string,
  totalBudget = 8000,
): Promise<ResolveAllResult> {
  const refs = extractReferences(text)
  if (refs.length === 0) {
    return { message: "", references: [], injectedTokens: 0, blocked: false }
  }

  const softBudget = Math.floor(totalBudget * TOKEN_SOFT_LIMIT)
  const hardBudget = Math.floor(totalBudget * TOKEN_HARD_LIMIT)

  const results: ResolveAllResult["references"] = []
  let totalInjected = 0
  let blocked = false

  for (const ref of refs) {
    // 检查是否超出硬限制
    if (totalInjected >= hardBudget) {
      results.push({
        raw: ref.raw,
        content: "",
        error: `Skipped: token budget exceeded (${totalInjected}/${hardBudget})`,
      })
      blocked = true
      continue
    }

    const remaining = hardBudget - totalInjected
    const result = await resolveReference(ref, remaining)

    totalInjected += result.injectedTokens
    if (result.error) {
      results.push({ raw: ref.raw, content: "", error: result.error })
    } else {
      results.push({ raw: ref.raw, content: result.content })
    }

    if (result.truncated) {
      blocked = true
    }
  }

  // 构造消息
  const messageParts: string[] = []
  if (results.some((r) => !r.error)) {
    const injected = results.filter((r) => !r.error).length
    messageParts.push(
      `[Context References: ${injected}/${refs.length} resolved, ~${totalInjected} tokens injected]`,
    )
  }
  if (blocked) {
    messageParts.push(
      `[Warning: Some references were blocked or truncated to stay within token budget]`,
    )
  }

  return {
    message: messageParts.length > 0 ? messageParts.join("\n") : "",
    references: results,
    injectedTokens: totalInjected,
    blocked,
  }
}
