import { useEffect, useRef } from 'react'
import { resolveAction, type ActionId } from '../../lib/keyboard-shortcuts'
import type { TimelineClip, Track } from '../../types/project'
import type { ToolType } from './video-editor-utils'

// Frame duration at 24fps
const FRAME_DURATION = 1 / 24

const FORWARD_SPEEDS = [1, 2, 4, 8]
const REVERSE_SPEEDS = [-1, -2, -4, -8]

interface KeyboardRefs {
  kbLayoutRef: React.MutableRefObject<any>
  isKbEditorOpenRef: React.MutableRefObject<boolean>
  activePanelRef: React.MutableRefObject<'source' | 'timeline'>
  keyboardStateRef: React.MutableRefObject<{
    clips: TimelineClip[]
    selectedClipIds: Set<string>
    totalDuration: number
    selectedAssetIds: Set<string>
    currentTime: number
    inPoint: number | null
    outPoint: number | null
  }>
  clipsRef: React.MutableRefObject<TimelineClip[]>
  tracksRef: React.MutableRefObject<Track[]>
  playbackTimeRef: React.MutableRefObject<number>
  isPlayingRef: React.MutableRefObject<boolean>
  sourceVideoRef: React.MutableRefObject<HTMLVideoElement | null>
  sourceIsPlayingRef: React.MutableRefObject<boolean>
  sourceTimeRef: React.MutableRefObject<number>
  centerOnPlayheadRef: React.MutableRefObject<boolean>
  getMinZoomRef: React.MutableRefObject<() => number>
  gapGenerateModeRef: React.MutableRefObject<'text-to-video' | 'image-to-video' | 'text-to-image' | null>
  undoRef: React.MutableRefObject<() => void>
  redoRef: React.MutableRefObject<() => void>
  copyRef: React.MutableRefObject<() => void>
  pasteRef: React.MutableRefObject<() => void>
  cutRef: React.MutableRefObject<() => void>
  pushUndoRef: React.MutableRefObject<() => void>
  pushAssetUndoRef: React.MutableRefObject<() => void>
  fitToViewRef: React.MutableRefObject<() => void>
  toggleFullscreenRef: React.MutableRefObject<() => void>
  insertEditRef: React.MutableRefObject<() => void>
  overwriteEditRef: React.MutableRefObject<() => void>
  matchFrameRef: React.MutableRefObject<() => void>
  saveRef: React.MutableRefObject<() => void>
  exportRef: React.MutableRefObject<() => void>
  splitClipAtPlayheadRef: React.MutableRefObject<(clipId: string, atTime?: number, batchClipIds?: string[]) => void>
  groupRef: React.MutableRefObject<() => void>
  ungroupRef: React.MutableRefObject<() => void>
  copyAttributesRef: React.MutableRefObject<() => void>
  pasteAttributesRef: React.MutableRefObject<() => void>
  rippleDeleteRef: React.MutableRefObject<(direction: 'left' | 'right') => void>
  nudgeRef: React.MutableRefObject<(direction: 'left' | 'right') => void>
  applyDefaultTransitionRef: React.MutableRefObject<() => void>
  addMarkerRef: React.MutableRefObject<() => void>
  deleteMarkerRef: React.MutableRefObject<() => void>
  jumpNextMarkerRef: React.MutableRefObject<() => void>
  jumpPrevMarkerRef: React.MutableRefObject<() => void>
  // Audio
  separateAudioRef: React.MutableRefObject<() => void>
  restoreAudioRef: React.MutableRefObject<() => void>
  // Subtitle
  addSubtitleRef: React.MutableRefObject<() => void>
  splitSubtitleRef: React.MutableRefObject<() => void>
  lineBreakSubtitleRef: React.MutableRefObject<() => void>
}

