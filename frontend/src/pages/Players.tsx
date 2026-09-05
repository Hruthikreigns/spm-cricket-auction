import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Avatar, Empty, Eyebrow, LeagueMark, Loading, Note, PlayerCard, StatusPill } from '../components/ui'
import { api } from '../lib/api'
import { ROLE_LABEL, money, useAsync, useAuth } from '../lib/hooks'
import { useLeague } from '../lib/league'
import type { Player, PlayerRole, PlayerStatus } from '../lib/types'

const ROLES: (PlayerRole | 'ALL')[] = ['ALL', 'BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER']
const STATUSES: (PlayerStatus | 'ALL')[] = [
  'ALL',
  'AVAILABLE',
  'SOLD',
  'UNSOLD',
  'RETAINED',
  'NOT_AVAILABLE',
]

/**
 * Which league's players?
 *
 * Players belong to a league, so there is no meaningful list of "all players"
 * across seasons — picking a league first is the honest shape.
 */
export function ChoosePlayerLeague() {
  const { leagues, loading } = useLeague()

  if (loading) return <Loading label="Loading leagues" />

  if (leagues.length === 0)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Empty title="No leagues yet" hint="Players appear once a league has been created." />
      </div>
    )

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Eyebrow>Registered players, season by season</Eyebrow>
      <h1 className="mt-2 text-6xl sm:text-7xl">Players</h1>
      <p className="mt-4 max-w-xl text-muted">Choose a league to see who's in it.</p>

      <div className="mt-8 grid gap-3">
        {leagues.map((item) => (
          <Link
            key={item.id}
            to={`/leagues/${item.id}/players`}
            className="panel flex flex-wrap items-center gap-4 p-5 transition hover:border-amber"
          >
            <LeagueMark league={item} size="md" />
            <div className="ml-auto text-right">
              <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                {item.season ? `Season ${item.season} · ` : ''}
                {item.status.toLowerCase()}
              </p>
              <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-eyebrow text-amber">
                See the players →
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

export function Players() {
  const { leagueId: leagueParam } = useParams()
  const { leagues, select } = useLeague()
  const league = leagues.find((l) => l.id === Number(leagueParam)) ?? null
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [role, setRole] = useState<PlayerRole | 'ALL'>('ALL')
  const [status, setStatus] = useState<PlayerStatus | 'ALL'>('ALL')
  const [teamId, setTeamId] = useState<number | 'ALL'>('ALL')

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 250)
    return () => window.clearTimeout(id)
  }, [query])

  // Follow whichever league is being browsed, so opening a player from here
  // looks them up in the right one.
  useEffect(() => {
    if (league) select(league.id)
  }, [league?.id, select])

  const teams = useAsync(() => (league ? api.teams(league.id) : Promise.resolve([])), [league?.id])
  const players = useAsync(
    () =>
      league
        ? api.players(league.id, {
            q: debounced || undefined,
            role: role === 'ALL' ? undefined : role,
            status: status === 'ALL' ? undefined : status,
            team_id: teamId === 'ALL' ? undefined : teamId,
            limit: 300,
          })
        : Promise.resolve([]),
    [league?.id, debounced, role, status, teamId],
  )

  const rows = players.data ?? []

  if (!league)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Empty title="League not found" hint="It may have been removed." />
        <div className="mt-4 flex justify-center">
          <Link to="/players" className="btn-ghost">
            Choose another league
          </Link>
        </div>
      </div>
    )

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <Link to="/players" className="eyebrow hover:text-amber">
        ← All leagues
      </Link>
      <div className="mt-3">
        <LeagueMark league={league} as="eyebrow" />
      </div>
      <h1 className="mt-2 text-6xl sm:text-7xl">Players</h1>

      <div className="panel mt-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="eyebrow">Search</span>
          <input
            className="field mt-1.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, place or mobile"
          />
        </label>

        <label className="block">
          <span className="eyebrow">Role</span>
          <select
            className="field mt-1.5"
            value={role}
            onChange={(e) => setRole(e.target.value as PlayerRole | 'ALL')}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r === 'ALL' ? 'Every role' : ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="eyebrow">Status</span>
          <select
            className="field mt-1.5"
            value={status}
            onChange={(e) => setStatus(e.target.value as PlayerStatus | 'ALL')}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'ALL' ? 'Any status' : s.toLowerCase().replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="eyebrow">Squad</span>
          <select
            className="field mt-1.5"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
          >
            <option value="ALL">Every squad</option>
            {(teams.data ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
        {players.loading ? 'Searching' : `${rows.length} players`}
      </p>

      {players.error && (
        <div className="mt-4">
          <Note tone="error">{players.error}</Note>
        </div>
      )}

      {players.loading ? (
        <Loading label="Loading players" />
      ) : rows.length === 0 ? (
        <div className="mt-6">
          <Empty title="No players match" hint="Try a different role, squad or spelling." />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((player) => (
            <PlayerCard key={player.id} player={player} />
          ))}
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
export function PlayerProfile() {
  const { playerId } = useParams()
  const { league } = useLeague()
  const { email } = useAuth()
  const [restoring, setRestoring] = useState(false)
  const [editing, setEditing] = useState(false)
  const [working, setWorking] = useState(false)
  const [draft, setDraft] = useState({ name: '', mobile: '', place: '', role: 'BATSMAN' as PlayerRole })
  const id = Number(playerId)

  const player = useAsync(
    () => (league ? api.player(league.id, id) : Promise.resolve(null)),
    [league?.id, id],
  )

  const facts = useMemo(() => {
    const p = player.data as Player | null
    if (!p) return []
    return [
      ['Role', ROLE_LABEL[p.role]],
      ['Place', p.place ?? '—'],
      ['Jersey', p.jersey_number != null ? `#${p.jersey_number}` : '—'],
      ['Age', p.age != null ? `${p.age}` : '—'],
      ['Batting', p.batting_style ?? '—'],
      ['Bowling', p.bowling_style ?? '—'],
    ] as const
  }, [player.data])

  if (player.loading) return <Loading label="Loading the profile" />
  if (player.error || !player.data)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Note tone="error">{player.error ?? 'That player could not be found.'}</Note>
      </div>
    )

  const p = player.data as Player

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Link to="/players" className="eyebrow hover:text-amber">
        ← All players
      </Link>

      <div className="mt-4 grid gap-8 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="relative aspect-[3/4] overflow-hidden rounded-sm border border-line bg-raised">
          {p.photo_url ? (
            <img src={p.photo_url} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-8xl text-line">
              {p.jersey_number ?? '—'}
            </span>
          )}
        </div>

        <div>
          <StatusPill status={p.status} />
          <h1 className="mt-3 text-5xl sm:text-7xl">{p.name}</h1>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="eyebrow">{label}</dt>
                <dd className="mt-1 text-sm text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {email && (
            <div className="panel mt-8 p-4">
              <p className="eyebrow">Organiser</p>

              {editing ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="eyebrow">Name</span>
                    <input
                      className="field mt-1.5"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow">Mobile</span>
                    <input
                      className="field mt-1.5"
                      inputMode="numeric"
                      value={draft.mobile}
                      onChange={(e) =>
                        setDraft({ ...draft, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow">Place</span>
                    <input
                      className="field mt-1.5"
                      value={draft.place}
                      onChange={(e) => setDraft({ ...draft, place: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="eyebrow">Role</span>
                    <select
                      className="field mt-1.5"
                      value={draft.role}
                      onChange={(e) => setDraft({ ...draft, role: e.target.value as PlayerRole })}
                    >
                      {(['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'] as PlayerRole[]).map(
                        (r) => (
                          <option key={r} value={r}>
                            {ROLE_LABEL[r]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={working}
                      onClick={async () => {
                        setWorking(true)
                        try {
                          await api.updatePlayer(league!.id, p.id, {
                            name: draft.name.trim(),
                            mobile: draft.mobile || null,
                            place: draft.place.trim() || null,
                            role: draft.role,
                          })
                          window.location.reload()
                        } catch (err) {
                          window.alert((err as Error).message)
                        } finally {
                          setWorking(false)
                        }
                      }}
                    >
                      Save changes
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setDraft({
                        name: p.name,
                        mobile: p.mobile ?? '',
                        place: p.place ?? '',
                        role: p.role,
                      })
                      setEditing(true)
                    }}
                  >
                    Edit details
                  </button>

                  {(p.status === 'SOLD' || p.status === 'RETAINED') && (
                    <button
                      type="button"
                      className="btn-danger"
                      disabled={working}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            `Put ${p.name} back into the pool? ${p.team?.name ?? 'The squad'} is refunded.`,
                          )
                        )
                          return
                        setWorking(true)
                        try {
                          await api.reauctionPlayer(league!.id, p.id)
                          window.location.reload()
                        } catch (err) {
                          window.alert((err as Error).message)
                        } finally {
                          setWorking(false)
                        }
                      }}
                    >
                      {working ? 'Working' : 'Put back up for auction'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {email && (p.status === 'NOT_AVAILABLE' || p.status === 'UNSOLD') && (
            <div className="panel mt-8 flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">Organiser</p>
                <p className="mt-1 text-sm text-muted">
                  {p.status === 'NOT_AVAILABLE'
                    ? 'Marked not available during the auction.'
                    : 'Nobody bid when this player was called.'}{' '}
                  Put them back in the pool to be called again.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={restoring}
                onClick={async () => {
                  setRestoring(true)
                  try {
                    await api.restorePlayer(league!.id, p.id)
                    window.location.reload()
                  } catch (err) {
                    window.alert((err as Error).message)
                  } finally {
                    setRestoring(false)
                  }
                }}
              >
                {restoring ? 'Restoring' : 'Return to the pool'}
              </button>
            </div>
          )}

          {(p.status === 'SOLD' || p.status === 'RETAINED') && p.team && (
            <div className="panel mt-8 flex items-center gap-4 p-4">
              <Avatar name={p.team.name} src={p.team.logo_url} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="eyebrow">{p.status === 'RETAINED' ? 'Retained by' : 'Bought by'}</p>
                <Link to={`/teams/${p.team.id}`} className="mt-1 inline-flex hover:text-amber">
                  <span className="font-display text-2xl uppercase tracking-tightest">
                    {p.team.name}
                  </span>
                </Link>
              </div>
              <div className="text-right">
                <p className="eyebrow">Price</p>
                <p className="money text-2xl font-bold text-amber">{money(p.sold_price)}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
