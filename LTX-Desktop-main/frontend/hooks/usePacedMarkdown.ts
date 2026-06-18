import { useState, useEffect, useRef } from 'react'

const TEXT_RENDER_PACE_MS = 24
const TEXT_RENDER_SNAP = /[\s.,!?;:)\]]/

function step(size: number) {
  if (size <= 12) return 2
  if (size <= 48) return 4
  if (size <= 96) return 8
  return Math.min(24, Math.ceil(size / 8))
}

function next(text: string, start: number) {
  const end = Math.min(text.length, start + step(text.length - start))
  const max = Math.min(text.length, end + 8)
  for (let i = end; i < max; i++) {
    if (TEXT_RENDER_SNAP.test(text[i] ?? '')) return i + 1
  }
  return end
}

/**
 * Adaptively paces text reveal during streaming — word boundaries snap at
 * punctuation/whitespace, chunk size scales with remaining text length.
 * Ported from opencode's `createPacedValue`.
 */
export function usePacedMarkdown(text: string, isStreaming: boolean): string {
  const [shown, setShown] = useState(text)
  const shownRef = useRef(text)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const getValueRef = useRef<() => string>(() => text)
  getValueRef.current = () => text

  useEffect(() => {
    shownRef.current = shown
  }, [shown])

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
    }

    const run = () => {
      timerRef.current = undefined
      const current = getValueRef.current()
      const prev = shownRef.current
      if (!current.startsWith(prev) || current.length <= prev.length) {
        shownRef.current = current
        setShown(current)
        return
      }
      const end = next(current, prev.length)
      const nextShown = current.slice(0, end)
      shownRef.current = nextShown
      setShown(nextShown)
      if (end < current.length) timerRef.current = setTimeout(run, TEXT_RENDER_PACE_MS)
    }

    if (!isStreaming) {
      clear()
      shownRef.current = text
      setShown(text)
      return
    }

    if (!text.startsWith(shownRef.current) || text.length < shownRef.current.length) {
      clear()
      shownRef.current = text
      setShown(text)
      return
    }

    if (text.length === shownRef.current.length || timerRef.current) return
    timerRef.current = setTimeout(run, TEXT_RENDER_PACE_MS)

    return clear
  }, [text, isStreaming])

  return shown
}
