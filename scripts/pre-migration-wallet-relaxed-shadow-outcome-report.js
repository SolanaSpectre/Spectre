#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveTelemetryPath, telemetryFromReport } = require('./lib/report-telemetry');
const { appendSamples, summarizeLedger } = require('./lib/wallet-shadow-sample-ledger');
const { evaluateWalletCheckpoint } = require('./lib/wallet-shadow-checkpoint-evaluator');
const {
  buildOutcomeWindow,
  buildPreDecisionContext,
  mintOf,
  numberOrNull,
  payloadOf,
  priceOf,
  snapshotFromEvent,
  timestampMs
} = require('./lib/pre-migration-outcome-windows');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-relaxed-shadow-outcome-latest.json');
const MANUAL_WALLET_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const SHADOW_WALLET_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'shadow-untracked-wallets.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];
const FROZEN_WALLET_SLICE = 'all_low_score_first_sight__tracked_first_touch_buy';
const FROZEN_WALLET_RULE = {
  condition: 'tracked_first_touch_buy',
  rule: 'Earliest pre-entry/pre-85 touch must be a buy from any tracked wallet.',
  clarification: 'This is not the positive/proven-only slice. Avoid/negative tracked-wallet buys remain qualifying samples and are reported separately as diagnostics.',
  positiveOnlySiblingCondition: 'positive_or_proven_first_touch_buy',
  excludeAvoidSiblingCondition: 'tracked_first_touch_buy_exclude_avoid'
};
const WALLET_CHECKPOINT_DISPOSITION = {
  decidedAtCommit: 'eadca7b',
  disposition: 'EXTEND_WITH_CAUSE_AFTER_JOIN_PROVENANCE_FIX',
  reason: 'The 10-sample broad tracked-first-touch-buy checkpoint was reached, but several samples mixed earlier high wallet-touch curves with later lower decision-time windows. Economic grading needs clean post-fix provenance.',
  dirtyEraTreatment: 'The first 10 samples remain supporting context only and should be labeled instrumentation-compromised/crossings-only when window provenance is ambiguous.',
  postFixTargetAdditionalSamples: 10,
  postFixSampleEra: 'wallet_relaxed_shadow_v1_join_provenance_2026-07-13',
  noPostHocSliceTightening: 'Do not reinterpret this frozen lane as positive/proven-only. A positive/proven-first-touch requirement is a new hypothesis with its own discovery/pin/confirm cycle.'
};

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

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function walletKey(value) {
  const key = String(value || '').trim();
  return key || null;
}

function buildWalletCohortIndex() {
  const index = new Map();
  const addWallet = (wallet, fallbackCohort) => {
    const address = walletKey(wallet.walletAddress || wallet.wallet || wallet.address);
    if (!address) return;
    const profile = wallet.profile || null;
    const cohort = profile === 'observation_only_v2'
      ? 'observation_only_v2'
      : (fallbackCohort || profile || 'unknown_wallet_cohort');
    index.set(address, {
      walletCohort: cohort,
      walletProfile: profile,
      walletSource: wallet.source || null,
      walletEra: wallet.era || null,
      walletFlags: Array.isArray(wallet.flags) ? wallet.flags.slice(0, 12) : [],
      watchlistName: wallet.name || null
    });
  };

  const manual = readJson(MANUAL_WALLET_PATH, {});
  for (const wallet of manual.wallets || []) addWallet(wallet, 'manual_kol_v1');

  const shadow = readJson(SHADOW_WALLET_PATH, {});
  for (const wallet of shadow.wallets || []) addWallet(wallet, wallet.profile || 'shadow_untracked_review');

  return index;
}

