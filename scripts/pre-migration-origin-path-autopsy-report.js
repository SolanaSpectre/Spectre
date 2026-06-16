#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { scoreDecision } = require('./pre-migration-entry-gate-margin-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-origin-path-autopsy-latest.json');
const SIZE_SOL = 0.02;
const FEE_SOL = 0.0005;
const EXIT_PROFILE = { name: 'origin_path_300s_tp35_sl15_slip3', holdSeconds: 300, takeProfitPct: 35, stopLossPct: -15, entrySlippagePct: 3, exitSlippagePct: 3, stressExtraSlippagePct: 3 };

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
    ?? payload.accountCurveProgress
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
    ?? payload.entryPriceSol
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
  return Object.fromEntries(Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit));
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

function walletSignals(payload = {}) {
  const proof = payload.walletBridgeProof || {};
  const context = payload.walletClassificationContext || {};
  const first = payload.positiveFirstTouch || payload.qualifyingFirstTouch || null;
  const wallets = Array.isArray(context.wallets) ? context.wallets : [];
  const positiveRows = wallets.filter((row) => row && (
    row.positiveOrProven === true
    || ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(row.evidenceTier)
    || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(row.reviewTier)
  ));
  const positive = Number(proof.positiveOrProvenTouchCount || 0) > 0
    || Number(context.positiveTouchCount || context.provenTouchCount || context.provenBuyCount || 0) > 0
    || Boolean(first && (first.positiveOrProven === true || first.evidenceTier === 'PROVEN_POSITIVE' || first.reviewTier === 'TRUST_REVIEW'))
    || positiveRows.length > 0;
  return {
    anyTrustedTouch: Number(proof.walletTouchCount || 0) > 0 || context.touched === true || context.shadowTouched === true || positive,
    positiveOrProvenTouch: positive,
    positiveFirstTouch: first || positiveRows[0] || null,
    avoidOrNegativeTouch: Number(proof.avoidTouchCount || 0) > 0 || Number(context.avoidOrNegativeTouchCount || 0) > 0
  };
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || payload.receivedAt || event.timestamp);
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
    type: eventType(event)
  };
}

function candidateFromEvent(event, kind) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const margin = scoreDecision(payload);
  const wallet = walletSignals(payload);
  const preset = payload.preset || payload.sourcePreset || null;
  const lane = payload.lane || payload.sourceLane || null;
  return {
    kind,
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    preset,
    lane,
    profileName: payload.profileName || null,
    reason: payload.reason || payload.guardReason || payload.sourceReason || null,
    failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : [],
    readinessPct: compact(margin.readinessPct, 2),
    tightestGate: margin.tightest || null,
    score: compact(payload.score ?? payload.entryScore, 2),
    curveProgress: compact(curveOf(payload), 6),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    buyRatio: compact(payload.buyRatio, 4),
    uniqueBuyerCount: compact(payload.uniqueBuyerCount, 0),
    sniperWalletCount: compact(payload.sniperWalletCount, 0),
    priceSol: compact(priceOf(payload), 15),
    entryPriceSol: compact(payload.entryPriceSol, 15),
    pnlSol: compact(payload.pnlSol ?? payload.paper?.pnlSol, 9),
    wallet,
    isHighConvictionPath: preset === 'highConvictionFirstSight'
      || lane === 'PRE_MIGRATION_SNIPE'
      || payload.profileName === 'pre_migration_snipe'
  };
}

function paperExitFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    exitReason: payload.reason || payload.exitReason || null,
    pnlSol: compact(payload.pnlSol ?? payload.paper?.pnlSol, 9),
    stressedPnlSol: compact(payload.pnlSol ?? payload.paper?.pnlSol, 9),
    returnPct: compact(payload.returnPct, 6),
    holdSeconds: compact(payload.holdSeconds, 2),
    exitPriceSol: compact(payload.exitPriceSol, 15),
    exitCurveProgress: compact(payload.exitCurveProgress ?? payload.curveProgress, 6)
  };
}

