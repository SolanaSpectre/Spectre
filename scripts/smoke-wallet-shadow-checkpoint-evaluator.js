#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  FROZEN_PROFILE,
  evaluateSummary,
  simulateTrade,
  summarizeTrades
} = require('./lib/wallet-shadow-checkpoint-evaluator');

const sample = {
  sampleKey: 'smoke',
  telemetryPath: 'smoke.jsonl',
  mint: 'mint',
  at: '2026-01-01T00:00:00.000Z',
  atMs: Date.parse('2026-01-01T00:00:00.000Z'),
  priceSol: 1
};
const takeProfitPrice = (1 + FROZEN_PROFILE.entrySlippagePct / 100) * (1 + FROZEN_PROFILE.takeProfitPct) / (1 - FROZEN_PROFILE.exitSlippagePct / 100);
const trade = simulateTrade(sample, [{
  at: '2026-01-01T00:00:10.000Z',
  atMs: sample.atMs + 10000,
  priceSol: takeProfitPrice
}]);
assert.strictEqual(trade.exitReason, 'TAKE_PROFIT');
assert(Number(trade.pnlSol) > 0);

const summary = summarizeTrades(Array.from({ length: 10 }, (_, index) => ({
  ...trade,
  sampleKey: `smoke-${index}`,
  telemetryPath: `run-${index % 3}.jsonl`
})));
const checkpoint = evaluateSummary(summary, 10);
assert.strictEqual(checkpoint.checks.cleanSampleTargetReached, true);
assert.strictEqual(checkpoint.disposition, 'PASSED_CLEAN_CHECKPOINT_REPORT_ONLY');
assert.deepStrictEqual(checkpoint.failedChecks, []);

console.log('wallet shadow checkpoint evaluator smoke passed');
