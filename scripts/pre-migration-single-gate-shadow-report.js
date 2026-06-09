#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  parseArgs,
  readDecisions
} = require('./pre-migration-entry-gate-margin-report');

const ROOT = path.join(__dirname, '..');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-single-gate-shadow-latest.json');
const WINDOWS_SECONDS = [120, 300];
const SAMPLE_LIMIT = 12;
const MIN_READINESS_PCT = 80;
const MAX_SCORE_GAP = 8;
const DEFAULT_SIZE_SOL = 0.05;
const DEFAULT_FEE_SOL = 0.0005;
const REPLAY_PROFILES = [
  { name: 'single_gate_120s_tp50_sl25_slip3', holdSeconds: 120, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 3, exitSlippagePct: 3 },
  { name: 'single_gate_300s_tp50_sl25_slip3', holdSeconds: 300, takeProfitPct: 50, stopLossPct: -25, entrySlippagePct: 3, exitSlippagePct: 3 },
  { name: 'single_gate_120s_tp35_sl20_slip5', holdSeconds: 120, takeProfitPct: 35, stopLossPct: -20, entrySlippagePct: 5, exitSlippagePct: 5 },
  { name: 'single_gate_300s_tp35_sl20_slip5', holdSeconds: 300, takeProfitPct: 35, stopLossPct: -20, entrySlippagePct: 5, exitSlippagePct: 5 }
];

const PROTECTED_GATES = new Set([
  'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_MISSING_ONCHAIN_CURVE_PARITY',
  'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_CURVE_PARITY_MISMATCH',
  'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_NO_CURVE_RECOVERY',
  'CURVE_NOT_ADVANCING',
  'NO_PRIOR_CURVE_PROGRESS',
  'MISSING_PRICE'
]);

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function telemetryFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return report.files?.telemetryPath || report.telemetryPath || null;
  } catch {
    return null;
  }
}

