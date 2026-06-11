#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'weak-market-scalp-replay-latest.json');
const SLIPPAGE_LADDER_PCT = [1.5, 3, 5];
const BOOTSTRAP_ITERATIONS = 1000;
const GRADUATION_CRITERIA = {
  mode: 'pre_registered_replay_only_thresholds',
  minClosedTradesPerProfile: 50,
  minTelemetryRuns: 10,
  requirePnlAfterRemovingTop3WinnersPositive: true,
  maxTop1GrossWinShare: 0.4,
  minProfitFactorAt3PctEachWay: 1,
  minWinRate: 0.5,
  maxLongestLossStreak: 8,
  requireBootstrapPnlP05Positive: true,
  maxLowSnapshotTradeShare: 0.25,
  minTradesPerHour: 0.5,
  note: 'Frozen before promotion review. Passing this only permits discussion of a prospective paper shadow lane; it does not permit paper entries, runtime gate changes, live broadcast, or live trading.'
};

const PROFILES = {
  oversold_attention_reclaim_60s_tp12_sl8: {
    description: 'Score/flow attention that has been slapped down, then reclaims from local low. Fast 12%/8% scalp.',
    family: 'oversold_attention_reclaim',
    amountSol: 0.02,
    minScore: 70,
    minCurveProgress: 0.45,
    maxCurveProgress: 0.92,
    minRecentVolumeSol: 12,
    minTradeVelocityPerMin: 12,
    maxSniperWalletCount: 7,
    requireNoAvoidWallet: true,
    lookbackSeconds: 90,
    minDrawdownPct: 12,
    entryLookaheadSeconds: 60,
    reclaimFromLowPct: 4,
    takeProfitPct: 0.12,
    stopLossPct: 0.08,
    maxHoldSeconds: 60,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5,
    trailingActivationPct: 0.10,
    trailingGivebackPct: 0.05
  },
  oversold_attention_reclaim_tight_45s_tp8_sl6: {
    description: 'Tighter consistency variant: smaller 8% target, 6% stop, 45s hold after oversold reclaim.',
    family: 'oversold_attention_reclaim',
    amountSol: 0.02,
    minScore: 65,
    minCurveProgress: 0.4,
    maxCurveProgress: 0.9,
    minRecentVolumeSol: 8,
    minTradeVelocityPerMin: 8,
    maxSniperWalletCount: 5,
    requireNoAvoidWallet: true,
    lookbackSeconds: 75,
    minDrawdownPct: 10,
    entryLookaheadSeconds: 45,
    reclaimFromLowPct: 3,
    takeProfitPct: 0.08,
    stopLossPct: 0.06,
    maxHoldSeconds: 45,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5,
    trailingActivationPct: 0.08,
    trailingGivebackPct: 0.035
  },
  oversold_attention_reclaim_pressure_45s_tp8_sl6: {
    description: 'Tight oversold reclaim plus buy pressure and buyer breadth filters.',
    family: 'oversold_attention_reclaim',
    amountSol: 0.02,
    minScore: 65,
    minCurveProgress: 0.4,
    maxCurveProgress: 0.9,
    minRecentVolumeSol: 8,
    minTradeVelocityPerMin: 8,
    minBuyRatio: 0.55,
    minUniqueBuyerRatio: 0.8,
    maxSniperWalletCount: 5,
    requireNoAvoidWallet: true,
    lookbackSeconds: 75,
    minDrawdownPct: 10,
    entryLookaheadSeconds: 45,
    reclaimFromLowPct: 3,
    takeProfitPct: 0.08,
    stopLossPct: 0.06,
    maxHoldSeconds: 45,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5,
    trailingActivationPct: 0.08,
    trailingGivebackPct: 0.035
  },
  mainrunner_low_size_topblast_45s_tp10_sl8: {
    description: 'Low-size topblast on strong near-runner attention. Enters immediately, exits fast.',
    family: 'mainrunner_low_size_topblast',
    amountSol: 0.01,
    minScore: 82,
    minCurveProgress: 0.78,
    maxCurveProgress: 0.96,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    maxSniperWalletCount: 7,
    requireNoAvoidWallet: true,
    takeProfitPct: 0.10,
    stopLossPct: 0.08,
    maxHoldSeconds: 45,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5,
    trailingActivationPct: 0.10,
    trailingGivebackPct: 0.04
  },
  mainrunner_low_size_micro_30s_tp6_sl6: {
    description: 'Very small consistency topblast: 6%/6%, max 30s, for weak-market chop.',
    family: 'mainrunner_low_size_topblast',
    amountSol: 0.01,
    minScore: 78,
    minCurveProgress: 0.72,
    maxCurveProgress: 0.94,
    minRecentVolumeSol: 12,
    minTradeVelocityPerMin: 12,
    maxSniperWalletCount: 5,
    requireNoAvoidWallet: true,
    takeProfitPct: 0.06,
    stopLossPct: 0.06,
    maxHoldSeconds: 30,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5,
    trailingActivationPct: 0.07,
    trailingGivebackPct: 0.03
  },
  mainrunner_low_size_micro_pressure_30s_tp6_sl6: {
    description: 'Micro topblast plus buy pressure and buyer breadth filters.',
    family: 'mainrunner_low_size_topblast',
    amountSol: 0.01,
    minScore: 78,
    minCurveProgress: 0.72,
    maxCurveProgress: 0.94,
    minRecentVolumeSol: 12,
    minTradeVelocityPerMin: 12,
    minBuyRatio: 0.55,
    minUniqueBuyerRatio: 0.8,
    maxSniperWalletCount: 5,
    requireNoAvoidWallet: true,
    takeProfitPct: 0.06,
    stopLossPct: 0.06,
    maxHoldSeconds: 30,
    entrySlippagePct: 1.5,
    exitSlippagePct: 1.5,
    trailingActivationPct: 0.07,
    trailingGivebackPct: 0.03
  }
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

function telemetryFiles(limit = 5) {
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

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || event.telemetryType || 'unknown';
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function num(value, digits = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function priceOf(payload) {
  const direct = Number(
    payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol
  );
  if (Number.isFinite(direct) && direct > 0) return direct;

  const sol = Number(payload.virtualSolReservesSol ?? payload.bondingCurveState?.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens ?? payload.bondingCurveState?.virtualTokenReservesTokens);
  if (Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0) return sol / tokens;
  return null;
}

function isAvoidWallet(wallet = {}) {
  return wallet.evidenceTier === 'NEGATIVE_EVIDENCE' || wallet.reviewTier === 'AVOID_REVIEW';
}

function walletSummary(context = {}) {
  const wallets = Array.isArray(context.wallets) ? context.wallets : [];
  return {
    walletTouchCount: wallets.length,
    avoidWalletTouchCount: wallets.filter(isAvoidWallet).length
  };
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress) || !Number.isFinite(priceSol)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    curveProgress: num(curveProgress, 6),
    priceSol: num(priceSol, 15),
    eventType: eventType(event)
  };
}

function decisionFromEvent(event) {
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress) || !Number.isFinite(priceSol)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    decision: payload.decision || null,
    reason: payload.reason || null,
    preset: payload.preset || null,
    score: num(payload.score, 2),
    curveProgress: num(curveProgress, 6),
    priceSol: num(priceSol, 15),
    recentVolumeSol: num(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: num(payload.tradeVelocityPerMin, 2),
    buyRatio: num(payload.buyRatio, 4),
    uniqueBuyerCount: num(payload.uniqueBuyerCount, 0),
    uniqueBuyerRatio: num(payload.uniqueBuyerRatio, 4),
    sniperWalletCount: num(payload.sniperWalletCount, 0),
    curveProgressDelta: num(payload.curveProgressDelta ?? payload.earlySurgeCurveProgressDelta, 6),
    ...walletSummary(payload.walletClassificationContext || {})
  };
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const decisions = [];
  let malformedLines = 0;

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

    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }

    const decision = decisionFromEvent(event);
    if (decision) {
      decision.telemetryPath = path.relative(ROOT, filePath);
      decisions.push(decision);
    }
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  decisions.sort((a, b) => a.atMs - b.atMs);
  return {
    telemetryPath: path.relative(ROOT, filePath),
    snapshotsByMint,
    decisions,
    malformedLines,
    startAtMs: decisions.length ? decisions[0].atMs : null,
    endAtMs: decisions.length ? decisions[decisions.length - 1].atMs : null
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

function stats(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p10: null, p90: null, min: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: num(pick(0.5), digits),
    p10: num(pick(0.1), digits),
    p90: num(pick(0.9), digits),
    min: num(finite[0], digits),
    max: num(finite[finite.length - 1], digits),
    avg: num(sum / finite.length, digits)
  };
}

