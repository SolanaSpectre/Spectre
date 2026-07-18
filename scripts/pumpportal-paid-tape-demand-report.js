#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');
const { resolveTelemetryPath, telemetryFromReport } = require('./lib/report-telemetry');
const { scanTelemetryCoverage } = require('./lib/paid-tape-coverage-epochs');

const ROOT = path.join(__dirname, '..');
const COVERAGE_PATH = path.join(ROOT, 'data', 'reports', 'paid-tape-coverage-epoch-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pumpportal-paid-tape-demand-latest.json');
const FLOORS = Object.freeze([0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.72, 0.75, 0.78, 0.8]);
const POLICY_SHAPES = Object.freeze([
  { name: 'floor_only_ttl30m', ttlMs: 30 * 60 * 1000, terminalRelease: false, perMintEventCap: null },
  { name: 'floor_terminal_ttl30m', ttlMs: 30 * 60 * 1000, terminalRelease: true, perMintEventCap: null },
  { name: 'floor_terminal_ttl10m', ttlMs: 10 * 60 * 1000, terminalRelease: true, perMintEventCap: null },
  { name: 'floor_terminal_ttl5m', ttlMs: 5 * 60 * 1000, terminalRelease: true, perMintEventCap: null },
  { name: 'floor_terminal_ttl3m', ttlMs: 3 * 60 * 1000, terminalRelease: true, perMintEventCap: null },
  { name: 'floor_terminal_ttl5m_cap500', ttlMs: 5 * 60 * 1000, terminalRelease: true, perMintEventCap: 500 }
]);
const STATE_AWARE_FLOORS = Object.freeze([0.25, 0.35, 0.45, 0.5]);
const PRE_EVALUATION_CAPS = Object.freeze([500, 1000, 1500, null]);
const STATE_AWARE_TTL_MS = 3 * 60 * 1000;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else { args[key] = next; index += 1; }
  }
  return args;
}

function timestampMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 6) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}

function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function mintState(mints, mint) {
  if (!mints.has(mint)) {
    mints.set(mint, {
      mint,
      symbol: null,
      subscriptions: [],
      curveObservations: [],
      trades: [],
      evaluationEvents: [],
      positionEvents: [],
      terminalAtMs: null,
      invalidCurveOwner: false,
      recheckExpired: false
    });
  }
  return mints.get(mint);
}

function earliest(left, right) {
  if (!Number.isFinite(left)) return Number.isFinite(right) ? right : null;
  if (!Number.isFinite(right)) return left;
  return Math.min(left, right);
}

