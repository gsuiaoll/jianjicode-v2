/**
 * 特效模板系统
 * 提供预设特效组合模板，支持一键应用多个特效到视频
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import { basename, dirname, extname, join } from "path"
import z from "zod"
import { Tool } from "./tool.js"
import { VideoFilterTool } from "./video_filter.js"

/**
 * 单个特效定义
 */
export interface EffectDefinition {
  type:
    | "blur"
    | "sharpen"
    | "glow"
    | "vignette"
    | "grain"
    | "lut-cinematic"
    | "lut-vintage"
    | "lut-bw"
    | "lut-cool"
    | "lut-warm"
    | "lut-muted"
    | "lut-vivid"
  amount?: number // 0-100
  radius?: number // 0-50 (仅glow)
  intensity?: number // 0-100 (仅LUT)
  order: number // 应用顺序
}

/**
 * 特效模板定义
 */
export interface EffectTemplate {
  id: string
  name: string
  description: string
  category:
    | "cinematic"
    | "vintage"
    | "modern"
    | "artistic"
    | "social"
    | "experimental"
    | "custom"
  effects: EffectDefinition[]
  tags: string[]
  author?: string
  created?: string
  version?: string
}

/**
 * 预设特效模板库
 */
export const PRESET_EFFECT_TEMPLATES: EffectTemplate[] = [
  // 电影风格
  {
    id: "cinematic_film_look",
    name: "电影感效果",
    description: "经典电影感效果：颗粒 + 暗角 + 电影LUT",
    category: "cinematic",
    effects: [
      { type: "grain", amount: 30, order: 1 },
      { type: "vignette", amount: 40, order: 2 },
      { type: "lut-cinematic", intensity: 80, order: 3 },
    ],
    tags: ["cinematic", "film", "movie", "grain", "vignette"],
  },
  {
    id: "cinematic_glow",
    name: "电影发光效果",
    description: "柔和的发光效果，营造梦幻电影感",
    category: "cinematic",
    effects: [
      { type: "glow", amount: 60, radius: 15, order: 1 },
      { type: "lut-muted", intensity: 70, order: 2 },
    ],
    tags: ["cinematic", "glow", "dreamy", "soft"],
  },

  // 复古风格
  {
    id: "vintage_retro",
    name: "复古风格",
    description: "复古胶片效果：颗粒 + 复古LUT + 轻微暗角",
    category: "vintage",
    effects: [
      { type: "grain", amount: 50, order: 1 },
      { type: "lut-vintage", intensity: 90, order: 2 },
      { type: "vignette", amount: 30, order: 3 },
    ],
    tags: ["vintage", "retro", "film", "grain"],
  },
  {
    id: "vintage_sepia",
    name: "棕褐复古",
    description: "棕褐色调复古效果",
    category: "vintage",
    effects: [
      { type: "lut-vintage", intensity: 100, order: 1 },
      { type: "grain", amount: 40, order: 2 },
    ],
    tags: ["vintage", "sepia", "brown", "old"],
  },

  // 现代风格
  {
    id: "modern_clean",
    name: "现代清新",
    description: "现代清新效果：轻微锐化 + 冷色调LUT",
    category: "modern",
    effects: [
      { type: "sharpen", amount: 30, order: 1 },
      { type: "lut-cool", intensity: 60, order: 2 },
    ],
    tags: ["modern", "clean", "sharp", "cool"],
  },
  {
    id: "modern_vibrant",
    name: "现代鲜艳",
    description: "鲜艳色彩效果：鲜艳LUT + 轻微发光",
    category: "modern",
    effects: [
      { type: "lut-vivid", intensity: 80, order: 1 },
      { type: "glow", amount: 30, radius: 8, order: 2 },
    ],
    tags: ["modern", "vivid", "colorful", "bright"],
  },

  // 艺术风格
  {
    id: "artistic_dreamy",
    name: "梦幻艺术",
    description: "梦幻艺术效果：强发光 + 模糊 + 柔和LUT",
    category: "artistic",
    effects: [
      { type: "glow", amount: 80, radius: 20, order: 1 },
      { type: "blur", amount: 20, order: 2 },
      { type: "lut-muted", intensity: 90, order: 3 },
    ],
    tags: ["artistic", "dreamy", "glow", "soft"],
  },
  {
    id: "artistic_silhouette",
    name: "剪影艺术",
    description: "剪影艺术效果：黑白LUT + 高对比度",
    category: "artistic",
    effects: [
      { type: "lut-bw", intensity: 100, order: 1 },
      { type: "sharpen", amount: 50, order: 2 },
    ],
    tags: ["artistic", "silhouette", "bw", "contrast"],
  },

  // 社交媒体风格
  {
    id: "social_video",
    name: "社交媒体",
    description: "适合社交媒体的效果：鲜艳色彩 + 轻微锐化",
    category: "social",
    effects: [
      { type: "lut-vivid", intensity: 90, order: 1 },
      { type: "sharpen", amount: 40, order: 2 },
    ],
    tags: ["social", "vivid", "sharp", "instagram"],
  },
  {
    id: "social_glamour",
    name: "美颜 glamour",
    description: "美颜效果：柔焦模糊 + 发光",
    category: "social",
    effects: [
      { type: "blur", amount: 15, order: 1 },
      { type: "glow", amount: 40, radius: 10, order: 2 },
    ],
    tags: ["social", "beauty", "glamour", "soft"],
  },

  // 实验风格
  {
    id: "experimental_glitch",
    name: "故障艺术",
    description: "故障艺术效果：多重效果组合",
    category: "experimental",
    effects: [
      { type: "lut-cool", intensity: 70, order: 1 },
      { type: "glow", amount: 50, radius: 12, order: 2 },
      { type: "grain", amount: 60, order: 3 },
    ],
    tags: ["experimental", "glitch", "art", "modern"],
  },
  {
    id: "experimental_fantasy",
    name: "奇幻效果",
    description: "奇幻色彩效果：暖色调LUT + 强发光",
    category: "experimental",
    effects: [
      { type: "lut-warm", intensity: 85, order: 1 },
      { type: "glow", amount: 70, radius: 18, order: 2 },
    ],
    tags: ["experimental", "fantasy", "warm", "glow"],
  },
]

