#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const {
  PREREGISTERED: PARITY_RULE,
  buildPortalCoverage,
  createState,
  inCoverage,
  ingestEvent,
  isSolQuoted,
  mergeIntervals,
  relativeDelta,
  solAmountOf,
  stats,
  tradeIdentity
} = require('./helius-pumpfun-shadow-parity-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-recall-autopsy');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-recall-autopsy-latest.json');

const METHODOLOGY = Object.freeze({
  id: 'helius_pumpfun_recall_autopsy_v1_2026-07-19',
  mode: 'offline_report_only',
  strategyConsumptionAllowed: false,
  cohortRule: `same_as_${PARITY_RULE.id}_failed_identity_recall_mint_hours`,
  missClassificationOrder: [
    'MISSING_IDENTITY_FIELDS',
    'COVERAGE_EDGE',
    'IDENTITY_RESIDUE',
    'HELIUS_SIGNATURE_ABSENT'
  ],
  coverageEdgeDefinition: 'exact_identity_exists_in_global_helius_rows_but_not_inside_the_graded_coverage_segments',
  coverageEdgeBucketsMs: [250, 1_000, 2_000],
  identityResidueDefinition: 'exact_identity_absent_but_same_signature_and_mint_exists_in_helius',
  burstDefinition: 'unique_pumpportal_trade_identities_for_the_same_mint_hour_and_floor(receipt_ms/1000)',
  highBurstDefinition: 'burst_intensity_at_or_above_the_p90_of_all_identifiable_portal_rows_in_failed_cohorts',
  promotionAuthority: 'none_diagnostic_only'
});

function latestTelemetryPath() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath || null;
}

function parseCli(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--telemetry');
  const supplied = index >= 0 ? argv[index + 1] : null;
  return { telemetryPath: supplied ? path.resolve(supplied) : latestTelemetryPath() };
}

function payloadIdentityParts(row) {
  const payload = row?.payload || {};
  return {
    signature: payload.signature || null,
    trader: payload.traderPublicKey || payload.trader || payload.user || null,
    side: ['buy', 'sell'].includes(String(payload.txType || '').toLowerCase())
      ? String(payload.txType).toLowerCase()
      : null
  };
}

function groupByMint(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const values = grouped.get(row.mint) || [];
    values.push(row);
    grouped.set(row.mint, values);
  }
  return grouped;
}

function nearestCoverageDistanceMs(receiptMs, segments) {
  if (!Number.isFinite(receiptMs) || !segments.length) return null;
  if (segments.some((segment) => receiptMs >= segment.startMs && receiptMs <= segment.endMs)) return 0;
  return Math.min(...segments.flatMap((segment) => [
    Math.abs(receiptMs - segment.startMs),
    Math.abs(receiptMs - segment.endMs)
  ]));
}

