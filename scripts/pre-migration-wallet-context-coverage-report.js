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
const WALLET_PNL_EVIDENCE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-pnl-evidence-latest.json');
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
    const ageDays = (Date.now() - stat.mtimeMs) / 86400000;
    return {
      path: filePath,
      exists: true,
      bytes: stat.size,
      lastModifiedAt: stat.mtime.toISOString(),
      ageDays: compact(ageDays, 2)
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      bytes: 0,
      lastModifiedAt: null,
      ageDays: null
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
  return payload.wallet || payload.walletAddress || payload.traderPublicKey || payload.account || payload.address || null;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function isBuySide(row = {}) {
  return String(row.side || row.txType || row.tradeType || '').toLowerCase() === 'buy';
}

function isPre85(row = {}) {
  const curve = Number(row.curveProgress ?? row.providerCurveProgress ?? row.bondingCurveProgress ?? row.paperCurveProgress);
  return !Number.isFinite(curve) || curve < 0.85;
}

function addWalletToSet(target, value) {
  const wallet = typeof value === 'string' ? value.trim() : '';
  if (wallet) target.add(wallet);
}

function addWalletRowsToSet(target, rows = []) {
  for (const row of Array.isArray(rows) ? rows : []) {
    addWalletToSet(target, walletOf(row));
  }
}

function walletSetFromManualKol(filePath = MANUAL_KOL_WALLET_PATH) {
  const parsed = readJson(filePath, null);
  const wallets = new Set();
  if (Array.isArray(parsed)) addWalletRowsToSet(wallets, parsed);
  else if (Array.isArray(parsed?.wallets)) addWalletRowsToSet(wallets, parsed.wallets);
  else if (Array.isArray(parsed?.trackedWallets)) addWalletRowsToSet(wallets, parsed.trackedWallets);
  return wallets;
}

function walletSetFromPromotionReview(filePath = PROMOTION_PATH) {
  const parsed = readJson(filePath, {});
  const wallets = new Set();
  for (const key of ['trustReview', 'profitableNeedsFirstTouchEvidence', 'watchReview', 'avoidReview', 'hold', 'wallets']) {
    addWalletRowsToSet(wallets, parsed[key]);
  }
  return wallets;
}

function walletSetFromLaunchIntel(filePath = LAUNCH_INTEL_WALLET_INDEX_PATH) {
  const parsed = readJson(filePath, {});
  const wallets = new Set();
  addWalletRowsToSet(wallets, parsed.items);
  return wallets;
}

function walletSetFromPnlEvidence(filePath = WALLET_PNL_EVIDENCE_PATH) {
  const parsed = readJson(filePath, {});
  const wallets = new Set();
  for (const key of ['wallets', 'topPositiveWallets', 'topNegativeWallets']) {
    addWalletRowsToSet(wallets, parsed[key]);
  }
  return wallets;
}

async function walletSetFromHistoricalLedger(filePath = WALLET_EVENTS_PATH) {
  const wallets = new Set();
  await readJsonl(filePath, (row) => addWalletToSet(wallets, walletOf(row)));
  return wallets;
}

async function buildWalletSubstrateIndex() {
  const manualKol = walletSetFromManualKol(MANUAL_KOL_WALLET_PATH);
  const promotionReview = walletSetFromPromotionReview(PROMOTION_PATH);
  const launchIntelWalletIndex = walletSetFromLaunchIntel(LAUNCH_INTEL_WALLET_INDEX_PATH);
  const walletIntelOrRealizedPnl = walletSetFromPnlEvidence(WALLET_PNL_EVIDENCE_PATH);
  const historicalWalletEventsLedger = await walletSetFromHistoricalLedger(WALLET_EVENTS_PATH);
  return {
    sets: {
      manualKol,
      promotionReview,
      launchIntelWalletIndex,
      historicalWalletEventsLedger,
      walletIntelOrRealizedPnl
    },
    counts: {
      manualKol: manualKol.size,
      promotionReview: promotionReview.size,
      launchIntelWalletIndex: launchIntelWalletIndex.size,
      historicalWalletEventsLedger: historicalWalletEventsLedger.size,
      walletIntelOrRealizedPnl: walletIntelOrRealizedPnl.size
    },
    sources: {
      manualKolWalletPath: fileSummary(MANUAL_KOL_WALLET_PATH),
      walletPromotionReviewPath: fileSummary(PROMOTION_PATH),
      launchIntelWalletIndexPath: fileSummary(LAUNCH_INTEL_WALLET_INDEX_PATH),
      walletEventLedgerPath: fileSummary(WALLET_EVENTS_PATH),
      walletPnlEvidencePath: fileSummary(WALLET_PNL_EVIDENCE_PATH)
    }
  };
}

function topCounts(rows, keyFn, limit = 12) {
  return Object.entries(countBy(rows, keyFn))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: compact(finite[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(finite[finite.length - 1], digits),
    avg: compact(sum / finite.length, digits)
  };
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

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.progress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function priceOf(payload = {}) {
  const price = Number(payload.providerCurvePriceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? payload.priceSol);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function followThroughWindow(row, snapshotsByMint, seconds) {
  const snapshots = snapshotsByMint.get(row.mint) || [];
  const future = snapshots.filter((snapshot) => snapshot.atMs > row.atMs && snapshot.atMs <= row.atMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = future.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const startCurve = Number(row.curveProgress);
  const startPrice = Number(row.priceSol);
  const crossed = (threshold) => Number.isFinite(startCurve) && startCurve < threshold && future.some((snapshot) => Number(snapshot.curveProgress) >= threshold);
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: compact(maxCurve, 6),
    curveDelta: maxCurve !== null && Number.isFinite(startCurve) ? compact(maxCurve - startCurve, 6) : null,
    maxPriceDeltaPct: maxPrice !== null && Number.isFinite(startPrice) && startPrice > 0 ? compact(((maxPrice - startPrice) / startPrice) * 100, 2) : null,
    crossed85AfterTrade: crossed(0.85),
    crossed90AfterTrade: crossed(0.9),
    crossed95AfterTrade: crossed(0.95)
  };
}

function summarizeUntrackedWalletOpportunity(rows = [], decisionMints = new Set()) {
  const buys = rows.filter((row) => row.txType === 'buy' && row.wallet);
  const sells = rows.filter((row) => row.txType === 'sell' && row.wallet);
  const allByWallet = new Map();
  for (const row of rows.filter((item) => item.wallet)) {
    if (!allByWallet.has(row.wallet)) allByWallet.set(row.wallet, []);
    allByWallet.get(row.wallet).push(row);
  }
  const byWallet = new Map();
  for (const row of buys) {
    if (!byWallet.has(row.wallet)) byWallet.set(row.wallet, []);
    byWallet.get(row.wallet).push(row);
  }
  const walletRows = Array.from(byWallet.entries()).map(([wallet, walletRows]) => {
    const allRows = allByWallet.get(wallet) || [];
    const sellRows = allRows.filter((row) => row.txType === 'sell').length;
    const buyRows = walletRows.length;
    const uniqueMints = new Set(walletRows.map((row) => row.mint).filter(Boolean));
    const decisionOverlapMints = new Set(walletRows.map((row) => row.mint).filter((mint) => mint && decisionMints.has(mint)));
    const w120 = walletRows.map((row) => row.window120s || {});
    const w300 = walletRows.map((row) => row.window300s || {});
    const crossed90Mints = new Set(walletRows.filter((row) => row.window300s?.crossed90AfterTrade).map((row) => row.mint).filter(Boolean));
    const curveDelta300s = stat(w300.map((row) => row.curveDelta), 6);
    const maxPriceDeltaPct300s = stat(w300.map((row) => row.maxPriceDeltaPct), 2);
    const buyRatio = allRows.length ? compact(buyRows / allRows.length, 4) : null;
    const decisionOverlapRate = uniqueMints.size ? compact(decisionOverlapMints.size / uniqueMints.size, 4) : null;
    const rowsPerMint = uniqueMints.size ? compact(buyRows / uniqueMints.size, 2) : null;
    const medianCurveDelta = Number(curveDelta300s.median || 0);
    const p90CurveDelta = Number(curveDelta300s.p90 || 0);
    const reviewScore = compact(Math.max(0, Math.min(100,
      (Math.min(uniqueMints.size, 20) * 2)
      + (Math.min(decisionOverlapMints.size, 20) * 1.5)
      + (Math.min(p90CurveDelta, 0.7) * 45)
      + (Math.min(medianCurveDelta, 0.5) * 25)
      + (buyRatio !== null ? buyRatio * 10 : 0)
      - (rowsPerMint !== null && rowsPerMint > 12 ? 12 : 0)
      - (buyRows >= 500 ? 10 : 0)
    )), 2);
    const reviewReason = reviewScore >= 70
      ? 'PROMOTE_TO_MANUAL_REVIEW'
      : (reviewScore >= 45 ? 'WATCH_NEXT_RUN' : 'LOW_PRIORITY');
    return {
      wallet,
      rows: walletRows.length,
      buyRows,
      sellRows,
      buyRatio,
      uniqueMints: uniqueMints.size,
      decisionOverlapMints: decisionOverlapMints.size,
      decisionOverlapRate,
      rowsPerMint,
      crossed85Within120s: w120.filter((row) => row.crossed85AfterTrade).length,
      crossed90Within120s: w120.filter((row) => row.crossed90AfterTrade).length,
      crossed90Within300s: w300.filter((row) => row.crossed90AfterTrade).length,
      uniqueMintsCrossed90Within300s: crossed90Mints.size,
      crossed90Within300sRate: walletRows.length ? compact(w300.filter((row) => row.crossed90AfterTrade).length / walletRows.length, 4) : null,
      curveDelta120s: stat(w120.map((row) => row.curveDelta), 6),
      curveDelta300s,
      maxPriceDeltaPct120s: stat(w120.map((row) => row.maxPriceDeltaPct), 2),
      maxPriceDeltaPct300s,
      reviewScore,
      reviewReason,
      sampleMints: Array.from(uniqueMints).slice(0, 8)
    };
  });
  const topReviewCandidates = walletRows
    .filter((row) => row.uniqueMints >= 3 && row.decisionOverlapMints >= 2)
    .slice()
    .sort((a, b) => (
      b.reviewScore - a.reviewScore
      || Number(b.curveDelta300s?.p90 || 0) - Number(a.curveDelta300s?.p90 || 0)
      || b.uniqueMints - a.uniqueMints
      || b.rows - a.rows
    ))
    .slice(0, 12);
  const topByFollowThrough = walletRows
    .slice()
    .sort((a, b) => (
      b.uniqueMintsCrossed90Within300s - a.uniqueMintsCrossed90Within300s
      || b.crossed90Within300s - a.crossed90Within300s
      || b.uniqueMints - a.uniqueMints
      || b.rows - a.rows
    ))
    .slice(0, 12);
  const topByFrequency = walletRows
    .slice()
    .sort((a, b) => b.rows - a.rows || b.uniqueMints - a.uniqueMints)
    .slice(0, 12);
  return {
    rows: rows.length,
    buyRows: buys.length,
    sellRows: sells.length,
    uniqueWallets: byWallet.size,
    uniqueBuyMints: new Set(buys.map((row) => row.mint).filter(Boolean)).size,
    buyRowsWithDecisionOverlap: buys.filter((row) => row.mint && decisionMints.has(row.mint)).length,
    buyRowsCrossed90Within300s: buys.filter((row) => row.window300s?.crossed90AfterTrade).length,
    uniqueBuyMintsCrossed90Within300s: new Set(buys.filter((row) => row.window300s?.crossed90AfterTrade).map((row) => row.mint).filter(Boolean)).size,
    curveDelta300s: stat(buys.map((row) => row.window300s?.curveDelta), 6),
    maxPriceDeltaPct300s: stat(buys.map((row) => row.window300s?.maxPriceDeltaPct), 2),
    topReviewCandidates,
    topByFollowThrough,
    topByFrequency
  };
}

function summarizeUntrackedDecisionJoin(rows = [], decisions = [], windowSeconds = 120) {
  const buysByMint = new Map();
  for (const row of rows) {
    if (row.txType !== 'buy' || !row.mint || !row.wallet || !Number.isFinite(row.atMs)) continue;
    if (!buysByMint.has(row.mint)) buysByMint.set(row.mint, []);
    buysByMint.get(row.mint).push(row);
  }
  for (const rowsForMint of buysByMint.values()) {
    rowsForMint.sort((a, b) => a.atMs - b.atMs);
  }

  const reasonStats = {};
  const walletHits = new Map();
  const samples = [];
  let decisionsWithPriorUntrackedBuy = 0;
  let decisionsWithNearPriorUntrackedBuy = 0;
  let noTrackedFirstTouchBuyWithPriorUntrackedBuy = 0;
  let noTrackedFirstTouchBuyWithNearPriorUntrackedBuy = 0;
  const uniqueMintsWithPrior = new Set();
  const uniqueNearPriorWallets = new Set();

  for (const decision of decisions) {
    const reason = decision.reason || 'unknown';
    if (!reasonStats[reason]) {
      reasonStats[reason] = {
        decisions: 0,
        withPriorUntrackedBuy: 0,
        withNearPriorUntrackedBuy: 0,
        uniqueMintsWithPrior: new Set(),
        uniqueNearPriorWallets: new Set()
      };
    }
    const stats = reasonStats[reason];
    stats.decisions += 1;

    if (!decision.mint || !Number.isFinite(decision.atMs)) continue;
    const buys = buysByMint.get(decision.mint) || [];
    const priorBuys = buys.filter((row) => row.atMs <= decision.atMs);
    if (!priorBuys.length) continue;

    const nearCutoffMs = decision.atMs - windowSeconds * 1000;
    const nearPriorBuys = priorBuys.filter((row) => row.atMs >= nearCutoffMs);
    decisionsWithPriorUntrackedBuy += 1;
    stats.withPriorUntrackedBuy += 1;
    stats.uniqueMintsWithPrior.add(decision.mint);
    uniqueMintsWithPrior.add(decision.mint);

    if (reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') {
      noTrackedFirstTouchBuyWithPriorUntrackedBuy += 1;
    }

    if (nearPriorBuys.length) {
      decisionsWithNearPriorUntrackedBuy += 1;
      stats.withNearPriorUntrackedBuy += 1;
      const firstNear = nearPriorBuys[0];
      if (reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') {
        noTrackedFirstTouchBuyWithNearPriorUntrackedBuy += 1;
      }
      for (const buy of nearPriorBuys) {
        uniqueNearPriorWallets.add(buy.wallet);
        stats.uniqueNearPriorWallets.add(buy.wallet);
        const walletRow = walletHits.get(buy.wallet) || {
          wallet: buy.wallet,
          nearPriorBuyRows: 0,
          nearPriorBuyDecisionLinks: 0,
          decisions: 0,
          reasons: {},
          mints: new Set(),
          buyKeys: new Set()
        };
        walletRow.nearPriorBuyDecisionLinks += 1;
        const buyKey = [
          buy.wallet || '',
          buy.mint || '',
          buy.txType || '',
          Number.isFinite(buy.atMs) ? buy.atMs : '',
          buy.provider || '',
          buy.source || ''
        ].join('|');
        if (!walletRow.buyKeys.has(buyKey)) {
          walletRow.buyKeys.add(buyKey);
          walletRow.nearPriorBuyRows += 1;
        }
        walletRow.reasons[reason] = (walletRow.reasons[reason] || 0) + 1;
        walletRow.mints.add(decision.mint);
        walletHits.set(buy.wallet, walletRow);
      }
      for (const wallet of new Set(nearPriorBuys.map((row) => row.wallet))) {
        const walletRow = walletHits.get(wallet);
        if (walletRow) walletRow.decisions += 1;
      }
      if (samples.length < 12) {
        samples.push({
          mint: decision.mint,
          symbol: decision.symbol || null,
          reason,
          decisionAt: decision.at || null,
          score: decision.score ?? null,
          curveProgress: decision.curveProgress ?? null,
          priorBuyCount: priorBuys.length,
          nearPriorBuyCount: nearPriorBuys.length,
          firstNearPriorBuy: {
            wallet: firstNear.wallet,
            at: firstNear.at,
            txType: firstNear.txType,
            secondsBeforeDecision: compact((decision.atMs - firstNear.atMs) / 1000, 3),
            curveProgress: firstNear.curveProgress ?? null
          }
        });
      }
    }
  }

  const topNearPriorWallets = Array.from(walletHits.values())
    .map((row) => ({
      wallet: row.wallet,
      nearPriorBuyRows: row.nearPriorBuyRows,
      nearPriorBuyDecisionLinks: row.nearPriorBuyDecisionLinks,
      decisions: row.decisions,
      uniqueMints: row.mints.size,
      reasonCounts: Object.fromEntries(Object.entries(row.reasons).sort((a, b) => b[1] - a[1]))
    }))
    .sort((a, b) => b.decisions - a.decisions || b.nearPriorBuyRows - a.nearPriorBuyRows || b.uniqueMints - a.uniqueMints)
    .slice(0, 12);

  return {
    windowSeconds,
    paperDecisionRows: decisions.length,
    decisionsWithPriorUntrackedBuy,
    decisionsWithNearPriorUntrackedBuy,
    uniqueMintsWithPriorUntrackedBuy: uniqueMintsWithPrior.size,
    uniqueNearPriorUntrackedWallets: uniqueNearPriorWallets.size,
    noTrackedFirstTouchBuyDecisions: reasonStats.CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY?.decisions || 0,
    noTrackedFirstTouchBuyWithPriorUntrackedBuy,
    noTrackedFirstTouchBuyWithNearPriorUntrackedBuy,
    byReason: Object.fromEntries(Object.entries(reasonStats)
      .sort((a, b) => b[1].decisions - a[1].decisions)
      .map(([reason, row]) => [reason, {
        decisions: row.decisions,
        withPriorUntrackedBuy: row.withPriorUntrackedBuy,
        withNearPriorUntrackedBuy: row.withNearPriorUntrackedBuy,
        uniqueMintsWithPrior: row.uniqueMintsWithPrior.size,
        uniqueNearPriorWallets: row.uniqueNearPriorWallets.size
      }])),
    topNearPriorWallets,
    samples
  };
}

function summarizeWalletChannelPartition({ walletEvents = [], recordedWalletGateRows = [], untrackedWalletRows = [] }) {
  const recordedRows = [
    ...walletEvents.map((row) => ({
      ...row,
      side: row.side || row.txType || null,
      channel: row.shadowWalletProfileMatch === true ? 'shadow_recorded' : 'trusted_recorded'
    })),
    ...recordedWalletGateRows.map((row) => ({
      ...row,
      channel: row.shadowWalletProfileMatch === true ? 'shadow_recorded' : 'trusted_recorded'
    }))
  ];
  const rowsByChannel = {
    trustedRecorded: recordedRows.filter((row) => row.channel === 'trusted_recorded'),
    shadowRecorded: recordedRows.filter((row) => row.channel === 'shadow_recorded'),
    untrackedDropped: untrackedWalletRows
  };
  const summarize = (rows) => {
    const buyRows = rows.filter(isBuySide);
    const pre85BuyRows = buyRows.filter(isPre85);
    return {
      rows: rows.length,
      buyRows: buyRows.length,
      pre85BuyRows: pre85BuyRows.length,
      uniqueWallets: uniqueCount(rows, (row) => row.wallet || walletOf(row)),
      uniqueMints: uniqueCount(rows, (row) => row.mint),
      uniquePre85BuyWallets: uniqueCount(pre85BuyRows, (row) => row.wallet || walletOf(row)),
      uniquePre85BuyMints: uniqueCount(pre85BuyRows, (row) => row.mint),
      sourceCounts: countBy(rows, (row) => row.sourceKind || row.source || 'unknown'),
      reviewTierCounts: countBy(rows, (row) => row.reviewTier || row.promotion?.reviewTier || 'none'),
      evidenceTierCounts: countBy(rows, (row) => row.evidenceTier || row.promotion?.evidenceTier || 'none')
    };
  };
  return {
    trustedRecorded: summarize(rowsByChannel.trustedRecorded),
    shadowRecorded: summarize(rowsByChannel.shadowRecorded),
    untrackedDropped: summarize(rowsByChannel.untrackedDropped),
    totals: {
      rows: recordedRows.length + untrackedWalletRows.length,
      recordedRows: recordedRows.length,
      untrackedRows: untrackedWalletRows.length,
      pre85BuyRows: recordedRows.filter((row) => isBuySide(row) && isPre85(row)).length
        + untrackedWalletRows.filter((row) => isBuySide(row) && isPre85(row)).length
    }
  };
}

function summarizeUntrackedSubstrateOverlap(untrackedWalletRows = [], substrateIndex) {
  const uniqueWallets = Array.from(new Set(untrackedWalletRows.map((row) => row.wallet).filter(Boolean)));
  const sets = substrateIndex?.sets || {};
  const sourceKeys = [
    ['manualKol', sets.manualKol || new Set()],
    ['promotionReview', sets.promotionReview || new Set()],
    ['launchIntelWalletIndex', sets.launchIntelWalletIndex || new Set()],
    ['historicalWalletEventsLedger', sets.historicalWalletEventsLedger || new Set()],
    ['walletIntelOrRealizedPnl', sets.walletIntelOrRealizedPnl || new Set()]
  ];
  const sourceHits = Object.fromEntries(sourceKeys.map(([key]) => [key, 0]));
  const sourceHitSamples = Object.fromEntries(sourceKeys.map(([key]) => [key, []]));
  const inAny = [];
  const trulyNovel = [];

  for (const wallet of uniqueWallets) {
    const hitSources = sourceKeys.filter(([, set]) => set.has(wallet)).map(([key]) => key);
    for (const key of hitSources) {
      sourceHits[key] += 1;
      if (sourceHitSamples[key].length < 8) sourceHitSamples[key].push(wallet);
    }
    if (hitSources.length) inAny.push({ wallet, hitSources });
    else trulyNovel.push(wallet);
  }

  const substrateLeakUntrackedRows = inAny
    .filter((row) => row.hitSources.includes('manualKol') || row.hitSources.includes('promotionReview'));
  const substrateLeakUntracked = substrateLeakUntrackedRows.slice(0, 24);
  const knownButNotManual = inAny
    .filter((row) => !row.hitSources.includes('manualKol') && !row.hitSources.includes('promotionReview'))
    .slice(0, 24);

  return {
    uniqueUntrackedWallets: uniqueWallets.length,
    ...Object.fromEntries(Object.entries(sourceHits).map(([key, count]) => [`in${key[0].toUpperCase()}${key.slice(1)}`, count])),
    inAnySubstrateSource: inAny.length,
    trulyNovelAnonymous: trulyNovel.length,
    inAnySubstrateSourceRate: uniqueWallets.length ? compact(inAny.length / uniqueWallets.length, 6) : null,
    trulyNovelAnonymousRate: uniqueWallets.length ? compact(trulyNovel.length / uniqueWallets.length, 6) : null,
    substrateLeakUntrackedCount: substrateLeakUntrackedRows.length,
    sourceHitSamples,
    substrateLeakUntracked,
    knownButNotManualSamples: knownButNotManual,
    trulyNovelAnonymousSamples: trulyNovel.slice(0, 24)
  };
}

function dedupeJoinRows(rows = []) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const key = [
      row.wallet || '',
      row.mint || '',
      row.side || row.txType || '',
      Number.isFinite(row.atMs) ? Math.floor(row.atMs / 1000) : '',
      row.watchedReason || ''
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function summarizeWalletDecisionJoin(walletTouchRows = [], decisionRows = []) {
  const touches = dedupeJoinRows(walletTouchRows)
    .filter((row) => row.mint)
    .sort((a, b) => Number(a.atMs || 0) - Number(b.atMs || 0));
  const decisions = decisionRows
    .filter((row) => row.mint)
    .sort((a, b) => Number(a.atMs || 0) - Number(b.atMs || 0));
  const decisionsByMint = new Map();
  const touchesByMint = new Map();

  for (const decision of decisions) {
    if (!decisionsByMint.has(decision.mint)) decisionsByMint.set(decision.mint, []);
    decisionsByMint.get(decision.mint).push(decision);
  }
  for (const touch of touches) {
    if (!touchesByMint.has(touch.mint)) touchesByMint.set(touch.mint, []);
    touchesByMint.get(touch.mint).push(touch);
  }

  const touchExplanations = [];
  const joinStatusCounts = {};
  for (const touch of touches) {
    const sameMintDecisions = decisionsByMint.get(touch.mint) || [];
    const firstDecision = sameMintDecisions[0] || null;
    const lastDecision = sameMintDecisions[sameMintDecisions.length - 1] || null;
    const contextDecision = sameMintDecisions.find((decision) => decision.hasAnyWalletTouch) || null;
    const priorOrSameDecisions = sameMintDecisions.filter((decision) => (
      Number.isFinite(touch.atMs)
      && Number.isFinite(decision.atMs)
      && decision.atMs >= touch.atMs
    ));
    const firstDecisionAfterTouch = priorOrSameDecisions[0] || null;
    const lastDecisionBeforeTouch = sameMintDecisions
      .filter((decision) => Number.isFinite(touch.atMs) && Number.isFinite(decision.atMs) && decision.atMs < touch.atMs)
      .slice(-1)[0] || null;

    let joinStatus = 'missing_timing';
    if (!sameMintDecisions.length) {
      joinStatus = 'no_paper_decision_for_wallet_mint';
    } else if (contextDecision) {
      joinStatus = 'same_mint_context_present';
    } else if (!Number.isFinite(touch.atMs) || !Number.isFinite(firstDecision?.atMs)) {
      joinStatus = 'same_mint_missing_timing_context_absent';
    } else if (firstDecisionAfterTouch) {
      joinStatus = firstDecision === firstDecisionAfterTouch
        ? 'touch_before_first_decision_context_absent'
        : 'touch_before_later_decision_context_absent';
    } else if (lastDecision && Number.isFinite(lastDecision.atMs) && touch.atMs > lastDecision.atMs) {
      joinStatus = 'touch_after_last_decision';
    } else {
      joinStatus = 'same_mint_context_absent';
    }
    joinStatusCounts[joinStatus] = (joinStatusCounts[joinStatus] || 0) + 1;

    if (touchExplanations.length < 24) {
      touchExplanations.push({
        wallet: touch.wallet || null,
        mint: touch.mint,
        symbol: touch.symbol || null,
        side: touch.side || touch.txType || null,
        sourceKind: touch.sourceKind || null,
        watchedReason: touch.watchedReason || null,
        reviewTier: touch.reviewTier || null,
        evidenceTier: touch.evidenceTier || null,
        touchAt: touch.at || (Number.isFinite(touch.atMs) ? new Date(touch.atMs).toISOString() : null),
        paperDecisionCountForMint: sameMintDecisions.length,
        firstDecisionAt: firstDecision?.at || null,
        firstDecisionReason: firstDecision?.reason || null,
        firstDecisionHasWalletContext: firstDecision ? Boolean(firstDecision.hasAnyWalletTouch) : false,
        firstDecisionAfterTouchAt: firstDecisionAfterTouch?.at || null,
        firstDecisionAfterTouchReason: firstDecisionAfterTouch?.reason || null,
        lastDecisionBeforeTouchAt: lastDecisionBeforeTouch?.at || null,
        firstDecisionMinusTouchMs: firstDecision && Number.isFinite(firstDecision.atMs) && Number.isFinite(touch.atMs)
          ? Math.round(firstDecision.atMs - touch.atMs)
          : null,
        firstDecisionAfterTouchMinusTouchMs: firstDecisionAfterTouch && Number.isFinite(firstDecisionAfterTouch.atMs) && Number.isFinite(touch.atMs)
          ? Math.round(firstDecisionAfterTouch.atMs - touch.atMs)
          : null,
        joinStatus
      });
    }
  }

  let decisionsWithPriorOrSameTouch = 0;
  let decisionsWithFutureTouch = 0;
  let decisionsWithPriorOrSameTouchButNoContext = 0;
  const decisionMissSamples = [];
  for (const decision of decisions) {
    const sameMintTouches = touchesByMint.get(decision.mint) || [];
    const priorOrSameTouches = sameMintTouches.filter((touch) => (
      Number.isFinite(touch.atMs)
      && Number.isFinite(decision.atMs)
      && touch.atMs <= decision.atMs
    ));
    const futureTouches = sameMintTouches.filter((touch) => (
      Number.isFinite(touch.atMs)
      && Number.isFinite(decision.atMs)
      && touch.atMs > decision.atMs
    ));
    if (priorOrSameTouches.length) decisionsWithPriorOrSameTouch += 1;
    if (futureTouches.length) decisionsWithFutureTouch += 1;
    if (priorOrSameTouches.length && !decision.hasAnyWalletTouch) {
      decisionsWithPriorOrSameTouchButNoContext += 1;
      if (decisionMissSamples.length < 16) {
        const nearest = priorOrSameTouches[priorOrSameTouches.length - 1];
        decisionMissSamples.push({
          mint: decision.mint,
          symbol: decision.symbol || nearest.symbol || null,
          decisionAt: decision.at || null,
          reason: decision.reason || null,
          score: decision.score,
          curveProgress: decision.curveProgress,
          nearestTouchAt: nearest.at || null,
          nearestTouchWallet: nearest.wallet || null,
          nearestTouchSide: nearest.side || nearest.txType || null,
          nearestTouchSourceKind: nearest.sourceKind || null,
          decisionMinusTouchMs: Number.isFinite(decision.atMs) && Number.isFinite(nearest.atMs)
            ? Math.round(decision.atMs - nearest.atMs)
            : null
        });
      }
    }
  }

  const overlapMints = [...touchesByMint.keys()].filter((mint) => decisionsByMint.has(mint));
  return {
    walletTouchRows: touches.length,
    walletTouchUniqueMints: touchesByMint.size,
    paperDecisionRows: decisions.length,
    paperDecisionUniqueMints: decisionsByMint.size,
    overlapMints: overlapMints.length,
    overlapMintSamples: overlapMints.slice(0, 12),
    joinStatusCounts,
    touchRowsWithNoPaperDecisionForMint: Number(joinStatusCounts.no_paper_decision_for_wallet_mint || 0),
    touchRowsAfterLastPaperDecision: Number(joinStatusCounts.touch_after_last_decision || 0),
    touchRowsBeforePaperDecisionButContextAbsent: Number(joinStatusCounts.touch_before_first_decision_context_absent || 0)
      + Number(joinStatusCounts.touch_before_later_decision_context_absent || 0),
    touchRowsWithSameMintContextPresent: Number(joinStatusCounts.same_mint_context_present || 0),
    decisionsWithPriorOrSameWalletTouch: decisionsWithPriorOrSameTouch,
    decisionsWithFutureWalletTouch: decisionsWithFutureTouch,
    decisionsWithPriorOrSameWalletTouchButNoContext: decisionsWithPriorOrSameTouchButNoContext,
    touchExplanations,
    decisionMissSamples
  };
}

function summarizeJoinMissTelemetry(rows = []) {
  return {
    rows: rows.length,
    reasonCounts: countBy(rows, (row) => row.reason),
    sourceReasonCounts: countBy(rows, (row) => row.sourceReason),
    priorTrackedRows: rows.reduce((sum, row) => sum + Number(row.priorTrackedRows || 0), 0),
    priorUntrustedRows: rows.reduce((sum, row) => sum + Number(row.priorUntrustedRows || 0), 0),
    futureTrackedRows: rows.reduce((sum, row) => sum + Number(row.futureTrackedRows || 0), 0),
    futureUntrustedRows: rows.reduce((sum, row) => sum + Number(row.futureUntrustedRows || 0), 0),
    samples: rows.slice(0, 16).map((row) => ({
      mint: row.mint || null,
      symbol: row.symbol || null,
      reason: row.reason || null,
      sourceReason: row.sourceReason || null,
      decisionAt: row.at || null,
      walletContextSource: row.walletContextSource || null,
      priorTrackedRows: row.priorTrackedRows ?? null,
      priorUntrustedRows: row.priorUntrustedRows ?? null,
      nearestPriorTouch: row.nearestPriorTouch || null,
      nearestFutureTouch: row.nearestFutureTouch || null
    }))
  };
}

function summarizeShadowJoinMissAmbiguity(shadowRows = [], joinMissRows = []) {
  const emittedJoinMissKeys = new Set(joinMissRows.map((row) => (
    `${row.mint || ''}:${row.timestamp || row.at || ''}:${row.sourceReason || ''}`
  )));
  const summary = {
    shadowRows: shadowRows.length,
    emittedJoinMissRows: joinMissRows.length,
    withAttachedWalletTouch: 0,
    withJoinMissPayload: 0,
    notApplicableTouchAttached: 0,
    noSameMintLedgerTouch: 0,
    noJoinMissPayload: 0,
    sameMintLedgerTouchWithoutEmittedJoinMiss: 0,
    emittedJoinMissMatchedToShadowRow: 0,
    joinMissReasonCounts: {},
    samples: []
  };

  for (const row of shadowRows) {
    const payload = row.walletContextJoinMiss || null;
    const walletTouchCount = Number(row.walletTouchCount || 0);
    if (walletTouchCount > 0) summary.withAttachedWalletTouch += 1;
    if (!payload || typeof payload !== 'object') {
      if (walletTouchCount > 0) {
        summary.notApplicableTouchAttached += 1;
      } else {
        summary.noJoinMissPayload += 1;
      }
      if (summary.samples.length < 16) {
        summary.samples.push({
          mint: row.mint || null,
          symbol: row.symbol || null,
          sourceReason: row.sourceReason || null,
          shadowReason: row.shadowReason || null,
          walletTouchCount,
          classification: walletTouchCount > 0 ? 'NOT_APPLICABLE_TOUCH_ATTACHED' : 'NO_JOIN_MISS_PAYLOAD'
        });
      }
      continue;
    }

    summary.withJoinMissPayload += 1;
    const reason = payload.reason || 'unknown';
    summary.joinMissReasonCounts[reason] = (summary.joinMissReasonCounts[reason] || 0) + 1;
    if (reason === 'NO_SAME_MINT_TOUCH_IN_LEDGER') summary.noSameMintLedgerTouch += 1;

    const key = `${row.mint || ''}:${row.timestamp || row.at || ''}:${row.sourceReason || ''}`;
    const emitted = emittedJoinMissKeys.has(key);
    if (emitted) summary.emittedJoinMissMatchedToShadowRow += 1;
    if (reason !== 'NO_SAME_MINT_TOUCH_IN_LEDGER' && !emitted) {
      summary.sameMintLedgerTouchWithoutEmittedJoinMiss += 1;
    }

    if (summary.samples.length < 16 && (!emitted || reason === 'NO_SAME_MINT_TOUCH_IN_LEDGER')) {
      summary.samples.push({
        mint: row.mint || null,
        symbol: row.symbol || null,
        sourceReason: row.sourceReason || null,
        shadowReason: row.shadowReason || null,
        walletTouchCount,
        classification: reason,
        priorTrackedRows: payload.priorTrackedRows ?? null,
        priorUntrustedRows: payload.priorUntrustedRows ?? null,
        futureTrackedRows: payload.futureTrackedRows ?? null,
        futureUntrustedRows: payload.futureUntrustedRows ?? null
      });
    }
  }

  summary.zeroJoinMissAndZeroLedgerTouch = summary.noSameMintLedgerTouch;
  summary.ambiguousSilentRows = summary.noJoinMissPayload;
  summary.verdict = summary.noJoinMissPayload > 0
    ? 'SHADOW_JOIN_CLASSIFIER_PAYLOAD_MISSING'
    : (summary.sameMintLedgerTouchWithoutEmittedJoinMiss > 0
      ? 'SAME_MINT_LEDGER_TOUCH_WITHOUT_JOIN_MISS_EVENT'
      : 'SHADOW_JOIN_MISS_ACCOUNTED');
  summary.joinMissReasonCounts = Object.fromEntries(
    Object.entries(summary.joinMissReasonCounts).sort((a, b) => b[1] - a[1])
  );
  return summary;
}

function substrateFreshness({ runtime, historicalLedger, manualKolSummary }) {
  const durationHours = Number(runtime.durationMinutes || 0) > 0 ? Number(runtime.durationMinutes) / 60 : null;
  const providerTradeEvents = Number(runtime.trackingOpportunity?.providerTradeEvents || 0);
  const walletEvents = Number(runtime.walletEvents?.rows || 0);
  const untrustedRows = Number(runtime.trackingOpportunity?.walletChannelPartition?.untrackedDropped?.rows || 0);
  const pre85BuyRows = Number(runtime.trackingOpportunity?.walletChannelPartition?.totals?.pre85BuyRows || 0);
  const historicalRows = Number(historicalLedger?.rows || 0);
  const historicalWallets = Number(historicalLedger?.uniqueWallets || 0);
  const manualAgeDays = Number(manualKolSummary?.ageDays);
  const hitRate = providerTradeEvents > 0 ? walletEvents / providerTradeEvents : null;
  const runtimeTrackedEventsPerHour = durationHours ? walletEvents / durationHours : null;
  const providerTradesPerHour = durationHours ? providerTradeEvents / durationHours : null;
  const decayed = providerTradeEvents >= 100
    && walletEvents <= 5
    && Number(hitRate || 0) < 0.005
    && Number(manualAgeDays || 0) >= 30;
  return {
    verdict: decayed ? 'TRACKED_SUBSTRATE_DECAYED' : 'TRACKED_SUBSTRATE_ACTIVE_OR_INCONCLUSIVE',
    providerTradeEvents,
    untrustedTradeRows: untrustedRows,
    pre85BuyRows,
    trackedWalletEvents: walletEvents,
    walletObservedHitRate: hitRate === null ? null : compact(hitRate, 6),
    durationHours: durationHours === null ? null : compact(durationHours, 3),
    providerTradesPerHour: providerTradesPerHour === null ? null : compact(providerTradesPerHour, 3),
    runtimeTrackedEventsPerHour: runtimeTrackedEventsPerHour === null ? null : compact(runtimeTrackedEventsPerHour, 3),
    manualKolAgeDays: Number.isFinite(manualAgeDays) ? compact(manualAgeDays, 2) : null,
    historicalLedgerRows: historicalRows,
    historicalLedgerUniqueWallets: historicalWallets,
    historicalRowsPerTrackedWallet: historicalWallets > 0 ? compact(historicalRows / historicalWallets, 3) : null,
    stoppingRule: {
      targetWouldEnterSamples: 10,
      maxOosRunsWithoutTarget: 5,
      maxRuntimeHoursWithoutTarget: 20,
      currentRunWouldEnterSamples: Number(runtime.walletRelaxedShadowCoverage?.wouldEnter || 0),
      currentRunShadowAttempts: Number(runtime.walletRelaxedShadowCoverage?.attempts || 0),
      currentRunVerdict: Number(runtime.walletRelaxedShadowCoverage?.wouldEnter || 0) < 10
        ? 'BELOW_SAMPLE_TARGET'
        : 'SAMPLE_TARGET_MET'
    }
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

async function summarizeTelemetry(filePath, promotionIndex, substrateIndex) {
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
  const guardAttributionCoverage = {
    total: 0,
    mints: new Set(),
    withAny: 0,
    withPositiveOrProven: 0,
    withAvoid: 0,
    contextSources: {},
    byReason: {},
    sampleRows: []
  };
  const unflaggedShadowGuardCoverage = {
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
  const providerTradeDiagnostics = {
    events: 0,
    withTraderFieldKnown: 0,
    traderPresent: 0,
    trackedAccountMatch: 0,
    kolWalletProfileMatch: 0,
    shadowWalletProfileMatch: 0,
    watchedWalletFlag: 0
  };
  const walletGateDiagnostics = {
    rows: 0,
    traderPresent: 0,
    noTraderField: 0,
    untrackedWallet: 0,
    recorded: 0,
    ledgerFailures: 0,
    ledgerSkipped: 0,
    untrustedTapeRecords: 0,
    trackedAccountMatch: 0,
    kolWalletProfileMatch: 0,
    shadowWalletProfileMatch: 0,
    uniqueWalletsWithTrader: new Set(),
    uniqueUntrackedWallets: new Set(),
    reasonCounts: {},
    providerCounts: {},
    sourceCounts: {},
    rawTraderFieldKeyCounts: {},
    samples: []
  };
  const curveSnapshotsByMint = new Map();
  const untrackedWalletRows = [];
  const recordedWalletGateRows = [];
  const paperDecisionRows = [];
  const joinMissRows = [];
  const walletRelaxedShadowRows = [];
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
      walletEvents.push({
        ...payload,
        atMs,
        at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
        sourceKind: 'wallet.trade_observed',
        promotion
      });
      return;
    }

    if (type === 'wallet_context.join_miss') {
      joinMissRows.push({
        ...payload,
        atMs,
        at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null
      });
      return;
    }

    if (type === 'pump_bonding_curve.provider_snapshot' || type === 'pre_migration.observed') {
      const mint = mintOf(payload);
      const atMsForSnapshot = timestampMs(payload.timestamp || event.timestamp);
      const curveProgress = curveOf(payload);
      if (mint && Number.isFinite(atMsForSnapshot) && Number.isFinite(Number(curveProgress))) {
        if (!curveSnapshotsByMint.has(mint)) curveSnapshotsByMint.set(mint, []);
        curveSnapshotsByMint.get(mint).push({
          atMs: atMsForSnapshot,
          curveProgress,
          priceSol: priceOf(payload)
        });
      }
    }

    if (type === 'provider.pumpdev.runtime_trade' || type === 'provider.pumpportal.trade') {
      providerTradeDiagnostics.events += 1;
      if (payload.traderPresent !== undefined) providerTradeDiagnostics.withTraderFieldKnown += 1;
      if (payload.traderPresent === true) providerTradeDiagnostics.traderPresent += 1;
      if (payload.trackedAccountMatch === true) providerTradeDiagnostics.trackedAccountMatch += 1;
      if (payload.kolWalletProfileMatch === true) providerTradeDiagnostics.kolWalletProfileMatch += 1;
      if (payload.shadowWalletProfileMatch === true) providerTradeDiagnostics.shadowWalletProfileMatch += 1;
      if (payload.watchedWallet === true) providerTradeDiagnostics.watchedWalletFlag += 1;
    }

    if (type === 'wallet.trade_gate_diagnostic') {
      const reason = payload.dropReason || 'unknown';
      const provider = payload.provider || 'unknown';
      const source = payload.source || 'unknown';
      walletGateDiagnostics.rows += 1;
      walletGateDiagnostics.reasonCounts[reason] = (walletGateDiagnostics.reasonCounts[reason] || 0) + 1;
      walletGateDiagnostics.providerCounts[provider] = (walletGateDiagnostics.providerCounts[provider] || 0) + 1;
      walletGateDiagnostics.sourceCounts[source] = (walletGateDiagnostics.sourceCounts[source] || 0) + 1;
      if (payload.traderPresent === true || walletOf(payload)) {
        walletGateDiagnostics.traderPresent += 1;
        const wallet = walletOf(payload);
        if (wallet) walletGateDiagnostics.uniqueWalletsWithTrader.add(wallet);
      }
      if (reason === 'NO_TRADER_FIELD') walletGateDiagnostics.noTraderField += 1;
      if (reason === 'UNTRACKED_WALLET') {
        walletGateDiagnostics.untrackedWallet += 1;
        const wallet = walletOf(payload);
        if (wallet) walletGateDiagnostics.uniqueUntrackedWallets.add(wallet);
        const mint = mintOf(payload);
        const rowAtMs = timestampMs(payload.timestamp || event.timestamp);
        if (wallet && mint && Number.isFinite(rowAtMs)) {
          untrackedWalletRows.push({
            atMs: rowAtMs,
            at: new Date(rowAtMs).toISOString(),
            sourceKind: 'wallet.trade_gate_diagnostic.UNTRACKED_WALLET',
            provider,
            source,
            mint,
            symbol: payload.symbol || null,
            wallet,
            txType: payload.txType || null,
            curveProgress: curveOf(payload),
            priceSol: priceOf(payload)
          });
        }
      }
      if (reason === 'RECORDED' || payload.ledgerRecord === true) walletGateDiagnostics.recorded += 1;
      if (payload.untrustedTapeRecord === true) walletGateDiagnostics.untrustedTapeRecords += 1;
      if (reason === 'RECORDED' || payload.ledgerRecord === true) {
        const wallet = walletOf(payload);
        const mint = mintOf(payload);
        const rowAtMs = timestampMs(payload.timestamp || event.timestamp);
        const promotion = promotionFor(promotionIndex, wallet, payload.name || payload.profile);
        if (wallet && mint && Number.isFinite(rowAtMs)) {
          recordedWalletGateRows.push({
            atMs: rowAtMs,
            at: new Date(rowAtMs).toISOString(),
            sourceKind: 'wallet.trade_gate_diagnostic.RECORDED',
            provider,
            source,
            mint,
            symbol: payload.symbol || null,
            wallet,
            side: payload.txType || null,
            txType: payload.txType || null,
            watchedReason: payload.watchedReason || null,
            trackedAccountMatch: payload.trackedAccountMatch === true,
            kolWalletProfileMatch: payload.kolWalletProfileMatch === true,
            shadowWalletProfileMatch: payload.shadowWalletProfileMatch === true,
            reviewTier: promotion?.reviewTier || null,
            evidenceTier: promotion?.evidenceTier || null
          });
        }
      }
      if (reason === 'WALLET_LEDGER_RECORD_FAILED') walletGateDiagnostics.ledgerFailures += 1;
      if (reason === 'WALLET_LEDGER_RECORD_SKIPPED') walletGateDiagnostics.ledgerSkipped += 1;
      if (payload.trackedAccountMatch === true) walletGateDiagnostics.trackedAccountMatch += 1;
      if (payload.kolWalletProfileMatch === true) walletGateDiagnostics.kolWalletProfileMatch += 1;
      if (payload.shadowWalletProfileMatch === true) walletGateDiagnostics.shadowWalletProfileMatch += 1;
      for (const key of Array.isArray(payload.rawTraderFieldKeys) ? payload.rawTraderFieldKeys : []) {
        walletGateDiagnostics.rawTraderFieldKeyCounts[key] = (walletGateDiagnostics.rawTraderFieldKeyCounts[key] || 0) + 1;
      }
      if (walletGateDiagnostics.samples.length < 12) {
        walletGateDiagnostics.samples.push({
          provider: payload.provider || null,
          source: payload.source || null,
          mint: mintOf(payload),
          wallet: walletOf(payload),
          txType: payload.txType || null,
          dropReason: reason,
          trackedAccountMatch: payload.trackedAccountMatch === true,
          kolWalletProfileMatch: payload.kolWalletProfileMatch === true,
          shadowWalletProfileMatch: payload.shadowWalletProfileMatch === true,
          rawTraderFieldKeys: Array.isArray(payload.rawTraderFieldKeys) ? payload.rawTraderFieldKeys : []
        });
      }
    }

    if (type === 'pre_migration_paper.decision') {
      const context = payload.walletClassificationContext || {};
      const summarized = summarizeWalletContext(context);
      paperDecisionRows.push({
        atMs,
        at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
        mint: mintOf(payload),
        symbol: payload.symbol || null,
        reason: payload.reason || payload.skipReason || payload.decision || 'unknown',
        decision: payload.decision || null,
        score: compact(payload.score, 2),
        curveProgress: compact(payload.curveProgress ?? payload.providerCurveProgress ?? payload.paperCurveProgress, 6),
        hasAnyWalletTouch: summarized.anyTouch,
        positiveOrProvenTouchCount: summarized.positiveOrProvenTouchCount,
        avoidTouchCount: summarized.avoidTouchCount,
        contextSource: summarized.contextSource
      });
      addDecisionCoverage(decisionCoverage, event, promotionIndex);
      return;
    }

    if (type === 'pre_migration_paper.guard_attribution') {
      addDecisionCoverage(guardAttributionCoverage, event, promotionIndex);
      if (payload.shadowOnly === true && payload.shadowReason === 'UNFLAGGED_ENTRY_FUNNEL_SHADOW') {
        addDecisionCoverage(unflaggedShadowGuardCoverage, event, promotionIndex);
      }
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
      walletRelaxedShadowRows.push({
        atMs,
        at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
        mint,
        symbol: payload.symbol || null,
        timestamp: payload.timestamp || event.timestamp || null,
        sourceReason: payload.sourceReason || null,
        sourceDecision: payload.sourceDecision || null,
        shadowReason: payload.shadowReason || null,
        walletTouchCount: Number(payload.walletTouchCount || 0),
        walletContextSource: payload.walletContextSource || null,
        walletContextJoinMiss: payload.walletContextJoinMiss || null,
        wouldEnter: type.endsWith('.would_enter')
      });
      void context;
    }
  });

  const walletMints = new Set(walletEvents.map((event) => event.mint).filter(Boolean));
  const decisionMints = decisionCoverage.mints;
  for (const snapshots of curveSnapshotsByMint.values()) {
    snapshots.sort((a, b) => a.atMs - b.atMs);
  }
  const untrackedRowsWithFollowThrough = untrackedWalletRows.map((row) => ({
    ...row,
    window120s: followThroughWindow(row, curveSnapshotsByMint, 120),
    window300s: followThroughWindow(row, curveSnapshotsByMint, 300)
  }));
  const walletChannelPartition = summarizeWalletChannelPartition({
    walletEvents,
    recordedWalletGateRows,
    untrackedWalletRows
  });
  const untrackedSubstrateOverlap = summarizeUntrackedSubstrateOverlap(untrackedWalletRows, substrateIndex);
  const walletDecisionJoin = summarizeWalletDecisionJoin([
    ...walletEvents.map((event) => ({
      atMs: event.atMs,
      at: event.at,
      sourceKind: event.sourceKind,
      mint: event.mint,
      symbol: event.symbol || null,
      wallet: walletOf(event),
      side: event.side || null,
      watchedReason: event.watchedReason || null,
      reviewTier: event.promotion?.reviewTier || null,
      evidenceTier: event.promotion?.evidenceTier || null
    })),
    ...recordedWalletGateRows
  ], paperDecisionRows);
  const allTapeDecisionJoin = summarizeWalletDecisionJoin([
    ...walletEvents.map((event) => ({
      atMs: event.atMs,
      at: event.at,
      sourceKind: event.sourceKind,
      mint: event.mint,
      symbol: event.symbol || null,
      wallet: walletOf(event),
      side: event.side || null,
      watchedReason: event.watchedReason || null,
      reviewTier: event.promotion?.reviewTier || null,
      evidenceTier: event.promotion?.evidenceTier || null
    })),
    ...recordedWalletGateRows,
    ...untrackedRowsWithFollowThrough
  ], paperDecisionRows);
  const joinMissTelemetry = summarizeJoinMissTelemetry(joinMissRows);
  const shadowJoinMissAmbiguity = summarizeShadowJoinMissAmbiguity(walletRelaxedShadowRows, joinMissRows);
  const overlap = [...walletMints].filter((mint) => decisionMints.has(mint)).length;
  const promoted = walletEvents.filter((event) => event.promotion);
  const providerTradeEvents = Number(eventCounts['provider.pumpdev.runtime_trade'] || 0)
    + Number(eventCounts['provider.pumpportal.trade'] || 0);
  const finalizedWalletGateDiagnostics = {
    rows: walletGateDiagnostics.rows,
    traderPresent: walletGateDiagnostics.traderPresent,
    noTraderField: walletGateDiagnostics.noTraderField,
    untrackedWallet: walletGateDiagnostics.untrackedWallet,
    recorded: walletGateDiagnostics.recorded,
    ledgerFailures: walletGateDiagnostics.ledgerFailures,
    ledgerSkipped: walletGateDiagnostics.ledgerSkipped,
    untrustedTapeRecords: walletGateDiagnostics.untrustedTapeRecords,
    trackedAccountMatch: walletGateDiagnostics.trackedAccountMatch,
    kolWalletProfileMatch: walletGateDiagnostics.kolWalletProfileMatch,
    shadowWalletProfileMatch: walletGateDiagnostics.shadowWalletProfileMatch,
    uniqueWalletsWithTrader: walletGateDiagnostics.uniqueWalletsWithTrader.size,
    uniqueUntrackedWallets: walletGateDiagnostics.uniqueUntrackedWallets.size,
    reasonCounts: Object.fromEntries(Object.entries(walletGateDiagnostics.reasonCounts).sort((a, b) => b[1] - a[1])),
    providerCounts: Object.fromEntries(Object.entries(walletGateDiagnostics.providerCounts).sort((a, b) => b[1] - a[1])),
    sourceCounts: Object.fromEntries(Object.entries(walletGateDiagnostics.sourceCounts).sort((a, b) => b[1] - a[1])),
    rawTraderFieldKeyCounts: Object.fromEntries(Object.entries(walletGateDiagnostics.rawTraderFieldKeyCounts).sort((a, b) => b[1] - a[1])),
    traderPresentRate: walletGateDiagnostics.rows > 0
      ? compact(walletGateDiagnostics.traderPresent / walletGateDiagnostics.rows, 6)
      : null,
    recordedRate: walletGateDiagnostics.rows > 0
      ? compact(walletGateDiagnostics.recorded / walletGateDiagnostics.rows, 6)
      : null,
    samples: walletGateDiagnostics.samples
  };
  const walletObservationChannel = walletEvents.length > 0
    ? 'runtime_tracked_wallet_observed'
    : (providerTradeEvents > 0 && finalizedWalletGateDiagnostics.rows > 0
      ? 'provider_trade_flow_gate_diagnosed_without_tracked_wallet'
      : (providerTradeEvents > 0
        ? 'provider_trade_flow_without_wallet_gate_diagnostics'
        : 'no_provider_trade_flow'));
  const bridgeValidationStatus = walletEvents.length > 0
    || shadow.withAny > 0
    || decisionCoverage.withAny > 0
    || guardAttributionCoverage.withAny > 0
    || unflaggedShadowGuardCoverage.withAny > 0
    ? 'wallet_context_available_for_bridge_validation'
    : (providerTradeEvents > 0
      ? 'inactive_wallet_channel_unavailable'
      : 'inactive_no_provider_trade_flow');

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
      walletObservedHitRate: providerTradeEvents > 0 ? compact(walletEvents.length / providerTradeEvents, 6) : null,
      providerTradeDiagnostics: {
        ...providerTradeDiagnostics,
        traderPresentRate: providerTradeDiagnostics.withTraderFieldKnown > 0
          ? compact(providerTradeDiagnostics.traderPresent / providerTradeDiagnostics.withTraderFieldKnown, 6)
          : null,
        trackedAccountMatchRate: providerTradeDiagnostics.withTraderFieldKnown > 0
          ? compact(providerTradeDiagnostics.trackedAccountMatch / providerTradeDiagnostics.withTraderFieldKnown, 6)
          : null,
        kolWalletProfileMatchRate: providerTradeDiagnostics.withTraderFieldKnown > 0
          ? compact(providerTradeDiagnostics.kolWalletProfileMatch / providerTradeDiagnostics.withTraderFieldKnown, 6)
          : null,
        shadowWalletProfileMatchRate: providerTradeDiagnostics.withTraderFieldKnown > 0
          ? compact(providerTradeDiagnostics.shadowWalletProfileMatch / providerTradeDiagnostics.withTraderFieldKnown, 6)
          : null
      },
      walletGateDiagnostics: finalizedWalletGateDiagnostics,
      walletChannelPartition,
      untrackedSubstrateOverlap,
      untrackedWalletOpportunity: summarizeUntrackedWalletOpportunity(untrackedRowsWithFollowThrough, decisionMints),
      untrackedWalletDecisionJoin: summarizeUntrackedDecisionJoin(untrackedRowsWithFollowThrough, paperDecisionRows),
      allTapeDecisionJoin,
      walletContextJoinMissTelemetry: joinMissTelemetry,
      shadowJoinMissAmbiguity,
      walletObservationChannel,
      bridgeValidationStatus
    },
    decisionCoverage: finalizeDecisionCoverage(decisionCoverage),
    guardAttributionCoverage: finalizeDecisionCoverage(guardAttributionCoverage),
    unflaggedEntryShadowGuardCoverage: finalizeDecisionCoverage(unflaggedShadowGuardCoverage),
    walletDecisionMintOverlap: {
      uniqueWalletEventMints: walletMints.size,
      uniqueDecisionMints: decisionMints.size,
      overlapMints: overlap
    },
    walletDecisionJoin,
    allTapeDecisionJoin,
    walletContextJoinMissTelemetry: joinMissTelemetry,
    shadowJoinMissAmbiguity,
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
  const substrateIndex = await buildWalletSubstrateIndex();
  const [historicalLedger, runtime] = await Promise.all([
    summarizeHistoricalLedger(promotionIndex),
    summarizeTelemetry(telemetryPath, promotionIndex, substrateIndex)
  ]);
  const manualKolSummary = {
    ...fileSummary(MANUAL_KOL_WALLET_PATH),
    configuredWalletCount: countManualKolWallets(MANUAL_KOL_WALLET_PATH)
  };
  const trackedSubstrateFreshness = substrateFreshness({
    runtime,
    historicalLedger,
    manualKolSummary
  });

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
      manualKolWalletPath: MANUAL_KOL_WALLET_PATH,
      walletPnlEvidencePath: WALLET_PNL_EVIDENCE_PATH
    },
    trackingSubstrate: {
      launchIntelWalletIndex: fileSummary(LAUNCH_INTEL_WALLET_INDEX_PATH),
      manualKolWallets: manualKolSummary,
      walletEventLedger: fileSummary(WALLET_EVENTS_PATH)
    },
    trackedSubstrateFreshness,
    walletSubstrateIndex: {
      counts: substrateIndex.counts,
      sources: substrateIndex.sources
    },
    promotionReview: {
      groupCounts: promotionIndex.groupCounts,
      totalAddresses: promotionIndex.byAddress.size
    },
    historicalLedger,
    runtime,
    interpretation: {
      liveBroadcastImplication: 'none_report_only',
      walletObservationChannel: runtime.trackingOpportunity.walletObservationChannel,
      bridgeValidationStatus: runtime.trackingOpportunity.bridgeValidationStatus,
      trackedSubstrateFreshness: trackedSubstrateFreshness.verdict,
      summary: trackedSubstrateFreshness.verdict === 'TRACKED_SUBSTRATE_DECAYED'
        ? `Runtime provider tape was active (${trackedSubstrateFreshness.providerTradeEvents} trades; ${trackedSubstrateFreshness.pre85BuyRows} pre-85 buys) but tracked wallet hits were near zero (${trackedSubstrateFreshness.trackedWalletEvents}); the wallet-conditioned lane is substrate-starved, not market-starved.`
        : (verdict === 'BROAD_TRACKED_WALLET_SIGNAL_OBSERVED'
        ? 'Runtime saw tracked wallet touches feeding the broadened wallet-relaxed shadow lane; inspect outcome follow-through before any runtime use.'
        : (verdict === 'PROSPECTIVE_WALLET_SIGNAL_STARVED'
        ? `Runtime saw provider trade flow but no tracked wallet.trade_observed events, so wallet-conditioned lanes cannot collect fresh runtime evidence from this run. Channel=${runtime.trackingOpportunity.walletObservationChannel}; bridgeValidation=${runtime.trackingOpportunity.bridgeValidationStatus}.`
        : 'Runtime saw at least some promoted wallet signal; inspect shadow coverage before considering any runtime use.'))
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
