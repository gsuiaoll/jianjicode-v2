// ManimGL TypeScript → Python 桥接 — subprocess 调用 engine.py
import { spawn } from "child_process"
import { existsSync, mkdirSync } from "fs"
import { dirname } from "path"
import { MANIM_CONFIG } from "./manim_config.js"

// ============================================================================
// 渲染队列 + 监控
// ============================================================================

type RenderStatus = "queued" | "rendering" | "completed" | "failed"

interface RenderTask {
  id: string
  template: string
  status: RenderStatus
  startTime?: number
  endTime?: number
}

const _activeTasks = new Map<string, RenderTask>()
let _activeCount = 0

// 简单指标
export const metrics = {
  totalRenders: 0,
  successRenders: 0,
  failedRenders: 0,
  cacheHits: 0,
  totalRenderTimeMs: 0,

  get avgRenderTimeMs() {
    return this.totalRenders > 0
      ? Math.round(this.totalRenderTimeMs / this.totalRenders)
      : 0
  },

  get successRate() {
    return this.totalRenders > 0
      ? Math.round((this.successRenders / this.totalRenders) * 100)
      : 0
  },

  snapshot() {
    return {
      total: this.totalRenders,
      success: this.successRenders,
      failed: this.failedRenders,
      cacheHits: this.cacheHits,
      avgMs: this.avgRenderTimeMs,
      rate: this.successRate,
      active: _activeCount,
      queued: _activeTasks.size - _activeCount,
    }
  },
}

function _taskId(template: string): string {
  return `${template}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function _finishTask(task: RenderTask, success: boolean) {
  task.endTime = Date.now()
  task.status = success ? "completed" : "failed"
  _activeCount--
  _activeTasks.delete(task.id)

  const elapsed = task.endTime - (task.startTime ?? task.endTime)
  metrics.totalRenderTimeMs += elapsed
  if (success) metrics.successRenders++
  else metrics.failedRenders++
}

export function getTaskStatus(taskId: string): RenderTask | undefined {
  return _activeTasks.get(taskId)
}

// ============================================================================
// 类型定义
// ============================================================================

export interface ManimRenderParams {
  template: string
  params: Record<string, unknown>
  outputFile: string
  quality: "480p" | "720p" | "1080p"
  timeout?: number // 秒，默认来自 MANIM_CONFIG
}

export interface ManimError {
  type: "param_error" | "template_error" | "env_error" | "timeout_error"
  message: string
  suggestion: string
}

export interface ManimResult {
  success: boolean
  outputPath?: string
  error?: ManimError
}

// ============================================================================
// 错误分类
// ============================================================================

const SUGGESTIONS: Record<string, string> = {
  param_error: "参数可能超出合法范围，请检查参数后重试",
  template_error: "模板 Python 代码执行异常，请联系开发者排查模板",
  env_error: "渲染环境缺少必要组件（FFmpeg 或 GPU 驱动），请联系管理员",
  timeout_error: "渲染超时，请尝试降低画质或缩小动画时长",
}

function classifyError(
  errorType: string,
  message: string,
): ManimError {
  const t = errorType as ManimError["type"]
  return {
    type: t,
    message,
    suggestion: SUGGESTIONS[t] || "未知错误，请重试",
  }
}

// ============================================================================
// 核心渲染
// ============================================================================

export async function execManimRender(
  params: ManimRenderParams,
): Promise<ManimResult> {
  // ================================================================
  // 并发限制 + 指标追踪
  // ================================================================
  const taskId = _taskId(params.template)
  const task: RenderTask = {
    id: taskId, template: params.template, status: "queued",
  }
  _activeTasks.set(taskId, task)

  while (_activeCount >= MANIM_CONFIG.maxConcurrency) {
    await new Promise((r) => setTimeout(r, 500))
  }

  _activeCount++
  task.status = "rendering"
  task.startTime = Date.now()
  metrics.totalRenders++

  const startTime = Date.now()
  const outputDir = dirname(params.outputFile)
  mkdirSync(outputDir, { recursive: true })

  const paramsJson = JSON.stringify(params.params)
  const args = [
    MANIM_CONFIG.engineScript,
    params.template,
    paramsJson,
    params.outputFile,
    params.quality,
  ]

  const timeoutMs = (params.timeout ?? MANIM_CONFIG.renderTimeout) * 1000

  return new Promise((resolve) => {
    const child = spawn(MANIM_CONFIG.pythonBin, args)

    let stdout = ""
    let stderr = ""
    let timedOut = false

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString()
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    child.on("error", (err) => {
      clearTimeout(timer)
      _finishTask(task, false)
      resolve({
        success: false,
        error: {
          type: "env_error",
          message: err.message,
          suggestion:
            "无法启动 Python 进程，请检查 Python 环境和 ManimGL 安装",
        },
      })
    })

    child.on("close", (code) => {
      clearTimeout(timer)

      if (timedOut) {
        _finishTask(task, false)
        resolve({
          success: false,
          error: classifyError("timeout_error", `渲染超时（${MANIM_CONFIG.renderTimeout}s），进程已被强制终止`),
        })
        return
      }

      // engine.py 输出 JSON 结果到 stdout（snake_case）
      try {
        const raw = JSON.parse(stdout.trim())
        const result: ManimResult = {
          success: raw.success,
          outputPath: raw.output_path || raw.outputPath,
          error: raw.error_type
            ? classifyError(raw.error_type, raw.message || raw.error_message)
            : undefined,
        }
        _finishTask(task, result.success)
        resolve(result)
      } catch {
        _finishTask(task, false)
        resolve({
          success: false,
          error: classifyError(
            code === 0 ? "param_error" : "env_error",
            stderr || stdout || `manimgl 进程退出码 ${code}`,
          ),
        })
      }
    })
  })
}
