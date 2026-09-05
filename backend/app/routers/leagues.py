from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AuctionSettings, League, Team, User
from ..schemas import (
    AuctionSettingsIn,
    AuctionSettingsOut,
    LeagueIn,
    LeagueOut,
    LeagueUpdate,
    TeamIn,
    TeamOut,
    TeamUpdate,
)
from ..security import require_admin
from ..services import auction as engine
from ..config import settings as app_settings

router = APIRouter(prefix="/api/leagues", tags=["leagues"])


def _get_league(db: Session, league_id: int) -> League:
    league = db.get(League, league_id)
    if not league:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That league doesn't exist.")
    return league


# --------------------------------------------------------------------------
# Leagues
# --------------------------------------------------------------------------
@router.get("", response_model=list[LeagueOut])
def list_leagues(db: Session = Depends(get_db)):
    return db.query(League).order_by(League.auction_date.desc().nullslast(), League.id.desc()).all()


@router.get("/{league_id}", response_model=LeagueOut)
def get_league(league_id: int, db: Session = Depends(get_db)):
    return _get_league(db, league_id)


@router.post("", response_model=LeagueOut, status_code=201)
def create_league(payload: LeagueIn, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    league = League(**payload.model_dump())
    db.add(league)
    db.flush()
    db.add(
        AuctionSettings(
            league_id=league.id,
            purse_amount=app_settings.default_purse,
            min_players=app_settings.default_min_players,
            max_players=app_settings.default_max_players,
            retain_price=app_settings.default_retain_price,
            base_price=app_settings.default_base_price,
            bid_increment=app_settings.default_bid_increment,
            timer_seconds=app_settings.default_timer_seconds,
        )
    )
    db.commit()
    db.refresh(league)
    return league


@router.patch("/{league_id}", response_model=LeagueOut)
def update_league(
    league_id: int, payload: LeagueUpdate, db: Session = Depends(get_db), _: User = Depends(require_admin)
):
    league = _get_league(db, league_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(league, field, value)
    db.commit()
    db.refresh(league)
    return league


@router.delete("/{league_id}", status_code=204)
def delete_league(league_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    db.delete(_get_league(db, league_id))
    db.commit()


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------
@router.get("/{league_id}/settings", response_model=AuctionSettingsOut)
def get_settings(league_id: int, db: Session = Depends(get_db)):
    return engine.get_settings(db, league_id)


@router.patch("/{league_id}/settings", response_model=AuctionSettingsOut)
def update_settings(
    league_id: int,
    payload: AuctionSettingsIn,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    cfg = engine.get_settings(db, league_id)
    data = payload.model_dump(exclude_unset=True)

    min_players = data.get("min_players", cfg.min_players)
    max_players = data.get("max_players", cfg.max_players)
    if min_players > max_players:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "The minimum squad size can't be larger than the maximum.",
        )

    for field, value in data.items():
        setattr(cfg, field, value)

    # Keep team purses in step when the league purse changes.
    if "purse_amount" in data:
        for team in db.query(Team).filter(Team.league_id == league_id).all():
            team.purse_amount = data["purse_amount"]

    engine.log_action(db, league_id, admin.email, "settings.update", str(data))
    db.commit()
    db.refresh(cfg)
    return cfg


# --------------------------------------------------------------------------
# Teams
# --------------------------------------------------------------------------
@router.get("/{league_id}/teams", response_model=list[TeamOut])
def list_teams(league_id: int, db: Session = Depends(get_db)):
    return db.query(Team).filter(Team.league_id == league_id).order_by(Team.name).all()


@router.post("/{league_id}/teams", response_model=TeamOut, status_code=201)
def create_team(
    league_id: int, payload: TeamIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    _get_league(db, league_id)
    cfg = engine.get_settings(db, league_id)
    exists = db.query(Team).filter(Team.league_id == league_id, Team.name == payload.name).first()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A team called {payload.name} already exists.")

    data = payload.model_dump()
    data["purse_amount"] = data.get("purse_amount") or cfg.purse_amount
    team = Team(league_id=league_id, **data)
    db.add(team)
    engine.log_action(db, league_id, admin.email, "team.create", payload.name)
    db.commit()
    db.refresh(team)
    return team


@router.patch("/{league_id}/teams/{team_id}", response_model=TeamOut)
def update_team(
    league_id: int,
    team_id: int,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    team = db.get(Team, team_id)
    if not team or team.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That team isn't in this league.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(team, field, value)
    db.commit()
    db.refresh(team)
    return team


@router.delete("/{league_id}/teams/{team_id}", status_code=204)
def delete_team(league_id: int, team_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    team = db.get(Team, team_id)
    if not team or team.league_id != league_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That team isn't in this league.")
    if team.player_count:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{team.name} still holds {team.player_count} players. Release them first.",
        )
    db.delete(team)
    db.commit()
