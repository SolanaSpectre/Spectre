#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-follow-through-slice-shadow-latest.json');
const ENTER_TYPE = 'pre_migration_flagged_follow_through_slice_shadow.would_enter';
const SKIP_TYPE = 'pre_migration_flagged_follow_through_slice_shadow.would_skip';

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

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function eventType(event) {
  return event.telemetryType || event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function bump(counts, key) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + 1;
}

function topCounts(counts = {}, limit = 12) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
  );
}

function numericStats(values, digits = 6) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: compact(sorted[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(sorted[sorted.length - 1], digits),
    avg: compact(sum / sorted.length, digits)
  };
}

function scan(filePath) {
  const rows = [];
  const counts = { events: {}, sourceReasons: {}, presets: {}, lanes: {}, profiles: {} };
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    if (type !== ENTER_TYPE && type !== SKIP_TYPE) return;
    const payload = payloadOf(event);
    const row = {
      telemetryType: type,
      decision: payload.decision || null,
      mint: payload.mint || payload.tokenMint || null,
      symbol: payload.symbol || null,
      timestamp: payload.timestamp || event.timestamp || event.receivedAt || null,
      sourceReason: payload.sourceReason || payload.sourceGuardReason || null,
      preset: payload.preset || null,
      lane: payload.lane || null,
      score: compact(payload.score, 2),
      curveProgress: compact(payload.curveProgress, 6),
      curveProgressDelta: compact(payload.curveProgressDelta, 6),
      curveProgressDelta60s: compact(payload.curveProgressDelta60s, 6),
      recentVolumeSol: compact(payload.recentVolumeSol, 4),
      tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
      buyRatio: compact(payload.buyRatio, 4),
      uniqueBuyerCount: compact(payload.uniqueBuyerCount, 0),
      sniperWalletCount: compact(payload.sniperWalletCount, 0),
      priceSol: compact(payload.priceSol || payload.curvePriceSol || payload.bondingCurvePriceSol, 15),
      wouldEnterProfiles: Array.isArray(payload.wouldEnterProfiles) ? payload.wouldEnterProfiles.slice() : [],
      profileResults: Array.isArray(payload.profileResults) ? payload.profileResults : [],
      walletSignals: payload.walletSignals || null,
      failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks.slice() : []
    };
    rows.push(row);
    bump(counts.events, type);
    bump(counts.sourceReasons, row.sourceReason);
    bump(counts.presets, row.preset);
    bump(counts.lanes, row.lane);
    for (const profile of row.wouldEnterProfiles) bump(counts.profiles, profile);
  }, { bufferSize: 1024 * 1024 });
  return { rows, counts, stats };
}

function buildReport(filePath) {
  const scanned = scan(filePath);
  const rows = scanned.rows;
  const wouldEnterRows = rows.filter((row) => row.telemetryType === ENTER_TYPE);
  const wouldSkipRows = rows.filter((row) => row.telemetryType === SKIP_TYPE);
  const uniqueMints = new Set(rows.map((row) => row.mint).filter(Boolean));
  const wouldEnterUniqueMints = new Set(wouldEnterRows.map((row) => row.mint).filter(Boolean));
  const profileRows = {};
  for (const row of wouldEnterRows) {
    for (const profile of row.wouldEnterProfiles) {
      if (!profileRows[profile]) profileRows[profile] = [];
      profileRows[profile].push(row);
    }
  }
  const profiles = Object.entries(profileRows)
    .map(([name, profileRowSet]) => ({
      name,
      rows: profileRowSet.length,
      uniqueMints: new Set(profileRowSet.map((row) => row.mint).filter(Boolean)).size,
      sourceReasons: topCounts(profileRowSet.reduce((counts, row) => {
        bump(counts, row.sourceReason);
        return counts;
      }, {}), 8),
      presets: topCounts(profileRowSet.reduce((counts, row) => {
        bump(counts, row.preset);
        return counts;
      }, {}), 8),
      score: numericStats(profileRowSet.map((row) => row.score), 2),
      curveProgress: numericStats(profileRowSet.map((row) => row.curveProgress), 6),
      recentVolumeSol: numericStats(profileRowSet.map((row) => row.recentVolumeSol), 4),
      tradeVelocityPerMin: numericStats(profileRowSet.map((row) => row.tradeVelocityPerMin), 2)
    }))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath: path.relative(ROOT, filePath),
    summary: {
      rows: rows.length,
      wouldEnterRows: wouldEnterRows.length,
      wouldSkipRows: wouldSkipRows.length,
      uniqueMints: uniqueMints.size,
      wouldEnterUniqueMints: wouldEnterUniqueMints.size,
      verdict: rows.length === 0
        ? 'NO_RUNTIME_SHADOW_EVENTS'
        : wouldEnterRows.length === 0
          ? 'NO_PROMISING_SLICE_RUNTIME_MATCHES'
          : 'RUNTIME_SHADOW_MATCHES_PRESENT',
      sourceReasons: topCounts(scanned.counts.sourceReasons),
      presets: topCounts(scanned.counts.presets),
      lanes: topCounts(scanned.counts.lanes),
      profileMatches: topCounts(scanned.counts.profiles),
      eventCounts: topCounts(scanned.counts.events),
      jsonlRowsScanned: scanned.stats.rows,
      malformedLines: scanned.stats.malformedLines
    },
    profiles,
    sampleWouldEnter: wouldEnterRows.slice(0, 25)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || args.file) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run after a paper session.');
    process.exit(1);
  }
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const report = buildReport(telemetryPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  scan
};
