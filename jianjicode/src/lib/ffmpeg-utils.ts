/**
 * FFmpeg 工具函数库 — 纯 FFmpeg/FFprobe 操作的薄封装。
 *
 * === 职责 ===
 * - 查找 ffmpeg/ffprobe 可执行文件路径
 * - 视频裁剪、拼接、格式转换、音频提取/合并
 * - 探测音视频元数据（时长/fps/分辨率/编码）
 * - 硬件加速检测（CUDA/QSV/AMF 等）
 * - 进程生命周期管理：追踪当前 FFmpeg 子进程，响应前端「停止」按钮
 *
 * ⚠️ 写新工具前，先看 ffmpeg-sandbox.ts 顶部的《新工具开发规范》（沙箱 + abort + editOperations）
 *
 * ============================================================================
 *  函数调用层级 — 底层只有一个 runFfmpegEx，上面全是便利壳
 * ============================================================================
 *
 *   所有 22 个视频工具最终都只调一个底层函数: runFfmpegEx()。
 *   上面两层壳只是为了少写重复代码，不是独立分支。
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ 各独立工具 (trim.ts, video_filter.ts, concat.ts, tts.ts ...)    │
 *   │ 负责: 参数校验 + 安全沙箱(validatePath) + 阶段门禁              │
 *   └──────────────────────────────────────────────────────────────────┘
 *                                    │
 *                                    │ 调用方式有三种，但最终都汇聚到一个底层
 *                                    │
 *            ┌───────────────────────┼───────────────────────┐
 *            │                       │                       │
 *            ▼                       ▼                       ▼
 *   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
 *   │  高级 helper      │  │  runFfmpeg()     │  │  probe (只读)     │
 *   │                  │  │                  │  │                  │
 *   │  trimVideo()     │  │  薄壳，3 行代码:  │  │  probeDuration() │
 *   │  concatVideos()  │  │  signal 塞进     │  │  probeMetadata() │
 *   │  convertVideo()  │  │  options 然后调  │  │                  │
 *   │  extractAudio()  │  │  runFfmpegEx     │  │  调的是 ffprobe  │
 *   │  mergeAudio()    │  │                  │  │  (不同二进制)     │
 *   │                  │  │                  │  │  只读元数据,不转码│
 *   │  帮你拼 ffmpeg   │  │                  │  │                  │
 *   │  参数,内部调     │  │                  │  │                  │
 *   │  runFfmpeg →     │  │                  │  │                  │
 *   │  runFfmpegEx     │  │                  │  │                  │
 *   └────────┬─────────┘  └────────┬─────────┘  └──────────────────┘
 *            │                     │
 *            │   ┌─────────────────┘
 *            │   │
 *            ▼   ▼
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  runFfmpegEx(args, options)  ← 唯一底层，整个文件就这一个真身     │
 *   │                                                                  │
 *   │  spawn("ffmpeg", args) → 管理子进程生命周期                      │
 *   │  监听 abort 信号 → proc.kill()                                    │
 *   │  追踪 currentFfmpegProcess                                        │
 *   │                                                                  │
 *   │  所有 FFmpeg 操作最终都进这个函数，没有例外。                      │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 *   为什么有两层壳？不是过度设计。
 *   - runFfmpeg(args, signal?) : 只是把 signal 转成 options 对象。
 *     因为大部分工具只需要传 ctx.abort，不想每次写 { signal: ctx.abort }。
 *   - trimVideo/convertVideo 等: 把常用参数拼成 ffmpeg 命令行。
 *     比如 trimVideo("a.mp4","b.mp4","00:01","00:05") →
 *     ffmpeg -i a.mp4 -ss 00:01 -to 00:05 b.mp4。
 *     没有这些 helper 的话每个工具都要自己拼一遍同样的参数。
 *
 *   总结: 不管你看到工具调的是 runFfmpeg 还是 trimVideo 还是 mergeAudio，
 *   最终都从 runFfmpegEx 这一个入口 spawn ffmpeg.exe。
 *
 * ============================================================================
 *  进程中断链 — 从用户点击「停止」到 FFmpeg 被杀掉的完整路径
 * ============================================================================
 *
 *   Layer 1: Agent 框架（tool.ts）
 *   ─────────────────────────────
 *   前端用户点「停止」按钮
 *        │
 *        ▼
 *   ctx.abort (AbortSignal) 触发         ← 框架注入到每个 tool 的 execute(ctx) 中
 *
 *
 *   Layer 2: 各独立工具（trim.ts / video_filter.ts / ...）
 *   ──────────────────────────────────────────────────────
 *   工具在调用本文件时，把 ctx.abort 传下去:
 *
 *     const result = await runFfmpeg(ffmpegArgs, ctx.abort)
 *     const result = await concatVideos(inputs, output, ctx.abort)
 *
 *   工具本身不写 abort 监听器，全部透传给本文件统一处理。
 *
 *
 *   Layer 3: 本文件（ffmpeg-utils.ts）
 *   ──────────────────────────────────
 *
 *   spawn("ffmpeg", args) 返回的 ChildProcess 对象（下面简称 proc）
 *   同时存在两份引用，作用不同:
 *
 *     proc (局部变量)              ← 只有 runFfmpegEx 函数作用域内能访问
 *     currentFfmpegProcess (模块级) ← 整个模块都能访问，stopCurrentProcess() 靠它找进程
 *
 *   两者指向同一个 ChildProcess，只是通过不同变量名访问。
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ 主路径 — runFfmpegEx 内部（第 247 行）                             │
 *   │                                                                   │
 *   │   const proc = spawn("ffmpeg", args)    // 局部变量               │
 *   │   currentFfmpegProcess = proc           // 同步挂到模块级         │
 *   │                                                                   │
 *   │   signal.addEventListener("abort", () => {                        │
 *   │     proc.kill()               // 用局部变量直接 kill，不需要绕一圈  │
 *   │     currentFfmpegProcess = null  // 清理模块级引用，防止悬空指针   │
 *   │   })                                                              │
 *   │                                                                   │
 *   │   所有标准 FFmpeg 工具都走这条路径。                               │
 *   │   signal 由工具传入 ctx.abort，本文件内部监听 → kill → 清理。      │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ 兜底路径 — stopCurrentProcess()（第 749 行）                       │
 *   │                                                                   │
 *   │   stopCurrentProcess()                                            │
 *   │     └─ currentFfmpegProcess?.kill()   // 通过模块变量找到进程     │
 *   │                                                                   │
 *   │   为什么需要这个兜底？因为 proc 是 runFfmpegEx 的局部变量，        │
 *   │   外部函数 stopCurrentProcess() 拿不到它。只能通过模块级变量       │
 *   │   currentFfmpegProcess 间接访问同一个 ChildProcess。               │
 *   │                                                                   │
 *   │   使用场景:                                                       │
 *   │   - 不走 runFfmpegEx 的工具（自己 spawn 子进程，                  │
 *   │     但把进程引用手动赋给 currentFfmpegProcess）                    │
 *   │   - 外部模块需要强制终止最后一次 FFmpeg 操作                      │
 *   │                                                                   │
 *   │   走 runFfmpegEx({ signal }) 的工具不需要调用它——                 │
 *   │   abort 信号已经在 runFfmpegEx 内部通过局部 proc.kill() 处理了。   │
 *   └───────────────────────────────────────────────────────────────────┘
 *
 *   proc 和 currentFfmpegProcess 指向同一个 ChildProcess。
 *   runFfmpegEx 在进程退出、abort、或启动失败时都会置 null，
 *   确保 stopCurrentProcess() 不会拿到一个已结束的进程引用。
 *
 * ============================================================================
 *
 * === 与上层工具的关系 ===
 * 本文件是「库」——不依赖 AI agent 体系，可被任何模块直接 import。
 * 上层工具（trim / concat / convert / extract-audio / merge-audio /
 * video_filter / video_speed / video_mask / video_pip / video_watermark /
 * video_stabilization / lut_filter / audio_effects / video_subtitle /
 * keyframe_animation / video_transition 等）
 * 负责参数校验、安全沙箱（validatePath）、阶段门禁，实际 FFmpeg 执行全部委托给本文件。
 *
 * 完整调用链路：
 *   前端停止按钮 → ctx.abort → 工具透传 → runFfmpegEx 内部 kill → ffmpeg.exe 终止
 */
