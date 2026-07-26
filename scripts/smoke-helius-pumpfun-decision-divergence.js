#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const TradingEngine = require('../src/trading-engine');
const {
  analyzeEvents,
  loadPreregistration
} = require('./helius-pumpfun-decision-divergence-report');
const preregistration = loadPreregistration();
assert.strictEqual(
  preregistration.entryMismatchAttribution.allowedAttributedCauses.includes(
    'POSITION_OCCUPANCY_MISMATCH'
  ),
  false
);
assert.strictEqual(preregistration.entryMismatchAttribution.minimumMismatches, 1);
assert.strictEqual(
  preregistration.entryMismatchAttribution.allowedAttributedCauses.includes(
    'PRESET_FAMILY_MISMATCH'
  ),
  false
);
assert.strictEqual(
  preregistration.executedActionComparator.name,
  'gate_coupled_same_guard_path_entry_and_same_instant_exit_with_actual_lane_context'
);

const comparatorHarness = Object.create(TradingEngine.prototype);
assert.strictEqual(comparatorHarness.decisionShadowCurveRegimeBucket(null), 'UNKNOWN');
assert.strictEqual(comparatorHarness.decisionShadowCurveRegimeBucket(undefined), 'UNKNOWN');
assert.strictEqual(comparatorHarness.decisionShadowCurveRegimeBucket(0), 'LT_25');
const guardInputs = comparatorHarness.decisionShadowGuardFamilyInputs(
  { guardOverride: null },
  {},
  'runnerWatch',
  {
    score: 88,
    curveProgress: 0.77,
    recentVolumeSol: 12.5,
    tradeVelocityPerMin: 44,
    uniqueBuyerCount: 31,
    sniperWalletCount: 2
  }
);
assert.strictEqual(guardInputs.curveRegimeBucket, '75_TO_90');
assert.strictEqual(guardInputs.market.score, 88);
assert.strictEqual(guardInputs.market.recentVolumeSol, 12.5);

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine.js'), 'utf8');
const evaluationEmitterStart = engineSource.indexOf(
  "this.telemetry.record('helius_pumpfun.decision_shadow.evaluation'"
);
assert(evaluationEmitterStart >= 0, 'decision-shadow evaluation emitter must exist');
const evaluationEmitter = engineSource.slice(evaluationEmitterStart, evaluationEmitterStart + 8000);
for (const field of preregistration.decisionComparabilityDiagnostics.requiredFields) {
  assert(
    new RegExp(`\\b${field}\\s*[, :]`).test(evaluationEmitter),
    `V8 inherited required diagnostic field must be emitted: ${field}`
  );
}
const executedEmitterStart = engineSource.indexOf(
  "this.telemetry.record('helius_pumpfun.decision_shadow.executed_action'"
);
assert(executedEmitterStart >= 0, 'decision-shadow executed-action emitter must exist');
const executedEmitter = engineSource.slice(executedEmitterStart, executedEmitterStart + 7000);
assert(/\bpositionContextPolicy\s*:/.test(executedEmitter));
assert(/\bindependentShadowPositionStateAvailable\s*:\s*false/.test(executedEmitter));
assert.strictEqual(executedEmitter.includes('shadowPositionOccupiedAtDecision'), false);
assert.strictEqual(executedEmitter.includes('actualPositionOccupiedAtDecision'), false);

