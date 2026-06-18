/**
 * Qwen 大模型专用 Provider Options
 *
 * 提供 Qwen/DashScope 模型的优化配置、thinking budget 调优、
 * 任务复杂度评估和模型推荐。
 *
 * Qwen (通义千问) 模型系列通过阿里云 DashScope API 访问，
 * 使用 OpenAI-compatible 协议。支持的专用参数：
 *   - enable_search: 启用联网搜索（仅部分模型）
 *   - repetition_penalty: 重复惩罚（减少模型重复输出）
 *   - thinking_budget: 思考预算（推理模型专用）
 */

// ============================================================================
// Qwen 模型配置档案
// ============================================================================

export interface QwenModelProfile {
  modelId: string
  displayName: string
  /** 模型能力等级：basic / standard / advanced / reasoning */
  tier: "basic" | "standard" | "advanced" | "reasoning"
  /** 最大上下文长度（token） */
  maxContextTokens: number
  /** 是否支持 thinking/reasoning 模式 */
  supportsThinking: boolean
  /** 是否支持联网搜索 */
  supportsSearch: boolean
  /** 推荐温度范围 */
  temperatureRange: [number, number]
  /** 推荐 temperature 默认值 */
  defaultTemperature: number
  /** 适用场景 */
  suitableFor: string[]
  /** 推荐的最大输出 token 数 */
  maxOutputTokens: number
}

export const QWEN_MODEL_PROFILES: Record<string, QwenModelProfile> = {
  "qwen-max": {
    modelId: "qwen-max",
    displayName: "Qwen Max",
    tier: "advanced",
    maxContextTokens: 32_768,
    supportsThinking: false,
    supportsSearch: true,
    temperatureRange: [0.1, 1.5],
    defaultTemperature: 0.7,
    suitableFor: ["复杂视频编辑", "多步工具调用", "精细调色", "专业后期"],
    maxOutputTokens: 4096,
  },
  "qwen-plus": {
    modelId: "qwen-plus",
    displayName: "Qwen Plus",
    tier: "standard",
    maxContextTokens: 32_768,
    supportsThinking: false,
    supportsSearch: true,
    temperatureRange: [0.1, 1.5],
    defaultTemperature: 0.7,
    suitableFor: ["日常视频编辑", "滤镜应用", "字幕生成", "格式转换"],
    maxOutputTokens: 4096,
  },
  "qwen-turbo": {
    modelId: "qwen-turbo",
    displayName: "Qwen Turbo",
    tier: "basic",
    maxContextTokens: 8_192,
    supportsThinking: false,
    supportsSearch: false,
    temperatureRange: [0.1, 1.5],
    defaultTemperature: 0.7,
    suitableFor: ["简单编辑", "快速工具调用", "轻量剪辑"],
    maxOutputTokens: 2048,
  },
  "qwen3.6-plus": {
    modelId: "qwen3.6-plus",
    displayName: "Qwen 3.6 Plus",
    tier: "advanced",
    maxContextTokens: 128_000,
    supportsThinking: true,
    supportsSearch: true,
    temperatureRange: [0.1, 1.5],
    defaultTemperature: 0.7,
    suitableFor: ["复杂多轮对话", "深度视频理解", "精确工具调用", "长视频分析"],
    maxOutputTokens: 8192,
  },
}

// ============================================================================
// 任务复杂度评估
// ============================================================================

export type TaskComplexity = "simple" | "moderate" | "complex"

export interface TaskAssessment {
  complexity: TaskComplexity
  estimatedToolCalls: number
  requiresMultiTurn: boolean
  requiresDeepUnderstanding: boolean
  recommendedModel: string
  recommendedThinkingBudget: number
}

/**
 * 根据用户消息评估任务复杂度。
 * 用于自动选择最优 Qwen 模型和参数。
 */
