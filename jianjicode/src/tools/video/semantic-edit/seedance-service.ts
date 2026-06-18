/**
 * SeedanceService — 语义编辑用的 Seedance API 封装
 *
 * === 职责 ===
 * - 上传参考视频到 TOS
 * - 创建 Seedance 任务
 * - 轮询至完成
 * - 下载生成结果
 *
 * === 架构 ===
 * 共享工具函数从 seedance-utils 导入，避免与 seedance.ts 重复。
 */

import { mkdirSync } from "fs"
import { join } from "path"
import {
  DEFAULT_MODEL,
  downloadVideo,
  getApiKey,
  MODEL_PIXEL_LIMITS,
  normalizeReferenceVideo,
  pollTask,
  uploadFileToTos,
} from "../../../lib/seedance-utils.js"
import { validatePath } from "../../../lib/ffmpeg-sandbox.js"

// ============================================================================
// 类型
// ============================================================================

export interface SeedanceInput {
  prompt: string
  /** 已上传的参考视频 HTTPS URL（与 referenceVideoPath 二选一） */
  referenceVideoUrl?: string
  /** 本地参考视频路径（自动上传到 TOS） */
  referenceVideoPath?: string
  duration: number
  ratio: string
  resolution: string
}

export interface SeedanceResult {
  success: boolean
  outputPath?: string
  error?: string
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 运行单次 Seedance 生成
 * 上传参考视频 → 创建任务 → 轮询 → 下载
 */
export async function runSeedance(
  input: SeedanceInput,
  signal?: AbortSignal,
): Promise<SeedanceResult> {
  const apiKey = getApiKey()
  if (!apiKey) {
    return { success: false, error: "SEEDANCE_API_KEY not configured" }
  }

  // 1. 参考视频 URL 归一化
  let refVideoUrl = input.referenceVideoUrl
  if (!refVideoUrl && input.referenceVideoPath) {
    // 像素预算归一化
    const pixelLimit = MODEL_PIXEL_LIMITS[DEFAULT_MODEL]
    const cacheDir = join(process.cwd(), "outputs", ".seedance_cache")
    const normalizedPath = await normalizeReferenceVideo(
      input.referenceVideoPath,
      pixelLimit,
      cacheDir,
    )

    try {
      const { httpUrl } = await uploadFileToTos(normalizedPath)
      refVideoUrl = httpUrl
    } catch (err) {
      return {
        success: false,
        error: `Reference upload failed: ${(err as Error).message}`,
      }
    }
  }

  // 2. 构建请求体
  const content: object[] = [{ type: "text", text: input.prompt }]
  if (refVideoUrl) {
    content.push({
      type: "video_url",
      video_url: { url: refVideoUrl },
      role: "reference_video",
    })
  }

  const body = {
    model: DEFAULT_MODEL,
    content,
    duration: input.duration,
    ratio: input.ratio,
    resolution: input.resolution,
  }

  // 3. 创建任务
  let taskId: string
  try {
    const response = await fetch(
      `${process.env.SEEDANCE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"}/contents/generations/tasks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: signal || AbortSignal.timeout(30_000),
      },
    )
    const json = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: `Create task API error ${response.status}: ${json.error?.message || JSON.stringify(json)}`,
      }
    }
    taskId = json.id
    if (!taskId) {
      return { success: false, error: "Create task returned no ID" }
    }
  } catch (err) {
    if (signal?.aborted) {
      return { success: false, error: "Cancelled" }
    }
    return {
      success: false,
      error: `Create task failed: ${(err as Error).message}`,
    }
  }

  // 4. 轮询
  let result: { content?: { video_url?: string } }
  try {
    result = await pollTask(taskId, input.duration, signal)
  } catch (err) {
    if (signal?.aborted) {
      return { success: false, error: "Cancelled" }
    }
    return {
      success: false,
      error: `Task ${taskId} failed: ${(err as Error).message}`,
    }
  }

  const videoUrl = result.content?.video_url
  if (!videoUrl) {
    return {
      success: false,
      error: "Task completed but no video_url in response",
    }
  }

  // 5. 输出路径
  const outputsDir = join(process.cwd(), "outputs")
  mkdirSync(outputsDir, { recursive: true })
  const rawOutputPath = join(outputsDir, `semantic_edit_${taskId}.mp4`)
  const refPath = input.referenceVideoPath || input.referenceVideoUrl || ""
  const sandbox = validatePath(refPath, rawOutputPath)
  if (!sandbox.ok) {
    return { success: false, error: sandbox.error }
  }
  const outputPath = sandbox.outputPath

  // 6. 下载
  try {
    await downloadVideo(videoUrl, outputPath, signal)
  } catch (err) {
    return {
      success: false,
      error: `Download failed: ${(err as Error).message}`,
    }
  }

  return { success: true, outputPath }
}
