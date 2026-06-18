import { execSync } from "child_process"
import { existsSync, mkdirSync } from "fs"
import { join, relative, resolve } from "path"
import z from "zod"
import {
  type EditOperation,
  generateClipId,
  generateOperationId,
} from "../../protocol/edit-operations.js"
import { Tool } from "../../lib/tool.js"
import { validatePath } from "../../lib/ffmpeg-sandbox.js"
import { findFfprobePath } from "../../lib/ffmpeg-utils.js"
import {
  createTask,
  DEFAULT_MODEL,
  downloadVideo,
  estimateCost,
  getApiKey,
  normalizeReferenceVideo,
  pollTask,
  probeVideoDuration,
  SeedanceError,
  uploadFileToTos,
  VALID_MODELS,
} from "../../lib/seedance-utils.js"

// ============================================================================
// 配置
// ============================================================================

const MAX_CONCURRENT = parseInt(process.env.SEEDANCE_MAX_CONCURRENT || "3", 10)
const MAX_VIDEO_URL_RETRIES = 2

// ============================================================================
// 模型能力配置
// ============================================================================

interface R2VCaps {
  /** 参考视频最大像素数 (width × height)，undefined 表示无限制 */
  maxInputPixels?: number
  maxOutputResolution: string
  outputResolutions: string[]
}

interface ModelCaps {
  r2v: R2VCaps
  t2v: { maxOutputResolution: string; outputResolutions: string[] }
}

const MODEL_CAPABILITIES: Record<string, ModelCaps> = {
  "doubao-seedance-2-0-fast-260128": {
    r2v: {
      maxInputPixels: 2_086_876,
      maxOutputResolution: "720p",
      outputResolutions: ["480p", "720p"],
    },
    t2v: {
      maxOutputResolution: "1080p",
      outputResolutions: ["480p", "720p", "1080p"],
    },
  },
  "doubao-seedance-2-0-260128": {
    r2v: {
      maxOutputResolution: "1080p",
      outputResolutions: ["480p", "720p", "1080p"],
    },
    t2v: {
      maxOutputResolution: "1080p",
      outputResolutions: ["480p", "720p", "1080p"],
    },
  },
}

/**
 * 根据模型和是否有参考输入，返回对应的分辨率能力。
 * 注意：Fast 模式的 r2v（有参考）和 t2v（纯文本）分辨率支持不同。
 * r2v: 有限制（最大 720p），t2v: 无限制（支持 1080p）。
 */
function getModelCapabilities(
  model: string,
  hasReferences: boolean,
): R2VCaps | { maxOutputResolution: string; outputResolutions: string[] } {
  const key = model || "doubao-seedance-2-0-fast-260128"
  const caps = MODEL_CAPABILITIES[key]
  if (!caps) return MODEL_CAPABILITIES["doubao-seedance-2-0-fast-260128"].r2v
  return hasReferences ? caps.r2v : caps.t2v
}

// ============================================================================
// 参考文件 URL 归一化（resolve → validate → call API）
// ============================================================================

const OSS_URL_REGEX = /^oss:\/\//i

/**
 * 将单个参考文件输入归一化为公开 HTTPS URL。
 * - 本地路径 → 上传到 TOS → 返回公开 URL
 * - oss:// URL → 无法重新上传，标记警告
 * - 已有 HTTPS URL → 直接使用
 */
async function normalizeReference(
  ref: string,
): Promise<{ url: string; warning?: string }> {
  if (OSS_URL_REGEX.test(ref)) {
    return {
      url: ref,
      warning: `oss:// 格式 URL 无法被 Seedance 访问: ${ref}（请使用公开 HTTPS URL 或本地路径）`,
    }
  }

  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return { url: ref }
  }

  // 本地文件路径 → 上传到 TOS
  try {
    const result = await uploadFileToTos(ref)
    console.log(`[Seedance] Uploaded reference ${ref} → ${result.httpUrl}`)
    return { url: result.httpUrl }
  } catch (err) {
    throw new Error(`参考文件上传失败: ${ref} - ${(err as Error).message}`)
  }
}

/**
 * 归一化所有参考文件输入。
 * 合并 URL 和路径参数，统一输出 HTTPS URL 数组。
 */
