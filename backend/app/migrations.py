"""Lightweight additive migrations.

`create_all` makes tables that don't exist, but it will never add a column to
a table that does — so once a league has real data in it, a new field would
silently never appear. This adds missing columns in place.

Deliberately limited to `ADD COLUMN` with a default: it is the one schema
change that is safe to run unattended on a live database, on both SQLite and
PostgreSQL. Anything else — renames, type changes, drops — needs Alembic and
a human watching.
"""

import logging

from sqlalchemy import Engine, inspect, text

log = logging.getLogger(__name__)

# table -> column -> SQL type. Every entry must be nullable or carry a default,
# so existing rows stay valid.
ADDITIONS: dict[str, dict[str, str]] = {
    "leagues": {
        "poster_url": "VARCHAR(400)",
        "powered_by_name": "VARCHAR(140)",
        "powered_by_logo_url": "VARCHAR(400)",
        "powered_by_url": "VARCHAR(400)",
        # Existing leagues default to open, which is how they behaved before
        # this switch existed.
        "registration_open": "BOOLEAN DEFAULT TRUE",
        "show_mobile_publicly": "BOOLEAN DEFAULT FALSE",
        "auto_approve_registrations": "BOOLEAN DEFAULT FALSE",
    },
    "registrations": {
        "email": "VARCHAR(200)",
        "card_token": "VARCHAR(64)",
    },
    "users": {
        "team_label": "VARCHAR(120)",
    },
    "auction_settings": {
        # Existing leagues get the same cap as a new one.
        "max_retained": "INTEGER DEFAULT 2",
    },
}


# Values added to a Python enum after a database was built. SQLite stores
# these columns as plain VARCHAR so it needs nothing; PostgreSQL has a real
# enum type and must be told.
ENUM_VALUES: dict[str, list[str]] = {
    "playerstatus": ["NOT_AVAILABLE"],
}


def ensure_enum_values(engine: Engine) -> list[str]:
    """Teach PostgreSQL about enum values added since the type was created."""
    if engine.dialect.name != "postgresql":
        return []

    applied: list[str] = []
    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block that later
    # uses the value, so each one gets its own autocommit connection.
    for type_name, values in ENUM_VALUES.items():
        for value in values:
            try:
                with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
                    conn.execute(
                        text(f"ALTER TYPE {type_name} ADD VALUE IF NOT EXISTS :value").bindparams(
                            value=value
                        )
                    )
                applied.append(f"{type_name}.{value}")
            except Exception as exc:  # noqa: BLE001
                log.warning("could not add enum value %s.%s: %s", type_name, value, exc)
    if applied:
        log.info("added enum values: %s", ", ".join(applied))
    return applied


def ensure_columns(engine: Engine) -> list[str]:
    """Add any missing columns. Returns what it changed, for the log."""
    inspector = inspect(engine)
    applied: list[str] = []

    for table, columns in ADDITIONS.items():
        if table not in inspector.get_table_names():
            continue  # create_all will build it complete
        existing = {c["name"] for c in inspector.get_columns(table)}

        for name, sql_type in columns.items():
            if name in existing:
                continue
            try:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
                applied.append(f"{table}.{name}")
            except Exception as exc:  # noqa: BLE001
                # Never take the app down over a cosmetic column.
                log.warning("could not add %s.%s: %s", table, name, exc)

    if applied:
        log.info("added columns: %s", ", ".join(applied))
    return applied
