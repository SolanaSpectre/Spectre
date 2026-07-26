#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { scanTelemetryCoverage } = require('./lib/paid-tape-coverage-epochs');

const ROOT = path.join(__dirname, '..');
const PREREG_PATH = path.join(ROOT, 'data', 'strategy-preregistrations', 'runner-watch-full-coverage-v5.json');
const PAID_TAPE_COVERAGE_PATH = path.join(ROOT, 'data', 'reports', 'paid-tape-coverage-epoch-latest.json');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-watch-full-coverage-evidence-latest.json');
const LEDGER_PATH = path.join(ROOT, 'data', 'runner-watch-ledgers', 'full-coverage-v5.jsonl');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function relative(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function resolveTelemetryPath(argv = process.argv.slice(2)) {
  const explicitIndex = argv.indexOf('--telemetry');
  if (explicitIndex >= 0) {
    const explicitValue = argv[explicitIndex + 1];
    if (!explicitValue) throw new Error('--telemetry requires a file path.');
    return path.resolve(ROOT, explicitValue);
  }

  if (fs.existsSync(PAID_TAPE_COVERAGE_PATH)) {
    const coverage = readJson(PAID_TAPE_COVERAGE_PATH);
    if (coverage.telemetryPath) return path.resolve(ROOT, coverage.telemetryPath);
  }

  const battlefield = readJson(BATTLEFIELD_PATH);
  const telemetryValue = battlefield.files?.telemetryPath || battlefield.telemetryPath;
  if (!telemetryValue) throw new Error('No telemetry path found in paid-tape coverage or battlefield reports.');
  return path.resolve(ROOT, telemetryValue);
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 9) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scanRun(telemetryPath) {
  let started = null;
  let stopping = null;
  const entries = [];
  const exits = [];
  const prefilterObservations = [];
  const prefilterExpirations = [];
  const prefilterExpiredLaterObserved = [];
  const paperDecisions = [];
  forEachJsonlSync(telemetryPath, (event) => {
    const payload = event.payload || event.data || {};
    if (event.type === 'session.started') started = { timestamp: event.timestamp, payload };
    else if (event.type === 'session.stopping' || event.type === 'session.stopped') {
      stopping = { timestamp: event.timestamp, payload };
    } else if (event.type === 'pre_migration_paper.entry' && payload.lane === 'PRE_MIGRATION_RUNNER_WATCH') {
      entries.push({ timestamp: event.timestamp, ...payload });
    } else if (event.type === 'pre_migration_paper.exit' && payload.lane === 'PRE_MIGRATION_RUNNER_WATCH') {
      exits.push({ timestamp: event.timestamp, ...payload });
    } else if (event.type === 'provider.pumpportal.targeted_prefilter_first_rpc_observation') {
      prefilterObservations.push({ timestamp: event.timestamp, ...payload });
    } else if (event.type === 'provider.pumpportal.targeted_prefilter_refresh_expired') {
      prefilterExpirations.push({ timestamp: event.timestamp, ...payload });
    } else if (event.type === 'provider.pumpportal.targeted_prefilter_expired_later_observed') {
      prefilterExpiredLaterObserved.push({ timestamp: event.timestamp, ...payload });
    } else if (event.type === 'pre_migration_paper.decision') {
      paperDecisions.push({ timestamp: event.timestamp, ...payload });
    }
  });
  const firstObservedAboveBand = prefilterObservations.filter((row) => row.classification === 'ABOVE_BAND');
  const aboveBandMints = new Set(firstObservedAboveBand.map((row) => row.mint));
  const coverageShapedSkips = paperDecisions
    .filter((row) => aboveBandMints.has(row.mint) && row.decision === 'PAPER_SKIPPED')
    .map((row) => ({
      timestamp: row.timestamp,
      mint: row.mint,
      symbol: row.symbol || null,
      reason: row.reason || null,
      coverageTag: 'FIRST_RPC_OBSERVED_ABOVE_TARGETED_TAPE_BAND'
    }));
  const byClassification = prefilterObservations.reduce((counts, row) => {
    counts[row.classification || 'UNKNOWN'] = (counts[row.classification || 'UNKNOWN'] || 0) + 1;
    return counts;
  }, {});
  const skipReasons = coverageShapedSkips.reduce((counts, row) => {
    counts[row.reason || 'UNKNOWN'] = (counts[row.reason || 'UNKNOWN'] || 0) + 1;
    return counts;
  }, {});
  return {
    started,
    stopping,
    entries,
    exits,
    coverageDiagnostics: {
      firstRpcObservations: prefilterObservations.length,
      byClassification,
      firstObservedAboveBandMints: firstObservedAboveBand.length,
      firstObservedAboveBand,
      belowBandRecheckExpirations: prefilterExpirations.length,
      belowBandRecheckExpirationRows: prefilterExpirations,
      expiredLaterObservedInOrAboveBand: prefilterExpiredLaterObserved.length,
      expiredLaterObservedRows: prefilterExpiredLaterObserved,
      coverageShapedPaperSkips: coverageShapedSkips.length,
      coverageShapedPaperSkipReasons: skipReasons,
      coverageShapedSkips
    }
  };
}

function buildEpisodes(run) {
  const byMint = new Map();
  for (const entry of run.entries) {
    const mint = entry.mint || null;
    if (!mint) continue;
    if (!byMint.has(mint)) byMint.set(mint, { mint, symbol: entry.symbol || null, entries: 0, exits: 0, pnlSol: 0 });
    byMint.get(mint).entries += 1;
  }
  for (const exit of run.exits) {
    const mint = exit.mint || null;
    if (!mint) continue;
    if (!byMint.has(mint)) byMint.set(mint, { mint, symbol: exit.symbol || null, entries: 0, exits: 0, pnlSol: 0 });
    const episode = byMint.get(mint);
    episode.exits += 1;
    episode.pnlSol += number(exit.pnlSol, 0);
  }
  return [...byMint.values()].map((episode) => ({ ...episode, pnlSol: round(episode.pnlSol) }));
}

function validateRun(prereg, telemetryPath, run, coverage) {
  const plan = run.started?.payload?.pumpPortalPaidTapePlan || {};
  const stats = run.stopping?.payload?.stats || {};
  const curveErrors = number(stats.pumpBondingCurveLane?.errors, null);
  const rpcFailures = number(stats.solanaRpc?.stats?.primaryFailures, 0) + number(stats.solanaRpc?.stats?.fallbackFailures, 0);
  const expected = prereg.subscriptionPlan;
  const requested = prereg.validRunDefinition;
  const effectiveRegistrationAt = prereg.amendedBeforeFirstValidRunAt || prereg.preregisteredAt;
  const checks = {
    postRegistration: Boolean(run.started?.timestamp && new Date(run.started.timestamp) > new Date(effectiveRegistrationAt)),
    paperMode: run.started?.payload?.mode === 'PAPER',
    correctStrategyPreregistration: run.started?.payload?.strategyPreregistration?.id === prereg.id,
    requestedDuration: number(run.started?.payload?.sessionDurationMinutes) === requested.requestedRunMinutes,
    targetedMode: plan.tradeSubscriptionMode === expected.mode,
    minCurveProgress: number(plan.targetedMinCurveProgress) === expected.minCurveProgressInclusive,
    maxCurveProgress: number(plan.targetedMaxCurveProgress) === expected.maxCurveProgressExclusive,
    paidEventBudget: number(plan.maxMeteredTradeEventsPerSession) === expected.paidEventBudgetPerSession,
    tokenTradeTtl: number(plan.tokenTradeSubscriptionTtlMs) === expected.tokenTradeSubscriptionTtlMs,
    targetedPrefilterMaxAge: number(plan.targetedPrefilterMaxAgeMs) === expected.belowBandRpcRecheckMaxAgeMs,
    targetedPrefilterCadence: number(plan.targetedPrefilterCadenceMs) === expected.belowBandRpcRecheckCadenceMs,
    bondingCurveRuntimeRpcEnabled: plan.bondingCurveRuntimeRpcEnabled === expected.bondingCurveRuntimeRpcRequired,
    fullPaidTapeMinutes: number(coverage.fullPaidTapeMinutes, 0) >= requested.minimumFullPaidTapeMinutes,
    runtimeRpcCurveErrors: curveErrors === 0,
    completedLifecycle: run.stopping?.payload?.reason === 'SESSION_DURATION_EXCEEDED'
  };
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([key]) => key);
  return {
    valid: failedChecks.length === 0,
    checks,
    failedChecks,
    actual: {
      telemetryPath: relative(telemetryPath),
      startedAt: run.started?.timestamp || null,
      stoppedAt: run.stopping?.timestamp || null,
      stopReason: run.stopping?.payload?.reason || null,
      paidTapePlan: plan,
      fullPaidTapeMinutes: coverage.fullPaidTapeMinutes,
      discoveryRpcOnlyMinutes: coverage.discoveryRpcOnlyMinutes,
      paidTapeCapped: coverage.paidTapeCapped,
      paidTapeCoverageTruncated: coverage.paidTapeCoverageTruncated,
      coverageEndReason: coverage.coverageEndReason,
      coverageEndedAt: coverage.coverageEndedAt,
      targetedTradeSubscriptionRejections: coverage.targetedTradeSubscriptionRejections,
      runtimeRpcCurveErrors: curveErrors,
      rpcTransportFailures: rpcFailures
    }
  };
}

