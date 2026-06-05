#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-false-negative-replay-latest.json');
const TARGET_REASON = 'CURVE_NOT_ADVANCING';
const DEFAULT_MAX_FILES = 1;

const BASE_TRADE = {
  amountSol: 0.02,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5,
  takeProfitPct: 0.35,
  stopLossPct: 0.15,
  maxHoldSeconds: 240
};

const PROFILES = {
  false_negative_immediate_shadow: {
    description: 'Enter at the original CURVE_NOT_ADVANCING skip only if the row later shows useful/strong 120s follow-through.',
    entryMode: 'skip',
    candidateClass: 'useful_or_strong_120s',
    ...BASE_TRADE
  },
  false_negative_delta05_120: {
    description: 'Enter after +5 curve points within 120s, restricted to useful/strong 120s follow-through rows.',
    entryMode: 'confirm',
    candidateClass: 'useful_or_strong_120s',
    lookaheadSeconds: 120,
    minCurveDelta: 0.05,
    minConfirmCurve: 0,
    ...BASE_TRADE
  },
  false_negative_delta10_120: {
    description: 'Enter after +10 curve points within 120s, restricted to useful/strong 120s follow-through rows.',
    entryMode: 'confirm',
    candidateClass: 'useful_or_strong_120s',
    lookaheadSeconds: 120,
    minCurveDelta: 0.1,
    minConfirmCurve: 0,
    ...BASE_TRADE,
    takeProfitPct: 0.5
  },
  false_negative_cross75_120: {
    description: 'Enter on first 75% curve cross within 120s, restricted to useful/strong 120s follow-through rows.',
    entryMode: 'confirm',
    candidateClass: 'useful_or_strong_120s',
    lookaheadSeconds: 120,
    minCurveDelta: 0,
    minConfirmCurve: 0.75,
    ...BASE_TRADE
  },
  false_negative_cross85_300: {
    description: 'Enter on first 85% curve cross within 300s, restricted to useful/strong 120s follow-through rows.',
    entryMode: 'confirm',
    candidateClass: 'useful_or_strong_120s',
    lookaheadSeconds: 300,
    minCurveDelta: 0,
    minConfirmCurve: 0.85,
    ...BASE_TRADE,
    maxHoldSeconds: 180
  },
  near_threshold_delta05_120: {
    description: 'Enter after +5 curve points within 120s for near-threshold curve-delta misses only.',
    entryMode: 'confirm',
    candidateClass: 'near_threshold_80pct',
    lookaheadSeconds: 120,
    minCurveDelta: 0.05,
    minConfirmCurve: 0,
    ...BASE_TRADE
  }
};

