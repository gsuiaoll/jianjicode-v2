/**
 * jianjicode Agent Loop — 编排层
 *
 * while(true) agent 执行循环。导入 step 执行、后处理 hooks 等子模块。
 *
 * OpenCode 模式参考：
 *   - session/prompt.ts → loop() → while(true) {
 *       1. 检查待处理 subtask → 执行
 *       2. 检查待处理 compaction → 执行
 *       3. 检查 context overflow → 触发 compaction
 *       4. session/processor.ts → process() → streamText + 持久化
 *       5. 根据结果决定 continue/stop
 *     }
 *
 * jianjicode 简化实现：
 *   - 无 subtask 队列（后续可加）
 *   - compact 内联检测
 *   - generateText({ maxSteps: 1 }) 每次循环只做一轮 AI→tool→result
 *   - 手动保存工具结果到 session，在下次循环中供 AI 看到
 */

// ============================================================================
// Re-exports for backward compatibility
// ============================================================================

export type { StreamEvent } from "./agent-types.js"

// ============================================================================
// Imports
// ============================================================================

import type { LanguageModel, ToolSet } from "ai"
import { existsSync, readFileSync, statSync } from "fs"
import { join } from "path"
import type {
  ModelConfig,
  TokenUsage,
} from "../../ai/provider/fallback-provider.js"
import { FallbackProvider } from "../../ai/provider/fallback-provider.js"
import { permissionStorage } from "../permission/service.js"
import type { PermissionRequest } from "../permission/types.js"
import { toolRegistry } from "../registry/tool_registry.js"
import { maybeCreateSkillFromSteps, scheduleAsyncHooks } from "./agent-hooks.js"
import { createExecuteStep, createFallbackState } from "./agent-runner.js"
import type {
  AgentLoopOptions,
  AgentLoopResult,
  AgentStep,
  GenerateTextStep,
  StreamEvent,
} from "./agent-types.js"
import { extractToolCalls, getLastToolResultData } from "./agent-types.js"
import { buildDynamicSystemPrompt, buildToolSet } from "./ai-stream.js"
import { extractVideoFiles, resolveFilePath } from "./chat-core.js"
import {
  appendAssistantMessage,
  appendToolCallAndResult,
  appendUserMessage,
  compactHistory,
  createToolContext,
  extractAndPersistVideoAnalysis,
  getHistoryForAgent,
  isOverflow,
  progressiveCompress,
  pruneHistory,
} from "./chat-session.js"
import { resolveContextReferences } from "./context-references.js"
import { uploadFileToOss } from "./oss-upload.js"
import { isLikelyArgError } from "./tool-repair.js"
import { getTrajectoryRecorder } from "./trajectory.js"

// ============================================================================
// INTENT_FORM 标记解析
// ============================================================================

const INTENT_FORM_REGEX = /<<INTENT_FORM:(.+?)>>/s

interface ParsedIntentForm {
  formId: string
  message: string
  options: Array<{ id: string; label: string; description: string }>
  allowCustomInput: boolean
  customInputPlaceholder?: string
}

function parseIntentFormTag(text: string): ParsedIntentForm | null {
  const match = text.match(INTENT_FORM_REGEX)
  if (!match) return null

  const raw = match[1]
  const parts = raw.split("|")
  const options: ParsedIntentForm["options"] = []
  let message = ""
  let allowCustomInput = false
  let customInputPlaceholder: string | undefined

  for (const part of parts) {
    const [key, ...valueParts] = part.split("=")
    const value = valueParts.join("=")

    if (key === "message") {
      message = value
    } else if (key === "allowCustomInput") {
      allowCustomInput = value === "true"
    } else if (key === "customInputPlaceholder") {
      customInputPlaceholder = value
    } else if (key.includes(":")) {
      const [label, ...descParts] = value.split(":")
      options.push({
        id: key,
        label,
        description: descParts.join(":"),
      })
    }
  }

  return {
    formId: `intent-${Date.now()}`,
    message,
    options,
    allowCustomInput,
    customInputPlaceholder,
  }
}

function stripIntentFormTag(text: string): string {
  return text.replace(INTENT_FORM_REGEX, "").trim()
}

// ============================================================================
// Agent Loop — 编排层
// ============================================================================

