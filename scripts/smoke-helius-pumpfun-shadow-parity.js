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

const startMs = Date.parse('2026-08-01T12:00:00.000Z');
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
  commitment: 'processed',
  connectionEpoch: 1,
  subscriptionRequestId: 7101
}));
events.push(event('provider.helius_pumpfun.shadow_subscription_ack', iso(2), {
  connectionEpoch: 1,
  subscriptionRequestId: 7101,
  subscriptionId: 99,
  ackLatencyMs: 1
}));
events.push(event('provider.helius_pumpfun.shadow_disconnected', iso(3_598_999), {
  code: 1000,
  reason: 'shadow listener stop'
}));
events.push(event('session.stopped', iso(3_599_000), {
  reason: 'SESSION_DURATION_EXCEEDED',
  stats: { heliusPumpfunShadow: { bytes: 200_000 } }
}));

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
    const repeatedIdentity = mintIndex === 0 && tradeIndex === 0;
    events.push(event('provider.helius_pumpfun.shadow_trade', iso(offsetMs + 5), {
      ...tradePayload,
      solAmount: repeatedIdentity ? 0.04 : tradePayload.solAmount,
      logIndex: repeatedIdentity ? 10 : 1,
      receivedAt: iso(offsetMs + 5)
    }));
    if (repeatedIdentity) {
      events.push(event('provider.helius_pumpfun.shadow_trade', iso(offsetMs + 5), {
        ...tradePayload,
        solAmount: 0.06,
        logIndex: 20,
        receivedAt: iso(offsetMs + 5)
      }));
    }
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
assert.strictEqual(report.counts.heliusLifecycle.subscriptionAcks, 1);
assert.strictEqual(report.diagnostics.websocketCreditEstimate.measuredSessionCreditsEstimate, 4);
assert.strictEqual(report.checks.portalTradeIdentityRecall, true);
assert.strictEqual(report.agreement.traderIdentityAgreementRate, 1);
assert.strictEqual(report.counts.rawHeliusTradeEvents, 401);
assert.strictEqual(report.counts.duplicateHeliusTradeEvents, 0);

const duplicateReport = analyzeEvents([...events, events.find((row) => row.type === 'provider.helius_pumpfun.shadow_trade')]);
assert.strictEqual(duplicateReport.counts.rawHeliusTradeEvents, 402);
assert.strictEqual(duplicateReport.counts.heliusTrades, 401);
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
assert.strictEqual(
  partialCoverage.diagnostics.websocketCreditEstimate.measuredSessionCreditsEstimate,
  null
);
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
assert.strictEqual(
  unexpectedDisconnect.counts.heliusLifecycle.unexpectedDisconnectsWithoutGapSequence,
  1
);

const boundedReconnectEvents = events.filter((row) => (
  row.type !== 'provider.helius_pumpfun.shadow_disconnected'
  && row.type !== 'session.stopped'
));
boundedReconnectEvents.push(event('provider.helius_pumpfun.shadow_disconnected', iso(100_000), {
  code: 1006,
  reason: '',
  connectionEpoch: 1,
  transportGapSequence: 1
}));
boundedReconnectEvents.push(event('provider.helius_pumpfun.shadow_connected', iso(101_000), {
  commitment: 'processed',
  connectionEpoch: 2,
  subscriptionRequestId: 7102
}));
boundedReconnectEvents.push(event('provider.helius_pumpfun.shadow_subscription_ack', iso(101_500), {
  connectionEpoch: 2,
  subscriptionRequestId: 7102,
  subscriptionId: 100,
  ackLatencyMs: 500,
  recoveredTransportGapSequence: 1,
  recoveredTransportGapDurationMs: 1500
}));
boundedReconnectEvents.push(event('provider.helius_pumpfun.shadow_transport_gap_closed', iso(101_500), {
  sequence: 1,
  durationMs: 1500,
  recoveredConnectionEpoch: 2
}));
boundedReconnectEvents.push(event('provider.helius_pumpfun.shadow_disconnected', iso(3_598_999), {
  code: 1000,
  reason: 'shadow listener stop'
}));
boundedReconnectEvents.push(event('session.stopped', iso(3_599_000), {
  reason: 'SESSION_DURATION_EXCEEDED',
  stats: { heliusPumpfunShadow: { bytes: 200_000 } }
}));
const boundedReconnect = analyzeEvents(boundedReconnectEvents);
assert.strictEqual(boundedReconnect.checks.cleanHeliusLifecycle, true);
assert.strictEqual(boundedReconnect.counts.heliusLifecycle.unexpectedDisconnects, 1);
assert.strictEqual(boundedReconnect.counts.heliusLifecycle.transportGapsClosed, 1);
assert.strictEqual(boundedReconnect.counts.heliusLifecycle.transportGapDurationStats.max, 1500);

