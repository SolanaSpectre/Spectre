#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const {
  analyzeDecision,
  latestTelemetryFile,
  num,
  readTelemetry,
  repoPath,
  stat
} = require('./pre-migration-curve-advance-diagnostic-report');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-not-advancing-separator-shadow-latest.json');
const SIZE_SOL = 0.05;
const FEE_SOL = 0.0005;
const RUNTIME_SHADOW_ENTER = 'pre_migration_curve_not_advancing_separator_shadow.would_enter';
const RUNTIME_SHADOW_SKIP = 'pre_migration_curve_not_advancing_separator_shadow.would_skip';
const PREREGISTERED_SEPARATOR_RULE = 'delta60_ge_02_score55_vol5_vel10';
const PREREGISTERED_EXIT_PROFILE = 'shadow_300s_tp50_sl25_slip3';

const EXIT_PROFILES = [
  { name: 'shadow_120s_tp50_sl25_slip3', holdSeconds: 120, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 3, exitSlippagePct: 3 },
  { name: 'shadow_300s_tp50_sl25_slip3', holdSeconds: 300, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 3, exitSlippagePct: 3 },
  { name: 'shadow_120s_tp35_sl20_slip5', holdSeconds: 120, takeProfitPct: 35, stopLossPct: -20, entrySlippagePct: 5, exitSlippagePct: 5 },
  { name: 'shadow_300s_tp35_sl20_slip5', holdSeconds: 300, takeProfitPct: 35, stopLossPct: -20, entrySlippagePct: 5, exitSlippagePct: 5 }
];

