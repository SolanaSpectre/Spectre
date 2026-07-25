#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveTelemetryPath, telemetryFromReport } = require('./lib/report-telemetry');
const {
  classifySimulationPayload,
  normalizeDryRunReason
} = require('../src/lib/simulation-error-classifier');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-dry-run-outcome-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];

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
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function telemetryFromBattlefield() {
  return telemetryFromReport(ROOT, BATTLEFIELD_PATH);
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.accountCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload) {
  const raw = payload.quote?.spotPriceSol
    ?? payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: event.type || event.event || 'unknown',
    source: payload.source || payload.provider || event.type || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

function dryRunAttemptFromEvent(event) {
  const eventType = event.type || event.event;
  if (!['live_dry_run.would_send', 'live_dry_run.would_block'].includes(eventType)) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const simulationFailure = payload.simulationOk === false
    ? classifySimulationPayload(payload)
    : null;
  return {
    eventType,
    wouldSend: eventType === 'live_dry_run.would_send',
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    sourceDecision: payload.sourceDecision || null,
    sourceReason: payload.sourceReason || normalizeDryRunReason(payload),
    preset: payload.preset || null,
    lane: payload.lane || null,
    accountAgeMs: numberOrNull(payload.accountAgeMs, 0),
    accountCurveProgress: numberOrNull(payload.accountCurveProgress, 6),
    paperCurveProgress: numberOrNull(payload.paperCurveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    amountSol: numberOrNull(payload.amountSol, 4),
    priceImpactPct: numberOrNull(payload.quote?.priceImpactPct ?? payload.priceImpactPct, 4),
    simulationOk: payload.simulationOk === true,
    simulationError: simulationFailure || payload.simulationError || null,
    txBuildStatus: payload.txBuildStatus || null,
    wouldBlockReason: eventType === 'live_dry_run.would_block' ? normalizeDryRunReason(payload) : null
  };
}

function futureForWindow(attempt, snapshots, seconds) {
  const endMs = attempt.atMs + seconds * 1000;
  const rows = snapshots.filter((snapshot) => snapshot.atMs > attempt.atMs && snapshot.atMs <= endMs);
  if (!rows.length) {
    return {
      snapshotCount: 0,
      maxCurveProgress: null,
      maxCurveAt: null,
      curveDelta: null,
      crossed85: false,
      crossed90: false,
      crossed95: false,
      crossed100: false,
      maxPriceDeltaPct: null
    };
  }
  const baseCurve = Number(attempt.accountCurveProgress ?? attempt.paperCurveProgress);
  const basePrice = Number(attempt.priceSol);
  let maxCurveRow = null;
  let maxPriceDeltaPct = null;
  for (const row of rows) {
    if (!maxCurveRow || Number(row.curveProgress) > Number(maxCurveRow.curveProgress)) maxCurveRow = row;
    if (Number.isFinite(basePrice) && basePrice > 0 && Number.isFinite(Number(row.priceSol))) {
      const deltaPct = ((Number(row.priceSol) - basePrice) / basePrice) * 100;
      if (maxPriceDeltaPct === null || deltaPct > maxPriceDeltaPct) maxPriceDeltaPct = deltaPct;
    }
  }
  const maxCurve = Number(maxCurveRow?.curveProgress);
  return {
    snapshotCount: rows.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    maxCurveAt: maxCurveRow?.at || null,
    curveDelta: Number.isFinite(baseCurve) ? numberOrNull(maxCurve - baseCurve, 6) : null,
    crossed85: maxCurve >= 0.85,
    crossed90: maxCurve >= 0.9,
    crossed95: maxCurve >= 0.95,
    crossed100: maxCurve >= 1,
    maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 4)
  };
}

function addOutcomes(attempt, snapshotsByMint) {
  const snapshots = snapshotsByMint.get(attempt.mint) || [];
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = futureForWindow(attempt, snapshots, seconds);
  }
  return {
    ...attempt,
    windows
  };
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const attempts = [];
  const eventCounts = {};
  let malformedLines = 0;
  let startMs = Infinity;
  let endMs = -Infinity;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    const eventType = event.type || event.event || 'unknown';
    eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
    const atMs = timestampMs(payloadOf(event).timestamp || event.timestamp);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }

    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }

    const attempt = dryRunAttemptFromEvent(event);
    if (attempt) attempts.push(attempt);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  attempts.sort((a, b) => a.atMs - b.atMs);

  return {
    snapshotsByMint,
    attempts,
    eventCounts,
    malformedLines,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null
  };
}

