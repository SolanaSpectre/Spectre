#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const PreMigrationPaperLane = require('../src/lib/pre-migration-paper-lane');
const PostMigrationContinuationLane = require('../src/lib/post-migration-continuation-lane');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const RUN_LOGS_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runtime-lane-replay-latest.json');

function parseArgs(argv = process.argv.slice(2)) {
  const args = { telemetry: [], limit: 1, continuation: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if ((arg === '--telemetry' || arg === '-t') && next) {
      args.telemetry.push(...next.split(',').map((item) => item.trim()).filter(Boolean));
      index += 1;
    } else if ((arg === '--limit' || arg === '-n') && next) {
      args.limit = Math.max(1, Number.parseInt(next, 10) || 1);
      index += 1;
    } else if (arg === '--continuation') {
      args.continuation = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/replay-runtime-lanes.js [--telemetry <file[,file]>] [--limit <n>] [--continuation]',
    '',
    'Replays recorded telemetry through the actual lane classes without opening network feeds,',
    'without signing, and without loading .env. It uses src/config documented defaults',
    'with SPECTRE_SKIP_DOTENV=true. By default it replays the latest telemetry file.',
    '',
    'Limitations:',
    '- Pre-migration replay uses emitted pre_migration.observed/flagged rows only.',
    '- Runtime may have observed additional watch updates that telemetry rate limiting did not emit.',
    '- Treat mismatches as divergence leads, not proof of a runtime bug.',
    '- Exact replay needs sanitized run config snapshots and full lane input telemetry.'
  ].join('\n');
}

function rel(filePath) {
  return filePath ? path.relative(ROOT, filePath).replace(/\\/g, '/') : null;
}

function resolveTelemetryPath(filePath) {
  if (!filePath) return null;
  const direct = path.resolve(ROOT, filePath);
  if (fs.existsSync(direct)) return direct;
  const asRunLog = path.join(RUN_LOGS_DIR, filePath);
  if (fs.existsSync(asRunLog)) return asRunLog;
  return direct;
}

function latestTelemetryFiles(limit = 1) {
  if (!fs.existsSync(RUN_LOGS_DIR)) return [];
  return fs.readdirSync(RUN_LOGS_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(RUN_LOGS_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(1, limit))
    .map((item) => item.filePath)
    .reverse();
}

function loadDefaultConfigWithoutDotenv() {
  const previous = process.env.SPECTRE_SKIP_DOTENV;
  process.env.SPECTRE_SKIP_DOTENV = 'true';
  try {
    return require('../src/config');
  } finally {
    if (previous === undefined) delete process.env.SPECTRE_SKIP_DOTENV;
    else process.env.SPECTRE_SKIP_DOTENV = previous;
  }
}

function loggerStub() {
  const noop = () => {};
  return {
    info: noop,
    warn: noop,
    error: noop,
    decision: noop,
    debug: noop
  };
}

function eventType(event = {}) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function timestampOf(event = {}, payload = {}) {
  return payload.timestamp || event.timestamp || null;
}

function mintOf(payload = {}) {
  return payload.mint || payload.mintAddress || payload.token || payload.id || null;
}

function bump(target, key, by = 1) {
  const normalized = key || 'unknown';
  target[normalized] = (target[normalized] || 0) + by;
}

function eventCountSummary(events = []) {
  const counts = {
    byTelemetryType: {},
    byEventType: {},
    decisions: {},
    skipReasons: {},
    entries: 0,
    exits: 0
  };
  for (const event of events) {
    bump(counts.byTelemetryType, event.telemetryType || 'missing');
    bump(counts.byEventType, event.type || 'missing');
    const payload = event.payload || {};
    if (event.telemetryType === 'pre_migration_paper.decision') {
      bump(counts.decisions, payload.decision || 'unknown');
      if (payload.reason) bump(counts.skipReasons, payload.reason);
    }
    if (event.telemetryType === 'pre_migration_paper.entry') counts.entries += 1;
    if (event.telemetryType === 'pre_migration_paper.exit') counts.exits += 1;
  }
  return counts;
}

function sortedCounts(counts = {}, limit = 20) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
  );
}

