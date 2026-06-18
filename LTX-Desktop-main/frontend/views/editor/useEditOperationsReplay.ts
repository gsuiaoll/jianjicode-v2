/**
 * Phase 2.0 — useEditOperationsReplay
 *
 * 接收 AI 工具生成的 EditOperation[]，按顺序还原到时间轴上。
 *
 * 核心机制：
 * - clipIdMap: editOp.clipId → 时间轴 clipId，解决索引漂移
 * - executedOps: operationId 去重，SSE 重连不重复执行
 * - transactionId 事务切换：新事务清空映射
 * - 所有操作在一个 undo group 中，Ctrl+Z 一键撤销
 */

import { useRef, useState, useCallback } from "react"
import type { EditOperation } from "../../../../jianjicode/src/types/edit-operations"
import type { Asset, TimelineClip } from "../../types/project"

// ============================================================================
// 参数类型
// ============================================================================

export interface UseEditOperationsReplayParams {
  addClipToTimeline: (
    asset: Asset,
    trackIndex?: number,
    startTime?: number,
  ) => TimelineClip | undefined
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void
  removeClip: (clipId: string) => void
  addEffectToClip: (clipId: string, effect: any) => void
  addTextClip: (
    trackIndex: number,
    startTime: number,
    text: string,
    duration?: number,
    style?: any,
  ) => void
  tracks: Array<{ type?: string; kind?: string; name?: string; locked?: boolean }>
  setCurrentTime: (time: number) => void
  pushUndo: () => void
  addAsset: (projectId: string, data: any) => Asset
  currentProjectId: string | null
}

export interface UseEditOperationsReplayResult {
  replayOperations: (
    transactionId: string,
    ops: EditOperation[],
  ) => Promise<void>
  undoLastTransaction: () => void
  isReplaying: boolean
  replayProgress: { current: number; total: number } | null
  cancelReplay: () => void
}

// ============================================================================
// Hook
// ============================================================================

const ANIMATION_DELAY_MS = 200
const MAX_ANIMATED_OPS = 10

