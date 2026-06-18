/**
 * jianjicode Curator Scheduler — 定时 + 事件双驱动审查调度
 *
 * 触发机制：
 * - 定时触发（默认 7 天）
 * - 事件触发：
 *   1. skill > 10 → 轻量 review
 *   2. 单 skill 连续失败 > 3 → 专项 review
 *   3. 连续 3 次同类无 skill → 前台 nudge
 *
 * @license MIT
 */

import {
  bumpConsecutiveNoMatch,
  getConsecutiveNoMatch,
  needsLightReview,
  resetConsecutiveNoMatch,
  runIncrementalReview,
  shouldRunReview,
} from "./curator.js"
import {
  nudgeOptimizationReport,
  nudgeSkillSuggestion,
} from "./nudge-service.js"
import { listSkills } from "./skill-manager.js"

// ============================================================================
// 类型
// ============================================================================

export type CuratorEventType =
  | "skill-created"
  | "skill-failed"
  | "repeated-no-match"

export interface CuratorEvent {
  type: CuratorEventType
  skillName?: string
  timestamp: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// 调度器状态
// ============================================================================

let reviewTimer: ReturnType<typeof setInterval> | null = null
let eventHandler: ((event: CuratorEvent) => void) | null = null

const DEFAULT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天

// ============================================================================
// 事件处理
// ============================================================================

/**
 * 处理 curator 事件。
 * 根据事件类型执行相应操作。
 */
async function handleEvent(event: CuratorEvent): Promise<void> {
  try {
    switch (event.type) {
      case "skill-created": {
        // 事件 1: skill > 10 → 轻量 review
        const skills = await listSkills()
        if (needsLightReview(skills.length)) {
          const report = await runIncrementalReview()
          console.log(
            `[curator] Light review: ${report.suggestions.length} suggestions`,
          )
          // 推送优化报告 nudge
          if (
            report.suggestions.length > 0 ||
            report.lifecycleActions.length > 0
          ) {
            nudgeOptimizationReport(report)
          }
          eventHandler?.(event)
        }
        break
      }

      case "skill-failed": {
        // 事件 2: 由 handleToolError 自行处理（checkBroken），
        // 这里仅做日志提醒
        if (event.skillName) {
          console.log(`[curator] Skill failed: "${event.skillName}"`)
        }
        break
      }

      case "repeated-no-match": {
        // 事件 3: 连续无匹配 → nudge
        bumpConsecutiveNoMatch()
        if (getConsecutiveNoMatch() >= 3) {
          console.log(
            "[curator] Repeated no-match detected — consider creating a new skill",
          )
          resetConsecutiveNoMatch()
          // 推送技能建议 nudge
          const toolPattern: string[] = Array.isArray(
            event.metadata?.toolPattern,
          )
            ? (event.metadata.toolPattern as string[])
            : ["unknown"]
          nudgeSkillSuggestion(toolPattern, 3)
          eventHandler?.(event)
        }
        break
      }
    }
  } catch {
    // 事件处理失败不阻塞
  }
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 启动定期 review 定时器。
 * @param intervalMs 检查间隔（默认 7 天）
 */
export function startReviewScheduler(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  if (reviewTimer) return // 已经启动

  // 启动时立即检查一次
  if (shouldRunReview()) {
    runIncrementalReview().catch(() => {})
  }

  reviewTimer = setInterval(async () => {
    if (shouldRunReview()) {
      try {
        const report = await runIncrementalReview()
        if (
          report.suggestions.length > 0 ||
          report.lifecycleActions.length > 0
        ) {
          nudgeOptimizationReport(report)
        }
      } catch {
        /* review 失败不阻塞周期 */
      }
    }
  }, intervalMs)

  // 防止定时器阻止进程退出
  if (
    reviewTimer &&
    typeof reviewTimer === "object" &&
    "unref" in reviewTimer
  ) {
    reviewTimer.unref()
  }
}

/**
 * 停止 review 定时器。
 */
export function stopReviewScheduler(): void {
  if (reviewTimer) {
    clearInterval(reviewTimer)
    reviewTimer = null
  }
}

/**
 * 注册事件回调。
 */
export function onCuratorEvent(handler: (event: CuratorEvent) => void): void {
  eventHandler = handler
}

/**
 * 触发 curator 事件。
 */
export async function triggerEvent(
  type: CuratorEventType,
  skillName?: string,
): Promise<void> {
  const event: CuratorEvent = {
    type,
    skillName,
    timestamp: new Date().toISOString(),
  }
  await handleEvent(event)
}

/**
 * 获取调度器运行状态。
 */
export function isSchedulerRunning(): boolean {
  return reviewTimer !== null
}
