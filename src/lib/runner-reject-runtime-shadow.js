'use strict';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNumber(value, digits = null) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function normalizeCurveProgress(value) {
  const curve = finiteNumber(value);
  if (curve === null) return null;
  if (curve > 1 && curve <= 100) return Number((curve / 100).toFixed(6));
  return Number(curve.toFixed(6));
}

function nestedSources(token = {}) {
  const raw = token.raw || {};
  const rawEvent = token.rawEvent || raw.rawEvent || {};
  const market = token.market || raw.market || {};
  const preMigrationState = token.preMigrationState || raw.preMigrationState || {};
  const bondingCurveState = token.bondingCurveState || raw.bondingCurveState || preMigrationState.bondingCurveState || {};
  return [
    { name: 'token', value: token },
    { name: 'token.raw', value: raw },
    { name: 'token.rawEvent', value: rawEvent },
    { name: 'token.market', value: market },
    { name: 'token.preMigrationState', value: preMigrationState },
    { name: 'token.bondingCurveState', value: bondingCurveState }
  ];
}

function firstCurveProgress(token = {}) {
  for (const source of nestedSources(token)) {
    const value = source.value || {};
    const raw = value.providerCurveProgress
      ?? value.curveProgress
      ?? value.bondingCurveProgress
      ?? value.progress
      ?? value.maxCurveProgress;
    const curveProgress = normalizeCurveProgress(raw);
    if (curveProgress !== null) {
      return { curveProgress, source: source.name };
    }
  }
  return { curveProgress: null, source: null };
}

function firstPriceSol(token = {}) {
  for (const source of nestedSources(token)) {
    const value = source.value || {};
    const raw = value.providerCurvePriceSol
      ?? value.bondingCurvePriceSol
      ?? value.curvePriceSol
      ?? value.priceSol;
    const priceSol = finiteNumber(raw);
    if (priceSol !== null && priceSol > 0) {
      return { priceSol: Number(priceSol.toFixed(12)), source: source.name };
    }
  }
  return { priceSol: null, source: null };
}

function runnerRejectRuntimeShadowMarketState(token = {}) {
  const curve = firstCurveProgress(token);
  const price = firstPriceSol(token);
  return {
    curveProgress: curve.curveProgress,
    curveProgressSource: curve.source,
    priceSol: price.priceSol,
    priceSolSource: price.source
  };
}

module.exports = {
  roundNumber,
  runnerRejectRuntimeShadowMarketState
};
