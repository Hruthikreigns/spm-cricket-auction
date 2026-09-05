import { useState, type FormEvent } from 'react'

import { Eyebrow, Note } from '../components/ui'
import { api } from '../lib/api'

// --------------------------------------------------------------------------
export function Contact() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setStatus('sending')
    setError(null)
    try {
      await api.contact({
        name: form.name,
        email: form.email,
        phone: form.phone || undefined,
        message: form.message,
      })
      setStatus('sent')
      setForm({ name: '', email: '', phone: '', message: '' })
    } catch (err) {
      setError((err as Error).message)
      setStatus('idle')
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <Eyebrow>Entries, sponsorship and anything else</Eyebrow>
      <h1 className="mt-2 text-6xl sm:text-7xl">Get in touch</h1>

      <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,1fr)_18rem]">
        <form onSubmit={submit} className="panel space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="eyebrow">Your name</span>
              <input
                className="field mt-1.5"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="block">
              <span className="eyebrow">Email</span>
              <input
                className="field mt-1.5"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
          </div>
          <label className="block">
            <span className="eyebrow">Phone (optional)</span>
            <input
              className="field mt-1.5"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="eyebrow">Message</span>
            <textarea
              className="field mt-1.5 min-h-32"
              required
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          </label>

          {error && (
            <Note tone="error">
              {error} You can also email{' '}
              <a className="underline" href="mailto:hruthikyadavhc@gmail.com">
                hruthikyadavhc@gmail.com
              </a>
              .
            </Note>
          )}
          {status === 'sent' && <Note>Thanks — we'll get back to you soon.</Note>}

          <button className="btn-primary w-full" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending' : 'Send message'}
          </button>
        </form>

        <aside className="space-y-6">
          <div>
            <Eyebrow>Auction desk</Eyebrow>
            <p className="mt-2 font-display text-2xl uppercase tracking-tightest">Hruthik</p>
          </div>

          <div>
            <Eyebrow>Phone</Eyebrow>
            {/* tel: and mailto: so a phone dials or composes in one tap. */}
            <a href="tel:+916305666862" className="money mt-1 block text-lg text-ink hover:text-amber">
              6305666862
            </a>
          </div>

          <div>
            <Eyebrow>Email</Eyebrow>
            <a
              href="mailto:hruthikyadavhc@gmail.com"
              className="mt-1 block break-all text-sm text-ink hover:text-amber"
            >
              hruthikyadavhc@gmail.com
            </a>
          </div>

          <p className="text-sm text-muted">
            Registration, squad entries and purse queries all come through here.
          </p>
        </aside>
      </div>
    </div>
  )
}
