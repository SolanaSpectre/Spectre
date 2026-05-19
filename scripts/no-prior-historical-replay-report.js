#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildReport: buildNoPriorReplay,
  list,
  readJson,
  readJsonl
} = require('./no-prior-replay-diagnostic');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const RECOVERY_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-curve-recovery-latest.json');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-historical-replay-latest.json');

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

function telemetryFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => path.join(LOG_DIR, name))
    .sort();
}

function telemetryWindow(filePath) {
  const events = readJsonl(filePath);
  let startMs = Infinity;
  let endMs = -Infinity;
  for (const event of events) {
    const timestamp = timestampMs(eventTimestamp(event));
    if (!Number.isFinite(timestamp)) continue;
    startMs = Math.min(startMs, timestamp);
    endMs = Math.max(endMs, timestamp);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return {
    path: filePath,
    relativePath: rel(filePath),
    startMs,
    endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    events
  };
}

function pickTelemetryWindow(windows, candidate) {
  const firstSeenMs = timestampMs(candidate.firstSeenAt);
  if (!Number.isFinite(firstSeenMs)) return null;
  return windows.find((window) => window.startMs <= firstSeenMs && firstSeenMs <= window.endMs) || null;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function compactCandidate(candidate, replayCandidate, window, hasRecoveryCandidate) {
  return {
    mint: candidate.mint,
    symbol: candidate.symbol || null,
    outcome: candidate.outcome || null,
    falseNegativePriority: candidate.falseNegativePriority ?? null,
    firstSeenAt: candidate.firstSeenAt || null,
    telemetryPath: window?.relativePath || null,
    telemetryStartAt: window?.startAt || null,
    telemetryEndAt: window?.endAt || null,
    diagnosis: replayCandidate?.diagnosis || (!window ? 'NO_TELEMETRY_WINDOW' : !hasRecoveryCandidate ? 'NO_RECOVERY_CANDIDATE' : 'NO_REPLAY_ROW'),
    replayClasses: replayCandidate?.replayClasses || {},
    noPriorDecisionCount: replayCandidate?.noPriorDecisionCount || 0,
    sourceCoverage: replayCandidate?.sourceCoverage || null,
    firstNoPriorAt: replayCandidate?.firstNoPriorAt || null,
    firstNoPriorCurveProgress: replayCandidate?.firstNoPriorCurveProgress ?? null,
    neededEarlierSnapshot: replayCandidate?.neededEarlierSnapshot || null,
    decisions: replayCandidate?.decisions || []
  };
}

function buildReport() {
  const recoveryReport = readJson(RECOVERY_PATH, {});
  const recoveryByMint = new Map((recoveryReport.recovery || []).map((candidate) => [candidate.mint, candidate]));
  const falseNegatives = list(readJson(FALSE_NEGATIVE_PATH, []));
  const windows = telemetryFiles().map(telemetryWindow).filter(Boolean);

  const rows = falseNegatives.map((candidate) => {
    const window = pickTelemetryWindow(windows, candidate);
    const recoveryCandidate = recoveryByMint.get(candidate.mint);
    if (!window || !recoveryCandidate) {
      return compactCandidate(candidate, null, window, Boolean(recoveryCandidate));
    }
    const replay = buildNoPriorReplay(window.events, { recovery: [recoveryCandidate] }, [candidate], window.path);
    return compactCandidate(candidate, replay.candidates[0] || null, window, true);
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      telemetryFilesRead: windows.length,
      recoveryPath: rel(RECOVERY_PATH),
      falseNegativePath: rel(FALSE_NEGATIVE_PATH)
    },
    summary: {
      falseNegativeCandidates: rows.length,
      candidatesWithTelemetryWindow: rows.filter((row) => row.telemetryPath).length,
      candidatesWithoutTelemetryWindow: rows.filter((row) => !row.telemetryPath).length,
      recoveryCandidatesMatched: rows.filter((row) => row.diagnosis !== 'NO_TELEMETRY_WINDOW' && row.diagnosis !== 'NO_RECOVERY_CANDIDATE').length,
      candidatesWithNoPriorDecisions: rows.filter((row) => row.noPriorDecisionCount > 0).length,
      diagnosisCounts: countBy(rows, (row) => row.diagnosis)
    },
    rows,
    topReconstructableRows: rows
      .filter((row) => row.noPriorDecisionCount > 0)
      .sort((a, b) => Number(b.falseNegativePriority || 0) - Number(a.falseNegativePriority || 0))
      .slice(0, 12),
    note: 'Report-only historical NO_PRIOR replay. Maps each false-negative candidate back to the telemetry window containing its own firstSeenAt timestamp, then reuses the standard NO_PRIOR replay logic against that original run. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
