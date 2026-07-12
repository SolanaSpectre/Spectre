#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeRun, scan } = require('./pre-migration-gated-crosser-follow-through-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-crosser-precursor-discovery-latest.json');

const PREREGISTERED = {
  mode: 'report_only_decision_time_crosser_precursor_discovery',
  warning: 'Future-crosser labels are used only for hypothesis discovery. Any promotable slice must be defined only by decision-time fields and validated by realizable replay on all matching gated decisions.',
  frozenFeatureList: [
    'score',
    'curveProgress',
    'recentVolumeSol',
    'tradeVelocityPerMin',
    'buyRatio',
    'uniqueBuyerCount',
    'sniperWalletCount',
    'curveDelta60s'
  ],
  derivedFeatureRules: {
    curveDelta60s: 'last decision-time-or-earlier curveProgress minus earliest curveProgress in the trailing 60s window; snapshots after decision.atMs are forbidden'
  },
  thresholdSearch: {
    singleFeatureGrid: 'pooled finite-value quartiles q25/q50/q75, both >= and <= directions',
    maxTwoFeatureConjunctions: true,
    conjunctionSource: 'top single thresholds only',
    maxTopSinglesForConjunctions: 5
  },
  promotionCriterion: {
    verdict: 'SLICE_CANDIDATE_FOUND',
    minMeasuredUniqueMatchingGatedDecisions: 20,
    minCrossingEnrichmentVsBaseRate: 2,
    economics: 'realizable_exit_sim_only_no_mfe',
    replayProfile: 'fast_120s_tp50_sl25_slip3',
    requireMedianPnlSolPositive: true,
    requirePerMintExTop3MeanPnlSolPositive: true,
    replayPopulation: 'all matching gated decisions pooled, including future-crossers and non-crossers'
  },
  stoppingRule: {
    parkAfterRuns: 5,
    verdictAfterNoSlice: 'PARK_IN_HYPOTHESIS_REGISTRY',
    maxConcurrentRuntimeShadowLanes: 3,
    currentRuntimeShadowOccupants: [
      { lane: 'wallet_frozen_slice', progress: '5/10' },
      { lane: 'runner_reject_shadow', progress: '6/20' }
    ],
    availableRuntimeShadowSlots: 1
  },
  operationalNote: 'Discovery telemetry may span mixed eras. Any frozen slice OOS clock starts only after the slice is frozen.'
};

