/**
 * jianjicode 类型化错误系统
 *
 * 全链路统一的错误分类、错误码、错误类层次结构。
 *
 * 设计原则：
 *   - 每个错误都有 ErrorCode（机器可读）和 message（人可读）
 *   - 分类为 transient（可重试）和 permanent（不可重试）
 *   - AppError 类族自带分类，无需额外判断
 *   - classifyError() 可将任意 error（含第三方异常）映射到标准化结构
 */

// ============================================================================
// 错误码枚举
// ============================================================================

export enum ErrorCode {
  // === 工具执行 ===
  TOOL_EXECUTION_FAILED = "TOOL_EXECUTION_FAILED",
  TOOL_INIT_FAILED = "TOOL_INIT_FAILED",
  TOOL_INVALID_ARGS = "TOOL_INVALID_ARGS",
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  TOOL_TIMEOUT = "TOOL_TIMEOUT",

  // === 模型 / AI ===
  MODEL_TIMEOUT = "MODEL_TIMEOUT",
  MODEL_RATE_LIMITED = "MODEL_RATE_LIMITED",
  MODEL_CONTEXT_OVERFLOW = "MODEL_CONTEXT_OVERFLOW",
  MODEL_AUTH_FAILED = "MODEL_AUTH_FAILED",
  MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE",
  MODEL_INTERNAL_ERROR = "MODEL_INTERNAL_ERROR",

  // === Python 桥接 ===
  BRIDGE_CONNECTION_FAILED = "BRIDGE_CONNECTION_FAILED",
  BRIDGE_TIMEOUT = "BRIDGE_TIMEOUT",
  BRIDGE_INTERNAL_ERROR = "BRIDGE_INTERNAL_ERROR",

  // === 断路器 ===
  CIRCUIT_OPEN = "CIRCUIT_OPEN",

  // === 权限 ===
  PERMISSION_DENIED = "PERMISSION_DENIED",
  PERMISSION_REJECTED = "PERMISSION_REJECTED",
  PERMISSION_TIMEOUT = "PERMISSION_TIMEOUT",

  // === 会话 ===
  SESSION_NOT_FOUND = "SESSION_NOT_FOUND",

  // === 通用 ===
  UNKNOWN_ERROR = "UNKNOWN_ERROR",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

// ============================================================================
// 错误分类
// ============================================================================

/** transient = 可重试的临时错误，permanent = 不可恢复的永久错误 */
export type ErrorCategory = "transient" | "permanent"

/** 每个 ErrorCode 映射到分类 */
export const ERROR_CATEGORY: Record<ErrorCode, ErrorCategory> = {
  // 工具 — 通常是永久错误（代码 bug 或无效参数）
  [ErrorCode.TOOL_EXECUTION_FAILED]: "permanent",
  [ErrorCode.TOOL_INIT_FAILED]: "transient", // 依赖服务可能恢复
  [ErrorCode.TOOL_INVALID_ARGS]: "permanent",
  [ErrorCode.TOOL_NOT_FOUND]: "permanent",
  [ErrorCode.TOOL_TIMEOUT]: "transient",

  // 模型 — 大部分是临时错误（限流、过载）
  [ErrorCode.MODEL_TIMEOUT]: "transient",
  [ErrorCode.MODEL_RATE_LIMITED]: "transient",
  [ErrorCode.MODEL_CONTEXT_OVERFLOW]: "permanent", // 需要 compaction
  [ErrorCode.MODEL_AUTH_FAILED]: "permanent",
  [ErrorCode.MODEL_UNAVAILABLE]: "transient",
  [ErrorCode.MODEL_INTERNAL_ERROR]: "transient",

  // 桥接
  [ErrorCode.BRIDGE_CONNECTION_FAILED]: "transient",
  [ErrorCode.BRIDGE_TIMEOUT]: "transient",
  [ErrorCode.BRIDGE_INTERNAL_ERROR]: "transient",

  // 断路器
  [ErrorCode.CIRCUIT_OPEN]: "transient", // 断路器会自恢复

  // 权限
  [ErrorCode.PERMISSION_DENIED]: "permanent",
  [ErrorCode.PERMISSION_REJECTED]: "permanent",
  [ErrorCode.PERMISSION_TIMEOUT]: "transient", // 超时可重试

  // 会话
  [ErrorCode.SESSION_NOT_FOUND]: "permanent",

  // 通用
  [ErrorCode.UNKNOWN_ERROR]: "permanent",
  [ErrorCode.INTERNAL_ERROR]: "permanent",
}

// ============================================================================
// 错误类层次
// ============================================================================

export interface AppErrorFields {
  code: ErrorCode
  category: ErrorCategory
  message: string
  cause?: unknown
  details?: Record<string, unknown>
}

/**
 * 基类 — 所有类型化错误继承自此类。
 * 与普通 Error 的 key 区别：有 code + category，便于机器路由。
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly category: ErrorCategory
  readonly details?: Record<string, unknown>
  declare readonly cause?: unknown

  constructor(fields: AppErrorFields) {
    super(fields.message)
    this.name = "AppError"
    this.code = fields.code
    this.category = fields.category
    this.cause = fields.cause
    this.details = fields.details
  }

  /** 是否可重试（transient 类错误 + 断路器自恢复） */
  get retryable(): boolean {
    return this.category === "transient"
  }

  /** 转换为序列化对象 */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    }
  }
}

// ============================================================================
// 具体错误子类
// ============================================================================

