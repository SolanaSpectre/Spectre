#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-false-negative-shadow-replay-latest.json');
const SHADOW_EVENT = 'pre_migration_curve_false_negative_shadow.would_watch';
const DEFAULT_MAX_FILES = Number.parseInt(process.env.PRE_MIGRATION_CURVE_FALSE_NEGATIVE_SHADOW_REPLAY_MAX_FILES || '9', 10);
const BASE_PROFILE = {
  amountSol: 0.02,
  takeProfitPct: 0.5,
  stopLossPct: 0.25,
  maxHoldSeconds: 300,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5
};

const PROFILES = {
  all_would_watch: {
    description: 'All prospective curve false-negative would_watch rows.',
    matches: () => true
  },
  narrow_core: {
    description: 'Prospective rows tagged score>=50 and curve>=30%.',
    matches: (row) => row.narrowCore === true || row.matchedFilters.includes('narrow_core_score50_curve30')
  },
  narrow_core_volume: {
    description: 'Prospective narrow-core rows with volume>=12 SOL.',
    matches: (row) => row.narrowCoreVolume === true || row.matchedFilters.includes('narrow_core_score50_curve30_volume12')
  },
  score60_curve50: {
    description: 'Prospective rows matching score>=60 and curve>=50%.',
    matches: (row) => row.matchedFilters.includes('score_ge_60_curve_ge_50')
  },
  score60_curve50_volume12: {
    description: 'Prospective score>=60, curve>=50%, volume>=12 SOL rows.',
    matches: (row) => row.matchedFilters.includes('score_ge_60_curve_ge_50') && Number(row.recentVolumeSol) >= 12
  },
  positive_wallet_touch: {
    description: 'Prospective rows with positive/proven wallet touch context.',
    matches: (row) => Number(row.positiveWalletTouchCount || 0) > 0
  }
};

const SLICE_DEFINITIONS = [
  { name: 'score_ge_60', description: 'score >= 60', predicate: (trade) => Number(trade.score) >= 60 },
  { name: 'score_ge_75', description: 'score >= 75', predicate: (trade) => Number(trade.score) >= 75 },
  { name: 'curve_ge_50', description: 'entry curve >= 50%', predicate: (trade) => Number(trade.entryCurveProgress) >= 0.5 },
  { name: 'curve_ge_70', description: 'entry curve >= 70%', predicate: (trade) => Number(trade.entryCurveProgress) >= 0.7 },
  { name: 'score_ge_60_curve_ge_50', description: 'score >= 60 and entry curve >= 50%', predicate: (trade) => Number(trade.score) >= 60 && Number(trade.entryCurveProgress) >= 0.5 },
  { name: 'score_ge_75_curve_ge_70', description: 'score >= 75 and entry curve >= 70%', predicate: (trade) => Number(trade.score) >= 75 && Number(trade.entryCurveProgress) >= 0.7 },
  { name: 'volume_ge_12', description: 'recent volume >= 12 SOL', predicate: (trade) => Number(trade.recentVolumeSol) >= 12 },
  { name: 'volume_ge_50', description: 'recent volume >= 50 SOL', predicate: (trade) => Number(trade.recentVolumeSol) >= 50 },
  { name: 'velocity_ge_12', description: 'trade velocity >= 12/min', predicate: (trade) => Number(trade.tradeVelocityPerMin) >= 12 },
  { name: 'velocity_ge_50', description: 'trade velocity >= 50/min', predicate: (trade) => Number(trade.tradeVelocityPerMin) >= 50 },
  { name: 'buyers_ge_25', description: 'unique buyers >= 25', predicate: (trade) => Number(trade.uniqueBuyerCount) >= 25 },
  { name: 'buyers_ge_75', description: 'unique buyers >= 75', predicate: (trade) => Number(trade.uniqueBuyerCount) >= 75 },
  { name: 'positive_wallet_touch', description: 'positive/proven wallet touch in decision context', predicate: (trade) => Number(trade.positiveWalletTouchCount || 0) > 0 },
  { name: 'no_positive_wallet_touch', description: 'no positive/proven wallet touch in decision context', predicate: (trade) => Number(trade.positiveWalletTouchCount || 0) === 0 },
  { name: 'score_ge_60_volume_ge_50_velocity_ge_50', description: 'score >= 60, volume >= 50 SOL, velocity >= 50/min', predicate: (trade) => Number(trade.score) >= 60 && Number(trade.recentVolumeSol) >= 50 && Number(trade.tradeVelocityPerMin) >= 50 },
  { name: 'score_ge_75_curve_ge_70_volume_ge_12', description: 'score >= 75, entry curve >= 70%, volume >= 12 SOL', predicate: (trade) => Number(trade.score) >= 75 && Number(trade.entryCurveProgress) >= 0.7 && Number(trade.recentVolumeSol) >= 12 }
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

function telemetryFiles(limit = 1) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((row) => row.filePath);
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

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
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
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: num(pick(0.5), digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    avg: num(sum / finite.length, digits)
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
    priceSol: num(priceSol, 12),
    eventType: eventType(event)
  };
}

