const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LEDGER_PATH = path.join(REPO_ROOT, 'data', 'outcomes', 'outcome-ledger.jsonl');
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const DEFAULT_WATCHLIST_PATH = path.join(REPO_ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
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

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function numberOrNull(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return numberOrNull((end - start) / 1000, 2);
}

function getRecord(records, mint) {
  if (!records.has(mint)) {
    records.set(mint, {
      mint,
      symbol: null,
      name: null,
      firstSeenAt: null,
      lastSeenAt: null,
      firstFlagAt: null,
      firstDecisionAt: null,
      firstRejectAt: null,
      migratedAt: null,
      eventCount: 0,
      flags: 0,
      observations: 0,
      nearMisses: 0,
      paperEntries: 0,
      paperExits: 0,
      paperPnlSol: 0,
      tradeRejections: {},
      paperSkips: {},
      reasons: new Set(),
      decisions: {},
      sources: {},
      maxScore: null,
      maxCurveProgress: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxLiquidityUsd: null,
      maxPriceChange1hPct: null,
      maxPriceChange6hPct: null,
      maxPriceChange24hPct: null,
      curve75At: null,
      curve85At: null,
      curve95At: null,
      curve100At: null,
      latest: null,
      samples: []
    });
  }
  return records.get(mint);
}

function increment(bucket, key) {
  if (!key) return;
  bucket[key] = (bucket[key] || 0) + 1;
}

function updateMax(record, key, value, decimals = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const current = Number(record[key]);
  record[key] = !Number.isFinite(current) ? numberOrNull(numeric, decimals) : numberOrNull(Math.max(current, numeric), decimals);
}

function updateCurveThresholds(record, event) {
  const curve = Number(event.curveProgress ?? event.market?.maxCurveProgress);
  if (!Number.isFinite(curve)) return;

  if (!record.curve75At && curve >= 0.75) record.curve75At = event.timestamp;
  if (!record.curve85At && curve >= 0.85) record.curve85At = event.timestamp;
  if (!record.curve95At && curve >= 0.95) record.curve95At = event.timestamp;
  if (!record.curve100At && curve >= 1) record.curve100At = event.timestamp;
}

function applyEvent(record, event) {
  record.eventCount += 1;
  record.symbol = record.symbol || event.symbol || null;
  record.name = record.name || event.name || null;
  record.firstSeenAt = record.firstSeenAt || event.timestamp;
  record.lastSeenAt = event.timestamp || record.lastSeenAt;
  record.latest = event;
  increment(record.sources, event.source || 'unknown');
  increment(record.decisions, event.decision || event.kind || 'unknown');

  if (event.reason) {
    record.reasons.add(event.reason);
  }
  if (Array.isArray(event.reasons)) {
    event.reasons.forEach((reason) => record.reasons.add(reason));
  }

  if (event.kind === 'candidate.flagged') {
    record.flags += 1;
    record.firstFlagAt = record.firstFlagAt || event.timestamp;
  } else if (event.kind === 'candidate.observed') {
    record.observations += 1;
  } else if (event.kind === 'candidate.migrated') {
    record.migratedAt = record.migratedAt || event.timestamp;
  } else if (event.kind === 'paper.near_miss') {
    record.nearMisses += 1;
  } else if (event.kind === 'paper.entry') {
    record.paperEntries += 1;
  } else if (event.kind === 'paper.exit') {
    record.paperExits += 1;
    record.paperPnlSol += Number(event.paper?.pnlSol || 0);
  } else if (event.kind === 'paper.skipped') {
    increment(record.paperSkips, event.reason || 'UNKNOWN');
  } else if (event.kind === 'trade.rejected') {
    increment(record.tradeRejections, event.reason || 'UNKNOWN');
    record.firstRejectAt = record.firstRejectAt || event.timestamp;
  }

  if (event.decision && !record.firstDecisionAt) {
    record.firstDecisionAt = event.timestamp;
  }

  if (event.market?.migratedAt && !record.migratedAt) {
    record.migratedAt = event.market.migratedAt;
  }

  updateMax(record, 'maxScore', event.score, 2);
  updateMax(record, 'maxCurveProgress', event.curveProgress ?? event.market?.maxCurveProgress, 6);
  updateMax(record, 'maxRecentVolumeSol', event.recentVolumeSol ?? event.market?.recentVolumeSol, 4);
  updateMax(record, 'maxTradeVelocityPerMin', event.tradeVelocityPerMin ?? event.tradeVelocity ?? event.market?.tradeVelocityPerMin, 2);
  updateMax(record, 'maxLiquidityUsd', event.liquidityUsd ?? event.market?.liquidityUsd, 2);
  updateMax(record, 'maxPriceChange1hPct', event.priceChange1hPct ?? event.market?.priceChange1hPct, 2);
  updateMax(record, 'maxPriceChange6hPct', event.priceChange6hPct ?? event.market?.priceChange6hPct, 2);
  updateMax(record, 'maxPriceChange24hPct', event.priceChange24hPct ?? event.market?.priceChange24hPct, 2);
  updateCurveThresholds(record, event);

  if (
    record.samples.length < 20 ||
    ['candidate.flagged', 'candidate.migrated', 'paper.entry', 'paper.exit', 'trade.rejected'].includes(event.kind)
  ) {
    record.samples.push({
      timestamp: event.timestamp,
      kind: event.kind,
      source: event.source,
      decision: event.decision || null,
      reason: event.reason || null,
      score: numberOrNull(event.score, 2),
      curveProgress: numberOrNull(event.curveProgress ?? event.market?.maxCurveProgress, 6),
      recentVolumeSol: numberOrNull(event.recentVolumeSol ?? event.market?.recentVolumeSol, 4),
      tradeVelocityPerMin: numberOrNull(event.tradeVelocityPerMin ?? event.tradeVelocity ?? event.market?.tradeVelocityPerMin, 2)
    });
    record.samples = record.samples.slice(-30);
  }
}

function classifyOutcome(record) {
  if (record.paperExits > 0 && Number(record.paperPnlSol || 0) > 0) return 'PAPER_WIN';
  if (record.paperExits > 0 && Number(record.paperPnlSol || 0) <= 0) return 'PAPER_LOSS';
  if (record.paperEntries > 0) return 'PAPER_OPEN_OR_UNRESOLVED';
  if (record.migratedAt || Number(record.maxCurveProgress || 0) >= 1) return 'MIGRATED_OR_COMPLETED';
  if (Number(record.maxCurveProgress || 0) >= 0.95) return 'NEAR_RUNNER_95';
  if (Number(record.maxCurveProgress || 0) >= 0.85) return 'NEAR_MIGRATION_85';
  if (Number(record.maxCurveProgress || 0) >= 0.75) return 'INTERESTING_75';
  if (record.flags > 0 || record.nearMisses > 0) return 'WATCHED_BUT_FADED';
  if (Object.keys(record.tradeRejections).length > 0 || Object.keys(record.paperSkips).length > 0) return 'REJECTED_ONLY';
  return 'OBSERVED_ONLY';
}

function falseNegativeScore(record, outcome) {
  if (record.paperEntries > 0) return 0;

  const curve = Number(record.maxCurveProgress || 0);
  const score = Number(record.maxScore || 0);
  const velocity = Number(record.maxTradeVelocityPerMin || 0);
  const volume = Number(record.maxRecentVolumeSol || 0);
  const rejected = Object.values(record.tradeRejections).reduce((sum, count) => sum + count, 0);
  const skipped = Object.values(record.paperSkips).reduce((sum, count) => sum + count, 0);
  const majorOutcome = ['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85'].includes(outcome);
  const curveScore = Math.min(curve * 80, 80);
  const signalScore = Math.min(score / 2, 40);
  const activityScore = Math.min(velocity, 30) + Math.min(volume / 2, 30);
  const decisionScore = Math.min((rejected + skipped + record.nearMisses + record.flags) * 4, 40);
  return majorOutcome ? numberOrNull(curveScore + signalScore + activityScore + decisionScore, 2) : 0;
}

function normalizeRecord(record) {
  const outcome = classifyOutcome(record);
  const falseNegativePriority = falseNegativeScore(record, outcome);
  return {
    mint: record.mint,
    symbol: record.symbol,
    name: record.name,
    outcome,
    falseNegativePriority,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    firstFlagAt: record.firstFlagAt,
    firstRejectAt: record.firstRejectAt,
    migratedAt: record.migratedAt,
    secondsFlagTo85: secondsBetween(record.firstFlagAt, record.curve85At),
    secondsFlagTo95: secondsBetween(record.firstFlagAt, record.curve95At),
    secondsFlagToMigration: secondsBetween(record.firstFlagAt, record.migratedAt || record.curve100At),
    eventCount: record.eventCount,
    flags: record.flags,
    observations: record.observations,
    nearMisses: record.nearMisses,
    paperEntries: record.paperEntries,
    paperExits: record.paperExits,
    paperPnlSol: numberOrNull(record.paperPnlSol, 6),
    maxScore: numberOrNull(record.maxScore, 2),
    maxCurveProgress: numberOrNull(record.maxCurveProgress, 6),
    maxRecentVolumeSol: numberOrNull(record.maxRecentVolumeSol, 4),
    maxTradeVelocityPerMin: numberOrNull(record.maxTradeVelocityPerMin, 2),
    maxLiquidityUsd: numberOrNull(record.maxLiquidityUsd, 2),
    maxPriceChange1hPct: numberOrNull(record.maxPriceChange1hPct, 2),
    maxPriceChange6hPct: numberOrNull(record.maxPriceChange6hPct, 2),
    maxPriceChange24hPct: numberOrNull(record.maxPriceChange24hPct, 2),
    curve75At: record.curve75At,
    curve85At: record.curve85At,
    curve95At: record.curve95At,
    curve100At: record.curve100At,
    tradeRejections: record.tradeRejections,
    paperSkips: record.paperSkips,
    reasons: Array.from(record.reasons).slice(0, 20),
    decisions: record.decisions,
    sources: record.sources,
    samples: record.samples
  };
}

function buildReport(events, options = {}) {
  const records = new Map();
  const eventCounts = {};
  const sourceCounts = {};

  for (const event of events) {
    if (!event?.mint) continue;
    increment(eventCounts, event.kind || 'unknown');
    increment(sourceCounts, event.source || 'unknown');
    applyEvent(getRecord(records, event.mint), event);
  }

  const outcomes = Array.from(records.values())
    .map(normalizeRecord)
    .sort((a, b) => {
      if (Number(b.falseNegativePriority || 0) !== Number(a.falseNegativePriority || 0)) {
        return Number(b.falseNegativePriority || 0) - Number(a.falseNegativePriority || 0);
      }
      if (Number(b.maxCurveProgress || 0) !== Number(a.maxCurveProgress || 0)) {
        return Number(b.maxCurveProgress || 0) - Number(a.maxCurveProgress || 0);
      }
      return Number(b.maxScore || 0) - Number(a.maxScore || 0);
    });

  const outcomeCounts = {};
  outcomes.forEach((row) => increment(outcomeCounts, row.outcome));

  const falseNegativeCandidates = outcomes
    .filter((row) => Number(row.falseNegativePriority || 0) > 0)
    .slice(0, Number(options.falseNegativeLimit || 50));

  return {
    generatedAt: new Date().toISOString(),
    ledgerPath: options.ledgerPath,
    summary: {
      rawEvents: events.length,
      uniqueMints: outcomes.length,
      eventCounts,
      sourceCounts,
      outcomeCounts,
      falseNegativeCandidates: falseNegativeCandidates.length
    },
    topFalseNegativeCandidates: falseNegativeCandidates,
    topMigratedOrNearRunner: outcomes
      .filter((row) => ['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85'].includes(row.outcome))
      .slice(0, 50),
    recentOutcomes: outcomes.slice(0, 100),
    outcomes
  };
}

function buildWatchlist(report) {
  return {
    source: 'outcome_ledger_false_negative_watchlist',
    generatedAt: report.generatedAt,
    count: report.topFalseNegativeCandidates.length,
    watchlist: report.topFalseNegativeCandidates.map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      name: row.name,
      falseNegativePriority: row.falseNegativePriority,
      outcome: row.outcome,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
      firstFlagAt: row.firstFlagAt,
      firstRejectAt: row.firstRejectAt,
      migratedAt: row.migratedAt,
      secondsFlagTo85: row.secondsFlagTo85,
      secondsFlagTo95: row.secondsFlagTo95,
      secondsFlagToMigration: row.secondsFlagToMigration,
      eventCount: row.eventCount,
      flags: row.flags,
      observations: row.observations,
      nearMisses: row.nearMisses,
      paperEntries: row.paperEntries,
      paperExits: row.paperExits,
      paperPnlSol: row.paperPnlSol,
      maxScore: row.maxScore,
      maxCurveProgress: row.maxCurveProgress,
      maxRecentVolumeSol: row.maxRecentVolumeSol,
      maxTradeVelocityPerMin: row.maxTradeVelocityPerMin,
      maxLiquidityUsd: row.maxLiquidityUsd,
      maxPriceChange1hPct: row.maxPriceChange1hPct,
      maxPriceChange6hPct: row.maxPriceChange6hPct,
      maxPriceChange24hPct: row.maxPriceChange24hPct,
      curve75At: row.curve75At,
      curve85At: row.curve85At,
      curve95At: row.curve95At,
      curve100At: row.curve100At,
      whyInteresting: [
        `max curve ${numberOrNull(Number(row.maxCurveProgress || 0) * 100, 2)}%`,
        `max score ${row.maxScore ?? 'n/a'}`,
        `max volume ${row.maxRecentVolumeSol ?? 'n/a'} SOL`,
        `max velocity ${row.maxTradeVelocityPerMin ?? 'n/a'}/min`,
        `${row.nearMisses} near-miss event(s), ${Object.values(row.paperSkips || {}).reduce((sum, count) => sum + count, 0)} paper skip(s), ${Object.values(row.tradeRejections || {}).reduce((sum, count) => sum + count, 0)} trade rejection(s)`
      ],
      reasons: row.reasons,
      paperSkips: row.paperSkips,
      tradeRejections: row.tradeRejections,
      decisions: row.decisions,
      sources: row.sources,
      samples: row.samples
    }))
  };
}

