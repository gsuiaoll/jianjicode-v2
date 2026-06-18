/**
 * 颜色分级预设系统
 * 提供预设颜色分级样式，支持一键应用到视频
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
import type { ColorCorrection } from "../types/ltx-types.js"
import { Tool } from "./tool.js"

/**
 * 颜色分级预设定义
 */
export interface ColorGradingPreset {
  id: string
  name: string
  description: string
  category:
    | "film"
    | "cinematic"
    | "vintage"
    | "modern"
    | "warm"
    | "cool"
    | "dramatic"
    | "pastel"
    | "monochrome"
    | "custom"
  colorCorrection: ColorCorrection
  tags: string[]
  author?: string
  created?: string
  version?: string
}

/**
 * 预设模板库 - 内置颜色分级预设
 */
export const PRESET_COLOR_GRADING: ColorGradingPreset[] = [
  // 电影风格
  {
    id: "film_cinematic",
    name: "电影感",
    description: "电影感调色，增强对比度和饱和度，略微偏暖",
    category: "film",
    colorCorrection: {
      brightness: 5,
      contrast: 15,
      saturation: 10,
      temperature: 8,
      tint: -2,
      exposure: 3,
      highlights: -10,
      shadows: 5,
    },
    tags: ["cinematic", "movie", "film"],
  },
  {
    id: "film_teal_orange",
    name: "青橙色调",
    description: "好莱坞流行的青橙色调，增强冷暖对比",
    category: "film",
    colorCorrection: {
      brightness: 0,
      contrast: 20,
      saturation: 15,
      temperature: 10,
      tint: -15,
      exposure: 5,
      highlights: -5,
      shadows: 8,
    },
    tags: ["teal-orange", "hollywood", "color-grading"],
  },

  // 复古风格
  {
    id: "vintage_70s",
    name: "70年代复古",
    description: "70年代复古色调，暖黄色调，降低饱和度",
    category: "vintage",
    colorCorrection: {
      brightness: -5,
      contrast: 5,
      saturation: -20,
      temperature: 25,
      tint: 5,
      exposure: -3,
      highlights: -15,
      shadows: 10,
    },
    tags: ["vintage", "retro", "70s"],
  },
  {
    id: "vintage_film_grain",
    name: "胶片颗粒",
    description: "模拟胶片颗粒效果，轻微褪色",
    category: "vintage",
    colorCorrection: {
      brightness: 8,
      contrast: 10,
      saturation: -15,
      temperature: 12,
      tint: -3,
      exposure: -5,
      highlights: -20,
      shadows: 15,
    },
    tags: ["film-grain", "vintage", "analog"],
  },

  // 现代风格
  {
    id: "modern_clean",
    name: "现代清新",
    description: "现代清新色调，色彩鲜明，高对比度",
    category: "modern",
    colorCorrection: {
      brightness: 10,
      contrast: 25,
      saturation: 20,
      temperature: 5,
      tint: 0,
      exposure: 8,
      highlights: -8,
      shadows: 12,
    },
    tags: ["modern", "clean", "vibrant"],
  },
  {
    id: "modern_minimal",
    name: "极简主义",
    description: "极简主义色调，低饱和度，中性色彩",
    category: "modern",
    colorCorrection: {
      brightness: 15,
      contrast: 10,
      saturation: -30,
      temperature: 0,
      tint: 0,
      exposure: 5,
      highlights: -5,
      shadows: 8,
    },
    tags: ["minimal", "neutral", "muted"],
  },

  // 冷暖色调
  {
    id: "warm_sunset",
    name: "温暖日落",
    description: "温暖日落色调，橙色和金色调",
    category: "warm",
    colorCorrection: {
      brightness: 8,
      contrast: 15,
      saturation: 12,
      temperature: 35,
      tint: 8,
      exposure: 10,
      highlights: -5,
      shadows: 10,
    },
    tags: ["warm", "sunset", "golden-hour"],
  },
  {
    id: "cool_icy",
    name: "冰冷色调",
    description: "冰冷蓝色调，适合冬季或科技感视频",
    category: "cool",
    colorCorrection: {
      brightness: 10,
      contrast: 20,
      saturation: 5,
      temperature: -30,
      tint: -5,
      exposure: 5,
      highlights: -10,
      shadows: 5,
    },
    tags: ["cool", "icy", "blue", "tech"],
  },

  // 戏剧风格
  {
    id: "dramatic_high_contrast",
    name: "高对比戏剧",
    description: "高对比度戏剧性调色，增强阴影和高光",
    category: "dramatic",
    colorCorrection: {
      brightness: 0,
      contrast: 40,
      saturation: 5,
      temperature: 0,
      tint: 0,
      exposure: 0,
      highlights: -25,
      shadows: 20,
    },
    tags: ["dramatic", "high-contrast", "moody"],
  },
  {
    id: "dramatic_silhouette",
    name: "剪影风格",
    description: "剪影效果，降低中间调，增强阴影",
    category: "dramatic",
    colorCorrection: {
      brightness: -15,
      contrast: 30,
      saturation: -10,
      temperature: 5,
      tint: 0,
      exposure: -10,
      highlights: -15,
      shadows: 25,
    },
    tags: ["silhouette", "moody", "dark"],
  },

  // 柔色风格
  {
    id: "pastel_soft",
    name: "柔和粉彩",
    description: "柔和粉彩色调，降低饱和度，提高亮度",
    category: "pastel",
    colorCorrection: {
      brightness: 20,
      contrast: 5,
      saturation: -25,
      temperature: 10,
      tint: 5,
      exposure: 15,
      highlights: -10,
      shadows: 15,
    },
    tags: ["pastel", "soft", "dreamy"],
  },

  // 单色风格
  {
    id: "monochrome_bw",
    name: "黑白经典",
    description: "经典黑白调色，完全去色",
    category: "monochrome",
    colorCorrection: {
      brightness: 5,
      contrast: 25,
      saturation: -100,
      temperature: 0,
      tint: 0,
      exposure: 0,
      highlights: -15,
      shadows: 10,
    },
    tags: ["black-white", "monochrome", "classic"],
  },
  {
    id: "monochrome_sepia",
    name: "棕褐色调",
    description: "棕褐色调，复古单色效果",
    category: "monochrome",
    colorCorrection: {
      brightness: 10,
      contrast: 15,
      saturation: -100,
      temperature: 50,
      tint: 15,
      exposure: 5,
      highlights: -10,
      shadows: 8,
    },
    tags: ["sepia", "vintage", "monochrome"],
  },
]

