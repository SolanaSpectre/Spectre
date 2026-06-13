#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-confirmation-shadow-latest.json');
const EVENT_TYPES = new Set([
  'pre_migration_curve_confirmation_shadow.would_enter',
  'pre_migration_curve_confirmation_shadow.would_skip'
]);

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

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: num(pick(0.5), digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    avg: num(sum / finite.length, digits)
  };
}

function shadowFromEvent(event) {
  const type = eventType(event);
  if (!EVENT_TYPES.has(type)) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const sourceAtMs = timestampMs(payload.sourceAt);
  if (!mint || !Number.isFinite(atMs)) return null;
  const wouldEnter = type.endsWith('.would_enter') || payload.wouldEnter === true;
  return {
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    sourceAtMs,
    sourceAt: sourceAtMs ? new Date(sourceAtMs).toISOString() : null,
    eventType: type,
    shadowProfile: payload.shadowProfile || null,
    wouldEnter,
    shadowReason: payload.shadowReason || null,
    sourceReason: payload.sourceReason || null,
    sourcePreset: payload.sourcePreset || null,
    sourceLane: payload.sourceLane || null,
    score: num(payload.score, 2),
    curveProgress: num(payload.curveProgress, 6),
    minCurveDelta: num(payload.minCurveDelta, 6),
    minSourceCurveProgress: num(payload.minSourceCurveProgress, 6),
    maxSourceCurveProgress: num(payload.maxSourceCurveProgress, 6),
    minConfirmCurveProgress: num(payload.minConfirmCurveProgress, 6),
    minRecentVolumeSol: num(payload.minRecentVolumeSol, 4),
    minTradeVelocityPerMin: num(payload.minTradeVelocityPerMin, 2),
    lookaheadMs: num(payload.lookaheadMs, 0),
    confirmCurveProgress: num(payload.confirmCurveProgress, 6),
    curveProgressDeltaFromSource: num(payload.curveProgressDeltaFromSource, 6),
    secondsToConfirm: num(payload.secondsToConfirm, 3),
    recentVolumeSol: num(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: num(payload.tradeVelocityPerMin, 2),
    buyRatio: num(payload.buyRatio, 4),
    uniqueBuyerCount: num(payload.uniqueBuyerCount, 0),
    priceSol: num(payload.priceSol, 12),
    confirmPriceSol: num(payload.confirmPriceSol, 12),
    walletTouchCount: num(payload.walletTouchCount, 0),
    shadowWalletTouchCount: num(payload.shadowWalletTouchCount, 0),
    positiveWalletTouchCount: num(payload.positiveWalletTouchCount, 0),
    avoidWalletTouchCount: num(payload.avoidWalletTouchCount, 0),
    riskWalletCount: num(payload.riskWalletCount, 0),
    sniperWalletCount: num(payload.sniperWalletCount, 0),
    maxSniperWallets: num(payload.maxSniperWallets, 0),
    noAvoidWalletTouch: payload.noAvoidWalletTouch === true,
    requireNoAvoidWallet: payload.requireNoAvoidWallet === true,
    requireNoRiskWallet: payload.requireNoRiskWallet === true,
    confirmationTelemetryType: payload.confirmationTelemetryType || null
  };
}

async function readTelemetry(filePath) {
  const shadows = [];
  let malformedLines = 0;

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
    const shadow = shadowFromEvent(event);
    if (shadow) shadows.push(shadow);
  }

  shadows.sort((a, b) => a.atMs - b.atMs);
  return { shadows, malformedLines };
}

function summarizeGroup(name, rows) {
  const entered = rows.filter((row) => row.wouldEnter);
  const skipped = rows.filter((row) => !row.wouldEnter);
  return {
    name,
    rows: rows.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    wouldEnter: entered.length,
    wouldSkip: skipped.length,
    entryRate: rows.length ? num(entered.length / rows.length, 4) : null,
    confirmedDelta: stat(entered.map((row) => row.curveProgressDeltaFromSource), 6),
    secondsToConfirm: stat(entered.map((row) => row.secondsToConfirm), 3),
    score: stat(rows.map((row) => row.score), 2),
    sourceCurveProgress: stat(rows.map((row) => row.curveProgress), 6),
    byReason: countBy(rows, (row) => row.shadowReason),
    topConfirmed: entered.slice()
      .sort((a, b) => Number(b.curveProgressDeltaFromSource ?? -Infinity) - Number(a.curveProgressDeltaFromSource ?? -Infinity))
      .slice(0, 8)
  };
}

function buildReport(filePath, telemetry) {
  const rows = telemetry.shadows;
  const entered = rows.filter((row) => row.wouldEnter);
  const skipped = rows.filter((row) => !row.wouldEnter);
  const noAvoidRows = rows.filter((row) => row.noAvoidWalletTouch);
  const avoidRows = rows.filter((row) => !row.noAvoidWalletTouch);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath: path.relative(ROOT, filePath),
    summary: {
      shadowRows: rows.length,
      wouldEnter: entered.length,
      wouldSkip: skipped.length,
      uniqueWouldEnterMints: new Set(entered.map((row) => row.mint)).size,
      uniqueWouldSkipMints: new Set(skipped.map((row) => row.mint)).size,
      entryRate: rows.length ? num(entered.length / rows.length, 4) : null,
      shadowProfileCounts: countBy(rows, (row) => row.shadowProfile),
      shadowReasonCounts: countBy(rows, (row) => row.shadowReason),
      confirmationTelemetryTypeCounts: countBy(entered, (row) => row.confirmationTelemetryType),
      all: summarizeGroup('all', rows),
      noAvoidWalletTouch: summarizeGroup('no_avoid_wallet_touch', noAvoidRows),
      avoidWalletTouch: summarizeGroup('avoid_wallet_touch', avoidRows)
    },
    confirmedRows: entered.slice()
      .sort((a, b) => Number(a.secondsToConfirm ?? Infinity) - Number(b.secondsToConfirm ?? Infinity))
      .slice(0, 50),
    sourceCoverage: {
      malformedLines: telemetry.malformedLines
    },
    note: 'Prospective report-only shadow lane for strict delayed curve confirmation after CURVE_NOT_ADVANCING skips. It logs would_enter only when runtime sees the configured later curve delta inside the lookahead window. It does not change gates, entries, exits, AI review, quotes, broadcast, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found.');
  const telemetry = await readTelemetry(telemetryPath);
  const report = buildReport(telemetryPath, telemetry);
  writeJson(outputPath, report);
  console.log('Pre-Migration Curve Confirmation Shadow Report');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Rows / would_enter / would_skip: ${report.summary.shadowRows} / ${report.summary.wouldEnter} / ${report.summary.wouldSkip}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  OUTPUT_PATH
};
