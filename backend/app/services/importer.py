"""Bulk player import from Excel, plus photo matching.

The photo matcher is deliberately forgiving: organisers name files things
like "Ravi Kumar.jpg", "ravi_kumar.JPG" or "12.jpg" (jersey number). All
three resolve.
"""

import io
import re
import unicodedata
import zipfile
from pathlib import Path

import pandas as pd
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models import Player, PlayerRole, PlayerStatus
from . import storage
from .images import optimise

# Excel header -> model field. Lower-cased and stripped of non-alphanumerics
# before lookup, so "Player Name", "player_name" and "PLAYERNAME" all match.
COLUMN_MAP = {
    "playername": "name",
    "name": "name",
    "mobilenumber": "mobile",
    "mobile": "mobile",
    "phone": "mobile",
    "place": "place",
    "city": "place",
    "role": "role",
    "jerseynumber": "jersey_number",
    "jerseyno": "jersey_number",
    "jersey": "jersey_number",
    "photo": "photo_file",
    "photofile": "photo_file",
    "image": "photo_file",
    "age": "age",
    "battingstyle": "batting_style",
    "batting": "batting_style",
    "bowlingstyle": "bowling_style",
    "bowling": "bowling_style",
}

ROLE_ALIASES = {
    "batsman": PlayerRole.BATSMAN,
    "batter": PlayerRole.BATSMAN,
    "bat": PlayerRole.BATSMAN,
    "bowler": PlayerRole.BOWLER,
    "bowl": PlayerRole.BOWLER,
    "allrounder": PlayerRole.ALL_ROUNDER,
    "allround": PlayerRole.ALL_ROUNDER,
    "ar": PlayerRole.ALL_ROUNDER,
    "wicketkeeper": PlayerRole.WICKET_KEEPER,
    "keeper": PlayerRole.WICKET_KEEPER,
    "wk": PlayerRole.WICKET_KEEPER,
    "wicketkeeperbatsman": PlayerRole.WICKET_KEEPER,
}


def normalise(value: str) -> str:
    """Fold a label down to comparable letters and digits."""
    text = unicodedata.normalize("NFKD", str(value or ""))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _clean(value) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = str(value).strip()
    return text or None


def _as_int(value) -> int | None:
    text = _clean(value)
    if text is None:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def _clean_mobile(value) -> str | None:
    text = _clean(value)
    if text is None:
        return None
    digits = re.sub(r"\D", "", text)
    return digits or None


def parse_role(value) -> PlayerRole:
    key = normalise(_clean(value) or "")
    return ROLE_ALIASES.get(key, PlayerRole.BATSMAN)


def read_players_excel(content: bytes) -> list[dict]:
    try:
        df = pd.read_excel(io.BytesIO(content), dtype=object)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That file couldn't be read as a spreadsheet: {exc}",
        )

    resolved = {}
    for column in df.columns:
        field = COLUMN_MAP.get(normalise(column))
        if field:
            resolved[column] = field
    if "name" not in resolved.values():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The sheet needs a 'Player Name' column. Found: " + ", ".join(map(str, df.columns)),
        )

    rows: list[dict] = []
    for _, row in df.iterrows():
        record = {field: row[col] for col, field in resolved.items()}
        if not _clean(record.get("name")):
            continue
        rows.append(
            {
                "name": _clean(record.get("name")),
                "mobile": _clean_mobile(record.get("mobile")),
                "place": _clean(record.get("place")),
                "role": parse_role(record.get("role")),
                "jersey_number": _as_int(record.get("jersey_number")),
                "age": _as_int(record.get("age")),
                "batting_style": _clean(record.get("batting_style")),
                "bowling_style": _clean(record.get("bowling_style")),
                "photo_file": _clean(record.get("photo_file")),
            }
        )
    return rows


def import_players(db: Session, league_id: int, rows: list[dict]) -> tuple[int, int, list[str]]:
    """Insert players, refusing duplicates by name or mobile within the league."""
    existing = db.query(Player).filter(Player.league_id == league_id).all()
    seen_names = {normalise(p.name) for p in existing}
    seen_mobiles = {p.mobile for p in existing if p.mobile}

    created = skipped = 0
    errors: list[str] = []

    for index, row in enumerate(rows, start=2):  # row 1 is the header
        key = normalise(row["name"])
        if key in seen_names:
            skipped += 1
            errors.append(f"Row {index}: {row['name']} is already in this league.")
            continue
        if row["mobile"] and row["mobile"] in seen_mobiles:
            skipped += 1
            errors.append(f"Row {index}: mobile {row['mobile']} belongs to another player.")
            continue

        db.add(
            Player(
                league_id=league_id,
                name=row["name"],
                mobile=row["mobile"],
                place=row["place"],
                role=row["role"],
                jersey_number=row["jersey_number"],
                age=row["age"],
                batting_style=row["batting_style"],
                bowling_style=row["bowling_style"],
                status=PlayerStatus.AVAILABLE,
            )
        )
        seen_names.add(key)
        if row["mobile"]:
            seen_mobiles.add(row["mobile"])
        created += 1

    db.commit()
    return created, skipped, errors


def attach_photos(
    db: Session, league_id: int, files: dict[str, bytes], upload_dir: Path, public_prefix: str
) -> tuple[int, list[str]]:
    """Match uploaded images to players by filename, then persist them.

    Match order: exact normalised name, then jersey number, then a
    'starts with' pass for names like "ravi_kumar_01.jpg".
    """
    players = db.query(Player).filter(Player.league_id == league_id).all()
    by_name = {normalise(p.name): p for p in players}
    by_jersey = {str(p.jersey_number): p for p in players if p.jersey_number is not None}

    matched = 0
    unmatched: list[str] = []

    for filename, blob in files.items():
        stem = Path(filename).stem
        suffix = Path(filename).suffix.lower() or ".jpg"
        key = normalise(stem)

        player = by_name.get(key) or by_jersey.get(re.sub(r"\D", "", stem))
        if player is None:
            player = next((p for k, p in by_name.items() if key.startswith(k) and k), None)
        if player is None:
            unmatched.append(filename)
            continue

        optimised, new_suffix = optimise(blob, "player")
        name = f"{player.id}{new_suffix or suffix}"
        player.photo_url = storage.save(db, f"{public_prefix}/players/{name}", optimised)
        matched += 1

    db.commit()
    return matched, unmatched


def unpack_archive(content: bytes) -> dict[str, bytes]:
    """Read a zip of photos into {filename: bytes}, ignoring junk entries."""
    files: dict[str, bytes] = {}
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if name.startswith(".") or Path(name).suffix.lower() not in {
                ".jpg", ".jpeg", ".png", ".webp",
            }:
                continue
            files[name] = archive.read(info)
    return files
