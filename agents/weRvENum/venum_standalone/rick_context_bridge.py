from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from .models import Topic
from .paths import PROJECT_DIR


DEFAULT_RICK_CONTEXT = PROJECT_DIR.parent.parent / "data" / "rick-context" / "latest.json"

_CAMEL_RE = re.compile(r"(?<!^)(?=[A-Z])")


def load_rick_context(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def topics_from_rick_context(path: Path) -> tuple[list[Topic], dict]:
    payload = load_rick_context(path)
    topics: list[Topic] = []
    for row in payload.get("messages") or []:
        text = str(row.get("text") or "").strip()
        if not text or text.startswith("/"):
            continue

        report_type = str(row.get("reportType") or "").strip()
        categories = [str(item).strip() for item in (row.get("categories") or []) if str(item).strip()]
        tags = _rick_tags(report_type, categories, text, row.get("metrics") or {})
        created_at = _parse_datetime(str(row.get("date") or ""))

        topics.append(
            Topic(
                topic_id=f"rick-{row.get('messageId')}",
                author_handle="rick",
                title=_humanize(report_type or categories[0] if categories else "rick update").lower(),
                text=_normalize_text(text).lower(),
                created_at=created_at,
                tags=tags,
                metrics=_scalar_metrics(row.get("metrics") or {}),
            )
        )

    return topics, payload


def source_window_from_rick_context(payload: dict) -> str:
    generated_at = str(payload.get("generatedAt") or "").strip()
    report_counts = payload.get("reportTypeCounts") or {}
    counts = ", ".join(f"{key}:{value}" for key, value in sorted(report_counts.items()))
    if generated_at and counts:
        return f"rick snapshot {generated_at} ({counts})"
    if generated_at:
        return f"rick snapshot {generated_at}"
    return "rick snapshot"


def _rick_tags(report_type: str, categories: list[str], text: str, metrics: dict) -> list[str]:
    tags: list[str] = []
    for item in [report_type, *categories]:
        normalized = _tagify(_humanize(item))
        if normalized:
            tags.append(normalized)

    report_lower = report_type.lower()
    text_lower = text.lower()

    if report_lower == "marketstats":
        tags.extend(["market", "launchpads", "volume", "conditions"])
    elif report_lower == "runnersreport":
        tags.extend(["runners", "continuation", "momentum"])
    elif report_lower == "trendingdex":
        tags.extend(["dex", "trending", "rotation"])
    elif report_lower == "trendingpump":
        tags.extend(["pump", "trending", "smallcaps"])
    elif report_lower == "burpleaderboard":
        tags.extend(["fast", "intraday", "volatility", "leaderboard"])
    elif report_lower == "holdercontext":
        tags.extend(["holders", "concentration"])
    elif report_lower == "deployerhistory":
        tags.extend(["deployer", "history"])

    if "pumpfun" in text_lower:
        tags.append("pumpfun")
    if "bags" in text_lower:
        tags.append("bags")
    if "meteora" in text_lower:
        tags.append("meteora")
    if "moonshot" in text_lower:
        tags.append("moonshot")
    if "letsbonk" in text_lower:
        tags.append("letsbonk")
    if "global" in text_lower and "runners" in text_lower:
        tags.append("global")
    if "median ath" in text_lower:
        tags.append("ath")
    if "dominance" in text_lower:
        tags.append("dominance")
    if "average gain" in text_lower or "median:" in text_lower:
        tags.append("gains")
    if "tokens tracked" in text_lower:
        tags.append("breadth")

    mention_caps = metrics.get("mentionCapsKUsd")
    if isinstance(mention_caps, list) and mention_caps:
        max_cap = max(float(item) for item in mention_caps if _is_number(item))
        if max_cap >= 100:
            tags.append("expansion")
        if max_cap <= 50:
            tags.append("smallcaps")

    return list(dict.fromkeys(tag for tag in tags if tag))


def _scalar_metrics(metrics: dict) -> dict[str, float]:
    scalars: dict[str, float] = {}
    mention_caps = metrics.get("mentionCapsKUsd")
    numeric_caps = [float(item) for item in mention_caps if _is_number(item)] if isinstance(mention_caps, list) else []

    for key, value in metrics.items():
        if _is_number(value):
            scalars[str(key)] = float(value)

    if numeric_caps:
        scalars["mentionCapsMaxKUsd"] = max(numeric_caps)
        scalars["mentionCapsMinKUsd"] = min(numeric_caps)
        scalars["mentionCapsCount"] = float(len(numeric_caps))

    return scalars


def _humanize(value: str) -> str:
    if not value:
        return ""
    return _CAMEL_RE.sub(" ", value).replace("_", " ").strip()


def _tagify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _parse_datetime(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _normalize_text(text: str) -> str:
    return (
        text.replace("ðŸ’Š", "pump ")
        .replace("ðŸ”¥", "hot ")
        .replace("ðŸš€", "market ")
        .replace("â‡¢", " -> ")
        .replace("â†³", " -> ")
        .replace("â‹…", " | ")
        .replace("ãƒ»", " | ")
        .replace("âœ…", "ok ")
        .replace("ðŸ†", "leaderboard ")
        .replace("ðŸŒ", "sol ")
    )


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)
