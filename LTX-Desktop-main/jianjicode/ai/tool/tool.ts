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

// No-op Truncate stub — avoid @effect/platform-node, effect, @/filesystem deps
namespace Truncate {
  export type Result =
    | { content: string; truncated: false }
    | { content: string; truncated: true; outputPath: string }
  export async function output(
    content: string,
    _options?: any,
    _agent?: any,
  ): Promise<Result> {
    return { content, truncated: false }
  }
}

export namespace Tool {
  interface Metadata {
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
      }>
      formatValidationError?(error: z.ZodError): string
      [key: string]: any
    }>
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
    return {
      id,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
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
  }
}
