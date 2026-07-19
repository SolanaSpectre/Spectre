#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { analyzeEvents } = require('./helius-pumpfun-recall-autopsy-report');

const startMs = Date.parse('2026-07-20T12:00:00.000Z');
const iso = (offsetMs) => new Date(startMs + offsetMs).toISOString();
const event = (type, offsetMs, payload = {}) => ({ type, timestamp: iso(offsetMs), payload });
const events = [
  event('session.started', 0, {}),
  event('provider.pumpportal.connected', 0, { role: 'tradestream' }),
  event('provider.pumpportal.targeted_subscription', 1_000, { mint: 'AutopsyMint' })
];

for (let index = 0; index < 20; index += 1) {
  const offsetMs = 2_000 + (index < 5 ? index * 10 : index * 1_100);
  const payload = {
    mint: 'AutopsyMint',
    receivedAt: iso(offsetMs),
    pairBase: 'SOL',
    txType: index % 2 ? 'sell' : 'buy',
    solAmount: 0.01,
    traderPublicKey: `PortalWallet${index}`,
    signature: `Signature${index}`
  };
  events.push(event('provider.pumpportal.trade', offsetMs, payload));
  if (index >= 3) {
    events.push(event('provider.helius_pumpfun.shadow_trade', offsetMs + 5, {
      ...payload,
      receivedAt: iso(offsetMs + 5),
      curveModel: 'sol_quote',
      mayhemMode: false,
      logIndex: 1
    }));
  }
}

events.push(event('provider.helius_pumpfun.shadow_trade', 25_500, {
  mint: 'AutopsyMint',
  receivedAt: iso(25_500),
  txType: 'buy',
  solAmount: 0.01,
  traderPublicKey: 'PortalWallet0',
  signature: 'Signature0',
  curveModel: 'sol_quote',
  mayhemMode: false,
  logIndex: 1
}));
events.push(event('provider.helius_pumpfun.shadow_trade', 2_015, {
  mint: 'AutopsyMint',
  receivedAt: iso(2_015),
  txType: 'buy',
  solAmount: 0.01,
  traderPublicKey: 'DifferentWallet',
  signature: 'Signature1',
  curveModel: 'sol_quote',
  mayhemMode: false,
  logIndex: 1
}));
events.push(event('provider.helius_pumpfun.shadow_trade', 2_020, {
  mint: 'OtherMint',
  receivedAt: iso(2_020),
  txType: 'buy',
  solAmount: 0.01,
  traderPublicKey: 'OtherWallet',
  signature: 'OtherSignature',
  curveModel: 'sol_quote',
  mayhemMode: false,
  logIndex: 1
}));
events.push(event('provider.pumpportal.targeted_unsubscription', 25_000, { mint: 'AutopsyMint' }));
events.push(event('provider.pumpportal.closed', 25_000, { role: 'tradestream' }));
events.push(event('session.stopped', 26_000, {}));

const report = analyzeEvents(events);
assert.strictEqual(report.verdict, 'FAILED_RECALL_COHORTS_AUTOPSIED');
assert.strictEqual(report.counts.eligibleMintHourCohorts, 1);
assert.strictEqual(report.counts.failedMintHourCohorts, 1);
assert.strictEqual(report.counts.cohortsWithMisses, 1);
assert.strictEqual(report.counts.portalTradeIdentities, 20);
assert.strictEqual(report.counts.missingPortalTradeIdentities, 3);
assert.strictEqual(report.classifications.COVERAGE_EDGE, 1);
assert.strictEqual(report.classifications.IDENTITY_RESIDUE, 1);
assert.strictEqual(report.classifications.HELIUS_SIGNATURE_ABSENT, 1);
assert.strictEqual(report.absentSignatureClusterClassifications.SELECTIVE_LOSS, 1);
assert.strictEqual(report.coverageEdgeBuckets.LE_1S, 1);
assert.ok(report.burst.thresholdP90 >= 1);
assert.ok(report.burst.highBurstMissingCount >= 1);

const passingEvents = [
  event('session.started', 0, {}),
  event('provider.pumpportal.connected', 0, { role: 'tradestream' }),
  event('provider.pumpportal.targeted_subscription', 500, { mint: 'PassingMint' })
];
for (let index = 0; index < 40; index += 1) {
  const offsetMs = 1_000 + index * 500;
  const payload = {
    mint: 'PassingMint',
    receivedAt: iso(offsetMs),
    pairBase: 'SOL',
    txType: index % 2 ? 'sell' : 'buy',
    solAmount: 0.01,
    traderPublicKey: `PassingWallet${index}`,
    signature: `PassingSignature${index}`
  };
  passingEvents.push(event('provider.pumpportal.trade', offsetMs, payload));
  if (index !== 17) {
    passingEvents.push(event('provider.helius_pumpfun.shadow_trade', offsetMs + 5, {
      ...payload,
      receivedAt: iso(offsetMs + 5),
      curveModel: 'sol_quote',
      mayhemMode: false,
      logIndex: 1
    }));
  }
}
passingEvents.push(event('provider.pumpportal.targeted_unsubscription', 22_000, { mint: 'PassingMint' }));
passingEvents.push(event('provider.pumpportal.closed', 22_000, { role: 'tradestream' }));
passingEvents.push(event('session.stopped', 23_000, {}));

const passingReport = analyzeEvents(passingEvents, 'passing-synthetic');
assert.strictEqual(passingReport.verdict, 'PASSING_RECALL_MISSES_AUTOPSIED');
assert.strictEqual(passingReport.counts.eligibleMintHourCohorts, 1);
assert.strictEqual(passingReport.counts.failedMintHourCohorts, 0);
assert.strictEqual(passingReport.counts.cohortsWithMisses, 1);
assert.strictEqual(passingReport.counts.missingPortalTradeIdentities, 1);
assert.strictEqual(passingReport.cohorts[0].recallGatePassed, true);

console.log('Helius Pump.fun recall autopsy smoke passed');