import { type ChildProcess, execSync, spawn, spawnSync } from "child_process"
import { existsSync, mkdirSync } from "fs"
import { dirname, join } from "path"

const __dirname = process.cwd()

/**
 * 模块级变量 — 始终指向最近一次 runFfmpegEx 创建的 FFmpeg ChildProcess。
 *
 * 两个消费者:
 *   1. runFfmpegEx 内部 — spawn 时赋值，close/abort/error 时置 null
 *   2. stopCurrentProcess() — 兜底开关，通过这个引用找到并 kill 进程
 *
 * 走 runFfmpegEx({ signal }) 的工具不需要关心这个变量，
 * abort 信号已经在 runFfmpegEx 内部通过 proc.kill() 直接处理了。
 */
let currentFfmpegProcess: ChildProcess | null = null

let cachedHwaccels: string[] | null = null
let cachedH264Encoders: string[] | null = null
let cachedBestConfig: {
  hwaccel: string | null
  encoder: string | null
} | null = null

export interface FfmpegOptions {
  hwaccel?: string
  encoder?: string
  decoder?: string
  hwDevice?: number
  extraArgs?: string[]
  timeout?: number
  logProgress?: boolean
  /** 上层工具的 ctx.abort，用户取消时 kill 当前 FFmpeg 进程 */
  signal?: AbortSignal
}

