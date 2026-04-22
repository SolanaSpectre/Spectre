const fs = require('fs');
const path = require('path');

const {
  DEFAULT_LOG_DIR,
  DEFAULT_STRATEGY,
  buildReport,
  compact,
  parseArgs,
  readJsonl,
  resolveRepoPath,
  writeJson
} = require('./pre-migration-paper-sim-report');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'pre-migration-signal-quality-latest.json');

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function eventPayload(event) {
  return event.payload || event.data || {};
}

function getMint(payload) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function resolveTelemetryFiles(args) {
  if (args.telemetry) {
    return String(args.telemetry)
      .split(',')
      .map((entry) => resolveRepoPath(entry.trim()))
      .filter(Boolean)
      .filter((filePath) => fs.existsSync(filePath));
  }

  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 5;
  return fs.readdirSync(DEFAULT_LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(DEFAULT_LOG_DIR, name);
      return { fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit)
    .map((entry) => entry.fullPath)
    .reverse();
}

function millisecondsBetween(a, b) {
  const left = new Date(a || 0).getTime();
  const right = new Date(b || 0).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return right - left;
}

function bucketScore(score) {
  if (!Number.isFinite(score)) return 'unknown';
  if (score < 80) return '<80';
  if (score < 84) return '80-83.99';
  return '84+';
}

function bucketCurve(curveProgress) {
  if (!Number.isFinite(curveProgress)) return 'unknown';
  if (curveProgress < 0.75) return '<75%';
  if (curveProgress < 0.85) return '75-85%';
  if (curveProgress < 0.92) return '85-92%';
  return '92%+';
}

function bucketUniqueBuyerRatio(uniqueBuyerRatio) {
  if (!Number.isFinite(uniqueBuyerRatio)) return 'unknown';
  if (uniqueBuyerRatio < 0.8) return '<0.80';
  if (uniqueBuyerRatio < 0.9) return '0.80-0.89';
  return '0.90+';
}

function bucketSnipers(sniperWalletCount) {
  if (!Number.isFinite(sniperWalletCount)) return 'unknown';
  if (sniperWalletCount <= 1) return '0-1';
  if (sniperWalletCount <= 3) return '2-3';
  return '4+';
}

function listMean(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return compact(numbers.reduce((total, value) => total + value, 0) / numbers.length, 6);
}

function summarizeTrades(trades) {
  const closed = trades.filter((trade) => Number.isFinite(trade.pnlSol));
  const wins = closed.filter((trade) => Number(trade.pnlSol) > 0);
  const losses = closed.filter((trade) => Number(trade.pnlSol) < 0);
  const pnlSol = closed.reduce((total, trade) => total + Number(trade.pnlSol || 0), 0);

  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? compact(wins.length / closed.length, 4) : null,
    pnlSol: compact(pnlSol, 9),
    averagePnlSol: closed.length > 0 ? compact(pnlSol / closed.length, 9) : null,
    averageScore: listMean(closed.map((trade) => trade.score)),
    averageCurveProgress: listMean(closed.map((trade) => trade.curveProgress)),
    averageCurveProgressDelta: listMean(closed.map((trade) => trade.curveProgressDelta)),
    averageUniqueBuyerRatio: listMean(closed.map((trade) => trade.uniqueBuyerRatio)),
    averageSniperWalletCount: listMean(closed.map((trade) => trade.sniperWalletCount))
  };
}

function groupBy(trades, keyFn) {
  return trades.reduce((groups, trade) => {
    const key = keyFn(trade);
    if (!groups[key]) groups[key] = [];
    groups[key].push(trade);
    return groups;
  }, {});
}

