from __future__ import annotations

from datetime import datetime, timezone
import re

from .models import Candidate, Topic
from .persona import PersonaEngine
from .venum_prompting import clean_venum_reply


PROMO_PATTERNS = [
    "connect with me",
    "connecting and collaborating",
    "build together",
    "copy trading",
    "telegram",
    "expert signals",
    "callsbywhales",
    "open to connecting",
    "strategy with",
    "collaborating further",
    "lets build together",
]
LOW_SIGNAL_PATTERNS = [
    "great strategy",
    "strong fundamentals",
    "distinct project",
    "unique edge",
    "rising traction",
]
WORD_RE = re.compile(r"[a-z0-9']+")


def topics_from_mentions(payload: dict) -> list[Topic]:
    users = {}
    for user in ((payload.get("includes") or {}).get("users") or []):
        users[str(user.get("id") or "")] = str(user.get("username") or "")

    topics: list[Topic] = []
    for row in payload.get("data") or []:
        created_at = _parse_datetime(str(row.get("created_at") or ""))
        metrics = row.get("public_metrics") or {}
        topics.append(
            Topic(
                topic_id=str(row.get("id") or ""),
                author_handle=users.get(str(row.get("author_id") or ""), "unknown"),
                title="",
                text=str(row.get("text") or "").strip().lower(),
                created_at=created_at,
                tags=[],
                metrics={
                    "likes": float(metrics.get("like_count", 0.0)),
                    "replies": float(metrics.get("reply_count", 0.0)),
                    "reposts": float(metrics.get("retweet_count", 0.0)),
                    "quotes": float(metrics.get("quote_count", 0.0)),
                },
            )
        )
    return topics


def topics_from_timelines(user_payload: dict, timeline_payloads: list[dict]) -> list[Topic]:
    users = {}
    for row in user_payload.get("data") or []:
        users[str(row.get("id") or "")] = str(row.get("username") or "")

    topics: list[Topic] = []
    for payload in timeline_payloads:
        for row in payload.get("data") or []:
            created_at = _parse_datetime(str(row.get("created_at") or ""))
            metrics = row.get("public_metrics") or {}
            author_id = str(row.get("author_id") or "")
            text = str(row.get("text") or "").strip().lower()
            topics.append(
                Topic(
                    topic_id=str(row.get("id") or ""),
                    author_handle=users.get(author_id, "unknown"),
                    title="",
                    text=text,
                    created_at=created_at,
                    tags=_tags_from_text(text),
                    metrics={
                        "likes": float(metrics.get("like_count", 0.0)),
                        "replies": float(metrics.get("reply_count", 0.0)),
                        "reposts": float(metrics.get("retweet_count", 0.0)),
                        "quotes": float(metrics.get("quote_count", 0.0)),
                        "impressions": float(metrics.get("impression_count", 0.0)),
                    },
                )
            )
    return topics


def topics_from_search(payloads: list[dict]) -> list[Topic]:
    topics: list[Topic] = []
    for payload in payloads:
        users = {}
        for user in ((payload.get("includes") or {}).get("users") or []):
            users[str(user.get("id") or "")] = str(user.get("username") or "")
        for row in payload.get("data") or []:
            created_at = _parse_datetime(str(row.get("created_at") or ""))
            metrics = row.get("public_metrics") or {}
            text = str(row.get("text") or "").strip().lower()
            topics.append(
                Topic(
                    topic_id=str(row.get("id") or ""),
                    author_handle=users.get(str(row.get("author_id") or ""), "unknown"),
                    title="",
                    text=text,
                    created_at=created_at,
                    tags=_tags_from_text(text),
                    metrics={
                        "likes": float(metrics.get("like_count", 0.0)),
                        "replies": float(metrics.get("reply_count", 0.0)),
                        "reposts": float(metrics.get("retweet_count", 0.0)),
                        "quotes": float(metrics.get("quote_count", 0.0)),
                        "impressions": float(metrics.get("impression_count", 0.0)),
                    },
                )
            )
    return topics


