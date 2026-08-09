'use strict';

const DEFAULT_POLICY = Object.freeze({
  minRealizedPositions: 12,
  aMinRealizedPositions: 25,
  minKnownBasisCoverage: 0.65,
  bMinWinRate: 0.5,
  aMinWinRate: 0.55,
  minSnapshotDaysForA: 2,
  maxFreshBuyAgeMinutes: 360,
  minFreshBuySol: 0.01,
  minQualifiedWalletsPerMint: 1
});
const EXCLUDED_FLOW_MINTS = new Set([
  'So11111111111111111111111111111111111111112',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
]);

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function compact(value, decimals = 8) {
  const numeric = finite(value);
  return numeric === null ? null : Number(numeric.toFixed(decimals));
}

function median(values = []) {
  const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function exTop(values = [], count = 3) {
  const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => b - a);
  if (sorted.length <= count) return { count: 0, total: null, mean: null };
  const remaining = sorted.slice(count);
  const total = remaining.reduce((sum, value) => sum + value, 0);
  return {
    count: remaining.length,
    total: compact(total),
    mean: compact(total / remaining.length)
  };
}

function minutesBetween(firstAt, lastAt) {
  const firstMs = Date.parse(firstAt || 0);
  const lastMs = Date.parse(lastAt || 0);
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs) || lastMs < firstMs) return null;
  return (lastMs - firstMs) / 60_000;
}

function summarizeLeaderboard(wallet = {}, snapshotHistory = {}) {
  const appearances = Array.isArray(wallet.leaderboardAppearances)
    ? wallet.leaderboardAppearances
    : [];
  const reportedProfits = appearances
    .map((row) => finite(row.reportedProfitSol))
    .filter((value) => value !== null);
  return {
    bestRank: finite(wallet.bestRank ?? wallet.rank),
    timeframeCount: appearances.length || finite(wallet.leaderboardTimeframeCount) || 0,
    reportedProfitSolByTimeframe: appearances.map((row) => ({
      timeframe: row.timeframe,
      rank: row.rank,
      reportedProfitSol: row.reportedProfitSol,
      wins: row.wins,
      losses: row.losses,
      winRate: row.winRate
    })),
    anyPositiveReportedProfit: reportedProfits.some((value) => value > 0),
    snapshotDayCount: Number(snapshotHistory.snapshotDayCount || 0),
    firstSeenAt: snapshotHistory.firstSeenAt || wallet.fetchedAt || null,
    lastSeenAt: snapshotHistory.lastSeenAt || wallet.fetchedAt || null
  };
}

function gradeWalletEvidence(wallet = {}, walletSummary = null, options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const snapshotHistory = options.snapshotHistory || {};
  const leaderboard = summarizeLeaderboard(wallet, snapshotHistory);
  if (!walletSummary) {
    return {
      walletAddress: wallet.walletAddress || null,
      name: wallet.name || null,
      grade: 'NOT_ANALYZED',
      reasons: ['HELIUS_HISTORY_NOT_ANALYZED'],
      cautions: [],
      leaderboard,
      metrics: null
    };
  }
  if (walletSummary.error) {
    return {
      walletAddress: wallet.walletAddress || walletSummary.walletAddress || null,
      name: wallet.name || walletSummary.name || null,
      grade: 'REJECT',
      reasons: ['HELIUS_HISTORY_ERROR'],
      cautions: [],
      leaderboard,
      metrics: null
    };
  }

  const positions = Array.isArray(walletSummary.positions) ? walletSummary.positions : [];
  const realizedPositions = positions.filter((position) => (
    finite(position.realizedPnlSol) !== null && Number(position.sellCount || 0) > 0
  ));
  const pnlValues = realizedPositions.map((position) => Number(position.realizedPnlSol));
  const knownCount = realizedPositions.length;
  const unknownCount = Math.max(0, Number(walletSummary.proceedsOnlyPositionCount || 0));
  const coverageDenominator = knownCount + unknownCount;
  const knownBasisCoverage = coverageDenominator > 0 ? knownCount / coverageDenominator : null;
  const wins = pnlValues.filter((value) => value > 0).length;
  const losses = pnlValues.filter((value) => value < 0).length;
  const totalPnlSol = pnlValues.reduce((sum, value) => sum + value, 0);
  const medianPnlSol = median(pnlValues);
  const exTop3 = exTop(pnlValues, 3);
  const holdMinutes = realizedPositions
    .map((position) => minutesBetween(position.firstTxAt, position.lastTxAt))
    .filter((value) => value !== null);
  const metrics = {
    transactionsFetched: Number(walletSummary.transactionsFetched || 0),
    realizedPositions: knownCount,
    proceedsOnlyPositions: unknownCount,
    knownBasisCoverage: compact(knownBasisCoverage, 4),
    wins,
    losses,
    winRate: compact(knownCount > 0 ? wins / knownCount : null, 4),
    totalPnlSol: compact(totalPnlSol),
    medianPnlSol: compact(medianPnlSol),
    exTop3Count: exTop3.count,
    exTop3TotalPnlSol: exTop3.total,
    exTop3MeanPnlSol: exTop3.mean,
    medianPositionSpanMinutes: compact(median(holdMinutes), 2)
  };

  const reasons = [];
  const cautions = ['WALLET_IDENTITY_RELATIONSHIP_SCREEN_UNAVAILABLE'];
  let grade = 'WATCH';
  if (knownCount < Number(policy.minRealizedPositions)) {
    reasons.push('INSUFFICIENT_KNOWN_BASIS_SAMPLE');
  } else if (knownBasisCoverage === null || knownBasisCoverage < Number(policy.minKnownBasisCoverage)) {
    reasons.push('INSUFFICIENT_COST_BASIS_COVERAGE');
  } else if (medianPnlSol === null || medianPnlSol <= 0) {
    grade = 'REJECT';
    reasons.push('NON_POSITIVE_MEDIAN_REALIZED_PNL');
  } else if (exTop3.total === null || exTop3.total <= 0) {
    grade = 'REJECT';
    reasons.push('NON_POSITIVE_EX_TOP3_REALIZED_PNL');
  } else if (metrics.winRate < Number(policy.bMinWinRate)) {
    grade = 'REJECT';
    reasons.push('WIN_RATE_BELOW_DURABILITY_BAR');
  } else {
    const aReady = knownCount >= Number(policy.aMinRealizedPositions)
      && metrics.winRate >= Number(policy.aMinWinRate)
      && leaderboard.snapshotDayCount >= Number(policy.minSnapshotDaysForA)
      && walletSummary.identityRelationshipScreen === 'passed';
    grade = aReady ? 'A' : 'B';
    reasons.push(aReady ? 'DURABLE_WALLET_EVIDENCE_A' : 'DURABLE_WALLET_EVIDENCE_B');
    if (!leaderboard.anyPositiveReportedProfit) {
      cautions.push('THIRD_PARTY_PERFORMANCE_CLAIM_UNAVAILABLE');
    }
  }

  return {
    walletAddress: wallet.walletAddress || walletSummary.walletAddress || null,
    name: wallet.name || walletSummary.name || null,
    grade,
    reasons,
    cautions,
    leaderboard,
    metrics,
    positions
  };
}

