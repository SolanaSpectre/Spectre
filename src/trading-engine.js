const { LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const MarketData = require('./market-data');
const AIAgent = require('./ai-agent');
const CapitalAllocation = require('./capital-allocation');
const WalletManager = require('./wallet');
const PumpPortalListener = require('./pumpportal-listener');
const PumpDevListener = require('./pumpdev-listener');
const SafetyGate = require('./lib/safety-gates');
const ExecutionModeManager = require('./lib/execution-modes');
const SessionManager = require('./lib/session-manager');
const AccountingService = require('./lib/accounting');
const TreasurySweeper = require('./lib/treasury-sweeper');
const Telemetry = require('./telemetry');
const QualityScorer = require('./lib/quality-scorer');
const StrategyLedger = require('./lib/strategy-ledger');
const WalletContext = require('./lib/wallet-context');
const TelegramContext = require('./lib/telegram-context');
const RickContext = require('./lib/rick-context');
const LaunchIntelStore = require('./lib/launch-intel-store');
const { assertLiveBroadcastAllowed } = require('./lib/live-broadcast-guard');
const PositionStore = require('./lib/position-store');
const TradingEventFlow = require('./lib/trading-event-flow');
const PoolStateLane = require('./lib/pool-state-lane');
const PreMigrationWatchLane = require('./lib/pre-migration-watch-lane');
const PreMigrationPaperLane = require('./lib/pre-migration-paper-lane');
const PumpBondingCurveLane = require('./lib/pump-bonding-curve-lane');
const CandidateDossierLedger = require('./lib/candidate-dossier-ledger');
const PostMigrationContinuationLane = require('./lib/post-migration-continuation-lane');
const WalletEventLedger = require('./lib/wallet-event-ledger');
const SolanaRpcRouter = require('./lib/solana-rpc-router');
const OutcomeLedger = require('./lib/outcome-ledger');
const FinalistAccountVerifier = require('./lib/finalist-account-verifier');
const LiveExecutionDryRunLane = require('./lib/live-execution-dry-run-lane');

const SENTINEL_BONDING_CURVE_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);