export function findFfmpegPath(): string | null {
  // Check environment variable for custom path first
  const envPath = process.env.JIANJICODE_FFMPEG_PATH || process.env.FFMPEG_PATH
  if (envPath && existsSync(envPath)) return envPath

  try {
    execSync("ffmpeg -version", { stdio: "ignore" })
    return "ffmpeg"
  } catch {
    const platform = process.platform
    const ffmpegExe = platform === "win32" ? "ffmpeg.exe" : "ffmpeg"

    // ffmpeg-static package locations (check first — most reliable bundled option)
    const ffmpegStaticPaths = [
      join(process.cwd(), "node_modules", "ffmpeg-static", ffmpegExe),
      join(
        process.cwd(),
        "jianjicode",
        "node_modules",
        "ffmpeg-static",
        ffmpegExe,
      ),
      join(__dirname, "node_modules", "ffmpeg-static", ffmpegExe),
      join(__dirname, "..", "node_modules", "ffmpeg-static", ffmpegExe),
      join(__dirname, "..", "..", "node_modules", "ffmpeg-static", ffmpegExe),
    ]
    for (const ffmpegStaticPath of ffmpegStaticPaths) {
      if (existsSync(ffmpegStaticPath)) return ffmpegStaticPath
    }

    const possiblePaths = [
      join(
        __dirname,
        "..",
        "..",
        "..",
        "resources",
        "ffmpeg",
        platform,
        ffmpegExe,
      ),
      join(process.cwd(), "resources", "ffmpeg", platform, ffmpegExe),
      join(process.cwd(), "..", "resources", "ffmpeg", platform, ffmpegExe),
      join(__dirname, "..", "..", "..", "ffmpeg", "ffmpeg"),
      join(__dirname, "..", "..", "..", "ffmpeg.exe"),
      join(process.cwd(), "ffmpeg", "ffmpeg"),
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
      "/usr/local/bin/ffmpeg",
      "/usr/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
    ]

    for (const path of possiblePaths) {
      if (existsSync(path)) return path
    }

    return null
  }
}

export function detectHardwareAcceleration(): string[] {
  if (cachedHwaccels !== null) return cachedHwaccels

  try {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      cachedHwaccels = []
      return []
    }

    const result = spawnSync(ffmpegPath, ["-hwaccels"], { encoding: "utf8" })
    const output = (result.stdout || "") + (result.stderr || "")

    const hwaccels: string[] = []
    const lines = output.split("\n")
    let inList = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.toLowerCase().includes("hardware acceleration methods:")) {
        inList = true
        continue
      }
      if (inList && trimmed) {
        if (trimmed.includes("--") || trimmed.includes("==")) break
        hwaccels.push(trimmed.toLowerCase())
      }
    }

    cachedHwaccels = hwaccels.filter((h) => h && !h.includes(" "))
    return cachedHwaccels
  } catch (error) {
    console.warn("Failed to detect hardware acceleration:", error)
    cachedHwaccels = []
    return []
  }
}

export function getHardwareEncoders(codec: string = "h264"): string[] {
  if (codec === "h264" && cachedH264Encoders !== null) return cachedH264Encoders

  try {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      if (codec === "h264") cachedH264Encoders = []
      return []
    }

    const result = spawnSync(ffmpegPath, ["-encoders"], { encoding: "utf8" })
    const output = (result.stdout || "") + (result.stderr || "")

    const encoders: string[] = []
    const lines = output.split("\n")
    const targetPattern = new RegExp(
      `${codec}_(nvenc|qsv|amf|vaapi|videotoolbox|omx|mfx|mediacodec)`,
      "i",
    )

    for (const line of lines) {
      if (line.trim().startsWith("V")) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 2) {
          const encoder = parts[1]
          if (targetPattern.test(encoder)) encoders.push(encoder)
        }
      }
    }

    if (codec === "h264") cachedH264Encoders = encoders
    return encoders
  } catch (error) {
    console.warn("Failed to get hardware encoders:", error)
    if (codec === "h264") cachedH264Encoders = []
    return []
  }
}

