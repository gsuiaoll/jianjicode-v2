/**
 * 专业字幕模板系统
 * 提供预设字幕样式模板，支持一键应用
 */

import { existsSync, readFileSync, writeFileSync } from "fs"
import { basename, dirname, join } from "path"
import z from "zod"
import { Tool } from "./tool.js"

/**
 * 字幕模板定义
 */
export interface SubtitleTemplate {
  id: string
  name: string
  description: string
  category:
    | "film"
    | "social"
    | "news"
    | "corporate"
    | "creative"
    | "minimal"
    | "animated"
  font: {
    name: string
    size: number
    color: string // hex
    bold: boolean
    italic: boolean
  }
  border: {
    width: number
    color: string // hex
  }
  background: {
    color: string // hex with alpha
    padding: number // pixels
  }
  position: "bottom" | "top" | "middle"
  alignment: "center" | "left" | "right"
  margins: {
    vertical: number
    horizontal: number
  }
  animation?: {
    type: "fade" | "slide" | "typewriter" | "zoom" | "none"
    duration: number // seconds
    easing: string
  }
  tags: string[]
}

/**
 * 预设模板库
 */
export const PRESET_TEMPLATES: SubtitleTemplate[] = [
  // 电影风格模板
  {
    id: "film_classic",
    name: "经典电影",
    description: "传统电影字幕样式，白色字体，黑色边框，底部居中",
    category: "film",
    font: {
      name: "Arial",
      size: 32,
      color: "FFFFFF",
      bold: true,
      italic: false,
    },
    border: { width: 2, color: "000000" },
    background: { color: "00000000", padding: 0 },
    position: "bottom",
    alignment: "center",
    margins: { vertical: 50, horizontal: 100 },
    tags: ["movie", "cinematic", "classic"],
  },
  {
    id: "film_modern",
    name: "现代电影",
    description: "现代电影字幕样式，简约设计",
    category: "film",
    font: {
      name: "Helvetica",
      size: 28,
      color: "F5F5F5",
      bold: false,
      italic: false,
    },
    border: { width: 1, color: "333333" },
    background: { color: "00000040", padding: 10 },
    position: "bottom",
    alignment: "center",
    margins: { vertical: 40, horizontal: 80 },
    tags: ["modern", "minimal", "cinematic"],
  },

  // 社交媒体风格
  {
    id: "social_bold",
    name: "社交媒体粗体",
    description: "适合短视频平台的醒目字幕",
    category: "social",
    font: {
      name: "Impact",
      size: 36,
      color: "FFFFFF",
      bold: true,
      italic: false,
    },
    border: { width: 3, color: "000000" },
    background: { color: "00000080", padding: 15 },
    position: "bottom",
    alignment: "center",
    margins: { vertical: 30, horizontal: 50 },
    animation: { type: "fade", duration: 0.5, easing: "linear" },
    tags: ["social", "bold", "captions"],
  },
  {
    id: "social_elegant",
    name: "优雅社交",
    description: "优雅的社交媒体字幕，适合美妆、生活类视频",
    category: "social",
    font: {
      name: "Georgia",
      size: 30,
      color: "FFD700",
      bold: false,
      italic: true,
    },
    border: { width: 1, color: "8B4513" },
    background: { color: "00000020", padding: 20 },
    position: "top",
    alignment: "center",
    margins: { vertical: 60, horizontal: 40 },
    tags: ["elegant", "lifestyle", "beauty"],
  },

  // 新闻标题风格
  {
    id: "news_broadcast",
    name: "新闻播报",
    description: "新闻节目风格字幕，清晰易读",
    category: "news",
    font: {
      name: "Arial",
      size: 34,
      color: "FFFFFF",
      bold: true,
      italic: false,
    },
    border: { width: 0, color: "000000" },
    background: { color: "1E3A8A", padding: 12 },
    position: "bottom",
    alignment: "left",
    margins: { vertical: 20, horizontal: 40 },
    tags: ["news", "broadcast", "clear"],
  },
  {
    id: "news_ticker",
    name: "新闻跑马灯",
    description: "底部滚动新闻字幕",
    category: "news",
    font: {
      name: "Arial",
      size: 28,
      color: "FFFFFF",
      bold: false,
      italic: false,
    },
    border: { width: 0, color: "000000" },
    background: { color: "000000CC", padding: 8 },
    position: "bottom",
    alignment: "left",
    margins: { vertical: 10, horizontal: 0 },
    animation: { type: "slide", duration: 10, easing: "linear" },
    tags: ["news", "ticker", "scrolling"],
  },

  // 企业风格
  {
    id: "corporate_clean",
    name: "企业简洁",
    description: "企业视频使用的专业简洁字幕",
    category: "corporate",
    font: {
      name: "Calibri",
      size: 26,
      color: "333333",
      bold: false,
      italic: false,
    },
    border: { width: 0, color: "000000" },
    background: { color: "FFFFFFCC", padding: 15 },
    position: "bottom",
    alignment: "center",
    margins: { vertical: 40, horizontal: 60 },
    tags: ["corporate", "professional", "clean"],
  },
  {
    id: "corporate_brand",
    name: "品牌主题",
    description: "可自定义品牌颜色的字幕模板",
    category: "corporate",
    font: {
      name: "Montserrat",
      size: 28,
      color: "FFFFFF",
      bold: true,
      italic: false,
    },
    border: { width: 0, color: "000000" },
    background: { color: "1E40AFCC", padding: 20 },
    position: "middle",
    alignment: "center",
    margins: { vertical: 0, horizontal: 0 },
    tags: ["brand", "corporate", "modern"],
  },

  // 创意风格
  {
    id: "creative_handwritten",
    name: "手写风格",
    description: "模拟手写效果的字幕",
    category: "creative",
    font: {
      name: "Comic Sans MS",
      size: 32,
      color: "8B4513",
      bold: false,
      italic: true,
    },
    border: { width: 0, color: "000000" },
    background: { color: "F5DEB380", padding: 25 },
    position: "middle",
    alignment: "center",
    margins: { vertical: 0, horizontal: 0 },
    tags: ["creative", "handwritten", "fun"],
  },
  {
    id: "creative_glow",
    name: "霓虹发光",
    description: "霓虹发光效果字幕，适合音乐视频",
    category: "creative",
    font: {
      name: "Arial Black",
      size: 38,
      color: "FF00FF",
      bold: true,
      italic: false,
    },
    border: { width: 4, color: "00FFFF" },
    background: { color: "00000000", padding: 0 },
    position: "bottom",
    alignment: "center",
    margins: { vertical: 50, horizontal: 50 },
    animation: { type: "fade", duration: 0.8, easing: "ease-in-out" },
    tags: ["creative", "neon", "music"],
  },

  // 极简风格
  {
    id: "minimal_clean",
    name: "极简清洁",
    description: "极简主义字幕，几乎无装饰",
    category: "minimal",
    font: {
      name: "Helvetica Neue",
      size: 24,
      color: "FFFFFF",
      bold: false,
      italic: false,
    },
    border: { width: 0, color: "000000" },
    background: { color: "00000000", padding: 0 },
    position: "bottom",
    alignment: "center",
    margins: { vertical: 30, horizontal: 30 },
    tags: ["minimal", "clean", "simple"],
  },
  {
    id: "minimal_transparent",
    name: "透明极简",
    description: "半透明背景的极简字幕",
    category: "minimal",
    font: {
      name: "Arial",
      size: 26,
      color: "FFFFFF",
      bold: true,
      italic: false,
    },
    border: { width: 0, color: "000000" },
    background: { color: "00000080", padding: 10 },
    position: "top",
    alignment: "left",
    margins: { vertical: 20, horizontal: 20 },
    tags: ["minimal", "transparent", "modern"],
  },

  // 动画风格
  {
    id: "animated_typewriter",
    name: "打字机效果",
    description: "模拟打字机逐字出现效果",
    category: "animated",
    font: {
      name: "Courier New",
      size: 30,
      color: "FFFFFF",
      bold: false,
      italic: false,
    },
    border: { width: 1, color: "000000" },
    background: { color: "000000CC", padding: 15 },
    position: "middle",
    alignment: "center",
    margins: { vertical: 0, horizontal: 0 },
    animation: { type: "typewriter", duration: 2, easing: "step" },
    tags: ["animated", "typewriter", "vintage"],
  },
  {
    id: "animated_slide",
    name: "滑动入场",
    description: "字幕从屏幕外滑入",
    category: "animated",
    font: {
      name: "Arial",
      size: 32,
      color: "FFFFFF",
      bold: true,
      italic: false,
    },
    border: { width: 2, color: "000000" },
    background: { color: "1E3A8ACC", padding: 20 },
    position: "bottom",
    alignment: "center",
    margins: { vertical: 40, horizontal: 0 },
    animation: { type: "slide", duration: 1, easing: "ease-out" },
    tags: ["animated", "slide", "dynamic"],
  },
]

