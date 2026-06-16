#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { scoreDecision } = require('./pre-migration-entry-gate-margin-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-candidate-attribution');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-candidate-attribution-latest.json');

const TRADE = {
  amountSol: 0.02,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5,
  takeProfitPct: 0.35,
  stopLossPct: 0.15,
  maxHoldSeconds: 300,
  stressExtraSlippagePct: 3
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
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload = {}) {
  const direct = Number(payload.providerCurvePriceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? payload.priceSol ?? payload.market?.priceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = Number(payload.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
}

function bump(counts, key, amount = 1) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + amount;
}

function updateMax(row, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  row[key] = row[key] === null ? number : Math.max(row[key], number);
}

function getRow(rowsByMint, mint, payload = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: payload.symbol || null,
      flaggedRows: 0,
      decisionRows: 0,
      guardRows: 0,
      entryRows: 0,
      firstFlaggedAtMs: null,
      firstDecisionAtMs: null,
      firstDecision: null,
      maxScore: null,
      maxCurveProgress: null,
      maxCurveProgressDelta60s: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxUniqueBuyerCount: null,
      maxSniperWalletCount: null,
      bestReadinessPct: null,
      skipReasons: {},
      tightestGates: {},
      guardReasons: {},
      failedChecks: {},
      wallet: {
        anyTrustedTouch: false,
        positiveOrProvenTouch: false,
        rawUntrustedTouch: false,
        rawUntrustedPre85Buy: false,
        noTrackedFirstTouchRows: 0
      }
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  return row;
}

function gateNameFromDecision(payload) {
  const margin = scoreDecision(payload);
  return {
    tightestGate: margin.tightest || null,
    readinessPct: margin.readinessPct
  };
}

function recordWallet(row, payload = {}) {
  const proof = payload.walletBridgeProof || {};
  const context = payload.walletClassificationContext || {};
  const trustedTouch = Number(proof.walletTouchCount || 0) > 0 || context.touched === true || context.shadowTouched === true;
  const positive = Number(proof.positiveOrProvenTouchCount || 0) > 0
    || Number(context.positiveTouchCount || context.provenTouchCount || context.provenBuyCount || 0) > 0;
  const untrustedTouch = Number(proof.untrustedWalletTouchCount || 0) > 0 || context.untrustedTouched === true;
  const untrustedPre85 = Number(proof.untrustedPre85BuyTouchCount || 0) > 0;
  row.wallet.anyTrustedTouch = row.wallet.anyTrustedTouch || trustedTouch;
  row.wallet.positiveOrProvenTouch = row.wallet.positiveOrProvenTouch || positive;
  row.wallet.rawUntrustedTouch = row.wallet.rawUntrustedTouch || untrustedTouch;
  row.wallet.rawUntrustedPre85Buy = row.wallet.rawUntrustedPre85Buy || untrustedPre85;
  if (payload.reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY'
    || payload.guardReason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') {
    row.wallet.noTrackedFirstTouchRows += 1;
  }
}

function snapshotFromFinalist(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.receivedAt || payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress) || !Number.isFinite(priceSol)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    curveProgress: compact(curveProgress, 6),
    priceSol: compact(priceSol, 15),
    updateSource: payload.updateSource || null,
    selectionClass: payload.selectionClass || null
  };
}

