"""First-run bootstrap: create the admin account if it isn't there yet."""

import logging
import random
from datetime import datetime, timedelta, timezone

from .config import settings
from .database import SessionLocal
from .models import (
    AuctionSettings,
    League,
    LeagueStatus,
    Player,
    PlayerRole,
    Team,
    User,
)
from .security import hash_password

log = logging.getLogger(__name__)


def bootstrap() -> None:
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            db.add(
                User(
                    email=settings.admin_email.lower(),
                    full_name="Auction Administrator",
                    hashed_password=hash_password(settings.admin_password),
                    role="admin",
                )
            )
            db.commit()
            log.warning(
                "Created the first admin account (%s). Change this password before going live.",
                settings.admin_email,
            )
    finally:
        db.close()


TEAM_SEED = [
    ("SPM Spirits", "SPM", "R. Prakash", "#E4572E"),
    ("Warriors", "WAR", "K. Naveen", "#2E9E8F"),
    ("Rising Stars", "RIS", "S. Latha", "#F2A03D"),
    ("Thunder Kings", "THK", "M. Arun", "#7B5EA7"),
    ("Super XI", "SXI", "D. Venkat", "#3C6EE0"),
    ("Royal Smashers", "ROY", "P. Ganesh", "#C43D5C"),
]

FIRST = ["Arun", "Vishal", "Karthik", "Naveen", "Suresh", "Manoj", "Ravi", "Deepak", "Ajay", "Kiran",
         "Harish", "Sandeep", "Praveen", "Vinod", "Gopal", "Sathish", "Rahul", "Anand", "Bharat", "Charan"]
LAST = ["Kumar", "Reddy", "Naidu", "Sharma", "Rao", "Varma", "Chowdary", "Prasad", "Babu", "Nair"]
PLACES = ["Tirupati", "Chittoor", "Renigunta", "Srikalahasti", "Madanapalle", "Puttur", "Nagari"]
BAT = ["Right hand bat", "Left hand bat"]
BOWL = ["Right arm medium", "Right arm off break", "Left arm orthodox", "Right arm fast", "Left arm medium"]


def seed_demo(player_count: int = 420) -> None:
    """Populate a demo league. Run with `python -m app.seed`."""
    db = SessionLocal()
    try:
        if db.query(League).filter(League.name == "Tirupati Premier League").first():
            log.info("Demo league already exists — nothing to do.")
            return

        league = League(
            name="Tirupati Premier League",
            season="2026",
            auction_date=datetime.now(timezone.utc) + timedelta(days=7),
            venue="SPM Indoor Arena, Tirupati",
            about="Six squads, 400+ registered players, one evening to build a winner.",
            status=LeagueStatus.UPCOMING,
        )
        db.add(league)
        db.flush()
        db.add(AuctionSettings(league_id=league.id))

        for name, short, owner, colour in TEAM_SEED:
            db.add(
                Team(
                    league_id=league.id,
                    name=name,
                    short_name=short,
                    owner_name=owner,
                    captain_name=None,
                    accent_color=colour,
                    purse_amount=settings.default_purse,
                )
            )

        used: set[str] = set()
        mobile = 9000000000
        for i in range(player_count):
            full = f"{random.choice(FIRST)} {random.choice(LAST)}"
            while full in used:
                full = f"{random.choice(FIRST)} {random.choice(LAST)} {len(used)}"
            used.add(full)
            db.add(
                Player(
                    league_id=league.id,
                    name=full,
                    mobile=str(mobile + i),
                    place=random.choice(PLACES),
                    role=random.choice(list(PlayerRole)),
                    jersey_number=random.randint(1, 99),
                    age=random.randint(17, 41),
                    batting_style=random.choice(BAT),
                    bowling_style=random.choice(BOWL),
                )
            )
        db.commit()
        log.info("Seeded %s with %s players and %s teams.", league.name, player_count, len(TEAM_SEED))
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    bootstrap()
    seed_demo()
