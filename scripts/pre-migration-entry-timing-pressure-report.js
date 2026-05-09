const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY_LOSS_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-loss-attribution-latest.json');
const PAPER_SIM_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-paper-sim-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-timing-pressure-latest.json');
const FRESH_CURVE_UPDATE_SECONDS = 15;
const RECENT_INFRA_WINDOW_SECONDS = 60;
const FAST_STOPOUT_SECONDS = 30;

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

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function secondsBetween(a, b) {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return compact((left - right) / 1000, 2);
}

function signClass(value) {
  const parsed = num(value, 0);
  if (parsed > 0) return 'win';
  if (parsed < 0) return 'loss';
  return 'flat';
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function eventTimestampMs(event) {
  const parsed = Date.parse(event?.timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function payloadOf(event) {
  return event?.payload || event?.data || {};
}

function mintOf(payload) {
  return payload?.mint || payload?.token || payload?.mintAddress || null;
}

function readTelemetryContext(telemetryPath) {
  const resolvedPath = resolveRepoPath(telemetryPath);
  const context = {
    telemetryPath: telemetryPath ? rel(resolvedPath) : null,
    ok: false,
    error: null,
    curveUpdatesByMint: new Map(),
    globalBackoffActivations: [],
    pumpPortalDisconnects: []
  };

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    context.error = 'telemetry file missing';
    return context;
  }

  const backoffSeen = new Set();
  const disconnectSeen = new Set();

  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_) {
        continue;
      }

      const atMs = eventTimestampMs(event);
      if (!Number.isFinite(atMs)) continue;
      const payload = payloadOf(event);

      if (event.type === 'pump_bonding_curve.updated') {
        const mint = mintOf(payload);
        if (mint) {
          if (!context.curveUpdatesByMint.has(mint)) context.curveUpdatesByMint.set(mint, []);
          context.curveUpdatesByMint.get(mint).push({
            timestamp: event.timestamp,
            timestampMs: atMs,
            accountFound: payload.accountFound === true,
            curveProgress: compact(payload.curveProgress, 6),
            bondingCurvePriceSol: compact(payload.bondingCurvePriceSol, 12)
          });
        }
      }

      const stats = payload.stats || null;
      const lane = stats?.pumpBondingCurveLane || null;
      if (lane?.lastGlobalBackoffActivatedAt && !backoffSeen.has(lane.lastGlobalBackoffActivatedAt)) {
        const backoffMs = Date.parse(lane.lastGlobalBackoffActivatedAt);
        if (Number.isFinite(backoffMs)) {
          backoffSeen.add(lane.lastGlobalBackoffActivatedAt);
          context.globalBackoffActivations.push({
            timestamp: lane.lastGlobalBackoffActivatedAt,
            timestampMs: backoffMs,
            errorsInWindow: nullableNum(lane.lastGlobalBackoffErrorsInWindow),
            windowMs: nullableNum(lane.lastGlobalBackoffWindowMs)
          });
        }
      }

      const lastDisconnectedAt = stats?.pumpPortal?.lastDisconnectedAt;
      if (Number.isFinite(Number(lastDisconnectedAt)) && Number(lastDisconnectedAt) > 0) {
        const disconnectMs = Number(lastDisconnectedAt);
        const key = String(disconnectMs);
        if (!disconnectSeen.has(key)) {
          disconnectSeen.add(key);
          context.pumpPortalDisconnects.push({
            timestamp: new Date(disconnectMs).toISOString(),
            timestampMs: disconnectMs
          });
        }
      }
    }
  } catch (error) {
    context.error = error.message;
    return context;
  }

  for (const updates of context.curveUpdatesByMint.values()) {
    updates.sort((a, b) => a.timestampMs - b.timestampMs);
  }
  context.globalBackoffActivations.sort((a, b) => a.timestampMs - b.timestampMs);
  context.pumpPortalDisconnects.sort((a, b) => a.timestampMs - b.timestampMs);
  context.ok = true;
  return context;
}

function nearestPrior(rows, atMs, windowSeconds = Infinity) {
  let best = null;
  const windowMs = Number.isFinite(windowSeconds) ? windowSeconds * 1000 : Infinity;
  for (const row of rows || []) {
    if (!Number.isFinite(row.timestampMs) || row.timestampMs > atMs) continue;
    const ageMs = atMs - row.timestampMs;
    if (ageMs > windowMs) continue;
    if (!best || row.timestampMs > best.timestampMs) best = row;
  }
  return best;
}

