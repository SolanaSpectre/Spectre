const fs = require('fs');
const path = require('path');

const {
  DEFAULT_LOG_DIR,
  compact,
  parseArgs,
  readReplayEventStream,
  resolveRepoPath,
  writeJson
} = require('./pre-migration-paper-sim-report');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'broad-organic-surge-replay-latest.json');

const VARIANTS = [
  {
    name: 'organic_score78_curve75_85_uniq80_snipers3_tp35_sl15',
    minScore: 78,
    maxScore: 85,
    minCurveProgress: 0.75,
    maxCurveProgress: 0.85,
    minUniqueBuyerRatio: 0.8,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  {
    name: 'organic_score80_curve75_85_uniq80_snipers3_tp35_sl15',
    minScore: 80,
    maxScore: 85,
    minCurveProgress: 0.75,
    maxCurveProgress: 0.85,
    minUniqueBuyerRatio: 0.8,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  {
    name: 'organic_score80_curve70_88_uniq80_snipers3_tp35_sl15',
    minScore: 80,
    maxScore: 85,
    minCurveProgress: 0.7,
    maxCurveProgress: 0.88,
    minUniqueBuyerRatio: 0.8,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  {
    name: 'organic_score82_curve75_88_delta035_uniq80_snipers3_tp35_sl15',
    minScore: 82,
    maxScore: 100,
    minCurveProgress: 0.75,
    maxCurveProgress: 0.88,
    minCurveProgressDelta: 0.035,
    minUniqueBuyerRatio: 0.8,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  {
    name: 'organic_score82_curve75_88_delta60s035_uniq80_snipers3_tp35_sl15',
    minScore: 82,
    maxScore: 100,
    minCurveProgress: 0.75,
    maxCurveProgress: 0.88,
    minCurveProgressDelta60s: 0.035,
    minUniqueBuyerRatio: 0.8,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  {
    name: 'organic_score84_curve75_85_uniq80_snipers3_tp35_sl15',
    minScore: 84,
    maxScore: 85,
    minCurveProgress: 0.75,
    maxCurveProgress: 0.85,
    minUniqueBuyerRatio: 0.8,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  },
  {
    name: 'organic_score80_curve75_85_uniq90_snipers3_tp35_sl15',
    minScore: 80,
    maxScore: 85,
    minCurveProgress: 0.75,
    maxCurveProgress: 0.85,
    minUniqueBuyerRatio: 0.9,
    maxSniperWallets: 3,
    minRecentVolumeSol: 25,
    minTradeVelocityPerMin: 25,
    takeProfitPct: 0.35,
    stopLossPct: 0.15,
    maxHoldSeconds: 300,
    amountSol: 0.1
  }
];

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function eventPayload(event) {
  return event.payload || event.data || {};
}

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return compact((end - start) / 1000, 2);
}

function getMint(payload) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function getPrice(payload) {
  return asNumber(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
}

function listTelemetryFiles(limit) {
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

function resolveTelemetryFiles(args) {
  if (args.telemetry) {
    return String(args.telemetry)
      .split(',')
      .map((entry) => resolveRepoPath(entry.trim()))
      .filter(Boolean)
      .filter((filePath) => fs.existsSync(filePath));
  }

  const limit = Number.isFinite(Number(args.limit)) ? Number(args.limit) : 4;
  return listTelemetryFiles(limit);
}

function buildPriceSamples(events) {
  const samplesByMint = new Map();

  for (const event of events) {
    const payload = eventPayload(event);
    const mint = getMint(payload);
    const priceSol = getPrice(payload);
    if (!mint || !event.timestamp || !Number.isFinite(priceSol) || priceSol <= 0) continue;

    const samples = samplesByMint.get(mint) || [];
    samples.push({
      timestamp: event.timestamp,
      type: eventType(event),
      priceSol,
      curveProgress: asNumber(payload.curveProgress)
    });
    samplesByMint.set(mint, samples);
  }

  return samplesByMint;
}

function isEligible(payload, variant) {
  const priceSol = asNumber(payload.priceSol);
  const score = asNumber(payload.score);
  const curveProgress = asNumber(payload.curveProgress);
  const recentVolumeSol = asNumber(payload.recentVolumeSol);
  const tradeVelocityPerMin = asNumber(payload.tradeVelocityPerMin);
  const uniqueBuyerRatio = asNumber(payload.uniqueBuyerRatio);
  const sniperWalletCount = asNumber(payload.sniperWalletCount);
  const curveProgressDelta = asNumber(payload.curveProgressDelta);
  const curveProgressDelta60s = asNumber(payload.curveProgressDelta60s);

  return (
    Number.isFinite(priceSol) && priceSol > 0
    && Number.isFinite(score) && score >= variant.minScore && score < variant.maxScore
    && Number.isFinite(curveProgress) && curveProgress >= variant.minCurveProgress && curveProgress <= variant.maxCurveProgress
    && (!Number.isFinite(variant.minCurveProgressDelta) || (Number.isFinite(curveProgressDelta) && curveProgressDelta >= variant.minCurveProgressDelta))
    && (!Number.isFinite(variant.minCurveProgressDelta60s) || (Number.isFinite(curveProgressDelta60s) && curveProgressDelta60s >= variant.minCurveProgressDelta60s))
    && Number.isFinite(recentVolumeSol) && recentVolumeSol >= variant.minRecentVolumeSol
    && Number.isFinite(tradeVelocityPerMin) && tradeVelocityPerMin >= variant.minTradeVelocityPerMin
    && Number.isFinite(uniqueBuyerRatio) && uniqueBuyerRatio >= variant.minUniqueBuyerRatio
    && Number.isFinite(sniperWalletCount) && sniperWalletCount <= variant.maxSniperWallets
  );
}

function closeTrade(trade, sample, reason) {
  if (trade.exitAt) return;

  const returnPct = sample.priceSol > 0 && trade.entryPriceSol > 0
    ? (sample.priceSol - trade.entryPriceSol) / trade.entryPriceSol
    : 0;

  trade.exitAt = sample.timestamp;
  trade.exitPriceSol = sample.priceSol;
  trade.exitCurveProgress = sample.curveProgress;
  trade.exitReason = reason;
  trade.returnPct = compact(returnPct, 6);
  trade.pnlSol = compact(trade.amountSol * returnPct, 9);
  trade.holdSeconds = secondsBetween(trade.entryAt, sample.timestamp);
}

function simulateVariantRun(events, telemetryPath, variant) {
  const sortedEvents = [...events].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  const samplesByMint = buildPriceSamples(sortedEvents);
  const trades = new Map();

  for (const event of sortedEvents) {
    if (eventType(event) !== 'pre_migration_paper.decision') continue;

    const payload = eventPayload(event);
    const mint = getMint(payload);
    if (!mint || trades.has(mint) || !isEligible(payload, variant)) continue;

    const entryPriceSol = asNumber(payload.priceSol);
    const entryMs = new Date(event.timestamp).getTime();
    const trade = {
      telemetryPath,
      mint,
      symbol: payload.symbol || null,
      sourcePreset: payload.preset || null,
      sourceReason: payload.reason || null,
      entryAt: event.timestamp,
      entryPriceSol,
      entryScore: compact(payload.score, 2),
      entryCurveProgress: compact(payload.curveProgress, 6),
      entryRecentVolumeSol: compact(payload.recentVolumeSol, 4),
      entryTradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
      entryUniqueBuyerCount: asNumber(payload.uniqueBuyerCount),
      entryUniqueBuyerRatio: compact(payload.uniqueBuyerRatio, 4),
      entrySniperWalletCount: asNumber(payload.sniperWalletCount),
      entryCurveProgressDelta: compact(payload.curveProgressDelta, 6),
      entryCurveProgressDelta60s: compact(payload.curveProgressDelta60s, 6),
      baselineCurveProgress: compact(payload.baselineCurveProgress, 6),
      baselineCurveProgress60s: compact(payload.baselineCurveProgress60s, 6),
      baselineAt: payload.baselineAt || null,
      amountSol: variant.amountSol,
      exitAt: null
    };

    const futureSamples = (samplesByMint.get(mint) || [])
      .filter((sample) => new Date(sample.timestamp).getTime() >= entryMs);
    let lastSample = futureSamples[0] || {
      timestamp: event.timestamp,
      priceSol: entryPriceSol,
      curveProgress: asNumber(payload.curveProgress)
    };

    for (const sample of futureSamples) {
      lastSample = sample;
      const returnPct = (sample.priceSol - entryPriceSol) / entryPriceSol;
      const ageSeconds = (new Date(sample.timestamp).getTime() - entryMs) / 1000;
      if (returnPct >= variant.takeProfitPct) {
        closeTrade(trade, sample, 'TAKE_PROFIT');
        break;
      }
      if (returnPct <= -variant.stopLossPct) {
        closeTrade(trade, sample, 'STOP_LOSS');
        break;
      }
      if (ageSeconds >= variant.maxHoldSeconds) {
        closeTrade(trade, sample, 'MAX_HOLD');
        break;
      }
    }

    if (!trade.exitAt) {
      closeTrade(trade, lastSample, 'END_OF_RUN');
    }

    trades.set(mint, trade);
  }

  return [...trades.values()];
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function summarizeTrades(trades) {
  const wins = trades.filter((trade) => Number(trade.pnlSol || 0) > 0);
  const losses = trades.filter((trade) => Number(trade.pnlSol || 0) < 0);
  const totalPnlSol = trades.reduce((total, trade) => total + Number(trade.pnlSol || 0), 0);

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? compact(wins.length / trades.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    expectancySol: trades.length > 0 ? compact(totalPnlSol / trades.length, 9) : null,
    exitReasonCounts: countBy(trades, (trade) => trade.exitReason)
  };
}

function buildReport(telemetryFiles, variants = VARIANTS) {
  const runsByVariant = variants.map(() => []);
  for (const telemetryPath of telemetryFiles) {
    const replayInput = readReplayEventStream(telemetryPath);
    variants.forEach((variant, index) => {
      const trades = simulateVariantRun(replayInput.events, telemetryPath, variant);
      runsByVariant[index].push({
        telemetryPath,
        summary: summarizeTrades(trades),
        trades
      });
    });
  }

  const variantReports = variants.map((variant, index) => {
    const runs = runsByVariant[index];
    const trades = runs.flatMap((run) => run.trades);

    return {
      variant,
      summary: summarizeTrades(trades),
      runs,
      trades: trades
        .slice()
        .sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0))
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    telemetryFiles,
    variants: variantReports.sort(
      (a, b) => Number(b.summary.totalPnlSol || 0) - Number(a.summary.totalPnlSol || 0)
        || Number(b.summary.trades || 0) - Number(a.summary.trades || 0)
    )
  };
}

function printReport(report) {
  console.log('Broad Organic Surge Replay Report');
  console.log(`Telemetry files: ${report.telemetryFiles.length}`);

  for (const variantReport of report.variants) {
    const { variant, summary } = variantReport;
    console.log('');
    console.log(`${variant.name}: trades=${summary.trades}, wins=${summary.wins}, losses=${summary.losses}, winRate=${summary.winRate ?? 'n/a'}, pnl=${summary.totalPnlSol} SOL, exp=${summary.expectancySol ?? 'n/a'} SOL`);
    variantReport.trades.slice(0, 5).forEach((trade) => {
      console.log(`  ${trade.symbol || 'unknown'} ${path.basename(trade.telemetryPath)} | ${trade.exitReason} | pnl=${trade.pnlSol} SOL return=${trade.returnPct} score=${trade.entryScore} curve=${trade.entryCurveProgress} uniqueRatio=${trade.entryUniqueBuyerRatio} snipers=${trade.entrySniperWalletCount} skippedBy=${trade.sourceReason}`);
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryFiles = resolveTelemetryFiles(args);
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;

  if (telemetryFiles.length === 0) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run paper sessions first.');
    process.exit(1);
  }

  const report = buildReport(telemetryFiles);
  writeJson(outputPath, report);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = {
  DEFAULT_OUTPUT_PATH,
  VARIANTS,
  resolveTelemetryFiles,
  buildReport,
  printReport
};

if (require.main === module) {
  main();
}
