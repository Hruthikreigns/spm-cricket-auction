import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  colour: string
  size: number
}

const COLOURS = ['#ffb020', '#ffd47a', '#e3cfa0', '#d4453a', '#fff3d6', '#9ad5ff']

// Shells: [x fraction, y fraction, delay ms, scale]. Spread across the first
// 1.6s; the falling tails carry the display to about three seconds, matching
// the length of the audio.
const SHELLS: [number, number, number, number][] = [
  [0.24, 0.3, 0, 1.05],
  [0.72, 0.24, 240, 0.95],
  [0.5, 0.4, 520, 1.2],
  [0.36, 0.2, 830, 0.9],
  [0.64, 0.44, 1080, 1.0],
  [0.48, 0.26, 1380, 1.1],
  [0.18, 0.44, 1600, 0.85],
]

/**
 * Fire flowers for the hammer moment.
 *
 * Each shell opens as a petalled ring rather than a random puff: petals radiate
 * evenly, each with a bright tip and a shorter inner spark, so the burst reads
 * as a bloom. Full-screen, click-through, and it stops painting once the last
 * spark dies.
 *
 * Pass a new `trigger` value to set it off — the sale id works well.
 */
export function Fireworks({ trigger }: { trigger: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number>()

  useEffect(() => {
    if (trigger === null) return
    const canvas = canvasRef.current
    if (!canvas) return

    // Anyone who has asked for less motion gets the sound and banner, not this.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const particles: Particle[] = []

    const bloom = (bx: number, by: number, scale: number) => {
      const petals = 14 + Math.floor(Math.random() * 6)
      const perPetal = 7
      const colour = COLOURS[Math.floor(Math.random() * COLOURS.length)]
      const tip = Math.random() > 0.5 ? COLOURS[0] : '#fff3d6'

      for (let p = 0; p < petals; p += 1) {
        const base = (Math.PI * 2 * p) / petals + Math.random() * 0.12
        for (let k = 0; k < perPetal; k += 1) {
          const spread = (k / perPetal - 0.5) * 0.22 // width of the petal
          const angle = base + spread
          const reach = (2.6 + (k / perPetal) * 3.4) * scale // longer toward the tip
          particles.push({
            x: bx,
            y: by,
            vx: Math.cos(angle) * reach,
            vy: Math.sin(angle) * reach,
            life: 0,
            max: 78 + Math.random() * 46,
            colour: k > perPetal - 3 ? tip : colour,
            size: k > perPetal - 3 ? 2.4 : 1.4 + Math.random() * 1.1,
          })
        }
      }

      // Stray sparks, so the ring isn't mechanically perfect.
      for (let i = 0; i < 26; i += 1) {
        const angle = Math.random() * Math.PI * 2
        const speed = (1 + Math.random() * 5.4) * scale
        particles.push({
          x: bx,
          y: by,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          max: 60 + Math.random() * 60,
          colour,
          size: 1 + Math.random() * 1.6,
        })
      }
    }

    const timers = SHELLS.map(([px, py, at, scale]) =>
      window.setTimeout(() => bloom(width * px, height * py, scale), at),
    )

    const startedAt = Date.now()

    const draw = () => {
      // Fade rather than clear, so each spark leaves a trail.
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,0.14)'
      ctx.fillRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'lighter'

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]
        p.life += 1
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.062 // gravity
        p.vx *= 0.978 // drag
        p.vy *= 0.978

        const fade = 1 - p.life / p.max
        if (fade <= 0) {
          particles.splice(i, 1)
          continue
        }
        ctx.globalAlpha = fade * fade // ease out rather than linear
        ctx.fillStyle = p.colour
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * (0.4 + fade * 0.6), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      if (particles.length > 0 || Date.now() - startedAt < 1800) {
        frameRef.current = requestAnimationFrame(draw)
      } else {
        ctx.clearRect(0, 0, width, height)
      }
    }

    frameRef.current = requestAnimationFrame(draw)

    return () => {
      timers.forEach(window.clearTimeout)
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      ctx.clearRect(0, 0, width, height)
    }
  }, [trigger])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50"
      style={{ width: '100%', height: '100%' }}
    />
  )
}
