#!/usr/bin/env node
'use strict';

const assert = require('assert');
const HeliusPumpfunShadowListener = require('../src/helius-pumpfun-shadow-listener');
const {
  MIN_TRADE_EVENT_BYTES,
  NATIVE_SOL_MINT,
  TRADE_EVENT_DISCRIMINATOR,
  USDC_MINT,
  WRAPPED_SOL_MINT
} = require('../src/lib/pump-trade-event-decoder');

const events = [];
const lifecycleEvents = [];
const listener = new HeliusPumpfunShadowListener({
  heliusPumpfunShadowEnabled: false,
  heliusStandardWebsocketUrl: 'wss://example.invalid',
  pumpBondingCurveProgramId: 'PumpProgram',
  heliusPumpfunShadowCommitment: 'processed'
}, {
  info() {},
  warn() {}
}, {
  onLifecycle(type, payload) {
    lifecycleEvents.push({ type, payload });
  },
  onShadowEvent(type, payload) {
    events.push({ type, payload });
  }
});

const normalized = listener.normalizeTrade({
  eventType: 'TradeEvent',
  mint: 'Mint',
  user: 'Wallet',
  isBuy: true,
  timestamp: '1700000000',
  quoteMint: WRAPPED_SOL_MINT,
  curveModel: 'sol_quote',
  tokenAmount: '1000000',
  solAmount: '500000000',
  quoteAmount: '500000000',
  virtualTokenReserves: '900000000000000',
  virtualQuoteReserves: '30000000000',
  virtualSolReserves: '30000000000',
  tailDecoded: true,
  tailDecodeError: null,
  decodedBytes: 300,
  totalBytes: 300
}, {
  signature: 'Signature',
  slot: 1,
  receivedAt: '2026-07-19T00:00:00.000Z'
});
assert.strictEqual(normalized.txType, 'buy');
assert.strictEqual(normalized.solAmount, 0.5);
assert.strictEqual(normalized.quoteMint, WRAPPED_SOL_MINT);
assert.strictEqual(normalized.pairBase, 'SOL');
assert.strictEqual(normalized.curveProgress, 0.3799);

const nativeSol = listener.normalizeTrade({
  ...normalized,
  eventType: 'TradeEvent',
  quoteMint: NATIVE_SOL_MINT,
  curveModel: 'sol_quote',
  quoteAmount: '500000000',
  virtualQuoteReserves: '30000000000',
  virtualTokenReserves: '900000000000000',
  tokenAmount: '1000000',
  solAmount: '500000000',
  timestamp: '1700000000',
  isBuy: true,
  user: 'Wallet',
  mint: 'Mint',
  tailDecoded: true
}, {
  signature: 'NativeSignature',
  slot: 2,
  receivedAt: '2026-07-19T00:00:00.500Z'
});
assert.strictEqual(nativeSol.pairBase, 'SOL');
assert.strictEqual(nativeSol.solAmount, 0.5);
assert.strictEqual(nativeSol.mayhemMode, null);

const mayhem = listener.normalizeTrade({
  ...nativeSol,
  eventType: 'TradeEvent',
  quoteMint: NATIVE_SOL_MINT,
  curveModel: 'sol_quote',
  solAmount: '500000000',
  virtualSolReserves: '30000000000',
  virtualTokenReserves: '900000000000000',
  tokenAmount: '1000000',
  timestamp: '1700000000',
  isBuy: true,
  user: 'Wallet',
  mint: 'Mint',
  tailDecoded: true,
  mayhemMode: true,
  ixName: 'buy'
}, {
  signature: 'MayhemSignature',
  slot: 3,
  receivedAt: '2026-07-19T00:00:01.000Z'
});
assert.strictEqual(mayhem.mayhemMode, true);
assert.strictEqual(mayhem.ixName, 'buy');

const usdc = listener.normalizeTrade({
  ...normalized,
  eventType: 'TradeEvent',
  quoteMint: USDC_MINT,
  curveModel: 'usdc_quote',
  quoteAmount: '5000000',
  virtualQuoteReserves: '30000000',
  virtualTokenReserves: '900000000000000',
  tokenAmount: '1000000',
  solAmount: '0',
  timestamp: '1700000000',
  isBuy: true,
  user: 'Wallet',
  mint: 'Mint',
  tailDecoded: true
}, {
  signature: 'Signature2',
  slot: 2,
  receivedAt: '2026-07-19T00:00:01.000Z'
});
assert.strictEqual(usdc.solAmount, null);
assert.strictEqual(usdc.quoteAmount, 5);
assert.strictEqual(usdc.pairBase, 'USDC');

listener.handleDecodedEvent({
  eventType: 'CompleteEvent',
  mint: 'Mint',
  timestamp: '1700000000'
}, { signature: 'CompleteSig', slot: 3, receivedAt: '2026-07-19T00:00:02.000Z' });
assert.strictEqual(events[0].type, 'provider.helius_pumpfun.shadow_complete');
assert.strictEqual(events[0].payload.reportOnly, true);
assert.strictEqual(listener.getStats().strategyConsumptionEnabled, false);

