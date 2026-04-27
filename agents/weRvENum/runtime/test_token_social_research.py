from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from venum_standalone.models import Topic
from venum_standalone.token_social_research import build_token_queries, build_token_social_report


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
    print("=== TOKEN SOCIAL RESEARCH TESTS ===")
    passed = 0
    total = 0

    queries = build_token_queries(mint="CA123", ticker="$FROG", name="Frog Run")
    total += 1
    passed += check("build capped token query hooks", [q["name"] for q in queries] == ["mint", "ticker_cash", "ticker_plain", "name"], queries)

    total += 1
    passed += check("ticker cash query requires crypto context", "(sol OR solana OR pump" in queries[1]["query"], queries[1])

    topics = [
        topic("1", "alpha1", "aped $FROG early chart cooking CA123", likes=10, replies=4),
        topic("2", "alpha2", "frog run volume coming", likes=3, replies=2),
        topic("3", "walletdropper", "holding $FROG wallet 11111111111111111111111111111111", likes=1, replies=1),
    ]
    watchlist = {"observations": [{"author_handle": "walletdropper"}]}
    report = build_token_social_report(
        topics,
        mint="CA123",
        ticker="FROG",
        name="Frog Run",
        query_names=["mint", "ticker_cash"],
        social_wallet_watchlist=watchlist,
    )

    total += 1
    passed += check("count token mention channels", report["mentions"]["mint"] == 1 and report["mentions"]["ticker"] == 3 and report["mentions"]["name"] == 1, report["mentions"])

    total += 1
    passed += check("detect wallet-linked author", report["linked_wallet_author_count"] == 1 and "social_wallet_overlap" in report["signals"], report)

    total += 1
    passed += check("produce actionable status", report["status"] in {"early_social_pickup", "strong_social_pickup"}, report["status"])

    no_context = build_token_social_report(
        [topic("4", "random", "ADL is in the news", likes=10, replies=2)],
        ticker="ADL",
    )
    total += 1
    passed += check("penalize no crypto context ticker collision", "no_crypto_context_detected" in no_context["risks"], no_context)

    print(f"\n{passed}/{total} passed, {total - passed} failed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
