#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-follow-through-latest.json');

const WINDOWS_SECONDS = [30, 60, 120];
const FLAT_DELTA = 0.005;
const WAKE_DELTA = 0.05;

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

function list(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.candidates || payload?.falseNegatives || payload?.watchlist || payload?.items || [];
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function telemetryWindow(events = []) {
  const timestamps = events
    .map((event) => timestampMs(payloadOf(event).timestamp || event.timestamp))
    .filter(Number.isFinite);
  if (!timestamps.length) {
    return { startMs: null, endMs: null, startAt: null, endAt: null };
  }
  const startMs = Math.min(...timestamps);
  const endMs = Math.max(...timestamps);
  return {
    startMs,
    endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString()
  };
}

function inWindow(item, window) {
  const ms = timestampMs(item?.timestamp);
  if (!Number.isFinite(ms)) return false;
  if (Number.isFinite(window.startMs) && ms < window.startMs) return false;
  if (Number.isFinite(window.endMs) && ms > window.endMs) return false;
  return true;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
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

function metricSnapshot(payload, timestamp, type, fallback = {}) {
  const mint = mintOf(payload) || fallback.mint;
  const curveProgress = progressOf(payload);
  if (!mint || !timestamp || !Number.isFinite(curveProgress)) return null;
  return {
    timestamp,
    type,
    mint,
    symbol: payload.symbol || fallback.symbol || null,
    curveProgress: numberOrNull(curveProgress, 6),
    score: numberOrNull(payload.score ?? payload.maxScore, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol ?? payload.market?.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(
      payload.tradeVelocityPerMin ?? payload.tradeVelocity ?? payload.market?.tradeVelocityPerMin,
      2
    )
  };
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  return metricSnapshot(payload, payload.timestamp || event.timestamp || null, eventType(event));
}

function snapshotFromSample(sample, candidate) {
  if (!sample?.timestamp) return null;
  return metricSnapshot(sample, sample.timestamp, sample.kind || sample.source || 'outcome_sample', candidate);
}

function noPriorDecision(payload, timestamp, type, fallback = {}) {
  if (payload.decision !== 'PAPER_SKIPPED' || payload.reason !== 'NO_PRIOR_CURVE_PROGRESS') return null;
  const mint = mintOf(payload) || fallback.mint;
  const curveProgress = progressOf(payload);
  if (!mint || !timestamp || !Number.isFinite(curveProgress)) return null;
  return {
    timestamp,
    type,
    mint,
    symbol: payload.symbol || fallback.symbol || null,
    preset: payload.preset || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    curveProgress: numberOrNull(curveProgress, 6),
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    reasons: Array.isArray(payload.reasons) ? payload.reasons : []
  };
}

function noPriorDecisionFromEvent(event) {
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  return noPriorDecision(payload, payload.timestamp || event.timestamp || null, eventType(event));
}

function noPriorDecisionFromSample(sample, candidate) {
  if (!sample?.timestamp) return null;
  return noPriorDecision(sample, sample.timestamp, sample.kind || sample.source || 'outcome_sample', candidate);
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

function maxMetric(items, key) {
  const values = items.map((item) => Number(item[key])).filter(Number.isFinite);
  if (!values.length) return null;
  return numberOrNull(Math.max(...values), key === 'curveProgress' ? 6 : 2);
}

function firstReach(items, threshold) {
  return items
    .filter((item) => Number(item.curveProgress) >= threshold)
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
}

function firstCrossAfterSkip(items, threshold, startingCurveProgress) {
  if (Number(startingCurveProgress) >= threshold) return null;
  return firstReach(items, threshold);
}

function buildWindow(decision, snapshots, seconds) {
  const startMs = timestampMs(decision.timestamp);
  const endMs = startMs + seconds * 1000;
  const inWindow = snapshots.filter((snapshot) => {
    const ms = timestampMs(snapshot.timestamp);
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  });
  const futureSnapshots = inWindow.filter((snapshot) => timestampMs(snapshot.timestamp) > startMs);
  const maxCurveProgress = maxMetric(inWindow, 'curveProgress');
  const maxScore = maxMetric(inWindow, 'score');
  const maxRecentVolumeSol = maxMetric(inWindow, 'recentVolumeSol');
  const maxTradeVelocityPerMin = maxMetric(inWindow, 'tradeVelocityPerMin');
  const curveDelta = maxCurveProgress === null ? null : numberOrNull(maxCurveProgress - Number(decision.curveProgress), 6);
  const scoreDelta = maxScore === null || decision.score === null ? null : numberOrNull(maxScore - Number(decision.score), 2);
  const volumeDelta = maxRecentVolumeSol === null || decision.recentVolumeSol === null
    ? null
    : numberOrNull(maxRecentVolumeSol - Number(decision.recentVolumeSol), 4);
  const velocityDelta = maxTradeVelocityPerMin === null || decision.tradeVelocityPerMin === null
    ? null
    : numberOrNull(maxTradeVelocityPerMin - Number(decision.tradeVelocityPerMin), 2);

  const first75Cross = firstCrossAfterSkip(futureSnapshots, 0.75, decision.curveProgress);
  const first85Cross = firstCrossAfterSkip(futureSnapshots, 0.85, decision.curveProgress);
  const first95Cross = firstCrossAfterSkip(futureSnapshots, 0.95, decision.curveProgress);
  const first100Cross = firstCrossAfterSkip(futureSnapshots, 1, decision.curveProgress);

  return {
    seconds,
    snapshotCount: inWindow.length,
    futureSnapshotCount: futureSnapshots.length,
    maxCurveProgress,
    curveDelta,
    maxScore,
    scoreDelta,
    maxRecentVolumeSol,
    volumeDelta,
    maxTradeVelocityPerMin,
    velocityDelta,
    reached75: Boolean(firstReach(inWindow, 0.75)),
    reached85: Boolean(firstReach(inWindow, 0.85)),
    reached95: Boolean(firstReach(inWindow, 0.95)),
    reached100: Boolean(firstReach(inWindow, 1)),
    crossed75AfterSkip: Boolean(first75Cross),
    crossed85AfterSkip: Boolean(first85Cross),
    crossed95AfterSkip: Boolean(first95Cross),
    crossed100AfterSkip: Boolean(first100Cross),
    first75CrossAt: first75Cross?.timestamp || null,
    first85CrossAt: first85Cross?.timestamp || null,
    first95CrossAt: first95Cross?.timestamp || null,
    first100CrossAt: first100Cross?.timestamp || null,
    first85At: firstReach(inWindow, 0.85)?.timestamp || null,
    first95At: firstReach(inWindow, 0.95)?.timestamp || null,
    first100At: firstReach(inWindow, 1)?.timestamp || null
  };
}

function classifyFollowThrough(windows) {
  const w30 = windows['30s'] || {};
  const w60 = windows['60s'] || {};
  const w120 = windows['120s'] || {};
  if (!Object.values(windows).some((window) => Number(window.futureSnapshotCount) > 0)) {
    return 'INSUFFICIENT_FOLLOW_THROUGH_DATA';
  }
  if (w30.crossed95AfterSkip || w30.crossed100AfterSkip || Number(w30.curveDelta) >= WAKE_DELTA) {
    return 'WOKE_UP_WITHIN_30S';
  }
  if (w60.crossed95AfterSkip || w60.crossed100AfterSkip || Number(w60.curveDelta) >= WAKE_DELTA) {
    return 'WOKE_UP_WITHIN_60S';
  }
  if (w120.crossed85AfterSkip || w120.crossed95AfterSkip || w120.crossed100AfterSkip || Number(w120.curveDelta) >= WAKE_DELTA) {
    return 'WOKE_UP_WITHIN_120S';
  }
  if (Number(w120.curveDelta) < FLAT_DELTA) return 'FLAT_AFTER_SKIP';
  return 'MODEST_FOLLOW_THROUGH';
}

function analyzeDecision(decision, snapshots) {
  const windows = Object.fromEntries(
    WINDOWS_SECONDS.map((seconds) => [`${seconds}s`, buildWindow(decision, snapshots, seconds)])
  );
  return {
    ...decision,
    followThroughClass: classifyFollowThrough(windows),
    windows
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

function compactCandidate(mint, decisions, snapshots) {
  const analyzed = decisions.map((decision) => analyzeDecision(decision, snapshots));
  const first = analyzed.slice().sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
  const best120 = analyzed
    .map((decision) => decision.windows['120s'])
    .sort((a, b) => Number(b.curveDelta ?? -Infinity) - Number(a.curveDelta ?? -Infinity))[0] || null;
  const maxCurveAfterSkip = Math.max(
    ...analyzed.map((decision) => Number(decision.windows['120s']?.maxCurveProgress)).filter(Number.isFinite),
    0
  );
  return {
    mint,
    symbol: first?.symbol || snapshots.find((snapshot) => snapshot.symbol)?.symbol || null,
    noPriorDecisionCount: analyzed.length,
    snapshotCount: snapshots.length,
    followThroughClasses: countBy(analyzed, (decision) => decision.followThroughClass),
    firstNoPriorAt: first?.timestamp || null,
    firstNoPriorCurveProgress: first?.curveProgress ?? null,
    maxCurveProgressWithin120s: maxCurveAfterSkip ? numberOrNull(maxCurveAfterSkip, 6) : null,
    bestCurveDelta120s: best120?.curveDelta ?? null,
    anyReached85Within120s: analyzed.some((decision) => decision.windows['120s']?.reached85),
    anyReached95Within120s: analyzed.some((decision) => decision.windows['120s']?.reached95),
    anyReached100Within120s: analyzed.some((decision) => decision.windows['120s']?.reached100),
    anyCrossed85Within120s: analyzed.some((decision) => decision.windows['120s']?.crossed85AfterSkip),
    anyCrossed95Within120s: analyzed.some((decision) => decision.windows['120s']?.crossed95AfterSkip),
    anyCrossed100Within120s: analyzed.some((decision) => decision.windows['120s']?.crossed100AfterSkip),
    decisions: analyzed.slice(0, 16)
  };
}

function collectFromFalseNegatives(falseNegativeRows) {
  const snapshots = [];
  const decisions = [];
  for (const candidate of falseNegativeRows) {
    if (!candidate?.mint) continue;
    const samples = Array.isArray(candidate.samples) ? candidate.samples : [];
    for (const sample of samples) {
      const snapshot = snapshotFromSample(sample, candidate);
      if (snapshot) snapshots.push(snapshot);
      const decision = noPriorDecisionFromSample(sample, candidate);
      if (decision) decisions.push(decision);
    }
  }
  return { snapshots, decisions };
}

function buildReport(events, falseNegativeRows, telemetryPath) {
  const window = telemetryWindow(events);
  const telemetrySnapshots = events.map(snapshotFromEvent).filter(Boolean);
  const telemetryDecisions = events.map(noPriorDecisionFromEvent).filter(Boolean);
  const sampleData = collectFromFalseNegatives(falseNegativeRows);
  const sampleSnapshotsInWindow = sampleData.snapshots.filter((item) => inWindow(item, window));
  const sampleDecisionsInWindow = sampleData.decisions.filter((item) => inWindow(item, window));
  const allSnapshots = mergeUniqueBy(
    [...telemetrySnapshots, ...sampleSnapshotsInWindow],
    (item) => `${item.mint}|${item.timestamp}|${item.type}|${item.curveProgress}|${item.score}`
  ).sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
  const allDecisions = mergeUniqueBy(
    [...telemetryDecisions, ...sampleDecisionsInWindow],
    (item) => `${item.mint}|${item.timestamp}|${item.preset || ''}|${item.curveProgress}|${item.score}`
  ).sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));

  const snapshotsByMint = new Map();
  for (const snapshot of allSnapshots) {
    if (!snapshotsByMint.has(snapshot.mint)) snapshotsByMint.set(snapshot.mint, []);
    snapshotsByMint.get(snapshot.mint).push(snapshot);
  }

  const decisionsByMint = new Map();
  for (const decision of allDecisions) {
    if (!decisionsByMint.has(decision.mint)) decisionsByMint.set(decision.mint, []);
    decisionsByMint.get(decision.mint).push(decision);
  }

  const candidates = Array.from(decisionsByMint.entries())
    .map(([mint, decisions]) => compactCandidate(mint, decisions, snapshotsByMint.get(mint) || []))
    .sort((a, b) => {
      const delta = Number(b.bestCurveDelta120s ?? -Infinity) - Number(a.bestCurveDelta120s ?? -Infinity);
      if (delta !== 0) return delta;
      return Number(b.noPriorDecisionCount) - Number(a.noPriorDecisionCount);
    });

  const decisionRows = candidates.flatMap((candidate) => candidate.decisions);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath,
    falseNegativePath: FALSE_NEGATIVE_PATH,
    telemetryWindow: {
      startAt: window.startAt,
      endAt: window.endAt
    },
    windowsSeconds: WINDOWS_SECONDS,
    summary: {
      noPriorDecisionCount: decisionRows.length,
      uniqueMints: candidates.length,
      sourceCoverage: {
        telemetrySnapshots: telemetrySnapshots.length,
        telemetryNoPriorDecisions: telemetryDecisions.length,
        sampleSnapshots: sampleSnapshotsInWindow.length,
        sampleNoPriorDecisions: sampleDecisionsInWindow.length,
        sampleSnapshotsExcludedOutsideTelemetryWindow: sampleData.snapshots.length - sampleSnapshotsInWindow.length,
        sampleNoPriorDecisionsExcludedOutsideTelemetryWindow: sampleData.decisions.length - sampleDecisionsInWindow.length
      },
      followThroughClassCounts: countBy(decisionRows, (decision) => decision.followThroughClass),
      mintsReached85Within120s: candidates.filter((candidate) => candidate.anyReached85Within120s).length,
      mintsReached95Within120s: candidates.filter((candidate) => candidate.anyReached95Within120s).length,
      mintsReached100Within120s: candidates.filter((candidate) => candidate.anyReached100Within120s).length,
      mintsCrossed85Within120s: candidates.filter((candidate) => candidate.anyCrossed85Within120s).length,
      mintsCrossed95Within120s: candidates.filter((candidate) => candidate.anyCrossed95Within120s).length,
      mintsCrossed100Within120s: candidates.filter((candidate) => candidate.anyCrossed100Within120s).length
    },
    candidates,
    note: 'Report-only follow-through diagnostic. It measures what happened after NO_PRIOR_CURVE_PROGRESS paper skips and does not change thresholds, entries, signals, quotes, AI review, or live behavior.'
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
    throw new Error('No telemetry file found for NO_PRIOR follow-through diagnostic.');
  }

  const falseNegativeRows = list(readJson(repoPath(args.falseNegatives) || FALSE_NEGATIVE_PATH, []));
  const report = buildReport(readJsonl(telemetryPath), falseNegativeRows, telemetryPath);
  writeJson(outputPath, report);

  console.log('NO_PRIOR Follow-through Diagnostic');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`NO_PRIOR decisions: ${report.summary.noPriorDecisionCount}`);
  console.log(`Unique mints: ${report.summary.uniqueMints}`);
  console.log(`Follow-through classes: ${JSON.stringify(report.summary.followThroughClassCounts)}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main();
