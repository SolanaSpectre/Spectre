#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const PREREG_PATH = path.join(ROOT, 'data', 'strategy-preregistrations', 'helius-decision-divergence-v1.json');
const PARITY_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-shadow-parity-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-decision-divergence');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-decision-divergence-latest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function latestTelemetryPath() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => ({ filePath: path.join(LOG_DIR, name), mtimeMs: fs.statSync(path.join(LOG_DIR, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.filePath || null;
}

function parseCli(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--telemetry');
  return { telemetryPath: index >= 0 ? path.resolve(argv[index + 1]) : latestTelemetryPath() };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function stats(values = []) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, mean: null };
  const quantile = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  return {
    count: sorted.length,
    min: sorted[0],
    median: quantile(0.5),
    p90: quantile(0.9),
    max: sorted[sorted.length - 1],
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length
  };
}

function collect(events = []) {
  const state = { sessionStarted: null, sessionStopped: null, evaluations: [], executedActions: [] };
  for (const event of events) {
    if (event.type === 'session.started') state.sessionStarted = { timestamp: event.timestamp, payload: event.payload || {} };
    else if (event.type === 'session.stopping' || event.type === 'session.stopped') {
      state.sessionStopped = { timestamp: event.timestamp, payload: event.payload || {} };
    } else if (event.type === 'helius_pumpfun.decision_shadow.evaluation') {
      state.evaluations.push({ timestamp: event.timestamp, ...(event.payload || {}) });
    } else if (event.type === 'helius_pumpfun.decision_shadow.executed_action') {
      state.executedActions.push({ timestamp: event.timestamp, ...(event.payload || {}) });
    }
  }
  return state;
}