function scan(filePath) {
  const rowsByMint = new Map();
  const finalistSnapshotsByMint = new Map();
  const eventCounts = {};
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    bump(eventCounts, type);

    if (type === 'finalist_account_verifier.update') {
      const snapshot = snapshotFromFinalist(event);
      if (snapshot) {
        if (!finalistSnapshotsByMint.has(snapshot.mint)) finalistSnapshotsByMint.set(snapshot.mint, []);
        finalistSnapshotsByMint.get(snapshot.mint).push(snapshot);
      }
      return;
    }
    if (!mint) return;

    if (type !== 'pre_migration.flagged'
      && type !== 'pre_migration_paper.guard_attribution'
      && type !== 'pre_migration_paper.decision'
      && type !== 'pre_migration_paper.entry') return;

    const atMs = timestampMs(payload.timestamp || event.timestamp);
    const row = getRow(rowsByMint, mint, payload);
    updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
    updateMax(row, 'maxCurveProgress', curveOf(payload));
    updateMax(row, 'maxCurveProgressDelta60s', payload.curveProgressDelta60s);
    updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
    updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
    updateMax(row, 'maxUniqueBuyerCount', payload.uniqueBuyerCount);
    updateMax(row, 'maxSniperWalletCount', payload.sniperWalletCount);

    if (type === 'pre_migration.flagged') {
      row.flaggedRows += 1;
      if (Number.isFinite(atMs)) row.firstFlaggedAtMs = row.firstFlaggedAtMs === null ? atMs : Math.min(row.firstFlaggedAtMs, atMs);
      for (const reason of payload.reasons || []) bump(row.guardReasons, reason);
    } else if (type === 'pre_migration_paper.guard_attribution') {
      row.guardRows += 1;
      bump(row.guardReasons, payload.guardReason || payload.reason);
      for (const check of payload.failedChecks || []) bump(row.failedChecks, check);
      recordWallet(row, payload);
    } else if (type === 'pre_migration_paper.decision') {
      row.decisionRows += 1;
      if (payload.decision === 'PAPER_SKIPPED') bump(row.skipReasons, payload.reason);
      const gate = gateNameFromDecision(payload);
      bump(row.tightestGates, gate.tightestGate?.name || 'unknown');
      if (Number.isFinite(gate.readinessPct) && (row.bestReadinessPct === null || gate.readinessPct > row.bestReadinessPct)) {
        row.bestReadinessPct = gate.readinessPct;
      }
      if (!row.firstDecision && Number.isFinite(atMs) && Number.isFinite(priceOf(payload))) {
        row.firstDecisionAtMs = atMs;
        row.firstDecision = {
          at: new Date(atMs).toISOString(),
          priceSol: compact(priceOf(payload), 15),
          curveProgress: compact(curveOf(payload), 6),
          score: compact(payload.score, 4),
          reason: payload.reason || null,
          preset: payload.preset || null,
          tightestGate: gate.tightestGate || null,
          readinessPct: gate.readinessPct ?? null
        };
      }
      recordWallet(row, payload);
    } else if (type === 'pre_migration_paper.entry') {
      row.entryRows += 1;
    }
  });

  for (const snapshots of finalistSnapshotsByMint.values()) snapshots.sort((a, b) => a.atMs - b.atMs);
  return {
    filePath,
    stats,
    eventCounts,
    rows: Array.from(rowsByMint.values()).filter((row) => row.flaggedRows > 0 || row.decisionRows > 0 || row.guardRows > 0),
    finalistSnapshotsByMint
  };
}

