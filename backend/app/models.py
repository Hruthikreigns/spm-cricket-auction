import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    LargeBinary,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


# --------------------------------------------------------------------------
# Enums
# --------------------------------------------------------------------------
class PlayerRole(str, enum.Enum):
    BATSMAN = "BATSMAN"
    BOWLER = "BOWLER"
    ALL_ROUNDER = "ALL_ROUNDER"
    WICKET_KEEPER = "WICKET_KEEPER"


class PlayerStatus(str, enum.Enum):
    AVAILABLE = "AVAILABLE"      # in the pool, not yet called
    ON_BLOCK = "ON_BLOCK"        # currently being auctioned
    SOLD = "SOLD"
    UNSOLD = "UNSOLD"            # called, but nobody bid
    RETAINED = "RETAINED"        # kept by a team rather than auctioned
    NOT_AVAILABLE = "NOT_AVAILABLE"  # withdrawn or didn't turn up


class RegistrationStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class LeagueStatus(str, enum.Enum):
    UPCOMING = "UPCOMING"
    LIVE = "LIVE"
    COMPLETED = "COMPLETED"


class AuctionStatus(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), default="Administrator")
    hashed_password: Mapped[str] = mapped_column(String(255))
    # "admin" runs the auction; "owner" is a squad owner who may watch the
    # live room and nothing else.
    role: Mapped[str] = mapped_column(String(20), default="admin")
    # Which squad this owner represents. Informational — it grants nothing.
    team_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --------------------------------------------------------------------------
# League
# --------------------------------------------------------------------------
class League(Base):
    __tablename__ = "leagues"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    season: Mapped[str | None] = mapped_column(String(60), nullable=True)
    auction_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    venue: Mapped[str | None] = mapped_column(String(200), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    banner_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    # The tournament poster: prizes, dates, ground. Shown whole rather than
    # cropped, since these are usually designed as one piece of artwork.
    poster_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    about: Mapped[str | None] = mapped_column(Text, nullable=True)

    # "Powered by" credit — a sponsor or the organising club.
    powered_by_name: Mapped[str | None] = mapped_column(String(140), nullable=True)
    powered_by_logo_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    powered_by_url: Mapped[str | None] = mapped_column(String(400), nullable=True)

    # Organisers can shut the form at any point. The auction status closes it
    # automatically too — see registrations.is_open().
    registration_open: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    # Off by default: the live screen is public, and a wall of phone numbers
    # is not something to publish by accident. Some local leagues do want it,
    # so squad owners can ring players directly.
    show_mobile_publicly: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0"
    )
    # When on, a registration joins the auction pool immediately instead of
    # waiting in the review queue.
    auto_approve_registrations: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0"
    )
    status: Mapped[LeagueStatus] = mapped_column(Enum(LeagueStatus), default=LeagueStatus.UPCOMING)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    teams: Mapped[list["Team"]] = relationship(back_populates="league", cascade="all, delete-orphan")
    players: Mapped[list["Player"]] = relationship(back_populates="league", cascade="all, delete-orphan")
    settings: Mapped["AuctionSettings"] = relationship(
        back_populates="league", uselist=False, cascade="all, delete-orphan"
    )
    session: Mapped["AuctionSession"] = relationship(
        back_populates="league", uselist=False, cascade="all, delete-orphan"
    )


class AuctionSettings(Base):
    """Per-league knobs. Every rule in the brief is configurable here."""

    __tablename__ = "auction_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), unique=True)

    purse_amount: Mapped[int] = mapped_column(Integer, default=100_000)
    min_players: Mapped[int] = mapped_column(Integer, default=15)
    max_players: Mapped[int] = mapped_column(Integer, default=18)
    retain_price: Mapped[int] = mapped_column(Integer, default=3_000)
    # How many players one squad may keep before the auction.
    max_retained: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    base_price: Mapped[int] = mapped_column(Integer, default=1_000)
    bid_increment: Mapped[int] = mapped_column(Integer, default=500)
    timer_seconds: Mapped[int] = mapped_column(Integer, default=30)
    # When true a team must keep back base_price for each unfilled slot
    # below min_players, so nobody can spend their way out of a legal squad.
    enforce_squad_reserve: Mapped[bool] = mapped_column(Boolean, default=True)

    league: Mapped[League] = relationship(back_populates="settings")


