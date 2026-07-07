#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-advancing-high-curve-lane-gap-latest.json');
const DEFAULT_LIMIT = 8;
const SIZE_SOL = 0.02;
const FEE_SOL = 0.0005;
const EXIT_PROFILE = {
  name: 'advancing_high_curve_300s_tp35_sl15_slip3',
  holdSeconds: 300,
  takeProfitPct: 35,
  stopLossPct: -15,
  entrySlippagePct: 3,
  exitSlippagePct: 3,
  stressExtraSlippagePct: 3
};

const TARGET_REASONS = new Set([
  'CURVE_FALSE_NEGATIVE_BRIDGE_REQUIRES_STALLED_CURVE',
  'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE'
]);

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

function timestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = new Date(value).getTime();
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
  const raw = payload.accountCurveProgress
    ?? payload.onchainCurveProgress
    ?? payload.providerCurveProgress
    ?? payload.paperCurveProgress
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolOrNull(value) {
  return value === true ? true : value === false ? false : null;
}

function bump(counts, key, amount = 1) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + amount;
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

function getRow(rowsByMint, mint, payload = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: payload.symbol || null,
      snapshots: [],
      truth: [],
      decisions: [],
      firstObservedMs: null
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  return row;
}

function snapshotFrom(type, payload, atMs, curve, price) {
  return {
    type,
    atMs,
    at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
    curveProgress: compact(curve, 6),
    priceSol: compact(price, 15),
    score: compact(payload.score ?? payload.entryScore, 2),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount),
    sniperWalletCount: numberOrNull(payload.sniperWalletCount)
  };
}

function buyerSniperRatio(uniqueBuyerCount, sniperWalletCount) {
  const buyers = Number(uniqueBuyerCount);
  const snipers = Number(sniperWalletCount);
  if (!Number.isFinite(buyers) || !Number.isFinite(snipers)) return null;
  return buyers / Math.max(1, snipers);
}

function ratioBand(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return 'ratio_unknown';
  if (value < 2) return 'ratio_lt2';
  if (value < 5) return 'ratio_2_5';
  if (value < 15) return 'ratio_5_15';
  return 'ratio_15_plus';
}

function sniperBand(snipers) {
  const value = Number(snipers);
  if (!Number.isFinite(value)) return 'snipers_unknown';
  if (value < 3) return 'snipers_lt3';
  if (value < 8) return 'snipers_3_7';
  if (value < 15) return 'snipers_8_14';
  return 'snipers_15_plus';
}

function walletFlags(payload = {}) {
  const proof = payload.walletBridgeProof || {};
  const context = payload.walletClassificationContext || {};
  const trusted = Number(proof.walletTouchCount || 0) > 0 || context.touched === true || context.shadowTouched === true;
  const positive = Number(proof.positiveOrProvenTouchCount || 0) > 0
    || Number(context.positiveTouchCount || context.provenTouchCount || context.provenBuyCount || 0) > 0;
  const rawUntrusted = Number(proof.untrustedWalletTouchCount || 0) > 0 || context.untrustedTouched === true;
  const rawUntrustedPre85 = Number(proof.untrustedPre85BuyTouchCount || 0) > 0;
  return {
    trusted,
    positive,
    rawUntrusted,
    rawUntrustedPre85,
    observedWalletTradeCount: numberOrNull(context.observedWalletTradeCount)
  };
}

