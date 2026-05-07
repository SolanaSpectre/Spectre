const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIRST_TOUCH_PATH = path.join(ROOT, 'data', 'reports', 'wallet-first-touch-latest.json');
const OUTCOME_LEDGER_PATH = path.join(ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'wallet-first-touch-outcome-corr-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function list(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function scoreBucket(score) {
  const n = num(score, 0);
  if (n >= 90) return 'score_90_plus';
  if (n >= 75) return 'score_75_89';
  return 'score_under_75';
}

function walletClusterBucket(uniqueWalletCount) {
  const n = num(uniqueWalletCount, 0);
  if (n >= 3) return 'multi_wallet_3_plus';
  if (n === 2) return 'pair';
  return 'single';
}

function solBucket(totalFirstTouchSol) {
  const n = num(totalFirstTouchSol, 0);
  if (n >= 5) return 'large_5_sol_plus';
  if (n >= 1) return 'medium_1_to_5_sol';
  return 'small_under_1_sol';
}

function riskBucket(riskFlags = []) {
  return Array.isArray(riskFlags) && riskFlags.includes('sniper_crowding')
    ? 'sniper_crowding'
    : 'no_sniper_crowding';
}

function clusterArchetype(cluster = {}) {
  const riskFlags = Array.isArray(cluster.riskFlags) ? cluster.riskFlags : [];
  const phases = Array.isArray(cluster.phases) ? cluster.phases : [];
  const uniqueWalletCount = num(cluster.uniqueWalletCount, 0);
  const buyWalletCount = num(cluster.buyWalletCount, 0);
  const sellWalletCount = num(cluster.sellWalletCount, 0);
  const totalFirstTouchSol = num(cluster.totalFirstTouchSol, 0);
  const earliestSeconds = nullableNum(cluster.earliestSecondsSinceCreate);
  const windowSeconds = nullableNum(cluster.firstTouchWindowSeconds);

  if (riskFlags.includes('sniper_crowding')) return 'sniper_crowded_cluster';
  if (sellWalletCount > 0 || phases.includes('post_migration')) return 'mixed_or_late_cluster';
  if (
    uniqueWalletCount >= 3
    && buyWalletCount >= 3
    && totalFirstTouchSol >= 3
    && (earliestSeconds === null || earliestSeconds <= 60)
    && (windowSeconds === null || windowSeconds <= 90)
  ) {
    return 'clean_early_support_cluster';
  }
  if (uniqueWalletCount >= 3) return 'multi_wallet_watch_cluster';
  if (uniqueWalletCount >= 2) return 'pair_watch_cluster';
  return 'single_wallet_touch';
}

function outcomeRank(outcome) {
  const ranks = {
    MIGRATED_OR_COMPLETED: 6,
    PAPER_WIN: 5,
    NEAR_MIGRATION_85: 4,
    INTERESTING_75: 3,
    PAPER_LOSS: 2,
    WATCHED_BUT_FADED: 1,
    OBSERVED_ONLY: 0
  };
  return ranks[outcome] ?? -1;
}

function compactOutcome(item = {}, detailSource = 'unknown') {
  return {
    mint: item.mint || null,
    symbol: item.symbol || null,
    name: item.name || null,
    outcome: item.outcome || null,
    detailSource,
    hasFalseNegativeDetail: detailSource === 'false_negative_detail',
    falseNegativePriority: nullableNum(item.falseNegativePriority),
    firstSeenAt: item.firstSeenAt || null,
    firstFlagAt: item.firstFlagAt || null,
    migratedAt: item.migratedAt || null,
    secondsFlagTo85: nullableNum(item.secondsFlagTo85),
    secondsFlagTo95: nullableNum(item.secondsFlagTo95),
    secondsFlagToMigration: nullableNum(item.secondsFlagToMigration),
    maxScore: nullableNum(item.maxScore),
    maxCurveProgress: nullableNum(item.maxCurveProgress),
    maxRecentVolumeSol: nullableNum(item.maxRecentVolumeSol),
    maxTradeVelocityPerMin: nullableNum(item.maxTradeVelocityPerMin),
    paperEntries: num(item.paperEntries, 0),
    paperPnlSol: nullableNum(item.paperPnlSol),
    paperSkips: item.paperSkips || {},
    tradeRejections: item.tradeRejections || {},
    reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 12) : []
  };
}

