"""Uploads live in the database, so a redeploy can't take the photos with it."""

import io

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, engine
from app.main import app

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000080000000808060000"
    "00c40fbe8b0000001c4944415428cf63f8ffff3f0328fe0201000000"
    "ffff03000692023a3e2d1a2c0000000049454e44ae426082"
)


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


def upload(client, auth, folder="teams"):
    return client.post(
        f"/api/uploads?folder={folder}",
        files={"file": ("logo.png", io.BytesIO(PNG), "image/png")},
        headers=auth,
    )


def test_an_upload_is_served_back(client, auth):
    res = upload(client, auth)
    assert res.status_code == 200, res.text
    url = res.json()["url"]

    served = client.get(url)
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("image/")
    assert len(served.content) > 0


def test_it_is_in_the_database_not_on_disk(client, auth):
    """The whole point: a wiped filesystem must not lose the photos."""
    from pathlib import Path

    from app.database import SessionLocal
    from app.models import StoredFile

    url = upload(client, auth).json()["url"]

    with SessionLocal() as db:
        row = db.query(StoredFile).filter(StoredFile.path == url).first()
        assert row is not None, "the bytes are in the database"
        assert row.size > 0
        assert row.content_type.startswith("image/")

    assert not (Path(settings.upload_dir) / url.removeprefix("/uploads/")).exists(), (
        "nothing was written to the filesystem"
    )


def test_photos_survive_a_wiped_filesystem(client, auth):
    """Simulates a redeploy: delete the uploads folder, images still serve."""
    import shutil
    from pathlib import Path

    url = upload(client, auth, folder="players").json()["url"]
    assert client.get(url).status_code == 200

    shutil.rmtree(Path(settings.upload_dir), ignore_errors=True)

    served = client.get(url)
    assert served.status_code == 200, "this is what breaks on managed hosting without it"
    assert len(served.content) > 0


def test_a_missing_image_404s(client):
    assert client.get("/uploads/players/nothing-here.jpg").status_code == 404


def test_a_traversal_attempt_gets_nothing(client):
    """The disk fallback must not be talked into reading elsewhere."""
    res = client.get("/uploads/../../etc/passwd")
    assert res.status_code in (404, 400)
    assert b"root:" not in res.content


def test_images_are_cached_hard(client, auth):
    """Filenames are random and content never changes under one."""
    url = upload(client, auth).json()["url"]
    served = client.get(url)
    assert "max-age" in served.headers.get("cache-control", "")


def test_a_registration_photo_goes_to_the_database(client, auth):
    lid = client.post("/api/leagues", json={"name": "Storage League"}, headers=auth).json()["id"]
    res = client.post(
        f"/api/leagues/{lid}/registrations",
        data={
            "name": "Ravi Kumar",
            "mobile": "9876543210",
            "email": "r@example.com",
            "place": "Tirupati",
        },
        files={"photo": ("me.png", io.BytesIO(PNG), "image/png")},
    )
    assert res.status_code == 201, res.text

    rows = client.get(f"/api/leagues/{lid}/registrations", headers=auth).json()
    assert client.get(rows[0]["photo_url"]).status_code == 200


def test_the_pdf_still_finds_the_photos(client, auth):
    """The card reads images from the store now, not from disk."""
    lid = client.post("/api/leagues", json={"name": "Card Storage"}, headers=auth).json()["id"]
    receipt = client.post(
        f"/api/leagues/{lid}/registrations",
        data={
            "name": "Suresh Naidu",
            "mobile": "9876543211",
            "email": "s@example.com",
            "place": "Chittoor",
        },
        files={"photo": ("me.png", io.BytesIO(PNG), "image/png")},
    ).json()

    card = client.get(receipt["card_url"])
    assert card.status_code == 200
    assert card.content.startswith(b"%PDF-")

    register = client.get(f"/api/leagues/{lid}/registrations/export.pdf", headers=auth)
    assert register.status_code == 200
    assert register.content.startswith(b"%PDF-")
