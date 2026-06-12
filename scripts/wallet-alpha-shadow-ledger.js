const fs = require('fs');
const path = require('path');
const { readJsonlSync } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_WALLET_ALPHA_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-alpha-replay-latest.json');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'wallet-alpha-shadow');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-alpha-shadow-latest.json');

const DEFAULT_STRATEGY = {
  amountSol: 0.1,
  takeProfitPct: 0.5,
  stopLossPct: 0.25,
  maxHoldSeconds: 300,
  maxTelemetryFiles: 120
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

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function secondsBetween(startIso, endIso) {
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return (endMs - startMs) / 1000;
}

function listRecentTelemetryFiles(logDir, limit) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const filePath = path.join(logDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function readJsonl(filePath) {
  return readJsonlSync(filePath);
}

function getPrice(payload = {}) {
  const candidates = [
    payload.priceSol,
    payload.bondingCurvePriceSol,
    payload.curvePriceSol,
    payload.entryPriceSol,
    payload.exitPriceSol
  ];

  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return null;
}

function getScore(payload = {}) {
  const numeric = Number(payload.score);
  return Number.isFinite(numeric) ? numeric : null;
}

function indexTelemetryByMint(logDir, mints, maxFiles) {
  const wanted = new Set(mints);
  const byMint = new Map();
  const files = listRecentTelemetryFiles(logDir, maxFiles);

  for (const filePath of files.reverse()) {
    for (const row of readJsonl(filePath)) {
      const payload = row.payload || {};
      const mint = payload.mint || payload.token;
      if (!mint || !wanted.has(mint)) continue;

      const price = getPrice(payload);
      const score = getScore(payload);
      const curveProgress = Number(payload.curveProgress);
      if (price === null && score === null && !Number.isFinite(curveProgress)) continue;

      if (!byMint.has(mint)) byMint.set(mint, []);
      byMint.get(mint).push({
        timestamp: row.timestamp || payload.timestamp,
        type: row.type,
        priceSol: price,
        score,
        curveProgress: Number.isFinite(curveProgress) ? curveProgress : null,
        recentVolumeSol: compact(payload.recentVolumeSol, 6),
        tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 4),
        decision: payload.decision || null,
        reason: payload.reason || null,
        preset: payload.preset || null,
        file: path.basename(filePath)
      });
    }
  }

  for (const rows of byMint.values()) {
    rows.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  return { byMint, files };
}

function pickEntryScenario(replay) {
  return asArray(replay.boostScenarios)
    .filter((scenario) => scenario.wouldCrossAnyThreshold)
    .sort((a, b) => Number(a.boost || 0) - Number(b.boost || 0))[0] || null;
}

function findEntryObservation(replay, observations, scenario) {
  if (!scenario) return null;
  const minThreshold = Math.min(...asArray(scenario.crossedLanes).map((lane) => {
    if (lane === 'early_acceleration') return 84.5;
    if (lane === 'strict_premigration') return 85;
    return 84;
  }));

  return observations.find((row) => (
    row.priceSol !== null
    && row.score !== null
    && (row.score + Number(scenario.boost || 0)) >= minThreshold
  )) || null;
}

function simulateExit(entry, observations, strategy) {
  const afterEntry = observations.filter((row) => (
    row.priceSol !== null
    && row.timestamp
    && new Date(row.timestamp).getTime() > new Date(entry.timestamp).getTime()
  ));

  if (afterEntry.length === 0) {
    return {
      status: 'NO_PRICE_AFTER_ENTRY',
      exit: null,
      maxReturnPct: 0,
      minReturnPct: 0,
      markedReturnPct: 0
    };
  }

  let maxReturnPct = -Infinity;
  let minReturnPct = Infinity;
  let latest = afterEntry[0];

  for (const row of afterEntry) {
    const holdSeconds = secondsBetween(entry.timestamp, row.timestamp);
    const returnPct = (row.priceSol - entry.priceSol) / entry.priceSol;
    maxReturnPct = Math.max(maxReturnPct, returnPct);
    minReturnPct = Math.min(minReturnPct, returnPct);
    latest = row;

    if (returnPct >= strategy.takeProfitPct) {
      return {
        status: 'CLOSED',
        exit: {
          reason: 'TAKE_PROFIT',
          timestamp: row.timestamp,
          priceSol: row.priceSol,
          returnPct: compact(returnPct, 6),
          pnlSol: compact(returnPct * strategy.amountSol, 9),
          holdSeconds: compact(holdSeconds, 2),
          curveProgress: compact(row.curveProgress, 6)
        },
        maxReturnPct: compact(maxReturnPct, 6),
        minReturnPct: compact(minReturnPct, 6),
        markedReturnPct: compact(returnPct, 6)
      };
    }

    if (returnPct <= -strategy.stopLossPct) {
      return {
        status: 'CLOSED',
        exit: {
          reason: 'STOP_LOSS',
          timestamp: row.timestamp,
          priceSol: row.priceSol,
          returnPct: compact(returnPct, 6),
          pnlSol: compact(returnPct * strategy.amountSol, 9),
          holdSeconds: compact(holdSeconds, 2),
          curveProgress: compact(row.curveProgress, 6)
        },
        maxReturnPct: compact(maxReturnPct, 6),
        minReturnPct: compact(minReturnPct, 6),
        markedReturnPct: compact(returnPct, 6)
      };
    }

    if (holdSeconds !== null && holdSeconds >= strategy.maxHoldSeconds) {
      return {
        status: 'CLOSED',
        exit: {
          reason: 'MAX_HOLD',
          timestamp: row.timestamp,
          priceSol: row.priceSol,
          returnPct: compact(returnPct, 6),
          pnlSol: compact(returnPct * strategy.amountSol, 9),
          holdSeconds: compact(holdSeconds, 2),
          curveProgress: compact(row.curveProgress, 6)
        },
        maxReturnPct: compact(maxReturnPct, 6),
        minReturnPct: compact(minReturnPct, 6),
        markedReturnPct: compact(returnPct, 6)
      };
    }
  }

  const markedReturnPct = (latest.priceSol - entry.priceSol) / entry.priceSol;
  return {
    status: 'MARKED_OPEN_OR_END_OF_DATA',
    exit: {
      reason: 'END_OF_DATA',
      timestamp: latest.timestamp,
      priceSol: latest.priceSol,
      returnPct: compact(markedReturnPct, 6),
      pnlSol: compact(markedReturnPct * strategy.amountSol, 9),
      holdSeconds: compact(secondsBetween(entry.timestamp, latest.timestamp), 2),
      curveProgress: compact(latest.curveProgress, 6)
    },
    maxReturnPct: compact(maxReturnPct, 6),
    minReturnPct: compact(minReturnPct, 6),
    markedReturnPct: compact(markedReturnPct, 6)
  };
}

function buildShadowTrade(replay, observations, strategy) {
  const scenario = pickEntryScenario(replay);
  if (!scenario) {
    return {
      mint: replay.mint,
      symbol: replay.symbol || null,
      status: 'NO_THRESHOLD_CROSS',
      reason: 'No wallet boost scenario crossed a known entry threshold.'
    };
  }

  const entryObservation = findEntryObservation(replay, observations, scenario);
  if (!entryObservation) {
    return {
      mint: replay.mint,
      symbol: replay.symbol || null,
      status: 'NO_PRICEABLE_ENTRY',
      scenario,
      reason: 'No telemetry row had both a valid price and a boost-adjusted score crossing the threshold.'
    };
  }

  const exitSimulation = simulateExit(entryObservation, observations, strategy);
  return {
    mint: replay.mint,
    symbol: replay.symbol || null,
    status: exitSimulation.status,
    replayVerdict: replay.replayVerdict,
    walletRealizedPnl: replay.walletRealizedPnl,
    safetyFlags: replay.safetyFlags || [],
    scenario,
    entry: {
      timestamp: entryObservation.timestamp,
      type: entryObservation.type,
      priceSol: entryObservation.priceSol,
      rawScore: compact(entryObservation.score, 4),
      boostedScore: compact(entryObservation.score + Number(scenario.boost || 0), 4),
      curveProgress: compact(entryObservation.curveProgress, 6),
      recentVolumeSol: entryObservation.recentVolumeSol,
      tradeVelocityPerMin: entryObservation.tradeVelocityPerMin
    },
    exit: exitSimulation.exit,
    path: {
      maxReturnPct: exitSimulation.maxReturnPct,
      minReturnPct: exitSimulation.minReturnPct,
      markedReturnPct: exitSimulation.markedReturnPct,
      observations: observations.length
    }
  };
}

function buildReport(args = {}) {
  const strategy = {
    ...DEFAULT_STRATEGY,
    amountSol: Number(args.amount || DEFAULT_STRATEGY.amountSol),
    takeProfitPct: Number(args.takeProfit || DEFAULT_STRATEGY.takeProfitPct),
    stopLossPct: Number(args.stopLoss || DEFAULT_STRATEGY.stopLossPct),
    maxHoldSeconds: Number(args.maxHold || DEFAULT_STRATEGY.maxHoldSeconds),
    maxTelemetryFiles: Number(args.maxFiles || DEFAULT_STRATEGY.maxTelemetryFiles)
  };

  const walletAlphaPath = resolveRepoPath(args.walletAlpha, DEFAULT_WALLET_ALPHA_PATH);
  const logDir = resolveRepoPath(args.logDir, DEFAULT_LOG_DIR);
  const walletAlpha = readJson(walletAlphaPath, {});
  const candidates = asArray(walletAlpha.allReplays)
    .filter((item) => item.replayVerdict === 'wallet_boost_would_have_crossed_threshold'
      || item.replayVerdict === 'wallet_boost_crosses_threshold_but_avoid_caution');
  const { byMint, files } = indexTelemetryByMint(logDir, candidates.map((item) => item.mint), strategy.maxTelemetryFiles);
  const shadowTrades = candidates.map((candidate) => buildShadowTrade(
    candidate,
    byMint.get(candidate.mint) || [],
    strategy
  ));

  const closed = shadowTrades.filter((item) => item.exit);
  const wins = closed.filter((item) => Number(item.exit?.returnPct || 0) > 0);
  const losses = closed.filter((item) => Number(item.exit?.returnPct || 0) < 0);
  const pnlSol = closed.reduce((sum, item) => sum + Number(item.exit?.pnlSol || 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_alpha_shadow_ledger',
    caveat: 'Shadow entries are retrospective simulations only. They do not place trades and do not mutate strategy config.',
    inputs: {
      walletAlphaPath,
      walletAlphaGeneratedAt: walletAlpha.generatedAt || null,
      logDir,
      telemetryFilesRead: files.length
    },
    strategy,
    summary: {
      candidates: candidates.length,
      shadowTrades: shadowTrades.length,
      closedTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? compact(wins.length / closed.length, 4) : null,
      pnlSol: compact(pnlSol, 9),
      avgReturnPct: closed.length > 0
        ? compact(closed.reduce((sum, item) => sum + Number(item.exit?.returnPct || 0), 0) / closed.length, 6)
        : null
    },
    shadowTrades
  };
}

function printReport(report) {
  console.log('==========================');
  console.log('Wallet Alpha Shadow Ledger');
  console.log('==========================');
  console.log(`Candidates: ${report.summary.candidates}`);
  console.log(`Shadow trades: ${report.summary.shadowTrades}`);
  console.log(`Closed/marked: ${report.summary.closedTrades}`);
  console.log(`Wins/losses: ${report.summary.wins}/${report.summary.losses}`);
  console.log(`PnL: ${report.summary.pnlSol} SOL`);

  for (const trade of report.shadowTrades.slice(0, 10)) {
    const ret = trade.exit?.returnPct !== undefined ? `${compact(Number(trade.exit.returnPct) * 100, 2)}%` : 'n/a';
    console.log(
      `- ${trade.symbol || trade.mint} | ${trade.status} | entryScore=${trade.entry?.rawScore ?? 'n/a'} boost=${trade.scenario?.boost ?? 'n/a'} | exit=${trade.exit?.reason || trade.reason || 'n/a'} | ret=${ret}`
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latest, DEFAULT_LATEST_PATH);
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-alpha-shadow-${stamp}.json`);

  writeJson(reportPath, report);
  writeJson(latestPath, {
    ...report,
    files: {
      reportPath,
      latestPath
    }
  });

  printReport(report);
  console.log(`\nWrote wallet alpha shadow ledger: ${reportPath}`);
  console.log(`Wrote latest wallet alpha shadow ledger: ${latestPath}`);
}

main();
