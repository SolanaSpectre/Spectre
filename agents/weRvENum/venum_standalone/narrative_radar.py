from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import re
from pathlib import Path
from typing import Any

from .models import Topic
from .social_wallet_intel import extract_wallet_addresses


WORD_RE = re.compile(r"[a-z0-9][a-z0-9_'.-]*")
TICKER_RE = re.compile(r"(?<![A-Za-z0-9_])\$([A-Za-z][A-Za-z0-9_]{1,12})(?![A-Za-z0-9_])")
URL_RE = re.compile(r"https?://\S+|t\.co/\S+", re.IGNORECASE)
STOPWORDS = {
    "about", "after", "again", "against", "also", "because", "been", "before", "being",
    "below", "between", "bitcoin", "crypto", "degen", "does", "dont", "every", "from",
    "have", "here", "just", "like", "memecoin", "more", "much", "need", "only", "pump",
    "really", "should", "solana", "still", "that", "their", "them", "there", "these",
    "they", "this", "token", "with", "what", "when", "where", "will", "your",
    "http", "https", "t.co", "tco", "com",
}
PHRASE_PATTERNS = [
    "snapshot soon",
    "reply wallet",
    "drop wallets",
    "drop your wallet",
    "wallets ready",
    "something coming",
    "cooking something",
    "cooking a coin",
    "ca soon",
    "ticker soon",
    "launching soon",
    "new meta",
    "next meta",
    "everyone is sleeping",
    "nobody is talking",
    "first mover",
    "early to",
    "bonding curve",
    "cto soon",
    "volume coming",
    "ai agent",
    "agent token",
    "onchain ai",
]


def build_narrative_radar_report(
    topics: list[Topic],
    *,
    query_names: list[str],
    previous_report: dict[str, Any] | None = None,
    social_wallet_watchlist: dict[str, Any] | None = None,
    top_n: int = 12,
) -> dict[str, Any]:
    previous_report = previous_report or {}
    previous_terms = _previous_term_counts(previous_report)
    wallet_handles = _wallet_handles(social_wallet_watchlist or {})

    term_buckets: dict[str, dict[str, Any]] = {}
    for topic in topics:
        for signal in _signals_from_topic(topic):
            bucket = term_buckets.setdefault(signal["key"], _empty_bucket(signal))
            bucket["mentions"] += 1
            bucket["unique_authors"].add(topic.author_handle.lower())
            bucket["authors"].add(topic.author_handle)
            bucket["topic_ids"].add(topic.topic_id)
            bucket["sample_texts"].append(_clip(topic.text, 180))
            bucket["metrics"]["likes"] += float(topic.metrics.get("likes", 0) or 0)
            bucket["metrics"]["replies"] += float(topic.metrics.get("replies", 0) or 0)
            bucket["metrics"]["reposts"] += float(topic.metrics.get("reposts", 0) or 0)
            if topic.author_handle.lower() in wallet_handles:
                bucket["linked_wallet_authors"].add(topic.author_handle)
            bucket["wallet_mentions"] += len(extract_wallet_addresses(topic.text))

    narratives = []
    for key, bucket in term_buckets.items():
        previous = previous_terms.get(key, 0)
        unique_authors = len(bucket["unique_authors"])
        metrics = bucket["metrics"]
        velocity_delta = bucket["mentions"] - previous
        velocity_ratio = round(bucket["mentions"] / max(previous, 1), 2)
        score = (
            bucket["mentions"] * 8
            + unique_authors * 12
            + min(metrics["likes"], 100) * 0.35
            + min(metrics["replies"], 80) * 0.55
            + min(metrics["reposts"], 60) * 0.65
            + max(velocity_delta, 0) * 10
            + len(bucket["linked_wallet_authors"]) * 8
            + bucket["wallet_mentions"] * 5
        )
        if bucket["kind"] == "phrase":
            score += 8
        if unique_authors <= 1 and bucket["mentions"] <= 2:
            score *= 0.55

        narratives.append(
            {
                "key": key,
                "label": bucket["label"],
                "kind": bucket["kind"],
                "score": round(score, 2),
                "mentions": bucket["mentions"],
                "previous_mentions": previous,
                "velocity_delta": velocity_delta,
                "velocity_ratio": velocity_ratio,
                "unique_authors": unique_authors,
                "linked_wallet_author_count": len(bucket["linked_wallet_authors"]),
                "wallet_mentions": bucket["wallet_mentions"],
                "authors": sorted(bucket["authors"])[:10],
                "linked_wallet_authors": sorted(bucket["linked_wallet_authors"])[:10],
                "sample_texts": _unique(bucket["sample_texts"])[:4],
                "metrics": {name: round(value, 2) for name, value in metrics.items()},
                "risk": _risk_label(bucket, unique_authors),
            }
        )

    narratives.sort(key=lambda item: (item["score"], item["velocity_delta"], item["unique_authors"]), reverse=True)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "venum_narrative_radar",
        "query_names": query_names,
        "topic_count": len(topics),
        "emerging_narratives": narratives[:top_n],
        "stats": {
            "candidate_terms": len(narratives),
            "wallet_linked_handles": len(wallet_handles),
        },
    }


