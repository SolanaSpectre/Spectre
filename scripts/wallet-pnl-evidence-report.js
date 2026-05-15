const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_REALIZED_PNL_PATH = path.join(REPO_ROOT, 'data', 'wallet-realized-pnl', 'latest.json');
const DEFAULT_BEHAVIOR_PATH = path.join(REPO_ROOT, 'data', 'wallet-reports', 'latest.json');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'wallet-pnl-evidence');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-pnl-evidence-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
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

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
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

function compact(value, decimals = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function median(values) {
  const ordered = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle];
  return (ordered[middle - 1] + ordered[middle]) / 2;
}

function buildBehaviorIndex(behaviorReport) {
  const wallets = [
    ...(behaviorReport?.trusted || []),
    ...(behaviorReport?.mixed || []),
    ...(behaviorReport?.avoid || []),
    ...(behaviorReport?.eventLedger?.groups?.alphaScalpers || []),
    ...(behaviorReport?.eventLedger?.groups?.earlySnipers || []),
    ...(behaviorReport?.eventLedger?.groups?.convictionWhales || []),
    ...(behaviorReport?.eventLedger?.groups?.dumpers || [])
  ];
  return new Map(wallets
    .filter((wallet) => wallet.wallet)
    .map((wallet) => [wallet.wallet, wallet]));
}

function evidenceTier(summary) {
  const realized = Number(summary.realizedPositionCount || 0);
  const pnl = Number(summary.realizedPnlSol || 0);
  const winRate = Number(summary.winRate);
  const medianPnl = Number(summary.medianRealizedPnlSol);
  const profitFactor = Number(summary.profitFactor);
  const profitableWithoutKnownLosses = Number(summary.grossProfitSol || 0) > 0 && Number(summary.grossLossSol || 0) === 0;

  if (realized >= 10 && pnl > 0 && winRate >= 0.55 && medianPnl > 0 && (profitFactor > 1 || profitableWithoutKnownLosses)) {
    return 'PROVEN_POSITIVE';
  }
  if (realized >= 3 && pnl > 0 && Number(summary.winners || 0) > Number(summary.losers || 0)) {
    return 'PROMISING_POSITIVE';
  }
  if (realized >= 3 && pnl < 0 && Number(summary.losers || 0) >= Number(summary.winners || 0)) {
    return 'NEGATIVE_EVIDENCE';
  }
  return 'INSUFFICIENT_EVIDENCE';
}

