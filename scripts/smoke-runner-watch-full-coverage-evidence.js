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
  summarizeEpisodes
} = require('./runner-watch-full-coverage-evidence-report');
const frozenPrereg = require('../data/strategy-preregistrations/runner-watch-full-coverage-v5.json');

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'trading-engine.js'), 'utf8');
const envExample = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
assert.strictEqual(frozenPrereg.subscriptionPlan.paidEventBudgetPerSession, 105000);
assert.strictEqual(frozenPrereg.subscriptionPlan.requiredStartingBalanceSol, 0.125);
assert(engineSource.includes(`id: '${frozenPrereg.id}'`), 'runtime must emit the V5 strategy preregistration id');
assert(
  envExample.includes('PUMPPORTAL_MAX_METERED_TRADE_EVENTS_PER_SESSION=105000'),
  '.env.example must publish the frozen V5 event budget'
);

const prereg = {
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
    timestamp: '2026-07-27T12:00:00.000Z',
    payload: {
      mode: 'PAPER',
      sessionDurationMinutes: 60,
      strategyPreregistration: { id: frozenPrereg.id },
      pumpPortalPaidTapePlan: {
        tradeSubscriptionMode: frozenPrereg.subscriptionPlan.mode,
        targetedMinCurveProgress: frozenPrereg.subscriptionPlan.minCurveProgressInclusive,
        targetedMaxCurveProgress: frozenPrereg.subscriptionPlan.maxCurveProgressExclusive,
        maxMeteredTradeEventsPerSession: frozenPrereg.subscriptionPlan.paidEventBudgetPerSession,
        tokenTradeSubscriptionTtlMs: frozenPrereg.subscriptionPlan.tokenTradeSubscriptionTtlMs,
        targetedPrefilterMaxAgeMs: frozenPrereg.subscriptionPlan.belowBandRpcRecheckMaxAgeMs,
        targetedPrefilterCadenceMs: frozenPrereg.subscriptionPlan.belowBandRpcRecheckCadenceMs,
        bondingCurveRuntimeRpcEnabled: true
      }
    }
  },
  stopping: {
    timestamp: '2026-07-27T13:00:00.000Z',
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
  fullPaidTapeMinutes: 60,
  discoveryRpcOnlyMinutes: 0,
  paidTapeCapped: false,
  paidTapeCoverageTruncated: false,
  coverageEndReason: null,
  coverageEndedAt: null,
  targetedTradeSubscriptionRejections: 0
};
const phaseAwareValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'future.jsonl'),
  futureRun,
  fullCoverage
);
assert.strictEqual(phaseAwareValidation.valid, true, 'shutdown cancellations must not invalidate a future run');
assert.strictEqual(phaseAwareValidation.actual.activeRuntimeRpcCurveErrors, 0);
assert.strictEqual(phaseAwareValidation.actual.shutdownCancelledCurveErrors, 4);
assert.strictEqual(phaseAwareValidation.actual.shutdownPhaseErrorsClassified, true);
const legacyValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'legacy.jsonl'),
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
assert.strictEqual(
  legacyValidation.checks.phaseAwareCurveErrorAccounting,
  false,
  'future V5 runs must expose phase-aware curve error counters'
);
const unclassifiedShutdownValidation = validateRun(
  frozenPrereg,
  path.join(__dirname, '..', 'run-logs', 'unclassified-shutdown.jsonl'),
  {
    ...futureRun,
    stopping: {
      ...futureRun.stopping,
      payload: {
        ...futureRun.stopping.payload,
        stats: {
          ...futureRun.stopping.payload.stats,
          pumpBondingCurveLane: {
            ...futureRun.stopping.payload.stats.pumpBondingCurveLane,
            shutdownCancelledErrors: 3
          }
        }
      }
    }
  },
  fullCoverage
);
assert.strictEqual(
  unclassifiedShutdownValidation.checks.shutdownRuntimeRpcCurveErrorsClassified,
  false,
  'a non-cancellation shutdown error must invalidate the run'
);

