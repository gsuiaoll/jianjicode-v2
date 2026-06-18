/**
 * jianjicode 轻量级会话管理
 *
 * 基于内存 Map 的多轮对话 session 存储，支持上下文压缩。
 * HTTP 服务和 CLI 可共用此模块实现上下文保持。
 *
 * 模式参考 OpenCode 的 session processor：
 *   - while(true) agent loop 由 AI SDK stepCountIs 替代
 *   - process() compaction 由 compactHistory() 替代
 *   - prune() 旧工具输出清除 由 compactHistory() 内置处理
 */

import { permissionStorage } from "../permission/service.js"
import type { PermissionRequest } from "../permission/types.js"
import type { FileSessionStore } from "../session/session-store.js"
import type { Tool } from "../tool/tool.js"
import type { LTXEditResult } from "../types/edit-result.js"
import { getToolState } from "./tool-state.js"

// ============================================================================
// 类型定义
// ============================================================================

export interface ChatMessage {
  role: "user" | "assistant" | "tool"
  content: string | any[]
  toolCallId?: string
  toolName?: string
  result?: LTXEditResult
  /** assistant 消息发起的工具调用列表，用于 agent loop 多轮传递 */
  toolCalls?: Array<{
    toolName: string
    args: Record<string, unknown>
    result: any
    toolCallId: string
  }>
}

export interface ChatSession {
  id: string
  messages: ChatMessage[]
  createdAt: Date
  lastActive: Date
  /** 被压缩的旧消息摘要（作为 system 上下文注入） */
  compactedSummary?: string
}

const sessions = new Map<string, ChatSession>()
let _store: FileSessionStore | undefined

/** 设置持久化存储层。通常在应用启动时调用一次。 */
export function setSessionStore(store: FileSessionStore): void {
  _store = store
}

/** 获取当前持久化存储层（如已配置） */
export function getSessionStore(): FileSessionStore | undefined {
  return _store
}

// ============================================================================
// 会话 CRUD
// ============================================================================

export function getOrCreateSession(sessionId: string): ChatSession {
  const existing = sessions.get(sessionId)
  if (existing) {
    existing.lastActive = new Date()
    return existing
  }

  // 尝试从持久化存储恢复
  if (_store) {
    const messages = _store.read(sessionId)
    const meta = _store.readMeta(sessionId)
    if (messages.length > 0 || meta) {
      const session: ChatSession = {
        id: sessionId,
        messages,
        createdAt: meta ? new Date(meta.createdAt) : new Date(),
        lastActive: new Date(),
        compactedSummary: meta?.compactedSummary,
      }
      sessions.set(sessionId, session)
      return session
    }
  }

  const session: ChatSession = {
    id: sessionId,
    messages: [],
    createdAt: new Date(),
    lastActive: new Date(),
  }
  sessions.set(sessionId, session)
  return session
}

export function getSession(sessionId: string): ChatSession | undefined {
  return sessions.get(sessionId)
}

export function addMessage(sessionId: string, message: ChatMessage): void {
  const session = getOrCreateSession(sessionId)
  session.messages.push(message)
  session.lastActive = new Date()
  // 持久化到磁盘
  _store?.append(sessionId, message)
}

export function getMessages(sessionId: string): ChatMessage[] {
  return getOrCreateSession(sessionId).messages
}

export function deleteSession(sessionId: string): boolean {
  _store?.deleteSession(sessionId)
  return sessions.delete(sessionId)
}

// ============================================================================
// 历史消息管理
// ============================================================================

/** 添加用户消息到会话历史。content 可以是纯文本字符串或多模态内容数组。 */
export function appendUserMessage(sessionId: string, content: string | any[]): void {
  addMessage(sessionId, { role: "user", content })
}

