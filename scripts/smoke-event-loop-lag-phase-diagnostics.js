#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeTelemetry } = require('./event-loop-lag-diagnostic-report');

const telemetryPath = path.join(os.tmpdir(), `spectre-event-loop-phases-${process.pid}.jsonl`);
const rows = [
  {
    type: 'provider.pumpportal.trade',
    timestamp: '2026-07-25T12:00:00.000Z',
    payload: {}
  },
  {
    type: 'runtime.event_loop_lag',
    timestamp: '2026-07-25T12:00:01.000Z',
    payload: { lagMs: 125 }
  },
  {
    type: 'session.stopped',
    timestamp: '2026-07-25T12:01:00.000Z',
    payload: {
      reason: 'SESSION_DURATION_EXCEEDED',
      stats: {
        heliusPumpfunShadow: {
          eventQueueDrainCalls: 10,
          eventQueueDrainItems: 640,
          eventQueueDrainMeanMs: 4,
          eventQueueDrainMaxMs: 80,
          eventQueueDrainOver50Ms: 1,
          eventQueueLatencyMaxMs: 250
        },
        pumpBondingCurveLane: {
          engineQueueDrain: {
            calls: 20,
            scanned: 100,
            started: 40,
            meanDurationMs: 2,
            maxDurationMs: 60,
            over50Ms: 1
          }
        },
        eventLoopMonitor: {
          gcPauses: {
            samples: 5,
            meanDurationMs: 3,
            maxDurationMs: 55,
            over50Ms: 1,
            byKind: { MAJOR: 1, MINOR: 4 }
          }
        }
      }
    }
  }
];

fs.writeFileSync(telemetryPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
try {
  const report = analyzeTelemetry(telemetryPath);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.available, true);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.heliusQueueDrain.maxDurationMs, 80);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.pumpBondingCurveQueueDrain.maxDurationMs, 60);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.gcPauses.maxDurationMs, 55);
} finally {
  fs.rmSync(telemetryPath, { force: true });
}

console.log('Event-loop lag phase-diagnostic smoke passed');
