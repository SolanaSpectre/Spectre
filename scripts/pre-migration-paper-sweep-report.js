const path = require('path');

const {
  DEFAULT_LOG_DIR,
  DEFAULT_STRATEGY,
  buildReport,
  compact,
  parseArgs,
  readJsonl,
  resolveLatestTelemetry,
  resolveRepoPath,
  writeJson
} = require('./pre-migration-paper-sim-report');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'pre-migration-paper-sweep-latest.json');

const DEFAULT_SWEEP = {
  minScores: [75, 80, 85, 90],
  minCurveProgresses: [0.70, 0.75, 0.80, 0.85, 0.90],
  takeProfitPcts: [0.35, 0.50, 0.75],
  stopLossPcts: [0.15, 0.20, 0.25],
  maxHoldSeconds: [300, 600],
  // [0] keeps the default grid identical to every sweep run before 2026-08-04. Explore with
  // --proveBy 0,30,45,60 --proveMin 0.05,0.10 to test the time-boxed profit requirement.
  proveBySeconds: [0],
  proveMinReturnPcts: [0.10],
  minRecentVolumeSol: [25],
  minTradeVelocityPerMin: [25],
  amountSol: DEFAULT_STRATEGY.amountSol,
  minTradesForViable: 3
};

function parseList(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = String(value)
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  return parsed.length > 0 ? parsed : fallback;
}

function sweepFromArgs(args) {
  return {
    minScores: parseList(args.scores, DEFAULT_SWEEP.minScores),
    minCurveProgresses: parseList(args.curves, DEFAULT_SWEEP.minCurveProgresses),
    takeProfitPcts: parseList(args.takeProfits, DEFAULT_SWEEP.takeProfitPcts),
    stopLossPcts: parseList(args.stopLosses, DEFAULT_SWEEP.stopLossPcts),
    maxHoldSeconds: parseList(args.maxHolds, DEFAULT_SWEEP.maxHoldSeconds),
    proveBySeconds: parseList(args.proveBy, DEFAULT_SWEEP.proveBySeconds),
    proveMinReturnPcts: parseList(args.proveMin, DEFAULT_SWEEP.proveMinReturnPcts),
    minRecentVolumeSol: parseList(args.volumes, DEFAULT_SWEEP.minRecentVolumeSol),
    minTradeVelocityPerMin: parseList(args.velocities, DEFAULT_SWEEP.minTradeVelocityPerMin),
    amountSol: Number.isFinite(Number(args.amount)) ? Number(args.amount) : DEFAULT_SWEEP.amountSol,
    minTradesForViable: Number.isFinite(Number(args.minTrades)) ? Number(args.minTrades) : DEFAULT_SWEEP.minTradesForViable
  };
}

