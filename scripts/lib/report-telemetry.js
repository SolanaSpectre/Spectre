'use strict';

const fs = require('fs');
const path = require('path');

function repoPath(root, filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
}

function latestTelemetryFile(root) {
  const logDir = path.join(root, 'run-logs');
  if (!fs.existsSync(logDir)) return null;
  return fs.readdirSync(logDir)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(logDir, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function telemetryFromReport(root, reportPath) {
  const report = readJson(reportPath, {});
  return repoPath(root, report.files?.telemetryPath || report.telemetryPath || report.sources?.telemetryPath);
}

function isInsideRoot(root, filePath) {
  if (!filePath) return false;
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveTelemetryPath(root, options = {}) {
  const explicit = repoPath(root, options.telemetry);
  if (explicit) return explicit;

  const latest = latestTelemetryFile(root);
  const reportTelemetry = repoPath(root, options.reportTelemetry);
  if (!reportTelemetry) return latest;
  if (!fs.existsSync(reportTelemetry)) return latest;
  if (!isInsideRoot(root, reportTelemetry)) return latest;
  if (!latest || path.resolve(reportTelemetry) === path.resolve(latest)) return reportTelemetry;

  const reportStat = fs.statSync(reportTelemetry);
  const latestStat = fs.statSync(latest);
  return reportStat.mtimeMs >= latestStat.mtimeMs ? reportTelemetry : latest;
}

module.exports = {
  isInsideRoot,
  latestTelemetryFile,
  readJson,
  repoPath,
  resolveTelemetryPath,
  telemetryFromReport
};
