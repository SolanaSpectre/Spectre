from __future__ import annotations

import requests

from .settings import Settings


class OllamaClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def chat(self, system_prompt: str, user_prompt: str) -> str:
        payload = {
            "model": self.settings.ollama_model,
            "stream": False,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        response = requests.post(
            f"{self.settings.ollama_base_url}/api/chat",
            json=payload,
            timeout=180,
        )
        response.raise_for_status()
        data = response.json()
        return str(((data.get("message") or {}).get("content") or "")).strip()
