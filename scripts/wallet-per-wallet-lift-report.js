const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PROMOTION_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const FIRST_TOUCH_PATH = path.join(ROOT, 'data', 'reports', 'wallet-first-touch-latest.json');
const OUTCOME_LEDGER_PATH = path.join(ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-per-wallet-lift');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-per-wallet-lift-latest.json');

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

function buildReviewIndex(review) {
  return new Map((review?.wallets || [])
    .filter((wallet) => wallet.walletAddress)
    .map((wallet) => [wallet.walletAddress, wallet]));
}

function buildWalletRows(review, firstTouch, outcomeLedger) {
  const reviewIndex = buildReviewIndex(review);
  const outcomes = outcomeMap(outcomeLedger);
  const rowsByWallet = new Map();

  for (const cluster of firstTouch?.clusters || []) {
    for (const touch of cluster.firstTouches || []) {
      const wallet = reviewIndex.get(touch.wallet);
      if (!wallet) continue;
      if (!rowsByWallet.has(touch.wallet)) {
        rowsByWallet.set(touch.wallet, {
          walletAddress: touch.wallet,
          name: wallet.name || touch.walletName || null,
          reviewTier: wallet.reviewTier,
          evidenceTier: wallet.evidenceTier,
          realizedPnlSol: wallet.realizedPnlSol,
          realizedPositionCount: wallet.realizedPositionCount,
          touches: []
        });
      }
      rowsByWallet.get(touch.wallet).touches.push({
        mint: cluster.mint,
        symbol: cluster.symbol || null,
        side: touch.side || null,
        phase: touch.phase || null,
        recommendation: cluster.recommendation || null,
        outcome: outcomes.get(cluster.mint) || 'UNKNOWN'
      });
    }
  }

  return Array.from(rowsByWallet.values());
}

function summarizeWallet(row, baselines) {
  const uniqueByMint = new Map();
  for (const touch of row.touches) {
    if (!uniqueByMint.has(touch.mint)) uniqueByMint.set(touch.mint, touch);
  }
  const uniqueTouches = Array.from(uniqueByMint.values());
  const outcomeCounts = {};
  let positiveCount = 0;
  let interestingCount = 0;
  let paperWinCount = 0;
  let paperLossCount = 0;
  let firstBuyTouches = 0;

  for (const touch of uniqueTouches) {
    outcomeCounts[touch.outcome] = (outcomeCounts[touch.outcome] || 0) + 1;
    if (POSITIVE_OUTCOMES.has(touch.outcome)) positiveCount += 1;
    if (INTERESTING_OUTCOMES.has(touch.outcome)) interestingCount += 1;
    if (touch.outcome === 'PAPER_WIN') paperWinCount += 1;
    if (touch.outcome === 'PAPER_LOSS') paperLossCount += 1;
    if (touch.side === 'buy') firstBuyTouches += 1;
  }

  const uniqueMintCount = uniqueTouches.length;
  const positiveRate = pct(positiveCount, uniqueMintCount);
  const interestingRate = pct(interestingCount, uniqueMintCount);

  return {
    walletAddress: row.walletAddress,
    name: row.name,
    reviewTier: row.reviewTier,
    evidenceTier: row.evidenceTier,
    realizedPnlSol: row.realizedPnlSol,
    realizedPositionCount: row.realizedPositionCount,
    touchCount: row.touches.length,
    uniqueMintCount,
    firstBuyTouches,
    firstBuyRate: pct(firstBuyTouches, uniqueMintCount),
    outcomeCounts,
    positiveCount,
    positiveRate,
    positiveLiftVsLedger: lift(positiveRate, baselines.ledgerPositiveRate),
    positiveLiftVsAllFirstTouch: lift(positiveRate, baselines.firstTouchPositiveRate),
    interestingCount,
    interestingRate,
    interestingLiftVsLedger: lift(interestingRate, baselines.ledgerInterestingRate),
    interestingLiftVsAllFirstTouch: lift(interestingRate, baselines.firstTouchInterestingRate),
    paperWinCount,
    paperLossCount,
    tinyDenominatorWarning: uniqueMintCount < 5 || positiveCount < 2,
    sampleTouches: uniqueTouches.slice(0, 12)
  };
}

