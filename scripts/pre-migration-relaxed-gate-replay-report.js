#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-relaxed-gate-replay-latest.json');
const DEFAULT_TARGET_REASONS = ['LOW_SCORE', 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE'];
const DEFAULT_MAX_FILES = 24;

const BASE_TRADE = {
  amountSol: 0.02,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5
};

const PROFILES = {
  all_low_score_first_sight: {
    description: 'First LOW_SCORE/FIRST_SIGHT skip per run+mint.',
    minCurveProgress: 0,
    minScore: 0,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300
  },
  curve30_score40_velocity10: {
    description: 'Relaxed early wakeup: curve>=30%, score>=40, velocity>=10/min.',
    minCurveProgress: 0.3,
    minScore: 40,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 10,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300
  },
  curve55_score70: {
    description: 'Moderate late candidate: curve>=55%, score>=70.',
    minCurveProgress: 0.55,
    minScore: 70,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300
  },
  curve70_score75: {
    description: 'Near migration candidate: curve>=70%, score>=75.',
    minCurveProgress: 0.7,
    minScore: 75,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300
  },
  curve80_any_score: {
    description: 'Late curve-only chase: curve>=80%, no score floor.',
    minCurveProgress: 0.8,
    minScore: 0,
    minRecentVolumeSol: 0,
    minTradeVelocityPerMin: 0,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 180
  },
  near_score84_high_curve: {
    description: 'Near-threshold LOW_SCORE miss: within 1 score point of logged score threshold, curve>=80%, volume>=50 SOL, velocity>=50/min.',
    allowedReasons: ['LOW_SCORE'],
    minCurveProgress: 0.8,
    minScore: 80,
    minScoreThreshold: 84,
    maxScoreGap: 1,
    minRecentVolumeSol: 50,
    minTradeVelocityPerMin: 50,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 180
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

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function payloadOf(event) {
  return event.payload || event.data || {};
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
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
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
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceSol, 15)
  };
}

function decisionFromEvent(event, targetReasons) {
  if (event.type !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED') return null;
  if (!targetReasons.has(payload.reason)) return null;
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
    scoreThreshold: numberOrNull(Number(payload.threshold) >= 1 ? payload.threshold : null, 2),
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceSol, 15),
    score: numberOrNull(payload.score, 2),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(payload.buyRatio, 4),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    uniqueBuyerRatio: numberOrNull(payload.uniqueBuyerRatio, 4)
  };
}

