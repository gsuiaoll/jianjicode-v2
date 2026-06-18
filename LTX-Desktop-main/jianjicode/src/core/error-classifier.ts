/**
 * jianjicode Error Classifier — 错误分类与恢复策略引擎
 *
 * 将错误分为 7 类，每类附带推荐的恢复动作，供 agent-loop 重试逻辑和
 * skill-manager 自修复系统使用。
 *
 * 构建在 errors.ts 类型系统之上，粒度更细：
 *   errors.ts → code + category (transient/permanent)
 *   本模块 → type + recoveryAction + severity
 *
 * @license MIT
 */

import {
  classifyError as baseClassify,
  type ErrorCategory,
  ErrorCode,
  extractMessage,
} from "../types/errors.js"

// ============================================================================
// 错误类型 — 7 种
// ============================================================================

export type ErrorType =
  | "api" // 外部 API 错误（HTTP 4xx/5xx、限流等）
  | "tool" // 工具执行错误（参数无效、执行失败）
  | "permission" // 权限拒绝
  | "network" // 网络错误（DNS、连接重置、超时）
  | "model" // AI 模型错误（上下文溢出、认证失败）
  | "input" // 用户输入错误（无效路径、缺失参数）
  | "system" // 系统内部错误（空指针、断言失败）
  | "unknown" // 无法分类

// ============================================================================
// 恢复动作
// ============================================================================

export type RecoveryAction =
  | "retry_with_backoff" // 临时错误，指数退避重试
  | "switch_model" // 模型问题，切换到备用模型
  | "compact_context" // 上下文溢出，压缩后重试
  | "fallback_provider" // provider 问题，切换备用
  | "report_to_user" // 需要用户介入
  | "fix_tool_args" // 工具参数错误，让 AI 重新生成
  | "skip_skill" // 技能本身缺陷，跳过
  | "none" // 无需操作

// ============================================================================
// 严重级别
// ============================================================================

export type Severity = "low" | "medium" | "high" | "critical"

// ============================================================================
// 分类结果
// ============================================================================

export interface ErrorClassification {
  type: ErrorType
  code: ErrorCode
  category: ErrorCategory
  recoveryAction: RecoveryAction
  severity: Severity
  message: string
  retryable: boolean
  /** 是否可能是技能本身的问题（用于自修复归因） */
  likelySkillProblem: boolean
  /** 友好建议（人可读） */
  suggestion: string
  details?: Record<string, unknown>
}

// ============================================================================
// 错误类型检测模式
// ============================================================================

const NETWORK_PATTERNS = [
  "fetch failed",
  "network error",
  "econnrefused",
  "econnreset",
  "enotfound",
  "dns",
  "socket",
  "connection",
  "eaddrinfo",
  "eaddrinuse",
  "enetunreach",
  "etimedout",
]

const API_PATTERNS = [
  "429",
  "500",
  "502",
  "503",
  "504",
  "rate limit",
  "rate_limit",
  "too many requests",
  "overloaded",
  "service unavailable",
  "internal server error",
  "internal_server_error",
  "bad gateway",
  "gateway timeout",
  "backend response failed",
  "上游服务超时",
  "系统繁忙",
  "服务端异常",
]

const MODEL_PATTERNS = [
  "context length",
  "context overflow",
  "maximum context",
  "token limit",
  "too many tokens",
  "context_length_exceeded",
  "max_input_tokens",
  "输入长度",
]

const AUTH_PATTERNS = [
  "auth",
  "api key",
  "unauthorized",
  "401",
  "403",
  "invalid key",
  "not authorized",
  "forbidden",
  "permission denied",
  "access denied",
]

const TOOL_PATTERNS = [
  "tool execution",
  "tool call",
  "invalid args",
  "invalid arguments",
  "required parameter",
  "validation error",
  "invalid input",
]

const INPUT_PATTERNS = [
  "not found",
  "file not found",
  "no such file",
  "invalid path",
  "invalid format",
  "unsupported",
  "EACCES",
  "EISDIR",
  "ENOENT",
]

const SYSTEM_PATTERNS = [
  "cannot read property",
  "undefined is not",
  "null pointer",
  "assertion failed",
  "internal error",
  "stack overflow",
  "out of memory",
]

// ============================================================================
// 恢复策略映射
// ============================================================================

function recoveryForType(type: ErrorType, code: ErrorCode): RecoveryAction {
  if (code === ErrorCode.MODEL_CONTEXT_OVERFLOW) return "compact_context"
  if (code === ErrorCode.MODEL_AUTH_FAILED) return "report_to_user"
  if (
    code === ErrorCode.PERMISSION_DENIED ||
    code === ErrorCode.PERMISSION_REJECTED
  )
    return "report_to_user"
  if (code === ErrorCode.TOOL_INVALID_ARGS) return "fix_tool_args"

  switch (type) {
    case "api":
      return "retry_with_backoff"
    case "tool":
      return "fix_tool_args"
    case "permission":
      return "report_to_user"
    case "network":
      return "fallback_provider"
    case "model":
      return "switch_model"
    case "input":
      return "report_to_user"
    case "system":
      return "report_to_user"
    default:
      return "retry_with_backoff"
  }
}

