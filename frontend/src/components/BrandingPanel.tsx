import { useEffect, useState } from 'react'

import { api } from '../lib/api'
import type { League } from '../lib/types'
import { Eyebrow, Note } from './ui'

type ImageField = 'logo_url' | 'poster_url' | 'powered_by_logo_url'

const LIMIT_MB = 5

/**
 * Artwork for a league: the mark, the tournament poster, and whoever is
 * powering it. Each image uploads on selection and saves straight away, so
 * there's no half-filled form to lose.
 */
export function BrandingPanel({
  league,
  onChange,
  onError,
}: {
  league: League
  onChange: (text: string) => void
  onError: (err: unknown) => void
}) {
  const [current, setCurrent] = useState<League>(league)
  const [credit, setCredit] = useState({
    powered_by_name: league.powered_by_name ?? '',
    powered_by_url: league.powered_by_url ?? '',
  })
  const [uploading, setUploading] = useState<ImageField | null>(null)
  const [savingCredit, setSavingCredit] = useState(false)

  useEffect(() => {
    setCurrent(league)
    setCredit({
      powered_by_name: league.powered_by_name ?? '',
      powered_by_url: league.powered_by_url ?? '',
    })
  }, [league])

  const upload = async (field: ImageField, file: File | null) => {
    if (!file) return
    if (!/^image\/(jpeg|png|webp|svg\+xml)$/.test(file.type)) {
      onError(new Error('Artwork needs to be JPG, PNG, WEBP or SVG.'))
      return
    }
    if (file.size > LIMIT_MB * 1024 * 1024) {
      onError(new Error(`That image is over ${LIMIT_MB}MB. Export it smaller and try again.`))
      return
    }
    setUploading(field)
    try {
      const { url } = await api.uploadImage('league', file)
      const saved = await api.updateLeague(current.id, { [field]: url })
      setCurrent(saved)
      onChange('Artwork saved.')
    } catch (err) {
      onError(err)
    } finally {
      setUploading(null)
    }
  }

  const clear = async (field: ImageField) => {
    try {
      const saved = await api.updateLeague(current.id, { [field]: null })
      setCurrent(saved)
      onChange('Removed.')
    } catch (err) {
      onError(err)
    }
  }

  const saveCredit = async () => {
    setSavingCredit(true)
    try {
      const saved = await api.updateLeague(current.id, {
        powered_by_name: credit.powered_by_name.trim() || null,
        powered_by_url: credit.powered_by_url.trim() || null,
      })
      setCurrent(saved)
      onChange('Credit saved.')
    } catch (err) {
      onError(err)
    } finally {
      setSavingCredit(false)
    }
  }

  const slot = (
    field: ImageField,
    label: string,
    hint: string,
    frame: string,
  ) => {
    const value = current[field]
    return (
      <div>
        <Eyebrow>{label}</Eyebrow>
        <div className={`mt-2 overflow-hidden rounded-sm border border-line bg-raised ${frame}`}>
          {value ? (
            <img src={value} alt="" className="h-full w-full object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-[0.65rem] text-muted">
              nothing yet
            </div>
          )}
        </div>
        <p className="mt-1.5 text-[0.7rem] text-muted">{hint}</p>
        <div className="mt-2 flex gap-2">
          <label className="btn-ghost cursor-pointer !px-3 !py-1.5">
            {uploading === field ? 'Uploading' : value ? 'Replace' : 'Upload'}
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,image/svg+xml"
              disabled={uploading === field}
              onChange={(e) => {
                void upload(field, e.target.files?.[0] ?? null)
                e.target.value = '' // allow re-picking the same file after an error
              }}
            />
          </label>
          {value && (
            <button type="button" className="btn-ghost !px-3 !py-1.5" onClick={() => clear(field)}>
              Remove
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="panel p-5">
      <Eyebrow>How the league looks</Eyebrow>
      <h2 className="mt-2 text-3xl">Artwork</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        The site banner is fixed and ships with the app. These are your league's own: the
        poster appears in full on the home page — use the same image you're sharing on
        WhatsApp, prizes and dates and all — while the mark and the credit sit in smaller
        places around the site.
      </p>

      <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {slot('logo_url', 'League mark', 'Square works best. Shown beside the league name.', 'h-32 w-32')}
        {slot(
          'poster_url',
          'Tournament poster',
          'Shown whole, never cropped. Portrait or landscape both fine.',
          'h-56 w-full',
        )}
        {slot(
          'powered_by_logo_url',
          'Powered by',
          'A sponsor or the organising club. Sits small in the footer and on the home page.',
          'h-32 w-full',
        )}
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <Eyebrow>Powered by — text and link</Eyebrow>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            className="field"
            placeholder="Sponsor or club name"
            value={credit.powered_by_name}
            onChange={(e) => setCredit({ ...credit, powered_by_name: e.target.value })}
          />
          <input
            className="field"
            placeholder="https://their-site.com (optional)"
            value={credit.powered_by_url}
            onChange={(e) => setCredit({ ...credit, powered_by_url: e.target.value })}
          />
          <button type="button" className="btn-primary" onClick={saveCredit} disabled={savingCredit}>
            {savingCredit ? 'Saving' : 'Save'}
          </button>
        </div>
        <p className="mt-2 text-[0.7rem] text-muted">
          The name is used as the image's alt text, so add it even if you've uploaded a logo —
          it's what a screen reader announces.
        </p>
      </div>

      {/* Who can see a player's number on the big screen. */}
      <div className="mt-6 border-t border-line pt-5">
        <Eyebrow>The live screen</Eyebrow>
        <label className="mt-3 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={current.show_mobile_publicly}
            onChange={async (e) => {
              try {
                const saved = await api.updateLeague(current.id, {
                  show_mobile_publicly: e.target.checked,
                })
                setCurrent(saved)
                onChange(
                  saved.show_mobile_publicly
                    ? 'Mobile numbers are now visible to everyone.'
                    : 'Mobile numbers are hidden from the public screen.',
                )
              } catch (err) {
                onError(err)
              }
            }}
          />
          <span>
            <span className="text-sm text-ink">Show mobile numbers on the public screen</span>
            <span className="mt-1 block text-[0.7rem] text-muted">
              Off by default. The auctioneer's console always shows the number of the player on
              the block; this decides whether everyone watching sees it too — on the live screen,
              in the player list and on player pages. Some leagues want it so squad owners can
              ring players directly. Leave it off if the link is going in a public group.
            </span>
          </span>
        </label>
      </div>

      {!current.poster_url && (
        <div className="mt-5">
          <Note>
            No poster yet. Until you add one the home page falls back to the league name and
            details, which still works — it just isn't as striking.
          </Note>
        </div>
      )}
    </section>
  )
}
