'use strict';

process.env.SPECTRE_SKIP_DOTENV = 'true';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { indexJsonlEventsByMint } = require('./lib/jsonl-mint-index');
const {
  buildReportArgs,
  inspectReportArtifact,
  sameTelemetry
} = require('./lib/post-run-report-ledger');
const {
  ALL_POST_RUN_REPORTS,
  DECISIVE_POST_RUN_REPORTS,
  DEEP_POST_RUN_REPORTS,
  TERMINAL_POST_RUN_REPORTS,
  reportsForProfile
} = require('./post-run-report-plan');
const { buildPostRunReportOptions } = require('./run-with-context-and-reports');
const {
  buildDecisiveSummary,
  buildSummaryManifest
} = require('./latest-run-summary');

const timed = buildPostRunReportOptions({ timeoutMs: 300000 });
assert.strictEqual(timed.allowFailure, true);
assert.strictEqual(timed.timeoutMs, 300000);
assert.strictEqual(timed.timeoutExitCode, 124);

const untimed = buildPostRunReportOptions({});
assert.strictEqual(untimed.timeoutMs, 180000);

assert.strictEqual(DECISIVE_POST_RUN_REPORTS.length, 9);
assert(DECISIVE_POST_RUN_REPORTS.every((report) => report.required === true));
assert(!DECISIVE_POST_RUN_REPORTS.some((report) => report.script.includes('runner-reject')));
assert(TERMINAL_POST_RUN_REPORTS.some((report) => report.script === 'runner-reject-entry-replay-report.js'));
assert(!DEEP_POST_RUN_REPORTS.some((report) => report.script === 'runner-reject-entry-replay-report.js'));
assert.strictEqual(reportsForProfile('decisive').length, DECISIVE_POST_RUN_REPORTS.length);
assert.strictEqual(
  reportsForProfile('all').length,
  DECISIVE_POST_RUN_REPORTS.length + DEEP_POST_RUN_REPORTS.length + TERMINAL_POST_RUN_REPORTS.length
);
assert.strictEqual(ALL_POST_RUN_REPORTS.length, reportsForProfile('all').length);
const scorecardPlan = DECISIVE_POST_RUN_REPORTS.find(
  (report) => report.script === 'strategy-candidate-scorecard-report.js'
);
const summaryPlan = DECISIVE_POST_RUN_REPORTS.find(
  (report) => report.script === 'latest-run-summary.js'
);
assert.strictEqual(scorecardPlan.artifactTelemetryJsonPaths.length, 2);
assert.strictEqual(summaryPlan.artifactTelemetryJsonPaths.length, 10);
assert.strictEqual(summaryPlan.artifactPath, 'data/reports/latest-run-summary-latest.json');
assert.deepStrictEqual(summaryPlan.args, ['--decisive']);
assert.deepStrictEqual(
  buildReportArgs({ script: 'pair.js', telemetryCli: 'pair' }, 'run.jsonl'),
  ['--telemetry', 'run.jsonl']
);
assert.deepStrictEqual(
  buildReportArgs({
    script: 'pair.js',
    telemetryCli: 'pair',
    args: ['--decisive']
  }, 'run.jsonl'),
  ['--decisive', '--telemetry', 'run.jsonl']
);
assert.deepStrictEqual(
  buildReportArgs({ script: 'equals.js', telemetryCli: 'equals' }, 'run.jsonl'),
  ['--telemetry=run.jsonl']
);
assert.strictEqual(
  sameTelemetry('run-logs/telemetry.jsonl', path.join(process.cwd(), 'run-logs', 'telemetry.jsonl')),
  true
);
assert.strictEqual(
  sameTelemetry('run-logs/telemetry.jsonl', path.join(process.cwd(), 'excluded', 'telemetry.jsonl')),
  false
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-jsonl-index-'));
const telemetryPath = path.join(tempDir, 'telemetry.jsonl');
const artifactPath = path.join(tempDir, 'artifact.json');

try {
  fs.writeFileSync(telemetryPath, [
    JSON.stringify({ type: 'keep', payload: { mint: 'mint-a', priceSol: 1 } }),
    JSON.stringify({ type: 'drop', payload: { mint: 'mint-a', priceSol: 2 } }),
    JSON.stringify({ type: 'keep', payload: { mint: 'mint-b', priceSol: 3 } }),
    JSON.stringify({ type: 'keep', mint: 'mint-b', payload: { priceSol: 3.5 } }),
    JSON.stringify({ type: 'keep', payload: { priceSol: 3.75 } }),
    JSON.stringify({ type: 'keep', payload: { mint: 'mint-c', priceSol: 4 } }),
    '{not-json}'
  ].join('\n'));

  const index = indexJsonlEventsByMint(
    telemetryPath,
    new Set(['mint-a', 'mint-b']),
    { includeEvent: (event) => event.type === 'keep' }
  );

  assert.strictEqual(index.rows, 6);
  assert.strictEqual(index.malformedLines, 1);
  assert.strictEqual(index.candidateEvents, 5);
  assert.strictEqual(index.candidateEventsWithoutMint, 1);
  assert.strictEqual(index.candidateEventsOutsideTargetSet, 1);
  assert.strictEqual(index.indexedEvents, 3);
  assert.strictEqual(index.eventsByMint.get('mint-a').length, 1);
  assert.strictEqual(index.eventsByMint.get('mint-b').length, 2);
  assert.strictEqual(index.eventsByMint.has('mint-c'), false);

  fs.writeFileSync(artifactPath, JSON.stringify({
    telemetryPath,
    secondaryTelemetryPath: telemetryPath,
    summary: { inputFreshness: { verdict: 'ALIGNED' } }
  }));
  const artifact = inspectReportArtifact(tempDir, {
    artifactPath,
    artifactTelemetryJsonPath: 'telemetryPath',
    artifactTelemetryJsonPaths: ['secondaryTelemetryPath'],
    requiredJsonValues: {
      'summary.inputFreshness.verdict': 'ALIGNED'
    }
  }, telemetryPath, Date.now() - 1000);
  assert.strictEqual(artifact.status, 'CURRENT');
  assert.strictEqual(artifact.telemetryStatus, 'MATCHED');
  assert.strictEqual(artifact.telemetryChecks.length, 2);

  fs.writeFileSync(artifactPath, JSON.stringify({
    telemetryPath,
    secondaryTelemetryPath: path.join(tempDir, 'stale.jsonl'),
    summary: { inputFreshness: { verdict: 'ALIGNED' } }
  }));
  const staleArtifact = inspectReportArtifact(tempDir, {
    artifactPath,
    artifactTelemetryJsonPaths: ['telemetryPath', 'secondaryTelemetryPath']
  }, telemetryPath, Date.now() - 1000);
  assert.strictEqual(staleArtifact.status, 'STALE_INPUT');
  assert.strictEqual(staleArtifact.telemetryChecks[0].passed, true);
  assert.strictEqual(staleArtifact.telemetryChecks[1].passed, false);

  const summaryManifest = buildSummaryManifest({
    battlefield: { data: { files: { telemetryPath } } },
    paidTapeCoverageEpoch: { data: { telemetryPath } },
    runnerWatchFullCoverageEvidence: {
      data: { currentRun: { validation: { actual: { telemetryPath } } } }
    },
    heliusPumpfunShadowParity: { data: { sourceTelemetry: telemetryPath } },
    heliusPumpfunDecisionDivergence: { data: { sourceTelemetry: telemetryPath } },
    eventLoopLagDiagnostic: { data: { sources: { telemetryPath } } },
    liveReadiness: { data: { telemetryPath } },
    strategyCandidateScorecard: {
      data: {
        summary: {
          inputFreshness: {
            verdict: 'ALIGNED',
            liveReadinessTelemetry: telemetryPath,
            battlefieldTelemetry: telemetryPath
          }
        }
      }
    }
  }, path.join(tempDir, 'latest-run-summary.txt'));
  assert.strictEqual(summaryManifest.telemetryPath, telemetryPath);
  assert.strictEqual(summaryManifest.inputFreshness.scorecardVerdict, 'ALIGNED');
  assert(
    Object.values(summaryManifest.criticalTelemetryPaths)
      .every((reportedPath) => reportedPath === telemetryPath)
  );

  const decisiveSummary = buildDecisiveSummary({
    battlefield: {
      data: {
        files: { telemetryPath },
        session: { durationMinutes: 60, configuredDurationMinutes: 60 },
        preMigrationPaper: {
          entries: 4,
          exits: 4,
          wins: 3,
          losses: 1,
          pnlSol: 0.05,
          exitsDetail: [
            { pnlSol: 0.05 },
            { pnlSol: 0.02 },
            { pnlSol: 0.01 },
            { pnlSol: -0.03 }
          ]
        }
      }
    },
    paidTapeCoverageEpoch: {
      data: {
        verdict: 'FULL_SESSION_PAID_TAPE',
        coverage: { fullPaidTapeMinutes: 60 }
      }
    },
    runnerWatchFullCoverageEvidence: {
      data: {
        currentRun: {
          validation: { valid: true, failedChecks: [] },
          episodes: []
        },
        cumulative: { verdict: 'COLLECTING_RUNTIME_EVIDENCE' }
      }
    },
    heliusPumpfunShadowParity: {
      data: { verdict: 'HELIUS_SHADOW_PARITY_PASSED' }
    },
    heliusPumpfunDecisionDivergence: {
      data: { verdict: 'HELIUS_DECISION_DIVERGENCE_INSUFFICIENT_EVIDENCE' }
    },
    eventLoopLagDiagnostic: {
      data: { summary: { diagnosis: 'NO_MATERIAL_LAG', lagEvents: 0 } }
    },
    liveReadiness: {
      data: { verdict: 'blocked', blockers: ['strategy_not_proven'] }
    },
    strategyCandidateScorecard: {
      data: {
        summary: {
          bestAction: 'KEEP_LIVE_DISABLED',
          promotionEligibleCount: 0,
          candidateCount: 1
        }
      }
    }
  });
  assert(decisiveSummary.includes('FULL_SESSION_PAID_TAPE'));
  assert(decisiveSummary.includes('KEEP_LIVE_DISABLED'));
  assert(decisiveSummary.includes(telemetryPath));
  assert(decisiveSummary.includes('Current-run durability: median +0.015000 SOL; ex-top-3 -0.030000 SOL'));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Post-run report runtime guard smoke check passed.');