function buildOutcomeMap(outcomeLedger, falseNegativePayload) {
  const byMint = new Map();
  const falseNegativeItems = list(falseNegativePayload, ['watchlist', 'candidates', 'items']);
  const broadLedgerItems = list(outcomeLedger, ['outcomes']);
  const detailedLedgerItems = [
    ...list(outcomeLedger, ['topMigratedOrNearRunner']),
    ...list(outcomeLedger, ['topFalseNegativeCandidates', 'falseNegativeCandidates', 'topFalseNegatives'])
  ];

  for (const item of broadLedgerItems) {
    if (!item || !item.mint) continue;
    byMint.set(item.mint, compactOutcome(item, 'outcome_ledger'));
  }

  for (const item of detailedLedgerItems) {
    if (!item || !item.mint) continue;
    byMint.set(item.mint, compactOutcome(item, 'outcome_ledger_detail'));
  }

  for (const item of falseNegativeItems) {
    if (!item || !item.mint) continue;
    byMint.set(item.mint, compactOutcome(item, 'false_negative_detail'));
  }

  return byMint;
}

function compactCluster(cluster, outcomeByMint) {
  const outcome = outcomeByMint.get(cluster.mint);
  const matchedOutcomeDetail = Boolean(outcome);
  const riskFlags = Array.isArray(cluster.riskFlags) ? cluster.riskFlags : [];

  return {
    mint: cluster.mint || null,
    symbol: cluster.symbol || null,
    normalizedSymbol: cluster.normalizedSymbol || null,
    name: cluster.name || null,
    recommendation: cluster.recommendation || null,
    firstTouchScore: num(cluster.firstTouchScore, 0),
    uniqueWalletCount: num(cluster.uniqueWalletCount, 0),
    buyWalletCount: num(cluster.buyWalletCount, 0),
    sellWalletCount: num(cluster.sellWalletCount, 0),
    totalFirstTouchSol: num(cluster.totalFirstTouchSol, 0),
    earliestSecondsSinceCreate: nullableNum(cluster.earliestSecondsSinceCreate),
    firstTouchWindowSeconds: nullableNum(cluster.firstTouchWindowSeconds),
    phases: Array.isArray(cluster.phases) ? cluster.phases : [],
    walletNames: Array.isArray(cluster.walletNames) ? cluster.walletNames.slice(0, 12) : [],
    riskFlags,
    reasons: Array.isArray(cluster.reasons) ? cluster.reasons.slice(0, 12) : [],
    scoreBucket: scoreBucket(cluster.firstTouchScore),
    walletClusterBucket: walletClusterBucket(cluster.uniqueWalletCount),
    solBucket: solBucket(cluster.totalFirstTouchSol),
    riskBucket: riskBucket(riskFlags),
    clusterArchetype: clusterArchetype(cluster),
    matchedOutcomeDetail,
    matchedFalseNegativeDetail: Boolean(outcome?.hasFalseNegativeDetail),
    outcomeDetailSource: outcome?.detailSource || 'missing',
    outcomeLabel: outcome?.outcome || 'UNKNOWN_IN_OUTCOME_DETAIL',
    outcome: outcome || null
  };
}

function summarizeGroups(rows, key) {
  const groups = {};
  for (const row of rows) {
    const groupKey = row[key] || 'UNKNOWN';
    if (!groups[groupKey]) {
      groups[groupKey] = {
        clusters: 0,
        matchedOutcomeDetails: 0,
        matchedFalseNegativeDetails: 0,
        outcomeCounts: {},
        migratedOrNearMigrationCount: 0,
        averageFirstTouchScore: null,
        averageUniqueWalletCount: null,
        averageTotalFirstTouchSol: null
      };
    }
    const group = groups[groupKey];
    group.clusters += 1;
    if (row.matchedOutcomeDetail) group.matchedOutcomeDetails += 1;
    if (row.matchedFalseNegativeDetail) group.matchedFalseNegativeDetails += 1;
    group.outcomeCounts[row.outcomeLabel] = (group.outcomeCounts[row.outcomeLabel] || 0) + 1;
    if (['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85'].includes(row.outcomeLabel)) {
      group.migratedOrNearMigrationCount += 1;
    }
  }

  for (const [groupKey, group] of Object.entries(groups)) {
    const members = rows.filter((row) => (row[key] || 'UNKNOWN') === groupKey);
    group.averageFirstTouchScore = Number((members.reduce((sum, row) => sum + row.firstTouchScore, 0) / members.length).toFixed(2));
    group.averageUniqueWalletCount = Number((members.reduce((sum, row) => sum + row.uniqueWalletCount, 0) / members.length).toFixed(2));
    group.averageTotalFirstTouchSol = Number((members.reduce((sum, row) => sum + row.totalFirstTouchSol, 0) / members.length).toFixed(4));
    group.matchedOutcomeDetailRate = pct(group.matchedOutcomeDetails, group.clusters);
  }

  return groups;
}