function summarizeWallet(wallet, behavior) {
  const knownPositions = (wallet.positions || [])
    .filter((position) => position.realizedPnlSol !== null && position.sellCount > 0);
  const pnls = knownPositions.map((position) => Number(position.realizedPnlSol || 0));
  const positivePnl = pnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const negativePnlAbs = Math.abs(pnls.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const summary = {
    walletAddress: wallet.walletAddress,
    name: wallet.name || null,
    rank: wallet.rank || null,
    transactionsFetched: Number(wallet.transactionsFetched || 0),
    pagesFetched: Number(wallet.pagesFetched || 0),
    ambiguousMultiTokenTxs: Number(wallet.ambiguousMultiTokenTxs || 0),
    positionCount: Number(wallet.positionCount || 0),
    realizedPositionCount: Number(wallet.realizedPositionCount || 0),
    proceedsOnlyPositionCount: Number(wallet.proceedsOnlyPositionCount || 0),
    winners: Number(wallet.winners || 0),
    losers: Number(wallet.losers || 0),
    winRate: compact(wallet.winRate, 4),
    realizedPnlSol: compact(wallet.realizedPnlSol, 8),
    medianRealizedPnlSol: compact(median(pnls), 8),
    averageRealizedPnlSol: compact(pnls.length ? pnls.reduce((sum, value) => sum + value, 0) / pnls.length : null, 8),
    grossProfitSol: compact(positivePnl, 8),
    grossLossSol: compact(negativePnlAbs, 8),
    profitFactor: compact(negativePnlAbs > 0 ? positivePnl / negativePnlAbs : null, 4),
    behaviorLabel: behavior?.label || null,
    behaviorConfidence: compact(behavior?.confidence, 4),
    behaviorReasons: behavior?.reasons || [],
    profile: behavior?.walletProfile?.profile || null,
    trustTier: behavior?.walletProfile?.trustTier || null,
    topRealizedPositions: knownPositions
      .slice()
      .sort((a, b) => Number(b.realizedPnlSol || 0) - Number(a.realizedPnlSol || 0))
      .slice(0, 8)
      .map((position) => ({
        mint: position.mint,
        realizedPnlSol: position.realizedPnlSol,
        realizedReturnPct: position.realizedReturnPct,
        buyCount: position.buyCount,
        sellCount: position.sellCount,
        firstTxAt: position.firstTxAt,
        lastTxAt: position.lastTxAt
      }))
  };
  summary.evidenceTier = evidenceTier(summary);
  return summary;
}

function buildReport(realizedPnl, behaviorReport) {
  const behaviorIndex = buildBehaviorIndex(behaviorReport);
  const wallets = (realizedPnl?.wallets || [])
    .filter((wallet) => !wallet.error)
    .map((wallet) => summarizeWallet(wallet, behaviorIndex.get(wallet.walletAddress)));
  const ranked = wallets.slice().sort((a, b) => {
    if (Number(b.realizedPnlSol || 0) !== Number(a.realizedPnlSol || 0)) {
      return Number(b.realizedPnlSol || 0) - Number(a.realizedPnlSol || 0);
    }
    return Number(b.realizedPositionCount || 0) - Number(a.realizedPositionCount || 0);
  });
  const byEvidenceTier = ranked.reduce((acc, wallet) => {
    acc[wallet.evidenceTier] = (acc[wallet.evidenceTier] || 0) + 1;
    return acc;
  }, {});
  const positiveWallets = ranked.filter((wallet) => Number(wallet.realizedPnlSol || 0) > 0);
  const negativeWallets = ranked.filter((wallet) => Number(wallet.realizedPnlSol || 0) < 0);

  return {
    summary: {
      wallets: ranked.length,
      walletsWithKnownRealizedPositions: ranked.filter((wallet) => wallet.realizedPositionCount > 0).length,
      provenPositiveWallets: ranked.filter((wallet) => wallet.evidenceTier === 'PROVEN_POSITIVE').length,
      promisingPositiveWallets: ranked.filter((wallet) => wallet.evidenceTier === 'PROMISING_POSITIVE').length,
      negativeEvidenceWallets: ranked.filter((wallet) => wallet.evidenceTier === 'NEGATIVE_EVIDENCE').length,
      insufficientEvidenceWallets: ranked.filter((wallet) => wallet.evidenceTier === 'INSUFFICIENT_EVIDENCE').length,
      byEvidenceTier,
      ambiguousMultiTokenTxs: ranked.reduce((sum, wallet) => sum + Number(wallet.ambiguousMultiTokenTxs || 0), 0),
      totalKnownRealizedPnlSol: compact(ranked.reduce((sum, wallet) => sum + Number(wallet.realizedPnlSol || 0), 0), 8)
    },
    topPositiveWallets: positiveWallets.slice(0, 25),
    topNegativeWallets: negativeWallets.slice(-25).reverse(),
    wallets: ranked
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const realizedPnlPath = resolveRepoPath(args.realizedPnl, DEFAULT_REALIZED_PNL_PATH);
  const behaviorPath = resolveRepoPath(args.behavior, DEFAULT_BEHAVIOR_PATH);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const generatedAt = new Date().toISOString();
  const realizedPnl = readJson(realizedPnlPath, {});
  const behaviorReport = readJson(behaviorPath, {});
  const report = buildReport(realizedPnl, behaviorReport);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_pnl_evidence',
    sources: {
      realizedPnlPath,
      realizedPnlGeneratedAt: realizedPnl.generatedAt || null,
      behaviorPath,
      behaviorGeneratedAt: behaviorReport.generatedAt || null
    },
    note: 'Report-only wallet PnL evidence. Behavior labels are not trust tiers. PROVEN_POSITIVE requires realized sample size and profitable consistency; do not use this report alone to loosen entry rules.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-pnl-evidence-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(latestPath, payload);
  console.log(`Wrote wallet PnL evidence report: ${reportPath}`);
  console.log(`Wrote latest wallet PnL evidence report: ${latestPath}`);
  console.log(`Wallets=${payload.summary.wallets} known=${payload.summary.walletsWithKnownRealizedPositions} proven=${payload.summary.provenPositiveWallets} promising=${payload.summary.promisingPositiveWallets}`);
}

main();