export function assessTaskComplexity(message: string): TaskAssessment {
  const lower = message.toLowerCase()

  // 简单任务：单步操作、简单查询
  const simplePatterns = [
    "格式转换",
    "转成",
    "转换",
    "提取音频",
    "提取视频",
    "提取",
    "截图",
    "加速",
    "减速",
    "慢放",
    "快放",
    "加水印",
    "翻转",
    "旋转",
  ]
  const isSimple = simplePatterns.some((p) => lower.includes(p))

  // 复杂任务：多步操作、需要理解
  const complexPatterns = [
    "调色",
    "色彩分级",
    "电影感",
    "风格迁移",
    "分析",
    "识别",
    "检测",
    "批量",
    "多个视频",
    "画中画",
    "分屏",
    "多画面",
    "慢节奏",
    "深度解读",
    "纪录片",
    "复古",
    "电影感",
    "新闻",
    "自动剪辑",
    "智能裁剪",
  ]
  const isComplex = complexPatterns.some((p) => lower.includes(p))

  // 多轮检测
  const multiTurnPatterns = [
    "再",
    "继续",
    "然后",
    "接着",
    "之后",
    "同样",
    "相同",
    "也",
    "调亮一点",
    "再调整",
  ]
  const requiresMultiTurn = multiTurnPatterns.some((p) => lower.includes(p))

  // 深度理解检测
  const deepUnderstandingPatterns = [
    "分析",
    "理解",
    "识别",
    "检测内容",
    "讲了什么",
    "内容是什么",
    "描述",
    "风格分析",
    "画面内容",
  ]
  const requiresDeepUnderstanding = deepUnderstandingPatterns.some((p) =>
    lower.includes(p),
  )

  let complexity: TaskComplexity
  let estimatedToolCalls: number
  let recommendedModel: string
  let recommendedThinkingBudget: number

  if (isComplex || requiresDeepUnderstanding) {
    complexity = "complex"
    estimatedToolCalls = 5
    recommendedModel = "qwen3.6-plus"
    recommendedThinkingBudget = 2048
  } else if (isSimple && !requiresMultiTurn) {
    complexity = "simple"
    estimatedToolCalls = 1
    recommendedModel = "qwen-turbo"
    recommendedThinkingBudget = 0
  } else {
    complexity = "moderate"
    estimatedToolCalls = 3
    recommendedModel = "qwen-plus"
    recommendedThinkingBudget = 512
  }

  return {
    complexity,
    estimatedToolCalls,
    requiresMultiTurn,
    requiresDeepUnderstanding,
    recommendedModel,
    recommendedThinkingBudget,
  }
}

// ============================================================================
// Qwen Provider Options 工厂
// ============================================================================

export interface QwenProviderOptions {
  /** 通用 LLM 参数 */
  temperature?: number
  topP?: number
  maxTokens?: number

  /** Qwen 专用参数 */
  enableSearch?: boolean
  repetitionPenalty?: number
  seed?: number

  /** 推理/思考预算（Qwen 3.6 推理模型） */
  thinkingBudget?: number

  /** 是否为推理模型 */
  isReasoningModel: boolean
}

export interface QwenOptionsConfig {
  modelId: string
  taskComplexity?: TaskComplexity
  customTemperature?: number
  customMaxTokens?: number
  enableSearch?: boolean
  thinkingBudget?: number
}

/**
 * 根据模型和任务类型构建 Qwen 专用 provider options。
 *
 * 返回的对象可直接传给 agentLoop 的 providerOptions 参数：
 *   agentLoop({ providerOptions: { dashscope: qwenOptions } })
 */
