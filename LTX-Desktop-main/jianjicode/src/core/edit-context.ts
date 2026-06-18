/**
 * 编辑上下文追踪
 *
 * 在多轮对话中跟踪当前编辑状态：正在处理哪个视频、已应用了哪些操作、
 * 视频的基本信息等。这些信息会被注入到 system prompt 中，帮助 AI
 * 做出上下文感知的决策。
 */

// ============================================================================
// 类型定义
// ============================================================================

export interface VideoInfo {
  duration?: number
  width?: number
  height?: number
  fps?: number
  codec?: string
  format?: string
  fileSize?: number
}

export interface AppliedEffect {
  toolId: string
  description: string
  timestamp: number
  params?: Record<string, unknown>
}

export interface EditContext {
  /** 当前正在编辑的视频文件路径 */
  currentVideo?: string
  /** 视频基本信息 */
  videoInfo?: VideoInfo
  /** 上次执行的操作描述 */
  lastOperation?: string
  /** 已应用的效果列表（按时间顺序） */
  appliedEffects: AppliedEffect[]
  /** 待执行的操作（用户提到但尚未执行的） */
  pendingOperations: string[]
  /** 用户偏好（从对话中学习） */
  preferences: Record<string, string>
  /** 上下文创建时间 */
  createdAt: number
  /** 最后更新时间 */
  updatedAt: number
}

// ============================================================================
// 创建与更新
// ============================================================================

export function createEditContext(): EditContext {
  const now = Date.now()
  return {
    appliedEffects: [],
    pendingOperations: [],
    preferences: {},
    createdAt: now,
    updatedAt: now,
  }
}

export function updateEditContext(
  ctx: EditContext,
  patch: Partial<
    Pick<
      EditContext,
      "currentVideo" | "videoInfo" | "lastOperation" | "preferences"
    >
  >,
): EditContext {
  return {
    ...ctx,
    ...patch,
    preferences: patch.preferences
      ? { ...ctx.preferences, ...patch.preferences }
      : ctx.preferences,
    updatedAt: Date.now(),
  }
}

// ============================================================================
// 效果追踪
// ============================================================================

export function addAppliedEffect(
  ctx: EditContext,
  toolId: string,
  description: string,
  params?: Record<string, unknown>,
): EditContext {
  return {
    ...ctx,
    appliedEffects: [
      ...ctx.appliedEffects,
      { toolId, description, timestamp: Date.now(), params },
    ],
    lastOperation: description,
    updatedAt: Date.now(),
  }
}

export function addPendingOperation(
  ctx: EditContext,
  operation: string,
): EditContext {
  if (ctx.pendingOperations.includes(operation)) return ctx
  return {
    ...ctx,
    pendingOperations: [...ctx.pendingOperations, operation],
    updatedAt: Date.now(),
  }
}

export function clearPendingOperations(ctx: EditContext): EditContext {
  return { ...ctx, pendingOperations: [], updatedAt: Date.now() }
}

// ============================================================================
// 摘要生成
// ============================================================================

/**
 * 生成编辑上下文的纯文本摘要，用于注入 system prompt。
 */
export function summarizeEditContext(ctx: EditContext): string {
  const lines: string[] = []

  if (ctx.currentVideo) {
    lines.push(`正在编辑的视频：${ctx.currentVideo}`)
  }
  if (ctx.videoInfo) {
    const vi = ctx.videoInfo
    const parts: string[] = []
    if (vi.duration !== undefined) parts.push(`时长 ${vi.duration}s`)
    if (vi.width && vi.height) parts.push(`${vi.width}x${vi.height}`)
    if (vi.fps) parts.push(`${vi.fps}fps`)
    if (parts.length > 0) lines.push(`视频信息：${parts.join("，")}`)
  }
  if (ctx.appliedEffects.length > 0) {
    const effects = ctx.appliedEffects.map((e) => e.description).join(" → ")
    lines.push(`已应用的效果：${effects}`)
  }
  if (ctx.lastOperation && ctx.appliedEffects.length === 0) {
    lines.push(`上次操作：${ctx.lastOperation}`)
  }

  return lines.join("\n")
}

// ============================================================================
// 持久化辅助
// ============================================================================

/**
 * 将 EditContext 序列化为可存储的 JSON。
 */
export function serializeEditContext(ctx: EditContext): string {
  return JSON.stringify(ctx)
}

/**
 * 从 JSON 字符串反序列化 EditContext。
 */
export function deserializeEditContext(json: string): EditContext | null {
  try {
    const obj = JSON.parse(json)
    if (
      obj &&
      typeof obj.appliedEffects === "object" &&
      typeof obj.pendingOperations === "object"
    ) {
      return {
        currentVideo: obj.currentVideo,
        videoInfo: obj.videoInfo,
        lastOperation: obj.lastOperation,
        appliedEffects: Array.isArray(obj.appliedEffects)
          ? obj.appliedEffects
          : [],
        pendingOperations: Array.isArray(obj.pendingOperations)
          ? obj.pendingOperations
          : [],
        preferences: obj.preferences || {},
        createdAt: obj.createdAt || Date.now(),
        updatedAt: obj.updatedAt || Date.now(),
      }
    }
    return null
  } catch {
    return null
  }
}
