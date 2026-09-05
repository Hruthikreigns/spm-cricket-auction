import asyncio
import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from ..config import settings
from ..database import SessionLocal, get_db
from ..models import Bid, User
from ..schemas import (
    AssignIn,
    AuctionStateOut,
    BidIn,
    BidOut,
    DirectSaleIn,
    PlayerOut,
    RetainCurrentIn,
    TeamOut,
)
from ..security import require_admin, require_viewer, user_from_token
from ..services import auction as engine
from ..services.state import build_state, contact_visible, public_player, team_board
from ..websocket import manager

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/leagues/{league_id}/auction", tags=["auction"])


async def _publish(db: Session, league_id: int, event: str, extra: dict | None = None) -> None:
    """Push the authoritative state to every connected screen."""
    payload = {
        # Fans out to every viewer, so it uses the league's public setting
        # rather than the organiser's own view.
        "state": build_state(
            db, league_id, include_contact=contact_visible(db, league_id, False)
        ).model_dump(mode="json"),
        "teams": [t.model_dump(mode="json") for t in team_board(db, league_id)],
    }
    if extra:
        payload.update(extra)
    await manager.broadcast(league_id, event, payload)


# --------------------------------------------------------------------------
# Read
# --------------------------------------------------------------------------
@router.get("/state", response_model=AuctionStateOut)
def read_state(
    league_id: int,
    db: Session = Depends(get_db),
    viewer: User = Depends(require_viewer),
):
    """The live room, for organisers and squad owners.

    Behind a login: bidding in progress is for the people in the auction. The
    finished result stays public — see /results.
    """
    return build_state(
        db, league_id, include_contact=contact_visible(db, league_id, viewer.role == "admin")
    )


@router.get("/board", response_model=list[TeamOut])
def read_board(
    league_id: int, db: Session = Depends(get_db), _: User = Depends(require_viewer)
):
    return team_board(db, league_id)


@router.get("/history", response_model=list[BidOut])
def read_history(
    league_id: int,
    limit: int = 100,
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer),
):
    return (
        db.query(Bid)
        .filter(Bid.league_id == league_id)
        .order_by(Bid.id.desc())
        .limit(min(limit, 500))
        .all()
    )


