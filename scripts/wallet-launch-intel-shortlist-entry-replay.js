#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const STABILITY_PATH = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-stability-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-shortlist-entry-replay');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-shortlist-entry-replay-latest.json');

const STRATEGY = {
  minScore: 75,
  minCurveProgress: 0.7,
  minRecentVolumeSol: 25,
  minTradeVelocityPerMin: 25,
  touchLookbackSeconds: 120,
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

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
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

function secondsBetween(start, end) {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? compact((endMs - startMs) / 1000, 3) : null;
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

function walletOf(payload = {}) {
  return payload.wallet || payload.walletAddress || payload.traderPublicKey || payload.account || payload.address || null;
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.progress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function priceOf(payload = {}) {
  const direct = Number(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = Number(payload.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
}

function latestTelemetryFiles(limit = 6) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function resolveTelemetryFiles(args, stability) {
  if (args.telemetryFiles) {
    return String(args.telemetryFiles).split(',').map((item) => {
      const trimmed = item.trim();
      return path.isAbsolute(trimmed) ? trimmed : path.join(ROOT, trimmed);
    }).filter(Boolean);
  }
  const fromStability = Array.isArray(stability?.sources?.telemetryFiles)
    ? stability.sources.telemetryFiles.map((item) => (path.isAbsolute(item) ? item : path.join(ROOT, item)))
    : [];
  return fromStability.length ? fromStability : latestTelemetryFiles(Number(args.maxFiles || 6));
}

function shortlistIndex(stability) {
  const byWallet = new Map();
  for (const row of stability?.repeatShortlistCandidates || []) {
    if (!row?.wallet) continue;
    byWallet.set(row.wallet, {
      wallet: row.wallet,
      score: compact(row.score, 2),
      runCount: row.runCount ?? null,
      decisionRunCount: row.decisionRunCount ?? null,
      noTrackedFirstTouchLinks: row.noTrackedFirstTouchLinks ?? null,
      launchIntel: row.launchIntel || null
    });
  }
  return byWallet;
}

function scanTelemetry(telemetryFiles, shortlistByWallet) {
  const touchesByMint = new Map();
  const decisions = [];
  const samplesByMint = new Map();
  let rowsRead = 0;
  let malformedLines = 0;

  for (const filePath of telemetryFiles) {
    const runId = path.basename(filePath, '.jsonl');
    const stats = forEachJsonlSync(filePath, (event) => {
      const type = eventType(event);
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
          score: compact(payload.score, 4),
          curveProgress: compact(curveOf(payload), 6),
          recentVolumeSol: compact(payload.recentVolumeSol, 6),
          tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 6),
          sourceType: type,
          runId
        });
      }

      if (type === 'pre_migration_paper.decision') {
        const reason = payload.reason || payload.skipReason || payload.decision || 'unknown';
        if (reason !== 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') return;
        decisions.push({
          runId,
          mint,
          symbol: payload.symbol || null,
          at,
          atMs,
          reason,
          score: compact(payload.score, 4),
          curveProgress: compact(curveOf(payload), 6),
          recentVolumeSol: compact(payload.recentVolumeSol, 6),
          tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 6)
        });
        return;
      }

      if (type !== 'wallet.trade_gate_diagnostic') return;
      if ((payload.dropReason || 'unknown') !== 'UNTRACKED_WALLET') return;
      if (String(payload.txType || '').toLowerCase() !== 'buy') return;
      const wallet = walletOf(payload);
      const walletMeta = shortlistByWallet.get(wallet);
      if (!walletMeta) return;
      const touch = {
        runId,
        mint,
        symbol: payload.symbol || null,
        wallet,
        at,
        atMs,
        curveProgress: compact(curveOf(payload), 6),
        walletMeta
      };
      if (!touchesByMint.has(mint)) touchesByMint.set(mint, []);
      touchesByMint.get(mint).push(touch);
    });
    rowsRead += stats.rows;
    malformedLines += stats.malformedLines;
  }

  for (const rows of touchesByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  for (const rows of samplesByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  decisions.sort((a, b) => a.atMs - b.atMs);
  return { rowsRead, malformedLines, touchesByMint, decisions, samplesByMint };
}

function passesGate(sample) {
  return Number(sample.score) >= STRATEGY.minScore
    && Number(sample.curveProgress) >= STRATEGY.minCurveProgress
    && Number(sample.recentVolumeSol) >= STRATEGY.minRecentVolumeSol
    && Number(sample.tradeVelocityPerMin) >= STRATEGY.minTradeVelocityPerMin
    && Number(sample.priceSol) > 0;
}

function buildExit(entry, exit, exitReason) {
  const returnPct = (exit.priceSol - entry.priceSol) / entry.priceSol;
  const stressReturnPct = returnPct - (STRATEGY.stressExtraSlippagePct / 100);
  return {
    exitReason,
    exitAt: exit.at,
    exitPriceSol: compact(exit.priceSol, 12),
    holdSeconds: secondsBetween(entry.at, exit.at),
    returnPct: compact(returnPct, 6),
    pnlSol: compact(STRATEGY.amountSol * returnPct, 9),
    stressReturnPct: compact(stressReturnPct, 6),
    stressedPnlSol: compact(STRATEGY.amountSol * stressReturnPct, 9)
  };
}

function simulateExit(entry, samples) {
  let latest = entry;
  for (const sample of samples.filter((item) => item.atMs >= entry.atMs)) {
    latest = sample;
    const returnPct = (sample.priceSol - entry.priceSol) / entry.priceSol;
    if (returnPct >= STRATEGY.takeProfitPct) return buildExit(entry, sample, 'TAKE_PROFIT');
    if (returnPct <= -STRATEGY.stopLossPct) return buildExit(entry, sample, 'STOP_LOSS');
    if ((sample.atMs - entry.atMs) >= STRATEGY.maxHoldSeconds * 1000) return buildExit(entry, sample, 'MAX_HOLD');
  }
  return buildExit(entry, latest, 'END_OF_RUN');
}

function candidateRows(scanned) {
  const rows = [];
  const seen = new Set();
  for (const decision of scanned.decisions) {
    const touches = (scanned.touchesByMint.get(decision.mint) || [])
      .filter((touch) => touch.atMs <= decision.atMs && touch.atMs >= decision.atMs - (STRATEGY.touchLookbackSeconds * 1000));
    if (!touches.length) continue;
    const firstTouch = touches[0];
    const key = `${decision.runId}:${decision.mint}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const samples = scanned.samplesByMint.get(decision.mint) || [];
    const afterTouch = samples.filter((sample) => sample.atMs >= firstTouch.atMs);
    const entry = afterTouch.find(passesGate) || null;
    if (!entry) {
      rows.push({
        ...decision,
        replayClass: 'NO_GATE_CONFIRM_AFTER_SHORTLIST_TOUCH',
        triggerWallet: firstTouch.wallet,
        triggerAt: firstTouch.at,
        secondsTouchToDecision: secondsBetween(firstTouch.at, decision.at),
        touchCurveProgress: firstTouch.curveProgress,
        triggerWalletMeta: firstTouch.walletMeta
      });
      continue;
    }
    const exit = simulateExit(entry, afterTouch);
    rows.push({
      ...decision,
      replayClass: `WOULD_ENTER_${exit.exitReason}`,
      triggerWallet: firstTouch.wallet,
      triggerAt: firstTouch.at,
      secondsTouchToDecision: secondsBetween(firstTouch.at, decision.at),
      secondsTouchToEntry: secondsBetween(firstTouch.at, entry.at),
      touchCurveProgress: firstTouch.curveProgress,
      triggerWalletMeta: firstTouch.walletMeta,
      entryAt: entry.at,
      entryPriceSol: compact(entry.priceSol, 12),
      entryScore: entry.score,
      entryCurveProgress: entry.curveProgress,
      entryRecentVolumeSol: entry.recentVolumeSol,
      entryTradeVelocityPerMin: entry.tradeVelocityPerMin,
      ...exit
    });
  }
  return rows;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function summarize(rows, scanned, shortlistByWallet) {
  const entered = rows.filter((row) => String(row.replayClass || '').startsWith('WOULD_ENTER_'));
  const wins = entered.filter((row) => Number(row.pnlSol) > 0);
  const sorted = entered.slice().sort((a, b) => a.atMs - b.atMs);
  const midpoint = Math.ceil(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint);
  const secondHalf = sorted.slice(midpoint);
  const top3Pnl = entered.map((row) => Number(row.pnlSol) || 0).sort((a, b) => b - a).slice(0, 3).reduce((total, value) => total + value, 0);
  const totalPnlSol = sum(entered, 'pnlSol');
  const stressedPnlSol = sum(entered, 'stressedPnlSol');
  const firstHalfPnlSol = sum(firstHalf, 'pnlSol');
  const secondHalfPnlSol = sum(secondHalf, 'pnlSol');
  const top3RemovedPnlSol = totalPnlSol - top3Pnl;
  const shadowLaneEligible = entered.length >= 20
    && totalPnlSol > 0
    && stressedPnlSol > 0
    && wins.length / Math.max(1, entered.length) >= 0.45
    && firstHalfPnlSol > 0
    && secondHalfPnlSol > 0
    && top3RemovedPnlSol > 0;
  let verdict = 'INSUFFICIENT_SAMPLE';
  if (entered.length >= 20) {
    if (totalPnlSol <= 0 || stressedPnlSol <= 0) verdict = 'NEGATIVE';
    else if (shadowLaneEligible) verdict = 'PROMISING';
    else verdict = 'INCONCLUSIVE';
  }
  return {
    telemetryRowsRead: scanned.rowsRead,
    malformedLines: scanned.malformedLines,
    shortlistWalletsLoaded: shortlistByWallet.size,
    noTrackedFirstTouchDecisions: scanned.decisions.length,
    decisionsWithShortlistTouch: rows.length,
    wouldEnter: entered.length,
    noGateConfirmAfterTouch: rows.filter((row) => row.replayClass === 'NO_GATE_CONFIRM_AFTER_SHORTLIST_TOUCH').length,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    uniqueEntryMints: new Set(entered.map((row) => row.mint)).size,
    wins: wins.length,
    losses: entered.filter((row) => Number(row.pnlSol) < 0).length,
    winRate: entered.length ? compact(wins.length / entered.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    stressedPnlSol: compact(stressedPnlSol, 9),
    averagePnlSol: entered.length ? compact(totalPnlSol / entered.length, 9) : null,
    firstHalfPnlSol: entered.length ? compact(firstHalfPnlSol, 9) : null,
    secondHalfPnlSol: entered.length > 1 ? compact(secondHalfPnlSol, 9) : null,
    top3RemovedPnlSol: compact(top3RemovedPnlSol, 9),
    exitReasonCounts: rows.reduce((acc, row) => {
      if (!row.exitReason) return acc;
      acc[row.exitReason] = (acc[row.exitReason] || 0) + 1;
      return acc;
    }, {}),
    verdict,
    shadowLaneEligible,
    verdictReason: shadowLaneEligible
      ? 'Launch-intel shortlist touch replay cleared sample, raw/stressed PnL, win-rate, split-half, and top-winner durability checks.'
      : 'Report-only evidence is not durable enough to promote; keep collecting or narrow the shortlist.'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stability = readJson(STABILITY_PATH, {});
  const telemetryFiles = resolveTelemetryFiles(args, stability);
  const missing = telemetryFiles.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length) throw new Error(`Telemetry file(s) not found: ${missing.join(', ')}`);
  const shortlistByWallet = shortlistIndex(stability);
  const scanned = scanTelemetry(telemetryFiles, shortlistByWallet);
  const rows = candidateRows(scanned);
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    mode: 'report_only_launch_intel_shortlist_entry_replay',
    sources: {
      stabilityPath: STABILITY_PATH,
      stabilityGeneratedAt: stability.generatedAt || null,
      telemetryFiles
    },
    strategy: STRATEGY,
    note: 'Report-only replay. Treats launch-intel shortlist buys as provisional wallet-proof only for NO_TRACKED_FIRST_TOUCH_BUY decisions, then still requires score/curve/volume/velocity confirmation before a hypothetical entry. Does not alter wallet trust, paper entries, live behavior, or runtime gates.',
    summary: summarize(rows, scanned, shortlistByWallet),
    topWouldWinners: rows.filter((row) => row.pnlSol !== null && row.pnlSol !== undefined).slice().sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol)).slice(0, 12),
    topWouldLosers: rows.filter((row) => row.pnlSol !== null && row.pnlSol !== undefined).slice().sort((a, b) => Number(a.pnlSol) - Number(b.pnlSol)).slice(0, 12),
    noGateConfirmSamples: rows.filter((row) => row.replayClass === 'NO_GATE_CONFIRM_AFTER_SHORTLIST_TOUCH').slice(0, 25),
    rows
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-launch-intel-shortlist-entry-replay-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote launch-intel shortlist entry replay: ${reportPath}`);
  console.log(`Wrote latest launch-intel shortlist entry replay: ${LATEST_PATH}`);
  console.log(`decisionsWithShortlistTouch=${payload.summary.decisionsWithShortlistTouch} wouldEnter=${payload.summary.wouldEnter} pnl=${payload.summary.totalPnlSol} verdict=${payload.summary.verdict}`);
}

main();