export function buildQwenProviderOptions(
  config: QwenOptionsConfig,
): QwenProviderOptions {
  const profile = QWEN_MODEL_PROFILES[config.modelId]
  const task = config.taskComplexity || "moderate"

  const opts: QwenProviderOptions = {
    isReasoningModel: profile?.supportsThinking ?? false,
  }

  // temperature — 根据任务复杂度调整
  if (config.customTemperature !== undefined) {
    opts.temperature = config.customTemperature
  } else if (profile) {
    // 复杂任务 → 稍低 temperature（更精确），简单任务 → 稍高（更多样）
    switch (task) {
      case "simple":
        opts.temperature = profile.defaultTemperature
        break
      case "moderate":
        opts.temperature = profile.defaultTemperature - 0.1
        break
      case "complex":
        opts.temperature = Math.max(0.2, profile.defaultTemperature - 0.3)
        break
    }
  }

  // maxTokens
  if (config.customMaxTokens !== undefined) {
    opts.maxTokens = config.customMaxTokens
  } else if (profile) {
    opts.maxTokens = profile.maxOutputTokens
  }

  // thinking budget — 推理模型专用
  if (profile?.supportsThinking) {
    opts.thinkingBudget =
      config.thinkingBudget ??
      (task === "complex" ? 2048 : task === "moderate" ? 1024 : 0)
  }

  // 联网搜索
  if (config.enableSearch !== undefined && profile?.supportsSearch) {
    opts.enableSearch = config.enableSearch
  }

  // 重复惩罚 — 减少多轮对话中的重复输出
  if (task === "complex") {
    opts.repetitionPenalty = 1.05
  }

  return opts
}

/**
 * 检测给定模型 ID 是否为 Qwen/DashScope 模型。
 */
export function isQwenModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("qwen")
}

/**
 * 检测给定模型 ID 是否支持 thinking/reasoning 模式。
 */
export function supportsThinking(modelId: string): boolean {
  const profile = QWEN_MODEL_PROFILES[modelId]
  return profile?.supportsThinking ?? false
}

/**
 * 获取模型的推荐配置。
 */
export function getQwenModelProfile(
  modelId: string,
): QwenModelProfile | undefined {
  return QWEN_MODEL_PROFILES[modelId]
}

// ============================================================================
// 能力边界常量
// ============================================================================

/**
 * Qwen 模型能力边界定义。
 * 用于能力测试和模型选择决策。
 */
export interface CapabilityBoundary {
  capability: string
  description: string
  /** 哪些模型 tier 支持 */
  supportedBy: Array<QwenModelProfile["tier"]>
  /** 已知限制 */
  knownLimitations: string[]
  /** 建议的 workaround */
  workaround?: string
}

export const QWEN_CAPABILITIES: CapabilityBoundary[] = [
  {
    capability: "中文视频编辑指令理解",
    description: "理解中文口语化的视频编辑指令，包括俚语、模糊表达",
    supportedBy: ["standard", "advanced", "reasoning"],
    knownLimitations: [
      "basic tier 对复杂多步编辑指令的理解准确率下降约 15%",
      "长指令（>200 字）中可能忽略中间步骤",
    ],
    workaround: "将复杂指令拆分为多个简短的连续请求",
  },
  {
    capability: "多轮对话连续性",
    description: "在多个来回中保持编辑上下文，记住之前的操作",
    supportedBy: ["standard", "advanced", "reasoning"],
    knownLimitations: [
      "超过 10 轮对话后上下文细节开始丢失",
      "basic tier 在 5 轮后可能忘记初始视频路径",
    ],
    workaround: "使用 edit context 注入当前视频状态，而非完全依赖模型记忆",
  },
  {
    capability: "工具调用格式遵循",
    description: "按照 JSON Schema 格式输出工具调用参数",
    supportedBy: ["basic", "standard", "advanced", "reasoning"],
    knownLimitations: [
      "复杂嵌套参数（3 层以上）可能出错，建议参数深度 ≤ 2 层",
      "select 类型参数可能输出不在选项列表中的值",
    ],
    workaround: "在工具描述中明确列出所有有效选项值",
  },
  {
    capability: "视频内容理解",
    description: "通过视频分析工具的结果理解视频内容并进行编辑决策",
    supportedBy: ["advanced", "reasoning"],
    knownLimitations: [
      "无法直接处理视频帧（需要 video_extract_frame 工具的结果）",
      "长视频（>30 分钟）的分析结果可能超出上下文窗口",
    ],
    workaround: "先做场景检测分割，分段分析再汇总",
  },
  {
    capability: "错误恢复与自适应",
    description: "工具调用失败后自动调整参数重试或建议替代方案",
    supportedBy: ["advanced", "reasoning"],
    knownLimitations: [
      "basic/standard tier 在工具失败后倾向直接报错而非尝试修复",
      "对权限拒绝类错误可能反复重试而非请求用户授权",
    ],
    workaround: "在 system prompt 中明确错误恢复策略",
  },
  {
    capability: "并行工具调用",
    description: "在一次响应中同时调用多个独立工具",
    supportedBy: ["advanced", "reasoning"],
    knownLimitations: [
      "basic tier 一次只调用一个工具",
      "有依赖关系的工具可能被错误地并行调用",
    ],
    workaround: "在工具描述中标注依赖关系",
  },
]