function scanTelemetry(telemetryPath) {
  const coverage = scanTelemetryCoverage(telemetryPath);
  const mints = new Map();
  const paperEntries = [];
  let sessionPlan = {};
  let pumpPortalStats = {};
  let totalTradeEvents = 0;
  const scanStats = forEachJsonlSync(telemetryPath, (event) => {
    const type = event.type || event.event;
    const payload = event.payload || event.data || {};
    const atMs = timestampMs(event.timestamp || payload.timestamp);
    const mint = payload.mint || null;
    if (type === 'session.started') sessionPlan = payload.pumpPortalPaidTapePlan || {};
    if (type === 'session.stopped' || type === 'session.stopping') {
      pumpPortalStats = payload.stats?.pumpPortal || pumpPortalStats;
    }
    if (type === 'provider.pumpportal.targeted_subscription' && mint && Number.isFinite(atMs)) {
      const state = mintState(mints, mint);
      state.subscriptions.push({ atMs, curveProgress: Number(payload.curveProgress), activeSubscriptions: Number(payload.activeSubscriptions) });
      if (Number.isFinite(Number(payload.curveProgress))) {
        state.curveObservations.push({ atMs, curveProgress: Number(payload.curveProgress), complete: false });
      }
    } else if (type === 'provider.pumpportal.trade' && mint && Number.isFinite(atMs)) {
      mintState(mints, mint).trades.push(atMs);
      totalTradeEvents += 1;
    } else if (
      (type === 'pre_migration.flagged' || type === 'finalist_account_verifier.subscribed' || type === 'finalist_account_verifier.update')
      && mint
      && Number.isFinite(atMs)
    ) {
      mintState(mints, mint).evaluationEvents.push(atMs);
    } else if (type === 'provider.pumpportal.targeted_prefilter_first_rpc_observation' && mint) {
      const state = mintState(mints, mint);
      state.symbol = payload.symbol || state.symbol;
    } else if (type === 'provider.pumpportal.targeted_prefilter_refresh_expired' && mint) {
      mintState(mints, mint).recheckExpired = true;
    } else if (type === 'pump_bonding_curve.updated' && mint && Number.isFinite(atMs)) {
      const state = mintState(mints, mint);
      if (payload.invalidAccountData === true) state.invalidCurveOwner = true;
      const progress = Number(payload.curveProgress);
      if (Number.isFinite(progress) && payload.invalidAccountData !== true) {
        state.curveObservations.push({ atMs, curveProgress: progress, complete: payload.complete === true });
      }
      if (payload.complete === true) state.terminalAtMs = earliest(state.terminalAtMs, atMs);
    } else if (type === 'provider.pumpportal.migration' && mint && Number.isFinite(atMs)) {
      const state = mintState(mints, mint);
      state.terminalAtMs = earliest(state.terminalAtMs, atMs);
    } else if (type === 'pre_migration_paper.entry' && mint && Number.isFinite(atMs)) {
      paperEntries.push({ mint, symbol: payload.symbol || null, lane: payload.lane || null, atMs });
      mintState(mints, mint).positionEvents.push({ atMs, kind: 'entry', lane: payload.lane || null });
    } else if (type === 'pre_migration_paper.exit' && mint && Number.isFinite(atMs)) {
      mintState(mints, mint).positionEvents.push({
        atMs,
        kind: 'exit',
        lane: payload.lane || null,
        reason: payload.reason || null
      });
    }
  });
  for (const state of mints.values()) {
    state.curveObservations.sort((a, b) => a.atMs - b.atMs);
    state.trades.sort((a, b) => a - b);
    state.evaluationEvents.sort((a, b) => a - b);
    state.positionEvents.sort((a, b) => a.atMs - b.atMs);
  }
  return { coverage, mints, paperEntries, sessionPlan, pumpPortalStats, totalTradeEvents, scanStats };
}

function simulateStateAwareMint(state, policy, observedEndMs, maxCurveProgress) {
  if (!state.subscriptions.length) {
    return { eligibleAtMs: null, activeUntilMs: null, events: [], coveredEntries: [], coveredExits: [] };
  }
  const eligibleAtMs = firstEligibleAt(state, policy.floor, maxCurveProgress);
  if (!Number.isFinite(eligibleAtMs) || eligibleAtMs > observedEndMs) {
    return { eligibleAtMs: null, activeUntilMs: null, events: [], coveredEntries: [], coveredExits: [] };
  }
  const timeline = [
    ...state.trades.map((atMs) => ({ atMs, kind: 'trade' })),
    ...state.evaluationEvents.map((atMs) => ({ atMs, kind: 'evaluation' })),
    ...state.positionEvents
  ].filter((event) => event.atMs >= eligibleAtMs && event.atMs <= observedEndMs)
    .sort((left, right) => left.atMs - right.atMs || (
      left.kind === 'evaluation' ? -1 : right.kind === 'evaluation' ? 1 : 0
    ));

  let active = true;
  let activeUntilMs = eligibleAtMs + policy.ttlMs;
  let evaluationSeen = false;
  let positionOpen = false;
  let preEvaluationEvents = 0;
  let releaseReason = null;
  const events = [];
  const coveredEntries = [];
  const coveredExits = [];

  for (const event of timeline) {
    if (active && !positionOpen && event.atMs > activeUntilMs) {
      active = false;
      releaseReason = 'IDLE_TTL';
    }
    if (!active) continue;
    if (Number.isFinite(state.terminalAtMs) && event.atMs >= state.terminalAtMs) {
      active = false;
      releaseReason = 'TERMINAL';
      continue;
    }
    if (event.kind === 'evaluation') {
      evaluationSeen = true;
      activeUntilMs = Math.max(activeUntilMs, event.atMs + policy.ttlMs);
      continue;
    }
    if (event.kind === 'entry') {
      positionOpen = true;
      coveredEntries.push(event.atMs);
      continue;
    }
    if (event.kind === 'exit') {
      if (positionOpen) coveredExits.push({ atMs: event.atMs, reason: event.reason || null });
      positionOpen = false;
      activeUntilMs = Math.max(activeUntilMs, event.atMs + policy.ttlMs);
      continue;
    }
    events.push(event.atMs);
    if (!evaluationSeen && Number.isFinite(policy.preEvaluationEventCap)) {
      preEvaluationEvents += 1;
      if (preEvaluationEvents >= policy.preEvaluationEventCap) {
        active = false;
        activeUntilMs = event.atMs;
        releaseReason = 'PRE_EVALUATION_EVENT_CAP';
      }
    }
  }

  if (Number.isFinite(state.terminalAtMs)) activeUntilMs = Math.min(activeUntilMs, state.terminalAtMs);
  return {
    eligibleAtMs,
    activeUntilMs,
    events,
    coveredEntries,
    coveredExits,
    evaluationSeen,
    preEvaluationEvents,
    releaseReason
  };
}

