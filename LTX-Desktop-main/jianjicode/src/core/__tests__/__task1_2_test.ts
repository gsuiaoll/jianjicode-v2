/**
 * Task 1.2 测试 — 增强自然语言理解能力
 *
 * 测试内容：
 *   1. video-editing-prompt — 视频编辑领域专用 prompt 构建
 *   2. intent-mapper — 指令-意图映射表
 *   3. edit-context — 编辑上下文追踪
 *   4. clarification — 错误澄清和恢复机制
 *   5. ai-stream 集成 — buildDynamicSystemPrompt 集成新 prompt
 */

import {
  VIDEO_EDITING_SYSTEM_PROMPT,
  buildVideoEditingPrompt,
  buildToolListSummary,
} from "../prompts/video-editing-prompt.js"
import {
  detectIntent,
  detectConfusion,
  INTENT_MAPPINGS,
} from "../intent-mapper.js"
import type { IntentCategory } from "../intent-mapper.js"
import {
  createEditContext,
  updateEditContext,
  addAppliedEffect,
  addPendingOperation,
  clearPendingOperations,
  deserializeEditContext,
  serializeEditContext,
  summarizeEditContext,
} from "../edit-context.js"
import type { EditContext } from "../edit-context.js"
import {
  generateClarifications,
  generateRecoverySuggestions,
  generateIntentConfirmation,
} from "../clarification.js"

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
// 1. video-editing-prompt — 视频编辑领域专用 prompt
// ============================================================================
console.log("\n📦 1. video-editing-prompt — 视频编辑专用 prompt")
console.log("  " + "─".repeat(50))

function testVideoEditingPrompt() {
  // 1a. 基础 prompt 包含关键中文内容
  assert(
    "prompt 含角色定义",
    VIDEO_EDITING_SYSTEM_PROMPT.includes("jianjicode"),
  )
  assert(
    "prompt 含中文角色定义",
    VIDEO_EDITING_SYSTEM_PROMPT.includes("AI 视频编辑助手"),
  )
  assert("prompt 含核心原则", VIDEO_EDITING_SYSTEM_PROMPT.includes("准确理解"))
  assert("prompt 含主动澄清", VIDEO_EDITING_SYSTEM_PROMPT.includes("主动澄清"))
  assert(
    "prompt 含工具分类",
    VIDEO_EDITING_SYSTEM_PROMPT.includes("可用工具分类"),
  )
  assert(
    "prompt 含色彩与滤镜",
    VIDEO_EDITING_SYSTEM_PROMPT.includes("色彩与滤镜"),
  )
  assert(
    "prompt 含字幕与文字",
    VIDEO_EDITING_SYSTEM_PROMPT.includes("字幕与文字"),
  )
  assert(
    "prompt 含中文指令指南",
    VIDEO_EDITING_SYSTEM_PROMPT.includes("中文指令理解指南"),
  )
  assert("prompt 含澄清指南", VIDEO_EDITING_SYSTEM_PROMPT.includes("澄清指南"))
  assert(
    "prompt 含多轮对话规范",
    VIDEO_EDITING_SYSTEM_PROMPT.includes("多轮对话规范"),
  )

  // 1b. buildVideoEditingPrompt 基础构建
  const prompt1 = buildVideoEditingPrompt()
  assert(
    "buildVideoEditingPrompt 无参数返回基础 prompt",
    prompt1 === VIDEO_EDITING_SYSTEM_PROMPT,
  )

  // 1c. 注入编辑上下文
  const ctx = createEditContext()
  ctx.currentVideo = "/videos/test.mp4"
  ctx.videoInfo = { duration: 120, width: 1920, height: 1080, fps: 30 }
  ctx.lastOperation = "调色 - 暖色滤镜"
  const prompt2 = buildVideoEditingPrompt({ editContext: ctx })
  assert("prompt 含当前视频路径", prompt2.includes("/videos/test.mp4"))
  assert("prompt 含视频信息", prompt2.includes("1920x1080"))
  assert("prompt 含上次操作", prompt2.includes("调色"))

  // 1d. 注入工具列表
  const toolList = buildToolListSummary([
    { id: "ffmpeg", description: "FFmpeg 工具" },
    { id: "video_filter", description: "色彩校正" },
  ])
  const prompt3 = buildVideoEditingPrompt({ toolList })
  assert("prompt 含工具列表标题", prompt3.includes("当前可用工具"))
  assert("prompt 含 ffmpeg 描述", prompt3.includes("FFmpeg 工具"))

  // 1e. 注入自定义指令
  const prompt4 = buildVideoEditingPrompt({
    customInstructions: "使用中文回复，保持简洁。",
  })
  assert("prompt 含自定义指令", prompt4.includes("使用中文回复"))

  // 1f. buildToolListSummary
  assert("buildToolListSummary 返回数组", Array.isArray(toolList))
  assert(
    "buildToolListSummary 含 markdown 加粗",
    toolList[0].includes("**ffmpeg**"),
  )
}

