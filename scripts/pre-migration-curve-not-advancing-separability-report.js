#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  analyzeDecision,
  latestTelemetryFile,
  num,
  readTelemetry,
  repoPath,
  stat
} = require('./pre-migration-curve-advance-diagnostic-report');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-not-advancing-separability-latest.json');

const STRONG_CLASSES = new Set([
  'BLOCKED_STRONG_FOLLOW_THROUGH_120S',
  'DELAYED_STRONG_FOLLOW_THROUGH_300S'
]);
const FLAT_CLASSES = new Set(['CORRECTLY_BLOCKED_FLAT_120S']);

const FEATURES = [
  { key: 'score', label: 'Score', digits: 2 },
  { key: 'curveProgress', label: 'Curve progress', digits: 6 },
  { key: 'recentVolumeSol', label: 'Recent volume SOL', digits: 4 },
  { key: 'tradeVelocityPerMin', label: 'Trade velocity/min', digits: 2 },
  { key: 'buyRatio', label: 'Buy ratio', digits: 4 },
  { key: 'uniqueBuyerCount', label: 'Unique buyer count', digits: 0 },
  { key: 'sniperWalletCount', label: 'Sniper wallet count', digits: 0, lowerMayBeBetter: true },
  { key: 'readinessPct', label: 'Curve-delta readiness %', digits: 2 },
  { key: 'curveProgressDelta', label: 'Instant curve delta', digits: 6 },
  { key: 'curveProgressDelta60s', label: '60s curve delta', digits: 6 },
  { key: 'baselineAgeMs', label: 'Baseline age ms', digits: 0, lowerMayBeBetter: true },
  { key: 'walletTouchCount', label: 'Wallet touch count', digits: 0, source: (row) => row.walletContext?.walletTouchCount },
  { key: 'walletBuyTouchCount', label: 'Wallet buy touch count', digits: 0, source: (row) => row.walletContext?.walletBuyTouchCount },
  { key: 'positiveWalletTouchCount', label: 'Positive wallet touch count', digits: 0, source: (row) => row.walletContext?.positiveWalletTouchCount },
  { key: 'avoidWalletTouchCount', label: 'Avoid wallet touch count', digits: 0, lowerMayBeBetter: true, source: (row) => row.walletContext?.avoidWalletTouchCount }
];

const AGE_BANDS = [
  { name: 'age_lt_1500ms', maxMs: 1500 },
  { name: 'age_1500_5000ms', minMs: 1500, maxMs: 5000 },
  { name: 'age_5000_30000ms', minMs: 5000, maxMs: 30000 },
  { name: 'age_gte_30000ms', minMs: 30000 }
];

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

function finiteValues(rows, feature) {
  return rows
    .map((row) => feature.source ? feature.source(row) : row[feature.key])
    .map(Number)
    .filter(Number.isFinite);
}

function auc(positiveValues, negativeValues) {
  if (!positiveValues.length || !negativeValues.length) return null;
  let wins = 0;
  let ties = 0;
  for (const positive of positiveValues) {
    for (const negative of negativeValues) {
      if (positive > negative) wins += 1;
      else if (positive === negative) ties += 1;
    }
  }
  return (wins + ties * 0.5) / (positiveValues.length * negativeValues.length);
}

function iqrOverlap(aStats, bStats) {
  if (![aStats.q25, aStats.q75, bStats.q25, bStats.q75].every(Number.isFinite)) return null;
  const overlap = Math.max(0, Math.min(aStats.q75, bStats.q75) - Math.max(aStats.q25, bStats.q25));
  const span = Math.max(aStats.q75, bStats.q75) - Math.min(aStats.q25, bStats.q25);
  return span > 0 ? num(overlap / span, 4) : 1;
}

function quantileStats(values, digits) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return { count: 0, min: null, q25: null, median: null, q75: null, p90: null, max: null, avg: null };
  }
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    count: sorted.length,
    min: num(sorted[0], digits),
    q25: num(pick(0.25), digits),
    median: num(pick(0.5), digits),
    q75: num(pick(0.75), digits),
    p90: num(pick(0.9), digits),
    max: num(sorted[sorted.length - 1], digits),
    avg: num(avg, digits)
  };
}

