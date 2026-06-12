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
const ENTRY_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-candidate-review-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-supported-near-miss-replay-latest.json');
const DEFAULT_SIZE_SOL = 0.05;
const DEFAULT_FEE_SOL = 0.0005;

const PROFILES = [
  {
    name: 'immediate_shadow_tp50_sl25_120s',
    description: 'Enter at the wallet-shadow would-enter timestamp.',
    confirmSeconds: 0,
    minCurveDelta: 0,
    minConfirmCurve: 0,
    holdSeconds: 120,
    takeProfitPct: 50,
    stopLossPct: -25,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5
  },
  {
    name: 'delta03_120_tp50_sl25_120s',
    description: 'Wait for +3 curve points within 120s, then replay exits.',
    confirmSeconds: 120,
    minCurveDelta: 0.03,
    minConfirmCurve: 0,
    holdSeconds: 120,
    takeProfitPct: 50,
    stopLossPct: -25,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5
  },
  {
    name: 'delta05_120_tp50_sl25_120s',
    description: 'Wait for +5 curve points within 120s, then replay exits.',
    confirmSeconds: 120,
    minCurveDelta: 0.05,
    minConfirmCurve: 0,
    holdSeconds: 120,
    takeProfitPct: 50,
    stopLossPct: -25,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5
  },
  {
    name: 'cross70_300_tp50_sl25_180s',
    description: 'Wait for curve >=70% within 300s, then replay exits.',
    confirmSeconds: 300,
    minCurveDelta: 0,
    minConfirmCurve: 0.7,
    holdSeconds: 180,
    takeProfitPct: 50,
    stopLossPct: -25,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5
  },
  {
    name: 'cross75_300_tp50_sl25_180s',
    description: 'Wait for curve >=75% within 300s, then replay exits.',
    confirmSeconds: 300,
    minCurveDelta: 0,
    minConfirmCurve: 0.75,
    holdSeconds: 180,
    takeProfitPct: 50,
    stopLossPct: -25,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5
  }
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function isPositiveTouch(candidate) {
  const touch = candidate.qualifyingFirstTouch || candidate.positiveFirstTouch || null;
  return Boolean(touch && String(touch.side || '').toLowerCase() === 'buy' && touch.positiveOrProven !== false);
}

function isAvoidTouch(candidate) {
  return candidate.qualifyingFirstTouch?.avoidOrNegative === true
    || candidate.walletContext?.avoidOrNegativeTouchCount > 0
    || (candidate.flags || []).includes('AVOID_OR_NEGATIVE_FIRST_TOUCH');
}

function usefulCandidate(candidate) {
  return candidate.kind === 'wallet_shadow_would_enter'
    && isPositiveTouch(candidate)
    && !isAvoidTouch(candidate)
    && Number(candidate.dryRun?.wouldSend || 0) > 0
    && Number.isFinite(Number(candidate.priceSol ?? candidate.entryPriceSol))
    && Number(candidate.priceSol ?? candidate.entryPriceSol) > 0;
}

function findConfirmation(candidate, snapshots, profile) {
  const entryAtMs = Number(candidate.atMs);
  const baseCurve = Number(candidate.curveProgress);
  if (!Number.isFinite(entryAtMs) || !Number.isFinite(baseCurve)) return null;
  if (!profile.confirmSeconds) {
    return {
      atMs: entryAtMs,
      at: candidate.at,
      curveProgress: numberOrNull(baseCurve, 6),
      priceSol: numberOrNull(candidate.entryPriceSol ?? candidate.priceSol, 12),
      waitSeconds: 0,
      curveDelta: 0,
      source: 'candidate'
    };
  }
  const deadline = entryAtMs + profile.confirmSeconds * 1000;
  return snapshots
    .filter((row) => row.atMs > entryAtMs && row.atMs <= deadline)
    .find((row) => {
      const curve = Number(row.curveProgress);
      if (!Number.isFinite(curve)) return false;
      if (profile.minCurveDelta > 0 && curve - baseCurve < profile.minCurveDelta) return false;
      if (profile.minConfirmCurve > 0 && curve < profile.minConfirmCurve) return false;
      return Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0;
    }) || null;
}

function replayExit(candidate, confirmation, snapshots, profile, sizeSol, feeSol) {
  const entryPrice = Number(confirmation.priceSol);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const future = snapshots
    .filter((row) => row.atMs > confirmation.atMs && row.atMs <= confirmation.atMs + profile.holdSeconds * 1000)
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
    sourceReason: candidate.sourceReason || null,
    verdict: candidate.verdict || null,
    score: numberOrNull(candidate.score, 2),
    candidateAt: candidate.at,
    confirmAt: confirmation.at,
    exitAt: exit.at,
    waitSeconds: numberOrNull((confirmation.atMs - Number(candidate.atMs)) / 1000, 3),
    holdSeconds: numberOrNull((exit.atMs - confirmation.atMs) / 1000, 3),
    candidateCurve: numberOrNull(candidate.curveProgress, 6),
    confirmCurve: numberOrNull(confirmation.curveProgress, 6),
    exitCurve: numberOrNull(exit.curveProgress, 6),
    confirmCurveDelta: numberOrNull(Number(confirmation.curveProgress) - Number(candidate.curveProgress), 6),
    entryPriceSol: numberOrNull(entryPrice, 12),
    exitPriceSol: numberOrNull(exitPrice, 12),
    rawReturnPct: numberOrNull(rawReturnPct, 4),
    returnPct: numberOrNull(returnPct, 4),
    pnlSol: numberOrNull((sizeSol * (returnPct / 100)) - feeSol, 9),
    exitReason,
    wallet: candidate.qualifyingFirstTouch?.wallet || null,
    walletName: candidate.qualifyingFirstTouch?.name || null,
    walletReviewTier: candidate.qualifyingFirstTouch?.reviewTier || null,
    walletEvidenceTier: candidate.qualifyingFirstTouch?.evidenceTier || null,
    flags: candidate.flags || []
  };
}

