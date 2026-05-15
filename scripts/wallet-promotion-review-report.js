const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_PNL_EVIDENCE_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-pnl-evidence-latest.json');
const DEFAULT_FIRST_TOUCH_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-first-touch-latest.json');
const DEFAULT_MANUAL_WATCHLIST_PATH = path.join(REPO_ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'wallet-promotion-review');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');

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

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function buildWatchlistIndex(watchlist) {
  return new Map((watchlist?.wallets || [])
    .filter((wallet) => wallet.walletAddress)
    .map((wallet) => [wallet.walletAddress, wallet]));
}

function buildFirstTouchIndex(firstTouchReport) {
  const stats = new Map();
  const priorityMints = new Set((firstTouchReport?.clusters || [])
    .filter((cluster) => cluster.recommendation === 'paper_watch_priority')
    .map((cluster) => cluster.mint));

  for (const cluster of firstTouchReport?.clusters || []) {
    for (const touch of cluster.firstTouches || []) {
      if (!touch.wallet) continue;
      if (!stats.has(touch.wallet)) {
        stats.set(touch.wallet, {
          clusterCount: 0,
          priorityClusterCount: 0,
          firstBuyTouches: 0,
          firstSellTouches: 0,
          freshLaunchTouches: 0,
          preMigrationTouches: 0,
          scores: [],
          touchedMints: []
        });
      }
      const bucket = stats.get(touch.wallet);
      bucket.clusterCount += 1;
      if (priorityMints.has(cluster.mint)) bucket.priorityClusterCount += 1;
      if (touch.side === 'buy') bucket.firstBuyTouches += 1;
      if (touch.side === 'sell') bucket.firstSellTouches += 1;
      if (touch.phase === 'fresh_launch') bucket.freshLaunchTouches += 1;
      if (String(touch.phase || '').includes('pre_migration')) bucket.preMigrationTouches += 1;
      if (Number.isFinite(Number(touch.score))) bucket.scores.push(Number(touch.score));
      bucket.touchedMints.push({
        mint: cluster.mint,
        symbol: cluster.symbol || null,
        recommendation: cluster.recommendation || null,
        side: touch.side || null,
        phase: touch.phase || null,
        score: touch.score ?? null,
        secondsSinceCreate: touch.secondsSinceCreate ?? null
      });
    }
  }

  for (const bucket of stats.values()) {
    bucket.averageFirstTouchScore = compact(
      bucket.scores.length ? bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length : null,
      4
    );
    bucket.firstBuyRatio = compact(
      bucket.clusterCount ? bucket.firstBuyTouches / bucket.clusterCount : null,
      4
    );
    bucket.touchedMints = bucket.touchedMints.slice(0, 12);
    delete bucket.scores;
  }

  return stats;
}

function reviewTier(wallet) {
  const pnlTier = wallet.evidenceTier;
  const usefulEarly = wallet.priorityClusterCount >= 3
    && wallet.firstBuyTouches >= 3
    && Number(wallet.firstBuyRatio || 0) >= 0.5;

  if (pnlTier === 'PROVEN_POSITIVE' && usefulEarly) return 'TRUST_REVIEW';
  if (pnlTier === 'PROVEN_POSITIVE') return 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE';
  if (pnlTier === 'PROMISING_POSITIVE') return 'WATCH_REVIEW';
  if (pnlTier === 'NEGATIVE_EVIDENCE') return 'AVOID_REVIEW';
  return 'HOLD';
}

function buildReasons(wallet) {
  const reasons = [];
  if (wallet.evidenceTier === 'PROVEN_POSITIVE') reasons.push('proven positive realized PnL');
  if (wallet.evidenceTier === 'PROMISING_POSITIVE') reasons.push('promising realized PnL');
  if (wallet.evidenceTier === 'NEGATIVE_EVIDENCE') reasons.push('negative realized PnL evidence');
  if (wallet.priorityClusterCount >= 3) reasons.push('repeated priority first-touch presence');
  if (wallet.firstBuyTouches >= 3) reasons.push('repeated first-touch buys');
  if (Number(wallet.firstBuyRatio || 0) >= 0.5 && wallet.clusterCount > 0) reasons.push('first-touch flow skews buy-side');
  if (wallet.clusterCount === 0) reasons.push('no first-touch evidence yet');
  if (wallet.behaviorLabel) reasons.push(`behavior label ${wallet.behaviorLabel}`);
  if (wallet.ambiguousMultiTokenTxs > 0) reasons.push('some ambiguous multi-token transactions skipped');
  return reasons;
}

