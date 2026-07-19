#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { NATIVE_SOL_MINT, WRAPPED_SOL_MINT } = require('../src/lib/pump-trade-event-decoder');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-shadow-parity');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-shadow-parity-latest.json');

// Frozen before the first Helius adapter run. This is a report-only evidence gate.
const PREREGISTERED = Object.freeze({
  id: 'helius_pumpfun_shadow_parity_v1_2026-07-19',
  adapterMode: 'logs_only_report_only',
  strategyConsumptionAllowed: false,
  comparator: 'pumpportal_runtime_telemetry_and_rpc_curve_truth',
  comparatorCoverageWindow: 'targeted_subscription_intersect_tradestream_connection_per_mint_hour',
  comparatorCoverageFallback: 'pumpportal_first_to_last_trade_when_lifecycle_is_unavailable',
  comparatorCoverageFallbackEdgeToleranceMs: 2_000,
  preregistrationAmendment: 'pre_first_run_coverage_window_fix_after_independent_review',
  lifecycleAmendment: 'pre_first_valid_comparator_run_require_completed_session_lifecycle',
  duplicatePolicy: 'dedupe_helius_by_signature_mint_log_index_and_amounts_before_parity_aggregation',
  solQuotedMinimumTradesPerMintHour: 20,
  eligibleMintHourMinimum: 10,
  tradeCountRelativeDeltaMaximum: 0.05,
  solVolumeRelativeDeltaMaximum: 0.05,
  mintHourAgreementMinimumRate: 0.95,
  curveRpcMaximumMatchAgeMs: 15_000,
  curveAbsoluteDeltaMaximum: 0.02,
  curveAgreementMinimumRate: 0.95,
  curveComparisonMinimum: 100,
  discoveryMatchMinimum: 20,
  discoveryHeliusLagP90MaximumMs: 2_000,
  decoderTailErrorsMaximum: 0,
  quoteLabelCoverageMinimumRate: 1,
  unsupportedQuoteEventsMaximum: 0,
  processedForkRisk: 'diagnostic_only_signature_overlap',
  diagnosticOnlyMetrics: ['buy_ratio', 'unique_buyers', 'pumpdev_overlap', 'signature_overlap'],
  passVerdict: 'HELIUS_SHADOW_PARITY_PASSED',
  failVerdict: 'HELIUS_SHADOW_PARITY_FAILED',
  insufficientVerdict: 'HELIUS_SHADOW_PARITY_INSUFFICIENT_EVIDENCE',
  invalidVerdict: 'HELIUS_SHADOW_PARITY_INVALID_RUN',
  nextIfPass: 'keep_report_only_until_a_separate_runtime_promotion_review',
  nextIfFail: 'fix_adapter_or_comparator_and_run_a_new_preregistered_parity_session'
});

