#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Config = require('../src/config');

const original = {
  executionMode: process.env.EXECUTION_MODE,
  subscriptionMode: process.env.PUMPPORTAL_TRADE_SUBSCRIPTION_MODE,
  runtimeRpcEnabled: process.env.PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED,
  heliusShadowEnabled: process.env.HELIUS_PUMPFUN_SHADOW_ENABLED,
  heliusDecisionShadowEnabled: process.env.HELIUS_PUMPFUN_DECISION_SHADOW_ENABLED,
  finalistMaxSubscriptions: process.env.FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS,
  finalistTtlMs: process.env.FINALIST_ACCOUNT_VERIFIER_TTL_MS,
  pumpDevShadowEnabled: process.env.PUMPDEV_SHADOW_ENABLED,
  coldWalletAddress: process.env.COLD_WALLET_ADDRESS
};

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

try {
  process.env.EXECUTION_MODE = 'PAPER';
  process.env.PUMPPORTAL_TRADE_SUBSCRIPTION_MODE = 'targeted_curve';
  process.env.PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED = 'false';
  process.env.HELIUS_PUMPFUN_SHADOW_ENABLED = 'false';
  delete process.env.PUMPDEV_SHADOW_ENABLED;
  delete process.env.COLD_WALLET_ADDRESS;

  assert.strictEqual(Config.pumpDevShadowEnabled, false, 'PumpDev shadow must default off');
  process.env.PUMPDEV_SHADOW_ENABLED = 'true';
  assert.strictEqual(Config.pumpDevShadowEnabled, true, 'PumpDev shadow must require explicit opt-in');
  process.env.PUMPDEV_SHADOW_ENABLED = 'false';

  assert.throws(
    () => Config.validate(),
    /targeted_curve requires PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED=true/,
    'targeted curve mode must refuse startup when runtime curve RPC is disabled'
  );

  process.env.PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED = 'true';
  assert.doesNotThrow(() => Config.validate());

  process.env.PUMPPORTAL_TRADE_SUBSCRIPTION_MODE = 'all_discovered';
  process.env.PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED = 'false';
  assert.doesNotThrow(() => Config.validate());

  process.env.PUMPPORTAL_TRADE_SUBSCRIPTION_MODE = 'targeted_curve';
  process.env.PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED = 'true';
  process.env.HELIUS_PUMPFUN_SHADOW_ENABLED = 'true';
  process.env.HELIUS_PUMPFUN_DECISION_SHADOW_ENABLED = 'true';
  process.env.FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS = '99';
  process.env.FINALIST_ACCOUNT_VERIFIER_TTL_MS = '120000';
  assert.throws(
    () => Config.validate(),
    /FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS>=100/,
    'Helius V6 must refuse PAPER startup below measured subscription-capacity headroom'
  );
  process.env.FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS = '100';
  assert.doesNotThrow(() => Config.validate());
  process.env.FINALIST_ACCOUNT_VERIFIER_TTL_MS = '180000';
  assert.throws(
    () => Config.validate(),
    /FINALIST_ACCOUNT_VERIFIER_TTL_MS=120000/,
    'Helius V6 must refuse PAPER startup when runtime TTL differs from the frozen capacity window'
  );
  process.env.FINALIST_ACCOUNT_VERIFIER_TTL_MS = '120000';
  assert.doesNotThrow(() => Config.validate());
} finally {
  restore('EXECUTION_MODE', original.executionMode);
  restore('PUMPPORTAL_TRADE_SUBSCRIPTION_MODE', original.subscriptionMode);
  restore('PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED', original.runtimeRpcEnabled);
  restore('HELIUS_PUMPFUN_SHADOW_ENABLED', original.heliusShadowEnabled);
  restore('HELIUS_PUMPFUN_DECISION_SHADOW_ENABLED', original.heliusDecisionShadowEnabled);
  restore('FINALIST_ACCOUNT_VERIFIER_MAX_SUBSCRIPTIONS', original.finalistMaxSubscriptions);
  restore('FINALIST_ACCOUNT_VERIFIER_TTL_MS', original.finalistTtlMs);
  restore('PUMPDEV_SHADOW_ENABLED', original.pumpDevShadowEnabled);
  restore('COLD_WALLET_ADDRESS', original.coldWalletAddress);
}

console.log('Targeted-curve config preflight smoke passed');