function featureSummary(feature, strongRows, flatRows) {
  const strong = finiteValues(strongRows, feature);
  const flat = finiteValues(flatRows, feature);
  const rawAuc = auc(strong, flat);
  const strongStats = quantileStats(strong, feature.digits);
  const flatStats = quantileStats(flat, feature.digits);
  const directionalAuc = rawAuc === null
    ? null
    : (feature.lowerMayBeBetter ? 1 - rawAuc : rawAuc);
  const bestAuc = rawAuc === null ? null : Math.max(rawAuc, 1 - rawAuc);
  return {
    key: feature.key,
    label: feature.label,
    lowerMayBeBetter: feature.lowerMayBeBetter === true,
    strong: strongStats,
    flat: flatStats,
    aucHigherStrong: rawAuc === null ? null : num(rawAuc, 4),
    directionalAuc: directionalAuc === null ? null : num(directionalAuc, 4),
    bestDirection: rawAuc === null
      ? null
      : (rawAuc >= 0.5 ? 'higher_in_strong' : 'lower_in_strong'),
    separationScore: bestAuc === null ? null : num(bestAuc, 4),
    medianDelta: strongStats.median !== null && flatStats.median !== null
      ? num(strongStats.median - flatStats.median, feature.digits)
      : null,
    iqrOverlap: iqrOverlap(strongStats, flatStats)
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function selectEarliestUniqueMint(rows) {
  const picked = new Map();
  for (const row of rows) {
    if (!row?.mint) continue;
    const rowMs = Number(row.atMs) || new Date(row.at || 0).getTime();
    const current = picked.get(row.mint);
    const currentMs = current ? (Number(current.atMs) || new Date(current.at || 0).getTime()) : Infinity;
    if (!current || rowMs < currentMs) picked.set(row.mint, row);
  }
  return Array.from(picked.values()).sort((a, b) => (
    (Number(a.atMs) || new Date(a.at || 0).getTime())
    - (Number(b.atMs) || new Date(b.at || 0).getTime())
  ));
}

function mintRowConcentration(rows) {
  const counts = countBy(rows, (row) => row.mint);
  const entries = Object.entries(counts);
  const totalRows = rows.length;
  const top1Rows = entries[0]?.[1] || 0;
  const top3Rows = entries.slice(0, 3).reduce((sum, [, count]) => sum + count, 0);
  const rowsPerMint = entries.map(([, count]) => count);
  return {
    rows: totalRows,
    uniqueMints: entries.length,
    duplicateRowsCollapsed: Math.max(0, totalRows - entries.length),
    topMintRowShare: totalRows ? num(top1Rows / totalRows, 4) : null,
    top3MintRowShare: totalRows ? num(top3Rows / totalRows, 4) : null,
    rowsPerMint: quantileStats(rowsPerMint, 0),
    topMints: Object.fromEntries(entries.slice(0, 8))
  };
}

function ageBandOf(row) {
  const age = Number(row.baselineAgeMs);
  if (!Number.isFinite(age)) return 'age_unknown';
  const band = AGE_BANDS.find((item) => (
    (item.minMs === undefined || age >= item.minMs)
    && (item.maxMs === undefined || age < item.maxMs)
  ));
  return band?.name || 'age_unknown';
}

function rowMatchesAgeBand(row, band) {
  const age = Number(row.baselineAgeMs);
  if (!Number.isFinite(age)) return false;
  return (band.minMs === undefined || age >= band.minMs)
    && (band.maxMs === undefined || age < band.maxMs);
}

function featureSummariesFor(strongRows, flatRows, minimumCount = 3) {
  return FEATURES
    .map((feature) => featureSummary(feature, strongRows, flatRows))
    .filter((item) => Number(item.strong?.count || 0) >= minimumCount && Number(item.flat?.count || 0) >= minimumCount)
    .sort((a, b) => Number(b.separationScore || 0) - Number(a.separationScore || 0));
}

function ageBandSeparability(strongRows, flatRows) {
  return AGE_BANDS.map((band) => {
    const strong = strongRows.filter((row) => rowMatchesAgeBand(row, band));
    const flat = flatRows.filter((row) => rowMatchesAgeBand(row, band));
    const features = featureSummariesFor(strong, flat, 3);
    return {
      band: band.name,
      strongRows: strong.length,
      flatRows: flat.length,
      strongUniqueMints: new Set(strong.map((row) => row.mint).filter(Boolean)).size,
      flatUniqueMints: new Set(flat.map((row) => row.mint).filter(Boolean)).size,
      topSeparators: features.filter((item) => Number(item.separationScore) >= 0.65).slice(0, 8)
    };
  });
}

function compactRow(row) {
  return {
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    classification: row.classification,
    score: row.score,
    curveProgress: row.curveProgress,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    buyRatio: row.buyRatio,
    uniqueBuyerCount: row.uniqueBuyerCount,
    sniperWalletCount: row.sniperWalletCount,
    readinessPct: row.readinessPct,
    curveProgressDelta: row.curveProgressDelta,
    curveProgressDelta60s: row.curveProgressDelta60s,
    walletBucket: row.walletContext?.bucket || null,
    curveDelta120s: row.windows?.['120s']?.curveDelta ?? null,
    curveDelta300s: row.windows?.['300s']?.curveDelta ?? null,
    crossed90Within120s: row.windows?.['120s']?.crossed90AfterSkip === true,
    crossed90Within300s: row.windows?.['300s']?.crossed90AfterSkip === true
  };
}

function buildReport(telemetryPath, telemetry) {
  const analyzed = telemetry.decisions.map((decision) => analyzeDecision(
    decision,
    telemetry.snapshotsByMint.get(decision.mint) || [],
    telemetry.targetedParityByMint.get(decision.mint) || []
  ));
  const strongRows = analyzed.filter((row) => STRONG_CLASSES.has(row.classification));
  const flatRows = analyzed.filter((row) => FLAT_CLASSES.has(row.classification));
  const usefulRows = analyzed.filter((row) => row.classification === 'BLOCKED_USEFUL_FOLLOW_THROUGH_120S');
  const mintFirstHitRows = selectEarliestUniqueMint(analyzed);
  const mintFirstHitStrongRows = mintFirstHitRows.filter((row) => STRONG_CLASSES.has(row.classification));
  const mintFirstHitFlatRows = mintFirstHitRows.filter((row) => FLAT_CLASSES.has(row.classification));
  const mintFirstHitUsefulRows = mintFirstHitRows.filter((row) => row.classification === 'BLOCKED_USEFUL_FOLLOW_THROUGH_120S');
  const featureSummaries = featureSummariesFor(strongRows, flatRows, 1);
  const mintFirstHitFeatureSummaries = featureSummariesFor(mintFirstHitStrongRows, mintFirstHitFlatRows, 1);
  const topSeparators = featureSummaries.filter((item) => Number(item.separationScore) >= 0.65);
  const mintFirstHitTopSeparators = mintFirstHitFeatureSummaries.filter((item) => Number(item.separationScore) >= 0.65);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_curve_not_advancing_separability',
    telemetryPath: path.relative(ROOT, telemetryPath),
    telemetryWindow: {
      startAt: telemetry.startMs ? new Date(telemetry.startMs).toISOString() : null,
      endAt: telemetry.endMs ? new Date(telemetry.endMs).toISOString() : null
    },
    summary: {
      decisions: analyzed.length,
      uniqueMints: new Set(analyzed.map((row) => row.mint).filter(Boolean)).size,
      strongFollowThroughRows: strongRows.length,
      usefulFollowThroughRows: usefulRows.length,
      correctlyBlockedFlatRows: flatRows.length,
      uniqueStrongMints: new Set(strongRows.map((row) => row.mint).filter(Boolean)).size,
      uniqueUsefulMints: new Set(usefulRows.map((row) => row.mint).filter(Boolean)).size,
      uniqueFlatMints: new Set(flatRows.map((row) => row.mint).filter(Boolean)).size,
      mintFirstHitDecisions: mintFirstHitRows.length,
      mintFirstHitStrongMints: mintFirstHitStrongRows.length,
      mintFirstHitUsefulMints: mintFirstHitUsefulRows.length,
      mintFirstHitFlatMints: mintFirstHitFlatRows.length,
      classificationCounts: countBy(analyzed, (row) => row.classification),
      mintFirstHitClassificationCounts: countBy(mintFirstHitRows, (row) => row.classification),
      strongWalletBuckets: countBy(strongRows, (row) => row.walletContext?.bucket),
      flatWalletBuckets: countBy(flatRows, (row) => row.walletContext?.bucket),
      mintFirstHitStrongWalletBuckets: countBy(mintFirstHitStrongRows, (row) => row.walletContext?.bucket),
      mintFirstHitFlatWalletBuckets: countBy(mintFirstHitFlatRows, (row) => row.walletContext?.bucket),
      strongCurveDelta120s: stat(strongRows.map((row) => row.windows?.['120s']?.curveDelta), 6),
      flatCurveDelta120s: stat(flatRows.map((row) => row.windows?.['120s']?.curveDelta), 6),
      mintFirstHitStrongCurveDelta120s: stat(mintFirstHitStrongRows.map((row) => row.windows?.['120s']?.curveDelta), 6),
      mintFirstHitFlatCurveDelta120s: stat(mintFirstHitFlatRows.map((row) => row.windows?.['120s']?.curveDelta), 6),
      topSeparatorCount: topSeparators.length,
      mintFirstHitTopSeparatorCount: mintFirstHitTopSeparators.length,
      verdict: topSeparators.length || mintFirstHitTopSeparators.length
        ? 'POTENTIAL_DECISION_TIME_SEPARATOR_FOUND'
        : 'NO_CLEAR_DECISION_TIME_SEPARATOR_FOUND',
      measurementCaveat: 'Row-level separators may be distorted by repeated decision ticks; prefer mintFirstHit and ageBandSeparability before changing strategy.'
    },
    concentration: {
      allRows: mintRowConcentration(analyzed),
      strongRows: mintRowConcentration(strongRows),
      usefulRows: mintRowConcentration(usefulRows),
      flatRows: mintRowConcentration(flatRows)
    },
    features: featureSummaries,
    topSeparators,
    mintFirstHit: {
      features: mintFirstHitFeatureSummaries,
      topSeparators: mintFirstHitTopSeparators,
      topStrongRows: mintFirstHitStrongRows
        .slice()
        .sort((a, b) => Number(b.windows?.['120s']?.curveDelta || 0) - Number(a.windows?.['120s']?.curveDelta || 0))
        .slice(0, 20)
        .map(compactRow),
      topFlatHighScoreRows: mintFirstHitFlatRows
        .slice()
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 20)
        .map(compactRow)
    },
    ageBandSeparability: ageBandSeparability(mintFirstHitStrongRows, mintFirstHitFlatRows),
    topStrongRows: strongRows
      .slice()
      .sort((a, b) => Number(b.windows?.['120s']?.curveDelta || 0) - Number(a.windows?.['120s']?.curveDelta || 0))
      .slice(0, 20)
      .map(compactRow),
    topFlatHighScoreRows: flatRows
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 20)
      .map(compactRow),
    note: 'Report-only separability diagnostic for CURVE_NOT_ADVANCING decisions. Compares decision-time features for strong follow-through versus correctly blocked flat rows. Does not change gates, entries, exits, scoring, AI review, quotes, broadcasts, or live behavior.'
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for curve-not-advancing separability report.');
  }
  const telemetry = await readTelemetry(telemetryPath);
  const report = buildReport(telemetryPath, telemetry);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('Pre-Migration CURVE_NOT_ADVANCING Separability');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Strong/flat rows: ${report.summary.strongFollowThroughRows}/${report.summary.correctlyBlockedFlatRows}`);
  console.log(`Strong/flat unique mints: ${report.summary.uniqueStrongMints}/${report.summary.uniqueFlatMints}`);
  console.log(`Mint-first-hit strong/flat: ${report.summary.mintFirstHitStrongMints}/${report.summary.mintFirstHitFlatMints}`);
  console.log(`Verdict: ${report.summary.verdict}`);
  console.log(`Top separators: ${report.topSeparators.map((item) => `${item.key}=${item.separationScore}`).join(', ') || 'none'}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = { buildReport };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
