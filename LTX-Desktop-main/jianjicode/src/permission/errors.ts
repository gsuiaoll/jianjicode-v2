/**
 * jianjicode 权限系统 — 类型化错误
 *
 * 三个错误类对应三种权限拒绝场景：
 *   PermissionDeniedError    — 规则匹配 "deny"（配置禁止）
 *   PermissionRejectedError — 用户主动拒绝（点了拒绝按钮）
 *   PermissionTimeoutError  — 用户未回复，超时自动取消
 */

import { AppError, ERROR_CATEGORY, ErrorCode } from "../types/errors.js"

// ============================================================================
// PermissionDeniedError — 规则匹配 "deny"
// ============================================================================

/**
 * 由配置规则触发的拒绝。
 * 当 PermissionRule.action === "deny" 时抛出此错误。
 * 这是"策略性"拒绝 — 由配置文件决定，不可通过用户交互绕过。
 */
export class PermissionDeniedError extends AppError {
  constructor(
    permission: string,
    pattern: string,
    message?: string,
    opts?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super({
      code: ErrorCode.PERMISSION_DENIED,
      category: ERROR_CATEGORY[ErrorCode.PERMISSION_DENIED],
      message:
        message ||
        `Permission denied: ${permission} matching "${pattern}" is not allowed`,
      cause: opts?.cause,
      details: { ...opts?.details, permission, pattern },
    })
    this.name = "PermissionDeniedError"
  }
}

// ============================================================================
// PermissionRejectedError — 用户主动拒绝
// ============================================================================

/**
 * 由用户主动触发的拒绝。
 * 用户在 ask 提示中点了 "deny" 或 "reject" 时抛出。
 * "deny" 模式只拒绝本次，"reject" 模式可附带反馈信息。
 */
export class PermissionRejectedError extends AppError {
  /** 用户附带的反馈信息（仅 "reject" 模式有） */
  readonly feedback?: string
  /** 被拒绝的请求 ID */
  readonly requestID: string

  constructor(
    requestID: string,
    message?: string,
    feedback?: string,
    opts?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super({
      code: ErrorCode.PERMISSION_REJECTED,
      category: ERROR_CATEGORY[ErrorCode.PERMISSION_REJECTED],
      message:
        message || `Permission request ${requestID} was rejected by user`,
      cause: opts?.cause,
      details: { ...opts?.details, requestID, feedback },
    })
    this.name = "PermissionRejectedError"
    this.requestID = requestID
    this.feedback = feedback
  }
}

// ============================================================================
// PermissionTimeoutError — 请求超时
// ============================================================================

/**
 * 权限请求超时 — 用户在 timeoutMs 内未回复。
 * agent-loop 会 catch 此错误并从 pending 表中清理。
 */
export class PermissionTimeoutError extends AppError {
  readonly requestID: string

  constructor(
    requestID: string,
    timeoutMs?: number,
    opts?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super({
      code: ErrorCode.PERMISSION_TIMEOUT,
      category: ERROR_CATEGORY[ErrorCode.PERMISSION_TIMEOUT],
      message: `Permission request ${requestID} timed out after ${timeoutMs ?? 300000}ms`,
      cause: opts?.cause,
      details: { ...opts?.details, requestID, timeoutMs },
    })
    this.name = "PermissionTimeoutError"
    this.requestID = requestID
  }
}
