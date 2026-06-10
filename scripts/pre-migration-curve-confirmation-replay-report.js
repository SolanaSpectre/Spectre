#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-confirmation-replay-latest.json');
const TARGET_REASONS = new Set(['CURVE_NOT_ADVANCING', 'NO_PRIOR_CURVE_PROGRESS']);
const DEFAULT_MAX_FILES = 24;

const BASE_TRADE = {
  amountSol: 0.02,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5,
  takeProfitPct: 0.35,
  stopLossPct: 0.15,
  maxHoldSeconds: 300
};

const PROFILES = {
  delta03_120_any_score: {
    description: 'Enter after +3 curve points within 120s; no score/flow floor.',
    lookaheadSeconds: 120,
    minCurveDelta: 0.03,
    minConfirmCurve: 0,
    minScore: 0,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    ...BASE_TRADE
  },
  delta05_120_score75: {
    description: 'Enter after +5 curve points within 120s; score>=75.',
    lookaheadSeconds: 120,
    minCurveDelta: 0.05,
    minConfirmCurve: 0,
    minScore: 75,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    ...BASE_TRADE
  },
  delta05_120_score75_curve70: {
    description: 'Enter after +5 curve points within 120s; score>=75 and confirm curve>=70%.',
    lookaheadSeconds: 120,
    minCurveDelta: 0.05,
    minConfirmCurve: 0.7,
    minScore: 75,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    ...BASE_TRADE
  },
  delta03_120_score80_curve70_flow12: {
    description: 'Enter after +3 curve points within 120s; score>=80, confirm curve>=70%, volume/velocity>=12.',
    lookaheadSeconds: 120,
    minCurveDelta: 0.03,
    minConfirmCurve: 0.7,
    minScore: 80,
    minRecentVolumeSol: 12,
    minTradeVelocityPerMin: 12,
    ...BASE_TRADE,
    takeProfitPct: 0.5,
    maxHoldSeconds: 240
  },
  cross75_300_score75: {
    description: 'Enter on first cross above 75% within 300s; score>=75.',
    lookaheadSeconds: 300,
    minCurveDelta: 0,
    minConfirmCurve: 0.75,
    minScore: 75,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    ...BASE_TRADE
  },
  cross85_300_any_score: {
    description: 'Enter on first cross above 85% within 300s; no score floor.',
    lookaheadSeconds: 300,
    minCurveDelta: 0,
    minConfirmCurve: 0.85,
    minScore: 0,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    ...BASE_TRADE,
    maxHoldSeconds: 180
  }
};

const SLICE_DEFINITIONS = [
  {
    name: 'curve_stall_only',
    description: 'CURVE_NOT_ADVANCING only',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING'
  },
  {
    name: 'curve_stall_near_threshold_80',
    description: 'CURVE_NOT_ADVANCING with readiness >= 80%',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING' && Number(trade.readinessPct) >= 80
  },
  {
    name: 'curve_stall_no_avoid_wallet',
    description: 'CURVE_NOT_ADVANCING with no avoid/negative wallet touch',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING' && Number(trade.avoidWalletTouchCount || 0) === 0
  },
  {
    name: 'curve_stall_unknown_wallet',
    description: 'CURVE_NOT_ADVANCING with unknown wallet touch',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING' && trade.walletBucket === 'unknown_wallet_touch'
  },
  {
    name: 'curve_stall_score50_volume1',
    description: 'CURVE_NOT_ADVANCING with score >= 50 and volume >= 1 SOL',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING'
      && Number(trade.skipScore) >= 50
      && Number(trade.skipRecentVolumeSol) >= 1
  },
  {
    name: 'curve_stall_score60_volume5',
    description: 'CURVE_NOT_ADVANCING with score >= 60 and volume >= 5 SOL',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING'
      && Number(trade.skipScore) >= 60
      && Number(trade.skipRecentVolumeSol) >= 5
  },
  {
    name: 'curve_stall_flow12',
    description: 'CURVE_NOT_ADVANCING with volume >= 12 SOL and velocity >= 12/min',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING'
      && Number(trade.skipRecentVolumeSol) >= 12
      && Number(trade.skipTradeVelocityPerMin) >= 12
  },
  {
    name: 'curve_stall_near_threshold_flow',
    description: 'CURVE_NOT_ADVANCING with readiness >= 80%, volume >= 1 SOL, velocity >= 5/min',
    predicate: (trade) => trade.reasonAtSkip === 'CURVE_NOT_ADVANCING'
      && Number(trade.readinessPct) >= 80
      && Number(trade.skipRecentVolumeSol) >= 1
      && Number(trade.skipTradeVelocityPerMin) >= 5
  }
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

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return digits === null ? numeric : Number(numeric.toFixed(digits));
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
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
    walletBucket,
    walletTouchCount: wallets.length,
    walletBuyTouchCount: buys.length,
    positiveWalletTouchCount,
    avoidWalletTouchCount,
    firstTouchName: wallets[0]?.name || wallets[0]?.wallet || null,
    firstBuyName: buys[0]?.name || buys[0]?.wallet || null
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
    eventType: event.type || event.telemetryType || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceSol, 15)
  };
}

