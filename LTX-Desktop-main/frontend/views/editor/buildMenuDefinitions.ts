import { type MenuDefinition } from '../../components/MenuBar'
import type { TimelineClip } from '../../types/project'
import { TEXT_PRESETS } from '../../types/project'
import { getShortcutLabel, type ToolType } from './video-editor-utils'
import type { KeyboardLayout } from '../../lib/keyboard-shortcuts'

export interface MenuDepsParams {
  selectedClip: TimelineClip | null | undefined
  selectedClipIds: Set<string>
  clips: TimelineClip[]
  tracks: any[]
  subtitles: any[]
  snapEnabled: boolean
  showEffectsBrowser: boolean
  showSourceMonitor: boolean
  showPropertiesPanel: boolean
  canUseIcLora: boolean
  t: (key: string) => string
  sourceAsset: any
  activeTool: ToolType
  activeTimeline: any
  timelines: any[]
  kbLayout: KeyboardLayout
  fileInputRef: React.RefObject<HTMLInputElement>
  subtitleFileInputRef: React.RefObject<HTMLInputElement>
  setShowImportTimelineModal: (v: boolean) => void
  setShowExportModal: (v: boolean) => void
  handleExportTimelineXml: () => void
  handleExportSrt: () => void
  undoRef: React.RefObject<() => void>
  redoRef: React.RefObject<() => void>
  cutRef: React.RefObject<() => void>
  copyRef: React.RefObject<() => void>
  pasteRef: React.RefObject<() => void>
  setSelectedClipIds: (v: Set<string>) => void
  handleInsertEdit: () => void
  handleOverwriteEdit: () => void
  matchFrameRef: React.RefObject<() => void>
  setKbEditorOpen: (v: boolean) => void
  splitClipAtPlayhead: (id: string, atTime?: number, batchClipIds?: string[]) => void
  duplicateClip: (id: string) => void
  pushUndo: () => void
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>
  updateClip: (id: string, patch: Partial<TimelineClip>) => void
  setTracks: React.Dispatch<React.SetStateAction<any[]>>
  addTextClip: (style?: any) => void
  addSubtitleTrack: () => void
  createAdjustmentLayerAsset: () => void
  setSnapEnabled: (v: boolean) => void
  fitToViewRef: React.RefObject<() => void>
  setZoom: React.Dispatch<React.SetStateAction<number>>
  setShowSourceMonitor: (v: boolean) => void
  setShowEffectsBrowser: (v: boolean) => void
  setShowPropertiesPanel: (v: boolean) => void
  onICLoraClip: (clip: TimelineClip) => void
  setActiveTool: (v: ToolType) => void
  setLastTrimTool: (v: ToolType) => void
  handleAddTimeline: () => void
  handleDuplicateTimeline: (id: string) => void
  handleResetLayout: () => void
}

