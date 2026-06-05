#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-gate-margin-latest.json');
const DEFAULT_MAX_FILES = 8;
const SAMPLE_LIMIT = 12;
const FOLLOW_THROUGH_WINDOWS_SECONDS = [120, 300];
const NEAR_MISS_MIN_READINESS_PCT = 90;

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

function telemetryFiles(maxFiles = DEFAULT_MAX_FILES) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((item) => item.filePath)
    .reverse();
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number((number * 100).toFixed(2));
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload) {
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function ratio(value, threshold, mode) {
  const actual = Number(value);
  const target = Number(threshold);
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return null;
  if (mode === 'max') {
    if (target < 0) return null;
    return Math.max(0, actual <= target ? 1 : target / Math.max(actual, 1e-12));
  }
  if (target <= 0) return actual >= target ? 1 : 0;
  return Math.max(0, actual / target);
}

function scoreDecision(payload) {
  const checks = [];
  const scoreThreshold = Number(payload.threshold);
  if (Number.isFinite(scoreThreshold) && scoreThreshold >= 1) {
    checks.push({
      name: 'score',
      actual: numberOrNull(payload.value ?? payload.score, 4),
      threshold: numberOrNull(scoreThreshold, 4),
      mode: 'min',
      ratio: ratio(payload.value ?? payload.score, scoreThreshold, 'min')
    });
  }

  const curveDeltaThreshold = payload.reason === 'CURVE_NOT_ADVANCING'
    ? Number(payload.threshold)
    : null;
  if (Number.isFinite(curveDeltaThreshold)) {
    checks.push({
      name: 'curveProgressDelta',
      actual: numberOrNull(payload.curveProgressDelta, 6),
      threshold: numberOrNull(curveDeltaThreshold, 6),
      mode: 'min',
      ratio: ratio(payload.curveProgressDelta, curveDeltaThreshold, 'min')
    });
  }

  const earlySurgeCurveDeltaThreshold = Number(payload.earlySurgeThresholds?.minCurveProgressDelta);
  if (Number.isFinite(earlySurgeCurveDeltaThreshold)) {
    checks.push({
      name: 'earlySurgeCurveDelta',
      actual: numberOrNull(payload.earlySurgeCurveProgressDelta ?? payload.curveProgressDelta, 6),
      threshold: numberOrNull(earlySurgeCurveDeltaThreshold, 6),
      mode: 'min',
      ratio: ratio(payload.earlySurgeCurveProgressDelta ?? payload.curveProgressDelta, earlySurgeCurveDeltaThreshold, 'min')
    });
  }

  addThresholdChecks(checks, payload, 'firstCurveSnapshotScalp', payload.firstCurveSnapshotScalpThresholds, [
    ['score', 'firstCurveSnapshotScalpScore', 'minScore', 'min'],
    ['curveProgress', 'firstCurveSnapshotScalpCurveProgress', 'minCurveProgress', 'min'],
    ['curveMax', 'firstCurveSnapshotScalpCurveProgress', 'maxCurveProgress', 'max'],
    ['recentVolumeSol', 'firstCurveSnapshotScalpRecentVolumeSol', 'minRecentVolumeSol', 'min'],
    ['tradeVelocityPerMin', 'firstCurveSnapshotScalpTradeVelocityPerMin', 'minTradeVelocityPerMin', 'min'],
    ['interestSignalCount', 'firstCurveSnapshotScalpInterestSignalCount', 'minInterestCount', 'min'],
    ['uniqueBuyerCount', 'firstCurveSnapshotScalpUniqueBuyerCount', 'minUniqueBuyerCount', 'min'],
    ['riskWalletCount', 'firstCurveSnapshotScalpRiskWalletCount', 'maxRiskWalletCount', 'max'],
    ['sniperWalletCount', 'firstCurveSnapshotScalpSniperWalletCount', 'maxSniperWalletCount', 'max'],
    ['buyRatio', 'firstCurveSnapshotScalpBuyRatio', 'minBuyRatio', 'min']
  ]);

  addThresholdChecks(checks, payload, 'earlySurge', payload.earlySurgeThresholds, [
    ['score', 'earlySurgeScore', 'minScore', 'min'],
    ['curveProgress', 'earlySurgeCurveProgress', 'minCurveProgress', 'min'],
    ['curveMax', 'earlySurgeCurveProgress', 'maxCurveProgress', 'max'],
    ['recentVolumeSol', 'earlySurgeRecentVolumeSol', 'minRecentVolumeSol', 'min'],
    ['tradeVelocityPerMin', 'earlySurgeTradeVelocityPerMin', 'minTradeVelocityPerMin', 'min'],
    ['buyRatio', 'earlySurgeBuyRatio', 'minBuyRatio', 'min']
  ]);

  addThresholdChecks(checks, payload, 'earlyAcceleration', payload.earlyAccelerationThresholds, [
    ['score', 'earlyAccelerationScore', 'minScore', 'min'],
    ['curveProgress', 'earlyAccelerationCurveProgress', 'minCurveProgress', 'min'],
    ['curveMax', 'earlyAccelerationCurveProgress', 'maxCurveProgress', 'max'],
    ['recentVolumeSol', 'earlyAccelerationRecentVolumeSol', 'minRecentVolumeSol', 'min'],
    ['tradeVelocityPerMin', 'earlyAccelerationTradeVelocityPerMin', 'minTradeVelocityPerMin', 'min'],
    ['buyRatio', 'earlyAccelerationBuyRatio', 'minBuyRatio', 'min'],
    ['repeatedEarlyBuyerCount', 'earlyAccelerationRepeatedEarlyBuyerCount', 'minRepeatedEarlyBuyerCount', 'min']
  ]);

  const usable = checks
    .map((check) => ({ ...check, ratio: numberOrNull(check.ratio, 6) }))
    .filter((check) => Number.isFinite(check.ratio));
  const blocking = usable
    .filter((check) => check.ratio < 1)
    .sort((a, b) => a.ratio - b.ratio);
  const tightest = blocking[0] || usable.sort((a, b) => a.ratio - b.ratio)[0] || null;

  return {
    checks: usable,
    blocking,
    tightest,
    readinessRatio: tightest ? tightest.ratio : null,
    readinessPct: tightest ? percent(tightest.ratio) : null
  };
}

function addThresholdChecks(checks, payload, prefix, thresholds, definitions) {
  if (!thresholds || typeof thresholds !== 'object') return;
  for (const [name, actualKey, thresholdKey, mode] of definitions) {
    if (!(thresholdKey in thresholds)) continue;
    checks.push({
      name: `${prefix}.${name}`,
      actual: numberOrNull(payload[actualKey], 6),
      threshold: numberOrNull(thresholds[thresholdKey], 6),
      mode,
      ratio: ratio(payload[actualKey], thresholds[thresholdKey], mode)
    });
  }
}

function decisionFromEvent(event, telemetryPath) {
  if (event.type !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED') return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;

  const margin = scoreDecision(payload);

  return {
    telemetryPath,
    mint,
    symbol: payload.symbol || null,
    at: new Date(atMs).toISOString(),
    atMs,
    preset: payload.preset || 'unknown',
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    reason: payload.reason || 'unknown',
    score: numberOrNull(payload.score, 4),
    threshold: numberOrNull(payload.threshold, 4),
    curveProgress: numberOrNull(curveOf(payload), 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 6),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 6),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    uniqueBuyerRatio: numberOrNull(payload.uniqueBuyerRatio, 6),
    sniperWalletCount: numberOrNull(payload.sniperWalletCount, 0),
    guardOverride: payload.guardOverride || null,
    failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : [],
    reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
    tightestGate: margin.tightest,
    blockingGateCount: margin.blocking.length,
    readinessPct: margin.readinessPct,
    checks: margin.checks
  };
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    at: new Date(atMs).toISOString(),
    atMs,
    eventType: event.type || event.event || 'unknown',
    source: payload.providerCurveSource || payload.source || payload.provider || event.type || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

async function readDecisions(filePath) {
  const telemetryPath = path.relative(ROOT, filePath);
  const decisions = [];
  const snapshotsByMint = new Map();
  let malformedLines = 0;
  let startMs = Infinity;
  let endMs = -Infinity;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    const atMs = timestampMs(payloadOf(event).timestamp || event.timestamp);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }
    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }
    const decision = decisionFromEvent(event, telemetryPath);
    if (decision) decisions.push(decision);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);

  return {
    telemetryPath,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    decisions,
    snapshotsByMint,
    malformedLines
  };
}