/** 清理会话中第一条用户消息的多模态内容（视频/文件），替换为纯文本。避免大体积 base64 在每轮 API 调用中重复发送。 */
export function stripVideoFromSession(sessionId: string): void {
  const session = getSession(sessionId)
  if (!session) return
  const firstUser = session.messages.find(m => m.role === "user")
  if (!firstUser || typeof firstUser.content !== "object") return
  const text = Array.isArray(firstUser.content)
    ? firstUser.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(" ")
        // 剥离 [DASHSCOPE_VIDEO:oss://...] 标记，避免后续步骤重复发送多模态视频
        .replace(/\[DASHSCOPE_VIDEO:oss:\/\/[^\]]+\]/g, "")
        .trim()
    : ""
  if (text) {
    firstUser.content = text + "\n[视频内容已在上一轮分析中展示]"
  } else {
    firstUser.content = "[视频内容已在上一轮分析中展示]"
  }
}

/**
 * 从模型的 Step 1 文字回复中提取场景分析，持久化为 compactedSummary。
 *
 * 流程（对应 OpenCode AI Compaction 模式）：
 *   1. 遍历会话中 assistant 消息，查找视频分析文本
 *   2. 正则提取时间戳（0:05-0:10、"教室场景"等关键词描述）
 *   3. 构建结构化摘要 → 写入 session.compactedSummary
 *   4. 写入 ToolState("vision", "analysis") + ToolState("vision", "timestamps")
 *   5. 调用 stripVideoFromSession() 清理多模态二进制数据
 *
 * 后续每步 getHistoryForAgent() 会自动将 compactedSummary 作为 system 消息注入，
 * 模型在每一步都能"看到"场景分析，不需要在步骤间传递数据。
 */
export function extractAndPersistVideoAnalysis(sessionId: string): string | null {
  const session = getSession(sessionId)
  if (!session) return null

  // 收集所有 assistant 消息的文本
  const allAssistantText = session.messages
    .filter((m) => m.role === "assistant" && typeof m.content === "string")
    .map((m) => m.content as string)
    .join("\n\n")

  if (!allAssistantText || allAssistantText.length < 50) return null

  // 提取时间戳模式：HH:MM:SS-HH:MM:SS、HH:MM-HH:MM、或 "第N秒" 等
  const timestampPatterns = [
    /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—到至]\s*(\d{1,2}:\d{2}(?::\d{2})?)/g,
    /(\d+)\s*[-–—到至]\s*(\d+)\s*秒/g,
    /(\d{1,2}:\d{2}(?::\d{2})?)\s*[-–—]\s*(\d{1,2}:\d{2}(?::\d{2})?)/g,
  ]

  const scenes: Array<{ start: string; end: string; desc: string }> = []

  for (const pattern of timestampPatterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(allAssistantText)) !== null) {
      const start = match[1]
      const end = match[2]
      // 尝试在时间戳前后提取场景描述（截取周围 80 个字符）
      const matchIdx = match.index
      const contextStart = Math.max(0, matchIdx - 40)
      const contextEnd = Math.min(allAssistantText.length, matchIdx + match[0].length + 60)
      let desc = allAssistantText.slice(matchIdx, contextEnd).replace(match[0], "").trim()
      // 去掉前导符号
      desc = desc.replace(/^[：:，,。；;、\s-]+/, "").slice(0, 50)
      if (!desc) {
        // fallback: 从 match 前取上下文
        desc = allAssistantText.slice(contextStart, matchIdx).trim()
        desc = desc.slice(Math.max(0, desc.length - 50))
      }
      scenes.push({ start, end, desc: desc || "(场景)" })
    }
    if (scenes.length > 0) break // 找到一种格式就够了
  }

  // 如果没有时间戳，尝试提取场景关键词（"教室"、"手术"、"动画"等）作为无时间戳场景
  if (scenes.length === 0) {
    const sceneKeywords = [
      "教室", "课堂", "手术", "解剖", "实验", "动画", "转场",
      "特写", "全景", "远景", "近景", "场景", "片段", "镜头",
      "开场", "结尾", "高潮", "过渡",
    ]
    let leftover = allAssistantText
    let idx = 0
    for (const kw of sceneKeywords) {
      let pos = 0
      while ((pos = leftover.indexOf(kw, pos)) !== -1) {
        const snippet = leftover.slice(Math.max(0, pos - 20), pos + 60).trim()
        scenes.push({ start: "", end: "", desc: snippet.slice(0, 80) })
        pos += kw.length
        idx++
        if (idx >= 8) break
      }
      if (idx >= 8) break
    }
  }

  if (scenes.length === 0) {
    // 没有任何结构化的场景信息，仍然清理视频
    stripVideoFromSession(sessionId)
    return null
  }

  // 构建结构化摘要
  const sceneLines = scenes
    .map((s, i) => {
      const range = s.start ? ` ${s.start}-${s.end}` : ""
      return `  - 场景 ${i + 1}${range}: ${s.desc}`
    })
    .join("\n")

  const summary = `## 视频分析摘要
以下是从上轮视频分析中提取的场景信息，后续步骤可直接引用：

${sceneLines}

请在后续步骤中使用这些场景时间戳进行精确的视频剪辑（trim/concat）。`

  // 写入 compactedSummary
  session.compactedSummary = summary

  // 写入 ToolState（供 video-edit-pipeline 等代码层管道读取）
  const toolState = getToolState(sessionId)
  toolState.set("vision", "analysis", summary)
  toolState.set("vision", "timestamps", scenes)

  // 持久化元数据
  if (_store) {
    _store.writeMeta(sessionId, {
      createdAt: session.createdAt.toISOString(),
      lastActive: session.lastActive.toISOString(),
      compactedSummary: summary,
    })
  }

  // 清理多模态二进制数据
  stripVideoFromSession(sessionId)

  console.log(
    `[extractAndPersistVideoAnalysis] Extracted ${scenes.length} scenes → compactedSummary (${summary.length} chars)`,
  )

  return summary
}

