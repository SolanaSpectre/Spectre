from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .models import Topic


@dataclass(slots=True)
class NarrativeSignal:
    label: str
    strength: float
    direction: str
    confidence: float
    summary: str


RISK_OFF_HINTS = {
    "war",
    "oil",
    "hormuz",
    "repo",
    "liquidity",
    "macro",
    "rates",
    "fed",
    "fear",
    "panic",
    "headline",
}

RISK_ON_HINTS = {
    "runner",
    "runners",
    "pump",
    "pump.fun",
    "breakout",
    "ath",
    "moon",
    "rotation",
    "flow",
}

SCALP_HINTS = {
    "scalp",
    "flip",
    "fast",
    "intraday",
    "volatility",
}

CURATED_SURFACE_TAGS = {
    "market_stats",
    "runners_report",
    "trending_dex",
    "trending_pump",
    "burp_leaderboard",
    "holder_context",
    "deployer_history",
}


def build_narrative_brief(topics: list[Topic], source_window: str = "") -> dict:
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    tag_counts, keyword_counts = _collect_terms(topics)
    support = _supporting_signals(topics, tag_counts, keyword_counts)
    dominant = _dominant_narratives(tag_counts, keyword_counts)
    posture = _market_posture(tag_counts, keyword_counts, dominant)
    attention = _attention_quality(topics)
    psychology = _trader_psychology(posture, tag_counts, keyword_counts)
    lane_implications = _lane_implications(posture, psychology, tag_counts, keyword_counts)
    warnings = _warnings(posture, attention)

    brief = {
        "generated_at": now,
        "source_window": source_window or "manual venum sweep",
        "market_posture": posture,
        "dominant_narratives": [asdict(signal) for signal in dominant[:3]],
        "emerging_narratives": [asdict(signal) for signal in dominant[3:5]],
        "fading_narratives": _fading_narratives(posture),
        "attention_quality": attention,
        "trader_psychology": psychology,
        "lane_implications": lane_implications,
        "supporting_signals": support,
        "warnings": warnings,
    }
    return brief


def write_brief(brief: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(brief, indent=2), encoding="utf-8")


def _collect_terms(topics: list[Topic]) -> tuple[Counter[str], Counter[str]]:
    tags = Counter()
    keywords = Counter()
    for topic in topics:
        for tag in topic.tags:
            normalized = tag.strip().lower()
            if normalized:
                tags[normalized] += 1
        for token in topic.combined_text.lower().replace("\n", " ").split():
            cleaned = token.strip(".,!?;:()[]{}\"'")
            if len(cleaned) >= 4:
                keywords[cleaned] += 1
    return tags, keywords


def _dominant_narratives(tag_counts: Counter[str], keyword_counts: Counter[str]) -> list[NarrativeSignal]:
    candidates: list[NarrativeSignal] = []
    total = max(sum(tag_counts.values()), 1)

    for label, summary in [
        ("macro stress is shaping risk appetite", "headline and macro terms are crowding the room and changing posture"),
        ("liquidity is getting more attention than pure story", "the room is talking about flow and funding more than clean belief"),
        ("fast tactical behavior is being rewarded", "crowd language suggests people want quick proof and quick exits"),
        ("runner attention is still alive", "runner language is still present enough that clean continuation can exist"),
        ("rotation is competing with conviction", "the room sounds more rotational than loyal"),
    ]:
        score = _narrative_score(label, tag_counts, keyword_counts) / total
        if score <= 0:
            continue
        candidates.append(
            NarrativeSignal(
                label=label,
                strength=min(round(score, 2), 1.0),
                direction="strengthening" if score >= 0.6 else "steady",
                confidence=min(round(0.55 + score / 2.0, 2), 0.95),
                summary=summary,
            )
        )

    if not candidates:
        candidates.append(
            NarrativeSignal(
                label="room is active but unclear",
                strength=0.4,
                direction="steady",
                confidence=0.5,
                summary="there is motion but not enough repeated signal to trust one dominant story",
            )
        )

    return sorted(candidates, key=lambda item: item.strength, reverse=True)