function latestTelemetryFile() {
  const logDir = path.join(ROOT, 'run-logs');
  if (!fs.existsSync(logDir)) return null;
  return fs.readdirSync(logDir)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(logDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.curveParity?.providerCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function priceOf(payload) {
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function recoveryShadowFromEvent(event, telemetryPath) {
  const type = eventType(event);
  if (!type.startsWith('pre_migration_curve_false_negative_recovery_shadow.')) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    sourceKind: 'recovery_shadow',
    telemetryPath,
    mint,
    symbol: payload.symbol || null,
    at: new Date(atMs).toISOString(),
    atMs,
    preset: payload.preset || 'curveFalseNegativeWalletBridge',
    lane: payload.lane || 'PRE_MIGRATION_CURVE_FALSE_NEGATIVE_BRIDGE',
    profileName: payload.profileName || null,
    reason: payload.reason || 'unknown',
    score: numberOrNull(payload.score, 4),
    threshold: numberOrNull(payload.thresholdDecision?.threshold, 4),
    curveProgress: numberOrNull(curveOf(payload), 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    recentVolumeSol: numberOrNull(payload.recentVolumeSol, 6),
    tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 6),
    uniqueBuyerCount: numberOrNull(payload.uniqueBuyerCount, 0),
    sniperWalletCount: numberOrNull(payload.sniperWalletCount, 0),
    failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : [],
    reasons: [],
    tightestGate: payload.thresholdDecision?.reason === 'LOW_SCORE'
      ? {
          name: 'score',
          actual: numberOrNull(payload.thresholdDecision.value ?? payload.score, 4),
          threshold: numberOrNull(payload.thresholdDecision.threshold, 4),
          mode: 'min',
          ratio: Number.isFinite(Number(payload.thresholdDecision.value)) && Number.isFinite(Number(payload.thresholdDecision.threshold)) && Number(payload.thresholdDecision.threshold) > 0
            ? numberOrNull(Number(payload.thresholdDecision.value) / Number(payload.thresholdDecision.threshold), 6)
            : null
        }
      : null,
    blockingGateCount: Array.isArray(payload.failedChecks) ? payload.failedChecks.length : 0,
    readinessPct: payload.thresholdDecision?.reason === 'LOW_SCORE' && Number.isFinite(Number(payload.thresholdDecision.value)) && Number.isFinite(Number(payload.thresholdDecision.threshold)) && Number(payload.thresholdDecision.threshold) > 0
      ? numberOrNull((Number(payload.thresholdDecision.value) / Number(payload.thresholdDecision.threshold)) * 100, 2)
      : null,
    checks: []
  };
}

async function readRecoveryShadows(filePath) {
  const telemetryPath = path.relative(ROOT, filePath);
  const rows = [];
  let malformedLines = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    const row = recoveryShadowFromEvent(event, telemetryPath);
    if (row) rows.push(row);
  }
  return { rows, malformedLines };
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: numberOrNull(finite[0], digits),
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function uniqueFailures(row) {
  const failures = Array.isArray(row.failedChecks) && row.failedChecks.length
    ? row.failedChecks
    : [row.reason || 'unknown'];
  return [...new Set(failures.filter(Boolean))];
}

function firstCross(snapshots, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function followThroughWindow(row, snapshots, seconds) {
  const future = snapshots.filter((snapshot) => snapshot.atMs > row.atMs && snapshot.atMs <= row.atMs + seconds * 1000);
  const curves = future.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = future.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const startPrice = Number(row.priceSol);
  const curveDelta = maxCurve !== null && Number.isFinite(Number(row.curveProgress))
    ? maxCurve - Number(row.curveProgress)
    : null;
  const maxPriceDeltaPct = Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null
    ? ((maxPrice - startPrice) / startPrice) * 100
    : null;
  const startCurve = Number(row.curveProgress);
  const startedAt85 = Number.isFinite(startCurve) && startCurve >= 0.85;
  const startedAt90 = Number.isFinite(startCurve) && startCurve >= 0.9;
  const crossed85 = firstCross(future, 0.85, startCurve);
  const crossed90 = firstCross(future, 0.9, startCurve);
  const crossed95 = firstCross(future, 0.95, startCurve);
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    curveDelta: numberOrNull(curveDelta, 6),
    maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 2),
    reached85WithinWindow: startedAt85 || Boolean(crossed85),
    reached90WithinWindow: startedAt90 || Boolean(crossed90),
    crossed85AfterSkip: Boolean(crossed85),
    crossed90AfterSkip: Boolean(crossed90),
    crossed95AfterSkip: Boolean(crossed95),
    first85CrossAt: crossed85?.at || null,
    first90CrossAt: crossed90?.at || null,
    first95CrossAt: crossed95?.at || null
  };
}

function gateMargin(row, gate) {
  const check = Array.isArray(row.checks)
    ? row.checks.find((item) => item.name === row.tightestGate?.name || item.name === gate || item.name.endsWith(`.${gate}`))
    : null;
  const actual = Number(check?.actual ?? row.score);
  const threshold = Number(check?.threshold ?? row.threshold);
  const absoluteGap = Number.isFinite(actual) && Number.isFinite(threshold)
    ? threshold - actual
    : null;
  return {
    tightestGate: row.tightestGate || null,
    readinessPct: row.readinessPct ?? null,
    absoluteGap: numberOrNull(absoluteGap, 6),
    isScoreMargin: gate === 'LOW_SCORE' && Number.isFinite(absoluteGap) && absoluteGap >= 0 && absoluteGap <= MAX_SCORE_GAP,
    isNearReadiness: Number(row.readinessPct) >= MIN_READINESS_PCT
  };
}

function classifyRow(row, snapshotsByMint) {
  const failures = uniqueFailures(row);
  const singleGate = failures.length === 1 ? failures[0] : null;
  const protectedGate = singleGate ? PROTECTED_GATES.has(singleGate) : false;
  const margin = singleGate ? gateMargin(row, singleGate) : null;
  const windows = {};
  const snapshots = snapshotsByMint.get(row.mint) || [];
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = followThroughWindow(row, snapshots, seconds);
  }
  const safeTestCandidate = Boolean(
    singleGate
    && !protectedGate
    && (margin?.isScoreMargin || margin?.isNearReadiness)
  );
  return {
    ...row,
    sourceKind: row.sourceKind || 'paper_decision',
    failures,
    failureCount: failures.length,
    singleGate,
    protectedGate,
    margin,
    safeTestCandidate,
    windows
  };
}

