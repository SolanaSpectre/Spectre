#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  scanFile,
  makePromotionIndex,
  attachWalletLedgerEvents
} = require('./pre-migration-pre-curve60-runner-discovery-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-pre60-snapshot-coverage-latest.json');
const DEFAULT_LIMIT = 8;
const FIELDS = ['score', 'recentVolumeSol', 'tradeVelocityPerMin', 'buyRatio', 'uniqueBuyerCount', 'sniperWalletCount', 'priceSol', 'curveProgress'];

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

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function telemetryFiles(limit = DEFAULT_LIMIT) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath)
    .reverse();
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function pct(part, total) {
  return total > 0 ? compact(part / total, 6) : null;
}

function topCounts(counts = {}, limit = 12) {
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
}

function numericStats(values, digits = 6) {
  const sorted = values
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null, sum: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: compact(sorted[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(sorted[sorted.length - 1], digits),
    avg: compact(sum / sorted.length, digits),
    sum: compact(sum, digits)
  };
}

function hasNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

function hasFieldCoverage(row = {}, field) {
  if (field === 'buyRatio') return row.buyRatioCaptured === true;
  if (field === 'uniqueBuyerCount') return row.uniqueBuyerCountCaptured === true;
  if (field === 'sniperWalletCount') return row.sniperWalletCountCaptured === true;
  return hasNumber(row[field]);
}

function bump(counts, key, amount = 1) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + amount;
}

function sortedSnapshots(row) {
  return (row.snapshots || [])
    .filter((snapshot) => Number.isFinite(Number(snapshot.atMs)))
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
}

function sortedWalletEvents(row) {
  return (row.walletEvents || [])
    .filter((event) => Number.isFinite(Number(event.atMs)))
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
}

function firstCross(snapshots, threshold, predicate = () => true) {
  return snapshots.find((snapshot) => predicate(snapshot) && Number(snapshot.curveProgress) >= threshold) || null;
}

function fieldCoverage(rows) {
  const coverage = Object.fromEntries(FIELDS.map((field) => [field, {
    present: 0,
    total: rows.length,
    rate: null
  }]));
  for (const row of rows) {
    for (const field of FIELDS) {
      if (hasFieldCoverage(row, field)) coverage[field].present += 1;
    }
  }
  for (const field of FIELDS) coverage[field].rate = pct(coverage[field].present, coverage[field].total);
  return coverage;
}

function coverageByType(rows) {
  const byType = new Map();
  for (const row of rows) {
    const type = row.type || 'unknown';
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(row);
  }
  return Array.from(byType.entries())
    .map(([type, typeRows]) => ({
      type,
      snapshots: typeRows.length,
      fieldCoverage: fieldCoverage(typeRows)
    }))
    .sort((a, b) => b.snapshots - a.snapshots);
}

function walletBefore(events, atMs) {
  const prior = events.filter((event) => event.atMs <= atMs);
  return {
    anyWalletTouch: prior.some((event) => event.anyWalletTouch),
    rawUntrustedPre85Buy: prior.some((event) => event.rawUntrustedPre85Buy),
    trustedPre85Buy: prior.some((event) => event.trustedPre85Buy),
    positiveOrProvenPre85Buy: prior.some((event) => event.positiveOrProvenPre85Buy),
    avoidTouch: prior.some((event) => event.avoidTouch),
    rows: prior.length,
    firstRawPre85BuyAtMs: prior.find((event) => event.rawUntrustedPre85Buy)?.atMs || null
  };
}

function snapshotSource(snapshot = {}) {
  return snapshot.curveProgressSource || snapshot.updateSource || snapshot.type || 'unknown';
}

function sourceCounts(snapshots = []) {
  return topCounts(snapshots.reduce((counts, snapshot) => {
    bump(counts, snapshotSource(snapshot));
    return counts;
  }, {}), 12);
}

function divergenceSummary(snapshots = []) {
  const withProviderAndObserved = snapshots.filter((snapshot) => (
    hasNumber(snapshot.providerCurveProgress)
    && hasNumber(snapshot.observedCurveProgress)
  ));
  const providerAheadCurve60 = withProviderAndObserved.filter((snapshot) => snapshot.providerAheadOfObservedCurve60 === true);
  return {
    snapshots: snapshots.length,
    withProviderAndObserved: withProviderAndObserved.length,
    withProviderAndObservedRate: pct(withProviderAndObserved.length, snapshots.length),
    providerAheadOfObservedCurve60: providerAheadCurve60.length,
    providerAheadOfObservedCurve60Rate: pct(providerAheadCurve60.length, snapshots.length),
    providerObservedCurveDelta: numericStats(withProviderAndObserved.map((snapshot) => snapshot.providerObservedCurveDelta), 6)
  };
}

