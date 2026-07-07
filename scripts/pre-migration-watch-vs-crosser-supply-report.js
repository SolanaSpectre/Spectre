#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-watch-vs-crosser-supply-latest.json');

const SLICE_SHADOW_ENTER = 'pre_migration_flagged_follow_through_slice_shadow.would_enter';
const SEPARATOR_SHADOW_ENTER = 'pre_migration_curve_not_advancing_separator_shadow.would_enter';

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

function timestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = new Date(value).getTime();
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
    ?? payload.accountCurveProgress
    ?? payload.paperCurveProgress
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function updateMinTime(row, key, atMs) {
  if (!Number.isFinite(atMs)) return;
  row[key] = row[key] === null ? atMs : Math.min(row[key], atMs);
}

function updateMax(row, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  row[key] = row[key] === null ? number : Math.max(row[key], number);
}

function updateFeatures(row, payload = {}) {
  updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
  updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
  updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
  updateMax(row, 'maxUniqueBuyerCount', payload.uniqueBuyerCount);
  updateMax(row, 'maxSniperWalletCount', payload.sniperWalletCount);
  updateMax(row, 'maxBuyRatio', payload.buyRatio);
}

function newRow(mint, payload = {}) {
  return {
    mint,
    symbol: payload.symbol || null,
    firstSeenMs: null,
    lastSeenMs: null,
    firstObservedMs: null,
    firstFlaggedMs: null,
    firstEvaluatedMs: null,
    firstSliceShadowWouldEnterMs: null,
    firstSeparatorShadowWouldEnterMs: null,
    firstPaperEntryMs: null,
    firstCross60Ms: null,
    firstCross85Ms: null,
    firstCross90Ms: null,
    observedRows: 0,
    flaggedRows: 0,
    evaluatedRows: 0,
    decisionRows: 0,
    guardRows: 0,
    paperEntryRows: 0,
    providerRows: 0,
    maxCurveProgress: null,
    maxPriceSol: null,
    baselinePriceSol: null,
    baselineCurveProgress: null,
    maxPriceDeltaPct120s: null,
    maxPriceDeltaPct300s: null,
    maxCurveDelta120s: null,
    maxCurveDelta300s: null,
    maxScore: null,
    maxRecentVolumeSol: null,
    maxTradeVelocityPerMin: null,
    maxUniqueBuyerCount: null,
    maxSniperWalletCount: null,
    maxBuyRatio: null,
    uniqueBuyerCountCapturedRows: 0,
    sniperWalletCountCapturedRows: 0,
    flagged: false,
    evaluated: false,
    sliceShadowWouldEnter: false,
    separatorShadowWouldEnter: false,
    paperEntered: false,
    topReasons: {},
    failedChecks: {},
    pre60Snapshots: []
  };
}

function getRow(rowsByMint, mint, payload = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = newRow(mint, payload);
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  return row;
}

function updateTimes(row, atMs) {
  if (!Number.isFinite(atMs)) return;
  row.firstSeenMs = row.firstSeenMs === null ? atMs : Math.min(row.firstSeenMs, atMs);
  row.lastSeenMs = row.lastSeenMs === null ? atMs : Math.max(row.lastSeenMs, atMs);
}

function updateOutcomeWindows(row, atMs, curve, price) {
  if (!Number.isFinite(atMs) || row.firstObservedMs === null) return;
  const elapsedSeconds = (atMs - row.firstObservedMs) / 1000;
  if (elapsedSeconds < 0) return;
  const baselineCurve = row.baselineCurveProgress;
  const baselinePrice = row.baselinePriceSol;
  if (elapsedSeconds <= 120) {
    if (Number.isFinite(curve) && Number.isFinite(baselineCurve)) {
      updateMax(row, 'maxCurveDelta120s', curve - baselineCurve);
    }
    if (Number.isFinite(price) && Number.isFinite(baselinePrice) && baselinePrice > 0) {
      updateMax(row, 'maxPriceDeltaPct120s', (price / baselinePrice) - 1);
    }
  }
  if (elapsedSeconds <= 300) {
    if (Number.isFinite(curve) && Number.isFinite(baselineCurve)) {
      updateMax(row, 'maxCurveDelta300s', curve - baselineCurve);
    }
    if (Number.isFinite(price) && Number.isFinite(baselinePrice) && baselinePrice > 0) {
      updateMax(row, 'maxPriceDeltaPct300s', (price / baselinePrice) - 1);
    }
  }
}

