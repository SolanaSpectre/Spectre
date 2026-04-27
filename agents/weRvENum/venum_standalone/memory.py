from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import Topic


class MemoryStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.state = self._load()

    def _load(self) -> dict:
        if not self.path.exists():
            return _empty_state()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if "recent_engagements" not in data:
                data["recent_engagements"] = []
            if "author_profiles" not in data:
                data["author_profiles"] = {}
            return data
        except Exception:
            return _empty_state()

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
        self._touch_author_profile(author_handle, engagement_type=engagement_type, tone=tone)

    def remember_observation(
        self,
        topic: Topic,
        source: str,
        room_context: str = "",
        signals: list[str] | None = None,
        opportunity_score: float | None = None,
    ) -> None:
        handle = _handle(topic.author_handle)
        if not handle:
            return
        profiles = self.state.setdefault("author_profiles", {})
        profile = profiles.setdefault(handle, _new_author_profile(topic.author_handle))
        now = datetime.now(timezone.utc).isoformat()
        profile["display_handle"] = topic.author_handle or profile.get("display_handle") or handle
        profile["last_seen_at"] = now
        profile["seen_count"] = int(profile.get("seen_count", 0)) + 1
        profile["last_topic_id"] = topic.topic_id
        profile["last_source"] = source
        if room_context:
            _bump(profile.setdefault("room_context_counts", {}), room_context)
        for signal in signals or []:
            _bump(profile.setdefault("signal_counts", {}), str(signal).lower().strip())
        if opportunity_score is not None:
            profile["last_opportunity_score"] = round(float(opportunity_score), 2)

    def author_profile(self, author_handle: str) -> dict[str, Any]:
        handle = _handle(author_handle)
        profile = (self.state.get("author_profiles") or {}).get(handle, {})
        if not profile:
            return {
                "display_handle": author_handle,
                "relationship": "new_face",
                "seen_count": 0,
                "engagement_count": 0,
                "summary": "new face no memory yet",
            }
        seen_count = int(profile.get("seen_count", 0))
        engagement_count = int(profile.get("engagement_count", 0))
        if engagement_count > 0:
            relationship = "known_contact"
        elif seen_count >= 3:
            relationship = "familiar_room"
        else:
            relationship = "seen_before"
        top_contexts = _top_keys(profile.get("room_context_counts") or {}, limit=3)
        top_signals = _top_keys(profile.get("signal_counts") or {}, limit=3)
        summary_bits = [relationship.replace("_", " ")]
        if top_contexts:
            summary_bits.append("contexts " + ", ".join(top_contexts))
        if top_signals:
            summary_bits.append("signals " + ", ".join(top_signals))
        return {
            "display_handle": profile.get("display_handle") or author_handle,
            "relationship": relationship,
            "seen_count": seen_count,
            "engagement_count": engagement_count,
            "last_seen_at": profile.get("last_seen_at"),
            "last_engaged_at": profile.get("last_engaged_at"),
            "top_contexts": top_contexts,
            "top_signals": top_signals,
            "summary": " | ".join(summary_bits),
        }

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

    def _touch_author_profile(self, author_handle: str, engagement_type: str, tone: str) -> None:
        handle = _handle(author_handle)
        if not handle:
            return
        profiles = self.state.setdefault("author_profiles", {})
        profile = profiles.setdefault(handle, _new_author_profile(author_handle))
        profile["last_engaged_at"] = datetime.now(timezone.utc).isoformat()
        profile["engagement_count"] = int(profile.get("engagement_count", 0)) + 1
        _bump(profile.setdefault("engagement_type_counts", {}), engagement_type)
        _bump(profile.setdefault("tone_counts", {}), tone)


def _empty_state() -> dict:
    return {"recent_phrases": [], "posted_topic_ids": [], "recent_engagements": [], "author_profiles": {}}


def _handle(author_handle: str) -> str:
    return str(author_handle or "").lower().strip().lstrip("@")


def _new_author_profile(author_handle: str) -> dict[str, Any]:
    return {
        "display_handle": author_handle,
        "seen_count": 0,
        "engagement_count": 0,
        "room_context_counts": {},
        "signal_counts": {},
        "engagement_type_counts": {},
        "tone_counts": {},
    }


def _bump(bucket: dict[str, int], key: str) -> None:
    normalized = str(key or "").lower().strip()
    if not normalized:
        return
    bucket[normalized] = int(bucket.get(normalized, 0)) + 1


def _top_keys(bucket: dict[str, int], limit: int) -> list[str]:
    return [key for key, _value in sorted(bucket.items(), key=lambda item: item[1], reverse=True)[:limit]]
