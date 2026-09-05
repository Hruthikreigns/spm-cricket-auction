import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import PasswordReset, User
from ..schemas import ForgotPasswordIn, LoginRequest, PlainMessage, ResetPasswordIn, Token, UserOut
from ..security import create_access_token, get_current_user, hash_password, verify_password
from ..services import mailer

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That email and password don't match.")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled.")
    token, expires_in = create_access_token(user.email, user.role)
    return Token(access_token=token, expires_in=expires_in)


@router.post("/forgot", response_model=PlainMessage)
def forgot_password(
    payload: ForgotPasswordIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Email a reset link.

    Always answers the same way, whether or not the address has an account.
    A login page that says "no such user" is a way of finding out who has one.
    """
    reply = PlainMessage(
        message=(
            "If that address has an account, a reset link is on its way. "
            "It expires in "
            f"{settings.reset_token_minutes} minutes."
        )
    )

    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()
    if not user:
        return reply

    # Any earlier links stop working the moment a new one is asked for.
    db.query(PasswordReset).filter(
        PasswordReset.user_id == user.id, PasswordReset.used_at.is_(None)
    ).delete()

    raw = secrets.token_urlsafe(32)
    db.add(
        PasswordReset(
            user_id=user.id,
            # Only the hash is stored, so a stolen database is not a set of
            # working reset links.
            token_hash=hashlib.sha256(raw.encode()).hexdigest(),
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=settings.reset_token_minutes),
        )
    )
    db.commit()

    link = f"{settings.app_base_url.rstrip('/')}/reset-password?token={raw}"
    subject, body = mailer.reset_email(user.full_name or "there", link, settings.reset_token_minutes)
    # Sent after the response, so a slow mail server doesn't hold anyone up —
    # and so the timing of the reply doesn't reveal whether an account exists.
    background.add_task(mailer.send, user.email, subject, body)
    return reply


@router.post("/reset", response_model=PlainMessage)
def reset_password(payload: ResetPasswordIn, db: Session = Depends(get_db)):
    """Set a new password using the emailed link."""
    token_hash = hashlib.sha256(payload.token.strip().encode()).hexdigest()
    row = (
        db.query(PasswordReset)
        .filter(PasswordReset.token_hash == token_hash, PasswordReset.used_at.is_(None))
        .first()
    )
    # SQLite hands back naive datetimes even for timezone-aware columns, so
    # normalise before comparing or this raises rather than expiring.
    expires = row.expires_at if row else None
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)

    if not row or expires < datetime.now(timezone.utc):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That link has expired or has already been used. Ask for a new one.",
        )

    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That account is no longer active.")

    user.hashed_password = hash_password(payload.password)
    row.used_at = datetime.now(timezone.utc)
    db.commit()
    return PlainMessage(message="Password changed. You can sign in with it now.")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
