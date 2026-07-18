#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildEpisodes, summarizeLedger } = require('./runner-watch-full-coverage-evidence-report');

const prereg = {
  throughputCheckpoint: { minimumUniqueMintEpisodesPerFullCoverageHour: 1 },
  economicCheckpoint: { minimumUniqueMintEpisodes: 2, minimumValidRuns: 1 },
  stoppingRule: { validRuns: 10 }
};

const episodes = buildEpisodes({
  entries: [{ mint: 'A', symbol: 'A' }, { mint: 'A', symbol: 'A' }, { mint: 'B', symbol: 'B' }],
  exits: [{ mint: 'A', pnlSol: 0.02 }, { mint: 'A', pnlSol: -0.005 }, { mint: 'B', pnlSol: 0.01 }]
});
assert.strictEqual(episodes.length, 2, 'same-mint reentries must collapse to one episode');
assert.strictEqual(episodes.find((row) => row.mint === 'A').pnlSol, 0.015);

const summary = summarizeLedger([{
  valid: true,
  telemetryPath: 'run-logs/test.jsonl',
  fullPaidTapeMinutes: 60,
  pnlSol: 0.025,
  episodes
}], prereg);
assert.strictEqual(summary.realizedUniqueMintEpisodes, 2);
assert.strictEqual(summary.episodesPerFullCoverageHour, 2);
assert.strictEqual(summary.economicCheckpointReady, true);
assert.strictEqual(summary.liveAction, 'KEEP_LIVE_DISABLED');

console.log('Runner-watch full-coverage evidence smoke passed');
