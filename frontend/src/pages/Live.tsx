import { useEffect, useState } from 'react'

import { BlockCard } from '../components/BlockCard'
import { Fireworks } from '../components/Fireworks'
import { Link } from 'react-router-dom'

import { Empty, Eyebrow, LeagueMark, Loading, Pill, TeamBadge, TeamPaddle } from '../components/ui'
import { money, useAuth, useLiveAuction, type Hammer } from '../lib/hooks'
import { useLeague } from '../lib/league'
import { isMuted, preloadSounds, playSold, playUnsold, setMuted, unlockAudio } from '../lib/sound'

/** A short banner when the hammer falls, so late-glancers don't miss a sale. */
function HammerBanner({ hammer }: { hammer: Hammer | null }) {
  const [shown, setShown] = useState<Hammer | null>(null)

  useEffect(() => {
    if (!hammer) return
    setShown(hammer)
    const id = window.setTimeout(() => setShown(null), 6000)
    return () => window.clearTimeout(id)
  }, [hammer])

  if (!shown) return null
  const { sold, player } = shown

  return (
    <div
      role="status"
      className={`panel mb-4 flex flex-wrap items-center gap-3 border-l-4 p-4 ${
        sold ? 'border-l-amber' : 'border-l-cherry'
      }`}
    >
      <span
        className={`font-display text-4xl uppercase leading-none ${sold ? 'text-amber' : 'text-cherry'}`}
      >
        {sold ? 'Sold' : 'Unsold'}
      </span>
      <span className="font-display text-2xl uppercase leading-none tracking-tightest">{player.name}</span>
      {sold && player.team && (
        <span className="flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-eyebrow text-muted">
          to <TeamBadge team={player.team} size="xs" />
          <span className="text-amber">{money(player.sold_price)}</span>
        </span>
      )}
    </div>
  )
}

export function Live() {
  const { league, loading } = useLeague()
  const { email, name, isAdmin, ready } = useAuth()
  const { state, teams, connected, hammer } = useLiveAuction(email ? (league?.id ?? null) : null)
  const [muted, setMutedState] = useState(isMuted())
  const [firework, setFirework] = useState<number | null>(null)

  // Browsers won't play anything until the visitor has interacted, so the
  // first tap anywhere on the page unlocks the audio context.
  useEffect(() => {
    const unlock = () => {
      unlockAudio()
      preloadSounds()
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (!hammer) return
    if (hammer.sold) {
      playSold()
      setFirework(hammer.id)
    } else {
      playUnsold()
    }
  }, [hammer])

  if (loading || !ready) return <Loading label="Opening the auction room" />

  // The room is for the people in the auction, not the whole internet.
  if (!email)
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <Eyebrow>Squad owners and organisers</Eyebrow>
        <h1 className="mt-2 text-5xl">Sign in to watch</h1>
        <p className="mt-4 text-muted">
          The live auction is open to squad owners while it's running. The organisers share one
          id and password — ask them for it.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/admin/login" className="btn-primary">
            Sign in
          </Link>
          <Link to="/leagues" className="btn-ghost">
            See past results
          </Link>
        </div>
        <p className="mt-6 text-[0.7rem] text-muted">
          Results are public once an auction finishes — no login needed for those.
        </p>
      </div>
    )

  if (!league)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Empty title="No league selected" hint="Pick a league from the Leagues page first." />
      </div>
    )
  if (!state) return <Loading label="Connecting to the live feed" />

  const leadingTeamId = state.current_team?.id

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Fireworks trigger={firework} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <LeagueMark league={league} as="eyebrow" />
          <h1 className="mt-2 text-4xl sm:text-5xl">Auction room</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={connected ? 'live' : 'neutral'}>{connected ? 'Live feed' : 'Reconnecting'}</Pill>
          <Pill>{state.remaining_in_pool} players left</Pill>
          {name && <Pill tone={isAdmin ? 'sold' : 'kept'}>{isAdmin ? 'Organiser' : 'Watching'}</Pill>}
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5"
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
        </div>
      </div>

      <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col">
          <HammerBanner hammer={hammer} />
          <BlockCard state={state} />
        </div>

        {/* The board sits level with the block card and fills the same height,
            so the two read as one screen rather than a card with a list
            hanging off it. */}
        <aside className="panel flex flex-col justify-center gap-3 p-4">
          <Eyebrow>Purse board</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {teams.map((team) => (
              <TeamPaddle
                key={team.id}
                team={team}
                leading={team.id === leadingTeamId}
                size="lg"
              />
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