function cohortForTouch(touch, walletCohortIndex) {
  if (!touch || typeof touch !== 'object') return null;
  const existing = touch.walletCohort || touch.cohort || null;
  if (existing) {
    return {
      walletCohort: existing,
      walletProfile: touch.walletProfile || null,
      walletSource: touch.walletSource || null,
      walletEra: touch.walletEra || null,
      walletFlags: Array.isArray(touch.walletFlags) ? touch.walletFlags.slice(0, 12) : []
    };
  }
  const address = walletKey(touch.wallet || touch.walletAddress);
  const indexed = address ? walletCohortIndex.get(address) : null;
  if (indexed) return indexed;
  if (touch.reviewTier || touch.evidenceTier) {
    return {
      walletCohort: 'tracked_promotion_review',
      walletProfile: null,
      walletSource: null,
      walletEra: null,
      walletFlags: []
    };
  }
  return {
    walletCohort: 'unknown_tracked_runtime',
    walletProfile: null,
    walletSource: null,
    walletEra: null,
    walletFlags: []
  };
}

function enrichTouch(touch, walletCohortIndex) {
  if (!touch || typeof touch !== 'object') return null;
  const cohort = cohortForTouch(touch, walletCohortIndex);
  return {
    ...touch,
    walletCohort: cohort?.walletCohort || null,
    walletProfile: cohort?.walletProfile || touch.walletProfile || null,
    walletSource: cohort?.walletSource || touch.walletSource || null,
    walletEra: cohort?.walletEra || touch.walletEra || null,
    walletFlags: Array.isArray(cohort?.walletFlags) ? cohort.walletFlags : []
  };
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

function telemetryFromBattlefield() {
  return telemetryFromReport(ROOT, BATTLEFIELD_PATH);
}

function isBuyTouch(touch) {
  return String(touch?.side || '').toLowerCase() === 'buy';
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

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function shadowAttemptFromEvent(event, walletCohortIndex) {
  const eventType = event.type || event.event;
  if (!['pre_migration_wallet_relaxed_shadow.would_enter', 'pre_migration_wallet_relaxed_shadow.would_skip'].includes(eventType)) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const qualifyingFirstTouch = enrichTouch(payload.qualifyingFirstTouch, walletCohortIndex);
  const positiveFirstTouch = enrichTouch(payload.positiveFirstTouch, walletCohortIndex);
  const firstConditioningTouch = enrichTouch(payload.firstConditioningTouch, walletCohortIndex);
  const walletSummary = Array.isArray(payload.walletSummary)
    ? payload.walletSummary.map((touch) => enrichTouch(touch, walletCohortIndex)).filter(Boolean)
    : [];
  return {
    eventType,
    wouldEnter: eventType === 'pre_migration_wallet_relaxed_shadow.would_enter',
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    shadowProfile: payload.shadowProfile || null,
    shadowReason: payload.shadowReason || null,
    sourceDecision: payload.sourceDecision || null,
    sourceReason: payload.sourceReason || null,
    sourcePreset: payload.sourcePreset || null,
    sourceLane: payload.sourceLane || null,
    score: numberOrNull(payload.score, 2),
    curveProgress: numberOrNull(payload.curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    walletTouchCount: numberOrNull(payload.walletTouchCount, 0),
    walletContextSource: payload.walletContextSource || null,
    earliestWalletTouchAt: payload.earliestWalletTouchAt || null,
    earliestWalletBuyAt: payload.earliestWalletBuyAt || null,
    positiveOrProvenTouchCount: numberOrNull(payload.positiveOrProvenTouchCount, 0),
    avoidTouchCount: numberOrNull(payload.avoidTouchCount, 0),
    qualifyingFirstTouch,
    positiveFirstTouch,
    firstConditioningTouch,
    qualifyingWalletCohort: qualifyingFirstTouch?.walletCohort || null,
    positiveWalletCohort: positiveFirstTouch?.walletCohort || null,
    firstConditioningWalletCohort: firstConditioningTouch?.walletCohort || null,
    walletSummary
  };
}

function addOutcomes(attempt, snapshotsByMint) {
  const snapshots = snapshotsByMint.get(attempt.mint) || [];
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = buildOutcomeWindow(attempt, snapshots, seconds, {
      referenceTouch: attempt.qualifyingFirstTouch
    });
  }
  const preDecisionContext = buildPreDecisionContext(attempt, snapshots, attempt.qualifyingFirstTouch);
  return { ...attempt, windows, preDecisionContext };
}

async function readTelemetry(filePath) {
  const walletCohortIndex = buildWalletCohortIndex();
  const snapshotsByMint = new Map();
  const attempts = [];
  const eventCounts = {};
  let malformedLines = 0;
  let startMs = Infinity;
  let endMs = -Infinity;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    const eventType = event.type || event.event || 'unknown';
    eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
    const atMs = timestampMs(payloadOf(event).timestamp || event.timestamp);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }

    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }

    const attempt = shadowAttemptFromEvent(event, walletCohortIndex);
    if (attempt) attempts.push(attempt);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  attempts.sort((a, b) => a.atMs - b.atMs);

  return {
    snapshotsByMint,
    attempts,
    eventCounts,
    malformedLines,
    walletCohortIndexSize: walletCohortIndex.size,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null
  };
}

