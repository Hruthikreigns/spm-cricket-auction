import { useCallback, useEffect, useState } from 'react'

import { api } from '../lib/api'
import type { ViewerAccess, ViewerAccessCreated } from '../lib/types'
import { Eyebrow, Note, Pill } from './ui'

/**
 * The shared watching login.
 *
 * One id and password between all the squad owners rather than an account
 * each — the organiser reads it out once and everyone uses it. Changing the
 * password is how you shut out anyone who shouldn't have it any more.
 */
export function ViewerAccessPanel({
  onChange,
  onError,
}: {
  onChange: (text: string) => void
  onError: (err: unknown) => void
}) {
  const [access, setAccess] = useState<ViewerAccess | null>(null)
  const [justSet, setJustSet] = useState<ViewerAccessCreated | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const body = await api.viewerAccess()
      setAccess(body)
      setEmail(body.email ?? 'owners@spm.local')
    } catch (err) {
      onError(err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const issue = async () => {
    setBusy(true)
    try {
      const created = await api.setViewerAccess({ email: email.trim() || undefined })
      setJustSet(created)
      onChange(access?.exists ? 'New password issued.' : 'Watching login created.')
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  const copy = async (body: ViewerAccessCreated) => {
    await navigator.clipboard.writeText(
      [
        'Watch the auction live:',
        `${window.location.origin}/live`,
        `Id: ${body.email}`,
        `Password: ${body.password}`,
      ].join('\n'),
    )
    onChange('Details copied — paste them to the squad owners.')
  }

  return (
    <section className="panel p-5">
      <Eyebrow>Who can watch</Eyebrow>
      <h2 className="mt-2 text-3xl">Live viewing login</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        The live auction needs a sign-in, so bidding isn't on show to the whole internet while
        it's happening. One id and password between all the squad owners — send it to the
        group. They can watch and nothing else: no console, no editing, and no players' phone
        numbers. Up to {access?.max_viewers ?? 30} people can be watching at the same time.
        Finished results stay public regardless.
      </p>

      {/* Shown once, at the moment it's set. */}
      {justSet && (
        <div className="panel mt-4 border-amber/60 p-4">
          <Eyebrow>Send this to the squad owners</Eyebrow>
          <dl className="mt-2 grid gap-1 font-mono text-sm">
            <div className="flex gap-2">
              <dt className="w-20 text-muted">Id</dt>
              <dd>{justSet.email}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 text-muted">Password</dt>
              <dd className="text-lg text-amber">{justSet.password}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => copy(justSet)}>
              Copy details
            </button>
            <button type="button" className="btn-ghost" onClick={() => setJustSet(null)}>
              Done
            </button>
          </div>
          <p className="mt-2 text-[0.7rem] text-muted">
            Write it down now — it isn't stored in readable form. If it's lost, issue a new one.
          </p>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="block">
          <span className="eyebrow">Login id</span>
          <input
            className="field mt-1.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owners@spm.local"
          />
          <span className="mt-1 block text-[0.7rem] text-muted">
            Doesn't need to be a real address — it's just the id they type.
          </span>
        </label>
        <button type="button" className="btn-primary" disabled={busy} onClick={issue}>
          {busy ? 'Saving' : access?.exists ? 'Issue a new password' : 'Create the login'}
        </button>
        {access?.exists && (
          <button
            type="button"
            className="btn-ghost"
            onClick={async () => {
              if (!window.confirm('Remove the watching login? Only you will be able to watch.'))
                return
              try {
                await api.revokeViewerAccess()
                setJustSet(null)
                onChange('Watching login removed.')
                await load()
              } catch (err) {
                onError(err)
              }
            }}
          >
            Remove
          </button>
        )}
      </div>

      <div className="mt-4">
        {access?.exists ? (
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="live">Login active</Pill>
            <span className="font-mono text-[0.65rem] uppercase tracking-eyebrow text-muted">
              {access.email} · up to {access.max_viewers} watching at once
            </span>
          </div>
        ) : (
          <Note>
            No watching login yet, so only you can see the live room. Create one and send it to
            the squad owners.
          </Note>
        )}
      </div>
    </section>
  )
}