function edgeBucket(distanceMs) {
  if (!Number.isFinite(distanceMs)) return 'UNKNOWN';
  if (distanceMs <= 250) return 'LE_250MS';
  if (distanceMs <= 1_000) return 'LE_1S';
  if (distanceMs <= 2_000) return 'LE_2S';
  return 'GT_2S';
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

function safeSample(row, extra = {}) {
  const parts = payloadIdentityParts(row);
  return {
    mint: row.mint,
    signature: parts.signature,
    trader: parts.trader,
    side: parts.side,
    eventAt: Number.isFinite(row.atMs) ? new Date(row.atMs).toISOString() : null,
    receivedAt: Number.isFinite(row.receiptMs) ? new Date(row.receiptMs).toISOString() : null,
    ...extra
  };
}

function buildReport(state, sourceTelemetry = null) {
  const firstTradeMs = [...state.heliusTrades, ...state.portalTrades]
    .map((row) => row.receiptMs).filter(Number.isFinite).sort((a, b) => a - b)[0] || null;
  const sessionStartMs = state.sessionStartMs || firstTradeMs;
  const sessionEndMs = state.lastEventMs || sessionStartMs;
  const portalCoverage = buildPortalCoverage(state, sessionStartMs, sessionEndMs);
  const heliusByMint = groupByMint(state.heliusTrades.filter((row) => isSolQuoted(row.payload)));
  const portalByMint = groupByMint(state.portalTrades.filter((row) => (
    String(row.payload?.pairBase || 'SOL').toUpperCase() === 'SOL'
  )));
  const coverageBuckets = new Map();
  for (const segment of portalCoverage.coverage) {
    const key = `${segment.mint}|${segment.hourIndex}`;
    const bucket = coverageBuckets.get(key) || {
      key,
      mint: segment.mint,
      hourIndex: segment.hourIndex,
      sources: new Set(),
      segments: []
    };
    bucket.sources.add(segment.source);
    bucket.segments.push(segment);
    coverageBuckets.set(key, bucket);
  }

  const failed = [];
  for (const bucket of coverageBuckets.values()) {
    const segments = mergeIntervals(bucket.segments);
    const portalRows = (portalByMint.get(bucket.mint) || []).filter((row) => inCoverage(row, segments));
    const heliusRows = (heliusByMint.get(bucket.mint) || []).filter((row) => inCoverage(row, segments));
    const portalByIdentity = new Map();
    for (const row of portalRows) {
      const identity = tradeIdentity(row.payload, row.mint);
      if (identity && !portalByIdentity.has(identity)) portalByIdentity.set(identity, row);
    }
    if (portalByIdentity.size < PARITY_RULE.solQuotedMinimumTradesPerMintHour) continue;
    const heliusIdentities = new Set(heliusRows.map((row) => tradeIdentity(row.payload, row.mint)).filter(Boolean));
    const matched = [...portalByIdentity.keys()].filter((identity) => heliusIdentities.has(identity)).length;
    const recall = matched / portalByIdentity.size;
    if (recall >= PARITY_RULE.portalTradeIdentityRecallMinimumRate) continue;
    failed.push({
      ...bucket,
      segments,
      portalRows,
      heliusRows,
      portalByIdentity,
      matched,
      recall
    });
  }

  const burstCounts = new Map();
  for (const cohort of failed) {
    for (const [identity, row] of cohort.portalByIdentity.entries()) {
      const burstKey = `${cohort.key}|${Math.floor(row.receiptMs / 1_000)}`;
      burstCounts.set(burstKey, (burstCounts.get(burstKey) || 0) + 1);
      row.autopsyIdentity = identity;
      row.autopsyBurstKey = burstKey;
    }
  }
  const allPortalBurstIntensities = failed.flatMap((cohort) => (
    [...cohort.portalByIdentity.values()].map((row) => burstCounts.get(row.autopsyBurstKey) || 1)
  ));
  const burstThreshold = stats(allPortalBurstIntensities, 3).p90;
  const aggregateClassifications = {};
  const aggregateResidueSubtypes = {};
  const aggregateSides = {};
  const aggregateEdgeBuckets = {};
  const allMissing = [];

  const cohorts = failed.map((cohort) => {
    const globalHeliusRows = heliusByMint.get(cohort.mint) || [];
    const globalByIdentity = new Map();
    const globalBySignature = new Map();
    for (const row of globalHeliusRows) {
      const identity = tradeIdentity(row.payload, row.mint);
      if (identity) {
        const rows = globalByIdentity.get(identity) || [];
        rows.push(row);
        globalByIdentity.set(identity, rows);
      }
      const signature = payloadIdentityParts(row).signature;
      if (signature) {
        const rows = globalBySignature.get(signature) || [];
        rows.push(row);
        globalBySignature.set(signature, rows);
      }
    }
    const coveredIdentities = new Set(cohort.heliusRows
      .map((row) => tradeIdentity(row.payload, row.mint)).filter(Boolean));
    const classifications = {};
    const sides = {};
    const edgeBuckets = {};
    const residueSubtypes = {};
    const samples = [];
    const missingRows = [];
    const missingReceiptTimes = [];
    for (const [identity, row] of cohort.portalByIdentity.entries()) {
      if (coveredIdentities.has(identity)) continue;
      const parts = payloadIdentityParts(row);
      const exactGlobal = globalByIdentity.get(identity) || [];
      const sameSignature = parts.signature ? (globalBySignature.get(parts.signature) || []) : [];
      let classification = 'HELIUS_SIGNATURE_ABSENT';
      let detail = {};
      if (!parts.signature || !parts.trader || !parts.side) {
        classification = 'MISSING_IDENTITY_FIELDS';
      } else if (exactGlobal.length) {
        classification = 'COVERAGE_EDGE';
        const nearest = [...exactGlobal].sort((left, right) => (
          nearestCoverageDistanceMs(left.receiptMs, cohort.segments)
          - nearestCoverageDistanceMs(right.receiptMs, cohort.segments)
        ))[0];
        const distanceMs = nearestCoverageDistanceMs(nearest.receiptMs, cohort.segments);
        detail = {
          heliusReceivedAt: new Date(nearest.receiptMs).toISOString(),
          heliusMinusPortalReceiptMs: nearest.receiptMs - row.receiptMs,
          coverageBoundaryDistanceMs: distanceMs,
          coverageEdgeBucket: edgeBucket(distanceMs)
        };
        increment(edgeBuckets, detail.coverageEdgeBucket);
        increment(aggregateEdgeBuckets, detail.coverageEdgeBucket);
      } else if (sameSignature.length) {
        classification = 'IDENTITY_RESIDUE';
        const portalAmount = solAmountOf(row.payload);
        const amountDeltas = sameSignature.map((candidate) => ({
          row: candidate,
          relativeDelta: relativeDelta(solAmountOf(candidate.payload), portalAmount),
          absoluteDeltaSol: Number.isFinite(solAmountOf(candidate.payload)) && Number.isFinite(portalAmount)
            ? Math.abs(solAmountOf(candidate.payload) - portalAmount)
            : null
        }));
        const exactAmountRows = amountDeltas.filter((candidate) => (
          Number.isFinite(candidate.absoluteDeltaSol) && candidate.absoluteDeltaSol <= 1e-9
        ));
        const residueSubtype = exactAmountRows.length
          ? 'TRADER_MISMATCH_EXACT_AMOUNT'
          : 'TRADER_MISMATCH_DIFFERENT_AMOUNT';
        increment(residueSubtypes, residueSubtype);
        increment(aggregateResidueSubtypes, residueSubtype);
        detail = {
          residueSubtype,
          sameSignatureHeliusRows: sameSignature.length,
          sameTraderRows: sameSignature.filter((candidate) => payloadIdentityParts(candidate).trader === parts.trader).length,
          sameSideRows: sameSignature.filter((candidate) => payloadIdentityParts(candidate).side === parts.side).length,
          exactAmountRows: exactAmountRows.length,
          nearestAmountRelativeDelta: stats(amountDeltas.map((candidate) => candidate.relativeDelta), 9).min
        };
      }
      const burstIntensity = burstCounts.get(row.autopsyBurstKey) || 1;
      const missing = {
        classification,
        side: parts.side || 'unknown',
        burstIntensity,
        highBurst: Number.isFinite(burstThreshold) && burstIntensity >= burstThreshold,
        ...detail
      };
      increment(classifications, classification);
      increment(aggregateClassifications, classification);
      increment(sides, missing.side);
      increment(aggregateSides, missing.side);
      missingRows.push(missing);
      if (Number.isFinite(row.receiptMs)) missingReceiptTimes.push(row.receiptMs);
      allMissing.push(missing);
      if (samples.length < 12) samples.push(safeSample(row, missing));
    }
    const unidentifiablePortalRows = cohort.portalRows.filter((row) => !tradeIdentity(row.payload, row.mint));
    return {
      key: cohort.key,
      mint: cohort.mint,
      hourIndex: cohort.hourIndex,
      coverageSources: [...cohort.sources],
      coverageWindowCount: cohort.segments.length,
      coverageDurationMs: cohort.segments.reduce((sum, segment) => sum + Math.max(0, segment.endMs - segment.startMs), 0),
      portalTradeIdentities: cohort.portalByIdentity.size,
      matchedPortalTradeIdentities: cohort.matched,
      missingPortalTradeIdentities: cohort.portalByIdentity.size - cohort.matched,
      portalTradeIdentityRecall: Number(cohort.recall.toFixed(6)),
      signaturePresenceRecall: Number(((cohort.matched
        + (classifications.IDENTITY_RESIDUE || 0)) / cohort.portalByIdentity.size).toFixed(6)),
      unidentifiablePortalRows: unidentifiablePortalRows.length,
      classifications,
      identityResidueSubtypes: residueSubtypes,
      sides,
      coverageEdgeBuckets: edgeBuckets,
      missingBurstIntensity: stats(missingRows.map((row) => row.burstIntensity), 3),
      missingReceiptSpanMs: missingReceiptTimes.length
        ? Math.max(...missingReceiptTimes) - Math.min(...missingReceiptTimes)
        : null,
      highBurstMissingRate: missingRows.length
        ? missingRows.filter((row) => row.highBurst).length / missingRows.length
        : null,
      samples
    };
  });

  const highBurstPortalCount = allPortalBurstIntensities
    .filter((value) => Number.isFinite(burstThreshold) && value >= burstThreshold).length;
  const highBurstMissingCount = allMissing.filter((row) => row.highBurst).length;
  const lowerBurstPortalCount = allPortalBurstIntensities.length - highBurstPortalCount;
  const lowerBurstMissingCount = allMissing.length - highBurstMissingCount;

  return {
    generatedAt: new Date().toISOString(),
    sourceTelemetry,
    methodology: METHODOLOGY,
    verdict: cohorts.length ? 'FAILED_RECALL_COHORTS_AUTOPSIED' : 'NO_FAILED_RECALL_COHORTS',
    counts: {
      failedMintHourCohorts: cohorts.length,
      portalTradeIdentities: cohorts.reduce((sum, row) => sum + row.portalTradeIdentities, 0),
      matchedPortalTradeIdentities: cohorts.reduce((sum, row) => sum + row.matchedPortalTradeIdentities, 0),
      missingPortalTradeIdentities: allMissing.length,
      malformedTelemetryLines: state.malformedLines || 0
    },
    classifications: aggregateClassifications,
    identityResidueSubtypes: aggregateResidueSubtypes,
    diagnosticSignaturePresenceRecall: allMissing.length
      ? (cohorts.reduce((sum, row) => sum + row.matchedPortalTradeIdentities, 0)
        + (aggregateClassifications.IDENTITY_RESIDUE || 0))
        / cohorts.reduce((sum, row) => sum + row.portalTradeIdentities, 0)
      : null,
    sides: aggregateSides,
    coverageEdgeBuckets: aggregateEdgeBuckets,
    burst: {
      thresholdP90: burstThreshold,
      allPortalIdentityIntensity: stats(allPortalBurstIntensities, 3),
      missingIdentityIntensity: stats(allMissing.map((row) => row.burstIntensity), 3),
      highBurstPortalCount,
      highBurstMissingCount,
      highBurstMissRate: highBurstPortalCount ? highBurstMissingCount / highBurstPortalCount : null,
      lowerBurstPortalCount,
      lowerBurstMissingCount,
      lowerBurstMissRate: lowerBurstPortalCount ? lowerBurstMissingCount / lowerBurstPortalCount : null
    },
    cohorts,
    interpretation: 'Diagnostic only. Use the miss classes to decide whether the next action is a comparator fix or an unchanged V4 replication run.'
  };
}

function analyzeEvents(events, sourceTelemetry = 'synthetic') {
  const state = createState();
  for (const event of events) ingestEvent(state, event);
  return buildReport(state, sourceTelemetry);
}

function writeReport(report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stampedPath = path.join(OUTPUT_DIR, `helius-pumpfun-recall-autopsy-${stamp}.json`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(stampedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { stampedPath, latestPath: LATEST_PATH };
}

function main() {
  const { telemetryPath } = parseCli();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    const paths = writeReport(buildReport(createState(), null));
    console.log(`Wrote Helius Pump.fun recall autopsy: ${paths.latestPath}`);
    return;
  }
  const state = createState();
  const readStats = forEachJsonlSync(telemetryPath, (event) => ingestEvent(state, event));
  state.malformedLines = readStats.malformedLines;
  const source = path.relative(ROOT, telemetryPath).replace(/\\/g, '/');
  const paths = writeReport(buildReport(state, source));
  console.log(`Wrote Helius Pump.fun recall autopsy: ${paths.stampedPath}`);
  console.log(`Wrote latest Helius Pump.fun recall autopsy: ${paths.latestPath}`);
}

if (require.main === module) main();

module.exports = { METHODOLOGY, analyzeEvents, buildReport, edgeBucket, nearestCoverageDistanceMs };