function summarize(outcomes) {
  const wouldEnterRows = outcomes.filter((row) => row.wouldEnter);
  const wouldSkipRows = outcomes.filter((row) => !row.wouldEnter);
  const withAnyWalletTouch = outcomes.filter((row) => Number(row.walletTouchCount || 0) > 0);
  const withQualifyingFirstTouch = outcomes.filter((row) => row.qualifyingFirstTouch);
  const withPositiveOrProvenTouch = outcomes.filter((row) => Number(row.positiveOrProvenTouchCount || 0) > 0);
  const withAvoidTouch = outcomes.filter((row) => Number(row.avoidTouchCount || 0) > 0);
  const uniqueFirstByMint = new Map();
  for (const row of wouldEnterRows) {
    if (!uniqueFirstByMint.has(row.mint)) uniqueFirstByMint.set(row.mint, row);
  }
  const uniqueRows = Array.from(uniqueFirstByMint.values());
  const windowSummary = {};
  for (const seconds of WINDOWS_SECONDS) {
    const key = `${seconds}s`;
    const joinedRows = wouldEnterRows.filter((row) => row.windows[key]?.outcomeJoined);
    const missingRows = wouldEnterRows.filter((row) => !row.windows[key]?.outcomeJoined);
    windowSummary[key] = {
      attemptsWithFuture: joinedRows.length,
      attemptsMissingFuture: missingRows.length,
      outcomeJoined: joinedRows.length,
      outcomeMissing: missingRows.length,
      crossed85: wouldEnterRows.filter((row) => row.windows[key]?.crossed85).length,
      crossed90: wouldEnterRows.filter((row) => row.windows[key]?.crossed90).length,
      crossed95: wouldEnterRows.filter((row) => row.windows[key]?.crossed95).length,
      uniqueCrossed85: uniqueRows.filter((row) => row.windows[key]?.crossed85).length,
      uniqueCrossed90: uniqueRows.filter((row) => row.windows[key]?.crossed90).length,
      curveDelta: stat(joinedRows.map((row) => row.windows[key]?.curveDelta), 6),
      maxPriceDeltaPct: stat(joinedRows.map((row) => row.windows[key]?.maxPriceDeltaPct), 4),
      priceJoinStatusCounts: countBy(joinedRows, (row) => row.windows[key]?.priceJoinStatus),
      staticFuturePriceSeries: joinedRows.filter((row) => row.windows[key]?.priceJoinStatus === 'STATIC_FUTURE_PRICE_SERIES').length,
      missingPriceJoin: joinedRows.filter((row) => ['MISSING_BASE_PRICE', 'MISSING_FUTURE_PRICE'].includes(row.windows[key]?.priceJoinStatus)).length,
      touchCurveAboveWindowMax: joinedRows.filter((row) => row.windows[key]?.touchCurveAboveWindowMax).length
    };
  }
  const preDecisionContexts = wouldEnterRows.map((row) => row.preDecisionContext || {});
  const qualifyingRows = wouldEnterRows.filter((row) => row.qualifyingFirstTouch);
  const qualifyingFirstTouchIntegrity = {
    frozenCondition: FROZEN_WALLET_RULE.condition,
    frozenRule: FROZEN_WALLET_RULE.rule,
    clarification: FROZEN_WALLET_RULE.clarification,
    qualifyingSamples: qualifyingRows.length,
    qualifyingFirstTouchBuy: qualifyingRows.filter((row) => isBuyTouch(row.qualifyingFirstTouch)).length,
    qualifyingFirstTouchPositiveOrProven: qualifyingRows.filter((row) => isPositiveOrProvenTouch(row.qualifyingFirstTouch)).length,
    qualifyingFirstTouchAvoidOrNegative: qualifyingRows.filter((row) => isAvoidOrNegativeTouch(row.qualifyingFirstTouch)).length,
    qualifyingFirstTouchNeitherPositiveNorAvoid: qualifyingRows.filter((row) => (
      !isPositiveOrProvenTouch(row.qualifyingFirstTouch)
      && !isAvoidOrNegativeTouch(row.qualifyingFirstTouch)
    )).length,
    withAnyPositiveOrProvenTouch: wouldEnterRows.filter((row) => Number(row.positiveOrProvenTouchCount || 0) > 0).length,
    withAnyAvoidOrNegativeTouch: wouldEnterRows.filter((row) => Number(row.avoidTouchCount || 0) > 0).length,
    positiveOnlySiblingSamples: qualifyingRows.filter((row) => isBuyTouch(row.qualifyingFirstTouch) && isPositiveOrProvenTouch(row.qualifyingFirstTouch)).length,
    excludeAvoidSiblingSamples: qualifyingRows.filter((row) => isBuyTouch(row.qualifyingFirstTouch) && !Number(row.avoidTouchCount || 0)).length
  };

  return {
    attempts: outcomes.length,
    wouldEnter: wouldEnterRows.length,
    wouldSkip: wouldSkipRows.length,
    uniqueWouldEnterMints: uniqueRows.length,
    contextCoverage: {
      withAnyWalletTouch: withAnyWalletTouch.length,
      withNoWalletTouch: outcomes.length - withAnyWalletTouch.length,
      withQualifyingFirstTouch: withQualifyingFirstTouch.length,
      withPositiveOrProvenTouch: withPositiveOrProvenTouch.length,
      withAvoidTouch: withAvoidTouch.length,
      walletContextSources: countBy(outcomes, (row) => row.walletContextSource || (Number(row.walletTouchCount || 0) > 0 ? 'unknown_context' : 'none'))
    },
    qualifyingFirstTouchIntegrity,
    preDecisionContextSummary: {
      joined: preDecisionContexts.filter((row) => row.joined).length,
      missing: preDecisionContexts.filter((row) => !row.joined).length,
      fadedFromTouchBeforeDecision: preDecisionContexts.filter((row) => row.fadedFromTouchBeforeDecision).length,
      fadedFromPreDecisionMax: preDecisionContexts.filter((row) => row.fadedFromPreDecisionMax).length,
      reasonCounts: countBy(preDecisionContexts, (row) => row.reason)
    },
    sourceReasonCounts: countBy(outcomes, (row) => row.sourceReason),
    wouldEnterSourceReasonCounts: countBy(wouldEnterRows, (row) => row.sourceReason),
    wouldSkipSourceReasonCounts: countBy(wouldSkipRows, (row) => row.sourceReason),
    shadowReasonCounts: countBy(outcomes, (row) => row.shadowReason),
    qualifyingFirstTouchCohortCounts: countBy(wouldEnterRows, (row) => row.qualifyingFirstTouch?.walletCohort),
    positiveFirstTouchCohortCounts: countBy(wouldEnterRows, (row) => row.positiveFirstTouch?.walletCohort),
    wouldEnterByCohort: Object.fromEntries(
      Object.entries(
        wouldEnterRows.reduce((acc, row) => {
          const cohort = row.qualifyingFirstTouch?.walletCohort || 'unknown';
          const bucket = acc[cohort] || {
            attempts: 0,
            uniqueMints: new Set(),
            withPositiveOrProvenTouch: 0,
            withAvoidTouch: 0,
            crossed85Within120s: 0,
            crossed90Within120s: 0,
            crossed90Within300s: 0
          };
          bucket.attempts += 1;
          if (row.mint) bucket.uniqueMints.add(row.mint);
          if (Number(row.positiveOrProvenTouchCount || 0) > 0) bucket.withPositiveOrProvenTouch += 1;
          if (Number(row.avoidTouchCount || 0) > 0) bucket.withAvoidTouch += 1;
          if (row.windows['120s']?.crossed85) bucket.crossed85Within120s += 1;
          if (row.windows['120s']?.crossed90) bucket.crossed90Within120s += 1;
          if (row.windows['300s']?.crossed90) bucket.crossed90Within300s += 1;
          acc[cohort] = bucket;
          return acc;
        }, {})
      ).map(([cohort, bucket]) => [cohort, {
        ...bucket,
        uniqueMints: bucket.uniqueMints.size
      }])
    ),
    qualifyingFirstTouchReviewTierCounts: countBy(wouldEnterRows, (row) => row.qualifyingFirstTouch?.reviewTier),
    qualifyingFirstTouchEvidenceTierCounts: countBy(wouldEnterRows, (row) => row.qualifyingFirstTouch?.evidenceTier),
    positiveFirstTouchReviewTierCounts: countBy(wouldEnterRows, (row) => row.positiveFirstTouch?.reviewTier),
    positiveFirstTouchEvidenceTierCounts: countBy(wouldEnterRows, (row) => row.positiveFirstTouch?.evidenceTier),
    windowSummary
  };
}

