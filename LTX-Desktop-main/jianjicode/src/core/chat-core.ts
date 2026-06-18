/**
 * jianjicode 聊天核心模块
 *
 * 纯业务逻辑层，无 CLI/UI 依赖。
 * 可同时被 CLI (chat.ts) 和 HTTP 服务 (server.ts) 使用。
 *
 * Phase 4: 使用 AI SDK 原生 tool calling，替代旧的文本解析 pipeline。
 */
import { existsSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import type {
  CostEstimate,
  ModelConfig as FallbackModelConfig,
  TokenUsage,
} from "../../ai/provider/fallback-provider.js"
import { FallbackProvider } from "../../ai/provider/fallback-provider.js"
import { SimpleProvider as Provider } from "../../ai/provider/simple-provider.js"
import {
  createFileStore,
  createPermissionService,
  loadPermissionConfig,
  setGlobalPermissionService,
} from "../permission/index.js"
import { initializeTools } from "../registry/tool_registry.js"
import type { LTXEditResult } from "../types/edit-result.js"
import { editResultError } from "../types/edit-result.js"
import type { StreamEvent } from "./agent-loop.js"
import { agentLoop } from "./agent-loop.js"
import { setPermissionEvaluate } from "./ai-stream.js"
import { getSessionStats } from "./chat-session.js"
import {
  assessTaskComplexity,
  buildQwenProviderOptions,
  isQwenModel,
} from "./qwen-provider-options.js"

// ============================================================================
// 类型定义
// ============================================================================

export interface AppConfig {
  deepseek?: { apiKey: string; baseURL?: string }
  ffmpeg?: { path: string; ffprobePath?: string }
  [key: string]: any
}

export interface ModelConfig {
  providerID: string
  modelID: string
  apiKey?: string
  baseURL?: string
}

export interface ChatResult extends LTXEditResult {
  /** 会话 ID，用于多轮对话跟踪 */
  sessionId?: string
  data?: {
    analysis: string
    operation: string
    toolId: string
    parameters: Record<string, any>
    output: string
    title?: string
    sessionId?: string
  }
  /** Token 用量统计 */
  usage?: TokenUsage
  /** 成本估算 */
  cost?: CostEstimate
  /** Fallback/重试信息 */
  providerInfo?: {
    modelUsed: string
    retryCount: number
    fellBack: boolean
  }
  /** 本次执行产生的 nudge 消息（技能创建建议、优化报告等） */
  nudges?: Array<{
    type: string
    message: string
    [key: string]: unknown
  }>
}

export interface ChatCallbacks {
  onLog?: (message: string) => void
  onProgress?: (step: string, detail?: string) => void
  onResult?: (result: ChatResult) => void
  /** 流式事件回调（实时推送 text delta / tool call / tool result 等） */
  onStream?: (event: StreamEvent) => void
}

// ============================================================================
// 文件路径工具
// ============================================================================

export function extractVideoFiles(message: string): string[] {
  const files: string[] = []

  // 规范化中文标点：全角冒号、顿号等可能出现在路径前面的字符 → 空格
  const normalized = message.replace(/[：，。、！？；]/g, " ")

  // Match absolute paths (D:\path\video.mp4 or D:/path/video.mp4 or /path/video.mp4)
  // Also match paths inside quotes (JSON template values)
  const absolutePattern =
    /(?:^|\s|["'])((?:[A-Za-z]:[\/\\]|\/)[^\s"']*\.(?:mp4|avi|mov|mkv|flv|wmv|webm))\b/gi
  let m
  while ((m = absolutePattern.exec(normalized)) !== null) {
    files.push(m[1].trim())
  }

  // Match relative paths (./video.mp4 or ../video.mp4)
  const relativePattern =
    /(?:^|\s)((?:\.\.\/|\.\/)[^\s]+?(?:\s[^\s]+?)*\.(?:mp4|avi|mov|mkv|flv|wmv|webm))\b/gi
  while ((m = relativePattern.exec(normalized)) !== null) {
    files.push(m[1].trim())
  }

  // Match audio files (only with proper path prefix — not bare filenames in text)
  const audioPattern =
    /(?:^|\s)((?:[A-Za-z]:[\/\\]|\/|\.\.\/|\.\/)[^\s]*\.(?:mp3|wav|aac|flac|ogg|m4a))\b/gi
  while ((m = audioPattern.exec(normalized)) !== null) {
    files.push(m[1].trim())
  }

  return [...new Set(files)]
}

export function resolveFilePath(filePath: string): string {
  if (existsSync(filePath)) return path.resolve(filePath)

  const cwdPath = path.join(process.cwd(), filePath)
  if (existsSync(cwdPath)) return path.resolve(cwdPath)

  const parentPath = path.join(process.cwd(), "..", filePath)
  if (existsSync(parentPath)) return path.resolve(parentPath)

  const grandParentPath = path.join(process.cwd(), "..", "..", filePath)
  if (existsSync(grandParentPath)) return path.resolve(grandParentPath)

  return filePath
}

// ============================================================================
// 配置管理
// ============================================================================

export function getProviderApiKeyEnvVar(providerID: string): string | null {
  switch (providerID.toLowerCase()) {
    case "openai":
      return "OPENAI_API_KEY"
    case "anthropic":
      return "ANTHROPIC_API_KEY"
    case "google":
    case "google-vertex":
      return "GOOGLE_API_KEY"
    case "openrouter":
      return "OPENROUTER_API_KEY"
    case "vercel":
      return "VERCEL_API_KEY"
    case "azure":
      return "AZURE_OPENAI_API_KEY"
    default: {
      const upper = providerID.toUpperCase().replace(/-/g, "_")
      return `${upper}_API_KEY`
    }
  }
}

export function loadConfig(): AppConfig {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)

  const candidates = [
    path.join(process.cwd(), "config.json"),
    path.join(__dirname, "../../../config.json"),
    path.join(__dirname, "../../config.json"),
  ]

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf-8")
        return JSON.parse(content)
      } catch (error) {
        console.warn(`[config] Failed to load ${configPath}: ${error}`)
      }
    }
  }
  return {}
}