function decisionFrom(type, payload, atMs, curve, price, filePath) {
  const reason = payload.guardReason || payload.reason || payload.sourceReason || null;
  const uniqueBuyerCount = numberOrNull(payload.uniqueBuyerCount);
  const sniperWalletCount = numberOrNull(payload.sniperWalletCount);
  const ratio = buyerSniperRatio(uniqueBuyerCount, sniperWalletCount);
  return {
    file: path.relative(ROOT, filePath),
    type,
    atMs,
    at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
    mint: mintOf(payload),
    symbol: payload.symbol || null,
    preset: payload.preset || null,
    lane: payload.lane || null,
    decision: payload.decision || payload.outcome || null,
    reason,
    failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks.slice() : [],
    score: compact(payload.score ?? payload.entryScore, 2),
    curveProgress: compact(curve, 6),
    priceSol: compact(price, 15),
    curveProgressDelta: compact(payload.curveProgressDelta, 6),
    curveProgressDelta60s: compact(payload.curveProgressDelta60s, 6),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    buyRatio: compact(payload.buyRatio, 4),
    uniqueBuyerCount,
    sniperWalletCount,
    buyerSniperRatio: compact(ratio, 4),
    ratioBand: ratioBand(ratio),
    sniperBand: sniperBand(sniperWalletCount),
    wallet: walletFlags(payload)
  };
}

function truthFrom(type, payload, atMs, curve, price) {
  return {
    type,
    atMs,
    at: Number.isFinite(atMs) ? new Date(atMs).toISOString() : null,
    status: payload.status || payload.blockedReason || null,
    reason: payload.reason || payload.blockedReason || null,
    curveProgress: compact(curve, 6),
    priceSol: compact(price, 15),
    paperCurveProgress: compact(payload.paperCurveProgress, 6),
    accountCurveProgress: compact(payload.accountCurveProgress, 6),
    curveDelta: compact(payload.curveDelta, 6),
    accountAgeMs: compact(payload.accountAgeMs, 0),
    fresh: boolOrNull(payload.fresh)
  };
}

function sortedSnapshots(row) {
  return row.snapshots
    .filter((snapshot) => Number.isFinite(Number(snapshot.atMs)))
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
}

function firstCross(snapshots, threshold, afterMs = null) {
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold
    && (!Number.isFinite(Number(afterMs)) || Number(snapshot.atMs) >= Number(afterMs))) || null;
}

