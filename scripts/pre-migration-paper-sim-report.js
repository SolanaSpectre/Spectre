const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'pre-migration-paper-sim-latest.json');

const DEFAULT_STRATEGY = {
  minScore: 75,
  minCurveProgress: 0.70,
  minRecentVolumeSol: 25,
  minTradeVelocityPerMin: 25,
  takeProfitPct: 0.50,
  stopLossPct: 0.25,
  maxHoldSeconds: 600,
  amountSol: 0.1
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

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function resolveLatestTelemetry(logDir) {
  const candidates = fs.readdirSync(logDir)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return { fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return candidates[0]?.fullPath || null;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function compact(value, decimals = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function countBy(items, keyFn) {
  return items.reduce((accumulator, item) => {
    const key = keyFn(item) || 'unknown';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return Number(((endMs - startMs) / 1000).toFixed(2));
}

function strategyFromArgs(args) {
  const strategy = { ...DEFAULT_STRATEGY };
  const mapping = {
    minScore: 'minScore',
    minCurve: 'minCurveProgress',
    minVolume: 'minRecentVolumeSol',
    minVelocity: 'minTradeVelocityPerMin',
    takeProfit: 'takeProfitPct',
    stopLoss: 'stopLossPct',
    maxHold: 'maxHoldSeconds',
    amount: 'amountSol'
  };

  for (const [argKey, strategyKey] of Object.entries(mapping)) {
    if (args[argKey] === undefined) continue;
    const value = Number(args[argKey]);
    if (Number.isFinite(value)) {
      strategy[strategyKey] = value;
    }
  }

  return strategy;
}

function getPrice(payload) {
  return asNumber(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
}

function getMint(payload) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function eventPayload(event) {
  return event.payload || event.data || {};
}

function shouldEnter(payload, strategy) {
  const score = asNumber(payload.score);
  const curveProgress = asNumber(payload.curveProgress);
  const volume = asNumber(payload.recentVolumeSol);
  const velocity = asNumber(payload.tradeVelocityPerMin);
  const price = getPrice(payload);

  return (
    Number.isFinite(price) && price > 0
    && Number.isFinite(score) && score >= strategy.minScore
    && Number.isFinite(curveProgress) && curveProgress >= strategy.minCurveProgress
    && Number.isFinite(volume) && volume >= strategy.minRecentVolumeSol
    && Number.isFinite(velocity) && velocity >= strategy.minTradeVelocityPerMin
  );
}

function closeTrade(trade, timestamp, price, reason, extra = {}) {
  if (trade.exitAt) return;

  const returnPct = price > 0 && trade.entryPriceSol > 0
    ? (price - trade.entryPriceSol) / trade.entryPriceSol
    : 0;
  const pnlSol = trade.amountSol * returnPct;

  trade.exitAt = timestamp;
  trade.exitPriceSol = price;
  trade.exitReason = reason;
  trade.returnPct = compact(returnPct, 6);
  trade.pnlSol = compact(pnlSol, 9);
  trade.holdSeconds = secondsBetween(trade.entryAt, timestamp);
  Object.assign(trade, extra);
}

function buildPriceSample(event) {
  const payload = eventPayload(event);
  const price = getPrice(payload);
  if (!Number.isFinite(price) || price <= 0) {
    return null;
  }

  return {
    timestamp: event.timestamp,
    type: event.type,
    priceSol: price,
    curveProgress: asNumber(payload.curveProgress),
    score: asNumber(payload.score),
    recentVolumeSol: asNumber(payload.recentVolumeSol),
    tradeVelocityPerMin: asNumber(payload.tradeVelocityPerMin),
    virtualSolReservesSol: asNumber(payload.virtualSolReservesSol),
    realSolReservesSol: asNumber(payload.realSolReservesSol)
  };
}

function buildReport(events, telemetryPath, strategy) {
  const trades = new Map();
  const priceSamplesByMint = new Map();
  const eventCounts = {};
  let firstTimestamp = null;
  let lastTimestamp = null;

  const sortedEvents = [...events].sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
  const actualPaperEntries = sortedEvents.filter((event) => (event.type || event.event || event.name) === 'pre_migration_paper.entry');
  const actualPaperExits = sortedEvents.filter((event) => (event.type || event.event || event.name) === 'pre_migration_paper.exit');

  for (const event of sortedEvents) {
    const type = event.type || event.event || event.name;
    const payload = eventPayload(event);
    const mint = getMint(payload);
    const timestamp = event.timestamp;
    if (type) eventCounts[type] = (eventCounts[type] || 0) + 1;
    if (timestamp && (!firstTimestamp || timestamp < firstTimestamp)) firstTimestamp = timestamp;
    if (timestamp && (!lastTimestamp || timestamp > lastTimestamp)) lastTimestamp = timestamp;
    if (!mint || !timestamp) continue;

    const priceSample = buildPriceSample(event);
    if (priceSample) {
      const samples = priceSamplesByMint.get(mint) || [];
      samples.push(priceSample);
      priceSamplesByMint.set(mint, samples);
    }

    const existingTrade = trades.get(mint);
    if (!existingTrade && type === 'pre_migration.flagged' && shouldEnter(payload, strategy)) {
      const entryPriceSol = getPrice(payload);
      trades.set(mint, {
        mint,
        symbol: payload.symbol || null,
        entryAt: timestamp,
        entryType: type,
        entryPriceSol,
        amountSol: strategy.amountSol,
        entryScore: compact(payload.score, 2),
        entryCurveProgress: compact(payload.curveProgress, 6),
        entryRecentVolumeSol: compact(payload.recentVolumeSol, 4),
        entryTradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
        entryReasons: Array.isArray(payload.reasons) ? payload.reasons : [],
        maxPriceSol: entryPriceSol,
        minPriceSol: entryPriceSol,
        maxCurveProgress: asNumber(payload.curveProgress),
        exitAt: null
      });
      continue;
    }

    const trade = trades.get(mint);
    if (!trade || trade.exitAt || !priceSample) {
      continue;
    }

    const price = priceSample.priceSol;
    trade.maxPriceSol = Math.max(trade.maxPriceSol || price, price);
    trade.minPriceSol = Math.min(trade.minPriceSol || price, price);
    if (Number.isFinite(priceSample.curveProgress)) {
      trade.maxCurveProgress = Math.max(trade.maxCurveProgress ?? 0, priceSample.curveProgress);
    }

    const returnPct = (price - trade.entryPriceSol) / trade.entryPriceSol;
    const holdSeconds = secondsBetween(trade.entryAt, timestamp);
    if (returnPct >= strategy.takeProfitPct) {
      closeTrade(trade, timestamp, price, 'TAKE_PROFIT', {
        exitCurveProgress: compact(priceSample.curveProgress, 6)
      });
    } else if (returnPct <= -strategy.stopLossPct) {
      closeTrade(trade, timestamp, price, 'STOP_LOSS', {
        exitCurveProgress: compact(priceSample.curveProgress, 6)
      });
    } else if (Number.isFinite(holdSeconds) && holdSeconds >= strategy.maxHoldSeconds) {
      closeTrade(trade, timestamp, price, 'MAX_HOLD', {
        exitCurveProgress: compact(priceSample.curveProgress, 6)
      });
    }
  }

  for (const trade of trades.values()) {
    if (trade.exitAt) continue;

    const samples = priceSamplesByMint.get(trade.mint) || [];
    const lastSample = samples[samples.length - 1];
    if (lastSample) {
      closeTrade(trade, lastSample.timestamp, lastSample.priceSol, 'END_OF_RUN', {
        exitCurveProgress: compact(lastSample.curveProgress, 6)
      });
    }
  }

  const simulatedTrades = Array.from(trades.values())
    .map((trade) => ({
      ...trade,
      entryPriceSol: compact(trade.entryPriceSol, 15),
      exitPriceSol: compact(trade.exitPriceSol, 15),
      maxPriceSol: compact(trade.maxPriceSol, 15),
      minPriceSol: compact(trade.minPriceSol, 15),
      maxCurveProgress: compact(trade.maxCurveProgress, 6),
      unrealizedMaxReturnPct: compact((trade.maxPriceSol - trade.entryPriceSol) / trade.entryPriceSol, 6),
      unrealizedMinReturnPct: compact((trade.minPriceSol - trade.entryPriceSol) / trade.entryPriceSol, 6)
    }))
    .sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0));
  const closedTrades = simulatedTrades.filter((trade) => trade.exitAt);
  const totalPnlSol = closedTrades.reduce((total, trade) => total + Number(trade.pnlSol || 0), 0);
  const wins = closedTrades.filter((trade) => Number(trade.pnlSol || 0) > 0);
  const losses = closedTrades.filter((trade) => Number(trade.pnlSol || 0) < 0);
  const exitReasonCounts = closedTrades.reduce((accumulator, trade) => {
    accumulator[trade.exitReason] = (accumulator[trade.exitReason] || 0) + 1;
    return accumulator;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath,
    strategy,
    run: {
      firstTimestamp,
      lastTimestamp,
      runDurationMinutes: firstTimestamp && lastTimestamp
        ? compact((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 60000, 2)
        : null,
      eventCounts
    },
    summary: {
      priceEligibleFlagEvents: countPriceEligibleFlags(sortedEvents),
      simulatedTrades: simulatedTrades.length,
      closedTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closedTrades.length > 0 ? compact(wins.length / closedTrades.length, 4) : null,
      totalPnlSol: compact(totalPnlSol, 9),
      averagePnlSol: closedTrades.length > 0 ? compact(totalPnlSol / closedTrades.length, 9) : null,
      exitReasonCounts
    },
    actualPaperTelemetry: {
      entries: actualPaperEntries.length,
      exits: actualPaperExits.length,
      entriesByLane: countBy(actualPaperEntries, (event) => eventPayload(event).lane),
      entriesByProfile: countBy(actualPaperEntries, (event) => eventPayload(event).profileName),
      exitsByProfile: countBy(actualPaperExits, (event) => eventPayload(event).profileName),
      exitReasonsByProfile: actualPaperExits.reduce((accumulator, event) => {
        const payload = eventPayload(event);
        const profileName = payload.profileName || 'unknown';
        const reason = payload.reason || 'unknown';
        if (!accumulator[profileName]) accumulator[profileName] = {};
        accumulator[profileName][reason] = (accumulator[profileName][reason] || 0) + 1;
        return accumulator;
      }, {})
    },
    topWinners: simulatedTrades.slice(0, 15),
    topLosers: [...simulatedTrades].sort((a, b) => Number(a.pnlSol || 0) - Number(b.pnlSol || 0)).slice(0, 15),
    simulatedTrades
  };
}

function countPriceEligibleFlags(events) {
  return events.filter((event) => {
    const payload = eventPayload(event);
    return event.type === 'pre_migration.flagged' && Number.isFinite(getPrice(payload));
  }).length;
}

function printReport(report) {
  console.log('Pre-Migration Exploratory Candidate Generator Report');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Run duration: ${report.run.runDurationMinutes || 0} min`);
  console.log(`Strategy: score>=${report.strategy.minScore}, curve>=${report.strategy.minCurveProgress}, volume>=${report.strategy.minRecentVolumeSol} SOL, velocity>=${report.strategy.minTradeVelocityPerMin}/min, TP=${report.strategy.takeProfitPct}, SL=${report.strategy.stopLossPct}, maxHold=${report.strategy.maxHoldSeconds}s`);
  console.log(`Price-eligible flag events: ${report.summary.priceEligibleFlagEvents}`);
  console.log(`Simulated trades: ${report.summary.simulatedTrades}, closed=${report.summary.closedTrades}, wins=${report.summary.wins}, losses=${report.summary.losses}, winRate=${report.summary.winRate ?? 'n/a'}, pnl=${report.summary.totalPnlSol} SOL`);
  console.log(`Exits: ${Object.entries(report.summary.exitReasonCounts).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
  console.log(`Actual paper telemetry: entries=${report.actualPaperTelemetry.entries}, exits=${report.actualPaperTelemetry.exits}`);
  console.log(`Actual entries by profile: ${Object.entries(report.actualPaperTelemetry.entriesByProfile).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);

  if (report.summary.priceEligibleFlagEvents === 0) {
    console.log('');
    console.log('No price-bearing watch flags found. Run another paper session after the bondingCurvePriceSol telemetry patch.');
  }

  if (report.topWinners.length > 0) {
    console.log('');
    console.log('Top Simulated Trades:');
    report.topWinners.slice(0, 10).forEach((trade, index) => {
      console.log(`${index + 1}. ${trade.symbol || 'unknown'} ${trade.mint} | ${trade.exitReason} | pnl=${trade.pnlSol} SOL return=${trade.returnPct} hold=${trade.holdSeconds}s curve=${trade.entryCurveProgress}->${trade.exitCurveProgress}`);
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveRepoPath(args.telemetry) || resolveLatestTelemetry(DEFAULT_LOG_DIR);
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;
  const strategy = strategyFromArgs(args);

  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  const report = buildReport(readJsonl(telemetryPath), telemetryPath, strategy);
  writeJson(outputPath, report);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = {
  DEFAULT_LOG_DIR,
  DEFAULT_OUTPUT_PATH,
  DEFAULT_STRATEGY,
  parseArgs,
  resolveRepoPath,
  resolveLatestTelemetry,
  readJsonl,
  writeJson,
  compact,
  strategyFromArgs,
  buildReport,
  printReport
};

if (require.main === module) {
  main();
}
