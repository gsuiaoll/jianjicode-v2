/**
 * Phase 2.0 — 剪辑操作描述协议
 *
 * 核心思路：TypeScript 工具代码在执行 FFmpeg 的同时，用同一份 args 生成
 * 结构化的 EditOperations。agent-loop 收集后通过 SSE 推给前端，前端在
 * 时间轴上还原操作。
 *
 * === 开发规范：哪些工具必须生成 editOperations ===
 *
 * editOperations 是时间轴可视化协议。工具按「是否产生可独立操作的新素材条」分为三类：
 *
 * A 类 — 产生新素材/新轨道  →  output + metadata + editOperations
 *   加 BGM、画中画、智能裁剪、素材搜索、字幕轨道、视频生成(Seedance)……
 *   共同点：时间轴上多了一条用户可见、可拖拽、可删除的素材条。
 *   必须生成 editOperations 描述这条新素材。
 *
 * B 类 — 原地修改  →  output + metadata（不需要 editOperations）
 *   裁剪(trim)、变速(speed)、旋转(rotate)、调色(lut_filter)、
 *   格式转换(convert)、音频提取(extract-audio)……
 *   共同点：素材内容变了，但时间轴上没有新增任何东西。
 *   撤销信息通过 metadata.undo 传递，不走 editOperations。
 *
 * C 类 — 纯查询  →  output + metadata（不需要 editOperations / undo）
 *   获取视频信息、硬件加速检测…… 不产生文件，不修改素材。
 *
 * ⚠️ 判断标准：操作完成后，时间轴上是否多了一条用户可独立操作的素材条？
 *   是 → A 类，生成 editOperations。否 → B 或 C。
 */

// ============================================================================
// 顶层容器
// ============================================================================

export interface EditOperations {
  /** 协议版本，用于未来升级兼容 */
  version: "1.0"
  /** 事务 ID — 同一个 AI 轮次的所有操作共享，用于一键撤销 */
  transactionId: string
  /** 原始素材在时间轴上的 clipId（如果有） */
  sourceClipId?: string
  /** 原始素材的 assetId */
  sourceAssetId?: string
  /** 操作列表 — 按顺序串行执行 */
  operations: EditOperation[]
}

// ============================================================================
// 联合操作类型
// ============================================================================

export type EditOperation =
  | AddClipOp
  | RemoveClipOp
  | AddEffectOp
  | AddTransitionOp
  | AddTextOp
  | TrimClipOp
  | SpeedClipOp
  | AudioLevelOp
  | CustomEffectOp

// ============================================================================
// 基础字段（所有操作共享）
// ============================================================================

export interface BaseEditOp {
  /** 每个操作的唯一 ID，用于去重和撤销单个操作 */
  operationId: string
  /** 是否可撤销（默认 true，文件删除等操作设为 false）。B 类工具走 metadata.undo，此字段可省略。 */
  undoable?: boolean
  /** 元数据：调试信息、人类可读描述、时间戳 */
  metadata?: {
    /** 哪个工具生成了这个操作 */
    toolName?: string
    /** 人类可读描述，如 "裁剪视频到10-20秒" */
    description?: string
    /** 操作执行的时间戳 */
    timestamp?: number
  }
}

// ============================================================================
// 具体操作类型
// ============================================================================

/** 向时间轴添加一个新 clip */
export interface AddClipOp extends BaseEditOp {
  type: "add_clip"
  /** 唯一 ID（UUID），后续所有操作通过此 ID 引用，不随时间轴变化 */
  clipId: string
  asset: {
    url: string
    path: string
    type: "video" | "audio" | "image"
  }
  trackKind: "video" | "audio"
  trackName: string
  startTime: number
  duration: number
  trimStart?: number
  trimEnd?: number
}

/** 从时间轴移除一个 clip */
export interface RemoveClipOp extends BaseEditOp {
  type: "remove_clip"
  /** 被删除的 clip 的 ID */
  targetClipId: string
}

/** 给指定 clip 添加效果 */
export interface AddEffectOp extends BaseEditOp {
  type: "add_effect"
  /** 目标 clip ID（不是数组索引） */
  targetClipId: string
  effect: {
    type: "lut" | "blur" | "sharpen" | "chroma_key" | "picture_in_picture"
    params: Record<string, unknown>
  }
}

/** 在两个 clip 之间添加过渡 */
export interface AddTransitionOp extends BaseEditOp {
  type: "add_transition"
  /** 前一个 clip ID */
  fromClipId: string
  /** 后一个 clip ID */
  toClipId: string
  transition: {
    type: "dissolve" | "wipe" | "slide"
    duration: number
  }
}

/** 添加文字/字幕 */
export interface AddTextOp extends BaseEditOp {
  type: "add_text"
  trackName: string
  startTime: number
  duration: number
  text: string
  style: {
    fontSize?: number
    fontColor?: string
    position?: { x: number; y: number }
  }
}

/** 裁剪 clip */
export interface TrimClipOp extends BaseEditOp {
  type: "trim_clip"
  /** 目标 clip ID */
  targetClipId: string
  trimStart: number
  trimEnd: number
}

/** 变速 clip */
export interface SpeedClipOp extends BaseEditOp {
  type: "speed_clip"
  /** 目标 clip ID */
  targetClipId: string
  speed: number
}

/** 调整音频音量 */
export interface AudioLevelOp extends BaseEditOp {
  type: "audio_level"
  /** 目标 clip ID */
  targetClipId: string
  /** 音量 0-100 */
  volume: number
  /** 是否静音 */
  muted?: boolean
}

/** 自定义效果（扩展槽） */
export interface CustomEffectOp extends BaseEditOp {
  type: "custom_effect"
  /** 目标 clip ID */
  targetClipId: string
  effectName: string
  rawParams: Record<string, unknown>
}

// ============================================================================
// 工具函数
// ============================================================================

/** 生成唯一的 operationId */
export function generateOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** 生成唯一的 clipId（用于 AddClipOp） */
export function generateClipId(): string {
  return `clip_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`
}

/** 生成事务 ID */
export function generateTransactionId(): string {
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}