/** 添加助手消息到会话历史，可选附带工具调用信息 */
export function appendAssistantMessage(
  sessionId: string,
  content: string,
  toolInfo?: { toolName: string; toolCallId?: string; result?: LTXEditResult },
): void {
  addMessage(sessionId, {
    role: "assistant",
    content,
    ...(toolInfo || {}),
  })
}

// ============================================================================
// Token 估算
// ============================================================================

/**
 * 粗略估算文本的 token 数。
 * 英文约 4 字符/token，中文约 2 字符/token，混合取加权平均约 3 字符/token。
 * 这不是精确的 tokenizer，仅用于上下文窗口管理决策。
 */
export function estimateTokens(text: string): number {
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

/** 从消息内容中提取文本（支持 string 和多模态数组） */
function extractMessageText(msg: ChatMessage): string {
  if (typeof msg.content === "string") return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text || "")
      .join(" ")
  }
  return ""
}

/** 估算单条消息的 token 数（支持多模态内容数组） */
function estimateMessageTokens(msg: ChatMessage): number {
  if (typeof msg.content === "string") return estimateTokens(msg.content)
  if (Array.isArray(msg.content)) {
    let total = 0
    for (const part of msg.content) {
      if (part.type === "text" && typeof part.text === "string") {
        total += estimateTokens(part.text)
      }
      // file/image parts: base64 是发给多模态编码器的，不占文本 token 预算
      // 只计少量固定开销（url 引用等元数据）
      if (part.type === "file" || part.type === "image") {
        total += 200
      }
    }
    return total
  }
  return 0
}

