'use strict';

const { forEachJsonlSync } = require('./jsonl');
const { isRuntimeProviderEvent, runtimeProviderName } = require('./runtime-provider-events');

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function scanHeliusRuntimeCoverage(telemetryPath) {
  let sessionStartedAtMs = null;
  let sessionCoverageEndedAtMs = null;
  let sessionStoppedAtMs = null;
  let coverageStartedAtMs = null;
  let activeCoverageStartedAtMs = null;
  let coveredMs = 0;
  let activeTransportGap = false;
  let stoppingStats = null;
  let selectedProvider = null;
  let launchIntelSource = null;
  let subscriptionAcks = 0;
  let disconnects = 0;
  let transportGapsStarted = 0;
  let transportGapsRecovered = 0;
  let runtimeNewTokens = 0;
  let runtimeTrades = 0;
  let runtimeMigrations = 0;
  let legacyRuntimeEvents = 0;

  const closeCoverage = (atMs) => {
    if (!Number.isFinite(activeCoverageStartedAtMs) || !Number.isFinite(atMs)) return;
    coveredMs += Math.max(0, atMs - activeCoverageStartedAtMs);
    activeCoverageStartedAtMs = null;
  };

  forEachJsonlSync(telemetryPath, (event) => {
    const type = String(event.type || '');
    const payload = event.payload || event.data || {};
    const atMs = timestampMs(event.timestamp || payload.timestamp);

    if (type === 'session.started') {
      sessionStartedAtMs = atMs;
      selectedProvider = payload.pumpDataPlan?.provider || null;
      launchIntelSource = payload.pumpDataPlan?.launchIntelSource || null;
    } else if (type === 'session.stopping') {
      sessionCoverageEndedAtMs = atMs;
      stoppingStats = payload.stats || stoppingStats;
      closeCoverage(atMs);
    } else if (type === 'session.stopped') {
      sessionStoppedAtMs = atMs;
      stoppingStats = payload.stats || stoppingStats;
      if (!Number.isFinite(sessionCoverageEndedAtMs)) {
        sessionCoverageEndedAtMs = atMs;
        closeCoverage(atMs);
      }
    } else if (type === 'provider.helius_pumpfun.shadow_subscription_ack') {
      subscriptionAcks += 1;
      if (!Number.isFinite(coverageStartedAtMs)) coverageStartedAtMs = atMs;
      if (payload.recoveredTransportGapSequence !== null
        && payload.recoveredTransportGapSequence !== undefined) {
        if (activeTransportGap) transportGapsRecovered += 1;
        activeTransportGap = false;
      }
      if (!activeTransportGap && !Number.isFinite(activeCoverageStartedAtMs)) {
        activeCoverageStartedAtMs = atMs;
      }
    } else if (type === 'provider.helius_pumpfun.shadow_transport_gap_started') {
      transportGapsStarted += 1;
      activeTransportGap = true;
      closeCoverage(atMs);
    } else if (type === 'provider.helius_pumpfun.shadow_transport_gap_closed') {
      if (activeTransportGap) transportGapsRecovered += 1;
      activeTransportGap = false;
      if (subscriptionAcks > 0 && !Number.isFinite(activeCoverageStartedAtMs)) {
        activeCoverageStartedAtMs = atMs;
      }
    } else if (type === 'provider.helius_pumpfun.shadow_disconnected' && payload.shutdownDisconnect !== true) {
      disconnects += 1;
      if (!activeTransportGap) transportGapsStarted += 1;
      activeTransportGap = true;
      closeCoverage(atMs);
    }

    if (isRuntimeProviderEvent(type, 'newToken')) {
      if (runtimeProviderName(type) === 'helius') runtimeNewTokens += 1;
      else legacyRuntimeEvents += 1;
    } else if (isRuntimeProviderEvent(type, 'trade')) {
      if (runtimeProviderName(type) === 'helius') runtimeTrades += 1;
      else legacyRuntimeEvents += 1;
    } else if (isRuntimeProviderEvent(type, 'migration')) {
      if (runtimeProviderName(type) === 'helius') runtimeMigrations += 1;
      else legacyRuntimeEvents += 1;
    }
  });

  if (Number.isFinite(activeCoverageStartedAtMs) && Number.isFinite(sessionCoverageEndedAtMs)) {
    closeCoverage(sessionCoverageEndedAtMs);
  }

  const listener = stoppingStats?.heliusPumpfunShadow || {};
  const queue = stoppingStats?.heliusPumpfunRuntime || {};
  const durationMs = Number.isFinite(sessionStartedAtMs) && Number.isFinite(sessionCoverageEndedAtMs)
    ? Math.max(0, sessionCoverageEndedAtMs - sessionStartedAtMs)
    : null;
  const fullCoverageMinutes = coveredMs / 60_000;
  const uncoveredMinutes = Number.isFinite(durationMs)
    ? Math.max(0, durationMs - coveredMs) / 60_000
    : null;

  return {
    telemetryPath,
    selectedProvider,
    launchIntelSource,
    sessionStartedAt: Number.isFinite(sessionStartedAtMs) ? new Date(sessionStartedAtMs).toISOString() : null,
    sessionCoverageEndedAt: Number.isFinite(sessionCoverageEndedAtMs)
      ? new Date(sessionCoverageEndedAtMs).toISOString()
      : null,
    sessionStoppedAt: Number.isFinite(sessionStoppedAtMs) ? new Date(sessionStoppedAtMs).toISOString() : null,
    coverageStartedAt: Number.isFinite(coverageStartedAtMs) ? new Date(coverageStartedAtMs).toISOString() : null,
    fullCoverageMinutes,
    uncoveredMinutes,
    subscriptionAcks,
    disconnects,
    transportGapsStarted: Math.max(transportGapsStarted, Number(listener.transportGapsStarted || 0)),
    transportGapsRecovered: Math.max(transportGapsRecovered, Number(listener.transportGapsRecovered || 0)),
    transportGapActiveAtStop: activeTransportGap || listener.transportGapActive === true,
    runtimeNewTokens,
    runtimeTrades,
    runtimeMigrations,
    runtimeEvents: runtimeNewTokens + runtimeTrades + runtimeMigrations,
    legacyRuntimeEvents,
    listenerEnabled: listener.enabled === true,
    strategyConsumptionEnabled: listener.strategyConsumptionEnabled === true,
    subscriptionReadyAtStop: listener.subscriptionReady === true,
    listenerQueueDropped: Number(listener.eventQueueDropped || 0),
    listenerQueueHandlerErrors: Number(listener.eventQueueHandlerErrors || 0),
    listenerQueueStopDrainTimedOut: listener.eventQueueStopDrainTimedOut === true,
    runtimeQueueOverflowRejected: Number(queue.overflowRejected || 0),
    runtimeQueueHandlerErrors: Number(queue.handlerErrors || 0),
    runtimeQueuePendingAtStop: Number(queue.pending || 0),
    runtimeQueueDrainTimeouts: Number(queue.drainTimeouts || 0),
    stoppingStats
  };
}

module.exports = {
  scanHeliusRuntimeCoverage
};