function passesBaseFilters(decision, profile) {
  if (Number(decision.score || 0) < profile.minScore) return false;
  if (Number(decision.curveProgress || 0) < profile.minCurveProgress) return false;
  if (Number(decision.curveProgress || 0) > profile.maxCurveProgress) return false;
  if (Number(decision.recentVolumeSol || 0) < profile.minRecentVolumeSol) return false;
  if (Number(decision.tradeVelocityPerMin || 0) < profile.minTradeVelocityPerMin) return false;
  if (profile.minBuyRatio !== undefined && Number(decision.buyRatio || 0) < profile.minBuyRatio) return false;
  if (profile.minUniqueBuyerRatio !== undefined && Number(decision.uniqueBuyerRatio || 0) < profile.minUniqueBuyerRatio) return false;
  if (Number(decision.sniperWalletCount || 0) > profile.maxSniperWalletCount) return false;
  if (profile.requireNoAvoidWallet && Number(decision.avoidWalletTouchCount || 0) > 0) return false;
  return true;
}

function localPriceContext(decision, snapshots, lookbackSeconds) {
  const startMs = decision.atMs - lookbackSeconds * 1000;
  const rows = snapshots.filter((snapshot) => snapshot.atMs >= startMs && snapshot.atMs <= decision.atMs);
  if (!rows.length) return null;
  const maxPrice = Math.max(...rows.map((row) => Number(row.priceSol)).filter(Number.isFinite));
  const minPrice = Math.min(...rows.map((row) => Number(row.priceSol)).filter(Number.isFinite));
  const currentPrice = Number(decision.priceSol);
  if (!Number.isFinite(maxPrice) || !Number.isFinite(minPrice) || !Number.isFinite(currentPrice) || maxPrice <= 0) return null;
  return {
    lookbackSnapshots: rows.length,
    maxPriceSol: maxPrice,
    minPriceSol: minPrice,
    drawdownPct: ((currentPrice / maxPrice) - 1) * 100,
    localLowDrawdownPct: ((minPrice / maxPrice) - 1) * 100
  };
}