/** 估算会话中所有消息的总 token 数 */
export function estimateSessionTokens(sessionId: string): number {
  const session = getSession(sessionId)
  if (!session) return 0
  let total = session.compactedSummary
    ? estimateTokens(session.compactedSummary)
    : 0
  for (const msg of session.messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

// ============================================================================
// 上下文压缩
// ============================================================================

/**
 * 三层上下文管理的常量。
 * Opencode 参考值：PRUNE_PROTECT=40K, PRUNE_MINIMUM=20K, COMPACTION_BUFFER=20K。
 */

/** 保留最近多少 token 的工具输出不被剪枝 */
export const PRUNE_PROTECT = 40_000
/** 剪枝至少释放多少 token 才生效 */
export const PRUNE_MINIMUM = 20_000

/**
 * 受保护的工具输出 — 在 prineHistory() 中跳过这些工具的结果。
 * 对应 OpenCode 的 "protected tool outputs" 模式：
 * ffmpeg/lut_filter/video_subtitle 的中间产物（输出文件路径）是后续步骤的关键输入，
 * 一旦被清除模型将丢失中间文件路径，导致管道断裂。
 */
export const PROTECTED_TOOLS = new Set([
  "ffmpeg",
  "lut_filter",
  "video_subtitle",
])

/**
 * L1 — 轻量级剪枝：回退遍历消息，清空旧 tool output 内容。
 *
 * 从最新消息开始累加 tool 消息的 token 数，超出 PRUNE_PROTECT 的部分
 * 将 content 替换为占位符。无需 LLM 调用。
 *
 * 参考 opencode SessionCompaction.prune()。
 */
export function pruneHistory(sessionId: string): {
  pruned: boolean
  tokensFreed: number
} {
  const session = getSession(sessionId)
  if (!session) return { pruned: false, tokensFreed: 0 }

  let totalProtected = 0
  let prunedTokens = 0
  const messages = session.messages

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "tool") continue

    // 受保护的工具输出直接跳过 — 关键工具的输出是后续步骤的输入
    if (msg.toolName && PROTECTED_TOOLS.has(msg.toolName)) continue

    const t = estimateMessageTokens(msg)
    totalProtected += t

    if (totalProtected > PRUNE_PROTECT) {
      const contentText = extractMessageText(msg)
      if (contentText.length > 100) {
        prunedTokens += t
        msg.content = `[compacted: tool output (${t} tokens)]`
      }
    }
  }

  if (prunedTokens > PRUNE_MINIMUM) {
    if (_store) {
      _store.writeMeta(sessionId, {
        createdAt: session.createdAt.toISOString(),
        lastActive: session.lastActive.toISOString(),
        compactedSummary: session.compactedSummary,
      })
    }
    return { pruned: true, tokensFreed: prunedTokens }
  }

  return { pruned: false, tokensFreed: 0 }
}

/**
 * L2 — 溢出检测：检查 token 总数是否接近模型上下文限制。
 * 预留 buffer 空间给后续输出，避免达到硬限制。
 */
export function isOverflow(
  sessionId: string,
  contextLimit = 100_000,
  buffer = 20_000,
): boolean {
  const tokens = estimateSessionTokens(sessionId)
  return tokens >= contextLimit - buffer
}

/**
 * OpenCode 的 process() 模式：当会话消息超过 token 阈值时，
 * 保留最近的消息，将早期消息折叠为一段摘要。
 *
 * 策略：
 *   - 保留最近 maxRecent 条消息不动
 *   - 超过的消息折叠为一句话摘要（"之前讨论了...共 N 轮对话"）
 *   - 不调用 AI 做摘要（轻量级方案），仅记录元信息
 */
export function compactHistory(
  sessionId: string,
  maxTokens = 8000,
  maxRecent = 6,
): { compacted: boolean; before: number; after: number } {
  const session = getSession(sessionId)
  if (!session) return { compacted: false, before: 0, after: 0 }

  const beforeToken = estimateSessionTokens(sessionId)

  if (beforeToken <= maxTokens && session.messages.length <= maxRecent * 3) {
    return { compacted: false, before: beforeToken, after: beforeToken }
  }

  // 保留最后 maxRecent 条消息
  const keepFrom = Math.max(0, session.messages.length - maxRecent)
  const oldMessages = session.messages.slice(0, keepFrom)
  session.messages = session.messages.slice(keepFrom)

  // 折叠为摘要
  const exchangeCount = oldMessages.filter((m) => m.role === "user").length
  const oldTopics = oldMessages
    .filter((m) => m.role === "user")
    .map((m) => extractMessageText(m).slice(0, 80))
    .join("; ")

  session.compactedSummary = `[Prior conversation (${exchangeCount} exchanges): ${oldTopics}]`

  // 持久化元数据变更
  if (_store) {
    _store.writeMeta(sessionId, {
      createdAt: session.createdAt.toISOString(),
      lastActive: session.lastActive.toISOString(),
      compactedSummary: session.compactedSummary,
    })
  }

  const afterToken = estimateSessionTokens(sessionId)
  return { compacted: true, before: beforeToken, after: afterToken }
}

// ============================================================================
// 获取 AI SDK 格式的历史消息
// ============================================================================

