const fs = require('fs');
const path = require('path');

const {
  DEFAULT_STRATEGY,
  buildReport: buildPaperSimReport,
  compact,
  readJsonl
} = require('./pre-migration-paper-sim-report');

const ROOT = path.join(__dirname, '..');
const RUN_LOGS_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-delayed-entry-timing-latest.json');
const DEFAULT_RUNS = 8;
const MATCH_WINDOW_MS = 5000;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function eventType(event) {
  return event.type || event.event || event.name || null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function timeMs(value) {
  const parsed = Date.parse(value || 0);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function secondsBetween(start, end) {
  const left = timeMs(start);
  const right = timeMs(end);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return compact((right - left) / 1000, 3);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function latestTelemetryFiles(limit) {
  if (!fs.existsSync(RUN_LOGS_DIR)) return [];
  return fs.readdirSync(RUN_LOGS_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/.test(name))
    .map((name) => {
      const filePath = path.join(RUN_LOGS_DIR, name);
      return { filePath, stat: fs.statSync(filePath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function keyOf(payload = {}) {
  return payload.positionKey
    || `${payload.preset || payload.presetName || 'unknown'}:${mintOf(payload) || 'unknown'}:${payload.entryAt || 'unknown'}`;
}

function collectActualEntries(events) {
  const exitsByKey = new Map();
  for (const event of events) {
    if (eventType(event) !== 'pre_migration_paper.exit') continue;
    const payload = payloadOf(event);
    exitsByKey.set(keyOf(payload), { ...payload, exitAt: payload.exitAt || event.timestamp || null });
  }

  return events
    .filter((event) => eventType(event) === 'pre_migration_paper.entry')
    .map((event) => {
      const payload = payloadOf(event);
      const exit = exitsByKey.get(keyOf(payload)) || {};
      return {
        positionKey: keyOf(payload),
        mint: mintOf(payload),
        symbol: payload.symbol || null,
        preset: payload.preset || payload.presetName || null,
        entryAt: payload.entryAt || event.timestamp || null,
        exitAt: exit.exitAt || null,
        exitReason: exit.reason || null,
        pnlSol: asNumber(exit.pnlSol)
      };
    })
    .sort((a, b) => timeMs(a.entryAt) - timeMs(b.entryAt));
}

function collectDecisions(events) {
  const byMint = new Map();
  for (const event of events) {
    if (eventType(event) !== 'pre_migration_paper.decision') continue;
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    if (!mint) continue;
    const rows = byMint.get(mint) || [];
    rows.push({
      timestamp: event.timestamp || payload.timestamp || null,
      preset: payload.preset || null,
      decision: payload.decision || null,
      reason: payload.reason || null,
      score: asNumber(payload.score),
      curveProgress: asNumber(payload.curveProgress),
      shadowPresetWouldEnter: payload.shadowPresetWouldEnter ?? null
    });
    byMint.set(mint, rows);
  }
  for (const rows of byMint.values()) {
    rows.sort((a, b) => timeMs(a.timestamp) - timeMs(b.timestamp));
  }
  return byMint;
}

function decisionsBetween(decisionsByMint, mint, startAt, endAt) {
  const startMs = timeMs(startAt);
  const endMs = timeMs(endAt);
  if (!mint || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  return (decisionsByMint.get(mint) || [])
    .filter((row) => {
      const atMs = timeMs(row.timestamp);
      return Number.isFinite(atMs) && atMs >= startMs && atMs <= endMs;
    })
    .map((row) => ({
      ...row,
      secondsAfterSimEntry: secondsBetween(startAt, row.timestamp)
    }));
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarizePnl(rows, key) {
  const priced = rows.filter((row) => Number.isFinite(Number(row[key])));
  const wins = priced.filter((row) => Number(row[key]) > 0).length;
  const losses = priced.filter((row) => Number(row[key]) < 0).length;
  const totalPnlSol = priced.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  return {
    rows: rows.length,
    priced: priced.length,
    wins,
    losses,
    winRate: priced.length ? compact(wins / priced.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    averagePnlSol: priced.length ? compact(totalPnlSol / priced.length, 9) : null
  };
}

function delayBucket(seconds) {
  const delay = Number(seconds);
  if (!Number.isFinite(delay)) return 'unknown';
  if (delay < 30) return 'under_30s';
  if (delay < 60) return '30_60s';
  if (delay < 120) return '60_120s';
  return '120s_plus';
}

function buildRowsForTelemetry(telemetryPath) {
  const events = readJsonl(telemetryPath);
  const simulatedTrades = buildPaperSimReport(events, telemetryPath, DEFAULT_STRATEGY).simulatedTrades || [];
  const actualEntries = collectActualEntries(events);
  const decisionsByMint = collectDecisions(events);
  const actualByMint = new Map();
  for (const actual of actualEntries) {
    if (!actual.mint) continue;
    const rows = actualByMint.get(actual.mint) || [];
    rows.push(actual);
    actualByMint.set(actual.mint, rows);
  }

  const rows = [];
  const claimedActualKeys = new Set();
  for (const sim of simulatedTrades) {
    const simMs = timeMs(sim.entryAt);
    if (!Number.isFinite(simMs) || !sim.mint) continue;
    const candidates = (actualByMint.get(sim.mint) || [])
      .filter((actual) => {
        const actualMs = timeMs(actual.entryAt);
        if (!Number.isFinite(actualMs) || claimedActualKeys.has(actual.positionKey)) return false;
        return actualMs > simMs + MATCH_WINDOW_MS;
      })
      .sort((a, b) => timeMs(a.entryAt) - timeMs(b.entryAt));
    const actual = candidates[0];
    if (!actual) continue;
    claimedActualKeys.add(actual.positionKey);
    const decisions = decisionsBetween(decisionsByMint, sim.mint, sim.entryAt, actual.entryAt);
    const simPnlSol = asNumber(sim.pnlSol);
    const actualPnlSol = asNumber(actual.pnlSol);
    rows.push({
      telemetryPath: rel(telemetryPath),
      runId: path.basename(telemetryPath, '.jsonl'),
      mint: sim.mint,
      symbol: sim.symbol || actual.symbol || null,
      simEntryAt: sim.entryAt,
      actualEntryAt: actual.entryAt,
      runtimeDelaySeconds: secondsBetween(sim.entryAt, actual.entryAt),
      delayBucket: delayBucket(secondsBetween(sim.entryAt, actual.entryAt)),
      simExitReason: sim.exitReason || null,
      actualExitReason: actual.exitReason || null,
      simPnlSol,
      actualPnlSol,
      pnlDeltaSol: Number.isFinite(simPnlSol) && Number.isFinite(actualPnlSol)
        ? compact(actualPnlSol - simPnlSol, 9)
        : null,
      simWonActualLost: Number(simPnlSol) > 0 && Number(actualPnlSol) < 0,
      decisionCountDuringDelay: decisions.length,
      firstDecisionDuringDelay: decisions[0] || null,
      lastDecisionBeforeActualEntry: decisions[decisions.length - 1] || null,
      decisionReasonCounts: countBy(decisions, (row) => row.reason),
      decisionPresetCounts: countBy(decisions, (row) => row.preset),
      decisionsDuringDelay: decisions
    });
  }
  return rows;
}

function buildReport({ runs = DEFAULT_RUNS } = {}) {
  const telemetryFiles = latestTelemetryFiles(runs);
  const rows = telemetryFiles.flatMap((filePath) => buildRowsForTelemetry(filePath));
  const totalPnlDeltaSol = rows.reduce((sum, row) => sum + Number(row.pnlDeltaSol || 0), 0);
  const allDelayDecisions = rows.flatMap((row) => row.decisionsDuringDelay || []);
  const worstRows = [...rows]
    .sort((a, b) => Number(a.pnlDeltaSol || 0) - Number(b.pnlDeltaSol || 0))
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      runs,
      telemetryFiles: telemetryFiles.map(rel)
    },
    summary: {
      telemetryFilesRead: telemetryFiles.length,
      delayedRuntimeEntries: rows.length,
      simWonActualLost: rows.filter((row) => row.simWonActualLost).length,
      delayBucketCounts: countBy(rows, (row) => row.delayBucket),
      simPnl: summarizePnl(rows, 'simPnlSol'),
      actualPnl: summarizePnl(rows, 'actualPnlSol'),
      totalActualMinusSimPnlSol: compact(totalPnlDeltaSol, 9),
      averageActualMinusSimPnlSol: rows.length ? compact(totalPnlDeltaSol / rows.length, 9) : null,
      blockingReasonCountsDuringDelay: countBy(allDelayDecisions, (row) => row.reason),
      blockingPresetCountsDuringDelay: countBy(allDelayDecisions, (row) => row.preset)
    },
    rows,
    worstRows,
    note: 'Report-only delayed-entry timing diagnostic over recent telemetry files. It follows same-mint cases where the simple sim entered first and runtime entered later, then records the blocking decisions seen during the delay. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runs = Number.isFinite(Number(args.runs)) ? Number(args.runs) : DEFAULT_RUNS;
  const report = buildReport({ runs });
  writeJson(OUTPUT_PATH, report);
  console.log(`Wrote delayed-entry timing report: ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  buildRowsForTelemetry,
  decisionsBetween,
  latestTelemetryFiles
};