function buildStrategies(sweep) {
  const strategies = [];

  for (const minScore of sweep.minScores) {
    for (const minCurveProgress of sweep.minCurveProgresses) {
      for (const minRecentVolumeSol of sweep.minRecentVolumeSol) {
        for (const minTradeVelocityPerMin of sweep.minTradeVelocityPerMin) {
          for (const takeProfitPct of sweep.takeProfitPcts) {
            for (const stopLossPct of sweep.stopLossPcts) {
              for (const maxHoldSeconds of sweep.maxHoldSeconds) {
                for (const proveBySeconds of sweep.proveBySeconds) {
                  for (const proveMinReturnPct of sweep.proveMinReturnPcts) {
                    strategies.push({
                      minScore,
                      minCurveProgress,
                      minRecentVolumeSol,
                      minTradeVelocityPerMin,
                      takeProfitPct,
                      stopLossPct,
                      maxHoldSeconds,
                      proveBySeconds,
                      proveMinReturnPct,
                      amountSol: sweep.amountSol
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return strategies;
}

function summarizeReport(report, index) {
  const trades = report.simulatedTrades || [];
  const closedTrades = trades.filter((trade) => trade.exitAt);
  const worstTrade = [...closedTrades].sort((a, b) => Number(a.pnlSol || 0) - Number(b.pnlSol || 0))[0] || null;
  const bestTrade = [...closedTrades].sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0))[0] || null;
  const totalPnlSol = Number(report.summary.totalPnlSol || 0);
  const closedCount = Number(report.summary.closedTrades || 0);
  const losses = Number(report.summary.losses || 0);
  const wins = Number(report.summary.wins || 0);
  const lossRate = closedCount > 0 ? losses / closedCount : null;
  const expectancySol = closedCount > 0 ? totalPnlSol / closedCount : null;
  const worstPnlSol = worstTrade ? Number(worstTrade.pnlSol || 0) : 0;
  const qualityScore = totalPnlSol + (expectancySol || 0) - Math.abs(Math.min(0, worstPnlSol)) * 0.15;

  return {
    index,
    strategy: report.strategy,
    summary: {
      ...report.summary,
      totalPnlSol: compact(totalPnlSol, 9),
      expectancySol: compact(expectancySol, 9),
      lossRate: lossRate === null ? null : compact(lossRate, 4),
      qualityScore: compact(qualityScore, 9),
      worstTradePnlSol: compact(worstPnlSol, 9),
      bestTradePnlSol: bestTrade ? compact(bestTrade.pnlSol, 9) : null
    },
    bestTrade: bestTrade ? {
      symbol: bestTrade.symbol,
      mint: bestTrade.mint,
      pnlSol: bestTrade.pnlSol,
      returnPct: bestTrade.returnPct,
      exitReason: bestTrade.exitReason,
      holdSeconds: bestTrade.holdSeconds,
      curve: `${bestTrade.entryCurveProgress}->${bestTrade.exitCurveProgress}`
    } : null,
    worstTrade: worstTrade ? {
      symbol: worstTrade.symbol,
      mint: worstTrade.mint,
      pnlSol: worstTrade.pnlSol,
      returnPct: worstTrade.returnPct,
      exitReason: worstTrade.exitReason,
      holdSeconds: worstTrade.holdSeconds,
      curve: `${worstTrade.entryCurveProgress}->${worstTrade.exitCurveProgress}`
    } : null,
    topTrades: trades.slice(0, 5).map((trade) => ({
      symbol: trade.symbol,
      mint: trade.mint,
      pnlSol: trade.pnlSol,
      returnPct: trade.returnPct,
      exitReason: trade.exitReason,
      holdSeconds: trade.holdSeconds,
      curve: `${trade.entryCurveProgress}->${trade.exitCurveProgress}`
    }))
  };
}

function compareByPnl(a, b) {
  return Number(b.summary.totalPnlSol || 0) - Number(a.summary.totalPnlSol || 0)
    || Number(b.summary.expectancySol || 0) - Number(a.summary.expectancySol || 0)
    || Number(b.summary.closedTrades || 0) - Number(a.summary.closedTrades || 0);
}

function compareByQuality(a, b) {
  return Number(b.summary.qualityScore || 0) - Number(a.summary.qualityScore || 0)
    || Number(b.summary.totalPnlSol || 0) - Number(a.summary.totalPnlSol || 0)
    || Number(b.summary.closedTrades || 0) - Number(a.summary.closedTrades || 0);
}

function buildSweepReport(events, telemetryPath, sweep) {
  const strategies = buildStrategies(sweep);
  const variants = strategies.map((strategy, index) => summarizeReport(buildReport(events, telemetryPath, strategy), index));
  const viable = variants.filter((variant) => Number(variant.summary.closedTrades || 0) >= sweep.minTradesForViable);
  const profitable = viable.filter((variant) => Number(variant.summary.totalPnlSol || 0) > 0);

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath,
    sweep,
    summary: {
      variantsTested: variants.length,
      viableVariants: viable.length,
      profitableViableVariants: profitable.length,
      bestPnlSol: viable.length > 0 ? compact(viable.slice().sort(compareByPnl)[0].summary.totalPnlSol, 9) : null,
      bestQualityScore: viable.length > 0 ? compact(viable.slice().sort(compareByQuality)[0].summary.qualityScore, 9) : null
    },
    bestByPnl: viable.slice().sort(compareByPnl).slice(0, 20),
    bestByQuality: viable.slice().sort(compareByQuality).slice(0, 20),
    allVariants: variants.sort(compareByPnl)
  };
}

function describeStrategy(strategy) {
  return `score>=${strategy.minScore}, curve>=${strategy.minCurveProgress}, TP=${strategy.takeProfitPct}, SL=${strategy.stopLossPct}, hold=${strategy.maxHoldSeconds}s`;
}

function printSweepReport(report) {
  console.log('Pre-Migration Paper Sweep Report');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Variants tested: ${report.summary.variantsTested}, viable=${report.summary.viableVariants}, profitable=${report.summary.profitableViableVariants}`);

  if (report.bestByPnl.length === 0) {
    console.log('No viable variants found. Lower --minTrades or run a longer paper session.');
    return;
  }

  console.log('');
  console.log('Top Variants By PnL:');
  report.bestByPnl.slice(0, 10).forEach((variant, index) => {
    console.log(`${index + 1}. ${describeStrategy(variant.strategy)} | trades=${variant.summary.closedTrades}, wins=${variant.summary.wins}, losses=${variant.summary.losses}, winRate=${variant.summary.winRate ?? 'n/a'}, pnl=${variant.summary.totalPnlSol} SOL, exp=${variant.summary.expectancySol} SOL`);
  });

  console.log('');
  console.log('Top Variants By Quality Score:');
  report.bestByQuality.slice(0, 5).forEach((variant, index) => {
    console.log(`${index + 1}. ${describeStrategy(variant.strategy)} | quality=${variant.summary.qualityScore}, pnl=${variant.summary.totalPnlSol} SOL, worst=${variant.summary.worstTradePnlSol} SOL, trades=${variant.summary.closedTrades}`);
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveRepoPath(args.telemetry) || resolveLatestTelemetry(DEFAULT_LOG_DIR);
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;
  const sweep = sweepFromArgs(args);

  if (!telemetryPath) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  const events = readJsonl(telemetryPath);
  const report = buildSweepReport(events, telemetryPath, sweep);
  writeJson(outputPath, report);
  printSweepReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main();
}
