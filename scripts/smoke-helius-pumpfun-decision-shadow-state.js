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

const accountEnriched = state.snapshot({
  portalToken: { mint: 'DecisionMint' },
  portalState: { mint: 'DecisionMint', score: 70 },
  accountState: {
    receivedAtMs: Date.parse('2026-07-20T01:01:24.500Z'),
    curveProgress: 0.72,
    priceSol: 0.0000018
  },
  timestamp: '2026-07-20T01:01:25.000Z'
});
assert.strictEqual(accountEnriched.available, true);
assert.strictEqual(accountEnriched.accountEnriched, true);
assert.strictEqual(accountEnriched.curveStateSource, 'finalist_account_verifier');
assert.strictEqual(accountEnriched.ageMs, 500);
assert.strictEqual(accountEnriched.state.curveProgress, 0.72);
assert.strictEqual(accountEnriched.state.recentTradeCount, 0);
assert.strictEqual(accountEnriched.recentTapeCaptured, false);

const olderAccount = state.snapshot({
  portalToken: { mint: 'DecisionMint' },
  portalState: { mint: 'DecisionMint', score: 70 },
  accountState: {
    receivedAtMs: Date.parse('2026-07-20T01:00:15.000Z'),
    curveProgress: 0.9,
    priceSol: 0.000003
  },
  timestamp: '2026-07-20T01:00:25.000Z'
});
assert.strictEqual(olderAccount.accountEnriched, false);
assert.strictEqual(olderAccount.curveStateSource, 'helius_pump_trade_event_virtual_token_reserves');
assert.strictEqual(olderAccount.state.curveProgress, 0.58);

const futureAccount = state.snapshot({
  portalToken: { mint: 'DecisionMint' },
  portalState: { mint: 'DecisionMint', score: 70 },
  accountState: {
    receivedAtMs: Date.parse('2026-07-20T01:00:30.000Z'),
    curveProgress: 0.99,
    priceSol: 0.000004
  },
  timestamp: '2026-07-20T01:00:25.000Z'
});
assert.strictEqual(futureAccount.accountEnriched, false);
assert.strictEqual(futureAccount.state.curveProgress, 0.58);

state.ingestPortalTradeIdentity({
  mint: 'DecisionMint',
  signature: 'aliased-signature',
  trader: 'PortalRuntimeWallet',
  receivedAt: '2026-07-20T01:01:29.000Z'
});
state.ingest('provider.helius_pumpfun.shadow_trade', {
  mint: 'DecisionMint',
  signature: 'aliased-signature',
  receivedAt: '2026-07-20T01:01:30.000Z',
  txType: 'buy',
  solAmount: 0.5,
  traderPublicKey: 'OnchainEventUser',
  curveProgress: 0.73,
  priceSol: 0.0000019,
  pairBase: 'SOL'
});
const aliased = state.snapshot({
  portalToken: { mint: 'DecisionMint' },
  portalState: { mint: 'DecisionMint', score: 70 },
  timestamp: '2026-07-20T01:01:31.000Z',
  resolveWallet: (wallet) => ({ watched: wallet === 'PortalRuntimeWallet' })
});
assert.deepStrictEqual(aliased.walletContext.wallets.map((row) => row.wallet), ['PortalRuntimeWallet']);
assert.strictEqual(aliased.walletContext.portalSignatureAliasTradeCount, 1);

const rewrite = new HeliusDecisionShadowState({ pumpMomentumWindowMs: 60_000 });
rewrite.ingest('provider.helius_pumpfun.shadow_trade', {
  mint: 'RewriteMint',
  signature: 'rewrite-signature',
  receivedAt: '2026-07-20T01:02:00.000Z',
  txType: 'buy',
  solAmount: 0.5,
  traderPublicKey: 'OriginalEventUser',
  curveProgress: 0.5,
  priceSol: 0.000001,
  pairBase: 'SOL'
});
rewrite.ingestPortalTradeIdentity({
  mint: 'RewriteMint',
  signature: 'rewrite-signature',
  trader: 'LatePortalRuntimeWallet',
  receivedAt: '2026-07-20T01:02:00.100Z'
});
const rewritten = rewrite.snapshot({
  portalToken: { mint: 'RewriteMint' },
  portalState: { mint: 'RewriteMint' },
  timestamp: '2026-07-20T01:02:01.000Z',
  resolveWallet: (wallet) => ({ watched: wallet === 'LatePortalRuntimeWallet' })
});
assert.deepStrictEqual(rewritten.walletContext.wallets.map((row) => row.wallet), ['LatePortalRuntimeWallet']);
assert.strictEqual(rewritten.walletContext.portalSignatureAliasTradeCount, 1);

const accountOnly = new HeliusDecisionShadowState({ pumpMomentumWindowMs: 60_000 }).snapshot({
  portalToken: { mint: 'AccountOnlyMint' },
  portalState: { mint: 'AccountOnlyMint' },
  accountState: {
    receivedAtMs: Date.parse('2026-07-20T01:03:00.000Z'),
    curveProgress: 0.42,
    priceSol: 0.000001
  },
  timestamp: '2026-07-20T01:03:00.500Z'
});
assert.strictEqual(accountOnly.available, true);
assert.strictEqual(accountOnly.accountEnriched, true);
assert.strictEqual(accountOnly.state.recentTradeCount, 0);