function summarizeRows(rows) {
  const uniqueByMint = new Map();
  for (const row of rows) {
    const prev = uniqueByMint.get(row.mint);
    const prevDelta = Number(prev?.windows?.['300s']?.curveDelta ?? -Infinity);
    const nextDelta = Number(row.windows?.['300s']?.curveDelta ?? -Infinity);
    if (!prev || nextDelta > prevDelta) uniqueByMint.set(row.mint, row);
  }
  const uniqueRows = Array.from(uniqueByMint.values());
  const w120 = rows.map((row) => row.windows?.['120s'] || {});
  const w300 = rows.map((row) => row.windows?.['300s'] || {});
  const uniqueW300 = uniqueRows.map((row) => row.windows?.['300s'] || {});
  return {
    rows: rows.length,
    uniqueMints: uniqueRows.length,
    crossed85Within120s: w120.filter((row) => row.crossed85AfterSkip).length,
    crossed90Within120s: w120.filter((row) => row.crossed90AfterSkip).length,
    crossed90Within300s: w300.filter((row) => row.crossed90AfterSkip).length,
    uniqueMintsCrossed90Within300s: uniqueW300.filter((row) => row.crossed90AfterSkip).length,
    crossed90Within300sRate: rows.length ? numberOrNull(w300.filter((row) => row.crossed90AfterSkip).length / rows.length, 4) : null,
    curveDelta120s: stat(w120.map((row) => row.curveDelta), 6),
    curveDelta300s: stat(w300.map((row) => row.curveDelta), 6),
    maxPriceDeltaPct120s: stat(w120.map((row) => row.maxPriceDeltaPct), 2),
    maxPriceDeltaPct300s: stat(w300.map((row) => row.maxPriceDeltaPct), 2)
  };
}

