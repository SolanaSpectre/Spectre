'use strict';

const BASE58_PUBKEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const PUMP_LIVE_READINESS = Object.freeze({
  posture: 'paper_only_research',
  upgrade: Object.freeze({
    name: 'Pump bonding curve and PumpSwap fee recipient upgrade',
    effectiveAtUtc: '2026-04-28T16:00:00Z',
    source: 'https://github.com/pump-fun/pump-public-docs/blob/main/docs/BREAKING_FEE_RECIPIENT.md',
    localDiscovery: 'c:\\Users\\rlmjr\\Downloads\\Telegram Desktop\\ChatExport_2026-05-01\\messages.html',
  }),
  programs: Object.freeze({
    pumpBondingCurve: Object.freeze({
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      source: 'https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md',
      spectreUse: 'read-only curve telemetry and paper diagnostics',
    }),
    pumpSwapAmm: Object.freeze({
      programId: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
      source: 'https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md',
      spectreUse: 'not used by the current Spectre executor',
    }),
  }),
  normalFeeRecipients: Object.freeze([
    '62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV',
    '7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ',
    '7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX',
    '9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz',
    'AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY',
    'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM',
    'FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz',
    'G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP',
  ]),
  reservedFeeRecipients: Object.freeze([
    'GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS',
    '4budycTjhs9fD6xw62VBducVTNgMgJJ5BgtKq7mAZwn6',
    '8SBKzEQU4nLSzcwF4a74F2iaUDQyTfjGndn6qUWBnrpR',
    '4UQeTP1T39KZ9Sfxzo3WR5skgsaP6NZa87BAkuazLEKH',
    '8sNeir4QsLsJdYpc9RZacohhK1Y5FLU3nC5LXgYB4aa6',
    'Fh9HmeLNUMVCvejxCtCL2DbYaRyBFVJ5xrWkLnMH6fdk',
    '463MEnMeGyJekNZFQSTUABBEbLnvMTALbT6ZmsxAbAdq',
    '6AUH3WEHucYZyC61hqpqYUWVto5qA5hjHuNQ32GNnNxA',
  ]),
  buybackFeeRecipients: Object.freeze([
    '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD',
    '9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7',
    'GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL',
    '3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR',
    '5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6',
    'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL',
    '5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD',
    'A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW',
  ]),
  instructionRequirements: Object.freeze({
    bondingCurve: Object.freeze({
      appliesTo: 'direct Pump bonding curve buy/sell instruction builders',
      preferredInstruction: 'buy_v2',
      accountCount: 27,
      addedAccounts: Object.freeze([
        Object.freeze({
          name: 'fee_recipient',
          source: 'choose any one upgraded fee recipient',
          writable: true,
        }),
      ]),
      expectedAccountCounts: Object.freeze({
        buy: 18,
        sellNonCashback: 16,
        sellCashback: 17,
      }),
    }),
    pumpSwapAmm: Object.freeze({
      appliesTo: 'direct PumpSwap AMM buy/sell instruction builders',
      addAfterAccount: 'pool-v2',
      addedAccounts: Object.freeze([
        Object.freeze({
          name: 'fee_recipient',
          source: 'choose any one upgraded fee recipient',
          writable: false,
        }),
        Object.freeze({
          name: 'fee_recipient_quote_mint_ata',
          source: 'ATA for the chosen fee recipient and quote mint',
          writable: true,
        }),
      ]),
      expectedAccountCounts: Object.freeze({
        buyNonCashback: 26,
        buyCashback: 27,
        sellNonCashback: 24,
        sellCashback: 26,
      }),
    }),
  }),
  sdkMinimums: Object.freeze({
    pumpSdk: '@pump-fun/pump-sdk@1.33.0',
    pumpSwapSdk: '@pump-fun/pump-swap-sdk@1.15.0',
  }),
  liveExecutorRules: Object.freeze([
    'Do not add a direct Pump bonding curve executor unless it validates the upgraded fee recipient account.',
    'Do not add a direct PumpSwap AMM executor unless it validates the fee recipient and quote-mint ATA accounts.',
    'Do not infer live-readiness from paper runs; paper scoring evidence and transaction construction compatibility are separate.',
    'Keep Token-2022 and account-count compatibility as explicit checks before any future LIVE executor work.',
  ]),
});

