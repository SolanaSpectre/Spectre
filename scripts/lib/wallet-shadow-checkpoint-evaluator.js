'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonl } = require('./wallet-shadow-sample-ledger');
const { snapshotFromEvent } = require('./pre-migration-outcome-windows');

const ROOT = path.join(__dirname, '..', '..');
const CLEAN_SCHEMA_VERSION = 2;
const CLEAN_SAMPLE_TARGET = 10;
const FROZEN_PROFILE = Object.freeze({
  name: 'all_low_score_first_sight',
  amountSol: 0.02,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5,
  takeProfitPct: 0.35,
  stopLossPct: 0.15,
  maxHoldSeconds: 300,
  provenance: 'pre-migration-relaxed-gate-replay-report.js profile frozen before runtime shadow collection'
});
const STRESS_SCENARIOS = Object.freeze([
  { name: 'existing_extra_slippage_1_5pct', extraReturnPct: 1.5, fixedSolPerTrade: 0 },
  { name: 'fee_slippage_priority_conservative', extraReturnPct: 2.5, fixedSolPerTrade: 0.00005 }
]);

function round(value, digits = 9) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function readJsonlSync(filePath, visitor) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const decoder = new TextDecoder('utf8');
  let pending = '';
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) visitor(line);
    }
    pending += decoder.decode();
    if (pending.trim()) visitor(pending);
  } finally {
    fs.closeSync(fd);
  }
}