async function normalizeAllReferences(args: {
  reference_videos?: string[]
  reference_video_paths?: string[]
  reference_images?: string[]
  reference_image_paths?: string[]
  reference_audio?: string[]
  reference_audio_paths?: string[]
}): Promise<{
  videoUrls: string[]
  imageUrls: string[]
  audioUrls: string[]
  warnings: string[]
}> {
  const warnings: string[] = []

  const normalizeAll = async (refs: string[]): Promise<string[]> => {
    const results: string[] = []
    for (const ref of refs) {
      const { url, warning } = await normalizeReference(ref)
      if (warning) warnings.push(warning)
      results.push(url)
    }
    return results
  }

  const videoUrls = await normalizeAll([
    ...(args.reference_videos || []),
    ...(args.reference_video_paths || []),
  ])

  const imageUrls = await normalizeAll([
    ...(args.reference_images || []),
    ...(args.reference_image_paths || []),
  ])

  const audioUrls = await normalizeAll([
    ...(args.reference_audio || []),
    ...(args.reference_audio_paths || []),
  ])

  return { videoUrls, imageUrls, audioUrls, warnings }
}

// ============================================================================
// 参考文件 HEAD 校验（必须传入已归一化的公开 URL）
// ============================================================================

async function validateReferenceFiles(args: {
  reference_images?: string[]
  reference_videos?: string[]
}): Promise<string[]> {
  const warnings: string[] = []

  const head = async (
    url: string,
  ): Promise<{ ok: boolean; contentLength: number }> => {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5_000),
      })
      return {
        ok: res.ok,
        contentLength: parseInt(res.headers.get("content-length") || "0"),
      }
    } catch {
      return { ok: false, contentLength: 0 }
    }
  }

  if (args.reference_images?.length) {
    for (const url of args.reference_images) {
      const { ok, contentLength } = await head(url)
      if (!ok) warnings.push(`参考图片 ${url} 无法访问`)
      else if (contentLength > 30 * 1024 * 1024)
        warnings.push(`参考图片 ${url} 超过 30MB 限制`)
    }
  }
  if (args.reference_videos?.length) {
    for (const url of args.reference_videos) {
      const { ok, contentLength } = await head(url)
      if (!ok) warnings.push(`参考视频 ${url} 无法访问`)
      else if (contentLength > 50 * 1024 * 1024)
        warnings.push(`参考视频 ${url} 超过 50MB 限制`)
    }
  }
  return warnings
}

// ============================================================================
// 上传后远端验证 — HEAD + GET(前1MB) + Content-Type + Accept-Ranges
// ============================================================================

interface RemoteVideoCheck {
  ok: boolean
  contentType: string
  contentLength: number
  acceptRanges: boolean
  firstBytesOk: boolean
}

async function verifyRemoteVideo(url: string): Promise<RemoteVideoCheck> {
  const result: RemoteVideoCheck = {
    ok: false,
    contentType: "",
    contentLength: 0,
    acceptRanges: false,
    firstBytesOk: false,
  }

  // HEAD 检查
  try {
    const headRes = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(10_000),
    })
    if (!headRes.ok) return result

    result.contentType = headRes.headers.get("content-type") || ""
    result.contentLength = parseInt(
      headRes.headers.get("content-length") || "0",
    )
    result.acceptRanges =
      (headRes.headers.get("accept-ranges") || "").toLowerCase() === "bytes"
    result.ok =
      result.contentType.startsWith("video/") && result.contentLength > 0
  } catch {
    return result
  }

  // GET 前 1MB 验证可读
  try {
    const rangeRes = await fetch(url, {
      headers: { Range: "bytes=0-1048575" },
      signal: AbortSignal.timeout(15_000),
    })
    result.firstBytesOk = rangeRes.ok || rangeRes.status === 206
    if (!result.firstBytesOk) result.ok = false
  } catch {
    result.ok = false
  }

  return result
}

// ============================================================================
// 输出文件校验 — 存在 + ffprobe 可读 + 包含视频轨
// ============================================================================

interface ArtifactCheck {
  ok: boolean
  hasVideoStream: boolean
  hasAudioStream: boolean
  duration: number
}

async function assertArtifact(filePath: string): Promise<ArtifactCheck> {
  const result: ArtifactCheck = {
    ok: false,
    hasVideoStream: false,
    hasAudioStream: false,
    duration: 0,
  }

  if (!existsSync(filePath)) return result

  try {
    const probeBin = findFfprobePath()
    if (!probeBin) return result
    const probe = execSync(
      `${JSON.stringify(probeBin)} -v quiet -print_format json -show_format -show_streams ${JSON.stringify(filePath)}`,
      { timeout: 10_000 },
    )
    const parsed = JSON.parse(probe.toString())

    result.duration = parseFloat(parsed.format?.duration || "0")
    result.hasVideoStream =
      parsed.streams?.some((s: any) => s.codec_type === "video") ?? false
    result.hasAudioStream =
      parsed.streams?.some((s: any) => s.codec_type === "audio") ?? false
    result.ok = result.hasVideoStream && result.duration > 0
  } catch {
    // ffprobe 不可用或解析失败
  }

  return result
}

// ============================================================================
// 请求体构建
// ============================================================================