# --------------------------------------------------------------------------
# Team
# --------------------------------------------------------------------------
class Team(Base):
    __tablename__ = "teams"
    __table_args__ = (UniqueConstraint("league_id", "name", name="uq_team_name_per_league"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    short_name: Mapped[str | None] = mapped_column(String(12), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    owner_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    captain_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    accent_color: Mapped[str | None] = mapped_column(String(9), nullable=True)

    purse_amount: Mapped[int] = mapped_column(Integer, default=100_000)
    spent: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    league: Mapped[League] = relationship(back_populates="teams")
    players: Mapped[list["Player"]] = relationship(back_populates="team")

    # -- derived --
    @property
    def remaining_purse(self) -> int:
        return self.purse_amount - self.spent

    @property
    def player_count(self) -> int:
        return len([p for p in self.players if p.status in (PlayerStatus.SOLD, PlayerStatus.RETAINED)])

    @property
    def retained_count(self) -> int:
        return len([p for p in self.players if p.status == PlayerStatus.RETAINED])


# --------------------------------------------------------------------------
# Player
# --------------------------------------------------------------------------
class Player(Base):
    __tablename__ = "players"
    __table_args__ = (
        UniqueConstraint("league_id", "mobile", name="uq_player_mobile_per_league"),
        UniqueConstraint("league_id", "name", name="uq_player_name_per_league"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)

    name: Mapped[str] = mapped_column(String(140), index=True)
    mobile: Mapped[str | None] = mapped_column(String(20), nullable=True)
    place: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role: Mapped[PlayerRole] = mapped_column(Enum(PlayerRole), default=PlayerRole.BATSMAN)
    jersey_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    batting_style: Mapped[str | None] = mapped_column(String(60), nullable=True)
    bowling_style: Mapped[str | None] = mapped_column(String(60), nullable=True)

    status: Mapped[PlayerStatus] = mapped_column(
        Enum(PlayerStatus), default=PlayerStatus.AVAILABLE, index=True
    )
    sold_price: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sold_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auction_round: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Position in the shuffled call order. Set once when the auction starts.
    queue_position: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    league: Mapped[League] = relationship(back_populates="players")
    team: Mapped[Team | None] = relationship(back_populates="players")
    bids: Mapped[list["Bid"]] = relationship(
        back_populates="player", cascade="all, delete-orphan", order_by="Bid.id"
    )


# --------------------------------------------------------------------------
# Auction session + bids
# --------------------------------------------------------------------------
class AuctionSession(Base):
    """One live auction per league. Holds the state the big screen reads from."""

    __tablename__ = "auction_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), unique=True)
    status: Mapped[AuctionStatus] = mapped_column(Enum(AuctionStatus), default=AuctionStatus.NOT_STARTED)
    current_round: Mapped[int] = mapped_column(Integer, default=1)

    current_player_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True
    )
    current_bid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True
    )
    timer_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    league: Mapped[League] = relationship(back_populates="session")
    current_player: Mapped[Player | None] = relationship(foreign_keys=[current_player_id])
    current_team: Mapped[Team | None] = relationship(foreign_keys=[current_team_id])


class Bid(Base):
    """Append-only ledger. Nothing is deleted; an undo writes a void marker."""

    __tablename__ = "bids"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"))
    amount: Mapped[int] = mapped_column(Integer)
    auction_round: Mapped[int] = mapped_column(Integer, default=1)
    is_winning: Mapped[bool] = mapped_column(Boolean, default=False)
    voided: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    player: Mapped[Player] = relationship(back_populates="bids")
    team: Mapped[Team] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), nullable=True)
    actor: Mapped[str] = mapped_column(String(160), default="system")
    action: Mapped[str] = mapped_column(String(80), index=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --------------------------------------------------------------------------
# Self-registration
# --------------------------------------------------------------------------
class Registration(Base):
    """A player signing themselves up, before an organiser has vetted them.

    Deliberately a separate table rather than a Player with a "pending" flag:
    the auction pool stays clean, nobody unvetted can ever be called to the
    block by accident, and adding this to an existing database creates a new
    table instead of altering the one holding live auction data.
    """

    __tablename__ = "registrations"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), index=True)

    name: Mapped[str] = mapped_column(String(140))
    mobile: Mapped[str] = mapped_column(String(20), index=True)
    # Nullable in the table so registrations taken before this field existed
    # stay valid; the API requires it on every new submission.
    email: Mapped[str | None] = mapped_column(String(200), index=True, nullable=True)
    place: Mapped[str | None] = mapped_column(String(120), nullable=True)
    role: Mapped[PlayerRole] = mapped_column(Enum(PlayerRole), default=PlayerRole.BATSMAN)
    jersey_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    batting_style: Mapped[str | None] = mapped_column(String(60), nullable=True)
    bowling_style: Mapped[str | None] = mapped_column(String(60), nullable=True)
    photo_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[RegistrationStatus] = mapped_column(
        Enum(RegistrationStatus), default=RegistrationStatus.PENDING, index=True
    )
    review_note: Mapped[str | None] = mapped_column(String(240), nullable=True)
    # Unguessable handle so a player can fetch their own card without an
    # account. Not a password — it only ever unlocks this one registration.
    card_token: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    player_id: Mapped[int | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    league: Mapped[League] = relationship()


class PasswordReset(Base):
    """A one-shot link for getting back into an account.

    Only the hash of the token is kept, so a copy of the database doesn't hand
    anyone a working reset link. Rows are single-use and short-lived.
    """

    __tablename__ = "password_resets"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship()


class StoredFile(Base):
    """An uploaded image, kept in the database rather than on disk.

    Managed hosting wipes the filesystem on every redeploy, which would take
    the player photos with it. Images are optimised to ~20KB on the way in, so
    a full register is a few megabytes — cheap insurance against losing them.
    """

    __tablename__ = "stored_files"

    id: Mapped[int] = mapped_column(primary_key=True)
    # The public path, e.g. /uploads/players/abc.jpg
    path: Mapped[str] = mapped_column(String(400), unique=True, index=True)
    content_type: Mapped[str] = mapped_column(String(80), default="image/jpeg")
    size: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --------------------------------------------------------------------------
# Site content (public pages)
# --------------------------------------------------------------------------
class Sponsor(Base):
    __tablename__ = "sponsors"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), nullable=True)
    name: Mapped[str] = mapped_column(String(140))
    logo_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    website: Mapped[str | None] = mapped_column(String(400), nullable=True)
    tier: Mapped[str | None] = mapped_column(String(40), nullable=True)


class GalleryItem(Base):
    __tablename__ = "gallery_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    league_id: Mapped[int | None] = mapped_column(ForeignKey("leagues.id", ondelete="CASCADE"), nullable=True)
    image_url: Mapped[str] = mapped_column(String(400))
    caption: Mapped[str | None] = mapped_column(String(240), nullable=True)
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContactMessage(Base):
    __tablename__ = "contact_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(140))
    email: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
