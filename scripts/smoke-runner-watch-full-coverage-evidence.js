#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveTelemetryPath,
  scanRun,
  buildEpisodes,
  validateRun,
  summarizeLedger,
  summarizeEpisodes,
  evidenceCollectionClosed
} = require('./runner-watch-full-coverage-evidence-report');
const { scanHeliusRuntimeCoverage } = require('./lib/helius-runtime-coverage');
const priorPrereg = require('../data/strategy-preregistrations/runner-watch-full-coverage-v5.json');
const frozenPrereg = require('../data/strategy-preregistrations/runner-watch-full-coverage-v6.json');

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine.js'), 'utf8');
assert.strictEqual(evidenceCollectionClosed(priorPrereg), true);
assert.strictEqual(priorPrereg.terminalDisposition.disposition, 'FAILED_RUNTIME_CHECKPOINT');
assert.strictEqual(frozenPrereg.priorEvidence.id, priorPrereg.id);
assert.strictEqual(frozenPrereg.priorEvidence.acceptedEvidenceReuseAllowed, false);
assert.strictEqual(frozenPrereg.providerPlan.provider, 'helius');
assert.strictEqual(frozenPrereg.validRunDefinition.legacyRuntimeEventsMustBeZero, true);
assert(/^[0-9a-f]{64}$/.test(frozenPrereg.configFreeze.expectedConfigHash));
assert(/^[0-9a-f]{64}$/.test(frozenPrereg.sourceFreeze.expectedSourceFingerprint));
assert(
  engineSource.includes('id: RUNNER_WATCH_FULL_COVERAGE_PREREGISTRATION.id'),
  'runtime must emit the V6 strategy preregistration id from the frozen artifact'
);

const checkpointPrereg = {
  throughputCheckpoint: { minimumUniqueMintEpisodesPerFullCoverageHour: 1 },
  economicCheckpoint: { minimumUniqueMintEpisodes: 2, minimumValidRuns: 1 },
  stoppingRule: { validRuns: 10 }
};

assert.strictEqual(
  resolveTelemetryPath(['--telemetry', 'run-logs/explicit.jsonl']),
  path.resolve(__dirname, '..', 'run-logs', 'explicit.jsonl'),
  'explicit telemetry path must override report artifacts'
);

const episodes = buildEpisodes({
  entries: [{ mint: 'A', symbol: 'A' }, { mint: 'A', symbol: 'A' }, { mint: 'B', symbol: 'B' }],
  exits: [{ mint: 'A', pnlSol: 0.02 }, { mint: 'A', pnlSol: -0.005 }, { mint: 'B', pnlSol: 0.01 }]
});
assert.strictEqual(episodes.length, 2, 'same-mint reentries must collapse to one episode');
assert.strictEqual(episodes.find((row) => row.mint === 'A').pnlSol, 0.015);

const concentrated = summarizeEpisodes([
  { exits: 1, pnlSol: 0.1 },
  { exits: 1, pnlSol: -0.01 },
  { exits: 1, pnlSol: -0.02 },
  { exits: 1, pnlSol: -0.03 }
]);
assert.strictEqual(concentrated.totalPnlSol, 0.04);
assert.strictEqual(concentrated.pnlAfterRemovingTop3WinnersSol, -0.06);
assert.strictEqual(concentrated.concentrationDependent, true);

