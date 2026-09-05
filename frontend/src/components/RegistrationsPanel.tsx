import { useCallback, useEffect, useRef, useState } from 'react'

import { Avatar, Eyebrow, Loading, Note, Pill } from '../components/ui'
import { api } from '../lib/api'
import { ROLE_LABEL } from '../lib/hooks'
import type { Registration, RegistrationSummary } from '../lib/types'

/**
 * Everything an organiser needs to collect players: the link to hand out, a
 * QR code for a poster, and the queue of people waiting to be let in.
 */
export function RegistrationsPanel({
  leagueId,
  leagueName,
  onChange,
  onError,
}: {
  leagueId: number
  leagueName: string
  onChange: (text: string) => void
  onError: (err: unknown) => void
}) {
  const [rows, setRows] = useState<Registration[]>([])
  const [summary, setSummary] = useState<RegistrationSummary | null>(null)
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [autoApprove, setAutoApprove] = useState<boolean | null>(null)
  const [downloading, setDownloading] = useState(false)
  const qrRef = useRef<HTMLCanvasElement>(null)

  const shareUrl = `${window.location.origin}/register/${leagueId}`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, status] = await Promise.all([
        api.registrations(leagueId),
        api.registrationStatus(leagueId),
      ])
      setRows(list)
      setSummary(status)
    } catch (err) {
      onError(err)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    api
      .league(leagueId)
      .then((l) => setAutoApprove(l.auto_approve_registrations))
      .catch(() => setAutoApprove(null))
  }, [leagueId])


  useEffect(() => {
    if (!qrRef.current) return
    // Loaded on demand: the QR library is only ever needed on this admin
    // panel, and it is a third of the size of the whole app bundle.
    void import('qrcode').then(({ default: QRCode }) => {
      if (!qrRef.current) return
      // Dark modules on white: a QR needs real contrast to scan off a screen
      // or a printed poster, so it ignores the theme.
      void QRCode.toCanvas(qrRef.current, shareUrl, {
        width: 168,
        margin: 1,
        color: { dark: '#111111', light: '#ffffff' },
      })
    })
  }, [shareUrl, loading])

  const review = async (id: number, action: 'approve' | 'reject') => {
    setBusyId(id)
    try {
      if (action === 'approve') await api.approveRegistration(leagueId, id)
      else await api.rejectRegistration(leagueId, id)
      onChange(action === 'approve' ? 'Added to the player pool.' : 'Registration rejected.')
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setBusyId(null)
    }
  }

  const shown = rows.filter((r) => r.status === tab)
  const pendingCount = rows.filter((r) => r.status === 'PENDING').length

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(
    `Register for the ${leagueName} auction: ${shareUrl}`,
  )}`

  return (
    <section className="panel p-5">
      <Eyebrow>Collect players</Eyebrow>
      <h2 className="mt-2 text-3xl">Registration link</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Share this with players. Anyone who opens it can sign themselves up — no account needed —
        and nothing they submit reaches the auction pool until you approve it below.
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-sm border border-line bg-pitch px-3 py-2.5 font-mono text-xs">
              {shareUrl}
            </code>
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                await navigator.clipboard.writeText(shareUrl)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 2500)
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className="btn-ghost" href={whatsapp} target="_blank" rel="noreferrer">
              Share on WhatsApp
            </a>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Pill tone={summary?.open ? 'live' : 'unsold'}>
              {summary?.open ? 'Form is open' : 'Form is closed'}
            </Pill>
            <Pill>{summary?.pending ?? 0} waiting</Pill>
            <Pill tone="sold">{summary?.approved ?? 0} approved</Pill>

            {/* Only offer the switch when the league itself still allows it —
                once the auction starts, the form is shut regardless. */}
            {summary?.league_status === 'UPCOMING' && (
              <button
                type="button"
                className={summary.open ? 'btn-ghost !px-3 !py-1.5' : 'btn-primary !px-3 !py-1.5'}
                disabled={toggling}
                onClick={async () => {
                  setToggling(true)
                  try {
                    await api.updateLeague(leagueId, { registration_open: !summary.open })
                    onChange(summary.open ? 'Registration closed.' : 'Registration reopened.')
                    await load()
                  } catch (err) {
                    onError(err)
                  } finally {
                    setToggling(false)
                  }
                }}
              >
                {toggling ? 'Saving' : summary.open ? 'Close registration' : 'Reopen registration'}
              </button>
            )}
          </div>

          {/* Straight into the pool, or into the review queue. */}
          {autoApprove !== null && (
            <label className="mt-4 flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={autoApprove}
                onChange={async (e) => {
                  const next = e.target.checked
                  try {
                    await api.updateLeague(leagueId, { auto_approve_registrations: next })
                    setAutoApprove(next)
                    onChange(
                      next
                        ? 'New registrations now go straight into the pool.'
                        : 'New registrations will wait for your approval.',
                    )
                    await load()
                  } catch (err) {
                    onError(err)
                  }
                }}
              />
              <span>
                <span className="text-sm text-ink">Approve registrations automatically</span>
                <span className="mt-1 block text-[0.7rem] text-muted">
                  Sign-ups join the auction pool the moment they submit, with no review.
                  Duplicate names and mobile numbers are still refused, so it can only ever add
                  someone new. Switch it off and anything new waits in the queue again.
                </span>
              </span>
            </label>
          )}

          {!summary?.open && (
            <p className="mt-3 text-xs text-muted">
              {summary?.closed_by_admin
                ? 'You closed the form. Reopen it any time — the link stays the same.'
                : 'The form closed by itself when the league left Upcoming. Set it back to Upcoming to reopen.'}
            </p>
          )}
        </div>

        <figure className="text-center">
          <canvas ref={qrRef} className="rounded-sm border border-line bg-white p-2" />
          <figcaption className="eyebrow mt-2">Scan to register</figcaption>
        </figure>
      </div>

      {/* ---- review queue ---- */}
      <div className="mt-8 border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-2xl">
            Who's signed up{pendingCount > 0 && <span className="text-amber"> · {pendingCount} to review</span>}
          </h3>
          {pendingCount > 1 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                if (!window.confirm(`Approve all ${pendingCount} pending registrations?`)) return
                try {
                  await api.approveAllRegistrations(leagueId)
                  onChange('Pending registrations approved.')
                  await load()
                } catch (err) {
                  onError(err)
                }
              }}
            >
              Approve all {pendingCount}
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={tab === key ? 'btn-primary' : 'btn-ghost'}
            >
              {key.toLowerCase()} ({rows.filter((r) => r.status === key).length})
            </button>
          ))}

          {/* Downloads what you're looking at: the tab you're on, or the lot. */}
          <span className="ml-auto flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={downloading || rows.length === 0}
              onClick={async () => {
                setDownloading(true)
                try {
                  await api.registrationsPdf(leagueId, tab)
                  onChange(`Downloaded the ${tab.toLowerCase()} list.`)
                } catch (err) {
                  onError(err)
                } finally {
                  setDownloading(false)
                }
              }}
            >
              {downloading ? 'Preparing' : `PDF — ${tab.toLowerCase()}`}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={downloading || rows.length === 0}
              onClick={async () => {
                setDownloading(true)
                try {
                  await api.registrationsPdf(leagueId)
                  onChange('Downloaded every registration.')
                } catch (err) {
                  onError(err)
                } finally {
                  setDownloading(false)
                }
              }}
            >
              PDF — everyone ({rows.length})
            </button>
          </span>
        </div>
        <p className="mt-2 text-[0.7rem] text-muted">
          The PDF has every detail including photos, mobile numbers and emails — it's for the
          organisers' desk, not for sharing around.
        </p>

        {loading ? (
          <Loading label="Loading registrations" />
        ) : shown.length === 0 ? (
          <div className="mt-4">
            <Note>
              {tab === 'PENDING'
                ? 'Nobody is waiting. Share the link above to start collecting players.'
                : `No ${tab.toLowerCase()} registrations.`}
            </Note>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {shown.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar
                  name={entry.name}
                  src={entry.photo_url}
                  jersey={entry.jersey_number}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{entry.name}</p>
                  <p className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
                    {ROLE_LABEL[entry.role]}
                    {entry.place && ` · ${entry.place}`} · {entry.mobile}
                    {entry.email && ` · ${entry.email}`}
                  </p>
                  {entry.note && <p className="mt-1 text-xs text-muted">{entry.note}</p>}
                </div>

                {entry.status === 'PENDING' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-primary !px-3 !py-1.5"
                      disabled={busyId === entry.id}
                      onClick={() => review(entry.id, 'approve')}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-3 !py-1.5"
                      disabled={busyId === entry.id}
                      onClick={() => review(entry.id, 'reject')}
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <Pill tone={entry.status === 'APPROVED' ? 'sold' : 'unsold'}>
                    {entry.status.toLowerCase()}
                  </Pill>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
