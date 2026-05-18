#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  list,
  readJson,
  readJsonl,
  snapshotFromEvent
} = require('./no-prior-replay-diagnostic');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const HISTORICAL_REPLAY_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-historical-replay-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-first-observed-curve-latest.json');

function timestampMs(value) {
  const parsed = Date.parse(value || 0);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTimestamp(event) {
  return event?.timestamp || event?.payload?.timestamp || event?.data?.timestamp || null;
}

function rel(filePath) {
  return filePath ? path.relative(ROOT, filePath).replace(/\\/g, '/') : null;
}

function round(value, digits = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null;
}

function secondsBetween(startAt, endAt) {
  const startMs = timestampMs(startAt);
  const endMs = timestampMs(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return round((endMs - startMs) / 1000, 3);
}

function telemetryFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => path.join(LOG_DIR, name))
    .sort();
}

function telemetryWindow(filePath) {
  const events = readJsonl(filePath);
  const timestamps = events.map((event) => timestampMs(eventTimestamp(event))).filter(Number.isFinite);
  if (!timestamps.length) return null;
  return {
    path: filePath,
    relativePath: rel(filePath),
    startMs: Math.min(...timestamps),
    endMs: Math.max(...timestamps),
    events
  };
}

function pickTelemetryWindow(windows, candidate) {
  const firstSeenMs = timestampMs(candidate.firstSeenAt);
  if (!Number.isFinite(firstSeenMs)) return null;
  return windows.find((window) => window.startMs <= firstSeenMs && firstSeenMs <= window.endMs) || null;
}

function progressBucket(progress) {
  if (!Number.isFinite(progress)) return 'missing';
  if (progress >= 1) return '1.0';
  if (progress >= 0.85) return '0.85-0.99';
  if (progress >= 0.7) return '0.70-0.84';
  if (progress >= 0.5) return '0.50-0.69';
  if (progress >= 0.3) return '0.30-0.49';
  if (progress >= 0.1) return '0.10-0.29';
  return '<0.10';
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function firstObservedSnapshot(window, mint) {
  if (!window) return null;
  return window.events
    .map(snapshotFromEvent)
    .filter((snapshot) => snapshot?.mint === mint && Number.isFinite(snapshot.curveProgress))
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
}

function sampleFallback(candidate) {
  return (candidate.samples || [])
    .map((sample) => ({
      timestamp: sample.timestamp || null,
      type: sample.kind || sample.source || 'outcome_sample',
      curveProgress: round(sample.curveProgress, 6),
      score: round(sample.score, 2),
      recentVolumeSol: round(sample.recentVolumeSol, 4),
      tradeVelocityPerMin: round(sample.tradeVelocityPerMin, 2)
    }))
    .filter((sample) => sample.timestamp && Number.isFinite(sample.curveProgress))
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
}

function buildRow(candidate, window, diagnosis) {
  const telemetrySnapshot = firstObservedSnapshot(window, candidate.mint);
  const firstObserved = telemetrySnapshot || sampleFallback(candidate);
  const firstObservedCurveProgress = firstObserved?.curveProgress ?? null;
  return {
    mint: candidate.mint,
    symbol: candidate.symbol || null,
    outcome: candidate.outcome || null,
    falseNegativePriority: candidate.falseNegativePriority ?? null,
    diagnosis: diagnosis || null,
    firstSeenAt: candidate.firstSeenAt || null,
    telemetryPath: window?.relativePath || null,
    firstObservedAt: firstObserved?.timestamp || null,
    firstObservedSource: telemetrySnapshot ? 'telemetry' : firstObserved ? 'watchlist_sample' : null,
    firstObservedType: firstObserved?.type || null,
    firstObservedCurveProgress,
    firstObservedCurveBucket: progressBucket(firstObservedCurveProgress),
    secondsFirstSeenToFirstObservedCurve: secondsBetween(candidate.firstSeenAt, firstObserved?.timestamp),
    bondCompletedBeforeFirstObservation: Number.isFinite(firstObservedCurveProgress)
      ? firstObservedCurveProgress >= 1
      : null,
    curve75At: candidate.curve75At || null,
    curve85At: candidate.curve85At || null,
    curve95At: candidate.curve95At || null,
    curve100At: candidate.curve100At || null
  };
}

function buildReport() {
  const falseNegatives = list(readJson(FALSE_NEGATIVE_PATH, []));
  const historicalReplay = readJson(HISTORICAL_REPLAY_PATH, {});
  const diagnosisByMint = new Map((historicalReplay.rows || []).map((row) => [row.mint, row.diagnosis]));
  const windows = telemetryFiles().map(telemetryWindow).filter(Boolean);

  const rows = falseNegatives.map((candidate) => {
    const window = pickTelemetryWindow(windows, candidate);
    return buildRow(candidate, window, diagnosisByMint.get(candidate.mint));
  });

  const rowsWithCurve = rows.filter((row) => Number.isFinite(row.firstObservedCurveProgress));
  const fullyBondedRows = rowsWithCurve.filter((row) => row.bondCompletedBeforeFirstObservation);
  const midCurveRows = rowsWithCurve.filter((row) => row.firstObservedCurveProgress < 1);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      telemetryFilesRead: windows.length,
      falseNegativePath: rel(FALSE_NEGATIVE_PATH),
      historicalReplayPath: rel(HISTORICAL_REPLAY_PATH)
    },
    summary: {
      falseNegativeCandidates: rows.length,
      candidatesWithTelemetryWindow: rows.filter((row) => row.telemetryPath).length,
      candidatesWithFirstObservedCurve: rowsWithCurve.length,
      candidatesWithoutFirstObservedCurve: rows.length - rowsWithCurve.length,
      fullyBondedAtFirstObservedCurve: fullyBondedRows.length,
      notFullyBondedAtFirstObservedCurve: midCurveRows.length,
      firstObservedCurveBucketCounts: countBy(rows, (row) => row.firstObservedCurveBucket),
      diagnosisByFirstObservedCurveBucket: Object.fromEntries(
        Object.entries(
          rows.reduce((acc, row) => {
            const bucket = row.firstObservedCurveBucket;
            if (!acc[bucket]) acc[bucket] = [];
            acc[bucket].push(row);
            return acc;
          }, {})
        ).map(([bucket, bucketRows]) => [bucket, countBy(bucketRows, (row) => row.diagnosis)])
      )
    },
    rows,
    topFullyBondedRows: fullyBondedRows
      .sort((a, b) => Number(b.falseNegativePriority || 0) - Number(a.falseNegativePriority || 0))
      .slice(0, 12),
    topMidCurveRows: midCurveRows
      .sort((a, b) => Number(b.falseNegativePriority || 0) - Number(a.falseNegativePriority || 0))
      .slice(0, 12),
    note: 'Report-only first-observed-curve diagnostic for false-negative mints. Splits cases first seen already fully bonded from cases first seen with a finite mid-curve snapshot using the original historical telemetry window when available. The false-negative watchlist does not currently expose firstTradeAt, so this report measures delay from Spectre firstSeenAt to first finite curve observation instead. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

module.exports = { buildReport };
