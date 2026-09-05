"""Auction engine.

Every business rule from the brief is enforced here rather than in the
routers, so the HTTP layer and any future CLI or socket caller behave the
same way. Rules covered:

  * a player is called exactly once per round and never sold twice
  * the call order is shuffled once, then honoured
  * no team can bid past its remaining purse
  * no team can exceed max_players
  * a team below min_players must hold back base_price per unfilled slot
  * every bid is written to an append-only ledger
  * undo rewinds the last bid or the last sale without losing history
"""

import random
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import (
    AuctionSession,
    AuctionSettings,
    AuctionStatus,
    AuditLog,
    Bid,
    League,
    Player,
    PlayerStatus,
    Team,
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def get_session(db: Session, league_id: int) -> AuctionSession:
    session = db.query(AuctionSession).filter(AuctionSession.league_id == league_id).first()
    if not session:
        if not db.get(League, league_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "That league doesn't exist.")
        session = AuctionSession(league_id=league_id)
        db.add(session)
        db.commit()
        db.refresh(session)
    return session


def get_settings(db: Session, league_id: int) -> AuctionSettings:
    s = db.query(AuctionSettings).filter(AuctionSettings.league_id == league_id).first()
    if not s:
        s = AuctionSettings(league_id=league_id)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def log_action(db: Session, league_id: int | None, actor: str, action: str, detail: str = "") -> None:
    db.add(AuditLog(league_id=league_id, actor=actor, action=action, detail=detail))


def squad_size(db: Session, team_id: int) -> int:
    """Count a team's committed players straight from the table.

    The ORM relationship can be stale mid-transaction, and this number
    gates every purse guard, so it is always read fresh.
    """
    return (
        db.query(func.count(Player.id))
        .filter(
            Player.team_id == team_id,
            Player.status.in_((PlayerStatus.SOLD, PlayerStatus.RETAINED)),
        )
        .scalar()
        or 0
    )


def max_bid_for(db: Session, team: Team, cfg: AuctionSettings) -> int:
    """How much this team may commit to the player currently on the block.

    A team still short of a legal squad must leave base_price on the table
    for each slot it has yet to fill after this purchase.
    """
    remaining = team.remaining_purse
    if not cfg.enforce_squad_reserve:
        return remaining
    slots_after_this = max(0, cfg.min_players - (squad_size(db, team.id) + 1))
    reserve = slots_after_this * cfg.base_price
    return max(0, remaining - reserve)


def team_can_bid(db: Session, team: Team, cfg: AuctionSettings, amount: int) -> tuple[bool, str]:
    if squad_size(db, team.id) >= cfg.max_players:
        return False, f"{team.name} already has the maximum of {cfg.max_players} players."
    ceiling = max_bid_for(db, team, cfg)
    if amount > ceiling:
        return False, (
            f"{team.name} can bid at most ₹{ceiling:,} right now — "
            f"₹{team.remaining_purse:,} left, holding back enough to fill {cfg.min_players} slots."
        )
    return True, ""


def eligible_team_ids(db: Session, league_id: int, cfg: AuctionSettings, amount: int) -> list[int]:
    teams = db.query(Team).filter(Team.league_id == league_id).all()
    return [t.id for t in teams if team_can_bid(db, t, cfg, amount)[0]]


# --------------------------------------------------------------------------
# lifecycle
# --------------------------------------------------------------------------
def start_auction(db: Session, league_id: int, actor: str, reshuffle: bool = True) -> AuctionSession:
    session = get_session(db, league_id)
    if session.status == AuctionStatus.RUNNING:
        return session

    if reshuffle and session.status == AuctionStatus.NOT_STARTED:
        pool = (
            db.query(Player)
            .filter(Player.league_id == league_id, Player.status == PlayerStatus.AVAILABLE)
            .all()
        )
        if not pool:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "There are no available players to auction. Import players or release retentions first.",
            )
        random.shuffle(pool)
        for i, player in enumerate(pool):
            player.queue_position = i
        session.started_at = _now()
        session.current_round = 1

    session.status = AuctionStatus.RUNNING
    log_action(db, league_id, actor, "auction.start", f"round {session.current_round}")
    db.commit()
    db.refresh(session)
    return session