function printReport(report) {
  console.log('Outcome Ledger Report');
  console.log(`Ledger: ${report.ledgerPath}`);
  console.log(`Events: ${report.summary.rawEvents}`);
  console.log(`Mints: ${report.summary.uniqueMints}`);
  console.log(`Outcomes: ${Object.entries(report.summary.outcomeCounts).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
  console.log(`False-negative candidates: ${report.summary.falseNegativeCandidates}`);

  report.topFalseNegativeCandidates.slice(0, 10).forEach((row, index) => {
    console.log(`${index + 1}. ${row.symbol || 'unknown'} ${row.mint} | ${row.outcome} | fn=${row.falseNegativePriority} | curve=${row.maxCurveProgress} score=${row.maxScore}`);
    console.log(`   skips=${JSON.stringify(row.paperSkips)} rejects=${JSON.stringify(row.tradeRejections)} reasons=${row.reasons.slice(0, 5).join(',')}`);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const ledgerPath = resolveRepoPath(args.ledger) || DEFAULT_LEDGER_PATH;
  const reportPath = resolveRepoPath(args.output) || DEFAULT_REPORT_PATH;
  const watchlistPath = resolveRepoPath(args.watchlist) || DEFAULT_WATCHLIST_PATH;

  const events = readJsonl(ledgerPath);
  const report = buildReport(events, {
    ledgerPath,
    falseNegativeLimit: args.falseNegativeLimit || 50
  });
  const watchlist = buildWatchlist(report);

  writeJson(reportPath, report);
  writeJson(watchlistPath, watchlist);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${reportPath}`);
  console.log(`Wrote watchlist: ${watchlistPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  buildWatchlist,
  readJsonl
};
