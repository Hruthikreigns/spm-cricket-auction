"""Public self-registration, and the organiser's review of it."""

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
def league_id(client, auth):
    return client.post("/api/leagues", json={"name": "Open League"}, headers=auth).json()["id"]


def auth_header(client):
    res = client.post(
        "/api/auth/login",
        json={"email": settings.admin_email, "password": settings.admin_password},
    )
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


PHOTO = ("me.jpg", b"\xff\xd8\xff\xe0fake-jpeg", "image/jpeg")


def sign_up(client, league_id, photo=PHOTO, **fields):
    """A registration exactly as the form sends it: fields plus a photo."""
    data = {
        "name": "Ravi Kumar",
        "mobile": "98765 43210",
        "email": "ravi@example.com",
        "place": "Tirupati",
        "role": "ALL_ROUNDER",
    }
    data.update(fields)
    files = {"photo": (photo[0], io.BytesIO(photo[1]), photo[2])} if photo else None
    return client.post(f"/api/leagues/{league_id}/registrations", data=data, files=files)


# --------------------------------------------------------------------------
def test_anyone_can_register_without_an_account(client, league_id):
    res = sign_up(client, league_id)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "PENDING"
    assert "confirm your entry" in body["message"]


def test_a_registration_is_not_yet_a_player(client, league_id, auth):
    players = client.get(f"/api/leagues/{league_id}/players", headers=auth).json()
    assert players == [], "nothing unvetted should reach the auction pool"


def test_the_same_mobile_cannot_register_twice(client, league_id):
    res = sign_up(client, league_id, name="Someone Else")
    assert res.status_code == 409
    assert "already registered" in res.json()["detail"]


def test_the_mobile_number_is_cleaned_up(client, league_id, auth):
    rows = client.get(f"/api/leagues/{league_id}/registrations", headers=auth).json()
    assert rows[0]["mobile"] == "9876543210", "spaces stripped on the way in"


def test_a_short_name_is_refused(client, league_id):
    res = sign_up(client, league_id, name="R", mobile="9000000001", email="short@example.com")
    assert res.status_code == 400


def test_a_nonsense_mobile_is_refused(client, league_id):
    res = sign_up(client, league_id, name="Test Player", mobile="abc", email="t@example.com")
    assert res.status_code == 400


def test_a_photo_is_required(client, league_id):
    res = sign_up(client, league_id, photo=None, name="No Photo", mobile="9000000077",
                  email="nophoto@example.com")
    assert res.status_code == 400
    assert "photo" in res.json()["detail"].lower()


def test_an_empty_photo_file_is_refused(client, league_id):
    res = sign_up(client, league_id, photo=("empty.jpg", b"", "image/jpeg"),
                  name="Empty Photo", mobile="9000000078", email="empty@example.com")
    assert res.status_code == 400


def test_a_pdf_pretending_to_be_a_photo_is_refused(client, league_id):
    res = sign_up(client, league_id, photo=("cv.pdf", b"%PDF-1.4", "application/pdf"),
                  name="Wrong Type", mobile="9000000079", email="pdf@example.com")
    assert res.status_code == 400


def test_email_is_required(client, league_id):
    """Optional in the signature so a returning player can leave it blank —
    but a first-timer gets a plain message, not a validation dump."""
    res = client.post(
        f"/api/leagues/{league_id}/registrations",
        data={"name": "No Email", "mobile": "9000000080", "place": "Tirupati", "role": "BOWLER"},
        files={"photo": ("me.jpg", io.BytesIO(b"fake"), "image/jpeg")},
    )
    assert res.status_code == 400
    assert "email" in res.json()["detail"].lower()


def test_a_malformed_email_is_refused(client, league_id):
    res = sign_up(client, league_id, name="Bad Email", mobile="9000000081", email="not-an-email")
    assert res.status_code == 400
    assert "email" in res.json()["detail"].lower()


def test_the_same_email_cannot_register_twice(client, league_id):
    res = sign_up(client, league_id, name="Different Person", mobile="9000000082",
                  email="RAVI@example.com")
    assert res.status_code == 409
    assert "email" in res.json()["detail"].lower()


