#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-exit-protection-replay-latest.json');
const DEFAULT_MAX_FILES = 24;

const SCENARIOS = [
  {
    name: 'current_profile',
    description: 'Observed-path replay using entry strategy and exitProfile telemetry. It may see more price-bearing events than the runtime lane evaluated.'
  },
  {
    name: 'current_activation_floor_3pct',
    description: 'After the current profile breakeven activation, protect at the first observed return <= +3%.',
    overrides: { breakevenStopPct: 0.03 }
  },
  {
    name: 'activation12_floor5',
    description: 'Activate breakeven protection at +12%, then protect at the first observed return <= +5%.',
    overrides: { breakevenActivationPct: 0.12, breakevenStopPct: 0.05 }
  },
  {
    name: 'activation15_floor8',
    description: 'Activate breakeven protection at +15%, then protect at the first observed return <= +8%.',
    overrides: { breakevenActivationPct: 0.15, breakevenStopPct: 0.08 }
  },
  {
    name: 'trailing_giveback_8pct',
    description: 'After a positive peak, close once observed giveback from peak reaches 8%.',
    overrides: { trailingGivebackPct: 0.08, trailingActivationPct: 0.08 }
  },
  {
    name: 'trailing_giveback_12pct',
    description: 'After a positive peak, close once observed giveback from peak reaches 12%.',
    overrides: { trailingGivebackPct: 0.12, trailingActivationPct: 0.08 }
  },
  {
    name: 'hybrid_activation12_floor5_giveback10',
    description: 'Activate breakeven protection at +12%, protect +5%, and close after 10% giveback from peak.',
    overrides: { breakevenActivationPct: 0.12, breakevenStopPct: 0.05, trailingGivebackPct: 0.10, trailingActivationPct: 0.08 }
  }
];

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

function telemetryFiles(maxFiles = DEFAULT_MAX_FILES) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((item) => item.filePath)
    .reverse();
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

function priceOf(payload) {
  const direct = Number(payload.quote?.spotPriceSol
    ?? payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const virtualSol = Number(payload.virtualSolReservesSol);
  const virtualTokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(virtualSol) && Number.isFinite(virtualTokens) && virtualTokens > 0
    ? virtualSol / virtualTokens
    : null;
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

function buyRatioOf(payload) {
  const direct = Number(payload.buyRatio);
  if (Number.isFinite(direct)) return direct;
  const recentBuys = Number(payload.recentBuys);
  const recentSells = Number(payload.recentSells);
  if (!Number.isFinite(recentBuys) || !Number.isFinite(recentSells)) return null;
  const total = recentBuys + recentSells;
  return total > 0 ? recentBuys / total : null;
}

function entryKey(row) {
  return [
    row.telemetryPath,
    row.mint,
    row.entryAt || '',
    row.preset || '',
    row.profileName || '',
    row.entryPriceSol || ''
  ].join(':');
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function stats(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, sum: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  const mid = Math.floor(finite.length / 2);
  const median = finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
  return {
    count: finite.length,
    min: num(finite[0], digits),
    median: num(median, digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    sum: num(sum, digits),
    avg: num(sum / finite.length, digits)
  };
}

function sampleOf(event, telemetryPath) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const priceSol = priceOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(priceSol) || priceSol <= 0) return null;
  return {
    telemetryPath,
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    type: eventType(event),
    priceSol,
    curveProgress: curveOf(payload),
    buyRatio: buyRatioOf(payload)
  };
}

function entryOf(event, telemetryPath) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const entryMs = timestampMs(payload.entryAt || payload.timestamp || event.timestamp);
  const entryPriceSol = Number(payload.entryPriceSol);
  if (!mint || !Number.isFinite(entryMs) || !Number.isFinite(entryPriceSol) || entryPriceSol <= 0) return null;
  return {
    telemetryPath,
    mint,
    symbol: payload.symbol || null,
    entryAt: new Date(entryMs).toISOString(),
    entryMs,
    preset: payload.preset || payload.presetName || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    entryPriceSol,
    amountSol: num(payload.amountSol, 9) ?? 0.1,
    entryScore: num(payload.entryScore ?? payload.score, 2),
    entryCurveProgress: num(payload.entryCurveProgress ?? payload.curveProgress, 6),
    strategy: payload.strategy || {},
    exitProfile: payload.exitProfile || {},
    actual: null
  };
}

function exitOf(event, telemetryPath) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const exitMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(exitMs)) return null;
  return {
    telemetryPath,
    mint,
    symbol: payload.symbol || null,
    entryAt: payload.entryAt || null,
    preset: payload.preset || payload.presetName || null,
    profileName: payload.profileName || null,
    entryPriceSol: num(payload.entryPriceSol, 15),
    exitAt: new Date(exitMs).toISOString(),
    exitMs,
    reason: payload.reason || payload.exitReason || null,
    exitPriceSol: num(payload.exitPriceSol, 15),
    returnPct: num(payload.returnPct, 6),
    pnlSol: num(payload.pnlSol, 9),
    holdSeconds: num(payload.holdSeconds, 2),
    peakReturnPct: num(payload.peakReturnPct, 6)
  };
}

