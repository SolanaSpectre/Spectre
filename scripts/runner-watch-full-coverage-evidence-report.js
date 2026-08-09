#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { scanHeliusRuntimeCoverage } = require('./lib/helius-runtime-coverage');
const { isRuntimeProviderEvent } = require('./lib/runtime-provider-events');

const ROOT = path.join(__dirname, '..');
const PREREG_PATH = path.join(ROOT, 'data', 'strategy-preregistrations', 'runner-watch-full-coverage-v6.json');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-watch-full-coverage-evidence-latest.json');
const LEDGER_PATH = path.join(ROOT, 'data', 'runner-watch-ledgers', 'full-coverage-v6.jsonl');

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

  const battlefield = readJson(BATTLEFIELD_PATH);
  const telemetryValue = battlefield.files?.telemetryPath || battlefield.telemetryPath;
  if (!telemetryValue) throw new Error('No telemetry path found in battlefield report.');
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
  const paperDecisions = [];
  const runtimeProviderEvents = {
    newTokens: 0,
    trades: 0,
    migrations: 0
  };
  forEachJsonlSync(telemetryPath, (event) => {
    const payload = event.payload || event.data || {};
    if (event.type === 'session.started') started = { timestamp: event.timestamp, payload };
    else if (event.type === 'session.stopping' || event.type === 'session.stopped') {
      stopping = { timestamp: event.timestamp, payload };
    } else if (event.type === 'pre_migration_paper.entry' && payload.lane === 'PRE_MIGRATION_RUNNER_WATCH') {
      entries.push({ timestamp: event.timestamp, ...payload });
    } else if (event.type === 'pre_migration_paper.exit' && payload.lane === 'PRE_MIGRATION_RUNNER_WATCH') {
      exits.push({ timestamp: event.timestamp, ...payload });
    } else if (event.type === 'pre_migration_paper.decision') {
      paperDecisions.push({ timestamp: event.timestamp, ...payload });
    }
    if (isRuntimeProviderEvent(event, 'newToken')) runtimeProviderEvents.newTokens += 1;
    if (isRuntimeProviderEvent(event, 'trade')) runtimeProviderEvents.trades += 1;
    if (isRuntimeProviderEvent(event, 'migration')) runtimeProviderEvents.migrations += 1;
  });
  const skipReasons = paperDecisions.reduce((counts, row) => {
    counts[row.reason || 'UNKNOWN'] = (counts[row.reason || 'UNKNOWN'] || 0) + 1;
    return counts;
  }, {});
  return {
    started,
    stopping,
    entries,
    exits,
    coverageDiagnostics: {
      runtimeProviderEvents,
      paperDecisions: paperDecisions.length,
      paperDecisionReasons: skipReasons
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

function summarizeEpisodes(episodes = []) {
  const realized = episodes.filter((episode) => number(episode.exits, 0) > 0);
  const pnlValues = realized.map((episode) => number(episode.pnlSol, 0));
  const winners = [...pnlValues].filter((value) => value > 0).sort((left, right) => right - left);
  const totalPnlSol = pnlValues.reduce((sum, value) => sum + value, 0);
  const pnlAfterRemovingTop3WinnersSol = totalPnlSol
    - winners.slice(0, 3).reduce((sum, value) => sum + value, 0);
  return {
    realizedEpisodes: realized.length,
    totalPnlSol: round(totalPnlSol),
    medianEpisodePnlSol: round(median(pnlValues)),
    pnlAfterRemovingTop3WinnersSol: round(pnlAfterRemovingTop3WinnersSol),
    concentrationDependent: totalPnlSol > 0 && pnlAfterRemovingTop3WinnersSol <= 0
  };
}

function validateRun(prereg, telemetryPath, run, coverage) {
  const plan = run.started?.payload?.pumpDataPlan || {};
  const strategyPreregistration = run.started?.payload?.strategyPreregistration || {};
  const stats = run.stopping?.payload?.stats || {};
  const curveStats = stats.pumpBondingCurveLane || {};
  const curveErrors = number(curveStats.errors, null);
  const activeCurveErrors = number(curveStats.activePhaseErrors, null);
  const stoppingCurveErrors = number(curveStats.stoppingPhaseErrors, null);
  const stoppedCurveErrors = number(curveStats.stoppedPhaseErrors, null);
  const shutdownCancelledCurveErrors = number(curveStats.shutdownCancelledErrors, null);
  const phaseAwareCurveErrorAccounting = [
    curveErrors,
    activeCurveErrors,
    stoppingCurveErrors,
    stoppedCurveErrors,
    shutdownCancelledCurveErrors
  ].every(Number.isFinite)
    && activeCurveErrors + stoppingCurveErrors + stoppedCurveErrors === curveErrors;
  const shutdownPhaseCurveErrors = phaseAwareCurveErrorAccounting
    ? stoppingCurveErrors + stoppedCurveErrors
    : null;
  const shutdownPhaseErrorsClassified = phaseAwareCurveErrorAccounting
    && shutdownCancelledCurveErrors === shutdownPhaseCurveErrors;
  const rpcFailures = number(stats.solanaRpc?.stats?.primaryFailures, 0) + number(stats.solanaRpc?.stats?.fallbackFailures, 0);
  const expected = prereg.providerPlan;
  const requested = prereg.validRunDefinition;
  const runtimeEvents = number(coverage.runtimeEvents, 0);
  const queueIntegrityClean = number(coverage.listenerQueueDropped, 0) === 0
    && number(coverage.listenerQueueHandlerErrors, 0) === 0
    && coverage.listenerQueueStopDrainTimedOut !== true
    && number(coverage.runtimeQueueOverflowRejected, 0) === 0
    && number(coverage.runtimeQueueHandlerErrors, 0) === 0
    && number(coverage.runtimeQueuePendingAtStop, 0) === 0
    && number(coverage.runtimeQueueDrainTimeouts, 0) === 0;
  const checks = {
    postRegistration: Boolean(run.started?.timestamp && new Date(run.started.timestamp) > new Date(prereg.preregisteredAt)),
    paperMode: run.started?.payload?.mode === 'PAPER',
    correctStrategyPreregistration: strategyPreregistration.id === prereg.id,
    frozenConfigHash: Boolean(prereg.configFreeze?.expectedConfigHash)
      && run.started?.payload?.configHash === prereg.configFreeze.expectedConfigHash
      && strategyPreregistration.configHash === prereg.configFreeze.expectedConfigHash
      && strategyPreregistration.expectedConfigHash === prereg.configFreeze.expectedConfigHash
      && strategyPreregistration.configHashMatches === true,
    frozenSourceFingerprint: Boolean(prereg.sourceFreeze?.expectedSourceFingerprint)
      && strategyPreregistration.sourceFingerprint === prereg.sourceFreeze.expectedSourceFingerprint
      && strategyPreregistration.expectedSourceFingerprint === prereg.sourceFreeze.expectedSourceFingerprint
      && strategyPreregistration.sourceFingerprintAlgorithm === prereg.sourceFreeze.algorithm
      && strategyPreregistration.sourceFingerprintMatches === true,
    sourceCommitRecorded: prereg.sourceFreeze?.requireGitCommitRecorded !== true
      || /^[0-9a-f]{40}$/i.test(String(strategyPreregistration.gitCommit || '')),
    cleanSourceWorkingTree: prereg.sourceFreeze?.requireCleanWorkingTree !== true
      || (
        strategyPreregistration.gitStateAvailable === true
        && strategyPreregistration.gitWorkingTreeDirty === false
      ),
    requestedDuration: number(run.started?.payload?.sessionDurationMinutes) === requested.requestedRunMinutes,
    selectedProvider: requested.selectedProviderMustBeHelius === true
      && plan.provider === expected.provider
      && coverage.selectedProvider === expected.provider,
    launchIntelSource: requested.launchIntelSourceMustBeHelius === true
      && plan.launchIntelSource === expected.launchIntelSource
      && coverage.launchIntelSource === expected.launchIntelSource,
    heliusRuntimeEnabled: requested.listenerAndRuntimeQueueMustBeEnabled === true
      && plan.heliusRuntimeEnabled === true
      && coverage.listenerEnabled === true
      && coverage.strategyConsumptionEnabled === true,
    providerCurveVerification: expected.providerCurveVerificationRequired === true
      && plan.providerCurveVerificationEnabled === true,
    fullCoverageMinutes: number(coverage.fullCoverageMinutes, 0) >= requested.minimumFullCoverageMinutes,
    subscriptionAcknowledged: number(coverage.subscriptionAcks, 0) >= requested.minimumSubscriptionAcks,
    runtimeEvents: runtimeEvents >= requested.minimumRuntimeEvents,
    noLegacyRuntimeEvents: requested.legacyRuntimeEventsMustBeZero === true
      && number(coverage.legacyRuntimeEvents, 0) === 0,
    runtimeQueueIntegrity: requested.queueDropsErrorsOverflowsAndDrainTimeoutsMustBeZero === true
      && queueIntegrityClean,
    transportGapClosedAtStop: requested.transportGapMustBeClosedAtStop === true
      && coverage.transportGapActiveAtStop !== true,
    phaseAwareCurveErrorAccounting: requested.phaseAwareCurveErrorAccountingRequired === true
      && phaseAwareCurveErrorAccounting,
    activeRuntimeRpcCurveErrors: requested.activePhaseRuntimeRpcCurveErrorsMustBeZero === true
      && phaseAwareCurveErrorAccounting
      && activeCurveErrors === 0,
    shutdownRuntimeRpcCurveErrorsClassified:
      requested.shutdownPhaseErrorsMustBeClassifiedAsCancelled === true
      && shutdownPhaseErrorsClassified,
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
      strategyProvenance: {
        id: strategyPreregistration.id || null,
        configHash: strategyPreregistration.configHash || run.started?.payload?.configHash || null,
        expectedConfigHash: prereg.configFreeze?.expectedConfigHash || null,
        sourceFingerprint: strategyPreregistration.sourceFingerprint || null,
        expectedSourceFingerprint: prereg.sourceFreeze?.expectedSourceFingerprint || null,
        sourceFingerprintAlgorithm: strategyPreregistration.sourceFingerprintAlgorithm || null,
        gitCommit: strategyPreregistration.gitCommit || null,
        gitWorkingTreeDirty: strategyPreregistration.gitWorkingTreeDirty ?? null,
        gitStateAvailable: strategyPreregistration.gitStateAvailable ?? null
      },
      providerPlan: plan,
      providerCoverage: {
        selectedProvider: coverage.selectedProvider,
        launchIntelSource: coverage.launchIntelSource,
        fullCoverageMinutes: round(coverage.fullCoverageMinutes, 4),
        uncoveredMinutes: round(coverage.uncoveredMinutes, 4),
        coverageStartedAt: coverage.coverageStartedAt,
        subscriptionAcks: coverage.subscriptionAcks,
        disconnects: coverage.disconnects,
        transportGapsStarted: coverage.transportGapsStarted,
        transportGapsRecovered: coverage.transportGapsRecovered,
        transportGapActiveAtStop: coverage.transportGapActiveAtStop,
        runtimeNewTokens: coverage.runtimeNewTokens,
        runtimeTrades: coverage.runtimeTrades,
        runtimeMigrations: coverage.runtimeMigrations,
        runtimeEvents,
        legacyRuntimeEvents: coverage.legacyRuntimeEvents,
        listenerQueueDropped: coverage.listenerQueueDropped,
        listenerQueueHandlerErrors: coverage.listenerQueueHandlerErrors,
        listenerQueueStopDrainTimedOut: coverage.listenerQueueStopDrainTimedOut,
        runtimeQueueOverflowRejected: coverage.runtimeQueueOverflowRejected,
        runtimeQueueHandlerErrors: coverage.runtimeQueueHandlerErrors,
        runtimeQueuePendingAtStop: coverage.runtimeQueuePendingAtStop,
        runtimeQueueDrainTimeouts: coverage.runtimeQueueDrainTimeouts
      },
      runtimeRpcCurveErrors: curveErrors,
      activeRuntimeRpcCurveErrors: activeCurveErrors,
      stoppingRuntimeRpcCurveErrors: stoppingCurveErrors,
      stoppedRuntimeRpcCurveErrors: stoppedCurveErrors,
      shutdownCancelledCurveErrors,
      shutdownPhaseCurveErrors,
      shutdownPhaseErrorsClassified,
      curveErrorSessionPhaseCounts: curveStats.errorSessionPhaseCounts || {},
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

function evidenceCollectionClosed(prereg) {
  return prereg?.terminalDisposition?.closedToFurtherLedgerAppends === true;
}

function summarizeLedger(rows, prereg) {
  const runRows = rows.filter((row) => row.recordType !== 'coverage_annotation');
  const validRuns = runRows.filter((row) => row.valid);
  const excludedRuns = runRows.filter((row) => !row.valid);
  const validRunPnlSol = validRuns.reduce((sum, row) => sum + number(row.pnlSol, 0), 0);
  const excludedRunPnlSol = excludedRuns.reduce((sum, row) => sum + number(row.pnlSol, 0), 0);
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
  const fullHours = validRuns.reduce(
    (sum, row) => sum + number(row.fullCoverageMinutes ?? row.fullPaidTapeMinutes, 0) / 60,
    0
  );
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
  const concentrationDependent = totalPnlSol > 0 && pnlAfterRemovingTop3WinnersSol <= 0;
  let verdict = prereg.terminalDisposition?.disposition || 'COLLECTING_RUNTIME_EVIDENCE';
  if (!prereg.terminalDisposition && economicReady) verdict = Object.values(requirements).every(Boolean)
    ? 'RUNTIME_CHECKPOINT_PASSED_PAPER_ONLY'
    : 'FAILED_RUNTIME_CHECKPOINT';
  else if (!prereg.terminalDisposition && validRuns.length >= prereg.stoppingRule.validRuns
    && episodes.length < prereg.economicCheckpoint.minimumUniqueMintEpisodes) {
    verdict = 'INSUFFICIENT_THROUGHPUT_FOR_LIVE_GRADUATION';
  }
  return {
    verdict,
    validRuns: validRuns.length,
    excludedRuns: excludedRuns.length,
    validRunPnlSol: round(validRunPnlSol),
    excludedRunPnlSol: round(excludedRunPnlSol),
    pnlInclusionSemantics: 'valid_run_pnl_drives_checkpoint_excluded_run_pnl_is_context_only',
    realizedUniqueMintEpisodes: episodes.length,
    fullCoverageHours: round(fullHours, 4),
    episodesPerFullCoverageHour: round(episodesPerFullCoverageHour, 6),
    throughputRequirementMet: episodesPerFullCoverageHour !== null
      && episodesPerFullCoverageHour >= prereg.throughputCheckpoint.minimumUniqueMintEpisodesPerFullCoverageHour,
    totalPnlSol: round(totalPnlSol),
    medianEpisodePnlSol: round(median(pnlValues)),
    pnlAfterRemovingTop3WinnersSol: round(pnlAfterRemovingTop3WinnersSol),
    concentrationDependent,
    positiveRuns,
    largestPositiveRunShare: round(largestPositiveRunShare, 6),
    economicCheckpointReady: economicReady,
    economicRequirements: requirements,
    evidenceCollectionClosed: evidenceCollectionClosed(prereg),
    terminalDisposition: prereg.terminalDisposition || null,
    liveAction: 'KEEP_LIVE_DISABLED'
  };
}

function main() {
  const prereg = readJson(PREREG_PATH);
  const telemetryPath = resolveTelemetryPath();
  const run = scanRun(telemetryPath);
  const coverage = scanHeliusRuntimeCoverage(telemetryPath);
  const validation = validateRun(prereg, telemetryPath, run, coverage);
  const episodes = buildEpisodes(run);
  const currentRunEconomics = summarizeEpisodes(episodes);
  const runRow = {
    preregistrationId: prereg.id,
    telemetryPath: relative(telemetryPath),
    startedAt: run.started?.timestamp || null,
    valid: validation.valid,
    failedChecks: validation.failedChecks,
    fullCoverageMinutes: round(coverage.fullCoverageMinutes, 4),
    providerCoverage: validation.actual.providerCoverage,
    strategyProvenance: validation.actual.strategyProvenance,
    coverageDiagnostics: run.coverageDiagnostics,
    episodes,
    pnlSol: currentRunEconomics.totalPnlSol
  };
  let ledgerRows = readLedger();
  let appended = false;
  const collectionClosed = evidenceCollectionClosed(prereg);
  if (validation.checks.postRegistration && !collectionClosed) {
    ({ rows: ledgerRows, appended } = appendRun(runRow));
  }
  const cumulative = summarizeLedger(ledgerRows, prereg);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'paper_only_preregistered_runner_watch_full_coverage_evidence',
    preregistration: prereg,
    currentRun: {
      validation,
      providerCoverage: runRow.providerCoverage,
      coverageDiagnostics: run.coverageDiagnostics,
      episodes,
      economics: currentRunEconomics,
      ledgerAppended: appended,
      ledgerAppendDisposition: collectionClosed
        ? prereg.terminalDisposition.disposition
        : (appended ? 'APPENDED' : 'ALREADY_RECORDED'),
    },
    cumulative,
    ledgerPath: relative(LEDGER_PATH),
    note: 'Only post-registration runs matching the frozen config hash, source fingerprint, clean Git state, Helius-primary plan, and gap-accounted full-coverage definition enter the cumulative evidence ledger. V1-V5 remain separate and terminal. Same-mint reentries are one episode per run.',
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
  summarizeEpisodes,
  evidenceCollectionClosed
};
