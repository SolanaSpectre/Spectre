#!/usr/bin/env node
'use strict';

process.env.SPECTRE_SKIP_DOTENV = 'true';

const Config = require('../src/config');
const {
  assertNoSecretLikeValues,
  buildSanitizedConfigSnapshot,
  sanitizePreMigrationLaneInput
} = require('../src/lib/runtime-replay-snapshot');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  const snapshot = buildSanitizedConfigSnapshot(Config);
  assert(snapshot.configHash && /^[a-f0-9]{64}$/.test(snapshot.configHash), 'configHash missing or invalid');
  assertNoSecretLikeValues(snapshot);

  const serialized = JSON.stringify(snapshot);
  [
    'hotWalletPrivateKey',
    'coldWalletPrivateKey',
    'coldWalletAddress',
    'solanaRpcUrl',
    'heliusParseApiKey',
    'pumpPortalApiKey',
    'jupiterApiKey',
    'telegramApiHash'
  ].forEach((needle) => {
    assert(!serialized.includes(needle), `snapshot leaked denied getter name: ${needle}`);
  });

  const wallet = '9y8rF1joocg3npT2Fbbx4mjfDsDr7WtXTurYLNkX1wiq';
  const laneInput = sanitizePreMigrationLaneInput({
    mint: 'Mint111111111111111111111111111111111111111',
    walletClassificationContext: {
      wallets: [{ wallet, label: 'CONVICTION_WHALE', side: 'buy' }],
      labelCounts: { CONVICTION_WHALE: 1 }
    }
  }, {
    flagged: true,
    timestamp: '2026-01-01T00:00:00.000Z'
  }, 1);
  const laneSerialized = JSON.stringify(laneInput);
  assert(!laneSerialized.includes(wallet), 'lane input leaked raw wallet address');
  assert(laneSerialized.includes('walletHash'), 'lane input did not preserve hashed wallet identity');
  assertNoSecretLikeValues(laneInput);

  console.log('[replay-snapshot] sanitized config and lane-input checks passed');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[replay-snapshot] ${error.message}`);
    process.exit(1);
  }
}
