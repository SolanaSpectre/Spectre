from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass(slots=True)
class Topic:
    topic_id: str
    author_handle: str
    title: str
    text: str
    created_at: datetime
    tags: list[str] = field(default_factory=list)
    metrics: dict[str, float] = field(default_factory=dict)

    @property
    def combined_text(self) -> str:
        return " ".join(part for part in [self.title, self.text, " ".join(self.tags)] if part).strip()

    @property
    def age_hours(self) -> float:
        delta = datetime.now(timezone.utc) - self.created_at.astimezone(timezone.utc)
        return max(delta.total_seconds() / 3600.0, 0.0)


@dataclass(slots=True)
class Candidate:
    candidate_type: str
    topic_id: str
    score: float
    text: str
    rationale: list[str]
    validation_errors: list[str] = field(default_factory=list)
