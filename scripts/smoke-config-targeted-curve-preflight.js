#!/usr/bin/env node
'use strict';

const assert = require('assert');
const Config = require('../src/config');

const original = {
  executionMode: process.env.EXECUTION_MODE,
  subscriptionMode: process.env.PUMPPORTAL_TRADE_SUBSCRIPTION_MODE,
  runtimeRpcEnabled: process.env.PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED,
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
  delete process.env.COLD_WALLET_ADDRESS;

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
} finally {
  restore('EXECUTION_MODE', original.executionMode);
  restore('PUMPPORTAL_TRADE_SUBSCRIPTION_MODE', original.subscriptionMode);
  restore('PUMP_BONDING_CURVE_RUNTIME_RPC_ENABLED', original.runtimeRpcEnabled);
  restore('COLD_WALLET_ADDRESS', original.coldWalletAddress);
}

console.log('Targeted-curve config preflight smoke passed');