function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return [];
  return fs.readFileSync(LEDGER_PATH, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function appendRun(row) {
  const rows = readLedger();
  if (rows.some((item) => item.recordType !== 'coverage_annotation' && item.telemetryPath === row.telemetryPath)) {
    return { appended: false, rows };
  }
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, `${JSON.stringify(row)}\n`, 'utf8');
  return { appended: true, rows: [...rows, row] };
}

function appendCoverageAnnotation(row) {
  const rows = readLedger();
  if (rows.some((item) => item.recordType === 'coverage_annotation' && item.telemetryPath === row.telemetryPath)) {
    return { appended: false, rows };
  }
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, `${JSON.stringify(row)}\n`, 'utf8');
  return { appended: true, rows: [...rows, row] };
}

function summarizeLedger(rows, prereg) {
  const runRows = rows.filter((row) => row.recordType !== 'coverage_annotation');
  const coverageAnnotations = new Map(
    rows.filter((row) => row.recordType === 'coverage_annotation' && row.telemetryPath)
      .map((row) => [row.telemetryPath, row])
  );
  const effectiveRunRows = runRows.map((row) => {
    const annotation = coverageAnnotations.get(row.telemetryPath);
    if (!annotation) return row;
    return {
      ...row,
      valid: Object.prototype.hasOwnProperty.call(annotation, 'validOverride')
        ? annotation.validOverride
        : row.valid,
      failedChecks: annotation.failedChecksOverride || row.failedChecks,
      fullPaidTapeMinutes: Number.isFinite(Number(annotation.fullPaidTapeMinutesOverride))
        ? Number(annotation.fullPaidTapeMinutesOverride)
        : row.fullPaidTapeMinutes
    };
  });
  const validRuns = effectiveRunRows.filter((row) => row.valid);
  const episodes = validRuns.flatMap((row) => row.episodes.map((episode) => ({ ...episode, telemetryPath: row.telemetryPath })))
    .filter((episode) => episode.exits > 0);
  const pnlValues = episodes.map((episode) => number(episode.pnlSol, 0));
  const winners = [...pnlValues].filter((value) => value > 0).sort((a, b) => b - a);
  const totalPnlSol = pnlValues.reduce((sum, value) => sum + value, 0);
  const pnlAfterRemovingTop3WinnersSol = totalPnlSol - winners.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const positiveRuns = validRuns.filter((row) => row.pnlSol > 0).length;
  const totalPositiveRunPnl = validRuns.reduce((sum, row) => sum + Math.max(0, row.pnlSol), 0);
  const largestPositiveRunShare = totalPositiveRunPnl > 0
    ? Math.max(0, ...validRuns.map((row) => Math.max(0, row.pnlSol))) / totalPositiveRunPnl
    : null;
  const fullHours = validRuns.reduce((sum, row) => sum + number(row.fullPaidTapeMinutes, 0) / 60, 0);
  const episodesPerFullCoverageHour = fullHours > 0 ? episodes.length / fullHours : null;
  const economicReady = episodes.length >= prereg.economicCheckpoint.minimumUniqueMintEpisodes
    && validRuns.length >= prereg.economicCheckpoint.minimumValidRuns;
  const requirements = {
    positiveTotalPnl: totalPnlSol > 0,
    positiveMedianPnl: number(median(pnlValues), 0) > 0,
    positiveExTop3Pnl: pnlAfterRemovingTop3WinnersSol > 0,
    positiveRunCount: positiveRuns >= 3,
    runConcentration: largestPositiveRunShare !== null && largestPositiveRunShare <= 0.6
  };
  let verdict = 'COLLECTING_RUNTIME_EVIDENCE';
  if (economicReady) verdict = Object.values(requirements).every(Boolean)
    ? 'RUNTIME_CHECKPOINT_PASSED_PAPER_ONLY'
    : 'FAILED_RUNTIME_CHECKPOINT';
  else if (validRuns.length >= prereg.stoppingRule.validRuns
    && episodes.length < prereg.economicCheckpoint.minimumUniqueMintEpisodes) {
    verdict = 'INSUFFICIENT_THROUGHPUT_FOR_LIVE_GRADUATION';
  }
  return {
    verdict,
    validRuns: validRuns.length,
    excludedRuns: effectiveRunRows.length - validRuns.length,
    realizedUniqueMintEpisodes: episodes.length,
    fullPaidTapeHours: round(fullHours, 4),
    episodesPerFullCoverageHour: round(episodesPerFullCoverageHour, 6),
    throughputRequirementMet: episodesPerFullCoverageHour !== null
      && episodesPerFullCoverageHour >= prereg.throughputCheckpoint.minimumUniqueMintEpisodesPerFullCoverageHour,
    totalPnlSol: round(totalPnlSol),
    medianEpisodePnlSol: round(median(pnlValues)),
    pnlAfterRemovingTop3WinnersSol: round(pnlAfterRemovingTop3WinnersSol),
    positiveRuns,
    largestPositiveRunShare: round(largestPositiveRunShare, 6),
    economicCheckpointReady: economicReady,
    economicRequirements: requirements,
    liveAction: 'KEEP_LIVE_DISABLED'
  };
}

