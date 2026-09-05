import type {
  Analytics,
  AuctionSettings,
  AuctionState,
  Bid,
  ImportReport,
  League,
  LeagueResults,
  Player,
  PlayerRole,
  PlayerStatus,
  Registration,
  RegistrationSummary,
  ViewerAccess,
  ViewerAccessCreated,
  Team,
} from './types'

const BASE = import.meta.env.VITE_API_URL ?? ''
const TOKEN_KEY = 'auction.token'

export const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (value: string) => localStorage.setItem(TOKEN_KEY, value),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const jwt = token.get()
  if (jwt) headers.set('Authorization', `Bearer ${jwt}`)

  const res = await fetch(`${BASE}${path}`, { ...init, headers })

  if (res.status === 204) return undefined as T
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : detail
    } catch {
      /* keep the fallback */
    }
    if (res.status === 401) token.clear()
    throw new ApiError(detail, res.status)
  }
  const type = res.headers.get('content-type') ?? ''
  return (type.includes('json') ? await res.json() : ((await res.blob()) as unknown)) as T
}

const get = <T,>(p: string) => request<T>(p)
const post = <T,>(p: string, body?: unknown) =>
  request<T>(p, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T,>(p: string, body: unknown) =>
  request<T>(p, { method: 'PATCH', body: JSON.stringify(body) })
const del = (p: string) => request<void>(p, { method: 'DELETE' })

export const api = {
  login: (email: string, password: string) =>
    post<{ access_token: string; expires_in: number }>('/api/auth/login', { email, password }),
  forgotPassword: (email: string) => post<{ message: string }>('/api/auth/forgot', { email }),
  resetPassword: (token: string, password: string) =>
    post<{ message: string }>('/api/auth/reset', { token, password }),

  me: () =>
    get<{ id: number; email: string; full_name: string; role: string; team_label: string | null }>(
      '/api/auth/me',
    ),

  viewerAccess: () => get<ViewerAccess>('/api/viewer'),
  setViewerAccess: (body: { email?: string; password?: string }) =>
    post<ViewerAccessCreated>('/api/viewer', body),
  revokeViewerAccess: () => del('/api/viewer'),
  leagues: () => get<League[]>('/api/leagues'),
  league: (id: number) => get<League>(`/api/leagues/${id}`),
  createLeague: (body: Partial<League>) => post<League>('/api/leagues', body),
  updateLeague: (id: number, body: Partial<League>) => patch<League>(`/api/leagues/${id}`, body),

  settings: (id: number) => get<AuctionSettings>(`/api/leagues/${id}/settings`),
  updateSettings: (id: number, body: Partial<AuctionSettings>) =>
    patch<AuctionSettings>(`/api/leagues/${id}/settings`, body),

  teams: (id: number) => get<Team[]>(`/api/leagues/${id}/teams`),
  createTeam: (id: number, body: Partial<Team>) => post<Team>(`/api/leagues/${id}/teams`, body),
  updateTeam: (id: number, teamId: number, body: Partial<Team>) =>
    patch<Team>(`/api/leagues/${id}/teams/${teamId}`, body),
  deleteTeam: (id: number, teamId: number) => del(`/api/leagues/${id}/teams/${teamId}`),

  players: (
    id: number,
    params: { q?: string; role?: PlayerRole; status?: PlayerStatus; team_id?: number; limit?: number } = {},
  ) => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && search.set(k, String(v)))
    return get<Player[]>(`/api/leagues/${id}/players?${search}`)
  },
  player: (id: number, playerId: number) => get<Player>(`/api/leagues/${id}/players/${playerId}`),
  createPlayer: (id: number, body: Partial<Player>) => post<Player>(`/api/leagues/${id}/players`, body),
  retain: (id: number, teamId: number, playerIds: number[]) =>
    post<Player[]>(`/api/leagues/${id}/players/retain`, { team_id: teamId, player_ids: playerIds }),
  release: (id: number, playerId: number) =>
    post<Player>(`/api/leagues/${id}/players/${playerId}/release`),

  importPlayers: (id: number, sheet: File, photos?: File | null) => {
    const form = new FormData()
    form.append('file', sheet)
    if (photos) form.append('photos', photos)
    return request<ImportReport>(`/api/leagues/${id}/players/import`, { method: 'POST', body: form })
  },
  uploadPhotos: (id: number, files: FileList) => {
    const form = new FormData()
    Array.from(files).forEach((f) => form.append('files', f))
    return request<ImportReport>(`/api/leagues/${id}/players/photos`, { method: 'POST', body: form })
  },
  uploadImage: (folder: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ url: string; filename: string }>(`/api/uploads?folder=${folder}`, {
      method: 'POST',
      body: form,
    })
  },

  registrations: (id: number, status?: string) =>
    get<Registration[]>(`/api/leagues/${id}/registrations${status ? `?status_filter=${status}` : ''}`),
  registrationStatus: (id: number) =>
    get<RegistrationSummary>(`/api/leagues/${id}/registrations/status`),
  approveRegistration: (id: number, registrationId: number) =>
    post<Registration>(`/api/leagues/${id}/registrations/${registrationId}/approve`, {}),
  rejectRegistration: (id: number, registrationId: number) =>
    post<Registration>(`/api/leagues/${id}/registrations/${registrationId}/reject`, {}),
  registrationsPdf: (id: number, status?: string) =>
    downloadWithAuth(
      `/api/leagues/${id}/registrations/export.pdf${status ? `?status_filter=${status}` : ''}`,
      'registrations.pdf',
    ),
  approveAllRegistrations: (id: number) =>
    post<RegistrationSummary>(`/api/leagues/${id}/registrations/approve-all`),

  state: (id: number) => get<AuctionState>(`/api/leagues/${id}/auction/state`),
  board: (id: number) => get<Team[]>(`/api/leagues/${id}/auction/board`),
  history: (id: number) => get<Bid[]>(`/api/leagues/${id}/auction/history`),
  start: (id: number) => post<AuctionState>(`/api/leagues/${id}/auction/start`),
  pause: (id: number) => post<AuctionState>(`/api/leagues/${id}/auction/pause`),
  resume: (id: number) => post<AuctionState>(`/api/leagues/${id}/auction/resume`),
  complete: (id: number) => post<AuctionState>(`/api/leagues/${id}/auction/complete`),
  nextRound: (id: number) => post<AuctionState>(`/api/leagues/${id}/auction/next-round`),
  nextPlayer: (id: number) => post<Player>(`/api/leagues/${id}/auction/next-player`),
  bid: (id: number, teamId: number, amount?: number) =>
    post<AuctionState>(`/api/leagues/${id}/auction/bid`, { team_id: teamId, amount }),
  undoBid: (id: number) => post<AuctionState>(`/api/leagues/${id}/auction/undo-bid`),
  sold: (id: number) => post<Player>(`/api/leagues/${id}/auction/sold`),
  sellDirect: (id: number, teamId: number, amount: number) =>
    post<Player>(`/api/leagues/${id}/auction/sell`, { team_id: teamId, amount }),
  unsold: (id: number) => post<Player>(`/api/leagues/${id}/auction/unsold`),
  retainCurrent: (id: number, teamId: number) =>
    post<Player>(`/api/leagues/${id}/auction/retain-current`, { team_id: teamId }),
  notAvailable: (id: number) => post<Player>(`/api/leagues/${id}/auction/not-available`),
  assignPlayer: (id: number, playerId: number, teamId: number, amount?: number) =>
    post<Player>(`/api/leagues/${id}/auction/assign`, {
      player_id: playerId,
      team_id: teamId,
      amount,
    }),
  reauctionPlayer: (id: number, playerId: number) =>
    post<Player>(`/api/leagues/${id}/auction/reauction/${playerId}`),
  updatePlayer: (id: number, playerId: number, body: Partial<Player>) =>
    patch<Player>(`/api/leagues/${id}/players/${playerId}`, body),
  restorePlayer: (id: number, playerId: number) =>
    post<Player>(`/api/leagues/${id}/auction/restore/${playerId}`),
  undoSale: (id: number) => post<Player>(`/api/leagues/${id}/auction/undo-sale`),

  results: (id: number) => get<LeagueResults>(`/api/leagues/${id}/results`),

  analytics: (id: number) => get<Analytics>(`/api/leagues/${id}/analytics`),
  exportUrl: (id: number) => `${BASE}/api/leagues/${id}/export/results.xlsx`,

  contact: (body: { name: string; email: string; phone?: string; message: string }) =>
    post<{ message: string }>('/api/contact', body),
  sponsors: (leagueId?: number) =>
    get<{ id: number; name: string; logo_url: string | null; website: string | null; tier: string | null }[]>(
      `/api/sponsors${leagueId ? `?league_id=${leagueId}` : ''}`,
    ),
  gallery: (leagueId?: number) =>
    get<{ id: number; image_url: string; caption: string | null; category: string | null }[]>(
      `/api/gallery${leagueId ? `?league_id=${leagueId}` : ''}`,
    ),
}

/**
 * Download a file from an endpoint that needs the admin token.
 *
 * A plain <a href> can't carry an Authorization header, so the file is fetched
 * as a blob and handed to the browser through a temporary object URL.
 */
export async function downloadWithAuth(path: string, fallbackName: string): Promise<void> {
  const jwt = token.get()
  const res = await fetch(`${BASE}${path}`, {
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
  })
  if (!res.ok) {
    let detail = `That download failed (${res.status}).`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* keep the fallback */
    }
    throw new ApiError(detail, res.status)
  }

  // Prefer the filename the server chose.
  const disposition = res.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = match?.[1] ?? fallbackName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function socketUrl(leagueId: number): string {
  const base = BASE || window.location.origin
  // A browser can't set headers on a WebSocket, so the JWT rides in the query
  // string. Same token, same checks on the server.
  const jwt = token.get()
  const suffix = jwt ? `?token=${encodeURIComponent(jwt)}` : ''
  return `${base.replace(/^http/, 'ws')}/api/leagues/${leagueId}/auction/ws${suffix}`
}
