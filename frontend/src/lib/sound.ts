/**
 * Auction sounds.
 *
 * Everything here plays files from public/sounds/. There is no synthesised
 * fallback: if a file is missing that cue is simply silent, which is easier to
 * reason about than a substitute sound turning up unannounced.
 *
 *   public/sounds/firework.mp3   plays as the fire flowers bloom
 *   public/sounds/unsold.mp3     optional, on unsold
 *   public/sounds/bid.mp3        optional, as each bid lands
 *
 * Browsers block audio until the visitor has interacted with the page, so the
 * context is created lazily and resumed on the first click or keypress.
 */

const MUTE_KEY = 'auction.muted'
const VOLUME_KEY = 'auction.volume'

type SoundName = 'firework' | 'unsold' | 'bid'

const FILES: Record<SoundName, string> = {
  firework: '/sounds/firework.mp3',
  unsold: '/sounds/unsold.mp3',
  bid: '/sounds/bid.mp3',
}

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Call once from a real user gesture so later sounds are allowed to play. */
export function unlockAudio(): void {
  const audio = context()
  if (audio && audio.state === 'suspended') void audio.resume()
}

export const isMuted = () => localStorage.getItem(MUTE_KEY) === 'true'
export const setMuted = (value: boolean) => localStorage.setItem(MUTE_KEY, String(value))

export const volume = () => Number(localStorage.getItem(VOLUME_KEY) ?? '1')
export const setVolume = (v: number) =>
  localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(1, v))))

// --------------------------------------------------------------------------
// Loading
// --------------------------------------------------------------------------
const buffers = new Map<SoundName, AudioBuffer | null>()
// If Web Audio decoding is unavailable — some locked-down browsers and
// embedded frames refuse it — fall back to a plain <audio> element.
const elements = new Map<SoundName, HTMLAudioElement>()

async function load(name: SoundName): Promise<AudioBuffer | null> {
  if (buffers.has(name)) return buffers.get(name) ?? null
  buffers.set(name, null) // claim the slot so a missing file is fetched only once

  const audio = context()
  if (!audio) {
    buffers.delete(name) // no context yet; try again after the first gesture
    return null
  }
  try {
    const res = await fetch(FILES[name])
    // A missing file under Vite's dev server returns index.html, not a 404.
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null
    const bytes = await res.arrayBuffer()
    try {
      const decoded = await audio.decodeAudioData(bytes)
      buffers.set(name, decoded)
      return decoded
    } catch {
      const el = new Audio(FILES[name])
      el.preload = 'auto'
      elements.set(name, el)
      return null
    }
  } catch {
    return null
  }
}

/** Fetch everything up front so the first sale isn't waiting on a download. */
export function preloadSounds(): void {
  ;(Object.keys(FILES) as SoundName[]).forEach((name) => void load(name))
}

function play(name: SoundName, gain = 1): void {
  if (isMuted()) return
  const audio = context()
  if (!audio) return

  const fire = (buffer: AudioBuffer) => {
    const src = audio.createBufferSource()
    const amp = audio.createGain()
    src.buffer = buffer
    amp.gain.value = volume() * gain
    src.connect(amp).connect(audio.destination)
    src.start()
  }

  const ready = buffers.get(name)
  if (ready) {
    fire(ready)
    return
  }
  const el = elements.get(name)
  if (el) {
    el.currentTime = 0
    el.volume = volume() * gain
    void el.play().catch(() => undefined)
    return
  }
  // Not decoded yet. Load and play the moment it lands rather than swallowing
  // the cue — otherwise the very first sale of the night can be silent.
  void load(name).then((buffer) => {
    if (isMuted()) return
    if (buffer) {
      fire(buffer)
      return
    }
    const late = elements.get(name)
    if (late) {
      late.volume = volume() * gain
      void late.play().catch(() => undefined)
    }
  })
}

// --------------------------------------------------------------------------
// Cues
// --------------------------------------------------------------------------

/**
 * The hammer moment. Starts on the same tick as the first bloom, so the bang
 * and the burst land together rather than one chasing the other.
 */
export function playSold(): void {
  play('firework')
}

export function playUnsold(): void {
  play('unsold')
}

export function playBid(): void {
  play('bid', 0.6)
}
