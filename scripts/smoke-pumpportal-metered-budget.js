const assert = require('assert');
const PumpPortalListener = require('../src/pumpportal-listener');

async function main() {
  const lifecycle = [];
  const listener = new PumpPortalListener({
    pumpPortalApiKey: 'smoke-key',
    pumpPortalSplitSockets: true,
    pumpPortalMaxMeteredTradeEventsPerSession: 2,
    pumpPortalMaxSubscribedMints: 10,
    pumpPortalTokenTradeSubscriptionTtlMs: 60000,
    pumpPortalTrackedAccounts: ['account-1']
  }, {
    info() {},
    warn() {},
    error() {},
    debug() {}
  });

  listener.emitLifecycle = (event, payload) => lifecycle.push({ event, payload });
  const discoveryFrames = [];
  listener.connections.discovery.ws = {
    readyState: 1,
    send(frame) { discoveryFrames.push(JSON.parse(frame)); }
  };
  listener.connections.tradestream.ws = { readyState: 3 };
  listener.subscribedMints.add('mint-1');
  listener.subscribedMintMeta.set('mint-1', { subscribedAt: Date.now(), lastTradeAt: Date.now() });
  listener.subscribedAccounts.add('account-1');

  await listener.handleMessage({ txType: 'buy', mint: 'mint-1' }, 'tradestream');
  assert.strictEqual(listener.meteredTradeBudgetReached, false);

  await listener.handleMessage({ txType: 'sell', traderPublicKey: 'account-1' }, 'discovery');
  assert.strictEqual(listener.meteredTradeBudgetReached, true);
  assert.strictEqual(listener.stats.meteredTradeBudgetReached, true);
  assert.strictEqual(listener.stats.meteredTradeEvents, 2);
  assert.strictEqual(listener.stats.trades, 1);
  assert.strictEqual(listener.stats.unmatchedAccountTrades, 1);
  assert.strictEqual(listener.subscribedMints.size, 0);
  assert.strictEqual(listener.subscribedAccounts.size, 0);
  assert.strictEqual(lifecycle.length, 1);
  assert.strictEqual(lifecycle[0].event, 'provider.pumpportal.metered_budget_reached');
  assert.strictEqual(lifecycle[0].payload.maxMeteredTradeEventsPerSession, 2);
  assert.strictEqual(lifecycle[0].payload.tokenUnsubscribeSent, false);
  assert.strictEqual(lifecycle[0].payload.accountUnsubscribeSent, true);
  assert.strictEqual(listener.stats.accountTradeUnsubscribeFrames, 1);
  assert(discoveryFrames.some((frame) => frame.method === 'unsubscribeAccountTrade'));

  const skippedBefore = listener.stats.tradeSubscriptionsSkippedBudget;
  await listener.handleMessage({ txType: 'create', mint: 'mint-2' }, 'discovery');
  assert.strictEqual(listener.stats.tradeSubscriptionsSkippedBudget, skippedBefore + 1);
  const accountSkippedBefore = listener.stats.accountSubscriptionsSkippedBudget;
  listener.subscribeTrackedAccounts();
  assert.strictEqual(listener.stats.accountSubscriptionsSkippedBudget, accountSkippedBefore + 1);

  console.log('PumpPortal metered budget smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