const CANDIDATE_RULES = [
  { name: 'age_lt_1000', description: 'baselineAgeMs <= 1000', test: (row) => Number(row.baselineAgeMs) <= 1000 },
  { name: 'age_lt_1500', description: 'baselineAgeMs <= 1500', test: (row) => Number(row.baselineAgeMs) <= 1500 },
  { name: 'age_lt_2000', description: 'baselineAgeMs <= 2000', test: (row) => Number(row.baselineAgeMs) <= 2000 },
  { name: 'age_lt_1000_readiness_gt_0', description: 'baselineAgeMs <= 1000 and readinessPct > 0', test: (row) => Number(row.baselineAgeMs) <= 1000 && Number(row.readinessPct) > 0 },
  { name: 'age_lt_1500_readiness_gt_0', description: 'baselineAgeMs <= 1500 and readinessPct > 0', test: (row) => Number(row.baselineAgeMs) <= 1500 && Number(row.readinessPct) > 0 },
  { name: 'age_lt_2000_readiness_gt_0', description: 'baselineAgeMs <= 2000 and readinessPct > 0', test: (row) => Number(row.baselineAgeMs) <= 2000 && Number(row.readinessPct) > 0 },
  { name: 'age_lt_1500_readiness_ge_3', description: 'baselineAgeMs <= 1500 and readinessPct >= 3', test: (row) => Number(row.baselineAgeMs) <= 1500 && Number(row.readinessPct) >= 3 },
  { name: 'age_lt_2000_readiness_ge_3', description: 'baselineAgeMs <= 2000 and readinessPct >= 3', test: (row) => Number(row.baselineAgeMs) <= 2000 && Number(row.readinessPct) >= 3 },
  { name: 'age_lt_1000_delta_ge_0', description: 'baselineAgeMs <= 1000 and instant curve delta >= 0', test: (row) => Number(row.baselineAgeMs) <= 1000 && Number(row.curveProgressDelta) >= 0 },
  { name: 'age_lt_1500_delta_ge_0', description: 'baselineAgeMs <= 1500 and instant curve delta >= 0', test: (row) => Number(row.baselineAgeMs) <= 1500 && Number(row.curveProgressDelta) >= 0 },
  { name: 'age_lt_2000_delta_ge_0', description: 'baselineAgeMs <= 2000 and instant curve delta >= 0', test: (row) => Number(row.baselineAgeMs) <= 2000 && Number(row.curveProgressDelta) >= 0 },
  { name: 'age_lt_1500_delta_ge_0_low_volume', description: 'baselineAgeMs <= 1500, instant curve delta >= 0, recentVolumeSol <= 1', test: (row) => Number(row.baselineAgeMs) <= 1500 && Number(row.curveProgressDelta) >= 0 && Number(row.recentVolumeSol) <= 1 },
  { name: 'age_lt_1500_no_avoid_readiness_gt_0', description: 'baselineAgeMs <= 1500, readinessPct > 0, no avoid wallet touch', test: (row) => Number(row.baselineAgeMs) <= 1500 && Number(row.readinessPct) > 0 && Number(row.walletContext?.avoidWalletTouchCount || 0) === 0 },
  { name: 'age_lt_1500_no_avoid_delta_ge_0', description: 'baselineAgeMs <= 1500, instant curve delta >= 0, no avoid wallet touch', test: (row) => Number(row.baselineAgeMs) <= 1500 && Number(row.curveProgressDelta) >= 0 && Number(row.walletContext?.avoidWalletTouchCount || 0) === 0 },
  { name: 'age_lt_1500_no_avoid_low_volume_delta_ge_0', description: 'baselineAgeMs <= 1500, instant curve delta >= 0, recentVolumeSol <= 1, no avoid wallet touch', test: (row) => Number(row.baselineAgeMs) <= 1500 && Number(row.curveProgressDelta) >= 0 && Number(row.recentVolumeSol) <= 1 && Number(row.walletContext?.avoidWalletTouchCount || 0) === 0 },
  { name: 'readiness_ge_10_age_lt_3000', description: 'readinessPct >= 10 and baselineAgeMs <= 3000', test: (row) => Number(row.readinessPct) >= 10 && Number(row.baselineAgeMs) <= 3000 },
  { name: 'delta_ge_0_low_volume_age_lt_3000', description: 'instant curve delta >= 0, recentVolumeSol <= 1, baselineAgeMs <= 3000', test: (row) => Number(row.curveProgressDelta) >= 0 && Number(row.recentVolumeSol) <= 1 && Number(row.baselineAgeMs) <= 3000 },
  { name: 'delta60_ge_005_score55_vol5_vel10', description: '60s curve delta >= 0.005, score >= 55, volume >= 5 SOL, velocity >= 10/min', test: (row) => Number(row.curveProgressDelta60s) >= 0.005 && Number(row.score) >= 55 && Number(row.recentVolumeSol) >= 5 && Number(row.tradeVelocityPerMin) >= 10 },
  { name: 'delta60_ge_02_score55_vol5_vel10', description: '60s curve delta >= 0.02, score >= 55, volume >= 5 SOL, velocity >= 10/min', test: (row) => Number(row.curveProgressDelta60s) >= 0.02 && Number(row.score) >= 55 && Number(row.recentVolumeSol) >= 5 && Number(row.tradeVelocityPerMin) >= 10 },
  { name: 'delta60_ge_05_score60_vol12_vel12', description: '60s curve delta >= 0.05, score >= 60, volume >= 12 SOL, velocity >= 12/min', test: (row) => Number(row.curveProgressDelta60s) >= 0.05 && Number(row.score) >= 60 && Number(row.recentVolumeSol) >= 12 && Number(row.tradeVelocityPerMin) >= 12 },
  { name: 'delta60_ge_005_delta_nonnegative_score55', description: '60s curve delta >= 0.005, instant delta >= 0, score >= 55', test: (row) => Number(row.curveProgressDelta60s) >= 0.005 && Number(row.curveProgressDelta) >= 0 && Number(row.score) >= 55 },
  { name: 'delta60_ge_02_delta_nonnegative_score55', description: '60s curve delta >= 0.02, instant delta >= 0, score >= 55', test: (row) => Number(row.curveProgressDelta60s) >= 0.02 && Number(row.curveProgressDelta) >= 0 && Number(row.score) >= 55 },
  { name: 'delta60_ge_005_score70', description: '60s curve delta >= 0.005 and score >= 70', test: (row) => Number(row.curveProgressDelta60s) >= 0.005 && Number(row.score) >= 70 },
  { name: 'delta60_ge_02_score70', description: '60s curve delta >= 0.02 and score >= 70', test: (row) => Number(row.curveProgressDelta60s) >= 0.02 && Number(row.score) >= 70 }
];

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

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function mintRowConcentration(rows) {
  const counts = countBy(rows, (row) => row.mint);
  const entries = Object.entries(counts);
  const totalRows = rows.length;
  const top1Rows = entries[0]?.[1] || 0;
  const top3Rows = entries.slice(0, 3).reduce((sum, [, count]) => sum + count, 0);
  return {
    rows: totalRows,
    uniqueMints: entries.length,
    duplicateRowsCollapsed: Math.max(0, totalRows - entries.length),
    topMintRowShare: totalRows ? num(top1Rows / totalRows, 4) : null,
    top3MintRowShare: totalRows ? num(top3Rows / totalRows, 4) : null,
    topMints: Object.fromEntries(entries.slice(0, 8))
  };
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.telemetryType || event.type || event.event || event.name || 'unknown';
}