interface KeyboardSetters {
  setActiveTool: React.Dispatch<React.SetStateAction<ToolType>>
  setLastTrimTool: React.Dispatch<React.SetStateAction<ToolType>>
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>
  setShuttleSpeed: React.Dispatch<React.SetStateAction<number>>
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  setSourceIsPlaying: (v: boolean) => void
  setSourceTime: (v: number) => void
  setSourceIn: React.Dispatch<React.SetStateAction<number | null>>
  setSourceOut: React.Dispatch<React.SetStateAction<number | null>>
  setInPoint: (updater: (prev: number | null) => number | null) => void
  setOutPoint: (updater: (prev: number | null) => number | null) => void
  clearInOut: () => void
  setZoom: React.Dispatch<React.SetStateAction<number>>
  setSnapEnabled: React.Dispatch<React.SetStateAction<boolean>>
  setGapGenerateMode: React.Dispatch<React.SetStateAction<'text-to-video' | 'image-to-video' | 'text-to-image' | null>>
  setSelectedGap: (v: any) => void
  setSelectedAssetIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>
  pushUndo: () => void
}

interface KeyboardContext {
  selectedGap: { trackIndex: number; startTime: number; endTime: number } | null
  selectedSubtitleId: string | null
  editingSubtitleId: string | null
  currentProjectId: string | null
  deleteSubtitleRef: React.MutableRefObject<(id: string) => void>
  deleteAsset: (projectId: string, assetId: string) => void
  deleteGapRef: React.MutableRefObject<(gap: { trackIndex: number; startTime: number; endTime: number }) => void>
}

export interface UseEditorKeyboardParams {
  refs: KeyboardRefs
  setters: KeyboardSetters
  context: KeyboardContext
}

