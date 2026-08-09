#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SPECTRE_SKIP_DOTENV = 'true';

const Config = require('../src/config');
const HeliusPumpfunShadowListener = require('../src/helius-pumpfun-shadow-listener');
const TradingEngine = require('../src/trading-engine');
const LaunchIntelStore = require('../src/lib/launch-intel-store');
const {
  mapHeliusCreateToLaunchIntelEvent,
  mapHeliusTradeToLaunchIntelEvent
} = require('../src/lib/helius-launch-intel-adapter');
const {
  HeliusRuntimeEventQueue,
  classifyHeliusRuntimeEvent
} = require('../src/lib/helius-runtime-event-queue');

const ENV_KEYS = [
  'PUMP_DATA_PROVIDER',
  'PUMPPORTAL_ENABLED',
  'HELIUS_PUMPFUN_SHADOW_ENABLED',
  'LAUNCH_INTEL_SOURCE',
  'LAUNCH_INTEL_LATEST_FILE_PATH',
  'LAUNCH_INTEL_HISTORY_FILE_PATH',
  'LAUNCH_INTEL_DEPLOYER_INDEX_FILE_PATH',
  'LAUNCH_INTEL_WALLET_INDEX_FILE_PATH',
  'HELIUS_LAUNCH_INTEL_LATEST_FILE_PATH',
  'HELIUS_LAUNCH_INTEL_HISTORY_FILE_PATH',
  'HELIUS_LAUNCH_INTEL_DEPLOYER_INDEX_FILE_PATH',
  'HELIUS_LAUNCH_INTEL_WALLET_INDEX_FILE_PATH'
];

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) delete process.env[key];
    else process.env[key] = snapshot[key];
  }
}