# --------------------------------------------------------------------------
# Lifecycle (admin)
# --------------------------------------------------------------------------
@router.post("/start", response_model=AuctionStateOut)
async def start(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    engine.start_auction(db, league_id, admin.email)
    await _publish(db, league_id, "auction_started")
    return build_state(db, league_id)


@router.post("/pause", response_model=AuctionStateOut)
async def pause(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    engine.set_paused(db, league_id, True, admin.email)
    await _publish(db, league_id, "auction_paused")
    return build_state(db, league_id)


@router.post("/resume", response_model=AuctionStateOut)
async def resume(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    engine.set_paused(db, league_id, False, admin.email)
    await _publish(db, league_id, "auction_resumed")
    return build_state(db, league_id)


@router.post("/complete", response_model=AuctionStateOut)
async def complete(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    engine.complete_auction(db, league_id, admin.email)
    await _publish(db, league_id, "auction_completed")
    return build_state(db, league_id)


@router.post("/next-round", response_model=AuctionStateOut)
async def next_round(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    engine.start_next_round(db, league_id, admin.email)
    await _publish(db, league_id, "round_started")
    return build_state(db, league_id)


# --------------------------------------------------------------------------
# The block (admin)
# --------------------------------------------------------------------------
@router.post("/next-player", response_model=PlayerOut)
async def next_player(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    player = engine.next_player(db, league_id, admin.email)
    await _publish(db, league_id, "player_called")
    return player


@router.post("/bid", response_model=AuctionStateOut)
async def bid(
    league_id: int, payload: BidIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    engine.place_bid(db, league_id, payload.team_id, payload.amount, admin.email)
    await _publish(db, league_id, "bid_placed")
    return build_state(db, league_id)


@router.post("/undo-bid", response_model=AuctionStateOut)
async def undo_bid(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    engine.undo_last_bid(db, league_id, admin.email)
    await _publish(db, league_id, "bid_undone")
    return build_state(db, league_id)


@router.post("/sold", response_model=PlayerOut)
async def sold(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    player = engine.mark_sold(db, league_id, admin.email)
    await _publish(
        db,
        league_id,
        "player_sold",
        {"sold": public_player(player, contact_visible(db, league_id, False)).model_dump(mode="json")},
    )
    return player


@router.post("/sell", response_model=PlayerOut)
async def sell_direct(
    league_id: int,
    payload: DirectSaleIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Sell the player on the block to a team at a stated price, in one step."""
    player = engine.sell_directly(db, league_id, payload.team_id, payload.amount, admin.email)
    await _publish(
        db,
        league_id,
        "player_sold",
        {"sold": public_player(player, contact_visible(db, league_id, False)).model_dump(mode="json")},
    )
    return player


@router.post("/unsold", response_model=PlayerOut)
async def unsold(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    player = engine.mark_unsold(db, league_id, admin.email)
    await _publish(
        db,
        league_id,
        "player_unsold",
        {"unsold": public_player(player, contact_visible(db, league_id, False)).model_dump(mode="json")},
    )
    return player


@router.post("/retain-current", response_model=PlayerOut)
async def retain_current(
    league_id: int,
    payload: RetainCurrentIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Give the player on the block to a squad as a retention, at the set price."""
    player = engine.retain_from_block(db, league_id, payload.team_id, admin.email)
    await _publish(
        db,
        league_id,
        "player_retained",
        {"retained": public_player(player, False).model_dump(mode="json")},
    )
    return player


@router.post("/assign", response_model=PlayerOut)
async def assign(
    league_id: int,
    payload: AssignIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Place a specific player into a squad without calling them to the block."""
    player = engine.assign_player(
        db, league_id, payload.player_id, payload.team_id, payload.amount, admin.email
    )
    await _publish(
        db,
        league_id,
        "player_sold",
        {"sold": public_player(player, contact_visible(db, league_id, False)).model_dump(mode="json")},
    )
    return player


@router.post("/not-available", response_model=PlayerOut)
async def not_available(
    league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    """Player is absent or withdrawn — take them out of the auction."""
    player = engine.mark_not_available(db, league_id, admin.email)
    await _publish(db, league_id, "player_withdrawn")
    return player


@router.post("/reauction/{player_id}", response_model=PlayerOut)
async def reauction(
    league_id: int, player_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    """Take a player back off a squad and return them to the pool."""
    player = engine.reauction_player(db, league_id, player_id, admin.email)
    await _publish(db, league_id, "player_reauctioned")
    return player


@router.post("/restore/{player_id}", response_model=PlayerOut)
async def restore(
    league_id: int, player_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    """Put a withdrawn or unsold player back in the pool."""
    player = engine.restore_player(db, league_id, player_id, admin.email)
    await _publish(db, league_id, "player_restored")
    return player


@router.post("/undo-sale", response_model=PlayerOut)
async def undo_sale(league_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    player = engine.undo_last_sale(db, league_id, admin.email)
    await _publish(db, league_id, "sale_undone")
    return player


# --------------------------------------------------------------------------
# Live feed
# --------------------------------------------------------------------------
@router.websocket("/ws")
async def auction_socket(websocket: WebSocket, league_id: int, token: str | None = None):
    """Read-only feed for signed-in watchers.

    A browser can't set headers on a WebSocket, so the same JWT arrives as a
    query parameter. An unauthenticated client is closed at the handshake
    rather than left holding a connection that never sends anything.
    """
    db = SessionLocal()
    viewer = user_from_token(token, db)
    if viewer is None:
        db.close()
        # 1008 = policy violation; the client shows a sign-in prompt.
        await websocket.close(code=1008, reason="Sign in to watch the auction")
        return

    # Room capacity. The organiser always gets in; watchers queue behind the
    # limit, which is clearer than letting a room fill until it degrades.
    if viewer.role != "admin" and manager.is_full(league_id, settings.max_live_viewers):
        db.close()
        # 1013 = try again later.
        await websocket.close(code=1013, reason="The auction room is full")
        return

    await manager.connect(league_id, websocket)
    try:
        await websocket.send_json(
            {
                "event": "snapshot",
                "payload": {
                    # Same public rules as a broadcast — the snapshot is the
                    # first thing a viewer receives, so it must not be looser.
                    "state": build_state(
                        db, league_id, include_contact=contact_visible(db, league_id, False)
                    ).model_dump(mode="json"),
                    "teams": [t.model_dump(mode="json") for t in team_board(db, league_id)],
                },
            }
        )
        while True:
            # Client pings keep the socket warm through proxies.
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await websocket.send_json({"event": "ping", "payload": {}})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001
        log.warning("socket dropped league=%s: %s", league_id, exc)
    finally:
        db.close()
        await manager.disconnect(league_id, websocket)
