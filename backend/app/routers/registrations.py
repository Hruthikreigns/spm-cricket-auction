"""Player self-registration.

Anyone with the link can sign themselves up; nothing they submit reaches the
auction pool until an organiser approves it. Registration is open only while
the league is UPCOMING, so the form closes by itself once the auction starts.
"""

import re
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import (
    League,
    LeagueStatus,
    Player,
    PlayerRole,
    PlayerStatus,
    Registration,
    RegistrationStatus,
    User,
)
from ..schemas import (
    KnownPlayer,
    RegistrationOut,
    RegistrationReceipt,
    RegistrationSummary,
    ReviewRequest,
)
from ..security import get_optional_user, require_admin
from ..services import auction as engine
from ..services.importer import normalise
from ..services import storage
from ..services.images import optimise
from ..services.pdf import build_registration_card, build_registrations_pdf

router = APIRouter(prefix="/api/leagues/{league_id}/registrations", tags=["registrations"])

ALLOWED_PHOTO = {".jpg", ".jpeg", ".png", ".webp"}
MAX_PER_LEAGUE = 2000

# Crude in-memory throttle against someone scripting the form. The ceiling is
# deliberately generous: at a registration desk one volunteer signs up dozens
# of players from the same phone, and a whole club often shares one wifi, so a
# tight limit would block the normal case and catch almost no abuse.
_recent: dict[str, list[datetime]] = {}
THROTTLE_WINDOW_SECONDS = 300
THROTTLE_MAX = 60


def _clean_email(raw: str) -> str:
    address = (raw or "").strip().lower()
    # Deliberately loose: the point is to catch typos, not to police what a
    # valid address looks like.
    if "@" not in address or "." not in address.split("@")[-1] or len(address) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That email address doesn't look right.")
    return address


def _clean_mobile(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That mobile number doesn't look right.")
    return digits


def _throttle(request: Request) -> None:
    caller = request.client.host if request.client else "unknown"
    now = datetime.now(timezone.utc)
    seen = [t for t in _recent.get(caller, []) if (now - t).total_seconds() < THROTTLE_WINDOW_SECONDS]
    if len(seen) >= THROTTLE_MAX:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "That's a lot of registrations from one device. Try again in a few minutes.",
        )
    seen.append(now)
    _recent[caller] = seen


def is_open(league: League) -> bool:
    """Two ways to be shut: the organiser closed it, or the auction started."""
    return bool(getattr(league, "registration_open", True)) and league.status == LeagueStatus.UPCOMING


def _league_open(db: Session, league_id: int) -> League:
    league = db.get(League, league_id)
    if not league:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That league doesn't exist.")
    if league.status != LeagueStatus.UPCOMING:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Registration for this league has closed."
            if league.status == LeagueStatus.COMPLETED
            else "The auction is already under way, so registration has closed.",
        )
    if not getattr(league, "registration_open", True):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The organisers have closed registration for this league.",
        )
    return league


