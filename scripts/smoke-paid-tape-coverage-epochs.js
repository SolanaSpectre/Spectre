#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanTelemetryCoverage } = require('./lib/paid-tape-coverage-epochs');
const { coverageVerdict } = require('./paid-tape-coverage-epoch-report');

function writeTelemetry(rows) {
  const filePath = path.join(os.tmpdir(), `spectre-paid-tape-coverage-${process.pid}-${Math.random()}.jsonl`);
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return filePath;
}

const start = {
  type: 'session.started',
  timestamp: '2026-07-19T12:00:00.000Z',
  payload: { pumpPortalPaidTapePlan: { tradeSubscriptionMode: 'targeted_curve' } }
};
const stop = { type: 'session.stopped', timestamp: '2026-07-19T13:00:00.000Z', payload: {} };

const emptyPath = writeTelemetry([start, stop]);
const activePath = writeTelemetry([
  start,
  { type: 'provider.pumpportal.targeted_subscription', timestamp: '2026-07-19T12:01:00.000Z', payload: { mint: 'A' } },
  { type: 'provider.pumpportal.trade', timestamp: '2026-07-19T12:01:01.000Z', payload: { mint: 'A' } },
  { ...stop, payload: { stats: { pumpPortal: { targetedTradeSubscriptionAccepted: 1, targetedTradeSubscriptionAcked: 1, trades: 1 } } } }
]);
const unacknowledgedPath = writeTelemetry([
  start,
  { type: 'provider.pumpportal.targeted_subscription', timestamp: '2026-07-19T12:01:00.000Z', payload: { mint: 'A' } },
  stop
]);
const rejectedPath = writeTelemetry([
  start,
  { type: 'provider.pumpportal.targeted_subscription', timestamp: '2026-07-19T12:01:00.000Z', payload: { mint: 'A' } },
  { type: 'provider.pumpportal.targeted_subscription_rejected', timestamp: '2026-07-19T12:01:00.100Z', payload: { message: 'paid stream unavailable' } },
  stop
]);

try {
  const empty = scanTelemetryCoverage(emptyPath);
  assert.strictEqual(empty.paidTapeActivated, false);
  assert.strictEqual(empty.targetedTradeSubscriptionsAccepted, 0);
  assert.strictEqual(empty.fullPaidTapeMinutes, 0);
  assert.strictEqual(empty.potentialFullPaidTapeMinutes, 60);
  assert.strictEqual(coverageVerdict(empty), 'NO_ACTIVE_TARGETED_PAID_TAPE');

  const active = scanTelemetryCoverage(activePath);
  assert.strictEqual(active.paidTapeActivated, true);
  assert.strictEqual(active.targetedTradeSubscriptionsAccepted, 1);
  assert.strictEqual(active.targetedTradeSubscriptionAcks, 1);
  assert.strictEqual(active.pumpPortalTradeEvents, 1);
  assert.strictEqual(active.fullPaidTapeMinutes, 60);
  assert.strictEqual(coverageVerdict(active), 'FULL_SESSION_PAID_TAPE');

  const unacknowledged = scanTelemetryCoverage(unacknowledgedPath);
  assert.strictEqual(unacknowledged.paidTapeActivated, false);
  assert.strictEqual(unacknowledged.fullPaidTapeMinutes, 0);
  assert.strictEqual(coverageVerdict(unacknowledged), 'TARGETED_PAID_TAPE_UNACKNOWLEDGED');

  const rejected = scanTelemetryCoverage(rejectedPath);
  assert.strictEqual(rejected.targetedTradeSubscriptionRejections, 1);
  assert.strictEqual(rejected.fullPaidTapeMinutes, 0);
  assert.strictEqual(coverageVerdict(rejected), 'TARGETED_PAID_TAPE_REJECTED');
} finally {
  fs.rmSync(emptyPath, { force: true });
  fs.rmSync(activePath, { force: true });
  fs.rmSync(unacknowledgedPath, { force: true });
  fs.rmSync(rejectedPath, { force: true });
}

console.log('Paid-tape coverage epoch smoke passed');