/**
 * 专业字幕模板工具
 */
export const ProfessionalSubtitleTemplateTool = Tool.define(
  "professional_subtitle_template",
  {
    description: "专业字幕模板系统 - 提供预设字幕样式模板，支持一键应用",
    parameters: z.object({
      // 操作模式
      operation: z
        .enum([
          "list_templates",
          "apply_template",
          "create_template",
          "export_template",
          "preview_template",
        ])
        .describe(
          "操作类型: list_templates=列出模板, apply_template=应用模板, create_template=创建模板, export_template=导出模板, preview_template=预览模板",
        ),

      // 模板应用参数
      template_id: z
        .string()
        .optional()
        .describe("模板ID (从list_templates获取)"),
      input: z
        .string()
        .optional()
        .describe("输入视频文件路径 (应用模板时必需)"),
      subtitle_file: z
        .string()
        .optional()
        .describe("字幕文件路径 (SRT/ASS格式，如不提供则使用示例文本)"),
      output: z
        .string()
        .optional()
        .describe("输出文件路径 (默认: <input>_templated.<ext>)"),
      text_content: z
        .string()
        .optional()
        .describe("字幕文本内容 (多行用\\n分隔，如不提供则使用示例)"),
      duration_seconds: z
        .number()
        .optional()
        .default(5)
        .describe("每个字幕片段持续时间 (秒)"),

      // 模板创建参数
      template_name: z
        .string()
        .optional()
        .describe("模板名称 (创建模板时必需)"),
      template_category: z
        .enum([
          "film",
          "social",
          "news",
          "corporate",
          "creative",
          "minimal",
          "animated",
        ])
        .optional()
        .describe("模板分类"),
      font_name: z.string().optional().describe("字体名称"),
      font_size: z.number().optional().describe("字体大小"),
      font_color: z.string().optional().describe("字体颜色 (十六进制)"),
      border_width: z.number().optional().describe("边框宽度"),
      border_color: z.string().optional().describe("边框颜色 (十六进制)"),
      background_color: z
        .string()
        .optional()
        .describe("背景颜色 (十六进制，可含透明度)"),
      position: z
        .enum(["bottom", "top", "middle"])
        .optional()
        .describe("字幕位置"),
      alignment: z
        .enum(["center", "left", "right"])
        .optional()
        .describe("对齐方式"),

      // 输出选项
      output_format: z
        .enum(["video", "ass_file", "srt_file", "json"])
        .optional()
        .default("video")
        .describe(
          "输出格式: video=带字幕的视频, ass_file=ASS格式文件, srt_file=SRT格式文件, json=模板配置JSON",
        ),
    }),

    execute: async (args: any, ctx: any) => {
      try {
        switch (args.operation) {
          case "list_templates":
            return await listTemplates(args)
          case "apply_template":
            return await applyTemplate(args)
          case "create_template":
            return await createTemplate(args)
          case "export_template":
            return await exportTemplate(args)
          case "preview_template":
            return await previewTemplate(args)
          default:
            return {
              title: "未知操作",
              metadata: { operation: args.operation, error: true },
              output: `❌ 不支持的操作: ${args.operation}`,
            }
        }
      } catch (error: any) {
        return {
          title: "字幕模板操作失败",
          metadata: { operation: args.operation, error: true },
          output: `❌ 操作失败: ${error.message}`,
        }
      }
    },
  },
)

