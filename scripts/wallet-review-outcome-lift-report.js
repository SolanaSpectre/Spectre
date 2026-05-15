const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROMOTION_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const FIRST_TOUCH_PATH = path.join(ROOT, 'data', 'reports', 'wallet-first-touch-latest.json');
const OUTCOME_LEDGER_PATH = path.join(ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-review-outcome-lift');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-review-outcome-lift-latest.json');

const POSITIVE_OUTCOMES = new Set(['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85', 'PAPER_WIN']);
const INTERESTING_OUTCOMES = new Set([...POSITIVE_OUTCOMES, 'INTERESTING_75']);

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

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function lift(rate, baseline) {
  return rate !== null && baseline !== null && baseline > 0
    ? Number((rate / baseline).toFixed(4))
    : null;
}

function outcomeMap(outcomeLedger) {
  return new Map((outcomeLedger?.outcomes || [])
    .filter((item) => item.mint)
    .map((item) => [item.mint, item.outcome || 'UNKNOWN']));
}

function cohortSummary(label, rows, baseRates, clusterRates) {
  const outcomeCounts = {};
  let positiveCount = 0;
  let interestingCount = 0;
  let paperWinCount = 0;
  let paperLossCount = 0;

  for (const row of rows) {
    outcomeCounts[row.outcome] = (outcomeCounts[row.outcome] || 0) + 1;
    if (POSITIVE_OUTCOMES.has(row.outcome)) positiveCount += 1;
    if (INTERESTING_OUTCOMES.has(row.outcome)) interestingCount += 1;
    if (row.outcome === 'PAPER_WIN') paperWinCount += 1;
    if (row.outcome === 'PAPER_LOSS') paperLossCount += 1;
  }

  const positiveRate = pct(positiveCount, rows.length);
  const interestingRate = pct(interestingCount, rows.length);

  return {
    label,
    clusters: rows.length,
    outcomeCounts,
    positiveCount,
    positiveRate,
    positiveLiftVsLedger: lift(positiveRate, baseRates.positiveRate),
    positiveLiftVsAllFirstTouch: lift(positiveRate, clusterRates.positiveRate),
    interestingCount,
    interestingRate,
    interestingLiftVsLedger: lift(interestingRate, baseRates.interestingRate),
    interestingLiftVsAllFirstTouch: lift(interestingRate, clusterRates.interestingRate),
    paperWinCount,
    paperLossCount,
    tinyDenominatorWarning: rows.length < 10 || positiveCount < 3
  };
}

function touchRows(firstTouch, reviewTierByWallet, outcomes) {
  const rows = [];
  for (const cluster of firstTouch?.clusters || []) {
    for (const touch of cluster.firstTouches || []) {
      const reviewTier = reviewTierByWallet.get(touch.wallet);
      if (!reviewTier) continue;
      rows.push({
        wallet: touch.wallet,
        walletName: touch.walletName || null,
        reviewTier,
        mint: cluster.mint,
        symbol: cluster.symbol || null,
        recommendation: cluster.recommendation || null,
        side: touch.side || null,
        phase: touch.phase || null,
        outcome: outcomes.get(cluster.mint) || 'UNKNOWN'
      });
    }
  }
  return rows;
}

function uniqueMintRows(rows) {
  const byMint = new Map();
  for (const row of rows) {
    if (!byMint.has(row.mint)) byMint.set(row.mint, row);
  }
  return Array.from(byMint.values());
}