function entryForDecision(decision, snapshots, profile) {
  if (!passesBaseFilters(decision, profile)) return { entry: null, reason: 'BASE_FILTERS' };

  if (profile.family === 'mainrunner_low_size_topblast') {
    const entry = snapshots.find((snapshot) => snapshot.atMs >= decision.atMs) || null;
    return entry ? { entry, reason: 'IMMEDIATE_TOPBLAST' } : { entry: null, reason: 'NO_ENTRY_SNAPSHOT' };
  }

  const context = localPriceContext(decision, snapshots, profile.lookbackSeconds);
  if (!context) return { entry: null, reason: 'NO_LOOKBACK_PRICE_CONTEXT' };
  if (context.drawdownPct > -profile.minDrawdownPct && context.localLowDrawdownPct > -profile.minDrawdownPct) {
    return { entry: null, reason: 'NOT_OVERSOLD_ENOUGH', context };
  }

  const deadlineMs = decision.atMs + profile.entryLookaheadSeconds * 1000;
  let low = Number(decision.priceSol);
  for (const snapshot of snapshots) {
    if (snapshot.atMs < decision.atMs || snapshot.atMs > deadlineMs) continue;
    const price = Number(snapshot.priceSol);
    if (!Number.isFinite(price) || price <= 0) continue;
    low = Math.min(low, price);
    const reclaimPct = ((price / low) - 1) * 100;
    if (reclaimPct >= profile.reclaimFromLowPct) {
      return { entry: snapshot, reason: 'OVERSOLD_RECLAIM', context: { ...context, reclaimPct: num(reclaimPct, 4) } };
    }
  }
  return { entry: null, reason: 'NO_RECLAIM', context };
}