export function detectBestHardwareAcceleration(): {
  hwaccel: string | null
  encoder: string | null
} {
  if (cachedBestConfig !== null) return cachedBestConfig

  const hwaccels = detectHardwareAcceleration()
  const h264Encoders = getHardwareEncoders("h264")

  const hwaccelPriority = [
    "cuda",
    "dxva2",
    "qsv",
    "vaapi",
    "videotoolbox",
    "d3d11va",
    "opencl",
  ]
  const encoderPriority = [
    "h264_nvenc",
    "h264_qsv",
    "h264_amf",
    "h264_vaapi",
    "h264_videotoolbox",
  ]

  let bestHwaccel: string | null = null
  let bestEncoder: string | null = null

  for (const hw of hwaccelPriority) {
    if (hwaccels.includes(hw)) {
      bestHwaccel = hw
      break
    }
  }
  for (const enc of encoderPriority) {
    if (h264Encoders.includes(enc)) {
      bestEncoder = enc
      break
    }
  }

  cachedBestConfig = { hwaccel: bestHwaccel, encoder: bestEncoder }
  return cachedBestConfig
}

export function runFfmpegEx(
  args: string[],
  options: FfmpegOptions = {},
): Promise<{ success: boolean; error?: string; output?: string }> {
  return new Promise((resolve) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) {
      resolve({
        success: false,
        error:
          "FFmpeg not found. Please install FFmpeg or ensure it is in PATH.",
      })
      return
    }

    const finalArgs: string[] = []

    if (options.hwaccel) {
      finalArgs.push("-hwaccel", options.hwaccel)
      if (options.hwDevice !== undefined) {
        finalArgs.push("-hwaccel_device", options.hwDevice.toString())
      }
    }

    if (options.extraArgs) finalArgs.push(...options.extraArgs)

    finalArgs.push(...args)

    if (options.encoder) {
      let replaced = false
      for (let i = 0; i < finalArgs.length; i++) {
        if (finalArgs[i] === "-c:v" && i + 1 < finalArgs.length) {
          finalArgs[i + 1] = options.encoder
          replaced = true
          break
        }
      }
      if (!replaced) {
        const outputIndex = finalArgs.findIndex(
          (arg) =>
            arg.endsWith(".mp4") ||
            arg.endsWith(".mkv") ||
            arg.endsWith(".mov") ||
            arg.endsWith(".avi") ||
            arg.endsWith(".webm"),
        )
        if (outputIndex > 0) {
          finalArgs.splice(outputIndex, 0, "-c:v", options.encoder)
        } else {
          finalArgs.push("-c:v", options.encoder)
        }
      }
    }

    const logProgress = options.logProgress !== false

    console.log(`[ffmpeg] Running: ${ffmpegPath} ${finalArgs.join(" ")}`)

    const proc = spawn(ffmpegPath, finalArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    })

    // proc 是局部变量，只有本函数能直接拿到。但 stopCurrentProcess() 是外部
    // 调用的，进不了这个作用域。所以把 proc 也挂到模块级，让外部能通过
    // currentFfmpegProcess 找到同一个 ChildProcess 对象。
    currentFfmpegProcess = proc

    let stdout = ""
    let stderr = ""

    // 响应前端「停止」按钮: ctx.abort → kill FFmpeg 子进程
    //
    // 这里直接用局部 proc.kill()（不需要通过 currentFfmpegProcess），
    // 因为 abort handler 闭包内能拿到 proc。但同时要把 currentFfmpegProcess
    // 置 null，否则 stopCurrentProcess() 会以为还有进程在跑。
    const onAbort = () => {
      console.log("[ffmpeg] Aborted by user, killing process")
      proc.kill()
      currentFfmpegProcess = null
    }
    if (options.signal) {
      // 竞态防护: signal 可能在 spawn 和 addEventListener 之间就 fire 了
      if (options.signal.aborted) {
        proc.kill()
        currentFfmpegProcess = null
        resolve({ success: false, error: "Aborted before process started" })
        return
      }
      options.signal.addEventListener("abort", onAbort, { once: true })
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
      if (logProgress) {
        const lines = chunk.toString().trim().split("\n")
        for (const line of lines) {
          if (
            line.includes("frame=") ||
            line.includes("time=") ||
            line.includes("speed=")
          ) {
            console.log(`[ffmpeg] ${line.trim()}`)
          }
        }
      }
    })

    proc.on("close", (code) => {
      // 进程已自然退出: 清理 abort 监听器 + 置空模块级引用
      if (options.signal) options.signal.removeEventListener("abort", onAbort)
      currentFfmpegProcess = null
      if (code === 0) {
        resolve({ success: true, output: stdout + stderr })
      } else {
        const errorLines = stderr
          .split("\n")
          .filter((l) => l.trim())
          .slice(-5)
          .join("\n")
        resolve({
          success: false,
          error: `FFmpeg failed (code ${code}): ${errorLines.slice(0, 300)}`,
        })
      }
    })

    proc.on("error", (err) => {
      // 进程启动失败: 同样清理 abort 监听器和模块级引用
      if (options.signal) options.signal.removeEventListener("abort", onAbort)
      currentFfmpegProcess = null
      resolve({
        success: false,
        error: `Failed to start ffmpeg: ${err.message}`,
      })
    })
  })
}

