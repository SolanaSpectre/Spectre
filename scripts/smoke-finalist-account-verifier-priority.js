#!/usr/bin/env node
'use strict';

const assert = require('assert');
const FinalistAccountVerifier = require('../src/lib/finalist-account-verifier');

async function main() {
  let nextSubscriptionId = 1;
  const lifecycle = [];
  const verifier = new FinalistAccountVerifier({
    pumpBondingCurveProgramId: '11111111111111111111111111111111',
    finalistAccountVerifierEnabled: true,
    finalistAccountVerifierMaxSubscriptions: 2,
    finalistAccountVerifierTtlMs: 120000,
    finalistAccountVerifierInitialSnapshotEnabled: false
  }, { warn() {} }, {
    connection: {
      onAccountChange() {
        const id = nextSubscriptionId;
        nextSubscriptionId += 1;
        return id;
      },
      removeAccountChangeListener() {}
    },
    deriveBondingCurveAddress(mint) {
      return {
        A: 'So11111111111111111111111111111111111111112',
        B: 'SysvarRent111111111111111111111111111111111',
        C: 'SysvarC1ock11111111111111111111111111111111',
        D: 'SysvarRecentB1ockHashes11111111111111111111'
      }[mint];
    },
    telemetryHook(type, payload) {
      lifecycle.push({ type, payload });
    }
  });

  assert.strictEqual(await verifier.maybeSubscribe(
    { mint: 'A' },
    { reportOnlyDecisionShadowPrewarm: true }
  ), true);
  assert.strictEqual(await verifier.maybeSubscribe(
    { mint: 'B' },
    { reportOnlyDecisionShadowPrewarm: true }
  ), true);
  assert.strictEqual(verifier.getStats().active, 2);
  verifier.subscriptions.get('A').prewarmRequestedAt = 100;
  verifier.subscriptions.get('B').prewarmRequestedAt = 200;
  const duplicatePrewarmExpiry = verifier.subscriptions.get('A').expiresAt;
  assert.strictEqual(await verifier.maybeSubscribe(
    { mint: 'A' },
    { reportOnlyDecisionShadowPrewarm: true }
  ), true);
  assert.strictEqual(
    verifier.subscriptions.get('A').expiresAt,
    duplicatePrewarmExpiry,
    'duplicate prewarm must not extend TTL'
  );

  assert.strictEqual(await verifier.maybeSubscribe(
    { mint: 'C' },
    { reportOnlyDecisionShadowCandidate: true }
  ), true);
  assert.strictEqual(verifier.getSubscriptionStatus('A').subscribed, false);
  assert.strictEqual(verifier.getSubscriptionStatus('C').selectionClass, 'decision_shadow_candidate');
  assert.strictEqual(verifier.getStats().decisionShadowPriorityEvictions, 1);

  assert.strictEqual(await verifier.maybeSubscribe(
    { mint: 'B' },
    { reportOnlyDecisionShadowCandidate: true }
  ), true);
  const upgraded = verifier.getSubscriptionStatus('B');
  assert.strictEqual(upgraded.selectionClass, 'decision_shadow_candidate');
  assert.strictEqual(upgraded.prewarmed, true);
  assert(Number.isFinite(upgraded.prewarmLeadMs));
  assert.strictEqual(verifier.getStats().decisionShadowCandidateUpgrades, 1);

  assert.strictEqual(await verifier.maybeSubscribe(
    { mint: 'D' },
    { reportOnlyDecisionShadowPrewarm: true }
  ), false);
  assert.strictEqual(verifier.getStats().decisionShadowPrewarmCapacitySkips, 1);
  assert(lifecycle.some((row) => (
    row.type === 'finalist_account_verifier.skipped'
    && row.payload.reason === 'MAX_SUBSCRIPTIONS_PREWARM'
  )));

  console.log('Finalist account verifier priority smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
