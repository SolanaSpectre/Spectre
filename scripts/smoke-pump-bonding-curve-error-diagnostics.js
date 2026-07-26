#!/usr/bin/env node
'use strict';

const assert = require('assert');
const PumpBondingCurveLane = require('../src/lib/pump-bonding-curve-lane');

const secret = 'DO_NOT_LEAK_RPC_KEY';
const loggerRows = [];
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
  const lane = new PumpBondingCurveLane(config, logger, connection);
  const summary = await lane.observeMint('11111111111111111111111111111111', { symbol: 'FIX' }, {
    forceRefresh: true
  });
  const stats = lane.getStats();
  const serialized = JSON.stringify({ summary, stats, loggerRows });

  assert.strictEqual(stats.errors, 1);
  assert.strictEqual(stats.rpcBatchErrors, 1);
  assert.strictEqual(stats.errorReasonCounts.NETWORK_TRANSPORT, 1);
  assert.strictEqual(stats.errorMethodCounts.getMultipleAccountsInfo, 1);
  assert.strictEqual(stats.lastErrorDiagnostic.batchSize, 1);
  assert.strictEqual(stats.lastErrorDiagnostic.commitment, 'processed');
  assert.deepStrictEqual(stats.lastErrorDiagnostic.upstreamFailureClasses, ['network']);
  assert.strictEqual(summary.lastErrorMessage, 'NETWORK_TRANSPORT');
  assert(!serialized.includes(secret), 'sanitized curve diagnostics leaked an RPC key');
  assert(!serialized.includes('example.invalid'), 'sanitized curve diagnostics leaked an RPC URL');

  console.log('Pump bonding-curve error diagnostics smoke passed');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
