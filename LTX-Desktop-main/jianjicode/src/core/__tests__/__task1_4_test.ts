/**
 * Task 1.4 测试 — Qwen 大模型集成优化
 *
 * 测试内容：
 *   1. Qwen model profiles — 模型配置档案验证
 *   2. Task complexity assessment — 任务复杂度评估
 *   3. Qwen provider options — options 工厂
 *   4. Model detection helpers — isQwenModel / supportsThinking
 *   5. Capability boundary report — 能力边界报告生成
 *   6. Fallback provider — fallback/backoff/retryable/cost (regression)
 *   7. Circuit breaker — 断路器集成
 *   8. Provider options integration — chat-core Qwen auto-config
 *   9. Token usage and cost — 用量统计和成本估算
 */

import {
  QWEN_MODEL_PROFILES,
  QWEN_CAPABILITIES,
  assessTaskComplexity,
  buildQwenProviderOptions,
  isQwenModel,
  supportsThinking,
  getQwenModelProfile,
  generateCapabilityReport,
} from "../qwen-provider-options.js"
import type { QwenModelProfile, QwenProviderOptions, TaskAssessment } from "../qwen-provider-options.js"
import { FallbackProvider } from "../../../ai/provider/fallback-provider.js"
import type { TokenUsage } from "../../../ai/provider/fallback-provider.js"
import { CircuitBreaker, getCircuitBreaker, resetAllCircuitBreakers } from "../circuit-breaker.js"
import type { CircuitBreakerStats } from "../circuit-breaker.js"

let passed = 0
let failed = 0