# --------------------------------------------------------------------------
# Public
# --------------------------------------------------------------------------
@router.post("", response_model=RegistrationReceipt, status_code=201)
async def register(
    request: Request,
    league_id: int,
    name: str = Form(...),
    mobile: str = Form(...),
    # Optional on a repeat: if it's blank we fall back to what this mobile
    # number gave us last time, so nobody has to retype it.
    email: str | None = Form(None),
    place: str | None = Form(None),
    role: PlayerRole = Form(PlayerRole.BATSMAN),
    jersey_number: int | None = Form(None),
    note: str | None = Form(None),
    # Optional at the signature level so a missing photo gets a plain-English
    # message rather than FastAPI's generic validation error.
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    """Sign up for a league. Open to anyone with the link, no account needed."""
    _throttle(request)
    league = _league_open(db, league_id)

    clean_name = (name or "").strip()
    if len(clean_name) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please give your full name.")
    digits = _clean_mobile(mobile)
    if not (place or "").strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please give your place.")

    # Anything this number told us before, in any league.
    previous = (
        db.query(Registration)
        .filter(
            Registration.mobile == digits,
            Registration.status != RegistrationStatus.REJECTED,
        )
        .order_by(Registration.created_at.desc(), Registration.id.desc())
        .first()
    )

    if (email or "").strip():
        address = _clean_email(email)
    elif previous and previous.email:
        address = previous.email
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please give an email address.")

    if db.query(func.count(Registration.id)).filter(Registration.league_id == league_id).scalar() >= MAX_PER_LEAGUE:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This league has reached its registration limit.")

    # Already signed up, or already in the pool from an import?
    dupe = (
        db.query(Registration)
        .filter(
            Registration.league_id == league_id,
            Registration.mobile == digits,
            Registration.status != RegistrationStatus.REJECTED,
        )
        .first()
    )
    if dupe:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"That mobile number is already registered under {dupe.name}.",
        )
    if db.query(Player).filter(Player.league_id == league_id, Player.mobile == digits).first():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "That mobile number is already on the player list for this league.",
        )

    email_clash = (
        db.query(Registration)
        .filter(
            Registration.league_id == league_id,
            func.lower(Registration.email) == address,
            Registration.status != RegistrationStatus.REJECTED,
        )
        .first()
    )
    if email_clash:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"That email address is already registered under {email_clash.name}.",
        )

    # A photo is required — it goes on the big screen when the player is
    # called, and chasing it up afterwards is the organiser's problem. A
    # returning player keeps the one they gave last time unless they upload a
    # new one, so signing up for a second league is a few taps.
    photo_url: str | None = None

    if photo is not None and photo.filename:
        suffix = Path(photo.filename).suffix.lower()
        if suffix not in ALLOWED_PHOTO:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Photos need to be JPG, PNG or WEBP.")
        blob = await photo.read()
        if not blob:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That photo file was empty.")
        if len(blob) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"That photo is over the {settings.max_upload_mb}MB limit.",
            )
        # Resized here rather than kept at phone resolution — see services.images.
        blob, new_suffix = optimise(blob, "player")
        suffix = new_suffix or suffix

        filename = f"{uuid.uuid4().hex}{suffix}"
        photo_url = storage.save(db, f"/uploads/registrations/{filename}", blob)
    elif previous and previous.photo_url:
        # Same file, referenced again. Nothing is copied, so a second entry
        # costs no extra disk.
        photo_url = previous.photo_url
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please add a photo.")

    entry = Registration(
        league_id=league_id,
        name=clean_name,
        mobile=digits,
        email=address,
        place=(place or "").strip() or None,
        role=role,
        jersey_number=jersey_number,
        note=(note or "").strip() or None,
        photo_url=photo_url,
        card_token=secrets.token_urlsafe(24),
    )
    db.add(entry)
    engine.log_action(db, league_id, "public", "registration.created", f"{clean_name} ({digits})")

    # Auto-approval: straight into the pool, no review queue. The duplicate
    # checks above have already run, so this can only ever add someone new.
    if getattr(league, "auto_approve_registrations", False):
        db.flush()
        player = Player(
            league_id=league_id,
            name=entry.name,
            mobile=entry.mobile,
            place=entry.place,
            role=entry.role,
            jersey_number=entry.jersey_number,
            photo_url=entry.photo_url,
            status=PlayerStatus.AVAILABLE,
        )
        db.add(player)
        db.flush()
        entry.status = RegistrationStatus.APPROVED
        entry.player_id = player.id
        entry.reviewed_at = datetime.now(timezone.utc)
        engine.log_action(db, league_id, "system", "registration.auto_approved", entry.name)

    db.commit()
    db.refresh(entry)

    approved = entry.status == RegistrationStatus.APPROVED
    return RegistrationReceipt(
        id=entry.id,
        name=entry.name,
        status=entry.status,
        message=(
            "You're in. Your name is on the player list for this auction."
            if approved
            else "You're registered. The organisers will confirm your entry before auction day."
        ),
        card_url=(
            f"/api/leagues/{league_id}/registrations/{entry.id}/card.pdf?token={entry.card_token}"
        ),
    )


