/**
 * 模板系统工具 — 将模板管理器注册为 AI 可调用工具
 *
 * 提供模板的列表、应用、创建、删除、导出、导入、预览等操作，
 * 使 AI 能够通过自然语言调用模板系统。
 */

import z from "zod"
import { Tool } from "../tool/tool.js"
import { BUILTIN_TEMPLATES } from "./presets/index.js"
import {
  createTemplate,
  deleteTemplate,
  exportTemplate,
  importTemplate,
  listAllTags,
  listCategories,
  listTemplates,
  loadTemplate,
  registerBuiltinTemplates,
  saveTemplate,
} from "./template-manager.js"
import type { ToolCallStep, VideoTemplate } from "./template-schema.js"
import { createTemplateSummary, validateTemplate } from "./template-schema.js"

// ============================================================================
// 初始化 — 注册内置模板
// ============================================================================

let _templatesRegistered = false

export function ensureBuiltinTemplatesRegistered(): void {
  if (_templatesRegistered) return
  registerBuiltinTemplates(BUILTIN_TEMPLATES)
  _templatesRegistered = true
}

// ============================================================================
// 占位符替换
// ============================================================================

/**
 * 将 argsTemplate 中的 {{paramName}} 占位符替换为实际参数值。
 */
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

/**
 * 评估条件表达式（简单形式）。
 * 支持: "param > 0", "param === true", "param !== ''", "param === 'value'"
 */
function evaluateCondition(
  condition: string,
  params: Record<string, string | number | boolean>,
): boolean {
  const trimmed = condition.trim()

  // 匹配简单比较表达式
  const match = trimmed.match(/^(\w+)\s*(===|!==|>|<|>=|<=)\s*(.+)$/)
  if (!match) return true // 无法解析时默认执行

  const [, paramName, op, rawValue] = match
  const actualValue = params[paramName]

  // 解析右侧值
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

/**
 * 解析用户提供的参数，合并模板默认值。
 */
function resolveParams(
  template: VideoTemplate,
  userParams: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {}
  for (const p of template.parameters) {
    if (userParams[p.name] !== undefined) {
      params[p.name] = userParams[p.name]
    } else if (p.defaultValue !== undefined) {
      params[p.name] = p.defaultValue
    }
  }
  return params
}

// ============================================================================
// 操作处理函数
// ============================================================================

async function handleListTemplates(args: {
  category?: string
  tags?: string
  search?: string
}): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  const filter: {
    category?: any
    tags?: string[]
    search?: string
  } = {}

  if (args.category) filter.category = args.category
  if (args.tags) filter.tags = args.tags.split(",").map((t) => t.trim())
  if (args.search) filter.search = args.search

  const result = listTemplates(filter)
  const allCount = result.builtin.length + result.custom.length

  const output = JSON.stringify(
    {
      total: allCount,
      builtin_count: result.builtin.length,
      custom_count: result.custom.length,
      builtin: result.builtin,
      custom: result.custom,
    },
    null,
    2,
  )

  return {
    title: `模板列表 (${allCount} 个)`,
    output,
    metadata: { operation: "list_templates", success: true, count: allCount },
  }
}

async function handleApplyTemplate(args: {
  template_id: string
  params?: string
}): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  const template = loadTemplate(args.template_id)
  if (!template) {
    return {
      title: "模板未找到",
      output: `未找到 ID 为 "${args.template_id}" 的模板。请使用 list_templates 查看可用模板。`,
      metadata: {
        operation: "apply_template",
        success: false,
        error: "template_not_found",
      },
    }
  }

  // 解析用户参数
  let userParams: Record<string, string | number | boolean> = {}
  if (args.params) {
    try {
      userParams = JSON.parse(args.params)
    } catch {
      return {
        title: "参数解析失败",
        output: `无法解析参数 JSON: ${args.params}。请提供有效的 JSON 格式参数，如 '{"speed_factor": 2.0}'。`,
        metadata: {
          operation: "apply_template",
          success: false,
          error: "invalid_params_json",
        },
      }
    }
  }

  const resolvedParams = resolveParams(template, userParams)

  // 检查必要参数
  const missingParams: string[] = []
  for (const p of template.parameters) {
    if (p.required && resolvedParams[p.name] === undefined) {
      missingParams.push(p.label)
    }
  }
  if (missingParams.length > 0) {
    return {
      title: "缺少必要参数",
      output: `应用模板 "${template.name}" 需要以下参数：\n${missingParams.map((p) => `  - ${p}`).join("\n")}\n\n请在 params 字段中提供这些参数的 JSON 值。`,
      metadata: {
        operation: "apply_template",
        success: false,
        error: "missing_params",
        missingParams,
      },
    }
  }

  // 解析工具调用步骤并替换占位符
  const resolvedCalls: Array<{
    toolName: string
    args: Record<string, string>
    description: string
    order: number
  }> = []
  const skippedCalls: string[] = []

  for (const step of template.toolCalls) {
    if (step.condition && !evaluateCondition(step.condition, resolvedParams)) {
      skippedCalls.push(step.description)
      continue
    }
    resolvedCalls.push({
      toolName: step.toolName,
      args: resolveArgsTemplate(step.argsTemplate, resolvedParams),
      description: step.description,
      order: step.order,
    })
  }

  const output = JSON.stringify(
    {
      template: createTemplateSummary(template),
      resolved_params: resolvedParams,
      resolved_calls: resolvedCalls,
      skipped_calls: skippedCalls.length > 0 ? skippedCalls : undefined,
      total_steps: resolvedCalls.length,
      note: "以上工具调用已按顺序解析。AI 应按 order 顺序依次调用每个步骤的 toolName 并传入解析后的 args。",
    },
    null,
    2,
  )

  return {
    title: `已解析模板: ${template.name}`,
    output,
    metadata: {
      operation: "apply_template",
      success: true,
      template_id: template.id,
      step_count: resolvedCalls.length,
    },
  }
}

