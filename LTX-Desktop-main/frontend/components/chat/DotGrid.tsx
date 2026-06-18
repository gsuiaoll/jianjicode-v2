import { useEffect, useRef } from 'react'

const SPACING = 18
const GLOW_RADIUS_RATIO = 0.45

interface Props { mx: number; my: number; active: boolean }

export function DotGrid({ mx, my, active: ma }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const dimsRef = useRef({ w: 0, h: 0 })
  const gridRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 })
  const mouseRef = useRef({ x: -999, y: -999, active: false })
  mouseRef.current = { x: mx, y: my, active: ma }

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
      canvas.width = width * dpr; canvas.height = height * dpr
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cols = Math.ceil(width / SPACING)
      const rows = Math.ceil(height / SPACING)
      dimsRef.current = { w: width, h: height }
      gridRef.current = { cols, rows }
    }
    resize()

    const off = document.createElement('canvas')
    const octx = off.getContext('2d')!
    let bgReady = false
    const renderBg = () => {
      const { w, h } = dimsRef.current
      if (!w) return
      off.width = w; off.height = h
      const bg = octx.createLinearGradient(0, 0, w, h)
      bg.addColorStop(0, '#0e131d'); bg.addColorStop(0.3, '#0c1118')
      bg.addColorStop(0.6, '#0a0e14'); bg.addColorStop(1, '#080b10')
      octx.fillStyle = bg; octx.fillRect(0, 0, w, h)
      const id = octx.getImageData(0, 0, w, h)
      for (let i = 0; i < id.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 6
        id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n
      }
      octx.putImageData(id, 0, 0)
      const vg = octx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.75)
      vg.addColorStop(0, 'transparent'); vg.addColorStop(1, 'rgba(0,0,0,0.25)')
      octx.fillStyle = vg; octx.fillRect(0, 0, w, h)
      bgReady = true
    }
    renderBg()

    const animate = () => {
      const { w, h } = dimsRef.current
      if (!w) { rafRef.current = requestAnimationFrame(animate); return }
      if (bgReady) ctx.drawImage(off, 0, 0)

      const { x: mx2, y: my2, active: ma2 } = mouseRef.current
      const { cols, rows } = gridRef.current
      const glowR = w * GLOW_RADIUS_RATIO

      // Grid lines
      ctx.strokeStyle = 'rgba(100,125,160,0.1)'; ctx.lineWidth = 0.5
      for (let c = 0; c <= cols; c++) { const x = c * SPACING; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
      for (let r = 0; r <= rows; r++) { const y = r * SPACING; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }

      // Dim dense layer: dots at cell centers
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = c * SPACING + SPACING / 2
          const cy = r * SPACING + SPACING / 2
          let glow = 0
          if (ma2) {
            const dx = cx - mx2; const dy = cy - my2
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < glowR) { const t = dist / glowR; glow = (1 - t) * (1 - t) }
          }
          const alpha = 0.05 + glow * 0.15
          ctx.beginPath(); ctx.arc(cx, cy, 0.3 + glow * 0.3, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(100,130,170,${Math.min(0.25, alpha)})`; ctx.fill()
        }
      }

      // Bright sparse layer: intersections only (checkerboard)
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          if ((r + c) % 2 !== 0) continue // checkerboard skip
          const x = c * SPACING; const y = r * SPACING
          let cellGlow = 0
          if (ma2) {
            const cx2 = x + SPACING / 2; const cy2 = y + SPACING / 2
            const dx = cx2 - mx2; const dy = cy2 - my2
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < glowR) { const t = dist / glowR; cellGlow = (1 - t) * (1 - t) }
          }
          if (cellGlow > 0.05 && c < cols && r < rows) {
            // Glowing cell border
            ctx.strokeStyle = `rgba(140,180,230,${cellGlow * 0.35})`
            ctx.lineWidth = 0.6 + cellGlow * 0.8
            ctx.strokeRect(x + 0.5, y + 0.5, SPACING - 1, SPACING - 1)
            // Subtle fill
            ctx.fillStyle = `rgba(120,160,210,${cellGlow * 0.04})`
            ctx.fillRect(x, y, SPACING, SPACING)
          }
          // Dot at intersection (always faint)
          ctx.beginPath(); ctx.arc(x, y, 0.5, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(100,130,170,0.15)'; ctx.fill()
        }
      }
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    window.addEventListener('resize', () => { resize(); renderBg() })
    const obs = new ResizeObserver(() => { resize(); renderBg() })
    const p = canvas.parentElement
    if (p) obs.observe(p)

    return () => { cancelAnimationFrame(rafRef.current); obs.disconnect(); window.removeEventListener('resize', resize) }
  }, [])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }} />
}
