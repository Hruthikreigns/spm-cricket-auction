"""Import tests: messy headers, duplicates, and photo matching."""

import io
import zipfile

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, engine
from app.main import app
from app.models import PlayerRole

SHEET = [
    # Deliberately inconsistent headers and casing, the way real registers arrive.
    {
        "Player Name": "Ravi Kumar",
        "Mobile Number": "98765 43210",
        "Place": "Tirupati",
        "Role": "All Rounder",
        "Jersey Number": 7,
        "Age": 24,
        "Batting Style": "Right hand bat",
        "Bowling Style": "Right arm medium",
    },
    {
        "Player Name": "Suresh Naidu",
        "Mobile Number": 9876543211,
        "Place": "Chittoor",
        "Role": "wk",
        "Jersey Number": 12,
        "Age": 29,
        "Batting Style": "Left hand bat",
        "Bowling Style": "",
    },
    {
        "Player Name": "Deepak Rao",
        "Mobile Number": "9876543212",
        "Place": "Puttur",
        "Role": "BOWLER",
        "Jersey Number": 44,
        "Age": 21,
        "Batting Style": "Right hand bat",
        "Bowling Style": "Left arm orthodox",
    },
    # Duplicate name — should be reported, not imported.
    {"Player Name": "Ravi Kumar", "Mobile Number": "9000000000", "Role": "Batsman"},
    # Duplicate mobile — same.
    {"Player Name": "Someone New", "Mobile Number": "9876543212", "Role": "Batsman"},
    # No name at all — skipped silently.
    {"Player Name": "", "Mobile Number": "9111111111", "Role": "Batsman"},
]


def workbook() -> bytes:
    buffer = io.BytesIO()
    pd.DataFrame(SHEET).to_excel(buffer, index=False)
    return buffer.getvalue()


def photo_zip() -> bytes:
    """One match by name, one by jersey number, one that matches nothing."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("ravi_kumar.JPG", b"fake-jpeg-bytes")
        archive.writestr("44.jpg", b"fake-jpeg-bytes")
        archive.writestr("unknown_person.jpg", b"fake-jpeg-bytes")
        archive.writestr("__MACOSX/._junk.jpg", b"junk")
    return buffer.getvalue()


@pytest.fixture(scope="module")
def client():
    Base.metadata.drop_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def auth(client):
    res = client.post(
        "/api/auth/login",
        json={"email": settings.admin_email, "password": settings.admin_password},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(scope="module")
def league_id(client, auth):
    return client.post("/api/leagues", json={"name": "Import League"}, headers=auth).json()["id"]


def test_import_reads_messy_headers_and_reports_duplicates(client, auth, league_id):
    res = client.post(
        f"/api/leagues/{league_id}/players/import",
        files={
            "file": ("register.xlsx", workbook(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            "photos": ("photos.zip", photo_zip(), "application/zip"),
        },
        headers=auth,
    )
    assert res.status_code == 200, res.text
    report = res.json()

    assert report["created"] == 3
    assert report["skipped"] == 2  # duplicate name + duplicate mobile
    assert report["photos_matched"] == 2  # by name and by jersey number
    assert any("already in this league" in e for e in report["errors"])
    assert any("belongs to another player" in e for e in report["errors"])


def test_imported_fields_land_correctly(client, league_id, auth):
    # Signed in, because mobile numbers are held back from the public list.
    players = client.get(f"/api/leagues/{league_id}/players", headers=auth).json()
    by_name = {p["name"]: p for p in players}

    ravi = by_name["Ravi Kumar"]
    assert ravi["role"] == PlayerRole.ALL_ROUNDER.value
    assert ravi["mobile"] == "9876543210"  # spaces stripped
    assert ravi["jersey_number"] == 7
    assert ravi["age"] == 24
    assert ravi["photo_url"].startswith("/uploads/players/")

    # A numeric cell still becomes a clean string.
    assert by_name["Suresh Naidu"]["mobile"] == "9876543211"
    # "wk" resolves to wicket-keeper.
    assert by_name["Suresh Naidu"]["role"] == PlayerRole.WICKET_KEEPER.value
    # Matched on jersey number 44.
    assert by_name["Deepak Rao"]["photo_url"] is not None


def test_reimporting_the_same_sheet_adds_nothing(client, auth, league_id):
    res = client.post(
        f"/api/leagues/{league_id}/players/import",
        files={"file": ("register.xlsx", workbook(), "application/vnd.ms-excel")},
        headers=auth,
    )
    assert res.json()["created"] == 0


def test_a_sheet_without_a_name_column_is_rejected(client, auth, league_id):
    buffer = io.BytesIO()
    pd.DataFrame([{"Nickname": "Bat", "Town": "Nowhere"}]).to_excel(buffer, index=False)
    res = client.post(
        f"/api/leagues/{league_id}/players/import",
        files={"file": ("bad.xlsx", buffer.getvalue(), "application/vnd.ms-excel")},
        headers=auth,
    )
    assert res.status_code == 400
    assert "Player Name" in res.json()["detail"]


def test_import_needs_admin(client, league_id):
    res = client.post(
        f"/api/leagues/{league_id}/players/import",
        files={"file": ("register.xlsx", workbook(), "application/vnd.ms-excel")},
    )
    assert res.status_code == 401
