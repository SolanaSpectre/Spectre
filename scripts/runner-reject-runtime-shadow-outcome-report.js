#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  LEDGER_PATH,
  appendSamples,
  summarizeLedger
} = require('./lib/runner-reject-shadow-sample-ledger');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-reject-runtime-shadow-outcome-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];
const ERA = 'runner_reject_shadow_v1_2026-07-10';
const FROZEN_PROFILE = {
  name: 'fast_300s_tp50_sl25_slip3',
  amountSol: 0.05,
  feeSol: 0.0005,
  holdSeconds: 300,
  takeProfitPct: 50,
  stopLossPct: -25,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5
};

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

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  const files = fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.filePath || null;
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

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: event.type || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceSol, 12)
  };
}

function shadowFromEvent(event, telemetryPath) {
  if (event.type !== 'runner_reject_runtime_shadow.would_enter') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    telemetryPath,
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    era: payload.era || ERA,
    frozenProfile: payload.frozenProfile || FROZEN_PROFILE.name,
    frozenHypothesis: payload.frozenHypothesis || null,
    source: payload.source || null,
    rejectReason: payload.rejectReason || null,
    pumpFailureReason: payload.pumpFailureReason || null,
    routeType: payload.routeType || null,
    bondingStage: payload.bondingStage || null,
    curveProgress: numberOrNull(payload.curveProgress, 6),
    priceSol: numberOrNull(payload.priceSol, 12),
    momentumScore: numberOrNull(payload.momentumScore, 4),
    qualityScore: numberOrNull(payload.qualityScore, 4),
    rankScore: numberOrNull(payload.rankScore, 4),
    nonMigratedCounterfactualPassed: payload.nonMigratedCounterfactualPassed ?? null,
    nonMigratedCounterfactualReason: payload.nonMigratedCounterfactualReason || null
  };
}

async function readTelemetry(filePath) {
  const telemetryPath = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const snapshotsByMint = new Map();
  const shadows = [];
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
    const shadow = shadowFromEvent(event, telemetryPath);
    if (shadow) shadows.push(shadow);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  shadows.sort((a, b) => a.atMs - b.atMs);
  return { telemetryPath, snapshotsByMint, shadows, malformedLines };
}

function futureWindowSummary(entry, snapshotsByMint) {
  const future = (snapshotsByMint.get(entry.mint) || [])
    .filter((row) => row.atMs > entry.atMs)
    .sort((a, b) => a.atMs - b.atMs);
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    const rows = future.filter((row) => row.atMs <= entry.atMs + seconds * 1000);
    const prices = rows.map((row) => row.priceSol);
    const maxPrice = stat(prices, 12).max;
    windows[`${seconds}s`] = {
      outcomeJoined: rows.length > 0,
      snapshots: rows.length,
      maxCurveProgress: stat(rows.map((row) => row.curveProgress), 6).max,
      crossed85: rows.some((row) => Number(row.curveProgress) >= 0.85),
      crossed90: rows.some((row) => Number(row.curveProgress) >= 0.90),
      maxPriceDeltaPct: Number(entry.priceSol) > 0 && Number.isFinite(maxPrice)
        ? numberOrNull(((maxPrice / Number(entry.priceSol)) - 1) * 100, 2)
        : null
    };
  }
  return windows;
}

function replayEntry(entry, snapshotsByMint) {
  const entryPrice = Number(entry.priceSol);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return { outcomeJoined: false, exitReason: 'PRICE_UNAVAILABLE' };
  }
  const future = (snapshotsByMint.get(entry.mint) || [])
    .filter((row) => row.atMs > entry.atMs && row.atMs <= entry.atMs + FROZEN_PROFILE.holdSeconds * 1000)
    .filter((row) => Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!future.length) return { outcomeJoined: false, exitReason: 'NO_FUTURE_SNAPSHOTS' };

  const effectiveEntryPrice = entryPrice * (1 + FROZEN_PROFILE.entrySlippagePct / 100);
  let exit = future[future.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const row of future) {
    const effectiveExitPrice = Number(row.priceSol) * (1 - FROZEN_PROFILE.exitSlippagePct / 100);
    const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
    if (returnPct <= FROZEN_PROFILE.stopLossPct) {
      exit = row;
      exitReason = 'STOP_LOSS';
      break;
    }
    if (returnPct >= FROZEN_PROFILE.takeProfitPct) {
      exit = row;
      exitReason = 'TAKE_PROFIT';
      break;
    }
  }

  const exitPrice = Number(exit.priceSol);
  const effectiveExitPrice = exitPrice * (1 - FROZEN_PROFILE.exitSlippagePct / 100);
  const rawReturnPct = ((exitPrice / entryPrice) - 1) * 100;
  const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
  const pnlSol = (FROZEN_PROFILE.amountSol * (returnPct / 100)) - FROZEN_PROFILE.feeSol;
  return {
    outcomeJoined: true,
    exitReason,
    exitAt: exit.at,
    holdSeconds: numberOrNull((exit.atMs - entry.atMs) / 1000, 3),
    entryPriceSol: numberOrNull(entryPrice, 12),
    exitPriceSol: numberOrNull(exitPrice, 12),
    entryCurveProgress: entry.curveProgress,
    exitCurveProgress: exit.curveProgress,
    rawReturnPct: numberOrNull(rawReturnPct, 4),
    returnPct: numberOrNull(returnPct, 4),
    pnlSol: numberOrNull(pnlSol, 9)
  };
}

