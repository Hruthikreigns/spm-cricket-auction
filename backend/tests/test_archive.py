"""The record of a finished auction, and who is allowed to see what."""

import io

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
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture(scope="module")
def finished(client, auth):
    """Run a small auction end to end, including a self-registered player."""
    lid = client.post(
        "/api/leagues", json={"name": "Archive Cup", "season": "2026"}, headers=auth
    ).json()["id"]
    client.patch(
        f"/api/leagues/{lid}/settings",
        json={"min_players": 1, "max_players": 4, "enforce_squad_reserve": False},
        headers=auth,
    )
    spirit = client.post(f"/api/leagues/{lid}/teams", json={"name": "Team Spirit"}, headers=auth).json()
    client.post(f"/api/leagues/{lid}/teams", json={"name": "Smashers"}, headers=auth)

    # One player signs themselves up through the public form.
    signed_up = client.post(
        f"/api/leagues/{lid}/registrations",
        data={
            "name": "Ravi Kumar",
            "mobile": "9876543210",
            "email": "ravi@example.com",
            "place": "Tirupati",
            "role": "ALL_ROUNDER",
            "note": "Played for the district side last season",
        },
        files={"photo": ("ravi.jpg", io.BytesIO(b"\xff\xd8\xff\xe0fake"), "image/jpeg")},
    )
    assert signed_up.status_code == 201, signed_up.text
    entry = client.get(f"/api/leagues/{lid}/registrations", headers=auth).json()[0]
    client.post(f"/api/leagues/{lid}/registrations/{entry['id']}/approve", headers=auth)

    # Two more come from the organiser directly.
    for i, name in enumerate(["Suresh Naidu", "Deepak Rao"], start=1):
        client.post(
            f"/api/leagues/{lid}/players",
            json={"name": name, "mobile": f"900000000{i}", "role": "BOWLER"},
            headers=auth,
        )

    # Retain one, auction the rest.
    pool = client.get(f"/api/leagues/{lid}/players", headers=auth).json()
    deepak = next(p for p in pool if p["name"] == "Deepak Rao")
    client.post(
        f"/api/leagues/{lid}/players/retain",
        json={"team_id": spirit["id"], "player_ids": [deepak["id"]]},
        headers=auth,
    )

    client.post(f"/api/leagues/{lid}/auction/start", headers=auth)
    while True:
        called = client.post(f"/api/leagues/{lid}/auction/next-player", headers=auth)
        if called.status_code != 200:
            break
        player = called.json()
        if player["name"] == "Ravi Kumar":
            client.post(
                f"/api/leagues/{lid}/auction/sell",
                json={"team_id": spirit["id"], "amount": 30000},
                headers=auth,
            )
        else:
            client.post(f"/api/leagues/{lid}/auction/unsold", headers=auth)

    client.post(f"/api/leagues/{lid}/auction/complete", headers=auth)
    client.patch(f"/api/leagues/{lid}", json={"status": "COMPLETED"}, headers=auth)
    return lid


# --------------------------------------------------------------------------
def test_the_record_survives_the_auction_ending(client, finished):
    body = client.get(f"/api/leagues/{finished}/results").json()
    assert body["status"] == "COMPLETED"
    assert body["summary"]["sold_players"] == 1
    assert body["summary"]["retained_players"] == 1
    assert body["summary"]["highest_price"] == 30000
    assert body["summary"]["most_expensive_player"] == "Ravi Kumar"
    assert body["summary"]["most_expensive_team"] == "Team Spirit"


def test_squads_list_who_they_bought_and_for_how_much(client, finished):
    body = client.get(f"/api/leagues/{finished}/results").json()
    spirit = next(s for s in body["squads"] if s["team"]["name"] == "Team Spirit")

    assert spirit["player_count"] == 2
    assert spirit["retained_count"] == 1
    assert spirit["spent"] == 33000  # 30,000 bought + 3,000 retention
    assert spirit["remaining_purse"] == 67000

    ravi = next(p for p in spirit["players"] if p["name"] == "Ravi Kumar")
    assert ravi["sold_price"] == 30000
    assert ravi["status"] == "SOLD"
    assert ravi["sold_at"] is not None


def test_players_are_listed_most_expensive_first(client, finished):
    body = client.get(f"/api/leagues/{finished}/results").json()
    spirit = next(s for s in body["squads"] if s["team"]["name"] == "Team Spirit")
    prices = [p["sold_price"] or 0 for p in spirit["players"]]
    assert prices == sorted(prices, reverse=True)


def test_a_sold_player_carries_their_registration(client, finished):
    body = client.get(f"/api/leagues/{finished}/results").json()
    spirit = next(s for s in body["squads"] if s["team"]["name"] == "Team Spirit")
    ravi = next(p for p in spirit["players"] if p["name"] == "Ravi Kumar")

    assert ravi["registration"] is not None
    assert ravi["registration"]["registered_at"] is not None
    assert ravi["registration"]["place"] == "Tirupati"
    assert ravi["registration"]["submitted_photo_url"] is not None
    assert ravi["registration"]["status"] == "APPROVED"


def test_the_public_never_sees_phone_numbers(client, finished):
    """The important one: an archive of everyone's mobile must not be public."""
    body = client.get(f"/api/leagues/{finished}/results").json()
    assert body["viewer_is_admin"] is False

    spirit = next(s for s in body["squads"] if s["team"]["name"] == "Team Spirit")
    ravi = next(p for p in spirit["players"] if p["name"] == "Ravi Kumar")
    assert ravi["registration"]["mobile"] is None
    assert ravi["registration"]["email"] is None
    assert ravi["registration"]["note"] is None

    # And nothing leaks anywhere else in the payload.
    assert "9876543210" not in str(body)
    assert "ravi@example.com" not in str(body), "email is contact detail too"


def test_an_organiser_does_see_the_contact_details(client, finished, auth):
    body = client.get(f"/api/leagues/{finished}/results", headers=auth).json()
    assert body["viewer_is_admin"] is True

    spirit = next(s for s in body["squads"] if s["team"]["name"] == "Team Spirit")
    ravi = next(p for p in spirit["players"] if p["name"] == "Ravi Kumar")
    assert ravi["registration"]["mobile"] == "9876543210"
    assert ravi["registration"]["email"] == "ravi@example.com"
    assert "district side" in ravi["registration"]["note"]


def test_an_expired_or_junk_token_is_treated_as_the_public(client, finished):
    body = client.get(
        f"/api/leagues/{finished}/results", headers={"Authorization": "Bearer not-a-real-token"}
    ).json()
    assert body["viewer_is_admin"] is False, "a bad token must not fall through to admin"
    assert "9876543210" not in str(body)
    assert "ravi@example.com" not in str(body), "email is contact detail too"


def test_players_added_by_the_organiser_have_no_registration(client, finished, auth):
    body = client.get(f"/api/leagues/{finished}/results", headers=auth).json()
    unsold_names = {p["name"] for p in body["unsold"]}
    assert "Suresh Naidu" in unsold_names
    suresh = next(p for p in body["unsold"] if p["name"] == "Suresh Naidu")
    assert suresh["registration"] is None, "imported players never signed up, so there's nothing to show"


def test_bid_counts_are_kept(client, finished, auth):
    body = client.get(f"/api/leagues/{finished}/results", headers=auth).json()
    spirit = next(s for s in body["squads"] if s["team"]["name"] == "Team Spirit")
    ravi = next(p for p in spirit["players"] if p["name"] == "Ravi Kumar")
    assert ravi["bid_count"] >= 1


def test_results_for_a_missing_league_404(client):
    assert client.get("/api/leagues/9999/results").status_code == 404