/**
 * 列出所有模板
 */
async function listTemplates(args: any): Promise<any> {
  const category = args.template_category
  const filteredTemplates = category
    ? PRESET_TEMPLATES.filter((t) => t.category === category)
    : PRESET_TEMPLATES

  let output = `# 专业字幕模板库\n\n`
  output += `**总模板数**: ${filteredTemplates.length}\n`
  if (category) {
    output += `**分类**: ${category}\n`
  }
  output += "\n"

  // 按分类分组
  const byCategory: Record<string, SubtitleTemplate[]> = {}
  filteredTemplates.forEach((template) => {
    if (!byCategory[template.category]) {
      byCategory[template.category] = []
    }
    byCategory[template.category].push(template)
  })

  for (const [cat, templates] of Object.entries(byCategory)) {
    const categoryName = getCategoryDisplayName(cat)
    output += `## ${categoryName} (${templates.length})\n\n`

    templates.forEach((template) => {
      output += `### ${template.name}\n`
      output += `- **ID**: \`${template.id}\`\n`
      output += `- **描述**: ${template.description}\n`
      output += `- **字体**: ${template.font.name} ${template.font.size}px，颜色: #${template.font.color}\n`
      output += `- **位置**: ${template.position}，对齐: ${template.alignment}\n`
      if (template.animation) {
        output += `- **动画**: ${template.animation.type} (${template.animation.duration}s)\n`
      }
      output += `- **标签**: ${template.tags.join(", ")}\n\n`
    })
  }

  output += `\n## 使用说明\n`
  output += `1. 使用 \`apply_template\` 操作应用模板，指定 \`template_id\`\n`
  output += `2. 使用 \`create_template\` 创建自定义模板\n`
  output += `3. 使用 \`preview_template\` 预览模板效果\n`

  return {
    title: "字幕模板列表",
    metadata: {
      operation: "list_templates",
      success: true,
      total_templates: filteredTemplates.length,
      categories: Object.keys(byCategory),
    },
    output,
  }
}

