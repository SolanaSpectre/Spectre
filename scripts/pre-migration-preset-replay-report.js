const fs = require('fs');
const path = require('path');

const {
  DEFAULT_LOG_DIR,
  buildReport,
  compact,
  parseArgs,
  readJsonl,
  resolveRepoPath,
  writeJson
} = require('./pre-migration-paper-sim-report');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'pre-migration-preset-replay-latest.json');

const PRESETS = {
  baseline: {
    minScore: 75,
    minCurveProgress: 0.70,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.50,
    stopLossPct: 0.25,
    maxHoldSeconds: 600,
    amountSol: 0.1
  },
  highConfidence: {
    minScore: 85,
    minCurveProgress: 0.70,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  highConfidenceRunner: {
    minScore: 85,
    minCurveProgress: 0.75,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.50,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  strictMigration: {
    minScore: 85,
    minCurveProgress: 0.85,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  }
};

function resolveTelemetryFiles(args) {
  if (args.telemetry) {
    return String(args.telemetry)
      .split(',')
      .map((entry) => resolveRepoPath(entry.trim()))
      .filter(Boolean)
      .filter((filePath) => fs.existsSync(filePath));
  }

  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 4;
  return fs.readdirSync(DEFAULT_LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(DEFAULT_LOG_DIR, name);
      return { fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit)
    .map((entry) => entry.fullPath)
    .reverse();
}

function selectedPresets(args) {
  if (!args.presets) return PRESETS;

  const names = String(args.presets)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return names.reduce((accumulator, name) => {
    if (PRESETS[name]) accumulator[name] = PRESETS[name];
    return accumulator;
  }, {});
}

function summarizeRun(report) {
  return {
    telemetryPath: report.telemetryPath,
    runDurationMinutes: report.run.runDurationMinutes,
    priceEligibleFlagEvents: report.summary.priceEligibleFlagEvents,
    simulatedTrades: report.summary.simulatedTrades,
    closedTrades: report.summary.closedTrades,
    wins: report.summary.wins,
    losses: report.summary.losses,
    winRate: report.summary.winRate,
    totalPnlSol: report.summary.totalPnlSol,
    averagePnlSol: report.summary.averagePnlSol,
    exitReasonCounts: report.summary.exitReasonCounts,
    bestTrade: report.topWinners[0] ? {
      symbol: report.topWinners[0].symbol,
      mint: report.topWinners[0].mint,
      pnlSol: report.topWinners[0].pnlSol,
      returnPct: report.topWinners[0].returnPct,
      exitReason: report.topWinners[0].exitReason,
      holdSeconds: report.topWinners[0].holdSeconds
    } : null,
    worstTrade: report.topLosers[0] ? {
      symbol: report.topLosers[0].symbol,
      mint: report.topLosers[0].mint,
      pnlSol: report.topLosers[0].pnlSol,
      returnPct: report.topLosers[0].returnPct,
      exitReason: report.topLosers[0].exitReason,
      holdSeconds: report.topLosers[0].holdSeconds
    } : null
  };
}

function aggregateRuns(runs) {
  const closedTrades = runs.reduce((total, run) => total + Number(run.closedTrades || 0), 0);
  const wins = runs.reduce((total, run) => total + Number(run.wins || 0), 0);
  const losses = runs.reduce((total, run) => total + Number(run.losses || 0), 0);
  const totalPnlSol = runs.reduce((total, run) => total + Number(run.totalPnlSol || 0), 0);
  const profitableRuns = runs.filter((run) => Number(run.totalPnlSol || 0) > 0).length;
  const runsWithTrades = runs.filter((run) => Number(run.closedTrades || 0) > 0).length;

  return {
    runs: runs.length,
    runsWithTrades,
    profitableRuns,
    closedTrades,
    wins,
    losses,
    winRate: closedTrades > 0 ? compact(wins / closedTrades, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    averagePnlPerRunSol: runs.length > 0 ? compact(totalPnlSol / runs.length, 9) : null,
    averagePnlPerTradeSol: closedTrades > 0 ? compact(totalPnlSol / closedTrades, 9) : null
  };
}

function buildReplayReport(telemetryFiles, presets) {
  const presetReports = {};

  for (const [presetName, strategy] of Object.entries(presets)) {
    const runs = telemetryFiles.map((telemetryPath) => {
      const report = buildReport(readJsonl(telemetryPath), telemetryPath, strategy);
      return summarizeRun(report);
    });

    presetReports[presetName] = {
      strategy,
      aggregate: aggregateRuns(runs),
      runs
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    telemetryFiles,
    presets: presetReports,
    ranking: Object.entries(presetReports)
      .map(([name, report]) => ({ name, ...report.aggregate }))
      .sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0))
  };
}

function describeStrategy(strategy) {
  return `score>=${strategy.minScore}, curve>=${strategy.minCurveProgress}, TP=${strategy.takeProfitPct}, SL=${strategy.stopLossPct}, hold=${strategy.maxHoldSeconds}s`;
}

function printReplayReport(report) {
  console.log('Pre-Migration Preset Replay Report');
  console.log(`Telemetry files: ${report.telemetryFiles.length}`);

  console.log('');
  console.log('Preset Ranking:');
  report.ranking.forEach((entry, index) => {
    const strategy = report.presets[entry.name].strategy;
    console.log(`${index + 1}. ${entry.name} | ${describeStrategy(strategy)} | runs=${entry.runs}, trades=${entry.closedTrades}, wins=${entry.wins}, losses=${entry.losses}, winRate=${entry.winRate ?? 'n/a'}, pnl=${entry.totalPnlSol} SOL`);
  });

  console.log('');
  console.log('Run Breakdown:');
  for (const [presetName, presetReport] of Object.entries(report.presets)) {
    console.log(`${presetName}:`);
    presetReport.runs.forEach((run) => {
      console.log(`  ${path.basename(run.telemetryPath)} | trades=${run.closedTrades}, wins=${run.wins}, losses=${run.losses}, pnl=${run.totalPnlSol} SOL`);
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryFiles = resolveTelemetryFiles(args);
  const presets = selectedPresets(args);
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;

  if (telemetryFiles.length === 0) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run paper sessions first.');
    process.exit(1);
  }

  if (Object.keys(presets).length === 0) {
    console.error(`No valid presets selected. Available presets: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
  }

  const report = buildReplayReport(telemetryFiles, presets);
  writeJson(outputPath, report);
  printReplayReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main();
}
