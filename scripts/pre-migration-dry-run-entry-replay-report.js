#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  latestTelemetryFile,
  numberOrNull,
  parseArgs,
  readTelemetry,
  repoPath,
  stat,
  telemetryFromBattlefield
} = require('./pre-migration-dry-run-outcome-report');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-dry-run-entry-replay-latest.json');
const DEFAULT_SIZE_SOL = 0.05;
const DEFAULT_FEE_SOL = 0.0005;
const PROFILES = [
  { name: 'scalp_60s_tp25_sl15_slip3', holdSeconds: 60, takeProfitPct: 25, stopLossPct: -15, entrySlippagePct: 1.5, exitSlippagePct: 1.5 },
  { name: 'fast_120s_tp35_sl18_slip3', holdSeconds: 120, takeProfitPct: 35, stopLossPct: -18, entrySlippagePct: 1.5, exitSlippagePct: 1.5 },
  { name: 'fast_120s_tp50_sl25_slip3', holdSeconds: 120, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 1.5, exitSlippagePct: 1.5 },
  { name: 'runner_300s_tp50_sl25_slip3', holdSeconds: 300, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 1.5, exitSlippagePct: 1.5 },
  { name: 'stress_120s_tp35_sl18_slip10', holdSeconds: 120, takeProfitPct: 35, stopLossPct: -18, entrySlippagePct: 5, exitSlippagePct: 5 }
];

function summarizeRows(rows) {
  const pnlSol = rows.map((row) => row.pnlSol);
  const totalPnlSol = pnlSol.reduce((total, value) => total + Number(value || 0), 0);
  const winners = rows.filter((row) => Number(row.pnlSol) > 0);
  const grossWinnerPnlSol = winners.reduce((total, row) => total + Number(row.pnlSol || 0), 0);
  const sortedWinnerPnl = winners.map((row) => Number(row.pnlSol || 0)).sort((a, b) => b - a);
  const topWinnerPnlSol = sortedWinnerPnl[0] || 0;
  const top3WinnerPnlSol = sortedWinnerPnl.slice(0, 3).reduce((total, value) => total + value, 0);
  const topWinnerShareOfGrossProfit = grossWinnerPnlSol > 0 ? topWinnerPnlSol / grossWinnerPnlSol : null;
  const outlierDominated = Number(topWinnerShareOfGrossProfit) > 0.5;
  return {
    trades: rows.length,
    wins: winners.length,
    losses: rows.filter((row) => Number(row.pnlSol) < 0).length,
    winRate: rows.length ? numberOrNull(winners.length / rows.length, 4) : null,
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
    }, {}),
    sourceReasons: rows.reduce((counts, row) => {
      const key = row.sourceReason || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {})
  };
}

function firstWouldSendByMint(attempts) {
  const first = new Map();
  for (const attempt of attempts) {
    if (!attempt.wouldSend || !Number.isFinite(Number(attempt.priceSol)) || Number(attempt.priceSol) <= 0) continue;
    if (!first.has(attempt.mint)) first.set(attempt.mint, attempt);
  }
  return Array.from(first.values());
}