function buildFreshness(actual, telemetryContext) {
  const entryAtMs = Date.parse(actual.entryAt);
  const mint = actual.mint || null;
  const curveUpdates = mint ? telemetryContext.curveUpdatesByMint.get(mint) || [] : [];
  const lastCurveUpdate = Number.isFinite(entryAtMs)
    ? nearestPrior(curveUpdates, entryAtMs)
    : null;
  const lastBackoff = Number.isFinite(entryAtMs)
    ? nearestPrior(telemetryContext.globalBackoffActivations, entryAtMs, 120)
    : null;
  const lastDisconnect = Number.isFinite(entryAtMs)
    ? nearestPrior(telemetryContext.pumpPortalDisconnects, entryAtMs, 120)
    : null;
  const curveUpdateAgeSeconds = lastCurveUpdate ? compact((entryAtMs - lastCurveUpdate.timestampMs) / 1000, 2) : null;
  const secondsSinceBackoff = lastBackoff ? compact((entryAtMs - lastBackoff.timestampMs) / 1000, 2) : null;
  const secondsSincePumpPortalDisconnect = lastDisconnect ? compact((entryAtMs - lastDisconnect.timestampMs) / 1000, 2) : null;
  const holdSeconds = nullableNum(actual.holdSeconds);
  const exitReason = actual.exitReason || null;

  return {
    lastCurveUpdateAt: lastCurveUpdate?.timestamp || null,
    curveUpdateAgeSeconds,
    curveUpdateFresh: curveUpdateAgeSeconds !== null && curveUpdateAgeSeconds <= FRESH_CURVE_UPDATE_SECONDS,
    lastCurveAccountFound: lastCurveUpdate?.accountFound ?? null,
    lastCurveProgress: lastCurveUpdate?.curveProgress ?? null,
    recentBondingBackoffAt: lastBackoff?.timestamp || null,
    secondsSinceBondingBackoff: secondsSinceBackoff,
    bondingBackoffWithin60s: secondsSinceBackoff !== null && secondsSinceBackoff <= RECENT_INFRA_WINDOW_SECONDS,
    recentPumpPortalDisconnectAt: lastDisconnect?.timestamp || null,
    secondsSincePumpPortalDisconnect,
    pumpPortalDisconnectWithin60s: secondsSincePumpPortalDisconnect !== null && secondsSincePumpPortalDisconnect <= RECENT_INFRA_WINDOW_SECONDS,
    fastStopout: exitReason === 'STOP_LOSS' && holdSeconds !== null && holdSeconds <= FAST_STOPOUT_SECONDS
  };
}