async function readTelemetry(filePath) {
  const telemetryPath = path.relative(ROOT, filePath);
  const entries = [];
  const exits = [];
  const samplesByMint = new Map();
  let malformedLines = 0;
  let eventCount = 0;

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
    eventCount += 1;
    const type = eventType(event);
    const sample = sampleOf(event, telemetryPath);
    if (sample) {
      const rows = samplesByMint.get(sample.mint) || [];
      rows.push(sample);
      samplesByMint.set(sample.mint, rows);
    }
    if (type === 'pre_migration_paper.entry') {
      const entry = entryOf(event, telemetryPath);
      if (entry) entries.push(entry);
    } else if (type === 'pre_migration_paper.exit') {
      const exit = exitOf(event, telemetryPath);
      if (exit) exits.push(exit);
    }
  }

  for (const rows of samplesByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  const exitsByKey = new Map(exits.map((exit) => [entryKey(exit), exit]));
  for (const entry of entries) {
    entry.actual = exitsByKey.get(entryKey(entry)) || null;
  }

  return {
    filePath,
    telemetryPath,
    eventCount,
    malformedLines,
    entries,
    exits,
    samplesByMint
  };
}

function mergedProfile(entry, scenario) {
  const exitProfile = { ...(entry.exitProfile || {}) };
  const strategy = { ...(entry.strategy || {}) };
  const overrides = scenario.overrides || {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key in exitProfile || key.includes('breakeven') || key.includes('trailing')) {
      exitProfile[key] = value;
    } else {
      strategy[key] = value;
    }
  }
  return { exitProfile, strategy };
}

function closeTrade(entry, sample, reason, extra = {}) {
  const returnPct = (sample.priceSol - entry.entryPriceSol) / entry.entryPriceSol;
  const pnlSol = Number(entry.amountSol || 0.1) * returnPct;
  return {
    telemetryPath: entry.telemetryPath,
    mint: entry.mint,
    symbol: entry.symbol,
    preset: entry.preset,
    lane: entry.lane,
    profileName: entry.profileName,
    entryAt: entry.entryAt,
    exitAt: sample.at,
    reason,
    entryPriceSol: num(entry.entryPriceSol, 15),
    exitPriceSol: num(sample.priceSol, 15),
    entryCurveProgress: entry.entryCurveProgress,
    exitCurveProgress: num(sample.curveProgress, 6),
    returnPct: num(returnPct, 6),
    pnlSol: num(pnlSol, 9),
    holdSeconds: num((sample.atMs - entry.entryMs) / 1000, 2),
    ...extra
  };
}

