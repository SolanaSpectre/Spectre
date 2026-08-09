#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildDecisiveSummary } = require('./latest-run-summary');

const summary = buildDecisiveSummary({
  battlefield: {
    data: {
      session: {},
      preMigrationPaper: {},
      runnerLane: {
        simpleRuntimeAiLifecycle: {
          attempts: 0,
          completed: 0,
          failed: 0
        }
      },
      watchLane: {}
    }
  },
  paidTapeCoverageEpoch: { data: {} },
  runnerWatchFullCoverageEvidence: {
    data: {
      cumulative: {
        validRuns: 1,
        excludedRuns: 1,
        validRunPnlSol: -0.0674,
        excludedRunPnlSol: 0.035469
      }
    }
  },
  heliusPumpfunShadowParity: { data: {} },
  heliusPumpfunDecisionDivergence: { data: {} },
  eventLoopLagDiagnostic: { data: {} },
  liveReadiness: { data: {} },
  strategyCandidateScorecard: { data: {} }
});

assert(
  summary.includes('Audits attempted/completed/failed: 0/0/0 - NO_MODEL_EVIDENCE'),
  'decisive summary must distinguish zero model attempts from passing model evidence'
);
assert(
  summary.includes('Valid/excluded run PnL: -0.067400 SOL / +0.035469 SOL (excluded is context only)'),
  'decisive summary must display the valid and excluded PnL split'
);

const heliusSummary = buildDecisiveSummary({
  battlefield: {
    data: {
      session: { durationMinutes: 60, configuredDurationMinutes: 60 },
      preMigrationPaper: {},
      runnerLane: { simpleRuntimeAiLifecycle: {} },
      watchLane: {}
    }
  },
  runnerWatchFullCoverageEvidence: {
    data: {
      currentRun: {
        validation: { valid: true, failedChecks: [] },
        providerCoverage: {
          selectedProvider: 'helius',
          fullCoverageMinutes: 56,
          uncoveredMinutes: 4,
          subscriptionAcks: 2,
          runtimeEvents: 120,
          legacyRuntimeEvents: 0,
          transportGapsStarted: 1,
          transportGapsRecovered: 1,
          transportGapActiveAtStop: false
        }
      },
      cumulative: {}
    }
  },
  liveReadiness: {
    data: {
      metrics: {
        pumpDataProvider: 'helius',
        pumpDataReady: true,
        pumpDataMarketEvents: 120,
        pumpDataNewTokens: 10,
        pumpDataTrades: 109,
        pumpDataMigrations: 1
      }
    }
  },
  eventLoopLagDiagnostic: { data: {} },
  strategyCandidateScorecard: { data: {} }
});
assert(
  heliusSummary.includes('Gap-accounted Helius coverage: 56 min; uncovered: 4 min'),
  'Helius-primary summaries must use gap-accounted provider coverage'
);
assert(heliusSummary.includes('Helius Runtime'), 'Helius-primary summaries must label the active runtime');
assert(
  heliusSummary.includes('Legacy PumpPortal/PumpDev comparator artifacts: not applicable to this Helius-primary run.'),
  'Helius-primary summaries must not present legacy comparators as current evidence'
);
assert(
  !heliusSummary.includes('Full paid tape:'),
  'Helius-primary summaries must not present PumpPortal paid-tape coverage'
);

console.log('Latest decisive run summary smoke passed');