function groupCount(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function pnlBucketSummary(rows) {
  const entries = rows.length;
  const wins = rows.filter((row) => row.actual.pnlClass === 'win').length;
  const losses = rows.filter((row) => row.actual.pnlClass === 'loss').length;
  const flats = rows.filter((row) => row.actual.pnlClass === 'flat').length;
  const totalPnlSol = compact(rows.reduce((sum, row) => sum + num(row.actual.pnlSol, 0), 0), 6);
  const matchedRows = rows.filter((row) => row.sim);
  const totalActualMinusSimPnlSol = compact(
    matchedRows.reduce((sum, row) => sum + num(row.comparison.deltaPnlSol, 0), 0),
    6
  );

  return {
    entries,
    wins,
    losses,
    flats,
    winRate: wins + losses > 0 ? compact(wins / (wins + losses), 4) : null,
    totalPnlSol,
    averagePnlSol: entries ? compact(num(totalPnlSol, 0) / entries, 6) : null,
    stopLosses: rows.filter((row) => row.actual.exitReason === 'STOP_LOSS').length,
    sellPressureFlips: rows.filter((row) => row.actual.exitReason === 'SELL_PRESSURE_FLIP').length,
    curveStalls: rows.filter((row) => row.actual.exitReason === 'CURVE_STALL').length,
    takeProfits: rows.filter((row) => row.actual.exitReason === 'TAKE_PROFIT').length,
    staleCurveUpdates: rows.filter((row) => row.freshness.curveUpdateAgeSeconds !== null && row.freshness.curveUpdateAgeSeconds > FRESH_CURVE_UPDATE_SECONDS).length,
    freshCurveUpdates: rows.filter((row) => row.freshness.curveUpdateFresh).length,
    recentBondingBackoff: rows.filter((row) => row.freshness.bondingBackoffWithin60s).length,
    recentPumpPortalDisconnect: rows.filter((row) => row.freshness.pumpPortalDisconnectWithin60s).length,
    actualOutperformedSim: matchedRows.filter((row) => num(row.comparison.deltaPnlSol, 0) > 0).length,
    simOutperformedActual: matchedRows.filter((row) => num(row.comparison.deltaPnlSol, 0) < 0).length,
    totalActualMinusSimPnlSol
  };
}

function summarizeBuckets(rows, keyFn) {
  const groups = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return Object.fromEntries(
    Object.entries(groups)
      .map(([key, members]) => [key, pnlBucketSummary(members)])
      .sort((a, b) => num(a[1].totalPnlSol, 0) - num(b[1].totalPnlSol, 0))
  );
}

function volumeBucket(value) {
  const volume = nullableNum(value);
  if (volume === null) return 'volume_unknown';
  if (volume < 10) return 'volume_under_10';
  if (volume < 25) return 'volume_10_25';
  if (volume < 50) return 'volume_25_50';
  if (volume < 100) return 'volume_50_100';
  return 'volume_100_plus';
}

function velocityBucket(value) {
  const velocity = nullableNum(value);
  if (velocity === null) return 'velocity_unknown';
  if (velocity < 15) return 'velocity_under_15';
  if (velocity < 25) return 'velocity_15_25';
  if (velocity < 50) return 'velocity_25_50';
  if (velocity < 100) return 'velocity_50_100';
  return 'velocity_100_plus';
}

function curveFreshnessBucket(row) {
  const age = nullableNum(row.freshness.curveUpdateAgeSeconds);
  if (age === null) return 'curve_update_unknown';
  if (age <= FRESH_CURVE_UPDATE_SECONDS) return 'curve_update_fresh';
  if (age <= 60) return 'curve_update_15_60s';
  if (age <= 120) return 'curve_update_60_120s';
  return 'curve_update_over_120s';
}

function firstSightQualityBucket(row) {
  const volume = nullableNum(row.actual.entryRecentVolumeSol);
  const velocity = nullableNum(row.actual.entryTradeVelocityPerMin);
  const stale = row.freshness.curveUpdateAgeSeconds !== null
    && row.freshness.curveUpdateAgeSeconds > FRESH_CURVE_UPDATE_SECONDS;
  const weakVolume = volume !== null && volume < 25;
  const weakVelocity = velocity !== null && velocity < 25;
  if (stale && (weakVolume || weakVelocity)) return 'stale_and_weak_flow';
  if (stale) return 'stale_curve_only';
  if (weakVolume || weakVelocity) return 'fresh_but_weak_flow';
  return 'fresh_or_strong_flow';
}

function highCurvePressureBucket(row) {
  const stale = row.freshness.curveUpdateAgeSeconds !== null
    && row.freshness.curveUpdateAgeSeconds > FRESH_CURVE_UPDATE_SECONDS;
  if (row.freshness.bondingBackoffWithin60s) return 'recent_bonding_backoff';
  if (row.freshness.pumpPortalDisconnectWithin60s) return 'recent_pumpportal_disconnect';
  if (stale) return 'stale_curve_update';
  return 'fresh_curve_update';
}

function summarizeFirstSightCohorts(rows) {
  const firstSightRows = rows.filter((row) => row.guardOverride === 'FIRST_CURVE_SNAPSHOT_SCALP');
  return {
    mode: 'report_only',
    entries: firstSightRows.length,
    byQualityBucket: summarizeBuckets(firstSightRows, firstSightQualityBucket),
    byCurveFreshness: summarizeBuckets(firstSightRows, curveFreshnessBucket),
    byVolumeBucket: summarizeBuckets(firstSightRows, (row) => volumeBucket(row.actual.entryRecentVolumeSol)),
    byVelocityBucket: summarizeBuckets(firstSightRows, (row) => velocityBucket(row.actual.entryTradeVelocityPerMin)),
    byCurveBand: summarizeBuckets(firstSightRows, (row) => row.curveBand),
    byExitReason: summarizeBuckets(firstSightRows, (row) => row.actual.exitReason || 'OPEN'),
    topLosingFirstSightRows: firstSightRows
      .slice()
      .sort((a, b) => num(a.actual.pnlSol, 0) - num(b.actual.pnlSol, 0))
      .slice(0, 8)
      .map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        curveBand: row.curveBand,
        qualityBucket: firstSightQualityBucket(row),
        entryRecentVolumeSol: row.actual.entryRecentVolumeSol,
        entryTradeVelocityPerMin: row.actual.entryTradeVelocityPerMin,
        curveUpdateAgeSeconds: row.freshness.curveUpdateAgeSeconds,
        exitReason: row.actual.exitReason,
        pnlSol: row.actual.pnlSol,
        deltaPnlSol: row.comparison.deltaPnlSol
      })),
    note: 'Report-only first-sight scalp cohort split. This does not change thresholds, gates, entries, exits, scoring, AI review, quotes, or live behavior.'
  };
}

