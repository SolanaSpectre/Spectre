#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { scoreDecision } = require('./pre-migration-entry-gate-margin-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'pre-migration-high-readiness-reject-replay');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-high-readiness-reject-replay-latest.json');

const BASE_TRADE = {
  amountSol: 0.02,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5,
  stressExtraSlippagePct: 3
};

const EXIT_PROFILES = {
  scalp_180s_tp35_sl15: { takeProfitPct: 0.35, stopLossPct: 0.15, maxHoldSeconds: 180 },
  scalp_300s_tp35_sl15: { takeProfitPct: 0.35, stopLossPct: 0.15, maxHoldSeconds: 300 },
  tighter_180s_tp25_sl12: { takeProfitPct: 0.25, stopLossPct: 0.12, maxHoldSeconds: 180 },
  runner_300s_tp50_sl20: { takeProfitPct: 0.5, stopLossPct: 0.2, maxHoldSeconds: 300 }
};

const ENTRY_PROFILES = {
  high_readiness_90_all: {
    description: 'All skipped decisions with measurable gate readiness >=90%.',
    minReadinessPct: 90
  },
  high_readiness_95_all: {
    description: 'All skipped decisions with measurable gate readiness >=95%.',
    minReadinessPct: 95
  },
  score_gap_1_late: {
    description: 'LOW_SCORE misses within 1 score point, late curve, and enough observed flow.',
    allowedReasons: ['LOW_SCORE'],
    tightestGateIncludes: 'score',
    minReadinessPct: 90,
    maxGateGap: 1,
    minCurveProgress: 0.75,
    minRecentVolumeSol: 10,
    minTradeVelocityPerMin: 10
  },
  score_gap_2_curve80: {
    description: 'LOW_SCORE misses within 2 score points and curve >=80%.',
    allowedReasons: ['LOW_SCORE'],
    tightestGateIncludes: 'score',
    minReadinessPct: 90,
    maxGateGap: 2,
    minCurveProgress: 0.8
  },
  curve_delta_near_ready: {
    description: 'CURVE_NOT_ADVANCING misses where the delta gate was close and the token already had flow.',
    allowedReasons: ['CURVE_NOT_ADVANCING'],
    tightestGateIncludes: 'curveProgressDelta',
    minReadinessPct: 80,
    minScore: 70,
    minCurveProgress: 0.5,
    minRecentVolumeSol: 5,
    minTradeVelocityPerMin: 5
  },
  no_prior_late_high_score: {
    description: 'NO_PRIOR_CURVE_PROGRESS misses that already looked late and scored well.',
    allowedReasons: ['NO_PRIOR_CURVE_PROGRESS'],
    minScore: 75,
    minCurveProgress: 0.7
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

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function eventType(event = {}) {
  return event.type || event.event || event.name || 'unknown';
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload = {}) {
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

function priceOf(payload = {}) {
  const direct = Number(payload.providerCurvePriceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? payload.priceSol ?? payload.market?.priceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = Number(payload.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
}

function gateGap(gate) {
  if (!gate || typeof gate !== 'object') return null;
  const actual = Number(gate.actual);
  const threshold = Number(gate.threshold);
  if (!Number.isFinite(actual) || !Number.isFinite(threshold)) return null;
  return gate.mode === 'max' ? actual - threshold : threshold - actual;
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
    at: new Date(atMs).toISOString(),
    atMs,
    eventType: eventType(event),
    curveProgress: compact(curveProgress, 6),
    priceSol: compact(priceSol, 15)
  };
}

function decisionFromEvent(event) {
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED') return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress) || !Number.isFinite(priceSol)) return null;

  const margin = scoreDecision(payload);
  const tightestGate = margin.tightest || null;
  return {
    mint,
    at: new Date(atMs).toISOString(),
    atMs,
    symbol: payload.symbol || null,
    reason: payload.reason || 'UNKNOWN',
    preset: payload.preset || null,
    lane: payload.lane || null,
    score: compact(payload.score, 4),
    threshold: compact(payload.threshold, 4),
    curveProgress: compact(curveProgress, 6),
    priceSol: compact(priceSol, 15),
    recentVolumeSol: compact(payload.recentVolumeSol, 6),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 6),
    buyRatio: compact(payload.buyRatio, 4),
    uniqueBuyerCount: compact(payload.uniqueBuyerCount, 0),
    sniperWalletCount: compact(payload.sniperWalletCount, 0),
    readinessPct: margin.readinessPct,
    tightestGate,
    tightestGateGap: compact(gateGap(tightestGate), 6),
    blockingGateCount: margin.blocking.length,
    reasons: Array.isArray(payload.reasons) ? payload.reasons : []
  };
}

function scan(filePath) {
  const decisions = [];
  const snapshotsByMint = new Map();
  const eventCounts = {};
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      if (!snapshotsByMint.has(snapshot.mint)) snapshotsByMint.set(snapshot.mint, []);
      snapshotsByMint.get(snapshot.mint).push(snapshot);
    }
    const decision = decisionFromEvent(event);
    if (decision) decisions.push(decision);
  });
  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  decisions.sort((a, b) => a.atMs - b.atMs);
  return { decisions, snapshotsByMint, eventCounts, stats };
}

