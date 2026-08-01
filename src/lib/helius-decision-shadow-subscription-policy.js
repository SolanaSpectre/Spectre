'use strict';

const COMPARISON_EVENT_TYPES = new Set([
  'pre_migration_paper.decision',
  'pre_migration_paper.entry',
  'pre_migration_paper.exit'
]);

const PREWARM_TRIGGER_REASON_ORDER = Object.freeze([
  'FLAGGED',
  'NEWLY_CONFIRMED',
  'CONFIRMED',
  'OBSERVED_SIGNAL',
  'OBSERVED_INTEREST',
  'ACTIVE_POSITION'
]);

function decisionShadowVerifierPolicyActive({
  heliusShadowEnabled = false,
  decisionShadowEnabled = false,
  paperMode = false
} = {}) {
  return heliusShadowEnabled === true
    && decisionShadowEnabled === true
    && paperMode === true;
}

function hasDecisionShadowComparisonEvent(events = []) {
  return events.some((event) => COMPARISON_EVENT_TYPES.has(event?.telemetryType));
}

function shouldRequestDecisionShadowSubscription(options = {}) {
  return decisionShadowVerifierPolicyActive(options)
    && hasDecisionShadowComparisonEvent(options.events);
}

function decisionShadowPrewarmTriggerReasons(options = {}) {
  if (!decisionShadowVerifierPolicyActive(options)) return [];
  const result = options.result || {};
  const state = result.state || options.state || {};
  const activeReasons = new Set();
  if (result.flagged === true) activeReasons.add('FLAGGED');
  if (result.newlyConfirmed === true) activeReasons.add('NEWLY_CONFIRMED');
  if (result.confirmed === true || state.confirmed === true) activeReasons.add('CONFIRMED');
  if (result.observedSignal === true) activeReasons.add('OBSERVED_SIGNAL');
  if (result.observedInterest === true) activeReasons.add('OBSERVED_INTEREST');
  if (options.activePosition === true) activeReasons.add('ACTIVE_POSITION');
  return PREWARM_TRIGGER_REASON_ORDER.filter((reason) => activeReasons.has(reason));
}

function shouldPrewarmDecisionShadowSubscription(options = {}) {
  return decisionShadowPrewarmTriggerReasons(options).length > 0;
}

module.exports = {
  COMPARISON_EVENT_TYPES,
  PREWARM_TRIGGER_REASON_ORDER,
  decisionShadowPrewarmTriggerReasons,
  decisionShadowVerifierPolicyActive,
  hasDecisionShadowComparisonEvent,
  shouldPrewarmDecisionShadowSubscription,
  shouldRequestDecisionShadowSubscription
};