function summarizeRows(rows) {
  const joined = rows.filter((row) => row.replay?.outcomeJoined === true);
  const wins = joined.filter((row) => Number(row.replay.pnlSol) > 0).length;
  const losses = joined.filter((row) => Number(row.replay.pnlSol) < 0).length;
  const totalPnlSol = joined.reduce((sum, row) => sum + Number(row.replay.pnlSol || 0), 0);
  return {
    attempts: rows.length,
    wouldEnter: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    outcomeJoinedProfileHold: joined.length,
    outcomeMissingProfileHold: rows.length - joined.length,
    wins,
    losses,
    winRate: joined.length ? numberOrNull(wins / joined.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    averagePnlSol: joined.length ? numberOrNull(totalPnlSol / joined.length, 9) : null,
    pnlSol: stat(joined.map((row) => row.replay.pnlSol), 9),
    returnPct: stat(joined.map((row) => row.replay.returnPct), 4),
    exitReasonCounts: countBy(rows, (row) => row.replay?.exitReason),
    pumpFailureReasonCounts: countBy(rows, (row) => row.pumpFailureReason)
  };
}

function buildReport(runs) {
  const rows = [];
  for (const run of runs) {
    for (const shadow of run.shadows) {
      if (shadow.era !== ERA || shadow.frozenProfile !== FROZEN_PROFILE.name) continue;
      const windows = futureWindowSummary(shadow, run.snapshotsByMint);
      const replay = replayEntry(shadow, run.snapshotsByMint);
      rows.push({
        ...shadow,
        windows,
        replay
      });
    }
  }

  const ledgerWrite = appendSamples(rows.map((row) => ({
    era: row.era,
    frozenProfile: row.frozenProfile,
    frozenHypothesis: row.frozenHypothesis,
    telemetryPath: row.telemetryPath,
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    atMs: row.atMs,
    source: row.source,
    rejectReason: row.rejectReason,
    pumpFailureReason: row.pumpFailureReason,
    routeType: row.routeType,
    bondingStage: row.bondingStage,
    curveProgress: row.curveProgress,
    priceSol: row.priceSol,
    momentumScore: row.momentumScore,
    qualityScore: row.qualityScore,
    rankScore: row.rankScore,
    nonMigratedCounterfactualPassed: row.nonMigratedCounterfactualPassed,
    nonMigratedCounterfactualReason: row.nonMigratedCounterfactualReason,
    windows: row.windows,
    replay: row.replay
  })));
  const ledgerSummary = summarizeLedger({ era: ERA, frozenProfile: FROZEN_PROFILE.name });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_runner_reject_runtime_shadow_outcome',
    note: 'Joins runtime runner-reject shadow would-enter rows to later snapshots. It does not alter gates, paper entries, live entries, quotes, or exits.',
    frozenProfile: FROZEN_PROFILE,
    frozenHypothesis: {
      era: ERA,
      name: 'pre90_low_pump_momentum_runner_scalper_requires_migration',
      source: 'runner-reject-entry-replay-latest.json',
      preregistered: true
    },
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0)
    },
    summary: summarizeRows(rows),
    sampleLedger: {
      ...ledgerWrite,
      ledgerPath: path.relative(ROOT, ledgerWrite.ledgerPath).replace(/\\/g, '/'),
      cumulative: {
        ...ledgerSummary,
        ledgerPath: path.relative(ROOT, LEDGER_PATH).replace(/\\/g, '/')
      }
    },
    rows: rows.slice().sort((a, b) => Number(b.replay?.pnlSol || 0) - Number(a.replay?.pnlSol || 0))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((item) => repoPath(item.trim())).filter((item) => item && fs.existsSync(item))
    : [latestTelemetryFile()].filter(Boolean);
  if (!files.length) throw new Error('No telemetry files found');

  const runs = [];
  for (const filePath of files) runs.push(await readTelemetry(filePath));
  const report = buildReport(runs);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`Runtime runner-reject shadow samples: ${report.summary.wouldEnter}, joined profile hold: ${report.summary.outcomeJoinedProfileHold}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  readTelemetry,
  FROZEN_PROFILE,
  ERA
};
