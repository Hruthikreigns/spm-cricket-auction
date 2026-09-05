"""The migration has to be safe on a database that already holds an auction."""

from pathlib import Path

import sqlalchemy as sa

from app.migrations import ADDITIONS, ensure_columns


def old_schema(engine):
    """A leagues table as it looked before the branding fields existed."""
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                CREATE TABLE leagues (
                    id INTEGER PRIMARY KEY,
                    name VARCHAR(160) NOT NULL,
                    season VARCHAR(60),
                    logo_url VARCHAR(400),
                    banner_url VARCHAR(400),
                    status VARCHAR(20)
                )
                """
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO leagues (id, name, season, status) VALUES (1, 'SPR Premier League', '2026', 'UPCOMING')"
            )
        )


def test_missing_columns_are_added(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path/'old.db'}")
    old_schema(engine)

    applied = ensure_columns(engine)

    assert "leagues.poster_url" in applied
    assert "leagues.powered_by_name" in applied
    columns = {c["name"] for c in sa.inspect(engine).get_columns("leagues")}
    assert set(ADDITIONS["leagues"]) <= columns


def test_existing_rows_survive(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path/'old.db'}")
    old_schema(engine)
    ensure_columns(engine)

    with engine.begin() as conn:
        row = conn.execute(sa.text("SELECT name, season, poster_url FROM leagues WHERE id = 1")).one()
    assert row.name == "SPR Premier League"
    assert row.season == "2026"
    assert row.poster_url is None, "a new column starts empty, it doesn't invent a value"


def test_running_twice_changes_nothing(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path/'old.db'}")
    old_schema(engine)

    first = ensure_columns(engine)
    second = ensure_columns(engine)

    assert first, "the first pass should add the columns"
    assert second == [], "the second pass is a no-op — this runs on every boot"


def test_a_missing_table_is_skipped(tmp_path):
    engine = sa.create_engine(f"sqlite:///{tmp_path/'empty.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)"))

    assert ensure_columns(engine) == [], "create_all builds new tables complete"


def test_startup_on_a_pre_existing_database(tmp_path):
    """The real path: an old database file, then a normal startup sequence.

    Runs in a subprocess. Reloading app.config in-process would repoint the
    engine that every other test in the suite shares.
    """
    import subprocess
    import sys
    import textwrap

    db = tmp_path / "live.db"
    engine = sa.create_engine(f"sqlite:///{db}")
    old_schema(engine)
    engine.dispose()

    script = textwrap.dedent(
        """
        import os, sys
        os.environ["DATABASE_URL"] = sys.argv[1]
        from app.database import Base, engine
        from app.migrations import ensure_columns
        import sqlalchemy as sa

        Base.metadata.create_all(bind=engine)
        ensure_columns(engine)
        with engine.begin() as conn:
            row = conn.execute(sa.text(
                "SELECT name, poster_url, powered_by_name FROM leagues WHERE id = 1"
            )).one()
        assert row.name == "SPR Premier League", row
        print("OK")
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", script, f"sqlite:///{db}"],
        capture_output=True,
        text=True,
        cwd=str(Path(__file__).resolve().parent.parent),
    )
    assert result.returncode == 0, result.stderr
    assert "OK" in result.stdout
