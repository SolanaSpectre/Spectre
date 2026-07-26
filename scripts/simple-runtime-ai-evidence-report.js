#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const LIVE_ISSUES_PATH = path.join(LOG_DIR, 'live-terminal-issues.jsonl');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'simple-runtime-ai-evidence-latest.json');

function readJsonl(filePath) {
  return readJsonlSync(filePath);
}

function telemetryFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(LOG_DIR, name));
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function num(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, digits = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function percentile(values, p) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return compact(sorted[index], 2);
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function collectTelemetryEvidence() {
  const telemetryRows = [];
  const lifecycleRows = [];
  const aiDecisionRows = [];
  const files = telemetryFiles();

  for (const filePath of files) {
    const telemetryPath = rel(filePath);
    for (const event of readJsonl(filePath)) {
      const type = event.type || event.event || event.name || 'unknown';
      const payload = event.payload || {};

      if (payload.simpleRuntime) {
        telemetryRows.push({
          telemetryPath,
          timestamp: event.timestamp || null,
          type,
          signalId: payload.signalId || null,
          token: payload.token || payload.mint || null,
          reason: payload.reason || payload.rejectionReason || null,
          confidence: num(payload.confidence),
          action: payload.action || payload.decision || null,
          risk: payload.simpleRuntime?.risk || null,
          model: payload.simpleRuntime?.model || null,
          failureType: payload.simpleRuntime?.failureType || null,
          timeout: payload.timeout === true
        });
      }

      if (type.startsWith('simple_runtime_ai.review_')) {
        lifecycleRows.push({
          telemetryPath,
          timestamp: event.timestamp || null,
          type,
          attemptId: payload.attemptId || null,
          signalId: payload.signalId || null,
          mint: payload.mint || null,
          symbol: payload.symbol || null,
          source: payload.source || null,
          attemptType: payload.attemptType || null,
          model: payload.model || null,
          promptVersion: payload.promptVersion || null,
          promptHash: payload.promptHash || null,
          schemaVersion: payload.schemaVersion || null,
          trialEvidenceEligible: payload.trialEvidenceEligible !== false,
          trialEvidenceDisposition: payload.trialEvidenceDisposition || null,
          trialEvidencePauseReason: payload.trialEvidencePauseReason || null,
          packetHash: payload.packetHash || null,
          packet: payload.packet || null,
          guardOutcome: payload.guardOutcome || null,
          inFlightAttemptId: payload.inFlightAttemptId || null,
          reviewedPacketHash: payload.reviewedPacketHash || null,
          waitedMs: num(payload.waitedMs),
          modelReviewed: payload.modelReviewed !== false,
          guardCounters: payload.guardCounters || null,
          timeoutMs: num(payload.timeoutMs),
          outerTimeoutMs: num(payload.outerTimeoutMs),
          latencyMs: num(payload.latencyMs),
          action: payload.action || null,
          approved: payload.approved === true,
          confidence: num(payload.confidence),
          risk: payload.risk || null,
          reason: payload.reason || null,
          rawResponseHash: payload.rawResponseHash || null,
          normalizedReview: payload.normalizedReview || null,
          failureType: payload.failureType || null,
          errorMessage: payload.errorMessage || null
        });
      }

      if (['ai.veto', 'ai.caution'].includes(type)) {
        aiDecisionRows.push({
          telemetryPath,
          timestamp: event.timestamp || null,
          type,
          signalId: payload.signalId || null,
          token: payload.token || payload.mint || null,
          reason: payload.reason || payload.rejectionReason || null,
          confidence: num(payload.confidence),
          simpleRuntime: payload.simpleRuntime || null,
          timeout: payload.timeout === true
        });
      }
    }
  }

  return { filesRead: files.length, telemetryRows, lifecycleRows, aiDecisionRows };
}

function collectTelemetryRows() {
  return collectTelemetryEvidence().telemetryRows;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function hadConsumerObservedOuterTimeout(started, timeoutRows) {
  const startedMs = timestampMs(started.timestamp);
  if (!started.signalId || !Number.isFinite(startedMs)) return false;
  return timeoutRows.some((row) => {
    if (row.signalId !== started.signalId) return false;
    const timeoutMs = timestampMs(row.timestamp);
    return Number.isFinite(timeoutMs) && startedMs <= timeoutMs;
  });
}

function joinLifecycleAttempts(lifecycleRows = [], aiDecisionRows = []) {
  const startedRows = lifecycleRows.filter((row) => row.type === 'simple_runtime_ai.review_started');
  const completedByAttemptId = new Map(lifecycleRows
    .filter((row) => row.type === 'simple_runtime_ai.review_completed' && row.attemptId)
    .map((row) => [row.attemptId, row]));
  const failedByAttemptId = new Map(lifecycleRows
    .filter((row) => row.type === 'simple_runtime_ai.review_failed' && row.attemptId)
    .map((row) => [row.attemptId, row]));
  const outerTimeoutRows = aiDecisionRows
    .filter((row) => (row.reason === 'OLLAMA_TIMEOUT' || row.timeout === true) && row.signalId);

  return startedRows.map((started) => {
    const completed = completedByAttemptId.get(started.attemptId);
    const failed = failedByAttemptId.get(started.attemptId);
    const outcome = completed ? 'completed' : failed ? 'failed' : 'dangling';
    const terminal = completed || failed || {};
    return {
      ...started,
      outcome,
      completedAt: completed?.timestamp || null,
      failedAt: failed?.timestamp || null,
      latencyMs: terminal.latencyMs ?? null,
      action: terminal.action || null,
      approved: terminal.approved === true,
      confidence: terminal.confidence ?? null,
      risk: terminal.risk || null,
      reason: terminal.reason || null,
      rawResponseHash: terminal.rawResponseHash || null,
      normalizedReview: terminal.normalizedReview || null,
      failureType: terminal.failureType || null,
      errorMessage: terminal.errorMessage || null,
      exceededOuterTimeout: Number.isFinite(num(terminal.latencyMs)) && Number.isFinite(num(started.outerTimeoutMs))
        ? num(terminal.latencyMs) > num(started.outerTimeoutMs)
        : false,
      consumerObservedOuterTimeout: hadConsumerObservedOuterTimeout(started, outerTimeoutRows)
    };
  });
}

function summarizeResponseDiversity(attempts = []) {
  const completed = attempts.filter((row) => row.outcome === 'completed');
  const packetHashes = completed.map((row) => row.packetHash).filter(Boolean);
  const responseHashes = completed.map((row) => row.rawResponseHash).filter(Boolean);
  const responseGroups = new Map();
  completed.forEach((row) => {
    if (!row.rawResponseHash) return;
    const rows = responseGroups.get(row.rawResponseHash) || [];
    rows.push(row);
    responseGroups.set(row.rawResponseHash, rows);
  });
  const repeatedAcrossDistinctPackets = [...responseGroups.entries()]
    .map(([rawResponseHash, rows]) => ({
      rawResponseHash,
      reviews: rows.length,
      distinctPacketHashes: new Set(rows.map((row) => row.packetHash).filter(Boolean)).size,
      mints: [...new Set(rows.map((row) => row.mint).filter(Boolean))]
    }))
    .filter((group) => group.distinctPacketHashes > 1)
    .sort((a, b) => b.reviews - a.reviews);
  const uniqueResponses = new Set(responseHashes).size;
  const uniquePackets = new Set(packetHashes).size;
  const actionCounts = countBy(completed, (row) => row.action);
  const riskCounts = countBy(completed, (row) => row.risk);
  const reasonCounts = countBy(completed, (row) => row.reason);
  const confidenceCounts = countBy(completed, (row) => row.confidence);

  return {
    completedReviews: completed.length,
    completedReviewsWithResponseHash: responseHashes.length,
    distinctPacketHashes: uniquePackets,
    distinctRawResponseHashes: uniqueResponses,
    responseDiversityRate: responseHashes.length ? compact(uniqueResponses / responseHashes.length, 4) : null,
    identicalResponseAcrossDistinctPackets: repeatedAcrossDistinctPackets.length > 0,
    repeatedResponseGroups: repeatedAcrossDistinctPackets,
    actionCounts,
    riskCounts,
    confidenceCounts,
    reasonCounts,
    uniformAction: completed.length > 1 && Object.keys(actionCounts).length === 1,
    uniformRisk: completed.length > 1 && Object.keys(riskCounts).length === 1,
    uniformConfidence: completed.length > 1 && Object.keys(confidenceCounts).length === 1,
    uniformReason: completed.length > 1 && Object.keys(reasonCounts).length === 1,
    interpretation: completed.length < 2
      ? 'INSUFFICIENT_REVIEWS_FOR_RESPONSE_DIVERSITY'
      : (repeatedAcrossDistinctPackets.length
        ? 'IDENTICAL_RESPONSE_OBSERVED_ACROSS_DISTINCT_PACKETS'
        : 'RESPONSES_DIFFER_ACROSS_OBSERVED_PACKETS'),
    frozenCheckpointImpact: 'DIAGNOSTIC_ONLY_NOT_A_POST_HOC_ABORT_OR_PASS_GATE'
  };
}

function collectLiveIssueRows() {
  return readJsonl(LIVE_ISSUES_PATH)
    .filter((row) => row.message === 'Simple runtime AI review failed')
    .map((row) => ({
      timestamp: row.timestamp || null,
      failureType: typeof row.data === 'object' && row.data ? row.data.failureType || null : null,
      reason: typeof row.data === 'object' && row.data ? row.data.reason || null : null,
      message: typeof row.data === 'object' && row.data ? row.data.message || null : String(row.data || '')
    }));
}

function buildReport() {
  const telemetryEvidence = collectTelemetryEvidence();
  const { telemetryRows, lifecycleRows, aiDecisionRows } = telemetryEvidence;
  const liveIssueRows = collectLiveIssueRows();
  const attempts = joinLifecycleAttempts(lifecycleRows, aiDecisionRows);
  const completedAttempts = attempts.filter((row) => row.outcome === 'completed');
  const failedAttempts = attempts.filter((row) => row.outcome === 'failed');
  const danglingAttempts = attempts.filter((row) => row.outcome === 'dangling');
  const completedLatencies = completedAttempts.map((row) => row.latencyMs).filter(Number.isFinite);
  const failedLatencies = failedAttempts.map((row) => row.latencyMs).filter(Number.isFinite);
  const zeroConfidenceHighRiskRows = telemetryRows.filter((row) => row.confidence === 0 && row.risk === 'HIGH');
  const positiveConfidenceRows = telemetryRows.filter((row) => num(row.confidence, 0) > 0);
  const uniqueTokens = new Set(telemetryRows.map((row) => row.token).filter(Boolean));
  const filesWithTelemetryEvidence = new Set(telemetryRows.map((row) => row.telemetryPath));
  const qwenAllV2Attempts = attempts.filter((row) => (
    row.model === 'qwen2.5:7b-instruct' &&
    row.promptVersion === 'simple_runtime_guard_v2'
  ));
  const qwenTrialAttempts = qwenAllV2Attempts.filter((row) => (
    row.trialEvidenceEligible !== false &&
    (!row.guardOutcome || row.guardOutcome === 'acquired')
  ));
  const qwenTrialRequests = qwenAllV2Attempts.filter((row) => (
    row.trialEvidenceEligible !== false
  ));
  const qwenDiagnosticOnlyRequests = qwenAllV2Attempts.filter((row) => row.trialEvidenceEligible === false);
  const qwenTrialBusy = qwenTrialRequests.filter((row) => row.guardOutcome === 'busy_rejected');
  const qwenTrialDedup = qwenTrialRequests.filter((row) => row.guardOutcome === 'deduped_joined');
  const qwenTrialCompleted = qwenTrialAttempts.filter((row) => row.outcome === 'completed');
  const qwenTrialFailures = qwenTrialAttempts.filter((row) => row.outcome === 'failed');
  const qwenTrialTimeouts = qwenTrialFailures.filter((row) => row.failureType === 'timeout');
  const qwenTrialMalformed = qwenTrialFailures.filter((row) => row.failureType === 'malformed_json');
  const qwenTrialRuns = new Set(qwenTrialAttempts.map((row) => row.telemetryPath));
  const qwenTrialTimeoutRate = qwenTrialAttempts.length
    ? qwenTrialTimeouts.length / qwenTrialAttempts.length
    : 0;
  const qwenTrialPacketCoverage = qwenTrialAttempts.length
    ? qwenTrialAttempts.filter((row) => row.packet && row.packetHash).length / qwenTrialAttempts.length
    : 0;
  const qwenTrialBusyRate = qwenTrialRequests.length
    ? qwenTrialBusy.length / qwenTrialRequests.length
    : 0;
  const qwenTrialBurstCensored = qwenTrialBusyRate > 0.3;
  const qwenResponseDiversity = summarizeResponseDiversity(qwenTrialCompleted);
  const qwenAbortReasons = [];
  if (qwenTrialAttempts.length && qwenTrialTimeoutRate > 0.05) qwenAbortReasons.push('TIMEOUT_RATE_GT_5_PERCENT');
  if (qwenTrialMalformed.length) qwenAbortReasons.push('MALFORMED_JSON_OBSERVED');
  const qwenTrialEvidenceComplete =
    qwenTrialCompleted.length >= 50 &&
    qwenTrialRuns.size >= 2 &&
    qwenTrialPacketCoverage === 1;
  const qwenTrialVerdict = 'PAUSED_IDENTICAL_RESPONSE_DEGENERACY';

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      logDir: rel(LOG_DIR),
      telemetryFilesRead: telemetryEvidence.filesRead,
      liveIssuesPath: rel(LIVE_ISSUES_PATH)
    },
    summary: {
      reviewAttempts: attempts.length,
      completedAttempts: completedAttempts.length,
      failedAttempts: failedAttempts.length,
      danglingAttempts: danglingAttempts.length,
      consumerObservedOuterTimeoutAttempts: attempts.filter((row) => row.consumerObservedOuterTimeout).length,
      attemptsExceedingOuterTimeout: attempts.filter((row) => row.exceededOuterTimeout).length,
      completedLatencyMs: {
        median: percentile(completedLatencies, 50),
        p90: percentile(completedLatencies, 90),
        max: completedLatencies.length ? compact(Math.max(...completedLatencies), 2) : null
      },
      failedLatencyMs: {
        median: percentile(failedLatencies, 50),
        p90: percentile(failedLatencies, 90),
        max: failedLatencies.length ? compact(Math.max(...failedLatencies), 2) : null
      },
      attemptTypeCounts: countBy(attempts, (row) => row.attemptType),
      attemptOutcomeCounts: countBy(attempts, (row) => row.outcome),
      guardOutcomeCounts: countBy(attempts, (row) => row.guardOutcome || 'legacy_unclassified'),
      maximumObservedConcurrentRequests: Math.max(
        0,
        ...lifecycleRows.map((row) => num(row.guardCounters?.maxObservedConcurrentRequests, 0))
      ),
      completedActionCounts: countBy(completedAttempts, (row) => row.action),
      completedRiskCounts: countBy(completedAttempts, (row) => row.risk),
      failedFailureTypeCounts: countBy(failedAttempts, (row) => row.failureType),
      telemetryEvidenceRows: telemetryRows.length,
      telemetryFilesWithEvidence: filesWithTelemetryEvidence.size,
      uniqueTokensWithTelemetryEvidence: uniqueTokens.size,
      positiveConfidenceRows: positiveConfidenceRows.length,
      zeroConfidenceHighRiskRows: zeroConfidenceHighRiskRows.length,
      liveIssueFailureRows: liveIssueRows.length,
      telemetryEventTypeCounts: countBy(telemetryRows, (row) => row.type),
      telemetryReasonCounts: countBy(telemetryRows, (row) => row.reason),
      telemetryRiskCounts: countBy(telemetryRows, (row) => row.risk),
      liveIssueFailureTypeCounts: countBy(liveIssueRows, (row) => row.failureType || row.message)
    },
    qwenPaperTrial: {
      preregisteredBeforeRuntimeEvidence: true,
      model: 'qwen2.5:7b-instruct',
      promptVersion: 'simple_runtime_guard_v2',
      evidenceCollectionPaused: true,
      pauseReason: 'IDENTICAL_RESPONSE_ACROSS_DISTINCT_PACKETS',
      diagnosticOnlyRequestsAfterPause: qwenDiagnosticOnlyRequests.length,
      pausedRowsCannotAdvanceCheckpoint: true,
      minimumCompletedReviews: 50,
      minimumPaperRuns: 2,
      schemaVersionCounts: countBy(qwenTrialAttempts, (row) => row.schemaVersion || 'unknown'),
      abortIfTimeoutRateAbove: 0.05,
      abortOnAnyMalformedJson: true,
      maximumBusyRateForDecisionQuality: 0.3,
      busyRateDefinition: 'busy_rejected / (acquired + deduped_joined + busy_rejected) guarded requests',
      requirePacketEvidenceCoverage: 1,
      totalGuardedRequests: qwenTrialRequests.length,
      attempts: qwenTrialAttempts.length,
      completedReviews: qwenTrialCompleted.length,
      busyRejects: qwenTrialBusy.length,
      dedupJoins: qwenTrialDedup.length,
      busyRate: compact(qwenTrialBusyRate, 4),
      burstCensored: qwenTrialBurstCensored,
      paperRuns: qwenTrialRuns.size,
      timeoutRate: compact(qwenTrialTimeoutRate, 4),
      malformedJsonFailures: qwenTrialMalformed.length,
      packetEvidenceCoverage: compact(qwenTrialPacketCoverage, 4),
      responseDiversity: qwenResponseDiversity,
      abortReasons: qwenAbortReasons,
      verdict: qwenTrialVerdict,
      priorRuleVerdictIfNotPaused: qwenAbortReasons.length
        ? 'ABORT_QWEN_PAPER_TRIAL'
        : qwenTrialEvidenceComplete
          ? qwenTrialBurstCensored
            ? 'QWEN_PAPER_TRIAL_BURST_CENSORED'
            : 'QWEN_PAPER_EVIDENCE_CHECKPOINT_REACHED'
          : 'COLLECT_QWEN_PAPER_EVIDENCE',
      scope: 'Main signal lane only. Pre-migration V4 and runner-watch evidence lanes bypass reviewTrade.',
      liveUse: 'BLOCKED'
    },
    reviewAttempts: attempts,
    reviewLifecycleRows: lifecycleRows,
    aiDecisionRows,
    telemetryRows,
    liveIssueRows,
    note: 'Report-only Simple Runtime AI evidence audit across historical telemetry and live-terminal issue logs. Lifecycle requests are counted from simple_runtime_ai.review_started; Qwen completed-review stopping rules count only guard acquisitions, never busy rejects or same-mint dedup joins. BUSY is reported separately and does not count as timeout or malformed output. Busy rate is busy_rejected divided by all guarded requests (acquired + deduped_joined + busy_rejected); dedup joins remain in the denominator because they received a disclosed shared answer. consumerObservedOuterTimeout is only set when the attempt started before a matching OLLAMA_TIMEOUT decision for the same signalId, so lightweight retries caused by that timeout are not mislabeled as pre-timeout attempts. Legacy telemetry rows show emitted AI outcomes; live issue rows show runtime review failures that may not be represented as structured telemetry failure types. It does not invoke AI, alter decisions, or change runtime behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  collectLiveIssueRows,
  collectTelemetryRows,
  joinLifecycleAttempts,
  summarizeResponseDiversity
};