function outcomeWindow(candidate, snapshots, seconds) {
  const startMs = Number(candidate.atMs);
  const startCurve = Number(candidate.curveProgress);
  const startPrice = Number(candidate.priceSol);
  const future = snapshots
    .filter((snapshot) => Number(snapshot.atMs) > startMs && Number(snapshot.atMs) <= startMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = future.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const cross90 = future.find((snapshot) => Number(snapshot.curveProgress) >= 0.9 && (!Number.isFinite(startCurve) || startCurve < 0.9));
  return {
    seconds,
    snapshotCount: future.length,
    outcomeCoverage: future.length ? 'MEASURED' : 'INSUFFICIENT_OUTCOME_DATA',
    maxCurveProgress: compact(maxCurve, 6),
    curveDelta: Number.isFinite(startCurve) && maxCurve !== null ? compact(maxCurve - startCurve, 6) : null,
    maxPriceDeltaPct: Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null ? compact(((maxPrice - startPrice) / startPrice) * 100, 2) : null,
    crossed90: Boolean(cross90),
    first90CrossAt: cross90?.at || null,
    secondsToCross90: cross90 ? compact((Number(cross90.atMs) - startMs) / 1000, 3) : null
  };
}

function replay(candidate, snapshots) {
  const entryMs = Number(candidate.atMs);
  const entryPriceRaw = Number(candidate.priceSol);
  if (!Number.isFinite(entryMs) || !Number.isFinite(entryPriceRaw) || entryPriceRaw <= 0) return { replayClass: 'NO_ENTRY_PRICE' };
  const pathRows = snapshots
    .filter((snapshot) => Number(snapshot.atMs) > entryMs && Number(snapshot.atMs) <= entryMs + EXIT_PROFILE.holdSeconds * 1000)
    .filter((snapshot) => Number(snapshot.priceSol) > 0)
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
  if (!pathRows.length) return { replayClass: 'NO_FUTURE_PRICE' };

  const entryPrice = entryPriceRaw * (1 + EXIT_PROFILE.entrySlippagePct / 100);
  const takeProfit = entryPrice * (1 + EXIT_PROFILE.takeProfitPct / 100);
  const stopLoss = entryPrice * (1 + EXIT_PROFILE.stopLossPct / 100);
  let exit = pathRows[pathRows.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const snapshot of pathRows) {
    const price = Number(snapshot.priceSol);
    if (price >= takeProfit) {
      exit = snapshot;
      exitReason = 'TAKE_PROFIT';
      break;
    }
    if (price <= stopLoss) {
      exit = snapshot;
      exitReason = 'STOP_LOSS';
      break;
    }
  }
  const exitPrice = Number(exit.priceSol) * (1 - EXIT_PROFILE.exitSlippagePct / 100);
  const grossReturn = exitPrice / entryPrice - 1;
  const stressedReturn = grossReturn - EXIT_PROFILE.stressExtraSlippagePct / 100;
  const prices = pathRows.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxPrice = prices.length ? Math.max(...prices) : null;
  return {
    replayClass: 'REPLAYED',
    profile: EXIT_PROFILE.name,
    exitReason,
    holdSeconds: compact((Number(exit.atMs) - entryMs) / 1000, 1),
    grossReturnPct: compact(grossReturn * 100, 4),
    pnlSol: compact(SIZE_SOL * grossReturn - FEE_SOL, 9),
    stressedPnlSol: compact(SIZE_SOL * stressedReturn - FEE_SOL, 9),
    maxFavorablePct: maxPrice ? compact((maxPrice / entryPriceRaw - 1) * 100, 4) : null
  };
}

function nearestTruth(row, atMs, maxWindowMs = 5000) {
  if (!Number.isFinite(atMs) || !row.truth.length) return null;
  let best = null;
  for (const truth of row.truth) {
    const distanceMs = Math.abs(Number(truth.atMs) - atMs);
    if (distanceMs > maxWindowMs) continue;
    if (!best || distanceMs < best.distanceMs) best = { ...truth, distanceMs };
  }
  if (!best) return null;
  return { ...best, distanceMs: compact(best.distanceMs, 0) };
}

function isTargetDecision(decision) {
  if (!TARGET_REASONS.has(decision.reason)) return false;
  if (Number(decision.curveProgress) < 0.85) return false;
  if (!(Number(decision.curveProgressDelta60s) > 0)) return false;
  return true;
}

function scanFile(filePath) {
  const rowsByMint = new Map();
  const eventCounts = {};
  let firstMs = null;
  let lastMs = null;

  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    const atMs = timestampMs(payload.timestamp || payload.receivedAt || event.timestamp);
    bump(eventCounts, type);
    if (Number.isFinite(atMs)) {
      firstMs = firstMs === null ? atMs : Math.min(firstMs, atMs);
      lastMs = lastMs === null ? atMs : Math.max(lastMs, atMs);
    }
    if (!mint) return;
    const row = getRow(rowsByMint, mint, payload);
    const curve = curveOf(payload);
    const price = priceOf(payload);

    if (type === 'pre_migration.observed') {
      row.firstObservedMs = row.firstObservedMs === null ? atMs : Math.min(row.firstObservedMs, atMs);
    }

    if (Number.isFinite(atMs) && (Number.isFinite(curve) || Number.isFinite(price))) {
      row.snapshots.push(snapshotFrom(type, payload, atMs, curve, price));
    }

    if (type === 'finalist_account_verifier.update' || type === 'finalist_account_verifier.shadow_live_gate') {
      row.truth.push(truthFrom(type, payload, atMs, curve, price));
    }

    if (type === 'pre_migration_paper.guard_attribution' || type === 'pre_migration_paper.decision') {
      const decision = decisionFrom(type, payload, atMs, curve, price, filePath);
      row.decisions.push(decision);
    }
  }, { bufferSize: 1024 * 1024 });

  const candidates = [];
  for (const row of rowsByMint.values()) {
    row.snapshots.sort((a, b) => Number(a.atMs) - Number(b.atMs));
    row.truth.sort((a, b) => Number(a.atMs) - Number(b.atMs));
    row.decisions.sort((a, b) => Number(a.atMs) - Number(b.atMs));
    const snapshots = sortedSnapshots(row);
    for (const decision of row.decisions.filter(isTargetDecision)) {
      const window120 = outcomeWindow(decision, snapshots, 120);
      const window300 = outcomeWindow(decision, snapshots, 300);
      const replayResult = replay(decision, snapshots);
      const cross90 = firstCross(snapshots, 0.9, decision.atMs);
      candidates.push({
        ...decision,
        nearestTruth: nearestTruth(row, decision.atMs),
        catchability: {
          firstObservedAt: row.firstObservedMs === null ? null : new Date(row.firstObservedMs).toISOString(),
          secondsObservedToDecision: row.firstObservedMs !== null ? compact((decision.atMs - row.firstObservedMs) / 1000, 3) : null,
          secondsDecisionToCross90: cross90 ? compact((Number(cross90.atMs) - Number(decision.atMs)) / 1000, 3) : null,
          structurallyUncatchableSubSecond: cross90 ? Number(cross90.atMs) - Number(decision.atMs) < 1000 : false
        },
        outcome120: window120,
        outcome300: window300,
        replay: replayResult
      });
    }
  }

  return { filePath, rowsByMint, candidates, eventCounts, firstMs, lastMs, stats };
}

