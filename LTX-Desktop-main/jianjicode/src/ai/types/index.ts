/**
 * 通用AI分析组件类型定义
 * 支持多模型提供商、多模态输入、视频分析能力
 */

import { z } from "zod"

// 多模态内容类型
export const MultimodalContentSchema = z.object({
  type: z.enum(["text", "image", "video_frame"]),
  data: z.string(), // text内容或base64编码的图像/视频帧
  mimeType: z.string().optional(),
  description: z.string().optional(),
})

export type MultimodalContent = z.infer<typeof MultimodalContentSchema>

// AI分析请求
export const AIAnalysisRequestSchema = z.object({
  operation: z.enum([
    "scene_transition_suggestion",
    "visual_style_analysis",
    "frame_analysis",
    "video_summarization",
    "content_description",
    "custom_analysis",
  ]),
  contents: z.array(MultimodalContentSchema).min(1, "至少需要一个输入内容"),
  systemPrompt: z.string().optional(),
  parameters: z.record(z.any()).optional(),
  provider: z.string().optional(), // 指定提供商，如 "deepseek", "openai", "anthropic", "google"
  model: z.string().optional(), // 指定模型，如 "deepseek-chat", "gpt-4-vision-preview"
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
})

export type AIAnalysisRequest = z.infer<typeof AIAnalysisRequestSchema>

// AI分析响应
export const AIAnalysisResponseSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  analysis: z.record(z.any()).optional(),
  confidence: z.number().optional(),
  metadata: z.record(z.any()).optional(),
  provider: z.string(),
  model: z.string(),
  tokensUsed: z.number().optional(),
})

export type AIAnalysisResponse = z.infer<typeof AIAnalysisResponseSchema>

// 场景过渡建议特定请求（LTX兼容）
export const SceneTransitionRequestSchema = z.object({
  beforeFrame: z.string().optional(), // base64图像
  afterFrame: z.string().optional(), // base64图像
  beforePrompt: z.string().optional(),
  afterPrompt: z.string().optional(),
  gapDuration: z.number().optional(),
  mode: z
    .enum([
      "text-to-image",
      "t2i",
      "image-to-video",
      "i2v",
      "text-to-video",
      "t2v",
    ])
    .optional(),
  inputImage: z.string().optional(), // 参考图像base64
})

export type SceneTransitionRequest = z.infer<
  typeof SceneTransitionRequestSchema
>

// 视觉风格分析请求
export const VisualStyleAnalysisRequestSchema = z.object({
  image: z.string(), // base64图像
  referenceStyles: z.array(z.string()).optional(),
  analysisDepth: z.enum(["basic", "detailed", "comprehensive"]).optional(),
})

export type VisualStyleAnalysisRequest = z.infer<
  typeof VisualStyleAnalysisRequestSchema
>

// 视频帧分析请求
export const VideoFrameAnalysisRequestSchema = z.object({
  frames: z.array(z.string()), // base64图像数组
  frameInterval: z.number().optional(),
  analysisType: z
    .array(
      z.enum([
        "object_detection",
        "scene_recognition",
        "emotion_analysis",
        "action_recognition",
        "color_palette",
        "composition_analysis",
      ]),
    )
    .optional(),
})

export type VideoFrameAnalysisRequest = z.infer<
  typeof VideoFrameAnalysisRequestSchema
>

// AI提供商配置
export const AIProviderConfigSchema = z.object({
  provider: z.string(),
  apiKey: z.string().optional(),
  apiBaseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  timeout: z.number().optional(),
  maxRetries: z.number().optional(),
  enabled: z.boolean().optional(),
})

export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>