function shadowFromEvent(event) {
  if (eventType(event) !== SHADOW_EVENT) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(priceSol)) return null;
  const matchedFilters = Array.isArray(payload.matchedFilters) ? payload.matchedFilters : [];
  return {
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: eventType(event),
    shadowReason: payload.shadowReason || null,
    matchedFilters,
    score: num(payload.score, 2),
    curveProgress: num(curveOf(payload), 6),
    curveProgressDelta: num(payload.curveProgressDelta, 6),
    readinessPct: num(payload.readinessPct, 2),
    recentVolumeSol: num(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: num(payload.tradeVelocityPerMin, 2),
    buyRatio: num(payload.buyRatio, 4),
    uniqueBuyerCount: num(payload.uniqueBuyerCount, 0),
    walletTouchCount: num(payload.walletTouchCount, 0),
    positiveWalletTouchCount: num(payload.positiveWalletTouchCount, 0),
    avoidWalletTouchCount: num(payload.avoidWalletTouchCount, 0),
    narrowCore: payload.narrowCore === true || matchedFilters.includes('narrow_core_score50_curve30'),
    narrowCoreVolume: payload.narrowCoreVolume === true || matchedFilters.includes('narrow_core_score50_curve30_volume12'),
    narrowCorePositiveWallet: payload.narrowCorePositiveWallet === true || Number(payload.positiveWalletTouchCount || 0) > 0,
    shadowTier: payload.shadowTier || null,
    priceSol: num(priceSol, 12)
  };
}

async function readTelemetry(filePath) {
  const shadows = [];
  const snapshotsByMint = new Map();
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
    const shadow = shadowFromEvent(event);
    if (shadow) shadows.push(shadow);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  shadows.sort((a, b) => a.atMs - b.atMs);
  return {
    telemetryPath: path.relative(ROOT, filePath),
    malformedLines,
    shadows,
    snapshotsByMint
  };
}

function closeTrade(row, snapshot, exitReason, profile, netReturn) {
  return {
    mint: row.mint,
    symbol: row.symbol,
    entryAt: row.at,
    exitAt: snapshot?.at || null,
    matchedFilters: row.matchedFilters,
    shadowTier: row.shadowTier,
    score: row.score,
    entryCurveProgress: row.curveProgress,
    exitCurveProgress: snapshot?.curveProgress ?? null,
    entryPriceSol: row.priceSol,
    exitPriceSol: snapshot?.priceSol ?? null,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    uniqueBuyerCount: row.uniqueBuyerCount,
    positiveWalletTouchCount: row.positiveWalletTouchCount,
    holdSeconds: snapshot ? num((snapshot.atMs - row.atMs) / 1000, 2) : null,
    exitReason,
    netReturnPct: num(netReturn * 100, 4),
    pnlSol: num(profile.amountSol * netReturn, 9)
  };
}

function simulateTrade(run, row, profile) {
  const snapshots = (run.snapshotsByMint.get(row.mint) || [])
    .filter((snapshot) => snapshot.atMs > row.atMs && snapshot.atMs <= row.atMs + profile.maxHoldSeconds * 1000);
  if (!snapshots.length) return closeTrade(row, null, 'NO_FUTURE_SNAPSHOTS', profile, 0);

  const entryFill = Number(row.priceSol) * (1 + profile.entrySlippagePct / 100);
  let last = snapshots[snapshots.length - 1];
  for (const snapshot of snapshots) {
    const exitFill = Number(snapshot.priceSol) * (1 - profile.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    if (netReturn >= profile.takeProfitPct) return closeTrade(row, snapshot, 'TAKE_PROFIT', profile, netReturn);
    if (netReturn <= -profile.stopLossPct) return closeTrade(row, snapshot, 'STOP_LOSS', profile, netReturn);
    last = snapshot;
  }
  const exitFill = Number(last.priceSol) * (1 - profile.exitSlippagePct / 100);
  return closeTrade(row, last, 'MAX_HOLD', profile, (exitFill / entryFill) - 1);
}

function aggregateTrades(trades) {
  const closed = trades.filter((trade) => trade.exitReason !== 'NO_FUTURE_SNAPSHOTS');
  const wins = closed.filter((trade) => Number(trade.pnlSol) > 0);
  const losses = closed.filter((trade) => Number(trade.pnlSol) < 0);
  const totalPnlSol = closed.reduce((total, trade) => total + Number(trade.pnlSol || 0), 0);
  return {
    trades: trades.length,
    closed: closed.length,
    noFutureSnapshots: trades.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? num(wins.length / closed.length, 4) : null,
    totalPnlSol: num(totalPnlSol, 9),
    averagePnlSol: closed.length ? num(totalPnlSol / closed.length, 9) : null,
    medianPnlSol: stat(closed.map((trade) => trade.pnlSol), 9).median,
    netReturnPctStats: stat(closed.map((trade) => trade.netReturnPct), 4),
    exitReasonCounts: countBy(trades, (trade) => trade.exitReason),
    uniqueMints: new Set(trades.map((trade) => trade.mint)).size
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
  return pnl + medianComponent + winComponent + Math.min(trades, 20) * 0.001;
}

function buildSlices(profileName, trades) {
  const closedBase = trades.filter((trade) => trade.exitReason !== 'NO_FUTURE_SNAPSHOTS');
  const slices = SLICE_DEFINITIONS.map((definition) => {
    const sliceTrades = closedBase.filter((trade) => definition.predicate(trade));
    const summary = aggregateTrades(sliceTrades);
    return {
      profileName,
      name: definition.name,
      description: definition.description,
      baseClosedTrades: closedBase.length,
      ...summary,
      keptShare: closedBase.length ? num(sliceTrades.length / closedBase.length, 4) : null,
      score: num(scoreSlice(summary), 6),
      sampleMints: sliceTrades
        .slice()
        .sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0))
        .slice(0, 6)
        .map((trade) => ({
          mint: trade.mint,
          symbol: trade.symbol,
          pnlSol: trade.pnlSol,
          score: trade.score,
          entryCurveProgress: trade.entryCurveProgress,
          exitReason: trade.exitReason
        }))
    };
  });
  return slices
    .filter((slice) => slice.closed > 0)
    .sort((a, b) => Number(b.score ?? -Infinity) - Number(a.score ?? -Infinity));
}

