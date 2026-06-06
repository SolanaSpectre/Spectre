#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-false-negative-recovery-shadow-latest.json');
const EVENT_TYPES = new Set([
  'pre_migration_curve_false_negative_recovery_shadow.would_enter',
  'pre_migration_curve_false_negative_recovery_shadow.would_skip'
]);
const WINDOWS_SECONDS = [120, 300];

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

function telemetryFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return report.files?.telemetryPath || report.telemetryPath || null;
  } catch {
    return null;
  }
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.recovery?.lastCurveProgress
    ?? payload.curveParity?.providerCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function priceOf(payload) {
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    eventType: eventType(event)
  };
}

function shadowFromEvent(event) {
  const type = eventType(event);
  if (!EVENT_TYPES.has(type)) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
  return {
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: type,
    wouldEnter: type.endsWith('.would_enter') || payload.decision === 'RECOVERY_SHADOW_WOULD_ENTER',
    reason: payload.reason || null,
    failedChecks,
    paperEntryPaused: payload.paperEntryPaused === true,
    sourceReason: payload.sourceReason || null,
    score: numberOrNull(payload.score, 2),
    curveProgress: numberOrNull(curveOf(payload), 6),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    walletTouchCount: numberOrNull(payload.walletTouchCount, 0),
    positiveOrProvenTouchCount: numberOrNull(payload.positiveOrProvenTouchCount, 0),
    avoidTouchCount: numberOrNull(payload.avoidTouchCount, 0),
    trackedFirstTouchBuy: payload.trackedFirstTouchBuy || null,
    recovery: payload.recovery || null,
    noTrackedSellAfterQualifyingBuy: payload.noTrackedSellAfterQualifyingBuy || null,
    curveParity: payload.curveParity || null,
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

async function readTelemetry(filePath) {
  const shadows = [];
  const snapshotsByMint = new Map();
  let malformedLines = 0;
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
    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }
    const shadow = shadowFromEvent(event);
    if (shadow) shadows.push(shadow);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  shadows.sort((a, b) => a.atMs - b.atMs);
  return { shadows, snapshotsByMint, malformedLines };
}

function windowAnalysis(shadow, snapshots, seconds) {
  const future = snapshots.filter((snapshot) => snapshot.atMs > shadow.atMs && snapshot.atMs <= shadow.atMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = future.map((snapshot) => Number(snapshot.priceSol)).filter(Number.isFinite);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const curveDelta = maxCurve !== null && shadow.curveProgress !== null ? maxCurve - Number(shadow.curveProgress) : null;
  const priceDelta = maxPrice !== null && Number.isFinite(Number(shadow.priceSol)) && Number(shadow.priceSol) > 0
    ? ((maxPrice - Number(shadow.priceSol)) / Number(shadow.priceSol)) * 100
    : null;
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    curveDelta: numberOrNull(curveDelta, 6),
    maxPriceDeltaPct: numberOrNull(priceDelta, 2),
    crossed85: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.85,
    crossed90: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.9,
    crossed95: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.95
  };
}

function analyzeShadow(shadow, snapshots) {
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) windows[`${seconds}s`] = windowAnalysis(shadow, snapshots, seconds);
  return { ...shadow, windows };
}

function summarizeGroup(name, rows) {
  const w120 = rows.map((row) => row.windows['120s'] || {});
  const w300 = rows.map((row) => row.windows['300s'] || {});
  return {
    name,
    rows: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    crossed85Within120s: w120.filter((row) => row.crossed85).length,
    crossed90Within120s: w120.filter((row) => row.crossed90).length,
    crossed85Within300s: w300.filter((row) => row.crossed85).length,
    crossed90Within300s: w300.filter((row) => row.crossed90).length,
    curveDelta120s: stat(w120.map((row) => row.curveDelta), 6),
    maxPriceDeltaPct120s: stat(w120.map((row) => row.maxPriceDeltaPct), 2),
    curveDelta300s: stat(w300.map((row) => row.curveDelta), 6),
    maxPriceDeltaPct300s: stat(w300.map((row) => row.maxPriceDeltaPct), 2)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || '(none)'}`);
  }

  const { shadows, snapshotsByMint, malformedLines } = await readTelemetry(telemetryPath);
  const analyzed = shadows.map((shadow) => analyzeShadow(shadow, snapshotsByMint.get(shadow.mint) || []));
  const wouldEnter = analyzed.filter((row) => row.wouldEnter);
  const wouldSkip = analyzed.filter((row) => !row.wouldEnter);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_curve_false_negative_recovery_shadow',
    telemetryPath,
    malformedLines,
    summary: {
      rows: analyzed.length,
      wouldEnter: wouldEnter.length,
      wouldSkip: wouldSkip.length,
      uniqueMints: new Set(analyzed.map((row) => row.mint)).size,
      paperEntryPausedRows: analyzed.filter((row) => row.paperEntryPaused).length,
      failedCheckCounts: countBy(wouldSkip.flatMap((row) => row.failedChecks || []), (item) => item),
      reasonCounts: countBy(wouldSkip, (row) => row.reason),
      sourceReasonCounts: countBy(analyzed, (row) => row.sourceReason)
    },
    groups: {
      all: summarizeGroup('all', analyzed),
      wouldEnter: summarizeGroup('wouldEnter', wouldEnter),
      wouldSkip: summarizeGroup('wouldSkip', wouldSkip)
    },
    topWouldEnterFollowThrough: wouldEnter
      .slice()
      .sort((a, b) => Number(b.windows['120s']?.curveDelta || -Infinity) - Number(a.windows['120s']?.curveDelta || -Infinity))
      .slice(0, 12),
    sampleRows: analyzed.slice(0, 25)
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote recovery shadow report: ${OUTPUT_PATH}`);
  console.log(`Rows: ${report.summary.rows}; wouldEnter=${report.summary.wouldEnter}; wouldSkip=${report.summary.wouldSkip}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
