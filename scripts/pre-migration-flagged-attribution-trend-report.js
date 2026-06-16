#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { scan, buildReport } = require('./pre-migration-flagged-candidate-attribution-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-attribution-trend');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-attribution-trend-latest.json');
const DEFAULT_LIMIT = 8;

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

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function telemetryFiles(limit = DEFAULT_LIMIT) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath)
    .reverse();
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function bump(counts, key, amount = 1) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + amount;
}

function addCounts(target, counts = {}) {
  for (const [key, value] of Object.entries(counts || {})) bump(target, key, Number(value || 0));
}

function numericStats(values, digits = 6) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: compact(sorted[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(sorted[sorted.length - 1], digits),
    avg: compact(sum / sorted.length, digits)
  };
}

function topCounts(counts = {}, limit = 12) {
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
}

function runSummary(filePath, report) {
  const summary = report.summary || {};
  const replay = summary.replay || {};
  const candidates = Number(summary.candidates || 0);
  const measured = Number(summary.mintsWithFinalistSnapshots || 0);
  const classifications = summary.classificationCounts || {};
  const strong = Number(classifications.BLOCKED_STRONG_FOLLOW_THROUGH || 0);
  const useful = Number(classifications.BLOCKED_USEFUL_FOLLOW_THROUGH || 0);
  const flat = Number(classifications.CORRECTLY_BLOCKED_FLAT || 0);
  const insufficient = Number(classifications.INSUFFICIENT_OUTCOME_DATA || 0);
  return {
    telemetryPath: path.relative(ROOT, filePath),
    candidates,
    flaggedMints: summary.flaggedMints ?? null,
    evaluatedMints: summary.evaluatedMints ?? null,
    measuredMints: measured,
    measuredRate: candidates ? compact(measured / candidates, 4) : null,
    strongFollowThrough: strong,
    usefulFollowThrough: useful,
    correctlyBlockedFlat: flat,
    insufficientOutcomeData: insufficient,
    strongOrUsefulRateMeasured: measured ? compact((strong + useful) / measured, 4) : null,
    insufficientRate: candidates ? compact(insufficient / candidates, 4) : null,
    replayed: replay.replayed ?? null,
    replayWins: replay.wins ?? null,
    replayLosses: replay.losses ?? null,
    replayWinRate: replay.winRate ?? null,
    replayTotalPnlSol: replay.totalPnlSol ?? null,
    replayMedianPnlSol: replay.medianPnlSol ?? null,
    replayTop3RemovedPnlSol: replay.top3RemovedPnlSol ?? null,
    replayStressedPnlSol: replay.stressedPnlSol ?? null,
    classificationCounts: classifications,
    skipReasonCounts: summary.skipReasonCounts || {},
    tightestGateCounts: summary.tightestGateCounts || {},
    walletCounts: summary.walletCounts || {}
  };
}

function aggregate(runs) {
  const classificationCounts = {};
  const skipReasonCounts = {};
  const tightestGateCounts = {};
  const walletCounts = {};
  for (const run of runs) {
    addCounts(classificationCounts, run.classificationCounts);
    addCounts(skipReasonCounts, run.skipReasonCounts);
    addCounts(tightestGateCounts, run.tightestGateCounts);
    addCounts(walletCounts, run.walletCounts);
  }
  const candidates = runs.reduce((sum, run) => sum + Number(run.candidates || 0), 0);
  const measured = runs.reduce((sum, run) => sum + Number(run.measuredMints || 0), 0);
  const strong = runs.reduce((sum, run) => sum + Number(run.strongFollowThrough || 0), 0);
  const useful = runs.reduce((sum, run) => sum + Number(run.usefulFollowThrough || 0), 0);
  const insufficient = runs.reduce((sum, run) => sum + Number(run.insufficientOutcomeData || 0), 0);
  const replayed = runs.reduce((sum, run) => sum + Number(run.replayed || 0), 0);
  const wins = runs.reduce((sum, run) => sum + Number(run.replayWins || 0), 0);
  const losses = runs.reduce((sum, run) => sum + Number(run.replayLosses || 0), 0);
  const totalPnl = runs.reduce((sum, run) => sum + Number(run.replayTotalPnlSol || 0), 0);
  const stressedPnl = runs.reduce((sum, run) => sum + Number(run.replayStressedPnlSol || 0), 0);
  const top3RemovedPnl = runs.reduce((sum, run) => sum + Number(run.replayTop3RemovedPnlSol || 0), 0);
  return {
    runCount: runs.length,
    candidates,
    measuredMints: measured,
    measuredRate: candidates ? compact(measured / candidates, 4) : null,
    strongFollowThrough: strong,
    usefulFollowThrough: useful,
    strongOrUsefulRateMeasured: measured ? compact((strong + useful) / measured, 4) : null,
    insufficientOutcomeData: insufficient,
    insufficientRate: candidates ? compact(insufficient / candidates, 4) : null,
    replayed,
    replayWins: wins,
    replayLosses: losses,
    replayWinRate: replayed ? compact(wins / replayed, 4) : null,
    replayTotalPnlSol: compact(totalPnl, 9),
    replayStressedPnlSol: compact(stressedPnl, 9),
    replayTop3RemovedPnlSolSum: compact(top3RemovedPnl, 9),
    replayMedianPnlSolByRun: numericStats(runs.map((run) => run.replayMedianPnlSol), 9),
    replayTotalPnlSolByRun: numericStats(runs.map((run) => run.replayTotalPnlSol), 9),
    replayTop3RemovedPnlSolByRun: numericStats(runs.map((run) => run.replayTop3RemovedPnlSol), 9),
    classificationCounts: topCounts(classificationCounts),
    skipReasonCounts: topCounts(skipReasonCounts),
    tightestGateCounts: topCounts(tightestGateCounts),
    walletCounts: topCounts(walletCounts)
  };
}