function replayEntry(entry, samples, scenario) {
  const { exitProfile, strategy } = mergedProfile(entry, scenario);
  const pathRows = samples
    .filter((sample) => sample.atMs >= entry.entryMs)
    .sort((a, b) => a.atMs - b.atMs);
  if (!pathRows.length) {
    return {
      telemetryPath: entry.telemetryPath,
      mint: entry.mint,
      symbol: entry.symbol,
      preset: entry.preset,
      profileName: entry.profileName,
      entryAt: entry.entryAt,
      reason: 'NO_PRICE_PATH',
      returnPct: null,
      pnlSol: null,
      holdSeconds: null,
      sampleCount: 0
    };
  }

  let peakReturnPct = 0;
  let maxCurveProgress = Number(entry.entryCurveProgress);
  let maxPriceSol = entry.entryPriceSol;
  let minPriceSol = entry.entryPriceSol;

  for (const sample of pathRows) {
    maxPriceSol = Math.max(maxPriceSol, sample.priceSol);
    minPriceSol = Math.min(minPriceSol, sample.priceSol);
    if (Number.isFinite(Number(sample.curveProgress))) {
      maxCurveProgress = Number.isFinite(maxCurveProgress)
        ? Math.max(maxCurveProgress, Number(sample.curveProgress))
        : Number(sample.curveProgress);
    }

    const returnPct = (sample.priceSol - entry.entryPriceSol) / entry.entryPriceSol;
    const holdSeconds = (sample.atMs - entry.entryMs) / 1000;
    peakReturnPct = Math.max(peakReturnPct, returnPct);
    const common = {
      peakReturnPct: num(peakReturnPct, 6),
      givebackPct: num(peakReturnPct - returnPct, 6),
      maxCurveProgress: num(maxCurveProgress, 6),
      maxPriceSol: num(maxPriceSol, 15),
      minPriceSol: num(minPriceSol, 15),
      sampleCount: pathRows.length
    };

    const trailingActivation = Number(exitProfile.trailingActivationPct);
    const trailingGiveback = Number(exitProfile.trailingGivebackPct);
    if (
      Number.isFinite(trailingActivation)
      && Number.isFinite(trailingGiveback)
      && peakReturnPct >= trailingActivation
      && peakReturnPct - returnPct >= trailingGiveback
    ) {
      return closeTrade(entry, sample, 'TRAILING_GIVEBACK', common);
    }

    if (
      exitProfile.breakevenStopEnabled !== false
      && Number.isFinite(Number(exitProfile.breakevenActivationPct))
      && peakReturnPct >= Number(exitProfile.breakevenActivationPct)
      && Number.isFinite(Number(exitProfile.breakevenStopPct))
      && returnPct <= Number(exitProfile.breakevenStopPct)
    ) {
      return closeTrade(entry, sample, 'BREAKEVEN_STOP', common);
    }

    if (
      exitProfile.sellPressureExitEnabled
      && Number.isFinite(holdSeconds)
      && holdSeconds >= Number(exitProfile.sellPressureMinHoldSeconds)
      && Number.isFinite(Number(sample.buyRatio))
      && Number(sample.buyRatio) <= Number(exitProfile.sellPressureBuyRatioThreshold)
    ) {
      return closeTrade(entry, sample, 'SELL_PRESSURE_FLIP', common);
    }

    if (
      exitProfile.curveStallExitEnabled
      && Number.isFinite(holdSeconds)
      && holdSeconds >= Number(exitProfile.curveStallSeconds)
      && Number.isFinite(Number(entry.entryCurveProgress))
      && Number.isFinite(maxCurveProgress)
      && maxCurveProgress - Number(entry.entryCurveProgress) < Number(exitProfile.curveStallMinProgressAdvance)
    ) {
      return closeTrade(entry, sample, 'CURVE_STALL', common);
    }

    if (returnPct >= Number(strategy.takeProfitPct)) {
      return closeTrade(entry, sample, 'TAKE_PROFIT', common);
    }

    if (returnPct <= -Number(strategy.stopLossPct)) {
      return closeTrade(entry, sample, 'STOP_LOSS', common);
    }

    if (Number.isFinite(holdSeconds) && holdSeconds >= Number(strategy.maxHoldSeconds)) {
      return closeTrade(entry, sample, 'TIME_LIMIT', common);
    }
  }

  const last = pathRows[pathRows.length - 1];
  const returnPct = (last.priceSol - entry.entryPriceSol) / entry.entryPriceSol;
  return closeTrade(entry, last, 'SESSION_END_REPLAY', {
    peakReturnPct: num(peakReturnPct, 6),
    givebackPct: num(peakReturnPct - returnPct, 6),
    maxCurveProgress: num(maxCurveProgress, 6),
    maxPriceSol: num(maxPriceSol, 15),
    minPriceSol: num(minPriceSol, 15),
    sampleCount: pathRows.length
  });
}

