/**
 * 视频剪辑阶段管理
 *
 * "rough_cut"（粗剪）：裁剪、拼接、场景检测
 * "fine_cut"（精剪）：BGM、字幕、调色、转场、特效
 */

export type EditPhase = "rough_cut" | "fine_cut"

export const FINECUT_MAX_TRIM_SECONDS = 2

let currentPhase: EditPhase = "rough_cut"

export function getCurrentPhase(): EditPhase {
  return currentPhase
}

export function setCurrentPhase(phase: EditPhase): void {
  currentPhase = phase
}

export function getPhasePrompt(): string {
  if (currentPhase === "rough_cut") {
    return "\n## Current Phase: Rough Cut (粗剪)\nYou are in the rough cut phase. Focus on trimming and concatenating clips to lock the timeline. Avoid fine-tuning like color grading or transitions."
  }
  return "\n## Current Phase: Fine Cut (精剪)\nYou are in the fine cut phase. The timeline is locked. Focus on BGM, subtitles, color grading, transitions, and effects. Trimming is limited to 2-second adjustments."
}

export function validateToolForPhase(
  toolId: string,
  args: Record<string, any>,
): string | null {
  if (currentPhase !== "fine_cut") return null

  if (toolId === "concat_videos") {
    return "精剪阶段禁止拼接视频。时间轴已锁定，请使用其他精剪工具。"
  }

  if (toolId === "trim_video") {
    const start = parseFloat(args.start_time) || 0
    const end = args.end_time ? parseFloat(args.end_time) || 0 : 0
    const duration = end > start ? end - start : 0
    if (duration > FINECUT_MAX_TRIM_SECONDS && end > 0) {
      return `精剪阶段单次裁剪不能超过 ${FINECUT_MAX_TRIM_SECONDS} 秒。当前请求: ${duration} 秒。`
    }
  }

  return null
}