function increment(map, key, amount = 1) {
  const normalized = key || 'unknown';
  map[normalized] = (map[normalized] || 0) + amount;
}

function sortedCounts(counts, limit = 20) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
  );
}

function numericStats(values, digits = 4) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: numberOrNull(finite[0], digits),
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function firstCross(snapshots, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function followThroughWindow(row, snapshots, seconds) {
  const future = snapshots.filter((snapshot) => (
    snapshot.atMs > row.atMs && snapshot.atMs <= row.atMs + seconds * 1000
  ));
  const curveValues = future.map((snapshot) => snapshot.curveProgress);
  const priceValues = future.map((snapshot) => snapshot.priceSol);
  const maxCurve = numericStats(curveValues, 6).max;
  const maxPrice = numericStats(priceValues, 12).max;
  const startPrice = Number(row.priceSol);
  const maxPriceDeltaPct = Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null
    ? ((Number(maxPrice) - startPrice) / startPrice) * 100
    : null;
  const curveDelta = maxCurve !== null && Number.isFinite(Number(row.curveProgress))
    ? Number(maxCurve) - Number(row.curveProgress)
    : null;
  const startCurve = Number(row.curveProgress);
  const startedAt85 = Number.isFinite(startCurve) && startCurve >= 0.85;
  const startedAt90 = Number.isFinite(startCurve) && startCurve >= 0.9;
  const startedAt95 = Number.isFinite(startCurve) && startCurve >= 0.95;
  const crossed85 = firstCross(future, 0.85, row.curveProgress);
  const crossed90 = firstCross(future, 0.9, row.curveProgress);
  const crossed95 = firstCross(future, 0.95, row.curveProgress);
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: maxCurve,
    curveDelta: numberOrNull(curveDelta, 6),
    maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 2),
    startedAt85,
    startedAt90,
    startedAt95,
    crossed85AfterSkip: Boolean(crossed85),
    crossed90AfterSkip: Boolean(crossed90),
    crossed95AfterSkip: Boolean(crossed95),
    reached85WithinWindow: startedAt85 || Boolean(crossed85),
    reached90WithinWindow: startedAt90 || Boolean(crossed90),
    reached95WithinWindow: startedAt95 || Boolean(crossed95),
    first85CrossAt: crossed85?.at || null,
    first90CrossAt: crossed90?.at || null,
    first95CrossAt: crossed95?.at || null
  };
}

