import { existsSync, readFileSync, statSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { basename, dirname, join, resolve, sep } from "node:path"
import { mkdir, unlink } from "node:fs/promises"
import { spawn } from "node:child_process"
import { generateObject } from "ai"
import z from "zod"
import { Tool } from "../../lib/tool.js"
import { SimpleProvider } from "../../lib/simple-provider.js"
import { uploadFileToOss } from "../../upload/oss-upload.js"
import { runFfmpeg, concatVideos } from "../../lib/ffmpeg-utils.js"
import { srtTimeToMillis, millisToFfmpegTime, millisToSrtTime } from "../../lib/time-utils.js"
import {
  generateOperationId,
  generateClipId,
  type EditOperation,
} from "../../protocol/edit-operations.js"

// ============================================================================
// 常量
// ============================================================================

/** 小于此阈值走多模态路径，大于则走 ASR → 文本路径 */
const MULTIMODAL_MAX_SEC = 120

/** 多模态 base64 内联上限 */
const MAX_INLINE_BYTES = 10 * 1024 * 1024

// ============================================================================
// Zod Schema — 两条路径共用
// ============================================================================

const ClipSegment = z.object({
  start: z.string().describe("开始时间 HH:MM:SS,mmm (如 00:01:32,450)"),
  end: z.string().describe("结束时间 HH:MM:SS,mmm (如 00:01:55,200)"),
  reason: z.string().describe("选择此片段的理由，需具体到画面或对话内容"),
})

const SmartClipOutput = z.object({
  clips: z.array(ClipSegment).min(1).max(10).describe("裁剪片段列表"),
  summary: z.string().describe("视频整体内容概述以及为什么这些片段值得被剪出"),
})

// ============================================================================
// 工具函数
// ============================================================================

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
    webm: "video/webm", mkv: "video/x-matroska", flv: "video/x-flv",
    wmv: "video/x-ms-wmv", mpg: "video/mpeg", mpeg: "video/mpeg",
  }
  return map[ext] || "video/mp4"
}

function getModelConfig() {
  const fromEnv = process.env.DASHSCOPE_API_KEY
  const fromConfig = (() => {
    try {
      const config = JSON.parse(readFileSync(join(process.cwd(), "config.json"), "utf-8"))
      return (config as any).dashscope?.apiKey || ""
    } catch { return "" }
  })()
  const apiKey = fromEnv || fromConfig
  const modelId = process.env.DASHSCOPE_MODEL || "qwen3.5-omni-flash"
  return { apiKey, modelId, providerID: "dashscope" }
}

/** 用 ffprobe 获取视频时长（秒） */
function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ])
    let stdout = ""
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    proc.on("close", () => {
      const sec = parseFloat(stdout.trim())
      resolve(isNaN(sec) ? 0 : sec)
    })
    proc.on("error", () => resolve(0))
  })
}

/**
 * DashScope Paraformer 语音识别。
 * 上传音频文件 → 返回句子级文本 + 毫秒级时间戳。
 */
async function transcribeWithDashScope(
  audioPath: string,
  apiKey: string,
): Promise<{
  text: string
  sentences: { text: string; beginMs: number; endMs: number }[]
}> {
  const audioData = readFileSync(audioPath)
  const formData = new FormData()
  formData.append("model", "paraformer-v2")
  formData.append("file", new Blob([audioData], { type: "audio/wav" }), basename(audioPath))
  formData.append("parameters", JSON.stringify({ sample_rate: 16000, format: "wav" }))

  const resp = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    },
  )

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "")
    throw new Error(`Paraformer API ${resp.status}: ${errText.slice(0, 300)}`)
  }

  const data = (await resp.json()) as any
  const sentences: { text: string; beginMs: number; endMs: number }[] =
    data?.output?.sentences ||
    data?.output?.sentence?.sentences ||
    []

  if (sentences.length === 0) {
    throw new Error(`Paraformer 返回空结果: ${JSON.stringify(data).slice(0, 200)}`)
  }

  const text = sentences.map((s) => s.text).join("")
  return { text, sentences }
}

// ============================================================================
// SmartClipTool
// ============================================================================

