'use strict';

const { forEachJsonlSync } = require('./jsonl');

const ALWAYS_RETAIN_TYPES = new Set([
  'pre_migration.flagged',
  'pre_migration_paper.decision',
  'pre_migration_paper.entry',
  'pre_migration_paper.exit'
]);

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function typeOf(event = {}) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function compactReplayEvent(event = {}) {
  const type = typeOf(event);
  const payload = payloadOf(event);
  const timestamp = event.timestamp || payload.timestamp || null;
  const mint = payload.mint || payload.token || payload.mintAddress || null;
  const price = finite(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
  if (!timestamp || !mint || (!ALWAYS_RETAIN_TYPES.has(type) && !(price > 0))) {
    return null;
  }

  return {
    type,
    timestamp,
    payload: {
      mint,
      symbol: payload.symbol || null,
      bondingCurvePriceSol: finite(payload.bondingCurvePriceSol),
      priceSol: finite(payload.priceSol),
      curvePriceSol: finite(payload.curvePriceSol),
      curveProgress: finite(payload.curveProgress),
      score: finite(payload.score),
      recentVolumeSol: finite(payload.recentVolumeSol),
      tradeVelocityPerMin: finite(payload.tradeVelocityPerMin),
      virtualSolReservesSol: finite(payload.virtualSolReservesSol),
      realSolReservesSol: finite(payload.realSolReservesSol),
      lane: payload.lane || null,
      profileName: payload.profileName || null,
      preset: payload.preset || null,
      decision: payload.decision || null,
      reason: payload.reason || null,
      reasons: Array.isArray(payload.reasons) ? payload.reasons.slice(0, 20) : [],
      uniqueBuyerCount: finite(payload.uniqueBuyerCount),
      uniqueBuyerRatio: finite(payload.uniqueBuyerRatio),
      sniperWalletCount: finite(payload.sniperWalletCount),
      curveProgressDelta: finite(payload.curveProgressDelta),
      curveProgressDelta60s: finite(payload.curveProgressDelta60s),
      baselineCurveProgress: finite(payload.baselineCurveProgress),
      baselineCurveProgress60s: finite(payload.baselineCurveProgress60s),
      baselineAt: payload.baselineAt || null
    }
  };
}

function readReplayEventStream(filePath) {
  const events = [];
  const eventCounts = {};
  let firstTimestamp = null;
  let lastTimestamp = null;
  const readStats = forEachJsonlSync(filePath, (event) => {
    const type = typeOf(event);
    const timestamp = event.timestamp || payloadOf(event).timestamp || null;
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    if (timestamp && (!firstTimestamp || timestamp < firstTimestamp)) firstTimestamp = timestamp;
    if (timestamp && (!lastTimestamp || timestamp > lastTimestamp)) lastTimestamp = timestamp;
    const compactEvent = compactReplayEvent(event);
    if (compactEvent) events.push(compactEvent);
  });

  return {
    events,
    run: {
      firstTimestamp,
      lastTimestamp,
      eventCounts,
      sourceRows: readStats.rows,
      retainedRows: events.length,
      malformedLines: readStats.malformedLines
    }
  };
}

module.exports = {
  ALWAYS_RETAIN_TYPES,
  compactReplayEvent,
  readReplayEventStream
};
