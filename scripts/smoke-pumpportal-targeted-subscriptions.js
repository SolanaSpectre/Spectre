#!/usr/bin/env node
'use strict';

const assert = require('assert');
const PumpPortalListener = require('../src/pumpportal-listener');
const TradingEngine = require('../src/trading-engine');

async function main() {
  const frames = [];
  const lifecycle = [];
  const listener = new PumpPortalListener({
    pumpPortalApiKey: 'smoke-key',
    pumpPortalTradeSubscriptionMode: 'targeted_curve',
    pumpPortalMaxMeteredTradeEventsPerSession: 30000,
    pumpPortalMaxSubscribedMints: 10,
    pumpPortalTokenTradeSubscriptionTtlMs: 60000,
    pumpPortalTrackedAccounts: []
  }, {
    info() {}, warn() {}, error() {}, debug() {}
  });
  const sharedSocket = {
    readyState: 1,
    send(frame) { frames.push(JSON.parse(frame)); }
  };
  listener.connections.discovery.ws = sharedSocket;
  listener.connections.tradestream.ws = sharedSocket;
  listener.emitLifecycle = (event, payload) => lifecycle.push({ event, payload });

  await listener.handleMessage({ txType: 'create', mint: 'mint-1' }, 'discovery');
  assert.strictEqual(listener.subscribedMints.has('mint-1'), false);
  assert.strictEqual(listener.stats.targetedTradeSubscriptionsDeferredAtDiscovery, 1);
  assert.strictEqual(frames.some((frame) => frame.method === 'subscribeTokenTrade'), false);

  const targeted = listener.targetMint('mint-1', {
    reason: 'discovery_rpc_curve_prefilter',
    curveProgress: 0.25,
    score: 20
  });
  assert.strictEqual(targeted, true);
  assert.strictEqual(listener.subscribedMints.has('mint-1'), true);
  assert.strictEqual(listener.stats.targetedTradeSubscriptionAccepted, 1);
  assert.strictEqual(listener.stats.targetedTradeSubscriptionSendFailed, 0);
  assert(frames.some((frame) => frame.method === 'subscribeTokenTrade' && frame.keys.includes('mint-1')));
  assert(lifecycle.some((row) => row.event === 'provider.pumpportal.targeted_subscription'));

  listener.recordSubscriptionAck({ message: 'Successfully subscribed to keys.' }, 'tradestream');
  assert.strictEqual(listener.stats.targetedTradeSubscriptionAcked, 1);
  assert.strictEqual(listener.stats.tokenTradeSubscriptionAcks, 1);
  assert.strictEqual(listener.stats.lastSubscriptionAckKind, 'token_trade');
  assert(lifecycle.some((row) => row.event === 'provider.pumpportal.targeted_subscription_ack'));

  assert.strictEqual(listener.recordSubscriptionRejection({
    message: 'subscribeTokenTrade is temporarily unavailable because the provider is busy'
  }), false);
  assert.strictEqual(listener.stats.paidSubscriptionEntitlementRejected, false);

  const rejectionMessage = "'subscribeTokenTrade' and 'subscribeAccountTrade' methods are only available when connecting with an API key funded with at least 0.02 SOL.";
  listener.connections.tradestream.pendingResubscribeMints = ['queued-before-rejection'];
  listener.connections.tradestream.resubscribeTimer = setTimeout(() => {}, 60000);
  assert.strictEqual(listener.recordSubscriptionRejection({ message: rejectionMessage }), true);
  assert.strictEqual(listener.stats.targetedTradeSubscriptionRejected, 1);
  assert.strictEqual(listener.stats.paidSubscriptionEntitlementRejected, true);
  assert(Number.isFinite(listener.stats.paidSubscriptionEntitlementRejectedAt));
  assert.deepStrictEqual(listener.connections.tradestream.pendingResubscribeMints, []);
  assert.strictEqual(listener.connections.tradestream.resubscribeTimer, null);
  assert(lifecycle.some((row) => row.event === 'provider.pumpportal.targeted_subscription_rejected'));

  const framesAfterRejection = frames.length;
  assert.strictEqual(listener.targetMint('mint-after-rejection'), false);
  assert.strictEqual(listener.subscribedMints.has('mint-after-rejection'), false);
  assert.strictEqual(listener.stats.targetedTradeSubscriptionSkippedEntitlementRejected, 1);
  assert.strictEqual(frames.length, framesAfterRejection);
  assert.strictEqual(listener.subscribeTokenTrade('direct-after-rejection'), false);
  assert.strictEqual(listener.stats.paidSubscriptionFramesSuppressedAfterRejection, 1);
  assert.strictEqual(frames.length, framesAfterRejection);

  listener.config.pumpPortalTrackedAccounts = ['account-after-rejection'];
  listener.subscribeTrackedAccounts();
  listener.subscribeTrackedMints();
  assert.strictEqual(listener.stats.accountSubscriptionsSkippedEntitlementRejected, 1);
  assert.strictEqual(frames.length, framesAfterRejection);

  listener.stats.targetedTradeSubscriptionAccepted = 50;
  listener.stats.targetedTradeSubscriptionFirstSentAt = 1_000;
  listener.stats.meteredTradeEvents = 0;
  assert.strictEqual(listener.checkPaidTapeSilence(601_000), false);
  listener.stats.targetedTradeSubscriptionAcked = 0;
  assert.strictEqual(listener.checkPaidTapeSilence(601_000), true);
  assert.strictEqual(listener.checkPaidTapeSilence(602_000), false);
  assert(lifecycle.some((row) => row.event === 'provider.pumpportal.paid_tape_silent'));

  assert.strictEqual(listener.unsubscribeTokenTrade('mint-1', 'migration'), true);
  assert.strictEqual(listener.subscribedMints.has('mint-1'), false);
  assert.strictEqual(listener.stats.tokenTradeTerminalPrunes, 1);
  assert(frames.some((frame) => frame.method === 'unsubscribeTokenTrade' && frame.keys.includes('mint-1')));
  assert(lifecycle.some((row) => row.event === 'provider.pumpportal.targeted_unsubscription'
    && row.payload.mint === 'mint-1'
    && row.payload.reason === 'migration'));

  const disconnected = new PumpPortalListener({
    pumpPortalApiKey: 'smoke-key',
    pumpPortalTradeSubscriptionMode: 'targeted_curve',
    pumpPortalMaxSubscribedMints: 10,
    pumpPortalTrackedAccounts: []
  }, { info() {}, warn() {}, error() {}, debug() {} });
  assert.strictEqual(disconnected.targetMint('mint-send-fails'), false);
  assert.strictEqual(disconnected.stats.targetedTradeSubscriptionAccepted, 0);
  assert.strictEqual(disconnected.stats.targetedTradeSubscriptionSendFailed, 1);
  assert.strictEqual(disconnected.subscribedMints.has('mint-send-fails'), false);

  const requested = [];
  const engineTelemetry = [];
  const engineContext = {
    config: {
      pumpPortalTradeSubscriptionMode: 'targeted_curve',
      pumpPortalTargetedMinCurveProgress: 0.25,
      pumpPortalTargetedMaxCurveProgress: 0.9,
      pumpPortalTargetedPrefilterMaxAgeMs: 180000,
      pumpBondingCurveRefreshIntervalMs: 15000
    },
    pumpPortalTargetedFirstRpcObservations: new Map(),
    pumpPortalTargetedPrefilterRefreshState: new Map(),
    pumpPortalTargetedPrefilterExpiredMints: new Map(),
    telemetry: { record(type, payload) { engineTelemetry.push({ type, payload }); } },
    pumpPortalListener: {
      targetMint(mint, metadata) { requested.push({ mint, metadata }); return true; }
    },
    enqueuePumpBondingCurveSync(mint, token, launchIntelSummary, delayMs, options) {
      this.lastQueuedRefresh = { mint, token, launchIntelSummary, delayMs, options };
    }
  };
  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'too-early', curveProgress: 0.249, curveProgressSource: 'pump_bonding_curve_rpc', bondingCurveAccountFound: true, score: 99 }
  }), false);
  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'provider-only', curveProgress: 0.5, curveProgressSource: 'pumpportal_virtual_reserves', bondingCurveAccountFound: false, score: 99 }
  }), false);
  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'eligible', curveProgress: 0.25, curveProgressSource: 'pump_bonding_curve_rpc', bondingCurveAccountFound: true, score: 20 }
  }), true);
  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'too-late', curveProgress: 0.9, curveProgressSource: 'pump_bonding_curve_rpc', bondingCurveAccountFound: true, score: 100 }
  }), false);
  assert.deepStrictEqual(requested.map((row) => row.mint), ['eligible']);

  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'slow-builder', curveProgress: 0.05, curveProgressSource: 'pump_bonding_curve_rpc', bondingCurveAccountFound: true, score: 5 }
  }), false);
  assert.strictEqual(TradingEngine.prototype.scheduleTargetedPumpPortalPrefilterRefresh.call(
    engineContext,
    { mint: 'slow-builder' },
    { mint: 'slow-builder', accountFound: true, complete: false, curveProgress: 0.05 }
  ), true);
  assert.strictEqual(engineContext.lastQueuedRefresh.mint, 'slow-builder');
  assert.strictEqual(engineContext.lastQueuedRefresh.delayMs, 15000);
  assert.strictEqual(engineContext.lastQueuedRefresh.options.forceVerify, true);
  engineContext.lastQueuedRefresh = null;
  assert.strictEqual(TradingEngine.prototype.scheduleTargetedPumpPortalPrefilterRefresh.call(
    engineContext,
    { mint: 'invalid-owner' },
    { mint: 'invalid-owner', accountFound: true, invalidAccountData: true, curveProgress: null }
  ), false);
  assert.strictEqual(engineContext.lastQueuedRefresh, null);
  assert.strictEqual(engineContext.pumpPortalTargetedPrefilterRefreshState.has('invalid-owner'), false);
  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'slow-builder', curveProgress: 0.3, curveProgressSource: 'pump_bonding_curve_rpc', bondingCurveAccountFound: true, score: 30 }
  }), true);
  assert(requested.some((row) => row.mint === 'slow-builder'));

  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'first-seen-above', curveProgress: 0.95, curveProgressSource: 'pump_bonding_curve_rpc', bondingCurveAccountFound: true, score: 95 }
  }), false);
  assert(engineTelemetry.some((row) => row.type === 'provider.pumpportal.targeted_prefilter_first_rpc_observation'
    && row.payload.mint === 'first-seen-above'
    && row.payload.classification === 'ABOVE_BAND'
    && row.payload.coverageShapedExclusion === true));

  engineContext.pumpPortalTargetedPrefilterExpiredMints.set('aged-builder', {
    expiredAt: '2026-07-18T12:00:00.000Z',
    curveProgress: 0.2,
    attempts: 12
  });
  assert.strictEqual(TradingEngine.prototype.maybeTargetPumpPortalPaidTape.call(engineContext, {
    state: { mint: 'aged-builder', curveProgress: 0.92, curveProgressSource: 'pump_bonding_curve_rpc', bondingCurveAccountFound: true, score: 90 }
  }), false);
  assert(engineTelemetry.some((row) => row.type === 'provider.pumpportal.targeted_prefilter_expired_later_observed'
    && row.payload.mint === 'aged-builder'
    && row.payload.laterClassification === 'ABOVE_BAND'));

  console.log('PumpPortal targeted subscription smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
