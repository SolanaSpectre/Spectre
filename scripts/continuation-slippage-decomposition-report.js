const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXIT_REPLAY_PATH = path.join(ROOT, 'data', 'reports', 'continuation-exit-replay-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'continuation-slippage-decomposition-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function mapByMint(rows = []) {
  return new Map(rows.filter((row) => row?.mint).map((row) => [row.mint, row]));
}

function buildRows(exitReplay) {
  const currentRows = exitReplay.scenarioRows?.current_config_replay || [];
  const noSlippageByMint = mapByMint(exitReplay.scenarioRows?.no_slippage_reference || []);
  const slippageTaxByMint = mapByMint(exitReplay.slippageTax || []);

  return currentRows
    .map((current) => {
      const noSlippage = noSlippageByMint.get(current.mint);
      if (!noSlippage) return null;
      const tax = slippageTaxByMint.get(current.mint) || {};
      const deltaPnlUsd = num(noSlippage.replayPnlUsd, 0) - num(current.replayPnlUsd, 0);
      const deltaPnlSol = num(noSlippage.replayPnlSol, 0) - num(current.replayPnlSol, 0);
      return {
        mint: current.mint || null,
        symbol: current.symbol || null,
        paperProfile: current.paperProfile || null,
        sourceLabel: current.sourceLabel || null,
        actualExitReason: current.actualExitReason || null,
        replayExitReason: current.replayExitReason || null,
        configuredEntrySlippagePct: tax.configuredEntrySlippagePct ?? null,
        configuredExitSlippagePct: tax.configuredExitSlippagePct ?? null,
        currentReplayPnlUsd: current.replayPnlUsd ?? null,
        currentReplayPnlSol: current.replayPnlSol ?? null,
        noSlippageReplayPnlUsd: noSlippage.replayPnlUsd ?? null,
        noSlippageReplayPnlSol: noSlippage.replayPnlSol ?? null,
        slippageDeltaPnlUsd: compact(deltaPnlUsd, 6),
        slippageDeltaPnlSol: compact(deltaPnlSol, 9),
        currentReplayReturnPct: current.replayReturnPct ?? null,
        noSlippageReplayReturnPct: noSlippage.replayReturnPct ?? null,
        openReturnPct: tax.openReturnPct ?? null,
        openPnlUsd: tax.openPnlUsd ?? null
      };
    })
    .filter(Boolean)
    .sort((a, b) => num(b.slippageDeltaPnlSol, -Infinity) - num(a.slippageDeltaPnlSol, -Infinity));
}

function summarizeGroup(rows) {
  const totalDeltaPnlSol = rows.reduce((sum, row) => sum + num(row.slippageDeltaPnlSol, 0), 0);
  const totalDeltaPnlUsd = rows.reduce((sum, row) => sum + num(row.slippageDeltaPnlUsd, 0), 0);
  return {
    rows: rows.length,
    totalDeltaPnlUsd: compact(totalDeltaPnlUsd, 6),
    totalDeltaPnlSol: compact(totalDeltaPnlSol, 9),
    averageDeltaPnlUsd: rows.length ? compact(totalDeltaPnlUsd / rows.length, 6) : null,
    averageDeltaPnlSol: rows.length ? compact(totalDeltaPnlSol / rows.length, 9) : null
  };
}

function summarizeBy(rows, key) {
  const groups = {};
  for (const row of rows) {
    const value = row[key] || 'UNKNOWN';
    const members = groups[value] || [];
    members.push(row);
    groups[value] = members;
  }
  return Object.fromEntries(
    Object.entries(groups)
      .map(([group, members]) => [group, summarizeGroup(members)])
      .sort((a, b) => num(b[1].totalDeltaPnlSol, -Infinity) - num(a[1].totalDeltaPnlSol, -Infinity))
  );
}

function buildReport() {
  const exitReplay = readJson(EXIT_REPLAY_PATH);
  const rows = buildRows(exitReplay);
  const totalDeltaPnlSol = rows.reduce((sum, row) => sum + num(row.slippageDeltaPnlSol, 0), 0);
  const totalDeltaPnlUsd = rows.reduce((sum, row) => sum + num(row.slippageDeltaPnlUsd, 0), 0);
  const currentConfigPnlSol = exitReplay.summary?.scenarioSummaries?.current_config_replay?.totalPnlSol ?? null;
  const top3DeltaPnlSol = rows.slice(0, 3).reduce((sum, row) => sum + num(row.slippageDeltaPnlSol, 0), 0);
  const residualAfterTop3DeltaPnlSol = totalDeltaPnlSol - top3DeltaPnlSol;

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      exitReplayPath: rel(EXIT_REPLAY_PATH),
      comparedScenarios: ['current_config_replay', 'no_slippage_reference'],
      positionsCompared: rows.length
    },
    summary: {
      positionsCompared: rows.length,
      totalSlippageDeltaPnlUsd: compact(totalDeltaPnlUsd, 6),
      totalSlippageDeltaPnlSol: compact(totalDeltaPnlSol, 9),
      averageSlippageDeltaPnlSol: rows.length ? compact(totalDeltaPnlSol / rows.length, 9) : null,
      slippageDeltaVsAbsoluteCurrentConfigLossRatio: Number.isFinite(num(currentConfigPnlSol, null)) && num(currentConfigPnlSol, 0) < 0
        ? compact(totalDeltaPnlSol / Math.abs(num(currentConfigPnlSol, 0)), 4)
        : null,
      positiveDeltaRows: rows.filter((row) => num(row.slippageDeltaPnlSol, 0) > 0).length,
      nonPositiveDeltaRows: rows.filter((row) => num(row.slippageDeltaPnlSol, 0) <= 0).length,
      top1ShareOfTotalDelta: totalDeltaPnlSol > 0 ? compact(num(rows[0]?.slippageDeltaPnlSol, 0) / totalDeltaPnlSol, 4) : null,
      top3ShareOfTotalDelta: totalDeltaPnlSol > 0 ? compact(top3DeltaPnlSol / totalDeltaPnlSol, 4) : null,
      residualAfterTop3DeltaPnlSol: compact(residualAfterTop3DeltaPnlSol, 9),
      slippageEffectStillPositiveAfterRemovingTop3: residualAfterTop3DeltaPnlSol > 0,
      replayExitReasonCounts: countBy(rows, (row) => row.replayExitReason),
      paperProfileCounts: countBy(rows, (row) => row.paperProfile)
    },
    byPaperProfile: summarizeBy(rows, 'paperProfile'),
    byReplayExitReason: summarizeBy(rows, 'replayExitReason'),
    rows,
    topSlippageRows: rows.slice(0, 10),
    note: 'Report-only decomposition of the continuation no-slippage delta by position. It compares current_config_replay with no_slippage_reference and does not change continuation entries, exits, thresholds, or live behavior.'
  };
}

function main() {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  buildRows,
  summarizeBy
};
