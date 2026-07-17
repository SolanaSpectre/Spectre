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

  const parseStats = forEachJsonlSync(filePath, (event) => {
    const type = event.type || event.event || 'unknown';
    const payload = event.payload || event.data || {};
    const atMs = new Date(event.timestamp || payload.timestamp || 0).getTime();
    if (!Number.isFinite(atMs)) return;

    startMs = Math.min(startMs, atMs);
    endMs = Math.max(endMs, atMs);
    increment(eventCounts, type);

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
        sample: payload.sample ?? null
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

  let diagnosis = 'NO_LAG_EVENTS';
  if (lagRows.length > 0) {
    diagnosis = cadenceShare >= 0.7
      ? 'FIFTEEN_SECOND_STATUS_CADENCE_CORRELATION'
      : 'MIXED_OR_BURSTY_EVENT_LOOP_LAG';
  }
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
        'Inspect topPrecedingEventTypes5s and topLagMinutes for concentrated provider/runtime event volume, then reduce synchronous per-event telemetry/logging or report-only lane work around those bursts.'
      ];

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
      topPrecedingEventTypes5s: topEntries(precedingEventTypes5s, 20),
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

main();