export const SmartClipTool = Tool.define("smart_clip", {
  description:
    "基于 AI 内容理解自动裁剪视频精彩片段。" +
    "短视频(≤2分钟)用多模态模型直接观看画面+听取音频；长视频先语音识别转文字再分析。" +
    "适用于：提取讲座要点、短视频精华、会议摘要、搞笑片段等场景。",

  parameters: z.object({
    input: z.string().describe("输入视频文件路径"),
    mode: z.enum(["auto", "guided"]).optional().default("auto").describe(
      "剪辑模式: auto=模型自主判断精彩内容, guided=根据 query 定位特定内容",
    ),
    query: z.string().optional().describe(
      "guided 模式下必填。描述要提取的内容类型，如 '找出所有提到 HTTP 协议的部分'",
    ),
    max_clips: z.number().min(1).max(10).optional().default(3).describe("最多裁剪几段"),
    output_dir: z.string().optional().describe("输出目录（默认: 视频所在目录）"),
    merge_output: z.boolean().optional().default(true).describe(
      "是否将多个片段拼接为单个输出文件",
    ),
  }),

  usageTemplate: {
    json: {
      input: "{source_video}",
      mode: "auto",
      max_clips: 3,
      merge_output: true,
      output_dir: "{output_dir}",
    },
    constraints: [
      "input 必须是存在的视频文件路径",
      "guided 模式下 query 必填且应具体描述内容",
      "max_clips 控制在 1-10 之间",
    ],
  },

  execute: async (args, ctx) => {
    // ── 1. 验证输入 ──────────────────────────────────────
    if (!existsSync(args.input)) {
      return {
        title: "Smart Clip Failed",
        metadata: { operation: "smart_clip", error: true },
        output: `Input video not found: ${args.input}`,
      }
    }

    // 安全沙箱: 确保输入和输出目录都在 CWD 范围内，防止路径穿越
    {
      const cwd = resolve(process.cwd())
      const inputResolved = resolve(args.input)
      if (!inputResolved.startsWith(cwd + sep)) {
        return {
          title: "Smart Clip Failed",
          metadata: { operation: "smart_clip", error: true },
          output: `Input file outside allowed scope: ${args.input}`,
        }
      }
      const workDir = resolve(args.output_dir || join(dirname(inputResolved), "smart_clip_outputs"))
      if (!workDir.startsWith(cwd + sep)) {
        return {
          title: "Smart Clip Failed",
          metadata: { operation: "smart_clip", error: true },
          output: `Output directory outside allowed scope: ${workDir}`,
        }
      }
    }

    if (args.mode === "guided" && !args.query?.trim()) {
      return {
        title: "Smart Clip Failed",
        metadata: { operation: "smart_clip", error: true },
        output: "guided 模式下 query 参数必填。",
      }
    }

    const modelCfg = getModelConfig()
    if (!modelCfg.apiKey) {
      return {
        title: "Smart Clip Failed",
        metadata: { operation: "smart_clip", error: true },
        output: "未配置 DASHSCOPE_API_KEY。",
      }
    }

    const durationSec = await getVideoDuration(args.input)
    const useMultimodal = durationSec > 0 && durationSec <= MULTIMODAL_MAX_SEC

    ctx.metadata({
      title: useMultimodal
        ? `多模态分析 (${Math.round(durationSec)}s 视频)`
        : `语音识别 → 文本分析 (${Math.round(durationSec)}s 视频)`,
    })

    // ── 2. 获取模型 ──────────────────────────────────────
    const model = await SimpleProvider.getLanguage(
      { providerID: modelCfg.providerID, id: modelCfg.modelId },
      { apiKey: modelCfg.apiKey },
    )

    // ── 3. 调用 LLM（两条路径：多模态 / 文本）───────────────
    let clips: z.infer<typeof ClipSegment>[]
    let summary: string
    let pathLabel = ""

    try {
      if (useMultimodal) {
        // ======= 路径 A: 多模态（≤2min）=======
        pathLabel = "multimodal"
        const result = await clipViaMultimodal(args, modelCfg, model)
        clips = result.clips
        summary = result.summary
      } else {
        // ======= 路径 B: ASR → 文本（>2min）=======
        pathLabel = "asr+text"
        const result = await clipViaAsrText(args, modelCfg, model, ctx.abort)
        clips = result.clips
        summary = result.summary
      }
    } catch (err: any) {
      return {
        title: "Smart Clip Failed",
        metadata: { operation: "smart_clip", error: true },
        output: `AI 分析视频失败 (${pathLabel}): ${err.message}`,
      }
    }

    if (!clips || clips.length === 0) {
      return {
        title: "Smart Clip — 无片段",
        metadata: { operation: "smart_clip", path: pathLabel, durationSec },
        output: `AI 没有从视频中选出合适的片段。\n\n分析摘要: ${summary || "无"}`,
      }
    }

    // ── 4. FFmpeg 裁剪 + 拼接（两条路径共用）───────────────
    return await executeClips(args, clips, summary, pathLabel, durationSec, ctx)
  },
})

