#!/usr/bin/env node
'use strict';

const assert = require('assert');
const PreMigrationPaperLane = require('../src/lib/pre-migration-paper-lane');

const lane = Object.create(PreMigrationPaperLane.prototype);
const preset = {
  name: 'highConfidenceRunner',
  delayedConfirmationOnly: false,
  strategy: { takeProfitPct: 0.5, stopLossPct: 0.25, maxHoldSeconds: 300 },
  exitProfile: {
    trailingGivebackEnabled: false,
    breakevenStopEnabled: false,
    sellPressureExitEnabled: false,
    curveStallExitEnabled: false
  }
};
lane.presets = [preset];
lane.getStrategy = () => preset.strategy;
lane.getPrice = (state) => Number(state.priceSol);
lane.secondsBetween = (start, end) => (Date.parse(end) - Date.parse(start)) / 1000;
lane.computeBuyRatio = () => 0.5;
lane.evaluateEntryGuards = (_state, history) => ({ passed: history.length === 1 });
lane.evaluateEntryDecision = (_state, _preset, guards, _timestamp, context) => ({
  passed: guards.passed && context.presetEntries === 2,
  reason: guards.passed && context.presetEntries === 2 ? 'PAPER_ENTERED' : 'ENTRY_REJECTED'
});

const gate = lane.evaluateCounterfactualGateDecision({
  state: { mint: 'Mint', priceSol: 0.0000016 },
  timestamp: '2026-07-20T11:00:30.000Z',
  presetName: preset.name,
  flagged: true,
  context: {
    history: [{ timestamp: '2026-07-20T11:00:00.000Z', curveProgress: 0.7 }],
    activePosition: { presetName: 'strictMigration' },
    badExitCooldown: { active: false },
    sameMintCooldown: { active: false },
    presetEntries: { [preset.name]: 2 }
  }
});
assert.strictEqual(gate.wouldEnter, true);
assert.strictEqual(gate.action, 'WOULD_ENTER');
assert.strictEqual(gate.comparable, true);

const entry = lane.evaluateCounterfactualExecutedAction({
  action: 'ENTRY',
  state: { mint: 'Mint', priceSol: 0.0000016 },
  timestamp: '2026-07-20T11:00:30.000Z',
  presetName: preset.name,
  flagged: true,
  context: {
    history: [{ timestamp: '2026-07-20T11:00:00.000Z', curveProgress: 0.7 }],
    positionsByPreset: {},
    activePosition: null,
    badExitCooldown: { active: false },
    sameMintCooldown: { active: false },
    presetEntries: { [preset.name]: 2 }
  }
});
assert.strictEqual(entry.wouldExecute, true);
assert.strictEqual(entry.action, 'ENTRY');
assert.strictEqual(entry.comparable, true);

const exit = lane.evaluateCounterfactualExecutedAction({
  action: 'EXIT',
  state: { mint: 'Mint', priceSol: 0.0000016, curveProgress: 0.8 },
  timestamp: '2026-07-20T11:01:00.000Z',
  presetName: preset.name,
  context: {
    positionsByPreset: {
      [preset.name]: {
        mint: 'Mint',
        presetName: preset.name,
        entryAt: '2026-07-20T11:00:00.000Z',
        entryPriceSol: 0.000001,
        lastPriceSol: 0.000001,
        maxPriceSol: 0.000001,
        minPriceSol: 0.000001,
        maxCurveProgress: 0.7,
        entryCurveProgress: 0.7,
        peakReturnPct: 0,
        exitProfile: preset.exitProfile
      }
    }
  }
});
assert.strictEqual(exit.wouldExecute, true);
assert.strictEqual(exit.action, 'EXIT');
assert.strictEqual(exit.reason, 'TAKE_PROFIT');
assert.strictEqual(exit.comparable, true);

console.log('Helius executed-action counterfactual smoke passed');
