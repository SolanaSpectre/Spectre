#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const RECOVERY_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-curve-recovery-latest.json');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-replay-latest.json');

const LOOKBACK_MS = Number(process.env.PRE_MIGRATION_PAPER_CURVE_PROGRESS_LOOKBACK_MS || 2 * 60 * 1000);
const MIN_DELTA = Number(process.env.PRE_MIGRATION_PAPER_MIN_CURVE_PROGRESS_DELTA || 0.005);

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

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(LOG_DIR, name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath || null;
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
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

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function progressOf(payload) {
  const raw = payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.bondingProgress
    ?? payload.market?.maxCurveProgress;
  const progress = Number(raw);
  if (!Number.isFinite(progress)) return null;
  if (progress > 1 && progress <= 100) return progress / 100;
  return progress;
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const curveProgress = progressOf(payload);
  const timestamp = payload.timestamp || event.timestamp || null;
  if (!mint || !timestamp || !Number.isFinite(curveProgress)) return null;
  return {
    timestamp,
    type: eventType(event),
    mint,
    symbol: payload.symbol || null,
    curveProgress: numberOrNull(curveProgress, 6),
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol ?? payload.market?.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(
      payload.tradeVelocityPerMin ?? payload.tradeVelocity ?? payload.market?.tradeVelocityPerMin,
      2
    )
  };
}

function noPriorDecisionFromEvent(event) {
  const payload = payloadOf(event);
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  if (payload.decision !== 'PAPER_SKIPPED' || payload.reason !== 'NO_PRIOR_CURVE_PROGRESS') return null;
  const mint = mintOf(payload);
  const curveProgress = progressOf(payload);
  const timestamp = payload.timestamp || event.timestamp || null;
  if (!mint || !timestamp || !Number.isFinite(curveProgress)) return null;
  return {
    timestamp,
    eventTimestamp: event.timestamp || null,
    mint,
    symbol: payload.symbol || null,
    preset: payload.preset || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    curveProgress: numberOrNull(curveProgress, 6),
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    baselineCurveProgress: numberOrNull(payload.baselineCurveProgress, 6),
    curveProgressDelta: numberOrNull(payload.curveProgressDelta, 6)
  };
}

function snapshotFromSample(sample, candidate) {
  const curveProgress = progressOf(sample);
  if (!sample?.timestamp || !Number.isFinite(curveProgress)) return null;
  return {
    timestamp: sample.timestamp,
    type: sample.kind || sample.source || 'outcome_sample',
    mint: candidate.mint,
    symbol: candidate.symbol || null,
    curveProgress: numberOrNull(curveProgress, 6),
    score: numberOrNull(sample.score, 2),
    recentVolumeSol: numberOrNull(sample.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(sample.tradeVelocityPerMin, 2)
  };
}

function noPriorDecisionFromSample(sample, candidate) {
  if (sample?.decision !== 'PAPER_SKIPPED' || sample?.reason !== 'NO_PRIOR_CURVE_PROGRESS') return null;
  const curveProgress = progressOf(sample);
  if (!sample.timestamp || !Number.isFinite(curveProgress)) return null;
  return {
    timestamp: sample.timestamp,
    eventTimestamp: sample.timestamp,
    mint: candidate.mint,
    symbol: candidate.symbol || null,
    preset: sample.preset || null,
    lane: sample.lane || null,
    profileName: sample.profileName || null,
    curveProgress: numberOrNull(curveProgress, 6),
    score: numberOrNull(sample.score, 2),
    recentVolumeSol: numberOrNull(sample.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(sample.tradeVelocityPerMin, 2),
    baselineCurveProgress: numberOrNull(sample.baselineCurveProgress, 6),
    curveProgressDelta: numberOrNull(sample.curveProgressDelta, 6)
  };
}

function list(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.candidates || payload?.falseNegatives || payload?.watchlist || payload?.items || [];
}

function mergeUniqueBy(items, keyFn) {
  const seen = new Set();
  const merged = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function classifyDecision(decision, snapshots) {
  const decisionMs = timestampMs(decision.timestamp);
  const curve = Number(decision.curveProgress);
  const prior = snapshots
    .filter((snapshot) => {
      const ms = timestampMs(snapshot.timestamp);
      return Number.isFinite(ms) && Number.isFinite(decisionMs) && ms < decisionMs;
    })
    .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));

  const withinLookback = prior.filter((snapshot) => decisionMs - timestampMs(snapshot.timestamp) <= LOOKBACK_MS);
  const distinctWithinLookback = withinLookback
    .filter((snapshot) => Math.abs(curve - Number(snapshot.curveProgress)) >= 0.000001);
  const passingDelta = withinLookback
    .filter((snapshot) => curve - Number(snapshot.curveProgress) >= MIN_DELTA);

  let replayClass = 'NO_EARLIER_SNAPSHOT';
  if (passingDelta.length) {
    replayClass = 'HAS_REPLAY_BASELINE';
  } else if (distinctWithinLookback.length) {
    replayClass = 'PRIOR_DELTA_TOO_SMALL';
  } else if (withinLookback.length) {
    replayClass = 'PRIOR_NOT_DISTINCT';
  } else if (prior.length) {
    replayClass = 'PRIOR_OUTSIDE_LOOKBACK';
  }

  return {
    ...decision,
    replayClass,
    priorSnapshotCount: prior.length,
    snapshotsWithinLookback: withinLookback.length,
    distinctWithinLookback: distinctWithinLookback.length,
    passingDeltaBaselineCount: passingDelta.length,
    latestPrior: prior[0] || null,
    latestWithinLookback: withinLookback[0] || null,
    bestPassingBaseline: passingDelta[0] || null,
    neededEarlierSnapshot: {
      lookbackWindowStart: new Date(decisionMs - LOOKBACK_MS).toISOString(),
      lookbackWindowEnd: decision.timestamp,
      maxBaselineCurveProgressForMinDelta: numberOrNull(curve - MIN_DELTA, 6),
      minDistinctDelta: 0.000001,
      minCurveProgressDelta: MIN_DELTA
    }
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function compactCandidate(candidate, decisions, snapshots, sourceCoverage = {}) {
  const classified = decisions.map((decision) => classifyDecision(decision, snapshots));
  const classes = countBy(classified, (decision) => decision.replayClass);
  const first = classified.slice().sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
  const maxCurveAtSkip = Math.max(...classified.map((decision) => Number(decision.curveProgress)).filter(Number.isFinite), 0);
  const maxScoreAtSkip = Math.max(...classified.map((decision) => Number(decision.score)).filter(Number.isFinite), 0);

  return {
    symbol: candidate.symbol || first?.symbol || null,
    mint: candidate.mint,
    outcome: candidate.outcome || null,
    recoveryPriority: candidate.priority ?? null,
    noPriorSkips: candidate.noPriorSkips ?? classified.length,
    maxScore: candidate.maxScore ?? numberOrNull(maxScoreAtSkip, 2),
    maxCurveProgress: candidate.maxCurveProgress ?? numberOrNull(maxCurveAtSkip, 6),
    replayClasses: classes,
    firstNoPriorAt: first?.timestamp || null,
    firstNoPriorCurveProgress: first?.curveProgress ?? null,
    noPriorDecisionCount: classified.length,
    sourceCoverage,
    uniquePresets: Array.from(new Set(classified.map((decision) => decision.preset).filter(Boolean))).sort(),
    priorSnapshotCount: snapshots.length,
    diagnosis: classified.length === 0
      ? sourceCoverage.telemetrySnapshots === 0 && sourceCoverage.sampleSnapshots > 0
        ? 'NO_RECONSTRUCTED_DECISIONS_OUTSIDE_LATEST_TELEMETRY'
        : 'NO_RECONSTRUCTED_DECISIONS'
      : Object.keys(classes).length === 1 ? Object.keys(classes)[0] : 'MIXED_REPLAY_CLASSES',
    neededEarlierSnapshot: first?.neededEarlierSnapshot || null,
    decisions: classified.slice(0, 12),
    timelinePreview: snapshots.slice(-12)
  };
}

function buildReport(events, recoveryReport, falseNegativeRows, telemetryPath) {
  const recoveryCandidates = Array.isArray(recoveryReport?.recovery) ? recoveryReport.recovery : [];
  const recoveryMints = new Set(recoveryCandidates.map((candidate) => candidate.mint).filter(Boolean));
  const falseNegativeByMint = new Map(
    falseNegativeRows
      .filter((row) => row?.mint)
      .map((row) => [row.mint, row])
  );
  const allSnapshots = events.map(snapshotFromEvent).filter(Boolean);
  const allNoPriorDecisions = events.map(noPriorDecisionFromEvent).filter(Boolean);

  const snapshotsByMint = new Map();
  for (const snapshot of allSnapshots) {
    if (!recoveryMints.has(snapshot.mint)) continue;
    if (!snapshotsByMint.has(snapshot.mint)) snapshotsByMint.set(snapshot.mint, []);
    snapshotsByMint.get(snapshot.mint).push(snapshot);
  }
  for (const snapshots of snapshotsByMint.values()) {
    snapshots.sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
  }

  const decisionsByMint = new Map();
  for (const decision of allNoPriorDecisions) {
    if (!recoveryMints.has(decision.mint)) continue;
    if (!decisionsByMint.has(decision.mint)) decisionsByMint.set(decision.mint, []);
    decisionsByMint.get(decision.mint).push(decision);
  }
  for (const decisions of decisionsByMint.values()) {
    decisions.sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
  }

  const candidates = recoveryCandidates.map((candidate) => {
    const falseNegative = falseNegativeByMint.get(candidate.mint) || {};
    const samples = Array.isArray(falseNegative.samples) ? falseNegative.samples : [];
    const sampleSnapshots = samples.map((sample) => snapshotFromSample(sample, candidate)).filter(Boolean);
    const sampleDecisions = samples.map((sample) => noPriorDecisionFromSample(sample, candidate)).filter(Boolean);
    const telemetrySnapshots = snapshotsByMint.get(candidate.mint) || [];
    const telemetryDecisions = decisionsByMint.get(candidate.mint) || [];
    const snapshots = mergeUniqueBy(
      [...telemetrySnapshots, ...sampleSnapshots],
      (item) => `${item.timestamp}|${item.type}|${item.curveProgress}|${item.score}`
    ).sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
    const decisions = mergeUniqueBy(
      [...telemetryDecisions, ...sampleDecisions],
      (item) => `${item.timestamp}|${item.preset || ''}|${item.curveProgress}|${item.score}`
    ).sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));

    return compactCandidate(candidate, decisions, snapshots, {
      telemetrySnapshots: telemetrySnapshots.length,
      telemetryNoPriorDecisions: telemetryDecisions.length,
      outcomeSamples: samples.length,
      sampleSnapshots: sampleSnapshots.length,
      sampleNoPriorDecisions: sampleDecisions.length
    });
  });

  const decisionRows = candidates.flatMap((candidate) => candidate.decisions);
  const sourceCoverage = {
    telemetryBackedCandidates: candidates.filter((candidate) => candidate.sourceCoverage.telemetrySnapshots > 0).length,
    sampleOnlyCandidates: candidates.filter((candidate) => candidate.sourceCoverage.telemetrySnapshots === 0 && candidate.sourceCoverage.sampleSnapshots > 0).length,
    candidatesWithSampleNoPriorDecisions: candidates.filter((candidate) => candidate.sourceCoverage.sampleNoPriorDecisions > 0).length,
    candidatesWithTelemetryNoPriorDecisions: candidates.filter((candidate) => candidate.sourceCoverage.telemetryNoPriorDecisions > 0).length
  };

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath,
    recoveryPath: RECOVERY_PATH,
    falseNegativePath: FALSE_NEGATIVE_PATH,
    thresholds: {
      lookbackMs: LOOKBACK_MS,
      lookbackSeconds: numberOrNull(LOOKBACK_MS / 1000, 2),
      minCurveProgressDelta: MIN_DELTA
    },
    summary: {
      recoveryCandidates: candidates.length,
      candidatesWithNoPriorDecisions: candidates.filter((candidate) => candidate.noPriorDecisionCount > 0).length,
      noPriorDecisionCount: decisionRows.length,
      replayClassCounts: countBy(decisionRows, (decision) => decision.replayClass),
      diagnosisCounts: countBy(candidates, (candidate) => candidate.diagnosis),
      sourceCoverage
    },
    candidates,
    note: 'Report-only replay diagnostic. It reconstructs prior curve evidence for NO_PRIOR recovery candidates and distinguishes candidates backed by the latest telemetry window from historical sample-only candidates outside that window. Does not change thresholds, entries, signals, quotes, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for NO_PRIOR replay diagnostic.');
  }

  const recoveryReport = readJson(repoPath(args.recovery) || RECOVERY_PATH, {});
  const falseNegativeRows = list(readJson(repoPath(args.falseNegatives) || FALSE_NEGATIVE_PATH, []));
  const report = buildReport(readJsonl(telemetryPath), recoveryReport, falseNegativeRows, telemetryPath);
  writeJson(outputPath, report);

  console.log('NO_PRIOR Replay Diagnostic');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Recovery candidates: ${report.summary.recoveryCandidates}`);
  console.log(`NO_PRIOR decisions: ${report.summary.noPriorDecisionCount}`);
  console.log(`Replay classes: ${JSON.stringify(report.summary.replayClassCounts)}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main();
