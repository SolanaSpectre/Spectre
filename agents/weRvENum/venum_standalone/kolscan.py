from __future__ import annotations

import json
import re
from pathlib import Path

import requests


KOLSCAN_LEADERBOARD_URL = "https://kolscan.io/leaderboard"
X_LINK_RE = re.compile(r"https?://x\.com/([A-Za-z0-9_]+)\\?")
ACCOUNT_HREF_RE = re.compile(r'href="/account/([^\?"/]+)\?timeframe=(\d+)"')
NAME_RE = re.compile(r'<h1 style="font-size:20px;line-height:1;font-weight:550">([^<]+)</h1>')
WALLET_SHORT_RE = re.compile(r'<p class="cursor-pointer remove-mobile">([^<]+)</p>')
WINLOSS_RE = re.compile(r'<p style="color:var\(--buy-color\);margin-right:2px">(\d+)</p>/<p style="color:var\(--sell-color\);margin-left:2px">(\d+)</p>')
PROFIT_RE = re.compile(r'<div class="leaderboard_totalProfitNum__[^"]+" style="color:var\(--buy-color\)"><h1>([+-])([0-9.]+)<!-- --> Sol</h1><h1>\(<!-- -->\$([0-9,\.]+)')
BLOCK_SPLIT = '<div class="leaderboard_leaderboardUser__'


def fetch_kolscan_usernames(limit: int = 25) -> list[str]:
    response = requests.get(KOLSCAN_LEADERBOARD_URL, timeout=30)
    response.raise_for_status()
    html = response.text
    usernames = []
    seen = set()
    for handle in X_LINK_RE.findall(html):
        normalized = handle.strip()
        if not normalized:
            continue
        lowered = normalized.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        usernames.append(normalized)
        if len(usernames) >= limit:
            break
    return usernames


def fetch_kolscan_leaderboard_entries(limit: int = 20) -> list[dict]:
    response = requests.get(KOLSCAN_LEADERBOARD_URL, timeout=30)
    response.raise_for_status()
    html = response.text
    usernames = fetch_kolscan_usernames(limit=500)
    entries = []
    blocks = html.split(BLOCK_SPLIT)[1:]
    for index, block in enumerate(blocks):
        account_match = ACCOUNT_HREF_RE.search(block)
        name_match = NAME_RE.search(block)
        wallet_short_match = WALLET_SHORT_RE.search(block)
        winloss_match = WINLOSS_RE.search(block)
        profit_match = PROFIT_RE.search(block)
        if not all([account_match, name_match, wallet_short_match, winloss_match, profit_match]):
            continue
        username = usernames[index] if index < len(usernames) else ""
        wallet, timeframe = account_match.groups()
        sol_sign, sol_profit_raw, usd_profit_raw = profit_match.groups()
        wins_raw, losses_raw = winloss_match.groups()
        sol_profit = float(f"{sol_sign}{sol_profit_raw}")
        usd_profit = float(usd_profit_raw.replace(",", ""))
        wins = int(wins_raw)
        losses = int(losses_raw)
        total = wins + losses
        winrate = (wins / total) if total else 0.0
        entries.append(
            {
                "rank": index + 1,
                "display_name": name_match.group(1).strip(),
                "username": username,
                "wallet": wallet,
                "wallet_short": wallet_short_match.group(1).strip(),
                "timeframe": int(timeframe),
                "wins": wins,
                "losses": losses,
                "winrate": round(winrate, 3),
                "sol_profit": sol_profit,
                "usd_profit": usd_profit,
                "kolscan_account_url": f"https://kolscan.io/account/{wallet}?timeframe={timeframe}",
                "x_url": f"https://x.com/{username}" if username else "",
            }
        )
        if len(entries) >= limit:
            break
    return entries


def merge_tracked_accounts(path: Path, usernames: list[str]) -> dict:
    existing = {"accounts": []}
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            existing = {"accounts": []}

    rows = existing.get("accounts") or []
    seen = {str(item.get("username") or "").strip().lower() for item in rows if str(item.get("username") or "").strip()}

    for username in usernames:
        if username.lower() in seen:
            continue
        rows.append(
            {
                "username": username,
                "weight": 1.0,
                "notes": "bootstrapped from kolscan leaderboard",
            }
        )
        seen.add(username.lower())

    payload = {"accounts": rows}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload
