/**
 * 计算机视觉分析工具
 * 支持深度估计、姿态估计等CV功能
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { basename, dirname, extname, join } from "path"
import { fileURLToPath } from "url"
import z from "zod"
import { cvModelProviderManager } from "../cv/providers/manager.js"
import type { CVModelConfig } from "../cv/types/index.js"
import { Tool } from "./tool.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 计算机视觉分析工具
 */
export const CVAnalysisTool = Tool.defineLtxTool("cv_analysis", {
  description:
    "【计算机视觉】深度估计、姿态估计等 CV 模型分析。与 ai_video_analysis（多模态 AI 语义理解）和 ltx_video_processor（LTX 原生分析）功能互补。需要像素级视觉特征时用此工具",
  parameters: z.object({
    // 操作类型
    operation: z
      .enum([
        "depth_estimation",
        "pose_estimation",
        "video_analysis",
        "batch_analysis",
      ])
      .describe(
        "操作类型: depth_estimation=深度估计, pose_estimation=姿态估计, video_analysis=视频分析, batch_analysis=批量分析",
      ),

    // 输入文件
    input: z.string().describe("输入图像或视频文件路径"),
    inputs: z
      .array(z.string())
      .optional()
      .describe("多个输入文件路径（用于批量分析）"),

    // 深度估计参数
    depth_model: z
      .enum(["midas", "dpt_hybrid", "zoedepth", "depth_anything"])
      .optional()
      .describe("深度估计模型"),
    depth_output_format: z
      .enum(["colormap", "depth_map", "disparity", "raw"])
      .optional()
      .describe("深度图输出格式"),
    colormap: z
      .enum(["inferno", "viridis", "plasma", "magma", "jet"])
      .optional()
      .describe("色彩映射类型"),

    // 姿态估计参数
    pose_model: z
      .enum(["dwpose", "openpose", "mediapipe", "mmpose"])
      .optional()
      .describe("姿态估计模型"),
    detect_multiple_persons: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否检测多个人"),
    include_hands: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否包含手部关键点"),
    include_face: z
      .boolean()
      .optional()
      .default(true)
      .describe("是否包含面部关键点"),
    confidence_threshold: z
      .number()
      .optional()
      .default(0.3)
      .describe("置信度阈值"),
    render_style: z
      .enum(["openpose", "simple", "detailed", "skeleton_only"])
      .optional()
      .describe("渲染风格"),

    // 视频分析参数
    frame_interval: z.number().optional().describe("帧间隔（秒）"),
    max_frames: z.number().optional().describe("最大分析帧数"),
    analysis_types: z.array(z.string()).optional().describe("分析类型列表"),
    output_format: z
      .enum(["video", "images", "json"])
      .optional()
      .describe("输出格式"),

    // 提供商配置
    provider: z
      .string()
      .optional()
      .describe("CV模型提供商ID（如: midas-dpt, dw-pose）"),
    model_path: z.string().optional().describe("模型文件路径（可选）"),
    device: z.enum(["cpu", "cuda", "mps"]).optional().describe("计算设备"),

    // 输出配置
    output: z.string().optional().describe("输出文件路径（可选）"),
    save_results: z.boolean().optional().default(true).describe("是否保存结果"),
  }),

  execute: async (args, ctx) => {
    try {
      // 1. 初始化CV模型提供商
      await initializeCVProviders(args)

      // 2. 根据操作类型处理
      let result: string
      const metadata: any = { operation: args.operation }

      switch (args.operation) {
        case "depth_estimation":
          result = await handleDepthEstimation(args)
          metadata.model = args.depth_model || "midas"
          metadata.output_format = args.depth_output_format || "colormap"
          break

        case "pose_estimation":
          result = await handlePoseEstimation(args)
          metadata.model = args.pose_model || "dwpose"
          metadata.detect_multiple_persons = args.detect_multiple_persons
          metadata.confidence_threshold = args.confidence_threshold
          break

        case "video_analysis":
          result = await handleVideoAnalysis(args)
          metadata.frame_interval = args.frame_interval
          metadata.max_frames = args.max_frames
          metadata.analysis_types = args.analysis_types
          break

        case "batch_analysis":
          result = await handleBatchAnalysis(args)
          metadata.input_count = args.inputs?.length || 0
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
        title: "CV分析失败",
        metadata: { operation: args.operation, error: true },
        output: `❌ CV分析失败: ${error.message}`,
        attachments: [],
      }
    }
  },
})

/**
 * 初始化CV模型提供商
 */