/**
 * 构建发送给 Seedance API 的请求体。
 * content 数组的排列顺序决定了 prompt 中引用图片/视频的序号（图片1、视频1...）。
 * 图片的 role 映射：从 reference_image_roles 按索引取，缺省默认 reference_image。
 */
function buildCreateTaskBody(args: {
  prompt: string
  model?: string
  reference_images?: string[]
  reference_image_roles?: string[]
  reference_videos?: string[]
  reference_audio?: string[]
  duration?: number
  ratio?: string
  resolution?: string
  generate_audio?: boolean
  watermark?: boolean
  seed?: number
  camera_fixed?: boolean
  return_last_frame?: boolean
}): object {
  const content: object[] = [{ type: "text", text: args.prompt }]

  if (args.reference_images?.length) {
    for (let i = 0; i < args.reference_images.length; i++) {
      const role = args.reference_image_roles?.[i] || "reference_image"
      content.push({
        type: "image_url",
        image_url: { url: args.reference_images[i] },
        role,
      })
    }
  }
  if (args.reference_videos?.length) {
    for (const url of args.reference_videos) {
      content.push({
        type: "video_url",
        video_url: { url },
        role: "reference_video",
      })
    }
  }
  if (args.reference_audio?.length) {
    for (const url of args.reference_audio) {
      content.push({
        type: "audio_url",
        audio_url: { url },
        role: "reference_audio",
      })
    }
  }

  const body: Record<string, unknown> = {
    model: args.model || DEFAULT_MODEL,
    content,
    duration: args.duration ?? 5,
    ratio: args.ratio ?? "16:9",
    resolution: args.resolution ?? "720p",
    generate_audio:
      args.generate_audio !== false && !args.reference_audio?.length,
  }
  if (args.watermark !== undefined) {
    body.watermark = args.watermark
  }
  if (args.seed !== undefined) {
    body.seed = args.seed
  }
  if (args.camera_fixed !== undefined) {
    body.camera_fixed = args.camera_fixed
  }
  if (args.return_last_frame !== undefined) {
    body.return_last_frame = args.return_last_frame
  }
  return body
}

// ============================================================================
// Tool 定义
// ============================================================================

const paramsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("视频生成的文本描述（必填，作为创作主题和风格指引）"),
  model: z
    .enum(["doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128"])
    .optional()
    .describe("模型版本，不填则使用默认 doubao-seedance-2-0-260128"),

  reference_images: z
    .array(z.string().url())
    .max(9)
    .optional()
    .describe("参考图片 URL 列表（≤9张，单张 <30MB）"),
  reference_image_paths: z
    .array(z.string())
    .max(9)
    .optional()
    .describe("参考图片本地路径列表（≤9张，自动上传到 OSS 获取公开 URL）"),
  reference_image_roles: z
    .array(z.enum(["reference_image", "first_frame", "last_frame"]))
    .optional()
    .describe(
      "每张参考图片的角色（与 reference_images/image_paths 一一对应）。" +
        "first_frame=首帧图, last_frame=尾帧图, reference_image=普通参考（默认）。" +
        "首尾帧生视频时，第一张图 role=first_frame，最后一张图 role=last_frame",
    ),
  reference_videos: z
    .array(z.string().url())
    .max(3)
    .optional()
    .describe("参考视频 URL 列表（≤3个，单个 2-15s，<50MB）"),
  reference_video_paths: z
    .array(z.string())
    .max(3)
    .optional()
    .describe("参考视频本地路径列表（≤3个，自动上传到 OSS 获取公开 URL）"),
  reference_audio: z
    .array(z.string().url())
    .max(3)
    .optional()
    .describe(
      "参考音频 URL 列表（≤3个，MP3，<15MB）。若传入则使用参考音频，忽略 generate_audio",
    ),
  reference_audio_paths: z
    .array(z.string())
    .max(3)
    .optional()
    .describe("参考音频本地路径列表（≤3个，自动上传到 OSS 获取公开 URL）"),

  duration: z
    .number()
    .int()
    .min(4)
    .max(15)
    .optional()
    .default(5)
    .describe("视频时长（秒），4-15"),
  seed: z
    .number()
    .int()
    .optional()
    .describe("随机种子，用于复现相同结果。相同 seed + 相同输入 = 相同视频"),
  ratio: z
    .enum(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"])
    .optional()
    .default("16:9")
    .describe("视频宽高比"),
  resolution: z
    .enum(["480p", "720p", "1080p"])
    .optional()
    .default("720p")
    .describe("视频分辨率"),
  generate_audio: z
    .boolean()
    .optional()
    .default(true)
    .describe("是否生成原生音频（默认 true）。若传入 reference_audio 则被忽略"),
  camera_fixed: z
    .boolean()
    .optional()
    .describe(
      "是否固定镜头（默认 false）。固定镜头/监控视角/三脚架机位/不需要运镜时设为 true",
    ),
  watermark: z
    .boolean()
    .optional()
    .describe("是否添加水印（默认不传，由 API 决定）"),
  return_last_frame: z
    .boolean()
    .optional()
    .describe(
      "是否返回视频产物对应的尾帧图（默认 false）。设为 true 时返回尾帧图片，可用于续写或首尾帧控制",
    ),

  output: z
    .string()
    .optional()
    .describe("输出文件路径。默认: <outputs_dir>/seedance_<taskId>.mp4"),
  protect_originals: z
    .boolean()
    .optional()
    .default(true)
    .describe("是否保护原始参考文件不被修改"),
  allow_overwrite: z
    .boolean()
    .optional()
    .default(false)
    .describe("是否允许覆盖同名输出文件"),
})

