import {
  m,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type Variants,
} from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Motion tokens — one place for every duration and curve in the interface,
 * so the site moves with a single rhythm.
 */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const
export const DUR = { fast: 0.18, base: 0.42, slow: 0.8 } as const

const rise: Variants = {
  hidden: { opacity: 0, y: 22 },
  shown: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE_OUT } },
}

/** Fades a block up into place the first time it scrolls into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  as = 'div',
}: {
  children: ReactNode
  className?: string
  delay?: number
  as?: 'div' | 'section'
}) {
  const Tag = as === 'section' ? m.section : m.div
  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      variants={rise}
      transition={{ delay }}
    >
      {children}
    </Tag>
  )
}

/** A grid whose children arrive one after another. */
export function Stagger({ children, className, gap = 0.07 }: { children: ReactNode; className?: string; gap?: number }) {
  return (
    <m.div
      className={className}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: gap } } }}
    >
      {children}
    </m.div>
  )
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // min-w-0: grid children otherwise grow to fit truncated text.
    <m.div className={`min-w-0 ${className ?? ''}`} variants={rise}>
      {children}
    </m.div>
  )
}

/**
 * The headline, set word by word: each word rises out of its own clip line.
 * Screen readers get the plain string once.
 */
export function SplitHeadline({ text, className, delay = 0.15 }: { text: string; className?: string; delay?: number }) {
  const words = text.split(/\s+/).filter(Boolean)
  return (
    <h1 className={className} aria-label={text}>
      {words.map((word, i) => (
        <span key={`${word}-${i}`} aria-hidden className="inline-block overflow-hidden pb-[0.06em] align-bottom">
          <m.span
            className="inline-block"
            initial={{ y: '105%' }}
            animate={{ y: '0%' }}
            transition={{ duration: 0.9, ease: EASE_OUT, delay: delay + i * 0.08 }}
          >
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </m.span>
        </span>
      ))}
    </h1>
  )
}

/** Counts up to a number when it first appears, then tracks live changes. */
export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduced = useReducedMotion()
  const [seen, setSeen] = useState(false)
  const from = useRef(0)
  // Callers pass inline formatters; keep the latest without restarting the count.
  const fmt = useRef(format)
  fmt.current = format

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !seen) return
    if (reduced) {
      el.textContent = fmt.current(value)
      from.current = value
      return
    }
    // A tiny rAF tween rather than motion's animate(), which would pull the
    // full animation engine into the shared bundle for one number.
    const start = from.current
    const t0 = performance.now()
    const duration = 1200
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - t, 4)
      el.textContent = fmt.current(start + (value - start) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    from.current = value
    return () => cancelAnimationFrame(raf)
  }, [seen, value, reduced])

  // Initial text is the final figure, so no-JS / pre-view still reads right.
  return <span ref={ref}>{format(seen && !reduced ? from.current : value)}</span>
}

/**
 * Depth hover: the card tilts toward the pointer and a soft highlight follows
 * it. Pointer-only — touch and reduced-motion get a flat card.
 */
export function TiltCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduced = useReducedMotion()
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.5)
  const rx = useSpring(useTransform(y, [0, 1], [5, -5]), { stiffness: 220, damping: 20 })
  const ry = useSpring(useTransform(x, [0, 1], [-6, 6]), { stiffness: 220, damping: 20 })
  const glowX = useTransform(x, (v) => `${v * 100}%`)
  const glowY = useTransform(y, (v) => `${v * 100}%`)

  return (
    <m.div
      className={`tilt relative min-w-0 [transform-style:preserve-3d] ${className}`}
      style={reduced ? undefined : { rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        x.set((e.clientX - r.left) / r.width)
        y.set((e.clientY - r.top) / r.height)
      }}
      onPointerLeave={() => {
        x.set(0.5)
        y.set(0.5)
      }}
    >
      {children}
      {!reduced && (
        <m.span
          aria-hidden
          className="tilt-glow pointer-events-none absolute inset-0 rounded-sm"
          style={{ ['--gx' as string]: glowX, ['--gy' as string]: glowY }}
        />
      )}
    </m.div>
  )
}
