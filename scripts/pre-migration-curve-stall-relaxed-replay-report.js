#!/usr/bin/env node
'use strict';

const path = require('path');
const { runReport } = require('./pre-migration-relaxed-gate-replay-report');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-stall-relaxed-replay-latest.json');

runReport({
  outputPath: OUTPUT_PATH,
  targetReasons: ['CURVE_NOT_ADVANCING'],
  note: 'Shadow-only relaxed-gate replay over CURVE_NOT_ADVANCING skips. It selects the first matching decision per telemetry run + mint, then replays TP/SL/max-hold exits from later provider snapshots. It does not alter runtime gates, entries, scoring, quotes, AI review, or live behavior.'
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
