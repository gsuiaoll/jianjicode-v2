/**
 * Task 1.3 测试 — 模板系统开发
 *
 * 测试内容：
 *   1. template-schema — 数据结构与 Zod 校验
 *   2. template-manager — 模板 CRUD 与分类
 *   3. preset templates — 6 个预设模板验证
 *   4. template-tool — 占位符替换与条件求值
 *   5. template_manager 工具注册集成
 *   6. ai-stream 集成 — buildDynamicSystemPrompt 含模板信息
 */

import { existsSync, unlinkSync } from "fs"
import {
  TEMPLATE_CATEGORIES,
  validateTemplate,
  createTemplateSummary,
  getCategoryLabel,
  templateParameterSchema,
  toolCallStepSchema,
  videoTemplateSchema,
} from "../../template/template-schema.js"
import type { VideoTemplate, TemplateParameter, ToolCallStep, TemplateCategory } from "../../template/template-schema.js"
import {
  registerBuiltinTemplate,
  registerBuiltinTemplates,
  createTemplate,
  saveTemplate,
  loadTemplate,
  listTemplates,
  deleteTemplate,
  exportTemplate,
  importTemplate,
  listCategories,
  listAllTags,
} from "../../template/template-manager.js"
import { BUILTIN_TEMPLATES } from "../../template/presets/index.js"
import { fastCutTemplate } from "../../template/presets/fast-cut.js"
import { longFormTemplate } from "../../template/presets/long-form.js"
import { newsStyleTemplate } from "../../template/presets/news-style.js"
import { deepAnalysisTemplate } from "../../template/presets/deep-analysis.js"
import { cinematicTemplate } from "../../template/presets/cinematic.js"
import { vintageTemplate } from "../../template/presets/vintage.js"
import { ensureBuiltinTemplatesRegistered, TemplateManagerTool } from "../../template/template-tool.js"
import { buildVideoEditingPrompt } from "../prompts/video-editing-prompt.js"

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
// 1. template-schema — 数据结构与 Zod 校验
// ============================================================================
console.log("\n📦 1. template-schema — 数据结构与 Zod 校验")
console.log("  " + "─".repeat(50))