/**
 * 便捷方法 — 等价于 runFfmpegEx(args, { signal })。
 * 各独立 tool 应传入 ctx.abort，确保用户取消时能终止 FFmpeg 进程。
 */
export function runFfmpeg(
  args: string[],
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string; output?: string }> {
  return runFfmpegEx(args, { signal })
}

export async function trimVideo(
  inputPath: string,
  outputPath: string,
  startTime: string,
  endTime?: string,
  signal?: AbortSignal,
): Promise<any> {
  mkdirSync(dirname(outputPath), { recursive: true })
  const args = ["-ss", startTime]

  if (endTime) {
    args.push("-to", endTime)
  }

  args.push("-i", inputPath)

  args.push(
    "-vf",
    "setpts=PTS-STARTPTS",
    "-af",
    "asetpts=PTS-STARTPTS",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    "-async",
    "1",
    "-avoid_negative_ts",
    "make_zero",
    "-loglevel",
    "error",
    "-y",
    outputPath,
  )

  return await runFfmpeg(args, signal)
}

export async function concatVideos(
  inputPaths: string[],
  outputPath: string,
  signal?: AbortSignal,
): Promise<any> {
  mkdirSync(dirname(outputPath), { recursive: true })
  const fileList = inputPaths.map((path) => `file '${path}'`).join("\n")
  const { writeFileSync, unlinkSync } = await import("fs")
  const tempListPath = join(process.cwd(), "concat_list.txt")
  writeFileSync(tempListPath, fileList)

  const args = [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    tempListPath,
    "-c",
    "copy",
    "-y",
    outputPath,
  ]
  const result = await runFfmpeg(args, signal)

  try {
    unlinkSync(tempListPath)
  } catch (e) {
    /* ignore */
  }
  return result
}

export async function convertVideo(
  inputPath: string,
  outputPath: string,
  codec?: string,
  audioCodec?: string,
  signal?: AbortSignal,
): Promise<any> {
  mkdirSync(dirname(outputPath), { recursive: true })
  const args = [
    "-i",
    inputPath,
    "-c:v",
    codec || "libx264",
    "-c:a",
    audioCodec || "copy",
    "-y",
    outputPath,
  ]
  return await runFfmpeg(args, signal)
}

export async function extractAudio(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<any> {
  const args = [
    "-i",
    inputPath,
    "-vn",
    "-c:a",
    "mp3",
    "-b:a",
    "192k",
    "-y",
    outputPath,
  ]
  return await runFfmpeg(args)
}

export async function mergeAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  bgmVolume?: number,
  signal?: AbortSignal,
  replaceAudio?: boolean,
): Promise<any> {
  // Replace mode: strip original audio entirely, use only new music
  // -map 0:v takes video only from input 0, -map 1:a takes audio only from input 1
  if (replaceAudio) {
    const args = [
      "-i",
      videoPath,
      "-stream_loop",
      "-1",
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      "-y",
      outputPath,
    ]
    return await runFfmpeg(args)
  }
  if (bgmVolume !== undefined) {
    // Enhanced mode: BGM looping with volume control via filter_complex
    // Keeps original audio mixed with BGM (for background music overlay)
    const filterComplex = `[0:a]volume=1.0[a1]; [1:a]volume=${bgmVolume}[a2]; [a1][a2]amix=inputs=2:duration=longest[aout]`
    const args = [
      "-i",
      videoPath,
      "-stream_loop",
      "-1",
      "-i",
      audioPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "0:v?",
      "-map",
      "[aout]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      "-y",
      outputPath,
    ]
    return await runFfmpeg(args)
  }
  // Simple mode: one-shot merge
  const args = [
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    "-y",
    outputPath,
  ]
  return await runFfmpeg(args)
}