function simulateStateAwarePolicy(scanned, policy) {
  const observedEndMs = scanned.coverage.budgetReachedAtMs || timestampMs(scanned.coverage.endAt);
  const maxCurveProgress = Number(scanned.sessionPlan.targetedMaxCurveProgress || 0.9);
  const stateByMint = new Map();
  let observedEvents = 0;
  let targetedMints = 0;
  const releaseReasonCounts = {};
  let mintsWithEvaluation = 0;
  for (const state of scanned.mints.values()) {
    const result = simulateStateAwareMint(state, policy, observedEndMs, maxCurveProgress);
    stateByMint.set(state.mint, result);
    if (!Number.isFinite(result.eligibleAtMs)) continue;
    targetedMints += 1;
    if (result.evaluationSeen) mintsWithEvaluation += 1;
    if (result.releaseReason) {
      releaseReasonCounts[result.releaseReason] = (releaseReasonCounts[result.releaseReason] || 0) + 1;
    }
    observedEvents += result.events.length;
  }
  const paidMinutes = Number(scanned.coverage.fullPaidTapeMinutes || 0);
  const projected55 = paidMinutes > 0 ? observedEvents * 55 / paidMinutes : null;
  const entries = scanned.paperEntries.map((entry) => {
    const result = stateByMint.get(entry.mint) || {};
    const covered = Array.isArray(result.coveredEntries) && result.coveredEntries.includes(entry.atMs);
    const exitEvent = scanned.mints.get(entry.mint)?.positionEvents.find((event) => event.kind === 'exit' && event.atMs >= entry.atMs);
    const priceDrivenExit = Boolean(exitEvent && !['TIME_LIMIT', 'SESSION_END'].includes(exitEvent.reason));
    const paidTapeExitCovered = covered
      && Number.isFinite(exitEvent?.atMs)
      && result.coveredExits.some((event) => event.atMs === exitEvent.atMs);
    const exitCovered = covered && Number.isFinite(exitEvent?.atMs) && (!priceDrivenExit || paidTapeExitCovered);
    return {
      ...entry,
      covered,
      exitCovered,
      paidTapeExitCovered,
      exitReason: exitEvent?.reason || null,
      exitAtMs: exitEvent?.atMs ?? null
    };
  });
  const runnerEntries = entries.filter((entry) => entry.lane === 'PRE_MIGRATION_RUNNER_WATCH');
  return {
    name: 'state_aware_ttl3m_terminal',
    floor: policy.floor,
    ttlMs: policy.ttlMs,
    terminalRelease: true,
    preEvaluationEventCap: policy.preEvaluationEventCap,
    causalReactivationAfterRelease: false,
    targetedMints,
    mintsWithEvaluation,
    releaseReasonCounts,
    observedEvents,
    observedEventReductionRate: round(1 - observedEvents / Math.max(1, scanned.totalTradeEvents), 6),
    projectedEventsAt55Minutes: round(projected55, 0),
    projectedWithin30000At55Minutes: Number.isFinite(projected55) && projected55 <= 30000,
    projectedWithin24000At55Minutes: Number.isFinite(projected55) && projected55 <= 24000,
    coveredPaperEntries: entries.filter((entry) => entry.covered).length,
    coveredPaperExits: entries.filter((entry) => entry.exitCovered).length,
    totalPaperEntries: entries.length,
    coveredRunnerWatchEntries: runnerEntries.filter((entry) => entry.covered).length,
    coveredRunnerWatchExits: runnerEntries.filter((entry) => entry.exitCovered).length,
    totalRunnerWatchEntries: runnerEntries.length,
    entryCoverage: entries
  };
}