function replayCandidate(candidate, snapshots, profile, sizeSol, feeSol) {
  const entryPrice = Number(candidate.priceSol);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const future = snapshots
    .filter((row) => row.atMs > candidate.atMs && row.atMs <= candidate.atMs + profile.holdSeconds * 1000)
    .filter((row) => Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!future.length) return null;

  const effectiveEntryPrice = entryPrice * (1 + profile.entrySlippagePct / 100);
  let exit = future[future.length - 1];
  let exitReason = 'MAX_HOLD';

  for (const row of future) {
    const effectiveExitPrice = Number(row.priceSol) * (1 - profile.exitSlippagePct / 100);
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
  const effectiveExitPrice = exitPrice * (1 - profile.exitSlippagePct / 100);
  const rawReturnPct = ((exitPrice / entryPrice) - 1) * 100;
  const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
  return {
    profile: profile.name,
    mint: candidate.mint,
    symbol: candidate.symbol || null,
    sourceDecision: candidate.sourceDecision || null,
    sourceReason: candidate.sourceReason || null,
    preset: candidate.preset || null,
    lane: candidate.lane || null,
    entryAt: candidate.at,
    exitAt: exit.at,
    holdSeconds: numberOrNull((exit.atMs - candidate.atMs) / 1000, 3),
    entryCurve: candidate.accountCurveProgress ?? candidate.paperCurveProgress ?? null,
    exitCurve: exit.curveProgress,
    entryPriceSol: numberOrNull(entryPrice, 12),
    exitPriceSol: numberOrNull(exitPrice, 12),
    rawReturnPct: numberOrNull(rawReturnPct, 4),
    returnPct: numberOrNull(returnPct, 4),
    pnlSol: numberOrNull((sizeSol * (returnPct / 100)) - feeSol, 9),
    exitReason,
    priceImpactPct: candidate.priceImpactPct ?? null,
    accountAgeMs: candidate.accountAgeMs ?? null,
    simulationOk: candidate.simulationOk === true
  };
}

function replaySet(candidates, snapshotsByMint, sizeSol, feeSol) {
  const rows = [];
  for (const candidate of candidates) {
    const snapshots = snapshotsByMint.get(candidate.mint) || [];
    for (const profile of PROFILES) {
      const row = replayCandidate(candidate, snapshots, profile, sizeSol, feeSol);
      if (row) rows.push(row);
    }
  }
  const byProfile = {};
  for (const profile of PROFILES) {
    byProfile[profile.name] = summarizeRows(rows.filter((row) => row.profile === profile.name));
  }
  return {
    candidates: candidates.length,
    rows,
    summaryByProfile: byProfile
  };
}

async function buildReport(options = {}) {
  const telemetryPath = repoPath(options.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  }

  const telemetry = await readTelemetry(telemetryPath);
  const wouldSend = telemetry.attempts
    .filter((attempt) => attempt.wouldSend && attempt.simulationOk === true)
    .filter((attempt) => Number.isFinite(Number(attempt.priceSol)) && Number(attempt.priceSol) > 0);
  const firstPerMint = firstWouldSendByMint(wouldSend);
  const sizeSol = Number(options.sizeSol || DEFAULT_SIZE_SOL);
  const feeSol = Number(options.feeSol || DEFAULT_FEE_SOL);

  const firstMintReplay = replaySet(firstPerMint, telemetry.snapshotsByMint, sizeSol, feeSol);
  const allAttemptReplay = replaySet(wouldSend, telemetry.snapshotsByMint, sizeSol, feeSol);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    assumptions: {
      sizeSol,
      feeSol,
      entry: 'Use live_dry_run.would_send time and quote spotPriceSol as modeled entry.',
      caveat: 'Report-only replay over simulated Pump buy-ready rows. It does not model real fills, MEV, broadcast latency, duplicate-position suppression, or live exits.'
    },
    profiles: PROFILES,
    sources: {
      telemetryPath: path.relative(ROOT, telemetryPath).replace(/\\/g, '/')
    },
    inputs: {
      startAt: telemetry.startAt,
      endAt: telemetry.endAt,
      dryRunAttempts: telemetry.attempts.length,
      wouldSend: wouldSend.length,
      firstPerMint: firstPerMint.length,
      snapshotMints: telemetry.snapshotsByMint.size,
      malformedLines: telemetry.malformedLines
    },
    firstPerMint: {
      candidates: firstMintReplay.candidates,
      summaryByProfile: firstMintReplay.summaryByProfile
    },
    allAttempts: {
      candidates: allAttemptReplay.candidates,
      summaryByProfile: allAttemptReplay.summaryByProfile
    },
    rows: firstMintReplay.rows
      .slice()
      .sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol)),
    allAttemptRows: allAttemptReplay.rows
      .slice()
      .sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol))
      .slice(0, 200)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  for (const [profile, summary] of Object.entries(report.firstPerMint.summaryByProfile)) {
    console.log(`${profile}: firstPerMint=${summary.trades} wins=${summary.wins} pnl=${summary.totalPnlSol}`);
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
  replayCandidate,
  summarizeRows
};