function windowOutcome(row, snapshots, seconds) {
  const startMs = row.firstDecisionAtMs ?? row.firstFlaggedAtMs;
  const startCurve = Number(row.firstDecision?.curveProgress ?? row.maxCurveProgress);
  const startPrice = Number(row.firstDecision?.priceSol);
  if (!Number.isFinite(startMs)) return { seconds, futureSnapshotCount: 0, outcomeCoverage: 'INSUFFICIENT_OUTCOME_DATA' };
  const future = snapshots.filter((snapshot) => snapshot.atMs > startMs && snapshot.atMs <= startMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = future.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const priceDelta = Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null ? ((maxPrice - startPrice) / startPrice) * 100 : null;
  const cross = (threshold) => future.find((snapshot) => Number(snapshot.curveProgress) >= threshold && (!Number.isFinite(startCurve) || startCurve < threshold));
  return {
    seconds,
    futureSnapshotCount: future.length,
    outcomeCoverage: future.length > 0 ? 'MEASURED' : 'INSUFFICIENT_OUTCOME_DATA',
    maxCurveProgress: compact(maxCurve, 6),
    curveDelta: Number.isFinite(startCurve) && maxCurve !== null ? compact(maxCurve - startCurve, 6) : null,
    maxPriceDeltaPct: compact(priceDelta, 2),
    crossed85: Boolean(cross(0.85)),
    crossed90: Boolean(cross(0.9)),
    first85CrossAt: cross(0.85)?.at || null,
    first90CrossAt: cross(0.9)?.at || null
  };
}

function classify(row, window120, window300) {
  if (window300.outcomeCoverage !== 'MEASURED') return 'INSUFFICIENT_OUTCOME_DATA';
  if (window120.crossed90 || Number(window120.curveDelta) >= 0.1 || Number(window120.maxPriceDeltaPct) >= 35) return 'BLOCKED_STRONG_FOLLOW_THROUGH';
  if (window300.crossed85 || Number(window300.curveDelta) >= 0.05 || Number(window300.maxPriceDeltaPct) >= 20) return 'BLOCKED_USEFUL_FOLLOW_THROUGH';
  return 'CORRECTLY_BLOCKED_FLAT';
}

function replay(row, snapshots) {
  const entry = row.firstDecision;
  if (!entry || !Number.isFinite(row.firstDecisionAtMs) || !Number.isFinite(Number(entry.priceSol))) {
    return { replayClass: 'NO_ENTRY_DECISION_PRICE' };
  }
  const future = snapshots.filter((snapshot) => snapshot.atMs > row.firstDecisionAtMs && snapshot.atMs <= row.firstDecisionAtMs + TRADE.maxHoldSeconds * 1000);
  if (!future.length) return { replayClass: 'NO_FUTURE_SNAPSHOTS' };
  const entryFill = Number(entry.priceSol) * (1 + TRADE.entrySlippagePct / 100);
  let last = future[future.length - 1];
  for (const snapshot of future) {
    const exitFill = Number(snapshot.priceSol) * (1 - TRADE.exitSlippagePct / 100);
    const netReturn = (exitFill / entryFill) - 1;
    if (netReturn >= TRADE.takeProfitPct) return replayClose(snapshot, netReturn, 'TAKE_PROFIT');
    if (netReturn <= -TRADE.stopLossPct) return replayClose(snapshot, netReturn, 'STOP_LOSS');
    last = snapshot;
  }
  const exitFill = Number(last.priceSol) * (1 - TRADE.exitSlippagePct / 100);
  return replayClose(last, (exitFill / entryFill) - 1, 'MAX_HOLD');
}

function replayClose(snapshot, netReturn, exitReason) {
  const stressedReturn = netReturn - (TRADE.stressExtraSlippagePct / 100);
  return {
    replayClass: 'REPLAYED',
    exitAt: snapshot.at,
    exitReason,
    exitCurveProgress: snapshot.curveProgress,
    exitPriceSol: snapshot.priceSol,
    netReturnPct: compact(netReturn * 100, 4),
    pnlSol: compact(TRADE.amountSol * netReturn, 9),
    stressedPnlSol: compact(TRADE.amountSol * stressedReturn, 9)
  };
}

function topCounts(counts = {}, limit = 8) {
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit));
}

