import { useEffect, useRef } from 'react'

interface Blob {
  x: number; y: number; r: number
  vx: number; vy: number; hue: number; alpha: number
}

const BLOBS = 14

export function InkCloud() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const blobsRef = useRef<Blob[]>([])
  const dimsRef = useRef({ w: 0, h: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const p = canvas.parentElement
      if (!p) return
      const { width, height } = p.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dimsRef.current = { w: width, h: height }

      const bs: Blob[] = []
      for (let i = 0; i < BLOBS; i++) {
        bs.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: width * (0.18 + Math.random() * 0.45),
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          hue: 200 + Math.random() * 30,
          alpha: 0.04 + Math.random() * 0.06,
        })
      }
      blobsRef.current = bs
    }

    resize()
    window.addEventListener('resize', resize)
    const obs = new ResizeObserver(resize)
    const p = canvas.parentElement
    if (p) obs.observe(p)

    const animate = () => {
      const { w, h } = dimsRef.current
      if (!w) { rafRef.current = requestAnimationFrame(animate); return }

      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'

      for (const b of blobsRef.current) {
        // Random perturbation
        b.vx += (Math.random() - 0.5) * 0.5
        b.vy += (Math.random() - 0.5) * 0.5
        // Gentle center pull
        b.vx += (w * 0.5 - b.x) * 0.00005
        b.vy += (h * 0.5 - b.y) * 0.00005
        // Damping
        b.vx *= 0.97
        b.vy *= 0.97
        // Wrap around
        if (b.x < -b.r) b.x = w + b.r
        if (b.x > w + b.r) b.x = -b.r
        if (b.y < -b.r) b.y = h + b.r
        if (b.y > h + b.r) b.y = -b.r
        // Move
        b.x += b.vx
        b.y += b.vy

        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r)
        g.addColorStop(0, `hsla(${b.hue}, 50%, 75%, ${b.alpha * 2.5})`)
        g.addColorStop(0.3, `hsla(${b.hue}, 40%, 60%, ${b.alpha * 1.2})`)
        g.addColorStop(0.6, `hsla(${b.hue}, 30%, 45%, ${b.alpha * 0.4})`)
        g.addColorStop(1, 'transparent')
        ctx.beginPath()
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.fillStyle = g
        ctx.fill()
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafRef.current)
      obs.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
  )
}
