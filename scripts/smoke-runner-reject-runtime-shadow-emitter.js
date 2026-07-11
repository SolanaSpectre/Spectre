#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  runnerRejectRuntimeShadowMarketState
} = require('../src/lib/runner-reject-runtime-shadow');

function main() {
  const wrappedPumpDevToken = {
    mintAddress: 'RunnerRejectFixture1111111111111111111111111111',
    source: 'pumpdev_create',
    symbol: 'RR',
    raw: {
      providerCurveProgress: 0.764321,
      providerCurvePriceSol: 0.000001234567,
      bondingCurveState: {
        curveProgress: 0.75,
        priceSol: 0.000001
      }
    }
  };

  const state = runnerRejectRuntimeShadowMarketState(wrappedPumpDevToken);
  assert.strictEqual(state.curveProgress, 0.764321);
  assert.strictEqual(state.curveProgressSource, 'token.raw');
  assert.strictEqual(state.priceSol, 0.000001234567);
  assert.strictEqual(state.priceSolSource, 'token.raw');

  const fallbackState = runnerRejectRuntimeShadowMarketState({
    mintAddress: wrappedPumpDevToken.mintAddress,
    preMigrationState: {
      curveProgress: 76.5,
      bondingCurvePriceSol: 0.000002
    }
  });
  assert.strictEqual(fallbackState.curveProgress, 0.765);
  assert.strictEqual(fallbackState.curveProgressSource, 'token.preMigrationState');
  assert.strictEqual(fallbackState.priceSol, 0.000002);
  assert.strictEqual(fallbackState.priceSolSource, 'token.preMigrationState');

  console.log('[runner-shadow-emitter-smoke] extractor handles wrapped PumpDev token state');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}