testVideoEditingPrompt()

// ============================================================================
// 2. intent-mapper — 指令-意图映射
// ============================================================================
console.log("\n📦 2. intent-mapper — 指令-意图映射")
console.log("  " + "─".repeat(50))

function testIntentMapper() {
  // 2a. 裁剪意图
  const r1 = detectIntent("剪掉视频前10秒")
  assert(
    "'剪掉视频前10秒' → trim",
    r1.category === "trim",
    `got ${r1.category}`,
  )
  assert("trim 置信度 > 0", r1.confidence > 0)

  // 2b. 滤镜意图
  const r2 = detectIntent("给视频加个暖色滤镜")
  assert(
    "'加暖色滤镜' → filter",
    r2.category === "filter",
    `got ${r2.category}`,
  )
  assert(
    "filter 主工具是 video_filter",
    r2.primaryTool === "video_filter",
  )

  // 2c. 字幕意图
  const r3 = detectIntent("给这个视频添加中文字幕")
  assert(
    "'添加字幕' → subtitle",
    r3.category === "subtitle",
    `got ${r3.category}`,
  )

  // 2d. 变速意图
  const r4 = detectIntent("把这段视频加速2倍")
  assert("'加速2倍' → speed", r4.category === "speed", `got ${r4.category}`)

  // 2e. 稳定意图
  const r5 = detectIntent("画面太抖了帮我稳定一下")
  assert(
    "'画面太抖了' → stabilization",
    r5.category === "stabilization",
    `got ${r5.category}`,
  )

  // 2f. 画中画意图
  const r6 = detectIntent("右上角加一个小窗口显示另一个视频")
  assert("'右上角加小窗口' → pip", r6.category === "pip", `got ${r6.category}`)

  // 2g. 水印意图
  const r7 = detectIntent("在视频右下角加个logo水印")
  assert(
    "'加水印' → watermark",
    r7.category === "watermark",
    `got ${r7.category}`,
  )

  // 2h. 风格迁移意图
  const r8 = detectIntent("把这个视频变成梵高风格")
  assert("'梵高风格' → style", r8.category === "style", `got ${r8.category}`)

  // 2i. 格式转换意图
  const r9 = detectIntent("把视频转成mp4格式")
  assert("'转成mp4' → format", r9.category === "format", `got ${r9.category}`)

  // 2j. 批量处理意图
  const r10 = detectIntent("批量处理这个文件夹里的所有视频")
  assert("'批量处理' → batch", r10.category === "batch", `got ${r10.category}`)

  // 2k. 场景检测意图
  const r11 = detectIntent("自动检测场景切换然后分段")
  assert("'场景检测' → scene", r11.category === "scene", `got ${r11.category}`)

  // 2l. 未知意图
  const r12 = detectIntent("你好")
  assert("'你好' → unknown", r12.category === "unknown", `got ${r12.category}`)
  assert("unknown 置信度为 0", r12.confidence === 0)

  // 2m. 匹配到的关键词
  const r13 = detectIntent("给视频加滤镜调色")
  assert(
    "匹配到滤镜关键词",
    r13.matchedKeywords.some((k) => k.includes("滤镜") || k.includes("调色")),
  )

  // 2n. 参数提取 — 时间
  const r14 = detectIntent("从第10秒开始剪掉30秒的内容")
  assert("提取时间参数", r14.extractedParams.times !== undefined)

  // 2o. 参数提取 — 速度
  const r15 = detectIntent("加速2.5倍")
  assert("提取速度参数", r15.extractedParams.speed === "2.5")

  // 2p. 参数提取 — 文件
  const r16 = detectIntent("处理 /path/to/video.mp4")
  assert("提取文件路径", r16.extractedParams.files?.includes("video.mp4"))

  // 2q. 混淆检测
  const conf1 = detectConfusion("帮我剪一下这个视频")
  assert("'剪一下' 触发混淆检测", conf1.length >= 1)

  const conf2 = detectConfusion("加个滤镜效果")
  assert("'滤镜效果' 触发混淆检测", conf2.length >= 1)

  // 2r. 映射表完整性
  assert("INTENT_MAPPINGS 非空", INTENT_MAPPINGS.length > 0)
  assert(
    "每个 mapping 有 patterns",
    INTENT_MAPPINGS.every((m) => m.patterns.length > 0),
  )
  assert(
    "每个 mapping 有 primaryTool",
    INTENT_MAPPINGS.every((m) => m.primaryTool.length > 0),
  )
  assert(
    "每个 mapping 有 category",
    INTENT_MAPPINGS.every((m) => m.category.length > 0),
  )
}

