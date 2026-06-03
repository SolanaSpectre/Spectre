#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-reject-follow-through-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];
const DEFAULT_LIMIT = 8;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const inlineValueAt = arg.indexOf('=');
    if (inlineValueAt > 2) {
      args[arg.slice(2, inlineValueAt)] = arg.slice(inlineValueAt + 1);
      continue;
    }
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

function telemetryFiles(limit = DEFAULT_LIMIT) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath)
    .reverse();
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
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
    eventType: event.type || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

function rejectFromEvent(event) {
  if (event.type !== 'trade.rejected') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    reason: payload.reason || 'UNKNOWN',
    pumpFailureReason: payload.pumpFailureReason || null,
    momentumScore: numberOrNull(payload.momentumScore, 4),
    qualityScore: numberOrNull(payload.qualityScore, 4),
    rankScore: numberOrNull(payload.rankScore, 4)
  };
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const rejects = [];
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
    const reject = rejectFromEvent(event);
    if (reject) rejects.push(reject);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  rejects.sort((a, b) => a.atMs - b.atMs);
  return {
    telemetryPath: path.relative(ROOT, filePath),
    snapshotsByMint,
    rejects,
    malformedLines
  };
}

function firstAtOrAbove(rows, threshold) {
  return rows.find((row) => Number(row.curveProgress) >= threshold) || null;
}

function analyzeReject(run, reject) {
  const snapshots = run.snapshotsByMint.get(reject.mint) || [];
  const later = snapshots.filter((row) => row.atMs > reject.atMs);
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    const rows = later.filter((row) => row.atMs <= reject.atMs + seconds * 1000);
    const curves = rows.map((row) => row.curveProgress);
    const prices = rows.map((row) => row.priceSol);
    const startPrice = Number(reject.priceSol);
    const maxPrice = stat(prices, 12).max;
    windows[`${seconds}s`] = {
      snapshots: rows.length,
      maxCurveProgress: stat(curves, 6).max,
      crossed85: Boolean(firstAtOrAbove(rows, 0.85)),
      crossed90: Boolean(firstAtOrAbove(rows, 0.90)),
      maxPriceDeltaPct: Number.isFinite(startPrice) && startPrice > 0 && Number.isFinite(maxPrice)
        ? numberOrNull(((maxPrice / startPrice) - 1) * 100, 2)
        : null
    };
  }
  return {
    ...reject,
    telemetryPath: run.telemetryPath,
    windows
  };
}

function attachStartState(run, reject) {
  const snapshots = run.snapshotsByMint.get(reject.mint) || [];
  const prior = snapshots
    .filter((row) => row.atMs <= reject.atMs)
    .sort((a, b) => b.atMs - a.atMs)[0] || null;
  return {
    ...reject,
    curveProgress: prior?.curveProgress ?? null,
    priceSol: prior?.priceSol ?? null
  };
}

function summarizeGroup(rows) {
  const w120 = rows.map((row) => row.windows['120s'] || {});
  const pre90 = rows.filter((row) => Number(row.curveProgress) < 0.9);
  const pre90w120 = pre90.map((row) => row.windows['120s'] || {});
  return {
    rejects: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    crossed85Within120s: w120.filter((row) => row.crossed85).length,
    crossed90Within120s: w120.filter((row) => row.crossed90).length,
    pre90Rejects: pre90.length,
    pre90UniqueMints: new Set(pre90.map((row) => row.mint)).size,
    pre90Crossed85Within120s: pre90w120.filter((row) => row.crossed85).length,
    pre90Crossed90Within120s: pre90w120.filter((row) => row.crossed90).length,
    maxCurve120s: stat(w120.map((row) => row.maxCurveProgress), 6),
    maxPriceDeltaPct120s: stat(w120.map((row) => row.maxPriceDeltaPct), 2),
    pre90MaxCurve120s: stat(pre90w120.map((row) => row.maxCurveProgress), 6),
    pre90MaxPriceDeltaPct120s: stat(pre90w120.map((row) => row.maxPriceDeltaPct), 2)
  };
}

function buildReport(runs) {
  const rawAnalyzed = [];
  for (const run of runs) {
    for (const rawReject of run.rejects) {
      rawAnalyzed.push(analyzeReject(run, attachStartState(run, rawReject)));
    }
  }
  const analyzed = Array.from(rawAnalyzed
    .reduce((map, row) => {
      const key = `${row.telemetryPath}:${row.mint}:${row.reason}:${row.pumpFailureReason || 'none'}`;
      const previous = map.get(key);
      if (!previous || row.atMs < previous.atMs) map.set(key, row);
      return map;
    }, new Map())
    .values());
  const topWakeups = analyzed
    .slice()
    .sort((a, b) => {
      const curveDelta = Number(b.windows['120s']?.maxCurveProgress || 0) - Number(a.windows['120s']?.maxCurveProgress || 0);
      if (curveDelta !== 0) return curveDelta;
      return Number(b.windows['120s']?.maxPriceDeltaPct || 0) - Number(a.windows['120s']?.maxPriceDeltaPct || 0);
    })
    .slice(0, 20);
  const topPre90Wakeups = analyzed
    .filter((row) => Number(row.curveProgress) < 0.9)
    .sort((a, b) => {
      const priceDelta = Number(b.windows['120s']?.maxPriceDeltaPct || 0) - Number(a.windows['120s']?.maxPriceDeltaPct || 0);
      if (priceDelta !== 0) return priceDelta;
      return Number(b.windows['120s']?.maxCurveProgress || 0) - Number(a.windows['120s']?.maxCurveProgress || 0);
    })
    .slice(0, 20);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0)
    },
    summary: {
      rawRejects: rawAnalyzed.length,
      rejects: analyzed.length,
      uniqueMints: new Set(analyzed.map((row) => row.mint)).size,
      reasonCounts: countBy(analyzed, (row) => row.reason),
      pumpFailureReasonCounts: countBy(analyzed, (row) => row.pumpFailureReason),
      ...summarizeGroup(analyzed)
    },
    byReason: Object.fromEntries(
      Object.entries(groupBy(analyzed, (row) => row.reason))
        .map(([key, rows]) => [key, summarizeGroup(rows)])
    ),
    byPumpFailureReason: Object.fromEntries(
      Object.entries(groupBy(analyzed, (row) => row.pumpFailureReason))
        .map(([key, rows]) => [key, summarizeGroup(rows)])
    ),
    topWakeups,
    topPre90Wakeups,
    note: 'Report-only follow-through for runner/scalper trade.rejected telemetry. It does not change gates, entries, AI review, quotes, execution, or live broadcast.'
  };
}

function groupBy(rows, keyFn) {
  return rows.reduce((groups, row) => {
    const key = keyFn(row) || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
    return groups;
  }, {});
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((item) => repoPath(item.trim())).filter((item) => item && fs.existsSync(item))
    : telemetryFiles(Number(args.limit) || DEFAULT_LIMIT);
  if (!files.length) throw new Error('No telemetry files found');

  const runs = [];
  for (const filePath of files) runs.push(await readTelemetry(filePath));
  const report = buildReport(runs);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`Rejects: ${report.summary.rejects}, unique mints: ${report.summary.uniqueMints}`);
  console.log(`Crossed 85/90 within 120s: ${report.summary.crossed85Within120s}/${report.summary.crossed90Within120s}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  analyzeReject,
  buildReport,
  parseArgs,
  readTelemetry
};
