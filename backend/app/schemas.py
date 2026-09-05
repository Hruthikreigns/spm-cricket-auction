from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import AuctionStatus, LeagueStatus, PlayerRole, PlayerStatus, RegistrationStatus


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
class LoginRequest(BaseModel):
    # Deliberately a plain string: self-hosted installs often use an
    # intranet address that strict email validation would reject.
    email: str
    password: str


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    password: str = Field(..., min_length=6, max_length=200)


class PlainMessage(BaseModel):
    message: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class ViewerAccessIn(BaseModel):
    """Set the shared watching login. Blank password generates one."""

    email: str | None = None
    password: str | None = None


class ViewerAccess(BaseModel):
    exists: bool
    email: str | None = None
    is_active: bool = False
    max_viewers: int


class ViewerAccessCreated(ViewerAccess):
    """Carries the password, so it is only ever returned to the organiser who
    just set it."""

    password: str


class UserOut(ORMBase):
    id: int
    email: str
    full_name: str
    role: str
    team_label: str | None = None


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------
class AuctionSettingsIn(BaseModel):
    purse_amount: int | None = Field(None, gt=0)
    min_players: int | None = Field(None, gt=0)
    max_players: int | None = Field(None, gt=0)
    retain_price: int | None = Field(None, ge=0)
    max_retained: int | None = Field(None, ge=0)
    base_price: int | None = Field(None, ge=0)
    bid_increment: int | None = Field(None, gt=0)
    timer_seconds: int | None = Field(None, gt=0)
    enforce_squad_reserve: bool | None = None


class AuctionSettingsOut(ORMBase):
    purse_amount: int
    min_players: int
    max_players: int
    retain_price: int
    max_retained: int
    base_price: int
    bid_increment: int
    timer_seconds: int
    enforce_squad_reserve: bool


# --------------------------------------------------------------------------
# League
# --------------------------------------------------------------------------
class LeagueIn(BaseModel):
    name: str
    season: str | None = None
    auction_date: datetime | None = None
    venue: str | None = None
    logo_url: str | None = None
    banner_url: str | None = None
    poster_url: str | None = None
    powered_by_name: str | None = None
    powered_by_logo_url: str | None = None
    powered_by_url: str | None = None
    about: str | None = None
    registration_open: bool = True
    show_mobile_publicly: bool = False
    auto_approve_registrations: bool = False
    status: LeagueStatus = LeagueStatus.UPCOMING


class LeagueUpdate(BaseModel):
    name: str | None = None
    season: str | None = None
    auction_date: datetime | None = None
    venue: str | None = None
    logo_url: str | None = None
    banner_url: str | None = None
    poster_url: str | None = None
    powered_by_name: str | None = None
    powered_by_logo_url: str | None = None
    powered_by_url: str | None = None
    about: str | None = None
    registration_open: bool | None = None
    show_mobile_publicly: bool | None = None
    auto_approve_registrations: bool | None = None
    status: LeagueStatus | None = None


class LeagueOut(ORMBase):
    id: int
    name: str
    season: str | None
    auction_date: datetime | None
    venue: str | None
    logo_url: str | None
    banner_url: str | None
    poster_url: str | None
    about: str | None
    powered_by_name: str | None
    powered_by_logo_url: str | None
    powered_by_url: str | None
    registration_open: bool
    show_mobile_publicly: bool
    auto_approve_registrations: bool
    status: LeagueStatus
    settings: AuctionSettingsOut | None = None


# --------------------------------------------------------------------------
# Team
# --------------------------------------------------------------------------
class TeamIn(BaseModel):
    name: str
    short_name: str | None = None
    logo_url: str | None = None
    owner_name: str | None = None
    captain_name: str | None = None
    accent_color: str | None = None
    purse_amount: int | None = None


class TeamUpdate(BaseModel):
    name: str | None = None
    short_name: str | None = None
    logo_url: str | None = None
    owner_name: str | None = None
    captain_name: str | None = None
    accent_color: str | None = None
    purse_amount: int | None = None


