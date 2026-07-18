#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildReport } = require('./pumpportal-paid-tape-demand-report');

const filePath = path.join(os.tmpdir(), `spectre-paid-demand-${process.pid}.jsonl`);
const rows = [
  { type: 'session.started', timestamp: '2026-07-18T12:00:00.000Z', payload: { pumpPortalPaidTapePlan: { targetedMaxCurveProgress: 0.9 } } },
  { type: 'pump_bonding_curve.updated', timestamp: '2026-07-18T12:00:01.000Z', payload: { mint: 'A', curveProgress: 0.4, complete: false } },
  { type: 'provider.pumpportal.targeted_subscription', timestamp: '2026-07-18T12:00:01.000Z', payload: { mint: 'A', curveProgress: 0.4, activeSubscriptions: 1 } },
  { type: 'provider.pumpportal.trade', timestamp: '2026-07-18T12:00:02.000Z', payload: { mint: 'A' } },
  { type: 'provider.pumpportal.trade', timestamp: '2026-07-18T12:00:03.000Z', payload: { mint: 'A' } },
  { type: 'pre_migration.flagged', timestamp: '2026-07-18T12:00:03.500Z', payload: { mint: 'A' } },
  { type: 'pre_migration_paper.entry', timestamp: '2026-07-18T12:00:03.600Z', payload: { mint: 'A', lane: 'PRE_MIGRATION_RUNNER_WATCH' } },
  { type: 'pre_migration_paper.exit', timestamp: '2026-07-18T12:00:04.000Z', payload: { mint: 'A', lane: 'PRE_MIGRATION_RUNNER_WATCH' } },
  { type: 'provider.pumpportal.migration', timestamp: '2026-07-18T12:00:04.500Z', payload: { mint: 'A' } },
  { type: 'provider.pumpportal.trade', timestamp: '2026-07-18T12:00:05.000Z', payload: { mint: 'A' } },
  { type: 'provider.pumpportal.metered_budget_reached', timestamp: '2026-07-18T12:01:00.000Z', payload: { meteredTradeEvents: 3 } },
  { type: 'session.stopped', timestamp: '2026-07-18T12:01:01.000Z', payload: { stats: { pumpPortal: { targetedTradeSubscriptionAccepted: 1, maxSubscribedMints: 100 } } } }
];
fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
try {
  const report = buildReport(filePath);
  assert.strictEqual(report.concentration.eventCount, 3);
  const terminalPolicy = report.policies.find((row) => row.floor === 0.4 && row.name === 'floor_terminal_ttl30m');
  assert.strictEqual(terminalPolicy.observedEvents, 2, 'terminal release must exclude post-migration trades');
  assert.strictEqual(terminalPolicy.fullOutcomeWindowPaperEntries, 0);
  assert.strictEqual(report.actual.concurrencyCeilingEnforced, true);
  const stateAware = report.stateAwarePolicies.find((row) => row.floor === 0.35 && row.preEvaluationEventCap === 500);
  assert.strictEqual(stateAware.coveredPaperEntries, 1);
  assert.strictEqual(stateAware.coveredPaperExits, 1);
  assert.strictEqual(report.exitPathAudit.verdict, 'RPC_ONLY_EXIT_AND_OUTCOME_PATH_NOT_RUNTIME_READY');
} finally {
  fs.rmSync(filePath, { force: true });
}

console.log('PumpPortal paid-tape demand smoke passed');
