export type PlayerRole = 'BATSMAN' | 'BOWLER' | 'ALL_ROUNDER' | 'WICKET_KEEPER'
export type PlayerStatus =
  | 'AVAILABLE'
  | 'ON_BLOCK'
  | 'SOLD'
  | 'UNSOLD'
  | 'RETAINED'
  | 'NOT_AVAILABLE'
export type LeagueStatus = 'UPCOMING' | 'LIVE' | 'COMPLETED'
export type AuctionStatus = 'NOT_STARTED' | 'RUNNING' | 'PAUSED' | 'COMPLETED'

export interface AuctionSettings {
  purse_amount: number
  min_players: number
  max_players: number
  retain_price: number
  max_retained: number
  base_price: number
  bid_increment: number
  timer_seconds: number
  enforce_squad_reserve: boolean
}

export interface League {
  id: number
  name: string
  season: string | null
  auction_date: string | null
  venue: string | null
  logo_url: string | null
  banner_url: string | null
  poster_url: string | null
  about: string | null
  registration_open: boolean
  show_mobile_publicly: boolean
  auto_approve_registrations: boolean
  powered_by_name: string | null
  powered_by_logo_url: string | null
  powered_by_url: string | null
  status: LeagueStatus
  settings: AuctionSettings | null
}

export interface TeamMini {
  id: number
  name: string
  short_name: string | null
  logo_url: string | null
}

export interface Team extends TeamMini {
  league_id: number
  owner_name: string | null
  captain_name: string | null
  accent_color: string | null
  purse_amount: number
  spent: number
  remaining_purse: number
  player_count: number
  retained_count: number
}

export interface Player {
  id: number
  league_id: number
  name: string
  mobile: string | null
  place: string | null
  role: PlayerRole
  jersey_number: number | null
  photo_url: string | null
  age: number | null
  batting_style: string | null
  bowling_style: string | null
  status: PlayerStatus
  sold_price: number | null
  sold_at: string | null
  auction_round: number | null
  team: TeamMini | null
}

export interface Bid {
  id: number
  player_id: number
  team_id: number
  amount: number
  auction_round: number
  is_winning: boolean
  voided: boolean
  created_at: string
  team: TeamMini | null
}

export interface AuctionState {
  league_id: number
  status: AuctionStatus
  current_round: number
  current_player: Player | null
  current_bid: number | null
  current_team: TeamMini | null
  timer_ends_at: string | null
  next_bid_amount: number | null
  bid_history: Bid[]
  remaining_in_pool: number
  eligible_team_ids: number[]
}

export interface Analytics {
  total_players: number
  sold_players: number
  unsold_players: number
  retained_players: number
  available_players: number
  total_teams: number
  total_purse: number
  purse_remaining: number
  total_spent: number
  highest_bid: number | null
  lowest_bid: number | null
  average_price: number | null
  most_expensive_player: Player | null
  team_spending: { team_id: number; team_name: string; spent: number; remaining: number; players: number }[]
  role_breakdown: { role: string; total: number; sold: number }[]
}

export interface ImportReport {
  created: number
  skipped: number
  photos_matched: number
  errors: string[]
}

export type RegistrationStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface Registration {
  id: number
  league_id: number
  name: string
  mobile: string
  email: string | null
  place: string | null
  role: PlayerRole
  jersey_number: number | null
  age: number | null
  batting_style: string | null
  bowling_style: string | null
  photo_url: string | null
  note: string | null
  status: RegistrationStatus
  review_note: string | null
  player_id: number | null
  created_at: string
}

export interface RegistrationSummary {
  pending: number
  approved: number
  rejected: number
  open: boolean
  closed_by_admin: boolean
  league_status: LeagueStatus | null
  share_path: string
}

export interface RegistrationDetail {
  registered_at: string
  mobile: string | null
  email: string | null
  note: string | null
  place: string | null
  age: number | null
  batting_style: string | null
  bowling_style: string | null
  submitted_photo_url: string | null
  status: RegistrationStatus
}

export interface ArchivedPlayer {
  id: number
  name: string
  role: PlayerRole
  place: string | null
  jersey_number: number | null
  photo_url: string | null
  age: number | null
  batting_style: string | null
  bowling_style: string | null
  status: PlayerStatus
  sold_price: number | null
  sold_at: string | null
  auction_round: number | null
  bid_count: number
  registration: RegistrationDetail | null
}

export interface SquadResult {
  team: TeamMini
  owner_name: string | null
  captain_name: string | null
  purse_amount: number
  spent: number
  remaining_purse: number
  player_count: number
  retained_count: number
  most_expensive: number | null
  players: ArchivedPlayer[]
}

export interface LeagueResults {
  league_id: number
  league_name: string
  season: string | null
  venue: string | null
  auction_date: string | null
  status: LeagueStatus
  logo_url: string | null
  poster_url: string | null
  viewer_is_admin: boolean
  summary: {
    total_players: number
    sold_players: number
    retained_players: number
    unsold_players: number
    total_spent: number
    highest_price: number | null
    average_price: number | null
    most_expensive_player: string | null
    most_expensive_team: string | null
    registrations_received: number
  }
  squads: SquadResult[]
  unsold: ArchivedPlayer[]
}

export interface ViewerAccess {
  exists: boolean
  email: string | null
  is_active: boolean
  max_viewers: number
}

export interface ViewerAccessCreated extends ViewerAccess {
  /** Shown once, when it's set. Never retrievable afterwards. */
  password: string
}
