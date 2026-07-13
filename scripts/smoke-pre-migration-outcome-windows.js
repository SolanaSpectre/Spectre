#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  buildOutcomeWindow,
  buildPreDecisionContext,
  snapshotFromEvent
} = require('./lib/pre-migration-outcome-windows');

const mint = 'SmokeMint111111111111111111111111111111111111';
const attempt = {
  mint,
  atMs: Date.parse('2026-07-13T10:00:00.000Z'),
  curveProgress: 0.3,
  priceSol: 0.00000003
};
const touch = {
  tradeAt: '2026-07-13T09:59:00.000Z',
  curveProgress: 0.6
};
const events = [
  { type: 'provider.pumpdev.shadow_trade', payload: { mint, timestamp: '2026-07-13T09:59:00.000Z', curveProgress: 0.6, priceSol: 0.00000006 } },
  { type: 'provider.pumpdev.shadow_trade', payload: { mint, timestamp: '2026-07-13T10:00:05.000Z', curveProgress: 0.31, priceSol: 0.000000031 } },
  { type: 'provider.pumpdev.shadow_trade', payload: { mint, timestamp: '2026-07-13T10:00:20.000Z', curveProgress: 0.32, priceSol: 0.000000032 } }
];
const snapshots = events.map(snapshotFromEvent).filter(Boolean);

const preDecision = buildPreDecisionContext(attempt, snapshots, touch);
assert.strictEqual(preDecision.joined, true);
assert.strictEqual(preDecision.fadedFromTouchBeforeDecision, true);
assert.strictEqual(preDecision.maxCurveProgress, 0.6);

const window30s = buildOutcomeWindow(attempt, snapshots, 30, { referenceTouch: touch });
assert.strictEqual(window30s.outcomeJoined, true);
assert.strictEqual(window30s.maxCurveProgress, 0.32);
assert.strictEqual(window30s.touchCurveAboveWindowMax, true);
assert.strictEqual(window30s.priceJoinStatus, 'OK');
assert.strictEqual(window30s.maxPriceDeltaPct, 6.6667);

console.log('pre-migration outcome window smoke passed');