type SeedanceArgs = z.infer<typeof paramsSchema>

let runningTasks = 0

export const SeedanceTool: any = Tool.define("seedance_v2", async () => {
  if (!process.env.SEEDANCE_API_KEY) {
    console.warn(
      "[Seedance] SEEDANCE_API_KEY not set — tool will fail at runtime",
    )
  }
  if (process.env.SEEDANCE_BASE_URL) {
    try {
      new URL(process.env.SEEDANCE_BASE_URL)
    } catch {
      console.warn(
        "[Seedance] SEEDANCE_BASE_URL is not a valid URL, using default",
      )
    }
  }
  if (
    process.env.SEEDANCE_MODEL &&
    !VALID_MODELS.includes(process.env.SEEDANCE_MODEL)
  ) {
    console.warn(
      `[Seedance] SEEDANCE_MODEL "${process.env.SEEDANCE_MODEL}" invalid, using default`,
    )
  }

  return {
    description:
      "AI 视频生成/编辑工具（字节跳动 Seedance 2.0）。支持文本/图片/视频/音频全模态输入，输出 4-15 秒视频。" +
      "核心能力：视频生视频（支持本地路径 reference_video_paths 或网络 URL reference_videos 传入参考视频，用 prompt 描述期望的编辑效果，AI 重新合成新视频）。" +
      "重要：如果你有视频文件的本地路径，直接用 reference_video_paths 参数（自动上传云端），不需要手动上传到云存储。" +
      "[MUST] Seedance 仅用于需要语义级视频生成/编辑的任务：主体增删替换、场景重构、风格迁移、视角变换、语义动画。" +
      "[MUST NOT] 对于已有确定性工具支持的操作（裁剪、调速、滤镜、水印、字幕、转场、遮罩），不得调用 Seedance。" +
      "[MUST NOT] Seedance 执行失败后，不得回退到 FFmpeg / html_frame_render 来模拟同类 AI 编辑能力。" +
      "适用场景：主体增删替换、画面内容合成、场景重构、视角变换、风格迁移（像素/卡通/油画等）等 FFmpeg 无法实现的复杂视频编辑。" +
      "限制：输入视频需 2-15 秒，生成需 1-3 分钟，费用约 ¥0.5-1.0/秒（1080p）。" +
      "不适用：已有专用工具的操作（裁剪/调速/滤镜/水印/字幕/转场/遮罩），请用对应工具。",
    parameters: paramsSchema,
    usageTemplate: {
      json: {
        prompt:
          "将画面中的静态背景替换为傍晚海滩日落场景，人物保持原样，整体色调温暖",
        reference_video_paths: ["{source_video}"],
        duration: 5,
        ratio: "16:9",
        resolution: "720p",
        generate_audio: true,
        output: "{output_dir}/seedance_{timestamp}.mp4",
        protect_originals: true,
        allow_overwrite: false,
      },
      constraints: [
        // 能力边界 (MUST / MUST NOT)
        "[MUST] Seedance 仅用于需要语义级视频生成/编辑的任务: 主体增删替换、场景重构、风格迁移、视角变换、语义动画",
        "[MUST NOT] 对于已有确定性工具支持的操作（裁剪、调速、滤镜、水印、字幕、转场、遮罩），不得调用 Seedance",
        "[MUST NOT] Seedance 执行失败后，不得回退到 FFmpeg / execute_script / html_frame_render 来模拟同类 AI 编辑能力。若不存在等价能力，应终止并返回失败原因",
        "[MUST NOT] 对于语义编辑已有视频（删除物体、替换物品、改背景），应使用 edit_video 工具而非 seedance_v2",
        // 参数约束 (MUST / SHOULD / INFO)
        "[MUST] duration 必须落入工具允许范围 4-15 秒",
        "[MUST] 当 model=doubao-seedance-2-0-fast 且存在参考视频时，resolution ∈ {480p, 720p}，禁止使用 1080p",
        "[SHOULD] r2v 默认使用 720p（质量与兼容性平衡）",
        "[SHOULD] 默认 duration=5",
        "[INFO] generate_audio=true 时允许模型生成音频轨；最终结果不保证包含音频轨",
        "[INFO] ratio 支持 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / adaptive",
        "[INFO] 输出格式为 mp4，包含视频轨，音频轨可能存在",
        "[INFO] seed 参数可复现相同结果：相同 seed + 相同输入 = 相同视频",
        "[INFO] camera_fixed=true 固定镜头，适合无需运镜的场景（监控视角/三脚架机位）",
        "[INFO] return_last_frame=true 返回尾帧图片，可用于视频续写或首尾帧控制",
        "[INFO] 图片支持三种角色: reference_image(普通参考), first_frame(首帧), last_frame(尾帧)，通过 reference_image_roles 数组指定",
      ],
      knownLimitations: [
        "当前工具无自动恢复机制 —— 单次失败不会重试",
        "Invalid video_url 已知存在 —— 参考视频上传 TOS 后可能无法被 Seedance 服务拉取",
        "输出规格可能发生降级 —— 实际分辨率/时长可能与请求不完全一致",
        "任务超时不代表生成失败 —— 后端可能仍在处理，但工具已超时返回",
      ],
      outputContract: {
        format: "mp4",
        required: ["file_exists", "video_stream"],
        optional: ["audio_stream"],
        verify: ["ffprobe"],
      },
    },
    execute: async (args: SeedanceArgs, ctx: any) => {
      if (runningTasks >= MAX_CONCURRENT) {
        return {
          title: "并发任务已满",
          metadata: { operation: "seedance_v2", error: true },
          output: `当前已有 ${runningTasks} 个生成任务在进行中，请等待完成后再试（并发上限: ${MAX_CONCURRENT}）`,
        }
      }
      runningTasks++
      try {
        return await doExecute(args, ctx.abort)
      } finally {
        runningTasks--
      }
    },
  }
})

