'use strict';

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.accountCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload) {
  const raw = payload.quote?.spotPriceSol
    ?? payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: event.type || event.event || 'unknown',
    source: payload.source || payload.provider || event.type || event.event || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

function priceStats(rows) {
  const futurePrices = [];
  let maxPriceSol = null;
  for (const row of rows) {
    const price = Number(row.priceSol);
    if (Number.isFinite(price) && price > 0) {
      futurePrices.push(price);
      if (maxPriceSol === null || price > maxPriceSol) maxPriceSol = price;
    }
  }
  return {
    prices: futurePrices,
    maxPriceSol,
    distinctPriceCount: new Set(futurePrices.map((price) => price.toFixed(12))).size
  };
}

function buildOutcomeWindow(attempt, snapshots, seconds, options = {}) {
  const endMs = attempt.atMs + seconds * 1000;
  const rows = snapshots.filter((snapshot) => snapshot.atMs > attempt.atMs && snapshot.atMs <= endMs);
  const touchCurve = Number(options.referenceTouch?.curveProgress);
  if (!rows.length) {
    return {
      outcomeJoined: false,
      snapshotCount: 0,
      maxCurveProgress: null,
      maxCurveAt: null,
      curveDelta: null,
      crossed85: false,
      crossed90: false,
      crossed95: false,
      crossed100: false,
      maxPriceDeltaPct: null,
      priceJoinStatus: 'NO_FUTURE_SNAPSHOTS',
      priceSnapshotCount: 0,
      distinctPriceCount: 0,
      basePriceSol: numberOrNull(attempt.priceSol, 12),
      maxPriceSol: null,
      touchCurveAboveWindowMax: false,
      touchCurveWindowMaxDelta: null
    };
  }

  const baseCurve = Number(attempt.curveProgress);
  const basePrice = Number(attempt.priceSol);
  let maxCurveRow = null;
  let maxPriceDeltaPct = null;
  const prices = priceStats(rows);
  for (const row of rows) {
    if (!maxCurveRow || Number(row.curveProgress) > Number(maxCurveRow.curveProgress)) maxCurveRow = row;
    const price = Number(row.priceSol);
    if (Number.isFinite(basePrice) && basePrice > 0 && Number.isFinite(price) && price > 0) {
      const deltaPct = ((price - basePrice) / basePrice) * 100;
      if (maxPriceDeltaPct === null || deltaPct > maxPriceDeltaPct) maxPriceDeltaPct = deltaPct;
    }
  }
  const maxCurve = Number(maxCurveRow?.curveProgress);
  const touchCurveWindowMaxDelta = Number.isFinite(touchCurve) && Number.isFinite(maxCurve)
    ? touchCurve - maxCurve
    : null;

  let priceJoinStatus = 'OK';
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    priceJoinStatus = 'MISSING_BASE_PRICE';
  } else if (!prices.prices.length) {
    priceJoinStatus = 'MISSING_FUTURE_PRICE';
  } else if (prices.distinctPriceCount <= 1 && rows.length >= 10) {
    priceJoinStatus = 'STATIC_FUTURE_PRICE_SERIES';
  }

  return {
    outcomeJoined: true,
    snapshotCount: rows.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    maxCurveAt: maxCurveRow?.at || null,
    curveDelta: Number.isFinite(baseCurve) ? numberOrNull(maxCurve - baseCurve, 6) : null,
    crossed85: maxCurve >= 0.85,
    crossed90: maxCurve >= 0.9,
    crossed95: maxCurve >= 0.95,
    crossed100: maxCurve >= 1,
    maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 4),
    priceJoinStatus,
    priceSnapshotCount: prices.prices.length,
    distinctPriceCount: prices.distinctPriceCount,
    basePriceSol: numberOrNull(basePrice, 12),
    maxPriceSol: numberOrNull(prices.maxPriceSol, 12),
    touchCurveAboveWindowMax: Number.isFinite(touchCurveWindowMaxDelta) && touchCurveWindowMaxDelta > 0.02,
    touchCurveWindowMaxDelta: numberOrNull(touchCurveWindowMaxDelta, 6)
  };
}

function buildPreDecisionContext(attempt, snapshots, referenceTouch) {
  const touchAtMs = timestampMs(referenceTouch?.tradeAt || referenceTouch?.observedAt);
  if (!Number.isFinite(touchAtMs) || !Number.isFinite(attempt.atMs) || touchAtMs >= attempt.atMs) {
    return {
      joined: false,
      reason: 'NO_PRIOR_TOUCH_WINDOW',
      snapshotCount: 0
    };
  }
  const rows = snapshots.filter((snapshot) => snapshot.atMs >= touchAtMs && snapshot.atMs <= attempt.atMs);
  if (!rows.length) {
    return {
      joined: false,
      reason: 'NO_SNAPSHOTS_BETWEEN_TOUCH_AND_DECISION',
      touchAt: new Date(touchAtMs).toISOString(),
      decisionAt: new Date(attempt.atMs).toISOString(),
      snapshotCount: 0
    };
  }
  let maxCurveRow = null;
  for (const row of rows) {
    if (!maxCurveRow || Number(row.curveProgress) > Number(maxCurveRow.curveProgress)) maxCurveRow = row;
  }
  const prices = priceStats(rows);
  const touchCurve = Number(referenceTouch?.curveProgress);
  const decisionCurve = Number(attempt.curveProgress);
  const maxCurve = Number(maxCurveRow?.curveProgress);
  return {
    joined: true,
    reason: 'TOUCH_TO_DECISION_WINDOW',
    touchAt: new Date(touchAtMs).toISOString(),
    decisionAt: new Date(attempt.atMs).toISOString(),
    snapshotCount: rows.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    maxCurveAt: maxCurveRow?.at || null,
    touchCurveProgress: numberOrNull(touchCurve, 6),
    decisionCurveProgress: numberOrNull(decisionCurve, 6),
    touchToDecisionCurveDelta: Number.isFinite(touchCurve) && Number.isFinite(decisionCurve)
      ? numberOrNull(decisionCurve - touchCurve, 6)
      : null,
    maxToDecisionCurveDelta: Number.isFinite(maxCurve) && Number.isFinite(decisionCurve)
      ? numberOrNull(decisionCurve - maxCurve, 6)
      : null,
    fadedFromTouchBeforeDecision: Number.isFinite(touchCurve) && Number.isFinite(decisionCurve) && touchCurve - decisionCurve > 0.02,
    fadedFromPreDecisionMax: Number.isFinite(maxCurve) && Number.isFinite(decisionCurve) && maxCurve - decisionCurve > 0.02,
    maxPriceSol: numberOrNull(prices.maxPriceSol, 12),
    distinctPriceCount: prices.distinctPriceCount
  };
}

module.exports = {
  buildOutcomeWindow,
  buildPreDecisionContext,
  curveOf,
  mintOf,
  numberOrNull,
  payloadOf,
  priceOf,
  snapshotFromEvent,
  timestampMs
};
