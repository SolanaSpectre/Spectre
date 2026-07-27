#!/usr/bin/env node
'use strict';

const assert = require('assert');
const PumpPortalListener = require('../src/pumpportal-listener');

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  const handled = [];
  const listener = new PumpPortalListener({
    pumpPortalEventHandlerConcurrency: 2,
    pumpPortalEventQueueMaxSize: 100
  }, {
    info() {},
    warn() {}
  });
  listener.handleMessage = async (payload) => {
    handled.push(payload.id);
  };

  for (let index = 0; index < 5; index += 1) {
    listener.enqueueMessage({ id: index }, 'tradestream');
  }

  assert.strictEqual(listener.stats.eventQueueDrainSchedules, 1);
  assert.strictEqual(listener.eventQueueDrainScheduled, true);
  assert.deepStrictEqual(handled, []);

  await immediate();
  assert.deepStrictEqual(handled, [0, 1]);

  while (listener.getStats().eventQueueProcessed < 5) {
    await immediate();
  }

  const stats = listener.getStats();
  assert.deepStrictEqual(handled, [0, 1, 2, 3, 4]);
  assert.strictEqual(stats.eventQueueDepth, 0);
  assert.strictEqual(stats.eventQueueProcessed, 5);
  assert.strictEqual(stats.eventQueueDropped, 0);
  assert.strictEqual(stats.eventQueueDrainCalls, 3);
  assert.strictEqual(stats.eventQueueDrainItems, 5);
  assert.strictEqual(stats.eventQueueDrainMaxBatch, 2);
  assert.strictEqual(stats.eventQueueDrainYields, 2);
  assert.strictEqual(stats.eventQueueLatencySamples, 5);
  assert(Number.isFinite(stats.eventQueueLatencyMeanMs));

  const stopped = new PumpPortalListener({
    pumpPortalEventHandlerConcurrency: 1,
    pumpPortalEventQueueMaxSize: 100
  }, {
    info() {},
    warn() {}
  });
  const stoppedHandled = [];
  stopped.handleMessage = async (payload) => {
    stoppedHandled.push(payload.id);
  };
  stopped.enqueueMessage({ id: 'discarded' }, 'tradestream');
  await stopped.stop();
  await immediate();
  assert.deepStrictEqual(stoppedHandled, []);
  assert.strictEqual(stopped.getStats().eventQueueDiscardedOnStop, 1);
  assert.strictEqual(stopped.eventQueueDrainScheduled, false);

  console.log('PumpPortal event queue smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
