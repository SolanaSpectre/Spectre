#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-candidate-supply-funnel-latest.json');
const SLICE_SHADOW_ENTER = 'pre_migration_flagged_follow_through_slice_shadow.would_enter';
const SLICE_SHADOW_SKIP = 'pre_migration_flagged_follow_through_slice_shadow.would_skip';

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

function stageRow(name, mintSet, previousSet, hours) {
  const count = mintSet.size;
  const previous = previousSet ? previousSet.size : null;
  return {
    stage: name,
    uniqueMints: count,
    perHour: hours > 0 ? compact(count / hours, 2) : null,
    retentionFromPrevious: previous && previous > 0 ? compact(count / previous, 4) : null
  };
}

function setIntersection(a, b) {
  return new Set(Array.from(a).filter((item) => b.has(item)));
}

function getMint(rowsByMint, mint, payload = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: payload.symbol || null,
      firstSeenMs: null,
      lastSeenMs: null,
      events: {},
      maxScore: null,
      maxCurveProgress: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxUniqueBuyerCount: null,
      maxSniperWalletCount: null,
      hasPrice: false,
      hasWalletContext: false,
      hasTrustedWallet: false,
      hasPositiveWallet: false,
      hasRawUntrustedWallet: false,
      flagged: false,
      evaluated: false,
      guardRows: 0,
      decisionRows: 0,
      sliceShadowRows: 0,
      sliceShadowWouldEnter: false,
      sliceShadowProfiles: {},
      paperEntered: false,
      topReasons: {},
      failedChecks: {}
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  return row;
}

function updateMax(row, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  row[key] = row[key] === null ? number : Math.max(row[key], number);
}

function updateTimes(row, atMs) {
  if (!Number.isFinite(atMs)) return;
  row.firstSeenMs = row.firstSeenMs === null ? atMs : Math.min(row.firstSeenMs, atMs);
  row.lastSeenMs = row.lastSeenMs === null ? atMs : Math.max(row.lastSeenMs, atMs);
}

