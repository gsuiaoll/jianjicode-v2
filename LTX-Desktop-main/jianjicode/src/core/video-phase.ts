/**
 * 视频剪辑阶段管理 — RoughCut / FineCut 两阶段门禁
 *
 * 借鉴 OpenCode Plan/Build 模式：通过工具权限结构性保证阶段顺序，
 * 而非仅靠 prompt 建议。
 *
 * RoughCut（粗剪）：裁剪、拼接、场景检测 — 锁定时间轴
 * FineCut（精剪）：BGM、字幕、调色、转场、特效 — 在锁定时间轴上装饰
 */

import type { PermissionRule } from "../permission/types.js"

// ============================================================================
// 阶段定义
// ============================================================================

export type VideoPhase = "rough_cut" | "fine_cut"

/** FineCut 阶段允许的 ffmpeg trim 最大秒数 */
export const FINECUT_MAX_TRIM_SECONDS = 0.5

// ============================================================================
// 工具分类
// ============================================================================

/** 粗剪工具 — 仅在 rough_cut 阶段可用 */
const ROUGH_CUT_TOOLS = new Set([
  "concat_videos",
  "video_scene_detection",
  "extract_audio",
])

// trim_video 在 fine_cut 阶段允许 ≤0.5s 微调（参数校验控制）

/** 精剪工具 — 仅在 fine_cut 阶段可用 */
const FINE_CUT_TOOLS = new Set([
  "lut_filter",
  "video_filter",
  "merge_audio",
  "video_subtitle",
  "video_transition",
  "video_speed",
  "video_pip",
  "video_watermark",
  "video_mask",
  "video_stabilization",
  "video_intelligent_crop",
  "keyframe_animation",
  "audio_effects",
  "music_search",
  "video_style_transfer",
  "ltx_api_color_grading",
  "ltx_api_canny_edge",
  "action_recognition",
  "video_crop",
])

/** 通用工具 — 两个阶段都可用 */
const UNIVERSAL_TOOLS = new Set([
  "ffmpeg",          // 参数校验控制具体行为
  "trim_video",      // fine_cut 阶段参数校验限制 ≤0.5s
  "get_video_info",
  "video_extract_frame",
  "convert_video",
  "batch_scanner",
  "batch_queue",
  "batch_report",
  "batch_progress",
  "template_manager",
  "skill_manage",
  "todowrite",
  "todoread",
  "set_edit_phase",  // 阶段切换工具本身
])

// ============================================================================
// 阶段状态
// ============================================================================

let _currentPhase: VideoPhase = "rough_cut"
let _onPhaseChange: ((phase: VideoPhase) => void) | null = null

export function getCurrentPhase(): VideoPhase {
  return _currentPhase
}

export function setCurrentPhase(phase: VideoPhase): void {
  const prev = _currentPhase
  _currentPhase = phase
  if (prev !== phase) {
    console.log(`[video-phase] 阶段切换: ${prev} → ${phase}`)
    _onPhaseChange?.(phase)
  }
}

export function onPhaseChange(cb: (phase: VideoPhase) => void): void {
  _onPhaseChange = cb
}

/** 重置到初始状态 */
export function resetPhase(): void {
  _currentPhase = "rough_cut"
}

// ============================================================================
// 权限规则生成
// ============================================================================

/**
 * 根据当前阶段生成权限 deny 规则。
 * 返回需要禁止的工具规则列表，供 PermissionService.setSessionRules() 使用。
 */
export function getPhaseDenyRules(): PermissionRule[] {
  if (_currentPhase === "rough_cut") {
    // 粗剪阶段：禁止精剪工具
    return [...FINE_CUT_TOOLS].map((tool) => ({
      target: "tool:call",
      pattern: tool,
      action: "deny" as const,
      priority: 200, // 高于默认规则
      description: `精剪工具，粗剪阶段不可用`,
    }))
  }

  // 精剪阶段：禁止粗剪专用工具（ffmpeg 由参数校验控制）
  return [...ROUGH_CUT_TOOLS].map((tool) => ({
    target: "tool:call",
    pattern: tool,
    action: "deny" as const,
    priority: 200,
    description: `粗剪工具，精剪阶段不可用`,
  }))
}

