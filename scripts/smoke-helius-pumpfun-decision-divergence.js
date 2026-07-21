#!/usr/bin/env node
'use strict';

const assert = require('assert');
const preregistration = require('../data/strategy-preregistrations/helius-decision-divergence-v4.json');
const { analyzeEvents } = require('./helius-pumpfun-decision-divergence-report');

const sourceTelemetry = 'run-logs/synthetic-decision-shadow.jsonl';
const events = [{
  type: 'session.started',
    timestamp: '2026-07-21T03:30:00.000Z',
  payload: {
    mode: 'PAPER',
    pumpPortalPaidTapePlan: {
      tradeSubscriptionMode: preregistration.paidTapePlan.tradeSubscriptionMode,
      maxMeteredTradeEventsPerSession: preregistration.paidTapePlan.maxMeteredTradeEventsPerSession
    },
    heliusPumpfunShadowPlan: {
      enabled: true,
      strategyConsumptionEnabled: false,
      decisionShadowEnabled: true,
      decisionShadowPreregistrationId: preregistration.id,
      decisionShadowMaximumStateAgeMs: preregistration.maximumShadowStateAgeMs,
      decisionShadowRecentTradeCap: preregistration.semanticAlignment.recentTradeCap,
      decisionShadowAccountStateEnrichment: 'finalist_account_verifier_latest_update',
      decisionShadowAccountVerifierMaxSubscriptions: preregistration.accountVerifierSelection.minimumMaxSubscriptions,
      decisionShadowWalletIdentityAlignment: 'pumpportal_signature_alias_then_helius_event_user',
      gateDecisionComparator: preregistration.gateDecisionComparator.name,
      executedActionComparator: preregistration.executedActionComparator.name
    }
  }
}];

for (let index = 0; index < 500; index += 1) {
  events.push({
    type: 'helius_pumpfun.decision_shadow.evaluation',
    timestamp: new Date(Date.parse('2026-07-21T03:30:01.000Z') + index).toISOString(),
    payload: {
      preregistrationId: preregistration.id,
      comparable: true,
      actionAgreement: true,
      reasonAgreement: true,
      shadowStateAgeMs: 25,
      shadowCurveStateSource: 'finalist_account_verifier',
      shadowAccountEnriched: true,
      walletComparison: {
        portal: { touched: false },
        helius: { touched: false },
        featureAgreement: true,
        trackedAddressAgreement: true
      }
    }
  });
}
for (const action of ['ENTRY', 'EXIT']) {
  events.push({
    type: 'helius_pumpfun.decision_shadow.executed_action',
    timestamp: '2026-07-21T03:40:00.000Z',
    payload: {
      preregistrationId: preregistration.id,
      action,
      comparable: true,
      actionAgreement: true,
      reasonAgreement: true,
      shadowStateAgeMs: 25,
      shadowCurveStateSource: 'finalist_account_verifier',
      shadowAccountEnriched: true,
      comparator: preregistration.executedActionComparator.name
    }
  });
}
events.push({
  type: 'session.stopped',
  timestamp: '2026-07-21T04:30:00.000Z',
  payload: { reason: 'SESSION_DURATION_EXCEEDED' }
});

const parity = {
  sourceTelemetry,
  verdict: 'HELIUS_SHADOW_PARITY_PASSED',
  checks: { cleanHeliusLifecycle: true },
  counts: { eligibleMintHours: 100 },
  agreement: {
    mintHourPortalTradeIdentityRecallPassRate: 1,
    mintHourVolumePassRate: 1,
    curvePassRate: 1
  }
};
const report = analyzeEvents(events, preregistration, parity, sourceTelemetry);
assert.strictEqual(report.verdict, preregistration.passVerdict);
assert.strictEqual(report.counts.comparableGateEvaluations, 500);
assert.strictEqual(report.agreement.gateActionAgreementRate, 1);
assert.strictEqual(report.agreement.executedActionAgreementRate, 1);
assert.strictEqual(report.agreement.walletFeatureAgreementRate, 1);
assert.strictEqual(report.checks.correctPaidTapeBudget, true);
assert.strictEqual(report.counts.accountEnrichedGateEvaluations, 500);

const staleEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
for (const event of staleEvents) {
  if (event.type.startsWith('helius_pumpfun.decision_shadow.')) {
    event.payload.comparable = false;
    event.payload.shadowStateAgeMs = preregistration.maximumShadowStateAgeMs + 1;
  }
}
const stale = analyzeEvents(staleEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(stale.verdict, preregistration.insufficientVerdict);
assert.strictEqual(stale.counts.comparableGateEvaluations, 0);
assert.strictEqual(stale.counts.comparableExecutedActions, 0);

const entryOnly = analyzeEvents(
  events.filter((event) => event.type !== 'helius_pumpfun.decision_shadow.executed_action' || event.payload.action === 'ENTRY'),
  preregistration,
  parity,
  sourceTelemetry
);
assert.strictEqual(entryOnly.verdict, preregistration.insufficientVerdict);
assert.strictEqual(entryOnly.checks.minimumExecutedEntries, true);
assert.strictEqual(entryOnly.checks.minimumExecutedExits, false);

const failedEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
const evaluation = failedEvents.find((event) => event.type === 'helius_pumpfun.decision_shadow.evaluation');
evaluation.payload.actionAgreement = false;
for (let index = 1; index < 6; index += 1) {
  failedEvents.filter((event) => event.type === 'helius_pumpfun.decision_shadow.evaluation')[index].payload.actionAgreement = false;
}
const failed = analyzeEvents(failedEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(failed.verdict, preregistration.failVerdict);

const invalidParity = analyzeEvents(events, preregistration, {
  ...parity,
  verdict: 'HELIUS_SHADOW_PARITY_FAILED',
  checks: { cleanHeliusLifecycle: false }
}, sourceTelemetry);
assert.strictEqual(invalidParity.verdict, preregistration.invalidVerdict);
assert.strictEqual(invalidParity.checks.concurrentV5ParityPassed, false);

console.log('Helius Pump.fun decision divergence smoke passed');
