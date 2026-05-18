#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  DEFAULT_STRATEGY,
  buildReport: buildPaperSimReport,
  readJsonl
} = require('./pre-migration-paper-sim-report');

const ROOT = path.join(__dirname, '..');
const RUN_LOGS_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-sim-runtime-divergence-trend-latest.json');
const RUN_LIMIT = Number(process.argv[2] || 8);
const DECISION_WINDOW_MS = 60000;

function rel(filePath) {
  return filePath ? path.relative(ROOT, filePath).replace(/\\/g, '/') : null;
}

function timeMs(value) {
  const parsed = Date.parse(value || 0);
  return Number.isFinite(parsed) ? parsed : null;
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
    .map((item) => item.filePath)
    .reverse();
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function collectDecisions(events) {
  const byMint = new Map();
  for (const event of events) {
    if (event.type !== 'pre_migration_paper.decision') continue;
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    if (!mint) continue;
    if (!byMint.has(mint)) byMint.set(mint, []);
    byMint.get(mint).push({
      timestamp: payload.timestamp || event.timestamp || null,
      decision: payload.decision || null
    });
  }
  return byMint;
}

function nearbyDecisions(byMint, mint, anchorAt) {
  const anchorMs = timeMs(anchorAt);
  return (byMint.get(mint) || []).filter((decision) => {
    const delta = timeMs(decision.timestamp) - anchorMs;
    return Number.isFinite(delta) && Math.abs(delta) <= DECISION_WINDOW_MS;
  });
}

function actualEntryCount(events) {
  return events.filter((event) => event.type === 'pre_migration_paper.entry').length;
}

function summarizeRun(filePath) {
  const events = readJsonl(filePath);
  const sim = buildPaperSimReport(events, filePath, DEFAULT_STRATEGY);
  const decisions = collectDecisions(events);
  let runtimeComparableTrades = 0;
  let runtimeRejectedTrades = 0;
  let noRuntimeDecisionTrades = 0;
  for (const trade of sim.simulatedTrades || []) {
    const nearby = nearbyDecisions(decisions, trade.mint, trade.entryAt);
    const entered = nearby.some((decision) => decision.decision === 'PAPER_ENTRY');
    const skipped = nearby.some((decision) => decision.decision === 'PAPER_SKIPPED');
    if (entered || !skipped) runtimeComparableTrades += 1;
    if (skipped && !entered) runtimeRejectedTrades += 1;
    if (!nearby.length) noRuntimeDecisionTrades += 1;
  }
  return {
    telemetryPath: rel(filePath),
    firstTimestamp: sim.run?.firstTimestamp || null,
    simulatedTrades: sim.summary?.simulatedTrades || 0,
    actualEntries: actualEntryCount(events),
    runtimeComparableTrades,
    runtimeRejectedTrades,
    noRuntimeDecisionTrades,
    comparableRate: sim.summary?.simulatedTrades
      ? Number((runtimeComparableTrades / sim.summary.simulatedTrades).toFixed(4))
      : null
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function buildReport() {
  const runs = latestTelemetryFiles(RUN_LIMIT).map(summarizeRun);
  const totals = runs.reduce((acc, run) => {
    acc.simulatedTrades += run.simulatedTrades;
    acc.actualEntries += run.actualEntries;
    acc.runtimeComparableTrades += run.runtimeComparableTrades;
    acc.runtimeRejectedTrades += run.runtimeRejectedTrades;
    acc.noRuntimeDecisionTrades += run.noRuntimeDecisionTrades;
    return acc;
  }, {
    simulatedTrades: 0,
    actualEntries: 0,
    runtimeComparableTrades: 0,
    runtimeRejectedTrades: 0,
    noRuntimeDecisionTrades: 0
  });
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      telemetryFilesRead: runs.length,
      runLimit: RUN_LIMIT
    },
    summary: {
      ...totals,
      comparableRate: totals.simulatedTrades
        ? Number((totals.runtimeComparableTrades / totals.simulatedTrades).toFixed(4))
        : null,
      runComparableClassCounts: countBy(runs, (run) => {
        if (!run.simulatedTrades) return 'no_sim_trades';
        if (run.runtimeComparableTrades === run.simulatedTrades) return 'all_comparable';
        if (run.runtimeComparableTrades === 0) return 'none_comparable';
        return 'mixed';
      })
    },
    runs,
    note: 'Report-only rolling divergence trend for the exploratory single-preset pre-migration sim versus same-window runtime decisions. Rebuilds each recent run from telemetry and does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

module.exports = { buildReport };
