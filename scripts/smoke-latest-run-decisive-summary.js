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

console.log('Latest decisive run summary smoke passed');
