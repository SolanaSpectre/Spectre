#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-gated-crosser-follow-through-latest.json');
const WINDOWS_SECONDS = [120, 300];
const STRESS = {
  amountSol: 0.05,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5,
  feeSol: 0.0005
};
const PROMOTION_REQUIREMENTS = {
  diagnosticOnly: true,
  warning: 'The future-crosser cohort is selected on future curve movement and cannot directly define a runtime shadow lane.',
  runtimeShadowLaneMustBeDefinedByDecisionTimeFeaturesOnly: true,
  measuredSampleTarget: 20,
  requireMultipleRuns: true,
  primaryWindowSeconds: 120,
  metricFamily: 'max_favorable_excursion_mfe_not_realizable_exit',
  requireControlRelativeMedianMfePnlSol: true,
  minControlMedianMfePnlDeltaSol: 0.005,
  requireControlRelativeExTop3MeanMfePnlSol: true,
  minControlExTop3MeanMfePnlDeltaSol: 0.005,
  minMeasuredPerBlockerForBlockerVerdict: 10,
  nextStepIfPromising: 'derive a decision-time-only slice, replay/stress it on all matching gated decisions, then freeze a runtime shadow ledger target before collecting OOS samples'
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const inlineValueAt = arg.indexOf('=');
    if (inlineValueAt > 2) {
      args[arg.slice(2, inlineValueAt)] = arg.slice(inlineValueAt + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function telemetryFiles(limit = 1) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, Math.max(1, Number(limit) || 1))
    .map((item) => item.filePath);
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

function stat(values, digits = 6) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: compact(sorted[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(sorted[sorted.length - 1], digits),
    avg: compact(sum / sorted.length, digits)
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function groupBy(rows, keyFn) {
  const groups = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return groups;
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: eventType(event),
    curveProgress: compact(curveProgress, 6),
    priceSol: compact(priceOf(payload), 15)
  };
}

function decisionFromEvent(event) {
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED') return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks.slice() : [];
  const reasons = Array.isArray(payload.reasons) ? payload.reasons.slice() : [];
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    symbol: payload.symbol || null,
    reason: payload.reason || 'UNKNOWN',
    preset: payload.preset || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    curveProgress: compact(curveProgress, 6),
    priceSol: compact(priceOf(payload), 15),
    score: compact(payload.score, 4),
    recentVolumeSol: compact(payload.recentVolumeSol, 6),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 6),
    buyRatio: compact(payload.buyRatio, 4),
    uniqueBuyerCount: compact(payload.uniqueBuyerCount, 0),
    sniperWalletCount: compact(payload.sniperWalletCount, 0),
    failedChecks,
    reasons,
    blockerKey: failedChecks[0] || payload.reason || 'UNKNOWN'
  };
}

function entryFromEvent(event) {
  if (eventType(event) !== 'pre_migration_paper.entry') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return { mint, atMs, at: new Date(atMs).toISOString(), symbol: payload.symbol || null };
}

function scan(filePath) {
  const snapshotsByMint = new Map();
  const decisions = [];
  const entries = [];
  const eventCounts = {};
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      if (!snapshotsByMint.has(snapshot.mint)) snapshotsByMint.set(snapshot.mint, []);
      snapshotsByMint.get(snapshot.mint).push(snapshot);
    }
    const decision = decisionFromEvent(event);
    if (decision) decisions.push(decision);
    const entry = entryFromEvent(event);
    if (entry) entries.push(entry);
  }, { bufferSize: 1024 * 1024 });
  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  decisions.sort((a, b) => a.atMs - b.atMs);
  entries.sort((a, b) => a.atMs - b.atMs);
  return { snapshotsByMint, decisions, entries, eventCounts, stats };
}

function firstPerMint(rows) {
  const byMint = new Map();
  for (const row of rows) {
    const existing = byMint.get(row.mint);
    if (!existing || Number(row.atMs || 0) < Number(existing.atMs || 0)) byMint.set(row.mint, row);
  }
  return Array.from(byMint.values());
}

