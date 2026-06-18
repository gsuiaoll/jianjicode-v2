/**
 * Seedance 公共工具库 — API 客户端、像素归一化、下载、轮询等共享逻辑
 *
 * === 职责 ===
 * - 供 seedance.ts（主工具）和 seedance-service.ts（语义编辑）共用
 * - 消除两份代码的重复维护
 *
 * === 使用 ===
 *   import { createTask, pollTask, downloadVideo, ... } from "./seedance-utils.js"
 */

import { ACLType, TosClient } from "@volcengine/tos-sdk"
import { execSync } from "child_process"
import { createHash } from "crypto"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs"
import { basename, join } from "path"
import { findFfmpegPath, findFfprobePath } from "./ffmpeg-utils.js"

// ============================================================================
// 配置
// ============================================================================

export const BASE_URL =
  process.env.SEEDANCE_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3"
export const DEFAULT_MODEL =
  process.env.SEEDANCE_MODEL || "doubao-seedance-2-0-260128"
export const VALID_MODELS = [
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
]

/** 模型像素预算（fast 模式 r2v 有限制） */
export const MODEL_PIXEL_LIMITS: Record<string, number | undefined> = {
  "doubao-seedance-2-0-fast-260128": 2_086_876,
  "doubao-seedance-2-0-260128": undefined,
}

// ============================================================================
// 错误分类
// ============================================================================

export type ErrorCode =
  | "auth"
  | "quota"
  | "rate_limit"
  | "invalid_param"
  | "server"
  | "network"
  | "timeout"
  | "cancelled"
  | "expired"

export class SeedanceError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public apiError?: { code: string; message: string },
  ) {
    super(message)
  }
}

// ============================================================================
// 杂项
// ============================================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function getApiKey(): string {
  return process.env.SEEDANCE_API_KEY || ""
}

// ============================================================================
// HTTP 错误分类
// ============================================================================

export function classifyHttpError(
  status: number,
  body: { error?: { code?: string; message?: string } },
): SeedanceError {
  const apiErr = body.error
    ? { code: body.error.code || "", message: body.error.message || "" }
    : undefined
  switch (status) {
    case 401:
      return new SeedanceError(
        "API Key 无效，请检查 SEEDANCE_API_KEY",
        "auth",
        apiErr,
      )
    case 403:
      return new SeedanceError("配额不足或权限拒绝", "quota", apiErr)
    case 429:
      return new SeedanceError("请求过于频繁，请稍后再试", "rate_limit", apiErr)
    default:
      if (status >= 500)
        return new SeedanceError(
          "Seedance 服务不可用，请稍后重试",
          "server",
          apiErr,
        )
      return new SeedanceError(
        apiErr?.message || `HTTP ${status}`,
        "invalid_param",
        apiErr,
      )
  }
}

// ============================================================================
// 视频像素探测（ffprobe + ffmpeg -i 两级回退）
// ============================================================================

/** 用 ffprobe 探测视频时长（秒），失败返回 null */
export function probeVideoDuration(input: string): number | null {
  const probeBin = findFfprobePath()
  if (!probeBin) return null
  try {
    const probe = execSync(
      `${JSON.stringify(probeBin)} -v quiet -print_format json -show_format ${JSON.stringify(input)}`,
      { timeout: 10_000, encoding: "utf-8" },
    )
    const parsed = JSON.parse(probe)
    const duration = parseFloat(parsed.format?.duration)
    return isNaN(duration) ? null : duration
  } catch {
    return null
  }
}