def test_the_email_is_stored_lowercased(client, league_id, auth):
    rows = client.get(f"/api/leagues/{league_id}/registrations", headers=auth).json()
    ravi = next(r for r in rows if r["name"] == "Ravi Kumar")
    assert ravi["email"] == "ravi@example.com"


def test_the_second_player_can_still_register(client, league_id):
    res = sign_up(client, league_id, name="Suresh Naidu", mobile="9876543211",
                  email="suresh@example.com", role="WICKET_KEEPER")
    assert res.status_code == 201, res.text


def test_the_registration_list_is_not_public(client, league_id):
    assert client.get(f"/api/leagues/{league_id}/registrations").status_code == 401


def test_the_public_status_endpoint_hides_personal_details(client, league_id):
    body = client.get(f"/api/leagues/{league_id}/registrations/status").json()
    assert body["open"] is True
    assert body["pending"] == 2
    assert set(body) == {
        "pending",
        "approved",
        "rejected",
        "open",
        "closed_by_admin",
        "league_status",
        "share_path",
    }, "counts and state only — no names, numbers or emails"


def test_reviewing_needs_an_admin(client, league_id):
    assert client.get(f"/api/leagues/{league_id}/registrations").status_code == 401
    assert client.post(f"/api/leagues/{league_id}/registrations/1/approve").status_code == 401


def test_approving_creates_the_player(client, league_id, auth):
    rows = client.get(f"/api/leagues/{league_id}/registrations", headers=auth).json()
    entry = next(r for r in rows if r["name"] == "Ravi Kumar")
    res = client.post(
        f"/api/leagues/{league_id}/registrations/{entry['id']}/approve", headers=auth
    )
    assert res.status_code == 200, res.text
    approved = res.json()
    assert approved["status"] == "APPROVED"
    assert approved["player_id"] is not None

    players = client.get(f"/api/leagues/{league_id}/players", headers=auth).json()
    assert [p["name"] for p in players] == ["Ravi Kumar"]
    assert players[0]["status"] == "AVAILABLE"
    assert players[0]["mobile"] == "9876543210"

    # And the register isn't public at all.
    assert client.get(f"/api/leagues/{league_id}/players").status_code == 401


def test_approving_twice_is_refused(client, league_id, auth):
    entry = [
        r
        for r in client.get(f"/api/leagues/{league_id}/registrations", headers=auth).json()
        if r["status"] == "APPROVED"
    ][0]
    res = client.post(f"/api/leagues/{league_id}/registrations/{entry['id']}/approve", headers=auth)
    assert res.status_code == 409


def test_rejecting_leaves_the_pool_alone(client, league_id, auth):
    rows = client.get(f"/api/leagues/{league_id}/registrations", headers=auth).json()
    entry = next(r for r in rows if r["name"] == "Suresh Naidu" and r["status"] == "PENDING")
    res = client.post(
        f"/api/leagues/{league_id}/registrations/{entry['id']}/reject",
        json={"note": "Not eligible for this league"},
        headers=auth,
    )
    assert res.status_code == 200
    assert res.json()["status"] == "REJECTED"
    assert len(client.get(f"/api/leagues/{league_id}/players").json()) == 1


def test_a_rejected_number_may_register_again(client, league_id):
    res = sign_up(client, league_id, name="Suresh Naidu", mobile="9876543211",
                  email="suresh@example.com")
    assert res.status_code == 201, "a rejection shouldn't lock someone out permanently"


# --------------------------------------------------------------------------
# The organiser's on/off switch
# --------------------------------------------------------------------------
def test_an_organiser_can_close_registration_at_any_time(client, league_id, auth):
    client.patch(f"/api/leagues/{league_id}", json={"registration_open": False}, headers=auth)

    res = sign_up(client, league_id, name="Too Late", mobile="9000000090",
                  email="late@example.com")
    assert res.status_code == 400
    assert "closed registration" in res.json()["detail"]

    body = client.get(f"/api/leagues/{league_id}/registrations/status").json()
    assert body["open"] is False
    assert body["closed_by_admin"] is True, "the form should say who closed it"
    assert body["league_status"] == "UPCOMING", "the league itself is still upcoming"


