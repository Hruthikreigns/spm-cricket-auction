import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Empty, Eyebrow, LeagueMark, Loading, Note, Pill } from '../components/ui'
import { useLeague } from '../lib/league'
import type { League, LeagueStatus } from '../lib/types'

const TABS: { key: LeagueStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'UPCOMING', label: 'Upcoming' },
  { key: 'LIVE', label: 'Live' },
  { key: 'COMPLETED', label: 'Completed' },
]

const TONE: Record<LeagueStatus, 'live' | 'sold' | 'neutral'> = {
  LIVE: 'live',
  COMPLETED: 'sold',
  UPCOMING: 'neutral',
}

const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Date to be announced'

/** One league: mark, status, when and where — and a way in. */
function LeagueCard({ league }: { league: League }) {
  return (
    <Link to={`/leagues/${league.id}`} className="panel block p-5 transition hover:border-amber">
      <div className="flex items-start justify-between gap-3">
        <LeagueMark league={league} />
        <Pill tone={TONE[league.status]}>{league.status.toLowerCase()}</Pill>
      </div>
      <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
        {league.season ? `Season ${league.season} · ` : ''}
        {dateLabel(league.auction_date)}
      </p>
      {league.venue && <p className="mt-1 text-sm text-muted">{league.venue}</p>}
      <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-eyebrow text-amber">
        {league.status === 'COMPLETED'
          ? 'See the result →'
          : league.status === 'LIVE'
            ? 'Follow it live →'
            : 'Squads and players →'}
      </p>
    </Link>
  )
}

export function Leagues() {
  const { leagues, loading, error, select, leagueId } = useLeague()
  const [tab, setTab] = useState<LeagueStatus | 'ALL'>('ALL')

  const shown = tab === 'ALL' ? leagues : leagues.filter((l) => l.status === tab)

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <Eyebrow>Every season on the books</Eyebrow>
      <h1 className="mt-2 text-6xl sm:text-7xl">Leagues</h1>
      <p className="mt-4 max-w-xl text-muted">
        Squads, players and results live inside each league — upcoming, live and finished
        alike.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={tab === item.key ? 'btn-primary' : 'btn-ghost'}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && <Loading label="Loading leagues" />}
      {error && (
        <div className="mt-6">
          <Note tone="error">{error}</Note>
        </div>
      )}

      {!loading && shown.length === 0 && (
        <div className="mt-8">
          <Empty
            title="Nothing here yet"
            hint={
              tab === 'ALL'
                ? 'No leagues have been created.'
                : `No ${tab.toLowerCase()} leagues right now.`
            }
          />
        </div>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((league) => (
          <div key={league.id} className="flex flex-col gap-2">
            <LeagueCard league={league} />
            <button
              type="button"
              onClick={() => select(league.id)}
              className={leagueId === league.id ? 'btn-primary' : 'btn-ghost'}
            >
              {leagueId === league.id ? 'Following' : 'Follow this league'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