function dedupeCandidates(candidates) {
  const bestByMintReason = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.file}:${candidate.mint}:${candidate.reason}`;
    const existing = bestByMintReason.get(key);
    if (!existing || Number(candidate.curveProgress) > Number(existing.curveProgress)) {
      bestByMintReason.set(key, candidate);
    }
  }
  return Array.from(bestByMintReason.values())
    .sort((a, b) => Number(a.atMs) - Number(b.atMs));
}

function exTop(values, topN = 3) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => Math.abs(b) - Math.abs(a));
  return sorted.slice(topN).reduce((total, value) => total + value, 0);
}

function splitHalf(rows, valueKey) {
  const sorted = rows.slice().sort((a, b) => Number(a.atMs) - Number(b.atMs));
  const midpoint = Math.ceil(sorted.length / 2);
  const first = sorted.slice(0, midpoint).map((row) => Number(row[valueKey])).filter(Number.isFinite);
  const second = sorted.slice(midpoint).map((row) => Number(row[valueKey])).filter(Number.isFinite);
  return {
    firstHalf: numericStats(first, 6),
    secondHalf: numericStats(second, 6)
  };
}

function summarizeCohort(name, rows) {
  const replayed = rows.filter((row) => row.replay?.replayClass === 'REPLAYED');
  const pnl = replayed.map((row) => row.replay.pnlSol).filter((value) => Number.isFinite(Number(value))).map(Number);
  const stressed = replayed.map((row) => row.replay.stressedPnlSol).filter((value) => Number.isFinite(Number(value))).map(Number);
  const wins = pnl.filter((value) => value > 0).length;
  const losses = pnl.filter((value) => value <= 0).length;
  const futureMeasured = rows.filter((row) => row.outcome300?.outcomeCoverage === 'MEASURED');
  const crossed90 = rows.filter((row) => row.outcome300?.crossed90).length;
  const exTop3 = compact(exTop(pnl, 3), 9);
  const stats = numericStats(pnl, 9);
  const verdict = (() => {
    if (rows.length < 30 || replayed.length < 30) return 'INSUFFICIENT_SAMPLE';
    if (stats.median > 0 && exTop3 >= 0) return 'PROMISING_REPORT_ONLY';
    if (stats.median > 0) return 'OUTLIER_DEPENDENT';
    return 'MEDIAN_NEGATIVE';
  })();
  return {
    name,
    rows: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    measured: futureMeasured.length,
    replayed: replayed.length,
    crossed90Within300s: crossed90,
    wins,
    losses,
    winRate: replayed.length ? compact(wins / replayed.length, 6) : null,
    pnl: stats,
    stressedPnl: numericStats(stressed, 9),
    exTop3PnlSol: exTop3,
    outlierDominated: stats.sum !== null && exTop3 !== null ? Math.sign(Number(stats.sum)) !== Math.sign(Number(exTop3)) : null,
    splitHalfPnl: splitHalf(replayed.map((row) => ({ ...row, pnlSol: row.replay.pnlSol })), 'pnlSol'),
    score: numericStats(rows.map((row) => row.score), 2),
    curveProgress: numericStats(rows.map((row) => row.curveProgress), 6),
    curveProgressDelta60s: numericStats(rows.map((row) => row.curveProgressDelta60s), 6),
    buyerSniperRatio: numericStats(rows.map((row) => row.buyerSniperRatio), 4),
    verdict
  };
}

function summarizeBuckets(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = `${row.ratioBand}__${row.sniperBand}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  return Array.from(buckets.entries())
    .map(([name, bucketRows]) => summarizeCohort(name, bucketRows))
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name));
}

