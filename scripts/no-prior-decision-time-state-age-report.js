#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { readJson } = require('./no-prior-replay-diagnostic');

const ROOT = path.join(__dirname, '..');
const ALTERNATIVE_STATE_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-decision-time-alternative-state-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-decision-time-state-age-latest.json');

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

function ageBucket(seconds) {
  if (!Number.isFinite(seconds)) return 'missing';
  if (seconds < 0.1) return '<100ms';
  if (seconds < 0.5) return '100-500ms';
  if (seconds < 2) return '500ms-2s';
  if (seconds < 10) return '2-10s';
  return '>10s';
}

function tradeSignalState(row) {
  const volume = Number(row.recentVolumeSol);
  const velocity = Number(row.tradeVelocityPerMin);
  if (Number.isFinite(volume) && volume > 0 && Number.isFinite(velocity) && velocity > 0) return 'STRONG';
  if ((Number.isFinite(volume) && volume > 0) || (Number.isFinite(velocity) && velocity > 0)) return 'WEAK';
  return 'NONE';
}

function bondingLaneState(row) {
  if (!row.bondingUpdateBeforeDecision) return 'ABSENT';
  if (row.bondingAccountFoundBeforeDecision === false) return 'ACCOUNT_NOT_FOUND';
  if (row.bondingCurveProgressBeforeDecision === null || row.bondingCurveProgressBeforeDecision === undefined) {
    return 'ACCOUNT_FOUND_NULL_CURVE';
  }
  return 'ACCOUNT_FOUND_FINITE_CURVE';
}

function buildRow(row) {
  const observedAge = secondsBetween(row.latestObservedAt, row.firstPaperDecisionAt);
  const flaggedAge = secondsBetween(row.latestFlaggedAt, row.firstPaperDecisionAt);
  const bondingAge = secondsBetween(row.latestBondingUpdateAt, row.firstPaperDecisionAt);
  return {
    ...row,
    secondsLatestObservedToDecision: observedAge,
    secondsLatestFlaggedToDecision: flaggedAge,
    secondsLatestBondingUpdateToDecision: bondingAge,
    observedAgeBucket: ageBucket(observedAge),
    flaggedAgeBucket: ageBucket(flaggedAge),
    bondingAgeBucket: ageBucket(bondingAge),
    tradeSignalState: tradeSignalState(row),
    bondingLaneState: bondingLaneState(row)
  };
}

function summarize(rows) {
  return {
    rows: rows.length,
    observedAgeBucketCounts: countBy(rows, (row) => row.observedAgeBucket),
    flaggedAgeBucketCounts: countBy(rows, (row) => row.flaggedAgeBucket),
    bondingAgeBucketCounts: countBy(rows, (row) => row.bondingAgeBucket),
    tradeSignalStateCounts: countBy(rows, (row) => row.tradeSignalState),
    bondingLaneStateCounts: countBy(rows, (row) => row.bondingLaneState),
    observedAgeSeconds: stats(rows.map((row) => row.secondsLatestObservedToDecision)),
    flaggedAgeSeconds: stats(rows.map((row) => row.secondsLatestFlaggedToDecision)),
    bondingAgeSeconds: stats(rows.map((row) => row.secondsLatestBondingUpdateToDecision))
  };
}

function buildReport() {
  const alternativeState = readJson(ALTERNATIVE_STATE_PATH, {});
  const rows = (alternativeState.rows || []).map(buildRow);
  const fullyBondedRows = rows.filter((row) => row.fullyBondedAtFirstObservedCurve === true);
  const midCurveRows = rows.filter((row) => row.fullyBondedAtFirstObservedCurve === false);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      alternativeStatePath: path.relative(ROOT, ALTERNATIVE_STATE_PATH).replace(/\\/g, '/')
    },
    summary: {
      rows: rows.length,
      overall: summarize(rows),
      fullyBondedAtFirstObservedCurve: summarize(fullyBondedRows),
      midCurveAtFirstObservedCurve: summarize(midCurveRows)
    },
    rows,
    note: 'Report-only state-age audit for missing-curve first paper decisions. Buckets freshness of observed/flagged/bonding state, separates trade-activity strength, and classifies bonding-lane coverage as absent, account-not-found, null-curve, or finite-curve. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
