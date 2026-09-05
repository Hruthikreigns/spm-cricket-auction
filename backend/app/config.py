from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # --- Core ---
    app_name: str = "SPM Cricket Auction API"
    environment: str = "development"
    debug: bool = True

    # --- Database ---
    # Defaults to a local SQLite file so a fresh clone runs with nothing else
    # installed. Docker Compose and any real deployment override this with a
    # PostgreSQL URL, which is what you want for an actual auction.
    database_url: str = "sqlite:///./auction.db"

    # --- Auth ---
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12

    # Bootstrapped on first run (see app.seed)
    admin_email: str = "admin@cricauction.com"
    admin_password: str = "admin123"

    # How many people may watch a league's live room at once. One shared
    # login, this many simultaneous viewers.
    max_live_viewers: int = 30

    # --- Email ---
    # Set these to turn on "email me a reset link". With Gmail, smtp_user is
    # the address and smtp_password is an app password, not the account one.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_starttls: bool = True

    # Where the reset link points. Set this to your domain in production, or
    # the link in the email will send people to localhost.
    app_base_url: str = "http://localhost:5173"

    reset_token_minutes: int = 30

    # --- Storage ---
    upload_dir: str = "uploads"
    max_upload_mb: int = 8

    # --- Defaults for new leagues (overridable per league) ---
    default_purse: int = 100_000
    default_min_players: int = 15
    default_max_players: int = 18
    default_retain_price: int = 3_000
    default_base_price: int = 1_000
    default_bid_increment: int = 500
    default_timer_seconds: int = 30

    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def email_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_from)

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