function analyzeFollowThrough(row, snapshotsByMint) {
  const snapshots = snapshotsByMint.get(row.mint) || [];
  const windows = {};
  for (const seconds of FOLLOW_THROUGH_WINDOWS_SECONDS) {
    windows[`${seconds}s`] = followThroughWindow(row, snapshots, seconds);
  }
  return { ...row, windows };
}

function readinessBand(value) {
  const readiness = Number(value);
  if (!Number.isFinite(readiness)) return 'unknown';
  if (readiness >= 99) return 'ready_99_plus';
  if (readiness >= 97.5) return 'ready_97_5_99';
  if (readiness >= 95) return 'ready_95_97_5';
  if (readiness >= 90) return 'ready_90_95';
  return 'below_90';
}

function sampleFollowThrough(row) {
  return {
    ...sampleDecision(row),
    window120s: row.windows?.['120s'] || null,
    window300s: row.windows?.['300s'] || null
  };
}

function followThroughSummary(rows) {
  const uniqueMints = new Set(rows.map((row) => row.mint));
  const byMint = new Map();
  for (const row of rows) {
    const prev = byMint.get(row.mint);
    const prevDelta = Number(prev?.windows?.['120s']?.curveDelta ?? -Infinity);
    const nextDelta = Number(row.windows?.['120s']?.curveDelta ?? -Infinity);
    if (!prev || nextDelta > prevDelta) byMint.set(row.mint, row);
  }
  const uniqueRows = Array.from(byMint.values());
  const w120 = rows.map((row) => row.windows?.['120s'] || {});
  const uniqueW120 = uniqueRows.map((row) => row.windows?.['120s'] || {});
  const topFollowThrough = [...uniqueRows]
    .sort((a, b) => {
      const delta = Number(b.windows?.['120s']?.curveDelta ?? -Infinity) - Number(a.windows?.['120s']?.curveDelta ?? -Infinity);
      if (delta !== 0) return delta;
      return Number(b.readinessPct ?? -Infinity) - Number(a.readinessPct ?? -Infinity);
    })
    .slice(0, SAMPLE_LIMIT)
    .map(sampleFollowThrough);

  return {
    decisions: rows.length,
    uniqueMints: uniqueMints.size,
    decisionsWithFuture120s: w120.filter((window) => Number(window.futureSnapshotCount) > 0).length,
    crossed85Within120s: w120.filter((window) => window.crossed85AfterSkip).length,
    crossed90Within120s: w120.filter((window) => window.crossed90AfterSkip).length,
    crossed95Within120s: w120.filter((window) => window.crossed95AfterSkip).length,
    reached85Within120s: w120.filter((window) => window.reached85WithinWindow).length,
    reached90Within120s: w120.filter((window) => window.reached90WithinWindow).length,
    reached95Within120s: w120.filter((window) => window.reached95WithinWindow).length,
    uniqueMintsCrossed85Within120s: uniqueW120.filter((window) => window.crossed85AfterSkip).length,
    uniqueMintsCrossed90Within120s: uniqueW120.filter((window) => window.crossed90AfterSkip).length,
    uniqueMintsCrossed95Within120s: uniqueW120.filter((window) => window.crossed95AfterSkip).length,
    uniqueMintsReached85Within120s: uniqueW120.filter((window) => window.reached85WithinWindow).length,
    uniqueMintsReached90Within120s: uniqueW120.filter((window) => window.reached90WithinWindow).length,
    uniqueMintsReached95Within120s: uniqueW120.filter((window) => window.reached95WithinWindow).length,
    curveDelta120s: numericStats(w120.map((window) => window.curveDelta), 6),
    maxPriceDeltaPct120s: numericStats(w120.map((window) => window.maxPriceDeltaPct), 2),
    topFollowThrough
  };
}

