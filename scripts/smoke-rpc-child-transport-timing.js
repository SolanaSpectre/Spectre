#!/usr/bin/env node
'use strict';

const assert = require('assert');
const SolanaRpcRouter = require('../src/lib/solana-rpc-router');

async function main() {
  const router = new SolanaRpcRouter({
    solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
    solanaRpcAccountReadTransport: 'child-https',
    solanaRpcAccountReadUrl: 'https://127.0.0.1:1',
    solanaRpcCallTimeoutMs: 1000,
    solanaRpcMaxConcurrentRequests: 1,
    solanaRpcMinRequestIntervalMs: 0
  }, {});

  try {
    await router.childHttpsRpc(router.primary, 'getAccountInfo', [
      '11111111111111111111111111111111',
      { encoding: 'base64', commitment: 'processed' }
    ]);
    assert.fail('closed local port must fail');
  } catch {
    const diagnostics = router.getChildTransportDiagnostics();
    assert.strictEqual(diagnostics.spawnAttempts, 1);
    assert.strictEqual(diagnostics.active, 0);
    assert.strictEqual(diagnostics.completed, 0);
    assert.strictEqual(diagnostics.failed + diagnostics.timedOut, 1);
    assert(Number.isFinite(diagnostics.meanSpawnSyncMs));
    assert(Number.isFinite(diagnostics.meanLifetimeMs));
    assert(diagnostics.maxActive >= 1);
    const stallSnapshot = router.getEventLoopDiagnostics();
    assert.strictEqual(stallSnapshot.childProcess.spawnAttempts, 1);
  } finally {
    router.httpAgent?.destroy?.();
  }

  console.log('RPC child-transport timing smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
