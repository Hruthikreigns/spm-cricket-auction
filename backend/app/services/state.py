"""Builds the payload every live screen renders from."""

from sqlalchemy.orm import Session

from ..models import Bid, League, Player, Team
from ..schemas import AuctionStateOut, BidOut, PlayerOut, TeamMini, TeamOut
from . import auction as engine


def contact_visible(db: Session, league_id: int, viewer_is_admin: bool) -> bool:
    """Organisers always; everyone else only if the league says so."""
    if viewer_is_admin:
        return True
    league = db.get(League, league_id)
    return bool(league and getattr(league, "show_mobile_publicly", False))


def public_player(player: Player, include_contact: bool) -> PlayerOut:
    """Serialise a player, holding back the phone number unless asked.

    The auction feed goes to every phone in the ground, so contact details are
    stripped by default and only restored for a signed-in organiser.
    """
    out = PlayerOut.model_validate(player)
    if not include_contact:
        out.mobile = None
    return out


def build_state(db: Session, league_id: int, include_contact: bool = False) -> AuctionStateOut:
    session = engine.get_session(db, league_id)
    cfg = engine.get_settings(db, league_id)

    player = db.get(Player, session.current_player_id) if session.current_player_id else None
    team = db.get(Team, session.current_team_id) if session.current_team_id else None

    history: list[BidOut] = []
    if player:
        bids = (
            db.query(Bid)
            .filter(Bid.player_id == player.id, Bid.auction_round == session.current_round)
            .order_by(Bid.id.desc())
            .limit(25)
            .all()
        )
        history = [BidOut.model_validate(b) for b in bids]

    upcoming = engine.next_bid_amount(session, cfg)

    return AuctionStateOut(
        league_id=league_id,
        status=session.status,
        current_round=session.current_round,
        current_player=public_player(player, include_contact) if player else None,
        current_bid=session.current_bid,
        current_team=TeamMini.model_validate(team) if team else None,
        timer_ends_at=session.timer_ends_at,
        next_bid_amount=upcoming,
        bid_history=history,
        remaining_in_pool=engine.pool_remaining(db, league_id),
        eligible_team_ids=engine.eligible_team_ids(db, league_id, cfg, upcoming),
    )


def team_board(db: Session, league_id: int) -> list[TeamOut]:
    teams = db.query(Team).filter(Team.league_id == league_id).order_by(Team.name).all()
    return [TeamOut.model_validate(t) for t in teams]
