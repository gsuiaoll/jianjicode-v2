import { useCallback, useRef } from 'react'
import type { Asset, AssetTake, TimelineClip } from '../../types/project'

function getVideoDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => resolve(video.duration)
    video.onerror = () => reject(new Error('Failed to load video'))
    video.src = url
  })
}

interface TimelineAction {
  action: 'add_take' | 'add_asset_result'
  targetAssetId?: string
  targetClipId?: string
  outputUrl: string
  outputPath: string
  outputDuration?: number
}

interface UseAIResultApplicationParams {
  assets: Asset[]
  clips: TimelineClip[]
  currentProjectId: string | null
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  pushUndo: () => void
  addTakeToAsset: (projectId: string, assetId: string, take: AssetTake) => void
  setAssetActiveTake: (projectId: string, assetId: string, takeIndex: number) => void
  onApplied?: (action: TimelineAction, assetId: string) => void
}

export function useAIResultApplication({
  assets,
  clips,
  currentProjectId,
  setClips,
  pushUndo,
  addTakeToAsset,
  setAssetActiveTake,
  onApplied,
}: UseAIResultApplicationParams) {
  const appliedRef = useRef<Map<string, { prevTakeIndex: number }>>(new Map())

  const applyResult = useCallback(
    async (action: TimelineAction) => {
      if (!currentProjectId) throw new Error('No project selected')

      const assetId = action.targetAssetId
      if (!assetId) throw new Error('No target asset')

      const asset = assets.find((a) => a.id === assetId)
      if (!asset) throw new Error(`Asset not found: ${assetId}`)

      pushUndo()

      // Record current take index for undo
      const prevTakeIndex = asset.activeTakeIndex ?? 0
      appliedRef.current.set(assetId, { prevTakeIndex })

      // Add new take
      addTakeToAsset(currentProjectId, assetId, {
        url: action.outputUrl,
        path: action.outputPath,
        createdAt: Date.now(),
      })

      // newTakeIndex = current takes count (appended to end).
      // addTakeToAsset creates an implicit take 0 when asset.takes is
      // undefined, so the new take always lands at (takes?.length ?? 1).
      const newTakeIndex = asset.takes?.length ?? 1

      // Activate the new take
      setAssetActiveTake(currentProjectId, assetId, newTakeIndex)

      // If there's a target clip on the timeline, update its takeIndex
      // and sync duration when the output video length differs (e.g. after trim).
      if (action.targetClipId) {
        // Resolve output duration: prefer backend-provided value, fall back
        // to loading the actual video metadata in the browser.
        let outDuration = action.outputDuration
        if (!outDuration || outDuration <= 0) {
          try {
            outDuration = await getVideoDuration(action.outputUrl)
          } catch {
            // keep undefined — skip duration update if we can't determine it
          }
        }

        // Collect linked clip IDs (e.g. audio track split from same video)
        // so they get the same takeIndex + duration update.
        const targetClip = clips.find((c) => c.id === action.targetClipId)
        const linkedIds = new Set(targetClip?.linkedClipIds || [])

        setClips((prev) =>
          prev.map((c) => {
            if (c.id !== action.targetClipId && !linkedIds.has(c.id)) return c
            const updates: Partial<typeof c> = { takeIndex: newTakeIndex }
            if (outDuration && outDuration > 0) {
              updates.duration = outDuration
            }
            return { ...c, ...updates }
          }),
        )
      }

      onApplied?.(action, assetId)
    },
    [
      assets,
      clips,
      currentProjectId,
      setClips,
      pushUndo,
      addTakeToAsset,
      setAssetActiveTake,
      onApplied,
    ],
  )

  const undoApplication = useCallback(
    (assetId: string) => {
      const record = appliedRef.current.get(assetId)
      if (!record || !currentProjectId) return

      setAssetActiveTake(currentProjectId, assetId, record.prevTakeIndex)
      appliedRef.current.delete(assetId)
    },
    [currentProjectId, setAssetActiveTake],
  )

  return { applyResult, undoApplication }
}
