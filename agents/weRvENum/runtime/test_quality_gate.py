import json
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from venum_standalone.models import Topic
from venum_standalone.persona import PersonaEngine
from venum_standalone.x_integration import candidate_is_usable, choose_best_candidate


rules = json.loads(pathlib.Path("config/persona_rules.json").read_text(encoding="utf-8"))
persona = PersonaEngine(rules)
topic = Topic(
    topic_id="quality-test",
    author_handle="testacct",
    title="",
    text="bitcoin liquidity rotation got ugly after fed headline",
    created_at=datetime.now(timezone.utc),
    tags=["bitcoin", "liquidity", "macro"],
    metrics={"likes": 100, "replies": 10, "reposts": 5},
)

cases = [
    ("dats a gud point ppl always talkin bout", False),
    ("dis one smell like top dat one smell like", False),
    ("bitcoin liq move first\n\nheadline jus explain late", True),
]

print("=== QUALITY GATE TESTS ===")
passed = 0
for text, expected in cases:
    decision = choose_best_candidate(topic, [text], persona)
    best = decision["best"]
    got = candidate_is_usable(best)
    ok = got == expected
    marker = "PASS" if ok else "FAIL"
    if ok:
        passed += 1
    print(f"  [{marker}] {repr(text)} expected={expected} got={got} score={best['score']}")

print(f"\n{passed}/{len(cases)} passed")
