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
    simulationFailureBlockhashLatencyMsByClass: {},
    bondingCurveMintMismatchDiagnostics: [],
    blockhashLatencyMs: [],
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

const boundedQuoteRaceStats = structuredClone(stats);
boundedQuoteRaceStats.lastStopStats.liveExecutionDryRun = {
  ...boundedQuoteRaceStats.lastStopStats.liveExecutionDryRun,
  attempts: 100,
  wouldSend: 99,
  wouldBlock: 1,
  simulations: 100,
  simulationFailed: 1
};
boundedQuoteRaceStats.dryRun = {
  ...boundedQuoteRaceStats.dryRun,
  attempts: 100,
  wouldSend: 99,
  wouldBlock: 1,
  simulationOk: { true: 99, false: 1, null: 0 },
  simulationErrors: { QUOTE_SLIPPAGE_RACE: 1 },
  simulationFailureBlockhashLatencyMsByClass: {
    QUOTE_SLIPPAGE_RACE: [250]
  },
  blockhashLatencyMs: [...Array(99).fill(100), 250],
  blockReasons: { QUOTE_SLIPPAGE_RACE: 1 }
};
const boundedQuoteRace = buildVerdict(boundedQuoteRaceStats);
assert.strictEqual(boundedQuoteRace.metrics.dryExpectedQuoteRaceSimulationFailures, 1);
assert.strictEqual(boundedQuoteRace.metrics.dryExpectedQuoteRaceWithinBound, true);
assert.strictEqual(boundedQuoteRace.metrics.dryCriticalSimulationFailures, 0);

const excessiveQuoteRaceStats = structuredClone(boundedQuoteRaceStats);
excessiveQuoteRaceStats.lastStopStats.liveExecutionDryRun.attempts = 20;
excessiveQuoteRaceStats.lastStopStats.liveExecutionDryRun.wouldSend = 19;
excessiveQuoteRaceStats.lastStopStats.liveExecutionDryRun.simulations = 20;
excessiveQuoteRaceStats.dryRun.attempts = 20;
excessiveQuoteRaceStats.dryRun.wouldSend = 19;
excessiveQuoteRaceStats.dryRun.simulationOk = { true: 19, false: 1, null: 0 };
excessiveQuoteRaceStats.dryRun.blockhashLatencyMs = [...Array(19).fill(100), 250];
const excessiveQuoteRace = buildVerdict(excessiveQuoteRaceStats);
assert.strictEqual(excessiveQuoteRace.metrics.dryExpectedQuoteRaceWithinBound, false);
assert.strictEqual(excessiveQuoteRace.metrics.dryCriticalSimulationFailures, 1);

const missingDenominatorStats = structuredClone(boundedQuoteRaceStats);
missingDenominatorStats.lastStopStats.liveExecutionDryRun.simulations = 0;
missingDenominatorStats.dryRun.simulationOk = { true: 0, false: 0, null: 0 };
const missingDenominator = buildVerdict(missingDenominatorStats);
assert.strictEqual(missingDenominator.metrics.dryExpectedQuoteRaceWithinBound, false);
assert.strictEqual(missingDenominator.metrics.dryCriticalSimulationFailures, 1);

const sessionEndExitStats = structuredClone(stats);
sessionEndExitStats.lastStopStats.preMigrationPaper = {
  entries: 1,
  exits: 1,
  totalPnlSol: 0.01
};
sessionEndExitStats.paper = {
  entries: 2,
  exits: 2,
  pnlSol: 0.015
};
const sessionEndExit = buildVerdict(sessionEndExitStats);
assert.strictEqual(sessionEndExit.metrics.paperEntries, 2);
assert.strictEqual(sessionEndExit.metrics.paperExits, 2);
assert.strictEqual(sessionEndExit.metrics.paperPnl, 0.015);
assert.strictEqual(sessionEndExit.metrics.paperAggregation.source, 'telemetry_event_stream');
assert.deepStrictEqual(sessionEndExit.metrics.paperAggregation.stoppingSnapshot, {
  entries: 1,
  exits: 1,
  pnlSol: 0.01
});

console.log('Live-readiness report smoke passed');