function main() {
  const prereg = readJson(PREREG_PATH);
  const telemetryPath = resolveTelemetryPath();
  const run = scanRun(telemetryPath);
  const coverage = scanTelemetryCoverage(telemetryPath);
  const validation = validateRun(prereg, telemetryPath, run, coverage);
  const episodes = buildEpisodes(run);
  const runRow = {
    preregistrationId: prereg.id,
    telemetryPath: relative(telemetryPath),
    startedAt: run.started?.timestamp || null,
    valid: validation.valid,
    failedChecks: validation.failedChecks,
    fullPaidTapeMinutes: coverage.fullPaidTapeMinutes,
    comparatorCoverage: {
      budgetTruncated: coverage.paidTapeCapped === true,
      coverageTruncated: coverage.paidTapeCoverageTruncated === true,
      coverageEndReason: coverage.coverageEndReason || null,
      coverageEndedAt: coverage.coverageEndedAt || null,
      targetedTradeSubscriptionRejections: coverage.targetedTradeSubscriptionRejections,
      fullPaidTapeMinutes: coverage.fullPaidTapeMinutes,
      discoveryRpcOnlyMinutes: coverage.discoveryRpcOnlyMinutes,
      annotation: coverage.paidTapeCoverageTruncated === true
        ? `PumpPortal comparator evidence ends at ${coverage.coverageEndReason || 'UNKNOWN_COVERAGE_STOP'}; later operation is not comparator-covered.`
        : 'PumpPortal comparator remained available for the requested evidence window.'
    },
    coverageDiagnostics: run.coverageDiagnostics,
    episodes,
    pnlSol: round(episodes.reduce((sum, episode) => sum + number(episode.pnlSol, 0), 0))
  };
  let ledgerRows = readLedger();
  let appended = false;
  if (validation.checks.postRegistration) ({ rows: ledgerRows, appended } = appendRun(runRow));
  let coverageAnnotationAppended = false;
  if (validation.checks.postRegistration && coverage.paidTapeCoverageTruncated === true) {
    ({ rows: ledgerRows, appended: coverageAnnotationAppended } = appendCoverageAnnotation({
      recordType: 'coverage_annotation',
      telemetryPath: relative(telemetryPath),
      annotatedAt: new Date().toISOString(),
      validOverride: validation.valid,
      failedChecksOverride: validation.failedChecks,
      fullPaidTapeMinutesOverride: coverage.fullPaidTapeMinutes,
      comparatorCoverage: runRow.comparatorCoverage
    }));
  }
  const cumulative = summarizeLedger(ledgerRows, prereg);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'paper_only_preregistered_runner_watch_full_coverage_evidence',
    preregistration: prereg,
    currentRun: {
      validation,
      comparatorCoverage: runRow.comparatorCoverage,
      coverageDiagnostics: run.coverageDiagnostics,
      episodes,
      ledgerAppended: appended,
      coverageAnnotationAppended
    },
    cumulative,
    ledgerPath: relative(LEDGER_PATH),
    note: 'Only post-registration runs matching the frozen targeted paid-tape plan and full-coverage definition enter the cumulative evidence ledger. Same-mint reentries are one episode per run.',
    prohibitions: prereg.prohibitions
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ currentRun: report.currentRun.validation, cumulative }, null, 2));
}

if (require.main === module) main();

module.exports = {
  resolveTelemetryPath,
  scanRun,
  buildEpisodes,
  validateRun,
  summarizeLedger,
  appendCoverageAnnotation
};