const invalidBoolTrade = Buffer.alloc(MIN_TRADE_EVENT_BYTES);
TRADE_EVENT_DISCRIMINATOR.copy(invalidBoolTrade, 0);
invalidBoolTrade[56] = 215;
listener.handleRawMessage(Buffer.from(JSON.stringify({
  method: 'logsNotification',
  params: {
    result: {
      context: { slot: 4 },
      value: {
        signature: 'InvalidBoolSignature',
        err: null,
        logs: [
          'Program PumpProgram invoke [1]',
          `Program data: ${invalidBoolTrade.toString('base64')}`,
          'Program PumpProgram success'
        ]
      }
    }
  }
})));
assert.strictEqual(listener.getStats().tradeDecodeErrors, 1);
assert.strictEqual(lifecycleEvents[0].type, 'provider.helius_pumpfun.shadow_decode_error');
assert.strictEqual(lifecycleEvents[0].payload.dataLength, MIN_TRADE_EVENT_BYTES);
assert.strictEqual(lifecycleEvents[0].payload.rawDataBase64, invalidBoolTrade.toString('base64'));
assert.strictEqual(lifecycleEvents[0].payload.rawDataTruncated, false);

const capturedForeignCollision = 'vdt/007mYe6tPHB4hrHrMVE/eGnGi2C/82Qd6gfKkWZsUGQoVywdJAB4xftR0QIA3nQOPunPAwDXrzD8BgAAABb6w2pqqQAAo2yidwEAAABYN7lWXcIAAL+KtbwBAAAAt8LORQAAAABCPfXr8hgAAEqtLAAAAAAA3AeGAAAAAAB17wgAAAAAAAAAAAAAAAAAAAAB';
listener.handleRawMessage(Buffer.from(JSON.stringify({
  method: 'logsNotification',
  params: {
    result: {
      context: { slot: 5 },
      value: {
        signature: 'QJUfcA66PfnoubgE68V21dSxHWHSg7j17Hxy93x9vmiCYowvBbBJyvcT7tNZ6Bx16j1oC4V9GN7uTfbUtfEou4H',
        err: null,
        logs: [
          'Program PumpProgram invoke [1]',
          'Program LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj invoke [2]',
          `Program data: ${capturedForeignCollision}`,
          'Program LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj success',
          'Program PumpProgram success'
        ]
      }
    }
  }
})));
assert.strictEqual(listener.getStats().tradeDecodeErrors, 1);
assert.strictEqual(listener.getStats().tradeDiscriminatorCollisions, 1);
assert.strictEqual(listener.getStats().foreignProgramDataLines, 1);
assert.strictEqual(lifecycleEvents[1].type, 'provider.helius_pumpfun.shadow_discriminator_collision_ignored');
assert.strictEqual(lifecycleEvents[1].payload.emittingProgramId, 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj');

listener.handleRawMessage(Buffer.from(JSON.stringify({
  method: 'logsNotification',
  params: {
    result: {
      context: { slot: 5 },
      value: {
        signature: 'QJUfcA66PfnoubgE68V21dSxHWHSg7j17Hxy93x9vmiCYowvBbBJyvcT7tNZ6Bx16j1oC4V9GN7uTfbUtfEou4H',
        err: null,
        logs: []
      }
    }
  }
})));
assert.strictEqual(listener.getStats().duplicateNotifications, 1);

listener.connectionEpoch = 2;
listener.activeSubscriptionRequestId = 7102;
listener.currentEpochOpenedAtMs = Date.now() - 100;
listener.startTransportGap(1, Date.now() - 75);
listener.handleRawMessage(Buffer.from(JSON.stringify({
  jsonrpc: '2.0',
  id: 7102,
  result: 444
})), Date.now(), null, {
  connectionEpoch: 2,
  subscriptionRequestId: 7102
});
const ack = lifecycleEvents.find((row) => row.type === 'provider.helius_pumpfun.shadow_subscription_ack');
const recoveredGap = lifecycleEvents.find(
  (row) => row.type === 'provider.helius_pumpfun.shadow_transport_gap_closed'
);
assert(ack);
assert.strictEqual(ack.payload.connectionEpoch, 2);
assert.strictEqual(ack.payload.subscriptionId, 444);
assert(recoveredGap);
assert(recoveredGap.payload.durationMs >= 75);
assert.strictEqual(listener.getTransportStatus().subscriptionReady, true);
assert.strictEqual(listener.getTransportStatus().transportGapActive, false);
assert.strictEqual(listener.getStats().activeSubscriptionRequestId, null);
const ackCount = listener.getStats().subscriptionAcks;
listener.handleRawMessage(Buffer.from(JSON.stringify({
  jsonrpc: '2.0',
  id: 7102,
  result: 444
})), Date.now(), null, {
  connectionEpoch: 2,
  subscriptionRequestId: 7102
});
assert.strictEqual(listener.getStats().subscriptionAcks, ackCount);
assert.strictEqual(listener.getStats().staleSubscriptionResponses, 1);

console.log('Helius Pump.fun shadow listener smoke passed');
