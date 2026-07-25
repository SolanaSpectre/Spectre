'use strict';

const COMPARISON_EVENT_TYPES = new Set([
  'pre_migration_paper.decision',
  'pre_migration_paper.entry',
  'pre_migration_paper.exit'
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

function shouldPrewarmDecisionShadowSubscription(options = {}) {
  if (!decisionShadowVerifierPolicyActive(options)) return false;
  const result = options.result || {};
  const state = result.state || options.state || {};
  return Boolean(
    result.flagged === true
    || result.observedInterest === true
    || result.observedSignal === true
    || result.newlyConfirmed === true
    || result.confirmed === true
    || state.confirmed === true
    || options.activePosition === true
  );
}

module.exports = {
  COMPARISON_EVENT_TYPES,
  decisionShadowVerifierPolicyActive,
  hasDecisionShadowComparisonEvent,
  shouldPrewarmDecisionShadowSubscription,
  shouldRequestDecisionShadowSubscription
};