function resolveTelemetryPath(relativePath) {
  const resolved = path.resolve(ROOT, String(relativePath || ''));
  const relative = path.relative(ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function collectSnapshots(rows) {
  const requestsByTelemetry = new Map();
  for (const row of rows) {
    const fileRows = requestsByTelemetry.get(row.telemetryPath) || [];
    fileRows.push(row);
    requestsByTelemetry.set(row.telemetryPath, fileRows);
  }

  const snapshotsBySampleKey = new Map();
  const missingTelemetryPaths = [];
  for (const [telemetryPath, samples] of requestsByTelemetry.entries()) {
    const filePath = resolveTelemetryPath(telemetryPath);
    if (!filePath || !fs.existsSync(filePath)) {
      missingTelemetryPaths.push(telemetryPath);
      continue;
    }
    const byMint = new Map();
    for (const sample of samples) {
      const bucket = byMint.get(sample.mint) || [];
      bucket.push(sample);
      byMint.set(sample.mint, bucket);
      snapshotsBySampleKey.set(sample.sampleKey, []);
    }
    readJsonlSync(filePath, (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;
      let event;
      try {
        event = JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return;
      }
      const snapshot = snapshotFromEvent(event);
      const mintSamples = snapshot ? byMint.get(snapshot.mint) : null;
      if (!mintSamples) return;
      for (const sample of mintSamples) {
        const startMs = Number(sample.atMs || new Date(sample.at).getTime());
        if (snapshot.atMs > startMs && snapshot.atMs <= startMs + FROZEN_PROFILE.maxHoldSeconds * 1000) {
          snapshotsBySampleKey.get(sample.sampleKey).push(snapshot);
        }
      }
    });
  }
  return { snapshotsBySampleKey, missingTelemetryPaths };
}

function closeTrade(sample, snapshot, exitReason, netReturn) {
  return {
    sampleKey: sample.sampleKey,
    telemetryPath: sample.telemetryPath,
    mint: sample.mint,
    symbol: sample.symbol || null,
    entryAt: sample.at,
    exitAt: snapshot?.at || null,
    exitReason,
    holdSeconds: snapshot ? round((snapshot.atMs - Number(sample.atMs)) / 1000, 2) : null,
    entryPriceSol: round(sample.priceSol, 12),
    exitPriceSol: round(snapshot?.priceSol, 12),
    netReturnPct: round(netReturn * 100, 4),
    pnlSol: round(FROZEN_PROFILE.amountSol * netReturn)
  };
}

function simulateTrade(sample, snapshots) {
  const entryPrice = Number(sample.priceSol);
  const priced = (snapshots || [])
    .filter((row) => Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return closeTrade(sample, null, 'MISSING_ENTRY_PRICE', 0);
  if (!priced.length) return closeTrade(sample, null, 'NO_FUTURE_PRICE_SNAPSHOTS', 0);

  const entryFill = entryPrice * (1 + FROZEN_PROFILE.entrySlippagePct / 100);
  for (const snapshot of priced) {
    const exitFill = Number(snapshot.priceSol) * (1 - FROZEN_PROFILE.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    if (netReturn >= FROZEN_PROFILE.takeProfitPct) return closeTrade(sample, snapshot, 'TAKE_PROFIT', netReturn);
    if (netReturn <= -FROZEN_PROFILE.stopLossPct) return closeTrade(sample, snapshot, 'STOP_LOSS', netReturn);
  }
  const last = priced[priced.length - 1];
  const exitFill = Number(last.priceSol) * (1 - FROZEN_PROFILE.exitSlippagePct / 100);
  return closeTrade(sample, last, 'MAX_HOLD', (exitFill / entryFill) - 1);
}

function summarizeTrades(trades) {
  const joined = trades.filter((trade) => !['MISSING_ENTRY_PRICE', 'NO_FUTURE_PRICE_SNAPSHOTS'].includes(trade.exitReason));
  const pnls = joined.map((trade) => Number(trade.pnlSol));
  const totalPnlSol = pnls.reduce((sum, value) => sum + value, 0);
  const top3Pnl = pnls.slice().sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
  const byRun = {};
  for (const trade of joined) byRun[trade.telemetryPath] = (byRun[trade.telemetryPath] || 0) + Number(trade.pnlSol || 0);
  const runPnls = Object.values(byRun);
  const largestRunPnl = runPnls.length ? Math.max(...runPnls) : null;
  const scenarioPnlSol = Object.fromEntries(STRESS_SCENARIOS.map((scenario) => [
    scenario.name,
    round(joined.reduce((sum, trade) => (
      sum + Number(trade.pnlSol || 0)
      - FROZEN_PROFILE.amountSol * scenario.extraReturnPct / 100
      - scenario.fixedSolPerTrade
    ), 0))
  ]));
  return {
    trades: trades.length,
    joined: joined.length,
    missing: trades.length - joined.length,
    wins: joined.filter((trade) => Number(trade.pnlSol) > 0).length,
    losses: joined.filter((trade) => Number(trade.pnlSol) < 0).length,
    totalPnlSol: round(totalPnlSol),
    medianPnlSol: round(median(pnls)),
    pnlAfterRemovingTop3WinnersSol: round(totalPnlSol - top3Pnl),
    scenarioPnlSol,
    runsWithTrades: runPnls.length,
    positiveRuns: runPnls.filter((value) => value > 0).length,
    nonNegativeRuns: runPnls.filter((value) => value >= 0).length,
    largestRunShareOfTotalPnl: totalPnlSol > 0 && largestRunPnl !== null ? round(largestRunPnl / totalPnlSol, 4) : null,
    byRun: Object.fromEntries(Object.entries(byRun).map(([key, value]) => [key, round(value)])),
    exitReasonCounts: trades.reduce((counts, trade) => {
      counts[trade.exitReason] = (counts[trade.exitReason] || 0) + 1;
      return counts;
    }, {})
  };
}

function evaluateSummary(summary, cleanSamples) {
  const checkpointReached = cleanSamples >= CLEAN_SAMPLE_TARGET;
  const checks = {
    cleanSampleTargetReached: checkpointReached,
    allSamplesHaveRealizableOutcomes: summary.joined >= CLEAN_SAMPLE_TARGET && summary.missing === 0,
    positiveOrNonNegativeRunsAtLeast3: summary.nonNegativeRuns >= 3,
    positiveRunsAtLeast3: summary.positiveRuns >= 3,
    noSingleRunOver60PctOfTotalPnl: summary.largestRunShareOfTotalPnl !== null && summary.largestRunShareOfTotalPnl <= 0.6,
    totalPnlPositive: Number(summary.totalPnlSol) > 0,
    stressedPnlPositive: Number(summary.scenarioPnlSol.existing_extra_slippage_1_5pct) > 0,
    conservativeFeePnlPositive: Number(summary.scenarioPnlSol.fee_slippage_priority_conservative) > 0
  };
  let disposition = 'COLLECTING_CLEAN_POST_FIX_SAMPLES';
  if (checkpointReached && !checks.allSamplesHaveRealizableOutcomes) disposition = 'CHECKPOINT_REACHED_UNGRADEABLE_MISSING_REALIZABLE_OUTCOMES';
  else if (checkpointReached && Object.values(checks).every(Boolean)) disposition = 'PASSED_CLEAN_CHECKPOINT_REPORT_ONLY';
  else if (checkpointReached) disposition = 'FAILED_CLEAN_CHECKPOINT';
  return { disposition, checks, failedChecks: Object.entries(checks).filter(([, value]) => !value).map(([key]) => key) };
}

function evaluateWalletCheckpoint({ ledgerPath, frozenSlice }) {
  const selected = readJsonl(ledgerPath).filter((row) => (
    row.frozenSlice === frozenSlice && Number(row.outcomeJoinSchemaVersion || 0) >= CLEAN_SCHEMA_VERSION
  ));
  const cleanRows = selected.slice(0, CLEAN_SAMPLE_TARGET);
  const { snapshotsBySampleKey, missingTelemetryPaths } = collectSnapshots(cleanRows);
  const trades = cleanRows.map((row) => simulateTrade(row, snapshotsBySampleKey.get(row.sampleKey) || []));
  const summary = summarizeTrades(trades);
  return {
    evaluatedAt: new Date().toISOString(),
    frozenProfile: FROZEN_PROFILE,
    stressScenarios: STRESS_SCENARIOS,
    samplePolicy: {
      cleanSchemaVersionAtLeast: CLEAN_SCHEMA_VERSION,
      target: CLEAN_SAMPLE_TARGET,
      firstCleanSamplesOnly: true,
      noExtensionAfterTerminalVerdict: true
    },
    cleanSamplesAvailable: selected.length,
    cleanSamplesEvaluated: cleanRows.length,
    missingTelemetryPaths,
    summary,
    checkpoint: evaluateSummary(summary, selected.length),
    trades
  };
}

module.exports = {
  CLEAN_SAMPLE_TARGET,
  FROZEN_PROFILE,
  STRESS_SCENARIOS,
  evaluateSummary,
  evaluateWalletCheckpoint,
  simulateTrade,
  summarizeTrades
};