// ============================================================================
// Qwen 模型定价（每 1M token, USD）
// ============================================================================

const QWEN_PRICING: Record<string, { input: number; output: number }> = {
  "qwen-max": { input: 2.0, output: 8.0 },
  "qwen-turbo": { input: 0.3, output: 0.6 },
  "qwen-plus": { input: 0.8, output: 2.0 },
  "qwen3.6-plus": { input: 2.0, output: 8.0 },
}

/**
 * 生成 Qwen 能力边界报告。
 */
export function generateCapabilityReport(): string {
  const lines: string[] = [
    "# Qwen 大模型能力边界报告",
    `生成时间：${new Date().toISOString()}`,
    "",
    "## 模型概览",
    "",
    "| 模型 ID | 等级 | 上下文 | 推理 | 搜索 | 适用场景 |",
    "|---------|------|--------|------|------|---------|",
    ...Object.values(QWEN_MODEL_PROFILES).map(
      (p) =>
        `| ${p.modelId} | ${p.tier} | ${(p.maxContextTokens / 1024).toFixed(0)}K | ${p.supportsThinking ? "✅" : "❌"} | ${p.supportsSearch ? "✅" : "❌"} | ${p.suitableFor.slice(0, 2).join(", ")} |`,
    ),
    "",
    "## 能力边界详情",
    "",
    ...QWEN_CAPABILITIES.flatMap((c) => [
      `### ${c.capability}`,
      "",
      c.description,
      "",
      `- 支持等级：${c.supportedBy.join(", ")}`,
      `- 已知限制：`,
      ...c.knownLimitations.map((l) => `  - ${l}`),
      ...(c.workaround ? [`- 建议方案：${c.workaround}`] : []),
      "",
    ]),
    "",
    "## Fallback 策略",
    "",
    "当前系统配置了以下 fallback 链：",
    "1. 主模型（用户指定）",
    "2. DeepSeek Chat（成本低、响应快、中文优秀）",
    "3. Qwen Plus/Max（阿里云 DashScope）",
    "",
    "### 触发条件",
    "- 限流错误（429 / rate_limit）→ 指数退避重试 2 次 → fallback",
    "- 服务不可用（502/503/504）→ 指数退避重试 2 次 → fallback",
    "- 超时 → 指数退避重试 2 次 → fallback",
    "- 连续失败 5 次 → 断路器 OPEN → 直接 fallback",
    "",
    "### 退避策略",
    "- 基础延迟：1 秒",
    "- 指数因子：2^attempt",
    "- 抖动：±25% 随机抖动",
    "",
    "## 成本对比（每 1M token, USD）",
    "",
    "| 模型 | 输入 | 输出 |",
    "|------|------|------|",
    ...Object.entries(QWEN_PRICING).map(
      ([id, price]) =>
        `| ${id} | $${price.input.toFixed(2)} | $${price.output.toFixed(2)} |`,
    ),
  ]
  return lines.join("\n")
}
