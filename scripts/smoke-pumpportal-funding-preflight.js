#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  checkPumpPortalFunding,
  projectedMeteredChargeSol,
  requiredStartingBalanceSol
} = require('./lib/pumpportal-funding-preflight');

async function main() {
  assert.strictEqual(projectedMeteredChargeSol(82000), 0.08);
  assert.strictEqual(projectedMeteredChargeSol(72000), 0.07);
  assert.strictEqual(projectedMeteredChargeSol(30000), 0.03);
  assert.strictEqual(projectedMeteredChargeSol(9999), 0);
  assert.strictEqual(projectedMeteredChargeSol(0), null);
  assert.strictEqual(requiredStartingBalanceSol({ maxMeteredTradeEvents: 82000 }), 0.105);
  assert.strictEqual(requiredStartingBalanceSol({ maxMeteredTradeEvents: 72000 }), 0.095);

  const baseEnv = {
    PUMPPORTAL_ENABLED: 'true',
    PUMP_PORTAL_API_KEY: 'smoke-key',
    PUMPPORTAL_FUNDED_WALLET_ADDRESS: '11111111111111111111111111111111',
    PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED: 'true',
    PUMPPORTAL_MAX_METERED_TRADE_EVENTS_PER_SESSION: '82000',
    PUMPPORTAL_PROVIDER_MIN_FUNDED_BALANCE_SOL: '0.02',
    PUMPPORTAL_FUNDING_PREFLIGHT_BUFFER_SOL: '0.005'
  };

  const passing = await checkPumpPortalFunding({
    env: baseEnv,
    getBalanceSol: async () => 0.11
  });
  assert.strictEqual(passing.status, 'PASS');
  assert.strictEqual(passing.requiredBalanceSol, 0.105);
  assert.strictEqual(passing.projectedChargeSol, 0.08);

  await assert.rejects(
    checkPumpPortalFunding({
      env: baseEnv,
      getBalanceSol: async () => 0.009078
    }),
    /has 0\.009078 SOL; at least 0\.105000 SOL is required/
  );

  const fakeKeyedRpcUrl = 'https://mainnet.example.invalid/?api-key=DO_NOT_LEAK_THIS_KEY';
  await assert.rejects(
    checkPumpPortalFunding({
      env: {
        ...baseEnv,
        PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED: 'false',
        SOLANA_RPC_URL: fakeKeyedRpcUrl
      },
      getBalanceSol: async () => {
        const error = new Error(`request to ${fakeKeyedRpcUrl} failed, reason: ENOTFOUND`);
        error.name = 'FetchError';
        throw error;
      }
    }),
    (error) => {
      assert.strictEqual(
        error.message,
        'PumpPortal funding preflight RPC balance read failed (FetchError)'
      );
      assert.strictEqual(error.message.includes(fakeKeyedRpcUrl), false);
      assert.strictEqual(error.message.includes('DO_NOT_LEAK_THIS_KEY'), false);
      return true;
    }
  );

  await assert.rejects(
    checkPumpPortalFunding({
      env: {
        ...baseEnv,
        PUMPPORTAL_FUNDED_WALLET_ADDRESS: ''
      },
      getBalanceSol: async () => {
        throw new Error('must not query without an address');
      }
    }),
    /PUMPPORTAL_FUNDED_WALLET_ADDRESS is required/
  );

  const optionalMissingAddress = await checkPumpPortalFunding({
    env: {
      ...baseEnv,
      PUMPPORTAL_FUNDED_WALLET_ADDRESS: '',
      PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED: 'false'
    },
    getBalanceSol: async () => {
      throw new Error('must not query without an address');
    }
  });
  assert.strictEqual(optionalMissingAddress.status, 'SKIPPED_NO_PUBLIC_WALLET_ADDRESS');

  await assert.rejects(
    checkPumpPortalFunding({
      env: {
        ...baseEnv,
        PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED: 'false',
        PUMPPORTAL_MAX_METERED_TRADE_EVENTS_PER_SESSION: '0'
      },
      getBalanceSol: async () => {
        throw new Error('must not query with an unbounded event budget');
      }
    }),
    /cannot bound an unlimited paid-tape session/
  );

  await assert.rejects(
    checkPumpPortalFunding({
      env: {
        ...baseEnv,
        PUMPPORTAL_FUNDED_WALLET_ADDRESS: 'not-a-solana-address'
      },
      getBalanceSol: async () => {
        throw new Error('must not query with an invalid public address');
      }
    }),
    (error) => {
      assert.strictEqual(
        error.message,
        'PUMPPORTAL_FUNDED_WALLET_ADDRESS is not a valid Solana public address'
      );
      return true;
    }
  );

  const paidTapeDisabled = await checkPumpPortalFunding({
    env: {
      ...baseEnv,
      PUMP_PORTAL_API_KEY: ''
    },
    getBalanceSol: async () => {
      throw new Error('must not query when paid tape is disabled');
    }
  });
  assert.strictEqual(paidTapeDisabled.status, 'SKIPPED_PAID_TAPE_DISABLED');

  console.log('PumpPortal funding preflight smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