export function useEditOperationsReplay(
  params: UseEditOperationsReplayParams,
): UseEditOperationsReplayResult {
  const {
    addClipToTimeline,
    updateClip,
    removeClip,
    addEffectToClip,
    addTextClip,
    tracks,
    setCurrentTime,
    pushUndo,
    addAsset,
    currentProjectId,
  } = params

  // clipIdMap: editOp.clipId → 时间轴 clipId
  const clipIdMap = useRef<Map<string, string>>(new Map())
  // 已执行的 operationId（去重）
  const executedOps = useRef<Set<string>>(new Set())
  // 当前事务 ID
  const currentTransactionId = useRef<string | null>(null)
  // 取消信号
  const cancelRef = useRef(false)

  const [isReplaying, setIsReplaying] = useState(false)
  const [replayProgress, setReplayProgress] = useState<{
    current: number
    total: number
  } | null>(null)

  // -------------------------------------------------------------------------
  // 查找 track 索引
  // -------------------------------------------------------------------------

  const findTrackIndex = useCallback(
    (kind: "video" | "audio", _trackName: string): number => {
      // 优先按名称匹配
      const byName = tracks.findIndex(
        (t) => t.name === _trackName && !t.locked,
      )
      if (byName >= 0) return byName
      // fallback: 按 kind 找第一个未锁定的轨道
      return tracks.findIndex(
        (t) =>
          (t.kind === kind || t.type === kind) && !t.locked,
      )
    },
    [tracks],
  )

  // -------------------------------------------------------------------------
  // 单个操作分发
  // -------------------------------------------------------------------------

  const executeOneOp = useCallback(
    (op: EditOperation): boolean => {
      // 去重
      if (executedOps.current.has(op.operationId)) return true
      executedOps.current.add(op.operationId)

      switch (op.type) {
        case "add_clip": {
          const realId = crypto.randomUUID?.() ?? `clip_${Date.now()}`
          const asset = addAsset(currentProjectId || "", {
            type: op.asset.type,
            path: op.asset.path,
            url: op.asset.url,
            prompt: op.metadata?.description || `Imported: ${op.asset.path.split("/").pop()}`,
            duration: op.duration,
          })
          const trackIdx = findTrackIndex(op.trackKind, op.trackName)
          const clip = addClipToTimeline(asset, trackIdx, op.startTime)
          if (clip) {
            clipIdMap.current.set(op.clipId, clip.id)
            // 处理 trimStart / trimEnd
            if (op.trimStart !== undefined || op.trimEnd !== undefined) {
              updateClip(clip.id, {
                trimStart: op.trimStart,
                trimEnd: op.trimEnd,
              })
            }
            setCurrentTime(op.startTime)
          }
          break
        }

        case "remove_clip": {
          const realId = clipIdMap.current.get(op.targetClipId)
          if (realId) removeClip(realId)
          break
        }

        case "add_effect": {
          const realId = clipIdMap.current.get(op.targetClipId)
          if (realId) addEffectToClip(realId, op.effect)
          break
        }

        case "add_transition": {
          // 转场标记：通过 updateClip 给 fromClip 设置 transition
          const fromId = clipIdMap.current.get(op.fromClipId)
          if (fromId) {
            updateClip(fromId, {
              transition: {
                type: op.transition.type,
                duration: op.transition.duration,
              },
            } as any)
          }
          break
        }

        case "add_text": {
          const trackIdx = findTrackIndex("video", op.trackName)
          addTextClip(
            trackIdx,
            op.startTime,
            op.text,
            op.duration,
            op.style,
          )
          setCurrentTime(op.startTime)
          break
        }

        case "trim_clip": {
          const realId = clipIdMap.current.get(op.targetClipId)
          if (realId) {
            updateClip(realId, {
              trimStart: op.trimStart,
              trimEnd: op.trimEnd,
            })
          }
          break
        }

        case "speed_clip": {
          const realId = clipIdMap.current.get(op.targetClipId)
          if (realId) updateClip(realId, { speed: op.speed })
          break
        }

        case "audio_level": {
          const realId = clipIdMap.current.get(op.targetClipId)
          if (realId) {
            updateClip(realId, {
              volume: op.volume / 100,
              muted: op.muted,
            })
          }
          break
        }

        case "custom_effect": {
          const realId = clipIdMap.current.get(op.targetClipId)
          if (realId) {
            addEffectToClip(realId, {
              type: op.effectName,
              params: op.rawParams,
            })
          }
          break
        }

        default:
          return true
      }

      return true
    },
    [
      addClipToTimeline,
      updateClip,
      removeClip,
      addEffectToClip,
      addTextClip,
      findTrackIndex,
      setCurrentTime,
      addAsset,
      currentProjectId,
    ],
  )

  // -------------------------------------------------------------------------
  // 主入口：replayOperations
  // -------------------------------------------------------------------------

  const replayOperations = useCallback(
    async (transactionId: string, ops: EditOperation[]) => {
      if (ops.length === 0) return

      // 新事务 → 清空映射
      if (currentTransactionId.current !== transactionId) {
        clipIdMap.current.clear()
        executedOps.current.clear()
        currentTransactionId.current = transactionId
      }

      cancelRef.current = false
      pushUndo() // 所有操作在一个 undo group 中

      const shouldAnimate = ops.length <= MAX_ANIMATED_OPS
      setIsReplaying(true)
      setReplayProgress({ current: 0, total: ops.length })

      for (let i = 0; i < ops.length; i++) {
        if (cancelRef.current) break

        const op = ops[i]
        executeOneOp(op)
        setReplayProgress({ current: i + 1, total: ops.length })

        if (shouldAnimate && i < ops.length - 1) {
          await new Promise((r) => setTimeout(r, ANIMATION_DELAY_MS))
        }
      }

      setIsReplaying(false)
      setReplayProgress(null)
    },
    [pushUndo, executeOneOp],
  )

  // -------------------------------------------------------------------------
  // 撤销最后事务
  // -------------------------------------------------------------------------

  const undoLastTransaction = useCallback(() => {
    // undo 由外部 VideoEditor 的全局 undo 系统处理
    // 这里只是清理内部状态
    clipIdMap.current.clear()
    executedOps.current.clear()
    currentTransactionId.current = null
  }, [])

  const cancelReplay = useCallback(() => {
    cancelRef.current = true
  }, [])

  return {
    replayOperations,
    undoLastTransaction,
    isReplaying,
    replayProgress,
    cancelReplay,
  }
}