/**
 * 获取模板存储目录
 */
function getTemplateStorageDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd()
  const templateDir = join(homeDir, ".jianjicode", "effect_templates")

  // 确保目录存在
  if (!existsSync(templateDir)) {
    mkdirSync(templateDir, { recursive: true })
  }

  return templateDir
}

/**
 * 保存模板到文件
 */
function saveTemplateToFile(template: EffectTemplate): void {
  const templateDir = getTemplateStorageDir()
  const filePath = join(templateDir, `${template.id}.json`)

  // 添加创建时间戳
  const templateWithMeta = {
    ...template,
    created: new Date().toISOString(),
    version: "1.0",
  }

  writeFileSync(filePath, JSON.stringify(templateWithMeta, null, 2))
}

/**
 * 从文件加载模板
 */
function loadTemplateFromFile(templateId: string): EffectTemplate | null {
  const templateDir = getTemplateStorageDir()
  const filePath = join(templateDir, `${templateId}.json`)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as EffectTemplate
  } catch (error) {
    console.error(`加载模板 ${templateId} 失败:`, error)
    return null
  }
}

/**
 * 列出所有模板（内置 + 自定义）
 */
function listAllTemplates(): {
  builtin: EffectTemplate[]
  custom: EffectTemplate[]
} {
  const builtin = PRESET_EFFECT_TEMPLATES

  // 加载自定义模板
  const templateDir = getTemplateStorageDir()
  let customTemplates: EffectTemplate[] = []

  try {
    const files = readdirSync(templateDir).filter((f) => f.endsWith(".json"))
    customTemplates = files
      .map((file) => {
        try {
          const content = readFileSync(join(templateDir, file), "utf-8")
          return JSON.parse(content) as EffectTemplate
        } catch (error) {
          console.error(`解析模板文件 ${file} 失败:`, error)
          return null
        }
      })
      .filter((t): t is EffectTemplate => t !== null)
  } catch (error) {
    // 目录可能为空，忽略错误
  }

  return { builtin, custom: customTemplates }
}

/**
 * 特效模板工具
 */