const successfulReconnectIndex = boundedReconnectEvents.findIndex((row) => (
  row.type === 'provider.helius_pumpfun.shadow_connected'
  && row.payload.connectionEpoch === 2
));
const continuousGapReconnectEvents = [
  ...boundedReconnectEvents.slice(0, successfulReconnectIndex),
  event('provider.helius_pumpfun.shadow_disconnected', iso(100_500), {
    code: 1006,
    reason: 'reconnect attempt failed before open',
    connectionEpoch: null,
    transportGapSequence: 1
  }),
  ...boundedReconnectEvents.slice(successfulReconnectIndex)
];
const continuousGapReconnect = analyzeEvents(continuousGapReconnectEvents);
assert.strictEqual(continuousGapReconnect.checks.cleanHeliusLifecycle, true);
assert.strictEqual(continuousGapReconnect.counts.heliusLifecycle.unexpectedDisconnects, 2);
assert.strictEqual(continuousGapReconnect.counts.heliusLifecycle.transportGapsStarted, 1);
assert.strictEqual(continuousGapReconnect.counts.heliusLifecycle.transportGapsClosed, 1);
assert.strictEqual(
  continuousGapReconnect.counts.heliusLifecycle.unexpectedDisconnectsWithoutGapSequence,
  0
);

const explicitShutdownDisconnect = analyzeEvents([
  ...events,
  event('provider.helius_pumpfun.shadow_disconnected', iso(3_598_998), {
    code: 1006,
    reason: '',
    sessionPhase: 'STOPPING',
    shutdownDisconnect: true,
    shutdownAgeMs: 35
  })
]);
assert.strictEqual(explicitShutdownDisconnect.checks.cleanHeliusLifecycle, true);
assert.strictEqual(explicitShutdownDisconnect.counts.heliusLifecycle.shutdownPhaseDisconnects, 1);

const unstampedShutdownDisconnect = analyzeEvents([
  ...events,
  event('provider.helius_pumpfun.shadow_disconnected', iso(3_598_998), {
    code: 1006,
    reason: ''
  })
]);
assert.strictEqual(unstampedShutdownDisconnect.checks.cleanHeliusLifecycle, false);

const explicitShutdownError = analyzeEvents([
  ...events,
  event('provider.helius_pumpfun.shadow_error', iso(3_598_998), {
    errorMessage: 'socket closed during stop',
    sessionPhase: 'STOPPING',
    shutdownError: true,
    shutdownAgeMs: 35
  })
]);
assert.strictEqual(explicitShutdownError.checks.cleanHeliusLifecycle, true);
assert.strictEqual(explicitShutdownError.counts.heliusLifecycle.shutdownPhaseErrors, 1);

const staleShutdownError = analyzeEvents([
  ...events,
  event('provider.helius_pumpfun.shadow_error', iso(3_598_998), {
    errorMessage: 'late socket failure',
    sessionPhase: 'STOPPING',
    shutdownError: true,
    shutdownAgeMs: 1001
  })
]);
assert.strictEqual(staleShutdownError.checks.cleanHeliusLifecycle, false);

const eventDecodeFailure = analyzeEvents([
  ...events,
  event('provider.helius_pumpfun.shadow_decode_error', iso(100_000), {
    eventType: 'TradeEvent',
    signature: 'SyntheticDecodeFailure',
    dataLength: 129
  })
]);
assert.strictEqual(eventDecodeFailure.checks.decoderEventErrors, false);
assert.strictEqual(eventDecodeFailure.verdict, PREREGISTERED.failVerdict);

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
