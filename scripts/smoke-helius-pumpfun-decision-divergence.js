#!/usr/bin/env node
'use strict';

const assert = require('assert');
const preregistration = require('../data/strategy-preregistrations/helius-decision-divergence-v1.json');
const { analyzeEvents } = require('./helius-pumpfun-decision-divergence-report');

const sourceTelemetry = 'run-logs/synthetic-decision-shadow.jsonl';
const events = [{
  type: 'session.started',
  timestamp: '2026-07-20T01:00:00.000Z',
  payload: {
    mode: 'PAPER',
    heliusPumpfunShadowPlan: {
      enabled: true,
      strategyConsumptionEnabled: false,
      decisionShadowEnabled: true
    }
  }
}];

for (let index = 0; index < 500; index += 1) {
  events.push({
    type: 'helius_pumpfun.decision_shadow.evaluation',
    timestamp: new Date(Date.parse('2026-07-20T01:00:01.000Z') + index).toISOString(),
    payload: {
      preregistrationId: preregistration.id,
      comparable: true,
      actionAgreement: true,
      reasonAgreement: true,
      shadowStateAgeMs: 25,
      walletComparison: {
        portal: { touched: false },
        helius: { touched: false },
        featureAgreement: index % 10 !== 0,
        trackedAddressAgreement: index % 20 !== 0
      }
    }
  });
}
for (const action of ['ENTRY', 'EXIT']) {
  events.push({
    type: 'helius_pumpfun.decision_shadow.executed_action',
    timestamp: '2026-07-20T01:10:00.000Z',
    payload: {
      preregistrationId: preregistration.id,
      action,
      comparable: true,
      actionAgreement: true,
      reasonAgreement: true
    }
  });
}
events.push({
  type: 'session.stopped',
  timestamp: '2026-07-20T02:00:00.000Z',
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
assert.strictEqual(report.verdict, 'HELIUS_DECISION_SHADOW_PASSED_REPORT_ONLY');
assert.strictEqual(report.counts.comparableGateEvaluations, 500);
assert.strictEqual(report.agreement.gateActionAgreementRate, 1);
assert.strictEqual(report.agreement.executedActionAgreementRate, 1);
assert.ok(report.agreement.walletFeatureAgreementRate < 1);

const entryOnly = analyzeEvents(
  events.filter((event) => event.type !== 'helius_pumpfun.decision_shadow.executed_action' || event.payload.action === 'ENTRY'),
  preregistration,
  parity,
  sourceTelemetry
);
assert.strictEqual(entryOnly.verdict, 'HELIUS_DECISION_SHADOW_INSUFFICIENT_EVIDENCE');
assert.strictEqual(entryOnly.checks.minimumExecutedEntries, true);
assert.strictEqual(entryOnly.checks.minimumExecutedExits, false);

const failedEvents = events.map((event) => ({ ...event, payload: { ...(event.payload || {}) } }));
const evaluation = failedEvents.find((event) => event.type === 'helius_pumpfun.decision_shadow.evaluation');
evaluation.payload.actionAgreement = false;
for (let index = 1; index < 6; index += 1) {
  failedEvents.filter((event) => event.type === 'helius_pumpfun.decision_shadow.evaluation')[index].payload.actionAgreement = false;
}
const failed = analyzeEvents(failedEvents, preregistration, parity, sourceTelemetry);
assert.strictEqual(failed.verdict, 'HELIUS_DECISION_SHADOW_FAILED');

const invalidParity = analyzeEvents(events, preregistration, {
  ...parity,
  verdict: 'HELIUS_SHADOW_PARITY_FAILED',
  checks: { cleanHeliusLifecycle: false }
}, sourceTelemetry);
assert.strictEqual(invalidParity.verdict, 'HELIUS_DECISION_SHADOW_INVALID_RUN');
assert.strictEqual(invalidParity.checks.concurrentV5ParityPassed, false);

console.log('Helius Pump.fun decision divergence smoke passed');