def _mask_email(address: str | None) -> str | None:
    """r***i@example.com — enough to recognise, not enough to harvest."""
    if not address or "@" not in address:
        return None
    local, _, domain = address.partition("@")
    if len(local) <= 2:
        shown = local[0] + "*"
    else:
        shown = f"{local[0]}{'*' * min(len(local) - 2, 4)}{local[-1]}"
    return f"{shown}@{domain}"


@router.get("/lookup", response_model=KnownPlayer)
def lookup(
    request: Request,
    league_id: int,
    mobile: str,
    db: Session = Depends(get_db),
):
    """Have you registered with us before?

    Looks across every league, not just this one, so a player who signed up
    last season gets their details back. Requires the whole number — a partial
    match would let someone fish for records.
    """
    _throttle(request)

    digits = re.sub(r"\D", "", mobile or "")
    if len(digits) < 10:
        # Not an error: the form calls this as they type.
        return KnownPlayer(found=False)

    previous = (
        db.query(Registration)
        .filter(
            Registration.mobile == digits,
            Registration.status != RegistrationStatus.REJECTED,
        )
        .order_by(Registration.created_at.desc(), Registration.id.desc())
        .first()
    )
    if not previous:
        return KnownPlayer(found=False)

    league = db.get(League, previous.league_id)
    return KnownPlayer(
        found=True,
        name=previous.name,
        role=previous.role,
        place=previous.place,
        jersey_number=previous.jersey_number,
        photo_url=previous.photo_url,
        email_masked=_mask_email(previous.email),
        last_league=league.name if league else None,
    )


@router.get("/status", response_model=RegistrationSummary)
def registration_status(league_id: int, db: Session = Depends(get_db)):
    """Whether the form is open, and how many have signed up. Safe to show publicly."""
    league = db.get(League, league_id)
    if not league:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That league doesn't exist.")

    counts = dict(
        db.query(Registration.status, func.count(Registration.id))
        .filter(Registration.league_id == league_id)
        .group_by(Registration.status)
        .all()
    )
    return RegistrationSummary(
        pending=counts.get(RegistrationStatus.PENDING, 0),
        approved=counts.get(RegistrationStatus.APPROVED, 0),
        rejected=counts.get(RegistrationStatus.REJECTED, 0),
        open=is_open(league),
        closed_by_admin=not bool(getattr(league, "registration_open", True)),
        league_status=league.status,
        share_path=f"/register/{league_id}",
    )


# --------------------------------------------------------------------------
# Admin review
# --------------------------------------------------------------------------
@router.get("", response_model=list[RegistrationOut])
def list_registrations(
    league_id: int,
    status_filter: RegistrationStatus | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    query = db.query(Registration).filter(Registration.league_id == league_id)
    if status_filter:
        query = query.filter(Registration.status == status_filter)
    # id breaks the tie: several registrations can share a timestamp to the
    # second, and without it the list reorders itself between refreshes.
    return query.order_by(Registration.created_at.desc(), Registration.id.desc()).limit(1000).all()


@router.get("/{registration_id}/card.pdf")
def registration_card(
    league_id: int,
    registration_id: int,
    token: str | None = None,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
):
    """The player's own registration card.

    Opened either with the token handed out at sign-up — no account, since the
    player hasn't got one — or by a signed-in organiser.
    """
    entry = db.get(Registration, registration_id)
    if not entry or entry.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That registration doesn't exist.")

    if viewer is None:
        # compare_digest so a wrong token can't be narrowed down by timing
        if not token or not entry.card_token or not secrets.compare_digest(token, entry.card_token):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "That link isn't valid. Ask the organisers to send your card again.",
            )

    league = db.get(League, league_id)
    pdf = build_registration_card(league, entry, settings.upload_dir, db=db)
    safe = "".join(c for c in entry.name if c.isalnum() or c in " -").strip().replace(" ", "-")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe.lower()}-registration.pdf"'},
    )


