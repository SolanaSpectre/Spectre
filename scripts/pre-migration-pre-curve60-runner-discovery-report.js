#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-pre-curve60-runner-discovery-latest.json');
const WALLET_EVENTS_PATH = path.join(ROOT, 'data', 'wallet-events', 'events.jsonl');
const PROMOTION_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const MANUAL_KOL_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const DEFAULT_LIMIT = 8;
const THRESHOLDS = [0.6, 0.85, 0.9];

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

function telemetryFiles(limit = DEFAULT_LIMIT) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath)
    .reverse();
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

function walletOf(payload = {}) {
  return payload.wallet || payload.traderPublicKey || payload.account || null;
}

function readJson(filePath, fallback = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function walletSetFromManualKol(parsed = {}) {
  const rows = Array.isArray(parsed) ? parsed : (parsed.wallets || parsed.trackedWallets || []);
  return new Set(rows
    .map((row) => typeof row === 'string' ? row : row?.walletAddress || row?.wallet || row?.address)
    .filter(Boolean));
}

function makePromotionIndex(promotionPath = PROMOTION_PATH, manualPath = MANUAL_KOL_PATH) {
  const promotion = readJson(promotionPath, {});
  const manualWallets = walletSetFromManualKol(readJson(manualPath, {}));
  const byAddress = new Map();
  const groups = [
    ['trustReview', promotion.trustReview],
    ['profitableNeedsFirstTouchEvidence', promotion.profitableNeedsFirstTouchEvidence],
    ['watchReview', promotion.watchReview],
    ['avoidReview', promotion.avoidReview],
    ['hold', promotion.hold]
  ];

  for (const [group, rows] of groups) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const wallet = row.walletAddress || row.wallet || row.address || null;
      if (!wallet) continue;
      byAddress.set(wallet, {
        wallet,
        group,
        name: row.name || null,
        reviewTier: row.reviewTier || null,
        evidenceTier: row.evidenceTier || null,
        source: 'promotion_review'
      });
    }
  }

  for (const wallet of manualWallets) {
    if (byAddress.has(wallet)) continue;
    byAddress.set(wallet, {
      wallet,
      group: 'manualKolWallets',
      name: null,
      reviewTier: 'MANUAL_KOL_WATCHLIST',
      evidenceTier: null,
      source: 'manual_kol_watchlist'
    });
  }

  return { byAddress };
}

function isBuy(row = {}) {
  return String(row.side || row.txType || '').toLowerCase() === 'buy';
}

function isPositiveOrProven(row = {}) {
  return ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(row.evidenceTier)
    || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(row.reviewTier);
}

