import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from .config import settings
from .database import Base, engine, get_db
from .migrations import ensure_columns, ensure_enum_values
from .routers import (
    analytics,
    archive,
    auction,
    auth,
    content,
    leagues,
    viewer,
    players,
    registrations,
)
from .seed import bootstrap
from .services import storage

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s | %(message)s",
)
log = logging.getLogger("auction")


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    # create_all won't touch a table that already exists, so top up any
    # columns added since this database was first built.
    ensure_columns(engine)
    ensure_enum_values(engine)
    bootstrap()
    log.info("%s ready in %s mode", settings.app_name, settings.environment)
    yield
    engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description=(
        "Live cricket auction platform. Admin endpoints need a bearer token from "
        "`POST /api/auth/login`; everything under the public read paths is open."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uploads are served from the database rather than a static mount, so they
# survive a redeploy on hosting with an ephemeral filesystem. The directory is
# still created because a plain-server deployment may hold older files there,
# and storage.load falls back to it.
UPLOAD_ROOT = Path(settings.upload_dir)
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


@app.get("/uploads/{path:path}", tags=["uploads"])
def serve_upload(path: str, db: Session = Depends(get_db)):
    found = storage.load(db, f"/uploads/{path}")
    if not found:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That image isn't here.")
    data, content_type = found
    return Response(
        content=data,
        media_type=content_type,
        # Filenames are random and content never changes under one, so this
        # can be cached hard — it saves re-fetching 27 portraits on every view.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )

for module in (auth, viewer, leagues, players, registrations, auction, analytics, archive, content):
    app.include_router(module.router)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Something went wrong on our end. The team has been notified."},
    )


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok", "environment": settings.environment}
