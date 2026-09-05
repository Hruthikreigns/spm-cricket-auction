import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import { Eyebrow, LeagueMark, Loading, Note, Pill } from '../components/ui'
import { ApiError, api } from '../lib/api'
import { ROLE_LABEL, useAsync } from '../lib/hooks'
import { useLeague } from '../lib/league'
import type { PlayerRole } from '../lib/types'

const ROLES: PlayerRole[] = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER']
const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * Which league am I registering for?
 *
 * Only leagues actually taking entries are offered — a closed one on the list
 * would just be a dead end. Picking one goes to /register/<id>, so the choice
 * is in the address and can be shared directly.
 */
function ChooseLeague() {
  const { leagues, loading } = useLeague()
  const open = leagues.filter((l) => l.status === 'UPCOMING' && l.registration_open !== false)

  if (loading) return <Loading label="Finding open leagues" />

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <Eyebrow>Player registration</Eyebrow>
      <h1 className="mt-2 text-5xl sm:text-6xl">Choose your league</h1>

      {open.length === 0 ? (
        <div className="panel mt-8 p-6 text-center">
          <h2 className="text-3xl">Nothing open right now</h2>
          <p className="mt-3 text-sm text-muted">
            No league is taking registrations at the moment. Check back, or ask the organisers.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-4 max-w-xl text-muted">
            These leagues are taking entries. Pick the one you're playing in.
          </p>
          <div className="mt-6 grid gap-3">
            {open.map((item) => (
              <Link
                key={item.id}
                to={`/register/${item.id}`}
                className="panel flex flex-wrap items-center gap-4 p-5 transition hover:border-amber"
              >
                <LeagueMark league={item} size="md" />
                <div className="ml-auto text-right">
                  <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                    {item.season ? `Season ${item.season}` : ''}
                    {item.auction_date
                      ? ` · ${new Date(item.auction_date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}`
                      : ''}
                  </p>
                  <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-eyebrow text-amber">
                    Register →
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * The page players are sent to. No account, no login — a link and a form.
 * Nothing submitted here reaches the auction pool until an organiser
 * approves it.
 */
export function Register() {
  const params = useParams()
  const { league: current, loading: leaguesLoading } = useLeague()

  // /register/12 names a league; a bare /register uses whichever league the
  // site is currently following.
  const paramId = params.leagueId ? Number(params.leagueId) : null
  const leagueId = paramId ?? current?.id ?? null

  // Fetched by id rather than looked up in the cached list: a player opening
  // this link has no reason to have loaded the league list first, and on a
  // cold page the list is still in flight.
  const leagueQuery = useAsync(
    () => (leagueId ? api.league(leagueId) : Promise.resolve(null)),
    [leagueId],
  )
  const league = leagueQuery.data

  const status = useAsync(
    () =>
      leagueId
        ? fetch(`${BASE}/api/leagues/${leagueId}/registrations/status`).then((r) => r.json())
        : Promise.resolve(null),
    [leagueId],
  )

  const [form, setForm] = useState({
    name: '',
    mobile: '',
    email: '',
    place: '',
    role: 'BATSMAN' as PlayerRole,
  })
  const [known, setKnown] = useState<{
    found: boolean
    name?: string | null
    role?: PlayerRole | null
    place?: string | null
    jersey_number?: number | null
    photo_url?: string | null
    email_masked?: string | null
    last_league?: string | null
  } | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ name: string; card_url: string } | null>(null)

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  // Registration wears its own palette. The site's chosen theme is restored
  // when the visitor leaves, so this doesn't change what they picked.
  useEffect(() => {
    const root = document.documentElement
    const previous = root.dataset.theme
    root.dataset.theme = 'register'
    return () => {
      root.dataset.theme = previous ?? 'night'
    }
  }, [])

  // Once a full number is typed, see whether they've registered before and
  // fill in what we already know. Debounced, because this fires as they type.
  useEffect(() => {
    const digits = form.mobile.replace(/\D/g, '')
    if (!leagueId || digits.length < 10) {
      setKnown(null)
      return
    }
    let live = true
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `${BASE}/api/leagues/${leagueId}/registrations/lookup?mobile=${digits}`,
        )
        const body = await res.json()
        if (!live || !body.found) return
        setKnown(body)
        // Prefill only empty fields, so anything they've already typed stands.
        setForm((f) => ({
          ...f,
          name: f.name || body.name || '',
          role: (body.role as PlayerRole) ?? f.role,
          place: f.place || body.place || '',
        }))
      } catch {
        /* a failed lookup just means they fill it in themselves */
      }
    }, 400)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [form.mobile, leagueId])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (form.mobile.replace(/\D/g, '').length !== 10) {
      setError('Please enter a ten-digit mobile number.')
      return
    }
    if (!photo && !known?.photo_url) {
      setError('Please add a photo — it goes on the screen when you come up for auction.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('name', form.name.trim())
      body.append('mobile', form.mobile.trim())
      body.append('email', form.email.trim())
      body.append('role', form.role)
      if (form.place.trim()) body.append('place', form.place.trim())
      if (photo) body.append('photo', photo)

      const res = await fetch(`${BASE}/api/leagues/${leagueId}/registrations`, {
        method: 'POST',
        body,
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new ApiError(detail.detail ?? 'That registration could not be saved.', res.status)
      }
      const receipt = await res.json()
      setDone({ name: form.name.trim(), card_url: receipt.card_url })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Wait for both the league context and the direct lookup before deciding
  // anything is wrong — otherwise the first paint claims the link is broken.
  if (leaguesLoading || leagueQuery.loading || status.loading)
    return <Loading label="Opening the form" />

  // A bare /register with no league named: show what's open and let them pick.
  if (!paramId) return <ChooseLeague />

  if (!leagueId || !league)
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-4xl">League not found</h1>
        <p className="mt-3 text-muted">
          This link points at a league that no longer exists. Check it with whoever sent it to
          you.
        </p>
        <Link to="/register" className="btn-ghost mt-6">
          See what's open
        </Link>
      </div>
    )

  if (done)
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <Pill tone="live">Registered</Pill>
        <h1 className="mt-4 text-5xl">You're in, {done.name.split(' ')[0]}</h1>
        <p className="mt-4 text-muted">
          The organisers will confirm your entry before auction day. Keep an eye on your phone —
          they'll use the number you gave.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {/* Downloading, not opening: on a phone this lands in Files where
              they can find it again on auction day. */}
          <a className="btn-primary" href={`${BASE}${done.card_url}`} download>
            Download your registration card
          </a>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setDone(null)
              setForm({ ...form, name: '', mobile: '', email: '' })
              setPhoto(null)
              setPreview(null)
            }}
          >
            Register someone else
          </button>
        </div>

        <p className="mt-4 text-[0.7rem] text-muted">
          Keep the card — show it at the ground on auction day.
        </p>
      </div>
    )

  const open = status.data?.open !== false

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      {/* The poster does the selling — prizes, dates, ground — so it goes
          above everything, before a word of form. */}
      {league.poster_url && (
        <img
          src={league.poster_url}
          alt={`${league.name} tournament poster`}
          className="mb-8 w-full rounded-sm border border-line"
        />
      )}

      <LeagueMark league={league} size="md" />
      <h1 className="mt-3 text-5xl sm:text-6xl">Player registration</h1>
      <p className="mt-4 max-w-xl text-muted">
        Fill this in to enter the auction pool. It takes a minute, and you don't need an account.
      </p>

      {!open ? (
        <div className="panel mt-8 p-6 text-center">
          <h2 className="text-3xl">Registration has closed</h2>
          <p className="mt-3 text-sm text-muted">
            {status.data?.league_status === 'UPCOMING'
              ? 'The organisers have closed entries for now. Check back, or ask them directly.'
              : 'The player list for this league is final. Talk to the organisers if you think this is a mistake.'}
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="panel mt-8 space-y-5 p-5 sm:p-6">
          {/* Mobile first: it's the key we look them up by, so a returning
              player fills one box and the rest arrives. */}
          <label className="block">
            <span className="eyebrow">Mobile number *</span>
            <input
              className="field mt-1.5"
              required
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="9876543210"
              maxLength={10}
              pattern="[0-9]{10}"
              value={form.mobile}
              // Digits only, ten at most: anything else is a typo, and
              // stripping as they type beats an error after they submit.
              onChange={(e) => set('mobile')(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
            <span className="mt-1 block text-[0.7rem] text-muted">
              {form.mobile.length > 0 && form.mobile.length < 10
                ? `${10 - form.mobile.length} more digit${10 - form.mobile.length === 1 ? '' : 's'}`
                : 'Ten digits. The organisers will contact you on this.'}
            </span>
          </label>

          {known?.found && (
            <div className="panel border-amber/60 p-4">
              <p className="eyebrow text-amber">Welcome back</p>
              <p className="mt-1.5 text-sm">
                We have you from{' '}
                <span className="text-ink">{known.last_league ?? 'a previous league'}</span>.
                Your details are filled in below — check them and change anything that's out of
                date.
              </p>
              {known.email_masked && (
                <p className="mt-1.5 text-[0.7rem] text-muted">
                  Email on file: {known.email_masked} — leave the box blank to keep it.
                </p>
              )}
            </div>
          )}

          <label className="block">
            <span className="eyebrow">Player name *</span>
            <input
              className="field mt-1.5"
              required
              minLength={2}
              autoComplete="name"
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="eyebrow">Email {known?.email_masked ? '' : '*'}</span>
            <input
              className="field mt-1.5"
              required={!known?.email_masked}
              type="email"
              autoComplete="email"
              placeholder={known?.email_masked ?? 'you@example.com'}
              value={form.email}
              onChange={(e) => set('email')(e.target.value)}
            />
            <span className="mt-1 block text-[0.7rem] text-muted">
              {known?.email_masked
                ? 'Leave blank to keep the address we have.'
                : 'One entry per email address.'}
            </span>
          </label>

          <label className="block">
            <span className="eyebrow">Playing role *</span>
            <select
              className="field mt-1.5"
              value={form.role}
              onChange={(e) => set('role')(e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="eyebrow">Photo {known?.photo_url ? '' : '*'}</span>
            <input
              className="field mt-1.5"
              type="file"
              required={!known?.photo_url}
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null
                setPhoto(file)
                setPreview(file ? URL.createObjectURL(file) : null)
              }}
            />
            <span className="mt-1 block text-[0.7rem] text-muted">
              {known?.photo_url
                ? "We'll keep your last photo unless you upload a new one."
                : 'Required — this is what the room sees when you come up for auction.'}
            </span>
          </label>

          {(preview || known?.photo_url) && (
            <div className="flex items-center gap-3">
              <img
                src={preview ?? `${BASE}${known?.photo_url}`}
                alt=""
                className="h-32 w-24 rounded-sm border border-line object-cover"
              />
              {!preview && known?.photo_url && (
                <span className="text-[0.7rem] text-muted">Your photo from last time</span>
              )}
            </div>
          )}

          <label className="block">
            <span className="eyebrow">Place *</span>
            <input
              className="field mt-1.5"
              required
              value={form.place}
              onChange={(e) => set('place')(e.target.value)}
              placeholder="Tirupati"
            />
          </label>

          {error && <Note tone="error">{error}</Note>}

          <button className="btn-primary w-full" disabled={busy || (!photo && !known?.photo_url)}>
            {busy ? 'Sending' : 'Register for the auction'}
          </button>

          <p className="text-center text-[0.7rem] text-muted">
            Your details go to the league organisers so they can run the auction and contact you.
          </p>
        </form>
      )}
    </div>
  )
}
