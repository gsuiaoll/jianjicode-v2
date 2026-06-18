import { useEffect, useState, useRef } from 'react'
import './TextShimmer.css'

interface TextShimmerProps {
  text: string
  active?: boolean
  className?: string
  offset?: number
}

export function TextShimmer({ text, active = true, className, offset = 0 }: TextShimmerProps) {
  const [run, setRun] = useState(active)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const swap = 220

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }

    if (active) {
      setRun(true)
      return
    }

    timerRef.current = setTimeout(() => {
      timerRef.current = undefined
      setRun(false)
    }, swap)

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [active])

  return (
    <span
      data-component="text-shimmer"
      data-active={active ? 'true' : 'false'}
      className={className}
      aria-label={text}
      style={{
        '--text-shimmer-swap': `${swap}ms`,
        '--text-shimmer-index': `${offset}`,
      } as React.CSSProperties}
    >
      <span data-slot="text-shimmer-char">
        <span data-slot="text-shimmer-char-base" aria-hidden="true">
          {text}
        </span>
        <span data-slot="text-shimmer-char-shimmer" data-run={run ? 'true' : 'false'} aria-hidden="true">
          {text}
        </span>
      </span>
    </span>
  )
}