/**
 * 获取预设存储目录
 */
function getPresetStorageDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd()
  const presetDir = join(homeDir, ".jianjicode", "color_presets")

  // 确保目录存在
  if (!existsSync(presetDir)) {
    mkdirSync(presetDir, { recursive: true })
  }

  return presetDir
}

/**
 * 保存预设到文件
 */
function savePresetToFile(preset: ColorGradingPreset): void {
  const presetDir = getPresetStorageDir()
  const filePath = join(presetDir, `${preset.id}.json`)

  // 添加创建时间戳
  const presetWithMeta = {
    ...preset,
    created: new Date().toISOString(),
    version: "1.0",
  }

  writeFileSync(filePath, JSON.stringify(presetWithMeta, null, 2))
}

/**
 * 从文件加载预设
 */
function loadPresetFromFile(presetId: string): ColorGradingPreset | null {
  const presetDir = getPresetStorageDir()
  const filePath = join(presetDir, `${presetId}.json`)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    return JSON.parse(content) as ColorGradingPreset
  } catch (error) {
    console.error(`加载预设 ${presetId} 失败:`, error)
    return null
  }
}

/**
 * 列出所有预设（内置 + 自定义）
 */
function listAllPresets(): {
  builtin: ColorGradingPreset[]
  custom: ColorGradingPreset[]
} {
  const builtin = PRESET_COLOR_GRADING

  // 加载自定义预设
  const presetDir = getPresetStorageDir()
  let customPresets: ColorGradingPreset[] = []

  try {
    const files = readdirSync(presetDir).filter((f) => f.endsWith(".json"))
    customPresets = files
      .map((file) => {
        try {
          const content = readFileSync(join(presetDir, file), "utf-8")
          return JSON.parse(content) as ColorGradingPreset
        } catch (error) {
          console.error(`解析预设文件 ${file} 失败:`, error)
          return null
        }
      })
      .filter((p): p is ColorGradingPreset => p !== null)
  } catch (error) {
    // 目录可能为空，忽略错误
  }

  return { builtin, custom: customPresets }
}

