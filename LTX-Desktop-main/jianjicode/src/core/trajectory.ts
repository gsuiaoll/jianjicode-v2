/**
 * jianjicode Trajectory Recording — 执行轨迹记录与查询
 *
 * 记录 agent 的每次执行步骤（含时间戳、输入输出、工具调用），
 * 供 skill auto-creation 分析工作流模式，供 curator 做增量审查。
 *
 * @license MIT
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// ============================================================================
// 类型
// ============================================================================

export type TrajectoryStepType =
  | "text" // AI 文本输出
  | "tool_call" // 工具调用请求
  | "tool_result" // 工具执行结果
  | "error" // 错误
  | "decision" // AI 决策（如选择使用哪个技能）
  | "permission" // 权限请求/审批
  | "system" // 系统事件（压缩、fallback 等）

export interface TrajectoryStep {
  /** ISO 时间戳 */
  timestamp: string
  /** 步骤序号（从 1 开始） */
  stepNumber: number
  /** 步骤类型 */
  type: TrajectoryStepType
  /** 内容摘要 */
  summary: string
  /** 详细信息 */
  detail?: string
  /** 工具名称（type=tool_call/tool_result） */
  toolName?: string
  /** 工具参数 */
  toolArgs?: Record<string, unknown>
  /** 工具执行结果 */
  toolResult?: {
    title?: string
    output?: string
    error?: boolean
    [key: string]: unknown
  }
  /** token 用量 */
  tokenUsage?: {
    prompt: number
    completion: number
  }
}

export interface Trajectory {
  /** 会话 ID */
  sessionId: string
  /** 用户消息 */
  message: string
  /** 是否来自自动创建（skill auto-creation） */
  autoCreated: boolean
  /** 技能名称（如果使用了 skill） */
  skillName?: string
  /** 步骤记录 */
  steps: TrajectoryStep[]
  /** 开始时间（ISO） */
  startedAt: string
  /** 完成时间（ISO） */
  completedAt?: string
  /** 总 token 用量 */
  totalTokens: number
  /** 是否成功 */
  success: boolean
  /** 使用的模型 ID */
  modelId?: string
  /** fallback 元信息 */
  fallback?: {
    fellBack: boolean
    retryCount: number
    modelUsed: string
  }
}

// ============================================================================
// Trajectory Recorder
// ============================================================================

const DEFAULT_MAX_TRAJECTORIES = 200
const STORAGE_DIR = path.join(os.homedir(), ".jianjicode", "trajectories")

export class TrajectoryRecorder {
  private trajectories = new Map<string, Trajectory>()
  private current: Map<string, Trajectory> = new Map()
  private maxTrajectories: number

  constructor(maxTrajectories = DEFAULT_MAX_TRAJECTORIES) {
    this.maxTrajectories = maxTrajectories
    // 启动时尝试从磁盘恢复
    this.loadFromDisk()
  }

  // ========================================================================
  // 公共 API
  // ========================================================================

  /**
   * 开始记录一次执行轨迹。
   * 应在 agent-loop 开始处理用户消息时调用。
   */
  startRecording(
    sessionId: string,
    message: string,
    opts?: {
      skillName?: string
      autoCreated?: boolean
      modelId?: string
    },
  ): void {
    const trajectory: Trajectory = {
      sessionId,
      message,
      autoCreated: opts?.autoCreated ?? false,
      skillName: opts?.skillName,
      steps: [],
      startedAt: new Date().toISOString(),
      totalTokens: 0,
      success: false,
      modelId: opts?.modelId,
    }
    this.current.set(sessionId, trajectory)
  }

  /**
   * 记录一个步骤。
   */
  recordStep(
    sessionId: string,
    step: Omit<TrajectoryStep, "timestamp" | "stepNumber">,
  ): void {
    const trajectory = this.current.get(sessionId)
    if (!trajectory) return

    const stepNumber = trajectory.steps.length + 1
    trajectory.steps.push({
      ...step,
      timestamp: new Date().toISOString(),
      stepNumber,
    })
  }

  /**
   * 完成记录并保存。
   */
  finishRecording(
    sessionId: string,
    success: boolean,
    opts?: {
      totalTokens?: number
      fallback?: Trajectory["fallback"]
    },
  ): void {
    const trajectory = this.current.get(sessionId)
    if (!trajectory) return

    trajectory.completedAt = new Date().toISOString()
    trajectory.success = success
    if (opts?.totalTokens !== undefined)
      trajectory.totalTokens = opts.totalTokens
    if (opts?.fallback) trajectory.fallback = opts.fallback

    // 移入完成列表
    this.trajectories.set(sessionId, trajectory)
    this.current.delete(sessionId)

    // 限制数量
    this.enforceLimit()

    // 异步持久化
    this.saveToDisk(sessionId).catch(() => {})
  }