async function readTelemetry(filePath, targetReasons) {
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

    const decision = decisionFromEvent(event, targetReasons);
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

function matchesProfile(decision, profile) {
  const allowedReasons = Array.isArray(profile.allowedReasons) ? new Set(profile.allowedReasons) : null;
  const scoreGap = Number(decision.scoreThreshold) - Number(decision.score);
  return (!allowedReasons || allowedReasons.has(decision.reason))
    && Number(decision.score) >= profile.minScore
    && (!Number.isFinite(Number(profile.minScoreThreshold)) || Number(decision.scoreThreshold) >= Number(profile.minScoreThreshold))
    && (!Number.isFinite(Number(profile.maxScoreGap)) || (Number.isFinite(scoreGap) && scoreGap >= 0 && scoreGap <= Number(profile.maxScoreGap)))
    && Number(decision.curveProgress) >= profile.minCurveProgress
    && Number(decision.recentVolumeSol || 0) >= profile.minRecentVolumeSol
    && Number(decision.tradeVelocityPerMin || 0) >= profile.minTradeVelocityPerMin;
}

function firstDecisionPerRunMint(runs, profile) {
  const selected = new Map();
  for (const run of runs) {
    for (const decision of run.decisions) {
      if (!matchesProfile(decision, profile)) continue;
      const key = `${run.telemetryPath}::${decision.mint}`;
      if (!selected.has(key)) selected.set(key, { run, decision });
    }
  }
  return Array.from(selected.values());
}

function closeTrade(decision, snapshot, reason, profile, netReturnPct) {
  return {
    telemetryPath: decision.telemetryPath,
    mint: decision.mint,
    symbol: decision.symbol,
    entryAt: decision.at,
    exitAt: snapshot?.at || null,
    reasonAtEntry: decision.reason,
    reasonsAtEntry: [decision.reason],
    presetAtEntry: decision.preset,
    entryCurveProgress: decision.curveProgress,
    exitCurveProgress: snapshot?.curveProgress ?? null,
    entryPriceSol: decision.priceSol,
    exitPriceSol: snapshot?.priceSol ?? null,
    score: decision.score,
    scoreThreshold: decision.scoreThreshold,
    scoreGap: Number.isFinite(Number(decision.scoreThreshold) - Number(decision.score))
      ? numberOrNull(Number(decision.scoreThreshold) - Number(decision.score), 4)
      : null,
    recentVolumeSol: decision.recentVolumeSol,
    tradeVelocityPerMin: decision.tradeVelocityPerMin,
    buyRatio: decision.buyRatio,
    uniqueBuyerCount: decision.uniqueBuyerCount,
    holdSeconds: snapshot ? numberOrNull((snapshot.atMs - decision.atMs) / 1000, 2) : null,
    exitReason: reason,
    grossReturnPct: snapshot ? numberOrNull(((Number(snapshot.priceSol) / Number(decision.priceSol)) - 1) * 100, 4) : null,
    netReturnPct: numberOrNull(netReturnPct * 100, 4),
    pnlSol: numberOrNull(profile.amountSol * netReturnPct, 9)
  };
}

function simulateTrade(run, decision, profile) {
  const snapshots = (run.snapshotsByMint.get(decision.mint) || [])
    .filter((snapshot) => snapshot.atMs > decision.atMs && snapshot.atMs <= decision.atMs + profile.maxHoldSeconds * 1000);
  if (!snapshots.length) return closeTrade(decision, null, 'NO_FUTURE_SNAPSHOTS', profile, 0);

  const entryFill = Number(decision.priceSol) * (1 + profile.entrySlippagePct / 100);
  let last = snapshots[snapshots.length - 1];
  for (const snapshot of snapshots) {
    const exitFill = Number(snapshot.priceSol) * (1 - profile.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    if (netReturn >= profile.takeProfitPct) return closeTrade(decision, snapshot, 'TAKE_PROFIT', profile, netReturn);
    if (netReturn <= -profile.stopLossPct) return closeTrade(decision, snapshot, 'STOP_LOSS', profile, netReturn);
    last = snapshot;
  }
  const exitFill = Number(last.priceSol) * (1 - profile.exitSlippagePct / 100);
  const netReturn = (exitFill / entryFill) - 1;
  return closeTrade(decision, last, 'MAX_HOLD', profile, netReturn);
}

function profileWithBase(profile) {
  return { ...BASE_TRADE, ...profile };
}

function aggregateTrades(trades) {
  const closed = trades.filter((trade) => trade.exitReason !== 'NO_FUTURE_SNAPSHOTS');
  const wins = closed.filter((trade) => Number(trade.pnlSol) > 0);
  const losses = closed.filter((trade) => Number(trade.pnlSol) < 0);
  const totalPnlSol = closed.reduce((total, trade) => total + Number(trade.pnlSol || 0), 0);
  const crosses90 = trades.filter((trade) => Number(trade.exitCurveProgress) >= 0.9);
  return {
    trades: trades.length,
    closed: closed.length,
    noFutureSnapshots: trades.length - closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? numberOrNull(wins.length / closed.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    averagePnlSol: closed.length ? numberOrNull(totalPnlSol / closed.length, 9) : null,
    averageNetReturnPct: closed.length ? numberOrNull(closed.reduce((total, trade) => total + Number(trade.netReturnPct || 0), 0) / closed.length, 4) : null,
    exitReasonCounts: countBy(trades, (trade) => trade.exitReason),
    crossed90ByExit: crosses90.length,
    uniqueMints: new Set(trades.map((trade) => trade.mint)).size,
    pnlStats: stat(closed.map((trade) => trade.pnlSol), 9),
    netReturnPctStats: stat(closed.map((trade) => trade.netReturnPct), 4)
  };
}

function buildReport(runs, options = {}) {
  const targetReasons = Array.from(options.targetReasons || DEFAULT_TARGET_REASONS).sort();
  const profiles = {};
  for (const [name, rawProfile] of Object.entries(PROFILES)) {
    if (Array.isArray(rawProfile.allowedReasons)) {
      const hasTargetOverlap = rawProfile.allowedReasons.some((reason) => targetReasons.includes(reason));
      if (!hasTargetOverlap) continue;
    }
    const profile = profileWithBase(rawProfile);
    const candidates = firstDecisionPerRunMint(runs, profile);
    const trades = candidates.map(({ run, decision }) => simulateTrade(run, decision, profile));
    const sortedByPnl = trades.slice().sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0));
    profiles[name] = {
      profile,
      summary: aggregateTrades(trades),
      topWinners: sortedByPnl.slice(0, 10),
      topLosers: sortedByPnl.slice(-10).reverse(),
      trades
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    note: options.note || 'Shadow-only relaxed-gate replay over LOW_SCORE/FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE skips. It selects the first matching decision per telemetry run + mint, then replays TP/SL/max-hold exits from later provider snapshots. It does not alter runtime gates.',
    inputs: {
      telemetryFilesRead: runs.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      malformedLines: runs.reduce((total, run) => total + run.malformedLines, 0),
      targetReasons,
      baseTrade: BASE_TRADE
    },
    profiles,
    ranking: Object.entries(profiles)
      .map(([name, report]) => ({ name, ...report.summary }))
      .sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0))
  };
}

function parseTargetReasons(value) {
  return String(value || DEFAULT_TARGET_REASONS.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function runReport(options = {}) {
  const args = options.args || {};
  const maxFiles = Number.isFinite(Number(args.limit)) ? Number(args.limit) : DEFAULT_MAX_FILES;
  const targetReasonList = options.targetReasons || parseTargetReasons(args.targetReasons || process.env.PRE_MIGRATION_RELAXED_TARGET_REASONS);
  const targetReasons = new Set(targetReasonList);
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((entry) => repoPath(entry.trim())).filter((filePath) => filePath && fs.existsSync(filePath))
    : telemetryFiles(maxFiles);
  const outputPath = options.outputPath || (args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH);
  if (!files.length) throw new Error('No telemetry files found.');

  const runs = [];
  for (const filePath of files) runs.push(await readTelemetry(filePath, targetReasons));
  const report = buildReport(runs, {
    targetReasons: targetReasonList,
    note: options.note
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('Pre-Migration Relaxed-Gate Replay');
  console.log(`Telemetry files read: ${report.inputs.telemetryFilesRead}`);
  for (const row of report.ranking) {
    console.log(`${row.name}: trades=${row.trades}, wins=${row.wins}, losses=${row.losses}, winRate=${row.winRate ?? 'n/a'}, pnl=${row.totalPnlSol} SOL`);
  }
  console.log(`Wrote JSON report: ${outputPath}`);
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await runReport({ args });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  parseArgs,
  runReport
};