function buildRows(scanned) {
  return scanned.rows.map((row) => {
    const snapshots = scanned.finalistSnapshotsByMint.get(row.mint) || [];
    const window120 = windowOutcome(row, snapshots, 120);
    const window300 = windowOutcome(row, snapshots, 300);
    const classification = classify(row, window120, window300);
    return {
      mint: row.mint,
      symbol: row.symbol,
      flaggedRows: row.flaggedRows,
      guardRows: row.guardRows,
      decisionRows: row.decisionRows,
      entryRows: row.entryRows,
      firstFlaggedAt: row.firstFlaggedAtMs ? new Date(row.firstFlaggedAtMs).toISOString() : null,
      firstDecision: row.firstDecision,
      maxScore: compact(row.maxScore, 2),
      maxCurveProgress: compact(row.maxCurveProgress, 6),
      maxCurveProgressDelta60s: compact(row.maxCurveProgressDelta60s, 6),
      maxRecentVolumeSol: compact(row.maxRecentVolumeSol, 4),
      maxTradeVelocityPerMin: compact(row.maxTradeVelocityPerMin, 2),
      maxUniqueBuyerCount: compact(row.maxUniqueBuyerCount, 0),
      maxSniperWalletCount: compact(row.maxSniperWalletCount, 0),
      bestReadinessPct: compact(row.bestReadinessPct, 2),
      skipReasons: topCounts(row.skipReasons),
      tightestGates: topCounts(row.tightestGates),
      guardReasons: topCounts(row.guardReasons),
      failedChecks: topCounts(row.failedChecks),
      wallet: row.wallet,
      finalistSnapshotCount: snapshots.length,
      window120s: window120,
      window300s: window300,
      classification,
      replay: replay(row, snapshots)
    };
  });
}

function numericStats(values, digits = 6) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return { count: sorted.length, min: compact(sorted[0], digits), median: compact(pick(0.5), digits), p90: compact(pick(0.9), digits), max: compact(sorted[sorted.length - 1], digits), avg: compact(sum / sorted.length, digits) };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) bump(counts, keyFn(row));
  return topCounts(counts, 20);
}

