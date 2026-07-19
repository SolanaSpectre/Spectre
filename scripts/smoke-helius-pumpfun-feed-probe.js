#!/usr/bin/env node
'use strict';

const assert = require('assert');
const bs58 = require('bs58');
const {
  MIN_TRADE_EVENT_BYTES,
  TRADE_EVENT_DISCRIMINATOR,
  decodePumpTradeEventData,
  decodePumpTradeEventLog
} = require('../src/lib/pump-trade-event-decoder');
const {
  PREREGISTERED,
  assessReport,
  buildSubscriptionRequest,
  creditAssessment,
  extractNotificationError,
  extractLogs,
  normalizeLegacyReserveMetrics,
  sanitizeUrl
} = require('./probe-helius-pumpfun-feed');

const data = Buffer.alloc(MIN_TRADE_EVENT_BYTES);
TRADE_EVENT_DISCRIMINATOR.copy(data, 0);
Buffer.alloc(32, 1).copy(data, 8);
data.writeBigUInt64LE(500000000n, 40);
data.writeBigUInt64LE(1200000000n, 48);
data[56] = 1;
Buffer.alloc(32, 2).copy(data, 57);
data.writeBigInt64LE(1700000000n, 89);
data.writeBigUInt64LE(30000000000n, 97);
data.writeBigUInt64LE(900000000000000n, 105);
data.writeBigUInt64LE(20000000000n, 113);
data.writeBigUInt64LE(700000000000000n, 121);

const decoded = decodePumpTradeEventData(data);
assert.strictEqual(decoded.mint, bs58.encode(Buffer.alloc(32, 1)));
assert.strictEqual(decoded.user, bs58.encode(Buffer.alloc(32, 2)));
assert.strictEqual(decoded.isBuy, true);
assert.strictEqual(decoded.solAmount, '500000000');
assert.strictEqual(decoded.virtualSolReserves, '30000000000');
assert.strictEqual(decoded.realTokenReserves, '700000000000000');
assert.deepStrictEqual(decodePumpTradeEventLog(`Program data: ${data.toString('base64')}`), decoded);

const txRequest = buildSubscriptionRequest(
  PREREGISTERED.arms.transactionConfirmed,
  1,
  'PumpProgram'
);
assert.strictEqual(txRequest.method, 'transactionSubscribe');
assert.deepStrictEqual(txRequest.params[0].accountInclude, ['PumpProgram']);
assert.strictEqual(txRequest.params[1].commitment, 'confirmed');

const logsRequest = buildSubscriptionRequest(PREREGISTERED.arms.logsProcessed, 2, 'PumpProgram');
assert.strictEqual(logsRequest.method, 'logsSubscribe');
assert.deepStrictEqual(logsRequest.params[0].mentions, ['PumpProgram']);
assert.strictEqual(logsRequest.params[1].commitment, 'processed');

assert.deepStrictEqual(
  extractLogs({ params: { result: { value: { logs: ['a'] } } } }),
  ['a']
);
assert.strictEqual(extractNotificationError({ params: { result: { value: { err: null } } } }), null);
assert.deepStrictEqual(
  extractNotificationError({ params: { result: { value: { err: { InstructionError: [1, 'x'] } } } } }),
  { InstructionError: [1, 'x'] }
);
assert.strictEqual(
  sanitizeUrl('wss://mainnet.helius-rpc.com/?api-key=secret'),
  'wss://mainnet.helius-rpc.com/?api-key=<redacted>'
);

const baseArm = {
  openEvents: 1,
  subscriptionErrors: [],
  reconnects: 0,
  totalGapMs: 0,
  notifications: 25000,
  tradeEventCandidates: 100,
  decodedTradeEvents: 100,
  tradeDecodePct: 100,
  curveReserveCoveragePct: 100,
  bytes: 1000000,
  tradeLatencyMs: { p90: 800 }
};
const passingReport = {
  durationMs: 1800000,
  arms: {
    transactionConfirmed: { ...baseArm, name: 'transactionConfirmed' },
    logsProcessed: { ...baseArm, name: 'logsProcessed' }
  },
  eventLoopLagMs: { p99: 5 }
};
assert.strictEqual(assessReport(passingReport).verdict, 'INCONCLUSIVE_REVISE_AND_REPROBE');
assert.strictEqual(assessReport(passingReport, 50000).verdict, 'PASS_BUILD_HELIUS_ADAPTER');
assert.strictEqual(creditAssessment(passingReport, 500000).verdict, 'CREDIT_BUDGET_FAIL');

const legacyReport = {
  arms: {
    logsProcessed: {
      decodedTradeEvents: 100,
      curveReserveCoveragePct: 97.5
    }
  }
};
assert.deepStrictEqual(normalizeLegacyReserveMetrics(legacyReport), ['logsProcessed']);
assert.strictEqual(legacyReport.arms.logsProcessed.curveReserveFieldCoveragePct, 100);
assert.strictEqual(legacyReport.arms.logsProcessed.positiveLegacySolReserveCoveragePct, 97.5);

console.log('Helius Pump.fun feed probe smoke passed');
