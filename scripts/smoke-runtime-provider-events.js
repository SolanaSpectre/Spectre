#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  countRuntimeProviderEvents,
  isRuntimeProviderEvent,
  runtimeProviderKind,
  runtimeProviderName
} = require('./lib/runtime-provider-events');

assert.strictEqual(isRuntimeProviderEvent('provider.helius_pumpfun.runtime_new_token', 'newToken'), true);
assert.strictEqual(isRuntimeProviderEvent({ type: 'provider.helius_pumpfun.runtime_trade' }, 'trade'), true);
assert.strictEqual(isRuntimeProviderEvent('provider.helius_pumpfun.shadow_trade', 'trade'), false);
assert.strictEqual(runtimeProviderKind('provider.pumpportal.migration'), 'migration');
assert.strictEqual(runtimeProviderName('provider.pumpdev.runtime_trade'), 'pumpdev');
assert.strictEqual(countRuntimeProviderEvents({
  'provider.helius_pumpfun.runtime_trade': 5,
  'provider.pumpportal.trade': 2,
  'provider.helius_pumpfun.shadow_trade': 99
}, 'trade'), 7);

console.log('Runtime provider event vocabulary smoke passed');
