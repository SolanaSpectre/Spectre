#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PreMigrationPaperLane = require('../src/lib/pre-migration-paper-lane');

const lane = Object.create(PreMigrationPaperLane.prototype);
lane.minCurveProgressDelta = 0.01;
lane.curveProgressLookbackMs = 2 * 60 * 1000;
lane.openPositions = new Map();
lane.observationHistory = new Map();
const preset = {
  name: 'runnerWatch',
  delayedConfirmationOnly: false,
  strategy: {}
};
lane.presets = [preset];
lane.stats = { presets: { [preset.name]: { entries: 0 } } };
lane.getBadExitCooldown = () => ({ active: false });
lane.getSameMintExitCooldown = () => ({ active: false });
lane.evaluateHighCurveStaleSnapshotGuard = () => ({ blocked: false });
lane.evaluateCloneGuard = () => ({ passed: true });
lane.evaluateLateFastTrack = () => ({ passed: false });
lane.evaluateEarlyAccelerationFastTrack = () => ({ passed: false });
lane.evaluateBroadOrganicSurgeOverride = () => ({ passed: false });
lane.evaluateEarlySurgeOverride = () => ({ passed: false });
lane.evaluateCurvePauseOverride = () => ({ passed: false });
lane.evaluateFirstCurveSnapshotScalp = () => ({ passed: false });
lane.evaluateFirstSightOverride = () => ({ passed: false });
lane.evaluateEntryDecision = (_state, _preset, guards) => ({
  ...guards,
  passed: guards.passed === true,
  reason: guards.reason || (guards.passed ? 'PAPER_ENTERED' : 'ENTRY_REJECTED')
});

const mint = 'BaselineAnchorFixtureMint';
const oldBaselineAt = '2026-07-27T20:38:04.575Z';
const recentActualAt = '2026-07-27T20:38:13.442Z';
const decisionAt = '2026-07-27T20:38:13.900Z';
const history = [
  { timestamp: oldBaselineAt, curveProgress: 0.703163, price: 0.000001 },
  { timestamp: recentActualAt, curveProgress: 0.776613, price: 0.0000012 }
];
lane.observationHistory.set(mint, history);

const context = lane.captureCounterfactualContext(
  mint,
  decisionAt,
  { mint, curveProgress: 0.776613 }
);
assert.strictEqual(context.requireCurveProgressBaselineControl, true);
assert.deepStrictEqual(context.curveProgressBaselineControl, {
  captured: true,
  valid: true,
  selected: true,
  actualCurveProgress: 0.776613,
  curveProgress: 0.703163,
  at: oldBaselineAt
});

const shadowState = { mint, curveProgress: 0.76848 };
const uncontrolled = lane.evaluateCurveProgressGuard(shadowState, context.history, decisionAt);
assert.strictEqual(uncontrolled.passed, false);
assert.strictEqual(uncontrolled.reason, 'CURVE_NOT_ADVANCING');
assert.strictEqual(uncontrolled.baselineCurveProgress, 0.776613);
assert.strictEqual(uncontrolled.baselineAt, recentActualAt);
assert.strictEqual(uncontrolled.curveProgressDelta, -0.008133);

const controlled = lane.evaluateCurveProgressGuard(
  shadowState,
  context.history,
  decisionAt,
  { curveProgressBaselineControl: context.curveProgressBaselineControl }
);
assert.strictEqual(controlled.passed, true);
assert.strictEqual(controlled.baselineCurveProgress, 0.703163);
assert.strictEqual(controlled.baselineAt, oldBaselineAt);
assert.strictEqual(controlled.curveProgressDelta, 0.065317);

const actualHistoryAfterObserve = context.history.concat([{
  timestamp: decisionAt,
  curveProgress: 0.776613,
  price: 0.0000012
}]);
const actualAfterObserve = lane.evaluateCurveProgressGuard(
  { mint, curveProgress: 0.776613 },
  actualHistoryAfterObserve,
  decisionAt
);
assert.strictEqual(actualAfterObserve.baselineCurveProgress, 0.703163);
assert.strictEqual(actualAfterObserve.baselineAt, oldBaselineAt);

