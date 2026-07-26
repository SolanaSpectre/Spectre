#!/usr/bin/env node
'use strict';

const assert = require('assert');
const LiveExecutionDryRunLane = require('../src/lib/live-execution-dry-run-lane');
const TradingEngine = require('../src/trading-engine');

async function main() {
  const events = [];
  const lane = new LiveExecutionDryRunLane({
    liveDryRunEnabled: true,
    liveDryRunPumpBuyV2BuilderEnabled: false,
    liveDryRunPostMigrationRouteProbeTimeoutMs: 20,
    liveDryRunPostMigrationRouteProbeCooldownMs: 1000,
    preMigrationPaperAmountSol: 0.05
  }, {}, {
    telemetryHook: (type, payload) => events.push({ type, payload }),
    postMigrationRouteProbe: async ({ mint, amountLamports }) => ({
      available: mint === 'mint-a' && amountLamports === 50_000_000,
      quoteAgeMs: 12,
      outputAmount: '123456',
      priceImpactPct: 0.42,
      routePlanSteps: 2
    })
  });

  const available = await lane.probePostMigrationRoute({
    mint: 'mint-a',
    amountLamports: 50_000_000,
    sourceDecision: 'PAPER_ELIGIBLE'
  });
  assert.strictEqual(available.status, 'ROUTE_AVAILABLE');
  assert.strictEqual(available.available, true);
  assert.strictEqual(available.broadcastEnabled, false);
  assert.strictEqual(available.strategyConsumptionAllowed, false);
  assert.strictEqual(lane.getStats().postMigrationRoutesAvailable, 1);
  assert.strictEqual(events[0].type, 'live_dry_run.post_migration_route_probe');
  const cooldown = await lane.probePostMigrationRoute({ mint: 'mint-a', amountLamports: 1 });
  assert.strictEqual(cooldown.status, 'PROBE_COOLDOWN');
  assert.strictEqual(cooldown.attempted, false);

  const hostileError = new Error('https://api.jup.ag/order?api-key=DO_NOT_LEAK');
  hostileError.name = 'FetchError';
  lane.postMigrationRouteProbe = async () => {
    throw hostileError;
  };
  const failed = await lane.probePostMigrationRoute({ mint: 'mint-b', amountLamports: 1 });
  assert.strictEqual(failed.status, 'PROBE_ERROR');
  assert.strictEqual(failed.reason, 'FetchError');
  assert.strictEqual(JSON.stringify(failed).includes('DO_NOT_LEAK'), false);

  lane.postMigrationRouteProbe = async () => new Promise(() => {});
  const timedOut = await lane.probePostMigrationRoute({ mint: 'mint-timeout', amountLamports: 1 });
  assert.strictEqual(timedOut.status, 'PROBE_TIMEOUT');
  assert.strictEqual(timedOut.reason, 'PostMigrationRouteProbeTimeoutError');
  assert.strictEqual(lane.getStats().postMigrationRouteProbeTimeouts, 1);

  let executeCalls = 0;
  const engineContext = {
    config: {
      baseTokenMint: 'So11111111111111111111111111111111111111112',
      maxPriceImpact: 3
    },
    marketData: {
      async getQuoteWithStalenessCheck(inputMint, outputMint, amount) {
        assert.strictEqual(outputMint, 'mint-c');
        assert.strictEqual(amount, '50000000');
        return {
          outAmount: '999',
          priceImpactPct: 0.5,
          routePlan: [{ swapInfo: { label: 'Raydium' } }],
          _fetchTimestamp: Date.now()
        };
      },
      isQuoteStale() {
        return { stale: false, ageMs: 8 };
      },
      async executeJupiterOrder() {
        executeCalls += 1;
      }
    },
    validateQuoteQuality: TradingEngine.prototype.validateQuoteQuality
  };
  const route = await TradingEngine.prototype.probePostMigrationJupiterRoute.call(engineContext, {
    mint: 'mint-c',
    amountLamports: 50_000_000
  });
  assert.strictEqual(route.available, true);
  assert.strictEqual(route.outputAmount, '999');
  assert.strictEqual(route.routePlanSteps, 1);
  assert.strictEqual(executeCalls, 0);

  console.log('Live dry-run post-migration route probe smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
