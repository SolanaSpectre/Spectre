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
  assert(frames.some((frame) => frame.method === 'subscribeTokenTrade' && frame.keys.includes('mint-1')));
  assert(lifecycle.some((row) => row.event === 'provider.pumpportal.targeted_subscription'));

  const requested = [];
  const engineContext = {
    config: {
      pumpPortalTradeSubscriptionMode: 'targeted_curve',
      pumpPortalTargetedMinCurveProgress: 0.25,
      pumpPortalTargetedMaxCurveProgress: 0.9
    },
    pumpPortalListener: {
      targetMint(mint, metadata) { requested.push({ mint, metadata }); return true; }
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

  console.log('PumpPortal targeted subscription smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
