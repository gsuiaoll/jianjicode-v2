import { useState, useRef, useCallback, useEffect } from 'react'
import { Play, Pause, Check, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types (shared with backend protocol)
// ---------------------------------------------------------------------------

export interface StepDetail {
  step: number
  name: string
  tool: string
  description: string
  inputUrl: string
  outputUrl: string
  inputLabel: string
  outputLabel: string
  duration?: number
  changes?: string[]
}

export interface EditPreview {
  steps: StepDetail[]
  sourceType: 'timeline' | 'asset_library'
  sourceAssetId?: string
  sourceClipId?: string
  sourceTrackIndex?: number
  sourceStartTime?: number
}

export interface TimelineAction {
  action: 'add_take' | 'add_asset_result'
  targetAssetId?: string
  targetClipId?: string
  outputUrl: string
  outputPath: string
  outputDuration?: number
}

// ---------------------------------------------------------------------------
// Step Video Player
// ---------------------------------------------------------------------------

function StepVideoPlayer({
  url,
  label,
  borderColor,
  labelColor,
}: {
  url: string
  label: string
  borderColor: string
  labelColor: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) {
      v.play().catch(() => {})
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }, [])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  return (
    <div
      className="relative rounded-lg overflow-hidden cursor-pointer group"
      style={{ border: `2px solid ${borderColor}` }}
      onClick={togglePlay}
    >
      {/* Label badge */}
      <div
        className="absolute top-2 left-2 z-10 px-2 py-0.5 rounded text-xs font-semibold"
        style={{ backgroundColor: labelColor, color: '#fff' }}
      >
        {label}
      </div>

      {/* Play overlay */}
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="p-3 rounded-full bg-black/60 text-white">
          {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
        </div>
      </div>

      <video
        ref={videoRef}
        src={url}
        className="w-full bg-zinc-900 rounded-lg"
        style={{
          aspectRatio: aspectRatio ?? '16/9',
          maxHeight: '60vh',
          objectFit: 'contain',
        }}
        preload="metadata"
        onLoadedMetadata={() => {
          const v = videoRef.current
          if (v) {
            setDuration(v.duration || 0)
            const w = v.videoWidth || 0
            const h = v.videoHeight || 0
            if (w > 0 && h > 0) setAspectRatio(w / h)
          }
        }}
        onEnded={() => setPlaying(false)}
      />

      {/* Duration badge */}
      {duration > 0 && (
        <div className="absolute bottom-2 right-2 z-10 px-1.5 py-0.5 rounded bg-black/70 text-white text-xs">
          {formatTime(duration)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single Step Row
// ---------------------------------------------------------------------------

function StepRow({ detail, stepIndex, expanded: controlled }: { detail: StepDetail; stepIndex: number; expanded?: boolean }) {
  const [expanded, setExpanded] = useState(false)

  // 父组件的"全部展开/收起"按钮控制这里的行为
  useEffect(() => {
    if (controlled !== undefined) {
      setExpanded(controlled)
    }
  }, [controlled])

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      {/* Step header */}
      <button
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800/50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold text-white">
          {stepIndex + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-zinc-200 truncate">{detail.name}</div>
          <div className="text-xs text-zinc-500 truncate">{detail.description}</div>
        </div>
        {detail.changes && detail.changes.length > 0 && (
          <span className="text-xs text-zinc-500 hidden sm:inline">
            {detail.changes.length} 项变化
          </span>
        )}
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
        )}
      </button>

      {/* Step body — video comparison */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Changes list */}
          {detail.changes && detail.changes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {detail.changes.map((change, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 text-xs rounded bg-zinc-800 text-zinc-300"
                >
                  {change}
                </span>
              ))}
            </div>
          )}

          {/* Side-by-side videos */}
          <div className="grid grid-cols-2 gap-3">
            {detail.inputUrl && (
              <StepVideoPlayer
                url={detail.inputUrl}
                label={detail.inputLabel || '修改前'}
                borderColor="#ef4444"
                labelColor="#ef4444"
              />
            )}
            {detail.outputUrl && (
              <StepVideoPlayer
                url={detail.outputUrl}
                label={detail.outputLabel || '修改后'}
                borderColor="#22c55e"
                labelColor="#22c55e"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Card
// ---------------------------------------------------------------------------

type ApplyStatus = 'idle' | 'applying' | 'applied'

interface VideoEditResultCardProps {
  preview: EditPreview
  timelineAction?: TimelineAction
  onApply?: (action: TimelineAction) => Promise<void>
  onDiscard?: () => void
}

export function VideoEditResultCard({
  preview,
  timelineAction,
  onApply,
  onDiscard,
}: VideoEditResultCardProps) {
  const [applyStatus, setApplyStatus] = useState<ApplyStatus>('idle')
  const [allExpanded, setAllExpanded] = useState(false)

  const sourceLabel =
    preview.sourceType === 'timeline' ? '时间轴选中片段' : '素材库选中素材'

  const handleApply = async () => {
    if (!timelineAction || !onApply) return
    setApplyStatus('applying')
    try {
      await onApply(timelineAction)
      setApplyStatus('applied')
    } catch {
      setApplyStatus('idle')
    }
  }

  return (
    <div className="my-3 border border-emerald-800/40 rounded-xl overflow-hidden bg-zinc-900/60">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3">
        <span className="text-lg">🎬</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-zinc-200">
            AI 视频剪辑完成 — 共 {preview.steps.length} 步
          </div>
          <div className="text-xs text-zinc-500">{sourceLabel}</div>
        </div>
        <button
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          onClick={() => setAllExpanded(!allExpanded)}
        >
          {allExpanded ? '全部收起' : '全部展开'}
        </button>
      </div>

      {/* Steps */}
      <div className="px-4 py-3 space-y-2">
        {preview.steps.map((detail, i) => (
          <StepRow
            key={`${detail.step}-${detail.tool}`}
            detail={detail}
            stepIndex={i}
            expanded={allExpanded}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-zinc-800 flex items-center gap-3">
        {timelineAction && onApply && (
          <button
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              applyStatus === 'applied'
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-600/40 cursor-default'
                : applyStatus === 'applying'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-600/40 cursor-wait'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500 active:scale-[0.98]'
            }`}
            disabled={applyStatus !== 'idle'}
            onClick={handleApply}
          >
            {applyStatus === 'applying' && <Loader2 className="w-4 h-4 animate-spin" />}
            {applyStatus === 'applied' && <Check className="w-4 h-4" />}
            {applyStatus === 'idle' && <Check className="w-4 h-4" />}
            {applyStatus === 'idle' && (
              preview.sourceType === 'timeline' ? '应用到时间轴' : '保存到素材库'
            )}
            {applyStatus === 'applying' && '正在应用...'}
            {applyStatus === 'applied' && '已应用'}
          </button>
        )}
        {applyStatus === 'applied' && (
          <button
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            onClick={() => setApplyStatus('idle')}
          >
            撤销
          </button>
        )}
        {onDiscard && (
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            onClick={onDiscard}
          >
            <X className="w-4 h-4" />
            放弃
          </button>
        )}
      </div>
    </div>
  )
}
