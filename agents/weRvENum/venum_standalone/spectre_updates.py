from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .persona import PersonaEngine


MAX_LINE_LEN = 42


def load_report_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def build_spectre_update_drafts(
    *,
    report: dict[str, Any],
    overlay: dict[str, Any],
    persona: PersonaEngine,
    limit: int = 5,
) -> dict[str, Any]:
    current_run = _as_dict(overlay.get("currentRun"))
    pre_migration = _as_dict(report.get("preMigrationPaper"))
    rechecks = _as_dict(pre_migration.get("rechecks"))
    skip_reasons = _as_dict(pre_migration.get("skipReasons"))
    watch_lane = _as_dict(report.get("watchLane"))
    top_watch = _first_dict(watch_lane.get("topWatch"))

    run_number = _clean_number(current_run.get("runNumber"), fallback="x")
    win_rate = _whole_number(current_run.get("winRatePct"))
    avg_pnl_tone = _pnl_tone(current_run.get("avgPnlSol"))
    bottleneck = _human_label(current_run.get("bottleneck") or _top_key(skip_reasons) or "paper tape")
    simulations_done = _clean_number(current_run.get("simulationsDone"), fallback="0")

    scheduled = _clean_number(rechecks.get("scheduled"), fallback="0")
    executed = _clean_number(rechecks.get("executed"), fallback="0")
    skipped = _clean_number(rechecks.get("skipped"), fallback="0")
    failed = _clean_number(rechecks.get("failed"), fallback="0")
    entries = _clean_number(pre_migration.get("entries"), fallback="0")

    drafts = [
        _join_lines(
            f"spectre paper run {run_number}",
            "",
            f"win {win_rate} pct",
            f"pnl {avg_pnl_tone} in sol",
            "",
            "no live mony touched",
        ),
        _join_lines(
            "paper cage stil locked",
            "",
            f"{scheduled} rechecks sent",
            f"{executed} came bak",
            "",
            "no live mony touched",
        ),
        _join_lines(
            "markit gave weak soup",
            "",
            f"{entries} entries",
            f"{simulations_done} sims looked",
            "",
            "paper only",
        ),
        _join_lines(
            _fit_line(bottleneck),
            "",
            "same curve lesson",
            "ape hand stay tied",
            "",
            "paper only",
        ),
    ]

    if int(_number_value(skipped)) > 0 or int(_number_value(failed)) > 0:
        drafts.append(
            _join_lines(
                "recheck lane talked bak",
                "",
                f"{skipped} stale",
                f"{failed} failed",
                "",
                "we tighten the net",
            )
        )

    if top_watch:
        symbol = _symbol(top_watch)
        curve = _whole_number(top_watch.get("curveProgress"))
        score = _whole_number(top_watch.get("score"))
        drafts.append(
            _join_lines(
                f"{symbol} got a look",
                "",
                f"curve {curve} pct",
                f"score {score}",
                "",
                "quality not enuf",
            )
        )

    rendered = []
    seen: set[str] = set()
    for text in drafts:
        normalized = text.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        rendered.append(
            {
                "text": normalized,
                "validation_errors": persona.validate(normalized),
                "char_count": len(normalized),
                "rationale": ["spectre paper report", "manual review before posting"],
            }
        )
        if len(rendered) >= max(1, limit):
            break

    return {
        "source": {
            "runNumber": run_number,
            "bottleneck": bottleneck,
            "rechecks": {
                "scheduled": _number_value(scheduled),
                "executed": _number_value(executed),
                "skipped": _number_value(skipped),
                "failed": _number_value(failed),
            },
        },
        "drafts": rendered,
    }


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _first_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                return item
    return {}


def _top_key(values: dict[str, Any]) -> str:
    if not values:
        return ""
    return str(max(values.items(), key=lambda item: _number_value(item[1]))[0])


def _number_value(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _clean_number(value: Any, *, fallback: str) -> str:
    number = _number_value(value)
    if not number and value not in (0, "0", 0.0):
        return fallback
    if number.is_integer():
        return str(int(number))
    return f"{number:.2f}".rstrip("0").rstrip(".")


def _whole_number(value: Any) -> str:
    return str(int(round(_number_value(value))))


def _pnl_tone(value: Any) -> str:
    number = _number_value(value)
    if number > 0:
        return "green"
    if number < 0:
        return "red"
    return "flat"


def _human_label(value: Any) -> str:
    label = str(value or "").strip().lower()
    label = re.sub(r"[^a-z0-9]+", " ", label)
    label = re.sub(r"\s+", " ", label).strip()
    return label or "paper tape"


def _symbol(item: dict[str, Any]) -> str:
    symbol = str(item.get("symbol") or "one ticker").strip().lower()
    symbol = re.sub(r"[^a-z0-9]+", "", symbol)
    return _fit_line(symbol or "one ticker")


def _join_lines(*lines: str) -> str:
    out = []
    for line in lines:
        if line == "":
            out.append("")
        else:
            out.append(_fit_line(line))
    return "\n".join(out).strip()


def _fit_line(text: str) -> str:
    clean = re.sub(r"\s+", " ", str(text).strip().lower())
    if len(clean) <= MAX_LINE_LEN:
        return clean
    return clean[: MAX_LINE_LEN - 1].rstrip()
