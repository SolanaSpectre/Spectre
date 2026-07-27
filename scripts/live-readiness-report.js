#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
if (process.env.SPECTRE_SKIP_DOTENV !== 'true') {
  require('dotenv').config();
}
const { Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const Config = require('../src/config');
const WalletManager = require('../src/wallet');
const {
  classifySimulationPayload,
  normalizeDryRunReason,
  summarizeSimulationFailureCounts
} = require('../src/lib/simulation-error-classifier');

const EXPECTED_QUOTE_RACE_POLICY = Object.freeze({
  maximumRate: 0.02,
  requireLatencyTelemetry: true,
  lowLatencyCutoff: 'strictly_below_all_simulation_blockhash_latency_median',
  disposition: 'escalate_all_quote_races_to_critical_when_any_bound_fails'
});

const ROOT = path.resolve(__dirname, '..');
const TELEMETRY_DIR = path.join(ROOT, 'run-logs');
const REPORT_DIR = path.join(ROOT, 'data', 'reports');
const JSON_REPORT = path.join(REPORT_DIR, 'live-readiness-latest.json');
const TEXT_REPORT = path.join(REPORT_DIR, 'live-readiness-latest.txt');
const RUNNER_REJECT_ENTRY_REPLAY_REPORT = path.join(REPORT_DIR, 'runner-reject-entry-replay-latest.json');
const WALLET_FALSE_NEGATIVE_ENTRY_REPLAY_REPORT = path.join(REPORT_DIR, 'wallet-false-negative-entry-replay-latest.json');
const CURVE_CONFIRMATION_REPLAY_REPORT = path.join(REPORT_DIR, 'pre-migration-curve-confirmation-replay-latest.json');

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pct(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index];
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'n/a';
  return Number(value).toFixed(digits);
}

