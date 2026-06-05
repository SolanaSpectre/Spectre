#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-false-negative-shadow-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];
const EVENT_TYPES = new Set([
  'pre_migration_curve_false_negative_shadow.would_watch',
  'pre_migration_curve_false_negative_shadow.would_skip'
]);

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

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
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
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: num(pick(0.5), digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    avg: num(sum / finite.length, digits)
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
    atMs,
    at: new Date(atMs).toISOString(),
    curveProgress: num(curveProgress, 6),
    priceSol: num(priceOf(payload), 12),
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
  return {
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: type,
    wouldWatch: type.endsWith('.would_watch') || payload.wouldWatch === true,
    shadowReason: payload.shadowReason || null,
    matchedFilters: Array.isArray(payload.matchedFilters) ? payload.matchedFilters : [],
    score: num(payload.score, 2),
    curveProgress: num(curveOf(payload), 6),
    curveProgressDelta: num(payload.curveProgressDelta, 6),
    readinessPct: num(payload.readinessPct, 2),
    recentVolumeSol: num(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: num(payload.tradeVelocityPerMin, 2),
    buyRatio: num(payload.buyRatio, 4),
    uniqueBuyerCount: num(payload.uniqueBuyerCount, 0),
    walletTouchCount: num(payload.walletTouchCount, 0),
    positiveWalletTouchCount: num(payload.positiveWalletTouchCount, 0),
    avoidWalletTouchCount: num(payload.avoidWalletTouchCount, 0),
    narrowCore: payload.narrowCore === true,
    narrowCoreVolume: payload.narrowCoreVolume === true,
    narrowCorePositiveWallet: payload.narrowCorePositiveWallet === true,
    shadowTier: payload.shadowTier || null,
    priceSol: num(priceOf(payload), 12)
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
    maxCurveProgress: num(maxCurve, 6),
    curveDelta: num(curveDelta, 6),
    maxPriceDeltaPct: num(priceDelta, 2),
    crossed85: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.85,
    crossed90: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.9,
    crossed95: Number.isFinite(Number(maxCurve)) && maxCurve >= 0.95
  };
}

function analyzeShadow(shadow, snapshots) {
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) windows[`${seconds}s`] = windowAnalysis(shadow, snapshots, seconds);
  const narrowCore = shadow.narrowCore
    || (Number(shadow.score) >= 50 && Number(shadow.curveProgress) >= 0.3);
  const narrowCoreVolume = shadow.narrowCoreVolume
    || (narrowCore && Number(shadow.recentVolumeSol) >= 12);
  const narrowCorePositiveWallet = shadow.narrowCorePositiveWallet
    || (narrowCore && Number(shadow.positiveWalletTouchCount || 0) > 0);
  const shadowTier = shadow.shadowTier
    || (narrowCorePositiveWallet
      ? 'NARROW_CORE_POSITIVE_WALLET'
      : narrowCoreVolume
        ? 'NARROW_CORE_VOLUME'
        : narrowCore
          ? 'NARROW_CORE'
          : shadow.wouldWatch
            ? 'BROAD_WATCH'
            : 'SKIP');
  return { ...shadow, narrowCore, narrowCoreVolume, narrowCorePositiveWallet, shadowTier, windows };
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
    topFollowThrough: rows.slice()
      .sort((a, b) => Number(b.windows['120s']?.curveDelta ?? -Infinity) - Number(a.windows['120s']?.curveDelta ?? -Infinity))
      .slice(0, 8)
  };
}

function buildReport(filePath, telemetry) {
  const analyzed = telemetry.shadows.map((shadow) => analyzeShadow(shadow, telemetry.snapshotsByMint.get(shadow.mint) || []));
  const watched = analyzed.filter((row) => row.wouldWatch);
  const skipped = analyzed.filter((row) => !row.wouldWatch);
  const narrowCore = watched.filter((row) => row.narrowCore);
  const narrowCoreVolume = watched.filter((row) => row.narrowCoreVolume);
  const narrowCorePositiveWallet = watched.filter((row) => row.narrowCorePositiveWallet);
  const filterRows = [];
  for (const filter of new Set(analyzed.flatMap((row) => row.matchedFilters))) {
    filterRows.push(summarizeGroup(filter, analyzed.filter((row) => row.matchedFilters.includes(filter))));
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath: path.relative(ROOT, filePath),
    summary: {
      shadowRows: analyzed.length,
      wouldWatch: watched.length,
      wouldSkip: skipped.length,
      uniqueWouldWatchMints: new Set(watched.map((row) => row.mint)).size,
      uniqueWouldSkipMints: new Set(skipped.map((row) => row.mint)).size,
      matchedFilterCounts: countBy(watched.flatMap((row) => row.matchedFilters), (filter) => filter),
      shadowTierCounts: countBy(analyzed, (row) => row.shadowTier),
      watched: summarizeGroup('would_watch', watched),
      skipped: summarizeGroup('would_skip', skipped),
      narrowCore: summarizeGroup('narrow_core_score50_curve30', narrowCore),
      narrowCoreVolume: summarizeGroup('narrow_core_score50_curve30_volume12', narrowCoreVolume),
      narrowCorePositiveWallet: summarizeGroup('narrow_core_score50_curve30_positive_wallet', narrowCorePositiveWallet)
    },
    byFilter: filterRows.sort((a, b) => b.rows - a.rows),
    watchedTopFollowThrough: summarizeGroup('would_watch', watched).topFollowThrough,
    sourceCoverage: {
      malformedLines: telemetry.malformedLines,
      mintsWithCurveSnapshots: telemetry.snapshotsByMint.size
    },
    note: 'Prospective report-only shadow lane for CURVE_NOT_ADVANCING ex-ante filters. Rows are logged during runtime before future movement is known. This report only measures follow-through; it does not change entries or live behavior.'
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
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found.');
  const telemetry = await readTelemetry(telemetryPath);
  const report = buildReport(telemetryPath, telemetry);
  writeJson(outputPath, report);
  console.log('Pre-Migration Curve False-Negative Shadow Report');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Rows / would_watch / would_skip: ${report.summary.shadowRows} / ${report.summary.wouldWatch} / ${report.summary.wouldSkip}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  OUTPUT_PATH
};
