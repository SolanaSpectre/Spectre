#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-mfe-mae-capture-latest.json');
const DEFAULT_MAX_FILES = 24;

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

function priceOf(payload) {
  const direct = Number(payload.quote?.spotPriceSol
    ?? payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const virtualSol = Number(payload.virtualSolReservesSol);
  const virtualTokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(virtualSol) && Number.isFinite(virtualTokens) && virtualTokens > 0
    ? virtualSol / virtualTokens
    : null;
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

function entryKey(row) {
  return [
    row.telemetryPath,
    row.mint,
    row.entryAt || '',
    row.preset || '',
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
  const finite = values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, sum: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  const mid = Math.floor(finite.length / 2);
  const median = finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
  return {
    count: finite.length,
    min: num(finite[0], digits),
    median: num(median, digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    sum: num(sum, digits),
    avg: num(sum / finite.length, digits)
  };
}

function sampleOf(event, telemetryPath) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(priceSol) || priceSol <= 0) return null;
  return {
    telemetryPath,
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    type: eventType(event),
    priceSol,
    curveProgress: curveOf(payload)
  };
}

function entryOf(event, telemetryPath) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const entryMs = timestampMs(payload.entryAt || payload.timestamp || event.timestamp);
  const entryPriceSol = Number(payload.entryPriceSol);
  if (!mint || !Number.isFinite(entryMs) || !Number.isFinite(entryPriceSol) || entryPriceSol <= 0) return null;
  return {
    telemetryPath,
    mint,
    symbol: payload.symbol || null,
    entryAt: new Date(entryMs).toISOString(),
    entryMs,
    preset: payload.preset || payload.presetName || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    entryPriceSol,
    amountSol: num(payload.amountSol, 9) ?? 0.1,
    entryScore: num(payload.entryScore ?? payload.score, 2),
    entryCurveProgress: num(payload.entryCurveProgress ?? payload.curveProgress, 6),
    guardOverride: payload.guardOverride || null,
    reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
    walletClassificationContext: payload.walletClassificationContext || null
  };
}

function exitOf(event, telemetryPath) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const exitMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(exitMs)) return null;
  return {
    telemetryPath,
    mint,
    symbol: payload.symbol || null,
    entryAt: payload.entryAt || null,
    preset: payload.preset || payload.presetName || null,
    profileName: payload.profileName || null,
    entryPriceSol: num(payload.entryPriceSol, 15),
    exitAt: new Date(exitMs).toISOString(),
    exitMs,
    reason: payload.reason || payload.exitReason || null,
    exitPriceSol: num(payload.exitPriceSol, 15),
    exitCurveProgress: num(payload.exitCurveProgress, 6),
    returnPct: num(payload.returnPct, 6),
    pnlSol: num(payload.pnlSol, 9),
    holdSeconds: num(payload.holdSeconds, 2),
    telemetryPeakReturnPct: num(payload.peakReturnPct, 6)
  };
}

async function readTelemetry(filePath) {
  const telemetryPath = path.relative(ROOT, filePath);
  const entries = [];
  const exits = [];
  const samplesByMint = new Map();
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
    const type = eventType(event);
    const sample = sampleOf(event, telemetryPath);
    if (sample) {
      const rows = samplesByMint.get(sample.mint) || [];
      rows.push(sample);
      samplesByMint.set(sample.mint, rows);
    }
    if (type === 'pre_migration_paper.entry') {
      const entry = entryOf(event, telemetryPath);
      if (entry) entries.push(entry);
    } else if (type === 'pre_migration_paper.exit') {
      const exit = exitOf(event, telemetryPath);
      if (exit) exits.push(exit);
    }
  }

  for (const rows of samplesByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  const exitsByKey = new Map(exits.map((exit) => [entryKey(exit), exit]));
  for (const entry of entries) entry.exit = exitsByKey.get(entryKey(entry)) || null;

  return {
    filePath,
    telemetryPath,
    eventCount,
    malformedLines,
    entries,
    exits,
    samplesByMint
  };
}

function classify(row) {
  const mfe = Number(row.mfePct);
  const realized = Number(row.realizedReturnPct);
  const capture = Number(row.captureRatio);
  if (!Number.isFinite(mfe) || row.sampleCount === 0) return 'NO_PRICE_PATH';
  if (mfe < 0.03) return 'ENTRY_NEVER_RAN';
  if (mfe < 0.08) return 'WEAK_ENTRY_MFE';
  if (Number.isFinite(capture) && capture >= 0.5) return 'GOOD_CAPTURE';
  if (Number.isFinite(capture) && capture >= 0.2) return 'PARTIAL_CAPTURE';
  if (Number.isFinite(realized) && realized < 0 && mfe >= 0.08) return 'HIGH_MFE_GAVE_BACK_TO_LOSS';
  if (mfe >= 0.08) return 'LOW_CAPTURE_HIGH_MFE';
  return 'UNCLASSIFIED';
}

