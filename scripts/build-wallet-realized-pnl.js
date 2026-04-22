require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const WATCHLIST_PATH = path.join(REPO_ROOT, 'data', 'wallet-watchlists', 'kolscan-leaderboard.json');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'wallet-realized-pnl');
const LATEST_PATH = path.join(OUTPUT_DIR, 'latest.json');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const LAMPORTS_PER_SOL = 1_000_000_000;

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 8) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function getHeliusApiKey() {
  return process.env.HELIUS_PARSE_API_KEY || process.env.HELIUS_API_KEY || '';
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
      'user-agent': 'Spectre/1.0 wallet-realized-pnl'
    }
  });

  if (!response.ok) {
    throw new Error(`Helius history request failed with status ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function toIso(value) {
  if (value === null || value === undefined) return null;
  const normalized = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function tokenAmountFromBalanceChange(change) {
  const raw = change?.rawTokenAmount;
  if (raw && raw.tokenAmount !== undefined) {
    const amount = Number(raw.tokenAmount);
    const decimals = Number(raw.decimals || 0);
    if (Number.isFinite(amount)) return amount / (10 ** decimals);
  }
  const ui = Number(change?.uiTokenAmount?.uiAmount ?? change?.uiTokenAmount?.amount);
  return Number.isFinite(ui) ? ui : 0;
}

function tokenAmountFromTransfer(transfer) {
  const amount = Number(transfer?.tokenAmount ?? transfer?.amount);
  return Number.isFinite(amount) ? amount : 0;
}

function extractAccountDataDelta(tx, walletAddress) {
  const account = (tx.accountData || []).find((item) => item.account === walletAddress);
  if (!account) return null;

  const solDelta = Number(account.nativeBalanceChange || 0) / LAMPORTS_PER_SOL;
  const tokenDeltas = new Map();
  for (const change of account.tokenBalanceChanges || []) {
    const mint = change.mint;
    if (!mint || mint === SOL_MINT) continue;
    const amount = tokenAmountFromBalanceChange(change);
    tokenDeltas.set(mint, (tokenDeltas.get(mint) || 0) + amount);
  }

  return { solDelta, tokenDeltas };
}

function extractTransferDelta(tx, walletAddress) {
  let solDelta = 0;
  const tokenDeltas = new Map();

  for (const transfer of tx.nativeTransfers || []) {
    const amountSol = Number(transfer.amount || 0) / LAMPORTS_PER_SOL;
    if (transfer.fromUserAccount === walletAddress || transfer.fromUserAccount === walletAddress) solDelta -= amountSol;
    if (transfer.toUserAccount === walletAddress || transfer.toUserAccount === walletAddress) solDelta += amountSol;
  }

  if (tx.feePayer === walletAddress && Number.isFinite(Number(tx.fee))) {
    solDelta -= Number(tx.fee) / LAMPORTS_PER_SOL;
  }

  for (const transfer of tx.tokenTransfers || []) {
    const mint = transfer.mint;
    if (!mint || mint === SOL_MINT) continue;
    const amount = tokenAmountFromTransfer(transfer);
    if (!Number.isFinite(amount) || amount === 0) continue;

    if (transfer.fromUserAccount === walletAddress || transfer.fromTokenAccount === walletAddress) {
      tokenDeltas.set(mint, (tokenDeltas.get(mint) || 0) - amount);
    }
    if (transfer.toUserAccount === walletAddress || transfer.toTokenAccount === walletAddress) {
      tokenDeltas.set(mint, (tokenDeltas.get(mint) || 0) + amount);
    }
  }

  return { solDelta, tokenDeltas };
}

function extractWalletDelta(tx, walletAddress) {
  const accountDelta = extractAccountDataDelta(tx, walletAddress);
  if (accountDelta && accountDelta.tokenDeltas.size > 0) return accountDelta;
  return extractTransferDelta(tx, walletAddress);
}

function ensureMintPosition(walletState, mint) {
  if (!walletState.positions.has(mint)) {
    walletState.positions.set(mint, {
      mint,
      buyCount: 0,
      sellCount: 0,
      tokenBought: 0,
      tokenSold: 0,
      solSpent: 0,
      solReceived: 0,
      realizedPnlSol: 0,
      proceedsOnlySol: 0,
      proceedsOnlySellCount: 0,
      costBasisRemainingSol: 0,
      tokensRemaining: 0,
      firstTxAt: null,
      lastTxAt: null,
      txSamples: []
    });
  }
  return walletState.positions.get(mint);
}

function applyTrade(position, tx, tokenDelta, solDelta) {
  const timestamp = toIso(tx.timestamp);
  if (!position.firstTxAt || timestamp < position.firstTxAt) position.firstTxAt = timestamp;
  if (!position.lastTxAt || timestamp > position.lastTxAt) position.lastTxAt = timestamp;

  if (tokenDelta > 0 && solDelta < 0) {
    const spent = Math.abs(solDelta);
    position.buyCount += 1;
    position.tokenBought += tokenDelta;
    position.solSpent += spent;
    position.tokensRemaining += tokenDelta;
    position.costBasisRemainingSol += spent;
  } else if (tokenDelta < 0 && solDelta > 0) {
    const soldTokens = Math.abs(tokenDelta);
    const received = solDelta;
    position.sellCount += 1;
    position.tokenSold += soldTokens;
    position.solReceived += received;

    if (position.tokensRemaining <= 0 || position.costBasisRemainingSol <= 0) {
      // The buy happened outside the fetched window. Count proceeds, but do not
      // pretend we know realized profit without cost basis.
      position.proceedsOnlySol += received;
      position.proceedsOnlySellCount += 1;
    } else {
      const averageCost = position.costBasisRemainingSol / position.tokensRemaining;
      const costRemoved = Math.min(position.costBasisRemainingSol, averageCost * soldTokens);
      position.realizedPnlSol += received - costRemoved;
      position.costBasisRemainingSol = Math.max(0, position.costBasisRemainingSol - costRemoved);
    }

    position.tokensRemaining = Math.max(0, position.tokensRemaining - soldTokens);
  } else {
    return;
  }

  if (position.txSamples.length < 8) {
    position.txSamples.push({
      signature: tx.signature || null,
      timestamp,
      type: tx.type || null,
      source: tx.source || null,
      tokenDelta: compact(tokenDelta, 6),
      solDelta: compact(solDelta, 8),
      description: String(tx.description || '').slice(0, 220)
    });
  }
}

function summarizePosition(position) {
  const soldCostBasis = position.solSpent - position.costBasisRemainingSol;
  const hasKnownCostBasisSell = position.sellCount > 0 && soldCostBasis > 0;
  const realizedReturnPct = soldCostBasis > 0 ? position.realizedPnlSol / soldCostBasis : null;
  let status = 'OPEN_OR_UNSOLD';
  if (position.proceedsOnlySellCount > 0 && !hasKnownCostBasisSell) {
    status = 'PROCEEDS_ONLY_COST_BASIS_UNKNOWN';
  } else if (hasKnownCostBasisSell) {
    status = position.tokensRemaining > 0 ? 'PARTIALLY_REALIZED' : 'REALIZED';
  }

  return {
    mint: position.mint,
    buyCount: position.buyCount,
    sellCount: position.sellCount,
    tokenBought: compact(position.tokenBought, 4),
    tokenSold: compact(position.tokenSold, 4),
    solSpent: compact(position.solSpent, 8),
    solReceived: compact(position.solReceived, 8),
    realizedPnlSol: hasKnownCostBasisSell ? compact(position.realizedPnlSol, 8) : null,
    realizedReturnPct: compact(realizedReturnPct, 6),
    proceedsOnlySol: compact(position.proceedsOnlySol, 8),
    proceedsOnlySellCount: position.proceedsOnlySellCount,
    tokensRemaining: compact(position.tokensRemaining, 4),
    costBasisRemainingSol: compact(position.costBasisRemainingSol, 8),
    status,
    firstTxAt: position.firstTxAt,
    lastTxAt: position.lastTxAt,
    txSamples: position.txSamples
  };
}

function summarizeWallet(wallet, transactions) {
  const walletState = {
    wallet,
    positions: new Map(),
    ignoredSwapLikeTxs: 0
  };

  // Oldest first keeps average-cost realized PnL sane.
  const ordered = [...transactions].sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  for (const tx of ordered) {
    if (tx.transactionError) continue;
    const { solDelta, tokenDeltas } = extractWalletDelta(tx, wallet.walletAddress);
    if (!Number.isFinite(solDelta) || tokenDeltas.size === 0) {
      if (tx.type === 'SWAP') walletState.ignoredSwapLikeTxs += 1;
      continue;
    }

    for (const [mint, tokenDelta] of tokenDeltas.entries()) {
      if (!Number.isFinite(tokenDelta) || Math.abs(tokenDelta) === 0) continue;
      if (Math.abs(solDelta) < 1e-9) continue;
      const position = ensureMintPosition(walletState, mint);
      applyTrade(position, tx, tokenDelta, solDelta);
    }
  }

  const positions = Array.from(walletState.positions.values())
    .map(summarizePosition)
    .filter((position) => position.buyCount > 0 || position.sellCount > 0)
    .sort((a, b) => Math.abs(Number(b.realizedPnlSol || 0)) - Math.abs(Number(a.realizedPnlSol || 0)));

  const realized = positions.filter((position) => position.sellCount > 0);
  const knownRealized = positions.filter((position) => position.realizedPnlSol !== null && position.sellCount > 0);
  const winners = knownRealized.filter((position) => Number(position.realizedPnlSol) > 0);
  const losers = knownRealized.filter((position) => Number(position.realizedPnlSol) < 0);
  const realizedPnlSol = knownRealized.reduce((sum, position) => sum + (Number(position.realizedPnlSol) || 0), 0);
  const proceedsOnlySol = positions.reduce((sum, position) => sum + (Number(position.proceedsOnlySol) || 0), 0);

  return {
    walletAddress: wallet.walletAddress,
    name: wallet.name || null,
    rank: wallet.rank || null,
    twitter: wallet.twitter || null,
    telegram: wallet.telegram || null,
    transactionsFetched: transactions.length,
    ignoredSwapLikeTxs: walletState.ignoredSwapLikeTxs,
    positionCount: positions.length,
    realizedPositionCount: knownRealized.length,
    proceedsOnlyPositionCount: realized.length - knownRealized.length,
    winners: winners.length,
    losers: losers.length,
    winRate: compact(knownRealized.length > 0 ? winners.length / knownRealized.length : null, 4),
    realizedPnlSol: compact(realizedPnlSol, 8),
    proceedsOnlySol: compact(proceedsOnlySol, 8),
    positions: positions.slice(0, 100)
  };
}

function buildMintIndex(walletSummaries) {
  const mintMap = new Map();
  for (const wallet of walletSummaries) {
    for (const position of wallet.positions || []) {
      if (!mintMap.has(position.mint)) {
        mintMap.set(position.mint, {
          mint: position.mint,
          walletCount: 0,
          realizedWalletCount: 0,
          winnerWalletCount: 0,
          loserWalletCount: 0,
          totalRealizedPnlSol: 0,
          totalProceedsOnlySol: 0,
          wallets: []
        });
      }

      const bucket = mintMap.get(position.mint);
      const pnl = Number(position.realizedPnlSol || 0);
      const proceedsOnly = Number(position.proceedsOnlySol || 0);
      bucket.walletCount += 1;
      if (position.realizedPnlSol !== null && position.sellCount > 0) bucket.realizedWalletCount += 1;
      if (position.realizedPnlSol !== null && pnl > 0) bucket.winnerWalletCount += 1;
      if (position.realizedPnlSol !== null && pnl < 0) bucket.loserWalletCount += 1;
      bucket.totalRealizedPnlSol += Number.isFinite(pnl) ? pnl : 0;
      bucket.totalProceedsOnlySol += Number.isFinite(proceedsOnly) ? proceedsOnly : 0;
      bucket.wallets.push({
        walletAddress: wallet.walletAddress,
        name: wallet.name,
        rank: wallet.rank,
        realizedPnlSol: position.realizedPnlSol,
        realizedReturnPct: position.realizedReturnPct,
        proceedsOnlySol: position.proceedsOnlySol,
        buyCount: position.buyCount,
        sellCount: position.sellCount,
        status: position.status,
        firstTxAt: position.firstTxAt,
        lastTxAt: position.lastTxAt
      });
    }
  }

  return Array.from(mintMap.values())
    .map((bucket) => ({
      ...bucket,
      totalRealizedPnlSol: compact(bucket.totalRealizedPnlSol, 8),
      totalProceedsOnlySol: compact(bucket.totalProceedsOnlySol, 8),
      wallets: bucket.wallets.sort((a, b) => (Number(b.realizedPnlSol || 0) - Number(a.realizedPnlSol || 0))).slice(0, 20)
    }))
    .sort((a, b) => Math.abs(Number(b.totalRealizedPnlSol || 0)) - Math.abs(Number(a.totalRealizedPnlSol || 0)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const walletLimit = Math.max(parseInt(args.limit || args._[0] || '10', 10), 1);
  const txLimit = Math.max(parseInt(args.txLimit || args._[1] || '100', 10), 1);
  const apiKey = getHeliusApiKey();

  if (!apiKey) {
    throw new Error('HELIUS_PARSE_API_KEY or HELIUS_API_KEY is required to build wallet realized PnL');
  }

  const watchlist = readJson(WATCHLIST_PATH, null);
  if (!watchlist || !Array.isArray(watchlist.wallets)) {
    throw new Error(`Kolscan wallet watchlist not found at ${WATCHLIST_PATH}`);
  }

  const wallets = watchlist.wallets.slice(0, walletLimit);
  const walletSummaries = [];

  for (const wallet of wallets) {
    try {
      const transactions = await fetchWalletHistory(wallet.walletAddress, txLimit);
      const summary = summarizeWallet(wallet, transactions);
      walletSummaries.push(summary);
      console.log(
        `PnL #${wallet.rank} ${wallet.name || 'unknown'} | tx=${summary.transactionsFetched} positions=${summary.positionCount} realized=${summary.realizedPositionCount} pnl=${summary.realizedPnlSol}`
      );
    } catch (error) {
      console.warn(`Failed wallet realized PnL for ${wallet.walletAddress}: ${error.message}`);
      walletSummaries.push({
        walletAddress: wallet.walletAddress,
        name: wallet.name || null,
        rank: wallet.rank || null,
        error: error.message
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const mintIndex = buildMintIndex(walletSummaries.filter((item) => !item.error));
  const payload = {
    source: 'kolscan_leaderboard+helius_history_realized_pnl',
    generatedAt,
    walletLimit,
    txLimit,
    summary: {
      wallets: walletSummaries.length,
      walletsWithErrors: walletSummaries.filter((item) => item.error).length,
      mintCount: mintIndex.length,
      realizedMintCount: mintIndex.filter((item) => item.realizedWalletCount > 0).length
    },
    wallets: walletSummaries,
    mintIndex
  };

  const stamp = generatedAt.replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `wallet-realized-pnl-${stamp}.json`);
  writeJson(outputPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Saved wallet realized PnL to ${outputPath}`);
  console.log(`Updated latest wallet realized PnL at ${LATEST_PATH}`);
}

main().catch((error) => {
  console.error(`Failed to build wallet realized PnL: ${error.message}`);
  process.exit(1);
});
