#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  PREREGISTERED,
  analyzeEvents,
  latestAtOrBefore,
  nearestByTime,
  timestampMs
} = require('./helius-pumpfun-shadow-parity-report');

const startMs = Date.parse('2026-07-20T12:00:00.000Z');
const iso = (offsetMs) => new Date(startMs + offsetMs).toISOString();
const event = (type, timestamp, payload) => ({ type, timestamp, payload });
const events = [event('session.started', iso(0), {
  heliusPumpfunShadowPlan: {
    enabled: true,
    reportOnly: true,
    strategyConsumptionEnabled: false,
    commitment: 'processed'
  }
})];
events.push(event('provider.helius_pumpfun.shadow_connected', iso(1), {
  commitment: 'processed'
}));
events.push(event('provider.helius_pumpfun.shadow_disconnected', iso(3_598_999), {
  code: 1000,
  reason: 'shadow listener stop'
}));
events.push(event('session.stopped', iso(3_599_000), { reason: 'SESSION_DURATION_EXCEEDED' }));

for (let mintIndex = 0; mintIndex < 20; mintIndex += 1) {
  const mint = `Mint${mintIndex}`;
  events.push(event('provider.pumpportal.new_token', iso(1000 + mintIndex), {
    mint,
    receivedAt: iso(1000 + mintIndex)
  }));
  events.push(event('provider.helius_pumpfun.shadow_new_token', iso(1100 + mintIndex), {
    mint,
    receivedAt: iso(1100 + mintIndex),
    curveModel: 'sol_quote'
  }));
  for (let tradeIndex = 0; tradeIndex < 20; tradeIndex += 1) {
    const offsetMs = 10_000 + (mintIndex * 1000) + (tradeIndex * 10);
    const signature = `${mint}-${tradeIndex}`;
    const tradePayload = {
      mint,
      receivedAt: iso(offsetMs),
      txType: tradeIndex % 2 === 0 ? 'buy' : 'sell',
      solAmount: 0.1,
      traderPublicKey: `Wallet${tradeIndex}`,
      signature,
      curveProgress: 0.5,
      curveModel: 'sol_quote',
      quoteMint: 'So11111111111111111111111111111111111111112',
      mayhemMode: false,
      tailDecodeError: null
    };
    events.push(event('provider.pumpportal.trade', iso(offsetMs), {
      ...tradePayload,
      pairBase: 'SOL'
    }));
    events.push(event('provider.helius_pumpfun.shadow_trade', iso(offsetMs + 5), {
      ...tradePayload,
      receivedAt: iso(offsetMs + 5)
    }));
    if (mintIndex < 5) {
      events.push(event('pump_bonding_curve.updated', iso(offsetMs + 6), {
        mint,
        curveProgress: 0.5
      }));
    }
  }
}

const report = analyzeEvents(events);
assert.strictEqual(report.verdict, PREREGISTERED.passVerdict);
assert.strictEqual(report.enoughEvidence, true);
assert.strictEqual(report.counts.eligibleMintHours, 20);
assert.strictEqual(report.counts.curveComparisons, 100);
assert.strictEqual(report.counts.discoveryMatches, 20);
assert.strictEqual(report.checks.strategyConsumptionDisabled, true);
assert.strictEqual(report.checks.cleanHeliusLifecycle, true);
assert.strictEqual(report.checks.portalTradeIdentityRecall, true);
assert.strictEqual(report.counts.rawHeliusTradeEvents, 400);
assert.strictEqual(report.counts.duplicateHeliusTradeEvents, 0);

const duplicateReport = analyzeEvents([...events, events.find((row) => row.type === 'provider.helius_pumpfun.shadow_trade')]);
assert.strictEqual(duplicateReport.counts.rawHeliusTradeEvents, 401);
assert.strictEqual(duplicateReport.counts.heliusTrades, 400);
assert.strictEqual(duplicateReport.counts.duplicateHeliusTradeEvents, 1);