function decisionFromEvent(event) {
  if (event.type !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED' || !TARGET_REASONS.has(payload.reason)) return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress) || !Number.isFinite(priceSol)) return null;
  return {
    telemetryPath: null,
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    reason: payload.reason,
    preset: payload.preset || null,
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceSol, 15),
    curveProgressDelta: numberOrNull(payload.curveProgressDelta, 6),
    threshold: numberOrNull(payload.threshold, 6),
    readinessPct: Number.isFinite(Number(payload.curveProgressDelta)) && Number.isFinite(Number(payload.threshold)) && Number(payload.threshold) > 0
      ? numberOrNull(Math.max(0, Math.min(1, Number(payload.curveProgressDelta) / Number(payload.threshold))) * 100, 2)
      : null,
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    ...walletContextSummary(payload.walletClassificationContext || {})
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
    malformedLines
  };
}

function firstDecisionPerRunMint(run) {
  const selected = new Map();
  for (const decision of run.decisions) {
    const key = `${run.telemetryPath}::${decision.mint}`;
    if (!selected.has(key)) selected.set(key, decision);
  }
  return Array.from(selected.values());
}

function passesDecisionFloor(decision, profile) {
  return Number(decision.score || 0) >= profile.minScore
    && Number(decision.recentVolumeSol || 0) >= profile.minRecentVolumeSol
    && Number(decision.tradeVelocityPerMin || 0) >= profile.minTradeVelocityPerMin;
}