/**
 * 颜色分级预设工具
 */
export const ColorGradingPresetTool = Tool.defineLtxTool(
  "color_grading_preset",
  {
    description: "颜色分级预设系统 - 管理并应用预设颜色分级到视频",
    parameters: z.object({
      operation: z
        .enum([
          "list_presets",
          "apply_preset",
          "create_preset",
          "delete_preset",
          "export_preset",
          "import_preset",
          "preview_preset",
        ])
        .describe("操作类型"),

      // list_presets 参数
      filter_category: z
        .string()
        .optional()
        .describe("按分类筛选预设 (仅 list_presets 操作)"),
      show_details: z
        .boolean()
        .optional()
        .default(false)
        .describe("显示详细信息 (仅 list_presets 操作)"),

      // apply_preset 参数
      input: z
        .string()
        .optional()
        .describe("输入视频文件路径 (apply_preset 操作必需)"),
      preset_id: z
        .string()
        .optional()
        .describe("预设ID (apply_preset/create_preset 操作必需)"),
      output: z
        .string()
        .optional()
        .describe("输出文件路径 (apply_preset 操作可选)"),
      strength: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(100)
        .describe("预设应用强度 (0-100%, 默认100)"),

      // create_preset 参数
      name: z.string().optional().describe("预设名称 (create_preset 操作必需)"),
      description: z
        .string()
        .optional()
        .describe("预设描述 (create_preset 操作可选)"),
      category: z
        .enum([
          "film",
          "cinematic",
          "vintage",
          "modern",
          "warm",
          "cool",
          "dramatic",
          "pastel",
          "monochrome",
          "custom",
        ])
        .optional()
        .describe("预设分类 (create_preset 操作可选)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("标签列表 (create_preset 操作可选)"),

      // 颜色校正参数 (create_preset 操作必需，或直接应用于视频)
      brightness: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("亮度调整 (-100 到 +100)"),
      contrast: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("对比度调整 (-100 到 +100)"),
      saturation: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("饱和度调整 (-100 到 +100)"),
      temperature: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("色温调整 (-100 到 +100)"),
      tint: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("色调调整 (-100 到 +100)"),
      exposure: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("曝光调整 (-100 到 +100)"),
      highlights: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("高光调整 (-100 到 +100)"),
      shadows: z
        .number()
        .min(-100)
        .max(100)
        .optional()
        .describe("阴影调整 (-100 到 +100)"),

      // export/import 参数
      export_path: z
        .string()
        .optional()
        .describe("导出路径 (export_preset 操作可选)"),
      import_file: z
        .string()
        .optional()
        .describe("导入文件路径 (import_preset 操作必需)"),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("是否覆盖现有预设"),

      // preview 参数
      preview_image: z
        .string()
        .optional()
        .describe("预览图片路径 (preview_preset 操作可选)"),
    }),

    execute: async (args, ctx) => {
      try {
        switch (args.operation) {
          case "list_presets":
            return await handleListPresets(args)
          case "apply_preset":
            return await handleApplyPreset(args)
          case "create_preset":
            return await handleCreatePreset(args)
          case "delete_preset":
            return await handleDeletePreset(args)
          case "export_preset":
            return await handleExportPreset(args)
          case "import_preset":
            return await handleImportPreset(args)
          case "preview_preset":
            return await handlePreviewPreset(args)
          default:
            return {
              title: "未知操作",
              metadata: { operation: "color_grading_preset", error: true },
              output: `未知操作: ${args.operation}`,
            }
        }
      } catch (error: any) {
        return {
          title: "颜色分级预设操作失败",
          metadata: { operation: "color_grading_preset", error: true },
          output: `操作失败: ${error.message}`,
        }
      }
    },
  },
)

/**
 * 处理列出预设
 */
async function handleListPresets(args: any): Promise<any> {
  const { builtin, custom } = listAllPresets()

  let filteredBuiltin = builtin
  let filteredCustom = custom

  // 按分类筛选
  if (args.category) {
    filteredBuiltin = builtin.filter((p) => p.category === args.category)
    filteredCustom = custom.filter((p) => p.category === args.category)
  }

  let output = "🎨 **颜色分级预设库**\n\n"

  // 显示内置预设
  output += `### 内置预设 (${filteredBuiltin.length} 个)\n`
  if (filteredBuiltin.length === 0) {
    output += "无预设\n"
  } else {
    filteredBuiltin.forEach((preset) => {
      output += `- **${preset.name}** (\`${preset.id}\`)\n`
      if (args.show_details) {
        output += `  📝 ${preset.description}\n`
        output += `  🏷️ 分类: ${preset.category} | 标签: ${preset.tags.join(", ")}\n`
        output += `  🎨 参数: ${formatColorCorrection(preset.colorCorrection)}\n`
      } else {
        output += `  ${preset.description}\n`
      }
    })
  }

  // 显示自定义预设
  output += `\n### 自定义预设 (${filteredCustom.length} 个)\n`
  if (filteredCustom.length === 0) {
    output += "无自定义预设\n"
  } else {
    filteredCustom.forEach((preset) => {
      output += `- **${preset.name}** (\`${preset.id}\`)\n`
      if (args.show_details) {
        output += `  📝 ${preset.description}\n`
        output += `  🏷️ 分类: ${preset.category} | 作者: ${preset.author || "未知"}\n`
        output += `  🎨 参数: ${formatColorCorrection(preset.colorCorrection)}\n`
      } else {
        output += `  ${preset.description}\n`
      }
    })
  }

  output += `\n💡 使用 \`apply_preset\` 操作应用预设到视频`

  return {
    title: "颜色分级预设列表",
    metadata: {
      operation: "list_presets",
      error: false,
      success: true,
      builtin_count: filteredBuiltin.length,
      custom_count: filteredCustom.length,
    },
    output,
  }
}

/**
 * 处理应用预设
 */
async function handleApplyPreset(args: any): Promise<any> {
  // 验证输入
  if (!args.input) {
    return {
      title: "应用预设失败",
      metadata: { operation: "apply_preset", error: true },
      output: "❌ 请输入视频文件路径 (input 参数)",
    }
  }

  if (!args.preset_id) {
    return {
      title: "应用预设失败",
      metadata: { operation: "apply_preset", error: true },
      output: "❌ 请指定预设ID (preset_id 参数)",
    }
  }

  if (!existsSync(args.input)) {
    return {
      title: "应用预设失败",
      metadata: { operation: "apply_preset", error: true },
      output: `❌ 输入文件不存在: ${args.input}`,
    }
  }

  // 查找预设
  const allPresets = listAllPresets()
  const preset = [...allPresets.builtin, ...allPresets.custom].find(
    (p) => p.id === args.preset_id,
  )

  if (!preset) {
    return {
      title: "应用预设失败",
      metadata: { operation: "apply_preset", error: true },
      output: `❌ 找不到预设: ${args.preset_id}`,
    }
  }

  // 计算应用强度
  const strength = args.strength || 100
  const colorCorrection = applyPresetStrength(preset.colorCorrection, strength)

  // 构建输出路径
  const outputPath =
    args.output || `${args.input.replace(/\.[^/.]+$/, "")}_${preset.id}.mp4`

  // 调用 LTX 直接桥接工具应用颜色分级
  try {
    console.log(`[ColorPreset] 调用 LTX 直接桥接工具应用颜色预设`)

    // 准备 LTX 直接桥接参数
    const ltxArgs = {
      operation: "apply_color_preset" as const,
      input_path: args.input,
      preset_id: preset.id,
      strength: strength,
      output_path: outputPath,
      bridge_mode: "auto" as const,
      timeout: 30000,
    }

    console.log(`[ColorPreset] LTX 直接桥接参数:`, ltxArgs)

    // LTX 直接桥接工具已废弃，抛出异常由 catch 处理
    throw new Error("LTX direct bridge is no longer available. Please use the HTTP API instead.")

    if (!ltxResult.metadata?.success) {
      return {
        title: "预设应用失败",
        metadata: {
          operation: "apply_preset",
          error: true,
          success: false,
          input: args.input,
          output: outputPath,
          preset_id: preset.id,
          preset_name: preset.name,
          strength,
          color_correction: colorCorrection,
          ltx_error: ltxResult.output || "未知错误",
        },
        output:
          `❌ LTX 颜色分级失败: ${ltxResult.output || "未知错误"}\n` +
          `📁 输入: ${args.input}\n` +
          `🎨 预设: ${preset.name} (强度: ${strength}%)\n` +
          `📊 参数: ${formatColorCorrection(colorCorrection)}`,
      }
    }

    return {
      title: "预设应用成功",
      metadata: {
        operation: "apply_preset",
        error: false,
        success: true,
        input: args.input,
        output: ltxResult.metadata.output_path || outputPath,
        preset_id: preset.id,
        preset_name: preset.name,
        strength,
        color_correction: colorCorrection,
        ltx_result: ltxResult.metadata,
      },
      output:
        `✅ 预设 **${preset.name}** 应用成功 (强度: ${strength}%)\n` +
        `📁 输入: ${args.input}\n` +
        `📁 输出: ${ltxResult.metadata.output_path || outputPath}\n` +
        `🎨 颜色参数: ${formatColorCorrection(colorCorrection)}\n` +
        `⏱️ 操作: ${ltxResult.metadata.operation || "apply_color_preset"}`,
    }
  } catch (error: any) {
    return {
      title: "预设应用错误",
      metadata: {
        operation: "apply_preset",
        error: true,
        success: false,
        input: args.input,
        output: outputPath,
        preset_id: preset.id,
        preset_name: preset.name,
        strength,
        color_correction: colorCorrection,
      },
      output:
        `❌ 调用 LTX 直接桥接工具失败: ${error.message}\n` +
        `📁 输入: ${args.input}\n` +
        `🎨 预设: ${preset.name} (强度: ${strength}%)\n` +
        `📊 参数: ${formatColorCorrection(colorCorrection)}\n\n` +
        `💡 请确保 LTX 后端服务可用或 Python 桥接层配置正确`,
    }
  }
}

/**
 * 处理创建预设
 */
async function handleCreatePreset(args: any): Promise<any> {
  if (!args.preset_id) {
    return {
      title: "创建预设失败",
      metadata: { operation: "create_preset", error: true },
      output: "❌ 请指定预设ID (preset_id 参数)",
    }
  }

  if (!args.name) {
    return {
      title: "创建预设失败",
      metadata: { operation: "create_preset", error: true },
      output: "❌ 请指定预设名称 (name 参数)",
    }
  }

  // 检查预设ID是否已存在
  const allPresets = listAllPresets()
  const existing = [...allPresets.builtin, ...allPresets.custom].find(
    (p) => p.id === args.preset_id,
  )

  if (existing && !args.overwrite) {
    return {
      title: "创建预设失败",
      metadata: { operation: "create_preset", error: true },
      output:
        `❌ 预设ID已存在: ${args.preset_id}\n` +
        `使用 overwrite: true 覆盖现有预设`,
    }
  }

  // 验证颜色校正参数
  const colorCorrection: ColorCorrection = {
    brightness: args.brightness || 0,
    contrast: args.contrast || 0,
    saturation: args.saturation || 0,
    temperature: args.temperature || 0,
    tint: args.tint || 0,
    exposure: args.exposure || 0,
    highlights: args.highlights || 0,
    shadows: args.shadows || 0,
  }

  // 创建预设对象
  const preset: ColorGradingPreset = {
    id: args.preset_id,
    name: args.name,
    description: args.description || `自定义颜色分级预设: ${args.name}`,
    category: args.category || "custom",
    colorCorrection,
    tags: args.tags || ["custom"],
    author: "用户创建",
    created: new Date().toISOString(),
    version: "1.0",
  }

  // 保存预设
  savePresetToFile(preset)

  return {
    title: "预设创建成功",
    metadata: {
      operation: "create_preset",
      error: false,
      success: true,
      preset_id: preset.id,
      overwrite: !!existing,
    },
    output:
      `✅ 预设 **${preset.name}** 创建成功\n` +
      `📝 ID: \`${preset.id}\`\n` +
      `🏷️ 分类: ${preset.category}\n` +
      `🎨 颜色参数: ${formatColorCorrection(colorCorrection)}\n` +
      `📁 保存位置: ${getPresetStorageDir()}/${preset.id}.json`,
  }
}

/**
 * 处理删除预设
 */
async function handleDeletePreset(args: any): Promise<any> {
  if (!args.preset_id) {
    return {
      title: "删除预设失败",
      metadata: { operation: "delete_preset", error: true },
      output: "❌ 请指定预设ID (preset_id 参数)",
    }
  }

  // 检查是否为内置预设
  const builtinPreset = PRESET_COLOR_GRADING.find(
    (p) => p.id === args.preset_id,
  )
  if (builtinPreset) {
    return {
      title: "删除预设失败",
      metadata: { operation: "delete_preset", error: true },
      output:
        `❌ 无法删除内置预设: ${args.preset_id}\n` + `内置预设只能通过代码修改`,
    }
  }

  // 删除自定义预设
  const presetDir = getPresetStorageDir()
  const filePath = join(presetDir, `${args.preset_id}.json`)

  if (!existsSync(filePath)) {
    return {
      title: "删除预设失败",
      metadata: { operation: "delete_preset", error: true },
      output: `❌ 预设不存在: ${args.preset_id}`,
    }
  }

  unlinkSync(filePath)

  return {
    title: "预设删除成功",
    metadata: {
      operation: "delete_preset",
      error: false,
      success: true,
      preset_id: args.preset_id,
    },
    output: `✅ 预设 \`${args.preset_id}\` 删除成功`,
  }
}

/**
 * 处理导出预设
 */
async function handleExportPreset(args: any): Promise<any> {
  if (!args.preset_id) {
    return {
      title: "导出预设失败",
      metadata: { operation: "export_preset", error: true },
      output: "❌ 请指定预设ID (preset_id 参数)",
    }
  }

  // 查找预设
  const allPresets = listAllPresets()
  const preset = [...allPresets.builtin, ...allPresets.custom].find(
    (p) => p.id === args.preset_id,
  )

  if (!preset) {
    return {
      title: "导出预设失败",
      metadata: { operation: "export_preset", error: true },
      output: `❌ 找不到预设: ${args.preset_id}`,
    }
  }

  // 构建导出路径
  const exportPath =
    args.export_path || join(process.cwd(), `${preset.id}_color_preset.json`)

  // 导出预设
  writeFileSync(exportPath, JSON.stringify(preset, null, 2))

  return {
    title: "预设导出成功",
    metadata: {
      operation: "export_preset",
      error: false,
      success: true,
      preset_id: preset.id,
      export_path: exportPath,
    },
    output:
      `✅ 预设 **${preset.name}** 导出成功\n` +
      `📁 导出位置: ${exportPath}\n` +
      `💡 使用 \`import_preset\` 操作导入此预设`,
  }
}

/**
 * 处理导入预设
 */
async function handleImportPreset(args: any): Promise<any> {
  if (!args.import_file) {
    return {
      title: "导入预设失败",
      metadata: { operation: "import_preset", error: true },
      output: "❌ 请指定导入文件路径 (import_file 参数)",
    }
  }

  if (!existsSync(args.import_file)) {
    return {
      title: "导入预设失败",
      metadata: { operation: "import_preset", error: true },
      output: `❌ 导入文件不存在: ${args.import_file}`,
    }
  }

  try {
    // 读取并验证预设文件
    const content = readFileSync(args.import_file, "utf-8")
    const preset = JSON.parse(content) as ColorGradingPreset

    // 验证必要字段
    if (!preset.id || !preset.name || !preset.colorCorrection) {
      return {
        title: "导入预设失败",
        metadata: { operation: "import_preset", error: true },
        output: "❌ 预设文件格式无效，缺少必要字段",
      }
    }

    // 检查是否已存在
    const allPresets = listAllPresets()
    const existing = [...allPresets.builtin, ...allPresets.custom].find(
      (p) => p.id === preset.id,
    )

    if (existing && !args.overwrite) {
      return {
        title: "导入预设失败",
        metadata: { operation: "import_preset", error: true },
        output:
          `❌ 预设ID已存在: ${preset.id}\n` +
          `使用 overwrite: true 覆盖现有预设`,
      }
    }

    // 保存预设
    savePresetToFile(preset)

    return {
      title: "预设导入成功",
      metadata: {
        operation: "import_preset",
        error: false,
        success: true,
        preset_id: preset.id,
        overwrite: !!existing,
      },
      output:
        `✅ 预设 **${preset.name}** 导入成功\n` +
        `📝 ID: \`${preset.id}\`\n` +
        `🏷️ 分类: ${preset.category || "custom"}\n` +
        `📁 保存位置: ${getPresetStorageDir()}/${preset.id}.json`,
    }
  } catch (error: any) {
    return {
      title: "导入预设失败",
      metadata: { operation: "import_preset", error: true },
      output: `❌ 导入失败: ${error.message}`,
    }
  }
}

/**
 * 处理预览预设
 */
async function handlePreviewPreset(args: any): Promise<any> {
  if (!args.preset_id) {
    return {
      title: "预览预设失败",
      metadata: { operation: "preview_preset", error: true },
      output: "❌ 请指定预设ID (preset_id 参数)",
    }
  }

  // 查找预设
  const allPresets = listAllPresets()
  const preset = [...allPresets.builtin, ...allPresets.custom].find(
    (p) => p.id === args.preset_id,
  )

  if (!preset) {
    return {
      title: "预览预设失败",
      metadata: { operation: "preview_preset", error: true },
      output: `❌ 找不到预设: ${args.preset_id}`,
    }
  }

  // 生成预览文本
  let output = `🎨 **预设预览: ${preset.name}**\n\n`
  output += `📝 ${preset.description}\n`
  output += `🏷️ 分类: ${preset.category}\n`
  output += `🏷️ 标签: ${preset.tags.join(", ")}\n`
  if (preset.author) output += `👤 作者: ${preset.author}\n`
  if (preset.created)
    output += `📅 创建: ${new Date(preset.created).toLocaleString()}\n`

  output += `\n### 颜色校正参数\n`
  output += formatColorCorrectionTable(preset.colorCorrection)

  output += `\n### 效果描述\n`
  output += getPresetEffectDescription(preset)

  if (args.preview_image) {
    output += `\n💡 预览图片: ${args.preview_image}\n`
    output += `   使用 \`apply_preset\` 操作实际应用效果`
  }

  return {
    title: "预设预览",
    metadata: {
      operation: "preview_preset",
      error: false,
      success: true,
      preset_id: preset.id,
    },
    output,
  }
}

/**
 * 应用预设强度
 */
function applyPresetStrength(
  correction: ColorCorrection,
  strength: number,
): ColorCorrection {
  const factor = strength / 100
  return {
    brightness: correction.brightness * factor,
    contrast: correction.contrast * factor,
    saturation: correction.saturation * factor,
    temperature: correction.temperature * factor,
    tint: correction.tint * factor,
    exposure: correction.exposure * factor,
    highlights: correction.highlights * factor,
    shadows: correction.shadows * factor,
  }
}

/**
 * 格式化颜色校正参数为字符串
 */
function formatColorCorrection(correction: ColorCorrection): string {
  const parts: string[] = []

  if (correction.brightness !== 0)
    parts.push(`亮度: ${formatValue(correction.brightness)}`)
  if (correction.contrast !== 0)
    parts.push(`对比度: ${formatValue(correction.contrast)}`)
  if (correction.saturation !== 0)
    parts.push(`饱和度: ${formatValue(correction.saturation)}`)
  if (correction.temperature !== 0)
    parts.push(`色温: ${formatValue(correction.temperature)}`)
  if (correction.tint !== 0) parts.push(`色调: ${formatValue(correction.tint)}`)
  if (correction.exposure !== 0)
    parts.push(`曝光: ${formatValue(correction.exposure)}`)
  if (correction.highlights !== 0)
    parts.push(`高光: ${formatValue(correction.highlights)}`)
  if (correction.shadows !== 0)
    parts.push(`阴影: ${formatValue(correction.shadows)}`)

  return parts.length > 0 ? parts.join(", ") : "默认值 (无调整)"
}

/**
 * 格式化颜色校正参数为表格
 */
function formatColorCorrectionTable(correction: ColorCorrection): string {
  return `
| 参数 | 值 | 效果 |
|------|-----|------|
| 亮度 | ${formatValue(correction.brightness)} | ${correction.brightness > 0 ? "变亮" : correction.brightness < 0 ? "变暗" : "不变"} |
| 对比度 | ${formatValue(correction.contrast)} | ${correction.contrast > 0 ? "增强" : correction.contrast < 0 ? "减弱" : "不变"} |
| 饱和度 | ${formatValue(correction.saturation)} | ${correction.saturation > 0 ? "增强" : correction.saturation < 0 ? "减弱" : "不变"} |
| 色温 | ${formatValue(correction.temperature)} | ${correction.temperature > 0 ? "暖色调" : correction.temperature < 0 ? "冷色调" : "中性"} |
| 色调 | ${formatValue(correction.tint)} | ${correction.tint > 0 ? "偏品红" : correction.tint < 0 ? "偏绿" : "中性"} |
| 曝光 | ${formatValue(correction.exposure)} | ${correction.exposure > 0 ? "增加" : correction.exposure < 0 ? "减少" : "不变"} |
| 高光 | ${formatValue(correction.highlights)} | ${correction.highlights > 0 ? "增强" : correction.highlights < 0 ? "减弱" : "不变"} |
| 阴影 | ${formatValue(correction.shadows)} | ${correction.shadows > 0 ? "提亮" : correction.shadows < 0 ? "压暗" : "不变"} |
`
}

/**
 * 格式化数值（带正负号）
 */
function formatValue(value: number): string {
  return `${value > 0 ? "+" : ""}${value}`
}

/**
 * 获取预设效果描述
 */
function getPresetEffectDescription(preset: ColorGradingPreset): string {
  const cc = preset.colorCorrection
  let description = ""

  // 总体效果
  if (cc.saturation <= -80) {
    description += "• 单色/黑白效果\n"
  } else if (cc.saturation <= -30) {
    description += "• 低饱和度，柔色效果\n"
  } else if (cc.saturation >= 20) {
    description += "• 高饱和度，鲜艳色彩\n"
  }

  if (cc.contrast >= 30) {
    description += "• 高对比度，强烈视觉冲击\n"
  } else if (cc.contrast >= 15) {
    description += "• 中等对比度，增强层次感\n"
  } else if (cc.contrast <= -15) {
    description += "• 低对比度，柔和过渡\n"
  }

  if (cc.temperature >= 20) {
    description += "• 温暖色调，橙色/金色倾向\n"
  } else if (cc.temperature <= -20) {
    description += "• 冷色调，蓝色/青色倾向\n"
  }

  if (cc.highlights <= -15 && cc.shadows >= 15) {
    description += "• 高光压缩，阴影提亮，电影感色调\n"
  }

  if (cc.brightness >= 15) {
    description += "• 整体明亮，清新感觉\n"
  } else if (cc.brightness <= -15) {
    description += "• 整体较暗，氛围感强\n"
  }

  if (description === "") {
    description = "• 轻微调整，保持自然外观\n"
  }

  return description
}

/**
 * 工具别名
 */
export const ColorPresetTool = ColorGradingPresetTool
