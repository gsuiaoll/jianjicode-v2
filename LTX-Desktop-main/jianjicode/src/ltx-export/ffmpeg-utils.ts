import { type ChildProcess, execSync, spawn, spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import { logger } from "./logger.js"

let activeExportProcess: ChildProcess | null = null

/**
 * 基于jianjicode的FFmpeg发现机制，复用LTX的进程管理接口
 *
 * 与LTX原版的区别:
 * 1. 移除imageio_ffmpeg依赖
 * 2. 使用jianjicode的FFmpeg发现逻辑
 * 3. 保持LTX的进程管理和日志接口
 */
export async function findFfmpegPath(): Promise<string | null> {
  // 首先尝试环境变量
  const envPath = process.env.JIANJICODE_FFMPEG_PATH || process.env.FFMPEG_PATH
  if (envPath && fs.existsSync(envPath)) {
    return envPath
  }

  // 检查系统PATH
  try {
    execSync("ffmpeg -version", { stdio: "ignore" })
    return "ffmpeg"
  } catch {
    // 尝试ffmpeg-static包
    try {
      const ffmpegStatic = await import("ffmpeg-static")
      if (ffmpegStatic?.default && typeof ffmpegStatic.default === "string") {
        const staticPath = ffmpegStatic.default as string
        if (fs.existsSync(staticPath)) {
          return staticPath
        }
      }
    } catch (staticError) {
      logger.warn(`ffmpeg-static导入失败: ${(staticError as Error).message}`)
    }

    // 检查常见安装位置
    const platform = process.platform
    const possiblePaths = [
      // jianjicode资源目录
      path.join(
        process.cwd(),
        "resources",
        "ffmpeg",
        platform,
        platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
      ),
      path.join(
        __dirname,
        "..",
        "..",
        "resources",
        "ffmpeg",
        platform,
        platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
      ),
      // node_modules位置
      path.join(
        process.cwd(),
        "node_modules",
        "ffmpeg-static",
        platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
      ),
      path.join(
        __dirname,
        "..",
        "..",
        "node_modules",
        "ffmpeg-static",
        platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
      ),
      // Windows常见位置
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
      // macOS/Linux常见位置
      "/usr/local/bin/ffmpeg",
      "/usr/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
    ]

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p
      }
    }

    return null
  }
}

/** Check if a video file contains an audio stream using ffprobe/ffmpeg */
export function fileHasAudio(ffmpegPath: string, filePath: string): boolean {
  try {
    const result = spawnSync(ffmpegPath, ["-i", filePath, "-hide_banner"], {
      encoding: "utf8",
      timeout: 5000,
    })
    const output = (result.stdout || "") + (result.stderr || "")
    return output.includes("Audio:")
  } catch {
    return false
  }
}

export function urlToFilePath(url: string): string {
  // Convert http://127.0.0.1:PORT/outputs/file.mp4 -> backend/outputs/file.mp4
  if (
    url.startsWith("http://127.0.0.1") ||
    url.startsWith("http://localhost")
  ) {
    const urlObj = new URL(url)
    const relPath = decodeURIComponent(urlObj.pathname).replace(/^\//, "")
    return path.join(process.cwd(), "backend", relPath)
  }
  // file:///Users/path (macOS) -> /Users/path
  // file:///C:/path (Windows) -> C:/path
  if (url.startsWith("file://")) {
    let filePath = decodeURIComponent(url.slice(7)) // strip 'file://'
    // On Windows, strip leading / from /C:/path
    if (process.platform === "win32" && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1)
    }
    return filePath
  }
  // Already a file path
  return url
}

/** Run an ffmpeg command and return a promise. Logs stderr and sets activeExportProcess. */
export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info(`[ffmpeg] spawn: ${args.join(" ").slice(0, 400)}`)
    const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] })
    activeExportProcess = proc
    let stderrLog = ""
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      stderrLog += text
      const lines = text.trim().split("\n")
      for (const line of lines) {
        if (
          line.includes("frame=") ||
          line.includes("Error") ||
          line.includes("error")
        ) {
          logger.info(`[ffmpeg] ${line.trim().slice(0, 200)}`)
        }
      }
    })
    proc.on("close", (code) => {
      activeExportProcess = null
      if (code === 0) {
        resolve({ success: true })
      } else {
        const errLines = stderrLog
          .split("\n")
          .filter((l) => l.trim())
          .slice(-5)
          .join("\n")
        logger.error(`[ffmpeg] exited ${code}:\n${errLines}`)
        resolve({
          success: false,
          error: `FFmpeg failed (code ${code}): ${errLines.slice(0, 300)}`,
        })
      }
    })
    proc.on("error", (err) => {
      activeExportProcess = null
      resolve({
        success: false,
        error: `Failed to start ffmpeg: ${err.message}`,
      })
    })
  })
}

export function stopExportProcess(): void {
  if (activeExportProcess) {
    logger.info("Stopping active export process...")
    activeExportProcess.kill()
    activeExportProcess = null
  }
}

/**
 * 增强版FFmpeg运行函数，自动查找FFmpeg路径
 */
export async function runFfmpegAuto(
  args: string[],
): Promise<{ success: boolean; error?: string }> {
  const ffmpegPath = await findFfmpegPath()
  if (!ffmpegPath) {
    return {
      success: false,
      error:
        "FFmpeg not found. Please install FFmpeg or set JIANJICODE_FFMPEG_PATH.",
    }
  }
  return runFfmpeg(ffmpegPath, args)
}
