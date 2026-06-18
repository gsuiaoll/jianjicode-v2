import { execSync, spawn, spawnSync } from "child_process"
import { existsSync } from "fs"
import { join, dirname } from "path"

const __dirname = process.cwd()

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
    let stdout = ""
    let stderr = ""

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
      resolve({
        success: false,
        error: `Failed to start ffmpeg: ${err.message}`,
      })
    })
  })
}

export function runFfmpeg(
  args: string[],
): Promise<{ success: boolean; error?: string; output?: string }> {
  return runFfmpegEx(args, {})
}

export async function trimVideo(
  inputPath: string,
  outputPath: string,
  startTime: string,
  endTime?: string,
): Promise<any> {
  const args = ["-i", inputPath, "-ss", startTime]
  if (endTime) args.push("-to", endTime)
  args.push("-c:v", "libx264", "-c:a", "copy", "-y", outputPath)
  return await runFfmpeg(args)
}

export async function concatVideos(
  inputPaths: string[],
  outputPath: string,
): Promise<any> {
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
  const result = await runFfmpeg(args)

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
): Promise<any> {
  const args = [
    "-i",
    inputPath,
    "-c:v",
    codec || "libx264",
    "-c:a",
    "copy",
    "-y",
    outputPath,
  ]
  return await runFfmpeg(args)
}

export async function extractAudio(
  inputPath: string,
  outputPath: string,
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
  replaceAudio?: boolean,
): Promise<any> {
  // Replace mode: strip original audio entirely, use only new music
  // -map 0:v takes video only from input 0, -map 1:a takes audio only from input 1
  if (replaceAudio) {
    const args = [
      "-i", videoPath,
      "-stream_loop", "-1",
      "-i", audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      "-y", outputPath,
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

    let probePath = ffmpegPath.replace("ffmpeg", "ffprobe")
    let probeExists = existsSync(probePath) || ffmpegPath === "ffmpeg"

    // Fallback: ffmpeg-static npm package may lack ffprobe, try resources dir
    if (!probeExists && ffmpegPath !== "ffmpeg") {
      const platform = process.platform
      const probeExe = platform === "win32" ? "ffprobe.exe" : "ffprobe"
      const altPaths = [
        join(process.cwd(), "resources", "ffmpeg", platform, probeExe),
        join(process.cwd(), "..", "resources", "ffmpeg", platform, probeExe),
        join(dirname(ffmpegPath), "..", "..", "resources", "ffmpeg", platform, probeExe),
      ]
      for (const alt of altPaths) {
        if (existsSync(alt)) {
          probePath = alt
          probeExists = true
          break
        }
      }
    }

    if (probeExists) {
      const cmd = ffmpegPath === "ffmpeg" ? "ffprobe" : probePath
      const result = spawnSync(
        cmd,
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