function summarizeReplayRows(rows) {
  const pnl = rows.map((row) => Number(row.pnlSol)).filter(Number.isFinite);
  const winners = pnl.filter((value) => value > 0).sort((a, b) => b - a);
  const totalPnlSol = pnl.reduce((sum, value) => sum + value, 0);
  const topWinnerPnlSol = winners[0] || 0;
  const top3WinnerPnlSol = winners.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const wins = rows.filter((row) => Number(row.pnlSol) > 0).length;
  const losses = rows.filter((row) => Number(row.pnlSol) < 0).length;
  return {
    trades: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    wins,
    losses,
    winRate: wins + losses > 0 ? numberOrNull(wins / (wins + losses), 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    pnlAfterRemovingTopWinnerSol: numberOrNull(totalPnlSol - topWinnerPnlSol, 9),
    pnlAfterRemovingTop3WinnersSol: numberOrNull(totalPnlSol - top3WinnerPnlSol, 9),
    topWinnerShareOfGrossProfit: winners.length && winners.reduce((sum, value) => sum + value, 0) > 0
      ? numberOrNull(topWinnerPnlSol / winners.reduce((sum, value) => sum + value, 0), 4)
      : null,
    pnlSol: stat(pnl, 9),
    returnPct: stat(rows.map((row) => row.returnPct), 4),
    rawReturnPct: stat(rows.map((row) => row.rawReturnPct), 4),
    exitReasons: countBy(rows, (row) => row.exitReason)
  };
}

function replayRow(row, snapshotsByMint, profile, sizeSol = DEFAULT_SIZE_SOL, feeSol = DEFAULT_FEE_SOL) {
  const entryPrice = Number(row.priceSol);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const snapshots = (snapshotsByMint.get(row.mint) || [])
    .filter((snapshot) => snapshot.atMs > row.atMs && snapshot.atMs <= row.atMs + profile.holdSeconds * 1000)
    .filter((snapshot) => Number.isFinite(Number(snapshot.priceSol)) && Number(snapshot.priceSol) > 0)
    .sort((a, b) => a.atMs - b.atMs);
  if (!snapshots.length) return null;

  const effectiveEntryPrice = entryPrice * (1 + Number(profile.entrySlippagePct || 0) / 100);
  let exit = snapshots[snapshots.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const snapshot of snapshots) {
    const effectiveExitPrice = Number(snapshot.priceSol) * (1 - Number(profile.exitSlippagePct || 0) / 100);
    const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
    if (returnPct <= profile.stopLossPct) {
      exit = snapshot;
      exitReason = 'STOP_LOSS';
      break;
    }
    if (returnPct >= profile.takeProfitPct) {
      exit = snapshot;
      exitReason = 'TAKE_PROFIT';
      break;
    }
  }

  const exitPrice = Number(exit.priceSol);
  const effectiveExitPrice = exitPrice * (1 - Number(profile.exitSlippagePct || 0) / 100);
  const rawReturnPct = ((exitPrice / entryPrice) - 1) * 100;
  const returnPct = ((effectiveExitPrice / effectiveEntryPrice) - 1) * 100;
  return {
    profile: profile.name,
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    entryAt: row.at,
    exitAt: exit.at,
    reason: row.reason,
    singleGate: row.singleGate,
    safeTestCandidate: row.safeTestCandidate,
    score: row.score,
    threshold: row.threshold,
    readinessPct: row.readinessPct,
    entryCurveProgress: row.curveProgress,
    exitCurveProgress: numberOrNull(exit.curveProgress, 6),
    holdSeconds: numberOrNull((exit.atMs - row.atMs) / 1000, 3),
    rawReturnPct: numberOrNull(rawReturnPct, 4),
    returnPct: numberOrNull(returnPct, 4),
    pnlSol: numberOrNull(sizeSol * (returnPct / 100) - feeSol, 9),
    exitReason
  };
}

function replayRowsByProfile(rows, snapshotsByMint) {
  return Object.fromEntries(REPLAY_PROFILES.map((profile) => {
    const replayRows = rows
      .map((row) => replayRow(row, snapshotsByMint, profile))
      .filter(Boolean);
    return [profile.name, summarizeReplayRows(replayRows)];
  }));
}

function replayByGateProfile(rows, snapshotsByMint) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.singleGate || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries(
    Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([gate, gateRows]) => [gate, {
        rows: gateRows.length,
        uniqueMints: new Set(gateRows.map((row) => row.mint)).size,
        profiles: replayRowsByProfile(uniqueMintRows(gateRows), snapshotsByMint)
      }])
  );
}

function uniqueMintRows(rows) {
  const uniqueByMint = new Map();
  for (const row of rows) {
    const prev = uniqueByMint.get(row.mint);
    const prevCross90 = prev?.windows?.['300s']?.crossed90AfterSkip === true ? 1 : 0;
    const nextCross90 = row.windows?.['300s']?.crossed90AfterSkip === true ? 1 : 0;
    const prevDelta = Number(prev?.windows?.['300s']?.curveDelta ?? -Infinity);
    const nextDelta = Number(row.windows?.['300s']?.curveDelta ?? -Infinity);
    if (
      !prev
      || nextCross90 > prevCross90
      || (nextCross90 === prevCross90 && nextDelta > prevDelta)
    ) {
      uniqueByMint.set(row.mint, row);
    }
  }
  return Array.from(uniqueByMint.values());
}