function buildReport(promotionReview, firstTouch, outcomeLedger) {
  const reviewTierByWallet = new Map((promotionReview?.wallets || [])
    .filter((wallet) => wallet.walletAddress)
    .map((wallet) => [wallet.walletAddress, wallet.reviewTier]));
  const outcomes = outcomeMap(outcomeLedger);

  const rows = (firstTouch?.clusters || []).map((cluster) => {
    const tiers = new Set((cluster.firstTouches || [])
      .map((touch) => reviewTierByWallet.get(touch.wallet))
      .filter(Boolean));
    return {
      mint: cluster.mint,
      symbol: cluster.symbol || null,
      recommendation: cluster.recommendation || null,
      outcome: outcomes.get(cluster.mint) || 'UNKNOWN',
      reviewTiers: Array.from(tiers).sort(),
      walletNames: cluster.walletNames || []
    };
  });

  const baseOutcomeCounts = outcomeLedger?.summary?.outcomeCounts || {};
  const baseTotal = Object.values(baseOutcomeCounts).reduce((sum, value) => sum + num(value), 0);
  const basePositiveCount = Object.entries(baseOutcomeCounts)
    .filter(([outcome]) => POSITIVE_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + num(count), 0);
  const baseInterestingCount = Object.entries(baseOutcomeCounts)
    .filter(([outcome]) => INTERESTING_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + num(count), 0);
  const baseRates = {
    total: baseTotal,
    positiveRate: pct(basePositiveCount, baseTotal),
    interestingRate: pct(baseInterestingCount, baseTotal)
  };

  const allFirstTouchPositiveCount = rows.filter((row) => POSITIVE_OUTCOMES.has(row.outcome)).length;
  const allFirstTouchInterestingCount = rows.filter((row) => INTERESTING_OUTCOMES.has(row.outcome)).length;
  const clusterRates = {
    total: rows.length,
    positiveRate: pct(allFirstTouchPositiveCount, rows.length),
    interestingRate: pct(allFirstTouchInterestingCount, rows.length)
  };

  const trustRows = rows.filter((row) => row.reviewTiers.includes('TRUST_REVIEW'));
  const avoidRows = rows.filter((row) => row.reviewTiers.includes('AVOID_REVIEW'));
  const trustOnlyRows = rows.filter((row) => row.reviewTiers.includes('TRUST_REVIEW') && !row.reviewTiers.includes('AVOID_REVIEW'));
  const avoidOnlyRows = rows.filter((row) => row.reviewTiers.includes('AVOID_REVIEW') && !row.reviewTiers.includes('TRUST_REVIEW'));
  const mixedRows = rows.filter((row) => row.reviewTiers.includes('TRUST_REVIEW') && row.reviewTiers.includes('AVOID_REVIEW'));
  const profitableNeedsEvidenceRows = rows.filter((row) => row.reviewTiers.includes('PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'));
  const touches = touchRows(firstTouch, reviewTierByWallet, outcomes);
  const trustTouchRows = touches.filter((row) => row.reviewTier === 'TRUST_REVIEW');
  const avoidTouchRows = touches.filter((row) => row.reviewTier === 'AVOID_REVIEW');
  const trustTouchMintRows = uniqueMintRows(trustTouchRows);
  const avoidTouchMintRows = uniqueMintRows(avoidTouchRows);

  return {
    summary: {
      clusters: rows.length,
      baseLedgerPositiveRate: baseRates.positiveRate,
      baseLedgerInterestingRate: baseRates.interestingRate,
      allFirstTouchPositiveRate: clusterRates.positiveRate,
      allFirstTouchInterestingRate: clusterRates.interestingRate,
      trustReviewTouchedClusters: trustRows.length,
      avoidReviewTouchedClusters: avoidRows.length,
      mixedTrustAvoidClusters: mixedRows.length
    },
    cohorts: {
      trustReviewTouched: cohortSummary('trustReviewTouched', trustRows, baseRates, clusterRates),
      trustReviewOnly: cohortSummary('trustReviewOnly', trustOnlyRows, baseRates, clusterRates),
      avoidReviewTouched: cohortSummary('avoidReviewTouched', avoidRows, baseRates, clusterRates),
      avoidReviewOnly: cohortSummary('avoidReviewOnly', avoidOnlyRows, baseRates, clusterRates),
      mixedTrustAvoid: cohortSummary('mixedTrustAvoid', mixedRows, baseRates, clusterRates),
      profitableNeedsFirstTouchEvidenceTouched: cohortSummary(
        'profitableNeedsFirstTouchEvidenceTouched',
        profitableNeedsEvidenceRows,
        baseRates,
        clusterRates
      )
    },
    touchCohorts: {
      trustReviewTouches: cohortSummary('trustReviewTouches', trustTouchRows, baseRates, clusterRates),
      avoidReviewTouches: cohortSummary('avoidReviewTouches', avoidTouchRows, baseRates, clusterRates),
      trustReviewUniqueMints: cohortSummary('trustReviewUniqueMints', trustTouchMintRows, baseRates, clusterRates),
      avoidReviewUniqueMints: cohortSummary('avoidReviewUniqueMints', avoidTouchMintRows, baseRates, clusterRates)
    },
    touches,
    rows
  };
}

function main() {
  const promotionReview = readJson(PROMOTION_REVIEW_PATH, {});
  const firstTouch = readJson(FIRST_TOUCH_PATH, {});
  const outcomeLedger = readJson(OUTCOME_LEDGER_PATH, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport(promotionReview, firstTouch, outcomeLedger);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_review_outcome_lift',
    sources: {
      promotionReviewPath: path.relative(ROOT, PROMOTION_REVIEW_PATH).replace(/\\/g, '/'),
      promotionReviewGeneratedAt: promotionReview.generatedAt || null,
      firstTouchPath: path.relative(ROOT, FIRST_TOUCH_PATH).replace(/\\/g, '/'),
      firstTouchGeneratedAt: firstTouch.generatedAt || null,
      outcomeLedgerPath: path.relative(ROOT, OUTCOME_LEDGER_PATH).replace(/\\/g, '/'),
      outcomeLedgerGeneratedAt: outcomeLedger.generatedAt || null
    },
    note: 'Report-only comparison of downstream outcomes after first touches by wallet review tier. Cohort overlap is explicit; do not mutate trust tiers from this report alone.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-review-outcome-lift-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet review outcome lift report: ${reportPath}`);
  console.log(`Wrote latest wallet review outcome lift report: ${LATEST_PATH}`);
  console.log(`trust=${payload.cohorts.trustReviewTouched.clusters} avoid=${payload.cohorts.avoidReviewTouched.clusters} mixed=${payload.cohorts.mixedTrustAvoid.clusters}`);
}

main();
