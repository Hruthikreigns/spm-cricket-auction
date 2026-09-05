"""Phone numbers go to organisers, not to everyone watching.

The live room itself needs an account (see test_owners.py). What's checked
here is who sees a *number* once they're in, and on the parts that stay
public — the player list, profiles and the finished result.
"""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.database import Base, engine
from app.main import app

MOBILE = "9876543210"


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
    lid = client.post("/api/leagues", json={"name": "Privacy League"}, headers=auth).json()["id"]
    client.post(f"/api/leagues/{lid}/teams", json={"name": "Team Spirit"}, headers=auth)
    client.post(
        f"/api/leagues/{lid}/players",
        json={"name": "Ravi Kumar", "mobile": MOBILE, "place": "Renigunta"},
        headers=auth,
    )
    client.post(f"/api/leagues/{lid}/auction/start", headers=auth)
    client.post(f"/api/leagues/{lid}/auction/next-player", headers=auth)
    return lid


# --------------------------------------------------------------------------
def test_the_auction_state_needs_an_account_at_all(client, league):
    assert client.get(f"/api/leagues/{league}/auction/state").status_code == 401


def test_an_organiser_gets_the_phone_number(client, league, auth):
    body = client.get(f"/api/leagues/{league}/auction/state", headers=auth).json()
    assert body["current_player"]["mobile"] == MOBILE


def test_the_player_register_is_not_public_at_all(client, league):
    assert client.get(f"/api/leagues/{league}/players").status_code == 401


def test_a_player_profile_is_not_public_either(client, league, auth):
    player = client.get(f"/api/leagues/{league}/players", headers=auth).json()[0]
    assert client.get(f"/api/leagues/{league}/players/{player['id']}").status_code == 401


def test_an_organiser_sees_it_on_the_register_and_the_profile(client, league, auth):
    rows = client.get(f"/api/leagues/{league}/players", headers=auth).json()
    assert rows[0]["mobile"] == MOBILE
    body = client.get(f"/api/leagues/{league}/players/{rows[0]['id']}", headers=auth).json()
    assert body["mobile"] == MOBILE


def test_a_junk_token_gets_nowhere(client, league):
    res = client.get(
        f"/api/leagues/{league}/auction/state", headers={"Authorization": "Bearer nonsense"}
    )
    assert res.status_code == 401


def test_the_live_socket_never_carries_a_phone_number(client, league, auth):
    """The broadcast reaches every watcher, so it follows the shared setting."""
    token = client.post(
        "/api/auth/login",
        json={"email": settings.admin_email, "password": settings.admin_password},
    ).json()["access_token"]
    with client.websocket_connect(f"/api/leagues/{league}/auction/ws?token={token}") as ws:
        snapshot = ws.receive_json()
        assert snapshot["payload"]["state"]["current_player"]["mobile"] is None

        client.post(
            f"/api/leagues/{league}/auction/bid",
            json={"team_id": client.get(f"/api/leagues/{league}/teams").json()[0]["id"]},
            headers=auth,
        )
        event = ws.receive_json()
        assert MOBILE not in str(event)

        client.post(f"/api/leagues/{league}/auction/sold", headers=auth)
        sale = ws.receive_json()
        assert sale["event"] == "player_sold"
        assert sale["payload"]["sold"]["mobile"] is None, "the sold banner payload too"
        assert MOBILE not in str(sale)


def test_search_by_mobile_still_works_for_organisers(client, league, auth):
    """Stripping the field from the response must not break lookup by it."""
    rows = client.get(f"/api/leagues/{league}/players?q={MOBILE}", headers=auth).json()
    assert [r["name"] for r in rows] == ["Ravi Kumar"]


# --------------------------------------------------------------------------
# The organiser's switch
# --------------------------------------------------------------------------
def ensure_on_block(client, league, auth) -> str:
    """Put a player on the block and return their number.

    Earlier tests in this module sell the player, so these need to set up
    their own — with a fresh mobile, since duplicates are refused.
    """
    state = client.get(f"/api/leagues/{league}/auction/state", headers=auth).json()
    if state["current_player"]:
        return state["current_player"]["mobile"]

    if state["remaining_in_pool"] == 0:
        existing = len(client.get(f"/api/leagues/{league}/players", headers=auth).json())
        client.post(
            f"/api/leagues/{league}/players",
            json={"name": f"Spare {existing}", "mobile": f"90000000{existing:02d}"},
            headers=auth,
        )
    called = client.post(f"/api/leagues/{league}/auction/next-player", headers=auth)
    assert called.status_code == 200, called.text
    return called.json()["mobile"]


def test_the_switch_is_off_by_default(client, league):
    body = client.get(f"/api/leagues/{league}").json()
    assert body["show_mobile_publicly"] is False


def test_turning_it_on_shows_numbers_to_watchers(client, league, auth):
    """With the switch on, a watcher in the live room sees the number too."""
    number = ensure_on_block(client, league, auth)
    client.patch(f"/api/leagues/{league}", json={"show_mobile_publicly": True}, headers=auth)

    viewer = client.post("/api/viewer", json={"email": "watch@spm.local"}, headers=auth).json()
    header = {
        "Authorization": "Bearer "
        + client.post(
            "/api/auth/login",
            json={"email": viewer["email"], "password": viewer["password"]},
        ).json()["access_token"]
    }
    state = client.get(f"/api/leagues/{league}/auction/state", headers=header).json()
    assert state["current_player"]["mobile"] == number

    client.patch(f"/api/leagues/{league}", json={"show_mobile_publicly": False}, headers=auth)


def test_the_socket_follows_the_same_switch(client, league, auth):
    number = ensure_on_block(client, league, auth)
    token = client.post(
        "/api/auth/login",
        json={"email": settings.admin_email, "password": settings.admin_password},
    ).json()["access_token"]
    feed = f"/api/leagues/{league}/auction/ws?token={token}"

    client.patch(f"/api/leagues/{league}", json={"show_mobile_publicly": True}, headers=auth)
    with client.websocket_connect(feed) as ws:
        assert ws.receive_json()["payload"]["state"]["current_player"]["mobile"] == number

    client.patch(f"/api/leagues/{league}", json={"show_mobile_publicly": False}, headers=auth)
    with client.websocket_connect(feed) as ws:
        assert ws.receive_json()["payload"]["state"]["current_player"]["mobile"] is None


def test_turning_it_off_hides_them_again(client, league, auth):
    ensure_on_block(client, league, auth)
    client.patch(f"/api/leagues/{league}", json={"show_mobile_publicly": False}, headers=auth)

    viewer = client.post("/api/viewer", json={"email": "watch2@spm.local"}, headers=auth).json()
    header = {
        "Authorization": "Bearer "
        + client.post(
            "/api/auth/login",
            json={"email": viewer["email"], "password": viewer["password"]},
        ).json()["access_token"]
    }
    state = client.get(f"/api/leagues/{league}/auction/state", headers=header).json()
    assert state["current_player"]["mobile"] is None


def test_only_an_admin_can_flip_it(client, league):
    res = client.patch(f"/api/leagues/{league}", json={"show_mobile_publicly": True})
    assert res.status_code == 401
