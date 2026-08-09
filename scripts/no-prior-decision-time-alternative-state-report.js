#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { readJson, readJsonl } = require('./no-prior-replay-diagnostic');
const { isRuntimeProviderEvent } = require('./lib/runtime-provider-events');

const ROOT = path.join(__dirname, '..');
const DECISION_SOURCE_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-paper-decision-curve-source-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-decision-time-alternative-state-latest.json');

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

function payloadOf(event) {
  return event?.payload || event?.data || {};
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

function latestBefore(events, mint, decisionAt, predicate) {
  const decisionMs = timestampMs(decisionAt);
  return events
    .filter((event) => mintOf(event) === mint && timestampMs(event.timestamp) < decisionMs && predicate(event))
    .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))[0] || null;
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function buildRow(row, events) {
  const decisionAt = row.firstPaperDecisionAt;
  const latestObserved = latestBefore(events, row.mint, decisionAt, (event) => event.type === 'pre_migration.observed');
  const latestFlagged = latestBefore(events, row.mint, decisionAt, (event) => event.type === 'pre_migration.flagged');
  const latestNewToken = latestBefore(events, row.mint, decisionAt, (event) => isRuntimeProviderEvent(event, 'newToken'));
  const latestBondingUpdate = latestBefore(events, row.mint, decisionAt, (event) => event.type === 'pump_bonding_curve.updated');

  const observedPayload = payloadOf(latestObserved);
  const flaggedPayload = payloadOf(latestFlagged);
  const newTokenPayload = payloadOf(latestNewToken);
  const bondingPayload = payloadOf(latestBondingUpdate);

  const score = finite(observedPayload.score) ? Number(observedPayload.score)
    : finite(flaggedPayload.score) ? Number(flaggedPayload.score)
      : null;
  const recentVolumeSol = finite(observedPayload.recentVolumeSol) ? Number(observedPayload.recentVolumeSol)
    : finite(flaggedPayload.recentVolumeSol) ? Number(flaggedPayload.recentVolumeSol)
      : null;
  const tradeVelocityPerMin = finite(observedPayload.tradeVelocityPerMin) ? Number(observedPayload.tradeVelocityPerMin)
    : finite(flaggedPayload.tradeVelocityPerMin) ? Number(flaggedPayload.tradeVelocityPerMin)
      : null;

  return {
    mint: row.mint,
    symbol: row.symbol,
    diagnosis: row.diagnosis,
    firstObservedCurveBucket: row.firstObservedCurveBucket,
    fullyBondedAtFirstObservedCurve: row.fullyBondedAtFirstObservedCurve,
    firstPaperDecisionAt: decisionAt,
    firstPaperDecisionReason: row.firstPaperDecisionReason,
    latestObservedAt: latestObserved?.timestamp || null,
    latestFlaggedAt: latestFlagged?.timestamp || null,
    latestNewTokenAt: latestNewToken?.timestamp || null,
    latestBondingUpdateAt: latestBondingUpdate?.timestamp || null,
    score: round(score, 2),
    recentVolumeSol: round(recentVolumeSol, 4),
    tradeVelocityPerMin: round(tradeVelocityPerMin, 2),
    observedHasScore: finite(observedPayload.score),
    observedHasRecentVolumeSol: finite(observedPayload.recentVolumeSol),
    observedHasTradeVelocityPerMin: finite(observedPayload.tradeVelocityPerMin),
    flaggedBeforeDecision: Boolean(latestFlagged),
    newTokenBeforeDecision: Boolean(latestNewToken),
    bondingUpdateBeforeDecision: Boolean(latestBondingUpdate),
    bondingAccountFoundBeforeDecision: latestBondingUpdate ? bondingPayload.accountFound ?? null : null,
    bondingCurveProgressBeforeDecision: finite(bondingPayload.curveProgress)
      ? round(bondingPayload.curveProgress)
      : null,
    hasAlternativeMarketState: [score, recentVolumeSol, tradeVelocityPerMin].some(finite),
    alternativeStateShape: [
      finite(score) ? 'score' : null,
      finite(recentVolumeSol) ? 'volume' : null,
      finite(tradeVelocityPerMin) ? 'velocity' : null
    ].filter(Boolean).join('+') || 'none'
  };
}

function summarize(rows) {
  return {
    rows: rows.length,
    diagnosisCounts: countBy(rows, (row) => row.diagnosis),
    curveBucketCounts: countBy(rows, (row) => row.firstObservedCurveBucket),
    alternativeStateShapeCounts: countBy(rows, (row) => row.alternativeStateShape),
    rowsWithAlternativeMarketState: rows.filter((row) => row.hasAlternativeMarketState).length,
    rowsWithFlaggedBeforeDecision: rows.filter((row) => row.flaggedBeforeDecision).length,
    rowsWithNewTokenBeforeDecision: rows.filter((row) => row.newTokenBeforeDecision).length,
    rowsWithBondingUpdateBeforeDecision: rows.filter((row) => row.bondingUpdateBeforeDecision).length,
    rowsWithBondingAccountFoundFalseBeforeDecision: rows.filter((row) => row.bondingAccountFoundBeforeDecision === false).length
  };
}

function buildReport() {
  const sourceReport = readJson(DECISION_SOURCE_PATH, {});
  const missingRows = (sourceReport.rows || []).filter((row) => row.firstPaperDecisionCurveState === 'MISSING');
  const eventsByPath = new Map();
  const firstObservedRowsByMint = new Map((readJson(
    path.join(ROOT, 'data', 'reports', 'no-prior-first-observed-curve-latest.json'),
    {}
  ).rows || []).map((row) => [row.mint, row]));

  const rows = missingRows.map((row) => {
    const firstObserved = firstObservedRowsByMint.get(row.mint);
    const telemetryPath = repoPath(firstObserved?.telemetryPath);
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
      paperDecisionCurveSourcePath: path.relative(ROOT, DECISION_SOURCE_PATH).replace(/\\/g, '/'),
      telemetryFilesRead: eventsByPath.size
    },
    summary: {
      rows: rows.length,
      overall: summarize(rows),
      fullyBondedAtFirstObservedCurve: summarize(fullyBondedRows),
      midCurveAtFirstObservedCurve: summarize(midCurveRows)
    },
    rows,
    note: 'Report-only decision-time alternative-state audit for false-negative mints whose first paper decision lacked finite curveProgress. Shows what score, volume, velocity, flag, new-token, and bonding-update state existed immediately before the decision. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