function summarizeHighCurveCohorts(rows) {
  const highCurveRows = rows.filter((row) => num(row.actual.entryCurveProgress, 0) >= 0.9);
  return {
    mode: 'report_only',
    entries: highCurveRows.length,
    byPressureBucket: summarizeBuckets(highCurveRows, highCurvePressureBucket),
    byCurveFreshness: summarizeBuckets(highCurveRows, curveFreshnessBucket),
    byGuardOverride: summarizeBuckets(highCurveRows, (row) => row.guardOverride || 'none'),
    byPreset: summarizeBuckets(highCurveRows, (row) => row.preset || 'UNKNOWN'),
    byCurveBand: summarizeBuckets(highCurveRows, (row) => row.curveBand),
    byExitReason: summarizeBuckets(highCurveRows, (row) => row.actual.exitReason || 'OPEN'),
    topLosingHighCurveRows: highCurveRows
      .slice()
      .sort((a, b) => num(a.actual.pnlSol, 0) - num(b.actual.pnlSol, 0))
      .slice(0, 8)
      .map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        preset: row.preset,
        guardOverride: row.guardOverride,
        curveBand: row.curveBand,
        pressureBucket: highCurvePressureBucket(row),
        entryScore: row.actual.entryScore,
        entryCurveProgress: row.actual.entryCurveProgress,
        curveUpdateAgeSeconds: row.freshness.curveUpdateAgeSeconds,
        recentBondingBackoff: row.freshness.bondingBackoffWithin60s,
        recentPumpPortalDisconnect: row.freshness.pumpPortalDisconnectWithin60s,
        exitReason: row.actual.exitReason,
        pnlSol: row.actual.pnlSol,
        deltaPnlSol: row.comparison.deltaPnlSol
      })),
    note: 'Report-only high-curve entry pressure split. This does not change thresholds, gates, entries, exits, scoring, AI review, quotes, or live behavior.'
  };
}

function simKey(sim) {
  return `${sim.mint}:${sim.entryAt}`;
}

function chooseNearestSim(actual, simByMint, usedSimKeys) {
  const candidates = simByMint.get(actual.mint) || [];
  const unused = candidates.filter((sim) => !usedSimKeys.has(simKey(sim)));
  if (!unused.length) return null;
  const actualAt = Date.parse(actual.entryAt);
  if (!Number.isFinite(actualAt)) return unused[0];
  return unused
    .map((sim) => ({ sim, distanceMs: Math.abs(Date.parse(sim.entryAt) - actualAt) }))
    .sort((a, b) => a.distanceMs - b.distanceMs)[0]?.sim || null;
}