function verdict(summary) {
  if (!summary.runCount) return 'NO_RUNS';
  if (Number(summary.replayed || 0) < 60) return 'INSUFFICIENT_MULTI_RUN_SAMPLE';
  if (Number(summary.replayTotalPnlSol || 0) <= 0 || Number(summary.replayStressedPnlSol || 0) <= 0) return 'NEGATIVE_OR_STRESS_NEGATIVE';
  if (Number(summary.replayMedianPnlSolByRun?.median || 0) <= 0) return 'MEDIAN_RUN_NEGATIVE';
  if (Number(summary.replayTop3RemovedPnlSolByRun?.median || 0) <= 0) return 'OUTLIER_DOMINATED';
  if (Number(summary.insufficientRate || 0) > 0.4) return 'OUTCOME_COVERAGE_TOO_LOW';
  return 'PROMISING_REPORT_ONLY_NEEDS_RUNTIME_PAPER';
}

function buildTrend(filePaths) {
  const runs = [];
  const errors = [];
  for (const filePath of filePaths) {
    try {
      const report = buildReport(scan(filePath));
      runs.push(runSummary(filePath, report));
    } catch (error) {
      errors.push({ telemetryPath: path.relative(ROOT, filePath), error: error.message });
    }
  }
  const summary = aggregate(runs);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_flagged_attribution_trend',
    summary: {
      ...summary,
      verdict: verdict(summary)
    },
    runs,
    errors,
    note: 'Report-only multi-run trend over flagged candidate attribution. It aggregates classification, outcome coverage, and counterfactual replay robustness across recent telemetry files. It does not alter gates, scoring, trust tiers, entries, exits, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((item) => repoPath(item.trim())).filter((item) => item && fs.existsSync(item))
    : telemetryFiles(Number(args.limit) || DEFAULT_LIMIT);
  if (!files.length) throw new Error('No telemetry files found for flagged attribution trend report.');

  const report = buildTrend(files);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = repoPath(args.output) || path.join(OUTPUT_DIR, `pre-migration-flagged-attribution-trend-${stamp}.json`);
  writeJson(outputPath, report);
  writeJson(LATEST_PATH, report);

  console.log('Pre-Migration Flagged Attribution Trend');
  console.log(`Runs: ${report.summary.runCount}, candidates=${report.summary.candidates}, measured=${report.summary.measuredMints}`);
  console.log(`Verdict: ${report.summary.verdict}`);
  console.log(`Replay: n=${report.summary.replayed}, W/L=${report.summary.replayWins}/${report.summary.replayLosses}, pnl=${report.summary.replayTotalPnlSol}, medianRun=${report.summary.replayMedianPnlSolByRun?.median}, top3RemovedRunMedian=${report.summary.replayTop3RemovedPnlSolByRun?.median}`);
  console.log(`Wrote JSON report: ${outputPath}`);
  console.log(`Wrote latest JSON report: ${LATEST_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { buildTrend };
