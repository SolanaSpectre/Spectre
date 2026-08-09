#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Config = require('../src/config');
const WalletManager = require('../src/wallet');

const keys = [
  'EXECUTION_MODE',
  'HOT_WALLET_PRIVATE_KEY',
  'COLD_WALLET_ADDRESS',
  'PUMP_DATA_PROVIDER',
  'HELIUS_PUMPFUN_SHADOW_ENABLED',
  'HELIUS_PUMPFUN_DECISION_SHADOW_ENABLED',
  'HELIUS_STANDARD_WEBSOCKET_URL',
  'FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS',
  'FINALIST_ACCOUNT_VERIFIER_TTL_MS',
  'SESSION_DURATION_MINUTES'
];
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

function restore() {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

try {
  process.env.EXECUTION_MODE = 'PAPER';
  delete process.env.HOT_WALLET_PRIVATE_KEY;
  delete process.env.COLD_WALLET_ADDRESS;
  process.env.PUMP_DATA_PROVIDER = 'helius';
  process.env.HELIUS_PUMPFUN_SHADOW_ENABLED = 'true';
  process.env.HELIUS_PUMPFUN_DECISION_SHADOW_ENABLED = 'true';
  process.env.HELIUS_STANDARD_WEBSOCKET_URL = 'wss://example.invalid';
  process.env.FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS = '100';
  process.env.FINALIST_ACCOUNT_VERIFIER_TTL_MS = '120000';
  process.env.SESSION_DURATION_MINUTES = '60';

  assert.strictEqual(Config.hotWalletPrivateKey, null);
  assert.strictEqual(Config.coldWalletAddress, null);
  assert.doesNotThrow(() => Config.validate());

  const binding = WalletManager.createRuntimeWallet({ executionMode: 'PAPER' });
  assert.strictEqual(binding.identitySource, 'EPHEMERAL_PAPER');
  assert(WalletManager.validateAddress(binding.wallet.getAddress()));
  const coldBinding = WalletManager.resolveRuntimeColdWallet({
    executionMode: 'PAPER',
    paperFallbackAddress: binding.wallet.getAddress()
  });
  assert.strictEqual(coldBinding.identitySource, 'PAPER_HOT_WALLET_FALLBACK');
  assert.strictEqual(coldBinding.address, binding.wallet.getAddress());

  assert.throws(
    () => WalletManager.createRuntimeWallet({ executionMode: 'LIVE' }),
    /required outside PAPER mode/
  );
  assert.throws(
    () => WalletManager.resolveRuntimeColdWallet({ executionMode: 'LIVE' }),
    /required outside PAPER mode/
  );

  process.env.EXECUTION_MODE = 'DRY_RUN';
  assert.throws(
    () => Config.validate(),
    /HOT_WALLET_PRIVATE_KEY, COLD_WALLET_ADDRESS/
  );

  process.env.EXECUTION_MODE = 'PAPER';
  process.env.SESSION_DURATION_MINUTES = 'not-a-number';
  assert.throws(
    () => Config.validate(),
    /sessionDurationMinutes must be a finite number/
  );
} finally {
  restore();
}

console.log('Walletless PAPER and finite-number config smoke passed');
