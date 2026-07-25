#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Telemetry = require('../src/telemetry');

const previousMax = process.env.TELEMETRY_MAX_RECENT_EVENTS;
process.env.TELEMETRY_MAX_RECENT_EVENTS = '3';

try {
  const telemetry = new Telemetry(
    { telemetryEnabled: false },
    { error() {}, warn() {}, info() {} }
  );

  for (let index = 1; index <= 5; index += 1) {
    telemetry.record('smoke.event', { index });
  }
  telemetry.recordInternal('smoke.internal', { index: 6 });

  assert.strictEqual(telemetry.events.length, 3);
  assert.deepStrictEqual(
    telemetry.events.map((event) => event.payload.index).sort((a, b) => a - b),
    [4, 5, 6]
  );
  assert.strictEqual(telemetry.totalEventsRecorded, 6);
  assert.strictEqual(telemetry.getSummary().recentEventRetention, 'ring_buffer');
} finally {
  if (previousMax === undefined) {
    delete process.env.TELEMETRY_MAX_RECENT_EVENTS;
  } else {
    process.env.TELEMETRY_MAX_RECENT_EVENTS = previousMax;
  }
}

console.log('Telemetry recent-event retention smoke passed');