export const EffectTemplateTool = Tool.defineLtxTool("effect_template", {
  description: "特效模板系统 - 管理并应用预设特效组合到视频",
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
      ])
      .describe("操作类型"),

    // list_templates 参数
    filter_category: z
      .string()
      .optional()
      .describe("按分类筛选模板 (仅 list_templates 操作)"),
    show_details: z
      .boolean()
      .optional()
      .default(false)
      .describe("显示详细信息 (仅 list_templates 操作)"),

    // apply_template 参数
    input: z
      .string()
      .optional()
      .describe("输入视频文件路径 (apply_template 操作必需)"),
    template_id: z
      .string()
      .optional()
      .describe("模板ID (apply_template/create_template 操作必需)"),
    output: z
      .string()
      .optional()
      .describe("输出文件路径 (apply_template 操作可选)"),
    strength: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .default(100)
      .describe("模板应用强度 (0-100%, 默认100)"),

    // create_template 参数
    name: z.string().optional().describe("模板名称 (create_template 操作必需)"),
    description: z
      .string()
      .optional()
      .describe("模板描述 (create_template 操作可选)"),
    category: z
      .enum([
        "cinematic",
        "vintage",
        "modern",
        "artistic",
        "social",
        "experimental",
        "custom",
      ])
      .optional()
      .describe("模板分类 (create_template 操作可选)"),
    tags: z
      .array(z.string())
      .optional()
      .describe("标签列表 (create_template 操作可选)"),
    effects: z
      .array(
        z.object({
          type: z.enum([
            "blur",
            "sharpen",
            "glow",
            "vignette",
            "grain",
            "lut-cinematic",
            "lut-vintage",
            "lut-bw",
            "lut-cool",
            "lut-warm",
            "lut-muted",
            "lut-vivid",
          ]),
          amount: z.number().min(0).max(100).optional(),
          radius: z.number().min(0).max(50).optional(),
          intensity: z.number().min(0).max(100).optional(),
          order: z.number().min(1).max(10),
        }),
      )
      .optional()
      .describe("特效列表 (create_template 操作必需)"),

    // export/import 参数
    export_path: z
      .string()
      .optional()
      .describe("导出路径 (export_template 操作可选)"),
    import_file: z
      .string()
      .optional()
      .describe("导入文件路径 (import_template 操作必需)"),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("是否覆盖现有模板"),

    // preview 参数
    preview_image: z
      .string()
      .optional()
      .describe("预览图片路径 (preview_template 操作可选)"),
  }),

  execute: async (args, ctx) => {
    try {
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
        default:
          return {
            title: "未知操作",
            metadata: { operation: "effect_template", error: true },
            output: `未知操作: ${args.operation}`,
          }
      }
    } catch (error: any) {
      return {
        title: "特效模板操作失败",
        metadata: { operation: "effect_template", error: true },
        output: `操作失败: ${error.message}`,
      }
    }
  },
})

/**
 * 处理列出模板
 */
async function handleListTemplates(args: any): Promise<any> {
  const { builtin, custom } = listAllTemplates()

  let filteredBuiltin = builtin
  let filteredCustom = custom

  // 按分类筛选
  if (args.category) {
    filteredBuiltin = builtin.filter((t) => t.category === args.category)
    filteredCustom = custom.filter((t) => t.category === args.category)
  }

  let output = "🎭 **特效模板库**\n\n"

  // 显示内置模板
  output += `### 内置模板 (${filteredBuiltin.length} 个)\n`
  if (filteredBuiltin.length === 0) {
    output += "无模板\n"
  } else {
    filteredBuiltin.forEach((template) => {
      output += `- **${template.name}** (\`${template.id}\`)\n`
      if (args.show_details) {
        output += `  📝 ${template.description}\n`
        output += `  🏷️ 分类: ${template.category} | 特效数量: ${template.effects.length}\n`
        output += `  🎨 特效: ${template.effects.map((e) => getEffectTypeName(e.type)).join(" → ")}\n`
      } else {
        output += `  ${template.description}\n`
      }
    })
  }

  // 显示自定义模板
  output += `\n### 自定义模板 (${filteredCustom.length} 个)\n`
  if (filteredCustom.length === 0) {
    output += "无自定义模板\n"
  } else {
    filteredCustom.forEach((template) => {
      output += `- **${template.name}** (\`${template.id}\`)\n`
      if (args.show_details) {
        output += `  📝 ${template.description}\n`
        output += `  🏷️ 分类: ${template.category} | 作者: ${template.author || "未知"}\n`
        output += `  🎨 特效: ${template.effects.map((e) => getEffectTypeName(e.type)).join(" → ")}\n`
      } else {
        output += `  ${template.description}\n`
      }
    })
  }

  output += `\n💡 使用 \`apply_template\` 操作应用模板到视频`

  return {
    title: "特效模板列表",
    metadata: {
      operation: "list_templates",
      error: false,
      success: true,
      builtin_count: filteredBuiltin.length,
      custom_count: filteredCustom.length,
    },
    output,
  }
}

/**
 * 处理应用模板
 */
