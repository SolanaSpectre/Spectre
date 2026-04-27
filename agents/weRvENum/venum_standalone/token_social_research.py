from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from pathlib import Path
from typing import Any

from .models import Topic
from .social_wallet_intel import extract_wallet_addresses


PROMO_SPAM_PATTERNS = [
    "join our telegram",
    "vip signals",
    "1000x",
    "guaranteed",
    "airdrop ongoing",
    "free money",
]
HUMAN_SIGNAL_PATTERNS = [
    "bought",
    "aped",
    "holding",
    "dev",
    "cto",
    "chart",
    "volume",
    "runner",
    "watching",
    "cooking",
    "launch",
    "bonding",
]
CRYPTO_CONTEXT_PATTERNS = [
    "sol",
    "solana",
    "pump",
    "pumpfun",
    "pump.fun",
    "memecoin",
    "crypto",
    "token",
    "coin",
    "chart",
    "ca",
    "contract",
    "dex",
    "volume",
    "liquidity",
    "bonding",
    "wallet",
]


def build_token_queries(mint: str = "", ticker: str = "", name: str = "") -> list[dict[str, str]]:
    queries = []
    mint = str(mint or "").strip()
    ticker = _clean_ticker(ticker)
    name = str(name or "").strip()

    if mint:
        queries.append({"name": "mint", "query": f'"{mint}" -is:retweet lang:en'})
    if ticker:
        queries.append({"name": "ticker_cash", "query": f'"${ticker}" (sol OR solana OR pump OR memecoin OR crypto OR token OR chart OR ca OR contract) -is:retweet lang:en'})
        queries.append({"name": "ticker_plain", "query": f'"{ticker}" (sol OR pump OR memecoin OR crypto OR token OR chart) -is:retweet lang:en'})
    if name:
        escaped = name.replace('"', '')
        queries.append({"name": "name", "query": f'"{escaped}" (sol OR pump OR memecoin OR crypto OR token OR chart) -is:retweet lang:en'})
    return queries


def build_token_social_report(
    topics: list[Topic],
    *,
    mint: str = "",
    ticker: str = "",
    name: str = "",
    query_names: list[str] | None = None,
    social_wallet_watchlist: dict[str, Any] | None = None,
    max_samples: int = 10,
) -> dict[str, Any]:
    ticker = _clean_ticker(ticker)
    wallet_handles = _wallet_handles(social_wallet_watchlist or {})
    mint_mentions = 0
    ticker_mentions = 0
    name_mentions = 0
    unique_authors = set()
    linked_wallet_authors = set()
    wallet_mentions = 0
    promo_spam_count = 0
    human_signal_count = 0
    crypto_context_count = 0
    total_likes = 0.0
    total_replies = 0.0
    total_reposts = 0.0
    samples = []

    for topic in topics:
        text = topic.text or ""
        text_lower = text.lower()
        unique_authors.add(topic.author_handle.lower())
        if topic.author_handle.lower() in wallet_handles:
            linked_wallet_authors.add(topic.author_handle)
        if mint and mint.lower() in text_lower:
            mint_mentions += 1
        if ticker and (_mentions_ticker(text, ticker)):
            ticker_mentions += 1
        if name and name.lower() in text_lower:
            name_mentions += 1
        wallet_mentions += len(extract_wallet_addresses(text))
        if any(pattern in text_lower for pattern in PROMO_SPAM_PATTERNS):
            promo_spam_count += 1
        if any(pattern in text_lower for pattern in HUMAN_SIGNAL_PATTERNS):
            human_signal_count += 1
        if any(pattern in text_lower for pattern in CRYPTO_CONTEXT_PATTERNS):
            crypto_context_count += 1
        total_likes += float(topic.metrics.get("likes", 0) or 0)
        total_replies += float(topic.metrics.get("replies", 0) or 0)
        total_reposts += float(topic.metrics.get("reposts", 0) or 0)
        samples.append(
            {
                "topic_id": topic.topic_id,
                "author_handle": topic.author_handle,
                "text": _clip(text, 220),
                "metrics": topic.metrics,
                "age_hours": round(topic.age_hours, 2),
                "matched": _matched_fields(text, mint=mint, ticker=ticker, name=name),
            }
        )

    mentions_total = len(topics)
    unique_author_count = len(unique_authors)
    social_score = (
        min(mentions_total, 50) * 4
        + unique_author_count * 9
        + min(total_likes, 120) * 0.3
        + min(total_replies, 80) * 0.55
        + min(total_reposts, 60) * 0.65
        + linked_wallet_authors.__len__() * 10
        + wallet_mentions * 4
        + human_signal_count * 5
        + crypto_context_count * 6
        - promo_spam_count * 8
    )
    if unique_author_count <= 1 and mentions_total >= 3:
        social_score *= 0.55
    if mentions_total > 0 and crypto_context_count == 0:
        social_score *= 0.25
    social_score = round(max(0.0, min(social_score, 100.0)), 2)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "venum_token_social_research",
        "token": {
            "mint": mint or None,
            "ticker": ticker or None,
            "name": name or None,
        },
        "query_names": query_names or [],
        "social_score": social_score,
        "status": _status_for_score(social_score, unique_author_count, promo_spam_count),
        "mentions": {
            "total": mentions_total,
            "mint": mint_mentions,
            "ticker": ticker_mentions,
            "name": name_mentions,
        },
        "unique_authors": unique_author_count,
        "linked_wallet_author_count": len(linked_wallet_authors),
        "wallet_mentions": wallet_mentions,
        "human_signal_count": human_signal_count,
        "crypto_context_count": crypto_context_count,
        "promo_spam_count": promo_spam_count,
        "metrics": {
            "likes": round(total_likes, 2),
            "replies": round(total_replies, 2),
            "reposts": round(total_reposts, 2),
        },
        "signals": _signals(mint_mentions, ticker_mentions, name_mentions, unique_author_count, linked_wallet_authors, wallet_mentions, human_signal_count, crypto_context_count),
        "risks": _risks(unique_author_count, promo_spam_count, mentions_total, crypto_context_count),
        "sample_posts": sorted(samples, key=lambda row: _sample_score(row), reverse=True)[:max_samples],
    }


