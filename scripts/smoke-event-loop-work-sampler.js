#!/usr/bin/env node
'use strict';

const assert = require('assert');
const EventLoopWorkSampler = require('../src/lib/event-loop-work-sampler');

const sampler = new EventLoopWorkSampler({
  bucketMs: 100,
  maxBuckets: 3,
  maxSamplesPerBucket: 2
});

sampler.record('telemetry.json_serialize', 1000, 3.5, {
  type: 'provider.pumpportal.trade',
  bytes: 120
});
sampler.record('telemetry.json_serialize', 1050, 5.5, {
  type: 'pre_migration.lane_input',
  bytes: 240
});
sampler.record('provider.pumpportal.trade_sync_prefix', 1100, 12, {
  type: 'trade'
});

const measured = sampler.measure('helius.shadow_state_ingest', () => 42, {
  type: 'provider.helius_pumpfun.shadow_trade'
});
assert.strictEqual(measured, 42);

const window = sampler.window(950, 1150);
assert(window, 'work window must be returned for finite bounds');
assert.strictEqual(window.bucketsObserved, 2);
const serialization = window.topPhases.find((row) => row.phase === 'telemetry.json_serialize');
assert.strictEqual(serialization.count, 2);
assert.strictEqual(serialization.totalDurationMs, 9);
assert.strictEqual(serialization.totalBytes, 360);
assert.strictEqual(
  window.topPhases[0].phase,
  'provider.pumpportal.trade_sync_prefix',
  'phases must rank by cumulative synchronous duration'
);

sampler.record('old', 1200, 1);
sampler.record('new', 1300, 1);
assert.strictEqual(sampler.summary().retainedBuckets, 3, 'sampler must retain a bounded bucket ring');
assert.strictEqual(sampler.window(950, 1050).bucketsObserved, 0, 'expired buckets must be removed');

console.log('Event-loop work sampler smoke passed');