function annotateEntry(entry, samplesByMint) {
  const exit = entry.exit || null;
  const endMs = Number.isFinite(exit?.exitMs) ? exit.exitMs : Infinity;
  const pathRows = (samplesByMint.get(entry.mint) || [])
    .filter((sample) => sample.atMs >= entry.entryMs && sample.atMs <= endMs)
    .sort((a, b) => a.atMs - b.atMs);

  let maxReturnPct = -Infinity;
  let minReturnPct = Infinity;
  let maxReturnSample = null;
  let minReturnSample = null;
  let maxCurveProgress = Number(entry.entryCurveProgress);
  let minCurveProgress = Number(entry.entryCurveProgress);

  for (const sample of pathRows) {
    const returnPct = (sample.priceSol - entry.entryPriceSol) / entry.entryPriceSol;
    if (returnPct > maxReturnPct) {
      maxReturnPct = returnPct;
      maxReturnSample = sample;
    }
    if (returnPct < minReturnPct) {
      minReturnPct = returnPct;
      minReturnSample = sample;
    }
    if (Number.isFinite(Number(sample.curveProgress))) {
      maxCurveProgress = Number.isFinite(maxCurveProgress)
        ? Math.max(maxCurveProgress, Number(sample.curveProgress))
        : Number(sample.curveProgress);
      minCurveProgress = Number.isFinite(minCurveProgress)
        ? Math.min(minCurveProgress, Number(sample.curveProgress))
        : Number(sample.curveProgress);
    }
  }

  const realizedReturnPct = Number.isFinite(Number(exit?.returnPct))
    ? Number(exit.returnPct)
    : (pathRows.length ? (pathRows[pathRows.length - 1].priceSol - entry.entryPriceSol) / entry.entryPriceSol : null);
  const pnlSol = Number.isFinite(Number(exit?.pnlSol))
    ? Number(exit.pnlSol)
    : (Number.isFinite(realizedReturnPct) ? Number(entry.amountSol || 0.1) * realizedReturnPct : null);
  const mfePct = Number.isFinite(maxReturnPct) ? maxReturnPct : null;
  const maePct = Number.isFinite(minReturnPct) ? minReturnPct : null;
  const givebackFromPeakPct = Number.isFinite(mfePct) && Number.isFinite(realizedReturnPct)
    ? mfePct - realizedReturnPct
    : null;
  const captureRatio = Number.isFinite(mfePct) && mfePct >= 0.03 && Number.isFinite(realizedReturnPct)
    ? realizedReturnPct / mfePct
    : null;
  const row = {
    telemetryPath: entry.telemetryPath,
    mint: entry.mint,
    symbol: entry.symbol,
    preset: entry.preset,
    lane: entry.lane,
    profileName: entry.profileName,
    entryAt: entry.entryAt,
    exitAt: exit?.exitAt || null,
    entryPriceSol: num(entry.entryPriceSol, 15),
    exitPriceSol: num(exit?.exitPriceSol, 15),
    entryScore: entry.entryScore,
    entryCurveProgress: entry.entryCurveProgress,
    exitCurveProgress: exit?.exitCurveProgress ?? null,
    maxCurveProgress: num(maxCurveProgress, 6),
    minCurveProgress: num(minCurveProgress, 6),
    exitReason: exit?.reason || 'OPEN_OR_SESSION_END',
    holdSeconds: Number.isFinite(Number(exit?.holdSeconds))
      ? num(exit.holdSeconds, 2)
      : (pathRows.length ? num((pathRows[pathRows.length - 1].atMs - entry.entryMs) / 1000, 2) : null),
    realizedReturnPct: num(realizedReturnPct, 6),
    pnlSol: num(pnlSol, 9),
    mfePct: num(mfePct, 6),
    maePct: num(maePct, 6),
    givebackFromPeakPct: num(givebackFromPeakPct, 6),
    captureRatio: num(captureRatio, 6),
    peakAt: maxReturnSample?.at || null,
    troughAt: minReturnSample?.at || null,
    secondsToPeak: maxReturnSample ? num((maxReturnSample.atMs - entry.entryMs) / 1000, 2) : null,
    secondsToTrough: minReturnSample ? num((minReturnSample.atMs - entry.entryMs) / 1000, 2) : null,
    sampleCount: pathRows.length,
    guardOverride: entry.guardOverride,
    walletTouched: Boolean(entry.walletClassificationContext?.touched),
    reasons: entry.reasons.slice(0, 8)
  };
  row.captureClass = classify(row);
  return row;
}