function payloadOf(event) {
  return event?.payload || event?.data || {};
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function timestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function eventTimeMs(event) {
  const payload = payloadOf(event);
  return timestampMs(payload.eventAt) || timestampMs(payload.receivedAt) || timestampMs(event.timestamp);
}

function receiptTimeMs(event) {
  const payload = payloadOf(event);
  return timestampMs(payload.receivedAt) || timestampMs(event.timestamp);
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function quantile(values, q) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  return finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
}

function stats(values, digits = 6) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, mean: null };
  const sum = finite.reduce((total, value) => total + value, 0);
  const round = (value) => Number(value.toFixed(digits));
  return {
    count: finite.length,
    min: round(finite[0]),
    median: round(finite[Math.floor((finite.length - 1) * 0.5)]),
    p90: round(finite[Math.floor((finite.length - 1) * 0.9)]),
    max: round(finite[finite.length - 1]),
    mean: round(sum / finite.length)
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function relativeDelta(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  const denominator = Math.max(Math.abs(left), Math.abs(right));
  return denominator > 0 ? Math.abs(left - right) / denominator : left === right ? 0 : null;
}

function latestTelemetryPath() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function parseCli(argv = process.argv.slice(2)) {
  const telemetryIndex = argv.indexOf('--telemetry');
  const telemetryPath = telemetryIndex >= 0 ? argv[telemetryIndex + 1] : null;
  return { telemetryPath: telemetryPath ? path.resolve(telemetryPath) : latestTelemetryPath() };
}

function createAggregate() {
  return { trades: 0, solVolume: 0, buys: 0, sells: 0, buyers: new Set(), signatures: new Set() };
}

function isSolQuoted(payload = {}) {
  return payload.curveModel === 'sol_quote'
    || payload.curveModel === 'legacy_sol_quote'
    || payload.quoteMint === NATIVE_SOL_MINT
    || payload.quoteMint === WRAPPED_SOL_MINT;
}

function solAmountOf(payload = {}) {
  const direct = numberOrNull(payload.solAmount);
  if (Number.isFinite(direct)) return direct;
  const raw = numberOrNull(payload.solAmountRaw);
  return isSolQuoted(payload) && Number.isFinite(raw) ? raw / 1e9 : null;
}

function addTrade(aggregate, payload) {
  aggregate.trades += 1;
  const solAmount = solAmountOf(payload);
  if (Number.isFinite(solAmount)) aggregate.solVolume += Math.abs(solAmount);
  const side = String(payload.txType || '').toLowerCase();
  if (side === 'buy') aggregate.buys += 1;
  if (side === 'sell') aggregate.sells += 1;
  const buyer = payload.traderPublicKey || payload.trader || payload.user || null;
  if (side === 'buy' && buyer) aggregate.buyers.add(buyer);
  if (payload.signature) aggregate.signatures.add(payload.signature);
}

function nearestByTime(sortedRows, targetMs, maximumAgeMs) {
  if (!Array.isArray(sortedRows) || !sortedRows.length || !Number.isFinite(targetMs)) return null;
  let low = 0;
  let high = sortedRows.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedRows[middle].atMs < targetMs) low = middle + 1;
    else high = middle - 1;
  }
  const candidates = [sortedRows[low], sortedRows[low - 1]].filter(Boolean);
  let best = null;
  for (const candidate of candidates) {
    const ageMs = Math.abs(candidate.atMs - targetMs);
    if (ageMs > maximumAgeMs) continue;
    if (!best || ageMs < best.ageMs) best = { ...candidate, ageMs };
  }
  return best;
}

function createState() {
  return {
    sessionStartMs: null,
    sessionStarted: null,
    sessionStopping: null,
    malformedLines: 0,
    eventCounts: {},
    lastEventMs: null,
    rawHeliusTradeEvents: 0,
    duplicateHeliusTradeEvents: 0,
    heliusTradeKeys: new Set(),
    heliusTrades: [],
    portalTrades: [],
    portalSubscriptionEvents: new Map(),
    portalConnectionEvents: [],
    heliusCreates: new Map(),
    portalCreates: new Map(),
    rpcCurves: new Map(),
    pumpDevMints: new Set()
  };
}