async function handleApplyTemplate(args: any): Promise<any> {
  // 验证输入
  if (!args.input) {
    return {
      title: "应用模板失败",
      metadata: { operation: "apply_template", error: true },
      output: "❌ 请输入视频文件路径 (input 参数)",
    }
  }

  if (!args.template_id) {
    return {
      title: "应用模板失败",
      metadata: { operation: "apply_template", error: true },
      output: "❌ 请指定模板ID (template_id 参数)",
    }
  }

  if (!existsSync(args.input)) {
    return {
      title: "应用模板失败",
      metadata: { operation: "apply_template", error: true },
      output: `❌ 输入文件不存在: ${args.input}`,
    }
  }

  // 查找模板
  const allTemplates = listAllTemplates()
  const template = [...allTemplates.builtin, ...allTemplates.custom].find(
    (t) => t.id === args.template_id,
  )

  if (!template) {
    return {
      title: "应用模板失败",
      metadata: { operation: "apply_template", error: true },
      output: `❌ 找不到模板: ${args.template_id}`,
    }
  }

  // 计算应用强度
  const strength = args.strength || 100
  const effects = applyTemplateStrength(template.effects, strength)

  // 构建输出路径
  const outputPath =
    args.output || `${args.input.replace(/\.[^/.]+$/, "")}_${template.id}.mp4`

  // 调用视频滤镜工具应用特效模板（实际视频处理）
  try {
    console.log(`[EffectTemplate] 调用视频滤镜工具应用特效模板`)

    // 将特效模板转换为视频滤镜参数（实际视频处理实现）
    const filterParams = convertEffectsToVideoFilterParams(effects)

    // 准备视频滤镜工具参数
    const filterArgs = {
      input: args.input,
      output: outputPath,
      ...filterParams,
      // 默认质量设置
      quality: 23,
      fast: false,
      allow_overwrite: true,
      protect_originals: false,
    }

    console.log(`[EffectTemplate] 视频滤镜参数:`, filterArgs)

    // 调用视频滤镜工具
    const filterResult = await VideoFilterTool.execute(filterArgs, {})

    if (!filterResult.metadata?.success) {
      return {
        title: "模板应用失败",
        metadata: {
          operation: "apply_template",
          error: true,
          success: false,
          input: args.input,
          output: outputPath,
          template_id: template.id,
          template_name: template.name,
          strength,
          effects_count: effects.length,
          effects: effects,
        },
        output:
          `❌ 视频特效应用失败: ${filterResult.output || "未知错误"}\n` +
          `📁 输入: ${args.input}\n` +
          `🎭 模板: ${template.name} (强度: ${strength}%)\n` +
          `✨ 包含 ${effects.length} 个特效: ${effects.map((e) => getEffectTypeName(e.type)).join(" → ")}`,
      }
    }

    return {
      title: "模板应用成功",
      metadata: {
        operation: "apply_template",
        error: false,
        success: true,
        input: args.input,
        output: filterResult.metadata.outputPath || outputPath,
        template_id: template.id,
        template_name: template.name,
        strength,
        effects_count: effects.length,
        effects: effects,
        filter_result: filterResult.metadata,
      },
      output:
        `✅ 模板 **${template.name}** 应用成功 (强度: ${strength}%)\n` +
        `📁 输入: ${args.input}\n` +
        `📁 输出: ${filterResult.metadata.outputPath || outputPath}\n` +
        `🎭 包含 ${effects.length} 个特效: ${effects.map((e) => getEffectTypeName(e.type)).join(" → ")}\n` +
        `✨ 使用实际视频滤镜处理（非颜色校正映射）`,
    }
  } catch (error: any) {
    // 如果视频滤镜工具失败，尝试使用旧的 LTX 颜色校正作为后备
    console.log(
      `[EffectTemplate] 视频滤镜工具失败，尝试 LTX 颜色校正后备:`,
      error.message,
    )

    try {
      // 将特效模板转换为颜色校正参数（简化实现）
      const colorCorrection = convertEffectsToColorCorrection(effects)

      // 准备 LTX 直接桥接参数
      const ltxArgs = {
        operation: "apply_color_grading" as const,
        input_path: args.input,
        color_correction: colorCorrection,
        output_path: outputPath,
        bridge_mode: "auto" as const,
        timeout: 30000,
      }

      console.log(`[EffectTemplate] LTX 后备参数:`, ltxArgs)

      // LTX 直接桥接工具已废弃
      throw new Error("LTX direct bridge is no longer available. Please use the HTTP API instead.")

      if (!ltxResult.metadata?.success) {
        throw new Error(ltxResult.output || "LTX 颜色校正失败")
      }

      return {
        title: "模板应用成功 (使用 LTX 颜色校正后备)",
        metadata: {
          operation: "apply_template",
          error: false,
          success: true,
          input: args.input,
          output: ltxResult.metadata.output_path || outputPath,
          template_id: template.id,
          template_name: template.name,
          strength,
          effects_count: effects.length,
          effects: effects,
          ltx_result: ltxResult.metadata,
          used_fallback: true,
        },
        output:
          `✅ 模板 **${template.name}** 应用成功 (强度: ${strength}%)\n` +
          `📁 输入: ${args.input}\n` +
          `📁 输出: ${ltxResult.metadata.output_path || outputPath}\n` +
          `🎭 包含 ${effects.length} 个特效: ${effects.map((e) => getEffectTypeName(e.type)).join(" → ")}\n` +
          `⚠️ 注意: 使用颜色校正后备实现（部分特效可能被简化）`,
      }
    } catch (fallbackError: any) {
      return {
        title: "模板应用错误",
        metadata: {
          operation: "apply_template",
          error: true,
          success: false,
          input: args.input,
          output: outputPath,
          template_id: template.id,
          template_name: template.name,
          strength,
          effects_count: effects.length,
          effects: effects,
        },
        output:
          `❌ 所有特效应用方法均失败:\n` +
          `1. 视频滤镜工具: ${error.message}\n` +
          `2. LTX 颜色校正后备: ${fallbackError.message}\n` +
          `📁 输入: ${args.input}\n` +
          `🎭 模板: ${template.name} (强度: ${strength}%)\n` +
          `✨ 包含 ${effects.length} 个特效: ${effects.map((e) => getEffectTypeName(e.type)).join(" → ")}\n\n` +
          `💡 请检查 FFmpeg 是否可用，或 LTX 后端服务是否配置正确`,
      }
    }
  }
}