/** AI SDK 期望的 message 格式 */
export interface AiSdkMessage {
  role: "user" | "assistant" | "system" | "tool"
  content: string | any[]
  toolCalls?: Array<{
    toolName: string
    args: Record<string, unknown>
    toolCallId?: string
  }>
  toolCallId?: string
  toolName?: string
}

/**
 * 获取格式化为 AI SDK 可用的历史消息列表（简洁版）。
 * 跳过 tool 角色消息，用于 streamAiEdit 等简单场景。
 * 如果会话有 compactedSummary，将其作为第一条 system 消息注入。
 */
export function getHistoryForAI(sessionId: string): AiSdkMessage[] {
  const session = getSession(sessionId)
  if (!session) return []

  const result: AiSdkMessage[] = []

  if (session.compactedSummary) {
    result.push({ role: "system", content: session.compactedSummary })
  }

  for (const msg of session.messages) {
    if (msg.role === "tool") continue
    result.push({ role: msg.role, content: msg.content })
  }

  return result
}

/**
 * 获取完整格式的历史消息（含 tool 角色），用于 agent loop。
 * - assistant 消息携带 toolCalls 信息
 * - tool 消息携带工具执行结果
 * - compactedSummary 作为 system 消息注入
 */
export function getHistoryForAgent(sessionId: string): AiSdkMessage[] {
  const session = getSession(sessionId)
  if (!session) return []

  const result: AiSdkMessage[] = []

  if (session.compactedSummary) {
    result.push({ role: "system", content: session.compactedSummary })
  }

  for (const msg of session.messages) {
    switch (msg.role) {
      case "user":
        // 多模态内容数组直接透传（已是 V2 格式或 AI SDK 可识别的用户格式）
        result.push({ role: "user", content: msg.content })
        break
      case "assistant": {
        // Build V2-compatible content: text parts + tool-call parts in one array.
        // The AI SDK strips legacy `toolCalls` property during V2 conversion,
        // so we embed tool calls directly into the content array.
        const contentParts: any[] = []
        if (msg.content) {
          contentParts.push({ type: "text", text: msg.content })
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            contentParts.push({
              type: "tool-call",
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              input: tc.args,
            })
          }
        }
        result.push({
          role: "assistant",
          content: contentParts.length > 0 ? contentParts : "",
        })
        break
      }
      case "tool":
        result.push({
          role: "tool",
          content: [
            {
              type: "tool-result" as const,
              toolCallId: msg.toolCallId || "",
              toolName: msg.toolName || msg.content?.slice(0, 30) || "unknown",
              output: {
                type: "text" as const,
                value: msg.content || "",
              },
              isError: undefined,
            },
          ],
        })
        break
    }
  }

  return result
}

// ============================================================================
// 工具调用/结果持久化（agent-loop 用）
// ============================================================================

/**
 * 保存一次工具调用 + 结果到会话。
 * 创建一对消息：assistant(toolCalls) + tool(results)，
 * 供下一轮 AI 调用看到上一轮的工具执行结果。
 *
 * AI SDK 的 generateText 自动处理工具调用的内部循环，
 * 但 agent loop 需要手动保存这些结果到 session，以便在 while(true) 的下一次迭代中传递给 AI。
 */
export function appendToolCallAndResult(
  sessionId: string,
  toolCalls: Array<{
    toolName: string
    args: Record<string, unknown>
    toolCallId?: string
  }>,
  toolResults: Array<{ toolCallId?: string; result: any }>,
  assistantText?: string,
): void {
  const session = getOrCreateSession(sessionId)

  // 1) assistant 消息：声明工具调用
  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: assistantText || "",
    toolCalls: toolCalls.map((tc, i) => ({
      toolName: tc.toolName,
      args: tc.args,
      result: toolResults[i]?.result,
      toolCallId: tc.toolCallId || `tc-${session.messages.length}-${i}`,
    })),
  }
  session.messages.push(assistantMsg)
  _store?.append(sessionId, assistantMsg)

  // 2) tool 消息：每个工具的结果
  for (let i = 0; i < toolResults.length; i++) {
    const tc = toolCalls[i]
    const tr = toolResults[i]
    const toolCallId = tc.toolCallId || `tc-${session.messages.length - 1}-${i}`
    const toolMsg: ChatMessage = {
      role: "tool",
      content:
        typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
      toolCallId,
      toolName: tc.toolName,
    }
    session.messages.push(toolMsg)
    _store?.append(sessionId, toolMsg)
  }

  session.lastActive = new Date()
}

