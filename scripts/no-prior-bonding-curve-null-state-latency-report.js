#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { readJson, readJsonl } = require('./no-prior-replay-diagnostic');

const ROOT = path.join(__dirname, '..');
const FIRST_OBSERVED_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-first-observed-curve-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-bonding-curve-null-state-latency-latest.json');

function repoPath(filePath) {
  return filePath ? path.join(ROOT, filePath) : null;
}

function timestampMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
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
  const median = numbers.length % 2 ? numbers[midpoint] : (numbers[midpoint - 1] + numbers[midpoint]) / 2;
  const average = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return {
    count: numbers.length,
    min: round(numbers[0]),
    median: round(median),
    average: round(average),
    max: round(numbers[numbers.length - 1])
  };
}

function bondingUpdates(events, mint) {
  return events
    .filter((event) => event.type === 'pump_bonding_curve.updated' && event.payload?.mint === mint)
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
}

function hasFiniteCurveProgress(event) {
  const raw = event?.payload?.curveProgress;
  return raw !== null && raw !== undefined && Number.isFinite(Number(raw));
}

function classifyRow(row) {
  if (!row.bondingCurveUpdateCount) return 'NO_BONDING_UPDATES';
  if (!row.nonFiniteUpdateCountBeforeFirstFinite) return 'FINITE_ON_FIRST_UPDATE';
  return 'NULL_BEFORE_FINITE';
}

function buildRow(row, events) {
  const updates = bondingUpdates(events, row.mint);
  const firstUpdate = updates[0] || null;
  const finiteUpdates = updates.filter(hasFiniteCurveProgress);
  const firstFinite = finiteUpdates[0] || null;
  const nonFiniteBeforeFirstFinite = firstFinite
    ? updates.filter((event) => timestampMs(event.timestamp) < timestampMs(firstFinite.timestamp)
      && !hasFiniteCurveProgress(event))
    : updates.filter((event) => !hasFiniteCurveProgress(event));
  const lastNonFiniteBeforeFirstFinite = nonFiniteBeforeFirstFinite[nonFiniteBeforeFirstFinite.length - 1] || null;
  const accountNotFoundBeforeFinite = nonFiniteBeforeFirstFinite.filter((event) => event.payload?.accountFound === false);

  const built = {
    mint: row.mint,
    symbol: row.symbol,
    diagnosis: row.diagnosis,
    firstObservedCurveBucket: row.firstObservedCurveBucket,
    firstObservedCurveProgress: row.firstObservedCurveProgress,
    fullyBondedAtFirstObservedCurve: row.bondCompletedBeforeFirstObservation,
    firstSeenAt: row.firstSeenAt,
    firstFiniteCurveAt: firstFinite?.timestamp || null,
    firstBondingCurveUpdatedAt: firstUpdate?.timestamp || null,
    lastNonFiniteBeforeFirstFiniteAt: lastNonFiniteBeforeFirstFinite?.timestamp || null,
    bondingCurveUpdateCount: updates.length,
    finiteUpdateCount: finiteUpdates.length,
    nonFiniteUpdateCountBeforeFirstFinite: nonFiniteBeforeFirstFinite.length,
    accountNotFoundCountBeforeFirstFinite: accountNotFoundBeforeFinite.length,
    firstUpdateAccountFound: firstUpdate?.payload?.accountFound ?? null,
    firstUpdateComplete: firstUpdate?.payload?.complete ?? null,
    firstUpdateCurveProgress: hasFiniteCurveProgress(firstUpdate)
      ? round(firstUpdate.payload.curveProgress, 6)
      : null,
    secondsFirstUpdateAfterFirstSeen: secondsBetween(row.firstSeenAt, firstUpdate?.timestamp),
    secondsFirstFiniteAfterFirstSeen: secondsBetween(row.firstSeenAt, firstFinite?.timestamp),
    nullStateGapSeconds: secondsBetween(firstUpdate?.timestamp, firstFinite?.timestamp),
    lastNullToFirstFiniteGapSeconds: secondsBetween(lastNonFiniteBeforeFirstFinite?.timestamp, firstFinite?.timestamp)
  };
  return { ...built, nullStateClass: classifyRow(built) };
}

function summarize(rows) {
  return {
    rows: rows.length,
    nullStateClassCounts: countBy(rows, (row) => row.nullStateClass),
    diagnosisCounts: countBy(rows, (row) => row.diagnosis),
    firstObservedCurveBucketCounts: countBy(rows, (row) => row.firstObservedCurveBucket),
    firstUpdateDelaySeconds: stats(rows.map((row) => row.secondsFirstUpdateAfterFirstSeen)),
    firstFiniteDelaySeconds: stats(rows.map((row) => row.secondsFirstFiniteAfterFirstSeen)),
    nullStateGapSeconds: stats(rows.map((row) => row.nullStateGapSeconds)),
    accountNotFoundBeforeFiniteRows: rows.filter((row) => row.accountNotFoundCountBeforeFirstFinite > 0).length
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
  const midCurveRows = rows.filter((row) => row.fullyBondedAtFirstObservedCurve === false);
  const fullyBondedRows = rows.filter((row) => row.fullyBondedAtFirstObservedCurve === true);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      firstObservedCurvePath: path.relative(ROOT, FIRST_OBSERVED_PATH).replace(/\\/g, '/'),
      telemetryFilesRead: eventsByPath.size
    },
    summary: {
      rows: rows.length,
      overall: summarize(rows),
      midCurveAtFirstObservedCurve: summarize(midCurveRows),
      fullyBondedAtFirstObservedCurve: summarize(fullyBondedRows)
    },
    rows,
    topNullBeforeFiniteRows: rows
      .filter((row) => row.nullStateClass === 'NULL_BEFORE_FINITE')
      .sort((a, b) => Number(b.nullStateGapSeconds || -Infinity) - Number(a.nullStateGapSeconds || -Infinity))
      .slice(0, 12),
    topMidCurveNullBeforeFiniteRows: midCurveRows
      .filter((row) => row.nullStateClass === 'NULL_BEFORE_FINITE')
      .sort((a, b) => Number(b.nullStateGapSeconds || -Infinity) - Number(a.nullStateGapSeconds || -Infinity))
      .slice(0, 12),
    note: 'Report-only bonding-curve null-state latency audit for false-negative mints. Distinguishes first bonding-curve lane activation from first finite curve availability, including rows where the lane emitted accountFound=false or other non-finite updates before a usable curve arrived. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
