import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../lib/api'
import { ROLE_LABEL } from '../lib/hooks'
import type { Player, PlayerRole } from '../lib/types'
import { Avatar, Eyebrow, Note } from './ui'

const ROLES: PlayerRole[] = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER']
const BATTING = ['Right hand bat', 'Left hand bat']
const BOWLING = [
  'Right arm fast',
  'Right arm medium',
  'Right arm off break',
  'Left arm fast',
  'Left arm medium',
  'Left arm orthodox',
  'Leg break',
  "Doesn't bowl",
]

const EMPTY = {
  name: '',
  mobile: '',
  place: '',
  role: 'BATSMAN' as PlayerRole,
  jersey_number: '',
  age: '',
  batting_style: '',
  bowling_style: '',
}

/**
 * Adding a player by hand.
 *
 * The spreadsheet import handles the bulk; this is for the ones that arrive
 * another way — a walk-in at the desk, a late entry phoned through, someone
 * whose row was wrong. It stays open after each save with the place and role
 * kept, because these arrive in batches from the same club.
 */
export function AddPlayerPanel({
  leagueId,
  onChange,
  onError,
}: {
  leagueId: number
  onChange: (text: string) => void
  onError: (err: unknown) => void
}) {
  const [form, setForm] = useState(EMPTY)
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<Player[]>([])
  const [total, setTotal] = useState<number | null>(null)

  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }))

  const countPlayers = () =>
    api
      .players(leagueId, { limit: 1000 })
      .then((rows) => setTotal(rows.length))
      .catch(() => setTotal(null))

  useEffect(() => {
    void countPlayers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  const pickPhoto = (file: File | null) => {
    if (!file) {
      setPhoto(null)
      setPreview(null)
      return
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      onError(new Error('Photos need to be JPG, PNG or WEBP.'))
      return
    }
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      // Upload first, so a failed image doesn't leave a player with no photo
      // and no obvious way to tell.
      let photo_url: string | null = null
      if (photo) photo_url = (await api.uploadImage('players', photo)).url

      const created = await api.createPlayer(leagueId, {
        name: form.name.trim(),
        mobile: form.mobile.replace(/\D/g, '') || null,
        place: form.place.trim() || null,
        role: form.role,
        jersey_number: form.jersey_number ? Number(form.jersey_number) : null,
        age: form.age ? Number(form.age) : null,
        batting_style: form.batting_style || null,
        bowling_style: form.bowling_style || null,
        photo_url,
      })

      onChange(`${created.name} added to the pool.`)
      setRecent((list) => [created, ...list].slice(0, 6))
      // Keep place and role — walk-ins tend to arrive from the same club.
      setForm({ ...EMPTY, place: form.place, role: form.role })
      pickPhoto(null)
      await countPlayers()
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-5">
      <Eyebrow>One at a time</Eyebrow>
      <h2 className="mt-2 text-3xl">Add a player</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        For walk-ins and late entries. Duplicate names and mobile numbers are refused, so
        re-adding someone already in the pool is safe to try.
        {total !== null && (
          <>
            {' '}
            <span className="text-ink">{total} players</span> in this league so far.
          </>
        )}
      </p>

      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="eyebrow">Player name *</span>
            <input
              className="field mt-1.5"
              required
              minLength={2}
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Mobile</span>
            <input
              className="field mt-1.5"
              inputMode="numeric"
              placeholder="9876543210"
              value={form.mobile}
              onChange={(e) => set('mobile')(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Place</span>
            <input
              className="field mt-1.5"
              value={form.place}
              onChange={(e) => set('place')(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Role</span>
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
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="eyebrow">Jersey</span>
            <input
              className="field mt-1.5"
              inputMode="numeric"
              value={form.jersey_number}
              onChange={(e) => set('jersey_number')(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Age</span>
            <input
              className="field mt-1.5"
              inputMode="numeric"
              value={form.age}
              onChange={(e) => set('age')(e.target.value.replace(/\D/g, '').slice(0, 2))}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Batting</span>
            <select
              className="field mt-1.5"
              value={form.batting_style}
              onChange={(e) => set('batting_style')(e.target.value)}
            >
              <option value="">Not given</option>
              {BATTING.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="eyebrow">Bowling</span>
            <select
              className="field mt-1.5"
              value={form.bowling_style}
              onChange={(e) => set('bowling_style')(e.target.value)}
            >
              <option value="">Not given</option>
              {BOWLING.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <label className="block">
            <span className="eyebrow">Photo</span>
            <input
              className="field mt-1.5"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
            />
          </label>
          {preview ? (
            <img src={preview} alt="" className="h-14 w-11 rounded-sm border border-line object-cover" />
          ) : (
            <div className="flex h-14 w-11 items-center justify-center rounded-sm border border-dashed border-line text-[0.55rem] text-muted">
              photo
            </div>
          )}
          <button className="btn-primary" disabled={busy || form.name.trim().length < 2}>
            {busy ? 'Adding' : 'Add player'}
          </button>
        </div>
      </form>

      {recent.length > 0 && (
        <div className="mt-5 border-t border-line pt-4">
          <Eyebrow>Just added</Eyebrow>
          <ul className="mt-2 divide-y divide-line">
            {recent.map((player) => (
              <li key={player.id} className="flex items-center gap-3 py-2">
                <Avatar
                  name={player.name}
                  src={player.photo_url}
                  jersey={player.jersey_number}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{player.name}</span>
                <span className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                  {ROLE_LABEL[player.role]}
                  {player.place && ` · ${player.place}`}
                </span>
              </li>
            ))}
          </ul>
          <Note>
            These go straight into the auction pool — no approval needed, unlike registrations.
          </Note>
        </div>
      )}
    </section>
  )
}
