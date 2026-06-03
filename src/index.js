const Config = require('./config');
const Logger = require('./logger');
const TradingEngine = require('./trading-engine');

function parseArgs(argv) {
  const parsed = {};
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  if (!parsed.mode && positional[0]) {
    const compactPaperMatch = String(positional[0]).match(/^PAPER(\d+)$/i);
    if (compactPaperMatch) {
      parsed.mode = 'PAPER';
      parsed.session = parsed.session || compactPaperMatch[1];
    } else {
      parsed.mode = positional[0];
    }
  }

  if (!parsed.session && positional[1]) {
    parsed.session = positional[1];
  }

  return parsed;
}

function applyRuntimeOverrides(args) {
  if (args.mode) {
    process.env.EXECUTION_MODE = args.mode;
  }

  if (args.session) {
    process.env.SESSION_DURATION_MINUTES = args.session;
  }

  if (args.aiTimeout) {
    process.env.AI_TIMEOUT_MS = args.aiTimeout;
  }

  if (args.maxQuoteAge) {
    process.env.MAX_QUOTE_AGE_MS = args.maxQuoteAge;
  }
}

class SolanaTradingBot {
  constructor() {
    this.config = null;
    this.logger = null;
    this.tradingEngine = null;
    this.running = false;
    this.shutdownInProgress = false;
    this.sessionExitTimer = null;
    this.forceExitTimer = null;
    this.processSessionDeadlineAt = null;
    this.statusLoopCount = 0;
    this.lastStatusSnapshot = null;
  }

  async start() {
    try {
      const args = parseArgs(process.argv.slice(2));
      applyRuntimeOverrides(args);

      console.log('Starting Solana Memecoin Trading Bot...');

      this.config = Config;
      this.config.validate();

      if (this.config.executionMode === 'LIVE' && args.confirmLive !== 'true') {
        throw new Error('LIVE mode requires --confirmLive true');
      }

      this.logger = new Logger(this.config.logLevel);
      this.logger.info('Bot configuration loaded successfully', {
        executionMode: this.config.executionMode,
        sessionDurationMinutes: this.config.sessionDurationMinutes,
        aiTimeoutMs: this.config.aiTimeoutMs,
        maxQuoteAgeMs: this.config.maxQuoteAgeMs
      });

      this.armProcessSessionWatchdog();
      this.tradingEngine = new TradingEngine(this.config, this.logger);
      await this.tradingEngine.initialize();
      await this.tradingEngine.start();
      this.running = true;

      this.logger.success('Trading bot started successfully');
      this.setupGracefulShutdown();
      this.monitoringLoop();
    } catch (error) {
      console.error('Failed to start trading bot:', error.message);
      process.exit(1);
    }
  }

  setupGracefulShutdown() {
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  armProcessSessionWatchdog() {
    if (this.sessionExitTimer) {
      clearTimeout(this.sessionExitTimer);
      this.sessionExitTimer = null;
    }

    const durationMinutes = Number(this.config.sessionDurationMinutes || 0);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      this.processSessionDeadlineAt = null;
      return;
    }

    const timeoutMs = Math.max(1, durationMinutes * 60 * 1000);
    this.processSessionDeadlineAt = Date.now() + timeoutMs;
    this.sessionExitTimer = setTimeout(() => {
      const message = 'Process session duration reached; shutting down bot process';
      if (this.logger) {
        this.logger.info(message);
      } else {
        console.log(message);
      }
      this.shutdown('SESSION_DURATION_EXCEEDED');
    }, timeoutMs);
  }

  async shutdown(signal, exitCode = 0) {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.running = false;

    if (this.sessionExitTimer) {
      clearTimeout(this.sessionExitTimer);
      this.sessionExitTimer = null;
    }

    // If a provider or report flush hangs, do not leave npm waiting forever.
    this.forceExitTimer = setTimeout(() => {
      const message = `Forced bot process exit after shutdown grace period (${signal})`;
      if (this.logger) {
        this.logger.warn(message);
      } else {
        console.warn(message);
      }
      process.exit(exitCode);
    }, 20000);

    try {
      if (this.tradingEngine?.active) {
        await Promise.race([
          this.tradingEngine.stop(signal),
          this.sleep(15000)
        ]);
      }
    } catch (error) {
      if (this.logger) {
        this.logger.error('Error during shutdown', error.message);
      } else {
        console.error('Error during shutdown:', error.message);
      }
    } finally {
      if (this.forceExitTimer) {
        clearTimeout(this.forceExitTimer);
        this.forceExitTimer = null;
      }
      process.exit(exitCode);
    }
  }

