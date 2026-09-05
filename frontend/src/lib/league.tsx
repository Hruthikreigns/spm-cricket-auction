import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api } from './api'
import type { League } from './types'

interface LeagueValue {
  leagues: League[]
  league: League | null
  leagueId: number | null
  select: (id: number) => void
  loading: boolean
  error: string | null
  reload: () => void
}

const Ctx = createContext<LeagueValue>({
  leagues: [],
  league: null,
  leagueId: null,
  select: () => {},
  loading: true,
  error: null,
  reload: () => {},
})

const STORE_KEY = 'auction.league'

/** Whatever is live wins, then the next one scheduled, then anything at all. */
function preferred(leagues: League[]): League | null {
  return (
    leagues.find((l) => l.status === 'LIVE') ??
    leagues.find((l) => l.status === 'UPCOMING') ??
    leagues[0] ??
    null
  )
}

export function LeagueProvider({ children }: { children: ReactNode }) {
  const [leagues, setLeagues] = useState<League[]>([])
  const [selected, setSelected] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORE_KEY)
    return stored ? Number(stored) : null
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    api
      .leagues()
      .then((rows) => {
        if (!live) return
        setLeagues(rows)
        setError(null)
        setSelected((current) =>
          current && rows.some((l) => l.id === current) ? current : (preferred(rows)?.id ?? null),
        )
      })
      .catch((err: Error) => live && setError(err.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [nonce])

  const select = useCallback((id: number) => {
    setSelected(id)
    localStorage.setItem(STORE_KEY, String(id))
  }, [])

  const value = useMemo<LeagueValue>(
    () => ({
      leagues,
      league: leagues.find((l) => l.id === selected) ?? null,
      leagueId: selected,
      select,
      loading,
      error,
      reload: () => setNonce((n) => n + 1),
    }),
    [leagues, selected, select, loading, error],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useLeague = () => useContext(Ctx)