/**
 * Seedance 视频生成主流程。
 *
 * 设计要点：
 * 1. for(;;) 重试循环：轮询发现 Invalid video_url 时，回到循环开头重新上传+创建任务
 * 2. 循环内是顺序执行 (Step 1→2→3→4→5→6)，正常完成时 return 退出循环
 * 3. 像素预算归一化仅对 Fast 模型生效（标准版无像素限制）
 * 4. 分辨率协商根据模型能力自动降级，避免 API 返回 400
 * 5. signal 来自 ctx.abort，支持外部取消长时间操作（上传/轮询/下载）
 */
async function doExecute(
  args: SeedanceArgs,
  signal?: AbortSignal,
): Promise<{
  title: string
  metadata: Record<string, unknown>
  output: string
  editOperations?: EditOperation[]
}> {
  // API Key 检查
  const apiKey = getApiKey()
  if (!apiKey) {
    return {
      title: "Seedance 未配置",
      metadata: { operation: "seedance_v2", error: true },
      output:
        "❌ 未配置 SEEDANCE_API_KEY 环境变量。请在 .env 文件中设置你的火山方舟 API Key。",
    }
  }

  // 路径安全检查
  const outputsDir = resolve(join(process.cwd(), "outputs"))

  // reference_image_roles 长度校验
  if (
    args.reference_image_roles &&
    args.reference_image_roles.length >
      (args.reference_images?.length || 0) +
        (args.reference_image_paths?.length || 0)
  ) {
    return {
      title: "参数校验失败",
      metadata: { operation: "seedance_v2", error: true },
      output:
        "❌ reference_image_roles 长度不能超过参考图片总数。" +
        `图片 ${(args.reference_images?.length || 0) + (args.reference_image_paths?.length || 0)} 张，` +
        `roles ${args.reference_image_roles.length} 个。`,
    }
  }

  // ========================================================================
  // 恢复树：Invalid video_url 重试循环
  // 用 for(;;) 而非 while 的原因是：循环体内正常完成时直接 return 退出，
  // 只有需要重试（Invalid video_url）时用 continue 回到循环开头。
  // 对比：用 while(true) 语义相同，但 for(;;) 更清晰地表达"循环直到 return"。
  // 最多重试 MAX_VIDEO_URL_RETRIES 次
  // ========================================================================

  let retryCount = 0
  let taskId: string | undefined
  let pollResult
  let lastPollError: { code: string; message: string } | undefined

  for (;;) {
    // 每次循环开始检查取消信号
    if (signal?.aborted) {
      return {
        title: "任务已取消",
        metadata: { operation: "seedance_v2", error: true },
        output: "❌ 视频生成任务已被用户取消。",
      }
    }
    // 需要重新归一化（上传）的场景：首次执行，或 Invalid video_url 重试
    // ========================================================================
    // Step 1 — 参考文件 URL 归一化（resolve → upload → https:// URL）
    // 合并 URL 和本地路径参数，统一输出公开 HTTPS URL
    // ========================================================================

    const hasUrls =
      !!args.reference_videos?.length ||
      !!args.reference_images?.length ||
      !!args.reference_audio?.length
    const hasPaths =
      !!args.reference_video_paths?.length ||
      !!args.reference_image_paths?.length ||
      !!args.reference_audio_paths?.length

    let resolvedVideos = args.reference_videos
    let resolvedImages = args.reference_images
    let resolvedAudio = args.reference_audio
    let normalizeWarnings: string[] = []

    if (hasUrls || hasPaths) {
      if (hasPaths) {
        const missingEnv: string[] = []
        if (!process.env.VOLC_ACCESS_KEY) missingEnv.push("VOLC_ACCESS_KEY")
        if (!process.env.VOLC_SECRET_KEY) missingEnv.push("VOLC_SECRET_KEY")
        if (!process.env.TOS_BUCKET) missingEnv.push("TOS_BUCKET")
        if (missingEnv.length > 0) {
          return {
            title: "参考文件上传未配置",
            metadata: { operation: "seedance_v2", error: true },
            output:
              "❌ 使用了参考文件本地路径，但 TOS 对象存储未完全配置。\n" +
              `缺少环境变量: ${missingEnv.join(", ")}\n` +
              "请在 .env 文件中配置火山引擎 TOS 的 Access Key / Secret Key / Bucket，\n" +
              "或改为使用公开 HTTPS URL。",
          }
        }

        // 参考视频像素预算归一化 — 检测像素数 → 超限则等比缩放 → 验证 → 缓存
        const model = args.model || DEFAULT_MODEL
        const r2vCaps = getModelCapabilities(model, true) as R2VCaps
        const pixelLimit = r2vCaps.maxInputPixels
        const cacheDir = join(outputsDir, ".seedance_cache")

        if (pixelLimit !== undefined) {
          try {
            if (args.reference_video_paths?.length) {
              args.reference_video_paths = await Promise.all(
                args.reference_video_paths.map((p) =>
                  normalizeReferenceVideo(p, pixelLimit, cacheDir),
                ),
              )
            }
            if (args.reference_videos?.length) {
              args.reference_videos = await Promise.all(
                args.reference_videos.map((v) =>
                  normalizeReferenceVideo(v, pixelLimit, cacheDir),
                ),
              )
            }
          } catch (err) {
            const msg =
              err instanceof SeedanceError
                ? `❌ 参考视频像素预算归一化失败 [${err.code}]: ${err.message}`
                : `❌ 参考视频像素预算归一化失败: ${(err as Error).message}`
            console.error(`[Seedance] ${msg}`)
            return {
              title: "Seedance 参考视频归一化失败",
              metadata: {
                operation: "seedance_v2",
                error: true,
                errorCode: err instanceof SeedanceError ? err.code : "network",
              },
              output: msg,
            }
          }
        }
        // 时长前置检查: doubao-seedance-2-0-fast r2v 要求参考视频 >= 1.8s
        if (
          model === "doubao-seedance-2-0-fast-260128" &&
          (args.reference_video_paths?.length || args.reference_videos?.length)
        ) {
          const durationMin = 1.8
          const allRefPaths: string[] = [
            ...(args.reference_video_paths || []),
            ...(args.reference_videos || []),
          ]
          for (const refPath of allRefPaths) {
            if (refPath.startsWith("http://") || refPath.startsWith("https://"))
              continue
            const dur = probeVideoDuration(refPath)
            if (dur !== null && dur < durationMin) {
              const msg = `❌ doubao-seedance-2-0-fast 的图生视频模式要求参考视频时长 ≥ ${durationMin}s，当前视频时长为 ${dur.toFixed(2)}s。请使用更长的参考视频或更换模型。`
              console.error(`[Seedance] ${msg}`)
              return {
                title: "Seedance 参考视频时长不足",
                metadata: { operation: "seedance_v2", error: true },
                output: msg,
              }
            }
          }
        }
      }
      const normalized = await normalizeAllReferences(args)
      resolvedVideos =
        normalized.videoUrls.length > 0 ? normalized.videoUrls : undefined
      resolvedImages =
        normalized.imageUrls.length > 0 ? normalized.imageUrls : undefined
      resolvedAudio =
        normalized.audioUrls.length > 0 ? normalized.audioUrls : undefined
      normalizeWarnings = normalized.warnings
    }

    // ========================================================================
    // Step 2 — 参考文件 HEAD 校验（校验已归一化的公开 URL）
    // ========================================================================

    let refWarnings: string[] = []
    if (resolvedImages?.length || resolvedVideos?.length) {
      refWarnings = await validateReferenceFiles({
        reference_images: resolvedImages,
        reference_videos: resolvedVideos,
      })
    }

    // ========================================================================
    // Step 2.5 — 上传后远端验证（HEAD + GET前1MB + Content-Type）
    // 仅对通过 TOS 上传的视频执行（本地路径才能触发 upload → verify）
    // ========================================================================

    const remoteVideoCheckWarnings: string[] = []
    if (
      resolvedVideos?.length &&
      (args.reference_video_paths?.length || args.reference_videos?.length)
    ) {
      for (const url of resolvedVideos) {
        if (url.includes("tos-cn-beijing.volces.com")) {
          const check = await verifyRemoteVideo(url)
          if (!check.ok) {
            remoteVideoCheckWarnings.push(
              `上传视频 ${url} 远端验证失败: contentType=${check.contentType}, length=${check.contentLength}, acceptRanges=${check.acceptRanges}, firstBytesOk=${check.firstBytesOk}`,
            )
          }
        }
      }
    }

    // ========================================================================
    // Step 3 — 分辨率协商（基于模型能力配置）
    // 关键区别：Fast 模型在 r2v 模式（有参考视频/图片）最大仅 720p，t2v 模式支持 1080p
    // getModelCapabilities(model, hasR2V) 根据是否有参考输入返回对应能力表
    // ========================================================================

    const hasR2V =
      (resolvedVideos?.length || 0) > 0 || (resolvedImages?.length || 0) > 0
    const caps = getModelCapabilities(args.model || DEFAULT_MODEL, hasR2V)
    const resolution = args.resolution || "720p"
    const effectiveRes = caps.outputResolutions.includes(resolution)
      ? resolution
      : caps.maxOutputResolution
    if (effectiveRes !== resolution) {
      console.warn(
        `[Seedance] ${resolution} not supported for ${args.model || DEFAULT_MODEL}${hasR2V ? " (r2v)" : " (t2v)"}, falling back to ${caps.maxOutputResolution}`,
      )
    }

    // ========================================================================
    // Step 4 — 创建任务（使用归一化后的 URL）
    // ========================================================================

    const model = args.model || DEFAULT_MODEL
    const body = buildCreateTaskBody({
      ...args,
      reference_videos: resolvedVideos,
      reference_images: resolvedImages,
      reference_audio: resolvedAudio,
      resolution: effectiveRes,
    })
    console.log(
      `[Seedance] Creating task (model: ${model}, duration: ${args.duration ?? 5}s, res: ${effectiveRes})`,
    )

    taskId = undefined // 重置，使每次重试创建新 task ID
    try {
      const created = await createTask(body)
      taskId = created.id
      console.log(
        `[Seedance] Created task ${taskId} (duration: ${args.duration}s, res: ${effectiveRes})`,
      )
    } catch (err) {
      const msg =
        err instanceof SeedanceError
          ? `❌ 创建任务失败 [${err.code}]: ${err.message}`
          : `❌ 创建任务失败: ${(err as Error).message}`
      console.error(`[Seedance] ${msg}`)
      return {
        title: "Seedance 任务创建失败",
        metadata: {
          operation: "seedance_v2",
          error: true,
          errorCode: err instanceof SeedanceError ? err.code : "network",
        },
        output: msg,
      }
    }

    // 轮询任务
    console.log(`[Seedance] Polling task ${taskId}...`)
    try {
      pollResult = await pollTask(taskId, args.duration ?? 5, signal)
      // fall through to success handling below
    } catch (err) {
      lastPollError = {
        code: err instanceof SeedanceError ? err.code : "unknown",
        message:
          err instanceof SeedanceError ? err.message : (err as Error).message,
      }
      console.error(
        `[Seedance] Task ${taskId} failed: ${(err as Error).message}`,
      )

      // 恢复树：Invalid video_url 且未超过重试上限 → 重新上传 + 重试
      const isInvalidVideoUrl =
        lastPollError.code === "server" &&
        lastPollError.message.includes("Invalid video_url")

      if (isInvalidVideoUrl && retryCount < MAX_VIDEO_URL_RETRIES) {
        retryCount++
        console.warn(
          `[Seedance] Invalid video_url (attempt ${retryCount}/${MAX_VIDEO_URL_RETRIES}), retrying with fresh upload...`,
        )
        continue
      }

      // 非可恢复错误或重试耗尽 → 返回失败
      const msg = `❌ 生成失败 [${lastPollError.code}]: ${lastPollError.message}`
      return {
        title: "Seedance 视频生成失败",
        metadata: {
          operation: "seedance_v2",
          error: true,
          taskId,
          errorCode: lastPollError.code,
          retryCount,
          retryExhausted: retryCount >= MAX_VIDEO_URL_RETRIES,
        },
        output: msg,
      }
    }
    /* ── 轮询成功 ── */

    const rawVideoUrl = pollResult!.content?.video_url
    if (!rawVideoUrl) {
      return {
        title: "Seedance 无输出",
        metadata: { operation: "seedance_v2", error: true, taskId },
        output: "❌ 任务已完成但未返回视频 URL，请重试或联系支持。",
      }
    }
    const videoUrl: string = rawVideoUrl

    // 输出路径沙箱校验（validatePath 统一处理白名单/原文件保护/重复调用检测）
    const outputPath = args.output || join(outputsDir, `seedance_${taskId}.mp4`)
    const sandbox = validatePath(outputsDir, outputPath, {
      protectOriginals: false,
      allowOverwrite: args.allow_overwrite,
    })
    if (!sandbox.ok) {
      return {
        title: "路径安全错误",
        metadata: { operation: "seedance_v2", error: true },
        output: sandbox.error || "❌ 输出路径校验失败。",
      }
    }
    const resolved = sandbox.outputPath!
    if (!args.allow_overwrite && existsSync(resolved)) {
      return {
        title: "文件已存在",
        metadata: {
          operation: "seedance_v2",
          success: true,
          undoable: true,
          skipped: true,
        },
        output: `输出文件已存在: ${resolved}（设置 allow_overwrite=true 覆盖）`,
      }
    }

    // 下载视频
    try {
      await downloadVideo(videoUrl, resolved, signal)
      console.log(`[Seedance] Task ${taskId} succeeded → ${resolved}`)
    } catch (err) {
      const msg = `❌ 下载失败: ${(err as Error).message}`
      console.error(`[Seedance] ${msg}`)
      return {
        title: "Seedance 下载失败",
        metadata: {
          operation: "seedance_v2",
          error: true,
          taskId,
          videoUrl,
        },
        output: msg,
      }
    }

    // ========================================================================
    // Step 6 — 输出文件校验（assertArtifact）
    // ========================================================================

    const artifact = await assertArtifact(resolved)
    if (!artifact.ok) {
      return {
        title: "Seedance 输出校验失败",
        metadata: {
          operation: "seedance_v2",
          error: true,
          taskId,
          videoUrl,
          artifact: {
            hasVideoStream: artifact.hasVideoStream,
            duration: artifact.duration,
          },
        },
        output: `❌ 输出文件校验失败: 文件已下载但 ffprobe 无法读取有效的视频流（hasVideo=${artifact.hasVideoStream}, duration=${artifact.duration}s）。`,
      }
    }
    if (!artifact.hasVideoStream) {
      console.warn(
        `[Seedance] Output ${resolved} missing video stream (audio only?)`,
      )
    }

    const cost = estimateCost(args.duration ?? 5, effectiveRes)

    const editOperations: EditOperation[] = [
      {
        operationId: generateOperationId(),
        undoable: true,
        type: "add_clip",
        clipId: generateClipId(),
        asset: {
          url: resolved,
          path: resolved,
          type: "video",
        },
        trackKind: "video",
        trackName: "主视频轨道",
        startTime: 0,
        duration: args.duration ?? 5,
        metadata: {
          toolName: "seedance_v2",
          description: `AI 生成视频: ${args.prompt.slice(0, 80)}`,
          timestamp: Date.now(),
        },
      },
    ]

    let output = `✅ 视频生成成功\n📁 输出: ${resolved}\n⏱ 时长: ${args.duration ?? 5}s\n📐 分辨率: ${effectiveRes}\n🎞 比例: ${args.ratio ?? "16:9"}\n💰 费用: ¥${cost.amount}`
    const allWarnings = [...normalizeWarnings, ...refWarnings]
    if (allWarnings.length > 0) {
      output += `\n\n⚠️ 参考文件检查:\n${allWarnings.map((w) => `- ${w}`).join("\n")}`
    }

    return {
      title: "Seedance 视频生成成功",
      metadata: {
        operation: "seedance_v2",
        success: true,
        undoable: true,
        taskId,
        model,
        duration: args.duration ?? 5,
        resolution: effectiveRes,
        ratio: args.ratio ?? "16:9",
        outputPath: resolved,
        cost,
        prompt: args.prompt.slice(0, 200),
      },
      output,
      editOperations,
    }
  }
  throw new Error("unreachable: for(;;) always returns within loop body")
}