function quantile(values, q) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

function selectEarliestUniqueMint(rows) {
  const picked = new Map();
  for (const row of rows) {
    const current = picked.get(row.mint);
    const rowMs = new Date(row.at || 0).getTime();
    const currentMs = current ? new Date(current.at || 0).getTime() : Infinity;
    if (!current || rowMs < currentMs) picked.set(row.mint, row);
  }
  return Array.from(picked.values()).sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

function replayDecision(row, snapshotsByMint, profile) {
  const entryMs = Number(row.atMs) || new Date(row.at || 0).getTime();
  if (!Number.isFinite(entryMs)) return null;
  const snapshots = (snapshotsByMint.get(row.mint) || [])
    .filter((snapshot) => Number.isFinite(snapshot.atMs) && Number.isFinite(Number(snapshot.priceSol)) && Number(snapshot.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  const entryPriceRaw = Number(row.priceSol);
  if (!Number.isFinite(entryPriceRaw) || entryPriceRaw <= 0) return null;
  const holdUntilMs = entryMs + profile.holdSeconds * 1000;
  const path = snapshots.filter((snapshot) => snapshot.atMs > entryMs && snapshot.atMs <= holdUntilMs);
  if (!path.length) return null;

  const entryPrice = entryPriceRaw * (1 + profile.entrySlippagePct / 100);
  const takeProfitPrice = entryPrice * (1 + profile.takeProfitPct / 100);
  const stopLossPrice = entryPrice * (1 + profile.stopLossPct / 100);
  let exit = path[path.length - 1];
  let exitReason = 'time';
  for (const snapshot of path) {
    const price = Number(snapshot.priceSol);
    if (price >= takeProfitPrice) {
      exit = snapshot;
      exitReason = 'take_profit';
      break;
    }
    if (price <= stopLossPrice) {
      exit = snapshot;
      exitReason = 'stop_loss';
      break;
    }
  }
  const exitPrice = Number(exit.priceSol) * (1 - profile.exitSlippagePct / 100);
  const grossPct = ((exitPrice - entryPrice) / entryPrice) * 100;
  const pnlSol = SIZE_SOL * (grossPct / 100) - FEE_SOL;
  const maxPrice = Math.max(...path.map((snapshot) => Number(snapshot.priceSol)));
  const minPrice = Math.min(...path.map((snapshot) => Number(snapshot.priceSol)));
  return {
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    classification: row.classification,
    profile: profile.name,
    exitReason,
    holdSeconds: num((exit.atMs - entryMs) / 1000, 1),
    entryPrice: num(entryPrice, 12),
    exitPrice: num(exitPrice, 12),
    grossPct: num(grossPct, 2),
    pnlSol: num(pnlSol, 9),
    maxPriceDeltaPct: num(((maxPrice - entryPrice) / entryPrice) * 100, 2),
    minPriceDeltaPct: num(((minPrice - entryPrice) / entryPrice) * 100, 2),
    score: row.score,
    baselineAgeMs: row.baselineAgeMs,
    readinessPct: row.readinessPct,
    curveProgressDelta: row.curveProgressDelta,
    recentVolumeSol: row.recentVolumeSol,
    walletBucket: row.walletContext?.bucket || null
  };
}

function outlierSummary(replayRows) {
  const pnls = replayRows.map((row) => Number(row.pnlSol)).filter(Number.isFinite).sort((a, b) => b - a);
  const grossProfit = pnls.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const total = pnls.reduce((sum, value) => sum + value, 0);
  const withoutTop1 = pnls.slice(1).reduce((sum, value) => sum + value, 0);
  const withoutTop3 = pnls.slice(3).reduce((sum, value) => sum + value, 0);
  const topWinner = pnls.find((value) => value > 0) || 0;
  const topWinnerShare = grossProfit > 0 ? topWinner / grossProfit : null;
  return {
    totalPnlSol: num(total, 9),
    pnlAfterRemovingTopWinnerSol: num(withoutTop1, 9),
    pnlAfterRemovingTop3WinnersSol: num(withoutTop3, 9),
    topWinnerShareOfGrossProfit: topWinnerShare === null ? null : num(topWinnerShare, 4),
    outlierDominated: grossProfit > 0 && topWinnerShare > 0.5
  };
}

function summarizeReplay(rule, profile, allMatchingRows, selectedRows, replayRows) {
  const pnls = replayRows.map((row) => Number(row.pnlSol)).filter(Number.isFinite);
  const wins = pnls.filter((value) => value > 0).length;
  const losses = pnls.filter((value) => value <= 0).length;
  const outliers = outlierSummary(replayRows);
  const median = quantile(pnls, 0.5);
  const p90 = quantile(pnls, 0.9);
  const avg = pnls.length ? pnls.reduce((sum, value) => sum + value, 0) / pnls.length : null;
  const robustnessScore = replayRows.length >= 5
    ? Number(outliers.totalPnlSol || 0)
      + Math.min(replayRows.length, 20) * 0.00005
      + Math.max(Number(median || 0), -0.02)
      + Math.max(Number(outliers.pnlAfterRemovingTop3WinnersSol || 0), -0.1)
    : -1;
  return {
    rule: rule.name,
    description: rule.description,
    exitProfile: profile.name,
    matchedRows: allMatchingRows.length,
    matchedUniqueMints: new Set(allMatchingRows.map((row) => row.mint).filter(Boolean)).size,
    matchedConcentration: mintRowConcentration(allMatchingRows),
    selectedUniqueMints: selectedRows.length,
    selectedWithEntryPrice: selectedRows.filter((row) => Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0).length,
    selectedWithFuturePriceSnapshots: selectedRows.filter((row) => {
      const entryMs = Number(row.atMs) || new Date(row.at || 0).getTime();
      return (row.mint && Number.isFinite(entryMs) && row._hasFuturePriceSnapshots === true);
    }).length,
    replayedTrades: replayRows.length,
    wins,
    losses,
    winRate: replayRows.length ? num(wins / replayRows.length, 4) : null,
    totalPnlSol: outliers.totalPnlSol,
    avgPnlSol: avg === null ? null : num(avg, 9),
    medianPnlSol: median === null ? null : num(median, 9),
    p90PnlSol: p90 === null ? null : num(p90, 9),
    pnlAfterRemovingTopWinnerSol: outliers.pnlAfterRemovingTopWinnerSol,
    pnlAfterRemovingTop3WinnersSol: outliers.pnlAfterRemovingTop3WinnersSol,
    topWinnerShareOfGrossProfit: outliers.topWinnerShareOfGrossProfit,
    outlierDominated: outliers.outlierDominated,
    promotionEligible: replayRows.length >= 20
      && selectedRows.length >= 20
      && Number(median || 0) > 0
      && Number(outliers.totalPnlSol || 0) > 0
      && Number(outliers.pnlAfterRemovingTop3WinnersSol || 0) > 0
      && outliers.outlierDominated !== true
      && Number(mintRowConcentration(allMatchingRows).topMintRowShare || 1) < 0.4,
    robustnessScore: num(robustnessScore, 9),
    exitReasonCounts: countBy(replayRows, (row) => row.exitReason),
    classificationCounts: countBy(selectedRows, (row) => row.classification),
    walletBucketCounts: countBy(selectedRows, (row) => row.walletContext?.bucket),
    featureStats: {
      baselineAgeMs: stat(selectedRows.map((row) => row.baselineAgeMs), 0),
      readinessPct: stat(selectedRows.map((row) => row.readinessPct), 2),
      curveProgressDelta: stat(selectedRows.map((row) => row.curveProgressDelta), 6),
      recentVolumeSol: stat(selectedRows.map((row) => row.recentVolumeSol), 4)
    }
  };
}

function compactCandidate(row) {
  return {
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    classification: row.classification,
    score: row.score,
    baselineAgeMs: row.baselineAgeMs,
    readinessPct: row.readinessPct,
    curveProgressDelta: row.curveProgressDelta,
    curveProgressDelta60s: row.curveProgressDelta60s,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    walletBucket: row.walletContext?.bucket || null,
    curveDelta120s: row.windows?.['120s']?.curveDelta ?? null,
    curveDelta300s: row.windows?.['300s']?.curveDelta ?? null,
    maxPriceDeltaPct120s: row.windows?.['120s']?.maxPriceDeltaPct ?? null
  };
}

function compactRuntimeShadow(row) {
  return {
    mint: row.mint,
    symbol: row.symbol || null,
    timestamp: row.timestamp || null,
    preset: row.preset || null,
    reason: row.reason || null,
    score: row.score ?? null,
    curveProgress: row.curveProgress ?? null,
    baselineAgeMs: row.baselineAgeMs ?? null,
    curveProgressDelta: row.curveProgressDelta ?? null,
    curveProgressDelta60s: row.curveProgressDelta60s ?? null,
    recentVolumeSol: row.recentVolumeSol ?? null,
    priceSol: row.priceSol ?? null,
    failedChecks: Array.isArray(row.failedChecks) ? row.failedChecks : []
  };
}

function readRuntimeShadowSummary(telemetryPath) {
  const rows = [];
  const stats = forEachJsonlSync(telemetryPath, (event) => {
    const type = eventType(event);
    if (type !== RUNTIME_SHADOW_ENTER && type !== RUNTIME_SHADOW_SKIP) return;
    rows.push({
      ...payloadOf(event),
      type,
      wouldEnter: type === RUNTIME_SHADOW_ENTER
    });
  });
  const enterRows = rows.filter((row) => row.wouldEnter);
  const skipRows = rows.filter((row) => !row.wouldEnter);
  return {
    rows: rows.length,
    malformedLines: stats.malformedLines,
    wouldEnterRows: enterRows.length,
    wouldSkipRows: skipRows.length,
    uniqueMints: new Set(rows.map((row) => row.mint).filter(Boolean)).size,
    uniqueWouldEnterMints: new Set(enterRows.map((row) => row.mint).filter(Boolean)).size,
    concentration: mintRowConcentration(rows),
    wouldEnterConcentration: mintRowConcentration(enterRows),
    wouldSkipConcentration: mintRowConcentration(skipRows),
    topSkipReasons: countBy(skipRows, (row) => row.reason || (Array.isArray(row.failedChecks) ? row.failedChecks[0] : null)),
    topFailedChecks: countBy(skipRows.flatMap((row) => Array.isArray(row.failedChecks) ? row.failedChecks : []), (item) => item),
    wouldEnterSamples: enterRows.slice(0, 20).map(compactRuntimeShadow),
    wouldSkipSamples: skipRows.slice(0, 20).map(compactRuntimeShadow)
  };
}

function buildReport(telemetryPath, telemetry) {
  const analyzed = telemetry.decisions.map((decision) => analyzeDecision(
    decision,
    telemetry.snapshotsByMint.get(decision.mint) || [],
    telemetry.targetedParityByMint.get(decision.mint) || []
  ));
  const ruleRuns = [];
  const replaySamples = {};
  const preRegisteredKey = `${PREREGISTERED_SEPARATOR_RULE}:${PREREGISTERED_EXIT_PROFILE}`;
  let preRegisteredRun = null;
  let preRegisteredTrades = [];
  for (const row of analyzed) {
    const entryMs = Number(row.atMs) || new Date(row.at || 0).getTime();
    row._hasFuturePriceSnapshots = (telemetry.snapshotsByMint.get(row.mint) || []).some((snapshot) => (
      Number.isFinite(entryMs)
      && Number.isFinite(snapshot.atMs)
      && snapshot.atMs > entryMs
      && Number.isFinite(Number(snapshot.priceSol))
      && Number(snapshot.priceSol) > 0
    ));
  }

  for (const rule of CANDIDATE_RULES) {
    const matchingRows = analyzed.filter((row) => {
      try {
        return rule.test(row) === true;
      } catch {
        return false;
      }
    });
    const selectedRows = selectEarliestUniqueMint(matchingRows);
    for (const profile of EXIT_PROFILES) {
      const replayRows = selectedRows
        .map((row) => replayDecision(row, telemetry.snapshotsByMint, profile))
        .filter(Boolean);
      const summary = summarizeReplay(rule, profile, matchingRows, selectedRows, replayRows);
      ruleRuns.push(summary);
      if (`${rule.name}:${profile.name}` === preRegisteredKey) {
        preRegisteredRun = summary;
        preRegisteredTrades = replayRows;
      }
      replaySamples[`${rule.name}:${profile.name}`] = {
        topWinners: replayRows.slice().sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol)).slice(0, 10),
        topLosers: replayRows.slice().sort((a, b) => Number(a.pnlSol) - Number(b.pnlSol)).slice(0, 10)
      };
    }
  }

  const ranked = ruleRuns.slice().sort((a, b) => (
    Number(b.robustnessScore || -Infinity) - Number(a.robustnessScore || -Infinity)
    || Number(b.totalPnlSol || -Infinity) - Number(a.totalPnlSol || -Infinity)
    || Number(b.replayedTrades || 0) - Number(a.replayedTrades || 0)
  ));
  const robustPositive = ranked.filter((row) => (
    row.promotionEligible === true
  ));
  const best = ranked[0] || null;
  const bestKey = best ? `${best.rule}:${best.exitProfile}` : null;
  const bestRule = best ? CANDIDATE_RULES.find((rule) => rule.name === best.rule) : null;
  const bestRows = bestRule
    ? selectEarliestUniqueMint(analyzed.filter((row) => bestRule.test(row))).slice(0, 20).map(compactCandidate)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_curve_not_advancing_separator_shadow',
    telemetryPath: path.relative(ROOT, telemetryPath),
    assumptions: {
      sizeSol: SIZE_SOL,
      feeSol: FEE_SOL,
      exitProfiles: EXIT_PROFILES,
      candidateRules: CANDIDATE_RULES.map(({ name, description }) => ({ name, description })),
      preRegisteredHypothesis: {
        rule: PREREGISTERED_SEPARATOR_RULE,
        exitProfile: PREREGISTERED_EXIT_PROFILE,
        promotionBar: 'cumulative n >= 30, total > 0, median > 0, exTop3 >= 0, not outlier dominated, positive in at least half of runs'
      },
      caveat: 'Report-only observed-path replay over provider price snapshots. It does not model quote availability, MEV, exact liquidity, latency, or transaction landing.'
    },
    summary: {
      analyzedRows: analyzed.length,
      uniqueMints: new Set(analyzed.map((row) => row.mint)).size,
      candidateRuleCount: CANDIDATE_RULES.length,
      exitProfileCount: EXIT_PROFILES.length,
      evaluatedRuleProfileCount: ruleRuns.length,
      robustPositiveCount: robustPositive.length,
      verdict: robustPositive.length ? 'PROMISING_SEPARATOR_SHADOW_FOUND' : 'NO_PROMOTABLE_SEPARATOR_SHADOW',
      classificationCounts: countBy(analyzed, (row) => row.classification),
      bestRun: best ? {
        rule: best.rule,
        exitProfile: best.exitProfile,
        matchedRows: best.matchedRows,
        matchedUniqueMints: best.matchedUniqueMints,
        selectedUniqueMints: best.selectedUniqueMints,
        replayedTrades: best.replayedTrades,
        totalPnlSol: best.totalPnlSol,
        medianPnlSol: best.medianPnlSol,
        pnlAfterRemovingTop3WinnersSol: best.pnlAfterRemovingTop3WinnersSol,
        topMintRowShare: best.matchedConcentration?.topMintRowShare ?? null,
        outlierDominated: best.outlierDominated,
        promotionEligible: best.promotionEligible === true
      } : null
    },
    runtimeShadow: readRuntimeShadowSummary(telemetryPath),
    preRegisteredRun,
    preRegisteredTrades,
    rankedRuns: ranked,
    robustPositiveRuns: robustPositive,
    bestRunSamples: bestKey ? replaySamples[bestKey] : null,
    bestRunCandidates: bestRows,
    note: 'Report-only separator shadow for CURVE_NOT_ADVANCING rows. It tests whether separability features can form an outcome-positive shadow lane. It does not change gates, entries, exits, scoring, AI review, quotes, broadcasts, or live behavior.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for curve-not-advancing separator shadow report.');
  }
  const telemetry = await readTelemetry(telemetryPath);
  const report = buildReport(telemetryPath, telemetry);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('Pre-Migration CURVE_NOT_ADVANCING Separator Shadow');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Verdict: ${report.summary.verdict}`);
  console.log(`Best: ${report.summary.bestRun ? JSON.stringify(report.summary.bestRun) : 'none'}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = {
  buildReport,
  PREREGISTERED_EXIT_PROFILE,
  PREREGISTERED_SEPARATOR_RULE
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