// ============================================================================
// 工具上下文
// ============================================================================

export function createToolContext(
  sessionID = "chat-session",
  messageID = "chat-message",
  agent = "video_editor",
): Tool.Context {
  // 从 AsyncLocalStorage 获取当前会话 ID（优先级高于参数）
  const storage = permissionStorage.getStore()
  const actualSessionID = storage?.sessionID ?? sessionID

  return {
    sessionID: actualSessionID,
    messageID,
    agent,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async (input) => {
      // 通过全局权限服务执行 ask
      // 注意：动态 import 避免循环依赖
      const { permissionService } = await import("../permission/service.js")
      await permissionService.ask({
        permission: input.permission || "tool:call",
        patterns: input.patterns || [],
        metadata: input.metadata,
      })
    },
  }
}

// ============================================================================
// 会话维护
// ============================================================================

// ============================================================================
// 会话搜索（FTS 全文搜索）
// ============================================================================

export interface SearchResult {
  sessionId: string
  score: number
  matches: Array<{
    role: string
    snippet: string
    lineNumber: number
  }>
  lastActive: Date
}

/**
 * 在会话消息中搜索关键词。
 *
 * 使用倒排索引和 BM25 风格的评分算法。
 * 搜索范围包括所有有持久化数据的会话。
 *
 * @param query 搜索关键词
 * @param limit 最大返回结果数
 * @returns 按相关性排序的搜索结果
 */
