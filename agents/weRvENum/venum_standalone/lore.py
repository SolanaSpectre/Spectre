from __future__ import annotations

import json
import random
from datetime import datetime
from pathlib import Path

from .paths import runtime_file


LORE_MEMORY_PATH = runtime_file("lore_memory.json")


def load_lore_memory(path: Path | None = None) -> dict:
    target = path or LORE_MEMORY_PATH
    if not target.exists():
        return {"spoodee_posts": []}
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except Exception:
        return {"spoodee_posts": []}


def save_lore_memory(state: dict, path: Path | None = None) -> None:
    target = path or LORE_MEMORY_PATH
    target.write_text(json.dumps(state, indent=2), encoding="utf-8")


def can_post_spoodee_today(policy: dict, memory: dict, now: datetime | None = None) -> bool:
    spoodee_policy = policy.get("spoodee_policy") or {}
    if not spoodee_policy.get("enabled", False):
        return False
    now = now or datetime.now().astimezone()
    max_posts = int(spoodee_policy.get("max_lore_posts_per_day", 1) or 1)
    today = now.date().isoformat()
    recent = [item for item in memory.get("spoodee_posts", []) if str(item.get("date") or "") == today]
    return len(recent) < max_posts


def should_inject_spoodee(policy: dict, memory: dict, seed_hint: str = "") -> bool:
    if not can_post_spoodee_today(policy, memory):
        return False
    spoodee_policy = policy.get("spoodee_policy") or {}
    chance = float(spoodee_policy.get("lore_chance_per_generation", 0.18) or 0.18)
    seed = f"{datetime.now().date().isoformat()}::{seed_hint}"
    rng = random.Random(seed)
    return rng.random() <= chance


def record_spoodee_post(text: str, path: Path | None = None) -> None:
    state = load_lore_memory(path)
    today = datetime.now().astimezone().date().isoformat()
    posts = [item for item in state.get("spoodee_posts", []) if item.get("text") != text]
    posts.insert(0, {"date": today, "text": text})
    state["spoodee_posts"] = posts[:50]
    save_lore_memory(state, path)


def spoodee_post_candidates(persona_rules: dict) -> list[str]:
    lore = persona_rules.get("lore") or {}
    base_lines = list(lore.get("spoodee_lines") or [])
    drafts = [
        "spoodee agn\n\nsame web same lie",
        "we smell spoodee nearby\n\nmarkit get sticky",
        "same spoodee chapter\n\nsame clown silk",
        "spoodee make noise\n\nreal pattern still win",
        "spoodee luk loud\n\ntruth luk ugly on em",
    ]
    for line in base_lines:
        drafts.append(f"{line}\n\nwe rember")
    seen = []
    for draft in drafts:
        if draft not in seen:
            seen.append(draft)
    return seen[:8]