function firstEligibleAt(state, floor, maxCurveProgress = 0.9) {
  const row = state.curveObservations.find((item) => (
    item.complete !== true && item.curveProgress >= floor && item.curveProgress < maxCurveProgress
  ));
  return row?.atMs ?? null;
}

function simulatePolicy(scanned, policy) {
  const observedEndMs = scanned.coverage.budgetReachedAtMs || timestampMs(scanned.coverage.endAt);
  const maxCurveProgress = Number(scanned.sessionPlan.targetedMaxCurveProgress || 0.9);
  let observedEvents = 0;
  let targetedMints = 0;
  const eventsByMint = [];
  const policyStateByMint = new Map();
  for (const state of scanned.mints.values()) {
    const eligibleAtMs = firstEligibleAt(state, policy.floor, maxCurveProgress);
    if (!Number.isFinite(eligibleAtMs)) {
      policyStateByMint.set(state.mint, { eligibleAtMs: null, activeUntilMs: null, eventsBeforeRelease: [] });
      continue;
    }
    targetedMints += 1;
    let policyEndMs = observedEndMs;
    if (Number.isFinite(policy.ttlMs)) policyEndMs = Math.min(policyEndMs, eligibleAtMs + policy.ttlMs);
    if (policy.terminalRelease && Number.isFinite(state.terminalAtMs)) policyEndMs = Math.min(policyEndMs, state.terminalAtMs);
    let eventsBeforeRelease = state.trades.filter((atMs) => atMs >= eligibleAtMs && atMs <= policyEndMs);
    let activeUntilMs = Number.isFinite(policy.ttlMs) ? eligibleAtMs + policy.ttlMs : Infinity;
    if (policy.terminalRelease && Number.isFinite(state.terminalAtMs)) activeUntilMs = Math.min(activeUntilMs, state.terminalAtMs);
    if (Number.isFinite(policy.perMintEventCap) && eventsBeforeRelease.length >= policy.perMintEventCap) {
      activeUntilMs = Math.min(activeUntilMs, eventsBeforeRelease[policy.perMintEventCap - 1]);
      eventsBeforeRelease = eventsBeforeRelease.slice(0, policy.perMintEventCap);
    }
    const events = eventsBeforeRelease.length;
    policyStateByMint.set(state.mint, { eligibleAtMs, activeUntilMs, eventsBeforeRelease });
    observedEvents += events;
    if (events > 0) eventsByMint.push({ mint: state.mint, events });
  }
  const paidMinutes = Number(scanned.coverage.fullPaidTapeMinutes || 0);
  const projected55 = paidMinutes > 0 ? observedEvents * 55 / paidMinutes : null;
  const projected60 = paidMinutes > 0 ? observedEvents * 60 / paidMinutes : null;
  const entryRows = scanned.paperEntries.map((entry) => {
    const mintPolicy = policyStateByMint.get(entry.mint) || {};
    const eligibleAtMs = mintPolicy.eligibleAtMs;
    const activeUntilMs = mintPolicy.activeUntilMs;
    const covered = Number.isFinite(eligibleAtMs) && eligibleAtMs <= entry.atMs && entry.atMs <= activeUntilMs;
    return {
      ...entry,
      covered,
      outcomeWindow300sCovered: covered && entry.atMs + 300000 <= activeUntilMs,
      leadSeconds: Number.isFinite(eligibleAtMs) ? round((entry.atMs - eligibleAtMs) / 1000, 3) : null,
      eventsBeforeEntry: covered
        ? mintPolicy.eventsBeforeRelease.filter((atMs) => atMs <= entry.atMs).length
        : null,
      releaseSecondsAfterEntry: covered && Number.isFinite(activeUntilMs)
        ? round((activeUntilMs - entry.atMs) / 1000, 3)
        : null
    };
  });
  const runnerRows = entryRows.filter((entry) => entry.lane === 'PRE_MIGRATION_RUNNER_WATCH');
  return {
    name: policy.name,
    floor: policy.floor,
    ttlMs: policy.ttlMs,
    terminalRelease: policy.terminalRelease,
    perMintEventCap: policy.perMintEventCap,
    targetedMints,
    observedEvents,
    observedEventReductionRate: round(1 - observedEvents / Math.max(1, scanned.totalTradeEvents), 6),
    projectedEventsAt55Minutes: round(projected55, 0),
    projectedEventsAt60Minutes: round(projected60, 0),
    projectedWithin30000At55Minutes: Number.isFinite(projected55) && projected55 <= 30000,
    projectedChargeAt55MinutesSol: Number.isFinite(projected55) ? round(Math.floor(projected55 / 10000) * 0.01, 4) : null,
    coveredPaperEntries: entryRows.filter((entry) => entry.covered).length,
    totalPaperEntries: entryRows.length,
    coveredRunnerWatchEntries: runnerRows.filter((entry) => entry.covered).length,
    totalRunnerWatchEntries: runnerRows.length,
    fullOutcomeWindowPaperEntries: entryRows.filter((entry) => entry.outcomeWindow300sCovered).length,
    fullOutcomeWindowRunnerWatchEntries: runnerRows.filter((entry) => entry.outcomeWindow300sCovered).length,
    entryLeadSeconds: entryRows,
    topMints: eventsByMint.sort((a, b) => b.events - a.events).slice(0, 10)
  };
}