def test_reopening_lets_people_in_again(client, league_id, auth):
    client.patch(f"/api/leagues/{league_id}", json={"registration_open": True}, headers=auth)
    res = sign_up(client, league_id, name="Back Open", mobile="9000000091",
                  email="reopen@example.com")
    assert res.status_code == 201

    body = client.get(f"/api/leagues/{league_id}/registrations/status").json()
    assert body["open"] is True and body["closed_by_admin"] is False


def test_closing_registration_needs_an_admin(client, league_id):
    res = client.patch(f"/api/leagues/{league_id}", json={"registration_open": False})
    assert res.status_code == 401


def test_registration_closes_once_the_auction_starts(client, league_id, auth):
    client.patch(f"/api/leagues/{league_id}", json={"status": "LIVE"}, headers=auth)
    res = sign_up(client, league_id, name="Late Arrival", mobile="9000000009")
    assert res.status_code == 400
    assert "under way" in res.json()["detail"]

    body = client.get(f"/api/leagues/{league_id}/registrations/status").json()
    assert body["open"] is False
    client.patch(f"/api/leagues/{league_id}", json={"status": "UPCOMING"}, headers=auth)


def test_bulk_approve_skips_clashes(client, league_id, auth):
    sign_up(client, league_id, name="Deepak Rao", mobile="9111111111", email="deepak@example.com")
    sign_up(client, league_id, name="Ravi Kumar", mobile="9222222222", email="ravi2@example.com")

    before = len(client.get(f"/api/leagues/{league_id}/players", headers=auth).json())
    client.post(f"/api/leagues/{league_id}/registrations/approve-all", headers=auth)
    after = client.get(f"/api/leagues/{league_id}/players", headers=auth).json()

    names = [p["name"] for p in after]
    assert names.count("Ravi Kumar") == 1, "the duplicate name was skipped, not added twice"
    assert "Deepak Rao" in names
    assert len(after) > before


def test_registering_for_a_missing_league_404s(client):
    res = sign_up(client, 9999, name="Nobody", mobile="9333333333", email="nobody@example.com")
    assert res.status_code == 404


# --------------------------------------------------------------------------
# The printable register
# --------------------------------------------------------------------------
def test_the_pdf_is_admin_only(client, league_id):
    assert client.get(f"/api/leagues/{league_id}/registrations/export.pdf").status_code == 401


def test_the_pdf_downloads(client, league_id, auth):
    res = client.get(f"/api/leagues/{league_id}/registrations/export.pdf", headers=auth)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF-"), "a real PDF, not an error page"
    assert "attachment" in res.headers["content-disposition"]
    assert ".pdf" in res.headers["content-disposition"]


def test_the_pdf_can_be_filtered_by_status(client, league_id, auth):
    every = client.get(f"/api/leagues/{league_id}/registrations/export.pdf", headers=auth)
    approved = client.get(
        f"/api/leagues/{league_id}/registrations/export.pdf?status_filter=APPROVED", headers=auth
    )
    assert approved.status_code == 200
    assert "approved-registrations" in approved.headers["content-disposition"]
    assert len(approved.content) < len(every.content), "fewer rows, smaller file"


def test_the_pdf_contains_the_players_and_their_details(client, league_id, auth):
    import io

    from pypdf import PdfReader

    res = client.get(f"/api/leagues/{league_id}/registrations/export.pdf", headers=auth)
    text = " ".join(page.extract_text() for page in PdfReader(io.BytesIO(res.content)).pages)

    assert "Ravi Kumar" in text
    assert "9876543210" in text, "the mobile number is the point of this document"
    assert "ravi@example.com" in text
    assert "Tirupati" in text


def test_the_pdf_works_without_photos(client, league_id, auth):
    res = client.get(
        f"/api/leagues/{league_id}/registrations/export.pdf?photos=false", headers=auth
    )
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF-")


