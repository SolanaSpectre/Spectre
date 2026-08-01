'use strict';

function finiteNumber(value) {
  return value !== null
    && value !== undefined
    && value !== ''
    && Number.isFinite(Number(value));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function marketInputTelemetryMissingFields(inputs = {}) {
  const market = inputs.market || {};
  const checks = {
    score: finiteNumber(market.score),
    scoreCaptured: market.scoreCaptured === true,
    curveProgress: finiteNumber(market.curveProgress),
    curveProgressSource: nonEmptyString(market.curveProgressSource),
    recentVolumeSol: finiteNumber(market.recentVolumeSol),
    recentTradeCount: finiteNumber(market.recentTradeCount),
    tradeVelocityPerMin: finiteNumber(market.tradeVelocityPerMin),
    buyRatio: finiteNumber(market.buyRatio),
    buyRatioCaptured: market.buyRatioCaptured === true,
    uniqueBuyerCount: finiteNumber(market.uniqueBuyerCount),
    uniqueBuyerCountCaptured: market.uniqueBuyerCountCaptured === true,
    sniperWalletCount: finiteNumber(market.sniperWalletCount),
    sniperWalletCountCaptured: market.sniperWalletCountCaptured === true,
    sniperWalletCountSource: nonEmptyString(market.sniperWalletCountSource),
    sniperWindowAnchorAtMs: finiteNumber(market.sniperWindowAnchorAtMs),
    sniperWindowAnchorKind: nonEmptyString(market.sniperWindowAnchorKind),
    sniperWindowMs: finiteNumber(market.sniperWindowMs) && Number(market.sniperWindowMs) > 0
  };

  return Object.entries(checks)
    .filter(([, complete]) => complete !== true)
    .map(([field]) => field);
}

function marketInputTelemetryComplete(inputs = {}) {
  return marketInputTelemetryMissingFields(inputs).length === 0;
}

function sniperWindowAnchorControlMatches(actualInputs = {}, shadowInputs = {}) {
  const actual = actualInputs.market || {};
  const shadow = shadowInputs.market || {};
  return actual.sniperWindowAnchoredAtFirstObservation === true
    && shadow.sniperWindowAnchoredAtFirstObservation === true
    && actual.sniperWindowAnchorKind === 'first_trade'
    && shadow.sniperWindowAnchorKind === actual.sniperWindowAnchorKind
    && finiteNumber(actual.sniperWindowAnchorAtMs)
    && finiteNumber(shadow.sniperWindowAnchorAtMs)
    && Number(shadow.sniperWindowAnchorAtMs) === Number(actual.sniperWindowAnchorAtMs)
    && finiteNumber(actual.sniperWindowMs)
    && finiteNumber(shadow.sniperWindowMs)
    && Number(actual.sniperWindowMs) > 0
    && Number(shadow.sniperWindowMs) === Number(actual.sniperWindowMs);
}

function decisionShadowComparisonUnavailableReason({
  shadowStateFresh,
  shadowUnavailableReason = null,
  rawTransportGapAffected = false,
  accountTransportGapAffected = false,
  accountStateEnriched = false,
  counterfactual = null,
  actualGuardFamilyInputs = {},
  shadowGuardFamilyInputs = {},
  baselineControlConsumed = false
} = {}) {
  if (rawTransportGapAffected === true) {
    return 'HELIUS_SHADOW_TRANSPORT_GAP';
  }
  if (accountStateEnriched === true && accountTransportGapAffected === true) {
    return 'FINALIST_ACCOUNT_TRANSPORT_GAP';
  }
  if (shadowStateFresh !== true) {
    return shadowUnavailableReason || 'HELIUS_SHADOW_STATE_UNAVAILABLE';
  }
  if (!counterfactual || counterfactual.comparable === false) {
    return counterfactual?.reason || 'COUNTERFACTUAL_NOT_COMPARABLE';
  }
  if (!marketInputTelemetryComplete(actualGuardFamilyInputs)) {
    return 'INCOMPARABLE_ACTUAL_MARKET_INPUTS';
  }
  if (!marketInputTelemetryComplete(shadowGuardFamilyInputs)) {
    return 'INCOMPARABLE_SHADOW_MARKET_INPUTS';
  }
  if (!sniperWindowAnchorControlMatches(actualGuardFamilyInputs, shadowGuardFamilyInputs)) {
    return 'INCOMPARABLE_SNIPER_ANCHOR_CONTROL';
  }
  if (baselineControlConsumed !== true) {
    return 'COUNTERFACTUAL_BASELINE_NOT_CONSUMED';
  }
  return null;
}

module.exports = {
  decisionShadowComparisonUnavailableReason,
  marketInputTelemetryComplete,
  marketInputTelemetryMissingFields,
  sniperWindowAnchorControlMatches
};
