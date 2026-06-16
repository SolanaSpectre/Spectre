#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-follow-through-slice-shadow-replay-latest.json');
const ENTER_TYPE = 'pre_migration_flagged_follow_through_slice_shadow.would_enter';

const EXIT_PROFILES = [
  { name: 'shadow_120s_tp35_sl15_slip3', holdSeconds: 120, takeProfitPct: 35, stopLossPct: -15, entrySlippagePct: 3, exitSlippagePct: 3, stressExtraSlippagePct: 3 },
  { name: 'shadow_300s_tp35_sl15_slip3', holdSeconds: 300, takeProfitPct: 35, stopLossPct: -15, entrySlippagePct: 3, exitSlippagePct: 3, stressExtraSlippagePct: 3 },
  { name: 'shadow_300s_tp50_sl20_slip5', holdSeconds: 300, takeProfitPct: 50, stopLossPct: -20, entrySlippagePct: 5, exitSlippagePct: 5, stressExtraSlippagePct: 3 }
];

const SIZE_SOL = 0.02;
const FEE_SOL = 0.0005;

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

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function eventType(event = {}) {
  return event.telemetryType || event.type || event.event || event.name || 'unknown';
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.tokenMint || payload.mintAddress || payload.address || null;
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.curveProgress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload = {}) {
  const direct = Number(payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = Number(payload.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
}

function bump(counts, key, amount = 1) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + amount;
}

function topCounts(counts = {}, limit = 12) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
  );
}

function numericStats(values, digits = 6) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
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

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.receivedAt || payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs)) return null;
  if (!Number.isFinite(curveProgress) && !Number.isFinite(priceSol)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    curveProgress: compact(curveProgress, 6),
    priceSol: compact(priceSol, 15),
    source: eventType(event)
  };
}

function classifyWindow(window120, window300) {
  if (window300.outcomeCoverage !== 'MEASURED') return 'INSUFFICIENT_OUTCOME_DATA';
  if (window120.crossed90 || Number(window120.curveDelta) >= 0.1 || Number(window120.maxPriceDeltaPct) >= 35) {
    return 'STRONG_FOLLOW_THROUGH';
  }
  if (window300.crossed85 || Number(window300.curveDelta) >= 0.05 || Number(window300.maxPriceDeltaPct) >= 20) {
    return 'USEFUL_FOLLOW_THROUGH';
  }
  return 'FLAT_OR_FADED';
}

