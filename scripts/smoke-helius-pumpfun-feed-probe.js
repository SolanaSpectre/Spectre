#!/usr/bin/env node
'use strict';

const assert = require('assert');
const bs58 = require('bs58');
const {
  EVENT_DISCRIMINATORS,
  MIN_TRADE_EVENT_BYTES,
  TRADE_EVENT_DISCRIMINATOR,
  USDC_MINT,
  decodeCompleteEventData,
  decodeCreateEventData,
  decodeMigrationEventData,
  decodePumpEventLog,
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
const invalidBoolTrade = Buffer.from(data);
invalidBoolTrade[56] = 215;
assert.strictEqual(decodePumpEventLog(`Program data: ${invalidBoolTrade.toString('base64')}`), null);

const truncatedTailDecoded = decodePumpTradeEventData(Buffer.concat([data, Buffer.alloc(10, 9)]));
assert.strictEqual(truncatedTailDecoded.tailDecoded, false);
assert.match(truncatedTailDecoded.tailDecodeError, /Borsh buffer exhausted/);
assert.strictEqual(truncatedTailDecoded.curveModel, 'legacy_sol_quote');

const u64 = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
};
const i64 = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(value));
  return buffer;
};
const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
};
const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
};
const key = (fill) => Buffer.alloc(32, fill);
const bool = (value) => Buffer.from([value ? 1 : 0]);
const string = (value) => {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
};

const fullTrade = Buffer.concat([
  TRADE_EVENT_DISCRIMINATOR,
  key(1), u64(0), u64(1200000000), bool(true), key(2), i64(1700000000),
  u64(0), u64(900000000000000), u64(0), u64(700000000000000),
  key(3), u64(100), u64(10), key(4), u64(50), u64(5), bool(true),
  u64(1), u64(2), u64(3), i64(1700000000), string('buy_v2'), bool(false),
  u64(0), u64(0), u64(0), u64(0), u32(1), key(5), u16(2500),
  Buffer.from(bs58.decode(USDC_MINT)), u64(5000000), u64(30000000), u64(20000000)
]);
const fullTradeDecoded = decodePumpTradeEventData(fullTrade);
assert.strictEqual(fullTradeDecoded.tailDecoded, true);
assert.strictEqual(fullTradeDecoded.curveModel, 'usdc_quote');
assert.strictEqual(fullTradeDecoded.quoteMint, USDC_MINT);
assert.strictEqual(fullTradeDecoded.virtualQuoteReserves, '30000000');
assert.deepStrictEqual(fullTradeDecoded.shareholders, [{ address: bs58.encode(key(5)), shareBps: 2500 }]);

const createData = Buffer.concat([
  EVENT_DISCRIMINATORS.CreateEvent,
  string('Test Token'), string('TEST'), string('https://example.invalid/meta.json'),
  key(6), key(7), key(8), key(9), i64(1700000001), u64(900000000000000),
  u64(30000000000), u64(700000000000000), u64(1000000000000000), key(10),
  bool(false), bool(true), Buffer.from(bs58.decode(USDC_MINT)), u64(30000000)
]);
const createDecoded = decodeCreateEventData(createData);
assert.strictEqual(createDecoded.symbol, 'TEST');
assert.strictEqual(createDecoded.curveModel, 'usdc_quote');

const completeData = Buffer.concat([
  EVENT_DISCRIMINATORS.CompleteEvent,
  key(11), key(12), key(13), i64(1700000002), Buffer.from(bs58.decode(USDC_MINT))
]);
assert.strictEqual(decodeCompleteEventData(completeData).mint, bs58.encode(key(12)));

const migrationData = Buffer.concat([
  EVENT_DISCRIMINATORS.CompletePumpAmmMigrationEvent,
  key(14), key(15), u64(100), u64(200), u64(3), key(16), i64(1700000003),
  key(17), Buffer.from(bs58.decode(USDC_MINT))
]);
assert.strictEqual(decodeMigrationEventData(migrationData).pool, bs58.encode(key(17)));

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
