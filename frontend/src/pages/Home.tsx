import { Link } from 'react-router-dom'

import { Avatar, Eyebrow, Empty, Loading, Note, Pill, Stat, TeamBadge } from '../components/ui'
import { api } from '../lib/api'
import { BANNER } from '../lib/brand'
import { money, useAsync, useLiveAuction } from '../lib/hooks'
import { useLeague } from '../lib/league'
import type { League } from '../lib/types'

const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Date to be announced'

export function Home() {
  const { league, leagues, loading, error } = useLeague()
  const { state } = useLiveAuction(league?.id ?? null)
  const stats = useAsync(() => (league ? api.analytics(league.id) : Promise.resolve(null)), [league?.id])

  if (loading) return <Loading label="Loading the league" />
  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Note tone="error">{error}</Note>
      </div>
    )
  if (!league)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <Empty
          title="No league yet"
          hint="Sign in as an administrator to create a league, add teams and import your player register."
        />
      </div>
    )

  const onBlock = state?.current_player
  const isLive = state?.status === 'RUNNING' || state?.status === 'PAUSED'
  return (
    <>
      {/* The application's own banner — fixed, not per-league. It carries its
          own title, so nothing is laid over it and the league's name follows
          underneath. */}
      <section className="border-b border-line">
        <img
          src={BANNER.src}
          srcSet={BANNER.srcSet}
          sizes="100vw"
          alt={BANNER.alt}
          width={BANNER.width}
          height={BANNER.height}
          fetchPriority="high"
          className="max-h-[22rem] w-full object-cover object-center sm:max-h-[26rem]"
        />
      </section>

      {/* Hero: the thesis is the auction itself, so it leads with what's
          happening on the block right now rather than a marketing line. */}
      <section className="floodlight crease relative overflow-hidden border-b border-line">
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={isLive ? 'live' : 'neutral'}>
              {isLive ? 'Auction live' : league.status === 'COMPLETED' ? 'Completed' : 'Upcoming'}
            </Pill>
            {league.season && <Pill>Season {league.season}</Pill>}
            <Pill>{dateLabel(league.auction_date)}</Pill>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            {league.logo_url && (
              <img
                src={league.logo_url}
                alt=""
                className="h-16 w-16 rounded-sm border border-line object-cover sm:h-24 sm:w-24"
              />
            )}
            <h1 className="max-w-4xl text-6xl font-black sm:text-8xl lg:text-9xl">{league.name}</h1>
          </div>

          {league.venue && (
            <p className="mt-4 font-mono text-xs uppercase tracking-eyebrow text-muted">{league.venue}</p>
          )}

          <p className="mt-6 max-w-2xl text-lg text-muted">
            {league.about ??
              'Squads are built in one evening. Follow every bid, every purse and every squad as it fills.'}
          </p>

          {league.powered_by_name || league.powered_by_logo_url ? (
            <PoweredBy league={league} className="mt-6" />
          ) : null}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/live" className="btn-primary">
              {isLive ? 'Watch the auction' : 'Open the auction room'}
            </Link>
            <Link to={`/leagues/${league.id}`} className="btn-ghost">
              Squads and results
            </Link>
          </div>

          {onBlock && (
            <div className="panel mt-10 flex flex-wrap items-center gap-4 p-4">
              <Avatar name={onBlock.name} src={onBlock.photo_url} jersey={onBlock.jersey_number} />
              <div className="min-w-0">
                <Eyebrow>On the block now</Eyebrow>
                <p className="truncate font-display text-2xl uppercase tracking-tightest">
                  {onBlock.name}
                </p>
              </div>
              <div className="ml-auto text-right">
                {state?.current_team ? (
                  <TeamBadge team={state.current_team} size="xs" tone="muted" />
                ) : (
                  <Eyebrow>Opening</Eyebrow>
                )}
                <p className="money text-2xl font-bold text-amber">
                  {money(state?.current_bid ?? state?.next_bid_amount)}
                </p>
              </div>
              <Link to="/live" className="btn-ghost w-full sm:w-auto">
                Follow live
              </Link>
            </div>
          )}
        </div>
      </section>

      {league.poster_url && (
        <section className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
          <Eyebrow>The tournament</Eyebrow>
          <img
            src={league.poster_url}
            alt={`${league.name} tournament poster`}
            className="mt-3 w-full rounded-sm border border-line"
          />
        </section>
      )}

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <Eyebrow>The register</Eyebrow>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Players registered" value={stats.data?.total_players ?? '—'} />
          <Stat label="Sold so far" value={stats.data?.sold_players ?? '—'} />
          <Stat label="Squads" value={stats.data?.total_teams ?? '—'} />
          <Stat
            label="Highest price"
            value={stats.data?.highest_bid ? money(stats.data.highest_bid) : '—'}
            hint={stats.data?.most_expensive_player?.name}
          />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Fixtures</Eyebrow>
            <h2 className="mt-2 text-4xl">Leagues</h2>
          </div>
          <Link to="/leagues" className="btn-ghost shrink-0">
            All leagues
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {leagues.map((item) => (
            <LeagueTile key={item.id} league={item} />
          ))}
        </div>
      </section>
    </>
  )
}

/** The sponsor credit, small and out of the way. */
export function PoweredBy({ league, className = '' }: { league: League; className?: string }) {
  const name = league.powered_by_name ?? undefined
  const inner = (
    <>
      <span className="eyebrow">Powered by</span>
      {league.powered_by_logo_url ? (
        <img
          src={league.powered_by_logo_url}
          alt={name ?? 'Sponsor'}
          className="h-8 w-auto max-w-[9rem] object-contain"
        />
      ) : (
        <span className="font-display text-xl uppercase tracking-tightest">{name}</span>
      )}
    </>
  )

  if (league.powered_by_url)
    return (
      <a
        href={league.powered_by_url}
        target="_blank"
        rel="noreferrer noopener"
        className={`inline-flex items-center gap-3 transition hover:opacity-80 ${className}`}
      >
        {inner}
      </a>
    )
  return <div className={`inline-flex items-center gap-3 ${className}`}>{inner}</div>
}

export function LeagueTile({ league }: { league: League }) {
  const tone = league.status === 'LIVE' ? 'live' : league.status === 'COMPLETED' ? 'sold' : 'neutral'
  return (
    <Link to={`/leagues/${league.id}`} className="panel block p-5 transition hover:border-amber">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {league.logo_url && (
            <img src={league.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-sm border border-line object-cover" />
          )}
          <div className="min-w-0">
          <h3 className="truncate text-2xl">{league.name}</h3>
          <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
            {league.season ? `Season ${league.season} · ` : ''}
            {dateLabel(league.auction_date)}
          </p>
          </div>
        </div>
        <Pill tone={tone}>{league.status.toLowerCase()}</Pill>
      </div>
      {league.venue && <p className="mt-3 text-sm text-muted">{league.venue}</p>}
    </Link>
  )
}
