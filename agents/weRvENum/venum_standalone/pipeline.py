from __future__ import annotations

from .growth import GrowthEngine
from .memory import MemoryStore
from .models import Candidate, Topic
from .persona import PersonaEngine


def build_candidates(
    topics: list[Topic],
    growth: GrowthEngine,
    persona: PersonaEngine,
    memory: MemoryStore,
    kind: str,
    limit: int,
) -> list[Candidate]:
    ranked = []
    for topic in topics:
        score, rationale = growth.score_topic(topic, memory.topic_seen(topic.topic_id))
        ranked.append((score, rationale, topic))
    ranked.sort(key=lambda item: item[0], reverse=True)

    candidates: list[Candidate] = []
    for score, rationale, topic in ranked:
        if score <= 0:
            continue
        if kind in {"reply", "both"}:
            for text in reply_templates(topic, persona):
                candidates.append(_candidate("reply", topic, score, rationale, text, persona))
        if kind in {"original", "both"}:
            for text in original_templates(topic, persona):
                candidates.append(_candidate("original", topic, score - 3.0, rationale, text, persona))

    deduped: list[Candidate] = []
    seen_texts: set[str] = set()
    for item in sorted(candidates, key=lambda row: row.score, reverse=True):
        normalized = item.text.strip().lower()
        if normalized in seen_texts:
            continue
        if memory.phrase_seen(normalized):
            continue
        seen_texts.add(normalized)
        deduped.append(item)
        if len(deduped) >= limit:
            break
    return deduped


def _candidate(kind: str, topic: Topic, score: float, rationale: list[str], text: str, persona: PersonaEngine) -> Candidate:
    return Candidate(
        candidate_type=kind,
        topic_id=topic.topic_id,
        score=round(score, 2),
        text=text,
        rationale=list(rationale),
        validation_errors=persona.validate(text),
    )


def reply_templates(topic: Topic, persona: PersonaEngine) -> list[str]:
    focus = persona.theme_word(topic.combined_text, topic.tags)
    return unique_texts(
        [
            f"{focus} loud first\n\nprice listen after",
            f"{focus} get headline\n\nliquidity do real vote",
            f"same room chase top\n\nthen ask why red",
        ]
    )


def original_templates(topic: Topic, persona: PersonaEngine) -> list[str]:
    focus = persona.theme_word(topic.combined_text, topic.tags)
    tag_set = set(topic.tags)

    templates = [
        f"{focus} loud at top\n\nden quiet at red\n\nsame ppl",
        f"{focus} wear new cloths\n\nsame cycle unda",
        "u call it news\n\nwe call it timing gap",
    ]

    if "liquidity" in tag_set or "flow" in tag_set or "rotation" in tag_set:
        templates.append("eyes bring story\n\nliq bring truth")
    if "etf" in tag_set or "wrapper" in tag_set:
        templates.append("cant own meme\n\nso dey wrap it\n\nsame hunger")
    if "headline" in tag_set or "macro" in tag_set:
        templates.append("headline loud\n\nliquidity move first")

    return unique_texts(templates)


def unique_texts(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = item.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result