function snapshotOf(type, payload, atMs, curve, price) {
  return {
    type,
    at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
    curveProgress: compact(curve, 6),
    priceSol: compact(price, 12),
    score: compact(payload.score ?? payload.entryScore, 2),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    buyRatio: compact(payload.buyRatio, 4),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount),
    uniqueBuyerCountCaptured: payload.uniqueBuyerCountCaptured === true,
    sniperWalletCount: numberOrNull(payload.sniperWalletCount),
    sniperWalletCountCaptured: payload.sniperWalletCountCaptured === true,
    reasons: Array.isArray(payload.reasons) ? payload.reasons.slice(0, 8) : []
  };
}

function classify(row) {
  const crossed60 = Number(row.maxCurveProgress) >= 0.6;
  const crossed85 = Number(row.maxCurveProgress) >= 0.85;
  const crossed90 = Number(row.maxCurveProgress) >= 0.9;
  const observedPre60 = row.firstObservedMs !== null
    && (row.firstCross60Ms === null || row.firstObservedMs <= row.firstCross60Ms);
  const flaggedPre60 = row.firstFlaggedMs !== null
    && (row.firstCross60Ms === null || row.firstFlaggedMs <= row.firstCross60Ms);
  const wouldEnter = row.sliceShadowWouldEnter || row.separatorShadowWouldEnter;

  let provenance = 'non_crosser';
  if (crossed90) {
    if (!observedPre60) provenance = 'runner_missed_entirely';
    else if (!flaggedPre60) provenance = 'runner_observed_pre60_not_flagged';
    else if (row.paperEntered) provenance = 'runner_entered';
    else if (wouldEnter) provenance = 'runner_would_enter';
    else provenance = 'runner_flagged_but_gated';
  } else if (crossed60) {
    if (!observedPre60) provenance = 'crosser_missed_entirely';
    else if (!flaggedPre60) provenance = 'crosser_observed_pre60_not_flagged';
    else if (row.paperEntered) provenance = 'crosser_entered';
    else if (wouldEnter) provenance = 'crosser_would_enter';
    else provenance = 'crosser_flagged_but_gated';
  } else if (row.flagged || row.evaluated) {
    provenance = 'flagged_never_curve60';
  } else {
    provenance = 'unflagged_never_curve60';
  }

  const nearMiss = !row.flagged && !row.evaluated && !crossed60 && (
    Number(row.maxCurveProgress) >= 0.45
    || Number(row.maxCurveDelta300s) >= 0.1
    || Number(row.maxPriceDeltaPct300s) >= 0.25
    || Number(row.maxScore) >= 25
    || Number(row.maxTradeVelocityPerMin) >= 10
  );

  return {
    crossed60,
    crossed85,
    crossed90,
    observedPre60,
    flaggedPre60,
    wouldEnter,
    nearMiss,
    provenance
  };
}

