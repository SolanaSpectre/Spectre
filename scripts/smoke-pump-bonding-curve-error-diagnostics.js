#!/usr/bin/env node
'use strict';

const assert = require('assert');
const PumpBondingCurveLane = require('../src/lib/pump-bonding-curve-lane');

const secret = 'DO_NOT_LEAK_RPC_KEY';
const loggerRows = [];
const telemetryRows = [];
const logger = {
  warn(message, payload) {
    loggerRows.push({ message, payload });
  }
};
const connection = {
  async getMultipleAccountsInfo() {
    const error = new Error(`RPC failed at https://example.invalid/?api-key=${secret}`);
    error.name = 'FetchError';
    error.rpcFailureClasses = [{ target: 'primary', errorClass: 'network' }];
    throw error;
  }
};
const config = {
  pumpBondingCurveLaneEnabled: true,
  pumpBondingCurveRefreshIntervalMs: 1000,
  pumpBondingCurveFailureCooldownMs: 1000,
  pumpBondingCurveGlobalBackoffMs: 30000,
  pumpBondingCurveGlobalBackoffErrorThreshold: 5,
  pumpBondingCurveGlobalBackoffWindowMs: 15000,
  pumpBondingCurveGlobalBackoffHighCurveBypassProgress: 0.85,
  pumpBondingCurveMaxTrackedMints: 100,
  pumpBondingCurveMaxFetchesPerCycle: 10,
  pumpBondingCurveBatchFetchEnabled: true,
  pumpBondingCurveBatchFlushMs: 0,
  pumpBondingCurveBatchMaxAccounts: 25,
  pumpBondingCurveRpcCommitment: 'processed',
  preMigrationWatchMinCurveProgress: 0.6
};

async function main() {
  const lane = new PumpBondingCurveLane(config, logger, connection, {
    getSessionPhase: () => 'ACTIVE',
    telemetryHook: (type, payload) => telemetryRows.push({ type, payload })
  });
  const summary = await lane.observeMint('11111111111111111111111111111111', { symbol: 'FIX' }, {
    forceRefresh: true
  });
  const stats = lane.getStats();
  const serialized = JSON.stringify({ summary, stats, loggerRows });

  assert.strictEqual(stats.errors, 1);
  assert.strictEqual(stats.activePhaseErrors, 1);
  assert.strictEqual(stats.stoppingPhaseErrors, 0);
  assert.strictEqual(stats.shutdownCancelledErrors, 0);
  assert.strictEqual(stats.errorSessionPhaseCounts.ACTIVE, 1);
  assert.strictEqual(stats.rpcBatchErrors, 1);
  assert.strictEqual(stats.errorReasonCounts.NETWORK_TRANSPORT, 1);
  assert.strictEqual(stats.errorMethodCounts.getMultipleAccountsInfo, 1);
  assert.strictEqual(stats.lastErrorDiagnostic.batchSize, 1);
  assert.strictEqual(stats.lastErrorDiagnostic.commitment, 'processed');
  assert.deepStrictEqual(stats.lastErrorDiagnostic.upstreamFailureClasses, ['network']);
  assert.strictEqual(summary.lastErrorMessage, 'NETWORK_TRANSPORT');
  assert.strictEqual(telemetryRows[0].type, 'pump_bonding_curve.lookup_error');
  assert.strictEqual(telemetryRows[0].payload.sessionPhase, 'ACTIVE');
  assert(!serialized.includes(secret), 'sanitized curve diagnostics leaked an RPC key');
  assert(!serialized.includes('example.invalid'), 'sanitized curve diagnostics leaked an RPC URL');

  const stoppingTelemetry = [];
  const stoppingLane = new PumpBondingCurveLane(config, logger, connection, {
    getSessionPhase: () => 'STOPPING',
    telemetryHook: (type, payload) => stoppingTelemetry.push({ type, payload })
  });
  const stoppingSummary = await stoppingLane.observeMint(
    '11111111111111111111111111111111',
    { symbol: 'STOP' },
    { forceRefresh: true }
  );
  const stoppingStats = stoppingLane.getStats();
  assert.strictEqual(stoppingStats.errors, 1, 'total error count must retain shutdown diagnostics');
  assert.strictEqual(stoppingStats.activePhaseErrors, 0);
  assert.strictEqual(stoppingStats.stoppingPhaseErrors, 1);
  assert.strictEqual(stoppingStats.shutdownCancelledErrors, 1);
  assert.strictEqual(stoppingStats.errorSessionPhaseCounts.STOPPING, 1);
  assert.strictEqual(stoppingSummary.lastErrorMessage, 'SHUTDOWN_CANCELLED');
  assert.strictEqual(stoppingSummary.lastErrorDiagnostic.originalReason, 'NETWORK_TRANSPORT');
  assert.strictEqual(stoppingTelemetry[0].payload.sessionPhase, 'STOPPING');
  assert.strictEqual(stoppingTelemetry[0].payload.shutdownCancelled, true);

  console.log('Pump bonding-curve error diagnostics smoke passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