const REPLAY = {
  name: 'fast_120s_tp50_sl25_slip3',
  amountSol: 0.05,
  feeSol: 0.0005,
  holdSeconds: 120,
  takeProfitPct: 50,
  stopLossPct: -25,
  entrySlippagePct: 1.5,
  exitSlippagePct: 1.5
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const inlineAt = arg.indexOf('=');
    if (inlineAt > 2) {
      args[arg.slice(2, inlineAt)] = arg.slice(inlineAt + 1);
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

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, q25: null, median: null, q75: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: compact(finite[0], digits),
    q25: compact(pick(0.25), digits),
    median: compact(pick(0.5), digits),
    q75: compact(pick(0.75), digits),
    p90: compact(pick(0.9), digits),
    max: compact(finite[finite.length - 1], digits),
    avg: compact(sum / finite.length, digits)
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

function firstPerMint(rows) {
  const byMint = new Map();
  for (const row of rows) {
    const existing = byMint.get(row.mint);
    if (!existing || Number(row.atMs || 0) < Number(existing.atMs || 0)) byMint.set(row.mint, row);
  }
  return Array.from(byMint.values());
}

function curveDelta60s(row, snapshots) {
  const prior = snapshots
    .filter((snapshot) => snapshot.atMs <= row.atMs && snapshot.atMs >= row.atMs - 60000 && Number.isFinite(Number(snapshot.curveProgress)))
    .sort((a, b) => a.atMs - b.atMs);
  if (prior.length < 2) return null;
  return compact(Number(prior[prior.length - 1].curveProgress) - Number(prior[0].curveProgress), 6);
}

function addDecisionTimeFeatures(row, snapshots) {
  return {
    ...row,
    isFutureCrosser: row.cohort === 'gated_future_curve60_biased',
    features: {
      score: compact(row.score, 6),
      curveProgress: compact(row.curveProgress, 6),
      recentVolumeSol: compact(row.recentVolumeSol, 6),
      tradeVelocityPerMin: compact(row.tradeVelocityPerMin, 6),
      buyRatio: compact(row.buyRatio, 6),
      uniqueBuyerCount: compact(row.uniqueBuyerCount, 0),
      sniperWalletCount: compact(row.sniperWalletCount, 0),
      curveDelta60s: curveDelta60s(row, snapshots)
    }
  };
}

function replayExit(row, snapshots) {
  const entryPrice = Number(row.priceSol);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const future = snapshots
    .filter((snapshot) => (
      snapshot.atMs > row.atMs
      && snapshot.atMs <= row.atMs + REPLAY.holdSeconds * 1000
      && Number.isFinite(Number(snapshot.priceSol))
      && Number(snapshot.priceSol) > 0
    ))
    .sort((a, b) => a.atMs - b.atMs);
  if (!future.length) return null;
  const effectiveEntry = entryPrice * (1 + REPLAY.entrySlippagePct / 100);
  let exit = future[future.length - 1];
  let exitReason = 'MAX_HOLD';
  for (const snapshot of future) {
    const effectiveExit = Number(snapshot.priceSol) * (1 - REPLAY.exitSlippagePct / 100);
    const returnPct = ((effectiveExit / effectiveEntry) - 1) * 100;
    if (returnPct <= REPLAY.stopLossPct) {
      exit = snapshot;
      exitReason = 'STOP_LOSS';
      break;
    }
    if (returnPct >= REPLAY.takeProfitPct) {
      exit = snapshot;
      exitReason = 'TAKE_PROFIT';
      break;
    }
  }
  const exitPrice = Number(exit.priceSol);
  const effectiveExit = exitPrice * (1 - REPLAY.exitSlippagePct / 100);
  const returnPct = ((effectiveExit / effectiveEntry) - 1) * 100;
  const rawReturnPct = ((exitPrice / entryPrice) - 1) * 100;
  return {
    profile: REPLAY.name,
    outcomeJoined: true,
    exitReason,
    exitAt: exit.at,
    holdSeconds: compact((exit.atMs - row.atMs) / 1000, 3),
    rawReturnPct: compact(rawReturnPct, 4),
    returnPct: compact(returnPct, 4),
    pnlSol: compact(REPLAY.amountSol * (returnPct / 100) - REPLAY.feeSol, 9)
  };
}

function summarizeReplay(rows) {
  const joined = rows.filter((row) => row.replay?.outcomeJoined);
  const pnls = joined.map((row) => Number(row.replay.pnlSol)).filter(Number.isFinite);
  const sortedWinners = pnls.filter((value) => value > 0).sort((a, b) => b - a);
  const top3 = sortedWinners.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const total = pnls.reduce((sum, value) => sum + value, 0);
  const exTop3 = total - top3;
  const exTop3Mean = joined.length ? exTop3 / joined.length : null;
  const positives = pnls.filter((value) => value > 0).length;
  return {
    measured: joined.length,
    measuredUniqueMints: new Set(joined.map((row) => row.mint)).size,
    positiveCount: positives,
    nonPositiveCount: joined.length - positives,
    positiveRate: joined.length ? compact(positives / joined.length, 4) : null,
    totalPnlSol: compact(total, 9),
    medianPnlSol: stat(pnls, 9).median,
    pnlAfterRemovingTop3WinnersSol: compact(exTop3, 9),
    pnlAfterRemovingTop3WinnersMeanSol: compact(exTop3Mean, 9),
    pnlSol: stat(pnls, 9),
    exitReasons: countBy(joined, (row) => row.replay.exitReason)
  };
}

function featureValue(row, feature) {
  const value = Number(row.features?.[feature]);
  return Number.isFinite(value) ? value : null;
}

function cohortStats(rows, feature) {
  return {
    crosser: stat(rows.filter((row) => row.isFutureCrosser).map((row) => row.features?.[feature]), 6),
    control: stat(rows.filter((row) => !row.isFutureCrosser).map((row) => row.features?.[feature]), 6),
    pooled: stat(rows.map((row) => row.features?.[feature]), 6)
  };
}

function thresholdsFor(rows, feature) {
  const pooled = stat(rows.map((row) => row.features?.[feature]), 6);
  return [pooled.q25, pooled.median, pooled.q75]
    .map(Number)
    .filter(Number.isFinite)
    .filter((value, index, all) => all.indexOf(value) === index);
}

function conditionLabel(condition) {
  return `${condition.feature} ${condition.direction === 'gte' ? '>=' : '<='} ${condition.threshold}`;
}

function matchesCondition(row, condition) {
  const value = featureValue(row, condition.feature);
  if (!Number.isFinite(value)) return false;
  return condition.direction === 'gte' ? value >= condition.threshold : value <= condition.threshold;
}

function rowsMatching(rows, conditions) {
  return rows.filter((row) => conditions.every((condition) => matchesCondition(row, condition)));
}

function evaluateConditions(rows, conditions, baseRate) {
  const matched = rowsMatching(rows, conditions);
  const crosserCount = matched.filter((row) => row.isFutureCrosser).length;
  const precision = matched.length ? crosserCount / matched.length : null;
  const recallDenominator = rows.filter((row) => row.isFutureCrosser).length;
  const replay = summarizeReplay(matched);
  const enrichment = Number(baseRate) > 0 && precision !== null ? precision / baseRate : null;
  const promotionChecks = {
    minMeasuredUnique: replay.measuredUniqueMints >= PREREGISTERED.promotionCriterion.minMeasuredUniqueMatchingGatedDecisions,
    crossingEnrichment: Number(enrichment) >= PREREGISTERED.promotionCriterion.minCrossingEnrichmentVsBaseRate,
    medianPnlPositive: Number(replay.medianPnlSol) > 0,
    exTop3MeanPnlPositive: Number(replay.pnlAfterRemovingTop3WinnersMeanSol) > 0
  };
  return {
    label: conditions.map(conditionLabel).join(' AND '),
    conditions,
    matched: matched.length,
    matchedUniqueMints: new Set(matched.map((row) => row.mint)).size,
    crosserCount,
    controlCount: matched.length - crosserCount,
    precision: precision === null ? null : compact(precision, 4),
    recall: recallDenominator ? compact(crosserCount / recallDenominator, 4) : null,
    enrichmentVsBaseRate: enrichment === null ? null : compact(enrichment, 4),
    replay,
    promotionChecks,
    sliceCandidate: Object.values(promotionChecks).every(Boolean)
  };
}

function buildRows(files) {
  const runs = [];
  for (const filePath of files) {
    const analyzed = analyzeRun(filePath);
    const scanned = scan(filePath);
    const rows = analyzed.rows
      .filter((row) => row.cohort === 'gated_future_curve60_biased' || row.cohort === 'gated_non_crosser_control')
      .map((row) => {
        const snapshots = scanned.snapshotsByMint.get(row.mint) || [];
        const enriched = addDecisionTimeFeatures(row, snapshots);
        return { ...enriched, replay: replayExit(enriched, snapshots) };
      });
    runs.push({ ...analyzed, rows });
  }
  return firstPerMint(runs.flatMap((run) => run.rows));
}

function buildReport(files) {
  const rows = buildRows(files);
  const crosserCount = rows.filter((row) => row.isFutureCrosser).length;
  const baseRate = rows.length ? crosserCount / rows.length : 0;
  const featureDistributions = Object.fromEntries(
    PREREGISTERED.frozenFeatureList.map((feature) => [feature, cohortStats(rows, feature)])
  );
  const singles = [];
  for (const feature of PREREGISTERED.frozenFeatureList) {
    for (const threshold of thresholdsFor(rows, feature)) {
      for (const direction of ['gte', 'lte']) {
        singles.push(evaluateConditions(rows, [{ feature, direction, threshold: compact(threshold, 6) }], baseRate));
      }
    }
  }
  const topSinglesForPairs = singles
    .filter((row) => row.matchedUniqueMints >= 5)
    .sort((a, b) => Number(b.enrichmentVsBaseRate || 0) - Number(a.enrichmentVsBaseRate || 0) || b.matchedUniqueMints - a.matchedUniqueMints)
    .slice(0, PREREGISTERED.thresholdSearch.maxTopSinglesForConjunctions);
  const conjunctions = [];
  for (let left = 0; left < topSinglesForPairs.length; left += 1) {
    for (let right = left + 1; right < topSinglesForPairs.length; right += 1) {
      const leftCondition = topSinglesForPairs[left].conditions[0];
      const rightCondition = topSinglesForPairs[right].conditions[0];
      if (leftCondition.feature === rightCondition.feature) continue;
      conjunctions.push(evaluateConditions(rows, [leftCondition, rightCondition], baseRate));
    }
  }
  const allHypotheses = singles.concat(conjunctions);
  const candidateSlices = allHypotheses
    .filter((row) => row.sliceCandidate)
    .sort((a, b) => Number(b.enrichmentVsBaseRate || 0) - Number(a.enrichmentVsBaseRate || 0) || Number(b.replay.medianPnlSol || 0) - Number(a.replay.medianPnlSol || 0));
  const verdict = candidateSlices.length
    ? 'SLICE_CANDIDATE_FOUND'
    : files.length >= PREREGISTERED.stoppingRule.parkAfterRuns
      ? PREREGISTERED.stoppingRule.verdictAfterNoSlice
      : 'NO_SLICE_FOUND_CONTINUE_DISCOVERY';
  return {
    generatedAt: new Date().toISOString(),
    mode: PREREGISTERED.mode,
    preregistered: PREREGISTERED,
    replayAssumptions: REPLAY,
    discoveryTelemetryPaths: files.map((filePath) => path.relative(ROOT, filePath).replace(/\\/g, '/')),
    summary: {
      verdict,
      rows: rows.length,
      uniqueMints: new Set(rows.map((row) => row.mint)).size,
      futureCrossers: crosserCount,
      controls: rows.length - crosserCount,
      baseCrossRate: compact(baseRate, 4),
      hypothesesTested: allHypotheses.length,
      singleThresholdHypotheses: singles.length,
      conjunctionHypotheses: conjunctions.length,
      candidateSlices: candidateSlices.length,
      runsRead: files.length,
      runsUntilPark: Math.max(0, PREREGISTERED.stoppingRule.parkAfterRuns - files.length),
      warning: PREREGISTERED.warning
    },
    featureDistributions,
    singleThresholds: singles
      .sort((a, b) => Number(b.enrichmentVsBaseRate || 0) - Number(a.enrichmentVsBaseRate || 0) || b.matchedUniqueMints - a.matchedUniqueMints)
      .slice(0, 40),
    twoFeatureConjunctions: conjunctions
      .sort((a, b) => Number(b.enrichmentVsBaseRate || 0) - Number(a.enrichmentVsBaseRate || 0) || b.matchedUniqueMints - a.matchedUniqueMints)
      .slice(0, 40),
    candidateSlices: candidateSlices.slice(0, 10),
    topExamples: rows
      .filter((row) => row.isFutureCrosser)
      .sort((a, b) => Number(b.replay?.pnlSol ?? -Infinity) - Number(a.replay?.pnlSol ?? -Infinity))
      .slice(0, 10)
      .map((row) => ({
        telemetryPath: row.telemetryPath,
        mint: row.mint,
        symbol: row.symbol,
        at: row.at,
        blockerKey: row.blockerKey,
        features: row.features,
        replay: row.replay
      }))
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
  PREREGISTERED
};