async function initializeCVProviders(args: any): Promise<void> {
  const providerId = args.provider || getDefaultProvider(args.operation)

  // 配置提供商
  const config: Partial<CVModelConfig> = {
    provider: providerId,
    modelPath: args.model_path,
    device: args.device || "cpu",
    downloadModels: true,
  }

  await cvModelProviderManager.configureProvider(providerId, config)
}

/**
 * 获取默认提供商
 */
function getDefaultProvider(operation: string): string {
  switch (operation) {
    case "depth_estimation":
      return "midas-dpt"
    case "pose_estimation":
      return "dw-pose"
    default:
      return "midas-dpt" // 默认使用深度估计提供商
  }
}

/**
 * 处理深度估计
 */
async function handleDepthEstimation(args: any): Promise<string> {
  // 读取图像文件
  const imageData = await readImageAsBase64(args.input)

  // 构建请求
  const request = {
    image: {
      type: "base64" as const,
      data: imageData,
      format: "jpg" as const,
    },
    model: args.depth_model || "midas",
    outputFormat: args.depth_output_format || "colormap",
    normalize: true,
    colormap: args.colormap || "inferno",
    device: args.device || "cpu",
  }

  // 调用深度估计
  const provider = args.provider || "midas-dpt"
  const result = await cvModelProviderManager.estimateDepth(request, provider)

  // 格式化结果
  let output = `# 深度估计结果\n\n`
  output += `- **模型**: ${result.metadata.model}\n`
  output += `- **处理时间**: ${result.metadata.processingTime}ms\n`
  output += `- **图像尺寸**: ${result.metadata.imageSize.width}×${result.metadata.imageSize.height}\n`
  output += `- **最小深度**: ${result.minDepth?.toFixed(3)}\n`
  output += `- **最大深度**: ${result.maxDepth?.toFixed(3)}\n`
  output += `- **平均深度**: ${result.meanDepth?.toFixed(3)}\n\n`

  // 如果有输出路径，保存结果
  if (args.output && result.depthMap) {
    await saveDepthMap(result.depthMap, args.output)
    output += `深度图已保存至: ${args.output}\n`
  }

  // 添加预览
  if (result.depthMap) {
    output += `\n![深度图预览](${result.depthMap})\n`
  }

  return output
}

/**
 * 处理姿态估计
 */
async function handlePoseEstimation(args: any): Promise<string> {
  // 读取图像文件
  const imageData = await readImageAsBase64(args.input)

  // 构建请求
  const request = {
    image: {
      type: "base64" as const,
      data: imageData,
      format: "jpg" as const,
    },
    model: args.pose_model || "dwpose",
    detectMultiplePersons: args.detect_multiple_persons !== false,
    includeHands: args.include_hands !== false,
    includeFace: args.include_face !== false,
    confidenceThreshold: args.confidence_threshold || 0.3,
    renderStyle: args.render_style || "openpose",
    device: args.device || "cpu",
  }

  // 调用姿态估计
  const provider = args.provider || "dw-pose"
  const result = await cvModelProviderManager.estimatePose(request, provider)

  // 格式化结果
  let output = `# 姿态估计结果\n\n`
  output += `- **模型**: ${result.metadata.model}\n`
  output += `- **处理时间**: ${result.metadata.processingTime}ms\n`
  output += `- **图像尺寸**: ${result.metadata.imageSize.width}×${result.metadata.imageSize.height}\n`
  output += `- **检测到人数**: ${result.persons.length}\n\n`

  // 每个人物的详细信息
  result.persons.forEach((person, index) => {
    output += `## 人物 ${index + 1}\n`
    output += `- **边界框**: (${person.bbox.x.toFixed(1)}, ${person.bbox.y.toFixed(1)}) ${person.bbox.width.toFixed(1)}×${person.bbox.height.toFixed(1)}\n`
    output += `- **置信度**: ${person.bbox.confidence.toFixed(3)}\n`
    output += `- **关键点数量**: ${person.keypoints.length}\n`

    // 高置信度关键点
    const highConfidencePoints = person.keypoints.filter(
      (kp) => kp.confidence > 0.7,
    )
    if (highConfidencePoints.length > 0) {
      output += `- **高置信度关键点**: ${highConfidencePoints.map((kp) => kp.name).join(", ")}\n`
    }

    output += "\n"
  })

  // 如果有标注图像，添加预览
  if (result.annotatedImage) {
    output += `![姿态估计结果](${result.annotatedImage})\n`
  }

  // 如果有输出路径，保存结果
  if (args.output && result.annotatedImage) {
    await saveAnnotatedImage(result.annotatedImage, args.output)
    output += `标注图像已保存至: ${args.output}\n`
  }

  return output
}

