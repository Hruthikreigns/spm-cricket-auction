import { useEffect, useState } from 'react'

/**
 * What the visitor's device can comfortably draw.
 *
 * - 'none'  — no WebGL at all; the hero falls back to the CSS floodlight.
 * - 'low'   — phones, low-core laptops, data-saver: no bloom, fewer motes,
 *             smaller shadow maps, DPR capped at 1.25.
 * - 'high'  — everything on, DPR capped at 2.
 *
 * The 3D scene also watches its own frame rate and steps down at runtime,
 * so this is only the starting point.
 */
export type GfxTier = 'none' | 'low' | 'high'

let cachedWebGL: boolean | null = null

export function hasWebGL(): boolean {
  if (cachedWebGL !== null) return cachedWebGL
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    cachedWebGL = !!gl
    // Free the probe context straight away; browsers cap live contexts.
    ;(gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    cachedWebGL = false
  }
  return cachedWebGL
}

export function detectTier(): GfxTier {
  if (typeof window === 'undefined' || !hasWebGL()) return 'none'
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { saveData?: boolean }
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const cores = nav.hardwareConcurrency ?? 4
  const memory = nav.deviceMemory ?? 8
  if (nav.connection?.saveData) return 'low'
  if (coarse || cores <= 4 || memory <= 4) return 'low'
  return 'high'
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** True while the element is on screen, so off-screen 3D stops drawing. */
export function useInView<T extends Element>(ref: React.RefObject<T>, margin = '0px'): boolean {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin: margin,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin])
  return inView
}

/** Tab hidden → stop the render loop entirely. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  )
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/** The active palette's CSS variables, re-read whenever the theme changes. */
export interface Palette {
  pitch: string
  panel: string
  raised: string
  line: string
  ink: string
  muted: string
  amber: string
  cherry: string
  willow: string
  dark: boolean
  /** The neon theme: turns on the extra effects in the 3D scenes. */
  ultra: boolean
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const theme = document.documentElement.dataset.theme ?? 'night'
  return {
    pitch: v('--pitch', '#0a1410'),
    panel: v('--panel', '#10231c'),
    raised: v('--raised', '#163026'),
    line: v('--line', '#1e3a30'),
    ink: v('--ink', '#f4f6f1'),
    muted: v('--muted', '#8fa69b'),
    amber: v('--amber', '#ffb020'),
    cherry: v('--cherry', '#e86b60'),
    willow: v('--willow', '#e3cfa0'),
    dark: theme === 'night' || theme === 'ultra',
    ultra: theme === 'ultra',
  }
}

export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(() => readPalette())
  useEffect(() => {
    const mo = new MutationObserver(() => setPalette(readPalette()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return palette
}
