/**
 * 模板数据结构定义
 *
 * 参考现有预设系统（color_grading_preset, effect_template, professional_subtitle_template）
 * 设计通用的视频编辑模板结构，支持参数化、版本化、分类和标签。
 */

import { z } from "zod"

// ============================================================================
// 模板分类
// ============================================================================

export const TEMPLATE_CATEGORIES = [
  "fast_cut", // 快节奏剪辑
  "long_form", // 长视频剪辑
  "news_style", // 新闻解说风格
  "deep_analysis", // 深度解读风格
  "cinematic", // 电影感风格
  "vintage", // 复古风格
  "social_media", // 社交媒体
  "tutorial", // 教程
  "vlog", // Vlog
  "custom", // 自定义
] as const

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

// ============================================================================
// 模板参数定义
// ============================================================================

export interface TemplateParameter {
  name: string
  type: "string" | "number" | "boolean" | "select" | "file" | "time_range"
  label: string
  description: string
  required: boolean
  defaultValue?: string | number | boolean
  options?: string[] // select 类型的选项
  min?: number // number 类型的最小值
  max?: number // number 类型的最大值
  placeholder?: string
}

// ============================================================================
// 工具调用步骤
// ============================================================================

export interface ToolCallStep {
  toolName: string
  argsTemplate: Record<string, string> // 模板参数占位符 → 工具参数的映射
  description: string
  order: number
  condition?: string // 条件表达式（可选）
}

// ============================================================================
// 视频编辑模板
// ============================================================================

export interface VideoTemplate {
  id: string
  name: string
  description: string
  category: TemplateCategory
  tags: string[]
  parameters: TemplateParameter[]
  toolCalls: ToolCallStep[]
  preview?: string
  author: string
  version: string
  createdAt: number
  updatedAt: number
}

// ============================================================================
// 模板元数据（不含具体调用序列，用于列表展示）
// ============================================================================

export interface TemplateSummary {
  id: string
  name: string
  description: string
  category: TemplateCategory
  tags: string[]
  parameterCount: number
  toolCount: number
  author: string
  version: string
  createdAt: number
  updatedAt: number
}

// ============================================================================
// Zod Schema 定义
// ============================================================================

export const templateParameterSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "boolean", "select", "file", "time_range"]),
  label: z.string().min(1),
  description: z.string(),
  required: z.boolean(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  placeholder: z.string().optional(),
})

export const toolCallStepSchema = z.object({
  toolName: z.string().min(1),
  argsTemplate: z.record(z.string()),
  description: z.string(),
  order: z.number().int().min(1),
  condition: z.string().optional(),
})

export const videoTemplateSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1),
  description: z.string(),
  category: z.enum(TEMPLATE_CATEGORIES),
  tags: z.array(z.string()),
  parameters: z.array(templateParameterSchema),
  toolCalls: z.array(toolCallStepSchema),
  preview: z.string().optional(),
  author: z.string(),
  version: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

// ============================================================================
// 辅助函数
// ============================================================================

export function createTemplateSummary(
  template: VideoTemplate,
): TemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    category: template.category,
    tags: template.tags,
    parameterCount: template.parameters.length,
    toolCount: template.toolCalls.length,
    author: template.author,
    version: template.version,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  }
}

export function validateTemplate(template: unknown): VideoTemplate {
  return videoTemplateSchema.parse(template) as VideoTemplate
}

export function getCategoryLabel(category: TemplateCategory): string {
  const labels: Record<TemplateCategory, string> = {
    fast_cut: "快节奏剪辑",
    long_form: "长视频剪辑",
    news_style: "新闻解说风格",
    deep_analysis: "深度解读风格",
    cinematic: "电影感风格",
    vintage: "复古风格",
    social_media: "社交媒体",
    tutorial: "教程",
    vlog: "Vlog",
    custom: "自定义",
  }
  return labels[category]
}