function outcomeWindow(row, snapshots, seconds) {
  const startMs = Number(row.atMs);
  const startCurve = Number(row.curveProgress);
  const startPrice = Number(row.priceSol);
  const future = snapshots.filter((snapshot) => snapshot.atMs > startMs && snapshot.atMs <= startMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = future.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const cross = (threshold) => future.find((snapshot) => Number(snapshot.curveProgress) >= threshold && (!Number.isFinite(startCurve) || startCurve < threshold));
  return {
    seconds,
    snapshotCount: future.length,
    outcomeCoverage: future.length ? 'MEASURED' : 'INSUFFICIENT_OUTCOME_DATA',
    maxCurveProgress: compact(maxCurve, 6),
    curveDelta: Number.isFinite(startCurve) && maxCurve !== null ? compact(maxCurve - startCurve, 6) : null,
    maxPriceDeltaPct: Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null ? compact(((maxPrice - startPrice) / startPrice) * 100, 2) : null,
    crossed85: Boolean(cross(0.85)),
    crossed90: Boolean(cross(0.9)),
    first85CrossAt: cross(0.85)?.at || null,
    first90CrossAt: cross(0.9)?.at || null
  };
}

function replay(row, snapshots, profile) {
  const entryMs = Number(row.atMs);
  const entryPriceRaw = Number(row.priceSol);
  if (!Number.isFinite(entryMs) || !Number.isFinite(entryPriceRaw) || entryPriceRaw <= 0) {
    return { profile: profile.name, replayClass: 'NO_ENTRY_PRICE' };
  }
  const path = snapshots
    .filter((snapshot) => snapshot.atMs > entryMs && snapshot.atMs <= entryMs + profile.holdSeconds * 1000)
    .filter((snapshot) => Number.isFinite(Number(snapshot.priceSol)) && Number(snapshot.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!path.length) return { profile: profile.name, replayClass: 'NO_FUTURE_PRICE' };

  const entryPrice = entryPriceRaw * (1 + profile.entrySlippagePct / 100);
  const takeProfitPrice = entryPrice * (1 + profile.takeProfitPct / 100);
  const stopLossPrice = entryPrice * (1 + profile.stopLossPct / 100);
  let exit = path[path.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const snapshot of path) {
    const price = Number(snapshot.priceSol);
    if (price >= takeProfitPrice) {
      exit = snapshot;
      exitReason = 'TAKE_PROFIT';
      break;
    }
    if (price <= stopLossPrice) {
      exit = snapshot;
      exitReason = 'STOP_LOSS';
      break;
    }
  }
  const exitPrice = Number(exit.priceSol) * (1 - profile.exitSlippagePct / 100);
  const grossReturn = exitPrice / entryPrice - 1;
  const stressedReturn = grossReturn - profile.stressExtraSlippagePct / 100;
  const pathPrices = path.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxPrice = pathPrices.length ? Math.max(...pathPrices) : null;
  const minPrice = pathPrices.length ? Math.min(...pathPrices) : null;
  return {
    profile: profile.name,
    replayClass: 'REPLAYED',
    exitReason,
    holdSeconds: compact((exit.atMs - entryMs) / 1000, 1),
    entryPrice: compact(entryPrice, 15),
    exitPrice: compact(exitPrice, 15),
    grossReturnPct: compact(grossReturn * 100, 4),
    pnlSol: compact(SIZE_SOL * grossReturn - FEE_SOL, 9),
    stressedPnlSol: compact(SIZE_SOL * stressedReturn - FEE_SOL, 9),
    maxPriceDeltaPct: Number.isFinite(maxPrice) ? compact(((maxPrice - entryPrice) / entryPrice) * 100, 2) : null,
    minPriceDeltaPct: Number.isFinite(minPrice) ? compact(((minPrice - entryPrice) / entryPrice) * 100, 2) : null
  };
}

function scan(filePath) {
  const rows = [];
  const snapshotsByMint = new Map();
  const actualEntriesByMint = new Map();
  const eventCounts = {};
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    const payload = payloadOf(event);
    bump(eventCounts, type);

    if (type === 'finalist_account_verifier.update' || type === 'pump_bonding_curve.provider_snapshot') {
      const snapshot = snapshotFromEvent(event);
      if (snapshot) {
        if (!snapshotsByMint.has(snapshot.mint)) snapshotsByMint.set(snapshot.mint, []);
        snapshotsByMint.get(snapshot.mint).push(snapshot);
      }
      return;
    }

    if (type === 'pre_migration_paper.entry') {
      const mint = mintOf(payload);
      if (mint) {
        if (!actualEntriesByMint.has(mint)) actualEntriesByMint.set(mint, []);
        actualEntriesByMint.get(mint).push({
          at: payload.timestamp || event.timestamp || null,
          atMs: timestampMs(payload.timestamp || event.timestamp),
          preset: payload.preset || null,
          lane: payload.lane || null,
          profileName: payload.profileName || null,
          pnlSol: payload.pnlSol ?? null
        });
      }
      return;
    }

    if (type !== ENTER_TYPE) return;
    const mint = mintOf(payload);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    if (!mint || !Number.isFinite(atMs)) return;
    const base = {
      mint,
      symbol: payload.symbol || null,
      at: new Date(atMs).toISOString(),
      atMs,
      sourceReason: payload.sourceReason || payload.sourceGuardReason || null,
      preset: payload.preset || null,
      lane: payload.lane || null,
      profileName: payload.profileName || null,
      score: compact(payload.score, 2),
      curveProgress: compact(curveOf(payload), 6),
      curveProgressDelta: compact(payload.curveProgressDelta, 6),
      curveProgressDelta60s: compact(payload.curveProgressDelta60s, 6),
      recentVolumeSol: compact(payload.recentVolumeSol, 4),
      tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
      buyRatio: compact(payload.buyRatio, 4),
      uniqueBuyerCount: compact(payload.uniqueBuyerCount, 0),
      sniperWalletCount: compact(payload.sniperWalletCount, 0),
      priceSol: compact(priceOf(payload), 15),
      walletSignals: payload.walletSignals || null,
      walletBridgeProof: payload.walletBridgeProof || null,
      failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks.slice() : []
    };
    const profiles = Array.isArray(payload.wouldEnterProfiles) ? payload.wouldEnterProfiles : [];
    for (const profile of profiles) rows.push({ ...base, profile });
  }, { bufferSize: 1024 * 1024 });

  for (const snapshots of snapshotsByMint.values()) snapshots.sort((a, b) => a.atMs - b.atMs);
  return { rows, snapshotsByMint, actualEntriesByMint, eventCounts, stats };
}

