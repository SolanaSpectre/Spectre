#!/usr/bin/env node
'use strict';

const assert = require('assert');

process.env.SPECTRE_SKIP_DOTENV = 'true';
const { buildVerdict } = require('./live-readiness-report');

const stats = {
  lastStopStats: {
    hotWalletBalanceSol: 0,
    pumpDev: {
      closeEvents: 0,
      errorEvents: 0,
      eventQueueDropped: 0,
      eventQueueErrors: 0
    },
    solanaRpc: {
      stats: {
        callTelemetryStarted: 25,
        callTelemetryFailed: 0
      }
    },
    finalistAccountVerifier: {
      subscribed: 1,
      updates: 1,
      subscribeErrors: 0,
      initialSnapshotErrors: 0,
      decodeErrors: 0,
      shadowGateReady: 1,
      shadowGateChecks: 1
    },
    liveExecutionDryRun: {
      attempts: 20,
      wouldSend: 20,
      wouldBlock: 0,
      errors: 0,
      simulationFailed: 0,
      amountSol: 0.1
    },
    preMigrationPaper: {
      entries: 1,
      exits: 1,
      totalPnlSol: 0.01
    }
  },
  rpc: { started: 25, failed: 0 },
  pumpDev: { closes: 0, errors: 0 },
  eventLoop: {
    summary: { maxLagMs: 0, lagEvents: 0 },
    maxLagMs: 0,
    lagEvents: 0
  },
  telemetryStartMs: 0,
  telemetryEndMs: 3_600_000,
  dryRun: {
    attempts: 20,
    wouldSend: 20,
    wouldBlock: 0,
    errors: 0,
    simulationErrors: {},
    blockReasons: {},
    signedOk: { true: 20, false: 0, null: 0 },
    broadcastEnabled: { true: 0, false: 20, null: 0 }
  },
  finalist: {
    subscribed: 1,
    updates: 1,
    errors: 0,
    initialErrors: 0,
    invalid: 0,
    shadowReady: 1,
    shadowChecks: 1
  },
  paper: { entries: 1, exits: 1, pnlSol: 0.01 },
  currentHotWalletBalanceSol: null
};

const verdict = buildVerdict(stats);
assert.strictEqual(verdict.metrics.hotWalletBalanceSol, null);
assert(
  verdict.blockers.includes(
    'Hot wallet balance is unavailable; live execution funding cannot be verified from this report.'
  ),
  'missing current balance and a zero PAPER stop balance must block as unavailable'
);
assert(
  !verdict.blockers.some((reason) => reason.includes('Hot wallet is not funded')),
  'an unavailable PAPER balance must not be presented as a verified zero balance'
);

console.log('Live-readiness report smoke passed');
