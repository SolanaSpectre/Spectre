from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class XBudgetExceeded(RuntimeError):
    pass


@dataclass(slots=True)
class XBudgetLimits:
    read_daily: int
    write_daily: int
    follow_daily: int


class XBudget:
    def __init__(self, path: Path, limits: XBudgetLimits, enabled: bool = True) -> None:
        self.path = path
        self.limits = limits
        self.enabled = enabled
        self.state = self._load()

    def consume(self, bucket: str, endpoint: str, cost: int = 1) -> None:
        if not self.enabled:
            return
        if cost <= 0:
            return
        self._roll_day()
        used_key = f"{bucket}_used"
        limit = self._limit_for(bucket)
        used = int(self.state.get(used_key, 0))
        if used + cost > limit:
            raise XBudgetExceeded(
                f"x api {bucket} budget exhausted for {endpoint}: {used}/{limit} used"
            )
        self.state[used_key] = used + cost
        calls = list(self.state.get("calls", []))
        calls.insert(
            0,
            {
                "at": datetime.now(timezone.utc).isoformat(),
                "bucket": bucket,
                "endpoint": endpoint,
                "cost": cost,
            },
        )
        self.state["calls"] = calls[:200]
        self.save()

    def status(self) -> dict[str, Any]:
        self._roll_day()
        return {
            "enabled": self.enabled,
            "day": self.state["day"],
            "read": self._bucket_status("read", self.limits.read_daily),
            "write": self._bucket_status("write", self.limits.write_daily),
            "follow": self._bucket_status("follow", self.limits.follow_daily),
            "recentCalls": self.state.get("calls", [])[:10],
        }

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.state, indent=2), encoding="utf-8")

    def _load(self) -> dict[str, Any]:
        today = _today()
        if not self.path.exists():
            return _new_state(today)
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return _new_state(today)
            data.setdefault("day", today)
            data.setdefault("read_used", 0)
            data.setdefault("write_used", 0)
            data.setdefault("follow_used", 0)
            data.setdefault("calls", [])
            return data
        except Exception:
            return _new_state(today)

    def _roll_day(self) -> None:
        today = _today()
        if self.state.get("day") == today:
            return
        self.state = _new_state(today)
        self.save()

    def _limit_for(self, bucket: str) -> int:
        if bucket == "read":
            return self.limits.read_daily
        if bucket == "write":
            return self.limits.write_daily
        if bucket == "follow":
            return self.limits.follow_daily
        raise ValueError(f"unknown x api budget bucket: {bucket}")

    def _bucket_status(self, bucket: str, limit: int) -> dict[str, int]:
        used = int(self.state.get(f"{bucket}_used", 0))
        return {"used": used, "limit": limit, "remaining": max(0, limit - used)}


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _new_state(day: str) -> dict[str, Any]:
    return {
        "day": day,
        "read_used": 0,
        "write_used": 0,
        "follow_used": 0,
        "calls": [],
    }