function closeTrade(decision, entry, exit, reason, profile, netReturnPct, extra = {}) {
  const peakNetReturnPct = num(extra.peakNetReturnPct, 4);
  const troughNetReturnPct = num(extra.troughNetReturnPct, 4);
  return {
    telemetryPath: decision.telemetryPath,
    profileName: extra.profileName,
    family: profile.family,
    mint: decision.mint,
    symbol: decision.symbol,
    decisionAt: decision.at,
    sourceDecision: decision.decision,
    sourceReason: decision.reason,
    sourcePreset: decision.preset,
    score: decision.score,
    curveProgress: decision.curveProgress,
    recentVolumeSol: decision.recentVolumeSol,
    tradeVelocityPerMin: decision.tradeVelocityPerMin,
    buyRatio: decision.buyRatio,
    uniqueBuyerRatio: decision.uniqueBuyerRatio,
    sniperWalletCount: decision.sniperWalletCount,
    walletTouchCount: decision.walletTouchCount,
    avoidWalletTouchCount: decision.avoidWalletTouchCount,
    entryAt: entry?.at || null,
    entryCurveProgress: entry?.curveProgress ?? null,
    entryPriceSol: entry?.priceSol ?? null,
    exitAt: exit?.at || null,
    exitCurveProgress: exit?.curveProgress ?? null,
    exitPriceSol: exit?.priceSol ?? null,
    holdSeconds: entry && exit ? num((exit.atMs - entry.atMs) / 1000, 2) : null,
    exitReason: reason,
    grossReturnPct: entry && exit ? num(((Number(exit.priceSol) / Number(entry.priceSol)) - 1) * 100, 4) : null,
    netReturnPct: num(netReturnPct * 100, 4),
    pnlSol: num(profile.amountSol * netReturnPct, 9),
    entryReason: extra.entryReason || null,
    drawdownPct: num(extra.context?.drawdownPct, 4),
    localLowDrawdownPct: num(extra.context?.localLowDrawdownPct, 4),
    reclaimPct: num(extra.context?.reclaimPct, 4),
    snapshotsInHoldWindow: extra.snapshotsInHoldWindow ?? null,
    medianSnapshotIntervalMs: num(extra.medianSnapshotIntervalMs, 0),
    medianUniqueSnapshotIntervalMs: num(extra.medianUniqueSnapshotIntervalMs, 0),
    peakNetReturnPct,
    troughNetReturnPct,
    mfeCaptureRatio: peakNetReturnPct && peakNetReturnPct > 0 ? num((num(netReturnPct * 100, 4) || 0) / peakNetReturnPct, 4) : null
  };
}

function medianSnapshotIntervalMs(rows) {
  const deltas = [];
  for (let index = 1; index < rows.length; index += 1) {
    const delta = Number(rows[index].atMs) - Number(rows[index - 1].atMs);
    if (Number.isFinite(delta) && delta >= 0) deltas.push(delta);
  }
  return stats(deltas, 0).median;
}

function medianUniqueSnapshotIntervalMs(rows) {
  const uniqueRows = [];
  let lastAtMs = null;
  for (const row of rows) {
    if (!Number.isFinite(row.atMs) || row.atMs === lastAtMs) continue;
    uniqueRows.push(row);
    lastAtMs = row.atMs;
  }
  return medianSnapshotIntervalMs(uniqueRows);
}

