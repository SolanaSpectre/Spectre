#!/usr/bin/env node
'use strict';

const assert = require('assert');
const PumpDevListener = require('../src/pumpdev-listener');

const lifecycle = [];
const listener = new PumpDevListener({
  pumpDevShadowEnabled: true,
  pumpDevMaxSubscribedMints: 3
}, { info() {}, warn() {} }, {
  onLifecycle(type, payload) {
    lifecycle.push({ type, payload });
  }
});

listener.send = () => true;
listener.maybeSubscribeMint('mint-a');
listener.maybeSubscribeMint('mint-b');
listener.maybeSubscribeMint('mint-c');
listener.maybeSubscribeMint('mint-d');
listener.maybeSubscribeMint('mint-e');
let stats = listener.getStats();
assert.strictEqual(stats.subscribedMints, 0);
assert.strictEqual(stats.pendingSubscriptionMints, 1);
assert.strictEqual(stats.queuedSubscriptionMints, 4);

listener.recordSystemSubscriptionMessage({ type: 'subscribed', method: 'subscribeTokenTrade', keys: ['mint-a'] });
listener.recordSystemSubscriptionMessage({ type: 'subscribed', method: 'subscribeTokenTrade', keys: ['mint-b'] });
listener.recordSystemSubscriptionMessage({ type: 'subscribed', method: 'subscribeTokenTrade', keys: ['mint-c'] });
listener.touchSubscribedMint('mint-a', 'trade');
listener.touchSubscribedMint('mint-a', 'trade');

stats = listener.getStats();
assert.strictEqual(stats.subscribedMints, 3);
assert.strictEqual(stats.pendingSubscriptionMints, 0);
assert.strictEqual(stats.queuedSubscriptionMints, 0);
assert.strictEqual(stats.tokenTradeSubscribeCandidates, 5);
assert.strictEqual(stats.tokenTradeSubscribeSkippedAtCap, 2);
assert.strictEqual(stats.subscriptionAckMessages, 3);
assert.strictEqual(stats.tokenTradeSubscriptionAcks, 3);
assert.strictEqual(stats.subscriptionProductivity.zeroTradeSlots, 2);
assert.strictEqual(stats.subscriptionProductivity.totalTrades, 2);
assert.ok(lifecycle.some((row) => row.type === 'provider.pumpdev.subscription_capacity'));
assert.ok(lifecycle.some((row) => row.type === 'provider.pumpdev.subscription_ack'));

const anonymous = new PumpDevListener({
  pumpDevShadowEnabled: true,
  pumpDevMaxSubscribedMints: 100
}, { info() {}, warn() {} });
anonymous.send = () => true;
for (let index = 1; index <= 8; index += 1) anonymous.maybeSubscribeMint(`anon-${index}`);
for (let index = 1; index <= 5; index += 1) {
  anonymous.recordSystemSubscriptionMessage({
    type: 'subscribed',
    method: 'subscribeTokenTrade',
    keys: [`anon-${index}`]
  });
}
anonymous.recordSystemSubscriptionMessage({
  type: 'error',
  message: "The anonymous tier allows 5 live subscriptions (tokens + wallets) and you've reached that limit."
});
const anonymousStats = anonymous.getStats();
assert.strictEqual(anonymousStats.subscribedMints, 5);
assert.strictEqual(anonymousStats.pendingSubscriptionMints, 0);
assert.strictEqual(anonymousStats.queuedSubscriptionMints, 0);
assert.strictEqual(anonymousStats.effectiveMaxSubscribedMints, 5);
assert.strictEqual(anonymousStats.tokenTradeSubscriptionRejects, 1);
assert.strictEqual(anonymousStats.tokenTradeSubscribeSkippedAtCap, 2);

anonymous.resetSubscriptionsAfterDisconnect();
const disconnectedStats = anonymous.getStats();
assert.strictEqual(disconnectedStats.subscribedMints, 0);
assert.strictEqual(disconnectedStats.pendingSubscriptionMints, 0);
assert.strictEqual(disconnectedStats.queuedSubscriptionMints, 5);

const targeted = new PumpDevListener({
  pumpDevShadowEnabled: true,
  pumpDevFeedMode: 'shadow',
  pumpDevTradeSubscriptionMode: 'targeted_candidates',
  pumpDevTargetedSubscriptionTtlMs: 1000,
  pumpDevMaxSubscribedMints: 5
}, { info() {}, warn() {} });
targeted.send = () => true;
targeted.targetMint('finalist-a', { reason: 'flagged', score: 80, curveProgress: 0.7 });
targeted.recordSystemSubscriptionMessage({
  type: 'subscribed',
  method: 'subscribeTokenTrade',
  keys: ['finalist-a']
});
const targetMeta = targeted.subscribedMintMeta.get('finalist-a');
targeted.pruneExpiredTargetedSubscriptions(Number(targetMeta.lastTargetedAt) + 1001);
const targetedStats = targeted.getStats();
assert.strictEqual(targetedStats.subscribedMints, 0);
assert.strictEqual(targetedStats.targetedSubscriptionRequests, 1);
assert.strictEqual(targetedStats.targetedSubscriptionEvictions, 1);

const burstLifecycle = [];
const burstTargeted = new PumpDevListener({
  pumpDevShadowEnabled: true,
  pumpDevFeedMode: 'shadow',
  pumpDevTradeSubscriptionMode: 'targeted_candidates',
  pumpDevTargetedSubscriptionTtlMs: 1000,
  pumpDevMaxSubscribedMints: 1
}, { info() {}, warn() {} }, {
  onLifecycle(type, payload) {
    burstLifecycle.push({ type, payload });
  }
});
burstTargeted.send = () => true;
assert.strictEqual(burstTargeted.targetMint('burst-a', { reason: 'flagged' }), true);
assert.strictEqual(burstTargeted.targetMint('burst-a', { reason: 'flagged_again' }), true);
burstTargeted.recordSystemSubscriptionMessage({
  type: 'subscribed',
  method: 'subscribeTokenTrade',
  keys: ['burst-a']
});
assert.strictEqual(burstTargeted.targetMint('burst-b', { reason: 'at_capacity' }), false);
const burstStats = burstTargeted.getStats();
assert.strictEqual(burstStats.targetedSubscriptionRequests, 1);
assert.strictEqual(
  burstLifecycle.filter((row) => row.type === 'provider.pumpdev.targeted_subscription_requested').length,
  1
);

console.log('PumpDev subscription lifecycle smoke passed.');