const summary = summarizeLedger([
  {
    valid: true,
    telemetryPath: 'run-logs/test.jsonl',
    fullPaidTapeMinutes: 60,
    pnlSol: 0.025,
    episodes
  },
  {
    recordType: 'coverage_annotation',
    telemetryPath: 'run-logs/test.jsonl',
    comparatorCoverage: { budgetTruncated: false }
  }
], prereg);
assert.strictEqual(summary.realizedUniqueMintEpisodes, 2);
assert.strictEqual(summary.excludedRuns, 0, 'coverage annotations must not count as excluded runs');
assert.strictEqual(summary.validRunPnlSol, 0.025);
assert.strictEqual(summary.excludedRunPnlSol, 0);
assert.strictEqual(summary.episodesPerFullCoverageHour, 2);
assert.strictEqual(summary.economicCheckpointReady, true);
assert.strictEqual(summary.liveAction, 'KEEP_LIVE_DISABLED');

const correctedSummary = summarizeLedger([
  {
    valid: true,
    telemetryPath: 'run-logs/corrected.jsonl',
    fullPaidTapeMinutes: 60,
    pnlSol: 0.025,
    episodes
  },
  {
    recordType: 'coverage_annotation',
    telemetryPath: 'run-logs/corrected.jsonl',
    validOverride: false,
    failedChecksOverride: ['fullPaidTapeMinutes'],
    fullPaidTapeMinutesOverride: 40,
    comparatorCoverage: { coverageEndReason: 'TARGETED_SUBSCRIPTION_REJECTED' }
  }
], prereg);
assert.strictEqual(correctedSummary.validRuns, 0, 'coverage correction must exclude a previously accepted run');
assert.strictEqual(correctedSummary.excludedRuns, 1);
assert.strictEqual(correctedSummary.validRunPnlSol, 0);
assert.strictEqual(correctedSummary.excludedRunPnlSol, 0.025);
assert.strictEqual(correctedSummary.realizedUniqueMintEpisodes, 0);

const splitPnlSummary = summarizeLedger([
  {
    valid: true,
    telemetryPath: 'run-logs/valid.jsonl',
    fullPaidTapeMinutes: 60,
    pnlSol: -0.0674,
    episodes
  },
  {
    valid: false,
    telemetryPath: 'run-logs/excluded.jsonl',
    fullPaidTapeMinutes: 12,
    pnlSol: 0.035469,
    episodes
  }
], prereg);
assert.strictEqual(splitPnlSummary.validRunPnlSol, -0.0674);
assert.strictEqual(splitPnlSummary.excludedRunPnlSol, 0.035469);
assert.strictEqual(
  splitPnlSummary.pnlInclusionSemantics,
  'valid_run_pnl_drives_checkpoint_excluded_run_pnl_is_context_only'
);

const telemetryPath = path.join(os.tmpdir(), `spectre-runner-watch-coverage-${process.pid}.jsonl`);
fs.writeFileSync(telemetryPath, [
  { type: 'provider.pumpportal.targeted_prefilter_first_rpc_observation', timestamp: '2026-07-18T12:00:00.000Z', payload: { mint: 'FAST', symbol: 'FAST', classification: 'ABOVE_BAND' } },
  { type: 'pre_migration_paper.decision', timestamp: '2026-07-18T12:00:01.000Z', payload: { mint: 'FAST', symbol: 'FAST', decision: 'PAPER_SKIPPED', reason: 'MISSING_BUY_RATIO' } },
  { type: 'provider.pumpportal.targeted_prefilter_refresh_expired', timestamp: '2026-07-18T12:03:00.000Z', payload: { mint: 'SLOW', curveProgress: 0.2, attempts: 12 } },
  { type: 'provider.pumpportal.targeted_prefilter_expired_later_observed', timestamp: '2026-07-18T12:05:00.000Z', payload: { mint: 'SLOW', laterCurveProgress: 0.4, laterClassification: 'IN_BAND' } }
].map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
try {
  const scanned = scanRun(telemetryPath);
  assert.strictEqual(scanned.coverageDiagnostics.firstObservedAboveBandMints, 1);
  assert.strictEqual(scanned.coverageDiagnostics.coverageShapedPaperSkips, 1);
  assert.strictEqual(scanned.coverageDiagnostics.coverageShapedPaperSkipReasons.MISSING_BUY_RATIO, 1);
  assert.strictEqual(scanned.coverageDiagnostics.belowBandRecheckExpirations, 1);
  assert.strictEqual(scanned.coverageDiagnostics.expiredLaterObservedInOrAboveBand, 1);
} finally {
  fs.rmSync(telemetryPath, { force: true });
}

console.log('Runner-watch full-coverage evidence smoke passed');