def set_paused(db: Session, league_id: int, paused: bool, actor: str) -> AuctionSession:
    session = get_session(db, league_id)
    if session.status not in (AuctionStatus.RUNNING, AuctionStatus.PAUSED):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The auction isn't running.")
    session.status = AuctionStatus.PAUSED if paused else AuctionStatus.RUNNING
    log_action(db, league_id, actor, "auction.pause" if paused else "auction.resume")
    db.commit()
    db.refresh(session)
    return session


def complete_auction(db: Session, league_id: int, actor: str) -> AuctionSession:
    session = get_session(db, league_id)
    session.status = AuctionStatus.COMPLETED
    session.current_player_id = None
    session.current_bid = None
    session.current_team_id = None
    session.timer_ends_at = None
    log_action(db, league_id, actor, "auction.complete")
    db.commit()
    db.refresh(session)
    return session


# --------------------------------------------------------------------------
# calling players
# --------------------------------------------------------------------------
def pool_remaining(db: Session, league_id: int) -> int:
    return (
        db.query(func.count(Player.id))
        .filter(Player.league_id == league_id, Player.status == PlayerStatus.AVAILABLE)
        .scalar()
        or 0
    )


def next_player(db: Session, league_id: int, actor: str) -> Player:
    """Call the next player in the shuffled order.

    The order is fixed at start time, so this is deterministic from here on
    and a player can never come up twice in the same round.
    """
    session = get_session(db, league_id)
    cfg = get_settings(db, league_id)

    if session.status == AuctionStatus.NOT_STARTED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Start the auction before calling a player.")
    if session.status == AuctionStatus.PAUSED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The auction is paused. Resume it to continue.")
    if session.current_player_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A player is still on the block. Mark them sold or unsold first.",
        )

    player = (
        db.query(Player)
        .filter(Player.league_id == league_id, Player.status == PlayerStatus.AVAILABLE)
        .order_by(Player.queue_position.asc().nullslast(), Player.id.asc())
        .first()
    )
    if not player:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Every player in the pool has been called. Start another round to revisit unsold players.",
        )

    player.status = PlayerStatus.ON_BLOCK
    player.auction_round = session.current_round
    session.current_player_id = player.id
    session.current_bid = None
    session.current_team_id = None
    session.timer_ends_at = _now() + timedelta(seconds=cfg.timer_seconds)
    log_action(db, league_id, actor, "player.called", f"{player.name} (#{player.id})")
    db.commit()
    db.refresh(player)
    return player


def start_next_round(db: Session, league_id: int, actor: str) -> AuctionSession:
    """Bring unsold players back for another round, reshuffled."""
    session = get_session(db, league_id)
    if session.current_player_id is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Close the player on the block first.")

    unsold = (
        db.query(Player)
        .filter(Player.league_id == league_id, Player.status == PlayerStatus.UNSOLD)
        .all()
    )
    if not unsold:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No unsold players are left to revisit.")

    random.shuffle(unsold)
    for i, player in enumerate(unsold):
        player.status = PlayerStatus.AVAILABLE
        player.queue_position = i
    session.current_round += 1
    session.status = AuctionStatus.RUNNING
    log_action(db, league_id, actor, "auction.round", f"round {session.current_round}, {len(unsold)} players")
    db.commit()
    db.refresh(session)
    return session


# --------------------------------------------------------------------------
# bidding
# --------------------------------------------------------------------------
def next_bid_amount(session: AuctionSession, cfg: AuctionSettings) -> int:
    if session.current_bid is None:
        return cfg.base_price
    return session.current_bid + cfg.bid_increment