export async function getVideoInfo(inputPath: string): Promise<any> {
  try {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return { success: false, error: "FFmpeg not found" }

    const probePath = findFfprobePath()
    if (probePath) {
      const result = spawnSync(
        probePath,
        [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          inputPath,
        ],
        { encoding: "utf8" },
      )

      if (result.status === 0)
        return { success: true, data: JSON.parse(result.stdout) }
    }

    const result = spawnSync(ffmpegPath, ["-i", inputPath], {
      encoding: "utf8",
    })
    const output = (result.stdout || "") + (result.stderr || "")
    return { success: true, raw: output }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

// ================================================================
// 便捷封装 — ffprobe / ffmpeg 高频操作
// ================================================================

/** 查找 ffprobe 可执行文件路径 */
export function findFfprobePath(): string | null {
  const envPath = process.env.FFPROBE_PATH
  if (envPath && existsSync(envPath)) return envPath

  const ffmpegPath = findFfmpegPath()
  if (!ffmpegPath) return null

  // "ffmpeg" (on PATH) → "ffprobe" also on PATH
  if (ffmpegPath === "ffmpeg") {
    try {
      execSync("ffprobe -version", { stdio: "ignore" })
      return "ffprobe"
    } catch {
      /* fall through to path derivation */
    }
  }

  // Derive from ffmpeg path: ffmpeg.exe → ffprobe.exe
  const probeExe = process.platform === "win32" ? "ffprobe.exe" : "ffprobe"
  const derived = ffmpegPath.replace(/ffmpeg(\.exe)?$/, probeExe)
  if (existsSync(derived)) return derived

  // Try common locations
  const commonPaths = [
    join(dirname(ffmpegPath), probeExe),
    join(process.cwd(), "resources", "ffmpeg", process.platform, probeExe),
    "d:/softDownload/bin/ffprobe.exe",
  ]
  for (const p of commonPaths) {
    if (existsSync(p)) return p
  }

  return null
}

/** 探测音视频时长（秒） */
export function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const probePath = findFfprobePath()
    if (!probePath) return reject(new Error("ffprobe not found"))
    const proc = spawn(probePath, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ])
    let stdout = ""
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    proc.on("close", (code: number) => {
      if (code === 0) resolve(parseFloat(stdout.trim()) || 0)
      else reject(new Error(`ffprobe exit ${code}`))
    })
    proc.on("error", reject)
  })
}

/** 探测视频完整元数据（时长/fps/分辨率/编码） */
export function probeMetadata(filePath: string): Promise<{
  duration: number
  fps: number
  width: number
  height: number
  codec: string
}> {
  return new Promise((resolve, reject) => {
    const probePath = findFfprobePath()
    if (!probePath) return reject(new Error("ffprobe not found"))
    const proc = spawn(probePath, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=r_frame_rate,duration,width,height,codec_name",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ])
    let stdout = ""
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    proc.on("close", (code: number) => {
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}`))
      const lines = stdout.trim().split("\n")
      const fpsStr = lines[0] || "0/1"
      const [num, den] = fpsStr.split("/").map(Number)
      resolve({
        fps: den > 0 ? num / den : 0,
        duration: parseFloat(lines[1]) || 0,
        width: parseInt(lines[2]) || 0,
        height: parseInt(lines[3]) || 0,
        codec: lines[4] || "unknown",
      })
    })
    proc.on("error", reject)
  })
}

/** 音频归一化：统一采样率/码率/声道 */
export function normalizeAudio(
  inputPath: string,
  outputPath: string,
  options?: { sampleRate?: number; bitrate?: string; channels?: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return reject(new Error("ffmpeg not found"))
    mkdirSync(dirname(outputPath), { recursive: true })
    const proc = spawn(ffmpegPath, [
      "-i",
      inputPath,
      "-ar",
      String(options?.sampleRate ?? 44100),
      "-ab",
      options?.bitrate ?? "192k",
      "-ac",
      String(options?.channels ?? 2),
      "-y",
      outputPath,
    ])
    proc.on("close", (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg normalize exit ${code}`))
    })
    proc.on("error", reject)
  })
}

