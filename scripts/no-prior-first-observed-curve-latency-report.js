#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { readJson, readJsonl } = require('./no-prior-replay-diagnostic');

const ROOT = path.join(__dirname, '..');
const FIRST_OBSERVED_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-first-observed-curve-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-first-observed-curve-latency-latest.json');

function repoPath(filePath) {
  return filePath ? path.join(ROOT, filePath) : null;
}

function timestampMs(value) {
  const parsed = Date.parse(value || 0);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 3) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null;
}

function secondsBetween(startAt, endAt) {
  const startMs = timestampMs(startAt);
  const endMs = timestampMs(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return round((endMs - startMs) / 1000, 3);
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(event) {
  const payload = payloadOf(event);
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function stats(values) {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return { count: 0, min: null, median: null, average: null, max: null };
  const midpoint = Math.floor(numbers.length / 2);
  const median = numbers.length % 2
    ? numbers[midpoint]
    : (numbers[midpoint - 1] + numbers[midpoint]) / 2;
  const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return {
    count: numbers.length,
    min: round(numbers[0]),
    median: round(median),
    average: round(average),
    max: round(numbers[numbers.length - 1])
  };
}

function firstEvent(events, mint, type) {
  return events
    .filter((event) => mintOf(event) === mint && eventType(event) === type)
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
}

function buildRow(row, events) {
  const providerNewToken = firstEvent(events, row.mint, 'provider.pumpportal.new_token');
  const preMigrationObserved = firstEvent(events, row.mint, 'pre_migration.observed');
  const bondingCurveUpdated = firstEvent(events, row.mint, 'pump_bonding_curve.updated');

  return {
    mint: row.mint,
    symbol: row.symbol,
    diagnosis: row.diagnosis,
    firstObservedCurveBucket: row.firstObservedCurveBucket,
    firstObservedCurveProgress: row.firstObservedCurveProgress,
    fullyBondedAtFirstObservedCurve: row.bondCompletedBeforeFirstObservation,
    firstSeenAt: row.firstSeenAt,
    firstObservedCurveAt: row.firstObservedAt,
    firstObservedCurveType: row.firstObservedType,
    providerNewTokenAt: providerNewToken?.timestamp || null,
    preMigrationObservedAt: preMigrationObserved?.timestamp || null,
    firstBondingCurveUpdatedAt: bondingCurveUpdated?.timestamp || null,
    secondsProviderNewTokenAfterFirstSeen: secondsBetween(row.firstSeenAt, providerNewToken?.timestamp),
    secondsPreMigrationObservedAfterFirstSeen: secondsBetween(row.firstSeenAt, preMigrationObserved?.timestamp),
    secondsFirstCurveAfterFirstSeen: secondsBetween(row.firstSeenAt, row.firstObservedAt),
    secondsFirstBondingCurveUpdateAfterFirstSeen: secondsBetween(row.firstSeenAt, bondingCurveUpdated?.timestamp),
    secondsFirstCurveAfterProviderNewToken: secondsBetween(providerNewToken?.timestamp, row.firstObservedAt),
    secondsCurve75AfterFirstCurve: secondsBetween(row.firstObservedAt, row.curve75At),
    secondsCurve100AfterFirstCurve: secondsBetween(row.firstObservedAt, row.curve100At)
  };
}

function cohort(rows, predicate) {
  return rows.filter(predicate);
}

function summarizeCohort(rows) {
  return {
    rows: rows.length,
    firstObservedCurveTypeCounts: countBy(rows, (row) => row.firstObservedCurveType),
    diagnosisCounts: countBy(rows, (row) => row.diagnosis),
    firstCurveDelaySeconds: stats(rows.map((row) => row.secondsFirstCurveAfterFirstSeen)),
    firstCurveAfterProviderNewTokenSeconds: stats(rows.map((row) => row.secondsFirstCurveAfterProviderNewToken)),
    curve100AfterFirstCurveSeconds: stats(rows.map((row) => row.secondsCurve100AfterFirstCurve))
  };
}

function buildReport() {
  const firstObserved = readJson(FIRST_OBSERVED_PATH, {});
  const eventsByPath = new Map();

  const rows = (firstObserved.rows || []).map((row) => {
    const telemetryPath = repoPath(row.telemetryPath);
    if (!eventsByPath.has(telemetryPath)) {
      eventsByPath.set(telemetryPath, readJsonl(telemetryPath));
    }
    return buildRow(row, eventsByPath.get(telemetryPath));
  });

  const fullyBondedRows = cohort(rows, (row) => row.fullyBondedAtFirstObservedCurve === true);
  const midCurveRows = cohort(rows, (row) => row.fullyBondedAtFirstObservedCurve === false);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      firstObservedCurvePath: path.relative(ROOT, FIRST_OBSERVED_PATH).replace(/\\/g, '/'),
      telemetryFilesRead: eventsByPath.size
    },
    summary: {
      rows: rows.length,
      fullyBondedRows: fullyBondedRows.length,
      midCurveRows: midCurveRows.length,
      firstObservedCurveTypeCounts: countBy(rows, (row) => row.firstObservedCurveType),
      overall: summarizeCohort(rows),
      fullyBondedAtFirstObservedCurve: summarizeCohort(fullyBondedRows),
      midCurveAtFirstObservedCurve: summarizeCohort(midCurveRows)
    },
    rows,
    slowestFirstCurveRows: [...rows]
      .sort((a, b) => Number(b.secondsFirstCurveAfterFirstSeen || -Infinity) - Number(a.secondsFirstCurveAfterFirstSeen || -Infinity))
      .slice(0, 12),
    fullyBondedSlowRows: [...fullyBondedRows]
      .sort((a, b) => Number(b.secondsFirstCurveAfterFirstSeen || -Infinity) - Number(a.secondsFirstCurveAfterFirstSeen || -Infinity))
      .slice(0, 12),
    note: 'Report-only latency/source audit for false-negative mints. Measures how long after Spectre firstSeenAt the first finite curve snapshot arrived, whether the first usable curve came from the bonding-curve lane, and how this differs between fully bonded-at-first-observation and mid-curve cases. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH).replace(/\\/g, '/')}`);
}

module.exports = { buildReport };
