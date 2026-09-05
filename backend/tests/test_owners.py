"""The shared watching login, the gated live room, and auto-approval."""

import io

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, engine
from app.main import app

PHOTO = ("me.jpg", b"\xff\xd8\xff\xe0fake-jpeg", "image/jpeg")


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
def league(client, auth):
    lid = client.post("/api/leagues", json={"name": "Owners League"}, headers=auth).json()["id"]
    client.post(f"/api/leagues/{lid}/teams", json={"name": "Team Spirit"}, headers=auth)
    client.post(
        f"/api/leagues/{lid}/players",
        json={"name": "Ravi Kumar", "mobile": "9876543210"},
        headers=auth,
    )
    client.post(f"/api/leagues/{lid}/auction/start", headers=auth)
    client.post(f"/api/leagues/{lid}/auction/next-player", headers=auth)
    return lid


@pytest.fixture(scope="module")
def owner(client, auth):
    res = client.post("/api/viewer", json={"email": "owners@spm.local"}, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def owner_header(client, owner):
    res = client.post(
        "/api/auth/login", json={"email": owner["email"], "password": owner["password"]}
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


# --------------------------------------------------------------------------
# The shared login
# --------------------------------------------------------------------------
def test_setting_it_returns_the_password_once(client, owner):
    assert owner["exists"] is True
    assert owner["email"] == "owners@spm.local"
    assert len(owner["password"]) >= 6
    assert owner["max_viewers"] == settings.max_live_viewers


def test_the_password_is_not_readable_afterwards(client, auth, owner):
    body = client.get("/api/viewer", headers=auth).json()
    assert body["email"] == owner["email"]
    assert "password" not in body, "only the moment of setting it shows the password"


def test_only_an_admin_manages_it(client, owner):
    assert client.get("/api/viewer").status_code == 401
    assert client.post("/api/viewer", json={}).status_code == 401
    # And a watcher can't reissue their own credentials.
    assert client.get("/api/viewer", headers=owner_header(client, owner)).status_code == 403


def test_reissuing_replaces_the_password(client, auth, owner):
    """How you shut out anyone who shouldn't have it any more."""
    fresh = client.post("/api/viewer", json={}, headers=auth).json()["password"]
    assert fresh != owner["password"]

    assert client.post(
        "/api/auth/login", json={"email": owner["email"], "password": fresh}
    ).status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": owner["email"], "password": owner["password"]}
    ).status_code == 401, "the old one stops working"
    owner["password"] = fresh


def test_there_is_only_ever_one_watching_login(client, auth, owner):
    """Setting it again changes the one login rather than adding another."""
    from app.database import SessionLocal
    from app.models import User

    client.post("/api/viewer", json={"email": "second@spm.local"}, headers=auth)
    with SessionLocal() as db:
        assert db.query(User).filter(User.role == "owner").count() == 1

    # Put the original id back, and keep the fixture's credentials current —
    # the tests below sign in with them.
    owner.update(client.post("/api/viewer", json={"email": owner["email"]}, headers=auth).json())


# --------------------------------------------------------------------------
# The live room is behind a login
# --------------------------------------------------------------------------
def test_the_public_cannot_watch(client, league):
    assert client.get(f"/api/leagues/{league}/auction/state").status_code == 401
    assert client.get(f"/api/leagues/{league}/auction/board").status_code == 401
    assert client.get(f"/api/leagues/{league}/auction/history").status_code == 401


def test_a_watcher_can_watch(client, league, owner):
    header = owner_header(client, owner)
    state = client.get(f"/api/leagues/{league}/auction/state", headers=header)
    assert state.status_code == 200
    assert state.json()["current_player"]["name"] == "Ravi Kumar"
    assert client.get(f"/api/leagues/{league}/auction/board", headers=header).status_code == 200


def test_a_watcher_cannot_write_anything(client, league, owner):
    header = owner_header(client, owner)
    assert client.post(f"/api/leagues/{league}/auction/sold", headers=header).status_code == 403
    assert (
        client.post(f"/api/leagues/{league}/auction/next-player", headers=header).status_code == 403
    )
    assert client.post(
        f"/api/leagues/{league}/players",
        json={"name": "Sneaky", "mobile": "9000000123"},
        headers=header,
    ).status_code == 403


def test_a_watcher_does_not_see_phone_numbers(client, league, owner):
    header = owner_header(client, owner)
    state = client.get(f"/api/leagues/{league}/auction/state", headers=header).json()
    assert state["current_player"]["mobile"] is None, "watching isn't the same as organising"


def test_revoking_it_shuts_everyone_out(client, auth, league, owner):
    header = owner_header(client, owner)
    assert client.get(f"/api/leagues/{league}/auction/state", headers=header).status_code == 200

    client.delete("/api/viewer", headers=auth)
    assert client.get(f"/api/leagues/{league}/auction/state", headers=header).status_code == 401
    assert client.get(f"/api/leagues/{league}/auction/state", headers=auth).status_code == 200, (
        "the organiser still gets in"
    )

    # Put it back for the tests that follow.
    owner.update(client.post("/api/viewer", json={"email": owner["email"]}, headers=auth).json())


# --------------------------------------------------------------------------
# The socket
# --------------------------------------------------------------------------
def test_the_socket_refuses_an_anonymous_client(client, league):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/leagues/{league}/auction/ws") as ws:
            ws.receive_json()


def test_the_socket_refuses_a_junk_token(client, league):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/leagues/{league}/auction/ws?token=nonsense") as ws:
            ws.receive_json()


def test_the_socket_accepts_the_shared_token(client, league, owner):
    token = client.post(
        "/api/auth/login", json={"email": owner["email"], "password": owner["password"]}
    ).json()["access_token"]
    with client.websocket_connect(f"/api/leagues/{league}/auction/ws?token={token}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["event"] == "snapshot"
        assert snapshot["payload"]["state"]["current_player"]["name"] == "Ravi Kumar"


# --------------------------------------------------------------------------
# The finished result stays public
# --------------------------------------------------------------------------
def test_results_remain_open_to_everyone(client, league):
    assert client.get(f"/api/leagues/{league}/results").status_code == 200
    assert client.get(f"/api/leagues/{league}/players").status_code == 401, (
        "the register is for organisers; the public sees results instead"
    )


# --------------------------------------------------------------------------
# Auto-approval
# --------------------------------------------------------------------------
def sign_up(client, league_id, name, mobile, email):
    return client.post(
        f"/api/leagues/{league_id}/registrations",
        data={
            "name": name,
            "mobile": mobile,
            "email": email,
            "place": "Tirupati",
            "role": "BATSMAN",
        },
        files={"photo": (PHOTO[0], io.BytesIO(PHOTO[1]), PHOTO[2])},
    )


def test_registrations_wait_for_review_by_default(client, auth):
    lid = client.post("/api/leagues", json={"name": "Manual Review"}, headers=auth).json()["id"]
    body = sign_up(client, lid, "Waiting Player", "9555500001", "wait@example.com").json()

    assert body["status"] == "PENDING"
    assert "confirm your entry" in body["message"]
    assert client.get(f"/api/leagues/{lid}/players", headers=auth).json() == []


def test_auto_approval_puts_them_straight_into_the_pool(client, auth):
    lid = client.post("/api/leagues", json={"name": "Auto League"}, headers=auth).json()["id"]
    client.patch(f"/api/leagues/{lid}", json={"auto_approve_registrations": True}, headers=auth)

    body = sign_up(client, lid, "Straight In", "9555500002", "auto@example.com").json()
    assert body["status"] == "APPROVED"
    assert "on the player list" in body["message"]

    players = client.get(f"/api/leagues/{lid}/players", headers=auth).json()
    assert [p["name"] for p in players] == ["Straight In"]
    assert players[0]["status"] == "AVAILABLE"


def test_auto_approval_still_refuses_duplicates(client, auth):
    lid = client.post("/api/leagues", json={"name": "Auto Dupes"}, headers=auth).json()["id"]
    client.patch(f"/api/leagues/{lid}", json={"auto_approve_registrations": True}, headers=auth)

    assert sign_up(client, lid, "First Time", "9555500003", "dupe@example.com").status_code == 201
    again = sign_up(client, lid, "Someone Else", "9555500003", "other@example.com")
    assert again.status_code == 409
    assert len(client.get(f"/api/leagues/{lid}/players", headers=auth).json()) == 1


def test_turning_auto_approval_off_again_restores_the_queue(client, auth):
    lid = client.post("/api/leagues", json={"name": "Toggle League"}, headers=auth).json()["id"]
    client.patch(f"/api/leagues/{lid}", json={"auto_approve_registrations": True}, headers=auth)
    sign_up(client, lid, "Auto One", "9555500004", "one@example.com")

    client.patch(f"/api/leagues/{lid}", json={"auto_approve_registrations": False}, headers=auth)
    body = sign_up(client, lid, "Manual Two", "9555500005", "two@example.com").json()

    assert body["status"] == "PENDING"
    assert [
        p["name"] for p in client.get(f"/api/leagues/{lid}/players", headers=auth).json()
    ] == ["Auto One"]


def test_only_an_admin_can_switch_it_on(client, auth):
    lid = client.post("/api/leagues", json={"name": "Guarded"}, headers=auth).json()["id"]
    assert client.patch(
        f"/api/leagues/{lid}", json={"auto_approve_registrations": True}
    ).status_code == 401


# --------------------------------------------------------------------------
# Thirty at a time
# --------------------------------------------------------------------------
def test_the_room_holds_thirty_watchers(client, league, owner, auth, monkeypatch):
    """The thirty-first is turned away rather than quietly filling the room."""
    from starlette.websockets import WebSocketDisconnect

    from app.config import settings as cfg

    # A smaller cap keeps the test quick; the mechanism is the same.
    monkeypatch.setattr(cfg, "max_live_viewers", 3)

    token = client.post(
        "/api/auth/login", json={"email": owner["email"], "password": owner["password"]}
    ).json()["access_token"]
    feed = f"/api/leagues/{league}/auction/ws?token={token}"

    import contextlib

    with contextlib.ExitStack() as stack:
        for _ in range(3):
            ws = stack.enter_context(client.websocket_connect(feed))
            assert ws.receive_json()["event"] == "snapshot"

        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(feed) as extra:
                extra.receive_json()


def test_the_organiser_gets_in_even_when_it_is_full(client, league, owner, auth, monkeypatch):
    import contextlib

    from app.config import settings as cfg

    monkeypatch.setattr(cfg, "max_live_viewers", 2)

    watcher = client.post(
        "/api/auth/login", json={"email": owner["email"], "password": owner["password"]}
    ).json()["access_token"]
    organiser = client.post(
        "/api/auth/login",
        json={"email": settings.admin_email, "password": settings.admin_password},
    ).json()["access_token"]

    with contextlib.ExitStack() as stack:
        for _ in range(2):
            stack.enter_context(
                client.websocket_connect(f"/api/leagues/{league}/auction/ws?token={watcher}")
            ).receive_json()

        with client.websocket_connect(
            f"/api/leagues/{league}/auction/ws?token={organiser}"
        ) as admin_ws:
            assert admin_ws.receive_json()["event"] == "snapshot", (
                "being locked out of your own auction would be absurd"
            )