/**
 * 应用模板到视频
 */
async function applyTemplate(args: any): Promise<any> {
  const templateId = args.template_id
  if (!templateId) {
    return {
      title: "应用模板失败",
      metadata: { operation: "apply_template", error: true },
      output: "❌ 必须指定 template_id 参数",
    }
  }

  const template = PRESET_TEMPLATES.find((t) => t.id === templateId)
  if (!template) {
    return {
      title: "应用模板失败",
      metadata: { operation: "apply_template", error: true },
      output: `❌ 找不到模板: ${templateId}`,
    }
  }

  // 检查输入文件
  if (args.input && !existsSync(args.input)) {
    return {
      title: "应用模板失败",
      metadata: { operation: "apply_template", error: true },
      output: `❌ 输入视频文件不存在: ${args.input}`,
    }
  }

  // 初始化元数据
  const metadata: any = {
    operation: "apply_template",
    success: true,
    template_id: templateId,
    subtitle_file: null as string | null,
    template: template,
  }

  // 生成字幕文件
  const subtitleContent =
    args.text_content || "示例字幕文本\\n这是专业字幕模板系统的演示"
  const subtitleLines = subtitleContent
    .split("\\n")
    .filter((line: string) => line.trim())

  // 创建临时字幕文件
  const subtitleExt = args.output_format === "ass_file" ? "ass" : "srt"
  const subtitlePath =
    args.subtitle_file || `temp_subtitle_${templateId}.${subtitleExt}`

  if (subtitleExt === "ass") {
    generateAssFile(
      subtitlePath,
      subtitleLines,
      template,
      args.duration_seconds || 5,
    )
  } else {
    generateSrtFile(subtitlePath, subtitleLines, args.duration_seconds || 5)
  }

  // 更新元数据
  metadata.subtitle_file = subtitlePath

  let output = `# 模板应用成功\n\n`
  output += `**模板**: ${template.name} (${template.id})\n`
  output += `**描述**: ${template.description}\n\n`

  output += `## 应用参数\n`
  if (args.input) {
    output += `- **输入视频**: ${args.input}\n`
  }
  output += `- **字幕文件**: ${subtitlePath}\n`
  output += `- **字幕文本**: ${subtitleLines.length} 行\n`
  output += `- **每段时长**: ${args.duration_seconds || 5} 秒\n\n`

  output += `## 模板样式\n`
  output += `- **字体**: ${template.font.name} ${template.font.size}px，颜色: #${template.font.color}\n`
  output += `- **边框**: 宽度 ${template.border.width}px，颜色: #${template.border.color}\n`
  output += `- **背景**: #${template.background.color}，内边距: ${template.background.padding}px\n`
  output += `- **位置**: ${template.position}，对齐: ${template.alignment}\n`
  output += `- **边距**: 垂直 ${template.margins.vertical}px，水平 ${template.margins.horizontal}px\n`
  if (template.animation) {
    output += `- **动画**: ${template.animation.type}，时长: ${template.animation.duration}s\n`
  }

  // 如果指定了输入视频，调用 LTX 直接桥接工具
  if (args.input && args.output_format === "video") {
    output += `\n## 视频处理\n`
    output += `正在应用字幕到视频...\n`

    try {
      // 将模板样式转换为 LTX 字幕样式
      const subtitleStyle = convertTemplateToStyle(template)

      // 调用 LTX 直接桥接工具
      const ltxArgs = {
        operation: "add_subtitle" as const,
        input_path: args.input,
        output_path:
          args.output || `${args.input.replace(/\.[^/.]+$/, "")}_subtitled.mp4`,
        subtitle_text: subtitleLines.join("\\n"),
        subtitle_start_time: 0,
        subtitle_end_time: args.duration_seconds || 5,
        subtitle_style: subtitleStyle,
        bridge_mode: "auto" as const,
        timeout: 30000,
      }

      // LTX 直接桥接工具已废弃
      throw new Error("LTX direct bridge is no longer available. Please use the HTTP API instead.")

      if (ltxResult.metadata?.success) {
        output += `\n✅ 字幕已成功应用到视频:\n`
        output += `- **输出文件**: ${ltxResult.metadata.output_path || "未知"}\n`
        output += `- **操作**: ${ltxResult.metadata.operation || "add_subtitle"}\n`

        // 更新返回的元数据
        metadata.ltx_result = ltxResult.metadata
        metadata.output_path = ltxResult.metadata.output_path
      } else {
        output += `\n⚠️ 字幕应用过程中出现问题:\n`
        output += `- **错误**: ${ltxResult.output || "未知错误"}\n`
        output += `\n💡 您可以手动使用以下命令:\n\`\`\`\n`
        output += `ltx_direct operation=add_subtitle input_path="${args.input}" `
        output += `subtitle_text="${subtitleLines.join("\\\\n")}" `
        output += `subtitle_start_time=0 subtitle_end_time=${args.duration_seconds || 5} `
        output += `output_path="${args.output || "output.mp4"}"\n`
        output += `\`\`\``
      }
    } catch (error: any) {
      output += `\n❌ 调用 LTX 桥接工具失败: ${error.message}\n`
      output += `\n💡 请确保 LTX 后端服务可用，或使用备用方法。\n`
    }
  }

  return {
    title: `模板应用成功: ${template.name}`,
    metadata: metadata,
    output,
  }
}

