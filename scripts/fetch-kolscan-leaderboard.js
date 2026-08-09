'use strict';

const KOLSCAN_LEADERBOARD_URL = 'https://kolscan.io/leaderboard';
const TIMEFRAME_LABELS = Object.freeze({
  1: 'daily',
  7: 'weekly',
  30: 'monthly'
});

function compact(value, decimals = 8) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function extractFlightPayloads(html) {
  const payloads = [];
  const pattern = /<script>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;
  for (const match of String(html || '').matchAll(pattern)) {
    try {
      const tuple = JSON.parse(match[1]);
      if (typeof tuple?.[1] === 'string') payloads.push(tuple[1]);
    } catch {
      // Ignore unrelated or non-JSON flight script payloads.
    }
  }
  return payloads;
}

function extractJsonArrayAfterKey(text, key) {
  const marker = `"${key}":`;
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  return null;
}

function extractLeaderboardEntries(html) {
  const payloads = extractFlightPayloads(html);
  // Next.js may split one React Flight record across several push calls.
  const entries = extractJsonArrayAfterKey(payloads.join(''), 'initLeaderboard');
  if (Array.isArray(entries) && entries.length > 0) return entries;
  throw new Error('Could not extract current Kolscan initLeaderboard rows from HTML');
}

function normalizeLeaderboard(entries, fetchedAt = new Date().toISOString()) {
  const byTimeframe = new Map();
  for (const entry of entries || []) {
    const days = Number(entry?.timeframe);
    const walletAddress = String(entry?.wallet_address || '').trim();
    if (!walletAddress || !TIMEFRAME_LABELS[days]) continue;
    if (!byTimeframe.has(days)) byTimeframe.set(days, []);
    byTimeframe.get(days).push(entry);
  }

  const normalizedEntries = [];
  for (const [days, rows] of byTimeframe.entries()) {
    const sorted = [...rows].sort((left, right) => Number(right.profit || 0) - Number(left.profit || 0));
    sorted.forEach((entry, index) => {
      const wins = Math.max(0, Number(entry.wins || 0));
      const losses = Math.max(0, Number(entry.losses || 0));
      const tradeCount = wins + losses;
      normalizedEntries.push({
        timeframe: TIMEFRAME_LABELS[days],
        timeframeDays: days,
        rank: index + 1,
        walletAddress: String(entry.wallet_address).trim(),
        name: entry.name || null,
        twitter: entry.twitter || null,
        telegram: entry.telegram || null,
        reportedProfitSol: compact(entry.profit, 8),
        wins,
        losses,
        tradeCount,
        winRate: tradeCount > 0 ? compact(wins / tradeCount, 4) : null,
        source: 'kolscan_leaderboard',
        fetchedAt
      });
    });
  }
  return normalizedEntries;
}

function buildWalletWatchlist(normalizedEntries, fetchedAt = new Date().toISOString()) {
  const walletsByAddress = new Map();
  for (const entry of normalizedEntries) {
    if (!walletsByAddress.has(entry.walletAddress)) {
      walletsByAddress.set(entry.walletAddress, {
        walletAddress: entry.walletAddress,
        name: entry.name,
        twitter: entry.twitter,
        telegram: entry.telegram,
        source: 'kolscan_leaderboard',
        fetchedAt,
        leaderboardAppearances: []
      });
    }
    const wallet = walletsByAddress.get(entry.walletAddress);
    wallet.name ||= entry.name;
    wallet.twitter ||= entry.twitter;
    wallet.telegram ||= entry.telegram;
    wallet.leaderboardAppearances.push({
      timeframe: entry.timeframe,
      timeframeDays: entry.timeframeDays,
      rank: entry.rank,
      reportedProfitSol: entry.reportedProfitSol,
      wins: entry.wins,
      losses: entry.losses,
      tradeCount: entry.tradeCount,
      winRate: entry.winRate
    });
  }

  return Array.from(walletsByAddress.values())
    .map((wallet) => {
      wallet.leaderboardAppearances.sort((left, right) => left.timeframeDays - right.timeframeDays);
      const bestRank = Math.min(...wallet.leaderboardAppearances.map((row) => row.rank));
      const maxReportedTrades = Math.max(...wallet.leaderboardAppearances.map((row) => row.tradeCount));
      return {
        rank: bestRank,
        bestRank,
        leaderboardTimeframeCount: wallet.leaderboardAppearances.length,
        maxReportedTrades,
        analysisPriorityScore: wallet.leaderboardAppearances.length * 1000
          + Math.max(0, 101 - bestRank) * 10
          + Math.min(maxReportedTrades, 100),
        ...wallet
      };
    })
    .sort((left, right) => (
      Number(right.analysisPriorityScore) - Number(left.analysisPriorityScore)
      || Number(left.bestRank) - Number(right.bestRank)
    ));
}

function buildPayload(entries, fetchedAt = new Date().toISOString()) {
  const normalizedEntries = normalizeLeaderboard(entries, fetchedAt);
  if (normalizedEntries.length === 0) {
    throw new Error('Kolscan current leaderboard contained no supported timeframe rows');
  }
  const wallets = buildWalletWatchlist(normalizedEntries, fetchedAt);
  const timeframes = {};
  for (const [daysText, label] of Object.entries(TIMEFRAME_LABELS)) {
    const timeframeEntries = normalizedEntries.filter((entry) => entry.timeframe === label);
    timeframes[label] = {
      timeframeDays: Number(daysText),
      available: timeframeEntries.length > 0,
      entryCount: timeframeEntries.length,
      entries: timeframeEntries
    };
  }

  return {
    schemaVersion: 2,
    source: KOLSCAN_LEADERBOARD_URL,
    fetchedAt,
    methodology: {
      sourceField: 'server_rendered_initLeaderboard',
      leaderboardClaimsAreDiscoveryOnly: true,
      profileHydrationOrderUsedAsRank: false,
      unavailableTimeframesAreNotInferred: true
    },
    coverage: {
      availableTimeframes: Object.entries(timeframes)
        .filter(([, value]) => value.available)
        .map(([label]) => label),
      unavailableTimeframes: Object.entries(timeframes)
        .filter(([, value]) => !value.available)
        .map(([label]) => label)
    },
    count: wallets.length,
    entryCount: normalizedEntries.length,
    timeframes,
    wallets
  };
}

async function main() {
  throw new Error([
    'Automated Kolscan fetching is disabled because Kolscan Terms of Use prohibit bots,',
    'automation, scraping, and data mining. Use the manually curated wallet watchlist at',
    'data/wallet-watchlists/manual-kol-wallets.json with Helius instead.'
  ].join(' '));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Failed to fetch Kolscan leaderboard: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  TIMEFRAME_LABELS,
  buildPayload,
  buildWalletWatchlist,
  extractFlightPayloads,
  extractJsonArrayAfterKey,
  extractLeaderboardEntries,
  normalizeLeaderboard
};