const capped = new HeliusDecisionShadowState({ pumpMomentumWindowMs: 60_000 });
for (let index = 0; index < 250; index += 1) {
  capped.ingest('provider.helius_pumpfun.shadow_trade', {
    mint: 'CapMint',
    signature: `cap-${index}`,
    receivedAt: Date.parse('2026-07-20T02:00:00.000Z') + index,
    txType: index % 2 ? 'sell' : 'buy',
    solAmount: 0.01,
    traderPublicKey: `Wallet${index}`,
    curveProgress: 0.5,
    priceSol: 0.000001,
    pairBase: 'SOL'
  });
}
const cappedSnapshot = capped.snapshot({
  portalToken: { mint: 'CapMint' },
  portalState: { mint: 'CapMint' },
  timestamp: Date.parse('2026-07-20T02:00:01.000Z')
});
assert.strictEqual(cappedSnapshot.state.recentTradeCount, 201);
assert.strictEqual(cappedSnapshot.recentTradeCap, 201);

const walletWindow = new HeliusDecisionShadowState({ pumpMomentumWindowMs: 60_000 });
for (let index = 0; index < 120; index += 1) {
  walletWindow.ingest('provider.helius_pumpfun.shadow_trade', {
    mint: 'WalletWindowMint',
    signature: `wallet-window-${index}`,
    receivedAt: Date.parse('2026-07-20T03:00:00.000Z') + index,
    txType: 'buy',
    solAmount: 0.01,
    traderPublicKey: index % 2 === 0 ? `Tracked${index}` : `Untrusted${index}`,
    curveProgress: 0.5,
    priceSol: 0.000001,
    pairBase: 'SOL'
  });
}
const walletWindowSnapshot = walletWindow.snapshot({
  portalToken: { mint: 'WalletWindowMint' },
  portalState: { mint: 'WalletWindowMint' },
  timestamp: Date.parse('2026-07-20T03:00:01.000Z'),
  resolveWallet: (wallet) => ({
    watched: wallet.startsWith('Tracked'),
    walletProfile: wallet.startsWith('Tracked')
      ? { name: wallet, profile: 'manual_kol_v1', shadowOnly: false }
      : null
  })
});
assert.strictEqual(walletWindowSnapshot.walletContext.observedWalletTradeCount, 50);
assert.strictEqual(walletWindowSnapshot.walletContext.observedUntrustedWalletTradeCount, 50);
assert.strictEqual(walletWindowSnapshot.walletContext.wallets.length, 8);
assert.strictEqual(walletWindowSnapshot.walletContext.untrustedWallets.length, 12);
assert.strictEqual(walletWindowSnapshot.walletContext.wallets[0].wallet, 'Tracked0');
assert.strictEqual(walletWindowSnapshot.walletContext.untrustedWallets[0].wallet, 'Untrusted1');
assert.strictEqual(
  walletWindowSnapshot.walletContext.contextSource,
  'earliest_50_tracked_and_earliest_50_untrusted_with_signature_aliases'
);

const durableWalletEvidence = new HeliusDecisionShadowState({ pumpMomentumWindowMs: 60_000 });
durableWalletEvidence.ingest('provider.helius_pumpfun.shadow_trade', {
  mint: 'DurableWalletMint',
  signature: 'early-tracked',
  receivedAt: '2026-07-20T04:00:00.000Z',
  txType: 'buy',
  solAmount: 0.25,
  traderPublicKey: 'DurableTrackedWallet',
  curveProgress: 0.2,
  priceSol: 0.0000005,
  pairBase: 'SOL'
});
durableWalletEvidence.ingest('provider.helius_pumpfun.shadow_trade', {
  mint: 'DurableWalletMint',
  signature: 'later-untrusted',
  receivedAt: '2026-07-20T04:06:00.000Z',
  txType: 'buy',
  solAmount: 0.25,
  traderPublicKey: 'LaterUntrustedWallet',
  curveProgress: 0.7,
  priceSol: 0.000001,
  pairBase: 'SOL'
});
const durableWalletSnapshot = durableWalletEvidence.snapshot({
  portalToken: { mint: 'DurableWalletMint' },
  portalState: { mint: 'DurableWalletMint', curveProgress: 0.7 },
  timestamp: '2026-07-20T04:06:01.000Z',
  resolveWallet: (wallet) => ({ watched: wallet === 'DurableTrackedWallet' })
});
assert.strictEqual(durableWalletSnapshot.state.recentTradeCount, 1);
assert.strictEqual(durableWalletSnapshot.walletContext.touched, true);
assert.strictEqual(durableWalletSnapshot.walletContext.wallets[0].wallet, 'DurableTrackedWallet');

console.log('Helius Pump.fun decision shadow state smoke passed');
