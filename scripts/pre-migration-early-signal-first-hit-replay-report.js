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
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-early-signal-first-hit-replay-latest.json');
const DEFAULT_LIMIT = 8;
const SIZE_SOL = 0.02;
const FEE_SOL = 0.0005;
const EXIT_PROFILE = {
  name: 'first_hit_300s_tp35_sl15_slip3',
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
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
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

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function walletBefore(events, atMs) {
  const prior = events.filter((event) => event.atMs <= atMs);
  return {
    anyWalletTouch: prior.some((event) => event.anyWalletTouch),
    trustedPre85Buy: prior.some((event) => event.trustedPre85Buy),
    positiveOrProvenPre85Buy: prior.some((event) => event.positiveOrProvenPre85Buy),
    rawUntrustedPre85Buy: prior.some((event) => event.rawUntrustedPre85Buy),
    avoidTouch: prior.some((event) => event.avoidTouch),
    rows: prior.length,
    uniqueWalletCount: new Set(prior.flatMap((event) => (event.sampleWallets || []).map((wallet) => wallet.wallet).filter(Boolean))).size,
    sampleWallets: prior.flatMap((event) => event.sampleWallets || []).slice(0, 5)
  };
}

function comboDefinitions() {
  return [
    {
      name: 'raw_pre85_buy_pre60_velocity25',
      test: (snapshot, wallet) => wallet.rawUntrustedPre85Buy === true
        && Number(snapshot.tradeVelocityPerMin) >= 25
    },
    {
      name: 'raw_pre85_buy_pre60_velocity25_buyers15',
      test: (snapshot, wallet) => wallet.rawUntrustedPre85Buy === true
        && Number(snapshot.tradeVelocityPerMin) >= 25
        && Number(snapshot.uniqueBuyerCount) >= 15
    },
    {
      name: 'raw_pre85_buy_pre60_velocity25_buyers15_no_avoid',
      test: (snapshot, wallet) => wallet.rawUntrustedPre85Buy === true
        && wallet.avoidTouch !== true
        && Number(snapshot.tradeVelocityPerMin) >= 25
        && Number(snapshot.uniqueBuyerCount) >= 15
    },
    {
      name: 'pre60_buyers15_velocity25',
      test: (snapshot) => Number(snapshot.uniqueBuyerCount) >= 15
        && Number(snapshot.tradeVelocityPerMin) >= 25
    },
    {
      name: 'pre60_buyers25_score70',
      test: (snapshot) => Number(snapshot.uniqueBuyerCount) >= 25
        && Number(snapshot.score) >= 70
    },
    {
      name: 'pre60_buyers25',
      test: (snapshot) => Number(snapshot.uniqueBuyerCount) >= 25
    },
    {
      name: 'trusted_pre85_buy_pre60_buyers15_snipers8',
      test: (snapshot, wallet) => wallet.trustedPre85Buy === true
        && Number(snapshot.uniqueBuyerCount) >= 15
        && Number.isFinite(Number(snapshot.sniperWalletCount))
        && Number(snapshot.sniperWalletCount) <= 8
    }
  ];
}

function firstCross(snapshots, threshold) {
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function firstHit(row, combo) {
  const allSnapshots = sortedSnapshots(row);
  const cross60 = firstCross(allSnapshots, 0.6);
  const snapshots = allSnapshots
    .filter((snapshot) => !cross60 || Number(snapshot.atMs) < Number(cross60.atMs))
    .filter((snapshot) => Number(snapshot.curveProgress) < 0.6)
    .filter((snapshot) => Number(snapshot.priceSol) > 0);
  const walletEvents = sortedWalletEvents(row);
  for (const snapshot of snapshots) {
    const wallet = walletBefore(walletEvents, snapshot.atMs);
    if (combo.test(snapshot, wallet)) {
      return { snapshot, wallet };
    }
  }
  return null;
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

function verdictForSummary(summary) {
  if (summary.candidates < 20) return 'INSUFFICIENT_SAMPLE';
  if (summary.replayed < Math.max(10, Math.floor(summary.candidates * 0.5))) return 'INSUFFICIENT_REPLAY_COVERAGE';
  if (Number(summary.medianPnlSol) <= 0) return 'FIRST_HIT_MEDIAN_NEGATIVE';
  if (Number(summary.stressedPnlSol) <= 0) return 'FIRST_HIT_STRESS_NEGATIVE';
  if (Number(summary.pnlWithoutTop3Sol) <= 0) return 'OUTLIER_DEPENDENT';
  return 'FIRST_HIT_PROMISING_REPORT_ONLY';
}

function summarize(rows) {
  const replayed = rows.filter((row) => row.replay.replayClass === 'REPLAYED');
  const pnls = replayed.map((row) => row.replay.pnlSol).filter((value) => Number.isFinite(Number(value)));
  const stressed = replayed.map((row) => row.replay.stressedPnlSol).filter((value) => Number.isFinite(Number(value)));
  const sortedPnlsDesc = pnls.slice().sort((a, b) => b - a);
  const pnlWithoutTop3 = sortedPnlsDesc.slice(3).reduce((sum, value) => sum + value, 0);
  const wins = pnls.filter((value) => Number(value) > 0).length;
  const summary = {
    candidates: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    crossed60: rows.filter((row) => row.outcome.crossed60).length,
    crossed85: rows.filter((row) => row.outcome.crossed85).length,
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
    secondsEntryToCross60: numericStats(rows.map((row) => row.outcome.secondsEntryToCross60), 2),
    exitReasons: topCounts(replayed.reduce((counts, row) => {
      const label = row.replay.exitReason || 'unknown';
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {}), 8),
    replayClasses: topCounts(rows.reduce((counts, row) => {
      const label = row.replay.replayClass || 'unknown';
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {}), 8)
  };
  return { ...summary, verdict: verdictForSummary(summary) };
}

function rowOutcome(snapshots, entrySnapshot) {
  const future = snapshots.filter((snapshot) => Number(snapshot.atMs) >= Number(entrySnapshot.atMs));
  const cross60 = firstCross(future, 0.6);
  const cross85 = firstCross(future, 0.85);
  const cross90 = firstCross(future, 0.9);
  return {
    crossed60: Boolean(cross60),
    crossed85: Boolean(cross85),
    crossed90: Boolean(cross90),
    secondsEntryToCross60: cross60 ? compact((Number(cross60.atMs) - Number(entrySnapshot.atMs)) / 1000, 2) : null,
    secondsEntryToCross85: cross85 ? compact((Number(cross85.atMs) - Number(entrySnapshot.atMs)) / 1000, 2) : null,
    secondsEntryToCross90: cross90 ? compact((Number(cross90.atMs) - Number(entrySnapshot.atMs)) / 1000, 2) : null
  };
}

function buildRowsForRun(filePath, promotionIndex) {
  const scanned = scanFile(filePath, promotionIndex);
  const ledgerAttached = attachWalletLedgerEvents(scanned.rows, scanned.firstMs, scanned.lastMs, promotionIndex);
  const telemetryPath = path.relative(ROOT, filePath);
  const combos = comboDefinitions();
  const rows = [];
  for (const rawRow of scanned.rows) {
    const snapshots = sortedSnapshots(rawRow);
    if (!snapshots.length) continue;
    for (const combo of combos) {
      const hit = firstHit(rawRow, combo);
      if (!hit) continue;
      const { snapshot, wallet } = hit;
      rows.push({
        telemetryPath,
        combo: combo.name,
        mint: rawRow.mint,
        symbol: rawRow.symbol || null,
        firstHitAt: snapshot.at,
        entry: {
          curveProgress: compact(snapshot.curveProgress, 6),
          priceSol: compact(snapshot.priceSol, 15),
          score: compact(snapshot.score, 2),
          recentVolumeSol: compact(snapshot.recentVolumeSol, 4),
          tradeVelocityPerMin: compact(snapshot.tradeVelocityPerMin, 2),
          uniqueBuyerCount: compact(snapshot.uniqueBuyerCount, 0),
          sniperWalletCount: compact(snapshot.sniperWalletCount, 0),
          wallet
        },
        outcome: rowOutcome(snapshots, snapshot),
        replay: replay(snapshot, snapshots)
      });
    }
  }
  return {
    telemetryPath,
    rows,
    run: {
      telemetryPath,
      mints: scanned.rows.length,
      rows: rows.length,
      walletLedgerEventsAttached: ledgerAttached,
      firstEventAt: scanned.firstMs === null ? null : new Date(scanned.firstMs).toISOString(),
      lastEventAt: scanned.lastMs === null ? null : new Date(scanned.lastMs).toISOString(),
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
      const runRows = buildRowsForRun(filePath, promotionIndex);
      runs.push(runRows.run);
      rows.push(...runRows.rows);
    } catch (error) {
      errors.push({ telemetryPath: path.relative(ROOT, filePath), error: error.message });
    }
  }
  const byCombo = comboDefinitions().map((combo) => {
    const comboRows = rows.filter((row) => row.combo === combo.name);
    return {
      combo: combo.name,
      summary: summarize(comboRows),
      topWinners: comboRows
        .filter((row) => row.replay.replayClass === 'REPLAYED')
        .sort((a, b) => Number(b.replay.pnlSol || 0) - Number(a.replay.pnlSol || 0))
        .slice(0, 8),
      topLosers: comboRows
        .filter((row) => row.replay.replayClass === 'REPLAYED')
        .sort((a, b) => Number(a.replay.pnlSol || 0) - Number(b.replay.pnlSol || 0))
        .slice(0, 8)
    };
  }).sort((a, b) => Number(b.summary.replayed || 0) - Number(a.summary.replayed || 0)
    || Number(b.summary.pnlSol || 0) - Number(a.summary.pnlSol || 0));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_curve60_early_signal_first_hit_replay',
    inputs: {
      telemetryFiles: filePaths.map((filePath) => path.relative(ROOT, filePath)),
      rowUnit: 'run_mint_combo_first_hit',
      note: 'First-hit rows enter on the first price-bearing pre-60 snapshot where the combo is true. This report is diagnostic only and does not change runtime gates.'
    },
    exitProfile: EXIT_PROFILE,
    summary: {
      runs: runs.length,
      rows: rows.length,
      combos: byCombo.length,
      bestCombo: byCombo[0]?.combo || null,
      bestComboVerdict: byCombo[0]?.summary?.verdict || null,
      bestComboPnlSol: byCombo[0]?.summary?.pnlSol ?? null,
      promisingCombos: byCombo
        .filter((row) => row.summary.verdict === 'FIRST_HIT_PROMISING_REPORT_ONLY')
        .map((row) => row.combo),
      recommendation: byCombo.some((row) => row.summary.verdict === 'FIRST_HIT_PROMISING_REPORT_ONLY')
        ? 'inspect_first_hit_replay_examples_before_shadow_lane'
        : 'do_not_create_runtime_shadow_lane_from_current_first_hit_sample'
    },
    runs,
    errors,
    byCombo,
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