/**
 * 真正的 Agent Loop — while(true) 执行循环。
 *
 * 与 streamAiEditWithSession 的核心区别：
 * - 每次 generateText 只允许 1 步（AI→tool→result），不自动循环
 * - 循环之间做 compaction 检查、abort 检查、session 持久化
 * - 旧模式将所有步骤压缩在同一个 generateText 内，没有中间控制点
 */
export async function agentLoop(
  opts: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    model: initialModel,
    sessionId,
    message,
    system,
    maxSteps = 10,
    maxTokens = 8000,
    contextLimit = 100_000,
    contextBuffer = 20_000,
    abortSignal,
    onStep,
    onStream,
    providerOptions,
    temperature,
    maxOutputTokens,
    fallbackModels = [],
    maxRetries = 2,
    baseDelayMs = 1000,
    autoCreateSkill = "confirm",
    dashscopeApiKey,
    dashscopeModel,
    editorContext,
  } = opts

  const allSteps: AgentStep[] = []
  let totalSteps = 0
  let stoppedByMaxSteps = false
  let stoppedByAbort = false

  // ---- fallback state ----
  const fallbackState = createFallbackState(initialModel)
  const { retryCount, fellBack } = fallbackState

  // ---- token 用量累加 ----
  let totalPromptTokens = 0
  let totalCompletionTokens = 0

  // 1. 构建 system prompt
  let systemPrompt = system || (await buildDynamicSystemPrompt())

  // 2. 写入用户消息（先解析上下文引用 @file/@folder/@url/@git）
  let resolvedMessage = message
  let contextRefNotification = ""
  try {
    const result = await resolveContextReferences(message)
    resolvedMessage = result.resolvedMessage
    contextRefNotification = result.notification
  } catch {
    // 引用解析失败不阻塞主流程，使用原始消息
  }
  if (contextRefNotification) {
    systemPrompt = `${systemPrompt}\n\n${contextRefNotification}`
  }

  // 注入编辑器上下文（前端选中的项目素材文件 + 时间轴选中状态）
  if (editorContext) {
    const ctx = editorContext
    let ctxBlock = "\n\n## 当前编辑器上下文\n\n"
    if (ctx.projectName) ctxBlock += `**项目**: ${ctx.projectName}\n\n`

    // 时间轴概览
    if (ctx.totalDuration !== undefined || ctx.currentTime !== undefined) {
      ctxBlock += "**时间轴状态**:"
      if (ctx.totalDuration !== undefined)
        ctxBlock += ` 总时长 ${ctx.totalDuration.toFixed(1)}s`
      if (ctx.currentTime !== undefined)
        ctxBlock += `，当前播放头位置 ${ctx.currentTime.toFixed(1)}s`
      ctxBlock += "\n\n"
    }

    // 用户当前选中的片段（最重要——优先显示）
    if (ctx.selectedClips?.length) {
      ctxBlock += "**🎯 用户当前选中的片段（用户正在操作这些）**:\n"
      for (const c of ctx.selectedClips) {
        const assetRef = c.assetPath ? ` → 素材: \`${c.assetPath}\`` : ""
        ctxBlock += `- \`${c.id}\`: ${c.type} 片段, 轨道 ${c.trackIndex}, 时间 ${c.startTime.toFixed(1)}s–${(c.startTime + c.duration).toFixed(1)}s (时长 ${c.duration.toFixed(1)}s)`
        if (c.trimStart || c.trimEnd)
          ctxBlock += `，trim ${c.trimStart?.toFixed(1) ?? 0}s–${c.trimEnd?.toFixed(1) ?? c.duration.toFixed(1)}s`
        if (c.speed !== undefined && c.speed !== 1)
          ctxBlock += `，速度 ${c.speed}x`
        ctxBlock += `${assetRef}\n`
      }
      ctxBlock +=
        '\n> 当用户用模糊代词（"这个片段"、"选中的"、"当前片段"、"这里"）时，指的就是上述选中的片段。直接使用对应的素材路径和片段时间信息，不要再询问。\n\n'
    }

    // 时间轴所有片段概览
    if (ctx.timelineClips?.length) {
      ctxBlock += "**时间轴片段概览**:\n"
      for (const c of ctx.timelineClips) {
        ctxBlock += `- \`${c.id}\`: ${c.type}, 轨道 ${c.trackIndex}, ${c.startTime.toFixed(1)}s–${(c.startTime + c.duration).toFixed(1)}s, 素材: ${c.assetName}\n`
      }
      ctxBlock += "\n"
    }

    if (ctx.mediaFiles?.length) {
      ctxBlock += "**可用素材文件（用户已上传，无需再询问路径）**:\n"
      for (const f of ctx.mediaFiles) {
        ctxBlock += `- \`${f.path}\` (${f.name}, ${f.type}${f.duration ? `, ${f.duration}s` : ""})\n`
      }
      ctxBlock += "\n"
    }
    systemPrompt = `${systemPrompt}\n\n${ctxBlock}`
  }

  // 检测消息中的视频文件路径，构建多模态消息内容
  // 千问 Omni 原生支持视频：
  //   - 小文件（≤10MB）：base64 内联，无额外网络开销
  //   - 大文件（≤2GB）：上传 DashScope OSS 获取 oss:// URL，千问原生拉取
  const MAX_INLINE_BYTES = 10 * 1024 * 1024
  let messageContent: string | any[] = resolvedMessage
  let attachedCount = 0
  let videoFiles = extractVideoFiles(resolvedMessage)
  console.log(`[agent-loop] videoFiles found: ${videoFiles.length}`)
  // 只取第一个视频文件（用户指定的源视频），
  // 过滤掉 JSON 模板中的输出路径（c1.mp4, s1.mp4 等）
  if (videoFiles.length > 1) {
    const outputsDir = join(process.cwd(), "jianjicode", "tests", "outputs")
    videoFiles = videoFiles.filter((vf: string) => {
      try {
        const resolved = resolveFilePath(vf)
        return !resolved.startsWith(outputsDir)
      } catch { return true }
    })
    console.log(`[agent-loop] After filtering output dirs: ${videoFiles.length}`)
  }
  if (videoFiles.length > 0) {
    const contentParts: any[] = []
    const skippedLarge: string[] = []

    // 获取 DashScope 配置（OSS 上传需要）
    // 优先使用 chat-core 透传的 key/model，再 fallback 到 env/config
    const getDashScopeConfig = () => {
      if (dashscopeApiKey) {
        return {
          apiKey: dashscopeApiKey,
          model: dashscopeModel || "qwen3.5-omni-flash",
        }
      }
      const apiKey = process.env.DASHSCOPE_API_KEY
      const model = process.env.DASHSCOPE_MODEL || "qwen3.5-omni-flash"
      if (apiKey) return { apiKey, model }
      try {
        const configPath = join(process.cwd(), "config.json")
        if (existsSync(configPath)) {
          const config = JSON.parse(readFileSync(configPath, "utf-8"))
          const ds = (config as any).dashscope
          if (ds?.apiKey) return { apiKey: ds.apiKey, model: ds.model || model }
        }
      } catch {}
      return { apiKey: "", model }
    }
    const dsConfig = getDashScopeConfig()
    console.log(
      `[agent-loop] DashScope config: apiKey=${dsConfig.apiKey ? "YES(" + dsConfig.apiKey.slice(0, 8) + "...)" : "NO"}, model=${dsConfig.model}`,
    )

    const getMimeType = (ext: string) =>
      ext === "mp4"
        ? "video/mp4"
        : ext === "mov"
          ? "video/quicktime"
          : ext === "avi"
            ? "video/x-msvideo"
            : ext === "webm"
              ? "video/webm"
              : ext === "mkv"
                ? "video/x-matroska"
                : ext === "jpg" || ext === "jpeg"
                  ? "image/jpeg"
                  : ext === "png"
                    ? "image/png"
                    : ext === "webp"
                      ? "image/webp"
                      : ext === "gif"
                        ? "image/gif"
                        : ext === "bmp"
                          ? "image/bmp"
                          : ""

    const isVideoExt = (ext: string) =>
      ["mp4", "mov", "avi", "webm", "mkv", "flv", "wmv"].includes(ext)

    const isImageExt = (ext: string) =>
      ["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)

    for (const vf of videoFiles) {
      const resolvedPath = resolveFilePath(vf)
      const ext = vf.split(".").pop()?.toLowerCase() || ""
      console.log(
        `[agent-loop] Checking video: "${vf}" → resolved="${resolvedPath}" exists=${existsSync(resolvedPath)} ext=${ext}`,
      )
      if (!existsSync(resolvedPath)) continue

      // 音频等非视觉文件不做多模态附加，保留文本路径让模型调工具时使用
      if (!isVideoExt(ext) && !isImageExt(ext)) {
        console.log(`[agent-loop] → SKIP (not video/image, keep as text path)`)
        continue
      }

      const fileStat = statSync(resolvedPath)
      const mimeType = getMimeType(ext)
      const sizeMB = (fileStat.size / 1024 / 1024).toFixed(1)
      console.log(
        `[agent-loop] File: ${resolvedPath} size=${sizeMB}MB ext=${ext}`,
      )

      if (fileStat.size <= MAX_INLINE_BYTES) {
        console.log(`[agent-loop] → inline path (≤10MB)`)
        const videoData = readFileSync(resolvedPath)
        contentParts.push({
          type: "file",
          data: videoData.toString("base64"),
          mediaType: mimeType,
        })
        attachedCount++
      } else if (dsConfig.apiKey) {
        console.log(`[agent-loop] → OSS upload path`)
        try {
          const uploadResult = await uploadFileToOss(
            resolvedPath,
            dsConfig.model,
            dsConfig.apiKey,
          )
          // 用特殊文本标记传递 OSS URL，避免 AI SDK 尝试下载 oss:// URL
          contentParts.push({
            type: "text",
            text: `[DASHSCOPE_VIDEO:${uploadResult.ossUrl}]`,
          })
          attachedCount++
          console.log(
            `[agent-loop] OSS uploaded: ${uploadResult.fileName} (${(uploadResult.fileSize / 1024 / 1024).toFixed(1)}MB) → ${uploadResult.ossUrl}`,
          )
        } catch (err: any) {
          console.warn(
            `[agent-loop] OSS upload failed for ${vf}: ${err.message}`,
          )
          skippedLarge.push(vf)
        }
      } else {
        console.log(`[agent-loop] → SKIP (no API key, too large for inline)`)
        skippedLarge.push(vf)
      }
    }

    console.log(
      `[agent-loop] attachedCount=${attachedCount} skippedLarge=${skippedLarge.length}`,
    )

    if (attachedCount > 0) {
      const directive = `[你是一个多模态AI视频剪辑助手，此消息包含 ${attachedCount} 个视频附件。

**核心能力**：你可以直接通过视觉理解视频内容（场景类型、切换点、精彩片段）。这是你唯一能直接看到视频的机会，后续步骤将无法再次访问视频。请在第一步仔细观察并记住所有关键时间点。

**可用工具速查**：
- ffmpeg — 裁剪(trim, start_time/end_time 单位秒)、合并音频(merge_audio)、拼接(concat)
- video_speed — 变速（speed 数字，preserve_pitch=true 变速不变调）
- video_transition — 转场（每次两个视频，transition_type 从枚举选）
- lut_filter — 调色（预设 cinematic 等）

**禁止使用**：video_scene_detection、universal_video_analyzer、ai_video_analysis、cv_analysis、video_extract_frame、music_search、batch_scanner、batch_queue

严格遵循用户指定的编辑流程，不要在步骤间做无意义的"确认"。]`
      contentParts.unshift({ type: "text", text: directive + "\n\n" + resolvedMessage })
      messageContent = contentParts
    } else if (skippedLarge.length > 0) {
      const names = skippedLarge.map((v) => v.split(/[\\/]/).pop()).join(", ")
      const sizeMB = skippedLarge
        .map((v) => {
          try {
            return (statSync(resolveFilePath(v)).size / 1024 / 1024).toFixed(0)
          } catch {
            return "?"
          }
        })
        .join(", ")
      messageContent = `[此消息引用了视频文件(${names}，约${sizeMB}MB)，但OSS上传失败或未配置DashScope API Key。]\n\n${resolvedMessage}`
    }
  }
  appendUserMessage(sessionId, messageContent)

  // 3. 构建 ToolSet（缓存）
  const tools = await buildToolSet()

  // 多模态模式下移除不适用的工具:
  // 1. 本地分析工具 — 千问自己能看视频，不需要本地抽帧
  // 2. Python HTTP 空壳工具 — 无 Python 服务时不可用，误导模型
  //    这些工具都是 HTTP → FastAPI → FFmpeg 的薄封装，功能不如 TS 原生工具
  if (attachedCount > 0) {
    const removedTools = [
      // 本地分析工具（千问视觉替代）
      "video_scene_detection",
      "ai_video_analysis",
      "universal_video_analyzer",
      "ltx_video_processor",
      // Python HTTP 空壳（无 Python 服务，功能不如 TS 原生工具）
      "ltx_api_color_grading",
      "ltx_api_canny_edge",
      "cv_analysis",
      "basketball_shot_detection",
      "basketball_shot_editor",
      "action_recognition",
      "video_intelligent_crop",
      "video_style_transfer",
    ]
    for (const name of removedTools) {
      delete (tools as any)[name]
    }
    console.log(
      `[agent-loop] Multimodal mode: removed ${removedTools.length} inapplicable tools`,
    )
  }

  if (Object.keys(tools).length === 0) {
    return {
      success: false,
      sessionId,
      aiText: "No tools available.",
      steps: [],
      totalSteps: 0,
      stoppedByMaxSteps: false,
      stoppedByAbort: false,
    }
  }

  // 4. 创建 executeStep 闭包
  const executeStep = createExecuteStep(
    { fallbackModels, maxRetries, baseDelayMs },
    {
      systemPrompt,
      tools,
      onStream,
      temperature,
      maxOutputTokens,
      providerOptions,
    },
    fallbackState,
  )

  // ================================================================
  // while(true) Agent Loop（在 AsyncLocalStorage 上下文内运行）
  // ================================================================

  const permissionCtx = {
    sessionID: sessionId,
    onRequest: (request: PermissionRequest) => {
      onStream?.({
        type: "permission-request",
        request: {
          id: request.id,
          sessionID: request.sessionID,
          permission: request.permission,
          patterns: request.patterns,
          toolID: request.toolID,
          metadata: request.metadata,
          alwaysPatterns: request.alwaysPatterns,
        },
      })
    },
  }

  await permissionStorage.run(permissionCtx, async () => {
    const recorder = getTrajectoryRecorder()
    recorder.startRecording(sessionId, resolvedMessage, {
      modelId: fallbackState.currentModelId,
      autoCreated: false,
    })

    while (totalSteps < maxSteps) {
      // --- 检查取消信号 ---
      if (abortSignal?.aborted) {
        stoppedByAbort = true
        break
      }

      // 步骤间延迟：100K TPM 限制下，无延迟会 4-5 步内烧完配额
      if (totalSteps > 0) {
        const stepDelayMs = 12000
        await new Promise((r) => setTimeout(r, stepDelayMs))
      }

      totalSteps++

      // --- 渐进式上下文压缩 ---
      if (isOverflow(sessionId, contextLimit, contextBuffer)) {
        const result = progressiveCompress(
          sessionId,
          contextLimit,
          contextBuffer,
        )
        if (result.compacted) {
          console.log(
            `[agent-loop] ${result.level} compression: ${result.before} -> ${result.after} tokens (freed ${result.freedTokens})`,
          )
        }
      } else {
        pruneHistory(sessionId)
      }

      // --- 构建历史（含 tool 消息） ---
      const history = getHistoryForAgent(sessionId)

      // --- 执行一次 AI 步骤（含重试 + fallback） ---
      let aiStep: GenerateTextStep
      try {
        const perStepToolChoice = undefined
        const result = await executeStep(history, totalSteps, perStepToolChoice)
        aiStep = result.step
        if (result.usage) {
          totalPromptTokens += result.usage.promptTokens
          totalCompletionTokens += result.usage.completionTokens
        }
      } catch (error: any) {
        appendAssistantMessage(sessionId, `Error: ${error.message}`)
        const usage: TokenUsage | undefined =
          totalPromptTokens + totalCompletionTokens > 0
            ? {
                promptTokens: totalPromptTokens,
                completionTokens: totalCompletionTokens,
                totalTokens: totalPromptTokens + totalCompletionTokens,
              }
            : undefined
        return {
          success: false,
          sessionId,
          aiText: `Agent loop error at step ${totalSteps}: ${error.message}`,
          steps: allSteps,
          totalSteps,
          stoppedByMaxSteps: false,
          stoppedByAbort: false,
          usage,
          cost: usage
            ? FallbackProvider.estimateCost(usage, fallbackState.currentModelId)
            : undefined,
          fallback: {
            modelUsed: fallbackState.currentModelId,
            providerUsed: fallbackState.currentProviderId,
            retryCount: fallbackState.retryCount,
            fellBack: fallbackState.fellBack,
          },
        }
      }

      // --- 提取工具调用 ---
      const toolCalls = extractToolCalls(aiStep) ?? []

      // --- 权限检查：处理 _permissionDeferred 的结果 ---
      if (toolCalls.length > 0 && aiStep.toolCalls && aiStep.toolResults) {
        const deferredIndices = toolCalls
          .map((tc: any, i: number) =>
            tc.result?.metadata?._permissionDeferred ? i : -1,
          )
          .filter((i: number) => i >= 0)

        if (deferredIndices.length > 0) {
          const { permissionService } = await import("../permission/service.js")
          await Promise.all(
            deferredIndices.map(async (i: number) => {
              const tc = toolCalls[i]
              try {
                await permissionService.ask({
                  permission: "tool:call",
                  patterns: [tc.toolName],
                  metadata: { args: tc.args, toolName: tc.toolName },
                })
                const initialized = await toolRegistry.getInitializedTool(
                  tc.toolName,
                )
                if (initialized) {
                  const ctx = createToolContext()
                  const realResult = await initialized.execute(tc.args, ctx)
                  toolCalls[i] = {
                    ...tc,
                    result: {
                      title: realResult.title,
                      output:
                        typeof realResult.output === "string"
                          ? realResult.output
                          : JSON.stringify(realResult),
                      metadata: realResult.metadata ?? {},
                    },
                  }
                }
              } catch (permError: any) {
                const permMsg = permError.message || "Permission denied"
                toolCalls[i] = {
                  ...tc,
                  result: {
                    title: "Permission Denied",
                    output: `Tool "${tc.toolName}" was blocked: ${permMsg}. Please explain to the user.`,
                    metadata: {
                      operation: tc.toolName,
                      error: true,
                      permissionDenied: true,
                      error_message: permMsg,
                    },
                  },
                }
              }
            }),
          )
        }
      }

      // --- 记录步骤 ---
      const step: AgentStep = {
        stepNumber: totalSteps,
        text: aiStep.text || "",
        toolCalls,
        finishReason: aiStep.finishReason || "unknown",
      }
      allSteps.push(step)
      onStep?.(step)

      // --- 记录轨迹 ---
      if (aiStep.text) {
        recorder.recordStep(sessionId, {
          type: "text",
          summary: aiStep.text.slice(0, 200),
        })
      }
      for (const tc of toolCalls) {
        recorder.recordStep(sessionId, {
          type: tc.result?.metadata?.error ? "error" : "tool_call",
          summary: `${tc.toolName}: ${tc.result?.title || "executed"}`,
          toolName: tc.toolName,
          toolArgs: tc.args,
          toolResult: {
            title: tc.result?.title,
            output: tc.result?.output,
            error: tc.result?.metadata?.error === true,
          },
        })
      }

      // --- 工具参数自动修复 ---
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]
        if (
          tc.result?.metadata?.error === true &&
          typeof tc.result?.output === "string"
        ) {
          const errorMsg = tc.result.output
          if (isLikelyArgError(errorMsg)) {
            try {
              const { repairToolArgs } = await import("./tool-repair.js")
              const repair = await repairToolArgs(
                tc.toolName,
                tc.args,
                errorMsg,
              )
              if (repair.repaired && repair.correctedArgs) {
                const initialized = await toolRegistry.getInitializedTool(
                  tc.toolName,
                )
                if (initialized) {
                  const ctx = createToolContext()
                  const newResult = await initialized.execute(
                    repair.correctedArgs,
                    ctx,
                  )
                  toolCalls[i] = {
                    ...tc,
                    args: repair.correctedArgs,
                    result: newResult,
                  }
                }
              }
            } catch (repairErr) {
              console.warn(
                `[agent-loop] Tool repair failed for ${tc.toolName}:`,
                repairErr,
              )
            }
          }
        }
      }

      // --- 保存到 session ---
      if (toolCalls.length > 0) {
        const callRecords = (aiStep.toolCalls || []).map((tc, i) => ({
          toolName: tc.toolName,
          args: tc.args,
          toolCallId: tc.toolCallId,
        }))
        const resultRecords = toolCalls.map((tc) => ({
          toolCallId: `${tc.toolName}-${totalSteps}`,
          result: tc.result,
        }))
        appendToolCallAndResult(
          sessionId,
          callRecords,
          resultRecords,
          aiStep.text || "",
        )
      } else {
        appendAssistantMessage(sessionId, aiStep.text || "")
      }

      // --- 首次步骤后：提取场景分析持久化 + 清理多模态二进制数据 ---
      if (totalSteps === 1) {
        console.log(
          "[agent-loop] Step 1 complete, running extractAndPersistVideoAnalysis...",
        )
        try {
          const videoAnalysis = extractAndPersistVideoAnalysis(sessionId)
          if (videoAnalysis) {
            console.log(
              `[agent-loop] Video analysis extracted → compactedSummary (${videoAnalysis.length} chars)`,
            )
          } else {
            console.log(
              "[agent-loop] Video analysis extraction returned null (no scenes found)",
            )
          }
        } catch (err: any) {
          console.error(
            `[agent-loop] extractAndPersistVideoAnalysis FAILED: ${err.message}`,
            err.stack,
          )
        }
      }

      // --- 检查 finishReason ---
      if (aiStep.finishReason !== "tool-calls") {
        // 检查 AI 回复中是否包含 INTENT_FORM 标记
        if (aiStep.text) {
          const intentForm = parseIntentFormTag(aiStep.text)
          if (intentForm) {
            const cleanText = stripIntentFormTag(aiStep.text)
            onStream?.({
              type: "intent-form-required",
              formId: intentForm.formId,
              message: intentForm.message || cleanText,
              options: intentForm.options,
              allowCustomInput: intentForm.allowCustomInput,
              customInputPlaceholder: intentForm.customInputPlaceholder,
            })
            if (cleanText) {
              onStream?.({ type: "text-delta", delta: cleanText })
            }
            appendAssistantMessage(sessionId, cleanText || intentForm.message)
            break
          }
        }

        // 早期步骤模型仅输出文本未调工具 → 注入继续提示，不直接退出
        if (
          totalSteps <= 2 &&
          toolCalls.length === 0 &&
          aiStep.finishReason === "stop"
        ) {
          appendUserMessage(
            sessionId,
            "你需要继续执行任务。请调用相应的工具来完成操作，不要只停留在描述阶段。",
          )
          continue
        }
        break
      }
    }

    // --- 完成轨迹记录 ---
    const hasAnyErrors = allSteps.some((s) =>
      s.toolCalls?.some((tc: any) => tc.result?.metadata?.error === true),
    )
    recorder.finishRecording(sessionId, !hasAnyErrors, {
      totalTokens: totalPromptTokens + totalCompletionTokens,
      fallback: {
        fellBack: fallbackState.fellBack,
        retryCount: fallbackState.retryCount,
        modelUsed: fallbackState.currentModelId,
      },
    })
  })

  // ================================================================
  // 后处理 hooks
  // ================================================================

  // 同步执行 maybeCreateSkill（fast path）
  const newSkillNudge = await maybeCreateSkillFromSteps(
    allSteps,
    sessionId,
    autoCreateSkill,
  )

  // 异步执行 handleToolError + curator events
  scheduleAsyncHooks(allSteps, sessionId)

  // 检查是否因 maxSteps 终止
  if (totalSteps >= maxSteps && !stoppedByAbort) {
    stoppedByMaxSteps = true
  }

  // ================================================================
  // 编译结果
  // ================================================================

  const aiText = allSteps
    .map((s) => s.text)
    .filter(Boolean)
    .join("\n\n")

  const lastToolData = getLastToolResultData(allSteps)

  const finalUsage: TokenUsage = {
    promptTokens: totalPromptTokens,
    completionTokens: totalCompletionTokens,
    totalTokens: totalPromptTokens + totalCompletionTokens,
  }

  return {
    success: lastToolData ? lastToolData.metadata?.error !== true : true,
    sessionId,
    aiText,
    steps: allSteps,
    totalSteps,
    stoppedByMaxSteps,
    stoppedByAbort,
    title: lastToolData?.title,
    output: lastToolData?.output || aiText,
    operation: lastToolData?.operation || "agent_loop",
    toolId: lastToolData?.toolId,
    metadata: lastToolData?.metadata || { success: true },
    usage: finalUsage.totalTokens > 0 ? finalUsage : undefined,
    cost:
      finalUsage.totalTokens > 0
        ? FallbackProvider.estimateCost(
            finalUsage,
            fallbackState.currentModelId,
          )
        : undefined,
    fallback: {
      modelUsed: fallbackState.currentModelId,
      providerUsed: fallbackState.currentProviderId,
      retryCount: fallbackState.retryCount,
      fellBack: fallbackState.fellBack,
    },
    nudges: newSkillNudge ? [newSkillNudge] : undefined,
  }
}
