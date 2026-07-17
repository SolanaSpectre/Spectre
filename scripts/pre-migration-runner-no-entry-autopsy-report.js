#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-runner-no-entry-autopsy-latest.json');

const DECISION_TYPES = new Set([
  'pre_migration_paper.guard_attribution',
  'pre_migration_paper.decision'
]);

const CURVE_TRUTH_TYPES = new Set([
  'finalist_account_verifier.update',
  'finalist_account_verifier.shadow_live_gate',
  'pump_bonding_curve.provider_snapshot',
  'pumpdev.targeted_curve_parity_sample'
]);

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
  const raw = payload.accountCurveProgress
    ?? payload.onchainCurveProgress
    ?? payload.providerCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.curveProgress
    ?? payload.market?.maxCurveProgress
    ?? payload.curveParity?.onchainCurveProgress
    ?? payload.curveParity?.providerCurveProgress;
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

function boolOrNull(value) {
  return value === true ? true : value === false ? false : null;
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

function hasAny(values, needles) {
  return values.some((value) => needles.includes(value));
}

function getRow(rowsByMint, mint, payload = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: payload.symbol || null,
      firstSeenMs: null,
      lastSeenMs: null,
      firstObservedMs: null,
      firstFlaggedMs: null,
      firstCross60Ms: null,
      firstCross60Source: null,
      firstCross85Ms: null,
      firstCross85Source: null,
      firstCross90Ms: null,
      firstCross90Source: null,
      paperEntered: false,
      maxCurveProgress: null,
      maxCurveProgressSource: null,
      curveSourceCounts: {},
      maxScore: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxUniqueBuyerCount: null,
      maxSniperWalletCount: null,
      maxBuyerSniperRatio: null,
      decisions: [],
      truth: [],
      parity: [],
      reasons: {},
      failedChecks: {}
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  return row;
}

function updateMin(row, key, atMs) {
  if (!Number.isFinite(atMs)) return;
  row[key] = row[key] === null ? atMs : Math.min(row[key], atMs);
}

function updateTimes(row, atMs) {
  if (!Number.isFinite(atMs)) return;
  row.firstSeenMs = row.firstSeenMs === null ? atMs : Math.min(row.firstSeenMs, atMs);
  row.lastSeenMs = row.lastSeenMs === null ? atMs : Math.max(row.lastSeenMs, atMs);
}

function updateMax(row, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  row[key] = row[key] === null ? number : Math.max(row[key], number);
}

function updateCurveMax(row, curve, source) {
  if (!Number.isFinite(curve)) return;
  bump(row.curveSourceCounts, source);
  if (row.maxCurveProgress === null || curve > row.maxCurveProgress) {
    row.maxCurveProgress = curve;
    row.maxCurveProgressSource = source;
  }
}

function updateFirstCross(row, timeKey, sourceKey, atMs, source) {
  if (!Number.isFinite(atMs)) return;
  if (row[timeKey] === null || atMs < row[timeKey]) {
    row[timeKey] = atMs;
    row[sourceKey] = source;
  }
}

function gateInputs(payload = {}, curve = null, price = null) {
  const uniqueBuyerCount = numberOrNull(payload.uniqueBuyerCount);
  const sniperWalletCount = numberOrNull(payload.sniperWalletCount);
  const buyerSniperRatio = Number.isFinite(uniqueBuyerCount) && Number.isFinite(sniperWalletCount)
    ? uniqueBuyerCount / Math.max(1, sniperWalletCount)
    : null;

  return {
    score: compact(payload.score ?? payload.entryScore, 2),
    curveProgress: compact(curve, 6),
    priceSol: compact(price, 12),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    buyRatio: compact(payload.buyRatio, 4),
    uniqueBuyerCount,
    sniperWalletCount,
    buyerSniperRatio: compact(buyerSniperRatio, 4),
    curveProgressDelta: compact(payload.curveProgressDelta, 6),
    curveProgressDelta60s: compact(payload.curveProgressDelta60s, 6),
    baselineCurveProgress: compact(payload.baselineCurveProgress, 6),
    baselineCurveProgress60s: compact(payload.baselineCurveProgress60s, 6),
    firstCurveSnapshotScalpCurveSnapshotAgeSeconds: compact(payload.firstCurveSnapshotScalpCurveSnapshotAgeSeconds, 3),
    firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds: compact(payload.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds, 3),
    firstCurveSnapshotScalpStaleCurveBlocked: boolOrNull(payload.firstCurveSnapshotScalpStaleCurveBlocked),
    firstCurveSnapshotScalpSniperCrowdingBlocked: boolOrNull(payload.firstCurveSnapshotScalpSniperCrowdingBlocked),
    highCurveStaleSnapshotCurveSnapshotAgeSeconds: compact(payload.highCurveStaleSnapshotCurveSnapshotAgeSeconds, 3),
    highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds: compact(payload.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds, 3),
    highCurveStaleSnapshotBlocked: boolOrNull(payload.highCurveStaleSnapshotBlocked),
    highCurveWalletContextBlocked: boolOrNull(payload.highCurveWalletContextBlocked),
    highCurveWalletQualityBlocked: boolOrNull(payload.highCurveWalletQualityBlocked),
    requiredWalletContextBlocked: boolOrNull(payload.requiredWalletContextBlocked),
    value: compact(payload.value, 6),
    threshold: compact(payload.threshold, 6)
  };
}

function decisionRow(type, payload, atMs, curve, price) {
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks.slice() : [];
  const reasons = Array.isArray(payload.reasons) ? payload.reasons.slice() : [];
  const reason = payload.guardReason || payload.reason || payload.sourceReason || null;
  const allChecks = [...failedChecks, reason].filter(Boolean);
  return {
    type,
    atMs,
    at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
    preset: payload.preset || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    decision: payload.decision || payload.outcome || null,
    reason,
    failedChecks,
    reasons,
    guardOverride: payload.guardOverride || null,
    shadowPresetWouldEnter: boolOrNull(payload.shadowPresetWouldEnter),
    sourceReason: payload.sourceReason || null,
    blocks: {
      staleCurve: hasAny(allChecks, ['FIRST_CURVE_SNAPSHOT_SCALP_STALE_CURVE_UPDATE', 'HIGH_CURVE_STALE_CURVE_UPDATE', 'STALE_CURVE_UPDATE']),
      sniperCrowding: hasAny(allChecks, ['FIRST_CURVE_SNAPSHOT_SCALP_SNIPER_CROWDING', 'SNIPER_CROWDING_8_PLUS']),
      curveNotAdvancing: hasAny(allChecks, ['CURVE_NOT_ADVANCING']),
      lowScore: hasAny(allChecks, ['LOW_SCORE']),
      walletContext: hasAny(allChecks, ['HIGH_CURVE_REQUIRES_WALLET_CONTEXT', 'REQUIRED_WALLET_CONTEXT', 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY']),
      buyRatio: hasAny(allChecks, ['LOW_BUY_RATIO'])
    },
    inputs: gateInputs(payload, curve, price)
  };
}

function truthRow(type, payload, atMs, curve, price) {
  const parity = payload.curveParity || {};
  return {
    type,
    atMs,
    at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
    status: payload.status || payload.blockedReason || parity.status || null,
    decision: payload.decision || null,
    reason: payload.reason || payload.blockedReason || parity.reason || null,
    curveProgress: compact(curve, 6),
    priceSol: compact(price, 12),
    paperCurveProgress: compact(payload.paperCurveProgress, 6),
    accountCurveProgress: compact(payload.accountCurveProgress ?? parity.onchainCurveProgress, 6),
    providerCurveProgress: compact(payload.providerCurveProgress ?? parity.providerCurveProgress, 6),
    curveDelta: compact(payload.curveDelta, 6),
    absCurveDelta: compact(payload.absCurveDelta, 6),
    maxCurveDelta: compact(payload.maxCurveDelta, 6),
    accountAgeMs: compact(payload.accountAgeMs, 0),
    fresh: boolOrNull(payload.fresh)
  };
}

function nearestTruth(row, atMs, maxWindowMs = 5000) {
  if (!Number.isFinite(atMs) || !row.truth.length) return null;
  let best = null;
  for (const truth of row.truth) {
    if (!Number.isFinite(truth.atMs)) continue;
    const distanceMs = Math.abs(truth.atMs - atMs);
    if (distanceMs > maxWindowMs) continue;
    if (!best || distanceMs < best.distanceMs) best = { ...truth, distanceMs };
  }
  if (!best) return null;
  return {
    ...best,
    distanceMs: compact(best.distanceMs, 0)
  };
}

function beforeOrEqual(rows, atMs) {
  if (!Number.isFinite(atMs)) return rows;
  return rows.filter((row) => Number.isFinite(row.atMs) && row.atMs <= atMs);
}

function lastOf(rows) {
  return rows.length ? rows[rows.length - 1] : null;
}

function minimalGateHint(decision) {
  if (!decision) return 'NO_DECISION';
  const checks = new Set([...(decision.failedChecks || []), decision.reason].filter(Boolean));
  if (checks.has('FIRST_CURVE_SNAPSHOT_SCALP_STALE_CURVE_UPDATE') || checks.has('STALE_CURVE_UPDATE')) return 'STALE_CURVE_UPDATE';
  if (checks.has('FIRST_CURVE_SNAPSHOT_SCALP_SNIPER_CROWDING') || checks.has('SNIPER_CROWDING_8_PLUS')) return 'SNIPER_CROWDING';
  if (checks.has('CURVE_NOT_ADVANCING')) return 'CURVE_NOT_ADVANCING';
  if (checks.has('HIGH_CURVE_REQUIRES_WALLET_CONTEXT') || checks.has('CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY')) return 'WALLET_CONTEXT';
  if (checks.has('LOW_SCORE')) return 'LOW_SCORE';
  return decision.reason || decision.failedChecks?.[0] || 'UNKNOWN';
}

function staleVerdict(decision, truth) {
  if (!decision?.blocks?.staleCurve) return 'NOT_STALE_BLOCKED';
  const age = decision.inputs.firstCurveSnapshotScalpCurveSnapshotAgeSeconds
    ?? decision.inputs.highCurveStaleSnapshotCurveSnapshotAgeSeconds;
  const threshold = decision.inputs.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds
    ?? decision.inputs.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds;
  const accountCurve = truth?.accountCurveProgress ?? truth?.curveProgress;
  const decisionCurve = decision.inputs.curveProgress;
  const curveGap = Number.isFinite(Number(accountCurve)) && Number.isFinite(Number(decisionCurve))
    ? Number(accountCurve) - Number(decisionCurve)
    : null;
  if (Number.isFinite(Number(age)) && Number.isFinite(Number(threshold)) && Number(age) > Number(threshold)) {
    return 'STALE_BY_AGE_FIELD';
  }
  if (Number.isFinite(Number(curveGap)) && Math.abs(Number(curveGap)) >= 0.05) {
    return Number(curveGap) > 0 ? 'STALE_ACCOUNT_AHEAD' : 'STALE_ACCOUNT_BEHIND';
  }
  if (truth) return 'STALE_BLOCK_WITH_NEARBY_TRUTH_ALIGNED_OR_UNKNOWN_AGE';
  return 'STALE_BLOCK_NO_NEARBY_TRUTH';
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
    const curve = curveOf(payload);
    const price = priceOf(payload);
    updateCurveMax(row, curve, type);
    updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
    updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
    updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
    updateMax(row, 'maxUniqueBuyerCount', payload.uniqueBuyerCount);
    updateMax(row, 'maxSniperWalletCount', payload.sniperWalletCount);
    const uniqueBuyerCount = numberOrNull(payload.uniqueBuyerCount);
    const sniperWalletCount = numberOrNull(payload.sniperWalletCount);
    if (Number.isFinite(uniqueBuyerCount) && Number.isFinite(sniperWalletCount)) {
      updateMax(row, 'maxBuyerSniperRatio', uniqueBuyerCount / Math.max(1, sniperWalletCount));
    }

    if (Number.isFinite(curve)) {
      if (curve >= 0.6) updateFirstCross(row, 'firstCross60Ms', 'firstCross60Source', atMs, type);
      if (curve >= 0.85) updateFirstCross(row, 'firstCross85Ms', 'firstCross85Source', atMs, type);
      if (curve >= 0.9) updateFirstCross(row, 'firstCross90Ms', 'firstCross90Source', atMs, type);
    }
    if (type === 'pre_migration.observed') updateMin(row, 'firstObservedMs', atMs);
    if (type === 'pre_migration.flagged') {
      updateMin(row, 'firstFlaggedMs', atMs);
      for (const reason of payload.reasons || []) bump(row.reasons, reason);
    }
    if (type === 'pre_migration_paper.entry') row.paperEntered = true;

    if (DECISION_TYPES.has(type)) {
      const decision = decisionRow(type, payload, atMs, curve, price);
      row.decisions.push(decision);
      bump(row.reasons, decision.reason);
      for (const check of decision.failedChecks || []) bump(row.failedChecks, check);
    }

    if (CURVE_TRUTH_TYPES.has(type)) {
      const truth = truthRow(type, payload, atMs, curve, price);
      row.truth.push(truth);
      if (type === 'pumpdev.targeted_curve_parity_sample') row.parity.push(truth);
    }
  }, { bufferSize: 1024 * 1024 });

  for (const row of rowsByMint.values()) {
    row.decisions.sort((a, b) => a.atMs - b.atMs);
    row.truth.sort((a, b) => a.atMs - b.atMs);
    row.parity.sort((a, b) => a.atMs - b.atMs);
  }

  return { rows: Array.from(rowsByMint.values()), eventCounts, firstMs, lastMs, stats };
}

function summarizeRunner(row) {
  const runner = Number(row.maxCurveProgress) >= 0.9;
  const crosser = Number(row.maxCurveProgress) >= 0.6;
  const cutoffMs = row.firstCross90Ms ?? row.firstCross85Ms ?? row.firstCross60Ms ?? row.lastSeenMs;
  const preRunnerDecisions = beforeOrEqual(row.decisions, cutoffMs);
  const lastPreRunnerDecision = lastOf(preRunnerDecisions);
  const lastDecision = lastOf(row.decisions);
  const bindingDecision = lastPreRunnerDecision || lastDecision;
  const truth = bindingDecision ? nearestTruth(row, bindingDecision.atMs) : null;
  const stale = staleVerdict(bindingDecision, truth);
  const bindingGate = minimalGateHint(bindingDecision);
  const decisionInputs = bindingDecision?.inputs || {};
  const allChecks = {};
  for (const decision of row.decisions) {
    for (const check of decision.failedChecks || []) bump(allChecks, check);
    bump(allChecks, decision.reason);
  }
  const staleRows = row.decisions.filter((decision) => decision.blocks.staleCurve).length;
  const crowdRows = row.decisions.filter((decision) => decision.blocks.sniperCrowding).length;
  const bothRows = row.decisions.filter((decision) => decision.blocks.staleCurve && decision.blocks.sniperCrowding).length;
  const curveRows = row.decisions.filter((decision) => decision.blocks.curveNotAdvancing).length;
  const walletRows = row.decisions.filter((decision) => decision.blocks.walletContext).length;

  return {
    mint: row.mint,
    symbol: row.symbol,
    runner,
    crosser,
    paperEntered: row.paperEntered,
    firstObservedAt: row.firstObservedMs === null ? null : new Date(row.firstObservedMs).toISOString(),
    firstFlaggedAt: row.firstFlaggedMs === null ? null : new Date(row.firstFlaggedMs).toISOString(),
    firstCross60At: row.firstCross60Ms === null ? null : new Date(row.firstCross60Ms).toISOString(),
    firstCross85At: row.firstCross85Ms === null ? null : new Date(row.firstCross85Ms).toISOString(),
    firstCross90At: row.firstCross90Ms === null ? null : new Date(row.firstCross90Ms).toISOString(),
    secondsObservedToCross60: row.firstObservedMs !== null && row.firstCross60Ms !== null ? compact((row.firstCross60Ms - row.firstObservedMs) / 1000, 3) : null,
    secondsObservedToCross90: row.firstObservedMs !== null && row.firstCross90Ms !== null ? compact((row.firstCross90Ms - row.firstObservedMs) / 1000, 3) : null,
    maxCurveProgress: compact(row.maxCurveProgress, 6),
    maxCurveProgressSource: row.maxCurveProgressSource,
    firstCross60Source: row.firstCross60Source,
    firstCross85Source: row.firstCross85Source,
    firstCross90Source: row.firstCross90Source,
    curveSourceCounts: topCounts(row.curveSourceCounts, 8),
    maxScore: compact(row.maxScore, 2),
    maxRecentVolumeSol: compact(row.maxRecentVolumeSol, 4),
    maxTradeVelocityPerMin: compact(row.maxTradeVelocityPerMin, 2),
    maxUniqueBuyerCount: compact(row.maxUniqueBuyerCount, 2),
    maxSniperWalletCount: compact(row.maxSniperWalletCount, 2),
    maxBuyerSniperRatio: compact(row.maxBuyerSniperRatio, 4),
    decisionScore: compact(decisionInputs.score, 2),
    decisionCurveProgress: compact(decisionInputs.curveProgress, 6),
    decisionCurveProgressDelta60s: compact(decisionInputs.curveProgressDelta60s, 6),
    decisionRecentVolumeSol: compact(decisionInputs.recentVolumeSol, 4),
    decisionTradeVelocityPerMin: compact(decisionInputs.tradeVelocityPerMin, 2),
    decisionBuyRatio: compact(decisionInputs.buyRatio, 4),
    decisionUniqueBuyerCount: compact(decisionInputs.uniqueBuyerCount, 2),
    decisionSniperWalletCount: compact(decisionInputs.sniperWalletCount, 2),
    decisionBuyerSniperRatio: compact(decisionInputs.buyerSniperRatio, 4),
    decisions: row.decisions.length,
    preRunnerDecisions: preRunnerDecisions.length,
    bindingGate,
    staleGateVerdict: stale,
    blockerRows: {
      staleCurve: staleRows,
      sniperCrowding: crowdRows,
      staleAndSniperCrowding: bothRows,
      curveNotAdvancing: curveRows,
      walletContext: walletRows
    },
    topFailedChecks: topCounts(allChecks, 10),
    bindingDecision: bindingDecision ? {
      at: bindingDecision.at,
      type: bindingDecision.type,
      preset: bindingDecision.preset,
      lane: bindingDecision.lane,
      decision: bindingDecision.decision,
      reason: bindingDecision.reason,
      failedChecks: bindingDecision.failedChecks,
      guardOverride: bindingDecision.guardOverride,
      blocks: bindingDecision.blocks,
      inputs: bindingDecision.inputs
    } : null,
    nearestTruth: truth,
    recentDecisionTimeline: row.decisions.slice(-12).map((decision) => ({
      at: decision.at,
      preset: decision.preset,
      reason: decision.reason,
      failedChecks: decision.failedChecks,
      curveProgress: decision.inputs.curveProgress,
      score: decision.inputs.score,
      uniqueBuyerCount: decision.inputs.uniqueBuyerCount,
      sniperWalletCount: decision.inputs.sniperWalletCount,
      buyerSniperRatio: decision.inputs.buyerSniperRatio,
      curveProgressDelta: decision.inputs.curveProgressDelta,
      snapshotAgeSeconds: decision.inputs.firstCurveSnapshotScalpCurveSnapshotAgeSeconds
    }))
  };
}

function buildReport(filePath) {
  const scanned = scan(filePath);
  const rows = scanned.rows;
  const hours = scanned.firstMs !== null && scanned.lastMs !== null && scanned.lastMs >= scanned.firstMs
    ? (scanned.lastMs - scanned.firstMs) / 3_600_000
    : null;
  const crossers = rows.filter((row) => Number(row.maxCurveProgress) >= 0.6);
  const runners = rows.filter((row) => Number(row.maxCurveProgress) >= 0.9);
  const noEntryRunners = runners.filter((row) => !row.paperEntered);
  const runnerAutopsies = noEntryRunners
    .map(summarizeRunner)
    .sort((a, b) => Number(b.maxCurveProgress || 0) - Number(a.maxCurveProgress || 0)
      || Number(b.maxScore || 0) - Number(a.maxScore || 0));

  const gateCounts = {};
  const staleVerdicts = {};
  const blockerCoFire = {
    staleAndSniperCrowdingRows: 0,
    staleRows: 0,
    sniperCrowdingRows: 0
  };
  for (const autopsy of runnerAutopsies) {
    bump(gateCounts, autopsy.bindingGate);
    bump(staleVerdicts, autopsy.staleGateVerdict);
    blockerCoFire.staleAndSniperCrowdingRows += autopsy.blockerRows.staleAndSniperCrowding;
    blockerCoFire.staleRows += autopsy.blockerRows.staleCurve;
    blockerCoFire.sniperCrowdingRows += autopsy.blockerRows.sniperCrowding;
  }

  const breadthRows = runnerAutopsies.map((row) => row.decisionBuyerSniperRatio);
  const curve60FirstSourceCounts = {};
  const curve60MaxSourceCounts = {};
  for (const row of crossers) {
    bump(curve60FirstSourceCounts, row.firstCross60Source);
    bump(curve60MaxSourceCounts, row.maxCurveProgressSource);
  }
  const verdict = (() => {
    if (!runners.length) return 'NO_CURVE90_RUNNERS';
    if (!noEntryRunners.length) return 'RUNNERS_ENTERED';
    if ((gateCounts.STALE_CURVE_UPDATE || 0) >= Math.max(1, noEntryRunners.length / 2)) return 'RUNNER_NO_ENTRY_STALE_CURVE_DOMINANT';
    if ((gateCounts.SNIPER_CROWDING || 0) >= Math.max(1, noEntryRunners.length / 2)) return 'RUNNER_NO_ENTRY_SNIPER_CROWDING_DOMINANT';
    if ((gateCounts.CURVE_NOT_ADVANCING || 0) >= Math.max(1, noEntryRunners.length / 2)) return 'RUNNER_NO_ENTRY_CURVE_DELTA_DOMINANT';
    return 'RUNNER_NO_ENTRY_MIXED_GATES';
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
      verdict,
      totalMints: rows.length,
      curve60PlusMints: crossers.length,
      curve90PlusMints: runners.length,
      noEntryRunnerMints: noEntryRunners.length,
      paperEnteredRunnerMints: runners.length - noEntryRunners.length,
      curve60FirstSourceCounts: topCounts(curve60FirstSourceCounts, 12),
      curve60MaxSourceCounts: topCounts(curve60MaxSourceCounts, 12),
      bindingGates: topCounts(gateCounts, 12),
      staleGateVerdicts: topCounts(staleVerdicts, 12),
      blockerCoFire,
      runnerBuyerSniperRatio: numericStats(breadthRows, 4),
      runnerScore: numericStats(runnerAutopsies.map((row) => row.decisionScore), 2),
      runnerVelocity: numericStats(runnerAutopsies.map((row) => row.decisionTradeVelocityPerMin), 2),
      eventCounts: topCounts(scanned.eventCounts, 20)
    },
    runners: runnerAutopsies,
    crossers: crossers
      .filter((row) => Number(row.maxCurveProgress) < 0.9 && !row.paperEntered)
      .map(summarizeRunner)
      .sort((a, b) => Number(b.maxCurveProgress || 0) - Number(a.maxCurveProgress || 0))
      .slice(0, 50)
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
  summarizeRunner
};