async function main() {
  const envSnapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-helius-cutover-'));

  try {
    delete process.env.PUMP_DATA_PROVIDER;
    process.env.PUMPPORTAL_ENABLED = 'true';
    process.env.HELIUS_PUMPFUN_SHADOW_ENABLED = 'true';
    process.env.LAUNCH_INTEL_SOURCE = 'pumpportal';
    for (const key of ENV_KEYS.filter((key) => key.includes('FILE_PATH'))) delete process.env[key];

    assert.strictEqual(Config.pumpDataProvider, 'helius');
    assert.strictEqual(Config.pumpPortalRuntimeEnabled, false);
    assert.strictEqual(Config.heliusPumpfunRuntimeEnabled, true);
    assert.strictEqual(Config.launchIntelSource, 'helius');
    assert(Config.launchIntelLatestFilePath.includes(path.join('data', 'launch-intel', 'helius')));

    process.env.PUMP_DATA_PROVIDER = 'pumpportal';
    assert.strictEqual(Config.pumpPortalRuntimeEnabled, true);
    assert.strictEqual(Config.heliusPumpfunRuntimeEnabled, false);
    assert.strictEqual(Config.launchIntelSource, 'pumpportal');

    const startedProviders = [];
    await TradingEngine.prototype.startSelectedPumpDataProvider.call({
      config: { pumpDataProvider: 'helius' },
      logger: { info() {} },
      heliusPumpfunShadowListener: { start: async () => startedProviders.push('helius') },
      pumpPortalListener: { start: async () => startedProviders.push('pumpportal') },
      pumpDevListener: { start: async () => startedProviders.push('pumpdev') },
      armPumpDevPrimarySilenceWatchdog() {}
    }, Date.now());
    assert.deepStrictEqual(startedProviders, ['helius']);

    const lifecycleTelemetry = [];
    const lifecycleStops = [];
    TradingEngine.prototype.handleHeliusLifecycleEvent.call({
      config: { heliusPumpfunRuntimeEnabled: true },
      telemetry: { record: (type, payload) => lifecycleTelemetry.push({ type, payload }) },
      active: true,
      stopInProgress: false,
      stop: async (reason) => lifecycleStops.push(reason)
    }, 'provider.helius_pumpfun.shadow_event_queue_overflow', { dropped: 1 });
    assert.strictEqual(lifecycleTelemetry.length, 1);
    assert.deepStrictEqual(lifecycleStops, ['HELIUS_LISTENER_QUEUE_OVERFLOW']);

    const runtimeErrorTelemetry = [];
    const runtimeErrorStops = [];
    TradingEngine.prototype.handleHeliusRuntimeQueueError.call({
      telemetry: { record: (type, payload) => runtimeErrorTelemetry.push({ type, payload }) },
      active: true,
      stopInProgress: false,
      stop: async (reason) => runtimeErrorStops.push(reason)
    }, { errorName: 'TypeError', mint: 'BrokenMint' });
    assert.strictEqual(runtimeErrorTelemetry[0].type, 'provider.helius_pumpfun.runtime_handler_error');
    assert.deepStrictEqual(runtimeErrorStops, ['HELIUS_RUNTIME_HANDLER_ERROR']);

    const runtimeEvents = [];
    const runtimeListener = new HeliusPumpfunShadowListener({
      heliusPumpfunShadowEnabled: false,
      heliusPumpfunRuntimeEnabled: true,
      heliusStandardWebsocketUrl: 'wss://example.invalid',
      pumpBondingCurveProgramId: 'PumpProgram',
      heliusPumpfunShadowCommitment: 'processed'
    }, {
      info() {},
      warn() {}
    }, {
      onShadowEvent(type, payload) {
        runtimeEvents.push({ type, payload });
      }
    });
    runtimeListener.handleDecodedEvent({
      eventType: 'CompleteEvent',
      mint: 'MintRuntime',
      timestamp: '1700000000'
    }, {
      signature: 'CompleteSignature',
      slot: 1,
      receivedAt: '2026-08-08T00:00:00.000Z'
    });
    assert.strictEqual(runtimeEvents[0].payload.reportOnly, false);
    assert.strictEqual(runtimeEvents[0].payload.strategyConsumptionEnabled, true);
    assert.strictEqual(runtimeListener.getStats().strategyConsumptionEnabled, true);

    const mappedTrade = classifyHeliusRuntimeEvent('provider.helius_pumpfun.shadow_trade', {
      mint: 'MintRuntime'
    });
    assert.strictEqual(mappedTrade.kind, 'trade');
    assert.strictEqual(mappedTrade.event.source, 'helius_logs_trade_runtime');
    assert.strictEqual(mappedTrade.options.telemetryType, 'provider.helius_pumpfun.runtime_trade');
    assert.strictEqual(
      classifyHeliusRuntimeEvent('provider.helius_pumpfun.shadow_complete', { mint: 'MintRuntime' }).kind,
      'migration'
    );

    assert.deepStrictEqual(mapHeliusCreateToLaunchIntelEvent({
      mint: 'MintRuntime',
      symbol: 'RUNTIME',
      name: 'Runtime Token',
      creator: 'CreatorWallet',
      user: 'FallbackWallet',
      signature: 'CreateSignature',
      slot: '42',
      eventAt: '2026-08-08T12:00:00.000Z',
      strategyConsumptionEnabled: true
    }), {
      mint: 'MintRuntime',
      symbol: 'RUNTIME',
      name: 'Runtime Token',
      source: 'helius_pumpfun_runtime_create',
      creator: 'CreatorWallet',
      signature: 'CreateSignature',
      slot: 42,
      timestamp: Date.parse('2026-08-08T12:00:00.000Z')
    });
    assert.deepStrictEqual(mapHeliusTradeToLaunchIntelEvent({
      mint: 'MintRuntime',
      txType: 'BUY',
      user: 'TraderWallet',
      signature: 'TradeSignature',
      slot: '43',
      eventAt: '2026-08-08T12:00:01.000Z',
      solAmount: '1.25',
      virtualQuoteReservesUi: '31.5',
      strategyConsumptionEnabled: true
    }), {
      mint: 'MintRuntime',
      symbol: null,
      name: null,
      source: 'helius_pumpfun_runtime_trade',
      txType: 'buy',
      timestamp: Date.parse('2026-08-08T12:00:01.000Z'),
      slot: 43,
      traderPublicKey: 'TraderWallet',
      signature: 'TradeSignature',
      solAmount: 1.25,
      vSolInBondingCurve: 31.5
    });
    assert.strictEqual(
      mapHeliusTradeToLaunchIntelEvent({ mint: 'MintRuntime', txType: 'swap' }),
      null,
      'unsupported Helius trade sides must not enter launch intel'
    );

    const handled = [];
    let releaseCreate;
    const createGate = new Promise((resolve) => {
      releaseCreate = resolve;
    });
    const queue = new HeliusRuntimeEventQueue({
      enabled: true,
      handler: async (mapped) => {
        handled.push(`${mapped.kind}:start`);
        if (mapped.kind === 'new_token') await createGate;
        handled.push(`${mapped.kind}:end`);
      }
    });
    queue.enqueue('provider.helius_pumpfun.shadow_new_token', { mint: 'OrderedMint' });
    queue.enqueue('provider.helius_pumpfun.shadow_trade', { mint: 'OrderedMint' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(handled, ['new_token:start']);
    releaseCreate();
    assert.strictEqual(await queue.drain(1000), true);
    assert.deepStrictEqual(handled, [
      'new_token:start',
      'new_token:end',
      'trade:start',
      'trade:end'
    ]);
    assert.strictEqual(queue.getStats().pending, 0);

    const latestFilePath = path.join(tempRoot, 'latest.json');
    fs.writeFileSync(latestFilePath, JSON.stringify({ generatedAt: 'legacy', items: [{ mint: 'LegacyMint' }] }));
    const store = new LaunchIntelStore({
      launchIntelEnabled: true,
      launchIntelSource: 'helius',
      launchIntelLatestFilePath: latestFilePath,
      launchIntelHistoryFilePath: path.join(tempRoot, 'history.jsonl'),
      launchIntelDeployerIndexFilePath: path.join(tempRoot, 'deployer-index.json'),
      launchIntelWalletIndexFilePath: path.join(tempRoot, 'wallet-index.json'),
      launchIntelRuntimeFlushEnabled: false,
      launchIntelFlushIntervalMs: 0,
      launchIntelIndexFlushIntervalMs: 0,
      launchIntelMaxTrackedTokens: 100,
      launchIntelMaxEarlyBuys: 10,
      launchIntelSniperWindowMs: 4000,
      launchIntelBundlerWindowMs: 1500,
      launchIntelBundlerMinWallets: 4
    }, {
      warn() {}
    });
    assert.strictEqual(store.getStats().records, 0);
    assert.strictEqual(store.getStats().stateLoad.skippedLegacySourceLessFiles, 1);
    store.dirty = true;
    store.flush(true);
    assert.strictEqual(JSON.parse(fs.readFileSync(latestFilePath, 'utf8')).source, 'helius');
    await store.flushAsync();

    console.log('Helius runtime cutover smoke passed');
  } finally {
    restoreEnv(envSnapshot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