function summarize(outcomes) {
  const wouldSendRows = outcomes.filter((row) => row.wouldSend);
  const uniqueFirstByMint = new Map();
  for (const row of wouldSendRows) {
    if (!uniqueFirstByMint.has(row.mint)) uniqueFirstByMint.set(row.mint, row);
  }
  const uniqueRows = Array.from(uniqueFirstByMint.values());
  const windowSummary = {};
  for (const seconds of WINDOWS_SECONDS) {
    const key = `${seconds}s`;
    windowSummary[key] = {
      attemptsWithFuture: wouldSendRows.filter((row) => (row.windows[key]?.snapshotCount || 0) > 0).length,
      crossed85: wouldSendRows.filter((row) => row.windows[key]?.crossed85).length,
      crossed90: wouldSendRows.filter((row) => row.windows[key]?.crossed90).length,
      crossed95: wouldSendRows.filter((row) => row.windows[key]?.crossed95).length,
      uniqueCrossed85: uniqueRows.filter((row) => row.windows[key]?.crossed85).length,
      uniqueCrossed90: uniqueRows.filter((row) => row.windows[key]?.crossed90).length,
      curveDelta: stat(wouldSendRows.map((row) => row.windows[key]?.curveDelta), 6),
      maxPriceDeltaPct: stat(wouldSendRows.map((row) => row.windows[key]?.maxPriceDeltaPct), 4)
    };
  }

  const reasonSummaries = Object.entries(countBy(wouldSendRows, (row) => row.sourceReason)).map(([reason, count]) => {
    const rows = wouldSendRows.filter((row) => (row.sourceReason || 'unknown') === reason);
    const unique = new Set(rows.map((row) => row.mint)).size;
    return {
      reason,
      attempts: count,
      uniqueMints: unique,
      crossed85Within120s: rows.filter((row) => row.windows['120s']?.crossed85).length,
      crossed90Within120s: rows.filter((row) => row.windows['120s']?.crossed90).length,
      uniqueCross90Within120s: new Set(rows.filter((row) => row.windows['120s']?.crossed90).map((row) => row.mint)).size,
      curveDelta120s: stat(rows.map((row) => row.windows['120s']?.curveDelta), 6),
      maxPriceDeltaPct120s: stat(rows.map((row) => row.windows['120s']?.maxPriceDeltaPct), 4)
    };
  });

  return {
    attempts: outcomes.length,
    wouldSend: wouldSendRows.length,
    wouldBlock: outcomes.filter((row) => !row.wouldSend).length,
    simulationOk: wouldSendRows.filter((row) => row.simulationOk).length,
    simulationErrors: wouldSendRows.filter((row) => row.simulationError).length,
    uniqueWouldSendMints: uniqueRows.length,
    sourceReasonCounts: countBy(wouldSendRows, (row) => row.sourceReason),
    presetCounts: countBy(wouldSendRows, (row) => row.preset),
    windowSummary,
    reasonSummaries
  };
}

function topRows(outcomes, limit = 12) {
  return outcomes
    .filter((row) => row.wouldSend)
    .slice()
    .sort((a, b) => {
      const bCross = b.windows['120s']?.crossed90 ? 1 : 0;
      const aCross = a.windows['120s']?.crossed90 ? 1 : 0;
      if (bCross !== aCross) return bCross - aCross;
      return Number(b.windows['120s']?.curveDelta || 0) - Number(a.windows['120s']?.curveDelta || 0);
    })
    .slice(0, limit)
    .map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      at: row.at,
      sourceReason: row.sourceReason,
      preset: row.preset,
      accountCurveProgress: row.accountCurveProgress,
      paperCurveProgress: row.paperCurveProgress,
      accountAgeMs: row.accountAgeMs,
      priceImpactPct: row.priceImpactPct,
      simulationOk: row.simulationOk,
      max30: row.windows['30s']?.maxCurveProgress,
      max120: row.windows['120s']?.maxCurveProgress,
      max300: row.windows['300s']?.maxCurveProgress,
      curveDelta120s: row.windows['120s']?.curveDelta,
      priceDelta120sPct: row.windows['120s']?.maxPriceDeltaPct,
      crossed90Within120s: row.windows['120s']?.crossed90
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveTelemetryPath(ROOT, {
    telemetry: args.telemetry,
    reportTelemetry: telemetryFromBattlefield()
  }) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  }
  const outputPath = args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH;
  const telemetry = await readTelemetry(telemetryPath);
  const outcomes = telemetry.attempts.map((attempt) => addOutcomes(attempt, telemetry.snapshotsByMint));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      telemetryPath: path.relative(ROOT, telemetryPath).replace(/\\/g, '/')
    },
    inputs: {
      startAt: telemetry.startAt,
      endAt: telemetry.endAt,
      malformedLines: telemetry.malformedLines,
      dryRunAttemptEvents: telemetry.attempts.length,
      snapshotMints: telemetry.snapshotsByMint.size
    },
    summary: summarize(outcomes),
    topWouldSendFollowThrough: topRows(outcomes),
    rows: outcomes
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`Dry-run would_send follow-through: ${report.summary.wouldSend} attempts, ${report.summary.uniqueWouldSendMints} unique mints`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  addOutcomes,
  countBy,
  latestTelemetryFile,
  numberOrNull,
  parseArgs,
  priceOf,
  readTelemetry,
  repoPath,
  stat,
  telemetryFromBattlefield,
  timestampMs
};