/** 用 ffprobe + ffmpeg -i 两级回退探测视频宽高 */
export async function probeVideoDimensions(
  input: string,
  signal?: AbortSignal,
): Promise<{ width: number; height: number } | null> {
  if (signal?.aborted) return null

  // 方法一: ffprobe
  const probeBin = findFfprobePath()
  if (probeBin) {
    try {
      const probe = execSync(
        `${JSON.stringify(probeBin)} -v quiet -print_format json -show_streams ${JSON.stringify(input)}`,
        { timeout: 10_000 },
      )
      const parsed = JSON.parse(probe.toString())
      const stream = parsed.streams?.find((s: any) => s.codec_type === "video")
      if (stream?.width && stream?.height) {
        return { width: stream.width, height: stream.height }
      }
    } catch {
      // ffprobe 不可用, 尝试回退
    }
  }

  if (signal?.aborted) return null

  // 方法二: ffmpeg -i 回退
  const ffmpegBin = findFfmpegPath()
  if (ffmpegBin) {
    try {
      execSync(
        `${JSON.stringify(ffmpegBin)} -i ${JSON.stringify(input)} 2>&1`,
        { timeout: 15_000 },
      )
    } catch (e: any) {
      const text = e.stderr?.toString() || e.stdout?.toString() || ""
      const match = text.match(/(\d{3,5})x(\d{3,5})/)
      if (match) {
        return { width: parseInt(match[1]), height: parseInt(match[2]) }
      }
    }
  }

  return null
}

// ============================================================================
// 文件缓存 Key（基于内容 SHA-256）
// ============================================================================

/** 基于文件内容 SHA-256 的缓存 key（读前 64KB + 后 64KB） */
export function fileCacheKey(filePath: string): string {
  try {
    const hash = createHash("sha256")
    const fd = openSync(filePath, "r")
    const buf = Buffer.alloc(65536)
    const bytesRead = readSync(fd, buf, 0, 65536, 0)
    if (bytesRead > 0) hash.update(buf.subarray(0, bytesRead))
    const { size } = statSync(filePath)
    if (size > 131072) {
      const tailBuf = Buffer.alloc(65536)
      const tailBytes = readSync(
        fd,
        tailBuf,
        0,
        65536,
        Math.max(0, size - 65536),
      )
      if (tailBytes > 0) hash.update(tailBuf.subarray(0, tailBytes))
    }
    closeSync(fd)
    return hash.digest("hex").slice(0, 16)
  } catch {
    return basename(filePath)
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .slice(0, 16)
  }
}

// ============================================================================
// 参考视频像素预算归一化
// ============================================================================

/**
 * 参考视频归一化：检测像素数 → 按像素预算等比缩放 → 偶数对齐 → 验证 → 缓存
 *
 * - 本地文件: ffprobe 检测，超限则缩放
 * - URL: 尝试 ffprobe，失败则 warn 并原样返回
 * - 缓存: 基于文件内容哈希 + pixelLimit 避免重复转码
 * - 验证: 缩放后再次 ffprobe 确认满足预算，否则抛错
 */
export async function normalizeReferenceVideo(
  input: string,
  pixelLimit: number | undefined,
  cacheDir: string,
  signal?: AbortSignal,
): Promise<string> {
  if (pixelLimit === undefined) return input

  if (signal?.aborted) throw new SeedanceError("操作已被取消", "cancelled")

  const isUrl = input.startsWith("http://") || input.startsWith("https://")
  const dims = await probeVideoDimensions(input, signal)
  if (!dims) {
    if (isUrl) {
      console.warn(
        `[Seedance] 无法探测参考视频尺寸: ${input.slice(0, 80)}，跳过像素检查`,
      )
      return input
    }
    throw new SeedanceError(
      `无法探测参考视频尺寸: ${input}。ffprobe/ffmpeg 可能不可用或缺少系统依赖（如 libblas）。请安装 ffprobe 或检查系统库。`,
      "invalid_param",
    )
  }

  const pixels = dims.width * dims.height
  if (pixels <= pixelLimit) return input

  // 等比缩放（像素预算）
  const scale = Math.sqrt(pixelLimit / pixels)
  let newW = Math.floor(dims.width * scale)
  let newH = Math.floor(dims.height * scale)
  newW &= ~1
  newH &= ~1

  // 缓存
  mkdirSync(cacheDir, { recursive: true })
  const cacheKey = `${fileCacheKey(input)}_${pixelLimit}_${newW}x${newH}.mp4`
  const cachePath = join(cacheDir, cacheKey)

  if (existsSync(cachePath)) {
    const cached = await probeVideoDimensions(cachePath, signal)
    if (cached && cached.width * cached.height <= pixelLimit) {
      console.log(
        `[Seedance] 使用缓存: ${cacheKey} (${dims.width}x${dims.height} → ${cached.width}x${cached.height})`,
      )
      return cachePath
    }
  }

  console.warn(
    `[Seedance] 参考视频 ${dims.width}x${dims.height} (${pixels}px) 超出预算 ${pixelLimit}，缩放至 ${newW}x${newH}`,
  )
  if (signal?.aborted) throw new SeedanceError("操作已被取消", "cancelled")
  const ffmpegBin = findFfmpegPath() || "ffmpeg"
  execSync(
    `${JSON.stringify(ffmpegBin)} -y -i ${JSON.stringify(input)} -vf "scale=${newW}:${newH}:flags=lanczos" -c:a copy ${JSON.stringify(cachePath)}`,
    { timeout: 60_000 },
  )

  // 输出验证
  if (signal?.aborted) throw new SeedanceError("操作已被取消", "cancelled")
  const output = await probeVideoDimensions(cachePath, signal)
  if (!output || output.width * output.height > pixelLimit) {
    throw new SeedanceError(
      `缩放后像素 ${output ? output.width * output.height : "?"} 仍超过预算 ${pixelLimit}。` +
        `源: ${dims.width}x${dims.height}，目标: ${newW}x${newH}。可能编码器参数未生效。`,
      "invalid_param",
    )
  }

  console.log(
    `[Seedance] 验证通过: ${cachePath} (${output.width}x${output.height} = ${output.width * output.height}px ≤ ${pixelLimit})`,
  )
  return cachePath
}