export function resolveModelConfig(
  args: Record<string, any>,
  config: AppConfig,
): ModelConfig {
  const result: ModelConfig = {
    providerID: args.provider || "openai",
    modelID: args.model || "gpt-4o",
    apiKey: args.apiKey || undefined,
    baseURL: args.apiBaseUrl || undefined,
  }

  const hasExplicitProvider =
    args.provider !== undefined && args.provider !== "openai"

  // Env vars: DASHSCOPE_API_KEY / DEEPSEEK_API_KEY (preferred over config.json)
  const envDsKey = process.env.DASHSCOPE_API_KEY || ""
  const envDeepKey = process.env.DEEPSEEK_API_KEY || ""

  if (!hasExplicitProvider) {
    // Default: DashScope (Qwen) first — user explicitly prefers Qwen over DeepSeek
    if (!result.apiKey && (envDsKey || config.dashscope?.apiKey)) {
      result.apiKey = envDsKey || config.dashscope?.apiKey
      result.baseURL = result.baseURL || process.env.DASHSCOPE_BASE_URL || config.dashscope?.baseURL
      result.providerID = "alibaba-cn"
      // 仅在用户未显式指定 model 时使用默认值，避免覆盖用户的模型选择
      if (args.model === undefined) {
        result.modelID = process.env.DASHSCOPE_MODEL || config.dashscope?.model || "qwen-max"
      }
    } else if (!result.apiKey && (envDeepKey || config.deepseek?.apiKey)) {
      result.apiKey = envDeepKey || config.deepseek?.apiKey
      result.baseURL = result.baseURL || process.env.DEEPSEEK_BASE_URL || config.deepseek?.baseURL
      result.providerID = "openai-compatible"
      result.modelID = "deepseek-chat"
    }
  } else {
    if (!result.apiKey) {
      if (
        (envDeepKey || config.deepseek?.apiKey) &&
        result.providerID === "openai-compatible"
      ) {
        result.apiKey = envDeepKey || config.deepseek?.apiKey
        result.baseURL = result.baseURL || process.env.DEEPSEEK_BASE_URL || config.deepseek?.baseURL
      } else if (
        (envDsKey || config.dashscope?.apiKey) &&
        result.providerID === "alibaba-cn"
      ) {
        result.apiKey = envDsKey || config.dashscope?.apiKey
        result.baseURL = result.baseURL || process.env.DASHSCOPE_BASE_URL || config.dashscope?.baseURL
      }
    }
  }

  return result
}

// ============================================================================
// 主聊天处理函数
// ============================================================================

/**
 * 执行一次完整的聊天请求：初始化工具 → 配置 AI → 原生 tool calling → 返回结果
 *
 * Phase 4: 不再依赖文本解析和关键词绕过，AI 模型自主选择工具。
 *
 * 支持多轮对话：传入 sessionId 可保持跨请求上下文。
 * 不传则自动生成新 sessionId。
 *
 * @param message   用户消息
 * @param args      额外参数（provider, model, apiKey, apiBaseUrl, sessionId, verbose 等）
 * @param callbacks 可选回调，用于 UI 或 HTTP 场景输出进度
 * @returns         执行结果，含 sessionId 用于后续请求
 */