function ingestEvent(state, event) {
  const type = String(event?.type || '');
  const payload = payloadOf(event);
  const atMs = receiptTimeMs(event);
  if (Number.isFinite(atMs)) state.lastEventMs = Math.max(state.lastEventMs || atMs, atMs);
  state.eventCounts[type] = (state.eventCounts[type] || 0) + 1;
  if (type === 'session.started') {
    state.sessionStarted = payload;
    state.sessionStartMs = timestampMs(event.timestamp);
    return;
  }
  if (type === 'session.stopping' || type === 'session.stopped') {
    state.sessionStopping = payload;
    return;
  }
  if ((type === 'provider.pumpportal.connected' || type === 'provider.pumpportal.closed')
    && (payload.role === 'tradestream' || payload.role === 'combined')
    && Number.isFinite(atMs)) {
    state.portalConnectionEvents.push({
      atMs,
      kind: type.endsWith('.connected') ? 'start' : 'end',
      role: payload.role
    });
  }
  const mint = mintOf(payload);
  if (!mint) return;
  if ((type === 'provider.pumpportal.targeted_subscription'
    || type === 'provider.pumpportal.targeted_unsubscription') && Number.isFinite(atMs)) {
    const events = state.portalSubscriptionEvents.get(mint) || [];
    events.push({
      atMs,
      kind: type.endsWith('.targeted_subscription') ? 'start' : 'end',
      reason: payload.reason || null
    });
    state.portalSubscriptionEvents.set(mint, events);
  }
  if (type === 'provider.helius_pumpfun.shadow_trade') {
    state.rawHeliusTradeEvents += 1;
    const duplicateKey = payload.signature
      ? `${payload.signature}|${mint}|${payload.logIndex ?? 'n/a'}|${payload.solAmountRaw ?? payload.solAmount ?? 'n/a'}|${payload.tokenAmountRaw ?? payload.tokenAmount ?? 'n/a'}`
      : null;
    if (duplicateKey && state.heliusTradeKeys.has(duplicateKey)) {
      state.duplicateHeliusTradeEvents += 1;
      return;
    }
    if (duplicateKey) state.heliusTradeKeys.add(duplicateKey);
    state.heliusTrades.push({ mint, atMs: eventTimeMs(event), receiptMs: receiptTimeMs(event), payload });
  } else if (type === 'provider.pumpportal.trade') {
    state.portalTrades.push({ mint, atMs: eventTimeMs(event), receiptMs: receiptTimeMs(event), payload });
  } else if (type === 'provider.helius_pumpfun.shadow_new_token') {
    const atMs = receiptTimeMs(event);
    const current = state.heliusCreates.get(mint);
    if (Number.isFinite(atMs) && (!current || atMs < current)) state.heliusCreates.set(mint, atMs);
  } else if (type === 'provider.pumpportal.new_token') {
    const atMs = receiptTimeMs(event);
    const current = state.portalCreates.get(mint);
    if (Number.isFinite(atMs) && (!current || atMs < current)) state.portalCreates.set(mint, atMs);
  } else if (type === 'pump_bonding_curve.updated') {
    const atMs = receiptTimeMs(event);
    const curveProgress = numberOrNull(payload.curveProgress);
    if (Number.isFinite(atMs) && Number.isFinite(curveProgress)) {
      const rows = state.rpcCurves.get(mint) || [];
      rows.push({ atMs, curveProgress });
      state.rpcCurves.set(mint, rows);
    }
  }
  if (type === 'provider.pumpdev.shadow_trade' || type === 'provider.pumpdev.runtime_trade') {
    state.pumpDevMints.add(mint);
  }
}

function buildIntervals(events, endMs) {
  const sorted = [...(events || [])].filter((event) => Number.isFinite(event.atMs))
    .sort((left, right) => left.atMs - right.atMs || (left.kind === 'end' ? -1 : 1));
  const intervals = [];
  let openedAt = null;
  for (const event of sorted) {
    if (event.kind === 'start') {
      if (!Number.isFinite(openedAt)) openedAt = event.atMs;
    } else if (Number.isFinite(openedAt)) {
      if (event.atMs >= openedAt) intervals.push({ startMs: openedAt, endMs: event.atMs });
      openedAt = null;
    }
  }
  if (Number.isFinite(openedAt) && Number.isFinite(endMs) && endMs >= openedAt) {
    intervals.push({ startMs: openedAt, endMs });
  }
  return intervals;
}

function intersectIntervals(left, right) {
  const intersections = [];
  for (const a of left || []) {
    for (const b of right || []) {
      const startMs = Math.max(a.startMs, b.startMs);
      const endMs = Math.min(a.endMs, b.endMs);
      if (endMs >= startMs) intersections.push({ startMs, endMs });
    }
  }
  return intersections;
}

function mergeIntervals(intervals) {
  const sorted = [...(intervals || [])].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMs <= previous.endMs) previous.endMs = Math.max(previous.endMs, interval.endMs);
    else merged.push({ ...interval });
  }
  return merged;
}

function splitIntervalsBySessionHour(mint, intervals, sessionStartMs, sessionEndMs, source) {
  const rows = [];
  for (const interval of intervals) {
    let cursor = Math.max(interval.startMs, sessionStartMs);
    const endMs = Math.min(interval.endMs, sessionEndMs);
    while (cursor <= endMs) {
      const hourIndex = Math.max(0, Math.floor((cursor - sessionStartMs) / 3_600_000));
      const hourEndMs = sessionStartMs + ((hourIndex + 1) * 3_600_000);
      const segmentEndMs = Math.min(endMs, hourEndMs);
      rows.push({ mint, hourIndex, source, startMs: cursor, endMs: segmentEndMs });
      if (segmentEndMs >= endMs) break;
      cursor = segmentEndMs + 0.001;
    }
  }
  return rows;
}

