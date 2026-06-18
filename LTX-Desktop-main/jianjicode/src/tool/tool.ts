/**
 * jianjicode Tool 定义系统
 *
 * 与 ai/tool/tool.ts 功能对齐，包含：
 * - Tool.Context 带 messages / metadata() / ask()
 * - Tool.define 内建 Zod 参数校验
 * - Tool.define 内建输出截断
 * - 向后兼容 defineLtxTool 别名
 *
 * @deprecated 新代码推荐直接使用 ai/tool/tool.ts，本文件保持同步直至废弃。
 */
import z from "zod"

// ============================================================================
// 本地类型桩 — 避免拉入 OpenCode 的完整依赖链
// ============================================================================

type SessionID = string
type MessageID = string
type FilePart = any
type AgentInfo = any
type PermissionRequest = any

// 简化版截断 — 保留完整输出，但类型兼容正式版
interface TruncateResult {
  content: string
  truncated: boolean
  outputPath?: string
}

async function truncateOutput(
  content: string,
  _options?: any,
  _agent?: any,
): Promise<TruncateResult> {
  return { content, truncated: false }
}

// ============================================================================
// Tool 命名空间
// ============================================================================

export namespace Tool {
  export interface Metadata {
    operation?: string
    error?: boolean
    success?: boolean
    [key: string]: any
  }

  export interface InitContext {
    agent?: AgentInfo
  }

  export interface Context<M extends Metadata = Metadata> {
    sessionID: SessionID
    messageID: MessageID
    agent: string
    abort: AbortSignal
    /** 当前工具调用 ID */
    callID?: string
    /** 扩展字段 */
    extra?: { [key: string]: any }
    /** 最近的消息列表（含历史） */
    messages: any[]
    /** 设置返回元数据 */
    metadata(input: { title?: string; metadata?: M }): void
    /** 请求用户确认 */
    ask(
      input: Omit<PermissionRequest, "id" | "sessionID" | "tool">,
    ): Promise<void>
  }

  export interface Info<
    Parameters extends z.ZodType = z.ZodType,
    M extends Metadata = Metadata,
  > {
    id: string
    init: (ctx?: InitContext) => Promise<{
      description: string
      parameters: Parameters
      execute(
        args: z.infer<Parameters>,
        ctx: Context,
      ): Promise<{
        title: string
        metadata: M
        output: string
        attachments?: FilePart[]
      }>
      formatValidationError?(error: z.ZodError): string
      [key: string]: any
    }>
    [key: string]: any
  }

  export type InferParameters<T extends Info> =
    T extends Info<infer P> ? z.infer<P> : never
  export type InferMetadata<T extends Info> =
    T extends Info<any, infer M> ? M : never

  /**
   * 定义工具 — 内建 Zod 参数校验 + 输出截断。
   */
  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init:
      | Info<Parameters, Result>["init"]
      | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
  ): Info<Parameters, Result> {
    return {
      id,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
        const originalExecute = toolInfo.execute
        toolInfo.execute = async (args, ctx) => {
          // Zod 校验
          try {
            toolInfo.parameters.parse(args)
          } catch (error) {
            if (error instanceof z.ZodError && toolInfo.formatValidationError) {
              throw new Error(toolInfo.formatValidationError(error), {
                cause: error,
              })
            }
            throw new Error(
              `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
              { cause: error },
            )
          }
          // 执行
          const result = await originalExecute(args, ctx)
          // 跳过已自行截断的工具
          if (result.metadata && result.metadata.truncated !== undefined) {
            return result
          }
          // 截断
          const truncated = await truncateOutput(
            result.output,
            {},
            initCtx?.agent,
          )
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated
                ? { outputPath: (truncated as any).outputPath }
                : {}),
            },
          }
        }
        return toolInfo
      },
    }
  }

  /**
   * LTX 工具定义 — 与 define 行为完全一致，仅向后兼容。
   * @deprecated 请直接使用 define()
   */
  export function defineLtxTool<Parameters extends z.ZodType>(
    id: string,
    init:
      | Info<Parameters, Metadata>["init"]
      | Awaited<ReturnType<Info<Parameters, Metadata>["init"]>>,
  ): Info<Parameters, Metadata> {
    return define(id, init)
  }
}