function buildReport({ state, preregistration, parity = {}, sourceTelemetry = null }) {
  const evaluations = state.evaluations.filter((row) => row.preregistrationId === preregistration.id);
  const comparable = evaluations.filter((row) => row.comparable === true);
  const actionMatches = comparable.filter((row) => row.actionAgreement === true);
  const reasonMatches = comparable.filter((row) => row.reasonAgreement === true);
  const walletCharacterized = comparable.filter((row) => row.walletComparison?.portal && row.walletComparison?.helius);
  const walletFeatureMatches = walletCharacterized.filter((row) => row.walletComparison.featureAgreement === true);
  const trackedAddressMatches = walletCharacterized.filter((row) => row.walletComparison.trackedAddressAgreement === true);
  const divergences = comparable.filter((row) => row.actionAgreement !== true);
  const executed = state.executedActions.filter((row) => row.preregistrationId === preregistration.id);
  const executedMatches = executed.filter((row) => row.comparable === true && row.actionAgreement === true);
  const entryActions = executed.filter((row) => row.action === 'ENTRY');
  const exitActions = executed.filter((row) => row.action === 'EXIT');
  const sourceMatches = !sourceTelemetry || parity.sourceTelemetry === sourceTelemetry;
  const plan = state.sessionStarted?.payload?.heliusPumpfunShadowPlan || {};
  const startMs = Date.parse(state.sessionStarted?.timestamp || '');
  const checks = {
    postRegistration: Number.isFinite(startMs) && startMs > Date.parse(preregistration.frozenAt),
    paperMode: state.sessionStarted?.payload?.mode === 'PAPER',
    decisionShadowEnabled: plan.decisionShadowEnabled === true,
    strategyConsumptionDisabled: plan.strategyConsumptionEnabled === false,
    completedLifecycle: state.sessionStopped?.payload?.reason === 'SESSION_DURATION_EXCEEDED',
    sameTelemetryAsParity: sourceMatches,
    concurrentV5ParityPassed: parity.verdict === preregistration.concurrentRequirements.heliusV5ParityVerdict,
    cleanHeliusLifecycle: parity.checks?.cleanHeliusLifecycle === true,
    minimumComparableGateEvaluations: comparable.length >= preregistration.minimumComparableGateEvaluations,
    comparableEvaluationCoverage: ratio(comparable.length, evaluations.length)
      >= preregistration.minimumComparableEvaluationCoverageRate,
    gateActionAgreement: ratio(actionMatches.length, comparable.length) >= preregistration.minimumGateActionAgreementRate,
    walletDivergenceCharacterized: walletCharacterized.length === comparable.length,
    minimumExecutedEntries: entryActions.length >= preregistration.minimumExecutedEntries,
    minimumExecutedExits: exitActions.length >= preregistration.minimumExecutedExits,
    executedActionAgreement: ratio(executedMatches.length, executed.length) === preregistration.executedActionAgreementRequired
  };
  const validityChecks = [
    'postRegistration',
    'paperMode',
    'decisionShadowEnabled',
    'strategyConsumptionDisabled',
    'completedLifecycle',
    'sameTelemetryAsParity'
  ];
  const validityPassed = validityChecks.every((key) => checks[key]);
  const evidenceReady = checks.minimumComparableGateEvaluations
    && checks.minimumExecutedEntries
    && checks.minimumExecutedExits;
  let verdict = preregistration.invalidVerdict;
  if (validityPassed) {
    verdict = !evidenceReady
      ? preregistration.insufficientVerdict
      : (Object.values(checks).every(Boolean) ? preregistration.passVerdict : preregistration.failVerdict);
  }
  const divergenceByReason = divergences.reduce((counts, row) => {
    const key = `${row.actualReason || 'NONE'} -> ${row.shadowReason || 'NONE'}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    sourceTelemetry,
    preregistration,
    verdict,
    checks,
    counts: {
      evaluations: evaluations.length,
      comparableGateEvaluations: comparable.length,
      unavailableGateEvaluations: evaluations.length - comparable.length,
      gateActionMatches: actionMatches.length,
      gateActionDivergences: divergences.length,
      reasonMatches: reasonMatches.length,
      walletCharacterizedEvaluations: walletCharacterized.length,
      walletFeatureMatches: walletFeatureMatches.length,
      trackedAddressMatches: trackedAddressMatches.length,
      executedActions: executed.length,
      executedActionMatches: executedMatches.length,
      executedEntries: entryActions.length,
      executedExits: exitActions.length
    },
    agreement: {
      gateActionAgreementRate: ratio(actionMatches.length, comparable.length),
      comparableEvaluationCoverageRate: ratio(comparable.length, evaluations.length),
      gateReasonAgreementRate: ratio(reasonMatches.length, comparable.length),
      walletFeatureAgreementRate: ratio(walletFeatureMatches.length, walletCharacterized.length),
      trackedAddressAgreementRate: ratio(trackedAddressMatches.length, walletCharacterized.length),
      executedActionAgreementRate: ratio(executedMatches.length, executed.length),
      shadowStateAgeMs: stats(comparable.map((row) => row.shadowStateAgeMs))
    },
    divergenceByReason,
    divergenceSamples: divergences.slice(0, 50),
    executedActionComparisons: executed,
    paritySummary: {
      sourceTelemetry: parity.sourceTelemetry || null,
      verdict: parity.verdict || null,
      eligibleMintHours: parity.counts?.eligibleMintHours ?? null,
      recallPassRate: parity.agreement?.mintHourPortalTradeIdentityRecallPassRate ?? null,
      volumePassRate: parity.agreement?.mintHourVolumePassRate ?? null,
      curvePassRate: parity.agreement?.curvePassRate ?? null
    },
    interpretation: verdict === preregistration.passVerdict
      ? 'Decision shadow passed its frozen report-only gate. Build and validate a Helius-backed evidence path before changing procurement.'
      : 'Keep Helius report-only for strategy consumption. Diagnose unavailable state and decision, wallet, or executed-action divergence before procurement promotion.'
  };
}

function analyzeEvents(events, preregistration, parity, sourceTelemetry = 'synthetic') {
  return buildReport({ state: collect(events), preregistration, parity, sourceTelemetry });
}

function main() {
  const { telemetryPath } = parseCli();
  const preregistration = readJson(PREREG_PATH);
  const parity = fs.existsSync(PARITY_PATH) ? readJson(PARITY_PATH) : {};
  const events = [];
  let malformedLines = 0;
  if (telemetryPath && fs.existsSync(telemetryPath)) {
    const readStats = forEachJsonlSync(telemetryPath, (event) => events.push(event));
    malformedLines = readStats.malformedLines;
  }
  const sourceTelemetry = telemetryPath
    ? path.relative(ROOT, telemetryPath).replace(/\\/g, '/')
    : null;
  const report = buildReport({ state: collect(events), preregistration, parity, sourceTelemetry });
  report.counts.malformedTelemetryLines = malformedLines;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stampedPath = path.join(OUTPUT_DIR, `helius-pumpfun-decision-divergence-${stamp}.json`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(stampedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict: report.verdict, checks: report.checks, counts: report.counts, agreement: report.agreement }, null, 2));
}

if (require.main === module) main();

module.exports = { analyzeEvents, buildReport, collect, stats };