/**
 * 创建自定义模板
 */
async function createTemplate(args: any): Promise<any> {
  const name = args.template_name
  if (!name) {
    return {
      title: "创建模板失败",
      metadata: { operation: "create_template", error: true },
      output: "❌ 必须指定 template_name 参数",
    }
  }

  // 生成模板ID
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "_")

  const newTemplate: SubtitleTemplate = {
    id,
    name,
    description: args.template_description || `自定义模板: ${name}`,
    category: args.template_category || "creative",
    font: {
      name: args.font_name || "Arial",
      size: args.font_size || 24,
      color: args.font_color || "FFFFFF",
      bold: args.font_bold || false,
      italic: args.font_italic || false,
    },
    border: {
      width: args.border_width || 1,
      color: args.border_color || "000000",
    },
    background: {
      color: args.background_color || "00000080",
      padding: args.background_padding || 10,
    },
    position: args.position || "bottom",
    alignment: args.alignment || "center",
    margins: {
      vertical: args.margin_vertical || 30,
      horizontal: args.margin_horizontal || 30,
    },
    animation: args.animation_type
      ? {
          type: args.animation_type,
          duration: args.animation_duration || 1,
          easing: args.animation_easing || "linear",
        }
      : undefined,
    tags: args.tags ? args.tags.split(",") : ["custom"],
  }

  let output = `# 自定义模板创建成功\n\n`
  output += `**模板ID**: \`${id}\`\n`
  output += `**名称**: ${name}\n`
  output += `**分类**: ${newTemplate.category}\n\n`

  output += `## 模板配置\n`
  output += JSON.stringify(newTemplate, null, 2)

  // 保存模板到文件
  const templateDir = join(process.cwd(), "templates", "subtitles")
  const fs = await import("fs")
  if (!existsSync(templateDir)) {
    fs.mkdirSync(templateDir, { recursive: true })
  }

  const templatePath = join(templateDir, `${id}.json`)
  writeFileSync(templatePath, JSON.stringify(newTemplate, null, 2))

  output += `\n\n📁 模板已保存至: ${templatePath}`

  return {
    title: `自定义模板创建成功: ${name}`,
    metadata: {
      operation: "create_template",
      success: true,
      template_id: id,
      template_path: templatePath,
    },
    output,
  }
}