/**
 * 处理创建模板
 */
async function handleCreateTemplate(args: any): Promise<any> {
  if (!args.template_id) {
    return {
      title: "创建模板失败",
      metadata: { operation: "create_template", error: true },
      output: "❌ 请指定模板ID (template_id 参数)",
    }
  }

  if (!args.name) {
    return {
      title: "创建模板失败",
      metadata: { operation: "create_template", error: true },
      output: "❌ 请指定模板名称 (name 参数)",
    }
  }

  if (!args.effects || args.effects.length === 0) {
    return {
      title: "创建模板失败",
      metadata: { operation: "create_template", error: true },
      output: "❌ 请指定至少一个特效 (effects 参数)",
    }
  }

  // 检查模板ID是否已存在
  const allTemplates = listAllTemplates()
  const existing = [...allTemplates.builtin, ...allTemplates.custom].find(
    (t) => t.id === args.template_id,
  )

  if (existing && !args.overwrite) {
    return {
      title: "创建模板失败",
      metadata: { operation: "create_template", error: true },
      output:
        `❌ 模板ID已存在: ${args.template_id}\n` +
        `使用 overwrite: true 覆盖现有模板`,
    }
  }

  // 验证特效参数
  const effects: EffectDefinition[] = args.effects.map(
    (eff: any, index: number) => ({
      type: eff.type,
      amount:
        eff.amount ||
        (eff.type === "grain" ? 50 : eff.type === "vignette" ? 40 : 30),
      radius: eff.radius || (eff.type === "glow" ? 10 : undefined),
      intensity: eff.intensity || (eff.type.includes("lut") ? 80 : undefined),
      order: eff.order || index + 1,
    }),
  )

  // 创建模板对象
  const template: EffectTemplate = {
    id: args.template_id,
    name: args.name,
    description: args.description || `自定义特效模板: ${args.name}`,
    category: args.category || "custom",
    effects,
    tags: args.tags || ["custom"],
    author: "用户创建",
    created: new Date().toISOString(),
    version: "1.0",
  }

  // 保存模板
  saveTemplateToFile(template)

  return {
    title: "模板创建成功",
    metadata: {
      operation: "create_template",
      error: false,
      success: true,
      template_id: template.id,
      overwrite: !!existing,
    },
    output:
      `✅ 模板 **${template.name}** 创建成功\n` +
      `📝 ID: \`${template.id}\`\n` +
      `🏷️ 分类: ${template.category}\n` +
      `🎭 特效数量: ${template.effects.length}\n` +
      `📁 保存位置: ${getTemplateStorageDir()}/${template.id}.json`,
  }
}

/**
 * 处理删除模板
 */
async function handleDeleteTemplate(args: any): Promise<any> {
  if (!args.template_id) {
    return {
      title: "删除模板失败",
      metadata: { operation: "delete_template", error: true },
      output: "❌ 请指定模板ID (template_id 参数)",
    }
  }

  // 检查是否为内置模板
  const builtinTemplate = PRESET_EFFECT_TEMPLATES.find(
    (t) => t.id === args.template_id,
  )
  if (builtinTemplate) {
    return {
      title: "删除模板失败",
      metadata: { operation: "delete_template", error: true },
      output:
        `❌ 无法删除内置模板: ${args.template_id}\n` +
        `内置模板只能通过代码修改`,
    }
  }

  // 删除自定义模板
  const templateDir = getTemplateStorageDir()
  const filePath = join(templateDir, `${args.template_id}.json`)

  if (!existsSync(filePath)) {
    return {
      title: "删除模板失败",
      metadata: { operation: "delete_template", error: true },
      output: `❌ 模板不存在: ${args.template_id}`,
    }
  }

  unlinkSync(filePath)

  return {
    title: "模板删除成功",
    metadata: {
      operation: "delete_template",
      error: false,
      success: true,
      template_id: args.template_id,
    },
    output: `✅ 模板 \`${args.template_id}\` 删除成功`,
  }
}

