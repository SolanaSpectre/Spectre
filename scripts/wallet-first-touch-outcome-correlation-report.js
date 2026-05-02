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

function compactOutcome(item = {}) {
  return {
    mint: item.mint || null,
    symbol: item.symbol || null,
    name: item.name || null,
    outcome: item.outcome || null,
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
  const ledgerItems = list(outcomeLedger, ['topFalseNegativeCandidates', 'falseNegativeCandidates', 'topFalseNegatives']);

  for (const item of [...ledgerItems, ...falseNegativeItems]) {
    if (!item || !item.mint) continue;
    byMint.set(item.mint, compactOutcome(item));
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
    matchedOutcomeDetail,
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

function buildReport() {
  const firstTouch = readJson(FIRST_TOUCH_PATH);
  const outcomeLedger = readJson(OUTCOME_LEDGER_PATH);
  const falseNegative = readJson(FALSE_NEGATIVE_PATH);

  const outcomeByMint = buildOutcomeMap(outcomeLedger, falseNegative);
  const clusters = list(firstTouch, ['clusters']).map((cluster) => compactCluster(cluster, outcomeByMint));
  const matched = clusters.filter((row) => row.matchedOutcomeDetail);
  const unmatched = clusters.filter((row) => !row.matchedOutcomeDetail);
  const base = baseRates(outcomeLedger.summary?.outcomeCounts || {});
  const priorityClusters = clusters.filter((row) => row.recommendation === 'paper_watch_priority');
  const highScoreClusters = clusters.filter((row) => row.firstTouchScore >= 75);
  const multiWalletClusters = clusters.filter((row) => row.uniqueWalletCount >= 3);
  const sniperCrowdingClusters = clusters.filter((row) => row.riskFlags.includes('sniper_crowding'));

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
      matchedOutcomeDetails: matched.length,
      unknownOutcomeDetails: unmatched.length,
      matchedOutcomeDetailRate: pct(matched.length, clusters.length),
      outcomeCounts: countBy(clusters, (row) => row.outcomeLabel),
      knownOutcomeCounts: countBy(matched, (row) => row.outcomeLabel),
      baseOutcomeCounts: outcomeLedger.summary?.outcomeCounts || {},
      baseOutcomeRates: base.rates,
      baseOutcomeTotalMints: base.total,
      migratedOrNearMigrationMatchedCount: matched.filter((row) => ['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85'].includes(row.outcomeLabel)).length,
      tinyDenominatorWarning: clusters.length < 30 || matched.length < 5,
      interpretation: matched.length < 5
        ? 'insufficient matched outcome detail; wallet first-touch clusters exist, but this run cannot prove edge'
        : 'matched outcome detail is available; inspect known outcome distribution before changing any wallet weighting'
    },
    byRecommendation: summarizeGroups(clusters, 'recommendation'),
    byScoreBucket: summarizeGroups(clusters, 'scoreBucket'),
    byWalletClusterBucket: summarizeGroups(clusters, 'walletClusterBucket'),
    bySolBucket: summarizeGroups(clusters, 'solBucket'),
    byRiskBucket: summarizeGroups(clusters, 'riskBucket'),
    clusters,
    topMatchedOutcomes,
    topUnmatchedClusters,
    note: 'Report-only wallet first-touch to outcome correlation. Unknown outcome detail means the mint was not present in the false-negative detail set, not proof of success or failure. Does not change trust tiers, wallet scoring, entries, signals, AI review, or live behavior.'
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
