/**
 * jianjicode AI 原生工具调用层
 *
 * 将 toolRegistry 转为 AI SDK ToolSet，用 generateText 原生 tool calling
 * 替代旧的文本解析 pipeline。
 *
 * OpenCode 模式参考：
 *   - session/prompt.ts → loop()  →  while(true) { streamText; if finishReason≠"tool-calls" break }
 *   - session/processor.ts → process()  →  单次 streamText + 持久化部件
 *   - Step 2 of the loop is compaction check: estimateTokens → compactHistory if over threshold
 *
 * jianjicode 简化实现：
 *   - AI SDK 的 stepCountIs 替代 while(true) 循环
 *   - compactHistory() 在 streamAiEditWithSession() 入口处调用
 *   - streamText 太重量级时用 generateText（AI SDK 的 generateText 同样支持多步 tool calling）
 */

import type { LanguageModel, ToolSet } from "ai"
import { generateText, stepCountIs, tool } from "ai"
import { z } from "zod"
import { findGloballyDenied } from "../permission/ruleset.js"
import { resolveContextReferences } from "./context-references.js"
import { truncateOutput } from "./truncate.js"
import { buildVideoEditingPrompt, buildToolListSummary } from "./prompts/video-editing-prompt.js"
import type { EditContext } from "./edit-context.js"
import { createEditContext, summarizeEditContext, addAppliedEffect } from "./edit-context.js"
import { toolRegistry } from "../registry/tool_registry.js"
import { listTemplates } from "../template/template-manager.js"
import { ensureBuiltinTemplatesRegistered } from "../template/template-tool.js"
import { getPhasePrompt, validateToolForPhase } from "./video-phase.js"
import type { EditMetadata, LTXEditResult } from "../types/edit-result.js"
import { editResultError } from "../types/edit-result.js"
import {
  appendAssistantMessage,
  appendUserMessage,
  compactHistory,
  createToolContext,
  estimateSessionTokens,
  getHistoryForAI,
} from "./chat-session.js"

// ============================================================================
// 全局权限服务引用（由 chat-core 初始化后设置）
// ============================================================================

let _globalPermissionEvaluate:
  | ((permission: string, pattern: string) => Promise<string>)
  | null = null

/**
 * 设置权限评估函数供 buildToolSet() 使用。
 * 由 chat-core 在初始化权限服务后调用。
 */
export function setPermissionEvaluate(
  fn: (permission: string, pattern: string) => Promise<string>,
): void {
  _globalPermissionEvaluate = fn
  // 权限规则变更，清除 ToolSet 缓存
  clearToolSetCache()
}

// ============================================================================
// 构建 AI SDK ToolSet
// ============================================================================

let _toolSetCache: ToolSet | null = null

export function clearToolSetCache(): void {
  _toolSetCache = null
}

/**
 * 将 toolRegistry 中的所有工具转为 AI SDK ToolSet。
 * 结果会被缓存，调用 clearToolSetCache() 可强制刷新。
 */
