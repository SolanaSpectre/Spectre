const fs = require('fs');
const path = require('path');
const { readJsonl } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const DEFAULT_CONTINUATION_PAPER_PATH = path.join(REPO_ROOT, 'data', 'reports', 'continuation-paper-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      if (!args.limit && /^\d+$/.test(arg)) {
        args.limit = arg;
      }
      continue;
    }

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

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function listJsonl(logDir, prefix) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return { name, fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function resolveLatest(logDir, prefix) {
  return listJsonl(logDir, prefix)[0]?.fullPath || null;
}

function resolveNearestDossier(logDir, telemetryPath) {
  const dossiers = listJsonl(logDir, 'candidate-dossiers-');
  if (!telemetryPath || dossiers.length === 0) return dossiers[0]?.fullPath || null;

  const telemetryStat = fs.statSync(telemetryPath);
  const telemetryStart = extractStampMs(path.basename(telemetryPath)) || telemetryStat.mtimeMs;
  return dossiers
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs((extractStampMs(candidate.name) || candidate.stat.mtimeMs) - telemetryStart)
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.fullPath || null;
}

function extractStampMs(fileName) {
  const match = fileName.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
  if (!match) return null;
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    'T$1:$2:$3.$4Z'
  );
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortCountObject(counts);
}

function sortCountObject(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function topEntries(counts, limit = 10) {
  return Object.fromEntries(Object.entries(counts || {}).slice(0, limit));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function numericStats(values, decimals = 2) {
  const finite = values
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!finite.length) {
    return { count: 0, min: null, median: null, p90: null, max: null };
  }

  const median = finite.length % 2
    ? finite[Math.floor(finite.length / 2)]
    : (finite[(finite.length / 2) - 1] + finite[finite.length / 2]) / 2;
  const p90 = finite[Math.min(finite.length - 1, Math.ceil(finite.length * 0.9) - 1)];

  return {
    count: finite.length,
    min: compact(finite[0], decimals),
    median: compact(median, decimals),
    p90: compact(p90, decimals),
    max: compact(finite[finite.length - 1], decimals)
  };
}

function pct(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : 'n/a';
}

function sol(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric >= 0 ? '+' : ''}${numeric.toFixed(4)} SOL` : 'n/a';
}

function usd(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'n/a';
  if (Math.abs(numeric) >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(2)}M`;
  if (Math.abs(numeric) >= 1_000) return `$${(numeric / 1_000).toFixed(1)}K`;
  return `$${numeric.toFixed(0)}`;
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return compact((end - start) / 1000, 2);
}

function firstLastTimestamps(events) {
  const timestamps = events
    .map((event) => event.timestamp)
    .filter(Boolean)
    .sort();

  return {
    first: timestamps[0] || null,
    last: timestamps[timestamps.length - 1] || null,
    durationSeconds: timestamps.length > 1 ? secondsBetween(timestamps[0], timestamps[timestamps.length - 1]) : null
  };
}

function buildSessionTiming(events, generatedAt) {
  const timeline = firstLastTimestamps(events);
  const started = events.find((event) => eventType(event) === 'session.started');
  const stopRequested = [...events].reverse().find((event) => eventType(event) === 'session.stop_requested');
  const stopping = [...events].reverse().find((event) => eventType(event) === 'session.stopping');
  const stopped = [...events].reverse().find((event) => eventType(event) === 'session.stopped');
  const startedAt = started?.timestamp || timeline.first || null;
  const stopObserved = stopped || stopping || stopRequested || null;
  const stoppedAt = stopped?.timestamp || null;
  const stopObservedAt = stopObserved?.timestamp || null;
  const configuredDurationMinutes = asNumber(payloadOf(started || {}).sessionDurationMinutes);
  const configuredDurationSeconds = configuredDurationMinutes === null ? null : compact(configuredDurationMinutes * 60, 2);
  const expectedEndAt = startedAt && configuredDurationMinutes !== null
    ? new Date(new Date(startedAt).getTime() + configuredDurationMinutes * 60 * 1000).toISOString()
    : null;
  const activeDurationSeconds = timeline.durationSeconds;
  const activeDurationMinutes = activeDurationSeconds === null ? null : compact(activeDurationSeconds / 60, 2);
  const observedWallDurationSeconds = startedAt && stopObservedAt
    ? secondsBetween(startedAt, stopObservedAt)
    : null;
  const observedWallDurationMinutes = observedWallDurationSeconds === null ? null : compact(observedWallDurationSeconds / 60, 2);
  const generatedLagSeconds = timeline.last && generatedAt
    ? secondsBetween(timeline.last, generatedAt)
    : null;
  const expectedQuietTailSeconds = expectedEndAt && timeline.last
    ? Math.max(0, secondsBetween(timeline.last, expectedEndAt) || 0)
    : null;

  return {
    firstEventAt: timeline.first,
    lastEventAt: timeline.last,
    activeDurationSeconds,
    activeDurationMinutes,
    // Backward-compatible alias: this is the event-active span, not configured session length.
    durationSeconds: activeDurationSeconds,
    durationMinutes: activeDurationMinutes,
    configuredDurationMinutes,
    configuredDurationSeconds,
    sessionStartedAt: startedAt,
    expectedEndAt,
    stoppedAt,
    stopObservedAt,
    stopStatus: stopped ? 'stopped' : stopping ? 'stopping_recorded' : stopRequested ? 'stop_requested' : null,
    stopReason: stopped ? payloadOf(stopped).reason || null : null,
    observedWallDurationSeconds,
    observedWallDurationMinutes,
    expectedQuietTailSeconds: expectedQuietTailSeconds === null ? null : compact(expectedQuietTailSeconds, 2),
    expectedQuietTailMinutes: expectedQuietTailSeconds === null ? null : compact(expectedQuietTailSeconds / 60, 2),
    generatedLagSeconds,
    generatedLagMinutes: generatedLagSeconds === null ? null : compact(generatedLagSeconds / 60, 2),
    timingNote: configuredDurationMinutes !== null
      ? 'durationMinutes is telemetry-active span; configuredDurationMinutes is requested session length.'
      : 'durationMinutes is telemetry-active span; configured session length was not found.'
  };
}