export function buildMenuDefinitions(p: MenuDepsParams): MenuDefinition[] {
  return [
    // ── File ──
    // Import/export, timeline management, project settings
    {
      id: 'file',
      label: p.t('menu.file'),
      items: [
        { id: 'new-timeline', label: p.t('menu.file.newTimeline'), action: () => p.handleAddTimeline() },
        { id: 'duplicate-timeline', label: p.t('menu.file.duplicateTimeline'), action: () => { if (p.activeTimeline) p.handleDuplicateTimeline(p.activeTimeline.id) }, disabled: !p.activeTimeline },
        { id: 'sep-0', label: '', separator: true },
        { id: 'import-media', label: p.t('menu.file.importMedia'), shortcut: 'Ctrl+I', action: () => p.fileInputRef.current?.click() },
        { id: 'import-timeline', label: p.t('menu.file.importTimeline'), action: () => p.setShowImportTimelineModal(true) },
        { id: 'import-srt', label: p.t('menu.file.importSubtitles'), action: () => p.subtitleFileInputRef.current?.click() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'export-timeline', label: p.t('menu.file.exportTimeline'), shortcut: 'Ctrl+E', action: () => p.setShowExportModal(true) },
        { id: 'export-xml', label: p.t('menu.file.exportXml'), action: () => p.handleExportTimelineXml() },
        { id: 'export-srt', label: p.t('menu.file.exportSrt'), action: () => p.handleExportSrt(), disabled: p.subtitles.length === 0 },
      ],
    },

    // ── Edit ──
    // Undo/redo, clipboard, selection, source monitor edits
    {
      id: 'edit',
      label: p.t('menu.edit'),
      items: [
        { id: 'undo', label: p.t('menu.edit.undo'), shortcut: getShortcutLabel(p.kbLayout, 'edit.undo'), action: () => p.undoRef.current!() },
        { id: 'redo', label: p.t('menu.edit.redo'), shortcut: getShortcutLabel(p.kbLayout, 'edit.redo'), action: () => p.redoRef.current!() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'cut', label: p.t('menu.edit.cut'), shortcut: getShortcutLabel(p.kbLayout, 'edit.cut'), action: () => p.cutRef.current!() },
        { id: 'copy', label: p.t('menu.edit.copy'), shortcut: getShortcutLabel(p.kbLayout, 'edit.copy'), action: () => p.copyRef.current!() },
        { id: 'paste', label: p.t('menu.edit.paste'), shortcut: getShortcutLabel(p.kbLayout, 'edit.paste'), action: () => p.pasteRef.current!() },
        { id: 'sep-2', label: '', separator: true },
        { id: 'select-all', label: p.t('menu.edit.selectAll'), shortcut: getShortcutLabel(p.kbLayout, 'edit.selectAll'), action: () => p.setSelectedClipIds(new Set(p.clips.map(c => c.id))) },
        { id: 'deselect-all', label: p.t('menu.edit.deselectAll'), shortcut: getShortcutLabel(p.kbLayout, 'edit.deselect'), action: () => p.setSelectedClipIds(new Set()) },
        { id: 'sep-3', label: '', separator: true },
        { id: 'insert-edit', label: p.t('menu.edit.insertEdit'), shortcut: getShortcutLabel(p.kbLayout, 'edit.insertEdit'), action: () => p.handleInsertEdit(), disabled: !p.sourceAsset },
        { id: 'overwrite-edit', label: p.t('menu.edit.overwriteEdit'), shortcut: getShortcutLabel(p.kbLayout, 'edit.overwriteEdit'), action: () => p.handleOverwriteEdit(), disabled: !p.sourceAsset },
        { id: 'match-frame', label: p.t('menu.edit.matchFrame'), shortcut: getShortcutLabel(p.kbLayout, 'edit.matchFrame'), action: () => p.matchFrameRef.current!() },
        { id: 'sep-4', label: '', separator: true },
        { id: 'keyboard-shortcuts', label: p.t('menu.edit.keyboardShortcuts'), action: () => p.setKbEditorOpen(true) },
      ],
    },

    // ── Clip ──
    // Operations on selected clip(s): split, duplicate, delete, transform, audio, speed
    {
      id: 'clip',
      label: p.t('menu.clip'),
      items: [
        { id: 'split', label: p.t('menu.clip.split'), shortcut: getShortcutLabel(p.kbLayout, 'tool.blade'), action: () => { if (p.selectedClip) p.splitClipAtPlayhead(p.selectedClip.id) }, disabled: !p.selectedClip },
        { id: 'duplicate', label: p.t('menu.clip.duplicate'), action: () => { if (p.selectedClip) p.duplicateClip(p.selectedClip.id) }, disabled: !p.selectedClip },
        { id: 'delete', label: p.t('menu.clip.delete'), shortcut: getShortcutLabel(p.kbLayout, 'edit.delete'), action: () => { if (p.selectedClipIds.size > 0) { p.pushUndo(); p.setClips(prev => prev.filter(c => !p.selectedClipIds.has(c.id))); p.setSelectedClipIds(new Set()) } }, disabled: p.selectedClipIds.size === 0 },
        { id: 'sep-1', label: '', separator: true },
        { id: 'flip-h', label: p.t('menu.clip.flipH'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { flipH: !p.selectedClip.flipH }) }, disabled: !p.selectedClip },
        { id: 'flip-v', label: p.t('menu.clip.flipV'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { flipV: !p.selectedClip.flipV }) }, disabled: !p.selectedClip },
        { id: 'reverse', label: p.t('menu.clip.reverse'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { reversed: !p.selectedClip.reversed }) }, disabled: !p.selectedClip },
        { id: 'sep-2', label: '', separator: true },
        { id: 'mute', label: p.selectedClip?.muted ? p.t('menu.clip.unmute') : p.t('menu.clip.mute'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { muted: !p.selectedClip.muted }) }, disabled: !p.selectedClip },
        { id: 'link-audio', label: p.selectedClip?.linkedClipIds?.length ? p.t('menu.clip.unlinkAudio') : p.t('menu.clip.linkAudio'), action: () => {
          if (!p.selectedClip) return
          p.pushUndo()
          if (p.selectedClip.linkedClipIds?.length) {
            const linkedIds = p.selectedClip.linkedClipIds
            p.setClips(prev => prev.map(c => {
              if (c.id === p.selectedClip!.id) return { ...c, linkedClipIds: undefined }
              if (linkedIds.includes(c.id)) return { ...c, linkedClipIds: c.linkedClipIds?.filter(lid => lid !== p.selectedClip!.id) }
              return c
            }))
          }
        }, disabled: !p.selectedClip },
        { id: 'sep-3', label: '', separator: true },
        { id: 'speed-025', label: p.t('menu.clip.speed025'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 0.25 }) }, disabled: !p.selectedClip },
        { id: 'speed-050', label: p.t('menu.clip.speed050'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 0.5 }) }, disabled: !p.selectedClip },
        { id: 'speed-100', label: p.t('menu.clip.speed100'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 1 }) }, disabled: !p.selectedClip },
        { id: 'speed-150', label: p.t('menu.clip.speed150'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 1.5 }) }, disabled: !p.selectedClip },
        { id: 'speed-200', label: p.t('menu.clip.speed200'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 2 }) }, disabled: !p.selectedClip },
        { id: 'speed-400', label: p.t('menu.clip.speed400'), action: () => { if (p.selectedClip) p.updateClip(p.selectedClip.id, { speed: 4 }) }, disabled: !p.selectedClip },
      ],
    },

    // ── Sequence ──
    // Timeline-level: add tracks, add layers, add text/captions, snapping
    {
      id: 'sequence',
      label: p.t('menu.sequence'),
      items: [
        { id: 'add-video-track', label: p.t('menu.sequence.addVideoTrack'), action: () => { p.pushUndo(); p.setTracks(prev => { const vTracks = prev.filter((t: any) => t.kind === 'video'); const name = `V${vTracks.length + 1}`; return [...prev, { id: `track-${Date.now()}`, name, muted: false, locked: false, kind: 'video' as const }] }) } },
        { id: 'add-audio-track', label: p.t('menu.sequence.addAudioTrack'), action: () => { p.pushUndo(); p.setTracks(prev => { const aTracks = prev.filter((t: any) => t.kind === 'audio'); const name = `A${aTracks.length + 1}`; return [...prev, { id: `track-${Date.now()}`, name, muted: false, locked: false, kind: 'audio' as const }] }) } },
        { id: 'add-subtitle-track', label: p.t('menu.sequence.addSubtitleTrack'), action: () => p.addSubtitleTrack() },
        { id: 'sep-1', label: '', separator: true },
        { id: 'add-adjustment', label: p.t('menu.sequence.addAdjustment'), action: () => p.createAdjustmentLayerAsset() },
        { id: 'sep-2', label: '', separator: true },
        { id: 'add-text', label: p.t('menu.sequence.addText'), action: () => p.addTextClip() },
        { id: 'add-text-lower', label: p.t('menu.sequence.addLowerThird'), action: () => p.addTextClip(TEXT_PRESETS.find((pr: any) => pr.id === 'lower-third-basic')?.style) },
        { id: 'add-text-subtitle', label: p.t('menu.sequence.addCaption'), action: () => p.addTextClip(TEXT_PRESETS.find((pr: any) => pr.id === 'subtitle-style')?.style) },
        { id: 'sep-3', label: '', separator: true },
        { id: 'snap-toggle', label: p.snapEnabled ? p.t('menu.sequence.disableSnap') : p.t('menu.sequence.enableSnap'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.toggleSnap'), action: () => p.setSnapEnabled(!p.snapEnabled) },
      ],
    },

    // ── Tools ──
    // Timeline editing tools (selection, trim, blade, etc.)
    {
      id: 'tools',
      label: p.t('menu.tools'),
      items: [
        { id: 'tool-select', label: p.t('menu.tools.select'), shortcut: getShortcutLabel(p.kbLayout, 'tool.select'), action: () => p.setActiveTool('select') },
        { id: 'tool-blade', label: p.t('menu.tools.blade'), shortcut: getShortcutLabel(p.kbLayout, 'tool.blade'), action: () => p.setActiveTool('blade') },
        { id: 'sep-1', label: '', separator: true },
        { id: 'tool-ripple', label: p.t('menu.tools.ripple'), shortcut: getShortcutLabel(p.kbLayout, 'tool.ripple'), action: () => { p.setActiveTool('ripple'); p.setLastTrimTool('ripple') } },
        { id: 'tool-roll', label: p.t('menu.tools.roll'), shortcut: getShortcutLabel(p.kbLayout, 'tool.roll'), action: () => { p.setActiveTool('roll'); p.setLastTrimTool('roll') } },
        { id: 'tool-slip', label: p.t('menu.tools.slip'), shortcut: getShortcutLabel(p.kbLayout, 'tool.slip'), action: () => { p.setActiveTool('slip'); p.setLastTrimTool('slip') } },
        { id: 'tool-slide', label: p.t('menu.tools.slide'), shortcut: getShortcutLabel(p.kbLayout, 'tool.slide'), action: () => { p.setActiveTool('slide'); p.setLastTrimTool('slide') } },
        { id: 'sep-2', label: '', separator: true },
        ...(p.canUseIcLora ? [{
          id: 'ic-lora',
          label: p.t('menu.tools.icLora'),
          action: () => {
            if (p.selectedClip?.type === 'video') {
              p.onICLoraClip(p.selectedClip)
            }
          },
          disabled: p.selectedClip?.type !== 'video',
        }] : []),
      ],
    },

    // ── View ──
    // Panel visibility, timeline zoom, layout
    {
      id: 'view',
      label: p.t('menu.view'),
      items: [
        { id: 'clip-viewer', label: p.showSourceMonitor ? p.t('menu.view.hideClipViewer') : p.t('menu.view.showClipViewer'), action: () => p.setShowSourceMonitor(!p.showSourceMonitor) },
        // EFFECTS HIDDEN - effects-browser menu item hidden because effects are not applied during export
        // { id: 'effects-browser', label: p.showEffectsBrowser ? 'Hide Effects Browser' : 'Show Effects Browser', action: () => p.setShowEffectsBrowser(!p.showEffectsBrowser) },
        { id: 'properties-panel', label: p.showPropertiesPanel ? p.t('menu.view.hideProperties') : p.t('menu.view.showProperties'), action: () => p.setShowPropertiesPanel(!p.showPropertiesPanel) },
        { id: 'sep-1', label: '', separator: true },
        { id: 'fit-to-view', label: p.t('menu.view.zoomFit'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.fitToView'), action: () => p.fitToViewRef.current!() },
        { id: 'zoom-in', label: p.t('menu.view.zoomIn'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.zoomIn'), action: () => p.setZoom(z => Math.min(z * 1.25, 10)) },
        { id: 'zoom-out', label: p.t('menu.view.zoomOut'), shortcut: getShortcutLabel(p.kbLayout, 'timeline.zoomOut'), action: () => p.setZoom(z => Math.max(z / 1.25, 0.1)) },
        { id: 'sep-2', label: '', separator: true },
        { id: 'reset-layout', label: p.t('menu.view.resetLayout'), action: () => p.handleResetLayout() },
      ],
    },

    // ── Help ──
    {
      id: 'help',
      label: p.t('menu.help'),
      items: [
        { id: 'shortcuts', label: p.t('menu.help.shortcuts'), action: () => p.setKbEditorOpen(true) },
        { id: 'about', label: p.t('menu.help.about'), action: () => window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'about' } })) },
      ],
    },
  ]
}