  async monitoringLoop() {
    const statusIntervalMs = Math.max(1000, Number(this.config.runtimeStatusIntervalMs || 60000));
    while (this.running) {
      try {
        await this.sleep(statusIntervalMs);

        if (
          this.processSessionDeadlineAt
          && Date.now() >= this.processSessionDeadlineAt
          && !this.shutdownInProgress
        ) {
          this.logger.info('Process session deadline reached from monitoring loop; shutting down bot process');
          await this.shutdown('SESSION_DURATION_EXCEEDED');
          break;
        }

        if (!this.tradingEngine) {
          continue;
        }

        const stats = this.tradingEngine.getStats();
        this.statusLoopCount += 1;

        if (!this.shouldPrintDetailedStatus(stats)) {
          this.printCompactStatus(stats);
          if (!this.tradingEngine.active || stats.session.state === 'STOPPED') {
            this.logger.info('Trading session finished; exiting bot process');
            await this.shutdown('SESSION_CLOSED');
          }
          continue;
        }

        console.log('\nBot Status:');
        console.log(`   Mode: ${stats.mode}`);
        console.log(`   Session State: ${stats.session.state}`);
        console.log(`   Total Trades: ${stats.totalTrades}`);
        console.log(`   Rejected Trades: ${stats.rejectedTrades}`);
        console.log(`   Current Positions: ${stats.currentPositions}`);
        console.log(`   Daily PnL: ${stats.dailyPnL.toFixed(4)} SOL`);
        console.log(`   Realized PnL: ${stats.realizedPnL.toFixed(4)} SOL`);
        console.log(`   Unrealized PnL: ${stats.unrealizedPnL.toFixed(4)} SOL`);
        console.log(`   Hot Wallet: ${stats.hotWalletBalanceSol.toFixed(4)} SOL`);
        console.log(`   Cold Wallet: ${stats.coldWalletBalanceSol.toFixed(4)} SOL`);
        console.log(`   Paper Wallet: ${stats.paperWalletBalanceSol.toFixed(4)} SOL`);
        console.log(`   Available Capital: ${stats.availableHotWalletBalanceSol.toFixed(4)} SOL`);
        console.log(`   Reserved Capital: ${stats.reservedCapitalSol.toFixed(4)} SOL`);
        console.log(`   Total Equity: ${stats.totalEquitySol.toFixed(4)} SOL`);
        console.log(`   Telemetry Events: ${stats.telemetry.totalEvents}`);
        console.log(`   PumpPortal: ${stats.pumpPortal.messages} msgs | ${stats.pumpPortal.newTokens} new | ${stats.pumpPortal.trades} trades | ${stats.pumpPortal.migrations} migrations`);
        if (stats.pumpDev?.enabled) {
          const pumpDevLabel = stats.pumpDev.drivesPreMigration ? 'PumpDev Primary' : 'PumpDev Shadow';
          console.log(`   ${pumpDevLabel}: ${stats.pumpDev.messages} msgs | ${stats.pumpDev.newTokens} new | ${stats.pumpDev.trades} trades | ${stats.pumpDev.mintEvents} mintEvents | ${stats.pumpDev.pairUsdcEvents} USDC`);
        }
        if (stats.poolStateLane?.enabled) {
          console.log(`   Pool State: ${stats.poolStateLane.trackedMints} tracked | ${stats.poolStateLane.updates} updates | ${stats.poolStateLane.discoveries} discoveries`);
        }
        if (stats.pumpBondingCurveLane?.enabled) {
          console.log(`   Pump Curve: ${stats.pumpBondingCurveLane.trackedMints} tracked | ${stats.pumpBondingCurveLane.decoded} decoded | ${stats.pumpBondingCurveLane.missingAccounts} missing | ${stats.pumpBondingCurveLane.errors} errors | ${stats.pumpBondingCurveLane.rpcBatches || 0} rpc batches / ${stats.pumpBondingCurveLane.batchAccounts || 0} accounts`);
        }
        if (stats.preMigrationWatch?.enabled) {
          console.log(`   Pre-Migration Watch: ${stats.preMigrationWatch.trackedMints} tracked | ${stats.preMigrationWatch.observedSignals || 0} observed | ${stats.preMigrationWatch.confirmedFlags || 0} confirmed | ${stats.preMigrationWatch.flags} flags | ${stats.preMigrationWatch.migrations} migrations`);
          const recentFlags = stats.preMigrationWatch.recentFlags || [];
          if (recentFlags.length > 0) {
            console.log('   Recent Pre-Migration Flags:');
            recentFlags.slice(0, 3).forEach((flag) => {
              const label = flag.symbol || flag.name || flag.mint;
              const reasons = Array.isArray(flag.reasons) && flag.reasons.length > 0
                ? ` [${flag.reasons.join(',')}]`
                : '';
              console.log(`      ${label}: score=${Number(flag.score || 0).toFixed(1)} ${flag.mint}${reasons}`);
            });
          }
        }
        if (stats.preMigrationPaper?.enabled) {
          const paper = stats.preMigrationPaper;
          console.log(`   Pre-Migration Paper: ${paper.openPositions} open | ${paper.closedTrades} closed | wins=${paper.wins} losses=${paper.losses} | pnl=${Number(paper.totalPnlSol || 0).toFixed(4)} SOL`);
          const paperDecisions = Object.entries(paper.decisionCounts || {});
          if (paperDecisions.length > 0) {
            console.log('      decisions:', paperDecisions.map(([decision, count]) => `${decision}=${count}`).join(', '));
          }
          const paperSkips = Object.entries(paper.skipReasonCounts || {});
          if (paperSkips.length > 0) {
            console.log('      skips:', paperSkips.map(([reason, count]) => `${reason}=${count}`).join(', '));
          }
          const presets = Object.entries(paper.presets || {});
          presets.forEach(([name, preset]) => {
            console.log(`      ${name}: open=${preset.openPositions || 0} closed=${preset.closedTrades || 0} wins=${preset.wins || 0} losses=${preset.losses || 0} pnl=${Number(preset.totalPnlSol || 0).toFixed(4)} SOL`);
          });
        }
        if (stats.postMigrationContinuation?.enabled) {
          const continuation = stats.postMigrationContinuation;
          console.log(`   Post-Migration Continuation: ${continuation.trackedMints} tracked | watch=${continuation.watches || 0} confirmed=${continuation.confirmed || 0} rejected=${continuation.rejected || 0}`);
          const continuationRejects = Object.entries(continuation.rejectionCounts || {});
          if (continuationRejects.length > 0) {
            console.log('      continuation rejects:', continuationRejects.map(([reason, count]) => `${reason}=${count}`).join(', '));
          }
          const recentContinuation = continuation.recent || [];
          if (recentContinuation.length > 0) {
            const recent = recentContinuation.slice(0, 3).map((item) => {
              const label = item.symbol || item.mint;
              const reason = item.rejectReason ? `:${item.rejectReason}` : '';
              return `${label}=${item.eventType}${reason} score=${Number(item.score || 0).toFixed(1)}`;
            });
            console.log('      recent continuation:', recent.join(' | '));
          }
        }
        if (stats.candidateDossiers?.enabled) {
          const dossiers = stats.candidateDossiers;
          console.log(`   Candidate Dossiers: ${dossiers.totalDossiers || 0} total | watch=${dossiers.watchDossiers || 0} paper=${dossiers.paperDossiers || 0} continuation=${dossiers.continuationDossiers || 0}`);
          const dossierReasons = Object.entries(dossiers.reasonCounts || {});
          if (dossierReasons.length > 0) {
            console.log('      dossier reasons:', dossierReasons.map(([reason, count]) => `${reason}=${count}`).join(', '));
          }
          const recentDossiers = dossiers.recent || [];
          if (recentDossiers.length > 0) {
            const recent = recentDossiers.slice(-3).map((item) => {
              const label = item.symbol || item.mint;
              const reason = item.reason ? `:${item.reason}` : '';
              return `${label}=${item.verdict || item.eventType}${reason}`;
            });
            console.log('      recent dossiers:', recent.join(' | '));
          }
        }

        const rejectionReasons = Object.entries(stats.telemetry.rejectionCounts || {});
        if (rejectionReasons.length > 0) {
          console.log('   Rejections:', rejectionReasons.map(([reason, count]) => `${reason}=${count}`).join(', '));
        }

        const providerErrors = Object.entries(stats.telemetry.providerErrors || {});
        if (providerErrors.length > 0) {
          console.log('   Provider Errors:', providerErrors.map(([provider, count]) => `${provider}=${count}`).join(', '));
        }

        const quarantineSkips = stats.telemetry.counts?.['candidate.quarantine_skipped'] || 0;
        if (quarantineSkips > 0) {
          console.log(`   Quarantine Skips: ${quarantineSkips}`);
        }

        const pumpFailureCounts = Object.entries(stats.telemetry.pumpFailureCounts || {});
        if (pumpFailureCounts.length > 0) {
          console.log('   Pump Gate Failures:', pumpFailureCounts.map(([reason, count]) => `${reason}=${count}`).join(', '));
        }

        const eventFlowCounts = Object.entries(stats.eventFlow?.counts || {});
        if (eventFlowCounts.length > 0) {
          console.log('   Event Flow:', eventFlowCounts.map(([type, count]) => `${type}=${count}`).join(', '));
        }

        const recentFlowEvents = stats.eventFlow?.recentEvents || [];
        if (recentFlowEvents.length > 0) {
          console.log('   Recent Flow:');
          recentFlowEvents.slice(-5).forEach((event) => {
            const token = event.payload?.token ? ` ${event.payload.token}` : '';
            const reason = event.payload?.reason ? ` (${event.payload.reason})` : '';
            console.log(`      ${event.type}${token}${reason}`);
          });
        }

        const paperExits = Object.entries(stats.telemetry.paperExitCounts || {});
        if (paperExits.length > 0) {
          console.log('   Paper Exits:', paperExits.map(([reason, count]) => `${reason}=${count}`).join(', '));
        }

        const strategyEntries = stats.telemetry.strategyEntries || {};
        const strategyExits = stats.telemetry.strategyExits || {};
        const strategyPnl = stats.telemetry.strategyPnl || {};
        const strategyLabels = Array.from(
          new Set([
            ...Object.keys(strategyEntries),
            ...Object.keys(strategyExits),
            ...Object.keys(strategyPnl)
          ])
        );
        if (strategyLabels.length > 0) {
          console.log('   Strategy Buckets:');
          strategyLabels.forEach((strategy) => {
            const entries = strategyEntries[strategy] || 0;
            const exits = strategyExits[strategy] || 0;
            const pnl = Number(strategyPnl[strategy] || 0);
            console.log(`      ${strategy}: entries=${entries}, exits=${exits}, pnl=${pnl.toFixed(4)} SOL`);
          });
        }

        const momentumBucketsByReason = Object.entries(stats.telemetry.momentumBucketsByReason || {});
        if (momentumBucketsByReason.length > 0) {
          console.log('   Momentum Buckets:');
          momentumBucketsByReason.forEach(([reason, buckets]) => {
            const rendered = Object.entries(buckets).map(([bucket, count]) => `${bucket}=${count}`).join(', ');
            console.log(`      ${reason}: ${rendered}`);
          });
        }

        const pumpMomentumBucketsByFailureReason = Object.entries(
          stats.telemetry.pumpMomentumBucketsByFailureReason || {}
        );
        if (pumpMomentumBucketsByFailureReason.length > 0) {
          console.log('   Pump Failure Momentum Buckets:');
          pumpMomentumBucketsByFailureReason.forEach(([reason, buckets]) => {
            const rendered = Object.entries(buckets).map(([bucket, count]) => `${bucket}=${count}`).join(', ');
            console.log(`      ${reason}: ${rendered}`);
          });
        }

        const ledgerStrategies = Object.entries(stats.strategyLedger?.strategies || {});
        if (ledgerStrategies.length > 0) {
          console.log('   Strategy Scorecard:');
          ledgerStrategies
            .sort((a, b) => b[1].realizedPnlSol - a[1].realizedPnlSol)
            .forEach(([strategy, bucket]) => {
              console.log(`      ${strategy}: entries=${bucket.entries}, exits=${bucket.exits}, winRate=${(bucket.winRate * 100).toFixed(1)}%, pnl=${bucket.realizedPnlSol.toFixed(4)} SOL`);
            });
        }

        if (stats.positions.length > 0) {
          console.log('\nCurrent Positions:');
          stats.positions.forEach((pos) => {
            const pnl = pos.costBasisSol === 0 ? 0 : ((pos.marketValueSol - pos.costBasisSol) / pos.costBasisSol) * 100;
            const strategyTag = pos.aiPrimaryStrategy ? ` | ${pos.aiPrimaryStrategy}` : '';
            console.log(`   ${pos.token || pos.mint}: ${pnl.toFixed(2)}% | Value: ${pos.marketValueSol?.toFixed?.(4) ?? pos.entryValueSol?.toFixed?.(4) ?? '0.0000'} SOL${strategyTag}`);
          });
        }

        if (!this.tradingEngine.active || stats.session.state === 'STOPPED') {
          this.logger.info('Trading session finished; exiting bot process');
          await this.shutdown('SESSION_CLOSED');
        }
      } catch (error) {
        this.logger.error('Error in monitoring loop', error.message);
      }
    }
  }

