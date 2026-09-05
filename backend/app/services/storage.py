"""Where uploaded images live.

On a rented server, files on disk are fine. On a managed platform — Render,
Railway, Fly — the filesystem is wiped on every redeploy, so player photos
would quietly disappear between one deploy and the next. That is a bad way to
lose 400 portraits.

So images go in the database instead. They are already optimised to about
20KB each on the way in, which makes 400 players roughly 8MB — small enough
that this costs nothing and removes the need for a persistent disk or an S3
bucket.

Reads fall back to disk, so anything uploaded before this existed still
serves, and a plain-VPS deployment with an existing uploads folder keeps
working untouched.
"""

import logging
from pathlib import Path

from sqlalchemy.orm import Session

from ..config import settings
from ..models import StoredFile

log = logging.getLogger(__name__)

# Generous for an optimised image, small enough that a stray upload can't
# bloat the database.
MAX_STORED_BYTES = 4 * 1024 * 1024

CONTENT_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
}


def content_type_for(path: str) -> str:
    return CONTENT_TYPES.get(Path(path).suffix.lower(), "application/octet-stream")


def save(db: Session, path: str, data: bytes) -> str:
    """Store an image and return the URL it will be served at.

    `path` is the public path, e.g. /uploads/players/abc.jpg — the same string
    that goes into player.photo_url, so nothing downstream needs to know where
    the bytes actually live.
    """
    if len(data) > MAX_STORED_BYTES:
        raise ValueError(f"{path} is {len(data)} bytes, over the {MAX_STORED_BYTES} limit")

    existing = db.query(StoredFile).filter(StoredFile.path == path).first()
    if existing:
        existing.data = data
        existing.size = len(data)
        existing.content_type = content_type_for(path)
    else:
        db.add(
            StoredFile(
                path=path,
                data=data,
                size=len(data),
                content_type=content_type_for(path),
            )
        )
    return path


def load(db: Session, path: str) -> tuple[bytes, str] | None:
    """Fetch an image: database first, then disk for anything older."""
    row = db.query(StoredFile).filter(StoredFile.path == path).first()
    if row:
        return row.data, row.content_type

    # Legacy: uploaded before images moved into the database, or a deployment
    # that has always used a real disk.
    relative = path.removeprefix("/uploads/").lstrip("/")
    if ".." in relative:
        return None
    on_disk = Path(settings.upload_dir) / relative
    try:
        if on_disk.is_file():
            return on_disk.read_bytes(), content_type_for(path)
    except OSError as exc:  # noqa: BLE001
        log.warning("could not read %s from disk: %s", on_disk, exc)
    return None


def delete(db: Session, path: str) -> None:
    db.query(StoredFile).filter(StoredFile.path == path).delete()