function validatePubkeyList(pubkeys) {
  const seen = new Set();
  const invalid = [];
  const duplicates = [];

  for (const pubkey of pubkeys) {
    if (!BASE58_PUBKEY_PATTERN.test(pubkey)) {
      invalid.push(pubkey);
    }
    if (seen.has(pubkey)) {
      duplicates.push(pubkey);
    }
    seen.add(pubkey);
  }

  return { invalid, duplicates };
}

function validatePumpLiveReadinessManifest(manifest = PUMP_LIVE_READINESS) {
  const issues = [];
  const normalFeeRecipientCheck = validatePubkeyList(manifest.normalFeeRecipients || []);
  const reservedFeeRecipientCheck = validatePubkeyList(manifest.reservedFeeRecipients || []);
  const buybackFeeRecipientCheck = validatePubkeyList(manifest.buybackFeeRecipients || []);
  const programIds = [
    manifest.programs?.pumpBondingCurve?.programId,
    manifest.programs?.pumpSwapAmm?.programId,
  ].filter(Boolean);
  const programIdCheck = validatePubkeyList(programIds);

  if ((manifest.normalFeeRecipients || []).length !== 8) {
    issues.push(`Expected 8 normal fee recipients, found ${(manifest.normalFeeRecipients || []).length}.`);
  }
  if ((manifest.reservedFeeRecipients || []).length !== 8) {
    issues.push(`Expected 8 reserved fee recipients, found ${(manifest.reservedFeeRecipients || []).length}.`);
  }
  if ((manifest.buybackFeeRecipients || []).length !== 8) {
    issues.push(`Expected 8 buyback fee recipients, found ${(manifest.buybackFeeRecipients || []).length}.`);
  }
  for (const invalid of [...normalFeeRecipientCheck.invalid, ...reservedFeeRecipientCheck.invalid, ...buybackFeeRecipientCheck.invalid]) {
    issues.push(`Invalid fee recipient pubkey format: ${invalid}`);
  }
  for (const duplicate of [...normalFeeRecipientCheck.duplicates, ...reservedFeeRecipientCheck.duplicates, ...buybackFeeRecipientCheck.duplicates]) {
    issues.push(`Duplicate fee recipient pubkey: ${duplicate}`);
  }
  for (const invalid of programIdCheck.invalid) {
    issues.push(`Invalid program id format: ${invalid}`);
  }
  if (manifest.instructionRequirements?.bondingCurve?.accountCount !== 27) {
    issues.push('Bonding curve buy_v2 account count should be 27.');
  }
  if (manifest.instructionRequirements?.pumpSwapAmm?.addedAccounts?.length !== 2) {
    issues.push('PumpSwap AMM requires exactly 2 added fee-recipient accounts after pool-v2.');
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function getPumpLiveReadinessReport(options = {}) {
  const directPumpExecutor = Boolean(options.directPumpExecutor);
  const directPumpSwapExecutor = Boolean(options.directPumpSwapExecutor);
  const validation = validatePumpLiveReadinessManifest();
  const blockers = [];

  if (!validation.ok) {
    blockers.push(...validation.issues);
  }
  if (directPumpExecutor) {
    blockers.push('Direct Pump bonding curve executor must prove upgraded fee-recipient account handling before LIVE use.');
  }
  if (directPumpSwapExecutor) {
    blockers.push('Direct PumpSwap AMM executor must prove fee-recipient and quote-mint ATA handling before LIVE use.');
  }

  return {
    ok: blockers.length === 0,
    posture: PUMP_LIVE_READINESS.posture,
    directPumpExecutor,
    directPumpSwapExecutor,
    blockers,
    note: 'Current Spectre paper runs do not construct direct Pump or PumpSwap live transactions.',
  };
}

module.exports = {
  PUMP_LIVE_READINESS,
  getPumpLiveReadinessReport,
  validatePumpLiveReadinessManifest,
};