function severityForType(type: ErrorType): Severity {
  switch (type) {
    case "api":
      return "low"
    case "tool":
      return "medium"
    case "permission":
      return "high"
    case "network":
      return "medium"
    case "model":
      return "medium"
    case "input":
      return "low"
    case "system":
      return "critical"
    default:
      return "medium"
  }
}

function likelySkillProblemForType(type: ErrorType): boolean {
  // 工具参数错误和输入错误可能是技能步骤/参数不准确导致的
  return type === "tool" || type === "input"
}

function suggestionForType(type: ErrorType, message: string): string {
  switch (type) {
    case "api":
      return "API 临时异常，自动重试中"
    case "tool":
      return "工具调用参数可能不准确，将重新生成"
    case "permission":
      return "操作被权限系统拒绝，需要用户确认"
    case "network":
      return "网络异常，尝试切换到备用 provider"
    case "model":
      return message.includes("context") || message.includes("token")
        ? "上下文过长，正在压缩后重试"
        : "模型响应异常，尝试切换到备用模型"
    case "input":
      return "输入路径或参数无效，请检查后重试"
    case "system":
      return "系统内部错误，请报告此问题"
    default:
      return "未知错误，尝试重试"
  }
}

// ============================================================================
// 主分类函数
// ============================================================================

/**
 * 对错误进行精细化分类。
 *
 * 比 errors.ts 的 classifyError 更细粒度：
 * - 返回 7 种 ErrorType 而非 2 种 ErrorCategory
 * - 附带推荐的 RecoveryAction
 * - 附带 severity 和 human-readable suggestion
 * - 附带 likelySkillProblem 用于自修复归因
 */
export function classifyErrorDetailed(error: unknown): ErrorClassification {
  // 先用基础分类器获取 code/category
  const base = baseClassify(error)
  const message = base.message
  const lower = message.toLowerCase()

  let type: ErrorType = "unknown"

  // 按优先级匹配错误模式
  if (AUTH_PATTERNS.some((p) => lower.includes(p))) {
    type = "permission"
  } else if (NETWORK_PATTERNS.some((p) => lower.includes(p))) {
    type = "network"
  } else if (API_PATTERNS.some((p) => lower.includes(p))) {
    type = "api"
  } else if (MODEL_PATTERNS.some((p) => lower.includes(p))) {
    type = "model"
  } else if (TOOL_PATTERNS.some((p) => lower.includes(p))) {
    type = "tool"
  } else if (INPUT_PATTERNS.some((p) => lower.includes(p))) {
    type = "input"
  } else if (SYSTEM_PATTERNS.some((p) => lower.includes(p))) {
    type = "system"
  } else if (base.code !== ErrorCode.UNKNOWN_ERROR) {
    // 基础分类器已识别但未匹配模式 — 根据 code 推断
    const code = base.code
    if (code.startsWith("TOOL_")) type = "tool"
    else if (code.startsWith("MODEL_")) type = "model"
    else if (code.startsWith("BRIDGE_")) type = "api"
    else if (code.startsWith("PERMISSION_")) type = "permission"
    else if (code.startsWith("CIRCUIT_")) type = "network"
  }

  const recoveryAction = recoveryForType(type, base.code)
  const severity = severityForType(type)
  const skillProblem = likelySkillProblemForType(type)

  return {
    type,
    code: base.code,
    category: base.category,
    recoveryAction,
    severity,
    message: base.message,
    retryable: base.retryable,
    likelySkillProblem: skillProblem,
    suggestion: suggestionForType(type, base.message),
  }
}

/**
 * 批量分类错误统计。
 * 用于 agent-loop 在多次重试后做决策。
 */
export interface ErrorStats {
  total: number
  byType: Partial<Record<ErrorType, number>>
  byCode: Partial<Record<ErrorCode, number>>
  retryableCount: number
  permanentCount: number
  mostCommonType: ErrorType
  firstClassification: ErrorClassification
  lastClassification: ErrorClassification
}

/**
 * 对一组错误进行统计分析。
 */
export function analyzeErrors(errors: unknown[]): ErrorStats {
  const classified = errors.map((e) => classifyErrorDetailed(e))
  const byType: Partial<Record<ErrorType, number>> = {}
  const byCode: Partial<Record<ErrorCode, number>> = {}

  for (const c of classified) {
    byType[c.type] = (byType[c.type] || 0) + 1
    byCode[c.code] = (byCode[c.code] || 0) + 1
  }

  // 找最常见的错误类型
  let mostCommonType: ErrorType = "unknown"
  let maxCount = 0
  for (const [t, count] of Object.entries(byType)) {
    if (count > maxCount) {
      maxCount = count
      mostCommonType = t as ErrorType
    }
  }

  return {
    total: errors.length,
    byType,
    byCode,
    retryableCount: classified.filter((c) => c.retryable).length,
    permanentCount: classified.filter((c) => !c.retryable).length,
    mostCommonType,
    firstClassification: classified[0],
    lastClassification: classified[classified.length - 1],
  }
}

/**
 * 判断是否应该触发 skill 自修复。
 * 当连续多次错误都 likelySkillProblem=true 时，触发 patch。
 */
export function shouldTriggerSkillPatch(
  errors: unknown[],
  threshold = 2,
): boolean {
  if (errors.length < threshold) return false
  const recent = errors.slice(-threshold)
  return recent.every((e) => classifyErrorDetailed(e).likelySkillProblem)
}
