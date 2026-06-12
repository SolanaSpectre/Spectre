#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-advance-diagnostic-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];
const TARGET_REASON = 'CURVE_NOT_ADVANCING';
const DEFAULT_SIZE_SOL = 0.05;
const DEFAULT_FEE_SOL = 0.0005;
const PARITY_NEAR_DECISION_WINDOW_MS = 5000;
const REPLAY_PROFILES = [
  { name: 'curve_120s_tp50_sl25_slip3', holdSeconds: 120, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 3, exitSlippagePct: 3 },
  { name: 'curve_300s_tp50_sl25_slip3', holdSeconds: 300, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 3, exitSlippagePct: 3 },
  { name: 'curve_120s_tp35_sl20_slip5', holdSeconds: 120, takeProfitPct: 35, stopLossPct: -20, entrySlippagePct: 5, exitSlippagePct: 5 },
  { name: 'curve_300s_tp35_sl20_slip5', holdSeconds: 300, takeProfitPct: 35, stopLossPct: -20, entrySlippagePct: 5, exitSlippagePct: 5 }
];

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

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
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
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function pctDelta(start, end, digits = 2) {
  if (start === null || start === undefined || end === null || end === undefined) return null;
  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber) || startNumber <= 0) return null;
  return num(((endNumber - startNumber) / startNumber) * 100, digits);
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: num(finite[0], digits),
    median: num(pick(0.5), digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    avg: num(sum / finite.length, digits)
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

function isPositiveOrProvenWallet(wallet = {}) {
  return ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(wallet.evidenceTier)
    || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(wallet.reviewTier);
}

function isAvoidWallet(wallet = {}) {
  return wallet.evidenceTier === 'NEGATIVE_EVIDENCE' || wallet.reviewTier === 'AVOID_REVIEW';
}

function walletContextSummary(context = {}) {
  const wallets = Array.isArray(context.wallets) ? context.wallets : [];
  const buys = wallets.filter((wallet) => String(wallet.side || '').toLowerCase() === 'buy');
  const positiveWalletTouchCount = wallets.filter(isPositiveOrProvenWallet).length;
  const avoidWalletTouchCount = wallets.filter(isAvoidWallet).length;
  let walletBucket = 'no_wallet_touch';
  if (avoidWalletTouchCount > 0) walletBucket = 'avoid_or_negative_wallet_touch';
  else if (positiveWalletTouchCount > 0) walletBucket = 'positive_or_proven_wallet_touch';
  else if (wallets.length > 0) walletBucket = 'unknown_wallet_touch';
  return {
    walletContext: {
      touched: wallets.length > 0,
      walletTouchCount: wallets.length,
      walletBuyTouchCount: buys.length,
      positiveWalletTouchCount,
      avoidWalletTouchCount,
      contextSource: context.contextSource || null,
      earliestTouchAt: context.earliestTouchAt || null,
      earliestBuyAt: context.earliestBuyAt || null,
      firstTouchName: wallets[0]?.name || wallets[0]?.wallet || null,
      firstBuyName: buys[0]?.name || buys[0]?.wallet || null,
      bucket: walletBucket
    }
  };
}

function targetedParityFromEvent(event) {
  if (eventType(event) !== 'pumpdev.targeted_curve_parity_sample') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.onchainFetchedAt || payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const providerCurveProgress = num(payload.providerCurveProgress, 6);
  const onchainCurveProgress = num(payload.onchainCurveProgress, 6);
  const curveDelta = Number.isFinite(Number(providerCurveProgress)) && Number.isFinite(Number(onchainCurveProgress))
    ? Number(onchainCurveProgress) - Number(providerCurveProgress)
    : null;
  const absCurveDelta = Number.isFinite(Number(curveDelta)) ? Math.abs(Number(curveDelta)) : null;
  return {
    mint,
    at: new Date(atMs).toISOString(),
    atMs,
    targetAt: payload.targetAt || payload.timestamp || null,
    targetClasses: Array.isArray(payload.targetClasses) ? payload.targetClasses : [],
    reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
    providerCurveProgress,
    onchainCurveProgress,
    onchainCurveProgressByVirtualTokenReserves: num(payload.onchainCurveProgressByVirtualTokenReserves, 6),
    curveDelta: num(curveDelta, 6),
    absCurveDelta: num(absCurveDelta, 6),
    providerToOnchainAgeMs: num(payload.providerToOnchainAgeMs, 0),
    accountFound: payload.accountFound === true,
    fetchError: payload.fetchError || payload.error || null,
    semanticDiagnosis: payload.semanticDiagnosis || null,
    bondingCurveValidated: payload.bondingCurveValidated === true,
    onchainFresh: payload.onchainFresh === true
  };
}

function nearestParitySample(decision, samples) {
  if (!samples?.length) return null;
  let best = null;
  for (const sample of samples) {
    const ageMs = Math.abs(Number(sample.atMs) - Number(decision.atMs));
    if (!Number.isFinite(ageMs) || ageMs > PARITY_NEAR_DECISION_WINDOW_MS) continue;
    if (!best || ageMs < best.nearDecisionAgeMs) {
      best = { ...sample, nearDecisionAgeMs: num(ageMs, 0) };
    }
  }
  return best;
}

function curveEvidenceVerdict(row) {
  const w120 = row.windows?.['120s'] || {};
  const w300 = row.windows?.['300s'] || {};
  const hasFuture = Object.values(row.windows || {}).some((window) => Number(window.futureSnapshotCount) > 0);
  const parity = row.nearestTargetedParity;
  const absParityDelta = Number(parity?.absCurveDelta);

  if (!hasFuture) return 'INSUFFICIENT_PROVIDER_FOLLOW_THROUGH_DATA';
  if (parity?.fetchError) return 'ONCHAIN_PARITY_FETCH_ERROR';
  if (Number.isFinite(absParityDelta) && absParityDelta > 0.05) return 'PROVIDER_ONCHAIN_DIVERGENCE_GT_5PTS';
  if (w120.crossed90AfterSkip || w120.crossed85AfterSkip) return 'GATE_BLOCKED_HIGH_CURVE_FOLLOW_THROUGH_120S';
  if (Number(w120.curveDelta) >= 0.1) return 'LATER_CURVE_ACCELERATION_120S_GT_10PTS';
  if (Number(w120.curveDelta) >= 0.05) return 'LATER_CURVE_ADVANCE_120S_GT_5PTS';
  if (w300.crossed90AfterSkip || w300.crossed85AfterSkip || Number(w300.curveDelta) >= 0.1) return 'DELAYED_CURVE_ADVANCE_300S';
  if (Number(w120.curveDelta) <= 0.005) return 'TRUE_STALL_OR_NO_USEFUL_ADVANCE_120S';
  return 'MINOR_FOLLOW_THROUGH_BELOW_ACTIONABLE_BAND';
}

function nestedCount(rows, outerFn, innerFn) {
  const result = {};
  for (const row of rows) {
    const outer = outerFn(row) || 'unknown';
    const inner = innerFn(row) || 'unknown';
    if (!result[outer]) result[outer] = {};
    result[outer][inner] = (result[outer][inner] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((a, b) => {
    const sumA = Object.values(a[1]).reduce((sum, value) => sum + value, 0);
    const sumB = Object.values(b[1]).reduce((sum, value) => sum + value, 0);
    return sumB - sumA;
  }));
}

function summarizeReplayRows(rows) {
  const pnl = rows.map((row) => Number(row.pnlSol)).filter(Number.isFinite);
  const winners = pnl.filter((value) => value > 0).sort((a, b) => b - a);
  const totalPnlSol = pnl.reduce((sum, value) => sum + value, 0);
  const grossWinnerPnlSol = winners.reduce((sum, value) => sum + value, 0);
  const topWinnerPnlSol = winners[0] || 0;
  const top3WinnerPnlSol = winners.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const wins = rows.filter((row) => Number(row.pnlSol) > 0).length;
  const losses = rows.filter((row) => Number(row.pnlSol) < 0).length;
  return {
    trades: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    wins,
    losses,
    winRate: wins + losses > 0 ? num(wins / (wins + losses), 4) : null,
    totalPnlSol: num(totalPnlSol, 9),
    pnlAfterRemovingTopWinnerSol: num(totalPnlSol - topWinnerPnlSol, 9),
    pnlAfterRemovingTop3WinnersSol: num(totalPnlSol - top3WinnerPnlSol, 9),
    topWinnerShareOfGrossProfit: grossWinnerPnlSol > 0 ? num(topWinnerPnlSol / grossWinnerPnlSol, 4) : null,
    pnlSol: stat(pnl, 9),
    returnPct: stat(rows.map((row) => row.returnPct), 4),
    rawReturnPct: stat(rows.map((row) => row.rawReturnPct), 4),
    exitReasons: countBy(rows, (row) => row.exitReason)
  };
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    at: new Date(atMs).toISOString(),
    atMs,
    eventType: eventType(event),
    source: payload.providerCurveSource || payload.source || payload.provider || eventType(event),
    curveProgress: num(curveProgress, 6),
    priceSol: num(priceOf(payload), 12)
  };
}

function decisionFromEvent(event) {
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED' || payload.reason !== TARGET_REASON) return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const curveProgress = curveOf(payload);
  const baselineAtMs = timestampMs(payload.baselineAt);
  const curveProgressDelta = num(payload.curveProgressDelta, 6);
  const threshold = num(payload.threshold, 6);
  const deltaGap = Number.isFinite(Number(threshold)) && Number.isFinite(Number(curveProgressDelta))
    ? Number(threshold) - Number(curveProgressDelta)
    : null;
  const baselineCurveProgress = num(payload.baselineCurveProgress, 6);
  const baselineToNow = Number.isFinite(Number(curveProgress)) && Number.isFinite(Number(baselineCurveProgress))
    ? Number(curveProgress) - Number(baselineCurveProgress)
    : null;

  return {
    mint,
    symbol: payload.symbol || null,
    at: new Date(atMs).toISOString(),
    atMs,
    baselineAt: payload.baselineAt || null,
    baselineAgeMs: Number.isFinite(baselineAtMs) ? atMs - baselineAtMs : null,
    baselineCurveProgress,
    curveProgress: num(curveProgress, 6),
    curveProgressDelta,
    curveProgressDelta60s: num(payload.curveProgressDelta60s, 6),
    threshold,
    deltaGap: num(deltaGap, 6),
    baselineToNowDelta: num(baselineToNow, 6),
    priceSol: num(priceOf(payload), 12),
    readinessPct: Number.isFinite(Number(curveProgressDelta)) && Number.isFinite(Number(threshold)) && Number(threshold) > 0
      ? num(Math.max(0, Math.min(1, Number(curveProgressDelta) / Number(threshold))) * 100, 2)
      : null,
    score: num(payload.score, 2),
    preset: payload.preset || null,
    profileName: payload.profileName || null,
    recentVolumeSol: num(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: num(payload.tradeVelocityPerMin, 2),
    buyRatio: num(payload.buyRatio, 4),
    uniqueBuyerCount: num(payload.uniqueBuyerCount, 0),
    sniperWalletCount: num(payload.sniperWalletCount, 0),
    guardOverride: payload.guardOverride || null,
    failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : [],
    ...walletContextSummary(payload.walletClassificationContext || {})
  };
}

async function readTelemetry(filePath) {
  const decisions = [];
  const snapshotsByMint = new Map();
  const targetedParityByMint = new Map();
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
    const type = eventType(event);
    eventCounts[type] = (eventCounts[type] || 0) + 1;
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
    const parity = targetedParityFromEvent(event);
    if (parity) {
      const rows = targetedParityByMint.get(parity.mint) || [];
      rows.push(parity);
      targetedParityByMint.set(parity.mint, rows);
    }
    const decision = decisionFromEvent(event);
    if (decision) decisions.push(decision);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  for (const rows of targetedParityByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  return {
    decisions,
    snapshotsByMint,
    targetedParityByMint,
    eventCounts,
    malformedLines,
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null
  };
}

function firstCross(rows, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return rows.find((row) => Number(row.curveProgress) >= threshold) || null;
}

function windowAnalysis(decision, snapshots, seconds) {
  const future = snapshots.filter((row) => row.atMs > decision.atMs && row.atMs <= decision.atMs + seconds * 1000);
  const maxCurve = stat(future.map((row) => row.curveProgress), 6).max;
  const maxPrice = stat(future.map((row) => row.priceSol), 12).max;
  const minPrice = stat(future.map((row) => row.priceSol), 12).min;
  const curveDelta = maxCurve !== null && decision.curveProgress !== null
    ? Number(maxCurve) - Number(decision.curveProgress)
    : null;
  const cross85 = firstCross(future, 0.85, decision.curveProgress);
  const cross90 = firstCross(future, 0.9, decision.curveProgress);
  const cross95 = firstCross(future, 0.95, decision.curveProgress);
  const cross100 = firstCross(future, 1, decision.curveProgress);
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: maxCurve,
    curveDelta: num(curveDelta, 6),
    maxPriceSol: maxPrice,
    maxPriceDeltaPct: pctDelta(decision.priceSol, maxPrice, 2),
    minPriceDeltaPct: pctDelta(decision.priceSol, minPrice, 2),
    crossed85AfterSkip: Boolean(cross85),
    crossed90AfterSkip: Boolean(cross90),
    crossed95AfterSkip: Boolean(cross95),
    crossed100AfterSkip: Boolean(cross100),
    first85CrossAt: cross85?.at || null,
    first90CrossAt: cross90?.at || null,
    first95CrossAt: cross95?.at || null,
    first100CrossAt: cross100?.at || null
  };
}

function classify(decision) {
  const w120 = decision.windows['120s'] || {};
  const w300 = decision.windows['300s'] || {};
  if (!Object.values(decision.windows).some((row) => Number(row.futureSnapshotCount) > 0)) return 'NO_FUTURE_SNAPSHOTS';
  if (w120.crossed90AfterSkip || Number(w120.curveDelta) >= 0.1) return 'BLOCKED_STRONG_FOLLOW_THROUGH_120S';
  if (w120.crossed85AfterSkip || Number(w120.curveDelta) >= 0.05) return 'BLOCKED_USEFUL_FOLLOW_THROUGH_120S';
  if (w300.crossed90AfterSkip || Number(w300.curveDelta) >= 0.1) return 'DELAYED_STRONG_FOLLOW_THROUGH_300S';
  if (w300.crossed85AfterSkip || Number(w300.curveDelta) >= 0.05) return 'DELAYED_USEFUL_FOLLOW_THROUGH_300S';
  if (Number(w120.curveDelta) <= 0.005) return 'CORRECTLY_BLOCKED_FLAT_120S';
  return 'MODEST_FOLLOW_THROUGH';
}

function analyzeDecision(decision, snapshots, targetedParitySamples) {
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = windowAnalysis(decision, snapshots, seconds);
  }
  const analyzed = {
    ...decision,
    windows,
    nearestTargetedParity: nearestParitySample(decision, targetedParitySamples)
  };
  analyzed.classification = classify(analyzed);
  analyzed.curveEvidenceVerdict = curveEvidenceVerdict(analyzed);
  return analyzed;
}

function replayDecision(decision, snapshotsByMint, profile, sizeSol = DEFAULT_SIZE_SOL, feeSol = DEFAULT_FEE_SOL) {
  const entryPrice = Number(decision.priceSol);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const snapshots = (snapshotsByMint.get(decision.mint) || [])
    .filter((row) => row.atMs > decision.atMs && row.atMs <= decision.atMs + profile.holdSeconds * 1000)
    .filter((row) => Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!snapshots.length) return null;

  const effectiveEntryPrice = entryPrice * (1 + Number(profile.entrySlippagePct || 0) / 100);
  let exit = snapshots[snapshots.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const snapshot of snapshots) {
    const effectiveExitPrice = Number(snapshot.priceSol) * (1 - Number(profile.exitSlippagePct || 0) / 100);
    const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
    if (returnPct <= profile.stopLossPct) {
      exit = snapshot;
      exitReason = 'STOP_LOSS';
      break;
    }
    if (returnPct >= profile.takeProfitPct) {
      exit = snapshot;
      exitReason = 'TAKE_PROFIT';
      break;
    }
  }

  const exitPrice = Number(exit.priceSol);
  const effectiveExitPrice = exitPrice * (1 - Number(profile.exitSlippagePct || 0) / 100);
  const rawReturnPct = ((exitPrice / entryPrice) - 1) * 100;
  const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
  return {
    profile: profile.name,
    mint: decision.mint,
    symbol: decision.symbol,
    at: decision.at,
    classification: decision.classification,
    readinessPct: decision.readinessPct,
    score: decision.score,
    entryCurveProgress: decision.curveProgress,
    exitCurveProgress: num(exit.curveProgress, 6),
    holdSeconds: num((exit.atMs - decision.atMs) / 1000, 3),
    rawReturnPct: num(rawReturnPct, 4),
    returnPct: num(returnPct, 4),
    pnlSol: num(sizeSol * (returnPct / 100) - feeSol, 9),
    exitReason
  };
}

function uniqueRows(rows) {
  const picked = new Map();
  for (const row of rows) {
    const current = picked.get(row.mint);
    const currentDelta = Number(current?.windows?.['120s']?.curveDelta ?? -Infinity);
    const nextDelta = Number(row.windows?.['120s']?.curveDelta ?? -Infinity);
    if (!current || nextDelta > currentDelta) picked.set(row.mint, row);
  }
  return Array.from(picked.values());
}

function replayRowsByProfile(rows, snapshotsByMint) {
  return Object.fromEntries(REPLAY_PROFILES.map((profile) => {
    const replayRows = rows
      .map((row) => replayDecision(row, snapshotsByMint, profile))
      .filter(Boolean);
    return [profile.name, summarizeReplayRows(replayRows)];
  }));
}

function compactDecision(row) {
  return {
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    classification: row.classification,
    score: row.score,
    curveProgress: row.curveProgress,
    baselineCurveProgress: row.baselineCurveProgress,
    curveProgressDelta: row.curveProgressDelta,
    curveProgressDelta60s: row.curveProgressDelta60s,
    threshold: row.threshold,
    deltaGap: row.deltaGap,
    readinessPct: row.readinessPct,
    baselineAgeMs: row.baselineAgeMs,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    walletContext: row.walletContext,
    curveEvidenceVerdict: row.curveEvidenceVerdict,
    nearestTargetedParity: row.nearestTargetedParity,
    window120s: row.windows['120s'],
    window300s: row.windows['300s']
  };
}

function uniqueBest(rows, scoreFn, limit) {
  const picked = new Map();
  for (const row of rows) {
    const current = picked.get(row.mint);
    if (!current || scoreFn(row) > scoreFn(current)) picked.set(row.mint, row);
  }
  return Array.from(picked.values())
    .sort((a, b) => scoreFn(b) - scoreFn(a))
    .slice(0, limit)
    .map(compactDecision);
}

function buildReport(filePath, telemetry) {
  const analyzed = telemetry.decisions.map((decision) => (
    analyzeDecision(
      decision,
      telemetry.snapshotsByMint.get(decision.mint) || [],
      telemetry.targetedParityByMint.get(decision.mint) || []
    )
  ));
  const uniqueMints = new Set(analyzed.map((row) => row.mint));
  const w120 = analyzed.map((row) => row.windows['120s'] || {});
  const w300 = analyzed.map((row) => row.windows['300s'] || {});
  const likelyFalseNegatives = analyzed.filter((row) => (
    row.classification === 'BLOCKED_STRONG_FOLLOW_THROUGH_120S'
    || row.classification === 'BLOCKED_USEFUL_FOLLOW_THROUGH_120S'
  ));
  const correctlyBlocked = analyzed.filter((row) => row.classification === 'CORRECTLY_BLOCKED_FLAT_120S');
  const nearThreshold = analyzed.filter((row) => Number(row.readinessPct) >= 80);
  const likelyFalseNegativeUnique = uniqueRows(likelyFalseNegatives);
  const nearThresholdUnique = uniqueRows(nearThreshold);
  const rowsWithWalletTouch = analyzed.filter((row) => row.walletContext?.touched);
  const rowsWithPositiveWalletTouch = analyzed.filter((row) => Number(row.walletContext?.positiveWalletTouchCount) > 0);
  const rowsWithTargetedParity = analyzed.filter((row) => row.nearestTargetedParity);
  const actionableDataConcern = analyzed.filter((row) => [
    'PROVIDER_ONCHAIN_DIVERGENCE_GT_5PTS',
    'GATE_BLOCKED_HIGH_CURVE_FOLLOW_THROUGH_120S',
    'LATER_CURVE_ACCELERATION_120S_GT_10PTS',
    'LATER_CURVE_ADVANCE_120S_GT_5PTS'
  ].includes(row.curveEvidenceVerdict));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath: path.relative(ROOT, filePath),
    telemetryWindow: {
      startAt: telemetry.startMs ? new Date(telemetry.startMs).toISOString() : null,
      endAt: telemetry.endMs ? new Date(telemetry.endMs).toISOString() : null
    },
    summary: {
      reason: TARGET_REASON,
      decisions: analyzed.length,
      uniqueMints: uniqueMints.size,
      nearThresholdDecisions80Pct: nearThreshold.length,
      likelyFalseNegativeDecisions120s: likelyFalseNegatives.length,
      correctlyBlockedFlat120s: correctlyBlocked.length,
      crossed85Within120s: w120.filter((row) => row.crossed85AfterSkip).length,
      crossed90Within120s: w120.filter((row) => row.crossed90AfterSkip).length,
      crossed85Within300s: w300.filter((row) => row.crossed85AfterSkip).length,
      crossed90Within300s: w300.filter((row) => row.crossed90AfterSkip).length,
      classificationCounts: countBy(analyzed, (row) => row.classification),
      curveEvidenceVerdictCounts: countBy(analyzed, (row) => row.curveEvidenceVerdict),
      curveEvidenceVerdictByWalletBucket: nestedCount(
        analyzed,
        (row) => row.curveEvidenceVerdict,
        (row) => row.walletContext?.bucket
      ),
      walletBucketCounts: countBy(analyzed, (row) => row.walletContext?.bucket),
      walletContext: {
        touched: rowsWithWalletTouch.length,
        positiveOrProven: rowsWithPositiveWalletTouch.length,
        avoidOrNegative: analyzed.filter((row) => Number(row.walletContext?.avoidWalletTouchCount) > 0).length
      },
      targetedParityNearDecision: {
        decisionsWithSample: rowsWithTargetedParity.length,
        absCurveDelta: stat(rowsWithTargetedParity.map((row) => row.nearestTargetedParity?.absCurveDelta), 6),
        semanticDiagnosisCounts: countBy(rowsWithTargetedParity, (row) => row.nearestTargetedParity?.semanticDiagnosis),
        fetchErrors: rowsWithTargetedParity.filter((row) => row.nearestTargetedParity?.fetchError).length
      },
      readinessPct: stat(analyzed.map((row) => row.readinessPct), 2),
      curveProgressDelta: stat(analyzed.map((row) => row.curveProgressDelta), 6),
      curveProgressDelta60s: stat(analyzed.map((row) => row.curveProgressDelta60s), 6),
      deltaGap: stat(analyzed.map((row) => row.deltaGap), 6),
      baselineAgeMs: stat(analyzed.map((row) => row.baselineAgeMs), 0),
      curveDelta120s: stat(w120.map((row) => row.curveDelta), 6),
      curveDelta300s: stat(w300.map((row) => row.curveDelta), 6),
      maxPriceDeltaPct120s: stat(w120.map((row) => row.maxPriceDeltaPct), 2)
    },
    replay: {
      assumptions: {
        sizeSol: DEFAULT_SIZE_SOL,
        feeSol: DEFAULT_FEE_SOL,
        profiles: REPLAY_PROFILES,
        caveat: 'Report-only observed-path replay over provider price snapshots. It does not model quote availability, MEV, exact liquidity, latency, or transaction landing.'
      },
      likelyFalseNegativeUniqueByProfile: replayRowsByProfile(likelyFalseNegativeUnique, telemetry.snapshotsByMint),
      nearThresholdUniqueByProfile: replayRowsByProfile(nearThresholdUnique, telemetry.snapshotsByMint)
    },
    topLikelyFalseNegatives: uniqueBest(likelyFalseNegatives, (row) => Number(row.windows['120s']?.curveDelta ?? -Infinity), 12),
    topActionableDataConcerns: uniqueBest(actionableDataConcern, (row) => {
      const parityDelta = Number(row.nearestTargetedParity?.absCurveDelta || 0);
      const curveDelta = Number(row.windows?.['120s']?.curveDelta || 0);
      return Math.max(parityDelta, curveDelta);
    }, 12),
    closestThresholdMisses: uniqueBest(nearThreshold, (row) => Number(row.readinessPct ?? -Infinity), 12),
    topDelayedWakeups: uniqueBest(analyzed, (row) => Number(row.windows['300s']?.curveDelta ?? -Infinity), 12),
    topCorrectlyBlockedFlat: uniqueBest(correctlyBlocked, (row) => Number(row.score ?? -Infinity), 12),
    sourceCoverage: {
      eventCounts: telemetry.eventCounts,
      malformedLines: telemetry.malformedLines,
      mintsWithCurveSnapshots: telemetry.snapshotsByMint.size,
      mintsWithTargetedParitySamples: telemetry.targetedParityByMint.size
    },
    note: 'Report-only CURVE_NOT_ADVANCING diagnostic. It compares decision-time baseline/delta fields to later curve and price snapshots. It does not alter gates, thresholds, entries, exits, AI review, quotes, broadcasts, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for curve advance diagnostic.');
  }
  const telemetry = await readTelemetry(telemetryPath);
  const report = buildReport(telemetryPath, telemetry);
  writeJson(outputPath, report);
  console.log('Pre-Migration Curve Advance Diagnostic');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Decisions / unique mints: ${report.summary.decisions} / ${report.summary.uniqueMints}`);
  console.log(`Likely false negatives 120s: ${report.summary.likelyFalseNegativeDecisions120s}`);
  console.log(`Classification counts: ${JSON.stringify(report.summary.classificationCounts)}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  analyzeDecision,
  buildReport,
  compactDecision,
  latestTelemetryFile,
  num,
  readTelemetry,
  repoPath,
  stat
};