/**
 * 处理导出模板
 */
async function handleExportTemplate(args: any): Promise<any> {
  if (!args.template_id) {
    return {
      title: "导出模板失败",
      metadata: { operation: "export_template", error: true },
      output: "❌ 请指定模板ID (template_id 参数)",
    }
  }

  // 查找模板
  const allTemplates = listAllTemplates()
  const template = [...allTemplates.builtin, ...allTemplates.custom].find(
    (t) => t.id === args.template_id,
  )

  if (!template) {
    return {
      title: "导出模板失败",
      metadata: { operation: "export_template", error: true },
      output: `❌ 找不到模板: ${args.template_id}`,
    }
  }

  // 构建导出路径
  const exportPath =
    args.export_path ||
    join(process.cwd(), `${template.id}_effect_template.json`)

  // 导出模板
  writeFileSync(exportPath, JSON.stringify(template, null, 2))

  return {
    title: "模板导出成功",
    metadata: {
      operation: "export_template",
      error: false,
      success: true,
      template_id: template.id,
      export_path: exportPath,
    },
    output:
      `✅ 模板 **${template.name}** 导出成功\n` +
      `📁 导出位置: ${exportPath}\n` +
      `💡 使用 \`import_template\` 操作导入此模板`,
  }
}

/**
 * 处理导入模板
 */
async function handleImportTemplate(args: any): Promise<any> {
  if (!args.import_file) {
    return {
      title: "导入模板失败",
      metadata: { operation: "import_template", error: true },
      output: "❌ 请指定导入文件路径 (import_file 参数)",
    }
  }

  if (!existsSync(args.import_file)) {
    return {
      title: "导入模板失败",
      metadata: { operation: "import_template", error: true },
      output: `❌ 导入文件不存在: ${args.import_file}`,
    }
  }

  try {
    // 读取并验证模板文件
    const content = readFileSync(args.import_file, "utf-8")
    const template = JSON.parse(content) as EffectTemplate

    // 验证必要字段
    if (
      !template.id ||
      !template.name ||
      !template.effects ||
      !Array.isArray(template.effects)
    ) {
      return {
        title: "导入模板失败",
        metadata: { operation: "import_template", error: true },
        output: "❌ 模板文件格式无效，缺少必要字段",
      }
    }

    // 检查是否已存在
    const allTemplates = listAllTemplates()
    const existing = [...allTemplates.builtin, ...allTemplates.custom].find(
      (t) => t.id === template.id,
    )

    if (existing && !args.overwrite) {
      return {
        title: "导入模板失败",
        metadata: { operation: "import_template", error: true },
        output:
          `❌ 模板ID已存在: ${template.id}\n` +
          `使用 overwrite: true 覆盖现有模板`,
      }
    }

    // 保存模板
    saveTemplateToFile(template)

    return {
      title: "模板导入成功",
      metadata: {
        operation: "import_template",
        error: false,
        success: true,
        template_id: template.id,
        overwrite: !!existing,
      },
      output:
        `✅ 模板 **${template.name}** 导入成功\n` +
        `📝 ID: \`${template.id}\`\n` +
        `🏷️ 分类: ${template.category || "custom"}\n` +
        `🎭 特效数量: ${template.effects.length}\n` +
        `📁 保存位置: ${getTemplateStorageDir()}/${template.id}.json`,
    }
  } catch (error: any) {
    return {
      title: "导入模板失败",
      metadata: { operation: "import_template", error: true },
      output: `❌ 导入失败: ${error.message}`,
    }
  }
}

/**
 * 处理预览模板
 */