const gate = lane.evaluateCounterfactualGateDecision({
  state: shadowState,
  timestamp: decisionAt,
  presetName: preset.name,
  flagged: true,
  context
});
assert.strictEqual(gate.comparable, true);
assert.strictEqual(gate.baselineControlApplied, true);
assert.strictEqual(gate.entryGuards.baselineCurveProgress, 0.703163);
assert.strictEqual(gate.entryGuards.baselineAt, oldBaselineAt);

const executedEntry = lane.evaluateCounterfactualExecutedAction({
  action: 'ENTRY',
  state: shadowState,
  timestamp: decisionAt,
  presetName: preset.name,
  flagged: true,
  context
});
assert.strictEqual(executedEntry.comparable, true);
assert.strictEqual(executedEntry.baselineControlApplied, true);
assert.strictEqual(executedEntry.entryGuards.baselineCurveProgress, 0.703163);
assert.strictEqual(executedEntry.entryGuards.baselineAt, oldBaselineAt);

const invalidControlContext = {
  ...context,
  curveProgressBaselineControl: {
    ...context.curveProgressBaselineControl,
    valid: false
  }
};
const invalidGate = lane.evaluateCounterfactualGateDecision({
  state: shadowState,
  timestamp: decisionAt,
  presetName: preset.name,
  flagged: true,
  context: invalidControlContext
});
assert.strictEqual(invalidGate.comparable, false);
assert.strictEqual(invalidGate.reason, 'INCOMPARABLE_BASELINE_CONTROL');
const invalidExecutedEntry = lane.evaluateCounterfactualExecutedAction({
  action: 'ENTRY',
  state: shadowState,
  timestamp: decisionAt,
  presetName: preset.name,
  flagged: true,
  context: invalidControlContext
});
assert.strictEqual(invalidExecutedEntry.comparable, false);
assert.strictEqual(invalidExecutedEntry.reason, 'INCOMPARABLE_BASELINE_CONTROL');

const noBaselineMint = 'NoBaselineFixtureMint';
const noBaselineAt = '2026-07-27T20:40:00.000Z';
lane.observationHistory.set(noBaselineMint, [{
  timestamp: noBaselineAt,
  curveProgress: 0.5,
  price: 0.000001
}]);
const noBaselineContext = lane.captureCounterfactualContext(
  noBaselineMint,
  '2026-07-27T20:40:01.000Z',
  { mint: noBaselineMint, curveProgress: 0.5 }
);
assert.strictEqual(noBaselineContext.curveProgressBaselineControl.selected, false);
const noBaselineGate = lane.evaluateCounterfactualGateDecision({
  state: { mint: noBaselineMint, curveProgress: 0.49 },
  timestamp: '2026-07-27T20:40:01.000Z',
  presetName: preset.name,
  flagged: true,
  context: noBaselineContext
});
assert.strictEqual(noBaselineGate.comparable, true);
assert.strictEqual(noBaselineGate.baselineControlApplied, true);
assert.strictEqual(noBaselineGate.entryGuards.reason, 'NO_PRIOR_CURVE_PROGRESS');
assert.strictEqual(noBaselineGate.entryGuards.baselineAt, undefined);
assert.strictEqual(noBaselineGate.entryGuards.baselineCurveProgress, undefined);

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'trading-engine.js'),
  'utf8'
);
assert(
  source.includes('shadowBaselineAnchorHeldConstant'),
  'decision-shadow telemetry must emit a value-level baseline invariant'
);
assert(
  source.includes('shadowBaselineSelectedAtMs'),
  'decision-shadow telemetry must emit the selected shadow baseline instant'
);
assert(
  source.includes('baselineAnchorSkewMs'),
  'decision-shadow telemetry must emit baseline-anchor skew'
);
assert(
  /captureCounterfactualContext\(\s*result\.state\.mint,\s*paperLaneOptions\.timestamp,\s*result\.state\s*\)/m.test(source),
  'counterfactual context must capture the actual decision-time curve state'
);

console.log('Helius decision-shadow baseline-anchor smoke passed');
