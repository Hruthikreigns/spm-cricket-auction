"""Point the app at an in-memory database before anything imports the engine."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_auction.db")
os.environ.setdefault("JWT_SECRET", "test-secret")