function buildPressureFlags(actual, sim, deltaPnlSol, freshness = {}) {
  const flags = [];
  if (!sim) {
    flags.push('NO_SIM_MATCH');
    return flags;
  }

  const actualPnl = num(actual.pnlSol, 0);
  const simPnl = num(sim.pnlSol, 0);
  const actualCurve = num(actual.entryCurveProgress, 0);
  const simMinReturn = nullableNum(sim.unrealizedMinReturnPct);
  const simMaxReturn = nullableNum(sim.unrealizedMaxReturnPct);

  if (deltaPnlSol !== null && deltaPnlSol >= 0.02) flags.push('ACTUAL_EXIT_OUTPERFORMED_SIM');
  if (deltaPnlSol !== null && deltaPnlSol <= -0.02) flags.push('SIM_OUTPERFORMED_ACTUAL');
  if (actualPnl > 0 && simPnl < 0) flags.push('ACTUAL_WIN_SIM_LOSS');
  if (actualPnl < 0 && simPnl > 0) flags.push('ACTUAL_LOSS_SIM_WIN');
  if (sim.exitReason === 'STOP_LOSS' && actual.exitReason !== 'STOP_LOSS') flags.push('SIM_HELD_TO_STOP');
  if (simMinReturn !== null && simMinReturn <= -0.25 && actualPnl >= 0) flags.push('ACTUAL_AVOIDED_DEEP_DRAWDOWN');
  if (simMaxReturn !== null && simMaxReturn >= 0.25 && sim.exitReason === 'STOP_LOSS') flags.push('SIM_GAVE_BACK_BIG_POP');
  if (actualCurve >= 0.9 && actualPnl <= 0) flags.push('HIGH_CURVE_ENTRY_PRESSURE');
  if (actual.exitReason === 'CURVE_STALL' || sim.exitReason === 'STOP_LOSS') flags.push('EXIT_PRESSURE');
  if (freshness.fastStopout) flags.push('FAST_STOPOUT');
  if (actual.guardOverride === 'FIRST_CURVE_SNAPSHOT_SCALP' && freshness.fastStopout) flags.push('FIRST_SIGHT_FAST_STOPOUT');
  if (freshness.curveUpdateAgeSeconds !== null && freshness.curveUpdateAgeSeconds > FRESH_CURVE_UPDATE_SECONDS) flags.push('STALE_BONDING_CURVE_UPDATE');
  if (freshness.bondingBackoffWithin60s) flags.push('RECENT_BONDING_BACKOFF');
  if (freshness.pumpPortalDisconnectWithin60s) flags.push('RECENT_PUMPPORTAL_DISCONNECT');

  return flags;
}

function compactRow(actual, sim, telemetryContext) {
  const actualPnl = nullableNum(actual.pnlSol);
  const simPnl = sim ? nullableNum(sim.pnlSol) : null;
  const deltaPnlSol = actualPnl !== null && simPnl !== null ? compact(actualPnl - simPnl, 6) : null;
  const freshness = buildFreshness(actual, telemetryContext);

  return {
    mint: actual.mint || null,
    symbol: actual.symbol || null,
    preset: actual.preset || null,
    curveBand: actual.curveBand || null,
    guardOverride: actual.guardOverride || null,
    actual: {
      entryAt: actual.entryAt || null,
      exitAt: actual.exitAt || null,
      entryScore: compact(actual.entryScore, 2),
      entryCurveProgress: compact(actual.entryCurveProgress, 6),
      entryRecentVolumeSol: compact(actual.entryRecentVolumeSol, 4),
      entryTradeVelocityPerMin: compact(actual.entryTradeVelocityPerMin, 2),
      exitReason: actual.exitReason || null,
      pnlSol: actualPnl,
      pnlClass: actual.pnlClass || signClass(actualPnl),
      holdSeconds: compact(actual.holdSeconds, 2),
      peakReturnPct: compact(actual.peakReturnPct, 6),
      maxCurveProgress: compact(actual.maxCurveProgress, 6)
    },
    sim: sim ? {
      entryAt: sim.entryAt || null,
      exitAt: sim.exitAt || null,
      entryTimeDeltaSeconds: secondsBetween(actual.entryAt, sim.entryAt),
      entryScore: compact(sim.entryScore, 2),
      entryCurveProgress: compact(sim.entryCurveProgress, 6),
      entryRecentVolumeSol: compact(sim.entryRecentVolumeSol, 4),
      entryTradeVelocityPerMin: compact(sim.entryTradeVelocityPerMin, 2),
      exitReason: sim.exitReason || null,
      pnlSol: simPnl,
      pnlClass: signClass(simPnl),
      holdSeconds: compact(sim.holdSeconds, 2),
      unrealizedMaxReturnPct: compact(sim.unrealizedMaxReturnPct, 6),
      unrealizedMinReturnPct: compact(sim.unrealizedMinReturnPct, 6),
      maxCurveProgress: compact(sim.maxCurveProgress, 6)
    } : null,
    comparison: {
      deltaPnlSol,
      actualBetter: deltaPnlSol === null ? null : deltaPnlSol > 0,
      actualExitReason: actual.exitReason || null,
      simExitReason: sim?.exitReason || null,
      pressureFlags: buildPressureFlags(actual, sim, deltaPnlSol, freshness)
    },
    freshness
  };
}

