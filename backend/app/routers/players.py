from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..models import Player, PlayerRole, PlayerStatus, User
from ..schemas import PlayerImportReport, PlayerIn, PlayerOut, PlayerUpdate, RetainRequest
from ..security import require_admin
from ..services import auction as engine
from ..services import importer
from ..services.state import public_player

router = APIRouter(prefix="/api/leagues/{league_id}/players", tags=["players"])

UPLOAD_ROOT = Path(settings.upload_dir)
PUBLIC_PREFIX = "/uploads"


@router.get("", response_model=list[PlayerOut])
def list_players(
    league_id: int,
    q: str | None = Query(None, description="Search by name, place or mobile"),
    role: PlayerRole | None = None,
    status_filter: PlayerStatus | None = Query(None, alias="status"),
    team_id: int | None = None,
    limit: int = Query(200, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """The player register. Organisers only.

    The public sees players through a league's result — squads and prices at
    /results — rather than as a searchable directory of everyone who signed up.
    """
    query = db.query(Player).options(joinedload(Player.team)).filter(Player.league_id == league_id)
    if q:
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(Player.name.ilike(term), Player.place.ilike(term), Player.mobile.ilike(term))
        )
    if role:
        query = query.filter(Player.role == role)
    if status_filter:
        query = query.filter(Player.status == status_filter)
    if team_id:
        query = query.filter(Player.team_id == team_id)
    rows = query.order_by(Player.name).offset(offset).limit(limit).all()
    # Only organisers reach this, so contact details come through.
    return [public_player(p, True) for p in rows]


@router.get("/{player_id}", response_model=PlayerOut)
def get_player(
    league_id: int,
    player_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    player = db.get(Player, player_id)
    if not player or player.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player isn't in this league.")
    return public_player(player, True)


@router.post("", response_model=PlayerOut, status_code=201)
def create_player(
    league_id: int, payload: PlayerIn, db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    clash = (
        db.query(Player)
        .filter(
            Player.league_id == league_id,
            or_(
                Player.name == payload.name,
                (Player.mobile == payload.mobile) if payload.mobile else False,
            ),
        )
        .first()
    )
    if clash:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{clash.name} is already registered with that name or mobile number.",
        )
    player = Player(league_id=league_id, **payload.model_dump())
    db.add(player)
    db.commit()
    db.refresh(player)
    return player


@router.patch("/{player_id}", response_model=PlayerOut)
def update_player(
    league_id: int,
    player_id: int,
    payload: PlayerUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    player = db.get(Player, player_id)
    if not player or player.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player isn't in this league.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(player, field, value)
    db.commit()
    db.refresh(player)
    return player


@router.delete("/{player_id}", status_code=204)
def delete_player(
    league_id: int, player_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    player = db.get(Player, player_id)
    if not player or player.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player isn't in this league.")
    if player.status in (PlayerStatus.SOLD, PlayerStatus.RETAINED):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{player.name} belongs to a squad. Undo the purchase before deleting.",
        )
    db.delete(player)
    db.commit()


# --------------------------------------------------------------------------
# Bulk import
# --------------------------------------------------------------------------
@router.post("/import", response_model=PlayerImportReport)
async def import_from_excel(
    league_id: int,
    file: UploadFile = File(..., description="XLSX with the player register"),
    photos: UploadFile | None = File(None, description="Optional ZIP of player photos"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Import the player register, then match photos by filename."""
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload an .xlsx file.")

    content = await file.read()
    rows = importer.read_players_excel(content)
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player rows were found in that sheet.")

    created, skipped, errors = importer.import_players(db, league_id, rows)

    matched = 0
    if photos is not None:
        blob = await photos.read()
        if not photos.filename.lower().endswith(".zip"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Send the photos as a single .zip file.")
        files = importer.unpack_archive(blob)
        matched, unmatched = importer.attach_photos(db, league_id, files, UPLOAD_ROOT, PUBLIC_PREFIX)
        errors += [f"No player matched the photo {name}." for name in unmatched[:25]]

    engine.log_action(
        db, league_id, admin.email, "players.import", f"{created} added, {skipped} skipped"
    )
    db.commit()
    return PlayerImportReport(created=created, skipped=skipped, photos_matched=matched, errors=errors)


@router.post("/photos", response_model=PlayerImportReport)
async def upload_photos(
    league_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Bulk photo upload for players already imported. Matches on filename."""
    payload: dict[str, bytes] = {}
    for item in files:
        blob = await item.read()
        if len(blob) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"{item.filename} is over the {settings.max_upload_mb}MB limit.",
            )
        payload[item.filename] = blob

    matched, unmatched = importer.attach_photos(db, league_id, payload, UPLOAD_ROOT, PUBLIC_PREFIX)
    return PlayerImportReport(
        created=0,
        skipped=len(unmatched),
        photos_matched=matched,
        errors=[f"No player matched the photo {name}." for name in unmatched[:25]],
    )


# --------------------------------------------------------------------------
# Retentions
# --------------------------------------------------------------------------
@router.post("/retain", response_model=list[PlayerOut])
def retain(
    league_id: int,
    payload: RetainRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return engine.retain_players(
        db, league_id, payload.team_id, payload.player_ids, payload.price, admin.email
    )


@router.post("/{player_id}/release", response_model=PlayerOut)
def release(
    league_id: int, player_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    return engine.release_retention(db, league_id, player_id, admin.email)