function summarizeUniqueMints(rows) {
  const uniqueRows = uniqueMintRows(rows);
  return {
    ...summarizeRows(uniqueRows),
    duplicateRowsCollapsed: rows.length - uniqueRows.length
  };
}

function sampleRow(row) {
  return {
    at: row.at,
    mint: row.mint,
    symbol: row.symbol,
    preset: row.preset,
    reason: row.reason,
    singleGate: row.singleGate,
    protectedGate: row.protectedGate,
    safeTestCandidate: row.safeTestCandidate,
    score: row.score,
    threshold: row.threshold,
    curveProgress: row.curveProgress,
    readinessPct: row.readinessPct,
    margin: row.margin,
    window120s: row.windows?.['120s'] || null,
    window300s: row.windows?.['300s'] || null
  };
}

function groupByGate(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.singleGate || 'multi_gate';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries(
    Array.from(groups.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([gate, groupRows]) => {
        const top = groupRows
          .slice()
          .sort((a, b) => (
            Number(b.windows?.['300s']?.curveDelta ?? -Infinity) - Number(a.windows?.['300s']?.curveDelta ?? -Infinity)
            || Number(b.readinessPct ?? -Infinity) - Number(a.readinessPct ?? -Infinity)
          ))
          .slice(0, SAMPLE_LIMIT)
          .map(sampleRow);
        return [gate, {
          protectedGate: PROTECTED_GATES.has(gate),
          summary: summarizeRows(groupRows),
          byReason: countBy(groupRows, (row) => row.reason),
          topFollowThrough: top
        }];
      })
  );
}

function datasetSummary(rows) {
  const singleGateRows = rows.filter((row) => row.failureCount === 1);
  const multiGateRows = rows.filter((row) => row.failureCount !== 1);
  const safeTestRows = singleGateRows.filter((row) => row.safeTestCandidate);
  const singleGateUnprotectedRows = singleGateRows.filter((row) => !row.protectedGate);
  const singleGateProtectedRows = singleGateRows.filter((row) => row.protectedGate);
  return {
    rows: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    singleGateRows: singleGateRows.length,
    singleGateUniqueMints: new Set(singleGateRows.map((row) => row.mint)).size,
    multiGateRows: multiGateRows.length,
    protectedSingleGateRows: singleGateProtectedRows.length,
    unprotectedSingleGateRows: singleGateUnprotectedRows.length,
    safeTestCandidateRows: safeTestRows.length,
    safeTestCandidateUniqueMints: new Set(safeTestRows.map((row) => row.mint)).size,
    failureCountCounts: countBy(rows, (row) => String(row.failureCount)),
    singleGateCounts: countBy(singleGateRows, (row) => row.singleGate),
    protectedSingleGateCounts: countBy(singleGateProtectedRows, (row) => row.singleGate),
    unprotectedSingleGateCounts: countBy(singleGateUnprotectedRows, (row) => row.singleGate),
    all: summarizeRows(rows),
    singleGate: summarizeRows(singleGateRows),
    unprotectedSingleGate: summarizeRows(singleGateUnprotectedRows),
    safeTestCandidates: summarizeRows(safeTestRows),
    safeTestCandidatesUniqueMints: summarizeUniqueMints(safeTestRows)
  };
}