function summarizeSignal(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp,
    mint: payload.token || payload.mint || null,
    symbol: payload.symbol || null,
    source: payload.source || null,
    qualityScore: compact(payload.qualityScore, 4),
    momentumScore: compact(payload.momentumScore, 4),
    rankScore: compact(payload.rankScore, 4),
    amountSol: compact(payload.amountSol, 4),
    reason: payload.reason || null
  };
}

function summarizeTradeReject(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp || null,
    mint: payload.token || payload.mint || null,
    symbol: payload.symbol || null,
    source: payload.source || null,
    reason: payload.reason || null,
    qualityScore: compact(payload.qualityScore, 4),
    momentumScore: compact(payload.momentumScore, 4),
    rankScore: compact(payload.rankScore, 4),
    pumpFailureReason: payload.pumpFailureReason || null,
    pumpFailureValues: payload.pumpFailureValues || null,
    pumpFailureThreshold: payload.pumpFailureThreshold || null,
    priceImpactPct: compact(payload.priceImpactPct, 4)
  };
}

function summarizePaperEntry(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp,
    preset: payload.preset || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    mint: payload.mint || null,
    symbol: payload.symbol || null,
    score: compact(payload.score ?? payload.entryScore, 2),
    curveProgress: compact(payload.curveProgress ?? payload.entryCurveProgress, 6),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    entryPriceSol: compact(payload.entryPriceSol, 15),
    amountSol: compact(payload.amountSol, 4),
    walletClassificationContext: payload.walletClassificationContext || null
  };
}

function summarizeFirstCurveNearMiss(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp || payload.timestamp || null,
    mint: payload.mint || null,
    symbol: payload.symbol || null,
    score: compact(payload.score, 2),
    curveProgress: compact(payload.curveProgress, 6),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    interestSignalCount: payload.interestSignalCount ?? null,
    uniqueBuyerCount: payload.uniqueBuyerCount ?? null,
    riskWalletCount: payload.riskWalletCount ?? null,
    buyRatio: compact(payload.buyRatio, 4),
    hasPrice: payload.hasPrice ?? null,
    failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : []
  };
}

function summarizePaperExit(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp,
    preset: payload.preset || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    mint: payload.mint || null,
    symbol: payload.symbol || null,
    reason: payload.reason || null,
    returnPct: compact(payload.returnPct, 6),
    pnlSol: compact(payload.pnlSol, 9),
    holdSeconds: compact(payload.holdSeconds, 2),
    entryCurveProgress: compact(payload.entryCurveProgress, 6),
    exitCurveProgress: compact(payload.exitCurveProgress, 6),
    maxCurveProgress: compact(payload.maxCurveProgress, 6),
    peakReturnPct: compact(payload.peakReturnPct, 6),
    walletClassificationContext: payload.walletClassificationContext || null
  };
}

function addPnlGroup(groups, key, pnlSol) {
  const groupKey = key || 'unknown';
  if (!groups[groupKey]) {
    groups[groupKey] = { exits: 0, pnlSol: 0, wins: 0, losses: 0 };
  }
  groups[groupKey].exits += 1;
  groups[groupKey].pnlSol += pnlSol;
  if (pnlSol > 0) groups[groupKey].wins += 1;
  if (pnlSol < 0) groups[groupKey].losses += 1;
}

function compactPnlGroups(groups) {
  for (const group of Object.values(groups)) {
    group.pnlSol = compact(group.pnlSol, 9);
  }
  return groups;
}

function summarizeDossier(dossier) {
  return {
    timestamp: dossier.timestamp,
    source: dossier.source,
    eventType: dossier.eventType,
    mint: dossier.identity?.mint || null,
    symbol: dossier.identity?.symbol || null,
    verdict: dossier.gmgnStyle?.verdict || null,
    score: compact(dossier.gmgnStyle?.score, 2),
    curveProgress: compact(dossier.curve?.progress, 6),
    liquidityUsd: compact(dossier.market?.liquidityUsd, 2),
    volumeToLiquidity24h: compact(dossier.market?.volumeToLiquidity24h, 4),
    priceChange1hPct: compact(dossier.market?.priceChange1hPct, 2),
    priceChange6hPct: compact(dossier.market?.priceChange6hPct, 2),
    priceChange24hPct: compact(dossier.market?.priceChange24hPct, 2),
    tags: Array.isArray(dossier.gmgnStyle?.tags) ? dossier.gmgnStyle.tags.slice(0, 10) : []
  };
}

function groupLatestByMint(dossiers, predicate) {
  const latest = new Map();
  for (const dossier of dossiers) {
    if (!predicate(dossier)) continue;
    const mint = dossier.identity?.mint;
    if (!mint) continue;
    const current = latest.get(mint);
    if (!current || String(dossier.timestamp || '') > String(current.timestamp || '')) {
      latest.set(mint, dossier);
    }
  }

  return Array.from(latest.values());
}