const futureRun = {
  started: {
    timestamp: '2026-08-09T12:00:00.000Z',
    payload: {
      mode: 'PAPER',
      sessionDurationMinutes: 60,
      configHash: frozenPrereg.configFreeze.expectedConfigHash,
      strategyPreregistration: {
        id: frozenPrereg.id,
        configHash: frozenPrereg.configFreeze.expectedConfigHash,
        expectedConfigHash: frozenPrereg.configFreeze.expectedConfigHash,
        configHashMatches: true,
        sourceFingerprint: frozenPrereg.sourceFreeze.expectedSourceFingerprint,
        expectedSourceFingerprint: frozenPrereg.sourceFreeze.expectedSourceFingerprint,
        sourceFingerprintMatches: true,
        sourceFingerprintAlgorithm: frozenPrereg.sourceFreeze.algorithm,
        gitCommit: 'a'.repeat(40),
        gitWorkingTreeDirty: false,
        gitStateAvailable: true
      },
      pumpDataPlan: {
        provider: 'helius',
        launchIntelSource: 'helius',
        providerCurveVerificationEnabled: true,
        pumpPortalRuntimeEnabled: false,
        pumpDevRuntimeEnabled: false,
        heliusRuntimeEnabled: true
      }
    }
  },
  stopping: {
    timestamp: '2026-08-09T13:00:00.000Z',
    payload: {
      reason: 'SESSION_DURATION_EXCEEDED',
      stats: {
        pumpBondingCurveLane: {
          errors: 4,
          activePhaseErrors: 0,
          stoppingPhaseErrors: 4,
          stoppedPhaseErrors: 0,
          shutdownCancelledErrors: 4,
          errorSessionPhaseCounts: { STOPPING: 4 }
        },
        solanaRpc: { stats: { primaryFailures: 0, fallbackFailures: 0 } }
      }
    }
  }
};

const fullCoverage = {
  selectedProvider: 'helius',
  launchIntelSource: 'helius',
  fullCoverageMinutes: 59.9,
  uncoveredMinutes: 0.1,
  coverageStartedAt: '2026-08-09T12:00:06.000Z',
  subscriptionAcks: 1,
  disconnects: 0,
  transportGapsStarted: 0,
  transportGapsRecovered: 0,
  transportGapActiveAtStop: false,
  runtimeNewTokens: 2,
  runtimeTrades: 10,
  runtimeMigrations: 1,
  runtimeEvents: 13,
  legacyRuntimeEvents: 0,
  listenerEnabled: true,
  strategyConsumptionEnabled: true,
  listenerQueueDropped: 0,
  listenerQueueHandlerErrors: 0,
  listenerQueueStopDrainTimedOut: false,
  runtimeQueueOverflowRejected: 0,
  runtimeQueueHandlerErrors: 0,
  runtimeQueuePendingAtStop: 0,
  runtimeQueueDrainTimeouts: 0
};

const phaseAwareValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'future.jsonl'),
  futureRun,
  fullCoverage
);
assert.strictEqual(phaseAwareValidation.valid, true, 'clean Helius coverage must validate');
assert.strictEqual(phaseAwareValidation.actual.activeRuntimeRpcCurveErrors, 0);
assert.strictEqual(phaseAwareValidation.actual.shutdownCancelledCurveErrors, 4);
assert.strictEqual(phaseAwareValidation.actual.shutdownPhaseErrorsClassified, true);

const changedConfigValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'changed-config.jsonl'),
  {
    ...futureRun,
    started: {
      ...futureRun.started,
      payload: {
        ...futureRun.started.payload,
        configHash: 'b'.repeat(64),
        strategyPreregistration: {
          ...futureRun.started.payload.strategyPreregistration,
          configHash: 'b'.repeat(64),
          configHashMatches: false
        }
      }
    }
  },
  fullCoverage
);
assert.strictEqual(changedConfigValidation.checks.frozenConfigHash, false);
assert.strictEqual(changedConfigValidation.valid, false);

const dirtySourceValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'dirty-source.jsonl'),
  {
    ...futureRun,
    started: {
      ...futureRun.started,
      payload: {
        ...futureRun.started.payload,
        strategyPreregistration: {
          ...futureRun.started.payload.strategyPreregistration,
          gitWorkingTreeDirty: true
        }
      }
    }
  },
  fullCoverage
);
assert.strictEqual(dirtySourceValidation.checks.cleanSourceWorkingTree, false);
assert.strictEqual(dirtySourceValidation.valid, false);

const legacyProviderValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'legacy-provider.jsonl'),
  futureRun,
  { ...fullCoverage, legacyRuntimeEvents: 1 }
);
assert.strictEqual(legacyProviderValidation.checks.noLegacyRuntimeEvents, false);
assert.strictEqual(legacyProviderValidation.valid, false);

const queueFailureValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'queue-overflow.jsonl'),
  futureRun,
  { ...fullCoverage, runtimeQueueOverflowRejected: 1 }
);
assert.strictEqual(queueFailureValidation.checks.runtimeQueueIntegrity, false);
assert.strictEqual(queueFailureValidation.valid, false);

const legacyCurveCountersValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'legacy-counters.jsonl'),
  {
    ...futureRun,
    stopping: {
      ...futureRun.stopping,
      payload: {
        ...futureRun.stopping.payload,
        stats: {
          ...futureRun.stopping.payload.stats,
          pumpBondingCurveLane: { errors: 0 }
        }
      }
    }
  },
  fullCoverage
);
assert.strictEqual(legacyCurveCountersValidation.checks.phaseAwareCurveErrorAccounting, false);

const summary = summarizeLedger([
  {
    valid: true,
    telemetryPath: 'run-logs/test.jsonl',
    fullCoverageMinutes: 60,
    pnlSol: 0.025,
    episodes
  }
], checkpointPrereg);
assert.strictEqual(summary.realizedUniqueMintEpisodes, 2);
assert.strictEqual(summary.excludedRuns, 0);
assert.strictEqual(summary.validRunPnlSol, 0.025);
assert.strictEqual(summary.excludedRunPnlSol, 0);
assert.strictEqual(summary.episodesPerFullCoverageHour, 2);
assert.strictEqual(summary.economicCheckpointReady, true);
assert.strictEqual(summary.evidenceCollectionClosed, false);
assert.strictEqual(summary.liveAction, 'KEEP_LIVE_DISABLED');

const splitPnlSummary = summarizeLedger([
  {
    valid: true,
    telemetryPath: 'run-logs/valid.jsonl',
    fullCoverageMinutes: 60,
    pnlSol: -0.0674,
    episodes
  },
  {
    valid: false,
    telemetryPath: 'run-logs/excluded.jsonl',
    fullCoverageMinutes: 12,
    pnlSol: 0.035469,
    episodes
  }
], checkpointPrereg);
assert.strictEqual(splitPnlSummary.validRunPnlSol, -0.0674);
assert.strictEqual(splitPnlSummary.excludedRunPnlSol, 0.035469);
assert.strictEqual(
  splitPnlSummary.pnlInclusionSemantics,
  'valid_run_pnl_drives_checkpoint_excluded_run_pnl_is_context_only'
);

