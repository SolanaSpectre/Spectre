const { Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const MarketData = require('./market-data');
const AIAgent = require('./ai-agent');
const CapitalAllocation = require('./capital-allocation');
const WalletManager = require('./wallet');
const PumpPortalListener = require('./pumpportal-listener');
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
const PositionStore = require('./lib/position-store');
const TradingEventFlow = require('./lib/trading-event-flow');
const PoolStateLane = require('./lib/pool-state-lane');
const PreMigrationWatchLane = require('./lib/pre-migration-watch-lane');
const PreMigrationPaperLane = require('./lib/pre-migration-paper-lane');
const PumpBondingCurveLane = require('./lib/pump-bonding-curve-lane');
const CandidateDossierLedger = require('./lib/candidate-dossier-ledger');
const PostMigrationContinuationLane = require('./lib/post-migration-continuation-lane');

class TradingEngine {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.connection = new Connection(config.solanaRpcUrl, 'confirmed');
    this.marketData = new MarketData(config, logger);
    this.aiAgent = new AIAgent(config, logger);
    this.capitalAllocation = new CapitalAllocation(config, logger);
    this.hotWallet = new WalletManager(config.hotWalletPrivateKey);
    this.coldWalletAddress = config.coldWalletAddress;
    this.pumpPortalListener = new PumpPortalListener(config, logger, {
      onNewToken: async (event) => this.handlePumpPortalNewToken(event),
      onTrade: async (event) => this.handlePumpPortalTrade(event),
      onMigration: async (event) => this.handlePumpPortalMigration(event)
    });

    this.safetyGate = new SafetyGate(config);
    this.executionModeManager = new ExecutionModeManager(config, logger);
    this.sessionManager = new SessionManager(config, logger);
    this.accounting = new AccountingService();
    this.treasurySweeper = new TreasurySweeper(config, logger);
    this.telemetry = new Telemetry(config, logger);
    this.strategyLedger = new StrategyLedger(config, logger);
    this.qualityScorer = new QualityScorer(config);
    this.walletContext = new WalletContext(config, logger);
    this.telegramContext = new TelegramContext(config, logger);
    this.rickContext = new RickContext(config, logger);
    this.launchIntelStore = new LaunchIntelStore(config, logger);
    this.positionStore = new PositionStore(config, logger);
    this.eventFlow = new TradingEventFlow();
    this.poolStateLane = new PoolStateLane(config, logger);
    this.preMigrationWatchLane = new PreMigrationWatchLane(config, logger);
    this.preMigrationPaperLane = new PreMigrationPaperLane(config, logger);
    this.pumpBondingCurveLane = new PumpBondingCurveLane(config, logger, this.connection);
    this.candidateDossierLedger = new CandidateDossierLedger(config, logger);
    this.postMigrationContinuationLane = new PostMigrationContinuationLane(config, logger);

    this.currentPositions = new Map();
    this.paperPositions = new Map();
    this.rejectedTrades = [];
    this.latestPumpPortalTokens = new Map();
    this.tokenSignalCooldowns = new Map();
    this.lastTelegramSightingSyncAt = null;

    this.dailyPnL = 0;
    this.realizedPnL = 0;
    this.unrealizedPnL = 0;
    this.totalTrades = 0;
    this.active = false;

    this.hotWalletBalanceSol = 0;
    this.coldWalletBalanceSol = 0;
    this.paperWalletBalanceSol = config.paperStartingBalanceSol;
    this.openPositionValueSol = 0;
    this.totalEquitySol = 0;
    this.initialTotalEquitySol = null;
    this.entryStartTime = null;
    this.sessionId = null;
    this.filterRejectSnapshotCount = 0;
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
    this.logger.success(`Connected to Solana RPC: ${version['solana-core']}`);
    this.restorePersistedLivePositions();
    await this.reconcilePersistedLivePositions();
    await this.refreshCapitalState();
    this.syncTelegramSightings({ bootstrap: true });

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
    this.entryStartTime = Date.now();
    this.sessionId = `session_${this.entryStartTime}`;
    this.active = true;
    this.telemetry.record('session.started', {
      mode: this.executionModeManager.mode,
      sessionDurationMinutes: this.config.sessionDurationMinutes
    });
    this.strategyLedger.record('session.started', {
      sessionId: this.sessionId,
      mode: this.executionModeManager.mode,
      sessionDurationMinutes: this.config.sessionDurationMinutes,
      initialEquitySol: this.totalEquitySol
    });
    this.logger.info('Starting trading engine...');
    await this.pumpPortalListener.start();
    this.tradingLoop();
  }

  async stop(reason = 'STOPPED') {
    this.active = false;
    this.recordPreMigrationPaperEvents(this.preMigrationPaperLane.closeAll('SESSION_END'));
    if (this.executionModeManager.isPaper() && this.config.paperCloseOnSessionEnd) {
      this.closeAllPaperPositions('SESSION_END');
      await this.refreshCapitalState();
    }

    await this.pumpPortalListener.stop();
    this.persistLivePositions();
    this.launchIntelStore.flush(true);
    this.sessionManager.stop(reason);
    this.telemetry.record('session.stopped', {
      reason,
      stats: this.getStats()
    });
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
    this.logger.info('Stopping trading engine...');
  }

  async tradingLoop() {
    while (this.active) {
      try {
        if (!this.sessionManager.isTradeAllowed()) {
          this.logger.info('Session is no longer accepting trades');
          await this.stop('SESSION_CLOSED');
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
    await this.refreshCapitalState();
    await this.updatePositions();
    this.checkPreMigrationPaperPositions();
    await this.refreshCapitalState();

    if (this.isEntryWarmupActive()) {
      const marketData = await this.fetchMarketData();
      this.eventFlow.record('cycle.market_data_fetched', {
        cycleId,
        sourceCounts: marketData.sourceCounts
      });
      this.telemetry.record('cycle.completed', {
        sourceCounts: marketData.sourceCounts,
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
        strategyScores: aiDecision.strategyScores
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
        strategyScores: aiDecision.strategyScores
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
            executionProfile: aiReview.executionProfile || null
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
    const [solPrice, raydiumPools, meteoraPools, moonshotTokens] = await Promise.all([
      this.marketData.getSolanaPrice(),
      this.marketData.getRaydiumPools(),
      this.marketData.getMeteoraPools(),
      this.marketData.getMoonshotTokens()
    ]);

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
        let analysis = await this.marketData.analyzeToken(pool.mintAddress);
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

      signals.push({
        id: `sig_${token.mintAddress}_${Date.now()}`,
        token: token.mintAddress,
        action: 'buy',
        amount: tradeAmount,
        reasoning: 'Deterministic volume/liquidity/risk filter passed',
        qualityScore: quality.score,
        qualityFactors: quality.factors,
        momentumScore: momentum.score,
        momentumFactors: momentum.factors,
        rankScore: Number(rankScore.toFixed(4)),
        tokenInfo: token
      });
      this.applySignalCooldown(token.mintAddress, this.config.tokenSignalCooldownMs);

      this.logger.decision(`SIGNAL READY: ${token.mintAddress}`, {
        source: token.source,
        rankScore: Number(rankScore.toFixed(4)),
        qualityScore: quality.score,
        momentumScore: momentum.score,
        amountSol: Number(tradeAmount.toFixed(4))
      });

      this.telemetry.record('signal.generated', {
        token: token.mintAddress,
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
      } catch (error) {
        this.logger.warn(`Failed to update live position for ${token}`, error.message);
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

  buildPaperExitProfile(aiReview = {}) {
    const baseProfile = {
      stopLossPercent: this.config.paperStopLossPercent,
      takeProfitPercent: this.config.paperTakeProfitPercent,
      trailingActivationPercent: this.config.paperTrailingActivationPercent,
      trailingDrawdownPercent: this.config.paperTrailingDrawdownPercent,
      minProfitHoldSeconds: this.config.paperMinHoldSecondsForProfit,
      maxHoldMinutes: this.config.paperMaxHoldMinutes
    };

    const primaryStrategy = aiReview.primaryStrategy || 'SNIPER';
    const exitStyle = aiReview.executionProfile?.exitStyle || 'fixed';
    const expectedHold = aiReview.executionProfile?.expectedHold || 'short';

    switch (primaryStrategy) {
      case 'RUNNER_HUNTER':
        return {
          ...baseProfile,
          stopLossPercent: Math.max(baseProfile.stopLossPercent, 0.012),
          takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.04),
          trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.02),
          trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.008),
          minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 60),
          maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 12)
        };
      case 'SNIPER':
        return {
          ...baseProfile,
          stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.01),
          takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.02),
          trailingActivationPercent: Math.min(baseProfile.trailingActivationPercent, 0.015),
          trailingDrawdownPercent: Math.min(baseProfile.trailingDrawdownPercent, 0.006),
          minProfitHoldSeconds: Math.min(baseProfile.minProfitHoldSeconds, 30),
          maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 6)
        };
      case 'SCALPER':
        return {
          ...baseProfile,
          stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.008),
          takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.012),
          trailingActivationPercent: Math.min(baseProfile.trailingActivationPercent, 0.01),
          trailingDrawdownPercent: Math.min(baseProfile.trailingDrawdownPercent, 0.005),
          minProfitHoldSeconds: Math.min(baseProfile.minProfitHoldSeconds, 20),
          maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 4)
        };
      case 'MIGRATION_HUNTER':
        return {
          ...baseProfile,
          stopLossPercent: Math.max(baseProfile.stopLossPercent, 0.015),
          takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.03),
          trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.018),
          trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.007),
          minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 75),
          maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 14)
        };
      case 'WALLET_FLOW':
        return {
          ...baseProfile,
          stopLossPercent: Math.max(baseProfile.stopLossPercent, 0.013),
          takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.03),
          trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.018),
          trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.007),
          minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 60),
          maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 10)
        };
      default:
        break;
    }

    if (exitStyle === 'trailing_runner') {
      return {
        ...baseProfile,
        takeProfitPercent: Math.max(baseProfile.takeProfitPercent, 0.04),
        trailingActivationPercent: Math.max(baseProfile.trailingActivationPercent, 0.02),
        trailingDrawdownPercent: Math.max(baseProfile.trailingDrawdownPercent, 0.008),
        minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, expectedHold === 'short_to_medium' ? 60 : 45),
        maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, expectedHold === 'short_to_medium' ? 12 : baseProfile.maxHoldMinutes)
      };
    }

    if (exitStyle === 'tight_invalidation') {
      return {
        ...baseProfile,
        stopLossPercent: Math.min(baseProfile.stopLossPercent, 0.01),
        takeProfitPercent: Math.min(baseProfile.takeProfitPercent, 0.02),
        maxHoldMinutes: Math.min(baseProfile.maxHoldMinutes, 6)
      };
    }

    if (exitStyle === 'migration_hold' || exitStyle === 'flow_follow') {
      return {
        ...baseProfile,
        minProfitHoldSeconds: Math.max(baseProfile.minProfitHoldSeconds, 60),
        maxHoldMinutes: Math.max(baseProfile.maxHoldMinutes, 10)
      };
    }

    return baseProfile;
  }

  isPumpPortalToken(token) {
    return String(token.source || '').startsWith('pumpportal');
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
    const isMigration = token.routeType === 'migration' || token.bondingStage === 'recently_bonded';
    const minMigratedLiquidityUsd = Number(this.config.paperRunnerMinMigratedLiquidityUsd || 0);
    const migratedLiquidityUsd = this.getRunnerLiquidityUsd(token);

    if (
      this.executionModeManager.isPaper() &&
      this.config.paperRunnerModeEnabled &&
      this.config.paperRunnerRequirePumpMigration &&
      !isMigration
    ) {
      return {
        passed: false,
        reason: 'PUMP_FAIL_NOT_MIGRATED',
        values: {
          routeType: token.routeType || null,
          bondingStage: token.bondingStage || null
        },
        threshold: 'migration_or_recently_bonded'
      };
    }

    if (
      this.executionModeManager.isPaper() &&
      this.config.paperRunnerModeEnabled &&
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

  getEntryWarmupRemainingMs() {
    if (!this.entryStartTime || !this.config.entryWarmupMs) {
      return 0;
    }

    return Math.max(this.config.entryWarmupMs - (Date.now() - this.entryStartTime), 0);
  }

  observePreMigrationToken(token, launchIntelSummary = null) {
    const observedToken = this.isPumpPortalToken(token)
      ? {
          ...token,
          ...this.summarizePumpPortalMomentum(token)
        }
      : token;
    const result = this.preMigrationWatchLane.observeToken(observedToken, launchIntelSummary);
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

    this.telemetry.record(result.flagged ? 'pre_migration.flagged' : 'pre_migration.observed', {
      mint,
      symbol: result.state.symbol || null,
      score: result.state.score,
      reasons: result.state.reasons,
      observedSignal: Boolean(result.observedSignal),
      confirmed: Boolean(result.state.confirmed),
      newlyConfirmed: Boolean(result.newlyConfirmed),
      observedSignalCount: result.state.observedSignalCount,
      confirmedAt: result.state.confirmedAt,
      confirmationReason: result.state.confirmationReason,
      bondingCurveAddress: result.state.bondingCurveAddress,
      bondingCurveComplete: result.state.bondingCurveComplete,
      virtualSolReservesSol: result.state.virtualSolReservesSol,
      realSolReservesSol: result.state.realSolReservesSol,
      virtualTokenReservesTokens: result.state.virtualTokenReservesTokens,
      bondingCurvePriceSol: result.state.bondingCurvePriceSol,
      curveProgress: result.state.curveProgress,
      bondingStage: result.state.bondingStage,
      tradeVelocityPerMin: result.state.tradeVelocityPerMin,
      recentVolumeSol: result.state.recentVolumeSol
    });

    this.candidateDossierLedger.recordWatchState(result.state, {
      eventType: result.flagged ? 'watch.flagged' : 'watch.observed',
      flagged: Boolean(result.flagged),
      observedSignal: Boolean(result.observedSignal),
      confirmed: Boolean(result.state.confirmed),
      newlyConfirmed: Boolean(result.newlyConfirmed),
      confirmationReason: result.state.confirmationReason
    });

    this.recordPreMigrationPaperEvents(this.preMigrationPaperLane.observe(result.state, {
      flagged: Boolean(result.flagged),
      timestamp: new Date().toISOString()
    }));

    if (result.flagged) {
      this.eventFlow.record('pre_migration.flagged', {
        token: mint,
        score: result.state.score,
        reasons: result.state.reasons
      });
      this.logger.decision(`PRE-MIGRATION WATCH: ${mint}`, {
        symbol: result.state.symbol,
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
      this.eventFlow.record(event.telemetryType, {
        token: event.payload?.mint,
        reason: event.payload?.reason
      });

      if (event.type === 'entry') {
        this.logger.decision(`PRE-MIGRATION PAPER ENTRY: ${event.payload.mint}`, {
          symbol: event.payload.symbol,
          score: event.payload.score,
          curveProgress: event.payload.curveProgress,
          entryPriceSol: event.payload.entryPriceSol,
          amountSol: event.payload.amountSol
        });
      } else if (event.type === 'exit') {
        this.logger.decision(`PRE-MIGRATION PAPER EXIT: ${event.payload.mint}`, {
          symbol: event.payload.symbol,
          reason: event.payload.reason,
          pnlSol: event.payload.pnlSol,
          returnPct: event.payload.returnPct,
          holdSeconds: event.payload.holdSeconds
        });
      }
    }
  }

  async syncPumpBondingCurveState(mint, token = {}, options = {}) {
    if (!mint || !this.pumpBondingCurveLane?.enabled) {
      return null;
    }

    const summary = await this.pumpBondingCurveLane.observeMint(mint, token);
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
        bondingCurveAddress: summary.bondingCurveAddress,
        complete: summary.complete,
        curveProgress: summary.curveProgress,
        bondingStage: summary.bondingStage,
        virtualSolReservesSol: summary.virtualSolReservesSol,
        realSolReservesSol: summary.realSolReservesSol,
        virtualTokenReservesTokens: summary.virtualTokenReservesTokens,
        bondingCurvePriceSol: summary.priceSol
      });
    }

    if (options.observeAfterSync && summary.refreshed) {
      this.observePreMigrationToken(current, options.launchIntelSummary || current.launchIntelSummary || null);
    }

    return summary;
  }

  schedulePumpBondingCurveSync(mint, token = {}, launchIntelSummary = null) {
    if (!mint || !this.pumpBondingCurveLane?.isRefreshDue?.(mint)) {
      return;
    }

    this.syncPumpBondingCurveState(mint, token, {
      observeAfterSync: true,
      launchIntelSummary
    }).catch((error) => {
      this.logger.warn('Pump bonding curve async sync failed', {
        mint,
        error: error.message
      });
    });
  }

  async handlePumpPortalNewToken(event) {
    const mint = event.mint || event.token || event.mintAddress;
    if (!mint) {
      return;
    }

    this.latestPumpPortalTokens.set(mint, {
      mint,
      source: event.source,
      createdAt: Date.now(),
      symbol: event.symbol,
      name: event.name,
      marketCapSol: Number(event.marketCapSol || event.marketCap || 0),
      bondingStage: this.inferBondingStage(event),
      rawEvent: event
    });
    const launchIntelSummary = this.launchIntelStore.registerNewToken(event);
    if (launchIntelSummary) {
      const current = this.latestPumpPortalTokens.get(mint);
      current.launchIntelSummary = launchIntelSummary;
      this.latestPumpPortalTokens.set(mint, current);
    }
    this.observePreMigrationToken(this.latestPumpPortalTokens.get(mint), launchIntelSummary);
    this.schedulePumpBondingCurveSync(mint, this.latestPumpPortalTokens.get(mint), launchIntelSummary);
    this.telemetry.record('provider.pumpportal.new_token', { mint });
  }

  async handlePumpPortalTrade(event) {
    const mint = event.mint || event.token || event.mintAddress;
    if (!mint) {
      return;
    }

    const current = this.latestPumpPortalTokens.get(mint) || {
      mint,
      createdAt: Date.now()
    };

    current.lastTradeAt = Date.now();
    current.firstTradeAt = current.firstTradeAt || current.lastTradeAt;
    current.tradeCount = (current.tradeCount || 0) + 1;
    const tradeVolumeSol = Number(event.solAmount || event.vSolInBondingCurve || 0);
    current.volumeSol = (current.volumeSol || 0) + tradeVolumeSol;
    current.liquiditySol = Number(event.vSolInBondingCurve || current.liquiditySol || 0);
    current.marketCapSol = Number(event.marketCapSol || current.marketCapSol || 0);
    current.bondingStage = this.inferBondingStage(event, current.bondingStage);

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

    const trader = event.traderPublicKey || event.wallet || event.account;
    if (trader && this.config.pumpPortalTrackedAccounts.includes(trader)) {
      current.accountTradeCount = (current.accountTradeCount || 0) + 1;
    }

    current.rawTrade = event;
    const launchIntelSummary = this.launchIntelStore.registerTrade(event);
    if (launchIntelSummary) {
      current.launchIntelSummary = launchIntelSummary;
    }
    this.latestPumpPortalTokens.set(mint, current);
    this.observePreMigrationToken(current, launchIntelSummary);
    this.schedulePumpBondingCurveSync(mint, current, launchIntelSummary);
    this.telemetry.record('provider.pumpportal.trade', {
      mint,
      tradeCount: current.tradeCount
    });
  }

  async handlePumpPortalMigration(event) {
    const mint = event.mint || event.token || event.mintAddress;
    if (!mint) {
      return;
    }

    const current = this.latestPumpPortalTokens.get(mint) || {
      mint,
      createdAt: Date.now()
    };

    current.migratedAt = Date.now();
    current.bondingStage = 'recently_bonded';
    current.rawMigration = event;
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
    this.telemetry.record('provider.pumpportal.migration', { mint });
  }

  syncTelegramSightings({ bootstrap = false } = {}) {
    try {
      const sightings = this.telegramContext.getRecentMintSightings(
        bootstrap ? null : this.lastTelegramSightingSyncAt
      );
      this.lastTelegramSightingSyncAt = Date.now();

      if (!Array.isArray(sightings) || sightings.length === 0) {
        return;
      }

      let imported = 0;
      for (const sighting of sightings) {
        const summary = this.launchIntelStore.registerExternalSighting(sighting);
        if (summary) {
          imported += 1;
        }
      }

      if (imported > 0) {
        this.telemetry.record('provider.telegram.sightings_imported', {
          imported,
          bootstrap,
          uniqueMints: sightings.length
        });
        this.logger.info(`Imported ${imported} Telegram external sighting(s) into launch-intel`);
      }
    } catch (error) {
      this.logger.warn('Failed to sync Telegram external sightings', error.message);
      this.telemetry.record('provider.error', {
        provider: 'telegram_sightings',
        message: error.message
      });
    }
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
    const [hotWalletBalanceSol, coldWalletBalanceSol] = await Promise.all([
      WalletManager.getSolBalance(this.connection, this.hotWallet.getPublicKey()),
      WalletManager.getSolBalance(this.connection, this.coldWalletAddress)
    ]);

    this.hotWalletBalanceSol = hotWalletBalanceSol;
    this.coldWalletBalanceSol = coldWalletBalanceSol;
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

    return Number.POSITIVE_INFINITY;
  }

  hasEntryCapacity() {
    return this.getOpenEntrySlots() > 0 && this.getAvailableTradingCapitalSol() > 0;
  }

  async checkRiskManagement() {
    if (this.dailyPnL < -this.config.maxDailyLossSol) {
      this.logger.warn(`Daily loss limit reached: ${this.dailyPnL} SOL. Entering cooldown.`);
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
      pumpPortal: this.pumpPortalListener.getStats(),
      poolStateLane: this.poolStateLane.getStats(),
      pumpBondingCurveLane: this.pumpBondingCurveLane.getStats(),
      preMigrationWatch: this.preMigrationWatchLane.getStats(),
      preMigrationPaper: this.preMigrationPaperLane.getStats(),
      postMigrationContinuation: this.postMigrationContinuationLane.getStats(),
      candidateDossiers: this.candidateDossierLedger.getStats(),
      telemetry: this.telemetry.getSummary(),
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