def candidate_from_model(topic: Topic, reply_text: str, persona: PersonaEngine) -> Candidate:
    cleaned = clean_venum_reply(reply_text.strip())
    return Candidate(
        candidate_type="reply",
        topic_id=topic.topic_id,
        score=0.0,
        text=cleaned,
        rationale=[f"reply to @{topic.author_handle}", "generated from live mention"],
        validation_errors=persona.validate(cleaned),
    )


def classify_mention(topic: Topic, attention_policy: dict | None = None) -> dict:
    attention_policy = attention_policy or {}
    text = topic.text.lower().strip()
    words = WORD_RE.findall(text)
    promo_hits = [pattern for pattern in PROMO_PATTERNS if pattern in text]
    low_signal_hits = [pattern for pattern in LOW_SIGNAL_PATTERNS if pattern in text]
    replyable_keywords = [item.lower() for item in attention_policy.get("replyable_keywords", [])]
    bait_patterns = [item.lower() for item in attention_policy.get("bait_patterns", [])]
    weird_patterns = [item.lower() for item in attention_policy.get("weird_patterns", [])]
    tracked_boosts = attention_policy.get("tracked_account_boosts", {})
    metrics = topic.metrics or {}
    impressions = float(metrics.get("impressions", 0.0))
    likes = float(metrics.get("likes", 0.0))
    replies = float(metrics.get("replies", 0.0))
    keyword_hits = [token for token in replyable_keywords if token in text]
    bait_hits = [token for token in bait_patterns if token in text]
    weird_hits = [token for token in weird_patterns if token in text]

    if promo_hits:
        return {
            "status": "skip",
            "reason": f"promo_spam: {promo_hits[0]}",
            "score": 0.0,
            "signals": [],
        }

    if low_signal_hits and len(words) < 12 and replies == 0 and likes <= 1:
        return {
            "status": "skip",
            "reason": f"low_signal_bait: {low_signal_hits[0]}",
            "score": 5.0,
            "signals": [],
        }

    score = 20.0
    if "?" in text:
        score += 8.0
    if keyword_hits:
        score += min(18.0, 6.0 + (3.0 * len(keyword_hits)))
    if bait_hits:
        score += 8.0
    if weird_hits:
        score += 6.0
    if replies > 0:
        score += min(replies * 2.0, 16.0)
    if impressions > 50:
        score += 8.0
    if len(words) < 4:
        score -= 10.0
    score += float(tracked_boosts.get(topic.author_handle, 0.0) or 0.0)

    threshold = float(attention_policy.get("min_replyable_score", 24.0) or 24.0)
    status = "replyable" if score >= threshold else "skip"
    reason = "real_opening" if status == "replyable" else "weak_opening"
    return {
        "status": status,
        "reason": reason,
        "score": score,
        "signals": keyword_hits[:4] + bait_hits[:2] + weird_hits[:2],
    }


def classify_timeline_topic(topic: Topic, attention_policy: dict | None = None) -> dict:
    verdict = classify_mention(topic, attention_policy)
    text = topic.text.lower().strip()
    metrics = topic.metrics or {}
    likes = float(metrics.get("likes", 0.0))
    replies = float(metrics.get("replies", 0.0))
    reposts = float(metrics.get("reposts", 0.0))

    score = float(verdict["score"])
    if likes >= 10:
        score += 8.0
    if reposts >= 3:
        score += 5.0
    if replies >= 2:
        score += 5.0
    if any(token in text for token in ["headline", "btc", "bitcoin", "solana", "liq", "liquidity", "etf", "chart", "flow", "macro", "fed", "cpi", "rotation"]):
        score += 6.0

    threshold = float((attention_policy or {}).get("min_replyable_score", 24.0) or 24.0)
    status = "replyable" if score >= threshold else "skip"
    return {
        "status": status,
        "reason": "timeline_opening" if status == "replyable" else verdict["reason"],
        "score": score,
        "signals": verdict["signals"],
    }