// ============================================================================
// API 客户端
// ============================================================================

/** 创建 Seedance 生成任务 */
export async function createTask(
  body: object,
): Promise<{ id: string; status?: string; created_at?: number }> {
  try {
    const response = await fetch(`${BASE_URL}/contents/generations/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const json = await response.json()
    if (!response.ok) throw classifyHttpError(response.status, json)
    return json as { id: string; status?: string; created_at?: number }
  } catch (err) {
    if (err instanceof SeedanceError) throw err
    if (err instanceof TypeError)
      throw new SeedanceError("网络连接失败", "network")
    throw err
  }
}

/** 查询任务状态 */
export async function getTask(taskId: string): Promise<{
  id: string
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "expired"
    | "cancelled"
  content?: { video_url?: string }
  error?: { code: string; message: string }
  usage?: { duration?: number; resolution?: string }
}> {
  try {
    const response = await fetch(
      `${BASE_URL}/contents/generations/tasks/${taskId}`,
      {
        headers: { Authorization: `Bearer ${getApiKey()}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
    const json = await response.json()
    if (!response.ok) throw classifyHttpError(response.status, json)
    return json as any
  } catch (err) {
    if (err instanceof SeedanceError) throw err
    if (err instanceof TypeError)
      throw new SeedanceError("网络连接失败", "network")
    throw err
  }
}

// ============================================================================
// 轮询（指数退避）
// ============================================================================

/** 轮询任务至完成，返回成功结果。可选 AbortSignal 支持取消 */
export async function pollTask(
  taskId: string,
  duration: number,
  signal?: AbortSignal,
): Promise<{
  id: string
  status: string
  content?: { video_url?: string }
  error?: { code: string; message: string }
  usage?: { duration?: number; resolution?: string }
}> {
  const pollMultiplier = parseInt(
    process.env.SEEDANCE_POLL_MULTIPLIER || "10",
    10,
  )
  const maxWaitMs = duration * pollMultiplier * 1_000 + 60_000
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    if (signal?.aborted) throw new SeedanceError("任务已被取消", "cancelled")

    const elapsed = Date.now() - startTime
    const interval = elapsed < 30_000 ? 5_000 : 10_000

    const result = await getTask(taskId)

    if (result.status === "failed") {
      throw new SeedanceError(
        result.error?.message || "视频生成失败",
        "server",
        result.error
          ? { code: result.error.code, message: result.error.message }
          : undefined,
      )
    }
    if (result.status === "cancelled") {
      throw new SeedanceError("任务已被取消", "cancelled")
    }
    if (result.status === "expired") {
      throw new SeedanceError("任务已过期，请重新生成", "expired")
    }
    if (result.status === "succeeded") return result

    console.log(
      `[Seedance] Polling task ${taskId}, status: ${result.status} (elapsed: ${Math.round(elapsed / 1000)}s)`,
    )
    await sleep(interval)
  }

  throw new SeedanceError(`视频生成超时 (${maxWaitMs / 1000}s)`, "timeout")
}

