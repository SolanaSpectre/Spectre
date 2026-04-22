from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .models import Topic


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_topics(path: Path) -> list[Topic]:
    raw = load_json(path)
    topics: list[Topic] = []
    for row in raw:
        created_at = _parse_datetime(str(row.get("created_at") or ""))
        topics.append(
            Topic(
                topic_id=str(row.get("id") or ""),
                author_handle=str(row.get("author_handle") or ""),
                title=str(row.get("title") or "").strip().lower(),
                text=str(row.get("text") or "").strip().lower(),
                created_at=created_at,
                tags=[str(item).strip().lower() for item in (row.get("tags") or []) if str(item).strip()],
                metrics={str(k): float(v) for k, v in (row.get("metrics") or {}).items()},
            )
        )
    return topics


def _parse_datetime(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
