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
  const liveIssueRows = collectLiveIssueRows();
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
    telemetryRows,
    liveIssueRows,
    note: 'Report-only Simple Runtime AI evidence audit across historical telemetry and live-terminal issue logs. Telemetry rows show emitted AI outcomes; live issue rows show runtime review failures that may not be represented as structured telemetry failure types. It does not invoke AI, alter decisions, or change runtime behavior.'
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
