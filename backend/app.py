import logging
import os
from contextlib import asynccontextmanager
import connexion
from pathlib import Path
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles
from starlette.routing import WebSocketRoute, Mount
from constants import UPLOAD_DIR, CORS_ORIGIN, AUTH_PROVIDER
from services.auth import AuthMiddleware
from services.guard import guard
from services.security_headers import SecurityHeadersMiddleware
from ws.handler import websocket_endpoint

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

connexion_app = connexion.AsyncApp(
    __name__,
    specification_dir="openapi/",
)
connexion_app.add_api("spec.yaml", pythonic_params=True)

Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)

FRONTEND_DIR = Path("static/frontend")


@asynccontextmanager
async def lifespan(_app):
    from models.base import init_db
    from services.db_writer import start_writer
    from services.media_manager import media_manager
    await init_db()
    start_writer()
    media_manager.start()
    guard.log_passphrase()
    logger = logging.getLogger(__name__)
    mode = "production" if FRONTEND_DIR.is_dir() else "development"
    logger.info(f"Microcord backend ready (auth provider: {AUTH_PROVIDER}, mode: {mode})")
    yield


routes = [
    WebSocketRoute("/ws", websocket_endpoint),
    Mount("/uploads", app=StaticFiles(directory=UPLOAD_DIR)),
    Mount("/", app=connexion_app),
]

if FRONTEND_DIR.is_dir():
    _frontend_files = StaticFiles(directory=str(FRONTEND_DIR), html=True)

    async def _frontend_fallback(scope, receive, send):
        """Try Connexion first; serve frontend static files for non-API paths."""
        if scope["path"].startswith("/api"):
            await connexion_app(scope, receive, send)
        else:
            await _frontend_files(scope, receive, send)

    routes = [
        WebSocketRoute("/ws", websocket_endpoint),
        Mount("/uploads", app=StaticFiles(directory=UPLOAD_DIR)),
        Mount("/", app=_frontend_fallback),
    ]

app = Starlette(
    routes=routes,
    middleware=[
        Middleware(SecurityHeadersMiddleware),
        Middleware(AuthMiddleware),
        Middleware(
            CORSMiddleware,
            allow_origins=[CORS_ORIGIN],
            allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type"],
        ),
    ],
    lifespan=lifespan,
)