/** 拼接多个音频文件 */
export function concatAudioFiles(
  fileList: string[],
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return reject(new Error("ffmpeg not found"))
    mkdirSync(dirname(outputPath), { recursive: true })
    const proc = spawn(ffmpegPath, [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      `concat:${fileList.join("|")}`,
      "-c",
      "copy",
      "-y",
      outputPath,
    ])
    proc.on("close", (code: number) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg concat exit ${code}`))
    })
    proc.on("error", reject)
  })
}

/**
 * 强制终止当前正在运行的 FFmpeg 进程（如果有）。
 *
 * 这是「兜底开关」——对走 runFfmpegEx 的工具，abort 信号已经在
 * runFfmpegEx 内部直接 proc.kill() 了，不需要调这个函数。
 *
 * 只在以下场景才需要手动调用:
 *   - 工具不走 runFfmpegEx，自己 spawn 了进程
 *   - 外部模块需要无条件终止最后一次 FFmpeg 操作
 *
 * 原理: 模块级变量 currentFfmpegProcess 始终指向最近一次 runFfmpegEx
 * 创建的 ChildProcess。这个函数通过它找到进程并 kill。
 */
export function stopCurrentProcess(): void {
  if (currentFfmpegProcess) {
    currentFfmpegProcess.kill()
    currentFfmpegProcess = null
  }
}

// ================================================================
// 滤镜配方 — 调色/特效/转场 → FFmpeg 滤镜链
//
// 来源：jianjicode/src/tool/ltx-adapter.ts 中有价值的 FFmpeg 映射知识，
// 提取为纯工具函数，供 lut_filter / video_filter / video_transition 调用。
// 所有参数使用 FFmpeg 原生范围，不经过任何中间格式。
// ================================================================

/** LUT 预设名称 */
export type LutPreset =
  | "cinematic"
  | "vintage"
  | "bw"
  | "cool"
  | "warm"
  | "muted"
  | "vivid"

/** 获取 LUT 预设对应的 FFmpeg 滤镜字符串数组（intensity: 0.0~1.0） */
export function lutPresetFilters(
  preset: LutPreset,
  intensity: number = 1.0,
): string[] {
  const t = Math.max(0, Math.min(1, intensity))
  const f: string[] = []

  switch (preset) {
    case "cinematic":
      if (t > 0) {
        f.push(
          `colorbalance=rs=-${(0.1 * t).toFixed(2)}:gs=-${(0.1 * t).toFixed(2)}:bs=${(0.1 * t).toFixed(2)}`,
        )
        f.push(
          `eq=contrast=${(1 + 0.1 * t).toFixed(2)}:saturation=${(1 - 0.15 * t).toFixed(2)}:brightness=-${(0.05 * t).toFixed(2)}`,
        )
      }
      break
    case "vintage":
      if (t > 0) {
        f.push(
          `colorbalance=rs=${(0.15 * t).toFixed(2)}:gs=-${(0.05 * t).toFixed(2)}:bs=0`,
        )
        f.push(
          `eq=contrast=${(1 - 0.1 * t).toFixed(2)}:saturation=${(1 - 0.2 * t).toFixed(2)}:brightness=${(0.05 * t).toFixed(2)}`,
        )
      }
      break
    case "bw":
      if (t > 0) {
        f.push(`hue=s=0`)
        f.push(`eq=contrast=${(1 + 0.2 * t).toFixed(2)}`)
      }
      break
    case "cool":
      if (t > 0) {
        f.push(
          `colorbalance=rs=-${(0.1 * t).toFixed(2)}:gs=${(0.05 * t).toFixed(2)}:bs=${(0.15 * t).toFixed(2)}`,
        )
        f.push(
          `eq=contrast=${(1 + 0.05 * t).toFixed(2)}:saturation=${(1 - 0.1 * t).toFixed(2)}`,
        )
      }
      break
    case "warm":
      if (t > 0) {
        f.push(
          `colorbalance=rs=${(0.15 * t).toFixed(2)}:gs=-${(0.05 * t).toFixed(2)}:bs=0`,
        )
        f.push(`eq=saturation=${(1 + 0.1 * t).toFixed(2)}`)
      }
      break
    case "muted":
      if (t > 0) {
        f.push(
          `eq=saturation=${(1 - 0.5 * t).toFixed(2)}:contrast=${(1 - 0.05 * t).toFixed(2)}`,
        )
      }
      break
    case "vivid":
      if (t > 0) {
        f.push(
          `eq=saturation=${(1 + 0.6 * t).toFixed(2)}:contrast=${(1 + 0.1 * t).toFixed(2)}`,
        )
      }
      break
  }
  return f
}

/** 颜色校正参数（FFmpeg 原生范围） */
export interface ColorCorrectionParams {
  /** 亮度 -1.0 ~ 1.0（0 = 不变） */
  brightness?: number
  /** 对比度 0.0 ~ 2.0（1.0 = 不变） */
  contrast?: number
  /** 饱和度 0.0 ~ 3.0（1.0 = 不变） */
  saturation?: number
  /** 色温 -1.0(cool/蓝) ~ 1.0(warm/暖) */
  temperature?: number
  /** 色调 -1.0(green) ~ 1.0(magenta) */
  tint?: number
  /** 曝光 -3.0 ~ 3.0（伽马指数偏移） */
  exposure?: number
  /** 高光 -1.0 ~ 1.0（0 = 不变） */
  highlights?: number
  /** 阴影 -1.0 ~ 1.0（0 = 不变） */
  shadows?: number
}

/** 颜色校正 → FFmpeg 滤镜字符串数组 */
export function colorCorrectionFilters(cc: ColorCorrectionParams): string[] {
  const filters: string[] = []

  if (cc.brightness !== undefined && cc.brightness !== 0) {
    filters.push(`eq=brightness=${cc.brightness.toFixed(2)}`)
  }
  if (cc.contrast !== undefined && cc.contrast !== 1.0) {
    filters.push(`eq=contrast=${cc.contrast.toFixed(2)}`)
  }
  if (cc.saturation !== undefined && cc.saturation !== 1.0) {
    filters.push(`eq=saturation=${cc.saturation.toFixed(2)}`)
  }
  if (cc.temperature !== undefined && cc.temperature !== 0) {
    const rs = -cc.temperature * 0.2
    const bs = cc.temperature * 0.2
    filters.push(`colorbalance=rs=${rs.toFixed(2)}:gs=0:bs=${bs.toFixed(2)}`)
  }
  if (cc.tint !== undefined && cc.tint !== 0) {
    const gs = -cc.tint * 0.2
    const rs = cc.tint * 0.1
    const bs = cc.tint * 0.1
    filters.push(
      `colorbalance=rs=${rs.toFixed(2)}:gs=${gs.toFixed(2)}:bs=${bs.toFixed(2)}`,
    )
  }
  if (cc.exposure !== undefined && cc.exposure !== 0) {
    const gamma = Math.exp(cc.exposure)
    filters.push(
      `eq=gamma_r=${gamma.toFixed(2)}:gamma_g=${gamma.toFixed(2)}:gamma_b=${gamma.toFixed(2)}`,
    )
  }
  if (cc.highlights !== undefined && cc.highlights !== 0) {
    const r = (1.0 - cc.highlights * 0.3).toFixed(2)
    filters.push(`colorlevels=romax=${r}:gomax=${r}:bomax=${r}`)
  }
  if (cc.shadows !== undefined && cc.shadows !== 0) {
    const r = (cc.shadows * 0.3).toFixed(2)
    filters.push(`colorlevels=rmin=${r}:gmin=${r}:bmin=${r}`)
  }

  return filters
}

/** 视频特效类型 */
export type VideoEffectType = "blur" | "sharpen" | "glow" | "vignette" | "grain"

/** 视频特效 → FFmpeg 滤镜字符串（amount: 0.0~1.0 强度） */
export function effectFilter(
  type: VideoEffectType,
  amount: number = 0.5,
): string {
  const a = Math.max(0, Math.min(1, amount))
  switch (type) {
    case "blur":
      return `boxblur=${(a * 10).toFixed(1)}`
    case "sharpen":
      return `unsharp=lx=5:ly=5:la=${(a * 5).toFixed(2)}`
    case "glow":
      return `glow=strength=${a.toFixed(2)}:radius=${Math.round(a * 20)}`
    case "vignette":
      return `vignette=angle=PI/4:aspect=1:ev=${a.toFixed(2)}`
    case "grain":
      return `noise=alls=${a.toFixed(2)}:allf=t`
  }
}

/** 扩展转场类型 */
export type ExtendedTransition = "cube" | "clock" | "glitch"

/** 扩展转场 → FFmpeg xfade 滤镜参数 */
export function transitionXfadeFilter(
  type: ExtendedTransition,
  duration: number,
  offset: number = 0,
): string {
  const xfadeName = type // cube / clock / glitch are valid xfade transition names
  let filter = `xfade=transition=${xfadeName}:duration=${duration.toFixed(3)}`
  if (offset > 0) filter += `:offset=${offset.toFixed(3)}`
  return filter
}

/** 拼接两个视频的转场滤镜图（兼容旧 xfade 语法） */
export function buildTransitionGraph(
  input1Label: string,
  input2Label: string,
  type: ExtendedTransition,
  duration: number,
  outputLabel: string = "outv",
): string {
  if (duration <= 0) {
    return `${input1Label}${input2Label}concat=n=2:v=1:a=0[${outputLabel}]`
  }
  const xfade = transitionXfadeFilter(type, duration)
  return `${input1Label}${input2Label}${xfade}[${outputLabel}]`
}