function topRows(outcomes, limit = 12) {
  return outcomes
    .filter((row) => row.wouldEnter)
    .slice()
    .sort((a, b) => {
      const bCross = b.windows['120s']?.crossed90 ? 1 : 0;
      const aCross = a.windows['120s']?.crossed90 ? 1 : 0;
      if (bCross !== aCross) return bCross - aCross;
      return Number(b.windows['120s']?.curveDelta || 0) - Number(a.windows['120s']?.curveDelta || 0);
    })
    .slice(0, limit)
    .map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      at: row.at,
      sourceReason: row.sourceReason,
      score: row.score,
      curveProgress: row.curveProgress,
      qualifyingFirstTouch: row.qualifyingFirstTouch,
      positiveFirstTouch: row.positiveFirstTouch,
      max30: row.windows['30s']?.maxCurveProgress,
      max120: row.windows['120s']?.maxCurveProgress,
      max300: row.windows['300s']?.maxCurveProgress,
      outcomeJoined120s: row.windows['120s']?.outcomeJoined || false,
      curveDelta120s: row.windows['120s']?.curveDelta,
      priceDelta120sPct: row.windows['120s']?.maxPriceDeltaPct,
      crossed90Within120s: row.windows['120s']?.crossed90
    }));
}

function ledgerSamples(outcomes, telemetryPath) {
  return outcomes
    .filter((row) => row.wouldEnter)
    .map((row) => ({
      era: 'wallet_relaxed_shadow_v1_2026-07-08',
      frozenSlice: row.shadowProfile || FROZEN_WALLET_SLICE,
      frozenRule: FROZEN_WALLET_RULE,
      outcomeJoinSchemaVersion: 2,
      outcomeJoinFixEra: WALLET_CHECKPOINT_DISPOSITION.postFixSampleEra,
      cohort: row.qualifyingFirstTouch?.walletCohort || 'unknown',
      telemetryPath: path.relative(ROOT, telemetryPath).replace(/\\/g, '/'),
      mint: row.mint,
      symbol: row.symbol,
      at: row.at,
      atMs: row.atMs,
      sourceReason: row.sourceReason,
      sourcePreset: row.sourcePreset,
      score: row.score,
      curveProgress: row.curveProgress,
      priceSol: row.priceSol,
      withPositiveOrProvenTouch: Number(row.positiveOrProvenTouchCount || 0) > 0,
      withAvoidTouch: Number(row.avoidTouchCount || 0) > 0,
      qualifyingFirstTouchPositiveOrProven: isPositiveOrProvenTouch(row.qualifyingFirstTouch),
      qualifyingFirstTouchAvoidOrNegative: isAvoidOrNegativeTouch(row.qualifyingFirstTouch),
      positiveOrProvenTouchCount: row.positiveOrProvenTouchCount,
      avoidTouchCount: row.avoidTouchCount,
      qualifyingFirstTouch: row.qualifyingFirstTouch,
      positiveFirstTouch: row.positiveFirstTouch,
      firstConditioningTouch: row.firstConditioningTouch,
      preDecisionContext: row.preDecisionContext,
      walletTouchCount: row.walletTouchCount,
      walletContextSource: row.walletContextSource,
      walletContextJoinMiss: row.walletContextJoinMiss || null,
      windows: row.windows
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveTelemetryPath(ROOT, {
    telemetry: args.telemetry,
    reportTelemetry: telemetryFromBattlefield()
  }) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  }
  const outputPath = args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH;
  const telemetry = await readTelemetry(telemetryPath);
  const outcomes = telemetry.attempts.map((attempt) => addOutcomes(attempt, telemetry.snapshotsByMint));
  const beforeAppendSummary = summarizeLedger({ frozenSlice: FROZEN_WALLET_SLICE });
  const beforeAppendEvaluation = beforeAppendSummary.postFixCleanSamples >= 10
    ? evaluateWalletCheckpoint({ ledgerPath: beforeAppendSummary.ledgerPath, frozenSlice: FROZEN_WALLET_SLICE })
    : null;
  const terminalBeforeAppend = ['FAILED_CLEAN_CHECKPOINT', 'PASSED_CLEAN_CHECKPOINT_REPORT_ONLY']
    .includes(beforeAppendEvaluation?.checkpoint?.disposition);
  const ledgerAppend = terminalBeforeAppend
    ? {
      ledgerPath: beforeAppendSummary.ledgerPath,
      appended: 0,
      existing: beforeAppendSummary.totalRows,
      total: beforeAppendSummary.totalRows,
      closed: true,
      reason: beforeAppendEvaluation.checkpoint.disposition,
      closedBeforeWrite: true
    }
    : appendSamples(ledgerSamples(outcomes, telemetryPath));
  const ledgerSummary = summarizeLedger({
    frozenSlice: FROZEN_WALLET_SLICE
  });
  const checkpointEvaluation = evaluateWalletCheckpoint({
    ledgerPath: ledgerSummary.ledgerPath,
    frozenSlice: FROZEN_WALLET_SLICE
  });
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_relaxed_shadow_outcome',
    note: 'Report-only follow-through for pre_migration_wallet_relaxed_shadow would-enter/would-skip telemetry. Does not alter runtime gates.',
    frozenHypothesis: {
      name: FROZEN_WALLET_SLICE,
      ...FROZEN_WALLET_RULE
    },
    checkpointDisposition: WALLET_CHECKPOINT_DISPOSITION,
    checkpointEvaluation,
    sources: {
      telemetryPath: path.relative(ROOT, telemetryPath).replace(/\\/g, '/')
    },
    inputs: {
      startAt: telemetry.startAt,
      endAt: telemetry.endAt,
      malformedLines: telemetry.malformedLines,
      shadowEvents: telemetry.attempts.length,
      snapshotMints: telemetry.snapshotsByMint.size,
      walletCohortIndexSize: telemetry.walletCohortIndexSize
    },
    ledger: {
      append: {
        ...ledgerAppend,
        ledgerPath: path.relative(ROOT, ledgerAppend.ledgerPath).replace(/\\/g, '/')
      },
      summary: {
        ...ledgerSummary,
        ledgerPath: path.relative(ROOT, ledgerSummary.ledgerPath).replace(/\\/g, '/')
      }
    },
    summary: summarize(outcomes),
    topWouldEnterFollowThrough: topRows(outcomes),
    rows: outcomes
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`Wallet-relaxed shadow would_enter follow-through: ${report.summary.wouldEnter} attempts, ${report.summary.uniqueWouldEnterMints} unique mints`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