const sourceTelemetry = 'run-logs/synthetic-decision-shadow.jsonl';
const events = [{
  type: 'session.started',
    timestamp: '2026-07-27T14:30:00.000Z',
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
  const enter = index < 20;
  events.push({
    type: 'helius_pumpfun.decision_shadow.evaluation',
    timestamp: new Date(Date.parse('2026-07-27T14:30:01.000Z') + index).toISOString(),
    payload: {
      preregistrationId: preregistration.id,
      pairedDecisionKey: index === 0 ? 'fixture-entry' : `fixture-${index}`,
      mint: `fixture-mint-${index}`,
      preset: 'runnerWatch',
      comparable: true,
      actualAction: enter ? 'WOULD_ENTER' : 'WOULD_SKIP',
      shadowAction: enter ? 'WOULD_ENTER' : 'WOULD_SKIP',
      actionAgreement: true,
      reasonAgreement: true,
      shadowStateAgeMs: 25,
      bestAvailableStateAgeMs: 25,
      bestAvailableStateSource: 'finalist_account_verifier',
      shadowCurveStateSource: 'finalist_account_verifier',
      actualEvaluatedPreset: 'runnerWatch',
      shadowEvaluatedPreset: 'runnerWatch',
      guardOverrideAllowListAgreement: true,
      actualGuardOverrideEligibilityState: 'NO_OVERRIDE_FAMILY_SELECTED',
      shadowGuardOverrideEligibilityState: 'NO_OVERRIDE_FAMILY_SELECTED',
      guardOverridePathAgreement: true,
      actualGuardFamilyInputs: { selectedFamily: null, curveRegimeBucket: '50_TO_75' },
      shadowGuardFamilyInputs: { selectedFamily: null, curveRegimeBucket: '50_TO_75' },
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
    timestamp: '2026-07-27T14:40:00.000Z',
    payload: {
      preregistrationId: preregistration.id,
      action,
      pairedDecisionKey: action === 'ENTRY' ? 'fixture-entry' : null,
      mint: 'fixture-mint-0',
      preset: 'runnerWatch',
      positionKey: 'runnerWatch:FixtureMint',
      actualPnlSol: action === 'EXIT' ? 0.01 : null,
      comparable: true,
      actionAgreement: true,
      shadowAction: action === 'ENTRY' ? 'ENTRY' : 'EXIT',
      reasonAgreement: true,
      shadowStateAgeMs: 25,
      bestAvailableStateAgeMs: 25,
      bestAvailableStateSource: 'finalist_account_verifier',
      shadowCurveStateSource: 'finalist_account_verifier',
      shadowAccountEnriched: true,
      positionContextOccupiedAtDecision: false,
      positionContextPresetAtDecision: null,
      positionContextPolicy: 'actual_pre_observation_context_held_constant',
      independentShadowPositionStateAvailable: false,
      actualPresetFamily: 'runnerWatch',
      shadowPresetFamily: 'runnerWatch',
      guardOverridePathAgreement: true,
      comparator: preregistration.executedActionComparator.name
    }
  });
}
events.push({
  type: 'session.stopped',
  timestamp: '2026-07-27T15:30:00.000Z',
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
assert.strictEqual(report.verdict, preregistration.insufficientVerdict);
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
assert.strictEqual(report.entryConfusionMatrix.actualEnterShadowEnter, 20);
assert.strictEqual(report.entryConfusionMatrix.actualSkipShadowSkip, 480);
assert.strictEqual(report.entryConfusionMatrix.shadowEntryPrecision, 1);
assert.strictEqual(report.entryConfusionMatrix.shadowEntryRecall, 1);
assert.strictEqual(report.executedPnlAttribution.available, true);
assert.strictEqual(report.executedPnlAttribution.shadowWouldEnter.actualPnlSol, 0.01);
assert.strictEqual(report.executedPnlAttribution.evidenceLabel, 'NOT_EVIDENCE_FOR_EXECUTION');
assert.strictEqual(report.entryMismatchAttribution.mismatches, 0);
assert.strictEqual(report.entryMismatchAttribution.allMismatchesAttributed, false);
assert.strictEqual(report.counts.observedExecutedEntries, 1);
assert.strictEqual(report.counts.comparableExecutedEntries, 1);
assert.strictEqual(report.checks.minimumComparableExecutedEntriesForAttribution, true);
assert.strictEqual(report.checks.minimumEntryMismatchesForAttribution, false);
assert.strictEqual(report.agreementByStateAge[0].bucket, 'LTE_100_MS');
assert.strictEqual(report.offlineComparabilityByBound[0].coverageRate, 1);

const staleEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
for (const event of staleEvents) {
  if (event.type.startsWith('helius_pumpfun.decision_shadow.')) {
    event.payload.comparable = false;
    event.payload.shadowStateAgeMs = preregistration.maximumShadowStateAgeMs + 1;
    event.payload.bestAvailableStateAgeMs = preregistration.maximumShadowStateAgeMs + 1;
    event.payload.bestAvailableStateSource = 'helius_trade_state';
    event.payload.unavailableReason = 'HELIUS_SHADOW_STATE_STALE';
  }
}
const stale = analyzeEvents(staleEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(stale.verdict, preregistration.insufficientVerdict);
assert.strictEqual(stale.counts.comparableGateEvaluations, 0);
assert.strictEqual(stale.counts.comparableExecutedActions, 0);
assert.strictEqual(stale.unavailableStateAgeDiagnostics.histogram.GT_1000_TO_2000_MS, 500);

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
assert.strictEqual(failed.verdict, preregistration.insufficientVerdict);

const attributedEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
const attributedEntry = attributedEvents.find(
  (event) => event.type === 'helius_pumpfun.decision_shadow.executed_action'
    && event.payload.action === 'ENTRY'
);
attributedEntry.payload.actionAgreement = false;
attributedEntry.payload.shadowAction = 'NO_ENTRY';
const attributedEvaluation = attributedEvents.find(
  (event) => event.type === 'helius_pumpfun.decision_shadow.evaluation'
    && event.payload.pairedDecisionKey === 'fixture-entry'
);
attributedEvaluation.payload.guardOverrideAllowListAgreement = false;
const attributed = analyzeEvents(attributedEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(attributed.verdict, preregistration.passVerdict);
assert.strictEqual(attributed.entryMismatchAttribution.mismatches, 1);
assert.strictEqual(
  attributed.entryMismatchAttribution.rows[0].cause,
  'GUARD_ALLOW_LIST_MISMATCH'
);

const unattributedEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
const unattributedEntry = unattributedEvents.find(
  (event) => event.type === 'helius_pumpfun.decision_shadow.executed_action'
    && event.payload.action === 'ENTRY'
);
unattributedEntry.payload.actionAgreement = false;
unattributedEntry.payload.shadowAction = 'NO_ENTRY';
const unattributed = analyzeEvents(unattributedEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(unattributed.verdict, preregistration.failVerdict);
assert.strictEqual(unattributed.entryMismatchAttribution.unattributedMismatches, 1);
assert.strictEqual(unattributed.entryMismatchAttribution.rows[0].cause, 'UNATTRIBUTED');

const crossPathEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
const crossPathEntry = crossPathEvents.find(
  (event) => event.type === 'helius_pumpfun.decision_shadow.executed_action'
    && event.payload.action === 'ENTRY'
);
crossPathEntry.payload.comparable = false;
crossPathEntry.payload.guardOverridePathAgreement = false;
crossPathEntry.payload.unavailableReason = 'COUNTERFACTUAL_GUARD_PATH_MISMATCH';
crossPathEntry.payload.actionAgreement = null;
const crossPath = analyzeEvents(crossPathEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(crossPath.verdict, preregistration.insufficientVerdict);
assert.strictEqual(crossPath.counts.observedExecutedEntries, 1);
assert.strictEqual(crossPath.counts.comparableExecutedEntries, 0);
assert.strictEqual(
  crossPath.unavailableExecutedReasons.COUNTERFACTUAL_GUARD_PATH_MISMATCH,
  1
);

const invalidParity = analyzeEvents(events, preregistration, {
  ...parity,
  verdict: 'HELIUS_SHADOW_PARITY_FAILED',
  checks: { cleanHeliusLifecycle: false }
}, sourceTelemetry);
assert.strictEqual(invalidParity.verdict, preregistration.invalidVerdict);
assert.strictEqual(invalidParity.checks.concurrentV5ParityPassed, false);
assert.strictEqual(invalidParity.executedPnlAttribution.available, false);
assert.strictEqual(invalidParity.executedPnlAttribution.shadowWouldEnter.actualPnlSol, null);

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
  timestamp: '2026-07-27T14:50:00.000Z',
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