  /**
   * 获取指定会话的轨迹。
   */
  getTrajectory(sessionId: string): Trajectory | undefined {
    return this.trajectories.get(sessionId) || this.current.get(sessionId)
  }

  /**
   * 获取最近的 N 条轨迹。
   */
  getRecentTrajectories(count = 10): Trajectory[] {
    const all = Array.from(this.trajectories.values())
    all.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    return all.slice(0, count)
  }

  /**
   * 获取最近的 N 条成功轨迹（用于 skill auto-creation 分析）。
   */
  getRecentSuccessfulTrajectories(count = 10): Trajectory[] {
    return this.getRecentTrajectories(count).filter((t) => t.success)
  }

  /**
   * 获取指定时间范围后的新轨迹（用于 curator 增量审查）。
   */
  getTrajectoriesSince(since: string): Trajectory[] {
    const sinceTime = new Date(since).getTime()
    return Array.from(this.trajectories.values())
      .filter((t) => new Date(t.startedAt).getTime() > sinceTime)
      .sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      )
  }

  /**
   * 搜索轨迹（按消息内容或步骤摘要模糊匹配）。
   */
  searchTrajectories(query: string, limit = 20): Trajectory[] {
    const lower = query.toLowerCase()
    const results: Trajectory[] = []

    for (const t of this.trajectories.values()) {
      if (t.message.toLowerCase().includes(lower)) {
        results.push(t)
        continue
      }
      for (const step of t.steps) {
        if (
          step.summary.toLowerCase().includes(lower) ||
          step.toolName?.toLowerCase().includes(lower)
        ) {
          results.push(t)
          break
        }
      }
    }

    results.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )
    return results.slice(0, limit)
  }

  /**
   * 清除所有轨迹（测试用）。
   */
  clearAll(): void {
    this.trajectories.clear()
    this.current.clear()
  }

  /**
   * 清除旧轨迹（保留最近 N 条）。
   */
  clearOldTrajectories(keep = 100): void {
    const all = Array.from(this.trajectories.entries()).sort(
      (a, b) =>
        new Date(b[1].startedAt).getTime() - new Date(a[1].startedAt).getTime(),
    )

    const toDelete = all.slice(keep)
    for (const [id] of toDelete) {
      this.trajectories.delete(id)
      this.deleteFromDisk(id).catch(() => {})
    }
  }

  /**
   * 获取总轨迹数。
   */
  get size(): number {
    return this.trajectories.size
  }

  // ========================================================================
  // 持久化
  // ========================================================================

  private async saveToDisk(sessionId: string): Promise<void> {
    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true })
      }
      const filePath = path.join(STORAGE_DIR, `${sanitizeId(sessionId)}.json`)
      const trajectory = this.trajectories.get(sessionId)
      if (trajectory) {
        fs.writeFileSync(filePath, JSON.stringify(trajectory, null, 2), "utf-8")
      }
    } catch {
      // 持久化失败不阻塞主流程
    }
  }

  private async deleteFromDisk(sessionId: string): Promise<void> {
    try {
      const filePath = path.join(STORAGE_DIR, `${sanitizeId(sessionId)}.json`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch {
      /* ignore */
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(STORAGE_DIR)) return
      const files = fs
        .readdirSync(STORAGE_DIR)
        .filter((f) => f.endsWith(".json"))
      for (const file of files.slice(-this.maxTrajectories)) {
        try {
          const content = fs.readFileSync(path.join(STORAGE_DIR, file), "utf-8")
          const trajectory = JSON.parse(content) as Trajectory
          this.trajectories.set(trajectory.sessionId, trajectory)
        } catch {
          /* skip corrupted files */
        }
      }
    } catch {
      /* ignore load errors */
    }
  }

  private enforceLimit(): void {
    if (this.trajectories.size <= this.maxTrajectories) return
    this.clearOldTrajectories(this.maxTrajectories)
  }
}

// ============================================================================
// 全局单例
// ============================================================================

let _globalRecorder: TrajectoryRecorder | null = null

/**
 * 获取全局 TrajectoryRecorder 实例。
 */
export function getTrajectoryRecorder(): TrajectoryRecorder {
  if (!_globalRecorder) {
    _globalRecorder = new TrajectoryRecorder()
  }
  return _globalRecorder
}

/**
 * 重置全局实例（测试用）。
 */
export function resetTrajectoryRecorder(): void {
  _globalRecorder = null
}

// ============================================================================
// 工具
// ============================================================================

/** 过滤掉文件名中不允许的字符 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_")
}
