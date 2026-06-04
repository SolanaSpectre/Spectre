#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  parseArgs,
  runReport
} = require('./pre-migration-relaxed-gate-replay-report');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-bottleneck-replay-latest.json');
const TARGET_REASONS = ['CURVE_NOT_ADVANCING', 'NO_PRIOR_CURVE_PROGRESS'];
const PROFILE_NAMES = [
  'all_curve_bottlenecks',
  'curve_bottleneck_score75_curve70',
  'curve_bottleneck_score80_curve75_flow',
  'curve_bottleneck_score84_curve78_flow',
  'curve_bottleneck_near_migration'
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runReport({
    args,
    outputPath: args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH,
    targetReasons: TARGET_REASONS,
    profileNames: PROFILE_NAMES,
    note: 'Shadow-only replay over CURVE_NOT_ADVANCING and NO_PRIOR_CURVE_PROGRESS skips. It selects the first matching decision per telemetry run + mint, then replays TP/SL/max-hold exits from later provider snapshots. It does not alter runtime gates, paper entries, AI, quotes, or live broadcast.'
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  OUTPUT_PATH,
  TARGET_REASONS,
  PROFILE_NAMES
};
