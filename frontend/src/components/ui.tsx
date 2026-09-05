import { Link } from 'react-router-dom'

import { ROLE_LABEL, ROLE_SHORT, initials, money, shortMoney } from '../lib/hooks'
import type { Player, PlayerStatus, Team } from '../lib/types'

// --------------------------------------------------------------------------
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'live' | 'sold' | 'unsold' | 'kept'
}) {
  const tones = {
    neutral: 'border-line text-muted',
    live: 'border-amber text-amber',
    sold: 'border-amber/60 bg-amber/10 text-amber',
    unsold: 'border-cherry/60 text-cherry',
    kept: 'border-willow/60 text-willow',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-eyebrow ${tones[tone]}`}
    >
      {tone === 'live' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />}
      {children}
    </span>
  )
}

const STATUS_TONE: Record<PlayerStatus, 'neutral' | 'live' | 'sold' | 'unsold' | 'kept'> = {
  AVAILABLE: 'neutral',
  ON_BLOCK: 'live',
  SOLD: 'sold',
  UNSOLD: 'unsold',
  RETAINED: 'kept',
  NOT_AVAILABLE: 'neutral',
}

const STATUS_LABEL: Record<PlayerStatus, string> = {
  AVAILABLE: 'In the pool',
  ON_BLOCK: 'On the block',
  SOLD: 'Sold',
  UNSOLD: 'Unsold',
  RETAINED: 'Retained',
  NOT_AVAILABLE: 'Not available',
}

export const StatusPill = ({ status }: { status: PlayerStatus }) => (
  <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
)

// --------------------------------------------------------------------------
export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="panel p-4">
      <p className="eyebrow">{label}</p>
      <p className="money mt-2 text-2xl font-bold text-ink sm:text-3xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-12 text-muted">
      <span className="relative block h-px w-24 overflow-hidden bg-line">
        <span className="absolute inset-y-0 w-1/3 animate-sweep bg-amber" />
      </span>
      <span className="eyebrow">{label}</span>
    </div>
  )
}

export function Note({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'error' }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={`rounded-sm border px-3 py-2 text-sm ${
        tone === 'error' ? 'border-cherry/50 bg-cherry/10 text-cherry' : 'border-line text-muted'
      }`}
    >
      {children}
    </p>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="panel crease flex flex-col items-center gap-2 px-6 py-14 text-center">
      <h3 className="text-2xl text-ink">{title}</h3>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
    </div>
  )
}

// --------------------------------------------------------------------------
export function Avatar({
  name,
  src,
  jersey,
  size = 'md',
}: {
  name: string
  src?: string | null
  jersey?: number | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const dims = { sm: 'h-10 w-10 text-xs', md: 'h-14 w-14 text-sm', lg: 'h-24 w-24 text-xl' }[size]
  return (
    <div className={`relative shrink-0 overflow-hidden rounded-sm border border-line bg-raised ${dims}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="flex h-full w-full items-center justify-center font-display font-bold text-muted">
          {jersey != null ? jersey : initials(name)}
        </span>
      )}
    </div>
  )
}

/**
 * A league, always with its mark. Falls back to initials when no logo has
 * been uploaded, so the shape of the page never changes once one is.
 */
export function LeagueMark({
  league,
  size = 'sm',
  as = 'p',
  className = '',
}: {
  league: { name: string; logo_url: string | null }
  size?: 'sm' | 'md' | 'lg'
  /** 'eyebrow' for the small label above a heading; 'h1' for a page title. */
  as?: 'p' | 'eyebrow' | 'h1'
  className?: string
}) {
  const text =
    as === 'h1'
      ? 'font-display text-5xl uppercase leading-[0.86] tracking-tightest sm:text-7xl'
      : as === 'eyebrow'
        ? 'font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted'
        : 'font-display text-2xl uppercase leading-none tracking-tightest'

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Avatar name={league.name} src={league.logo_url} size={size} />
      {as === 'h1' ? (
        <h1 className={text}>{league.name}</h1>
      ) : (
        <span className={text}>{league.name}</span>
      )}
    </div>
  )
}

/**
 * A squad, always with its logo. Used wherever a team is named in passing —
 * the top bid, the bid ladder, the sold banner — so a squad is recognisable
 * by its badge across the whole site, not only on its own page.
 */
export function TeamBadge({
  team,
  size = 'sm',
  tone = 'default',
  className = '',
}: {
  team: { id?: number; name: string; short_name?: string | null; logo_url: string | null }
  size?: 'xs' | 'sm' | 'md'
  tone?: 'default' | 'amber' | 'muted'
  className?: string
}) {
  const dims = { xs: 'h-5 w-5 text-[0.5rem]', sm: 'h-7 w-7 text-[0.6rem]', md: 'h-10 w-10 text-xs' }[size]
  const label = {
    default: 'text-ink',
    amber: 'text-amber',
    muted: 'text-muted',
  }[tone]
  const type = {
    xs: 'font-mono text-xs',
    sm: 'font-display text-lg uppercase leading-none tracking-tightest',
    md: 'font-display text-2xl uppercase leading-none tracking-tightest',
  }[size]

  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      <span className={`shrink-0 overflow-hidden rounded-sm border border-line bg-raised ${dims}`}>
        {team.logo_url ? (
          <img src={team.logo_url} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-display font-bold text-muted">
            {(team.short_name ?? initials(team.name)).slice(0, 3)}
          </span>
        )}
      </span>
      <span className={`truncate ${type} ${label}`}>{team.name}</span>
    </span>
  )
}