function firstShadowPerRunMint(runs, profile) {
  const candidates = [];
  for (const run of runs) {
    const seen = new Set();
    for (const row of run.shadows) {
      if (!profile.matches(row)) continue;
      const key = row.mint;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ run, row });
    }
  }
  return candidates;
}

function buildReport(runs) {
  const profiles = {};
  for (const [name, rawProfile] of Object.entries(PROFILES)) {
    const profile = { ...BASE_PROFILE, ...rawProfile };
    const candidates = firstShadowPerRunMint(runs, profile);
    const trades = candidates.map(({ run, row }) => simulateTrade(run, row, profile));
    const sortedByPnl = trades.slice().sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0));
    profiles[name] = {
      profile: {
        description: profile.description,
        amountSol: profile.amountSol,
        takeProfitPct: profile.takeProfitPct,
        stopLossPct: profile.stopLossPct,
        maxHoldSeconds: profile.maxHoldSeconds,
        entrySlippagePct: profile.entrySlippagePct,
        exitSlippagePct: profile.exitSlippagePct
      },
      summary: aggregateTrades(trades),
      topSlices: buildSlices(name, trades).slice(0, 12),
      topWinners: sortedByPnl.slice(0, 8),
      topLosers: sortedByPnl.slice(-8).reverse(),
      trades
    };
  }
  const sliceRanking = Object.values(profiles)
    .flatMap((profile) => profile.topSlices || [])
    .sort((a, b) => Number(b.score ?? -Infinity) - Number(a.score ?? -Infinity))
    .slice(0, 30);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_curve_false_negative_shadow_replay',
    note: 'Replays prospective runtime would_watch rows from pre_migration_curve_false_negative_shadow. This is ex-ante report-only evidence and does not alter runtime gates, paper entries, AI, quotes, or live broadcast.',
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0),
      shadowRows: runs.reduce((total, run) => total + run.shadows.length, 0),
      baseProfile: BASE_PROFILE
    },
    profiles,
    sliceRanking,
    ranking: Object.entries(profiles)
      .map(([name, report]) => ({ name, ...report.summary }))
      .sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0))
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configuredMaxFiles = Number.isFinite(DEFAULT_MAX_FILES) && DEFAULT_MAX_FILES > 0 ? DEFAULT_MAX_FILES : 9;
  const maxFiles = Number.isFinite(Number(args.limit)) ? Number(args.limit) : configuredMaxFiles;
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((entry) => repoPath(entry.trim())).filter((filePath) => filePath && fs.existsSync(filePath))
    : telemetryFiles(maxFiles);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!files.length) throw new Error('No telemetry files found.');
  const runs = [];
  for (const filePath of files) runs.push(await readTelemetry(filePath));
  const report = buildReport(runs);
  writeJson(outputPath, report);
  console.log('Pre-Migration Curve False-Negative Shadow Replay');
  console.log(`Telemetry files read: ${report.inputs.telemetryFilesRead}`);
  for (const row of report.ranking) {
    console.log(`${row.name}: trades=${row.trades}, wins=${row.wins}, losses=${row.losses}, winRate=${row.winRate ?? 'n/a'}, pnl=${row.totalPnlSol} SOL`);
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
  parseArgs
};