function baseRates(outcomeCounts = {}) {
  const total = Object.values(outcomeCounts).reduce((sum, value) => sum + num(value, 0), 0);
  const rates = {};
  for (const [outcome, count] of Object.entries(outcomeCounts)) {
    rates[outcome] = {
      count: num(count, 0),
      rate: pct(num(count, 0), total)
    };
  }
  return { total, rates };
}

function countOutcomes(rows, outcomes) {
  const wanted = new Set(outcomes);
  return rows.filter((row) => wanted.has(row.outcomeLabel)).length;
}

function rateLift(cohortRate, baseRate) {
  if (cohortRate === null || baseRate === null || baseRate === 0) return null;
  return Number((cohortRate / baseRate).toFixed(4));
}

function cohortComparison(label, rows, base) {
  const migrationOrNearOutcomes = ['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85', 'PAPER_WIN'];
  const interestingOrBetterOutcomes = [...migrationOrNearOutcomes, 'INTERESTING_75'];
  const matchedRows = rows.filter((row) => row.matchedOutcomeDetail);
  const baseMigrationOrNearCount = migrationOrNearOutcomes
    .reduce((sum, outcome) => sum + num(base.rates[outcome]?.count, 0), 0);
  const baseInterestingOrBetterCount = interestingOrBetterOutcomes
    .reduce((sum, outcome) => sum + num(base.rates[outcome]?.count, 0), 0);
  const migrationOrNearCount = countOutcomes(rows, migrationOrNearOutcomes);
  const interestingOrBetterCount = countOutcomes(rows, interestingOrBetterOutcomes);
  const matchedMigrationOrNearCount = countOutcomes(matchedRows, migrationOrNearOutcomes);
  const matchedInterestingOrBetterCount = countOutcomes(matchedRows, interestingOrBetterOutcomes);
  const migrationOrNearRate = pct(migrationOrNearCount, rows.length);
  const interestingOrBetterRate = pct(interestingOrBetterCount, rows.length);
  const matchedMigrationOrNearRate = pct(matchedMigrationOrNearCount, matchedRows.length);
  const matchedInterestingOrBetterRate = pct(matchedInterestingOrBetterCount, matchedRows.length);
  const baseMigrationOrNearRate = pct(baseMigrationOrNearCount, base.total);
  const baseInterestingOrBetterRate = pct(baseInterestingOrBetterCount, base.total);

  return {
    label,
    clusters: rows.length,
    matchedClusters: matchedRows.length,
    unmatchedClusters: rows.length - matchedRows.length,
    outcomeCoverageRate: pct(matchedRows.length, rows.length),
    outcomeCounts: countBy(rows, (row) => row.outcomeLabel),
    migrationOrNearCount,
    migrationOrNearRate,
    baseMigrationOrNearRate,
    migrationOrNearLiftVsBase: rateLift(migrationOrNearRate, baseMigrationOrNearRate),
    matchedMigrationOrNearCount,
    matchedMigrationOrNearRate,
    matchedMigrationOrNearLiftVsBase: rateLift(matchedMigrationOrNearRate, baseMigrationOrNearRate),
    interestingOrBetterCount,
    interestingOrBetterRate,
    baseInterestingOrBetterRate,
    interestingOrBetterLiftVsBase: rateLift(interestingOrBetterRate, baseInterestingOrBetterRate),
    matchedInterestingOrBetterCount,
    matchedInterestingOrBetterRate,
    matchedInterestingOrBetterLiftVsBase: rateLift(matchedInterestingOrBetterRate, baseInterestingOrBetterRate),
    tinyDenominatorWarning: rows.length < 10 || matchedRows.length < 5 || matchedMigrationOrNearCount < 3
  };
}

