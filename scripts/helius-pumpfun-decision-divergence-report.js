#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { forEachJsonlSync } = require('./lib/jsonl');
const {
  marketInputTelemetryComplete,
  marketInputTelemetryMissingFields
} = require('../src/lib/helius-decision-shadow-comparability');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const PREREG_PATH = path.join(ROOT, 'data', 'strategy-preregistrations', 'helius-decision-divergence-v11.json');
const PARITY_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-shadow-parity-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-decision-divergence');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-decision-divergence-latest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function loadPreregistration(filePath = PREREG_PATH, ancestors = new Set()) {
  const resolvedPath = path.resolve(filePath);
  if (ancestors.has(resolvedPath)) {
    throw new Error(`Helius decision preregistration inheritance cycle: ${resolvedPath}`);
  }
  const extension = readJson(filePath);
  if (!extension.extends) return extension;
  const basePath = path.resolve(ROOT, extension.extends);
  const baseBytes = fs.readFileSync(basePath);
  const actualHash = crypto.createHash('sha256').update(baseBytes).digest('hex');
  if (actualHash !== extension.basePreregistrationSha256) {
    throw new Error(`Helius decision preregistration base hash mismatch: ${extension.extends}`);
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(resolvedPath);
  const base = loadPreregistration(basePath, nextAncestors);
  return {
    ...base,
    ...extension,
    basePreregistration: {
      path: extension.extends,
      sha256: actualHash
    },
    preregistrationInheritance: [
      ...(base.preregistrationInheritance || []),
      {
        id: readJson(basePath).id || null,
        path: extension.extends,
        sha256: actualHash
      }
    ]
  };
}