def _narrative_score(label: str, tag_counts: Counter[str], keyword_counts: Counter[str]) -> float:
    score = 0.0
    if "macro" in label:
        score += _sum_hits(tag_counts, keyword_counts, {"macro", "war", "oil", "hormuz", "rates", "fed", "headline"})
    if "liquidity" in label:
        score += _sum_hits(tag_counts, keyword_counts, {"liquidity", "repo", "flow", "funding"})
    if "fast tactical" in label:
        score += _sum_hits(tag_counts, keyword_counts, {"scalp", "flip", "fast", "volatility", "intraday"})
    if "runner attention" in label:
        score += _sum_hits(tag_counts, keyword_counts, {"runner", "runners", "pump", "moon", "ath"})
    if "rotation" in label:
        score += _sum_hits(tag_counts, keyword_counts, {"rotation", "flow", "sector", "attention"})
    return score


def _sum_hits(tag_counts: Counter[str], keyword_counts: Counter[str], words: set[str]) -> float:
    return float(sum(tag_counts.get(word, 0) + keyword_counts.get(word, 0) for word in words))


def _market_posture(
    tag_counts: Counter[str], keyword_counts: Counter[str], dominant: list[NarrativeSignal]
) -> dict:
    risk_off = _sum_hits(tag_counts, keyword_counts, RISK_OFF_HINTS)
    risk_on = _sum_hits(tag_counts, keyword_counts, RISK_ON_HINTS)

    if risk_off >= risk_on * 1.35 and risk_off > 0:
        label = "defensive"
        summary = "macro and liquidity stress are weighing on trader behavior more than pure greed"
        confidence = min(round(0.6 + min(risk_off / max(risk_on + 1.0, 1.0), 2.0) * 0.15, 2), 0.92)
    elif risk_on >= risk_off * 1.35 and risk_on > 0:
        label = "risk_on"
        summary = "expansion, runners, and risk appetite are leading the room"
        confidence = min(round(0.6 + min(risk_on / max(risk_off + 1.0, 1.0), 2.0) * 0.15, 2), 0.92)
    elif dominant and dominant[0].label == "room is active but unclear":
        label = "unclear"
        summary = "attention is present but the room has not settled on one reliable posture"
        confidence = 0.5
    else:
        label = "mixed"
        summary = "the room is split between opportunity and caution"
        confidence = 0.62

    return {
        "label": label,
        "confidence": confidence,
        "summary": summary,
    }


def _attention_quality(topics: list[Topic]) -> dict:
    handles = {topic.author_handle.lower() for topic in topics if topic.author_handle}
    tags = {tag for topic in topics for tag in topic.tags}
    curated_surfaces = {tag for tag in tags if tag in CURATED_SURFACE_TAGS}
    if len(handles) >= 3 and len(tags) >= 4:
        label = "cross_room"
        confidence = 0.73
        summary = "multiple accounts and repeated themes suggest the attention is not isolated to one pocket"
    elif handles == {"rick"} and len(curated_surfaces) >= 3:
        label = "curated_multi_surface"
        confidence = 0.68
        summary = "the signal comes through one scout, but it covers several distinct market surfaces instead of one narrow room"
    elif len(handles) <= 1:
        label = "one_room_only"
        confidence = 0.7
        summary = "the signal surface is narrow and may be more concentrated than organic"
    else:
        label = "organic"
        confidence = 0.62
        summary = "attention appears real but not yet broad enough to call fully cross-room"
    return {"label": label, "confidence": confidence, "summary": summary}


def _trader_psychology(
    posture: dict, tag_counts: Counter[str], keyword_counts: Counter[str]
) -> list[str]:
    states: list[str] = []
    if posture["label"] in {"defensive", "risk_off"}:
        states.extend(["defensive", "hesitant"])
    if _sum_hits(tag_counts, keyword_counts, {"runner", "pump", "ath", "moon"}) > 0:
        states.append("opportunistic")
    if _sum_hits(tag_counts, keyword_counts, SCALP_HINTS) > 0:
        states.append("bloodthirsty")
    if not states:
        states.append("bored")
    return list(dict.fromkeys(states))