function paperPnlByGroup(rows, key) {
  const groups = {};
  for (const row of rows) {
    const groupKey = row[key] || 'UNKNOWN';
    const paperEntries = num(row.outcome?.paperEntries, 0);
    const paperPnlSol = nullableNum(row.outcome?.paperPnlSol);
    const entered = paperEntries > 0 || ['PAPER_WIN', 'PAPER_LOSS'].includes(row.outcomeLabel);

    if (!groups[groupKey]) {
      groups[groupKey] = {
        clusters: 0,
        paperEnteredClusters: 0,
        paperWins: 0,
        paperLosses: 0,
        totalPaperEntries: 0,
        totalPaperPnlSol: 0,
        averagePaperPnlSol: null,
        migrationOrNearCount: 0,
        interestingOrBetterCount: 0,
        movementWithoutPaperProfit: false
      };
    }

    const group = groups[groupKey];
    group.clusters += 1;
    group.totalPaperEntries += paperEntries;
    if (entered) group.paperEnteredClusters += 1;
    if (row.outcomeLabel === 'PAPER_WIN') group.paperWins += 1;
    if (row.outcomeLabel === 'PAPER_LOSS') group.paperLosses += 1;
    if (['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85', 'PAPER_WIN'].includes(row.outcomeLabel)) {
      group.migrationOrNearCount += 1;
    }
    if (['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85', 'PAPER_WIN', 'INTERESTING_75'].includes(row.outcomeLabel)) {
      group.interestingOrBetterCount += 1;
    }
    if (paperPnlSol !== null) {
      group.totalPaperPnlSol = Number((group.totalPaperPnlSol + paperPnlSol).toFixed(6));
    }
  }

  for (const group of Object.values(groups)) {
    group.averagePaperPnlSol = group.paperEnteredClusters > 0
      ? Number((group.totalPaperPnlSol / group.paperEnteredClusters).toFixed(6))
      : null;
    group.paperWinRate = pct(group.paperWins, group.paperWins + group.paperLosses);
    group.movementWithoutPaperProfit = group.interestingOrBetterCount > 0 && group.totalPaperPnlSol <= 0;
  }

  return groups;
}