function inCoverage(row, segments) {
  return Number.isFinite(row.receiptMs)
    && segments.some((segment) => row.receiptMs >= segment.startMs && row.receiptMs <= segment.endMs);
}

function buildPortalCoverage(state, sessionStartMs, sessionEndMs) {
  const connectionIntervals = buildIntervals(state.portalConnectionEvents, sessionEndMs);
  const portalTradesByMint = new Map();
  for (const row of state.portalTrades) {
    const rows = portalTradesByMint.get(row.mint) || [];
    rows.push(row);
    portalTradesByMint.set(row.mint, rows);
  }
  const coverage = [];
  const sourceCounts = {};
  let lifecycleFallbackMints = 0;
  for (const [mint, portalTrades] of portalTradesByMint.entries()) {
    const subscriptionEvents = state.portalSubscriptionEvents.get(mint) || [];
    const subscriptionIntervals = buildIntervals(subscriptionEvents, sessionEndMs);
    let intervals = [];
    let source = 'pumpportal_first_to_last_trade_fallback';
    if (subscriptionIntervals.length && connectionIntervals.length) {
      intervals = intersectIntervals(subscriptionIntervals, connectionIntervals);
      source = 'targeted_subscription_x_tradestream_connection';
    } else if (subscriptionIntervals.length) {
      intervals = subscriptionIntervals;
      source = 'targeted_subscription_only';
    }
    if (!intervals.length) {
      const tradeTimes = portalTrades.map((row) => row.receiptMs).filter(Number.isFinite).sort((a, b) => a - b);
      if (tradeTimes.length) intervals = [{
        startMs: tradeTimes[0] - PREREGISTERED.comparatorCoverageFallbackEdgeToleranceMs,
        endMs: tradeTimes[tradeTimes.length - 1] + PREREGISTERED.comparatorCoverageFallbackEdgeToleranceMs
      }];
      source = 'pumpportal_first_to_last_trade_fallback';
      lifecycleFallbackMints += 1;
    }
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    coverage.push(...splitIntervalsBySessionHour(
      mint,
      mergeIntervals(intervals),
      sessionStartMs,
      sessionEndMs,
      source
    ));
  }
  return { coverage, sourceCounts, lifecycleFallbackMints, connectionIntervals };
}

function collectEvents(events) {
  const state = createState();
  for (const event of events) ingestEvent(state, event);
  return state;
}

