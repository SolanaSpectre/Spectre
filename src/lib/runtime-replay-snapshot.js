'use strict';

const crypto = require('crypto');

const CONFIG_GETTER_ALLOWLIST = [
  'executionMode',
  'sessionDurationMinutes',
  'preMigrationObservedTelemetryMinIntervalMs',
  'preMigrationObservedTelemetryMinScoreDelta',
  'preMigrationObservedTelemetryMinCurveDelta',
  'paperStartingBalanceSol',
  'maxOpenPaperPositions',
  'pumpDevFeedMode',
  'pumpDevDrivesPreMigration',
  'pumpDevMaxSubscribedMints',
  'pumpDevReconnectResubscribeMaxMints',
  'pumpDevReconnectResubscribeBatchSize',
  'pumpDevReconnectResubscribeBatchDelayMs',
  'pumpDevRateLimitCooldownMs',
  'pumpDevReconnectDelayResetAfterStableMs',
  'pumpPortalSplitSockets',
  'pumpPortalMaxSubscribedMints',
  'pumpPortalBackupOnly'
];

const CONFIG_GETTER_PREFIX_ALLOWLIST = [
  'preMigrationWatch',
  'preMigrationPaper',
  'postMigrationContinuation',
  'finalistAccountVerifier',
  'pumpDevTargetedCurveParity',
  'pumpBondingCurve'
];

const SECRET_PATTERN = /\b(sk-[A-Za-z0-9_-]{16,}|[A-Fa-f0-9]{64,}|[1-9A-HJ-NP-Za-km-z]{64,})\b/;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalize(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function configGetterNames(config) {
  const descriptors = Object.getOwnPropertyDescriptors(config);
  return Object.entries(descriptors)
    .filter(([, descriptor]) => typeof descriptor.get === 'function')
    .map(([name]) => name)
    .sort();
}

function isAllowedConfigGetter(name) {
  return CONFIG_GETTER_ALLOWLIST.includes(name)
    || CONFIG_GETTER_PREFIX_ALLOWLIST.some((prefix) => name.startsWith(prefix));
}

function buildSanitizedConfigSnapshot(config) {
  const values = {};
  for (const name of configGetterNames(config)) {
    if (!isAllowedConfigGetter(name)) continue;
    let value;
    try {
      value = config[name];
    } catch (error) {
      value = { unavailable: true, error: error.message };
    }
    if (typeof value === 'function') continue;
    values[name] = normalizeSnapshotValue(value);
  }
  const snapshot = {
    schemaVersion: 1,
    source: 'allowlisted_config_getters',
    values: canonicalize(values)
  };
  return {
    ...snapshot,
    configHash: sha256(canonicalJson(snapshot.values))
  };
}

function normalizeSnapshotValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeSnapshotValue);
  if (value && typeof value === 'object') {
    return canonicalize(Object.keys(value).reduce((acc, key) => {
      acc[key] = normalizeSnapshotValue(value[key]);
      return acc;
    }, {}));
  }
  return String(value);
}

function stableHashId(value) {
  if (!value) return null;
  return sha256(String(value)).slice(0, 16);
}

function sanitizeWalletRows(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const walletHash = stableHashId(row.wallet);
    return {
      wallet: walletHash,
      walletHash,
      name: row.name || null,
      label: row.label || null,
      confidence: finiteOrNull(row.confidence),
      side: row.side || null,
      phase: row.phase || null,
      tradeAt: row.tradeAt || null,
      reviewTier: row.reviewTier || null,
      evidenceTier: row.evidenceTier || null,
      solAmount: finiteOrNull(row.solAmount),
      curveProgress: finiteOrNull(row.curveProgress),
      secondsSinceCreate: finiteOrNull(row.secondsSinceCreate),
      shadowOnly: row.shadowOnly === true,
      trustedSignal: row.trustedSignal === true,
      untrustedRuntimeTape: row.untrustedRuntimeTape === true,
      untrustedReason: row.untrustedReason || null,
      launchIntelShortlistCandidate: row.launchIntelShortlistCandidate === true,
      launchIntelClassification: row.launchIntelClassification || null
    };
  });
}

function sanitizeWalletClassificationContext(context = null) {
  if (!context || typeof context !== 'object') return null;
  return {
    touched: context.touched === true,
    shadowTouched: context.shadowTouched === true,
    untrustedTouched: context.untrustedTouched === true,
    observedWalletTradeCount: finiteOrNull(context.observedWalletTradeCount),
    observedNonShadowWalletTradeCount: finiteOrNull(context.observedNonShadowWalletTradeCount),
    observedShadowWalletTradeCount: finiteOrNull(context.observedShadowWalletTradeCount),
    observedUntrustedWalletTradeCount: finiteOrNull(context.observedUntrustedWalletTradeCount),
    labelCounts: context.labelCounts && typeof context.labelCounts === 'object'
      ? canonicalize(context.labelCounts)
      : {},
    earlySniperCount: finiteOrNull(context.earlySniperCount),
    alphaScalperCount: finiteOrNull(context.alphaScalperCount),
    convictionWhaleCount: finiteOrNull(context.convictionWhaleCount),
    riskWalletCount: finiteOrNull(context.riskWalletCount),
    lateChaserCount: finiteOrNull(context.lateChaserCount),
    contextSource: context.contextSource || null,
    earliestTouchAt: context.earliestTouchAt || null,
    earliestBuyAt: context.earliestBuyAt || null,
    earliestShadowTouchAt: context.earliestShadowTouchAt || null,
    earliestShadowBuyAt: context.earliestShadowBuyAt || null,
    earliestUntrustedTouchAt: context.earliestUntrustedTouchAt || null,
    earliestUntrustedBuyAt: context.earliestUntrustedBuyAt || null,
    wallets: sanitizeWalletRows(context.wallets),
    shadowWallets: sanitizeWalletRows(context.shadowWallets),
    untrustedWallets: sanitizeWalletRows(context.untrustedWallets)
  };
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizePreMigrationLaneInput(state = {}, options = {}, seq = null) {
  return {
    schemaVersion: 1,
    seq,
    state: {
      ...state,
      walletClassificationContext: sanitizeWalletClassificationContext(
        state.walletClassificationContext || options.walletClassificationContext || null
      )
    },
    options: {
      flagged: options.flagged === true,
      timestamp: options.timestamp || null,
      walletClassificationContext: sanitizeWalletClassificationContext(options.walletClassificationContext || null)
    }
  };
}

function assertNoSecretLikeValues(value) {
  const serialized = JSON.stringify(stripHashFields(value));
  if (SECRET_PATTERN.test(serialized)) {
    throw new Error('Sanitized replay snapshot contains a secret-like value');
  }
  return true;
}

function stripHashFields(value) {
  if (Array.isArray(value)) return value.map(stripHashFields);
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((acc, key) => {
      if (/hash$/i.test(key)) return acc;
      acc[key] = stripHashFields(value[key]);
      return acc;
    }, {});
  }
  return value;
}

module.exports = {
  CONFIG_GETTER_ALLOWLIST,
  CONFIG_GETTER_PREFIX_ALLOWLIST,
  SECRET_PATTERN,
  assertNoSecretLikeValues,
  buildSanitizedConfigSnapshot,
  canonicalJson,
  sanitizePreMigrationLaneInput,
  sanitizeWalletClassificationContext,
  sha256
};
