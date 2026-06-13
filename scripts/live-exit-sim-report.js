const fs = require('fs');
const path = require('path');
const { readJsonl } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DOSSIER_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'live-exit-sim-latest.json');

const DEFAULT_PROFILE = {
  profileName: 'live_default',
  stopLossPercent: 0.015,
  takeProfitPercent: 0.035,
  trailingActivationPercent: 0.006,
  trailingDrawdownPercent: 0.008,
  breakevenActivationPercent: 0.012,
  breakevenStopPercent: 0.001,
  minProfitHoldSeconds: 45,
  maxHoldMinutes: 20
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

function resolveRepoPath(filePath, fallback = null) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function listRecentFiles(dir, prefix, limit) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function presetToPrimaryStrategy(preset) {
  switch (preset) {
    case 'earlyAccelerationRunner':
      return 'SCALPER';
    case 'highConvictionFirstSight':
      return 'SNIPER';
    case 'strictMigration':
    case 'highConfidenceRunner':
    default:
      return 'RUNNER_HUNTER';
  }
}

function buildLiveExitProfile({ primaryStrategy, exitStyle = 'fixed', expectedHold = 'short' } = {}) {
  const baseProfile = { ...DEFAULT_PROFILE };

  switch (primaryStrategy || 'SNIPER') {
    case 'RUNNER_HUNTER':
      return {
        ...baseProfile,
        profileName: 'runner_breakout_live_smart_trade',
        stopLossPercent: Math.max(baseProfile.stopLossPercent, 0.022),
        takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.08),
        trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.035),
        trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.014),
        breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.025),
        breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.002),
        minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 45),
        maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 18)
      };
    case 'SCALPER':
      return {
        ...baseProfile,
        profileName: 'scalper_micro_live_smart_trade',
        stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.009),
        takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.018),
        trailingActivationPercent: Math.min(baseProfile.trailingActivationPercent, 0.009),
        trailingDrawdownPercent: Math.min(baseProfile.trailingDrawdownPercent, 0.0045),
        breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.012),
        breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
        minProfitHoldSeconds: Math.min(baseProfile.minProfitHoldSeconds, 15),
        maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 4)
      };
    case 'SNIPER':
      return {
        ...baseProfile,
        profileName: 'sniper_tight_live_smart_trade',
        stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.01),
        takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.02),
        trailingActivationPercent: Math.min(baseProfile.trailingActivationPercent, 0.015),
        trailingDrawdownPercent: Math.min(baseProfile.trailingDrawdownPercent, 0.006),
        breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.012),
        breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
        minProfitHoldSeconds: Math.min(baseProfile.minProfitHoldSeconds, 30),
        maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 6)
      };
    default:
      break;
  }

  if (exitStyle === 'trailing_runner') {
    return {
      ...baseProfile,
      profileName: 'trailing_runner_live_smart_trade',
      takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.04),
      trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.02),
      trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.008),
      breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.02),
      maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, expectedHold === 'short_to_medium' ? 12 : baseProfile.maxHoldMinutes)
    };
  }

  if (exitStyle === 'tight_invalidation') {
    return {
      ...baseProfile,
      profileName: 'tight_invalidation_live_smart_trade',
      stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.01),
      takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.02),
      maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 6)
    };
  }

  return baseProfile;
}

function simulateExit(trade) {
  const profile = buildLiveExitProfile({
    primaryStrategy: trade.primaryStrategy,
    exitStyle: trade.exitStyle,
    expectedHold: trade.expectedHold
  });
  const returnPct = Number(trade.returnPct || 0);
  const peakReturnPct = Number.isFinite(Number(trade.peakReturnPct))
    ? Number(trade.peakReturnPct)
    : Math.max(returnPct, 0);
  const holdSeconds = Number(trade.holdSeconds || 0);

  let reason = null;
  if (returnPct <= -profile.stopLossPercent) {
    reason = 'STOP_LOSS';
  } else if (
    peakReturnPct >= profile.trailingActivationPercent &&
    peakReturnPct - returnPct >= profile.trailingDrawdownPercent &&
    holdSeconds >= profile.minProfitHoldSeconds
  ) {
    reason = 'TRAILING_TAKE_PROFIT';
  } else if (
    peakReturnPct >= profile.breakevenActivationPercent &&
    returnPct <= profile.breakevenStopPercent &&
    holdSeconds >= profile.minProfitHoldSeconds
  ) {
    reason = 'BREAKEVEN_STOP';
  } else if (returnPct >= profile.takeProfitPercent) {
    reason = 'TAKE_PROFIT';
  } else if (holdSeconds >= profile.maxHoldMinutes * 60) {
    reason = 'TIME_EXIT';
  }

  return {
    ...trade,
    liveExitProfile: profile,
    simulatedExitReason: reason,
    wouldExit: Boolean(reason),
    reasonMatchesPaper: reason === trade.paperExitReason,
    protectedByStop: reason === 'STOP_LOSS' && returnPct < 0,
    wouldLetWinnerRun: trade.paperExitReason === 'TAKE_PROFIT' && reason !== 'TAKE_PROFIT',
    unprotectedAtObservedExit: !reason && returnPct < 0
  };
}

