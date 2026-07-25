#!/usr/bin/env node
'use strict';

const assert = require('assert');
const HeliusPumpfunShadowListener = require('../src/helius-pumpfun-shadow-listener');

async function main() {
  const handled = [];
  const lifecycle = [];
  const listener = new HeliusPumpfunShadowListener({
    heliusPumpfunShadowEnabled: false,
    pumpBondingCurveProgramId: 'PumpProgram',
    heliusPumpfunShadowEventQueueMaxSize: 100,
    heliusPumpfunShadowEventQueueBatchSize: 2
  }, {
    info() {},
    warn() {}
  }, {
    onLifecycle(type, payload) {
      lifecycle.push({ type, payload });
    }
  });
  listener.handleRawMessage = (raw, receivedAtMs) => {
    handled.push({ value: raw.toString(), receivedAtMs });
  };

  const receiptAt = Date.now() - 5;
  for (let index = 0; index < 5; index += 1) {
    assert.strictEqual(listener.enqueueRawMessage(Buffer.from(String(index)), receiptAt + index), true);
  }
  await listener.drainEventQueueBeforeStop();
  assert.deepStrictEqual(handled.map((row) => row.value), ['0', '1', '2', '3', '4']);
  assert.strictEqual(handled[0].receivedAtMs, receiptAt);
  const drainedStats = listener.getStats();
  assert.strictEqual(drainedStats.eventQueueProcessed, 5);
  assert.strictEqual(drainedStats.eventQueueDropped, 0);
  assert.strictEqual(drainedStats.eventQueueDepth, 0);
  assert(drainedStats.eventQueueDrainYields >= 2);

  const saturated = new HeliusPumpfunShadowListener({
    heliusPumpfunShadowEnabled: false,
    pumpBondingCurveProgramId: 'PumpProgram',
    heliusPumpfunShadowEventQueueMaxSize: 100,
    heliusPumpfunShadowEventQueueBatchSize: 1
  }, {
    info() {},
    warn() {}
  }, {
    onLifecycle(type, payload) {
      lifecycle.push({ type, payload });
    }
  });
  saturated.handleRawMessage = () => {};
  for (let index = 0; index < 101; index += 1) {
    saturated.enqueueRawMessage(Buffer.from(String(index)), Date.now());
  }
  assert.strictEqual(saturated.getStats().eventQueueDropped, 1);
  assert(lifecycle.some((row) => row.type === 'provider.helius_pumpfun.shadow_event_queue_overflow'));
  await saturated.drainEventQueueBeforeStop();

  console.log('Helius Pump.fun shadow queue smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