@router.get("/export.pdf")
def export_pdf(
    league_id: int,
    status_filter: RegistrationStatus | None = None,
    photos: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """The registration list as a printable PDF. Organisers only.

    Contact details are on every row, which is the whole point of the document
    — and exactly why it sits behind an admin token.
    """
    league = db.get(League, league_id)
    if not league:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That league doesn't exist.")

    query = db.query(Registration).filter(Registration.league_id == league_id)
    if status_filter:
        query = query.filter(Registration.status == status_filter)
    rows = query.order_by(Registration.name).all()

    pdf = build_registrations_pdf(league, rows, settings.upload_dir, include_photos=photos, db=db)

    label = (status_filter.value.lower() + "-") if status_filter else ""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"{league.name.lower().replace(' ', '-')}-{label}registrations-{stamp}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{registration_id}/approve", response_model=RegistrationOut)
def approve(
    league_id: int,
    registration_id: int,
    payload: ReviewRequest | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Accept a registration, which creates the player in the auction pool."""
    entry = db.get(Registration, registration_id)
    if not entry or entry.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That registration doesn't exist.")
    if entry.status == RegistrationStatus.APPROVED:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{entry.name} has already been approved.")

    clash = (
        db.query(Player)
        .filter(
            Player.league_id == league_id,
            or_(Player.mobile == entry.mobile, func.lower(Player.name) == entry.name.lower()),
        )
        .first()
    )
    if clash:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{clash.name} is already in the pool with that name or mobile number.",
        )

    player = Player(
        league_id=league_id,
        name=entry.name,
        mobile=entry.mobile,
        place=entry.place,
        role=entry.role,
        jersey_number=entry.jersey_number,
        photo_url=entry.photo_url,
        status=PlayerStatus.AVAILABLE,
    )
    db.add(player)
    db.flush()

    entry.status = RegistrationStatus.APPROVED
    entry.player_id = player.id
    entry.review_note = payload.note if payload else None
    entry.reviewed_at = datetime.now(timezone.utc)

    engine.log_action(db, league_id, admin.email, "registration.approved", entry.name)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/{registration_id}/reject", response_model=RegistrationOut)
def reject(
    league_id: int,
    registration_id: int,
    payload: ReviewRequest | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    entry = db.get(Registration, registration_id)
    if not entry or entry.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That registration doesn't exist.")
    if entry.player_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{entry.name} is already in the pool. Remove the player first.",
        )

    entry.status = RegistrationStatus.REJECTED
    entry.review_note = payload.note if payload else None
    entry.reviewed_at = datetime.now(timezone.utc)
    engine.log_action(db, league_id, admin.email, "registration.rejected", entry.name)
    db.commit()
    db.refresh(entry)
    return entry


@router.post("/approve-all", response_model=RegistrationSummary)
def approve_all(
    league_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Accept every pending registration, skipping any that clash."""
    pending = (
        db.query(Registration)
        .filter(Registration.league_id == league_id, Registration.status == RegistrationStatus.PENDING)
        .all()
    )
    existing_mobiles = {p.mobile for p in db.query(Player).filter(Player.league_id == league_id) if p.mobile}
    existing_names = {normalise(p.name) for p in db.query(Player).filter(Player.league_id == league_id)}

    for entry in pending:
        if entry.mobile in existing_mobiles or normalise(entry.name) in existing_names:
            continue
        player = Player(
            league_id=league_id,
            name=entry.name,
            mobile=entry.mobile,
            place=entry.place,
            role=entry.role,
            jersey_number=entry.jersey_number,
            photo_url=entry.photo_url,
            status=PlayerStatus.AVAILABLE,
        )
        db.add(player)
        db.flush()
        entry.status = RegistrationStatus.APPROVED
        entry.player_id = player.id
        entry.reviewed_at = datetime.now(timezone.utc)
        existing_mobiles.add(entry.mobile)
        existing_names.add(normalise(entry.name))

    engine.log_action(db, league_id, admin.email, "registration.approved_all", f"{len(pending)} reviewed")
    db.commit()
    return registration_status(league_id, db)
