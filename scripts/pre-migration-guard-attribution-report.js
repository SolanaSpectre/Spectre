const path = require('path');

const {
  DEFAULT_LOG_DIR,
  parseArgs,
  resolveRepoPath,
  resolveLatestTelemetry,
  readJsonl,
  writeJson
} = require('./pre-migration-paper-sim-report');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'pre-migration-guard-attribution-latest.json');

function eventType(event = {}) {
  return event.type || event.telemetryType || event.eventType || '';
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function bump(target, key, amount = 1) {
  const label = key || 'unknown';
  target[label] = (target[label] || 0) + amount;
}

function topObject(object = {}, limit = 15) {
  return Object.entries(object)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function buildReport(events = [], telemetryPath = null) {
  const summary = {
    rows: 0,
    uniqueMints: 0,
    wouldEnter: 0,
    wouldSkip: 0,
    suppressedPresetIneligible: 0,
    guardBlocked: 0,
    byPreset: {},
    byOutcome: {},
    byReason: {},
    byGuardReason: {},
    byGuardOverride: {},
    failedChecks: {},
    suppressedByPreset: {},
    presetEligibleForGuardOverride: { true: 0, false: 0, null: 0 }
  };
  const mints = new Set();
  const latestRows = [];

  for (const event of events) {
    if (eventType(event) !== 'pre_migration_paper.guard_attribution') continue;
    const payload = payloadOf(event);
    summary.rows += 1;
    if (payload.mint) mints.add(payload.mint);

    if (payload.outcome === 'PAPER_WOULD_ENTER') summary.wouldEnter += 1;
    if (payload.outcome === 'PAPER_WOULD_SKIP') summary.wouldSkip += 1;
    if (payload.guardPassed === false) summary.guardBlocked += 1;
    if (payload.suppressedPresetIneligible === true) {
      summary.suppressedPresetIneligible += 1;
      bump(summary.suppressedByPreset, payload.preset);
    }

    bump(summary.byPreset, payload.preset);
    bump(summary.byOutcome, payload.outcome);
    bump(summary.byReason, payload.reason);
    bump(summary.byGuardReason, payload.guardReason);
    bump(summary.byGuardOverride, payload.guardOverride || 'none');

    if (payload.presetEligibleForGuardOverride === true) {
      summary.presetEligibleForGuardOverride.true += 1;
    } else if (payload.presetEligibleForGuardOverride === false) {
      summary.presetEligibleForGuardOverride.false += 1;
    } else {
      summary.presetEligibleForGuardOverride.null += 1;
    }

    for (const check of payload.failedChecks || []) {
      bump(summary.failedChecks, check);
    }

    latestRows.push({
      mint: payload.mint || null,
      symbol: payload.symbol || null,
      preset: payload.preset || null,
      outcome: payload.outcome || null,
      reason: payload.reason || null,
      guardReason: payload.guardReason || null,
      guardOverride: payload.guardOverride || null,
      suppressedPresetIneligible: payload.suppressedPresetIneligible === true,
      score: payload.score ?? null,
      curveProgress: payload.curveProgress ?? null,
      recentVolumeSol: payload.recentVolumeSol ?? null,
      tradeVelocityPerMin: payload.tradeVelocityPerMin ?? null,
      buyRatio: payload.buyRatio ?? null,
      failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks.slice(0, 8) : []
    });
    if (latestRows.length > 25) latestRows.shift();
  }

  summary.uniqueMints = mints.size;

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath,
    summary,
    top: {
      reasons: topObject(summary.byReason),
      guardReasons: topObject(summary.byGuardReason),
      guardOverrides: topObject(summary.byGuardOverride),
      failedChecks: topObject(summary.failedChecks),
      presets: topObject(summary.byPreset),
      suppressedByPreset: topObject(summary.suppressedByPreset)
    },
    latestRows
  };
}

function printReport(report) {
  const summary = report.summary;
  console.log('Pre-Migration Guard Attribution');
  console.log(`Telemetry: ${report.telemetryPath || 'n/a'}`);
  console.log(`Rows/unique mints: ${summary.rows} / ${summary.uniqueMints}`);
  console.log(`Would enter/skip: ${summary.wouldEnter} / ${summary.wouldSkip}`);
  console.log(`Guard blocked: ${summary.guardBlocked}`);
  console.log(`Suppressed preset-ineligible: ${summary.suppressedPresetIneligible}`);
  console.log('Top reasons:');
  for (const item of report.top.reasons.slice(0, 8)) {
    console.log(`  - ${item.key}: ${item.count}`);
  }
  console.log('Top failed checks:');
  for (const item of report.top.failedChecks.slice(0, 8)) {
    console.log(`  - ${item.key}: ${item.count}`);
  }
}

function main() {
  const rawArgs = process.argv.slice(2);
  const args = parseArgs(rawArgs);
  const positionalTelemetry = rawArgs.find((arg) => arg && !arg.startsWith('--')) || null;
  const telemetryPath = resolveRepoPath(args.telemetry || positionalTelemetry) || resolveLatestTelemetry(DEFAULT_LOG_DIR);
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;

  if (!telemetryPath) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  const report = buildReport(readJsonl(telemetryPath), telemetryPath);
  writeJson(outputPath, report);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  buildReport,
  printReport
};

if (require.main === module) {
  main();
}