// ============================================================================
// 路径 A: 多模态
// ============================================================================

async function clipViaMultimodal(
  args: any,
  modelCfg: ReturnType<typeof getModelConfig>,
  model: any,
): Promise<{ clips: z.infer<typeof ClipSegment>[]; summary: string }> {
  const fileStat = statSync(args.input)
  const ext = basename(args.input).split(".").pop()?.toLowerCase() || "mp4"
  const mimeType = getMimeType(ext)

  const systemPrompt = `你是一个专业的视频剪辑师和分析师。你正在"观看"一段视频的全部画面帧和音频波形。

请仔细分析视频的内容、节奏和亮点，选出最值得裁剪的片段。

规则：
- 每个片段的 start/end 必须是 HH:MM:SS,mmm 格式（如 00:01:32,450）
- 片段应有完整语义，优先在自然的语义边界处裁剪
- reason 字段要具体，引用实际的画面或对话内容
- 按时间顺序排列 clips
- 片段之间不要有重叠`

  const userPrompt = args.mode === "guided" && args.query
    ? `请从这段视频中找出与以下需求相关的内容片段：\n"${args.query}"\n\n最多选择 ${args.max_clips} 段。`
    : `请分析这段视频，选出最精彩的 ${args.max_clips} 段内容。\n优先选择：信息密度高、表达清晰、有情感起伏、或包含关键结论的片段。`

  const contentParts: any[] = []

  if (fileStat.size <= MAX_INLINE_BYTES) {
    const videoData = readFileSync(args.input)
    contentParts.push({ type: "text", text: userPrompt })
    contentParts.push({
      type: "file",
      data: videoData.toString("base64"),
      mediaType: mimeType,
    })
  } else {
    const uploadResult = await uploadFileToOss(args.input, modelCfg.modelId, modelCfg.apiKey)
    contentParts.push({
      type: "text",
      text: `${userPrompt}\n\n[DASHSCOPE_VIDEO:${uploadResult.ossUrl}]`,
    })
  }

  const result = await generateObject({
    model,
    schema: SmartClipOutput,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: contentParts },
    ],
    temperature: 0.3,
    maxOutputTokens: 4096,
  })

  return { clips: result.object.clips, summary: result.object.summary }
}

// ============================================================================
// 路径 B: ASR → 文本 → LLM
// ============================================================================

async function clipViaAsrText(
  args: any,
  modelCfg: ReturnType<typeof getModelConfig>,
  model: any,
  signal?: AbortSignal,
): Promise<{ clips: z.infer<typeof ClipSegment>[]; summary: string }> {
  // B1. 提取音频
  const tmpDir = join(args.input, "..", ".smart_clip_tmp")
  await mkdir(tmpDir, { recursive: true })
  const audioPath = join(tmpDir, `audio_${randomUUID().slice(0, 8)}.wav`)

  console.log("[smart_clip] Extracting audio to WAV (16kHz mono)...")
  const extractResult = await runFfmpeg([
    "-i", args.input,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "16000",
    "-ac", "1",
    "-y", audioPath,
  ], signal)

  if (!extractResult.success) {
    throw new Error(`音频提取失败: ${extractResult.error}`)
  }

  // B2. 语音识别
  console.log("[smart_clip] Calling DashScope Paraformer...")
  const { text, sentences } = await transcribeWithDashScope(audioPath, modelCfg.apiKey)

  // 清理临时文件
  try { await unlink(audioPath) } catch {}

  if (!text.trim()) {
    throw new Error("语音识别结果为空，视频可能没有可识别的语音内容。")
  }

  // B3. 构建带时间戳的文本供 LLM 分析
  const timestampedLines = sentences.map((s, i) =>
    `[${millisToSrtTime(s.beginMs)}] ${s.text}`
  )
  const transcriptBlock = timestampedLines.join("\n")

  const systemPrompt = `你是一个专业的视频剪辑师。以下是一段视频的语音识别转录文本，每行前面的 [HH:MM:SS,mmm] 是该句的精确开始时间。

请仔细阅读内容，选出最值得裁剪的片段。

规则：
- 每个片段的 start 必须精确等于对应句子前标注的时间戳（HH:MM:SS,mmm 格式）
- end 必须精确等于该片段最后一句的结束时间（你需要根据上下文推算，通常在下一句的开始时间前后）
- 片段应有完整语义，优先在自然的语义边界处裁剪
- reason 字段要具体，引用实际对话内容
- 按时间顺序排列 clips`

  const userPrompt = args.mode === "guided" && args.query
    ? `请从以下转录文本中找出与需求相关的片段：\n"${args.query}"\n\n最多选择 ${args.max_clips} 段。\n\n--- 视频转录文本 ---\n${transcriptBlock}`
    : `请从以下转录文本中选出最精彩的 ${args.max_clips} 段。\n优先选择：信息密度高、表达清晰、有情感起伏、或包含关键结论的片段。\n\n--- 视频转录文本 ---\n${transcriptBlock}`

  const result = await generateObject({
    model,
    schema: SmartClipOutput,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    maxOutputTokens: 4096,
  })

  return { clips: result.object.clips, summary: result.object.summary }
}

