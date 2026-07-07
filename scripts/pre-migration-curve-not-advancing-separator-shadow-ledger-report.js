'use strict';

const fs = require('fs');
const path = require('path');
const { readTelemetry, repoPath } = require('./pre-migration-curve-advance-diagnostic-report');
const {
  buildReport,
  PREREGISTERED_EXIT_PROFILE,
  PREREGISTERED_SEPARATOR_RULE
} = require('./pre-migration-curve-not-advancing-separator-shadow-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-not-advancing-separator-shadow-ledger-latest.json');
const DEFAULT_LIMIT = 12;
const PREREGISTERED_AT = '2026-07-07T17:30:00.000Z';

const PROMOTION_BAR = {
  minTrades: 30,
  totalPnlPositive: true,
  medianPnlPositive: true,
  exTop3NonNegative: true,
  notOutlierDominated: true,
  positiveInAtLeastHalfRuns: true,
  nextStep: 'If all pass, graduate only to runtime shadow would-enter logging; no paper entries, no live trading.'
};

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

function compact(value, decimals = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function quantile(values, q) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function listTelemetryFiles(limit) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath)
    .reverse();
}

function outlierSummary(pnls) {
  const sortedDesc = pnls.map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  const grossProfit = sortedDesc.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const total = sortedDesc.reduce((sum, value) => sum + value, 0);
  const exTop3 = sortedDesc.slice(3).reduce((sum, value) => sum + value, 0);
  const topWinner = sortedDesc.find((value) => value > 0) || 0;
  const topWinnerShare = grossProfit > 0 ? topWinner / grossProfit : null;
  return {
    totalPnlSol: compact(total, 9),
    pnlAfterRemovingTop3WinnersSol: compact(exTop3, 9),
    topWinnerShareOfGrossProfit: topWinnerShare === null ? null : compact(topWinnerShare, 4),
    outlierDominated: grossProfit > 0 && topWinnerShare > 0.5
  };
}

function splitHalfStats(trades) {
  const sorted = trades.slice().sort((a, b) => Number(a.entryMs || 0) - Number(b.entryMs || 0));
  const midpoint = Math.ceil(sorted.length / 2);
  return {
    firstHalf: summarizeTrades(sorted.slice(0, midpoint), false),
    secondHalf: summarizeTrades(sorted.slice(midpoint), false)
  };
}

function summarizeTrades(trades, includeSplit = true) {
  const pnls = trades.map((trade) => Number(trade.pnlSol)).filter(Number.isFinite);
  const wins = pnls.filter((value) => value > 0).length;
  const losses = pnls.filter((value) => value <= 0).length;
  const outliers = outlierSummary(pnls);
  const summary = {
    trades: trades.length,
    uniqueMints: new Set(trades.map((trade) => trade.mint).filter(Boolean)).size,
    wins,
    losses,
    winRate: trades.length ? compact(wins / trades.length, 4) : null,
    totalPnlSol: outliers.totalPnlSol,
    medianPnlSol: compact(quantile(pnls, 0.5), 9),
    avgPnlSol: pnls.length ? compact(pnls.reduce((sum, value) => sum + value, 0) / pnls.length, 9) : null,
    p90PnlSol: compact(quantile(pnls, 0.9), 9),
    pnlAfterRemovingTop3WinnersSol: outliers.pnlAfterRemovingTop3WinnersSol,
    topWinnerShareOfGrossProfit: outliers.topWinnerShareOfGrossProfit,
    outlierDominated: outliers.outlierDominated
  };
  if (includeSplit) summary.splitHalf = splitHalfStats(trades);
  return summary;
}

function positiveRunCount(runRows) {
  return runRows.filter((row) => Number(row.totalPnlSol) > 0).length;
}

function promotionStatus(summary, runRows) {
  const positiveRuns = positiveRunCount(runRows);
  const runsWithTrades = runRows.filter((row) => Number(row.replayedTrades) > 0).length;
  const checks = {
    minTrades: Number(summary.trades || 0) >= PROMOTION_BAR.minTrades,
    totalPnlPositive: Number(summary.totalPnlSol || 0) > 0,
    medianPnlPositive: Number(summary.medianPnlSol || 0) > 0,
    exTop3NonNegative: Number(summary.pnlAfterRemovingTop3WinnersSol || 0) >= 0,
    notOutlierDominated: summary.outlierDominated !== true,
    positiveInAtLeastHalfRuns: runsWithTrades > 0 && positiveRuns >= Math.ceil(runsWithTrades / 2)
  };
  return {
    eligible: Object.values(checks).every(Boolean),
    checks,
    positiveRuns,
    runsWithTrades,
    next: Object.values(checks).every(Boolean)
      ? PROMOTION_BAR.nextStep
      : 'Keep collecting unchanged PAPER runs; do not promote or loosen gates.'
  };
}