testIntentMapper()

// ============================================================================
// 3. edit-context — 编辑上下文追踪
// ============================================================================
console.log("\n📦 3. edit-context — 编辑上下文追踪")
console.log("  " + "─".repeat(50))

function testEditContext() {
  // 3a. 创建上下文
  const ctx = createEditContext()
  assert("createEditContext 创建非空对象", ctx !== undefined)
  assert("初始 appliedEffects 为空", ctx.appliedEffects.length === 0)
  assert("初始 pendingOperations 为空", ctx.pendingOperations.length === 0)
  assert("初始 preferences 为空对象", Object.keys(ctx.preferences).length === 0)

  // 3b. 更新上下文
  const ctx2 = updateEditContext(ctx, { currentVideo: "/videos/test.mp4" })
  assert("updateEditContext 不修改原对象", ctx.currentVideo === undefined)
  assert(
    "updateEditContext 返回新对象含 currentVideo",
    ctx2.currentVideo === "/videos/test.mp4",
  )

  // 3c. 添加已应用效果
  const ctx3 = addAppliedEffect(ctx2, "video_filter", "应用暖色滤镜", {
    brightness: 1.1,
  })
  assert("addAppliedEffect 追加到列表", ctx3.appliedEffects.length === 1)
  assert(
    "addAppliedEffect 更新 lastOperation",
    ctx3.lastOperation === "应用暖色滤镜",
  )
  assert(
    "addAppliedEffect 记录 toolId",
    ctx3.appliedEffects[0].toolId === "video_filter",
  )

  // 3d. 添加多个效果
  const ctx4 = addAppliedEffect(ctx3, "video_speed", "加速 2x")
  assert("第二个效果追加", ctx4.appliedEffects.length === 2)
  assert("lastOperation 更新为最新", ctx4.lastOperation === "加速 2x")

  // 3e. 待处理操作
  const ctx5 = addPendingOperation(ctx4, "添加字幕")
  assert("addPendingOperation 追加待处理", ctx5.pendingOperations.length === 1)
  assert("待处理操作内容正确", ctx5.pendingOperations[0] === "添加字幕")

  // 3f. 去重
  const ctx6 = addPendingOperation(ctx5, "添加字幕")
  assert("重复操作不重复添加", ctx6.pendingOperations.length === 1)

  // 3g. 清空待处理
  const ctx7 = clearPendingOperations(ctx6)
  assert("clearPendingOperations 清空列表", ctx7.pendingOperations.length === 0)

  // 3h. 摘要生成
  const summary = summarizeEditContext(ctx4)
  assert("摘要含视频路径", summary.includes("/videos/test.mp4"))
  assert("摘要含已应用效果", summary.includes("应用暖色滤镜"))

  // 3i. 空上下文摘要
  const emptySummary = summarizeEditContext(createEditContext())
  assert("空上下文摘要为空字符串", emptySummary === "")

  // 3j. 序列化/反序列化
  const json = serializeEditContext(ctx4)
  const restored = deserializeEditContext(json)
  assert("反序列化非空", restored !== null)
  if (restored) {
    assert(
      "反序列化保留 currentVideo",
      restored.currentVideo === "/videos/test.mp4",
    )
    assert(
      "反序列化保留 appliedEffects 长度",
      restored.appliedEffects.length === 2,
    )
  }

  // 3k. 无效 JSON 反序列化
  const bad = deserializeEditContext("not valid json")
  assert("无效 JSON 返回 null", bad === null)

  // 3l. 缺失字段的 JSON
  const minimal = deserializeEditContext(
    '{"appliedEffects":[],"pendingOperations":[]}',
  )
  assert("最小有效 JSON 可反序列化", minimal !== null)
}

