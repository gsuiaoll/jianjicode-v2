/**
 * 统一视频编辑操作返回类型 — 全链路唯一 Result 类型
 *
 * 从 Tool.execute → chat-core → CLI/HTTP → Python handler → FastAPI
 * 所有层使用同一结构，消除各层之间的格式转换。
 */

// ============================================================================
// 核心类型
// ============================================================================

export interface EditAttachment {
  filename: string
  path: string
  mimeType: string
  size?: number
}

export interface EditMetadata {
  /** Primary output file path */
  outputPath?: string
  /** Error flag (false = success) */
  error?: boolean
  /** Explicit success flag */
  success?: boolean
  /** Human-readable error message */
  error_message?: string
  /** Allow arbitrary additional fields */
  [key: string]: unknown
}

export interface LTXEditResult<TMetadata extends EditMetadata = EditMetadata> {
  success: boolean
  title: string
  output: string
  operation: string
  toolId?: string
  error?: string
  metadata: TMetadata
  attachments?: EditAttachment[]
  aiOutput?: string
}

// ============================================================================
// 工具函数 — 创建标准化结果
// ============================================================================

/** 创建错误结果 */
export function editResultError(
  operation: string,
  error: string,
  toolId?: string,
): LTXEditResult {
  return {
    success: false,
    title: `${operation} failed`,
    output: error,
    operation,
    toolId,
    error,
    metadata: { error: true, success: false },
  }
}

/** 从 Tool.execute() 的返回值创建 LTXEditResult */
export function editResultFromTool(
  result: {
    title: string
    metadata: Record<string, unknown>
    output: string
    attachments?: unknown[]
  },
  toolId: string,
): LTXEditResult {
  return {
    success: !result.metadata?.error,
    title: result.title,
    output: result.output,
    operation: (result.metadata?.operation as string) || toolId,
    toolId,
    error: result.metadata?.error
      ? (result.metadata?.error_message as string) || result.output
      : undefined,
    metadata: result.metadata as EditMetadata,
    attachments: result.attachments as EditAttachment[] | undefined,
  }
}

/** 从 Python EditResponse 创建 LTXEditResult */
export function editResultFromPython(
  response: {
    success: boolean
    operation: string
    output_path?: string
    error?: string
    metadata?: Record<string, unknown>
  },
  toolId?: string,
): LTXEditResult {
  return {
    success: response.success,
    title: response.success
      ? `${response.operation} completed`
      : `${response.operation} failed`,
    output: response.output_path
      ? `Output: ${response.output_path}`
      : response.error || "",
    operation: response.operation,
    toolId: toolId || response.operation,
    error: response.error,
    metadata: {
      ...(response.metadata || {}),
      outputPath: response.output_path,
      error: !response.success,
      success: response.success,
    },
  }
}