// ============================================================================
// 下载（重试 + 原子写入 + Content-Type 校验）
// ============================================================================

/** 下载视频，重试 2 次。可选 AbortSignal 支持取消 */
export async function downloadVideo(
  url: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const maxRetries = 2
  const tmpPath = outputPath + ".tmp"

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60_000)

      const response = await fetch(url, {
        redirect: "follow",
        signal: signal || controller.signal,
      })
      clearTimeout(timer)

      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const contentType = response.headers.get("content-type") || ""
      if (!contentType.startsWith("video/")) {
        throw new Error(`Invalid content type: ${contentType}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      writeFileSync(tmpPath, buffer)
      renameSync(tmpPath, outputPath)

      return outputPath
    } catch (err) {
      if (existsSync(tmpPath)) {
        try {
          unlinkSync(tmpPath)
        } catch {
          /* ignore */
        }
      }
      if (attempt > maxRetries)
        throw new SeedanceError("视频下载失败（已重试2次）", "network")
      console.warn(
        `[Seedance] Download retry ${attempt}/${maxRetries}: ${(err as Error).message}`,
      )
      await sleep(3000)
    }
  }
  throw new SeedanceError("视频下载失败", "network")
}

// ============================================================================
// 费用估算
// ============================================================================

export function estimateCost(
  duration: number,
  resolution: string,
): { amount: number; currency: string } {
  const baseRate: Record<string, number> = {
    "1080p": 0.94,
    "720p": 0.47,
    "480p": 0.24,
  }
  return {
    amount: +(duration * (baseRate[resolution] || 0.47)).toFixed(2),
    currency: "CNY",
  }
}

// ============================================================================
// TOS 文件上传
// ============================================================================

interface UploadResult {
  httpUrl: string
  fileName: string
  fileSize: number
}

/** 将参考视频/图片上传到火山引擎 TOS，返回公开 HTTPS URL */
export async function uploadFileToTos(filePath: string): Promise<UploadResult> {
  const accessKeyId = process.env.VOLC_ACCESS_KEY || ""
  const accessKeySecret = process.env.VOLC_SECRET_KEY || ""
  const bucket = process.env.TOS_BUCKET || ""

  if (!accessKeyId) throw new Error("VOLC_ACCESS_KEY 未配置")
  if (!accessKeySecret) throw new Error("VOLC_SECRET_KEY 未配置")
  if (!bucket) throw new Error("TOS_BUCKET 未配置")

  const fileStat = statSync(filePath)
  const fileName = basename(filePath)

  const client = new TosClient({
    accessKeyId,
    accessKeySecret,
    region: "cn-beijing",
    endpoint: "tos-cn-beijing.volces.com",
    enableCRC: false,
  })

  const objectKey = `seedance/${fileName}`

  // 使用 SDK 生成预签名 PUT URL，然后直接用 fetch 上传
  const signedUrl = (client as any).getPreSignedUrl({
    bucket,
    key: objectKey,
    method: "PUT",
    expires: 3600,
  })

  const body = readFileSync(filePath)
  const resp = await fetch(signedUrl, {
    method: "PUT",
    body,
  })

  if (!resp.ok) {
    throw new Error(`TOS 上传失败: HTTP ${resp.status} ${resp.statusText}`)
  }

  // 上传完成后通过 SDK 设置 ACL（确保公开可读）
  try {
    await (client as any).putObjectAcl({
      bucket,
      key: objectKey,
      acl: ACLType.ACLPublicRead,
    })
  } catch (e) {
    // ACL 设置失败不影响文件上传本身
    console.warn(`[TOS] 设置 ACL 失败: ${(e as Error).message}`)
  }

  const httpUrl = `https://${bucket}.tos-cn-beijing.volces.com/${objectKey}`

  return {
    httpUrl,
    fileName,
    fileSize: fileStat.size,
  }
}
