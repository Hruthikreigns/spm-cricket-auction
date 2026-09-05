"""The live feed: a viewer with no account should see every change."""

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
def setup(client):
    token = client.post(
        "/api/auth/login",
        json={"email": settings.admin_email, "password": settings.admin_password},
    ).json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}
    league = client.post("/api/leagues", json={"name": "Socket League"}, headers=auth).json()
    lid = league["id"]
    client.patch(f"/api/leagues/{lid}/settings", json={"enforce_squad_reserve": False}, headers=auth)
    team = client.post(f"/api/leagues/{lid}/teams", json={"name": "Warriors"}, headers=auth).json()
    for i in range(3):
        client.post(
            f"/api/leagues/{lid}/players",
            json={"name": f"Socket Player {i}", "mobile": f"91111111{i:02d}"},
            headers=auth,
        )
    client.post(f"/api/leagues/{lid}/auction/start", headers=auth)
    return {"auth": auth, "token": token, "league_id": lid, "team_id": team["id"]}


def test_viewer_gets_a_snapshot_then_every_update(client, setup):
    lid, auth, team_id = setup["league_id"], setup["auth"], setup["team_id"]

    with client.websocket_connect(f"/api/leagues/{lid}/auction/ws?token={setup['token']}") as ws:
        first = ws.receive_json()
        assert first["event"] == "snapshot"
        assert first["payload"]["state"]["status"] == "RUNNING"
        assert len(first["payload"]["teams"]) == 1

        client.post(f"/api/leagues/{lid}/auction/next-player", headers=auth)
        called = ws.receive_json()
        assert called["event"] == "player_called"
        assert called["payload"]["state"]["current_player"] is not None

        client.post(f"/api/leagues/{lid}/auction/bid", json={"team_id": team_id, "amount": 12_000}, headers=auth)
        bid = ws.receive_json()
        assert bid["event"] == "bid_placed"
        assert bid["payload"]["state"]["current_bid"] == 12_000

        client.post(f"/api/leagues/{lid}/auction/sold", headers=auth)
        sale = ws.receive_json()
        assert sale["event"] == "player_sold"
        # The banner payload the viewer renders.
        assert sale["payload"]["sold"]["sold_price"] == 12_000
        assert sale["payload"]["sold"]["team"]["name"] == "Warriors"
        # Purses on the board move in the same message.
        assert sale["payload"]["teams"][0]["remaining_purse"] == 88_000
        assert sale["payload"]["state"]["current_player"] is None


def test_two_viewers_both_receive_the_same_event(client, setup):
    lid, auth, team_id = setup["league_id"], setup["auth"], setup["team_id"]

    feed = f"/api/leagues/{lid}/auction/ws?token={setup['token']}"
    with client.websocket_connect(feed) as a:
        with client.websocket_connect(feed) as b:
            a.receive_json()
            b.receive_json()

            client.post(f"/api/leagues/{lid}/auction/next-player", headers=auth)
            assert a.receive_json()["event"] == "player_called"
            assert b.receive_json()["event"] == "player_called"

            client.post(
                f"/api/leagues/{lid}/auction/bid", json={"team_id": team_id}, headers=auth
            )
            assert a.receive_json()["payload"]["state"]["current_team"]["name"] == "Warriors"
            assert b.receive_json()["payload"]["state"]["current_team"]["name"] == "Warriors"
