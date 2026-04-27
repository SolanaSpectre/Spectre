from __future__ import annotations

from datetime import datetime, timezone
import json
import re
from pathlib import Path
from typing import Any


BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58_VALUES = {char: idx for idx, char in enumerate(BASE58_ALPHABET)}
SOLANA_ADDRESS_RE = re.compile(r"(?<![1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])")


def extract_solana_addresses(text: str) -> list[str]:
    addresses = []
    seen = set()
    for match in SOLANA_ADDRESS_RE.finditer(text or ""):
        candidate = match.group(1)
        if candidate in seen:
            continue
        if _is_solana_pubkey(candidate):
            addresses.append(candidate)
            seen.add(candidate)
    return addresses


def tweets_from_search_payload(payload: dict[str, Any], *, query_name: str = "", source_type: str = "") -> list[dict[str, Any]]:
    users = {}
    for user in ((payload.get("includes") or {}).get("users") or []):
        users[str(user.get("id") or "")] = {
            "handle": str(user.get("username") or "unknown"),
            "name": str(user.get("name") or ""),
        }

    tweets = []
    for row in payload.get("data") or []:
        author_id = str(row.get("author_id") or "")
        metrics = row.get("public_metrics") or {}
        tweets.append(
            {
                "tweet_id": str(row.get("id") or ""),
                "conversation_id": str(row.get("conversation_id") or row.get("id") or ""),
                "author_id": author_id,
                "author_handle": users.get(author_id, {}).get("handle", "unknown"),
                "author_name": users.get(author_id, {}).get("name", ""),
                "created_at": str(row.get("created_at") or ""),
                "text": str(row.get("text") or "").strip(),
                "metrics": {
                    "likes": int(metrics.get("like_count", 0) or 0),
                    "replies": int(metrics.get("reply_count", 0) or 0),
                    "reposts": int(metrics.get("retweet_count", 0) or 0),
                    "quotes": int(metrics.get("quote_count", 0) or 0),
                },
                "query_name": query_name,
                "source_type": source_type,
            }
        )
    return tweets


def observations_from_tweets(tweets: list[dict[str, Any]], *, seed_tweet: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    observations = []
    seed_tweet = seed_tweet or {}
    for tweet in tweets:
        addresses = extract_solana_addresses(str(tweet.get("text") or ""))
        for address in addresses:
            observations.append(
                {
                    "source_type": tweet.get("source_type") or seed_tweet.get("source_type") or "social_wallet_observation",
                    "author_handle": tweet.get("author_handle") or "unknown",
                    "wallet": address,
                    "source_tweet_id": tweet.get("tweet_id") or "",
                    "seed_tweet_id": seed_tweet.get("tweet_id") or tweet.get("tweet_id") or "",
                    "seed_author_handle": seed_tweet.get("author_handle") or tweet.get("author_handle") or "unknown",
                    "conversation_id": tweet.get("conversation_id") or seed_tweet.get("conversation_id") or "",
                    "query_name": tweet.get("query_name") or seed_tweet.get("query_name") or "",
                    "confidence": _confidence_for_observation(tweet, seed_tweet),
                    "observed_at": datetime.now(timezone.utc).isoformat(),
                    "tweet_created_at": tweet.get("created_at") or "",
                    "source_text": _clip(str(tweet.get("text") or ""), 280),
                    "seed_text": _clip(str(seed_tweet.get("text") or ""), 220),
                    "public_context": "public_x_post",
                }
            )
    return observations


def merge_wallet_watchlist(path: Path, observations: list[dict[str, Any]]) -> dict[str, Any]:
    existing: dict[str, Any] = {}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    merged = list(existing.get("observations") or [])
    seen = {
        (
            str(item.get("wallet") or ""),
            str(item.get("author_handle") or "").lower(),
            str(item.get("source_tweet_id") or ""),
        )
        for item in merged
    }
    added = 0
    for item in observations:
        key = (
            str(item.get("wallet") or ""),
            str(item.get("author_handle") or "").lower(),
            str(item.get("source_tweet_id") or ""),
        )
        if key in seen:
            continue
        merged.append(item)
        seen.add(key)
        added += 1

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "description": "Public X wallet observations for internal watch-only research.",
        "guardrails": [
            "public posts only",
            "internal research only",
            "no harassment or personal accusations",
            "wallet behavior commentary should target trades, not people",
        ],
        "stats": {
            "total_observations": len(merged),
            "added_observations": added,
            "unique_wallets": len({str(item.get("wallet") or "") for item in merged if item.get("wallet")}),
            "unique_handles": len({str(item.get("author_handle") or "").lower() for item in merged if item.get("author_handle")}),
        },
        "observations": merged,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def tracker_export_from_watchlist(watchlist: dict[str, Any]) -> list[dict[str, Any]]:
    by_wallet: dict[str, dict[str, Any]] = {}
    for item in watchlist.get("observations") or []:
        wallet = str(item.get("wallet") or "")
        if not wallet:
            continue
        entry = by_wallet.setdefault(
            wallet,
            {
                "wallet": wallet,
                "source": "venum_social_wallet_intel",
                "mode": "watch_only",
                "handles": [],
                "source_types": [],
                "first_seen_at": item.get("observed_at") or "",
                "last_seen_at": item.get("observed_at") or "",
            },
        )
        handle = str(item.get("author_handle") or "")
        source_type = str(item.get("source_type") or "")
        if handle and handle not in entry["handles"]:
            entry["handles"].append(handle)
        if source_type and source_type not in entry["source_types"]:
            entry["source_types"].append(source_type)
        observed_at = str(item.get("observed_at") or "")
        if observed_at:
            if not entry["first_seen_at"] or observed_at < entry["first_seen_at"]:
                entry["first_seen_at"] = observed_at
            if observed_at > entry["last_seen_at"]:
                entry["last_seen_at"] = observed_at
    return sorted(by_wallet.values(), key=lambda row: row["wallet"])


def write_tracker_export(path: Path, watchlist: dict[str, Any]) -> dict[str, Any]:
    wallets = tracker_export_from_watchlist(watchlist)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "watch_only",
        "wallet_count": len(wallets),
        "wallets": wallets,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def _is_solana_pubkey(value: str) -> bool:
    try:
        decoded = _b58decode(value)
    except ValueError:
        return False
    return len(decoded) == 32


def _b58decode(value: str) -> bytes:
    number = 0
    for char in value:
        if char not in BASE58_VALUES:
            raise ValueError(f"invalid base58 char: {char}")
        number = number * 58 + BASE58_VALUES[char]

    leading_zeroes = len(value) - len(value.lstrip("1"))
    decoded = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    return (b"\x00" * leading_zeroes) + decoded


def _confidence_for_observation(tweet: dict[str, Any], seed_tweet: dict[str, Any]) -> float:
    text = f"{tweet.get('text') or ''} {seed_tweet.get('text') or ''}".lower()
    confidence = 0.7
    if any(token in text for token in ["drop", "wallet", "addy", "address"]):
        confidence += 0.12
    if any(token in text for token in ["giveaway", "drip", "send sol"]):
        confidence += 0.08
    if any(token in text for token in ["launch", "whitelist", "snapshot", "ca soon", "ticker"]):
        confidence += 0.08
    return min(round(confidence, 2), 0.98)


def _clip(text: str, max_len: int) -> str:
    text = " ".join(text.split())
    if len(text) <= max_len:
        return text
    return text[: max_len - 3].rstrip() + "..."
