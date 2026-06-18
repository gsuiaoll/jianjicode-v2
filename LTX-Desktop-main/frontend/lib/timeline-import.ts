export interface ParsedClip {
  mediaRefId: string
  trackType: 'video' | 'audio'
  trackIndex: number
  name?: string
  startTime: number
  duration: number
  sourceIn?: number
  speed?: number
  reversed?: boolean
  muted?: boolean
  volume?: number
  flipH?: boolean
  flipV?: boolean
  opacity?: number
  linkedVideoClipIndex?: number
}

export interface ParsedMediaRef {
  id: string
  name: string
  path: string
  duration: number
  start: number
  end: number
  relinkedPath?: string
  resolvedPath?: string
  found?: boolean
  width?: number
  height?: number
  type: 'video' | 'audio' | 'image'
}

export interface ParsedTimeline {
  name: string
  width: number
  height: number
  fps: number
  mediaRefs: ParsedMediaRef[]
  videoTrackCount: number
  audioTrackCount: number
  clips: ParsedClip[]
}

export function parseTimelineXml(_xml: string): ParsedTimeline {
  return { name: '', width: 1920, height: 1080, fps: 30, mediaRefs: [], videoTrackCount: 1, audioTrackCount: 0, clips: [] }
}

export interface Fcp7ExportTimeline {
  name: string
  fps: number
  width: number
  height: number
  clips: Array<{
    name: string
    filePath: string
    trackIndex: number
    type: 'video' | 'image' | 'audio'
    startTime: number
    duration: number
    trimStart: number
    sourceDuration: number
    width: number
    height: number
  }>
}

export function exportFcp7Xml(_timeline: Fcp7ExportTimeline): string {
  return ''
}