function updateWallet(row, payload = {}) {
  const proof = payload.walletBridgeProof || {};
  const context = payload.walletClassificationContext || {};
  const signals = payload.walletSignals || {};
  const trusted = signals.anyTrustedTouch === true
    || Number(proof.walletTouchCount || 0) > 0
    || context.touched === true
    || context.shadowTouched === true;
  const positive = signals.positiveOrProvenTouch === true
    || Number(proof.positiveOrProvenTouchCount || 0) > 0
    || Number(context.positiveTouchCount || context.provenTouchCount || context.provenBuyCount || 0) > 0;
  const rawUntrusted = signals.rawUntrustedTouch === true
    || signals.rawUntrustedPre85Buy === true
    || Number(proof.untrustedWalletTouchCount || 0) > 0
    || Number(proof.untrustedPre85BuyTouchCount || 0) > 0
    || context.untrustedTouched === true;
  row.hasWalletContext = row.hasWalletContext || trusted || positive || rawUntrusted || context.touched === true || context.shadowTouched === true || context.untrustedTouched === true;
  row.hasTrustedWallet = row.hasTrustedWallet || trusted;
  row.hasPositiveWallet = row.hasPositiveWallet || positive;
  row.hasRawUntrustedWallet = row.hasRawUntrustedWallet || rawUntrusted;
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
    updateTimes(row, atMs);
    bump(row.events, type);
    updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
    updateMax(row, 'maxCurveProgress', curveOf(payload));
    updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
    updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
    updateMax(row, 'maxUniqueBuyerCount', payload.uniqueBuyerCount);
    updateMax(row, 'maxSniperWalletCount', payload.sniperWalletCount);
    if (Number.isFinite(priceOf(payload))) row.hasPrice = true;
    updateWallet(row, payload);

    if (type === 'pre_migration.flagged') {
      row.flagged = true;
      for (const reason of payload.reasons || []) bump(row.topReasons, reason);
    }
    if (type === 'pre_migration_paper.guard_attribution') {
      row.evaluated = true;
      row.guardRows += 1;
      bump(row.topReasons, payload.guardReason || payload.reason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }
    if (type === 'pre_migration_paper.decision') {
      row.evaluated = true;
      row.decisionRows += 1;
      bump(row.topReasons, payload.reason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }
    if (type === SLICE_SHADOW_ENTER || type === SLICE_SHADOW_SKIP) {
      row.sliceShadowRows += 1;
      row.evaluated = true;
      row.sliceShadowWouldEnter = row.sliceShadowWouldEnter || type === SLICE_SHADOW_ENTER;
      for (const profile of payload.wouldEnterProfiles || []) bump(row.sliceShadowProfiles, profile);
      bump(row.topReasons, payload.sourceReason || payload.reason || payload.sourceGuardReason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }
    if (type === 'pre_migration_paper.entry') {
      row.paperEntered = true;
    }
    if (type === 'wallet.trade_observed') {
      row.hasWalletContext = true;
      row.hasTrustedWallet = true;
    }
  }, { bufferSize: 1024 * 1024 });

  return { rows: Array.from(rowsByMint.values()), eventCounts, firstMs, lastMs, stats };
}

function buildReport(filePath) {
  const scanned = scan(filePath);
  const rows = scanned.rows;
  const hours = scanned.firstMs !== null && scanned.lastMs !== null && scanned.lastMs >= scanned.firstMs
    ? (scanned.lastMs - scanned.firstMs) / 3_600_000
    : null;

  const sets = {
    observed: new Set(rows.filter((row) => row.events['pre_migration.observed'] > 0).map((row) => row.mint)),
    priceBearing: new Set(rows.filter((row) => row.hasPrice).map((row) => row.mint)),
    curve60Plus: new Set(rows.filter((row) => Number(row.maxCurveProgress) >= 0.6).map((row) => row.mint)),
    anyWalletContext: new Set(rows.filter((row) => row.hasWalletContext).map((row) => row.mint)),
    trustedWalletContext: new Set(rows.filter((row) => row.hasTrustedWallet).map((row) => row.mint)),
    positiveWalletContext: new Set(rows.filter((row) => row.hasPositiveWallet).map((row) => row.mint)),
    rawUntrustedWalletContext: new Set(rows.filter((row) => row.hasRawUntrustedWallet).map((row) => row.mint)),
    flagged: new Set(rows.filter((row) => row.flagged).map((row) => row.mint)),
    evaluated: new Set(rows.filter((row) => row.evaluated).map((row) => row.mint)),
    sliceShadowAny: new Set(rows.filter((row) => row.sliceShadowRows > 0).map((row) => row.mint)),
    sliceShadowWouldEnter: new Set(rows.filter((row) => row.sliceShadowWouldEnter).map((row) => row.mint)),
    paperEntered: new Set(rows.filter((row) => row.paperEntered).map((row) => row.mint))
  };

  const orderedStages = [
    ['observed', sets.observed],
    ['price_bearing', sets.priceBearing],
    ['curve60_plus', sets.curve60Plus],
    ['curve60_plus_with_any_wallet', setIntersection(sets.curve60Plus, sets.anyWalletContext)],
    ['curve60_plus_with_trusted_wallet', setIntersection(sets.curve60Plus, sets.trustedWalletContext)],
    ['curve60_plus_with_positive_wallet', setIntersection(sets.curve60Plus, sets.positiveWalletContext)],
    ['flagged', sets.flagged],
    ['evaluated', sets.evaluated],
    ['flagged_and_evaluated', setIntersection(sets.flagged, sets.evaluated)],
    ['slice_shadow_would_enter', sets.sliceShadowWouldEnter],
    ['paper_entered', sets.paperEntered]
  ];

  const funnel = [];
  for (let index = 0; index < orderedStages.length; index += 1) {
    const [name, set] = orderedStages[index];
    const previous = index > 0 ? orderedStages[index - 1][1] : null;
    funnel.push(stageRow(name, set, previous, hours || 0));
  }

  const rowsByInteresting = rows
    .filter((row) => row.flagged || row.evaluated || row.sliceShadowRows > 0 || row.paperEntered)
    .sort((a, b) => (b.sliceShadowRows - a.sliceShadowRows) || Number(b.maxScore || 0) - Number(a.maxScore || 0))
    .slice(0, 50)
    .map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      maxScore: compact(row.maxScore, 2),
      maxCurveProgress: compact(row.maxCurveProgress, 6),
      maxRecentVolumeSol: compact(row.maxRecentVolumeSol, 4),
      maxTradeVelocityPerMin: compact(row.maxTradeVelocityPerMin, 2),
      hasPrice: row.hasPrice,
      hasWalletContext: row.hasWalletContext,
      hasTrustedWallet: row.hasTrustedWallet,
      hasPositiveWallet: row.hasPositiveWallet,
      hasRawUntrustedWallet: row.hasRawUntrustedWallet,
      flagged: row.flagged,
      evaluated: row.evaluated,
      sliceShadowRows: row.sliceShadowRows,
      sliceShadowWouldEnter: row.sliceShadowWouldEnter,
      sliceShadowProfiles: topCounts(row.sliceShadowProfiles, 5),
      paperEntered: row.paperEntered,
      topReasons: topCounts(row.topReasons, 5),
      failedChecks: topCounts(row.failedChecks, 5)
    }));

  const reasonCounts = rows.reduce((counts, row) => {
    for (const [reason, count] of Object.entries(row.topReasons)) bump(counts, reason, count);
    return counts;
  }, {});
  const failedCheckCounts = rows.reduce((counts, row) => {
    for (const [reason, count] of Object.entries(row.failedChecks)) bump(counts, reason, count);
    return counts;
  }, {});

  const supplyDiagnosis = (() => {
    if (sets.observed.size === 0) return 'NO_PRE_MIGRATION_OBSERVED_SUPPLY';
    if (sets.curve60Plus.size / Math.max(1, sets.observed.size) < 0.05) return 'CURVE60_SUPPLY_STARVED';
    if (setIntersection(sets.curve60Plus, sets.trustedWalletContext).size / Math.max(1, sets.curve60Plus.size) < 0.1) return 'TRUSTED_WALLET_COVERAGE_STARVED';
    if (sets.flagged.size / Math.max(1, sets.curve60Plus.size) < 0.1) return 'WATCH_FLAGGING_SELECTIVE';
    if (sets.sliceShadowWouldEnter.size / Math.max(1, sets.flagged.size) < 0.1) return 'SHADOW_PROFILE_SELECTIVE';
    if (sets.paperEntered.size < 20) return 'PAPER_ENTRY_THROUGHPUT_LOW';
    return 'SUPPLY_HEALTHY_ENOUGH_FOR_STRATEGY_REVIEW';
  })();

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
      verdict: supplyDiagnosis,
      totalTrackedMints: rows.length,
      observedMints: sets.observed.size,
      priceBearingMints: sets.priceBearing.size,
      curve60PlusMints: sets.curve60Plus.size,
      curve60PlusWithAnyWalletMints: setIntersection(sets.curve60Plus, sets.anyWalletContext).size,
      curve60PlusWithTrustedWalletMints: setIntersection(sets.curve60Plus, sets.trustedWalletContext).size,
      curve60PlusWithPositiveWalletMints: setIntersection(sets.curve60Plus, sets.positiveWalletContext).size,
      flaggedMints: sets.flagged.size,
      evaluatedMints: sets.evaluated.size,
      sliceShadowWouldEnterMints: sets.sliceShadowWouldEnter.size,
      paperEnteredMints: sets.paperEntered.size,
      observedPerHour: hours > 0 ? compact(sets.observed.size / hours, 2) : null,
      curve60PlusPerHour: hours > 0 ? compact(sets.curve60Plus.size / hours, 2) : null,
      sliceShadowWouldEnterPerHour: hours > 0 ? compact(sets.sliceShadowWouldEnter.size / hours, 2) : null,
      paperEnteredPerHour: hours > 0 ? compact(sets.paperEntered.size / hours, 2) : null,
      topReasons: topCounts(reasonCounts, 12),
      topFailedChecks: topCounts(failedCheckCounts, 12),
      score: numericStats(rows.map((row) => row.maxScore), 2),
      curveProgress: numericStats(rows.map((row) => row.maxCurveProgress), 6),
      eventCounts: topCounts(scanned.eventCounts, 20)
    },
    funnel,
    rows: rowsByInteresting
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
  scan
};
