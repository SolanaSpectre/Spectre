#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { readJson, readJsonl } = require('./no-prior-replay-diagnostic');
const { isRuntimeProviderEvent } = require('./lib/runtime-provider-events');

const ROOT = path.join(__dirname, '..');
const FIRST_OBSERVED_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-first-observed-curve-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-first-update-latency-decomposition-latest.json');

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

function payloadOf(event) {
  return event?.payload || event?.data || {};
}

function mintOf(event) {
  const payload = payloadOf(event);
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function firstEvent(events, mint, predicate) {
  return events
    .filter((event) => mintOf(event) === mint && predicate(event))
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
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

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function hasFiniteCurveProgress(event) {
  const raw = payloadOf(event).curveProgress;
  return raw !== null && raw !== undefined && Number.isFinite(Number(raw));
}

function buildRow(row, events) {
  const providerNewToken = firstEvent(events, row.mint, (event) => isRuntimeProviderEvent(event, 'newToken'));
  const firstBondingUpdate = firstEvent(events, row.mint, (event) => event.type === 'pump_bonding_curve.updated');
  const firstFiniteCurve = firstEvent(events, row.mint, (event) => event.type === 'pump_bonding_curve.updated' && hasFiniteCurveProgress(event));
  const firstPaperDecision = firstEvent(events, row.mint, (event) => event.type === 'pre_migration_paper.decision');

  return {
    mint: row.mint,
    symbol: row.symbol,
    diagnosis: row.diagnosis,
    firstObservedCurveBucket: row.firstObservedCurveBucket,
    firstObservedCurveProgress: row.firstObservedCurveProgress,
    fullyBondedAtFirstObservedCurve: row.bondCompletedBeforeFirstObservation,
    firstSeenAt: row.firstSeenAt,
    providerNewTokenAt: providerNewToken?.timestamp || null,
    firstBondingUpdateAt: firstBondingUpdate?.timestamp || null,
    firstFiniteCurveAt: firstFiniteCurve?.timestamp || null,
    firstPaperDecisionAt: firstPaperDecision?.timestamp || null,
    firstPaperDecisionReason: payloadOf(firstPaperDecision).reason || null,
    secondsFirstSeenToProviderNewToken: secondsBetween(row.firstSeenAt, providerNewToken?.timestamp),
    secondsProviderNewTokenToFirstBondingUpdate: secondsBetween(providerNewToken?.timestamp, firstBondingUpdate?.timestamp),
    secondsFirstSeenToFirstBondingUpdate: secondsBetween(row.firstSeenAt, firstBondingUpdate?.timestamp),
    secondsFirstBondingUpdateToFirstFiniteCurve: secondsBetween(firstBondingUpdate?.timestamp, firstFiniteCurve?.timestamp),
    secondsFirstSeenToFirstFiniteCurve: secondsBetween(row.firstSeenAt, firstFiniteCurve?.timestamp),
    secondsFirstFiniteCurveToFirstPaperDecision: secondsBetween(firstFiniteCurve?.timestamp, firstPaperDecision?.timestamp),
    secondsFirstSeenToFirstPaperDecision: secondsBetween(row.firstSeenAt, firstPaperDecision?.timestamp)
  };
}

function summarize(rows) {
  return {
    rows: rows.length,
    diagnosisCounts: countBy(rows, (row) => row.diagnosis),
    firstObservedCurveBucketCounts: countBy(rows, (row) => row.firstObservedCurveBucket),
    firstPaperDecisionReasonCounts: countBy(rows, (row) => row.firstPaperDecisionReason),
    firstSeenToProviderNewTokenSeconds: stats(rows.map((row) => row.secondsFirstSeenToProviderNewToken)),
    providerNewTokenToFirstBondingUpdateSeconds: stats(rows.map((row) => row.secondsProviderNewTokenToFirstBondingUpdate)),
    firstSeenToFirstBondingUpdateSeconds: stats(rows.map((row) => row.secondsFirstSeenToFirstBondingUpdate)),
    firstBondingUpdateToFirstFiniteCurveSeconds: stats(rows.map((row) => row.secondsFirstBondingUpdateToFirstFiniteCurve)),
    firstSeenToFirstFiniteCurveSeconds: stats(rows.map((row) => row.secondsFirstSeenToFirstFiniteCurve)),
    firstFiniteCurveToFirstPaperDecisionSeconds: stats(rows.map((row) => row.secondsFirstFiniteCurveToFirstPaperDecision)),
    firstSeenToFirstPaperDecisionSeconds: stats(rows.map((row) => row.secondsFirstSeenToFirstPaperDecision))
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
  const fullyBondedRows = rows.filter((row) => row.fullyBondedAtFirstObservedCurve === true);
  const midCurveRows = rows.filter((row) => row.fullyBondedAtFirstObservedCurve === false);

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
      fullyBondedAtFirstObservedCurve: summarize(fullyBondedRows),
      midCurveAtFirstObservedCurve: summarize(midCurveRows)
    },
    rows,
    slowestProviderToBondingRows: [...rows]
      .sort((a, b) => Number(b.secondsProviderNewTokenToFirstBondingUpdate || -Infinity) - Number(a.secondsProviderNewTokenToFirstBondingUpdate || -Infinity))
      .slice(0, 12),
    slowestFiniteToDecisionRows: [...rows]
      .sort((a, b) => Number(b.secondsFirstFiniteCurveToFirstPaperDecision || -Infinity) - Number(a.secondsFirstFiniteCurveToFirstPaperDecision || -Infinity))
      .slice(0, 12),
    note: 'Report-only latency decomposition for false-negative mints. Splits the path into Spectre firstSeenAt -> PumpPortal new token -> first bonding-curve update -> first finite curve -> first paper decision. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