def place_bid(db: Session, league_id: int, team_id: int, amount: int | None, actor: str) -> Bid:
    session = get_session(db, league_id)
    cfg = get_settings(db, league_id)

    if session.status != AuctionStatus.RUNNING:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The auction isn't running right now.")
    if session.current_player_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player is on the block.")

    team = db.get(Team, team_id)
    if not team or team.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That team isn't in this league.")

    bid_amount = amount if amount is not None else next_bid_amount(session, cfg)
    minimum = next_bid_amount(session, cfg)
    if bid_amount < minimum:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The next bid must be at least ₹{minimum:,}.",
        )
    if session.current_team_id == team_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{team.name} already holds the top bid.")

    ok, reason = team_can_bid(db, team, cfg, bid_amount)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, reason)

    db.query(Bid).filter(
        Bid.player_id == session.current_player_id, Bid.is_winning.is_(True)
    ).update({"is_winning": False})

    bid = Bid(
        league_id=league_id,
        player_id=session.current_player_id,
        team_id=team_id,
        amount=bid_amount,
        auction_round=session.current_round,
        is_winning=True,
    )
    db.add(bid)
    session.current_bid = bid_amount
    session.current_team_id = team_id
    session.timer_ends_at = _now() + timedelta(seconds=cfg.timer_seconds)
    log_action(db, league_id, actor, "bid.placed", f"team {team.name} ₹{bid_amount}")
    db.commit()
    db.refresh(bid)
    return bid


def undo_last_bid(db: Session, league_id: int, actor: str) -> AuctionSession:
    """Void the top bid and fall back to the one under it."""
    session = get_session(db, league_id)
    if session.current_player_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player is on the block.")

    last = (
        db.query(Bid)
        .filter(
            Bid.player_id == session.current_player_id,
            Bid.voided.is_(False),
            Bid.auction_round == session.current_round,
        )
        .order_by(Bid.id.desc())
        .first()
    )
    if not last:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "There are no bids to undo.")

    last.voided = True
    last.is_winning = False

    previous = (
        db.query(Bid)
        .filter(
            Bid.player_id == session.current_player_id,
            Bid.voided.is_(False),
            Bid.auction_round == session.current_round,
        )
        .order_by(Bid.id.desc())
        .first()
    )
    if previous:
        previous.is_winning = True
        session.current_bid = previous.amount
        session.current_team_id = previous.team_id
    else:
        session.current_bid = None
        session.current_team_id = None

    log_action(db, league_id, actor, "bid.undo", f"voided bid #{last.id} (₹{last.amount})")
    db.commit()
    db.refresh(session)
    return session


# --------------------------------------------------------------------------
# closing a player
# --------------------------------------------------------------------------
def mark_sold(db: Session, league_id: int, actor: str) -> Player:
    session = get_session(db, league_id)
    cfg = get_settings(db, league_id)

    if session.current_player_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player is on the block.")
    if session.current_bid is None or session.current_team_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Nobody has bid on this player. Mark them unsold instead.",
        )

    player = db.get(Player, session.current_player_id)
    team = db.get(Team, session.current_team_id)
    price = session.current_bid

    if player.status == PlayerStatus.SOLD:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{player.name} has already been sold.")

    # Re-check the guards at the moment of sale, not just at bid time.
    ok, reason = team_can_bid(db, team, cfg, price)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, reason)

    player.status = PlayerStatus.SOLD
    player.team_id = team.id
    player.sold_price = price
    player.sold_at = _now()
    player.auction_round = session.current_round
    team.spent += price

    session.current_player_id = None
    session.current_bid = None
    session.current_team_id = None
    session.timer_ends_at = None

    log_action(db, league_id, actor, "player.sold", f"{player.name} to {team.name} for ₹{price}")
    db.commit()
    db.refresh(player)
    return player


