'use strict';

const fs = require('fs');

const EPOCHS = Object.freeze({
  FULL_PAID_TAPE: 'FULL_PAID_TAPE',
  PAID_TAPE_TRUNCATED_BY_CAP: 'PAID_TAPE_TRUNCATED_BY_CAP',
  DISCOVERY_RPC_ONLY: 'DISCOVERY_RPC_ONLY',
  UNKNOWN: 'UNKNOWN'
});

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function scanTelemetryCoverage(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const decoder = new TextDecoder('utf8');
  let pending = '';
  let startMs = Infinity;
  let endMs = -Infinity;
  let budgetReachedAtMs = null;
  let budgetPayload = null;
  let tradeSubscriptionMode = null;
  let targetedTradeSubscriptionsAccepted = 0;
  let targetedTradeSubscriptionAcks = 0;
  let targetedTradeSubscriptionRejections = 0;
  let pumpPortalTradeEvents = 0;
  let malformedLines = 0;
  const visit = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    let event;
    try { event = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { malformedLines += 1; return; }
    const atMs = timestampMs(event?.payload?.timestamp || event?.data?.timestamp || event?.timestamp);
    if (Number.isFinite(atMs)) { startMs = Math.min(startMs, atMs); endMs = Math.max(endMs, atMs); }
    const type = event.type || event.event;
    const payload = event.payload || event.data || {};
    if (type === 'session.started') {
      tradeSubscriptionMode = payload.pumpPortalPaidTapePlan?.tradeSubscriptionMode || tradeSubscriptionMode;
    }
    if (type === 'provider.pumpportal.targeted_subscription') {
      targetedTradeSubscriptionsAccepted += 1;
    }
    if (type === 'provider.pumpportal.targeted_subscription_rejected') {
      targetedTradeSubscriptionRejections += 1;
    }
    if (type === 'provider.pumpportal.trade') {
      pumpPortalTradeEvents += 1;
    }
    if (type === 'session.stopping' || type === 'session.stopped') {
      const pumpPortalStats = payload.stats?.pumpPortal;
      tradeSubscriptionMode = pumpPortalStats?.tradeSubscriptionMode || tradeSubscriptionMode;
      targetedTradeSubscriptionsAccepted = Math.max(
        targetedTradeSubscriptionsAccepted,
        Number(pumpPortalStats?.targetedTradeSubscriptionAccepted || 0)
      );
      targetedTradeSubscriptionAcks = Math.max(
        targetedTradeSubscriptionAcks,
        Number(pumpPortalStats?.targetedTradeSubscriptionAcked || pumpPortalStats?.tokenTradeSubscriptionAcks || 0)
      );
      targetedTradeSubscriptionRejections = Math.max(
        targetedTradeSubscriptionRejections,
        Number(pumpPortalStats?.targetedTradeSubscriptionRejected || 0)
      );
      pumpPortalTradeEvents = Math.max(pumpPortalTradeEvents, Number(pumpPortalStats?.trades || 0));
    }
    if (type === 'provider.pumpportal.metered_budget_reached' && Number.isFinite(atMs)) {
      if (budgetReachedAtMs === null || atMs < budgetReachedAtMs) {
        budgetReachedAtMs = atMs;
        budgetPayload = payload;
      }
    }
  };
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) visit(line);
    }
    pending += decoder.decode();
    if (pending.trim()) visit(pending);
  } finally { fs.closeSync(fd); }
  const durationMinutes = Number.isFinite(startMs) && Number.isFinite(endMs) ? (endMs - startMs) / 60000 : null;
  const uncappedPaidTapeMinutes = Number.isFinite(startMs) && Number.isFinite(budgetReachedAtMs) ? Math.max(0, (budgetReachedAtMs - startMs) / 60000) : durationMinutes;
  const targetedTapeRequired = tradeSubscriptionMode === 'targeted_curve';
  const paidTapeDeliveryQualified = !targetedTapeRequired
    || (targetedTradeSubscriptionsAccepted > 0 && targetedTradeSubscriptionAcks > 0 && pumpPortalTradeEvents > 0);
  const paidTapeActivated = paidTapeDeliveryQualified;
  const fullPaidTapeMinutes = paidTapeActivated ? uncappedPaidTapeMinutes : 0;
  const discoveryRpcOnlyMinutes = Number.isFinite(endMs) && Number.isFinite(budgetReachedAtMs) ? Math.max(0, (endMs - budgetReachedAtMs) / 60000) : 0;
  return {
    telemetryPath: filePath,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    durationMinutes: durationMinutes === null ? null : Number(durationMinutes.toFixed(2)),
    paidTapeCapped: budgetReachedAtMs !== null,
    tradeSubscriptionMode,
    targetedTradeSubscriptionsAccepted,
    targetedTradeSubscriptionAcks,
    targetedTradeSubscriptionRejections,
    pumpPortalTradeEvents,
    paidTapeDeliveryQualified,
    paidTapeActivated,
    budgetReachedAt: budgetReachedAtMs === null ? null : new Date(budgetReachedAtMs).toISOString(),
    budgetReachedAtMs,
    fullPaidTapeMinutes: fullPaidTapeMinutes === null ? null : Number(fullPaidTapeMinutes.toFixed(2)),
    potentialFullPaidTapeMinutes: uncappedPaidTapeMinutes === null ? null : Number(uncappedPaidTapeMinutes.toFixed(2)),
    discoveryRpcOnlyMinutes: Number(discoveryRpcOnlyMinutes.toFixed(2)),
    budgetPayload,
    malformedLines
  };
}

function classifyDecision(atMs, budgetReachedAtMs) {
  const decisionMs = Number(atMs);
  if (!Number.isFinite(decisionMs)) return EPOCHS.UNKNOWN;
  if (!Number.isFinite(Number(budgetReachedAtMs))) return EPOCHS.FULL_PAID_TAPE;
  return decisionMs <= Number(budgetReachedAtMs) ? EPOCHS.FULL_PAID_TAPE : EPOCHS.DISCOVERY_RPC_ONLY;
}

function classifyOutcomeWindow(atMs, holdSeconds, budgetReachedAtMs) {
  const decisionEpoch = classifyDecision(atMs, budgetReachedAtMs);
  if (decisionEpoch !== EPOCHS.FULL_PAID_TAPE) return decisionEpoch;
  const endMs = Number(atMs) + Number(holdSeconds || 0) * 1000;
  return Number.isFinite(Number(budgetReachedAtMs)) && endMs > Number(budgetReachedAtMs)
    ? EPOCHS.PAID_TAPE_TRUNCATED_BY_CAP
    : EPOCHS.FULL_PAID_TAPE;
}

function summarizeRows(rows, budgetReachedAtMs, holdSeconds = 300) {
  const byDecisionEpoch = {};
  const byOutcomeCoverage = {};
  for (const row of rows || []) {
    const atMs = Number(row.atMs || timestampMs(row.at || row.entryAt));
    const decisionEpoch = classifyDecision(atMs, budgetReachedAtMs);
    const outcomeCoverage = classifyOutcomeWindow(atMs, holdSeconds, budgetReachedAtMs);
    byDecisionEpoch[decisionEpoch] = (byDecisionEpoch[decisionEpoch] || 0) + 1;
    byOutcomeCoverage[outcomeCoverage] = (byOutcomeCoverage[outcomeCoverage] || 0) + 1;
  }
  return { rows: (rows || []).length, holdSeconds, byDecisionEpoch, byOutcomeCoverage };
}

module.exports = { EPOCHS, classifyDecision, classifyOutcomeWindow, scanTelemetryCoverage, summarizeRows };
