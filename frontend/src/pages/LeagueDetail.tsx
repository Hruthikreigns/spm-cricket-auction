import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Avatar, Eyebrow, Loading, Note, Pill, Stat } from '../components/ui'
import { api } from '../lib/api'
import { ROLE_LABEL, money, useAsync, useAuth } from '../lib/hooks'
import type { ArchivedPlayer, LeagueStatus } from '../lib/types'

const dateLabel = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

const TONE: Record<LeagueStatus, 'live' | 'sold' | 'neutral'> = {
  LIVE: 'live',
  COMPLETED: 'sold',
  UPCOMING: 'neutral',
}

// --------------------------------------------------------------------------
function PlayerLine({
  player,
  showContact,
  linkToProfile,
}: {
  player: ArchivedPlayer
  showContact: boolean
  /** Profiles are organiser-only, so the name is plain text for everyone else. */
  linkToProfile: boolean
}) {
  const reg = player.registration
  return (
    <li className="flex flex-wrap items-start gap-3 border-b border-line py-3 last:border-0">
      <Avatar
        name={player.name}
        src={player.photo_url ?? reg?.submitted_photo_url}
        jersey={player.jersey_number}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {linkToProfile ? (
            <Link to={`/players/${player.id}`} className="text-sm font-semibold hover:text-amber">
              {player.name}
            </Link>
          ) : (
            <span className="text-sm font-semibold">{player.name}</span>
          )}
          {player.status === 'RETAINED' && <Pill tone="kept">retained</Pill>}
        </div>
        <p className="mt-0.5 font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
          {ROLE_LABEL[player.role]}
          {player.place && ` · ${player.place}`}
          {player.age != null && ` · ${player.age} yrs`}
          {player.bid_count > 0 && ` · ${player.bid_count} bids`}
        </p>

        {(player.batting_style || player.bowling_style) && (
          <p className="mt-0.5 text-[0.7rem] text-muted">
            {[player.batting_style, player.bowling_style].filter(Boolean).join(' · ')}
          </p>
        )}

        {reg && (
          <div className="mt-1.5 text-[0.7rem] text-muted">
            <span className="text-willow">Registered</span>{' '}
            {new Date(reg.registered_at).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            {showContact && reg.mobile && <> · {reg.mobile}</>}
            {showContact && reg.note && <span className="block italic">"{reg.note}"</span>}
          </div>
        )}
      </div>
      <span className="money shrink-0 text-sm text-amber">{money(player.sold_price)}</span>
    </li>
  )
}

/**
 * One league in full: its squads and who they hold, plus the result once the
 * auction is done. The same page serves an upcoming league (squads with empty
 * lists), a live one (filling up, refreshing itself) and a finished one.
 */
export function LeagueDetail() {
  const { leagueId } = useParams()
  const { email } = useAuth()
  const id = Number(leagueId)

  // Bumped on a timer to re-run the fetch while an auction is under way.
  const [tick, setTick] = useState(0)
  const query = useAsync(() => api.results(id), [id, email, tick])
  const data = query.data
  const isLive = data?.status === 'LIVE'

  // A finished auction never changes, so only a live one is worth polling.
  // Ten seconds is enough to follow along without hammering the server from
  // every phone in the ground — /live is the screen for bid-by-bid.
  useEffect(() => {
    if (!isLive) return
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1)
    }, 10000)
    // A phone coming out of a pocket should catch up immediately.
    const onVisible = () => document.visibilityState === 'visible' && setTick((t) => t + 1)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isLive])

  if (query.loading && !data) return <Loading label="Loading the result" />
  if (query.error || !data)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Note tone="error">{query.error ?? 'That auction could not be found.'}</Note>
      </div>
    )

  const s = data.summary

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <Link to="/leagues" className="eyebrow hover:text-amber">
        ← All leagues
      </Link>

      <header className="mt-4 flex flex-wrap items-end gap-4">
        <Avatar name={data.league_name} src={data.logo_url} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={TONE[data.status]}>{data.status.toLowerCase()}</Pill>
            {isLive && <Pill tone="live">updating every 10s</Pill>}
            {data.season && <Pill>Season {data.season}</Pill>}
            {dateLabel(data.auction_date) && <Pill>{dateLabel(data.auction_date)}</Pill>}
          </div>
          <h1 className="mt-3 text-5xl sm:text-7xl">{data.league_name}</h1>
          {data.venue && (
            <p className="mt-2 font-mono text-xs uppercase tracking-eyebrow text-muted">{data.venue}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isLive && (
            <Link to="/live" className="btn-primary">
              Watch the auction room
            </Link>
          )}
          {data.viewer_is_admin && (
            <Link to={`/leagues/${data.league_id}/players`} className="btn-ghost">
              Player register
            </Link>
          )}
          <a className="btn-ghost" href={api.exportUrl(data.league_id)}>
            Download as Excel
          </a>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={data.status === 'UPCOMING' ? 'In the pool' : 'Players sold'}
          value={data.status === 'UPCOMING' ? s.total_players : s.sold_players}
          hint={`${s.retained_players} retained`}
        />
        <Stat label="Total spent" value={money(s.total_spent)} />
        <Stat
          label="Highest price"
          value={money(s.highest_price)}
          hint={s.most_expensive_player ?? undefined}
        />
        <Stat
          label="Went unsold"
          value={s.unsold_players}
          hint={`${s.registrations_received} registered`}
        />
      </div>

      {data.viewer_is_admin && (
        <p className="mt-3 font-mono text-[0.65rem] uppercase tracking-eyebrow text-willow">
          Signed in as an organiser — contact details are shown below and are not public
        </p>
      )}

      {isLive && (
        <p className="mt-4 text-sm text-muted">
          This auction is still running, so these figures move as players are sold. For the
          player on the block right now, the bidding and the clock, open the auction room.
        </p>
      )}

      <section className="mt-10">
        <Eyebrow>{data.status === 'UPCOMING' ? 'Who is in' : 'Who went where'}</Eyebrow>
        <h2 className="mt-2 text-4xl">Squads</h2>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {data.squads.map((squad) => (
            <article key={squad.team.id} className="panel p-5">
              <Link
                to={`/teams/${squad.team.id}`}
                className="flex items-center gap-3 transition hover:text-amber"
              >
                <Avatar name={squad.team.name} src={squad.team.logo_url} size="sm" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-2xl">{squad.team.name}</h3>
                  <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                    {squad.owner_name ? `${squad.owner_name} · ` : ''}
                    {squad.player_count} players · see the squad →
                  </p>
                </div>
                <div className="text-right">
                  <p className="money text-lg text-amber">{money(squad.spent)}</p>
                  <p className="font-mono text-[0.6rem] uppercase tracking-eyebrow text-muted">
                    {money(squad.remaining_purse)} left
                  </p>
                </div>
              </Link>

              {/* No player list here — squads first, then the squad's own page
                  shows who it holds. */}
              <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-3">
                <span className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                  {squad.player_count} players
                  {squad.retained_count > 0 && ` · ${squad.retained_count} retained`}
                </span>
                {squad.most_expensive != null && (
                  <span className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                    top buy <span className="text-amber">{money(squad.most_expensive)}</span>
                  </span>
                )}
                <Link
                  to={`/teams/${squad.team.id}`}
                  className="ml-auto font-mono text-[0.65rem] uppercase tracking-eyebrow text-amber"
                >
                  See the players →
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      {data.unsold.length > 0 && (
        <section className="mt-12">
          <Eyebrow>Nobody bid</Eyebrow>
          <h2 className="mt-2 text-4xl">Unsold</h2>
          {data.viewer_is_admin ? (
            <div className="panel mt-4 px-5">
              <ul>
                {data.unsold.map((player) => (
                  <PlayerLine
                    key={player.id}
                    player={player}
                    showContact
                    linkToProfile
                  />
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-muted">
              {data.unsold.length} player{data.unsold.length === 1 ? '' : 's'} went unsold.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
