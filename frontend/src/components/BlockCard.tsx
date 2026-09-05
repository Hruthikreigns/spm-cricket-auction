import { ROLE_LABEL, money } from '../lib/hooks'
import type { AuctionState } from '../lib/types'
import { TeamBadge } from './ui'

/**
 * The one screen everyone in the room looks at. Everything else on the page
 * stays quiet so this can be loud: the jersey number is set as a ghosted
 * numeral behind the portrait, and the live figure is mono and enormous.
 */
export function BlockCard({
  state,
  contact,
}: {
  state: AuctionState
  /** Phone number, passed in only on the organiser's console. */
  contact?: string | null
}) {
  const player = state.current_player

  if (!player) {
    return (
      <div className="panel crease floodlight relative flex min-h-[22rem] flex-col items-center justify-center gap-3 overflow-hidden px-6 text-center">
        <h2 className="text-4xl sm:text-6xl">Nobody on the block</h2>
        <p className="max-w-sm text-sm text-muted">
          {state.status === 'RUNNING'
            ? `${state.remaining_in_pool} players left.`
            : state.status === 'PAUSED'
              ? 'The auction is paused.'
              : state.status === 'COMPLETED'
                ? 'That is the last of them — the auction is done.'
                : 'The auction has not started yet.'}
        </p>
      </div>
    )
  }

  return (
    <article className="panel floodlight relative overflow-hidden">
      {/* Jersey number as the backdrop — structure that carries real data. */}
      {player.jersey_number != null && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-16 select-none font-display text-[16rem] font-black leading-none text-ink opacity-[0.05] sm:text-[22rem]"
        >
          {player.jersey_number}
        </span>
      )}

      <div className="relative grid gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="relative aspect-[3/4] w-full max-w-[15rem] overflow-hidden rounded-sm border border-line bg-raised">
          {player.photo_url ? (
            <img src={player.photo_url} alt={player.name} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-7xl text-line">
              {player.jersey_number ?? '—'}
            </span>
          )}
          <span className="absolute bottom-0 left-0 bg-amber px-2 py-1 font-mono text-[0.6rem] uppercase tracking-eyebrow"
          style={{ color: 'var(--on-accent)' }}>
            {ROLE_LABEL[player.role]}
          </span>
        </div>

        <div className="flex min-w-0 flex-col">
          <h2 className="mt-3 break-words text-5xl font-black sm:text-7xl">{player.name}</h2>

          {/* Role, place and number, set large enough to read from the back of
              the room — this is what the auctioneer calls out. */}
          <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4">
            <div>
              <dt className="eyebrow">Role</dt>
              <dd className="mt-1 font-display text-2xl uppercase leading-none tracking-tightest text-amber sm:text-3xl">
                {ROLE_LABEL[player.role]}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Place</dt>
              <dd className="mt-1 font-display text-2xl uppercase leading-none tracking-tightest sm:text-3xl">
                {player.place ?? '—'}
              </dd>
            </div>
            {contact && (
              <div>
                <dt className="eyebrow">Mobile</dt>
                <dd className="money mt-1 text-2xl font-bold leading-none sm:text-3xl">{contact}</dd>
              </div>
            )}
          </dl>

          {(player.batting_style || player.bowling_style || player.age != null) && (
            <p className="mt-4 font-mono text-[0.7rem] uppercase tracking-eyebrow text-muted">
              {[
                player.age != null ? `${player.age} yrs` : null,
                player.batting_style,
                player.bowling_style,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}

          <div className="mt-auto pt-6">
            {state.current_team ? (
              <div className="flex items-center gap-2">
                <span className="eyebrow">Top bid</span>
                <TeamBadge team={state.current_team} size="sm" />
              </div>
            ) : (
              <p className="eyebrow">Opening price</p>
            )}
            <p
              key={state.current_bid ?? 'opening'}
              className="money animate-snap text-5xl font-bold text-amber sm:text-6xl"
            >
              {money(state.current_bid ?? state.next_bid_amount)}
            </p>
          </div>
        </div>
      </div>

      {/* Bid ladder: newest first, so the room can follow the run-up. */}
      {state.bid_history.length > 0 && (
        <div className="relative border-t border-line px-5 py-3 sm:px-8">
          <p className="eyebrow mb-2">Bidding</p>
          <ol className="flex flex-wrap gap-x-4 gap-y-1">
            {state.bid_history.slice(0, 8).map((bid) => (
              <li
                key={bid.id}
                className={`flex items-center gap-1.5 font-mono text-xs ${
                  bid.voided ? 'text-muted line-through opacity-60' : 'text-ink'
                }`}
              >
                {bid.team && <TeamBadge team={bid.team} size="xs" tone="muted" />}
                {money(bid.amount)}
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}
