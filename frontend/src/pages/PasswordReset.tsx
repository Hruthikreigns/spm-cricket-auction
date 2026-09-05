import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { Eyebrow, Note } from '../components/ui'
import { api } from '../lib/api'

/** Ask for a reset link. */
export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.forgotPassword(email.trim())
      setSent(res.message)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-20">
      <Eyebrow>Locked out</Eyebrow>
      <h1 className="mt-2 text-5xl">Reset your password</h1>

      {sent ? (
        <>
          {/* Deliberately doesn't say whether the address had an account —
              that would turn this page into a way of finding out who does. */}
          <div className="mt-6">
            <Note>{sent}</Note>
          </div>
          <p className="mt-4 text-sm text-muted">
            Check the inbox for {email.trim()}, including the spam folder. The link opens a page
            where you choose a new password.
          </p>
          <Link to="/admin/login" className="btn-ghost mt-8">
            Back to sign in
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="panel mt-8 space-y-4 p-5">
          <p className="text-sm text-muted">
            Enter the email on your account and we'll send a link to set a new password.
          </p>
          <label className="block">
            <span className="eyebrow">Email</span>
            <input
              className="field mt-1.5"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <Note tone="error">{error}</Note>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Sending' : 'Email me a link'}
          </button>
          <Link to="/admin/login" className="block text-center text-sm text-muted hover:text-amber">
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  )
}

/** Set a new password from the emailed link. */
export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirm) {
      setError("Those two don't match.")
      return
    }
    if (password.length < 6) {
      setError('Use at least six characters.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.resetPassword(token, password)
      setDone(true)
      window.setTimeout(() => navigate('/admin/login', { replace: true }), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!token)
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-4xl">That link is incomplete</h1>
        <p className="mt-3 text-muted">
          Open the link from the email exactly as it arrived, or ask for a new one.
        </p>
        <Link to="/forgot-password" className="btn-primary mt-6">
          Send another link
        </Link>
      </div>
    )

  return (
    <div className="mx-auto max-w-md px-4 py-20">
      <Eyebrow>Almost there</Eyebrow>
      <h1 className="mt-2 text-5xl">Choose a new password</h1>

      {done ? (
        <>
          <div className="mt-6">
            <Note>Password changed. Taking you to sign in…</Note>
          </div>
          <Link to="/admin/login" className="btn-primary mt-6">
            Sign in now
          </Link>
        </>
      ) : (
        <form onSubmit={submit} className="panel mt-8 space-y-4 p-5">
          <label className="block">
            <span className="eyebrow">New password</span>
            <input
              className="field mt-1.5"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Type it again</span>
            <input
              className="field mt-1.5"
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          {error && <Note tone="error">{error}</Note>}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Saving' : 'Set the new password'}
          </button>
          <p className="text-center text-[0.7rem] text-muted">
            The link works once. If it's expired, ask for a new one.
          </p>
        </form>
      )}
    </div>
  )
}