/**
 * 导出模板
 */
async function exportTemplate(args: any): Promise<any> {
  // 简化实现
  return {
    title: "模板导出",
    metadata: { operation: "export_template", success: true },
    output: "模板导出功能正在开发中",
  }
}

/**
 * 预览模板
 */
async function previewTemplate(args: any): Promise<any> {
  const templateId = args.template_id
  if (!templateId) {
    return {
      title: "预览模板失败",
      metadata: { operation: "preview_template", error: true },
      output: "❌ 必须指定 template_id 参数",
    }
  }

  const template = PRESET_TEMPLATES.find((t) => t.id === templateId)
  if (!template) {
    return {
      title: "预览模板失败",
      metadata: { operation: "preview_template", error: true },
      output: `❌ 找不到模板: ${templateId}`,
    }
  }

  // 生成预览图像或HTML
  let output = `# 模板预览: ${template.name}\n\n`
  output += `**ID**: ${template.id}\n`
  output += `**分类**: ${getCategoryDisplayName(template.category)}\n`
  output += `**描述**: ${template.description}\n\n`

  output += `## 样式预览\n`
  output += `\`\`\`\n`
  output += `字体: ${template.font.name} ${template.font.size}px\n`
  output += `颜色: #${template.font.color} ${template.font.bold ? "粗体" : ""} ${template.font.italic ? "斜体" : ""}\n`
  output += `边框: ${template.border.width}px #${template.border.color}\n`
  output += `背景: #${template.background.color} (内边距: ${template.background.padding}px)\n`
  output += `位置: ${template.position}，对齐: ${template.alignment}\n`
  output += `边距: 垂直 ${template.margins.vertical}px，水平 ${template.margins.horizontal}px\n`
  if (template.animation) {
    output += `动画: ${template.animation.type}，时长: ${template.animation.duration}s，缓动: ${template.animation.easing}\n`
  }
  output += `\`\`\`\n\n`

  output += `## 示例效果\n`
  output += `> "这是一段示例字幕文本\\n展示模板的实际效果"`

  // 生成预览命令
  output += `\n\n## 应用此模板\n`
  output += `\`\`\`\n`
  output += `professional_subtitle_template operation="apply_template" template_id="${templateId}" `
  output += `input="your_video.mp4" text_content="你的字幕文本"\n`
  output += `\`\`\``

  return {
    title: `模板预览: ${template.name}`,
    metadata: {
      operation: "preview_template",
      success: true,
      template_id: templateId,
      template: template,
    },
    output,
  }
}

/**
 * 生成ASS字幕文件
 */