export function useEditorKeyboard(params: UseEditorKeyboardParams) {
  const { refs, setters, context } = params
  const kHeldRef = useRef(false)
  const contextRef = useRef(context)
  contextRef.current = context

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (refs.isKbEditorOpenRef.current) return
      // Ignore events during IME composition (e.g. Chinese/Japanese input)
      if (e.isComposing) return

      const context = contextRef.current
      const { clips: c, selectedClipIds: sel, totalDuration: td, selectedAssetIds: selAssets } = refs.keyboardStateRef.current

      const action: ActionId | null = resolveAction(refs.kbLayoutRef.current, e)

      // Debug: enable via localStorage.setItem('ltx-debug-kb', '1')
      if (typeof localStorage !== 'undefined' && localStorage.getItem('ltx-debug-kb') === '1') {
        const mods = [
          e.ctrlKey && 'C', e.metaKey && 'M', e.shiftKey && 'S', e.altKey && 'A'
        ].filter(Boolean).join('+')
        // eslint-disable-next-line no-console
        console.log(
          `%c[KB]%c key="${e.key}" code="${e.code}" mods="${mods || 'none'}" → %c${action || 'NO MATCH'}`,
          'color:#0cf', 'color:inherit', action ? 'color:#0f0' : 'color:#f00'
        )
      }

      if (!action) return

      e.preventDefault()

      switch (action) {
        // Tools
        case 'tool.select':       setters.setActiveTool('select'); break
        case 'tool.blade':        setters.setActiveTool('blade'); break
        case 'tool.ripple':       setters.setActiveTool('ripple'); setters.setLastTrimTool('ripple'); break
        case 'tool.roll':         setters.setActiveTool('roll'); setters.setLastTrimTool('roll'); break
        case 'tool.slide':        setters.setActiveTool('slide'); setters.setLastTrimTool('slide'); break
        case 'tool.slip':         setters.setActiveTool('slip'); setters.setLastTrimTool('slip'); break
        case 'tool.trackForward': setters.setActiveTool('trackForward'); break

        // Transport — panel-aware
        case 'transport.playPause':
          if (refs.activePanelRef.current === 'source') {
            // Stop timeline playback when starting source playback
            refs.isPlayingRef.current = false; setters.setIsPlaying(false)
            setters.setShuttleSpeed(0)
            if (refs.sourceIsPlayingRef.current) {
              refs.sourceVideoRef.current?.pause()
              setters.setSourceIsPlaying(false)
            } else {
              if (refs.sourceVideoRef.current) refs.sourceVideoRef.current.play().catch(() => {})
              setters.setSourceIsPlaying(true)
            }
          } else {
            // Stop source playback when starting timeline playback
            if (refs.sourceIsPlayingRef.current) {
              refs.sourceVideoRef.current?.pause()
              setters.setSourceIsPlaying(false)
            }
            setters.setShuttleSpeed(0)
            refs.isPlayingRef.current = !refs.isPlayingRef.current
            setters.setIsPlaying(p => !p)
          }
          break

        case 'transport.shuttleReverse':
          if (refs.activePanelRef.current === 'source') {
            if (refs.sourceVideoRef.current) {
              refs.sourceVideoRef.current.pause()
              setters.setSourceIsPlaying(false)
              refs.sourceVideoRef.current.currentTime = Math.max(0, refs.sourceVideoRef.current.currentTime - FRAME_DURATION)
              setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
            }
          } else {
            if (kHeldRef.current) {
              refs.isPlayingRef.current = false; setters.setIsPlaying(false); setters.setShuttleSpeed(0)
              setters.setCurrentTime(prev => Math.max(0, prev - FRAME_DURATION))
            } else {
              setters.setShuttleSpeed(prev => {
                if (prev > 0) return -1
                const idx = REVERSE_SPEEDS.indexOf(prev)
                const nextIdx = idx >= 0 ? Math.min(idx + 1, REVERSE_SPEEDS.length - 1) : 0
                return REVERSE_SPEEDS[nextIdx]
              })
              refs.isPlayingRef.current = true; setters.setIsPlaying(true)
            }
          }
          break

        case 'transport.shuttleStop':
        case 'transport.stop':
          if (refs.activePanelRef.current === 'source') {
            refs.sourceVideoRef.current?.pause()
            setters.setSourceIsPlaying(false)
          } else {
            kHeldRef.current = true
            refs.isPlayingRef.current = false; setters.setShuttleSpeed(0)
            setters.setIsPlaying(false)
          }
          break

        case 'transport.shuttleForward':
          if (refs.activePanelRef.current === 'source') {
            if (refs.sourceVideoRef.current) {
              if (kHeldRef.current) {
                refs.sourceVideoRef.current.pause()
                setters.setSourceIsPlaying(false)
                refs.sourceVideoRef.current.currentTime = Math.min(refs.sourceVideoRef.current.duration || 0, refs.sourceVideoRef.current.currentTime + FRAME_DURATION)
                setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
              } else {
                refs.sourceVideoRef.current.play().catch(() => {})
                setters.setSourceIsPlaying(true)
              }
            }
          } else {
            if (kHeldRef.current) {
              refs.isPlayingRef.current = false; setters.setIsPlaying(false); setters.setShuttleSpeed(0)
              setters.setCurrentTime(prev => Math.min(td, prev + FRAME_DURATION))
            } else {
              setters.setShuttleSpeed(prev => {
                if (prev < 0) return 1
                const idx = FORWARD_SPEEDS.indexOf(prev)
                const nextIdx = idx >= 0 ? Math.min(idx + 1, FORWARD_SPEEDS.length - 1) : 0
                return FORWARD_SPEEDS[nextIdx]
              })
              refs.isPlayingRef.current = true; setters.setIsPlaying(true)
            }
          }
          break

        case 'transport.stepBackward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            refs.sourceVideoRef.current.currentTime = Math.max(0, refs.sourceVideoRef.current.currentTime - FRAME_DURATION)
            setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
          } else {
            setters.setCurrentTime(prev => Math.max(0, prev - FRAME_DURATION))
          }
          break

        case 'transport.stepForward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            refs.sourceVideoRef.current.currentTime = Math.min(refs.sourceVideoRef.current.duration || 0, refs.sourceVideoRef.current.currentTime + FRAME_DURATION)
            setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
          } else {
            setters.setCurrentTime(prev => Math.min(td, prev + FRAME_DURATION))
          }
          break

        case 'transport.jumpBackward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            refs.sourceVideoRef.current.currentTime = Math.max(0, refs.sourceVideoRef.current.currentTime - 1)
            setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
          } else {
            setters.setCurrentTime(prev => Math.max(0, prev - 1))
          }
          break

        case 'transport.jumpForward':
          if (refs.activePanelRef.current === 'source' && refs.sourceVideoRef.current) {
            refs.sourceVideoRef.current.currentTime = Math.min(refs.sourceVideoRef.current.duration || 0, refs.sourceVideoRef.current.currentTime + 1)
            setters.setSourceTime(refs.sourceVideoRef.current.currentTime)
          } else {
            setters.setCurrentTime(prev => Math.min(td, prev + 1))
          }
          break

        case 'transport.goToStart':
          refs.isPlayingRef.current = false; setters.setCurrentTime(0); setters.setIsPlaying(false); setters.setShuttleSpeed(0)
          break
        case 'transport.goToEnd':
          refs.isPlayingRef.current = false; setters.setCurrentTime(td); setters.setIsPlaying(false); setters.setShuttleSpeed(0)
          break
        case 'transport.goToIn': {
          const { inPoint, clips } = refs.keyboardStateRef.current
          const target = inPoint ?? (clips.length > 0 ? Math.min(...clips.map(c => c.startTime)) : 0)
          refs.isPlayingRef.current = false; setters.setIsPlaying(false); setters.setShuttleSpeed(0); setters.setCurrentTime(target)
          break
        }
        case 'transport.goToOut': {
          const { outPoint, clips: clipsOut, totalDuration: tdOut } = refs.keyboardStateRef.current
          const target = outPoint ?? (clipsOut.length > 0 ? Math.max(...clipsOut.map(c => c.startTime + c.duration)) : tdOut)
          refs.isPlayingRef.current = false; setters.setIsPlaying(false); setters.setShuttleSpeed(0); setters.setCurrentTime(target)
          break
        }

        // Editing
        case 'edit.undo':    refs.undoRef.current(); break
        case 'edit.redo':    refs.redoRef.current(); break
        case 'edit.cut':     refs.cutRef.current(); break
        case 'edit.copy':    refs.copyRef.current(); break
        case 'edit.paste':   refs.pasteRef.current(); break
        case 'edit.selectAll':
          setters.setSelectedClipIds(new Set(c.map(cl => cl.id)))
          break
        case 'edit.deselect':
          if (refs.gapGenerateModeRef.current) {
            setters.setGapGenerateMode(null); setters.setSelectedGap(null)
          } else {
            setters.setSelectedClipIds(new Set())
          }
          break
        case 'edit.delete':
          if (sel.size > 0) {
            refs.pushUndoRef.current()
            const deleteIds = new Set<string>()
            for (const id of sel) {
              const clip = refs.clipsRef.current.find(cl => cl.id === id)
              if (clip && refs.tracksRef.current[clip.trackIndex]?.locked) continue
              deleteIds.add(id)
              if (clip?.linkedClipIds) {
                const allLinkedSelected = clip.linkedClipIds.every(lid => sel.has(lid))
                if (allLinkedSelected) clip.linkedClipIds.forEach(lid => deleteIds.add(lid))
              }
            }
            setters.setClips(prev => prev.filter(cl => !deleteIds.has(cl.id)).map(cl => {
              if (!cl.linkedClipIds) return cl
              const remaining = cl.linkedClipIds.filter(lid => !deleteIds.has(lid))
              return { ...cl, linkedClipIds: remaining.length ? remaining : undefined }
            }))
            setters.setSelectedClipIds(new Set())
          } else if (context.selectedGap) {
            refs.pushUndoRef.current(); context.deleteGapRef.current(context.selectedGap)
          } else if (context.selectedSubtitleId && !context.editingSubtitleId) {
            context.deleteSubtitleRef.current(context.selectedSubtitleId)
          } else if (selAssets.size > 0 && context.currentProjectId) {
            refs.pushAssetUndoRef.current()
            selAssets.forEach(id => context.deleteAsset(context.currentProjectId!, id))
            setters.setSelectedAssetIds(new Set())
          }
          break
        case 'edit.insertEdit':    refs.insertEditRef.current(); break
        case 'edit.overwriteEdit': refs.overwriteEditRef.current(); break
        case 'edit.matchFrame':    refs.matchFrameRef.current(); break

        // Split / Group / Attributes
        case 'edit.splitAtPlayhead': {
          const ct = refs.keyboardStateRef.current.currentTime
          const clipsAtPlayhead = refs.clipsRef.current.filter(c => {
            if (refs.tracksRef.current[c.trackIndex]?.locked) return false
            return ct > c.startTime + 0.01 && ct < c.startTime + c.duration - 0.01
          })
          if (clipsAtPlayhead.length > 0) {
            refs.splitClipAtPlayheadRef.current(clipsAtPlayhead[0].id, ct)
          }
          break
        }
        case 'edit.splitAllTracks': {
          const ct2 = refs.keyboardStateRef.current.currentTime
          const allClipsAtPlayhead = refs.clipsRef.current
            .filter(c => {
              if (refs.tracksRef.current[c.trackIndex]?.locked) return false
              return ct2 > c.startTime + 0.01 && ct2 < c.startTime + c.duration - 0.01
            })
            .map(c => c.id)
          if (allClipsAtPlayhead.length > 0) {
            refs.splitClipAtPlayheadRef.current(allClipsAtPlayhead[0], ct2, allClipsAtPlayhead)
          }
          break
        }
        case 'edit.group':         refs.groupRef.current(); break
        case 'edit.ungroup':       refs.ungroupRef.current(); break
        case 'edit.copyAttributes':  refs.copyAttributesRef.current(); break
        case 'edit.pasteAttributes': refs.pasteAttributesRef.current(); break
        case 'edit.rippleDeleteLeft':  refs.rippleDeleteRef.current('left'); break
        case 'edit.rippleDeleteRight': refs.rippleDeleteRef.current('right'); break
        case 'edit.nudgeLeft':  refs.nudgeRef.current('left'); break
        case 'edit.nudgeRight': refs.nudgeRef.current('right'); break
        case 'edit.applyDefaultTransition': refs.applyDefaultTransitionRef.current(); break

        // Selection
        case 'edit.selectLeft': {
          const ct = refs.keyboardStateRef.current.currentTime
          const ids = refs.clipsRef.current
            .filter(c => c.startTime + c.duration < ct + 0.01)
            .map(c => c.id)
          setters.setSelectedClipIds(new Set(ids))
          break
        }
        case 'edit.selectRight': {
          const ct = refs.keyboardStateRef.current.currentTime
          const ids = refs.clipsRef.current
            .filter(c => c.startTime >= ct - 0.01)
            .map(c => c.id)
          setters.setSelectedClipIds(new Set(ids))
          break
        }
        case 'edit.selectOverlapping': {
          const ct = refs.keyboardStateRef.current.currentTime
          const ids = refs.clipsRef.current
            .filter(c => ct > c.startTime + 0.01 && ct < c.startTime + c.duration - 0.01)
            .map(c => c.id)
          setters.setSelectedClipIds(new Set(ids))
          break
        }

        // Marking — panel-aware
        case 'mark.setIn':
          if (refs.activePanelRef.current === 'source') {
            const st = refs.sourceTimeRef.current
            setters.setSourceIn(prev => prev !== null && Math.abs(prev - st) < 0.01 ? null : st)
          } else {
            setters.setInPoint(prev => {
              const { currentTime: ct } = refs.keyboardStateRef.current
              if (prev !== null && Math.abs(prev - ct) < 0.01) return null
              return ct
            })
          }
          break
        case 'mark.setOut':
          if (refs.activePanelRef.current === 'source') {
            const st = refs.sourceTimeRef.current
            setters.setSourceOut(prev => prev !== null && Math.abs(prev - st) < 0.01 ? null : st)
          } else {
            setters.setOutPoint(prev => {
              const { currentTime: ct } = refs.keyboardStateRef.current
              if (prev !== null && Math.abs(prev - ct) < 0.01) return null
              return ct
            })
          }
          break
        case 'mark.clearIn':
          if (refs.activePanelRef.current === 'source') {
            setters.setSourceIn(null)
          } else {
            setters.setInPoint(() => null)
          }
          break
        case 'mark.clearOut':
          if (refs.activePanelRef.current === 'source') {
            setters.setSourceOut(null)
          } else {
            setters.setOutPoint(() => null)
          }
          break
        case 'mark.clearInOut':
          if (refs.activePanelRef.current === 'source') {
            setters.setSourceIn(null); setters.setSourceOut(null)
          } else {
            setters.clearInOut()
          }
          break
        case 'mark.addMarker':      refs.addMarkerRef.current(); break
        case 'mark.deleteMarker':   refs.deleteMarkerRef.current(); break
        case 'mark.jumpNextMarker': refs.jumpNextMarkerRef.current(); break
        case 'mark.jumpPrevMarker': refs.jumpPrevMarkerRef.current(); break

        // Audio
        case 'audio.separate':   refs.separateAudioRef.current(); break
        case 'audio.restore':    refs.restoreAudioRef.current(); break
        case 'audio.volumeUp':
        case 'audio.volumeDown':
        case 'audio.toggleMute': {
          const targetIds = sel.size > 0 ? sel : new Set(refs.clipsRef.current.map(c => c.id))
          const delta = action === 'audio.volumeUp' ? 0.1 : action === 'audio.volumeDown' ? -0.1 : 0
          if (action === 'audio.toggleMute') {
            setters.pushUndo()
            setters.setClips(prev => prev.map(c => {
              if (!targetIds.has(c.id) || refs.tracksRef.current[c.trackIndex]?.locked) return c
              return { ...c, muted: !c.muted }
            }))
          } else {
            setters.pushUndo()
            setters.setClips(prev => prev.map(c => {
              if (!targetIds.has(c.id) || refs.tracksRef.current[c.trackIndex]?.locked) return c
              const newVolume = Math.round((Math.max(0, Math.min(1, c.volume + delta))) * 10) / 10
              return { ...c, volume: newVolume, muted: false }
            }))
          }
          break
        }

        // Speed
        case 'clip.speedUp':
        case 'clip.speedDown':
        case 'clip.resetSpeed': {
          const speedIds = sel.size > 0 ? sel : new Set(refs.clipsRef.current.map(c => c.id))
          setters.pushUndo()
          setters.setClips(prev => prev.map(c => {
            if (!speedIds.has(c.id) || refs.tracksRef.current[c.trackIndex]?.locked) return c
            let newSpeed: number
            if (action === 'clip.resetSpeed') {
              newSpeed = 1
            } else {
              const delta = action === 'clip.speedUp' ? 0.25 : -0.25
              newSpeed = Math.round((Math.max(0.25, Math.min(4, c.speed + delta))) * 100) / 100
            }
            const effectiveSourceDuration = c.duration * c.speed
            const newDuration = effectiveSourceDuration / newSpeed
            return { ...c, speed: newSpeed, duration: newDuration }
          }))
          break
        }

        // Subtitle
        case 'subtitle.add':
          refs.addSubtitleRef.current()
          break
        case 'subtitle.split':
          refs.splitSubtitleRef.current()
          break
        case 'subtitle.lineBreak':
          refs.lineBreakSubtitleRef.current()
          break

        // Track
        case 'track.toggleMute': {
          const selTrackIndices = new Set<number>()
          for (const id of sel) {
            const clip = refs.clipsRef.current.find(c => c.id === id)
            if (clip) selTrackIndices.add(clip.trackIndex)
          }
          if (selTrackIndices.size === 0) break
          setters.pushUndo()
          setters.setTracks(prev => prev.map((t, i) =>
            selTrackIndices.has(i) ? { ...t, muted: !t.muted } : t
          ))
          break
        }
        case 'track.toggleLock': {
          const selLockIndices = new Set<number>()
          for (const id of sel) {
            const clip = refs.clipsRef.current.find(c => c.id === id)
            if (clip) selLockIndices.add(clip.trackIndex)
          }
          if (selLockIndices.size === 0) break
          setters.pushUndo()
          setters.setTracks(prev => prev.map((t, i) =>
            selLockIndices.has(i) ? { ...t, locked: !t.locked } : t
          ))
          break
        }

        // Timeline
        case 'timeline.zoomIn':
          refs.centerOnPlayheadRef.current = true
          setters.setZoom(prev => Math.min(4, +(prev + 0.25).toFixed(2)))
          break
        case 'timeline.zoomOut':
          refs.centerOnPlayheadRef.current = true
          setters.setZoom(prev => Math.max(refs.getMinZoomRef.current(), +(prev - 0.25).toFixed(2)))
          break
        case 'timeline.fitToView':
          refs.fitToViewRef.current()
          break
        case 'timeline.toggleSnap':
          setters.setSnapEnabled(prev => !prev)
          break
        case 'nav.prevEdit': {
          const editPts = new Set<number>()
          editPts.add(0)
          for (const cl of refs.clipsRef.current) {
            editPts.add(Math.round(cl.startTime * 1000) / 1000)
            editPts.add(Math.round((cl.startTime + cl.duration) * 1000) / 1000)
          }
          const sortedPrev = Array.from(editPts).sort((a, b) => a - b)
          const ct = Math.round(refs.playbackTimeRef.current * 1000) / 1000
          let prev = sortedPrev[0]
          for (const ep of sortedPrev) {
            if (ep < ct - 0.01) prev = ep
            else break
          }
          refs.isPlayingRef.current = false; setters.setIsPlaying(false)
          setters.setCurrentTime(prev)
          break
        }
        case 'nav.nextEdit': {
          const editPts2 = new Set<number>()
          for (const cl of refs.clipsRef.current) {
            editPts2.add(Math.round(cl.startTime * 1000) / 1000)
            editPts2.add(Math.round((cl.startTime + cl.duration) * 1000) / 1000)
          }
          const sortedNext = Array.from(editPts2).sort((a, b) => a - b)
          const ct2 = Math.round(refs.playbackTimeRef.current * 1000) / 1000
          let next = sortedNext[sortedNext.length - 1]
          for (const ep of sortedNext) {
            if (ep > ct2 + 0.01) { next = ep; break }
          }
          refs.isPlayingRef.current = false; setters.setIsPlaying(false)
          setters.setCurrentTime(next)
          break
        }
        case 'view.fullscreen':
          refs.toggleFullscreenRef.current()
          break
        case 'project.save':   refs.saveRef.current(); break
        case 'project.export': refs.exportRef.current(); break

        default: {
          // Exhaustiveness check — compile error if a new ActionId is not handled
          const _exhaustive: never = action
          void _exhaustive
          break
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k') {
        kHeldRef.current = false
      }
    }

    // Use capture phase so shortcuts work even when child components
    // call stopPropagation() on keyboard events.
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
    }
  }, []) // stable - uses refs for latest state
}
