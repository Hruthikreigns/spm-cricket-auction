import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'

import {
  detectTier,
  useInView,
  usePageVisible,
  usePalette,
  useReducedMotion,
  type GfxTier,
} from '../lib/device'
import { loadGsap } from '../lib/gsap'

// The 3D bundle (three + r3f + drei + postprocessing) only downloads when a
// hero is actually going to draw it.
const StadiumScene = lazy(() => import('./three/StadiumScene'))

/** If anything in the scene throws, drop back to the CSS stage quietly. */
class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[hero] 3D scene unavailable, using the static stage', error)
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** The no-WebGL stage: the original floodlight wash plus a lit ball. */
function StaticStage() {
  return (
    <div aria-hidden className="floodlight crease absolute inset-0 overflow-hidden">
      <div className="hero-ball absolute right-[8%] top-1/2 hidden h-56 w-56 -translate-y-1/2 md:block lg:h-72 lg:w-72" />
    </div>
  )
}

/**
 * Full-bleed hero with the stadium scene behind its content.
 *
 * - Scroll: GSAP ScrollTrigger scrubs a 0→1 value the camera reads each frame,
 *   and lifts/fades the copy as the hero leaves.
 * - Off-screen or tab hidden: the render loop stops.
 * - No WebGL, a crash, or a lost context: the CSS stage takes over.
 */
export function HeroStage({ children }: { children: ReactNode }) {
  const section = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const progress = useRef(0)
  const reducedMotion = useReducedMotion()
  const palette = usePalette()
  const inView = useInView(section, '120px')
  const visible = usePageVisible()
  const [tier, setTier] = useState<GfxTier>(() => detectTier())
  const [ready, setReady] = useState(false)

  // Mount the canvas after first paint so the headline is never blocked on it.
  useEffect(() => {
    if (tier === 'none') return
    const idle =
      (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 120))
    idle(() => setReady(true))
  }, [tier])

  useEffect(() => {
    const el = section.current
    if (!el) return
    let cleanup = () => {}
    let cancelled = false
    loadGsap().then((gsap) => {
      if (cancelled) return
      const mm = gsap.matchMedia()
      const ctx = gsap.context(() => {
        gsap.to({}, {
          scrollTrigger: {
            trigger: el,
            start: 'top top',
            end: 'bottom top',
            onUpdate: (self) => {
              progress.current = self.progress
            },
          },
        })
        mm.add('(prefers-reduced-motion: no-preference)', () => {
          if (!content.current) return
          gsap.to(content.current, {
            yPercent: -18,
            opacity: 0.15,
            ease: 'none',
            scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: 0.6 },
          })
        })
      }, el)
      cleanup = () => {
        mm.revert()
        ctx.revert()
      }
    })
    return () => {
      cancelled = true
      cleanup()
    }
  }, [])

  const fail = () => setTier('none')

  return (
    <section
      ref={section}
      className="hero-stage relative isolate flex min-h-[calc(100svh-3.75rem)] items-end overflow-hidden border-b border-line md:items-center"
    >
      <div className="absolute inset-0 -z-10">
        {tier === 'none' || !ready ? (
          <StaticStage />
        ) : (
          <SceneBoundary onError={fail}>
            <Suspense fallback={<StaticStage />}>
              <StadiumScene
                palette={palette}
                tier={tier}
                reducedMotion={reducedMotion}
                active={inView && visible}
                progress={progress}
                eventSource={section}
                onFail={fail}
              />
            </Suspense>
          </SceneBoundary>
        )}
        {/* Scrim: keeps the copy at full contrast whatever the scene draws. */}
        <div aria-hidden className="hero-scrim pointer-events-none absolute inset-0" />
      </div>

      <div ref={content} className="relative w-full">
        {children}
      </div>

      {tier !== 'none' && !reducedMotion && (
        <p
          aria-hidden
          className="pointer-events-none absolute bottom-4 right-4 hidden font-mono text-[0.6rem] uppercase tracking-eyebrow text-muted md:block"
        >
          Drag the ball to spin it
        </p>
      )}
    </section>
  )
}

/**
 * The stadium scene in a box — used inside cards (the empty auction block).
 * Same tiering, pausing and fallback as the hero, no scroll coupling.
 */
export function StadiumBox({ className = '' }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const progress = useRef(0)
  const reducedMotion = useReducedMotion()
  const palette = usePalette()
  const inView = useInView(box, '60px')
  const visible = usePageVisible()
  const [tier, setTier] = useState<GfxTier>(() => detectTier())

  return (
    <div ref={box} aria-hidden className={`absolute inset-0 overflow-hidden ${className}`}>
      {tier === 'none' ? (
        <div className="floodlight crease absolute inset-0">
          <div className="hero-ball absolute left-1/2 top-[18%] h-36 w-36 -translate-x-1/2 sm:h-44 sm:w-44" />
        </div>
      ) : (
        <SceneBoundary onError={() => setTier('none')}>
          <Suspense fallback={<div className="floodlight crease absolute inset-0" />}>
            <StadiumScene
              palette={palette}
              tier={tier}
              reducedMotion={reducedMotion}
              active={inView && visible}
              progress={progress}
              eventSource={box}
              onFail={() => setTier('none')}
              layout="center"
            />
          </Suspense>
        </SceneBoundary>
      )}
    </div>
  )
}
