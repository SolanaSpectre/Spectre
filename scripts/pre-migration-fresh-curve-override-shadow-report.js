#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-fresh-curve-override-shadow-latest.json');

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

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function eventType(event = {}) {
  return event.type || event.telemetryType || event.eventType || event.name || '';
}

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
}

function bump(target, key, amount = 1) {
  const label = key || 'unknown';
  target[label] = (target[label] || 0) + amount;
}

function topObject(object = {}, limit = 12) {
  return Object.fromEntries(Object.entries(object)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit));
}

function topRows(rows = [], scoreFn, limit = 20) {
  return rows.slice()
    .sort((a, b) => Number(scoreFn(b) || 0) - Number(scoreFn(a) || 0))
    .slice(0, limit);
}

function buildReport(telemetryPath) {
  const summary = {
    telemetryPath: path.relative(ROOT, telemetryPath),
    rows: 0,
    uniqueMints: 0,
    wouldEnter: 0,
    changedOutcome: 0,
    stillBlocked: 0,
    entryGuardPassed: 0,
    bySourceReason: {},
    byDecisionReason: {},
    byEntryGuardReason: {},
    byVerifierStatus: {},
    byPreset: {},
    accountAgeMs: [],
    curveDelta: [],
    originalCurveSnapshotAgeSeconds: []
  };
  const mints = new Set();
  const rows = [];

  const readStats = forEachJsonlSync(telemetryPath, (event) => {
    if (eventType(event) !== 'pre_migration_paper.fresh_curve_override_shadow') return;
    const payload = payloadOf(event);
    summary.rows += 1;
    if (payload.mint) mints.add(payload.mint);
    if (payload.wouldEnter === true) summary.wouldEnter += 1;
    if (payload.changedOutcome === true) summary.changedOutcome += 1;
    if (payload.freshCurveStillBlocked === true) summary.stillBlocked += 1;
    if (payload.entryGuardPassed === true) summary.entryGuardPassed += 1;
    bump(summary.bySourceReason, payload.sourceReason);
    bump(summary.byDecisionReason, payload.decisionReason);
    bump(summary.byEntryGuardReason, payload.entryGuardReason);
    bump(summary.byVerifierStatus, payload.verifierStatus);
    bump(summary.byPreset, payload.preset);
    const accountAgeMs = num(payload.accountAgeMs, 0);
    const curveDelta = num(payload.curveDelta, 6);
    const originalAge = num(payload.originalCurveSnapshotAgeSeconds, 2);
    if (accountAgeMs !== null) summary.accountAgeMs.push(accountAgeMs);
    if (curveDelta !== null) summary.curveDelta.push(curveDelta);
    if (originalAge !== null) summary.originalCurveSnapshotAgeSeconds.push(originalAge);
    rows.push({
      mint: payload.mint || null,
      symbol: payload.symbol || null,
      sourceTelemetryType: payload.sourceTelemetryType || null,
      sourceReason: payload.sourceReason || null,
      preset: payload.preset || null,
      score: num(payload.score, 2),
      originalCurveProgress: num(payload.originalCurveProgress, 6),
      accountCurveProgress: num(payload.accountCurveProgress, 6),
      curveDelta,
      originalCurveSnapshotAgeSeconds: originalAge,
      accountAgeMs,
      entryGuardPassed: payload.entryGuardPassed === true,
      entryGuardReason: payload.entryGuardReason || null,
      decisionPassed: payload.decisionPassed === true,
      decisionReason: payload.decisionReason || null,
      wouldEnter: payload.wouldEnter === true,
      changedOutcome: payload.changedOutcome === true
    });
  });

  summary.uniqueMints = mints.size;
  const percentile = (values, p) => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[index];
  };
  summary.accountAgeMs = {
    count: summary.accountAgeMs.length,
    median: percentile(summary.accountAgeMs, 50),
    p90: percentile(summary.accountAgeMs, 90),
    max: summary.accountAgeMs.length ? Math.max(...summary.accountAgeMs) : null
  };
  summary.curveDelta = {
    count: summary.curveDelta.length,
    median: num(percentile(summary.curveDelta, 50), 6),
    p90: num(percentile(summary.curveDelta, 90), 6),
    max: summary.curveDelta.length ? num(Math.max(...summary.curveDelta), 6) : null,
    min: summary.curveDelta.length ? num(Math.min(...summary.curveDelta), 6) : null
  };
  summary.originalCurveSnapshotAgeSeconds = {
    count: summary.originalCurveSnapshotAgeSeconds.length,
    median: num(percentile(summary.originalCurveSnapshotAgeSeconds, 50), 2),
    p90: num(percentile(summary.originalCurveSnapshotAgeSeconds, 90), 2),
    max: summary.originalCurveSnapshotAgeSeconds.length ? num(Math.max(...summary.originalCurveSnapshotAgeSeconds), 2) : null
  };

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_fresh_curve_override_shadow',
    note: 'Summarizes report-only shadow rows that replay stale/CURVE_NOT_ADVANCING paper decisions with fresh finalist account curve state. Does not alter gates, entries, exits, AI review, quotes, broadcast, or live behavior.',
    malformedLines: readStats.malformedLines,
    summary: {
      ...summary,
      bySourceReason: topObject(summary.bySourceReason),
      byDecisionReason: topObject(summary.byDecisionReason),
      byEntryGuardReason: topObject(summary.byEntryGuardReason),
      byVerifierStatus: topObject(summary.byVerifierStatus),
      byPreset: topObject(summary.byPreset)
    },
    changedOutcomeRows: topRows(rows.filter((row) => row.changedOutcome), (row) => row.curveDelta, 20),
    largestPositiveDeltaRows: topRows(rows, (row) => row.curveDelta, 20),
    closestStillBlockedRows: topRows(
      rows.filter((row) => !row.changedOutcome),
      (row) => Number(row.entryGuardPassed === true) * 10 + Number(row.curveDelta || 0),
      20
    )
  };
}

function printReport(report) {
  const s = report.summary;
  const formatMs = (value) => value === null || value === undefined ? 'n/a' : `${value}ms`;
  console.log('Pre-Migration Fresh Curve Override Shadow');
  console.log(`Telemetry: ${s.telemetryPath}`);
  console.log(`Rows/unique mints: ${s.rows}/${s.uniqueMints}`);
  console.log(`Would enter/changed outcome/still blocked: ${s.wouldEnter}/${s.changedOutcome}/${s.stillBlocked}`);
  console.log(`Entry guard passed: ${s.entryGuardPassed}`);
  console.log(`Account age median/p90/max: ${formatMs(s.accountAgeMs.median)}/${formatMs(s.accountAgeMs.p90)}/${formatMs(s.accountAgeMs.max)}`);
  console.log(`Curve delta median/p90/max: ${s.curveDelta.median ?? 'n/a'}/${s.curveDelta.p90 ?? 'n/a'}/${s.curveDelta.max ?? 'n/a'}`);
  console.log(`Source reasons: ${Object.entries(s.bySourceReason).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
  console.log(`Decision reasons: ${Object.entries(s.byDecisionReason).map(([key, value]) => `${key}=${value}`).join(', ') || 'none'}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  const report = buildReport(telemetryPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  printReport(report);
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = { buildReport, printReport };

if (require.main === module) {
  main();
}