function buildReport(files) {
  const scans = files.map(scanFile);
  const allCandidates = scans.flatMap((scan) => scan.candidates);
  const deduped = dedupeCandidates(allCandidates);
  const byReason = {};
  for (const reason of TARGET_REASONS) {
    byReason[reason] = summarizeCohort(reason, deduped.filter((row) => row.reason === reason));
  }
  const summaryCohort = summarizeCohort('all_advancing_high_curve_lane_gap', deduped);
  const verdict = (() => {
    if (summaryCohort.replayed < 30) return 'INSUFFICIENT_SAMPLE';
    if (summaryCohort.pnl.median > 0 && summaryCohort.exTop3PnlSol >= 0) return 'PROMISING_REPORT_ONLY';
    if (summaryCohort.pnl.median > 0) return 'OUTLIER_DEPENDENT';
    return 'MEDIAN_NEGATIVE';
  })();

  return {
    generatedAt: new Date().toISOString(),
    files: files.map((filePath) => path.relative(ROOT, filePath)),
    config: {
      population: 'curveProgress >= 0.85 AND decision-time curveProgressDelta60s > 0 AND blocked by first-sight override or curve-false-negative stalled-curve requirement',
      decisionTimeOnly: true,
      exitProfile: EXIT_PROFILE,
      amountSol: SIZE_SOL,
      feeSol: FEE_SOL
    },
    runStats: scans.map((scan) => ({
      telemetryPath: path.relative(ROOT, scan.filePath),
      firstEventAt: scan.firstMs === null ? null : new Date(scan.firstMs).toISOString(),
      lastEventAt: scan.lastMs === null ? null : new Date(scan.lastMs).toISOString(),
      rows: scan.stats.rows,
      malformedLines: scan.stats.malformedLines,
      rawCandidates: scan.candidates.length,
      uniqueCandidateMints: new Set(scan.candidates.map((row) => row.mint)).size
    })),
    summary: {
      verdict,
      rawCandidateRows: allCandidates.length,
      dedupedCandidateRows: deduped.length,
      uniqueMints: new Set(deduped.map((row) => row.mint)).size,
      all: summaryCohort,
      byReason,
      byCrowdingBreadth: summarizeBuckets(deduped),
      topReasons: topCounts(deduped.reduce((counts, row) => {
        bump(counts, row.reason);
        return counts;
      }, {}), 12)
    },
    rows: deduped
      .sort((a, b) => Number(b.outcome300?.crossed90 || 0) - Number(a.outcome300?.crossed90 || 0)
        || Number(b.replay?.pnlSol || -999) - Number(a.replay?.pnlSol || -999))
      .slice(0, 100)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let files = [];
  if (args.telemetry || args.file) {
    files = [repoPath(args.telemetry || args.file)];
  } else {
    files = telemetryFiles(Number(args.limit || DEFAULT_LIMIT));
  }
  files = files.filter((filePath) => filePath && fs.existsSync(filePath));
  if (!files.length) {
    console.error('No telemetry files found. Pass --telemetry <path> or keep run-logs telemetry files.');
    process.exit(1);
  }
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const report = buildReport(files);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = {
  buildReport,
  scanFile,
  summarizeCohort
};
