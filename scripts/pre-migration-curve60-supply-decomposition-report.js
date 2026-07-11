#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve60-supply-decomposition-latest.json');
const SLICE_SHADOW_ENTER = 'pre_migration_flagged_follow_through_slice_shadow.would_enter';
const SLICE_SHADOW_SKIP = 'pre_migration_flagged_follow_through_slice_shadow.would_skip';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const inlineValueAt = arg.indexOf('=');
    if (inlineValueAt > 2) {
      args[arg.slice(2, inlineValueAt)] = arg.slice(inlineValueAt + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
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

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function eventType(event = {}) {
  return event.telemetryType || event.type || event.event || event.name || 'unknown';
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.tokenMint || payload.mintAddress || payload.address || null;
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.curveProgress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload = {}) {
  const direct = Number(payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = Number(payload.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
}

function bump(counts, key, amount = 1) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + amount;
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

function secondsBetween(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return compact((endMs - startMs) / 1000, 3);
}

function getMint(rowsByMint, mint, payload = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: payload.symbol || null,
      firstSeenMs: null,
      lastSeenMs: null,
      firstObservedMs: null,
      firstObservedCurve: null,
      firstObservedPre60Ms: null,
      firstPriceMs: null,
      firstCurve60Ms: null,
      firstCurve85Ms: null,
      firstCurve90Ms: null,
      firstFlaggedMs: null,
      firstEvaluatedMs: null,
      firstSliceShadowMs: null,
      firstSliceShadowWouldEnterMs: null,
      firstPaperEntryMs: null,
      firstVelocity25Ms: null,
      maxScore: null,
      maxCurveProgress: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      observedRows: 0,
      flaggedRows: 0,
      evaluatedRows: 0,
      sliceShadowRows: 0,
      paperEntryRows: 0,
      topReasons: {},
      failedChecks: {},
      events: {}
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  return row;
}

function updateMinTime(row, key, atMs) {
  if (!Number.isFinite(atMs)) return;
  row[key] = row[key] === null ? atMs : Math.min(row[key], atMs);
}

function updateTimes(row, atMs) {
  if (!Number.isFinite(atMs)) return;
  updateMinTime(row, 'firstSeenMs', atMs);
  row.lastSeenMs = row.lastSeenMs === null ? atMs : Math.max(row.lastSeenMs, atMs);
}

function updateMax(row, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  row[key] = row[key] === null ? number : Math.max(row[key], number);
}

function updateCurveCrossings(row, atMs, curve) {
  if (!Number.isFinite(atMs) || !Number.isFinite(curve)) return;
  if (curve >= 0.6) updateMinTime(row, 'firstCurve60Ms', atMs);
  if (curve >= 0.85) updateMinTime(row, 'firstCurve85Ms', atMs);
  if (curve >= 0.9) updateMinTime(row, 'firstCurve90Ms', atMs);
}

function scan(filePath) {
  const rowsByMint = new Map();
  const eventCounts = {};
  let firstMs = null;
  let lastMs = null;
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    const atMs = timestampMs(payload.timestamp || payload.receivedAt || event.timestamp);
    bump(eventCounts, type);
    if (Number.isFinite(atMs)) {
      firstMs = firstMs === null ? atMs : Math.min(firstMs, atMs);
      lastMs = lastMs === null ? atMs : Math.max(lastMs, atMs);
    }
    if (!mint) return;

    const row = getMint(rowsByMint, mint, payload);
    const curve = curveOf(payload);
    const price = priceOf(payload);
    updateTimes(row, atMs);
    bump(row.events, type);
    updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
    updateMax(row, 'maxCurveProgress', curve);
    updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
    updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
    updateCurveCrossings(row, atMs, curve);
    if (Number.isFinite(price)) updateMinTime(row, 'firstPriceMs', atMs);
    if (Number(payload.tradeVelocityPerMin) >= 25) updateMinTime(row, 'firstVelocity25Ms', atMs);

    if (type === 'pre_migration.observed') {
      row.observedRows += 1;
      updateMinTime(row, 'firstObservedMs', atMs);
      if (row.firstObservedCurve === null && Number.isFinite(curve)) row.firstObservedCurve = curve;
      if (Number.isFinite(curve) && curve < 0.6) updateMinTime(row, 'firstObservedPre60Ms', atMs);
    }
    if (type === 'pre_migration.flagged') {
      row.flaggedRows += 1;
      updateMinTime(row, 'firstFlaggedMs', atMs);
      for (const reason of payload.reasons || []) bump(row.topReasons, reason);
    }
    if (type === 'pre_migration_paper.guard_attribution' || type === 'pre_migration_paper.decision') {
      row.evaluatedRows += 1;
      updateMinTime(row, 'firstEvaluatedMs', atMs);
      bump(row.topReasons, payload.guardReason || payload.reason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }
    if (type === SLICE_SHADOW_ENTER || type === SLICE_SHADOW_SKIP) {
      row.sliceShadowRows += 1;
      updateMinTime(row, 'firstSliceShadowMs', atMs);
      if (type === SLICE_SHADOW_ENTER) updateMinTime(row, 'firstSliceShadowWouldEnterMs', atMs);
      bump(row.topReasons, payload.sourceReason || payload.reason || payload.sourceGuardReason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }
    if (type === 'pre_migration_paper.entry') {
      row.paperEntryRows += 1;
      updateMinTime(row, 'firstPaperEntryMs', atMs);
    }
  }, { bufferSize: 1024 * 1024 });

  return { rows: Array.from(rowsByMint.values()), eventCounts, firstMs, lastMs, stats };
}

function classify(row) {
  if (Number(row.maxCurveProgress) < 0.6 || !Number.isFinite(Number(row.maxCurveProgress))) {
    return 'market_scarcity_never_curve60';
  }
  if (row.firstPaperEntryMs !== null) return 'paper_entered';

  const observedPre60 = row.firstObservedPre60Ms !== null
    && (row.firstCurve60Ms === null || row.firstObservedPre60Ms <= row.firstCurve60Ms);
  const firstObservedLate = row.firstObservedMs === null
    || !observedPre60
    || Number(row.firstObservedCurve) >= 0.6;
  if (firstObservedLate) return 'observation_latency_or_late_first_observed';

  const flaggedBefore60 = row.firstFlaggedMs !== null
    && row.firstCurve60Ms !== null
    && row.firstFlaggedMs <= row.firstCurve60Ms;
  if (!flaggedBefore60) return 'flagging_miss_observed_pre60';
  if (row.firstSliceShadowWouldEnterMs !== null) return 'shadow_would_enter_not_paper';
  return 'flagged_but_gated';
}

function rowSummary(row) {
  return {
    mint: row.mint,
    symbol: row.symbol,
    classification: row.classification,
    firstObservedAt: row.firstObservedMs === null ? null : new Date(row.firstObservedMs).toISOString(),
    firstObservedCurve: compact(row.firstObservedCurve, 6),
    firstObservedPre60At: row.firstObservedPre60Ms === null ? null : new Date(row.firstObservedPre60Ms).toISOString(),
    firstCurve60At: row.firstCurve60Ms === null ? null : new Date(row.firstCurve60Ms).toISOString(),
    firstCurve85At: row.firstCurve85Ms === null ? null : new Date(row.firstCurve85Ms).toISOString(),
    firstCurve90At: row.firstCurve90Ms === null ? null : new Date(row.firstCurve90Ms).toISOString(),
    firstFlaggedAt: row.firstFlaggedMs === null ? null : new Date(row.firstFlaggedMs).toISOString(),
    firstPaperEntryAt: row.firstPaperEntryMs === null ? null : new Date(row.firstPaperEntryMs).toISOString(),
    secondsFirstSeenToCurve60: secondsBetween(row.firstSeenMs, row.firstCurve60Ms),
    secondsFirstObservedToCurve60: secondsBetween(row.firstObservedMs, row.firstCurve60Ms),
    secondsObservedPre60ToCurve60: secondsBetween(row.firstObservedPre60Ms, row.firstCurve60Ms),
    secondsFlaggedToCurve60: secondsBetween(row.firstFlaggedMs, row.firstCurve60Ms),
    maxScore: compact(row.maxScore, 2),
    maxCurveProgress: compact(row.maxCurveProgress, 6),
    maxRecentVolumeSol: compact(row.maxRecentVolumeSol, 4),
    maxTradeVelocityPerMin: compact(row.maxTradeVelocityPerMin, 2),
    observedRows: row.observedRows,
    flaggedRows: row.flaggedRows,
    evaluatedRows: row.evaluatedRows,
    sliceShadowRows: row.sliceShadowRows,
    paperEntryRows: row.paperEntryRows,
    topReasons: topCounts(row.topReasons, 5),
    failedChecks: topCounts(row.failedChecks, 5)
  };
}

function buildReport(filePath) {
  const scanned = scan(filePath);
  const rows = scanned.rows.map((row) => ({ ...row, classification: classify(row) }));
  const observedRows = rows.filter((row) => row.observedRows > 0);
  const curve60Rows = rows.filter((row) => Number(row.maxCurveProgress) >= 0.6);
  const hours = scanned.firstMs !== null && scanned.lastMs !== null && scanned.lastMs >= scanned.firstMs
    ? (scanned.lastMs - scanned.firstMs) / 3_600_000
    : null;
  const classificationCounts = {};
  for (const row of rows) bump(classificationCounts, row.classification);
  const curve60ClassificationCounts = {};
  for (const row of curve60Rows) bump(curve60ClassificationCounts, row.classification);

  const observedPre60Crossers = curve60Rows.filter((row) => row.firstObservedPre60Ms !== null);
  const lateObservedCrossers = curve60Rows.filter((row) => row.classification === 'observation_latency_or_late_first_observed');
  const flaggingMissRows = curve60Rows.filter((row) => row.classification === 'flagging_miss_observed_pre60');
  const gatedRows = curve60Rows.filter((row) => row.classification === 'flagged_but_gated');
  const shadowRows = curve60Rows.filter((row) => row.classification === 'shadow_would_enter_not_paper');
  const paperRows = curve60Rows.filter((row) => row.classification === 'paper_entered');

  let verdict = 'MIXED_SUPPLY_CONSTRAINT';
  if (!observedRows.length) verdict = 'NO_PRE_MIGRATION_OBSERVED_SUPPLY';
  else if (curve60Rows.length / Math.max(1, observedRows.length) < 0.02 && lateObservedCrossers.length <= flaggingMissRows.length) verdict = 'MARKET_WIDE_CURVE60_SCARCITY';
  else if (curve60Rows.length && lateObservedCrossers.length / curve60Rows.length >= 0.35) verdict = 'OBSERVATION_LATENCY_DOMINANT';
  else if (curve60Rows.length && flaggingMissRows.length / curve60Rows.length >= 0.35) verdict = 'FLAGGING_MISS_DOMINANT';
  else if (curve60Rows.length && (gatedRows.length + shadowRows.length) / curve60Rows.length >= 0.35) verdict = 'GATING_AFTER_FLAG_DOMINANT';

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_curve60_supply_decomposition',
    note: 'Classifies curve60+ pre-migration supply loss as market scarcity, observation latency, flagging miss, or post-flag gating. Does not alter gates, paper entries, live entries, quotes, or exits.',
    telemetryPath: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    run: {
      firstEventAt: scanned.firstMs === null ? null : new Date(scanned.firstMs).toISOString(),
      lastEventAt: scanned.lastMs === null ? null : new Date(scanned.lastMs).toISOString(),
      durationHours: hours === null ? null : compact(hours, 4),
      jsonlRowsScanned: scanned.stats.rows,
      malformedLines: scanned.stats.malformedLines
    },
    summary: {
      verdict,
      totalTrackedMints: rows.length,
      observedMints: observedRows.length,
      curve60PlusMints: curve60Rows.length,
      observedPre60ThenCurve60Mints: observedPre60Crossers.length,
      lateObservedCurve60Mints: lateObservedCrossers.length,
      flaggingMissObservedPre60Mints: flaggingMissRows.length,
      flaggedButGatedMints: gatedRows.length,
      shadowWouldEnterNotPaperMints: shadowRows.length,
      paperEnteredCurve60Mints: paperRows.length,
      curve60PlusPerHour: hours > 0 ? compact(curve60Rows.length / hours, 2) : null,
      observedPerHour: hours > 0 ? compact(observedRows.length / hours, 2) : null,
      curve60ObservedRate: observedRows.length ? compact(curve60Rows.length / observedRows.length, 4) : null,
      curve60LateObservedRate: curve60Rows.length ? compact(lateObservedCrossers.length / curve60Rows.length, 4) : null,
      curve60FlaggingMissRate: curve60Rows.length ? compact(flaggingMissRows.length / curve60Rows.length, 4) : null,
      curve60GatedAfterFlagRate: curve60Rows.length ? compact((gatedRows.length + shadowRows.length) / curve60Rows.length, 4) : null,
      classificationCounts: topCounts(classificationCounts, 12),
      curve60ClassificationCounts: topCounts(curve60ClassificationCounts, 12),
      topReasons: topCounts(rows.reduce((counts, row) => {
        for (const [reason, count] of Object.entries(row.topReasons)) bump(counts, reason, count);
        return counts;
      }, {}), 12),
      topFailedChecks: topCounts(rows.reduce((counts, row) => {
        for (const [reason, count] of Object.entries(row.failedChecks)) bump(counts, reason, count);
        return counts;
      }, {}), 12),
      secondsFirstObservedToCurve60: numericStats(curve60Rows.map((row) => secondsBetween(row.firstObservedMs, row.firstCurve60Ms)), 3),
      secondsObservedPre60ToCurve60: numericStats(curve60Rows.map((row) => secondsBetween(row.firstObservedPre60Ms, row.firstCurve60Ms)), 3),
      secondsFlaggedToCurve60: numericStats(curve60Rows.map((row) => secondsBetween(row.firstFlaggedMs, row.firstCurve60Ms)), 3),
      score: numericStats(rows.map((row) => row.maxScore), 2),
      curveProgress: numericStats(rows.map((row) => row.maxCurveProgress), 6),
      eventCounts: topCounts(scanned.eventCounts, 20)
    },
    cohorts: [
      { cohort: 'curve60_plus', mints: curve60Rows.length, rows: curve60Rows.slice(0, 50).map(rowSummary) },
      { cohort: 'late_observed_curve60', mints: lateObservedCrossers.length, rows: lateObservedCrossers.slice(0, 50).map(rowSummary) },
      { cohort: 'flagging_miss_observed_pre60', mints: flaggingMissRows.length, rows: flaggingMissRows.slice(0, 50).map(rowSummary) },
      { cohort: 'flagged_but_gated', mints: gatedRows.length, rows: gatedRows.slice(0, 50).map(rowSummary) },
      { cohort: 'shadow_would_enter_not_paper', mints: shadowRows.length, rows: shadowRows.slice(0, 50).map(rowSummary) },
      { cohort: 'paper_entered_curve60', mints: paperRows.length, rows: paperRows.slice(0, 50).map(rowSummary) }
    ],
    rows: curve60Rows
      .slice()
      .sort((a, b) => Number(b.maxCurveProgress || 0) - Number(a.maxCurveProgress || 0))
      .slice(0, 100)
      .map(rowSummary)
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
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = {
  buildReport,
  scan
};
