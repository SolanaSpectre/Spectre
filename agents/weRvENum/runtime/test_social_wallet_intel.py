from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from venum_standalone.social_wallet_intel import extract_solana_addresses, merge_wallet_watchlist, observations_from_tweets


def check(name, condition, detail=""):
    if condition:
        print(f"  [PASS] {name}")
        return True
    print(f"  [FAIL] {name} {detail}")
    return False


def main():
    print("=== SOCIAL WALLET INTEL TESTS ===")
    passed = 0
    total = 0

    text = "drop wallet 11111111111111111111111111111111 and not this fake 0OIlbadwallet"
    addresses = extract_solana_addresses(text)
    total += 1
    passed += check("extract valid system pubkey only", addresses == ["11111111111111111111111111111111"], addresses)

    tweets = [
        {
            "tweet_id": "tweet-1",
            "conversation_id": "conv-1",
            "author_handle": "walletdropper",
            "created_at": "2026-04-27T00:00:00Z",
            "text": "11111111111111111111111111111111",
            "query_name": "giveaway_wallet_threads",
            "source_type": "giveaway_wallet_thread",
        }
    ]
    observations = observations_from_tweets(tweets)
    total += 1
    passed += check("build observation from tweet", len(observations) == 1 and observations[0]["wallet"] == "11111111111111111111111111111111", observations)

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "watchlist.json"
        first = merge_wallet_watchlist(path, observations)
        second = merge_wallet_watchlist(path, observations)
        total += 1
        passed += check(
            "dedupe watchlist observations",
            first["stats"]["total_observations"] == 1 and second["stats"]["total_observations"] == 1,
            second,
        )

    print(f"\n{passed}/{total} passed, {total - passed} failed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