function summarizeRows(rows) {
  const winners = rows.filter((row) => Number(row.pnlSol) > 0);
  const pnl = rows.map((row) => row.pnlSol);
  const totalPnlSol = pnl.reduce((sum, value) => sum + Number(value || 0), 0);
  const sortedWinners = winners.map((row) => Number(row.pnlSol || 0)).sort((a, b) => b - a);
  const top1 = sortedWinners[0] || 0;
  const top3 = sortedWinners.slice(0, 3).reduce((sum, value) => sum + value, 0);
  return {
    trades: rows.length,
    wins: winners.length,
    losses: rows.filter((row) => Number(row.pnlSol) < 0).length,
    winRate: rows.length ? numberOrNull(winners.length / rows.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    medianPnlSol: stat(pnl, 9).median,
    pnlAfterRemovingTopWinnerSol: numberOrNull(totalPnlSol - top1, 9),
    pnlAfterRemovingTop3WinnersSol: numberOrNull(totalPnlSol - top3, 9),
    pnlSol: stat(pnl, 9),
    returnPct: stat(rows.map((row) => row.returnPct), 4),
    exitReasons: countBy(rows, (row) => row.exitReason),
    sourceReasons: countBy(rows, (row) => row.sourceReason),
    wallets: countBy(rows, (row) => row.walletName || row.wallet || 'unknown')
  };
}

function verdictForSummary(summary) {
  if (!summary.trades) return 'NO_CONFIRMED_REPLAYS';
  if (summary.trades < 20) return 'COLLECT_MORE';
  if (Number(summary.totalPnlSol || 0) <= 0) return 'NEGATIVE_TOTAL_PNL';
  if (Number(summary.medianPnlSol || 0) <= 0) return 'NEGATIVE_MEDIAN_PNL';
  if (Number(summary.pnlAfterRemovingTop3WinnersSol || 0) <= 0) return 'WINNER_CONCENTRATED';
  return 'PROMISING_REPORT_ONLY';
}

async function buildReport(options = {}) {
  const telemetryPath = require('./lib/report-telemetry').resolveTelemetryPath(ROOT, {
    telemetry: options.telemetry,
    reportTelemetry: telemetryFromBattlefield()
  }) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  }
  if (!fs.existsSync(ENTRY_REVIEW_PATH)) {
    throw new Error(`Entry candidate review not found: ${ENTRY_REVIEW_PATH}`);
  }

  const sizeSol = Number(options.sizeSol || DEFAULT_SIZE_SOL);
  const feeSol = Number(options.feeSol || DEFAULT_FEE_SOL);
  const entryReview = readJson(ENTRY_REVIEW_PATH);
  const telemetry = await readTelemetry(telemetryPath);
  for (const rows of telemetry.snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);

  const candidates = (entryReview.candidates || [])
    .filter(usefulCandidate)
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
  const rejectedCandidates = (entryReview.candidates || [])
    .filter((row) => row.kind === 'wallet_shadow_would_enter' && !usefulCandidate(row));

  const rows = [];
  const misses = [];
  for (const candidate of candidates) {
    const snapshots = telemetry.snapshotsByMint.get(candidate.mint) || [];
    for (const profile of PROFILES) {
      const confirmation = findConfirmation(candidate, snapshots, profile);
      if (!confirmation) {
        misses.push({
          profile: profile.name,
          mint: candidate.mint,
          symbol: candidate.symbol || null,
          reason: 'NO_CONFIRMATION',
          score: numberOrNull(candidate.score, 2),
          curveProgress: numberOrNull(candidate.curveProgress, 6),
          sourceReason: candidate.sourceReason || null,
          walletName: candidate.qualifyingFirstTouch?.name || null
        });
        continue;
      }
      const replay = replayExit(candidate, confirmation, snapshots, profile, sizeSol, feeSol);
      if (replay) rows.push(replay);
      else {
        misses.push({
          profile: profile.name,
          mint: candidate.mint,
          symbol: candidate.symbol || null,
          reason: 'NO_PRICE_SNAPSHOTS_AFTER_CONFIRMATION',
          score: numberOrNull(candidate.score, 2),
          curveProgress: numberOrNull(candidate.curveProgress, 6),
          sourceReason: candidate.sourceReason || null,
          walletName: candidate.qualifyingFirstTouch?.name || null
        });
      }
    }
  }

  const byProfile = {};
  for (const profile of PROFILES) {
    const profileRows = rows.filter((row) => row.profile === profile.name);
    const summary = summarizeRows(profileRows);
    byProfile[profile.name] = {
      description: profile.description,
      verdict: verdictForSummary(summary),
      ...summary
    };
  }
  const bestProfile = Object.entries(byProfile)
    .sort((a, b) => Number(b[1].totalPnlSol || 0) - Number(a[1].totalPnlSol || 0))[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_supported_near_miss_replay',
    note: 'Replays wallet-shadow would-enter near misses with positive wallet support and optional fresh curve confirmation. Does not alter runtime gates, entries, exits, AI review, quotes, broadcasts, or live behavior.',
    sources: {
      telemetryPath: path.relative(ROOT, telemetryPath).replace(/\\/g, '/'),
      entryCandidateReviewPath: path.relative(ROOT, ENTRY_REVIEW_PATH).replace(/\\/g, '/')
    },
    assumptions: {
      sizeSol,
      feeSol,
      profiles: PROFILES,
      requiredCandidate: 'wallet_shadow_would_enter with positive/proven buy touch, no avoid touch, and dry-run would_send evidence'
    },
    summary: {
      entryReviewCandidates: (entryReview.candidates || []).length,
      walletShadowWouldEnter: (entryReview.candidates || []).filter((row) => row.kind === 'wallet_shadow_would_enter').length,
      eligibleCandidates: candidates.length,
      rejectedWalletShadowCandidates: rejectedCandidates.length,
      replayRows: rows.length,
      missRows: misses.length,
      bestProfile: bestProfile ? bestProfile[0] : null,
      bestProfileVerdict: bestProfile ? bestProfile[1].verdict : 'NO_CONFIRMED_REPLAYS',
      bestProfilePnlSol: bestProfile ? bestProfile[1].totalPnlSol : null,
      byProfile
    },
    candidates: candidates.map((candidate) => ({
      mint: candidate.mint,
      symbol: candidate.symbol || null,
      at: candidate.at,
      sourceReason: candidate.sourceReason || null,
      score: numberOrNull(candidate.score, 2),
      curveProgress: numberOrNull(candidate.curveProgress, 6),
      windows: candidate.windows || {},
      dryRun: candidate.dryRun || {},
      verdict: candidate.verdict || null,
      flags: candidate.flags || [],
      wallet: candidate.qualifyingFirstTouch || null
    })),
    rows: rows.slice().sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0)),
    misses: misses.slice(0, 200)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildReport(args);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`eligible=${report.summary.eligibleCandidates} replayRows=${report.summary.replayRows} best=${report.summary.bestProfile || 'n/a'} pnl=${report.summary.bestProfilePnlSol ?? 'n/a'} verdict=${report.summary.bestProfileVerdict}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { buildReport };