/**
 * 处理视频分析
 */
async function handleVideoAnalysis(args: any): Promise<string> {
  // 检查视频文件是否存在
  if (!existsSync(args.input)) {
    throw new Error(`视频文件不存在: ${args.input}`)
  }

  // 动态导入实时视频分析管道
  const { createRealtimeVideoPipeline } = await import(
    "../cv/pipelines/realtime_video_pipeline.js"
  )

  // 创建输出目录
  const outputDir = args.output
    ? dirname(args.output)
    : join(dirname(args.input), "video_analysis_output")
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  // 映射分析类型
  const analysisTypes = (args.analysis_types || ["depth_estimation"]).map(
    (type: string) => {
      if (type === "depth") return "depth_estimation"
      if (type === "pose") return "pose_estimation"
      if (type === "object_detection") return "object_detection"
      if (type === "segmentation") return "segmentation"
      return type
    },
  ) as (
    | "depth_estimation"
    | "pose_estimation"
    | "object_detection"
    | "segmentation"
  )[]

  // 配置视频分析
  const config = {
    analysisTypes,
    frameInterval: args.frame_interval || 1.0, // 默认每秒1帧
    maxFrames: args.max_frames || 0, // 0表示无限制
    outputFormat: (args.output_format as "video" | "images" | "json") || "json",
    outputDir,
    provider: args.provider,
    device: args.device || "cpu",
    keepTempFiles: false,
  }

  console.log(`🎬 开始视频分析: ${basename(args.input)}`)
  console.log(`   - 输出目录: ${outputDir}`)
  console.log(`   - 分析类型: ${analysisTypes.join(", ")}`)
  console.log(`   - 帧间隔: ${config.frameInterval}秒`)
  console.log(
    `   - 最大帧数: ${config.maxFrames === 0 ? "无限制" : config.maxFrames}`,
  )

  // 创建并运行管道
  const pipeline = await createRealtimeVideoPipeline()
  const result = await pipeline.analyzeVideo(args.input, config)

  // 生成输出报告
  let output = `# 视频分析报告\n\n`
  output += `- **视频文件**: ${result.inputVideo}\n`
  output += `- **总帧数**: ${result.totalFrames}\n`
  output += `- **已分析帧数**: ${result.analyzedFrames}\n`
  output += `- **分析类型**: ${result.analysisTypes.join(", ")}\n`
  output += `- **处理时间**: ${result.processingTime}ms\n\n`

  // 添加汇总统计
  output += `## 汇总统计\n\n`
  if (result.summary.averageDepth !== undefined) {
    output += `- **平均深度**: ${result.summary.averageDepth.toFixed(3)}\n`
    output += `- **深度范围**: ${result.summary.depthRange?.min.toFixed(3)} - ${result.summary.depthRange?.max.toFixed(3)}\n`
  }
  if (result.summary.totalPersons !== undefined) {
    output += `- **总检测人数**: ${result.summary.totalPersons}\n`
    output += `- **平均每帧人数**: ${result.summary.averagePersonsPerFrame?.toFixed(2)}\n`
  }
  output += `- **分析错误**: ${result.summary.errors}\n\n`

  // 添加帧结果摘要
  output += `## 帧分析结果（前10帧）\n\n`
  const sampleFrames = result.frameResults.slice(0, 10)
  sampleFrames.forEach((frame) => {
    output += `### 帧 ${frame.frameIndex} (${frame.timestamp.toFixed(2)}s)\n`
    if (frame.depth) {
      output += `  - 深度: ${frame.depth.meanDepth.toFixed(3)} (${frame.depth.minDepth.toFixed(3)}-${frame.depth.maxDepth.toFixed(3)})\n`
    }
    if (frame.pose) {
      output += `  - 姿态: ${frame.pose.persons.length} 人\n`
    }
    if (frame.error) {
      output += `  - ❌ 错误: ${frame.error}\n`
    }
    output += "\n"
  })

  if (result.frameResults.length > 10) {
    output += `... 以及另外 ${result.frameResults.length - 10} 帧结果\n\n`
  }

  // 添加输出文件信息
  output += `## 输出文件\n\n`
  result.outputFiles.forEach((file) => {
    output += `- ${file}\n`
  })

  // 如果指定了输出路径，保存报告
  if (args.output) {
    const reportPath = args.output.endsWith(".json")
      ? args.output
      : `${args.output}.json`
    const report = {
      video: result.inputVideo,
      analysis: result,
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    output += `\n📄 详细报告已保存至: ${reportPath}\n`
  }

  return output
}

/**
 * 处理批量分析
 */
async function handleBatchAnalysis(args: any): Promise<string> {
  const inputs = args.inputs || []

  if (inputs.length === 0) {
    throw new Error("批量分析需要输入文件列表")
  }

  let output = `# 批量分析结果\n\n`
  output += `- **总文件数**: ${inputs.length}\n`
  output += `- **操作类型**: ${args.operation || "深度估计"}\n\n`

  // 限制处理数量，避免超时
  const maxFiles = Math.min(inputs.length, 10)
  const filesToProcess = inputs.slice(0, maxFiles)

  output += `正在处理前 ${maxFiles} 个文件...\n\n`

  // 处理每个文件
  for (let i = 0; i < filesToProcess.length; i++) {
    const file = filesToProcess[i]

    try {
      if (!existsSync(file)) {
        output += `❌ 文件不存在: ${file}\n`
        continue
      }

      // 根据操作类型处理
      if (args.operation === "depth_estimation" || !args.operation) {
        const imageData = await readImageAsBase64(file)
        const request = {
          image: {
            type: "base64" as const,
            data: imageData,
            format: "jpg" as const,
          },
          model: args.depth_model || "midas",
          outputFormat: args.depth_output_format || "colormap",
          normalize: true,
          colormap: args.colormap || "inferno",
          device: args.device || "cpu",
        }

        const result = await cvModelProviderManager.estimateDepth(
          request,
          args.provider || "midas-dpt",
        )
        output += `✅ ${file}: 深度估计完成 (${result.metadata.processingTime}ms)\n`
      } else if (args.operation === "pose_estimation") {
        const imageData = await readImageAsBase64(file)
        const request = {
          image: {
            type: "base64" as const,
            data: imageData,
            format: "jpg" as const,
          },
          model: args.pose_model || "dwpose",
          detectMultiplePersons: args.detect_multiple_persons !== false,
          includeHands: args.include_hands !== false,
          includeFace: args.include_face !== false,
          confidenceThreshold: args.confidence_threshold || 0.3,
          renderStyle: args.render_style || "openpose",
          device: args.device || "cpu",
        }

        const result = await cvModelProviderManager.estimatePose(
          request,
          args.provider || "dw-pose",
        )
        output += `✅ ${file}: 姿态估计完成，检测到 ${result.persons.length} 人 (${result.metadata.processingTime}ms)\n`
      }
    } catch (error: any) {
      output += `❌ ${file}: 处理失败 - ${error.message}\n`
    }
  }

  if (inputs.length > maxFiles) {
    output += `\n⚠️ 已处理 ${maxFiles}/${inputs.length} 个文件，其余文件被跳过以避免超时。\n`
  }

  output += `\n批量分析完成。`

  return output
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
 * 保存深度图
 */
async function saveDepthMap(
  depthMapData: string,
  outputPath: string,
): Promise<void> {
  // 移除data URL前缀
  const base64Data = depthMapData.replace(/^data:image\/\w+;base64,/, "")
  const buffer = Buffer.from(base64Data, "base64")

  const { writeFileSync } = await import("fs")
  const { dirname } = await import("path")

  // 确保输出目录存在
  const outputDir = dirname(outputPath)
  const { mkdirSync } = await import("fs")
  mkdirSync(outputDir, { recursive: true })

  writeFileSync(outputPath, buffer)
}

/**
 * 保存标注图像
 */
async function saveAnnotatedImage(
  imageData: string,
  outputPath: string,
): Promise<void> {
  // 移除data URL前缀
  const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "")
  const buffer = Buffer.from(base64Data, "base64")

  const { writeFileSync } = await import("fs")
  const { dirname } = await import("path")

  // 确保输出目录存在
  const outputDir = dirname(outputPath)
  const { mkdirSync } = await import("fs")
  mkdirSync(outputDir, { recursive: true })

  writeFileSync(outputPath, buffer)
}

/**
 * 获取操作标题
 */
function getOperationTitle(operation: string): string {
  const titles: Record<string, string> = {
    depth_estimation: "深度估计结果",
    pose_estimation: "姿态估计结果",
    video_analysis: "视频分析结果",
    batch_analysis: "批量分析结果",
  }

  return titles[operation] || "CV分析结果"
}
