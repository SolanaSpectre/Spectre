#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { classifyAttribution, selectSamples } = require('./helius-pumpfun-trader-ground-truth-report');

const selected = selectSamples({ cohorts: [
  { mint: 'MintA', samples: [{ classification: 'IDENTITY_RESIDUE', signature: 'A1' }, { classification: 'IDENTITY_RESIDUE', signature: 'A2' }] },
  { mint: 'MintB', samples: [{ classification: 'IDENTITY_RESIDUE', signature: 'B1' }] }
] }, 3);
assert.deepStrictEqual(selected.map((row) => row.signature), ['A1', 'B1', 'A2']);

const transaction = {
  transaction: { message: { staticAccountKeys: [{ toBase58: () => 'PortalWallet' }] } },
  meta: { logMessages: [] }
};
const attribution = classifyAttribution({
  mint: 'MintA',
  side: 'buy',
  trader: 'PortalWallet',
  heliusTraderSamples: ['HeliusWallet']
}, transaction);
assert.strictEqual(attribution.classification, 'PUMPPORTAL_MATCHES_FEE_PAYER_ONLY');
assert.strictEqual(attribution.portalMatchesFeePayer, true);

console.log('Helius Pump.fun trader ground-truth smoke passed');