function concentration(scanned) {
  const rows = [...scanned.mints.values()]
    .filter((state) => state.trades.length > 0)
    .map((state) => ({
      mint: state.mint,
      symbol: state.symbol,
      events: state.trades.length,
      firstSubscribedAt: state.subscriptions[0]?.atMs ? new Date(state.subscriptions[0].atMs).toISOString() : null,
      subscriptionCurveProgress: round(state.subscriptions[0]?.curveProgress),
      terminalObserved: Number.isFinite(state.terminalAtMs)
    }))
    .sort((a, b) => b.events - a.events);
  const total = rows.reduce((sum, row) => sum + row.events, 0);
  const share = (count) => round(rows.slice(0, count).reduce((sum, row) => sum + row.events, 0) / Math.max(1, total), 6);
  return {
    mintsWithEvents: rows.length,
    eventCount: total,
    top1Share: share(1),
    top5Share: share(5),
    top10Share: share(10),
    top25Share: share(25),
    perMintEvents: {
      median: percentile(rows.map((row) => row.events), 0.5),
      p90: percentile(rows.map((row) => row.events), 0.9),
      p99: percentile(rows.map((row) => row.events), 0.99),
      max: rows[0]?.events || 0
    },
    topMints: rows.slice(0, 25)
  };
}

