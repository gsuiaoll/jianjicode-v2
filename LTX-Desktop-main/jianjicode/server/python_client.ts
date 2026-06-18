/**
 * jianjicode Python 微服务 HTTP 客户端
 *
 * 提供调用 Python LTX FastAPI 后端的类型安全 API。
 * 每个函数接受可选的 fallback 回调，当 HTTP 调用失败时自动降级。
 *
 * 使用：
 *   import { getVideoInfo } from "../../server/python_client.js"
 *   const result = await getVideoInfo(videoPath, async () => {
 *     // subprocess fallback
 *   })
 */
import type { LTXEditResult } from "../src/types/edit-result.js"
import { editResultFromPython } from "../src/types/edit-result.js"
import { getCircuitBreaker } from "../src/core/circuit-breaker.js"

// Points to LTX FastAPI (merged from Flask sidecar :5001)
const LTX_PORT = parseInt(process.env.LTX_PORT || "8000", 10)
const LTX_BASE_URL = process.env.LTX_API_URL || `http://127.0.0.1:${LTX_PORT}`
const BASE_URL = `${LTX_BASE_URL}/api/edit`

// ============================================================================
// 核心 HTTP 调用
// ============================================================================

/**
 * 通用 HTTP 调用 — 由断路器保护。
 *
 * 当断路器 OPEN 时跳过 HTTP 直接调用 fallback，
 * 避免浪费连接超时等待。
 */
async function pythonCall<T = any>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  fallback?: () => Promise<T>,
): Promise<T> {
  const url = `${BASE_URL}${endpoint}`
  const breaker = getCircuitBreaker(`python:${endpoint}`, {
    failureThreshold: 3,   // 连续 3 次失败跳闸
    timeout: 15_000,       // 15s 冷却
    halfOpenMaxRequests: 1,
  })

  // 断路器 OPEN → 跳过 HTTP 直接 fallback
  if (breaker.getState() === "OPEN") {
    if (fallback) {
      console.warn(`[python_client] Circuit "${breaker.name}" open, using fallback`)
      return fallback()
    }
    throw new Error(`Python bridge circuit "${breaker.name}" is open and no fallback available`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "unknown")
      throw new Error(`Python server returned ${response.status}: ${text}`)
    }
    const raw = await response.json()
    // Normalize Python EditResponse into LTXEditResult
    breaker.recordSuccess()
    if (raw.operation !== undefined && raw.success !== undefined) {
      return editResultFromPython(raw) as unknown as T
    }
    return raw as T
  } catch (err) {
    breaker.recordFailure(err)
    if (fallback) {
      console.warn(`[python_client] HTTP ${endpoint} failed: ${(err as Error).message}. Using fallback.`)
      return fallback()
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================================
// 视频处理 API
// ============================================================================

export async function getVideoInfo(
  inputPath: string,
  fallback?: () => Promise<any>,
): Promise<LTXEditResult> {
  return pythonCall("/video_info", { input: inputPath }, 30_000, fallback)
}

export async function cannyEdgeDetection(
  inputPath: string,
  outputPath: string,
  threshold1 = 100,
  threshold2 = 200,
  fallback?: () => Promise<any>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/canny",
    { input_path: inputPath, output_path: outputPath, threshold1, threshold2 },
    60_000,
    fallback,
  )
}

/**
 * 提取视频帧（单帧）。
 * 如需批量提取多帧，请多次调用此函数或使用 detectSceneChanges 定位关键时间点。
 *
 * @deprecated 请使用 extractFrameAtTime，名字更准确地反映 /extract_frame 的行为。
 */
export async function extractVideoFrames(
  inputPath: string,
  _outputDir: string,
  _frameRate = 1.0,
  _maxFrames = 10,
  _quality = 85,
  fallback?: () => Promise<any>,
): Promise<LTXEditResult> {
  // /extract_frame 端点只支持单帧提取（需要 time 参数），
  // 这里只传 input_path 会触发服务端校验错误，告知调用方使用 extractFrameAtTime。
  return {
    success: false,
    title: "extractVideoFrames 已废弃",
    output: "extractVideoFrames 已废弃。如需单帧提取请改用 extractFrameAtTime(inputPath, time, outputPath, fallback)。",
    operation: "extract_frame",
    toolId: "python_client",
    metadata: { operation: "extract_frame", error: true, success: false },
  }
}

export async function detectSceneChanges(
  inputPath: string,
  threshold = 30.0,
  fallback?: () => Promise<any>,
): Promise<LTXEditResult> {
  return pythonCall("/detect_scenes", { input_path: inputPath, threshold }, 60_000, fallback)
}

// ============================================================================
// Phase 3 新增 — 委托 Python LTX 的操作
// ============================================================================

export async function trimVideo(
  inputPath: string,
  startTime: number,
  endTime?: number,
  outputPath?: string,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  const body: Record<string, unknown> = { input_path: inputPath, start_time: startTime }
  if (endTime !== undefined && endTime > 0) body.end_time = endTime
  if (outputPath) body.output_path = outputPath
  return pythonCall("/trim", body, 60_000, fallback)
}

export async function concatVideos(
  inputPaths: string[],
  outputPath?: string,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/concat",
    { input_paths: inputPaths, output_path: outputPath },
    60_000,
    fallback,
  )
}

export async function convertFormat(
  inputPath: string,
  outputFormat: string,
  outputPath?: string,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/convert_format",
    { input_path: inputPath, output_format: outputFormat, output_path: outputPath },
    60_000,
    fallback,
  )
}

export async function extractAudio(
  inputPath: string,
  outputPath?: string,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/extract_audio",
    { input_path: inputPath, output_path: outputPath },
    60_000,
    fallback,
  )
}

export async function addSubtitle(
  inputPath: string,
  text: string,
  startTime: number,
  endTime: number,
  outputPath?: string,
  style?: Record<string, unknown>,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/add_subtitle",
    { input_path: inputPath, text, start_time: startTime, end_time: endTime, output_path: outputPath, style },
    60_000,
    fallback,
  )
}

export async function applyColorGrading(
  inputPath: string,
  correction: Record<string, number>,
  outputPath?: string,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/apply_color_grading",
    { input_path: inputPath, correction, output_path: outputPath },
    60_000,
    fallback,
  )
}

export async function mergeAudioVideo(
  videoPath: string,
  audioPath: string,
  outputPath?: string,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/merge_audio_video",
    { video_path: videoPath, audio_path: audioPath, output_path: outputPath },
    60_000,
    fallback,
  )
}

export async function extractFrameAtTime(
  inputPath: string,
  time: number,
  outputPath?: string,
  fallback?: () => Promise<LTXEditResult>,
): Promise<LTXEditResult> {
  return pythonCall(
    "/extract_frame",
    { input_path: inputPath, time, output_path: outputPath },
    30_000,
    fallback,
  )
}

// ============================================================================
// 服务器状态
// ============================================================================

/**
 * 检查 Python 服务器是否在线。
 * 其他函数在服务器不可达时会自动 fallback，不需要额外调用这个函数。
 */
export async function checkPythonServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${LTX_BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}