async function handlePreviewTemplate(args: any): Promise<any> {
  if (!args.template_id) {
    return {
      title: "预览模板失败",
      metadata: { operation: "preview_template", error: true },
      output: "❌ 请指定模板ID (template_id 参数)",
    }
  }

  // 查找模板
  const allTemplates = listAllTemplates()
  const template = [...allTemplates.builtin, ...allTemplates.custom].find(
    (t) => t.id === args.template_id,
  )

  if (!template) {
    return {
      title: "预览模板失败",
      metadata: { operation: "preview_template", error: true },
      output: `❌ 找不到模板: ${args.template_id}`,
    }
  }

  // 生成预览文本
  let output = `🎭 **模板预览: ${template.name}**\n\n`
  output += `📝 ${template.description}\n`
  output += `🏷️ 分类: ${template.category}\n`
  output += `🏷️ 标签: ${template.tags.join(", ")}\n`
  if (template.author) output += `👤 作者: ${template.author}\n`
  if (template.created)
    output += `📅 创建: ${new Date(template.created).toLocaleString()}\n`

  output += `\n### 特效序列 (${template.effects.length} 个)\n`
  template.effects
    .sort((a, b) => a.order - b.order)
    .forEach((effect) => {
      output += `\n${effect.order}. **${getEffectTypeName(effect.type)}**\n`
      if (effect.amount !== undefined)
        output += `   • 强度: ${effect.amount}%\n`
      if (effect.radius !== undefined) output += `   • 半径: ${effect.radius}\n`
      if (effect.intensity !== undefined)
        output += `   • LUT强度: ${effect.intensity}%\n`
    })

  output += `\n### 效果描述\n`
  output += getTemplateEffectDescription(template)

  if (args.preview_image) {
    output += `\n💡 预览图片: ${args.preview_image}\n`
    output += `   使用 \`apply_template\` 操作实际应用效果`
  }

  return {
    title: "模板预览",
    metadata: {
      operation: "preview_template",
      error: false,
      success: true,
      template_id: template.id,
    },
    output,
  }
}

/**
 * 应用模板强度
 */
function applyTemplateStrength(
  effects: EffectDefinition[],
  strength: number,
): EffectDefinition[] {
  const factor = strength / 100
  return effects.map((effect) => ({
    ...effect,
    amount: effect.amount !== undefined ? effect.amount * factor : undefined,
    radius: effect.radius !== undefined ? effect.radius * factor : undefined,
    intensity:
      effect.intensity !== undefined ? effect.intensity * factor : undefined,
  }))
}

/**
 * 获取特效类型名称
 */
function getEffectTypeName(effectType: string): string {
  const effectNames: Record<string, string> = {
    blur: "模糊",
    sharpen: "锐化",
    glow: "发光",
    vignette: "暗角",
    grain: "颗粒",
    "lut-cinematic": "电影感 LUT",
    "lut-vintage": "复古 LUT",
    "lut-bw": "黑白 LUT",
    "lut-cool": "冷色调 LUT",
    "lut-warm": "暖色调 LUT",
    "lut-muted": "柔和 LUT",
    "lut-vivid": "鲜艳 LUT",
  }

  return effectNames[effectType] || effectType
}

/**
 * 获取模板效果描述
 */
function getTemplateEffectDescription(template: EffectTemplate): string {
  const effects = template.effects
  let description = ""

  // 分析特效组合
  const effectTypes = effects.map((e) => e.type)

  // 电影感组合
  if (
    effectTypes.includes("grain") &&
    effectTypes.includes("vignette") &&
    effectTypes.includes("lut-cinematic")
  ) {
    description += "• 经典电影感：胶片颗粒 + 暗角 + 电影色调\n"
  }

  // 复古组合
  if (effectTypes.includes("grain") && effectTypes.includes("lut-vintage")) {
    description += "• 复古胶片效果：颗粒感 + 复古色调\n"
  }

  // 现代组合
  if (effectTypes.includes("sharpen") && effectTypes.includes("lut-cool")) {
    description += "• 现代清新：清晰锐利 + 冷色调\n"
  }

  // 艺术组合
  if (effectTypes.includes("glow") && effectTypes.includes("blur")) {
    description += "• 梦幻艺术：发光效果 + 柔焦模糊\n"
  }

  // 社交媒体组合
  if (effectTypes.includes("lut-vivid") && effectTypes.includes("sharpen")) {
    description += "• 社交媒体：鲜艳色彩 + 清晰细节\n"
  }

  // 黑白艺术
  if (effectTypes.includes("lut-bw")) {
    description += "• 黑白艺术：单色色调，强调对比和纹理\n"
  }

  if (description === "") {
    description = "• 自定义特效组合，提供独特视觉风格\n"
  }

  return description
}

/**
 * 将特效列表转换为颜色校正参数（简化实现）
 * 注意：这是一个简化的映射，实际应用中可能需要更复杂的转换逻辑
 */