function dedupeBy(rows, keyFn) {
  const picked = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const existing = picked.get(key);
    if (!existing || row.atMs < existing.atMs) picked.set(key, row);
  }
  return Array.from(picked.values()).sort((a, b) => a.atMs - b.atMs);
}

function buildRow(row, snapshotsByMint, actualEntriesByMint) {
  const snapshots = snapshotsByMint.get(row.mint) || [];
  const window120 = outcomeWindow(row, snapshots, 120);
  const window300 = outcomeWindow(row, snapshots, 300);
  const replayResults = EXIT_PROFILES.map((profile) => replay(row, snapshots, profile));
  const actualEntries = actualEntriesByMint.get(row.mint) || [];
  const actualAfterShadow = actualEntries.filter((entry) => Number.isFinite(entry.atMs) && entry.atMs >= row.atMs);
  return {
    ...row,
    isActualPaperEntry: actualAfterShadow.length > 0,
    actualPaperEntries: actualAfterShadow.slice(0, 5),
    windows: {
      '120s': window120,
      '300s': window300
    },
    classification: classifyWindow(window120, window300),
    replay: replayResults
  };
}

function outlierSummary(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const grossProfit = sorted.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const topWinner = sorted.find((value) => value > 0) || 0;
  return {
    total: compact(total, 9),
    exTop1: compact(sorted.slice(1).reduce((sum, value) => sum + value, 0), 9),
    exTop3: compact(sorted.slice(3).reduce((sum, value) => sum + value, 0), 9),
    topWinnerShareOfGrossProfit: grossProfit > 0 ? compact(topWinner / grossProfit, 4) : null
  };
}

