#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { readJson, readJsonl } = require('./no-prior-replay-diagnostic');

const ROOT = path.join(__dirname, '..');
const FIRST_OBSERVED_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-first-observed-curve-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-paper-decision-curve-source-latest.json');

function repoPath(filePath) {
  return filePath ? path.join(ROOT, filePath) : null;
}

function timestampMs(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 6) {
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
  if (!event) return {};
  return event.payload || event.data || {};
}

function mintOf(event) {
  const payload = payloadOf(event);
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function hasFiniteCurveProgress(event) {
  const raw = payloadOf(event).curveProgress;
  return raw !== null && raw !== undefined && Number.isFinite(Number(raw));
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function firstEvent(events, mint, predicate) {
  return events
    .filter((event) => mintOf(event) === mint && predicate(event))
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))[0] || null;
}

function latestPriorCurveSource(events, mint, decisionAt) {
  const decisionMs = timestampMs(decisionAt);
  return events
    .filter((event) => mintOf(event) === mint
      && timestampMs(event.timestamp) < decisionMs
      && hasFiniteCurveProgress(event))
    .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))[0] || null;
}

function sourceLabel(event) {
  if (!event) return 'NO_FINITE_PRIOR_CURVE_SOURCE';
  return event.type || event.event || event.name || 'unknown';
}

function buildRow(row, events) {
  const firstPaperDecision = firstEvent(events, row.mint, (event) => event.type === 'pre_migration_paper.decision');
  const firstNoPriorDecision = firstEvent(events, row.mint, (event) => {
    if (event.type !== 'pre_migration_paper.decision') return false;
    const payload = payloadOf(event);
    return payload.reason === 'NO_PRIOR_CURVE_PROGRESS';
  });
  const decision = firstNoPriorDecision || firstPaperDecision;
  const decisionPayload = payloadOf(decision);
  const latestCurveSource = latestPriorCurveSource(events, row.mint, decision?.timestamp);
  const sourcePayload = payloadOf(latestCurveSource);
  const decisionCurveProgress = decisionPayload.curveProgress;
  const hasFiniteDecisionCurve = decisionCurveProgress !== null
    && decisionCurveProgress !== undefined
    && Number.isFinite(Number(decisionCurveProgress));

  return {
    mint: row.mint,
    symbol: row.symbol,
    diagnosis: row.diagnosis,
    firstObservedCurveBucket: row.firstObservedCurveBucket,
    fullyBondedAtFirstObservedCurve: row.bondCompletedBeforeFirstObservation,
    firstPaperDecisionAt: decision?.timestamp || null,
    firstPaperDecisionReason: decisionPayload.reason || null,
    firstPaperDecisionCurveProgress: hasFiniteDecisionCurve ? round(decisionCurveProgress) : null,
    firstPaperDecisionCurveState: hasFiniteDecisionCurve ? 'FINITE' : 'MISSING',
    latestPriorFiniteCurveSourceType: sourceLabel(latestCurveSource),
    latestPriorFiniteCurveAt: latestCurveSource?.timestamp || null,
    latestPriorFiniteCurveProgress: hasFiniteCurveProgress(latestCurveSource)
      ? round(sourcePayload.curveProgress)
      : null,
    secondsPriorFiniteCurveToDecision: secondsBetween(latestCurveSource?.timestamp, decision?.timestamp),
    firstObservedFiniteCurveAt: row.firstObservedAt,
    secondsFirstObservedFiniteCurveToDecision: secondsBetween(row.firstObservedAt, decision?.timestamp)
  };
}

function summarize(rows) {
  return {
    rows: rows.length,
    decisionCurveStateCounts: countBy(rows, (row) => row.firstPaperDecisionCurveState),
    decisionReasonCounts: countBy(rows, (row) => row.firstPaperDecisionReason),
    priorFiniteCurveSourceTypeCounts: countBy(rows, (row) => row.latestPriorFiniteCurveSourceType),
    rowsWithFiniteDecisionCurve: rows.filter((row) => row.firstPaperDecisionCurveState === 'FINITE').length,
    rowsWithoutFiniteDecisionCurve: rows.filter((row) => row.firstPaperDecisionCurveState === 'MISSING').length
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
    missingCurveDecisionRows: rows
      .filter((row) => row.firstPaperDecisionCurveState === 'MISSING')
      .slice(0, 20),
    finiteCurveDecisionRows: rows
      .filter((row) => row.firstPaperDecisionCurveState === 'FINITE')
      .slice(0, 20),
    note: 'Report-only paper-decision curve-state audit for false-negative mints. Shows whether the first paper decision carried a finite curveProgress and whether any earlier finite curve-bearing telemetry event existed before that decision. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
