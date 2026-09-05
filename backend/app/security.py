from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return pwd_context.verify(raw, hashed)


def create_access_token(subject: str, role: str = "admin") -> tuple[str, int]:
    expires_delta = timedelta(minutes=settings.access_token_expire_minutes)
    expire = datetime.now(timezone.utc) + expires_delta
    payload = {"sub": subject, "role": role, "exp": expire, "iat": datetime.now(timezone.utc)}
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(expires_delta.total_seconds())


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Sign in again.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That sign-in token isn't valid.")


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    payload = decode_token(creds.credentials)
    user = db.query(User).filter(User.email == payload.get("sub")).first()
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This account is no longer active.")
    return user


def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Identify the caller if they're signed in, without demanding it.

    Used by pages that are public but show more to an organiser — the auction
    archive shows everyone the prices, and shows an admin the phone numbers.
    """
    if creds is None:
        return None
    try:
        payload = decode_token(creds.credentials)
    except HTTPException:
        return None
    user = db.query(User).filter(User.email == payload.get("sub")).first()
    return user if user and user.is_active else None


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access is required for this action.")
    return user


def require_viewer(user: User = Depends(get_current_user)) -> User:
    """Anyone with an account: the organiser, or a squad owner.

    The live room sits behind this, so bidding in progress is seen by the
    people in the auction rather than the whole internet.
    """
    if user.role not in ("admin", "owner"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account can't watch the auction.")
    return user


def user_from_token(token: str | None, db: Session) -> User | None:
    """Authenticate a WebSocket, which can't carry an Authorization header.

    The same JWT arrives as a query parameter instead.
    """
    if not token:
        return None
    try:
        payload = decode_token(token)
    except HTTPException:
        return None
    user = db.query(User).filter(User.email == payload.get("sub")).first()
    return user if user and user.is_active and user.role in ("admin", "owner") else None