def filter_replyable_mentions(topics: list[Topic], attention_policy: dict | None = None) -> tuple[list[dict], list[dict]]:
    replyable: list[dict] = []
    skipped: list[dict] = []
    for topic in topics:
        verdict = classify_mention(topic, attention_policy)
        if verdict["status"] == "replyable":
            replyable.append(
                {
                    "topic": topic,
                    "reason": verdict["reason"],
                    "score": verdict["score"],
                    "signals": verdict["signals"],
                }
            )
        else:
            skipped.append(
                {
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "reason": verdict["reason"],
                    "score": verdict["score"],
                    "signals": verdict["signals"],
                    "text": topic.text,
                }
            )
    replyable.sort(key=lambda item: item["score"], reverse=True)
    return replyable, skipped


def filter_replyable_timelines(topics: list[Topic], attention_policy: dict | None = None) -> tuple[list[dict], list[dict]]:
    replyable: list[dict] = []
    skipped: list[dict] = []
    for topic in topics:
        verdict = classify_timeline_topic(topic, attention_policy)
        if verdict["status"] == "replyable":
            replyable.append(
                {
                    "topic": topic,
                    "reason": verdict["reason"],
                    "score": verdict["score"],
                    "signals": verdict["signals"],
                }
            )
        else:
            skipped.append(
                {
                    "topic_id": topic.topic_id,
                    "author_handle": topic.author_handle,
                    "reason": verdict["reason"],
                    "score": verdict["score"],
                    "signals": verdict["signals"],
                    "text": topic.text,
                }
            )
    replyable.sort(key=lambda item: item["score"], reverse=True)
    return replyable, skipped


def filter_replyable_search(topics: list[Topic], attention_policy: dict | None = None) -> tuple[list[dict], list[dict]]:
    replyable, skipped = filter_replyable_timelines(topics, attention_policy)
    for item in replyable:
        text = item["topic"].text.lower()
        score = float(item["score"])
        if any(token in text for token in ["elon", "tesla", "spacex", "xai"]):
            score += 10.0
            item["signals"] = list(dict.fromkeys(item["signals"] + ["elon_attention"]))
        if any(token in text for token in ["solana", "validator", "jito", "mev", "bridge", "launch", "upgrade"]):
            score += 8.0
            item["signals"] = list(dict.fromkeys(item["signals"] + ["dev_signal"]))
        if any(token in text for token in ["btc", "bitcoin", "etf", "fed", "cpi", "tariffs", "liquidity"]):
            score += 6.0
            item["signals"] = list(dict.fromkeys(item["signals"] + ["trend_signal"]))
        item["score"] = score
    replyable.sort(key=lambda item: item["score"], reverse=True)
    return replyable, skipped


# Phrases the model tends to echo verbatim from the system prompt examples
_BOILERPLATE_PHRASES = [
    "dis one loud at top",
    "we rember who chase green",
    "pattern real tho",
    "liquidity always find a way",
    "dis one smell like top",
    "dat one smell like top",
    "we been here before",
    "nobody ever ready for dis move",
]
_GENERIC_REPLY_PHRASES = [
    "dats a gud point",
    "good one",
    "next level stuff",
    "sumtin smell bad",
    "got us thinkin",
    "fresh smell",
    "old socks",
    "u know how many",
    "this one is good",
    "this is the one",
]
# System prompt leak indicators
_PROMPT_LEAK_PHRASES = [
    "absolute rules",
    "never break these",
    "write in lowercase only",
    "you are venum",
    "you are a crypto market creature",
    "style examples",
    "do not copy these phrases",
    "voice emphasis",
]


def _boilerplate_score_penalty(text: str) -> float:
    """Return a negative penalty score if the text is mostly canned phrases."""
    text_lower = text.lower()
    hits = sum(1 for phrase in _BOILERPLATE_PHRASES if phrase in text_lower)
    leak_hits = sum(1 for phrase in _PROMPT_LEAK_PHRASES if phrase in text_lower)
    if leak_hits >= 1:
        return -200.0  # hard reject — model leaked system prompt
    if hits >= 2:
        return -60.0   # heavy penalty — mostly boilerplate
    if hits == 1:
        return -20.0   # soft penalty — one canned line
    return 0.0