function isAvoid(row = {}) {
  return row.evidenceTier === 'NEGATIVE_EVIDENCE' || row.reviewTier === 'AVOID_REVIEW';
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.accountCurveProgress
    ?? payload.paperCurveProgress
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
    ?? payload.entryPriceSol
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
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
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

function getMint(rowsByMint, mint, payload = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: payload.symbol || null,
      snapshots: [],
      observedAt: [],
      flaggedAt: [],
      evaluatedAt: [],
      paperEntryAt: [],
      nearMissAt: [],
      reasons: {},
      failedChecks: {},
      walletEvents: [],
      maxScore: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxUniqueBuyerCount: null,
      maxSniperWalletCount: null
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  return row;
}

function updateMax(row, key, value) {
  const number = Number(value);
  if (Number.isFinite(number)) row[key] = row[key] === null ? number : Math.max(row[key], number);
}

function emptyWalletSignal() {
  return {
    anyWalletTouch: false,
    trustedTouch: false,
    trustedPre85Buy: false,
    positiveOrProvenTouch: false,
    positiveOrProvenPre85Buy: false,
    prospectiveTouch: false,
    prospectivePre85Buy: false,
    rawUntrustedTouch: false,
    rawUntrustedPre85Buy: false,
    avoidTouch: false,
    uniqueWallets: new Set(),
    sampleWallets: []
  };
}

function addWalletSample(signal, row = {}, meta = null) {
  const wallet = row.wallet || meta?.wallet || null;
  if (wallet) signal.uniqueWallets.add(wallet);
  if (wallet && signal.sampleWallets.length < 5) {
    signal.sampleWallets.push({
      wallet,
      name: row.name || meta?.name || row.walletProfile?.name || null,
      side: row.side || row.txType || null,
      reviewTier: row.reviewTier || meta?.reviewTier || null,
      evidenceTier: row.evidenceTier || meta?.evidenceTier || null,
      curveProgress: compact(row.curveProgress ?? row.market?.curveProgress, 6),
      tradeAt: row.tradeAt || row.observedAt || null,
      source: row.source || meta?.source || null
    });
  }
}

function mergeWalletSignal(target, source = {}) {
  for (const key of [
    'anyWalletTouch',
    'trustedTouch',
    'trustedPre85Buy',
    'positiveOrProvenTouch',
    'positiveOrProvenPre85Buy',
    'prospectiveTouch',
    'prospectivePre85Buy',
    'rawUntrustedTouch',
    'rawUntrustedPre85Buy',
    'avoidTouch'
  ]) {
    target[key] = Boolean(target[key] || source[key]);
  }
  for (const wallet of source.uniqueWallets || []) target.uniqueWallets.add(wallet);
  for (const sample of source.sampleWallets || []) {
    if (target.sampleWallets.length >= 5) break;
    target.sampleWallets.push(sample);
  }
  return target;
}

function finalizeWalletSignal(signal = emptyWalletSignal()) {
  return {
    anyWalletTouch: Boolean(signal.anyWalletTouch),
    trustedTouch: Boolean(signal.trustedTouch),
    trustedPre85Buy: Boolean(signal.trustedPre85Buy),
    positiveOrProvenTouch: Boolean(signal.positiveOrProvenTouch),
    positiveOrProvenPre85Buy: Boolean(signal.positiveOrProvenPre85Buy),
    prospectiveTouch: Boolean(signal.prospectiveTouch),
    prospectivePre85Buy: Boolean(signal.prospectivePre85Buy),
    rawUntrustedTouch: Boolean(signal.rawUntrustedTouch),
    rawUntrustedPre85Buy: Boolean(signal.rawUntrustedPre85Buy),
    avoidTouch: Boolean(signal.avoidTouch),
    uniqueWalletCount: signal.uniqueWallets?.size || 0,
    sampleWallets: signal.sampleWallets || []
  };
}

function walletSignals(payload = {}, promotionIndex = makePromotionIndex()) {
  const proof = payload.walletBridgeProof || {};
  const context = payload.walletClassificationContext || {};
  const signals = payload.walletSignals || {};
  const signal = emptyWalletSignal();

  if (signals.anyTrustedTouch === true || Number(proof.walletTouchCount || 0) > 0 || context.touched === true || context.shadowTouched === true) {
    signal.anyWalletTouch = true;
    signal.trustedTouch = true;
  }
  if (signals.positiveOrProvenTouch === true || Number(proof.positiveOrProvenTouchCount || 0) > 0 || Number(context.positiveTouchCount || context.provenTouchCount || context.provenBuyCount || 0) > 0) {
    signal.anyWalletTouch = true;
    signal.trustedTouch = true;
    signal.positiveOrProvenTouch = true;
  }
  if (signals.rawUntrustedPre85Buy === true || Number(proof.untrustedPre85BuyTouchCount || 0) > 0) {
    signal.anyWalletTouch = true;
    signal.rawUntrustedTouch = true;
    signal.rawUntrustedPre85Buy = true;
  }

  for (const row of Array.isArray(context.wallets) ? context.wallets : []) {
    signal.anyWalletTouch = true;
    signal.trustedTouch = true;
    const positive = isPositiveOrProven(row);
    const buyPre85 = isBuy(row) && (!Number.isFinite(Number(row.curveProgress)) || Number(row.curveProgress) < 0.85);
    if (buyPre85) signal.trustedPre85Buy = true;
    if (positive) signal.positiveOrProvenTouch = true;
    if (positive && buyPre85) signal.positiveOrProvenPre85Buy = true;
    if (isAvoid(row)) signal.avoidTouch = true;
    addWalletSample(signal, row);
  }

  for (const row of Array.isArray(context.shadowWallets) ? context.shadowWallets : []) {
    signal.anyWalletTouch = true;
    signal.trustedTouch = true;
    if (isBuy(row) && (!Number.isFinite(Number(row.curveProgress)) || Number(row.curveProgress) < 0.85)) {
      signal.trustedPre85Buy = true;
    }
    addWalletSample(signal, row);
  }

  for (const row of Array.isArray(context.untrustedWallets) ? context.untrustedWallets : []) {
    const meta = promotionIndex.byAddress.get(row.wallet);
    const buyPre85 = isBuy(row) && (!Number.isFinite(Number(row.curveProgress)) || Number(row.curveProgress) < 0.85);
    signal.anyWalletTouch = true;
    if (meta) {
      signal.prospectiveTouch = true;
      if (buyPre85) signal.prospectivePre85Buy = true;
      if (isPositiveOrProven(meta)) signal.positiveOrProvenTouch = true;
      if (isPositiveOrProven(meta) && buyPre85) signal.positiveOrProvenPre85Buy = true;
      if (isAvoid(meta)) signal.avoidTouch = true;
      addWalletSample(signal, row, meta);
    } else {
      signal.rawUntrustedTouch = true;
      if (buyPre85) signal.rawUntrustedPre85Buy = true;
      addWalletSample(signal, row);
    }
  }

  return finalizeWalletSignal(signal);
}

function walletSignalFromGateDiagnostic(payload = {}, promotionIndex) {
  const signal = emptyWalletSignal();
  const wallet = walletOf(payload);
  const meta = wallet ? promotionIndex.byAddress.get(wallet) : null;
  const buyPre85 = isBuy(payload) && (!Number.isFinite(Number(curveOf(payload))) || Number(curveOf(payload)) < 0.85);
  const recorded = payload.ledgerRecord === true
    || payload.trackedAccountMatch === true
    || payload.kolWalletProfileMatch === true
    || payload.shadowWalletProfileMatch === true
    || payload.watchedWallet === true;
  const raw = payload.untrustedTapeRecord === true || payload.dropReason === 'UNTRACKED_WALLET';

  if (recorded || raw || meta) signal.anyWalletTouch = true;
  if (recorded) {
    signal.trustedTouch = true;
    if (buyPre85) signal.trustedPre85Buy = true;
  }
  if (meta) {
    signal.prospectiveTouch = true;
    if (buyPre85) signal.prospectivePre85Buy = true;
    if (isPositiveOrProven(meta)) signal.positiveOrProvenTouch = true;
    if (isPositiveOrProven(meta) && buyPre85) signal.positiveOrProvenPre85Buy = true;
    if (isAvoid(meta)) signal.avoidTouch = true;
  } else if (raw) {
    signal.rawUntrustedTouch = true;
    if (buyPre85) signal.rawUntrustedPre85Buy = true;
  }
  if (wallet) addWalletSample(signal, { ...payload, wallet, source: 'wallet.trade_gate_diagnostic' }, meta);
  return finalizeWalletSignal(signal);
}

function walletSignalFromLedgerEvent(event = {}, promotionIndex) {
  const wallet = event.wallet || null;
  const meta = wallet ? promotionIndex.byAddress.get(wallet) : null;
  const signal = emptyWalletSignal();
  const buyPre85 = isBuy(event) && (!Number.isFinite(Number(event.market?.curveProgress)) || Number(event.market.curveProgress) < 0.85);
  signal.anyWalletTouch = true;
  signal.trustedTouch = true;
  if (buyPre85) signal.trustedPre85Buy = true;
  if (meta && isPositiveOrProven(meta)) signal.positiveOrProvenTouch = true;
  if (meta && isPositiveOrProven(meta) && buyPre85) signal.positiveOrProvenPre85Buy = true;
  if (meta && isAvoid(meta)) signal.avoidTouch = true;
  addWalletSample(signal, {
    ...event,
    curveProgress: event.market?.curveProgress,
    source: 'wallet_event_ledger'
  }, meta);
  return finalizeWalletSignal(signal);
}

function addWalletEvent(row, atMs, type, wallet) {
  if (!wallet || !wallet.anyWalletTouch || !Number.isFinite(atMs)) return;
  row.walletEvents.push({ atMs, at: new Date(atMs).toISOString(), type, ...wallet });
}

function scanFile(filePath, promotionIndex = makePromotionIndex()) {
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
    const curveProgress = curveOf(payload);
    const priceSol = priceOf(payload);
    updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
    updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
    updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
    updateMax(row, 'maxUniqueBuyerCount', payload.uniqueBuyerCount);
    updateMax(row, 'maxSniperWalletCount', payload.sniperWalletCount);

    if ((type === 'pre_migration.observed'
      || type === 'pre_migration.flagged'
      || type === 'pump_bonding_curve.provider_snapshot'
      || type === 'finalist_account_verifier.update')
      && Number.isFinite(atMs)
      && (Number.isFinite(curveProgress) || Number.isFinite(priceSol))) {
      row.snapshots.push({
        atMs,
        at: new Date(atMs).toISOString(),
        type,
        curveProgress: compact(curveProgress, 6),
        priceSol: compact(priceSol, 15),
        score: compact(payload.score ?? payload.entryScore, 2),
        recentVolumeSol: compact(payload.recentVolumeSol, 4),
        tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
        buyRatio: compact(payload.buyRatio, 4),
        uniqueBuyerCount: compact(payload.uniqueBuyerCount, 0),
        sniperWalletCount: compact(payload.sniperWalletCount, 0),
        curveProgressDelta: compact(payload.curveProgressDelta, 6),
        curveProgressDelta60s: compact(payload.curveProgressDelta60s, 6),
        updateSource: payload.updateSource || null
      });
    }

    if (type === 'pre_migration.observed' && Number.isFinite(atMs)) row.observedAt.push(atMs);
    if (type === 'pre_migration.flagged' && Number.isFinite(atMs)) {
      row.flaggedAt.push(atMs);
      for (const reason of payload.reasons || []) bump(row.reasons, reason);
    }
    if ((type === 'pre_migration_paper.guard_attribution' || type === 'pre_migration_paper.decision') && Number.isFinite(atMs)) {
      row.evaluatedAt.push(atMs);
      bump(row.reasons, payload.reason || payload.guardReason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
    }
    if (type === 'pre_migration_paper.entry' && Number.isFinite(atMs)) row.paperEntryAt.push(atMs);
    if (type === 'pre_migration_paper.first_curve_snapshot_near_miss' && Number.isFinite(atMs)) row.nearMissAt.push(atMs);

    if (type === 'wallet.trade_gate_diagnostic') {
      addWalletEvent(row, atMs, type, walletSignalFromGateDiagnostic(payload, promotionIndex));
    } else {
      addWalletEvent(row, atMs, type, walletSignals(payload, promotionIndex));
    }
  }, { bufferSize: 1024 * 1024 });

  return {
    rows: Array.from(rowsByMint.values()),
    eventCounts,
    firstMs,
    lastMs,
    stats
  };
}