function classifyRun(startMs) {
  const runStartMs = Number(startMs);
  const registeredMs = new Date(PREREGISTERED_AT).getTime();
  return Number.isFinite(runStartMs) && runStartMs >= registeredMs ? 'out_of_sample' : 'backfill_in_sample';
}

async function buildLedger(files) {
  const runRows = [];
  const trades = [];

  for (const telemetryPath of files) {
    const telemetry = await readTelemetry(telemetryPath);
    const report = buildReport(telemetryPath, telemetry);
    const runType = classifyRun(telemetry.startMs);
    const prereg = report.preRegisteredRun || {};
    const runTrades = (report.preRegisteredTrades || []).map((trade) => ({
      ...trade,
      telemetryPath: report.telemetryPath,
      runType,
      entryMs: new Date(trade.at || 0).getTime()
    }));
    trades.push(...runTrades);
    runRows.push({
      telemetryPath: report.telemetryPath,
      firstEventAt: telemetry.startMs === null ? null : new Date(telemetry.startMs).toISOString(),
      lastEventAt: telemetry.endMs === null ? null : new Date(telemetry.endMs).toISOString(),
      runType,
      matchedRows: prereg.matchedRows ?? 0,
      selectedUniqueMints: prereg.selectedUniqueMints ?? 0,
      replayedTrades: prereg.replayedTrades ?? 0,
      wins: prereg.wins ?? 0,
      losses: prereg.losses ?? 0,
      totalPnlSol: prereg.totalPnlSol ?? 0,
      medianPnlSol: prereg.medianPnlSol ?? null,
      pnlAfterRemovingTop3WinnersSol: prereg.pnlAfterRemovingTop3WinnersSol ?? null,
      outlierDominated: prereg.outlierDominated ?? false
    });
  }

  const outOfSampleTrades = trades.filter((trade) => trade.runType === 'out_of_sample');
  const outOfSampleRuns = runRows.filter((row) => row.runType === 'out_of_sample');
  const backfillTrades = trades.filter((trade) => trade.runType === 'backfill_in_sample');
  const backfillRuns = runRows.filter((row) => row.runType === 'backfill_in_sample');

  const outOfSample = summarizeTrades(outOfSampleTrades);
  const backfill = summarizeTrades(backfillTrades);
  const combined = summarizeTrades(trades);
  const promotion = promotionStatus(outOfSample, outOfSampleRuns);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_preregistered_curve_not_advancing_separator_shadow_ledger',
    preRegisteredAt: PREREGISTERED_AT,
    hypothesis: {
      rule: PREREGISTERED_SEPARATOR_RULE,
      exitProfile: PREREGISTERED_EXIT_PROFILE,
      status: 'frozen_before_future_runs',
      warning: 'Promotion status uses out_of_sample rows only. Backfill is retained for orientation and is not proof.'
    },
    promotionBar: PROMOTION_BAR,
    files: files.map((filePath) => path.relative(ROOT, filePath)),
    summary: {
      verdict: promotion.eligible ? 'PROMOTION_BAR_MET_FOR_RUNTIME_SHADOW_ONLY' : 'PRE_REGISTERED_SAMPLE_INCOMPLETE',
      outOfSample,
      backfill,
      combined,
      promotion
    },
    runBreakdown: runRows,
    trades: trades.sort((a, b) => Number(a.entryMs || 0) - Number(b.entryMs || 0))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Number(args.limit)) : DEFAULT_LIMIT;
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const files = args.telemetry
    ? [repoPath(args.telemetry)]
    : listTelemetryFiles(limit);
  const existingFiles = files.filter((filePath) => filePath && fs.existsSync(filePath));
  if (!existingFiles.length) {
    throw new Error('No telemetry files found for separator shadow ledger.');
  }
  const report = await buildLedger(existingFiles);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('Pre-Migration CURVE_NOT_ADVANCING Separator Shadow Ledger');
  console.log(`Hypothesis: ${PREREGISTERED_SEPARATOR_RULE} / ${PREREGISTERED_EXIT_PROFILE}`);
  console.log(`Out-of-sample trades: ${report.summary.outOfSample.trades}`);
  console.log(`Verdict: ${report.summary.verdict}`);
  console.log(`Wrote JSON report: ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildLedger,
  summarizeTrades
};