function findLatestTelemetry() {
  const explicit = process.argv.find((arg) => arg.startsWith('--telemetry='));
  if (explicit) {
    return path.resolve(ROOT, explicit.slice('--telemetry='.length));
  }

  const files = fs.readdirSync(TELEMETRY_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/.test(name))
    .map((name) => {
      const fullPath = path.join(TELEMETRY_DIR, name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!files.length) {
    throw new Error(`No telemetry JSONL files found in ${TELEMETRY_DIR}`);
  }
  return files[0].fullPath;
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function pushNumber(list, value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) list.push(parsed);
}

function countOnly(counts = {}, allowed = []) {
  return allowed.reduce((total, key) => total + number(counts[key], 0), 0);
}

function readOptionalJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function selectRunnerShadowProfiles(report) {
  const profiles = report?.summaryByProfile || {};
  return Object.entries(profiles)
    .map(([name, summary]) => ({
      name,
      trades: number(summary.trades, 0),
      wins: number(summary.wins, 0),
      losses: number(summary.losses, 0),
      winRate: summary.winRate ?? null,
      totalPnlSol: summary.totalPnlSol ?? null,
      pnlAfterRemovingTopWinnerSol: summary.pnlAfterRemovingTopWinnerSol ?? null,
      pnlAfterRemovingTop3WinnersSol: summary.pnlAfterRemovingTop3WinnersSol ?? null,
      topWinnerShareOfGrossProfit: summary.topWinnerShareOfGrossProfit ?? null,
      outlierDominated: summary.outlierDominated === true,
      verdictTags: Array.isArray(summary.verdictTags) ? summary.verdictTags : [],
      top3WinnerPnlSol: summary.top3WinnerPnlSol ?? null,
      exitReasons: summary.exitReasons || {}
    }))
    .sort((a, b) => number(b.totalPnlSol, Number.NEGATIVE_INFINITY) - number(a.totalPnlSol, Number.NEGATIVE_INFINITY));
}

function selectWalletFalseNegativeReplay(report) {
  if (!report) return null;
  const summary = report.summary || {};
  return {
    generatedAt: report.generatedAt || null,
    mode: report.mode || null,
    strategy: report.strategy || null,
    criteria: report.criteria || null,
    strongWalletLedMisses: summary.strongWalletLedMisses ?? null,
    wouldEnter: summary.wouldEnter ?? null,
    noGateConfirmAfterTouch: summary.noGateConfirmAfterTouch ?? null,
    totalPnlSol: summary.totalPnlSol ?? null,
    stressedPnlSol: summary.stressedPnlSol ?? null,
    winRate: summary.winRate ?? null,
    firstHalfPnlSol: summary.firstHalfPnlSol ?? null,
    secondHalfPnlSol: summary.secondHalfPnlSol ?? null,
    pnlAfterTopWinnerSol: summary.pnlAfterTopWinnerSol ?? null,
    pnlAfterTop3WinnersSol: summary.pnlAfterTop3WinnersSol ?? null,
    topWinnerShareOfGrossProfit: summary.topWinnerShareOfGrossProfit ?? null,
    outlierDominated: summary.outlierDominated === true,
    verdictTags: Array.isArray(summary.verdictTags) ? summary.verdictTags : [],
    verdict: summary.verdict || null,
    shadowLaneEligible: summary.shadowLaneEligible === true,
    verdictReason: summary.verdictReason || null
  };
}

function selectCurveConfirmationReplay(report) {
  const profiles = report?.profiles || {};
  const rows = Object.entries(profiles)
    .map(([name, profileReport]) => {
      const summary = profileReport?.summary || {};
      return {
        name,
        description: profileReport?.profile?.description || null,
        decisions: summary.decisions ?? null,
        confirmedEntries: summary.confirmedEntries ?? null,
        closed: summary.closed ?? null,
        noConfirmation: summary.noConfirmation ?? null,
        uniqueMints: summary.uniqueMints ?? null,
        confirmedUniqueMints: summary.confirmedUniqueMints ?? null,
        wins: summary.wins ?? null,
        losses: summary.losses ?? null,
        winRate: summary.winRate ?? null,
        totalPnlSol: summary.totalPnlSol ?? null,
        averagePnlSol: summary.averagePnlSol ?? null,
        medianPnlSol: summary.pnlStats?.median ?? null,
        p90PnlSol: summary.pnlStats?.p90 ?? null,
        maxPnlSol: summary.pnlStats?.max ?? null,
        medianNetReturnPct: summary.netReturnPctStats?.median ?? null,
        p90NetReturnPct: summary.netReturnPctStats?.p90 ?? null,
        exitReasonCounts: summary.exitReasonCounts || {}
      };
    })
    .sort((a, b) => number(b.totalPnlSol, Number.NEGATIVE_INFINITY) - number(a.totalPnlSol, Number.NEGATIVE_INFINITY));
  if (!rows.length) return null;
  return {
    generatedAt: report.generatedAt || null,
    mode: report.mode || null,
    targetReasons: report.inputs?.targetReasons || null,
    telemetryFilesRead: report.inputs?.telemetryFilesRead ?? null,
    profiles: rows
  };
}

async function readTelemetry(filePath) {
  const stats = {
    filePath,
    telemetryStartMs: null,
    telemetryEndMs: null,
    counts: {},
    uniqueMints: {
      dryRun: new Set(),
      finalist: new Set(),
      paperEntries: new Set()
    },
    rpc: {
      started: 0,
      completed: 0,
      failed: 0,
      methods: {},
      failedMethods: {},
      failureClasses: {}
    },
    pumpDev: {
      newTokens: 0,
      trades: 0,
      mintEvents: 0,
      closes: 0,
      errors: 0
    },
    eventLoop: {
      lagEvents: 0,
      maxLagMs: 0,
      summary: null
    },
    finalist: {
      subscribed: 0,
      updates: 0,
      invalid: 0,
      skipped: 0,
      errors: 0,
      initialSnapshots: 0,
      initialMissing: 0,
      initialErrors: 0,
      shadowChecks: 0,
      shadowReady: 0,
      shadowBlocked: 0,
      shadowStatuses: {},
      blockReasons: {},
      accountAgeMs: []
    },
    dryRun: {
      attempts: 0,
      wouldSend: 0,
      wouldBlock: 0,
      skipped: 0,
      errors: 0,
      uniqueMints: 0,
      skipReasons: {},
      blockReasons: {},
      txBuildStatus: {},
      simulationOk: { true: 0, false: 0, null: 0 },
      simulationErrors: {},
      simulationClassifierEpochs: {},
      simulationFailureMintsByClass: {},
      simulationFailureBlockhashLatencyMsByClass: {},
      bondingCurveMintMismatchDiagnostics: [],
      simulationMissingAccounts: {},
      simulationPassedWithPreflightMissingAccounts: {},
      postMigrationRouteProbes: {
        attempted: 0,
        available: 0,
        unavailable: 0,
        errors: 0,
        statuses: {},
        reasons: {}
      },
      signedOk: { true: 0, false: 0, null: 0 },
      broadcastEnabled: { true: 0, false: 0, null: 0 },
      signatureModes: {},
      accountAgeMs: [],
      priceImpactPct: [],
      blockhashLatencyMs: []
    },
    paper: {
      entries: 0,
      exits: 0,
      pnlSol: 0,
      wins: 0,
      losses: 0,
      exitReasons: {}
    },
    lastStopStats: null
  };

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    const type = String(event.type || '');
    const payload = event.payload || {};
    const atMs = new Date(event.timestamp || payload.timestamp || 0).getTime();
    if (Number.isFinite(atMs)) {
      stats.telemetryStartMs = stats.telemetryStartMs === null ? atMs : Math.min(stats.telemetryStartMs, atMs);
      stats.telemetryEndMs = stats.telemetryEndMs === null ? atMs : Math.max(stats.telemetryEndMs, atMs);
    }
    increment(stats.counts, type);

    if (type === 'session.stopping') {
      stats.lastStopStats = payload.stats || null;
    }

    if (type === 'provider.pumpdev.shadow_new_token') stats.pumpDev.newTokens += 1;
    if (type === 'provider.pumpdev.shadow_trade') stats.pumpDev.trades += 1;
    if (type === 'provider.pumpdev.shadow_mint_event') stats.pumpDev.mintEvents += 1;
    if (type === 'provider.pumpdev.closed') stats.pumpDev.closes += 1;
    if (type === 'provider.pumpdev.websocket_error' || type === 'provider.pumpdev.runtime_handler_error') {
      stats.pumpDev.errors += 1;
    }

    if (type === 'solana_rpc.call_started') {
      stats.rpc.started += 1;
      increment(stats.rpc.methods, payload.methodName || 'unknown');
    } else if (type === 'solana_rpc.call_completed') {
      stats.rpc.completed += 1;
    } else if (type === 'solana_rpc.call_failed') {
      stats.rpc.failed += 1;
      increment(stats.rpc.failedMethods, payload.methodName || 'unknown');
      increment(stats.rpc.failureClasses, payload.failureClass || payload.reason || 'unknown');
    }

    if (type === 'runtime.event_loop_lag') {
      stats.eventLoop.lagEvents += 1;
      stats.eventLoop.maxLagMs = Math.max(stats.eventLoop.maxLagMs, number(payload.lagMs));
    } else if (type === 'runtime.event_loop_monitor_summary') {
      stats.eventLoop.summary = payload;
      stats.eventLoop.maxLagMs = Math.max(stats.eventLoop.maxLagMs, number(payload.maxLagMs));
      stats.eventLoop.lagEvents = Math.max(stats.eventLoop.lagEvents, number(payload.lagEvents));
    }

    if (type.startsWith('finalist_account_verifier.')) {
      if (payload.mint) stats.uniqueMints.finalist.add(payload.mint);
      if (type === 'finalist_account_verifier.subscribed') stats.finalist.subscribed += 1;
      if (type === 'finalist_account_verifier.update') stats.finalist.updates += 1;
      if (type === 'finalist_account_verifier.update_invalid') stats.finalist.invalid += 1;
      if (type === 'finalist_account_verifier.skipped') stats.finalist.skipped += 1;
      if (type === 'finalist_account_verifier.subscribe_error') stats.finalist.errors += 1;
      if (type === 'finalist_account_verifier.initial_snapshot') stats.finalist.initialSnapshots += 1;
      if (type === 'finalist_account_verifier.initial_snapshot_missing') stats.finalist.initialMissing += 1;
      if (type === 'finalist_account_verifier.initial_snapshot_error') stats.finalist.initialErrors += 1;
      if (type === 'finalist_account_verifier.shadow_live_gate') {
        stats.finalist.shadowChecks += 1;
        increment(stats.finalist.shadowStatuses, payload.status || 'unknown');
        if (payload.status === 'LIVE_SHADOW_READY_FRESH_ACCOUNT_STATE') {
          stats.finalist.shadowReady += 1;
          pushNumber(stats.finalist.accountAgeMs, payload.accountAgeMs);
        } else {
          stats.finalist.shadowBlocked += 1;
          increment(stats.finalist.blockReasons, payload.blockedReason || 'unknown');
        }
      }
    }

    if (type.startsWith('live_dry_run.')) {
      if (payload.mint) stats.uniqueMints.dryRun.add(payload.mint);
      if (type === 'live_dry_run.post_migration_route_probe') {
        stats.dryRun.postMigrationRouteProbes.attempted += payload.attempted === false ? 0 : 1;
        if (payload.available === true) {
          stats.dryRun.postMigrationRouteProbes.available += 1;
        } else {
          stats.dryRun.postMigrationRouteProbes.unavailable += 1;
        }
        if (payload.status === 'PROBE_ERROR') {
          stats.dryRun.postMigrationRouteProbes.errors += 1;
        }
        increment(stats.dryRun.postMigrationRouteProbes.statuses, payload.status || 'unknown');
        increment(stats.dryRun.postMigrationRouteProbes.reasons, payload.reason || 'none');
      } else if (type === 'live_dry_run.would_send') {
        stats.dryRun.attempts += 1;
        stats.dryRun.wouldSend += 1;
        pushNumber(stats.dryRun.accountAgeMs, payload.accountAgeMs);
        pushNumber(stats.dryRun.priceImpactPct, payload.quote && payload.quote.priceImpactPct);
        pushNumber(stats.dryRun.blockhashLatencyMs, payload.blockhashLatencyMs);
        increment(stats.dryRun.txBuildStatus, payload.txBuildStatus || 'unknown');
        if (payload.signedOk === true || payload.signedOk === false) {
          increment(stats.dryRun.signedOk, String(payload.signedOk));
        } else {
          increment(stats.dryRun.signedOk, 'null');
        }
        if (payload.broadcastEnabled === true || payload.broadcastEnabled === false) {
          increment(stats.dryRun.broadcastEnabled, String(payload.broadcastEnabled));
        } else {
          increment(stats.dryRun.broadcastEnabled, 'null');
        }
        increment(stats.dryRun.signatureModes, payload.signatureMode || 'unknown');
        if (payload.simulationOk === true || payload.simulationOk === false) {
          increment(stats.dryRun.simulationOk, String(payload.simulationOk));
          if (payload.simulationOk === false) recordSimulationFailure(stats, payload);
        } else {
          increment(stats.dryRun.simulationOk, 'null');
        }
        recordSimulationAccountDiagnostic(stats, payload);
      } else if (type === 'live_dry_run.would_block') {
        stats.dryRun.attempts += 1;
        stats.dryRun.wouldBlock += 1;
        pushNumber(stats.dryRun.accountAgeMs, payload.accountAgeMs);
        pushNumber(stats.dryRun.priceImpactPct, payload.quote && payload.quote.priceImpactPct);
        pushNumber(stats.dryRun.blockhashLatencyMs, payload.blockhashLatencyMs);
        increment(stats.dryRun.blockReasons, classifyDryRunBlockReason(payload));
        increment(stats.dryRun.txBuildStatus, payload.txBuildStatus || 'unknown');
        if (payload.signedOk === true || payload.signedOk === false) {
          increment(stats.dryRun.signedOk, String(payload.signedOk));
        } else {
          increment(stats.dryRun.signedOk, 'null');
        }
        if (payload.broadcastEnabled === true || payload.broadcastEnabled === false) {
          increment(stats.dryRun.broadcastEnabled, String(payload.broadcastEnabled));
        } else {
          increment(stats.dryRun.broadcastEnabled, 'null');
        }
        increment(stats.dryRun.signatureModes, payload.signatureMode || 'unknown');
        if (payload.simulationOk === true || payload.simulationOk === false) {
          increment(stats.dryRun.simulationOk, String(payload.simulationOk));
          if (payload.simulationOk === false) recordSimulationFailure(stats, payload);
        } else {
          increment(stats.dryRun.simulationOk, 'null');
        }
        recordSimulationAccountDiagnostic(stats, payload);
      } else if (type === 'live_dry_run.skipped') {
        stats.dryRun.skipped += 1;
        increment(stats.dryRun.skipReasons, payload.reason || 'unknown');
      } else if (type === 'live_dry_run.error') {
        stats.dryRun.errors += 1;
      }
    }

    if (type === 'pre_migration_paper.entry') {
      stats.paper.entries += 1;
      if (payload.mint) stats.uniqueMints.paperEntries.add(payload.mint);
    } else if (type === 'pre_migration_paper.exit') {
      stats.paper.exits += 1;
      const pnl = number(payload.pnlSol, 0);
      stats.paper.pnlSol += pnl;
      if (pnl > 0) stats.paper.wins += 1;
      if (pnl < 0) stats.paper.losses += 1;
      increment(stats.paper.exitReasons, payload.reason || 'unknown');
    }
  }

  stats.dryRun.uniqueMints = stats.uniqueMints.dryRun.size;
  stats.finalist.uniqueMints = stats.uniqueMints.finalist.size;
  stats.paper.uniqueEntryMints = stats.uniqueMints.paperEntries.size;
  delete stats.uniqueMints;
  return stats;
}

function recordSimulationAccountDiagnostic(stats, payload = {}) {
  const missingAccounts = payload.simulationAccountDiagnostic && payload.simulationAccountDiagnostic.missingAccounts;
  if (!Array.isArray(missingAccounts) || missingAccounts.length === 0) return;

  const target = payload.simulationOk === true
    ? stats.dryRun.simulationPassedWithPreflightMissingAccounts
    : stats.dryRun.simulationMissingAccounts;
  for (const account of missingAccounts) {
    increment(target, (account && (account.name || account.pubkey)) || 'unknown');
  }
}

function recordSimulationFailure(stats, payload = {}) {
  const failureClass = classifySimulationFailure(payload);
  increment(stats.dryRun.simulationErrors, failureClass);
  increment(
    stats.dryRun.simulationClassifierEpochs,
    payload.simulationClassifierEpoch || 'LEGACY_PRE_CLASSIFIER_EPOCH'
  );
  if (!stats.dryRun.simulationFailureBlockhashLatencyMsByClass[failureClass]) {
    stats.dryRun.simulationFailureBlockhashLatencyMsByClass[failureClass] = [];
  }
  pushNumber(
    stats.dryRun.simulationFailureBlockhashLatencyMsByClass[failureClass],
    payload.blockhashLatencyMs
  );
  if (!stats.dryRun.simulationFailureMintsByClass[failureClass]) {
    stats.dryRun.simulationFailureMintsByClass[failureClass] = {};
  }
  increment(stats.dryRun.simulationFailureMintsByClass[failureClass], payload.mint || payload.symbol || 'unknown');
  if (
    failureClass === 'BONDING_CURVE_MINT_MISMATCH'
    && payload.bondingCurveMintMismatchDiagnostic
    && stats.dryRun.bondingCurveMintMismatchDiagnostics.length < 25
  ) {
    stats.dryRun.bondingCurveMintMismatchDiagnostics.push(
      payload.bondingCurveMintMismatchDiagnostic
    );
  }
}

function classifyDryRunBlockReason(payload = {}) {
  return normalizeDryRunReason(payload) || 'unknown';
}

function classifySimulationFailure(payload = {}) {
  return classifySimulationPayload(payload);
}

async function readCurrentHotWalletBalanceSol() {
  try {
    const wallet = new WalletManager(Config.hotWalletPrivateKey);
    const connection = new Connection(Config.solanaRpcUrl, { commitment: 'confirmed' });
    const lamports = await connection.getBalance(wallet.getPublicKey(), 'confirmed');
    return lamports / LAMPORTS_PER_SOL;
  } catch (_error) {
    return null;
  }
}

function buildVerdict(stats) {
  const blockers = [];
  const launchBlocks = [];
  const warnings = [];
  const passes = [];

  const stop = stats.lastStopStats || {};
  const pumpDevStop = stop.pumpDev || {};
  const rpcStop = stop.solanaRpc || {};
  const finalistStop = stop.finalistAccountVerifier || {};
  const dryRunStop = stop.liveExecutionDryRun || {};
  const preMigrationStop = stop.preMigrationPaper || {};

  const rpcFailures = number(rpcStop.stats && rpcStop.stats.callTelemetryFailed, stats.rpc.failed);
  const rpcStarted = number(rpcStop.stats && rpcStop.stats.callTelemetryStarted, stats.rpc.started);
  const pumpDevCloses = number(pumpDevStop.closeEvents, stats.pumpDev.closes);
  const pumpDevErrors = number(pumpDevStop.errorEvents, stats.pumpDev.errors);
  const pumpDevDropped = number(pumpDevStop.eventQueueDropped, 0);
  const pumpDevQueueErrors = number(pumpDevStop.eventQueueErrors, 0);
  const eventLoopMaxLagMs = number(stats.eventLoop.summary && stats.eventLoop.summary.maxLagMs, stats.eventLoop.maxLagMs);
  const eventLoopLagEvents = number(stats.eventLoop.summary && stats.eventLoop.summary.lagEvents, stats.eventLoop.lagEvents);
  const telemetryDurationHours = stats.telemetryStartMs !== null && stats.telemetryEndMs !== null
    ? Math.max(0.001, (stats.telemetryEndMs - stats.telemetryStartMs) / 3600000)
    : 0;
  const eventLoopLagRatePerHour = telemetryDurationHours > 0 ? eventLoopLagEvents / telemetryDurationHours : eventLoopLagEvents;
  const liveSafeLagEventBudget = Math.max(2, Math.ceil(telemetryDurationHours * 3));
  const watchLagEventBudget = Math.max(5, Math.ceil(telemetryDurationHours * 6));
  const dryAttempts = number(dryRunStop.attempts, stats.dryRun.attempts);
  const dryWouldSend = number(dryRunStop.wouldSend, stats.dryRun.wouldSend);
  const dryWouldBlock = number(dryRunStop.wouldBlock, stats.dryRun.wouldBlock);
  const dryErrors = number(dryRunStop.errors, stats.dryRun.errors);
  const dryRunStopSimulationFailures = number(dryRunStop.simulationFailed, 0);
  const drySimulationFailureSummary = summarizeSimulationFailureCounts(
    stats.dryRun.simulationErrors
  );
  const drySimulationFailures = drySimulationFailureSummary.total;
  // A literal stop-row zero is authoritative; any observed quote-race event then fails closed below.
  const drySimulationAttempts = number(
    dryRunStop.simulations,
    number(stats.dryRun.simulationOk?.true, 0) + number(stats.dryRun.simulationOk?.false, 0)
  );
  const dryExpectedStateRaceSimulationFailures = drySimulationFailureSummary.expectedStateRace;
  const dryExpectedQuoteRaceSimulationFailures = drySimulationFailureSummary.expectedQuoteRace;
  const dryExpectedQuoteRaceRate = drySimulationAttempts > 0
    ? dryExpectedQuoteRaceSimulationFailures / drySimulationAttempts
    : 0;
  const allSimulationBlockhashLatencyMedianMs = pct(stats.dryRun.blockhashLatencyMs || [], 50);
  const quoteRaceBlockhashLatencies = (
    stats.dryRun.simulationFailureBlockhashLatencyMsByClass?.QUOTE_SLIPPAGE_RACE || []
  ).map(Number).filter(Number.isFinite);
  const dryExpectedQuoteRaceMissingLatencyFailures = Math.max(
    0,
    dryExpectedQuoteRaceSimulationFailures - quoteRaceBlockhashLatencies.length
  );
  const dryExpectedQuoteRaceLowLatencyFailures = Number.isFinite(allSimulationBlockhashLatencyMedianMs)
    ? quoteRaceBlockhashLatencies.filter(
      (latencyMs) => latencyMs < allSimulationBlockhashLatencyMedianMs
    ).length
    : dryExpectedQuoteRaceSimulationFailures;
  const dryExpectedQuoteRaceWithinBound = dryExpectedQuoteRaceSimulationFailures === 0
    || (
      drySimulationAttempts > 0
      && dryExpectedQuoteRaceRate <= EXPECTED_QUOTE_RACE_POLICY.maximumRate
      && dryExpectedQuoteRaceMissingLatencyFailures === 0
      && dryExpectedQuoteRaceLowLatencyFailures === 0
    );
  const dryCriticalSimulationFailures = drySimulationFailureSummary.critical
    + (dryExpectedQuoteRaceWithinBound ? 0 : dryExpectedQuoteRaceSimulationFailures);
  const dryPostMigrationRouteProbeStats = stats.dryRun.postMigrationRouteProbes || {};
  const dryPostMigrationRouteProbes = number(dryPostMigrationRouteProbeStats.attempted, 0);
  const dryPostMigrationRoutesAvailable = number(dryPostMigrationRouteProbeStats.available, 0);
  const dryPostMigrationRouteProbeErrors = number(dryPostMigrationRouteProbeStats.errors, 0);
  const drySimulationFailureAccountingMismatch = dryRunStopSimulationFailures !== drySimulationFailures;
  const dryPolicyBlocks = countOnly(stats.dryRun.blockReasons, [
    'PRICE_IMPACT_TOO_HIGH',
    'STALE_ACCOUNT_UPDATE',
    'BONDING_CURVE_COMPLETE',
    'UNSUPPORTED_QUOTE_MINT',
    'UNSUPPORTED_QUOTE_PAIR',
    'MISSING_SOL_RESERVES',
    'QUOTE_RESERVE_DRIFT'
  ]) + (
    dryExpectedQuoteRaceWithinBound
      ? countOnly(stats.dryRun.blockReasons, ['QUOTE_SLIPPAGE_RACE'])
      : 0
  );
  const dryCriticalBlocks = Math.max(0, dryWouldBlock - dryPolicyBlocks);
  const dryAmountSol = number(dryRunStop.amountSol, 0.1);
  const drySignedTrue = number(stats.dryRun.signedOk.true, 0);
  const drySignedFalse = number(stats.dryRun.signedOk.false, 0);
  const dryBroadcastTrue = number(stats.dryRun.broadcastEnabled.true, 0);
  const dryBroadcastFalse = number(stats.dryRun.broadcastEnabled.false, 0);
  const finalistSubscribed = number(finalistStop.subscribed, stats.finalist.subscribed);
  const finalistUpdates = number(finalistStop.updates, stats.finalist.updates);
  const finalistErrors = number(finalistStop.subscribeErrors, stats.finalist.errors)
    + number(finalistStop.initialSnapshotErrors, stats.finalist.initialErrors)
    + number(finalistStop.decodeErrors, stats.finalist.invalid);
  const finalistReady = number(finalistStop.shadowGateReady, stats.finalist.shadowReady);
  const finalistChecks = number(finalistStop.shadowGateChecks, stats.finalist.shadowChecks);
  const paperEntries = number(preMigrationStop.entries, stats.paper.entries);
  const paperExits = number(preMigrationStop.exits, stats.paper.exits);
  const paperPnl = number(preMigrationStop.totalPnlSol, stats.paper.pnlSol);
  const currentHotWalletBalanceAvailable = stats.currentHotWalletBalanceSol !== null
    && stats.currentHotWalletBalanceSol !== undefined
    && Number.isFinite(Number(stats.currentHotWalletBalanceSol));
  const stoppedHotWalletBalanceAvailable = stop.hotWalletBalanceSol !== null
    && stop.hotWalletBalanceSol !== undefined
    && Number.isFinite(Number(stop.hotWalletBalanceSol))
    && Number(stop.hotWalletBalanceSol) > 0;
  const hotWalletBalanceSol = currentHotWalletBalanceAvailable
    ? Number(stats.currentHotWalletBalanceSol)
    : stoppedHotWalletBalanceAvailable
      ? Number(stop.hotWalletBalanceSol)
      : null;
  const requiredLiveBalanceSol = Math.max(0.05, (dryAmountSol * 2) + 0.02);

  if (rpcStarted < 25) {
    warnings.push(`RPC sample is small (${rpcStarted} calls); keep collecting before inferring live-scale reliability.`);
  } else if (rpcFailures === 0) {
    passes.push(`RPC account-read path clean (${rpcStarted}/${rpcStarted} completed, 0 failed).`);
  }
  if (rpcFailures > 0) blockers.push(`RPC failures present (${rpcFailures}/${rpcStarted}); live final check cannot depend on this yet.`);

  if (pumpDevCloses === 0 && pumpDevErrors === 0 && pumpDevDropped === 0 && pumpDevQueueErrors === 0) {
    passes.push('PumpDev primary feed had no closes, errors, dropped events, or queue errors.');
  } else if (pumpDevErrors === 0 && pumpDevDropped === 0 && pumpDevQueueErrors === 0) {
    warnings.push(`PumpDev primary feed reconnected during the run (closes=${pumpDevCloses}) but had no errors, dropped events, or queue errors.`);
  } else {
    blockers.push(`PumpDev feed instability: closes=${pumpDevCloses}, errors=${pumpDevErrors}, dropped=${pumpDevDropped}, queueErrors=${pumpDevQueueErrors}.`);
  }

  if (eventLoopMaxLagMs <= 500 && eventLoopLagEvents <= liveSafeLagEventBudget) {
    passes.push(`Event loop stayed live-safe for paper (${eventLoopLagEvents} lag events, max ${eventLoopMaxLagMs}ms, ${eventLoopLagRatePerHour.toFixed(2)}/hr).`);
  } else if (eventLoopMaxLagMs <= 750 && eventLoopLagEvents <= watchLagEventBudget) {
    warnings.push(`Event-loop lag improved but still watch it (${eventLoopLagEvents} events, max ${eventLoopMaxLagMs}ms, ${eventLoopLagRatePerHour.toFixed(2)}/hr).`);
  } else {
    blockers.push(`Event-loop lag is too high for live (${eventLoopLagEvents} events, max ${eventLoopMaxLagMs}ms, ${eventLoopLagRatePerHour.toFixed(2)}/hr).`);
  }

  if (finalistSubscribed > 0 && finalistUpdates > 0 && finalistErrors === 0 && finalistReady > 0) {
    passes.push(`Finalist verifier is working (${finalistSubscribed} subs, ${finalistUpdates} updates, ${finalistReady}/${finalistChecks} ready checks).`);
  } else {
    blockers.push(`Finalist verifier not live-ready: subs=${finalistSubscribed}, updates=${finalistUpdates}, errors=${finalistErrors}, ready=${finalistReady}.`);
  }

  if (dryPolicyBlocks > 0) {
    warnings.push(`Dry-run policy blocks observed (${dryPolicyBlocks}/${dryAttempts}); safety rails are active and should remain visible in review.`);
  }

  if (dryExpectedStateRaceSimulationFailures > 0) {
    if (
      dryPostMigrationRoutesAvailable >= dryExpectedStateRaceSimulationFailures
      && dryPostMigrationRouteProbeErrors === 0
    ) {
      warnings.push(
        `Dry-run observed ${dryExpectedStateRaceSimulationFailures} bonding-curve completion race(s) and found a fresh acceptable Jupiter route for each; probes were report-only and no fallback trade executed.`
      );
    } else {
      warnings.push(
        `Dry-run observed ${dryExpectedStateRaceSimulationFailures} bonding-curve completion race(s); these are not wallet failures, but fresh acceptable post-migration route evidence is incomplete (${dryPostMigrationRoutesAvailable}/${dryExpectedStateRaceSimulationFailures}, probeErrors=${dryPostMigrationRouteProbeErrors}).`
      );
    }
  }
  if (dryExpectedQuoteRaceSimulationFailures > 0 && dryExpectedQuoteRaceWithinBound) {
    warnings.push(
      `Dry-run observed ${dryExpectedQuoteRaceSimulationFailures} bounded quote-slippage race(s) (${(dryExpectedQuoteRaceRate * 100).toFixed(2)}% of simulations); each occurred at or above the run's median blockhash latency and remains report-only.`
    );
  } else if (dryExpectedQuoteRaceSimulationFailures > 0) {
    blockers.push(
      `Dry-run quote-slippage races exceeded the frozen benign bound (count=${dryExpectedQuoteRaceSimulationFailures}, rate=${(dryExpectedQuoteRaceRate * 100).toFixed(2)}%, lowLatency=${dryExpectedQuoteRaceLowLatencyFailures}, missingLatency=${dryExpectedQuoteRaceMissingLatencyFailures}); all are critical for readiness.`
    );
  }
  if (drySimulationFailureAccountingMismatch) {
    blockers.push(
      `Dry-run simulation failure accounting disagrees (session stop=${dryRunStopSimulationFailures}, classified events=${drySimulationFailures}); readiness remains blocked until the telemetry lifecycle is reconciled.`
    );
  }
  if (dryCriticalSimulationFailures > 0) {
    blockers.push(`Dry-run transaction simulation is failing (${dryCriticalSimulationFailures}/${dryAttempts} critical; ${dryExpectedStateRaceSimulationFailures} expected curve-completion races and ${dryExpectedQuoteRaceWithinBound ? dryExpectedQuoteRaceSimulationFailures : 0} bounded quote races excluded); live execution cannot be reviewed until critical simulations pass.`);
  } else if (dryAttempts >= 20 && dryWouldSend >= 20 && dryCriticalBlocks === 0 && dryErrors === 0) {
    passes.push(`Dry-run tx builder is healthy (${dryWouldSend}/${dryAttempts} would_send, criticalBlocks=${dryCriticalBlocks}, policyBlocks=${dryPolicyBlocks}, errors=0).`);
  } else if (dryAttempts > 0 && dryWouldSend > 0 && dryCriticalBlocks === 0 && dryErrors === 0) {
    passes.push(`Dry-run tx builder produced an executable sample (${dryWouldSend}/${dryAttempts} would_send, criticalBlocks=${dryCriticalBlocks}, policyBlocks=${dryPolicyBlocks}, errors=0).`);
    warnings.push(`Dry-run executable sample is still small (${dryAttempts}/20 target); validate on a longer run before live review.`);
  } else if (dryAttempts > 0 && dryErrors === 0) {
    blockers.push(`Dry-run lane has critical blocks (${dryCriticalBlocks}/${dryAttempts}); would_send=${dryWouldSend}, policyBlocks=${dryPolicyBlocks}.`);
  } else {
    blockers.push(`Dry-run lane did not produce a clean sample (attempts=${dryAttempts}, errors=${dryErrors}).`);
  }

  if (paperEntries === 0) {
    warnings.push('No paper entries this run; infra looks healthier than strategy evidence.');
    launchBlocks.push('Strategy evidence is not live-launchable: no paper entries in the evaluated run.');
  } else if (paperPnl < 0) {
    warnings.push(`Paper strategy sample was negative (${paperEntries}/${paperExits} entries/exits, pnl ${paperPnl.toFixed(6)} SOL).`);
    launchBlocks.push(`Strategy evidence is not live-launchable: paper sample is negative (${paperEntries} entries, pnl ${paperPnl.toFixed(6)} SOL).`);
  } else {
    passes.push(`Paper strategy sample was non-negative (${paperEntries}/${paperExits}, pnl ${paperPnl.toFixed(6)} SOL).`);
    if (paperEntries < 20) {
      launchBlocks.push(`Strategy sample is too small for live launch review (${paperEntries}/20 minimum paper entries).`);
    }
  }

  if (hotWalletBalanceSol === null) {
    blockers.push('Hot wallet balance is unavailable; live execution funding cannot be verified from this report.');
  } else if (hotWalletBalanceSol < requiredLiveBalanceSol) {
    blockers.push(`Hot wallet is not funded for live execution (${hotWalletBalanceSol.toFixed(6)} SOL; target at least ${requiredLiveBalanceSol.toFixed(3)} SOL for dry amount plus fees).`);
  } else {
    passes.push(`Hot wallet balance covers one configured dry-run buy plus fee buffer (${hotWalletBalanceSol.toFixed(6)} SOL).`);
  }

  if (dryWouldSend > 0 && drySignedTrue < dryWouldSend) {
    launchBlocks.push(`Live-wallet signed simulation has not passed for all dry-run would_send rows (signedOk true/false/null=${drySignedTrue}/${drySignedFalse}/${number(stats.dryRun.signedOk.null, 0)}).`);
  }
  if (dryWouldSend > 0 && dryBroadcastTrue === 0 && dryBroadcastFalse > 0) {
    launchBlocks.push('Broadcast path is still report-only (broadcastEnabled=false on dry-run would_send rows).');
  }
  if (blockers.length > 0) {
    launchBlocks.push('Infrastructure blockers must be cleared before any live launch review.');
  }

  if (launchBlocks.length > 0) {
    warnings.push('Live broadcast should remain disabled until launch blockers clear.');
  }

  let verdict = 'blocked';
  if (blockers.length === 0 && launchBlocks.length > 0) {
    verdict = 'infra_ready_strategy_not_proven';
  } else if (blockers.length === 0) {
    verdict = 'ready_for_controlled_live_review';
  }

  return {
    verdict,
    blockers,
    launchBlocks,
    warnings,
    passes,
    metrics: {
      rpcStarted,
      rpcFailures,
      pumpDevCloses,
      pumpDevErrors,
      eventLoopMaxLagMs,
      eventLoopLagEvents,
      eventLoopLagRatePerHour,
      telemetryDurationHours,
      finalistSubscribed,
      finalistUpdates,
      finalistReady,
      finalistChecks,
      dryAttempts,
      dryWouldSend,
      dryWouldBlock,
      dryPolicyBlocks,
      dryCriticalBlocks,
      dryErrors,
      dryRunStopSimulationFailures,
      drySimulationAttempts,
      drySimulationFailures,
      dryExpectedStateRaceSimulationFailures,
      dryExpectedQuoteRaceSimulationFailures,
      dryExpectedQuoteRaceRate,
      dryExpectedQuoteRaceWithinBound,
      dryExpectedQuoteRaceLowLatencyFailures,
      dryExpectedQuoteRaceMissingLatencyFailures,
      expectedQuoteRacePolicy: EXPECTED_QUOTE_RACE_POLICY,
      dryCriticalSimulationFailures,
      dryPostMigrationRouteProbes,
      dryPostMigrationRoutesAvailable,
      dryPostMigrationRouteProbeErrors,
      drySimulationFailureAccountingMismatch,
      drySignedTrue,
      drySignedFalse,
      drySignedNull: number(stats.dryRun.signedOk.null, 0),
      dryBroadcastTrue,
      dryBroadcastFalse,
      dryBroadcastNull: number(stats.dryRun.broadcastEnabled.null, 0),
      dryAmountSol,
      hotWalletBalanceSol,
      requiredLiveBalanceSol,
      paperEntries,
      paperExits,
      paperPnl
    }
  };
}

function buildReport(stats) {
  const verdict = buildVerdict(stats);
  const runnerRejectEntryReplay = readOptionalJson(RUNNER_REJECT_ENTRY_REPLAY_REPORT);
  const walletFalseNegativeEntryReplay = readOptionalJson(WALLET_FALSE_NEGATIVE_ENTRY_REPLAY_REPORT);
  const curveConfirmationReplayReport = readOptionalJson(CURVE_CONFIRMATION_REPLAY_REPORT);
  const runnerShadowProfiles = selectRunnerShadowProfiles(runnerRejectEntryReplay);
  const walletShadowReplay = selectWalletFalseNegativeReplay(walletFalseNegativeEntryReplay);
  const curveConfirmationReplay = selectCurveConfirmationReplay(curveConfirmationReplayReport);
  return {
    generatedAt: new Date().toISOString(),
    telemetryPath: path.relative(ROOT, stats.filePath),
    verdict: verdict.verdict,
    blockers: verdict.blockers,
    launchBlocks: verdict.launchBlocks,
    warnings: verdict.warnings,
    passes: verdict.passes,
    metrics: {
      ...verdict.metrics,
      dryRun: {
        uniqueMints: stats.dryRun.uniqueMints,
        accountAgeMs: {
          median: pct(stats.dryRun.accountAgeMs, 50),
          p90: pct(stats.dryRun.accountAgeMs, 90),
          max: stats.dryRun.accountAgeMs.length ? Math.max(...stats.dryRun.accountAgeMs) : null
        },
        priceImpactPct: {
          median: pct(stats.dryRun.priceImpactPct, 50),
          p90: pct(stats.dryRun.priceImpactPct, 90),
          max: stats.dryRun.priceImpactPct.length ? Math.max(...stats.dryRun.priceImpactPct) : null
        },
        blockhashLatencyMs: {
          median: pct(stats.dryRun.blockhashLatencyMs, 50),
          p90: pct(stats.dryRun.blockhashLatencyMs, 90),
          max: stats.dryRun.blockhashLatencyMs.length ? Math.max(...stats.dryRun.blockhashLatencyMs) : null
        },
        skipReasons: stats.dryRun.skipReasons,
        blockReasons: stats.dryRun.blockReasons,
        txBuildStatus: stats.dryRun.txBuildStatus,
        simulationOk: stats.dryRun.simulationOk,
        simulationErrors: stats.dryRun.simulationErrors,
        simulationClassifierEpochs: stats.dryRun.simulationClassifierEpochs,
        simulationFailureMintsByClass: stats.dryRun.simulationFailureMintsByClass,
        simulationFailureBlockhashLatencyMsByClass:
          stats.dryRun.simulationFailureBlockhashLatencyMsByClass,
        bondingCurveMintMismatchDiagnostics:
          stats.dryRun.bondingCurveMintMismatchDiagnostics,
        simulationMissingAccounts: stats.dryRun.simulationMissingAccounts,
        simulationPassedWithPreflightMissingAccounts: stats.dryRun.simulationPassedWithPreflightMissingAccounts,
        postMigrationRouteProbes: stats.dryRun.postMigrationRouteProbes || {
          attempted: 0,
          available: 0,
          unavailable: 0,
          errors: 0,
          statuses: {},
          reasons: {}
        },
        signedOk: stats.dryRun.signedOk,
        broadcastEnabled: stats.dryRun.broadcastEnabled,
        signatureModes: stats.dryRun.signatureModes
      },
      finalist: {
        uniqueMints: stats.finalist.uniqueMints,
        shadowStatuses: stats.finalist.shadowStatuses,
        blockReasons: stats.finalist.blockReasons,
        accountAgeMs: {
          median: pct(stats.finalist.accountAgeMs, 50),
          p90: pct(stats.finalist.accountAgeMs, 90),
          max: stats.finalist.accountAgeMs.length ? Math.max(...stats.finalist.accountAgeMs) : null
        }
      },
      rpc: {
        methods: stats.rpc.methods,
        failedMethods: stats.rpc.failedMethods,
        failureClasses: stats.rpc.failureClasses
      },
      paper: {
        uniqueEntryMints: stats.paper.uniqueEntryMints,
        exitReasons: stats.paper.exitReasons
      },
      shadowEvidence: {
        runnerRejectEntryReplay: runnerRejectEntryReplay ? {
          generatedAt: runnerRejectEntryReplay.generatedAt || null,
          mode: runnerRejectEntryReplay.mode || null,
          candidates: runnerRejectEntryReplay.inputs?.candidates ?? null,
          sizeSol: runnerRejectEntryReplay.assumptions?.sizeSol ?? null,
          feeSol: runnerRejectEntryReplay.assumptions?.feeSol ?? null,
          defaultEntrySlippagePct: runnerRejectEntryReplay.assumptions?.defaultEntrySlippagePct ?? null,
          defaultExitSlippagePct: runnerRejectEntryReplay.assumptions?.defaultExitSlippagePct ?? null,
          profiles: runnerShadowProfiles
        } : null,
        walletFalseNegativeEntryReplay: walletShadowReplay,
        curveConfirmationReplay
      }
    }
  };
}

function writeText(report) {
  const lines = [];
  lines.push('Live Readiness Report');
  lines.push('=====================');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Telemetry: ${report.telemetryPath}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push('');

  lines.push('Passes');
  for (const line of report.passes) lines.push(`- ${line}`);
  if (!report.passes.length) lines.push('- none');
  lines.push('');

  lines.push('Warnings');
  for (const line of report.warnings) lines.push(`- ${line}`);
  if (!report.warnings.length) lines.push('- none');
  lines.push('');

  lines.push('Infrastructure Blockers');
  for (const line of report.blockers) lines.push(`- ${line}`);
  if (!report.blockers.length) lines.push('- none');
  lines.push('');

  lines.push('Live Launch Blocks');
  for (const line of report.launchBlocks || []) lines.push(`- ${line}`);
  if (!report.launchBlocks?.length) lines.push('- none');
  lines.push('');

  const m = report.metrics;
  lines.push('Key Metrics');
  lines.push(`- RPC started/failed: ${m.rpcStarted} / ${m.rpcFailures}`);
  lines.push(`- PumpDev closes/errors: ${m.pumpDevCloses} / ${m.pumpDevErrors}`);
  lines.push(`- Event-loop lag events/max/rate: ${m.eventLoopLagEvents} / ${m.eventLoopMaxLagMs}ms / ${fmt(m.eventLoopLagRatePerHour, 2)}/hr`);
  lines.push(`- Finalist verifier subscribed/updates/ready/checks: ${m.finalistSubscribed} / ${m.finalistUpdates} / ${m.finalistReady} / ${m.finalistChecks}`);
  lines.push(`- Dry-run attempts/would_send/would_block/errors: ${m.dryAttempts} / ${m.dryWouldSend} / ${m.dryWouldBlock} / ${m.dryErrors}`);
  lines.push(`- Dry-run simulation failures: ${m.drySimulationFailures}`);
  lines.push(`- Dry-run session-stop simulation failures: ${m.dryRunStopSimulationFailures}`);
  lines.push(`- Dry-run simulation accounting mismatch: ${m.drySimulationFailureAccountingMismatch}`);
  lines.push(`- Dry-run critical simulation failures: ${m.dryCriticalSimulationFailures}`);
  lines.push(`- Dry-run expected curve-completion races: ${m.dryExpectedStateRaceSimulationFailures}`);
  lines.push(`- Dry-run expected quote races/count/rate/within bound: ${m.dryExpectedQuoteRaceSimulationFailures} / ${fmt(m.dryExpectedQuoteRaceRate * 100, 2)}% / ${m.dryExpectedQuoteRaceWithinBound}`);
  lines.push(`- Dry-run post-migration route probes/available/errors: ${m.dryPostMigrationRouteProbes} / ${m.dryPostMigrationRoutesAvailable} / ${m.dryPostMigrationRouteProbeErrors} (report-only)`);
  lines.push(`- Dry-run signedOk true/false/null: ${m.drySignedTrue} / ${m.drySignedFalse} / ${m.drySignedNull}`);
  lines.push(`- Dry-run broadcastEnabled true/false/null: ${m.dryBroadcastTrue} / ${m.dryBroadcastFalse} / ${m.dryBroadcastNull}`);
  lines.push(`- Dry-run account age median/p90/max: ${fmt(m.dryRun.accountAgeMs.median, 0)} / ${fmt(m.dryRun.accountAgeMs.p90, 0)} / ${fmt(m.dryRun.accountAgeMs.max, 0)}ms`);
  lines.push(`- Dry-run price impact median/p90/max: ${fmt(m.dryRun.priceImpactPct.median, 4)}% / ${fmt(m.dryRun.priceImpactPct.p90, 4)}% / ${fmt(m.dryRun.priceImpactPct.max, 4)}%`);
  lines.push(`- Dry-run simulation ok true/false/null: ${m.dryRun.simulationOk.true || 0} / ${m.dryRun.simulationOk.false || 0} / ${m.dryRun.simulationOk.null || 0}`);
  const signatureModes = Object.entries(m.dryRun.signatureModes || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [name, count] of signatureModes) lines.push(`- Dry-run signature mode: ${name}: ${count}`);
  const blockReasons = Object.entries(m.dryRun.blockReasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [name, count] of blockReasons) lines.push(`- Dry-run block reason: ${name}: ${count}`);
  const classifierEpochs = Object.entries(m.dryRun.simulationClassifierEpochs || {})
    .sort((a, b) => b[1] - a[1]);
  for (const [name, count] of classifierEpochs) {
    lines.push(`- Dry-run simulation classifier epoch: ${name}: ${count}`);
  }
  const failureClasses = Object.entries(m.dryRun.simulationErrors || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [name, count] of failureClasses) {
    lines.push(`- Dry-run simulation failure class: ${name}: ${count}`);
    const mintCounts = Object.entries(m.dryRun.simulationFailureMintsByClass?.[name] || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [mint, mintCount] of mintCounts) lines.push(`  - ${mint}: ${mintCount}`);
  }
  const missing = Object.entries(m.dryRun.simulationMissingAccounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [name, count] of missing) lines.push(`- Dry-run missing account: ${name}: ${count}`);
  const preflightMissing = Object.entries(m.dryRun.simulationPassedWithPreflightMissingAccounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (preflightMissing.length) {
    lines.push('- Dry-run expected-to-be-created accounts were absent before sim, and signed simulation succeeded:');
    for (const [name, count] of preflightMissing) lines.push(`  - ${name}: ${count}`);
  }
  lines.push(`- Hot wallet balance / target: ${fmt(m.hotWalletBalanceSol, 6)} / ${fmt(m.requiredLiveBalanceSol, 3)} SOL`);
  lines.push(`- Paper entries/exits/PnL: ${m.paperEntries} / ${m.paperExits} / ${fmt(m.paperPnl, 6)} SOL`);
  lines.push('');

  lines.push('Shadow Strategy Evidence');
  const runnerReplay = m.shadowEvidence?.runnerRejectEntryReplay || null;
  if (runnerReplay) {
    lines.push('- Runner reject entry replay is report-only and does not satisfy live launch paper-entry requirements.');
    lines.push(`- Candidates / size / fee / default slippage: ${runnerReplay.candidates ?? 'n/a'} / ${fmt(runnerReplay.sizeSol, 4)} SOL / ${fmt(runnerReplay.feeSol, 6)} SOL / ${fmt(runnerReplay.defaultEntrySlippagePct, 2)}%+${fmt(runnerReplay.defaultExitSlippagePct, 2)}%`);
    for (const profile of (runnerReplay.profiles || []).slice(0, 5)) {
      const winRate = profile.winRate === null || profile.winRate === undefined ? 'n/a' : `${fmt(Number(profile.winRate) * 100, 1)}%`;
      const tags = Array.isArray(profile.verdictTags) && profile.verdictTags.length ? `, tags=${profile.verdictTags.join(',')}` : '';
      lines.push(`- ${profile.name}: trades=${profile.trades}, wins/losses=${profile.wins}/${profile.losses}, winRate=${winRate}, pnl=${fmt(profile.totalPnlSol, 9)} SOL, exTop1=${fmt(profile.pnlAfterRemovingTopWinnerSol, 9)} SOL, exTop3=${fmt(profile.pnlAfterRemovingTop3WinnersSol, 9)} SOL, top1GrossShare=${profile.topWinnerShareOfGrossProfit === null || profile.topWinnerShareOfGrossProfit === undefined ? 'n/a' : `${fmt(Number(profile.topWinnerShareOfGrossProfit) * 100, 1)}%`}${tags}`);
    }
  } else {
    lines.push('- No runner reject entry replay report found.');
  }
  const walletReplay = m.shadowEvidence?.walletFalseNegativeEntryReplay || null;
  if (walletReplay) {
    lines.push('- Wallet false-negative entry replay is report-only and does not satisfy live launch paper-entry requirements.');
    lines.push(`- Wallet replay verdict / eligible: ${walletReplay.verdict || 'n/a'} / ${walletReplay.shadowLaneEligible === true ? 'yes' : 'no'}`);
    lines.push(`- Wallet replay sample: strongMisses=${walletReplay.strongWalletLedMisses ?? 'n/a'}, wouldEnter=${walletReplay.wouldEnter ?? 'n/a'}, noGateConfirm=${walletReplay.noGateConfirmAfterTouch ?? 'n/a'}, winRate=${walletReplay.winRate === null || walletReplay.winRate === undefined ? 'n/a' : `${fmt(Number(walletReplay.winRate) * 100, 1)}%`}`);
    lines.push(`- Wallet replay PnL: raw=${fmt(walletReplay.totalPnlSol, 9)} SOL, stressed=${fmt(walletReplay.stressedPnlSol, 9)} SOL, firstHalf=${fmt(walletReplay.firstHalfPnlSol, 9)} SOL, secondHalf=${fmt(walletReplay.secondHalfPnlSol, 9)} SOL`);
    const walletReplayTags = Array.isArray(walletReplay.verdictTags) && walletReplay.verdictTags.length ? `, tags=${walletReplay.verdictTags.join(',')}` : '';
    lines.push(`- Wallet replay concentration: exTop1=${fmt(walletReplay.pnlAfterTopWinnerSol, 9)} SOL, exTop3=${fmt(walletReplay.pnlAfterTop3WinnersSol, 9)} SOL, top1GrossShare=${walletReplay.topWinnerShareOfGrossProfit === null || walletReplay.topWinnerShareOfGrossProfit === undefined ? 'n/a' : `${fmt(Number(walletReplay.topWinnerShareOfGrossProfit) * 100, 1)}%`}${walletReplayTags}`);
    if (walletReplay.verdictReason) lines.push(`- Wallet replay verdict reason: ${walletReplay.verdictReason}`);
  } else {
    lines.push('- No wallet false-negative entry replay report found.');
  }
  const curveReplay = m.shadowEvidence?.curveConfirmationReplay || null;
  if (curveReplay) {
    lines.push('- Curve-confirmation replay is report-only and does not satisfy live launch paper-entry requirements.');
    lines.push(`- Curve-confirmation scope: files=${curveReplay.telemetryFilesRead ?? 'n/a'}, targetReasons=${Array.isArray(curveReplay.targetReasons) ? curveReplay.targetReasons.join(',') : 'n/a'}`);
    for (const profile of (curveReplay.profiles || []).slice(0, 5)) {
      const winRate = profile.winRate === null || profile.winRate === undefined ? 'n/a' : `${fmt(Number(profile.winRate) * 100, 1)}%`;
      lines.push(`- ${profile.name}: confirmed=${profile.confirmedEntries ?? 'n/a'}/${profile.decisions ?? 'n/a'}, unique=${profile.confirmedUniqueMints ?? 'n/a'}/${profile.uniqueMints ?? 'n/a'}, wins/losses=${profile.wins ?? 'n/a'}/${profile.losses ?? 'n/a'}, winRate=${winRate}, pnl=${fmt(profile.totalPnlSol, 9)} SOL, median=${fmt(profile.medianPnlSol, 9)} SOL, p90=${fmt(profile.p90PnlSol, 9)} SOL`);
    }
  } else {
    lines.push('- No curve-confirmation replay report found.');
  }
  lines.push('');

  lines.push('Interpretation');
  if (report.verdict === 'infra_ready_strategy_not_proven') {
    lines.push('- Infrastructure gates are passing, but live trading remains blocked by the launch-block list above.');
  } else if (report.verdict === 'ready_for_controlled_live_review') {
    lines.push('- This run passes the current report-only readiness gates. Human review is still required before enabling any broadcast path.');
  } else {
    lines.push('- One or more infrastructure gates are still blocking live readiness.');
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  const telemetryPath = findLatestTelemetry();
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stats = await readTelemetry(telemetryPath);
  stats.currentHotWalletBalanceSol = await readCurrentHotWalletBalanceSol();
  const report = buildReport(stats);
  fs.writeFileSync(JSON_REPORT, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(TEXT_REPORT, writeText(report));
  console.log(`Wrote ${path.relative(ROOT, JSON_REPORT)}`);
  console.log(`Wrote ${path.relative(ROOT, TEXT_REPORT)}`);
  console.log(`Verdict: ${report.verdict}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildVerdict
};
