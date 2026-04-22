from __future__ import annotations

import re
from datetime import datetime, timezone

from .models import Topic
from .memory import MemoryStore

# ---------------------------------------------------------------------------
# Room context signals
# ---------------------------------------------------------------------------

_SERIOUS_SIGNALS = [
    "liquidated", "crash", "rekt", "down", "dump", "regulation", "sec", "ban",
    "arrest", "hack", "exploit", "rug", "fed", "cpi", "inflation", "recession",
    "war", "tariff", "sanction", "contagion", "bankrupt", "seized", "emergency",
]
_JOKING_SIGNALS = [
    "lmao", "lol", "haha", "bruh", "bro", "lmfao", "kek", "gm", "ngmi",
    "wen", "ser", "fren", "based", "cringe", "cope", "seethe", "ratio",
    "ngl", "fr fr", "no cap", "mid", "shill",
]
_DUNKING_SIGNALS = [
    "wrong", "aged poorly", "called it", "told you", "still believe", "imagine",
    "remind me", "prediction", "copium", "delusional", "clown", "anon",
    "delete this", "you missed",
]
_EUPHORIC_SIGNALS = [
    "ath", "all time high", "mooning", "parabolic", "going crazy", "insane",
    "pumping", "sending it", "up only", "szn", "bull", "ripping", "flying",
    "wagmi", "we're back", "season",
]
_COPING_SIGNALS = [
    "still holding", "long term", "just hodl", "trust the process", "patience",
    "diamond hands", "fundamentals", "believe", "its fine", "not selling",
    "zoom out", "accumulate", "bags",
]
_MEME_SIGNALS = [
    "meme", "pepe", "doge", "shib", "wojak", "chad", "virgin", "touching grass",
    "internet culture", "trenches", "casino", "aping", "degen", "100x",
    "gem", "send it", "probably nothing",
]
_NEWS_SIGNALS = [
    "breaking", "just in", "report", "confirmed", "announced", "sources say",
    "exclusive", "developing", "update", "official", "statement", "bloomberg",
    "wsj", "reuters", "coindesk", "the block",
]

_WORD_RE = re.compile(r"[a-z0-9']+")


def _hit_count(text: str, signals: list[str]) -> int:
    return sum(1 for s in signals if s in text)


def classify_room_context(topic: Topic, attention_policy: dict | None = None) -> str:
    """
    Classify the room mood for a given topic.

    Returns one of: serious, joking, dunking, euphoric, coping, meme, news, neutral
    """
    text = topic.text.lower().strip()
    metrics = topic.metrics or {}
    replies = float(metrics.get("replies", 0))
    reposts = float(metrics.get("reposts", 0))
    likes = float(metrics.get("likes", 0))

    scores: dict[str, float] = {
        "serious": float(_hit_count(text, _SERIOUS_SIGNALS)),
        "joking": float(_hit_count(text, _JOKING_SIGNALS)),
        "dunking": float(_hit_count(text, _DUNKING_SIGNALS)),
        "euphoric": float(_hit_count(text, _EUPHORIC_SIGNALS)),
        "coping": float(_hit_count(text, _COPING_SIGNALS)),
        "meme": float(_hit_count(text, _MEME_SIGNALS)),
        "news": float(_hit_count(text, _NEWS_SIGNALS)),
    }

    # boost joking if high reply/repost velocity (crowd piling on = joking or dunking)
    if replies >= 20 or reposts >= 15:
        scores["joking"] += 1.0
        scores["dunking"] += 0.5

    # boost news if question mark absent and strong metrics
    if "?" not in text and likes >= 50:
        scores["news"] += 0.5

    best = max(scores, key=lambda k: scores[k])
    if scores[best] == 0:
        return "neutral"
    return best


# ---------------------------------------------------------------------------
# Engagement type decision
# ---------------------------------------------------------------------------