export async function buildToolSet(): Promise<ToolSet> {
  if (_toolSetCache) return _toolSetCache

  const tools: Record<string, any> = {}
  const allTools = toolRegistry.getAllTools()

  // L1: 全局禁止 — 从 ToolSet 中移除被 deny 的工具
  let globallyDenied = new Set<string>()
  if (_globalPermissionEvaluate) {
    const deniedIDs: string[] = []
    for (const toolInfo of allTools) {
      const action = await _globalPermissionEvaluate("tool:call", toolInfo.id)
      if (action === "deny") {
        deniedIDs.push(toolInfo.id)
      }
    }
    globallyDenied = new Set(deniedIDs)
    if (deniedIDs.length > 0) {
      console.log(
        `[ai-stream] Tools hidden from AI (global deny): ${deniedIDs.join(", ")}`,
      )
    }
  }

  for (const toolInfo of allTools) {
    // 跳过全局禁止的工具
    if (globallyDenied.has(toolInfo.id)) continue

    // 注意: 阶段门禁不在 ToolSet 层面隐藏工具。
    // 因为 AI SDK 的 generateText 在开始时传入 ToolSet 快照，步骤中无法动态更新。
    // set_edit_phase 切换阶段后，ToolSet 不会重建，导致精剪工具仍然不可见。
    // 改为在 execute 层做 L2.5 校验 — 模型调用错误阶段的工具时返回明确错误。

    const initialized = await toolRegistry.getInitializedTool(toolInfo.id)
    if (!initialized) {
      console.warn(`[ai-stream] Failed to initialize tool: ${toolInfo.id}`)
      continue
    }

    tools[toolInfo.id] = tool({
      description: initialized.description,
      inputSchema: initialized.parameters,
      execute: async (input: any) => {
        // L2: 调用前权限检查
        if (_globalPermissionEvaluate) {
          try {
            const action = await _globalPermissionEvaluate(
              "tool:call",
              toolInfo.id,
            )
            if (action === "deny") {
              return {
                title: `${toolInfo.id} blocked`,
                metadata: {
                  operation: toolInfo.id,
                  error: true,
                  success: false,
                  permissionDenied: true,
                },
                output: `Tool "${toolInfo.id}" is not permitted by configuration.`,
              }
            }
            if (action === "ask") {
              return {
                title: `${toolInfo.id} pending approval`,
                output: "",
                metadata: {
                  operation: toolInfo.id,
                  _permissionDeferred: true,
                  toolID: toolInfo.id,
                  args: input,
                },
              }
            }
          } catch {
            // evaluate 失败时放行（不阻塞工具执行）
          }
        }

        // 显式参数校验 — 在 AI SDK 校验之外增加安全层
        // 如果工具定义了 formatValidationError，使用它来格式化错误消息
        try {
          initialized.parameters.parse(input)
        } catch (error: unknown) {
          if (error instanceof z.ZodError) {
            const fmtErr =
              typeof (initialized as any).formatValidationError === "function"
                ? (initialized as any).formatValidationError(error)
                : `The ${toolInfo.id} tool was called with invalid arguments: ${error.message}.\nPlease rewrite the input so it satisfies the expected schema.`
            return {
              title: `${toolInfo.id} validation error`,
              metadata: {
                operation: toolInfo.id,
                error: true,
                success: false,
                validationError: true,
              },
              output: fmtErr,
            }
          }
          throw error
        }

        // L2.5: 阶段门禁 — 执行时校验（ffmpeg 的 trim 范围、concat 禁用等）
        const phaseErrMsg = validateToolForPhase(toolInfo.id, input as Record<string, any>)
        if (phaseErrMsg) {
          return {
            title: `${toolInfo.id} 阶段限制`,
            metadata: {
              operation: toolInfo.id,
              error: true,
              success: false,
              phaseBlocked: true,
            },
            output: phaseErrMsg,
          }
        }

        const ctx = createToolContext()
        try {
          const result = await initialized.execute(input, ctx)

          // 跳过已自行截断的工具
          if (result.metadata?.truncated !== undefined) {
            return result
          }

          // 输出截断 — 限制单次工具调用结果大小，防止撑爆上下文窗口
          const truncated = await truncateOutput(
            typeof result.output === "string"
              ? result.output
              : String(result.output),
          )
          return {
            ...result,
            output: truncated.content,
            metadata: {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated
                ? { outputPath: truncated.outputPath }
                : {}),
            },
          }
        } catch (error: any) {
          return {
            title: `${toolInfo.id} error`,
            metadata: { operation: toolInfo.id, error: true, success: false },
            output: `Tool execution error: ${error.message}`,
          }
        }
      },
    })
  }

  _toolSetCache = tools
  return tools
}

// ============================================================================
// 动态 System Prompt（视频编辑领域专用）
// ============================================================================

/**
 * 全局编辑上下文。在 agent loop 生命周期内通过 setActiveEditContext 设置。
 */
let _activeEditContext: EditContext | undefined

export function setActiveEditContext(ctx: EditContext | undefined): void {
  _activeEditContext = ctx
}

export function getActiveEditContext(): EditContext | undefined {
  return _activeEditContext
}

/**
 * 构建包含可用工具、编辑上下文、模板和 skill 的动态 system prompt。
 * 使用中文视频编辑领域专用 prompt，并注入已创建的 skill 供 AI 复用。
 */
