#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-skip-follow-through-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];

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
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
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

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) {
    return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  }
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function classifySnapshotEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  const eventType = event.type || event.event || 'unknown';
  const source = payload.providerCurveSource
    || payload.source
    || payload.provider
    || eventType;
  return {
    mint,
    at: new Date(atMs).toISOString(),
    atMs,
    eventType,
    source,
    symbol: payload.symbol || payload.name || null,
    pairBase: payload.pairBase || null,
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    score: numberOrNull(payload.score ?? payload.maxScore, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol ?? payload.market?.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin ?? payload.market?.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    uniqueBuyerRatio: numberOrNull(payload.uniqueBuyerRatio, 4)
  };
}

function decisionFromEvent(event) {
  if (event.type !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED') return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    at: new Date(atMs).toISOString(),
    atMs,
    symbol: payload.symbol || null,
    reason: payload.reason || 'UNKNOWN',
    preset: payload.preset || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    curveProgress: numberOrNull(curveOf(payload), 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    uniqueBuyerRatio: numberOrNull(payload.uniqueBuyerRatio, 4),
    reasons: Array.isArray(payload.reasons) ? payload.reasons : []
  };
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const decisions = [];
  const eventCounts = {};
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

    const eventType = event.type || event.event || 'unknown';
    eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
    const atMs = timestampMs(payloadOf(event).timestamp || event.timestamp);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }

    const snapshot = classifySnapshotEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }

    const decision = decisionFromEvent(event);
    if (decision) decisions.push(decision);
  }

  for (const rows of snapshotsByMint.values()) {
    rows.sort((a, b) => a.atMs - b.atMs);
  }

  return {
    snapshotsByMint,
    decisions,
    eventCounts,
    malformedLines,
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null
  };
}

function firstCross(snapshots, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function windowAnalysis(decision, allSnapshots, seconds) {
  const endMs = decision.atMs + seconds * 1000;
  const future = allSnapshots.filter((snapshot) => snapshot.atMs > decision.atMs && snapshot.atMs <= endMs);
  const curveValues = future.map((snapshot) => snapshot.curveProgress);
  const priceValues = future.map((snapshot) => snapshot.priceSol);
  const maxCurve = stat(curveValues, 6).max;
  const maxPrice = stat(priceValues, 12).max;
  const minPrice = stat(priceValues, 12).min;
  const startPrice = Number(decision.priceSol);
  const maxPriceDeltaPct = Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null
    ? ((Number(maxPrice) - startPrice) / startPrice) * 100
    : null;
  const minPriceDeltaPct = Number.isFinite(startPrice) && startPrice > 0 && minPrice !== null
    ? ((Number(minPrice) - startPrice) / startPrice) * 100
    : null;
  const curveDelta = maxCurve !== null && Number.isFinite(Number(decision.curveProgress))
    ? Number(maxCurve) - Number(decision.curveProgress)
    : null;
  const crossed75 = firstCross(future, 0.75, decision.curveProgress);
  const crossed85 = firstCross(future, 0.85, decision.curveProgress);
  const crossed90 = firstCross(future, 0.9, decision.curveProgress);
  const crossed95 = firstCross(future, 0.95, decision.curveProgress);
  const crossed100 = firstCross(future, 1, decision.curveProgress);

  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: maxCurve,
    curveDelta: numberOrNull(curveDelta, 6),
    maxPriceSol: maxPrice,
    maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 2),
    minPriceDeltaPct: numberOrNull(minPriceDeltaPct, 2),
    crossed75AfterSkip: Boolean(crossed75),
    crossed85AfterSkip: Boolean(crossed85),
    crossed90AfterSkip: Boolean(crossed90),
    crossed95AfterSkip: Boolean(crossed95),
    crossed100AfterSkip: Boolean(crossed100),
    first75CrossAt: crossed75?.at || null,
    first85CrossAt: crossed85?.at || null,
    first90CrossAt: crossed90?.at || null,
    first95CrossAt: crossed95?.at || null,
    first100CrossAt: crossed100?.at || null
  };
}