export async function processChatRequest(
  message: string,
  args: Record<string, any> = {},
  callbacks?: ChatCallbacks,
): Promise<ChatResult> {
  const log =
    callbacks?.onLog ??
    ((_msg: string) => {
      /* no-op */
    })
  const progress =
    callbacks?.onProgress ??
    (() => {
      /* no-op */
    })

  try {
    // 1. 加载配置，初始化工具
    const config = loadConfig()
    log("[core] Config loaded")

    // 1b. 初始化权限系统
    const permConfig = loadPermissionConfig(config as Record<string, unknown>)
    const permStore = createFileStore()
    const permissionService = createPermissionService({
      rules: permConfig.rules,
      defaultAction: permConfig.defaultAction,
      store: permStore,
    })
    setGlobalPermissionService(permissionService)
    log(
      `[core] Permission system initialized (${permConfig.rules.length} rules, default: ${permConfig.defaultAction})`,
    )
    // 注入到 ai-stream 的 buildToolSet() 中
    setPermissionEvaluate((permission, pattern) =>
      permissionService.evaluate(permission, pattern),
    )

    progress("initializing", "Initializing tools...")
    await initializeTools()

    // 2. 配置 AI 模型
    progress("model", "Configuring AI model...")
    const modelCfg = resolveModelConfig(args, config)
    const languageModel = await Provider.getLanguage(
      { providerID: modelCfg.providerID as any, id: modelCfg.modelID },
      { apiKey: modelCfg.apiKey, baseURL: modelCfg.baseURL },
    )

    // 2b. 构建 fallback 模型链
    const backupModels: FallbackModelConfig[] = []
    if (args.backupProvider || args.backupModel) {
      backupModels.push({
        providerID: args.backupProvider || "openai-compatible",
        modelID: args.backupModel || "deepseek-chat",
        apiKey: args.backupApiKey || undefined,
        baseURL: args.backupBaseURL || undefined,
      })
    }
    // 自动 fallback：deepseek-chat 作为通用备用
    if (backupModels.length === 0 && modelCfg.modelID !== "deepseek-chat") {
      if (config.deepseek?.apiKey) {
        backupModels.push({
          providerID: "openai-compatible",
          modelID: "deepseek-chat",
          apiKey: config.deepseek.apiKey,
          baseURL: config.deepseek.baseURL,
        })
      }
    }
    // 如果主模型不是 dashscope/qwen，尝试用 dashscope 作为二级备用
    if (
      modelCfg.modelID !== "deepseek-chat" &&
      modelCfg.providerID !== "alibaba-cn"
    ) {
      if (
        config.dashscope?.apiKey &&
        !backupModels.some((m) => m.providerID === "alibaba-cn")
      ) {
        backupModels.push({
          providerID: "alibaba-cn",
          modelID: config.dashscope?.model || "qwen-plus",
          apiKey: config.dashscope.apiKey,
          baseURL: config.dashscope.baseURL,
        })
      }
    }

    // 3. 会话管理：生成或获取 sessionId
    const sessionId =
      args.sessionId ||
      `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const existingSession = getSessionStats(sessionId)
    if (existingSession) {
      log(
        `[core] Continuing session ${sessionId} (${existingSession.messageCount} msgs, ~${existingSession.estimatedTokens} tokens)`,
      )
    }

    // 4. AI 原生 tool calling — 真正的 Agent Loop（替代旧的 stepCountIs）
    progress("analyze", "Analyzing request with AI...")
    const maxSteps = args.maxSteps || args.max_steps || 10
    const maxTokens = args.maxTokens || args.max_tokens || 8000
    const autoCreateSkill: "always" | "confirm" | "off" =
      args.autoCreateSkill || (config as any)?.autoCreateSkill || "confirm"

    // provider 透传选项（temperature, thinking budget, etc.）
    let providerOptions: Record<string, Record<string, unknown>> | undefined =
      args.providerOptions || args.provider_options || undefined

    // Qwen 模型自动优化：检测到 Qwen 模型时应用专用 provider options
    if (isQwenModel(modelCfg.modelID)) {
      const taskAssessment = assessTaskComplexity(message)
      const qwenOpts = buildQwenProviderOptions({
        modelId: modelCfg.modelID,
        taskComplexity: taskAssessment.complexity,
        customTemperature: args.temperature,
        customMaxTokens: args.maxOutputTokens || args.max_output_tokens,
        enableSearch: args.enableSearch || args.enable_search,
        thinkingBudget: args.thinkingBudget || args.thinking_budget,
      })
      // 合并到 providerOptions（用户传入的优先级更高）
      const autoOpts = {
        temperature: qwenOpts.temperature,
        maxTokens: qwenOpts.maxTokens,
        ...(qwenOpts.enableSearch !== undefined
          ? { enable_search: qwenOpts.enableSearch }
          : {}),
        ...(qwenOpts.repetitionPenalty !== undefined
          ? { repetition_penalty: qwenOpts.repetitionPenalty }
          : {}),
        ...(qwenOpts.thinkingBudget !== undefined
          ? { thinking_budget: qwenOpts.thinkingBudget }
          : {}),
      }
      if (providerOptions) {
        // 用户指定优先，自动配置为 fallback
        providerOptions.dashscope = {
          ...autoOpts,
          ...(providerOptions.dashscope || {}),
        }
      } else {
        providerOptions = { dashscope: autoOpts }
      }
      log(
        `[core] Qwen auto-config: model=${modelCfg.modelID} complexity=${taskAssessment.complexity} thinking=${qwenOpts.thinkingBudget || 0}`,
      )
    }

    // 提取 DashScope API key（用于 OSS 视频上传透传）
    const dsApiKey =
      process.env.DASHSCOPE_API_KEY ||
      (config as any).dashscope?.apiKey ||
      ""
    const dsModel =
      process.env.DASHSCOPE_MODEL ||
      (config as any).dashscope?.model ||
      "qwen-plus"

    const result = await agentLoop({
      model: languageModel,
      sessionId,
      message,
      system: undefined, // 使用默认动态 system prompt
      maxSteps,
      maxTokens,
      abortSignal: undefined,
      // Provider 透传
      providerOptions,
      temperature:
        args.temperature !== undefined ? args.temperature : undefined,
      maxOutputTokens:
        args.maxOutputTokens || args.max_output_tokens || undefined,
      // DashScope OSS 视频上传
      dashscopeApiKey: dsApiKey || undefined,
      dashscopeModel: dsModel,
      // Fallback 链
      fallbackModels: backupModels.length > 0 ? backupModels : undefined,
      maxRetries: args.maxRetries || args.max_retries || 2,
      baseDelayMs: args.baseDelayMs || args.base_delay_ms || 1000,
      editorContext: args.editorContext,
      autoCreateSkill,
      onStream: callbacks?.onStream,
      onStep: (step) => {
        log(
          `[core] Step ${step.stepNumber}: ${step.finishReason} (${step.toolCalls?.length || 0} tool calls)`,
        )
      },
    })

    log(
      `[core] AI response: ${result.aiText || result.output} (${result.totalSteps} steps)`,
    )

    // 记录用量 / 成本日志
    if (result.usage) {
      log(
        `[core] Token usage: ${result.usage.promptTokens} prompt + ${result.usage.completionTokens} completion = ${result.usage.totalTokens} total`,
      )
    }
    if (result.cost) {
      log(
        `[core] Estimated cost: $${result.cost.totalCost.toFixed(6)} ($${result.cost.inputCost.toFixed(6)} input + $${result.cost.outputCost.toFixed(6)} output)`,
      )
    }
    if (result.fallback) {
      log(
        `[core] Model: ${result.fallback.modelUsed} (retries: ${result.fallback.retryCount}, fellBack: ${result.fallback.fellBack})`,
      )
    }

    // 5. 将 nudge 通过 stream 事件推送
    if (result.nudges && result.nudges.length > 0 && callbacks?.onStream) {
      for (const nudge of result.nudges) {
        callbacks.onStream({
          type: "nudge",
          nudge: nudge as { type: string; message: string; [key: string]: unknown },
        })
      }
    }

    // 6. 构建 ChatResult（向后兼容）
    return {
      success: result.success,
      title: result.title || (result.success ? "AI Response" : "Error"),
      output: result.output || result.aiText,
      operation: result.operation || "agent_loop",
      toolId: result.toolId || "",
      metadata: {
        ...(result.metadata || {}),
        usage: result.usage,
        cost: result.cost,
        fallback: result.fallback,
      },
      sessionId: result.sessionId,
      usage: result.usage,
      cost: result.cost,
      providerInfo: result.fallback
        ? {
            modelUsed: result.fallback.modelUsed,
            retryCount: result.fallback.retryCount,
            fellBack: result.fallback.fellBack,
          }
        : undefined,
      nudges: result.nudges,
      data: {
        analysis: result.aiText || "",
        operation: result.operation || "agent_loop",
        toolId: result.toolId || "",
        parameters: {},
        output: result.output || result.aiText || "",
        title: result.title || (result.success ? "AI Response" : "Error"),
        sessionId: result.sessionId,
      },
    }
  } catch (error: any) {
    return {
      ...editResultError("chat", error?.message || String(error)),
      sessionId: args.sessionId,
    }
  }
}