function validProviderBondingCurveAddress(value) {
  if (!value) return null;
  try {
    const parsed = new PublicKey(value).toBase58();
    return SENTINEL_BONDING_CURVE_ADDRESSES.has(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

class TradingEngine {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.connection = new SolanaRpcRouter(config, logger);
    this.marketData = new MarketData(config, logger);
    this.aiAgent = new AIAgent(config, logger);
    this.capitalAllocation = new CapitalAllocation(config, logger);
    this.hotWallet = new WalletManager(config.hotWalletPrivateKey);
    this.coldWalletAddress = config.coldWalletAddress;
    this.pumpPortalListener = new PumpPortalListener(config, logger, {
      onNewToken: async (event) => this.handlePumpPortalNewToken(event),
      onTrade: async (event) => this.handlePumpPortalTrade(event),
      onMigration: async (event) => this.handlePumpPortalMigration(event),
      onLifecycle: (type, payload) => {
        try {
          this.telemetry.record(type, payload);
        } catch {
          // Provider lifecycle telemetry is report-only and must not affect intake.
        }
      }
    });
    this.pumpDevListener = new PumpDevListener(config, logger, {
      onNewToken: async (event) => this.handlePumpDevNewToken(event),
      onTrade: async (event) => this.handlePumpDevTrade(event),
      onLifecycle: (type, payload) => {
        try {
          this.telemetry.record(type, payload);
        } catch {
          // Shadow provider lifecycle telemetry is report-only and must not affect intake.
        }
      },
      onShadowEvent: (type, payload) => {
        try {
          this.telemetry.record(type, payload);
        } catch {
          // PumpDev shadow events are observability-only and must never affect decisions.
        }
      }
    });

    this.safetyGate = new SafetyGate(config);
    this.executionModeManager = new ExecutionModeManager(config, logger);
    this.sessionManager = new SessionManager(config, logger);
    this.accounting = new AccountingService();
    this.treasurySweeper = new TreasurySweeper(config, logger);
    this.telemetry = new Telemetry(config, logger);
    this.connection.setTelemetryHook?.((type, payload) => {
      try {
        this.telemetry.record(type, payload);
      } catch {
        // RPC telemetry is observability-only and must never affect trading or RPC behavior.
      }
    });
    this.aiAgent.telemetryHook = (type, payload) => {
      try {
        this.telemetry.record(type, payload);
      } catch {
        // AI telemetry is observability-only and must never affect decisions.
      }
    };
    this.strategyLedger = new StrategyLedger(config, logger);
    this.qualityScorer = new QualityScorer(config);
    this.walletContext = new WalletContext(config, logger);
    this.telegramContext = new TelegramContext(config, logger);
    this.rickContext = new RickContext(config, logger);
    this.launchIntelStore = new LaunchIntelStore(config, logger);
    this.launchIntelShortlistWallets = this.loadLaunchIntelShortlistWallets();
    this.positionStore = new PositionStore(config, logger);
    this.eventFlow = new TradingEventFlow();
    this.poolStateLane = new PoolStateLane(config, logger);
    this.preMigrationWatchLane = new PreMigrationWatchLane(config, logger);
    this.preMigrationPaperLane = new PreMigrationPaperLane(config, logger);
    this.pumpBondingCurveLane = new PumpBondingCurveLane(config, logger, this.connection);
    this.finalistAccountVerifier = new FinalistAccountVerifier(config, logger, {
      connection: this.connection.getSubscriptionConnection?.(),
      accountReader: this.connection,
      decodeBondingCurveAccount: (data) => this.pumpBondingCurveLane.decodeBondingCurveAccount(data),
      deriveBondingCurveAddress: (mint) => this.pumpBondingCurveLane.safeDeriveBondingCurveAddress(mint),
      telemetryHook: (type, payload) => {
        try {
          this.telemetry.record(type, payload);
        } catch {
          // Finalist account stream verification is report-only.
        }
      }
    });
    this.liveExecutionDryRunLane = new LiveExecutionDryRunLane(config, logger, {
      connection: this.connection,
      accountReader: this.connection,
      decodeBondingCurveAccount: (data) => this.pumpBondingCurveLane.decodeBondingCurveAccount(data),
      deriveBondingCurveAddress: (mint) => this.pumpBondingCurveLane.safeDeriveBondingCurveAddress(mint),
      userPublicKey: this.hotWallet.getPublicKey(),
      signerKeypair: this.hotWallet.getKeypair(),
      telemetryHook: (type, payload) => {
        try {
          this.telemetry.record(type, payload);
        } catch {
          // Live execution dry-run telemetry is report-only.
        }
      }
    });
    this.candidateDossierLedger = new CandidateDossierLedger(config, logger);
    this.postMigrationContinuationLane = new PostMigrationContinuationLane(config, logger);
    this.walletEventLedger = new WalletEventLedger(config, logger);
    this.outcomeLedger = new OutcomeLedger(config, logger);

    this.currentPositions = new Map();
    this.paperPositions = new Map();
    this.rejectedTrades = [];
    this.latestPumpPortalTokens = new Map();
    this.pendingPumpBondingCurveSyncs = new Set();
    this.queuedPumpBondingCurveSyncs = new Map();
    this.pumpBondingCurveQueueTimer = null;
    this.pumpDevTargetedCurveParityLastSampleAt = new Map();
    this.pumpDevTargetedCurveParityInFlight = new Set();
    this.pumpDevTargetedCurveParitySkipLogLastAt = new Map();
    this.pumpDevTargetedCurveParitySampleCount = 0;
    this.tokenSignalCooldowns = new Map();
    this.preMigrationPaperRechecks = new Map();
    this.preMigrationPaperExpiredRechecks = new Set();
    this.preMigrationObservedTelemetryLastByMint = new Map();
    this.syntheticBondingCurveMigrations = new Set();
    this.lastTelegramSightingSyncAt = null;
    this.preMigrationDecisionLogWindowStartedAt = 0;
    this.preMigrationDecisionLogCount = 0;
    this.eventLoopMonitorTimer = null;
    this.eventLoopMonitorExpectedAt = 0;
    this.eventLoopMonitorStats = {
      samples: 0,
      lagEvents: 0,
      maxLagMs: 0,
      lastLagMs: 0,
      startedAt: null
    };
    this.pumpDevPrimarySilenceTimer = null;
    this.pumpDevPrimarySilenceStartedAt = null;
    this.pumpDevPrimarySilenceTripped = false;
    this.walletPromotionReviewLastLoadedAt = 0;
    this.walletPromotionReviewLastMtimeMs = 0;
    this.walletPromotionReviewByAddress = new Map();
    this.walletPromotionReviewByName = new Map();
    this.walletRelaxedShadowEnterSeen = new Set();
    this.walletRelaxedShadowSkipSeen = new Set();
    this.curveFalseNegativeShadowWatchSeen = new Set();
    this.curveFalseNegativeShadowSkipSeen = new Set();
    this.curveConfirmationShadowPending = new Map();
    this.curveConfirmationShadowEnterSeen = new Set();
    this.curveConfirmationShadowSkipSeen = new Set();
    this.freshCurveOverrideShadowSeen = new Set();

    this.dailyPnL = 0;
    this.realizedPnL = 0;
    this.unrealizedPnL = 0;
    this.totalTrades = 0;
    this.active = false;
    this.liveTradingHalted = false;

    this.hotWalletBalanceSol = 0;
    this.coldWalletBalanceSol = 0;
    this.paperWalletBalanceSol = config.paperStartingBalanceSol;
    this.openPositionValueSol = 0;
    this.totalEquitySol = 0;
    this.initialTotalEquitySol = null;
    this.entryStartTime = null;
    this.sessionId = null;
    this.filterRejectSnapshotCount = 0;
    this.lastCapitalBalanceLookupAt = 0;
    this.sessionTimeout = null;
    this.stopInProgress = false;
  }

  loadLaunchIntelShortlistWallets() {
    const fallbackPath = path.join(process.cwd(), 'data', 'reports', 'wallet-launch-intel-stability-latest.json');
    const filePath = this.config.walletLaunchIntelStabilityReportFilePath || fallbackPath;
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return null;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
      const rows = Array.isArray(parsed.repeatShortlistCandidates) ? parsed.repeatShortlistCandidates : [];
      const wallets = new Map();
      for (const row of rows) {
        if (!row?.wallet) continue;
        wallets.set(row.wallet, {
          wallet: row.wallet,
          classification: row.classification || 'REPEAT_SHORTLIST_CANDIDATE',
          score: Number.isFinite(Number(row.score)) ? Number(row.score) : null,
          runCount: Number.isFinite(Number(row.runCount)) ? Number(row.runCount) : null,
          decisionRunCount: Number.isFinite(Number(row.decisionRunCount)) ? Number(row.decisionRunCount) : null,
          noTrackedFirstTouchLinks: Number.isFinite(Number(row.noTrackedFirstTouchLinks)) ? Number(row.noTrackedFirstTouchLinks) : null
        });
      }
      this.logger.info('Loaded launch-intel shortlist wallets for runtime shadow', {
        filePath,
        wallets: wallets.size
      });
      return wallets;
    } catch (error) {
      this.logger.warn('Failed to load launch-intel shortlist wallet report', {
        filePath,
        errorMessage: error.message
      });
      return null;
    }
  }

  applySignalCooldown(mintAddress, cooldownMs) {
    if (!mintAddress || !Number.isFinite(cooldownMs) || cooldownMs <= 0) {
      return;
    }

    const expiresAt = Date.now() + cooldownMs;
    const existingExpiresAt = this.tokenSignalCooldowns.get(mintAddress) || 0;
    if (expiresAt > existingExpiresAt) {
      this.tokenSignalCooldowns.set(mintAddress, expiresAt);
    }
  }

  async initialize() {
    this.logger.info('Initializing trading engine...');
    this.config.validate();

    const version = await this.connection.getVersion();
    const rpcStatus = this.connection.getStatus();
    this.logger.success(`Connected to Solana RPC: ${version['solana-core']}`, {
      primaryHttpEndpoint: rpcStatus.primary.httpUrl,
      primaryWsEndpoint: rpcStatus.primary.wsUrl,
      fallbackHttpEndpoint: rpcStatus.fallback?.httpUrl || null,
      fallbackWsEndpoint: rpcStatus.fallback?.wsUrl || null
    });
    this.restorePersistedLivePositions();
    await this.reconcilePersistedLivePositions();
    await this.refreshCapitalState();
    if (this.shouldRunTelegramBootstrapSightings()) {
      this.syncTelegramSightings({ bootstrap: true });
    } else {
      this.lastTelegramSightingSyncAt = this.getDefaultTelegramRecurringSinceMs();
      this.logger.info(`Skipping Telegram bootstrap sightings import for ${this.executionModeManager.mode} mode`);
    }

    this.logger.info(`Execution mode: ${this.executionModeManager.mode}`);
    return true;
  }

  restorePersistedLivePositions() {
    const restoredPositions = this.positionStore.load();
    if (!Array.isArray(restoredPositions) || restoredPositions.length === 0) {
      return;
    }

    for (const position of restoredPositions) {
      this.currentPositions.set(position.token, {
        ...position,
        restoredAt: new Date().toISOString()
      });
    }

    this.logger.warn(`Restored ${restoredPositions.length} persisted live position(s) from disk`);
    this.telemetry.record('positions.restored', {
      count: restoredPositions.length,
      tokens: restoredPositions.map((position) => position.token)
    });
  }

  async reconcilePersistedLivePositions() {
    if (this.currentPositions.size === 0) {
      return;
    }

    try {
      const tokenAccounts = await WalletManager.getOwnedTokenAccounts(
        this.connection,
        this.hotWallet.getPublicKey()
      );

      const heldByMint = new Map(
        tokenAccounts
          .filter((account) => account.mint && Number(account.uiAmount || 0) > 0)
          .map((account) => [account.mint, account])
      );

      const missingPersisted = [];
      for (const [mint] of Array.from(this.currentPositions.entries())) {
        if (!heldByMint.has(mint)) {
          this.currentPositions.delete(mint);
          missingPersisted.push(mint);
        }
      }

      const orphanOnChain = Array.from(heldByMint.keys())
        .filter((mint) => !this.currentPositions.has(mint));

      if (missingPersisted.length > 0 || orphanOnChain.length > 0) {
        this.telemetry.record('positions.reconciled', {
          removedPersistedPositions: missingPersisted,
          orphanOnChainPositions: orphanOnChain
        });
      }

      if (missingPersisted.length > 0) {
        this.logger.warn('Removed persisted live positions missing on-chain', {
          count: missingPersisted.length,
          tokens: missingPersisted
        });
        this.persistLivePositions();
      }

      if (orphanOnChain.length > 0) {
        this.logger.warn('Detected on-chain token holdings missing from persisted live positions', {
          count: orphanOnChain.length,
          tokens: orphanOnChain
        });
      }
    } catch (error) {
      this.logger.warn('Failed to reconcile persisted live positions', error.message);
      this.telemetry.record('provider.error', {
        provider: 'position_reconciliation',
        message: error.message
      });
    }
  }

  persistLivePositions() {
    this.positionStore.save(Array.from(this.currentPositions.values()));
  }

  async start() {
    if (!this.config.aiEnabled) {
      this.logger.warn(`AI review disabled - unsupported AI provider: ${this.config.aiProvider}`);
    } else {
      this.logger.info(`AI review enabled via Ollama model ${this.config.ollamaModel}`);
      await this.aiAgent.warmup();
    }

    this.sessionManager.start();
    const sessionStartTime = Date.now();
    this.sessionId = `session_${sessionStartTime}`;
    this.active = true;
    this.telemetry.record('session.started', {
      mode: this.executionModeManager.mode,
      sessionDurationMinutes: this.config.sessionDurationMinutes,
      entryWarmupMs: this.getEffectiveEntryWarmupMs()
    });
    this.strategyLedger.record('session.started', {
      sessionId: this.sessionId,
      mode: this.executionModeManager.mode,
      sessionDurationMinutes: this.config.sessionDurationMinutes,
      initialEquitySol: this.totalEquitySol
    });
    this.startEventLoopMonitor();
    this.armSessionTimeout();
    this.logger.info('Starting trading engine...');
    await this.pumpPortalListener.start();
    await this.pumpDevListener.start();
    this.armPumpDevPrimarySilenceWatchdog(sessionStartTime);
    this.entryStartTime = Date.now();
    this.tradingLoop();
  }

  armSessionTimeout() {
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }

    const durationMinutes = Number(this.config.sessionDurationMinutes || 0);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return;
    }

    const timeoutMs = Math.max(1, durationMinutes * 60 * 1000);
    this.sessionTimeout = setTimeout(() => {
      if (!this.active || this.stopInProgress) {
        return;
      }

      this.logger.info('Session duration reached; stopping trading engine');
      this.telemetry.record('session.stop_requested', {
        reason: 'SESSION_DURATION_EXCEEDED',
        sessionId: this.sessionId,
        sessionDurationMinutes: durationMinutes
      });
      this.stop('SESSION_DURATION_EXCEEDED').catch((error) => {
        this.logger.error('Failed to stop trading engine after session timeout', error.message);
      });
    }, timeoutMs);

    if (typeof this.sessionTimeout.unref === 'function') {
      this.sessionTimeout.unref();
    }
  }

  async stop(reason = 'STOPPED') {
    if (this.stopInProgress) {
      return;
    }

    if (!this.active && this.sessionManager.getStatus?.().state === 'STOPPED') {
      return;
    }

    this.stopInProgress = true;
    this.active = false;
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    if (this.pumpBondingCurveQueueTimer) {
      clearTimeout(this.pumpBondingCurveQueueTimer);
      this.pumpBondingCurveQueueTimer = null;
    }
    this.clearPumpDevPrimarySilenceWatchdog();
    this.stopEventLoopMonitor(reason);
    this.queuedPumpBondingCurveSyncs.clear();
    this.finalistAccountVerifier?.stop?.('SESSION_STOP');
    this.connection?.clearQueue?.('SESSION_STOP');
    this.clearPreMigrationPaperRechecks('SESSION_STOP');

    this.telemetry.record('session.stopping', {
      reason,
      sessionId: this.sessionId,
      stats: this.getStats()
    });

    this.recordPreMigrationPaperEvents(this.preMigrationPaperLane.closeAll('SESSION_END'));
    if (this.executionModeManager.isPaper() && this.config.paperCloseOnSessionEnd) {
      this.closeAllPaperPositions('SESSION_END');
      await this.refreshCapitalState();
    }

    await Promise.all([
      this.pumpPortalListener.stop(),
      this.pumpDevListener.stop()
    ]);
    this.persistLivePositions();
    this.launchIntelStore.flush(true);
    this.sessionManager.stop(reason);
    this.telemetry.record('session.stopped', {
      reason,
      stats: this.getStats()
    });
    await this.telemetry.flushAsync?.();
    this.strategyLedger.record('session.stopped', {
      sessionId: this.sessionId,
      reason,
      stats: {
        totalTrades: this.totalTrades,
        rejectedTrades: this.rejectedTrades.length,
        realizedPnL: this.realizedPnL,
        totalEquitySol: this.totalEquitySol
      }
    });
    await Promise.all([
      this.candidateDossierLedger?.flushAsync?.(),
      this.outcomeLedger?.flushAsync?.(),
      this.walletEventLedger?.flushAsync?.(),
      this.launchIntelStore?.flushAsync?.(),
      this.strategyLedger?.flushAsync?.()
    ]);
    this.logger.info('Stopping trading engine...');
    this.stopInProgress = false;
  }

  armPumpDevPrimarySilenceWatchdog(startedAt = Date.now()) {
    this.clearPumpDevPrimarySilenceWatchdog();
    this.pumpDevPrimarySilenceStartedAt = startedAt;
    this.pumpDevPrimarySilenceTripped = false;

    if (
      !this.config.pumpDevPrimarySilenceFailFastEnabled
      || !this.config.pumpDevDrivesPreMigration
    ) {
      return;
    }

    const timeoutMs = Number(this.config.pumpDevPrimarySilenceTimeoutMs || 0);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return;
    }

    this.pumpDevPrimarySilenceTimer = setTimeout(() => {
      this.checkPumpDevPrimarySilenceTimeout('timeout');
    }, timeoutMs);
    if (typeof this.pumpDevPrimarySilenceTimer.unref === 'function') {
      this.pumpDevPrimarySilenceTimer.unref();
    }
  }

  clearPumpDevPrimarySilenceWatchdog() {
    if (this.pumpDevPrimarySilenceTimer) {
      clearTimeout(this.pumpDevPrimarySilenceTimer);
      this.pumpDevPrimarySilenceTimer = null;
    }
  }

  getPumpDevMarketEventCount(stats = {}) {
    return Number(stats.newTokens || 0)
      + Number(stats.trades || 0)
      + Number(stats.mintEvents || 0)
      + Number(stats.migrations || 0);
  }

  checkPumpDevPrimarySilenceTimeout(trigger = 'timeout') {
    if (!this.active || this.stopInProgress || this.pumpDevPrimarySilenceTripped) {
      return;
    }

    const stats = this.pumpDevListener.getStats();
    const marketEvents = this.getPumpDevMarketEventCount(stats);
    if (marketEvents > 0) {
      return;
    }

    const payload = {
      reason: 'PUMPDEV_PRIMARY_SILENT',
      trigger,
      sessionId: this.sessionId,
      timeoutMs: Number(this.config.pumpDevPrimarySilenceTimeoutMs || 0),
      elapsedMs: this.pumpDevPrimarySilenceStartedAt ? Date.now() - this.pumpDevPrimarySilenceStartedAt : null,
      messages: Number(stats.messages || 0),
      systemMessages: Number(stats.systemMessages || 0),
      newTokens: Number(stats.newTokens || 0),
      trades: Number(stats.trades || 0),
      mintEvents: Number(stats.mintEvents || 0),
      migrations: Number(stats.migrations || 0),
      closes: Number(stats.closeEvents || 0),
      errors: Number(stats.errorEvents || 0),
      connected: Boolean(stats.connected),
      lastMessageAgeMs: stats.lastMessageAt ? Date.now() - Number(stats.lastMessageAt) : null
    };
    this.pumpDevPrimarySilenceTripped = true;
    this.logger.warn('PumpDev primary feed produced no market events before silence timeout; stopping session early', payload);
    this.telemetry.record('provider.pumpdev.primary_silence_timeout', payload);
    this.stop('PUMPDEV_PRIMARY_SILENT').catch((error) => {
      this.logger.error('Failed to stop after PumpDev primary silence timeout', error.message);
    });
  }

  async tradingLoop() {
    while (this.active) {
      try {
        if (this.maybeStopExpiredSession('trading_loop')) {
          break;
        }

        await this.executeTradingCycle();
        await this.sleep(this.config.refreshIntervalMs);
      } catch (error) {
        this.eventFlow.failCycle(error, {
          sessionId: this.sessionId,
          mode: this.executionModeManager.mode
        });
        this.logger.error('Error in trading loop', error.message);
        await this.sleep(5000);
      }
    }
  }

  async executeTradingCycle() {
    const cycleId = this.eventFlow.startCycle({
      sessionId: this.sessionId,
      mode: this.executionModeManager.mode
    });

    this.resetCandidateSnapshotCounter();
    this.syncTelegramSightings();
    await this.updatePositions();
    this.checkPreMigrationPaperPositions();
    await this.refreshCapitalState();

    if (this.isEntryWarmupActive()) {
      this.telemetry.record('cycle.completed', {
        analyzedTokens: 0,
        signals: 0,
        skippedEntries: true,
        skipReason: 'ENTRY_WARMUP',
        warmupRemainingMs: this.getEntryWarmupRemainingMs()
      });
      this.eventFlow.completeCycle({
        skippedEntries: true,
        skipReason: 'ENTRY_WARMUP',
        analyzedTokens: 0,
        signals: 0
      });
      await this.checkRiskManagement();
      return;
    }

    if (!this.hasEntryCapacity()) {
      this.telemetry.record('cycle.completed', {
        skippedEntries: true,
        skipReason: 'ENTRY_CAPACITY_FULL',
        currentPositions: this.currentPositions.size + this.paperPositions.size
      });
      this.eventFlow.completeCycle({
        skippedEntries: true,
        skipReason: 'ENTRY_CAPACITY_FULL',
        currentPositions: this.currentPositions.size + this.paperPositions.size
      });
      await this.checkRiskManagement();
      return;
    }

    const marketData = await this.fetchMarketData();
    this.eventFlow.record('cycle.market_data_fetched', {
      cycleId,
      sourceCounts: marketData.sourceCounts
    });
    const tokenAnalysis = await this.analyzeTokens(marketData);
    this.eventFlow.record('cycle.tokens_analyzed', {
      cycleId,
      analyzedTokens: tokenAnalysis.length
    });
    const tradeSignals = this.generateDeterministicSignals(tokenAnalysis);
    this.eventFlow.record('cycle.signals_generated', {
      cycleId,
      signals: tradeSignals.length
    });
    this.telemetry.record('cycle.completed', {
      sourceCounts: marketData.sourceCounts,
      analyzedTokens: tokenAnalysis.length,
      signals: tradeSignals.length
    });

    for (const signal of tradeSignals) {
      try {
        await this.processSignal(signal);
      } catch (error) {
        this.telemetry.record('trade.rejected', {
          signalId: signal.id,
          token: signal.token,
          reason: 'SIGNAL_PROCESSING_ERROR',
          message: error.message
        });
        this.logger.warn(`Signal processing failed for ${signal.token}`, error.message);
        this.eventFlow.record('signal.processing_error', {
          signalId: signal.id,
          token: signal.token,
          message: error.message
        });
      }
    }

    this.eventFlow.completeCycle({
      analyzedTokens: tokenAnalysis.length,
      signals: tradeSignals.length,
      sourceCounts: marketData.sourceCounts
    });
    await this.refreshCapitalState();
    await this.checkRiskManagement();
  }

  checkPreMigrationPaperPositions() {
    if (!this.preMigrationPaperLane?.checkOpenPositionTimeouts) {
      return;
    }

    this.recordPreMigrationPaperEvents(
      this.preMigrationPaperLane.checkOpenPositionTimeouts(new Date().toISOString())
    );
  }

  async processSignal(signal) {
    this.eventFlow.record('signal.received', {
      signalId: signal.id,
      token: signal.token,
      source: signal.tokenInfo?.source || 'unknown',
      qualityScore: signal.qualityScore ?? null,
      momentumScore: signal.momentumScore ?? null,
      rankScore: signal.rankScore ?? null
    });

    this.logger.decision(`CANDIDATE: ${signal.token}`, {
      source: signal.tokenInfo?.source || 'unknown',
      qualityScore: signal.qualityScore,
      momentumScore: signal.momentumScore,
      amountSol: Number(signal.amount?.toFixed?.(4) || signal.amount || 0)
    });

    if (!this.sessionManager.isTradeAllowed()) {
      return this.rejectTrade(signal, 'SESSION_NOT_ACTIVE');
    }

    if (this.executionModeManager.isLive() && this.liveTradingHalted) {
      return this.rejectTrade(signal, 'LIVE_TRADING_HALTED');
    }

    const safetyCheck = await this.safetyGate.validateToken(signal.tokenInfo);
    if (!safetyCheck.passed) {
      this.emitCandidateSnapshot({
        signal,
        tokenInfo: signal.tokenInfo,
        rejectionReason: safetyCheck.reason,
        rejectionStage: 'safety_gate',
        snapshotTier: 'filter_reject',
        qualityScore: signal.qualityScore ?? null,
        qualityFactors: signal.qualityFactors ?? null,
        momentumScore: signal.momentumScore ?? null,
        momentumFactors: signal.momentumFactors ?? null,
        rankScore: signal.rankScore ?? null
      });
      return this.rejectTrade(signal, safetyCheck.reason);
    }
    this.eventFlow.record('signal.safety_passed', {
      signalId: signal.id,
      token: signal.token
    });

    if (this.executionModeManager.isPaper() && this.paperPositions.size >= this.config.maxOpenPaperPositions) {
      return this.rejectTrade(signal, 'MAX_OPEN_PAPER_POSITIONS');
    }

    if (this.executionModeManager.isLive() && this.currentPositions.size >= this.config.maxOpenLivePositions) {
      return this.rejectTrade(signal, 'MAX_OPEN_LIVE_POSITIONS');
    }

    if (this.executionModeManager.isLive() && !this.config.liveExitEngineEnabled) {
      return this.rejectTrade(signal, 'LIVE_EXIT_ENGINE_DISABLED');
    }

    const quote = await this.marketData.getQuoteWithStalenessCheck(
      this.config.baseTokenMint,
      signal.token,
      String(Math.round(signal.amount * LAMPORTS_PER_SOL)),
      this.hotWallet.getAddress()
    );

    const staleness = this.marketData.isQuoteStale(quote);
    if (staleness.stale) {
      this.telemetry.record('quote.stale', {
        signalId: signal.id,
        token: signal.token,
        reason: staleness.reason,
        ageMs: staleness.ageMs
      });
      this.emitCandidateSnapshot({
        signal,
        tokenInfo: signal.tokenInfo,
        rejectionReason: `QUOTE_STALE:${staleness.reason}`,
        rejectionStage: 'quote_staleness',
        snapshotTier: 'filter_reject',
        qualityScore: signal.qualityScore ?? null,
        qualityFactors: signal.qualityFactors ?? null,
        momentumScore: signal.momentumScore ?? null,
        momentumFactors: signal.momentumFactors ?? null,
        rankScore: signal.rankScore ?? null,
        extra: {
          quoteAgeMs: staleness.ageMs,
          quoteStaleReason: staleness.reason
        }
      });
      return this.rejectTrade(signal, `QUOTE_STALE:${staleness.reason}`);
    }

    const quoteQuality = this.validateQuoteQuality(quote);
    if (!quoteQuality.passed) {
      this.telemetry.record('trade.rejected', {
        signalId: signal.id,
        token: signal.token,
        reason: quoteQuality.reason,
        priceImpactPct: quoteQuality.priceImpactPct
      });
      this.emitCandidateSnapshot({
        signal,
        tokenInfo: signal.tokenInfo,
        rejectionReason: quoteQuality.reason,
        rejectionStage: 'quote_quality',
        snapshotTier: 'filter_reject',
        qualityScore: signal.qualityScore ?? null,
        qualityFactors: signal.qualityFactors ?? null,
        momentumScore: signal.momentumScore ?? null,
        momentumFactors: signal.momentumFactors ?? null,
        rankScore: signal.rankScore ?? null,
        extra: {
          priceImpactPct: quoteQuality.priceImpactPct ?? null
        }
      });
      return this.rejectTrade(signal, quoteQuality.reason);
    }
    this.eventFlow.record('signal.quote_passed', {
      signalId: signal.id,
      token: signal.token
    });

    const aiReview = this.config.aiEnabled
      ? await this.aiAgent.reviewTrade(signal.tokenInfo, signal)
      : this.buildAiBypassReview();

    const aiDecision = this.resolveAiDecision(aiReview, signal);
    this.eventFlow.record('signal.ai_decision', {
      signalId: signal.id,
      token: signal.token,
      action: aiDecision.action,
      reason: aiDecision.reason || null,
      confidence: aiDecision.confidence ?? null,
      primaryStrategy: aiDecision.primaryStrategy || null
    });

    this.logger.decision(`AI ${aiDecision.action}: ${signal.token}`, {
      strategy: aiDecision.primaryStrategy,
      convergenceScore: aiDecision.convergenceScore,
      confidence: aiDecision.confidence,
      reason: aiDecision.reason
    });

    if (aiDecision.action === 'REJECT') {
      this.telemetry.record('ai.veto', {
        signalId: signal.id,
        token: signal.token,
        reason: aiDecision.reason,
        confidence: aiDecision.confidence,
        primaryStrategy: aiDecision.primaryStrategy,
        convergenceScore: aiDecision.convergenceScore,
        strategyScores: aiDecision.strategyScores,
        simpleRuntime: aiDecision.simpleRuntime || null,
        timeout: aiDecision.timeout === true
      });
      this.emitCandidateSnapshot({
        signal,
        tokenInfo: signal.tokenInfo,
        rejectionReason: aiDecision.reason || 'AI_REJECT',
        rejectionStage: 'ai_review',
        snapshotTier: 'ai_review',
        qualityScore: signal.qualityScore ?? null,
        qualityFactors: signal.qualityFactors ?? null,
        momentumScore: signal.momentumScore ?? null,
        momentumFactors: signal.momentumFactors ?? null,
        rankScore: signal.rankScore ?? null,
        aiReview: aiDecision
      });
      return this.rejectTrade(signal, aiDecision.reason || 'AI_REJECT');
    }

    if (aiDecision.action === 'WATCH') {
      this.telemetry.record('ai.caution', {
        signalId: signal.id,
        token: signal.token,
        reason: aiDecision.reason,
        confidence: aiDecision.confidence,
        primaryStrategy: aiDecision.primaryStrategy,
        convergenceScore: aiDecision.convergenceScore,
        strategyScores: aiDecision.strategyScores,
        simpleRuntime: aiDecision.simpleRuntime || null,
        timeout: aiDecision.timeout === true
      });
      this.emitCandidateSnapshot({
        signal,
        tokenInfo: signal.tokenInfo,
        rejectionReason: aiDecision.reason || 'AI_WATCH',
        rejectionStage: 'ai_review',
        snapshotTier: 'ai_review',
        qualityScore: signal.qualityScore ?? null,
        qualityFactors: signal.qualityFactors ?? null,
        momentumScore: signal.momentumScore ?? null,
        momentumFactors: signal.momentumFactors ?? null,
        rankScore: signal.rankScore ?? null,
        aiReview: aiDecision
      });
      return this.rejectTrade(signal, aiDecision.reason || 'AI_WATCH');
    }

    const executionResult = await this.executionModeManager.executeTrade({
      signal,
      quote,
      connection: this.connection,
      marketData: this.marketData,
      wallet: this.hotWallet,
      liveExecutor: ({ signal: liveSignal, quote: liveQuote }) => this.executeBuyLive(liveSignal, liveQuote, aiDecision),
      paperExecutor: ({ signal: paperSignal, quote: paperQuote }) => this.executeBuyPaper(paperSignal, paperQuote, aiDecision)
    });

    if (executionResult.success) {
      const executedAtMs = Date.now();
      const signalAgeMs = Number.isFinite(Number(signal.generatedAtMs))
        ? Math.max(0, executedAtMs - Number(signal.generatedAtMs))
        : null;
      this.totalTrades += 1;
      this.eventFlow.record('signal.executed', {
        signalId: signal.id,
        token: signal.token,
        mode: executionResult.mode,
        strategy: aiDecision.primaryStrategy || null
      });
      this.telemetry.record('trade.executed', {
        signalId: signal.id,
        token: signal.token,
        mode: executionResult.mode,
        amountSol: signal.amount,
        signalGeneratedAt: signal.generatedAt || null,
        executedAt: new Date(executedAtMs).toISOString(),
        signalAgeMs,
        signalAgeSeconds: Number.isFinite(signalAgeMs) ? Number((signalAgeMs / 1000).toFixed(3)) : null,
        qualityScore: signal.qualityScore,
        aiConfidence: aiDecision.confidence,
        aiPrimaryStrategy: aiDecision.primaryStrategy,
        aiConvergenceScore: aiDecision.convergenceScore,
        aiAction: aiDecision.action,
        aiExecutionProfile: aiDecision.executionProfile
      });
      this.strategyLedger.record('trade.entry', {
        sessionId: this.sessionId,
        signalId: signal.id,
        token: signal.token,
        mode: executionResult.mode,
        amountSol: signal.amount,
        signalAgeMs,
        qualityScore: signal.qualityScore,
        momentumScore: signal.momentumScore,
        strategy: aiDecision.primaryStrategy,
        convergenceScore: aiDecision.convergenceScore,
        aiConfidence: aiDecision.confidence,
        executionProfile: aiDecision.executionProfile,
        source: signal.tokenInfo?.source || signal.source || 'unknown'
      });

      if (this.executionModeManager.isLive()) {
        await this.refreshCapitalState();
        await this.treasurySweeper.checkAndSweep(
          this.connection,
          this.hotWallet,
          this.hotWalletBalanceSol
        );
      }
    }

    return executionResult;
  }

  resetCandidateSnapshotCounter() {
    this.filterRejectSnapshotCount = 0;
  }

  shouldEmitFilterRejectSnapshot() {
    const maxPerCycle = 5;
    if (this.filterRejectSnapshotCount >= maxPerCycle) {
      return false;
    }
    this.filterRejectSnapshotCount += 1;
    return true;
  }

  emitCandidateSnapshot({
    signal,
    tokenInfo,
    rejectionReason,
    rejectionStage,
    snapshotTier = 'filter_reject',
    qualityScore = null,
    qualityFactors = null,
    momentumScore = null,
    momentumFactors = null,
    rankScore = null,
    aiReview = null,
    extra = null
  }) {
    if (snapshotTier !== 'ai_review' && !this.shouldEmitFilterRejectSnapshot()) {
      return;
    }

    const source = tokenInfo?.source || signal?.tokenInfo?.source || signal?.source || 'unknown';
    const sessionStartTime = this.entryStartTime
      ? new Date(this.entryStartTime).toISOString()
      : null;
    const payload = {
      snapshotTier,
      signalId: signal?.id || signal?.signalId || null,
      mint: signal?.token || signal?.mint || tokenInfo?.mintAddress || null,
      source,
      evaluationTimestamp: new Date().toISOString(),
      tokenInfo: {
        symbol: tokenInfo?.symbol || null,
        name: tokenInfo?.name || null,
        ageSeconds: tokenInfo?.ageSeconds ?? null,
        isMigration: Boolean(tokenInfo?.isMigration),
        poolAddress: tokenInfo?.poolAddress || tokenInfo?.address || null,
        dex: source
      },
      qualityScore,
      qualityFactors,
      momentumScore,
      momentumFactors,
      rankScore,
      rejectionReason,
      rejectionStage,
      aiReview: aiReview
        ? {
            decision: aiReview.decision || aiReview.action || null,
            action: aiReview.action || null,
            confidence: aiReview.confidence ?? null,
            primaryStrategy: aiReview.primaryStrategy || null,
            convergenceScore: aiReview.convergenceScore ?? null,
            strategyScores: aiReview.strategyScores || null,
            executionProfile: aiReview.executionProfile || null,
            simpleRuntime: aiReview.simpleRuntime || null,
            timeout: aiReview.timeout === true
          }
        : null,
      marketContext: {
        sessionId: this.sessionId,
        sessionStartTime,
        openPositions: this.currentPositions.size + this.paperPositions.size,
        hotBalanceSol: this.hotWalletBalanceSol,
        paperBalanceSol: this.paperWalletBalanceSol,
        totalEquitySol: this.totalEquitySol
      }
    };

    if (extra && typeof extra === 'object') {
      payload.extra = extra;
    }

    this.telemetry.record('candidate.snapshot', payload);
  }

  startEventLoopMonitor() {
    if (this.eventLoopMonitorTimer || this.config.eventLoopMonitorEnabled === false) {
      return;
    }

    const intervalMs = Math.max(100, Number(this.config.eventLoopMonitorIntervalMs || 1000));
    const lagThresholdMs = Math.max(1, Number(this.config.eventLoopMonitorLagThresholdMs || 250));
    const startedAt = Date.now();
    this.eventLoopMonitorStats = {
      samples: 0,
      lagEvents: 0,
      maxLagMs: 0,
      lastLagMs: 0,
      startedAt: new Date(startedAt).toISOString(),
      intervalMs,
      lagThresholdMs
    };
    this.eventLoopMonitorExpectedAt = startedAt + intervalMs;
    this.eventLoopMonitorTimer = setInterval(() => {
      const now = Date.now();
      const lagMs = Math.max(0, now - this.eventLoopMonitorExpectedAt);
      this.eventLoopMonitorExpectedAt = now + intervalMs;
      this.eventLoopMonitorStats.samples += 1;
      this.eventLoopMonitorStats.lastLagMs = lagMs;
      if (lagMs > this.eventLoopMonitorStats.maxLagMs) {
        this.eventLoopMonitorStats.maxLagMs = lagMs;
      }
      if (lagMs >= lagThresholdMs) {
        this.eventLoopMonitorStats.lagEvents += 1;
        this.telemetry.record('runtime.event_loop_lag', {
          lagMs,
          thresholdMs: lagThresholdMs,
          intervalMs,
          sample: this.eventLoopMonitorStats.samples
        });
      }
    }, intervalMs);
    if (typeof this.eventLoopMonitorTimer.unref === 'function') {
      this.eventLoopMonitorTimer.unref();
    }
  }

  stopEventLoopMonitor(reason = 'STOPPED') {
    if (!this.eventLoopMonitorTimer) {
      return;
    }
    clearInterval(this.eventLoopMonitorTimer);
    this.eventLoopMonitorTimer = null;
    this.telemetry.record('runtime.event_loop_monitor_summary', {
      ...this.eventLoopMonitorStats,
      reason,
      stoppedAt: new Date().toISOString()
    });
  }

  emitRaydiumRunnerShadowObservation({ token, quality, momentum, rankScore }) {
    if (
      !this.config.runnerRaydiumShadowEnabled ||
      !this.executionModeManager.isPaper() ||
      !this.config.paperRunnerModeEnabled ||
      this.isPumpPortalToken(token)
    ) {
      return;
    }

    const mint = token?.mintAddress;
    const poolState = this.poolStateLane?.getMintSummary(mint) || null;
    const bestPool = poolState?.bestPool || null;
    const continuationState = this.postMigrationContinuationLane?.states?.get(mint) || null;
    const continuationSummary = continuationState
      ? this.postMigrationContinuationLane.toSummary(continuationState)
      : null;

    const poolAge = this.derivePoolAgeHours(token?.openTime || bestPool?.openTime);

    this.telemetry.record('runner.raydium_shadow.observed', {
      mode: 'report_only',
      blocked: true,
      reason: 'RUNNER_MODE_REQUIRES_PUMP_MOMENTUM',
      token: mint,
      symbol: token?.symbol || poolState?.symbol || continuationSummary?.symbol || null,
      name: token?.name || poolState?.name || continuationSummary?.name || null,
      source: token?.source || 'unknown',
      poolAddress: token?.poolAddress || token?.address || bestPool?.poolAddress || null,
      poolType: token?.type || bestPool?.poolType || null,
      executionMode: this.executionModeManager.mode,
      paperRunnerModeEnabled: this.config.paperRunnerModeEnabled,
      qualityScore: quality?.score ?? null,
      qualityFactors: quality?.factors || null,
      momentumScore: momentum?.score ?? null,
      momentumFactors: momentum?.factors || null,
      rankScore: Number(Number(rankScore || 0).toFixed(4)),
      riskScore: token?.riskScore ?? null,
      liquidityUsd: token?.liquidityUsd ?? poolState?.bestLiquidityUsd ?? null,
      volume24h: token?.volume24h ?? poolState?.bestVolume24h ?? null,
      price: token?.price ?? bestPool?.price ?? null,
      feeRate: token?.feeRate ?? bestPool?.feeRate ?? null,
      openTime: token?.openTime || bestPool?.openTime || null,
      poolAgeHours: poolAge,
      poolAgeKnown: poolAge !== null,
      poolCount: poolState?.poolCount ?? null,
      poolState,
      continuation: continuationSummary
        ? {
            score: continuationSummary.score ?? null,
            verdict: continuationSummary.lastEventType || continuationSummary.verdict || null,
            rejectReason: continuationSummary.rejectReason || null,
            reasons: continuationSummary.reasons || null
          }
        : null,
      wouldPassQualityRisk: Number(quality?.score || 0) >= Number(this.config.minQualityScore || 0)
        && Number(token?.riskScore || 0) < 0.7
    });
  }

  derivePoolAgeHours(openTime) {
    const numeric = Number(openTime || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return null;
    }
    const openMs = numeric > 1e12 ? numeric : numeric * 1000;
    const ageHours = (Date.now() - openMs) / (60 * 60 * 1000);
    return Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null;
  }

  validateQuoteQuality(quote) {
    const outputAmount = Number(
      quote?.outAmount ||
      quote?.outputAmount ||
      quote?.totalOutputAmount ||
      quote?.outAmountWithSlippage ||
      0
    );

    if (!Number.isFinite(outputAmount) || outputAmount <= 0) {
      return { passed: false, reason: 'QUOTE_NO_OUTPUT' };
    }

    const rawPriceImpact = quote?.priceImpactPct ?? quote?.priceImpact ?? quote?.routePlan?.priceImpactPct;
    if (rawPriceImpact !== undefined && rawPriceImpact !== null) {
      const priceImpactPct = Number(rawPriceImpact);
      if (Number.isFinite(priceImpactPct) && priceImpactPct > this.config.maxPriceImpact) {
        return {
          passed: false,
          reason: 'QUOTE_PRICE_IMPACT_TOO_HIGH',
          priceImpactPct
        };
      }
    }

    return { passed: true };
  }

  buildAiBypassReview() {
    return {
      approved: true,
      confidence: 100,
      reason: 'AI_DISABLED',
      primaryStrategy: 'SNIPER',
      convergenceScore: 1,
      action: 'ENTER',
      strategyScores: {
        RUNNER_HUNTER: 0,
        SNIPER: 1,
        SCALPER: 0,
        MIGRATION_HUNTER: 0,
        WALLET_FLOW: 0
      },
      contradictions: [],
      executionProfile: {
        entryUrgency: 'medium',
        expectedHold: 'short',
        exitStyle: 'fixed'
      }
    };
  }

  buildEmptyStrategyScores() {
    return {
      RUNNER_HUNTER: 0,
      SNIPER: 0,
      SCALPER: 0,
      MIGRATION_HUNTER: 0,
      WALLET_FLOW: 0
    };
  }

  resolveAiDecision(aiReview = {}, signal = null) {
    const fallbackAction = aiReview.approved === false ? 'REJECT' : 'ENTER';
    const action = ['ENTER', 'WATCH', 'REJECT'].includes(aiReview.action)
      ? aiReview.action
      : fallbackAction;

    if (action === 'REJECT' && !this.config.aiRequiredForTrade && aiReview.reason === 'AI_DISABLED') {
      return {
        ...aiReview,
        action: 'ENTER'
      };
    }

    const normalizedDecision = {
      ...aiReview,
      action,
      confidence: Number(aiReview.confidence || 0),
      primaryStrategy: aiReview.primaryStrategy || 'SNIPER',
      convergenceScore: Number(aiReview.convergenceScore || 0),
      strategyScores: aiReview.strategyScores || {},
      executionProfile: aiReview.executionProfile || null
    };

    return this.applyAiDecisionGuards(normalizedDecision, signal);
  }

  applyAiDecisionGuards(aiDecision = {}, signal = null) {
    if (!signal?.tokenInfo) {
      return aiDecision;
    }

    const reason = String(aiDecision.reason || '').toLowerCase();
    const liquidityUsd = Number(signal.tokenInfo.liquidityUsd || 0);
    const minLiquidityUsd = Number(this.config.minLiquidityUsd || 0);
    const qualityScore = Number(signal.qualityScore || signal.tokenInfo.qualityScore || 0);
    const momentumScore = Number(signal.momentumScore || signal.tokenInfo.momentumScore || 0);
    const aboveFloorLiquidity =
      Number.isFinite(liquidityUsd) &&
      Number.isFinite(minLiquidityUsd) &&
      liquidityUsd >= minLiquidityUsd &&
      minLiquidityUsd > 0;
    const noClearLane = reason.includes('no clear lane');
    const weakBuyRatio = reason.includes('weak buy ratio');
    const marginalQualityFloor = Math.max(Number(this.config.minQualityScore || 0) + 0.02, 0.45);
    const strongQualityFloor = Math.max(Number(this.config.minQualityScore || 0) + 0.03, 0.46);
    const strongMomentumFloor = Math.max(Number(this.config.minPumpMomentumScore || 0) + 0.10, 0.8);
    const structuralRiskTerms = [
      'dump',
      'migration',
      'holder',
      'deployer',
      'dev',
      'distribution',
      'unlock',
      'sell pressure'
    ];
    const hasStructuralRisk = structuralRiskTerms.some((term) => reason.includes(term));
    const pureLiquidityCaution =
      reason.includes('liquidity') &&
      !noClearLane &&
      !weakBuyRatio &&
      !hasStructuralRisk;
    const deterministicStrength =
      qualityScore >= strongQualityFloor &&
      momentumScore >= strongMomentumFloor;
    const manualParseFallback = reason.includes('manual_parse_fallback');
    const aiReviewFailure =
      reason.includes('ai_review_failed') ||
      reason.includes('ai_review_timeout') ||
      reason.includes('ollama_timeout') ||
      reason.includes('simple_runtime_ai_timeout') ||
      aiDecision.timeout === true;

    if (aiReviewFailure && this.config.aiTimeoutFallbackEnabled) {
      const paperFallbackAllowed =
        !this.config.aiTimeoutFallbackPaperOnly ||
        this.executionModeManager.isPaper();
      const fallbackQualityFloor = Number(this.config.aiTimeoutFallbackMinQualityScore || strongQualityFloor);
      const fallbackMomentumFloor = Number(this.config.aiTimeoutFallbackMinMomentumScore || strongMomentumFloor);
      const fallbackDeterministicStrength =
        aboveFloorLiquidity &&
        qualityScore >= fallbackQualityFloor &&
        momentumScore >= fallbackMomentumFloor;

      if (paperFallbackAllowed && fallbackDeterministicStrength) {
        this.logger.warn(`AI timeout fallback allowed deterministic PAPER entry for ${signal.token}`, {
          liquidityUsd,
          minLiquidityUsd,
          qualityScore,
          momentumScore,
          fallbackQualityFloor,
          fallbackMomentumFloor,
          reason: aiDecision.reason
        });

        return {
          ...aiDecision,
          approved: true,
          action: 'ENTER',
          confidence: Math.max(Number(aiDecision.confidence || 0), 38),
          reason: `AI_TIMEOUT_FALLBACK_ALLOW:${aiDecision.reason || 'AI_REVIEW_TIMEOUT'}`,
          primaryStrategy: signal.tokenInfo?.source?.startsWith?.('pumpportal')
            ? 'RUNNER_HUNTER'
            : (aiDecision.primaryStrategy || 'SNIPER'),
          convergenceScore: Math.max(Number(aiDecision.convergenceScore || 0), 0.35),
          strategyScores: {
            ...this.buildEmptyStrategyScores(),
            ...(aiDecision.strategyScores || {}),
            RUNNER_HUNTER: Math.max(Number(aiDecision.strategyScores?.RUNNER_HUNTER || 0), momentumScore),
            SCALPER: Math.max(Number(aiDecision.strategyScores?.SCALPER || 0), qualityScore)
          },
          contradictions: Array.from(new Set([
            ...(Array.isArray(aiDecision.contradictions) ? aiDecision.contradictions : []),
            'AI timed out; deterministic PAPER fallback allowed because quality, momentum, liquidity, safety, and quote gates already passed'
          ]))
        };
      }

      const fallbackReason = paperFallbackAllowed
        ? 'AI_TIMEOUT_FALLBACK_REJECT:DETERMINISTIC_STRENGTH_BELOW_FLOOR'
        : 'AI_TIMEOUT_FALLBACK_REJECT:NOT_PAPER_MODE';

      return {
        ...aiDecision,
        approved: false,
        action: 'REJECT',
        confidence: Math.min(Number(aiDecision.confidence || 0), 20),
        reason: `${fallbackReason}:${aiDecision.reason || 'AI_REVIEW_TIMEOUT'}`,
        contradictions: Array.from(new Set([
          ...(Array.isArray(aiDecision.contradictions) ? aiDecision.contradictions : []),
          'AI timeout fallback rejected because deterministic fallback conditions were not met'
        ]))
      };
    }

    if (
      aiDecision.action === 'WATCH' &&
      manualParseFallback &&
      aboveFloorLiquidity &&
      deterministicStrength
    ) {
      this.logger.warn(`AI manual fallback upgraded to ENTER for ${signal.token}`, {
        liquidityUsd,
        minLiquidityUsd,
        qualityScore,
        momentumScore,
        reason: aiDecision.reason
      });

      return {
        ...aiDecision,
        approved: true,
        action: 'ENTER',
        confidence: Math.max(30, Math.min(Number(aiDecision.confidence || 0), 45)),
        reason: `AI_MANUAL_FALLBACK_OVERRIDDEN:${aiDecision.reason || 'manual parse fallback'}`,
        contradictions: Array.from(new Set([
          ...(Array.isArray(aiDecision.contradictions) ? aiDecision.contradictions : []),
          'Manual parse fallback overridden because deterministic strength remained strong above the floor'
        ]))
      };
    }

    if (
      aiDecision.action === 'WATCH' &&
      aboveFloorLiquidity &&
      pureLiquidityCaution &&
      deterministicStrength
    ) {
      this.logger.warn(`AI liquidity caution upgraded to ENTER for ${signal.token}`, {
        liquidityUsd,
        minLiquidityUsd,
        qualityScore,
        momentumScore,
        reason: aiDecision.reason
      });

      return {
        ...aiDecision,
        approved: true,
        action: 'ENTER',
        confidence: Math.max(35, Math.min(Number(aiDecision.confidence || 0), 55)),
        reason: `AI_LIQUIDITY_CAUTION_OVERRIDDEN:${aiDecision.reason || 'liquidity caution'}`,
        contradictions: Array.from(new Set([
          ...(Array.isArray(aiDecision.contradictions) ? aiDecision.contradictions : []),
          'Liquidity caution overridden because deterministic strength remained strong above the floor'
        ]))
      };
    }

    if (
      aiDecision.action === 'REJECT' &&
      aboveFloorLiquidity &&
      reason.includes('liquidity')
    ) {
      if (noClearLane || (weakBuyRatio && qualityScore < marginalQualityFloor)) {
        this.logger.warn(`AI liquidity veto downgraded to WATCH for ${signal.token}`, {
          liquidityUsd,
          minLiquidityUsd,
          qualityScore,
          reason: aiDecision.reason
        });

        return {
          ...aiDecision,
          action: 'WATCH',
          approved: false,
          confidence: Math.min(Number(aiDecision.confidence || 0), 35),
          reason: `AI_CAUTION_LIQUIDITY_ABOVE_FLOOR:${aiDecision.reason || 'liquidity caution'}`,
          contradictions: Array.from(new Set([
            ...(Array.isArray(aiDecision.contradictions) ? aiDecision.contradictions : []),
            'Liquidity caution held as watch because lane conviction was weak'
          ]))
        };
      }

      this.logger.warn(`AI liquidity veto held as WATCH for ${signal.token}`, {
        liquidityUsd,
        minLiquidityUsd,
        reason: aiDecision.reason
      });

      return {
        ...aiDecision,
        action: 'WATCH',
        approved: false,
        confidence: Math.min(Number(aiDecision.confidence || 0), 45),
        reason: `AI_CAUTION_LIQUIDITY_ABOVE_FLOOR:${aiDecision.reason || 'liquidity caution'}`,
        contradictions: Array.from(new Set([
          ...(Array.isArray(aiDecision.contradictions) ? aiDecision.contradictions : []),
          'Liquidity caution held as watch because deterministic floor already passed'
        ]))
      };
    }

    return aiDecision;
  }

  async fetchMarketData() {
    const suppressOptionalHttp = this.shouldSuppressOptionalHttpEnrichment();
    if (suppressOptionalHttp) {
      const solPriceFallback = this.marketData.getCachedSolanaPrice(
        Math.max(this.config.solPriceCacheTtlMs * 10, 300000)
      );
      const solPrice = Number(solPriceFallback?.value || 0);
      const pumpPortalTokens = Array.from(this.latestPumpPortalTokens.values())
        .map((token) => {
          const momentum = this.summarizePumpPortalMomentum(token);
          const liquiditySol = Number(token.liquiditySol || 0);
          const liquidityUsd = Number(
            token.liquidityUsd
            || (liquiditySol > 0 && solPrice > 0 ? liquiditySol * solPrice : 0)
          );
          return {
            id: token.mint,
            source: token.source || 'pumpdev',
            type: token.migratedAt ? 'migration' : 'launch',
            mintAddress: token.mint,
            symbol: token.symbol,
            name: token.name,
            liquidity: liquiditySol,
            liquidityUsd,
            volume24h: token.volumeSol || 0,
            marketCap: token.marketCapSol || token.marketCap || 0,
            bondingStage: token.bondingStage,
            buys: token.buys || 0,
            sells: token.sells || 0,
            tradeCount: token.tradeCount || 0,
            accountTradeCount: token.accountTradeCount || 0,
            openTime: token.createdAt,
            preMigrationState: this.preMigrationWatchLane.getMintSummary(token.mint),
            ...momentum,
            raw: token
          };
        });

      const prioritizedPools = this.prioritizePools(this.dedupeAndFilterPools(pumpPortalTokens));
      this.telemetry.record('optional_http_enrichment.suppressed', {
        reason: 'PAPER_PUMPDEV_PRIMARY',
        skippedProviders: ['sol_price', 'raydium_pools', 'meteora_pools', 'moonshot_tokens', 'dexscreener_continuation'],
        cachedSolPriceAgeMs: solPriceFallback?.ageMs ?? null,
        pumpPortalTokens: pumpPortalTokens.length
      });

      return {
        solPrice,
        pools: prioritizedPools,
        sourceCounts: {
          raydium: 0,
          meteora: 0,
          moonshot: 0,
          pumpportal: pumpPortalTokens.length,
          poolStateUpdates: 0,
          continuationObserved: 0,
          continuationEmitted: 0,
          optionalHttpSuppressed: true
        },
        timestamp: new Date().toISOString(),
        sentiment: this.calculateMarketSentiment(pumpPortalTokens),
        maxPositionSize: this.config.maxPositionSizeSol,
        stopLossPercent: this.config.stopLossPercent,
        takeProfitPercent: this.config.takeProfitPercent,
        maxDailyLoss: this.config.maxDailyLossSol
      };
    }

    const [solPriceResult, raydiumResult, meteoraResult, moonshotResult] = await Promise.allSettled([
      this.marketData.getSolanaPrice(),
      this.marketData.getRaydiumPools(),
      this.marketData.getMeteoraPools(),
      this.marketData.getMoonshotTokens()
    ]);

    const solPriceFallback = this.marketData.getCachedSolanaPrice(
      Math.max(this.config.solPriceCacheTtlMs * 10, 300000)
    );
    const solPrice = solPriceResult.status === 'fulfilled'
      ? Number(solPriceResult.value || 0)
      : Number(solPriceFallback?.value || 0);
    const raydiumPools = raydiumResult.status === 'fulfilled' ? raydiumResult.value : [];
    const meteoraPools = meteoraResult.status === 'fulfilled' ? meteoraResult.value : [];
    const moonshotTokens = moonshotResult.status === 'fulfilled' ? moonshotResult.value : [];

    if (solPriceResult.status !== 'fulfilled') {
      this.telemetry.record('provider.error', {
        provider: 'sol_price',
        message: solPriceResult.reason?.message || String(solPriceResult.reason || 'unknown error'),
        usedCachedValue: Boolean(solPriceFallback),
        fallbackAgeMs: solPriceFallback?.ageMs ?? null
      });
      this.logger.warn(
        solPriceFallback
          ? `Using cached SOL price after fetch failure (${solPriceFallback.ageMs}ms old)`
          : 'SOL price fetch failed with no cached fallback'
      );
    }

    if (raydiumResult.status !== 'fulfilled') {
      this.telemetry.record('provider.error', {
        provider: 'raydium_pools',
        message: raydiumResult.reason?.message || String(raydiumResult.reason || 'unknown error')
      });
    }

    if (meteoraResult.status !== 'fulfilled') {
      this.telemetry.record('provider.error', {
        provider: 'meteora_pools',
        message: meteoraResult.reason?.message || String(meteoraResult.reason || 'unknown error')
      });
    }

    if (moonshotResult.status !== 'fulfilled') {
      this.telemetry.record('provider.error', {
        provider: 'moonshot_tokens',
        message: moonshotResult.reason?.message || String(moonshotResult.reason || 'unknown error')
      });
    }

    const poolStateUpdate = this.syncPoolStateLane([
      ...raydiumPools,
      ...meteoraPools
    ]);

    const pumpPortalTokens = Array.from(this.latestPumpPortalTokens.values())
      .map((token) => {
        const momentum = this.summarizePumpPortalMomentum(token);
        const liquiditySol = Number(token.liquiditySol || 0);
        const liquidityUsd = Number(
          token.liquidityUsd
          || (liquiditySol > 0 && solPrice > 0 ? liquiditySol * solPrice : 0)
        );
        return {
          id: token.mint,
          source: token.source || 'pumpportal',
          type: token.migratedAt ? 'migration' : 'launch',
          mintAddress: token.mint,
          symbol: token.symbol,
          name: token.name,
          liquidity: liquiditySol,
          liquidityUsd,
          volume24h: token.volumeSol || 0,
          marketCap: token.marketCapSol || token.marketCap || 0,
          bondingStage: token.bondingStage,
          buys: token.buys || 0,
          sells: token.sells || 0,
          tradeCount: token.tradeCount || 0,
          accountTradeCount: token.accountTradeCount || 0,
          openTime: token.createdAt,
          preMigrationState: this.preMigrationWatchLane.getMintSummary(token.mint),
          ...momentum,
          raw: token
        };
      });

    const pools = [
      ...raydiumPools,
      ...meteoraPools,
      ...moonshotTokens,
      ...pumpPortalTokens
    ];
    const prioritizedPools = this.prioritizePools(this.dedupeAndFilterPools(pools));
    const continuationUpdate = await this.observePostMigrationContinuationCandidates(prioritizedPools);

    return {
      solPrice,
      pools: prioritizedPools,
      sourceCounts: {
        raydium: raydiumPools.length,
        meteora: meteoraPools.length,
        moonshot: moonshotTokens.length,
        pumpportal: pumpPortalTokens.length,
        poolStateUpdates: poolStateUpdate.updated,
        continuationObserved: continuationUpdate.observed,
        continuationEmitted: continuationUpdate.emitted
      },
      timestamp: new Date().toISOString(),
      sentiment: this.calculateMarketSentiment(pools),
      maxPositionSize: this.config.maxPositionSizeSol,
      stopLossPercent: this.config.stopLossPercent,
      takeProfitPercent: this.config.takeProfitPercent,
      maxDailyLoss: this.config.maxDailyLossSol
    };
  }

  syncPoolStateLane(protocolPools = []) {
    const result = this.poolStateLane.ingestPools(protocolPools);
    if (!result.updated) {
      return result;
    }

    for (const state of result.states || []) {
      const summary = this.launchIntelStore.registerPoolState(state);
      const current = this.latestPumpPortalTokens.get(state.mintAddress);
      if (current) {
        current.poolStateSummary = this.poolStateLane.getMintSummary(state.mintAddress);
        current.launchIntelSummary = summary || current.launchIntelSummary;
        this.latestPumpPortalTokens.set(state.mintAddress, current);
      }
    }

    this.eventFlow.record('cycle.pool_state_updated', {
      observed: result.observed,
      updated: result.updated,
      discovered: result.discovered
    });
    this.telemetry.record('pool_state.updated', {
      observed: result.observed,
      updated: result.updated,
      discovered: result.discovered
    });

    return result;
  }

  async observePostMigrationContinuationCandidates(pools = []) {
    if (!this.postMigrationContinuationLane?.enabled) {
      return { observed: 0, emitted: 0 };
    }

    const maxFetches = Number(this.config.postMigrationContinuationMaxDexScreenerFetchesPerCycle || 0);
    if (maxFetches <= 0) {
      return { observed: 0, emitted: 0 };
    }

    const candidates = pools
      .filter((pool) => this.isPostMigrationContinuationCandidate(pool))
      .slice(0, maxFetches);

    let observed = 0;
    let emitted = 0;

    for (const pool of candidates) {
      const mint = pool.mintAddress;
      try {
        const pairs = await this.marketData.getDexScreenerTokenPairs(mint);
        if (!pairs.length) {
          continue;
        }

        const contextToken = {
          mintAddress: mint,
          symbol: pool.symbol,
          name: pool.name
        };
        const result = this.postMigrationContinuationLane.observe({
          mint,
          mintAddress: mint,
          symbol: pool.symbol,
          name: pool.name,
          pairs,
          primaryPair: pairs[0],
          telegramSummary: this.telegramContext.getTokenSummary(contextToken),
          rickContextSummary: this.rickContext.getTokenSummary(contextToken),
          launchIntelSummary: this.launchIntelStore.getMintSummary(mint)
        });

        if (!result.updated) {
          continue;
        }

        observed += 1;
        if (result.shouldEmit) {
          emitted += 1;
          this.telemetry.record(`post_migration_continuation.${result.eventType.replace('continuation.', '')}`, {
            mint,
            symbol: result.state.symbol,
            score: result.state.score,
            rejectReason: result.state.rejectReason,
            liquidityUsd: result.state.liquidityUsd,
            volumeToLiquidity24h: result.state.volumeToLiquidity24h,
            volume1hUsd: result.state.volume1hUsd,
            priceChange6hPct: result.state.priceChange6hPct,
            pairCount: result.state.pairCount,
            dexCount: result.state.dexCount
          });
          this.candidateDossierLedger.recordContinuationState(result.state, {
            eventType: result.eventType
          });
          this.outcomeLedger.recordContinuationState(result.state, {
            eventType: result.eventType,
            sessionId: this.sessionId
          });
          this.eventFlow.record(result.eventType, {
            token: mint,
            score: result.state.score,
            reason: result.state.rejectReason
          });
        }
      } catch (error) {
        this.telemetry.record('provider.error', {
          provider: 'post-migration-continuation',
          token: mint,
          message: error.message
        });
        this.logger.warn(`Continuation observer failed for ${mint}`, error.message);
      }
    }

    return { observed, emitted };
  }

  isPostMigrationContinuationCandidate(pool = {}) {
    if (!pool.mintAddress) {
      return false;
    }

    if (String(pool.source || '').startsWith('pumpportal') && pool.type !== 'migration') {
      return false;
    }

    const liquidityUsd = Number(pool.liquidityUsd || pool.liquidity || 0);
    const volume24h = Number(pool.volume24h || pool.volume || 0);
    const marketCap = Number(pool.marketCap || pool.fdv || 0);

    return (
      liquidityUsd >= Math.max(this.config.postMigrationContinuationMinLiquidityUsd * 0.5, 5000) ||
      volume24h >= this.config.postMigrationContinuationMinVolume1hUsd ||
      marketCap >= 100000
    );
  }

  calculateMarketSentiment(pools) {
    const totalLiquidity = pools.reduce((sum, pool) => sum + (pool.liquidity || 0), 0);
    const totalVolume = pools.reduce((sum, pool) => sum + (pool.volume24h || 0), 0);

    if (totalVolume > totalLiquidity * 0.1) return 'bullish';
    if (totalVolume < totalLiquidity * 0.01) return 'bearish';
    return 'neutral';
  }

  async analyzeTokens(marketData) {
    const tokens = [];
    let birdeyeEnrichedThisCycle = 0;
    const suppressOptionalHttp = this.shouldSuppressOptionalHttpEnrichment();
    const topPools = marketData.pools
      .filter((pool) => {
        if (pool.source?.startsWith?.('pumpportal')) {
          return (pool.tradeCount || 0) > 0 || pool.type === 'migration';
        }

        return (pool.volume24h || 0) > this.config.volumeThresholdSol;
      })
      .filter((pool) => {
        if (pool.source?.startsWith?.('pumpportal')) {
          return true;
        }

        return (pool.liquidityUsd || pool.liquidity || 0) > this.config.liquidityThresholdSol;
      })
      .slice(0, 10);

    for (const pool of topPools) {
      try {
        let analysis = suppressOptionalHttp
          ? {
              mintAddress: pool.mintAddress,
              source: pool.source || 'pumpdev',
              price: 0,
              priceUsd: 0,
              liquidity: pool.liquidity || 0,
              liquidityUsd: pool.liquidityUsd || 0,
              volume: pool.volume24h || pool.volume || 0,
              marketCap: pool.marketCap || pool.fdv || 0,
              riskScore: 0
            }
          : await this.marketData.analyzeToken(pool.mintAddress);
        analysis = {
          ...analysis,
          source: pool.source || 'raydium',
          symbol: pool.symbol,
          name: pool.name,
          liquidity: analysis.liquidity || pool.liquidity || 0,
          liquidityUsd: analysis.liquidityUsd || pool.liquidityUsd || 0,
          volume: analysis.volume || pool.volume24h || 0,
          marketCap: analysis.marketCap || pool.marketCap || 0,
          buys: pool.buys,
          sells: pool.sells,
          recentBuys: pool.recentBuys,
          recentSells: pool.recentSells,
          recentTradeCount: pool.recentTradeCount,
          recentVolumeSol: pool.recentVolumeSol,
          tradeVelocityPerMin: pool.tradeVelocityPerMin,
          tokenAgeSeconds: pool.tokenAgeSeconds,
          bondingStage: pool.bondingStage,
          tradeCount: pool.tradeCount,
          accountTradeCount: pool.accountTradeCount,
          routeType: pool.type,
          rawPool: pool
        };

        if (
          !suppressOptionalHttp &&
          this.config.birdeyeEnabled &&
          birdeyeEnrichedThisCycle < this.config.birdeyeMaxTokensPerCycle
        ) {
          analysis = await this.marketData.enrichWithBirdeye(analysis);
          birdeyeEnrichedThisCycle += 1;
        }

        analysis.walletFlowSummary = this.walletContext.getMintSummary(analysis.mintAddress);
        analysis.telegramSummary = this.telegramContext.getTokenSummary(analysis);
        analysis.narrativeSummary = analysis.telegramSummary;
        analysis.rickContextSummary = this.rickContext.getTokenSummary(analysis);
        analysis.poolStateSummary = this.poolStateLane.getMintSummary(analysis.mintAddress);
        analysis.preMigrationState = this.preMigrationWatchLane.getMintSummary(analysis.mintAddress);
        analysis.launchIntelSummary = this.launchIntelStore.getMintSummary(analysis.mintAddress);

        tokens.push(analysis);
      } catch (error) {
        this.telemetry.record('provider.error', {
          provider: 'token-analysis',
          token: pool.mintAddress,
          message: error.message
        });
        this.logger.warn(`Failed to analyze token ${pool.mintAddress}`, error.message);
      }
    }

    return tokens;
  }

  shouldSuppressOptionalHttpEnrichment() {
    return Boolean(
      this.config.paperSuppressOptionalHttpEnrichment
      && this.executionModeManager?.isPaper?.()
      && this.config.pumpDevDrivesPreMigration
    );
  }

  dedupeAndFilterPools(pools) {
    const byMint = new Map();
    const excludedSymbols = new Set(this.config.excludedTokenSymbols);
    const excludedMints = new Set(this.config.excludedTokenMints);

    for (const pool of pools) {
      const mint = pool.mintAddress;
      const symbol = String(pool.symbol || '').trim().toUpperCase();

      if (!mint || excludedMints.has(mint) || excludedSymbols.has(symbol)) {
        continue;
      }

      const current = byMint.get(mint);
      const currentScore = (current?.volume24h || 0) + (current?.liquidityUsd || current?.liquidity || 0);
      const nextScore = (pool.volume24h || 0) + (pool.liquidityUsd || pool.liquidity || 0);

      if (!current || nextScore > currentScore) {
        byMint.set(mint, pool);
      }
    }

    return Array.from(byMint.values());
  }

  prioritizePools(pools) {
    return [...pools].sort((a, b) => {
      const aScore = this.getPoolPriorityScore(a);
      const bScore = this.getPoolPriorityScore(b);
      return bScore - aScore;
    });
  }

  getPoolPriorityScore(pool) {
    let score = 0;
    if (String(pool.source || '').startsWith('pumpportal')) score += 2_000_000;
    if (pool.type === 'migration' || pool.bondingStage === 'recently_bonded') score += 500_000;
    if (pool.bondingStage === 'almost_bonded') score += 250_000;
    score += Number(pool.tradeVelocityPerMin || 0) * 50_000;
    score += Number(pool.recentBuys || 0) * 10_000;
    score -= Number(pool.recentSells || 0) * 5_000;
    score += Number(pool.recentVolumeSol || 0) * 25_000;
    score += Number(pool.tradeCount || 0) * 5_000;
    score += Number(pool.buys || 0) * 2_000;
    score -= Number(pool.sells || 0) * 1_000;
    score += Number(pool.volume24h || 0) * 10;
    score += Number(pool.liquidityUsd || pool.liquidity || 0) * 0.1;
    return score;
  }

  isTokenOnSignalCooldown(mintAddress) {
    const expiresAt = this.tokenSignalCooldowns.get(mintAddress);
    if (!expiresAt) {
      return false;
    }

    if (Date.now() >= expiresAt) {
      this.tokenSignalCooldowns.delete(mintAddress);
      return false;
    }

    return true;
  }

  generateDeterministicSignals(tokenAnalysis) {
    const signals = [];
    const availableCapitalSol = this.getAvailableTradingCapitalSol();
    const entrySlots = this.getOpenEntrySlots();

    if (entrySlots <= 0) {
      return signals;
    }

    const rankedTokens = tokenAnalysis
      .map((token) => ({
        token,
        quality: this.qualityScorer.score(token),
        momentum: this.scoreMomentum(token)
      }))
      .map(({ token, quality, momentum }) => ({
        token,
        quality,
        momentum,
        rankScore: quality.score + (momentum.score * this.config.pumpMomentumWeight)
      }))
      .sort((a, b) => b.rankScore - a.rankScore);

    for (const { token, quality, momentum, rankScore } of rankedTokens) {
      if (this.currentPositions.has(token.mintAddress) || this.paperPositions.has(token.mintAddress)) {
        continue;
      }

      if (this.isTokenOnSignalCooldown(token.mintAddress)) {
        this.telemetry.record('candidate.quarantine_skipped', {
          token: token.mintAddress,
          source: token.source
        });
        continue;
      }

      if (
        this.executionModeManager.isPaper() &&
        this.config.paperRunnerModeEnabled &&
        !this.isPumpPortalToken(token)
      ) {
        this.emitRaydiumRunnerShadowObservation({
          token,
          quality,
          momentum,
          rankScore
        });
        this.applySignalCooldown(
          token.mintAddress,
          Math.max(this.config.tokenSignalCooldownMs, this.config.rejectionQuarantineMs)
        );
        this.telemetry.record('trade.rejected', {
          token: token.mintAddress,
          reason: 'RUNNER_MODE_REQUIRES_PUMP_MOMENTUM',
          source: token.source,
          momentumScore: momentum.score
        });
        continue;
      }

      if (token.riskScore >= 0.7) {
        continue;
      }

      if (this.isPumpPortalToken(token)) {
        const pumpMomentumGate = this.evaluatePumpMomentumGate(token, momentum);
        if (!pumpMomentumGate.passed) {
          this.logger.decision(`PUMP GATE FAIL: ${token.mintAddress}`, {
            reason: pumpMomentumGate.reason,
            values: pumpMomentumGate.values,
            threshold: pumpMomentumGate.threshold,
            momentumScore: momentum.score
          });
          this.telemetry.record('pump.momentum_gate_failed', {
            token: token.mintAddress,
            reason: pumpMomentumGate.reason,
            values: pumpMomentumGate.values,
            threshold: pumpMomentumGate.threshold,
            momentumScore: momentum.score
          });
          if (pumpMomentumGate.reason === 'RUNNER_SCALPER_REQUIRES_MIGRATION') {
            this.telemetry.record('pump.migration_counterfactual', {
              token: token.mintAddress,
              source: token.source || null,
              routeType: token.routeType || null,
              bondingStage: token.bondingStage || null,
              ageSeconds: pumpMomentumGate.values?.ageSeconds ?? null,
              agePassed: pumpMomentumGate.values?.agePassed ?? null,
              passed: pumpMomentumGate.values?.nonMigratedCounterfactualPassed === true,
              reason: pumpMomentumGate.values?.nonMigratedCounterfactualReason
                || pumpMomentumGate.values?.nonMigratedCounterfactualGateReason
                || null,
              values: pumpMomentumGate.values?.nonMigratedCounterfactualValues || null,
              momentumScore: momentum.score,
              momentumFactors: momentum.factors,
              qualityScore: quality.score,
              rankScore: Number(rankScore.toFixed(4))
            });
          }
          this.telemetry.record('trade.rejected', {
            token: token.mintAddress,
            reason: 'LOW_PUMP_MOMENTUM',
            momentumScore: momentum.score,
            momentumFactors: momentum.factors,
            pumpFailureReason: pumpMomentumGate.reason,
            pumpFailureValues: pumpMomentumGate.values,
            pumpFailureThreshold: pumpMomentumGate.threshold
          });
          this.emitCandidateSnapshot({
            signal: {
              id: `cand_${token.mintAddress}_${Date.now()}`,
              token: token.mintAddress,
              source: token.source
            },
            tokenInfo: token,
            rejectionReason: 'LOW_PUMP_MOMENTUM',
            rejectionStage: 'pump_momentum_gate',
            snapshotTier: 'filter_reject',
            qualityScore: quality.score,
            qualityFactors: quality.factors,
            momentumScore: momentum.score,
            momentumFactors: momentum.factors,
            rankScore: Number(rankScore.toFixed(4)),
            extra: {
              pumpFailureReason: pumpMomentumGate.reason,
              pumpFailureValues: pumpMomentumGate.values,
              pumpFailureThreshold: pumpMomentumGate.threshold
            }
          });
          this.applySignalCooldown(
            token.mintAddress,
            Math.max(this.config.tokenSignalCooldownMs, this.config.rejectionQuarantineMs)
          );
          continue;
        }
      } else if (token.volume <= 50) {
        continue;
      }

      if (quality.score < this.config.minQualityScore) {
        this.telemetry.record('trade.rejected', {
          token: token.mintAddress,
          reason: 'LOW_QUALITY_SCORE',
          qualityScore: quality.score,
          qualityFactors: quality.factors
        });
        this.emitCandidateSnapshot({
          signal: {
            id: `cand_${token.mintAddress}_${Date.now()}`,
            token: token.mintAddress,
            source: token.source
          },
          tokenInfo: token,
          rejectionReason: 'LOW_QUALITY_SCORE',
          rejectionStage: 'quality_gate',
          snapshotTier: 'filter_reject',
          qualityScore: quality.score,
          qualityFactors: quality.factors,
          momentumScore: momentum.score,
          momentumFactors: momentum.factors,
          rankScore: Number(rankScore.toFixed(4))
        });
        continue;
      }

      const tradeAmount = this.capitalAllocation.computeTradeAmount(
        availableCapitalSol,
        this.config.tradingAmountSol
      );

      if (tradeAmount <= 0) {
        continue;
      }

      const signalGeneratedAtMs = Date.now();
      const signalId = `sig_${token.mintAddress}_${signalGeneratedAtMs}`;
      const signal = {
        id: signalId,
        token: token.mintAddress,
        action: 'buy',
        amount: tradeAmount,
        reasoning: 'Deterministic volume/liquidity/risk filter passed',
        generatedAt: new Date(signalGeneratedAtMs).toISOString(),
        generatedAtMs: signalGeneratedAtMs,
        qualityScore: quality.score,
        qualityFactors: quality.factors,
        momentumScore: momentum.score,
        momentumFactors: momentum.factors,
        rankScore: Number(rankScore.toFixed(4)),
        tokenInfo: token
      };
      signals.push(signal);
      this.applySignalCooldown(token.mintAddress, this.config.tokenSignalCooldownMs);

      this.logger.decision(`SIGNAL READY: ${token.mintAddress}`, {
        source: token.source,
        rankScore: Number(rankScore.toFixed(4)),
        qualityScore: quality.score,
        momentumScore: momentum.score,
        amountSol: Number(tradeAmount.toFixed(4))
      });

      this.telemetry.record('signal.generated', {
        signalId,
        token: token.mintAddress,
        generatedAt: signal.generatedAt,
        generatedAtMs: signalGeneratedAtMs,
        amountSol: tradeAmount,
        source: token.source,
        qualityScore: quality.score,
        qualityFactors: quality.factors,
        momentumScore: momentum.score,
        momentumFactors: momentum.factors,
        rankScore: Number(rankScore.toFixed(4))
      });

      if (signals.length >= Math.min(this.config.maxSignalsPerCycle, entrySlots)) {
        break;
      }
    }

    return signals;
  }

  async executeBuyLive(signal, quote, aiDecision) {
    assertLiveBroadcastAllowed('executeBuyLive');

    if (!this.config.liveExitEngineEnabled) {
      return {
        success: false,
        reason: 'LIVE_EXIT_ENGINE_DISABLED'
      };
    }

    const availableHotBalanceSol = this.getAvailableTradingCapitalSol();
    if (signal.amount > availableHotBalanceSol) {
      return {
        success: false,
        reason: 'INSUFFICIENT_AVAILABLE_HOT_BALANCE'
      };
    }

    const executionResponse = await this.marketData.executeJupiterOrder(
      this.connection,
      this.hotWallet,
      quote
    );

    const tokenAmountRaw = BigInt(
      executionResponse?.outputAmount ||
      executionResponse?.totalOutputAmount ||
      quote?.outAmount ||
      quote?.outputAmount ||
      0
    );

    const entryValueSol = await this.marketData.getTokenValueInSol(signal.token, tokenAmountRaw);
    const liveExitProfile = this.buildLiveExitProfile(aiDecision);
    const position = {
      token: signal.token,
      amount: Number(tokenAmountRaw),
      tokenAmountRaw: tokenAmountRaw.toString(),
      entryPrice: signal.amount,
      currentPrice: entryValueSol || signal.amount,
      timestamp: new Date().toISOString(),
      costBasisSol: signal.amount,
      marketValueSol: entryValueSol || signal.amount,
      unrealizedPnLSol: (entryValueSol || signal.amount) - signal.amount,
      signalId: signal.id,
      aiConfidence: aiDecision.confidence,
      aiPrimaryStrategy: aiDecision.primaryStrategy,
      aiConvergenceScore: aiDecision.convergenceScore,
      aiAction: aiDecision.action,
      aiExecutionProfile: aiDecision.executionProfile,
      liveExitProfile,
      peakPnlPercent: 0,
      trailingActivated: false,
      breakevenActivated: false,
      openedAt: Date.now(),
      lastBuySignature: executionResponse?.signature || executionResponse?.transactionId || null
    };

    this.currentPositions.set(signal.token, position);
    this.persistLivePositions();
    this.logger.trade(`LIVE BUY: ${signal.token} - ${signal.amount.toFixed(4)} SOL`);
    return { success: true, mode: 'LIVE', signature: position.lastBuySignature };
  }

  async executeBuyPaper(signal, quote, aiDecision) {
    if (signal.amount > this.paperWalletBalanceSol) {
      return {
        success: false,
        reason: 'INSUFFICIENT_PAPER_BALANCE'
      };
    }

    this.paperWalletBalanceSol -= signal.amount;
    const paperExitProfile = this.buildPaperExitProfile(aiDecision);

    const position = this.accounting.openPosition({
      mint: signal.token,
      mode: 'PAPER',
      entryPrice: signal.tokenInfo.price || 1,
      size: signal.amount,
      entryValueSol: signal.amount,
      signalId: signal.id,
      aiConfidence: aiDecision.confidence
    });

    this.paperPositions.set(signal.token, {
      token: signal.token,
      amount: signal.amount,
      entryPrice: signal.tokenInfo.price || 1,
      paperPositionId: position.id,
      costBasisSol: signal.amount,
      marketValueSol: signal.amount,
      unrealizedPnLSol: 0,
      lastPriceSol: signal.tokenInfo.price || 0,
      qualityScore: signal.qualityScore,
      momentumScore: signal.momentumScore,
      aiPrimaryStrategy: aiDecision.primaryStrategy,
      aiConvergenceScore: aiDecision.convergenceScore,
      aiAction: aiDecision.action,
      aiExecutionProfile: aiDecision.executionProfile,
      paperExitProfile,
      peakPnlPercent: 0,
      trailingActivated: false,
      openedAt: Date.now(),
      timestamp: new Date().toISOString()
    });

    this.logger.trade(`PAPER BUY: ${signal.token} - ${signal.amount.toFixed(4)} SOL`);
    return { success: true, mode: 'PAPER', positionId: position.id };
  }

  async updatePositions() {
    for (const [token, position] of this.currentPositions) {
      try {
        const marketValueSol = await this.marketData.getTokenValueInSol(token, position.tokenAmountRaw);
        position.marketValueSol = marketValueSol || position.costBasisSol;
        position.unrealizedPnLSol = position.marketValueSol - position.costBasisSol;
        await this.maybeCloseLivePosition(token, position);
      } catch (error) {
        this.logger.warn(`Failed to update live position for ${token}`, error.message);
        this.telemetry.record('live.position.update_failed', {
          token,
          reason: error.message
        });
      }
    }

    for (const [token, paperPosition] of this.paperPositions) {
      try {
        const currentPriceSol = await this.marketData.getTokenPrice(token);
        if (currentPriceSol > 0 && paperPosition.entryPrice > 0) {
          const priceRatio = currentPriceSol / paperPosition.entryPrice;
          paperPosition.lastPriceSol = currentPriceSol;
          paperPosition.marketValueSol = paperPosition.costBasisSol * priceRatio;
          paperPosition.unrealizedPnLSol = paperPosition.marketValueSol - paperPosition.costBasisSol;
          await this.maybeClosePaperPosition(token, paperPosition);
        }
      } catch (error) {
        this.logger.warn(`Failed to update paper position for ${token}`, error.message);
      }
    }
  }

  async maybeCloseLivePosition(token, position) {
    if (!this.executionModeManager.isLive() || !this.config.liveExitEngineEnabled || position.exitInProgress) {
      return null;
    }

    const exitProfile = this.getLiveExitProfile(position);
    const pnlPercent = position.costBasisSol === 0
      ? 0
      : position.unrealizedPnLSol / position.costBasisSol;

    if (pnlPercent <= -exitProfile.stopLossPercent) {
      return this.closeLivePosition(token, position, 'STOP_LOSS');
    }

    position.peakPnlPercent = Math.max(position.peakPnlPercent || 0, pnlPercent);
    if (position.peakPnlPercent >= exitProfile.trailingActivationPercent) {
      position.trailingActivated = true;
    }
    if (
      Number(exitProfile.breakevenActivationPercent || 0) > 0 &&
      position.peakPnlPercent >= exitProfile.breakevenActivationPercent
    ) {
      position.breakevenActivated = true;
    }

    const ageMs = Date.now() - this.getPositionOpenedAtMs(position);
    const minProfitHoldMs = exitProfile.minProfitHoldSeconds * 1000;
    if (ageMs < minProfitHoldMs) {
      return null;
    }

    const trailDrawdown = (position.peakPnlPercent || 0) - pnlPercent;
    if (
      position.trailingActivated &&
      trailDrawdown >= exitProfile.trailingDrawdownPercent
    ) {
      return this.closeLivePosition(token, position, 'TRAILING_TAKE_PROFIT');
    }

    if (
      position.breakevenActivated &&
      pnlPercent <= Number(exitProfile.breakevenStopPercent || 0)
    ) {
      return this.closeLivePosition(token, position, 'BREAKEVEN_STOP');
    }

    if (pnlPercent >= exitProfile.takeProfitPercent) {
      return this.closeLivePosition(token, position, 'TAKE_PROFIT');
    }

    if (ageMs >= exitProfile.maxHoldMinutes * 60 * 1000) {
      return this.closeLivePosition(token, position, 'TIME_EXIT');
    }

    return null;
  }

  async closeLivePosition(token, position, reason) {
    if (!this.executionModeManager.isLive()) {
      return { success: false, mode: this.executionModeManager.mode, reason: 'NOT_LIVE_MODE' };
    }
    if (!this.config.liveExitEngineEnabled) {
      return { success: false, mode: 'LIVE', reason: 'LIVE_EXIT_ENGINE_DISABLED' };
    }
    if (position.exitInProgress) {
      return { success: false, mode: 'LIVE', reason: 'LIVE_EXIT_IN_PROGRESS' };
    }

    position.exitInProgress = true;
    position.lastExitAttemptAt = new Date().toISOString();

    try {
      const tokenBalance = await this.getLiveTokenBalance(token);
      const amountRaw = BigInt(tokenBalance.amountRaw || '0');
      if (amountRaw <= 0n) {
        this.currentPositions.delete(token);
        this.persistLivePositions();
        this.telemetry.record('live.position.reconciled_closed', {
          token,
          reason: 'NO_ON_CHAIN_TOKEN_BALANCE',
          exitReason: reason
        });
        this.logger.warn(`LIVE POSITION REMOVED (${reason}): ${token} has no on-chain token balance`);
        return {
          success: false,
          mode: 'LIVE',
          reason: 'NO_ON_CHAIN_TOKEN_BALANCE'
        };
      }

      const quote = await this.marketData.getQuoteWithStalenessCheck(
        token,
        this.config.baseTokenMint,
        amountRaw.toString(),
        this.hotWallet.getAddress()
      );
      const staleness = this.marketData.isQuoteStale(quote);
      if (staleness.stale) {
        throw new Error(`SELL_QUOTE_STALE:${staleness.reason}`);
      }

      const quoteQuality = this.validateQuoteQuality(quote);
      if (!quoteQuality.passed) {
        throw new Error(quoteQuality.reason);
      }

      assertLiveBroadcastAllowed('closeLivePosition');
      const executionResponse = await this.marketData.executeJupiterOrder(
        this.connection,
        this.hotWallet,
        quote
      );

      const outLamports = Number(
        executionResponse?.outputAmount ||
        executionResponse?.totalOutputAmount ||
        quote?.outAmount ||
        quote?.outputAmount ||
        0
      );
      const exitValueSol = outLamports / LAMPORTS_PER_SOL;
      const realizedPnLSol = exitValueSol - Number(position.costBasisSol || 0);
      const pnlPercent = Number(position.costBasisSol || 0) === 0
        ? 0
        : realizedPnLSol / Number(position.costBasisSol || 0);

      this.currentPositions.delete(token);
      this.persistLivePositions();
      this.realizedPnL += realizedPnLSol;
      this.dailyPnL += realizedPnLSol;
      this.applyExitCooldown(token, reason, realizedPnLSol, position);

      this.telemetry.record('live.position.closed', {
        token,
        reason,
        entryValueSol: position.costBasisSol,
        exitValueSol,
        realizedPnLSol,
        pnlPercent,
        peakPnlPercent: position.peakPnlPercent || 0,
        trailingActivated: Boolean(position.trailingActivated),
        breakevenActivated: Boolean(position.breakevenActivated),
        tokenAmountRaw: amountRaw.toString(),
        signature: executionResponse?.signature || executionResponse?.transactionId || null,
        aiPrimaryStrategy: position.aiPrimaryStrategy,
        aiConvergenceScore: position.aiConvergenceScore,
        aiAction: position.aiAction,
        aiExecutionProfile: position.aiExecutionProfile,
        liveExitProfile: this.getLiveExitProfile(position)
      });
      this.strategyLedger.record('trade.exit', {
        sessionId: this.sessionId,
        token,
        mode: 'LIVE',
        strategy: position.aiPrimaryStrategy || 'UNKNOWN',
        convergenceScore: position.aiConvergenceScore || 0,
        exitReason: reason,
        realizedPnlSol: realizedPnLSol,
        pnlPercent,
        holdMinutes: Number(((Date.now() - this.getPositionOpenedAtMs(position)) / 60000).toFixed(4)),
        executionProfile: position.aiExecutionProfile,
        liveExitProfile: this.getLiveExitProfile(position)
      });

      this.logger.trade(`LIVE SELL (${reason}): ${token} - PnL ${realizedPnLSol.toFixed(4)} SOL`);
      return {
        success: true,
        mode: 'LIVE',
        reason,
        token,
        realizedPnLSol,
        signature: executionResponse?.signature || executionResponse?.transactionId || null
      };
    } catch (error) {
      position.exitInProgress = false;
      position.lastExitFailureAt = new Date().toISOString();
      position.lastExitFailureReason = error.message;
      this.persistLivePositions();
      this.telemetry.record('live.position.exit_failed', {
        token,
        reason,
        failureReason: error.message
      });
      this.logger.error(`LIVE SELL FAILED (${reason}): ${token}`, error.message);
      return {
        success: false,
        mode: 'LIVE',
        reason: error.message,
        token
      };
    }
  }

  async getLiveTokenBalance(token) {
    const accounts = await WalletManager.getOwnedTokenAccounts(
      this.connection,
      this.hotWallet.getPublicKey()
    );
    const account = accounts.find((item) => item.mint === token);
    if (!account) {
      return { mint: token, amountRaw: '0', uiAmount: 0, decimals: null };
    }
    return account;
  }

  async closeAllLivePositions(reason = 'EMERGENCY_EXIT') {
    const results = [];
    for (const [token, position] of Array.from(this.currentPositions.entries())) {
      results.push(await this.closeLivePosition(token, position, reason));
    }
    return results;
  }

  getPositionOpenedAtMs(position = {}) {
    const openedAtMs = Number(position.openedAt);
    if (Number.isFinite(openedAtMs) && openedAtMs > 0) {
      return openedAtMs;
    }

    const timestampMs = new Date(position.timestamp || position.entryAt || Date.now()).getTime();
    return Number.isFinite(timestampMs) ? timestampMs : Date.now();
  }

  async maybeClosePaperPosition(token, position) {
    const exitProfile = this.getPaperExitProfile(position);
    const pnlPercent = position.costBasisSol === 0
      ? 0
      : position.unrealizedPnLSol / position.costBasisSol;

    if (pnlPercent <= -exitProfile.stopLossPercent) {
      return this.closePaperPosition(token, position, 'STOP_LOSS');
    }

    position.peakPnlPercent = Math.max(position.peakPnlPercent || 0, pnlPercent);
    if (position.peakPnlPercent >= exitProfile.trailingActivationPercent) {
      position.trailingActivated = true;
    }
    if (
      Number(exitProfile.breakevenActivationPercent || 0) > 0 &&
      position.peakPnlPercent >= exitProfile.breakevenActivationPercent
    ) {
      position.breakevenActivated = true;
    }

    const ageMs = Date.now() - (position.openedAt || Date.now());
    const minProfitHoldMs = exitProfile.minProfitHoldSeconds * 1000;
    if (ageMs < minProfitHoldMs) {
      return null;
    }

    const trailDrawdown = (position.peakPnlPercent || 0) - pnlPercent;
    if (
      position.trailingActivated &&
      trailDrawdown >= exitProfile.trailingDrawdownPercent
    ) {
      return this.closePaperPosition(token, position, 'TRAILING_TAKE_PROFIT');
    }

    if (
      position.breakevenActivated &&
      pnlPercent <= Number(exitProfile.breakevenStopPercent || 0)
    ) {
      return this.closePaperPosition(token, position, 'BREAKEVEN_STOP');
    }

    if (pnlPercent >= exitProfile.takeProfitPercent) {
      return this.closePaperPosition(token, position, 'TAKE_PROFIT');
    }

    if (ageMs >= exitProfile.maxHoldMinutes * 60 * 1000) {
      return this.closePaperPosition(token, position, 'TIME_EXIT');
    }

    return null;
  }

  closePaperPosition(token, position, reason) {
    const exitValueSol = Math.max(position.marketValueSol || 0, 0);
    const realizedPnLSol = exitValueSol - position.costBasisSol;

    this.paperWalletBalanceSol += exitValueSol;
    this.paperPositions.delete(token);
    this.applyExitCooldown(token, reason, realizedPnLSol, position);

    this.accounting.closePosition(
      position.paperPositionId,
      position.lastPriceSol || position.entryPrice || 0
    );

    this.realizedPnL += realizedPnLSol;
    this.dailyPnL += realizedPnLSol;

    this.telemetry.record('paper.position.closed', {
      token,
      reason,
      entryValueSol: position.costBasisSol,
      exitValueSol,
      realizedPnLSol,
      pnlPercent: position.costBasisSol === 0 ? 0 : realizedPnLSol / position.costBasisSol,
      peakPnlPercent: position.peakPnlPercent || 0,
      trailingActivated: Boolean(position.trailingActivated),
      breakevenActivated: Boolean(position.breakevenActivated),
      qualityScore: position.qualityScore,
      momentumScore: position.momentumScore,
      aiPrimaryStrategy: position.aiPrimaryStrategy,
      aiConvergenceScore: position.aiConvergenceScore,
      aiAction: position.aiAction,
      aiExecutionProfile: position.aiExecutionProfile,
      paperExitProfile: position.paperExitProfile
    });
    this.strategyLedger.record('trade.exit', {
      sessionId: this.sessionId,
      token,
      mode: 'PAPER',
      strategy: position.aiPrimaryStrategy || 'UNKNOWN',
      convergenceScore: position.aiConvergenceScore || 0,
      exitReason: reason,
      realizedPnlSol: realizedPnLSol,
      pnlPercent: position.costBasisSol === 0 ? 0 : realizedPnLSol / position.costBasisSol,
      holdMinutes: Number(((Date.now() - (position.openedAt || Date.now())) / 60000).toFixed(4)),
      qualityScore: position.qualityScore,
      momentumScore: position.momentumScore,
      executionProfile: position.aiExecutionProfile,
      paperExitProfile: position.paperExitProfile
    });

    this.logger.trade(`PAPER SELL (${reason}): ${token} - PnL ${realizedPnLSol.toFixed(4)} SOL`);

    return {
      success: true,
      mode: 'PAPER',
      reason,
      token,
      realizedPnLSol
    };
  }

  closeAllPaperPositions(reason) {
    for (const [token, position] of Array.from(this.paperPositions.entries())) {
      this.closePaperPosition(token, position, reason);
    }
  }

  applyExitCooldown(token, reason, realizedPnLSol, position = {}) {
    if (reason === 'SESSION_END') {
      return;
    }

    let cooldownMs = this.config.tokenSignalCooldownMs;
    if (reason === 'TOKEN_NOT_QUOTEABLE' || reason === 'QUOTE_NO_OUTPUT') {
      cooldownMs = Math.max(cooldownMs, this.config.quoteFailureQuarantineMs);
    } else if (reason === 'STOP_LOSS' || realizedPnLSol < 0) {
      cooldownMs = Math.max(cooldownMs, this.config.badExitCooldownMs);
    } else if (reason === 'TIME_EXIT' && (position.peakPnlPercent || 0) < this.getPaperExitProfile(position).trailingActivationPercent) {
      cooldownMs = Math.max(cooldownMs, this.config.weakExitCooldownMs);
    }

    this.applySignalCooldown(token, cooldownMs);
  }

  getPaperExitProfile(position = {}) {
    return position.paperExitProfile || this.buildPaperExitProfile({
      primaryStrategy: position.aiPrimaryStrategy,
      executionProfile: position.aiExecutionProfile
    });
  }

  getLiveExitProfile(position = {}) {
    return position.liveExitProfile || this.buildLiveExitProfile({
      primaryStrategy: position.aiPrimaryStrategy,
      executionProfile: position.aiExecutionProfile
    });
  }

  buildLiveExitProfile(aiReview = {}) {
    const profile = this.buildPaperExitProfile(aiReview);
    return {
      ...profile,
      profileName: profile.profileName
        ? profile.profileName.replace(/^paper_/, 'live_').replace(/_smart_trade$/, '_live_smart_trade')
        : 'live_default',
      source: 'live_exit_engine'
    };
  }

  buildPaperExitProfile(aiReview = {}) {
    const baseProfile = {
      stopLossPercent: this.config.paperStopLossPercent,
      takeProfitPercent: this.config.paperTakeProfitPercent,
      trailingActivationPercent: this.config.paperTrailingActivationPercent,
      trailingDrawdownPercent: this.config.paperTrailingDrawdownPercent,
      breakevenActivationPercent: 0,
      breakevenStopPercent: 0,
      minProfitHoldSeconds: this.config.paperMinHoldSecondsForProfit,
      maxHoldMinutes: this.config.paperMaxHoldMinutes,
      profileName: 'paper_default'
    };

    const primaryStrategy = aiReview.primaryStrategy || 'SNIPER';
    const exitStyle = aiReview.executionProfile?.exitStyle || 'fixed';
    const expectedHold = aiReview.executionProfile?.expectedHold || 'short';

    switch (primaryStrategy) {
      case 'RUNNER_HUNTER':
        return {
          ...baseProfile,
          profileName: 'runner_breakout_smart_trade',
          stopLossPercent: Math.max(baseProfile.stopLossPercent, 0.022),
          takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.08),
          trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.035),
          trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.014),
          breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.025),
          breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.002),
          minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 45),
          maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 18)
        };
      case 'SNIPER':
        return {
          ...baseProfile,
          profileName: 'sniper_tight_smart_trade',
          stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.01),
          takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.02),
          trailingActivationPercent: Math.min(baseProfile.trailingActivationPercent, 0.015),
          trailingDrawdownPercent: Math.min(baseProfile.trailingDrawdownPercent, 0.006),
          breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.012),
          breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
          minProfitHoldSeconds: Math.min(baseProfile.minProfitHoldSeconds, 30),
          maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 6)
        };
      case 'SCALPER':
        return {
          ...baseProfile,
          profileName: 'scalper_micro_smart_trade',
          stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.009),
          takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.018),
          trailingActivationPercent: Math.min(baseProfile.trailingActivationPercent, 0.009),
          trailingDrawdownPercent: Math.min(baseProfile.trailingDrawdownPercent, 0.0045),
          breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.008),
          breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
          minProfitHoldSeconds: Math.min(baseProfile.minProfitHoldSeconds, 15),
          maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 4)
        };
      case 'MIGRATION_HUNTER':
        return {
          ...baseProfile,
          profileName: 'migration_hold_smart_trade',
          stopLossPercent: Math.max(baseProfile.stopLossPercent, 0.015),
          takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.03),
          trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.018),
          trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.007),
          breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.02),
          breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
          minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 75),
          maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 14)
        };
      case 'WALLET_FLOW':
        return {
          ...baseProfile,
          profileName: 'wallet_flow_smart_trade',
          stopLossPercent: Math.max(baseProfile.stopLossPercent, 0.013),
          takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.03),
          trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.018),
          trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.007),
          breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.018),
          breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
          minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 60),
          maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 10)
        };
      default:
        break;
    }

    if (exitStyle === 'trailing_runner') {
      return {
        ...baseProfile,
        profileName: 'trailing_runner_smart_trade',
        takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.04),
        trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.02),
        trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.008),
        breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.02),
        breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
        minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, expectedHold === 'short_to_medium' ? 60 : 45),
        maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, expectedHold === 'short_to_medium' ? 12 : baseProfile.maxHoldMinutes)
      };
    }

    if (exitStyle === 'tight_invalidation') {
      return {
        ...baseProfile,
        profileName: 'tight_invalidation_smart_trade',
        stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.01),
        takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.02),
        breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.012),
        breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
        maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 6)
      };
    }

    if (exitStyle === 'migration_hold' || exitStyle === 'flow_follow') {
      return {
        ...baseProfile,
        profileName: `${exitStyle}_smart_trade`,
        breakevenActivationPercent: Math.max(baseProfile.breakevenActivationPercent, 0.02),
        breakevenStopPercent: Math.max(baseProfile.breakevenStopPercent, 0.001),
        minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 60),
        maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 10)
      };
    }

    return baseProfile;
  }

  isPumpPortalToken(token) {
    const source = String(token.source || '');
    return source.startsWith('pumpportal') || source.startsWith('pumpdev');
  }

  isMigratedPumpPortalToken(token = {}) {
    return token.routeType === 'migration' || token.bondingStage === 'recently_bonded';
  }

  getRunnerLiquidityUsd(token = {}) {
    const poolState = token.poolStateSummary || token.poolState || {};
    const bestPool = poolState.bestPool || {};
    const rawPool = token.rawPool || {};
    const candidates = [
      token.liquidityUsd,
      poolState.bestLiquidityUsd,
      bestPool.liquidityUsd,
      rawPool.liquidityUsd
    ];

    for (const candidate of candidates) {
      const value = Number(candidate || 0);
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
    }

    return 0;
  }

  evaluatePumpMomentumGate(token, momentum) {
    const recentTrades = Number(token.recentTradeCount || 0);
    const recentVolume = Number(token.recentVolumeSol || 0);
    const buyRatio = Number(momentum.factors.buyRatio || 0);
    const sellRatio = 1 - buyRatio;
    const velocity = Number(token.tradeVelocityPerMin || 0);
    const ageSeconds = Number(token.tokenAgeSeconds || 0);
    const isMigration = this.isMigratedPumpPortalToken(token);
    const minMigratedLiquidityUsd = Number(this.config.paperRunnerMinMigratedLiquidityUsd || 0);
    const migratedLiquidityUsd = this.getRunnerLiquidityUsd(token);

    if (
      this.config.paperRunnerModeEnabled &&
      this.config.runnerScalperRequirePumpMigration &&
      !isMigration
    ) {
      const counterfactual = this.evaluateNonMigratedPumpMomentumGate({
        recentTrades,
        buyRatio,
        sellRatio,
        recentVolume,
        velocity,
        momentumScore: momentum.score
      });
      const agePassed = !(this.config.maxPumpTokenAgeSeconds > 0 && ageSeconds > this.config.maxPumpTokenAgeSeconds);
      return {
        passed: false,
        reason: 'RUNNER_SCALPER_REQUIRES_MIGRATION',
        values: {
          routeType: token.routeType || null,
          bondingStage: token.bondingStage || null,
          ageSeconds,
          agePassed,
          nonMigratedCounterfactualPassed: agePassed && counterfactual.passed,
          nonMigratedCounterfactualReason: agePassed ? null : 'PUMP_FAIL_AGE',
          nonMigratedCounterfactualGateReason: counterfactual.reason || null,
          nonMigratedCounterfactualValues: counterfactual.values || null
        },
        threshold: 'migration_or_recently_bonded'
      };
    }

    if (
      this.config.paperRunnerModeEnabled &&
      this.config.runnerScalperRequirePumpMigration &&
      isMigration &&
      minMigratedLiquidityUsd > 0 &&
      migratedLiquidityUsd > 0 &&
      migratedLiquidityUsd < minMigratedLiquidityUsd
    ) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_MIGRATED_LIQUIDITY',
        values: {
          liquidityUsd: migratedLiquidityUsd,
          routeType: token.routeType || null,
          bondingStage: token.bondingStage || null
        },
        threshold: minMigratedLiquidityUsd
      };
    }

    if (this.config.maxPumpTokenAgeSeconds > 0 && ageSeconds > this.config.maxPumpTokenAgeSeconds) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_AGE',
        values: { ageSeconds },
        threshold: this.config.maxPumpTokenAgeSeconds
      };
    }

    if (isMigration) {
      if (recentTrades < 1) {
        return {
          passed: false,
          reason: 'PUMP_FAIL_RECENT_TRADES',
          values: { recentTrades },
          threshold: 1
        };
      }

      if (buyRatio < 0.5) {
        return {
          passed: false,
          reason: 'PUMP_FAIL_BUY_RATIO',
          values: { buyRatio },
          threshold: 0.5
        };
      }

      if (sellRatio > 0.5) {
        return {
          passed: false,
          reason: 'PUMP_FAIL_SELL_RATIO',
          values: { sellRatio },
          threshold: 0.5
        };
      }

      if (momentum.score < this.config.minPumpMomentumScore) {
        return {
          passed: false,
          reason: 'PUMP_FAIL_MOMENTUM_SCORE',
          values: { momentumScore: momentum.score },
          threshold: this.config.minPumpMomentumScore
        };
      }

      return { passed: true };
    }

    return this.evaluateNonMigratedPumpMomentumGate({
      recentTrades,
      buyRatio,
      sellRatio,
      recentVolume,
      velocity,
      momentumScore: momentum.score
    });
  }

  evaluateNonMigratedPumpMomentumGate({
    recentTrades,
    buyRatio,
    sellRatio,
    recentVolume,
    velocity,
    momentumScore
  }) {
    if (recentTrades < this.config.minPumpRecentTrades) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_RECENT_TRADES',
        values: { recentTrades },
        threshold: this.config.minPumpRecentTrades
      };
    }

    if (buyRatio < this.config.minPumpBuyRatio) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_BUY_RATIO',
        values: { buyRatio },
        threshold: this.config.minPumpBuyRatio
      };
    }

    if (sellRatio > this.config.maxPumpSellRatio) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_SELL_RATIO',
        values: { sellRatio },
        threshold: this.config.maxPumpSellRatio
      };
    }

    if (recentVolume < this.config.minPumpRecentVolumeSol) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_VOLUME',
        values: { recentVolumeSol: recentVolume },
        threshold: this.config.minPumpRecentVolumeSol
      };
    }

    if (velocity < this.config.minPumpTradeVelocityPerMin) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_VELOCITY',
        values: { tradeVelocityPerMin: velocity },
        threshold: this.config.minPumpTradeVelocityPerMin
      };
    }

    if (momentumScore < this.config.minPumpMomentumScore) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_MOMENTUM_SCORE',
        values: { momentumScore },
        threshold: this.config.minPumpMomentumScore
      };
    }

    return { passed: true };
  }

  scoreMomentum(token) {
    if (!this.isPumpPortalToken(token)) {
      return {
        score: 0,
        factors: {
          tradeBurst: 0,
          buyRatio: 0,
          recentVolume: 0,
          velocity: 0,
          freshness: 0,
          migration: 0
        }
      };
    }

    const recentTrades = Number(token.recentTradeCount || 0);
    const recentBuys = Number(token.recentBuys || 0);
    const recentSells = Number(token.recentSells || 0);
    const recentVolume = Number(token.recentVolumeSol || 0);
    const velocity = Number(token.tradeVelocityPerMin || 0);
    const ageSeconds = Number(token.tokenAgeSeconds || 0);
    const totalRecent = recentBuys + recentSells;
    const buyRatio = totalRecent === 0 ? 0.5 : recentBuys / totalRecent;
    const ageScore = ageSeconds <= 0 ? 0.5 : Math.max(0, 1 - Math.min(ageSeconds, 1800) / 1800);

    const factors = {
      tradeBurst: Math.min(recentTrades / Math.max(this.config.minPumpRecentTrades, 1), 1),
      buyRatio,
      recentVolume: Math.min(recentVolume / Math.max(this.config.minPumpRecentVolumeSol, 0.001), 1),
      velocity: Math.min(velocity / 20, 1),
      freshness: ageScore,
      migration: token.routeType === 'migration' || token.bondingStage === 'recently_bonded' ? 1 : 0
    };

    const score = (
      factors.tradeBurst * 0.25 +
      factors.buyRatio * 0.25 +
      factors.recentVolume * 0.2 +
      factors.velocity * 0.15 +
      factors.freshness * 0.1 +
      factors.migration * 0.05
    );

    return {
      score: Number(Math.max(0, Math.min(score, 1)).toFixed(4)),
      factors
    };
  }

  summarizePumpPortalMomentum(token) {
    const now = Date.now();
    const windowMs = this.config.pumpMomentumWindowMs;
    const trades = (token.tradeWindow || []).filter((trade) => now - trade.timestamp <= windowMs);
    const recentBuys = trades.filter((trade) => trade.side === 'buy').length;
    const recentSells = trades.filter((trade) => trade.side === 'sell').length;
    const recentVolumeSol = trades.reduce((sum, trade) => sum + Number(trade.volumeSol || 0), 0);
    const minutes = Math.max(windowMs / 60000, 0.001);

    return {
      recentBuys,
      recentSells,
      recentTradeCount: trades.length,
      recentVolumeSol,
      tradeVelocityPerMin: trades.length / minutes,
      tokenAgeSeconds: token.createdAt ? (now - token.createdAt) / 1000 : 0
    };
  }

  isEntryWarmupActive() {
    return this.getEntryWarmupRemainingMs() > 0;
  }

  getEffectiveEntryWarmupMs() {
    if (this.executionModeManager.mode === 'LIVE') {
      return this.config.entryWarmupMs;
    }

    if (this.executionModeManager.mode === 'DRY_RUN') {
      return Math.min(this.config.entryWarmupMs, 30000);
    }

    return Math.min(this.config.entryWarmupMs, 15000);
  }

  getEntryWarmupRemainingMs() {
    const warmupMs = this.getEffectiveEntryWarmupMs();
    if (!this.entryStartTime || !warmupMs) {
      return 0;
    }

    return Math.max(warmupMs - (Date.now() - this.entryStartTime), 0);
  }

  observePreMigrationToken(token, launchIntelSummary = null) {
    const observedToken = this.isPumpPortalToken(token)
      ? {
          ...token,
          ...this.summarizePumpPortalMomentum(token)
        }
      : token;
    const walletClassificationContext = this.buildWalletClassificationContextForMint(observedToken.mint);
    const result = this.preMigrationWatchLane.observeToken(
      observedToken,
      launchIntelSummary,
      walletClassificationContext
    );
    if (!result.updated || !result.state) {
      return result;
    }

    const summary = this.launchIntelStore.registerPreMigrationState(result.state);
    const mint = result.state.mint;
    const current = this.latestPumpPortalTokens.get(mint);
    if (current) {
      current.preMigrationState = result.state;
      current.launchIntelSummary = summary || current.launchIntelSummary;
      this.latestPumpPortalTokens.set(mint, current);
    }

    const shouldEmitWatchTelemetry = result.flagged || this.shouldEmitPreMigrationObservedTelemetry(result);
    if (shouldEmitWatchTelemetry) {
      this.telemetry.record(result.flagged ? 'pre_migration.flagged' : 'pre_migration.observed', {
        mint,
        symbol: result.state.symbol || null,
        score: result.state.score,
        flagType: result.flagType || null,
        reasons: result.state.reasons,
        observedInterest: Boolean(result.observedInterest),
        observedSignal: Boolean(result.observedSignal),
        confirmed: Boolean(result.state.confirmed),
        newlyConfirmed: Boolean(result.newlyConfirmed),
        interestSignalCount: result.state.interestSignalCount,
        observedSignalCount: result.state.observedSignalCount,
        confirmedAt: result.state.confirmedAt,
        confirmationReason: result.state.confirmationReason,
        bondingCurveAddress: result.state.bondingCurveAddress,
        quoteMint: result.state.quoteMint || null,
        pairBase: result.state.pairBase || null,
        bondingCurveComplete: result.state.bondingCurveComplete,
        virtualSolReservesSol: result.state.virtualSolReservesSol,
        realSolReservesSol: result.state.realSolReservesSol,
        virtualTokenReservesTokens: result.state.virtualTokenReservesTokens,
        bondingCurvePriceSol: result.state.bondingCurvePriceSol,
        curveProgress: result.state.curveProgress,
        providerCurveProgress: result.state.providerCurveProgress ?? null,
        providerCurvePriceSol: result.state.providerCurvePriceSol ?? null,
        providerCurveSnapshotAt: result.state.providerCurveSnapshotAt || null,
        curveProgressSource: result.state.curveProgressSource || null,
        updateSource: result.state.curveProgressSource || result.state.source || null,
        lastCurveUpdateAt: result.state.lastCurveUpdateAt || null,
        bondingStage: result.state.bondingStage,
        recentBuys: result.state.recentBuys,
        recentSells: result.state.recentSells,
        buyRatio: result.state.buyRatioCaptured ? result.state.buyRatio : null,
        buyRatioCaptured: Boolean(result.state.buyRatioCaptured),
        uniqueBuyerCount: result.state.uniqueBuyerCountCaptured ? result.state.uniqueBuyerCount : null,
        uniqueBuyerCountCaptured: Boolean(result.state.uniqueBuyerCountCaptured),
        uniqueBuyerRatio: result.state.uniqueBuyerRatio,
        sniperWalletCount: result.state.sniperWalletCountCaptured ? result.state.sniperWalletCount : null,
        sniperWalletCountCaptured: Boolean(result.state.sniperWalletCountCaptured),
        tradeVelocityPerMin: result.state.tradeVelocityPerMin,
        recentVolumeSol: result.state.recentVolumeSol,
        convictionWhaleCount: result.state.convictionWhaleCount,
        alphaScalperCount: result.state.alphaScalperCount,
        earlySniperCount: result.state.earlySniperCount,
        riskWalletCount: result.state.riskWalletCount,
        lateChaserCount: result.state.lateChaserCount
      });

      this.candidateDossierLedger.recordWatchState(result.state, {
        eventType: result.flagged ? 'watch.flagged' : 'watch.observed',
        flagged: Boolean(result.flagged),
        flagType: result.flagType || null,
        observedInterest: Boolean(result.observedInterest),
        observedSignal: Boolean(result.observedSignal),
        confirmed: Boolean(result.state.confirmed),
        newlyConfirmed: Boolean(result.newlyConfirmed),
        confirmationReason: result.state.confirmationReason
      });
    }
    this.outcomeLedger.recordCandidate(result.state, {
      kind: result.flagged ? 'candidate.flagged' : 'candidate.observed',
      flagged: Boolean(result.flagged),
      flagType: result.flagType || null,
      observedInterest: Boolean(result.observedInterest),
      observedSignal: Boolean(result.observedSignal),
      newlyConfirmed: Boolean(result.newlyConfirmed),
      sessionId: this.sessionId
    });

    this.finalistAccountVerifier?.maybeSubscribe?.(result.state, {
      source: 'pre_migration_watch',
      flagged: Boolean(result.flagged),
      confirmed: Boolean(result.state.confirmed),
      newlyConfirmed: Boolean(result.newlyConfirmed),
      flagType: result.flagType || null
    }).catch((error) => {
      this.logger.warn('Finalist account verifier subscription failed', {
        mint,
        errorMessage: error.message
      });
    });

    this.recordPreMigrationPaperEvents(this.preMigrationPaperLane.observe(result.state, {
      flagged: Boolean(result.flagged),
      timestamp: new Date().toISOString(),
      walletClassificationContext
    }));

    if (
      this.config.pumpDevTargetedCurveParitySampleWatchEnabled
      && result.state.confirmed === true
      && (Number(result.state.score) >= 70 || Number(result.state.curveProgress) >= 0.6)
    ) {
      this.maybeSchedulePumpDevTargetedCurveParitySample('high_conviction_watch', result.state, {
        source: 'pre_migration_watch',
        flagType: result.flagType || null,
        reasons: result.state.reasons || []
      });
    }

    if (result.flagged) {
      this.eventFlow.record('pre_migration.flagged', {
        token: mint,
        score: result.state.score,
        reasons: result.state.reasons
      });
      this.logger.decision(`PRE-MIGRATION WATCH: ${mint}`, {
        symbol: result.state.symbol,
        flagType: result.flagType,
        score: result.state.score,
        reasons: result.state.reasons,
        curveProgress: result.state.curveProgress,
        bondingStage: result.state.bondingStage,
        recentTrades: result.state.recentTradeCount,
        tradeVelocityPerMin: Number(result.state.tradeVelocityPerMin || 0).toFixed(2),
        recentVolumeSol: Number(result.state.recentVolumeSol || 0).toFixed(4)
      });
    }

    return result;
  }

  shouldEmitPreMigrationObservedTelemetry(result = {}) {
    const state = result.state || {};
    const mint = state.mint;
    if (!mint) return true;
    if (result.newlyConfirmed || result.observedSignal || state.confirmed) return true;

    const now = Date.now();
    const minIntervalMs = Math.max(0, Number(this.config.preMigrationObservedTelemetryMinIntervalMs || 0));
    const minScoreDelta = Math.max(0, Number(this.config.preMigrationObservedTelemetryMinScoreDelta || 0));
    const minCurveDelta = Math.max(0, Number(this.config.preMigrationObservedTelemetryMinCurveDelta || 0));
    const previous = this.preMigrationObservedTelemetryLastByMint.get(mint);
    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);

    if (!previous) {
      this.preMigrationObservedTelemetryLastByMint.set(mint, { at: now, score, curveProgress });
      return true;
    }

    const ageMs = now - Number(previous.at || 0);
    const scoreDelta = Number.isFinite(score) && Number.isFinite(previous.score)
      ? Math.abs(score - previous.score)
      : 0;
    const curveDelta = Number.isFinite(curveProgress) && Number.isFinite(previous.curveProgress)
      ? Math.abs(curveProgress - previous.curveProgress)
      : 0;
    const shouldEmit = ageMs >= minIntervalMs || scoreDelta >= minScoreDelta || curveDelta >= minCurveDelta;
    if (shouldEmit) {
      this.preMigrationObservedTelemetryLastByMint.set(mint, { at: now, score, curveProgress });
    }
    return shouldEmit;
  }

  buildWalletClassificationContextForMint(mint) {
    if (!mint || !this.walletEventLedger) {
      return null;
    }

    const events = typeof this.walletEventLedger.recentEventsForMint === 'function'
      ? this.walletEventLedger.recentEventsForMint(mint, 50)
      : (this.walletEventLedger.recentEvents || []).filter((event) => event?.mint === mint).slice(0, 25);
    const untrustedEvents = typeof this.walletEventLedger.recentUntrustedEventsForMint === 'function'
      ? this.walletEventLedger.recentUntrustedEventsForMint(mint, 50)
      : (this.walletEventLedger.recentUntrustedEvents || []).filter((event) => event?.mint === mint).slice(0, 25);
    if (events.length === 0 && untrustedEvents.length === 0) {
      return null;
    }

    const labels = {};
    const walletRows = [];
    const shadowWalletRows = [];
    const untrustedWalletRows = [];
    for (const event of events) {
      const wallet = event.wallet;
      const shadowOnly = event.walletProfile?.shadowOnly === true;
      const classification = wallet
        ? this.walletEventLedger.walletStats.get(wallet)?.classification
        : null;
      const promotion = this.getWalletPromotionReview(wallet, event.walletProfile?.name);
      const label = classification?.label || 'UNCLASSIFIED';
      labels[label] = (labels[label] || 0) + 1;
      const row = {
        wallet,
        name: event.walletProfile?.name || promotion?.name || null,
        label,
        confidence: classification?.confidence ?? null,
        side: event.side || null,
        phase: event.phase || null,
        tradeAt: event.tradeAt || event.observedAt || null,
        reviewTier: promotion?.reviewTier || null,
        evidenceTier: promotion?.evidenceTier || null,
        solAmount: event.amount?.sol ?? null,
        curveProgress: event.market?.curveProgress ?? null,
        secondsSinceCreate: event.timing?.secondsSinceCreate ?? null,
        shadowOnly
      };
      if (shadowOnly) {
        shadowWalletRows.push(row);
      } else {
        walletRows.push(row);
      }
    }
    for (const event of untrustedEvents) {
      untrustedWalletRows.push({
        wallet: event.wallet || null,
        name: null,
        label: 'UNTRUSTED_RUNTIME_TAPE',
        confidence: null,
        side: event.side || null,
        phase: event.phase || null,
        tradeAt: event.tradeAt || event.observedAt || null,
        reviewTier: null,
        evidenceTier: null,
        solAmount: event.amount?.sol ?? null,
        curveProgress: event.market?.curveProgress ?? null,
        secondsSinceCreate: event.timing?.secondsSinceCreate ?? null,
        shadowOnly: false,
        trustedSignal: false,
        untrustedRuntimeTape: true,
        untrustedReason: event.reason || null,
        launchIntelWallet: event.launchIntelWallet || null,
        launchIntelShortlistCandidate: event.launchIntelWallet?.shortlistCandidate === true,
        launchIntelClassification: event.launchIntelWallet?.classification || null
      });
    }
    const wallets = walletRows
      .sort((a, b) => new Date(a.tradeAt || 0).getTime() - new Date(b.tradeAt || 0).getTime())
      .slice(0, 8);
    const shadowWallets = shadowWalletRows
      .sort((a, b) => new Date(a.tradeAt || 0).getTime() - new Date(b.tradeAt || 0).getTime())
      .slice(0, 8);
    const untrustedWallets = untrustedWalletRows
      .sort((a, b) => new Date(a.tradeAt || 0).getTime() - new Date(b.tradeAt || 0).getTime())
      .slice(0, 12);

    const count = (...selectedLabels) => selectedLabels.reduce((sum, label) => sum + Number(labels[label] || 0), 0);
    return {
      touched: wallets.length > 0,
      shadowTouched: shadowWallets.length > 0,
      untrustedTouched: untrustedWallets.length > 0,
      observedWalletTradeCount: events.length,
      observedNonShadowWalletTradeCount: walletRows.length,
      observedShadowWalletTradeCount: shadowWalletRows.length,
      observedUntrustedWalletTradeCount: untrustedEvents.length,
      labelCounts: labels,
      earlySniperCount: count('EARLY_SNIPER'),
      alphaScalperCount: count('EARLY_ALPHA_SCALPER'),
      convictionWhaleCount: count('CONVICTION_WHALE', 'RUNNER_HUNTER', 'DIP_SUPPORT_BUYER'),
      riskWalletCount: count('INSIDER_DUMPER', 'DEV_SIDE_WALLET', 'BUNDLE_CLUSTER', 'LOW_SIGNAL_AVOID'),
      lateChaserCount: count('LATE_CHASER'),
      contextSource: typeof this.walletEventLedger.recentEventsForMint === 'function' ? 'per_mint_cache' : 'recent_events_scan',
      earliestTouchAt: wallets[0]?.tradeAt || null,
      earliestBuyAt: wallets.find((wallet) => String(wallet.side || '').toLowerCase() === 'buy')?.tradeAt || null,
      wallets,
      shadowWallets,
      earliestShadowTouchAt: shadowWallets[0]?.tradeAt || null,
      earliestShadowBuyAt: shadowWallets.find((wallet) => String(wallet.side || '').toLowerCase() === 'buy')?.tradeAt || null,
      earliestUntrustedTouchAt: untrustedWallets[0]?.tradeAt || null,
      earliestUntrustedBuyAt: untrustedWallets.find((wallet) => String(wallet.side || '').toLowerCase() === 'buy')?.tradeAt || null,
      untrustedWallets
    };
  }

  canonicalWalletName(name, walletAddress) {
    const label = String(name || walletAddress || '').trim();
    if (/^Cupsey(?:\s+\d+)?$/i.test(label)) return 'Cupsey';
    return label || walletAddress || null;
  }

  refreshWalletPromotionReviewIfNeeded() {
    const filePath = this.config.walletPromotionReviewFilePath;
    if (!filePath) return;
    const now = Date.now();
    const refreshIntervalMs = Number(this.config.walletPromotionReviewRefreshIntervalMs || 60000);
    if ((now - this.walletPromotionReviewLastLoadedAt) < refreshIntervalMs) return;
    this.walletPromotionReviewLastLoadedAt = now;

    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs <= this.walletPromotionReviewLastMtimeMs) return;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
      const byAddress = new Map();
      const byName = new Map();
      const addRows = (rows = []) => {
        for (const row of rows) {
          const meta = {
            walletAddress: row.walletAddress || null,
            name: row.name || null,
            reviewTier: row.reviewTier || null,
            evidenceTier: row.evidenceTier || null
          };
          if (meta.walletAddress) byAddress.set(meta.walletAddress, meta);
          const canonical = this.canonicalWalletName(meta.name, meta.walletAddress);
          if (canonical) byName.set(canonical, meta);
        }
      };
      addRows(parsed.trustReview);
      addRows(parsed.profitableNeedsFirstTouchEvidence);
      addRows(parsed.watchReview);
      addRows(parsed.avoidReview);
      addRows(parsed.hold);
      this.walletPromotionReviewByAddress = byAddress;
      this.walletPromotionReviewByName = byName;
      this.walletPromotionReviewLastMtimeMs = stat.mtimeMs;
      this.logger.info('Wallet promotion review loaded', {
        wallets: byAddress.size,
        filePath
      });
    } catch (error) {
      this.logger.warn('Failed to load wallet promotion review', {
        filePath,
        errorMessage: error.message
      });
    }
  }

  getWalletPromotionReview(wallet, name = null) {
    this.refreshWalletPromotionReviewIfNeeded();
    if (wallet && this.walletPromotionReviewByAddress.has(wallet)) {
      return this.walletPromotionReviewByAddress.get(wallet);
    }
    const canonical = this.canonicalWalletName(name, wallet);
    return canonical ? this.walletPromotionReviewByName.get(canonical) || null : null;
  }

  recordPreMigrationPaperEvents(events = []) {
    if (!Array.isArray(events) || events.length === 0) {
      return;
    }

    for (const event of events) {
      if (!event?.telemetryType) {
        continue;
      }

      this.telemetry.record(event.telemetryType, event.payload || {});
      this.candidateDossierLedger.recordPaperEvent(
        event,
        this.preMigrationWatchLane.getMintSummary(event.payload?.mint) || {}
      );
      this.outcomeLedger.recordPaperEvent(
        event,
        this.preMigrationWatchLane.getMintSummary(event.payload?.mint) || {},
        { sessionId: this.sessionId }
      );
      this.eventFlow.record(event.telemetryType, {
        token: event.payload?.mint,
        reason: event.payload?.reason
      });

      this.maybeSchedulePumpDevTargetedCurveParitySampleFromPaperEvent(event);
      if (
        event.type === 'decision'
        || event.type === 'entry'
        || event.telemetryType === 'pre_migration_paper.entry'
      ) {
        const shadowGateResult = this.finalistAccountVerifier?.evaluateShadowGate?.(event.payload || {}, {
          decision: event.payload?.decision || (event.type === 'entry' ? 'PAPER_ENTRY' : null),
          reason: event.payload?.reason || null,
          preset: event.payload?.preset || null,
          lane: event.payload?.lane || null
        });
        this.maybeRecordFreshCurveOverrideShadow(event, shadowGateResult);
        if (shadowGateResult?.status === 'LIVE_SHADOW_READY_FRESH_ACCOUNT_STATE') {
          this.liveExecutionDryRunLane?.evaluate?.(event.payload || {}, {
            decision: event.payload?.decision || (event.type === 'entry' ? 'PAPER_ENTRY' : null),
            reason: event.payload?.reason || null,
            preset: event.payload?.preset || null,
            lane: event.payload?.lane || null,
            gateResult: shadowGateResult
          }).catch((error) => {
            this.logger.warn('Live execution dry-run failed', {
              mint: event.payload?.mint || null,
              errorMessage: error.message
            });
          });
        }
      }

      if (event.telemetryType === 'pre_migration_paper.guard_attribution') {
        const shadowGateResult = this.finalistAccountVerifier?.evaluateShadowGate?.(event.payload || {}, {
          decision: event.payload?.outcome || null,
          reason: event.payload?.reason || event.payload?.guardReason || null,
          preset: event.payload?.preset || null,
          lane: event.payload?.lane || null
        });
        this.maybeRecordFreshCurveOverrideShadow(event, shadowGateResult);
      }

      if (this.shouldSchedulePreMigrationPaperRecheck(event)) {
        this.schedulePreMigrationPaperRecheck(event.payload);
      }

      this.maybeRecordWalletRelaxedShadowDecision(event);
      this.maybeRecordCurveFalseNegativeShadowDecision(event);
      this.maybeRecordCurveConfirmationShadowDecision(event);
      this.maybeUpdateCurveConfirmationShadow(event);

      if (
        event.type === 'diagnostic'
        && event.telemetryType === 'pre_migration_paper.first_curve_snapshot_near_miss'
        && this.preMigrationPaperLane?.logDecisionEvents
        && this.shouldLogPreMigrationPaperEvent(event)
      ) {
        this.logger.decision(`PRE-MIGRATION PAPER NEAR MISS: ${event.payload.mint}`, {
          symbol: event.payload.symbol,
          failedChecks: event.payload.failedChecks,
          score: event.payload.score,
          curveProgress: event.payload.curveProgress,
          recentVolumeSol: event.payload.recentVolumeSol,
          tradeVelocityPerMin: event.payload.tradeVelocityPerMin,
          interestSignalCount: event.payload.interestSignalCount,
          uniqueBuyerCount: event.payload.uniqueBuyerCount,
          riskWalletCount: event.payload.riskWalletCount,
          buyRatio: event.payload.buyRatio,
          hasPrice: event.payload.hasPrice
        });
      } else if (
        event.type === 'decision'
        && this.preMigrationPaperLane?.logDecisionEvents
        && this.shouldLogPreMigrationPaperEvent(event)
      ) {
        this.logger.decision(`PRE-MIGRATION PAPER ${event.payload.decision}: ${event.payload.mint}`, {
          symbol: event.payload.symbol,
          preset: event.payload.preset,
          lane: event.payload.lane,
          reason: event.payload.reason,
          score: event.payload.score,
          curveProgress: event.payload.curveProgress,
          guardOverride: event.payload.guardOverride,
          recentVolumeSol: event.payload.recentVolumeSol,
          tradeVelocityPerMin: event.payload.tradeVelocityPerMin
        });
      } else if (event.type === 'entry') {
        this.logger.decision(`PRE-MIGRATION PAPER ENTRY: ${event.payload.mint}`, {
          symbol: event.payload.symbol,
          lane: event.payload.lane,
          profileName: event.payload.profileName,
          score: event.payload.score,
          curveProgress: event.payload.curveProgress,
          entryPriceSol: event.payload.entryPriceSol,
          amountSol: event.payload.amountSol
        });
      } else if (event.type === 'exit') {
        this.logger.decision(`PRE-MIGRATION PAPER EXIT: ${event.payload.mint}`, {
          symbol: event.payload.symbol,
          lane: event.payload.lane,
          profileName: event.payload.profileName,
          reason: event.payload.reason,
          pnlSol: event.payload.pnlSol,
          returnPct: event.payload.returnPct,
          holdSeconds: event.payload.holdSeconds
        });
      }
    }
  }

  shouldSchedulePreMigrationPaperRecheck(event = {}) {
    if (
      event.telemetryType !== 'pre_migration_paper.decision'
      || event.payload?.decision !== 'PAPER_SKIPPED'
    ) {
      return false;
    }

    const reason = event.payload?.reason || event.payload?.skipReason || null;
    if (!reason) {
      return false;
    }

    const configuredReasons = String(this.config.preMigrationPaperRecheckReasons || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return configuredReasons.includes(reason);
  }

  maybeRecordFreshCurveOverrideShadow(event, shadowGateResult = null) {
    if (this.config.preMigrationFreshCurveOverrideShadowEnabled === false) {
      return;
    }
    if (!event?.payload || !this.preMigrationPaperLane || !shadowGateResult?.update) {
      return;
    }

    const payload = event.payload || {};
    const mint = payload.mint;
    if (!mint || !this.isFreshCurveOverrideCandidate(payload)) {
      return;
    }

    const update = shadowGateResult.update || {};
    const accountCurve = Number(update.curveProgress);
    if (!Number.isFinite(accountCurve)) {
      return;
    }

    const accountAgeMs = Number(shadowGateResult.accountAgeMs);
    const freshForMs = Number(this.config.finalistAccountVerifierFreshMs || 1500);
    const fresh = shadowGateResult.fresh === true
      || (Number.isFinite(accountAgeMs) && accountAgeMs <= freshForMs);
    if (!fresh || update.complete === true) {
      return;
    }

    const presetName = payload.preset || 'strictMigration';
    const preset = (this.preMigrationPaperLane.presets || []).find((item) => item.name === presetName)
      || {
        name: presetName,
        lane: payload.lane || null,
        profileName: payload.profileName || null,
        strategy: this.preMigrationPaperLane.getStrategy?.(presetName) || this.preMigrationPaperLane.strategy || {}
      };
    const key = `${event.telemetryType || event.type}:${presetName}:${mint}:${payload.reason || payload.guardReason || payload.outcome || 'unknown'}`;
    if (this.freshCurveOverrideShadowSeen.has(key)) {
      return;
    }
    this.freshCurveOverrideShadowSeen.add(key);

    const originalCurve = Number(payload.curveProgress ?? payload.providerCurveProgress);
    const originalAgeSeconds = Number(
      payload.firstCurveSnapshotScalpCurveSnapshotAgeSeconds
      ?? payload.highCurveStaleSnapshotCurveSnapshotAgeSeconds
      ?? payload.curveSnapshotAgeSeconds
    );
    const timestamp = new Date().toISOString();
    const overrideState = this.buildFreshCurveOverrideState(payload, update, timestamp);
    const history = this.preMigrationPaperLane.observationHistory?.get?.(mint) || [];
    const originalReason = payload.reason || payload.guardReason || null;

    let entryGuards;
    let decision;
    try {
      entryGuards = this.preMigrationPaperLane.evaluateEntryGuards(overrideState, history, timestamp);
      decision = this.preMigrationPaperLane.evaluateEntryDecision(overrideState, preset, entryGuards, timestamp);
    } catch (error) {
      this.telemetry.record('pre_migration_paper.fresh_curve_override_shadow_error', {
        mint,
        symbol: payload.symbol || update.symbol || null,
        sourceTelemetryType: event.telemetryType || event.type || null,
        sourceReason: originalReason,
        preset: presetName,
        errorMessage: error.message
      });
      return;
    }

    const wouldEnter = decision?.passed === true;
    this.telemetry.record('pre_migration_paper.fresh_curve_override_shadow', {
      mode: 'report_only_fresh_curve_override_shadow',
      mint,
      symbol: payload.symbol || update.symbol || null,
      timestamp,
      sourceTelemetryType: event.telemetryType || event.type || null,
      sourceDecision: payload.decision || payload.outcome || null,
      sourceReason: originalReason,
      sourceFailedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks.slice(0, 12) : [],
      preset: presetName,
      lane: payload.lane || preset.lane || null,
      profileName: payload.profileName || preset.profileName || null,
      verifierStatus: shadowGateResult.status || null,
      verifierBlockedReason: shadowGateResult.blockedReason || null,
      accountAgeMs: Number.isFinite(accountAgeMs) ? Number(accountAgeMs.toFixed(0)) : null,
      accountReceivedAt: update.receivedAt || null,
      accountSlot: update.slot ?? null,
      originalCurveProgress: Number.isFinite(originalCurve) ? Number(originalCurve.toFixed(6)) : null,
      accountCurveProgress: Number(accountCurve.toFixed(6)),
      curveDelta: Number.isFinite(originalCurve) ? Number((accountCurve - originalCurve).toFixed(6)) : null,
      originalCurveSnapshotAgeSeconds: Number.isFinite(originalAgeSeconds) ? Number(originalAgeSeconds.toFixed(2)) : null,
      overrideCurveSnapshotAgeSeconds: 0,
      originalPriceSol: payload.priceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? null,
      accountPriceSol: update.priceSol ?? null,
      score: payload.score ?? null,
      recentVolumeSol: payload.recentVolumeSol ?? null,
      tradeVelocityPerMin: payload.tradeVelocityPerMin ?? null,
      buyRatio: payload.buyRatio ?? null,
      entryGuardPassed: entryGuards?.passed === true,
      entryGuardReason: entryGuards?.reason || null,
      entryGuardOverride: entryGuards?.guardOverride || null,
      decisionPassed: decision?.passed === true,
      decisionReason: decision?.reason || null,
      wouldEnter,
      changedOutcome: Boolean(payload.decision === 'PAPER_SKIPPED' && wouldEnter),
      freshCurveStillBlocked: !wouldEnter,
      walletBridgeProof: payload.walletBridgeProof || null,
      walletClassificationContext: payload.walletClassificationContext || null
    });
  }

  isFreshCurveOverrideCandidate(payload = {}) {
    const reasons = new Set([
      payload.reason,
      payload.guardReason,
      ...(Array.isArray(payload.failedChecks) ? payload.failedChecks : [])
    ].filter(Boolean));
    return [
      'CURVE_NOT_ADVANCING',
      'NO_PRIOR_CURVE_PROGRESS',
      'FIRST_CURVE_SNAPSHOT_SCALP_STALE_CURVE_UPDATE',
      'HIGH_CURVE_STALE_CURVE_UPDATE',
      'STALE_CURVE_UPDATE'
    ].some((reason) => reasons.has(reason));
  }

  buildFreshCurveOverrideState(payload = {}, update = {}, timestamp = new Date().toISOString()) {
    const accountCurve = Number(update.curveProgress);
    const accountPrice = Number(update.priceSol);
    const originalPrice = Number(payload.priceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol);
    const priceSol = Number.isFinite(accountPrice) && accountPrice > 0
      ? accountPrice
      : (Number.isFinite(originalPrice) && originalPrice > 0 ? originalPrice : null);
    return {
      ...payload,
      curveProgress: Number.isFinite(accountCurve) ? accountCurve : payload.curveProgress,
      providerCurveProgress: payload.curveProgress ?? payload.providerCurveProgress ?? null,
      onchainCurveProgress: Number.isFinite(accountCurve) ? accountCurve : null,
      priceSol,
      bondingCurvePriceSol: priceSol,
      curvePriceSol: priceSol,
      bondingStage: update.bondingStage || payload.bondingStage || null,
      bondingCurveComplete: update.complete === true,
      bondingCurveState: {
        ...(payload.bondingCurveState || {}),
        source: 'finalist_account_verifier_fresh_curve_override_shadow',
        curveProgress: Number.isFinite(accountCurve) ? accountCurve : null,
        onchainCurveProgress: Number.isFinite(accountCurve) ? accountCurve : null,
        curveProgressOnchain: Number.isFinite(accountCurve) ? accountCurve : null,
        priceSol,
        virtualSolReservesSol: update.virtualSolReservesSol ?? payload.virtualSolReservesSol ?? null,
        virtualTokenReservesTokens: update.virtualTokenReservesTokens ?? payload.virtualTokenReservesTokens ?? null,
        complete: update.complete === true,
        bondingStage: update.bondingStage || payload.bondingStage || null,
        lastFetchAtIso: update.receivedAt || timestamp,
        lastFetchAt: update.receivedAt || timestamp,
        approximate: false,
        refreshed: true
      }
    };
  }

  maybeRecordWalletRelaxedShadowDecision(event) {
    if (this.config.preMigrationWalletRelaxedShadowEnabled === false) {
      return;
    }
    if (
      event?.telemetryType !== 'pre_migration_paper.decision'
      || event.payload?.decision !== 'PAPER_SKIPPED'
      || !['LOW_SCORE', 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE'].includes(event.payload?.reason)
    ) {
      return;
    }

    const payload = event.payload || {};
    const mint = payload.mint;
    if (!mint) return;
    const shadowProfile = 'all_low_score_first_sight__tracked_first_touch_buy';
    const key = `${shadowProfile}:${mint}`;

    const context = payload.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets.slice() : [];
    const sortedWallets = wallets.sort((a, b) => {
      const atA = new Date(a.tradeAt || 0).getTime();
      const atB = new Date(b.tradeAt || 0).getTime();
      return atA - atB;
    });
    const isPositiveOrProven = (wallet) => (
      ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(wallet.evidenceTier)
      || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(wallet.reviewTier)
    );
    const positiveFirstTouch = sortedWallets.find((wallet) =>
      String(wallet.side || '').toLowerCase() === 'buy'
      && isPositiveOrProven(wallet)
      && (Number(wallet.curveProgress) < 0.85 || wallet.phase === 'fresh_launch' || wallet.phase === 'pre_migration')
    );
    const avoidTouches = sortedWallets.filter((wallet) =>
      wallet.reviewTier === 'AVOID_REVIEW' || wallet.evidenceTier === 'NEGATIVE_EVIDENCE'
    );
    const qualifyingFirstTouch = sortedWallets.find((wallet) =>
      String(wallet.side || '').toLowerCase() === 'buy'
      && (Number(wallet.curveProgress) < 0.85 || wallet.phase === 'fresh_launch' || wallet.phase === 'pre_migration')
    );
    const wouldEnter = Boolean(qualifyingFirstTouch);
    if (wouldEnter) {
      if (this.walletRelaxedShadowEnterSeen.has(key)) return;
      this.walletRelaxedShadowEnterSeen.add(key);
    } else {
      if (this.walletRelaxedShadowSkipSeen.has(key)) return;
      this.walletRelaxedShadowSkipSeen.add(key);
    }
    this.telemetry.record(
      wouldEnter
        ? 'pre_migration_wallet_relaxed_shadow.would_enter'
        : 'pre_migration_wallet_relaxed_shadow.would_skip',
      {
        mode: 'report_only_wallet_relaxed_shadow',
        shadowProfile,
        mint,
        symbol: payload.symbol || null,
        timestamp: payload.timestamp || new Date().toISOString(),
        sourceDecision: payload.decision,
        sourceReason: payload.reason,
        sourcePreset: payload.preset || null,
        sourceLane: payload.lane || null,
        score: payload.score ?? null,
        curveProgress: payload.curveProgress ?? null,
        recentVolumeSol: payload.recentVolumeSol ?? null,
        tradeVelocityPerMin: payload.tradeVelocityPerMin ?? null,
        priceSol: payload.priceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? null,
        wouldEnter,
        shadowDecision: wouldEnter ? 'WOULD_ENTER' : 'WOULD_SKIP',
        shadowReason: wouldEnter ? 'TRACKED_FIRST_TOUCH_BUY' : 'NO_TRACKED_FIRST_TOUCH_BUY',
        qualifyingFirstTouch: qualifyingFirstTouch ? {
          wallet: qualifyingFirstTouch.wallet || null,
          name: qualifyingFirstTouch.name || null,
          reviewTier: qualifyingFirstTouch.reviewTier || null,
          evidenceTier: qualifyingFirstTouch.evidenceTier || null,
          label: qualifyingFirstTouch.label || null,
          side: qualifyingFirstTouch.side || null,
          phase: qualifyingFirstTouch.phase || null,
          tradeAt: qualifyingFirstTouch.tradeAt || null,
          curveProgress: qualifyingFirstTouch.curveProgress ?? null,
          solAmount: qualifyingFirstTouch.solAmount ?? null,
          positiveOrProven: isPositiveOrProven(qualifyingFirstTouch),
          avoidOrNegative: qualifyingFirstTouch.reviewTier === 'AVOID_REVIEW' || qualifyingFirstTouch.evidenceTier === 'NEGATIVE_EVIDENCE'
        } : null,
        positiveFirstTouch: positiveFirstTouch ? {
          wallet: positiveFirstTouch.wallet || null,
          name: positiveFirstTouch.name || null,
          reviewTier: positiveFirstTouch.reviewTier || null,
          evidenceTier: positiveFirstTouch.evidenceTier || null,
          label: positiveFirstTouch.label || null,
          side: positiveFirstTouch.side || null,
          phase: positiveFirstTouch.phase || null,
          tradeAt: positiveFirstTouch.tradeAt || null,
          curveProgress: positiveFirstTouch.curveProgress ?? null,
          solAmount: positiveFirstTouch.solAmount ?? null
        } : null,
        walletTouchCount: sortedWallets.length,
        walletContextSource: context.contextSource || null,
        earliestWalletTouchAt: context.earliestTouchAt || null,
        earliestWalletBuyAt: context.earliestBuyAt || null,
        positiveOrProvenTouchCount: sortedWallets.filter(isPositiveOrProven).length,
        avoidTouchCount: avoidTouches.length,
        walletSummary: sortedWallets.slice(0, 8).map((wallet) => ({
          wallet: wallet.wallet || null,
          name: wallet.name || null,
          reviewTier: wallet.reviewTier || null,
          evidenceTier: wallet.evidenceTier || null,
          label: wallet.label || null,
          side: wallet.side || null,
          phase: wallet.phase || null,
          tradeAt: wallet.tradeAt || null,
          curveProgress: wallet.curveProgress ?? null,
          solAmount: wallet.solAmount ?? null
        }))
      }
    );
  }

  maybeRecordCurveFalseNegativeShadowDecision(event) {
    if (this.config.preMigrationCurveFalseNegativeShadowEnabled === false) {
      return;
    }
    if (
      event?.telemetryType !== 'pre_migration_paper.decision'
      || event.payload?.decision !== 'PAPER_SKIPPED'
      || event.payload?.reason !== 'CURVE_NOT_ADVANCING'
    ) {
      return;
    }

    const payload = event.payload || {};
    const mint = payload.mint;
    if (!mint) return;

    const shadowProfile = 'curve_false_negative_ex_ante_watch';
    const score = Number(payload.score);
    const curveProgress = Number(payload.curveProgress);
    const recentVolumeSol = Number(payload.recentVolumeSol);
    const tradeVelocityPerMin = Number(payload.tradeVelocityPerMin);
    const buyRatio = Number(payload.buyRatio);
    const uniqueBuyerCount = Number(payload.uniqueBuyerCount);
    const curveProgressDelta = Number(payload.curveProgressDelta);
    const threshold = Number(payload.threshold);
    const readinessPct = Number.isFinite(curveProgressDelta) && Number.isFinite(threshold) && threshold > 0
      ? Math.max(0, Math.min(1, curveProgressDelta / threshold)) * 100
      : null;

    const context = payload.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets : [];
    const positiveWalletTouches = wallets.filter((wallet) => (
      ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(wallet.evidenceTier)
      || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(wallet.reviewTier)
    ));
    const avoidWalletTouches = wallets.filter((wallet) => (
      wallet.reviewTier === 'AVOID_REVIEW' || wallet.evidenceTier === 'NEGATIVE_EVIDENCE'
    ));

    const matchedFilters = [];
    if (Number.isFinite(score) && score >= 60) matchedFilters.push('score_ge_60');
    if (Number.isFinite(curveProgress) && curveProgress >= 0.5) matchedFilters.push('curve_ge_50');
    if (Number.isFinite(recentVolumeSol) && recentVolumeSol >= 12) matchedFilters.push('volume_ge_12');
    if (Number.isFinite(recentVolumeSol) && recentVolumeSol >= 50) matchedFilters.push('volume_ge_50');
    if (Number.isFinite(score) && score >= 50 && Number.isFinite(curveProgress) && curveProgress >= 0.3) {
      matchedFilters.push('score_ge_50_curve_ge_30');
    }
    if (Number.isFinite(score) && score >= 60 && Number.isFinite(curveProgress) && curveProgress >= 0.5) {
      matchedFilters.push('score_ge_60_curve_ge_50');
    }
    if (positiveWalletTouches.length > 0) matchedFilters.push('positive_wallet_touch');
    if (avoidWalletTouches.length === 0) matchedFilters.push('no_avoid_wallet_touch');

    const strongFilter = matchedFilters.some((filter) => [
      'score_ge_60',
      'curve_ge_50',
      'volume_ge_12',
      'volume_ge_50',
      'score_ge_50_curve_ge_30',
      'score_ge_60_curve_ge_50',
      'positive_wallet_touch'
    ].includes(filter));
    const blockedByAvoid = avoidWalletTouches.length > 0;
    const wouldWatch = strongFilter && !blockedByAvoid;
    const narrowCore = Number.isFinite(score) && score >= 50 && Number.isFinite(curveProgress) && curveProgress >= 0.3;
    const narrowCoreVolume = narrowCore && Number.isFinite(recentVolumeSol) && recentVolumeSol >= 12;
    const narrowCorePositiveWallet = narrowCore && positiveWalletTouches.length > 0;
    if (narrowCore) matchedFilters.push('narrow_core_score50_curve30');
    if (narrowCoreVolume) matchedFilters.push('narrow_core_score50_curve30_volume12');
    if (narrowCorePositiveWallet) matchedFilters.push('narrow_core_score50_curve30_positive_wallet');
    const shadowTier = narrowCorePositiveWallet
      ? 'NARROW_CORE_POSITIVE_WALLET'
      : narrowCoreVolume
        ? 'NARROW_CORE_VOLUME'
        : narrowCore
          ? 'NARROW_CORE'
          : wouldWatch
            ? 'BROAD_WATCH'
            : 'SKIP';
    const key = `${shadowProfile}:${mint}`;

    if (wouldWatch) {
      if (this.curveFalseNegativeShadowWatchSeen.has(key)) return;
      this.curveFalseNegativeShadowWatchSeen.add(key);
    } else {
      if (this.curveFalseNegativeShadowSkipSeen.has(key)) return;
      this.curveFalseNegativeShadowSkipSeen.add(key);
    }

    this.telemetry.record(
      wouldWatch
        ? 'pre_migration_curve_false_negative_shadow.would_watch'
        : 'pre_migration_curve_false_negative_shadow.would_skip',
      {
        mode: 'report_only_curve_false_negative_shadow',
        shadowProfile,
        mint,
        symbol: payload.symbol || null,
        timestamp: payload.timestamp || new Date().toISOString(),
        sourceDecision: payload.decision,
        sourceReason: payload.reason,
        sourcePreset: payload.preset || null,
        sourceLane: payload.lane || null,
        score: Number.isFinite(score) ? Number(score.toFixed(2)) : null,
        curveProgress: Number.isFinite(curveProgress) ? Number(curveProgress.toFixed(6)) : null,
        curveProgressDelta: Number.isFinite(curveProgressDelta) ? Number(curveProgressDelta.toFixed(6)) : null,
        threshold: Number.isFinite(threshold) ? Number(threshold.toFixed(6)) : null,
        readinessPct: Number.isFinite(readinessPct) ? Number(readinessPct.toFixed(2)) : null,
        recentVolumeSol: Number.isFinite(recentVolumeSol) ? Number(recentVolumeSol.toFixed(4)) : null,
        tradeVelocityPerMin: Number.isFinite(tradeVelocityPerMin) ? Number(tradeVelocityPerMin.toFixed(2)) : null,
        buyRatio: Number.isFinite(buyRatio) ? Number(buyRatio.toFixed(4)) : null,
        uniqueBuyerCount: Number.isFinite(uniqueBuyerCount) ? uniqueBuyerCount : null,
        priceSol: payload.priceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? null,
        wouldWatch,
        shadowDecision: wouldWatch ? 'WOULD_WATCH' : 'WOULD_SKIP',
        shadowReason: wouldWatch ? 'EX_ANTE_CURVE_FALSE_NEGATIVE_FILTER_MATCH' : 'NO_EX_ANTE_CURVE_FALSE_NEGATIVE_FILTER_MATCH',
        matchedFilters,
        strongFilter,
        blockedByAvoid,
        narrowCore,
        narrowCoreVolume,
        narrowCorePositiveWallet,
        shadowTier,
        walletTouchCount: wallets.length,
        positiveWalletTouchCount: positiveWalletTouches.length,
        avoidWalletTouchCount: avoidWalletTouches.length,
        positiveWalletTouches: positiveWalletTouches.slice(0, 3).map((wallet) => ({
          wallet: wallet.wallet || null,
          name: wallet.name || null,
          reviewTier: wallet.reviewTier || null,
          evidenceTier: wallet.evidenceTier || null,
          side: wallet.side || null,
          phase: wallet.phase || null,
          tradeAt: wallet.tradeAt || null,
          curveProgress: wallet.curveProgress ?? null
        })),
        avoidWalletTouches: avoidWalletTouches.slice(0, 3).map((wallet) => ({
          wallet: wallet.wallet || null,
          name: wallet.name || null,
          reviewTier: wallet.reviewTier || null,
          evidenceTier: wallet.evidenceTier || null,
          side: wallet.side || null,
          phase: wallet.phase || null,
          tradeAt: wallet.tradeAt || null,
          curveProgress: wallet.curveProgress ?? null
        }))
      }
    );
  }

  maybeRecordCurveConfirmationShadowDecision(event) {
    if (this.config.preMigrationCurveConfirmationShadowEnabled === false) {
      return;
    }
    if (
      event?.telemetryType !== 'pre_migration_paper.decision'
      || event.payload?.decision !== 'PAPER_SKIPPED'
      || event.payload?.reason !== 'CURVE_NOT_ADVANCING'
    ) {
      return;
    }

    const payload = event.payload || {};
    const mint = payload.mint;
    if (!mint) return;

    const nowMs = this.timestampMs(payload.timestamp) || Date.now();
    this.expireCurveConfirmationShadow(nowMs);

    const minScore = Number(this.config.preMigrationCurveConfirmationShadowMinScore ?? 75);
    const lookaheadMs = Math.max(1000, Number(this.config.preMigrationCurveConfirmationShadowLookaheadMs ?? 120000));
    const minCurveDelta = Number(this.config.preMigrationCurveConfirmationShadowMinCurveDelta ?? 0.03);
    const minSourceCurveProgress = Number(this.config.preMigrationCurveConfirmationShadowMinSourceCurveProgress ?? 0.5);
    const maxSourceCurveProgress = Number(this.config.preMigrationCurveConfirmationShadowMaxSourceCurveProgress ?? 0.95);
    const minConfirmCurveProgress = Number(this.config.preMigrationCurveConfirmationShadowMinConfirmCurveProgress ?? 0.75);
    const minRecentVolumeSol = Number(this.config.preMigrationCurveConfirmationShadowMinRecentVolumeSol ?? 12);
    const minTradeVelocityPerMin = Number(this.config.preMigrationCurveConfirmationShadowMinTradeVelocityPerMin ?? 12);
    const requireNoAvoidWallet = this.config.preMigrationCurveConfirmationShadowRequireNoAvoidWallet !== false;
    const requireNoRiskWallet = this.config.preMigrationCurveConfirmationShadowRequireNoRiskWallet === true;
    const maxSniperWallets = Number(this.config.preMigrationCurveConfirmationShadowMaxSniperWallets ?? 8);
    const maxTracked = Math.max(1, Number(this.config.preMigrationCurveConfirmationShadowMaxTrackedMints ?? 500));
    const score = Number(payload.score);
    const curveProgress = Number(payload.curveProgress);
    const recentVolumeSol = Number(payload.recentVolumeSol);
    const tradeVelocityPerMin = Number(payload.tradeVelocityPerMin);
    if (
      !Number.isFinite(score)
      || score < minScore
      || !Number.isFinite(curveProgress)
      || curveProgress < minSourceCurveProgress
      || curveProgress > maxSourceCurveProgress
      || !Number.isFinite(recentVolumeSol)
      || recentVolumeSol < minRecentVolumeSol
      || !Number.isFinite(tradeVelocityPerMin)
      || tradeVelocityPerMin < minTradeVelocityPerMin
    ) {
      return;
    }

    const context = payload.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets : [];
    const shadowWallets = Array.isArray(context.shadowWallets) ? context.shadowWallets : [];
    const avoidWalletContext = [...wallets, ...shadowWallets];
    const positiveWalletTouches = wallets.filter((wallet) => (
      ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(wallet.evidenceTier)
      || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(wallet.reviewTier)
    ));
    const avoidWalletTouches = avoidWalletContext.filter((wallet) => (
      wallet.reviewTier === 'AVOID_REVIEW' || wallet.evidenceTier === 'NEGATIVE_EVIDENCE'
    ));
    const riskWalletCount = Number(payload.riskWalletCount || 0);
    const sniperWalletCount = Number(payload.sniperWalletCount);
    const sniperWalletGuardPassed = !Number.isFinite(maxSniperWallets)
      || maxSniperWallets < 0
      || !Number.isFinite(sniperWalletCount)
      || sniperWalletCount <= maxSniperWallets;
    if (
      (requireNoAvoidWallet && avoidWalletTouches.length > 0)
      || (requireNoRiskWallet && riskWalletCount > 0)
      || !sniperWalletGuardPassed
    ) {
      return;
    }

    const shadowProfile = `delayed_paper_equivalent_delta${String(minCurveDelta).replace(/^0\./, '').replace('.', '')}_${Math.round(lookaheadMs / 1000)}_score${Math.round(minScore)}_curve${Math.round(minConfirmCurveProgress * 100)}`;
    const key = `${shadowProfile}:${mint}`;
    if (this.curveConfirmationShadowPending.has(key)
      || this.curveConfirmationShadowEnterSeen.has(key)
      || this.curveConfirmationShadowSkipSeen.has(key)) {
      return;
    }

    if (this.curveConfirmationShadowPending.size >= maxTracked) {
      const oldestKey = this.curveConfirmationShadowPending.keys().next().value;
      const oldest = this.curveConfirmationShadowPending.get(oldestKey);
      this.recordCurveConfirmationShadowSkip(oldest, nowMs, 'MAX_TRACKED_EVICTION');
      this.curveConfirmationShadowPending.delete(oldestKey);
    }

    this.curveConfirmationShadowPending.set(key, {
      key,
      shadowProfile,
      mint,
      symbol: payload.symbol || null,
      sourceAtMs: nowMs,
      sourceAt: new Date(nowMs).toISOString(),
      expiresAtMs: nowMs + lookaheadMs,
      lookaheadMs,
      minScore,
      minCurveDelta,
      minSourceCurveProgress,
      maxSourceCurveProgress,
      minConfirmCurveProgress,
      minRecentVolumeSol,
      minTradeVelocityPerMin,
      requireNoAvoidWallet,
      requireNoRiskWallet,
      maxSniperWallets,
      sourceDecision: payload.decision,
      sourceReason: payload.reason,
      sourcePreset: payload.preset || null,
      sourceLane: payload.lane || null,
      score,
      curveProgress,
      curveProgressDelta: Number(payload.curveProgressDelta),
      threshold: Number(payload.threshold),
      recentVolumeSol,
      tradeVelocityPerMin,
      buyRatio: Number(payload.buyRatio),
      uniqueBuyerCount: Number(payload.uniqueBuyerCount),
      riskWalletCount,
      sniperWalletCount,
      priceSol: payload.priceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? null,
      walletTouchCount: wallets.length,
      shadowWalletTouchCount: shadowWallets.length,
      positiveWalletTouchCount: positiveWalletTouches.length,
      avoidWalletTouchCount: avoidWalletTouches.length,
      noAvoidWalletTouch: avoidWalletTouches.length === 0,
      walletContextSource: context.contextSource || null
    });
  }

  maybeUpdateCurveConfirmationShadow(event) {
    if (
      this.config.preMigrationCurveConfirmationShadowEnabled === false
      || this.curveConfirmationShadowPending.size === 0
    ) {
      return;
    }

    const payload = event?.payload || event || {};
    const mint = payload.mint || payload.token || payload.mintAddress || payload.address || null;
    const curveProgress = this.curveProgressFromPayload(payload);
    const atMs = this.timestampMs(payload.timestamp || event?.timestamp) || Date.now();
    this.expireCurveConfirmationShadow(atMs);
    if (!mint || !Number.isFinite(curveProgress)) {
      return;
    }

    for (const [key, pending] of Array.from(this.curveConfirmationShadowPending.entries())) {
      if (pending.mint !== mint) continue;
      if (atMs <= pending.sourceAtMs) continue;
      if (atMs > pending.expiresAtMs) {
        this.recordCurveConfirmationShadowSkip(pending, atMs, 'NO_CURVE_CONFIRMATION_WITHIN_WINDOW');
        this.curveConfirmationShadowPending.delete(key);
        continue;
      }
      const delta = curveProgress - pending.curveProgress;
      if (!Number.isFinite(delta) || delta < pending.minCurveDelta) {
        continue;
      }
      if (Number.isFinite(Number(pending.minConfirmCurveProgress)) && curveProgress < Number(pending.minConfirmCurveProgress)) {
        continue;
      }
      this.recordCurveConfirmationShadowEnter(pending, {
        atMs,
        curveProgress,
        priceSol: this.priceSolFromPayload(payload),
        telemetryType: event?.telemetryType || event?.type || null,
        delta
      });
      this.curveConfirmationShadowPending.delete(key);
    }
  }

  expireCurveConfirmationShadow(nowMs = Date.now()) {
    if (this.curveConfirmationShadowPending.size === 0) {
      return;
    }
    for (const [key, pending] of Array.from(this.curveConfirmationShadowPending.entries())) {
      if (nowMs <= pending.expiresAtMs) continue;
      this.recordCurveConfirmationShadowSkip(pending, nowMs, 'NO_CURVE_CONFIRMATION_WITHIN_WINDOW');
      this.curveConfirmationShadowPending.delete(key);
    }
  }

  recordCurveConfirmationShadowEnter(pending, confirmation = {}) {
    if (!pending || this.curveConfirmationShadowEnterSeen.has(pending.key)) {
      return;
    }
    this.curveConfirmationShadowEnterSeen.add(pending.key);
    const confirmAtMs = confirmation.atMs || Date.now();
    const confirmCurveProgress = Number(confirmation.curveProgress);
    const delta = Number.isFinite(Number(confirmation.delta))
      ? Number(confirmation.delta)
      : confirmCurveProgress - pending.curveProgress;
    this.telemetry.record('pre_migration_curve_confirmation_shadow.would_enter', {
      ...this.curveConfirmationShadowBasePayload(pending),
      timestamp: new Date(confirmAtMs).toISOString(),
      wouldEnter: true,
      shadowDecision: 'WOULD_ENTER',
      shadowReason: 'DELAYED_CURVE_CONFIRMATION',
      confirmationTelemetryType: confirmation.telemetryType || null,
      confirmedAt: new Date(confirmAtMs).toISOString(),
      secondsToConfirm: this.roundNumber((confirmAtMs - pending.sourceAtMs) / 1000, 3),
      confirmCurveProgress: this.roundNumber(confirmCurveProgress, 6),
      confirmPriceSol: this.roundNumber(confirmation.priceSol, 12),
      curveProgressDeltaFromSource: this.roundNumber(delta, 6)
    });
  }

  recordCurveConfirmationShadowSkip(pending, atMs = Date.now(), reason = 'NO_CURVE_CONFIRMATION_WITHIN_WINDOW') {
    if (!pending || this.curveConfirmationShadowSkipSeen.has(pending.key) || this.curveConfirmationShadowEnterSeen.has(pending.key)) {
      return;
    }
    this.curveConfirmationShadowSkipSeen.add(pending.key);
    this.telemetry.record('pre_migration_curve_confirmation_shadow.would_skip', {
      ...this.curveConfirmationShadowBasePayload(pending),
      timestamp: new Date(atMs).toISOString(),
      wouldEnter: false,
      shadowDecision: 'WOULD_SKIP',
      shadowReason: reason,
      expiredAt: new Date(atMs).toISOString()
    });
  }

  curveConfirmationShadowBasePayload(pending) {
    return {
      mode: 'report_only_curve_confirmation_shadow',
      shadowProfile: pending.shadowProfile,
      mint: pending.mint,
      symbol: pending.symbol || null,
      sourceDecision: pending.sourceDecision,
      sourceReason: pending.sourceReason,
      sourcePreset: pending.sourcePreset,
      sourceLane: pending.sourceLane,
      sourceAt: pending.sourceAt,
      lookaheadMs: pending.lookaheadMs,
      minScore: pending.minScore,
      minCurveDelta: this.roundNumber(pending.minCurveDelta, 6),
      minSourceCurveProgress: this.roundNumber(pending.minSourceCurveProgress, 6),
      maxSourceCurveProgress: this.roundNumber(pending.maxSourceCurveProgress, 6),
      minConfirmCurveProgress: this.roundNumber(pending.minConfirmCurveProgress, 6),
      minRecentVolumeSol: this.roundNumber(pending.minRecentVolumeSol, 4),
      minTradeVelocityPerMin: this.roundNumber(pending.minTradeVelocityPerMin, 2),
      score: this.roundNumber(pending.score, 2),
      curveProgress: this.roundNumber(pending.curveProgress, 6),
      curveProgressDelta: this.roundNumber(pending.curveProgressDelta, 6),
      threshold: this.roundNumber(pending.threshold, 6),
      recentVolumeSol: this.roundNumber(pending.recentVolumeSol, 4),
      tradeVelocityPerMin: this.roundNumber(pending.tradeVelocityPerMin, 2),
      buyRatio: this.roundNumber(pending.buyRatio, 4),
      uniqueBuyerCount: Number.isFinite(pending.uniqueBuyerCount) ? pending.uniqueBuyerCount : null,
      riskWalletCount: Number.isFinite(pending.riskWalletCount) ? pending.riskWalletCount : null,
      sniperWalletCount: Number.isFinite(pending.sniperWalletCount) ? pending.sniperWalletCount : null,
      maxSniperWallets: Number.isFinite(pending.maxSniperWallets) ? pending.maxSniperWallets : null,
      requireNoAvoidWallet: pending.requireNoAvoidWallet,
      requireNoRiskWallet: pending.requireNoRiskWallet,
      priceSol: this.roundNumber(pending.priceSol, 12),
      walletTouchCount: pending.walletTouchCount,
      shadowWalletTouchCount: pending.shadowWalletTouchCount,
      positiveWalletTouchCount: pending.positiveWalletTouchCount,
      avoidWalletTouchCount: pending.avoidWalletTouchCount,
      noAvoidWalletTouch: pending.noAvoidWalletTouch,
      walletContextSource: pending.walletContextSource
    };
  }

  curveProgressFromPayload(payload = {}) {
    const raw = payload.providerCurveProgress
      ?? payload.curveProgress
      ?? payload.bondingCurveProgress
      ?? payload.progress
      ?? payload.market?.maxCurveProgress;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return value > 1 && value <= 100 ? value / 100 : value;
  }

  priceSolFromPayload(payload = {}) {
    const raw = payload.providerCurvePriceSol
      ?? payload.bondingCurvePriceSol
      ?? payload.curvePriceSol
      ?? payload.priceSol
      ?? payload.market?.priceSol;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  timestampMs(value) {
    const ms = new Date(value || 0).getTime();
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  }

  roundNumber(value, digits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return Number(number.toFixed(digits));
  }

  maybeSchedulePumpDevTargetedCurveParitySampleFromPaperEvent(event) {
    if (!event?.payload) {
      return;
    }

    const payload = event.payload;
    const telemetryType = event.telemetryType || '';
    const decision = payload.decision || null;
    const reason = payload.reason || payload.skipReason || null;
    const score = Number(payload.entryScore ?? payload.score);
    const curve = Number(payload.entryCurveProgress ?? payload.curveProgress);
    let trigger = null;

    if (telemetryType.startsWith('pre_migration_curve_false_negative_recovery_shadow.')) {
      const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks : [];
      const needsParity = failedChecks.includes('CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_MISSING_ONCHAIN_CURVE_PARITY')
        || failedChecks.includes('CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_CURVE_PARITY_MISMATCH')
        || payload.curveParity?.passed !== true;
      if (needsParity) {
        trigger = `recovery_shadow:${reason || decision || 'unknown'}`;
      }
    } else if (!telemetryType.startsWith('pre_migration_paper.')) {
      return;
    } else if (event.type === 'entry' || telemetryType === 'pre_migration_paper.entry') {
      trigger = 'actual_entry';
    } else if (
      this.config.pumpDevTargetedCurveParitySampleEligibleEnabled
      && (decision === 'PAPER_ELIGIBLE' || decision === 'PAPER_SHADOWED')
    ) {
      trigger = 'eligible_or_shadowed';
    } else if (this.config.pumpDevTargetedCurveParitySampleSkipsEnabled && decision === 'PAPER_SKIPPED') {
      const interestingSkip = (
        reason === 'RECENT_BAD_EXIT_COOLDOWN'
        || (Number.isFinite(curve) && curve >= 0.8)
        || (Number.isFinite(score) && score >= 80)
        || (
          ['LOW_SCORE', 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE', 'NO_PRIOR_CURVE_PROGRESS'].includes(reason)
          && Number.isFinite(curve)
          && curve >= 0.75
        )
      );
      if (interestingSkip) {
        trigger = `interesting_skip:${reason || 'unknown'}`;
      }
    }

    if (!trigger) {
      return;
    }

    this.maybeSchedulePumpDevTargetedCurveParitySample(trigger, payload, {
      source: telemetryType.startsWith('pre_migration_curve_false_negative_recovery_shadow.')
        ? 'pre_migration_curve_false_negative_recovery_shadow'
        : 'pre_migration_paper',
      decision,
      reason,
      preset: payload.preset || null,
      lane: payload.lane || null,
      reasons: Array.isArray(payload.reasons) ? payload.reasons : []
    });
  }

  maybeSchedulePumpDevTargetedCurveParitySample(trigger, state = {}, meta = {}) {
    if (
      this.config.pumpDevTargetedCurveParityEnabled === false
      || !this.active
      || !this.pumpBondingCurveLane?.enabled
    ) {
      return false;
    }

    const maxSamples = Number(this.config.pumpDevTargetedCurveParityMaxSamplesPerRun ?? 25);
    if (maxSamples <= 0 || this.pumpDevTargetedCurveParitySampleCount >= maxSamples) {
      return false;
    }

    const mint = state.mint || state.token || state.mintAddress;
    if (!mint) {
      return false;
    }

    const now = Date.now();
    const cooldownMs = Number(this.config.pumpDevTargetedCurveParityCooldownMs ?? 300000);
    const lastSampleAt = Number(this.pumpDevTargetedCurveParityLastSampleAt.get(mint) || 0);
    if (cooldownMs > 0 && now - lastSampleAt < cooldownMs) {
      return false;
    }

    const maxInFlight = Math.max(1, Number(this.config.pumpDevTargetedCurveParityMaxInFlight ?? 1));
    if (this.pumpDevTargetedCurveParityInFlight.size >= maxInFlight) {
      this.recordPumpDevTargetedCurveParitySkipped(mint, trigger, 'IN_FLIGHT_LIMIT', {
        inFlight: this.pumpDevTargetedCurveParityInFlight.size,
        maxInFlight
      });
      return false;
    }

    const providerCurveProgress = this.extractProviderCurveProgressForParity(state);
    if (!Number.isFinite(providerCurveProgress)) {
      return false;
    }

    const providerPriceSol = this.extractProviderPriceForParity(state);
    const providerAt = state.providerCurveSnapshotAt
      || state.lastCurveUpdateAt
      || state.bondingCurveLastFetchAt
      || state.timestamp
      || new Date(now).toISOString();

    this.pumpDevTargetedCurveParityLastSampleAt.set(mint, now);
    this.pumpDevTargetedCurveParityInFlight.add(mint);
    this.pumpDevTargetedCurveParitySampleCount += 1;
    const scheduledAtMs = now;
    const scheduledAtIso = new Date(scheduledAtMs).toISOString();

    const tokenMeta = {
      ...(this.latestPumpPortalTokens.get(mint) || {}),
      ...(state || {}),
      mint,
      source: state.source || meta.source || 'pumpdev_targeted_curve_parity'
    };
    const expectedBondingCurveAddress = this.pumpBondingCurveLane.safeDeriveBondingCurveAddress?.(mint) || null;
    const providerBondingCurveAddress = state.bondingCurveAddress || state.bondingCurveKey || null;

    this.telemetry.record('pumpdev.targeted_curve_parity_scheduled', {
      mint,
      symbol: state.symbol || null,
      trigger,
      providerAt,
      scheduledAt: scheduledAtIso,
      providerCurveProgress: Number(providerCurveProgress.toFixed(6)),
      providerPriceSol: Number.isFinite(providerPriceSol) ? Number(providerPriceSol.toFixed(12)) : null,
      score: Number.isFinite(Number(state.entryScore ?? state.score)) ? Number(Number(state.entryScore ?? state.score).toFixed(2)) : null,
      source: meta.source || null,
      decision: meta.decision || null,
      reason: meta.reason || null,
      preset: meta.preset || null,
      lane: meta.lane || null,
      sampleIndex: this.pumpDevTargetedCurveParitySampleCount,
      maxSamples
    });

    let settled = false;
    const timeoutMs = Math.max(1000, Number(this.config.pumpDevTargetedCurveParityTimeoutMs ?? 15000));
    const timeoutDueAtMs = scheduledAtMs + timeoutMs;
    const timeoutDueAtIso = new Date(timeoutDueAtMs).toISOString();
    const finish = (callback) => {
      if (settled) {
        return false;
      }
      settled = true;
      this.pumpDevTargetedCurveParityInFlight.delete(mint);
      callback();
      return true;
    };
    const timeout = setTimeout(() => {
      finish(() => {
        this.telemetry.record('pumpdev.targeted_curve_parity_sample', {
          mint,
          symbol: state.symbol || null,
          trigger,
          source: meta.source || null,
          decision: meta.decision || null,
          reason: meta.reason || null,
          preset: meta.preset || null,
          lane: meta.lane || null,
          scheduledAt: scheduledAtIso,
          providerAt,
          providerCurveProgress: Number(providerCurveProgress.toFixed(6)),
          providerPriceSol: Number.isFinite(providerPriceSol) ? Number(providerPriceSol.toFixed(12)) : null,
          onchainFetchedAt: null,
          accountFound: false,
          invalidAccountData: false,
          complete: false,
          onchainBondingStage: null,
          onchainCurveProgress: null,
          onchainPriceSol: null,
          curveDelta: null,
          absCurveDelta: null,
          priceDeltaPct: null,
          absPriceDeltaPct: null,
          bondingCurveAddress: expectedBondingCurveAddress,
          expectedBondingCurveAddress,
          providerBondingCurveAddress,
          bondingCurveValidated: false,
          bondingCurveValidationReason: 'TARGETED_PARITY_TIMEOUT',
          bondingCurveAccountOwner: null,
          timedOut: true,
          timeoutDueAt: timeoutDueAtIso,
          timeoutLagMs: Math.max(0, Date.now() - timeoutDueAtMs),
          latencyMs: Date.now() - scheduledAtMs,
          error: `TARGETED_PARITY_TIMEOUT_${timeoutMs}MS`
        });
        this.logger.warn('PumpDev targeted curve parity sample timed out', {
          mint,
          trigger,
          timeoutMs
        });
      });
    }, timeoutMs);

    this.pumpBondingCurveLane.observeMint(mint, tokenMeta, {
      forceRefresh: true,
      bypassFailureCooldown: true,
      bypassGlobalBackoff: true
    }).then((summary) => {
      finish(() => {
        clearTimeout(timeout);
        this.recordPumpDevTargetedCurveParitySample({
          mint,
          state,
          meta,
          trigger,
          providerAt,
          scheduledAt: scheduledAtIso,
          scheduledAtMs,
          providerCurveProgress,
          providerPriceSol,
          summary
        });
      });
    }).catch((error) => {
      finish(() => {
        clearTimeout(timeout);
        this.telemetry.record('pumpdev.targeted_curve_parity_sample', {
          mint,
          symbol: state.symbol || null,
          trigger,
          source: meta.source || null,
          decision: meta.decision || null,
          reason: meta.reason || null,
          preset: meta.preset || null,
          lane: meta.lane || null,
          scheduledAt: scheduledAtIso,
          providerAt,
          providerCurveProgress: Number(providerCurveProgress.toFixed(6)),
          providerPriceSol: Number.isFinite(providerPriceSol) ? Number(providerPriceSol.toFixed(12)) : null,
          onchainFetchedAt: new Date().toISOString(),
          accountFound: false,
          invalidAccountData: false,
          complete: false,
          onchainBondingStage: null,
          onchainCurveProgress: null,
          onchainPriceSol: null,
          curveDelta: null,
          absCurveDelta: null,
          priceDeltaPct: null,
          absPriceDeltaPct: null,
          bondingCurveAddress: expectedBondingCurveAddress,
          expectedBondingCurveAddress,
          providerBondingCurveAddress,
          bondingCurveValidated: false,
          bondingCurveValidationReason: error.message || 'TARGETED_PARITY_FETCH_FAILED',
          bondingCurveAccountOwner: null,
          timedOut: false,
          latencyMs: Date.now() - scheduledAtMs,
          error: error.message
        });
        this.logger.warn('PumpDev targeted curve parity sample failed', {
          mint,
          trigger,
          error: error.message
        });
      });
    });

    return true;
  }

  recordPumpDevTargetedCurveParitySkipped(mint, trigger, reason, extra = {}) {
    if (!this.telemetry) {
      return;
    }

    const now = Date.now();
    const cooldownMs = Math.max(1000, Number(this.config.pumpDevTargetedCurveParitySkipLogCooldownMs ?? 10000));
    const key = `${mint || 'unknown'}:${trigger || 'unknown'}:${reason || 'unknown'}`;
    const lastAt = Number(this.pumpDevTargetedCurveParitySkipLogLastAt.get(key) || 0);
    if (now - lastAt < cooldownMs) {
      return;
    }

    this.pumpDevTargetedCurveParitySkipLogLastAt.set(key, now);
    this.telemetry.record('pumpdev.targeted_curve_parity_skipped', {
      mint,
      trigger,
      reason,
      ...extra
    });
  }

  recordPumpDevTargetedCurveParitySample({
    mint,
    state,
    meta,
    trigger,
    providerAt,
    scheduledAt,
    scheduledAtMs,
    providerCurveProgress,
    providerPriceSol,
    summary
  }) {
    const parseFiniteOrNull = (value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    const rawOnchainCurveProgress = parseFiniteOrNull(summary?.curveProgress);
    const rawOnchainCurveProgressByVirtualTokenReserves = parseFiniteOrNull(summary?.curveProgressByVirtualTokenReserves);
    const rawOnchainCurveProgressByRealTokenSupply = parseFiniteOrNull(summary?.curveProgressByRealTokenSupply);
    const rawOnchainPriceSol = parseFiniteOrNull(summary?.priceSol);
    const fetchAtMs = Date.parse(summary?.lastFetchAt || '');
    const fetchLatencyMs = parseFiniteOrNull(summary?.fetchLatencyMs);
    const maxComparableLatencyMs = Math.max(1000, Number(this.config.pumpDevTargetedCurveParityMaxComparableLatencyMs ?? 2500));
    const expectedBondingCurveAddress = this.pumpBondingCurveLane.safeDeriveBondingCurveAddress?.(mint) || null;
    const providerBondingCurveAddress = state.bondingCurveAddress || state.bondingCurveKey || null;
    const bondingCurveAddress = summary?.bondingCurveAddress || expectedBondingCurveAddress;
    const bondingCurveValidated = summary?.bondingCurveValidated === true;
    const bondingCurveValidationReason = summary?.bondingCurveValidationReason || (
      bondingCurveValidated ? 'OWNER_AND_DISCRIMINATOR_OK' : null
    );
    const freshFetch = summary?.refreshed === true
      && Number.isFinite(fetchAtMs)
      && (!Number.isFinite(scheduledAtMs) || fetchAtMs >= scheduledAtMs - 1000);
    const fastEnoughFetch = Number.isFinite(fetchLatencyMs)
      ? fetchLatencyMs <= maxComparableLatencyMs
      : true;
    const accountUsable = summary?.accountFound === true && summary?.invalidAccountData !== true;
    const hasComparableCurve = freshFetch && fastEnoughFetch && accountUsable && bondingCurveValidated && Number.isFinite(rawOnchainCurveProgress);
    const onchainCurveProgress = hasComparableCurve ? rawOnchainCurveProgress : null;
    const onchainCurveProgressByVirtualTokenReserves = hasComparableCurve && Number.isFinite(rawOnchainCurveProgressByVirtualTokenReserves)
      ? rawOnchainCurveProgressByVirtualTokenReserves
      : null;
    const virtualReserveCurveDelta = Number.isFinite(providerCurveProgress) && Number.isFinite(onchainCurveProgressByVirtualTokenReserves)
      ? onchainCurveProgressByVirtualTokenReserves - providerCurveProgress
      : null;
    const onchainPriceSol = Number.isFinite(rawOnchainPriceSol) && rawOnchainPriceSol > 0 ? rawOnchainPriceSol : null;
    const curveDelta = Number.isFinite(providerCurveProgress) && Number.isFinite(onchainCurveProgress)
      ? onchainCurveProgress - providerCurveProgress
      : null;
    const priceDeltaPct = Number.isFinite(providerPriceSol) && providerPriceSol > 0 && Number.isFinite(onchainPriceSol) && onchainPriceSol > 0
      ? ((providerPriceSol - onchainPriceSol) / onchainPriceSol) * 100
      : null;

    this.telemetry.record('pumpdev.targeted_curve_parity_sample', {
      mint,
      symbol: state.symbol || null,
      trigger,
      source: meta.source || null,
      decision: meta.decision || null,
      reason: meta.reason || null,
      preset: meta.preset || null,
      lane: meta.lane || null,
      scheduledAt,
      providerAt,
      providerCurveProgress: Number(providerCurveProgress.toFixed(6)),
      providerPriceSol: Number.isFinite(providerPriceSol) ? Number(providerPriceSol.toFixed(12)) : null,
      providerVirtualTokenReservesTokens: parseFiniteOrNull(state.virtualTokenReservesTokens),
      providerVirtualSolReservesSol: parseFiniteOrNull(state.virtualSolReservesSol),
      providerVirtualTokenReservesRaw: state.providerVirtualTokenReservesRaw ?? state.bondingCurveState?.providerVirtualTokenReservesRaw ?? null,
      providerVirtualQuoteReservesRaw: state.providerVirtualQuoteReservesRaw ?? state.bondingCurveState?.providerVirtualQuoteReservesRaw ?? null,
      providerVirtualSolReservesRaw: state.providerVirtualSolReservesRaw ?? state.bondingCurveState?.providerVirtualSolReservesRaw ?? null,
      onchainFetchedAt: summary?.lastFetchAt || new Date().toISOString(),
      onchainFetchStartedAt: summary?.lastFetchStartedAt || null,
      onchainFresh: freshFetch,
      onchainFetchLatencyMs: Number.isFinite(fetchLatencyMs) ? Number(fetchLatencyMs.toFixed(0)) : null,
      onchainComparableLatencyMs: maxComparableLatencyMs,
      refreshed: summary?.refreshed === true,
      accountFound: summary?.accountFound === true,
      invalidAccountData: summary?.invalidAccountData === true,
      complete: summary?.complete === true,
      onchainBondingStage: summary?.bondingStage || null,
      onchainCurveProgress: Number.isFinite(onchainCurveProgress) ? Number(onchainCurveProgress.toFixed(6)) : null,
      onchainCurveProgressByRealTokenSupply: Number.isFinite(rawOnchainCurveProgressByRealTokenSupply) ? Number(rawOnchainCurveProgressByRealTokenSupply.toFixed(6)) : null,
      onchainCurveProgressByVirtualTokenReserves: Number.isFinite(onchainCurveProgressByVirtualTokenReserves) ? Number(onchainCurveProgressByVirtualTokenReserves.toFixed(6)) : null,
      onchainPriceSol: Number.isFinite(onchainPriceSol) ? Number(onchainPriceSol.toFixed(12)) : null,
      curveDelta: Number.isFinite(curveDelta) ? Number(curveDelta.toFixed(6)) : null,
      absCurveDelta: Number.isFinite(curveDelta) ? Number(Math.abs(curveDelta).toFixed(6)) : null,
      virtualReserveCurveDelta: Number.isFinite(virtualReserveCurveDelta) ? Number(virtualReserveCurveDelta.toFixed(6)) : null,
      virtualReserveAbsCurveDelta: Number.isFinite(virtualReserveCurveDelta) ? Number(Math.abs(virtualReserveCurveDelta).toFixed(6)) : null,
      priceDeltaPct: Number.isFinite(priceDeltaPct) ? Number(priceDeltaPct.toFixed(4)) : null,
      absPriceDeltaPct: Number.isFinite(priceDeltaPct) ? Number(Math.abs(priceDeltaPct).toFixed(4)) : null,
      onchainVirtualTokenReservesTokens: parseFiniteOrNull(summary?.virtualTokenReservesTokens),
      onchainVirtualSolReservesSol: parseFiniteOrNull(summary?.virtualSolReservesSol),
      onchainRealSolReservesSol: parseFiniteOrNull(summary?.realSolReservesSol),
      onchainVirtualTokenReservesRaw: summary?.virtualTokenReserves ?? null,
      onchainVirtualSolReservesRaw: summary?.virtualSolReserves ?? null,
      onchainRealTokenReservesRaw: summary?.realTokenReserves ?? null,
      onchainRealSolReservesRaw: summary?.realSolReserves ?? null,
      onchainTokenTotalSupplyRaw: summary?.tokenTotalSupply ?? null,
      bondingCurveAddress,
      expectedBondingCurveAddress,
      providerBondingCurveAddress,
      bondingCurveValidated,
      bondingCurveValidationReason,
      bondingCurveAccountOwner: summary?.bondingCurveAccountOwner || null,
      timedOut: false,
      latencyMs: Number.isFinite(scheduledAtMs) ? Date.now() - scheduledAtMs : null,
      lastErrorMessage: hasComparableCurve
        ? null
        : summary?.lastErrorMessage
          || (!freshFetch ? 'STALE_OR_UNREFRESHED_ONCHAIN_SAMPLE' : null)
          || (!fastEnoughFetch ? `SLOW_ONCHAIN_SAMPLE_${Number(fetchLatencyMs || 0).toFixed(0)}MS` : null)
          || (!bondingCurveValidated ? (bondingCurveValidationReason || 'UNVALIDATED_BONDING_CURVE_ACCOUNT') : 'UNCOMPARABLE_ONCHAIN_SAMPLE')
    });
  }

  extractProviderCurveProgressForParity(state = {}) {
    const raw = state.providerCurveProgress
      ?? state.entryCurveProgress
      ?? state.curveProgress
      ?? state.bondingCurveState?.curveProgress;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return value > 1 && value <= 100 ? value / 100 : value;
  }

  extractProviderPriceForParity(state = {}) {
    const raw = state.providerCurvePriceSol
      ?? state.entryPriceSol
      ?? state.bondingCurvePriceSol
      ?? state.priceSol
      ?? state.bondingCurveState?.priceSol;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  maybeStopExpiredSession(trigger = 'unknown') {
    if (!this.active || this.stopInProgress) {
      return true;
    }

    if (this.sessionManager.isTradeAllowed()) {
      return false;
    }

    this.logger.info('Session is no longer accepting trades');
    this.telemetry.record('session.stop_requested', {
      reason: 'SESSION_DURATION_EXCEEDED',
      sessionId: this.sessionId,
      sessionDurationMinutes: this.config.sessionDurationMinutes,
      trigger
    });
    this.stop('SESSION_DURATION_EXCEEDED').catch((error) => {
      this.logger.error('Failed to stop trading engine after session expiration', error.message);
    });
    return true;
  }

  shouldLogPreMigrationPaperEvent(event = {}) {
    if (event.type === 'entry' || event.payload?.decision === 'PAPER_ENTERED') {
      return true;
    }

    const maxLogs = Number(this.config.preMigrationPaperMaxDecisionLogsPerMinute ?? 30);
    if (!Number.isFinite(maxLogs)) {
      return true;
    }
    if (maxLogs <= 0) {
      return false;
    }

    const now = Date.now();
    if (!this.preMigrationDecisionLogWindowStartedAt || now - this.preMigrationDecisionLogWindowStartedAt >= 60_000) {
      this.preMigrationDecisionLogWindowStartedAt = now;
      this.preMigrationDecisionLogCount = 0;
    }

    if (this.preMigrationDecisionLogCount >= maxLogs) {
      return false;
    }

    this.preMigrationDecisionLogCount += 1;
    return true;
  }

  schedulePreMigrationPaperRecheck(payload = {}) {
    if (!this.config.preMigrationPaperRecheckEnabled) {
      return;
    }

    const mint = payload.mint;
    if (!mint || !this.active || this.stopInProgress) {
      return;
    }
    if (this.preMigrationPaperExpiredRechecks.has(mint)) {
      return;
    }

    const maxAttempts = Number(this.config.preMigrationPaperRecheckMaxAttempts || 0);
    if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
      return;
    }

    const now = Date.now();
    const existing = this.preMigrationPaperRechecks.get(mint);
    const attempts = Number(existing?.attempts || 0);
    if (attempts >= maxAttempts || existing?.timer) {
      return;
    }

    const token = this.latestPumpPortalTokens.get(mint);
    const createdAt = Number(token?.createdAt || now);
    const maxAgeMs = Number(this.config.preMigrationPaperRecheckMaxAgeMs || 0);
    if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && now - createdAt > maxAgeMs) {
      this.markPreMigrationPaperRecheckExpired(mint);
      this.telemetry.record('pre_migration_paper.recheck_skipped', {
        mint,
        symbol: payload.symbol || token?.symbol || null,
        reason: 'RECHECK_CANDIDATE_TOO_OLD',
        ageMs: now - createdAt,
        maxAgeMs
      });
      return;
    }

    const maxTracked = Number(this.config.preMigrationPaperRecheckMaxTrackedMints || 500);
    if (this.preMigrationPaperRechecks.size >= maxTracked && !this.preMigrationPaperRechecks.has(mint)) {
      const oldestMint = this.preMigrationPaperRechecks.keys().next().value;
      this.cancelPreMigrationPaperRecheck(oldestMint, 'RECHECK_TRACKING_LIMIT');
    }

    const delayMs = Math.max(1000, Number(this.config.preMigrationPaperRecheckDelayMs || 10000));
    const nextAttempt = attempts + 1;
    const timer = setTimeout(() => {
      this.executePreMigrationPaperRecheck(mint, nextAttempt).catch((error) => {
        this.logger.warn('Pre-migration paper recheck failed', {
          mint,
          attempt: nextAttempt,
          error: error.message
        });
        this.telemetry.record('pre_migration_paper.recheck_failed', {
          mint,
          attempt: nextAttempt,
          message: error.message
        });
      });
    }, delayMs);

    this.preMigrationPaperRechecks.set(mint, {
      mint,
      symbol: payload.symbol || token?.symbol || null,
      attempts: nextAttempt,
      firstScheduledAt: existing?.firstScheduledAt || new Date(now).toISOString(),
      scheduledAt: new Date(now).toISOString(),
      dueAt: new Date(now + delayMs).toISOString(),
      timer
    });

    this.telemetry.record('pre_migration_paper.recheck_scheduled', {
      mint,
      symbol: payload.symbol || token?.symbol || null,
      attempt: nextAttempt,
      maxAttempts,
      delayMs,
      reason: payload.reason
    });
  }

  executeDuePreMigrationPaperRechecks(now = Date.now()) {
    if (!this.active || this.stopInProgress || !this.config.preMigrationPaperRecheckEnabled) {
      return;
    }

    for (const [mint, pending] of this.preMigrationPaperRechecks.entries()) {
      if (!pending?.timer || !pending.dueAt) {
        continue;
      }

      const dueAtMs = Date.parse(pending.dueAt);
      if (!Number.isFinite(dueAtMs) || dueAtMs > now) {
        continue;
      }

      this.executePreMigrationPaperRecheck(mint, pending.attempts || 1).catch((error) => {
        this.logger.warn('Due pre-migration paper recheck failed', {
          mint,
          attempt: pending.attempts || 1,
          error: error.message
        });
        this.telemetry.record('pre_migration_paper.recheck_failed', {
          mint,
          attempt: pending.attempts || 1,
          message: error.message
        });
      });
    }
  }

  async executePreMigrationPaperRecheck(mint, attempt) {
    const scheduled = this.preMigrationPaperRechecks.get(mint);
    if (scheduled?.timer) {
      clearTimeout(scheduled.timer);
    }

    if (!this.active || this.stopInProgress) {
      this.cancelPreMigrationPaperRecheck(mint, 'SESSION_INACTIVE');
      return;
    }

    const token = this.latestPumpPortalTokens.get(mint);
    if (!token) {
      this.preMigrationPaperRechecks.delete(mint);
      this.telemetry.record('pre_migration_paper.recheck_skipped', {
        mint,
        attempt,
        reason: 'TOKEN_STATE_MISSING'
      });
      return;
    }

    const ageMs = Date.now() - Number(token.createdAt || Date.now());
    const maxAgeMs = Number(this.config.preMigrationPaperRecheckMaxAgeMs || 0);
    if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && ageMs > maxAgeMs) {
      this.preMigrationPaperRechecks.delete(mint);
      this.markPreMigrationPaperRecheckExpired(mint);
      this.telemetry.record('pre_migration_paper.recheck_skipped', {
        mint,
        symbol: token.symbol || null,
        attempt,
        reason: 'RECHECK_CANDIDATE_TOO_OLD',
        ageMs,
        maxAgeMs
      });
      return;
    }

    this.preMigrationPaperRechecks.set(mint, {
      ...scheduled,
      timer: null,
      attempts: attempt,
      executingAt: new Date().toISOString()
    });

    const summary = await this.syncPumpBondingCurveState(mint, token, {
      forceRefresh: true,
      observeAfterSync: false,
      launchIntelSummary: token.launchIntelSummary || null
    });

    this.telemetry.record('pre_migration_paper.recheck_executed', {
      mint,
      symbol: token.symbol || null,
      attempt,
      refreshed: Boolean(summary?.refreshed),
      refreshSkipReason: summary?.skipReason || null,
      accountFound: summary?.accountFound ?? null,
      curveProgress: summary?.curveProgress ?? token.curveProgress ?? null
    });

    this.observePreMigrationToken(
      this.latestPumpPortalTokens.get(mint) || token,
      token.launchIntelSummary || null
    );

    const current = this.preMigrationPaperRechecks.get(mint);
    if (current && !current.timer && Number(current.attempts || 0) >= Number(this.config.preMigrationPaperRecheckMaxAttempts || 0)) {
      this.preMigrationPaperRechecks.delete(mint);
    }
  }

  markPreMigrationPaperRecheckExpired(mint) {
    if (!mint) {
      return;
    }

    this.preMigrationPaperExpiredRechecks.add(mint);
    const maxTracked = Math.max(1, Number(this.config.preMigrationPaperRecheckMaxTrackedMints || 500));
    while (this.preMigrationPaperExpiredRechecks.size > maxTracked) {
      const oldestMint = this.preMigrationPaperExpiredRechecks.values().next().value;
      this.preMigrationPaperExpiredRechecks.delete(oldestMint);
    }
  }

  cancelPreMigrationPaperRecheck(mint, reason = 'CANCELLED') {
    if (!mint) {
      return;
    }

    const pending = this.preMigrationPaperRechecks.get(mint);
    if (!pending) {
      return;
    }

    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    this.preMigrationPaperRechecks.delete(mint);
    this.telemetry.record('pre_migration_paper.recheck_cancelled', {
      mint,
      symbol: pending.symbol || null,
      attempt: pending.attempts || 0,
      reason,
      scheduledAt: pending.scheduledAt || null,
      dueAt: pending.dueAt || null
    });
  }

  clearPreMigrationPaperRechecks(reason = 'CANCELLED') {
    for (const mint of Array.from(this.preMigrationPaperRechecks.keys())) {
      this.cancelPreMigrationPaperRecheck(mint, reason);
    }
  }

  async syncPumpBondingCurveState(mint, token = {}, options = {}) {
    if (!mint || !this.pumpBondingCurveLane?.enabled || !this.config.pumpBondingCurveRuntimeRpcEnabled) {
      return null;
    }

    const summary = await this.pumpBondingCurveLane.observeMint(mint, token, {
      forceRefresh: Boolean(options.forceRefresh)
    });
    if (!summary) {
      return null;
    }

    const current = this.latestPumpPortalTokens.get(mint) || token || { mint };
    current.bondingCurveState = summary;
    current.bondingCurveAddress = summary.bondingCurveAddress;
    current.bondingCurveComplete = Boolean(summary.complete);

    if (summary.curveProgress !== null && summary.curveProgress !== undefined) {
      current.curveProgress = summary.curveProgress;
    }

    if (summary.bondingStage) {
      current.bondingStage = summary.bondingStage;
    }

    if (Number.isFinite(Number(summary.realSolReservesSol))) {
      current.realSolReservesSol = Number(summary.realSolReservesSol);
    }

    if (Number.isFinite(Number(summary.virtualSolReservesSol))) {
      current.virtualSolReservesSol = Number(summary.virtualSolReservesSol);
      current.liquiditySol = current.liquiditySol || Number(summary.virtualSolReservesSol);
    }

    if (Number.isFinite(Number(summary.virtualTokenReservesTokens))) {
      current.virtualTokenReservesTokens = Number(summary.virtualTokenReservesTokens);
    }

    if (Number.isFinite(Number(summary.priceSol))) {
      current.bondingCurvePriceSol = Number(summary.priceSol);
    }

    this.latestPumpPortalTokens.set(mint, current);

    if (summary.refreshed) {
      this.telemetry.record('pump_bonding_curve.updated', {
        mint,
        accountFound: summary.accountFound,
        invalidAccountData: Boolean(summary.invalidAccountData),
        invalidAccountReason: summary.invalidAccountReason || null,
        bondingCurveAddress: summary.bondingCurveAddress,
        complete: summary.complete,
        curveProgress: summary.curveProgress,
        bondingStage: summary.bondingStage,
        virtualSolReservesSol: summary.virtualSolReservesSol,
        realSolReservesSol: summary.realSolReservesSol,
        virtualTokenReservesTokens: summary.virtualTokenReservesTokens,
        bondingCurvePriceSol: summary.priceSol
      });

      await this.handleBondingCurveCompletionMigration(mint, current, summary);
    }

    if (options.observeAfterSync && summary.refreshed) {
      this.observePreMigrationToken(current, options.launchIntelSummary || current.launchIntelSummary || null);
    }

    return summary;
  }

  async syncPumpBondingCurveBeforePreMigrationObservation(mint, token = {}, launchIntelSummary = null) {
    if (!this.config.pumpBondingCurveRuntimeRpcEnabled) {
      return null;
    }

    if (!mint || !this.pumpBondingCurveLane?.isRefreshDue?.(mint)) {
      this.enqueuePumpBondingCurveSync(mint, token, launchIntelSummary);
      return null;
    }

    try {
      return await this.syncPumpBondingCurveState(mint, token, {
        observeAfterSync: false,
        launchIntelSummary
      });
    } catch (error) {
      this.logger.warn('Pump bonding curve immediate sync failed', {
        mint,
        error: error.message
      });
      return null;
    }
  }

  schedulePumpBondingCurveSync(mint, token = {}, launchIntelSummary = null) {
    if (!mint || !this.pumpBondingCurveLane?.enabled || !this.config.pumpBondingCurveRuntimeRpcEnabled) {
      return;
    }

    if (this.pendingPumpBondingCurveSyncs.has(mint)) {
      this.enqueuePumpBondingCurveSync(mint, token, launchIntelSummary);
      return;
    }

    if (!this.pumpBondingCurveLane.isRefreshDue(mint)) {
      this.enqueuePumpBondingCurveSync(mint, token, launchIntelSummary);
      return;
    }

    this.startPumpBondingCurveSync(mint, token, launchIntelSummary);
  }

  startPumpBondingCurveSync(mint, token = {}, launchIntelSummary = null, options = {}) {
    if (!this.active || !mint || !this.config.pumpBondingCurveRuntimeRpcEnabled || this.pendingPumpBondingCurveSyncs.has(mint)) {
      return false;
    }

    this.pendingPumpBondingCurveSyncs.add(mint);
    this.syncPumpBondingCurveState(mint, token, {
      observeAfterSync: true,
      launchIntelSummary,
      forceRefresh: Boolean(options.forceVerify)
    }).catch((error) => {
      this.logger.warn('Pump bonding curve async sync failed', {
        mint,
        error: error.message
      });
    }).finally(() => {
      this.pendingPumpBondingCurveSyncs.delete(mint);
      if (this.active) {
        this.armPumpBondingCurveQueueDrain(0);
      }
    });
    return true;
  }

  enqueuePumpBondingCurveSync(mint, token = {}, launchIntelSummary = null, delayMs = 250, options = {}) {
    if (!this.active || !mint || !this.pumpBondingCurveLane?.enabled || !this.config.pumpBondingCurveRuntimeRpcEnabled) {
      return;
    }

    const existing = this.pumpBondingCurveLane.getMintSummary?.(mint);
    if (!options.forceVerify && Number.isFinite(Number(existing?.curveProgress))) {
      return;
    }

    const queued = this.queuedPumpBondingCurveSyncs.get(mint) || {
      mint,
      attempts: 0,
      firstQueuedAt: Date.now()
    };
    queued.forceVerify = Boolean(queued.forceVerify || options.forceVerify);
    queued.token = {
      ...(queued.token || {}),
      ...(token || {})
    };
    queued.launchIntelSummary = launchIntelSummary || queued.launchIntelSummary || token?.launchIntelSummary || null;
    const queueDelayMs = Math.max(0, Number(delayMs || 0));
    queued.nextAttemptAt = Math.min(queued.nextAttemptAt || Infinity, Date.now() + queueDelayMs);
    this.queuedPumpBondingCurveSyncs.set(mint, queued);
    this.armPumpBondingCurveQueueDrain(queueDelayMs);
  }

  armPumpBondingCurveQueueDrain(delayMs = 1000) {
    if (this.pumpBondingCurveQueueTimer || !this.active) {
      return;
    }

    this.pumpBondingCurveQueueTimer = setTimeout(() => {
      this.pumpBondingCurveQueueTimer = null;
      this.drainPumpBondingCurveQueue();
    }, Math.max(0, delayMs));
    if (typeof this.pumpBondingCurveQueueTimer.unref === 'function') {
      this.pumpBondingCurveQueueTimer.unref();
    }
  }

  drainPumpBondingCurveQueue() {
    if (!this.active || !this.pumpBondingCurveLane?.enabled || this.queuedPumpBondingCurveSyncs.size === 0) {
      return;
    }

    const now = Date.now();
    let started = 0;
    let nextDelayMs = 1000;
    const maxAttempts = 90;

    for (const [mint, queued] of Array.from(this.queuedPumpBondingCurveSyncs.entries())) {
      if (queued.nextAttemptAt && queued.nextAttemptAt > now) {
        nextDelayMs = Math.min(nextDelayMs, Math.max(50, queued.nextAttemptAt - now));
        continue;
      }

      if (this.pendingPumpBondingCurveSyncs.has(mint)) {
        queued.nextAttemptAt = now + 500;
        nextDelayMs = Math.min(nextDelayMs, 500);
        continue;
      }

      const existing = this.pumpBondingCurveLane.getMintSummary?.(mint);
      if (!queued.forceVerify && Number.isFinite(Number(existing?.curveProgress))) {
        this.queuedPumpBondingCurveSyncs.delete(mint);
        continue;
      }

      if (!queued.forceVerify && !this.pumpBondingCurveLane.isRefreshDue(mint)) {
        queued.attempts += 1;
        if (queued.attempts >= maxAttempts) {
          this.queuedPumpBondingCurveSyncs.delete(mint);
          this.telemetry.record('pump_bonding_curve.queue_expired', {
            mint,
            attempts: queued.attempts,
            ageMs: now - Number(queued.firstQueuedAt || now)
          });
          continue;
        }
        queued.nextAttemptAt = now + 1000;
        nextDelayMs = Math.min(nextDelayMs, 1000);
        continue;
      }

      this.queuedPumpBondingCurveSyncs.delete(mint);
      if (this.startPumpBondingCurveSync(mint, queued.token || { mint }, queued.launchIntelSummary || null, {
        forceVerify: Boolean(queued.forceVerify)
      })) {
        started += 1;
      }

      if (started >= 2) {
        break;
      }
    }

    if (this.queuedPumpBondingCurveSyncs.size > 0) {
      this.armPumpBondingCurveQueueDrain(started > 0 ? 0 : nextDelayMs);
    }
  }

  async handlePumpPortalNewToken(event) {
    return this.handleProviderNewToken(event, {
      telemetryType: 'provider.pumpportal.new_token',
      defaultSource: 'pumpportal_create'
    });
  }

  async handlePumpDevNewToken(event) {
    return this.handleProviderNewToken(event, {
      telemetryType: 'provider.pumpdev.runtime_new_token',
      defaultSource: 'pumpdev_create'
    });
  }

  async handleProviderNewToken(event, options = {}) {
    if (this.maybeStopExpiredSession('provider_new_token')) {
      return;
    }
    this.executeDuePreMigrationPaperRechecks();
    const mint = event.mint || event.token || event.mintAddress;
    if (!mint) {
      return;
    }

    const nextToken = {
      mint,
      source: event.source || options.defaultSource || 'provider_create',
      createdAt: Date.now(),
      symbol: event.symbol,
      name: event.name,
      quoteMint: event.quoteMint || null,
      pairBase: event.pairBase || null,
      marketCapSol: Number(event.marketCapSol || event.marketCap || 0),
      bondingStage: this.inferBondingStage(event),
      rawEvent: event
    };
    const providerCurveSnapshotApplied = this.applyProviderCurveSnapshot(nextToken, event, 'new_token');
    this.maybeUpdateCurveConfirmationShadow({
      telemetryType: options.telemetryType || 'provider.pumpportal.new_token',
      payload: {
        ...event,
        mint,
        curveProgress: nextToken.curveProgress,
        providerCurveProgress: event.providerCurveProgress ?? event.curveProgress ?? nextToken.curveProgress,
        priceSol: event.priceSol ?? nextToken.priceSol ?? null,
        timestamp: new Date().toISOString()
      }
    });
    this.latestPumpPortalTokens.set(mint, nextToken);
    const launchIntelSummary = this.launchIntelStore.registerNewToken(event);
    if (launchIntelSummary) {
      const current = this.latestPumpPortalTokens.get(mint);
      current.launchIntelSummary = launchIntelSummary;
      this.latestPumpPortalTokens.set(mint, current);
    }
    if (!providerCurveSnapshotApplied) {
      await this.syncPumpBondingCurveBeforePreMigrationObservation(
        mint,
        this.latestPumpPortalTokens.get(mint),
        launchIntelSummary
      );
    }
    this.observePreMigrationToken(this.latestPumpPortalTokens.get(mint), launchIntelSummary);
    this.scheduleProviderBackedBondingCurveSync(
      mint,
      this.latestPumpPortalTokens.get(mint),
      launchIntelSummary,
      providerCurveSnapshotApplied
    );
    this.telemetry.record(options.telemetryType || 'provider.pumpportal.new_token', { mint });
  }

  async handlePumpPortalTrade(event) {
    return this.handleProviderTrade(event, {
      telemetryType: 'provider.pumpportal.trade',
      defaultSource: 'pumpportal_trade'
    });
  }

  async handlePumpDevTrade(event) {
    return this.handleProviderTrade(event, {
      telemetryType: 'provider.pumpdev.runtime_trade',
      defaultSource: 'pumpdev_trade'
    });
  }

  async handleProviderTrade(event, options = {}) {
    if (this.maybeStopExpiredSession('provider_trade')) {
      return;
    }
    this.executeDuePreMigrationPaperRechecks();
    const mint = event.mint || event.token || event.mintAddress;
    if (!mint) {
      return;
    }

    const current = this.latestPumpPortalTokens.get(mint) || {
      mint,
      createdAt: Date.now()
    };

    current.source = current.source || event.source || options.defaultSource || 'provider_trade';
    current.lastTradeAt = Date.now();
    current.firstTradeAt = current.firstTradeAt || current.lastTradeAt;
    current.tradeCount = (current.tradeCount || 0) + 1;
    const tradeVolumeSol = Number(event.solAmount || 0);
    current.volumeSol = (current.volumeSol || 0) + tradeVolumeSol;
    current.liquiditySol = Number(event.virtualSolReservesSol || current.liquiditySol || 0);
    current.marketCapSol = Number(event.marketCapSol || current.marketCapSol || 0);
    current.bondingStage = this.inferBondingStage(event, current.bondingStage);
    const providerCurveSnapshotApplied = this.applyProviderCurveSnapshot(current, event, 'trade');
    this.maybeUpdateCurveConfirmationShadow({
      telemetryType: options.telemetryType || 'provider.pumpportal.trade',
      payload: {
        ...event,
        mint,
        curveProgress: current.curveProgress,
        providerCurveProgress: event.providerCurveProgress ?? event.curveProgress ?? current.curveProgress,
        priceSol: event.priceSol ?? current.priceSol ?? null,
        timestamp: new Date().toISOString()
      }
    });

    if (event.txType === 'buy') {
      current.buys = (current.buys || 0) + 1;
    } else if (event.txType === 'sell') {
      current.sells = (current.sells || 0) + 1;
    }

    const side = event.txType === 'sell' ? 'sell' : 'buy';
    current.tradeWindow = (current.tradeWindow || [])
      .filter((trade) => current.lastTradeAt - trade.timestamp <= this.config.pumpMomentumWindowMs)
      .slice(-200);
    current.tradeWindow.push({
      timestamp: current.lastTradeAt,
      side,
      volumeSol: tradeVolumeSol
    });

    const trader = this.extractProviderTradeWallet(event);
    const trackedAccounts = Array.isArray(this.config.pumpPortalTrackedAccounts)
      ? this.config.pumpPortalTrackedAccounts
      : [];
    const trackedAccountMatch = Boolean(trader && trackedAccounts.includes(trader));
    const tradeWalletProfile = trader ? this.launchIntelStore.buildKolWalletSummary(trader) : null;
    const kolWalletProfileMatch = Boolean(tradeWalletProfile);
    const shadowWalletProfileMatch = tradeWalletProfile?.shadowOnly === true;
    if (trackedAccountMatch) {
      current.accountTradeCount = (current.accountTradeCount || 0) + 1;
    }

    current.rawTrade = event;
    const launchIntelSummary = this.launchIntelStore.registerTrade(event);
    if (launchIntelSummary) {
      current.launchIntelSummary = launchIntelSummary;
    }
    this.latestPumpPortalTokens.set(mint, current);
    const walletLedgerRecord = this.recordWatchedWalletTrade(event, current, launchIntelSummary);
    const curveRefreshDue = Boolean(this.pumpBondingCurveLane?.isRefreshDue?.(mint));
    const hasUsableCurveState = Number.isFinite(Number(current.curveProgress));
    this.scheduleProviderBackedBondingCurveSync(mint, current, launchIntelSummary, providerCurveSnapshotApplied);
    const watchedWalletPaperObserve = Boolean(walletLedgerRecord && this.executionModeManager?.isPaper?.());
    if (!curveRefreshDue || hasUsableCurveState || providerCurveSnapshotApplied || watchedWalletPaperObserve) {
      if (watchedWalletPaperObserve && curveRefreshDue && !hasUsableCurveState && !providerCurveSnapshotApplied) {
        this.telemetry.record('pre_migration_paper.wallet_context_observe_forced', {
          mint,
          symbol: current.symbol || null,
          wallet: walletLedgerRecord.wallet || null,
          side: walletLedgerRecord.side || null,
          watchedReason: walletLedgerRecord.watchedReason || null,
          reason: 'WATCHED_WALLET_TRADE_WITH_PENDING_CURVE_REFRESH'
        });
      }
      this.observePreMigrationToken(current, launchIntelSummary);
    }
    this.telemetry.record(options.telemetryType || 'provider.pumpportal.trade', {
      mint,
      tradeCount: current.tradeCount,
      traderPresent: Boolean(trader),
      trackedAccountMatch,
      kolWalletProfileMatch,
      shadowWalletProfileMatch,
      watchedWallet: Boolean(walletLedgerRecord),
      watchedWalletReason: walletLedgerRecord?.watchedReason || null
    });
  }

  scheduleProviderBackedBondingCurveSync(mint, token = {}, launchIntelSummary = null, providerCurveSnapshotApplied = false) {
    if (!providerCurveSnapshotApplied) {
      this.schedulePumpBondingCurveSync(mint, token, launchIntelSummary);
      return;
    }

    if (!this.config.pumpDevProviderCurveVerificationEnabled) {
      return;
    }

    const curveProgress = Number(token.curveProgress);
    const tradeCount = Number(token.tradeCount || 0);
    const watchedWalletTouches = Number(token.accountTradeCount || 0);
    const shouldVerifySoon = (
      (Number.isFinite(curveProgress) && curveProgress >= 0.85)
      || (Number.isFinite(curveProgress) && curveProgress >= 0.65 && tradeCount >= 25)
      || watchedWalletTouches > 0
    );

    if (shouldVerifySoon) {
      const now = Date.now();
      const lastQueuedAt = Number(token.providerCurveVerificationQueuedAt || 0);
      if (Number.isFinite(lastQueuedAt) && now - lastQueuedAt < 30_000) {
        return;
      }
      if (this.pendingPumpBondingCurveSyncs.size >= 1 || this.queuedPumpBondingCurveSyncs.size >= 2) {
        token.providerCurveVerificationQueuedAt = now;
        const lastSkippedAt = Number(token.providerCurveVerificationSkippedAt || 0);
        token.providerCurveVerificationSkippedAt = now;
        if (!Number.isFinite(lastSkippedAt) || now - lastSkippedAt >= 30_000) {
          this.telemetry.record('pump_bonding_curve.provider_verification_skipped', {
            mint,
            providerCurveProgress: Number.isFinite(curveProgress) ? Number(curveProgress.toFixed(6)) : null,
            tradeCount,
            watchedWalletTouches,
            reason: 'VERIFICATION_PRESSURE'
          });
        }
        return;
      }
      token.providerCurveVerificationQueuedAt = now;
      const started = this.startPumpBondingCurveSync(mint, token, launchIntelSummary, {
        forceVerify: true
      });
      this.telemetry.record('pump_bonding_curve.provider_verification_scheduled', {
        mint,
        providerCurveProgress: Number.isFinite(curveProgress) ? Number(curveProgress.toFixed(6)) : null,
        tradeCount,
        watchedWalletTouches,
        startedImmediately: started
      });
      return;
    }
  }

  applyProviderCurveSnapshot(current, event = {}, phase = 'unknown') {
    const curveProgress = Number(event.providerCurveProgress ?? event.curveProgress);
    if (!current || !Number.isFinite(curveProgress)) {
      return false;
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const source = event.providerCurveSource || `${event.provider || 'provider'}_curve_snapshot`;
    const pairBase = event.pairBase || current.pairBase || null;
    const quoteMint = event.quoteMint || current.quoteMint || null;
    const virtualSolReservesSol = Number(event.virtualSolReservesSol);
    const virtualTokenReservesTokens = Number(event.virtualTokenReservesTokens);
    const priceSol = Number(event.providerCurvePriceSol ?? event.bondingCurvePriceSol);
    const providerVirtualTokenReservesRaw = event.providerVirtualTokenReservesRaw ?? null;
    const providerVirtualQuoteReservesRaw = event.providerVirtualQuoteReservesRaw ?? null;
    const providerVirtualSolReservesRaw = event.providerVirtualSolReservesRaw ?? null;

    current.curveProgress = curveProgress;
    current.curveProgressSource = source;
    current.providerCurveProgress = curveProgress;
    current.providerCurveSnapshotAt = nowIso;
    current.lastCurveUpdateAt = nowIso;
    current.bondingCurveLastFetchAt = nowIso;
    current.quoteMint = quoteMint;
    current.pairBase = pairBase;
    current.bondingStage = curveProgress >= 1
      ? 'recently_bonded'
      : (curveProgress >= this.config.preMigrationWatchMinCurveProgress ? 'almost_bonded' : 'bonding_curve');

    if (Number.isFinite(virtualSolReservesSol)) {
      current.virtualSolReservesSol = virtualSolReservesSol;
      current.liquiditySol = current.liquiditySol || virtualSolReservesSol;
    }

    if (Number.isFinite(virtualTokenReservesTokens)) {
      current.virtualTokenReservesTokens = virtualTokenReservesTokens;
    }

    current.providerVirtualTokenReservesRaw = providerVirtualTokenReservesRaw;
    current.providerVirtualQuoteReservesRaw = providerVirtualQuoteReservesRaw;
    current.providerVirtualSolReservesRaw = providerVirtualSolReservesRaw;
    const providerBondingCurveAddress = validProviderBondingCurveAddress(event.bondingCurveKey);
    const retainedBondingCurveAddress = providerBondingCurveAddress
      || current.bondingCurveAddress
      || current.bondingCurveState?.bondingCurveAddress
      || null;
    if (providerBondingCurveAddress && !current.bondingCurveAddress) {
      current.bondingCurveAddress = providerBondingCurveAddress;
    }

    if (Number.isFinite(priceSol) && priceSol > 0) {
      current.bondingCurvePriceSol = priceSol;
      current.providerCurvePriceSol = priceSol;
    }

    if (Number.isFinite(Number(event.marketCapQuote))) {
      current.marketCapQuote = Number(event.marketCapQuote);
    }

    current.bondingCurveState = {
      ...(current.bondingCurveState || {}),
      source,
      provider: event.provider || current.provider || null,
      quoteMint,
      pairBase,
      curveProgress,
      providerCurveProgress: curveProgress,
      bondingStage: current.bondingStage,
      complete: curveProgress >= 1,
      bondingCurveAddress: retainedBondingCurveAddress,
      virtualSolReservesSol: Number.isFinite(virtualSolReservesSol) ? virtualSolReservesSol : current.virtualSolReservesSol ?? null,
      virtualTokenReservesTokens: Number.isFinite(virtualTokenReservesTokens) ? virtualTokenReservesTokens : current.virtualTokenReservesTokens ?? null,
      providerVirtualTokenReservesRaw,
      providerVirtualQuoteReservesRaw,
      providerVirtualSolReservesRaw,
      priceSol: Number.isFinite(priceSol) && priceSol > 0 ? priceSol : current.bondingCurvePriceSol ?? null,
      providerCurvePriceSol: Number.isFinite(priceSol) && priceSol > 0 ? priceSol : current.providerCurvePriceSol ?? null,
      lastFetchAt: nowIso,
      lastFetchAtIso: nowIso,
      refreshed: true,
      approximate: true
    };

    this.telemetry.record('pump_bonding_curve.provider_snapshot', {
      mint: current.mint || event.mint || event.token || event.mintAddress || null,
      provider: event.provider || null,
      phase,
      source,
      pairBase,
      curveProgress,
      virtualSolReservesSol: Number.isFinite(virtualSolReservesSol) ? virtualSolReservesSol : null,
      virtualTokenReservesTokens: Number.isFinite(virtualTokenReservesTokens) ? virtualTokenReservesTokens : null,
      providerVirtualTokenReservesRaw,
      providerVirtualQuoteReservesRaw,
      providerVirtualSolReservesRaw,
      priceSol: Number.isFinite(priceSol) && priceSol > 0 ? priceSol : null
    });

    return true;
  }

  extractProviderTradeWallet(event = {}) {
    return event.traderPublicKey
      || event.wallet
      || event.account
      || event.trader
      || event.user
      || event.buyer
      || event.seller
      || event.signer
      || event.maker
      || event.owner
      || event.creator
      || null;
  }

  rawProviderTradeWalletKeys(event = {}) {
    const raw = event.raw || event.rawEvent || {};
    const keys = new Set();
    const collect = (source) => {
      for (const key of Object.keys(source || {})) {
        if (/trader|wallet|account|user|buyer|seller|signer|maker|owner|creator/i.test(key)) {
          keys.add(key);
        }
      }
    };
    collect(raw);
    collect(event);
    return [...keys].sort();
  }

  recordWalletTradeGateDiagnostic(event = {}, tokenState = {}, details = {}) {
    try {
      this.telemetry.record('wallet.trade_gate_diagnostic', {
        provider: event.provider || tokenState.provider || null,
        source: event.source || tokenState.source || null,
        eventType: event.eventType || event.type || null,
        mint: event.mint || event.token || event.mintAddress || tokenState.mint || null,
        symbol: event.symbol || tokenState.symbol || null,
        txType: event.txType || null,
        wallet: details.wallet || null,
        traderPresent: Boolean(details.wallet),
        rawTraderFieldKeys: this.rawProviderTradeWalletKeys(event),
        dropReason: details.dropReason || null,
        trackedAccountMatch: details.trackedAccountMatch === true,
        kolWalletProfileMatch: details.kolWalletProfileMatch === true,
        shadowWalletProfileMatch: details.shadowWalletProfileMatch === true,
        watchedReason: details.watchedReason || null,
        ledgerRecord: details.ledgerRecord === true,
        untrustedTapeRecord: details.untrustedTapeRecord === true,
        launchIntelWallet: details.launchIntelWallet || null
      });
    } catch {
      // Diagnostics must never affect provider trade intake.
    }
  }

  classifyLaunchIntelWalletShadow(wallet) {
    const summary = this.launchIntelStore?.getWalletSummary?.(wallet);
    if (!summary) {
      return null;
    }
    const stabilityShortlist = this.launchIntelShortlistWallets instanceof Map
      ? this.launchIntelShortlistWallets.get(wallet)
      : null;

    const totalLaunches = Number(summary.totalLaunches || 0);
    const totalBuyCount = Number(summary.totalBuyCount || 0);
    const totalVolumeSol = Number(summary.totalVolumeSol || 0);
    const avgBuysPerLaunch = totalLaunches > 0 ? totalBuyCount / totalLaunches : null;
    const busyFlowRisk = totalLaunches >= 1000
      || totalBuyCount >= 5000
      || Number(avgBuysPerLaunch || 0) >= 8;
    const fallbackShortlistCandidate = !busyFlowRisk
      && totalLaunches >= 5
      && totalLaunches <= 500
      && Number(avgBuysPerLaunch || 0) >= 1
      && Number(avgBuysPerLaunch || 0) <= 3;
    const shortlistCandidate = stabilityShortlist
      ? !busyFlowRisk
      : (this.launchIntelShortlistWallets === null && fallbackShortlistCandidate);
    const observeCandidate = !busyFlowRisk && totalLaunches >= 2;

    return {
      wallet,
      classification: busyFlowRisk
        ? 'BUSY_FLOW_RISK'
        : (shortlistCandidate ? 'LAUNCH_INTEL_SHORTLIST_CANDIDATE' : (observeCandidate ? 'LAUNCH_INTEL_OBSERVE_CANDIDATE' : 'LOW_PRIORITY')),
      shortlistCandidate,
      observeCandidate,
      busyFlowRisk,
      shortlistSource: stabilityShortlist ? 'stability_report' : (shortlistCandidate ? 'launch_shape_fallback' : null),
      stabilityScore: stabilityShortlist?.score ?? null,
      stabilityRunCount: stabilityShortlist?.runCount ?? null,
      stabilityDecisionRunCount: stabilityShortlist?.decisionRunCount ?? null,
      stabilityNoTrackedFirstTouchLinks: stabilityShortlist?.noTrackedFirstTouchLinks ?? null,
      totalLaunches: Number.isFinite(totalLaunches) ? totalLaunches : null,
      totalBuyCount: Number.isFinite(totalBuyCount) ? totalBuyCount : null,
      totalVolumeSol: Number.isFinite(totalVolumeSol) ? Number(totalVolumeSol.toFixed(6)) : null,
      avgBuysPerLaunch: Number.isFinite(avgBuysPerLaunch) ? Number(avgBuysPerLaunch.toFixed(4)) : null,
      firstSeen: summary.firstSeen || null,
      lastSeen: summary.lastSeen || null
    };
  }

  recordWatchedWalletTrade(event, tokenState, launchIntelSummary) {
    const wallet = this.extractProviderTradeWallet(event);
    if (!wallet) {
      this.recordWalletTradeGateDiagnostic(event, tokenState, {
        dropReason: 'NO_TRADER_FIELD'
      });
      return null;
    }

    const walletProfile = this.launchIntelStore.buildKolWalletSummary(wallet);
    const launchIntelWallet = this.classifyLaunchIntelWalletShadow(wallet);
    const trackedAccounts = Array.isArray(this.config.pumpPortalTrackedAccounts)
      ? this.config.pumpPortalTrackedAccounts
      : [];
    const isTrackedAccount = trackedAccounts.includes(wallet);
    if (!walletProfile && !isTrackedAccount) {
      const untrustedTapeRecord = this.executionModeManager?.isPaper?.()
        ? this.walletEventLedger?.recordUntrustedTradeTape?.({
          event,
          tokenState,
          launchIntelSummary,
          reason: 'UNTRACKED_WALLET',
          launchIntelWallet
        })
        : null;
      this.recordWalletTradeGateDiagnostic(event, tokenState, {
        wallet,
        dropReason: 'UNTRACKED_WALLET',
        trackedAccountMatch: false,
        kolWalletProfileMatch: false,
        untrustedTapeRecord: Boolean(untrustedTapeRecord),
        launchIntelWallet
      });
      return null;
    }

    const watchedReason = walletProfile && isTrackedAccount
      ? 'tracked_account_and_watchlist_profile'
      : (walletProfile ? (walletProfile.shadowOnly ? 'shadow_wallet_profile' : 'watchlist_profile') : 'tracked_account');

    let record = null;
    try {
      record = this.walletEventLedger.recordTrade({
        event,
        tokenState,
        launchIntelSummary,
        walletProfile,
        watchedReason
      });
    } catch (error) {
      this.logger.warn('Failed to record watched wallet trade', {
        wallet,
        mint: event.mint || event.token || event.mintAddress || null,
        reason: error.message
      });
      this.recordWalletTradeGateDiagnostic(event, tokenState, {
        wallet,
        dropReason: 'WALLET_LEDGER_RECORD_FAILED',
        trackedAccountMatch: isTrackedAccount,
        kolWalletProfileMatch: Boolean(walletProfile),
        shadowWalletProfileMatch: walletProfile?.shadowOnly === true,
        watchedReason
      });
      return null;
    }

    if (record) {
      this.recordWalletTradeGateDiagnostic(event, tokenState, {
        wallet,
        dropReason: 'RECORDED',
        trackedAccountMatch: isTrackedAccount,
        kolWalletProfileMatch: Boolean(walletProfile),
        shadowWalletProfileMatch: walletProfile?.shadowOnly === true,
        watchedReason,
        ledgerRecord: true
      });
      this.telemetry.record('wallet.trade_observed', {
        wallet,
        mint: record.mint,
        side: record.side,
        phase: record.phase,
        watchedReason,
        solAmount: record.amount?.sol,
        secondsSinceCreate: record.timing?.secondsSinceCreate,
        profile: record.walletProfile?.profile || null,
        trustTier: record.walletProfile?.trustTier || null,
        shadowOnly: record.walletProfile?.shadowOnly === true,
        classification: this.walletEventLedger.walletStats.get(wallet)?.classification?.label || null
      });
    } else {
      this.recordWalletTradeGateDiagnostic(event, tokenState, {
        wallet,
        dropReason: 'WALLET_LEDGER_RECORD_SKIPPED',
        trackedAccountMatch: isTrackedAccount,
        kolWalletProfileMatch: Boolean(walletProfile),
        shadowWalletProfileMatch: walletProfile?.shadowOnly === true,
        watchedReason
      });
    }

    return record;
  }

  async handlePumpPortalMigration(event) {
    return this.handleMigrationEvent(event, {
      telemetryType: 'provider.pumpportal.migration',
      source: 'pumpportal_migration'
    });
  }

  async handleBondingCurveCompletionMigration(mint, token = {}, summary = {}) {
    if (!this.executionModeManager?.isPaper?.()) {
      return null;
    }

    if (!mint || !summary?.complete || this.syntheticBondingCurveMigrations.has(mint)) {
      return null;
    }

    this.syntheticBondingCurveMigrations.add(mint);
    return this.handleMigrationEvent({
      mint,
      token: mint,
      symbol: token.symbol || summary.symbol || null,
      name: token.name || summary.name || null,
      source: 'pump_bonding_curve_complete',
      synthetic: true,
      complete: true,
      curveProgress: summary.curveProgress ?? 1,
      bondingCurveAddress: summary.bondingCurveAddress || null,
      bondingStage: summary.bondingStage || 'recently_bonded',
      observedAt: summary.lastFetchAt || new Date().toISOString()
    }, {
      telemetryType: 'pump_bonding_curve.synthetic_migration',
      source: 'pump_bonding_curve_complete',
      synthetic: true
    });
  }

  async handleMigrationEvent(event, options = {}) {
    this.executeDuePreMigrationPaperRechecks();
    const mint = event.mint || event.token || event.mintAddress;
    if (!mint) {
      return;
    }

    const source = options.source || event.source || 'pumpportal_migration';
    const telemetryType = options.telemetryType || 'provider.pumpportal.migration';
    const synthetic = Boolean(options.synthetic || event.synthetic);
    const current = this.latestPumpPortalTokens.get(mint) || {
      mint,
      createdAt: Date.now()
    };

    current.migratedAt = Date.now();
    current.bondingStage = 'recently_bonded';
    if (synthetic) {
      current.rawSyntheticMigration = event;
    } else {
      current.rawMigration = event;
    }
    const launchIntelSummary = this.launchIntelStore.registerMigration(event);
    if (launchIntelSummary) {
      current.launchIntelSummary = launchIntelSummary;
    }
    this.latestPumpPortalTokens.set(mint, current);
    const preMigrationSummary = this.preMigrationWatchLane.markMigrated(mint, event);
    this.schedulePumpBondingCurveSync(mint, current, launchIntelSummary);
    if (preMigrationSummary) {
      this.launchIntelStore.registerPreMigrationState(preMigrationSummary);
    }
    this.outcomeLedger.recordMigration(mint, preMigrationSummary || current, event, {
      sessionId: this.sessionId,
      source
    });
    this.telemetry.record(telemetryType, {
      mint,
      source,
      synthetic,
      curveProgress: event.curveProgress ?? null,
      bondingCurveAddress: event.bondingCurveAddress || null
    });
  }

  syncTelegramSightings({ bootstrap = false } = {}) {
    try {
      const startedAt = Date.now();
      const bootstrapConfig = this.getTelegramBootstrapConfig();
      const recurringConfig = this.getTelegramRecurringSyncConfig();
      const bootstrapMaxAgeMinutes = Number(bootstrapConfig.maxAgeMinutes || 0);
      const bootstrapSince = bootstrap && bootstrapMaxAgeMinutes > 0
        ? Date.now() - (bootstrapMaxAgeMinutes * 60 * 1000)
        : null;
      const since = bootstrap
        ? bootstrapSince
        : (this.lastTelegramSightingSyncAt || this.getDefaultTelegramRecurringSinceMs());
      const maxSightings = bootstrap
        ? Number(bootstrapConfig.limit || 0)
        : Number(recurringConfig.limit || 250);

      const sightings = this.telegramContext.getRecentMintSightings(
        since,
        {
          maxSightings,
          maxSnippets: this.config.telegramSummaryMaxSnippets
        }
      );
      this.lastTelegramSightingSyncAt = Date.now();

      if (!Array.isArray(sightings) || sightings.length === 0) {
        this.logger.info(`Telegram external sighting sync found no mints (${Date.now() - startedAt}ms)`);
        return;
      }

      let imported = 0;
      for (const sighting of sightings) {
        const summary = this.launchIntelStore.registerExternalSighting(sighting);
        if (summary) {
          imported += 1;
        }
      }

      const durationMs = Date.now() - startedAt;
      if (imported > 0) {
        this.telemetry.record('provider.telegram.sightings_imported', {
          imported,
          bootstrap,
          uniqueMints: sightings.length,
          durationMs,
          since: Number.isFinite(since) ? new Date(since).toISOString() : null,
          maxSightings
        });
        this.logger.info(`Imported ${imported} Telegram external sighting(s) into launch-intel (${durationMs}ms, scanned=${sightings.length}, bootstrap=${bootstrap})`);
      } else {
        this.logger.info(`Telegram external sighting sync had ${sightings.length} sighting(s), 0 new import(s) (${durationMs}ms, bootstrap=${bootstrap})`);
      }
    } catch (error) {
      this.logger.warn('Failed to sync Telegram external sightings', error.message);
      this.telemetry.record('provider.error', {
        provider: 'telegram_sightings',
        message: error.message
      });
    }
  }

  shouldRunTelegramBootstrapSightings() {
    const mode = String(this.config.telegramBootstrapSightingMode || 'live_only').toLowerCase();
    if (mode === 'never') {
      return false;
    }

    if (mode === 'always') {
      return true;
    }

    if (mode === 'paper_only') {
      return this.executionModeManager.isPaper();
    }

    if (mode === 'live_only') {
      return this.executionModeManager.isLive();
    }

    return this.executionModeManager.isLive();
  }

  getTelegramBootstrapConfig() {
    if (this.executionModeManager.isPaper()) {
      return {
        limit: Number(this.config.telegramPaperBootstrapSightingLimit || 10),
        maxAgeMinutes: Number(this.config.telegramPaperBootstrapSightingMaxAgeMinutes || 60)
      };
    }

    return {
      limit: Number(this.config.telegramBootstrapSightingLimit || 75),
      maxAgeMinutes: Number(this.config.telegramBootstrapSightingMaxAgeMinutes || 240)
    };
  }

  getTelegramRecurringSyncConfig() {
    if (this.executionModeManager.isPaper()) {
      return {
        limit: Number(this.config.telegramPaperRecurringSightingLimit || 25),
        maxAgeMinutes: Number(this.config.telegramPaperRecurringSightingMaxAgeMinutes || 20)
      };
    }

    return {
      limit: 250,
      maxAgeMinutes: null
    };
  }

  getDefaultTelegramRecurringSinceMs() {
    const recurringConfig = this.getTelegramRecurringSyncConfig();
    const maxAgeMinutes = Number(recurringConfig.maxAgeMinutes || 0);
    if (!Number.isFinite(maxAgeMinutes) || maxAgeMinutes <= 0) {
      return null;
    }

    return Date.now() - (maxAgeMinutes * 60 * 1000);
  }

  inferBondingStage(event, fallback = 'new') {
    const progress = Number(event.bondingCurveProgress || event.progress || event.bondingProgress || 0);
    if (progress >= 100 || event.txType === 'migrate') {
      return 'recently_bonded';
    }

    if (progress >= 85) {
      return 'almost_bonded';
    }

    return fallback;
  }

  async refreshCapitalState() {
    const now = Date.now();
    if (this.executionModeManager.isPaper() && this.currentPositions.size === 0) {
      this.lastCapitalBalanceLookupAt = now;
      this.recomputeCapitalState();
      return;
    }

    const paperRefreshIntervalMs = Number(this.config.paperBalanceRefreshIntervalMs || 15000);
    const shouldReusePaperBalances = this.executionModeManager.isPaper()
      && this.lastCapitalBalanceLookupAt > 0
      && Number.isFinite(paperRefreshIntervalMs)
      && paperRefreshIntervalMs > 0
      && (now - this.lastCapitalBalanceLookupAt) < paperRefreshIntervalMs;

    if (shouldReusePaperBalances) {
      this.recomputeCapitalState();
      return;
    }

    const balanceTimeoutMs = Number(this.config.capitalBalanceTimeoutMs || 5000);
    const [hotWalletBalanceSol, coldWalletBalanceSol] = await Promise.all([
      this.getSolBalanceWithTimeout('hot_wallet', this.hotWallet.getPublicKey(), this.hotWalletBalanceSol, balanceTimeoutMs),
      this.getSolBalanceWithTimeout('cold_wallet', this.coldWalletAddress, this.coldWalletBalanceSol, balanceTimeoutMs)
    ]);

    this.hotWalletBalanceSol = hotWalletBalanceSol;
    this.coldWalletBalanceSol = coldWalletBalanceSol;
    this.lastCapitalBalanceLookupAt = now;
    this.recomputeCapitalState();
  }

  recomputeCapitalState() {
    this.openPositionValueSol = this.getOpenPositionValueSol();
    this.unrealizedPnL = this.getUnrealizedPnLSol();

    const baseEquity = this.executionModeManager.isPaper()
      ? this.paperWalletBalanceSol + this.openPositionValueSol
      : this.hotWalletBalanceSol + this.coldWalletBalanceSol + this.openPositionValueSol;

    this.totalEquitySol = baseEquity;

    if (this.initialTotalEquitySol === null) {
      this.initialTotalEquitySol = this.totalEquitySol;
    }

    this.realizedPnL = this.totalEquitySol - this.initialTotalEquitySol - this.unrealizedPnL;
  }

  async getSolBalanceWithTimeout(label, address, fallbackBalanceSol = 0, timeoutMs = 5000) {
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5000;
    let timeoutId = null;

    try {
      const balance = await Promise.race([
        WalletManager.getSolBalance(this.connection, address),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(`SOL balance lookup timed out after ${timeout}ms`));
          }, timeout);
        })
      ]);

      if (Number.isFinite(balance)) {
        return balance;
      }

      throw new Error(`SOL balance lookup returned non-finite value for ${label}`);
    } catch (error) {
      if (this.executionModeManager?.isLive?.()) {
        this.logger.error(`LIVE ${label} SOL balance lookup failed closed`, {
          reason: error.message
        });
        throw error;
      }

      this.logger.warn(`Using fallback ${label} SOL balance`, {
        fallbackBalanceSol,
        reason: error.message
      });
      return fallbackBalanceSol;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  getOpenPositionValueSol() {
    const liveValue = Array.from(this.currentPositions.values())
      .reduce((sum, position) => sum + (position.marketValueSol || position.costBasisSol || 0), 0);
    const paperValue = Array.from(this.paperPositions.values())
      .reduce((sum, position) => sum + (position.marketValueSol || position.costBasisSol || 0), 0);
    return liveValue + paperValue;
  }

  getUnrealizedPnLSol() {
    const liveUnrealized = Array.from(this.currentPositions.values())
      .reduce((sum, position) => sum + (position.unrealizedPnLSol || 0), 0);
    const paperUnrealized = Array.from(this.paperPositions.values())
      .reduce((sum, position) => sum + (position.unrealizedPnLSol || 0), 0);
    return liveUnrealized + paperUnrealized;
  }

  getReservedCapitalSol() {
    const liveReserved = Array.from(this.currentPositions.values())
      .reduce((sum, position) => sum + (position.costBasisSol || 0), 0);
    const paperReserved = Array.from(this.paperPositions.values())
      .reduce((sum, position) => sum + (position.costBasisSol || 0), 0);
    return liveReserved + paperReserved;
  }

  getAvailableTradingCapitalSol() {
    if (this.executionModeManager.isPaper()) {
      return Math.max(this.paperWalletBalanceSol - this.getReservedCapitalSol(), 0);
    }

    return Math.max(this.hotWalletBalanceSol - this.getReservedCapitalSol(), 0);
  }

  getOpenEntrySlots() {
    if (this.executionModeManager.isPaper()) {
      return Math.max(this.config.maxOpenPaperPositions - this.paperPositions.size, 0);
    }

    return Math.max(this.config.maxOpenLivePositions - this.currentPositions.size, 0);
  }

  hasEntryCapacity() {
    if (this.executionModeManager.isLive() && this.liveTradingHalted) {
      return false;
    }

    return this.getOpenEntrySlots() > 0 && this.getAvailableTradingCapitalSol() > 0;
  }

  async checkRiskManagement() {
    if (this.dailyPnL < -this.config.maxDailyLossSol) {
      this.liveTradingHalted = this.executionModeManager.isLive();
      this.logger.warn(`Daily loss limit reached: ${this.dailyPnL} SOL. Entering cooldown.${this.liveTradingHalted ? ' Live entries are hard-halted for this process.' : ''}`);
      this.sessionManager.enterCooldown('DAILY_LOSS_LIMIT_REACHED', 24 * 60 * 60 * 1000);
    }
  }

  rejectTrade(signal, reason) {
    const cooldownMs = reason === 'TOKEN_NOT_QUOTEABLE' || reason === 'QUOTE_NO_OUTPUT'
      ? Math.max(this.config.tokenSignalCooldownMs, this.config.quoteFailureQuarantineMs, this.config.rejectionQuarantineMs)
      : Math.max(this.config.tokenSignalCooldownMs, this.config.rejectionQuarantineMs);

    this.applySignalCooldown(signal.token, cooldownMs);
    this.rejectedTrades.push({
      signalId: signal.id,
      token: signal.token,
      reason,
      timestamp: Date.now()
    });
    this.telemetry.record('trade.rejected', {
      signalId: signal.id,
      token: signal.token,
      reason,
      qualityScore: signal.qualityScore,
      qualityFactors: signal.qualityFactors
    });
    this.outcomeLedger.recordTradeRejection(signal, reason, {
      sessionId: this.sessionId
    });
    this.eventFlow.record('signal.rejected', {
      signalId: signal.id,
      token: signal.token,
      reason,
      source: signal.tokenInfo?.source || 'unknown',
      qualityScore: signal.qualityScore ?? null,
      momentumScore: signal.momentumScore ?? null
    });
    this.logger.decision(`HARD VETO: ${signal.token}`, {
      reason,
      source: signal.tokenInfo?.source || 'unknown',
      qualityScore: signal.qualityScore,
      momentumScore: signal.momentumScore,
      liquiditySol: Number(signal.tokenInfo?.liquidity || signal.tokenInfo?.rawPool?.liquidity || 0),
      liquidityUsd: Number(signal.tokenInfo?.liquidityUsd || 0),
      minLiquidityUsd: this.config.minLiquidityUsd
    });
    this.logger.warn(`Trade rejected: ${reason}`, { token: signal.token });
    return { success: false, reason };
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      active: this.active,
      mode: this.executionModeManager.mode,
      session: this.sessionManager.getStatus(),
      totalTrades: this.totalTrades,
      currentPositions: this.currentPositions.size + this.paperPositions.size,
      rejectedTrades: this.rejectedTrades.length,
      dailyPnL: this.dailyPnL,
      realizedPnL: this.realizedPnL,
      unrealizedPnL: this.unrealizedPnL,
      hotWalletBalanceSol: this.hotWalletBalanceSol,
      coldWalletBalanceSol: this.coldWalletBalanceSol,
      paperWalletBalanceSol: this.paperWalletBalanceSol,
      availableHotWalletBalanceSol: this.getAvailableTradingCapitalSol(),
      reservedCapitalSol: this.getReservedCapitalSol(),
      openPositionValueSol: this.openPositionValueSol,
      totalEquitySol: this.totalEquitySol,
      initialTotalEquitySol: this.initialTotalEquitySol,
      profitAllocation: this.capitalAllocation.getProfitAllocationByEquity(this.totalEquitySol),
      riskSizing: this.capitalAllocation.getRiskSizeByHotEquity(this.getAvailableTradingCapitalSol()),
      accounting: this.accounting.getStats(),
      solanaRpc: this.connection.getStatus(),
      pumpPortal: this.pumpPortalListener.getStats(),
      pumpDev: {
        ...this.pumpDevListener.getStats(),
        primarySilenceFailFastEnabled: this.config.pumpDevPrimarySilenceFailFastEnabled === true,
        primarySilenceTimeoutMs: Number(this.config.pumpDevPrimarySilenceTimeoutMs || 0),
        primarySilenceElapsedMs: this.pumpDevPrimarySilenceStartedAt ? Date.now() - this.pumpDevPrimarySilenceStartedAt : null,
        primarySilenceTripped: this.pumpDevPrimarySilenceTripped === true
      },
      poolStateLane: this.poolStateLane.getStats(),
      pumpBondingCurveLane: {
        ...this.pumpBondingCurveLane.getStats(),
        engineQueueSize: this.queuedPumpBondingCurveSyncs.size,
        enginePendingSyncs: this.pendingPumpBondingCurveSyncs.size,
        pumpDevTargetedCurveParitySamples: this.pumpDevTargetedCurveParitySampleCount,
        pumpDevTargetedCurveParityInFlight: this.pumpDevTargetedCurveParityInFlight.size,
        pumpDevTargetedCurveParitySampleWatchEnabled: this.config.pumpDevTargetedCurveParitySampleWatchEnabled === true,
        pumpDevTargetedCurveParitySampleSkipsEnabled: this.config.pumpDevTargetedCurveParitySampleSkipsEnabled === true,
        pumpDevTargetedCurveParitySampleEligibleEnabled: this.config.pumpDevTargetedCurveParitySampleEligibleEnabled !== false
      },
      finalistAccountVerifier: this.finalistAccountVerifier?.getStats?.() || null,
      liveExecutionDryRun: this.liveExecutionDryRunLane?.getStats?.() || null,
      preMigrationWatch: this.preMigrationWatchLane.getStats(),
      preMigrationPaper: this.preMigrationPaperLane.getStats(),
      postMigrationContinuation: this.postMigrationContinuationLane.getStats(),
      walletEventLedger: this.walletEventLedger.getStats(),
      candidateDossiers: this.candidateDossierLedger.getStats(),
      outcomeLedger: this.outcomeLedger.getStats(),
      telemetry: this.telemetry.getSummary(),
      eventLoopMonitor: { ...this.eventLoopMonitorStats },
      eventFlow: this.eventFlow.getSummary(),
      strategyLedger: this.strategyLedger.getSummary(),
      positions: [
        ...Array.from(this.currentPositions.values()),
        ...Array.from(this.paperPositions.values())
      ]
    };
  }
}

module.exports = TradingEngine;
