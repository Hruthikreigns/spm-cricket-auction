import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { m } from 'motion/react'

import { EASE_OUT, TiltCard } from '../components/motion'
import { SquadPlayerCard } from '../components/SquadCards'
import { Empty, LeagueMark, Loading, Note } from '../components/ui'
import { api } from '../lib/api'
import { initials, money, useAsync } from '../lib/hooks'
import { useLeague } from '../lib/league'

type Filter = 'ALL' | 'RETAINED' | 'SOLD'

export function TeamDetail() {
  const { teamId } = useParams()
  const { league } = useLeague()
  const id = Number(teamId)
  const [filter, setFilter] = useState<Filter>('ALL')

  // Reads the league result rather than the player register: the register is
  // for organisers, but a squad and what it paid is public.
  const query = useAsync(
    () => (league ? api.results(league.id) : Promise.resolve(null)),
    [league?.id],
  )
  const squad = query.data?.squads.find((s) => s.team.id === id) ?? null

  // Retained first, then by price paid — the same order the room remembers.
  const players = useMemo(
    () =>
      [...(squad?.players ?? [])]
        .filter((p) => p.status === 'RETAINED' || p.status === 'SOLD')
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'RETAINED' ? -1 : 1
          return (b.sold_price ?? 0) - (a.sold_price ?? 0)
        }),
    [squad],
  )

  if (query.loading) return <Loading label="Loading the squad" />
  if (query.error)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Note tone="error">{query.error}</Note>
      </div>
    )
  if (!squad)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Empty title="Squad not found" hint="It may have been removed, or belong to another league." />
      </div>
    )

  const retained = players.filter((p) => p.status === 'RETAINED')
  const bought = players.filter((p) => p.status === 'SOLD')
  const shown = filter === 'ALL' ? players : filter === 'RETAINED' ? retained : bought
  const topBuy = bought.reduce<(typeof bought)[number] | null>(
    (best, p) => ((p.sold_price ?? 0) > (best?.sold_price ?? -1) ? p : best),
    null,
  )

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'ALL', label: 'All', count: players.length },
    { key: 'RETAINED', label: 'Retained', count: retained.length },
    { key: 'SOLD', label: 'Bought', count: bought.length },
  ]

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={league ? `/leagues/${league.id}` : '/leagues'}
          className="eyebrow inline-flex min-h-11 items-center hover:text-amber"
        >
          ← Back to {league?.name ?? 'the league'}
        </Link>
        {league && <LeagueMark league={league} as="eyebrow" />}
      </div>

      {/* Team banner */}
      <m.header
        className="squad-hero relative mt-3 overflow-hidden rounded-2xl p-5 sm:p-8"
        initial={{ opacity: 0, y: 24, rotateX: 10 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.8, ease: EASE_OUT }}
        style={{ transformPerspective: 1200 }}
      >
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
          <div className="min-w-0">
            <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-white/70">Squad</p>
            <h1 className="mt-2 break-words text-5xl font-black text-white sm:text-7xl">{squad.team.name}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {squad.owner_name && <span className="chip">Owner: {squad.owner_name}</span>}
              {squad.captain_name && <span className="chip">Captain: {squad.captain_name}</span>}
              <span className="chip">{squad.player_count} players</span>
              {squad.retained_count > 0 && <span className="chip">{squad.retained_count} retained</span>}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-white/15 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:pl-8">
            <div>
              <dt>Spent</dt>
              <dd className="text-2xl sm:text-3xl">{money(squad.spent)}</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd className="text-2xl sm:text-3xl">{money(squad.remaining_purse)}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt>Top buy</dt>
              <dd className="text-2xl sm:text-3xl">{money(topBuy?.sold_price ?? squad.most_expensive)}</dd>
              {topBuy && <p className="mt-0.5 truncate text-xs text-white/75">{topBuy.name}</p>}
            </div>
          </dl>

          {/* The squad's badge, floating on its own plane. */}
          <TiltCard className="hidden w-40 shrink-0 sm:block lg:w-44">
            <div className="grid aspect-square place-items-center overflow-hidden rounded-xl border-2 border-white/80 bg-white shadow-2xl">
              {squad.team.logo_url ? (
                <img src={squad.team.logo_url} alt={`${squad.team.name} logo`} className="h-full w-full object-contain p-2" />
              ) : (
                <span className="font-display text-6xl font-black text-[#0f1c3f]">
                  {(squad.team.short_name ?? initials(squad.team.name)).slice(0, 3)}
                </span>
              )}
            </div>
          </TiltCard>
        </div>
      </m.header>

      {/* Squad lineup */}
      <section className="mt-10 sm:mt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-4xl sm:text-5xl">Squad lineup</h2>
            <div className="lit-rule mt-3 w-28" />
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto" role="tablist" aria-label="Filter the squad">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={filter === t.key}
                onClick={() => setFilter(t.key)}
                className={`${filter === t.key ? 'btn-primary' : 'btn-ghost'} min-h-11 !px-2 sm:!px-4`}
              >
                {t.label} · {t.count}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="mt-6">
            <Empty
              title={filter === 'RETAINED' ? 'No players were retained' : 'Nobody here yet'}
              hint="Players appear here as the hammer falls."
            />
          </div>
        ) : (
          <div
            key={filter}
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5"
          >
            {shown.map((player, i) => (
              <SquadPlayerCard key={player.id} player={player} index={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