function pickStateFromPreMigrationPayload(payload = {}) {
  return {
    ...payload,
    mint: mintOf(payload),
    symbol: payload.symbol || null,
    score: payload.score,
    reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
    curveProgress: payload.curveProgress,
    providerCurveProgress: payload.providerCurveProgress,
    providerCurvePriceSol: payload.providerCurvePriceSol,
    providerCurveSnapshotAt: payload.providerCurveSnapshotAt,
    curveProgressSource: payload.curveProgressSource || payload.updateSource || null,
    lastCurveUpdateAt: payload.lastCurveUpdateAt || null,
    bondingCurvePriceSol: payload.bondingCurvePriceSol,
    recentBuys: payload.recentBuys,
    recentSells: payload.recentSells,
    buyRatio: payload.buyRatio,
    buyRatioCaptured: payload.buyRatioCaptured,
    uniqueBuyerCount: payload.uniqueBuyerCount,
    uniqueBuyerCountCaptured: payload.uniqueBuyerCountCaptured,
    uniqueBuyerRatio: payload.uniqueBuyerRatio,
    sniperWalletCount: payload.sniperWalletCount,
    sniperWalletCountCaptured: payload.sniperWalletCountCaptured,
    tradeVelocityPerMin: payload.tradeVelocityPerMin,
    recentVolumeSol: payload.recentVolumeSol,
    convictionWhaleCount: payload.convictionWhaleCount,
    alphaScalperCount: payload.alphaScalperCount,
    earlySniperCount: payload.earlySniperCount,
    riskWalletCount: payload.riskWalletCount,
    walletClassificationContext: payload.walletClassificationContext || null
  };
}

function pickContinuationSnapshot(payload = {}) {
  return {
    ...payload,
    mint: mintOf(payload),
    symbol: payload.symbol || null,
    pairs: Array.isArray(payload.pairs) ? payload.pairs : undefined,
    primaryPair: payload.primaryPair || payload.rawPairSample || undefined,
    telegramSummary: payload.telegramSummary || undefined,
    narrativeSummary: payload.narrativeSummary || undefined
  };
}

function compareCounts(recorded = {}, replayed = {}) {
  const keys = Array.from(new Set([...Object.keys(recorded), ...Object.keys(replayed)])).sort();
  const deltas = {};
  for (const key of keys) {
    const recordedCount = Number(recorded[key] || 0);
    const replayedCount = Number(replayed[key] || 0);
    if (recordedCount !== replayedCount) {
      deltas[key] = {
        recorded: recordedCount,
        replayed: replayedCount,
        delta: replayedCount - recordedCount
      };
    }
  }
  return deltas;
}

function configFromSnapshot(snapshot = null) {
  if (snapshot?.values && typeof snapshot.values === 'object') {
    return snapshot.values;
  }
  return loadDefaultConfigWithoutDotenv();
}

function replayInputs(preMigrationLane, inputs = []) {
  const events = [];
  for (const input of inputs) {
    const state = input.state || {};
    if (!state.mint) continue;
    events.push(...preMigrationLane.observe(state, input.options || {}));
  }
  return events;
}

function parityVerdict(divergence = {}) {
  const hasDecisionDeltas = Object.keys(divergence.decisionDeltas || {}).length > 0;
  const hasSkipDeltas = Object.keys(divergence.skipReasonDeltas || {}).length > 0;
  if (!hasDecisionDeltas && !hasSkipDeltas && divergence.entryDelta === 0 && divergence.exitDelta === 0) {
    return 'DECISION_REPLAY_PARITY_EXACT';
  }
  return 'DECISION_REPLAY_PARITY_DIVERGED';
}

