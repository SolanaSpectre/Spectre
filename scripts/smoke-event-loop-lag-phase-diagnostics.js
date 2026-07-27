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
    payload: {
      lagMs: 125,
      stallContext: {
        rpc: {
          activeRequests: 2,
          pendingRequests: 4,
          childProcess: {
            active: 2,
            maxActive: 2,
            lastSpawnSyncMs: 4.5
          }
        },
        queues: {
          heliusShadowDepth: 12,
          bondingCurveQueued: 3,
          bondingCurvePending: 2
        },
        workWindow: {
          semantics: 'bounded_recent_sync_work_buckets_overlapping_timer_deadline_window',
          startAt: '2026-07-25T12:00:00.000Z',
          endAt: '2026-07-25T12:00:01.000Z',
          durationMs: 1000,
          bucketMs: 100,
          bucketsObserved: 10,
          topPhases: [
            {
              phase: 'telemetry.json_serialize',
              count: 100,
              totalDurationMs: 80,
              maxDurationMs: 4,
              totalBytes: 12000,
              samples: []
            }
          ]
        },
        activeHandleTypes: { Socket: 7, ChildProcess: 2 }
      }
    }
  },
  {
    type: 'session.stopped',
    timestamp: '2026-07-25T12:01:00.000Z',
    payload: {
      reason: 'SESSION_DURATION_EXCEEDED',
      stats: {
        pumpPortal: {
          eventHandlerConcurrency: 6,
          eventQueueDropped: 0,
          eventQueueDiscardedOnStop: 0,
          eventQueueHandlerErrors: 0,
          eventQueueDrainSchedules: 30,
          eventQueueDrainCalls: 30,
          eventQueueDrainItems: 120,
          eventQueueDrainYields: 20,
          eventQueueDrainMaxBatch: 6,
          eventQueueDrainMeanMs: 0.5,
          eventQueueDrainMaxMs: 3,
          eventQueueDrainOver50Ms: 0,
          eventQueueLatencySamples: 120,
          eventQueueLatencyMeanMs: 4,
          eventQueueLatencyMaxMs: 40
        },
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
          providerTradeTickBursts: {
            semantics: 'provider_trade_callbacks_grouped_until_next_setImmediate',
            ticks: 60,
            events: 120,
            meanEventsPerTick: 2,
            maxEventsPerTick: 6,
            histogram: {
              one: 30,
              twoToFour: 20,
              fiveToNine: 10,
              tenToTwentyFour: 0,
              twentyFiveToFortyNine: 0,
              fiftyPlus: 0
            },
            byProvider: {
              pumpportal: {
                ticksWithEvents: 60,
                events: 120,
                maxEventsPerTick: 6,
                meanEventsPerTick: 2
              }
            },
            openTickEvents: 0
          },
          gcPauses: {
            samples: 5,
            meanDurationMs: 3,
            maxDurationMs: 55,
            over50Ms: 1,
            byKind: { MAJOR: 1, MINOR: 4 }
          },
          workSampler: {
            bucketMs: 100,
            retainedBuckets: 300,
            samples: 1000,
            totalDurationMs: 500,
            maxDurationMs: 12,
            byPhase: {
              'telemetry.json_serialize': {
                count: 1000,
                totalDurationMs: 500,
                meanDurationMs: 0.5,
                maxDurationMs: 4,
                totalBytes: 120000
              }
            }
          }
        },
        solanaRpc: {
          transport: {
            childProcess: {
              spawnAttempts: 50,
              spawnErrors: 0,
              completed: 49,
              failed: 0,
              timedOut: 1,
              maxActive: 2,
              meanSpawnSyncMs: 4.1,
              maxSpawnSyncMs: 12.2,
              totalSpawnSyncMs: 205,
              spawnSyncOver10Ms: 1,
              meanLifetimeMs: 65,
              maxLifetimeMs: 10125,
              meanTimeoutCallbackLatenessMs: 125,
              maxTimeoutCallbackLatenessMs: 125,
              timeoutCallbacksLateOver100Ms: 1
            }
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
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.pumpPortalQueueDrain.maxBatch, 6);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.pumpPortalQueueDrain.maxQueueLatencyMs, 40);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.providerTradeTickBursts.maxEventsPerTick, 6);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.providerTradeTickBursts.histogram.fiftyPlus, 0);
  assert.strictEqual(report.summary.pumpPortalBurstControlValidation.verdict, 'BOUNDED_DRAIN_VALIDATED');
  assert.strictEqual(
    report.summary.pumpPortalBurstControlValidation.checks.providerBurstWithinConcurrency,
    true
  );
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.pumpBondingCurveQueueDrain.maxDurationMs, 60);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.gcPauses.maxDurationMs, 55);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.rpcChildTransport.maxSpawnSyncMs, 12.2);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.rpcChildTransport.totalSpawnSyncMs, 205);
  assert.strictEqual(
    report.summary.runtimePhaseDiagnostics.rpcChildTransportAssessment.candidate,
    'RPC_CHILD_PROCESS_PER_REQUEST_SPAWN_OVERHEAD_MEASURED'
  );
  assert.strictEqual(
    report.summary.runtimePhaseDiagnostics.rpcChildTransportAssessment.causalConclusionAllowed,
    false
  );
  assert(
    report.interpretation.some(
      (line) => line.includes('205 ms in the synchronous startup portion of 50 per-request spawn() calls')
    ),
    'interpretation should prioritize measured per-request child-process spawn() overhead'
  );
  assert.strictEqual(report.summary.stallContextCoverage.captured, 1);
  assert.strictEqual(report.summary.stallContextCoverage.workWindowCaptured, 1);
  assert.strictEqual(report.summary.stallContextCoverage.lagRowsWithActiveRpcChild, 1);
  assert.strictEqual(report.summary.topLagEvents[0].rpc.pendingRequests, 4);
  assert.strictEqual(report.summary.topLagEvents[0].workWindow.topPhases[0].phase, 'telemetry.json_serialize');
  assert.strictEqual(report.summary.topStallWindowPhases[0].totalDurationMs, 80);
  assert.strictEqual(report.summary.runtimePhaseDiagnostics.workSampler.samples, 1000);
  assert.deepStrictEqual(
    report.summary.runtimePhaseDiagnostics.attributionSemantics,
    {
      nestedPhaseDurationsMayDoubleCount: true,
      bucketOverlapAttributionIsUpperBound: true,
      causalConclusionAllowed: false
    }
  );
} finally {
  fs.rmSync(telemetryPath, { force: true });
}

console.log('Event-loop lag phase-diagnostic smoke passed');
