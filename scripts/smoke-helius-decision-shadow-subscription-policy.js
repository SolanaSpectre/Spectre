#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  PREWARM_TRIGGER_REASON_ORDER,
  decisionShadowPrewarmTriggerReasons,
  decisionShadowVerifierPolicyActive,
  hasDecisionShadowComparisonEvent,
  shouldPrewarmDecisionShadowSubscription,
  shouldRequestDecisionShadowSubscription
} = require('../src/lib/helius-decision-shadow-subscription-policy');

assert.deepStrictEqual(PREWARM_TRIGGER_REASON_ORDER, [
  'FLAGGED',
  'NEWLY_CONFIRMED',
  'CONFIRMED',
  'OBSERVED_SIGNAL',
  'OBSERVED_INTEREST',
  'ACTIVE_POSITION'
]);

const active = {
  heliusShadowEnabled: true,
  decisionShadowEnabled: true,
  paperMode: true
};

assert.strictEqual(decisionShadowVerifierPolicyActive(active), true);
assert.strictEqual(decisionShadowVerifierPolicyActive({ ...active, paperMode: false }), false);
assert.strictEqual(hasDecisionShadowComparisonEvent([
  { telemetryType: 'pre_migration.guard_attribution' }
]), false);
assert.strictEqual(hasDecisionShadowComparisonEvent([
  { telemetryType: 'pre_migration_paper.decision' }
]), true);
assert.strictEqual(shouldRequestDecisionShadowSubscription({
  ...active,
  events: [{ telemetryType: 'pre_migration.guard_attribution' }]
}), false);
assert.strictEqual(shouldRequestDecisionShadowSubscription({
  ...active,
  events: [{ telemetryType: 'pre_migration_paper.entry' }]
}), true);
assert.strictEqual(shouldRequestDecisionShadowSubscription({
  ...active,
  events: [{ telemetryType: 'pre_migration_paper.exit' }]
}), true);
assert.strictEqual(shouldRequestDecisionShadowSubscription({
  ...active,
  decisionShadowEnabled: false,
  events: [{ telemetryType: 'pre_migration_paper.decision' }]
}), false);
assert.strictEqual(shouldPrewarmDecisionShadowSubscription({
  ...active,
  result: { observedInterest: true, state: { mint: 'Mint' } }
}), true);
assert.strictEqual(shouldPrewarmDecisionShadowSubscription({
  ...active,
  result: { state: { mint: 'Mint' } }
}), false);
assert.deepStrictEqual(decisionShadowPrewarmTriggerReasons({
  ...active,
  activePosition: true,
  result: {
    flagged: true,
    newlyConfirmed: true,
    observedSignal: true,
    observedInterest: true,
    state: { mint: 'Mint', confirmed: true }
  }
}), PREWARM_TRIGGER_REASON_ORDER);
assert.deepStrictEqual(decisionShadowPrewarmTriggerReasons({
  ...active,
  paperMode: false,
  result: { flagged: true, state: { mint: 'Mint' } }
}), []);
assert.strictEqual(shouldPrewarmDecisionShadowSubscription({
  ...active,
  activePosition: true,
  result: { state: { mint: 'Mint' } }
}), true);
assert.strictEqual(shouldPrewarmDecisionShadowSubscription({
  ...active,
  paperMode: false,
  result: { flagged: true, state: { mint: 'Mint' } }
}), false);

console.log('Helius decision-shadow subscription policy smoke passed');