class TeamOut(ORMBase):
    id: int
    league_id: int
    name: str
    short_name: str | None
    logo_url: str | None
    owner_name: str | None
    captain_name: str | None
    accent_color: str | None
    purse_amount: int
    spent: int
    remaining_purse: int
    player_count: int
    retained_count: int


# --------------------------------------------------------------------------
# Player
# --------------------------------------------------------------------------
class PlayerIn(BaseModel):
    name: str
    mobile: str | None = None
    place: str | None = None
    role: PlayerRole = PlayerRole.BATSMAN
    jersey_number: int | None = None
    photo_url: str | None = None
    age: int | None = None
    batting_style: str | None = None
    bowling_style: str | None = None


class PlayerUpdate(PlayerIn):
    name: str | None = None


class TeamMini(ORMBase):
    id: int
    name: str
    short_name: str | None
    logo_url: str | None


class PlayerOut(ORMBase):
    id: int
    league_id: int
    name: str
    mobile: str | None
    place: str | None
    role: PlayerRole
    jersey_number: int | None
    photo_url: str | None
    age: int | None
    batting_style: str | None
    bowling_style: str | None
    status: PlayerStatus
    sold_price: int | None
    sold_at: datetime | None
    auction_round: int | None
    team: TeamMini | None = None


class PlayerImportReport(BaseModel):
    created: int
    skipped: int
    photos_matched: int
    errors: list[str] = []


class RetainRequest(BaseModel):
    player_ids: list[int]
    team_id: int
    price: int | None = None


# --------------------------------------------------------------------------
# Self-registration
# --------------------------------------------------------------------------
class RegistrationIn(BaseModel):
    name: str = Field(..., min_length=2, max_length=140)
    mobile: str = Field(..., min_length=6, max_length=20)
    email: EmailStr
    place: str | None = None
    role: PlayerRole = PlayerRole.BATSMAN
    jersey_number: int | None = Field(None, ge=0, le=999)
    age: int | None = Field(None, ge=8, le=99)
    batting_style: str | None = None
    bowling_style: str | None = None
    note: str | None = Field(None, max_length=500)


class RegistrationOut(ORMBase):
    id: int
    league_id: int
    name: str
    mobile: str
    email: str | None
    place: str | None
    role: PlayerRole
    jersey_number: int | None
    age: int | None
    batting_style: str | None
    bowling_style: str | None
    photo_url: str | None
    note: str | None
    status: RegistrationStatus
    review_note: str | None
    player_id: int | None
    created_at: datetime


class KnownPlayer(BaseModel):
    """What comes back when a returning player types their mobile number.

    Deliberately not the email address. This endpoint is public — anyone can
    call it with a number they happen to know — so returning a full contact
    record would turn the registration form into a lookup service for other
    people's details. The email is masked for display, and if the player
    submits without changing it the stored one is reused server-side.
    """

    found: bool
    name: str | None = None
    role: PlayerRole | None = None
    place: str | None = None
    jersey_number: int | None = None
    photo_url: str | None = None
    email_masked: str | None = None
    last_league: str | None = None


class RegistrationReceipt(BaseModel):
    """What the person who just signed up sees."""

    id: int
    name: str
    status: RegistrationStatus
    message: str
    # Link to their own registration card. Carries the token, so it works
    # without an account and only for this one entry.
    card_url: str


class ReviewRequest(BaseModel):
    note: str | None = Field(None, max_length=240)


class RegistrationSummary(BaseModel):
    pending: int
    approved: int
    rejected: int
    open: bool
    # Split so the UI can say *why* it's shut: the organiser closed it, or the
    # auction has started.
    closed_by_admin: bool = False
    league_status: LeagueStatus | None = None
    share_path: str


# --------------------------------------------------------------------------
# Auction
# --------------------------------------------------------------------------
class BidIn(BaseModel):
    team_id: int
    amount: int | None = None  # omit to auto-apply the configured increment


class DirectSaleIn(BaseModel):
    """Record a completed sale without stepping through each bid."""

    team_id: int
    amount: int = Field(..., gt=0)


class AssignIn(BaseModel):
    """Place a named player into a squad, outside the normal bidding flow."""

    player_id: int
    team_id: int
    amount: int | None = Field(None, gt=0)