function snapshotLine(snapshot) {
  if (!snapshot) return null;
  return {
    at: snapshot.at,
    type: snapshot.type,
    source: snapshotSource(snapshot),
    providerCurveSnapshotAt: snapshot.providerCurveSnapshotAt || null,
    lastCurveUpdateAt: snapshot.lastCurveUpdateAt || null,
    providerCurveSnapshotAgeMs: compact(snapshot.providerCurveSnapshotAgeMs, 0),
    lastCurveUpdateAgeMs: compact(snapshot.lastCurveUpdateAgeMs, 0),
    curveProgress: compact(snapshot.curveProgress, 6),
    observedCurveProgress: compact(snapshot.observedCurveProgress, 6),
    providerCurveProgress: compact(snapshot.providerCurveProgress, 6),
    accountCurveProgress: compact(snapshot.accountCurveProgress, 6),
    providerObservedCurveDelta: compact(snapshot.providerObservedCurveDelta, 6),
    providerAheadOfObservedCurve60: snapshot.providerAheadOfObservedCurve60 === true,
    priceSol: compact(snapshot.priceSol, 15),
    score: compact(snapshot.score, 2),
    recentVolumeSol: compact(snapshot.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(snapshot.tradeVelocityPerMin, 2),
    buyRatio: compact(snapshot.buyRatio, 4),
    buyRatioCaptured: snapshot.buyRatioCaptured === true,
    uniqueBuyerCount: compact(snapshot.uniqueBuyerCount, 0),
    uniqueBuyerCountCaptured: snapshot.uniqueBuyerCountCaptured === true,
    sniperWalletCountCaptured: snapshot.sniperWalletCountCaptured === true,
    sniperWalletCount: compact(snapshot.sniperWalletCount, 0)
  };
}

function summarizeMint(row, telemetryPath) {
  const snapshots = sortedSnapshots(row);
  if (!snapshots.length) return null;
  const curveSnapshots = snapshots.filter((snapshot) => hasNumber(snapshot.curveProgress));
  const finalistCross60 = firstCross(curveSnapshots, 0.6, (snapshot) => snapshot.type === 'finalist_account_verifier.update');
  const anyCross60 = firstCross(curveSnapshots, 0.6);
  const cross60 = anyCross60;
  const cross85 = firstCross(curveSnapshots, 0.85);
  const cross90 = firstCross(curveSnapshots, 0.9);
  const pre60 = cross60
    ? snapshots.filter((snapshot) => Number(snapshot.atMs) < Number(cross60.atMs) && Number(snapshot.curveProgress) < 0.6)
    : snapshots.filter((snapshot) => Number(snapshot.curveProgress) < 0.6);
  const staleReferenceCross60 = finalistCross60 || anyCross60;
  const staleObservedAfterCross60 = staleReferenceCross60
    ? snapshots.filter((snapshot) => snapshot.type === 'pre_migration.observed'
      && Number(snapshot.atMs) >= Number(staleReferenceCross60.atMs)
      && Number(snapshot.curveProgress) < 0.6)
    : [];
  const firstObservedVel25AfterCross60 = staleReferenceCross60
    ? snapshots.find((snapshot) => snapshot.type === 'pre_migration.observed'
      && Number(snapshot.atMs) >= Number(staleReferenceCross60.atMs)
      && Number(snapshot.tradeVelocityPerMin) >= 25)
    : null;
  const firstPre60Vel25 = pre60.find((snapshot) => Number(snapshot.tradeVelocityPerMin) >= 25) || null;
  const firstPre60Buyer15 = pre60.find((snapshot) => Number(snapshot.uniqueBuyerCount) >= 15) || null;
  const walletEvents = sortedWalletEvents(row);
  const rawPre85Events = walletEvents.filter((event) => event.rawUntrustedPre85Buy);
  const firstRawPre85 = rawPre85Events[0] || null;
  const lastPre60 = pre60[pre60.length - 1] || null;
  const walletAtLastPre60 = lastPre60 ? walletBefore(walletEvents, lastPre60.atMs) : null;

  return {
    telemetryPath,
    mint: row.mint,
    symbol: row.symbol || null,
    snapshots: snapshots.length,
    pre60Snapshots: pre60.length,
    firstCross60At: cross60?.at || null,
    firstCross60Type: cross60?.type || null,
    finalistCross60At: finalistCross60?.at || null,
    firstCross85At: cross85?.at || null,
    firstCross90At: cross90?.at || null,
    crossed60: Boolean(cross60),
    crossed85: Boolean(cross85),
    crossed90: Boolean(cross90),
    pre60FieldCoverage: fieldCoverage(pre60),
    pre60CoverageByType: coverageByType(pre60),
    pre60SnapshotTypes: topCounts(pre60.reduce((counts, snapshot) => {
      bump(counts, snapshot.type);
      return counts;
    }, {}), 8),
    pre60CurveSources: sourceCounts(pre60),
    staleObservedCurveSources: sourceCounts(staleObservedAfterCross60),
    staleObservedProviderDivergence: divergenceSummary(staleObservedAfterCross60),
    staleObservedProviderSnapshotAgeMs: numericStats(staleObservedAfterCross60.map((snapshot) => snapshot.providerCurveSnapshotAgeMs), 0),
    staleObservedLastCurveUpdateAgeMs: numericStats(staleObservedAfterCross60.map((snapshot) => snapshot.lastCurveUpdateAgeMs), 0),
    staleObservedAfterCross60: staleObservedAfterCross60.length,
    firstRawPre85BuyAt: firstRawPre85?.at || null,
    firstPre60Vel25At: firstPre60Vel25?.at || null,
    firstPre60Buyer15At: firstPre60Buyer15?.at || null,
    firstObservedVel25AfterCross60At: firstObservedVel25AfterCross60?.at || null,
    secondsRawPre85ToCross60: firstRawPre85 && cross60 ? compact((cross60.atMs - firstRawPre85.atMs) / 1000, 2) : null,
    secondsCross60ToObservedVel25: firstObservedVel25AfterCross60 && staleReferenceCross60 ? compact((firstObservedVel25AfterCross60.atMs - staleReferenceCross60.atMs) / 1000, 2) : null,
    lastPre60Snapshot: snapshotLine(lastPre60),
    walletAtLastPre60
  };
}

function summarizeRows(rows) {
  const allPre60 = rows.flatMap((row) => row._pre60Snapshots || []);
  const crossed60 = rows.filter((row) => row.crossed60);
  const crossed90 = rows.filter((row) => row.crossed90);
  const staleRows = rows.filter((row) => row.staleObservedAfterCross60 > 0);
  const buyerCoverage = allPre60.filter((snapshot) => hasNumber(snapshot.uniqueBuyerCount)).length;
  const buyerCapturedCoverage = allPre60.filter((snapshot) => hasFieldCoverage(snapshot, 'uniqueBuyerCount')).length;
  const velocityCoverage = allPre60.filter((snapshot) => hasNumber(snapshot.tradeVelocityPerMin)).length;
  return {
    mints: rows.length,
    crossed60: crossed60.length,
    crossed90: crossed90.length,
    pre60Snapshots: allPre60.length,
    pre60FieldCoverage: fieldCoverage(allPre60),
    pre60CoverageByType: coverageByType(allPre60),
    pre60CurveSources: sourceCounts(allPre60),
    pre60ProviderDivergence: divergenceSummary(allPre60),
    staleObservedCurveSources: sourceCounts(rows.flatMap((row) => row._staleObservedAfterCross60Snapshots || [])),
    staleObservedProviderDivergence: divergenceSummary(rows.flatMap((row) => row._staleObservedAfterCross60Snapshots || [])),
    staleObservedProviderSnapshotAgeMs: numericStats(rows.flatMap((row) => row._staleObservedAfterCross60Snapshots || []).map((snapshot) => snapshot.providerCurveSnapshotAgeMs), 0),
    staleObservedLastCurveUpdateAgeMs: numericStats(rows.flatMap((row) => row._staleObservedAfterCross60Snapshots || []).map((snapshot) => snapshot.lastCurveUpdateAgeMs), 0),
    mintsWithPre60BuyerCount: rows.filter((row) => row.pre60FieldCoverage.uniqueBuyerCount.present > 0).length,
    mintsWithPre60Velocity: rows.filter((row) => row.pre60FieldCoverage.tradeVelocityPerMin.present > 0).length,
    pre60BuyerCountSnapshotRate: pct(buyerCapturedCoverage, allPre60.length),
    pre60BuyerCountNumericSnapshotRate: pct(buyerCoverage, allPre60.length),
    pre60VelocitySnapshotRate: pct(velocityCoverage, allPre60.length),
    staleObservedAfterCross60Mints: staleRows.length,
    staleObservedAfterCross60Rows: staleRows.reduce((sum, row) => sum + row.staleObservedAfterCross60, 0),
    staleObservedRowsPerMint: numericStats(staleRows.map((row) => row.staleObservedAfterCross60), 0),
    secondsRawPre85ToCross60: numericStats(rows.map((row) => row.secondsRawPre85ToCross60), 2),
    secondsCross60ToObservedVel25: numericStats(rows.map((row) => row.secondsCross60ToObservedVel25), 2)
  };
}

function buildRun(filePath, promotionIndex) {
  const scanned = scanFile(filePath, promotionIndex);
  const ledgerAttached = attachWalletLedgerEvents(scanned.rows, scanned.firstMs, scanned.lastMs, promotionIndex);
  const telemetryPath = path.relative(ROOT, filePath);
  const rows = scanned.rows.map((row) => {
    const summarized = summarizeMint(row, telemetryPath);
    if (!summarized) return null;
    const snapshots = sortedSnapshots(row);
    const cross60 = firstCross(snapshots.filter((snapshot) => hasNumber(snapshot.curveProgress)), 0.6);
    summarized._pre60Snapshots = cross60
      ? snapshots.filter((snapshot) => Number(snapshot.atMs) < Number(cross60.atMs) && Number(snapshot.curveProgress) < 0.6)
      : snapshots.filter((snapshot) => Number(snapshot.curveProgress) < 0.6);
    const finalistCross60 = firstCross(snapshots.filter((snapshot) => hasNumber(snapshot.curveProgress) && snapshot.type === 'finalist_account_verifier.update'), 0.6);
    const staleReferenceCross60 = finalistCross60 || cross60;
    summarized._staleObservedAfterCross60Snapshots = staleReferenceCross60
      ? snapshots.filter((snapshot) => snapshot.type === 'pre_migration.observed'
        && Number(snapshot.atMs) >= Number(staleReferenceCross60.atMs)
        && Number(snapshot.curveProgress) < 0.6)
      : [];
    return summarized;
  }).filter(Boolean);
  return {
    telemetryPath,
    rows,
    run: {
      telemetryPath,
      walletLedgerEventsAttached: ledgerAttached,
      firstEventAt: scanned.firstMs === null ? null : new Date(scanned.firstMs).toISOString(),
      lastEventAt: scanned.lastMs === null ? null : new Date(scanned.lastMs).toISOString(),
      mints: rows.length,
      jsonlRowsScanned: scanned.stats.rows,
      malformedLines: scanned.stats.malformedLines,
      summary: summarizeRows(rows)
    }
  };
}

function classifyVerdict(summary) {
  if (summary.pre60Snapshots === 0) return 'NO_PRE60_SNAPSHOTS';
  if (Number(summary.pre60BuyerCountSnapshotRate) === 0 && summary.staleObservedAfterCross60Mints > 0) {
    return 'PRE60_MARKET_FEATURES_MISSING_AND_CURVE_SOURCE_STALE';
  }
  if (Number(summary.pre60BuyerCountSnapshotRate) === 0) return 'PRE60_BUYER_BREADTH_NOT_CAPTURED';
  if (summary.staleObservedAfterCross60Mints > 0) return 'CURVE_SOURCE_STALE_OBSERVED_ROWS_PRESENT';
  return 'PRE60_SNAPSHOT_COVERAGE_USABLE';
}

function buildReport(filePaths) {
  const promotionIndex = makePromotionIndex();
  const runs = [];
  const rows = [];
  const errors = [];
  for (const filePath of filePaths) {
    try {
      const run = buildRun(filePath, promotionIndex);
      runs.push(run.run);
      rows.push(...run.rows);
    } catch (error) {
      errors.push({ telemetryPath: path.relative(ROOT, filePath), error: error.message });
    }
  }
  const summaryRows = rows.map((row) => {
    const { _pre60Snapshots, _staleObservedAfterCross60Snapshots, ...publicRow } = row;
    return publicRow;
  });
  const summary = summarizeRows(rows);
  const rawPre85Cross90 = summaryRows
    .filter((row) => row.crossed90 && row.firstRawPre85BuyAt)
    .sort((a, b) => Number(a.secondsRawPre85ToCross60 ?? 1e9) - Number(b.secondsRawPre85ToCross60 ?? 1e9));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre60_snapshot_coverage',
    inputs: {
      telemetryFiles: filePaths.map((filePath) => path.relative(ROOT, filePath)),
      rowUnit: 'run_mint',
      note: 'Audits pre60 snapshot field coverage and observed-curve staleness. Does not alter runtime gates or paper behavior.'
    },
    summary: {
      ...summary,
      verdict: classifyVerdict(summary),
      recommendation: classifyVerdict(summary) === 'PRE60_SNAPSHOT_COVERAGE_USABLE'
        ? 'run_entry_timing_replay_variants'
        : 'fix_or_join_pre60_market_feature_capture_before_runtime_shadow'
    },
    runs,
    errors,
    rawPre85Cross90Timelines: rawPre85Cross90.slice(0, 25),
    staleObservedExamples: summaryRows
      .filter((row) => row.staleObservedAfterCross60 > 0)
      .sort((a, b) => b.staleObservedAfterCross60 - a.staleObservedAfterCross60)
      .slice(0, 25),
    rows: summaryRows.slice(0, 2000)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicit = args.telemetry || args.file;
  const filePaths = explicit
    ? String(explicit).split(',').map((item) => repoPath(item.trim())).filter(Boolean)
    : telemetryFiles(Number(args.limit || DEFAULT_LIMIT));
  if (!filePaths.length) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run paper sessions first.');
    process.exit(1);
  }
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const report = buildReport(filePaths);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = { buildReport };
