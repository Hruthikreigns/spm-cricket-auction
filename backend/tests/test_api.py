"""End-to-end pass over the HTTP layer, from sign-in to a completed sale."""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, engine
from app.main import app


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
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_login_rejects_a_bad_password(client):
    res = client.post("/api/auth/login", json={"email": settings.admin_email, "password": "nope"})
    assert res.status_code == 401


def test_admin_routes_need_a_token(client):
    assert client.post("/api/leagues", json={"name": "Nope"}).status_code == 401


def test_full_auction_flow(client, auth):
    league = client.post(
        "/api/leagues",
        json={"name": "API League", "season": "2026", "venue": "Tirupati"},
        headers=auth,
    ).json()
    lid = league["id"]

    team = client.post(
        f"/api/leagues/{lid}/teams",
        json={"name": "SPM Spirits", "short_name": "SPM", "owner_name": "R. Prakash"},
        headers=auth,
    ).json()
    assert team["remaining_purse"] == 100_000

    rival = client.post(
        f"/api/leagues/{lid}/teams", json={"name": "Warriors"}, headers=auth
    ).json()

    # Relax the reserve so a two-team demo can bid freely.
    client.patch(
        f"/api/leagues/{lid}/settings", json={"enforce_squad_reserve": False}, headers=auth
    )

    players = []
    for i in range(5):
        res = client.post(
            f"/api/leagues/{lid}/players",
            json={"name": f"Player {i}", "mobile": f"98765432{i:02d}", "role": "BOWLER"},
            headers=auth,
        )
        assert res.status_code == 201, res.text
        players.append(res.json())

    # A duplicate mobile number is refused.
    dupe = client.post(
        f"/api/leagues/{lid}/players",
        json={"name": "Someone Else", "mobile": "9876543200"},
        headers=auth,
    )
    assert dupe.status_code == 409

    # Retain one player, purse drops by the retain price.
    retained = client.post(
        f"/api/leagues/{lid}/players/retain",
        json={"team_id": team["id"], "player_ids": [players[0]["id"]]},
        headers=auth,
    )
    assert retained.status_code == 200, retained.text
    board = client.get(f"/api/leagues/{lid}/auction/board", headers=auth).json()
    spm = next(t for t in board if t["id"] == team["id"])
    assert spm["spent"] == 3_000 and spm["remaining_purse"] == 97_000

    # Run the auction.
    assert client.post(f"/api/leagues/{lid}/auction/start", headers=auth).status_code == 200
    called = client.post(f"/api/leagues/{lid}/auction/next-player", headers=auth).json()
    assert called["status"] == "ON_BLOCK"

    client.post(
        f"/api/leagues/{lid}/auction/bid", json={"team_id": rival["id"]}, headers=auth
    )
    state = client.post(
        f"/api/leagues/{lid}/auction/bid", json={"team_id": team["id"], "amount": 25_000},
        headers=auth,
    ).json()
    assert state["current_bid"] == 25_000
    assert state["current_team"]["id"] == team["id"]

    sold = client.post(f"/api/leagues/{lid}/auction/sold", headers=auth).json()
    assert sold["sold_price"] == 25_000
    assert sold["team"]["name"] == "SPM Spirits"

    board = client.get(f"/api/leagues/{lid}/auction/board", headers=auth).json()
    spm = next(t for t in board if t["id"] == team["id"])
    assert spm["spent"] == 28_000
    assert spm["remaining_purse"] == 72_000
    assert spm["player_count"] == 2

    stats = client.get(f"/api/leagues/{lid}/analytics").json()
    assert stats["sold_players"] == 1
    assert stats["retained_players"] == 1
    assert stats["highest_bid"] == 25_000

    export = client.get(f"/api/leagues/{lid}/export/results.xlsx")
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("application/vnd.openxml")


def test_public_can_read_but_not_write(client):
    assert client.get("/api/leagues").status_code == 200
    assert client.post("/api/leagues/1/auction/sold").status_code == 401