def _generic_score_penalty(text: str, echoed_terms: list[str]) -> float:
    text_lower = text.lower()
    hits = sum(1 for phrase in _GENERIC_REPLY_PHRASES if phrase in text_lower)
    smell_count = text_lower.count("smell")
    penalty = 0.0
    if hits:
        penalty -= 18.0 * hits
    if smell_count >= 2:
        penalty -= 12.0
    if not echoed_terms:
        penalty -= 8.0
    if len(WORD_RE.findall(text_lower)) <= 5 and not echoed_terms:
        penalty -= 8.0
    return penalty


def candidate_is_usable(best: dict | None, min_score: float = 42.0) -> bool:
    if not best:
        return False
    if best.get("validation_errors"):
        return False
    return float(best.get("score") or 0.0) >= min_score


def choose_best_candidate(topic: Topic, candidates: list[str], persona: PersonaEngine) -> dict:
    best = None
    best_score = float("-inf")
    evaluations = []
    source_words = set(WORD_RE.findall(topic.text.lower()))
    for raw_text in candidates:
        candidate = candidate_from_model(topic, raw_text, persona)
        # use the cleaned text for all scoring and output
        text = candidate.text
        score = 30.0
        if candidate.validation_errors:
            score -= 40.0
        lines = [line for line in text.splitlines() if line.strip()]
        if 1 <= len(lines) <= 4:
            score += 8.0
        if len(text) <= 140:
            score += 6.0
        echoed = [word for word in WORD_RE.findall(text.lower()) if word in source_words and len(word) > 3]
        score += min(12.0, len(set(echoed)) * 4.0)
        if any(phrase in text.lower() for phrase in ["we rember", "pattern", "headline", "liq", "liquidity", "cycle"]):
            score += 5.0
        # Penalize boilerplate / system prompt leaks
        score += _boilerplate_score_penalty(text)
        score += _generic_score_penalty(text, echoed)
        evaluations.append(
            {
                "text": text,
                "validation_errors": candidate.validation_errors,
                "score": score,
                "echoed_terms": sorted(set(echoed)),
            }
        )
        if score > best_score:
            best_score = score
            best = evaluations[-1]
    return {"best": best, "all": evaluations}


def topics_from_trending(payloads: list[dict], weight_multiplier: float = 1.0) -> list[Topic]:
    """
    Convert search payloads from trend-hunting queries into Topics.

    Applies freshness scoring and visibility boosting on top of the base
    topics_from_search conversion. weight_multiplier lets callers
    amplify scores for high-signal query buckets (e.g. elon, solana devs).

    Returns Topics with boosted metrics for downstream scoring.
    """
    topics = topics_from_search(payloads)
    boosted: list[Topic] = []
    for topic in topics:
        metrics = dict(topic.metrics or {})
        likes = float(metrics.get("likes", 0))
        reposts = float(metrics.get("reposts", 0))
        replies = float(metrics.get("replies", 0))
        impressions = float(metrics.get("impressions", 0))

        # freshness bonus — recent topics get a visibility multiplier
        age_h = topic.age_hours
        freshness = 1.4 if age_h < 0.5 else (1.2 if age_h < 1 else (1.0 if age_h < 3 else 0.8))

        # traction multiplier — topics with strong engagement are worth more
        traction = 1.0
        if likes >= 50 or reposts >= 20:
            traction = 1.3
        elif likes >= 15 or reposts >= 8:
            traction = 1.15
        elif likes >= 5 or reposts >= 3:
            traction = 1.05

        multiplier = freshness * traction * weight_multiplier

        # apply multiplier to metrics so downstream scorers see boosted numbers
        metrics["likes"] = likes * multiplier
        metrics["reposts"] = reposts * multiplier
        metrics["replies"] = replies * multiplier
        metrics["impressions"] = max(impressions * multiplier, impressions)

        boosted.append(
            Topic(
                topic_id=topic.topic_id,
                author_handle=topic.author_handle,
                title=topic.title,
                text=topic.text,
                created_at=topic.created_at,
                tags=topic.tags,
                metrics=metrics,
            )
        )
    return boosted