testEditContext()

// ============================================================================
// 4. clarification — 错误澄清和恢复
// ============================================================================
console.log("\n📦 4. clarification — 错误澄清和恢复")
console.log("  " + "─".repeat(50))

function testClarification() {
  // 4a. 未知意图澄清
  const unknownIntent = {
    category: "unknown" as IntentCategory,
    confidence: 0,
    matchedKeywords: [],
    primaryTool: "ffmpeg",
    fallbackTools: [],
    extractedParams: {},
  }
  const q1 = generateClarifications(unknownIntent)
  assert("未知意图生成澄清问题", q1.length > 0)
  assert("澄清问题含'理解'", q1[0].question.includes("理解"))

  // 4b. 低置信度确认
  const lowConfIntent = {
    category: "trim" as IntentCategory,
    confidence: 0.2,
    matchedKeywords: ["剪"],
    primaryTool: "ffmpeg",
    fallbackTools: [],
    extractedParams: {},
  }
  const q2 = generateClarifications(lowConfIntent)
  assert(
    "低置信度生成确认问题",
    q2.some((q) => q.id === "low_confidence"),
  )

  // 4c. 缺失参数澄清
  const noFileIntent = {
    category: "trim" as IntentCategory,
    confidence: 0.8,
    matchedKeywords: ["剪掉", "删除"],
    primaryTool: "ffmpeg",
    fallbackTools: [],
    extractedParams: { times: "10秒" },
  }
  const q3 = generateClarifications(noFileIntent)
  assert(
    "缺文件参数生成澄清",
    q3.some((q) => q.id === "missing_params"),
  )

  // 4d. 完整参数不生成缺失澄清
  const fullIntent = {
    category: "trim" as IntentCategory,
    confidence: 0.9,
    matchedKeywords: ["剪掉"],
    primaryTool: "ffmpeg",
    fallbackTools: [],
    extractedParams: { files: "video.mp4", times: "10秒, 30秒" },
  }
  const q4 = generateClarifications(fullIntent)
  assert(
    "参数完整时无 missing_params",
    !q4.some((q) => q.id === "missing_params"),
  )

  // 4e. 恢复建议 — 文件未找到
  const s1 = generateRecoverySuggestions(
    "video_filter",
    "ENOENT: file not found",
  )
  assert(
    "文件未找到建议",
    s1.some((s) => s.message.includes("文件未找到")),
  )

  // 4f. 恢复建议 — 权限拒绝
  const s2 = generateRecoverySuggestions("ffmpeg", "permission denied")
  assert(
    "权限拒绝建议",
    s2.some((s) => s.message.includes("权限不足")),
  )

  // 4g. 恢复建议 — 超时
  const s3 = generateRecoverySuggestions("video_speed", "ETIMEDOUT")
  assert(
    "超时建议",
    s3.some((s) => s.message.includes("超时")),
  )

  // 4h. 恢复建议 — 含替代工具
  const trimIntent = {
    category: "trim" as IntentCategory,
    confidence: 0.9,
    matchedKeywords: ["剪"],
    primaryTool: "ffmpeg",
    fallbackTools: ["ltx_video_processor"],
    extractedParams: {},
  }
  const s4 = generateRecoverySuggestions("ffmpeg", "unknown error", trimIntent)
  assert(
    "含替代工具建议",
    s4.some((s) => s.alternativeTool === "ltx_video_processor"),
  )

  // 4i. 恢复建议 — 参数无效
  const s5 = generateRecoverySuggestions(
    "video_filter",
    "invalid parameter: brightness",
  )
  assert(
    "参数无效建议",
    s5.some((s) => s.message.includes("参数格式不正确")),
  )

  // 4j. 多意图确认
  const candidates = [
    {
      category: "filter" as IntentCategory,
      confidence: 0.8,
      matchedKeywords: ["滤镜"],
      primaryTool: "video_filter",
      fallbackTools: [],
      extractedParams: {},
    },
    {
      category: "subtitle" as IntentCategory,
      confidence: 0.7,
      matchedKeywords: ["字幕"],
      primaryTool: "video_subtitle",
      fallbackTools: [],
      extractedParams: {},
    },
  ]
  const confirmation = generateIntentConfirmation(candidates)
  assert("多意图生成确认", confirmation !== null)
  if (confirmation) {
    assert("确认含多操作提示", confirmation.question.includes("多个操作"))
  }

  // 4k. 单意图不生成确认
  const singleCandidate = [candidates[0]]
  const noConfirm = generateIntentConfirmation(singleCandidate)
  assert("单意图不生成确认", noConfirm === null)
}

