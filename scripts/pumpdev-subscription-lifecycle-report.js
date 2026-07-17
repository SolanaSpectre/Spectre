#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-subscription-lifecycle-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildReport(filePath) {
  let finalStats = null;
  let replayConfig = null;
  const lifecycleCounts = {};
  const subscriptionErrorReasons = {};
  const subscriptionAckMethods = {};
  const parseStats = forEachJsonlSync(filePath, (event) => {
    const type = event.type || event.event || 'unknown';
    const payload = event.payload || event.data || {};
    if (type === 'session.started') {
      replayConfig = payload.replayConfigSnapshot?.values || null;
    }
    if (type.startsWith('provider.pumpdev.subscription_') || type === 'provider.pumpdev.unsubscription_ack') {
      lifecycleCounts[type] = (lifecycleCounts[type] || 0) + 1;
    }
    if (type === 'provider.pumpdev.subscription_error') {
      const reason = String(payload.message || 'unknown').slice(0, 500);
      subscriptionErrorReasons[reason] = (subscriptionErrorReasons[reason] || 0) + 1;
    }
    if (type === 'provider.pumpdev.subscription_ack') {
      const method = payload.method || 'unknown';
      subscriptionAckMethods[method] = (subscriptionAckMethods[method] || 0) + 1;
    }
    if (type === 'session.stopping' || type === 'session.stopped') {
      const candidate = event.payload?.stats?.pumpDev || event.data?.stats?.pumpDev;
      if (candidate) finalStats = candidate;
    }
  });

  const stats = finalStats || {};
  const newTokens = number(stats.newTokens);
  const subscribedMints = number(stats.subscribedMints);
  const pendingSubscriptionMints = number(stats.pendingSubscriptionMints);
  const queuedSubscriptionMints = number(stats.queuedSubscriptionMints);
  const maxSubscribedMints = number(stats.maxSubscribedMints);
  const effectiveMaxSubscribedMints = Number.isFinite(Number(stats.effectiveMaxSubscribedMints))
    ? Number(stats.effectiveMaxSubscribedMints)
    : maxSubscribedMints;
  const subscribeFrames = number(stats.tokenTradeSubscribeFrames);
  const subscribeCandidates = Number.isFinite(Number(stats.tokenTradeSubscribeCandidates))
    ? Number(stats.tokenTradeSubscribeCandidates)
    : newTokens;
  const skippedAtCapObserved = Number.isFinite(Number(stats.tokenTradeSubscribeSkippedAtCap));
  const skippedAtCap = skippedAtCapObserved
    ? Number(stats.tokenTradeSubscribeSkippedAtCap)
    : Math.max(0, subscribeCandidates - subscribeFrames);
  const productivity = stats.subscriptionProductivity || null;
  const ackObserved = Number.isFinite(Number(stats.subscriptionAckMessages));
  const ackMessages = ackObserved
    ? Number(stats.subscriptionAckMessages)
    : number(lifecycleCounts['provider.pumpdev.subscription_ack']);
  const zeroTradeShare = productivity?.slots
    ? number(productivity.zeroTradeSlots) / number(productivity.slots)
    : null;
  const capSaturated = maxSubscribedMints > 0 && subscribedMints >= maxSubscribedMints;
  const queueDropped = number(stats.eventQueueDropped);
  const sendFailures = number(stats.tokenTradeSubscribeSendFailures);
  const subscriptionErrorsObserved = Number.isFinite(Number(stats.subscriptionErrorMessages));
  const subscriptionErrors = subscriptionErrorsObserved
    ? Number(stats.subscriptionErrorMessages)
    : number(lifecycleCounts['provider.pumpdev.subscription_error']);
  const anonymousTierLimitErrors = Object.entries(subscriptionErrorReasons)
    .filter(([reason]) => /anonymous tier allows 5 live subscriptions/i.test(reason))
    .reduce((sum, [, count]) => sum + count, 0);
  const ackGatedBookkeeping = Number.isFinite(Number(stats.tokenTradeSubscriptionAcks));
  const acknowledgedSubscriptions = ackGatedBookkeeping
    ? Number(stats.tokenTradeSubscriptionAcks)
    : number(subscriptionAckMethods.subscribeTokenTrade);
  const rejectedSubscriptions = Number.isFinite(Number(stats.tokenTradeSubscriptionRejects))
    ? Number(stats.tokenTradeSubscriptionRejects)
    : subscriptionErrors;
  const trustedActiveMints = ackGatedBookkeeping ? subscribedMints : acknowledgedSubscriptions;
  const trustedEffectiveMaxSubscribedMints = ackGatedBookkeeping
    ? effectiveMaxSubscribedMints
    : (anonymousTierLimitErrors > 0 ? Math.max(1, acknowledgedSubscriptions) : effectiveMaxSubscribedMints);
  const pumpDevPrimary = replayConfig?.pumpDevDrivesPreMigration === true
    && replayConfig?.pumpDevFeedMode === 'primary';
  const pumpPortalBackupOnly = replayConfig?.pumpPortalBackupOnly === true;
  const tradeFeatureDependency = pumpDevPrimary && pumpPortalBackupOnly
    ? 'PUMPDEV_LOAD_BEARING_FOR_TRADE_DERIVED_DECISION_FEATURES'
    : pumpDevPrimary
      ? 'PUMPDEV_PRIMARY_WITH_PUMPPORTAL_RUNTIME_PATH_AVAILABLE'
      : 'PUMPDEV_SHADOW_OR_SECONDARY_NOT_LOAD_BEARING';

  let verdict = 'INSUFFICIENT_SUBSCRIPTION_LIFECYCLE_DATA';
  if (queueDropped > 0) verdict = 'EVENT_QUEUE_DROPS_PRESENT';
  else if (anonymousTierLimitErrors > 0) verdict = 'ANONYMOUS_TIER_FIVE_SUBSCRIPTION_LIMIT_CONFIRMED';
  else if (sendFailures > 0 || subscriptionErrors > 0) verdict = 'SUBSCRIPTION_SEND_OR_SERVER_ERRORS_PRESENT';
  else if (subscribeFrames > 0 && ackObserved && ackMessages === 0) verdict = 'SUBSCRIPTION_ACKS_MISSING';
  else if (capSaturated && skippedAtCap > 0 && productivity && zeroTradeShare >= 0.5) {
    verdict = 'FIRST_COME_CAP_STARVATION_CONFIRMED';
  } else if (capSaturated && skippedAtCap > 0) {
    verdict = 'LIKELY_FIRST_COME_CAP_STARVATION_NEEDS_INSTRUMENTED_PROBE';
  } else if (subscribeFrames > 0 && number(stats.trades) > 0) verdict = 'SUBSCRIPTION_PATH_ACTIVE_NOT_CAP_STARVED';

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pumpdev_subscription_lifecycle',
    note: 'Diagnoses PumpDev trade-subscription capacity, acknowledgements, slot age, and productivity. Does not rotate subscriptions or change trading behavior.',
    telemetryPath: path.relative(ROOT, filePath).replace(/\\/g, '/'),
    summary: {
      verdict,
      newTokens,
      trades: number(stats.trades),
      subscribeCandidates,
      subscribeFrames,
      requestedSubscriptions: subscribeFrames,
      acknowledgedSubscriptions,
      rejectedSubscriptions,
      subscribedMints: trustedActiveMints,
      localReportedActiveMints: subscribedMints,
      activeBookkeeping: ackGatedBookkeeping ? 'ack_gated' : 'legacy_optimistic_pre_ack',
      pendingSubscriptionMints,
      queuedSubscriptionMints,
      maxSubscribedMints,
      effectiveMaxSubscribedMints: trustedEffectiveMaxSubscribedMints,
      capSaturated,
      skippedAtCap,
      skippedAtCapMeasurement: skippedAtCapObserved ? 'observed' : 'inferred_new_tokens_minus_subscribe_frames',
      ackMessages,
      ackMeasurement: ackObserved ? 'observed' : 'lifecycle_events_only',
      sendFailures,
      subscriptionErrors,
      subscriptionErrorMeasurement: subscriptionErrorsObserved ? 'observed' : 'lifecycle_events_only',
      anonymousTierLimitErrors,
      subscriptionErrorReasons,
      subscriptionAckMethods,
      queueDropped,
      normalUnsubscribeAcks: number(stats.unsubscriptionAckMessages),
      productivity,
      productivityTrust: ackGatedBookkeeping ? 'trusted_ack_gated_active_set' : 'legacy_phantom_slots_present',
      activeProductiveMints: ackGatedBookkeeping ? number(productivity?.tradedSlots) : null,
      activeIdleMints: ackGatedBookkeeping ? number(productivity?.zeroTradeSlots) : null,
      zeroTradeShare: Number.isFinite(zeroTradeShare) ? Number(zeroTradeShare.toFixed(4)) : null,
      lifecycleCounts,
      featureSourceDependency: {
        verdict: tradeFeatureDependency,
        pumpDevFeedMode: replayConfig?.pumpDevFeedMode || null,
        pumpDevDrivesPreMigration: replayConfig?.pumpDevDrivesPreMigration ?? null,
        pumpPortalBackupOnly: replayConfig?.pumpPortalBackupOnly ?? null,
        tradeDerivedDecisionFeatures: [
          'recentVolumeSol',
          'tradeVelocityPerMin',
          'buyRatio',
          'uniqueBuyerCount'
        ]
      },
      malformedLines: parseStats.malformedLines
    },
    nextAction: verdict === 'ANONYMOUS_TIER_FIVE_SUBSCRIPTION_LIMIT_CONFIRMED'
      ? (tradeFeatureDependency === 'PUMPDEV_LOAD_BEARING_FOR_TRADE_DERIVED_DECISION_FEATURES'
        ? 'Repair ACK-gated bookkeeping, then choose authenticated PumpDev capacity or a broader primary trade source before any rotation or long paper run.'
        : 'Repair ACK-gated bookkeeping; treat the five PumpDev slots as targeted precision capacity before testing rotation.')
      : verdict === 'FIRST_COME_CAP_STARVATION_CONFIRMED'
      ? 'Design a separately reviewed rotation policy using idle age and cheap pre-signal priority; keep every eviction observable.'
      : 'Run a 15-30 minute PAPER probe with the new lifecycle instrumentation before changing subscription policy.'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.telemetry
    ? (path.isAbsolute(args.telemetry) ? args.telemetry : path.join(ROOT, args.telemetry))
    : latestTelemetryFile();
  if (!filePath || !fs.existsSync(filePath)) throw new Error(`Telemetry file not found: ${filePath || 'none'}`);
  const outputPath = args.output
    ? (path.isAbsolute(args.output) ? args.output : path.join(ROOT, args.output))
    : OUTPUT_PATH;
  const report = buildReport(filePath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = { buildReport };