# Trend opportunity scoring signals
_TREND_CRYPTO_SIGNALS = [
    "bitcoin", "btc", "sol", "solana", "eth", "ethereum", "memecoin", "meme coin",
    "liquidity", "liq", "volume", "chart", "etf", "rotation", "holders", "wallet",
    "narrative", "runner", "pump", "bonding", "migration", "trenches",
]
_TREND_MACRO_SIGNALS = [
    "fed", "cpi", "inflation", "tariff", "sanction", "recession", "yields",
    "dollar", "rate", "geopolitical", "war", "collapse", "bank",
]
_TREND_TECH_AI_SIGNALS = [
    "ai", "agent", "llm", "gpt", "openai", "claude", "gemini", "nvidia",
    "compute", "gpu", "inference", "model", "robot", "agi", "deep seek",
]
_TREND_MEME_SIGNALS = [
    "lmao", "lol", "gm", "wagmi", "ngmi", "based", "cope", "degen",
    "pepe", "wojak", "casino", "aping", "100x", "trenches",
]


def score_trend_opportunity(topic: Topic, attention_policy: dict | None = None) -> float:
    """
    Score a topic for Venum engagement upside.

    Higher score = stronger opportunity. Returns a float score.

    Factors:
    - Subject relevance (crypto / macro / tech-AI / meme)
    - Visibility potential (engagement metrics)
    - Freshness (how recent)
    - Whether the post has an open angle Venum can engage with
    - Tracked account boost (from attention_policy)
    """
    text = topic.combined_text.lower()
    metrics = topic.metrics or {}
    likes = float(metrics.get("likes", 0))
    reposts = float(metrics.get("reposts", 0))
    replies = float(metrics.get("replies", 0))
    impressions = float(metrics.get("impressions", 0))

    score = 10.0

    # Subject relevance — any one bucket scores
    if any(s in text for s in _TREND_CRYPTO_SIGNALS):
        score += 14.0
    if any(s in text for s in _TREND_MACRO_SIGNALS):
        score += 10.0
    if any(s in text for s in _TREND_TECH_AI_SIGNALS):
        score += 10.0
    if any(s in text for s in _TREND_MEME_SIGNALS):
        score += 7.0

    # Freshness bonus
    age_h = topic.age_hours
    if age_h < 0.5:
        score += 15.0
    elif age_h < 1:
        score += 10.0
    elif age_h < 3:
        score += 5.0
    elif age_h > 6:
        score -= 8.0

    # Engagement / visibility
    if likes >= 100 or impressions >= 500:
        score += 18.0
    elif likes >= 30 or impressions >= 100:
        score += 12.0
    elif likes >= 10 or impressions >= 50:
        score += 7.0
    elif likes >= 3:
        score += 3.0

    if reposts >= 20:
        score += 10.0
    elif reposts >= 5:
        score += 5.0

    if replies >= 10:
        score += 8.0
    elif replies >= 2:
        score += 4.0

    # Open angle signals — easier for Venum to enter
    if "?" in text:
        score += 7.0
    if any(s in text for s in ["hot take", "what do you", "thoughts", "am i", "unpopular opinion", "agree"]):
        score += 5.0

    # Tracked account boost from policy
    if attention_policy:
        boosts = attention_policy.get("tracked_account_boosts", {})
        score += float(boosts.get(topic.author_handle, 0.0) or 0.0)

    return round(score, 2)


def _parse_datetime(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _tags_from_text(text: str) -> list[str]:
    tag_bank = [
        "bitcoin",
        "btc",
        "sol",
        "solana",
        "eth",
        "ethereum",
        "liq",
        "liquidity",
        "flow",
        "rotation",
        "volume",
        "chart",
        "etf",
        "headline",
        "macro",
        "fed",
        "cpi",
        "narrative",
        "meme",
        "memecoin",
        "trenches",
    ]
    return [tag for tag in tag_bank if tag in text]
