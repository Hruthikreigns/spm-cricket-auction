"""Rule coverage for the auction engine.

Runs against SQLite so it needs no database server.
"""

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import AuctionSettings, AuctionStatus, League, Player, PlayerStatus, Team
from app.services import auction as engine

ACTOR = "test@auction.local"


@pytest.fixture
def db():
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(eng)
    session = sessionmaker(bind=eng, expire_on_commit=False)()
    yield session
    session.close()


@pytest.fixture
def league(db):
    league = League(name="Test League")
    db.add(league)
    db.flush()
    db.add(
        AuctionSettings(
            league_id=league.id,
            purse_amount=100_000,
            min_players=15,
            max_players=18,
            retain_price=3_000,
            base_price=1_000,
            bid_increment=500,
            enforce_squad_reserve=False,
        )
    )
    for name in ("SPM Spirits", "Warriors"):
        db.add(Team(league_id=league.id, name=name, purse_amount=100_000))
    for i in range(30):
        db.add(Player(league_id=league.id, name=f"Player {i:02d}", mobile=f"90000000{i:02d}"))
    db.commit()
    return league


def teams(db, league):
    return db.query(Team).filter(Team.league_id == league.id).order_by(Team.name).all()


# --------------------------------------------------------------------------
def test_start_shuffles_and_assigns_every_player_a_slot(db, league):
    engine.start_auction(db, league.id, ACTOR)
    positions = [p.queue_position for p in db.query(Player).all()]
    assert sorted(positions) == list(range(30)), "each player gets exactly one slot"


def test_player_is_never_called_twice_in_a_round(db, league):
    engine.start_auction(db, league.id, ACTOR)
    seen = []
    for _ in range(10):
        player = engine.next_player(db, league.id, ACTOR)
        seen.append(player.id)
        engine.mark_unsold(db, league.id, ACTOR)
    assert len(set(seen)) == 10


def test_cannot_call_next_while_a_player_is_on_the_block(db, league):
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.next_player(db, league.id, ACTOR)
    assert err.value.status_code == 409


def test_bid_increments_and_purse_updates_on_sale(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)

    engine.place_bid(db, league.id, spm.id, 40_000, ACTOR)
    player = engine.mark_sold(db, league.id, ACTOR)

    db.refresh(spm)
    assert player.status == PlayerStatus.SOLD
    assert player.sold_price == 40_000
    assert spm.spent == 40_000
    assert spm.remaining_purse == 60_000
    assert spm.player_count == 1


