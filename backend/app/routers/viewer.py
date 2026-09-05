"""The shared watching login.

One id and password between all the squad owners, rather than an account each.
The organiser sets it in Setup and reads it out; anyone with it can watch the
live room and do nothing else.

The limit is on people watching at once, not on accounts — see
websocket.ConnectionManager. Thirty viewers can be connected at a time; the
thirty-first is turned away rather than quietly degrading the room for
everybody.
"""

import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import User
from ..schemas import ViewerAccess, ViewerAccessCreated, ViewerAccessIn
from ..security import hash_password, require_admin

router = APIRouter(prefix="/api/viewer", tags=["viewer"])

# No look-alike characters: this gets read out and typed on phones.
ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"

# The one watching account. Its email is the login id and can be changed.
VIEWER_ROLE = "owner"


def make_password(length: int = 8) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def get_viewer(db: Session) -> User | None:
    return db.query(User).filter(User.role == VIEWER_ROLE).first()


@router.get("", response_model=ViewerAccess)
def read_access(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Whether a watching login exists, and what the id is.

    Never the password — that is only readable at the moment it is set.
    """
    viewer = get_viewer(db)
    return ViewerAccess(
        exists=viewer is not None,
        email=viewer.email if viewer else None,
        is_active=bool(viewer and viewer.is_active),
        max_viewers=settings.max_live_viewers,
    )


@router.post("", response_model=ViewerAccessCreated)
def set_access(
    payload: ViewerAccessIn | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Create the watching login, or give it a new password.

    Re-running this replaces the password, which is how you shut out anyone
    who shouldn't have it any more — everybody else just needs the new one.
    """
    email = ((payload.email if payload else None) or "").strip().lower()
    password = ((payload.password if payload else None) or "").strip() or make_password()
    if len(password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Passwords need at least six characters.")

    viewer = get_viewer(db)
    if email and viewer and viewer.email != email:
        clash = db.query(User).filter(User.email == email, User.id != viewer.id).first()
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "Another account already uses that id.")

    if viewer is None:
        email = email or "owners@auction.local"
        if db.query(User).filter(User.email == email).first():
            raise HTTPException(status.HTTP_409_CONFLICT, "Another account already uses that id.")
        viewer = User(
            email=email,
            full_name="Squad owners",
            hashed_password=hash_password(password),
            role=VIEWER_ROLE,
        )
        db.add(viewer)
    else:
        if email:
            viewer.email = email
        viewer.hashed_password = hash_password(password)
        viewer.is_active = True

    db.commit()
    db.refresh(viewer)
    return ViewerAccessCreated(
        exists=True,
        email=viewer.email,
        is_active=viewer.is_active,
        max_viewers=settings.max_live_viewers,
        # Shown once. Not stored in readable form.
        password=password,
    )


@router.delete("", status_code=204)
def revoke(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Remove the watching login entirely. Only the organiser can watch after."""
    viewer = get_viewer(db)
    if viewer:
        db.delete(viewer)
        db.commit()
