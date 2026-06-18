import { spawn, spawnSync, ChildProcess, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { isDev, getCurrentDir } from '../config'
import { logger } from '../logger'
import { getPythonDir } from '../python-setup'

// Hardware acceleration support
export interface FfmpegOptions {
  /** Enable hardware acceleration (hwaccel) */
  hwaccel?: string
  /** Hardware encoder (e.g., h264_nvenc, h264_qsv) */
  encoder?: string
  /** Hardware decoder (e.g., h264_cuvid, hevc_qsv) */
  decoder?: string
  /** Hardware device index (for multi-GPU systems) */
  hwDevice?: number
  /** Additional FFmpeg arguments */
  extraArgs?: string[]
  /** Timeout in milliseconds */
  timeout?: number
  /** Enable progress logging */
  logProgress?: boolean
}

let activeExportProcess: ChildProcess | null = null

export function findFfmpegPath(): string | null {
  let binDir: string | null = null

  if (process.platform === 'win32') {
    const imageioRelPath = path.join('Lib', 'site-packages', 'imageio_ffmpeg', 'binaries')
    binDir = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv', imageioRelPath)
      : path.join(getPythonDir(), imageioRelPath)
  } else {
    const venvBase = isDev
      ? path.join(getCurrentDir(), 'backend', '.venv')
      : getPythonDir()
    const libDir = path.join(venvBase, 'lib')
    if (fs.existsSync(libDir)) {
      const pythonDir = fs.readdirSync(libDir).find(e => e.startsWith('python3'))
      if (pythonDir) {
        binDir = path.join(libDir, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries')
      }
    }
  }

  if (binDir && fs.existsSync(binDir)) {
    const bin = fs.readdirSync(binDir).find(f => f.startsWith('ffmpeg') && (f.endsWith('.exe') || !f.includes('.')))
    if (bin) return path.join(binDir, bin)
  }

  try {
    const result = spawnSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
    if (result.stdout && fs.existsSync(result.stdout.trim())) {
      return result.stdout.trim()
    }
  } catch {
    // Fall through to next check
  }

  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return 'ffmpeg' } catch { return null }
}

/** Check if a video file contains an audio stream using ffprobe/ffmpeg */
export function fileHasAudio(ffmpegPath: string, filePath: string): boolean {
  try {
    const result = spawnSync(ffmpegPath, ['-i', filePath, '-hide_banner'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    const output = (result.stdout || '') + (result.stderr || '')
    return output.includes('Audio:')
  } catch {
    return false
  }
}

export function urlToFilePath(url: string): string {
  // Convert http://127.0.0.1:PORT/outputs/file.mp4 -> backend/outputs/file.mp4
  if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
    const urlObj = new URL(url)
    const relPath = decodeURIComponent(urlObj.pathname).replace(/^\//, '')
    return path.join(getCurrentDir(), 'backend', relPath)
  }
  // file:///Users/path (macOS) -> /Users/path
  // file:///C:/path (Windows) -> C:/path
  if (url.startsWith('file://')) {
    let filePath = decodeURIComponent(url.slice(7)) // strip 'file://'
    // On Windows, strip leading / from /C:/path
    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
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
  options?: FfmpegOptions
): Promise<{ success: boolean; error?: string }> {
  // Forward to runFfmpegEx for backward compatibility with hardware acceleration support
  return runFfmpegEx(ffmpegPath, args, options || {})
}

/**
 * Run FFmpeg with advanced options including hardware acceleration.
 */
export function runFfmpegEx(
  ffmpegPath: string,
  args: string[],
  options: FfmpegOptions = {}
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Build final arguments with hardware acceleration options
    const finalArgs: string[] = []

    // Add hardware acceleration options
    if (options.hwaccel) {
      finalArgs.push('-hwaccel', options.hwaccel)
      if (options.hwDevice !== undefined) {
        finalArgs.push('-hwaccel_device', options.hwDevice.toString())
      }
    }

    // Add hardware decoder if specified
    if (options.decoder) {
      // Replace -c:v or add -c:v before input?
      // We'll handle this by letting caller specify in args
    }

    // Add extra arguments before the main args
    if (options.extraArgs) {
      finalArgs.push(...options.extraArgs)
    }

    // Add the main arguments
    finalArgs.push(...args)

    // If encoder is specified, replace video codec in args
    if (options.encoder) {
      // Find and replace -c:v argument
      let replaced = false
      for (let i = 0; i < finalArgs.length; i++) {
        if (finalArgs[i] === '-c:v' && i + 1 < finalArgs.length) {
          finalArgs[i + 1] = options.encoder
          replaced = true
          break
        }
      }
      // If no -c:v found, add it before output file
      if (!replaced) {
        // Find output file position (usually last arg)
        const outputIndex = finalArgs.findIndex(arg =>
          arg.endsWith('.mp4') || arg.endsWith('.mkv') || arg.endsWith('.mov') ||
          arg.endsWith('.avi') || arg.endsWith('.webm')
        )
        if (outputIndex > 0) {
          finalArgs.splice(outputIndex, 0, '-c:v', options.encoder)
        } else {
          // Append at end
          finalArgs.push('-c:v', options.encoder)
        }
      }
    }

    const logProgress = options.logProgress !== false // default true

    logger.info(`[ffmpeg] Running: ${ffmpegPath} ${finalArgs.join(' ').slice(0, 400)}`)

    const proc = spawn(ffmpegPath, finalArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    activeExportProcess = proc
    let stderrLog = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrLog += text

      // Log progress info
      if (logProgress) {
        const lines = text.trim().split('\n')
        for (const line of lines) {
          if (line.includes('frame=') || line.includes('time=') || line.includes('speed=')) {
            logger.info(`[ffmpeg] ${line.trim().slice(0, 200)}`)
          }
        }
      }
    })

    proc.on('close', (code) => {
      activeExportProcess = null
      if (code === 0) {
        resolve({ success: true })
      } else {
        const errLines = stderrLog.split('\n').filter(l => l.trim()).slice(-5).join('\n')
        logger.error(`[ffmpeg] exited ${code}:\n${errLines}`)
        resolve({ success: false, error: `FFmpeg failed (code ${code}): ${errLines.slice(0, 300)}` })
      }
    })

    proc.on('error', (err) => {
      activeExportProcess = null
      resolve({ success: false, error: `Failed to start ffmpeg: ${err.message}` })
    })
  })
}

export function stopExportProcess(): void {
  if (activeExportProcess) {
    logger.info( 'Stopping active export process...')
    activeExportProcess.kill()
    activeExportProcess = null
  }
}

/**
 * Detect available hardware acceleration methods.
 * Returns array of available hwaccel types (e.g., ['cuda', 'dxva2', 'qsv', 'vaapi', 'videotoolbox'])
 */
export function detectHardwareAcceleration(): string[] {
  try {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return []

    const result = spawnSync(ffmpegPath, ['-hwaccels'], { encoding: 'utf8' })
    const output = (result.stdout || '') + (result.stderr || '')

    const hwaccels: string[] = []
    // Parse output like:
    // Hardware acceleration methods:
    // vdpau
    // cuda
    // dxva2
    // ...
    const lines = output.split('\n')
    let inList = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.toLowerCase().includes('hardware acceleration methods:')) {
        inList = true
        continue
      }
      if (inList && trimmed) {
        if (trimmed.includes('--') || trimmed.includes('==')) break // End of list
        hwaccels.push(trimmed.toLowerCase())
      }
    }

    return hwaccels.filter(h => h && !h.includes(' '))
  } catch (error) {
    logger.warn(`Failed to detect hardware acceleration: ${error}`)
    return []
  }
}

