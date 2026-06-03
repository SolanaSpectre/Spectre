#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();
const { Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const Config = require('../src/config');
const WalletManager = require('../src/wallet');

const ROOT = path.resolve(__dirname, '..');
const TELEMETRY_DIR = path.join(ROOT, 'run-logs');
const REPORT_DIR = path.join(ROOT, 'data', 'reports');
const JSON_REPORT = path.join(REPORT_DIR, 'live-readiness-latest.json');
const TEXT_REPORT = path.join(REPORT_DIR, 'live-readiness-latest.txt');

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

async function readTelemetry(filePath) {
  const stats = {
    filePath,
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
      simulationMissingAccounts: {},
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
      if (type === 'live_dry_run.would_send') {
        stats.dryRun.attempts += 1;
        stats.dryRun.wouldSend += 1;
        pushNumber(stats.dryRun.accountAgeMs, payload.accountAgeMs);
        pushNumber(stats.dryRun.priceImpactPct, payload.quote && payload.quote.priceImpactPct);
        pushNumber(stats.dryRun.blockhashLatencyMs, payload.blockhashLatencyMs);
        increment(stats.dryRun.txBuildStatus, payload.txBuildStatus || 'unknown');
        if (payload.simulationOk === true || payload.simulationOk === false) {
          increment(stats.dryRun.simulationOk, String(payload.simulationOk));
          if (payload.simulationOk === false) increment(stats.dryRun.simulationErrors, payload.simulationError || 'SIMULATION_FAILED');
        } else {
          increment(stats.dryRun.simulationOk, 'null');
        }
      } else if (type === 'live_dry_run.would_block') {
        stats.dryRun.attempts += 1;
        stats.dryRun.wouldBlock += 1;
        pushNumber(stats.dryRun.accountAgeMs, payload.accountAgeMs);
        pushNumber(stats.dryRun.priceImpactPct, payload.quote && payload.quote.priceImpactPct);
        pushNumber(stats.dryRun.blockhashLatencyMs, payload.blockhashLatencyMs);
        increment(stats.dryRun.blockReasons, payload.reason || 'unknown');
        increment(stats.dryRun.txBuildStatus, payload.txBuildStatus || 'unknown');
        if (payload.simulationOk === true || payload.simulationOk === false) {
          increment(stats.dryRun.simulationOk, String(payload.simulationOk));
          if (payload.simulationOk === false) increment(stats.dryRun.simulationErrors, payload.simulationError || payload.reason || 'SIMULATION_FAILED');
        } else {
          increment(stats.dryRun.simulationOk, 'null');
        }
        const missingAccounts = payload.simulationAccountDiagnostic && payload.simulationAccountDiagnostic.missingAccounts;
        if (Array.isArray(missingAccounts)) {
          for (const account of missingAccounts) {
            increment(stats.dryRun.simulationMissingAccounts, (account && (account.name || account.pubkey)) || 'unknown');
          }
        }
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
  const dryAttempts = number(dryRunStop.attempts, stats.dryRun.attempts);
  const dryWouldSend = number(dryRunStop.wouldSend, stats.dryRun.wouldSend);
  const dryWouldBlock = number(dryRunStop.wouldBlock, stats.dryRun.wouldBlock);
  const dryErrors = number(dryRunStop.errors, stats.dryRun.errors);
  const drySimulationFailures = number(dryRunStop.simulationFailed, stats.dryRun.simulationOk.false);
  const dryPolicyBlocks = countOnly(stats.dryRun.blockReasons, [
    'PRICE_IMPACT_TOO_HIGH',
    'STALE_ACCOUNT_UPDATE',
    'BONDING_CURVE_COMPLETE'
  ]);
  const dryCriticalBlocks = Math.max(0, dryWouldBlock - dryPolicyBlocks);
  const dryAmountSol = number(dryRunStop.amountSol, 0.1);
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
  const hotWalletBalanceSol = Number.isFinite(Number(stats.currentHotWalletBalanceSol))
    ? Number(stats.currentHotWalletBalanceSol)
    : number(stop.hotWalletBalanceSol, 0);
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

  if (eventLoopMaxLagMs <= 500 && eventLoopLagEvents <= 2) {
    passes.push(`Event loop stayed live-safe for paper (${eventLoopLagEvents} lag events, max ${eventLoopMaxLagMs}ms).`);
  } else if (eventLoopMaxLagMs <= 750 && eventLoopLagEvents <= 5) {
    warnings.push(`Event-loop lag improved but still watch it (${eventLoopLagEvents} events, max ${eventLoopMaxLagMs}ms).`);
  } else {
    blockers.push(`Event-loop lag is too high for live (${eventLoopLagEvents} events, max ${eventLoopMaxLagMs}ms).`);
  }

  if (finalistSubscribed > 0 && finalistUpdates > 0 && finalistErrors === 0 && finalistReady > 0) {
    passes.push(`Finalist verifier is working (${finalistSubscribed} subs, ${finalistUpdates} updates, ${finalistReady}/${finalistChecks} ready checks).`);
  } else {
    blockers.push(`Finalist verifier not live-ready: subs=${finalistSubscribed}, updates=${finalistUpdates}, errors=${finalistErrors}, ready=${finalistReady}.`);
  }

  if (dryPolicyBlocks > 0) {
    warnings.push(`Dry-run policy blocks observed (${dryPolicyBlocks}/${dryAttempts}); safety rails are active and should remain visible in review.`);
  }

  if (drySimulationFailures > 0) {
    blockers.push(`Dry-run transaction simulation is failing (${drySimulationFailures}/${dryAttempts}); live execution cannot be reviewed until simulations pass.`);
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
  } else if (paperPnl < 0) {
    warnings.push(`Paper strategy sample was negative (${paperEntries}/${paperExits} entries/exits, pnl ${paperPnl.toFixed(6)} SOL).`);
  } else {
    passes.push(`Paper strategy sample was non-negative (${paperEntries}/${paperExits}, pnl ${paperPnl.toFixed(6)} SOL).`);
  }

  if (hotWalletBalanceSol < requiredLiveBalanceSol) {
    blockers.push(`Hot wallet is not funded for live execution (${hotWalletBalanceSol.toFixed(6)} SOL; target at least ${requiredLiveBalanceSol.toFixed(3)} SOL for dry amount plus fees).`);
  } else {
    passes.push(`Hot wallet balance covers one configured dry-run buy plus fee buffer (${hotWalletBalanceSol.toFixed(6)} SOL).`);
  }

  warnings.push('Live broadcast should remain disabled until signed simulation/funding checks and a larger positive paper-entry sample pass.');

  let verdict = 'blocked';
  if (blockers.length === 0 && warnings.some((line) => /strategy|paper entries|negative|signed simulation|funding/i.test(line))) {
    verdict = 'infra_ready_strategy_not_proven';
  } else if (blockers.length === 0) {
    verdict = 'ready_for_controlled_live_review';
  }

  return {
    verdict,
    blockers,
    warnings,
    passes,
    metrics: {
      rpcStarted,
      rpcFailures,
      pumpDevCloses,
      pumpDevErrors,
      eventLoopMaxLagMs,
      eventLoopLagEvents,
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
      drySimulationFailures,
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
  return {
    generatedAt: new Date().toISOString(),
    telemetryPath: path.relative(ROOT, stats.filePath),
    verdict: verdict.verdict,
    blockers: verdict.blockers,
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
        simulationMissingAccounts: stats.dryRun.simulationMissingAccounts
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

  lines.push('Blockers');
  for (const line of report.blockers) lines.push(`- ${line}`);
  if (!report.blockers.length) lines.push('- none');
  lines.push('');

  const m = report.metrics;
  lines.push('Key Metrics');
  lines.push(`- RPC started/failed: ${m.rpcStarted} / ${m.rpcFailures}`);
  lines.push(`- PumpDev closes/errors: ${m.pumpDevCloses} / ${m.pumpDevErrors}`);
  lines.push(`- Event-loop lag events/max: ${m.eventLoopLagEvents} / ${m.eventLoopMaxLagMs}ms`);
  lines.push(`- Finalist verifier subscribed/updates/ready/checks: ${m.finalistSubscribed} / ${m.finalistUpdates} / ${m.finalistReady} / ${m.finalistChecks}`);
  lines.push(`- Dry-run attempts/would_send/would_block/errors: ${m.dryAttempts} / ${m.dryWouldSend} / ${m.dryWouldBlock} / ${m.dryErrors}`);
  lines.push(`- Dry-run simulation failures: ${m.drySimulationFailures}`);
  lines.push(`- Dry-run account age median/p90/max: ${fmt(m.dryRun.accountAgeMs.median, 0)} / ${fmt(m.dryRun.accountAgeMs.p90, 0)} / ${fmt(m.dryRun.accountAgeMs.max, 0)}ms`);
  lines.push(`- Dry-run price impact median/p90/max: ${fmt(m.dryRun.priceImpactPct.median, 4)}% / ${fmt(m.dryRun.priceImpactPct.p90, 4)}% / ${fmt(m.dryRun.priceImpactPct.max, 4)}%`);
  lines.push(`- Dry-run simulation ok true/false/null: ${m.dryRun.simulationOk.true || 0} / ${m.dryRun.simulationOk.false || 0} / ${m.dryRun.simulationOk.null || 0}`);
  const blockReasons = Object.entries(m.dryRun.blockReasons || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [name, count] of blockReasons) lines.push(`- Dry-run block reason: ${name}: ${count}`);
  const missing = Object.entries(m.dryRun.simulationMissingAccounts || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  for (const [name, count] of missing) lines.push(`- Dry-run missing account: ${name}: ${count}`);
  lines.push(`- Hot wallet balance / target: ${fmt(m.hotWalletBalanceSol, 6)} / ${fmt(m.requiredLiveBalanceSol, 3)} SOL`);
  lines.push(`- Paper entries/exits/PnL: ${m.paperEntries} / ${m.paperExits} / ${fmt(m.paperPnl, 6)} SOL`);
  lines.push('');

  lines.push('Interpretation');
  if (report.verdict === 'infra_ready_strategy_not_proven') {
    lines.push('- Infrastructure gates are passing, but live trading is still blocked by strategy evidence and live-wallet simulation/funding checks.');
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