async function handleCreateTemplate(args: { template_json: string }): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  let template: VideoTemplate
  try {
    template = JSON.parse(args.template_json)
  } catch {
    return {
      title: "模板 JSON 解析失败",
      output: `无法解析模板 JSON。请提供符合 VideoTemplate 格式的有效 JSON。`,
      metadata: {
        operation: "create_template",
        success: false,
        error: "invalid_json",
      },
    }
  }

  try {
    const created = createTemplate(template)
    return {
      title: `模板已创建: ${created.name}`,
      output: JSON.stringify(createTemplateSummary(created), null, 2),
      metadata: {
        operation: "create_template",
        success: true,
        template_id: created.id,
      },
    }
  } catch (error: any) {
    return {
      title: "模板创建失败",
      output: `模板验证失败: ${error.message}`,
      metadata: {
        operation: "create_template",
        success: false,
        error: error.message,
      },
    }
  }
}

async function handleDeleteTemplate(args: { template_id: string }): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  const deleted = deleteTemplate(args.template_id)
  if (!deleted) {
    return {
      title: "删除失败",
      output: `无法删除模板 "${args.template_id}"。可能原因：模板不存在，或为内置模板（内置模板不可删除）。`,
      metadata: {
        operation: "delete_template",
        success: false,
        error: "delete_failed",
      },
    }
  }

  return {
    title: `模板已删除: ${args.template_id}`,
    output: `模板 "${args.template_id}" 已成功删除。`,
    metadata: {
      operation: "delete_template",
      success: true,
      template_id: args.template_id,
    },
  }
}

async function handleExportTemplate(args: {
  template_id: string
  export_path?: string
}): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  const path = exportTemplate(args.template_id, args.export_path)
  if (!path) {
    return {
      title: "导出失败",
      output: `无法导出模板 "${args.template_id}"。请确认模板存在。`,
      metadata: {
        operation: "export_template",
        success: false,
        error: "export_failed",
      },
    }
  }

  return {
    title: `模板已导出`,
    output: `模板 "${args.template_id}" 已导出到: ${path}`,
    metadata: {
      operation: "export_template",
      success: true,
      export_path: path,
    },
  }
}

async function handleImportTemplate(args: {
  file_path: string
  overwrite?: boolean
}): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  const template = importTemplate(args.file_path, args.overwrite ?? false)
  if (!template) {
    return {
      title: "导入失败",
      output: `无法从 "${args.file_path}" 导入模板。请确认文件存在且包含有效的模板数据。如果模板 ID 已存在，请设置 overwrite=true。`,
      metadata: {
        operation: "import_template",
        success: false,
        error: "import_failed",
      },
    }
  }

  return {
    title: `模板已导入: ${template.name}`,
    output: JSON.stringify(createTemplateSummary(template), null, 2),
    metadata: {
      operation: "import_template",
      success: true,
      template_id: template.id,
    },
  }
}