function summarizeGroups(trades, keyFn) {
  const groups = groupBy(trades, keyFn);
  return Object.fromEntries(
    Object.entries(groups)
      .map(([key, groupTrades]) => [key, summarizeTrades(groupTrades)])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function filterSummary(name, trades, predicate) {
  const selected = trades.filter(predicate);
  const excluded = trades.filter((trade) => !predicate(trade));
  return {
    name,
    selected: summarizeTrades(selected),
    excluded: summarizeTrades(excluded)
  };
}

function collectDecisionContext(events) {
  const decisionsByMint = new Map();

  for (const event of events) {
    if (event.type !== 'pre_migration_paper.decision') continue;

    const payload = eventPayload(event);
    const mint = getMint(payload);
    if (!mint) continue;

    const decisions = decisionsByMint.get(mint) || [];
    decisions.push({
      timestamp: event.timestamp,
      preset: payload.preset || null,
      reason: payload.reason || null,
      score: asNumber(payload.score),
      curveProgress: asNumber(payload.curveProgress),
      recentVolumeSol: asNumber(payload.recentVolumeSol),
      tradeVelocityPerMin: asNumber(payload.tradeVelocityPerMin),
      uniqueBuyerCount: asNumber(payload.uniqueBuyerCount),
      uniqueBuyerRatio: asNumber(payload.uniqueBuyerRatio),
      sniperWalletCount: asNumber(payload.sniperWalletCount),
      curveProgressDelta: asNumber(payload.curveProgressDelta ?? payload.earlySurgeCurveProgressDelta),
      curveProgressDelta60s: asNumber(payload.curveProgressDelta60s ?? payload.earlySurgeCurveProgressDelta60s),
      baselineCurveProgress: asNumber(payload.baselineCurveProgress ?? payload.earlySurgeBaselineCurveProgress),
      baselineCurveProgress60s: asNumber(payload.baselineCurveProgress60s ?? payload.earlySurgeBaselineCurveProgress60s),
      guardOverride: payload.guardOverride || null,
      earlySurgePassesCurveDeltaGuard: payload.earlySurgePassesCurveDeltaGuard ?? null,
      reasons: Array.isArray(payload.reasons) ? payload.reasons : []
    });
    decisionsByMint.set(mint, decisions);
  }

  for (const decisions of decisionsByMint.values()) {
    decisions.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
  }

  return decisionsByMint;
}

function findNearestDecisions(decisionsByMint, mint, entryAt) {
  const decisions = decisionsByMint.get(mint) || [];
  const nearby = decisions.filter((decision) => {
    const deltaMs = millisecondsBetween(entryAt, decision.timestamp);
    return Number.isFinite(deltaMs) && deltaMs >= -1000 && deltaMs <= 3000;
  });

  if (nearby.length > 0) {
    return nearby;
  }

  return decisions
    .map((decision) => ({
      decision,
      distanceMs: Math.abs(millisecondsBetween(entryAt, decision.timestamp) ?? Number.POSITIVE_INFINITY)
    }))
    .sort((a, b) => a.distanceMs - b.distanceMs)
    .slice(0, 4)
    .map((entry) => entry.decision);
}

function firstFinite(values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function enrichTrade(trade, telemetryPath, decisionsByMint) {
  const decisions = findNearestDecisions(decisionsByMint, trade.mint, trade.entryAt);
  const primary = decisions[0] || {};
  const reasonSet = Array.from(new Set(decisions.map((decision) => decision.reason).filter(Boolean))).sort();
  const presetReasons = Object.fromEntries(
    decisions
      .filter((decision) => decision.preset)
      .map((decision) => [decision.preset, decision.reason])
  );

  const score = firstFinite([primary.score, asNumber(trade.entryScore)]);
  const curveProgress = firstFinite([primary.curveProgress, asNumber(trade.entryCurveProgress)]);
  const recentVolumeSol = firstFinite([primary.recentVolumeSol, asNumber(trade.entryRecentVolumeSol)]);
  const tradeVelocityPerMin = firstFinite([primary.tradeVelocityPerMin, asNumber(trade.entryTradeVelocityPerMin)]);

  return {
    telemetryPath,
    telemetryFile: path.basename(telemetryPath),
    mint: trade.mint,
    symbol: trade.symbol || null,
    entryAt: trade.entryAt,
    exitAt: trade.exitAt,
    exitReason: trade.exitReason,
    pnlSol: asNumber(trade.pnlSol),
    returnPct: asNumber(trade.returnPct),
    holdSeconds: asNumber(trade.holdSeconds),
    score,
    curveProgress,
    recentVolumeSol,
    tradeVelocityPerMin,
    uniqueBuyerCount: firstFinite(decisions.map((decision) => decision.uniqueBuyerCount)),
    uniqueBuyerRatio: firstFinite(decisions.map((decision) => decision.uniqueBuyerRatio)),
    sniperWalletCount: firstFinite(decisions.map((decision) => decision.sniperWalletCount)),
    curveProgressDelta: firstFinite(decisions.map((decision) => decision.curveProgressDelta)),
    curveProgressDelta60s: firstFinite(decisions.map((decision) => decision.curveProgressDelta60s)),
    baselineCurveProgress: firstFinite(decisions.map((decision) => decision.baselineCurveProgress)),
    baselineCurveProgress60s: firstFinite(decisions.map((decision) => decision.baselineCurveProgress60s)),
    guardOverride: decisions.find((decision) => decision.guardOverride)?.guardOverride || null,
    earlySurgePassesCurveDeltaGuard: decisions.find((decision) => decision.earlySurgePassesCurveDeltaGuard !== null)?.earlySurgePassesCurveDeltaGuard ?? null,
    skipReasons: reasonSet,
    presetReasons,
    scoreBucket: bucketScore(score),
    curveBucket: bucketCurve(curveProgress),
    uniqueBuyerRatioBucket: bucketUniqueBuyerRatio(firstFinite(decisions.map((decision) => decision.uniqueBuyerRatio))),
    sniperBucket: bucketSnipers(firstFinite(decisions.map((decision) => decision.sniperWalletCount)))
  };
}

function buildSignalQualityReport(telemetryFiles, strategy) {
  const trades = [];
  const runSummaries = [];

  for (const telemetryPath of telemetryFiles) {
    const events = readJsonl(telemetryPath);
    const report = buildReport(events, telemetryPath, strategy);
    const decisionsByMint = collectDecisionContext(events);
    const enriched = report.simulatedTrades.map((trade) => enrichTrade(trade, telemetryPath, decisionsByMint));

    trades.push(...enriched);
    runSummaries.push({
      telemetryPath,
      telemetryFile: path.basename(telemetryPath),
      runDurationMinutes: report.run.runDurationMinutes,
      simulatedTrades: report.summary.simulatedTrades,
      wins: report.summary.wins,
      losses: report.summary.losses,
      totalPnlSol: report.summary.totalPnlSol
    });
  }

  const winners = trades.filter((trade) => Number(trade.pnlSol) > 0);
  const losers = trades.filter((trade) => Number(trade.pnlSol) < 0);

  const report = {
    generatedAt: new Date().toISOString(),
    telemetryFiles,
    strategy,
    runSummaries,
    summary: summarizeTrades(trades),
    cohorts: {
      winners: summarizeTrades(winners),
      losers: summarizeTrades(losers)
    },
    buckets: {
      score: summarizeGroups(trades, (trade) => trade.scoreBucket),
      curve: summarizeGroups(trades, (trade) => trade.curveBucket),
      uniqueBuyerRatio: summarizeGroups(trades, (trade) => trade.uniqueBuyerRatioBucket),
      snipers: summarizeGroups(trades, (trade) => trade.sniperBucket),
      primarySkipReason: summarizeGroups(trades, (trade) => trade.skipReasons[0] || 'unknown')
    },
    filterTests: [
      filterSummary('score>=84', trades, (trade) => Number(trade.score) >= 84),
      filterSummary('score>=80', trades, (trade) => Number(trade.score) >= 80),
      filterSummary('curveDelta>=0.035', trades, (trade) => Number(trade.curveProgressDelta) >= 0.035),
      filterSummary('score>=82 && curveDelta>=0.035', trades, (trade) => Number(trade.score) >= 82 && Number(trade.curveProgressDelta) >= 0.035),
      filterSummary('curveDelta60s>=0.035', trades, (trade) => Number(trade.curveProgressDelta60s) >= 0.035),
      filterSummary('score>=82 && curveDelta60s>=0.035', trades, (trade) => Number(trade.score) >= 82 && Number(trade.curveProgressDelta60s) >= 0.035),
      filterSummary('uniqueBuyerRatio>=0.90', trades, (trade) => Number(trade.uniqueBuyerRatio) >= 0.90),
      filterSummary('snipers<=3', trades, (trade) => Number(trade.sniperWalletCount) <= 3),
      filterSummary('score>=80 && uniqueBuyerRatio>=0.90', trades, (trade) => Number(trade.score) >= 80 && Number(trade.uniqueBuyerRatio) >= 0.90),
      filterSummary('score>=80 && snipers<=3', trades, (trade) => Number(trade.score) >= 80 && Number(trade.sniperWalletCount) <= 3),
      filterSummary('score>=80 && uniqueBuyerRatio>=0.90 && snipers<=3', trades, (trade) => Number(trade.score) >= 80 && Number(trade.uniqueBuyerRatio) >= 0.90 && Number(trade.sniperWalletCount) <= 3),
      filterSummary('score>=80 && curve 75-85 && uniqueBuyerRatio>=0.90', trades, (trade) => Number(trade.score) >= 80 && Number(trade.curveProgress) >= 0.75 && Number(trade.curveProgress) < 0.85 && Number(trade.uniqueBuyerRatio) >= 0.90)
    ],
    topWinners: [...winners].sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol)).slice(0, 10),
    topLosers: [...losers].sort((a, b) => Number(a.pnlSol) - Number(b.pnlSol)).slice(0, 10),
    trades
  };

  return report;
}

function printReport(report) {
  console.log('Pre-Migration Signal Quality Report');
  console.log(`Telemetry files: ${report.telemetryFiles.length}`);
  console.log(`Trades: ${report.summary.trades}, wins=${report.summary.wins}, losses=${report.summary.losses}, winRate=${report.summary.winRate ?? 'n/a'}, pnl=${report.summary.pnlSol} SOL`);
  console.log('');
  console.log('Winner vs Loser Averages:');
  console.log(`  winners: score=${report.cohorts.winners.averageScore ?? 'n/a'} curve=${report.cohorts.winners.averageCurveProgress ?? 'n/a'} uniqueRatio=${report.cohorts.winners.averageUniqueBuyerRatio ?? 'n/a'} snipers=${report.cohorts.winners.averageSniperWalletCount ?? 'n/a'} pnl=${report.cohorts.winners.pnlSol} SOL`);
  console.log(`  losers:  score=${report.cohorts.losers.averageScore ?? 'n/a'} curve=${report.cohorts.losers.averageCurveProgress ?? 'n/a'} uniqueRatio=${report.cohorts.losers.averageUniqueBuyerRatio ?? 'n/a'} snipers=${report.cohorts.losers.averageSniperWalletCount ?? 'n/a'} pnl=${report.cohorts.losers.pnlSol} SOL`);
  console.log('');
  console.log('Filter Tests:');
  report.filterTests.forEach((test) => {
    console.log(`  ${test.name}: selected trades=${test.selected.trades}, wins=${test.selected.wins}, losses=${test.selected.losses}, winRate=${test.selected.winRate ?? 'n/a'}, pnl=${test.selected.pnlSol} SOL`);
  });
  console.log('');
  console.log('Top Winners:');
  report.topWinners.slice(0, 5).forEach((trade, index) => {
    console.log(`  ${index + 1}. ${trade.symbol || 'unknown'} ${trade.exitReason} pnl=${trade.pnlSol} score=${trade.score} curve=${trade.curveProgress} unique=${trade.uniqueBuyerRatio} snipers=${trade.sniperWalletCount} skips=${trade.skipReasons.join('|') || 'n/a'}`);
  });
  console.log('Top Losers:');
  report.topLosers.slice(0, 5).forEach((trade, index) => {
    console.log(`  ${index + 1}. ${trade.symbol || 'unknown'} ${trade.exitReason} pnl=${trade.pnlSol} score=${trade.score} curve=${trade.curveProgress} unique=${trade.uniqueBuyerRatio} snipers=${trade.sniperWalletCount} skips=${trade.skipReasons.join('|') || 'n/a'}`);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryFiles = resolveTelemetryFiles(args);
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;
  const strategy = {
    ...DEFAULT_STRATEGY,
    minScore: Number.isFinite(Number(args.minScore)) ? Number(args.minScore) : DEFAULT_STRATEGY.minScore,
    minCurveProgress: Number.isFinite(Number(args.minCurve)) ? Number(args.minCurve) : DEFAULT_STRATEGY.minCurveProgress,
    minRecentVolumeSol: Number.isFinite(Number(args.minVolume)) ? Number(args.minVolume) : DEFAULT_STRATEGY.minRecentVolumeSol,
    minTradeVelocityPerMin: Number.isFinite(Number(args.minVelocity)) ? Number(args.minVelocity) : DEFAULT_STRATEGY.minTradeVelocityPerMin
  };

  if (telemetryFiles.length === 0) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run paper sessions first.');
    process.exit(1);
  }

  const report = buildSignalQualityReport(telemetryFiles, strategy);
  writeJson(outputPath, report);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildSignalQualityReport,
  summarizeTrades
};