function summarizeRows(rows) {
  const pnlRows = rows.filter((row) => Number.isFinite(Number(row.pnlSol)));
  const totalPnlSol = pnlRows.reduce((sum, row) => sum + Number(row.pnlSol), 0);
  const highMfeRows = rows.filter((row) => Number(row.mfePct) >= 0.08);
  const lowMfeRows = rows.filter((row) => Number(row.mfePct) < 0.03);
  const gaveBackToLossRows = rows.filter((row) => row.captureClass === 'HIGH_MFE_GAVE_BACK_TO_LOSS');
  return {
    entries: rows.length,
    closed: rows.filter((row) => row.exitAt).length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    wins: rows.filter((row) => Number(row.pnlSol) > 0).length,
    losses: rows.filter((row) => Number(row.pnlSol) < 0).length,
    totalPnlSol: num(totalPnlSol, 9),
    avgPnlSol: rows.length ? num(totalPnlSol / rows.length, 9) : null,
    highMfeEntries: highMfeRows.length,
    lowMfeEntries: lowMfeRows.length,
    gaveBackToLossEntries: gaveBackToLossRows.length,
    highMfeRate: rows.length ? num(highMfeRows.length / rows.length, 4) : null,
    lowMfeRate: rows.length ? num(lowMfeRows.length / rows.length, 4) : null,
    gaveBackToLossRate: rows.length ? num(gaveBackToLossRows.length / rows.length, 4) : null,
    realizedReturnPct: stats(rows.map((row) => row.realizedReturnPct), 6),
    mfePct: stats(rows.map((row) => row.mfePct), 6),
    maePct: stats(rows.map((row) => row.maePct), 6),
    givebackFromPeakPct: stats(rows.map((row) => row.givebackFromPeakPct), 6),
    captureRatio: stats(rows.map((row) => row.captureRatio), 6),
    secondsToPeak: stats(rows.map((row) => row.secondsToPeak), 2),
    holdSeconds: stats(rows.map((row) => row.holdSeconds), 2),
    captureClassCounts: countBy(rows, (row) => row.captureClass),
    exitReasonCounts: countBy(rows, (row) => row.exitReason),
    byProfile: countBy(rows, (row) => row.profileName),
    byPreset: countBy(rows, (row) => row.preset)
  };
}

function groupSummaries(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return Object.fromEntries(Array.from(groups.entries())
    .map(([key, group]) => [key, summarizeRows(group)])
    .sort((a, b) => Number(a[1].totalPnlSol || 0) - Number(b[1].totalPnlSol || 0)));
}

function analyze(files) {
  const rows = [];
  for (const file of files) {
    for (const entry of file.entries) {
      rows.push(annotateEntry(entry, file.samplesByMint));
    }
  }
  return {
    rows,
    summary: {
      telemetryFiles: files.length,
      telemetryEvents: files.reduce((sum, file) => sum + file.eventCount, 0),
      malformedLines: files.reduce((sum, file) => sum + file.malformedLines, 0),
      ...summarizeRows(rows)
    },
    byProfile: groupSummaries(rows, (row) => row.profileName),
    byPreset: groupSummaries(rows, (row) => row.preset),
    worstCapture: rows
      .filter((row) => Number.isFinite(Number(row.captureRatio)))
      .sort((a, b) => Number(a.captureRatio ?? 999) - Number(b.captureRatio ?? 999))
      .slice(0, 20),
    bestMfe: rows
      .slice()
      .sort((a, b) => Number(b.mfePct ?? -Infinity) - Number(a.mfePct ?? -Infinity))
      .slice(0, 20),
    worstMae: rows
      .slice()
      .sort((a, b) => Number(a.maePct ?? Infinity) - Number(b.maePct ?? Infinity))
      .slice(0, 20)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicitTelemetry = args.telemetry ? [repoPath(args.telemetry)] : [];
  const paths = explicitTelemetry.length
    ? explicitTelemetry
    : telemetryFiles(Number(args.maxFiles || DEFAULT_MAX_FILES));
  const files = [];
  for (const filePath of paths) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    files.push(await readTelemetry(filePath));
  }

  const analyzed = analyze(files);
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_migration_mfe_mae_capture',
    note: 'Computes max favorable excursion, max adverse excursion, realized return, and capture ratio for actual pre-migration paper entries. Does not change entries, exits, thresholds, scoring, or live behavior.',
    inputs: {
      telemetryFiles: paths.map((filePath) => path.relative(ROOT, filePath)),
      maxFiles: Number(args.maxFiles || DEFAULT_MAX_FILES)
    },
    summary: analyzed.summary,
    byProfile: analyzed.byProfile,
    byPreset: analyzed.byPreset,
    worstCapture: analyzed.worstCapture,
    bestMfe: analyzed.bestMfe,
    worstMae: analyzed.worstMae
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
