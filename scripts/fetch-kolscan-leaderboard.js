const fs = require('fs');
const path = require('path');

const KOLSCAN_LEADERBOARD_URL = 'https://kolscan.io/leaderboard';
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'wallet-watchlists');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'kolscan-leaderboard.json');

function decodeKolscanValue(value) {
  if (!value || value === 'null') {
    return null;
  }

  return value
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\u002F/g, '/')
    .replace(/\\\\/g, '\\');
}

function extractLeaderboardEntries(html) {
  const entryPattern = /\{\\"wallet_address\\":\\"([^"]+)\\",\\"name\\":(null|\\"([^"]*)\\")\,\\"pfp\\":(?:null|\\"[^"]*\\")\,\\"telegram\\":(null|\\"([^"]*)\\")\,\\"twitter\\":(null|\\"([^"]*)\\")\,\\"transactions\\":\[\]\}/g;
  const entries = [];

  for (const match of html.matchAll(entryPattern)) {
    entries.push({
      wallet_address: match[1],
      name: decodeKolscanValue(match[3]),
      telegram: decodeKolscanValue(match[5]),
      twitter: decodeKolscanValue(match[7])
    });
  }

  if (entries.length === 0) {
    throw new Error('Could not extract Kolscan leaderboard entries from HTML');
  }

  return entries;
}

function normalizeWallet(entry, rank) {
  const walletAddress = entry.wallet_address || entry.walletAddress || entry.address;
  if (!walletAddress) {
    return null;
  }

  return {
    rank,
    walletAddress,
    name: entry.name || null,
    twitter: entry.twitter || null,
    telegram: entry.telegram || null,
    pfp: entry.pfp || null,
    source: 'kolscan_leaderboard',
    fetchedAt: new Date().toISOString()
  };
}

async function fetchLeaderboardHtml() {
  const response = await fetch(KOLSCAN_LEADERBOARD_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Kolscan request failed with status ${response.status}`);
  }

  return response.text();
}

async function main() {
  const html = await fetchLeaderboardHtml();
  const rawEntries = extractLeaderboardEntries(html);
  const wallets = rawEntries
    .map((entry, index) => normalizeWallet(entry, index + 1))
    .filter(Boolean);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const payload = {
    source: KOLSCAN_LEADERBOARD_URL,
    fetchedAt: new Date().toISOString(),
    count: wallets.length,
    wallets
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Saved ${wallets.length} Kolscan leaderboard wallets to ${OUTPUT_PATH}`);
  wallets.slice(0, 10).forEach((wallet) => {
    console.log(`#${wallet.rank} ${wallet.name || 'unknown'} ${wallet.walletAddress}`);
  });
}

main().catch((error) => {
  console.error(`Failed to fetch Kolscan leaderboard: ${error.message}`);
  process.exit(1);
});