function passesEntryProfile(row, profile) {
  if (Array.isArray(profile.allowedReasons) && !profile.allowedReasons.includes(row.reason)) return false;
  if (profile.tightestGateIncludes && !String(row.tightestGate?.name || '').includes(profile.tightestGateIncludes)) return false;
  if (Number.isFinite(Number(profile.minReadinessPct)) && Number(row.readinessPct) < Number(profile.minReadinessPct)) return false;
  if (Number.isFinite(Number(profile.maxGateGap)) && Number(row.tightestGateGap) > Number(profile.maxGateGap)) return false;
  if (Number.isFinite(Number(profile.minScore)) && Number(row.score) < Number(profile.minScore)) return false;
  if (Number.isFinite(Number(profile.minCurveProgress)) && Number(row.curveProgress) < Number(profile.minCurveProgress)) return false;
  if (Number.isFinite(Number(profile.minRecentVolumeSol)) && Number(row.recentVolumeSol || 0) < Number(profile.minRecentVolumeSol)) return false;
  if (Number.isFinite(Number(profile.minTradeVelocityPerMin)) && Number(row.tradeVelocityPerMin || 0) < Number(profile.minTradeVelocityPerMin)) return false;
  return true;
}

function selectFirstPerMint(decisions, profile) {
  const selected = new Map();
  for (const row of decisions) {
    if (!passesEntryProfile(row, profile)) continue;
    if (!selected.has(row.mint)) selected.set(row.mint, row);
  }
  return Array.from(selected.values());
}

function closeTrade(entry, exit, exitReason, exitProfile, netReturn) {
  const stressedReturn = netReturn - (BASE_TRADE.stressExtraSlippagePct / 100);
  return {
    mint: entry.mint,
    symbol: entry.symbol,
    reason: entry.reason,
    preset: entry.preset,
    lane: entry.lane,
    entryAt: entry.at,
    exitAt: exit?.at || null,
    entryCurveProgress: entry.curveProgress,
    exitCurveProgress: exit?.curveProgress ?? null,
    entryPriceSol: entry.priceSol,
    exitPriceSol: exit?.priceSol ?? null,
    score: entry.score,
    threshold: entry.threshold,
    scoreGap: entry.reason === 'LOW_SCORE' && Number.isFinite(Number(entry.threshold) - Number(entry.score))
      ? compact(Number(entry.threshold) - Number(entry.score), 4)
      : null,
    readinessPct: entry.readinessPct,
    tightestGate: entry.tightestGate,
    tightestGateGap: entry.tightestGateGap,
    recentVolumeSol: entry.recentVolumeSol,
    tradeVelocityPerMin: entry.tradeVelocityPerMin,
    buyRatio: entry.buyRatio,
    uniqueBuyerCount: entry.uniqueBuyerCount,
    sniperWalletCount: entry.sniperWalletCount,
    exitReason,
    holdSeconds: exit ? compact((exit.atMs - entry.atMs) / 1000, 3) : null,
    grossReturnPct: exit ? compact(((Number(exit.priceSol) / Number(entry.priceSol)) - 1) * 100, 4) : null,
    netReturnPct: compact(netReturn * 100, 4),
    stressedReturnPct: compact(stressedReturn * 100, 4),
    pnlSol: compact(BASE_TRADE.amountSol * netReturn, 9),
    stressedPnlSol: compact(BASE_TRADE.amountSol * stressedReturn, 9),
    exitProfile: exitProfile.name
  };
}

