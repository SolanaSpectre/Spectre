#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { isInsideRoot, latestTelemetryFile, readJson } = require('./lib/report-telemetry');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'data', 'reports');
const OUTPUT_PATH = path.join(REPORT_DIR, 'report-telemetry-path-audit-latest.json');

function rel(filePath) {
  return filePath ? path.relative(ROOT, filePath).replace(/\\/g, '/') : null;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function walkPaths(value, trail = [], found = []) {
  if (typeof value === 'string') {
    if (/telemetry-.*\.jsonl/i.test(value) || /^[a-z]:[\\/]/i.test(value)) {
      found.push({ jsonPath: trail.join('.'), value });
    }
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkPaths(item, [...trail, String(index)], found));
    return found;
  }
  Object.entries(value).forEach(([key, item]) => walkPaths(item, [...trail, key], found));
  return found;
}

function resolveMaybePath(value) {
  if (!value || typeof value !== 'string') return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
}

function generatedAgeHours(generatedAt) {
  const ms = new Date(generatedAt || 0).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Number(((Date.now() - ms) / 36e5).toFixed(2));
}

function auditReport(filePath, newestTelemetry) {
  const report = readJson(filePath, null);
  if (!report) {
    return {
      reportPath: rel(filePath),
      readable: false,
      issues: ['UNREADABLE_JSON']
    };
  }

  const telemetryRefs = walkPaths(report)
    .filter((item) => /telemetry-.*\.jsonl/i.test(item.value));
  const externalRefs = telemetryRefs.filter((item) => {
    const resolved = resolveMaybePath(item.value);
    return resolved && !isInsideRoot(ROOT, resolved);
  });
  const newestBase = newestTelemetry ? path.basename(newestTelemetry) : null;
  const nonNewestRefs = telemetryRefs.filter((item) => newestBase && path.basename(item.value) !== newestBase);
  const ageHours = generatedAgeHours(report.generatedAt);
  const issues = [];
  if (externalRefs.length) issues.push('EXTERNAL_TELEMETRY_PATH');
  if (nonNewestRefs.length) issues.push('NON_NEWEST_TELEMETRY');
  if (ageHours !== null && ageHours > 24) issues.push('STALE_GENERATED_AT_OVER_24H');
  return {
    reportPath: rel(filePath),
    readable: true,
    generatedAt: report.generatedAt || null,
    generatedAgeHours: ageHours,
    telemetryRefs,
    externalRefs,
    nonNewestRefs,
    issues
  };
}

function buildReport(options = {}) {
  const newestTelemetry = latestTelemetryFile(ROOT);
  const reportFiles = fs.existsSync(REPORT_DIR)
    ? fs.readdirSync(REPORT_DIR)
      .filter((name) => /latest\.json$/i.test(name))
      .filter((name) => name !== path.basename(OUTPUT_PATH))
      .map((name) => path.join(REPORT_DIR, name))
    : [];
  const rows = reportFiles
    .map((filePath) => auditReport(filePath, newestTelemetry))
    .sort((a, b) => b.issues.length - a.issues.length || String(a.reportPath).localeCompare(String(b.reportPath)));
  const issueCounts = {};
  for (const row of rows) {
    for (const issue of row.issues) {
      issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    }
  }
  const maxRows = Number(options.maxRows || 200);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_telemetry_path_audit',
    newestTelemetryPath: rel(newestTelemetry),
    summary: {
      reportsScanned: rows.length,
      reportsWithIssues: rows.filter((row) => row.issues.length).length,
      issueCounts
    },
    issueRows: rows.filter((row) => row.issues.length).slice(0, maxRows),
    note: 'Scans latest JSON reports for stale or external telemetry references. Does not change strategy, gates, entries, exits, AI review, quotes, broadcasts, or live behavior.'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output ? (path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output)) : OUTPUT_PATH;
  const report = buildReport(args);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('Report Telemetry Path Audit');
  console.log(`Newest telemetry: ${report.newestTelemetryPath || 'n/a'}`);
  console.log(`Reports/issues: ${report.summary.reportsScanned}/${report.summary.reportsWithIssues}`);
  console.log(`Issue counts: ${JSON.stringify(report.summary.issueCounts)}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

module.exports = { buildReport };

if (require.main === module) {
  main();
}
