const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY_LOSS_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-loss-attribution-latest.json');
const PAPER_SIM_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-paper-sim-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-timing-pressure-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function secondsBetween(a, b) {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return compact((left - right) / 1000, 2);
}

function signClass(value) {
  const parsed = num(value, 0);
  if (parsed > 0) return 'win';
  if (parsed < 0) return 'loss';
  return 'flat';
}

function groupCount(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function simKey(sim) {
  return `${sim.mint}:${sim.entryAt}`;
}

function chooseNearestSim(actual, simByMint, usedSimKeys) {
  const candidates = simByMint.get(actual.mint) || [];
  const unused = candidates.filter((sim) => !usedSimKeys.has(simKey(sim)));
  if (!unused.length) return null;
  const actualAt = Date.parse(actual.entryAt);
  if (!Number.isFinite(actualAt)) return unused[0];
  return unused
    .map((sim) => ({ sim, distanceMs: Math.abs(Date.parse(sim.entryAt) - actualAt) }))
    .sort((a, b) => a.distanceMs - b.distanceMs)[0]?.sim || null;
}

function buildPressureFlags(actual, sim, deltaPnlSol) {
  const flags = [];
  if (!sim) {
    flags.push('NO_SIM_MATCH');
    return flags;
  }

  const actualPnl = num(actual.pnlSol, 0);
  const simPnl = num(sim.pnlSol, 0);
  const actualCurve = num(actual.entryCurveProgress, 0);
  const simMinReturn = nullableNum(sim.unrealizedMinReturnPct);
  const simMaxReturn = nullableNum(sim.unrealizedMaxReturnPct);

  if (deltaPnlSol !== null && deltaPnlSol >= 0.02) flags.push('ACTUAL_EXIT_OUTPERFORMED_SIM');
  if (deltaPnlSol !== null && deltaPnlSol <= -0.02) flags.push('SIM_OUTPERFORMED_ACTUAL');
  if (actualPnl > 0 && simPnl < 0) flags.push('ACTUAL_WIN_SIM_LOSS');
  if (actualPnl < 0 && simPnl > 0) flags.push('ACTUAL_LOSS_SIM_WIN');
  if (sim.exitReason === 'STOP_LOSS' && actual.exitReason !== 'STOP_LOSS') flags.push('SIM_HELD_TO_STOP');
  if (simMinReturn !== null && simMinReturn <= -0.25 && actualPnl >= 0) flags.push('ACTUAL_AVOIDED_DEEP_DRAWDOWN');
  if (simMaxReturn !== null && simMaxReturn >= 0.25 && sim.exitReason === 'STOP_LOSS') flags.push('SIM_GAVE_BACK_BIG_POP');
  if (actualCurve >= 0.9 && actualPnl <= 0) flags.push('HIGH_CURVE_ENTRY_PRESSURE');
  if (actual.exitReason === 'CURVE_STALL' || sim.exitReason === 'STOP_LOSS') flags.push('EXIT_PRESSURE');

  return flags;
}

function compactRow(actual, sim) {
  const actualPnl = nullableNum(actual.pnlSol);
  const simPnl = sim ? nullableNum(sim.pnlSol) : null;
  const deltaPnlSol = actualPnl !== null && simPnl !== null ? compact(actualPnl - simPnl, 6) : null;

  return {
    mint: actual.mint || null,
    symbol: actual.symbol || null,
    preset: actual.preset || null,
    curveBand: actual.curveBand || null,
    guardOverride: actual.guardOverride || null,
    actual: {
      entryAt: actual.entryAt || null,
      exitAt: actual.exitAt || null,
      entryScore: compact(actual.entryScore, 2),
      entryCurveProgress: compact(actual.entryCurveProgress, 6),
      entryRecentVolumeSol: compact(actual.entryRecentVolumeSol, 4),
      entryTradeVelocityPerMin: compact(actual.entryTradeVelocityPerMin, 2),
      exitReason: actual.exitReason || null,
      pnlSol: actualPnl,
      pnlClass: actual.pnlClass || signClass(actualPnl),
      holdSeconds: compact(actual.holdSeconds, 2),
      peakReturnPct: compact(actual.peakReturnPct, 6),
      maxCurveProgress: compact(actual.maxCurveProgress, 6)
    },
    sim: sim ? {
      entryAt: sim.entryAt || null,
      exitAt: sim.exitAt || null,
      entryTimeDeltaSeconds: secondsBetween(actual.entryAt, sim.entryAt),
      entryScore: compact(sim.entryScore, 2),
      entryCurveProgress: compact(sim.entryCurveProgress, 6),
      entryRecentVolumeSol: compact(sim.entryRecentVolumeSol, 4),
      entryTradeVelocityPerMin: compact(sim.entryTradeVelocityPerMin, 2),
      exitReason: sim.exitReason || null,
      pnlSol: simPnl,
      pnlClass: signClass(simPnl),
      holdSeconds: compact(sim.holdSeconds, 2),
      unrealizedMaxReturnPct: compact(sim.unrealizedMaxReturnPct, 6),
      unrealizedMinReturnPct: compact(sim.unrealizedMinReturnPct, 6),
      maxCurveProgress: compact(sim.maxCurveProgress, 6)
    } : null,
    comparison: {
      deltaPnlSol,
      actualBetter: deltaPnlSol === null ? null : deltaPnlSol > 0,
      actualExitReason: actual.exitReason || null,
      simExitReason: sim?.exitReason || null,
      pressureFlags: buildPressureFlags(actual, sim, deltaPnlSol)
    }
  };
}

function summarize(rows, unmatchedSimTrades) {
  const matchedRows = rows.filter((row) => row.sim);
  const actualBetterRows = matchedRows.filter((row) => row.comparison.deltaPnlSol > 0);
  const simBetterRows = matchedRows.filter((row) => row.comparison.deltaPnlSol < 0);
  const actualWinSimLoss = matchedRows.filter((row) => row.comparison.pressureFlags.includes('ACTUAL_WIN_SIM_LOSS'));
  const simHeldToStop = matchedRows.filter((row) => row.comparison.pressureFlags.includes('SIM_HELD_TO_STOP'));
  const avoidedDeepDrawdown = matchedRows.filter((row) => row.comparison.pressureFlags.includes('ACTUAL_AVOIDED_DEEP_DRAWDOWN'));
  const highCurvePressure = rows.filter((row) => row.comparison.pressureFlags.includes('HIGH_CURVE_ENTRY_PRESSURE'));
  const totalDelta = matchedRows.reduce((sum, row) => sum + num(row.comparison.deltaPnlSol, 0), 0);

  return {
    actualEntries: rows.length,
    matchedActualToSim: matchedRows.length,
    unmatchedActualEntries: rows.length - matchedRows.length,
    unmatchedSimTrades: unmatchedSimTrades.length,
    actualBetterThanSim: actualBetterRows.length,
    simBetterThanActual: simBetterRows.length,
    actualWinSimLoss: actualWinSimLoss.length,
    simHeldToStop: simHeldToStop.length,
    actualAvoidedDeepDrawdown: avoidedDeepDrawdown.length,
    highCurveEntryPressure: highCurvePressure.length,
    totalActualMinusSimPnlSol: compact(totalDelta, 6),
    averageActualMinusSimPnlSol: matchedRows.length ? compact(totalDelta / matchedRows.length, 6) : null,
    pressureFlagCounts: groupCount(
      rows.flatMap((row) => row.comparison.pressureFlags.map((flag) => ({ flag }))),
      (row) => row.flag
    ),
    byCurveBand: Object.fromEntries(
      Object.entries(groupCount(rows, (row) => row.curveBand)).sort((a, b) => b[1] - a[1])
    ),
    interpretation: rows.length
      ? 'actual pre-migration entries were compared with same-mint paper-sim trades to identify timing and exit-pressure differences; report-only, no gate changes'
      : 'no actual pre-migration entries were available to compare'
  };
}

function buildReport() {
  const entryLoss = readJson(ENTRY_LOSS_PATH, {});
  const paperSim = readJson(PAPER_SIM_PATH, {});
  const actualRows = Array.isArray(entryLoss.rows) ? entryLoss.rows : [];
  const simTrades = Array.isArray(paperSim.simulatedTrades) ? paperSim.simulatedTrades : [];
  const simByMint = new Map();

  for (const trade of simTrades) {
    const mint = trade.mint || null;
    if (!mint) continue;
    if (!simByMint.has(mint)) simByMint.set(mint, []);
    simByMint.get(mint).push(trade);
  }

  const matchedSimKeys = new Set();
  const rows = actualRows.map((actual) => {
    const sim = chooseNearestSim(actual, simByMint, matchedSimKeys);
    if (sim) matchedSimKeys.add(simKey(sim));
    return compactRow(actual, sim);
  });

  const unmatchedSimTrades = simTrades
    .filter((trade) => !matchedSimKeys.has(simKey(trade)))
    .map((trade) => ({
      mint: trade.mint || null,
      symbol: trade.symbol || null,
      entryAt: trade.entryAt || null,
      entryScore: compact(trade.entryScore, 2),
      entryCurveProgress: compact(trade.entryCurveProgress, 6),
      exitReason: trade.exitReason || null,
      pnlSol: nullableNum(trade.pnlSol),
      holdSeconds: compact(trade.holdSeconds, 2),
      unrealizedMaxReturnPct: compact(trade.unrealizedMaxReturnPct, 6),
      unrealizedMinReturnPct: compact(trade.unrealizedMinReturnPct, 6)
    }));

  const pressureRows = rows
    .filter((row) => row.comparison.pressureFlags.length)
    .sort((a, b) => num(b.comparison.deltaPnlSol, -999) - num(a.comparison.deltaPnlSol, -999));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      entryLossAttributionPath: rel(ENTRY_LOSS_PATH),
      paperSimPath: rel(PAPER_SIM_PATH)
    },
    runWindow: entryLoss.runWindow || paperSim.run || {},
    summary: summarize(rows, unmatchedSimTrades),
    rows,
    topActualOutperformedSim: rows
      .filter((row) => row.comparison.deltaPnlSol !== null)
      .sort((a, b) => num(b.comparison.deltaPnlSol, 0) - num(a.comparison.deltaPnlSol, 0))
      .slice(0, 10),
    topSimOutperformedActual: rows
      .filter((row) => row.comparison.deltaPnlSol !== null)
      .sort((a, b) => num(a.comparison.deltaPnlSol, 0) - num(b.comparison.deltaPnlSol, 0))
      .slice(0, 10),
    pressureRows: pressureRows.slice(0, 15),
    unmatchedSimTrades,
    note: 'Report-only entry timing and exit-pressure comparison. Matches actual pre-migration paper entries to same-mint paper-sim trades and does not change presets, thresholds, entries, exits, scoring, AI review, quotes, or live behavior.'
  };
}

function main() {
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

main();