function buildFreshWalletFlow(assessments = [], options = {}) {
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const nowMs = Number(options.nowMs || Date.now());
  const maxAgeMs = Number(policy.maxFreshBuyAgeMinutes) * 60_000;
  const byMint = new Map();

  for (const assessment of assessments) {
    if (!['A', 'B'].includes(assessment.grade)) continue;
    for (const position of assessment.positions || []) {
      const atMs = Date.parse(position.lastTxAt || 0);
      const actionSol = Math.abs(Number(position.lastActionSolDelta || 0));
      if (EXCLUDED_FLOW_MINTS.has(position.mint)) continue;
      if (position.lastAction !== 'BUY') continue;
      if (!(Number(position.tokensRemaining || 0) > 0)) continue;
      if (!(actionSol >= Number(policy.minFreshBuySol))) continue;
      if (!Number.isFinite(atMs) || atMs > nowMs || nowMs - atMs > maxAgeMs) continue;

      if (!byMint.has(position.mint)) {
        byMint.set(position.mint, {
          mint: position.mint,
          source: 'wallet_watchlist+helius_fresh_buy',
          qualifiedWallets: [],
          latestBuyAt: null
        });
      }
      const bucket = byMint.get(position.mint);
      if (!bucket.latestBuyAt || position.lastTxAt > bucket.latestBuyAt) {
        bucket.latestBuyAt = position.lastTxAt;
      }
      bucket.qualifiedWallets.push({
        walletAddress: assessment.walletAddress,
        name: assessment.name,
        grade: assessment.grade,
        buyAt: position.lastTxAt,
        buySignature: position.lastActionSignature || null,
        buySol: compact(actionSol),
        realizedPositions: assessment.metrics?.realizedPositions || 0,
        medianPnlSol: assessment.metrics?.medianPnlSol ?? null,
        exTop3TotalPnlSol: assessment.metrics?.exTop3TotalPnlSol ?? null
      });
    }
  }

  return Array.from(byMint.values())
    .map((bucket) => {
      const uniqueWallets = Array.from(new Map(
        bucket.qualifiedWallets.map((wallet) => [wallet.walletAddress, wallet])
      ).values());
      const latestMs = Date.parse(bucket.latestBuyAt || 0);
      const qualifiedWalletCount = uniqueWallets.length;
      return {
        ...bucket,
        qualifiedWallets: uniqueWallets,
        qualifiedWalletCount,
        gradeAWalletCount: uniqueWallets.filter((wallet) => wallet.grade === 'A').length,
        ageMinutes: Number.isFinite(latestMs) ? compact((nowMs - latestMs) / 60_000, 2) : null,
        walletAuditEligible: qualifiedWalletCount >= Number(policy.minQualifiedWalletsPerMint)
      };
    })
    .sort((left, right) => (
      Number(right.walletAuditEligible) - Number(left.walletAuditEligible)
      || Number(right.qualifiedWalletCount) - Number(left.qualifiedWalletCount)
      || Number(left.ageMinutes || Infinity) - Number(right.ageMinutes || Infinity)
    ));
}

module.exports = {
  DEFAULT_POLICY,
  EXCLUDED_FLOW_MINTS,
  buildFreshWalletFlow,
  compact,
  exTop,
  finite,
  gradeWalletEvidence,
  median,
  summarizeLeaderboard
};