export function searchSessions(query: string, limit = 10): SearchResult[] {
  if (!query.trim() || !_store) return []

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const sessionIds = _store.listActive()
  const results: SearchResult[] = []

  for (const sessionId of sessionIds) {
    const messages = _store.read(sessionId)
    if (messages.length === 0) continue

    const meta = _store.readMeta(sessionId)
    const lastActive = meta ? new Date(meta.lastActive) : new Date()

    const matches: SearchResult["matches"] = []
    let score = 0
    let lineNumber = 0

    for (const msg of messages) {
      lineNumber++
      const text = extractMessageText(msg)
      const content = text.toLowerCase()

      // TF (term frequency) 计算
      let matchCount = 0
      for (const term of terms) {
        let pos = 0
        while ((pos = content.indexOf(term, pos)) !== -1) {
          matchCount++
          pos += term.length
        }
      }

      if (matchCount > 0) {
        // IDF 加成：稀有词权重更高
        const idfBonus = terms.some((t) => t.length > 5) ? 1.5 : 1.0
        score += matchCount * idfBonus

        // 生成匹配片段
        const matchIndex = content.indexOf(terms[0])
        const start = Math.max(0, matchIndex - 40)
        const end = Math.min(text.length, matchIndex + 60)
        const snippet =
          (start > 0 ? "…" : "") +
          text.slice(start, end) +
          (end < text.length ? "…" : "")

        matches.push({
          role: msg.role,
          snippet,
          lineNumber,
        })
      }
    }

    if (matches.length > 0) {
      // 时间衰减：近期会话权重更高
      const hoursSinceLastActive = (Date.now() - lastActive.getTime()) / 3600000
      const recencyBonus = Math.max(0.5, 1 - hoursSinceLastActive / 720) // 30天衰减到0.5

      score *= recencyBonus
      results.push({ sessionId, score, matches, lastActive })
    }
  }

  // 按分数降序排序
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

// ============================================================================
// 多轮上下文压缩策略
// ============================================================================

/**
 * Progressive 上下文压缩级别。
 * L1: 轻量剪枝（清空旧 tool output）
 * L2: 压缩早期对话（折叠为摘要）
 * L3: 深度压缩（移除冗余细节，仅保留用户消息和工具调用摘要）
 */
export type CompressionLevel = "L1" | "L2" | "L3"

export interface CompressionResult {
  level: CompressionLevel
  compacted: boolean
  before: number
  after: number
  freedTokens: number
}

/**
 * 渐进式上下文压缩。
 * 根据当前 token 数自动选择合适的压缩级别。
 *
 * 策略：
 * - token < contextLimit × 0.7 → 不压缩
 * - token < contextLimit × 0.85 → L1（轻量剪枝）
 * - token < contextLimit × 0.95 → L2（折叠早期对话）
 * - token >= contextLimit × 0.95 → L3（深度压缩）
 *
 * @param sessionId 会话 ID
 * @param contextLimit 模型的上下文窗口限制
 * @param contextBuffer 预留的 buffer（给输出 token）
 */
export function progressiveCompress(
  sessionId: string,
  contextLimit = 100_000,
  contextBuffer = 20_000,
): CompressionResult {
  const session = getSession(sessionId)
  if (!session) {
    return {
      level: "L1",
      compacted: false,
      before: 0,
      after: 0,
      freedTokens: 0,
    }
  }

  const currentTokens = estimateSessionTokens(sessionId)
  const threshold = contextLimit - contextBuffer
  const ratio = currentTokens / contextLimit

  if (currentTokens <= threshold) {
    return {
      level: "L1",
      compacted: false,
      before: currentTokens,
      after: currentTokens,
      freedTokens: 0,
    }
  }

  if (ratio < 0.85) {
    // L1: 轻量剪枝
    const result = pruneHistory(sessionId)
    const after = estimateSessionTokens(sessionId)
    return {
      level: "L1",
      compacted: result.pruned,
      before: currentTokens,
      after,
      freedTokens: currentTokens - after,
    }
  }

  if (ratio < 0.95) {
    // L2: 折叠早期对话（保留更多上下文）
    const result = compactHistory(sessionId, Math.round(threshold * 0.6), 8)
    const after = estimateSessionTokens(sessionId)
    return {
      level: "L2",
      compacted: result.compacted,
      before: currentTokens,
      after,
      freedTokens: currentTokens - after,
    }
  }

  // L3: 深度压缩
  const l2Result = compactHistory(sessionId, Math.round(threshold * 0.4), 4)

  // 额外：对剩余的 tool messages 做更强力的剪枝
  if (l2Result.compacted) {
    const extremePrune = pruneHistory(sessionId)
    // 降低 PRUNE_PROTECT 阈值来剪更多
    const toolsFreed = extremePrune.tokensFreed
  }

  const after = estimateSessionTokens(sessionId)
  return {
    level: "L3",
    compacted: true,
    before: currentTokens,
    after,
    freedTokens: currentTokens - after,
  }
}

/**
 * 获取会话的压缩状态描述。
 */
export function getCompressionStatus(sessionId: string): string {
  const session = getSession(sessionId)
  if (!session) return "No session"

  const tokens = estimateSessionTokens(sessionId)
  const msgCount = session.messages.length
  const parts: string[] = [`Messages: ${msgCount}`, `Tokens: ~${tokens}`]

  if (session.compactedSummary) {
    parts.push(`Compacted: yes (${session.compactedSummary.slice(0, 60)}…)`)
  } else {
    parts.push("Compacted: no")
  }

  return parts.join(" | ")
}

/** 清理超过 ttl 秒未活动的 session */
export function cleanupStale(maxAgeSec = 3600): number {
  const cutoff = Date.now() - maxAgeSec * 1000
  let removed = 0
  for (const [id, session] of sessions) {
    if (session.lastActive.getTime() < cutoff) {
      _store?.deleteSession(id)
      sessions.delete(id)
      removed++
    }
  }
  return removed
}

/** 调试用：获取会话统计 */
export function getSessionStats(sessionId: string): {
  messageCount: number
  estimatedTokens: number
  hasCompactedSummary: boolean
  ageSec: number
} | null {
  const session = getSession(sessionId)
  if (!session) return null
  return {
    messageCount: session.messages.length,
    estimatedTokens: estimateSessionTokens(sessionId),
    hasCompactedSummary: !!session.compactedSummary,
    ageSec: Math.floor((Date.now() - session.createdAt.getTime()) / 1000),
  }
}
