'use strict';

const DEFAULT_POLICY = Object.freeze({
  minLiquidityUsd: 25_000,
  aMinLiquidityUsd: 50_000,
  maxPriceImpactPct: 2,
  aMaxPriceImpactPct: 1.5,
  cautionTop10HolderPct: 65,
  aMinScore: 78,
  bMinScore: 62,
  aMinRecentTransactions: 10,
  bMinRecentTransactions: 3,
  aMinUniqueFeePayers: 5,
  bMinUniqueFeePayers: 2
});

const GRADE_ORDER = Object.freeze({ A: 0, B: 1, WATCH: 2, REJECT: 3 });

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function compact(value, decimals = 4) {
  const numeric = finite(value);
  return numeric === null ? null : Number(numeric.toFixed(decimals));
}

function percentOf(rawAmount, rawSupply) {
  const amount = finite(rawAmount);
  const supply = finite(rawSupply);
  if (amount === null || supply === null || supply <= 0) return null;
  return (amount / supply) * 100;
}

function summarizeHolderConcentration(largestAccounts = [], rawSupply = null) {
  const amounts = (Array.isArray(largestAccounts) ? largestAccounts : [])
    .map((row) => finite(row?.amount))
    .filter((value) => value !== null && value >= 0)
    .sort((a, b) => b - a);

  const totalFor = (count) => amounts.slice(0, count).reduce((sum, value) => sum + value, 0);
  return {
    measuredAccounts: amounts.length,
    top1Pct: compact(percentOf(totalFor(1), rawSupply), 4),
    top5Pct: compact(percentOf(totalFor(5), rawSupply), 4),
    top10Pct: compact(percentOf(totalFor(10), rawSupply), 4),
    scope: 'raw_token_accounts_including_pool_and_program_vaults'
  };
}

function summarizeSignatures(signatures = [], nowMs = Date.now(), windowMinutes = 5) {
  const rows = Array.isArray(signatures) ? signatures : [];
  const windowMs = Math.max(1, Number(windowMinutes || 5)) * 60_000;
  const recent = rows.filter((row) => {
    const atMs = Number(row?.blockTime || 0) * 1000;
    return atMs > 0 && atMs <= nowMs && nowMs - atMs <= windowMs;
  });
  return {
    signaturesFetched: rows.length,
    windowMinutes: Number(windowMinutes || 5),
    recentTransactions: recent.length,
    recentSuccessfulTransactions: recent.filter((row) => !row?.err).length,
    recentFailedTransactions: recent.filter((row) => Boolean(row?.err)).length,
    newestBlockTime: rows[0]?.blockTime || null
  };
}

function summarizeEnhancedTransactions(transactions = [], nowMs = Date.now(), windowMinutes = 5) {
  const rows = Array.isArray(transactions) ? transactions : [];
  const windowMs = Math.max(1, Number(windowMinutes || 5)) * 60_000;
  const recent = rows.filter((row) => {
    const atMs = Number(row?.timestamp || 0) * 1000;
    return atMs > 0 && atMs <= nowMs && nowMs - atMs <= windowMs;
  });
  const feePayers = new Set(recent.map((row) => row?.feePayer).filter(Boolean));
  const sources = Array.from(new Set(recent.map((row) => row?.source).filter(Boolean))).sort();
  return {
    enhancedTransactionsFetched: rows.length,
    recentEnhancedTransactions: recent.length,
    uniqueFeePayers: feePayers.size,
    recentSwapTransactions: recent.filter((row) => row?.type === 'SWAP').length,
    sources
  };
}

function quoteForSize(quotes = [], sizeUsd) {
  return (Array.isArray(quotes) ? quotes : []).find(
    (quote) => Number(quote?.sizeUsd) === Number(sizeUsd)
  ) || null;
}

function quoteUsable(quote, maxPriceImpactPct) {
  return Boolean(
    quote?.available
    && finite(quote.priceImpactPct) !== null
    && Number(quote.priceImpactPct) <= Number(maxPriceImpactPct)
  );
}