function replaySummary(rows) {
  const replayed = rows.filter((row) => row.replay?.replayClass === 'REPLAYED');
  const wins = replayed.filter((row) => Number(row.replay.pnlSol) > 0);
  const totalPnlSol = replayed.reduce((sum, row) => sum + Number(row.replay.pnlSol || 0), 0);
  const stressedPnlSol = replayed.reduce((sum, row) => sum + Number(row.replay.stressedPnlSol || 0), 0);
  const top3 = replayed.map((row) => Number(row.replay.pnlSol) || 0).sort((a, b) => b - a).slice(0, 3).reduce((sum, value) => sum + value, 0);
  const midpoint = Math.ceil(replayed.length / 2);
  const firstHalf = replayed.slice(0, midpoint);
  const secondHalf = replayed.slice(midpoint);
  return {
    replayed: replayed.length,
    wins: wins.length,
    losses: replayed.filter((row) => Number(row.replay.pnlSol) < 0).length,
    winRate: replayed.length ? compact(wins.length / replayed.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    stressedPnlSol: compact(stressedPnlSol, 9),
    medianPnlSol: numericStats(replayed.map((row) => row.replay.pnlSol), 9).median,
    top3RemovedPnlSol: compact(totalPnlSol - top3, 9),
    firstHalfPnlSol: firstHalf.length ? compact(firstHalf.reduce((sum, row) => sum + Number(row.replay.pnlSol || 0), 0), 9) : null,
    secondHalfPnlSol: secondHalf.length ? compact(secondHalf.reduce((sum, row) => sum + Number(row.replay.pnlSol || 0), 0), 9) : null,
    exitReasonCounts: countBy(replayed, (row) => row.replay.exitReason)
  };
}

function buildReport(scanned) {
  const rows = buildRows(scanned);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_flagged_candidate_attribution_replay',
    telemetryPath: path.relative(ROOT, scanned.filePath),
    inputs: {
      trade: TRADE,
      telemetryRowsRead: scanned.stats.rows,
      malformedLines: scanned.stats.malformedLines
    },
    summary: {
      candidates: rows.length,
      flaggedMints: rows.filter((row) => row.flaggedRows > 0).length,
      evaluatedMints: rows.filter((row) => row.decisionRows > 0 || row.guardRows > 0).length,
      mintsWithFinalistSnapshots: rows.filter((row) => row.finalistSnapshotCount > 0).length,
      classificationCounts: countBy(rows, (row) => row.classification),
      skipReasonCounts: countBy(rows, (row) => Object.keys(row.skipReasons || {})[0]),
      tightestGateCounts: countBy(rows, (row) => Object.keys(row.tightestGates || {})[0]),
      walletCounts: {
        anyTrustedTouch: rows.filter((row) => row.wallet.anyTrustedTouch).length,
        positiveOrProvenTouch: rows.filter((row) => row.wallet.positiveOrProvenTouch).length,
        rawUntrustedTouch: rows.filter((row) => row.wallet.rawUntrustedTouch).length,
        rawUntrustedPre85Buy: rows.filter((row) => row.wallet.rawUntrustedPre85Buy).length,
        noTrackedFirstTouch: rows.filter((row) => row.wallet.noTrackedFirstTouchRows > 0).length
      },
      window120s: {
        measured: rows.filter((row) => row.window120s.outcomeCoverage === 'MEASURED').length,
        crossed85: rows.filter((row) => row.window120s.crossed85).length,
        crossed90: rows.filter((row) => row.window120s.crossed90).length,
        curveDelta: numericStats(rows.map((row) => row.window120s.curveDelta), 6),
        maxPriceDeltaPct: numericStats(rows.map((row) => row.window120s.maxPriceDeltaPct), 2)
      },
      window300s: {
        measured: rows.filter((row) => row.window300s.outcomeCoverage === 'MEASURED').length,
        crossed85: rows.filter((row) => row.window300s.crossed85).length,
        crossed90: rows.filter((row) => row.window300s.crossed90).length,
        curveDelta: numericStats(rows.map((row) => row.window300s.curveDelta), 6),
        maxPriceDeltaPct: numericStats(rows.map((row) => row.window300s.maxPriceDeltaPct), 2)
      },
      replay: replaySummary(rows),
      verdict: 'REPORT_ONLY_KEEP_GATES_UNCHANGED'
    },
    rows,
    topStrongFollowThrough: rows.filter((row) => row.classification === 'BLOCKED_STRONG_FOLLOW_THROUGH')
      .sort((a, b) => Number(b.window120s.maxPriceDeltaPct || 0) - Number(a.window120s.maxPriceDeltaPct || 0)).slice(0, 12),
    topUsefulFollowThrough: rows.filter((row) => row.classification === 'BLOCKED_USEFUL_FOLLOW_THROUGH')
      .sort((a, b) => Number(b.window300s.maxPriceDeltaPct || 0) - Number(a.window300s.maxPriceDeltaPct || 0)).slice(0, 12),
    topReplayWinners: rows.filter((row) => row.replay?.replayClass === 'REPLAYED').sort((a, b) => Number(b.replay.pnlSol || 0) - Number(a.replay.pnlSol || 0)).slice(0, 12),
    topReplayLosers: rows.filter((row) => row.replay?.replayClass === 'REPLAYED').sort((a, b) => Number(a.replay.pnlSol || 0) - Number(b.replay.pnlSol || 0)).slice(0, 12),
    note: 'Report-only per-candidate ledger for flagged/evaluated pre-migration mints. Joins decision-time gates to finalist-account-verifier outcome snapshots and counterfactual replay. It does not alter watch flags, gates, entries, exits, scoring, trust tiers, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found for flagged candidate attribution report.');
  const scanned = scan(telemetryPath);
  const report = buildReport(scanned);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = repoPath(args.output) || path.join(OUTPUT_DIR, `pre-migration-flagged-candidate-attribution-${stamp}.json`);
  writeJson(outputPath, report);
  writeJson(LATEST_PATH, report);
  console.log('Pre-Migration Flagged Candidate Attribution');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Candidates/flagged/evaluated: ${report.summary.candidates}/${report.summary.flaggedMints}/${report.summary.evaluatedMints}`);
  console.log(`Classifications: ${JSON.stringify(report.summary.classificationCounts)}`);
  console.log(`Replay: ${JSON.stringify(report.summary.replay)}`);
  console.log(`Wrote JSON report: ${outputPath}`);
  console.log(`Wrote latest JSON report: ${LATEST_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { buildReport, scan };