function convertEffectsToColorCorrection(
  effects: EffectDefinition[],
): Record<string, number> {
  const correction: Record<string, number> = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    exposure: 0,
    highlights: 0,
    shadows: 0,
  }

  // 根据特效类型调整颜色校正参数
  for (const effect of effects) {
    const amount = effect.amount || 50
    const normalizedAmount = (amount - 50) / 50 // 转换为 -1 到 1 的范围

    switch (effect.type) {
      case "lut-cinematic":
        correction.contrast += 15
        correction.saturation += 5
        correction.temperature += 5
        break
      case "lut-vintage":
        correction.temperature += 20
        correction.saturation -= 10
        correction.exposure -= 3
        break
      case "lut-bw":
        correction.saturation -= 100
        correction.contrast += 20
        break
      case "lut-cool":
        correction.temperature -= 10
        correction.saturation += 5
        break
      case "lut-warm":
        correction.temperature += 10
        correction.saturation += 5
        break
      case "lut-muted":
        correction.saturation -= 20
        correction.contrast -= 5
        break
      case "lut-vivid":
        correction.saturation += 25
        correction.contrast += 10
        break
      case "grain":
        // 颗粒效果在颜色校正中无法直接表示，通过轻微降低清晰度模拟
        correction.contrast -= 3
        break
      case "vignette":
        // 暗角效果在颜色校正中无法直接表示
        break
      case "blur":
        // 模糊效果无法表示
        break
      case "sharpen":
        correction.contrast += 5
        break
      case "glow":
        correction.exposure += 5
        correction.highlights += 10
        break
    }
  }

  // 限制值在合理范围内
  for (const key in correction) {
    if (key === "saturation") {
      correction[key] = Math.max(-100, Math.min(100, correction[key]))
    } else {
      correction[key] = Math.max(-50, Math.min(50, correction[key]))
    }
  }

  return correction
}

/**
 * 将特效列表转换为视频滤镜参数（实际视频处理实现）
 */
function convertEffectsToVideoFilterParams(
  effects: EffectDefinition[],
): Record<string, any> {
  const params: Record<string, any> = {
    // 默认值
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    exposure: 0,
    highlights: 0,
    shadows: 0,
    preset: "none",
  }

  // 按顺序处理特效（已根据order排序）
  const sortedEffects = [...effects].sort((a, b) => a.order - b.order)

  for (const effect of sortedEffects) {
    const amount = effect.amount || 50
    const intensity = effect.intensity || 80
    const radius = effect.radius || 10

    switch (effect.type) {
      case "blur":
        // 映射 0-100 到 0-10
        params.blur = Math.min(10, (amount / 100) * 10)
        break

      case "sharpen":
        // 映射 0-100 到 0-5
        params.sharpen = Math.min(5, (amount / 100) * 5)
        break

      case "glow":
        // 直接映射 0-100
        params.glow = Math.min(100, amount)
        // glow半径可影响模糊程度，但video_filter目前未使用radius
        break

      case "vignette":
        params.vignette = Math.min(100, amount)
        break

      case "grain":
        params.grain = Math.min(100, amount)
        break

      case "lut-cinematic":
        params.preset = "cinematic"
        // 额外调整颜色参数
        params.contrast += 10
        params.saturation += 5
        params.temperature += 5
        break

      case "lut-vintage":
        params.preset = "vintage"
        params.temperature += 15
        params.saturation -= 8
        params.exposure -= 2
        break

      case "lut-bw":
        params.preset = "blackwhite"
        params.saturation = -100 // 黑白效果
        params.contrast += 15
        break

      case "lut-cool":
        params.temperature -= Math.min(100, (intensity / 100) * 20) // 冷色调
        params.saturation += 5
        break

      case "lut-warm":
        params.temperature += Math.min(100, (intensity / 100) * 20) // 暖色调
        params.saturation += 5
        break

      case "lut-muted":
        params.saturation -= Math.min(100, (intensity / 100) * 30) // 降低饱和度
        params.contrast -= 5
        break

      case "lut-vivid":
        params.saturation += Math.min(100, (intensity / 100) * 40) // 增加饱和度
        params.contrast += 10
        break
    }
  }

  // 限制参数范围
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value))

  if (params.brightness !== undefined)
    params.brightness = clamp(params.brightness, -100, 100)
  if (params.contrast !== undefined)
    params.contrast = clamp(params.contrast, -100, 100)
  if (params.saturation !== undefined)
    params.saturation = clamp(params.saturation, -100, 100)
  if (params.temperature !== undefined)
    params.temperature = clamp(params.temperature, -100, 100)
  if (params.tint !== undefined) params.tint = clamp(params.tint, -100, 100)
  if (params.exposure !== undefined)
    params.exposure = clamp(params.exposure, -100, 100)
  if (params.highlights !== undefined)
    params.highlights = clamp(params.highlights, -100, 100)
  if (params.shadows !== undefined)
    params.shadows = clamp(params.shadows, -100, 100)
  if (params.blur !== undefined) params.blur = clamp(params.blur, 0, 10)
  if (params.sharpen !== undefined) params.sharpen = clamp(params.sharpen, 0, 5)
  if (params.glow !== undefined) params.glow = clamp(params.glow, 0, 100)
  if (params.vignette !== undefined)
    params.vignette = clamp(params.vignette, 0, 100)
  if (params.grain !== undefined) params.grain = clamp(params.grain, 0, 100)

  return params
}

/**
 * 工具别名
 */
export const EffectPresetTool = EffectTemplateTool