function latestTelemetryPath() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => ({ filePath: path.join(LOG_DIR, name), mtimeMs: fs.statSync(path.join(LOG_DIR, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath || null;
}

function parseCli(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--telemetry');
  return { telemetryPath: index >= 0 ? path.resolve(argv[index + 1]) : latestTelemetryPath() };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function stats(values = []) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, mean: null };
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  return {
    count: sorted.length,
    min: sorted[0],
    median: quantile(0.5),
    p90: quantile(0.9),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  };
}

function ageBucket(value) {
  const ageMs = Number(value);
  if (!Number.isFinite(ageMs)) return 'MISSING';
  if (ageMs <= 1000) return 'LTE_1000_MS';
  if (ageMs <= 2000) return 'GT_1000_TO_2000_MS';
  if (ageMs <= 5000) return 'GT_2000_TO_5000_MS';
  if (ageMs <= 15000) return 'GT_5000_TO_15000_MS';
  return 'GT_15000_MS';
}

function strictAgeBucket(value) {
  const ageMs = Number(value);
  if (!Number.isFinite(ageMs)) return 'MISSING';
  if (ageMs <= 100) return 'LTE_100_MS';
  if (ageMs <= 500) return 'GT_100_TO_500_MS';
  if (ageMs <= 1000) return 'GT_500_TO_1000_MS';
  return 'GT_1000_MS';
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value ?? null;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  );
}

function fieldDiff(actual, shadow, prefix = '') {
  const left = actual && typeof actual === 'object' ? actual : {};
  const right = shadow && typeof shadow === 'object' ? shadow : {};
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const rows = [];
  for (const key of keys) {
    const jsonPath = prefix ? `${prefix}.${key}` : key;
    const actualValue = left[key];
    const shadowValue = right[key];
    const bothObjects = actualValue && shadowValue
      && typeof actualValue === 'object' && typeof shadowValue === 'object'
      && !Array.isArray(actualValue) && !Array.isArray(shadowValue);
    if (bothObjects) {
      rows.push(...fieldDiff(actualValue, shadowValue, jsonPath));
      continue;
    }
    if (JSON.stringify(stableValue(actualValue)) !== JSON.stringify(stableValue(shadowValue))) {
      rows.push({
        jsonPath,
        actual: actualValue ?? null,
        shadow: shadowValue ?? null
      });
    }
  }
  return rows;
}

function withoutMarketProvenance(inputs = {}) {
  const market = { ...(inputs.market || {}) };
  delete market.curveProgressSource;
  delete market.sniperWalletCountSource;
  delete market.sniperWindowAnchoredAtFirstObservation;
  delete market.sniperWindowAnchorAtMs;
  delete market.sniperWindowAnchorKind;
  delete market.sniperWindowMs;
  return { ...inputs, market };
}

function marketProvenance(inputs = {}) {
  const market = inputs.market || {};
  return {
    curveProgressSource: market.curveProgressSource || null,
    sniperWalletCountSource: market.sniperWalletCountSource || null,
    sniperWindowAnchoredAtFirstObservation:
      market.sniperWindowAnchoredAtFirstObservation === true,
    sniperWindowAnchorAtMs: market.sniperWindowAnchorAtMs ?? null,
    sniperWindowAnchorKind: market.sniperWindowAnchorKind || null,
    sniperWindowMs: market.sniperWindowMs ?? null
  };
}

function hasOwn(row, key) {
  return Object.prototype.hasOwnProperty.call(row || {}, key);
}

function hasFiniteNumber(value) {
  return value !== null
    && value !== undefined
    && value !== ''
    && Number.isFinite(Number(value));
}

function baselineControlInvariantHolds(row = {}) {
  if (!hasOwn(row, 'shadowBaselineAnchorHeldConstant')) return false;
  if (row.baselineControlConsumed !== true) return false;
  if (row.baselineControlCaptured !== true || row.baselineControlValid !== true) return false;
  if (row.shadowBaselineAnchorHeldConstant !== true || row.shadowBaselineMatchesControl !== true) return false;
  if (row.baselineControlSelected === true) {
    return typeof row.baselineControlAt === 'string'
      && row.baselineControlAt.length > 0
      && row.shadowBaselineAt === row.baselineControlAt
      && hasFiniteNumber(row.baselineControlCurveProgress)
      && hasFiniteNumber(row.shadowBaselineCurveProgress)
      && Number(row.shadowBaselineCurveProgress) === Number(row.baselineControlCurveProgress)
      && hasFiniteNumber(row.baselineAnchorSkewMs)
      && Number(row.baselineAnchorSkewMs) === 0
      && hasFiniteNumber(row.baselineCurveProgressSkew)
      && Number(row.baselineCurveProgressSkew) === 0;
  }
  return row.baselineControlSelected === false
    && (row.baselineControlAt === null || row.baselineControlAt === undefined)
    && (row.shadowBaselineAt === null || row.shadowBaselineAt === undefined)
    && !hasFiniteNumber(row.baselineControlCurveProgress)
    && !hasFiniteNumber(row.shadowBaselineCurveProgress)
    && (row.baselineAnchorSkewMs === null || row.baselineAnchorSkewMs === undefined)
    && (row.baselineCurveProgressSkew === null || row.baselineCurveProgressSkew === undefined);
}

function prewarmTelemetryComplete(row = {}) {
  if (row.accountVerifierSubscribed !== true) return true;
  if (
    typeof row.accountVerifierComparisonTrigger !== 'string'
    || row.accountVerifierComparisonTrigger.length === 0
  ) return false;
  if (row.accountVerifierPrewarmed === true) {
    return typeof row.accountVerifierPrewarmTriggerReason === 'string'
      && row.accountVerifierPrewarmTriggerReason.length > 0
      && Array.isArray(row.accountVerifierPrewarmTriggerReasons)
      && row.accountVerifierPrewarmTriggerReasons.length > 0
      && row.accountVerifierPrewarmTriggerReasons.every(
        (reason) => typeof reason === 'string' && reason.length > 0
      )
      && row.accountVerifierPrewarmTriggerReasons[0]
        === row.accountVerifierPrewarmTriggerReason
      && row.accountVerifierPrewarmToComparisonPath === 'PREWARM_THEN_COMPARISON'
      && hasFiniteNumber(row.accountVerifierPrewarmLeadMs);
  }
  return row.accountVerifierPrewarmToComparisonPath === 'DIRECT_COMPARISON_SUBSCRIPTION';
}

function agreementByStateAge(rows = []) {
  return Object.entries(
    rows.reduce((groups, row) => {
      const bucket = strictAgeBucket(row.bestAvailableStateAgeMs ?? row.shadowStateAgeMs);
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(row);
      return groups;
    }, {})
  ).map(([bucket, group]) => {
    const comparable = group.filter((row) => row.comparable === true);
    return {
      bucket,
      evaluations: group.length,
      comparable: comparable.length,
      actionMatches: comparable.filter((row) => row.actionAgreement === true).length,
      actionAgreementRate: ratio(
        comparable.filter((row) => row.actionAgreement === true).length,
        comparable.length
      ),
      stateSources: countBy(group, (row) => row.bestAvailableStateSource || row.shadowCurveStateSource)
    };
  });
}

function offlineComparabilityByBound(rows = [], bounds = [1000, 2000, 3000]) {
  return bounds.map((boundMs) => {
    const available = rows.filter((row) => {
      const ageMs = Number(row.bestAvailableStateAgeMs ?? row.shadowStateAgeMs);
      return Number.isFinite(ageMs) && ageMs <= boundMs;
    }).length;
    return {
      boundMs,
      evaluations: rows.length,
      stateAvailableWithinBound: available,
      coverageRate: ratio(available, rows.length),
      note: 'Availability-only diagnostic; actions are not retroactively rescored outside the frozen 1000 ms comparator.'
    };
  });
}

function executedGuardOverrideFamily(row = {}, side = 'actual') {
  const explicitKey = side === 'shadow'
    ? 'shadowGuardOverrideFamily'
    : 'actualGuardOverrideFamily';
  if (row[explicitKey] !== null && row[explicitKey] !== undefined) {
    return row[explicitKey];
  }
  const gateKey = side === 'shadow'
    ? 'shadowGateGuardOverride'
    : 'actualGateGuardOverride';
  if (Object.prototype.hasOwnProperty.call(row, gateKey)) {
    return row[gateKey] ?? 'NO_OVERRIDE';
  }
  const legacyKey = side === 'shadow' ? 'shadowPresetFamily' : 'actualPresetFamily';
  return row[legacyKey] ?? 'UNKNOWN';
}

const DEFAULT_ENTRY_MISMATCH_CAUSE_PRIORITY = Object.freeze([
  'MISSING_PAIRED_EVALUATION',
  'EVALUATED_PRESET_MISMATCH',
  'PRESET_FAMILY_MISMATCH',
  'GUARD_ELIGIBILITY_MISMATCH',
  'GUARD_ALLOW_LIST_MISMATCH',
  'BASELINE_ANCHOR_MISMATCH',
  'WALLET_IDENTITY_COVERAGE_MISMATCH',
  'SNIPER_ANCHOR_DEFINITION_MISMATCH',
  'RESIDUAL_PROVIDER_STATE_MISMATCH'
]);

const WALLET_IDENTITY_INPUT_PATHS = new Set([
  'market.uniqueBuyerCount',
  'market.uniqueBuyerCountCaptured'
]);

const SNIPER_INPUT_PATHS = new Set([
  'market.sniperWalletCount',
  'market.sniperWalletCountCaptured'
]);

const SNIPER_PROVENANCE_PATHS = new Set([
  'sniperWalletCountSource',
  'sniperWindowAnchoredAtFirstObservation',
  'sniperWindowAnchorAtMs',
  'sniperWindowAnchorKind',
  'sniperWindowMs'
]);

function mismatchContributingCauses({ evaluation, row, guardInputDiff, guardInputProvenanceDiff }) {
  if (!evaluation) return ['MISSING_PAIRED_EVALUATION'];
  const causes = [];
  if (evaluation.actualEvaluatedPreset !== evaluation.shadowEvaluatedPreset) {
    causes.push('EVALUATED_PRESET_MISMATCH');
  }
  if (executedGuardOverrideFamily(row, 'actual') !== executedGuardOverrideFamily(row, 'shadow')) {
    causes.push('PRESET_FAMILY_MISMATCH');
  }
  if (
    evaluation.actualGuardOverrideEligibilityState
    !== evaluation.shadowGuardOverrideEligibilityState
  ) causes.push('GUARD_ELIGIBILITY_MISMATCH');
  if (evaluation.guardOverrideAllowListAgreement === false) {
    causes.push('GUARD_ALLOW_LIST_MISMATCH');
  }

  const baselineMismatch = hasOwn(evaluation, 'shadowBaselineAnchorHeldConstant')
    && !baselineControlInvariantHolds(evaluation);
  if (baselineMismatch) causes.push('BASELINE_ANCHOR_MISMATCH');

  const walletIdentityMismatch = evaluation.walletComparison?.featureAgreement === false
    || guardInputDiff.some((diff) => WALLET_IDENTITY_INPUT_PATHS.has(diff.jsonPath));
  if (walletIdentityMismatch) causes.push('WALLET_IDENTITY_COVERAGE_MISMATCH');

  const sniperProvenanceMismatch = guardInputProvenanceDiff.some(
    (diff) => SNIPER_PROVENANCE_PATHS.has(diff.jsonPath)
  );
  const sniperCountMismatch = guardInputDiff.some(
    (diff) => SNIPER_INPUT_PATHS.has(diff.jsonPath)
  );
  const sniperAnchorDefinitionMismatch = sniperCountMismatch && sniperProvenanceMismatch;
  if (sniperAnchorDefinitionMismatch) causes.push('SNIPER_ANCHOR_DEFINITION_MISMATCH');

  const residualInputMismatch = guardInputDiff.some((diff) => (
    !WALLET_IDENTITY_INPUT_PATHS.has(diff.jsonPath)
    && !(sniperAnchorDefinitionMismatch && SNIPER_INPUT_PATHS.has(diff.jsonPath))
  ));
  if (residualInputMismatch) causes.push('RESIDUAL_PROVIDER_STATE_MISMATCH');
  return [...new Set(causes)];
}

function buildEntryMismatchAttribution(evaluations = [], executed = [], preregistration = {}) {
  const evaluationByPair = new Map(
    evaluations.filter((row) => row.pairedDecisionKey)
      .map((row) => [row.pairedDecisionKey, row])
  );
  const mismatches = executed.filter((row) => (
    row.action === 'ENTRY'
    && row.comparable === true
    && row.guardOverridePathAgreement !== false
    && row.actionAgreement !== true
  )).map((row) => {
    const evaluation = evaluationByPair.get(row.pairedDecisionKey) || null;
    const guardInputDiff = evaluation
      ? fieldDiff(
        withoutMarketProvenance(evaluation.actualGuardFamilyInputs),
        withoutMarketProvenance(evaluation.shadowGuardFamilyInputs)
      )
      : [];
    const guardInputProvenanceDiff = evaluation
      ? fieldDiff(
        marketProvenance(evaluation.actualGuardFamilyInputs),
        marketProvenance(evaluation.shadowGuardFamilyInputs)
      )
      : [];
    const contributingCauses = mismatchContributingCauses({
      evaluation,
      row,
      guardInputDiff,
      guardInputProvenanceDiff
    });
    const causePriority = Array.isArray(
      preregistration.entryMismatchAttribution?.causePriority
    )
      ? preregistration.entryMismatchAttribution.causePriority
      : DEFAULT_ENTRY_MISMATCH_CAUSE_PRIORITY;
    const cause = causePriority.find((candidate) => contributingCauses.includes(candidate))
      || contributingCauses[0]
      || 'UNATTRIBUTED';
    const allowed = preregistration.entryMismatchAttribution?.allowedAttributedCauses || [];
    return {
      pairedDecisionKey: row.pairedDecisionKey || null,
      mint: row.mint || evaluation?.mint || null,
      preset: row.preset || evaluation?.preset || null,
      stateAgeMs: row.bestAvailableStateAgeMs ?? row.shadowStateAgeMs ?? null,
      stateSource: row.bestAvailableStateSource || row.shadowCurveStateSource || null,
      actualReason: row.actualReason || evaluation?.actualReason || null,
      shadowReason: row.shadowReason || evaluation?.shadowReason || null,
      positionContextPolicy: row.positionContextPolicy || null,
      independentShadowPositionStateAvailable: row.independentShadowPositionStateAvailable === true,
      cause,
      contributingCauses,
      multipleContributingCauses: contributingCauses.length > 1,
      attributed: allowed.includes(cause),
      guardInputDiff,
      guardInputProvenanceDiff
    };
  });
  const comparableExecutedEntries = executed.filter(
    (row) => (
      row.action === 'ENTRY'
      && row.comparable === true
      && row.guardOverridePathAgreement !== false
    )
  ).length;
  const minimumMismatchesRequired = Math.max(
    1,
    Number(preregistration.entryMismatchAttribution?.minimumMismatches || 1)
  );
  return {
    observedExecutedEntries: executed.filter((row) => row.action === 'ENTRY').length,
    comparableExecutedEntries,
    mismatches: mismatches.length,
    minimumMismatchesRequired,
    attributedMismatches: mismatches.filter((row) => row.attributed).length,
    unattributedMismatches: mismatches.filter((row) => !row.attributed).length,
    byCause: countBy(mismatches, (row) => row.cause),
    byContributingCause: mismatches.reduce((counts, row) => {
      for (const cause of row.contributingCauses) {
        counts[cause] = (counts[cause] || 0) + 1;
      }
      return counts;
    }, {}),
    mismatchesWithMultipleContributingCauses: mismatches.filter(
      (row) => row.multipleContributingCauses
    ).length,
    allMismatchesAttributed: mismatches.length >= minimumMismatchesRequired
      && mismatches.every((row) => row.attributed),
    rows: mismatches
  };
}

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildEntryConfusionMatrix(rows = []) {
  const comparable = rows.filter((row) => (
    row.comparable === true
    && ['WOULD_ENTER', 'WOULD_SKIP'].includes(row.actualAction)
    && ['WOULD_ENTER', 'WOULD_SKIP'].includes(row.shadowAction)
  ));
  const truePositive = comparable.filter(
    (row) => row.actualAction === 'WOULD_ENTER' && row.shadowAction === 'WOULD_ENTER'
  ).length;
  const falsePositive = comparable.filter(
    (row) => row.actualAction === 'WOULD_SKIP' && row.shadowAction === 'WOULD_ENTER'
  ).length;
  const falseNegative = comparable.filter(
    (row) => row.actualAction === 'WOULD_ENTER' && row.shadowAction === 'WOULD_SKIP'
  ).length;
  const trueNegative = comparable.filter(
    (row) => row.actualAction === 'WOULD_SKIP' && row.shadowAction === 'WOULD_SKIP'
  ).length;
  return {
    population: comparable.length,
    actualEnterShadowEnter: truePositive,
    actualSkipShadowEnter: falsePositive,
    actualEnterShadowSkip: falseNegative,
    actualSkipShadowSkip: trueNegative,
    shadowEntryPrecision: ratio(truePositive, truePositive + falsePositive),
    shadowEntryRecall: ratio(truePositive, truePositive + falseNegative),
    shadowSkipSpecificity: ratio(trueNegative, trueNegative + falsePositive),
    note: 'PumpPortal actual action is the report-only reference label; this matrix is not evidence for execution.'
  };
}

function buildExecutedPnlAttribution(rows = [], validRun = false) {
  const sorted = rows.slice().sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const pendingEntries = new Map();
  const joined = [];
  for (const row of sorted) {
    const key = row.positionKey || `${row.preset || 'unknown'}:${row.mint || 'unknown'}`;
    if (row.action === 'ENTRY') {
      const queue = pendingEntries.get(key) || [];
      queue.push(row);
      pendingEntries.set(key, queue);
      continue;
    }
    if (row.action !== 'EXIT') continue;
    const queue = pendingEntries.get(key) || [];
    const entry = queue.shift();
    if (queue.length) pendingEntries.set(key, queue);
    else pendingEntries.delete(key);
    if (!entry || !Number.isFinite(Number(row.actualPnlSol))) continue;
    joined.push({
      positionKey: key,
      mint: row.mint || entry.mint || null,
      preset: row.preset || entry.preset || null,
      shadowEntryAction: entry.shadowAction || null,
      entryComparable: entry.comparable === true,
      actualPnlSol: Number(row.actualPnlSol)
    });
  }
  const eligible = joined.filter((row) => row.entryComparable);
  const shadowEnter = eligible.filter((row) => row.shadowEntryAction === 'ENTRY');
  const shadowSkip = eligible.filter((row) => row.shadowEntryAction === 'NO_ENTRY');
  const summarize = (group) => ({
    positions: group.length,
    actualPnlSol: validRun
      ? group.reduce((sum, row) => sum + row.actualPnlSol, 0)
      : null
  });
  return {
    available: validRun,
    validRunRequired: true,
    evidenceLabel: 'NOT_EVIDENCE_FOR_EXECUTION',
    unavailableReason: validRun ? null : 'RUN_INVALID_FOR_PNL_ATTRIBUTION',
    joinedActualPositions: joined.length,
    comparableJoinedActualPositions: eligible.length,
    shadowWouldEnter: summarize(shadowEnter),
    shadowWouldSkip: summarize(shadowSkip),
    note: validRun
      ? 'Actual paper PnL is grouped by the shadow entry decision for diagnostic attribution only.'
      : 'PnL values are withheld because the run failed frozen validity checks.'
  };
}

function createState() {
  return {
    sessionStarted: null,
    sessionStopped: null,
    budgetReached: null,
    evaluations: [],
    executedActions: [],
    accountVerifierMaxSubscriptionSkips: [],
    accountVerifierPrewarmCapacitySkips: [],
    heliusQueueFailures: []
  };
}

function collectEvent(state, event) {
  if (event.type === 'session.started') state.sessionStarted = { timestamp: event.timestamp, payload: event.payload || {} };
  else if (event.type === 'session.stopping' || event.type === 'session.stopped') {
    state.sessionStopped = { timestamp: event.timestamp, payload: event.payload || {} };
  } else if (event.type === 'provider.pumpportal.metered_budget_reached') {
    state.budgetReached = { timestamp: event.timestamp, payload: event.payload || {} };
  } else if (
    event.type === 'finalist_account_verifier.skipped'
    && event.payload?.reason === 'MAX_SUBSCRIPTIONS'
  ) {
    state.accountVerifierMaxSubscriptionSkips.push({ timestamp: event.timestamp, ...(event.payload || {}) });
  } else if (
    event.type === 'finalist_account_verifier.skipped'
    && event.payload?.reason === 'MAX_SUBSCRIPTIONS_PREWARM'
  ) {
    state.accountVerifierPrewarmCapacitySkips.push({ timestamp: event.timestamp, ...(event.payload || {}) });
  } else if (
    event.type === 'provider.helius_pumpfun.shadow_event_queue_overflow'
    || event.type === 'provider.helius_pumpfun.shadow_event_queue_stop_timeout'
  ) {
    state.heliusQueueFailures.push({ type: event.type, timestamp: event.timestamp, ...(event.payload || {}) });
  } else if (event.type === 'helius_pumpfun.decision_shadow.evaluation') {
    state.evaluations.push({ timestamp: event.timestamp, ...(event.payload || {}) });
  } else if (event.type === 'helius_pumpfun.decision_shadow.executed_action') {
    state.executedActions.push({ timestamp: event.timestamp, ...(event.payload || {}) });
  }
  return state;
}

function collect(events = []) {
  const state = createState();
  for (const event of events) collectEvent(state, event);
  return state;
}

function buildReport({ state, preregistration, parity = {}, sourceTelemetry = null }) {
  const evaluations = state.evaluations.filter((row) => row.preregistrationId === preregistration.id);
  const comparable = evaluations.filter((row) => row.comparable === true);
  const actionMatches = comparable.filter((row) => row.actionAgreement === true);
  const reasonMatches = comparable.filter((row) => row.reasonAgreement === true);
  const walletCharacterized = comparable.filter((row) => row.walletComparison?.portal && row.walletComparison?.helius);
  const walletFeatureMatches = walletCharacterized.filter((row) => row.walletComparison.featureAgreement === true);
  const trackedAddressMatches = walletCharacterized.filter((row) => row.walletComparison.trackedAddressAgreement === true);
  const walletTouchMatches = walletCharacterized.filter((row) => row.walletComparison.touchedAgreement === true);
  const walletShadowTouchMatches = walletCharacterized.filter(
    (row) => row.walletComparison.shadowTouchedAgreement === true
  );
  const walletUntrustedTouchMatches = walletCharacterized.filter(
    (row) => row.walletComparison.untrustedTouchedAgreement === true
  );
  const accountEnriched = comparable.filter((row) => row.shadowAccountEnriched === true);
  const verifierSubscribed = evaluations.filter((row) => row.accountVerifierSubscribed === true);
  const verifierUpdated = evaluations.filter((row) => row.accountVerifierHasUpdate === true);
  const prewarmed = evaluations.filter((row) => row.accountVerifierPrewarmed === true);
  const prewarmedComparable = prewarmed.filter((row) => row.comparable === true);
  const notPrewarmed = evaluations.filter((row) => row.accountVerifierPrewarmed !== true);
  const notPrewarmedComparable = notPrewarmed.filter((row) => row.comparable === true);
  const updatedBeforeComparison = evaluations.filter(
    (row) => row.accountVerifierFirstUpdateBeforeComparison === true
  );
  const prewarmTelemetryCompleteEvaluations = evaluations.filter(prewarmTelemetryComplete);
  const baselineInvariantEvaluations = comparable.filter(baselineControlInvariantHolds);
  const baselineRequiredFields = preregistration.baselineControl?.requiredComparableFields
    || ['shadowBaselineAnchorHeldConstant'];
  const baselineFieldsPresentEvaluations = comparable.filter(
    (row) => baselineRequiredFields.every((field) => hasOwn(row, field))
  );
  const aliasedWalletTrades = comparable.reduce(
    (sum, row) => sum + Number(row.walletComparison?.helius?.portalSignatureAliasTradeCount || 0),
    0
  );
  const rawHeliusWalletTrades = comparable.reduce(
    (sum, row) => sum + Number(row.walletComparison?.helius?.heliusEventUserTradeCount || 0),
    0
  );
  const divergences = comparable.filter((row) => row.actionAgreement !== true);
  const executed = state.executedActions.filter((row) => row.preregistrationId === preregistration.id);
  const comparableExecuted = executed.filter((row) => (
    row.comparable === true
    && (row.action !== 'ENTRY' || row.guardOverridePathAgreement !== false)
  ));
  const executedMatches = comparableExecuted.filter((row) => row.actionAgreement === true);
  const entryActions = comparableExecuted.filter((row) => row.action === 'ENTRY');
  const exitActions = comparableExecuted.filter((row) => row.action === 'EXIT');
  const crossGuardOverridePathEntries = executed.filter((row) => (
    row.action === 'ENTRY'
    && (
      row.guardOverridePathAgreement === false
      || row.guardOverridePathComparison === 'CROSS_GUARD_OVERRIDE_PATH'
      || row.unavailableReason === 'COUNTERFACTUAL_GUARD_PATH_MISMATCH'
    )
  ));
  const explicitlyExcludedCrossGuardOverridePathEntries =
    crossGuardOverridePathEntries.filter((row) => (
      row.comparable !== true
      && row.unavailableReason === 'COUNTERFACTUAL_GUARD_PATH_MISMATCH'
    ));
  const diagnosticChecks = {
    crossGuardOverridePathEntriesExplicitlyExcluded:
      explicitlyExcludedCrossGuardOverridePathEntries.length
        === crossGuardOverridePathEntries.length
  };
  const entryActionMatches = entryActions.filter((row) => row.actionAgreement === true);
  const exitActionMatches = exitActions.filter((row) => row.actionAgreement === true);
  const entryMismatchAttribution = buildEntryMismatchAttribution(
    evaluations,
    executed,
    preregistration
  );
  const sourceMatches = !sourceTelemetry || parity.sourceTelemetry === sourceTelemetry;
  const unavailableEvaluations = evaluations.filter((row) => row.comparable !== true);
  const actualMarketInputIncompleteEvaluations = evaluations.filter(
    (row) => !marketInputTelemetryComplete(row.actualGuardFamilyInputs)
  );
  const shadowMarketInputIncompleteEvaluations = evaluations.filter(
    (row) => !marketInputTelemetryComplete(row.shadowGuardFamilyInputs)
  );
  const baselineNotConsumedEvaluations = evaluations.filter(
    (row) => row.unavailableReason === preregistration.baselineControl?.notConsumedReason
  );
  const comparableWithCompleteMarketInputTelemetry = comparable.filter((row) => (
    marketInputTelemetryComplete(row.actualGuardFamilyInputs)
    && marketInputTelemetryComplete(row.shadowGuardFamilyInputs)
  ));
  const plan = state.sessionStarted?.payload?.heliusPumpfunShadowPlan || {};
  const paidTapePlan = state.sessionStarted?.payload?.pumpPortalPaidTapePlan || {};
  const heliusQueueStats = state.sessionStopped?.payload?.stats?.heliusPumpfunShadow || {};
  const heliusQueueStatsAvailable = [
    heliusQueueStats.eventQueueEnqueued,
    heliusQueueStats.eventQueueProcessed,
    heliusQueueStats.eventQueueDropped,
    heliusQueueStats.eventQueueDepth,
    heliusQueueStats.eventQueueMaxDepth,
    heliusQueueStats.eventQueueMaxSize,
    heliusQueueStats.eventQueueBatchSize
  ].every((value) => Number.isFinite(Number(value)));
  const heliusQueueEnqueued = Number(heliusQueueStats.eventQueueEnqueued || 0);
  const heliusQueueProcessed = Number(heliusQueueStats.eventQueueProcessed || 0);
  const heliusQueueDropped = Number(heliusQueueStats.eventQueueDropped || 0);
  const heliusQueueHandlerErrors = Number(heliusQueueStats.eventQueueHandlerErrors || 0);
  const heliusQueueDepth = Number(heliusQueueStats.eventQueueDepth || 0);
  const heliusQueueMaxDepth = Number(heliusQueueStats.eventQueueMaxDepth || 0);
  const heliusQueueMaxSize = Number(heliusQueueStats.eventQueueMaxSize || 0);
  const startMs = Date.parse(state.sessionStarted?.timestamp || '');
  const budgetReachedMs = Date.parse(state.budgetReached?.timestamp || '');
  const budgetReachedAfterMinutes = Number.isFinite(startMs) && Number.isFinite(budgetReachedMs)
    ? (budgetReachedMs - startMs) / 60_000
    : null;
  const effectiveRegistrationAt = preregistration.amendedBeforeFirstComparableRunAt
    || preregistration.frozenAt;
  const checks = {
    postRegistration: Number.isFinite(startMs) && startMs > Date.parse(effectiveRegistrationAt),
    paperMode: state.sessionStarted?.payload?.mode === 'PAPER',
    decisionShadowEnabled: plan.decisionShadowEnabled === true,
    correctPreregistrationPlan: plan.decisionShadowPreregistrationId === preregistration.id,
    correctGateDecisionComparator: plan.gateDecisionComparator === preregistration.gateDecisionComparator.name,
    correctExecutedActionComparator: plan.executedActionComparator === preregistration.executedActionComparator.name,
    correctMarketInputSemantics: plan.decisionShadowMarketInputSemantics
      === preregistration.gateDecisionComparator.marketInputTelemetrySemantics,
    correctComparabilitySemantics: plan.decisionShadowComparabilitySemantics
      === preregistration.comparabilityPlanSemantics,
    correctMaximumStateAge: Number(plan.decisionShadowMaximumStateAgeMs) === preregistration.maximumShadowStateAgeMs,
    correctRecentTradeCap: Number(plan.decisionShadowRecentTradeCap) === preregistration.semanticAlignment.recentTradeCap,
    accountStateEnrichmentEnabled: plan.decisionShadowAccountStateEnrichment === 'finalist_account_verifier_latest_update',
    sufficientAccountVerifierCapacity: Number(plan.decisionShadowAccountVerifierMaxSubscriptions)
      >= preregistration.accountVerifierSelection.minimumMaxSubscriptions,
    correctAccountVerifierTtl: Number(plan.decisionShadowAccountVerifierTtlMs)
      === preregistration.accountVerifierSelection.requiredTtlMs,
    correctAccountVerifierSelectionTrigger: plan.decisionShadowAccountVerifierSelectionTrigger
      === preregistration.accountVerifierSelection.selectionTrigger,
    correctPrewarmPathSemantics: !preregistration.prewarmDiagnostics?.requiredForValidity
      || plan.decisionShadowPrewarmPathSemantics
        === preregistration.prewarmDiagnostics.planSemantics,
    accountVerifierPrewarmTelemetryComplete:
      !preregistration.prewarmDiagnostics?.requiredForValidity
      || prewarmTelemetryCompleteEvaluations.length === evaluations.length,
    baselineControlFieldsPresent: !preregistration.baselineControl?.requiredForValidity
      || baselineFieldsPresentEvaluations.length === comparable.length,
    baselineControlInvariant: !preregistration.baselineControl?.requiredForValidity
      || baselineInvariantEvaluations.length === comparable.length,
    noAccountVerifierCapacitySkips: state.accountVerifierMaxSubscriptionSkips.length === 0,
    heliusQueueStatsAvailable,
    noHeliusQueueDrops: state.heliusQueueFailures.length === 0
      && heliusQueueDropped === 0
      && heliusQueueStats.eventQueueStopDrainTimedOut !== true,
    heliusQueueDrainedCleanly: heliusQueueStatsAvailable
      && heliusQueueDepth === 0
      && heliusQueueHandlerErrors === 0
      && heliusQueueProcessed === heliusQueueEnqueued,
    correctHeliusQueueMaxSize: Number(plan.eventQueueMaxSize)
      === preregistration.burstControl.eventQueueMaxSize
      && Number(heliusQueueStats.eventQueueMaxSize)
        === preregistration.burstControl.eventQueueMaxSize,
    correctHeliusQueueBatchSize: Number(plan.eventQueueBatchSize)
      === preregistration.burstControl.eventQueueBatchSize
      && Number(heliusQueueStats.eventQueueBatchSize)
        === preregistration.burstControl.eventQueueBatchSize,
    walletIdentityAlignmentEnabled: plan.decisionShadowWalletIdentityAlignment === 'pumpportal_signature_alias_then_helius_event_user',
    correctWalletEvidenceWindow: plan.decisionShadowWalletEvidenceWindow
      === preregistration.semanticAlignment.walletEvidenceWindow,
    correctWalletEvidenceTradeCap: Number(plan.decisionShadowWalletEvidenceTradeCapPerMint)
      === preregistration.semanticAlignment.walletEvidenceTradeCapPerMint,
    correctPaidTapeSubscriptionMode: paidTapePlan.tradeSubscriptionMode === preregistration.paidTapePlan.tradeSubscriptionMode,
    correctPaidTapeBudget: Number(paidTapePlan.maxMeteredTradeEventsPerSession)
      === preregistration.paidTapePlan.maxMeteredTradeEventsPerSession,
    paidTapeCoverageDuration: budgetReachedAfterMinutes === null
      || budgetReachedAfterMinutes >= preregistration.paidTapePlan.minimumPaidTapeMinutesIfBudgetReached,
    strategyConsumptionDisabled: plan.strategyConsumptionEnabled === false,
    completedLifecycle: state.sessionStopped?.payload?.reason === 'SESSION_DURATION_EXCEEDED',
    sameTelemetryAsParity: sourceMatches,
    concurrentV5ParityPassed: parity.verdict === preregistration.concurrentRequirements.heliusV5ParityVerdict,
    cleanHeliusLifecycle: parity.checks?.cleanHeliusLifecycle === true,
    minimumComparableGateEvaluations: comparable.length >= preregistration.minimumComparableGateEvaluations,
    comparableEvaluationCoverage: ratio(comparable.length, evaluations.length)
      >= preregistration.minimumComparableEvaluationCoverageRate,
    gateActionAgreement: ratio(actionMatches.length, comparable.length) >= preregistration.minimumGateActionAgreementRate,
    walletDivergenceCharacterized: walletCharacterized.length === comparable.length,
    walletFeatureAgreement: ratio(walletFeatureMatches.length, walletCharacterized.length)
      >= preregistration.minimumWalletFeatureAgreementRate,
    trackedAddressAgreement: ratio(trackedAddressMatches.length, walletCharacterized.length)
      >= preregistration.minimumTrackedAddressAgreementRate,
    freshComparableGateState: comparable.every((row) => (
      Number.isFinite(Number(row.shadowStateAgeMs))
      && Number(row.shadowStateAgeMs) <= preregistration.maximumShadowStateAgeMs
    )),
    comparableMarketInputTelemetryComplete:
      comparableWithCompleteMarketInputTelemetry.length === comparable.length,
    comparableExecutedActionCoverage: ratio(comparableExecuted.length, executed.length)
      >= preregistration.minimumComparableExecutedActionCoverageRate,
    minimumExecutedEntries: entryActions.length >= preregistration.minimumExecutedEntries,
    minimumExecutedExits: exitActions.length >= preregistration.minimumExecutedExits,
    freshComparableExecutedState: comparableExecuted.every((row) => (
      Number.isFinite(Number(row.shadowStateAgeMs))
      && Number(row.shadowStateAgeMs) <= preregistration.maximumShadowStateAgeMs
    )),
    executedActionAgreement: ratio(executedMatches.length, comparableExecuted.length)
      === preregistration.executedActionAgreementRequired,
    minimumComparableExecutedEntriesForAttribution:
      entryMismatchAttribution.comparableExecutedEntries
        >= Number(
          preregistration.entryMismatchAttribution?.minimumComparableExecutedEntries
          ?? preregistration.minimumExecutedEntries
        ),
    minimumEntryMismatchesForAttribution:
      entryMismatchAttribution.mismatches
        >= Number(preregistration.entryMismatchAttribution?.minimumMismatches || 1),
    everyExecutedEntryMismatchAttributed: entryMismatchAttribution.allMismatchesAttributed
  };
  const validityChecks = [
    'postRegistration',
    'paperMode',
    'decisionShadowEnabled',
    'correctPreregistrationPlan',
    'correctGateDecisionComparator',
    'correctExecutedActionComparator',
    'correctMarketInputSemantics',
    'correctComparabilitySemantics',
    'correctMaximumStateAge',
    'correctRecentTradeCap',
    'accountStateEnrichmentEnabled',
    'sufficientAccountVerifierCapacity',
    'correctAccountVerifierTtl',
    'correctAccountVerifierSelectionTrigger',
    'correctPrewarmPathSemantics',
    'accountVerifierPrewarmTelemetryComplete',
    'baselineControlFieldsPresent',
    'baselineControlInvariant',
    'noAccountVerifierCapacitySkips',
    'heliusQueueStatsAvailable',
    'noHeliusQueueDrops',
    'heliusQueueDrainedCleanly',
    'correctHeliusQueueMaxSize',
    'correctHeliusQueueBatchSize',
    'walletIdentityAlignmentEnabled',
    'correctWalletEvidenceWindow',
    'correctWalletEvidenceTradeCap',
    'correctPaidTapeSubscriptionMode',
    'correctPaidTapeBudget',
    'paidTapeCoverageDuration',
    'strategyConsumptionDisabled',
    'completedLifecycle',
    'sameTelemetryAsParity',
    'concurrentV5ParityPassed',
    'cleanHeliusLifecycle',
    'comparableMarketInputTelemetryComplete'
  ];
  const validityPassed = validityChecks.every((key) => checks[key]);
  const attributionExperiment = preregistration.evaluationMode === 'entry_mismatch_attribution';
  const evidenceReady = attributionExperiment
    ? checks.minimumComparableExecutedEntriesForAttribution
      && checks.minimumExecutedExits
      && checks.minimumEntryMismatchesForAttribution
    : checks.minimumComparableGateEvaluations
      && checks.minimumExecutedEntries
      && checks.minimumExecutedExits;
  let verdict = preregistration.invalidVerdict;
  if (validityPassed) {
    verdict = !evidenceReady
      ? preregistration.insufficientVerdict
      : (
        attributionExperiment
          ? (checks.everyExecutedEntryMismatchAttributed
            ? preregistration.passVerdict
            : preregistration.failVerdict)
          : (Object.values(checks).every(Boolean)
            ? preregistration.passVerdict
            : preregistration.failVerdict)
      );
  }
  const divergenceByReason = divergences.reduce((counts, row) => {
    const key = `${row.actualReason || 'NONE'} -> ${row.shadowReason || 'NONE'}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const entryConfusionMatrix = buildEntryConfusionMatrix(comparable);
  const unavailableStateAges = unavailableEvaluations.map(
    (row) => row.bestAvailableStateAgeMs ?? row.shadowStateAgeMs
  );
  const unavailableStateAgeDiagnostics = {
    agesMs: stats(unavailableStateAges),
    histogram: countBy(unavailableEvaluations, (row) => (
      ageBucket(row.bestAvailableStateAgeMs ?? row.shadowStateAgeMs)
    )),
    sources: countBy(unavailableEvaluations, (row) => (
      row.bestAvailableStateSource || row.shadowCurveStateSource || 'UNKNOWN'
    )),
    byReason: countBy(unavailableEvaluations, (row) => row.unavailableReason || 'UNKNOWN')
  };
  const executedPnlAttribution = buildExecutedPnlAttribution(executed, validityPassed);
  const sniperWindowAnchorComparisons = comparable
    .map((row) => {
      const actualRaw = row.actualGuardFamilyInputs?.market?.sniperWindowAnchorAtMs;
      const shadowRaw = row.shadowGuardFamilyInputs?.market?.sniperWindowAnchorAtMs;
      if (
        actualRaw === null || actualRaw === undefined || actualRaw === ''
        || shadowRaw === null || shadowRaw === undefined || shadowRaw === ''
      ) return null;
      const actual = Number(actualRaw);
      const shadow = Number(shadowRaw);
      if (!Number.isFinite(actual) || !Number.isFinite(shadow)) return null;
      return {
        signedSkewMs: shadow - actual,
        absoluteSkewMs: Math.abs(shadow - actual)
      };
    })
    .filter(Boolean);
  return {
    generatedAt: new Date().toISOString(),
    sourceTelemetry,
    preregistration,
    verdict,
    validRun: validityPassed,
    checks,
    diagnosticChecks,
    counts: {
      evaluations: evaluations.length,
      comparableGateEvaluations: comparable.length,
      comparableGateEvaluationsWithCompleteMarketInputTelemetry:
        comparableWithCompleteMarketInputTelemetry.length,
      unavailableGateEvaluations: evaluations.length - comparable.length,
      actualMarketInputIncompleteEvaluations:
        actualMarketInputIncompleteEvaluations.length,
      shadowMarketInputIncompleteEvaluations:
        shadowMarketInputIncompleteEvaluations.length,
      baselineNotConsumedEvaluations: baselineNotConsumedEvaluations.length,
      gateActionMatches: actionMatches.length,
      gateActionDivergences: divergences.length,
      reasonMatches: reasonMatches.length,
      walletCharacterizedEvaluations: walletCharacterized.length,
      walletFeatureMatches: walletFeatureMatches.length,
      trackedAddressMatches: trackedAddressMatches.length,
      accountEnrichedGateEvaluations: accountEnriched.length,
      accountVerifierSubscribedEvaluations: verifierSubscribed.length,
      accountVerifierUpdatedEvaluations: verifierUpdated.length,
      accountVerifierPrewarmedEvaluations: prewarmed.length,
      accountVerifierPrewarmedComparableEvaluations: prewarmedComparable.length,
      accountVerifierNotPrewarmedEvaluations: notPrewarmed.length,
      accountVerifierNotPrewarmedComparableEvaluations: notPrewarmedComparable.length,
      accountVerifierUpdatedBeforeComparisonEvaluations: updatedBeforeComparison.length,
      accountVerifierMaxSubscriptionSkips: state.accountVerifierMaxSubscriptionSkips.length,
      accountVerifierPrewarmCapacitySkips: state.accountVerifierPrewarmCapacitySkips.length,
      heliusQueueFailures: state.heliusQueueFailures.length,
      portalSignatureAliasedWalletTrades: aliasedWalletTrades,
      rawHeliusEventUserWalletTrades: rawHeliusWalletTrades,
      executedActions: executed.length,
      comparableExecutedActions: comparableExecuted.length,
      unavailableExecutedActions: executed.length - comparableExecuted.length,
      executedActionMatches: executedMatches.length,
      observedExecutedEntries: executed.filter((row) => row.action === 'ENTRY').length,
      comparableExecutedEntries: entryActions.length,
      unavailableExecutedEntries: executed.filter((row) => (
        row.action === 'ENTRY'
        && !comparableExecuted.includes(row)
      )).length,
      observedExecutedExits: executed.filter((row) => row.action === 'EXIT').length,
      comparableExecutedExits: exitActions.length,
      unavailableExecutedExits: executed.filter((row) => (
        row.action === 'EXIT'
        && !comparableExecuted.includes(row)
      )).length,
      executedEntryMatches: entryActionMatches.length,
      executedExitMatches: exitActionMatches.length,
      crossGuardOverridePathEntries: crossGuardOverridePathEntries.length
    },
    agreement: {
      gateActionAgreementRate: ratio(actionMatches.length, comparable.length),
      comparableEvaluationCoverageRate: ratio(comparable.length, evaluations.length),
      prewarmedComparableEvaluationCoverageRate: ratio(prewarmedComparable.length, prewarmed.length),
      notPrewarmedComparableEvaluationCoverageRate: ratio(notPrewarmedComparable.length, notPrewarmed.length),
      accountUpdateBeforeComparisonRate: ratio(updatedBeforeComparison.length, evaluations.length),
      gateReasonAgreementRate: ratio(reasonMatches.length, comparable.length),
      walletFeatureAgreementRate: ratio(walletFeatureMatches.length, walletCharacterized.length),
      walletTouchedAgreementRate: ratio(walletTouchMatches.length, walletCharacterized.length),
      walletShadowTouchedAgreementRate: ratio(walletShadowTouchMatches.length, walletCharacterized.length),
      walletUntrustedTouchedAgreementRate: ratio(walletUntrustedTouchMatches.length, walletCharacterized.length),
      trackedAddressAgreementRate: ratio(trackedAddressMatches.length, walletCharacterized.length),
      executedActionAgreementRate: ratio(executedMatches.length, comparableExecuted.length),
      executedEntryAgreementRate: ratio(entryActionMatches.length, entryActions.length),
      executedExitAgreementRate: ratio(exitActionMatches.length, exitActions.length),
      comparableExecutedActionCoverageRate: ratio(comparableExecuted.length, executed.length),
      shadowStateAgeMs: stats(comparable.map((row) => row.shadowStateAgeMs))
    },
    entryConfusionMatrix,
    entryMismatchAttribution,
    crossGuardOverridePathEntryDiagnostics: {
      observed: crossGuardOverridePathEntries.length,
      explicitlyExcludedFromComparable:
        explicitlyExcludedCrossGuardOverridePathEntries.length,
      allExplicitlyExcluded:
        diagnosticChecks.crossGuardOverridePathEntriesExplicitlyExcluded,
      byGuardFamilyPair: countBy(crossGuardOverridePathEntries, (row) => {
        const actualFamily = executedGuardOverrideFamily(row, 'actual');
        const shadowFamily = executedGuardOverrideFamily(row, 'shadow');
        return `${actualFamily} -> ${shadowFamily}`;
      }),
      rows: crossGuardOverridePathEntries.map((row) => ({
        timestamp: row.timestamp || null,
        mint: row.mint || null,
        preset: row.preset || null,
        actualPresetName: row.actualPresetName || row.preset || null,
        shadowPresetName: row.shadowPresetName || row.preset || null,
        actualGuardOverrideFamily: executedGuardOverrideFamily(row, 'actual'),
        shadowGuardOverrideFamily: executedGuardOverrideFamily(row, 'shadow'),
        comparable: row.comparable === true,
        unavailableReason: row.unavailableReason || null
      })),
      note: 'Cross-guard-path entries are reported explicitly and remain excluded from comparable entry evidence.'
    },
    agreementByStateAge: agreementByStateAge(evaluations),
    offlineComparabilityByBound: offlineComparabilityByBound(
      evaluations,
      preregistration.offlineComparabilityBoundsMs
    ),
    unavailableStateAgeDiagnostics,
    executedPnlAttribution,
    stateSources: comparable.reduce((counts, row) => {
      const key = row.shadowCurveStateSource || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    unavailableReasons: unavailableEvaluations.reduce((counts, row) => {
      const key = row.unavailableReason || 'UNKNOWN';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    unavailableExecutedReasons: executed.filter((row) => !comparableExecuted.includes(row))
      .reduce((counts, row) => {
        const key = row.unavailableReason || 'UNKNOWN';
        counts[key] = (counts[key] || 0) + 1;
        return counts;
      }, {}),
    paidTapeCoverage: {
      budgetReached: Boolean(state.budgetReached),
      budgetReachedAfterMinutes,
      meteredTradeEvents: state.budgetReached?.payload?.meteredTradeEvents ?? null,
      configuredBudget: paidTapePlan.maxMeteredTradeEventsPerSession ?? null
    },
    accountVerifierPrewarm: {
      prewarmLeadMs: stats(prewarmed.map((row) => row.accountVerifierPrewarmLeadMs)),
      telemetryCompleteEvaluations: prewarmTelemetryCompleteEvaluations.length,
      telemetryIncompleteEvaluations: evaluations.length - prewarmTelemetryCompleteEvaluations.length,
      byPrimaryTriggerReason: countBy(
        prewarmed,
        (row) => row.accountVerifierPrewarmTriggerReason || 'MISSING'
      ),
      byTriggerCombination: countBy(prewarmed, (row) => (
        Array.isArray(row.accountVerifierPrewarmTriggerReasons)
          && row.accountVerifierPrewarmTriggerReasons.length > 0
          ? row.accountVerifierPrewarmTriggerReasons.join('+')
          : 'MISSING'
      )),
      byPrewarmToComparisonPath: countBy(
        evaluations,
        (row) => row.accountVerifierPrewarmToComparisonPath || 'MISSING'
      ),
      leadMsByPrimaryTriggerReason: Object.fromEntries(
        [...new Set(prewarmed.map(
          (row) => row.accountVerifierPrewarmTriggerReason || 'MISSING'
        ))].sort().map((reason) => [
          reason,
          stats(prewarmed
            .filter((row) => (row.accountVerifierPrewarmTriggerReason || 'MISSING') === reason)
            .map((row) => row.accountVerifierPrewarmLeadMs))
        ])
      ),
      firstUpdateBeforeComparisonByPath: Object.fromEntries(
        [...new Set(evaluations.map(
          (row) => row.accountVerifierPrewarmToComparisonPath || 'MISSING'
        ))].sort().map((pathName) => {
          const pathRows = evaluations.filter(
            (row) => (row.accountVerifierPrewarmToComparisonPath || 'MISSING') === pathName
          );
          return [pathName, {
            evaluations: pathRows.length,
            updatedBeforeComparison: pathRows.filter(
              (row) => row.accountVerifierFirstUpdateBeforeComparison === true
            ).length,
            rate: ratio(
              pathRows.filter(
                (row) => row.accountVerifierFirstUpdateBeforeComparison === true
              ).length,
              pathRows.length
            )
          }];
        })
      ),
      comparisonCapacitySkips: state.accountVerifierMaxSubscriptionSkips.length,
      prewarmCapacitySkips: state.accountVerifierPrewarmCapacitySkips.length
    },
    heliusEventQueue: {
      failures: state.heliusQueueFailures,
      enqueued: heliusQueueEnqueued,
      processed: heliusQueueProcessed,
      dropped: heliusQueueDropped,
      handlerErrors: heliusQueueHandlerErrors,
      depthAtStop: heliusQueueDepth,
      maxDepth: heliusQueueMaxDepth,
      maxSize: heliusQueueMaxSize,
      maxDepthRatio: ratio(heliusQueueMaxDepth, heliusQueueMaxSize),
      batchSize: Number(heliusQueueStats.eventQueueBatchSize || 0),
      drainYields: Number(heliusQueueStats.eventQueueDrainYields || 0),
      latencySamples: Number(heliusQueueStats.eventQueueLatencySamples || 0),
      latencyMeanMs: Number.isFinite(Number(heliusQueueStats.eventQueueLatencyMeanMs))
        ? Number(heliusQueueStats.eventQueueLatencyMeanMs)
        : null,
      latencyMaxMs: Number.isFinite(Number(heliusQueueStats.eventQueueLatencyMaxMs))
        ? Number(heliusQueueStats.eventQueueLatencyMaxMs)
        : null,
      stopDrainTimedOut: heliusQueueStats.eventQueueStopDrainTimedOut === true
    },
    divergenceByReason,
    marketInputTelemetry: {
      semantics: 'complete_source_attributed_inputs_not_equal_provider_values',
      actualIncompleteEvaluations: actualMarketInputIncompleteEvaluations.length,
      shadowIncompleteEvaluations: shadowMarketInputIncompleteEvaluations.length,
      actualMissingFieldCounts: actualMarketInputIncompleteEvaluations.reduce(
        (counts, row) => {
          for (const field of marketInputTelemetryMissingFields(row.actualGuardFamilyInputs)) {
            counts[field] = (counts[field] || 0) + 1;
          }
          return counts;
        },
        {}
      ),
      shadowMissingFieldCounts: shadowMarketInputIncompleteEvaluations.reduce(
        (counts, row) => {
          for (const field of marketInputTelemetryMissingFields(row.shadowGuardFamilyInputs)) {
            counts[field] = (counts[field] || 0) + 1;
          }
          return counts;
        },
        {}
      ),
      curveProgressSourcePairs: countBy(comparable, (row) => {
        const actualSource = row.actualGuardFamilyInputs?.market?.curveProgressSource || 'MISSING';
        const shadowSource = row.shadowGuardFamilyInputs?.market?.curveProgressSource || 'MISSING';
        return `${actualSource} -> ${shadowSource}`;
      }),
      sniperWalletCountSourcePairs: countBy(comparable, (row) => {
        const actualSource = row.actualGuardFamilyInputs?.market?.sniperWalletCountSource || 'MISSING';
        const shadowSource = row.shadowGuardFamilyInputs?.market?.sniperWalletCountSource || 'MISSING';
        return `${actualSource} -> ${shadowSource}`;
      }),
      sniperWindowAnchorPairs: countBy(comparable, (row) => {
        const actualAnchored = row.actualGuardFamilyInputs?.market
          ?.sniperWindowAnchoredAtFirstObservation === true;
        const shadowAnchored = row.shadowGuardFamilyInputs?.market
          ?.sniperWindowAnchoredAtFirstObservation === true;
        return `${actualAnchored} -> ${shadowAnchored}`;
      }),
      sniperWindowAnchorSemantics:
        'reference_existence_only_true_to_true_does_not_prove_a_shared_anchor_instant',
      sniperWindowAnchorKindPairs: countBy(comparable, (row) => {
        const actualKind = row.actualGuardFamilyInputs?.market?.sniperWindowAnchorKind || 'MISSING';
        const shadowKind = row.shadowGuardFamilyInputs?.market?.sniperWindowAnchorKind || 'MISSING';
        return `${actualKind} -> ${shadowKind}`;
      }),
      sniperWindowAnchorSkew: {
        semantics: 'shadow_anchor_at_ms_minus_actual_anchor_at_ms',
        measuredEvaluations: sniperWindowAnchorComparisons.length,
        missingEvaluations: comparable.length - sniperWindowAnchorComparisons.length,
        signedMs: stats(sniperWindowAnchorComparisons.map((row) => row.signedSkewMs)),
        absoluteMs: stats(sniperWindowAnchorComparisons.map((row) => row.absoluteSkewMs))
      },
      sniperWindowMsPairs: countBy(comparable, (row) => {
        const actualMs = row.actualGuardFamilyInputs?.market?.sniperWindowMs ?? 'MISSING';
        const shadowMs = row.shadowGuardFamilyInputs?.market?.sniperWindowMs ?? 'MISSING';
        return `${actualMs} -> ${shadowMs}`;
      }),
      baselineControl: {
        semantics: 'actual_lane_effective_baseline_anchor_consumed_and_deliberately_held_constant_for_comparable_shadow_counterfactual',
        expectedHeldConstant: true,
        consumedEvaluations: comparable.filter(
          (row) => row.baselineControlConsumed === true
        ).length,
        notConsumedUnavailableEvaluations: baselineNotConsumedEvaluations.length,
        shadowAnchorHeldConstantEvaluations: comparable.filter(
          (row) => row.shadowBaselineAnchorHeldConstant === true
        ).length,
        anchorNotConfirmedFieldsAbsent: comparable.filter(
          (row) => !Object.prototype.hasOwnProperty.call(
            row,
            'shadowBaselineAnchorHeldConstant'
          )
        ).length,
        controlMissingOrInvalidEvaluations: comparable.filter(
          (row) => Object.prototype.hasOwnProperty.call(
            row,
            'shadowBaselineAnchorHeldConstant'
          ) && (row.baselineControlCaptured !== true || row.baselineControlValid !== true)
        ).length,
        shadowAnchorMismatchedEvaluations: comparable.filter(
          (row) => Object.prototype.hasOwnProperty.call(
            row,
            'shadowBaselineAnchorHeldConstant'
          )
            && row.baselineControlCaptured === true
            && row.baselineControlValid === true
            && row.shadowBaselineAnchorHeldConstant !== true
        ).length,
        postEpochInvariantPassed: baselineFieldsPresentEvaluations.length > 0
          ? baselineFieldsPresentEvaluations.length === comparable.length
            && baselineInvariantEvaluations.length === comparable.length
          : null,
        controlCapturedEvaluations: comparable.filter(
          (row) => row.baselineControlCaptured === true
        ).length,
        controlValidEvaluations: comparable.filter(
          (row) => row.baselineControlValid === true
        ).length,
        controlSelectedEvaluations: comparable.filter(
          (row) => row.baselineControlSelected === true
        ).length,
        actualTelemetryMatchesControlEvaluations: comparable.filter(
          (row) => row.actualBaselineMatchesControl === true
        ).length,
        actualTelemetryOmittedEvaluations: comparable.filter(
          (row) => row.actualBaselineMatchesControl === null
            || row.actualBaselineMatchesControl === undefined
        ).length,
        shadowMatchesControlEvaluations: comparable.filter(
          (row) => row.shadowBaselineMatchesControl === true
        ).length,
        anchorSkewMs: stats(comparable.map((row) => row.baselineAnchorSkewMs)),
        curveProgressSkew: stats(
          comparable.map((row) => row.baselineCurveProgressSkew)
        ),
        controlCurveProgress: stats(
          comparable.map((row) => row.baselineControlCurveProgress)
        ),
        heldConstantEvaluations: comparable.filter(
          (row) => row.baselineHistoryHeldConstant === true
        ).length,
        missingOrUnconfirmedEvaluations: comparable.filter(
          (row) => row.baselineHistoryHeldConstant !== true
        ).length,
        sourceCounts: countBy(
          comparable,
          (row) => row.baselineControlSource || 'MISSING'
        ),
        historyRowStats: stats(
          comparable.map((row) => row.baselineControlHistoryRows)
        )
      },
      incompleteSamples: comparable
        .filter((row) => (
          !marketInputTelemetryComplete(row.actualGuardFamilyInputs)
          || !marketInputTelemetryComplete(row.shadowGuardFamilyInputs)
        ))
        .slice(0, 25)
        .map((row) => ({
          pairedDecisionKey: row.pairedDecisionKey || null,
          mint: row.mint || null,
          actualComplete: marketInputTelemetryComplete(row.actualGuardFamilyInputs),
          shadowComplete: marketInputTelemetryComplete(row.shadowGuardFamilyInputs),
          actualMissingFields: marketInputTelemetryMissingFields(
            row.actualGuardFamilyInputs
          ),
          shadowMissingFields: marketInputTelemetryMissingFields(
            row.shadowGuardFamilyInputs
          ),
          actualMarket: row.actualGuardFamilyInputs?.market || null,
          shadowMarket: row.shadowGuardFamilyInputs?.market || null
        }))
    },
    divergenceSamples: divergences.slice(0, 50),
    executedActionComparisons: executed,
    paritySummary: {
      sourceTelemetry: parity.sourceTelemetry || null,
      verdict: parity.verdict || null,
      eligibleMintHours: parity.counts?.eligibleMintHours ?? null,
      recallPassRate: parity.agreement?.mintHourPortalTradeIdentityRecallPassRate ?? null,
      volumePassRate: parity.agreement?.mintHourVolumePassRate ?? null,
      curvePassRate: parity.agreement?.curvePassRate ?? null
    },
    interpretation: verdict === preregistration.passVerdict
      ? 'Decision shadow passed its frozen report-only gate. Build and validate a Helius-backed evidence path before changing procurement.'
      : 'Keep Helius report-only for strategy consumption. Diagnose unavailable state and decision, wallet, or executed-action divergence before procurement promotion.'
  };
}

function analyzeEvents(events, preregistration, parity, sourceTelemetry = 'synthetic') {
  return buildReport({ state: collect(events), preregistration, parity, sourceTelemetry });
}

function main() {
  const { telemetryPath } = parseCli();
  const preregistration = loadPreregistration(PREREG_PATH);
  const parity = fs.existsSync(PARITY_PATH) ? readJson(PARITY_PATH) : {};
  const state = createState();
  let malformedLines = 0;
  if (telemetryPath && fs.existsSync(telemetryPath)) {
    const readStats = forEachJsonlSync(telemetryPath, (event) => collectEvent(state, event));
    malformedLines = readStats.malformedLines;
  }
  const sourceTelemetry = telemetryPath
    ? path.relative(ROOT, telemetryPath).replace(/\\/g, '/')
    : null;
  const report = buildReport({ state, preregistration, parity, sourceTelemetry });
  report.counts.malformedTelemetryLines = malformedLines;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stampedPath = path.join(OUTPUT_DIR, `helius-pumpfun-decision-divergence-${stamp}.json`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(stampedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict: report.verdict, checks: report.checks, counts: report.counts, agreement: report.agreement }, null, 2));
}

if (require.main === module) main();

module.exports = {
  agreementByStateAge,
  analyzeEvents,
  buildEntryMismatchAttribution,
  buildReport,
  collect,
  collectEvent,
  createState,
  fieldDiff,
  loadPreregistration,
  marketProvenance,
  marketInputTelemetryComplete,
  marketInputTelemetryMissingFields,
  offlineComparabilityByBound,
  stats,
  withoutMarketProvenance
};
