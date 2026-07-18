'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LEDGER_PATH = path.join(ROOT, 'data', 'wallet-shadow-ledgers', 'frozen-slice-samples.jsonl');
const DISPOSITION_PATH = path.join(ROOT, 'data', 'wallet-shadow-ledgers', 'frozen-slice-disposition.json');

function readDisposition(filePath = DISPOSITION_PATH) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function sampleKey(sample) {
  // Telemetry filenames are timestamped run identities; do not rename them before re-reporting.
  return [
    sample.era || 'unknown_era',
    sample.frozenSlice || 'unknown_slice',
    sample.telemetryPath || 'unknown_telemetry',
    sample.mint || 'unknown_mint',
    sample.at || sample.atMs || 'unknown_at'
  ].join('|');
}

function normalizeSample(sample) {
  const normalized = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    ...sample
  };
  normalized.sampleKey = sample.sampleKey || sampleKey(normalized);
  return normalized;
}

function isPositiveOrProvenTouch(touch) {
  return Boolean(touch?.positiveOrProven)
    || ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(touch?.evidenceTier)
    || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(touch?.reviewTier);
}

function isAvoidOrNegativeTouch(touch) {
  return Boolean(touch?.avoidOrNegative)
    || touch?.reviewTier === 'AVOID_REVIEW'
    || touch?.evidenceTier === 'NEGATIVE_EVIDENCE';
}

function isBuyTouch(touch) {
  return String(touch?.side || '').toLowerCase() === 'buy';
}

function initWindowDiagnostics() {
  return {
    joined: 0,
    missing: 0,
    crossed85: 0,
    crossed90: 0,
    crossed95: 0,
    staticFuturePriceSeries: 0,
    missingPriceJoin: 0,
    zeroPriceDeltaWithManySnapshots: 0,
    touchCurveAboveWindowMax: 0
  };
}

function updateWindowDiagnostics(bucket, window, row) {
  if (!window?.outcomeJoined) {
    bucket.missing += 1;
    return;
  }
  bucket.joined += 1;
  if (window.crossed85) bucket.crossed85 += 1;
  if (window.crossed90) bucket.crossed90 += 1;
  if (window.crossed95) bucket.crossed95 += 1;
  const zeroPriceDeltaWithManySnapshots = Number(window.snapshotCount || 0) >= 10 && Number(window.maxPriceDeltaPct) === 0;
  if (window.priceJoinStatus === 'STATIC_FUTURE_PRICE_SERIES' || zeroPriceDeltaWithManySnapshots) {
    bucket.staticFuturePriceSeries += 1;
  }
  if (['MISSING_BASE_PRICE', 'MISSING_FUTURE_PRICE'].includes(window.priceJoinStatus)) bucket.missingPriceJoin += 1;
  if (zeroPriceDeltaWithManySnapshots) {
    bucket.zeroPriceDeltaWithManySnapshots += 1;
  }
  const touchCurve = Number(row?.qualifyingFirstTouch?.curveProgress);
  const maxCurve = Number(window.maxCurveProgress);
  if (window.touchCurveAboveWindowMax || (Number.isFinite(touchCurve) && Number.isFinite(maxCurve) && touchCurve - maxCurve > 0.02)) {
    bucket.touchCurveAboveWindowMax += 1;
  }
}

function appendSamples(samples, ledgerPath = LEDGER_PATH) {
  const disposition = readDisposition();
  if (disposition?.closedToFurtherLedgerAppends === true) {
    const existing = readJsonl(ledgerPath).length;
    return {
      ledgerPath,
      appended: 0,
      existing,
      total: existing,
      closed: true,
      reason: disposition.disposition,
      closedBeforeWrite: true
    };
  }
  const normalized = (samples || []).map(normalizeSample);
  if (!normalized.length) {
    return {
      ledgerPath,
      appended: 0,
      existing: readJsonl(ledgerPath).length,
      total: readJsonl(ledgerPath).length
    };
  }

  const existingRows = readJsonl(ledgerPath);
  // Post-run reports are sequential today; add file locking before parallelizing ledger writers.
  const existingKeys = new Set();
  for (const row of existingRows) {
    if (row.sampleKey) existingKeys.add(row.sampleKey);
    existingKeys.add(sampleKey(row));
  }
  const newRows = normalized.filter((row) => !existingKeys.has(row.sampleKey));

  if (newRows.length) {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(
      ledgerPath,
      newRows.map((row) => JSON.stringify(row)).join('\n') + '\n',
      'utf8'
    );
  }

  return {
    ledgerPath,
    appended: newRows.length,
    existing: existingRows.length,
    total: existingRows.length + newRows.length
  };
}

