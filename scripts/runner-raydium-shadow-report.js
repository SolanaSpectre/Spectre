#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'data', 'reports', 'runner-raydium-shadow-latest.json');

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

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function listTelemetryFiles(logDir = DEFAULT_LOG_DIR) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return { name, fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

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

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function compact(value, digits = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function percentile(values, p) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return compact(sorted[index], 4);
}

function summarizePayload(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp || null,
    mint: payload.token || payload.mint || null,
    symbol: payload.symbol || null,
    name: payload.name || null,
    source: payload.source || 'unknown',
    poolAddress: payload.poolAddress || null,
    poolType: payload.poolType || null,
    blocked: payload.blocked !== false,
    reason: payload.reason || null,
    qualityScore: compact(payload.qualityScore, 4),
    momentumScore: compact(payload.momentumScore, 4),
    rankScore: compact(payload.rankScore, 4),
    riskScore: compact(payload.riskScore, 4),
    liquidityUsd: compact(payload.liquidityUsd, 2),
    volume24h: compact(payload.volume24h, 2),
    price: compact(payload.price, 12),
    feeRate: compact(payload.feeRate, 6),
    poolAgeHours: compact(payload.poolAgeHours, 2),
    poolCount: payload.poolCount ?? null,
    wouldPassQualityRisk: Boolean(payload.wouldPassQualityRisk),
    continuation: payload.continuation || null
  };
}

function latestByMint(rows) {
  const byMint = new Map();
  for (const row of rows) {
    if (!row.mint) continue;
    const current = byMint.get(row.mint);
    if (!current || new Date(row.timestamp || 0) >= new Date(current.timestamp || 0)) {
      byMint.set(row.mint, row);
    }
  }
  return Array.from(byMint.values());
}

function buildReport(events, telemetryPath) {
  const rows = events
    .filter((event) => eventType(event) === 'runner.raydium_shadow.observed')
    .map(summarizePayload);
  const uniqueRows = latestByMint(rows);
  const topByRank = uniqueRows
    .slice()
    .sort((a, b) => Number(b.rankScore || 0) - Number(a.rankScore || 0))
    .slice(0, 10);
  const topByLiquidity = uniqueRows
    .slice()
    .sort((a, b) => Number(b.liquidityUsd || 0) - Number(a.liquidityUsd || 0))
    .slice(0, 10);
  const continuationRows = uniqueRows.filter((row) => row.continuation);

  const rankScores = uniqueRows.map((row) => row.rankScore);
  const qualityScores = uniqueRows.map((row) => row.qualityScore);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath,
    summary: {
      observations: rows.length,
      uniqueMints: uniqueRows.length,
      blockedCount: rows.filter((row) => row.blocked).length,
      wouldPassQualityRiskCount: uniqueRows.filter((row) => row.wouldPassQualityRisk).length,
      continuationOverlapCount: continuationRows.length,
      sourceCounts: countBy(rows, (row) => row.source),
      reasonCounts: countBy(rows, (row) => row.reason),
      continuationVerdicts: countBy(continuationRows, (row) => row.continuation?.verdict || 'unknown'),
      qualityScoreQuantiles: {
        p50: percentile(qualityScores, 50),
        p90: percentile(qualityScores, 90),
        max: percentile(qualityScores, 100)
      },
      rankScoreQuantiles: {
        p50: percentile(rankScores, 50),
        p90: percentile(rankScores, 90),
        max: percentile(rankScores, 100)
      }
    },
    topByRank,
    topByLiquidity,
    continuationOverlap: continuationRows.slice(0, 10),
    note: 'Report-only shadow diagnostic. These rows were blocked by paper runner mode and did not generate signals, quotes, AI reviews, or entries.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || listTelemetryFiles()[0]?.fullPath || null;
  const outputPath = args.output ? repoPath(args.output) : DEFAULT_OUTPUT;

  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for Raydium runner shadow report.');
  }

  const report = buildReport(readJsonl(telemetryPath), telemetryPath);
  writeJson(outputPath, report);

  console.log('Runner Raydium Shadow Report');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Observations: ${report.summary.observations}`);
  console.log(`Unique mints: ${report.summary.uniqueMints}`);
  console.log(`Would pass quality/risk counter: ${report.summary.wouldPassQualityRiskCount}`);
  console.log(`Continuation overlap: ${report.summary.continuationOverlapCount}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main();