function attachWalletLedgerEvents(rows, firstMs, lastMs, promotionIndex = makePromotionIndex(), walletEventsPath = WALLET_EVENTS_PATH) {
  if (!fs.existsSync(walletEventsPath) || !Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return 0;
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  let attached = 0;
  forEachJsonlSync(walletEventsPath, (event) => {
    const mint = event.mint || event.payload?.mint || null;
    if (!mint || !byMint.has(mint)) return;
    const atMs = timestampMs(event.tradeAt || event.observedAt || event.timestamp);
    if (!Number.isFinite(atMs) || atMs < firstMs || atMs > lastMs) return;
    const row = byMint.get(mint);
    addWalletEvent(row, atMs, 'wallet_event_ledger.trade_observed', walletSignalFromLedgerEvent(event, promotionIndex));
    attached += 1;
  }, { bufferSize: 1024 * 1024 });
  return attached;
}

function firstCross(snapshots, threshold) {
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function lastBefore(snapshots, atMs, predicate = () => true) {
  if (!Number.isFinite(atMs)) return null;
  let picked = null;
  for (const snapshot of snapshots) {
    if (snapshot.atMs < atMs && predicate(snapshot)) picked = snapshot;
  }
  return picked;
}

function firstAtBefore(values, atMs) {
  return values.filter((value) => Number.isFinite(value) && value < atMs).sort((a, b) => a - b)[0] || null;
}

function summarizeMint(row, telemetryPath) {
  const snapshots = row.snapshots
    .filter((snapshot) => Number.isFinite(snapshot.atMs))
    .sort((a, b) => a.atMs - b.atMs);
  if (!snapshots.length) return null;
  const priceBearing = snapshots.filter((snapshot) => Number.isFinite(Number(snapshot.priceSol)) && Number(snapshot.priceSol) > 0);
  const curveSnapshots = snapshots.filter((snapshot) => Number.isFinite(Number(snapshot.curveProgress)));
  const firstSeen = snapshots[0];
  const firstPrice = priceBearing[0] || null;
  const crosses = Object.fromEntries(THRESHOLDS.map((threshold) => [String(threshold), firstCross(curveSnapshots, threshold)]));
  const cross60 = crosses['0.6'];
  const cross85 = crosses['0.85'];
  const cross90 = crosses['0.9'];
  const pre60 = cross60
    ? curveSnapshots.filter((snapshot) => snapshot.atMs < cross60.atMs && Number(snapshot.curveProgress) < 0.6)
    : curveSnapshots.filter((snapshot) => Number(snapshot.curveProgress) < 0.6);
  const lastPre60 = cross60 ? lastBefore(curveSnapshots, cross60.atMs, (snapshot) => Number(snapshot.curveProgress) < 0.6) : null;
  const firstPre60 = pre60[0] || null;
  const curveVelocityTo60 = firstPre60 && lastPre60 && lastPre60.atMs > firstPre60.atMs
    ? (Number(lastPre60.curveProgress) - Number(firstPre60.curveProgress)) / ((lastPre60.atMs - firstPre60.atMs) / 1000)
    : null;
  const walletBefore60 = row.walletEvents.filter((event) => cross60 ? event.atMs < cross60.atMs : true);
  const maxCurve = curveSnapshots.reduce((max, snapshot) => Math.max(max, Number(snapshot.curveProgress)), 0);
  const maxPrice = priceBearing.reduce((max, snapshot) => Math.max(max, Number(snapshot.priceSol)), 0);
  const basePrice = firstPrice ? Number(firstPrice.priceSol) : null;
  const firstFlaggedBefore60 = cross60 ? firstAtBefore(row.flaggedAt, cross60.atMs) : null;
  const firstEvaluatedBefore60 = cross60 ? firstAtBefore(row.evaluatedAt, cross60.atMs) : null;
  const firstNearMissBefore60 = cross60 ? firstAtBefore(row.nearMissAt, cross60.atMs) : null;
  const firstPaperBefore60 = cross60 ? firstAtBefore(row.paperEntryAt, cross60.atMs) : null;
  const terminalStage = firstPaperBefore60 ? 'paper_entered_before60'
    : firstEvaluatedBefore60 ? 'evaluated_before60'
      : firstFlaggedBefore60 ? 'flagged_before60'
        : 'observed_only_before60';

  return {
    mint: row.mint,
    symbol: row.symbol,
    telemetryPath,
    firstSeenAt: firstSeen.at,
    firstSeenCurve: compact(firstSeen.curveProgress, 6),
    firstPriceBearingAt: firstPrice?.at || null,
    firstPriceBearingCurve: compact(firstPrice?.curveProgress, 6),
    firstCross60At: cross60?.at || null,
    firstCross85At: cross85?.at || null,
    firstCross90At: cross90?.at || null,
    secondsFirstSeenToCross60: cross60 ? compact((cross60.atMs - firstSeen.atMs) / 1000, 2) : null,
    secondsFirstSeenToCross85: cross85 ? compact((cross85.atMs - firstSeen.atMs) / 1000, 2) : null,
    secondsFirstSeenToCross90: cross90 ? compact((cross90.atMs - firstSeen.atMs) / 1000, 2) : null,
    observationsBeforeCross60: pre60.length,
    priceBearingBeforeCross60: cross60 ? priceBearing.filter((snapshot) => snapshot.atMs < cross60.atMs).length : null,
    firstFlaggedBefore60At: firstFlaggedBefore60 ? new Date(firstFlaggedBefore60).toISOString() : null,
    firstEvaluatedBefore60At: firstEvaluatedBefore60 ? new Date(firstEvaluatedBefore60).toISOString() : null,
    firstCurveNearMissBefore60At: firstNearMissBefore60 ? new Date(firstNearMissBefore60).toISOString() : null,
    firstPaperEntryBefore60At: firstPaperBefore60 ? new Date(firstPaperBefore60).toISOString() : null,
    terminalStage,
    lastPre60Snapshot: lastPre60,
    firstPre60Snapshot: firstPre60,
    curveVelocityTo60PerSec: compact(curveVelocityTo60, 8),
    maxCurveReached: compact(maxCurve, 6),
    maxPriceDeltaFromFirstPricePct: Number.isFinite(basePrice) && basePrice > 0 && maxPrice > 0
      ? compact(((maxPrice - basePrice) / basePrice) * 100, 2)
      : null,
    crossed60: Boolean(cross60),
    crossed85: Boolean(cross85),
    crossed90: Boolean(cross90),
    walletBefore60: {
      anyWalletTouch: walletBefore60.some((event) => event.anyWalletTouch),
      trustedTouch: walletBefore60.some((event) => event.trustedTouch),
      trustedPre85Buy: walletBefore60.some((event) => event.trustedPre85Buy),
      positiveOrProvenTouch: walletBefore60.some((event) => event.positiveOrProvenTouch),
      positiveOrProvenPre85Buy: walletBefore60.some((event) => event.positiveOrProvenPre85Buy),
      prospectiveTouch: walletBefore60.some((event) => event.prospectiveTouch),
      prospectivePre85Buy: walletBefore60.some((event) => event.prospectivePre85Buy),
      rawUntrustedTouch: walletBefore60.some((event) => event.rawUntrustedTouch),
      rawUntrustedPre85Buy: walletBefore60.some((event) => event.rawUntrustedPre85Buy),
      avoidTouch: walletBefore60.some((event) => event.avoidTouch),
      uniqueWalletCount: new Set(walletBefore60.flatMap((event) => (event.sampleWallets || []).map((wallet) => wallet.wallet).filter(Boolean))).size,
      rows: walletBefore60.length,
      sampleWallets: walletBefore60.flatMap((event) => event.sampleWallets || []).slice(0, 5)
    },
    maxScore: compact(row.maxScore, 2),
    maxRecentVolumeSol: compact(row.maxRecentVolumeSol, 4),
    maxTradeVelocityPerMin: compact(row.maxTradeVelocityPerMin, 2),
    maxUniqueBuyerCount: compact(row.maxUniqueBuyerCount, 0),
    maxSniperWalletCount: compact(row.maxSniperWalletCount, 0),
    topReasons: topCounts(row.reasons, 8),
    topFailedChecks: topCounts(row.failedChecks, 8)
  };
}

function buildReport(filePaths, options = {}) {
  const promotionIndex = makePromotionIndex();
  const runs = [];
  const rows = [];
  const errors = [];
  let walletLedgerEventsAttached = 0;
  for (const filePath of filePaths) {
    try {
      const scanned = scanFile(filePath, promotionIndex);
      walletLedgerEventsAttached += attachWalletLedgerEvents(scanned.rows, scanned.firstMs, scanned.lastMs, promotionIndex);
      const telemetryPath = path.relative(ROOT, filePath);
      const runRows = scanned.rows.map((row) => summarizeMint(row, telemetryPath)).filter(Boolean);
      rows.push(...runRows);
      runs.push({
        telemetryPath,
        firstEventAt: scanned.firstMs === null ? null : new Date(scanned.firstMs).toISOString(),
        lastEventAt: scanned.lastMs === null ? null : new Date(scanned.lastMs).toISOString(),
        durationHours: scanned.firstMs !== null && scanned.lastMs !== null ? compact((scanned.lastMs - scanned.firstMs) / 3_600_000, 4) : null,
        rows: runRows.length,
        crossed60: runRows.filter((row) => row.crossed60).length,
        crossed85: runRows.filter((row) => row.crossed85).length,
        crossed90: runRows.filter((row) => row.crossed90).length,
        jsonlRowsScanned: scanned.stats.rows,
        malformedLines: scanned.stats.malformedLines
      });
    } catch (error) {
      errors.push({ telemetryPath: path.relative(ROOT, filePath), error: error.message });
    }
  }

  const observedBelow60 = rows.filter((row) => Number(row.firstSeenCurve) < 0.6 || row.firstSeenCurve === null);
  const crossed60 = rows.filter((row) => row.crossed60);
  const crossed85 = rows.filter((row) => row.crossed85);
  const crossed90 = rows.filter((row) => row.crossed90);
  const actionableMissed = rows.filter((row) => row.crossed85 && !row.firstFlaggedBefore60At);
  const feedBlind = crossed60.filter((row) => Number(row.priceBearingBeforeCross60 || 0) === 0 || Number(row.observationsBeforeCross60 || 0) <= 1);
  const preCrossFlagged = crossed60.filter((row) => row.firstFlaggedBefore60At);
  const preCrossEvaluated = crossed60.filter((row) => row.firstEvaluatedBefore60At);

  const summary = {
    telemetryFiles: filePaths.length,
    walletLedgerEventsAttached,
    mints: rows.length,
    rows: rows.length,
    observedBelow60: observedBelow60.length,
    crossed60: crossed60.length,
    crossed85: crossed85.length,
    crossed90: crossed90.length,
    crossed60RateOfBelow60: observedBelow60.length ? compact(crossed60.length / observedBelow60.length, 4) : null,
    crossed85RateOfBelow60: observedBelow60.length ? compact(crossed85.length / observedBelow60.length, 4) : null,
    flaggedBefore60Crossers: preCrossFlagged.length,
    evaluatedBefore60Crossers: preCrossEvaluated.length,
    actionableMissedCross85: actionableMissed.length,
    feedBlindCross60: feedBlind.length,
    observationsBeforeCross60: numericStats(crossed60.map((row) => row.observationsBeforeCross60), 0),
    priceBearingBeforeCross60: numericStats(crossed60.map((row) => row.priceBearingBeforeCross60), 0),
    secondsFirstSeenToCross60: numericStats(crossed60.map((row) => row.secondsFirstSeenToCross60), 2),
    curveVelocityTo60PerSec: numericStats(crossed60.map((row) => row.curveVelocityTo60PerSec), 8),
    maxPriceDeltaCross60: numericStats(crossed60.map((row) => row.maxPriceDeltaFromFirstPricePct), 2),
    terminalStages: topCounts(rows.reduce((counts, row) => {
      bump(counts, row.terminalStage);
      return counts;
    }, {}), 12),
    walletBefore60Crossers: {
      any: crossed60.filter((row) => row.walletBefore60.anyWalletTouch).length,
      trusted: crossed60.filter((row) => row.walletBefore60.trustedTouch).length,
      trustedPre85Buy: crossed60.filter((row) => row.walletBefore60.trustedPre85Buy).length,
      positive: crossed60.filter((row) => row.walletBefore60.positiveOrProvenTouch).length,
      positivePre85Buy: crossed60.filter((row) => row.walletBefore60.positiveOrProvenPre85Buy).length,
      prospective: crossed60.filter((row) => row.walletBefore60.prospectiveTouch).length,
      prospectivePre85Buy: crossed60.filter((row) => row.walletBefore60.prospectivePre85Buy).length,
      rawUntrusted: crossed60.filter((row) => row.walletBefore60.rawUntrustedTouch).length,
      rawUntrustedPre85: crossed60.filter((row) => row.walletBefore60.rawUntrustedPre85Buy).length
    },
    cross60WithAnyWalletBefore60: crossed60.filter((row) => row.walletBefore60.anyWalletTouch).length,
    cross60WithPositiveWalletBefore60: crossed60.filter((row) => row.walletBefore60.positiveOrProvenTouch).length,
    cross60WithProvenWalletBefore60: crossed60.filter((row) => row.walletBefore60.positiveOrProvenTouch).length,
    verdict: crossed60.length === 0
      ? 'NO_PRE_CURVE60_CROSSERS'
      : feedBlind.length / crossed60.length > 0.5
        ? 'PRE_CURVE60_CADENCE_BLIND'
        : actionableMissed.length > 0
          ? 'PRE_CURVE60_MISSED_RUNNERS_FOUND'
          : preCrossFlagged.length > 0
            ? 'PRE_CURVE60_RUNNERS_ALREADY_FLAGGED'
            : 'PRE_CURVE60_LOW_ACTIONABLE_SUPPLY'
  };

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_curve60_runner_discovery',
    summary,
    runs,
    errors,
    topCross60: crossed60
      .sort((a, b) => Number(b.maxPriceDeltaFromFirstPricePct || 0) - Number(a.maxPriceDeltaFromFirstPricePct || 0))
      .slice(0, 50),
    actionableMissedCross85: actionableMissed.slice(0, 50),
    feedBlindCross60: feedBlind.slice(0, 50),
    rows: options.includeAllRows ? rows : rows.slice(0, 2000)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicit = args.telemetry || args.file;
  const filePaths = explicit
    ? String(explicit).split(',').map((item) => repoPath(item.trim())).filter(Boolean)
    : telemetryFiles(Number(args.limit || DEFAULT_LIMIT));
  if (!filePaths.length) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run paper sessions first.');
    process.exit(1);
  }
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const report = buildReport(filePaths);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = { buildReport, scanFile };