function countList(items) {
  const counts = {};
  for (const item of items || []) {
    const key = item || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function firstCrossAfter(snapshots, atMs, threshold) {
  return snapshots.find((snapshot) => snapshot.atMs > atMs && Number(snapshot.curveProgress) >= threshold) || null;
}

function windowOutcome(decision, snapshots, seconds) {
  const endMs = decision.atMs + seconds * 1000;
  const future = snapshots.filter((snapshot) => snapshot.atMs > decision.atMs && snapshot.atMs <= endMs);
  const futureWithPrice = future.filter((snapshot) => Number.isFinite(Number(snapshot.priceSol)) && Number(snapshot.priceSol) > 0);
  const entryPrice = Number(decision.priceSol);
  const maxPrice = stat(futureWithPrice.map((snapshot) => snapshot.priceSol), 15).max;
  const maxCurve = stat(future.map((snapshot) => snapshot.curveProgress), 6).max;
  const outcomeJoined = Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(Number(maxPrice));
  const grossMfeReturnPct = outcomeJoined ? ((Number(maxPrice) / entryPrice) - 1) * 100 : null;
  const stressedMfeReturnPct = outcomeJoined ? grossMfeReturnPct - STRESS.entrySlippagePct - STRESS.exitSlippagePct : null;
  const mfePnlSol = outcomeJoined ? (STRESS.amountSol * (stressedMfeReturnPct / 100)) - STRESS.feeSol : null;
  return {
    seconds,
    outcomeJoined,
    futureSnapshotCount: future.length,
    futurePriceSnapshotCount: futureWithPrice.length,
    maxCurveProgress: compact(maxCurve, 6),
    maxPriceSol: compact(maxPrice, 15),
    grossMfeReturnPct: compact(grossMfeReturnPct, 4),
    stressedMfeReturnPct: compact(stressedMfeReturnPct, 4),
    mfePnlSol: compact(mfePnlSol, 9),
    crossed85WithinWindow: Boolean(firstCrossAfter(future, decision.atMs, 0.85)),
    crossed90WithinWindow: Boolean(firstCrossAfter(future, decision.atMs, 0.9))
  };
}

function classifyCohort(decision, snapshots, entriesByMint) {
  if (entriesByMint.has(decision.mint)) return 'paper_entered_comparison';
  if (Number(decision.curveProgress) >= 0.6) return 'gated_already_curve60';
  return firstCrossAfter(snapshots, decision.atMs, 0.6)
    ? 'gated_future_curve60_biased'
    : 'gated_non_crosser_control';
}

function analyzeRun(filePath) {
  const scanned = scan(filePath);
  const entriesByMint = new Set(scanned.entries.map((entry) => entry.mint));
  const decisionsByMint = groupBy(scanned.decisions, (decision) => decision.mint);
  const rows = firstPerMint(scanned.decisions).map((decision) => {
    const snapshots = scanned.snapshotsByMint.get(decision.mint) || [];
    const windows = Object.fromEntries(WINDOWS_SECONDS.map((seconds) => [`${seconds}s`, windowOutcome(decision, snapshots, seconds)]));
    const firstCurve60 = firstCrossAfter(snapshots, decision.atMs, 0.6);
    const sameMintDecisions = decisionsByMint[decision.mint] || [];
    const failedChecksAll = sameMintDecisions.flatMap((row) => row.failedChecks || []);
    return {
      ...decision,
      telemetryPath: path.relative(ROOT, filePath).replace(/\\/g, '/'),
      cohort: classifyCohort(decision, snapshots, entriesByMint),
      firstCurve60AfterDecisionAt: firstCurve60?.at || null,
      skippedDecisionCountForMint: sameMintDecisions.length,
      failedChecksAll,
      failedCheckCountsAll: countList(failedChecksAll),
      windows
    };
  });
  return {
    telemetryPath: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    rows,
    stats: scanned.stats,
    eventCounts: scanned.eventCounts
  };
}

function mfePnlAfterRemovingTop(rows, windowKey, topCount) {
  const pnls = rows
    .map((row) => Number(row.windows?.[windowKey]?.mfePnlSol))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
    .slice(topCount);
  return compact(pnls.reduce((sum, value) => sum + value, 0), 9);
}

function summarize(rows, label, aggregateVerdict = true) {
  const primaryWindow = `${PROMOTION_REQUIREMENTS.primaryWindowSeconds}s`;
  const uniqueRows = firstPerMint(rows);
  const measured = uniqueRows.filter((row) => row.windows?.[primaryWindow]?.outcomeJoined === true);
  const mfePositiveCount = measured.filter((row) => Number(row.windows[primaryWindow].mfePnlSol) > 0).length;
  const totalMfePnlSol = measured.reduce((sum, row) => sum + Number(row.windows[primaryWindow].mfePnlSol || 0), 0);
  const medianMfePnl = stat(measured.map((row) => row.windows[primaryWindow].mfePnlSol), 9).median;
  const exTop3 = mfePnlAfterRemovingTop(measured, primaryWindow, 3);
  const exTop3Mean = measured.length ? compact(Number(exTop3 || 0) / measured.length, 9) : null;
  let verdict = 'DESCRIPTIVE_ONLY';
  if (aggregateVerdict) {
    if (measured.length < PROMOTION_REQUIREMENTS.measuredSampleTarget) verdict = 'INSUFFICIENT_SAMPLE';
    else verdict = 'CONTROL_COMPARISON_REQUIRED';
  } else if (measured.length < PROMOTION_REQUIREMENTS.minMeasuredPerBlockerForBlockerVerdict) {
    verdict = 'DESCRIPTIVE_ONLY_UNDER_BLOCKER_MIN_SAMPLE';
  }
  return {
    label,
    verdict,
    rows: rows.length,
    uniqueMints: uniqueRows.length,
    measured: measured.length,
    measuredUniqueMints: new Set(measured.map((row) => row.mint)).size,
    mfePositiveCount,
    mfeNonPositiveCount: measured.length - mfePositiveCount,
    mfePositiveRate: measured.length ? compact(mfePositiveCount / measured.length, 4) : null,
    totalMfePnlSol: compact(totalMfePnlSol, 9),
    medianMfePnlSol: medianMfePnl,
    mfePnlAfterRemovingTop3WinnersSol: exTop3,
    mfePnlAfterRemovingTop3WinnersMeanSol: exTop3Mean,
    blockerCounts: countBy(uniqueRows, (row) => row.blockerKey),
    reasonCounts: countBy(uniqueRows, (row) => row.reason),
    failedCheckCountsAll: countList(uniqueRows.flatMap((row) => row.failedChecksAll || [])),
    crossed85Within120s: uniqueRows.filter((row) => row.windows['120s']?.crossed85WithinWindow).length,
    crossed90Within120s: uniqueRows.filter((row) => row.windows['120s']?.crossed90WithinWindow).length,
    crossed85Within300s: uniqueRows.filter((row) => row.windows['300s']?.crossed85WithinWindow).length,
    crossed90Within300s: uniqueRows.filter((row) => row.windows['300s']?.crossed90WithinWindow).length,
    mfePnlSol120s: stat(measured.map((row) => row.windows['120s']?.mfePnlSol), 9),
    mfePnlSol300s: stat(uniqueRows.filter((row) => row.windows['300s']?.outcomeJoined).map((row) => row.windows['300s']?.mfePnlSol), 9)
  };
}

function applyControlRelativeVerdict(crosserSummary, controlSummary) {
  if (!crosserSummary || crosserSummary.measuredUniqueMints < PROMOTION_REQUIREMENTS.measuredSampleTarget) {
    return { ...(crosserSummary || {}), verdict: 'INSUFFICIENT_SAMPLE' };
  }
  if (!controlSummary || controlSummary.measuredUniqueMints < PROMOTION_REQUIREMENTS.measuredSampleTarget) {
    return { ...crosserSummary, verdict: 'INSUFFICIENT_CONTROL_SAMPLE' };
  }
  const medianDelta = Number(crosserSummary.medianMfePnlSol) - Number(controlSummary.medianMfePnlSol);
  const exTop3MeanDelta = Number(crosserSummary.mfePnlAfterRemovingTop3WinnersMeanSol) - Number(controlSummary.mfePnlAfterRemovingTop3WinnersMeanSol);
  const deltas = {
    medianMfePnlDeltaVsControlSol: compact(medianDelta, 9),
    exTop3MeanMfePnlDeltaVsControlSol: compact(exTop3MeanDelta, 9)
  };
  if (
    medianDelta >= PROMOTION_REQUIREMENTS.minControlMedianMfePnlDeltaSol
    && exTop3MeanDelta >= PROMOTION_REQUIREMENTS.minControlExTop3MeanMfePnlDeltaSol
  ) {
    return { ...crosserSummary, ...deltas, verdict: 'GATED_CROSSERS_PROMISING_REPORT_ONLY_CONTROL_RELATIVE' };
  }
  if (medianDelta <= 0 && exTop3MeanDelta <= 0) {
    return { ...crosserSummary, ...deltas, verdict: 'GATED_CROSSERS_NOT_BETTER_THAN_CONTROL' };
  }
  return { ...crosserSummary, ...deltas, verdict: 'MIXED_OR_OUTLIER_DOMINATED_CONTROL_RELATIVE' };
}

function compactRow(row) {
  return {
    telemetryPath: row.telemetryPath,
    mint: row.mint,
    symbol: row.symbol,
    cohort: row.cohort,
    at: row.at,
    reason: row.reason,
    blockerKey: row.blockerKey,
    failedChecksAll: row.failedChecksAll,
    failedCheckCountsAll: row.failedCheckCountsAll,
    preset: row.preset,
    curveProgress: row.curveProgress,
    priceSol: row.priceSol,
    score: row.score,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    firstCurve60AfterDecisionAt: row.firstCurve60AfterDecisionAt,
    window120s: row.windows['120s'],
    window300s: row.windows['300s']
  };
}

function buildReport(files) {
  const runs = files.map(analyzeRun);
  const rows = runs.flatMap((run) => run.rows);
  let cohorts = Object.entries(groupBy(rows, (row) => row.cohort || 'unknown'))
    .map(([cohort, cohortRows]) => summarize(cohortRows, cohort, cohort === 'gated_future_curve60_biased'))
    .sort((a, b) => b.rows - a.rows || a.label.localeCompare(b.label));
  const crosserRows = rows.filter((row) => row.cohort === 'gated_future_curve60_biased');
  const blockers = Object.entries(groupBy(crosserRows, (row) => row.blockerKey || row.reason || 'unknown'))
    .map(([blocker, blockerRows]) => summarize(blockerRows, blocker, false))
    .sort((a, b) => b.rows - a.rows || a.label.localeCompare(b.label));
  const controlSummary = cohorts.find((row) => row.label === 'gated_non_crosser_control') || summarize([], 'gated_non_crosser_control', false);
  const crosserSummary = applyControlRelativeVerdict(
    cohorts.find((row) => row.label === 'gated_future_curve60_biased') || summarize([], 'gated_future_curve60_biased'),
    controlSummary
  );
  cohorts = cohorts.map((row) => (row.label === 'gated_future_curve60_biased' ? crosserSummary : row));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_gated_crosser_follow_through_diagnostic',
    note: 'Diagnostic only. The gated_future_curve60_biased cohort is selected on future curve60 crossing, so promising results here are hypothesis-generation only and cannot be promoted directly. Outcomes are anchored at the first gated PAPER_SKIPPED decision timestamp and compared against gated non-crossers as a natural control. Return/PnL fields are max favorable excursion (MFE), not realizable exit simulation.',
    promotionRequirements: PROMOTION_REQUIREMENTS,
    stressAssumptions: STRESS,
    inputs: {
      telemetryFilesRead: files.length,
      telemetryPaths: runs.map((run) => run.telemetryPath),
      telemetryRowsRead: runs.reduce((sum, run) => sum + Number(run.stats.rows || 0), 0),
      malformedLines: runs.reduce((sum, run) => sum + Number(run.stats.malformedLines || 0), 0)
    },
    summary: {
      verdict: crosserSummary.verdict,
      rows: rows.length,
      uniqueMints: new Set(rows.map((row) => row.mint)).size,
      cohortCounts: countBy(rows, (row) => row.cohort),
      crosserMeasured: crosserSummary.measured,
      crosserMeasuredUniqueMints: crosserSummary.measuredUniqueMints,
      crosserMedianMfePnlSol: crosserSummary.medianMfePnlSol,
      crosserMfePnlAfterRemovingTop3WinnersSol: crosserSummary.mfePnlAfterRemovingTop3WinnersSol,
      crosserMfePnlAfterRemovingTop3WinnersMeanSol: crosserSummary.mfePnlAfterRemovingTop3WinnersMeanSol,
      controlMeasured: controlSummary.measured,
      controlMeasuredUniqueMints: controlSummary.measuredUniqueMints,
      controlMedianMfePnlSol: controlSummary.medianMfePnlSol,
      controlMfePnlAfterRemovingTop3WinnersSol: controlSummary.mfePnlAfterRemovingTop3WinnersSol,
      controlMfePnlAfterRemovingTop3WinnersMeanSol: controlSummary.mfePnlAfterRemovingTop3WinnersMeanSol,
      medianMfePnlDeltaVsControlSol: crosserSummary.medianMfePnlDeltaVsControlSol ?? null,
      exTop3MeanMfePnlDeltaVsControlSol: crosserSummary.exTop3MeanMfePnlDeltaVsControlSol ?? null,
      warning: PROMOTION_REQUIREMENTS.warning
    },
    cohorts,
    crosserBlockers: blockers,
    examples: {
      crosserTopMfe: crosserRows
        .slice()
        .sort((a, b) => Number(b.windows['120s']?.mfePnlSol ?? -Infinity) - Number(a.windows['120s']?.mfePnlSol ?? -Infinity))
        .slice(0, 20)
        .map(compactRow),
      controlTopMfe: rows
        .filter((row) => row.cohort === 'gated_non_crosser_control')
        .slice()
        .sort((a, b) => Number(b.windows['120s']?.mfePnlSol ?? -Infinity) - Number(a.windows['120s']?.mfePnlSol ?? -Infinity))
        .slice(0, 20)
        .map(compactRow)
    }
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = args.telemetry
    ? String(args.telemetry).split(',').map((item) => repoPath(item.trim())).filter((item) => item && fs.existsSync(item))
    : telemetryFiles(args.limitRuns || 1);
  if (!files.length) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run after a paper session.');
    process.exit(1);
  }
  const report = buildReport(files);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  writeJson(outputPath, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = {
  buildReport,
  analyzeRun,
  scan
};