const partialCoverageEvents = [events[0]];
partialCoverageEvents.push(event('provider.pumpportal.connected', iso(0), { role: 'tradestream' }));
for (let tradeIndex = 0; tradeIndex < 10; tradeIndex += 1) {
  partialCoverageEvents.push(event('provider.helius_pumpfun.shadow_trade', iso(60_000 + tradeIndex), {
    mint: 'PartialMint',
    receivedAt: iso(60_000 + tradeIndex),
    txType: 'buy',
    solAmount: 0.1,
    signature: `early-${tradeIndex}`,
    logIndex: 1,
    curveProgress: 0.2,
    curveModel: 'sol_quote',
    mayhemMode: false,
    tailDecodeError: null
  }));
}
partialCoverageEvents.push(event('provider.pumpportal.targeted_subscription', iso(1_800_000), {
  mint: 'PartialMint'
}));
for (let tradeIndex = 0; tradeIndex < 20; tradeIndex += 1) {
  const offsetMs = 1_800_100 + tradeIndex;
  const payload = {
    mint: 'PartialMint',
    receivedAt: iso(offsetMs),
    txType: 'buy',
    solAmount: 0.1,
    signature: `covered-${tradeIndex}`,
    traderPublicKey: `PartialWallet${tradeIndex}`,
    logIndex: 1,
    curveProgress: 0.5,
    curveModel: 'sol_quote',
    mayhemMode: false,
    tailDecodeError: null
  };
  partialCoverageEvents.push(event('provider.pumpportal.trade', iso(offsetMs), { ...payload, pairBase: 'SOL' }));
  partialCoverageEvents.push(event('provider.helius_pumpfun.shadow_trade', iso(offsetMs + 1), {
    ...payload,
    receivedAt: iso(offsetMs + 1)
  }));
}
partialCoverageEvents.push(event('provider.pumpportal.targeted_unsubscription', iso(2_000_000), {
  mint: 'PartialMint',
  reason: 'ttl'
}));
const partialCoverage = analyzeEvents(partialCoverageEvents);
assert.strictEqual(partialCoverage.counts.eligibleMintHours, 1);
assert.strictEqual(partialCoverage.worstMintHours[0].heliusTrades, 20);
assert.strictEqual(partialCoverage.worstMintHours[0].pumpPortalTrades, 20);
assert.deepStrictEqual(partialCoverage.worstMintHours[0].coverageSources, [
  'targeted_subscription_x_tradestream_connection'
]);

assert.strictEqual(timestampMs(1_000_000_000_000), 1_000_000_000_000_000);
assert.strictEqual(timestampMs(1_000_000_000_001), 1_000_000_000_001);
assert.strictEqual(nearestByTime([{ atMs: 20_000, curveProgress: 0.5 }], 5_000, 15_000).ageMs, 15_000);
assert.strictEqual(latestAtOrBefore([{ receiptMs: 20_000, payload: {} }], 20_500, 1_000).ageMs, 500);
assert.strictEqual(latestAtOrBefore([{ receiptMs: 20_000, payload: {} }], 19_999, 1_000), null);

const unexpectedDisconnect = analyzeEvents([
  ...events,
  event('provider.helius_pumpfun.shadow_disconnected', iso(100_000), {
    code: 1006,
    reason: 'synthetic failure'
  })
]);
assert.strictEqual(unexpectedDisconnect.checks.cleanHeliusLifecycle, false);
assert.strictEqual(unexpectedDisconnect.verdict, PREREGISTERED.failVerdict);

const unsupported = analyzeEvents([
  ...events,
  event('provider.helius_pumpfun.shadow_trade', iso(59_000), {
    mint: 'UnsupportedMint',
    receivedAt: iso(59_000),
    curveModel: 'quote_mint_unsupported',
    tailDecodeError: null
  })
]);
assert.strictEqual(unsupported.verdict, PREREGISTERED.failVerdict);
assert.strictEqual(unsupported.checks.unsupportedQuoteEvents, false);

const thinDecoderFailure = analyzeEvents([
  events[0],
  events.find((row) => row.type === 'provider.helius_pumpfun.shadow_connected'),
  events.find((row) => row.type === 'provider.helius_pumpfun.shadow_disconnected'),
  events.find((row) => row.type === 'session.stopped'),
  event('provider.helius_pumpfun.shadow_trade', iso(1000), {
    mint: 'ThinMint',
    receivedAt: iso(1000),
    curveModel: 'sol_quote',
    tailDecodeError: 'synthetic truncated tail'
  })
]);
assert.strictEqual(thinDecoderFailure.enoughEvidence, false);
assert.strictEqual(thinDecoderFailure.verdict, PREREGISTERED.failVerdict);

console.log('Helius Pump.fun shadow parity smoke passed');