def write_token_social_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def _clean_ticker(value: str) -> str:
    return str(value or "").strip().replace("$", "").upper()


def _mentions_ticker(text: str, ticker: str) -> bool:
    if not ticker:
        return False
    pattern = re.compile(rf"(?<![A-Za-z0-9_])\$?{re.escape(ticker)}(?![A-Za-z0-9_])", re.IGNORECASE)
    return bool(pattern.search(text or ""))


def _matched_fields(text: str, *, mint: str, ticker: str, name: str) -> list[str]:
    matches = []
    lower = (text or "").lower()
    if mint and mint.lower() in lower:
        matches.append("mint")
    if ticker and _mentions_ticker(text, ticker):
        matches.append("ticker")
    if name and name.lower() in lower:
        matches.append("name")
    return matches


def _wallet_handles(watchlist: dict[str, Any]) -> set[str]:
    return {
        str(item.get("author_handle") or "").strip().lower()
        for item in watchlist.get("observations") or []
        if str(item.get("author_handle") or "").strip()
    }


def _status_for_score(score: float, unique_authors: int, promo_spam_count: int) -> str:
    if score >= 70 and unique_authors >= 5:
        return "strong_social_pickup"
    if score >= 45 and unique_authors >= 3:
        return "early_social_pickup"
    if promo_spam_count >= max(3, unique_authors):
        return "promo_spam_cluster"
    if score > 0:
        return "thin_social_trace"
    return "no_social_trace"


def _signals(mint_mentions: int, ticker_mentions: int, name_mentions: int, unique_authors: int, linked_wallet_authors: set[str], wallet_mentions: int, human_signal_count: int, crypto_context_count: int) -> list[str]:
    signals = []
    if mint_mentions:
        signals.append("contract_address_found_on_x")
    if ticker_mentions:
        signals.append("ticker_found_on_x")
    if name_mentions:
        signals.append("name_found_on_x")
    if unique_authors >= 5:
        signals.append("multi_author_pickup")
    if linked_wallet_authors:
        signals.append("social_wallet_overlap")
    if wallet_mentions:
        signals.append("wallet_breadcrumbs_in_posts")
    if human_signal_count >= 3:
        signals.append("human_trading_language_present")
    if crypto_context_count:
        signals.append("crypto_context_present")
    return signals


def _risks(unique_authors: int, promo_spam_count: int, mentions_total: int, crypto_context_count: int) -> list[str]:
    risks = []
    if unique_authors <= 1 and mentions_total > 1:
        risks.append("single_source_repetition")
    if promo_spam_count:
        risks.append("promo_spam_present")
    if mentions_total > 0 and unique_authors <= 2:
        risks.append("needs_more_independent_authors")
    if mentions_total > 0 and crypto_context_count == 0:
        risks.append("no_crypto_context_detected")
    return risks


def _sample_score(sample: dict[str, Any]) -> float:
    metrics = sample.get("metrics") or {}
    return float(metrics.get("likes", 0) or 0) + float(metrics.get("replies", 0) or 0) * 2 + float(metrics.get("reposts", 0) or 0) * 2


def _clip(text: str, max_len: int) -> str:
    text = " ".join(str(text or "").split())
    if len(text) <= max_len:
        return text
    return text[: max_len - 3].rstrip() + "..."