function simulateExit(decision, entry, snapshots, profile, extra) {
  const exitWindow = snapshots.filter((snapshot) => (
    snapshot.atMs > entry.atMs && snapshot.atMs <= entry.atMs + profile.maxHoldSeconds * 1000
  ));
  if (!exitWindow.length) return closeTrade(decision, entry, null, 'NO_FUTURE_SNAPSHOTS', profile, 0, extra);

  const entryFill = Number(entry.priceSol) * (1 + profile.entrySlippagePct / 100);
  let peakNetReturn = -Infinity;
  let troughNetReturn = Infinity;
  let last = exitWindow[exitWindow.length - 1];
  const exitMeta = {
    ...extra,
    snapshotsInHoldWindow: exitWindow.length,
    medianSnapshotIntervalMs: medianSnapshotIntervalMs([entry, ...exitWindow]),
    medianUniqueSnapshotIntervalMs: medianUniqueSnapshotIntervalMs([entry, ...exitWindow])
  };

  for (const snapshot of exitWindow) {
    const exitFill = Number(snapshot.priceSol) * (1 - profile.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    peakNetReturn = Math.max(peakNetReturn, netReturn);
    troughNetReturn = Math.min(troughNetReturn, netReturn);
    const closeMeta = () => ({
      ...exitMeta,
      peakNetReturnPct: Number.isFinite(peakNetReturn) ? peakNetReturn * 100 : null,
      troughNetReturnPct: Number.isFinite(troughNetReturn) ? troughNetReturn * 100 : null
    });
    if (netReturn >= profile.takeProfitPct) return closeTrade(decision, entry, snapshot, 'TAKE_PROFIT', profile, netReturn, closeMeta());
    if (netReturn <= -profile.stopLossPct) return closeTrade(decision, entry, snapshot, 'STOP_LOSS', profile, netReturn, closeMeta());
    if (
      Number.isFinite(peakNetReturn)
      && peakNetReturn >= profile.trailingActivationPct
      && peakNetReturn - netReturn >= profile.trailingGivebackPct
    ) {
      return closeTrade(decision, entry, snapshot, 'TRAILING_GIVEBACK', profile, netReturn, closeMeta());
    }
    last = snapshot;
  }

  const exitFill = Number(last.priceSol) * (1 - profile.exitSlippagePct / 100);
  const netReturn = (exitFill / entryFill) - 1;
  peakNetReturn = Math.max(peakNetReturn, netReturn);
  troughNetReturn = Math.min(troughNetReturn, netReturn);
  return closeTrade(decision, entry, last, 'MAX_HOLD', profile, netReturn, {
    ...exitMeta,
    peakNetReturnPct: Number.isFinite(peakNetReturn) ? peakNetReturn * 100 : null,
    troughNetReturnPct: Number.isFinite(troughNetReturn) ? troughNetReturn * 100 : null
  });
}

function simulateDecision(run, decision, profile, profileName) {
  const snapshots = run.snapshotsByMint.get(decision.mint) || [];
  const { entry, reason, context } = entryForDecision(decision, snapshots, profile);
  if (!entry) return closeTrade(decision, null, null, reason, profile, 0, { profileName, entryReason: reason, context });
  return simulateExit(decision, entry, snapshots, profile, { profileName, entryReason: reason, context });
}

function longestLossStreak(trades) {
  let current = 0;
  let longest = 0;
  for (const trade of trades) {
    if (Number(trade.pnlSol) < 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else if (Number(trade.pnlSol) > 0) {
      current = 0;
    }
  }
  return longest;
}

function maxDrawdownSol(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const trade of trades) {
    equity += Number(trade.pnlSol || 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  return num(maxDrawdown, 9);
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function profitFactor(pnlValues) {
  const grossWins = sum(pnlValues.filter((value) => Number(value) > 0));
  const grossLosses = Math.abs(sum(pnlValues.filter((value) => Number(value) < 0)));
  if (grossLosses === 0) return grossWins > 0 ? 999999 : null;
  return num(grossWins / grossLosses, 4);
}

function bootstrapPnlP05(pnlValues, iterations = BOOTSTRAP_ITERATIONS) {
  const values = pnlValues.map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  let seed = 1337 + values.length * 17;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const totals = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(rand() * values.length)];
    }
    totals.push(total);
  }
  return stats(totals, 9).p10 === null ? null : num(totals.sort((a, b) => a - b)[Math.floor(totals.length * 0.05)], 9);
}

function aggregateBy(rows, keyFn) {
  const groups = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return Object.fromEntries(Object.entries(groups)
    .map(([key, group]) => [key, aggregateTrades(group, null, { includeBreakdowns: false })])
    .sort((a, b) => Number(b[1].totalPnlSol || 0) - Number(a[1].totalPnlSol || 0)));
}

function aggregateTrades(trades, totalHours = null, options = {}) {
  const includeBreakdowns = options.includeBreakdowns !== false;
  const entered = trades.filter((trade) => !['BASE_FILTERS', 'NOT_OVERSOLD_ENOUGH', 'NO_RECLAIM', 'NO_LOOKBACK_PRICE_CONTEXT', 'NO_ENTRY_SNAPSHOT'].includes(trade.exitReason));
  const closed = entered.filter((trade) => trade.exitReason !== 'NO_FUTURE_SNAPSHOTS');
  const wins = closed.filter((trade) => Number(trade.pnlSol) > 0);
  const losses = closed.filter((trade) => Number(trade.pnlSol) < 0);
  const pnlValues = closed.map((trade) => Number(trade.pnlSol)).filter(Number.isFinite);
  const totalPnlSol = pnlValues.reduce((total, value) => total + value, 0);
  const winnerPnl = pnlValues.filter((value) => value > 0).sort((a, b) => b - a);
  const grossWinSol = winnerPnl.reduce((total, value) => total + value, 0);
  const grossLossSol = Math.abs(sum(pnlValues.filter((value) => value < 0)));
  const exTop = (count) => num(totalPnlSol - winnerPnl.slice(0, count).reduce((total, value) => total + value, 0), 9);
  return {
    decisions: trades.length,
    entries: entered.length,
    closed: closed.length,
    candidateFunnel: {
      basePass: trades.length,
      entries: entered.length,
      closed: closed.length,
      entryYield: trades.length ? num(entered.length / trades.length, 4) : null
    },
    noEntryReasons: countBy(trades.filter((trade) => !entered.includes(trade)), (trade) => trade.exitReason),
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? num(wins.length / closed.length, 4) : null,
    totalPnlSol: num(totalPnlSol, 9),
    averagePnlSol: closed.length ? num(totalPnlSol / closed.length, 9) : null,
    averageWinSol: wins.length ? num(sum(wins.map((trade) => trade.pnlSol)) / wins.length, 9) : null,
    averageLossSol: losses.length ? num(sum(losses.map((trade) => trade.pnlSol)) / losses.length, 9) : null,
    expectancySol: closed.length ? num(totalPnlSol / closed.length, 9) : null,
    profitFactor: profitFactor(pnlValues),
    grossWinSol: num(grossWinSol, 9),
    grossLossSol: num(grossLossSol, 9),
    pnlStats: stats(pnlValues, 9),
    bootstrapPnlP05Sol: bootstrapPnlP05(pnlValues),
    netReturnPctStats: stats(closed.map((trade) => trade.netReturnPct), 4),
    snapshotDensity: {
      medianSnapshotsPerTrade: stats(closed.map((trade) => trade.snapshotsInHoldWindow), 0).median,
      medianSnapshotIntervalMs: stats(closed.map((trade) => trade.medianSnapshotIntervalMs), 0).median,
      medianUniqueSnapshotIntervalMs: stats(closed.map((trade) => trade.medianUniqueSnapshotIntervalMs), 0).median,
      lowSnapshotTradeCount: closed.filter((trade) => Number(trade.snapshotsInHoldWindow || 0) < 3).length,
      lowSnapshotTradeShare: closed.length ? num(closed.filter((trade) => Number(trade.snapshotsInHoldWindow || 0) < 3).length / closed.length, 4) : null
    },
    mfeMae: {
      peakNetReturnPct: stats(closed.map((trade) => trade.peakNetReturnPct), 4),
      troughNetReturnPct: stats(closed.map((trade) => trade.troughNetReturnPct), 4),
      mfeCaptureRatio: stats(closed.map((trade) => trade.mfeCaptureRatio), 4)
    },
    exitReasonCounts: countBy(closed, (trade) => trade.exitReason),
    sourceReasonCounts: countBy(entered, (trade) => trade.sourceReason),
    sourceReasonBreakdown: includeBreakdowns ? aggregateBy(closed, (trade) => trade.sourceReason) : undefined,
    longestLossStreak: longestLossStreak(closed),
    maxDrawdownSol: maxDrawdownSol(closed),
    pnlAfterRemovingTop1WinnerSol: exTop(1),
    pnlAfterRemovingTop3WinnersSol: exTop(3),
    top1GrossWinShare: grossWinSol > 0 && winnerPnl.length ? num(winnerPnl[0] / grossWinSol, 4) : null,
    medianHoldSeconds: stats(closed.map((trade) => trade.holdSeconds), 2).median,
    tradesPerHour: Number.isFinite(totalHours) && totalHours > 0 ? num(closed.length / totalHours, 4) : null,
    uniqueMints: new Set(entered.map((trade) => trade.mint)).size
  };
}

function graduationStatus(summary, slippageLadder, telemetryRunCount) {
  const at3 = slippageLadder?.['3pct_each_way'] || {};
  const top1GrossWinShare = summary.top1GrossWinShare ?? 1;
  const longestLossStreakValue = summary.longestLossStreak ?? Infinity;
  const lowSnapshotTradeShare = summary.snapshotDensity?.lowSnapshotTradeShare ?? 1;
  const checks = {
    minClosedTradesPerProfile: Number(summary.closed || 0) >= GRADUATION_CRITERIA.minClosedTradesPerProfile,
    minTelemetryRuns: Number(telemetryRunCount || 0) >= GRADUATION_CRITERIA.minTelemetryRuns,
    pnlAfterRemovingTop3WinnersPositive: Number(summary.pnlAfterRemovingTop3WinnersSol || 0) > 0,
    top1GrossWinShareBelowLimit: Number(top1GrossWinShare) < GRADUATION_CRITERIA.maxTop1GrossWinShare,
    profitFactorAt3PctEachWay: Number(at3.profitFactor || 0) >= GRADUATION_CRITERIA.minProfitFactorAt3PctEachWay,
    minWinRate: Number(summary.winRate || 0) >= GRADUATION_CRITERIA.minWinRate,
    longestLossStreakBelowLimit: Number(longestLossStreakValue) <= GRADUATION_CRITERIA.maxLongestLossStreak,
    bootstrapPnlP05Positive: Number(summary.bootstrapPnlP05Sol || 0) > 0,
    lowSnapshotShareBelowLimit: Number(lowSnapshotTradeShare) <= GRADUATION_CRITERIA.maxLowSnapshotTradeShare,
    minTradesPerHour: Number(summary.tradesPerHour || 0) >= GRADUATION_CRITERIA.minTradesPerHour
  };
  return {
    eligibleForProspectiveShadowReview: Object.values(checks).every(Boolean),
    checks
  };
}

function buildReport(runs) {
  const profiles = {};
  const decisions = runs.flatMap((run) => run.decisions.map((decision) => ({ run, decision })));
  const totalHours = runs.reduce((total, run) => {
    if (!Number.isFinite(run.startAtMs) || !Number.isFinite(run.endAtMs) || run.endAtMs <= run.startAtMs) return total;
    return total + ((run.endAtMs - run.startAtMs) / 3600000);
  }, 0);
  for (const [profileName, profile] of Object.entries(PROFILES)) {
    const selectedByMint = new Map();
    for (const { run, decision } of decisions) {
      const key = `${run.telemetryPath}::${decision.mint}`;
      if (selectedByMint.has(key)) continue;
      if (!passesBaseFilters(decision, profile)) continue;
      selectedByMint.set(key, { run, decision });
    }
    const selected = Array.from(selectedByMint.values());
    const trades = selected
      .map(({ run, decision }) => simulateDecision(run, decision, profile, profileName));
    const entered = trades.filter((trade) => trade.entryAt);
    const slippageLadder = {};
    for (const slippagePct of SLIPPAGE_LADDER_PCT) {
      const stressedProfile = { ...profile, entrySlippagePct: slippagePct, exitSlippagePct: slippagePct };
      const stressedTrades = selected
        .map(({ run, decision }) => simulateDecision(run, decision, stressedProfile, profileName));
      slippageLadder[`${String(slippagePct).replace('.', '_')}pct_each_way`] = aggregateTrades(stressedTrades, totalHours, { includeBreakdowns: false });
    }
    const summary = aggregateTrades(trades, totalHours);
    profiles[profileName] = {
      profile,
      summary,
      slippageLadder,
      graduationStatus: graduationStatus(summary, slippageLadder, runs.length),
      topWinners: entered.slice().sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0)).slice(0, 10),
      topLosers: entered.slice().sort((a, b) => Number(a.pnlSol || 0) - Number(b.pnlSol || 0)).slice(0, 10)
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_weak_market_scalp_replay',
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      decisions: decisions.length,
      uniqueRunMints: new Set(decisions.map(({ run, decision }) => `${run.telemetryPath}::${decision.mint}`)).size,
      totalTelemetryHours: num(totalHours, 4),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0)
    },
    graduationCriteria: GRADUATION_CRITERIA,
    ranking: Object.entries(profiles)
      .map(([name, row]) => ({
        name,
        description: row.profile.description,
        ...row.summary,
        slippage3PctEachWay: row.slippageLadder['3pct_each_way'],
        eligibleForProspectiveShadowReview: row.graduationStatus.eligibleForProspectiveShadowReview
      }))
      .sort((a, b) => Number(b.totalPnlSol || -Infinity) - Number(a.totalPnlSol || -Infinity)),
    profiles,
    note: 'Report-only weak-market scalp replay inspired by consistency-first small SOL scalps: oversold attention reclaim and low-size main-runner topblast. Does not alter runtime gates, entries, exits, AI review, quotes, broadcast, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function printReport(report) {
  console.log('Weak-Market Scalp Replay');
  console.log(`Telemetry files read: ${report.inputs.telemetryFilesRead}`);
  for (const row of report.ranking) {
    const stress3 = row.slippage3PctEachWay || {};
    console.log(`${row.name}: entries=${row.entries}/${row.decisions}, wins/losses=${row.wins}/${row.losses}, winRate=${row.winRate ?? 'n/a'}, pnl=${row.totalPnlSol} SOL, pf=${row.profitFactor ?? 'n/a'}, bootP05=${row.bootstrapPnlP05Sol ?? 'n/a'}, stress3Pnl=${stress3.totalPnlSol ?? 'n/a'}, tradesHr=${row.tradesPerHour ?? 'n/a'}, exTop3=${row.pnlAfterRemovingTop3WinnersSol ?? 'n/a'}, eligible=${row.eligibleForProspectiveShadowReview}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((item) => repoPath(item.trim())).filter(Boolean)
    : telemetryFiles(Number(args.limit || 5));
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const existing = files.filter((filePath) => fs.existsSync(filePath));
  if (!existing.length) throw new Error('No telemetry files found.');
  const runs = [];
  for (const filePath of existing) runs.push(await readTelemetry(filePath));
  const report = buildReport(runs);
  writeJson(outputPath, report);
  printReport(report);
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  PROFILES,
  buildReport,
  OUTPUT_PATH
};