function classifyDecision(windows) {
  const w30 = windows['30s'] || {};
  const w60 = windows['60s'] || {};
  const w120 = windows['120s'] || {};
  if (!Object.values(windows).some((window) => Number(window.futureSnapshotCount) > 0)) {
    return 'NO_FUTURE_SNAPSHOTS';
  }
  if (w30.crossed90AfterSkip || Number(w30.curveDelta) >= 0.1) return 'STRONG_WAKE_WITHIN_30S';
  if (w60.crossed90AfterSkip || Number(w60.curveDelta) >= 0.1) return 'STRONG_WAKE_WITHIN_60S';
  if (w120.crossed85AfterSkip || Number(w120.curveDelta) >= 0.05) return 'WOKE_WITHIN_120S';
  if (Number(w120.curveDelta) <= 0.005) return 'FLAT_OR_FADED';
  return 'MODEST_FOLLOW_THROUGH';
}

function analyzeDecision(decision, snapshots) {
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = windowAnalysis(decision, snapshots, seconds);
  }
  return {
    ...decision,
    followThroughClass: classifyDecision(windows),
    windows
  };
}

function compactDecision(decision) {
  return {
    mint: decision.mint,
    symbol: decision.symbol,
    at: decision.at,
    reason: decision.reason,
    preset: decision.preset,
    curveProgress: decision.curveProgress,
    score: decision.score,
    recentVolumeSol: decision.recentVolumeSol,
    tradeVelocityPerMin: decision.tradeVelocityPerMin,
    buyRatio: decision.buyRatio,
    uniqueBuyerCount: decision.uniqueBuyerCount,
    uniqueBuyerRatio: decision.uniqueBuyerRatio,
    followThroughClass: decision.followThroughClass,
    window120s: decision.windows['120s'],
    window300s: decision.windows['300s']
  };
}

function reasonSummary(reason, decisions) {
  const uniqueMints = new Set(decisions.map((decision) => decision.mint));
  const w120 = decisions.map((decision) => decision.windows['120s'] || {});
  const w300 = decisions.map((decision) => decision.windows['300s'] || {});
  const covered120 = w120.filter((window) => Number(window.futureSnapshotCount) > 0);
  const curveDeltas120 = w120.map((window) => window.curveDelta);
  const priceDeltas120 = w120.map((window) => window.maxPriceDeltaPct);
  const top = [...decisions]
    .sort((a, b) => {
      const delta = Number(b.windows['120s']?.curveDelta ?? -Infinity) - Number(a.windows['120s']?.curveDelta ?? -Infinity);
      if (delta !== 0) return delta;
      return Number(b.score ?? -Infinity) - Number(a.score ?? -Infinity);
    })
    .filter((decision, index, rows) => (
      rows.findIndex((candidate) => candidate.mint === decision.mint) === index
    ))
    .slice(0, 8)
    .map(compactDecision);

  const uniqueMintRows = new Map();
  for (const decision of decisions) {
    const existing = uniqueMintRows.get(decision.mint);
    const existingDelta = Number(existing?.windows?.['120s']?.curveDelta ?? -Infinity);
    const nextDelta = Number(decision.windows?.['120s']?.curveDelta ?? -Infinity);
    if (!existing || nextDelta > existingDelta) uniqueMintRows.set(decision.mint, decision);
  }
  const uniqueRows = Array.from(uniqueMintRows.values());
  const uniqueW120 = uniqueRows.map((decision) => decision.windows['120s'] || {});

  return {
    reason,
    decisionCount: decisions.length,
    uniqueMints: uniqueMints.size,
    decisionsWithFuture120s: covered120.length,
    followThroughClassCounts: countBy(decisions, (decision) => decision.followThroughClass),
    crossed85Within120s: w120.filter((window) => window.crossed85AfterSkip).length,
    crossed90Within120s: w120.filter((window) => window.crossed90AfterSkip).length,
    crossed95Within120s: w120.filter((window) => window.crossed95AfterSkip).length,
    crossed100Within120s: w120.filter((window) => window.crossed100AfterSkip).length,
    crossed85Within300s: w300.filter((window) => window.crossed85AfterSkip).length,
    crossed90Within300s: w300.filter((window) => window.crossed90AfterSkip).length,
    uniqueMintsCrossed85Within120s: uniqueW120.filter((window) => window.crossed85AfterSkip).length,
    uniqueMintsCrossed90Within120s: uniqueW120.filter((window) => window.crossed90AfterSkip).length,
    uniqueMintsCrossed95Within120s: uniqueW120.filter((window) => window.crossed95AfterSkip).length,
    uniqueMintsCrossed100Within120s: uniqueW120.filter((window) => window.crossed100AfterSkip).length,
    curveDelta120s: stat(curveDeltas120, 6),
    maxPriceDeltaPct120s: stat(priceDeltas120, 2),
    topFollowThrough: top
  };
}