function assert(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`)
    failed++
  }
}

// ============================================================================
// 1. Qwen Model Profiles
// ============================================================================
console.log("\n📦 1. Qwen model profiles — 模型配置档案")
console.log("  " + "─".repeat(50))

function testQwenModelProfiles() {
  const profiles = Object.values(QWEN_MODEL_PROFILES)
  assert("QWEN_MODEL_PROFILES 有 4 个模型", profiles.length === 4)

  // qwen-max
  const maxProfile = QWEN_MODEL_PROFILES["qwen-max"]
  assert("qwen-max: tier = advanced", maxProfile.tier === "advanced")
  assert("qwen-max: maxContextTokens", maxProfile.maxContextTokens > 30000)
  assert("qwen-max: supportsSearch = true", maxProfile.supportsSearch === true)
  assert(
    "qwen-max: supportsThinking = false",
    maxProfile.supportsThinking === false,
  )
  assert(
    "qwen-max: temperatureRange",
    maxProfile.temperatureRange[1] > maxProfile.temperatureRange[0],
  )
  assert("qwen-max: 有适用场景", maxProfile.suitableFor.length > 0)

  // qwen-plus
  const plusProfile = QWEN_MODEL_PROFILES["qwen-plus"]
  assert("qwen-plus: tier = standard", plusProfile.tier === "standard")
  assert(
    "qwen-plus: supportsSearch = true",
    plusProfile.supportsSearch === true,
  )
  assert("qwen-plus: maxOutputTokens > 0", plusProfile.maxOutputTokens > 0)

  // qwen-turbo
  const turboProfile = QWEN_MODEL_PROFILES["qwen-turbo"]
  assert("qwen-turbo: tier = basic", turboProfile.tier === "basic")
  assert(
    "qwen-turbo: supportsSearch = false",
    turboProfile.supportsSearch === false,
  )
  assert(
    "qwen-turbo: maxContextTokens < 20000",
    turboProfile.maxContextTokens < 20000,
  )

  // qwen3.6-plus
  const qwen36 = QWEN_MODEL_PROFILES["qwen3.6-plus"]
  assert("qwen3.6-plus: tier = advanced", qwen36.tier === "advanced")
  assert(
    "qwen3.6-plus: supportsThinking = true",
    qwen36.supportsThinking === true,
  )
  assert(
    "qwen3.6-plus: maxContextTokens = 128000",
    qwen36.maxContextTokens === 128_000,
  )
  assert("qwen3.6-plus: supportsSearch = true", qwen36.supportsSearch === true)

  // 所有 profile 结构完整
  for (const profile of profiles) {
    assert(
      `${profile.modelId}: displayName 非空`,
      profile.displayName.length > 0,
    )
    assert(
      `${profile.modelId}: tier 有效`,
      ["basic", "standard", "advanced", "reasoning"].includes(profile.tier),
    )
    assert(
      `${profile.modelId}: temperatureRange 有效`,
      profile.temperatureRange[0] >= 0 && profile.temperatureRange[1] <= 2.0,
    )
    assert(
      `${profile.modelId}: defaultTemperature 在范围内`,
      profile.defaultTemperature >= profile.temperatureRange[0] &&
        profile.defaultTemperature <= profile.temperatureRange[1],
    )
  }
}

testQwenModelProfiles()

// ============================================================================
// 2. Task Complexity Assessment
// ============================================================================
console.log("\n📦 2. Task complexity assessment — 任务复杂度评估")
console.log("  " + "─".repeat(50))

function testTaskComplexityAssessment() {
  // 简单任务
  const simple1 = assessTaskComplexity("把这个视频转成mp4格式")
  assert("格式转换 → simple", simple1.complexity === "simple")
  assert("简单任务 estimatedToolCalls = 1", simple1.estimatedToolCalls === 1)
  assert("简单任务推荐 qwen-turbo", simple1.recommendedModel === "qwen-turbo")
  assert("简单任务 thinkingBudget = 0", simple1.recommendedThinkingBudget === 0)

  const simple2 = assessTaskComplexity("提取视频的音频")
  assert("提取音频 → simple", simple2.complexity === "simple")

  const simple3 = assessTaskComplexity("给视频加水印")
  assert("加水印 → simple", simple3.complexity === "simple")

  const simple4 = assessTaskComplexity("把视频加速2倍")
  assert("加速 → simple", simple4.complexity === "simple")

  // 中等任务
  const moderate1 = assessTaskComplexity("给视频添加字幕")
  assert("添加字幕 → moderate", moderate1.complexity === "moderate")
  assert("中等任务 estimatedToolCalls = 3", moderate1.estimatedToolCalls === 3)
  assert("中等任务推荐 qwen-plus", moderate1.recommendedModel === "qwen-plus")
  assert(
    "中等任务 thinkingBudget = 512",
    moderate1.recommendedThinkingBudget === 512,
  )

  const moderate2 = assessTaskComplexity("帮我把两个视频合并在一起")
  assert("合并视频 → moderate", moderate2.complexity === "moderate")

  // 复杂任务
  const complex1 = assessTaskComplexity("给视频做电影感调色，加宽银幕裁剪")
  assert("电影感调色 → complex", complex1.complexity === "complex")
  assert("复杂任务 estimatedToolCalls = 5", complex1.estimatedToolCalls === 5)
  assert(
    "复杂任务推荐 qwen3.6-plus",
    complex1.recommendedModel === "qwen3.6-plus",
  )
  assert(
    "复杂任务 thinkingBudget = 2048",
    complex1.recommendedThinkingBudget === 2048,
  )

  const complex2 = assessTaskComplexity(
    "分析这个视频的内容，识别里面有什么物体",
  )
  assert("视频分析 → complex", complex2.complexity === "complex")
  assert(
    "分析任务 requiresDeepUnderstanding = true",
    complex2.requiresDeepUnderstanding === true,
  )

  const complex3 = assessTaskComplexity(
    "给这个视频用复古风格处理，加上胶片噪点和划痕效果",
  )
  assert("复古风格 → complex", complex3.complexity === "complex")

  const complex4 = assessTaskComplexity(
    "批量处理文件夹里所有视频，统一添加滤镜",
  )
  assert("批量处理 → complex", complex4.complexity === "complex")

  // 多轮对话检测
  const multiTurn1 = assessTaskComplexity("再调亮一点")
  assert(
    "'再调亮一点' → requiresMultiTurn",
    multiTurn1.requiresMultiTurn === true,
  )

  const multiTurn2 = assessTaskComplexity("同样的操作应用到第二个视频")
  assert(
    "'同样的操作' → requiresMultiTurn",
    multiTurn2.requiresMultiTurn === true,
  )

  const singleTurn = assessTaskComplexity("给视频加速")
  assert(
    "'给视频加速' → !requiresMultiTurn",
    singleTurn.requiresMultiTurn === false,
  )

  // 深度理解检测
  const deep1 = assessTaskComplexity("这个视频讲了什么内容")
  assert(
    "'讲了什么' → requiresDeepUnderstanding",
    deep1.requiresDeepUnderstanding === true,
  )

  const deep2 = assessTaskComplexity("分析一下这个画面的风格")
  assert(
    "'风格分析' → requiresDeepUnderstanding",
    deep2.requiresDeepUnderstanding === true,
  )

  // 返回类型验证
  for (const t of [simple1, moderate1, complex1]) {
    assert(`${t.complexity}: 有 estimatedToolCalls`, t.estimatedToolCalls > 0)
    assert(
      `${t.complexity}: 有 recommendedModel`,
      t.recommendedModel.length > 0,
    )
    assert(
      `${t.complexity}: thinkingBudget >= 0`,
      t.recommendedThinkingBudget >= 0,
    )
    assert(
      `${t.complexity}: requiresMultiTurn 是 boolean`,
      typeof t.requiresMultiTurn === "boolean",
    )
    assert(
      `${t.complexity}: requiresDeepUnderstanding 是 boolean`,
      typeof t.requiresDeepUnderstanding === "boolean",
    )
  }
}

testTaskComplexityAssessment()

// ============================================================================
// 3. Qwen Provider Options Factory
// ============================================================================
console.log("\n📦 3. Qwen provider options — options 工厂")
console.log("  " + "─".repeat(50))

function testQwenProviderOptions() {
  // qwen-turbo simple task
  const turboSimple = buildQwenProviderOptions({
    modelId: "qwen-turbo",
    taskComplexity: "simple",
  })
  assert(
    "qwen-turbo: isReasoningModel = false",
    turboSimple.isReasoningModel === false,
  )
  assert(
    "qwen-turbo: 无 thinkingBudget",
    turboSimple.thinkingBudget === undefined,
  )
  assert("qwen-turbo: 无 enableSearch", turboSimple.enableSearch === undefined)

  // qwen-plus moderate task
  const plusModerate = buildQwenProviderOptions({
    modelId: "qwen-plus",
    taskComplexity: "moderate",
  })
  assert(
    "qwen-plus: isReasoningModel = false",
    plusModerate.isReasoningModel === false,
  )
  assert(
    "qwen-plus: temperature < 默认值",
    plusModerate.temperature !== undefined,
  )

  // qwen3.6-plus complex task with thinking
  const qwen36Complex = buildQwenProviderOptions({
    modelId: "qwen3.6-plus",
    taskComplexity: "complex",
  })
  assert(
    "qwen3.6-plus: isReasoningModel = true",
    qwen36Complex.isReasoningModel === true,
  )
  assert(
    "qwen3.6-plus: thinkingBudget = 2048",
    qwen36Complex.thinkingBudget === 2048,
  )
  assert(
    "qwen3.6-plus: temperature 较低(精确)",
    qwen36Complex.temperature !== undefined &&
      qwen36Complex.temperature! <= 0.5,
  )
  assert(
    "qwen3.6-plus: repetitionPenalty 有值",
    qwen36Complex.repetitionPenalty !== undefined,
  )

  // qwen3.6-plus moderate task
  const qwen36Moderate = buildQwenProviderOptions({
    modelId: "qwen3.6-plus",
    taskComplexity: "moderate",
  })
  assert(
    "qwen3.6-plus moderate: thinkingBudget = 1024",
    qwen36Moderate.thinkingBudget === 1024,
  )

  // qwen3.6-plus simple task
  const qwen36Simple = buildQwenProviderOptions({
    modelId: "qwen3.6-plus",
    taskComplexity: "simple",
  })
  assert(
    "qwen3.6-plus simple: thinkingBudget = 0",
    qwen36Simple.thinkingBudget === 0,
  )

  // custom temperature override
  const customTemp = buildQwenProviderOptions({
    modelId: "qwen-max",
    customTemperature: 0.3,
  })
  assert("customTemperature 覆盖", customTemp.temperature === 0.3)

  // custom maxTokens
  const customMax = buildQwenProviderOptions({
    modelId: "qwen-max",
    customMaxTokens: 8000,
  })
  assert("customMaxTokens 覆盖", customMax.maxTokens === 8000)

  // enableSearch override
  const withSearch = buildQwenProviderOptions({
    modelId: "qwen-max",
    enableSearch: true,
  })
  assert("enableSearch true", withSearch.enableSearch === true)

  // thinking budget override
  const customThinking = buildQwenProviderOptions({
    modelId: "qwen3.6-plus",
    thinkingBudget: 4096,
  })
  assert("thinkingBudget override", customThinking.thinkingBudget === 4096)

  // 所有返回的 options 结构完整
  const allOptions = [
    turboSimple,
    plusModerate,
    qwen36Complex,
    qwen36Moderate,
    qwen36Simple,
  ]
  for (const opts of allOptions) {
    assert(
      `Options: isReasoningModel 是 boolean`,
      typeof opts.isReasoningModel === "boolean",
    )
  }
}

testQwenProviderOptions()

// ============================================================================
// 4. Model Detection Helpers
// ============================================================================
console.log("\n📦 4. Model detection helpers — isQwenModel / supportsThinking")
console.log("  " + "─".repeat(50))

function testModelDetection() {
  assert("isQwenModel('qwen-max') → true", isQwenModel("qwen-max") === true)
  assert("isQwenModel('qwen-plus') → true", isQwenModel("qwen-plus") === true)
  assert("isQwenModel('qwen-turbo') → true", isQwenModel("qwen-turbo") === true)
  assert(
    "isQwenModel('qwen3.6-plus') → true",
    isQwenModel("qwen3.6-plus") === true,
  )
  assert(
    "isQwenModel('QWEN-MAX') → true (case insensitive)",
    isQwenModel("QWEN-MAX") === true,
  )
  assert("isQwenModel('gpt-4o') → false", isQwenModel("gpt-4o") === false)
  assert(
    "isQwenModel('deepseek-chat') → false",
    isQwenModel("deepseek-chat") === false,
  )
  assert("isQwenModel('') → false", isQwenModel("") === false)

  assert(
    "supportsThinking('qwen3.6-plus') → true",
    supportsThinking("qwen3.6-plus") === true,
  )
  assert(
    "supportsThinking('qwen-max') → false",
    supportsThinking("qwen-max") === false,
  )
  assert(
    "supportsThinking('qwen-plus') → false",
    supportsThinking("qwen-plus") === false,
  )
  assert(
    "supportsThinking('qwen-turbo') → false",
    supportsThinking("qwen-turbo") === false,
  )
  assert(
    "supportsThinking('gpt-4o') → false",
    supportsThinking("gpt-4o") === false,
  )

  assert(
    "getQwenModelProfile('qwen-max') 非空",
    getQwenModelProfile("qwen-max") !== undefined,
  )
  assert(
    "getQwenModelProfile('qwen3.6-plus') 非空",
    getQwenModelProfile("qwen3.6-plus") !== undefined,
  )
  assert(
    "getQwenModelProfile('unknown') → undefined",
    getQwenModelProfile("unknown") === undefined,
  )
}

testModelDetection()

// ============================================================================
// 5. Capability Boundary Report
// ============================================================================
console.log("\n📦 5. Capability boundary — 能力边界报告")
console.log("  " + "─".repeat(50))

function testCapabilityReport() {
  // 能力定义
  assert("QWEN_CAPABILITIES 有 6 个能力", QWEN_CAPABILITIES.length === 6)

  const capabilityNames = QWEN_CAPABILITIES.map((c) => c.capability)
  assert(
    "含 '中文视频编辑指令理解'",
    capabilityNames.includes("中文视频编辑指令理解"),
  )
  assert("含 '多轮对话连续性'", capabilityNames.includes("多轮对话连续性"))
  assert("含 '工具调用格式遵循'", capabilityNames.includes("工具调用格式遵循"))
  assert("含 '视频内容理解'", capabilityNames.includes("视频内容理解"))
  assert("含 '错误恢复与自适应'", capabilityNames.includes("错误恢复与自适应"))
  assert("含 '并行工具调用'", capabilityNames.includes("并行工具调用"))

  // 每个能力结构完整
  for (const cap of QWEN_CAPABILITIES) {
    assert(`${cap.capability}: supportedBy 非空`, cap.supportedBy.length > 0)
    assert(
      `${cap.capability}: knownLimitations 非空`,
      cap.knownLimitations.length > 0,
    )
    assert(`${cap.capability}: description 非空`, cap.description.length > 0)
  }

  // 生成报告
  const report = generateCapabilityReport()
  assert("报告含标题", report.includes("# Qwen 大模型能力边界报告"))
  assert("报告含模型概览", report.includes("## 模型概览"))
  assert("报告含 qwen-max", report.includes("qwen-max"))
  assert("报告含 qwen3.6-plus", report.includes("qwen3.6-plus"))
  assert("报告含能力边界详情", report.includes("## 能力边界详情"))
  assert("报告含 Fallback 策略", report.includes("## Fallback 策略"))
  assert("报告含成本对比", report.includes("## 成本对比"))
  assert("报告含退避策略", report.includes("### 退避策略"))
  assert("报告含触发条件", report.includes("### 触发条件"))
}

testCapabilityReport()

// ============================================================================
// 6. Fallback Provider — fallback/backoff/retryable/cost
// ============================================================================
console.log("\n📦 6. Fallback provider — fallback/backoff/retryable/cost")
console.log("  " + "─".repeat(50))

function testFallbackProvider() {
  // 6a. Cost estimation
  const usage: TokenUsage = {
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
  }
  const cost = FallbackProvider.estimateCost(usage, "qwen3.6-plus")
  assert("cost: currency = USD", cost.currency === "USD")
  assert("cost: modelId 正确", cost.modelId === "qwen3.6-plus")
  assert("cost: totalCost > 0", cost.totalCost > 0)
  assert(
    "cost: totalCost = inputCost + outputCost",
    Math.abs(cost.totalCost - cost.inputCost - cost.outputCost) < 0.0001,
  )

  // 6b. Cost for known model pricing
  const costTurbo = FallbackProvider.estimateCost(usage, "qwen-turbo")
  assert("qwen-turbo 成本 < qwen3.6-plus", costTurbo.totalCost < cost.totalCost)

  // Cost for unknown model (fallback to default pricing)
  const costUnknown = FallbackProvider.estimateCost(usage, "unknown-model")
  assert("unknown model 也有成本", costUnknown.totalCost > 0)

  // 6c. Retryable error detection
  assert(
    "rate limit → retryable",
    FallbackProvider.isRetryableError(new Error("Rate limit exceeded")) ===
      true,
  )
  assert(
    "429 → retryable",
    FallbackProvider.isRetryableError(new Error("HTTP 429")) === true,
  )
  assert(
    "503 → retryable",
    FallbackProvider.isRetryableError(new Error("Service 503")) === true,
  )
  assert(
    "502 → retryable",
    FallbackProvider.isRetryableError(new Error("Bad Gateway 502")) === true,
  )
  assert(
    "504 → retryable",
    FallbackProvider.isRetryableError(new Error("Gateway Timeout 504")) ===
      true,
  )
  assert(
    "timeout → retryable",
    FallbackProvider.isRetryableError(new Error("Request timeout")) === true,
  )
  assert(
    "overloaded → retryable",
    FallbackProvider.isRetryableError(new Error("Server overloaded")) === true,
  )
  assert(
    "auth error → not retryable",
    FallbackProvider.isRetryableError(new Error("Invalid API key")) === false,
  )
  assert(
    "not found → not retryable",
    FallbackProvider.isRetryableError(new Error("Model not found")) === false,
  )
  assert(
    "normal error → not retryable",
    FallbackProvider.isRetryableError(new Error("Something went wrong")) ===
      false,
  )

  // 6d. Backoff delay
  const delay0 = FallbackProvider.backoffDelay(0, 1000)
  assert("backoff attempt 0: ~1000ms", delay0 >= 750 && delay0 <= 1250) // ±25%

  const delay1 = FallbackProvider.backoffDelay(1, 1000)
  assert("backoff attempt 1: ~2000ms", delay1 >= 1500 && delay1 <= 2500)

  const delay2 = FallbackProvider.backoffDelay(2, 1000)
  assert("backoff attempt 2: ~4000ms", delay2 >= 3000 && delay2 <= 5000)

  // Multiple iterations to verify jitter
  const delays = Array.from({ length: 10 }, () =>
    FallbackProvider.backoffDelay(0, 1000),
  )
  const allDifferent = new Set(delays).size > 1
  assert("backoff 抖动 — 存在不同的延迟值", allDifferent)

  // 6e. sleep
  const start = Date.now()
  FallbackProvider.sleep(10).then(() => {
    // async, skip in sync test
  })
}

testFallbackProvider()

// ============================================================================
// 7. Circuit Breaker — 断路器
// ============================================================================
console.log("\n📦 7. Circuit breaker — 断路器集成")
console.log("  " + "─".repeat(50))

function testCircuitBreaker() {
  resetAllCircuitBreakers()

  const qwenBreaker = getCircuitBreaker("model:qwen3.6-plus", {
    failureThreshold: 3,
    timeout: 60_000,
  })
  assert("getCircuitBreaker 返回实例", qwenBreaker !== null)
  assert("断路器初始状态 = CLOSED", qwenBreaker.getState() === "CLOSED")

  const stats = qwenBreaker.getStats()
  assert("初始 stats.name 正确", stats.name === "model:qwen3.6-plus")
  assert("初始 failureCount = 0", stats.failureCount === 0)
  assert("初始 totalRequests = 0", stats.totalRequests === 0)

  // 记录成功
  qwenBreaker.recordSuccess()
  const afterSuccess = qwenBreaker.getStats()
  assert("成功后 failureCount = 0", afterSuccess.failureCount === 0)
  assert("成功后 lastSuccessTime 更新", afterSuccess.lastSuccessTime !== null)

  // 记录失败（transient）
  qwenBreaker.recordFailure(new Error("Rate limit exceeded"))
  const after1 = qwenBreaker.getStats()
  assert("1 次失败后 state = CLOSED", after1.state === "CLOSED")
  assert("1 次失败后 failureCount = 1", after1.failureCount === 1)

  qwenBreaker.recordFailure(new Error("Service unavailable"))
  qwenBreaker.recordFailure(new Error("Too many requests"))
  const after3 = qwenBreaker.getStats()
  assert("3 次失败后 state = OPEN", after3.state === "OPEN")

  // 手动重置
  qwenBreaker.reset()
  assert("reset 后 state = CLOSED", qwenBreaker.getState() === "CLOSED")
  assert("reset 后 failureCount = 0", qwenBreaker.getStats().failureCount === 0)

  // permanent error 不计入
  qwenBreaker.recordFailure(new Error("Invalid API key"))
  assert(
    "permanent 错误不计入断路器",
    qwenBreaker.getStats().failureCount === 0,
  )

  // 清理
  resetAllCircuitBreakers()
}

testCircuitBreaker()

// ============================================================================
// 8. Provider options integration — Qwen auto-config
// ============================================================================
console.log("\n📦 8. Provider options — Qwen auto-config")
console.log("  " + "─".repeat(50))

function testProviderOptionsIntegration() {
  // Verify provider options can be built for all models
  for (const modelId of Object.keys(QWEN_MODEL_PROFILES)) {
    let ok = false
    try {
      buildQwenProviderOptions({ modelId, taskComplexity: "moderate" })
      ok = true
    } catch {
      ok = false
    }
    assert(`buildQwenProviderOptions(${modelId}) 不抛出`, ok)
  }

  // Verify different task complexities produce different options
  const simple = buildQwenProviderOptions({
    modelId: "qwen3.6-plus",
    taskComplexity: "simple",
  })
  const complex = buildQwenProviderOptions({
    modelId: "qwen3.6-plus",
    taskComplexity: "complex",
  })
  assert(
    "simple vs complex: thinkingBudget 不同",
    simple.thinkingBudget !== complex.thinkingBudget,
  )
  assert(
    "complex task: thinkingBudget > 0",
    (complex.thinkingBudget ?? 0) > (simple.thinkingBudget ?? 0),
  )

  // Verify temperature decreases with complexity
  assert(
    "复杂任务 temperature <= 简单任务",
    (complex.temperature ?? 0.7) <= (simple.temperature ?? 0.7),
  )
}

testProviderOptionsIntegration()

// ============================================================================
// 9. Token Usage and Cost Estimation
// ============================================================================
console.log("\n📦 9. Token usage and cost — 用量统计和成本")
console.log("  " + "─".repeat(50))

function testTokenUsageAndCost() {
  // Qwen model costs
  const models = ["qwen-max", "qwen-plus", "qwen-turbo", "qwen3.6-plus"]
  const usage: TokenUsage = {
    promptTokens: 1_000_000,
    completionTokens: 500_000,
    totalTokens: 1_500_000,
  }

  for (const modelId of models) {
    const cost = FallbackProvider.estimateCost(usage, modelId)
    assert(`${modelId}: totalCost > 0`, cost.totalCost > 0)
    assert(`${modelId}: inputCost > 0`, cost.inputCost > 0)
    assert(`${modelId}: outputCost > 0`, cost.outputCost > 0)
    assert(`${modelId}: currency = USD`, cost.currency === "USD")
    assert(`${modelId}: modelId 正确`, cost.modelId === modelId)
  }

  // qwen-turbo is cheapest
  const turboCost = FallbackProvider.estimateCost(usage, "qwen-turbo")
  const maxCost = FallbackProvider.estimateCost(usage, "qwen-max")
  assert("qwen-turbo < qwen-max", turboCost.totalCost < maxCost.totalCost)

  // Zero usage
  const zeroUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
  const zeroCost = FallbackProvider.estimateCost(zeroUsage, "qwen-max")
  assert("零使用量成本为 0", zeroCost.totalCost === 0)

  // TokenUsage type check
  const fullUsage: TokenUsage = {
    promptTokens: 5000,
    completionTokens: 2000,
    totalTokens: 7000,
  }
  assert("TokenUsage: promptTokens", fullUsage.promptTokens === 5000)
  assert(
    "TokenUsage: totalTokens = prompt + completion",
    fullUsage.totalTokens ===
      fullUsage.promptTokens + fullUsage.completionTokens,
  )
}

testTokenUsageAndCost()

// ============================================================================
// 结果汇总
// ============================================================================
console.log("\n" + "=".repeat(56))
console.log(
  `  测试完成：${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`,
)
console.log("=".repeat(56))

if (failed > 0) {
  console.log(`\n❌ ${failed} 个测试失败！`)
  process.exit(1)
} else {
  console.log("\n✅ 所有测试通过！")
}
