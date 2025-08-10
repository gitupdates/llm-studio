===== backend/core/config.py (replace file) =====
from __future__ import annotations
import json, os, secrets
from pathlib import Path

ROOT: Path = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
DOCS_DIR = DATA_DIR / "docs"
EXPORTS_DIR = DATA_DIR / "exports"
DB_PATH = DATA_DIR / "sessions.db"
INDEX_PATH = DATA_DIR / "index.json"
CONFIG_PATH = DATA_DIR / "config.json"

for p in (DATA_DIR, UPLOADS_DIR, DOCS_DIR, EXPORTS_DIR):
    p.mkdir(parents=True, exist_ok=True)

def _find_react_dir() -> Path | None:
    """
    Looks for a built React SPA (no dev server).
    Put your build in any of these (first match wins):
      - <repo>/react-build
      - <repo>/react/build
      - <repo>/react/dist
      - <repo>/web/react
      - <repo>/web/dist
      - <repo>/web/build
    """
    candidates = [
        ROOT / "react-build",
        ROOT / "react" / "build",
        ROOT / "react" / "dist",
        WEB_DIR / "react",
        WEB_DIR / "dist",
        WEB_DIR / "build",
    ]
    for d in candidates:
        if d.exists() and (d / "index.html").exists():
            return d
    return None

REACT_DIR = _find_react_dir()

DEFAULT_CONFIG = {
    "ollama_host": os.getenv("OLLAMA_HOST", "http://127.0.0.1:11434"),
    "model": "llama3.2",
    "temperature": 0.2,
    "top_p": 0.9,
    "max_tokens": 512,
    "rag_enabled": True,
    "rag_k": 4,
    "chunk_size": 800,
    "chunk_overlap": 120,
    "web_enabled": False,
    "admin_token": None,     # filled on first load
}

def load_config() -> dict:
    cfg = DEFAULT_CONFIG.copy()
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    if not cfg.get("admin_token"):
        import secrets
        cfg["admin_token"] = secrets.token_urlsafe(24)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg

def save_config(cfg: dict):
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")

CONFIG = load_config()


===== backend/app.py (replace file) =====
from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .core.config import WEB_DIR, REACT_DIR
from .routers.chat import router as chat_router
from .routers.files import router as files_router
from .routers.models import router as models_router
from .routers.rag import router as rag_router
from .routers.export import router as export_router
from .routers.settings import router as settings_router
from .routers.sessions import router as sessions_router
from .routers.dev import router as dev_router
from .routers.ui import router as ui_router

def create_app() -> FastAPI:
    app = FastAPI(title="LLM Studio v2")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # API routers
    app.include_router(settings_router)
    app.include_router(chat_router)
    app.include_router(files_router)
    app.include_router(models_router)
    app.include_router(rag_router)
    app.include_router(export_router)
    app.include_router(sessions_router)
    app.include_router(dev_router)
    app.include_router(ui_router)

    # Static: vanilla web assets
    if WEB_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(WEB_DIR), html=False), name="static")

    # Static: React build (if present)
    # Served at /react and used by /ui as the preferred UI.
    if REACT_DIR:
        app.mount("/react", StaticFiles(directory=str(REACT_DIR), html=True), name="react")

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/")
    def root():
        return {"name": "LLM Studio v2", "ui": "/ui", "react": bool(REACT_DIR), "health": "/health"}

    return app

app = create_app()


===== backend/routers/ui.py (replace file) =====
from __future__ import annotations
from fastapi import APIRouter
from fastapi.responses import HTMLResponse, Response
from pathlib import Path
from ..core.config import WEB_DIR, REACT_DIR, CONFIG

router = APIRouter(tags=["ui"])

def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")

@router.get("/ui")
def ui():
    """
    Prefer the React build if present; otherwise serve the vanilla web UI.
    """
    if REACT_DIR and (REACT_DIR / "index.html").exists():
        return HTMLResponse(_read(REACT_DIR / "index.html"))
    return HTMLResponse(_read(WEB_DIR / "index.html"))

# SPA fallback: allow deep links like /react/chat/123 to load index.html
@router.get("/react/{path:path}")
def react_spa(path: str):
    if REACT_DIR and (REACT_DIR / "index.html").exists():
        return HTMLResponse(_read(REACT_DIR / "index.html"))
    # No React build—return 204 so the browser doesn't get a broken page
    return Response(status_code=204)

@router.get("/favicon.ico")
def favicon():
    return Response(status_code=204)

@router.get("/ui/token")
def ui_token():
    # optional: expose token to localhost UI convenience
    return {"admin_token": CONFIG.get("admin_token")}