export async function buildDynamicSystemPrompt(opts?: {
  editContext?: EditContext
  customInstructions?: string
}): Promise<string> {
  const allTools = toolRegistry.getAllTools()

  const toolList =
    allTools.length > 0
      ? buildToolListSummary(
          allTools.map((t) => ({ id: t.id, description: t.description })),
        )
      : undefined

  // 收集可用模板摘要，注入 system prompt 供 AI 推荐
  ensureBuiltinTemplatesRegistered()
  const { builtin, custom } = listTemplates()
  const allTemplates = [...builtin, ...custom]
  const templateList =
    allTemplates.length > 0
      ? allTemplates.map(
          (t) =>
            `**${t.id}** [${t.category}]: ${t.name} — ${t.description} (${t.parameterCount} 参数, ${t.toolCount} 步骤)`,
        )
      : undefined

  const editContext = opts?.editContext || _activeEditContext

  // 注入已创建的 Skill（Hermes 架构：非阻塞，失败不影响主流程）
  let skillSection = ""
  try {
    const { listSkills } = await import("./skill-manager.js")
    const skills = await listSkills()
    if (skills.length > 0) {
      const skillLines = skills
        .map(s => {
          const compat = s.compatible === false ? " ⚠️" : ""
          return `- **${s.name}**${compat} (${s.category}): ${s.description} — ${s.toolCount} tools`
        })
        .join("\n")
      skillSection = `\n\n## Available Skills\nYou have access to these reusable video editing workflows:\n\n${skillLines}\n\n### Priority Rules for Skill Usage\n1. When a user's request matches a skill description → ALWAYS use the skill first. Call \`skill_manage\` with action \`view\` to read the steps, then follow them.\n2. Only fall back to individual tools if no existing skill matches the request.\n3. Do NOT recreate a workflow that already exists as a skill.\n\nWhen variables like \`\${INPUT_DIR}\`, \`\${INPUT_PATH}\`, \`\${OUTPUT_DIR}\` appear in skill content, substitute them with the actual paths from the current task context.\n\nSkills marked with ⚠️ have a version mismatch with the current tool API. Do NOT use them automatically. Suggest the user to recreate or update them instead.`
    }
  } catch {
    // skill 注入失败不阻塞
  }

  // 构建基础 prompt（视频编辑领域专用），再追加 skill 段落和阶段提示
  const basePrompt = buildVideoEditingPrompt({
    editContext,
    toolList,
    templateList,
    customInstructions: opts?.customInstructions,
  })

  const phasePrompt = getPhasePrompt()

  return [basePrompt, skillSection, phasePrompt].filter(Boolean).join("\n")
}

// ============================================================================
// 编辑上下文管理
// ============================================================================

/**
 * 根据工具调用结果更新全局编辑上下文。
 * 在 agent loop 的每次工具调用后调用此函数以保持上下文最新。
 */
export function updateEditContextFromToolCall(
  toolName: string,
  args: Record<string, unknown>,
  result: {
    title?: string
    output?: string
    metadata?: Record<string, unknown>
  },
): void {
  if (!_activeEditContext) {
    _activeEditContext = createEditContext()
  }

  const ctx = _activeEditContext

  // 提取视频文件路径
  const filePath =
    (args.input_file as string) ||
    (args.video_file as string) ||
    (args.output_file as string) ||
    (args.file as string)
  if (filePath && !ctx.currentVideo) {
    ctx.currentVideo = filePath
  }

  // 记录操作
  _activeEditContext = addAppliedEffect(
    ctx,
    toolName,
    result.title || `${toolName} 完成`,
    args,
  )
}

/**
 * 获取编辑上下文的简短摘要文本，用于注入 system prompt。
 */
export function getEditContextSummary(): string {
  if (!_activeEditContext) return ""
  return summarizeEditContext(_activeEditContext)
}

// ============================================================================
// 类型
// ============================================================================

export interface AiEditResult extends LTXEditResult {
  /** AI's text response (clarification, summary, etc.) */
  aiText?: string
  /** All tool calls made during this request */
  toolCalls?: Array<{
    toolName: string
    args: Record<string, unknown>
    result: {
      title: string
      output: string
      metadata: Record<string, unknown>
    }
  }>
}

// ============================================================================
// 核心 AI 调用
// ============================================================================

/**
 * 用 AI 原生 tool calling 处理一次视频编辑请求。
 *
 * OpenCode 的 session/processor 模式：单次 streamText → 持久化 text/reasoning/tool parts → 返回 "continue"/"stop"。
 * 我们简化：generateText + stepCountIs 替代 while(true) agent loop，AI SDK 自动处理多步工具调用。
 *
 * @param model    AI SDK LanguageModel
 * @param message  用户消息
 * @param opts     system prompt override, session messages for multi-turn
 * @returns        标准化的编辑结果，含 AI 文本和工具调用记录
 */