function buildTopWatch(dossiers, limit) {
  return groupLatestByMint(
    dossiers,
    (dossier) => dossier.source === 'pre_migration_watch'
      && ['watch', 'high_conviction_watch'].includes(dossier.gmgnStyle?.verdict)
  )
    .sort((a, b) => Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0))
    .slice(0, limit)
    .map(summarizeDossier);
}

function buildTopMissedWatch(dossiers, paperEntries, limit) {
  const enteredMints = new Set(paperEntries.map((event) => payloadOf(event).mint).filter(Boolean));
  return groupLatestByMint(
    dossiers,
    (dossier) => dossier.source === 'pre_migration_watch'
      && ['watch', 'high_conviction_watch'].includes(dossier.gmgnStyle?.verdict)
      && !enteredMints.has(dossier.identity?.mint)
  )
    .sort((a, b) => Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0))
    .slice(0, limit)
    .map(summarizeDossier);
}

function buildContinuationHighlights(dossiers, verdict, limit) {
  return groupLatestByMint(
    dossiers,
    (dossier) => dossier.source === 'post_migration_continuation'
      && dossier.gmgnStyle?.verdict === verdict
  )
    .sort((a, b) => Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0))
    .slice(0, limit)
    .map(summarizeDossier);
}

function summarizePumpGateFailure(event) {
  const payload = payloadOf(event);
  const values = payload.values || {};
  return {
    timestamp: event.timestamp || null,
    mint: payload.token || payload.mint || null,
    reason: payload.reason || null,
    momentumScore: compact(payload.momentumScore, 4),
    threshold: payload.threshold ?? null,
    routeType: values.routeType || null,
    bondingStage: values.bondingStage || null,
    liquidityUsd: compact(values.liquidityUsd, 2)
  };
}

function buildScalperDiagnostics({ pumpFailures, tradeRejected, signalGenerated, signalExecuted }) {
  const pumpFailureCounts = countBy(pumpFailures, (event) => payloadOf(event).reason);
  const quoteRejects = tradeRejected.filter((event) => String(payloadOf(event).reason || '').includes('QUOTE'));
  const aiRejects = tradeRejected.filter((event) => String(payloadOf(event).reason || '').includes('AI_'));
  const notMigratedReasons = new Set(['PUMP_FAIL_NOT_MIGRATED', 'RUNNER_SCALPER_REQUIRES_MIGRATION']);
  const notMigratedRejects = pumpFailures.filter((event) => notMigratedReasons.has(payloadOf(event).reason));
  const migratedLiquidityRejects = pumpFailures.filter((event) => payloadOf(event).reason === 'PUMP_FAIL_MIGRATED_LIQUIDITY');
  const migratedCandidateRejects = pumpFailures.filter((event) => {
    const reason = payloadOf(event).reason;
    return reason && !notMigratedReasons.has(reason);
  });

  return {
    posture: signalExecuted.length > 0
      ? 'paper_executed'
      : (signalGenerated.length > 0 ? 'candidate_blocked_after_signal' : 'filtering_only'),
    generatedSignals: signalGenerated.length,
    executedSignals: signalExecuted.length,
    quoteRejects: quoteRejects.length,
    aiRejects: aiRejects.length,
    notMigratedRejects: notMigratedRejects.length,
    migratedLiquidityRejects: migratedLiquidityRejects.length,
    migratedCandidateRejects: migratedCandidateRejects.length,
    pumpFailureCounts,
    recentMigratedLiquidityRejects: migratedLiquidityRejects
      .slice(-8)
      .map(summarizePumpGateFailure),
    recentMigratedCandidateRejects: migratedCandidateRejects
      .slice(-8)
      .map(summarizePumpGateFailure)
  };
}

function buildRunnerNearMissDiagnostic({ tradeRejected, signalGenerated, signalExecuted, aiEvents, limit }) {
  const summarizedRejects = tradeRejected.map(summarizeTradeReject);
  const aiFailureTypeCounts = countBy(aiEvents, (event) => {
    const payload = payloadOf(event);
    return payload.simpleRuntime?.failureType || null;
  });
  const aiFailureReasonCounts = countBy(aiEvents, (event) => {
    const payload = payloadOf(event);
    return payload.reason || payload.rejectionReason || null;
  });
  const closestRejected = summarizedRejects
    .slice()
    .sort((a, b) => (
      Number(b.rankScore || 0) - Number(a.rankScore || 0)
      || Number(b.qualityScore || 0) - Number(a.qualityScore || 0)
      || Number(b.momentumScore || 0) - Number(a.momentumScore || 0)
    ))
    .slice(0, limit);

  return {
    posture: signalExecuted.length > 0
      ? 'executed'
      : (signalGenerated.length > 0 ? 'blocked_after_signal' : 'blocked_before_signal'),
    generatedSignals: signalGenerated.length,
    executedSignals: signalExecuted.length,
    aiEventCount: aiEvents.length,
    aiFailureTypes: aiFailureTypeCounts,
    aiFailureReasons: aiFailureReasonCounts,
    recentAiFailures: aiEvents
      .filter((event) => payloadOf(event).simpleRuntime?.failureType)
      .slice(-8)
      .map((event) => {
        const payload = payloadOf(event);
        return {
          timestamp: event.timestamp || null,
          type: eventType(event),
          mint: payload.token || payload.mint || null,
          reason: payload.reason || payload.rejectionReason || null,
          failureType: payload.simpleRuntime?.failureType || null,
          model: payload.simpleRuntime?.model || null,
          timeout: payload.timeout === true
        };
      }),
    rejectionReasons: countBy(tradeRejected, (event) => payloadOf(event).reason),
    rejectionSources: countBy(tradeRejected, (event) => payloadOf(event).source || 'unknown'),
    closestRejected,
    interpretation: signalGenerated.length === 0
      ? 'No runner/scalper signal reached quote or AI review; inspect rejection reasons and sources before tuning gates.'
      : 'At least one runner/scalper signal was generated; inspect quote and AI events before tuning gates.'
  };
}