async function handlePreviewTemplate(args: { template_id: string }): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  const template = loadTemplate(args.template_id)
  if (!template) {
    return {
      title: "模板未找到",
      output: `未找到 ID 为 "${args.template_id}" 的模板。`,
      metadata: {
        operation: "preview_template",
        success: false,
        error: "not_found",
      },
    }
  }

  const detailLines: string[] = [
    `模板名称: ${template.name}`,
    `分类: ${template.category}`,
    `描述: ${template.description}`,
    `作者: ${template.author}`,
    `版本: ${template.version}`,
    `标签: ${template.tags.join(", ")}`,
    "",
    `参数 (${template.parameters.length} 个):`,
    ...template.parameters.map((p) => {
      const req = p.required ? "[必需]" : "[可选]"
      const def =
        p.defaultValue !== undefined ? ` (默认: ${p.defaultValue})` : ""
      return `  - ${p.name} ${req}: ${p.description}${def}`
    }),
    "",
    `工具调用步骤 (${template.toolCalls.length} 个):`,
    ...template.toolCalls.map((s) => {
      const cond = s.condition ? ` [条件: ${s.condition}]` : ""
      return `  ${s.order}. ${s.description} → ${s.toolName}${cond}`
    }),
  ]

  return {
    title: `模板预览: ${template.name}`,
    output: detailLines.join("\n"),
    metadata: {
      operation: "preview_template",
      success: true,
      template_id: template.id,
    },
  }
}

async function handleListCategories(): Promise<{
  title: string
  output: string
  metadata: Record<string, unknown>
}> {
  ensureBuiltinTemplatesRegistered()

  const categories = listCategories()
  const tags = listAllTags()

  const output = JSON.stringify(
    {
      categories,
      all_tags: tags,
    },
    null,
    2,
  )

  return {
    title: `模板分类 (${categories.length} 个)`,
    output,
    metadata: {
      operation: "list_categories",
      success: true,
      category_count: categories.length,
    },
  }
}

// ============================================================================
// 工具注册
// ============================================================================

export const TemplateManagerTool = Tool.define("template_manager", {
  description:
    "视频编辑模板系统 — 管理预设和自定义视频编辑模板，支持一键应用多步编辑操作。模板将多个工具调用（如调色→滤镜→字幕→转场）打包为可复用的工作流。可用操作：list_templates(列出模板), apply_template(应用模板), create_template(创建自定义模板), delete_template(删除模板), export_template(导出), import_template(导入), preview_template(预览详情), list_categories(列出分类)。",

  parameters: z.object({
    operation: z
      .enum([
        "list_templates",
        "apply_template",
        "create_template",
        "delete_template",
        "export_template",
        "import_template",
        "preview_template",
        "list_categories",
      ])
      .describe(
        "操作类型: list_templates=列出模板, apply_template=应用模板, create_template=创建模板, delete_template=删除模板, export_template=导出模板, import_template=导入模板, preview_template=预览模板详情, list_categories=列出分类",
      ),

    // list_templates 参数
    category: z
      .string()
      .optional()
      .describe(
        "按分类筛选模板 (fast_cut/long_form/news_style/deep_analysis/cinematic/vintage/social_media/tutorial/vlog/custom)",
      ),
    tags: z
      .string()
      .optional()
      .describe("按标签筛选模板 (多个标签用逗号分隔，如'电影,复古')"),
    search: z.string().optional().describe("按关键词搜索模板名称和描述"),

    // apply_template 参数
    template_id: z
      .string()
      .optional()
      .describe(
        "模板 ID (从 list_templates 获取，apply/delete/export/preview 操作需要)",
      ),
    params: z
      .string()
      .optional()
      .describe(
        '模板参数的 JSON 字符串，用于覆盖默认值 (apply_template 操作使用)。如 \'{"speed_factor": 2.0, "add_subtitles": true}\'',
      ),

    // create_template 参数
    template_json: z
      .string()
      .optional()
      .describe("完整模板定义的 JSON 字符串 (create_template 操作使用)"),

    // export/import 参数
    export_path: z
      .string()
      .optional()
      .describe(
        "导出模板的目标路径 (export_template 操作，默认输出到当前目录)",
      ),
    file_path: z
      .string()
      .optional()
      .describe("导入模板的源文件路径 (import_template 操作)"),
    overwrite: z
      .boolean()
      .optional()
      .describe("是否覆盖已存在的模板 (import_template 操作，默认 false)"),
  }),

  execute: async (args: any, _ctx: any) => {
    switch (args.operation) {
      case "list_templates":
        return await handleListTemplates(args)
      case "apply_template":
        return await handleApplyTemplate(args)
      case "create_template":
        return await handleCreateTemplate(args)
      case "delete_template":
        return await handleDeleteTemplate(args)
      case "export_template":
        return await handleExportTemplate(args)
      case "import_template":
        return await handleImportTemplate(args)
      case "preview_template":
        return await handlePreviewTemplate(args)
      case "list_categories":
        return await handleListCategories()
      default:
        return {
          title: "未知操作",
          output: `不支持的操作类型: ${args.operation}。支持的操作: list_templates, apply_template, create_template, delete_template, export_template, import_template, preview_template, list_categories`,
          metadata: {
            operation: args.operation,
            success: false,
            error: "unknown_operation",
          },
        }
    }
  },
})