function buildReport(telemetryPath) {
  const scanned = scanTelemetry(telemetryPath);
  const policies = FLOORS.flatMap((floor) => POLICY_SHAPES.map((shape) => simulatePolicy(scanned, { ...shape, floor })));
  const stateAwarePolicies = STATE_AWARE_FLOORS.flatMap((floor) => PRE_EVALUATION_CAPS.map((preEvaluationEventCap) => (
    simulateStateAwarePolicy(scanned, {
      floor,
      ttlMs: STATE_AWARE_TTL_MS,
      preEvaluationEventCap
    })
  )));
  const viablePolicies = policies
    .filter((row) => row.projectedWithin30000At55Minutes
      && row.coveredPaperEntries === row.totalPaperEntries
      && row.coveredRunnerWatchEntries === row.totalRunnerWatchEntries
      && row.fullOutcomeWindowPaperEntries === row.totalPaperEntries
      && row.fullOutcomeWindowRunnerWatchEntries === row.totalRunnerWatchEntries)
    .sort((a, b) => b.observedEvents - a.observedEvents);
  const invalidCurveMints = [...scanned.mints.values()].filter((state) => state.invalidCurveOwner);
  const invalidExpired = invalidCurveMints.filter((state) => state.recheckExpired);
  const configuredMax = Number(scanned.pumpPortalStats.maxSubscribedMints || 0);
  const peakActive = Math.max(0, ...[...scanned.mints.values()].flatMap((state) => state.subscriptions.map((row) => row.activeSubscriptions || 0)));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pumpportal_paid_tape_demand_attribution',
    telemetryPath: path.relative(ROOT, telemetryPath).replace(/\\/g, '/'),
    verdict: viablePolicies.length ? 'RETRO_POLICIES_FIT_EXISTING_BUDGET' : 'NO_RETRO_POLICY_FITS_EXISTING_BUDGET',
    actual: {
      fullPaidTapeMinutes: scanned.coverage.fullPaidTapeMinutes,
      meteredTradeEvents: scanned.totalTradeEvents,
      eventsPerPaidMinute: round(scanned.totalTradeEvents / Math.max(1, scanned.coverage.fullPaidTapeMinutes), 3),
      acceptedSubscriptions: Number(scanned.pumpPortalStats.targetedTradeSubscriptionAccepted || 0),
      configuredMaxSubscribedMints: configuredMax,
      peakActiveSubscriptions: peakActive,
      concurrencyCeilingEnforced: configuredMax > 0 && peakActive <= configuredMax,
      maxActiveSkips: Number(scanned.pumpPortalStats.targetedTradeSubscriptionSkippedMaxActive || 0),
      lifecyclePrunes: Number(scanned.pumpPortalStats.tokenTradeSubscriptionPrunes || 0)
    },
    concentration: concentration(scanned),
    rpcRecheckHygiene: {
      invalidCurveOwnerMints: invalidCurveMints.length,
      invalidCurveOwnerRecheckExpirations: invalidExpired.length,
      examples: invalidExpired.slice(0, 10).map((state) => ({ mint: state.mint, symbol: state.symbol }))
    },
    policies,
    stateAwarePolicies,
    viablePolicies,
    stateAwarePolicyAssessment: {
      verdict: stateAwarePolicies.some((row) => row.projectedWithin24000At55Minutes)
        ? 'STATE_AWARE_POLICY_FITS_WITH_HEADROOM'
        : stateAwarePolicies.some((row) => row.projectedWithin30000At55Minutes)
          ? 'STATE_AWARE_POLICY_FITS_HARD_CAP_ONLY'
          : 'NO_STATE_AWARE_POLICY_FITS_EXISTING_BUDGET',
      budgetFittingWith20PctHeadroom: stateAwarePolicies.filter((row) => row.projectedWithin24000At55Minutes),
      budgetFittingAtHardCap: stateAwarePolicies.filter((row) => row.projectedWithin30000At55Minutes),
      lowestProjectedDemand: [...stateAwarePolicies]
        .sort((left, right) => left.projectedEventsAt55Minutes - right.projectedEventsAt55Minutes)
        .slice(0, 4),
      note: 'Entry preservation is reported as an in-sample plausibility check, not a policy-selection constraint.'
    },
    exitPathAudit: {
      verdict: 'RPC_ONLY_EXIT_AND_OUTCOME_PATH_NOT_RUNTIME_READY',
      runtimeBondingCurveRpcCadenceMs: Number(scanned.sessionPlan.targetedPrefilterCadenceMs || 15000),
      tradingCycleCadenceMs: 5000,
      findings: [
        'Pre-migration TP, stop-loss, and trailing exits are evaluated by preMigrationPaperLane.observe on provider/RPC observation events.',
        'The regular trading cycle calls checkOpenPositionTimeouts, which guarantees time exits but not price-driven exits.',
        'There is no dedicated held-position RPC polling loop with tested price-driven exit parity.',
        'State-aware simulations therefore require paid-tape coverage through the observed exit and do not grant free 300-second RPC outcome coverage.'
      ]
    },
    limitations: [
      'The paid stream ended at the observed cap; 55/60-minute event totals are linear projections from the full-paid epoch, not observed future trades.',
      'Higher-floor policies can only score trades present in the recorded paid tape; they cannot recover trades for mints that were never subscribed.',
      'Fixed TTL policies do not model re-target refreshes after unsubscribe. Runtime refresh behavior must be specified and tested separately.',
      'Policy replay is coverage/cost evidence only and does not change or validate entry strategy.',
      'State-aware replay cannot reactivate a stream from a later flag after an idle/cap release because that flag may itself depend on the missing paid tape.'
    ],
    recommendation: viablePolicies.length
      ? 'select_the_least_restrictive_budget_fitting_policy_then_preregister_v2_before_runtime_change'
      : 'add_demand_release_or_narrower_prefilter_then_repeat_offline_policy_replay_before_paid_run'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveTelemetryPath(ROOT, {
    telemetry: args.telemetry,
    reportTelemetry: telemetryFromReport(ROOT, COVERAGE_PATH)
  });
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  const report = buildReport(telemetryPath);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    verdict: report.verdict,
    actual: report.actual,
    concentration: report.concentration,
    rpcRecheckHygiene: report.rpcRecheckHygiene,
    viablePolicies: report.viablePolicies,
    stateAwarePolicyAssessment: report.stateAwarePolicyAssessment,
    exitPathAudit: report.exitPathAudit
  }, null, 2));
}

if (require.main === module) main();

module.exports = { scanTelemetry, simulatePolicy, simulateStateAwareMint, simulateStateAwarePolicy, concentration, buildReport };
