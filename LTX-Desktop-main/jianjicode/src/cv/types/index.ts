/**
 * 计算机视觉模型类型定义
 * 支持深度估计、姿态估计等CV模型
 */

import { z } from "zod"

// 图像输入格式
export const ImageInputSchema = z.object({
  type: z.enum(["file_path", "base64", "frame_array"]),
  data: z.string(), // 文件路径、base64数据或JSON序列化的帧数组
  format: z.enum(["jpg", "png", "bmp", "raw"]).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  channels: z.number().optional(),
})

export type ImageInput = z.infer<typeof ImageInputSchema>

// 深度估计请求
export const DepthEstimationRequestSchema = z.object({
  image: ImageInputSchema,
  model: z
    .enum(["midas", "dpt_hybrid", "zoedepth", "depth_anything"])
    .optional(),
  outputFormat: z
    .enum(["colormap", "depth_map", "disparity", "raw"])
    .optional(),
  normalize: z.boolean().optional().default(true),
  colormap: z.enum(["inferno", "viridis", "plasma", "magma", "jet"]).optional(),
  device: z.enum(["cpu", "cuda", "mps"]).optional(),
})

export type DepthEstimationRequest = z.infer<
  typeof DepthEstimationRequestSchema
>

// 深度估计结果
export const DepthEstimationResultSchema = z.object({
  success: z.boolean(),
  depthMap: z.string(), // base64编码的深度图
  rawDepthData: z.array(z.array(z.number())).optional(), // 原始深度数据（可选）
  minDepth: z.number().optional(),
  maxDepth: z.number().optional(),
  meanDepth: z.number().optional(),
  metadata: z.object({
    model: z.string(),
    processingTime: z.number(),
    imageSize: z.object({
      width: z.number(),
      height: z.number(),
    }),
    outputFormat: z.string(),
  }),
})

export type DepthEstimationResult = z.infer<typeof DepthEstimationResultSchema>

// 姿态估计请求
export const PoseEstimationRequestSchema = z.object({
  image: ImageInputSchema,
  model: z.enum(["dwpose", "openpose", "mediapipe", "mmpose"]).optional(),
  detectMultiplePersons: z.boolean().optional().default(true),
  includeHands: z.boolean().optional().default(true),
  includeFace: z.boolean().optional().default(true),
  confidenceThreshold: z.number().optional().default(0.3),
  renderStyle: z
    .enum(["openpose", "simple", "detailed", "skeleton_only"])
    .optional(),
  device: z.enum(["cpu", "cuda", "mps"]).optional(),
})

export type PoseEstimationRequest = z.infer<typeof PoseEstimationRequestSchema>

// 关键点定义
export const KeypointSchema = z.object({
  x: z.number(),
  y: z.number(),
  confidence: z.number(),
  name: z.string().optional(),
  id: z.number().optional(),
})

export type Keypoint = z.infer<typeof KeypointSchema>

// 人体骨架连接
export const SkeletonConnectionSchema = z.object({
  start: z.number(), // 起始关键点索引
  end: z.number(), // 结束关键点索引
  color: z.string().optional(),
})

export type SkeletonConnection = z.infer<typeof SkeletonConnectionSchema>

// 姿态估计结果
export const PoseEstimationResultSchema = z.object({
  success: z.boolean(),
  persons: z.array(
    z.object({
      id: z.number(),
      bbox: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        confidence: z.number(),
      }),
      keypoints: z.array(KeypointSchema),
      skeleton: z.array(SkeletonConnectionSchema).optional(),
      poseType: z
        .enum(["full_body", "upper_body", "lower_body", "face_only"])
        .optional(),
    }),
  ),
  annotatedImage: z.string().optional(), // base64编码的标注图像
  metadata: z.object({
    model: z.string(),
    processingTime: z.number(),
    imageSize: z.object({
      width: z.number(),
      height: z.number(),
    }),
    totalPersons: z.number(),
  }),
})

export type PoseEstimationResult = z.infer<typeof PoseEstimationResultSchema>

// CV分析类型
export const CVAnalysisTypeSchema = z.enum([
  "depth_estimation",
  "pose_estimation",
  "object_detection",
  "segmentation",
])
export type CVAnalysisType = z.infer<typeof CVAnalysisTypeSchema>

// 视频分析请求（批量处理）
export const VideoAnalysisRequestSchema = z.object({
  videoPath: z.string(),
  frameInterval: z.number().optional(), // 帧间隔（秒）
  maxFrames: z.number().optional(), // 最大分析帧数
  analysisTypes: z.array(CVAnalysisTypeSchema),
  outputFormat: z.enum(["video", "images", "json"]).optional(),
  outputPath: z.string().optional(),
})

export type VideoAnalysisRequest = z.infer<typeof VideoAnalysisRequestSchema>

// 视频分析结果
export const VideoAnalysisResultSchema = z.object({
  success: z.boolean(),
  analysisType: z.string(),
  frames: z.array(
    z.object({
      frameIndex: z.number(),
      timestamp: z.number(),
      results: z.record(z.any()), // 不同类型的分析结果
    }),
  ),
  outputPath: z.string().optional(),
  summary: z.object({
    totalFrames: z.number(),
    processedFrames: z.number(),
    averageProcessingTime: z.number(),
    detectedObjects: z.record(z.number()).optional(),
  }),
})

export type VideoAnalysisResult = z.infer<typeof VideoAnalysisResultSchema>

// CV模型提供商接口
export interface CVModelProvider {
  readonly id: string
  readonly name: string
  readonly supportedModels: string[]

  // 深度估计
  estimateDepth(request: DepthEstimationRequest): Promise<DepthEstimationResult>

  // 姿态估计
  estimatePose(request: PoseEstimationRequest): Promise<PoseEstimationResult>

  // 健康检查
  healthCheck(): Promise<boolean>

  // 模型初始化
  initialize(modelPath?: string): Promise<void>

  // 资源清理
  cleanup(): Promise<void>
}

// CV模型配置
export const CVModelConfigSchema = z.object({
  provider: z.string(),
  modelPath: z.string().optional(), // 模型文件路径
  device: z.enum(["cpu", "cuda", "mps"]).optional().default("cpu"),
  cacheDir: z.string().optional(),
  downloadModels: z.boolean().optional().default(true),
  modelRepo: z.string().optional(), // HuggingFace模型仓库ID
})

export type CVModelConfig = z.infer<typeof CVModelConfigSchema>

// 实时视频分析管道配置
export const VideoPipelineConfigSchema = z.object({
  analysisTypes: z.array(z.string()),
  frameRate: z.number().optional(),
  bufferSize: z.number().optional(),
  outputFormat: z.enum(["overlay", "separate", "both"]).optional(),
  preview: z.boolean().optional().default(true),
})

export type VideoPipelineConfig = z.infer<typeof VideoPipelineConfigSchema>
