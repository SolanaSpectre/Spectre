#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-skip-near-90-watchlist-latest.json');
const TARGET_REASONS = new Set(['LOW_SCORE', 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE']);
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
    .map((item) => item.filePath);
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
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
    eventType: event.type || event.event || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

function decisionFromEvent(event) {
  if (event.type !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED') return null;
  if (!TARGET_REASONS.has(payload.reason)) return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    reason: payload.reason,
    preset: payload.preset || null,
    curveProgress: numberOrNull(curveOf(payload), 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    uniqueBuyerRatio: numberOrNull(payload.uniqueBuyerRatio, 4)
  };
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const decisions = [];
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

    const decision = decisionFromEvent(event);
    if (decision) decisions.push(decision);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);

  return {
    telemetryPath: path.relative(ROOT, filePath),
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null,
    snapshotsByMint,
    decisions,
    malformedLines
  };
}

function firstCross(snapshots, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function analyzeDecision(run, decision) {
  const snapshots = run.snapshotsByMint.get(decision.mint) || [];
  const after120 = snapshots.filter((snapshot) => snapshot.atMs > decision.atMs && snapshot.atMs <= decision.atMs + 120000);
  const after300 = snapshots.filter((snapshot) => snapshot.atMs > decision.atMs && snapshot.atMs <= decision.atMs + 300000);
  const max120 = stat(after120.map((snapshot) => snapshot.curveProgress), 6).max;
  const max300 = stat(after300.map((snapshot) => snapshot.curveProgress), 6).max;
  const startCurve = Number(decision.curveProgress);
  const startPrice = Number(decision.priceSol);
  const maxPrice120 = stat(after120.map((snapshot) => snapshot.priceSol), 12).max;
  const maxPrice300 = stat(after300.map((snapshot) => snapshot.priceSol), 12).max;
  const priceDelta120 = Number.isFinite(startPrice) && startPrice > 0 && maxPrice120 !== null
    ? ((Number(maxPrice120) - startPrice) / startPrice) * 100
    : null;
  const priceDelta300 = Number.isFinite(startPrice) && startPrice > 0 && maxPrice300 !== null
    ? ((Number(maxPrice300) - startPrice) / startPrice) * 100
    : null;
  const cross90_120 = firstCross(after120, 0.9, startCurve);
  const cross90_300 = firstCross(after300, 0.9, startCurve);
  return {
    ...decision,
    telemetryPath: run.telemetryPath,
    window120s: {
      futureSnapshotCount: after120.length,
      maxCurveProgress: max120,
      curveDelta: max120 !== null && Number.isFinite(startCurve) ? numberOrNull(Number(max120) - startCurve, 6) : null,
      crossed90AfterSkip: Boolean(cross90_120),
      first90CrossAt: cross90_120?.at || null,
      maxPriceDeltaPct: numberOrNull(priceDelta120, 2)
    },
    window300s: {
      futureSnapshotCount: after300.length,
      maxCurveProgress: max300,
      curveDelta: max300 !== null && Number.isFinite(startCurve) ? numberOrNull(Number(max300) - startCurve, 6) : null,
      crossed90AfterSkip: Boolean(cross90_300),
      first90CrossAt: cross90_300?.at || null,
      maxPriceDeltaPct: numberOrNull(priceDelta300, 2)
    }
  };
}

function dedupeByRunMint(rows) {
  const byRunMint = new Map();
  for (const row of rows) {
    const key = `${row.telemetryPath}::${row.mint}`;
    const existing = byRunMint.get(key);
    const existingRank = Number(existing?.window120s?.maxCurveProgress ?? -Infinity);
    const nextRank = Number(row.window120s?.maxCurveProgress ?? -Infinity);
    if (!existing || nextRank > existingRank) {
      const reasons = new Set(existing?.reasons || []);
      reasons.add(row.reason);
      byRunMint.set(key, { ...row, reasons: Array.from(reasons).sort() });
    } else if (existing) {
      const reasons = new Set(existing.reasons || []);
      reasons.add(row.reason);
      existing.reasons = Array.from(reasons).sort();
    }
  }
  return Array.from(byRunMint.values());
}

function compact(row) {
  return {
    telemetryPath: row.telemetryPath,
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    reasons: row.reasons || [row.reason],
    preset: row.preset,
    curveProgress: row.curveProgress,
    score: row.score,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    buyRatio: row.buyRatio,
    uniqueBuyerCount: row.uniqueBuyerCount,
    uniqueBuyerRatio: row.uniqueBuyerRatio,
    window120s: row.window120s,
    window300s: row.window300s
  };
}

function buildReport(runs) {
  const analyzed = runs.flatMap((run) => run.decisions.map((decision) => analyzeDecision(run, decision)));
  const uniqueRows = dedupeByRunMint(analyzed);
  const globalUniqueMints = new Set(uniqueRows.map((row) => row.mint));
  const crossed120 = uniqueRows.filter((row) => row.window120s.crossed90AfterSkip);
  const crossed300 = uniqueRows.filter((row) => row.window300s.crossed90AfterSkip);
  const topWakeups = [...uniqueRows]
    .sort((a, b) => {
      const curveDelta = Number(b.window120s.curveDelta ?? -Infinity) - Number(a.window120s.curveDelta ?? -Infinity);
      if (curveDelta !== 0) return curveDelta;
      return Number(b.window120s.maxPriceDeltaPct ?? -Infinity) - Number(a.window120s.maxPriceDeltaPct ?? -Infinity);
    })
    .slice(0, 20)
    .map(compact);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    targetReasons: Array.from(TARGET_REASONS).sort(),
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0)
    },
    summary: {
      rawDecisionCount: analyzed.length,
      dedupedRunMintCount: uniqueRows.length,
      uniqueMints: globalUniqueMints.size,
      runCountWithTargetSkips: new Set(uniqueRows.map((row) => row.telemetryPath)).size,
      reasonCountsRaw: countBy(analyzed, (row) => row.reason),
      reasonCountsDeduped: countBy(uniqueRows.flatMap((row) => row.reasons || [row.reason]), (reason) => reason),
      uniqueCross90Within120s: new Set(crossed120.map((row) => row.mint)).size,
      runMintCross90Within120s: crossed120.length,
      uniqueCross90Within300s: new Set(crossed300.map((row) => row.mint)).size,
      runMintCross90Within300s: crossed300.length,
      curveDelta120s: stat(uniqueRows.map((row) => row.window120s.curveDelta), 6),
      maxPriceDeltaPct120s: stat(uniqueRows.map((row) => row.window120s.maxPriceDeltaPct), 2),
      crossed90PriceDeltaPct120s: stat(crossed120.map((row) => row.window120s.maxPriceDeltaPct), 2)
    },
    topWakeups,
    crossed90Within120s: crossed120.map(compact),
    note: 'Report-only watchlist for LOW_SCORE and FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE skips that later approach 90% curve. It dedupes by telemetry run + mint and does not alter runtime gates.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const maxFiles = Number.isFinite(Number(args.maxFiles)) ? Math.max(1, Number(args.maxFiles)) : DEFAULT_MAX_FILES;
  const files = args.telemetry
    ? [repoPath(args.telemetry)].filter(Boolean)
    : telemetryFiles(maxFiles);
  if (!files.length) throw new Error('No telemetry files found for near-90 skip watchlist.');
  const runs = [];
  for (const filePath of files) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    runs.push(await readTelemetry(filePath));
  }
  const report = buildReport(runs);
  writeJson(outputPath, report);
  console.log('Pre-Migration Skip Near-90 Watchlist');
  console.log(`Telemetry files read: ${report.inputs.telemetryFilesRead}`);
  console.log(`Target skip decisions: ${report.summary.rawDecisionCount}`);
  console.log(`Deduped run/mint rows: ${report.summary.dedupedRunMintCount}`);
  console.log(`Unique crossed 90 within 120s: ${report.summary.uniqueCross90Within120s}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
