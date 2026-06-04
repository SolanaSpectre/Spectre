#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readTelemetry } = require('./runner-reject-follow-through-report');

const ROOT = path.join(__dirname, '..');
const FOLLOW_THROUGH_PATH = path.join(ROOT, 'data', 'reports', 'runner-reject-follow-through-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-reject-entry-replay-latest.json');
const DEFAULT_SIZE_SOL = 0.05;
const DEFAULT_FEE_SOL = 0.0005;
const DEFAULT_ENTRY_SLIPPAGE_PCT = 1.5;
const DEFAULT_EXIT_SLIPPAGE_PCT = 1.5;
const PROFILES = [
  { name: 'fast_120s_tp50_sl25_slip3', holdSeconds: 120, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 1.5, exitSlippagePct: 1.5 },
  { name: 'fast_300s_tp50_sl25_slip3', holdSeconds: 300, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 1.5, exitSlippagePct: 1.5 },
  { name: 'fast_120s_tp50_sl25_slip10', holdSeconds: 120, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 5, exitSlippagePct: 5 },
  { name: 'fast_300s_tp50_sl25_slip10', holdSeconds: 300, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 5, exitSlippagePct: 5 },
  { name: 'runner_300s_tp100_sl30_slip3', holdSeconds: 300, takeProfitPct: 100, stopLossPct: -30, entrySlippagePct: 1.5, exitSlippagePct: 1.5 }
];

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

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
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

function keyOf(row) {
  return `${row.telemetryPath}:${row.mint}:${row.reason}:${row.pumpFailureReason || 'none'}:${row.atMs}`;
}

function summarizeRows(rows) {
  const pnlSol = rows.map((row) => row.pnlSol);
  const sortedWinners = pnlSol.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => b - a);
  const totalPnlSol = pnlSol.reduce((total, value) => total + Number(value || 0), 0);
  const grossWinnerPnlSol = sortedWinners.reduce((total, value) => total + value, 0);
  const topWinnerPnlSol = sortedWinners[0] || 0;
  const top3WinnerPnlSol = sortedWinners.slice(0, 3).reduce((total, value) => total + value, 0);
  const topWinnerShareOfGrossProfit = grossWinnerPnlSol > 0 ? topWinnerPnlSol / grossWinnerPnlSol : null;
  const outlierDominated = Number(topWinnerShareOfGrossProfit) > 0.5;
  return {
    trades: rows.length,
    wins: rows.filter((row) => Number(row.pnlSol) > 0).length,
    losses: rows.filter((row) => Number(row.pnlSol) < 0).length,
    winRate: rows.length ? numberOrNull(rows.filter((row) => Number(row.pnlSol) > 0).length / rows.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    grossWinnerPnlSol: numberOrNull(grossWinnerPnlSol, 9),
    topWinnerPnlSol: numberOrNull(topWinnerPnlSol, 9),
    top3WinnerPnlSol: numberOrNull(top3WinnerPnlSol, 9),
    pnlAfterRemovingTopWinnerSol: numberOrNull(totalPnlSol - topWinnerPnlSol, 9),
    pnlAfterRemovingTop3WinnersSol: numberOrNull(totalPnlSol - top3WinnerPnlSol, 9),
    topWinnerShareOfGrossProfit: topWinnerShareOfGrossProfit === null ? null : numberOrNull(topWinnerShareOfGrossProfit, 4),
    outlierDominated,
    verdictTags: outlierDominated ? ['OUTLIER_DOMINATED'] : [],
    pnlSol: stat(pnlSol, 9),
    returnPct: stat(rows.map((row) => row.returnPct), 4),
    rawReturnPct: stat(rows.map((row) => row.rawReturnPct), 4),
    exitReasons: rows.reduce((counts, row) => {
      counts[row.exitReason] = (counts[row.exitReason] || 0) + 1;
      return counts;
    }, {})
  };
}

function getSlippagePct(profile, key, fallback) {
  const value = Number(profile[key]);
  return Number.isFinite(value) ? value : fallback;
}