export async function streamAiEdit(
  model: LanguageModel,
  message: string,
  opts?: {
    system?: string
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>
    maxSteps?: number
  },
): Promise<AiEditResult> {
  const tools = await buildToolSet()

  if (Object.keys(tools).length === 0) {
    return {
      ...editResultError(
        "ai-stream",
        "No tools available. Ensure tool registry is initialized.",
      ),
      aiText: "No tools available.",
    }
  }

  const system = opts?.system || await buildDynamicSystemPrompt()
  const maxSteps = opts?.maxSteps ?? 5

  try {
    const result = await generateText({
      model,
      system,
      messages: [
        ...(opts?.messages || []),
        { role: "user", content: message },
      ] as any,
      tools,
      stopWhen: stepCountIs(maxSteps),
    })

    // 提取工具调用结果
    const toolCalls: AiEditResult["toolCalls"] = []
    let lastToolResult: {
      title: string
      output?: string
      metadata?: Record<string, unknown>
      toolId?: string
    } | null = null

    for (const step of result.steps || []) {
      if (step.toolCalls) {
        for (const call of step.toolCalls) {
          const toolResult = (step as any).toolResults?.find(
            (r: any) => r.toolCallId === call.toolCallId,
          )
          const resultData = toolResult?.output || {}
          toolCalls.push({
            toolName: call.toolName,
            args: (call as any).input as Record<string, unknown>,
            result: {
              title: resultData.title || call.toolName,
              output:
                typeof resultData.output === "string"
                  ? resultData.output
                  : JSON.stringify(resultData),
              metadata: resultData.metadata || {},
            },
          })
          lastToolResult = {
            title: resultData.title || call.toolName,
            output: resultData.output,
            metadata: resultData.metadata,
            toolId: call.toolName,
          }
        }
      }
    }

    // 工具调用过 → 返回工具执行结果
    if (lastToolResult) {
      const metadata: EditMetadata = {
        ...(lastToolResult.metadata || {}),
        success: lastToolResult.metadata?.error !== true,
        error: lastToolResult.metadata?.error === true,
      }

      return {
        success: metadata.error !== true,
        title: lastToolResult.title,
        output:
          lastToolResult.output || result.text || "Tool execution completed",
        operation:
          (lastToolResult.metadata?.operation as string) ||
          lastToolResult.toolId ||
          "unknown",
        toolId: lastToolResult.toolId,
        metadata,
        aiText: result.text,
        toolCalls,
      }
    }

    // 未调用工具 → AI 的文本响应（澄清、解释等）
    return {
      success: true,
      title: "AI Response",
      output: result.text,
      operation: "ai_response",
      metadata: { success: true, error: false },
      aiText: result.text,
      toolCalls,
    }
  } catch (error: any) {
    return {
      ...editResultError("ai-stream", error.message || "Unknown AI error"),
      aiText: error.message,
    }
  }
}

// ============================================================================
// 多轮会话支持
// ============================================================================

/**
 * 带会话管理的 AI 编辑请求。
 *
 * OpenCode 的 agent loop 模式：
 *   1. 加载历史消息
 *   2. 检查 token → 必要时 compactHistory
 *   3. streamText + tool calling (AI SDK stepCountIs 替代 while 循环)
 *   4. 持久化 user message + assistant message + tool results
 *   5. 返回结果
 *
 * @param sessionId 会话 ID（不存在则自动创建）
 * @param model     AI SDK LanguageModel
 * @param message   用户消息
 * @param opts      maxSteps, system prompt override
 * @returns         编辑结果 + 用于跟踪的 sessionId
 */
export async function streamAiEditWithSession(
  sessionId: string,
  model: LanguageModel,
  message: string,
  opts?: {
    system?: string
    maxSteps?: number
    maxTokens?: number
  },
): Promise<AiEditResult & { sessionId: string }> {
  // 1. 解析上下文引用（@file/@folder/@url/@git）→ Hermes 架构
  let resolvedMessage = message
  let contextRefNotification = ""
  try {
    const refResult = await resolveContextReferences(message)
    resolvedMessage = refResult.resolvedMessage
    contextRefNotification = refResult.notification
  } catch {
    // 引用解析失败不阻塞主流程
  }

  // 如果有引用通知，追加到 system prompt
  let effectiveSystem = opts?.system
  if (contextRefNotification) {
    effectiveSystem = effectiveSystem
      ? `${effectiveSystem}\n\n${contextRefNotification}`
      : contextRefNotification
  }

  // 2. 将解析后的用户消息写入会话
  appendUserMessage(sessionId, resolvedMessage)

  // 3. OpenCode 模式：入口处检查 token，必要时压缩
  const currentTokens = estimateSessionTokens(sessionId)
  if (currentTokens > (opts?.maxTokens || 8000)) {
    const compactResult = compactHistory(sessionId, opts?.maxTokens || 8000, 6)
    console.log(
      `[ai-stream] Compaction: before=${compactResult.before} after=${compactResult.after} tokens`,
    )
  }

  // 4. 获取会话历史
  const history = getHistoryForAI(sessionId)
  // 移除最后一条（刚追加的 user message），streamAiEdit 会自己加
  history.pop()

  // 5. 调用 AI（含历史上下文）
  const result = await streamAiEdit(model, resolvedMessage, {
    system: effectiveSystem,
    messages: history as any,
    maxSteps: opts?.maxSteps,
  })

  // 6. 持久化助手响应
  const lastToolCall = result.toolCalls?.[result.toolCalls.length - 1]
  appendAssistantMessage(
    sessionId,
    result.aiText || result.output,
    lastToolCall
      ? {
          toolName: lastToolCall.toolName,
          result,
        }
      : undefined,
  )

  return { ...result, sessionId }
}
