const fs = require('fs');
const path = require('path');

const {
  DEFAULT_STRATEGY,
  buildReport: buildPaperSimReport,
  compact,
  readJsonl
} = require('./pre-migration-paper-sim-report');

const ROOT = path.join(__dirname, '..');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-parity-latest.json');
const TARGETED_PARITY_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-targeted-curve-parity-latest.json');
// Entry matching is intentionally tight; wider same-mint delay analysis is reported separately.
const NEARBY_DECISION_WINDOW_MS = 5000;
const LIVE_READINESS_MATCH_WINDOW_MS = 30000;
const LIVE_READINESS_MAX_CURVE_DELTA = 0.05;

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function rel(filePath) {
  return filePath ? path.relative(ROOT, filePath).replace(/\\/g, '/') : null;
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

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function secondsBetween(start, end) {
  const left = timeMs(start);
  const right = timeMs(end);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return compact((right - left) / 1000, 3);
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function summarizePnl(rows, key = 'pnlSol') {
  const closed = rows.filter((row) => Number.isFinite(Number(row[key])));
  const wins = closed.filter((row) => Number(row[key]) > 0);
  const losses = closed.filter((row) => Number(row[key]) < 0);
  const totalPnlSol = closed.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  return {
    rows: rows.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? compact(wins.length / closed.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    averagePnlSol: closed.length ? compact(totalPnlSol / closed.length, 9) : null
  };
}

function compactActualEntry(event, exitsByKey) {
  const payload = payloadOf(event);
  const positionKey = payload.positionKey || `${payload.preset || payload.presetName || 'unknown'}:${mintOf(payload) || 'unknown'}:${payload.entryAt || event.timestamp || 'unknown'}`;
  const exitPayload = exitsByKey.get(positionKey) || {};
  return {
    positionKey,
    mint: mintOf(payload),
    symbol: payload.symbol || null,
    preset: payload.preset || payload.presetName || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    entryAt: payload.entryAt || event.timestamp || null,
    entryScore: asNumber(payload.entryScore ?? payload.score),
    entryCurveProgress: asNumber(payload.entryCurveProgress ?? payload.curveProgress),
    entryRecentVolumeSol: asNumber(payload.recentVolumeSol ?? payload.entryRecentVolumeSol),
    entryTradeVelocityPerMin: asNumber(payload.tradeVelocityPerMin ?? payload.entryTradeVelocityPerMin),
    guardOverride: payload.guardOverride || null,
    entryReasons: Array.isArray(payload.reasons) ? payload.reasons : [],
    exitAt: exitPayload.exitAt || null,
    exitReason: exitPayload.reason || null,
    pnlSol: asNumber(exitPayload.pnlSol)
  };
}

function collectActualEntries(events) {
  const exitsByKey = new Map();
  for (const event of events) {
    if (eventType(event) !== 'pre_migration_paper.exit') continue;
    const payload = payloadOf(event);
    const key = payload.positionKey || `${payload.preset || payload.presetName || 'unknown'}:${mintOf(payload) || 'unknown'}:${payload.entryAt || 'unknown'}`;
    exitsByKey.set(key, { ...payload, exitAt: payload.exitAt || event.timestamp || null });
  }

  return events
    .filter((event) => eventType(event) === 'pre_migration_paper.entry')
    .map((event) => compactActualEntry(event, exitsByKey))
    .sort((a, b) => timeMs(a.entryAt) - timeMs(b.entryAt));
}

function collectTargetedParityRows() {
  const report = readJson(TARGETED_PARITY_PATH, { rows: [] });
  return Array.isArray(report.rows) ? report.rows : [];
}

function classifyLiveReadiness(sample) {
  if (!sample) {
    return {
      liveReadiness: 'LIVE_BLOCKED_NO_ONCHAIN_SAMPLE',
      liveReadinessReason: 'No runtime targeted parity sample was found near the paper entry.'
    };
  }

  const error = String(sample.error || sample.lastErrorMessage || '');
  if (sample.timedOut === true || /timeout/i.test(error)) {
    return {
      liveReadiness: 'LIVE_BLOCKED_RPC_TIMEOUT',
      liveReadinessReason: error || 'On-chain verification timed out.'
    };
  }

  if (sample.invalidAccountData === true || sample.bondingCurveValidated === false && sample.bondingCurveValidationReason) {
    return {
      liveReadiness: 'LIVE_BLOCKED_INVALID_ACCOUNT',
      liveReadinessReason: sample.invalidAccountReason || sample.bondingCurveValidationReason || 'Bonding curve account was not validated.'
    };
  }

  if (sample.accountFound !== true) {
    return {
      liveReadiness: 'LIVE_BLOCKED_ACCOUNT_NOT_FOUND',
      liveReadinessReason: 'On-chain bonding curve account was not found.'
    };
  }

  if (sample.onchainFresh !== true || sample.refreshed !== true) {
    return {
      liveReadiness: 'LIVE_BLOCKED_STALE_ONCHAIN_STATE',
      liveReadinessReason: 'On-chain sample was not fresh enough for live authority.'
    };
  }

  if (sample.bondingCurveValidated !== true) {
    return {
      liveReadiness: 'LIVE_BLOCKED_UNVALIDATED_ACCOUNT',
      liveReadinessReason: sample.bondingCurveValidationReason || 'Bonding curve owner/discriminator validation was unavailable.'
    };
  }

  const absCurveDelta = Number(sample.absCurveDelta);
  if (!Number.isFinite(absCurveDelta)) {
    return {
      liveReadiness: 'LIVE_BLOCKED_UNCOMPARABLE_ONCHAIN_STATE',
      liveReadinessReason: 'Fresh on-chain state was present but not comparable to provider state.'
    };
  }

  if (absCurveDelta > LIVE_READINESS_MAX_CURVE_DELTA) {
    return {
      liveReadiness: 'LIVE_BLOCKED_STATE_MISMATCH',
      liveReadinessReason: `Provider/on-chain curve delta ${compact(absCurveDelta, 6)} exceeded ${LIVE_READINESS_MAX_CURVE_DELTA}.`
    };
  }

  return {
    liveReadiness: 'LIVE_ELIGIBLE_ONCHAIN_CONFIRMED',
    liveReadinessReason: 'Fresh validated on-chain bonding curve state matched provider state.'
  };
}

function attachLiveReadiness(actualEntries, targetedRows) {
  const rowsByMint = new Map();
  for (const row of targetedRows) {
    if (!row?.mint) continue;
    const rows = rowsByMint.get(row.mint) || [];
    rows.push(row);
    rowsByMint.set(row.mint, rows);
  }

  for (const rows of rowsByMint.values()) {
    rows.sort((a, b) => timeMs(a.targetAt || a.scheduledAt || a.onchainFetchedAt) - timeMs(b.targetAt || b.scheduledAt || b.onchainFetchedAt));
  }

  return actualEntries.map((entry) => {
    const entryMs = timeMs(entry.entryAt);
    const candidates = (rowsByMint.get(entry.mint) || [])
      .map((sample) => {
        const sampleMs = timeMs(sample.targetAt || sample.scheduledAt || sample.onchainFetchedAt);
        return {
          sample,
          distanceMs: Number.isFinite(entryMs) && Number.isFinite(sampleMs)
            ? Math.abs(sampleMs - entryMs)
            : Infinity
        };
      })
      .filter((item) => item.distanceMs <= LIVE_READINESS_MATCH_WINDOW_MS)
      .sort((a, b) => a.distanceMs - b.distanceMs);
    const best = candidates[0]?.sample || null;
    const classification = classifyLiveReadiness(best);
    return {
      ...entry,
      ...classification,
      liveReadinessSample: best ? {
        targetAt: best.targetAt || null,
        runtimeTrigger: best.runtimeTrigger || null,
        runtimeDecision: best.runtimeDecision || null,
        providerCurveProgress: asNumber(best.providerCurveProgress),
        onchainCurveProgress: asNumber(best.onchainCurveProgress),
        absCurveDelta: asNumber(best.absCurveDelta),
        providerToOnchainAgeMs: asNumber(best.providerToOnchainAgeMs),
        onchainFetchLatencyMs: asNumber(best.onchainFetchLatencyMs ?? best.latencyMs),
        timedOut: best.timedOut === true,
        accountFound: best.accountFound === true,
        bondingCurveValidated: best.bondingCurveValidated === true,
        semanticDiagnosis: best.semanticDiagnosis || null,
        error: best.error || best.lastErrorMessage || null
      } : null
    };
  });
}

function collectDecisions(events) {
  const byMint = new Map();
  for (const event of events) {
    if (eventType(event) !== 'pre_migration_paper.decision') continue;
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    if (!mint) continue;
    const rows = byMint.get(mint) || [];
    rows.push({
      timestamp: event.timestamp || payload.timestamp || null,
      preset: payload.preset || null,
      decision: payload.decision || null,
      reason: payload.reason || null,
      shadowPresetWouldEnter: payload.shadowPresetWouldEnter ?? null,
      score: asNumber(payload.score),
      curveProgress: asNumber(payload.curveProgress)
    });
    byMint.set(mint, rows);
  }

  for (const rows of byMint.values()) {
    rows.sort((a, b) => timeMs(a.timestamp) - timeMs(b.timestamp));
  }
  return byMint;
}

function nearbyDecisions(decisionsByMint, mint, anchorAt) {
  const anchorMs = timeMs(anchorAt);
  if (!mint || !Number.isFinite(anchorMs)) return [];
  return (decisionsByMint.get(mint) || [])
    .filter((decision) => {
      const delta = timeMs(decision.timestamp) - anchorMs;
      return Number.isFinite(delta) && Math.abs(delta) <= NEARBY_DECISION_WINDOW_MS;
    })
    .map((decision) => ({
      ...decision,
      offsetSeconds: secondsBetween(anchorAt, decision.timestamp)
    }));
}

function matchRows(simulatedTrades, actualEntries) {
  const actualByMint = new Map();
  for (const row of actualEntries) {
    if (!actualByMint.has(row.mint)) actualByMint.set(row.mint, []);
    actualByMint.get(row.mint).push(row);
  }

  const matched = [];
  const simOnly = [];
  const matchedActualKeys = new Set();

  for (const sim of simulatedTrades) {
    const candidates = actualByMint.get(sim.mint) || [];
    const best = candidates
      .filter((actual) => !matchedActualKeys.has(actual.positionKey))
      .map((actual) => ({
        actual,
        distanceMs: Math.abs(timeMs(actual.entryAt) - timeMs(sim.entryAt))
      }))
      .sort((a, b) => a.distanceMs - b.distanceMs)[0];

    if (best && best.distanceMs <= NEARBY_DECISION_WINDOW_MS) {
      matchedActualKeys.add(best.actual.positionKey);
      matched.push({
        mint: sim.mint,
        symbol: sim.symbol || best.actual.symbol || null,
        simEntryAt: sim.entryAt,
        actualEntryAt: best.actual.entryAt,
        entryOffsetSeconds: secondsBetween(sim.entryAt, best.actual.entryAt),
        simExitReason: sim.exitReason || null,
        actualExitReason: best.actual.exitReason || null,
        simPnlSol: asNumber(sim.pnlSol),
        actualPnlSol: asNumber(best.actual.pnlSol),
        pnlDeltaSol: Number.isFinite(Number(sim.pnlSol)) && Number.isFinite(Number(best.actual.pnlSol))
          ? compact(Number(best.actual.pnlSol) - Number(sim.pnlSol), 9)
          : null,
        actualPreset: best.actual.preset,
        actualGuardOverride: best.actual.guardOverride,
        liveReadiness: best.actual.liveReadiness || null,
        liveReadinessReason: best.actual.liveReadinessReason || null,
        liveReadinessSample: best.actual.liveReadinessSample || null
      });
    } else {
      simOnly.push(sim);
    }
  }

  const actualOnly = actualEntries.filter((row) => !matchedActualKeys.has(row.positionKey));
  return { matched, simOnly, actualOnly };
}

function sameMintLaterEntries(simOnly, actualOnly) {
  const actualByMint = new Map();
  for (const row of actualOnly) {
    if (!row.mint) continue;
    const rows = actualByMint.get(row.mint) || [];
    rows.push(row);
    actualByMint.set(row.mint, rows);
  }

  return simOnly
    .map((sim) => {
      const simMs = timeMs(sim.entryAt);
      const laterActual = (actualByMint.get(sim.mint) || [])
        .filter((actual) => {
          const actualMs = timeMs(actual.entryAt);
          return Number.isFinite(simMs) && Number.isFinite(actualMs) && actualMs > simMs;
        })
        .sort((a, b) => timeMs(a.entryAt) - timeMs(b.entryAt))[0];
      if (!laterActual) return null;
      return {
        simKey: `${sim.mint || 'unknown'}:${sim.entryAt || 'unknown'}`,
        actualPositionKey: laterActual.positionKey || null,
        mint: sim.mint,
        symbol: sim.symbol || laterActual.symbol || null,
        simEntryAt: sim.entryAt,
        actualEntryAt: laterActual.entryAt,
        runtimeDelaySeconds: secondsBetween(sim.entryAt, laterActual.entryAt),
        simExitReason: sim.exitReason || null,
        actualExitReason: laterActual.exitReason || null,
        simPnlSol: asNumber(sim.pnlSol),
        actualPnlSol: asNumber(laterActual.pnlSol),
        pnlDeltaSol: Number.isFinite(Number(sim.pnlSol)) && Number.isFinite(Number(laterActual.pnlSol))
          ? compact(Number(laterActual.pnlSol) - Number(sim.pnlSol), 9)
          : null,
        actualPreset: laterActual.preset || null,
        liveReadiness: laterActual.liveReadiness || null,
        liveReadinessReason: laterActual.liveReadinessReason || null,
        liveReadinessSample: laterActual.liveReadinessSample || null
      };
    })
    .filter(Boolean);
}

function compactSimOnly(row, decisionsByMint) {
  const decisions = nearbyDecisions(decisionsByMint, row.mint, row.entryAt);
  return {
    mint: row.mint,
    symbol: row.symbol || null,
    simEntryAt: row.entryAt,
    simExitReason: row.exitReason || null,
    simPnlSol: asNumber(row.pnlSol),
    simEntryScore: asNumber(row.entryScore),
    simEntryCurveProgress: asNumber(row.entryCurveProgress),
    simEntryRecentVolumeSol: asNumber(row.entryRecentVolumeSol),
    simEntryTradeVelocityPerMin: asNumber(row.entryTradeVelocityPerMin),
    nearbyDecisionReasons: Array.from(new Set(decisions.map((decision) => decision.reason).filter(Boolean))).sort(),
    nearbyDecisionPresets: Array.from(new Set(decisions.map((decision) => decision.preset).filter(Boolean))).sort(),
    nearbyDecisions: decisions
  };
}

function compactActualOnly(row, decisionsByMint) {
  const decisions = nearbyDecisions(decisionsByMint, row.mint, row.entryAt);
  return {
    ...row,
    nearbyDecisionReasons: Array.from(new Set(decisions.map((decision) => decision.reason).filter(Boolean))).sort(),
    nearbyDecisionPresets: Array.from(new Set(decisions.map((decision) => decision.preset).filter(Boolean))).sort(),
    nearbyDecisions: decisions
  };
}

function buildReport() {
  const battlefield = readJson(BATTLEFIELD_PATH);
  const telemetryPath = battlefield.files?.telemetryPath || null;
  const events = telemetryPath ? readJsonl(telemetryPath) : [];
  const paperSim = telemetryPath
    ? buildPaperSimReport(events, telemetryPath, DEFAULT_STRATEGY)
    : { simulatedTrades: [], summary: {}, run: {}, actualPaperTelemetry: {} };
  const actualEntries = collectActualEntries(events);
  const actualEntriesWithReadiness = attachLiveReadiness(actualEntries, collectTargetedParityRows());
  const decisionsByMint = collectDecisions(events);
  const matched = matchRows(paperSim.simulatedTrades || [], actualEntriesWithReadiness);
  const laterRuntimeEntries = sameMintLaterEntries(matched.simOnly, matched.actualOnly);
  const delayedSimKeys = new Set(laterRuntimeEntries.map((row) => row.simKey));
  const delayedActualKeys = new Set(laterRuntimeEntries.map((row) => row.actualPositionKey).filter(Boolean));
  const trueSimOnly = matched.simOnly.filter((row) => !delayedSimKeys.has(`${row.mint || 'unknown'}:${row.entryAt || 'unknown'}`));
  const trueActualOnly = matched.actualOnly.filter((row) => !delayedActualKeys.has(row.positionKey));
  const simOnly = trueSimOnly.map((row) => compactSimOnly(row, decisionsByMint));
  const actualOnly = trueActualOnly.map((row) => compactActualOnly(row, decisionsByMint));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      battlefieldPath: rel(BATTLEFIELD_PATH),
      telemetryPath: rel(telemetryPath)
    },
    strategy: DEFAULT_STRATEGY,
    run: paperSim.run || {},
    summary: {
      simulatedEntries: paperSim.simulatedTrades?.length || 0,
      actualEntries: actualEntries.length,
      matchedEntries: matched.matched.length,
      delayedSameMintEntries: laterRuntimeEntries.length,
      simOnlyEntries: simOnly.length,
      actualOnlyEntries: actualOnly.length,
      sameMintLaterRuntimeEntries: laterRuntimeEntries.length,
      simulatedPnl: summarizePnl(paperSim.simulatedTrades || []),
      actualPnl: summarizePnl(actualEntries),
      matchedActualPnl: summarizePnl(matched.matched, 'actualPnlSol'),
      matchedSimPnl: summarizePnl(matched.matched, 'simPnlSol'),
      delayedActualPnl: summarizePnl(laterRuntimeEntries, 'actualPnlSol'),
      delayedSimPnl: summarizePnl(laterRuntimeEntries, 'simPnlSol'),
      simOnlyPnl: summarizePnl(simOnly, 'simPnlSol'),
      actualOnlyPnl: summarizePnl(actualOnly),
      simOnlyDecisionReasonCounts: countBy(
        simOnly.flatMap((row) => row.nearbyDecisionReasons.map((reason) => ({ reason }))),
        (row) => row.reason
      ),
      actualOnlyDecisionReasonCounts: countBy(
        actualOnly.flatMap((row) => row.nearbyDecisionReasons.map((reason) => ({ reason }))),
        (row) => row.reason
      ),
      liveReadinessCounts: countBy(actualEntriesWithReadiness, (row) => row.liveReadiness),
      interpretation: simOnly.length || actualOnly.length || laterRuntimeEntries.length
        ? 'same-run simulated and actual pre-migration books diverged; inspect delayed same-mint, sim-only, and actual-only rows before treating rolling sim findings as runtime behavior'
        : 'same-run simulated and actual pre-migration books matched for the latest telemetry'
    },
    matchedEntries: matched.matched,
    actualEntries: actualEntriesWithReadiness,
    simOnlyEntries: simOnly,
    actualOnlyEntries: actualOnly,
    sameMintLaterRuntimeEntries: laterRuntimeEntries,
    note: 'Report-only same-run pre-migration entry parity diagnostic. Compares simulated entries and actual pre_migration_paper.entry telemetry from the same run only. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
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
