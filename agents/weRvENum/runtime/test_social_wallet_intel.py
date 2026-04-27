from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from venum_standalone.social_wallet_intel import extract_evm_addresses, extract_solana_addresses, extract_wallet_addresses, merge_wallet_watchlist, observations_from_tweets


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

    evm_text = "eth addy 0x742d35Cc6634C0532925a3b844Bc454e4438f44e not 0xzzzz"
    evm_addresses = extract_evm_addresses(evm_text)
    total += 1
    passed += check("extract normalized evm address", evm_addresses == ["0x742d35cc6634c0532925a3b844bc454e4438f44e"], evm_addresses)

    mixed = extract_wallet_addresses(f"{text} {evm_text}")
    total += 1
    passed += check(
        "extract mixed chain wallet breadcrumbs",
        mixed == [
            {"chain": "solana", "address": "11111111111111111111111111111111"},
            {"chain": "evm", "address": "0x742d35cc6634c0532925a3b844bc454e4438f44e"},
        ],
        mixed,
    )

    tweets = [
        {
            "tweet_id": "tweet-1",
            "conversation_id": "conv-1",
            "author_handle": "walletdropper",
            "created_at": "2026-04-27T00:00:00Z",
            "text": "11111111111111111111111111111111 0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
            "query_name": "giveaway_wallet_threads",
            "source_type": "giveaway_wallet_thread",
        }
    ]
    observations = observations_from_tweets(tweets)
    total += 1
    passed += check(
        "build chain-labeled observations from tweet",
        len(observations) == 2 and {item["chain"] for item in observations} == {"solana", "evm"},
        observations,
    )

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "watchlist.json"
        first = merge_wallet_watchlist(path, observations)
        second = merge_wallet_watchlist(path, observations)
        total += 1
        passed += check(
            "dedupe watchlist observations",
            first["stats"]["total_observations"] == 2 and second["stats"]["total_observations"] == 2,
            second,
        )

    print(f"\n{passed}/{total} passed, {total - passed} failed")
    return 0 if passed == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
