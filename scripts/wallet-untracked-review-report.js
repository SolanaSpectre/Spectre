const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_COVERAGE_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-context-coverage-latest.json');
const DEFAULT_PROMOTION_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const DEFAULT_MANUAL_WATCHLIST_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const DEFAULT_REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-untracked-review');
const DEFAULT_LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-untracked-review-latest.json');

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
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
}

function readJson(filePath, fallback = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
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

function countBy(rows, keyFn) {
  return rows.reduce((acc, row) => {
    const key = keyFn(row) || 'UNKNOWN';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function topReason(reasonCounts = {}) {
  return Object.entries(reasonCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0] || null;
}

function walletSetFromWatchlist(watchlist = {}) {
  return new Set((watchlist.wallets || [])
    .map((wallet) => wallet.walletAddress)
    .filter(Boolean));
}

function walletSetFromPromotionReview(review = {}) {
  return new Set((review.wallets || [])
    .map((wallet) => wallet.walletAddress)
    .filter(Boolean));
}

function indexByWallet(rows = []) {
  return new Map(rows
    .filter((row) => row.wallet)
    .map((row) => [row.wallet, row]));
}

function suggestedAction(row) {
  if (row.alreadyKnown) return 'ALREADY_TRACKED';
  if (row.busyFlowRisk) return row.reviewScore >= 70 ? 'CAUTION_BUSY_FLOW' : 'OBSERVE_BUSY_FLOW';
  if (row.reviewScore >= 70 && row.uniqueMints >= 10 && row.decisionNearPriorMints >= 5) return 'MANUAL_REVIEW_NOW';
  if (row.reviewScore >= 55 && row.uniqueMints >= 5) return 'OBSERVE_NEXT_RUN';
  if (row.decisionNearPriorMints >= 3 && row.noTrackedFirstTouchBuyLinks > 0) return 'OBSERVE_NEXT_RUN';
  return 'LOW_PRIORITY';
}

function recommendationReasons(row) {
  const reasons = [];
  if (row.alreadyKnown) reasons.push('wallet already exists in manual watchlist or promotion review');
  if (row.reviewScore >= 70) reasons.push('high untracked review score');
  if (row.uniqueMints >= 10) reasons.push('seen across many unique mints');
  if (row.decisionNearPriorMints >= 5) reasons.push('appeared before multiple paper decisions');
  if (row.noTrackedFirstTouchBuyLinks > 0) reasons.push('near-prior to NO_TRACKED_FIRST_TOUCH_BUY decisions');
  if (row.busyFlowRisk) reasons.push('very high activity per mint; likely bot/router/market-maker style flow');
  if (Number(row.buyRatio || 0) < 0.45) reasons.push('buy ratio is not strongly buy-side');
  if (row.crossed90Within300s === 0) reasons.push('no observed cross90 follow-through in latest run');
  return reasons;
}

function draftWatchlistEntry(row) {
  return {
    walletAddress: row.wallet,
    name: `untracked_runtime_${String(row.wallet || '').slice(0, 6)}`,
    source: 'runtime_untracked_review',
    trustTier: null,
    profile: 'runtime_untracked_review',
    score: row.reviewScore ?? null,
    twitter: null,
    telegram: null,
    flags: [
      'REPORT_ONLY_REVIEW_CANDIDATE',
      'NEEDS_MANUAL_VALIDATION',
      row.busyFlowRisk ? 'BUSY_FLOW_CAUTION' : 'UNTRACKED_FIRST_TOUCH_CANDIDATE'
    ]
  };
}

function buildCandidates(coverage, watchlist, promotionReview) {
  const tracking = coverage.runtime?.trackingOpportunity || {};
  const opportunity = tracking.untrackedWalletOpportunity || {};
  const decisionJoin = tracking.untrackedWalletDecisionJoin || {};
  const reviewRows = [
    ...(opportunity.topReviewCandidates || []),
    ...(opportunity.topByFollowThrough || []),
    ...(opportunity.topByFrequency || [])
  ];
  const joinRowsByWallet = indexByWallet(decisionJoin.topNearPriorWallets || []);
  const opportunityRowsByWallet = indexByWallet(reviewRows);
  const knownWallets = new Set([
    ...walletSetFromWatchlist(watchlist),
    ...walletSetFromPromotionReview(promotionReview)
  ]);
  const walletIds = new Set([
    ...opportunityRowsByWallet.keys(),
    ...joinRowsByWallet.keys()
  ]);

  return Array.from(walletIds).map((wallet) => {
    const opportunityRow = opportunityRowsByWallet.get(wallet) || {};
    const joinRow = joinRowsByWallet.get(wallet) || {};
    const reasonCounts = joinRow.reasonCounts || {};
    const noTrackedFirstTouchBuyLinks = Number(reasonCounts.CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY || 0);
    const top = topReason(reasonCounts);
    const buyRows = Number(opportunityRow.buyRows ?? opportunityRow.rows ?? joinRow.nearPriorBuyRows ?? 0);
    const uniqueMints = Number(opportunityRow.uniqueMints ?? joinRow.uniqueMints ?? 0);
    const rowsPerMint = Number(opportunityRow.rowsPerMint ?? (uniqueMints > 0 ? buyRows / uniqueMints : 0));
    const busyFlowRisk = buyRows >= 250 || rowsPerMint >= 12 || Number(joinRow.nearPriorBuyDecisionLinks || 0) >= 1000;
    const row = {
      wallet,
      alreadyKnown: knownWallets.has(wallet),
      reviewScore: compact(opportunityRow.reviewScore, 2),
      sourceReviewReason: opportunityRow.reviewReason || null,
      buyRows,
      sellRows: Number(opportunityRow.sellRows || 0),
      buyRatio: compact(opportunityRow.buyRatio, 4),
      uniqueMints,
      decisionOverlapMints: Number(opportunityRow.decisionOverlapMints || 0),
      decisionOverlapRate: compact(opportunityRow.decisionOverlapRate, 4),
      rowsPerMint: compact(rowsPerMint, 2),
      crossed85Within120s: Number(opportunityRow.crossed85Within120s || 0),
      crossed90Within120s: Number(opportunityRow.crossed90Within120s || 0),
      crossed90Within300s: Number(opportunityRow.crossed90Within300s || 0),
      uniqueMintsCrossed90Within300s: Number(opportunityRow.uniqueMintsCrossed90Within300s || 0),
      curveDelta300s: opportunityRow.curveDelta300s || null,
      maxPriceDeltaPct300s: opportunityRow.maxPriceDeltaPct300s || null,
      decisionNearPriorCount: Number(joinRow.decisions || 0),
      decisionNearPriorMints: Number(joinRow.uniqueMints || 0),
      nearPriorBuyRows: Number(joinRow.nearPriorBuyRows || 0),
      nearPriorBuyDecisionLinks: Number(joinRow.nearPriorBuyDecisionLinks || 0),
      noTrackedFirstTouchBuyLinks,
      topDecisionReason: top ? top[0] : null,
      topDecisionReasonLinks: top ? top[1] : 0,
      reasonCounts,
      busyFlowRisk,
      sampleMints: opportunityRow.sampleMints || []
    };
    row.suggestedAction = suggestedAction(row);
    row.reasons = recommendationReasons(row);
    row.draftWatchlistEntry = row.suggestedAction === 'MANUAL_REVIEW_NOW'
      || row.suggestedAction === 'OBSERVE_NEXT_RUN'
      || row.suggestedAction === 'CAUTION_BUSY_FLOW'
      ? draftWatchlistEntry(row)
      : null;
    return row;
  }).sort((a, b) => {
    const actionOrder = {
      MANUAL_REVIEW_NOW: 0,
      CAUTION_BUSY_FLOW: 1,
      OBSERVE_NEXT_RUN: 2,
      OBSERVE_BUSY_FLOW: 3,
      LOW_PRIORITY: 4,
      ALREADY_TRACKED: 5
    };
    return (actionOrder[a.suggestedAction] ?? 99) - (actionOrder[b.suggestedAction] ?? 99)
      || Number(b.reviewScore || 0) - Number(a.reviewScore || 0)
      || Number(b.decisionNearPriorCount || 0) - Number(a.decisionNearPriorCount || 0)
      || Number(b.uniqueMints || 0) - Number(a.uniqueMints || 0);
  });
}

function buildReport({ coverage, watchlist, promotionReview }) {
  const candidates = buildCandidates(coverage, watchlist, promotionReview);
  const actionable = candidates.filter((row) => [
    'MANUAL_REVIEW_NOW',
    'CAUTION_BUSY_FLOW',
    'OBSERVE_NEXT_RUN'
  ].includes(row.suggestedAction));
  const manualReviewNow = candidates.filter((row) => row.suggestedAction === 'MANUAL_REVIEW_NOW');
  const tracking = coverage.runtime?.trackingOpportunity || {};
  const decisionJoin = tracking.untrackedWalletDecisionJoin || {};
  return {
    summary: {
      candidates: candidates.length,
      actionable: actionable.length,
      manualReviewNow: manualReviewNow.length,
      actionCounts: countBy(candidates, (row) => row.suggestedAction),
      providerTradeEvents: tracking.providerTradeEvents ?? null,
      runtimeWalletObserved: tracking.walletTradeObservedEvents ?? null,
      untrackedBuyRows: tracking.untrackedWalletOpportunity?.buyRows ?? null,
      untrackedUniqueWallets: tracking.untrackedWalletOpportunity?.uniqueWallets ?? null,
      paperDecisionRows: decisionJoin.paperDecisionRows ?? null,
      decisionsWithNearPriorUntrackedBuy: decisionJoin.decisionsWithNearPriorUntrackedBuy ?? null,
      noTrackedFirstTouchBuyDecisions: decisionJoin.noTrackedFirstTouchBuyDecisions ?? null,
      noTrackedFirstTouchBuyWithNearPriorUntrackedBuy: decisionJoin.noTrackedFirstTouchBuyWithNearPriorUntrackedBuy ?? null
    },
    manualReviewNow,
    cautionBusyFlow: candidates.filter((row) => row.suggestedAction === 'CAUTION_BUSY_FLOW'),
    observeNextRun: candidates.filter((row) => row.suggestedAction === 'OBSERVE_NEXT_RUN'),
    lowPriority: candidates.filter((row) => row.suggestedAction === 'LOW_PRIORITY'),
    proposedWatchlistEntries: actionable
      .filter((row) => row.draftWatchlistEntry)
      .map((row) => row.draftWatchlistEntry),
    candidates
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const coveragePath = resolveRepoPath(args.coverage, DEFAULT_COVERAGE_PATH);
  const promotionReviewPath = resolveRepoPath(args.promotionReview, DEFAULT_PROMOTION_REVIEW_PATH);
  const watchlistPath = resolveRepoPath(args.watchlist, DEFAULT_MANUAL_WATCHLIST_PATH);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const coverage = readJson(coveragePath, {});
  const promotionReview = readJson(promotionReviewPath, {});
  const watchlist = readJson(watchlistPath, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport({ coverage, watchlist, promotionReview });
  const payload = {
    generatedAt,
    mode: 'report_only_untracked_wallet_review',
    sources: {
      coveragePath,
      coverageGeneratedAt: coverage.generatedAt || null,
      promotionReviewPath,
      promotionReviewGeneratedAt: promotionReview.generatedAt || null,
      watchlistPath,
      watchlistUpdatedAt: watchlist.updatedAt || null
    },
    note: 'Report-only queue for untracked runtime wallets. Do not import proposedWatchlistEntries without human review and at least one confirming run; these rows are not trusted runtime evidence by themselves.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-untracked-review-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(latestPath, payload);
  console.log(`Wrote untracked wallet review report: ${reportPath}`);
  console.log(`Wrote latest untracked wallet review report: ${latestPath}`);
  console.log(`candidates=${payload.summary.candidates} manualReviewNow=${payload.summary.manualReviewNow} actionable=${payload.summary.actionable}`);
}

main();
