#!/usr/bin/env node
'use strict';

const assert = require('assert');
const HeliusPumpfunShadowListener = require('../src/helius-pumpfun-shadow-listener');
const { NATIVE_SOL_MINT, USDC_MINT, WRAPPED_SOL_MINT } = require('../src/lib/pump-trade-event-decoder');

const events = [];
const listener = new HeliusPumpfunShadowListener({
  heliusPumpfunShadowEnabled: false,
  heliusStandardWebsocketUrl: 'wss://example.invalid',
  pumpBondingCurveProgramId: 'PumpProgram',
  heliusPumpfunShadowCommitment: 'processed'
}, {
  info() {},
  warn() {}
}, {
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

console.log('Helius Pump.fun shadow listener smoke passed');
