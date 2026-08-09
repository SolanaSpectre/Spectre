#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { classifyHeliusRuntimeEvent } = require('../src/lib/helius-runtime-event-queue');
const {
  isPumpFamilySource,
  isPumpFamilyToken,
  summarizePumpFamilyMomentum
} = require('../src/lib/pump-family-token');

[
  'pumpportal_trade',
  'pumpdev_trade',
  'pumpfun_runtime_trade',
  'helius_logs_create_runtime',
  'helius_logs_trade_runtime',
  'helius_pumpfun_runtime_trade'
].forEach((source) => assert.strictEqual(isPumpFamilySource(source), true, source));

[
  'raydium',
  'meteora',
  'helius_generic_token',
  'helius_logs_trade_shadow',
  'helius_pumpfun_shadow_trade',
  'helius_pumpfun_decision_shadow'
].forEach((source) => {
  assert.strictEqual(isPumpFamilySource(source), false, source);
});

assert.strictEqual(isPumpFamilyToken({ source: 'helius_logs_trade_runtime' }), true);
assert.strictEqual(isPumpFamilyToken({ raw: { source: 'helius_logs_create_runtime' } }), true);
assert.strictEqual(isPumpFamilyToken({ source: 'raydium' }), false);

const mapped = classifyHeliusRuntimeEvent('provider.helius_pumpfun.shadow_trade', {
  mint: 'Mint111111111111111111111111111111111111111',
  txType: 'buy',
  solAmount: 1.25
});
assert(mapped, 'Helius runtime trade must map');
assert.strictEqual(mapped.event.source, 'helius_logs_trade_runtime');
assert.strictEqual(isPumpFamilyToken(mapped.event), true);

const now = 1_000_000;
const summary = summarizePumpFamilyMomentum({
  createdAt: now - 120_000,
  tradeWindow: [
    { timestamp: now - 70_000, side: 'buy', volumeSol: 99 },
    { timestamp: now - 50_000, side: 'buy', volumeSol: 0.75 },
    { timestamp: now - 20_000, side: 'sell', volumeSol: 0.25 },
    { timestamp: now - 5_000, side: 'buy', volumeSol: 1.5 }
  ]
}, 60_000, now);
assert.deepStrictEqual(summary, {
  recentBuys: 2,
  recentSells: 1,
  recentTradeCount: 3,
  recentVolumeSol: 2.5,
  tradeVelocityPerMin: 3,
  tokenAgeSeconds: 120
});

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine.js'), 'utf8');
assert(!engineSource.includes('isPumpPortalToken'), 'vendor-specific Pump classifier must not return');
assert(!engineSource.includes('summarizePumpPortalMomentum'), 'vendor-specific momentum helper must not return');
assert(engineSource.includes('pumpFamilyClassified: isPumpFamilyToken(current)'));
assert(engineSource.includes('recentVolumeSol: Number(current.recentVolumeSol || 0)'));
assert(engineSource.includes('tradeVelocityPerMin: Number(current.tradeVelocityPerMin || 0)'));

console.log('Pump-family provider semantics smoke passed');
