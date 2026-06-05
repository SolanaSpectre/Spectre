#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const PROMOTION_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const WALLET_EVENTS_PATH = path.join(ROOT, 'data', 'wallet-events', 'events.jsonl');
const LAUNCH_INTEL_WALLET_INDEX_PATH = path.join(ROOT, 'data', 'launch-intel', 'wallet-index.json');
const MANUAL_KOL_WALLET_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-context-coverage-latest.json');

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

function telemetryFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return report.files?.telemetryPath || report.telemetryPath || null;
  } catch {
    return null;
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function fileSummary(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      exists: true,
      bytes: stat.size,
      lastModifiedAt: stat.mtime.toISOString()
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      bytes: 0,
      lastModifiedAt: null
    };
  }
}

function countManualKolWallets(filePath = MANUAL_KOL_WALLET_PATH) {
  const parsed = readJson(filePath, null);
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed.length;
  if (Array.isArray(parsed.wallets)) return parsed.wallets.length;
  if (Array.isArray(parsed.trackedWallets)) return parsed.trackedWallets.length;
  return Object.values(parsed).filter((value) => value && typeof value === 'object').length || null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function compact(value, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function walletOf(payload) {
  return payload.wallet || payload.traderPublicKey || payload.account || null;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function topCounts(rows, keyFn, limit = 12) {
  return Object.entries(countBy(rows, keyFn))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function uniqueCount(rows, keyFn) {
  return new Set(rows.map(keyFn).filter(Boolean)).size;
}

function makePromotionIndex(filePath = PROMOTION_PATH) {
  const parsed = readJson(filePath, {});
  const byAddress = new Map();
  const byName = new Map();
  const groups = [
    ['trustReview', parsed.trustReview],
    ['profitableNeedsFirstTouchEvidence', parsed.profitableNeedsFirstTouchEvidence],
    ['watchReview', parsed.watchReview],
    ['avoidReview', parsed.avoidReview],
    ['hold', parsed.hold]
  ];

  for (const [group, rows] of groups) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const item = {
        group,
        walletAddress: row.walletAddress || null,
        name: row.name || null,
        reviewTier: row.reviewTier || null,
        evidenceTier: row.evidenceTier || null
      };
      if (item.walletAddress) byAddress.set(item.walletAddress, item);
      const nameKey = canonicalName(item.name, item.walletAddress);
      if (nameKey) byName.set(nameKey, item);
    }
  }

  return {
    path: filePath,
    byAddress,
    byName,
    groupCounts: Object.fromEntries(groups.map(([group, rows]) => [group, Array.isArray(rows) ? rows.length : 0]))
  };
}

function canonicalName(name, walletAddress) {
  const label = String(name || walletAddress || '').trim();
  if (/^Cupsey(?:\s+\d+)?$/i.test(label)) return 'Cupsey';
  return label || null;
}

function promotionFor(promotionIndex, wallet, name = null) {
  if (wallet && promotionIndex.byAddress.has(wallet)) return promotionIndex.byAddress.get(wallet);
  const nameKey = canonicalName(name, wallet);
  return nameKey ? promotionIndex.byName.get(nameKey) || null : null;
}

function walletRowsFromContext(context = {}) {
  return Array.isArray(context.wallets) ? context.wallets : [];
}

function isPositiveOrProven(row = {}) {
  return ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(row.evidenceTier)
    || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(row.reviewTier);
}

function isAvoid(row = {}) {
  return row.evidenceTier === 'NEGATIVE_EVIDENCE' || row.reviewTier === 'AVOID_REVIEW';
}

function summarizeWalletContext(context = {}) {
  const wallets = walletRowsFromContext(context);
  return {
    anyTouch: wallets.length > 0,
    touchCount: wallets.length,
    positiveOrProvenTouchCount: wallets.filter(isPositiveOrProven).length,
    avoidTouchCount: wallets.filter(isAvoid).length,
    contextSource: context.contextSource || null,
    earliestTouchAt: context.earliestTouchAt || null,
    earliestBuyAt: context.earliestBuyAt || null
  };
}

async function readJsonl(filePath, onRow) {
  if (!filePath || !fs.existsSync(filePath)) return { rows: 0, malformed: 0 };
  let rows = 0;
  let malformed = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformed += 1;
      continue;
    }
    rows += 1;
    onRow(row);
  }
  return { rows, malformed };
}