function buildReport(review, firstTouch, outcomeLedger) {
  const baseOutcomeCounts = outcomeLedger?.summary?.outcomeCounts || {};
  const ledgerTotal = Object.values(baseOutcomeCounts).reduce((sum, value) => sum + num(value), 0);
  const ledgerPositive = Object.entries(baseOutcomeCounts)
    .filter(([outcome]) => POSITIVE_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + num(count), 0);
  const ledgerInteresting = Object.entries(baseOutcomeCounts)
    .filter(([outcome]) => INTERESTING_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + num(count), 0);
  const outcomeByMint = outcomeMap(outcomeLedger);
  const firstTouchRows = (firstTouch?.clusters || []).map((cluster) => ({
    mint: cluster.mint,
    outcome: outcomeByMint.get(cluster.mint) || 'UNKNOWN'
  }));
  const firstTouchPositive = firstTouchRows.filter((row) => POSITIVE_OUTCOMES.has(row.outcome)).length;
  const firstTouchInteresting = firstTouchRows.filter((row) => INTERESTING_OUTCOMES.has(row.outcome)).length;
  const baselines = {
    ledgerPositiveRate: pct(ledgerPositive, ledgerTotal),
    ledgerInterestingRate: pct(ledgerInteresting, ledgerTotal),
    firstTouchPositiveRate: pct(firstTouchPositive, firstTouchRows.length),
    firstTouchInterestingRate: pct(firstTouchInteresting, firstTouchRows.length)
  };

  const wallets = buildWalletRows(review, firstTouch, outcomeLedger)
    .map((row) => summarizeWallet(row, baselines))
    .sort((a, b) => {
      if (Number(b.positiveRate || 0) !== Number(a.positiveRate || 0)) {
        return Number(b.positiveRate || 0) - Number(a.positiveRate || 0);
      }
      return Number(b.uniqueMintCount || 0) - Number(a.uniqueMintCount || 0);
    });

  const stableTrustCandidates = wallets.filter((wallet) =>
    wallet.reviewTier === 'TRUST_REVIEW'
    && wallet.uniqueMintCount >= 5
    && !wallet.tinyDenominatorWarning
    && Number(wallet.positiveRate || 0) > Number(baselines.firstTouchPositiveRate || 0)
  );

  const stableAvoidCandidates = wallets.filter((wallet) =>
    wallet.reviewTier === 'AVOID_REVIEW'
    && wallet.uniqueMintCount >= 5
    && !wallet.tinyDenominatorWarning
    && Number(wallet.positiveRate || 0) < Number(baselines.firstTouchPositiveRate || 0)
  );

  return {
    summary: {
      walletsWithTouches: wallets.length,
      ledgerPositiveRate: baselines.ledgerPositiveRate,
      ledgerInterestingRate: baselines.ledgerInterestingRate,
      firstTouchPositiveRate: baselines.firstTouchPositiveRate,
      firstTouchInterestingRate: baselines.firstTouchInterestingRate
    },
    stableTrustCandidates,
    stableAvoidCandidates,
    trustReviewWallets: wallets.filter((wallet) => wallet.reviewTier === 'TRUST_REVIEW'),
    avoidReviewWallets: wallets.filter((wallet) => wallet.reviewTier === 'AVOID_REVIEW'),
    wallets
  };
}

function main() {
  const review = readJson(PROMOTION_REVIEW_PATH, {});
  const firstTouch = readJson(FIRST_TOUCH_PATH, {});
  const outcomeLedger = readJson(OUTCOME_LEDGER_PATH, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport(review, firstTouch, outcomeLedger);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_per_wallet_lift',
    sources: {
      promotionReviewGeneratedAt: review.generatedAt || null,
      firstTouchGeneratedAt: firstTouch.generatedAt || null,
      outcomeLedgerGeneratedAt: outcomeLedger.generatedAt || null
    },
    note: 'Report-only per-wallet downstream outcome lift after first touches. Small samples are explicitly flagged; use this to prioritize further observation, not to mutate runtime trust by itself.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-per-wallet-lift-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet per-wallet lift report: ${reportPath}`);
  console.log(`Wrote latest wallet per-wallet lift report: ${LATEST_PATH}`);
  console.log(`wallets=${payload.summary.walletsWithTouches} trust=${payload.trustReviewWallets.length} avoid=${payload.avoidReviewWallets.length}`);
}

main();
