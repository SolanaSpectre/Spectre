#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-shortlist-shadow');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-shortlist-shadow-latest.json');

const EXIT = {
  takeProfitPct: 0.5,
  stopLossPct: 0.25,
  maxHoldSeconds: 600,
  amountSol: 0.1,
  stressExtraSlippagePct: 3
};

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

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function eventType(event = {}) {
  return event.type || event.event || event.name || 'unknown';
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function priceOf(payload = {}) {
  const direct = Number(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = Number(payload.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
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

function scan(filePath) {
  const shadows = [];
  const samplesByMint = new Map();
  const stats = forEachJsonlSync(filePath, (event) => {
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    if (!mint) return;
    const at = payload.timestamp || event.timestamp || null;
    const atMs = timestampMs(at);
    if (!Number.isFinite(atMs)) return;
    const priceSol = priceOf(payload);
    if (Number.isFinite(priceSol) && priceSol > 0) {
      if (!samplesByMint.has(mint)) samplesByMint.set(mint, []);
      samplesByMint.get(mint).push({
        at,
        atMs,
        priceSol,
        curveProgress: compact(payload.curveProgress, 6),
        score: compact(payload.score, 2),
        recentVolumeSol: compact(payload.recentVolumeSol, 4),
        tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2)
      });
    }
    if (!eventType(event).startsWith('pre_migration_launch_intel_shortlist_shadow.')) return;
    shadows.push({
      at,
      atMs,
      mint,
      symbol: payload.symbol || null,
      outcome: eventType(event).endsWith('.would_enter') ? 'would_enter' : 'would_skip',
      reason: payload.reason || null,
      failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : [],
      triggerWallet: payload.launchIntelShortlistFirstTouch?.wallet || null,
      secondsTouchToDecision: payload.secondsTouchToDecision ?? null,
      score: compact(payload.score, 2),
      curveProgress: compact(payload.curveProgress, 6),
      recentVolumeSol: compact(payload.recentVolumeSol, 4),
      tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
      priceSol: compact(payload.priceSol, 15),
      launchIntelWallet: payload.launchIntelWallet || payload.launchIntelShortlistFirstTouch?.launchIntelWallet || null
    });
  });
  for (const rows of samplesByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  shadows.sort((a, b) => a.atMs - b.atMs);
  return { stats, shadows, samplesByMint };
}

function buildExit(entry, exit, exitReason) {
  const returnPct = (exit.priceSol - entry.priceSol) / entry.priceSol;
  const stressReturnPct = returnPct - (EXIT.stressExtraSlippagePct / 100);
  return {
    exitReason,
    exitAt: exit.at,
    exitPriceSol: compact(exit.priceSol, 12),
    holdSeconds: compact((exit.atMs - entry.atMs) / 1000, 3),
    returnPct: compact(returnPct, 6),
    pnlSol: compact(EXIT.amountSol * returnPct, 9),
    stressedPnlSol: compact(EXIT.amountSol * stressReturnPct, 9)
  };
}

function replay(row, samplesByMint) {
  if (row.outcome !== 'would_enter') return row;
  const samples = (samplesByMint.get(row.mint) || []).filter((item) => item.atMs >= row.atMs);
  const entry = samples[0] || (Number(row.priceSol) > 0 ? row : null);
  if (!entry || !Number(entry.priceSol)) {
    return { ...row, replayClass: 'MISSING_ENTRY_PRICE' };
  }
  let latest = entry;
  for (const sample of samples) {
    latest = sample;
    const returnPct = (sample.priceSol - entry.priceSol) / entry.priceSol;
    if (returnPct >= EXIT.takeProfitPct) return { ...row, replayClass: 'REPLAYED', entryAt: entry.at, entryPriceSol: compact(entry.priceSol, 12), ...buildExit(entry, sample, 'TAKE_PROFIT') };
    if (returnPct <= -EXIT.stopLossPct) return { ...row, replayClass: 'REPLAYED', entryAt: entry.at, entryPriceSol: compact(entry.priceSol, 12), ...buildExit(entry, sample, 'STOP_LOSS') };
    if (sample.atMs - entry.atMs >= EXIT.maxHoldSeconds * 1000) return { ...row, replayClass: 'REPLAYED', entryAt: entry.at, entryPriceSol: compact(entry.priceSol, 12), ...buildExit(entry, sample, 'MAX_HOLD') };
  }
  return { ...row, replayClass: 'REPLAYED', entryAt: entry.at, entryPriceSol: compact(entry.priceSol, 12), ...buildExit(entry, latest, 'END_OF_RUN') };
}

function summarize(rows, stats) {
  const wouldEnter = rows.filter((row) => row.outcome === 'would_enter');
  const replayed = rows.filter((row) => row.replayClass === 'REPLAYED');
  const wins = replayed.filter((row) => Number(row.pnlSol) > 0);
  const totalPnlSol = replayed.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const stressedPnlSol = replayed.reduce((sum, row) => sum + Number(row.stressedPnlSol || 0), 0);
  return {
    telemetryRowsRead: stats.rows,
    malformedLines: stats.malformedLines,
    shadowRows: rows.length,
    wouldEnter: wouldEnter.length,
    wouldSkip: rows.length - wouldEnter.length,
    replayed: replayed.length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    uniqueEntryMints: new Set(wouldEnter.map((row) => row.mint)).size,
    wins: wins.length,
    losses: replayed.filter((row) => Number(row.pnlSol) < 0).length,
    winRate: replayed.length ? compact(wins.length / replayed.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    stressedPnlSol: compact(stressedPnlSol, 9),
    reasonCounts: rows.reduce((acc, row) => {
      const key = row.reason || (row.outcome === 'would_enter' ? 'WOULD_ENTER' : 'UNKNOWN');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    exitReasonCounts: replayed.reduce((acc, row) => {
      const key = row.exitReason || 'UNKNOWN';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = args.telemetry ? (path.isAbsolute(args.telemetry) ? args.telemetry : path.join(ROOT, args.telemetry)) : latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found for launch-intel shortlist shadow report');
  const scanned = scan(telemetryPath);
  const rows = scanned.shadows.map((row) => replay(row, scanned.samplesByMint));
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    mode: 'report_only_runtime_launch_intel_shortlist_shadow',
    sources: { telemetryPath },
    assumptions: EXIT,
    note: 'Summarizes runtime launch-intel shortlist shadow telemetry. Report-only; shadow events do not mutate wallet trust, paper entries, or live behavior.',
    summary: summarize(rows, scanned.stats),
    topWinners: rows.filter((row) => row.replayClass === 'REPLAYED').slice().sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol)).slice(0, 12),
    topLosers: rows.filter((row) => row.replayClass === 'REPLAYED').slice().sort((a, b) => Number(a.pnlSol) - Number(b.pnlSol)).slice(0, 12),
    rows
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `wallet-launch-intel-shortlist-shadow-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote launch-intel shortlist shadow report: ${reportPath}`);
  console.log(`Wrote latest launch-intel shortlist shadow report: ${LATEST_PATH}`);
  console.log(`shadowRows=${payload.summary.shadowRows} wouldEnter=${payload.summary.wouldEnter} replayed=${payload.summary.replayed} pnl=${payload.summary.totalPnlSol}`);
}

main();