function summarizeFreshness(rows, telemetryContext) {
  const firstSightRows = rows.filter((row) => row.guardOverride === 'FIRST_CURVE_SNAPSHOT_SCALP');
  const losses = firstSightRows.filter((row) => row.actual.pnlClass === 'loss');
  const totalPnl = firstSightRows.reduce((sum, row) => sum + num(row.actual.pnlSol, 0), 0);
  const curveAges = firstSightRows
    .map((row) => nullableNum(row.freshness.curveUpdateAgeSeconds))
    .filter((value) => value !== null);

  return {
    mode: 'report_only',
    telemetryRead: telemetryContext.ok,
    telemetryPath: telemetryContext.telemetryPath,
    totalEntries: rows.length,
    firstSightEntries: firstSightRows.length,
    firstSightLosses: losses.length,
    firstSightPnlSol: compact(totalPnl, 6),
    firstSightFastStopouts: firstSightRows.filter((row) => row.freshness.fastStopout).length,
    staleCurveUpdateEntries: firstSightRows.filter((row) => row.freshness.curveUpdateAgeSeconds !== null && row.freshness.curveUpdateAgeSeconds > FRESH_CURVE_UPDATE_SECONDS).length,
    recentBondingBackoffEntries: firstSightRows.filter((row) => row.freshness.bondingBackoffWithin60s).length,
    recentPumpPortalDisconnectEntries: firstSightRows.filter((row) => row.freshness.pumpPortalDisconnectWithin60s).length,
    averageCurveUpdateAgeSeconds: curveAges.length
      ? compact(curveAges.reduce((sum, value) => sum + value, 0) / curveAges.length, 2)
      : null,
    thresholds: {
      freshCurveUpdateSeconds: FRESH_CURVE_UPDATE_SECONDS,
      recentInfraWindowSeconds: RECENT_INFRA_WINDOW_SECONDS,
      fastStopoutSeconds: FAST_STOPOUT_SECONDS
    },
    interpretation: firstSightRows.length
      ? 'first-sight scalp entries are checked against curve-update freshness, recent bonding-curve backoff, PumpPortal disconnects, and fast stopouts; report-only, no gate changes'
      : 'no first-sight scalp entries were available for freshness analysis'
  };
}

function summarize(rows, unmatchedSimTrades, telemetryContext) {
  const matchedRows = rows.filter((row) => row.sim);
  const actualBetterRows = matchedRows.filter((row) => row.comparison.deltaPnlSol > 0);
  const simBetterRows = matchedRows.filter((row) => row.comparison.deltaPnlSol < 0);
  const actualWinSimLoss = matchedRows.filter((row) => row.comparison.pressureFlags.includes('ACTUAL_WIN_SIM_LOSS'));
  const simHeldToStop = matchedRows.filter((row) => row.comparison.pressureFlags.includes('SIM_HELD_TO_STOP'));
  const avoidedDeepDrawdown = matchedRows.filter((row) => row.comparison.pressureFlags.includes('ACTUAL_AVOIDED_DEEP_DRAWDOWN'));
  const highCurvePressure = rows.filter((row) => row.comparison.pressureFlags.includes('HIGH_CURVE_ENTRY_PRESSURE'));
  const totalDelta = matchedRows.reduce((sum, row) => sum + num(row.comparison.deltaPnlSol, 0), 0);

  return {
    actualEntries: rows.length,
    matchedActualToSim: matchedRows.length,
    unmatchedActualEntries: rows.length - matchedRows.length,
    unmatchedSimTrades: unmatchedSimTrades.length,
    actualBetterThanSim: actualBetterRows.length,
    simBetterThanActual: simBetterRows.length,
    actualWinSimLoss: actualWinSimLoss.length,
    simHeldToStop: simHeldToStop.length,
    actualAvoidedDeepDrawdown: avoidedDeepDrawdown.length,
    highCurveEntryPressure: highCurvePressure.length,
    firstSightScalpFreshness: summarizeFreshness(rows, telemetryContext),
    firstSightScalpCohorts: summarizeFirstSightCohorts(rows),
    highCurveEntryCohorts: summarizeHighCurveCohorts(rows),
    totalActualMinusSimPnlSol: compact(totalDelta, 6),
    averageActualMinusSimPnlSol: matchedRows.length ? compact(totalDelta / matchedRows.length, 6) : null,
    pressureFlagCounts: groupCount(
      rows.flatMap((row) => row.comparison.pressureFlags.map((flag) => ({ flag }))),
      (row) => row.flag
    ),
    byCurveBand: Object.fromEntries(
      Object.entries(groupCount(rows, (row) => row.curveBand)).sort((a, b) => b[1] - a[1])
    ),
    interpretation: rows.length
      ? 'actual pre-migration entries were compared with same-mint paper-sim trades to identify timing and exit-pressure differences; report-only, no gate changes'
      : 'no actual pre-migration entries were available to compare'
  };
}

