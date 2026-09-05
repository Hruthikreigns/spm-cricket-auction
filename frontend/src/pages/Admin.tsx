import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { AddPlayerPanel } from '../components/AddPlayerPanel'
import { BrandingPanel } from '../components/BrandingPanel'
import { ViewerAccessPanel } from '../components/ViewerAccessPanel'
import { RegistrationsPanel } from '../components/RegistrationsPanel'
import { Avatar, Empty, Eyebrow, Loading, Note, Pill, Stat } from '../components/ui'
import { api } from '../lib/api'
import { ROLE_LABEL, money, shortMoney, useAsync, useAuth } from '../lib/hooks'
import { useLeague } from '../lib/league'
import type { AuctionSettings, ImportReport, PlayerRole, Team } from '../lib/types'

const CHART_COLOURS = ['#ffb020', '#d4453a', '#e3cfa0', '#5aa9e6', '#7bc47f', '#b58cd6']

// --------------------------------------------------------------------------
export function AdminLogin() {
  const { signIn, email, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Owners have nothing to do in the admin area, so they go to the room.
    if (email) navigate(isAdmin ? '/admin' : '/live', { replace: true })
  }, [email, isAdmin, navigate])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const role = await signIn(form.email.trim(), form.password)
      navigate(role === 'admin' ? '/admin' : '/live', { replace: true })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-20">
      <Eyebrow>Organisers and squad owners</Eyebrow>
      <h1 className="mt-2 text-5xl">Sign in</h1>
      <p className="mt-3 text-sm text-muted">
        Squad owners sign in here to watch the auction live. Organisers get the console as well.
        If you own a squad and don't have a login yet, ask the organisers for one.
      </p>

      <form onSubmit={submit} className="panel mt-8 space-y-4 p-5">
        <label className="block">
          <span className="eyebrow">Email</span>
          <input
            className="field mt-1.5"
            type="email"
            autoComplete="username"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="eyebrow">Password</span>
          <input
            className="field mt-1.5"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </label>
        {error && <Note tone="error">{error}</Note>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in' : 'Sign in'}
        </button>
        <Link
          to="/forgot-password"
          className="block text-center text-sm text-muted hover:text-amber"
        >
          Forgotten your password?
        </Link>
      </form>
    </div>
  )
}