function projectRow(row, includeSnapshots = false) {
  const classification = classify(row);
  const base = {
    mint: row.mint,
    symbol: row.symbol,
    provenance: classification.provenance,
    crossed60: classification.crossed60,
    crossed85: classification.crossed85,
    crossed90: classification.crossed90,
    observedPre60: classification.observedPre60,
    flaggedPre60: classification.flaggedPre60,
    flagged: row.flagged,
    evaluated: row.evaluated,
    wouldEnter: classification.wouldEnter,
    paperEntered: row.paperEntered,
    firstObservedAt: row.firstObservedMs === null ? null : new Date(row.firstObservedMs).toISOString(),
    firstFlaggedAt: row.firstFlaggedMs === null ? null : new Date(row.firstFlaggedMs).toISOString(),
    firstCross60At: row.firstCross60Ms === null ? null : new Date(row.firstCross60Ms).toISOString(),
    firstCross85At: row.firstCross85Ms === null ? null : new Date(row.firstCross85Ms).toISOString(),
    firstCross90At: row.firstCross90Ms === null ? null : new Date(row.firstCross90Ms).toISOString(),
    maxCurveProgress: compact(row.maxCurveProgress, 6),
    maxCurveDelta120s: compact(row.maxCurveDelta120s, 6),
    maxCurveDelta300s: compact(row.maxCurveDelta300s, 6),
    maxPriceDeltaPct120s: compact(row.maxPriceDeltaPct120s, 6),
    maxPriceDeltaPct300s: compact(row.maxPriceDeltaPct300s, 6),
    maxScore: compact(row.maxScore, 2),
    maxRecentVolumeSol: compact(row.maxRecentVolumeSol, 4),
    maxTradeVelocityPerMin: compact(row.maxTradeVelocityPerMin, 2),
    maxUniqueBuyerCount: compact(row.maxUniqueBuyerCount, 2),
    maxSniperWalletCount: compact(row.maxSniperWalletCount, 2),
    buyerCapturedRows: row.uniqueBuyerCountCapturedRows,
    sniperCapturedRows: row.sniperWalletCountCapturedRows,
    observedRows: row.observedRows,
    flaggedRows: row.flaggedRows,
    evaluatedRows: row.evaluatedRows,
    providerRows: row.providerRows,
    topReasons: topCounts(row.topReasons, 6),
    failedChecks: topCounts(row.failedChecks, 6)
  };
  if (includeSnapshots) base.pre60Snapshots = row.pre60Snapshots.slice(-8);
  return base;
}

