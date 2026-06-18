/**
 * Agent Loop — 后处理 Hooks
 *
 * 从 agent-loop.ts 拆分，负责 agent loop 完成后的非核心逻辑：
 * - maybeCreateSkill（同步执行，结果通过 nudge 返回）
 * - handleToolError（异步 self-patching）
 * - curator event 触发（静默调度）
 */

import type { AgentStep } from "./agent-types.js"

// ============================================================================
// maybeCreateSkill — 从执行轨迹创建 skill
// ============================================================================

export interface NudgeData {
  type: string
  message: string
  [key: string]: unknown
}

/**
 * 检查执行轨迹是否满足 skill 创建条件，满足则创建并返回 nudge。
 * 同步执行（fast path），nudge 随 AgentLoopResult 返回。
 */
export async function maybeCreateSkillFromSteps(
  allSteps: AgentStep[],
  sessionId: string,
  autoCreateSkill: "always" | "confirm" | "off",
): Promise<NudgeData | null> {
  if (allSteps.length <= 3) return null

  try {
    const { maybeCreateSkill: doCreateSkill } = await import("./skill-manager.js")
    const nudge = await doCreateSkill(allSteps, sessionId, autoCreateSkill)
    if (nudge) {
      return nudge as unknown as NudgeData
    }
  } catch (err: any) {
    console.warn("[agent-hooks] maybeCreateSkill failed:", err)
  }
  return null
}

// ============================================================================
// 异步后处理 hooks（handleToolError + curator events）
// ============================================================================

/**
 * 异步执行 self-patching + curator event 触发。
 * 使用 process.nextTick 非阻塞执行，不阻塞响应返回。
 */
export function scheduleAsyncHooks(
  allSteps: AgentStep[],
  sessionId: string,
): void {
  const hasToolErrors = allSteps.some((s) =>
    s.toolCalls?.some((tc: any) => tc.result?.metadata?.error === true),
  )

  process.nextTick(() => {
    // handleToolError — 灰度 patch
    if (hasToolErrors) {
      import("./skill-manager.js")
        .then((mod) =>
          mod
            .handleToolError(allSteps, sessionId)
            .catch((err: any) =>
              console.warn("[agent-hooks] handleToolError failed:", err),
            ),
        )
        .catch((err: any) =>
          console.warn("[agent-hooks] dynamic import failed:", err),
        )
    }

    // Curator event triggers（静默处理）
    import("./curator-scheduler.js")
      .then((scheduler) => {
        if (hasToolErrors) {
          scheduler.triggerEvent("skill-failed").catch(() => {})
        }
        if (allSteps.length > 5 && !hasToolErrors) {
          scheduler.triggerEvent("repeated-no-match").catch(() => {})
        }
      })
      .catch(() => {})
  })
}