function replayCandidate(candidate, snapshots, profile, sizeSol, feeSol) {
  const entryPrice = Number(candidate.priceSol);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const entrySlippagePct = getSlippagePct(profile, 'entrySlippagePct', DEFAULT_ENTRY_SLIPPAGE_PCT);
  const exitSlippagePct = getSlippagePct(profile, 'exitSlippagePct', DEFAULT_EXIT_SLIPPAGE_PCT);
  const effectiveEntryPrice = entryPrice * (1 + entrySlippagePct / 100);
  const future = snapshots
    .filter((row) => row.atMs > candidate.atMs && row.atMs <= candidate.atMs + profile.holdSeconds * 1000)
    .filter((row) => Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!future.length) return null;

  let exit = future[future.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const row of future) {
    const effectiveExitPrice = Number(row.priceSol) * (1 - exitSlippagePct / 100);
    const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
    if (returnPct <= profile.stopLossPct) {
      exit = row;
      exitReason = 'STOP_LOSS';
      break;
    }
    if (returnPct >= profile.takeProfitPct) {
      exit = row;
      exitReason = 'TAKE_PROFIT';
      break;
    }
  }

  const exitPrice = Number(exit.priceSol);
  const effectiveExitPrice = exitPrice * (1 - exitSlippagePct / 100);
  const rawReturnPct = ((exitPrice / entryPrice) - 1) * 100;
  const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
  const grossPnlSol = sizeSol * (returnPct / 100);
  return {
    profile: profile.name,
    telemetryPath: candidate.telemetryPath,
    mint: candidate.mint,
    symbol: candidate.symbol || null,
    reason: candidate.reason,
    pumpFailureReason: candidate.pumpFailureReason || null,
    entryAt: candidate.at,
    exitAt: exit.at,
    holdSeconds: numberOrNull((exit.atMs - candidate.atMs) / 1000, 3),
    entryCurve: candidate.curveProgress,
    exitCurve: exit.curveProgress,
    entryPriceSol: numberOrNull(entryPrice, 12),
    exitPriceSol: numberOrNull(exitPrice, 12),
    effectiveEntryPriceSol: numberOrNull(effectiveEntryPrice, 12),
    effectiveExitPriceSol: numberOrNull(effectiveExitPrice, 12),
    entrySlippagePct: numberOrNull(entrySlippagePct, 4),
    exitSlippagePct: numberOrNull(exitSlippagePct, 4),
    rawReturnPct: numberOrNull(rawReturnPct, 4),
    returnPct: numberOrNull(returnPct, 4),
    pnlSol: numberOrNull(grossPnlSol - feeSol, 9),
    exitReason
  };
}

async function buildReport(options = {}) {
  const followThroughPath = repoPath(options.followThrough) || FOLLOW_THROUGH_PATH;
  if (!fs.existsSync(followThroughPath)) throw new Error(`Missing follow-through report: ${followThroughPath}`);
  const followThrough = JSON.parse(fs.readFileSync(followThroughPath, 'utf8'));
  const candidates = (followThrough.topPre90Wakeups || [])
    .filter((row) => Number(row.curveProgress) < 0.9 && Number(row.priceSol) > 0);
  const telemetryPaths = Array.from(new Set(candidates.map((row) => row.telemetryPath))).map(repoPath);
  const runs = [];
  for (const telemetryPath of telemetryPaths) runs.push(await readTelemetry(telemetryPath));
  const runByPath = new Map(runs.map((run) => [run.telemetryPath, run]));
  const sizeSol = Number(options.sizeSol || DEFAULT_SIZE_SOL);
  const feeSol = Number(options.feeSol || DEFAULT_FEE_SOL);

  const rows = [];
  for (const candidate of candidates) {
    const run = runByPath.get(candidate.telemetryPath);
    const snapshots = run?.snapshotsByMint?.get(candidate.mint) || [];
    for (const profile of PROFILES) {
      const row = replayCandidate(candidate, snapshots, profile, sizeSol, feeSol);
      if (row) rows.push(row);
    }
  }

  const rowsByProfile = PROFILES.reduce((groups, profile) => {
    groups[profile.name] = rows.filter((row) => row.profile === profile.name);
    return groups;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    assumptions: {
      sizeSol,
      feeSol,
      defaultEntrySlippagePct: DEFAULT_ENTRY_SLIPPAGE_PCT,
      defaultExitSlippagePct: DEFAULT_EXIT_SLIPPAGE_PCT,
      entry: 'Use reject-time prior PumpDev price for pre-90 rejected runner candidates.',
      caveat: 'Replay uses later telemetry snapshots with configured slippage stress. It still does not model quote fill, MEV, pool liquidity, or broadcast latency.'
    },
    profiles: PROFILES,
    inputs: {
      followThroughPath: path.relative(ROOT, followThroughPath),
      candidates: candidates.length,
      candidateKeys: candidates.map(keyOf),
      telemetryPaths: telemetryPaths.map((item) => path.relative(ROOT, item))
    },
    summaryByProfile: Object.fromEntries(
      Object.entries(rowsByProfile).map(([profile, profileRows]) => [profile, summarizeRows(profileRows)])
    ),
    rows: rows
      .slice()
      .sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  for (const [profile, summary] of Object.entries(report.summaryByProfile)) {
    console.log(`${profile}: trades=${summary.trades} wins=${summary.wins} pnl=${summary.totalPnlSol}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  parseArgs,
  replayCandidate
};