function cohortSummary(name, rows) {
  const classified = rows.map((row) => ({ row, classification: classify(row) }));
  return {
    cohort: name,
    mints: rows.length,
    crossed60: classified.filter((item) => item.classification.crossed60).length,
    crossed85: classified.filter((item) => item.classification.crossed85).length,
    crossed90: classified.filter((item) => item.classification.crossed90).length,
    flagged: rows.filter((row) => row.flagged).length,
    evaluated: rows.filter((row) => row.evaluated).length,
    wouldEnter: classified.filter((item) => item.classification.wouldEnter).length,
    paperEntered: rows.filter((row) => row.paperEntered).length,
    score: numericStats(rows.map((row) => row.maxScore), 2),
    curveProgress: numericStats(rows.map((row) => row.maxCurveProgress), 6),
    tradeVelocityPerMin: numericStats(rows.map((row) => row.maxTradeVelocityPerMin), 2),
    recentVolumeSol: numericStats(rows.map((row) => row.maxRecentVolumeSol), 4),
    maxPriceDeltaPct300s: numericStats(rows.map((row) => row.maxPriceDeltaPct300s), 6)
  };
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

    const row = getRow(rowsByMint, mint, payload);
    updateTimes(row, atMs);
    updateFeatures(row, payload);
    const curve = curveOf(payload);
    const price = priceOf(payload);
    updateMax(row, 'maxCurveProgress', curve);
    updateMax(row, 'maxPriceSol', price);
    if (payload.uniqueBuyerCountCaptured === true) row.uniqueBuyerCountCapturedRows += 1;
    if (payload.sniperWalletCountCaptured === true) row.sniperWalletCountCapturedRows += 1;

    if (Number.isFinite(curve)) {
      if (curve >= 0.6) updateMinTime(row, 'firstCross60Ms', atMs);
      if (curve >= 0.85) updateMinTime(row, 'firstCross85Ms', atMs);
      if (curve >= 0.9) updateMinTime(row, 'firstCross90Ms', atMs);
    }

    if (/^provider\./.test(type)) row.providerRows += 1;

    if (type === 'pre_migration.observed') {
      row.observedRows += 1;
      updateMinTime(row, 'firstObservedMs', atMs);
      if (row.baselineCurveProgress === null && Number.isFinite(curve)) row.baselineCurveProgress = curve;
      if (row.baselinePriceSol === null && Number.isFinite(price)) row.baselinePriceSol = price;
      if (!Number.isFinite(curve) || curve < 0.6) {
        row.pre60Snapshots.push(snapshotOf(type, payload, atMs, curve, price));
      }
    }

    if (type === 'pre_migration.flagged') {
      row.flagged = true;
      row.flaggedRows += 1;
      updateMinTime(row, 'firstFlaggedMs', atMs);
      if (!Number.isFinite(curve) || curve < 0.6) {
        row.pre60Snapshots.push(snapshotOf(type, payload, atMs, curve, price));
      }
      for (const reason of payload.reasons || []) bump(row.topReasons, reason);
    }

    if (type === 'pre_migration_paper.guard_attribution') {
      row.evaluated = true;
      row.guardRows += 1;
      row.evaluatedRows += 1;
      updateMinTime(row, 'firstEvaluatedMs', atMs);
      bump(row.topReasons, payload.guardReason || payload.reason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }

    if (type === 'pre_migration_paper.decision') {
      row.evaluated = true;
      row.decisionRows += 1;
      row.evaluatedRows += 1;
      updateMinTime(row, 'firstEvaluatedMs', atMs);
      bump(row.topReasons, payload.reason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }

    if (type === SLICE_SHADOW_ENTER) {
      row.sliceShadowWouldEnter = true;
      updateMinTime(row, 'firstSliceShadowWouldEnterMs', atMs);
    }

    if (type === SEPARATOR_SHADOW_ENTER) {
      row.separatorShadowWouldEnter = true;
      updateMinTime(row, 'firstSeparatorShadowWouldEnterMs', atMs);
    }

    if (type === 'pre_migration_paper.entry') {
      row.paperEntered = true;
      row.paperEntryRows += 1;
      updateMinTime(row, 'firstPaperEntryMs', atMs);
    }

    updateOutcomeWindows(row, atMs, curve, price);
  }, { bufferSize: 1024 * 1024 });

  return { rows: Array.from(rowsByMint.values()), eventCounts, firstMs, lastMs, stats };
}