function summarizeScenario(name, rows, baselineRows) {
  const keyedBaseline = new Map((baselineRows || []).map((row) => [entryKey(row), row]));
  const rowsWithPnl = rows.filter((row) => Number.isFinite(Number(row.pnlSol)));
  const totalPnlSol = rowsWithPnl.reduce((sum, row) => sum + Number(row.pnlSol), 0);
  const wins = rows.filter((row) => Number(row.pnlSol) > 0).length;
  const losses = rows.filter((row) => Number(row.pnlSol) < 0).length;
  const deltas = rows.map((row) => {
    const baseline = keyedBaseline.get(entryKey(row));
    if (!baseline || !Number.isFinite(Number(row.pnlSol)) || !Number.isFinite(Number(baseline.pnlSol))) return null;
    return Number(row.pnlSol) - Number(baseline.pnlSol);
  }).filter(Number.isFinite);
  const improved = deltas.filter((value) => value > 0).length;
  const worsened = deltas.filter((value) => value < 0).length;
  return {
    name,
    entries: rows.length,
    wins,
    losses,
    flats: rows.length - wins - losses,
    winRate: wins + losses > 0 ? num(wins / (wins + losses), 4) : null,
    totalPnlSol: num(totalPnlSol, 9),
    avgPnlSol: rows.length ? num(totalPnlSol / rows.length, 9) : null,
    pnlDeltaVsCurrentSol: deltas.length ? num(deltas.reduce((sum, value) => sum + value, 0), 9) : null,
    improvedVsCurrent: improved,
    worsenedVsCurrent: worsened,
    unchangedVsCurrent: deltas.length - improved - worsened,
    exitReasonCounts: countBy(rows, (row) => row.reason),
    returnPct: stats(rows.map((row) => row.returnPct), 6),
    holdSeconds: stats(rows.map((row) => row.holdSeconds), 2),
    givebackPct: stats(rows.map((row) => row.givebackPct), 6)
  };
}

function summarizeTrailingGivebackMfe8Validation(currentRows, trailingRows) {
  const trailingByKey = new Map((trailingRows || []).map((row) => [entryKey(row), row]));
  const baselineRows = (currentRows || [])
    .filter((row) => Number(row.peakReturnPct) >= 0.08)
    .filter((row) => trailingByKey.has(entryKey(row)));

  const pairs = baselineRows.map((currentRow) => {
    const trailingRow = trailingByKey.get(entryKey(currentRow));
    const delta = Number(trailingRow?.pnlSol) - Number(currentRow.pnlSol);
    return {
      current: currentRow,
      trailing: trailingRow,
      deltaPnlSol: Number.isFinite(delta) ? num(delta, 9) : null
    };
  }).filter((pair) => Number.isFinite(Number(pair.deltaPnlSol)));

  const trailingValidRows = pairs.map((pair) => pair.trailing);
  const currentValidRows = pairs.map((pair) => pair.current);
  const improved = pairs.filter((pair) => Number(pair.deltaPnlSol) > 0).length;
  const worsened = pairs.filter((pair) => Number(pair.deltaPnlSol) < 0).length;
  const unchanged = pairs.length - improved - worsened;
  const currentPnlSol = currentValidRows.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const trailingPnlSol = trailingValidRows.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const trailingWins = trailingValidRows.filter((row) => Number(row.pnlSol) > 0).length;
  const trailingLosses = trailingValidRows.filter((row) => Number(row.pnlSol) < 0).length;

  return {
    scope: 'current_profile entries with observed MFE >= 8%',
    baselineScenario: 'current_profile',
    trailingScenario: 'trailing_giveback_8pct',
    eligibleEntries: baselineRows.length,
    comparedEntries: pairs.length,
    currentPnlSol: num(currentPnlSol, 9),
    trailingPnlSol: num(trailingPnlSol, 9),
    deltaPnlSol: pairs.length ? num(trailingPnlSol - currentPnlSol, 9) : null,
    improvedVsCurrent: improved,
    worsenedVsCurrent: worsened,
    unchangedVsCurrent: unchanged,
    trailingWins,
    trailingLosses,
    trailingWinRate: trailingWins + trailingLosses > 0 ? num(trailingWins / (trailingWins + trailingLosses), 4) : null,
    currentExitReasonCounts: countBy(currentValidRows, (row) => row.reason),
    trailingExitReasonCounts: countBy(trailingValidRows, (row) => row.reason),
    currentReturnPct: stats(currentValidRows.map((row) => row.returnPct), 6),
    trailingReturnPct: stats(trailingValidRows.map((row) => row.returnPct), 6),
    deltaPnlSolStats: stats(pairs.map((pair) => pair.deltaPnlSol), 9),
    peakReturnPct: stats(currentValidRows.map((row) => row.peakReturnPct), 6),
    examples: pairs
      .slice()
      .sort((a, b) => Number(b.deltaPnlSol) - Number(a.deltaPnlSol))
      .slice(0, 8)
      .map((pair) => ({
        telemetryPath: pair.current.telemetryPath,
        mint: pair.current.mint,
        symbol: pair.current.symbol,
        entryAt: pair.current.entryAt,
        peakReturnPct: pair.current.peakReturnPct,
        currentReason: pair.current.reason,
        currentPnlSol: pair.current.pnlSol,
        trailingReason: pair.trailing.reason,
        trailingPnlSol: pair.trailing.pnlSol,
        deltaPnlSol: pair.deltaPnlSol
      }))
  };
}

