require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const DEFAULT_WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'wallet-watchlists', 'kolscan-leaderboard.json');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'wallet-analysis');

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function getHeliusApiKey() {
  return process.env.HELIUS_PARSE_API_KEY || '';
}

function resolveRepoPath(filePath, fallback) {
  const target = filePath || fallback;
  return path.isAbsolute(target) ? target : path.join(__dirname, '..', target);
}

function normalizeSourceLabel(value) {
  return String(value || 'kolscan')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'wallet-source';
}

function getHistoryEndpoint(walletAddress, txLimit) {
  const apiKey = getHeliusApiKey();
  const params = new URLSearchParams({
    'api-key': apiKey,
    limit: String(txLimit)
  });
  return `https://api-mainnet.helius-rpc.com/v0/addresses/${walletAddress}/transactions?${params.toString()}`;
}

async function fetchWalletHistory(walletAddress, txLimit) {
  const response = await fetch(getHistoryEndpoint(walletAddress, txLimit), {
    headers: {
      'user-agent': 'Spectre/1.0 wallet-analysis'
    }
  });

  if (!response.ok) {
    throw new Error(`Helius history request failed with status ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function safeDate(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = typeof value === 'number'
    ? (value < 10_000_000_000 ? value * 1000 : value)
    : value;

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeTransactions(wallet, transactions) {
  const typeCounts = new Map();
  const sourceCounts = new Map();
  const mintCounts = new Map();
  let swapCount = 0;
  let buyLikeCount = 0;
  let sellLikeCount = 0;
  let successCount = 0;
  let failureCount = 0;

  for (const tx of transactions) {
    const type = tx.type || 'UNKNOWN';
    const source = tx.source || 'UNKNOWN';

    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

    if (tx.transactionError) {
      failureCount += 1;
    } else {
      successCount += 1;
    }

    if (type === 'SWAP') {
      swapCount += 1;
    }

    const description = String(tx.description || '').toLowerCase();
    if (description.includes(' bought ') || description.includes(' buy ')) {
      buyLikeCount += 1;
    }
    if (description.includes(' sold ') || description.includes(' sell ')) {
      sellLikeCount += 1;
    }

    const transfers = Array.isArray(tx.tokenTransfers) ? tx.tokenTransfers : [];
    transfers.forEach((transfer) => {
      const mint = transfer.mint;
      if (!mint) {
        return;
      }
      mintCounts.set(mint, (mintCounts.get(mint) || 0) + 1);
    });
  }

  const topSources = Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([source, count]) => ({ source, count }));

  const topTypes = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([type, count]) => ({ type, count }));

  const topMints = Array.from(mintCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([mint, count]) => ({ mint, count }));

  return {
    walletAddress: wallet.walletAddress,
    name: wallet.name,
    rank: wallet.rank,
    twitter: wallet.twitter,
    telegram: wallet.telegram,
    transactionsFetched: transactions.length,
    firstSeenAt: safeDate(transactions[transactions.length - 1]?.timestamp),
    lastSeenAt: safeDate(transactions[0]?.timestamp),
    successCount,
    failureCount,
    swapCount,
    buyLikeCount,
    sellLikeCount,
    topSources,
    topTypes,
    topMints
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const walletLimit = Math.max(parseInt(args.limit || args._[0] || '25', 10), 1);
  const txLimit = Math.max(parseInt(args.txLimit || args._[1] || '100', 10), 1);
  const watchlistPath = resolveRepoPath(args.watchlist, DEFAULT_WATCHLIST_PATH);
  const sourceLabel = normalizeSourceLabel(args.sourceLabel || args['source-label'] || 'kolscan');
  const heliusApiKey = getHeliusApiKey();

  if (!heliusApiKey) {
    throw new Error('HELIUS_PARSE_API_KEY is required to analyze Kolscan wallets');
  }

  if (!fs.existsSync(watchlistPath)) {
    throw new Error(`Wallet watchlist not found at ${watchlistPath}`);
  }

  const watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
  const wallets = (watchlist.wallets || []).slice(0, walletLimit);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const summaries = [];
  for (const wallet of wallets) {
    try {
      const transactions = await fetchWalletHistory(wallet.walletAddress, txLimit);
      const summary = summarizeTransactions(wallet, transactions);
      summaries.push(summary);
      console.log(
        `Analyzed #${wallet.rank} ${wallet.name || 'unknown'} ${wallet.walletAddress} | tx=${summary.transactionsFetched} swaps=${summary.swapCount}`
      );
    } catch (error) {
      console.warn(`Failed to analyze ${wallet.walletAddress}: ${error.message}`);
      summaries.push({
        walletAddress: wallet.walletAddress,
        name: wallet.name,
        rank: wallet.rank,
        error: error.message
      });
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `${sourceLabel}-wallet-analysis-${stamp}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify({
    source: `${watchlist.source || sourceLabel}+helius_history`,
    sourceLabel,
    generatedAt: new Date().toISOString(),
    watchlistFile: watchlistPath,
    walletLimit,
    txLimit,
    count: summaries.length,
    summaries
  }, null, 2)}\n`, 'utf8');

  console.log(`Saved wallet analysis to ${outputPath}`);
}

main().catch((error) => {
  console.error(`Failed to analyze Kolscan wallets: ${error.message}`);
  process.exit(1);
});