def sell_directly(db: Session, league_id: int, team_id: int, amount: int, actor: str) -> Player:
    """Record a finished sale in one step.

    For rooms where the auctioneer calls bids out loud and only the result is
    typed in. Every guard that applies to an incremental sale applies here
    too, and a winning bid is still written to the ledger so the history and
    the export stay complete.
    """
    session = get_session(db, league_id)
    cfg = get_settings(db, league_id)

    if session.status != AuctionStatus.RUNNING:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The auction isn't running right now.")
    if session.current_player_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player is on the block.")

    team = db.get(Team, team_id)
    if not team or team.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That team isn't in this league.")
    if amount < cfg.base_price:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The price can't be below the base price of ₹{cfg.base_price:,}.",
        )

    ok, reason = team_can_bid(db, team, cfg, amount)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, reason)

    player = db.get(Player, session.current_player_id)
    if player.status == PlayerStatus.SOLD:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{player.name} has already been sold.")

    # Supersede anything bid so far, then log the winning entry.
    db.query(Bid).filter(Bid.player_id == player.id, Bid.is_winning.is_(True)).update(
        {"is_winning": False}
    )
    db.add(
        Bid(
            league_id=league_id,
            player_id=player.id,
            team_id=team.id,
            amount=amount,
            auction_round=session.current_round,
            is_winning=True,
        )
    )

    player.status = PlayerStatus.SOLD
    player.team_id = team.id
    player.sold_price = amount
    player.sold_at = _now()
    player.auction_round = session.current_round
    team.spent += amount

    session.current_player_id = None
    session.current_bid = None
    session.current_team_id = None
    session.timer_ends_at = None

    log_action(db, league_id, actor, "player.sold_direct", f"{player.name} to {team.name} for ₹{amount}")
    db.commit()
    db.refresh(player)
    return player


def mark_unsold(db: Session, league_id: int, actor: str) -> Player:
    session = get_session(db, league_id)
    if session.current_player_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player is on the block.")

    player = db.get(Player, session.current_player_id)
    player.status = PlayerStatus.UNSOLD
    player.auction_round = session.current_round

    db.query(Bid).filter(Bid.player_id == player.id, Bid.is_winning.is_(True)).update(
        {"is_winning": False}
    )

    session.current_player_id = None
    session.current_bid = None
    session.current_team_id = None
    session.timer_ends_at = None

    log_action(db, league_id, actor, "player.unsold", player.name)
    db.commit()
    db.refresh(player)
    return player


def retain_from_block(db: Session, league_id: int, team_id: int, actor: str) -> Player:
    """Hand the player on the block to a squad as a retention.

    Same price and same cap as a pre-auction retention — it is the same act,
    recorded during the auction rather than before it. No bid is written,
    because none was made.
    """
    session = get_session(db, league_id)
    cfg = get_settings(db, league_id)

    if session.current_player_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player is on the block.")

    team = db.get(Team, team_id)
    if not team or team.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That team isn't in this league.")

    cap = getattr(cfg, "max_retained", 2)
    kept = (
        db.query(func.count(Player.id))
        .filter(Player.team_id == team.id, Player.status == PlayerStatus.RETAINED)
        .scalar()
        or 0
    )
    if kept >= cap:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{team.name} already has the maximum of {cap} retained players.",
        )
    if squad_size(db, team.id) >= cfg.max_players:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{team.name} already has the maximum of {cfg.max_players} players.",
        )
    if cfg.retain_price > team.remaining_purse:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{team.name} only has ₹{team.remaining_purse:,} left, and a retention costs "
            f"₹{cfg.retain_price:,}.",
        )

    player = db.get(Player, session.current_player_id)
    player.status = PlayerStatus.RETAINED
    player.team_id = team.id
    player.sold_price = cfg.retain_price
    player.sold_at = _now()
    player.auction_round = session.current_round
    team.spent += cfg.retain_price

    # Anything bid before the organiser changed tack is void, not charged.
    db.query(Bid).filter(Bid.player_id == player.id, Bid.is_winning.is_(True)).update(
        {"is_winning": False}
    )

    session.current_player_id = None
    session.current_bid = None
    session.current_team_id = None
    session.timer_ends_at = None

    log_action(db, league_id, actor, "player.retained", f"{player.name} to {team.name}")
    db.commit()
    db.refresh(player)
    return player


