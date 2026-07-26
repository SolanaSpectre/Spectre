'use strict';

const fs = require('fs');
const path = require('path');

function relativePath(root, filePath) {
  return filePath ? path.relative(root, filePath).replace(/\\/g, '/') : null;
}

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function valueAtPath(value, jsonPath) {
  return String(jsonPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => current?.[key], value);
}

function normalizeTelemetryPath(value, root = process.cwd()) {
  if (!value) return null;
  const normalizedSeparators = String(value).replace(/[\\/]+/g, path.sep);
  const resolved = path.isAbsolute(normalizedSeparators)
    ? path.normalize(normalizedSeparators)
    : path.resolve(root, normalizedSeparators);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function sameTelemetry(left, right, root = process.cwd()) {
  if (!left || !right) return false;
  return normalizeTelemetryPath(left, root) === normalizeTelemetryPath(right, root);
}

function buildReportArgs(report, telemetryPath) {
  const args = Array.isArray(report?.args) ? [...report.args] : [];
  if (!telemetryPath || !report?.telemetryCli) return args;
  if (report.telemetryCli === 'equals') return [...args, `--telemetry=${telemetryPath}`];
  if (report.telemetryCli === 'pair') return [...args, '--telemetry', telemetryPath];
  throw new Error(`Unsupported telemetry CLI style for ${report.script}: ${report.telemetryCli}`);
}

function inspectReportArtifact(root, report, telemetryPath, invocationStartedAtMs) {
  if (!report?.artifactPath) {
    return {
      status: 'NOT_DECLARED',
      artifactPath: null
    };
  }
  const artifactPath = path.isAbsolute(report.artifactPath)
    ? report.artifactPath
    : path.join(root, report.artifactPath);
  if (!fs.existsSync(artifactPath)) {
    return {
      status: 'MISSING_ARTIFACT',
      artifactPath: relativePath(root, artifactPath)
    };
  }

  const stat = fs.statSync(artifactPath);
  const generatedThisInvocation = stat.mtimeMs >= Number(invocationStartedAtMs || 0);
  const json = path.extname(artifactPath).toLowerCase() === '.json'
    ? readJson(artifactPath)
    : null;
  const telemetryJsonPaths = [
    report.artifactTelemetryJsonPath,
    ...(report.artifactTelemetryJsonPaths || [])
  ].filter((jsonPath, index, rows) => jsonPath && rows.indexOf(jsonPath) === index);
  const telemetryChecks = telemetryJsonPaths.map((jsonPath) => {
    const reportedTelemetryPath = valueAtPath(json, jsonPath);
    return {
      jsonPath,
      expectedTelemetryPath: relativePath(root, telemetryPath),
      reportedTelemetryPath: reportedTelemetryPath ?? null,
      passed: sameTelemetry(reportedTelemetryPath, telemetryPath, root)
    };
  });
  const telemetryStatus = telemetryChecks.length === 0
    ? 'NOT_APPLICABLE'
    : telemetryChecks.every((row) => row.passed)
      ? 'MATCHED'
      : 'STALE_INPUT';
  const reportedTelemetryPath = telemetryChecks[0]?.reportedTelemetryPath ?? null;
  const requiredJsonValues = Object.entries(report.requiredJsonValues || {}).map(([jsonPath, expected]) => {
    const actual = valueAtPath(json, jsonPath);
    return {
      jsonPath,
      expected,
      actual: actual ?? null,
      passed: actual === expected
    };
  });
  const requiredValuesPassed = requiredJsonValues.every((row) => row.passed);
  let status = 'CURRENT';
  if (!generatedThisInvocation) status = 'NOT_REGENERATED';
  else if (telemetryStatus === 'STALE_INPUT') status = 'STALE_INPUT';
  else if (!requiredValuesPassed) status = 'ASSERTION_FAILED';

  return {
    status,
    artifactPath: relativePath(root, artifactPath),
    modifiedAt: stat.mtime.toISOString(),
    generatedThisInvocation,
    telemetryStatus,
    expectedTelemetryPath: relativePath(root, telemetryPath),
    reportedTelemetryPath,
    telemetryChecks,
    requiredJsonValues
  };
}

function ledgerPaths(root, profile, telemetryPath, startedAt) {
  const reportDir = path.join(root, 'data', 'reports');
  const historyDir = path.join(reportDir, 'post-run-ledgers');
  const telemetryStem = path.basename(telemetryPath || 'no-telemetry', path.extname(telemetryPath || ''))
    .replace(/[^a-z0-9_-]+/gi, '-');
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  return {
    latestPath: path.join(reportDir, `post-run-${profile}-ledger-latest.json`),
    historyPath: path.join(historyDir, `${telemetryStem}-${profile}-${stamp}.json`)
  };
}

function writeReportLedger(root, ledger) {
  const paths = ledgerPaths(root, ledger.profile, ledger.telemetryPath, ledger.startedAt);
  fs.mkdirSync(path.dirname(paths.latestPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.historyPath), { recursive: true });
  const serialized = `${JSON.stringify(ledger, null, 2)}\n`;
  fs.writeFileSync(paths.latestPath, serialized, 'utf8');
  fs.writeFileSync(paths.historyPath, serialized, 'utf8');
  return {
    latestPath: relativePath(root, paths.latestPath),
    historyPath: relativePath(root, paths.historyPath)
  };
}

module.exports = {
  buildReportArgs,
  inspectReportArtifact,
  sameTelemetry,
  valueAtPath,
  writeReportLedger
};