/** Purse drawn as a strip that empties left to right as a team spends. */
export function PurseBar({ team, size = 'sm' }: { team: Team; size?: 'sm' | 'lg' }) {
  const used = team.purse_amount ? Math.min(100, (team.spent / team.purse_amount) * 100) : 0
  const big = size === 'lg'
  return (
    <div>
      <div className={`w-full overflow-hidden rounded-sm bg-raised ${big ? 'h-2.5' : 'h-1.5'}`}>
        <div
          className="h-full bg-amber transition-[width] duration-500"
          style={{ width: `${used}%`, background: team.accent_color ?? undefined }}
        />
      </div>
      {/* In the auction room these two figures are the whole point, so they
          are set large enough to read from across the table. */}
      <div className={`mt-2 flex items-baseline justify-between gap-2 ${big ? '' : 'mt-1.5'}`}>
        <span
          className={`money text-muted ${big ? 'text-base font-semibold sm:text-lg' : 'text-[0.65rem]'}`}
        >
          <span className={big ? 'block text-[0.6rem] uppercase tracking-eyebrow' : ''}>Spent</span>
          {shortMoney(team.spent)}
        </span>
        <span
          className={`money text-right text-ink ${big ? 'text-lg font-bold sm:text-2xl' : 'text-[0.65rem]'}`}
        >
          <span className={big ? 'block text-[0.6rem] uppercase tracking-eyebrow text-muted' : ''}>
            Left
          </span>
          {shortMoney(team.remaining_purse)}
          {!big && ' left'}
        </span>
      </div>
    </div>
  )
}

export function TeamPaddle({
  team,
  leading,
  eligible = true,
  onBid,
  reason,
  size = 'sm',
}: {
  team: Team
  leading?: boolean
  eligible?: boolean
  onBid?: () => void
  /** Why this squad can't bid, shown on hover when it's greyed out. */
  reason?: string
  /** 'lg' enlarges the purse figures for the auction room. */
  size?: 'sm' | 'lg'
}) {
  const identity = (logoSize: 'sm' | 'md') => (
    <div className="flex items-center gap-3">
      <Avatar name={team.name} src={team.logo_url} size={logoSize} />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate font-display text-xl uppercase leading-none tracking-tightest">
          {team.name}
        </p>
        <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
          {team.player_count} players
          {team.retained_count > 0 && ` · ${team.retained_count} retained`}
        </p>
      </div>
      {leading && <Pill tone="live">Top bid</Pill>}
    </div>
  )

  // Read-only: the public purse board, which links through to the squad.
  if (!onBid) {
    return (
      <Link
        to={`/teams/${team.id}`}
        className="panel block p-4 transition hover:border-amber focus-visible:border-amber"
      >
        {identity('sm')}
        <div className="mt-3">
          <PurseBar team={team} size={size} />
        </div>
      </Link>
    )
  }

  // Bidding: the whole card is the target. A big logo and name is easier to
  // hit in a dark room than a small button under it, and the price lives once
  // at the top of the column rather than repeated on every squad.
  return (
    <button
      type="button"
      onClick={onBid}
      disabled={!eligible}
      title={eligible ? `Bid for ${team.name}` : reason}
      aria-label={`Bid for ${team.name}`}
      className={`panel w-full p-4 text-left transition
        enabled:hover:border-amber enabled:active:translate-y-px
        disabled:cursor-not-allowed disabled:opacity-40
        ${leading ? 'border-amber' : ''}`}
    >
      {identity('md')}
      <div className="mt-3">
        <PurseBar team={team} size={size} />
      </div>
    </button>
  )
}

// --------------------------------------------------------------------------
export function PlayerCard({ player }: { player: Player }) {
  return (
    <Link
      to={`/players/${player.id}`}
      className="panel group flex items-center gap-3 p-3 transition hover:border-amber"
    >
      <Avatar name={player.name} src={player.photo_url} jersey={player.jersey_number} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg uppercase leading-none tracking-tightest group-hover:text-amber">
          {player.name}
        </p>
        <p className="mt-1 truncate font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
          {ROLE_SHORT[player.role]}
          {player.place && ` · ${player.place}`}
          {player.jersey_number != null && ` · #${player.jersey_number}`}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <StatusPill status={player.status} />
          {player.sold_price != null && (
            <span className="money text-xs text-amber">{money(player.sold_price)}</span>
          )}
        </div>
      </div>
    </Link>
  )
}

export function PlayerRow({ player }: { player: Player }) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-3 last:border-0">
      <Avatar name={player.name} src={player.photo_url} jersey={player.jersey_number} size="sm" />
      <div className="min-w-0 flex-1">
        <Link to={`/players/${player.id}`} className="truncate text-sm font-semibold hover:text-amber">
          {player.name}
        </Link>
        <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
          {ROLE_LABEL[player.role]}
          {player.place && ` · ${player.place}`}
        </p>
      </div>
      <span className="money text-sm text-amber">{money(player.sold_price)}</span>
    </div>
  )
}
