import io
from datetime import datetime

import pandas as pd
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Player, PlayerRole, PlayerStatus, Team
from ..schemas import AnalyticsOut, PlayerOut, RoleBreakdown, TeamSpend

router = APIRouter(prefix="/api/leagues/{league_id}", tags=["analytics"])

SQUAD_STATUSES = (PlayerStatus.SOLD, PlayerStatus.RETAINED)


@router.get("/analytics", response_model=AnalyticsOut)
def analytics(league_id: int, db: Session = Depends(get_db)):
    players = db.query(Player).options(joinedload(Player.team)).filter(Player.league_id == league_id).all()
    teams = db.query(Team).filter(Team.league_id == league_id).all()

    sold = [p for p in players if p.status == PlayerStatus.SOLD]
    retained = [p for p in players if p.status == PlayerStatus.RETAINED]
    unsold = [p for p in players if p.status == PlayerStatus.UNSOLD]
    available = [p for p in players if p.status in (PlayerStatus.AVAILABLE, PlayerStatus.ON_BLOCK)]

    prices = [p.sold_price for p in sold if p.sold_price]
    total_purse = sum(t.purse_amount for t in teams)
    total_spent = sum(t.spent for t in teams)

    role_rows = []
    for role in PlayerRole:
        of_role = [p for p in players if p.role == role]
        role_rows.append(
            RoleBreakdown(
                role=role.value,
                total=len(of_role),
                sold=len([p for p in of_role if p.status in SQUAD_STATUSES]),
            )
        )

    top = max(sold, key=lambda p: p.sold_price or 0) if sold else None

    return AnalyticsOut(
        total_players=len(players),
        sold_players=len(sold),
        unsold_players=len(unsold),
        retained_players=len(retained),
        available_players=len(available),
        total_teams=len(teams),
        total_purse=total_purse,
        purse_remaining=total_purse - total_spent,
        total_spent=total_spent,
        highest_bid=max(prices) if prices else None,
        lowest_bid=min(prices) if prices else None,
        average_price=round(sum(prices) / len(prices)) if prices else None,
        most_expensive_player=PlayerOut.model_validate(top) if top else None,
        team_spending=[
            TeamSpend(
                team_id=t.id,
                team_name=t.name,
                spent=t.spent,
                remaining=t.remaining_purse,
                players=t.player_count,
            )
            for t in sorted(teams, key=lambda t: t.spent, reverse=True)
        ],
        role_breakdown=role_rows,
    )


@router.get("/export/results.xlsx")
def export_results(league_id: int, db: Session = Depends(get_db)):
    """Download the full auction result as a workbook."""
    players = (
        db.query(Player)
        .options(joinedload(Player.team))
        .filter(Player.league_id == league_id)
        .order_by(Player.status, Player.name)
        .all()
    )
    teams = db.query(Team).filter(Team.league_id == league_id).order_by(Team.name).all()

    results = pd.DataFrame(
        [
            {
                "Player": p.name,
                "Role": p.role.value.replace("_", " ").title(),
                "Place": p.place,
                "Jersey": p.jersey_number,
                "Age": p.age,
                "Batting": p.batting_style,
                "Bowling": p.bowling_style,
                "Status": p.status.value.title(),
                "Team": p.team.name if p.team else "",
                "Price": p.sold_price,
                "Round": p.auction_round,
                "Sold at": p.sold_at.strftime("%Y-%m-%d %H:%M") if p.sold_at else "",
            }
            for p in players
        ]
    )
    squads = pd.DataFrame(
        [
            {
                "Team": t.name,
                "Owner": t.owner_name,
                "Captain": t.captain_name,
                "Players": t.player_count,
                "Retained": t.retained_count,
                "Purse": t.purse_amount,
                "Spent": t.spent,
                "Remaining": t.remaining_purse,
            }
            for t in teams
        ]
    )

    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        results.to_excel(writer, sheet_name="Auction results", index=False)
        squads.to_excel(writer, sheet_name="Squads", index=False)
    buffer.seek(0)

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="auction-results-{stamp}.xlsx"'},
    )
