const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DELAYED_ENTRY_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-delayed-entry-timing-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-delayed-entry-pressure-shadow-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
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
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function repoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function eventType(event) {
  return event.type || event.event || event.name || null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function timeMs(value) {
  const parsed = Date.parse(value || 0);
  return Number.isFinite(parsed) ? parsed : null;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function secondsBetween(start, end) {
  const left = timeMs(start);
  const right = timeMs(end);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return compact((right - left) / 1000, 3);
}

function priceOf(payload = {}) {
  const direct = asNumber(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const virtualSol = asNumber(payload.virtualSolReservesSol);
  const virtualTokens = asNumber(payload.virtualTokenReservesTokens);
  return Number.isFinite(virtualSol) && Number.isFinite(virtualTokens) && virtualTokens > 0
    ? virtualSol / virtualTokens
    : null;
}

function buyRatioOf(payload = {}) {
  const recentBuys = asNumber(payload.recentBuys);
  const recentSells = asNumber(payload.recentSells);
  if (!Number.isFinite(recentBuys) || !Number.isFinite(recentSells)) return null;
  const total = recentBuys + recentSells;
  return total > 0 ? recentBuys / total : null;
}

function sampleOf(event) {
  const payload = payloadOf(event);
  const priceSol = priceOf(payload);
  if (!Number.isFinite(priceSol) || priceSol <= 0) return null;
  return {
    timestamp: event.timestamp || null,
    type: eventType(event),
    priceSol,
    curveProgress: asNumber(payload.curveProgress),
    recentBuys: asNumber(payload.recentBuys),
    recentSells: asNumber(payload.recentSells),
    buyRatio: buyRatioOf(payload)
  };
}

function actualEntryForMint(events, mint, actualEntryAt) {
  const targetMs = timeMs(actualEntryAt);
  return events
    .filter((event) => eventType(event) === 'pre_migration_paper.entry' && mintOf(payloadOf(event)) === mint)
    .map((event) => ({ event, distanceMs: Math.abs(timeMs(payloadOf(event).entryAt || event.timestamp) - targetMs) }))
    .sort((a, b) => a.distanceMs - b.distanceMs)[0]?.event || null;
}

function samplesForMint(events, mint) {
  return events
    .filter((event) => mintOf(payloadOf(event)) === mint)
    .map(sampleOf)
    .filter(Boolean)
    .sort((a, b) => timeMs(a.timestamp) - timeMs(b.timestamp));
}

function replayExit(samples, anchorAt, strategy = {}, exitProfile = {}) {
  const anchorMs = timeMs(anchorAt);
  const entrySample = samples.find((sample) => timeMs(sample.timestamp) >= anchorMs);
  if (!entrySample) {
    return { class: 'PRICE_UNAVAILABLE', entryAt: anchorAt, entryPriceSol: null };
  }

  const entryCurveProgress = asNumber(entrySample.curveProgress);
  let maxCurveProgress = Number.isFinite(entryCurveProgress) ? entryCurveProgress : null;
  let maxPriceSol = entrySample.priceSol;
  let minPriceSol = entrySample.priceSol;
  let peakReturnPct = 0;
  const path = samples.filter((sample) => timeMs(sample.timestamp) >= timeMs(entrySample.timestamp));

  for (const sample of path) {
    maxPriceSol = Math.max(maxPriceSol, sample.priceSol);
    minPriceSol = Math.min(minPriceSol, sample.priceSol);
    if (Number.isFinite(sample.curveProgress)) {
      maxCurveProgress = Number.isFinite(maxCurveProgress)
        ? Math.max(maxCurveProgress, sample.curveProgress)
        : sample.curveProgress;
    }

    const returnPct = (sample.priceSol - entrySample.priceSol) / entrySample.priceSol;
    const holdSeconds = secondsBetween(entrySample.timestamp, sample.timestamp);
    peakReturnPct = Math.max(peakReturnPct, returnPct);

    if (
      exitProfile.breakevenStopEnabled
      && peakReturnPct >= Number(exitProfile.breakevenActivationPct)
      && returnPct <= Number(exitProfile.breakevenStopPct)
    ) {
      return closeReplay(entrySample, sample, strategy, 'BREAKEVEN_STOP', {
        entryCurveProgress,
        maxCurveProgress,
        maxPriceSol,
        minPriceSol,
        peakReturnPct
      });
    }

    if (
      exitProfile.sellPressureExitEnabled
      && Number.isFinite(holdSeconds)
      && holdSeconds >= Number(exitProfile.sellPressureMinHoldSeconds)
      && Number.isFinite(sample.buyRatio)
      && sample.buyRatio <= Number(exitProfile.sellPressureBuyRatioThreshold)
    ) {
      return closeReplay(entrySample, sample, strategy, 'SELL_PRESSURE_FLIP', {
        entryCurveProgress,
        maxCurveProgress,
        maxPriceSol,
        minPriceSol,
        peakReturnPct
      });
    }

    if (
      exitProfile.curveStallExitEnabled
      && Number.isFinite(holdSeconds)
      && holdSeconds >= Number(exitProfile.curveStallSeconds)
      && Number.isFinite(entryCurveProgress)
      && Number.isFinite(maxCurveProgress)
      && maxCurveProgress - entryCurveProgress < Number(exitProfile.curveStallMinProgressAdvance)
    ) {
      return closeReplay(entrySample, sample, strategy, 'CURVE_STALL', {
        entryCurveProgress,
        maxCurveProgress,
        maxPriceSol,
        minPriceSol,
        peakReturnPct
      });
    }

    if (returnPct >= Number(strategy.takeProfitPct)) {
      return closeReplay(entrySample, sample, strategy, 'TAKE_PROFIT', {
        entryCurveProgress,
        maxCurveProgress,
        maxPriceSol,
        minPriceSol,
        peakReturnPct
      });
    }

    if (returnPct <= -Number(strategy.stopLossPct)) {
      return closeReplay(entrySample, sample, strategy, 'STOP_LOSS', {
        entryCurveProgress,
        maxCurveProgress,
        maxPriceSol,
        minPriceSol,
        peakReturnPct
      });
    }

    if (Number.isFinite(holdSeconds) && holdSeconds >= Number(strategy.maxHoldSeconds)) {
      return closeReplay(entrySample, sample, strategy, 'TIME_LIMIT', {
        entryCurveProgress,
        maxCurveProgress,
        maxPriceSol,
        minPriceSol,
        peakReturnPct
      });
    }
  }

  const last = path[path.length - 1];
  return last
    ? closeReplay(entrySample, last, strategy, 'END_OF_RUN', {
      entryCurveProgress,
      maxCurveProgress,
      maxPriceSol,
      minPriceSol,
      peakReturnPct
    })
    : { class: 'PRICE_UNAVAILABLE', entryAt: anchorAt, entryPriceSol: null };
}

function closeReplay(entrySample, exitSample, strategy, exitReason, extra = {}) {
  const returnPct = (exitSample.priceSol - entrySample.priceSol) / entrySample.priceSol;
  const amountSol = Number(strategy.amountSol || 0.1);
  return {
    class: 'REPLAYED',
    entryAt: entrySample.timestamp,
    entryPriceSol: compact(entrySample.priceSol, 15),
    entryCurveProgress: compact(extra.entryCurveProgress, 6),
    exitAt: exitSample.timestamp,
    exitPriceSol: compact(exitSample.priceSol, 15),
    exitCurveProgress: compact(exitSample.curveProgress, 6),
    exitReason,
    holdSeconds: secondsBetween(entrySample.timestamp, exitSample.timestamp),
    returnPct: compact(returnPct, 6),
    pnlSol: compact(amountSol * returnPct, 9),
    maxCurveProgress: compact(extra.maxCurveProgress, 6),
    peakReturnPct: compact(extra.peakReturnPct, 6),
    maxPriceSol: compact(extra.maxPriceSol, 15),
    minPriceSol: compact(extra.minPriceSol, 15)
  };
}

function buildRows(delayedReport) {
  return (delayedReport.rows || []).map((row) => {
    const telemetryPath = repoPath(row.telemetryPath);
    const events = readJsonl(telemetryPath);
    const actualEntryEvent = actualEntryForMint(events, row.mint, row.actualEntryAt);
    const actualPayload = payloadOf(actualEntryEvent || {});
    const strategy = actualPayload.strategy || {};
    const exitProfile = actualPayload.exitProfile || {};
    const samples = samplesForMint(events, row.mint);
    const firstRecheckAt = row.decisionsDuringDelay?.[0]?.timestamp || null;
    const anchors = {
      simEntry: row.simEntryAt,
      firstRecheck: firstRecheckAt,
      actualEntry: row.actualEntryAt
    };
    const replays = Object.fromEntries(
      Object.entries(anchors).map(([key, timestamp]) => [key, timestamp ? replayExit(samples, timestamp, strategy, exitProfile) : null])
    );
    return {
      telemetryPath: row.telemetryPath,
      runId: row.runId,
      mint: row.mint,
      symbol: row.symbol,
      actualPreset: actualPayload.preset || null,
      runtimeDelaySeconds: row.runtimeDelaySeconds,
      actualExitReason: row.actualExitReason,
      actualPnlSol: row.actualPnlSol,
      strategy,
      exitProfile,
      anchors,
      replays,
      actualMinusSimEntryReplayPnlSol: replays.simEntry?.pnlSol !== null && replays.simEntry?.pnlSol !== undefined
        ? compact(Number(row.actualPnlSol || 0) - Number(replays.simEntry.pnlSol || 0), 9)
        : null,
      actualMinusFirstRecheckReplayPnlSol: replays.firstRecheck?.pnlSol !== null && replays.firstRecheck?.pnlSol !== undefined
        ? compact(Number(row.actualPnlSol || 0) - Number(replays.firstRecheck.pnlSol || 0), 9)
        : null
    };
  });
}

function summarizePnl(rows, selector) {
  const values = rows.map(selector).filter((value) => Number.isFinite(Number(value)));
  const wins = values.filter((value) => Number(value) > 0).length;
  const losses = values.filter((value) => Number(value) < 0).length;
  const totalPnlSol = values.reduce((sum, value) => sum + Number(value), 0);
  return {
    rows: values.length,
    wins,
    losses,
    winRate: values.length ? compact(wins / values.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    averagePnlSol: values.length ? compact(totalPnlSol / values.length, 9) : null
  };
}

function buildReport() {
  const delayedReport = readJson(DELAYED_ENTRY_PATH);
  const rows = buildRows(delayedReport);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      delayedEntryTimingPath: rel(DELAYED_ENTRY_PATH),
      delayedRows: delayedReport.rows?.length || 0
    },
    summary: {
      delayedRows: rows.length,
      actualPnl: summarizePnl(rows, (row) => row.actualPnlSol),
      simEntryReplayPnl: summarizePnl(rows, (row) => row.replays.simEntry?.pnlSol),
      firstRecheckReplayPnl: summarizePnl(rows, (row) => row.replays.firstRecheck?.pnlSol),
      actualEntryReplayPnl: summarizePnl(rows, (row) => row.replays.actualEntry?.pnlSol),
      actualMinusSimEntryReplayPnlSol: compact(rows.reduce((sum, row) => sum + Number(row.actualMinusSimEntryReplayPnlSol || 0), 0), 9),
      actualMinusFirstRecheckReplayPnlSol: compact(rows.reduce((sum, row) => sum + Number(row.actualMinusFirstRecheckReplayPnlSol || 0), 0), 9)
    },
    rows,
    note: 'Report-only delayed-entry pressure shadow. Replays the actual runtime preset strategy and exit profile from earlier anchors on the same telemetry path to separate loose-sim bias from delayed-entry timing. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(`Wrote delayed-entry pressure shadow report: ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  buildRows,
  replayExit
};
