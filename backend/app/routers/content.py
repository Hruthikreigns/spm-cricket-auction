import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import ContactMessage, GalleryItem, Sponsor, User
from ..schemas import ContactIn, GalleryIn, GalleryOut, SponsorIn, SponsorOut, UploadOut
from ..security import require_admin
from ..services import storage
from ..services.images import optimise

router = APIRouter(prefix="/api", tags=["content"])

ALLOWED_IMAGE = {".jpg", ".jpeg", ".png", ".webp", ".svg"}

# Which size profile each upload folder gets. Player portraits are never drawn
# larger than a card, so they take the smallest; banners run full width.
PROFILE_BY_FOLDER = {
    "players": "player",
    "registrations": "player",
    "teams": "logo",
    "league": "logo",
}


@router.post("/uploads", response_model=UploadOut)
async def upload_image(
    folder: str = "misc",
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Store a logo, banner or gallery image and hand back its public URL."""
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_IMAGE:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Use one of these image formats: {', '.join(sorted(ALLOWED_IMAGE))}.",
        )
    blob = await file.read()
    if len(blob) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Images need to be under {settings.max_upload_mb}MB.",
        )

    safe_folder = "".join(c for c in folder if c.isalnum() or c in "-_") or "misc"

    # SVG is already small and vector — resizing it would rasterise it.
    if suffix != ".svg":
        blob, new_suffix = optimise(blob, PROFILE_BY_FOLDER.get(safe_folder, "wide"))
        suffix = new_suffix or suffix

    name = f"{uuid.uuid4().hex}{suffix}"
    url = storage.save(db, f"/uploads/{safe_folder}/{name}", blob)
    db.commit()
    return UploadOut(url=url, filename=name)


# --------------------------------------------------------------------------
# Sponsors
# --------------------------------------------------------------------------
@router.get("/sponsors", response_model=list[SponsorOut])
def list_sponsors(league_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(Sponsor)
    if league_id:
        query = query.filter(Sponsor.league_id == league_id)
    return query.order_by(Sponsor.id).all()


@router.post("/sponsors", response_model=SponsorOut, status_code=201)
def create_sponsor(payload: SponsorIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    sponsor = Sponsor(**payload.model_dump())
    db.add(sponsor)
    db.commit()
    db.refresh(sponsor)
    return sponsor


@router.delete("/sponsors/{sponsor_id}", status_code=204)
def delete_sponsor(sponsor_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    sponsor = db.get(Sponsor, sponsor_id)
    if not sponsor:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That sponsor has already been removed.")
    db.delete(sponsor)
    db.commit()


# --------------------------------------------------------------------------
# Gallery
# --------------------------------------------------------------------------
@router.get("/gallery", response_model=list[GalleryOut])
def list_gallery(league_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(GalleryItem)
    if league_id:
        query = query.filter(GalleryItem.league_id == league_id)
    return query.order_by(GalleryItem.created_at.desc()).all()


@router.post("/gallery", response_model=GalleryOut, status_code=201)
def add_gallery_item(payload: GalleryIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    item = GalleryItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/gallery/{item_id}", status_code=204)
def delete_gallery_item(item_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    item = db.get(GalleryItem, item_id)
    if not item:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That image has already been removed.")
    db.delete(item)
    db.commit()


# --------------------------------------------------------------------------
# Contact
# --------------------------------------------------------------------------
@router.post("/contact", status_code=201)
def submit_contact(payload: ContactIn, db: Session = Depends(get_db)):
    db.add(ContactMessage(**payload.model_dump()))
    db.commit()
    return {"message": "Thanks — we'll get back to you soon."}


@router.get("/contact", response_model=list[dict])
def list_messages(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    rows = db.query(ContactMessage).order_by(ContactMessage.created_at.desc()).limit(200).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "email": r.email,
            "phone": r.phone,
            "message": r.message,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