function buildReport(run, recoveryRows = [], recoveryMalformedLines = 0) {
  const paperAnalyzed = run.decisions.map((row) => classifyRow(row, run.snapshotsByMint));
  const recoveryAnalyzed = recoveryRows.map((row) => classifyRow(row, run.snapshotsByMint));
  const analyzed = [...paperAnalyzed, ...recoveryAnalyzed];
  const singleGateRows = analyzed.filter((row) => row.failureCount === 1);
  const multiGateRows = analyzed.filter((row) => row.failureCount !== 1);
  const safeTestRows = singleGateRows.filter((row) => row.safeTestCandidate);
  const singleGateUnprotectedRows = singleGateRows.filter((row) => !row.protectedGate);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_leave_one_out_single_gate_shadow',
    note: 'Isolates skipped pre-migration paper decisions that fail exactly one recorded gate, then follows 120s/300s outcomes. It does not alter runtime gates, entries, exits, AI review, quotes, or live behavior.',
    source: {
      telemetryPath: run.telemetryPath,
      startAt: run.startAt,
      endAt: run.endAt,
      malformedLines: run.malformedLines + recoveryMalformedLines
    },
    policy: {
      protectedGates: Array.from(PROTECTED_GATES),
      minReadinessPct: MIN_READINESS_PCT,
      maxScoreGap: MAX_SCORE_GAP,
      promotionHint: 'Do not promote unless a specific single-gate slice accumulates >=30 safe-test rows, >=40% cross90 within 300s, positive median simulated PnL, top-3-winner robustness, and split-half stability.'
    },
    replay: {
      assumptions: {
        sizeSol: DEFAULT_SIZE_SOL,
        feeSol: DEFAULT_FEE_SOL,
        profiles: REPLAY_PROFILES,
        caveat: 'Report-only observed-path replay over provider price snapshots. It does not model quote availability, MEV, exact liquidity, latency, or transaction landing.'
      },
      safeTestByProfile: replayRowsByProfile(safeTestRows, run.snapshotsByMint),
      safeTestUniqueMintsByProfile: replayRowsByProfile(uniqueMintRows(safeTestRows), run.snapshotsByMint),
      unprotectedSingleGateUniqueByGateProfile: replayByGateProfile(singleGateUnprotectedRows, run.snapshotsByMint)
    },
    summary: datasetSummary(analyzed),
    bySource: {
      paperDecision: datasetSummary(paperAnalyzed),
      recoveryShadow: datasetSummary(recoveryAnalyzed)
    },
    sourceCounts: countBy(analyzed, (row) => row.sourceKind),
    bySingleGate: groupByGate(singleGateRows),
    topSafeTestCandidates: safeTestRows
      .slice()
      .sort((a, b) => (
        Number(b.windows?.['300s']?.curveDelta ?? -Infinity) - Number(a.windows?.['300s']?.curveDelta ?? -Infinity)
        || Number(b.readinessPct ?? -Infinity) - Number(a.readinessPct ?? -Infinity)
      ))
      .slice(0, SAMPLE_LIMIT)
      .map(sampleRow),
    topSafeTestMints: uniqueMintRows(safeTestRows)
      .slice()
      .sort((a, b) => (
        Number(b.windows?.['300s']?.curveDelta ?? -Infinity) - Number(a.windows?.['300s']?.curveDelta ?? -Infinity)
        || Number(b.readinessPct ?? -Infinity) - Number(a.readinessPct ?? -Infinity)
      ))
      .slice(0, SAMPLE_LIMIT)
      .map(sampleRow),
    topSingleGateFollowThrough: singleGateRows
      .slice()
      .sort((a, b) => Number(b.windows?.['300s']?.curveDelta ?? -Infinity) - Number(a.windows?.['300s']?.curveDelta ?? -Infinity))
      .slice(0, SAMPLE_LIMIT)
      .map(sampleRow),
    sampleMultiGateRows: multiGateRows.slice(0, SAMPLE_LIMIT).map(sampleRow)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`No telemetry file found: ${telemetryPath || '(none)'}`);
  }
  const run = await readDecisions(telemetryPath);
  const recovery = await readRecoveryShadows(telemetryPath);
  const report = buildReport(run, recovery.rows, recovery.malformedLines);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`Single-gate rows: ${report.summary.singleGateRows}; safe-test candidates: ${report.summary.safeTestCandidateRows}; recovery-shadow single-gate rows: ${report.bySource.recoveryShadow.singleGateRows}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { buildReport };
