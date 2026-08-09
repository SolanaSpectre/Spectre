#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { resolveTelemetryPath, telemetryFromReport } = require('./lib/report-telemetry');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'event-loop-lag-diagnostic-latest.json');

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

function telemetryFromBattlefield() {
  return telemetryFromReport(ROOT, BATTLEFIELD_PATH);
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function stat(values, digits = 3) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, p99: null, max: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  return {
    count: finite.length,
    min: numberOrNull(finite[0], digits),
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    p99: numberOrNull(pick(0.99), digits),
    max: numberOrNull(finite[finite.length - 1], digits)
  };
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function topEntries(map, limit = 12) {
  return Object.fromEntries([...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit));
}

function secondsGapBucket(ms) {
  return `${Math.round(ms / 1000)}s`;
}

function minuteBucket(ms) {
  return Math.floor(ms / 60000) * 60000;
}

function analyzeTelemetry(filePath) {
  const minuteBuckets = new Map();
  const lagRows = [];
  const recentEvents = [];
  const precedingEventTypes5s = new Map();
  const eventCounts = new Map();
  let malformedLines = 0;
  let startMs = Infinity;
  let endMs = -Infinity;
  let sessionRuntimeStats = null;

  const parseStats = forEachJsonlSync(filePath, (event) => {
    const type = event.type || event.event || 'unknown';
    const payload = event.payload || event.data || {};
    const atMs = new Date(event.timestamp || payload.timestamp || 0).getTime();
    if (!Number.isFinite(atMs)) return;

    startMs = Math.min(startMs, atMs);
    endMs = Math.max(endMs, atMs);
    increment(eventCounts, type);
    if (type === 'session.stopping' || type === 'session.stopped') {
      sessionRuntimeStats = payload.stats || sessionRuntimeStats;
    }

    const minuteMs = minuteBucket(atMs);
    if (!minuteBuckets.has(minuteMs)) {
      minuteBuckets.set(minuteMs, {
        at: new Date(minuteMs).toISOString(),
        events: 0,
        lagEvents: 0,
        maxLagMs: 0,
        eventTypes: new Map()
      });
    }
    const minute = minuteBuckets.get(minuteMs);
    minute.events += 1;
    increment(minute.eventTypes, type);

    while (recentEvents.length && recentEvents[0].atMs < atMs - 5000) {
      recentEvents.shift();
    }

    if (type === 'runtime.event_loop_lag') {
      const lagMs = Number(payload.lagMs);
      lagRows.push({
        atMs,
        at: new Date(atMs).toISOString(),
        lagMs: numberOrNull(lagMs, 0),
        sample: payload.sample ?? null,
        stallContext: payload.stallContext || null
      });
      minute.lagEvents += 1;
      minute.maxLagMs = Math.max(minute.maxLagMs, Number.isFinite(lagMs) ? lagMs : 0);
      for (const recent of recentEvents) {
        increment(precedingEventTypes5s, recent.type);
      }
    }

    recentEvents.push({ atMs, type });
  });
  malformedLines += parseStats.malformedLines;

  const lagGapsMs = [];
  for (let index = 1; index < lagRows.length; index += 1) {
    lagGapsMs.push(lagRows[index].atMs - lagRows[index - 1].atMs);
  }
  const lagGapBuckets = new Map();
  for (const gapMs of lagGapsMs) increment(lagGapBuckets, secondsGapBucket(gapMs));
  const fifteenSecondGapCount = lagGapsMs.filter((gapMs) => Math.abs(gapMs - 15000) <= 750).length;
  const cadenceShare = lagGapsMs.length ? fifteenSecondGapCount / lagGapsMs.length : 0;

  const topLagMinutes = [...minuteBuckets.values()]
    .filter((minute) => minute.lagEvents > 0)
    .sort((a, b) => b.lagEvents - a.lagEvents || b.maxLagMs - a.maxLagMs)
    .slice(0, 12)
    .map((minute) => ({
      at: minute.at,
      events: minute.events,
      lagEvents: minute.lagEvents,
      maxLagMs: numberOrNull(minute.maxLagMs, 0),
      topEventTypes: topEntries(minute.eventTypes, 6)
    }));

  const allMinutes = [...minuteBuckets.values()];
  const lagMinutes = allMinutes.filter((minute) => minute.lagEvents > 0);
  const nonLagMinutes = allMinutes.filter((minute) => minute.lagEvents === 0);
  const sortedMinuteEvents = allMinutes.map((minute) => minute.events).sort((a, b) => a - b);
  const p90MinuteEvents = sortedMinuteEvents.length
    ? sortedMinuteEvents[Math.min(sortedMinuteEvents.length - 1, Math.floor((sortedMinuteEvents.length - 1) * 0.9))]
    : null;
  const highDensityLagMinutes = Number.isFinite(p90MinuteEvents)
    ? lagMinutes.filter((minute) => minute.events >= p90MinuteEvents).length
    : 0;
  const totalEvents = allMinutes.reduce((sum, minute) => sum + minute.events, 0);
  const heliusQueue = sessionRuntimeStats?.heliusPumpfunShadow || {};
  const pumpPortalQueue = sessionRuntimeStats?.pumpPortal || {};
  const pumpDevQueue = sessionRuntimeStats?.pumpDev || {};
  const curveQueue = sessionRuntimeStats?.pumpBondingCurveLane?.engineQueueDrain || {};
  const eventLoopMonitor = sessionRuntimeStats?.eventLoopMonitor || {};
  const gcPauses = eventLoopMonitor.gcPauses || {};
  const workSamplerSummary = eventLoopMonitor.workSampler || {};
  const providerTradeTickBursts = eventLoopMonitor.providerTradeTickBursts || {};
  const pumpPortalTradeBursts = providerTradeTickBursts.byProvider?.pumpportal || {};
  const selectedProvider = sessionRuntimeStats?.pumpData?.provider || 'unknown';
  const selectedProviderQueue = selectedProvider === 'helius'
    ? heliusQueue
    : selectedProvider === 'pumpdev'
      ? pumpDevQueue
      : pumpPortalQueue;
  const selectedProviderTradeBursts = providerTradeTickBursts.byProvider?.[selectedProvider] || {};
  const selectedProviderBatchLimit = selectedProvider === 'helius'
    ? selectedProviderQueue.eventQueueBatchSize
    : selectedProviderQueue.eventHandlerConcurrency;
  const selectedProviderDrainMaxBatch = selectedProviderQueue.eventQueueDrainMaxBatch;
  const selectedProviderBoundedDrainMetricsAvailable = [
    selectedProviderBatchLimit,
    selectedProviderDrainMaxBatch,
    selectedProviderQueue.eventQueueLatencySamples
  ].every((value) => Number.isFinite(Number(value)));
  const selectedProviderBoundedDrainChecks = selectedProviderBoundedDrainMetricsAvailable
    ? {
      maxBatchWithinConfiguredLimit:
        Number(selectedProviderDrainMaxBatch) <= Number(selectedProviderBatchLimit),
      noQueueDrops: Number(selectedProviderQueue.eventQueueDropped || 0) === 0,
      noStopDrainTimeout: selectedProviderQueue.eventQueueStopDrainTimedOut !== true,
      noHandlerErrors: Number(
        selectedProviderQueue.eventQueueHandlerErrors
          ?? selectedProviderQueue.eventQueueErrors
          ?? 0
      ) === 0,
      queueLatencyObserved: Number(selectedProviderQueue.eventQueueLatencySamples || 0) > 0
    }
    : null;
  const selectedProviderBoundedDrainVerdict = !selectedProviderBoundedDrainMetricsAvailable
    ? 'PRE_BOUNDED_DRAIN_BASELINE'
    : Object.values(selectedProviderBoundedDrainChecks).every(Boolean)
      ? 'BOUNDED_DRAIN_VALIDATED'
      : 'BOUNDED_DRAIN_VALIDATION_FAILED';
  const rpcChildTransport = sessionRuntimeStats?.solanaRpc?.transport?.childProcess || {};
  const boundedDrainMetricsAvailable = [
    pumpPortalQueue.eventHandlerConcurrency,
    pumpPortalQueue.eventQueueDrainCalls,
    pumpPortalQueue.eventQueueDrainMaxBatch,
    pumpPortalQueue.eventQueueLatencySamples,
    pumpPortalTradeBursts.maxEventsPerTick
  ].every((value) => Number.isFinite(Number(value)));
  const boundedDrainChecks = boundedDrainMetricsAvailable
    ? {
      maxBatchWithinConcurrency:
        Number(pumpPortalQueue.eventQueueDrainMaxBatch)
          <= Number(pumpPortalQueue.eventHandlerConcurrency),
      providerBurstWithinConcurrency:
        Number(pumpPortalTradeBursts.maxEventsPerTick)
          <= Number(pumpPortalQueue.eventHandlerConcurrency),
      noQueueDrops: Number(pumpPortalQueue.eventQueueDropped || 0) === 0,
      noStopDiscards: Number(pumpPortalQueue.eventQueueDiscardedOnStop || 0) === 0,
      noHandlerErrors: Number(pumpPortalQueue.eventQueueHandlerErrors || 0) === 0,
      queueLatencyObserved: Number(pumpPortalQueue.eventQueueLatencySamples || 0) > 0
    }
    : null;
  const boundedDrainVerdict = !boundedDrainMetricsAvailable
    ? 'PRE_BOUNDED_DRAIN_BASELINE'
    : Object.values(boundedDrainChecks).every(Boolean)
      ? 'BOUNDED_DRAIN_VALIDATED'
      : 'BOUNDED_DRAIN_VALIDATION_FAILED';
  const stallWindowPhases = new Map();
  for (const row of lagRows) {
    for (const phase of row.stallContext?.workWindow?.topPhases || []) {
      const aggregate = stallWindowPhases.get(phase.phase) || {
        lagWindows: 0,
        count: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        totalBytes: 0
      };
      aggregate.lagWindows += 1;
      aggregate.count += Number(phase.count || 0);
      aggregate.totalDurationMs += Number(phase.totalDurationMs || 0);
      aggregate.maxDurationMs = Math.max(
        aggregate.maxDurationMs,
        Number(phase.maxDurationMs || 0)
      );
      aggregate.totalBytes += Number(phase.totalBytes || 0);
      stallWindowPhases.set(phase.phase, aggregate);
    }
  }
  const topStallWindowPhases = [...stallWindowPhases.entries()]
    .map(([phase, row]) => ({
      phase,
      lagWindows: row.lagWindows,
      count: row.count,
      totalDurationMs: numberOrNull(row.totalDurationMs, 6),
      maxDurationMs: numberOrNull(row.maxDurationMs, 6),
      totalBytes: row.totalBytes
    }))
    .sort((left, right) => (
      right.totalDurationMs - left.totalDurationMs
      || right.maxDurationMs - left.maxDurationMs
    ))
    .slice(0, 20);
  const topLagEvents = lagRows.slice()
    .sort((left, right) => Number(right.lagMs || 0) - Number(left.lagMs || 0))
    .slice(0, 20)
    .map((row) => ({
      at: row.at,
      lagMs: row.lagMs,
      rpc: row.stallContext?.rpc || null,
      queues: row.stallContext?.queues || null,
      workWindow: row.stallContext?.workWindow || null,
      activeHandleTypes: row.stallContext?.activeHandleTypes || {}
    }));
  const lagRowsWithActiveRpcChild = lagRows.filter(
    (row) => Number(row.stallContext?.rpc?.childProcess?.active || 0) > 0
  ).length;

  let diagnosis = 'NO_LAG_EVENTS';
  if (lagRows.length > 0) {
    diagnosis = cadenceShare >= 0.7
      ? 'FIFTEEN_SECOND_STATUS_CADENCE_CORRELATION'
      : 'MIXED_OR_BURSTY_EVENT_LOOP_LAG';
  }
  const rpcChildSpawnAttempts = Number(rpcChildTransport.spawnAttempts);
  const rpcChildTotalSpawnSyncMs = Number(rpcChildTransport.totalSpawnSyncMs);
  const rpcChildSpawnSyncOver10Ms = Number(rpcChildTransport.spawnSyncOver10Ms);
  const rpcChildSyncCostObserved = (
    Number.isFinite(rpcChildSpawnAttempts)
    && rpcChildSpawnAttempts > 0
    && Number.isFinite(rpcChildTotalSpawnSyncMs)
    && rpcChildTotalSpawnSyncMs > 0
  );
  const rpcChildTransportAssessment = {
    candidate: rpcChildSyncCostObserved
      ? 'RPC_CHILD_PROCESS_PER_REQUEST_SPAWN_OVERHEAD_MEASURED'
      : 'RPC_CHILD_PROCESS_PER_REQUEST_SPAWN_OVERHEAD_NOT_MEASURED',
    measured: rpcChildSyncCostObserved,
    spawnAttempts: Number.isFinite(rpcChildSpawnAttempts) ? rpcChildSpawnAttempts : null,
    totalSpawnSyncMs: numberOrNull(rpcChildTotalSpawnSyncMs, 6),
    spawnSyncOver10Ms: Number.isFinite(rpcChildSpawnSyncOver10Ms)
      ? rpcChildSpawnSyncOver10Ms
      : null,
    causalConclusionAllowed: false,
    nextDiagnosticTarget: rpcChildSyncCostObserved
      ? 'replace_or_pool_per_request_child_process_account_reads'
      : null,
    note: rpcChildSyncCostObserved
      ? 'This is the measured synchronous return-time of per-request child_process.spawn() startup, not use of child_process.spawnSync(). It is a prioritized lag candidate, not proof that it caused each observed lag event.'
      : 'No cumulative per-request child_process.spawn() startup cost was available in session runtime stats.'
  };
  const interpretation = diagnosis === 'NO_LAG_EVENTS'
    ? [
      'No runtime.event_loop_lag events were observed in this telemetry file.',
      'No event-loop mitigation is indicated from this run.'
    ]
    : diagnosis === 'FIFTEEN_SECOND_STATUS_CADENCE_CORRELATION'
      ? [
        'Lag timing is strongly correlated with the 15s status/monitoring cadence.',
        'Reduce status console/report work or make the status loop less frequent before treating provider/RPC infrastructure as the cause.'
      ]
      : [
        'Lag timing is mixed or bursty rather than aligned with the 15s status cadence.',
        'Inspect topPrecedingEventTypes5s and topLagMinutes for concentrated provider/runtime event volume.'
      ];
  if (rpcChildSyncCostObserved) {
    interpretation.push(
      `RPC child-process transport accumulated ${numberOrNull(rpcChildTotalSpawnSyncMs, 3)} ms in the synchronous startup portion of ${rpcChildSpawnAttempts} per-request spawn() calls; prioritize replacing or pooling that account-read transport before changing telemetry.`
    );
    interpretation.push(
      'The measured spawn() startup cost is a prioritized candidate, not causal proof for any individual lag event.'
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_event_loop_lag_diagnostic',
    note: 'Analyzes runtime.event_loop_lag telemetry timing and nearby event types. Does not alter runtime behavior.',
    sources: {
      telemetryPath: filePath
    },
    telemetry: {
      startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
      endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
      malformedLines,
      eventCounts: topEntries(eventCounts, 20)
    },
    summary: {
      diagnosis,
      lagEvents: lagRows.length,
      lagMs: stat(lagRows.map((row) => row.lagMs), 0),
      lagGapMs: stat(lagGapsMs, 0),
      lagGapSecondBuckets: topEntries(lagGapBuckets, 12),
      fifteenSecondGapCount,
      lagGapCount: lagGapsMs.length,
      fifteenSecondCadenceShare: numberOrNull(cadenceShare, 4),
      firstLagAt: lagRows[0]?.at || null,
      lastLagAt: lagRows[lagRows.length - 1]?.at || null,
      topLagEvents,
      stallContextCoverage: {
        captured: lagRows.filter((row) => row.stallContext).length,
        total: lagRows.length,
        workWindowCaptured: lagRows.filter((row) => row.stallContext?.workWindow).length,
        lagRowsWithActiveRpcChild,
        lagRowsWithActiveRpcChildRate: lagRows.length
          ? numberOrNull(lagRowsWithActiveRpcChild / lagRows.length, 4)
          : null
      },
      topPrecedingEventTypes5s: topEntries(precedingEventTypes5s, 20),
      topStallWindowPhases,
      topLagMinutes,
      eventDensityCorrelation: {
        totalMinutes: allMinutes.length,
        lagMinutes: lagMinutes.length,
        nonLagMinutes: nonLagMinutes.length,
        eventsPerLagMinute: stat(lagMinutes.map((minute) => minute.events), 0),
        eventsPerNonLagMinute: stat(nonLagMinutes.map((minute) => minute.events), 0),
        p90MinuteEventThreshold: numberOrNull(p90MinuteEvents, 0),
        lagMinutesAtOrAboveP90Density: highDensityLagMinutes,
        highDensityShareOfLagMinutes: lagMinutes.length
          ? numberOrNull(highDensityLagMinutes / lagMinutes.length, 4)
          : null,
        lagEventsPer1000TelemetryEvents: totalEvents
          ? numberOrNull((lagRows.length / totalEvents) * 1000, 4)
          : null
      },
      runtimePhaseDiagnostics: {
        available: Boolean(sessionRuntimeStats),
        attributionSemantics: {
          nestedPhaseDurationsMayDoubleCount: true,
          bucketOverlapAttributionIsUpperBound: true,
          causalConclusionAllowed: false
        },
        heliusQueueDrain: {
          calls: heliusQueue.eventQueueDrainCalls ?? null,
          items: heliusQueue.eventQueueDrainItems ?? null,
          meanDurationMs: numberOrNull(heliusQueue.eventQueueDrainMeanMs, 6),
          maxDurationMs: numberOrNull(heliusQueue.eventQueueDrainMaxMs, 6),
          over50Ms: heliusQueue.eventQueueDrainOver50Ms ?? null,
          maxQueueLatencyMs: numberOrNull(heliusQueue.eventQueueLatencyMaxMs, 6)
        },
        pumpPortalQueueDrain: {
          schedules: pumpPortalQueue.eventQueueDrainSchedules ?? null,
          calls: pumpPortalQueue.eventQueueDrainCalls ?? null,
          items: pumpPortalQueue.eventQueueDrainItems ?? null,
          yields: pumpPortalQueue.eventQueueDrainYields ?? null,
          maxBatch: pumpPortalQueue.eventQueueDrainMaxBatch ?? null,
          meanDurationMs: numberOrNull(pumpPortalQueue.eventQueueDrainMeanMs, 6),
          maxDurationMs: numberOrNull(pumpPortalQueue.eventQueueDrainMaxMs, 6),
          over50Ms: pumpPortalQueue.eventQueueDrainOver50Ms ?? null,
          meanQueueLatencyMs: numberOrNull(pumpPortalQueue.eventQueueLatencyMeanMs, 6),
          maxQueueLatencyMs: numberOrNull(pumpPortalQueue.eventQueueLatencyMaxMs, 6)
        },
        providerTradeTickBursts: {
          semantics: providerTradeTickBursts.semantics || null,
          ticks: providerTradeTickBursts.ticks ?? null,
          events: providerTradeTickBursts.events ?? null,
          meanEventsPerTick: numberOrNull(providerTradeTickBursts.meanEventsPerTick, 6),
          maxEventsPerTick: providerTradeTickBursts.maxEventsPerTick ?? null,
          histogram: providerTradeTickBursts.histogram || {},
          byProvider: providerTradeTickBursts.byProvider || {},
          openTickEvents: providerTradeTickBursts.openTickEvents ?? null
        },
        pumpBondingCurveQueueDrain: {
          calls: curveQueue.calls ?? null,
          scanned: curveQueue.scanned ?? null,
          started: curveQueue.started ?? null,
          meanDurationMs: numberOrNull(curveQueue.meanDurationMs, 6),
          maxDurationMs: numberOrNull(curveQueue.maxDurationMs, 6),
          over50Ms: curveQueue.over50Ms ?? null
        },
        gcPauses: {
          samples: gcPauses.samples ?? null,
          meanDurationMs: numberOrNull(gcPauses.meanDurationMs, 6),
          maxDurationMs: numberOrNull(gcPauses.maxDurationMs, 6),
          over50Ms: gcPauses.over50Ms ?? null,
          byKind: gcPauses.byKind || {}
        },
        rpcChildTransport: {
          spawnAttempts: rpcChildTransport.spawnAttempts ?? null,
          spawnErrors: rpcChildTransport.spawnErrors ?? null,
          completed: rpcChildTransport.completed ?? null,
          failed: rpcChildTransport.failed ?? null,
          timedOut: rpcChildTransport.timedOut ?? null,
          maxActive: rpcChildTransport.maxActive ?? null,
          meanSpawnSyncMs: numberOrNull(rpcChildTransport.meanSpawnSyncMs, 6),
          maxSpawnSyncMs: numberOrNull(rpcChildTransport.maxSpawnSyncMs, 6),
          totalSpawnSyncMs: numberOrNull(rpcChildTransport.totalSpawnSyncMs, 6),
          spawnSyncOver10Ms: rpcChildTransport.spawnSyncOver10Ms ?? null,
          meanLifetimeMs: numberOrNull(rpcChildTransport.meanLifetimeMs, 6),
          maxLifetimeMs: numberOrNull(rpcChildTransport.maxLifetimeMs, 6),
          meanTimeoutCallbackLatenessMs: numberOrNull(
            rpcChildTransport.meanTimeoutCallbackLatenessMs,
            6
          ),
          maxTimeoutCallbackLatenessMs: numberOrNull(
            rpcChildTransport.maxTimeoutCallbackLatenessMs,
            6
          ),
          timeoutCallbacksLateOver100Ms: rpcChildTransport.timeoutCallbacksLateOver100Ms ?? null
        },
        rpcChildTransportAssessment,
        workSampler: {
          bucketMs: workSamplerSummary.bucketMs ?? null,
          retainedBuckets: workSamplerSummary.retainedBuckets ?? null,
          samples: workSamplerSummary.samples ?? null,
          totalDurationMs: numberOrNull(workSamplerSummary.totalDurationMs, 6),
          maxDurationMs: numberOrNull(workSamplerSummary.maxDurationMs, 6),
          byPhase: workSamplerSummary.byPhase || {}
        },
        note: 'The bounded work sampler aggregates completed synchronous work into 100ms buckets. Phase timers may be nested, so summed duration can exceed wall-clock time; bucket overlap and provider burst alignment are attribution upper bounds, not causal proof.'
      },
      pumpPortalBurstControlValidation: {
        verdict: boundedDrainVerdict,
        reportOnly: true,
        causalConclusionAllowed: false,
        metricsAvailable: boundedDrainMetricsAvailable,
        eventHandlerConcurrency: pumpPortalQueue.eventHandlerConcurrency ?? null,
        checks: boundedDrainChecks,
        note: 'A pass proves bounded callback scheduling and intact queue accounting. It does not by itself prove lower event-loop lag across unequal market loads.'
      },
      selectedProviderBurstControlValidation: {
        provider: selectedProvider,
        verdict: selectedProviderBoundedDrainVerdict,
        reportOnly: true,
        causalConclusionAllowed: false,
        metricsAvailable: selectedProviderBoundedDrainMetricsAvailable,
        configuredBatchLimit: selectedProviderBatchLimit ?? null,
        maxObservedDrainBatch: selectedProviderDrainMaxBatch ?? null,
        providerTradeTickBursts: selectedProviderTradeBursts,
        checks: selectedProviderBoundedDrainChecks,
        note: 'Selected-provider queue validation replaces PumpPortal-only assumptions for Helius-only runs.'
      }
    },
    interpretation
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveTelemetryPath(ROOT, {
    telemetry: args.telemetry,
    reportTelemetry: telemetryFromBattlefield()
  });
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  }
  const outputPath = args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH;
  const report = analyzeTelemetry(telemetryPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote event-loop lag diagnostic: ${path.relative(ROOT, outputPath)}`);
  console.log(`Diagnosis: ${report.summary.diagnosis}; lag events=${report.summary.lagEvents}; 15s cadence share=${report.summary.fifteenSecondCadenceShare}`);
}

if (require.main === module) main();

module.exports = { analyzeTelemetry };
