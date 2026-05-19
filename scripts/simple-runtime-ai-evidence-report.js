#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const LIVE_ISSUES_PATH = path.join(LOG_DIR, 'live-terminal-issues.jsonl');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'simple-runtime-ai-evidence-latest.json');

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
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

function collectTelemetryRows() {
  const rows = [];
  for (const filePath of telemetryFiles()) {
    for (const event of readJsonl(filePath)) {
      const payload = event.payload || {};
      if (!payload.simpleRuntime) continue;
      rows.push({
        telemetryPath: rel(filePath),
        timestamp: event.timestamp || null,
        type: event.type || event.event || event.name || 'unknown',
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
  }
  return rows;
}

function collectReviewLifecycleRows() {
  const rows = [];
  for (const filePath of telemetryFiles()) {
    for (const event of readJsonl(filePath)) {
      const type = event.type || event.event || event.name || 'unknown';
      if (!type.startsWith('simple_runtime_ai.review_')) continue;
      const payload = event.payload || {};
      rows.push({
        telemetryPath: rel(filePath),
        timestamp: event.timestamp || null,
        type,
        attemptId: payload.attemptId || null,
        signalId: payload.signalId || null,
        mint: payload.mint || null,
        symbol: payload.symbol || null,
        source: payload.source || null,
        attemptType: payload.attemptType || null,
        model: payload.model || null,
        timeoutMs: num(payload.timeoutMs),
        outerTimeoutMs: num(payload.outerTimeoutMs),
        latencyMs: num(payload.latencyMs),
        action: payload.action || null,
        approved: payload.approved === true,
        confidence: num(payload.confidence),
        risk: payload.risk || null,
        reason: payload.reason || null,
        failureType: payload.failureType || null,
        errorMessage: payload.errorMessage || null
      });
    }
  }
  return rows;
}

function collectAiDecisionRows() {
  const rows = [];
  for (const filePath of telemetryFiles()) {
    for (const event of readJsonl(filePath)) {
      const type = event.type || event.event || event.name || 'unknown';
      if (!['ai.veto', 'ai.caution'].includes(type)) continue;
      const payload = event.payload || {};
      rows.push({
        telemetryPath: rel(filePath),
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
  return rows;
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
  const telemetryRows = collectTelemetryRows();
  const lifecycleRows = collectReviewLifecycleRows();
  const aiDecisionRows = collectAiDecisionRows();
  const liveIssueRows = collectLiveIssueRows();
  const startedRows = lifecycleRows.filter((row) => row.type === 'simple_runtime_ai.review_started');
  const completedByAttemptId = new Map(lifecycleRows
    .filter((row) => row.type === 'simple_runtime_ai.review_completed' && row.attemptId)
    .map((row) => [row.attemptId, row]));
  const failedByAttemptId = new Map(lifecycleRows
    .filter((row) => row.type === 'simple_runtime_ai.review_failed' && row.attemptId)
    .map((row) => [row.attemptId, row]));
  const outerTimeoutRows = aiDecisionRows
    .filter((row) => (row.reason === 'OLLAMA_TIMEOUT' || row.timeout === true) && row.signalId);
  const attempts = startedRows.map((started) => {
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
      failureType: terminal.failureType || null,
      exceededOuterTimeout: Number.isFinite(num(terminal.latencyMs)) && Number.isFinite(num(started.outerTimeoutMs))
        ? num(terminal.latencyMs) > num(started.outerTimeoutMs)
        : false,
      consumerObservedOuterTimeout: hadConsumerObservedOuterTimeout(started, outerTimeoutRows)
    };
  });
  const completedAttempts = attempts.filter((row) => row.outcome === 'completed');
  const failedAttempts = attempts.filter((row) => row.outcome === 'failed');
  const danglingAttempts = attempts.filter((row) => row.outcome === 'dangling');
  const completedLatencies = completedAttempts.map((row) => row.latencyMs).filter(Number.isFinite);
  const failedLatencies = failedAttempts.map((row) => row.latencyMs).filter(Number.isFinite);
  const zeroConfidenceHighRiskRows = telemetryRows.filter((row) => row.confidence === 0 && row.risk === 'HIGH');
  const positiveConfidenceRows = telemetryRows.filter((row) => num(row.confidence, 0) > 0);
  const uniqueTokens = new Set(telemetryRows.map((row) => row.token).filter(Boolean));
  const filesWithTelemetryEvidence = new Set(telemetryRows.map((row) => row.telemetryPath));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      logDir: rel(LOG_DIR),
      telemetryFilesRead: telemetryFiles().length,
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
    reviewAttempts: attempts,
    reviewLifecycleRows: lifecycleRows,
    aiDecisionRows,
    telemetryRows,
    liveIssueRows,
    note: 'Report-only Simple Runtime AI evidence audit across historical telemetry and live-terminal issue logs. Lifecycle attempts are counted from simple_runtime_ai.review_started. consumerObservedOuterTimeout is only set when the attempt started before a matching OLLAMA_TIMEOUT decision for the same signalId, so lightweight retries caused by that timeout are not mislabeled as pre-timeout attempts. Legacy telemetry rows show emitted AI outcomes; live issue rows show runtime review failures that may not be represented as structured telemetry failure types. It does not invoke AI, alter decisions, or change runtime behavior.'
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
  collectTelemetryRows
};
