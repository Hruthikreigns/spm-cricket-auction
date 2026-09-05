"""Recovering an account by email, and the ways that must not be abused."""

import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import PasswordReset, User


@pytest.fixture(scope="module")
def client():
    Base.metadata.drop_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def sent(monkeypatch):
    """Capture what would have been emailed instead of sending it."""
    outbox = []
    monkeypatch.setattr(
        "app.services.mailer.send",
        lambda to, subject, body: outbox.append({"to": to, "subject": subject, "body": body})
        or True,
    )
    return outbox


def token_from(outbox) -> str:
    body = outbox[-1]["body"]
    return body.split("token=")[1].split()[0].strip()


# --------------------------------------------------------------------------
def test_a_link_is_emailed(client, sent):
    res = client.post("/api/auth/forgot", json={"email": settings.admin_email})
    assert res.status_code == 200
    assert "on its way" in res.json()["message"]

    assert len(sent) == 1
    assert sent[0]["to"] == settings.admin_email
    assert "/reset-password?token=" in sent[0]["body"]


def test_an_unknown_address_gets_the_same_answer(client, sent):
    """Otherwise the form tells strangers which addresses have accounts."""
    known = client.post("/api/auth/forgot", json={"email": settings.admin_email}).json()
    unknown = client.post("/api/auth/forgot", json={"email": "nobody@example.com"}).json()

    assert known == unknown
    assert [m["to"] for m in sent] == [settings.admin_email], "nothing sent to the stranger"


def test_the_link_sets_a_new_password(client, sent):
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    token = token_from(sent)

    res = client.post("/api/auth/reset", json={"token": token, "password": "brand-new-pass"})
    assert res.status_code == 200

    assert client.post(
        "/api/auth/login", json={"email": settings.admin_email, "password": "brand-new-pass"}
    ).status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": settings.admin_email, "password": settings.admin_password}
    ).status_code == 401, "the old password stops working"

    # Put it back for the other tests in this module.
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    client.post(
        "/api/auth/reset",
        json={"token": token_from(sent), "password": settings.admin_password},
    )


def test_a_link_works_only_once(client, sent):
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    token = token_from(sent)

    assert client.post("/api/auth/reset", json={"token": token, "password": "first-use-ok"}).status_code == 200
    second = client.post("/api/auth/reset", json={"token": token, "password": "second-try"})
    assert second.status_code == 400
    assert "already been used" in second.json()["detail"]

    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    client.post(
        "/api/auth/reset",
        json={"token": token_from(sent), "password": settings.admin_password},
    )


def test_asking_again_kills_the_earlier_link(client, sent):
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    first = token_from(sent)
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    second = token_from(sent)

    assert client.post("/api/auth/reset", json={"token": first, "password": "nope12345"}).status_code == 400
    assert client.post(
        "/api/auth/reset", json={"token": second, "password": settings.admin_password}
    ).status_code == 200


def test_an_expired_link_is_refused(client, sent):
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    token = token_from(sent)

    with SessionLocal() as db:
        row = (
            db.query(PasswordReset)
            .filter(PasswordReset.token_hash == hashlib.sha256(token.encode()).hexdigest())
            .first()
        )
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

    res = client.post("/api/auth/reset", json={"token": token, "password": "too-late-now"})
    assert res.status_code == 400
    assert "expired" in res.json()["detail"]


def test_a_made_up_token_is_refused(client):
    res = client.post("/api/auth/reset", json={"token": "not-a-real-token", "password": "whatever1"})
    assert res.status_code == 400


def test_the_raw_token_is_never_stored(client, sent):
    """A copy of the database must not be a set of working reset links."""
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    token = token_from(sent)

    with SessionLocal() as db:
        rows = db.query(PasswordReset).all()
        assert rows, "a row was created"
        assert all(r.token_hash != token for r in rows)
        assert any(r.token_hash == hashlib.sha256(token.encode()).hexdigest() for r in rows)


def test_a_short_password_is_refused(client, sent):
    client.post("/api/auth/forgot", json={"email": settings.admin_email})
    res = client.post("/api/auth/reset", json={"token": token_from(sent), "password": "abc"})
    assert res.status_code == 422


def test_a_suspended_account_cannot_be_recovered(client, sent):
    """Someone shut out shouldn't be able to let themselves back in."""
    with SessionLocal() as db:
        viewer = User(
            email="suspended@example.com",
            full_name="Suspended",
            hashed_password="x",
            role="owner",
            is_active=False,
        )
        db.add(viewer)
        db.commit()

    before = len(sent)
    client.post("/api/auth/forgot", json={"email": "suspended@example.com"})
    assert len(sent) == before, "no link is sent for a suspended account"
