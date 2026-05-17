const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIGNAL_QUALITY_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-signal-quality-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-shape-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function curveDeltaBucket(value) {
  const delta = Number(value);
  if (!Number.isFinite(delta)) return 'delta_unknown';
  if (delta >= 0.035) return 'delta_strong';
  if (delta > 0) return 'delta_positive';
  if (delta === 0) return 'delta_flat';
  return 'delta_negative';
}

function buyerSpreadBucket(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return 'buyers_unknown';
  if (ratio >= 0.9) return 'buyers_very_broad';
  if (ratio >= 0.8) return 'buyers_broad';
  return 'buyers_concentrated';
}

function sniperShapeBucket(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 'snipers_unknown';
  if (count >= 4) return 'snipers_4_plus';
  if (count >= 2) return 'snipers_2_3';
  return 'snipers_0_1';
}

function shapeKey(trade) {
  return [
    trade.curveBucket || 'curve_unknown',
    curveDeltaBucket(trade.curveProgressDelta),
    buyerSpreadBucket(trade.uniqueBuyerRatio),
    sniperShapeBucket(trade.sniperWalletCount)
  ].join('|');
}

function summarize(rows) {
  const closed = rows.filter((row) => Number.isFinite(Number(row.pnlSol)));
  const wins = closed.filter((row) => Number(row.pnlSol) > 0);
  const losses = closed.filter((row) => Number(row.pnlSol) < 0);
  const pnlSol = closed.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pct(wins.length, wins.length + losses.length),
    pnlSol: compact(pnlSol, 9),
    averagePnlSol: closed.length ? compact(pnlSol / closed.length, 9) : null,
    averageScore: closed.length ? compact(closed.reduce((sum, row) => sum + Number(row.score || 0), 0) / closed.length, 6) : null,
    averageCurveProgress: closed.length ? compact(closed.reduce((sum, row) => sum + Number(row.curveProgress || 0), 0) / closed.length, 6) : null,
    averageCurveDelta: closed.length ? compact(closed.reduce((sum, row) => sum + Number(row.curveProgressDelta || 0), 0) / closed.length, 6) : null,
    averageUniqueBuyerRatio: closed.length ? compact(closed.reduce((sum, row) => sum + Number(row.uniqueBuyerRatio || 0), 0) / closed.length, 6) : null,
    averageSniperWalletCount: closed.length ? compact(closed.reduce((sum, row) => sum + Number(row.sniperWalletCount || 0), 0) / closed.length, 6) : null
  };
}

function groupShapes(trades) {
  const groups = {};
  for (const trade of trades) {
    const key = shapeKey(trade);
    if (!groups[key]) groups[key] = [];
    groups[key].push(trade);
  }
  return Object.fromEntries(
    Object.entries(groups)
      .map(([key, rows]) => [key, summarize(rows)])
      .sort((a, b) => {
        if ((b[1].trades || 0) !== (a[1].trades || 0)) return (b[1].trades || 0) - (a[1].trades || 0);
        return Number(b[1].pnlSol || 0) - Number(a[1].pnlSol || 0);
      })
  );
}

function buildReport() {
  const signalQuality = readJson(SIGNAL_QUALITY_PATH);
  const trades = Array.isArray(signalQuality.trades) ? signalQuality.trades : [];
  const shapes = groupShapes(trades);
  const recurringShapes = Object.fromEntries(Object.entries(shapes).filter(([, value]) => Number(value.trades || 0) >= 2));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      signalQualityPath: path.relative(ROOT, SIGNAL_QUALITY_PATH).replace(/\\/g, '/')
    },
    summary: {
      trades: trades.length,
      winners: trades.filter((trade) => Number(trade.pnlSol) > 0).length,
      losers: trades.filter((trade) => Number(trade.pnlSol) < 0).length,
      recurringShapeCount: Object.keys(recurringShapes).length,
      interpretation: 'simulated pre-migration trades grouped by combined entry shape; report-only, no threshold changes'
    },
    shapes,
    recurringShapes,
    topPositiveShapes: Object.entries(shapes)
      .filter(([, value]) => Number(value.pnlSol || 0) > 0)
      .sort((a, b) => Number(b[1].pnlSol || 0) - Number(a[1].pnlSol || 0))
      .slice(0, 10)
      .map(([shape, stats]) => ({ shape, ...stats })),
    topNegativeShapes: Object.entries(shapes)
      .filter(([, value]) => Number(value.pnlSol || 0) < 0)
      .sort((a, b) => Number(a[1].pnlSol || 0) - Number(b[1].pnlSol || 0))
      .slice(0, 10)
      .map(([shape, stats]) => ({ shape, ...stats })),
    note: 'Report-only pre-migration entry-shape diagnostic. Shape keys combine curve band, curve delta, buyer spread, and sniper bucket from the existing signal-quality report.'
  };
}

function main() {
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH).replace(/\\/g, '/')}`);
}

main();