function buildReport() {
  const firstTouch = readJson(FIRST_TOUCH_PATH);
  const outcomeLedger = readJson(OUTCOME_LEDGER_PATH);
  const falseNegative = readJson(FALSE_NEGATIVE_PATH);

  const outcomeByMint = buildOutcomeMap(outcomeLedger, falseNegative);
  const clusters = list(firstTouch, ['clusters']).map((cluster) => compactCluster(cluster, outcomeByMint));
  const matched = clusters.filter((row) => row.matchedOutcomeDetail);
  const unmatched = clusters.filter((row) => !row.matchedOutcomeDetail);
  const falseNegativeDetailMatched = clusters.filter((row) => row.matchedFalseNegativeDetail);
  const broadOutcomeMatched = clusters.filter((row) => row.matchedOutcomeDetail && !row.matchedFalseNegativeDetail);
  const base = baseRates(outcomeLedger.summary?.outcomeCounts || {});
  const priorityClusters = clusters.filter((row) => row.recommendation === 'paper_watch_priority');
  const highScoreClusters = clusters.filter((row) => row.firstTouchScore >= 75);
  const multiWalletClusters = clusters.filter((row) => row.uniqueWalletCount >= 3);
  const sniperCrowdingClusters = clusters.filter((row) => row.riskFlags.includes('sniper_crowding'));
  const cleanEarlySupportClusters = clusters.filter((row) => row.clusterArchetype === 'clean_early_support_cluster');
  const mixedOrLateClusters = clusters.filter((row) => row.clusterArchetype === 'mixed_or_late_cluster');
  const cohortComparisons = {
    allClusters: cohortComparison('allClusters', clusters, base),
    priorityClusters: cohortComparison('priorityClusters', priorityClusters, base),
    highScoreClusters: cohortComparison('highScoreClusters', highScoreClusters, base),
    multiWalletClusters: cohortComparison('multiWalletClusters', multiWalletClusters, base),
    sniperCrowdingClusters: cohortComparison('sniperCrowdingClusters', sniperCrowdingClusters, base),
    cleanEarlySupportClusters: cohortComparison('cleanEarlySupportClusters', cleanEarlySupportClusters, base),
    mixedOrLateClusters: cohortComparison('mixedOrLateClusters', mixedOrLateClusters, base)
  };

  const topMatchedOutcomes = matched
    .slice()
    .sort((a, b) => {
      const outcomeDiff = outcomeRank(b.outcomeLabel) - outcomeRank(a.outcomeLabel);
      if (outcomeDiff) return outcomeDiff;
      return num(b.outcome?.falseNegativePriority, 0) - num(a.outcome?.falseNegativePriority, 0)
        || num(b.outcome?.maxCurveProgress, 0) - num(a.outcome?.maxCurveProgress, 0)
        || b.firstTouchScore - a.firstTouchScore;
    })
    .slice(0, 15);

  const topUnmatchedClusters = unmatched
    .slice()
    .sort((a, b) => b.firstTouchScore - a.firstTouchScore || b.uniqueWalletCount - a.uniqueWalletCount || b.totalFirstTouchSol - a.totalFirstTouchSol)
    .slice(0, 15);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      walletFirstTouchPath: rel(FIRST_TOUCH_PATH),
      outcomeLedgerPath: rel(OUTCOME_LEDGER_PATH),
      falseNegativePath: rel(FALSE_NEGATIVE_PATH)
    },
    inputs: {
      walletFirstTouchGeneratedAt: firstTouch.generatedAt || null,
      outcomeLedgerGeneratedAt: outcomeLedger.generatedAt || null,
      falseNegativeGeneratedAt: falseNegative.generatedAt || null,
      outcomeLedgerUniqueMints: outcomeLedger.summary?.uniqueMints ?? null,
      outcomeLedgerFalseNegativeCandidates: outcomeLedger.summary?.falseNegativeCandidates ?? null
    },
    summary: {
      clusters: clusters.length,
      priorityClusters: priorityClusters.length,
      highScoreClusters: highScoreClusters.length,
      multiWalletClusters: multiWalletClusters.length,
      sniperCrowdingClusters: sniperCrowdingClusters.length,
      cleanEarlySupportClusters: cleanEarlySupportClusters.length,
      mixedOrLateClusters: mixedOrLateClusters.length,
      matchedOutcomeDetails: matched.length,
      matchedFalseNegativeDetails: falseNegativeDetailMatched.length,
      broadOutcomeMatches: broadOutcomeMatched.length,
      unknownOutcomeDetails: unmatched.length,
      matchedOutcomeDetailRate: pct(matched.length, clusters.length),
      falseNegativeDetailRate: pct(falseNegativeDetailMatched.length, clusters.length),
      outcomeCounts: countBy(clusters, (row) => row.outcomeLabel),
      knownOutcomeCounts: countBy(matched, (row) => row.outcomeLabel),
      clusterArchetypeCounts: countBy(clusters, (row) => row.clusterArchetype),
      paperPnlByArchetype: paperPnlByGroup(clusters, 'clusterArchetype'),
      outcomeDetailSourceCounts: countBy(clusters, (row) => row.outcomeDetailSource),
      baseOutcomeCounts: outcomeLedger.summary?.outcomeCounts || {},
      baseOutcomeRates: base.rates,
      baseOutcomeTotalMints: base.total,
      migratedOrNearMigrationMatchedCount: matched.filter((row) => ['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85'].includes(row.outcomeLabel)).length,
      cohortComparisons,
      tinyDenominatorWarning: clusters.length < 30 || matched.length < 5,
      interpretation: matched.length < clusters.length
        ? 'some wallet clusters still lack broad outcome detail; read cohort lift with the matched/outcome-coverage denominator and do not change wallet weighting'
        : 'broad outcome labels are available; inspect matched denominator, cohort distribution, and tiny-denominator warning before changing any wallet weighting'
    },
    byRecommendation: summarizeGroups(clusters, 'recommendation'),
    byScoreBucket: summarizeGroups(clusters, 'scoreBucket'),
    byWalletClusterBucket: summarizeGroups(clusters, 'walletClusterBucket'),
    bySolBucket: summarizeGroups(clusters, 'solBucket'),
    byRiskBucket: summarizeGroups(clusters, 'riskBucket'),
    byClusterArchetype: summarizeGroups(clusters, 'clusterArchetype'),
    clusters,
    topMatchedOutcomes,
    topUnmatchedClusters,
    note: 'Report-only wallet first-touch to outcome correlation. Broad outcome labels come from the full outcome ledger; false-negative detail remains separately marked. Cluster archetypes are descriptive only: clean_early_support_cluster means early multi-wallet buy support without sniper_crowding, sniper_crowded_cluster means the existing first-touch risk flag fired, and mixed_or_late_cluster means sells or post-migration touches are present. paperPnlByArchetype separates movement detection from realized paper outcome; movementWithoutPaperProfit means the archetype found interesting/migrating mints but summed paper PnL is not positive. Unknown outcome detail means the mint was not present in the available outcome ledger, not proof of success or failure. Cohort lift compares cohort outcome rates against full-ledger base rates; matched* fields use only clusters with outcome detail, while non-matched fields retain unmatched clusters in the denominator. Cohorts with weak outcome coverage or tiny denominators must not be used for wallet weighting. Does not change trust tiers, wallet scoring, entries, signals, AI review, or live behavior.'
  };
}

function main() {
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

main();
