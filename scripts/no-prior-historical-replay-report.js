#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildReport: buildNoPriorReplay,
  list,
  noPriorDecisionFromEvent,
  readJson,
  snapshotFromEvent
} = require('./no-prior-replay-diagnostic');
const { forEachJsonlSync } = require('./lib/jsonl');

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
  let startMs = Infinity;
  let endMs = -Infinity;
  const readStats = forEachJsonlSync(filePath, (event) => {
    const timestamp = timestampMs(eventTimestamp(event));
    if (!Number.isFinite(timestamp)) return;
    startMs = Math.min(startMs, timestamp);
    endMs = Math.max(endMs, timestamp);
  });
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return {
    path: filePath,
    relativePath: rel(filePath),
    startMs,
    endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    sourceRows: readStats.rows,
    malformedLines: readStats.malformedLines
  };
}

function compactReplayEvent(event) {
  const snapshot = snapshotFromEvent(event);
  const decision = noPriorDecisionFromEvent(event);
  const source = decision || snapshot;
  if (!source) return null;
  return {
    type: event.type || event.event || event.name || source.type || 'unknown',
    timestamp: event.timestamp || source.timestamp,
    payload: {
      timestamp: source.timestamp,
      mint: source.mint,
      symbol: source.symbol || null,
      curveProgress: source.curveProgress,
      score: source.score,
      recentVolumeSol: source.recentVolumeSol,
      tradeVelocityPerMin: source.tradeVelocityPerMin,
      decision: decision ? 'PAPER_SKIPPED' : null,
      reason: decision ? 'NO_PRIOR_CURVE_PROGRESS' : null,
      preset: decision?.preset || null,
      lane: decision?.lane || null,
      profileName: decision?.profileName || null,
      baselineCurveProgress: decision?.baselineCurveProgress ?? null,
      curveProgressDelta: decision?.curveProgressDelta ?? null
    }
  };
}

function readReplayEventsForMints(filePath, mints) {
  const events = [];
  const readStats = forEachJsonlSync(filePath, (event) => {
    const payload = event?.payload || event?.data || {};
    const mint = payload.mint || payload.token || payload.mintAddress || payload.address || null;
    if (!mint || !mints.has(mint)) return;
    const compact = compactReplayEvent(event);
    if (compact) events.push(compact);
  });
  return { events, readStats };
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
  const assignments = falseNegatives.map((candidate) => {
    const window = pickTelemetryWindow(windows, candidate);
    const recoveryCandidate = recoveryByMint.get(candidate.mint);
    return { candidate, window, recoveryCandidate };
  });
  const groups = new Map();
  for (const assignment of assignments) {
    if (!assignment.window || !assignment.recoveryCandidate) continue;
    const group = groups.get(assignment.window.path) || {
      window: assignment.window,
      assignments: []
    };
    group.assignments.push(assignment);
    groups.set(assignment.window.path, group);
  }

  const replayByWindowAndMint = new Map();
  const replayReadStats = [];
  for (const group of groups.values()) {
    const recoveryCandidates = Array.from(new Map(
      group.assignments.map((assignment) => [
        assignment.recoveryCandidate.mint,
        assignment.recoveryCandidate
      ])
    ).values());
    const candidateRows = group.assignments.map((assignment) => assignment.candidate);
    const mints = new Set(recoveryCandidates.map((candidate) => candidate.mint));
    const input = readReplayEventsForMints(group.window.path, mints);
    const replay = buildNoPriorReplay(
      input.events,
      { recovery: recoveryCandidates },
      candidateRows,
      group.window.path
    );
    replayReadStats.push({
      telemetryPath: group.window.relativePath,
      sourceRows: input.readStats.rows,
      retainedRows: input.events.length,
      malformedLines: input.readStats.malformedLines,
      targetMints: mints.size
    });
    for (const replayCandidate of replay.candidates) {
      replayByWindowAndMint.set(
        `${group.window.path}|${replayCandidate.mint}`,
        replayCandidate
      );
    }
  }

  const rows = assignments.map(({ candidate, window, recoveryCandidate }) => {
    const replayCandidate = window
      ? replayByWindowAndMint.get(`${window.path}|${candidate.mint}`) || null
      : null;
    return compactCandidate(
      candidate,
      replayCandidate,
      window,
      Boolean(recoveryCandidate)
    );
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      telemetryFilesRead: windows.length,
      telemetryWindowRowsScanned: windows.reduce((sum, window) => sum + Number(window.sourceRows || 0), 0),
      telemetryWindowMalformedLines: windows.reduce((sum, window) => sum + Number(window.malformedLines || 0), 0),
      replayReadStats,
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
