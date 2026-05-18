#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildRows, summarizeHorizon } = require('./runner-raydium-shadow-fixed-horizon-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-raydium-shadow-historical-horizon-latest.json');
const HORIZON_KEYS = ['t5m', 't15m', 't30m'];

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function telemetryFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(LOG_DIR, name));
}

function summarizePayload(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp || null,
    mint: payload.token || payload.mint || null,
    symbol: payload.symbol || null,
    price: compact(payload.price, 12),
    ageBucket: payload.poolAgeKnown === true && Number(payload.poolAgeHours) < 24
      ? 'fresh_pool'
      : Number(payload.poolAgeHours) >= 24
        ? 'mature_or_established'
        : 'age_unknown',
    continuationVerdict: payload.continuation?.verdict || null
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function collectRows() {
  const rows = [];
  const runSummaries = [];
  for (const filePath of telemetryFiles()) {
    const observations = readJsonl(filePath)
      .filter((event) => eventType(event) === 'runner.raydium_shadow.observed')
      .map(summarizePayload);
    if (!observations.length) continue;
    const runRows = buildRows(observations).map((row) => ({
      ...row,
      telemetryPath: rel(filePath)
    }));
    rows.push(...runRows);
    runSummaries.push({
      telemetryPath: rel(filePath),
      observations: observations.length,
      mintRunPairs: runRows.length,
      horizonCoverage: Object.fromEntries(HORIZON_KEYS.map((key) => [key, summarizeHorizon(runRows, key).coveredMints]))
    });
  }
  return { rows, runSummaries };
}

function summarizeByAgeBucket(rows) {
  const buckets = {};
  for (const row of rows) {
    const key = row.ageBucket || 'UNKNOWN';
    const members = buckets[key] || [];
    members.push(row);
    buckets[key] = members;
  }
  return Object.fromEntries(
    Object.entries(buckets).map(([bucket, members]) => [
      bucket,
      {
        mintRunPairs: members.length,
        horizonSummaries: Object.fromEntries(HORIZON_KEYS.map((key) => [key, summarizeHorizon(members, key)]))
      }
    ])
  );
}

function buildReport() {
  const { rows, runSummaries } = collectRows();
  const uniqueMints = new Set(rows.map((row) => row.mint).filter(Boolean));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      logDir: rel(LOG_DIR),
      telemetryFilesRead: telemetryFiles().length,
      runsWithShadowRows: runSummaries.length
    },
    summary: {
      mintRunPairs: rows.length,
      uniqueMints: uniqueMints.size,
      ageBucketCounts: countBy(rows, (row) => row.ageBucket),
      horizonSummaries: Object.fromEntries(HORIZON_KEYS.map((key) => [key, summarizeHorizon(rows, key)]))
    },
    byAgeBucket: summarizeByAgeBucket(rows),
    runSummaries,
    rows,
    note: 'Report-only historical aggregate over repeated in-run Raydium shadow observations. Rows are mint-run pairs, not unique mints. Horizon samples use the first observed sample at or after each target time and remain null when a run ends before coverage exists.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  collectRows,
  summarizeByAgeBucket
};