def _lane_implications(
    posture: dict, psychology: list[str], tag_counts: Counter[str], keyword_counts: Counter[str]
) -> dict:
    scalp_bias = _sum_hits(tag_counts, keyword_counts, SCALP_HINTS)
    runner_bias = _sum_hits(tag_counts, keyword_counts, {"runner", "runners", "pump", "moon", "ath"})

    if posture["label"] == "defensive":
        runner_posture = "avoid_forcing"
        runner_summary = "runner quality is likely thinner and clean no-trade behavior should be trusted"
        scalper_posture = "faster_exits"
        scalper_summary = "shorter tactical moves may still work but conviction can vanish quickly"
    elif posture["label"] == "risk_on" and runner_bias >= scalp_bias:
        runner_posture = "favorable"
        runner_summary = "the room is rewarding expansion and cleaner continuation is more believable"
        scalper_posture = "selective"
        scalper_summary = "scalps can still work, but broader runner expansion may offer better conditions"
    else:
        runner_posture = "selective"
        runner_summary = "there may be trades, but marginal continuation should still be filtered hard"
        scalper_posture = "higher_fakeout_risk" if "hesitant" in psychology else "selective"
        scalper_summary = "quick moves need tighter judgment because momentum quality is mixed"

    return {
        "runner_hunter": {
            "posture": runner_posture,
            "confidence": 0.74 if posture["label"] != "unclear" else 0.55,
            "summary": runner_summary,
        },
        "scalper": {
            "posture": scalper_posture,
            "confidence": 0.72 if scalp_bias > 0 or posture["label"] != "unclear" else 0.56,
            "summary": scalper_summary,
        },
        "sniper": {
            "posture": "higher_fakeout_risk",
            "confidence": 0.7,
            "summary": "headline sensitivity and fast crowd shifts increase the chance of getting used as exit liquidity",
        },
    }


def _supporting_signals(
    topics: list[Topic], tag_counts: Counter[str], keyword_counts: Counter[str]
) -> list[dict]:
    signals: list[dict] = []
    top_tags = [tag for tag, _count in tag_counts.most_common(3)]
    if top_tags:
        signals.append(
            {
                "source": "topic_tags",
                "signal": f"repeated tags: {', '.join(top_tags)}",
                "strength": min(round(sum(tag_counts[tag] for tag in top_tags) / max(len(topics) * 3, 1), 2), 1.0),
            }
        )
    if _sum_hits(tag_counts, keyword_counts, RISK_OFF_HINTS) > 0:
        signals.append(
            {
                "source": "macro_terms",
                "signal": "macro or liquidity language is present in the room",
                "strength": 0.76,
            }
        )
    if _sum_hits(tag_counts, keyword_counts, RISK_ON_HINTS) > 0:
        signals.append(
            {
                "source": "expansion_terms",
                "signal": "runner or expansion language is still present",
                "strength": 0.68,
            }
        )
    return signals[:4]


def _warnings(posture: dict, attention: dict) -> list[str]:
    warnings = [
        "do not treat narrative posture as a direct buy or sell trigger",
        "use this brief for posture and regime context only",
    ]
    if posture["label"] in {"defensive", "mixed"}:
        warnings.append("trust selective or no-trade behavior when structure does not confirm the room story")
    if attention["label"] in {"one_room_only", "forced"}:
        warnings.append("concentrated attention can create fake confidence and should be discounted")
    return warnings


def _fading_narratives(posture: dict) -> list[dict]:
    if posture["label"] == "defensive":
        return [
            {
                "label": "broad everything-rips optimism",
                "strength": 0.35,
                "direction": "fading",
                "confidence": 0.72,
                "summary": "the room does not feel wide-open even if chatter volume remains high",
            }
        ]
    if posture["label"] == "risk_on":
        return [
            {
                "label": "macro doom dominating every trade decision",
                "strength": 0.32,
                "direction": "fading",
                "confidence": 0.68,
                "summary": "fear still exists but it is no longer the room's only organizing principle",
            }
        ]
    return []
