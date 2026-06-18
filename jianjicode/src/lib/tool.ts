import z from "zod"

// Local type stubs — avoid pulling in broken ai/agent/, ai/session/ dependency chains
type SessionID = string
type MessageID = string
namespace MessageV2 {
  export type WithParts = any[]
  export type FilePart = any
}
namespace Agent {
  export type Info = any
}
namespace Permission {
  export type Request = any
}

import { output as truncateOutput } from "./truncate-output"
namespace Truncate {
  export type Result =
    | { content: string; truncated: false }
    | { content: string; truncated: true; outputPath: string }
  export const output = truncateOutput
}

export interface UsageTemplate {
  /** 模板 JSON — AI 直接往里填真实值 */
  json: Record<string, unknown>
  /** 跨参数约束规则 — Zod .describe() 无法表达的约束 */
  constraints: string[]
  /** 已知系统限制 — 非约束，仅告知当前已知故障 */
  knownLimitations?: string[]
  /** 输出契约 — 工具交付承诺 */
  outputContract?: {
    format: string
    required: string[]
    optional?: string[]
    verify: string[]
  }
}

export namespace Tool {
  export interface Metadata {
    operation?: string
    error?: boolean
    success?: boolean
    [key: string]: any
  }

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: SessionID
    messageID: MessageID
    agent: string
    /**
     * 用户点击「停止生成」或切换任务时触发。
     *
     * 工具实现者应:
     * 1. 长耗时操作前检查 ctx.abort.aborted（快速退出）
     * 2. 将 signal 传给底层（如 runFfmpeg(args, ctx.abort) / fetch(url, { signal })）
     * 3. 或用 addEventListener("abort", ...) 清理子进程/定时器
     *
     * 不要忽略此信号——否则用户点了停止，后台进程继续跑。
     */
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(
      input: Omit<Permission.Request, "id" | "sessionID" | "tool">,
    ): Promise<void>
  }
  export interface Info<
    Parameters extends z.ZodType = z.ZodType,
    M extends Metadata = Metadata,
  > {
    id: string
    /** @since usageTemplate — 工具自带填空模板 */
    usageTemplate?: UsageTemplate
    init: (ctx?: InitContext) => Promise<{
      description: string
      parameters: Parameters
      execute(
        args: z.infer<Parameters>,
        ctx: Context,
      ): Promise<{
        title: string
        metadata: Metadata
        output: string
        attachments?: Omit<
          MessageV2.FilePart,
          "id" | "sessionID" | "messageID"
        >[]
        /** Phase 2.0: 时间轴可视化编辑操作 */
        editOperations?: Array<{
          operationId: string
          undoable?: boolean
          type: string
          [key: string]: any
        }>
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

  export function define<Parameters extends z.ZodType, Result extends Metadata>(
    id: string,
    init:
      | Info<Parameters, Result>["init"]
      | Awaited<ReturnType<Info<Parameters, Result>["init"]>>,
  ): Info<Parameters, Result> {
    const info: Info<Parameters, Result> = {
      id,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
        // 捕获 usageTemplate 到 Info 顶层
        if ((toolInfo as any).usageTemplate && !info.usageTemplate) {
          info.usageTemplate = (toolInfo as any).usageTemplate
        }
        const execute = toolInfo.execute
        toolInfo.execute = async (args, ctx) => {
          let parsedArgs = args
          try {
            parsedArgs = toolInfo.parameters.parse(args)
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
          const result = await execute(parsedArgs, ctx)
          // skip truncation for tools that handle it themselves
          if (result.metadata.truncated !== undefined) {
            return result
          }
          const truncated = await Truncate.output(
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
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }
        return toolInfo
      },
    }
    return info
  }
}