// ============================================================================
// 阶段感知校验
// ============================================================================

/**
 * 检查工具调用在当前阶段是否合法。
 * 返回 null 表示通过，返回字符串表示拒绝原因。
 */
export function validateToolForPhase(toolName: string, args: Record<string, any>): string | null {
  if (_currentPhase === "rough_cut") {
    if (FINE_CUT_TOOLS.has(toolName)) {
      return `精剪工具 "${toolName}" 在粗剪阶段不可用。请先完成裁剪和拼接，锁定时间轴后再进行精剪操作。`
    }
    // ffmpeg merge_audio / audio 操作在粗剪阶段也要拦截 — BGM 属于精剪
    if (toolName === "ffmpeg") {
      const operation = (args.operation || args.action || "").toLowerCase()
      if (operation === "merge_audio" || operation === "add_audio" || operation === "replace_audio" || operation === "audio_replace") {
        return `BGM 替换属于精剪操作，在粗剪阶段不可用。请先完成裁剪和拼接，切换到精剪阶段 (set_edit_phase fine_cut) 后再替换背景音乐。`
      }
    }
    return null
  }

  // fine_cut 阶段
  if (ROUGH_CUT_TOOLS.has(toolName)) {
    return `粗剪工具 "${toolName}" 在精剪阶段不可用。时间轴已锁定，如需大范围调整请重新开始粗剪。`
  }

  // ffmpeg 在精剪阶段限制 trim 范围
  if (toolName === "ffmpeg") {
    const operation = args.operation || args.action || ""
    if (operation === "trim" || operation === "cut") {
      const start = parseFloat(args.start_time || args.start || "0")
      const end = parseFloat(args.end_time || args.end || args.duration || "0")
      const duration = Math.abs(end - start)
      if (duration > FINECUT_MAX_TRIM_SECONDS || (start === 0 && end > FINECUT_MAX_TRIM_SECONDS)) {
        // 允许微小调整，拒绝大段裁剪
        if (duration > FINECUT_MAX_TRIM_SECONDS) {
          return `精剪阶段仅允许 ≤${FINECUT_MAX_TRIM_SECONDS}秒 的切点微调。当前裁剪范围 ${duration.toFixed(1)}秒 超出限制。如需大段裁剪，请重新进入粗剪阶段。`
        }
      }
    }
    if (operation === "concat" || operation === "merge") {
      return "精剪阶段不允许拼接操作。时间轴已锁定，如需拼接新片段请重新进入粗剪阶段。"
    }
  }

  // trim_video 在精剪阶段也限制范围
  if (toolName === "trim_video" && _currentPhase === "fine_cut") {
    const start = parseFloat(args.start_time || args.start || "0")
    const end = parseFloat(args.end_time || args.end || args.duration || "0")
    if (Math.abs(end - start) > FINECUT_MAX_TRIM_SECONDS) {
      return `精剪阶段仅允许 ≤${FINECUT_MAX_TRIM_SECONDS}秒 的切点微调。`
    }
  }

  return null
}

/**
 * 获取当前阶段注入到 system prompt 的描述。
 */
export function getPhasePrompt(): string {
  if (_currentPhase === "rough_cut") {
    return `\n## 当前剪辑阶段：粗剪 (Rough Cut)\n你处于粗剪阶段。可用工具：裁剪 (trim)、拼接 (concat)、场景检测。\n目标：选取素材、排列顺序、锁定最终时间轴。\n精剪工具（BGM、字幕、调色、转场、特效）暂不可用 — 请先完成粗剪。\n完成后调用 set_edit_phase 切换到精剪阶段。`
  }
  return `\n## 当前剪辑阶段：精剪 (Fine Cut)\n你处于精剪阶段。可用工具：BGM、字幕、调色、转场、特效、滤镜。\n目标：在锁定时间轴上叠加装饰和润色。\n切点微调（≤0.5s）允许，大段删除和拼接已禁止。`
}
