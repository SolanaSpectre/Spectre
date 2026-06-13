#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { readJsonl } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const SHADOW_PATH = path.join(ROOT, 'data', 'reports', 'runner-raydium-shadow-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-raydium-shadow-fixed-horizon-latest.json');
const HORIZONS_MINUTES = [5, 15, 30];

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesBetween(start, end) {
  const left = timestampMs(start);
  const right = timestampMs(end);
  return Number.isFinite(left) && Number.isFinite(right)
    ? compact((right - left) / 60000, 4)
    : null;
}

function returnPct(entryPrice, exitPrice) {
  return num(entryPrice, 0) > 0 && num(exitPrice, 0) > 0
    ? compact((num(exitPrice, 0) - num(entryPrice, 0)) / num(entryPrice, 0), 6)
    : null;
}

function summarizePayload(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp || null,
    mint: payload.token || payload.mint || null,
    symbol: payload.symbol || null,
    price: compact(payload.price, 12),
    ageBucket: payload.poolAgeKnown === true && Number(payload.poolAgeHours) < 24
      ? 'fresh_pool'
      : Number(payload.poolAgeHours) >= 24
        ? 'mature_or_established'
        : 'age_unknown',
    continuationVerdict: payload.continuation?.verdict || null
  };
}

function groupByMint(rows) {
  const byMint = new Map();
  for (const row of rows) {
    if (!row.mint || !(num(row.price, 0) > 0)) continue;
    const members = byMint.get(row.mint) || [];
    members.push(row);
    byMint.set(row.mint, members);
  }
  for (const members of byMint.values()) {
    members.sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
  }
  return byMint;
}

function horizonSample(rows, horizonMinutes) {
  const first = rows[0];
  const firstMs = timestampMs(first?.timestamp);
  if (!Number.isFinite(firstMs)) return null;
  const targetMs = firstMs + horizonMinutes * 60000;
  return rows.find((row) => timestampMs(row.timestamp) >= targetMs) || null;
}

function buildRows(rows) {
  return Array.from(groupByMint(rows).values()).map((members) => {
    const first = members[0];
    const last = members[members.length - 1];
    const horizons = {};
    for (const horizonMinutes of HORIZONS_MINUTES) {
      const sample = horizonSample(members, horizonMinutes);
      horizons[`t${horizonMinutes}m`] = sample
        ? {
          observedAt: sample.timestamp,
          observedOffsetMinutes: minutesBetween(first.timestamp, sample.timestamp),
          sampleLagMinutes: compact(minutesBetween(first.timestamp, sample.timestamp) - horizonMinutes, 4),
          price: sample.price,
          returnPct: returnPct(first.price, sample.price)
        }
        : null;
    }
    return {
      mint: first.mint,
      symbol: first.symbol || null,
      firstObservedAt: first.timestamp,
      lastObservedAt: last.timestamp,
      observationCount: members.length,
      observedMinutes: minutesBetween(first.timestamp, last.timestamp),
      ageBucket: last.ageBucket,
      continuationVerdict: last.continuationVerdict,
      entryPrice: first.price,
      horizons
    };
  });
}

function summarizeHorizon(rows, key) {
  const coveredRows = rows.filter((row) => row.horizons[key]);
  const returns = coveredRows.map((row) => num(row.horizons[key].returnPct, null)).filter(Number.isFinite);
  const sampleLags = coveredRows.map((row) => num(row.horizons[key].sampleLagMinutes, null)).filter(Number.isFinite);
  const median = (values) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? compact((sorted[mid - 1] + sorted[mid]) / 2, 6)
      : compact(sorted[mid], 6);
  };
  return {
    coveredMints: coveredRows.length,
    coverageRate: rows.length ? compact(coveredRows.length / rows.length, 4) : null,
    positiveReturnCount: returns.filter((value) => value > 0).length,
    negativeReturnCount: returns.filter((value) => value < 0).length,
    averageReturnPct: returns.length ? compact(returns.reduce((sum, value) => sum + value, 0) / returns.length, 6) : null,
    medianReturnPct: median(returns),
    maxReturnPct: returns.length ? compact(Math.max(...returns), 6) : null,
    minReturnPct: returns.length ? compact(Math.min(...returns), 6) : null,
    medianSampleLagMinutes: median(sampleLags)
  };
}

function buildReport() {
  const shadow = readJson(SHADOW_PATH);
  const telemetryPath = shadow.telemetryPath || null;
  const rows = readJsonl(telemetryPath)
    .filter((event) => eventType(event) === 'runner.raydium_shadow.observed')
    .map(summarizePayload);
  const horizonRows = buildRows(rows);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      shadowPath: rel(SHADOW_PATH),
      telemetryPath,
      horizonsMinutes: HORIZONS_MINUTES,
      observations: rows.length,
      uniqueMints: horizonRows.length
    },
    summary: {
      uniqueMints: horizonRows.length,
      horizonSummaries: Object.fromEntries(HORIZONS_MINUTES.map((minutes) => {
        const key = `t${minutes}m`;
        return [key, summarizeHorizon(horizonRows, key)];
      }))
    },
    rows: horizonRows,
    note: 'Report-only fixed-horizon view over repeated in-run Raydium shadow observations. Horizon samples use the first observed sample at or after each target time, so sampleLagMinutes must be read with the returns. Missing horizons are left null rather than extrapolated.'
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
  buildRows,
  summarizeHorizon
};