function generateAssFile(
  outputPath: string,
  lines: string[],
  template: SubtitleTemplate,
  durationPerLine: number,
): void {
  let assContent = "[Script Info]\n"
  assContent += `Title: ${template.name} Template\n`
  assContent += "ScriptType: v4.00+\n"
  assContent += "Collisions: Normal\n"
  assContent += "PlayDepth: 0\n"
  assContent += "PlayResX: 1920\n"
  assContent += "PlayResY: 1080\n"
  assContent += "\n"

  // 样式定义
  assContent += "[V4+ Styles]\n"
  assContent +=
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"

  const primaryColor = hexToAssColor(template.font.color, "FF")
  const outlineColor = hexToAssColor(template.border.color, "FF")
  const backColor = hexToAssColor(
    template.background.color.substring(0, 6),
    template.background.color.length === 8
      ? template.background.color.substring(6, 8)
      : "80",
  )

  let alignment = 2
  if (template.position === "bottom") {
    if (template.alignment === "center") alignment = 2
    else if (template.alignment === "left") alignment = 1
    else if (template.alignment === "right") alignment = 3
  } else if (template.position === "top") {
    if (template.alignment === "center") alignment = 8
    else if (template.alignment === "left") alignment = 7
    else if (template.alignment === "right") alignment = 9
  } else if (template.position === "middle") {
    if (template.alignment === "center") alignment = 5
    else if (template.alignment === "left") alignment = 4
    else if (template.alignment === "right") alignment = 6
  }

  assContent += `Style: Default,${template.font.name},${template.font.size},`
  assContent += `${primaryColor},${primaryColor},${outlineColor},${backColor},`
  assContent += `${template.font.bold ? "1" : "0"},${template.font.italic ? "1" : "0"},0,0,100,100,0,0,`
  assContent += `1,${template.border.width},0,${alignment},`
  assContent += `${template.margins.horizontal},${template.margins.horizontal},${template.margins.vertical},1\n`
  assContent += "\n"

  // 事件
  assContent += "[Events]\n"
  assContent +=
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"

  let startTime = 0
  lines.forEach((line, index) => {
    const endTime = startTime + durationPerLine
    const startStr = formatTime(startTime)
    const endStr = formatTime(endTime)

    assContent += `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${line}\n`
    startTime = endTime + 0.5 // 间隔0.5秒
  })

  writeFileSync(outputPath, assContent, "utf8")
}

/**
 * 生成SRT字幕文件
 */
function generateSrtFile(
  outputPath: string,
  lines: string[],
  durationPerLine: number,
): void {
  let srtContent = ""
  let startTime = 0

  lines.forEach((line, index) => {
    const endTime = startTime + durationPerLine
    const startStr = formatTimeSrt(startTime)
    const endStr = formatTimeSrt(endTime)

    srtContent += `${index + 1}\n`
    srtContent += `${startStr} --> ${endStr}\n`
    srtContent += `${line}\n\n`

    startTime = endTime + 0.5 // 间隔0.5秒
  })

  writeFileSync(outputPath, srtContent, "utf8")
}

/**
 * 格式化时间为ASS格式 (H:MM:SS.cc)
 */
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100)
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`
}

/**
 * 格式化时间为SRT格式 (HH:MM:SS,mmm)
 */
function formatTimeSrt(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`
}

/**
 * 十六进制颜色转换为ASS颜色格式 (&HAABBGGRR)
 */
function hexToAssColor(hexColor: string, alphaHex: string = "FF"): string {
  if (!hexColor || typeof hexColor !== "string" || hexColor.length !== 6) {
    return "&H00FFFFFF"
  }

  const rr = hexColor.substring(0, 2)
  const gg = hexColor.substring(2, 4)
  const bb = hexColor.substring(4, 6)
  return `&H${alphaHex}${bb}${gg}${rr}`
}

/**
 * 获取分类显示名称
 */
function getCategoryDisplayName(category: string): string {
  const names: Record<string, string> = {
    film: "电影风格",
    social: "社交媒体",
    news: "新闻标题",
    corporate: "企业风格",
    creative: "创意设计",
    minimal: "极简风格",
    animated: "动画效果",
  }
  return names[category] || category
}

/**
 * 将字幕模板转换为 LTX 字幕样式格式
 */
function convertTemplateToStyle(
  template: SubtitleTemplate,
): Record<string, any> {
  return {
    font: {
      name: template.font.name,
      size: template.font.size,
      color: `#${template.font.color}`,
      bold: template.font.bold,
      italic: template.font.italic,
    },
    border: {
      width: template.border.width,
      color: `#${template.border.color}`,
    },
    background: {
      color: `#${template.background.color}`,
      padding: template.background.padding,
    },
    position: template.position,
    alignment: template.alignment,
    margins: {
      vertical: template.margins.vertical,
      horizontal: template.margins.horizontal,
    },
    animation: template.animation
      ? {
          type: template.animation.type,
          duration: template.animation.duration,
          easing: template.animation.easing,
        }
      : undefined,
  }
}
