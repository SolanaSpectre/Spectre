#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const FOLLOW_THROUGH_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-follow-through-latest.json');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'no-prior-delayed-entry-replay-latest.json');

const DEFAULT_STRATEGY = {
  minScore: 75,
  minRecentVolumeSol: 25,
  minTradeVelocityPerMin: 25,
  takeProfitPct: 0.5,
  stopLossPct: 0.25,
  maxHoldSeconds: 600,
  amountSol: 0.1,
  confirmCurveThreshold: 0.85,
  delaysSeconds: [30, 60, 120],
  minClosedTradesForWinRate: 5
};

// Report-only replay guardrail:
// this diagnostic must never loosen NO_PRIOR, score, volume, or velocity gates,
// and it must never emit signals, quotes, AI reviews, entries, or live actions.

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

function displayPath(filePath) {
  if (!filePath) return null;
  const relative = path.relative(ROOT, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, '/')
    : filePath;
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
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

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(LOG_DIR, name);
      return { fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.fullPath || null;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function telemetryWindow(events = []) {
  const timestamps = events
    .map((event) => timestampMs(payloadOf(event).timestamp || event.timestamp))
    .filter(Number.isFinite);
  if (!timestamps.length) {
    return { startMs: null, endMs: null, startAt: null, endAt: null };
  }
  const startMs = Math.min(...timestamps);
  const endMs = Math.max(...timestamps);
  return {
    startMs,
    endMs,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString()
  };
}

function isWithinTelemetryWindow(timestamp, window) {
  const ms = timestampMs(timestamp);
  if (!Number.isFinite(ms)) return false;
  if (Number.isFinite(window.startMs) && ms < window.startMs) return false;
  if (Number.isFinite(window.endMs) && ms > window.endMs) return false;
  return true;
}

function secondsBetween(startIso, endIso) {
  const startMs = timestampMs(startIso);
  const endMs = timestampMs(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return numberOrNull((endMs - startMs) / 1000, 2);
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function priceOf(payload) {
  const direct = numberOrNull(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const sol = numberOrNull(payload.virtualSolReservesSol);
  const tokens = numberOrNull(payload.virtualTokenReservesTokens);
  if (Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0) {
    return sol / tokens;
  }
  return direct;
}

function strategyFromArgs(args) {
  const strategy = { ...DEFAULT_STRATEGY };
  const mapping = {
    minScore: 'minScore',
    minVolume: 'minRecentVolumeSol',
    minVelocity: 'minTradeVelocityPerMin',
    takeProfit: 'takeProfitPct',
    stopLoss: 'stopLossPct',
    maxHold: 'maxHoldSeconds',
    amount: 'amountSol',
    confirmCurve: 'confirmCurveThreshold'
  };

  for (const [argKey, strategyKey] of Object.entries(mapping)) {
    if (args[argKey] === undefined) continue;
    const value = Number(args[argKey]);
    if (Number.isFinite(value)) strategy[strategyKey] = value;
  }
  return strategy;
}

function list(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.watchlist || payload?.candidates || payload?.falseNegatives || payload?.items || [];
}

function buildOutcomeByMint(falseNegativeRows) {
  const map = new Map();
  for (const row of falseNegativeRows) {
    if (!row?.mint) continue;
    map.set(row.mint, {
      outcome: row.outcome || row.classification || 'UNKNOWN',
      falseNegativePriority: row.falseNegativePriority ?? row.priority ?? null,
      curve75At: row.curve75At || null,
      curve85At: row.curve85At || null,
      curve95At: row.curve95At || null,
      curve100At: row.curve100At || null,
      maxScore: row.maxScore ?? null,
      maxCurveProgress: row.maxCurveProgress ?? null,
      maxRecentVolumeSol: row.maxRecentVolumeSol ?? null,
      maxTradeVelocityPerMin: row.maxTradeVelocityPerMin ?? null
    });
  }
  return map;
}

function buildPriceSamplesByMint(events) {
  const samplesByMint = new Map();
  for (const event of events) {
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    const timestamp = payload.timestamp || event.timestamp || null;
    const priceSol = priceOf(payload);
    if (!mint || !timestamp || !Number.isFinite(priceSol) || priceSol <= 0) continue;

    if (!samplesByMint.has(mint)) samplesByMint.set(mint, []);
    samplesByMint.get(mint).push({
      timestamp,
      type: eventType(event),
      priceSol,
      curveProgress: numberOrNull(payload.curveProgress, 6),
      score: numberOrNull(payload.score, 2),
      recentVolumeSol: numberOrNull(payload.recentVolumeSol, 4),
      tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 2)
    });
  }

  for (const samples of samplesByMint.values()) {
    samples.sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
  }
  return samplesByMint;
}

function classNameForExit(reason) {
  return `WOULD_ENTER_${reason}`;
}

function findEntrySample(samples, confirmTimestamp) {
  const confirmMs = timestampMs(confirmTimestamp);
  if (!Number.isFinite(confirmMs)) return null;
  return samples.find((sample) => timestampMs(sample.timestamp) >= confirmMs) || null;
}

function simulateExit(entry, samples, strategy) {
  const entryMs = timestampMs(entry.timestamp);
  const maxHoldMs = entryMs + strategy.maxHoldSeconds * 1000;
  const later = samples.filter((sample) => timestampMs(sample.timestamp) >= entryMs);
  let latest = entry;

  for (const sample of later) {
    const sampleMs = timestampMs(sample.timestamp);
    latest = sample;
    const returnPct = (sample.priceSol - entry.priceSol) / entry.priceSol;
    if (returnPct >= strategy.takeProfitPct) {
      return buildExit(entry, sample, 'TAKE_PROFIT', strategy);
    }
    if (returnPct <= -strategy.stopLossPct) {
      return buildExit(entry, sample, 'STOP_LOSS', strategy);
    }
    if (sampleMs - entryMs >= strategy.maxHoldSeconds * 1000) {
      return buildExit(entry, sample, 'MAX_HOLD', strategy);
    }
    if (sampleMs > maxHoldMs) break;
  }

  return buildExit(entry, latest, latest === entry ? 'END_OF_RUN' : 'END_OF_RUN', strategy);
}

function buildExit(entry, exit, reason, strategy) {
  const returnPct = entry.priceSol > 0 ? (exit.priceSol - entry.priceSol) / entry.priceSol : 0;
  return {
    class: classNameForExit(reason),
    exitReason: reason,
    exitAt: exit.timestamp,
    exitPriceSol: numberOrNull(exit.priceSol, 12),
    exitCurveProgress: exit.curveProgress ?? null,
    returnPct: numberOrNull(returnPct, 6),
    pnlSol: numberOrNull(strategy.amountSol * returnPct, 9),
    holdSeconds: secondsBetween(entry.timestamp, exit.timestamp)
  };
}

function windowFor(decision, delaySeconds) {
  return decision.windows?.[`${delaySeconds}s`] || {};
}

function hasConfirmation(window, strategy) {
  if (strategy.confirmCurveThreshold >= 0.95) return Boolean(window.crossed95AfterSkip);
  return Boolean(window.crossed85AfterSkip);
}

function confirmTimestamp(window, strategy) {
  if (strategy.confirmCurveThreshold >= 0.95) return window.first95CrossAt || null;
  return window.first85CrossAt || null;
}

function passesStrengthGate(window, strategy) {
  return Number(window.maxScore) >= strategy.minScore
    && Number(window.maxRecentVolumeSol) >= strategy.minRecentVolumeSol
    && Number(window.maxTradeVelocityPerMin) >= strategy.minTradeVelocityPerMin;
}

function replayDelay(decision, delaySeconds, priceSamples, strategy) {
  const window = windowFor(decision, delaySeconds);
  const confirmed85 = Boolean(window.crossed85AfterSkip);
  const confirmed95 = Boolean(window.crossed95AfterSkip);
  const confirmAt = confirmTimestamp(window, strategy);
  const base = {
    confirmed85,
    confirmed95,
    confirmTimestamp: confirmAt,
    passedStrengthGate: false,
    class: 'NO_CONFIRM_WITHIN_DELAY',
    entryAt: null,
    entryPriceSol: null,
    exitAt: null,
    exitPriceSol: null,
    exitReason: null,
    returnPct: null,
    pnlSol: null,
    holdSeconds: null,
    maxScoreInWindow: window.maxScore ?? null,
    maxRecentVolumeSolInWindow: window.maxRecentVolumeSol ?? null,
    maxTradeVelocityPerMinInWindow: window.maxTradeVelocityPerMin ?? null,
    maxCurveProgressInWindow: window.maxCurveProgress ?? null
  };

  if (!hasConfirmation(window, strategy) || !confirmAt) return base;

  const strong = passesStrengthGate(window, strategy);
  base.passedStrengthGate = strong;
  if (!strong) {
    return { ...base, class: 'WEAK_CONFIRM_WITHIN_DELAY' };
  }

  const entry = findEntrySample(priceSamples, confirmAt);
  if (!entry) {
    return { ...base, class: 'PRICE_UNAVAILABLE' };
  }

  const exit = simulateExit(entry, priceSamples, strategy);
  return {
    ...base,
    ...exit,
    entryAt: entry.timestamp,
    entryPriceSol: numberOrNull(entry.priceSol, 12),
    entryCurveProgress: entry.curveProgress ?? null,
    class: exit.class
  };
}

function flattenDecisions(followThroughReport, outcomeByMint, priceSamplesByMint, strategy, window) {
  const rows = [];
  let excludedOutsideTelemetryWindow = 0;
  for (const candidate of Array.isArray(followThroughReport?.candidates) ? followThroughReport.candidates : []) {
    const context = outcomeByMint.get(candidate.mint) || {};
    const decisions = Array.isArray(candidate.decisions) ? candidate.decisions : [];
    for (const decision of decisions) {
      if (!isWithinTelemetryWindow(decision.timestamp, window)) {
        excludedOutsideTelemetryWindow += 1;
        continue;
      }
      const priceSamples = priceSamplesByMint.get(decision.mint || candidate.mint) || [];
      const perDelay = {};
      for (const delaySeconds of strategy.delaysSeconds) {
        perDelay[`${delaySeconds}s`] = replayDelay(decision, delaySeconds, priceSamples, strategy);
      }
      rows.push({
        mint: decision.mint || candidate.mint,
        symbol: decision.symbol || candidate.symbol || null,
        outcomeLabel: context.outcome || 'UNKNOWN',
        decisionTimestamp: decision.timestamp,
        skipCurveProgress: decision.curveProgress ?? null,
        skipScore: decision.score ?? null,
        skipRecentVolumeSol: decision.recentVolumeSol ?? null,
        skipTradeVelocityPerMin: decision.tradeVelocityPerMin ?? null,
        outcomeContext: context,
        priceSampleCount: priceSamples.length,
        perDelay
      });
    }
  }
  return { rows, excludedOutsideTelemetryWindow };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarizeDelay(rows, delayKey, strategy) {
  const delayRows = rows.map((row) => ({ row, result: row.perDelay[delayKey] || {} }));
  const closedRows = delayRows.filter(({ result }) => String(result.class || '').startsWith('WOULD_ENTER_'));
  const wins = closedRows.filter(({ result }) => result.exitReason === 'TAKE_PROFIT');
  const losses = closedRows.filter(({ result }) => ['STOP_LOSS', 'MAX_HOLD', 'END_OF_RUN'].includes(result.exitReason));
  const totalPnlSol = closedRows.reduce((sum, { result }) => sum + Number(result.pnlSol || 0), 0);
  const holdValues = closedRows.map(({ result }) => Number(result.holdSeconds)).filter(Number.isFinite);
  const uniqueMints = new Set(delayRows.map(({ row }) => row.mint).filter(Boolean));
  const priceUnavailable = delayRows.filter(({ result }) => result.class === 'PRICE_UNAVAILABLE').length;
  const withPrice = closedRows.length;

  return {
    decisions: delayRows.length,
    uniqueMints: uniqueMints.size,
    classCounts: countBy(delayRows, ({ result }) => result.class),
    wouldEnterCount: closedRows.length,
    wouldExitTpCount: wins.length,
    wouldExitSlCount: closedRows.filter(({ result }) => result.exitReason === 'STOP_LOSS').length,
    wouldExitMaxHoldCount: closedRows.filter(({ result }) => result.exitReason === 'MAX_HOLD').length,
    wouldExitEndOfRunCount: closedRows.filter(({ result }) => result.exitReason === 'END_OF_RUN').length,
    priceUnavailableCount: priceUnavailable,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    averagePnlSol: closedRows.length ? numberOrNull(totalPnlSol / closedRows.length, 9) : null,
    winRate: closedRows.length >= strategy.minClosedTradesForWinRate
      ? numberOrNull(wins.length / closedRows.length, 4)
      : null,
    closedTradesForWinRate: closedRows.length,
    wins: wins.length,
    losses: losses.length,
    averageHoldSeconds: holdValues.length
      ? numberOrNull(holdValues.reduce((sum, value) => sum + value, 0) / holdValues.length, 2)
      : null,
    priceFoundCount: withPrice
  };
}

function summarizeRows(rows, strategy) {
  const byDelay = {};
  for (const delaySeconds of strategy.delaysSeconds) {
    byDelay[`${delaySeconds}s`] = summarizeDelay(rows, `${delaySeconds}s`, strategy);
  }

  const byOutcome = {};
  for (const outcome of Object.keys(countBy(rows, (row) => row.outcomeLabel))) {
    const outcomeRows = rows.filter((row) => row.outcomeLabel === outcome);
    const outcomeDelaySummaries = Object.fromEntries(strategy.delaysSeconds.map((delay) => [`${delay}s`, summarizeDelay(outcomeRows, `${delay}s`, strategy)]));
    byOutcome[outcome] = {
      decisions: outcomeRows.length,
      uniqueMints: new Set(outcomeRows.map((row) => row.mint).filter(Boolean)).size,
      wouldEnterCount: Object.values(outcomeDelaySummaries).reduce((sum, row) => sum + numberOrNull(row.wouldEnterCount, 0), 0),
      byDelay: outcomeDelaySummaries
    };
  }

  const anyPriceByMint = new Set(rows.filter((row) => row.priceSampleCount > 0).map((row) => row.mint));
  const allResults = rows.flatMap((row) => Object.entries(row.perDelay).map(([delay, result]) => ({ row, delay, result })));
  const pricedResults = allResults.filter(({ result }) => String(result.class || '').startsWith('WOULD_ENTER_'));
  const noPriceResults = allResults.filter(({ result }) => result.class === 'PRICE_UNAVAILABLE');

  return {
    decisionsConsidered: rows.length,
    uniqueMintsConsidered: new Set(rows.map((row) => row.mint).filter(Boolean)).size,
    byDelay,
    byOutcome,
    priceCoverage: {
      decisionsWithPostConfirmPriceSnapshot: pricedResults.length,
      decisionsWithoutPostConfirmPriceSnapshot: noPriceResults.length,
      uniqueMintsWithPriceTrack: anyPriceByMint.size
    }
  };
}

function topRows(rows, limit, direction = 'desc') {
  const flattened = rows.flatMap((row) => Object.entries(row.perDelay).map(([delay, result]) => ({ row, delay, result })))
    .filter(({ result }) => String(result.class || '').startsWith('WOULD_ENTER_') && Number.isFinite(Number(result.pnlSol)))
    .sort((a, b) => direction === 'asc'
      ? Number(a.result.pnlSol) - Number(b.result.pnlSol)
      : Number(b.result.pnlSol) - Number(a.result.pnlSol));

  return flattened.slice(0, limit).map(({ row, delay, result }) => ({
    mint: row.mint,
    symbol: row.symbol,
    outcomeLabel: row.outcomeLabel,
    delay,
    class: result.class,
    exitReason: result.exitReason,
    pnlSol: result.pnlSol,
    returnPct: result.returnPct,
    holdSeconds: result.holdSeconds,
    entryAt: result.entryAt,
    entryPriceSol: result.entryPriceSol,
    entryCurveProgress: result.entryCurveProgress,
    maxCurveProgressInWindow: result.maxCurveProgressInWindow
  }));
}

function buildReport({ followThroughReport, followThroughPath, falseNegativeRows, falseNegativePath, telemetryPath, events, strategy }) {
  const outcomeByMint = buildOutcomeByMint(falseNegativeRows);
  const priceSamplesByMint = buildPriceSamplesByMint(events);
  const window = telemetryWindow(events);
  const { rows: decisions, excludedOutsideTelemetryWindow } = flattenDecisions(
    followThroughReport,
    outcomeByMint,
    priceSamplesByMint,
    strategy,
    window
  );
  const summary = summarizeRows(decisions, strategy);
  summary.sourceCoverage = {
    ...(summary.sourceCoverage || {}),
    decisionsExcludedOutsideTelemetryWindow: excludedOutsideTelemetryWindow
  };

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      followThroughPath: displayPath(followThroughPath),
      falseNegativePath: displayPath(falseNegativePath),
      telemetryPath: displayPath(telemetryPath)
    },
    telemetryWindow: {
      startAt: window.startAt,
      endAt: window.endAt
    },
    strategy,
    summary,
    decisions,
    topWouldWinners: topRows(decisions, 15, 'desc'),
    topWouldLosers: topRows(decisions, 15, 'asc'),
    note: 'Report-only delayed-entry NO_PRIOR replay. Does not change thresholds, entries, signals, quotes, AI review, or live behavior. PRICE_UNAVAILABLE rows are NOT evidence of edge and must not be used to justify threshold loosening.'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const followThroughPath = repoPath(args.followThrough) || FOLLOW_THROUGH_PATH;
  const falseNegativePath = repoPath(args.falseNegatives) || FALSE_NEGATIVE_PATH;
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const followThroughReport = readJson(followThroughPath, {});
  const telemetryPath = repoPath(args.telemetry) || repoPath(followThroughReport.telemetryPath) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for NO_PRIOR delayed-entry replay.');
  }

  const strategy = strategyFromArgs(args);
  const falseNegativeRows = list(readJson(falseNegativePath, []));
  const report = buildReport({
    followThroughReport,
    followThroughPath,
    falseNegativeRows,
    falseNegativePath,
    telemetryPath,
    events: readJsonl(telemetryPath),
    strategy
  });
  writeJson(outputPath, report);

  console.log('NO_PRIOR Delayed-Entry Replay');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Decisions: ${report.summary.decisionsConsidered}`);
  console.log(`Unique mints: ${report.summary.uniqueMintsConsidered}`);
  for (const delay of strategy.delaysSeconds) {
    const summary = report.summary.byDelay[`${delay}s`];
    console.log(`${delay}s: wouldEnter=${summary.wouldEnterCount} priceUnavailable=${summary.priceUnavailableCount} pnl=${summary.totalPnlSol}`);
  }
  console.log(`Wrote JSON report: ${outputPath}`);
}

main();