  shouldPrintDetailedStatus(stats) {
    const every = Math.max(1, Number(this.config.runtimeStatusDetailEvery || 5));
    const previous = this.lastStatusSnapshot;
    const current = {
      totalTrades: Number(stats.totalTrades || 0),
      currentPositions: Number(stats.currentPositions || 0),
      rejectedTrades: Number(stats.rejectedTrades || 0),
      paperClosedTrades: Number(stats.preMigrationPaper?.closedTrades || 0),
      paperOpenPositions: Number(stats.preMigrationPaper?.openPositions || 0),
      paperDecisionCount: Object.values(stats.preMigrationPaper?.decisionCounts || {})
        .reduce((total, count) => total + Number(count || 0), 0),
      pumpDevMessages: Number(stats.pumpDev?.messages || 0),
      telemetryEvents: Number(stats.telemetry?.totalEvents || 0),
      sessionState: stats.session?.state || null
    };

    this.lastStatusSnapshot = current;

    if (!previous) return true;
    if (this.statusLoopCount % every === 0) return true;
    if (current.sessionState !== previous.sessionState) return true;
    if (current.totalTrades !== previous.totalTrades) return true;
    if (current.currentPositions !== previous.currentPositions) return true;
    if (current.paperClosedTrades !== previous.paperClosedTrades) return true;
    if (current.paperOpenPositions !== previous.paperOpenPositions) return true;
    return false;
  }

  printCompactStatus(stats) {
    const paper = stats.preMigrationPaper || {};
    const pumpDev = stats.pumpDev || {};
    const eventLoop = stats.eventLoopMonitor || stats.runtime?.eventLoopMonitor || {};
    const parts = [
      `mode=${stats.mode}`,
      `state=${stats.session?.state || 'n/a'}`,
      `telemetry=${stats.telemetry?.totalEvents ?? 'n/a'}`,
      `paper=${paper.openPositions || 0} open/${paper.closedTrades || 0} closed/${Number(paper.totalPnlSol || 0).toFixed(4)} SOL`,
      `pumpdev=${pumpDev.messages || 0} msgs`,
      `positions=${stats.currentPositions || 0}`
    ];
    if (eventLoop.lagEvents !== undefined) {
      parts.push(`lag=${eventLoop.lagEvents}/${eventLoop.maxLagMs || 0}ms`);
    }
    console.log(`\nBot Status: ${parts.join(' | ')}`);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

if (require.main === module) {
  const bot = new SolanaTradingBot();
  bot.start().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = SolanaTradingBot;