class RetainCurrentIn(BaseModel):
    """Retain the player on the block; the price comes from league settings."""

    team_id: int


class BidOut(ORMBase):
    id: int
    player_id: int
    team_id: int
    amount: int
    auction_round: int
    is_winning: bool
    voided: bool
    created_at: datetime
    team: TeamMini | None = None


class AuctionStateOut(BaseModel):
    league_id: int
    status: AuctionStatus
    current_round: int
    current_player: PlayerOut | None = None
    current_bid: int | None = None
    current_team: TeamMini | None = None
    timer_ends_at: datetime | None = None
    next_bid_amount: int | None = None
    bid_history: list[BidOut] = []
    remaining_in_pool: int = 0
    eligible_team_ids: list[int] = []


class SoldResult(BaseModel):
    player: PlayerOut
    team: TeamMini | None
    price: int | None
    message: str


# --------------------------------------------------------------------------
# Archive — the record of a finished auction
# --------------------------------------------------------------------------
class RegistrationDetail(BaseModel):
    """What a player gave when they signed up.

    `mobile` and `note` are None unless the caller is a signed-in organiser.
    """

    registered_at: datetime
    mobile: str | None = None
    email: str | None = None
    note: str | None = None
    place: str | None = None
    age: int | None = None
    batting_style: str | None = None
    bowling_style: str | None = None
    submitted_photo_url: str | None = None
    status: RegistrationStatus


class ArchivedPlayer(BaseModel):
    id: int
    name: str
    role: PlayerRole
    place: str | None
    jersey_number: int | None
    photo_url: str | None
    age: int | None
    batting_style: str | None
    bowling_style: str | None
    status: PlayerStatus
    sold_price: int | None
    sold_at: datetime | None
    auction_round: int | None
    bid_count: int
    registration: RegistrationDetail | None = None


class SquadResult(BaseModel):
    team: TeamMini
    owner_name: str | None
    captain_name: str | None
    purse_amount: int
    spent: int
    remaining_purse: int
    player_count: int
    retained_count: int
    most_expensive: int | None
    players: list[ArchivedPlayer]


class ResultsSummary(BaseModel):
    total_players: int
    sold_players: int
    retained_players: int
    unsold_players: int
    total_spent: int
    highest_price: int | None
    average_price: int | None
    most_expensive_player: str | None
    most_expensive_team: str | None
    registrations_received: int


class LeagueResults(BaseModel):
    league_id: int
    league_name: str
    season: str | None
    venue: str | None
    auction_date: datetime | None
    status: LeagueStatus
    logo_url: str | None
    poster_url: str | None
    viewer_is_admin: bool
    summary: ResultsSummary
    squads: list[SquadResult]
    unsold: list[ArchivedPlayer]


# --------------------------------------------------------------------------
# Analytics
# --------------------------------------------------------------------------
class RoleBreakdown(BaseModel):
    role: str
    total: int
    sold: int


class TeamSpend(BaseModel):
    team_id: int
    team_name: str
    spent: int
    remaining: int
    players: int


class AnalyticsOut(BaseModel):
    total_players: int
    sold_players: int
    unsold_players: int
    retained_players: int
    available_players: int
    total_teams: int
    total_purse: int
    purse_remaining: int
    total_spent: int
    highest_bid: int | None
    lowest_bid: int | None
    average_price: int | None
    most_expensive_player: PlayerOut | None
    team_spending: list[TeamSpend]
    role_breakdown: list[RoleBreakdown]


# --------------------------------------------------------------------------
# Site content
# --------------------------------------------------------------------------
class SponsorIn(BaseModel):
    name: str
    logo_url: str | None = None
    website: str | None = None
    tier: str | None = None
    league_id: int | None = None


class SponsorOut(SponsorIn, ORMBase):
    id: int


class GalleryIn(BaseModel):
    image_url: str
    caption: str | None = None
    category: str | None = None
    league_id: int | None = None


class GalleryOut(GalleryIn, ORMBase):
    id: int
    created_at: datetime


class ContactIn(BaseModel):
    name: str
    email: EmailStr
    phone: str | None = None
    message: str


class UploadOut(BaseModel):
    url: str
    filename: str