// --------------------------------------------------------------------------
export function AdminDashboard() {
  const { league, leagues, select } = useLeague()
  const stats = useAsync(() => (league ? api.analytics(league.id) : Promise.resolve(null)), [league?.id])

  if (!league)
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <Empty title="No league yet" hint="Create one in setup to get started." />
        <div className="mt-4 flex justify-center">
          <Link to="/admin/setup" className="btn-primary">
            Open setup
          </Link>
        </div>
      </div>
    )

  const data = stats.data

  const roleData =
    data?.role_breakdown.map((row) => ({
      name: ROLE_LABEL[row.role as PlayerRole] ?? row.role,
      value: row.total,
      sold: row.sold,
    })) ?? []

  const spendData =
    data?.team_spending.map((row) => ({
      name: row.team_name,
      Spent: row.spent,
      Remaining: row.remaining,
    })) ?? []

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Administration</Eyebrow>
          <div className="mt-2 flex items-center gap-3">
            <Avatar name={league.name} src={league.logo_url} size="md" />
            <h1 className="text-5xl sm:text-6xl">{league.name}</h1>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {leagues.length > 1 && (
            <select
              className="field !w-auto"
              value={league.id}
              onChange={(e) => select(Number(e.target.value))}
            >
              {leagues.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
          <Link to="/admin/setup" className="btn-ghost">
            Setup
          </Link>
          <Link to="/admin/auction" className="btn-primary">
            Open the console
          </Link>
          <a className="btn-ghost" href={api.exportUrl(league.id)}>
            Export results
          </a>
        </div>
      </div>

      {stats.loading && <Loading label="Crunching the numbers" />}
      {stats.error && (
        <div className="mt-4">
          <Note tone="error">{stats.error}</Note>
        </div>
      )}

      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Players" value={data.total_players} hint={`${data.available_players} still in the pool`} />
            <Stat label="Sold" value={data.sold_players} hint={`${data.retained_players} retained`} />
            <Stat label="Unsold" value={data.unsold_players} />
            <Stat label="Squads" value={data.total_teams} />
            <Stat label="Purse left in the room" value={money(data.purse_remaining)} />
            <Stat label="Total spent" value={money(data.total_spent)} />
            <Stat
              label="Highest price"
              value={money(data.highest_bid)}
              hint={data.most_expensive_player?.name}
            />
            <Stat label="Average price" value={money(data.average_price)} hint={`Lowest ${money(data.lowest_bid)}`} />
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <section className="panel p-5">
              <Eyebrow>Where the money went</Eyebrow>
              <h2 className="mt-2 text-3xl">Spend by squad</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={spendData} layout="vertical" margin={{ left: 12, right: 12 }}>
                    <XAxis
                      type="number"
                      tickFormatter={(v) => shortMoney(v)}
                      stroke="var(--muted)"
                      fontSize={11}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      stroke="var(--muted)"
                      fontSize={11}
                    />
                    <Tooltip
                      formatter={(value: number) => money(value)}
                      contentStyle={{
                        background: 'var(--panel)',
                        border: '1px solid var(--line)',
                        borderRadius: 2,
                        color: 'var(--ink)',
                      }}
                    />
                    <Bar dataKey="Spent" stackId="a" fill="var(--amber)" />
                    <Bar dataKey="Remaining" stackId="a" fill="var(--line)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="panel p-5">
              <Eyebrow>The register</Eyebrow>
              <h2 className="mt-2 text-3xl">Roles</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={roleData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95}>
                      {roleData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLOURS[index % CHART_COLOURS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--panel)',
                        border: '1px solid var(--line)',
                        borderRadius: 2,
                        color: 'var(--ink)',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-3 space-y-1">
                {roleData.map((row, index) => (
                  <li key={row.name} className="flex items-center gap-2 text-xs text-muted">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: CHART_COLOURS[index % CHART_COLOURS.length] }}
                    />
                    {row.name}
                    <span className="money ml-auto text-ink">
                      {row.sold}/{row.value} placed
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
export function AdminSetup() {
  const { league, leagues, select, reload } = useLeague()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const say = (text: string) => {
    setMessage(text)
    setError(null)
    window.setTimeout(() => setMessage(null), 5000)
  }
  const fail = (err: unknown) => setError((err as Error).message)

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Before the hammer</Eyebrow>
          <h1 className="mt-1 text-5xl sm:text-6xl">Setup</h1>
        </div>
        {league && (
          <Link to="/admin/auction" className="btn-primary">
            Open the console
          </Link>
        )}
      </div>

      {message && (
        <div className="mt-4">
          <Note>{message}</Note>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Note tone="error">{error}</Note>
        </div>
      )}

      <div className="mt-8 space-y-8">
        <NewLeague
          onDone={(name) => {
            say(`${name} created.`)
            reload()
          }}
          onError={fail}
        />

        {leagues.length > 0 && (
          <section className="panel p-5">
            <Eyebrow>Working on</Eyebrow>
            <select
              className="field mt-2"
              value={league?.id ?? ''}
              onChange={(e) => select(Number(e.target.value))}
            >
              {leagues.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.status.toLowerCase()}
                </option>
              ))}
            </select>
          </section>
        )}

        {league && (
          <>
            <BrandingPanel league={league} onChange={say} onError={fail} />
            <ViewerAccessPanel onChange={say} onError={fail} />
            <RegistrationsPanel
              leagueId={league.id}
              leagueName={league.name}
              onChange={say}
              onError={fail}
            />
            <SettingsPanel leagueId={league.id} onSaved={() => say('Auction settings saved.')} onError={fail} />
            <TeamsPanel leagueId={league.id} onChange={(text) => say(text)} onError={fail} />
            <ImportPanel leagueId={league.id} onDone={(text) => say(text)} onError={fail} />
            <AddPlayerPanel leagueId={league.id} onChange={say} onError={fail} />
            <RetentionPanel leagueId={league.id} onDone={(text) => say(text)} onError={fail} />
          </>
        )}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
function NewLeague({ onDone, onError }: { onDone: (name: string) => void; onError: (e: unknown) => void }) {
  const [form, setForm] = useState({ name: '', season: '', venue: '', auction_date: '' })
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.createLeague({
        name: form.name,
        season: form.season || null,
        venue: form.venue || null,
        auction_date: form.auction_date ? new Date(form.auction_date).toISOString() : null,
      })
      onDone(form.name)
      setForm({ name: '', season: '', venue: '', auction_date: '' })
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-5">
      <Eyebrow>Step one</Eyebrow>
      <h2 className="mt-2 text-3xl">Create a league</h2>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow">League name</span>
          <input
            className="field mt-1.5"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Tirupati Premier League"
          />
        </label>
        <label className="block">
          <span className="eyebrow">Season</span>
          <input
            className="field mt-1.5"
            value={form.season}
            onChange={(e) => setForm({ ...form, season: e.target.value })}
            placeholder="2026"
          />
        </label>
        <label className="block">
          <span className="eyebrow">Venue</span>
          <input
            className="field mt-1.5"
            value={form.venue}
            onChange={(e) => setForm({ ...form, venue: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="eyebrow">Auction date</span>
          <input
            className="field mt-1.5"
            type="date"
            value={form.auction_date}
            onChange={(e) => setForm({ ...form, auction_date: e.target.value })}
          />
        </label>
        <button className="btn-primary sm:col-span-2" disabled={busy}>
          Create league
        </button>
      </form>
    </section>
  )
}

// --------------------------------------------------------------------------
function SettingsPanel({
  leagueId,
  onSaved,
  onError,
}: {
  leagueId: number
  onSaved: () => void
  onError: (e: unknown) => void
}) {
  const [cfg, setCfg] = useState<AuctionSettings | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.settings(leagueId).then(setCfg).catch(onError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  if (!cfg) return null

  const field = (key: keyof AuctionSettings, label: string, hint?: string) => (
    <label className="block">
      <span className="eyebrow">{label}</span>
      <input
        className="field mt-1.5"
        inputMode="numeric"
        value={String(cfg[key])}
        onChange={(e) => setCfg({ ...cfg, [key]: Number(e.target.value.replace(/\D/g, '')) || 0 })}
      />
      {hint && <span className="mt-1 block text-[0.7rem] text-muted">{hint}</span>}
    </label>
  )

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      const saved = await api.updateSettings(leagueId, cfg)
      setCfg(saved)
      onSaved()
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-5">
      <Eyebrow>The rules of the room</Eyebrow>
      <h2 className="mt-2 text-3xl">Auction settings</h2>
      <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-3">
        {field('purse_amount', 'Team purse')}
        {field('min_players', 'Minimum squad')}
        {field('max_players', 'Maximum squad')}
        {field('retain_price', 'Retention price')}
        {field('max_retained', 'Retentions per squad')}
        {field('base_price', 'Base price')}
        {field('bid_increment', 'Bid increment')}

        <label className="flex items-start gap-2 sm:col-span-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={cfg.enforce_squad_reserve}
            onChange={(e) => setCfg({ ...cfg, enforce_squad_reserve: e.target.checked })}
          />
          <span>
            <span className="text-sm text-ink">Hold back money for unfilled slots</span>
            <span className="mt-1 block text-[0.7rem] text-muted">
              A squad below the minimum keeps the base price in reserve for every slot it still has to
              fill, so nobody can spend their way out of a legal squad.
            </span>
          </span>
        </label>

        <button className="btn-primary sm:col-span-3" disabled={busy}>
          Save settings
        </button>
      </form>
    </section>
  )
}

// --------------------------------------------------------------------------
function TeamsPanel({
  leagueId,
  onChange,
  onError,
}: {
  leagueId: number
  onChange: (text: string) => void
  onError: (e: unknown) => void
}) {
  const [teams, setTeams] = useState<Team[]>([])
  const [form, setForm] = useState({
    name: '',
    short_name: '',
    owner_name: '',
    captain_name: '',
    accent_color: '#e4572e',
  })
  const [logo, setLogo] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [edit, setEdit] = useState({ name: '', short_name: '', owner_name: '', captain_name: '' })

  const load = () => api.teams(leagueId).then(setTeams).catch(onError)
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  /** Checked before upload so a bad file fails instantly, not after a round trip. */
  const validate = (file: File): string | null => {
    if (!/^image\/(jpeg|png|webp|svg\+xml)$/.test(file.type))
      return 'Logos need to be JPG, PNG, WEBP or SVG.'
    if (file.size > 5 * 1024 * 1024) return 'That logo is over 5MB. Try a smaller version.'
    return null
  }

  const pickLogo = (file: File | null) => {
    if (!file) {
      setLogo(null)
      setPreview(null)
      return
    }
    const problem = validate(file)
    if (problem) {
      onError(new Error(problem))
      return
    }
    setLogo(file)
    setPreview(URL.createObjectURL(file))
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      // Upload first: if the image fails there's no half-made team to clean up.
      let logo_url: string | null = null
      if (logo) logo_url = (await api.uploadImage('teams', logo)).url

      await api.createTeam(leagueId, {
        name: form.name,
        short_name: form.short_name || null,
        owner_name: form.owner_name || null,
        captain_name: form.captain_name || null,
        accent_color: form.accent_color || null,
        logo_url,
      })
      onChange(`${form.name} added.`)
      setForm({ name: '', short_name: '', owner_name: '', captain_name: '', accent_color: '#e4572e' })
      pickLogo(null)
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  /** Swap the logo on a team that already exists. */
  const replaceLogo = async (team: Team, file: File | null) => {
    if (!file) return
    const problem = validate(file)
    if (problem) {
      onError(new Error(problem))
      return
    }
    setUploadingId(team.id)
    try {
      const { url } = await api.uploadImage('teams', file)
      await api.updateTeam(leagueId, team.id, { logo_url: url })
      onChange(`${team.name} logo updated.`)
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <section className="panel p-5">
      <Eyebrow>Step two</Eyebrow>
      <h2 className="mt-2 text-3xl">Squads</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        The logo shows on the purse board, the squad pages and beside every bid, so it's worth
        adding. A square image works best — anything else gets cropped to fit.
      </p>

      {teams.length > 0 && (
        <ul className="mt-5 divide-y divide-line">
          {teams.map((team) => (
            <li key={team.id} className="flex flex-wrap items-center gap-3 py-3">
              <Avatar name={team.name} src={team.logo_url} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-xl uppercase leading-none tracking-tightest">
                  {team.name}
                </p>
                <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                  {team.owner_name ?? 'No owner listed'} · {team.player_count} players
                  {!team.logo_url && ' · no logo yet'}
                </p>
              </div>
              <span className="money text-sm text-amber">{money(team.remaining_purse)}</span>

              <button
                type="button"
                className="btn-ghost !px-3 !py-1.5"
                onClick={() => {
                  setEdit({
                    name: team.name,
                    short_name: team.short_name ?? '',
                    owner_name: team.owner_name ?? '',
                    captain_name: team.captain_name ?? '',
                  })
                  setEditingId(editingId === team.id ? null : team.id)
                }}
              >
                {editingId === team.id ? 'Close' : 'Edit'}
              </button>

              <label className="btn-ghost cursor-pointer !px-3 !py-1.5">
                {uploadingId === team.id ? 'Uploading' : team.logo_url ? 'Change logo' : 'Add logo'}
                <input
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml"
                  disabled={uploadingId === team.id}
                  onChange={(e) => {
                    void replaceLogo(team, e.target.files?.[0] ?? null)
                    e.target.value = '' // let the same file be picked again after a failure
                  }}
                />
              </label>

              <button
                type="button"
                className="btn-ghost !px-2 !py-1"
                onClick={async () => {
                  if (!window.confirm(`Remove ${team.name}?`)) return
                  try {
                    await api.deleteTeam(leagueId, team.id)
                    onChange(`${team.name} removed.`)
                    await load()
                  } catch (err) {
                    onError(err)
                  }
                }}
              >
                Remove
              </button>

              {editingId === team.id && (
                <div className="mt-3 grid w-full gap-2 border-t border-line pt-3 sm:grid-cols-5">
                  <input
                    className="field"
                    placeholder="Team name"
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Short"
                    maxLength={12}
                    value={edit.short_name}
                    onChange={(e) => setEdit({ ...edit, short_name: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Owner"
                    value={edit.owner_name}
                    onChange={(e) => setEdit({ ...edit, owner_name: e.target.value })}
                  />
                  <input
                    className="field"
                    placeholder="Captain"
                    value={edit.captain_name}
                    onChange={(e) => setEdit({ ...edit, captain_name: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={async () => {
                      try {
                        await api.updateTeam(leagueId, team.id, {
                          name: edit.name.trim(),
                          short_name: edit.short_name.trim() || null,
                          owner_name: edit.owner_name.trim() || null,
                          captain_name: edit.captain_name.trim() || null,
                        })
                        onChange(`${edit.name} updated.`)
                        setEditingId(null)
                        await load()
                      } catch (err) {
                        onError(err)
                      }
                    }}
                  >
                    Save
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-6 border-t border-line pt-5">
        <Eyebrow>Add a squad</Eyebrow>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="field"
            required
            placeholder="Team name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="field"
            placeholder="Short (SPM)"
            maxLength={12}
            value={form.short_name}
            onChange={(e) => setForm({ ...form, short_name: e.target.value })}
          />
          <input
            className="field"
            placeholder="Owner"
            value={form.owner_name}
            onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
          />
          <input
            className="field"
            placeholder="Captain"
            value={form.captain_name}
            onChange={(e) => setForm({ ...form, captain_name: e.target.value })}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <label className="block">
            <span className="eyebrow">Team logo</span>
            <input
              className="field mt-1.5"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              onChange={(e) => pickLogo(e.target.files?.[0] ?? null)}
            />
          </label>

          <label className="block">
            <span className="eyebrow">Squad colour</span>
            <input
              type="color"
              className="mt-1.5 h-11 w-20 cursor-pointer rounded-sm border border-line bg-pitch p-1"
              value={form.accent_color}
              onChange={(e) => setForm({ ...form, accent_color: e.target.value })}
              title="Used for this squad's bar on the purse board"
            />
          </label>

          {preview ? (
            <img
              src={preview}
              alt=""
              className="h-11 w-11 rounded-sm border border-line object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-dashed border-line text-[0.6rem] text-muted">
              logo
            </div>
          )}
        </div>

        <button className="btn-primary mt-4 w-full" disabled={busy}>
          {busy ? 'Adding' : 'Add squad'}
        </button>
      </form>
    </section>
  )
}

// --------------------------------------------------------------------------
function ImportPanel({
  leagueId,
  onDone,
  onError,
}: {
  leagueId: number
  onDone: (text: string) => void
  onError: (e: unknown) => void
}) {
  const [sheet, setSheet] = useState<File | null>(null)
  const [photos, setPhotos] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!sheet) return
    setBusy(true)
    setReport(null)
    try {
      const result = await api.importPlayers(leagueId, sheet, photos)
      setReport(result)
      onDone(`${result.created} players imported.`)
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-5">
      <Eyebrow>Step three</Eyebrow>
      <h2 className="mt-2 text-3xl">Import the register</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        The sheet needs a Player Name column; mobile, place, role, jersey number, age, batting style and
        bowling style are picked up when present. Duplicate names and mobile numbers are reported rather
        than imported. Photos can come as one zip — files are matched on player name or jersey number.
      </p>

      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow">Player sheet (.xlsx)</span>
          <input
            className="field mt-1.5"
            type="file"
            accept=".xlsx,.xls"
            required
            onChange={(e) => setSheet(e.target.files?.[0] ?? null)}
          />
        </label>
        <label className="block">
          <span className="eyebrow">Photos (.zip, optional)</span>
          <input
            className="field mt-1.5"
            type="file"
            accept=".zip"
            onChange={(e) => setPhotos(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="btn-primary sm:col-span-2" disabled={busy || !sheet}>
          {busy ? 'Importing' : 'Import players'}
        </button>
      </form>

      {report && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <Pill tone="sold">{report.created} added</Pill>
            <Pill tone="unsold">{report.skipped} skipped</Pill>
            <Pill tone="kept">{report.photos_matched} photos matched</Pill>
          </div>
          {report.errors.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                What was skipped
              </summary>
              <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-muted">
                {report.errors.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

// --------------------------------------------------------------------------
function RetentionPanel({
  leagueId,
  onDone,
  onError,
}: {
  leagueId: number
  onDone: (text: string) => void
  onError: (e: unknown) => void
}) {
  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<number | ''>('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.teams(leagueId).then(setTeams).catch(onError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  const search = useAsync(
    () => (query.length > 1 ? api.players(leagueId, { q: query, status: 'AVAILABLE', limit: 20 }) : Promise.resolve([])),
    [leagueId, query],
  )

  const retained = useAsync(
    () => api.players(leagueId, { status: 'RETAINED', limit: 100 }),
    [leagueId, busy],
  )

  const submit = async () => {
    if (!teamId || picked.length === 0) return
    setBusy(true)
    try {
      await api.retain(leagueId, Number(teamId), picked)
      onDone(`${picked.length} players retained.`)
      setPicked([])
      setQuery('')
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel p-5">
      <Eyebrow>Step four</Eyebrow>
      <h2 className="mt-2 text-3xl">Retentions</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Retained players are charged the retention price and come straight off the squad's purse. This has
        to be done before the auction starts.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="eyebrow">Squad</span>
          <select
            className="field mt-1.5"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Choose a squad</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name} — {money(team.remaining_purse)} left
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">Find a player</span>
          <input
            className="field mt-1.5"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Start typing a name"
          />
        </label>
      </div>

      {search.data && search.data.length > 0 && (
        <ul className="mt-3 max-h-60 divide-y divide-line overflow-auto">
          {search.data.map((player) => {
            const checked = picked.includes(player.id)
            return (
              <li key={player.id}>
                <label className="flex cursor-pointer items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setPicked((current) =>
                        checked ? current.filter((id) => id !== player.id) : [...current, player.id],
                      )
                    }
                  />
                  <Avatar name={player.name} src={player.photo_url} jersey={player.jersey_number} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{player.name}</span>
                    <span className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                      {ROLE_LABEL[player.role]}
                      {player.place && ` · ${player.place}`}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}

      <button
        type="button"
        className="btn-primary mt-4"
        disabled={busy || !teamId || picked.length === 0}
        onClick={submit}
      >
        Retain {picked.length || ''} {picked.length === 1 ? 'player' : 'players'}
      </button>

      {retained.data && retained.data.length > 0 && (
        <div className="mt-6">
          <Eyebrow>Already retained</Eyebrow>
          <ul className="mt-2 divide-y divide-line">
            {retained.data.map((player) => (
              <li key={player.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{player.name}</span>
                <span className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                  {player.team?.name}
                </span>
                <span className="money text-xs text-amber">{money(player.sold_price)}</span>
                <button
                  type="button"
                  className="btn-ghost !px-2 !py-1"
                  onClick={async () => {
                    try {
                      await api.release(leagueId, player.id)
                      onDone(`${player.name} released back into the pool.`)
                      setBusy((b) => !b)
                    } catch (err) {
                      onError(err)
                    }
                  }}
                >
                  Release
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
