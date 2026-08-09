#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { scanTelemetryCoverage, summarizeRows } = require('./lib/paid-tape-coverage-epochs');
const { scanHeliusRuntimeCoverage } = require('./lib/helius-runtime-coverage');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'data', 'reports');
const OUTPUT_PATH = path.join(REPORT_DIR, 'pre-migration-runner-watch-funnel-latest.json');

const INPUTS = {
  battlefield: 'run-battlefield-latest.json',
  entryFunnel: 'pre-migration-entry-funnel-latest.json',
  runnerNoEntryAutopsy: 'pre-migration-runner-no-entry-autopsy-latest.json',
  flaggedShadowReplay: 'pre-migration-flagged-follow-through-slice-shadow-replay-latest.json',
  highConvictionWatchFollowThrough: 'pre-migration-high-conviction-watch-follow-through-latest.json',
  watchLaneValidation: 'watch-lane-validation-latest.json',
  scorecard: 'strategy-candidate-scorecard-latest.json'
};

function readJson(fileName) {
  const filePath = path.join(REPORT_DIR, fileName);
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, path: path.relative(ROOT, filePath), error: 'missing file', data: {} };
    }
    return {
      ok: true,
      path: path.relative(ROOT, filePath),
      error: null,
      data: JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
    };
  } catch (error) {
    return { ok: false, path: path.relative(ROOT, filePath), error: error.message, data: {} };
  }
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function telemetryPathOf(data = {}) {
  return data.telemetryPath
    || data.summary?.telemetryPath
    || data.sources?.telemetryPath
    || data.run?.telemetryPath
    || null;
}

function normalizedTelemetryPath(value) {
  return value ? String(value).replace(/\\/g, '/').toLowerCase() : null;
}