def assign_player(
    db: Session, league_id: int, player_id: int, team_id: int, price: int | None, actor: str
) -> Player:
    """Place a player into a squad without calling them to the block.

    For the mopping-up at the end of a night: an unsold player a squad has
    since agreed to take, or someone missed on the way through. Every purse
    and squad rule still applies, and a winning bid is written so the export
    and the archive show how they got there.
    """
    session = get_session(db, league_id)
    cfg = get_settings(db, league_id)

    if session.current_player_id is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A player is on the block. Close them before assigning anyone directly.",
        )

    player = db.get(Player, player_id)
    if not player or player.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player isn't in this league.")
    if player.status in (PlayerStatus.SOLD, PlayerStatus.RETAINED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{player.name} is already with {player.team.name if player.team else 'a squad'}.",
        )

    team = db.get(Team, team_id)
    if not team or team.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That team isn't in this league.")

    amount = price if price is not None else cfg.base_price
    if amount < cfg.base_price:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"The price can't be below the base price of ₹{cfg.base_price:,}.",
        )

    ok, reason = team_can_bid(db, team, cfg, amount)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, reason)

    db.add(
        Bid(
            league_id=league_id,
            player_id=player.id,
            team_id=team.id,
            amount=amount,
            auction_round=session.current_round,
            is_winning=True,
        )
    )

    player.status = PlayerStatus.SOLD
    player.team_id = team.id
    player.sold_price = amount
    player.sold_at = _now()
    player.auction_round = session.current_round
    team.spent += amount

    log_action(
        db, league_id, actor, "player.assigned", f"{player.name} to {team.name} for ₹{amount}"
    )
    db.commit()
    db.refresh(player)
    return player


def mark_not_available(db: Session, league_id: int, actor: str) -> Player:
    """Take the player on the block out of the auction — absent or withdrawn.

    Reversible: `restore_player` puts them back in the pool, because people
    turn up late.
    """
    session = get_session(db, league_id)
    if session.current_player_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No player is on the block.")

    player = db.get(Player, session.current_player_id)
    player.status = PlayerStatus.NOT_AVAILABLE
    player.auction_round = session.current_round

    db.query(Bid).filter(Bid.player_id == player.id, Bid.is_winning.is_(True)).update(
        {"is_winning": False}
    )

    session.current_player_id = None
    session.current_bid = None
    session.current_team_id = None
    session.timer_ends_at = None

    log_action(db, league_id, actor, "player.not_available", player.name)
    db.commit()
    db.refresh(player)
    return player


def reauction_player(db: Session, league_id: int, player_id: int, actor: str) -> Player:
    """Pull a player back out of a squad and into the pool.

    Undo-last-sale only reaches the most recent purchase; this reaches any of
    them, which is what you need when a mistake surfaces three players later.
    The squad is refunded and the player goes to the back of the queue.
    """
    session = get_session(db, league_id)
    if session.current_player_id == player_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That player is on the block. Close them first."
        )

    player = db.get(Player, player_id)
    if not player or player.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player isn't in this league.")
    if player.status not in (PlayerStatus.SOLD, PlayerStatus.RETAINED):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{player.name} isn't in a squad — nothing to undo.",
        )

    team = db.get(Team, player.team_id) if player.team_id else None
    refund = player.sold_price or 0
    if team:
        team.spent = max(0, team.spent - refund)

    db.query(Bid).filter(Bid.player_id == player.id).update({"voided": True, "is_winning": False})

    player.status = PlayerStatus.AVAILABLE
    player.team_id = None
    player.sold_price = None
    player.sold_at = None
    player.auction_round = None
    highest = (
        db.query(func.max(Player.queue_position)).filter(Player.league_id == league_id).scalar() or 0
    )
    player.queue_position = highest + 1

    log_action(
        db,
        league_id,
        actor,
        "player.reauction",
        f"{player.name} taken back from {team.name if team else 'no squad'}, ₹{refund} refunded",
    )
    db.commit()
    db.refresh(player)
    return player


def restore_player(db: Session, league_id: int, player_id: int, actor: str) -> Player:
    """Put a withdrawn or unsold player back into the pool."""
    player = db.get(Player, player_id)
    if not player or player.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player isn't in this league.")
    if player.status not in (PlayerStatus.NOT_AVAILABLE, PlayerStatus.UNSOLD):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{player.name} is {player.status.value.replace('_', ' ').lower()} — "
            "undo the sale or release the retention instead.",
        )

    player.status = PlayerStatus.AVAILABLE
    # Goes to the back of the queue rather than jumping straight back on.
    highest = (
        db.query(func.max(Player.queue_position)).filter(Player.league_id == league_id).scalar() or 0
    )
    player.queue_position = highest + 1

    log_action(db, league_id, actor, "player.restored", player.name)
    db.commit()
    db.refresh(player)
    return player