function analyze(files) {
  const entries = files.flatMap((file) => file.entries);
  const rowsByScenario = {};
  for (const scenario of SCENARIOS) rowsByScenario[scenario.name] = [];

  for (const file of files) {
    for (const entry of file.entries) {
      const samples = file.samplesByMint.get(entry.mint) || [];
      for (const scenario of SCENARIOS) {
        rowsByScenario[scenario.name].push(replayEntry(entry, samples, scenario));
      }
    }
  }

  const currentRows = rowsByScenario.current_profile || [];
  const summaries = SCENARIOS.map((scenario) => ({
    ...summarizeScenario(scenario.name, rowsByScenario[scenario.name] || [], currentRows),
    description: scenario.description,
    overrides: scenario.overrides || null
  })).sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0));

  const best = summaries[0] || null;
  const current = summaries.find((row) => row.name === 'current_profile') || null;
  const trailingGivebackMfe8Validation = summarizeTrailingGivebackMfe8Validation(
    currentRows,
    rowsByScenario.trailing_giveback_8pct || []
  );
  const bestRows = best ? rowsByScenario[best.name] || [] : [];
  const currentByKey = new Map(currentRows.map((row) => [entryKey(row), row]));
  const bestDeltas = bestRows
    .map((row) => {
      const currentRow = currentByKey.get(entryKey(row));
      const delta = Number(row.pnlSol) - Number(currentRow?.pnlSol);
      return {
        ...row,
        current: currentRow ? {
          reason: currentRow.reason,
          pnlSol: currentRow.pnlSol,
          returnPct: currentRow.returnPct,
          holdSeconds: currentRow.holdSeconds,
          peakReturnPct: currentRow.peakReturnPct,
          givebackPct: currentRow.givebackPct
        } : null,
        pnlDeltaVsCurrentSol: Number.isFinite(delta) ? num(delta, 9) : null
      };
    })
    .filter((row) => Number.isFinite(Number(row.pnlDeltaVsCurrentSol)))
    .sort((a, b) => Number(b.pnlDeltaVsCurrentSol) - Number(a.pnlDeltaVsCurrentSol));

  return {
    entries,
    rowsByScenario,
    summary: {
      telemetryFiles: files.length,
      telemetryEvents: files.reduce((sum, file) => sum + file.eventCount, 0),
      malformedLines: files.reduce((sum, file) => sum + file.malformedLines, 0),
      entries: entries.length,
      uniqueMints: new Set(entries.map((entry) => entry.mint)).size,
      currentProfilePnlSol: current?.totalPnlSol ?? null,
      bestScenario: best?.name || null,
      bestScenarioPnlSol: best?.totalPnlSol ?? null,
      bestScenarioDeltaVsCurrentSol: best && current ? num(Number(best.totalPnlSol || 0) - Number(current.totalPnlSol || 0), 9) : null
    },
    scenarioSummaries: summaries,
    trailingGivebackMfe8Validation,
    bestScenarioExamples: bestDeltas.slice(0, 12),
    worstScenarioExamples: bestDeltas.slice().reverse().slice(0, 12)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicitTelemetry = args.telemetry ? [repoPath(args.telemetry)] : [];
  const paths = explicitTelemetry.length
    ? explicitTelemetry
    : telemetryFiles(Number(args.maxFiles || DEFAULT_MAX_FILES));
  const files = [];
  for (const filePath of paths) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    files.push(await readTelemetry(filePath));
  }
  const analyzed = analyze(files);
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_migration_exit_protection_replay',
    note: 'Replays alternative pre-migration paper exit-protection profiles over actual paper entries and observed price-bearing events. This is an observed-path stress replay, not exact runtime-cadence proof. Does not change runtime exits, entries, live broadcast, or thresholds.',
    inputs: {
      telemetryFiles: paths.map((filePath) => path.relative(ROOT, filePath)),
      scenarios: SCENARIOS
    },
    summary: analyzed.summary,
    scenarioSummaries: analyzed.scenarioSummaries,
    trailingGivebackMfe8Validation: analyzed.trailingGivebackMfe8Validation,
    bestScenarioExamples: analyzed.bestScenarioExamples,
    worstScenarioExamples: analyzed.worstScenarioExamples
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(JSON.stringify(output.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