def read_previous_report(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_radar_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def _signals_from_topic(topic: Topic) -> list[dict[str, str]]:
    text = URL_RE.sub(" ", topic.text.lower())
    signals = []
    for phrase in PHRASE_PATTERNS:
        if phrase in text:
            signals.append({"kind": "phrase", "label": phrase, "key": f"phrase:{phrase}"})
    for ticker in TICKER_RE.findall(topic.text):
        upper = ticker.upper()
        if upper in {"BTC", "ETH", "SOL", "USD", "USDC", "USDT"}:
            continue
        signals.append({"kind": "ticker", "label": f"${upper}", "key": f"ticker:{upper}"})
    for phrase in _ngrams(text):
        if any(pattern == phrase for pattern in PHRASE_PATTERNS):
            continue
        signals.append({"kind": "term", "label": phrase, "key": f"term:{phrase}"})
    return _dedupe_signals(signals)


def _ngrams(text: str) -> list[str]:
    text = URL_RE.sub(" ", text)
    words = [
        word.strip(".'-")
        for word in WORD_RE.findall(text)
        if _usable_word(word.strip(".'-"))
    ]
    phrases = []
    for size in (2, 3):
        for index in range(0, max(len(words) - size + 1, 0)):
            phrase = " ".join(words[index:index + size])
            if any(token in STOPWORDS for token in phrase.split()):
                continue
            phrases.append(phrase)
    counts = Counter(phrases)
    return [phrase for phrase, count in counts.items() if count >= 1][:20]


def _usable_word(word: str) -> bool:
    if len(word) < 4:
        return False
    if word in STOPWORDS:
        return False
    if word.startswith("http") or word in {"t.co", "tco"}:
        return False
    if re.fullmatch(r"[0-9]+", word):
        return False
    return True


def _dedupe_signals(signals: list[dict[str, str]]) -> list[dict[str, str]]:
    seen = set()
    deduped = []
    for signal in signals:
        if signal["key"] in seen:
            continue
        seen.add(signal["key"])
        deduped.append(signal)
    return deduped


def _empty_bucket(signal: dict[str, str]) -> dict[str, Any]:
    return {
        "key": signal["key"],
        "label": signal["label"],
        "kind": signal["kind"],
        "mentions": 0,
        "unique_authors": set(),
        "authors": set(),
        "topic_ids": set(),
        "sample_texts": [],
        "linked_wallet_authors": set(),
        "wallet_mentions": 0,
        "metrics": defaultdict(float),
    }


def _previous_term_counts(report: dict[str, Any]) -> dict[str, int]:
    counts = {}
    for item in report.get("emerging_narratives") or []:
        key = str(item.get("key") or "")
        if key:
            counts[key] = int(item.get("mentions") or 0)
    return counts


def _wallet_handles(watchlist: dict[str, Any]) -> set[str]:
    handles = set()
    for item in watchlist.get("observations") or []:
        handle = str(item.get("author_handle") or "").strip().lower()
        if handle:
            handles.add(handle)
    return handles


def _risk_label(bucket: dict[str, Any], unique_authors: int) -> str:
    label = bucket["label"].lower()
    if "giveaway" in label or "drop wallet" in label or "reply wallet" in label:
        return "airdrop_or_wallet_farm_noise"
    if unique_authors <= 1:
        return "single_source_watch_only"
    if bucket["wallet_mentions"] > 0:
        return "wallet_breadcrumb_present"
    return "needs_confirmation"


def _unique(values: list[str]) -> list[str]:
    seen = set()
    out = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _clip(text: str, max_len: int) -> str:
    text = " ".join(text.split())
    if len(text) <= max_len:
        return text
    return text[: max_len - 3].rstrip() + "..."