def undo_last_sale(db: Session, league_id: int, actor: str) -> Player:
    """Reverse the most recent sale: refund the purse, free the player."""
    player = (
        db.query(Player)
        .filter(Player.league_id == league_id, Player.status == PlayerStatus.SOLD)
        .order_by(Player.sold_at.desc().nullslast(), Player.id.desc())
        .first()
    )
    if not player:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No sale has been recorded yet.")

    team = db.get(Team, player.team_id) if player.team_id else None
    price = player.sold_price or 0
    if team:
        team.spent = max(0, team.spent - price)

    db.query(Bid).filter(Bid.player_id == player.id).update({"voided": True, "is_winning": False})

    player.status = PlayerStatus.AVAILABLE
    player.team_id = None
    player.sold_price = None
    player.sold_at = None

    log_action(
        db, league_id, actor, "sale.undo",
        f"{player.name} returned to the pool, ₹{price} refunded to {team.name if team else 'n/a'}",
    )
    db.commit()
    db.refresh(player)
    return player


# --------------------------------------------------------------------------
# retentions
# --------------------------------------------------------------------------
def retain_players(
    db: Session, league_id: int, team_id: int, player_ids: list[int], price: int | None, actor: str
) -> list[Player]:
    session = get_session(db, league_id)
    if session.status in (AuctionStatus.RUNNING, AuctionStatus.PAUSED):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Retentions have to be set before the auction starts.",
        )

    cfg = get_settings(db, league_id)
    team = db.get(Team, team_id)
    if not team or team.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That team isn't in this league.")

    unit = price if price is not None else cfg.retain_price
    players = (
        db.query(Player)
        .filter(Player.id.in_(player_ids), Player.league_id == league_id)
        .all()
    )
    if len(players) != len(set(player_ids)):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "One or more of those players wasn't found.")

    cap = getattr(cfg, "max_retained", 2)
    kept = (
        db.query(func.count(Player.id))
        .filter(Player.team_id == team.id, Player.status == PlayerStatus.RETAINED)
        .scalar()
        or 0
    )
    if kept + len(players) > cap:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"A squad can retain at most {cap} players. {team.name} already has {kept}."
            if kept
            else f"A squad can retain at most {cap} players.",
        )

    already = [p.name for p in players if p.status not in (PlayerStatus.AVAILABLE,)]
    if already:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Already assigned: {', '.join(already)}.",
        )
    if squad_size(db, team.id) + len(players) > cfg.max_players:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"That would put {team.name} over the {cfg.max_players}-player limit.",
        )

    total = unit * len(players)
    if total > team.remaining_purse:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{team.name} only has ₹{team.remaining_purse:,} left — that retention costs ₹{total:,}.",
        )

    for p in players:
        p.status = PlayerStatus.RETAINED
        p.team_id = team.id
        p.sold_price = unit
        p.sold_at = _now()
        p.auction_round = 0
    team.spent += total

    log_action(db, league_id, actor, "players.retained", f"{len(players)} to {team.name} at ₹{unit} each")
    db.commit()
    return players


def release_retention(db: Session, league_id: int, player_id: int, actor: str) -> Player:
    player = db.get(Player, player_id)
    if not player or player.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That player isn't in this league.")
    if player.status != PlayerStatus.RETAINED:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{player.name} isn't a retained player.")

    team = db.get(Team, player.team_id) if player.team_id else None
    if team:
        team.spent = max(0, team.spent - (player.sold_price or 0))
    player.status = PlayerStatus.AVAILABLE
    player.team_id = None
    player.sold_price = None
    player.sold_at = None
    player.auction_round = None

    log_action(db, league_id, actor, "retention.release", player.name)
    db.commit()
    db.refresh(player)
    return player
