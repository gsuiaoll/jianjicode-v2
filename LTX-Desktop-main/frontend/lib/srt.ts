export interface SrtCue {
  index: number
  start: string
  end: string
  text: string
}

export function parseSrt(content: string): SrtCue[] {
  const cues: SrtCue[] = []
  const blocks = content.trim().split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const index = parseInt(lines[0], 10)
    if (isNaN(index)) continue
    const timingMatch = lines[1].match(/([\d:,]+)\s*-->\s*([\d:,]+)/)
    if (!timingMatch) continue
    cues.push({
      index,
      start: timingMatch[1].trim(),
      end: timingMatch[2].trim(),
      text: lines.slice(2).join('\n').trim(),
    })
  }
  return cues
}

export function exportSrt(cues: SrtCue[]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${cue.start} --> ${cue.end}\n${cue.text}\n`)
    .join('\n')
}
