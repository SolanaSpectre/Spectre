#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  scanFile,
  makePromotionIndex,
  attachWalletLedgerEvents
} = require('./pre-migration-pre-curve60-runner-discovery-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-early-signal-entry-timing-replay-latest.json');
const DEFAULT_LIMIT = 8;
const SIZE_SOL = 0.02;
const FEE_SOL = 0.0005;
const EXIT_PROFILE = {
  name: 'raw_signal_timing_300s_tp35_sl15_slip3',
  holdSeconds: 300,
  takeProfitPct: 35,
  stopLossPct: -15,
  entrySlippagePct: 3,
  exitSlippagePct: 3,
  stressExtraSlippagePct: 3
};

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

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function pct(part, total) {
  return total > 0 ? compact(part / total, 6) : null;
}

function topCounts(counts = {}, limit = 12) {
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
}

function numericStats(values, digits = 6) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null, sum: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: compact(sorted[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(sorted[sorted.length - 1], digits),
    avg: compact(sum / sorted.length, digits),
    sum: compact(sum, digits)
  };
}

function hasNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

function sortedSnapshots(row) {
  return (row.snapshots || [])
    .filter((snapshot) => Number.isFinite(Number(snapshot.atMs)))
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
}

function sortedWalletEvents(row) {
  return (row.walletEvents || [])
    .filter((event) => Number.isFinite(Number(event.atMs)))
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
}

