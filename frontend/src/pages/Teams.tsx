import { Link, useParams } from 'react-router-dom'

import { Avatar, Empty, Eyebrow, LeagueMark, Loading, Note, Stat } from '../components/ui'
import { api } from '../lib/api'
import { ROLE_LABEL, money, useAsync } from '../lib/hooks'
import { useLeague } from '../lib/league'

export function TeamDetail() {
  const { teamId } = useParams()
  const { league } = useLeague()
  const id = Number(teamId)

  // Reads the league result rather than the player register: the register is
  // for organisers, but a squad and what it paid is public.
  const query = useAsync(
    () => (league ? api.results(league.id) : Promise.resolve(null)),
    [league?.id],
  )
  const squad = query.data?.squads.find((s) => s.team.id === id) ?? null

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

  const retained = squad.players.filter((p) => p.status === 'RETAINED')
  const bought = squad.players.filter((p) => p.status === 'SOLD')

  const line = (player: (typeof squad.players)[number]) => (
    <li key={player.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
      <Avatar name={player.name} src={player.photo_url} jersey={player.jersey_number} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{player.name}</p>
        <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
          {ROLE_LABEL[player.role]}
          {player.place && ` · ${player.place}`}
        </p>
      </div>
      <span className="money text-sm text-amber">{money(player.sold_price)}</span>
    </li>
  )

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <Link to={league ? `/leagues/${league.id}` : '/leagues'} className="eyebrow hover:text-amber">
        ← Back to {league?.name ?? 'the league'}
      </Link>

      {league && (
        <div className="mt-3">
          <LeagueMark league={league} as="eyebrow" />
        </div>
      )}

      <header className="mt-4 flex flex-wrap items-end gap-5">
        <Avatar name={squad.team.name} src={squad.team.logo_url} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-5xl sm:text-7xl">{squad.team.name}</h1>
          <p className="mt-2 font-mono text-xs uppercase tracking-eyebrow text-muted">
            {squad.owner_name && `Owner ${squad.owner_name}`}
            {squad.captain_name && ` · Captain ${squad.captain_name}`}
          </p>
        </div>
      </header>

      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Squad size" value={squad.player_count} hint={`${squad.retained_count} retained`} />
        <Stat label="Spent" value={money(squad.spent)} />
        <Stat label="Purse left" value={money(squad.remaining_purse)} />
        <Stat label="Most expensive" value={money(squad.most_expensive)} />
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section>
          <Eyebrow>Retained before the auction</Eyebrow>
          <h2 className="mt-2 text-3xl">Retained players</h2>
          <ul className="panel mt-4 px-4">
            {retained.length === 0 ? (
              <p className="py-6 text-sm text-muted">No players were retained.</p>
            ) : (
              retained.map(line)
            )}
          </ul>
        </section>

        <section>
          <Eyebrow>Won at the table</Eyebrow>
          <h2 className="mt-2 text-3xl">Bought players</h2>
          <ul className="panel mt-4 px-4">
            {bought.length === 0 ? (
              <p className="py-6 text-sm text-muted">Nothing bought yet.</p>
            ) : (
              bought.map(line)
            )}
          </ul>
        </section>
      </div>
    </div>
  )
}
