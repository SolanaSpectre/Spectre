from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .paths import PROJECT_DIR


@dataclass(slots=True)
class Settings:
    ollama_base_url: str
    ollama_model: str
    x_api_key: str
    x_api_secret: str
    x_access_token: str
    x_access_token_secret: str
    x_bearer_token: str
    x_user_id: str
    venum_dry_run: bool


def load_settings(env_path: Path | None = None) -> Settings:
    _load_env_file(env_path or (PROJECT_DIR / ".env"))
    return Settings(
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
        ollama_model=os.getenv("OLLAMA_MODEL", "gurubot/self-after-dark:8b-q4_K_M"),
        x_api_key=os.getenv("X_API_KEY", ""),
        x_api_secret=os.getenv("X_API_SECRET", os.getenv("X_API_KEY_SECRET", "")),
        x_access_token=os.getenv("X_ACCESS_TOKEN", ""),
        x_access_token_secret=os.getenv("X_ACCESS_TOKEN_SECRET", ""),
        x_bearer_token=os.getenv("X_BEARER_TOKEN", ""),
        x_user_id=os.getenv("X_USER_ID", ""),
        venum_dry_run=os.getenv("VENUM_DRY_RUN", "true").strip().lower() in {"1", "true", "yes", "on"},
    )


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