function buildReport() {
  const entryLoss = readJson(ENTRY_LOSS_PATH, {});
  const paperSim = readJson(PAPER_SIM_PATH, {});
  const actualRows = Array.isArray(entryLoss.rows) ? entryLoss.rows : [];
  const simTrades = Array.isArray(paperSim.simulatedTrades) ? paperSim.simulatedTrades : [];
  const telemetryContext = readTelemetryContext(entryLoss.sources?.telemetryPath);
  const simByMint = new Map();

  for (const trade of simTrades) {
    const mint = trade.mint || null;
    if (!mint) continue;
    if (!simByMint.has(mint)) simByMint.set(mint, []);
    simByMint.get(mint).push(trade);
  }

  const matchedSimKeys = new Set();
  const rows = actualRows.map((actual) => {
    const sim = chooseNearestSim(actual, simByMint, matchedSimKeys);
    if (sim) matchedSimKeys.add(simKey(sim));
    return compactRow(actual, sim, telemetryContext);
  });

  const unmatchedSimTrades = simTrades
    .filter((trade) => !matchedSimKeys.has(simKey(trade)))
    .map((trade) => ({
      mint: trade.mint || null,
      symbol: trade.symbol || null,
      entryAt: trade.entryAt || null,
      entryScore: compact(trade.entryScore, 2),
      entryCurveProgress: compact(trade.entryCurveProgress, 6),
      exitReason: trade.exitReason || null,
      pnlSol: nullableNum(trade.pnlSol),
      holdSeconds: compact(trade.holdSeconds, 2),
      unrealizedMaxReturnPct: compact(trade.unrealizedMaxReturnPct, 6),
      unrealizedMinReturnPct: compact(trade.unrealizedMinReturnPct, 6)
    }));

  const pressureRows = rows
    .filter((row) => row.comparison.pressureFlags.length)
    .sort((a, b) => num(b.comparison.deltaPnlSol, -999) - num(a.comparison.deltaPnlSol, -999));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      entryLossAttributionPath: rel(ENTRY_LOSS_PATH),
      paperSimPath: rel(PAPER_SIM_PATH),
      telemetryPath: entryLoss.sources?.telemetryPath || null
    },
    runWindow: entryLoss.runWindow || paperSim.run || {},
    summary: summarize(rows, unmatchedSimTrades, telemetryContext),
    rows,
    topActualOutperformedSim: rows
      .filter((row) => row.comparison.deltaPnlSol !== null)
      .sort((a, b) => num(b.comparison.deltaPnlSol, 0) - num(a.comparison.deltaPnlSol, 0))
      .slice(0, 10),
    topSimOutperformedActual: rows
      .filter((row) => row.comparison.deltaPnlSol !== null)
      .sort((a, b) => num(a.comparison.deltaPnlSol, 0) - num(b.comparison.deltaPnlSol, 0))
      .slice(0, 10),
    pressureRows: pressureRows.slice(0, 15),
    unmatchedSimTrades,
    note: 'Report-only entry timing and exit-pressure comparison. Matches actual pre-migration paper entries to same-mint paper-sim trades and does not change presets, thresholds, entries, exits, scoring, AI review, quotes, or live behavior.'
  };
}

function main() {
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

main();