function collectPreMigrationPaperTrades(dossierDir, limit) {
  const files = listRecentFiles(dossierDir, 'candidate-dossiers-', limit);
  const entriesByKey = new Map();
  const trades = [];
  const unmatchedExits = [];

  for (const filePath of [...files].reverse()) {
    for (const row of readJsonl(filePath)) {
      if (row.source !== 'pre_migration_paper') continue;
      const mint = row.identity?.mint;
      const preset = row.paper?.preset || 'unknown';
      const key = `${mint || 'unknown'}::${preset}`;

      if (row.eventType === 'pre_migration_paper.entry') {
        const entries = entriesByKey.get(key) || [];
        entries.push({ ...row, __file: filePath });
        entriesByKey.set(key, entries);
        continue;
      }

      if (row.eventType !== 'pre_migration_paper.exit') continue;
      const entries = entriesByKey.get(key) || [];
      const entry = entries.shift();
      if (!entry) {
        unmatchedExits.push({ ...row, __file: filePath });
        continue;
      }

      const paper = row.paper || {};
      const entryPaper = entry.paper || {};
      const primaryStrategy = presetToPrimaryStrategy(preset);
      trades.push({
        source: 'pre_migration_paper_dossier',
        mint,
        symbol: row.identity?.symbol || entry.identity?.symbol || null,
        preset,
        primaryStrategy,
        enteredAt: entry.timestamp || null,
        exitedAt: row.timestamp || null,
        entryPriceSol: compact(entryPaper.entryPriceSol, 15),
        exitPriceSol: compact(paper.exitPriceSol, 15),
        amountSol: compact(paper.amountSol ?? entryPaper.amountSol, 6),
        returnPct: compact(paper.returnPct, 6),
        pnlSol: compact(paper.pnlSol, 9),
        holdSeconds: compact(paper.holdSeconds, 2),
        paperExitReason: paper.reason || null,
        peakReturnPct: compact(paper.peakReturnPct, 6),
        score: compact(entry.gmgnStyle?.score ?? row.gmgnStyle?.score, 2),
        curveProgress: compact(entry.curve?.progress, 6),
        maxCurveProgress: compact(paper.maxCurveProgress, 6),
        file: filePath
      });
    }
  }

  return { trades, unmatchedExits: unmatchedExits.length, files };
}

function buildReport({ dossierDir, dossierLimit }) {
  const collected = collectPreMigrationPaperTrades(dossierDir, dossierLimit);
  const simulated = collected.trades.map(simulateExit);
  const closed = simulated.filter((trade) => Number.isFinite(Number(trade.returnPct)));
  const wouldExit = closed.filter((trade) => trade.wouldExit);
  const unprotected = closed.filter((trade) => trade.unprotectedAtObservedExit);
  const winners = closed.filter((trade) => Number(trade.returnPct) > 0);
  const losers = closed.filter((trade) => Number(trade.returnPct) < 0);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_live_exit_sim',
    safety: {
      sendsTransactions: false,
      requiresWallet: false,
      source: 'historical_paper_dossiers'
    },
    inputs: {
      dossierDir,
      dossierFilesScanned: collected.files.length,
      unmatchedExits: collected.unmatchedExits
    },
    summary: {
      trades: closed.length,
      winners: winners.length,
      losers: losers.length,
      wouldExit: wouldExit.length,
      wouldExitRate: compact(closed.length > 0 ? wouldExit.length / closed.length : null, 4),
      unprotectedAtObservedExit: unprotected.length,
      simulatedReasons: countBy(wouldExit, (trade) => trade.simulatedExitReason),
      paperReasons: countBy(closed, (trade) => trade.paperExitReason),
      profiles: countBy(closed, (trade) => trade.liveExitProfile?.profileName),
      presets: countBy(closed, (trade) => trade.preset)
    },
    riskReview: {
      unprotectedLosers: unprotected
        .sort((a, b) => Number(a.returnPct || 0) - Number(b.returnPct || 0))
        .slice(0, 20),
      largestLosses: [...closed]
        .sort((a, b) => Number(a.returnPct || 0) - Number(b.returnPct || 0))
        .slice(0, 20),
      bestWinnersLiveWouldNotTake: winners
        .filter((trade) => !trade.wouldExit)
        .sort((a, b) => Number(b.returnPct || 0) - Number(a.returnPct || 0))
        .slice(0, 20)
    },
    simulatedTrades: simulated
  };
}

function printReport(report) {
  console.log('Live Exit Simulation Report');
  console.log('===========================');
  console.log(`Mode: ${report.mode} (no transactions)`);
  console.log(`Dossier files scanned: ${report.inputs.dossierFilesScanned}`);
  console.log(`Trades replayed: ${report.summary.trades}`);
  console.log(`Would exit: ${report.summary.wouldExit} (${report.summary.wouldExitRate ?? 'n/a'})`);
  console.log(`Unprotected losers at observed exit: ${report.summary.unprotectedAtObservedExit}`);
  console.log(`Simulated reasons: ${Object.entries(report.summary.simulatedReasons).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
  console.log(`Profiles: ${Object.entries(report.summary.profiles).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);

  if (report.riskReview.unprotectedLosers.length > 0) {
    console.log('');
    console.log('Worst Unprotected Losers:');
    for (const trade of report.riskReview.unprotectedLosers.slice(0, 8)) {
      console.log(`  ${trade.symbol || trade.mint} ${trade.preset}: return=${trade.returnPct} paper=${trade.paperExitReason || 'n/a'} profile=${trade.liveExitProfile.profileName}`);
      console.log(`    ${trade.mint}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dossierDir = resolveRepoPath(args.dossierDir, DEFAULT_DOSSIER_DIR);
  const outputPath = resolveRepoPath(args.output, DEFAULT_OUTPUT_PATH);
  const dossierLimit = Number(args.limit || 100);

  const report = buildReport({ dossierDir, dossierLimit });
  writeJson(outputPath, report);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = {
  DEFAULT_DOSSIER_DIR,
  DEFAULT_OUTPUT_PATH,
  parseArgs,
  resolveRepoPath,
  buildLiveExitProfile,
  simulateExit,
  collectPreMigrationPaperTrades,
  buildReport,
  printReport
};

if (require.main === module) {
  main();
}