/**
 * Get available hardware encoders for given codec.
 * Returns array of encoder names (e.g., ['h264_nvenc', 'h264_qsv', 'h264_amf'])
 */
export function getHardwareEncoders(codec: string = 'h264'): string[] {
  try {
    const ffmpegPath = findFfmpegPath()
    if (!ffmpegPath) return []

    const result = spawnSync(ffmpegPath, ['-encoders'], { encoding: 'utf8' })
    const output = (result.stdout || '') + (result.stderr || '')

    const encoders: string[] = []
    const lines = output.split('\n')
    const prefix = 'V.....' // Video encoder flag
    const targetPattern = new RegExp(`${codec}_(nvenc|qsv|amf|vaapi|videotoolbox|omx|mfx|mediacodec)`, 'i')

    for (const line of lines) {
      if (line.startsWith(prefix)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 2) {
          const encoder = parts[1]
          if (targetPattern.test(encoder)) {
            encoders.push(encoder)
          }
        }
      }
    }

    return encoders
  } catch (error) {
    logger.warn(`Failed to get hardware encoders: ${error}`)
    return []
  }
}

/**
 * Detect the best hardware acceleration method for the current system.
 * Returns object with recommended hwaccel and encoder.
 */
export function detectBestHardwareAcceleration(): { hwaccel: string | null; encoder: string | null } {
  const hwaccels = detectHardwareAcceleration()
  const h264Encoders = getHardwareEncoders('h264')

  // Priority order for hwaccel
  const hwaccelPriority = ['cuda', 'dxva2', 'qsv', 'vaapi', 'videotoolbox', 'd3d11va', 'opencl']
  // Priority order for encoders
  const encoderPriority = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_vaapi', 'h264_videotoolbox']

  let bestHwaccel: string | null = null
  let bestEncoder: string | null = null

  // Find first available hwaccel
  for (const hw of hwaccelPriority) {
    if (hwaccels.includes(hw)) {
      bestHwaccel = hw
      break
    }
  }

  // Find first available encoder
  for (const enc of encoderPriority) {
    if (h264Encoders.includes(enc)) {
      bestEncoder = enc
      break
    }
  }

  return { hwaccel: bestHwaccel, encoder: bestEncoder }
}