def test_a_team_cannot_outbid_itself(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.place_bid(db, league.id, spm.id, 5_000, ACTOR)
    with pytest.raises(HTTPException):
        engine.place_bid(db, league.id, spm.id, 6_000, ACTOR)


def test_bid_below_the_next_increment_is_rejected(db, league):
    spm, warriors = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.place_bid(db, league.id, spm.id, 5_000, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.place_bid(db, league.id, warriors.id, 5_200, ACTOR)
    assert "at least" in err.value.detail


def test_bid_beyond_the_purse_is_refused(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.place_bid(db, league.id, spm.id, 150_000, ACTOR)
    assert "can bid at most" in err.value.detail


def test_squad_reserve_holds_money_back_for_unfilled_slots(db, league):
    cfg = engine.get_settings(db, league.id)
    cfg.enforce_squad_reserve = True
    cfg.min_players = 15
    db.commit()

    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)

    # 14 slots left after this buy x ₹1,000 base = ₹14,000 held back.
    assert engine.max_bid_for(db, spm, cfg) == 86_000
    with pytest.raises(HTTPException):
        engine.place_bid(db, league.id, spm.id, 90_000, ACTOR)
    engine.place_bid(db, league.id, spm.id, 86_000, ACTOR)


def test_max_squad_size_blocks_further_bids(db, league):
    cfg = engine.get_settings(db, league.id)
    cfg.max_players = 2
    db.commit()

    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    for _ in range(2):
        engine.next_player(db, league.id, ACTOR)
        engine.place_bid(db, league.id, spm.id, 1_000, ACTOR)
        engine.mark_sold(db, league.id, ACTOR)

    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.place_bid(db, league.id, spm.id, 1_000, ACTOR)
    assert "maximum" in err.value.detail


def test_sold_needs_a_bid(db, league):
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.mark_sold(db, league.id, ACTOR)
    assert "unsold" in err.value.detail


def test_undo_bid_falls_back_to_the_previous_team(db, league):
    spm, warriors = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.place_bid(db, league.id, spm.id, 5_000, ACTOR)
    engine.place_bid(db, league.id, warriors.id, 6_000, ACTOR)

    session = engine.undo_last_bid(db, league.id, ACTOR)
    assert session.current_bid == 5_000
    assert session.current_team_id == spm.id

    session = engine.undo_last_bid(db, league.id, ACTOR)
    assert session.current_bid is None
    assert session.current_team_id is None


def test_undo_sale_refunds_the_purse_and_frees_the_player(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.place_bid(db, league.id, spm.id, 20_000, ACTOR)
    engine.mark_sold(db, league.id, ACTOR)

    player = engine.undo_last_sale(db, league.id, ACTOR)
    db.refresh(spm)
    assert player.status == PlayerStatus.AVAILABLE
    assert player.team_id is None
    assert spm.spent == 0
    assert spm.remaining_purse == 100_000


def test_retention_deducts_the_retain_price(db, league):
    spm, _ = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(2).all()]
    engine.retain_players(db, league.id, spm.id, ids, None, ACTOR)

    db.refresh(spm)
    assert spm.spent == 6_000
    assert spm.remaining_purse == 94_000
    assert spm.retained_count == 2
    assert all(db.get(Player, i).status == PlayerStatus.RETAINED for i in ids)


def test_retained_players_are_kept_out_of_the_pool(db, league):
    spm, _ = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(2).all()]
    engine.retain_players(db, league.id, spm.id, ids, None, ACTOR)
    engine.start_auction(db, league.id, ACTOR)

    called = []
    for _ in range(28):
        called.append(engine.next_player(db, league.id, ACTOR).id)
        engine.mark_unsold(db, league.id, ACTOR)
    assert not set(ids) & set(called)
    with pytest.raises(HTTPException):
        engine.next_player(db, league.id, ACTOR)


def test_retention_after_the_auction_starts_is_refused(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    ids = [p.id for p in db.query(Player).limit(1).all()]
    with pytest.raises(HTTPException):
        engine.retain_players(db, league.id, spm.id, ids, None, ACTOR)


def test_release_returns_the_money(db, league):
    spm, _ = teams(db, league)
    player_id = db.query(Player).first().id
    engine.retain_players(db, league.id, spm.id, [player_id], None, ACTOR)
    engine.release_retention(db, league.id, player_id, ACTOR)

    db.refresh(spm)
    assert spm.spent == 0
    assert db.get(Player, player_id).status == PlayerStatus.AVAILABLE


def test_next_round_brings_unsold_players_back(db, league):
    engine.start_auction(db, league.id, ACTOR)
    for _ in range(30):
        engine.next_player(db, league.id, ACTOR)
        engine.mark_unsold(db, league.id, ACTOR)

    session = engine.start_next_round(db, league.id, ACTOR)
    assert session.current_round == 2
    assert engine.pool_remaining(db, league.id) == 30


def test_paused_auction_refuses_bids_and_calls(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.set_paused(db, league.id, True, ACTOR)

    with pytest.raises(HTTPException):
        engine.place_bid(db, league.id, spm.id, 1_000, ACTOR)

    engine.set_paused(db, league.id, False, ACTOR)
    assert engine.get_session(db, league.id).status == AuctionStatus.RUNNING


# --------------------------------------------------------------------------
# Direct sale: pick a team, name a price, done.
# --------------------------------------------------------------------------
def test_direct_sale_records_price_and_purse(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)

    player = engine.sell_directly(db, league.id, spm.id, 30_000, ACTOR)

    db.refresh(spm)
    assert player.status == PlayerStatus.SOLD
    assert player.sold_price == 30_000
    assert player.team_id == spm.id
    assert spm.spent == 30_000
    assert spm.remaining_purse == 70_000
    # The block is clear, ready for the next call.
    assert engine.get_session(db, league.id).current_player_id is None


def test_direct_sale_still_writes_the_ledger(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, spm.id, 30_000, ACTOR)

    from app.models import Bid

    bids = db.query(Bid).filter(Bid.player_id == player.id).all()
    assert len(bids) == 1
    assert bids[0].amount == 30_000 and bids[0].is_winning


def test_direct_sale_supersedes_bids_already_placed(db, league):
    spm, warriors = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.place_bid(db, league.id, warriors.id, 5_000, ACTOR)

    engine.sell_directly(db, league.id, spm.id, 30_000, ACTOR)

    from app.models import Bid

    winning = db.query(Bid).filter(Bid.player_id == player.id, Bid.is_winning.is_(True)).all()
    assert len(winning) == 1
    assert winning[0].team_id == spm.id
    db.refresh(warriors)
    assert warriors.spent == 0, "the losing team is never charged"


def test_direct_sale_respects_the_purse(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.sell_directly(db, league.id, spm.id, 200_000, ACTOR)
    assert "can bid at most" in err.value.detail


def test_direct_sale_respects_the_squad_cap(db, league):
    cfg = engine.get_settings(db, league.id)
    cfg.max_players = 1
    db.commit()

    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, spm.id, 1_000, ACTOR)

    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.sell_directly(db, league.id, spm.id, 1_000, ACTOR)
    assert "maximum" in err.value.detail


def test_direct_sale_below_base_price_is_refused(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.sell_directly(db, league.id, spm.id, 500, ACTOR)
    assert "base price" in err.value.detail


def test_direct_sale_needs_a_player_on_the_block(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.sell_directly(db, league.id, spm.id, 10_000, ACTOR)
    assert "on the block" in err.value.detail


def test_direct_sale_can_be_undone(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, spm.id, 30_000, ACTOR)

    player = engine.undo_last_sale(db, league.id, ACTOR)
    db.refresh(spm)
    assert player.status == PlayerStatus.AVAILABLE
    assert spm.spent == 0


# --------------------------------------------------------------------------
# Retention cap
# --------------------------------------------------------------------------
def test_a_squad_may_retain_at_most_two_players(db, league):
    spm, _ = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(3).all()]

    with pytest.raises(HTTPException) as err:
        engine.retain_players(db, league.id, spm.id, ids, None, ACTOR)
    assert "at most 2" in err.value.detail

    db.refresh(spm)
    assert spm.spent == 0, "a refused retention charges nothing"
    assert all(db.get(Player, i).status == PlayerStatus.AVAILABLE for i in ids)


def test_the_cap_counts_players_already_retained(db, league):
    spm, _ = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(3).all()]

    engine.retain_players(db, league.id, spm.id, ids[:2], None, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.retain_players(db, league.id, spm.id, [ids[2]], None, ACTOR)
    assert "already has 2" in err.value.detail


def test_releasing_frees_a_retention_slot(db, league):
    spm, _ = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(3).all()]

    engine.retain_players(db, league.id, spm.id, ids[:2], None, ACTOR)
    engine.release_retention(db, league.id, ids[0], ACTOR)
    engine.retain_players(db, league.id, spm.id, [ids[2]], None, ACTOR)

    db.refresh(spm)
    assert spm.retained_count == 2


def test_the_cap_is_per_squad_not_per_league(db, league):
    spm, warriors = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(4).all()]

    engine.retain_players(db, league.id, spm.id, ids[:2], None, ACTOR)
    engine.retain_players(db, league.id, warriors.id, ids[2:], None, ACTOR)

    db.refresh(spm)
    db.refresh(warriors)
    assert spm.retained_count == 2 and warriors.retained_count == 2


def test_the_cap_is_configurable(db, league):
    cfg = engine.get_settings(db, league.id)
    cfg.max_retained = 3
    db.commit()

    spm, _ = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(3).all()]
    engine.retain_players(db, league.id, spm.id, ids, None, ACTOR)

    db.refresh(spm)
    assert spm.retained_count == 3


# --------------------------------------------------------------------------
# The four outcomes on the block
# --------------------------------------------------------------------------
def test_retaining_from_the_block_charges_the_retention_price(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)

    player = engine.retain_from_block(db, league.id, spm.id, ACTOR)

    db.refresh(spm)
    assert player.status == PlayerStatus.RETAINED
    assert player.sold_price == 3_000
    assert player.team_id == spm.id
    assert spm.spent == 3_000
    assert engine.get_session(db, league.id).current_player_id is None


def test_retaining_from_the_block_obeys_the_cap(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    for _ in range(2):
        engine.next_player(db, league.id, ACTOR)
        engine.retain_from_block(db, league.id, spm.id, ACTOR)

    engine.next_player(db, league.id, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.retain_from_block(db, league.id, spm.id, ACTOR)
    assert "maximum of 2 retained" in err.value.detail


def test_retaining_voids_any_bid_already_made(db, league):
    spm, warriors = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.place_bid(db, league.id, warriors.id, 5_000, ACTOR)

    engine.retain_from_block(db, league.id, spm.id, ACTOR)

    db.refresh(warriors)
    assert warriors.spent == 0, "the bidding squad is not charged"
    assert player.sold_price == 3_000


def test_a_player_can_be_marked_not_available(db, league):
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)

    marked = engine.mark_not_available(db, league.id, ACTOR)
    assert marked.status == PlayerStatus.NOT_AVAILABLE
    assert marked.team_id is None
    assert engine.get_session(db, league.id).current_player_id is None

    # And they're out of the pool.
    called = []
    for _ in range(5):
        called.append(engine.next_player(db, league.id, ACTOR).id)
        engine.mark_unsold(db, league.id, ACTOR)
    assert player.id not in called


def test_someone_who_turns_up_late_can_be_restored(db, league):
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.mark_not_available(db, league.id, ACTOR)

    before = engine.pool_remaining(db, league.id)
    restored = engine.restore_player(db, league.id, player.id, ACTOR)
    assert restored.status == PlayerStatus.AVAILABLE
    assert engine.pool_remaining(db, league.id) == before + 1


def test_a_restored_player_goes_to_the_back_of_the_queue(db, league):
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.mark_not_available(db, league.id, ACTOR)
    engine.restore_player(db, league.id, player.id, ACTOR)

    nxt = engine.next_player(db, league.id, ACTOR)
    assert nxt.id != player.id, "they shouldn't jump straight back onto the block"


def test_an_unsold_player_can_be_restored_too(db, league):
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.mark_unsold(db, league.id, ACTOR)

    restored = engine.restore_player(db, league.id, player.id, ACTOR)
    assert restored.status == PlayerStatus.AVAILABLE


def test_a_sold_player_cannot_be_restored_that_way(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, spm.id, 10_000, ACTOR)

    with pytest.raises(HTTPException) as err:
        engine.restore_player(db, league.id, player.id, ACTOR)
    assert "undo the sale" in err.value.detail


def test_each_outcome_needs_a_player_on_the_block(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    for call in (
        lambda: engine.retain_from_block(db, league.id, spm.id, ACTOR),
        lambda: engine.mark_not_available(db, league.id, ACTOR),
    ):
        with pytest.raises(HTTPException) as err:
            call()
        assert "on the block" in err.value.detail


# --------------------------------------------------------------------------
# Mopping up at the end: assigning a player straight into a squad
# --------------------------------------------------------------------------
def _run_through(db, league):
    """Call every player and leave them all unsold."""
    engine.start_auction(db, league.id, ACTOR)
    while engine.pool_remaining(db, league.id):
        engine.next_player(db, league.id, ACTOR)
        engine.mark_unsold(db, league.id, ACTOR)


def test_an_unsold_player_can_be_assigned_afterwards(db, league):
    spm, _ = teams(db, league)
    _run_through(db, league)

    player = db.query(Player).filter(Player.status == PlayerStatus.UNSOLD).first()
    assigned = engine.assign_player(db, league.id, player.id, spm.id, 15_000, ACTOR)

    db.refresh(spm)
    assert assigned.status == PlayerStatus.SOLD
    assert assigned.sold_price == 15_000
    assert assigned.team_id == spm.id
    assert spm.spent == 15_000


def test_assigning_writes_the_ledger_so_the_export_shows_it(db, league):
    from app.models import Bid

    spm, _ = teams(db, league)
    _run_through(db, league)
    player = db.query(Player).filter(Player.status == PlayerStatus.UNSOLD).first()
    engine.assign_player(db, league.id, player.id, spm.id, 15_000, ACTOR)

    bids = db.query(Bid).filter(Bid.player_id == player.id, Bid.is_winning.is_(True)).all()
    assert len(bids) == 1 and bids[0].amount == 15_000


def test_assigning_defaults_to_the_base_price(db, league):
    spm, _ = teams(db, league)
    _run_through(db, league)
    player = db.query(Player).filter(Player.status == PlayerStatus.UNSOLD).first()

    assigned = engine.assign_player(db, league.id, player.id, spm.id, None, ACTOR)
    assert assigned.sold_price == 1_000


def test_assigning_still_respects_the_purse(db, league):
    spm, _ = teams(db, league)
    _run_through(db, league)
    player = db.query(Player).filter(Player.status == PlayerStatus.UNSOLD).first()

    with pytest.raises(HTTPException) as err:
        engine.assign_player(db, league.id, player.id, spm.id, 500_000, ACTOR)
    assert "can bid at most" in err.value.detail


def test_assigning_still_respects_the_squad_cap(db, league):
    cfg = engine.get_settings(db, league.id)
    cfg.max_players = 1
    db.commit()

    spm, _ = teams(db, league)
    _run_through(db, league)
    unsold = db.query(Player).filter(Player.status == PlayerStatus.UNSOLD).limit(2).all()

    engine.assign_player(db, league.id, unsold[0].id, spm.id, 1_000, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.assign_player(db, league.id, unsold[1].id, spm.id, 1_000, ACTOR)
    assert "maximum" in err.value.detail


def test_a_player_already_in_a_squad_cannot_be_assigned_again(db, league):
    spm, warriors = teams(db, league)
    _run_through(db, league)
    player = db.query(Player).filter(Player.status == PlayerStatus.UNSOLD).first()

    engine.assign_player(db, league.id, player.id, spm.id, 5_000, ACTOR)
    with pytest.raises(HTTPException) as err:
        engine.assign_player(db, league.id, player.id, warriors.id, 5_000, ACTOR)
    assert "already with" in err.value.detail


def test_a_withdrawn_player_can_still_be_assigned(db, league):
    """Someone marked absent who turns up and agrees a price."""
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.mark_not_available(db, league.id, ACTOR)

    assigned = engine.assign_player(db, league.id, player.id, spm.id, 4_000, ACTOR)
    assert assigned.status == PlayerStatus.SOLD


def test_assigning_is_refused_while_someone_is_on_the_block(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    on_block = engine.next_player(db, league.id, ACTOR)
    other = (
        db.query(Player)
        .filter(Player.league_id == league.id, Player.id != on_block.id)
        .first()
    )

    with pytest.raises(HTTPException) as err:
        engine.assign_player(db, league.id, other.id, spm.id, 5_000, ACTOR)
    assert err.value.status_code == 409


def test_an_assignment_can_be_undone(db, league):
    spm, _ = teams(db, league)
    _run_through(db, league)
    player = db.query(Player).filter(Player.status == PlayerStatus.UNSOLD).first()
    engine.assign_player(db, league.id, player.id, spm.id, 15_000, ACTOR)

    engine.undo_last_sale(db, league.id, ACTOR)
    db.refresh(spm)
    assert spm.spent == 0


# --------------------------------------------------------------------------
# Putting a player back up
# --------------------------------------------------------------------------
def test_any_sold_player_can_be_re_auctioned(db, league):
    """Not just the most recent — undo-last-sale only reaches that one."""
    spm, warriors = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)

    first = engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, spm.id, 20_000, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, warriors.id, 8_000, ACTOR)

    back = engine.reauction_player(db, league.id, first.id, ACTOR)

    db.refresh(spm)
    db.refresh(warriors)
    assert back.status == PlayerStatus.AVAILABLE
    assert back.team_id is None and back.sold_price is None
    assert spm.spent == 0, "the squad is refunded"
    assert warriors.spent == 8_000, "the later sale is untouched"


def test_a_re_auctioned_player_comes_up_again(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, spm.id, 5_000, ACTOR)

    before = engine.pool_remaining(db, league.id)
    engine.reauction_player(db, league.id, player.id, ACTOR)
    assert engine.pool_remaining(db, league.id) == before + 1

    # Back of the queue, not straight onto the block.
    assert engine.next_player(db, league.id, ACTOR).id != player.id


def test_a_retained_player_can_be_re_auctioned(db, league):
    spm, _ = teams(db, league)
    ids = [p.id for p in db.query(Player).limit(1).all()]
    engine.retain_players(db, league.id, spm.id, ids, None, ACTOR)

    back = engine.reauction_player(db, league.id, ids[0], ACTOR)
    db.refresh(spm)
    assert back.status == PlayerStatus.AVAILABLE
    assert spm.spent == 0


def test_re_auctioning_someone_not_in_a_squad_is_refused(db, league):
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.mark_unsold(db, league.id, ACTOR)

    with pytest.raises(HTTPException) as err:
        engine.reauction_player(db, league.id, player.id, ACTOR)
    assert "nothing to undo" in err.value.detail


def test_the_player_on_the_block_cannot_be_re_auctioned(db, league):
    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    engine.next_player(db, league.id, ACTOR)
    engine.sell_directly(db, league.id, spm.id, 5_000, ACTOR)
    on_block = engine.next_player(db, league.id, ACTOR)

    with pytest.raises(HTTPException) as err:
        engine.reauction_player(db, league.id, on_block.id, ACTOR)
    assert err.value.status_code == 409


def test_re_auctioning_voids_the_old_bids(db, league):
    from app.models import Bid

    spm, _ = teams(db, league)
    engine.start_auction(db, league.id, ACTOR)
    player = engine.next_player(db, league.id, ACTOR)
    engine.place_bid(db, league.id, spm.id, 5_000, ACTOR)
    engine.mark_sold(db, league.id, ACTOR)

    engine.reauction_player(db, league.id, player.id, ACTOR)
    bids = db.query(Bid).filter(Bid.player_id == player.id).all()
    assert all(b.voided for b in bids), "the old price shouldn't count towards anything"
