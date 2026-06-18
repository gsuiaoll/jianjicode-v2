import { useState, useRef } from 'react'
import type { SubtitleClip, Track, TimelineClip } from '../../types/project'
import { parseSrt, exportSrt } from '../../lib/srt'

export interface UseSubtitleOperationsParams {
  subtitles: SubtitleClip[]
  setSubtitles: React.Dispatch<React.SetStateAction<SubtitleClip[]>>
  tracks: Track[]
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  currentTime: number
  setSelectedClipIds: React.Dispatch<React.SetStateAction<Set<string>>>
  activeTimelineName: string | undefined
}

export function useSubtitleOperations({
  subtitles,
  setSubtitles,
  tracks,
  setTracks,
  setClips,
  currentTime,
  setSelectedClipIds,
  activeTimelineName,
}: UseSubtitleOperationsParams) {
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string | null>(null)
  const [editingSubtitleId, setEditingSubtitleId] = useState<string | null>(null)
  const [subtitleTrackStyleIdx, setSubtitleTrackStyleIdx] = useState<number | null>(null)
  const subtitleFileInputRef = useRef<HTMLInputElement>(null)

  const addSubtitleTrack = () => {
    const subCount = tracks.filter(t => t.type === 'subtitle').length
    const newTrack: Track = {
      id: `track-sub-${Date.now()}`,
      name: subCount > 0 ? `Subtitles ${subCount + 1}` : 'Subtitles',
      muted: false,
      locked: false,
      type: 'subtitle',
    }
    setClips(prev => prev.map(c => ({ ...c, trackIndex: c.trackIndex + 1 })))
    setSubtitles(prev => prev.map(s => ({ ...s, trackIndex: s.trackIndex + 1 })))
    setTracks([newTrack, ...tracks])
  }

  const addSubtitleClip = (trackIndex: number) => {
    const sub: SubtitleClip = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      text: 'New subtitle',
      startTime: currentTime,
      endTime: currentTime + 3,
      trackIndex,
    }
    setSubtitles(prev => [...prev, sub])
    setSelectedSubtitleId(sub.id)
    setEditingSubtitleId(sub.id)
    setSelectedClipIds(new Set())
  }

  const updateSubtitle = (id: string, updates: Partial<SubtitleClip>) => {
    setSubtitles(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  const splitSubtitle = () => {
    // Find subtitle at playhead, or use selected subtitle
    let target = subtitles.find(s => s.id === selectedSubtitleId)
    if (!target) {
      target = subtitles.find(s => currentTime >= s.startTime && currentTime <= s.endTime)
    }
    if (!target) return
    const midTime = currentTime
    if (midTime <= target.startTime + 0.1 || midTime >= target.endTime - 0.1) return

    const firstHalf: SubtitleClip = {
      ...target,
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      endTime: midTime,
    }
    const secondHalf: SubtitleClip = {
      ...target,
      startTime: midTime,
    }
    setSubtitles(prev => [...prev.filter(s => s.id !== target!.id), firstHalf, secondHalf])
    setSelectedSubtitleId(firstHalf.id)
    setEditingSubtitleId(firstHalf.id)
  }

  const addLineBreakToSubtitle = () => {
    const target = subtitles.find(s => s.id === editingSubtitleId) || subtitles.find(s => s.id === selectedSubtitleId)
    if (!target) return
    updateSubtitle(target.id, { text: target.text + '\n' })
  }

  const deleteSubtitle = (id: string) => {
    setSubtitles(prev => prev.filter(s => s.id !== id))
    if (selectedSubtitleId === id) setSelectedSubtitleId(null)
    if (editingSubtitleId === id) setEditingSubtitleId(null)
  }

  const handleImportSrt = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    let subtitleTrackIdx = tracks.findIndex(t => t.type === 'subtitle')
    if (subtitleTrackIdx === -1) {
      addSubtitleTrack()
      subtitleTrackIdx = 0
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      const content = ev.target?.result as string
      if (!content) return
      const cues = parseSrt(content)
      const newSubs: SubtitleClip[] = cues.map(cue => ({
        id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${cue.index}`,
        text: cue.text,
        startTime: cue.startTime,
        endTime: cue.endTime,
        trackIndex: subtitleTrackIdx,
        ...(cue.color ? { style: { color: cue.color } } : {}),
      }))
      setSubtitles(prev => [...prev.filter(s => s.trackIndex !== subtitleTrackIdx), ...newSubs])
    }
    reader.readAsText(file)

    if (subtitleFileInputRef.current) subtitleFileInputRef.current.value = ''
  }

  const handleExportSrt = () => {
    const cues = subtitles
      .filter(s => s.text.trim())
      .sort((a, b) => a.startTime - b.startTime)

    if (cues.length === 0) {
      alert('No subtitles to export')
      return
    }

    const srtContent = exportSrt(cues)

    if (window.electronAPI?.showSaveDialog) {
      window.electronAPI.showSaveDialog({
        title: 'Export Subtitles',
        defaultPath: `subtitles_${activeTimelineName || 'timeline'}.srt`,
        filters: [{ name: 'SRT Files', extensions: ['srt'] }]
      }).then(filePath => {
        if (filePath) {
          window.electronAPI!.saveFile(filePath, srtContent)
        }
      })
    } else {
      const blob = new Blob([srtContent], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `subtitles_${activeTimelineName || 'timeline'}.srt`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  return {
    selectedSubtitleId,
    setSelectedSubtitleId,
    editingSubtitleId,
    setEditingSubtitleId,
    subtitleTrackStyleIdx,
    setSubtitleTrackStyleIdx,
    subtitleFileInputRef,
    addSubtitleTrack,
    addSubtitleClip,
    updateSubtitle,
    splitSubtitle,
    addLineBreakToSubtitle,
    deleteSubtitle,
    handleImportSrt,
    handleExportSrt,
  }
}