function round(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function topObjectEntries(value, limit = 12) {
  return Object.entries(value || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function buildReport(docs) {
  const battlefield = docs.battlefield.data || {};
  const entryFunnel = docs.entryFunnel.data?.summary || {};
  const runnerNoEntry = docs.runnerNoEntryAutopsy.data?.summary || {};
  const flaggedReplay = docs.flaggedShadowReplay.data?.summary || {};
  const flaggedReplayRows = docs.flaggedShadowReplay.data?.rows || [];
  const scorecard = docs.scorecard.data?.summary || {};
  const paper = battlefield.preMigrationPaper || {};

  const inputTelemetryPaths = Object.fromEntries(
    Object.entries(docs).map(([key, doc]) => [key, telemetryPathOf(doc.data)])
  );
  const canonicalTelemetryPath = inputTelemetryPaths.entryFunnel
    || inputTelemetryPaths.battlefield
    || null;
  const runnerTelemetryPath = inputTelemetryPaths.runnerNoEntryAutopsy;
  const runnerInputMatches = Boolean(
    canonicalTelemetryPath
    && runnerTelemetryPath
    && normalizedTelemetryPath(canonicalTelemetryPath) === normalizedTelemetryPath(runnerTelemetryPath)
  );
  const canonicalTelemetryFile = canonicalTelemetryPath ? path.resolve(ROOT, canonicalTelemetryPath) : null;
  const heliusCoverage = canonicalTelemetryFile && fs.existsSync(canonicalTelemetryFile)
    ? scanHeliusRuntimeCoverage(canonicalTelemetryFile)
    : null;
  const paidTapeCoverage = canonicalTelemetryFile
    && fs.existsSync(canonicalTelemetryFile)
    && heliusCoverage?.selectedProvider === 'pumpportal'
      ? scanTelemetryCoverage(canonicalTelemetryFile)
      : null;
  const providerCoverage = heliusCoverage?.selectedProvider === 'helius'
    ? {
        provider: 'helius',
        fullCoverageMinutes: round(heliusCoverage.fullCoverageMinutes, 4),
        uncoveredMinutes: round(heliusCoverage.uncoveredMinutes, 4),
        subscriptionAcks: heliusCoverage.subscriptionAcks,
        runtimeEvents: heliusCoverage.runtimeEvents,
        legacyRuntimeEvents: heliusCoverage.legacyRuntimeEvents,
        transportGapsStarted: heliusCoverage.transportGapsStarted,
        transportGapsRecovered: heliusCoverage.transportGapsRecovered,
        transportGapActiveAtStop: heliusCoverage.transportGapActiveAtStop
      }
    : paidTapeCoverage
      ? {
          provider: 'pumpportal',
          fullCoverageMinutes: paidTapeCoverage.fullPaidTapeMinutes,
          uncoveredMinutes: paidTapeCoverage.discoveryRpcOnlyMinutes,
          coverageTruncated: paidTapeCoverage.paidTapeCoverageTruncated,
          coverageEndReason: paidTapeCoverage.coverageEndReason,
          coverageEndedAt: paidTapeCoverage.coverageEndedAt
        }
      : null;
  const shadowCoverageEpochs = paidTapeCoverage
    ? summarizeRows(flaggedReplayRows, paidTapeCoverage.coverageEndedAtMs, 300)
    : null;

  const observedMints = number(entryFunnel.observedMints);
  const flaggedMints = number(entryFunnel.flaggedMints);
  const evaluatedMints = number(entryFunnel.evaluatedMints);
  const enteredMints = number(entryFunnel.enteredMints, number(paper.entries));
  const curve60PlusMints = runnerInputMatches ? number(runnerNoEntry.curve60PlusMints) : null;
  const noEntryRunnerMints = runnerInputMatches ? number(runnerNoEntry.noEntryRunnerMints) : null;
  const simRows = number(flaggedReplay.rows);
  const simMeasured = number(flaggedReplay.measured);
  const simPnlSol = number(flaggedReplay.pnlSol, null);
  const simMedianPnlSol = number(flaggedReplay.medianPnlSol, null);
  const simExTop3PnlSol = number(flaggedReplay.exTop3PnlSol, null);

  const runtimeToSimGap = {
    actualPaperEntryMints: enteredMints,
    reportOnlyShadowRows: simRows,
    reportOnlyMeasuredRows: simMeasured,
    reportOnlyPnlSol: simPnlSol,
    reportOnlyMedianPnlSol: simMedianPnlSol,
    reportOnlyExTop3PnlSol: simExTop3PnlSol,
    interpretation: simMeasured > 0 && enteredMints === 0
      ? 'report_only_replay_found_activity_that_runtime_runner_watch_did_not_admit'
      : 'runtime_and_report_only_activity_are_not_divergent_enough_to_explain'
  };

  const admissionRates = {
    flaggedPerObserved: observedMints ? round(flaggedMints / observedMints, 6) : null,
    evaluatedPerFlagged: flaggedMints ? round(evaluatedMints / flaggedMints, 6) : null,
    enteredPerEvaluated: evaluatedMints ? round(enteredMints / evaluatedMints, 6) : null,
    curve60PlusPerObserved: observedMints && Number.isFinite(curve60PlusMints)
      ? round(curve60PlusMints / observedMints, 6)
      : null,
    noEntryRunnerPerCurve60Plus: curve60PlusMints && Number.isFinite(noEntryRunnerMints)
      ? round(noEntryRunnerMints / curve60PlusMints, 6)
      : null
  };

  const verdict = !runnerInputMatches
    ? 'INPUT_TELEMETRY_MISMATCH'
    : enteredMints === 0 && flaggedMints > 0 && simMeasured > 0
    ? 'RUNNER_WATCH_RUNTIME_ADMISSION_STARVED_WITH_REPORT_ONLY_UPSIDE'
    : (enteredMints > 0
      ? 'RUNNER_WATCH_RUNTIME_ADMITTED_ENTRIES'
      : 'RUNNER_WATCH_SUPPLY_OR_SIGNAL_STARVED');

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_migration_runner_watch_funnel',
    note: 'Studies why the profitable runner-watch structure admits so few runtime paper entries. This report does not loosen gates, create a shadow lane, or change live behavior.',
    inputs: Object.fromEntries(Object.entries(docs).map(([key, doc]) => [key, {
      path: doc.path,
      ok: doc.ok,
      error: doc.error
    }])),
    summary: {
      verdict,
      telemetryPath: canonicalTelemetryPath,
      inputTelemetryIntegrity: {
        runnerInputMatches,
        canonicalTelemetryPath,
        runnerNoEntryTelemetryPath: runnerTelemetryPath,
        inputTelemetryPaths
      },
      observedMints,
      curve60PlusMints,
      flaggedMints,
      evaluatedMints,
      actualPaperEntryMints: enteredMints,
      noEntryRunnerMints,
      admissionRates,
      runtimeToSimGap,
      providerCoverage,
      paidTapeCoverage: paidTapeCoverage ? {
        paidTapeCapped: paidTapeCoverage.paidTapeCapped,
        paidTapeCoverageTruncated: paidTapeCoverage.paidTapeCoverageTruncated,
        coverageEndReason: paidTapeCoverage.coverageEndReason,
        coverageEndedAt: paidTapeCoverage.coverageEndedAt,
        targetedTradeSubscriptionRejections: paidTapeCoverage.targetedTradeSubscriptionRejections,
        budgetReachedAt: paidTapeCoverage.budgetReachedAt,
        fullPaidTapeMinutes: paidTapeCoverage.fullPaidTapeMinutes,
        discoveryRpcOnlyMinutes: paidTapeCoverage.discoveryRpcOnlyMinutes,
        shadowRows: shadowCoverageEpochs
      } : null,
      scorecardStatusCounts: scorecard.statusCounts || {},
      liveAction: scorecard.bestAction || 'KEEP_LIVE_DISABLED',
      interpretation: !runnerInputMatches
        ? 'Runner-watch funnel withheld curve60 metrics because its runner-no-entry input belongs to a different telemetry run.'
        : providerCoverage?.provider === 'helius' && providerCoverage.transportGapActiveAtStop
        ? 'Helius coverage ended with an open transport gap. Treat runtime and replay funnel counts as incomplete provider evidence.'
        : paidTapeCoverage?.paidTapeCoverageTruncated
        ? 'This is a mixed-coverage run. Interpret runtime and shadow funnel rates within their paid-tape epoch; coverage-truncated and discovery/RPC-only rows are labeled separately.'
        : enteredMints === 0 && simMeasured > 0
        ? 'The next question is why runner-watch confirmation admitted zero runtime entries while report-only shadow/sim paths still found candidates. Treat the sim as a gap to explain, not as permission to loosen gates.'
        : enteredMints === 0
          ? 'Neither runtime runner-watch nor same-run report-only shadow replay found an admissible candidate; this run is supply-starved within captured coverage.'
        : 'Runner-watch admitted runtime entries; inspect their exits before changing any gates.'
    },
    bottlenecks: {
      topRuntimeGuardReasons: topObjectEntries(entryFunnel.topGuardReasons),
      topFlagReasons: topObjectEntries(entryFunnel.topFlagReasons),
      runnerNoEntryBindingGates: topObjectEntries(runnerNoEntry.bindingGates),
      reportOnlyShadowSourceReasons: topObjectEntries(flaggedReplay.sourceReasons)
    },
    nextQuestions: [
      'Which exact runner-watch confirmation check blocks the evaluated flagged population?',
      'Do report-only winners have the same decision-time fields that runner-watch requires, or are they benefiting from replay-only hindsight?',
      'Would unchanged runner-watch logic have admitted these mints if it saw the confirmation earlier, or did the candidates never truly satisfy the runtime structure?',
      'Do not convert this report into a new entry lane without a separate pre-registration.'
    ]
  };
}

function main() {
  const docs = Object.fromEntries(
    Object.entries(INPUTS).map(([key, fileName]) => [key, readJson(fileName)])
  );
  const report = buildReport(docs);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { buildReport };