function summarizeLedger(filters = {}, ledgerPath = LEDGER_PATH) {
  const rows = readJsonl(ledgerPath);
  const selected = rows.filter((row) => {
    if (filters.frozenSlice && row.frozenSlice !== filters.frozenSlice) return false;
    if (filters.era && row.era !== filters.era) return false;
    return true;
  });
  const byCohort = {};
  let outcomeJoined120s = 0;
  let outcomeMissing120s = 0;
  let postFixCleanSamples = 0;
  let postFixOutcomeJoined120s = 0;
  const qualifyingFirstTouchIntegrity = {
    frozenCondition: 'tracked_first_touch_buy',
    frozenRule: 'Earliest pre-entry/pre-85 touch must be a buy from any tracked wallet.',
    clarification: 'This cumulative count is not positive/proven-only; avoid/negative tracked-wallet buys remain qualifying samples for this frozen slice.',
    qualifyingSamples: 0,
    qualifyingFirstTouchBuy: 0,
    qualifyingFirstTouchPositiveOrProven: 0,
    qualifyingFirstTouchAvoidOrNegative: 0,
    qualifyingFirstTouchNeitherPositiveNorAvoid: 0,
    withAnyPositiveOrProvenTouch: 0,
    withAnyAvoidOrNegativeTouch: 0,
    positiveOnlySiblingSamples: 0,
    excludeAvoidSiblingSamples: 0
  };
  const windowDiagnostics = {
    '30s': initWindowDiagnostics(),
    '60s': initWindowDiagnostics(),
    '120s': initWindowDiagnostics(),
    '300s': initWindowDiagnostics()
  };
  const preDecisionContextSummary = {
    joined: 0,
    missing: 0,
    fadedFromTouchBeforeDecision: 0,
    fadedFromPreDecisionMax: 0,
    reasonCounts: {}
  };
  for (const row of selected) {
    const cohort = row.cohort || 'unknown';
    const isPostFixCleanSample = Number(row.outcomeJoinSchemaVersion || 0) >= 2;
    if (isPostFixCleanSample) postFixCleanSamples += 1;
    const bucket = byCohort[cohort] || {
      samples: 0,
      uniqueMints: new Set(),
      withPositiveOrProvenTouch: 0,
      withAvoidTouch: 0,
      outcomeJoined120s: 0,
      outcomeMissing120s: 0,
      crossed85Within120s: 0,
      crossed90Within120s: 0,
      crossed90Within300s: 0,
      qualifyingFirstTouchPositiveOrProven: 0,
      qualifyingFirstTouchAvoidOrNegative: 0
    };
    bucket.samples += 1;
    if (row.mint) bucket.uniqueMints.add(row.mint);
    if (row.withPositiveOrProvenTouch) bucket.withPositiveOrProvenTouch += 1;
    if (row.withAvoidTouch) bucket.withAvoidTouch += 1;
    const qualifyingFirstTouch = row.qualifyingFirstTouch || null;
    if (qualifyingFirstTouch) {
      qualifyingFirstTouchIntegrity.qualifyingSamples += 1;
      if (isBuyTouch(qualifyingFirstTouch)) qualifyingFirstTouchIntegrity.qualifyingFirstTouchBuy += 1;
      const positive = isPositiveOrProvenTouch(qualifyingFirstTouch);
      const avoid = isAvoidOrNegativeTouch(qualifyingFirstTouch);
      if (positive) {
        qualifyingFirstTouchIntegrity.qualifyingFirstTouchPositiveOrProven += 1;
        bucket.qualifyingFirstTouchPositiveOrProven += 1;
      }
      if (avoid) {
        qualifyingFirstTouchIntegrity.qualifyingFirstTouchAvoidOrNegative += 1;
        bucket.qualifyingFirstTouchAvoidOrNegative += 1;
      }
      if (!positive && !avoid) qualifyingFirstTouchIntegrity.qualifyingFirstTouchNeitherPositiveNorAvoid += 1;
      if (isBuyTouch(qualifyingFirstTouch) && positive) qualifyingFirstTouchIntegrity.positiveOnlySiblingSamples += 1;
      if (isBuyTouch(qualifyingFirstTouch) && !row.withAvoidTouch) qualifyingFirstTouchIntegrity.excludeAvoidSiblingSamples += 1;
    }
    if (row.withPositiveOrProvenTouch) qualifyingFirstTouchIntegrity.withAnyPositiveOrProvenTouch += 1;
    if (row.withAvoidTouch) qualifyingFirstTouchIntegrity.withAnyAvoidOrNegativeTouch += 1;
    if (row.windows?.['120s']?.outcomeJoined) {
      bucket.outcomeJoined120s += 1;
      outcomeJoined120s += 1;
      if (isPostFixCleanSample) postFixOutcomeJoined120s += 1;
    } else {
      bucket.outcomeMissing120s += 1;
      outcomeMissing120s += 1;
    }
    if (row.windows?.['120s']?.crossed85) bucket.crossed85Within120s += 1;
    if (row.windows?.['120s']?.crossed90) bucket.crossed90Within120s += 1;
    if (row.windows?.['300s']?.crossed90) bucket.crossed90Within300s += 1;
    for (const [windowKey, diagnostics] of Object.entries(windowDiagnostics)) {
      updateWindowDiagnostics(diagnostics, row.windows?.[windowKey], row);
    }
    const preDecisionContext = row.preDecisionContext || {};
    if (preDecisionContext.joined) preDecisionContextSummary.joined += 1;
    else preDecisionContextSummary.missing += 1;
    if (preDecisionContext.fadedFromTouchBeforeDecision) preDecisionContextSummary.fadedFromTouchBeforeDecision += 1;
    if (preDecisionContext.fadedFromPreDecisionMax) preDecisionContextSummary.fadedFromPreDecisionMax += 1;
    const reason = preDecisionContext.reason || 'unknown';
    preDecisionContextSummary.reasonCounts[reason] = (preDecisionContextSummary.reasonCounts[reason] || 0) + 1;
    byCohort[cohort] = bucket;
  }

  return {
    ledgerPath,
    totalRows: rows.length,
    filteredRows: selected.length,
    filters,
    outcomeJoined120s,
    outcomeMissing120s,
    postFixCleanSamples,
    postFixOutcomeJoined120s,
    postFixTargetAdditionalSamples: 10,
    checkpointDisposition: readDisposition(),
    qualifyingFirstTouchIntegrity,
    windowDiagnostics,
    preDecisionContextSummary,
    byCohort: Object.fromEntries(Object.entries(byCohort).map(([cohort, bucket]) => [cohort, {
      ...bucket,
      uniqueMints: bucket.uniqueMints.size
    }]))
  };
}

module.exports = {
  DISPOSITION_PATH,
  LEDGER_PATH,
  appendSamples,
  readDisposition,
  readJsonl,
  sampleKey,
  summarizeLedger
};
