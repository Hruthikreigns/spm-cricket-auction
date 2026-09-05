"""The auction archive.

Nothing is deleted when an auction finishes — squads, prices, bids and the
registrations behind them all stay in the database. This assembles them into
the record an organiser actually wants afterwards: who went to which squad,
for how much, and the details that person gave when they signed up.

One endpoint, two audiences. Anybody can read prices and squads; contact
details only come back for a signed-in organiser, because a public archive of
every player's phone number is not something to hand out by accident.
"""

from sqlalchemy.orm import Session, joinedload

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func

from ..database import get_db
from ..models import (
    Bid,
    League,
    Player,
    PlayerStatus,
    Registration,
    Team,
    User,
)
from ..schemas import (
    ArchivedPlayer,
    LeagueResults,
    RegistrationDetail,
    ResultsSummary,
    SquadResult,
    TeamMini,
)
from ..security import get_optional_user

router = APIRouter(prefix="/api/leagues/{league_id}", tags=["archive"])

SQUAD = (PlayerStatus.SOLD, PlayerStatus.RETAINED)


def _detail(entry: Registration | None, include_contact: bool) -> RegistrationDetail | None:
    """What the player told us when they signed up.

    `include_contact` gates the phone number and free-text note — the two
    fields a stranger has no business reading.
    """
    if entry is None:
        return None
    return RegistrationDetail(
        registered_at=entry.created_at,
        mobile=entry.mobile if include_contact else None,
        email=entry.email if include_contact else None,
        note=entry.note if include_contact else None,
        place=entry.place,
        age=entry.age,
        batting_style=entry.batting_style,
        bowling_style=entry.bowling_style,
        submitted_photo_url=entry.photo_url,
        status=entry.status,
    )


@router.get("/results", response_model=LeagueResults)
def results(
    league_id: int,
    db: Session = Depends(get_db),
    viewer: User | None = Depends(get_optional_user),
):
    """The full record of one auction: squads, prices, and who signed up."""
    league = db.get(League, league_id)
    if not league:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That league doesn't exist.")

    include_contact = viewer is not None

    players = (
        db.query(Player)
        .options(joinedload(Player.team))
        .filter(Player.league_id == league_id)
        .all()
    )
    teams = db.query(Team).filter(Team.league_id == league_id).order_by(Team.name).all()

    # Registrations keyed by the player they became, so a squad list can show
    # the sign-up behind each name.
    registrations = {
        r.player_id: r
        for r in db.query(Registration).filter(
            Registration.league_id == league_id, Registration.player_id.isnot(None)
        )
    }

    # How many times each player was bid on, which is the closest thing to a
    # measure of how hard they were fought over.
    bid_counts = dict(
        db.query(Bid.player_id, func.count(Bid.id))
        .filter(Bid.league_id == league_id, Bid.voided.is_(False))
        .group_by(Bid.player_id)
        .all()
    )

    def archived(p: Player) -> ArchivedPlayer:
        return ArchivedPlayer(
            id=p.id,
            name=p.name,
            role=p.role,
            place=p.place,
            jersey_number=p.jersey_number,
            photo_url=p.photo_url,
            age=p.age,
            batting_style=p.batting_style,
            bowling_style=p.bowling_style,
            status=p.status,
            sold_price=p.sold_price,
            sold_at=p.sold_at,
            auction_round=p.auction_round,
            bid_count=bid_counts.get(p.id, 0),
            registration=_detail(registrations.get(p.id), include_contact),
        )

    squads: list[SquadResult] = []
    for team in teams:
        squad = [p for p in players if p.team_id == team.id and p.status in SQUAD]
        squad.sort(key=lambda p: (p.sold_price or 0), reverse=True)
        prices = [p.sold_price or 0 for p in squad]
        squads.append(
            SquadResult(
                team=TeamMini.model_validate(team),
                owner_name=team.owner_name,
                captain_name=team.captain_name,
                purse_amount=team.purse_amount,
                spent=team.spent,
                remaining_purse=team.remaining_purse,
                player_count=len(squad),
                retained_count=len([p for p in squad if p.status == PlayerStatus.RETAINED]),
                most_expensive=max(prices) if prices else None,
                players=[archived(p) for p in squad],
            )
        )

    sold = [p for p in players if p.status == PlayerStatus.SOLD]
    unsold = [p for p in players if p.status == PlayerStatus.UNSOLD]
    prices = [p.sold_price for p in sold if p.sold_price]
    top = max(sold, key=lambda p: p.sold_price or 0) if sold else None

    return LeagueResults(
        league_id=league.id,
        league_name=league.name,
        season=league.season,
        venue=league.venue,
        auction_date=league.auction_date,
        status=league.status,
        logo_url=league.logo_url,
        poster_url=league.poster_url,
        viewer_is_admin=include_contact,
        summary=ResultsSummary(
            total_players=len(players),
            sold_players=len(sold),
            retained_players=len([p for p in players if p.status == PlayerStatus.RETAINED]),
            unsold_players=len(unsold),
            total_spent=sum(t.spent for t in teams),
            highest_price=max(prices) if prices else None,
            average_price=round(sum(prices) / len(prices)) if prices else None,
            most_expensive_player=top.name if top else None,
            most_expensive_team=top.team.name if top and top.team else None,
            registrations_received=db.query(func.count(Registration.id))
            .filter(Registration.league_id == league_id)
            .scalar()
            or 0,
        ),
        squads=squads,
        unsold=[archived(p) for p in sorted(unsold, key=lambda p: p.name)],
    )