function buildReport(state, sourceTelemetry = null) {
  const firstTradeMs = state.heliusTrades.map((row) => row.receiptMs).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const sessionStartMs = state.sessionStartMs || firstTradeMs || null;
  const sessionEndMs = state.lastEventMs || sessionStartMs;
  const portalCoverage = buildPortalCoverage(state, sessionStartMs, sessionEndMs);
  const heliusTradesByMint = new Map();
  const portalTradesByMint = new Map();
  for (const row of state.heliusTrades) {
    const rows = heliusTradesByMint.get(row.mint) || [];
    rows.push(row);
    heliusTradesByMint.set(row.mint, rows);
  }
  for (const row of state.portalTrades) {
    const rows = portalTradesByMint.get(row.mint) || [];
    rows.push(row);
    portalTradesByMint.set(row.mint, rows);
  }
  const coverageByBucket = new Map();
  for (const segment of portalCoverage.coverage) {
    const key = `${segment.mint}|${segment.hourIndex}`;
    const row = coverageByBucket.get(key) || { mint: segment.mint, hourIndex: segment.hourIndex, sources: new Set(), segments: [] };
    row.sources.add(segment.source);
    row.segments.push(segment);
    coverageByBucket.set(key, row);
  }

  const mintHours = [];
  for (const [key, coverage] of coverageByBucket.entries()) {
    const segments = mergeIntervals(coverage.segments);
    const heliusRows = (heliusTradesByMint.get(coverage.mint) || []).filter((row) => (
      isSolQuoted(row.payload)
      && inCoverage(row, segments)
    ));
    const portalRows = (portalTradesByMint.get(coverage.mint) || []).filter((row) => (
      String(row.payload.pairBase || 'SOL').toUpperCase() === 'SOL'
      && inCoverage(row, segments)
    ));
    if (heliusRows.length < PREREGISTERED.solQuotedMinimumTradesPerMintHour || !portalRows.length) continue;
    const helius = createAggregate();
    const portal = createAggregate();
    heliusRows.forEach((row) => addTrade(helius, row.payload));
    portalRows.forEach((row) => addTrade(portal, row.payload));
    const tradeCountRelativeDelta = relativeDelta(helius.trades, portal.trades);
    const solVolumeRelativeDelta = relativeDelta(helius.solVolume, portal.solVolume);
    mintHours.push({
      key,
      mint: coverage.mint,
      hourIndex: coverage.hourIndex,
      coverageSources: [...coverage.sources],
      coverageWindowCount: segments.length,
      coverageDurationMs: segments.reduce((total, segment) => total + Math.max(0, segment.endMs - segment.startMs), 0),
      heliusTrades: helius.trades,
      pumpPortalTrades: portal.trades,
      tradeCountRelativeDelta,
      heliusSolVolume: Number(helius.solVolume.toFixed(9)),
      pumpPortalSolVolume: Number(portal.solVolume.toFixed(9)),
      solVolumeRelativeDelta,
      heliusBuyRatio: ratio(helius.buys, helius.buys + helius.sells),
      pumpPortalBuyRatio: ratio(portal.buys, portal.buys + portal.sells),
      heliusUniqueBuyers: helius.buyers.size,
      pumpPortalUniqueBuyers: portal.buyers.size,
      countPass: tradeCountRelativeDelta <= PREREGISTERED.tradeCountRelativeDeltaMaximum,
      volumePass: solVolumeRelativeDelta <= PREREGISTERED.solVolumeRelativeDeltaMaximum
    });
  }

  for (const rows of state.rpcCurves.values()) rows.sort((a, b) => a.atMs - b.atMs);
  const curveComparisons = [];
  let solQuotedTradeEvents = 0;
  let quoteLabeledTradeEvents = 0;
  let unsupportedQuoteEvents = 0;
  let decoderTailErrors = 0;
  for (const row of state.heliusTrades) {
    const model = row.payload.curveModel;
    if (model) quoteLabeledTradeEvents += 1;
    if (model === 'quote_mint_unsupported') unsupportedQuoteEvents += 1;
    if (row.payload.tailDecodeError) decoderTailErrors += 1;
    if (!isSolQuoted(row.payload)) continue;
    solQuotedTradeEvents += 1;
    const heliusCurve = numberOrNull(row.payload.curveProgress);
    if (!Number.isFinite(heliusCurve)) continue;
    const nearest = nearestByTime(
      state.rpcCurves.get(row.mint),
      row.receiptMs,
      PREREGISTERED.curveRpcMaximumMatchAgeMs
    );
    if (!nearest) continue;
    const signedDelta = heliusCurve - nearest.curveProgress;
    const absoluteDelta = Math.abs(signedDelta);
    curveComparisons.push({
      mint: row.mint,
      ageMs: nearest.ageMs,
      heliusCurveProgress: heliusCurve,
      rpcCurveProgress: nearest.curveProgress,
      signedDelta,
      absoluteDelta,
      pass: absoluteDelta <= PREREGISTERED.curveAbsoluteDeltaMaximum
    });
  }

  const discoveryLags = [];
  for (const [mint, heliusAt] of state.heliusCreates.entries()) {
    const portalAt = state.portalCreates.get(mint);
    if (Number.isFinite(portalAt)) discoveryLags.push(heliusAt - portalAt);
  }
  const discoveryStats = stats(discoveryLags, 0);
  const countPassRate = ratio(mintHours.filter((row) => row.countPass).length, mintHours.length);
  const volumePassRate = ratio(mintHours.filter((row) => row.volumePass).length, mintHours.length);
  const curvePassRate = ratio(curveComparisons.filter((row) => row.pass).length, curveComparisons.length);
  const quoteCoverage = ratio(quoteLabeledTradeEvents, state.heliusTrades.length);
  const heliusSignatures = new Set(state.heliusTrades.map((row) => row.payload.signature).filter(Boolean));
  const portalSignatures = new Set(state.portalTrades.map((row) => row.payload.signature).filter(Boolean));
  const signatureOverlap = [...heliusSignatures].filter((signature) => portalSignatures.has(signature)).length;
  const heliusMints = new Set(state.heliusTrades.map((row) => row.mint));
  const pumpDevOverlapMints = [...state.pumpDevMints].filter((mint) => heliusMints.has(mint)).length;
  const enabled = state.sessionStarted?.heliusPumpfunShadowPlan?.enabled === true;
  const strategyConsumptionDisabled = state.sessionStarted?.heliusPumpfunShadowPlan?.strategyConsumptionEnabled === false;
  const completedLifecycle = Boolean(state.sessionStopping);
  const enoughEvidence = mintHours.length >= PREREGISTERED.eligibleMintHourMinimum
    && curveComparisons.length >= PREREGISTERED.curveComparisonMinimum
    && discoveryLags.length >= PREREGISTERED.discoveryMatchMinimum;
  const checks = {
    runEnabled: enabled,
    completedLifecycle,
    strategyConsumptionDisabled,
    tradeCountAgreement: countPassRate >= PREREGISTERED.mintHourAgreementMinimumRate,
    solVolumeAgreement: volumePassRate >= PREREGISTERED.mintHourAgreementMinimumRate,
    curveAgreement: curvePassRate >= PREREGISTERED.curveAgreementMinimumRate,
    discoveryLatency: Number.isFinite(discoveryStats.p90)
      && discoveryStats.p90 <= PREREGISTERED.discoveryHeliusLagP90MaximumMs,
    decoderTailErrors: decoderTailErrors <= PREREGISTERED.decoderTailErrorsMaximum,
    quoteLabelCoverage: quoteCoverage >= PREREGISTERED.quoteLabelCoverageMinimumRate,
    unsupportedQuoteEvents: unsupportedQuoteEvents <= PREREGISTERED.unsupportedQuoteEventsMaximum
  };
  const hardAdapterChecksPassed = checks.strategyConsumptionDisabled
    && checks.decoderTailErrors
    && checks.quoteLabelCoverage
    && checks.unsupportedQuoteEvents;

  let verdict = PREREGISTERED.invalidVerdict;
  if (enabled && strategyConsumptionDisabled && completedLifecycle && state.heliusTrades.length > 0) {
    if (!hardAdapterChecksPassed) verdict = PREREGISTERED.failVerdict;
    else if (!enoughEvidence) verdict = PREREGISTERED.insufficientVerdict;
    else verdict = Object.values(checks).every(Boolean)
      ? PREREGISTERED.passVerdict
      : PREREGISTERED.failVerdict;
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceTelemetry,
    preregistered: PREREGISTERED,
    verdict,
    enoughEvidence,
    hardAdapterChecksPassed,
    checks,
    counts: {
      heliusTrades: state.heliusTrades.length,
      rawHeliusTradeEvents: state.rawHeliusTradeEvents,
      duplicateHeliusTradeEvents: state.duplicateHeliusTradeEvents,
      pumpPortalTrades: state.portalTrades.length,
      solQuotedHeliusTrades: solQuotedTradeEvents,
      eligibleMintHours: mintHours.length,
      curveComparisons: curveComparisons.length,
      discoveryMatches: discoveryLags.length,
      decoderTailErrors,
      quoteLabeledTradeEvents,
      unsupportedQuoteEvents,
      heliusUniqueMints: heliusMints.size,
      pumpDevUniqueMints: state.pumpDevMints.size,
      pumpDevOverlapMints,
      heliusSignatures: heliusSignatures.size,
      pumpPortalSignatures: portalSignatures.size,
      signatureOverlap,
      portalCoverageLifecycleFallbackMints: portalCoverage.lifecycleFallbackMints,
      portalTradestreamConnectionIntervals: portalCoverage.connectionIntervals.length,
      malformedLines: state.malformedLines
    },
    agreement: {
      mintHourCountPassRate: countPassRate,
      mintHourVolumePassRate: volumePassRate,
      curvePassRate,
      quoteLabelCoverage: quoteCoverage,
      tradeCountRelativeDelta: stats(mintHours.map((row) => row.tradeCountRelativeDelta), 6),
      solVolumeRelativeDelta: stats(mintHours.map((row) => row.solVolumeRelativeDelta), 6),
      curveAbsoluteDelta: stats(curveComparisons.map((row) => row.absoluteDelta), 6),
      curveSignedDelta: stats(curveComparisons.map((row) => row.signedDelta), 6),
      curveMatchAgeMs: stats(curveComparisons.map((row) => row.ageMs), 0),
      discoveryHeliusMinusPumpPortalMs: discoveryStats
    },
    diagnostics: {
      portalCoverageWindowSourceCounts: portalCoverage.sourceCounts,
      buyRatioAbsoluteDelta: stats(mintHours.map((row) => {
        if (!Number.isFinite(row.heliusBuyRatio) || !Number.isFinite(row.pumpPortalBuyRatio)) return null;
        return Math.abs(row.heliusBuyRatio - row.pumpPortalBuyRatio);
      }), 6),
      uniqueBuyerRelativeDelta: stats(mintHours.map((row) => relativeDelta(
        row.heliusUniqueBuyers,
        row.pumpPortalUniqueBuyers
      )), 6),
      processedForkRisk: {
        commitment: state.sessionStarted?.heliusPumpfunShadowPlan?.commitment || null,
        signatureOverlapIsDiagnosticOnly: true,
        heliusSignaturesAbsentFromPumpPortal: Math.max(0, heliusSignatures.size - signatureOverlap),
        comparatorCoverageCaveat: 'PumpPortal may be targeted; absent signatures do not by themselves prove a dropped fork.'
      }
    },
    worstMintHours: [...mintHours]
      .sort((a, b) => Math.max(b.tradeCountRelativeDelta || 0, b.solVolumeRelativeDelta || 0)
        - Math.max(a.tradeCountRelativeDelta || 0, a.solVolumeRelativeDelta || 0))
      .slice(0, 25),
    worstCurveComparisons: [...curveComparisons]
      .sort((a, b) => b.absoluteDelta - a.absoluteDelta)
      .slice(0, 25),
    interpretation: verdict === PREREGISTERED.passVerdict
      ? 'Shadow parity passed its frozen evidence gate. This does not authorize strategy consumption.'
      : verdict === PREREGISTERED.failVerdict
        ? 'Shadow parity failed at least one frozen check. Keep Helius report-only and fix the measured discrepancy.'
        : verdict === PREREGISTERED.invalidVerdict
          ? 'Shadow parity is invalid because the required run lifecycle or adapter manifest was incomplete.'
          : 'No strategy decision is allowed from this artifact until the frozen evidence minimum is met.'
  };
}