testClarification()

// ============================================================================
// 5. ai-stream 集成 — buildDynamicSystemPrompt
// ============================================================================
console.log("\n📦 5. ai-stream 集成 — buildDynamicSystemPrompt")
console.log("  " + "─".repeat(50))

async function testAiStreamIntegration() {
  // 动态导入避免循环依赖（ai-stream 在模块顶层导入 toolRegistry）
  const { buildDynamicSystemPrompt: bdsp, setActiveEditContext, getActiveEditContext } =
    await import("../ai-stream.js")

  // 5a. buildDynamicSystemPrompt 返回中文 prompt
  const prompt = await bdsp()
  assert("buildDynamicSystemPrompt 返回非空", prompt.length > 0)
  assert("返回中文 prompt", prompt.includes("视频编辑助手"))
  // 工具注册表在导入时可能尚未初始化，因此不检查工具列表

  // 5b. 含编辑上下文
  const ctx = createEditContext()
  ctx.currentVideo = "/test/video.mp4"
  const prompt2 = await bdsp({ editContext: ctx })
  assert(
    "含编辑上下文的 prompt 有视频路径",
    prompt2.includes("/test/video.mp4"),
  )

  // 5c. setActiveEditContext / getActiveEditContext
  setActiveEditContext(ctx)
  const retrieved = getActiveEditContext()
  assert(
    "getActiveEditContext 返回设置的上下文",
    retrieved?.currentVideo === "/test/video.mp4",
  )

  // 5d. 清除上下文
  setActiveEditContext(undefined)
  assert(
    "清除后 getActiveEditContext 返回 undefined",
    getActiveEditContext() === undefined,
  )
}

await testAiStreamIntegration()

// ============================================================================
// 总结
// ============================================================================
console.log("\n" + "=".repeat(50))
console.log("📊 Task 1.2 测试总览")
console.log("  " + "=".repeat(46))
console.log(`  通过: ${passed}`)
console.log(`  失败: ${failed}`)
console.log(`  总计: ${passed + failed}`)
console.log("=".repeat(50))

if (failed > 0) {
  console.log("\n❌ 存在失败测试！")
  process.exit(1)
} else {
  console.log("\n✅ Task 1.2 全部测试通过！")
}
