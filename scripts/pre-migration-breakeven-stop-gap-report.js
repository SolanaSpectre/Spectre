#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-breakeven-stop-gap-latest.json');
const DEFAULT_MAX_FILES = 24;
const DEFAULT_LOSS_GAP_PCT = Number(process.env.PRE_MIGRATION_BREAKEVEN_GAP_LOSS_PCT || 0.02);
const DEFAULT_GIVEBACK_GAP_PCT = Number(process.env.PRE_MIGRATION_BREAKEVEN_GIVEBACK_GAP_PCT || 0.1);

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

function payloadOf(event) {
  return event.payload || event.data || {};
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

function priceOf(payload) {
  const raw = payload.quote?.spotPriceSol
    ?? payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.entryPriceSol
    ?? payload.exitPriceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function curveOf(payload) {
  const raw = payload.accountCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function exitKey(row) {
  return [
    row.telemetryPath,
    row.mint,
    row.entryAt || '',
    row.profileName || '',
    row.entryPriceSol || ''
  ].join(':');
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function stats(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, sum: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: num(finite[0], digits),
    median: num(pick(0.5), digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    sum: num(sum, digits),
    avg: num(sum / finite.length, digits)
  };
}

function snapshotFromEvent(event, telemetryPath) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const priceSol = priceOf(payload);
  const curveProgress = curveOf(payload);
  if (!Number.isFinite(priceSol) && !Number.isFinite(curveProgress)) return null;
  return {
    telemetryPath,
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    type: event.type || event.event || 'unknown',
    priceSol: num(priceSol, 15),
    curveProgress: num(curveProgress, 6)
  };
}

async function readTelemetry(filePath) {
  const telemetryPath = path.relative(ROOT, filePath);
  const exits = [];
  const snapshotsByMint = new Map();
  let malformedLines = 0;
  let eventCount = 0;

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

    eventCount += 1;
    const type = event.type || event.event || 'unknown';
    const payload = payloadOf(event);
    const snapshot = snapshotFromEvent(event, telemetryPath);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }

    if (type !== 'pre_migration_paper.exit') continue;
    const reason = payload.reason || payload.exitReason || null;
    if (reason !== 'BREAKEVEN_STOP') continue;
    const mint = mintOf(payload);
    const exitMs = timestampMs(payload.timestamp || event.timestamp);
    const entryMs = timestampMs(payload.entryAt);
    if (!mint || !Number.isFinite(exitMs)) continue;
    const returnPct = num(payload.returnPct, 6);
    const peakReturnPct = num(payload.peakReturnPct, 6);
    const givebackPct = Number.isFinite(Number(peakReturnPct)) && Number.isFinite(Number(returnPct))
      ? num(Number(peakReturnPct) - Number(returnPct), 6)
      : null;
    exits.push({
      telemetryPath,
      mint,
      symbol: payload.symbol || null,
      exitAt: new Date(exitMs).toISOString(),
      exitMs,
      entryAt: Number.isFinite(entryMs) ? new Date(entryMs).toISOString() : payload.entryAt || null,
      entryMs,
      preset: payload.preset || null,
      lane: payload.lane || null,
      profileName: payload.profileName || null,
      entryPriceSol: num(payload.entryPriceSol, 15),
      exitPriceSol: num(payload.exitPriceSol, 15),
      entryCurveProgress: num(payload.entryCurveProgress, 6),
      exitCurveProgress: num(payload.exitCurveProgress, 6),
      maxCurveProgress: num(payload.maxCurveProgress, 6),
      returnPct,
      peakReturnPct,
      givebackPct,
      belowBreakevenPct: Number.isFinite(Number(returnPct)) && Number(returnPct) < 0 ? num(Math.abs(Number(returnPct)), 6) : 0,
      pnlSol: num(payload.pnlSol, 9),
      holdSeconds: num(payload.holdSeconds, 2),
      exitProfile: payload.exitProfile || null
    });
  }

  for (const rows of snapshotsByMint.values()) {
    rows.sort((a, b) => a.atMs - b.atMs);
  }

  return {
    filePath,
    telemetryPath,
    eventCount,
    malformedLines,
    exits,
    snapshotsByMint
  };
}

function annotateExit(exit, snapshotsByMint, thresholds) {
  const snapshots = snapshotsByMint.get(exit.mint) || [];
  const inWindow = Number.isFinite(exit.entryMs)
    ? snapshots.filter((row) => row.atMs >= exit.entryMs && row.atMs <= exit.exitMs)
    : [];
  const priceSnapshots = inWindow.filter((row) => Number.isFinite(Number(row.priceSol)));
  const curveSnapshots = inWindow.filter((row) => Number.isFinite(Number(row.curveProgress)));
  const previousPriceSnapshot = priceSnapshots
    .filter((row) => row.atMs < exit.exitMs)
    .slice(-1)[0] || null;
  const exitSnapshot = priceSnapshots.slice(-1)[0] || null;
  const previousReturnPct = previousPriceSnapshot && Number(exit.entryPriceSol) > 0
    ? num((Number(previousPriceSnapshot.priceSol) - Number(exit.entryPriceSol)) / Number(exit.entryPriceSol), 6)
    : null;
  const exitObservationGapMs = previousPriceSnapshot
    ? exit.exitMs - previousPriceSnapshot.atMs
    : null;
  const maxObservedPriceSol = priceSnapshots.reduce((max, row) => (
    Number(row.priceSol) > max ? Number(row.priceSol) : max
  ), -Infinity);
  const minObservedPriceSol = priceSnapshots.reduce((min, row) => (
    Number(row.priceSol) < min ? Number(row.priceSol) : min
  ), Infinity);
  const gapFlags = [];
  if (Number(exit.returnPct) < -thresholds.lossGapPct) gapFlags.push('BREAKEVEN_EXIT_BELOW_ENTRY');
  if (Number(exit.givebackPct) > thresholds.givebackGapPct) gapFlags.push('LARGE_PEAK_GIVEBACK');
  if (Number.isFinite(exitObservationGapMs) && exitObservationGapMs > 10000) gapFlags.push('EXIT_PRICE_OBSERVATION_GAP_GT_10S');
  if (priceSnapshots.length <= 2) gapFlags.push('THIN_PRICE_OBSERVATIONS');

  return {
    ...exit,
    observation: {
      priceSnapshotCount: priceSnapshots.length,
      curveSnapshotCount: curveSnapshots.length,
      firstPriceAt: priceSnapshots[0]?.at || null,
      previousPriceAt: previousPriceSnapshot?.at || null,
      exitPriceSnapshotAt: exitSnapshot?.at || null,
      exitObservationGapMs: num(exitObservationGapMs, 0),
      previousReturnPct,
      maxObservedPriceSol: Number.isFinite(maxObservedPriceSol) ? num(maxObservedPriceSol, 15) : null,
      minObservedPriceSol: Number.isFinite(minObservedPriceSol) ? num(minObservedPriceSol, 15) : null
    },
    gapFlags
  };
}

function analyze(rows, thresholds) {
  const allExits = [];
  for (const row of rows) {
    for (const exit of row.exits) {
      allExits.push(annotateExit(exit, row.snapshotsByMint, thresholds));
    }
  }

  const losses = allExits.filter((row) => Number(row.pnlSol) < 0 || Number(row.returnPct) < 0);
  const gapLosses = allExits.filter((row) => row.gapFlags.includes('BREAKEVEN_EXIT_BELOW_ENTRY'));
  const largeGivebacks = allExits.filter((row) => row.gapFlags.includes('LARGE_PEAK_GIVEBACK'));
  const totalPnlSol = allExits.reduce((sum, row) => (
    Number.isFinite(Number(row.pnlSol)) ? sum + Number(row.pnlSol) : sum
  ), 0);
  const lossPnlSol = losses.reduce((sum, row) => (
    Number.isFinite(Number(row.pnlSol)) ? sum + Number(row.pnlSol) : sum
  ), 0);

  return {
    exits: allExits,
    summary: {
      telemetryFiles: rows.length,
      telemetryEvents: rows.reduce((sum, row) => sum + row.eventCount, 0),
      malformedLines: rows.reduce((sum, row) => sum + row.malformedLines, 0),
      breakevenStops: allExits.length,
      breakevenStopLosses: losses.length,
      breakevenGapLosses: gapLosses.length,
      largePeakGivebacks: largeGivebacks.length,
      uniqueMints: new Set(allExits.map((row) => row.mint)).size,
      totalPnlSol: num(totalPnlSol, 9),
      lossPnlSol: num(lossPnlSol, 9),
      returnPct: stats(allExits.map((row) => row.returnPct), 6),
      peakReturnPct: stats(allExits.map((row) => row.peakReturnPct), 6),
      givebackPct: stats(allExits.map((row) => row.givebackPct), 6),
      belowBreakevenPct: stats(allExits.map((row) => row.belowBreakevenPct), 6),
      holdSeconds: stats(allExits.map((row) => row.holdSeconds), 2),
      priceSnapshotCount: stats(allExits.map((row) => row.observation.priceSnapshotCount), 0),
      exitObservationGapMs: stats(allExits.map((row) => row.observation.exitObservationGapMs), 0),
      byProfile: countBy(allExits, (row) => row.profileName),
      byPreset: countBy(allExits, (row) => row.preset),
      flagCounts: countBy(allExits.flatMap((row) => row.gapFlags.map((flag) => ({ flag }))), (row) => row.flag)
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicitTelemetry = args.telemetry ? [repoPath(args.telemetry)] : [];
  const files = explicitTelemetry.length
    ? explicitTelemetry
    : telemetryFiles(Number(args.maxFiles || DEFAULT_MAX_FILES));
  const thresholds = {
    lossGapPct: Number.isFinite(Number(args.lossGapPct)) ? Number(args.lossGapPct) : DEFAULT_LOSS_GAP_PCT,
    givebackGapPct: Number.isFinite(Number(args.givebackGapPct)) ? Number(args.givebackGapPct) : DEFAULT_GIVEBACK_GAP_PCT
  };
  const rows = [];
  for (const filePath of files) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    rows.push(await readTelemetry(filePath));
  }

  const analyzed = analyze(rows, thresholds);
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_breakeven_stop_gap',
    note: 'Audits BREAKEVEN_STOP exits for below-entry fills, large peak giveback, and thin/stale observation context. Does not change paper or live trading behavior.',
    inputs: {
      telemetryFiles: files.map((filePath) => path.relative(ROOT, filePath)),
      thresholds
    },
    summary: analyzed.summary,
    worstBreakevenStops: analyzed.exits
      .sort((a, b) => Number(a.pnlSol || 0) - Number(b.pnlSol || 0) || Number(b.givebackPct || 0) - Number(a.givebackPct || 0))
      .slice(0, 20)
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(JSON.stringify(output.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