function firstCross(snapshots, threshold) {
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function priceBearingPre60(row) {
  const snapshots = sortedSnapshots(row).filter((snapshot) => hasNumber(snapshot.curveProgress));
  const cross60 = firstCross(snapshots, 0.6);
  return sortedSnapshots(row)
    .filter((snapshot) => !cross60 || Number(snapshot.atMs) < Number(cross60.atMs))
    .filter((snapshot) => Number(snapshot.curveProgress) < 0.6)
    .filter((snapshot) => Number(snapshot.priceSol) > 0);
}

function walletStateBefore(events, atMs) {
  const prior = events.filter((event) => Number(event.atMs) <= Number(atMs));
  return {
    rawUntrustedPre85Buy: prior.some((event) => event.rawUntrustedPre85Buy),
    anyWalletTouch: prior.some((event) => event.anyWalletTouch),
    avoidTouch: prior.some((event) => event.avoidTouch),
    rows: prior.length,
    firstRawPre85BuyAtMs: prior.find((event) => event.rawUntrustedPre85Buy)?.atMs || null
  };
}

function rawSignalEvent(events) {
  return events.find((event) => event.rawUntrustedPre85Buy && event.avoidTouch !== true) || null;
}

function timingModes() {
  return [
    {
      name: 'raw_first_hit',
      pick: (snapshots, rawAtMs, events) => snapshots.find((snapshot) => Number(snapshot.atMs) >= rawAtMs
        && walletStateBefore(events, snapshot.atMs).rawUntrustedPre85Buy)
    },
    {
      name: 'raw_delay_5s',
      pick: (snapshots, rawAtMs, events) => snapshots.find((snapshot) => Number(snapshot.atMs) >= rawAtMs + 5000
        && walletStateBefore(events, snapshot.atMs).rawUntrustedPre85Buy)
    },
    {
      name: 'raw_delay_10s',
      pick: (snapshots, rawAtMs, events) => snapshots.find((snapshot) => Number(snapshot.atMs) >= rawAtMs + 10000
        && walletStateBefore(events, snapshot.atMs).rawUntrustedPre85Buy)
    },
    {
      name: 'raw_delay_20s',
      pick: (snapshots, rawAtMs, events) => snapshots.find((snapshot) => Number(snapshot.atMs) >= rawAtMs + 20000
        && walletStateBefore(events, snapshot.atMs).rawUntrustedPre85Buy)
    },
    {
      name: 'raw_curve_advancing',
      pick: (snapshots, rawAtMs, events) => snapshots.find((snapshot) => Number(snapshot.atMs) >= rawAtMs
        && walletStateBefore(events, snapshot.atMs).rawUntrustedPre85Buy
        && (Number(snapshot.curveProgressDelta) > 0 || Number(snapshot.curveProgressDelta60s) > 0))
    },
    {
      name: 'raw_last_pre60',
      pick: (snapshots, rawAtMs, events) => {
        const eligible = snapshots.filter((snapshot) => Number(snapshot.atMs) >= rawAtMs
          && walletStateBefore(events, snapshot.atMs).rawUntrustedPre85Buy);
        return eligible[eligible.length - 1] || null;
      }
    }
  ];
}

function replay(entrySnapshot, snapshots) {
  const entryMs = Number(entrySnapshot.atMs);
  const entryPriceRaw = Number(entrySnapshot.priceSol);
  if (!Number.isFinite(entryMs) || !Number.isFinite(entryPriceRaw) || entryPriceRaw <= 0) return { replayClass: 'NO_ENTRY_PRICE' };
  const pathRows = snapshots
    .filter((snapshot) => Number(snapshot.atMs) > entryMs && Number(snapshot.atMs) <= entryMs + EXIT_PROFILE.holdSeconds * 1000)
    .filter((snapshot) => Number(snapshot.priceSol) > 0)
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
  if (!pathRows.length) return { replayClass: 'NO_FUTURE_PRICE' };
  const entryPrice = entryPriceRaw * (1 + EXIT_PROFILE.entrySlippagePct / 100);
  const takeProfit = entryPrice * (1 + EXIT_PROFILE.takeProfitPct / 100);
  const stopLoss = entryPrice * (1 + EXIT_PROFILE.stopLossPct / 100);
  let exit = pathRows[pathRows.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const snapshot of pathRows) {
    const price = Number(snapshot.priceSol);
    if (price >= takeProfit) {
      exit = snapshot;
      exitReason = 'TAKE_PROFIT';
      break;
    }
    if (price <= stopLoss) {
      exit = snapshot;
      exitReason = 'STOP_LOSS';
      break;
    }
  }
  const exitPrice = Number(exit.priceSol) * (1 - EXIT_PROFILE.exitSlippagePct / 100);
  const grossReturn = exitPrice / entryPrice - 1;
  const stressedReturn = grossReturn - EXIT_PROFILE.stressExtraSlippagePct / 100;
  const maxPrice = Math.max(...pathRows.map((snapshot) => Number(snapshot.priceSol)));
  return {
    replayClass: 'REPLAYED',
    exitReason,
    holdSeconds: compact((Number(exit.atMs) - entryMs) / 1000, 1),
    grossReturnPct: compact(grossReturn * 100, 4),
    pnlSol: compact(SIZE_SOL * grossReturn - FEE_SOL, 9),
    stressedPnlSol: compact(SIZE_SOL * stressedReturn - FEE_SOL, 9),
    maxPriceDeltaPct: compact(((maxPrice - entryPrice) / entryPrice) * 100, 2)
  };
}

function outcome(snapshots, entrySnapshot) {
  const future = snapshots.filter((snapshot) => Number(snapshot.atMs) >= Number(entrySnapshot.atMs));
  const cross60 = firstCross(future, 0.6);
  const cross85 = firstCross(future, 0.85);
  const cross90 = firstCross(future, 0.9);
  return {
    crossed60: Boolean(cross60),
    crossed85: Boolean(cross85),
    crossed90: Boolean(cross90),
    secondsEntryToCross60: cross60 ? compact((Number(cross60.atMs) - Number(entrySnapshot.atMs)) / 1000, 2) : null,
    secondsEntryToCross90: cross90 ? compact((Number(cross90.atMs) - Number(entrySnapshot.atMs)) / 1000, 2) : null
  };
}

function verdictForSummary(summary) {
  if (summary.candidates < 20) return 'INSUFFICIENT_SAMPLE';
  if (summary.replayed < Math.max(10, Math.floor(summary.candidates * 0.5))) return 'INSUFFICIENT_REPLAY_COVERAGE';
  if (Number(summary.medianPnlSol) <= 0) return 'MEDIAN_NEGATIVE';
  if (Number(summary.stressedPnlSol) <= 0) return 'STRESS_NEGATIVE';
  if (Number(summary.pnlWithoutTop3Sol) <= 0) return 'OUTLIER_DEPENDENT';
  return 'PROMISING_REPORT_ONLY';
}

function summarize(rows) {
  const replayed = rows.filter((row) => row.replay.replayClass === 'REPLAYED');
  const pnls = replayed.map((row) => row.replay.pnlSol).filter((value) => hasNumber(value));
  const stressed = replayed.map((row) => row.replay.stressedPnlSol).filter((value) => hasNumber(value));
  const wins = pnls.filter((value) => Number(value) > 0).length;
  const sortedPnlsDesc = pnls.slice().sort((a, b) => b - a);
  const pnlWithoutTop3 = sortedPnlsDesc.slice(3).reduce((sum, value) => sum + Number(value), 0);
  const summary = {
    candidates: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    crossed60: rows.filter((row) => row.outcome.crossed60).length,
    crossed90: rows.filter((row) => row.outcome.crossed90).length,
    cross90Rate: pct(rows.filter((row) => row.outcome.crossed90).length, rows.length),
    replayed: replayed.length,
    wins,
    losses: replayed.length - wins,
    winRate: pct(wins, replayed.length),
    pnlSol: compact(pnls.reduce((sum, value) => sum + Number(value), 0), 9),
    stressedPnlSol: compact(stressed.reduce((sum, value) => sum + Number(value), 0), 9),
    pnlWithoutTop3Sol: compact(pnlWithoutTop3, 9),
    medianPnlSol: numericStats(pnls, 9).median,
    entryCurveProgress: numericStats(rows.map((row) => row.entry.curveProgress), 6),
    secondsRawToEntry: numericStats(rows.map((row) => row.entry.secondsRawToEntry), 2),
    exitReasons: topCounts(replayed.reduce((counts, row) => {
      const label = row.replay.exitReason || 'unknown';
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {}), 8)
  };
  return { ...summary, verdict: verdictForSummary(summary) };
}

function buildRowsForRun(filePath, promotionIndex) {
  const scanned = scanFile(filePath, promotionIndex);
  const ledgerAttached = attachWalletLedgerEvents(scanned.rows, scanned.firstMs, scanned.lastMs, promotionIndex);
  const telemetryPath = path.relative(ROOT, filePath);
  const rows = [];
  for (const rawRow of scanned.rows) {
    const snapshots = sortedSnapshots(rawRow);
    const pre60 = priceBearingPre60(rawRow);
    if (!pre60.length) continue;
    const events = sortedWalletEvents(rawRow);
    const raw = rawSignalEvent(events);
    if (!raw) continue;
    for (const mode of timingModes()) {
      const entry = mode.pick(pre60, Number(raw.atMs), events);
      if (!entry) continue;
      const wallet = walletStateBefore(events, entry.atMs);
      rows.push({
        telemetryPath,
        mode: mode.name,
        mint: rawRow.mint,
        symbol: rawRow.symbol || null,
        rawSignalAt: raw.at,
        entryAt: entry.at,
        entry: {
          curveProgress: compact(entry.curveProgress, 6),
          priceSol: compact(entry.priceSol, 15),
          score: compact(entry.score, 2),
          recentVolumeSol: compact(entry.recentVolumeSol, 4),
          tradeVelocityPerMin: compact(entry.tradeVelocityPerMin, 2),
          uniqueBuyerCount: compact(entry.uniqueBuyerCount, 0),
          secondsRawToEntry: compact((Number(entry.atMs) - Number(raw.atMs)) / 1000, 2),
          wallet
        },
        outcome: outcome(snapshots, entry),
        replay: replay(entry, snapshots)
      });
    }
  }
  return {
    rows,
    run: {
      telemetryPath,
      walletLedgerEventsAttached: ledgerAttached,
      firstEventAt: scanned.firstMs === null ? null : new Date(scanned.firstMs).toISOString(),
      lastEventAt: scanned.lastMs === null ? null : new Date(scanned.lastMs).toISOString(),
      mints: scanned.rows.length,
      rows: rows.length,
      jsonlRowsScanned: scanned.stats.rows,
      malformedLines: scanned.stats.malformedLines
    }
  };
}

function buildReport(filePaths) {
  const promotionIndex = makePromotionIndex();
  const runs = [];
  const rows = [];
  const errors = [];
  for (const filePath of filePaths) {
    try {
      const run = buildRowsForRun(filePath, promotionIndex);
      runs.push(run.run);
      rows.push(...run.rows);
    } catch (error) {
      errors.push({ telemetryPath: path.relative(ROOT, filePath), error: error.message });
    }
  }
  const byMode = timingModes().map((mode) => {
    const modeRows = rows.filter((row) => row.mode === mode.name);
    return {
      mode: mode.name,
      summary: summarize(modeRows),
      topWinners: modeRows
        .filter((row) => row.replay.replayClass === 'REPLAYED')
        .sort((a, b) => Number(b.replay.pnlSol || 0) - Number(a.replay.pnlSol || 0))
        .slice(0, 8),
      topLosers: modeRows
        .filter((row) => row.replay.replayClass === 'REPLAYED')
        .sort((a, b) => Number(a.replay.pnlSol || 0) - Number(b.replay.pnlSol || 0))
        .slice(0, 8)
    };
  }).sort((a, b) => Number(b.summary.replayed || 0) - Number(a.summary.replayed || 0)
    || Number(b.summary.pnlSol || 0) - Number(a.summary.pnlSol || 0));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_curve60_early_signal_entry_timing_replay',
    inputs: {
      telemetryFiles: filePaths.map((filePath) => path.relative(ROOT, filePath)),
      rowUnit: 'run_mint_raw_signal_timing',
      note: 'Tests raw-untrusted pre85 wallet signal timing variants only. Does not alter runtime gates or paper behavior.'
    },
    exitProfile: EXIT_PROFILE,
    summary: {
      runs: runs.length,
      rows: rows.length,
      modes: byMode.length,
      bestMode: byMode[0]?.mode || null,
      bestModeVerdict: byMode[0]?.summary?.verdict || null,
      bestModePnlSol: byMode[0]?.summary?.pnlSol ?? null,
      promisingModes: byMode.filter((row) => row.summary.verdict === 'PROMISING_REPORT_ONLY').map((row) => row.mode),
      recommendation: byMode.some((row) => row.summary.verdict === 'PROMISING_REPORT_ONLY')
        ? 'inspect_entry_timing_examples_before_runtime_shadow'
        : 'do_not_promote_raw_wallet_timing_signal'
    },
    runs,
    errors,
    byMode,
    rows: rows.slice(0, 2000)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicit = args.telemetry || args.file;
  const filePaths = explicit
    ? String(explicit).split(',').map((item) => repoPath(item.trim())).filter(Boolean)
    : telemetryFiles(Number(args.limit || DEFAULT_LIMIT));
  if (!filePaths.length) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run paper sessions first.');
    process.exit(1);
  }
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const report = buildReport(filePaths);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = { buildReport };
