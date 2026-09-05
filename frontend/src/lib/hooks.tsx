import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { api, socketUrl, token } from './api'
import type { AuctionState, Player, PlayerRole, Team } from './types'

// --------------------------------------------------------------------------
// Formatting
// --------------------------------------------------------------------------
const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const money = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `₹${rupees.format(value)}`

/** Compact form for tight spaces: ₹94k, ₹1.2L. */
export function shortMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 100000) return `₹${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 1)}L`
  if (value >= 1000) return `₹${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  return `₹${value}`
}

export const ROLE_LABEL: Record<PlayerRole, string> = {
  BATSMAN: 'Batter',
  BOWLER: 'Bowler',
  ALL_ROUNDER: 'All-rounder',
  WICKET_KEEPER: 'Wicket-keeper',
}

export const ROLE_SHORT: Record<PlayerRole, string> = {
  BATSMAN: 'BAT',
  BOWLER: 'BWL',
  ALL_ROUNDER: 'AR',
  WICKET_KEEPER: 'WK',
}

export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

// --------------------------------------------------------------------------
// Theme
// --------------------------------------------------------------------------
export type Theme = 'night' | 'day' | 'royal'

export const THEMES: { key: Theme; label: string; hint: string }[] = [
  { key: 'night', label: 'Night', hint: 'Dark hall, big screen' },
  { key: 'day', label: 'Day', hint: 'Daylight and print' },
  { key: 'royal', label: 'Royal', hint: 'White and violet, for projectors' },
]

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('auction.theme') as Theme | null
    return stored && THEMES.some((t) => t.key === stored) ? stored : 'night'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('auction.theme', theme)
  }, [theme])

  /** Steps through the palettes in order, wrapping at the end. */
  const cycle = () =>
    setTheme((current) => {
      const i = THEMES.findIndex((t) => t.key === current)
      return THEMES[(i + 1) % THEMES.length].key
    })

  const next = THEMES[(THEMES.findIndex((t) => t.key === theme) + 1) % THEMES.length]

  return { theme, setTheme, cycle, next, toggle: cycle }
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------
interface AuthValue {
  email: string | null
  role: 'admin' | 'owner' | null
  name: string | null
  isAdmin: boolean
  signIn: (email: string, password: string) => Promise<'admin' | 'owner'>
  signOut: () => void
  ready: boolean
}

const AuthContext = createContext<AuthValue>({
  email: null,
  role: null,
  name: null,
  isAdmin: false,
  signIn: async () => 'owner',
  signOut: () => {},
  ready: false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [email, setEmail] = useState<string | null>(null)
  const [role, setRole] = useState<'admin' | 'owner' | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!token.get()) {
      setReady(true)
      return
    }
    api
      .me()
      .then((user) => {
        setEmail(user.email)
        setRole(user.role as 'admin' | 'owner')
        setName(user.full_name)
      })
      .catch(() => token.clear())
      .finally(() => setReady(true))
  }, [])

  const signIn = useCallback(async (address: string, password: string) => {
    const res = await api.login(address, password)
    token.set(res.access_token)
    const user = await api.me()
    setEmail(user.email)
    setRole(user.role as 'admin' | 'owner')
    setName(user.full_name)
    return user.role as 'admin' | 'owner'
  }, [])

  const signOut = useCallback(() => {
    token.clear()
    setEmail(null)
    setRole(null)
    setName(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ email, role, name, isAdmin: role === 'admin', signIn, signOut, ready }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)

// --------------------------------------------------------------------------
// Live auction feed
// --------------------------------------------------------------------------
/** The moment a player was closed out, for the "sold!" banner. */
export interface Hammer {
  id: number
  sold: boolean
  player: Player
}

export interface LiveFeed {
  state: AuctionState | null
  teams: Team[]
  connected: boolean
  lastEvent: string | null
  hammer: Hammer | null
  refresh: () => Promise<void>
}

/**
 * Subscribes to the auction socket and falls back to polling if the socket
 * can't be held open, so the board is never silently stale.
 */
export function useLiveAuction(leagueId: number | null): LiveFeed {
  const [state, setState] = useState<AuctionState | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [connected, setConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [hammer, setHammer] = useState<Hammer | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  const refresh = useCallback(async () => {
    if (!leagueId) return
    const [nextState, nextTeams] = await Promise.all([api.state(leagueId), api.board(leagueId)])
    setState(nextState)
    setTeams(nextTeams)
  }, [leagueId])

  useEffect(() => {
    if (!leagueId) return
    let cancelled = false
    let heartbeat: number | undefined
    let poll: number | undefined
    let retry = 0

    // Polling is the safety net: if the socket can't be held open — a proxy
    // that won't forward upgrades, a phone that slept, a flaky hall wifi —
    // the board still refreshes rather than sitting on a stale player.
    const startPolling = () => {
      if (poll !== undefined) return // never stack intervals
      poll = window.setInterval(() => refresh().catch(() => undefined), 2500)
    }
    const stopPolling = () => {
      if (poll !== undefined) {
        window.clearInterval(poll)
        poll = undefined
      }
    }

    refresh().catch(() => undefined)
    // Start polling immediately; the socket turns it off once it's up, so a
    // failed upgrade never leaves the screen frozen.
    startPolling()

    const connect = () => {
      if (cancelled) return
      const socket = new WebSocket(socketUrl(leagueId))
      socketRef.current = socket

      socket.onopen = () => {
        setConnected(true)
        retry = 0
        stopPolling()
        heartbeat = window.setInterval(() => socket.readyState === 1 && socket.send('ping'), 20000)
      }
      socket.onmessage = (event) => {
        const { event: name, payload } = JSON.parse(event.data)
        if (name === 'ping') return
        if (payload?.state) setState(payload.state)
        if (payload?.teams) setTeams(payload.teams)
        if (payload?.sold) setHammer({ id: hammerSeq(), sold: true, player: payload.sold })
        if (payload?.unsold) setHammer({ id: hammerSeq(), sold: false, player: payload.unsold })
        setLastEvent(name)
      }
      socket.onclose = () => {
        setConnected(false)
        window.clearInterval(heartbeat)
        if (cancelled) return
        startPolling()
        retry += 1
        window.setTimeout(connect, Math.min(1000 * 2 ** retry, 15000))
      }
      socket.onerror = () => socket.close()
    }

    connect()

    // A phone that has been asleep comes back with a dead socket and a stale
    // board, so pull fresh state the moment the tab is visible again.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      refresh().catch(() => undefined)
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        retry = 0
        connect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(heartbeat)
      stopPolling()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      socketRef.current?.close()
    }
  }, [leagueId, refresh])

  return { state, teams, connected, lastEvent, hammer, refresh }
}

let hammerCounter = 0
/** Distinguishes two closes of the same player, so the banner re-fires. */
const hammerSeq = () => (hammerCounter += 1)

/** Load-once data fetch with loading and error states. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    setLoading(true)
    fn()
      .then((value) => live && setData(value))
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading }
}
