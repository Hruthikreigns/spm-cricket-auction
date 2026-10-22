import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { m } from 'motion/react'

import { HeroStage } from '../components/HeroStage'
import { CountUp, EASE_OUT, Reveal, SplitHeadline, Stagger, StaggerItem, TiltCard } from '../components/motion'

import { Avatar, Eyebrow, Loading, Note, Pill, Stat, TeamBadge } from '../components/ui'
import { api } from '../lib/api'
import { APP_NAME, BANNER } from '../lib/brand'
import { loadGsap } from '../lib/gsap'
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

  // The stage is the same whatever the data: loading, an API error and an
  // empty install all still open on the floodlit ground.
  if (loading || error || !league)
    return (
      <HeroStage>
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-[34svh] sm:px-6 md:py-24">
          <SplitHeadline text={APP_NAME} className="max-w-3xl text-6xl font-black sm:text-8xl lg:text-9xl" />
          <div className="lit-rule mt-6 w-24" />
          <div className="mt-6 max-w-xl">
            {loading ? (
              <Loading label="Loading the league" />
            ) : error ? (
              <Note tone="error">{error}</Note>
            ) : (
              <>
                <p className="text-lg text-muted">
                  No league yet. Sign in as an administrator to create a league, add teams and
                  import your player register.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link to="/admin/login" className="btn-primary min-h-11">
                    Admin sign in
                  </Link>
                  <Link to="/leagues" className="btn-ghost glass min-h-11">
                    Leagues
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </HeroStage>
    )

  const onBlock = state?.current_player
  const isLive = state?.status === 'RUNNING' || state?.status === 'PAUSED'
  const count = (n: number | null | undefined) => (typeof n === 'number' ? <CountUp value={n} /> : '—')
  return (
    <>
      {/* Hero: the thesis is the auction itself, so it leads with the league
          and what's happening on the block right now, set over the floodlit
          ground. */}
      <HeroStage>
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-[34svh] sm:px-6 md:py-24">
          <m.div
            className="flex flex-wrap items-center gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE_OUT }}
          >
            <Pill tone={isLive ? 'live' : 'neutral'}>
              {isLive ? 'Auction live' : league.status === 'COMPLETED' ? 'Completed' : 'Upcoming'}
            </Pill>
            {league.season && <Pill>Season {league.season}</Pill>}
            <Pill>{dateLabel(league.auction_date)}</Pill>
          </m.div>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            {league.logo_url && (
              <m.img
                src={league.logo_url}
                alt=""
                className="h-16 w-16 rounded-sm border border-line object-cover sm:h-24 sm:w-24"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.1 }}
              />
            )}
            <SplitHeadline
              text={league.name}
              className="max-w-3xl text-6xl font-black sm:text-8xl lg:text-9xl"
            />
          </div>

          <m.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.45 }}
          >
            <div className="lit-rule mt-6 w-24" />
            {league.venue && (
              <p className="mt-4 font-mono text-xs uppercase tracking-eyebrow text-muted">{league.venue}</p>
            )}

            <p className="mt-5 max-w-xl text-lg text-muted">
              {league.about ??
                'Squads are built in one evening. Follow every bid, every purse and every squad as it fills.'}
            </p>

            {league.powered_by_name || league.powered_by_logo_url ? (
              <PoweredBy league={league} className="mt-6" />
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/live" className="btn-primary min-h-11">
                {isLive ? 'Watch the auction' : 'Open the auction room'}
              </Link>
              <Link to={`/leagues/${league.id}`} className="btn-ghost glass min-h-11">
                Squads and results
              </Link>
            </div>
          </m.div>

          {onBlock && (
            <m.div
              className="glass mt-10 flex max-w-2xl flex-wrap items-center gap-4 p-4"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.65 }}
            >
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
                <p
                  key={state?.current_bid ?? 'opening'}
                  className="money animate-snap text-2xl font-bold text-amber"
                >
                  {money(state?.current_bid ?? state?.next_bid_amount)}
                </p>
              </div>
              <Link to="/live" className="btn-ghost w-full sm:w-auto">
                Follow live
              </Link>
            </m.div>
          )}
        </div>
      </HeroStage>

      {/* The application's own banner — fixed, not per-league. It carries its
          own title, so nothing is laid over it. It now follows the hero as a
          framed print with a slow parallax drift. */}
      <BannerStrip />

      {league.poster_url && (
        <Reveal as="section" className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
          <Eyebrow>The tournament</Eyebrow>
          <img
            src={league.poster_url}
            alt={`${league.name} tournament poster`}
            loading="lazy"
            className="mt-3 w-full rounded-sm border border-line"
            style={{ boxShadow: 'var(--depth-1)' }}
          />
        </Reveal>
      )}

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <Reveal>
          <Eyebrow>The register</Eyebrow>
        </Reveal>
        <Stagger className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StaggerItem>
            <Stat label="Players registered" value={count(stats.data?.total_players)} />
          </StaggerItem>
          <StaggerItem>
            <Stat label="Sold so far" value={count(stats.data?.sold_players)} />
          </StaggerItem>
          <StaggerItem>
            <Stat label="Squads" value={count(stats.data?.total_teams)} />
          </StaggerItem>
          <StaggerItem>
            <Stat
              label="Highest price"
              value={stats.data?.highest_bid ? <CountUp value={stats.data.highest_bid} format={money} /> : '—'}
              hint={stats.data?.most_expensive_player?.name}
            />
          </StaggerItem>
        </Stagger>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <Reveal className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Fixtures</Eyebrow>
            <h2 className="mt-2 text-4xl">Leagues</h2>
          </div>
          <Link to="/leagues" className="btn-ghost shrink-0">
            All leagues
          </Link>
        </Reveal>
        <Stagger className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {leagues.map((item) => (
            <StaggerItem key={item.id}>
              <TiltCard>
                <LeagueTile league={item} />
              </TiltCard>
            </StaggerItem>
          ))}
        </Stagger>
      </section>
    </>
  )
}

/** The app banner, drifting slightly slower than the page as it passes. */
function BannerStrip() {
  const wrap = useRef<HTMLElement>(null)
  const img = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let revert = () => {}
    let cancelled = false
    loadGsap().then((gsap) => {
      if (cancelled || !wrap.current || !img.current) return
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(
          img.current,
          { yPercent: -6, scale: 1.12 },
          {
            yPercent: 6,
            scale: 1.12,
            ease: 'none',
            scrollTrigger: { trigger: wrap.current, start: 'top bottom', end: 'bottom top', scrub: true },
          },
        )
      })
      revert = () => mm.revert()
    })
    return () => {
      cancelled = true
      revert()
    }
  }, [])

  return (
    <Reveal as="section" className="mx-auto max-w-7xl px-4 pt-12 sm:px-6">
      <figure
        ref={wrap}
        className="overflow-hidden rounded-sm border border-line"
        style={{ boxShadow: 'var(--depth-1)' }}
      >
        <img
          ref={img}
          src={BANNER.src}
          srcSet={BANNER.srcSet}
          sizes="(min-width: 1280px) 1232px, 100vw"
          alt={BANNER.alt}
          width={BANNER.width}
          height={BANNER.height}
          loading="lazy"
          className="max-h-[22rem] w-full object-cover object-center will-change-transform sm:max-h-[26rem]"
        />
      </figure>
    </Reveal>
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
    <Link to={`/leagues/${league.id}`} className="panel block h-full p-5 transition hover:border-amber">
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