function buildReport(filePath) {
  const scanned = scan(filePath);
  const rows = scanned.rows;
  const classified = rows.map((row) => ({ row, classification: classify(row) }));
  const hours = scanned.firstMs !== null && scanned.lastMs !== null && scanned.lastMs >= scanned.firstMs
    ? (scanned.lastMs - scanned.firstMs) / 3_600_000
    : null;

  const observed = rows.filter((row) => row.firstObservedMs !== null);
  const flagged = rows.filter((row) => row.flagged);
  const evaluated = rows.filter((row) => row.evaluated);
  const cross60 = classified.filter((item) => item.classification.crossed60).map((item) => item.row);
  const cross85 = classified.filter((item) => item.classification.crossed85).map((item) => item.row);
  const cross90 = classified.filter((item) => item.classification.crossed90).map((item) => item.row);
  const flaggedNeverCurve60 = classified
    .filter((item) => (item.row.flagged || item.row.evaluated) && !item.classification.crossed60)
    .map((item) => item.row);
  const unflaggedNearMiss = classified
    .filter((item) => item.classification.nearMiss)
    .map((item) => item.row);

  const provenanceCounts = {};
  const runnerProvenanceCounts = {};
  const cross60ProvenanceCounts = {};
  for (const item of classified) {
    bump(provenanceCounts, item.classification.provenance);
    if (item.classification.crossed90) bump(runnerProvenanceCounts, item.classification.provenance);
    if (item.classification.crossed60) bump(cross60ProvenanceCounts, item.classification.provenance);
  }

  const reasonCounts = rows.reduce((counts, row) => {
    for (const [reason, count] of Object.entries(row.topReasons)) bump(counts, reason, count);
    return counts;
  }, {});
  const failedCheckCounts = rows.reduce((counts, row) => {
    for (const [reason, count] of Object.entries(row.failedChecks)) bump(counts, reason, count);
    return counts;
  }, {});

  const verdict = (() => {
    if (!observed.length) return 'NO_PRE_MIGRATION_OBSERVED_SUPPLY';
    if (!cross60.length) return 'NO_CURVE60_CROSSERS_IN_WINDOW';
    if (!cross90.length) return 'NO_RAW_CROSS90_RUNNERS_IN_WINDOW';
    if (cross90.every((row) => !classify(row).flaggedPre60)) return 'RUNNERS_NOT_FLAGGED_PRE60';
    if (cross90.every((row) => !row.paperEntered)) return 'RUNNERS_FLAGGED_BUT_NOT_ENTERED';
    return 'RUNNER_PATH_HAS_ENTRIES';
  })();

  const sortByOutcome = (a, b) => Number(b.maxCurveProgress || 0) - Number(a.maxCurveProgress || 0)
    || Number(b.maxPriceDeltaPct300s || 0) - Number(a.maxPriceDeltaPct300s || 0)
    || Number(b.maxScore || 0) - Number(a.maxScore || 0);

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath: path.relative(ROOT, filePath),
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
      observedMints: observed.length,
      flaggedMints: flagged.length,
      evaluatedMints: evaluated.length,
      curve60PlusMints: cross60.length,
      curve85PlusMints: cross85.length,
      curve90PlusMints: cross90.length,
      flaggedNeverCurve60Mints: flaggedNeverCurve60.length,
      unflaggedNearMissMints: unflaggedNearMiss.length,
      sliceShadowWouldEnterMints: rows.filter((row) => row.sliceShadowWouldEnter).length,
      separatorShadowWouldEnterMints: rows.filter((row) => row.separatorShadowWouldEnter).length,
      paperEnteredMints: rows.filter((row) => row.paperEntered).length,
      observedPerHour: hours > 0 ? compact(observed.length / hours, 2) : null,
      curve60PlusPerHour: hours > 0 ? compact(cross60.length / hours, 2) : null,
      curve90PlusPerHour: hours > 0 ? compact(cross90.length / hours, 2) : null,
      provenanceCounts: topCounts(provenanceCounts, 20),
      runnerProvenanceCounts: topCounts(runnerProvenanceCounts, 20),
      cross60ProvenanceCounts: topCounts(cross60ProvenanceCounts, 20),
      topReasons: topCounts(reasonCounts, 12),
      topFailedChecks: topCounts(failedCheckCounts, 12),
      eventCounts: topCounts(scanned.eventCounts, 20)
    },
    cohorts: [
      cohortSummary('cross60_plus', cross60),
      cohortSummary('cross90_plus', cross90),
      cohortSummary('flagged_or_evaluated', rows.filter((row) => row.flagged || row.evaluated)),
      cohortSummary('flagged_never_curve60', flaggedNeverCurve60),
      cohortSummary('unflagged_near_miss', unflaggedNearMiss)
    ],
    crossers: cross60.sort(sortByOutcome).slice(0, 50).map((row) => projectRow(row, true)),
    runners: cross90.sort(sortByOutcome).slice(0, 50).map((row) => projectRow(row, true)),
    flaggedNeverCurve60: flaggedNeverCurve60
      .sort((a, b) => Number(b.maxScore || 0) - Number(a.maxScore || 0))
      .slice(0, 50)
      .map((row) => projectRow(row, false)),
    unflaggedNearMiss: unflaggedNearMiss
      .sort(sortByOutcome)
      .slice(0, 50)
      .map((row) => projectRow(row, true))
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

if (require.main === module) main();

module.exports = {
  buildReport,
  scan,
  classify
};