function summarizeRows(rows, label, allRowsForConcentration = rows) {
  const measured = rows.filter((row) => row.windows?.['300s']?.outcomeCoverage === 'MEASURED');
  const primaryReplay = rows.map((row) => row.replay.find((item) => item.profile === EXIT_PROFILES[1].name)).filter((item) => item?.replayClass === 'REPLAYED');
  const pnls = primaryReplay.map((item) => Number(item.pnlSol)).filter(Number.isFinite);
  const stressed = primaryReplay.map((item) => Number(item.stressedPnlSol)).filter(Number.isFinite);
  const wins = pnls.filter((value) => value > 0).length;
  const mintCounts = {};
  for (const row of allRowsForConcentration) bump(mintCounts, row.mint);
  const topMintCount = Object.values(mintCounts).sort((a, b) => b - a)[0] || 0;
  const outliers = outlierSummary(pnls);
  const verdict = rows.length === 0
    ? 'NO_RUNTIME_MATCHES'
    : measured.length < 20
      ? 'INSUFFICIENT_SAMPLE'
      : (topMintCount / Math.max(1, allRowsForConcentration.length)) >= 0.25
        ? 'CONCENTRATION_TOO_HIGH'
        : Number(numericStats(pnls, 9).median || 0) <= 0
          ? 'MEDIAN_NEGATIVE'
          : Number(outliers.exTop3 || 0) <= 0
            ? 'OUTLIER_DOMINATED'
            : Number(numericStats(stressed, 9).sum || 0) <= 0
              ? 'STRESSED_NEGATIVE'
              : 'RUNTIME_REPLAY_PROMISING_SHADOW_ONLY';
  return {
    label,
    rows: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint).filter(Boolean)).size,
    measured: measured.length,
    strong: rows.filter((row) => row.classification === 'STRONG_FOLLOW_THROUGH').length,
    useful: rows.filter((row) => row.classification === 'USEFUL_FOLLOW_THROUGH').length,
    flat: rows.filter((row) => row.classification === 'FLAT_OR_FADED').length,
    insufficient: rows.filter((row) => row.classification === 'INSUFFICIENT_OUTCOME_DATA').length,
    actualPaperEntryMints: new Set(rows.filter((row) => row.isActualPaperEntry).map((row) => row.mint)).size,
    replayed: primaryReplay.length,
    wins,
    losses: primaryReplay.length - wins,
    winRate: primaryReplay.length ? compact(wins / primaryReplay.length, 4) : null,
    pnlSol: outliers.total,
    stressedPnlSol: compact(stressed.reduce((sum, value) => sum + value, 0), 9),
    medianPnlSol: numericStats(pnls, 9).median,
    p90PnlSol: numericStats(pnls, 9).p90,
    exTop1PnlSol: outliers.exTop1,
    exTop3PnlSol: outliers.exTop3,
    topWinnerShareOfGrossProfit: outliers.topWinnerShareOfGrossProfit,
    topMintRowShare: allRowsForConcentration.length ? compact(topMintCount / allRowsForConcentration.length, 4) : null,
    topMints: topCounts(mintCounts, 5),
    classificationCounts: topCounts(rows.reduce((counts, row) => {
      bump(counts, row.classification);
      return counts;
    }, {}), 8),
    sourceReasons: topCounts(rows.reduce((counts, row) => {
      bump(counts, row.sourceReason);
      return counts;
    }, {}), 8),
    verdict
  };
}

function buildReport(filePath) {
  const scanned = scan(filePath);
  const rawRows = scanned.rows;
  const dedupedByMintProfile = dedupeBy(rawRows, (row) => `${row.mint}:${row.profile}`);
  const dedupedByMint = dedupeBy(rawRows, (row) => row.mint);
  const rowsByMintProfile = dedupedByMintProfile.map((row) => buildRow(row, scanned.snapshotsByMint, scanned.actualEntriesByMint));
  const rowsByMint = dedupedByMint.map((row) => buildRow(row, scanned.snapshotsByMint, scanned.actualEntriesByMint));
  const profiles = Array.from(new Set(rowsByMintProfile.map((row) => row.profile))).sort()
    .map((profile) => summarizeRows(
      rowsByMintProfile.filter((row) => row.profile === profile),
      profile,
      rawRows.filter((row) => row.profile === profile)
    ))
    .sort((a, b) => b.uniqueMints - a.uniqueMints || a.label.localeCompare(b.label));
  const summary = summarizeRows(rowsByMint, 'all_profiles_deduped_by_mint', rawRows);
  summary.rawWouldEnterRows = rawRows.length;
  summary.rawProfileMatchRows = rawRows.length;
  summary.rawWouldEnterEvents = scanned.eventCounts[ENTER_TYPE] || 0;
  summary.dedupedMintProfileRows = rowsByMintProfile.length;
  summary.dedupedMintRows = rowsByMint.length;
  summary.profileCount = profiles.length;
  summary.eventCounts = topCounts(scanned.eventCounts, 12);
  summary.jsonlRowsScanned = scanned.stats.rows;
  summary.malformedLines = scanned.stats.malformedLines;
  summary.verdict = summary.dedupedMintRows === 0
    ? 'NO_RUNTIME_SHADOW_ENTRIES'
    : summary.dedupedMintRows < 10
      ? 'INSUFFICIENT_UNIQUE_MINTS'
      : summary.verdict;

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath: path.relative(ROOT, filePath),
    exitProfiles: EXIT_PROFILES,
    summary,
    profiles,
    rows: rowsByMintProfile,
    rowsDedupedByMint: rowsByMint
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || args.file) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run after a paper session.');
    process.exit(1);
  }
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const report = buildReport(telemetryPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = {
  buildReport,
  scan
};
