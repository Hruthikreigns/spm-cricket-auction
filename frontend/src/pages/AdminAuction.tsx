import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { BlockCard } from '../components/BlockCard'
import { Fireworks } from '../components/Fireworks'
import { Empty, Eyebrow, LeagueMark, Loading, Note, Pill, TeamPaddle } from '../components/ui'
import { api } from '../lib/api'
import { money, useLiveAuction } from '../lib/hooks'
import { useLeague } from '../lib/league'
import { isMuted, playBid, preloadSounds, playSold, playUnsold, setMuted, unlockAudio } from '../lib/sound'
import type { AuctionSettings, Player } from '../lib/types'

export function AdminAuction() {
  const { league } = useLeague()
  const { state, teams, connected, hammer, lastEvent, refresh } = useLiveAuction(league?.id ?? null)
  const [muted, setMutedState] = useState(isMuted())
  const [firework, setFirework] = useState<number | null>(null)
  const [settings, setSettings] = useState<AuctionSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The live feed is deliberately stripped of phone numbers, so the console
  // fetches the player again with its token to get one.
  const [contact, setContact] = useState<string | null>(null)
  // Mopping up: find a player who never sold and place them in a squad.
  const [mopQuery, setMopQuery] = useState('')
  const [mopResults, setMopResults] = useState<Player[]>([])
  const [mopPicked, setMopPicked] = useState<Player | null>(null)
  const [mopTeam, setMopTeam] = useState<number | ''>('')
  const [mopPrice, setMopPrice] = useState('')
  const [searching, setSearching] = useState(false)
  const [retainTeam, setRetainTeam] = useState<number | ''>('')
  const [directTeam, setDirectTeam] = useState<number | ''>('')
  const [directPrice, setDirectPrice] = useState('')

  useEffect(() => {
    if (!league) return
    api.settings(league.id).then(setSettings).catch(() => undefined)
  }, [league?.id])

  useEffect(() => {
    const unlock = () => {
      unlockAudio()
      preloadSounds()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  const onBlockId = state?.current_player?.id ?? null
  useEffect(() => {
    if (!league || !onBlockId) {
      setContact(null)
      return
    }
    let live = true
    api
      .player(league.id, onBlockId)
      .then((p) => live && setContact(p.mobile))
      .catch(() => live && setContact(null))
    return () => {
      live = false
    }
  }, [league?.id, onBlockId])

  useEffect(() => {
    if (!hammer) return
    if (hammer.sold) {
      playSold()
      setFirework(hammer.id)
    } else {
      playUnsold()
    }
  }, [hammer])

  // A tick as each bid lands, so the room hears the money move.
  useEffect(() => {
    if (lastEvent === 'bid_placed') playBid()
  }, [lastEvent, state?.current_bid])

  /** Every control funnels through here so one error surface serves them all. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        await action()
        await refresh()
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  // Keyboard shortcuts: the auctioneer's hands stay off the mouse.
  useEffect(() => {
    if (!league || !state) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      if (event.key === 'n' && !state.current_player) run(() => api.nextPlayer(league.id))
      if (event.key === 's' && state.current_bid) run(() => api.sold(league.id))
      if (event.key === 'u' && state.current_player) run(() => api.unsold(league.id))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [league, state, run])

  if (!league)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Empty title="No league selected" hint="Create a league in setup before running an auction." />
      </div>
    )
  if (!state) return <Loading label="Loading the console" />

  const running = state.status === 'RUNNING'
  const paused = state.status === 'PAUSED'
  const onBlock = Boolean(state.current_player)
  const nextAmount = state.next_bid_amount ?? settings?.base_price ?? 0

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Fireworks trigger={firework} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <LeagueMark league={league} as="eyebrow" />
          <h1 className="mt-2 text-4xl sm:text-5xl">Run the room</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={connected ? 'live' : 'neutral'}>{connected ? 'Feed live' : 'Reconnecting'}</Pill>
          <Pill tone={running ? 'live' : 'neutral'}>{state.status.replace('_', ' ').toLowerCase()}</Pill>
          <button
            type="button"
            className="btn-ghost"
            aria-pressed={muted}
            onClick={() => {
              unlockAudio()
              const next = !muted
              setMuted(next)
              setMutedState(next)
              if (!next) {
                playSold()
                setFirework(Date.now())
              }
            }}
          >
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <Link to="/admin" className="btn-ghost">
            Dashboard
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Note tone="error">{error}</Note>
        </div>
      )}

      {/* Lifecycle controls */}
      <div className="panel mt-5 flex flex-wrap gap-2 p-3">
        {state.status === 'NOT_STARTED' && (
          <button className="btn-primary" disabled={busy} onClick={() => run(() => api.start(league.id))}>
            Start the auction
          </button>
        )}
        {running && (
          <button className="btn-ghost" disabled={busy} onClick={() => run(() => api.pause(league.id))}>
            Pause
          </button>
        )}
        {paused && (
          <button className="btn-primary" disabled={busy} onClick={() => run(() => api.resume(league.id))}>
            Resume
          </button>
        )}
        <button
          className="btn-primary"
          disabled={busy || !running || onBlock}
          onClick={() => run(() => api.nextPlayer(league.id))}
          title="Shortcut: N"
        >
          Next player
        </button>
        <button
          className="btn-ghost"
          disabled={busy || onBlock || state.remaining_in_pool > 0}
          onClick={() => run(() => api.nextRound(league.id))}
        >
          Bring back unsold
        </button>
        <button
          className="btn-ghost ml-auto"
          disabled={busy}
          onClick={() => run(() => api.undoSale(league.id))}
        >
          Undo last sale
        </button>
        <button
          className="btn-ghost"
          disabled={busy || state.status === 'COMPLETED'}
          onClick={() => {
            if (window.confirm('Close the auction? No further players can be called.'))
              run(() => api.complete(league.id))
          }}
        >
          Close the auction
        </button>
      </div>

      <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col">
          <BlockCard state={state} contact={contact} />

          {/* The four ways a player leaves the block. */}
          <div className="panel mt-4 p-3">
            <Eyebrow>Close this player</Eyebrow>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                className="btn-primary"
                disabled={busy || !state.current_bid}
                onClick={() => run(() => api.sold(league.id))}
                title="Shortcut: S"
              >
                Sold — {money(state.current_bid)}
              </button>
              <button
                className="btn-danger"
                disabled={busy || !onBlock}
                onClick={() => run(() => api.unsold(league.id))}
                title="Shortcut: U"
              >
                Unsold
              </button>

              {/* Retention needs a squad, so it carries its own picker. */}
              <span className="inline-flex items-center gap-1.5">
                <select
                  className="field !w-40"
                  value={retainTeam}
                  disabled={!onBlock}
                  aria-label="Squad retaining this player"
                  onChange={(e) => setRetainTeam(e.target.value ? Number(e.target.value) : '')}
                >
                  <option value="">Retain for…</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn-ghost"
                  disabled={busy || !onBlock || !retainTeam}
                  onClick={() =>
                    run(async () => {
                      await api.retainCurrent(league.id, Number(retainTeam))
                      setRetainTeam('')
                    })
                  }
                  title={settings ? `Charges ${money(settings.retain_price)}` : undefined}
                >
                  Retained
                </button>
              </span>

              <button
                className="btn-ghost"
                disabled={busy || !onBlock}
                onClick={() => run(() => api.notAvailable(league.id))}
                title="Absent or withdrawn — can be restored later"
              >
                Not available
              </button>

              <button
                className="btn-ghost ml-auto"
                disabled={busy || state.bid_history.length === 0}
                onClick={() => run(() => api.undoBid(league.id))}
              >
                Undo last bid
              </button>
            </div>
            {settings && (
              <p className="mt-2 text-[0.7rem] text-muted">
                Retained charges {money(settings.retain_price)} to the squad and counts against
                their {settings.max_retained} retentions. Not available takes the player out of the
                auction and can be undone from the players list.
              </p>
            )}
          </div>

          {/* Direct sale: for rooms where bids are called out loud and only
              the result gets typed in. */}
          <div className="panel mt-4 p-4">
            <Eyebrow>Record a finished sale</Eyebrow>
            <p className="mt-1.5 text-sm text-muted">
              Pick the squad, type the winning price, sell. The same purse and squad limits apply, and
              it still goes into the bid history.
            </p>
            <form
              className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_auto]"
              onSubmit={(event) => {
                event.preventDefault()
                const price = Number(directPrice)
                if (!directTeam || !price) return
                run(async () => {
                  await api.sellDirect(league.id, Number(directTeam), price)
                  setDirectTeam('')
                  setDirectPrice('')
                })
              }}
            >
              <select
                className="field"
                value={directTeam}
                onChange={(e) => setDirectTeam(e.target.value ? Number(e.target.value) : '')}
                disabled={!onBlock}
                aria-label="Winning squad"
              >
                <option value="">Which squad?</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} — {money(team.remaining_purse)} left
                  </option>
                ))}
              </select>
              <input
                className="field"
                inputMode="numeric"
                placeholder="30000"
                aria-label="Sold price"
                value={directPrice}
                disabled={!onBlock}
                onChange={(e) => setDirectPrice(e.target.value.replace(/\D/g, ''))}
              />
              <button
                className="btn-primary"
                disabled={busy || !onBlock || !directTeam || !directPrice}
              >
                Sell {directPrice ? money(Number(directPrice)) : ''}
              </button>
            </form>
          </div>

          {/* End-of-night tidy-up: search by mobile, pick a squad, done. */}
          <details className="panel mt-4 p-4">
            <summary className="cursor-pointer">
              <span className="eyebrow">Add an unsold player to a squad</span>
            </summary>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              For after the last player has been called — someone a squad has since agreed to
              take. Search by mobile number or name. The purse and squad limits still apply, and
              it goes into the bid history like any other sale.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="field !w-56"
                inputMode="numeric"
                placeholder="Mobile number"
                aria-label="Search by mobile number"
                value={mopQuery}
                onChange={(e) => setMopQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              />
              <button
                type="button"
                className="btn-ghost"
                disabled={searching || mopQuery.trim().length < 3}
                onClick={async () => {
                  setSearching(true)
                  setError(null)
                  try {
                    const rows = await api.players(league.id, { q: mopQuery.trim(), limit: 25 })
                    // Anyone already in a squad isn't available to place.
                    setMopResults(rows.filter((r) => !r.team))
                    setMopPicked(null)
                  } catch (err) {
                    setError((err as Error).message)
                  } finally {
                    setSearching(false)
                  }
                }}
              >
                {searching ? 'Searching' : 'Search'}
              </button>
            </div>

            {mopResults.length > 0 && (
              <ul className="mt-3 max-h-52 divide-y divide-line overflow-auto">
                {mopResults.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setMopPicked(row)}
                      className={`flex w-full items-center gap-3 px-1 py-2 text-left transition ${
                        mopPicked?.id === row.id ? 'text-amber' : 'hover:text-amber'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                      <span className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                        {row.mobile ?? '—'} · {row.status.replace('_', ' ').toLowerCase()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {mopQuery && !searching && mopResults.length === 0 && (
              <p className="mt-3 text-sm text-muted">
                Nobody unplaced matches that. Players already in a squad don't appear here.
              </p>
            )}

            {mopPicked && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-sm">
                  Placing <span className="font-semibold text-amber">{mopPicked.name}</span>
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_auto]">
                  <select
                    className="field"
                    value={mopTeam}
                    aria-label="Squad"
                    onChange={(e) => setMopTeam(e.target.value ? Number(e.target.value) : '')}
                  >
                    <option value="">Which squad?</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name} — {money(team.remaining_purse)} left
                      </option>
                    ))}
                  </select>
                  <input
                    className="field"
                    inputMode="numeric"
                    aria-label="Price"
                    placeholder={String(settings?.base_price ?? 1000)}
                    value={mopPrice}
                    onChange={(e) => setMopPrice(e.target.value.replace(/\D/g, ''))}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || !mopTeam}
                    onClick={() =>
                      run(async () => {
                        await api.assignPlayer(
                          league.id,
                          mopPicked.id,
                          Number(mopTeam),
                          mopPrice ? Number(mopPrice) : undefined,
                        )
                        setMopPicked(null)
                        setMopResults([])
                        setMopQuery('')
                        setMopPrice('')
                        setMopTeam('')
                      })
                    }
                  >
                    Add to squad
                  </button>
                </div>
                <p className="mt-2 text-[0.7rem] text-muted">
                  Leave the price blank to use the base price of{' '}
                  {money(settings?.base_price ?? 1000)}.
                </p>
              </div>
            )}
          </details>

          <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
            Shortcuts — N next player · S sold · U unsold. Next bid {money(nextAmount)}
            {settings && ` · increment ${money(settings.bid_increment)}`}. For a price that
            isn't on the ladder, use Record a finished sale below.
          </p>
        </div>

        {/* Bidding paddles: one per team, disabled when the purse can't cover it. */}
        <aside className="panel flex flex-col justify-center gap-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Eyebrow>Bid for a squad</Eyebrow>
            <span className="money text-xl font-bold text-amber">{money(nextAmount)}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {teams.map((team) => {
              const eligible =
                onBlock &&
                running &&
                state.eligible_team_ids.includes(team.id) &&
                team.id !== state.current_team?.id
              return (
                <TeamPaddle
                  key={team.id}
                  team={team}
                  leading={team.id === state.current_team?.id}
                  eligible={eligible && !busy}
                  size="lg"
                  reason={
                    !onBlock
                      ? 'No player is on the block'
                      : team.id === state.current_team?.id
                        ? `${team.name} already holds the top bid`
                        : `${team.name} can't cover ${money(nextAmount)}`
                  }
                  onBid={() => run(() => api.bid(league.id, team.id))}
                />
              )
            })}
          </div>
        </aside>
      </div>
    </div>
  )
}
