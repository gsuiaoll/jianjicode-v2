/**
 * AI视频分析工具
 * 通用多模态视频分析，支持多个AI模型提供商
 */

import { existsSync, readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { aiProviderManager } from "../ai/providers/manager.js"
import type { AIProviderConfig } from "../ai/types/index.js"
import { Tool } from "./tool.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * AI视频分析工具
 */
export const AIVideoAnalysisTool = Tool.defineLtxTool("ai_video_analysis", {
  description:
    "【文本AI分析】通过多模态 AI 模型分析视频内容：场景过渡建议、视觉风格分析、帧分析、摘要、内容描述。与 cv_analysis（计算机视觉：深度/姿态/动作）和 ltx_video_processor（LTX 原生分析）功能互补。需要 AI 模型理解语义时用此工具",
  parameters: z.object({
    // 操作类型
    operation: z
      .enum([
        "scene_transition_suggestion",
        "visual_style_analysis",
        "video_frame_analysis",
        "video_summarization",
        "content_description",
        "custom_analysis",
      ])
      .describe(
        "操作类型: scene_transition_suggestion=场景过渡建议, visual_style_analysis=视觉风格分析, video_frame_analysis=视频帧分析, video_summarization=视频内容总结, content_description=内容描述, custom_analysis=自定义分析",
      ),

    // 输入文件
    input: z.string().optional().describe("输入视频文件路径（用于视频分析）"),
    image_input: z
      .string()
      .optional()
      .describe("输入图像文件路径（用于图像分析）"),
    text_input: z.string().optional().describe("输入文本内容"),

    // 多文件输入
    image_inputs: z
      .array(z.string())
      .optional()
      .describe("多个输入图像文件路径"),
    frame_indices: z
      .array(z.number())
      .optional()
      .describe("要分析的视频帧索引"),

    // 场景过渡建议参数
    before_prompt: z.string().optional().describe("前一个镜头的文本描述"),
    after_prompt: z.string().optional().describe("后一个镜头的文本描述"),
    gap_duration: z
      .number()
      .optional()
      .default(5)
      .describe("间隙持续时间（秒，默认: 5）"),
    transition_mode: z
      .enum(["t2i", "t2v", "i2v"])
      .optional()
      .default("t2v")
      .describe("过渡模式: t2i=文本到图像, t2v=文本到视频, i2v=图像到视频"),

    // 视觉风格分析参数
    reference_styles: z.array(z.string()).optional().describe("参考风格列表"),
    analysis_depth: z
      .enum(["basic", "detailed", "comprehensive"])
      .optional()
      .default("detailed")
      .describe("分析深度"),

    // 视频帧分析参数
    frame_interval: z.number().optional().describe("帧间隔（秒）"),
    analysis_types: z.array(z.string()).optional().describe("分析类型列表"),

    // AI提供商配置
    provider: z
      .string()
      .optional()
      .describe("AI提供商ID（如: deepseek, openai, google, anthropic）"),
    model: z.string().optional().describe("AI模型名称"),
    api_key: z.string().optional().describe("API密钥（可选，使用默认配置）"),
    api_base_url: z.string().optional().describe("API基础URL（可选）"),

    // 通用参数
    system_prompt: z.string().optional().describe("系统提示词（可选）"),
    max_tokens: z.number().optional().describe("最大令牌数"),
    temperature: z.number().optional().describe("温度参数（0.0-2.0）"),
  }),

  execute: async (args, ctx) => {
    try {
      // 1. 初始化AI提供商管理器
      await initializeAIProviders(args)

      // 2. 根据操作类型处理
      let result: string
      const metadata: any = { operation: args.operation }

      switch (args.operation) {
        case "scene_transition_suggestion":
          result = await handleSceneTransitionSuggestion(args)
          metadata.before_prompt = args.before_prompt
          metadata.after_prompt = args.after_prompt
          metadata.gap_duration = args.gap_duration
          metadata.transition_mode = args.transition_mode
          break

        case "visual_style_analysis":
          result = await handleVisualStyleAnalysis(args)
          metadata.reference_styles = args.reference_styles
          metadata.analysis_depth = args.analysis_depth
          break

        case "video_frame_analysis":
          result = await handleVideoFrameAnalysis(args)
          metadata.frame_count = args.frame_indices?.length || 0
          metadata.analysis_types = args.analysis_types
          break

        case "video_summarization":
          result = await handleVideoSummarization(args)
          break

        case "content_description":
          result = await handleContentDescription(args)
          break

        case "custom_analysis":
          result = await handleCustomAnalysis(args)
          break

        default:
          throw new Error(`不支持的操作类型: ${args.operation}`)
      }

      return {
        title: getOperationTitle(args.operation),
        metadata: { ...metadata, error: false, success: true },
        output: result,
        attachments: [],
      }
    } catch (error: any) {
      return {
        title: "AI视频分析失败",
        metadata: { operation: args.operation, error: true },
        output: `❌ AI分析失败: ${error.message}`,
        attachments: [],
      }
    }
  },
})

/**
 * 初始化AI提供商
 */
async function initializeAIProviders(args: any): Promise<void> {
  const providerId = args.provider || "deepseek" // 默认使用DeepSeek

  // 配置提供商
  const config: Partial<AIProviderConfig> = {
    provider: providerId,
    apiKey: args.api_key,
    apiBaseUrl: args.api_base_url,
    defaultModel: args.model,
    enabled: true,
  }

  await aiProviderManager.configureProvider(providerId, config)
}

/**
 * 处理场景过渡建议
 */
async function handleSceneTransitionSuggestion(args: any): Promise<string> {
  // 读取图像文件（如果提供了文件路径）
  const beforeFrame = args.input
    ? await readImageAsBase64(args.input)
    : undefined
  const afterFrame = args.image_input
    ? await readImageAsBase64(args.image_input)
    : undefined
  const inputImage = args.image_inputs?.[0]
    ? await readImageAsBase64(args.image_inputs[0])
    : undefined

  // 获取提供商
  const provider = aiProviderManager.getProvider(args.provider)
  if (!provider) {
    throw new Error(`找不到AI提供商: ${args.provider}`)
  }

  // 调用场景过渡建议
  const result = await provider.suggestSceneTransition(
    beforeFrame,
    afterFrame,
    args.before_prompt,
    args.after_prompt,
    args.gap_duration,
    args.transition_mode,
    inputImage,
  )

  return result
}

/**
 * 处理视觉风格分析
 */
async function handleVisualStyleAnalysis(args: any): Promise<string> {
  // 读取图像文件
  let imageData: string
  if (args.input) {
    imageData = await readImageAsBase64(args.input)
  } else if (args.image_input) {
    imageData = await readImageAsBase64(args.image_input)
  } else {
    throw new Error("视觉风格分析需要输入图像文件")
  }

  // 获取提供商
  const provider = aiProviderManager.getProvider(args.provider)
  if (!provider) {
    throw new Error(`找不到AI提供商: ${args.provider}`)
  }

  // 调用视觉风格分析
  const result = await provider.analyzeVisualStyle(
    imageData,
    args.reference_styles,
    args.analysis_depth,
  )

  return result
}

/**
 * 处理视频帧分析
 */
async function handleVideoFrameAnalysis(args: any): Promise<string> {
  // 读取视频帧
  const frames: string[] = []

  if (args.input && existsSync(args.input)) {
    // 从视频文件中提取帧（简化版，实际需要调用视频处理工具）
    // 这里假设已经提供了图像文件列表
    throw new Error(
      "视频帧分析需要先提取视频帧。请先使用ltx_video_processor提取帧，然后使用image_inputs参数。",
    )
  } else if (args.image_inputs && args.image_inputs.length > 0) {
    // 读取多个图像文件
    for (const imagePath of args.image_inputs) {
      if (existsSync(imagePath)) {
        frames.push(await readImageAsBase64(imagePath))
      }
    }
  } else {
    throw new Error("视频帧分析需要输入图像文件列表")
  }

  if (frames.length === 0) {
    throw new Error("没有找到有效的图像文件")
  }

  // 获取提供商
  const provider = aiProviderManager.getProvider(args.provider)
  if (!provider) {
    throw new Error(`找不到AI提供商: ${args.provider}`)
  }

  // 调用视频帧分析
  const result = await provider.analyzeVideoFrames(
    frames,
    args.frame_interval,
    args.analysis_types,
  )

  return result
}

/**
 * 处理视频内容总结
 */
async function handleVideoSummarization(args: any): Promise<string> {
  // 获取提供商
  const provider = aiProviderManager.getProvider(args.provider)
  if (!provider) {
    throw new Error(`找不到AI提供商: ${args.provider}`)
  }

  // 构建提示词
  let prompt = "请分析以下视频内容并给出总结：\n\n"

  if (args.text_input) {
    prompt += `视频描述: ${args.text_input}\n`
  }

  if (args.input) {
    prompt += `视频文件: ${args.input}\n`
  }

  prompt +=
    "\n请提供：\n1. 主要内容概述\n2. 关键场景描述\n3. 视觉风格特点\n4. 可能的观众群体\n5. 改进建议"

  const systemPrompt =
    args.system_prompt ||
    "你是一个专业的视频内容分析师，擅长分析视频内容并给出有洞察力的总结。"

  // 调用文本生成
  const result = await provider.generateText(
    prompt,
    systemPrompt,
    args.max_tokens,
    args.temperature,
  )

  return result
}

/**
 * 处理内容描述
 */
async function handleContentDescription(args: any): Promise<string> {
  // 获取提供商
  const provider = aiProviderManager.getProvider(args.provider)
  if (!provider) {
    throw new Error(`找不到AI提供商: ${args.provider}`)
  }

  // 构建提示词
  let prompt = "请描述以下内容：\n\n"

  if (args.text_input) {
    prompt += `文本内容: ${args.text_input}\n`
  }

  if (args.input && existsSync(args.input)) {
    // 如果是视频文件
    prompt += `视频文件: ${args.input}\n请描述视频内容。`
  } else if (args.image_input && existsSync(args.image_input)) {
    // 如果是图像文件
    const imageData = await readImageAsBase64(args.image_input)
    // 对于图像，使用多模态分析
    return await provider.analyzeVisualStyle(imageData, undefined, "detailed")
  }

  const systemPrompt =
    args.system_prompt ||
    "你是一个专业的内容描述助手，能够清晰、准确地描述各种媒体内容。"

  // 调用文本生成
  const result = await provider.generateText(
    prompt,
    systemPrompt,
    args.max_tokens,
    args.temperature,
  )

  return result
}

/**
 * 处理自定义分析
 */
async function handleCustomAnalysis(args: any): Promise<string> {
  // 获取提供商
  const provider = aiProviderManager.getProvider(args.provider)
  if (!provider) {
    throw new Error(`找不到AI提供商: ${args.provider}`)
  }

  if (!args.text_input) {
    throw new Error("自定义分析需要text_input参数")
  }

  // 调用文本生成
  const result = await provider.generateText(
    args.text_input,
    args.system_prompt,
    args.max_tokens,
    args.temperature,
  )

  return result
}

/**
 * 读取图像文件为base64
 */
async function readImageAsBase64(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`图像文件不存在: ${filePath}`)
  }

  const data = readFileSync(filePath)
  const base64 = data.toString("base64")
  return `data:image/jpeg;base64,${base64}`
}

/**
 * 获取操作标题
 */
function getOperationTitle(operation: string): string {
  const titles: Record<string, string> = {
    scene_transition_suggestion: "AI场景过渡建议",
    visual_style_analysis: "AI视觉风格分析",
    video_frame_analysis: "AI视频帧分析",
    video_summarization: "AI视频内容总结",
    content_description: "AI内容描述",
    custom_analysis: "AI自定义分析",
  }

  return titles[operation] || "AI视频分析"
}
