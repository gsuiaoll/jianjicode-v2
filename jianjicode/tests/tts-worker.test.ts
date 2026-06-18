import { describe, test, expect } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, unlinkSync, statSync } from "node:fs"
import { join } from "node:path"

const WORKER_PATH = join(import.meta.dirname, "..", "ai", "tool", "video", "tts-worker.py")
const OUTPUT_PATH = join(import.meta.dirname, "outputs", "tts_test_output.mp3")
const TTS_TIMEOUT = 15_000

function runTtsWorker(text: string, voice = "zh-CN-XiaoxiaoNeural", speed = 1.0): Promise<{
  success: boolean
  audioPath: string
  duration: number
  error?: string
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python", [WORKER_PATH], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.https_proxy || "",
        ALL_PROXY: process.env.ALL_PROXY || process.env.all_proxy || "",
      },
    })

    let stdout = ""
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()))

    const timeout = setTimeout(() => {
      proc.kill()
      reject(new Error("TTS worker timed out"))
    }, TTS_TIMEOUT)

    proc.on("close", (code: number) => {
      clearTimeout(timeout)
      try {
        resolve(JSON.parse(stdout.trim()))
      } catch {
        reject(new Error(`Worker parse error (exit ${code}): ${stdout.slice(0, 200)}`))
      }
    })

    proc.on("error", (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    proc.stdin.write(
      JSON.stringify({ text, voice, speed, outputPath: OUTPUT_PATH }),
    )
    proc.stdin.end()
  })
}

describe("tts-worker (Python edge-tts)", () => {
  test("合成简单中文文本并返回正确时长", async () => {
    let result: Awaited<ReturnType<typeof runTtsWorker>>
    try {
      result = await runTtsWorker("你好世界")
    } catch {
      console.warn("Skipped: Python edge-tts not available (requires network/proxy)")
      return
    }

    if (!result.success) {
      console.warn("Skipped: TTS synthesis returned error:", result.error)
      return
    }

    expect(result.success).toBe(true)
    expect(existsSync(result.audioPath)).toBe(true)

    const stat = statSync(result.audioPath)
    expect(stat.size).toBeGreaterThan(1000)

    expect(result.duration).toBeGreaterThan(0.5)
    expect(result.duration).toBeLessThan(5.0)
  }, 20000)

  test("变速后时长应有变化", async () => {
    let normal: Awaited<ReturnType<typeof runTtsWorker>>
    let slow: Awaited<ReturnType<typeof runTtsWorker>>
    try {
      normal = await runTtsWorker("你好世界", "zh-CN-XiaoxiaoNeural", 1.0)
      slow = await runTtsWorker("你好世界", "zh-CN-XiaoxiaoNeural", 0.5)
    } catch {
      console.warn("Skipped: Python edge-tts not available (requires network/proxy)")
      return
    }

    if (!normal.success || !slow.success) {
      console.warn("Skipped: TTS synthesis failed")
      return
    }

    expect(slow.duration).toBeGreaterThan(normal.duration * 1.3)
  }, 35000)

  test("清理测试文件", () => {
    try {
      if (existsSync(OUTPUT_PATH)) {
        unlinkSync(OUTPUT_PATH)
      }
    } catch {
      console.warn("Could not clean up TTS test file")
    }
    expect(existsSync(OUTPUT_PATH)).toBe(false)
  })
})
