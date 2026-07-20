#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveTelemetryPath, scanRun, buildEpisodes, summarizeLedger } = require('./runner-watch-full-coverage-evidence-report');

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
assert.strictEqual(summary.episodesPerFullCoverageHour, 2);
assert.strictEqual(summary.economicCheckpointReady, true);
assert.strictEqual(summary.liveAction, 'KEEP_LIVE_DISABLED');

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