function groupFollowThrough(rows, keyFn, limit = 12) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries(
    Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key, rows]) => [key, followThroughSummary(rows)])
  );
}

function groupSummary(decisions, keyFn) {
  const groups = new Map();
  for (const decision of decisions) {
    const key = keyFn(decision) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(decision);
  }
  return Object.fromEntries(
    Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([key, rows]) => {
        const gateCounts = {};
        for (const row of rows) increment(gateCounts, row.tightestGate?.name || 'unknown');
        return [key, {
          decisions: rows.length,
          uniqueMints: new Set(rows.map((row) => row.mint)).size,
          readinessPct: numericStats(rows.map((row) => row.readinessPct), 2),
          tightestGates: sortedCounts(gateCounts, 12),
          closestSamples: rows
            .filter((row) => Number.isFinite(row.readinessPct))
            .sort((a, b) => b.readinessPct - a.readinessPct)
            .slice(0, SAMPLE_LIMIT)
            .map(sampleDecision)
        }];
      })
  );
}

function sampleDecision(row) {
  return {
    at: row.at,
    mint: row.mint,
    symbol: row.symbol,
    preset: row.preset,
    reason: row.reason,
    score: row.score,
    threshold: row.threshold,
    curveProgress: row.curveProgress,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    readinessPct: row.readinessPct,
    tightestGate: row.tightestGate
  };
}