function isOriginPathCandidate(row) {
  if (!row || !row.isHighConvictionPath) return false;
  if (!row.wallet.positiveOrProvenTouch) return false;
  if (row.wallet.avoidOrNegativeTouch) return false;
  if (row.kind === 'paper_entry') return true;
  if (Number(row.readinessPct) >= 90) return true;
  return ['PRESET_NOT_ELIGIBLE_FOR_GUARD_OVERRIDE', 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE', 'HIGH_CONVICTION_FIRST_SIGHT_REQUIRES_WALLET_CONTEXT', 'LOW_SCORE']
    .includes(row.reason)
    || row.failedChecks.includes('PRESET_NOT_ELIGIBLE_FOR_GUARD_OVERRIDE');
}

function replay(row, snapshots) {
  const entryMs = Number(row.atMs);
  const entryPriceRaw = Number(row.entryPriceSol ?? row.priceSol);
  if (!Number.isFinite(entryMs) || !Number.isFinite(entryPriceRaw) || entryPriceRaw <= 0) return { replayClass: 'NO_ENTRY_PRICE' };
  const path = snapshots
    .filter((snapshot) => snapshot.atMs > entryMs && snapshot.atMs <= entryMs + EXIT_PROFILE.holdSeconds * 1000)
    .filter((snapshot) => Number.isFinite(Number(snapshot.priceSol)) && Number(snapshot.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!path.length) return { replayClass: 'NO_FUTURE_PRICE' };
  const entryPrice = entryPriceRaw * (1 + EXIT_PROFILE.entrySlippagePct / 100);
  const takeProfit = entryPrice * (1 + EXIT_PROFILE.takeProfitPct / 100);
  const stopLoss = entryPrice * (1 + EXIT_PROFILE.stopLossPct / 100);
  let exit = path[path.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const snapshot of path) {
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
  const maxPrice = Math.max(...path.map((snapshot) => Number(snapshot.priceSol)));
  return {
    replayClass: 'REPLAYED',
    exitReason,
    holdSeconds: compact((exit.atMs - entryMs) / 1000, 1),
    grossReturnPct: compact(grossReturn * 100, 4),
    pnlSol: compact(SIZE_SOL * grossReturn - FEE_SOL, 9),
    stressedPnlSol: compact(SIZE_SOL * stressedReturn - FEE_SOL, 9),
    maxPriceDeltaPct: compact(((maxPrice - entryPrice) / entryPrice) * 100, 2)
  };
}

function scan(filePath) {
  const candidates = [];
  const snapshotsByMint = new Map();
  const paperExitsByMint = new Map();
  const eventCounts = {};
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    const payload = payloadOf(event);
    bump(eventCounts, type);
    if (type === 'finalist_account_verifier.update' || type === 'pump_bonding_curve.provider_snapshot' || type === 'pre_migration.observed' || type === 'pre_migration.flagged') {
      const snapshot = snapshotFromEvent(event);
      if (snapshot) {
        if (!snapshotsByMint.has(snapshot.mint)) snapshotsByMint.set(snapshot.mint, []);
        snapshotsByMint.get(snapshot.mint).push(snapshot);
      }
    }
    if (type === 'pre_migration_paper.guard_attribution' || type === 'pre_migration_paper.decision') {
      const candidate = candidateFromEvent(event, 'near_miss');
      if (isOriginPathCandidate(candidate)) candidates.push(candidate);
    }
    if (type === 'pre_migration_paper.entry') {
      const candidate = candidateFromEvent(event, 'paper_entry');
      if (isOriginPathCandidate(candidate)) candidates.push(candidate);
    }
    if (type === 'pre_migration_paper.exit') {
      const paperExit = paperExitFromEvent(event);
      if (paperExit) paperExitsByMint.set(paperExit.mint, paperExit);
    }
  }, { bufferSize: 1024 * 1024 });
  for (const snapshots of snapshotsByMint.values()) snapshots.sort((a, b) => a.atMs - b.atMs);
  return { candidates, snapshotsByMint, paperExitsByMint, eventCounts, stats };
}

function dedupeCandidates(candidates) {
  const picked = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.mint}:${candidate.kind === 'paper_entry' ? 'paper_entry' : 'near_miss'}`;
    const existing = picked.get(key);
    if (!existing || candidate.atMs < existing.atMs || (candidate.kind === 'paper_entry' && existing.kind !== 'paper_entry')) {
      picked.set(key, candidate);
    }
  }
  return Array.from(picked.values()).sort((a, b) => a.atMs - b.atMs);
}

function summarize(rows) {
  const replayed = rows.map((row) => row.replay).filter((row) => row.replayClass === 'REPLAYED');
  const actualPaperOutcomes = rows.map((row) => row.replay).filter((row) => row.replayClass === 'ACTUAL_PAPER_ENTRY');
  const outcomeRows = rows.map((row) => row.replay).filter((row) => ['REPLAYED', 'ACTUAL_PAPER_ENTRY'].includes(row.replayClass));
  const pnls = outcomeRows.map((row) => Number(row.pnlSol)).filter(Number.isFinite);
  const stressed = outcomeRows.map((row) => Number(row.stressedPnlSol)).filter(Number.isFinite);
  const wins = pnls.filter((value) => value > 0).length;
  return {
    rows: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    paperEntries: rows.filter((row) => row.kind === 'paper_entry').length,
    nearMisses: rows.filter((row) => row.kind === 'near_miss').length,
    highConvictionRows: rows.filter((row) => row.isHighConvictionPath).length,
    positiveWalletRows: rows.filter((row) => row.wallet?.positiveOrProvenTouch).length,
    provenWalletRows: rows.filter((row) => row.wallet?.positiveOrProvenTouch).length,
    replayed: replayed.length,
    actualPaperOutcomes: actualPaperOutcomes.length,
    wins,
    losses: outcomeRows.length - wins,
    winRate: outcomeRows.length ? compact(wins / outcomeRows.length, 4) : null,
    pnlSol: compact(pnls.reduce((sum, value) => sum + value, 0), 9),
    stressedPnlSol: compact(stressed.reduce((sum, value) => sum + value, 0), 9),
    medianPnlSol: numericStats(pnls, 9).median,
    readinessPct: numericStats(rows.map((row) => row.readinessPct), 2),
    curveProgress: numericStats(rows.map((row) => row.curveProgress), 6),
    reasons: topCounts(rows.reduce((counts, row) => {
      bump(counts, row.reason);
      return counts;
    }, {}), 10),
    verdict: rows.length === 0
      ? 'NO_ORIGIN_PATH_CANDIDATES'
      : rows.length < 10
        ? 'INSUFFICIENT_ORIGIN_PATH_SAMPLE'
        : Number(numericStats(pnls, 9).median || 0) <= 0
          ? 'ORIGIN_PATH_MEDIAN_NEGATIVE'
          : 'ORIGIN_PATH_PROMISING_SHADOW_ONLY'
  };
}

function buildReport(filePath) {
  const scanned = scan(filePath);
  const rows = dedupeCandidates(scanned.candidates).map((candidate) => {
    const actualExit = candidate.kind === 'paper_entry' ? scanned.paperExitsByMint.get(candidate.mint) : null;
    const enriched = actualExit
      ? { ...candidate, pnlSol: actualExit.pnlSol, actualExit }
      : candidate;
    return {
      ...enriched,
      replay: enriched.kind === 'paper_entry' && Number.isFinite(Number(enriched.pnlSol))
        ? {
          replayClass: 'ACTUAL_PAPER_ENTRY',
          pnlSol: enriched.pnlSol,
          stressedPnlSol: enriched.pnlSol,
          exitReason: actualExit?.exitReason || 'ACTUAL',
          holdSeconds: actualExit?.holdSeconds ?? null,
          returnPct: actualExit?.returnPct ?? null
        }
        : replay(enriched, scanned.snapshotsByMint.get(enriched.mint) || [])
    };
  });
  const replayComparable = rows.map((row) => ({
    ...row,
    replay: row.replay.replayClass === 'ACTUAL_PAPER_ENTRY'
      ? replay(row, scanned.snapshotsByMint.get(row.mint) || [])
      : row.replay
  }));
  return {
    generatedAt: new Date().toISOString(),
    telemetryPath: path.relative(ROOT, filePath),
    mode: 'report_only_origin_path_autopsy',
    summary: summarize(rows),
    replayComparableSummary: summarize(replayComparable),
    exitProfile: EXIT_PROFILE,
    eventCounts: topCounts(scanned.eventCounts, 20),
    jsonlRowsScanned: scanned.stats.rows,
    malformedLines: scanned.stats.malformedLines,
    rows
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

module.exports = { buildReport, scan };
