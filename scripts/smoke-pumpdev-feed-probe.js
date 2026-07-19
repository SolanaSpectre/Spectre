#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { assessCapacity, sanitizeUrl } = require('./probe-pumpdev-feed');

assert.strictEqual(
  sanitizeUrl('wss://pumpdev.io/ws?api-key=secret&mode=probe'),
  'wss://pumpdev.io/ws?api-key=<redacted>&mode=probe'
);
assert.strictEqual(
  sanitizeUrl('wss://pumpdev.io/ws?access_token=secret'),
  'wss://pumpdev.io/ws?access_token=<redacted>'
);

const sufficient = assessCapacity({
  knownMints: 200,
  requestedTokenTrades: 162,
  acknowledgedTokenTrades: 162,
  subscriptionErrors: []
}, {
  requiredSubscriptions: 162,
  expectedPlanSubscriptions: 1000,
  expectedMonthlyTradeQuota: 6000000,
  requiredTradeMessagesPerHour: 96000
});
assert.strictEqual(sufficient.verdict, 'ACKNOWLEDGED_CAPACITY_MEETS_REQUIREMENT');
assert.strictEqual(sufficient.projectedFullCoverageHoursPerMonth, 62.5);

const declaredShortfall = assessCapacity({
  knownMints: 25,
  requestedTokenTrades: 25,
  acknowledgedTokenTrades: 25,
  subscriptionErrors: []
}, {
  requiredSubscriptions: 162,
  expectedPlanSubscriptions: 100
});
assert.strictEqual(declaredShortfall.verdict, 'DECLARED_PLAN_CAPACITY_BELOW_REQUIREMENT');

const observedShortfall = assessCapacity({
  knownMints: 200,
  requestedTokenTrades: 100,
  acknowledgedTokenTrades: 100,
  subscriptionErrors: ['Starter tier subscription limit reached']
}, {
  requiredSubscriptions: 162
});
assert.strictEqual(observedShortfall.verdict, 'OBSERVED_CAPACITY_BELOW_REQUIREMENT');

const omittedDeclaredLimits = assessCapacity({
  knownMints: 200,
  requestedTokenTrades: 162,
  acknowledgedTokenTrades: 162,
  subscriptionErrors: []
}, {
  requiredSubscriptions: 162
});
assert.strictEqual(omittedDeclaredLimits.verdict, 'ACKNOWLEDGED_CAPACITY_MEETS_REQUIREMENT');
assert.strictEqual(omittedDeclaredLimits.expectedPlanSubscriptions, null);
assert.strictEqual(omittedDeclaredLimits.expectedMonthlyTradeQuota, null);

console.log('PumpDev feed probe smoke passed');
