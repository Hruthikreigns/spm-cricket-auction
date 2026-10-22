import { m, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'motion/react'
import type { ReactNode } from 'react'

import { ROLE_LABEL, initials, money } from '../lib/hooks'
import type { ArchivedPlayer, PlayerRole } from '../lib/types'
import { EASE_OUT } from './motion'

// --------------------------------------------------------------------------
// Role marks — small line icons, drawn here so they follow the theme colour.
// --------------------------------------------------------------------------
function RoleIcon({ role, className = 'h-4 w-4' }: { role: PlayerRole; className?: string }) {
  const common = { className, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  const bat = <path d="M14.5 4.5l5 5-9 9-3-.5-1.5-1.5-.5-3 9-9zM6 18l-2.5 2.5" />
  const ball = (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M7 6.5c2.2 3.4 2.2 7.6 0 11M17 6.5c-2.2 3.4-2.2 7.6 0 11" />
    </>
  )
  if (role === 'BATSMAN') return <svg viewBox="0 0 24 24" {...common}>{bat}</svg>
  if (role === 'BOWLER') return <svg viewBox="0 0 24 24" {...common}>{ball}</svg>
  if (role === 'WICKET_KEEPER')
    return (
      <svg viewBox="0 0 24 24" {...common}>
        <path d="M7 21V9.5a1.5 1.5 0 013 0V8a1.5 1.5 0 013 0v.5a1.5 1.5 0 013 0V10a1.5 1.5 0 013 0v5a6 6 0 01-6 6H7z" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" {...common}>
      <path d="M12 4l5 5-6.5 6.5-2.5-.5-1.5-2.5L12 4z" />
      <circle cx="17" cy="17" r="3.5" />
    </svg>
  )
}

// --------------------------------------------------------------------------
// The tilt shell: pointer-tilt on mouse, a 3D flip-up as each card scrolls
// into view on every device (so phones get the depth too), press-down on tap.
// --------------------------------------------------------------------------
function Depth({ children, index }: { children: ReactNode; index: number }) {
  const reduced = useReducedMotion()
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.5)
  const rx = useSpring(useTransform(y, [0, 1], [9, -9]), { stiffness: 200, damping: 18 })
  const ry = useSpring(useTransform(x, [0, 1], [-11, 11]), { stiffness: 200, damping: 18 })
  const gx = useTransform(x, (v) => `${v * 100}%`)
  const gy = useTransform(y, (v) => `${v * 100}%`)
  // The photo drifts against the tilt, so it reads as sitting behind the frame.
  const photoX = useTransform(x, (v) => `${(0.5 - v) * 16}px`)
  const photoY = useTransform(y, (v) => `${(0.5 - v) * 12}px`)

  return (
    <m.div
      className="squad-card group relative min-w-0 [perspective:1000px]"
      initial={reduced ? false : { opacity: 0, rotateX: 28, y: 40, scale: 0.94 }}
      whileInView={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }}
      viewport={{ once: true, margin: '0px 0px -8% 0px' }}
      transition={{ duration: 0.85, ease: EASE_OUT, delay: (index % 5) * 0.07 }}
      style={{ transformOrigin: '50% 100%' }}
    >
      <m.div
        className="relative h-full [transform-style:preserve-3d]"
        style={reduced ? undefined : { rotateX: rx, rotateY: ry }}
        whileTap={reduced ? undefined : { scale: 0.97 }}
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
        <PhotoLayer x={reduced ? undefined : photoX} y={reduced ? undefined : photoY}>
          {children}
        </PhotoLayer>
        {!reduced && (
          <m.span
            aria-hidden
            className="squad-glare pointer-events-none absolute inset-0 rounded-xl"
            style={{ ['--gx' as string]: gx, ['--gy' as string]: gy }}
          />
        )}
      </m.div>
    </m.div>
  )
}

// Passes the parallax motion values to the photo via CSS variables.
function PhotoLayer({ children, x, y }: { children: ReactNode; x?: MotionValue<string>; y?: MotionValue<string> }) {
  return (
    <m.div className="h-full" style={x && y ? { ['--px' as string]: x, ['--py' as string]: y } : undefined}>
      {children}
    </m.div>
  )
}

export function SquadPlayerCard({ player, index }: { player: ArchivedPlayer; index: number }) {
  const retained = player.status === 'RETAINED'
  return (
    <Depth index={index}>
      <article className="squad-face relative aspect-[3/4] overflow-hidden rounded-xl border border-line bg-raised">
        {player.photo_url ? (
          <img
            src={player.photo_url}
            alt={player.name}
            loading="lazy"
            className="squad-photo absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          <div aria-hidden className="squad-photo squad-blank absolute inset-0 flex items-center justify-center">
            <span className="font-display text-[5.5rem] font-black leading-none text-ink opacity-[0.12] sm:text-[7rem]">
              {player.jersey_number ?? initials(player.name)}
            </span>
          </div>
        )}

        {/* Bottom wash so the name always reads on any photo. */}
        <div aria-hidden className="squad-wash absolute inset-x-0 bottom-0 h-3/5" />

        <div className="absolute left-2.5 right-2.5 top-2.5 flex items-start justify-between sm:left-3 sm:right-3 sm:top-3">
          {retained ? (
            <span
              className="grid h-7 w-7 place-items-center rounded-md bg-white font-mono text-[0.7rem] font-bold text-[#0f1c3f] shadow"
              title="Retained"
              aria-label="Retained"
            >
              R
            </span>
          ) : player.jersey_number != null ? (
            <span className="rounded-md bg-black/45 px-2 py-1 font-mono text-[0.65rem] font-bold text-white backdrop-blur">
              #{player.jersey_number}
            </span>
          ) : (
            <span />
          )}
          <span
            className="grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#0f1c3f] shadow"
            title={ROLE_LABEL[player.role]}
          >
            <RoleIcon role={player.role} />
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
          <p className="font-mono text-[0.58rem] uppercase tracking-eyebrow text-white/75">
            {ROLE_LABEL[player.role]}
            {player.place ? ` · ${player.place}` : ''}
          </p>
          <h3 className="mt-1 break-words font-display text-2xl font-black uppercase leading-[0.9] text-white drop-shadow sm:text-[1.9rem]">
            {player.name}
          </h3>
          <p className="mt-2 flex items-baseline gap-1.5 text-white">
            <span className="font-mono text-[0.6rem] uppercase tracking-eyebrow text-white/70">
              {retained ? 'Kept' : 'Sold'}
            </span>
            <span className="money text-xl font-bold sm:text-2xl">{money(player.sold_price)}</span>
          </p>
        </div>
      </article>
    </Depth>
  )
}