async function summarizeHistoricalLedger(promotionIndex) {
  const rows = [];
  await readJsonl(WALLET_EVENTS_PATH, (row) => rows.push(row));
  const withPromotion = rows.map((row) => {
    const promotion = promotionFor(promotionIndex, row.wallet, row.walletProfile?.name);
    return { ...row, promotion };
  });
  return {
    path: WALLET_EVENTS_PATH,
    rows: rows.length,
    uniqueWallets: uniqueCount(rows, (row) => row.wallet),
    uniqueMints: uniqueCount(rows, (row) => row.mint),
    sideCounts: countBy(rows, (row) => row.side),
    phaseCounts: countBy(rows, (row) => row.phase),
    watchedReasonCounts: countBy(rows, (row) => row.watchedReason),
    promotionCoverage: {
      rowsWithPromotion: withPromotion.filter((row) => row.promotion).length,
      positiveOrProvenRows: withPromotion.filter((row) => isPositiveOrProven(row.promotion || {})).length,
      avoidRows: withPromotion.filter((row) => isAvoid(row.promotion || {})).length,
      reviewTierCounts: countBy(withPromotion, (row) => row.promotion?.reviewTier || 'none'),
      evidenceTierCounts: countBy(withPromotion, (row) => row.promotion?.evidenceTier || 'none')
    },
    topWallets: topCounts(rows, (row) => row.wallet),
    topMints: topCounts(rows, (row) => row.mint)
  };
}

function addDecisionCoverage(target, event, promotionIndex) {
  const payload = payloadOf(event);
  const reason = payload.reason || payload.skipReason || payload.decision || 'unknown';
  const mint = mintOf(payload);
  const context = payload.walletClassificationContext || {};
  const summarized = summarizeWalletContext(context);
  target.total += 1;
  if (mint) target.mints.add(mint);
  if (summarized.anyTouch) target.withAny += 1;
  if (summarized.positiveOrProvenTouchCount > 0) target.withPositiveOrProven += 1;
  if (summarized.avoidTouchCount > 0) target.withAvoid += 1;
  target.contextSources[summarized.contextSource || 'none'] = (target.contextSources[summarized.contextSource || 'none'] || 0) + 1;
  target.byReason[reason] ||= {
    decisions: 0,
    uniqueMints: new Set(),
    withAny: 0,
    withPositiveOrProven: 0,
    withAvoid: 0,
    contextSources: {}
  };
  const bucket = target.byReason[reason];
  bucket.decisions += 1;
  if (mint) bucket.uniqueMints.add(mint);
  if (summarized.anyTouch) bucket.withAny += 1;
  if (summarized.positiveOrProvenTouchCount > 0) bucket.withPositiveOrProven += 1;
  if (summarized.avoidTouchCount > 0) bucket.withAvoid += 1;
  bucket.contextSources[summarized.contextSource || 'none'] = (bucket.contextSources[summarized.contextSource || 'none'] || 0) + 1;

  if (summarized.anyTouch && target.sampleRows.length < 12) {
    target.sampleRows.push({
      type: event.type || event.event || null,
      mint,
      reason,
      score: compact(payload.score, 2),
      curveProgress: compact(payload.curveProgress ?? payload.providerCurveProgress ?? payload.paperCurveProgress, 6),
      context: summarized,
      wallets: walletRowsFromContext(context).slice(0, 4).map((wallet) => {
        const promotion = promotionFor(promotionIndex, wallet.wallet, wallet.name);
        return {
          wallet: wallet.wallet,
          name: wallet.name || promotion?.name || null,
          side: wallet.side || null,
          label: wallet.label || null,
          reviewTier: wallet.reviewTier || promotion?.reviewTier || null,
          evidenceTier: wallet.evidenceTier || promotion?.evidenceTier || null,
          tradeAt: wallet.tradeAt || null
        };
      })
    });
  }
}

function finalizeDecisionCoverage(coverage) {
  return {
    decisions: coverage.total,
    uniqueMints: coverage.mints.size,
    withAnyWalletTouch: coverage.withAny,
    withPositiveOrProvenTouch: coverage.withPositiveOrProven,
    withAvoidTouch: coverage.withAvoid,
    contextSources: coverage.contextSources,
    byReason: Object.fromEntries(Object.entries(coverage.byReason)
      .sort((a, b) => b[1].decisions - a[1].decisions)
      .map(([reason, row]) => [reason, {
        decisions: row.decisions,
        uniqueMints: row.uniqueMints.size,
        withAnyWalletTouch: row.withAny,
        withPositiveOrProvenTouch: row.withPositiveOrProven,
        withAvoidTouch: row.withAvoid,
        contextSources: row.contextSources
      }])),
    sampleRows: coverage.sampleRows
  };
}