def choose_engagement_type(
    topic: Topic,
    room_context: str,
    memory: MemoryStore,
    attention_policy: dict | None = None,
) -> str:
    """
    Decide how Venum should engage.

    Returns: 'reply', 'quote', or 'silence'

    Priority: silence > quote > reply
    We only reply or quote when there's real upside and no suppression.
    """
    if should_suppress(topic, memory):
        return "silence"

    text = topic.text.lower().strip()
    metrics = topic.metrics or {}
    likes = float(metrics.get("likes", 0))
    replies = float(metrics.get("replies", 0))
    reposts = float(metrics.get("reposts", 0))
    impressions = float(metrics.get("impressions", 0))

    # Hard silence: promo / low signal bait with no traction
    if likes < 2 and replies == 0 and impressions < 30:
        return "silence"

    # Silence on pure news dumps with no opinion angle for Venum
    if room_context == "news" and likes < 10 and "?" not in text:
        return "silence"

    # Quote when topic has high visibility and Venum can add a distinct angle
    # High reposts = the content is spreading = quote gets more eyeballs
    if reposts >= 20 and detect_narrative_relevance(topic):
        return "quote"

    # Quote when dunking room — Venum commenting from outside the thread
    if room_context == "dunking" and reposts >= 10:
        return "quote"

    # Default to reply for everything else with traction
    if likes >= 3 or replies >= 1 or impressions >= 20:
        return "reply"

    return "silence"


# ---------------------------------------------------------------------------
# Tone selection
# ---------------------------------------------------------------------------

def select_tone(room_context: str, topic: Topic) -> str:
    """
    Select a tone bias for draft generation.

    Returns one of: sharp, funny, ominous, roast
    This biases the prompt — the model still generates freely.
    Not a template selector.
    """
    text = topic.text.lower()
    metrics = topic.metrics or {}
    likes = float(metrics.get("likes", 0))

    if room_context == "joking" or room_context == "meme":
        return "funny"

    if room_context == "dunking":
        # high-like dunks = roast territory; low engagement = stay sharp
        return "roast" if likes >= 15 else "sharp"

    if room_context == "serious":
        # serious market events = ominous Venum mode works well
        return "ominous"

    if room_context == "euphoric":
        # bull euphoria — Venum stays measured and pattern-aware, not hype
        return "sharp"

    if room_context == "coping":
        # bagholders coping = gentle roast or ominous
        return "ominous"

    if room_context == "news":
        return "sharp"

    # neutral default — vary by topic age
    if topic.age_hours < 1:
        return "sharp"
    return "ominous"


# ---------------------------------------------------------------------------
# Narrative relevance detection
# ---------------------------------------------------------------------------

# Recurring crypto narrative keywords — if topic hits these it's part of a bigger story
_NARRATIVE_KEYWORDS = [
    # macro
    "fed", "rate cut", "rate hike", "cpi", "inflation", "recession", "tariff",
    "sanctions", "dollar", "yields", "liquidity",
    # crypto cycles
    "halving", "cycle", "bull run", "bear market", "rotation", "season",
    "narrative", "meta", "ath", "all time high",
    # institutional
    "etf", "blackrock", "fidelity", "institutional", "adoption", "custody",
    "coinbase", "binance", "sec", "regulation",
    # solana-specific
    "solana", "sol", "jito", "mev", "migration", "pump.fun", "bonding curve",
    # ai / tech
    "ai", "agent", "llm", "compute", "gpu", "nvidia", "openai", "gpt",
    "model", "inference",
    # high-signal social
    "elon", "saylor", "vitalik", "anatoly",
]


def detect_narrative_relevance(topic: Topic) -> bool:
    """
    Lightweight check: is this topic part of an active ongoing narrative?

    True when:
    - topic hits known recurring narrative keywords
    - AND topic has meaningful engagement (not a one-off obscure post)
    - AND topic is fresh (< 6 hours old)

    Not a heavy analytics system. Just practical signal.
    """
    text = topic.text.lower()
    combined = (topic.combined_text or "").lower()
    metrics = topic.metrics or {}
    likes = float(metrics.get("likes", 0))
    reposts = float(metrics.get("reposts", 0))
    impressions = float(metrics.get("impressions", 0))

    keyword_hits = sum(1 for kw in _NARRATIVE_KEYWORDS if kw in combined)
    if keyword_hits == 0:
        return False

    # Needs at least some traction to be part of a real narrative
    has_traction = likes >= 5 or reposts >= 3 or impressions >= 50
    if not has_traction:
        return False

    # Freshness: narrative matters most when it's happening now
    if topic.age_hours > 6:
        return False

    return True


# ---------------------------------------------------------------------------
# Anti-bot suppression
# ---------------------------------------------------------------------------

def should_suppress(topic: Topic, memory: MemoryStore) -> bool:
    """
    Anti-bot guardrail. Return True if Venum should stay silent.

    Checks:
    - Author overused (already engaged recently)
    - Topic already seen / replied to
    - Recent engagement mode too repetitive
    """
    # Already replied to this exact topic
    if memory.topic_seen(topic.topic_id):
        return True

    # Author overused
    if memory.is_author_overused(topic.author_handle):
        return True

    return False