const SLICE_DEFINITIONS = [
  { name: 'score_ge_50', description: 'score >= 50', predicate: (trade) => Number(trade.score) >= 50 },
  { name: 'score_ge_60', description: 'score >= 60', predicate: (trade) => Number(trade.score) >= 60 },
  { name: 'score_ge_75', description: 'score >= 75', predicate: (trade) => Number(trade.score) >= 75 },
  { name: 'curve_ge_30', description: 'skip curve >= 30%', predicate: (trade) => Number(trade.skipCurveProgress) >= 0.3 },
  { name: 'curve_ge_50', description: 'skip curve >= 50%', predicate: (trade) => Number(trade.skipCurveProgress) >= 0.5 },
  { name: 'curve_ge_70', description: 'skip curve >= 70%', predicate: (trade) => Number(trade.skipCurveProgress) >= 0.7 },
  { name: 'score_ge_50_curve_ge_30', description: 'score >= 50 and skip curve >= 30%', predicate: (trade) => Number(trade.score) >= 50 && Number(trade.skipCurveProgress) >= 0.3 },
  { name: 'score_ge_60_curve_ge_50', description: 'score >= 60 and skip curve >= 50%', predicate: (trade) => Number(trade.score) >= 60 && Number(trade.skipCurveProgress) >= 0.5 },
  { name: 'score_ge_75_curve_ge_70', description: 'score >= 75 and skip curve >= 70%', predicate: (trade) => Number(trade.score) >= 75 && Number(trade.skipCurveProgress) >= 0.7 },
  { name: 'volume_ge_12', description: 'recent volume >= 12 SOL', predicate: (trade) => Number(trade.recentVolumeSol) >= 12 },
  { name: 'volume_ge_50', description: 'recent volume >= 50 SOL', predicate: (trade) => Number(trade.recentVolumeSol) >= 50 },
  { name: 'velocity_ge_12', description: 'trade velocity >= 12/min', predicate: (trade) => Number(trade.tradeVelocityPerMin) >= 12 },
  { name: 'velocity_ge_50', description: 'trade velocity >= 50/min', predicate: (trade) => Number(trade.tradeVelocityPerMin) >= 50 },
  { name: 'buy_ratio_ge_55', description: 'buy ratio >= 55%', predicate: (trade) => Number(trade.buyRatio) >= 0.55 },
  { name: 'buy_ratio_ge_65', description: 'buy ratio >= 65%', predicate: (trade) => Number(trade.buyRatio) >= 0.65 },
  { name: 'buyers_ge_3', description: 'unique buyers >= 3', predicate: (trade) => Number(trade.uniqueBuyerCount) >= 3 },
  { name: 'buyers_ge_5', description: 'unique buyers >= 5', predicate: (trade) => Number(trade.uniqueBuyerCount) >= 5 },
  { name: 'no_avoid_wallet_touch', description: 'no avoid/negative wallet touch in decision context', predicate: (trade) => Number(trade.avoidWalletTouchCount || 0) === 0 },
  { name: 'positive_wallet_touch', description: 'positive/proven wallet touch in decision context', predicate: (trade) => Number(trade.positiveWalletTouchCount || 0) > 0 },
  { name: 'any_wallet_touch', description: 'any wallet touch in decision context', predicate: (trade) => Number(trade.walletTouchCount || 0) > 0 },
  { name: 'score_ge_50_no_avoid', description: 'score >= 50 and no avoid/negative wallet touch', predicate: (trade) => Number(trade.score) >= 50 && Number(trade.avoidWalletTouchCount || 0) === 0 },
  { name: 'score_ge_75_no_avoid', description: 'score >= 75 and no avoid/negative wallet touch', predicate: (trade) => Number(trade.score) >= 75 && Number(trade.avoidWalletTouchCount || 0) === 0 }
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

function telemetryFiles(maxFiles = DEFAULT_MAX_FILES) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((item) => item.filePath)
    .reverse();
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

function numberOrNull(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
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
    eventType: eventType(event),
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceSol, 15)
  };
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
  return {
    walletTouchCount: wallets.length,
    walletBuyTouchCount: buys.length,
    positiveWalletTouchCount: wallets.filter(isPositiveOrProvenWallet).length,
    avoidWalletTouchCount: wallets.filter(isAvoidWallet).length,
    firstTouchName: wallets[0]?.name || wallets[0]?.wallet || null,
    firstBuyName: buys[0]?.name || buys[0]?.wallet || null
  };
}

function decisionFromEvent(event, telemetryPath) {
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED' || payload.reason !== TARGET_REASON) return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress) || !Number.isFinite(priceSol)) return null;
  const curveProgressDelta = numberOrNull(payload.curveProgressDelta, 6);
  const threshold = numberOrNull(payload.threshold, 6);
  const walletContext = walletContextSummary(payload.walletClassificationContext || {});
  return {
    telemetryPath,
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    reason: payload.reason,
    preset: payload.preset || null,
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceSol, 15),
    curveProgressDelta,
    curveProgressDelta60s: numberOrNull(payload.curveProgressDelta60s, 6),
    threshold,
    readinessPct: Number.isFinite(Number(curveProgressDelta)) && Number.isFinite(Number(threshold)) && Number(threshold) > 0
      ? numberOrNull(Math.max(0, Math.min(1, Number(curveProgressDelta) / Number(threshold))) * 100, 2)
      : null,
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    sniperWalletCount: numberOrNull(payload.sniperWalletCount, 0),
    ...walletContext
  };
}

async function readTelemetry(filePath) {
  const telemetryPath = path.relative(ROOT, filePath);
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
    const decision = decisionFromEvent(event, telemetryPath);
    if (decision) decisions.push(decision);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  decisions.sort((a, b) => a.atMs - b.atMs);
  return { telemetryPath, snapshotsByMint, decisions, malformedLines };
}