function summarizeWallet(wallet, firstTouchStats, watchlistProfile) {
  const summary = {
    walletAddress: wallet.walletAddress,
    name: wallet.name || watchlistProfile?.name || null,
    profile: watchlistProfile?.profile || wallet.profile || null,
    watchlistFlags: watchlistProfile?.flags || [],
    evidenceTier: wallet.evidenceTier,
    realizedPositionCount: wallet.realizedPositionCount,
    winRate: wallet.winRate,
    realizedPnlSol: wallet.realizedPnlSol,
    medianRealizedPnlSol: wallet.medianRealizedPnlSol,
    profitFactor: wallet.profitFactor,
    behaviorLabel: wallet.behaviorLabel || null,
    behaviorConfidence: wallet.behaviorConfidence || null,
    ambiguousMultiTokenTxs: wallet.ambiguousMultiTokenTxs || 0,
    clusterCount: firstTouchStats?.clusterCount || 0,
    priorityClusterCount: firstTouchStats?.priorityClusterCount || 0,
    firstBuyTouches: firstTouchStats?.firstBuyTouches || 0,
    firstSellTouches: firstTouchStats?.firstSellTouches || 0,
    freshLaunchTouches: firstTouchStats?.freshLaunchTouches || 0,
    preMigrationTouches: firstTouchStats?.preMigrationTouches || 0,
    firstBuyRatio: firstTouchStats?.firstBuyRatio || null,
    averageFirstTouchScore: firstTouchStats?.averageFirstTouchScore || null,
    sampleFirstTouches: firstTouchStats?.touchedMints || []
  };
  summary.reviewTier = reviewTier(summary);
  summary.reasons = buildReasons(summary);
  return summary;
}

function buildReport(pnlEvidence, firstTouchReport, watchlist) {
  const firstTouchIndex = buildFirstTouchIndex(firstTouchReport);
  const watchlistIndex = buildWatchlistIndex(watchlist);
  const wallets = (pnlEvidence?.wallets || [])
    .map((wallet) => summarizeWallet(
      wallet,
      firstTouchIndex.get(wallet.walletAddress),
      watchlistIndex.get(wallet.walletAddress)
    ));

  const sorted = wallets.slice().sort((a, b) => {
    if (a.reviewTier !== b.reviewTier) {
      const order = {
        TRUST_REVIEW: 0,
        PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE: 1,
        WATCH_REVIEW: 2,
        HOLD: 3,
        AVOID_REVIEW: 4
      };
      return (order[a.reviewTier] ?? 99) - (order[b.reviewTier] ?? 99);
    }
    return Number(b.realizedPnlSol || 0) - Number(a.realizedPnlSol || 0);
  });

  const byReviewTier = sorted.reduce((acc, wallet) => {
    acc[wallet.reviewTier] = (acc[wallet.reviewTier] || 0) + 1;
    return acc;
  }, {});

  return {
    summary: {
      wallets: sorted.length,
      trustReviewWallets: sorted.filter((wallet) => wallet.reviewTier === 'TRUST_REVIEW').length,
      profitableNeedsFirstTouchEvidenceWallets: sorted.filter((wallet) => wallet.reviewTier === 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE').length,
      watchReviewWallets: sorted.filter((wallet) => wallet.reviewTier === 'WATCH_REVIEW').length,
      avoidReviewWallets: sorted.filter((wallet) => wallet.reviewTier === 'AVOID_REVIEW').length,
      holdWallets: sorted.filter((wallet) => wallet.reviewTier === 'HOLD').length,
      byReviewTier
    },
    trustReview: sorted.filter((wallet) => wallet.reviewTier === 'TRUST_REVIEW'),
    profitableNeedsFirstTouchEvidence: sorted.filter((wallet) => wallet.reviewTier === 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'),
    watchReview: sorted.filter((wallet) => wallet.reviewTier === 'WATCH_REVIEW'),
    avoidReview: sorted.filter((wallet) => wallet.reviewTier === 'AVOID_REVIEW'),
    wallets: sorted
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pnlEvidencePath = resolveRepoPath(args.pnlEvidence, DEFAULT_PNL_EVIDENCE_PATH);
  const firstTouchPath = resolveRepoPath(args.firstTouch, DEFAULT_FIRST_TOUCH_PATH);
  const watchlistPath = resolveRepoPath(args.watchlist, DEFAULT_MANUAL_WATCHLIST_PATH);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const pnlEvidence = readJson(pnlEvidencePath, {});
  const firstTouchReport = readJson(firstTouchPath, {});
  const watchlist = readJson(watchlistPath, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport(pnlEvidence, firstTouchReport, watchlist);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_promotion_review',
    sources: {
      pnlEvidencePath,
      pnlEvidenceGeneratedAt: pnlEvidence.generatedAt || null,
      firstTouchPath,
      firstTouchGeneratedAt: firstTouchReport.generatedAt || null,
      watchlistPath,
      watchlistUpdatedAt: watchlist.updatedAt || null
    },
    note: 'Report-only wallet promotion review. TRUST_REVIEW is a human-review shortlist, not an automatic trust-tier mutation. Profitability without repeated useful first-touch evidence remains separate from runtime trust.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-promotion-review-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(latestPath, payload);
  console.log(`Wrote wallet promotion review report: ${reportPath}`);
  console.log(`Wrote latest wallet promotion review report: ${latestPath}`);
  console.log(`trustReview=${payload.summary.trustReviewWallets} profitableNeedsFirstTouch=${payload.summary.profitableNeedsFirstTouchEvidenceWallets} watchReview=${payload.summary.watchReviewWallets} avoidReview=${payload.summary.avoidReviewWallets}`);
}

main();