function analyzeEvents(events, sourceTelemetry = 'synthetic') {
  return buildReport(collectEvents(events), sourceTelemetry);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main() {
  const { telemetryPath } = parseCli();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    const report = buildReport(collectEvents([]), null);
    ensureDir(LATEST_PATH);
    fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Wrote Helius Pump.fun shadow parity report: ${LATEST_PATH}`);
    return;
  }
  const state = createState();
  const readStats = forEachJsonlSync(telemetryPath, (event) => ingestEvent(state, event));
  state.malformedLines = readStats.malformedLines;
  const relativeSource = path.relative(ROOT, telemetryPath).replace(/\\/g, '/');
  const report = buildReport(state, relativeSource);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stampedPath = path.join(OUTPUT_DIR, `helius-pumpfun-shadow-parity-${stamp}.json`);
  ensureDir(stampedPath);
  fs.writeFileSync(stampedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  ensureDir(LATEST_PATH);
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote Helius Pump.fun shadow parity report: ${stampedPath}`);
  console.log(`Wrote latest Helius Pump.fun shadow parity report: ${LATEST_PATH}`);
}

if (require.main === module) main();

module.exports = {
  PREREGISTERED,
  analyzeEvents,
  buildReport,
  isSolQuoted,
  solAmountOf,
  collectEvents,
  createState,
  ingestEvent,
  nearestByTime,
  relativeDelta,
  stats,
  timestampMs
};