export class ToolError extends AppError {
  constructor(
    code:
      | ErrorCode.TOOL_EXECUTION_FAILED
      | ErrorCode.TOOL_INIT_FAILED
      | ErrorCode.TOOL_INVALID_ARGS
      | ErrorCode.TOOL_NOT_FOUND
      | ErrorCode.TOOL_TIMEOUT,
    message: string,
    opts?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super({
      code,
      category: ERROR_CATEGORY[code],
      message,
      cause: opts?.cause,
      details: opts?.details,
    })
    this.name = "ToolError"
  }
}

export class ModelError extends AppError {
  constructor(
    code:
      | ErrorCode.MODEL_TIMEOUT
      | ErrorCode.MODEL_RATE_LIMITED
      | ErrorCode.MODEL_CONTEXT_OVERFLOW
      | ErrorCode.MODEL_AUTH_FAILED
      | ErrorCode.MODEL_UNAVAILABLE
      | ErrorCode.MODEL_INTERNAL_ERROR,
    message: string,
    opts?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super({
      code,
      category: ERROR_CATEGORY[code],
      message,
      cause: opts?.cause,
      details: opts?.details,
    })
    this.name = "ModelError"
  }
}

export class BridgeError extends AppError {
  constructor(
    code:
      | ErrorCode.BRIDGE_CONNECTION_FAILED
      | ErrorCode.BRIDGE_TIMEOUT
      | ErrorCode.BRIDGE_INTERNAL_ERROR,
    message: string,
    opts?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super({
      code,
      category: ERROR_CATEGORY[code],
      message,
      cause: opts?.cause,
      details: opts?.details,
    })
    this.name = "BridgeError"
  }
}

export class CircuitBreakerError extends AppError {
  constructor(
    breakerName: string,
    message?: string,
    opts?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super({
      code: ErrorCode.CIRCUIT_OPEN,
      category: "transient",
      message: message || `Circuit breaker "${breakerName}" is open`,
      cause: opts?.cause,
      details: { ...opts?.details, breakerName },
    })
    this.name = "CircuitBreakerError"
  }
}

// ============================================================================
// 错误分类器 — 将任意 error 映射到标准化结构
// ============================================================================

/** 匹配 HTTP 4xx/5xx 或常见网络错误 */
const RETRYABLE_PATTERNS = [
  "rate limit",
  "rate_limit",
  "too many requests",
  "429",
  "503",
  "502",
  "504",
  "timeout",
  "abort",
  "internal server error",
  "internal_server_error",
  "service unavailable",
  "overloaded",
  "try again",
  "temporary",
  "connection refused",
  "econnrefused",
  "econnreset",
  "enotfound",
  "fetch failed",
  "network error",
  "dns",
  "backend response failed",
  "上游服务超时",
  "系统繁忙",
  "服务端异常",
]

const CONTEXT_OVERFLOW_PATTERNS = [
  "context length",
  "context overflow",
  "maximum context",
  "token limit",
  "too many tokens",
  "输入长度",
  "max_input_tokens",
  "context_length_exceeded",
]

const AUTH_PATTERNS = [
  "auth",
  "api key",
  "unauthorized",
  "401",
  "403",
  "invalid key",
  "permission denied",
  "not authorized",
  "forbidden",
]

/**
 * 将任意 error 分类为标准化结构。
 * 能识别 AppError → 直接使用其 code/category，
 * 对普通 Error/string → 通过消息模式匹配归类。
 */
export function classifyError(error: unknown): {
  code: ErrorCode
  category: ErrorCategory
  message: string
  retryable: boolean
} {
  // AppError — 直接使用自身分类
  if (error instanceof AppError) {
    return {
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: error.retryable,
    }
  }

  const message = extractMessage(error)
  const lower = message.toLowerCase()

  // 匹配已知模式
  if (CONTEXT_OVERFLOW_PATTERNS.some((p) => lower.includes(p))) {
    return {
      code: ErrorCode.MODEL_CONTEXT_OVERFLOW,
      category: "permanent",
      message,
      retryable: false,
    }
  }
  if (AUTH_PATTERNS.some((p) => lower.includes(p))) {
    return {
      code: ErrorCode.MODEL_AUTH_FAILED,
      category: "permanent",
      message,
      retryable: false,
    }
  }
  if (RETRYABLE_PATTERNS.some((p) => lower.includes(p))) {
    return {
      code: ErrorCode.UNKNOWN_ERROR,
      category: "transient",
      message,
      retryable: true,
    }
  }
  if (lower.includes("circuit") && lower.includes("open")) {
    return {
      code: ErrorCode.CIRCUIT_OPEN,
      category: "transient",
      message,
      retryable: true,
    }
  }

  return {
    code: ErrorCode.UNKNOWN_ERROR,
    category: "permanent",
    message,
    retryable: false,
  }
}

/** 从未知类型提取错误消息 */
export function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const msg =
      (error as any).message ||
      (error as any).error ||
      (error as any).toString()
    return String(msg)
  }
  return String(error)
}

// ============================================================================
// 兼容性：将类型化错误写入 LTXEditResult
// ============================================================================

import type { EditMetadata } from "./edit-result.js"

/**
 * 向 EditMetadata 注入错误信息。
 * 返回新的 metadata 副本，不修改原对象。
 */
export function annotateMetadataWithError(
  metadata: EditMetadata,
  error: AppError | { code?: ErrorCode; message: string },
): EditMetadata {
  return {
    ...metadata,
    error: true,
    success: false,
    error_message: error.message,
    error_code: error.code || ErrorCode.UNKNOWN_ERROR,
  }
}
