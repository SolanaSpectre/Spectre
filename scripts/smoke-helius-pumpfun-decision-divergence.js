#!/usr/bin/env node
'use strict';

const assert = require('assert');
const preregistration = require('../data/strategy-preregistrations/helius-decision-divergence-v5.json');
const { analyzeEvents } = require('./helius-pumpfun-decision-divergence-report');

const sourceTelemetry = 'run-logs/synthetic-decision-shadow.jsonl';
const events = [{
  type: 'session.started',
    timestamp: '2026-07-24T03:30:00.000Z',
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
      decisionShadowAccountVerifierTtlMs: preregistration.accountVerifierSelection.requiredTtlMs,
      decisionShadowAccountVerifierSelectionTrigger: preregistration.accountVerifierSelection.selectionTrigger,
      decisionShadowWalletIdentityAlignment: 'pumpportal_signature_alias_then_helius_event_user',
      decisionShadowWalletEvidenceWindow: preregistration.semanticAlignment.walletEvidenceWindow,
      decisionShadowWalletEvidenceTradeCapPerMint: preregistration.semanticAlignment.walletEvidenceTradeCapPerMint,
      eventQueueMaxSize: preregistration.burstControl.eventQueueMaxSize,
      eventQueueBatchSize: preregistration.burstControl.eventQueueBatchSize,
      gateDecisionComparator: preregistration.gateDecisionComparator.name,
      executedActionComparator: preregistration.executedActionComparator.name
    }
  }
}];

for (let index = 0; index < 500; index += 1) {
  events.push({
    type: 'helius_pumpfun.decision_shadow.evaluation',
    timestamp: new Date(Date.parse('2026-07-24T03:30:01.000Z') + index).toISOString(),
    payload: {
      preregistrationId: preregistration.id,
      comparable: true,
      actionAgreement: true,
      reasonAgreement: true,
      shadowStateAgeMs: 25,
      shadowCurveStateSource: 'finalist_account_verifier',
      shadowAccountEnriched: true,
      accountVerifierSubscribed: true,
      accountVerifierHasUpdate: true,
      accountVerifierPrewarmed: true,
      accountVerifierPrewarmLeadMs: 500,
      accountVerifierFirstUpdateBeforeComparison: true,
      walletComparison: {
        portal: { touched: false },
        helius: { touched: false },
        touchedAgreement: true,
        shadowTouchedAgreement: true,
        untrustedTouchedAgreement: true,
        featureAgreement: true,
        trackedAddressAgreement: true
      }
    }
  });
}
for (const action of ['ENTRY', 'EXIT']) {
  events.push({
    type: 'helius_pumpfun.decision_shadow.executed_action',
    timestamp: '2026-07-24T03:40:00.000Z',
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
  timestamp: '2026-07-24T04:30:00.000Z',
  payload: {
    reason: 'SESSION_DURATION_EXCEEDED',
    stats: {
      heliusPumpfunShadow: {
        eventQueueEnqueued: 1000,
        eventQueueProcessed: 1000,
        eventQueueDropped: 0,
        eventQueueDepth: 0,
        eventQueueMaxDepth: 96,
        eventQueueMaxSize: preregistration.burstControl.eventQueueMaxSize,
        eventQueueBatchSize: preregistration.burstControl.eventQueueBatchSize,
        eventQueueDrainYields: 15,
        eventQueueHandlerErrors: 0,
        eventQueueLatencySamples: 1000,
        eventQueueLatencyMeanMs: 2.5,
        eventQueueLatencyMaxMs: 18,
        eventQueueStopDrainTimedOut: false
      }
    }
  }
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
assert.strictEqual(report.checks.correctAccountVerifierTtl, true);
assert.strictEqual(report.checks.correctAccountVerifierSelectionTrigger, true);
assert.strictEqual(report.checks.correctWalletEvidenceWindow, true);
assert.strictEqual(report.checks.correctWalletEvidenceTradeCap, true);
assert.strictEqual(report.checks.correctHeliusQueueMaxSize, true);
assert.strictEqual(report.checks.correctHeliusQueueBatchSize, true);
assert.strictEqual(report.checks.noHeliusQueueDrops, true);
assert.strictEqual(report.checks.heliusQueueStatsAvailable, true);
assert.strictEqual(report.checks.heliusQueueDrainedCleanly, true);
assert.strictEqual(report.heliusEventQueue.maxDepthRatio, 0.0048);
assert.strictEqual(report.heliusEventQueue.latencyMaxMs, 18);
assert.strictEqual(report.counts.accountEnrichedGateEvaluations, 500);
assert.strictEqual(report.counts.accountVerifierPrewarmedEvaluations, 500);
assert.strictEqual(report.agreement.prewarmedComparableEvaluationCoverageRate, 1);

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

const wrongTtlEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
wrongTtlEvents[0].payload.heliusPumpfunShadowPlan = {
  ...wrongTtlEvents[0].payload.heliusPumpfunShadowPlan,
  decisionShadowAccountVerifierTtlMs: 180000
};
const wrongTtl = analyzeEvents(wrongTtlEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(wrongTtl.verdict, preregistration.invalidVerdict);
assert.strictEqual(wrongTtl.checks.correctAccountVerifierTtl, false);

const queueDropEvents = events.concat([{
  type: 'provider.helius_pumpfun.shadow_event_queue_overflow',
  timestamp: '2026-07-24T03:50:00.000Z',
  payload: { dropped: 1, queueDepth: 20000, maxQueueSize: 20000 }
}]);
const queueDrop = analyzeEvents(queueDropEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(queueDrop.verdict, preregistration.invalidVerdict);
assert.strictEqual(queueDrop.checks.noHeliusQueueDrops, false);
assert.strictEqual(queueDrop.counts.heliusQueueFailures, 1);

const finalStatsDropEvents = events.map((event) => ({
  ...event,
  payload: {
    ...(event.payload || {}),
    stats: event.payload?.stats
      ? {
        ...event.payload.stats,
        heliusPumpfunShadow: {
          ...event.payload.stats.heliusPumpfunShadow,
          eventQueueDropped: 1
        }
      }
      : event.payload?.stats
  }
}));
const finalStatsDrop = analyzeEvents(finalStatsDropEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(finalStatsDrop.verdict, preregistration.invalidVerdict);
assert.strictEqual(finalStatsDrop.checks.noHeliusQueueDrops, false);

console.log('Helius Pump.fun decision divergence smoke passed');