function replayTrade(entry, snapshotsByMint, exitProfile) {
  const snapshots = (snapshotsByMint.get(entry.mint) || [])
    .filter((snapshot) => snapshot.atMs > entry.atMs && snapshot.atMs <= entry.atMs + exitProfile.maxHoldSeconds * 1000);
  if (!snapshots.length) return closeTrade(entry, null, 'NO_FUTURE_SNAPSHOTS', exitProfile, 0);

  const entryFill = Number(entry.priceSol) * (1 + BASE_TRADE.entrySlippagePct / 100);
  let last = snapshots[snapshots.length - 1];
  for (const snapshot of snapshots) {
    const exitFill = Number(snapshot.priceSol) * (1 - BASE_TRADE.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    if (netReturn >= exitProfile.takeProfitPct) return closeTrade(entry, snapshot, 'TAKE_PROFIT', exitProfile, netReturn);
    if (netReturn <= -exitProfile.stopLossPct) return closeTrade(entry, snapshot, 'STOP_LOSS', exitProfile, netReturn);
    last = snapshot;
  }
  const exitFill = Number(last.priceSol) * (1 - BASE_TRADE.exitSlippagePct / 100);
  return closeTrade(entry, last, 'MAX_HOLD', exitProfile, (exitFill / entryFill) - 1);
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

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function aggregate(trades) {
  const closed = trades.filter((row) => row.exitReason !== 'NO_FUTURE_SNAPSHOTS');
  const wins = closed.filter((row) => Number(row.pnlSol) > 0);
  const totalPnlSol = closed.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const stressedPnlSol = closed.reduce((sum, row) => sum + Number(row.stressedPnlSol || 0), 0);
  const top3Pnl = closed.map((row) => Number(row.pnlSol) || 0).sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
  const midpoint = Math.ceil(closed.length / 2);
  const firstHalf = closed.slice(0, midpoint);
  const secondHalf = closed.slice(midpoint);
  return {
    trades: trades.length,
    closed: closed.length,
    noFutureSnapshots: trades.length - closed.length,
    wins: wins.length,
    losses: closed.filter((row) => Number(row.pnlSol) < 0).length,
    winRate: closed.length ? compact(wins.length / closed.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    stressedPnlSol: compact(stressedPnlSol, 9),
    medianPnlSol: numericStats(closed.map((row) => row.pnlSol), 9).median,
    firstHalfPnlSol: closed.length ? compact(firstHalf.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0), 9) : null,
    secondHalfPnlSol: secondHalf.length ? compact(secondHalf.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0), 9) : null,
    top3RemovedPnlSol: compact(totalPnlSol - top3Pnl, 9),
    pnlStats: numericStats(closed.map((row) => row.pnlSol), 9),
    netReturnPctStats: numericStats(closed.map((row) => row.netReturnPct), 4),
    exitReasonCounts: countBy(trades, (row) => row.exitReason),
    reasonCounts: countBy(trades, (row) => row.reason)
  };
}

function verdictFor(summary) {
  if (summary.closed < 10) return 'INSUFFICIENT_SAMPLE';
  if (Number(summary.totalPnlSol) <= 0 || Number(summary.stressedPnlSol) <= 0) return 'NEGATIVE_OR_STRESS_NEGATIVE';
  if (Number(summary.medianPnlSol) <= 0) return 'MEDIAN_NEGATIVE';
  if (Number(summary.top3RemovedPnlSol) <= 0) return 'TOP_WINNER_FRAGILE';
  if (summary.secondHalfPnlSol !== null && Number(summary.secondHalfPnlSol) <= 0) return 'SPLIT_HALF_FRAGILE';
  return 'PROMISING_REPORT_ONLY';
}

function buildReport(filePath, scanned) {
  const profileReports = {};
  const rankings = [];
  for (const [entryName, entryProfile] of Object.entries(ENTRY_PROFILES)) {
    const candidates = selectFirstPerMint(scanned.decisions, entryProfile);
    for (const [exitName, exitRaw] of Object.entries(EXIT_PROFILES)) {
      const exitProfile = { name: exitName, ...exitRaw };
      const trades = candidates.map((row) => replayTrade(row, scanned.snapshotsByMint, exitProfile));
      const summary = aggregate(trades);
      const key = `${entryName}__${exitName}`;
      profileReports[key] = {
        entryProfile: { name: entryName, ...entryProfile },
        exitProfile,
        summary,
        verdict: verdictFor(summary),
        topWinners: trades.slice().sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0)).slice(0, 10),
        topLosers: trades.slice().sort((a, b) => Number(a.pnlSol || 0) - Number(b.pnlSol || 0)).slice(0, 10)
      };
      rankings.push({ name: key, verdict: profileReports[key].verdict, ...summary });
    }
  }

  rankings.sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_high_readiness_reject_replay',
    telemetryPath: path.relative(ROOT, filePath),
    inputs: {
      baseTrade: BASE_TRADE,
      entryProfiles: ENTRY_PROFILES,
      exitProfiles: EXIT_PROFILES,
      telemetryRowsRead: scanned.stats.rows,
      malformedLines: scanned.stats.malformedLines
    },
    summary: {
      skippedDecisions: scanned.decisions.length,
      uniqueSkippedMints: new Set(scanned.decisions.map((row) => row.mint)).size,
      reasonCounts: countBy(scanned.decisions, (row) => row.reason),
      readinessPct: numericStats(scanned.decisions.map((row) => row.readinessPct), 2),
      tightestGateCounts: countBy(scanned.decisions, (row) => row.tightestGate?.name),
      promisingProfiles: rankings.filter((row) => row.verdict === 'PROMISING_REPORT_ONLY').map((row) => row.name),
      bestProfile: rankings[0]?.name || null,
      bestProfileVerdict: rankings[0]?.verdict || null,
      bestProfilePnlSol: rankings[0]?.totalPnlSol ?? null
    },
    rankings,
    profiles: profileReports,
    note: 'Report-only replay of high-readiness rejected pre-migration paper decisions. It selects the first matching reject per mint, replays observed later curve-price snapshots with slippage, and does not alter runtime gates, scoring, entries, exits, quotes, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for high-readiness reject replay.');
  }

  const scanned = scan(telemetryPath);
  const report = buildReport(telemetryPath, scanned);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = repoPath(args.output) || path.join(OUTPUT_DIR, `pre-migration-high-readiness-reject-replay-${stamp}.json`);
  writeJson(outputPath, report);
  writeJson(LATEST_PATH, report);

  console.log('Pre-Migration High-Readiness Reject Replay');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Skipped decisions: ${report.summary.skippedDecisions}, unique mints: ${report.summary.uniqueSkippedMints}`);
  console.log(`Best: ${report.summary.bestProfile || 'n/a'} verdict=${report.summary.bestProfileVerdict || 'n/a'} pnl=${report.summary.bestProfilePnlSol ?? 'n/a'} SOL`);
  console.log(`Wrote JSON report: ${outputPath}`);
  console.log(`Wrote latest JSON report: ${LATEST_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = {
  buildReport,
  scan
};