const telemetryPath = path.join(os.tmpdir(), `spectre-runner-watch-helius-coverage-${process.pid}.jsonl`);
const finalStats = {
  heliusPumpfunShadow: {
    enabled: true,
    strategyConsumptionEnabled: true,
    subscriptionReady: false,
    transportGapActive: false,
    eventQueueDropped: 0,
    eventQueueHandlerErrors: 0,
    eventQueueStopDrainTimedOut: false
  },
  heliusPumpfunRuntime: {
    overflowRejected: 0,
    handlerErrors: 0,
    pending: 0,
    drainTimeouts: 0
  }
};
fs.writeFileSync(telemetryPath, [
  {
    type: 'session.started',
    timestamp: '2026-08-09T12:00:00.000Z',
    payload: {
      mode: 'PAPER',
      pumpDataPlan: { provider: 'helius', launchIntelSource: 'helius' }
    }
  },
  { type: 'provider.helius_pumpfun.shadow_subscription_ack', timestamp: '2026-08-09T12:00:05.000Z', payload: {} },
  { type: 'provider.helius_pumpfun.runtime_new_token', timestamp: '2026-08-09T12:01:00.000Z', payload: { mint: 'A' } },
  { type: 'provider.helius_pumpfun.runtime_trade', timestamp: '2026-08-09T12:01:01.000Z', payload: { mint: 'A' } },
  { type: 'provider.helius_pumpfun.runtime_complete', timestamp: '2026-08-09T12:40:00.000Z', payload: { mint: 'A' } },
  { type: 'pre_migration_paper.decision', timestamp: '2026-08-09T12:41:00.000Z', payload: { reason: 'CURVE_NOT_ADVANCING' } },
  { type: 'session.stopping', timestamp: '2026-08-09T13:00:00.000Z', payload: { reason: 'SESSION_DURATION_EXCEEDED', stats: finalStats } },
  { type: 'session.stopped', timestamp: '2026-08-09T13:00:02.000Z', payload: { reason: 'SESSION_DURATION_EXCEEDED', stats: finalStats } }
].map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');

try {
  const scannedRun = scanRun(telemetryPath);
  assert.deepStrictEqual(scannedRun.coverageDiagnostics.runtimeProviderEvents, {
    newTokens: 1,
    trades: 1,
    migrations: 1
  });
  assert.strictEqual(scannedRun.coverageDiagnostics.paperDecisions, 1);

  const scannedCoverage = scanHeliusRuntimeCoverage(telemetryPath);
  assert(scannedCoverage.fullCoverageMinutes > 59.9);
  assert(scannedCoverage.fullCoverageMinutes < 60);
  assert.strictEqual(scannedCoverage.runtimeEvents, 3);
  assert.strictEqual(scannedCoverage.legacyRuntimeEvents, 0);
  assert.strictEqual(scannedCoverage.runtimeQueuePendingAtStop, 0);
  assert.strictEqual(scannedCoverage.sessionCoverageEndedAt, '2026-08-09T13:00:00.000Z');
  assert.strictEqual(scannedCoverage.sessionStoppedAt, '2026-08-09T13:00:02.000Z');

  const gapStats = {
    ...finalStats,
    heliusPumpfunShadow: {
      ...finalStats.heliusPumpfunShadow,
      transportGapsStarted: 1,
      transportGapsRecovered: 1
    }
  };
  fs.writeFileSync(telemetryPath, [
    {
      type: 'session.started',
      timestamp: '2026-08-09T12:00:00.000Z',
      payload: { pumpDataPlan: { provider: 'helius', launchIntelSource: 'helius' } }
    },
    { type: 'provider.helius_pumpfun.shadow_subscription_ack', timestamp: '2026-08-09T12:00:05.000Z', payload: {} },
    {
      type: 'provider.helius_pumpfun.shadow_disconnected',
      timestamp: '2026-08-09T12:10:00.000Z',
      payload: { shutdownDisconnect: false, transportGapSequence: 1, transportGapStartedAt: '2026-08-09T12:10:00.000Z' }
    },
    {
      type: 'provider.helius_pumpfun.shadow_subscription_ack',
      timestamp: '2026-08-09T12:15:00.000Z',
      payload: { recoveredTransportGapSequence: 1, recoveredTransportGapDurationMs: 300000 }
    },
    {
      type: 'provider.helius_pumpfun.shadow_transport_gap_closed',
      timestamp: '2026-08-09T12:15:00.001Z',
      payload: { sequence: 1, durationMs: 300000 }
    },
    { type: 'provider.helius_pumpfun.runtime_trade', timestamp: '2026-08-09T12:20:00.000Z', payload: { mint: 'A' } },
    { type: 'session.stopping', timestamp: '2026-08-09T13:00:00.000Z', payload: { reason: 'SESSION_DURATION_EXCEEDED', stats: gapStats } },
    { type: 'session.stopped', timestamp: '2026-08-09T13:00:02.000Z', payload: { reason: 'SESSION_DURATION_EXCEEDED', stats: gapStats } }
  ].map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  const gapCoverage = scanHeliusRuntimeCoverage(telemetryPath);
  assert(gapCoverage.fullCoverageMinutes > 54.9 && gapCoverage.fullCoverageMinutes < 55);
  assert.strictEqual(gapCoverage.disconnects, 1);
  assert.strictEqual(gapCoverage.transportGapsStarted, 1);
  assert.strictEqual(gapCoverage.transportGapsRecovered, 1);
  assert.strictEqual(gapCoverage.transportGapActiveAtStop, false);
} finally {
  fs.rmSync(telemetryPath, { force: true });
}

console.log('Runner-watch Helius full-coverage V6 evidence smoke passed');