def test_a_league_with_no_registrations_still_renders(client, auth):
    empty = client.post("/api/leagues", json={"name": "Empty League"}, headers=auth).json()["id"]
    res = client.get(f"/api/leagues/{empty}/registrations/export.pdf", headers=auth)
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF-"), "an empty list is a valid document, not an error"


def test_the_pdf_404s_for_a_missing_league(client, auth):
    assert client.get("/api/leagues/9999/registrations/export.pdf", headers=auth).status_code == 404


def test_a_corrupt_photo_does_not_break_the_export(client, league_id, auth):
    """Someone will upload a half-transferred file. The register must survive."""
    import io as _io

    res = client.post(
        f"/api/leagues/{league_id}/registrations",
        data={
            "name": "Broken Photo",
            "mobile": "9000000123",
            "email": "broken@example.com",
            "place": "Tirupati",
            "role": "BATSMAN",
        },
        # Valid JPEG magic bytes, then nothing — passes the upload check,
        # fails to decode later.
        files={"photo": ("half.jpg", _io.BytesIO(b"\xff\xd8\xff\xe0truncated"), "image/jpeg")},
    )
    assert res.status_code == 201, "the upload itself is accepted"

    pdf = client.get(f"/api/leagues/{league_id}/registrations/export.pdf", headers=auth)
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-")

    from pypdf import PdfReader

    text = " ".join(p.extract_text() for p in PdfReader(_io.BytesIO(pdf.content)).pages)
    assert "Broken Photo" in text, "the row is still listed, just without a picture"


# --------------------------------------------------------------------------
# The player's own card
# --------------------------------------------------------------------------
def test_signing_up_returns_a_card_link(client, auth):
    lid = client.post("/api/leagues", json={"name": "Card League"}, headers=auth).json()["id"]
    res = sign_up(client, lid, name="Ravi Kumar", mobile="9876500001", email="card@example.com")
    body = res.json()

    assert body["card_url"].startswith(f"/api/leagues/{lid}/registrations/")
    assert "token=" in body["card_url"], "the link has to work without an account"
    return lid, body


def test_the_card_downloads_with_the_token(client, auth):
    lid, body = test_signing_up_returns_a_card_link(client, auth)
    res = client.get(body["card_url"])
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF-")
    assert "ravi-kumar-registration.pdf" in res.headers["content-disposition"]


def test_the_card_shows_the_players_own_details(client, auth):
    import io as _io

    from pypdf import PdfReader

    lid, body = test_signing_up_returns_a_card_link(client, auth)
    res = client.get(body["card_url"])
    text = " ".join(p.extract_text() for p in PdfReader(_io.BytesIO(res.content)).pages)

    assert "Ravi Kumar" in text
    assert "CARD LEAGUE" in text.upper()
    assert "9876500001" in text
    assert "Pending" in text, "so they know it still needs confirming"


def test_a_wrong_token_gets_nothing(client, auth):
    lid, body = test_signing_up_returns_a_card_link(client, auth)
    without = body["card_url"].split("?")[0]

    assert client.get(without).status_code == 403
    assert client.get(f"{without}?token=guessing").status_code == 403


def test_one_players_token_does_not_open_anothers_card(client, auth):
    lid, first = test_signing_up_returns_a_card_link(client, auth)
    second = sign_up(
        client, lid, name="Suresh Naidu", mobile="9876500002", email="second@example.com"
    ).json()

    stolen = first["card_url"].split("token=")[1]
    res = client.get(f"/api/leagues/{lid}/registrations/{second['id']}/card.pdf?token={stolen}")
    assert res.status_code == 403


def test_an_organiser_can_fetch_any_card(client, auth):
    lid, body = test_signing_up_returns_a_card_link(client, auth)
    without = body["card_url"].split("?")[0]
    assert client.get(without, headers=auth).status_code == 200


# --------------------------------------------------------------------------
# Returning players
# --------------------------------------------------------------------------
def test_an_unknown_number_returns_nothing(client, league_id):
    body = client.get(f"/api/leagues/{league_id}/registrations/lookup?mobile=9111100000").json()
    assert body["found"] is False
    assert body["name"] is None


