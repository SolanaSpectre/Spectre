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

// V5 was frozen after on-chain ground truth proved PumpPortal trader attribution differs from TradeEvent.user.
const PREREGISTERED = Object.freeze({
  id: 'helius_pumpfun_shadow_parity_v5_2026-07-19',
  adapterMode: 'logs_only_report_only',
  strategyConsumptionAllowed: false,
  comparator: 'pumpportal_runtime_telemetry_and_rpc_curve_truth',
  comparatorCoverageWindow: 'targeted_subscription_intersect_tradestream_connection_per_mint_hour',
  comparatorCoverageFallback: 'pumpportal_first_to_last_trade_when_lifecycle_is_unavailable',
  comparatorCoverageFallbackEdgeToleranceMs: 2_000,
  preregistrationAmendment: 'pre_first_run_coverage_window_fix_after_independent_review',
  lifecycleAmendment: 'pre_first_valid_comparator_run_require_completed_session_lifecycle',
  v1FailureDisposition: 'failed_on_mixed_standard_and_mayhem_volume_and_curve_comparisons',
  v2CohortRule: 'count_all_sol_quotes_but_grade_volume_and_curve_only_when_mayhem_mode_is_explicitly_false',
  v2EvidenceStart: 'first_run_after_mayhem_mode_was_emitted_on_helius_shadow_trade_rows',
  v2FailureDisposition: 'comparator_invalidated_after_exact_signature_amounts_passed_99_90pct_but_symmetric_counts_penalized_extra_helius_coverage_and_trade_to_nearest_rpc_age_median_was_3596ms',
  v3TradeIdentity: 'signature_mint_trader_side',
  v3CoverageRule: 'grade_portal_trade_identity_recall_per_covered_mint_hour_instead_of_symmetric_trade_count_delta',
  v3VolumeRule: 'grade_exact_identity_standard_trade_amount_pairs_only; aggregate_volume_is_diagnostic',
  v3CurveRule: 'grade_each_rpc_snapshot_against_latest_preceding_standard_helius_trade_within_1000ms',
  v3LifecycleRule: 'require_connection_and_zero_errors_subscription_errors_or_unexpected_disconnects',
  v3EvidenceStart: 'first_run_after_v3_comparator_was_frozen',
  v3FrozenAt: '2026-07-19T19:05:00.000Z',
  v3FailureDisposition: 'failed_21_of_23_amount_cohorts_because_signature_mint_trader_side_can_repeat_for_multiple_trade_events_while_pumpportal_emits_one_aggregate',
  v4VolumeRule: 'sum_all_standard_helius_trade_events_per_signature_mint_trader_side_then_compare_to_the_single_pumpportal_aggregate',
  v4RuntimeAmendment: 'before_first_completed_v4_run_contain_trade_decode_exceptions_and_fail_parity_on_counted_decode_errors',
  v4EvidenceStart: 'first_completed_run_after_v4_grouped_identity_comparator_and_decoder_exception_containment_were_committed',
  v4FrozenAt: '2026-07-19T19:45:00.000Z',
  v4PassDisposition: 'one_valid_paper15_pass_not_promotion_evidence; offline_autopsy_required_before_replication',
  v5TradeIdentity: 'signature_mint_side',
  v5IdentityAmendment: 'ground_truth_12_of_12_helius_users_matched_onchain_trade_event_user_while_pumpportal_trader_matched_neither_event_user_nor_fee_payer',
  v5VolumeRule: 'preserve_v4_signature_mint_trader_side_grouping_for_exact_amount_pairs; relaxed_identity_applies_to_recall_only',
  v5TraderDiagnostic:
    'permanent_named_diagnostic; never_part_of_recall_identity; '
    + 'SUPERSEDED_2026-08-03_by_traderGroundTruthRule; '
    + 'original_rule_required_zero_wallet_feature_divergence_from_pumpportal',
  v5BurstDiagnostic: 'recall_autopsy_emits_selective_vs_global_absence_and_high_vs_lower_burst_miss_rates_without_a_gate_until_replicated',
  v5EvidenceStart: 'first_completed_run_after_v5_semantic_identity_comparator_was_committed',
  v5FrozenAt: '2026-07-19T21:42:00.000Z',
  // The v5 trader gate required zero wallet-feature divergence from PumpPortal, but
  // v5IdentityAmendment already established that PumpPortal's trader field matched
  // neither the on-chain TradeEvent user nor the fee payer in 12 of 12 sampled cases,
  // while Helius matched all 12. Requiring agreement with a comparator that is known
  // to be wrong makes a correct Helius permanently unpromotable. Promotion now
  // adjudicates disagreements against on-chain truth instead of against PumpPortal.
  traderGroundTruthAmendment:
    'replace_zero_divergence_from_pumpportal_with_agreement_against_onchain_trade_event_user; '
    + 'pumpportal_trader_agreement_is_demoted_to_diagnostic_only',
  traderGroundTruthAmendedAt: '2026-08-03T01:20:00.000-05:00',
  traderGroundTruthRule:
    'adjudicate_every_trader_identity_disagreement_against_TradeEvent_user_decoded_from_getTransaction_logMessages; '
    + 'helius_must_match_onchain_ground_truth; pumpportal_agreement_is_diagnostic_only',
  traderGroundTruthCohort: 'trader_identity_disagreements_and_identity_residues',
  traderGroundTruthMinimumAdjudications: 12,
  traderGroundTruthAgreementMinimumRate: 1,
  // Fails closed. A run with no adjudications is INSUFFICIENT_EVIDENCE, never a pass,
  // so perfect recall cannot silently satisfy the gate by starving its own cohort.
  traderGroundTruthInsufficientDisposition:
    'insufficient_evidence_not_pass; gate_fails_closed_when_no_adjudications_are_available',
  traderGroundTruthEvidenceStart:
    'first_completed_run_after_the_ground_truth_sampler_cohort_includes_trader_identity_disagreements',
  boundedReconnectLifecycleAmendment:
    'before_first_v11_run_allow_only_measured_bounded_reconnects_with_ack_per_epoch_and_gap_affected_decisions_excluded',
  boundedReconnectLifecycleAmendedAt: '2026-07-31T22:50:00.000-05:00',
  maximumUnexpectedReconnectsPerHour: 3,
  maximumSingleTransportGapMs: 5_000,
  maximumCumulativeTransportGapMsPerHour: 15_000,
  subscriptionAckRequiredForEveryConnectionEpoch: true,
  transportGapDecisionExclusionWindowMs: 60_000,
  duplicatePolicy: 'dedupe_helius_by_signature_mint_log_index_and_amounts_before_parity_aggregation',
  solQuotedMinimumTradesPerMintHour: 20,
  eligibleMintHourMinimum: 10,
  portalTradeIdentityRecallMinimumRate: 0.95,
  solVolumeRelativeDeltaMaximum: 0.05,
  exactIdentityAmountAgreementMinimumRate: 0.95,
  mintHourAgreementMinimumRate: 0.95,
  curveRpcMaximumPriorAgeMs: 1_000,
  curveAbsoluteDeltaMaximum: 0.02,
  curveAgreementMinimumRate: 0.95,
  curveComparisonMinimum: 100,
  discoveryMatchMinimum: 20,
  discoveryHeliusLagP90MaximumMs: 2_000,
  decoderTailErrorsMaximum: 0,
  decoderEventErrorsMaximum: 0,
  quoteLabelCoverageMinimumRate: 1,
  mayhemClassificationCoverageMinimumRate: 1,
  unsupportedQuoteEventsMaximum: 0,
  websocketCreditRate: {
    creditsPerUnit: 2,
    bytesPerUnit: 100_000,
    developerMonthlyCredits: 10_000_000,
    estimateBoundary: 'application_payload_bytes_with_per_message_deflate_disabled; provider_invoice_may_include_different_wire_accounting'
  },
  processedForkRisk: 'diagnostic_only_signature_overlap',
  diagnosticOnlyMetrics: ['symmetric_trade_count_delta', 'trader_identity_agreement', 'burst_miss_differential', 'buy_ratio', 'unique_buyers', 'pumpdev_overlap', 'extra_helius_signatures'],
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

function round(value, digits = 3) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function websocketCreditEstimate(bytes, durationMs) {
  const measuredBytes = Number(bytes);
  const elapsedMs = Number(durationMs);
  const rate = PREREGISTERED.websocketCreditRate;
  const measured = bytes !== null && bytes !== undefined && bytes !== ''
    && Number.isFinite(measuredBytes) && measuredBytes >= 0;
  const elapsed = durationMs !== null && durationMs !== undefined && durationMs !== ''
    && Number.isFinite(elapsedMs) && elapsedMs > 0;
  const credits = measured ? (measuredBytes / rate.bytesPerUnit) * rate.creditsPerUnit : null;
  const creditsPerHour = measured && elapsed ? credits * (3_600_000 / elapsedMs) : null;
  return {
    applicationPayloadBytes: measured ? measuredBytes : null,
    applicationPayloadMegabytesDecimal: measured ? round(measuredBytes / 1_000_000, 3) : null,
    measuredSessionCreditsEstimate: round(credits, 3),
    creditsPerHourEstimate: round(creditsPerHour, 3),
    paper480CreditsEstimate: round(creditsPerHour === null ? null : creditsPerHour * 8, 3),
    continuous730HourCreditsEstimate: round(
      creditsPerHour === null ? null : creditsPerHour * 730,
      3
    ),
    continuousMonthlyPlanUtilizationEstimate: round(
      creditsPerHour === null
        ? null
        : (creditsPerHour * 730) / rate.developerMonthlyCredits,
      6
    ),
    creditsPerUnit: rate.creditsPerUnit,
    bytesPerUnit: rate.bytesPerUnit,
    developerMonthlyCredits: rate.developerMonthlyCredits,
    estimateBoundary: rate.estimateBoundary
  };
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

function tradeIdentity(payload = {}, mint = mintOf(payload)) {
  const signature = payload.signature || null;
  const side = String(payload.txType || '').toLowerCase();
  return signature && mint && (side === 'buy' || side === 'sell')
    ? `${signature}|${mint}|${side}`
    : null;
}

function volumeIdentity(payload = {}, mint = mintOf(payload)) {
  const signature = payload.signature || null;
  const trader = traderOf(payload);
  const side = String(payload.txType || '').toLowerCase();
  return signature && mint && trader && (side === 'buy' || side === 'sell')
    ? `${signature}|${mint}|${trader}|${side}`
    : null;
}

function traderOf(payload = {}) {
  return payload.traderPublicKey || payload.trader || payload.user || null;
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

function latestAtOrBefore(sortedRows, targetMs, maximumAgeMs) {
  if (!Array.isArray(sortedRows) || !sortedRows.length || !Number.isFinite(targetMs)) return null;
  let low = 0;
  let high = sortedRows.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedRows[middle].receiptMs <= targetMs) low = middle + 1;
    else high = middle - 1;
  }
  const candidate = sortedRows[high];
  if (!candidate) return null;
  const ageMs = targetMs - candidate.receiptMs;
  return ageMs <= maximumAgeMs ? { ...candidate, ageMs } : null;
}

function createState() {
  return {
    sessionStartMs: null,
    sessionStarted: null,
    sessionStopping: null,
    sessionStopMs: null,
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
    pumpDevMints: new Set(),
    heliusLifecycle: {
      connections: 0,
      subscriptionAcks: 0,
      errors: 0,
      subscriptionErrors: 0,
      subscriptionAckTimeouts: 0,
      pongTimeouts: 0,
      decodeErrors: 0,
      unexpectedDisconnects: 0,
      normalDisconnects: 0,
      shutdownPhaseDisconnects: 0,
      shutdownPhaseErrors: 0,
      transportGapsStarted: 0,
      transportGapsClosed: 0,
      unexpectedDisconnectsWithoutGapSequence: 0,
      transportGapDurationsMs: [],
      activeTransportGapSequences: new Set()
    }
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
    state.sessionStopMs = atMs;
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_connected') {
    state.heliusLifecycle.connections += 1;
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_subscription_ack') {
    state.heliusLifecycle.subscriptionAcks += 1;
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_error'
    || type === 'provider.helius_pumpfun.shadow_config_error') {
    const explicitShutdownError = type === 'provider.helius_pumpfun.shadow_error'
      && payload.shutdownError === true
      && payload.sessionPhase === 'STOPPING'
      && Number.isFinite(Number(payload.shutdownAgeMs))
      && Number(payload.shutdownAgeMs) <= 1000;
    if (explicitShutdownError) state.heliusLifecycle.shutdownPhaseErrors += 1;
    else state.heliusLifecycle.errors += 1;
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_subscription_error') {
    state.heliusLifecycle.subscriptionErrors += 1;
    if (payload.reason === 'ACK_TIMEOUT') state.heliusLifecycle.subscriptionAckTimeouts += 1;
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_pong_timeout') {
    state.heliusLifecycle.pongTimeouts += 1;
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_transport_gap_closed') {
    state.heliusLifecycle.transportGapsClosed += 1;
    if (Number.isFinite(Number(payload.durationMs))) {
      state.heliusLifecycle.transportGapDurationsMs.push(Number(payload.durationMs));
    }
    if (payload.sequence !== null && payload.sequence !== undefined) {
      state.heliusLifecycle.activeTransportGapSequences.delete(String(payload.sequence));
    }
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_decode_error') {
    state.heliusLifecycle.decodeErrors += 1;
    return;
  }
  if (type === 'provider.helius_pumpfun.shadow_disconnected') {
    const explicitShutdownDisconnect = payload.shutdownDisconnect === true
      && payload.sessionPhase === 'STOPPING'
      && Number.isFinite(Number(payload.shutdownAgeMs))
      && Number(payload.shutdownAgeMs) <= 1000;
    const normalStop = Number(payload.code) === 1000 && payload.reason === 'shadow listener stop';
    if (explicitShutdownDisconnect) {
      state.heliusLifecycle.shutdownPhaseDisconnects += 1;
      state.heliusLifecycle.normalDisconnects += 1;
    } else if (normalStop) state.heliusLifecycle.normalDisconnects += 1;
    else {
      state.heliusLifecycle.unexpectedDisconnects += 1;
      if (payload.transportGapSequence !== null && payload.transportGapSequence !== undefined) {
        const sequence = String(payload.transportGapSequence);
        if (!state.heliusLifecycle.activeTransportGapSequences.has(sequence)) {
          state.heliusLifecycle.transportGapsStarted += 1;
          state.heliusLifecycle.activeTransportGapSequences.add(sequence);
        }
      } else {
        state.heliusLifecycle.unexpectedDisconnectsWithoutGapSequence += 1;
      }
    }
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
  const standardVolumeMintHours = [];
  const traderIdentityDisagreements = [];
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
    const portalRowsByIdentity = new Map();
    for (const row of portalRows) {
      const identity = tradeIdentity(row.payload, row.mint);
      if (!identity) continue;
      const rows = portalRowsByIdentity.get(identity) || [];
      rows.push(row);
      portalRowsByIdentity.set(identity, rows);
    }
    const portalTradeIdentities = new Set(portalRowsByIdentity.keys());
    if (portalTradeIdentities.size < PREREGISTERED.solQuotedMinimumTradesPerMintHour) continue;
    const helius = createAggregate();
    const portal = createAggregate();
    heliusRows.forEach((row) => addTrade(helius, row.payload));
    portalRows.forEach((row) => addTrade(portal, row.payload));
    const heliusRowsByIdentity = new Map();
    for (const row of heliusRows) {
      const identity = tradeIdentity(row.payload, row.mint);
      if (!identity) continue;
      const rows = heliusRowsByIdentity.get(identity) || [];
      rows.push(row);
      heliusRowsByIdentity.set(identity, rows);
    }
    const heliusTradeIdentities = new Set(heliusRowsByIdentity.keys());
    const matchedPortalTradeIdentities = [...portalTradeIdentities]
      .filter((identity) => heliusTradeIdentities.has(identity)).length;
    let traderIdentityComparisons = 0;
    let traderIdentityMatches = 0;
    for (const identity of portalTradeIdentities) {
      const matchedHeliusRows = heliusRowsByIdentity.get(identity);
      if (!matchedHeliusRows) continue;
      const portalIdentityRows = portalRowsByIdentity.get(identity) || [];
      const portalTraders = new Set(portalIdentityRows.map((row) => traderOf(row.payload)).filter(Boolean));
      const heliusTraders = new Set(matchedHeliusRows.map((row) => traderOf(row.payload)).filter(Boolean));
      if (!portalTraders.size || !heliusTraders.size) continue;
      traderIdentityComparisons += 1;
      if ([...portalTraders].some((trader) => heliusTraders.has(trader))) {
        traderIdentityMatches += 1;
        continue;
      }
      // Emitted so the ground-truth sampler can adjudicate the disagreement against the
      // on-chain TradeEvent user. These rows were previously counted and discarded, which
      // left traderGroundTruthRule with no cohort to read. Diagnostic only; no grading here.
      const portalPayload = portalIdentityRows[0]?.payload || {};
      traderIdentityDisagreements.push({
        classification: 'TRADER_IDENTITY_DISAGREEMENT',
        mint: coverage.mint,
        signature: portalPayload.signature || null,
        side: String(portalPayload.txType || '').toLowerCase() || null,
        trader: [...portalTraders][0] || null,
        pumpPortalTraderSamples: [...portalTraders].slice(0, 4),
        heliusTraderSamples: [...heliusTraders].slice(0, 4)
      });
    }
    const portalTradeIdentityRecall = ratio(matchedPortalTradeIdentities, portalTradeIdentities.size);
    const tradeCountRelativeDelta = relativeDelta(helius.trades, portal.trades);
    const rowSummary = {
      key,
      mint: coverage.mint,
      hourIndex: coverage.hourIndex,
      coverageSources: [...coverage.sources],
      coverageWindowCount: segments.length,
      coverageDurationMs: segments.reduce((total, segment) => total + Math.max(0, segment.endMs - segment.startMs), 0),
      heliusTrades: helius.trades,
      pumpPortalTrades: portal.trades,
      portalTradeIdentities: portalTradeIdentities.size,
      matchedPortalTradeIdentities,
      portalTradeIdentityRecall,
      traderIdentityComparisons,
      traderIdentityMatches,
      traderIdentityAgreementRate: ratio(traderIdentityMatches, traderIdentityComparisons),
      tradeCountRelativeDelta,
      heliusBuyRatio: ratio(helius.buys, helius.buys + helius.sells),
      pumpPortalBuyRatio: ratio(portal.buys, portal.buys + portal.sells),
      heliusUniqueBuyers: helius.buyers.size,
      pumpPortalUniqueBuyers: portal.buyers.size,
      countPass: portalTradeIdentityRecall >= PREREGISTERED.portalTradeIdentityRecallMinimumRate
    };
    mintHours.push(rowSummary);

    const standardHeliusRows = heliusRows.filter((row) => row.payload.mayhemMode === false);
    const standardHeliusByIdentity = new Map();
    for (const row of standardHeliusRows) {
      const identity = volumeIdentity(row.payload, row.mint);
      if (!identity) continue;
      const group = standardHeliusByIdentity.get(identity) || [];
      group.push(row);
      standardHeliusByIdentity.set(identity, group);
    }
    const portalByIdentity = new Map();
    for (const row of portalRows) {
      const identity = volumeIdentity(row.payload, row.mint);
      if (!identity) continue;
      const rows = portalByIdentity.get(identity) || [];
      rows.push(row);
      portalByIdentity.set(identity, rows);
    }
    const standardPairs = [...portalByIdentity.entries()]
      .filter(([identity]) => standardHeliusByIdentity.has(identity))
      .map(([identity, matchedPortalRows]) => ({
        heliusRows: standardHeliusByIdentity.get(identity),
        portalRows: matchedPortalRows
      }));
    if (standardPairs.length < PREREGISTERED.solQuotedMinimumTradesPerMintHour) continue;
    const standardHelius = createAggregate();
    const standardPortal = createAggregate();
    const amountRelativeDeltas = [];
    for (const pair of standardPairs) {
      pair.heliusRows.forEach((row) => addTrade(standardHelius, row.payload));
      pair.portalRows.forEach((row) => addTrade(standardPortal, row.payload));
      const heliusAmount = pair.heliusRows.reduce((total, row) => (
        total + Math.abs(solAmountOf(row.payload) || 0)
      ), 0);
      const portalAmount = pair.portalRows.reduce((total, row) => (
        total + Math.abs(solAmountOf(row.payload) || 0)
      ), 0);
      amountRelativeDeltas.push(relativeDelta(
        heliusAmount,
        portalAmount
      ));
    }
    const solVolumeRelativeDelta = relativeDelta(standardHelius.solVolume, standardPortal.solVolume);
    const amountAgreementRate = ratio(
      amountRelativeDeltas.filter((delta) => Number.isFinite(delta)
        && delta <= PREREGISTERED.solVolumeRelativeDeltaMaximum).length,
      amountRelativeDeltas.filter(Number.isFinite).length
    );
    standardVolumeMintHours.push({
      ...rowSummary,
      heliusTrades: standardHelius.trades,
      pumpPortalTrades: standardPortal.trades,
      heliusSolVolume: Number(standardHelius.solVolume.toFixed(9)),
      pumpPortalSolVolume: Number(standardPortal.solVolume.toFixed(9)),
      solVolumeRelativeDelta,
      exactIdentityAmountComparisons: amountRelativeDeltas.filter(Number.isFinite).length,
      exactIdentityAmountAgreementRate: amountAgreementRate,
      volumePass: amountAgreementRate >= PREREGISTERED.exactIdentityAmountAgreementMinimumRate
    });
  }

  for (const rows of heliusTradesByMint.values()) rows.sort((a, b) => a.receiptMs - b.receiptMs);
  for (const rows of state.rpcCurves.values()) rows.sort((a, b) => a.atMs - b.atMs);
  const curveComparisons = [];
  let solQuotedTradeEvents = 0;
  let quoteLabeledTradeEvents = 0;
  let mayhemClassifiedTradeEvents = 0;
  let mayhemTradeEvents = 0;
  let standardTradeEvents = 0;
  let unsupportedQuoteEvents = 0;
  let decoderTailErrors = 0;
  for (const row of state.heliusTrades) {
    const model = row.payload.curveModel;
    if (model) quoteLabeledTradeEvents += 1;
    if (model === 'quote_mint_unsupported') unsupportedQuoteEvents += 1;
    if (row.payload.tailDecodeError) decoderTailErrors += 1;
    if (!isSolQuoted(row.payload)) continue;
    solQuotedTradeEvents += 1;
    if (typeof row.payload.mayhemMode === 'boolean') mayhemClassifiedTradeEvents += 1;
    if (row.payload.mayhemMode === true) mayhemTradeEvents += 1;
    if (row.payload.mayhemMode === false) standardTradeEvents += 1;
    if (row.payload.mayhemMode !== false) continue;
  }
  for (const [mint, rpcRows] of state.rpcCurves.entries()) {
    const standardRows = (heliusTradesByMint.get(mint) || [])
      .filter((row) => isSolQuoted(row.payload)
        && row.payload.mayhemMode === false
        && Number.isFinite(numberOrNull(row.payload.curveProgress)));
    for (const rpcRow of rpcRows) {
      const preceding = latestAtOrBefore(
        standardRows,
        rpcRow.atMs,
        PREREGISTERED.curveRpcMaximumPriorAgeMs
      );
      if (!preceding) continue;
      const heliusCurve = numberOrNull(preceding.payload.curveProgress);
      const signedDelta = heliusCurve - rpcRow.curveProgress;
      const absoluteDelta = Math.abs(signedDelta);
      curveComparisons.push({
        mint,
        signature: preceding.payload.signature || null,
        ageMs: preceding.ageMs,
        heliusCurveProgress: heliusCurve,
        rpcCurveProgress: rpcRow.curveProgress,
        signedDelta,
        absoluteDelta,
        pass: absoluteDelta <= PREREGISTERED.curveAbsoluteDeltaMaximum
      });
    }
  }

  const discoveryLags = [];
  for (const [mint, heliusAt] of state.heliusCreates.entries()) {
    const portalAt = state.portalCreates.get(mint);
    if (Number.isFinite(portalAt)) discoveryLags.push(heliusAt - portalAt);
  }
  const discoveryStats = stats(discoveryLags, 0);
  const countPassRate = ratio(mintHours.filter((row) => row.countPass).length, mintHours.length);
  const traderIdentityComparisons = mintHours.reduce((sum, row) => sum + row.traderIdentityComparisons, 0);
  const traderIdentityMatches = mintHours.reduce((sum, row) => sum + row.traderIdentityMatches, 0);
  const traderIdentityAgreementRate = ratio(traderIdentityMatches, traderIdentityComparisons);
  const volumePassRate = ratio(standardVolumeMintHours.filter((row) => row.volumePass).length, standardVolumeMintHours.length);
  const curvePassRate = ratio(curveComparisons.filter((row) => row.pass).length, curveComparisons.length);
  const curveOutliers = curveComparisons.filter((row) => !row.pass);
  const quoteCoverage = ratio(quoteLabeledTradeEvents, state.heliusTrades.length);
  const mayhemClassificationCoverage = ratio(mayhemClassifiedTradeEvents, solQuotedTradeEvents);
  const heliusSignatures = new Set(state.heliusTrades.map((row) => row.payload.signature).filter(Boolean));
  const portalSignatures = new Set(state.portalTrades.map((row) => row.payload.signature).filter(Boolean));
  const signatureOverlap = [...heliusSignatures].filter((signature) => portalSignatures.has(signature)).length;
  const heliusMints = new Set(state.heliusTrades.map((row) => row.mint));
  const pumpDevOverlapMints = [...state.pumpDevMints].filter((mint) => heliusMints.has(mint)).length;
  const enabled = state.sessionStarted?.heliusPumpfunShadowPlan?.enabled === true;
  const strategyConsumptionDisabled = state.sessionStarted?.heliusPumpfunShadowPlan?.strategyConsumptionEnabled === false;
  const completedLifecycle = Boolean(state.sessionStopping);
  const postV5Freeze = Number.isFinite(sessionStartMs)
    && sessionStartMs >= timestampMs(PREREGISTERED.v5FrozenAt);
  const postBoundedLifecycleAmendment = Number.isFinite(sessionStartMs)
    && sessionStartMs >= timestampMs(PREREGISTERED.boundedReconnectLifecycleAmendedAt);
  const sessionDurationMs = Number.isFinite(sessionStartMs) && Number.isFinite(state.sessionStopMs)
    ? Math.max(0, state.sessionStopMs - sessionStartMs)
    : null;
  const sessionDurationHours = Number.isFinite(sessionDurationMs) && sessionDurationMs > 0
    ? sessionDurationMs / 3_600_000
    : null;
  const maximumUnexpectedReconnects = Number.isFinite(sessionDurationHours)
    ? Math.max(
      1,
      Math.ceil(sessionDurationHours * PREREGISTERED.maximumUnexpectedReconnectsPerHour)
    )
    : 0;
  const maximumCumulativeTransportGapMs = Number.isFinite(sessionDurationHours)
    ? Math.max(
      PREREGISTERED.maximumSingleTransportGapMs,
      sessionDurationHours * PREREGISTERED.maximumCumulativeTransportGapMsPerHour
    )
    : 0;
  const gapDurationStats = stats(state.heliusLifecycle.transportGapDurationsMs, 0);
  const activeTransportGaps = state.heliusLifecycle.activeTransportGapSequences.size;
  const everyConnectionAcknowledged = state.heliusLifecycle.subscriptionAcks
    === state.heliusLifecycle.connections;
  const boundedReconnects = state.heliusLifecycle.unexpectedDisconnects
    <= maximumUnexpectedReconnects;
  const measuredTransportGaps = state.heliusLifecycle.transportGapsStarted
    <= state.heliusLifecycle.unexpectedDisconnects
    && state.heliusLifecycle.unexpectedDisconnectsWithoutGapSequence === 0
    && state.heliusLifecycle.transportGapsClosed === state.heliusLifecycle.transportGapsStarted
    && activeTransportGaps === 0;
  const boundedTransportGaps = (gapDurationStats.max ?? 0)
    <= PREREGISTERED.maximumSingleTransportGapMs
    && state.heliusLifecycle.transportGapDurationsMs.reduce((sum, value) => sum + value, 0)
      <= maximumCumulativeTransportGapMs;
  const cleanHeliusLifecycle = state.heliusLifecycle.connections >= 1
    && state.heliusLifecycle.errors === 0
    && state.heliusLifecycle.subscriptionErrors === 0
    && everyConnectionAcknowledged
    && boundedReconnects
    && measuredTransportGaps
    && boundedTransportGaps;
  const finalHeliusStats = state.sessionStopping?.stats?.heliusPumpfunShadow || {};
  const creditEstimate = websocketCreditEstimate(finalHeliusStats.bytes, sessionDurationMs);
  const heliusLifecycleSummary = {
    ...state.heliusLifecycle,
    transportGapDurationsMs: state.heliusLifecycle.transportGapDurationsMs.slice(),
    activeTransportGapSequences: [...state.heliusLifecycle.activeTransportGapSequences],
    sessionDurationMs,
    maximumUnexpectedReconnects,
    maximumCumulativeTransportGapMs,
    everyConnectionAcknowledged,
    boundedReconnects,
    measuredTransportGaps,
    boundedTransportGaps,
    transportGapDurationStats: gapDurationStats
  };
  const enoughEvidence = mintHours.length >= PREREGISTERED.eligibleMintHourMinimum
    && standardVolumeMintHours.length >= PREREGISTERED.eligibleMintHourMinimum
    && curveComparisons.length >= PREREGISTERED.curveComparisonMinimum
    && discoveryLags.length >= PREREGISTERED.discoveryMatchMinimum;
  const checks = {
    runEnabled: enabled,
    postV5Freeze,
    postBoundedLifecycleAmendment,
    completedLifecycle,
    cleanHeliusLifecycle,
    strategyConsumptionDisabled,
    portalTradeIdentityRecall: countPassRate >= PREREGISTERED.mintHourAgreementMinimumRate,
    solVolumeAgreement: volumePassRate >= PREREGISTERED.mintHourAgreementMinimumRate,
    curveAgreement: curvePassRate >= PREREGISTERED.curveAgreementMinimumRate,
    discoveryLatency: Number.isFinite(discoveryStats.p90)
      && discoveryStats.p90 <= PREREGISTERED.discoveryHeliusLagP90MaximumMs,
    decoderTailErrors: decoderTailErrors <= PREREGISTERED.decoderTailErrorsMaximum,
    decoderEventErrors: state.heliusLifecycle.decodeErrors <= PREREGISTERED.decoderEventErrorsMaximum,
    quoteLabelCoverage: quoteCoverage >= PREREGISTERED.quoteLabelCoverageMinimumRate,
    mayhemClassificationCoverage: mayhemClassificationCoverage >= PREREGISTERED.mayhemClassificationCoverageMinimumRate,
    unsupportedQuoteEvents: unsupportedQuoteEvents <= PREREGISTERED.unsupportedQuoteEventsMaximum
  };
  const hardAdapterChecksPassed = checks.strategyConsumptionDisabled
    && checks.cleanHeliusLifecycle
    && checks.decoderTailErrors
    && checks.decoderEventErrors
    && checks.quoteLabelCoverage
    && checks.mayhemClassificationCoverage
    && checks.unsupportedQuoteEvents;

  let verdict = PREREGISTERED.invalidVerdict;
  if (
    enabled
    && postV5Freeze
    && postBoundedLifecycleAmendment
    && strategyConsumptionDisabled
    && completedLifecycle
    && state.heliusTrades.length > 0
  ) {
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
      standardVolumeMintHours: standardVolumeMintHours.length,
      mayhemClassifiedTradeEvents,
      mayhemTradeEvents,
      standardTradeEvents,
      heliusLifecycle: heliusLifecycleSummary,
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
      traderIdentityComparisons,
      traderIdentityMatches,
      traderIdentityDisagreements: traderIdentityDisagreements.length,
      portalCoverageLifecycleFallbackMints: portalCoverage.lifecycleFallbackMints,
      portalTradestreamConnectionIntervals: portalCoverage.connectionIntervals.length,
      malformedLines: state.malformedLines
    },
    agreement: {
      mintHourPortalTradeIdentityRecallPassRate: countPassRate,
      mintHourVolumePassRate: volumePassRate,
      curvePassRate,
      quoteLabelCoverage: quoteCoverage,
      mayhemClassificationCoverage,
      traderIdentityAgreementRate,
      traderIdentityAgreementByMintHour: stats(mintHours.map((row) => row.traderIdentityAgreementRate), 6),
      portalTradeIdentityRecall: stats(mintHours.map((row) => row.portalTradeIdentityRecall), 6),
      exactIdentityAmountAgreementRate: stats(standardVolumeMintHours
        .map((row) => row.exactIdentityAmountAgreementRate), 6),
      tradeCountRelativeDelta: stats(mintHours.map((row) => row.tradeCountRelativeDelta), 6),
      solVolumeRelativeDelta: stats(standardVolumeMintHours.map((row) => row.solVolumeRelativeDelta), 6),
      curveAbsoluteDelta: stats(curveComparisons.map((row) => row.absoluteDelta), 6),
      curveSignedDelta: stats(curveComparisons.map((row) => row.signedDelta), 6),
      curveMatchAgeMs: stats(curveComparisons.map((row) => row.ageMs), 0),
      discoveryHeliusMinusPumpPortalMs: discoveryStats
    },
    traderIdentityDisagreementCohort: traderIdentityDisagreements,
    diagnostics: {
      websocketCreditEstimate: creditEstimate,
      boundedReconnectLifecycle: {
        everyConnectionAcknowledged,
        boundedReconnects,
        measuredTransportGaps,
        boundedTransportGaps,
        activeTransportGaps,
        unexpectedDisconnects: state.heliusLifecycle.unexpectedDisconnects,
        maximumUnexpectedReconnects,
        gapDuration: gapDurationStats,
        maximumSingleTransportGapMs: PREREGISTERED.maximumSingleTransportGapMs,
        cumulativeTransportGapMs:
          state.heliusLifecycle.transportGapDurationsMs.reduce((sum, value) => sum + value, 0),
        maximumCumulativeTransportGapMs
      },
      portalCoverageWindowSourceCounts: portalCoverage.sourceCounts,
      buyRatioAbsoluteDelta: stats(mintHours.map((row) => {
        if (!Number.isFinite(row.heliusBuyRatio) || !Number.isFinite(row.pumpPortalBuyRatio)) return null;
        return Math.abs(row.heliusBuyRatio - row.pumpPortalBuyRatio);
      }), 6),
      uniqueBuyerRelativeDelta: stats(mintHours.map((row) => relativeDelta(
        row.heliusUniqueBuyers,
        row.pumpPortalUniqueBuyers
      )), 6),
      curveOutlierAutopsy: {
        count: curveOutliers.length,
        uniqueMints: new Set(curveOutliers.map((row) => row.mint)).size,
        positiveSignedDelta: curveOutliers.filter((row) => row.signedDelta > 0).length,
        negativeSignedDelta: curveOutliers.filter((row) => row.signedDelta < 0).length,
        matchAgeMs: stats(curveOutliers.map((row) => row.ageMs), 0),
        absoluteDelta: stats(curveOutliers.map((row) => row.absoluteDelta), 6),
        interpretation: 'Diagnostic only. Large deltas inside the causal window may reflect intervening burst trades; they do not alter the frozen aggregate curve gate.'
      },
      processedForkRisk: {
        commitment: state.sessionStarted?.heliusPumpfunShadowPlan?.commitment || null,
        signatureOverlapIsDiagnosticOnly: true,
        heliusSignaturesAbsentFromPumpPortal: Math.max(0, heliusSignatures.size - signatureOverlap),
        comparatorCoverageCaveat: 'PumpPortal may be targeted; absent signatures do not by themselves prove a dropped fork.'
      }
    },
    worstMintHours: [...mintHours]
      .sort((a, b) => (a.portalTradeIdentityRecall ?? 1) - (b.portalTradeIdentityRecall ?? 1))
      .slice(0, 25),
    worstStandardVolumeMintHours: [...standardVolumeMintHours]
      .sort((a, b) => (b.solVolumeRelativeDelta || 0) - (a.solVolumeRelativeDelta || 0))
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
  buildPortalCoverage,
  buildReport,
  isSolQuoted,
  solAmountOf,
  collectEvents,
  createState,
  inCoverage,
  ingestEvent,
  latestAtOrBefore,
  mergeIntervals,
  nearestByTime,
  receiptTimeMs,
  relativeDelta,
  stats,
  tradeIdentity,
  timestampMs
};