function buildReport(filePath, telemetry) {
  const analyzed = telemetry.decisions.map((decision) => (
    analyzeDecision(decision, telemetry.snapshotsByMint.get(decision.mint) || [])
  ));
  const byReason = new Map();
  for (const decision of analyzed) {
    const rows = byReason.get(decision.reason) || [];
    rows.push(decision);
    byReason.set(decision.reason, rows);
  }
  const reasonSummaries = Array.from(byReason.entries())
    .map(([reason, decisions]) => reasonSummary(reason, decisions))
    .sort((a, b) => b.decisionCount - a.decisionCount);

  const topWakeups = [...analyzed]
    .sort((a, b) => Number(b.windows['120s']?.curveDelta ?? -Infinity) - Number(a.windows['120s']?.curveDelta ?? -Infinity))
    .filter((decision, index, rows) => (
      rows.findIndex((candidate) => candidate.mint === decision.mint && candidate.reason === decision.reason) === index
    ))
    .slice(0, 20)
    .map(compactDecision);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath: path.relative(ROOT, filePath),
    telemetryWindow: {
      startAt: telemetry.startMs ? new Date(telemetry.startMs).toISOString() : null,
      endAt: telemetry.endMs ? new Date(telemetry.endMs).toISOString() : null
    },
    windowsSeconds: WINDOWS_SECONDS,
    summary: {
      skipDecisionCount: analyzed.length,
      uniqueSkippedMints: new Set(analyzed.map((decision) => decision.mint)).size,
      skipReasonCounts: countBy(analyzed, (decision) => decision.reason),
      followThroughClassCounts: countBy(analyzed, (decision) => decision.followThroughClass),
      reasonsWithAnyCross85Within120s: reasonSummaries.filter((row) => row.crossed85Within120s > 0).map((row) => row.reason),
      reasonsWithAnyCross90Within120s: reasonSummaries.filter((row) => row.crossed90Within120s > 0).map((row) => row.reason)
    },
    reasonSummaries,
    topWakeups,
    sourceCoverage: {
      eventCounts: telemetry.eventCounts,
      malformedLines: telemetry.malformedLines,
      mintsWithCurveSnapshots: telemetry.snapshotsByMint.size
    },
    note: 'Report-only diagnostic joining every pre_migration_paper PAPER_SKIPPED decision to subsequent curve/price snapshots. It does not change thresholds, entries, exits, signals, AI review, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for pre-migration skip follow-through diagnostic.');
  }
  const telemetry = await readTelemetry(telemetryPath);
  const report = buildReport(telemetryPath, telemetry);
  writeJson(outputPath, report);
  console.log('Pre-Migration Skip Follow-through Diagnostic');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Skip decisions: ${report.summary.skipDecisionCount}`);
  console.log(`Unique skipped mints: ${report.summary.uniqueSkippedMints}`);
  console.log(`Skip reasons: ${JSON.stringify(report.summary.skipReasonCounts)}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