// ============================================================================
// 共享: FFmpeg 裁剪 + 拼接
// ============================================================================

async function executeClips(
  args: any,
  clips: z.infer<typeof ClipSegment>[],
  summary: string,
  pathLabel: string,
  durationSec: number,
  ctx: any,
) {
  const workDir = args.output_dir || join(args.input, "..", "smart_clip_outputs")
  await mkdir(workDir, { recursive: true })

  const clipFiles: string[] = []
  const clipLog: string[] = []

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    ctx.metadata({
      title: `裁剪片段 ${i + 1}/${clips.length}: ${clip.start} → ${clip.end}`,
    })

    const startMs = srtTimeToMillis(clip.start)
    const endMs = srtTimeToMillis(clip.end)
    const startSec = millisToFfmpegTime(startMs)
    const endSec = millisToFfmpegTime(endMs)

    const outPath = join(workDir, `clip_${i + 1}_${randomUUID().slice(0, 8)}.mp4`)
    const ffResult = await runFfmpeg([
      "-i", args.input,
      "-ss", startSec,
      "-to", endSec,
      "-c:v", "libx264",
      "-c:a", "aac",
      "-y", outPath,
    ], ctx.abort)

    if (ffResult.success) {
      clipFiles.push(outPath)
      clipLog.push(`片段 ${i + 1}: ${clip.start} → ${clip.end} | ${clip.reason}`)
    } else {
      clipLog.push(`片段 ${i + 1}: 裁剪失败 — ${ffResult.error || "未知错误"}`)
    }
  }

  if (clipFiles.length === 0) {
    return {
      title: "Smart Clip Failed",
      metadata: { operation: "smart_clip", error: true, path: pathLabel, durationSec },
      output: `AI 选出了 ${clips.length} 个片段，但 FFmpeg 裁剪全部失败。`,
    }
  }

  let finalOutput: string
  if (args.merge_output && clipFiles.length > 1) {
    const mergedPath = join(workDir, `smart_clip_merged_${randomUUID().slice(0, 8)}.mp4`)
    const catResult = await concatVideos(clipFiles, mergedPath)
    if (catResult.success) {
      finalOutput = mergedPath
      for (const f of clipFiles) {
        try { await unlink(f) } catch {}
      }
    } else {
      finalOutput = clipFiles[0]
    }
  } else if (clipFiles.length === 1) {
    finalOutput = clipFiles[0]
  } else {
    finalOutput = workDir
  }

  const durationLabel = durationSec > 0 ? `${Math.round(durationSec)}s` : "未知时长"
  const clipDetail = clipLog.join("\n")
  const outputMessage =
    `路径: ${pathLabel} | 视频时长: ${durationLabel}\n` +
    `AI 选出 ${clips.length} 个片段：\n\n${clipDetail}\n\n` +
    `分析摘要: ${summary}\n\n输出: ${finalOutput}`

  const editOperations: EditOperation[] = [{
    operationId: generateOperationId(),
    type: "add_clip" as const,
    clipId: generateClipId(),
    asset: {
      url: finalOutput,
      path: finalOutput,
      type: "video",
    },
    trackKind: "video",
    trackName: "视频轨道",
    startTime: 0,
    duration: 0,
    metadata: {
      toolName: "smart_clip",
      description: `AI 智能裁剪: ${clips.length} 个片段 (${pathLabel})`,
      timestamp: Date.now(),
    },
  }]

  return {
    title: `Smart Clip — ${clips.length} 个片段 (${pathLabel})`,
    metadata: {
      operation: "smart_clip",
      success: true,
      undoable: true,
      inputPath: args.input,
      clipCount: clips.length,
      outputPath: finalOutput,
      summary,
      path: pathLabel,
      durationSec,
    },
    output: outputMessage,
    editOperations,
  }
}