function replayFile(filePath, options = {}) {
  const logger = loggerStub();
  const continuationLane = new PostMigrationContinuationLane(loadDefaultConfigWithoutDotenv(), logger);
  let replayConfigSnapshot = null;
  const laneInputs = [];
  const legacyInputs = [];
  const recordedPreMigrationEvents = [];
  const continuationEvents = [];
  const recordedContinuationCounts = {};
  const inputCounts = {
    rows: 0,
    malformedLines: 0,
    preMigrationLaneInputRows: 0,
    preMigrationLaneInputDroppedRows: 0,
    preMigrationObservedRows: 0,
    preMigrationFlaggedRows: 0,
    continuationInputRows: 0
  };

  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    const payload = payloadOf(event);
    const timestamp = timestampOf(event, payload);
    inputCounts.rows += 1;

    if (type === 'session.started' && payload.replayConfigSnapshot) {
      replayConfigSnapshot = payload.replayConfigSnapshot;
    }

    if (type.startsWith('pre_migration_paper.')) {
      recordedPreMigrationEvents.push({
        telemetryType: type,
        type: type.replace(/^pre_migration_paper\./, ''),
        payload
      });
    }

    if (type === 'pre_migration.lane_input') {
      const state = payload.state || {};
      const laneOptions = payload.options || {};
      inputCounts.preMigrationLaneInputRows += 1;
      if (state.mint) {
        laneInputs.push({
          seq: payload.seq ?? null,
          state,
          options: laneOptions
        });
      }
    } else if (type === 'pre_migration.lane_input_dropped') {
      inputCounts.preMigrationLaneInputDroppedRows += 1;
    }

    if (type === 'pre_migration.observed' || type === 'pre_migration.flagged') {
      const state = pickStateFromPreMigrationPayload(payload);
      if (!state.mint) return;
      if (type === 'pre_migration.flagged') inputCounts.preMigrationFlaggedRows += 1;
      else inputCounts.preMigrationObservedRows += 1;
      legacyInputs.push({
        state,
        options: {
        flagged: type === 'pre_migration.flagged',
        timestamp,
        walletClassificationContext: payload.walletClassificationContext || null
        }
      });
    }

    if (type.startsWith('continuation.')) {
      bump(recordedContinuationCounts, type);
    }

    if (options.continuation && (
      type === 'continuation.observed'
      || type === 'continuation.watch'
      || type === 'continuation.confirmed'
      || type === 'continuation.rejected'
    )) {
      const result = continuationLane.observe(pickContinuationSnapshot(payload));
      inputCounts.continuationInputRows += 1;
      if (result?.eventType) bump(recordedContinuationCounts, `replayed.${result.eventType}`);
      if (result?.shouldEmit) continuationEvents.push(result);
    }
  });
  inputCounts.malformedLines = stats.malformedLines;

  const config = configFromSnapshot(replayConfigSnapshot);
  const preMigrationLane = new PreMigrationPaperLane(config, logger);
  const useLaneInputs = laneInputs.length > 0;
  const selectedInputs = useLaneInputs ? laneInputs : legacyInputs;
  const replayedPreMigrationEvents = replayInputs(preMigrationLane, selectedInputs);

  const recordedPreMigration = eventCountSummary(recordedPreMigrationEvents);
  const replayedPreMigration = eventCountSummary(replayedPreMigrationEvents);
  const divergence = {
    decisionDeltas: compareCounts(recordedPreMigration.decisions, replayedPreMigration.decisions),
    skipReasonDeltas: compareCounts(recordedPreMigration.skipReasons, replayedPreMigration.skipReasons),
    entryDelta: replayedPreMigration.entries - recordedPreMigration.entries,
    exitDelta: replayedPreMigration.exits - recordedPreMigration.exits
  };
  const fidelity = replayConfigSnapshot && useLaneInputs && inputCounts.preMigrationLaneInputDroppedRows === 0
    ? 'exact_config_exact_lane_input'
    : replayConfigSnapshot && useLaneInputs
      ? 'exact_config_lane_input_with_drops'
      : 'default_config_sampled_input';
  return {
    telemetryPath: rel(filePath),
    configSource: replayConfigSnapshot
      ? 'session_started_sanitized_config_snapshot'
      : 'src_config_documented_defaults_no_dotenv',
    configHash: replayConfigSnapshot?.configHash || null,
    fidelity,
    comparability: fidelity === 'exact_config_exact_lane_input'
      ? 'DECISION_REPLAY_COMPARABLE'
      : 'NOT_COMPARABLE_FOR_EXACT_RUNTIME_PARITY',
    parityVerdict: parityVerdict(divergence),
    limitations: fidelity === 'exact_config_exact_lane_input'
      ? ['Exact lane input and sanitized config snapshot were present. Parity validates deterministic lane decisions only, not full position/PnL lifecycle.']
      : [
          'Requires src/config with SPECTRE_SKIP_DOTENV=true when no run snapshot exists, so .env is not loaded.',
          'Uses documented config defaults when no sanitized run snapshot exists.',
          'Legacy fallback uses only emitted pre_migration.observed/flagged telemetry rows.',
          'Runtime may have called the lane on non-emitted watch updates, so fallback mismatches are divergence leads rather than proof.'
        ],
    inputCounts,
    recordedPreMigration: {
      decisions: sortedCounts(recordedPreMigration.decisions),
      skipReasons: sortedCounts(recordedPreMigration.skipReasons),
      entries: recordedPreMigration.entries,
      exits: recordedPreMigration.exits,
      byTelemetryType: sortedCounts(recordedPreMigration.byTelemetryType)
    },
    replayedPreMigration: {
      decisions: sortedCounts(replayedPreMigration.decisions),
      skipReasons: sortedCounts(replayedPreMigration.skipReasons),
      entries: replayedPreMigration.entries,
      exits: replayedPreMigration.exits,
      byTelemetryType: sortedCounts(replayedPreMigration.byTelemetryType)
    },
    divergence,
    continuation: options.continuation ? {
      inputRows: inputCounts.continuationInputRows,
      emittedRows: continuationEvents.length,
      eventCounts: sortedCounts(recordedContinuationCounts)
    } : null
  };
}

