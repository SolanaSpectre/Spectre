from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from venum_standalone.models import Topic
from venum_standalone.narrative_radar import build_narrative_radar_report


def check(name, condition, detail=""):
    if condition:
        print(f"  [PASS] {name}")
        return True
    print(f"  [FAIL] {name} {detail}")
    return False


def topic(topic_id, author, text, likes=0, replies=0):
    return Topic(
        topic_id=topic_id,
        author_handle=author,
        title="",
        text=text,
        created_at=datetime.now(timezone.utc),
        tags=[],
        metrics={"likes": likes, "replies": replies, "reposts": 0},
    )


def main():
    print("=== NARRATIVE RADAR TESTS ===")
    passed = 0
    total = 0

    topics = [
        topic("1", "alpha1", "snapshot soon reply wallet for $FROG", likes=10, replies=3),
        topic("2", "alpha2", "snapshot soon wallets ready $FROG", likes=6, replies=2),
        topic("3", "walletdropper", "new meta forming around agent token", likes=5, replies=1),
    ]
    previous = {"emerging_narratives": [{"key": "phrase:snapshot soon", "mentions": 1}]}
    watchlist = {"observations": [{"author_handle": "walletdropper"}]}
    report = build_narrative_radar_report(
        topics,
        query_names=["prelaunch_language"],
        previous_report=previous,
        social_wallet_watchlist=watchlist,
        top_n=5,
    )
    labels = {item["label"]: item for item in report["emerging_narratives"]}

    total += 1
    passed += check("detect repeated phrase", "snapshot soon" in labels and labels["snapshot soon"]["mentions"] == 2, labels)

    total += 1
    passed += check("compute velocity from previous snapshot", labels["snapshot soon"]["velocity_delta"] == 1, labels.get("snapshot soon"))

    total += 1
    passed += check("detect ticker", "$FROG" in labels and labels["$FROG"]["unique_authors"] == 2, labels)

    total += 1
    passed += check("mark wallet-linked author overlap", labels["agent token"]["linked_wallet_author_count"] == 1, labels.get("agent token"))

    print(f"\n{passed}/{total} passed, {total - passed} failed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