function findConfirmation(decision, snapshots, profile) {
  if (!passesDecisionFloor(decision, profile)) return null;
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
    reasonAtSkip: decision.reason,
    presetAtSkip: decision.preset,
    skipAt: decision.at,
    skipCurveProgress: decision.curveProgress,
    skipScore: decision.score,
    skipRecentVolumeSol: decision.recentVolumeSol,
    skipTradeVelocityPerMin: decision.tradeVelocityPerMin,
    readinessPct: decision.readinessPct,
    curveProgressDelta: decision.curveProgressDelta,
    threshold: decision.threshold,
    walletBucket: decision.walletBucket,
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

function simulateConfirmedTrade(run, decision, profile) {
  const snapshots = run.snapshotsByMint.get(decision.mint) || [];
  const confirmation = findConfirmation(decision, snapshots, profile);
  if (!confirmation) return closeTrade(decision, null, null, 'NO_CONFIRMATION', profile, 0);

  const exitWindow = snapshots.filter((snapshot) => (
    snapshot.atMs > confirmation.atMs && snapshot.atMs <= confirmation.atMs + profile.maxHoldSeconds * 1000
  ));
  if (!exitWindow.length) return closeTrade(decision, confirmation, null, 'NO_FUTURE_SNAPSHOTS', profile, 0);

  const entryFill = Number(confirmation.priceSol) * (1 + profile.entrySlippagePct / 100);
  let last = exitWindow[exitWindow.length - 1];
  for (const snapshot of exitWindow) {
    const exitFill = Number(snapshot.priceSol) * (1 - profile.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    if (netReturn >= profile.takeProfitPct) return closeTrade(decision, confirmation, snapshot, 'TAKE_PROFIT', profile, netReturn);
    if (netReturn <= -profile.stopLossPct) return closeTrade(decision, confirmation, snapshot, 'STOP_LOSS', profile, netReturn);
    last = snapshot;
  }
  const exitFill = Number(last.priceSol) * (1 - profile.exitSlippagePct / 100);
  return closeTrade(decision, confirmation, last, 'MAX_HOLD', profile, (exitFill / entryFill) - 1);
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
  const entered = trades.filter((trade) => trade.exitReason !== 'NO_CONFIRMATION');
  const closed = entered.filter((trade) => trade.exitReason !== 'NO_FUTURE_SNAPSHOTS');
  const wins = closed.filter((trade) => Number(trade.pnlSol) > 0);
  const losses = closed.filter((trade) => Number(trade.pnlSol) < 0);
  const totalPnlSol = closed.reduce((total, trade) => total + Number(trade.pnlSol || 0), 0);
  return {
    decisions: trades.length,
    confirmedEntries: entered.length,
    closed: closed.length,
    noConfirmation: trades.length - entered.length,
    noFutureSnapshots: entered.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? numberOrNull(wins.length / closed.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    averagePnlSol: closed.length ? numberOrNull(totalPnlSol / closed.length, 9) : null,
    exitReasonCounts: countBy(trades, (trade) => trade.exitReason),
    walletBucketCounts: countBy(trades, (trade) => trade.walletBucket),
    uniqueMints: new Set(trades.map((trade) => trade.mint).filter(Boolean)).size,
    confirmedUniqueMints: new Set(entered.map((trade) => trade.mint).filter(Boolean)).size,
    pnlStats: stats(closed.map((trade) => trade.pnlSol), 9),
    netReturnPctStats: stats(closed.map((trade) => trade.netReturnPct), 4)
  };
}

function sliceRanking(profiles) {
  const rows = [];
  for (const [profileName, report] of Object.entries(profiles)) {
    const trades = report.trades || [];
    const closedAll = trades.filter((trade) => !['NO_CONFIRMATION', 'NO_FUTURE_SNAPSHOTS'].includes(trade.exitReason));
    for (const slice of SLICE_DEFINITIONS) {
      const selected = trades.filter(slice.predicate);
      if (!selected.length) continue;
      const summary = aggregateTrades(selected);
      rows.push({
        profileName,
        name: slice.name,
        description: slice.description,
        keptShare: trades.length ? numberOrNull(selected.length / trades.length, 4) : null,
        closedShareOfAllClosed: closedAll.length ? numberOrNull(summary.closed / closedAll.length, 4) : null,
        ...summary
      });
    }
  }
  return rows.sort((a, b) => {
    const closedDelta = Number(b.closed || 0) - Number(a.closed || 0);
    const pnlDelta = Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0);
    if (Math.min(Number(a.closed || 0), Number(b.closed || 0)) >= 5 && pnlDelta !== 0) return pnlDelta > 0 ? 1 : -1;
    return closedDelta || (pnlDelta > 0 ? 1 : pnlDelta < 0 ? -1 : 0);
  });
}

function buildReport(runs) {
  const profiles = {};
  const profileTrades = {};
  for (const [name, profile] of Object.entries(PROFILES)) {
    const candidates = runs.flatMap((run) => firstDecisionPerRunMint(run).map((decision) => ({ run, decision })));
    const trades = candidates.map(({ run, decision }) => simulateConfirmedTrade(run, decision, profile));
    profileTrades[name] = trades;
    const sortedByPnl = trades.slice().sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0));
    profiles[name] = {
      profile,
      summary: aggregateTrades(trades),
      topWinners: sortedByPnl.filter((trade) => Number(trade.pnlSol) > 0).slice(0, 10),
      topLosers: sortedByPnl.filter((trade) => Number(trade.pnlSol) < 0).slice(-10).reverse()
    };
  }
  const profilesForSliceRanking = Object.fromEntries(Object.entries(profiles).map(([name, report]) => [
    name,
    { ...report, trades: profileTrades[name] || [] }
  ]));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    note: 'Delayed confirmation replay for CURVE_NOT_ADVANCING and NO_PRIOR_CURVE_PROGRESS skips. It enters only after later curve confirmation inside the same telemetry run, then replays exits from observed provider snapshots. It does not alter runtime gates, entries, AI, quotes, or live broadcast.',
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0),
      targetReasons: Array.from(TARGET_REASONS).sort()
    },
    profiles,
    sliceRanking: sliceRanking(profilesForSliceRanking),
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

  console.log('Pre-Migration Curve Confirmation Replay');
  console.log(`Telemetry files read: ${report.inputs.telemetryFilesRead}`);
  for (const row of report.ranking) {
    console.log(`${row.name}: confirmed=${row.confirmedEntries}/${row.decisions}, wins=${row.wins}, losses=${row.losses}, winRate=${row.winRate ?? 'n/a'}, pnl=${row.totalPnlSol} SOL`);
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
  TARGET_REASONS,
  OUTPUT_PATH
};