def test_a_partial_number_is_not_looked_up(client, league_id):
    """Otherwise the form becomes a way to fish for records."""
    body = client.get(f"/api/leagues/{league_id}/registrations/lookup?mobile=98765").json()
    assert body["found"] is False


def test_a_returning_player_is_recognised_across_leagues(client, auth):
    first = client.post("/api/leagues", json={"name": "Season One"}, headers=auth).json()["id"]
    sign_up(
        client, first, name="Ravi Kumar", mobile="9876511111", email="ravi.k@example.com",
        place="Tirupati", role="ALL_ROUNDER",
    )

    second = client.post("/api/leagues", json={"name": "Season Two"}, headers=auth).json()["id"]
    body = client.get(f"/api/leagues/{second}/registrations/lookup?mobile=9876511111").json()

    assert body["found"] is True
    assert body["name"] == "Ravi Kumar"
    assert body["role"] == "ALL_ROUNDER"
    assert body["place"] == "Tirupati"
    assert body["last_league"] == "Season One"
    return second


def test_the_lookup_never_returns_the_email_in_full(client, auth):
    second = test_a_returning_player_is_recognised_across_leagues(client, auth)
    body = client.get(f"/api/leagues/{second}/registrations/lookup?mobile=9876511111").json()

    assert "ravi.k@example.com" not in str(body), "a public endpoint must not hand out addresses"
    assert body["email_masked"].endswith("@example.com")
    assert body["email_masked"].startswith("r")
    assert "*" in body["email_masked"]


def test_a_returning_player_need_not_retype_their_email(client, auth):
    second = test_a_returning_player_is_recognised_across_leagues(client, auth)

    res = client.post(
        f"/api/leagues/{second}/registrations",
        data={
            "name": "Ravi Kumar",
            "mobile": "9876511111",
            "place": "Tirupati",
            "role": "ALL_ROUNDER",
        },
        files={"photo": ("me.jpg", io.BytesIO(b"\xff\xd8\xff\xe0fake"), "image/jpeg")},
    )
    assert res.status_code == 201, res.text

    rows = client.get(f"/api/leagues/{second}/registrations", headers=auth_header(client)).json()
    assert rows[0]["email"] == "ravi.k@example.com", "the stored address was reused"


def test_a_returning_player_need_not_upload_a_photo_again(client, auth):
    second = test_a_returning_player_is_recognised_across_leagues(client, auth)

    res = client.post(
        f"/api/leagues/{second}/registrations",
        data={
            "name": "Ravi Kumar",
            "mobile": "9876511111",
            "email": "ravi.k@example.com",
            "place": "Tirupati",
            "role": "ALL_ROUNDER",
        },
    )
    assert res.status_code == 201, res.text

    rows = client.get(f"/api/leagues/{second}/registrations", headers=auth_header(client)).json()
    assert rows[0]["photo_url"], "the previous photo carried over"


def test_a_brand_new_player_still_needs_a_photo(client, league_id):
    res = client.post(
        f"/api/leagues/{league_id}/registrations",
        data={
            "name": "Nobody Yet",
            "mobile": "9333300000",
            "email": "new@example.com",
            "place": "Tirupati",
        },
    )
    assert res.status_code == 400
    assert "photo" in res.json()["detail"].lower()


def test_a_brand_new_player_still_needs_an_email(client, league_id):
    res = client.post(
        f"/api/leagues/{league_id}/registrations",
        data={"name": "Nobody Yet", "mobile": "9333300001", "place": "Tirupati"},
        files={"photo": ("me.jpg", io.BytesIO(b"\xff\xd8\xff\xe0fake"), "image/jpeg")},
    )
    assert res.status_code == 400
    assert "email" in res.json()["detail"].lower()



def test_place_is_required(client, league_id):
    res = client.post(
        f"/api/leagues/{league_id}/registrations",
        data={"name": "No Place", "mobile": "9000000200", "email": "noplace@example.com"},
        files={"photo": ("me.jpg", io.BytesIO(b"\xff\xd8\xff\xe0fake"), "image/jpeg")},
    )
    assert res.status_code == 400
    assert "place" in res.json()["detail"].lower()