function buildReport(events, dossiers, options = {}) {
  const limit = Number(options.limit || 8);
  const eventCounts = countBy(events, eventType);
  const generatedAt = new Date().toISOString();
  const sessionTiming = buildSessionTiming(events, generatedAt);

  const tradeRejected = events.filter((event) => eventType(event) === 'trade.rejected');
  const pumpFailures = events.filter((event) => eventType(event) === 'pump.momentum_gate_failed');
  const signalGenerated = events.filter((event) => eventType(event) === 'signal.generated');
  const signalExecuted = events.filter((event) => eventType(event) === 'signal.executed' || eventType(event) === 'trade.executed');
  const simpleRuntimeStarted = events.filter((event) => eventType(event) === 'simple_runtime_ai.review_started');
  const simpleRuntimeCompleted = events.filter((event) => eventType(event) === 'simple_runtime_ai.review_completed');
  const simpleRuntimeFailed = events.filter((event) => eventType(event) === 'simple_runtime_ai.review_failed');
  const tradeExecuted = events.filter((event) => eventType(event) === 'trade.executed');
  const signalExecutionLatencyMs = tradeExecuted
    .map((event) => payloadOf(event).signalAgeMs)
    .filter((value) => Number.isFinite(Number(value)));
  const aiFailureLatencyMs = simpleRuntimeFailed
    .map((event) => payloadOf(event).latencyMs)
    .filter((value) => Number.isFinite(Number(value)));
  const aiCompletedLatencyMs = simpleRuntimeCompleted
    .map((event) => payloadOf(event).latencyMs)
    .filter((value) => Number.isFinite(Number(value)));
  const aiAttemptsExceedingOuterTimeout = [...simpleRuntimeCompleted, ...simpleRuntimeFailed]
    .filter((event) => {
      const payload = payloadOf(event);
      const latencyMs = Number(payload.latencyMs);
      const outerTimeoutMs = Number(payload.outerTimeoutMs);
      return Number.isFinite(latencyMs) && Number.isFinite(outerTimeoutMs) && outerTimeoutMs > 0 && latencyMs > outerTimeoutMs;
    })
    .length;
  const runnerPaperClosed = events.filter((event) => eventType(event) === 'paper.position.closed');
  const runnerLiveClosed = events.filter((event) => eventType(event) === 'live.position.closed');
  const aiEvents = events.filter((event) => {
    const haystack = JSON.stringify(event);
    return eventType(event).startsWith('ai.')
      || haystack.includes('AI_FAILURE_FALLBACK')
      || haystack.includes('AI_TIMEOUT_FALLBACK')
      || haystack.includes('AI_REVIEW_TIMEOUT')
      || haystack.includes('AI_REVIEW_FAILED')
      || haystack.includes('SIMPLE_RUNTIME_AI_');
  });

  const paperDecisions = events.filter((event) => eventType(event) === 'pre_migration_paper.decision');
  const paperEntries = events.filter((event) => eventType(event) === 'pre_migration_paper.entry');
  const paperExits = events.filter((event) => eventType(event) === 'pre_migration_paper.exit');
  const firstCurveNearMisses = events.filter((event) => eventType(event) === 'pre_migration_paper.first_curve_snapshot_near_miss');
  const paperRecheckScheduled = events.filter((event) => eventType(event) === 'pre_migration_paper.recheck_scheduled');
  const paperRecheckExecuted = events.filter((event) => eventType(event) === 'pre_migration_paper.recheck_executed');
  const paperRecheckSkipped = events.filter((event) => eventType(event) === 'pre_migration_paper.recheck_skipped');
  const paperRecheckFailed = events.filter((event) => eventType(event) === 'pre_migration_paper.recheck_failed');
  const paperRecheckCancelled = events.filter((event) => eventType(event) === 'pre_migration_paper.recheck_cancelled');
  const paperPnl = paperExits.reduce((sum, event) => sum + Number(payloadOf(event).pnlSol || 0), 0);
  const firstCurveNearMissFailedChecks = firstCurveNearMisses.flatMap((event) => {
    const failedChecks = payloadOf(event).failedChecks;
    return Array.isArray(failedChecks) ? failedChecks : [];
  });

  const continuationDossiers = dossiers.filter((dossier) => dossier.source === 'post_migration_continuation');
  const watchDossiers = dossiers.filter((dossier) => dossier.source === 'pre_migration_watch');
  const paperDossiers = dossiers.filter((dossier) => dossier.source === 'pre_migration_paper');
  const continuationPaper = options.continuationPaper || null;
  const continuationOpenPositions = Array.isArray(continuationPaper?.openPositions) ? continuationPaper.openPositions : [];
  const continuationRecentClosed = Array.isArray(continuationPaper?.recentClosedPositions) ? continuationPaper.recentClosedPositions : [];

  const paperPnlByPreset = {};
  const paperPnlByLane = {};
  const paperPnlByProfile = {};
  for (const exit of paperExits) {
    const payload = payloadOf(exit);
    const preset = payload.preset || 'unknown';
    const pnlSol = Number(payload.pnlSol || 0);
    addPnlGroup(paperPnlByPreset, preset, pnlSol);
    addPnlGroup(paperPnlByLane, payload.lane, pnlSol);
    addPnlGroup(paperPnlByProfile, payload.profileName, pnlSol);
  }

  compactPnlGroups(paperPnlByPreset);
  compactPnlGroups(paperPnlByLane);
  compactPnlGroups(paperPnlByProfile);

  return {
    generatedAt,
    files: options.files || {},
    session: {
      ...sessionTiming,
      eventCount: events.length,
      dossierCount: dossiers.length
    },
    eventCounts: topEntries(eventCounts, 30),
    runnerLane: {
      generatedSignals: signalGenerated.length,
      executedSignals: signalExecuted.length,
      rejectedTrades: tradeRejected.length,
      rejectionReasons: countBy(tradeRejected, (event) => payloadOf(event).reason),
      rejectionSources: countBy(tradeRejected, (event) => payloadOf(event).source || 'unknown'),
      pumpGateFailures: countBy(pumpFailures, (event) => payloadOf(event).reason),
      scalperDiagnostics: buildScalperDiagnostics({
        pumpFailures,
        tradeRejected,
        signalGenerated,
        signalExecuted
      }),
      nearMissDiagnostic: buildRunnerNearMissDiagnostic({
        tradeRejected,
        signalGenerated,
        signalExecuted,
        aiEvents,
        limit
      }),
      signalExecutionLatencyMs: numericStats(signalExecutionLatencyMs, 0),
      simpleRuntimeAiLifecycle: {
        attempts: simpleRuntimeStarted.length,
        completed: simpleRuntimeCompleted.length,
        failed: simpleRuntimeFailed.length,
        attemptsExceedingOuterTimeout: aiAttemptsExceedingOuterTimeout,
        completedLatencyMs: numericStats(aiCompletedLatencyMs, 0),
        failedLatencyMs: numericStats(aiFailureLatencyMs, 0),
        failureTypes: countBy(simpleRuntimeFailed, (event) => payloadOf(event).failureType),
        attemptTypes: countBy(simpleRuntimeStarted, (event) => payloadOf(event).attemptType)
      },
      paperExitReasons: countBy(runnerPaperClosed, (event) => payloadOf(event).reason),
      paperExitProfiles: countBy(runnerPaperClosed, (event) => payloadOf(event).paperExitProfile?.profileName || 'unknown'),
      liveExitReasons: countBy(runnerLiveClosed, (event) => payloadOf(event).reason),
      liveExitProfiles: countBy(runnerLiveClosed, (event) => payloadOf(event).liveExitProfile?.profileName || 'unknown'),
      generated: signalGenerated.map(summarizeSignal),
      executed: signalExecuted.map(summarizeSignal),
      aiFailureFallback: uniqueBy(aiEvents
        .filter((event) => {
          const serialized = JSON.stringify(event);
          return serialized.includes('AI_FAILURE_FALLBACK') || serialized.includes('AI_TIMEOUT_FALLBACK');
        })
        .map((event) => ({
          timestamp: event.timestamp,
          type: eventType(event),
          mint: payloadOf(event).token || payloadOf(event).mint || null,
          reason: payloadOf(event).reason || payloadOf(event).rejectionReason || null,
          qualityScore: compact(payloadOf(event).qualityScore, 4),
          momentumScore: compact(payloadOf(event).momentumScore, 4)
        })), (item) => `${item.mint || 'unknown'}:${item.reason || 'unknown'}`)
    },
    preMigrationPaper: {
      entries: paperEntries.length,
      exits: paperExits.length,
      wins: paperExits.filter((event) => Number(payloadOf(event).pnlSol || 0) > 0).length,
      losses: paperExits.filter((event) => Number(payloadOf(event).pnlSol || 0) < 0).length,
      pnlSol: compact(paperPnl, 9),
      pnlByPreset: paperPnlByPreset,
      pnlByLane: paperPnlByLane,
      pnlByProfile: paperPnlByProfile,
      decisionCounts: countBy(paperDecisions, (event) => payloadOf(event).decision),
      skipReasons: countBy(paperDecisions, (event) => payloadOf(event).reason),
      firstCurveSnapshotNearMisses: firstCurveNearMisses.length,
      firstCurveSnapshotNearMissFailedChecks: countBy(firstCurveNearMissFailedChecks, (check) => check),
      firstCurveSnapshotNearMissDetail: firstCurveNearMisses.map(summarizeFirstCurveNearMiss),
      rechecks: {
        scheduled: paperRecheckScheduled.length,
        executed: paperRecheckExecuted.length,
        skipped: paperRecheckSkipped.length,
        failed: paperRecheckFailed.length,
        cancelled: paperRecheckCancelled.length,
        skippedReasons: countBy(paperRecheckSkipped, (event) => payloadOf(event).reason),
        cancelledReasons: countBy(paperRecheckCancelled, (event) => payloadOf(event).reason),
        latestExecuted: paperRecheckExecuted.slice(-limit).map((event) => ({
          timestamp: event.timestamp,
          mint: payloadOf(event).mint || null,
          symbol: payloadOf(event).symbol || null,
          attempt: payloadOf(event).attempt ?? null,
          refreshed: payloadOf(event).refreshed ?? null,
          refreshSkipReason: payloadOf(event).refreshSkipReason || null,
          accountFound: payloadOf(event).accountFound ?? null,
          curveProgress: compact(payloadOf(event).curveProgress, 6)
        })),
        latestCancelled: paperRecheckCancelled.slice(-limit).map((event) => ({
          timestamp: event.timestamp,
          mint: payloadOf(event).mint || null,
          symbol: payloadOf(event).symbol || null,
          attempt: payloadOf(event).attempt ?? null,
          reason: payloadOf(event).reason || null,
          dueAt: payloadOf(event).dueAt || null
        }))
      },
      entriesByLane: countBy(paperEntries, (event) => payloadOf(event).lane || 'unknown'),
      entriesByProfile: countBy(paperEntries, (event) => payloadOf(event).profileName || 'unknown'),
      exitsByProfile: countBy(paperExits, (event) => payloadOf(event).profileName || 'unknown'),
      entriesDetail: paperEntries.map(summarizePaperEntry),
      exitsDetail: paperExits.map(summarizePaperExit)
    },
    watchLane: {
      uniqueWatchCandidates: groupLatestByMint(watchDossiers, () => true).length,
      verdicts: countBy(watchDossiers, (dossier) => dossier.gmgnStyle?.verdict),
      topWatch: buildTopWatch(dossiers, limit),
      topMissedWatch: buildTopMissedWatch(dossiers, paperEntries, limit)
    },
    continuationLane: {
      verdicts: countBy(continuationDossiers, (dossier) => dossier.gmgnStyle?.verdict),
      confirmed: buildContinuationHighlights(dossiers, 'continuation_confirmed', limit),
      watch: buildContinuationHighlights(dossiers, 'continuation_watch', limit),
      rejectedReasons: countBy(
        continuationDossiers.filter((dossier) => String(dossier.gmgnStyle?.verdict || '').startsWith('continuation_rejected:')),
        (dossier) => dossier.continuation?.rejectReason || String(dossier.gmgnStyle?.verdict || '').split(':')[1]
      )
    },
    continuationPaper: continuationPaper?.summary
      ? {
        generatedAt: continuationPaper.generatedAt || null,
        openedThisRun: Number(continuationPaper.summary.openedThisRun || 0),
        updatedThisRun: Number(continuationPaper.summary.updatedThisRun || 0),
        closedThisRun: Number(continuationPaper.summary.closedThisRun || 0),
        skippedReopenThisRun: Number(continuationPaper.summary.skippedReopenThisRun || 0),
        skippedIneligibleThisRun: Number(continuationPaper.summary.skippedIneligibleThisRun || 0),
        skippedLearningThisRun: Number(continuationPaper.summary.skippedLearningThisRun || 0),
        skippedChopFadeThisRun: Number(continuationPaper.summary.skippedChopFadeThisRun || 0),
        openPositions: Number(continuationPaper.summary.openPositions || 0),
        closedPositions: Number(continuationPaper.summary.closedPositions || 0),
        openPnlUsd: compact(continuationPaper.summary.openPnlUsd, 6),
        closedPnlUsd: compact(continuationPaper.summary.closedPnlUsd, 6),
        totalMarkedPnlUsd: compact(continuationPaper.summary.totalMarkedPnlUsd, 6),
        openPnlSol: compact(continuationPaper.summary.openPnlSol, 9),
        closedPnlSol: compact(continuationPaper.summary.closedPnlSol, 9),
        totalMarkedPnlSol: compact(continuationPaper.summary.totalMarkedPnlSol, 9),
        solUsdPrice: compact(continuationPaper.solUsdPrice, 6),
        exitsByReason: continuationPaper.summary.exitsByReason || {},
        positionsByProfile: continuationPaper.summary.positionsByProfile || {},
        openedByProfile: continuationPaper.summary.openedByProfile || {},
        closedByProfile: continuationPaper.summary.closedByProfile || {},
        open: continuationOpenPositions.slice(0, limit).map((position) => ({
          mint: position.mint,
          symbol: position.symbol || null,
          profileName: position.paperProfile || null,
          openedAt: position.openedAt || null,
          entryScore: compact(position.entryScore, 2),
          entryPriceUsd: compact(position.entryPriceUsd, 12),
          currentPriceUsd: compact(position.currentPriceUsd, 12),
          returnPct: compact(position.returnPct, 6),
          pnlUsd: compact(position.pnlUsd, 6),
          pnlSol: compact(position.pnlSol, 9),
          sourceLabel: position.sourceLabel || null
        })),
        recentClosed: continuationRecentClosed.slice(-limit).reverse().map((position) => ({
          mint: position.mint,
          symbol: position.symbol || null,
          profileName: position.paperProfile || null,
          closedAt: position.closedAt || null,
          exitReason: position.exitReason || null,
          returnPct: compact(position.returnPct, 6),
          pnlUsd: compact(position.pnlUsd, 6),
          pnlSol: compact(position.pnlSol, 9)
        }))
      }
      : null,
    dossiers: {
      bySource: countBy(dossiers, (dossier) => dossier.source),
      byVerdict: topEntries(countBy(dossiers, (dossier) => dossier.gmgnStyle?.verdict), 30),
      recent: dossiers.slice(-limit).map(summarizeDossier),
      paperDossiers: paperDossiers.length,
      watchDossiers: watchDossiers.length,
      continuationDossiers: continuationDossiers.length
    }
  };
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printCountObject(counts, empty = 'none') {
  const entries = Object.entries(counts || {});
  if (entries.length === 0) {
    console.log(`  ${empty}`);
    return;
  }

  for (const [key, value] of entries) {
    console.log(`  ${key}: ${value}`);
  }
}

function printCandidateList(items, empty = 'none') {
  if (!items || items.length === 0) {
    console.log(`  ${empty}`);
    return;
  }

  for (const item of items) {
    const label = item.symbol || item.mint || 'unknown';
    const score = item.score === null ? 'n/a' : item.score;
    const curve = item.curveProgress === null ? '' : ` curve=${pct(item.curveProgress)}`;
    const liq = item.liquidityUsd === null ? '' : ` liq=${usd(item.liquidityUsd)}`;
    const changes = [
      item.priceChange1hPct === null ? null : `1h=${item.priceChange1hPct}%`,
      item.priceChange6hPct === null ? null : `6h=${item.priceChange6hPct}%`,
      item.priceChange24hPct === null ? null : `24h=${item.priceChange24hPct}%`
    ].filter(Boolean).join(' ');
    console.log(`  ${label}: score=${score} ${item.verdict || ''}${curve}${liq}${changes ? ` ${changes}` : ''}`);
    if (item.mint) console.log(`    ${item.mint}`);
    if (item.tags?.length) console.log(`    tags=${item.tags.join(',')}`);
  }
}

function printReport(report) {
  console.log('Run Battlefield Report');
  console.log('======================');
  console.log(`Telemetry: ${report.files.telemetryPath || 'n/a'}`);
  console.log(`Dossiers:  ${report.files.dossierPath || 'n/a'}`);
  console.log(`Window:    ${report.session.firstEventAt || 'n/a'} -> ${report.session.lastEventAt || 'n/a'} (${report.session.activeDurationMinutes ?? 'n/a'} active telemetry min)`);
  if (report.session.configuredDurationMinutes !== null && report.session.configuredDurationMinutes !== undefined) {
    const stopLabel = report.session.stoppedAt
      || (report.session.stopObservedAt ? `${report.session.stopObservedAt} (${report.session.stopStatus})` : 'not recorded');
    console.log(`Session:   configured=${report.session.configuredDurationMinutes} min expectedEnd=${report.session.expectedEndAt || 'n/a'} stopped=${stopLabel}`);
    if (report.session.expectedQuietTailMinutes !== null && report.session.expectedQuietTailMinutes !== undefined) {
      console.log(`Quiet tail estimate: ${report.session.expectedQuietTailMinutes} min from last telemetry to expected session end`);
    }
  }
  console.log(`Events:    ${report.session.eventCount}`);
  console.log(`Dossiers:  ${report.session.dossierCount}`);

  printSection('Runner Lane');
  console.log(`  signals=${report.runnerLane.generatedSignals} executed=${report.runnerLane.executedSignals} rejected=${report.runnerLane.rejectedTrades}`);
  console.log('  rejection reasons:');
  printCountObject(report.runnerLane.rejectionReasons);
  if (report.runnerLane.pumpGateFailures && Object.keys(report.runnerLane.pumpGateFailures).length > 0) {
    console.log('  pump gate failures:');
    printCountObject(report.runnerLane.pumpGateFailures);
  }
  if (report.runnerLane.liveExitReasons && Object.keys(report.runnerLane.liveExitReasons).length > 0) {
    console.log('  live exit reasons:');
    printCountObject(report.runnerLane.liveExitReasons);
  }
  if (report.runnerLane.scalperDiagnostics) {
    const diag = report.runnerLane.scalperDiagnostics;
    console.log(`  scalper diagnostics: posture=${diag.posture} migratedRejects=${diag.migratedCandidateRejects} liquidityRejects=${diag.migratedLiquidityRejects} quoteRejects=${diag.quoteRejects} aiRejects=${diag.aiRejects}`);
    if (diag.recentMigratedLiquidityRejects?.length > 0) {
      console.log('  recent migrated liquidity rejects:');
      for (const item of diag.recentMigratedLiquidityRejects) {
        console.log(`  ${item.reason}: liq=${usd(item.liquidityUsd)} threshold=${usd(item.threshold)} m=${item.momentumScore}`);
        if (item.mint) console.log(`    ${item.mint}`);
      }
    }
  }
  if (report.runnerLane.nearMissDiagnostic) {
    const diag = report.runnerLane.nearMissDiagnostic;
    console.log(`  near-miss posture=${diag.posture} aiEvents=${diag.aiEventCount}`);
    console.log(`  near-miss interpretation: ${diag.interpretation}`);
    if (diag.aiFailureTypes && Object.keys(diag.aiFailureTypes).length > 0) {
      console.log('  AI failure types:');
      printCountObject(diag.aiFailureTypes);
    }
    if (diag.rejectionSources && Object.keys(diag.rejectionSources).length > 0) {
      console.log('  rejection sources:');
      printCountObject(diag.rejectionSources);
    }
    if (diag.closestRejected && diag.closestRejected.length > 0) {
      console.log('  closest rejected:');
      for (const item of diag.closestRejected.slice(0, 5)) {
        console.log(`  ${item.symbol || item.mint || 'unknown'} reason=${item.reason || 'n/a'} source=${item.source || 'n/a'} momentum=${item.momentumScore ?? 'n/a'} quality=${item.qualityScore ?? 'n/a'}`);
        if (item.mint) console.log(`    ${item.mint}`);
      }
    }
  }
  if (report.runnerLane.generated.length > 0) {
    console.log('  generated signals:');
    for (const signal of report.runnerLane.generated) {
      console.log(`  ${signal.symbol || signal.mint}: q=${signal.qualityScore} m=${signal.momentumScore} rank=${signal.rankScore}`);
      console.log(`    ${signal.mint}`);
    }
  }
  if (report.runnerLane.aiFailureFallback.length > 0) {
    console.log('  AI failure fallback:');
    for (const item of report.runnerLane.aiFailureFallback) {
      console.log(`  ${item.type}: ${item.reason}`);
      if (item.mint) console.log(`    ${item.mint}`);
    }
  }

  printSection('Pre-Migration Paper');
  console.log(`  entries=${report.preMigrationPaper.entries} exits=${report.preMigrationPaper.exits} wins=${report.preMigrationPaper.wins} losses=${report.preMigrationPaper.losses} pnl=${sol(report.preMigrationPaper.pnlSol)}`);
  console.log('  decisions:');
  printCountObject(report.preMigrationPaper.decisionCounts);
  console.log('  skip reasons:');
  printCountObject(report.preMigrationPaper.skipReasons);
  console.log(`  first-curve snapshot near misses=${report.preMigrationPaper.firstCurveSnapshotNearMisses || 0}`);
  if ((report.preMigrationPaper.firstCurveSnapshotNearMisses || 0) > 0) {
    console.log('  first-curve failed checks:');
    printCountObject(report.preMigrationPaper.firstCurveSnapshotNearMissFailedChecks);
  }
  if (report.preMigrationPaper.rechecks) {
    const rechecks = report.preMigrationPaper.rechecks;
    console.log(`  rechecks: scheduled=${rechecks.scheduled || 0} executed=${rechecks.executed || 0} skipped=${rechecks.skipped || 0} failed=${rechecks.failed || 0} cancelled=${rechecks.cancelled || 0}`);
    if (Object.keys(rechecks.skippedReasons || {}).length > 0) {
      console.log('  recheck skipped reasons:');
      printCountObject(rechecks.skippedReasons);
    }
    if (Object.keys(rechecks.cancelledReasons || {}).length > 0) {
      console.log('  recheck cancelled reasons:');
      printCountObject(rechecks.cancelledReasons);
    }
  }
  console.log('  entries by profile:');
  printCountObject(report.preMigrationPaper.entriesByProfile);
  if (report.preMigrationPaper.exitsDetail.length > 0) {
    console.log('  exits:');
    for (const exit of report.preMigrationPaper.exitsDetail) {
      console.log(`  ${exit.symbol || exit.mint} ${exit.profileName || exit.preset}: ${exit.reason} return=${pct(exit.returnPct)} pnl=${sol(exit.pnlSol)} hold=${exit.holdSeconds}s`);
      console.log(`    ${exit.mint}`);
    }
  }

  printSection('Watch Lane');
  console.log(`  unique candidates=${report.watchLane.uniqueWatchCandidates}`);
  console.log('  verdicts:');
  printCountObject(report.watchLane.verdicts);
  console.log('  top watch:');
  printCandidateList(report.watchLane.topWatch);
  console.log('  top missed watch:');
  printCandidateList(report.watchLane.topMissedWatch);

  printSection('Continuation Lane');
  console.log('  verdicts:');
  printCountObject(report.continuationLane.verdicts);
  console.log('  rejected reasons:');
  printCountObject(report.continuationLane.rejectedReasons);
  console.log('  confirmed:');
  printCandidateList(report.continuationLane.confirmed);
  console.log('  watch:');
  printCandidateList(report.continuationLane.watch);

  printSection('Continuation Paper');
  if (!report.continuationPaper) {
    console.log('  none');
  } else {
    console.log(`  opened=${report.continuationPaper.openedThisRun} updated=${report.continuationPaper.updatedThisRun} closed=${report.continuationPaper.closedThisRun} open=${report.continuationPaper.openPositions} totalPnl=${sol(report.continuationPaper.totalMarkedPnlSol)} ($${report.continuationPaper.totalMarkedPnlUsd})`);
    console.log('  profiles:');
    printCountObject(report.continuationPaper.positionsByProfile);
    console.log('  exits:');
    printCountObject(report.continuationPaper.exitsByReason);
    if (report.continuationPaper.open.length > 0) {
      console.log('  open positions:');
      for (const position of report.continuationPaper.open) {
        console.log(`  ${position.symbol || position.mint}: ${position.profileName || 'unknown'} return=${pct(position.returnPct)} pnl=${sol(position.pnlSol)} ($${position.pnlUsd})`);
        if (position.mint) console.log(`    ${position.mint}`);
      }
    }
    if (report.continuationPaper.recentClosed.length > 0) {
      console.log('  recent closed:');
      for (const position of report.continuationPaper.recentClosed) {
        console.log(`  ${position.symbol || position.mint}: ${position.exitReason || 'UNKNOWN'} return=${pct(position.returnPct)} pnl=${sol(position.pnlSol)} ($${position.pnlUsd})`);
        if (position.mint) console.log(`    ${position.mint}`);
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logDir = resolveRepoPath(args.logDir) || DEFAULT_LOG_DIR;
  const telemetryPath = resolveRepoPath(args.telemetry) || resolveLatest(logDir, 'telemetry-');
  const dossierPath = resolveRepoPath(args.dossier) || resolveNearestDossier(logDir, telemetryPath);
  const outputPath = resolveRepoPath(args.out) || DEFAULT_OUTPUT_PATH;

  if (!telemetryPath) {
    throw new Error(`No telemetry JSONL file found in ${logDir}`);
  }

  const events = readJsonl(telemetryPath);
  const dossiers = readJsonl(dossierPath);
  const continuationPaperPath = resolveRepoPath(args.continuationPaper) || DEFAULT_CONTINUATION_PAPER_PATH;
  const continuationPaper = readJson(continuationPaperPath, null);
  const report = buildReport(events, dossiers, {
    limit: Number(args.limit || 8),
    continuationPaper,
    files: {
      telemetryPath,
      dossierPath,
      continuationPaperPath: continuationPaper ? continuationPaperPath : null
    }
  });

  writeJson(outputPath, report);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
    console.log(`\nWrote JSON report: ${outputPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`run-battlefield-report failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildReport,
  readJsonl,
  resolveLatest,
  resolveNearestDossier
};
