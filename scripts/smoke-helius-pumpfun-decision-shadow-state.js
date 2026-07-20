#!/usr/bin/env node
'use strict';

const assert = require('assert');
const HeliusDecisionShadowState = require('../src/lib/helius-decision-shadow-state');

const state = new HeliusDecisionShadowState({ pumpMomentumWindowMs: 60_000 });
assert.strictEqual(state.ingest('provider.helius_pumpfun.shadow_trade', {
  mint: 'ignored-non-sol',
  pairBase: 'USDC',
  txType: 'buy',
  solAmount: 1
}, '2026-07-20T01:00:00.000Z'), false);
assert.strictEqual(state.mints.has('ignored-non-sol'), false);
state.ingest('provider.helius_pumpfun.shadow_new_token', {
  mint: 'DecisionMint',
  symbol: 'TEST',
  eventAt: '2026-07-20T01:00:00.000Z',
  receivedAt: '2026-07-20T01:00:00.100Z',
  curveProgress: 0.4
});
state.ingest('provider.helius_pumpfun.shadow_trade', {
  mint: 'DecisionMint',
  receivedAt: '2026-07-20T01:00:10.000Z',
  txType: 'buy',
  solAmount: 1.25,
  traderPublicKey: 'TrackedWallet',
  curveProgress: 0.55,
  priceSol: 0.000001,
  pairBase: 'SOL'
});
state.ingest('provider.helius_pumpfun.shadow_trade', {
  mint: 'DecisionMint',
  receivedAt: '2026-07-20T01:00:20.000Z',
  txType: 'sell',
  solAmount: 0.25,
  traderPublicKey: 'OtherWallet',
  curveProgress: 0.58,
  priceSol: 0.0000012,
  pairBase: 'SOL'
});

const snapshot = state.snapshot({
  portalToken: { mint: 'DecisionMint', createdAt: Date.parse('2026-07-20T01:00:00.000Z') },
  portalState: { mint: 'DecisionMint', symbol: 'TEST', score: 70 },
  timestamp: '2026-07-20T01:00:25.000Z',
  resolveWallet: (wallet) => wallet === 'TrackedWallet'
    ? { watched: true, walletProfile: { name: 'Tracked', profile: 'manual_kol_v1', shadowOnly: false } }
    : { watched: false }
});

assert.strictEqual(snapshot.available, true);
assert.strictEqual(snapshot.state.curveProgress, 0.58);
assert.strictEqual(snapshot.state.recentTradeCount, 2);
assert.strictEqual(snapshot.state.recentBuys, 1);
assert.strictEqual(snapshot.state.recentSells, 1);
assert.strictEqual(snapshot.state.recentVolumeSol, 1.5);
assert.strictEqual(snapshot.state.uniqueBuyerCount, 1);
assert.strictEqual(snapshot.walletContext.touched, true);
assert.deepStrictEqual(snapshot.walletContext.wallets.map((row) => row.wallet), ['TrackedWallet']);
assert.strictEqual(snapshot.walletContext.untrustedWallets.length, 1);

console.log('Helius Pump.fun decision shadow state smoke passed');