async function summarizeTelemetry(filePath, promotionIndex) {
  const walletEvents = [];
  const decisionCoverage = {
    total: 0,
    mints: new Set(),
    withAny: 0,
    withPositiveOrProven: 0,
    withAvoid: 0,
    contextSources: {},
    byReason: {},
    sampleRows: []
  };
  const shadow = {
    attempts: 0,
    wouldEnter: 0,
    wouldSkip: 0,
    mints: new Set(),
    withAny: 0,
    withPositiveOrProven: 0,
    withAvoid: 0,
    sourceReasons: {},
    contextSources: {}
  };
  const eventCounts = {};
  let startMs = Infinity;
  let endMs = -Infinity;

  const readStats = await readJsonl(filePath, (event) => {
    const type = event.type || event.event || 'unknown';
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    const payload = payloadOf(event);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }

    if (type === 'wallet.trade_observed') {
      const promotion = promotionFor(promotionIndex, walletOf(payload), payload.name || payload.profile);
      walletEvents.push({ ...payload, promotion });
      return;
    }

    if (type === 'pre_migration_paper.decision') {
      addDecisionCoverage(decisionCoverage, event, promotionIndex);
      return;
    }

    if (type === 'pre_migration_wallet_relaxed_shadow.would_enter' || type === 'pre_migration_wallet_relaxed_shadow.would_skip') {
      const context = {
        wallets: [],
        contextSource: payload.walletContextSource || null
      };
      if (payload.walletTouchCount > 0) {
        context.wallets = new Array(Number(payload.walletTouchCount || 0)).fill({});
      }
      const summary = {
        anyTouch: Number(payload.walletTouchCount || 0) > 0,
        positiveOrProvenTouchCount: Number(payload.positiveOrProvenTouchCount || 0),
        avoidTouchCount: Number(payload.avoidTouchCount || 0),
        contextSource: payload.walletContextSource || null
      };
      shadow.attempts += 1;
      shadow.wouldEnter += type.endsWith('.would_enter') ? 1 : 0;
      shadow.wouldSkip += type.endsWith('.would_skip') ? 1 : 0;
      const mint = mintOf(payload);
      if (mint) shadow.mints.add(mint);
      if (summary.anyTouch) shadow.withAny += 1;
      if (summary.positiveOrProvenTouchCount > 0) shadow.withPositiveOrProven += 1;
      if (summary.avoidTouchCount > 0) shadow.withAvoid += 1;
      shadow.sourceReasons[payload.sourceReason || 'unknown'] = (shadow.sourceReasons[payload.sourceReason || 'unknown'] || 0) + 1;
      shadow.contextSources[summary.contextSource || (summary.anyTouch ? 'unknown' : 'none')] =
        (shadow.contextSources[summary.contextSource || (summary.anyTouch ? 'unknown' : 'none')] || 0) + 1;
      void context;
    }
  });

  const walletMints = new Set(walletEvents.map((event) => event.mint).filter(Boolean));
  const decisionMints = decisionCoverage.mints;
  const overlap = [...walletMints].filter((mint) => decisionMints.has(mint)).length;
  const promoted = walletEvents.filter((event) => event.promotion);
  const providerTradeEvents = Number(eventCounts['provider.pumpdev.runtime_trade'] || 0)
    + Number(eventCounts['provider.pumpportal.trade'] || 0);

  return {
    path: filePath,
    malformedLines: readStats.malformed,
    eventCounts,
    durationMinutes: Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? compact((endMs - startMs) / 60000, 2)
      : null,
    walletEvents: {
      rows: walletEvents.length,
      uniqueWallets: uniqueCount(walletEvents, (event) => walletOf(event)),
      uniqueMints: walletMints.size,
      sideCounts: countBy(walletEvents, (event) => event.side),
      phaseCounts: countBy(walletEvents, (event) => event.phase),
      profileCounts: countBy(walletEvents, (event) => event.profile || event.walletProfile?.profile),
      classificationCounts: countBy(walletEvents, (event) => event.classification),
      watchedReasonCounts: countBy(walletEvents, (event) => event.watchedReason),
      promotionCoverage: {
        rowsWithPromotion: promoted.length,
        positiveOrProvenRows: promoted.filter((event) => isPositiveOrProven(event.promotion || {})).length,
        avoidRows: promoted.filter((event) => isAvoid(event.promotion || {})).length,
        reviewTierCounts: countBy(walletEvents, (event) => event.promotion?.reviewTier || 'none'),
        evidenceTierCounts: countBy(walletEvents, (event) => event.promotion?.evidenceTier || 'none')
      },
      topWallets: topCounts(walletEvents, (event) => walletOf(event)),
      topMints: topCounts(walletEvents, (event) => event.mint),
      samples: walletEvents.slice(0, 12).map((event) => ({
        mint: event.mint || null,
        wallet: walletOf(event),
        side: event.side || null,
        phase: event.phase || null,
        profile: event.profile || null,
        classification: event.classification || null,
        reviewTier: event.promotion?.reviewTier || null,
        evidenceTier: event.promotion?.evidenceTier || null
      }))
    },
    trackingOpportunity: {
      providerTradeEvents,
      walletTradeObservedEvents: walletEvents.length,
      walletObservedHitRate: providerTradeEvents > 0 ? compact(walletEvents.length / providerTradeEvents, 6) : null
    },
    decisionCoverage: finalizeDecisionCoverage(decisionCoverage),
    walletDecisionMintOverlap: {
      uniqueWalletEventMints: walletMints.size,
      uniqueDecisionMints: decisionMints.size,
      overlapMints: overlap
    },
    walletRelaxedShadowCoverage: {
      attempts: shadow.attempts,
      wouldEnter: shadow.wouldEnter,
      wouldSkip: shadow.wouldSkip,
      uniqueMints: shadow.mints.size,
      withAnyWalletTouch: shadow.withAny,
      withPositiveOrProvenTouch: shadow.withPositiveOrProven,
      withAvoidTouch: shadow.withAvoid,
      sourceReasonCounts: shadow.sourceReasons,
      contextSources: shadow.contextSources
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || '(none)'}`);
  }

  const promotionIndex = makePromotionIndex(PROMOTION_PATH);
  const [historicalLedger, runtime] = await Promise.all([
    summarizeHistoricalLedger(promotionIndex),
    summarizeTelemetry(telemetryPath, promotionIndex)
  ]);

  const verdict = runtime.walletRelaxedShadowCoverage.withPositiveOrProvenTouch > 0
    ? 'WALLET_RELAXED_SIGNAL_OBSERVED'
    : (runtime.walletRelaxedShadowCoverage.withAnyWalletTouch > 0
      ? 'BROAD_TRACKED_WALLET_SIGNAL_OBSERVED'
    : (runtime.walletEvents.promotionCoverage.positiveOrProvenRows > 0
      ? 'POSITIVE_WALLET_TOUCHES_PRESENT_BUT_NOT_IN_SHADOW_LANE'
      : 'PROSPECTIVE_WALLET_SIGNAL_STARVED'));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_context_coverage',
    verdict,
    sources: {
      telemetryPath,
      walletEventLedgerPath: WALLET_EVENTS_PATH,
      walletPromotionReviewPath: PROMOTION_PATH,
      launchIntelWalletIndexPath: LAUNCH_INTEL_WALLET_INDEX_PATH,
      manualKolWalletPath: MANUAL_KOL_WALLET_PATH
    },
    trackingSubstrate: {
      launchIntelWalletIndex: fileSummary(LAUNCH_INTEL_WALLET_INDEX_PATH),
      manualKolWallets: {
        ...fileSummary(MANUAL_KOL_WALLET_PATH),
        configuredWalletCount: countManualKolWallets(MANUAL_KOL_WALLET_PATH)
      },
      walletEventLedger: fileSummary(WALLET_EVENTS_PATH)
    },
    promotionReview: {
      groupCounts: promotionIndex.groupCounts,
      totalAddresses: promotionIndex.byAddress.size
    },
    historicalLedger,
    runtime,
    interpretation: {
      liveBroadcastImplication: 'none_report_only',
      summary: verdict === 'BROAD_TRACKED_WALLET_SIGNAL_OBSERVED'
        ? 'Runtime saw tracked wallet touches feeding the broadened wallet-relaxed shadow lane; inspect outcome follow-through before any runtime use.'
        : (verdict === 'PROSPECTIVE_WALLET_SIGNAL_STARVED'
        ? 'Runtime saw provider trade flow but no tracked wallet.trade_observed events, so wallet-conditioned lanes cannot collect fresh runtime evidence from this run.'
        : 'Runtime saw at least some promoted wallet signal; inspect shadow coverage before considering any runtime use.')
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(`Wrote wallet context coverage report: ${OUTPUT_PATH}`);
  console.log(`Verdict: ${verdict}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