function buildReport(args = parseArgs()) {
  const telemetryFiles = args.telemetry.length
    ? args.telemetry.map(resolveTelemetryPath)
    : latestTelemetryFiles(args.limit);
  const runs = telemetryFiles
    .filter((filePath) => filePath && fs.existsSync(filePath))
    .map((filePath) => replayFile(filePath, args));

  const totals = runs.reduce((acc, run) => {
    acc.telemetryFilesRead += 1;
    bump(acc.fidelityCounts, run.fidelity || 'unknown');
    bump(acc.parityVerdictCounts, run.parityVerdict || 'unknown');
    acc.preMigrationObservedRows += run.inputCounts.preMigrationObservedRows;
    acc.preMigrationLaneInputRows += run.inputCounts.preMigrationLaneInputRows;
    acc.preMigrationLaneInputDroppedRows += run.inputCounts.preMigrationLaneInputDroppedRows;
    acc.preMigrationFlaggedRows += run.inputCounts.preMigrationFlaggedRows;
    acc.recordedEntries += run.recordedPreMigration.entries;
    acc.replayedEntries += run.replayedPreMigration.entries;
    acc.recordedExits += run.recordedPreMigration.exits;
    acc.replayedExits += run.replayedPreMigration.exits;
    return acc;
  }, {
    telemetryFilesRead: 0,
    fidelityCounts: {},
    parityVerdictCounts: {},
    preMigrationLaneInputRows: 0,
    preMigrationLaneInputDroppedRows: 0,
    preMigrationObservedRows: 0,
    preMigrationFlaggedRows: 0,
    recordedEntries: 0,
    replayedEntries: 0,
    recordedExits: 0,
    replayedExits: 0
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_runtime_lane_replay_scaffold',
    summary: {
      ...totals,
      aggregateComparable: Object.keys(totals.fidelityCounts).length === 1
        && totals.fidelityCounts.exact_config_exact_lane_input === totals.telemetryFilesRead,
      entryDelta: totals.replayedEntries - totals.recordedEntries,
      exitDelta: totals.replayedExits - totals.recordedExits
    },
    inputs: {
      telemetryFiles: telemetryFiles.map(rel),
      continuation: Boolean(args.continuation)
    },
    runs,
    note: 'This scaffold instantiates runtime lane classes against recorded telemetry. It is intentionally offline and skips dotenv by default; raw deltas are not exact until runs persist sanitized config snapshots and full lane input telemetry.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  const args = parseArgs();
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  const report = buildReport(args);
  writeJson(OUTPUT_PATH, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

module.exports = {
  buildReport,
  replayFile
};