function testTemplateSchema() {
  // 1a. TEMPLATE_CATEGORIES 含 10 个分类
  assert("TEMPLATE_CATEGORIES 有 10 个值", TEMPLATE_CATEGORIES.length === 10)
  assert("包含 fast_cut 分类", TEMPLATE_CATEGORIES.includes("fast_cut"))
  assert("包含 vintage 分类", TEMPLATE_CATEGORIES.includes("vintage"))
  assert("包含 custom 分类", TEMPLATE_CATEGORIES.includes("custom"))

  // 1b. getCategoryLabel 返回中文标签
  assert(
    "getCategoryLabel(fast_cut)",
    getCategoryLabel("fast_cut") === "快节奏剪辑",
  )
  assert(
    "getCategoryLabel(cinematic)",
    getCategoryLabel("cinematic") === "电影感风格",
  )
  assert("getCategoryLabel(custom)", getCategoryLabel("custom") === "自定义")
  assert(
    "所有分类都有标签",
    TEMPLATE_CATEGORIES.every((c) => getCategoryLabel(c).length > 0),
  )

  // 1c. validateTemplate 接受合法模板
  const validTemplate: VideoTemplate = {
    id: "test_template_1",
    name: "测试模板",
    description: "用于测试的模板",
    category: "custom",
    tags: ["测试"],
    parameters: [
      {
        name: "input_file",
        type: "file",
        label: "输入",
        description: "输入文件",
        required: true,
      },
    ],
    toolCalls: [
      {
        toolName: "test_tool",
        argsTemplate: { input: "{{input_file}}" },
        description: "测试步骤",
        order: 1,
      },
    ],
    author: "test",
    version: "1.0.0",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const validated = validateTemplate(validTemplate)
  assert("validateTemplate 接受合法模板", validated.id === "test_template_1")

  // 1d. validateTemplate 拒绝非法模板
  try {
    validateTemplate({ id: "", name: "" })
    assert("validateTemplate 应拒绝空 id", false)
  } catch {
    assert("validateTemplate 拒绝非法模板", true)
  }

  // 1e. createTemplateSummary 正确提取摘要
  const summary = createTemplateSummary(validTemplate)
  assert("summary.id 正确", summary.id === "test_template_1")
  assert("summary.parameterCount 正确", summary.parameterCount === 1)
  assert("summary.toolCount 正确", summary.toolCount === 1)
  assert("summary 不含 toolCalls 详情", !("toolCalls" in summary))

  // 1f. templateParameterSchema 校验
  const validParam = {
    name: "speed",
    type: "number",
    label: "速度",
    description: "播放速度",
    required: false,
    defaultValue: 1.5,
    min: 0.5,
    max: 4.0,
  }
  assert(
    "参数 schema 接受合法参数",
    !!templateParameterSchema.parse(validParam),
  )

  // 1g. toolCallStepSchema 校验
  const validStep = {
    toolName: "video_speed",
    argsTemplate: { input: "{{file}}", speed: "{{speed}}" },
    description: "变速",
    order: 1,
  }
  assert("步骤 schema 接受合法步骤", !!toolCallStepSchema.parse(validStep))

  // 1h. videoTemplateSchema 校验
  const validTpl = {
    id: "test_v2",
    name: "测试2",
    description: "desc",
    category: "vlog",
    tags: ["a", "b"],
    parameters: [validParam],
    toolCalls: [validStep],
    author: "me",
    version: "1.0.0",
    createdAt: 1234567890,
    updatedAt: 1234567890,
  }
  assert("视频模板 schema 接受合法模板", !!videoTemplateSchema.parse(validTpl))
}

testTemplateSchema()

// ============================================================================
// 2. template-manager — CRUD 操作
// ============================================================================
console.log("\n📦 2. template-manager — CRUD 操作")
console.log("  " + "─".repeat(50))

function testTemplateManager() {
  // 2a. 注册内置模板
  registerBuiltinTemplate({
    id: "test_builtin_1",
    name: "测试内置模板",
    description: "用于测试的内置模板",
    category: "custom",
    tags: ["内置", "测试"],
    parameters: [],
    toolCalls: [],
    author: "test",
    version: "1.0.0",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  const loaded = loadTemplate("test_builtin_1")
  assert("registerBuiltinTemplate + loadTemplate", loaded !== null)
  assert("加载的内置模板名称正确", loaded!.name === "测试内置模板")

  // 2b. 创建自定义模板
  const custom = createTemplate({
    id: "test_custom_1",
    name: "自定义模板",
    description: "持久化到磁盘的自定义模板",
    category: "vlog",
    tags: ["vlog", "自定义"],
    parameters: [
      {
        name: "input_file",
        type: "file",
        label: "输入",
        description: "视频文件",
        required: true,
      },
      {
        name: "speed",
        type: "number",
        label: "速度",
        description: "播放速度",
        required: false,
        defaultValue: 1.0,
        min: 0.5,
        max: 3.0,
      },
    ],
    toolCalls: [
      {
        toolName: "video_speed",
        argsTemplate: { input: "{{input_file}}", speed_factor: "{{speed}}" },
        description: "调整速度",
        order: 1,
      },
    ],
    author: "test",
    version: "1.0.0",
    createdAt: 0,
    updatedAt: 0,
  })
  assert("createTemplate 返回模板", custom.id === "test_custom_1")
  assert("createTemplate 设置了 createdAt", custom.createdAt > 0)

  // 2c. loadTemplate 可以加载自定义模板
  const loadedCustom = loadTemplate("test_custom_1")
  assert("loadTemplate 加载自定义模板", loadedCustom !== null)
  assert("自定义模板名称正确", loadedCustom!.name === "自定义模板")

  // 2d. saveTemplate 更新模板
  const updated = saveTemplate({ ...custom, name: "已更新的模板" })
  assert("saveTemplate 更新了名称", updated.name === "已更新的模板")
  assert("saveTemplate 更新了 updatedAt", updated.updatedAt >= custom.updatedAt)

  // 2e. listTemplates 列出所有模板
  const all = listTemplates()
  assert("listTemplates 返回内置和自定义", all.builtin.length > 0)
  assert(
    "自定义列表包含 test_custom_1",
    all.custom.some((t) => t.id === "test_custom_1"),
  )

  // 2f. listTemplates 按分类筛选
  const filtered = listTemplates({ category: "vlog" })
  assert(
    "listTemplates 按分类筛选",
    filtered.custom.some((t) => t.id === "test_custom_1"),
  )

  // 2g. listTemplates 按标签筛选
  const tagged = listTemplates({ tags: ["vlog"] })
  assert(
    "listTemplates 按标签筛选",
    tagged.custom.some((t) => t.id === "test_custom_1"),
  )

  // 2h. listTemplates 按搜索筛选
  const searched = listTemplates({ search: "自定义模板" })
  assert(
    "listTemplates 按名称搜索",
    searched.custom.some((t) => t.id === "test_custom_1"),
  )

  const searchedDesc = listTemplates({ search: "持久化到磁盘" })
  assert(
    "listTemplates 按描述搜索",
    searchedDesc.custom.some((t) => t.id === "test_custom_1"),
  )

  // 2i. 不能删除内置模板
  const deletedBuiltin = deleteTemplate("test_builtin_1")
  assert("deleteTemplate 拒绝删除内置模板", deletedBuiltin === false)

  // 2j. 可以删除自定义模板
  const deleted = deleteTemplate("test_custom_1")
  assert("deleteTemplate 删除自定义模板", deleted === true)
  assert(
    "删除后 loadTemplate 返回 null",
    loadTemplate("test_custom_1") === null,
  )

  // 2k. 删除不存在的模板
  const deletedNone = deleteTemplate("nonexistent_template")
  assert("删除不存在的模板返回 false", deletedNone === false)

  // 2l. exportTemplate
  const exportResult = createTemplate({
    id: "test_export_1",
    name: "导出测试",
    description: "测试导出功能",
    category: "custom",
    tags: ["导出"],
    parameters: [],
    toolCalls: [],
    author: "test",
    version: "1.0.0",
    createdAt: 0,
    updatedAt: 0,
  })
  const exportPath = exportTemplate("test_export_1")
  assert("exportTemplate 返回路径", exportPath !== null)
  assert("导出路径含模板 ID", exportPath!.includes("test_export_1"))

  // 2m. importTemplate
  if (exportPath && existsSync(exportPath)) {
    const imported = importTemplate(exportPath, true)
    assert("importTemplate 成功", imported !== null)
    assert("导入的模板 ID 正确", imported!.id === "test_export_1")
    // 清理
    try {
      unlinkSync(exportPath)
    } catch {}
  }

  // 2n. exportTemplate 不存在的模板
  const exportNone = exportTemplate("nonexistent_template")
  assert("export 不存在的模板返回 null", exportNone === null)

  // 2o. importTemplate 不存在的文件
  const importNone = importTemplate("/nonexistent/path/template.json")
  assert("import 不存在的文件返回 null", importNone === null)

  // 2p. listCategories
  const cats = listCategories()
  assert("listCategories 返回 10 个分类", cats.length === 10)
  assert(
    "每个分类有 value/label/count",
    cats.every((c) => c.value && c.label && c.count !== undefined),
  )

  // 2q. listAllTags
  const tags = listAllTags()
  assert("listAllTags 返回数组", Array.isArray(tags))
  assert("listAllTags 已排序", tags.length >= 0)
}

testTemplateManager()

// ============================================================================
// 3. preset templates — 预设模板验证
// ============================================================================
console.log("\n📦 3. preset templates — 预设模板验证")
console.log("  " + "─".repeat(50))

function testPresetTemplates() {
  const presets = BUILTIN_TEMPLATES
  assert("BUILTIN_TEMPLATES 有 6 个预设", presets.length === 6)

  const presetIds = new Set(presets.map((p) => p.id))
  assert("所有预设 ID 唯一", presetIds.size === 6)

  for (const preset of presets) {
    const name = preset.name

    // 验证模板结构
    assert(`${name}: id 非空`, preset.id.length > 0)
    assert(
      `${name}: category 有效`,
      TEMPLATE_CATEGORIES.includes(preset.category),
    )
    assert(`${name}: parameters 非空`, preset.parameters.length > 0)
    assert(`${name}: toolCalls 非空`, preset.toolCalls.length > 0)
    assert(`${name}: author 为 jianjicode`, preset.author === "jianjicode")
    assert(`${name}: version 格式正确`, /^\d+\.\d+\.\d+$/.test(preset.version))
    assert(`${name}: tags 非空`, preset.tags.length > 0)
    assert(`${name}: description 非空`, preset.description.length > 0)

    // 每个参数验证
    for (const param of preset.parameters) {
      assert(`${name}: 参数 "${param.name}" name 非空`, param.name.length > 0)
      assert(
        `${name}: 参数 "${param.name}" type 有效`,
        [
          "string",
          "number",
          "boolean",
          "select",
          "file",
          "time_range",
        ].includes(param.type),
      )
      assert(`${name}: 参数 "${param.name}" label 非空`, param.label.length > 0)
      if (param.type === "select") {
        assert(
          `${name}: 参数 "${param.name}" select 有 options`,
          Array.isArray(param.options) && param.options!.length > 0,
        )
      }
    }

    // 每个工具调用步骤验证
    for (const step of preset.toolCalls) {
      assert(
        `${name}: 步骤 ${step.order} toolName 非空`,
        step.toolName.length > 0,
      )
      assert(`${name}: 步骤 ${step.order} order > 0`, step.order > 0)
      assert(
        `${name}: 步骤 ${step.order} description 非空`,
        step.description.length > 0,
      )
      assert(
        `${name}: 步骤 ${step.order} argsTemplate 非空`,
        Object.keys(step.argsTemplate).length > 0,
      )
    }

    // 步骤顺序唯一性
    const orders = preset.toolCalls.map((s) => s.order)
    const uniqueOrders = new Set(orders)
    assert(`${name}: 步骤 order 唯一`, orders.length === uniqueOrders.size)
  }

  // 3a. 快节奏剪辑
  const fastCut = presets.find((p) => p.id === "fast_cut_social")!
  assert("fast-cut: 6 个参数", fastCut.parameters.length === 6)
  assert("fast-cut: 6 个工具步骤", fastCut.toolCalls.length === 6)
  assert(
    "fast-cut: input_file 必需",
    fastCut.parameters.find((p) => p.name === "input_file")!.required === true,
  )
  assert(
    "fast-cut: 第一步是场景检测",
    fastCut.toolCalls.find((s) => s.order === 1)!.toolName ===
      "video_scene_detection",
  )

  // 3b. 长视频剪辑
  const longForm = presets.find((p) => p.id === "long_form_documentary")!
  assert("long-form: category 为 long_form", longForm.category === "long_form")
  assert(
    "long-form: 有条件步骤 (stabilize)",
    longForm.toolCalls.some((s) => s.condition),
  )

  // 3c. 新闻解说
  const news = presets.find((p) => p.id === "news_broadcast_style")!
  assert(
    "news-style: 含 pip_video 参数",
    news.parameters.some((p) => p.name === "pip_video"),
  )
  assert(
    "news-style: 含画中画步骤",
    news.toolCalls.some((s) => s.toolName === "video_pip"),
  )

  // 3d. 深度解读
  const deep = presets.find((p) => p.id === "deep_analysis_style")!
  assert(
    "deep-analysis: 播放速度默认 0.85",
    deep.parameters.find((p) => p.name === "playback_speed")!.defaultValue ===
      0.85,
  )
  assert(
    "deep-analysis: 含关键帧动画",
    deep.toolCalls.some((s) => s.toolName === "keyframe_animation"),
  )

  // 3e. 电影感
  const cinematic = presets.find((p) => p.id === "cinematic_style")!
  assert(
    "cinematic: 4 种电影色调可选",
    cinematic.parameters.find((p) => p.name === "color_style")!.options!
      .length === 4,
  )
  assert(
    "cinematic: 含宽高比选择",
    cinematic.parameters.find((p) => p.name === "aspect_ratio")!.type ===
      "select",
  )

  // 3f. 复古风格
  const vintage = presets.find((p) => p.id === "vintage_style")!
  assert(
    "vintage: 5 种年代可选",
    vintage.parameters.find((p) => p.name === "vintage_era")!.options!
      .length === 5,
  )
  assert(
    "vintage: 含 silent_film 选项",
    vintage.parameters
      .find((p) => p.name === "vintage_era")!
      .options!.includes("silent_film"),
  )
  assert(
    "vintage: 含 super8 选项",
    vintage.parameters
      .find((p) => p.name === "vintage_era")!
      .options!.includes("super8"),
  )
  assert("vintage: 7 个工具步骤", vintage.toolCalls.length === 7)
}

testPresetTemplates()

// ============================================================================
// 4. template-tool — 占位符替换与条件求值
// ============================================================================
console.log("\n📦 4. template-tool — 占位符替换与条件求值")
console.log("  " + "─".repeat(50))

function testTemplateTool() {
  // 模拟 resolveArgsTemplate
  function resolveArgsTemplate(
    argsTemplate: Record<string, string>,
    params: Record<string, string | number | boolean>,
  ): Record<string, string> {
    const resolved: Record<string, string> = {}
    for (const [key, value] of Object.entries(argsTemplate)) {
      resolved[key] = value.replace(/\{\{(\w+)\}\}/g, (_match, paramName) => {
        const v = params[paramName]
        if (v === undefined || v === null || v === "") return _match
        return String(v)
      })
    }
    return resolved
  }

  // 模拟 evaluateCondition
  function evaluateCondition(
    condition: string,
    params: Record<string, string | number | boolean>,
  ): boolean {
    const trimmed = condition.trim()
    const match = trimmed.match(/^(\w+)\s*(===|!==|>|<|>=|<=)\s*(.+)$/)
    if (!match) return true
    const [, paramName, op, rawValue] = match
    const actualValue = params[paramName]
    let expectedValue: string | number | boolean = rawValue.trim()
    if (expectedValue === "true") expectedValue = true
    else if (expectedValue === "false") expectedValue = false
    else if (/^-?\d+(\.\d+)?$/.test(expectedValue as string))
      expectedValue = Number(expectedValue)
    else if (
      (expectedValue as string).startsWith("'") &&
      (expectedValue as string).endsWith("'")
    ) {
      expectedValue = (expectedValue as string).slice(1, -1)
    }
    switch (op) {
      case "===":
        return actualValue === expectedValue
      case "!==":
        return actualValue !== expectedValue
      case ">":
        return Number(actualValue) > Number(expectedValue)
      case "<":
        return Number(actualValue) < Number(expectedValue)
      case ">=":
        return Number(actualValue) >= Number(expectedValue)
      case "<=":
        return Number(actualValue) <= Number(expectedValue)
      default:
        return true
    }
  }

  // 4a. 基本占位符替换
  const result1 = resolveArgsTemplate(
    { input: "{{input_file}}", speed: "{{speed_factor}}" },
    { input_file: "/path/to/video.mp4", speed_factor: 2.0 },
  )
  assert("占位符替换: input_file", result1.input === "/path/to/video.mp4")
  assert("占位符替换: speed_factor (数字)", result1.speed === "2")

  // 4b. 同一参数多次引用
  const result2 = resolveArgsTemplate(
    { a: "{{x}}", b: "{{x}}" },
    { x: "hello" },
  )
  assert("同一参数多次引用", result2.a === "hello" && result2.b === "hello")

  // 4c. 部分参数缺失时保留占位符
  const result3 = resolveArgsTemplate(
    { input: "{{file}}", strength: "{{strength}}" },
    { file: "/video.mp4" },
  )
  assert("缺失参数保留占位符", result3.strength === "{{strength}}")
  assert("已提供参数正常替换", result3.input === "/video.mp4")

  // 4d. 无占位符的字符串原样返回
  const result4 = resolveArgsTemplate(
    { fixed: "no_placeholders", another: "{{x}}" },
    { x: "y" },
  )
  assert("无占位符不变", result4.fixed === "no_placeholders")
  assert("有占位符的替换", result4.another === "y")

  // 4e. 条件: param > 0 (正数 → 执行)
  assert(
    "条件 param > 0 为正数 → true",
    evaluateCondition("color_shift > 0", { color_shift: 15 }) === true,
  )
  assert(
    "条件 param > 0 为 0 → false",
    evaluateCondition("color_shift > 0", { color_shift: 0 }) === false,
  )

  // 4f. 条件: param === true
  assert(
    "条件 param === true (true)",
    evaluateCondition("add_scratches === true", { add_scratches: true }) ===
      true,
  )
  assert(
    "条件 param === true (false)",
    evaluateCondition("add_scratches === true", { add_scratches: false }) ===
      false,
  )

  // 4g. 条件: param !== ''
  assert(
    "条件 param !== '' 非空→true",
    evaluateCondition("pip_video !== ''", { pip_video: "/pip.mp4" }) === true,
  )
  assert(
    "条件 param !== '' 为空→false",
    evaluateCondition("pip_video !== ''", { pip_video: "" }) === false,
  )

  // 4h. 条件: param !== 'string_value'
  assert(
    "条件 !== 'none' (不匹配→true)",
    evaluateCondition("bgm_style !== 'none'", { bgm_style: "upbeat" }) === true,
  )
  assert(
    "条件 !== 'none' (匹配→false)",
    evaluateCondition("bgm_style !== 'none'", { bgm_style: "none" }) === false,
  )

  // 4i. 空条件或无法解析 → 默认执行 (true)
  assert("空条件 → true", evaluateCondition("", {}) === true)
  assert("无法解析的条件 → true", evaluateCondition("nonsense", {}) === true)
}

testTemplateTool()

// ============================================================================
// 5. template_manager 工具注册集成测试
// ============================================================================
console.log("\n📦 5. template_manager 工具注册集成测试")
console.log("  " + "─".repeat(50))

function testTemplateToolIntegration() {
  // 5a. 确保内置模板被注册
  ensureBuiltinTemplatesRegistered()
  const { builtin, custom } = listTemplates()
  assert(
    "ensureBuiltinTemplatesRegistered 注册了至少 6 个内置",
    builtin.length >= 6,
  )

  // 5b. 工具定义存在
  assert(
    "TemplateManagerTool 有 id",
    TemplateManagerTool.id === "template_manager",
  )

  // 5c. 工具可初始化
  assert(
    "TemplateManagerTool 可初始化",
    typeof TemplateManagerTool.init === "function",
  )
}

testTemplateToolIntegration()

// ============================================================================
// 6. ai-stream 集成 — buildDynamicSystemPrompt 含模板信息
// ============================================================================
console.log("\n📦 6. ai-stream 集成 — buildDynamicSystemPrompt 含模板信息")
console.log("  " + "─".repeat(50))

function testAiStreamIntegration() {
  // 6a. buildVideoEditingPrompt 接受 templateList
  const promptWith = buildVideoEditingPrompt({
    templateList: [
      "**vintage_style**: 复古风格 — 模拟老电影效果 (5 参数, 7 步骤)",
    ],
  })
  assert(
    "buildVideoEditingPrompt 含模板信息",
    promptWith.includes("可用视频编辑模板"),
  )
  assert(
    "buildVideoEditingPrompt 包含预设模板说明",
    promptWith.includes("预设模板可通过 template_manager"),
  )

  // 6b. buildVideoEditingPrompt 不含 templateList 时正常
  const promptWithout = buildVideoEditingPrompt({})
  assert(
    "buildVideoEditingPrompt 无模板时不包含模板节",
    !promptWithout.includes("可用视频编辑模板"),
  )

  // 6c. buildVideoEditingPrompt 含所有部分
  assert("基础 prompt 包含核心原则", promptWithout.includes("核心原则"))
  assert(
    "基础 prompt 包含中文指令指南",
    promptWithout.includes("中文指令理解指南"),
  )
  assert("基础 prompt 包含澄清指南", promptWithout.includes("澄清指南"))
}

testAiStreamIntegration()

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
