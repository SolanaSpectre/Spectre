from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


class MemoryStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.state = self._load()

    def _load(self) -> dict:
        if not self.path.exists():
            return {"recent_phrases": [], "posted_topic_ids": [], "recent_engagements": []}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if "recent_engagements" not in data:
                data["recent_engagements"] = []
            return data
        except Exception:
            return {"recent_phrases": [], "posted_topic_ids": [], "recent_engagements": []}

    def phrase_seen(self, phrase: str) -> bool:
        return phrase.strip().lower() in {item.lower() for item in self.state.get("recent_phrases", [])}

    def topic_seen(self, topic_id: str) -> bool:
        return topic_id in set(self.state.get("posted_topic_ids", []))

    def remember(self, topic_id: str, text: str) -> None:
        recent_phrases = [item for item in self.state.get("recent_phrases", []) if item != text]
        recent_phrases.insert(0, text)
        self.state["recent_phrases"] = recent_phrases[:50]

        posted = [item for item in self.state.get("posted_topic_ids", []) if item != topic_id]
        posted.insert(0, topic_id)
        self.state["posted_topic_ids"] = posted[:200]

    def remember_engagement(
        self,
        topic_id: str,
        author_handle: str,
        engagement_type: str,
        tone: str,
    ) -> None:
        """Track a completed engagement for anti-repetition and author-exposure tracking."""
        entry = {
            "topic_id": topic_id,
            "author_handle": str(author_handle or "").lower().strip(),
            "engagement_type": engagement_type,
            "tone": tone,
            "at": datetime.now(timezone.utc).isoformat(),
        }
        engagements = list(self.state.get("recent_engagements", []))
        engagements.insert(0, entry)
        self.state["recent_engagements"] = engagements[:100]

    def is_author_overused(self, author_handle: str, window_hours: float = 24.0, max_hits: int = 2) -> bool:
        """
        Return True if Venum has already engaged with this author
        max_hits or more times within window_hours.
        """
        if not author_handle:
            return False
        handle = str(author_handle).lower().strip()
        now = datetime.now(timezone.utc)
        count = 0
        for entry in self.state.get("recent_engagements", []):
            if str(entry.get("author_handle") or "").lower().strip() != handle:
                continue
            try:
                at = datetime.fromisoformat(str(entry["at"])).astimezone(timezone.utc)
                age_hours = (now - at).total_seconds() / 3600.0
                if age_hours <= window_hours:
                    count += 1
            except Exception:
                continue
        return count >= max_hits

    def get_recent_engagement_modes(self, window_hours: float = 6.0) -> dict:
        """
        Return tone/mode usage counts for the last window_hours.
        Useful for variety checking — don't want to spam the same tone.
        """
        now = datetime.now(timezone.utc)
        counts: dict[str, int] = {}
        for entry in self.state.get("recent_engagements", []):
            try:
                at = datetime.fromisoformat(str(entry["at"])).astimezone(timezone.utc)
                age_hours = (now - at).total_seconds() / 3600.0
                if age_hours > window_hours:
                    continue
            except Exception:
                continue
            tone = str(entry.get("tone") or "unknown")
            counts[tone] = counts.get(tone, 0) + 1
        return counts

    def save(self) -> None:
        self.path.write_text(json.dumps(self.state, indent=2), encoding="utf-8")