function windowAnalysis(decision, snapshots, seconds) {
  const future = snapshots.filter((snapshot) => snapshot.atMs > decision.atMs && snapshot.atMs <= decision.atMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const curveDelta = maxCurve !== null ? maxCurve - Number(decision.curveProgress) : null;
  const crossed85 = future.some((snapshot) => Number(snapshot.curveProgress) >= 0.85);
  const crossed90 = future.some((snapshot) => Number(snapshot.curveProgress) >= 0.9);
  return {
    futureSnapshotCount: future.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    curveDelta: numberOrNull(curveDelta, 6),
    crossed85AfterSkip: crossed85,
    crossed90AfterSkip: crossed90
  };
}

function classifyCandidate(decision, snapshots) {
  const w120 = windowAnalysis(decision, snapshots, 120);
  if (w120.crossed90AfterSkip || Number(w120.curveDelta) >= 0.1) return 'strong_120s';
  if (w120.crossed85AfterSkip || Number(w120.curveDelta) >= 0.05) return 'useful_120s';
  if (Number(decision.readinessPct) >= 80) return 'near_threshold_80pct';
  return 'not_selected';
}

function candidateMatches(decision, profile) {
  if (profile.candidateClass === 'useful_or_strong_120s') {
    return decision.candidateClass === 'strong_120s' || decision.candidateClass === 'useful_120s';
  }
  return decision.candidateClass === profile.candidateClass;
}

function firstDecisionPerRunMint(run) {
  const selected = new Map();
  for (const decision of run.decisions) {
    const key = `${run.telemetryPath}::${decision.mint}`;
    if (!selected.has(key)) selected.set(key, decision);
  }
  return Array.from(selected.values());
}

function findConfirmation(decision, snapshots, profile) {
  if (profile.entryMode === 'skip') {
    return {
      mint: decision.mint,
      atMs: decision.atMs,
      at: decision.at,
      curveProgress: decision.curveProgress,
      priceSol: decision.priceSol,
      eventType: 'pre_migration_paper.decision'
    };
  }
  const deadlineMs = decision.atMs + profile.lookaheadSeconds * 1000;
  return snapshots.find((snapshot) => {
    if (snapshot.atMs <= decision.atMs || snapshot.atMs > deadlineMs) return false;
    const curve = Number(snapshot.curveProgress);
    const delta = curve - Number(decision.curveProgress);
    return curve >= profile.minConfirmCurve && delta >= profile.minCurveDelta;
  }) || null;
}

function closeTrade(decision, entry, snapshot, reason, profile, netReturnPct) {
  return {
    telemetryPath: decision.telemetryPath,
    mint: decision.mint,
    symbol: decision.symbol,
    candidateClass: decision.candidateClass,
    skipAt: decision.at,
    skipCurveProgress: decision.curveProgress,
    skipCurveProgressDelta: decision.curveProgressDelta,
    skipReadinessPct: decision.readinessPct,
    skipScore: decision.score,
    score: decision.score,
    reasonAtEntry: decision.reason,
    recentVolumeSol: decision.recentVolumeSol,
    tradeVelocityPerMin: decision.tradeVelocityPerMin,
    buyRatio: decision.buyRatio,
    uniqueBuyerCount: decision.uniqueBuyerCount,
    sniperWalletCount: decision.sniperWalletCount,
    walletTouchCount: decision.walletTouchCount,
    walletBuyTouchCount: decision.walletBuyTouchCount,
    positiveWalletTouchCount: decision.positiveWalletTouchCount,
    avoidWalletTouchCount: decision.avoidWalletTouchCount,
    firstTouchName: decision.firstTouchName,
    firstBuyName: decision.firstBuyName,
    entryAt: entry?.at || null,
    entryCurveProgress: entry?.curveProgress ?? null,
    entryPriceSol: entry?.priceSol ?? null,
    exitAt: snapshot?.at || null,
    exitCurveProgress: snapshot?.curveProgress ?? null,
    exitPriceSol: snapshot?.priceSol ?? null,
    holdSeconds: entry && snapshot ? numberOrNull((snapshot.atMs - entry.atMs) / 1000, 2) : null,
    exitReason: reason,
    grossReturnPct: entry && snapshot ? numberOrNull(((Number(snapshot.priceSol) / Number(entry.priceSol)) - 1) * 100, 4) : null,
    netReturnPct: numberOrNull(netReturnPct * 100, 4),
    pnlSol: numberOrNull(profile.amountSol * netReturnPct, 9)
  };
}

function simulateTrade(run, decision, profile) {
  if (!candidateMatches(decision, profile)) return closeTrade(decision, null, null, 'NOT_IN_PROFILE_CANDIDATE_CLASS', profile, 0);
  const snapshots = run.snapshotsByMint.get(decision.mint) || [];
  const entry = findConfirmation(decision, snapshots, profile);
  if (!entry) return closeTrade(decision, null, null, 'NO_CONFIRMATION', profile, 0);
  const exitWindow = snapshots.filter((snapshot) => snapshot.atMs > entry.atMs && snapshot.atMs <= entry.atMs + profile.maxHoldSeconds * 1000);
  if (!exitWindow.length) return closeTrade(decision, entry, null, 'NO_FUTURE_SNAPSHOTS', profile, 0);

  const entryFill = Number(entry.priceSol) * (1 + profile.entrySlippagePct / 100);
  let last = exitWindow[exitWindow.length - 1];
  for (const snapshot of exitWindow) {
    const exitFill = Number(snapshot.priceSol) * (1 - profile.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    if (netReturn >= profile.takeProfitPct) return closeTrade(decision, entry, snapshot, 'TAKE_PROFIT', profile, netReturn);
    if (netReturn <= -profile.stopLossPct) return closeTrade(decision, entry, snapshot, 'STOP_LOSS', profile, netReturn);
    last = snapshot;
  }
  const exitFill = Number(last.priceSol) * (1 - profile.exitSlippagePct / 100);
  return closeTrade(decision, entry, last, 'MAX_HOLD', profile, (exitFill / entryFill) - 1);
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

function aggregateTrades(trades) {
  const eligible = trades.filter((trade) => trade.exitReason !== 'NOT_IN_PROFILE_CANDIDATE_CLASS');
  const entered = eligible.filter((trade) => trade.exitReason !== 'NO_CONFIRMATION');
  const closed = entered.filter((trade) => trade.exitReason !== 'NO_FUTURE_SNAPSHOTS');
  const wins = closed.filter((trade) => Number(trade.pnlSol) > 0);
  const losses = closed.filter((trade) => Number(trade.pnlSol) < 0);
  const totalPnlSol = closed.reduce((total, trade) => total + Number(trade.pnlSol || 0), 0);
  return {
    decisions: trades.length,
    eligibleCandidates: eligible.length,
    confirmedEntries: entered.length,
    closed: closed.length,
    noConfirmation: eligible.length - entered.length,
    noFutureSnapshots: entered.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? numberOrNull(wins.length / closed.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    averagePnlSol: closed.length ? numberOrNull(totalPnlSol / closed.length, 9) : null,
    medianPnlSol: stats(closed.map((trade) => trade.pnlSol), 9).median,
    exitReasonCounts: countBy(trades, (trade) => trade.exitReason),
    candidateClassCounts: countBy(eligible, (trade) => trade.candidateClass),
    uniqueMints: new Set(eligible.map((trade) => trade.mint).filter(Boolean)).size,
    confirmedUniqueMints: new Set(entered.map((trade) => trade.mint).filter(Boolean)).size,
    pnlStats: stats(closed.map((trade) => trade.pnlSol), 9),
    netReturnPctStats: stats(closed.map((trade) => trade.netReturnPct), 4)
  };
}

function scoreSlice(summary) {
  const trades = Number(summary.closed || 0);
  const pnl = Number(summary.totalPnlSol || 0);
  const median = Number(summary.medianPnlSol);
  const winRate = Number(summary.winRate);
  if (trades <= 0) return -Infinity;
  const medianComponent = Number.isFinite(median) ? median * 1000 : -10;
  const winComponent = Number.isFinite(winRate) ? (winRate - 0.5) * 10 : -5;
  return pnl + medianComponent + winComponent + Math.min(trades, 12) * 0.001;
}

function buildSlices(profileName, trades) {
  const closedBase = trades.filter((trade) => (
    !['NOT_IN_PROFILE_CANDIDATE_CLASS', 'NO_CONFIRMATION', 'NO_FUTURE_SNAPSHOTS'].includes(trade.exitReason)
  ));
  const slices = SLICE_DEFINITIONS.map((definition) => {
    const sliceTrades = trades.filter((trade) => (
      !['NOT_IN_PROFILE_CANDIDATE_CLASS', 'NO_CONFIRMATION', 'NO_FUTURE_SNAPSHOTS'].includes(trade.exitReason)
      && definition.predicate(trade)
    ));
    const summary = aggregateTrades(sliceTrades);
    return {
      profileName,
      name: definition.name,
      description: definition.description,
      baseClosedTrades: closedBase.length,
      ...summary,
      keptShare: closedBase.length ? numberOrNull(sliceTrades.length / closedBase.length, 4) : null,
      score: numberOrNull(scoreSlice(summary), 6),
      sampleMints: sliceTrades
        .slice()
        .sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0))
        .slice(0, 6)
        .map((trade) => ({
          mint: trade.mint,
          symbol: trade.symbol,
          pnlSol: trade.pnlSol,
          score: trade.score,
          skipCurveProgress: trade.skipCurveProgress,
          candidateClass: trade.candidateClass,
          exitReason: trade.exitReason
        }))
    };
  });
  return slices
    .filter((slice) => slice.closed > 0)
    .sort((a, b) => Number(b.score ?? -Infinity) - Number(a.score ?? -Infinity));
}

function buildReport(runs) {
  for (const run of runs) {
    for (const decision of run.decisions) {
      decision.candidateClass = classifyCandidate(decision, run.snapshotsByMint.get(decision.mint) || []);
    }
  }
  const candidates = runs.flatMap((run) => firstDecisionPerRunMint(run).map((decision) => ({ run, decision })));
  const profiles = {};
  for (const [name, profile] of Object.entries(PROFILES)) {
    const trades = candidates.map(({ run, decision }) => simulateTrade(run, decision, profile));
    const sortedByPnl = trades.slice().sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0));
    profiles[name] = {
      profile,
      summary: aggregateTrades(trades),
      topSlices: buildSlices(name, trades).slice(0, 12),
      topWinners: sortedByPnl.filter((trade) => Number(trade.pnlSol) > 0).slice(0, 10),
      topLosers: sortedByPnl.filter((trade) => Number(trade.pnlSol) < 0).slice(-10).reverse()
    };
  }
  const sliceRanking = Object.values(profiles)
    .flatMap((profile) => profile.topSlices || [])
    .filter((slice) => Number(slice.closed) >= 2)
    .sort((a, b) => Number(b.score ?? -Infinity) - Number(a.score ?? -Infinity))
    .slice(0, 20);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    note: 'Curve false-negative replay for CURVE_NOT_ADVANCING rows that later show useful/strong curve follow-through. It does not alter runtime gates, entries, exits, AI review, quotes, broadcast, or live behavior.',
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0),
      targetReason: TARGET_REASON,
      profiles: Object.keys(PROFILES)
    },
    candidateClassCounts: countBy(candidates, ({ decision }) => decision.candidateClass),
    profiles,
    sliceRanking,
    ranking: Object.entries(profiles)
      .map(([name, report]) => ({ name, ...report.summary }))
      .sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0))
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxFiles = Number.isFinite(Number(args.limit)) ? Number(args.limit) : DEFAULT_MAX_FILES;
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((entry) => repoPath(entry.trim())).filter((filePath) => filePath && fs.existsSync(filePath))
    : telemetryFiles(maxFiles);
  const outputPath = args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH;
  if (!files.length) throw new Error('No telemetry files found.');

  const runs = [];
  for (const filePath of files) runs.push(await readTelemetry(filePath));
  const report = buildReport(runs);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('Pre-Migration Curve False-Negative Replay');
  console.log(`Telemetry files read: ${report.inputs.telemetryFilesRead}`);
  console.log(`Candidate classes: ${JSON.stringify(report.candidateClassCounts)}`);
  for (const row of report.ranking) {
    console.log(`${row.name}: eligible=${row.eligibleCandidates}, entered=${row.confirmedEntries}, wins=${row.wins}, losses=${row.losses}, winRate=${row.winRate ?? 'n/a'}, pnl=${row.totalPnlSol} SOL, median=${row.medianPnlSol ?? 'n/a'} SOL`);
  }
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  PROFILES,
  OUTPUT_PATH
};
