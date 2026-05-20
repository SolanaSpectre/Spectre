const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_MANUAL_WATCHLIST_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const DEFAULT_FIRST_TOUCH_PATH = path.join(ROOT, 'data', 'reports', 'wallet-first-touch-latest.json');
const DEFAULT_PROMOTION_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const DEFAULT_PER_WALLET_LIFT_PATH = path.join(ROOT, 'data', 'reports', 'wallet-per-wallet-lift-latest.json');
const DEFAULT_PNL_EVIDENCE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-pnl-evidence-latest.json');
const DEFAULT_OUTCOME_LEDGER_PATH = path.join(ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const DEFAULT_REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-daumen-cohort');
const DEFAULT_LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-daumen-cohort-latest.json');

const DAUMEN_FLAG = 'DAUMEN_WALLET_TRACKER';
const POSITIVE_OUTCOMES = new Set(['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85', 'PAPER_WIN']);
const INTERESTING_OUTCOMES = new Set([...POSITIVE_OUTCOMES, 'INTERESTING_75']);

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
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, decimals = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : null;
}

function pct(part, total) {
  return total > 0 ? compact(part / total, 4) : null;
}

function countBy(rows, keyFn) {
  return rows.reduce((acc, row) => {
    const key = keyFn(row) || 'UNKNOWN';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function indexBy(rows, key) {
  return new Map((rows || [])
    .filter((row) => row && row[key])
    .map((row) => [row[key], row]));
}

function outcomeMap(outcomeLedger) {
  return new Map((outcomeLedger?.outcomes || [])
    .filter((item) => item.mint)
    .map((item) => [item.mint, item.outcome || 'UNKNOWN']));
}

function daumenWallets(watchlist) {
  return (watchlist?.wallets || [])
    .filter((wallet) => (wallet.flags || []).includes(DAUMEN_FLAG))
    .map((wallet) => ({
      walletAddress: wallet.walletAddress,
      name: wallet.name || null,
      profile: wallet.profile || null,
      trustTier: wallet.trustTier ?? null,
      source: wallet.source || null,
      alertsOn: (wallet.flags || []).includes('TRACKER_ALERTS_ON'),
      alertsOff: (wallet.flags || []).includes('TRACKER_ALERTS_OFF'),
      flags: wallet.flags || []
    }));
}

function buildFirstTouchStats(firstTouch, outcomes) {
  const stats = new Map();

  for (const cluster of firstTouch?.clusters || []) {
    for (const touch of cluster.firstTouches || []) {
      if (!touch.wallet) continue;
      if (!stats.has(touch.wallet)) {
        stats.set(touch.wallet, {
          clusterCount: 0,
          uniqueMints: new Set(),
          firstBuyTouches: 0,
          firstSellTouches: 0,
          freshLaunchTouches: 0,
          preMigrationTouches: 0,
          priorityClusterCount: 0,
          riskContextCount: 0,
          totalFirstTouchSol: 0,
          scores: [],
          outcomeCounts: {},
          positiveMints: new Set(),
          interestingMints: new Set(),
          sampleFirstTouches: []
        });
      }
      const bucket = stats.get(touch.wallet);
      const mint = cluster.mint;
      const outcome = outcomes.get(mint) || 'UNKNOWN';
      bucket.clusterCount += 1;
      bucket.uniqueMints.add(mint);
      if (touch.side === 'buy') bucket.firstBuyTouches += 1;
      if (touch.side === 'sell') bucket.firstSellTouches += 1;
      if (touch.phase === 'fresh_launch') bucket.freshLaunchTouches += 1;
      if (String(touch.phase || '').includes('pre_migration')) bucket.preMigrationTouches += 1;
      if (cluster.recommendation === 'paper_watch_priority') bucket.priorityClusterCount += 1;
      if (cluster.recommendation === 'risk_context') bucket.riskContextCount += 1;
      bucket.totalFirstTouchSol += num(touch.amountSol, 0);
      if (Number.isFinite(Number(touch.score))) bucket.scores.push(Number(touch.score));
      bucket.outcomeCounts[outcome] = (bucket.outcomeCounts[outcome] || 0) + 1;
      if (POSITIVE_OUTCOMES.has(outcome)) bucket.positiveMints.add(mint);
      if (INTERESTING_OUTCOMES.has(outcome)) bucket.interestingMints.add(mint);
      if (bucket.sampleFirstTouches.length < 10) {
        bucket.sampleFirstTouches.push({
          mint,
          symbol: cluster.symbol || null,
          outcome,
          recommendation: cluster.recommendation || null,
          side: touch.side || null,
          phase: touch.phase || null,
          amountSol: compact(touch.amountSol, 6),
          score: touch.score ?? null,
          secondsSinceCreate: touch.secondsSinceCreate ?? null,
          tradeAt: touch.tradeAt || null
        });
      }
    }
  }

  const normalized = new Map();
  for (const [wallet, bucket] of stats.entries()) {
    const uniqueMintCount = bucket.uniqueMints.size;
    normalized.set(wallet, {
      clusterCount: bucket.clusterCount,
      uniqueMintCount,
      firstBuyTouches: bucket.firstBuyTouches,
      firstSellTouches: bucket.firstSellTouches,
      firstBuyRate: pct(bucket.firstBuyTouches, uniqueMintCount),
      freshLaunchTouches: bucket.freshLaunchTouches,
      preMigrationTouches: bucket.preMigrationTouches,
      priorityClusterCount: bucket.priorityClusterCount,
      riskContextCount: bucket.riskContextCount,
      totalFirstTouchSol: compact(bucket.totalFirstTouchSol, 6),
      averageFirstTouchScore: compact(bucket.scores.length
        ? bucket.scores.reduce((sum, value) => sum + value, 0) / bucket.scores.length
        : null),
      outcomeCounts: bucket.outcomeCounts,
      positiveMintCount: bucket.positiveMints.size,
      positiveRate: pct(bucket.positiveMints.size, uniqueMintCount),
      interestingMintCount: bucket.interestingMints.size,
      interestingRate: pct(bucket.interestingMints.size, uniqueMintCount),
      touchedMints: Array.from(bucket.uniqueMints),
      sampleFirstTouches: bucket.sampleFirstTouches
    });
  }
  return normalized;
}

function rowScore(row) {
  return num(row.priorityClusterCount) * 8
    + num(row.positiveMintCount) * 7
    + num(row.interestingMintCount) * 4
    + num(row.firstBuyTouches) * 2
    + Math.min(num(row.uniqueMintCount), 12)
    + Math.max(num(row.realizedPnlSol), 0) / 10;
}

function classifyDaumenRow(row) {
  if (row.reviewTier === 'TRUST_REVIEW') return 'TRUST_REVIEW_EVIDENCE';
  if (row.reviewTier === 'WATCH_REVIEW') return 'WATCH_REVIEW_EVIDENCE';
  if (row.reviewTier === 'AVOID_REVIEW' || row.evidenceTier === 'NEGATIVE_EVIDENCE') return 'CAUTION_EVIDENCE';
  if (row.priorityClusterCount >= 3 && row.firstBuyTouches >= 3) return 'USEFUL_FIRST_TOUCH_CANDIDATE';
  if (row.uniqueMintCount > 0) return 'OBSERVED_BUT_UNPROVEN';
  return 'NO_LOCAL_EVIDENCE_YET';
}

function buildRows({ wallets, firstTouchStats, promotionIndex, liftIndex, pnlIndex }) {
  return wallets.map((wallet) => {
    const firstTouch = firstTouchStats.get(wallet.walletAddress) || {};
    const promotion = promotionIndex.get(wallet.walletAddress) || {};
    const lift = liftIndex.get(wallet.walletAddress) || {};
    const pnl = pnlIndex.get(wallet.walletAddress) || {};
    const row = {
      ...wallet,
      evidenceTier: promotion.evidenceTier || pnl.evidenceTier || lift.evidenceTier || null,
      reviewTier: promotion.reviewTier || lift.reviewTier || null,
      realizedPnlSol: compact(promotion.realizedPnlSol ?? pnl.realizedPnlSol ?? lift.realizedPnlSol, 8),
      realizedPositionCount: promotion.realizedPositionCount ?? pnl.realizedPositionCount ?? lift.realizedPositionCount ?? 0,
      winRate: promotion.winRate ?? pnl.winRate ?? null,
      behaviorLabel: promotion.behaviorLabel || pnl.behaviorLabel || null,
      behaviorConfidence: promotion.behaviorConfidence ?? pnl.behaviorConfidence ?? null,
      clusterCount: firstTouch.clusterCount || promotion.clusterCount || 0,
      uniqueMintCount: firstTouch.uniqueMintCount || lift.uniqueMintCount || 0,
      priorityClusterCount: firstTouch.priorityClusterCount || promotion.priorityClusterCount || 0,
      riskContextCount: firstTouch.riskContextCount || 0,
      firstBuyTouches: firstTouch.firstBuyTouches || promotion.firstBuyTouches || lift.firstBuyTouches || 0,
      firstSellTouches: firstTouch.firstSellTouches || promotion.firstSellTouches || 0,
      firstBuyRate: firstTouch.firstBuyRate ?? promotion.firstBuyRatio ?? lift.firstBuyRate ?? null,
      freshLaunchTouches: firstTouch.freshLaunchTouches || promotion.freshLaunchTouches || 0,
      preMigrationTouches: firstTouch.preMigrationTouches || promotion.preMigrationTouches || 0,
      totalFirstTouchSol: firstTouch.totalFirstTouchSol ?? null,
      averageFirstTouchScore: firstTouch.averageFirstTouchScore ?? promotion.averageFirstTouchScore ?? null,
      outcomeCounts: firstTouch.outcomeCounts || lift.outcomeCounts || {},
      positiveMintCount: firstTouch.positiveMintCount ?? lift.positiveCount ?? 0,
      positiveRate: firstTouch.positiveRate ?? lift.positiveRate ?? null,
      interestingMintCount: firstTouch.interestingMintCount ?? lift.interestingCount ?? 0,
      interestingRate: firstTouch.interestingRate ?? lift.interestingRate ?? null,
      touchedMints: firstTouch.touchedMints || [],
      tinyDenominatorWarning: Boolean(lift.tinyDenominatorWarning || (firstTouch.uniqueMintCount || 0) < 5),
      sampleFirstTouches: firstTouch.sampleFirstTouches || promotion.sampleFirstTouches || lift.sampleTouches || []
    };
    row.daumenCohortClass = classifyDaumenRow(row);
    row.daumenCohortScore = compact(rowScore(row), 4);
    return row;
  }).sort((a, b) => {
    if (a.daumenCohortClass !== b.daumenCohortClass) {
      const order = {
        TRUST_REVIEW_EVIDENCE: 0,
        USEFUL_FIRST_TOUCH_CANDIDATE: 1,
        WATCH_REVIEW_EVIDENCE: 2,
        OBSERVED_BUT_UNPROVEN: 3,
        CAUTION_EVIDENCE: 4,
        NO_LOCAL_EVIDENCE_YET: 5
      };
      return (order[a.daumenCohortClass] ?? 99) - (order[b.daumenCohortClass] ?? 99);
    }
    return num(b.daumenCohortScore) - num(a.daumenCohortScore);
  });
}

function buildReport(inputs) {
  const outcomes = outcomeMap(inputs.outcomeLedger);
  const wallets = daumenWallets(inputs.watchlist);
  const firstTouchStats = buildFirstTouchStats(inputs.firstTouch, outcomes);
  const promotionIndex = indexBy(inputs.promotionReview?.wallets || [], 'walletAddress');
  const liftIndex = indexBy(inputs.perWalletLift?.wallets || [], 'walletAddress');
  const pnlIndex = indexBy(inputs.pnlEvidence?.wallets || [], 'walletAddress');
  const rows = buildRows({ wallets, firstTouchStats, promotionIndex, liftIndex, pnlIndex });

  const withFirstTouch = rows.filter((row) => num(row.uniqueMintCount) > 0);
  const withoutFirstTouch = rows.filter((row) => num(row.uniqueMintCount) === 0);
  const trustReview = rows.filter((row) => row.reviewTier === 'TRUST_REVIEW');
  const watchReview = rows.filter((row) => row.reviewTier === 'WATCH_REVIEW');
  const avoidReview = rows.filter((row) => row.reviewTier === 'AVOID_REVIEW');
  const usefulFirstTouchCandidates = rows.filter((row) => row.daumenCohortClass === 'USEFUL_FIRST_TOUCH_CANDIDATE');
  const touchedMintSet = new Set();
  let positiveTouchedMints = 0;
  let interestingTouchedMints = 0;
  for (const row of rows) {
    for (const mint of row.touchedMints || []) touchedMintSet.add(mint);
  }
  for (const mint of touchedMintSet) {
    const outcome = outcomes.get(mint) || 'UNKNOWN';
    if (POSITIVE_OUTCOMES.has(outcome)) positiveTouchedMints += 1;
    if (INTERESTING_OUTCOMES.has(outcome)) interestingTouchedMints += 1;
  }

  return {
    summary: {
      daumenWallets: rows.length,
      alertsOnWallets: rows.filter((row) => row.alertsOn).length,
      alertsOffWallets: rows.filter((row) => row.alertsOff).length,
      walletsWithFirstTouchEvidence: withFirstTouch.length,
      walletsWithoutFirstTouchEvidence: withoutFirstTouch.length,
      trustReviewWallets: trustReview.length,
      watchReviewWallets: watchReview.length,
      avoidReviewWallets: avoidReview.length,
      usefulFirstTouchCandidates: usefulFirstTouchCandidates.length,
      daumenTouchedMints: touchedMintSet.size,
      positiveTouchedMints,
      positiveTouchedMintRate: pct(positiveTouchedMints, touchedMintSet.size),
      interestingTouchedMints,
      interestingTouchedMintRate: pct(interestingTouchedMints, touchedMintSet.size),
      byCohortClass: countBy(rows, (row) => row.daumenCohortClass),
      byReviewTier: countBy(rows, (row) => row.reviewTier || 'UNREVIEWED'),
      byEvidenceTier: countBy(rows, (row) => row.evidenceTier || 'UNKNOWN')
    },
    topDaumenWallets: rows
      .filter((row) => row.daumenCohortClass !== 'NO_LOCAL_EVIDENCE_YET')
      .slice(0, 25),
    trustReview,
    usefulFirstTouchCandidates,
    watchReview,
    avoidReview,
    noLocalEvidenceYet: withoutFirstTouch.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    rows
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const watchlistPath = resolveRepoPath(args.watchlist, DEFAULT_MANUAL_WATCHLIST_PATH);
  const firstTouchPath = resolveRepoPath(args.firstTouch, DEFAULT_FIRST_TOUCH_PATH);
  const promotionReviewPath = resolveRepoPath(args.promotionReview, DEFAULT_PROMOTION_REVIEW_PATH);
  const perWalletLiftPath = resolveRepoPath(args.perWalletLift, DEFAULT_PER_WALLET_LIFT_PATH);
  const pnlEvidencePath = resolveRepoPath(args.pnlEvidence, DEFAULT_PNL_EVIDENCE_PATH);
  const outcomeLedgerPath = resolveRepoPath(args.outcomeLedger, DEFAULT_OUTCOME_LEDGER_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const generatedAt = new Date().toISOString();

  const watchlist = readJson(watchlistPath, {});
  const firstTouch = readJson(firstTouchPath, {});
  const promotionReview = readJson(promotionReviewPath, {});
  const perWalletLift = readJson(perWalletLiftPath, {});
  const pnlEvidence = readJson(pnlEvidencePath, {});
  const outcomeLedger = readJson(outcomeLedgerPath, {});
  const report = buildReport({
    watchlist,
    firstTouch,
    promotionReview,
    perWalletLift,
    pnlEvidence,
    outcomeLedger
  });

  const payload = {
    generatedAt,
    mode: 'report_only_wallet_daumen_cohort',
    sources: {
      watchlistPath,
      watchlistUpdatedAt: watchlist.updatedAt || null,
      firstTouchPath,
      firstTouchGeneratedAt: firstTouch.generatedAt || null,
      promotionReviewPath,
      promotionReviewGeneratedAt: promotionReview.generatedAt || null,
      perWalletLiftPath,
      perWalletLiftGeneratedAt: perWalletLift.generatedAt || null,
      pnlEvidencePath,
      pnlEvidenceGeneratedAt: pnlEvidence.generatedAt || null,
      outcomeLedgerPath,
      outcomeLedgerGeneratedAt: outcomeLedger.generatedAt || null
    },
    note: 'Report-only Daumen tracker cohort review. Daumen membership is descriptive source context, not a trust tier. Rows rank local first-touch, outcome, promotion, and realized-PnL evidence to prioritize human review only; does not mutate wallet trust tiers, score weights, entries, exits, signals, AI review, or live behavior.',
    ...report
  };

  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-daumen-cohort-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(latestPath, payload);
  console.log(`Wrote Daumen wallet cohort report: ${reportPath}`);
  console.log(`Wrote latest Daumen wallet cohort report: ${latestPath}`);
  console.log(`daumen=${payload.summary.daumenWallets} firstTouch=${payload.summary.walletsWithFirstTouchEvidence} trust=${payload.summary.trustReviewWallets} useful=${payload.summary.usefulFirstTouchCandidates} noEvidence=${payload.summary.walletsWithoutFirstTouchEvidence}`);
}

main();