function buildReport(runs) {
  const decisions = runs.flatMap((run) => run.decisions);
  const snapshotsByTelemetry = new Map(runs.map((run) => [run.telemetryPath, run.snapshotsByMint]));
  const reasonCounts = {};
  const presetCounts = {};
  const tightestGateCounts = {};
  for (const row of decisions) {
    increment(reasonCounts, row.reason);
    increment(presetCounts, row.preset);
    increment(tightestGateCounts, row.tightestGate?.name || 'unknown');
  }

  const uniqueMints = new Set(decisions.map((row) => row.mint)).size;
  const closestByMint = Array.from(
    decisions
      .filter((row) => Number.isFinite(row.readinessPct))
      .reduce((map, row) => {
        const prev = map.get(row.mint);
        if (!prev || row.readinessPct > prev.readinessPct) map.set(row.mint, row);
        return map;
      }, new Map())
      .values()
  )
    .sort((a, b) => b.readinessPct - a.readinessPct)
    .slice(0, SAMPLE_LIMIT)
    .map(sampleDecision);
  const analyzedNearMisses = decisions
    .filter((row) => Number(row.readinessPct) >= NEAR_MISS_MIN_READINESS_PCT)
    .map((row) => analyzeFollowThrough(row, snapshotsByTelemetry.get(row.telemetryPath) || new Map()));

  return {
    generatedAt: new Date().toISOString(),
    files: runs.map((run) => ({
      telemetryPath: run.telemetryPath,
      startAt: run.startAt,
      endAt: run.endAt,
      decisions: run.decisions.length,
      malformedLines: run.malformedLines
    })),
    summary: {
      decisions: decisions.length,
      uniqueMints,
      reasonCounts: sortedCounts(reasonCounts, 20),
      presetCounts: sortedCounts(presetCounts, 20),
      tightestGateCounts: sortedCounts(tightestGateCounts, 20),
      readinessPct: numericStats(decisions.map((row) => row.readinessPct), 2)
    },
    byPreset: groupSummary(decisions, (row) => row.preset),
    byReason: groupSummary(decisions, (row) => row.reason),
    nearMissFollowThrough: {
      mode: 'report_only',
      minReadinessPct: NEAR_MISS_MIN_READINESS_PCT,
      windowsSeconds: FOLLOW_THROUGH_WINDOWS_SECONDS,
      summary: followThroughSummary(analyzedNearMisses),
      byReadinessBand: groupFollowThrough(analyzedNearMisses, (row) => readinessBand(row.readinessPct)),
      byTightestGate: groupFollowThrough(analyzedNearMisses, (row) => row.tightestGate?.name),
      byReason: groupFollowThrough(analyzedNearMisses, (row) => row.reason),
      note: 'Near-miss follow-through joins skipped decisions with readiness >= minReadinessPct to later same-run curve/price snapshots. It is report-only and does not alter runtime behavior.'
    },
    closestByMint,
    note: 'Report-only diagnostic for skipped pre-migration paper entries. It ranks the tightest measurable gate by preset/reason and does not alter runtime gates, entries, exits, scoring, quotes, AI review, or live behavior.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((item) => repoPath(item.trim())).filter((item) => item && fs.existsSync(item))
    : telemetryFiles(Number(args.limit) || DEFAULT_MAX_FILES);

  if (!files.length) {
    throw new Error('No telemetry files found');
  }

  const runs = [];
  for (const filePath of files) {
    runs.push(await readDecisions(filePath));
  }

  const report = buildReport(runs);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`Decisions: ${report.summary.decisions}, unique mints: ${report.summary.uniqueMints}`);
  console.log(`Top tightest gates: ${JSON.stringify(report.summary.tightestGateCounts)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  decisionFromEvent,
  parseArgs,
  readDecisions,
  scoreDecision
};
