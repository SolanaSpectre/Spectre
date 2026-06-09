const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_UNTRACKED_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'wallet-untracked-review-latest.json');
const DEFAULT_RECOVERY_SHADOW_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-false-negative-recovery-shadow-latest.json');
const DEFAULT_REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-untracked-shadow-impact');
const DEFAULT_LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-untracked-shadow-impact-latest.json');

const ACTION_TIERS = new Set(['MANUAL_REVIEW_NOW', 'OBSERVE_NEXT_RUN', 'CAUTION_BUSY_FLOW']);

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

function repoPath(filePath, fallback) {
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

function byWallet(rows = []) {
  return new Map(rows
    .filter((row) => row && row.wallet)
    .map((row) => [row.wallet, row]));
}

function impactClass(row) {
  if (row.suggestedAction === 'CAUTION_BUSY_FLOW') return 'CAUTION_DO_NOT_PROMOTE_YET';
  if (row.recoveryFullMatchRows >= 3 && row.noTrackedFirstTouchBuyLinks >= 5 && row.rowsPerMint < 4) return 'SHADOW_PROMOTION_TEST_CANDIDATE';
  if (row.recoveryFullMatchRows >= 1 && row.noTrackedFirstTouchBuyLinks > 0) return 'NEEDS_REPEAT_CONFIRMATION';
  if (row.noTrackedFirstTouchBuyLinks > 0) return 'COVERAGE_ONLY_NO_PARITY_CONFIRMATION';
  return 'LOW_IMPACT';
}

function buildRows(untrackedReview, recoveryShadow) {
  const candidates = (untrackedReview.candidates || [])
    .filter((row) => ACTION_TIERS.has(row.suggestedAction));
  const recoverySummary = recoveryShadow.summary || recoveryShadow;
  const untrackedCoverage = recoverySummary.untrackedWalletCoverage || {};
  const untrackedFullMatchCoverage = recoverySummary.untrackedWalletCoverageFullMatch || {};
  const recoveryRows = [
    ...(untrackedCoverage.topUntrackedBuyWallets || []),
    ...(untrackedFullMatchCoverage.topUntrackedBuyWallets || [])
  ];
  const recoveryByWallet = byWallet(recoveryRows);
  const fullMatchByWallet = byWallet(untrackedFullMatchCoverage.topUntrackedBuyWallets || []);

  return candidates.map((candidate) => {
    const recovery = recoveryByWallet.get(candidate.wallet) || {};
    const fullMatch = fullMatchByWallet.get(candidate.wallet) || {};
    const row = {
      wallet: candidate.wallet,
      suggestedAction: candidate.suggestedAction,
      reviewScore: candidate.reviewScore ?? null,
      buyRows: candidate.buyRows ?? null,
      sellRows: candidate.sellRows ?? null,
      buyRatio: candidate.buyRatio ?? null,
      rowsPerMint: candidate.rowsPerMint ?? null,
      uniqueMints: candidate.uniqueMints ?? null,
      decisionNearPriorMints: candidate.decisionNearPriorMints ?? null,
      noTrackedFirstTouchBuyLinks: candidate.noTrackedFirstTouchBuyLinks ?? 0,
      topDecisionReason: candidate.topDecisionReason || null,
      busyFlowRisk: candidate.busyFlowRisk === true,
      recoveryRows: recovery.rows ?? 0,
      recoveryUniqueMints: recovery.uniqueMints ?? 0,
      recoveryFullMatchRows: fullMatch.rows ?? 0,
      recoveryFullMatchUniqueMints: fullMatch.uniqueMints ?? 0,
      recoveryCrossed90Within120s: recovery.crossed90Within120s ?? 0,
      recoveryCrossed90Within120sRate: recovery.crossed90Within120sRate ?? null,
      recoveryCurveDelta120s: recovery.curveDelta120s || null,
      recoveryMaxPriceDeltaPct120s: recovery.maxPriceDeltaPct120s || null,
      sampleMints: candidate.sampleMints || [],
      draftWatchlistEntry: candidate.draftWatchlistEntry || null
    };
    row.impactClass = impactClass(row);
    row.shadowNotes = [
      row.busyFlowRisk ? 'busy flow; do not treat as trusted wallet proof yet' : null,
      row.recoveryFullMatchRows > 0 ? 'appears in full-match recovery-shadow rows' : 'no full-match recovery-shadow rows yet',
      row.noTrackedFirstTouchBuyLinks > 0 ? 'would explain some NO_TRACKED_FIRST_TOUCH_BUY links if later promoted' : null,
      row.recoveryCrossed90Within120s > 0 ? 'has latest-run cross90 follow-through' : null
    ].filter(Boolean);
    return row;
  }).sort((a, b) => {
    const order = {
      SHADOW_PROMOTION_TEST_CANDIDATE: 0,
      NEEDS_REPEAT_CONFIRMATION: 1,
      COVERAGE_ONLY_NO_PARITY_CONFIRMATION: 2,
      CAUTION_DO_NOT_PROMOTE_YET: 3,
      LOW_IMPACT: 4
    };
    return (order[a.impactClass] ?? 99) - (order[b.impactClass] ?? 99)
      || Number(b.recoveryFullMatchRows || 0) - Number(a.recoveryFullMatchRows || 0)
      || Number(b.noTrackedFirstTouchBuyLinks || 0) - Number(a.noTrackedFirstTouchBuyLinks || 0)
      || Number(b.reviewScore || 0) - Number(a.reviewScore || 0);
  });
}

function summarize(rows, recoveryShadow) {
  const recoverySummary = recoveryShadow.summary || recoveryShadow;
  const noTrackedDecisions = Number(recoverySummary.walletCoverage?.rows
    ?? recoverySummary.rows
    ?? recoveryShadow.walletCoverage?.rows
    ?? 0);
  const manualRows = rows.filter((row) => row.suggestedAction === 'MANUAL_REVIEW_NOW');
  const nonBusyRows = rows.filter((row) => row.suggestedAction !== 'CAUTION_BUSY_FLOW');
  const fullMatchRows = rows.filter((row) => Number(row.recoveryFullMatchRows || 0) > 0);
  const totalNoTrackedLinks = rows.reduce((total, row) => total + Number(row.noTrackedFirstTouchBuyLinks || 0), 0);
  const nonBusyNoTrackedLinks = nonBusyRows.reduce((total, row) => total + Number(row.noTrackedFirstTouchBuyLinks || 0), 0);
  return {
    candidateWallets: rows.length,
    manualReviewNowWallets: manualRows.length,
    cautionBusyFlowWallets: rows.filter((row) => row.suggestedAction === 'CAUTION_BUSY_FLOW').length,
    walletsWithRecoveryFullMatch: fullMatchRows.length,
    recoveryShadowRows: noTrackedDecisions || null,
    candidateNoTrackedFirstTouchBuyLinks: totalNoTrackedLinks,
    nonBusyCandidateNoTrackedFirstTouchBuyLinks: nonBusyNoTrackedLinks,
    actionCounts: countBy(rows, (row) => row.suggestedAction),
    impactClassCounts: countBy(rows, (row) => row.impactClass),
    bestNonBusyFullMatchWallet: fullMatchRows.find((row) => row.suggestedAction !== 'CAUTION_BUSY_FLOW')?.wallet || null,
    estimatedNoTrackedLinkCoverageRate: noTrackedDecisions > 0 ? compact(nonBusyNoTrackedLinks / noTrackedDecisions, 4) : null
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const untrackedReviewPath = repoPath(args.untrackedReview, DEFAULT_UNTRACKED_REVIEW_PATH);
  const recoveryShadowPath = repoPath(args.recoveryShadow, DEFAULT_RECOVERY_SHADOW_PATH);
  const latestPath = repoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const reportDir = repoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const untrackedReview = readJson(untrackedReviewPath, {});
  const recoveryShadow = readJson(recoveryShadowPath, {});
  const generatedAt = new Date().toISOString();
  const rows = buildRows(untrackedReview, recoveryShadow);
  const payload = {
    generatedAt,
    mode: 'report_only_untracked_wallet_shadow_impact',
    sources: {
      untrackedReviewPath,
      untrackedReviewGeneratedAt: untrackedReview.generatedAt || null,
      recoveryShadowPath,
      recoveryShadowGeneratedAt: recoveryShadow.generatedAt || null
    },
    note: 'Report-only join. This estimates whether untracked review candidates would have supplied wallet proof. It does not import wallets, alter trust tiers, or affect runtime entries.',
    summary: summarize(rows, recoveryShadow),
    promotionTestCandidates: rows.filter((row) => row.impactClass === 'SHADOW_PROMOTION_TEST_CANDIDATE'),
    needsRepeatConfirmation: rows.filter((row) => row.impactClass === 'NEEDS_REPEAT_CONFIRMATION'),
    cautionBusyFlow: rows.filter((row) => row.impactClass === 'CAUTION_DO_NOT_PROMOTE_YET'),
    rows
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-untracked-shadow-impact-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(latestPath, payload);
  console.log(`Wrote untracked wallet shadow-impact report: ${reportPath}`);
  console.log(`Wrote latest untracked wallet shadow-impact report: ${latestPath}`);
  console.log(`candidateWallets=${payload.summary.candidateWallets} fullMatchWallets=${payload.summary.walletsWithRecoveryFullMatch} promotionTestCandidates=${payload.promotionTestCandidates.length}`);
}

main();