function reportCount(specimen = {}) {
  return Array.isArray(specimen?.rickOverlap?.reportTypes)
    ? specimen.rickOverlap.reportTypes.length
    : 0;
}

function hasRisk(specimen = {}, name) {
  return Array.isArray(specimen.riskFlags) && specimen.riskFlags.includes(name);
}

function gradeCandidate(candidate, suppliedPolicy = {}) {
  const policy = { ...DEFAULT_POLICY, ...(suppliedPolicy || {}) };
  const specimen = candidate?.specimen || {};
  const onchain = candidate?.onchain || {};
  const activity = candidate?.activity || {};
  const blockers = [];
  const cautions = [];
  const reasons = [];
  const quote10 = quoteForSize(candidate?.quotes, 10) || candidate?.quotes?.[0] || null;
  const quote15 = quoteForSize(candidate?.quotes, 15) || candidate?.quotes?.[1] || null;
  const liquidityUsd = finite(specimen.liquidityUsd) || 0;
  const top10Pct = finite(onchain?.holders?.top10Pct);
  const recentTransactions = finite(activity?.signatures?.recentSuccessfulTransactions) || 0;
  const uniqueFeePayers = finite(activity?.enhanced?.uniqueFeePayers) || 0;
  const baseScore = finite(specimen.continuationScore) || 0;
  let adjustedScore = baseScore;

  if (specimen.status !== 'resolved' || !specimen.mint) blockers.push('IDENTITY_UNRESOLVED');
  if (
    specimen.symbolCollision
    || (specimen.collision?.unresolved && specimen.identitySource !== 'exact_mint')
    || hasRisk(specimen, 'symbol_collision_unresolved')
  ) blockers.push('SYMBOL_COLLISION');
  if (onchain.coverage === 'available' && onchain.mint?.freezeAuthority) blockers.push('FREEZE_AUTHORITY_PRESENT');
  if (onchain.coverage === 'available' && onchain.mint?.mintAuthority) blockers.push('MINT_AUTHORITY_PRESENT');
  if (onchain.mint?.hasTransferHook) blockers.push('TOKEN_2022_TRANSFER_HOOK');
  if (liquidityUsd < Number(policy.minLiquidityUsd)) blockers.push('LOW_LIQUIDITY');
  if (!quote10?.available) blockers.push('NO_EXECUTABLE_10_USD_QUOTE');
  if (quote10?.available && !quoteUsable(quote10, policy.maxPriceImpactPct)) blockers.push('PRICE_IMPACT_OVER_LIMIT');

  if (onchain.coverage !== 'available') cautions.push('ONCHAIN_SAFETY_COVERAGE_MISSING');
  if (activity.coverage !== 'available') cautions.push('HELIUS_ACTIVITY_COVERAGE_MISSING');
  if (top10Pct !== null && top10Pct >= Number(policy.cautionTop10HolderPct)) {
    cautions.push('RAW_TOP10_CONCENTRATION_HIGH');
    adjustedScore -= 6;
  }
  if (hasRisk(specimen, 'late_vertical_chase')) {
    cautions.push('LATE_VERTICAL_CHASE');
    adjustedScore -= 8;
  }
  if (hasRisk(specimen, 'negative_one_hour')) {
    cautions.push('NEGATIVE_ONE_HOUR_TREND');
    adjustedScore -= 8;
  }
  if (hasRisk(specimen, 'sell_pressure')) {
    cautions.push('SELL_PRESSURE');
    adjustedScore -= 6;
  }

  if (quote10?.available && Number(quote10.priceImpactPct) <= 0.5) {
    adjustedScore += 5;
    reasons.push('LOW_10_USD_PRICE_IMPACT');
  } else if (quote10?.available && Number(quote10.priceImpactPct) <= 1) {
    adjustedScore += 3;
    reasons.push('ACCEPTABLE_10_USD_PRICE_IMPACT');
  }
  if (recentTransactions >= Number(policy.aMinRecentTransactions)) {
    adjustedScore += 6;
    reasons.push('ACTIVE_POOL_TAPE');
  } else if (recentTransactions >= Number(policy.bMinRecentTransactions)) {
    adjustedScore += 3;
    reasons.push('POOL_TAPE_PRESENT');
  }
  if (uniqueFeePayers >= Number(policy.aMinUniqueFeePayers)) {
    adjustedScore += 6;
    reasons.push('BROAD_RECENT_FEE_PAYER_SET');
  } else if (uniqueFeePayers >= Number(policy.bMinUniqueFeePayers)) {
    adjustedScore += 3;
    reasons.push('RECENT_FEE_PAYER_BREADTH');
  }
  if (reportCount(specimen) >= 2) {
    adjustedScore += 4;
    reasons.push('MULTI_RICK_REPORT_OVERLAP');
  }
  adjustedScore = Math.max(0, Math.min(100, adjustedScore));

  const fullCoverage = onchain.coverage === 'available' && activity.coverage === 'available';
  const entryTimingReady = !cautions.some((caution) => [
    'LATE_VERTICAL_CHASE',
    'NEGATIVE_ONE_HOUR_TREND',
    'SELL_PRESSURE'
  ].includes(caution));
  const aHolderCoverageReady = top10Pct === null
    || top10Pct < Number(policy.cautionTop10HolderPct);
  const aActivity = recentTransactions >= Number(policy.aMinRecentTransactions)
    || uniqueFeePayers >= Number(policy.aMinUniqueFeePayers);
  const bActivity = recentTransactions >= Number(policy.bMinRecentTransactions)
    || uniqueFeePayers >= Number(policy.bMinUniqueFeePayers);
  const aReady = blockers.length === 0
    && fullCoverage
    && entryTimingReady
    && aHolderCoverageReady
    && adjustedScore >= Number(policy.aMinScore)
    && liquidityUsd >= Number(policy.aMinLiquidityUsd)
    && quoteUsable(quote15, policy.aMaxPriceImpactPct)
    && aActivity;
  const bReady = blockers.length === 0
    && fullCoverage
    && entryTimingReady
    && adjustedScore >= Number(policy.bMinScore)
    && bActivity;

  let grade = 'WATCH';
  let sizeUsd = null;
  if (blockers.length > 0) {
    grade = 'REJECT';
  } else if (aReady) {
    grade = 'A';
    sizeUsd = Number(quote15?.sizeUsd || 15);
  } else if (bReady) {
    grade = 'B';
    sizeUsd = Number(quote10?.sizeUsd || 10);
  }

  return {
    grade,
    sizeUsd,
    adjustedScore: compact(adjustedScore, 2),
    baseContinuationScore: compact(baseScore, 2),
    blockers,
    cautions,
    reasons: Array.from(new Set([...(specimen.reasons || []), ...reasons])).slice(0, 20),
    coverage: {
      identity: specimen.status === 'resolved',
      onchain: onchain.coverage || 'missing',
      activity: activity.coverage || 'missing',
      quote10: quote10?.available === true,
      quote15: quote15?.available === true
    }
  };
}

function selectMiloPicks(candidates = [], maxPicks = 5) {
  return [...candidates]
    .filter((candidate) => ['A', 'B'].includes(candidate?.assessment?.grade))
    .sort((left, right) => {
      const gradeDelta = GRADE_ORDER[left.assessment.grade] - GRADE_ORDER[right.assessment.grade];
      if (gradeDelta !== 0) return gradeDelta;
      return Number(right.assessment.adjustedScore || 0) - Number(left.assessment.adjustedScore || 0);
    })
    .filter((candidate, index, rows) => rows.findIndex((row) => row.mint === candidate.mint) === index)
    .slice(0, Math.max(1, Number(maxPicks || 5)))
    .map((candidate) => ({
      mint: candidate.mint,
      symbol: candidate.symbol,
      grade: candidate.assessment.grade,
      sizeUsd: candidate.assessment.sizeUsd,
      score: candidate.assessment.adjustedScore,
      reason: candidate.assessment.reasons.slice(0, 5)
    }));
}

module.exports = {
  DEFAULT_POLICY,
  compact,
  finite,
  gradeCandidate,
  selectMiloPicks,
  summarizeEnhancedTransactions,
  summarizeHolderConcentration,
  summarizeSignatures
};
