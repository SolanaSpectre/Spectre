class PreMigrationPaperLane {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.preMigrationPaperEnabled !== false;
    this.paperOnly = config.preMigrationPaperOnly !== false;
    this.minCurveProgressDelta = Number(config.preMigrationPaperMinCurveProgressDelta ?? 0.005);
    this.curveProgressLookbackMs = Number(config.preMigrationPaperCurveProgressLookbackMs ?? 2 * 60 * 1000);
    this.cloneGuardWindowMs = Number(config.preMigrationPaperCloneGuardWindowMs ?? 30 * 60 * 1000);
    this.cloneGuardMaxEntriesPerSymbol = Number(config.preMigrationPaperCloneGuardMaxEntriesPerSymbol ?? 1);
    this.badExitCooldownMs = Number(config.preMigrationPaperBadExitCooldownMs ?? 15 * 60 * 1000);
    this.sameMintReentryCooldownMs = Number(config.preMigrationPaperSameMintReentryCooldownMs ?? 2 * 60 * 1000);
    this.avoidWalletContextGuardEnabled = config.preMigrationPaperBlockAvoidWalletContext !== false;
    this.highConvictionFirstSightRequireWalletContext = config.preMigrationPaperHighConvictionFirstSightRequireWalletContext !== false;
    this.highCurveRequireWalletContext = config.preMigrationPaperHighCurveRequireWalletContext !== false;
    this.highCurveRequireWalletContextMinCurveProgress = Number(config.preMigrationPaperHighCurveRequireWalletContextMinCurveProgress ?? 0.88);
    this.highCurveWalletQualityGuardEnabled = config.preMigrationPaperHighCurveWalletQualityGuardEnabled !== false;
    this.highCurveWalletQualityMinCurveProgress = Number(config.preMigrationPaperHighCurveWalletQualityMinCurveProgress ?? 0.9);
    this.highCurveWalletQualityBlockPositiveSellAfterBuy = config.preMigrationPaperHighCurveWalletQualityBlockPositiveSellAfterBuy !== false;
    this.highCurveWalletQualityBlockLowSignalFirstTouch = config.preMigrationPaperHighCurveWalletQualityBlockLowSignalFirstTouch !== false;
    this.highCurveWalletQualityMaxSniperWalletCount = Number(config.preMigrationPaperHighCurveWalletQualityMaxSniperWalletCount ?? 7);
    this.lateFastTrackEnabled = config.preMigrationPaperLateFastTrackEnabled !== false;
    this.lateFastTrackMinScore = Number(config.preMigrationPaperLateFastTrackMinScore ?? 87);
    this.lateFastTrackMinCurveProgress = Number(config.preMigrationPaperLateFastTrackMinCurveProgress ?? 0.92);
    this.lateFastTrackMinRecentVolumeSol = Number(config.preMigrationPaperLateFastTrackMinRecentVolumeSol ?? 75);
    this.lateFastTrackMinTradeVelocityPerMin = Number(config.preMigrationPaperLateFastTrackMinTradeVelocityPerMin ?? 50);
    this.firstSightOverrideEnabled = config.preMigrationPaperFirstSightOverrideEnabled !== false;
    this.firstSightMinScore = Number(config.preMigrationPaperFirstSightMinScore ?? 84);
    this.firstSightMinCurveProgress = Number(config.preMigrationPaperFirstSightMinCurveProgress ?? 0.78);
    this.firstSightMaxCurveProgress = Number(config.preMigrationPaperFirstSightMaxCurveProgress ?? 0.95);
    this.firstSightMinRecentVolumeSol = Number(config.preMigrationPaperFirstSightMinRecentVolumeSol ?? 12);
    this.firstSightMinTradeVelocityPerMin = Number(config.preMigrationPaperFirstSightMinTradeVelocityPerMin ?? 12);
    this.firstSightMinBuyRatio = Number(config.preMigrationPaperFirstSightMinBuyRatio ?? 0.75);
    this.earlySurgeOverrideEnabled = config.preMigrationPaperEarlySurgeOverrideEnabled !== false;
    this.earlySurgeMinScore = Number(config.preMigrationPaperEarlySurgeMinScore ?? 75);
    this.earlySurgeMinCurveProgress = Number(config.preMigrationPaperEarlySurgeMinCurveProgress ?? 0.7);
    this.earlySurgeMaxCurveProgress = Number(config.preMigrationPaperEarlySurgeMaxCurveProgress ?? 0.82);
    this.earlySurgeMinRecentVolumeSol = Number(config.preMigrationPaperEarlySurgeMinRecentVolumeSol ?? 75);
    this.earlySurgeMinTradeVelocityPerMin = Number(config.preMigrationPaperEarlySurgeMinTradeVelocityPerMin ?? 60);
    this.earlySurgeMinBuyRatio = Number(config.preMigrationPaperEarlySurgeMinBuyRatio ?? 0.78);
    this.earlySurgeMinCurveProgressDelta = Number(config.preMigrationPaperEarlySurgeMinCurveProgressDelta ?? 0.035);
    this.earlySurgeNoBaselineMinScore = Number(config.preMigrationPaperEarlySurgeNoBaselineMinScore ?? 84);
    this.broadOrganicSurgeEnabled = config.preMigrationPaperBroadOrganicSurgeEnabled !== false;
    this.broadOrganicSurgeMinScore = Number(config.preMigrationPaperBroadOrganicSurgeMinScore ?? 75);
    this.broadOrganicSurgeMinCurveProgress = Number(config.preMigrationPaperBroadOrganicSurgeMinCurveProgress ?? 0.7);
    this.broadOrganicSurgeMaxCurveProgress = Number(config.preMigrationPaperBroadOrganicSurgeMaxCurveProgress ?? 0.82);
    this.broadOrganicSurgeMinRecentVolumeSol = Number(config.preMigrationPaperBroadOrganicSurgeMinRecentVolumeSol ?? 70);
    this.broadOrganicSurgeMinTradeVelocityPerMin = Number(config.preMigrationPaperBroadOrganicSurgeMinTradeVelocityPerMin ?? 90);
    this.broadOrganicSurgeMinUniqueBuyerRatio = Number(config.preMigrationPaperBroadOrganicSurgeMinUniqueBuyerRatio ?? 0.9);
    this.broadOrganicSurgeMinBuyRatio = Number(config.preMigrationPaperBroadOrganicSurgeMinBuyRatio ?? 0.7);
    this.curvePauseOverrideEnabled = config.preMigrationPaperCurvePauseOverrideEnabled !== false;
    this.curvePauseMinScore = Number(config.preMigrationPaperCurvePauseMinScore ?? 82);
    this.curvePauseMinCurveProgress = Number(config.preMigrationPaperCurvePauseMinCurveProgress ?? 0.75);
    this.curvePauseMaxCurveProgress = Number(config.preMigrationPaperCurvePauseMaxCurveProgress ?? 0.9);
    this.curvePauseMinRecentVolumeSol = Number(config.preMigrationPaperCurvePauseMinRecentVolumeSol ?? 12);
    this.curvePauseMinTradeVelocityPerMin = Number(config.preMigrationPaperCurvePauseMinTradeVelocityPerMin ?? 12);
    this.curvePauseMinBuyRatio = Number(config.preMigrationPaperCurvePauseMinBuyRatio ?? 0.4);
    this.firstCurveSnapshotScalpEnabled = config.preMigrationPaperFirstCurveSnapshotScalpEnabled !== false;
    this.firstCurveSnapshotScalpMinScore = Number(config.preMigrationPaperFirstCurveSnapshotScalpMinScore ?? 55);
    this.firstCurveSnapshotScalpMinCurveProgress = Number(config.preMigrationPaperFirstCurveSnapshotScalpMinCurveProgress ?? 0.7);
    this.firstCurveSnapshotScalpMaxCurveProgress = Number(config.preMigrationPaperFirstCurveSnapshotScalpMaxCurveProgress ?? 0.9);
    this.firstCurveSnapshotScalpMinRecentVolumeSol = Number(config.preMigrationPaperFirstCurveSnapshotScalpMinRecentVolumeSol ?? 0.25);
    this.firstCurveSnapshotScalpMinTradeVelocityPerMin = Number(config.preMigrationPaperFirstCurveSnapshotScalpMinTradeVelocityPerMin ?? 1.5);
    this.firstCurveSnapshotScalpMinInterestCount = Number(config.preMigrationPaperFirstCurveSnapshotScalpMinInterestCount ?? 3);
    this.firstCurveSnapshotScalpMinUniqueBuyerCount = Number(config.preMigrationPaperFirstCurveSnapshotScalpMinUniqueBuyerCount ?? 3);
    this.firstCurveSnapshotScalpMaxRiskWalletCount = Number(config.preMigrationPaperFirstCurveSnapshotScalpMaxRiskWalletCount ?? 1);
    this.firstCurveSnapshotScalpSniperCrowdingGuardEnabled = config.preMigrationPaperFirstCurveSnapshotScalpSniperCrowdingGuardEnabled !== false;
    this.firstCurveSnapshotScalpMaxSniperWalletCount = Number(config.preMigrationPaperFirstCurveSnapshotScalpMaxSniperWalletCount ?? 7);
    this.firstCurveSnapshotScalpMinBuyRatio = Number(config.preMigrationPaperFirstCurveSnapshotScalpMinBuyRatio ?? 0.45);
    this.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds = Number(config.preMigrationPaperFirstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds ?? 15);
    this.highCurveStaleSnapshotGuardEnabled = config.preMigrationPaperHighCurveStaleSnapshotGuardEnabled !== false;
    this.highCurveStaleSnapshotMinCurveProgress = Number(config.preMigrationPaperHighCurveStaleSnapshotMinCurveProgress ?? 0.9);
    this.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds = Number(
      config.preMigrationPaperHighCurveStaleSnapshotMaxCurveSnapshotAgeSeconds
        ?? this.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds
        ?? 30
    );
    this.logDecisionEvents = config.preMigrationPaperLogDecisionEvents !== false;
    this.earlyAccelerationMinScore = Number(config.preMigrationPaperEarlyAccelerationRunnerMinScore ?? 84.5);
    this.earlyAccelerationMinCurveProgress = Number(config.preMigrationPaperEarlyAccelerationRunnerMinCurveProgress ?? 0.88);
    this.earlyAccelerationMinRecentVolumeSol = Number(config.preMigrationPaperEarlyAccelerationRunnerMinRecentVolumeSol ?? 60);
    this.earlyAccelerationMinTradeVelocityPerMin = Number(config.preMigrationPaperEarlyAccelerationRunnerMinTradeVelocityPerMin ?? 40);
    this.earlyAccelerationWeakWalletFlowGuardEnabled = config.preMigrationPaperEarlyAccelerationBlockWeakWalletFlow !== false;
    this.earlyAccelerationWeakWalletFlowMinLowSignalTouches = Number(config.preMigrationPaperEarlyAccelerationWeakWalletFlowMinLowSignalTouches ?? 3);
    this.earlyAccelerationWeakWalletFlowMinLateSellSol = Number(config.preMigrationPaperEarlyAccelerationWeakWalletFlowMinLateSellSol ?? 1);
    this.earlyAccelerationAvoidWalletContextGuardEnabled = config.preMigrationPaperEarlyAccelerationBlockAvoidWalletContext !== false;
    this.curveFalseNegativeBridgeMinScore = Number(config.preMigrationPaperCurveFalseNegativeBridgeMinScore ?? 50);
    this.curveFalseNegativeBridgeMinCurveProgress = Number(config.preMigrationPaperCurveFalseNegativeBridgeMinCurveProgress ?? 0.3);
    this.curveFalseNegativeBridgeMaxCurveProgress = Number(config.preMigrationPaperCurveFalseNegativeBridgeMaxCurveProgress ?? 0.9);
    this.curveFalseNegativeBridgeMinRecentVolumeSol = Number(config.preMigrationPaperCurveFalseNegativeBridgeMinRecentVolumeSol ?? 12);
    this.curveFalseNegativeBridgeMinTradeVelocityPerMin = Number(config.preMigrationPaperCurveFalseNegativeBridgeMinTradeVelocityPerMin ?? 12);
    this.curveFalseNegativeBridgeMinBuyRatio = Number(config.preMigrationPaperCurveFalseNegativeBridgeMinBuyRatio ?? 0.4);
    this.curveFalseNegativeBridgeRequirePositiveWallet = config.preMigrationPaperCurveFalseNegativeBridgeRequirePositiveWallet === true;
    this.curveFalseNegativeBridgeMaxEntriesPerRun = Number(config.preMigrationPaperCurveFalseNegativeBridgeMaxEntriesPerRun ?? 3);
    this.curveFalseNegativeBridgePaperEntriesEnabled = config.preMigrationPaperCurveFalseNegativeBridgePaperEntriesEnabled === true;
    this.curveFalseNegativeBridgeRecoveryShadowEnabled = config.preMigrationPaperCurveFalseNegativeBridgeRecoveryShadowEnabled !== false;
    this.curveFalseNegativeBridgeRequireRecoveryForEntries = config.preMigrationPaperCurveFalseNegativeBridgeRequireRecoveryForEntries !== false;
    this.curveFalseNegativeBridgeRequireNoSellForEntries = config.preMigrationPaperCurveFalseNegativeBridgeRequireNoSellForEntries !== false;
    this.curveFalseNegativeBridgeRequireParityForEntries = config.preMigrationPaperCurveFalseNegativeBridgeRequireParityForEntries !== false;
    this.curveFalseNegativeBridgeRecoveryMinConsecutiveAdvances = Math.max(1, Number(config.preMigrationPaperCurveFalseNegativeBridgeRecoveryMinConsecutiveAdvances ?? 2));
    this.curveFalseNegativeBridgeRecoveryLookbackMs = Math.max(1000, Number(config.preMigrationPaperCurveFalseNegativeBridgeRecoveryLookbackMs ?? 30_000));
    this.curveFalseNegativeBridgeRecoveryMinAdvance = Number(config.preMigrationPaperCurveFalseNegativeBridgeRecoveryMinAdvance ?? 0.003);
    this.curveFalseNegativeBridgeParityMaxDelta = Number(config.preMigrationPaperCurveFalseNegativeBridgeParityMaxDelta ?? 0.03);
    this.unflaggedEntryShadowEnabled = config.preMigrationPaperUnflaggedEntryShadowEnabled !== false;
    this.unflaggedEntryShadowMinScore = Number(config.preMigrationPaperUnflaggedEntryShadowMinScore ?? 70);
    this.unflaggedEntryShadowMinCurveProgress = Number(config.preMigrationPaperUnflaggedEntryShadowMinCurveProgress ?? 0.7);
    this.unflaggedEntryShadowMinRecentVolumeSol = Number(config.preMigrationPaperUnflaggedEntryShadowMinRecentVolumeSol ?? 12);
    this.unflaggedEntryShadowMinTradeVelocityPerMin = Number(config.preMigrationPaperUnflaggedEntryShadowMinTradeVelocityPerMin ?? 12);
    this.presets = this.buildPresets(config);
    this.strategy = this.presets[0]?.strategy || {
      minScore: config.preMigrationPaperMinScore,
      minCurveProgress: config.preMigrationPaperMinCurveProgress,
      minRecentVolumeSol: config.preMigrationPaperMinRecentVolumeSol,
      minTradeVelocityPerMin: config.preMigrationPaperMinTradeVelocityPerMin,
      takeProfitPct: config.preMigrationPaperTakeProfitPct,
      stopLossPct: config.preMigrationPaperStopLossPct,
      maxHoldSeconds: config.preMigrationPaperMaxHoldSeconds,
      amountSol: config.preMigrationPaperAmountSol
    };
    this.openPositions = new Map();
    this.closedPositions = [];
    this.stats = {
      enabled: this.enabled,
      entries: 0,
      exits: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      lastEntryAt: null,
      lastExitAt: null,
      decisionCounts: {},
      skipReasonCounts: {},
      eligibleCounts: {},
      exitReasonCounts: {},
      presets: {},
      lanes: {},
      profiles: {},
      observed: 0,
      observedFlagged: 0,
      observedUnflagged: 0,
      observedWithOpenPosition: 0
    };
    this.lastObservedStates = new Map();
    this.observationHistory = new Map();
    this.symbolEntryHistory = new Map();
    this.badExitCooldowns = new Map();
    this.sameMintExitCooldowns = new Map();

    for (const preset of this.presets) {
      this.stats.presets[preset.name] = this.createPresetStats(preset.strategy);
      this.ensureLaneStats(preset.lane);
      this.ensureProfileStats(preset.profileName, preset.exitProfile);
    }
  }

  observe(state = {}, options = {}) {
    if (!this.enabled || !state?.mint) {
      return [];
    }

    const events = [];
    const mint = state.mint;
    const timestamp = options.timestamp || new Date().toISOString();
    const price = this.getPrice(state);
    const history = this.observationHistory.get(mint) || [];
    const observedState = options.walletClassificationContext
      ? { ...state, walletClassificationContext: options.walletClassificationContext }
      : state;
    const flagged = options.flagged === true;
    this.stats.observed += 1;
    if (flagged) {
      this.stats.observedFlagged += 1;
    } else {
      this.stats.observedUnflagged += 1;
    }
    if (this.getActivePositionForMint(mint)) {
      this.stats.observedWithOpenPosition += 1;
    }
    this.rememberObservation(observedState, timestamp, price);
    const entryGuards = this.evaluateEntryGuards(observedState, history, timestamp);
    const firstCurveNearMiss = this.firstCurveSnapshotNearMissEvent(observedState, history, timestamp);
    if (firstCurveNearMiss) {
      events.push(firstCurveNearMiss);
    }

    for (const preset of this.presets) {
      const key = this.positionKey(preset.name, mint);
      const position = this.openPositions.get(key);
      let exitedThisObservation = false;

      if (position && Number.isFinite(price) && price > 0) {
        const exit = this.evaluateExit(position, observedState, timestamp, price);
        if (exit) {
          events.push(exit);
          exitedThisObservation = true;
        }
      }

      if (
        !exitedThisObservation
        && !this.openPositions.has(key)
        && flagged
      ) {
        const cooldown = this.getBadExitCooldown(mint, timestamp);
        if (cooldown.active) {
          events.push(this.guardAttributionEvent(observedState, timestamp, preset, {
            passed: false,
            reason: 'RECENT_BAD_EXIT_COOLDOWN',
            badExitCooldownUntil: cooldown.until,
            badExitCooldownRemainingMs: cooldown.remainingMs,
            badExitCooldownReason: cooldown.reason,
            badExitCooldownPreset: cooldown.presetName
          }, entryGuards, {
            flagged: true,
            suppressedPresetIneligible: false
          }));
          events.push(this.decisionEvent('PAPER_SKIPPED', observedState, timestamp, preset, {
            passed: false,
            reason: 'RECENT_BAD_EXIT_COOLDOWN',
            badExitCooldownUntil: cooldown.until,
            badExitCooldownRemainingMs: cooldown.remainingMs,
            badExitCooldownReason: cooldown.reason,
            badExitCooldownPreset: cooldown.presetName
          }));
          continue;
        }

        const sameMintCooldown = this.getSameMintExitCooldown(mint, timestamp);
        if (sameMintCooldown.active) {
          events.push(this.guardAttributionEvent(observedState, timestamp, preset, {
            passed: false,
            reason: 'RECENT_SAME_MINT_EXIT_COOLDOWN',
            sameMintCooldownUntil: sameMintCooldown.until,
            sameMintCooldownRemainingMs: sameMintCooldown.remainingMs,
            sameMintCooldownReason: sameMintCooldown.reason,
            sameMintCooldownPreset: sameMintCooldown.presetName
          }, entryGuards, {
            flagged: true,
            suppressedPresetIneligible: false
          }));
          events.push(this.decisionEvent('PAPER_SKIPPED', observedState, timestamp, preset, {
            passed: false,
            reason: 'RECENT_SAME_MINT_EXIT_COOLDOWN',
            sameMintCooldownUntil: sameMintCooldown.until,
            sameMintCooldownRemainingMs: sameMintCooldown.remainingMs,
            sameMintCooldownReason: sameMintCooldown.reason,
            sameMintCooldownPreset: sameMintCooldown.presetName
          }));
          continue;
        }

        const decision = this.evaluateEntryDecision(observedState, preset, entryGuards, timestamp);
        const recoveryShadow = preset.name === 'curveFalseNegativeWalletBridge'
          ? this.curveFalseNegativeBridgeRecoveryShadowEvent(observedState, preset, entryGuards, timestamp)
          : null;
        if (recoveryShadow) {
          events.push(recoveryShadow);
        }
        events.push(this.guardAttributionEvent(observedState, timestamp, preset, decision, entryGuards, {
          flagged: true,
          suppressedPresetIneligible: decision.reason === 'PRESET_NOT_ELIGIBLE_FOR_GUARD_OVERRIDE'
        }));
        if (decision.passed) {
          const activePosition = this.getActivePositionForMint(mint);
          if (activePosition) {
            events.push(this.decisionEvent(
              'PAPER_SHADOWED',
              observedState,
              timestamp,
              preset,
              this.buildShadowDecision(decision, activePosition)
            ));
          } else {
            events.push(this.decisionEvent('PAPER_ELIGIBLE', observedState, timestamp, preset, decision));
            events.push(this.enter(observedState, timestamp, preset, decision));
          }
        } else if (decision.reason !== 'PRESET_NOT_ELIGIBLE_FOR_GUARD_OVERRIDE') {
          // guard_attribution still records this intentionally suppressed PAPER_SKIPPED case.
          events.push(this.decisionEvent('PAPER_SKIPPED', observedState, timestamp, preset, decision));
        }
      } else if (
        !flagged
        && !exitedThisObservation
        && !this.openPositions.has(key)
        && this.shouldShadowUnflaggedEntry(observedState)
      ) {
        const decision = this.evaluateEntryDecision(observedState, preset, entryGuards, timestamp);
        events.push(this.guardAttributionEvent(observedState, timestamp, preset, decision, entryGuards, {
          flagged: false,
          shadowOnly: true,
          shadowReason: 'UNFLAGGED_ENTRY_FUNNEL_SHADOW',
          suppressedPresetIneligible: decision.reason === 'PRESET_NOT_ELIGIBLE_FOR_GUARD_OVERRIDE'
        }));
      }
    }

    return events;
  }

  shouldShadowUnflaggedEntry(state = {}) {
    if (!this.unflaggedEntryShadowEnabled) {
      return false;
    }

    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);

    return (
      (Number.isFinite(score) && score >= this.unflaggedEntryShadowMinScore)
      || (Number.isFinite(curveProgress) && curveProgress >= this.unflaggedEntryShadowMinCurveProgress)
      || (Number.isFinite(recentVolumeSol) && recentVolumeSol >= this.unflaggedEntryShadowMinRecentVolumeSol)
      || (Number.isFinite(tradeVelocityPerMin) && tradeVelocityPerMin >= this.unflaggedEntryShadowMinTradeVelocityPerMin)
    );
  }

  buildPresets(config) {
    const strictMigration = {
      name: 'strictMigration',
      lane: 'PRE_MIGRATION_RUNNER_WATCH',
      profileName: 'pre_migration_runner_watch',
      strategy: {
        minScore: config.preMigrationPaperMinScore,
        minCurveProgress: config.preMigrationPaperMinCurveProgress,
        maxCurveProgress: config.preMigrationPaperMaxCurveProgress,
        minRecentVolumeSol: config.preMigrationPaperMinRecentVolumeSol,
        minTradeVelocityPerMin: config.preMigrationPaperMinTradeVelocityPerMin,
        takeProfitPct: config.preMigrationPaperTakeProfitPct,
        stopLossPct: config.preMigrationPaperStopLossPct,
        maxHoldSeconds: config.preMigrationPaperMaxHoldSeconds,
        amountSol: config.preMigrationPaperAmountSol
      }
    };
    const highConfidenceRunner = {
      name: 'highConfidenceRunner',
      lane: 'PRE_MIGRATION_RUNNER_WATCH',
      profileName: 'pre_migration_runner_watch',
      strategy: {
        minScore: config.preMigrationPaperHighConfidenceRunnerMinScore,
        minCurveProgress: config.preMigrationPaperHighConfidenceRunnerMinCurveProgress,
        minRecentVolumeSol: config.preMigrationPaperHighConfidenceRunnerMinRecentVolumeSol,
        minTradeVelocityPerMin: config.preMigrationPaperHighConfidenceRunnerMinTradeVelocityPerMin,
        takeProfitPct: config.preMigrationPaperHighConfidenceRunnerTakeProfitPct,
        stopLossPct: config.preMigrationPaperHighConfidenceRunnerStopLossPct,
        maxHoldSeconds: config.preMigrationPaperHighConfidenceRunnerMaxHoldSeconds,
        amountSol: config.preMigrationPaperAmountSol
      }
    };
    const earlyAccelerationRunner = {
      name: 'earlyAccelerationRunner',
      lane: 'PRE_MIGRATION_SCALP',
      profileName: 'pre_migration_scalp',
      strategy: {
        minScore: config.preMigrationPaperEarlyAccelerationRunnerMinScore,
        minCurveProgress: config.preMigrationPaperEarlyAccelerationRunnerMinCurveProgress,
        maxCurveProgress: config.preMigrationPaperEarlyAccelerationRunnerMaxCurveProgress,
        minRecentVolumeSol: config.preMigrationPaperEarlyAccelerationRunnerMinRecentVolumeSol,
        minTradeVelocityPerMin: config.preMigrationPaperEarlyAccelerationRunnerMinTradeVelocityPerMin,
        takeProfitPct: config.preMigrationPaperEarlyAccelerationRunnerTakeProfitPct,
        stopLossPct: config.preMigrationPaperEarlyAccelerationRunnerStopLossPct,
        maxHoldSeconds: config.preMigrationPaperEarlyAccelerationRunnerMaxHoldSeconds,
        amountSol: config.preMigrationPaperAmountSol
      }
    };
    const highConvictionFirstSight = {
      name: 'highConvictionFirstSight',
      lane: 'PRE_MIGRATION_SNIPE',
      profileName: 'pre_migration_snipe',
      strategy: {
        minScore: config.preMigrationPaperHighConvictionFirstSightMinScore,
        minCurveProgress: config.preMigrationPaperHighConvictionFirstSightMinCurveProgress,
        minRecentVolumeSol: config.preMigrationPaperHighConvictionFirstSightMinRecentVolumeSol,
        minTradeVelocityPerMin: config.preMigrationPaperHighConvictionFirstSightMinTradeVelocityPerMin,
        minBuyRatio: config.preMigrationPaperHighConvictionFirstSightMinBuyRatio,
        takeProfitPct: config.preMigrationPaperHighConvictionFirstSightTakeProfitPct,
        stopLossPct: config.preMigrationPaperHighConvictionFirstSightStopLossPct,
        maxHoldSeconds: config.preMigrationPaperHighConvictionFirstSightMaxHoldSeconds,
        amountSol: config.preMigrationPaperAmountSol
      }
    };
    const curveFalseNegativeWalletBridge = {
      name: 'curveFalseNegativeWalletBridge',
      lane: 'PRE_MIGRATION_CURVE_FALSE_NEGATIVE_BRIDGE',
      profileName: 'pre_migration_curve_false_negative_wallet_bridge',
      maxEntriesPerRun: config.preMigrationPaperCurveFalseNegativeBridgeMaxEntriesPerRun,
      strategy: {
        minScore: config.preMigrationPaperCurveFalseNegativeBridgeMinScore,
        minCurveProgress: config.preMigrationPaperCurveFalseNegativeBridgeMinCurveProgress,
        maxCurveProgress: config.preMigrationPaperCurveFalseNegativeBridgeMaxCurveProgress,
        minRecentVolumeSol: config.preMigrationPaperCurveFalseNegativeBridgeMinRecentVolumeSol,
        minTradeVelocityPerMin: config.preMigrationPaperCurveFalseNegativeBridgeMinTradeVelocityPerMin,
        minBuyRatio: config.preMigrationPaperCurveFalseNegativeBridgeMinBuyRatio,
        takeProfitPct: config.preMigrationPaperCurveFalseNegativeBridgeTakeProfitPct,
        stopLossPct: config.preMigrationPaperCurveFalseNegativeBridgeStopLossPct,
        maxHoldSeconds: config.preMigrationPaperCurveFalseNegativeBridgeMaxHoldSeconds,
        amountSol: config.preMigrationPaperAmountSol
      }
    };

    const enabled = String(config.preMigrationPaperEnabledPresets || 'strictMigration,highConfidenceRunner,earlyAccelerationRunner,highConvictionFirstSight,curveFalseNegativeWalletBridge')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const presets = [strictMigration, highConfidenceRunner, earlyAccelerationRunner, highConvictionFirstSight, curveFalseNegativeWalletBridge]
      .filter((preset) => enabled.includes(preset.name))
      .map((preset) => ({
        ...preset,
        exitProfile: this.buildExitProfile(preset.profileName, preset.strategy)
      }));
    return presets.length > 0
      ? presets
      : [{
        ...strictMigration,
        exitProfile: this.buildExitProfile(strictMigration.profileName, strictMigration.strategy)
      }];
  }

  buildExitProfile(profileName, strategy = {}) {
    const base = {
      profileName: profileName || 'pre_migration_runner_watch',
      takeProfitPct: Number(strategy.takeProfitPct),
      stopLossPct: Number(strategy.stopLossPct),
      maxHoldSeconds: Number(strategy.maxHoldSeconds),
      breakevenStopEnabled: true,
      breakevenActivationPct: 0.12,
      breakevenStopPct: 0.005,
      sellPressureExitEnabled: true,
      sellPressureBuyRatioThreshold: 0.45,
      sellPressureMinHoldSeconds: 30,
      trailingGivebackEnabled: true,
      trailingActivationPct: 0.08,
      trailingGivebackPct: 0.08,
      curveStallExitEnabled: true,
      curveStallSeconds: 120,
      curveStallMinProgressAdvance: 0.012
    };

    if (profileName === 'pre_migration_scalp') {
      return {
        ...base,
        breakevenActivationPct: 0.08,
        sellPressureBuyRatioThreshold: 0.48,
        sellPressureMinHoldSeconds: 15,
        curveStallSeconds: 60,
        curveStallMinProgressAdvance: 0.01
      };
    }

    if (profileName === 'pre_migration_snipe') {
      return {
        ...base,
        breakevenActivationPct: 0.05,
        sellPressureBuyRatioThreshold: 0.5,
        sellPressureMinHoldSeconds: 8,
        curveStallSeconds: 35,
        curveStallMinProgressAdvance: 0.006
      };
    }

    if (profileName === 'pre_migration_curve_false_negative_wallet_bridge') {
      return {
        ...base,
        breakevenActivationPct: 0.15,
        breakevenStopPct: 0.08,
        sellPressureBuyRatioThreshold: 0.45,
        sellPressureMinHoldSeconds: 8,
        curveStallSeconds: 45,
        curveStallMinProgressAdvance: 0.015
      };
    }

    return base;
  }

  createPresetStats(strategy) {
    return {
      strategy,
      entries: 0,
      exits: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      openPositions: 0,
      closedTrades: 0,
      winRate: null,
      decisionCounts: {},
      skipReasonCounts: {},
      eligibleCount: 0,
      exitReasonCounts: {}
    };
  }

  evaluateEntryDecision(state, preset, entryGuards, timestamp = new Date().toISOString()) {
    if (preset.name === 'curveFalseNegativeWalletBridge') {
      return this.evaluateCurveFalseNegativeWalletBridgeDecision(state, preset, entryGuards, timestamp);
    }

    const capDecision = this.evaluatePresetEntryCap(preset);
    if (!capDecision.passed) {
      return capDecision;
    }

    if (!entryGuards.passed) {
      return entryGuards;
    }

    if (preset.name === 'highConvictionFirstSight' && !entryGuards.guardOverride) {
      return {
        passed: false,
        reason: 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE'
      };
    }

    if (
      Array.isArray(entryGuards.allowedPresetNames)
      && !entryGuards.allowedPresetNames.includes(preset.name)
    ) {
      return {
        passed: false,
        reason: 'PRESET_NOT_ELIGIBLE_FOR_GUARD_OVERRIDE',
        guardOverride: entryGuards.guardOverride,
        allowedPresetNames: entryGuards.allowedPresetNames
      };
    }

    const walletContextGuard = this.evaluateRequiredWalletContextGuard(state, preset);
    if (!walletContextGuard.passed) {
      return {
        ...entryGuards,
        ...walletContextGuard
      };
    }

    const highCurveWalletContextGuard = this.evaluateHighCurveRequiredWalletContextGuard(state, preset);
    if (!highCurveWalletContextGuard.passed) {
      return {
        ...entryGuards,
        ...highCurveWalletContextGuard
      };
    }

    const highCurveWalletQualityGuard = this.evaluateHighCurveWalletQualityGuard(state, preset);
    if (!highCurveWalletQualityGuard.passed) {
      return {
        ...entryGuards,
        ...highCurveWalletQualityGuard
      };
    }

    const weakWalletFlowGuard = this.evaluateEarlyAccelerationWeakWalletFlowGuard(state, preset, entryGuards);
    if (!weakWalletFlowGuard.passed) {
      return {
        ...entryGuards,
        ...weakWalletFlowGuard
      };
    }

    const avoidWalletContextGuard = this.evaluateAvoidWalletContextGuard(state, preset);
    if (!avoidWalletContextGuard.passed) {
      return {
        ...entryGuards,
        ...avoidWalletContextGuard
      };
    }

    const effectiveStrategy = entryGuards.thresholdOverrides
      ? { ...preset.strategy, ...entryGuards.thresholdOverrides }
      : preset.strategy;
    const thresholdDecision = this.evaluateStrategyThresholds(state, effectiveStrategy);
    if (!thresholdDecision.passed) {
      return thresholdDecision;
    }

    return {
      ...entryGuards,
      ...thresholdDecision,
      effectiveStrategy,
      thresholdOverrides: entryGuards.thresholdOverrides || null
    };
  }

  evaluatePresetEntryCap(preset = {}) {
    const maxEntries = Number(preset.maxEntriesPerRun);
    if (!Number.isFinite(maxEntries) || maxEntries < 0) {
      return { passed: true };
    }

    const entries = Number(this.stats.presets[preset.name]?.entries || 0);
    if (entries >= maxEntries) {
      return {
        passed: false,
        reason: 'PRESET_MAX_ENTRIES_PER_RUN',
        value: entries,
        threshold: maxEntries
      };
    }

    return { passed: true };
  }

  evaluateCurveFalseNegativeWalletBridgeDecision(state, preset, entryGuards, timestamp = new Date().toISOString()) {
    if (entryGuards?.passed) {
      return {
        passed: false,
        reason: 'CURVE_FALSE_NEGATIVE_BRIDGE_REQUIRES_STALLED_CURVE'
      };
    }

    if (entryGuards?.reason !== 'CURVE_NOT_ADVANCING') {
      return {
        passed: false,
        reason: 'CURVE_FALSE_NEGATIVE_BRIDGE_SOURCE_REASON_MISMATCH',
        sourceReason: entryGuards?.reason || null
      };
    }

    const bridge = this.evaluateCurveFalseNegativeWalletBridgeSupport(state);
    if (!bridge.passed) {
      return {
        ...entryGuards,
        ...bridge,
        passed: false
      };
    }

    if (!this.curveFalseNegativeBridgePaperEntriesEnabled) {
      return {
        ...entryGuards,
        ...bridge,
        passed: false,
        reason: 'CURVE_FALSE_NEGATIVE_BRIDGE_PAPER_ENTRY_PAUSED_FOR_RECOVERY_SHADOW',
        bridgePaperEntryPaused: true,
        bridgeRecoveryShadowEnabled: this.curveFalseNegativeBridgeRecoveryShadowEnabled
      };
    }

    const capDecision = this.evaluatePresetEntryCap(preset);
    if (!capDecision.passed) {
      return capDecision;
    }

    const history = this.observationHistory.get(state.mint) || [];
    const recovery = this.curveFalseNegativeBridgeRequireRecoveryForEntries
      ? this.evaluateCurveRecoveryConfirmation(history, timestamp)
      : { passed: true };
    if (!recovery.passed) {
      return {
        ...entryGuards,
        ...bridge,
        ...recovery,
        passed: false
      };
    }

    const noSell = this.curveFalseNegativeBridgeRequireNoSellForEntries
      ? this.evaluateNoTrackedSellAfterQualifyingBuy(state, bridge)
      : { passed: true };
    if (!noSell.passed) {
      return {
        ...entryGuards,
        ...bridge,
        ...recovery,
        ...noSell,
        passed: false
      };
    }

    const parity = this.curveFalseNegativeBridgeRequireParityForEntries
      ? this.evaluateBridgeCurveParity(state)
      : { passed: true };
    if (!parity.passed) {
      return {
        ...entryGuards,
        ...bridge,
        ...recovery,
        ...noSell,
        ...parity,
        passed: false
      };
    }

    const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(state, timestamp, 'CURVE_FALSE_NEGATIVE_WALLET_BRIDGE');
    if (staleGuard.blocked) {
      return {
        ...entryGuards,
        ...bridge,
        ...recovery,
        ...noSell,
        ...parity,
        ...staleGuard,
        passed: false,
        reason: 'HIGH_CURVE_STALE_CURVE_UPDATE'
      };
    }

    const cloneGuard = this.evaluateCloneGuard(state, timestamp);
    if (!cloneGuard.passed) {
      return {
        ...entryGuards,
        ...bridge,
        ...recovery,
        ...noSell,
        ...parity,
        ...cloneGuard,
        passed: false
      };
    }

    const thresholdDecision = this.evaluateStrategyThresholds(state, preset.strategy);
    if (!thresholdDecision.passed) {
      return {
        ...entryGuards,
        ...bridge,
        ...recovery,
        ...noSell,
        ...parity,
        ...thresholdDecision,
        passed: false
      };
    }

    return {
      ...entryGuards,
      ...bridge,
      ...recovery,
      ...noSell,
      ...parity,
      ...thresholdDecision,
      ...staleGuard,
      ...cloneGuard,
      passed: true,
      reason: null,
      guardOverride: 'CURVE_FALSE_NEGATIVE_WALLET_BRIDGE',
      effectiveStrategy: preset.strategy,
      thresholdOverrides: null
    };
  }

  evaluateCurveFalseNegativeWalletBridgeSupport(state = {}) {
    const context = state.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets.slice() : [];
    const sortedWallets = wallets.sort((a, b) => {
      const atA = new Date(a.tradeAt || 0).getTime();
      const atB = new Date(b.tradeAt || 0).getTime();
      return atA - atB;
    });
    const curveProgress = Number(state.curveProgress);
    const isPre85 = (wallet) => {
      const walletCurve = Number(wallet.curveProgress);
      return !Number.isFinite(walletCurve) || walletCurve < 0.85 || wallet.phase === 'fresh_launch' || wallet.phase === 'pre_migration';
    };
    const isPositiveOrProven = (wallet) => (
      ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(wallet.evidenceTier)
      || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(wallet.reviewTier)
    );
    const isAvoidOrNegative = (wallet) => (
      wallet.reviewTier === 'AVOID_REVIEW' || wallet.evidenceTier === 'NEGATIVE_EVIDENCE'
    );
    const trackedFirstTouchBuy = sortedWallets.find((wallet) =>
      String(wallet.side || '').toLowerCase() === 'buy' && isPre85(wallet)
    );
    const positiveFirstTouchBuy = sortedWallets.find((wallet) =>
      String(wallet.side || '').toLowerCase() === 'buy' && isPre85(wallet) && isPositiveOrProven(wallet)
    );
    const avoidTouches = sortedWallets.filter(isAvoidOrNegative);
    const buyTouches = sortedWallets.filter((wallet) => String(wallet.side || '').toLowerCase() === 'buy');
    const pre85BuyTouches = buyTouches.filter(isPre85);
    const positiveOrProvenTouches = sortedWallets.filter(isPositiveOrProven);
    const walletBridgeProof = {
      walletTouchCount: sortedWallets.length,
      walletBuyTouchCount: buyTouches.length,
      pre85BuyTouchCount: pre85BuyTouches.length,
      positiveOrProvenTouchCount: positiveOrProvenTouches.length,
      avoidTouchCount: avoidTouches.length,
      bridgeRequiresPositiveWallet: this.curveFalseNegativeBridgeRequirePositiveWallet,
      earliestWalletTouch: sortedWallets[0] ? this.walletTouchPayload(sortedWallets[0]) : null,
      earliestWalletBuy: buyTouches[0] ? this.walletTouchPayload(buyTouches[0]) : null,
      earliestPre85BuyTouch: pre85BuyTouches[0] ? this.walletTouchPayload(pre85BuyTouches[0]) : null,
      walletContextSource: context.contextSource || null,
      walletContextEarliestTouchAt: context.earliestTouchAt || null,
      walletContextEarliestBuyAt: context.earliestBuyAt || null
    };

    if (!trackedFirstTouchBuy) {
      return {
        passed: false,
        reason: 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY',
        ...walletBridgeProof
      };
    }

    if (this.curveFalseNegativeBridgeRequirePositiveWallet && !positiveFirstTouchBuy) {
      return {
        passed: false,
        reason: 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_POSITIVE_WALLET_TOUCH',
        trackedFirstTouchBuy: this.walletTouchPayload(trackedFirstTouchBuy),
        ...walletBridgeProof
      };
    }

    if (avoidTouches.length > 0) {
      return {
        passed: false,
        reason: 'CURVE_FALSE_NEGATIVE_BRIDGE_AVOID_WALLET_TOUCH',
        trackedFirstTouchBuy: this.walletTouchPayload(trackedFirstTouchBuy),
        positiveFirstTouchBuy: positiveFirstTouchBuy ? this.walletTouchPayload(positiveFirstTouchBuy) : null,
        firstAvoidTouch: avoidTouches[0] ? this.walletTouchPayload(avoidTouches[0]) : null,
        ...walletBridgeProof
      };
    }

    return {
      passed: true,
      guardOverride: 'CURVE_FALSE_NEGATIVE_WALLET_BRIDGE',
      trackedFirstTouchBuy: this.walletTouchPayload(trackedFirstTouchBuy),
      positiveFirstTouchBuy: positiveFirstTouchBuy ? this.walletTouchPayload(positiveFirstTouchBuy) : null,
      ...walletBridgeProof,
      bridgeCurveProgress: this.compact(curveProgress, 6)
    };
  }

  curveFalseNegativeBridgeRecoveryShadowEvent(state, preset, entryGuards, timestamp = new Date().toISOString()) {
    if (!this.curveFalseNegativeBridgeRecoveryShadowEnabled) {
      return null;
    }

    const history = this.observationHistory.get(state.mint) || [];
    const bridge = this.evaluateCurveFalseNegativeWalletBridgeSupport(state);
    const thresholdDecision = this.evaluateStrategyThresholds(state, preset.strategy);
    const recovery = this.evaluateCurveRecoveryConfirmation(history, timestamp);
    const noSell = this.evaluateNoTrackedSellAfterQualifyingBuy(state, bridge);
    const parity = this.evaluateBridgeCurveParity(state);
    const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(state, timestamp, 'CURVE_FALSE_NEGATIVE_WALLET_BRIDGE_RECOVERY_SHADOW');
    const sourceEligible = entryGuards?.reason === 'CURVE_NOT_ADVANCING' || entryGuards?.passed === true;
    const wouldEnter = Boolean(
      sourceEligible
      && bridge.passed
      && thresholdDecision.passed
      && recovery.passed
      && noSell.passed
      && parity.passed
      && !staleGuard.blocked
    );
    const failedChecks = [];
    if (!sourceEligible) failedChecks.push(entryGuards?.reason || 'SOURCE_NOT_ELIGIBLE');
    for (const item of [bridge, thresholdDecision, recovery, noSell, parity]) {
      if (!item.passed && item.reason) failedChecks.push(item.reason);
    }
    if (staleGuard.blocked) failedChecks.push('HIGH_CURVE_STALE_CURVE_UPDATE');
    const telemetryType = wouldEnter
      ? 'pre_migration_curve_false_negative_recovery_shadow.would_enter'
      : 'pre_migration_curve_false_negative_recovery_shadow.would_skip';
    const priceSol = this.compact(this.getPrice(state), 15);

    return {
      type: 'diagnostic',
      telemetryType,
      payload: {
        decision: wouldEnter ? 'RECOVERY_SHADOW_WOULD_ENTER' : 'RECOVERY_SHADOW_WOULD_SKIP',
        preset: preset.name,
        lane: preset.lane || null,
        profileName: preset.profileName || null,
        mint: state.mint,
        symbol: state.symbol || null,
        timestamp,
        sourceReason: entryGuards?.reason || null,
        sourceGuardPassed: entryGuards?.passed === true,
        paperEntryPaused: !this.curveFalseNegativeBridgePaperEntriesEnabled,
        reason: wouldEnter ? null : (failedChecks[0] || 'RECOVERY_SHADOW_FILTER_FAILED'),
        failedChecks: [...new Set(failedChecks)],
        score: this.compact(state.score, 2),
        curveProgress: this.compact(state.curveProgress, 6),
        recentVolumeSol: this.compact(state.recentVolumeSol, 4),
        tradeVelocityPerMin: this.compact(state.tradeVelocityPerMin, 2),
        buyRatio: this.compact(this.computeBuyRatio(state), 4),
        priceSol,
        bondingCurvePriceSol: priceSol,
        curvePriceSol: priceSol,
        ...this.reservesPayload(state),
        walletTouchCount: bridge.walletTouchCount ?? 0,
        positiveOrProvenTouchCount: bridge.positiveOrProvenTouchCount ?? 0,
        avoidTouchCount: bridge.avoidTouchCount ?? 0,
        trackedFirstTouchBuy: bridge.trackedFirstTouchBuy || null,
        positiveFirstTouchBuy: bridge.positiveFirstTouchBuy || null,
        recovery,
        noTrackedSellAfterQualifyingBuy: noSell,
        curveParity: parity,
        highCurveStaleSnapshotBlocked: staleGuard.blocked === true,
        highCurveStaleSnapshotCurveSnapshotAgeSeconds: this.compact(staleGuard.highCurveStaleSnapshotCurveSnapshotAgeSeconds, 2),
        highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds: this.compact(staleGuard.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds, 2),
        thresholdDecision,
        walletClassificationContext: state.walletClassificationContext || null
      }
    };
  }

  evaluateCurveRecoveryConfirmation(history = [], timestamp = new Date().toISOString()) {
    const nowMs = new Date(timestamp).getTime();
    const minConsecutive = this.curveFalseNegativeBridgeRecoveryMinConsecutiveAdvances;
    const lookbackMs = this.curveFalseNegativeBridgeRecoveryLookbackMs;
    const minAdvance = this.curveFalseNegativeBridgeRecoveryMinAdvance;
    const rows = Array.isArray(history)
      ? history
        .map((item) => ({
          timestamp: item.timestamp,
          timestampMs: new Date(item.timestamp || 0).getTime(),
          curveProgress: this.toCurveProgress(item.curveProgress)
        }))
        .filter((item) => Number.isFinite(item.curveProgress))
        .filter((item) => !Number.isFinite(nowMs) || !Number.isFinite(item.timestampMs) || nowMs - item.timestampMs <= lookbackMs)
        .sort((a, b) => a.timestampMs - b.timestampMs)
      : [];

    let consecutiveAdvances = 0;
    let totalAdvance = 0;
    let previous = null;
    for (const row of rows) {
      if (!previous) {
        previous = row;
        continue;
      }
      const delta = row.curveProgress - previous.curveProgress;
      if (delta > 0) {
        consecutiveAdvances += 1;
        totalAdvance += delta;
      } else if (delta < 0) {
        consecutiveAdvances = 0;
        totalAdvance = 0;
      }
      previous = row;
    }

    const passed = consecutiveAdvances >= minConsecutive && totalAdvance >= minAdvance;
    return {
      passed,
      reason: passed ? null : 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_NO_CURVE_RECOVERY',
      consecutiveAdvances,
      minConsecutiveAdvances: minConsecutive,
      totalAdvance: this.compact(totalAdvance, 6),
      minAdvance: this.compact(minAdvance, 6),
      lookbackMs,
      observations: rows.length,
      firstObservationAt: rows[0]?.timestamp || null,
      lastObservationAt: rows[rows.length - 1]?.timestamp || null
    };
  }

  evaluateNoTrackedSellAfterQualifyingBuy(state = {}, bridge = {}) {
    const context = state.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets.slice() : [];
    const qualifyingWallet = bridge.trackedFirstTouchBuy?.wallet || bridge.positiveFirstTouchBuy?.wallet || null;
    const buyAtMs = new Date(bridge.trackedFirstTouchBuy?.tradeAt || bridge.positiveFirstTouchBuy?.tradeAt || 0).getTime();
    if (!qualifyingWallet || !Number.isFinite(buyAtMs)) {
      return {
        passed: false,
        reason: 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_NO_QUALIFYING_BUY'
      };
    }

    const sellsAfterBuy = wallets.filter((wallet) => (
      wallet.wallet === qualifyingWallet
      && String(wallet.side || '').toLowerCase() === 'sell'
      && Number.isFinite(new Date(wallet.tradeAt || 0).getTime())
      && new Date(wallet.tradeAt || 0).getTime() >= buyAtMs
    ));

    return {
      passed: sellsAfterBuy.length === 0,
      reason: sellsAfterBuy.length === 0 ? null : 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_TRACKED_BUYER_ALREADY_SOLD',
      qualifyingWallet,
      qualifyingBuyAt: bridge.trackedFirstTouchBuy?.tradeAt || bridge.positiveFirstTouchBuy?.tradeAt || null,
      sellsAfterQualifyingBuy: sellsAfterBuy.length,
      firstSellAfterQualifyingBuy: sellsAfterBuy[0] ? this.walletTouchPayload(sellsAfterBuy[0]) : null
    };
  }

  evaluateBridgeCurveParity(state = {}) {
    const providerCurve = this.toCurveProgress(
      state.providerCurveProgress
      ?? state.curveProgress
      ?? state.bondingCurveState?.providerCurveProgress
    );
    const onchainCurve = this.toCurveProgress(
      state.onchainCurveProgress
      ?? state.bondingCurveState?.onchainCurveProgress
      ?? state.bondingCurveState?.curveProgressOnchain
      ?? (state.bondingCurveState?.approximate === false ? state.bondingCurveState?.curveProgress : null)
    );

    if (!Number.isFinite(providerCurve)) {
      return {
        passed: false,
        status: 'MISSING_PROVIDER_CURVE',
        reason: 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_MISSING_PROVIDER_CURVE',
        providerCurveProgress: null,
        onchainCurveProgress: null,
        maxAbsCurveDelta: this.compact(this.curveFalseNegativeBridgeParityMaxDelta, 6)
      };
    }

    if (!Number.isFinite(onchainCurve)) {
      return {
        passed: false,
        status: 'MISSING_ONCHAIN_CURVE',
        reason: 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_MISSING_ONCHAIN_CURVE_PARITY',
        providerCurveProgress: this.compact(providerCurve, 6),
        onchainCurveProgress: null,
        maxAbsCurveDelta: this.compact(this.curveFalseNegativeBridgeParityMaxDelta, 6)
      };
    }

    const curveDelta = onchainCurve - providerCurve;
    const absCurveDelta = Math.abs(curveDelta);
    const passed = absCurveDelta <= this.curveFalseNegativeBridgeParityMaxDelta;
    return {
      passed,
      status: passed ? 'FULL_MATCH' : 'DIVERGED',
      reason: passed ? null : 'CURVE_FALSE_NEGATIVE_RECOVERY_SHADOW_CURVE_PARITY_MISMATCH',
      providerCurveProgress: this.compact(providerCurve, 6),
      onchainCurveProgress: this.compact(onchainCurve, 6),
      curveDelta: this.compact(curveDelta, 6),
      absCurveDelta: this.compact(absCurveDelta, 6),
      maxAbsCurveDelta: this.compact(this.curveFalseNegativeBridgeParityMaxDelta, 6)
    };
  }

  walletTouchPayload(wallet = {}) {
    return {
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
    };
  }

  evaluateStrategyThresholds(state, strategy) {
    const price = this.getPrice(state);
    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);
    const buyRatio = this.computeBuyRatio(state);

    if (!Number.isFinite(price) || price <= 0) {
      return { passed: false, reason: 'MISSING_PRICE', price };
    }

    if (!Number.isFinite(score) || score < strategy.minScore) {
      return {
        passed: false,
        reason: 'LOW_SCORE',
        value: this.compact(score, 2),
        threshold: strategy.minScore
      };
    }

    if (!Number.isFinite(curveProgress) || curveProgress < strategy.minCurveProgress) {
      return {
        passed: false,
        reason: 'LOW_CURVE_PROGRESS',
        value: this.compact(curveProgress, 6),
        threshold: strategy.minCurveProgress
      };
    }

    if (Number.isFinite(strategy.maxCurveProgress) && curveProgress > strategy.maxCurveProgress) {
      return {
        passed: false,
        reason: 'HIGH_CURVE_PROGRESS',
        value: this.compact(curveProgress, 6),
        threshold: strategy.maxCurveProgress
      };
    }

    if (!Number.isFinite(recentVolumeSol) || recentVolumeSol < strategy.minRecentVolumeSol) {
      return {
        passed: false,
        reason: 'LOW_RECENT_VOLUME',
        value: this.compact(recentVolumeSol, 4),
        threshold: strategy.minRecentVolumeSol
      };
    }

    if (!Number.isFinite(tradeVelocityPerMin) || tradeVelocityPerMin < strategy.minTradeVelocityPerMin) {
      return {
        passed: false,
        reason: 'LOW_TRADE_VELOCITY',
        value: this.compact(tradeVelocityPerMin, 2),
        threshold: strategy.minTradeVelocityPerMin
      };
    }

    if (Number.isFinite(strategy.minBuyRatio) && strategy.minBuyRatio > 0) {
      if (!Number.isFinite(buyRatio) || buyRatio < strategy.minBuyRatio) {
        return {
          passed: false,
          reason: 'LOW_BUY_RATIO',
          value: this.compact(buyRatio, 4),
          threshold: strategy.minBuyRatio
        };
      }
    }

    return { passed: true };
  }

  shouldEnter(state, strategy) {
    return this.evaluateStrategyThresholds(state, strategy).passed;
  }

  evaluateEntryGuards(state, history, timestamp) {
    const curveGuard = this.evaluateCurveProgressGuard(state, history, timestamp);
    if (!curveGuard.passed) {
      return curveGuard;
    }

    // High-curve entries need a fresh snapshot even on the normal, non-override path.
    const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(
      state,
      timestamp,
      curveGuard.guardOverride || null
    );
    if (staleGuard.blocked) {
      return {
        ...curveGuard,
        ...staleGuard,
        passed: false,
        reason: 'HIGH_CURVE_STALE_CURVE_UPDATE'
      };
    }

    const cloneGuard = this.evaluateCloneGuard(state, timestamp);
    if (!cloneGuard.passed) {
      return cloneGuard;
    }

    return {
      ...curveGuard,
      ...staleGuard,
      ...cloneGuard,
      passed: true
    };
  }

  evaluateCurveProgressGuard(state, history = [], timestamp) {
    if (!Number.isFinite(this.minCurveProgressDelta) || this.minCurveProgressDelta <= 0) {
      return { passed: true };
    }

    const curveProgress = Number(state.curveProgress);
    if (!Number.isFinite(curveProgress)) {
      return {
        passed: false,
        reason: 'MISSING_CURVE_PROGRESS'
      };
    }

    const baseline = this.findCurveProgressBaseline(history, curveProgress, timestamp);
    const delta60s = this.computeCurveProgressDeltaForWindow(history, curveProgress, timestamp);
    if (!baseline) {
      const lateFastTrack = this.evaluateLateFastTrack(state);
      if (lateFastTrack.passed) {
        const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(state, timestamp, 'LATE_NEAR_COMPLETION_FAST_TRACK');
        if (staleGuard.blocked) {
          return {
            reason: 'HIGH_CURVE_STALE_CURVE_UPDATE',
            guardOverride: 'LATE_NEAR_COMPLETION_FAST_TRACK',
            ...this.formatDelta60s(delta60s),
            ...lateFastTrack,
            ...staleGuard,
            passed: false
          };
        }

        return {
          passed: true,
          guardOverride: 'LATE_NEAR_COMPLETION_FAST_TRACK',
          ...lateFastTrack
        };
      }

      const earlyAcceleration = this.evaluateEarlyAccelerationFastTrack(state);
      if (earlyAcceleration.passed) {
        const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(state, timestamp, 'EARLY_ACCELERATION_FAST_TRACK');
        if (staleGuard.blocked) {
          return {
            reason: 'HIGH_CURVE_STALE_CURVE_UPDATE',
            guardOverride: 'EARLY_ACCELERATION_FAST_TRACK',
            allowedPresetNames: ['earlyAccelerationRunner'],
            ...this.formatDelta60s(delta60s),
            ...earlyAcceleration,
            ...staleGuard,
            passed: false
          };
        }

        return {
          passed: true,
          guardOverride: 'EARLY_ACCELERATION_FAST_TRACK',
          allowedPresetNames: ['earlyAccelerationRunner'],
          ...earlyAcceleration
        };
      }

      const broadOrganicSurge = this.evaluateBroadOrganicSurgeOverride(state);
      if (broadOrganicSurge.passed) {
        return {
          passed: true,
          guardOverride: 'BROAD_ORGANIC_SURGE_FIRST_SIGHT',
          allowedPresetNames: ['highConvictionFirstSight'],
          thresholdOverrides: broadOrganicSurge.thresholdOverrides,
          ...this.formatDelta60s(delta60s),
          ...broadOrganicSurge
        };
      }

      const earlySurge = this.evaluateEarlySurgeOverride(state, { hasBaseline: false });
      if (earlySurge.passed) {
        return {
          passed: true,
          guardOverride: 'EARLY_SURGE_FIRST_SIGHT',
          allowedPresetNames: ['highConvictionFirstSight'],
          thresholdOverrides: earlySurge.thresholdOverrides,
          ...this.formatDelta60s(delta60s),
          ...earlySurge
        };
      }

      const firstCurveSnapshotScalp = this.evaluateFirstCurveSnapshotScalp(state, timestamp);
      if (firstCurveSnapshotScalp.passed) {
        return {
          passed: true,
          guardOverride: 'FIRST_CURVE_SNAPSHOT_SCALP',
          allowedPresetNames: ['earlyAccelerationRunner'],
          thresholdOverrides: firstCurveSnapshotScalp.thresholdOverrides,
          ...this.formatDelta60s(delta60s),
          ...firstCurveSnapshotScalp
        };
      }
      if (firstCurveSnapshotScalp.firstCurveSnapshotScalpStaleCurveBlocked) {
        return {
          passed: false,
          reason: 'FIRST_CURVE_SNAPSHOT_SCALP_STALE_CURVE_UPDATE',
          guardOverride: 'FIRST_CURVE_SNAPSHOT_SCALP',
          allowedPresetNames: ['earlyAccelerationRunner'],
          ...this.formatDelta60s(delta60s),
          ...firstCurveSnapshotScalp
        };
      }
      if (firstCurveSnapshotScalp.firstCurveSnapshotScalpSniperCrowdingBlocked) {
        return {
          passed: false,
          reason: 'FIRST_CURVE_SNAPSHOT_SCALP_SNIPER_CROWDING',
          guardOverride: 'FIRST_CURVE_SNAPSHOT_SCALP',
          allowedPresetNames: ['earlyAccelerationRunner'],
          ...this.formatDelta60s(delta60s),
          ...firstCurveSnapshotScalp
        };
      }

      const firstSight = this.evaluateFirstSightOverride(state);
      if (firstSight.passed) {
        return {
          passed: true,
          guardOverride: 'HIGH_CONVICTION_FIRST_SIGHT',
          allowedPresetNames: ['highConvictionFirstSight'],
          ...firstSight
        };
      }

      return {
        passed: false,
        reason: 'NO_PRIOR_CURVE_PROGRESS',
        ...this.formatDelta60s(delta60s)
      };
    }

    const curveProgressDelta = curveProgress - baseline.curveProgress;
    if (curveProgressDelta < this.minCurveProgressDelta) {
      const lateFastTrack = this.evaluateLateFastTrack(state);
      if (lateFastTrack.passed) {
        const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(state, timestamp, 'LATE_NEAR_COMPLETION_FAST_TRACK');
        if (staleGuard.blocked) {
          return {
            reason: 'HIGH_CURVE_STALE_CURVE_UPDATE',
            guardOverride: 'LATE_NEAR_COMPLETION_FAST_TRACK',
            curveProgressDelta: this.compact(curveProgressDelta, 6),
            threshold: this.minCurveProgressDelta,
            baselineCurveProgress: this.compact(baseline.curveProgress, 6),
            baselineAt: baseline.timestamp,
            ...this.formatDelta60s(delta60s),
            ...lateFastTrack,
            ...staleGuard,
            passed: false
          };
        }

        return {
          passed: true,
          guardOverride: 'LATE_NEAR_COMPLETION_FAST_TRACK',
          curveProgressDelta: this.compact(curveProgressDelta, 6),
          threshold: this.minCurveProgressDelta,
          baselineCurveProgress: this.compact(baseline.curveProgress, 6),
          baselineAt: baseline.timestamp,
          ...this.formatDelta60s(delta60s),
          ...lateFastTrack
        };
      }

      const earlyAcceleration = this.evaluateEarlyAccelerationFastTrack(state);
      if (earlyAcceleration.passed) {
        const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(state, timestamp, 'EARLY_ACCELERATION_FAST_TRACK');
        if (staleGuard.blocked) {
          return {
            reason: 'HIGH_CURVE_STALE_CURVE_UPDATE',
            guardOverride: 'EARLY_ACCELERATION_FAST_TRACK',
            allowedPresetNames: ['earlyAccelerationRunner'],
            curveProgressDelta: this.compact(curveProgressDelta, 6),
            threshold: this.minCurveProgressDelta,
            baselineCurveProgress: this.compact(baseline.curveProgress, 6),
            baselineAt: baseline.timestamp,
            ...this.formatDelta60s(delta60s),
            ...earlyAcceleration,
            ...staleGuard,
            passed: false
          };
        }

        return {
          passed: true,
          guardOverride: 'EARLY_ACCELERATION_FAST_TRACK',
          allowedPresetNames: ['earlyAccelerationRunner'],
          curveProgressDelta: this.compact(curveProgressDelta, 6),
          threshold: this.minCurveProgressDelta,
          baselineCurveProgress: this.compact(baseline.curveProgress, 6),
          baselineAt: baseline.timestamp,
          ...this.formatDelta60s(delta60s),
          ...earlyAcceleration
        };
      }

      const broadOrganicSurge = this.evaluateBroadOrganicSurgeOverride(state);
      if (broadOrganicSurge.passed) {
        return {
          passed: true,
          guardOverride: 'BROAD_ORGANIC_SURGE_FIRST_SIGHT',
          allowedPresetNames: ['highConvictionFirstSight'],
          thresholdOverrides: broadOrganicSurge.thresholdOverrides,
          curveProgressDelta: this.compact(curveProgressDelta, 6),
          threshold: this.minCurveProgressDelta,
          baselineCurveProgress: this.compact(baseline.curveProgress, 6),
          baselineAt: baseline.timestamp,
          ...this.formatDelta60s(delta60s),
          ...broadOrganicSurge
        };
      }

      const earlySurge = this.evaluateEarlySurgeOverride(state, {
        hasBaseline: true,
        curveProgressDelta,
        delta60s,
        baseline
      });
      if (earlySurge.passed) {
        return {
          passed: true,
          guardOverride: 'EARLY_SURGE_FIRST_SIGHT',
          allowedPresetNames: ['highConvictionFirstSight'],
          thresholdOverrides: earlySurge.thresholdOverrides,
          curveProgressDelta: this.compact(curveProgressDelta, 6),
          threshold: this.minCurveProgressDelta,
          baselineCurveProgress: this.compact(baseline.curveProgress, 6),
          baselineAt: baseline.timestamp,
          ...this.formatDelta60s(delta60s),
          ...earlySurge
        };
      }

      const curvePause = this.evaluateCurvePauseOverride(state);
      if (curvePause.passed) {
        const staleGuard = this.evaluateHighCurveStaleSnapshotGuard(state, timestamp, 'HIGH_CONVICTION_CURVE_PAUSE');
        if (staleGuard.blocked) {
          return {
            reason: 'HIGH_CURVE_STALE_CURVE_UPDATE',
            guardOverride: 'HIGH_CONVICTION_CURVE_PAUSE',
            allowedPresetNames: ['highConvictionFirstSight'],
            curveProgressDelta: this.compact(curveProgressDelta, 6),
            threshold: this.minCurveProgressDelta,
            baselineCurveProgress: this.compact(baseline.curveProgress, 6),
            baselineAt: baseline.timestamp,
            ...this.formatDelta60s(delta60s),
            ...curvePause,
            ...staleGuard,
            passed: false
          };
        }

        return {
          passed: true,
          guardOverride: 'HIGH_CONVICTION_CURVE_PAUSE',
          allowedPresetNames: ['highConvictionFirstSight'],
          curveProgressDelta: this.compact(curveProgressDelta, 6),
          threshold: this.minCurveProgressDelta,
          baselineCurveProgress: this.compact(baseline.curveProgress, 6),
          baselineAt: baseline.timestamp,
          ...curvePause
        };
      }

      return {
        passed: false,
        reason: 'CURVE_NOT_ADVANCING',
        curveProgressDelta: this.compact(curveProgressDelta, 6),
        threshold: this.minCurveProgressDelta,
        baselineCurveProgress: this.compact(baseline.curveProgress, 6),
        baselineAt: baseline.timestamp,
        ...this.formatDelta60s(delta60s)
      };
    }

    const broadOrganicSurge = this.evaluateBroadOrganicSurgeOverride(state);
    if (broadOrganicSurge.passed) {
      return {
        passed: true,
        guardOverride: 'BROAD_ORGANIC_SURGE_FIRST_SIGHT',
        allowedPresetNames: ['highConvictionFirstSight'],
        thresholdOverrides: broadOrganicSurge.thresholdOverrides,
        curveProgressDelta: this.compact(curveProgressDelta, 6),
        threshold: this.minCurveProgressDelta,
        baselineCurveProgress: this.compact(baseline.curveProgress, 6),
        baselineAt: baseline.timestamp,
        ...this.formatDelta60s(delta60s),
        ...broadOrganicSurge
      };
    }

    const earlySurge = this.evaluateEarlySurgeOverride(state, {
      hasBaseline: true,
      curveProgressDelta,
      delta60s,
      baseline
    });
    if (earlySurge.passed) {
      return {
        passed: true,
        guardOverride: 'EARLY_SURGE_FIRST_SIGHT',
        allowedPresetNames: ['highConvictionFirstSight'],
        thresholdOverrides: earlySurge.thresholdOverrides,
        curveProgressDelta: this.compact(curveProgressDelta, 6),
        threshold: this.minCurveProgressDelta,
        baselineCurveProgress: this.compact(baseline.curveProgress, 6),
        baselineAt: baseline.timestamp,
        ...this.formatDelta60s(delta60s),
        ...earlySurge
      };
    }

    return {
      passed: true,
      curveProgressDelta: this.compact(curveProgressDelta, 6),
      baselineCurveProgress: this.compact(baseline.curveProgress, 6),
      baselineAt: baseline.timestamp,
      ...this.formatDelta60s(delta60s)
    };
  }

  formatDelta60s(delta60s) {
    if (!delta60s) {
      return {};
    }

    return {
      curveProgressDelta60s: this.compact(delta60s.curveProgressDelta60s, 6),
      baselineCurveProgress60s: this.compact(delta60s.baselineCurveProgress60s, 6),
      baselineAt60s: delta60s.baselineAt60s || null
    };
  }

  evaluateEarlySurgeOverride(state = {}, curveContext = {}) {
    if (!this.earlySurgeOverrideEnabled) {
      return { passed: false };
    }

    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);
    const buyRatio = this.computeBuyRatio(state);
    const curveProgressDelta = Number(curveContext.curveProgressDelta);
    const curveProgressDelta60s = Number(curveContext.delta60s?.curveProgressDelta60s);
    const baselineCurveProgress60s = Number(curveContext.delta60s?.baselineCurveProgress60s);
    const baselineCurveProgress = Number(curveContext.baseline?.curveProgress);
    const hasConfirmation = this.hasFirstSightConfirmation(state);
    const hasBaseline = curveContext.hasBaseline === true;
    const passesCurveDeltaGuard = hasBaseline
      ? Number.isFinite(curveProgressDelta) && curveProgressDelta >= this.earlySurgeMinCurveProgressDelta
      : Number.isFinite(score) && score >= this.earlySurgeNoBaselineMinScore;

    const passed = Number.isFinite(score)
      && score >= this.earlySurgeMinScore
      && Number.isFinite(curveProgress)
      && curveProgress >= this.earlySurgeMinCurveProgress
      && curveProgress <= this.earlySurgeMaxCurveProgress
      && Number.isFinite(recentVolumeSol)
      && recentVolumeSol >= this.earlySurgeMinRecentVolumeSol
      && Number.isFinite(tradeVelocityPerMin)
      && tradeVelocityPerMin >= this.earlySurgeMinTradeVelocityPerMin
      && hasConfirmation
      && passesCurveDeltaGuard
      && (buyRatio === null || buyRatio >= this.earlySurgeMinBuyRatio);

    const thresholdOverrides = {
      minScore: this.earlySurgeMinScore,
      minCurveProgress: this.earlySurgeMinCurveProgress,
      minRecentVolumeSol: this.earlySurgeMinRecentVolumeSol,
      minTradeVelocityPerMin: this.earlySurgeMinTradeVelocityPerMin,
      minBuyRatio: this.earlySurgeMinBuyRatio,
      minCurveProgressDelta: this.earlySurgeMinCurveProgressDelta,
      noBaselineMinScore: this.earlySurgeNoBaselineMinScore
    };

    return {
      passed,
      thresholdOverrides,
      earlySurgeScore: this.compact(score, 2),
      earlySurgeCurveProgress: this.compact(curveProgress, 6),
      earlySurgeRecentVolumeSol: this.compact(recentVolumeSol, 4),
      earlySurgeTradeVelocityPerMin: this.compact(tradeVelocityPerMin, 2),
      earlySurgeBuyRatio: this.compact(buyRatio, 4),
      earlySurgeHasConfirmation: hasConfirmation,
      earlySurgeDeltaGuardMode: hasBaseline ? 'curve_delta' : 'no_baseline_score_floor',
      earlySurgeCurveProgressDelta: this.compact(curveProgressDelta, 6),
      earlySurgeCurveProgressDelta60s: this.compact(curveProgressDelta60s, 6),
      earlySurgeBaselineCurveProgress: this.compact(baselineCurveProgress, 6),
      earlySurgeBaselineCurveProgress60s: this.compact(baselineCurveProgress60s, 6),
      earlySurgeBaselineAt60s: curveContext.delta60s?.baselineAt60s || null,
      earlySurgeBaselineAt: curveContext.baseline?.timestamp || null,
      earlySurgePassesCurveDeltaGuard: passesCurveDeltaGuard,
      earlySurgeThresholds: {
        ...thresholdOverrides,
        maxCurveProgress: this.earlySurgeMaxCurveProgress,
        minBuyRatio: this.earlySurgeMinBuyRatio,
        minCurveProgressDelta: this.earlySurgeMinCurveProgressDelta,
        noBaselineMinScore: this.earlySurgeNoBaselineMinScore,
        requiresRepeatBuyerHolderOrSocial: true
      }
    };
  }

  evaluateBroadOrganicSurgeOverride(state = {}) {
    if (!this.broadOrganicSurgeEnabled) {
      return { passed: false };
    }

    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);
    const uniqueBuyerRatio = this.computeUniqueBuyerRatio(state);
    const buyRatio = this.computeBuyRatio(state);
    const symbol = String(state.symbol || '').trim();
    const hasConfirmation = this.hasFirstSightConfirmation(state);
    const hasPlainAsciiSymbol = this.hasPlainAsciiSymbol(symbol);

    const passed = Number.isFinite(score)
      && score >= this.broadOrganicSurgeMinScore
      && Number.isFinite(curveProgress)
      && curveProgress >= this.broadOrganicSurgeMinCurveProgress
      && curveProgress <= this.broadOrganicSurgeMaxCurveProgress
      && Number.isFinite(recentVolumeSol)
      && recentVolumeSol >= this.broadOrganicSurgeMinRecentVolumeSol
      && Number.isFinite(tradeVelocityPerMin)
      && tradeVelocityPerMin >= this.broadOrganicSurgeMinTradeVelocityPerMin
      && Number.isFinite(uniqueBuyerRatio)
      && uniqueBuyerRatio >= this.broadOrganicSurgeMinUniqueBuyerRatio
      && (buyRatio === null || buyRatio >= this.broadOrganicSurgeMinBuyRatio)
      && hasConfirmation
      && hasPlainAsciiSymbol;

    const thresholdOverrides = {
      minScore: this.broadOrganicSurgeMinScore,
      minCurveProgress: this.broadOrganicSurgeMinCurveProgress,
      maxCurveProgress: this.broadOrganicSurgeMaxCurveProgress,
      minRecentVolumeSol: this.broadOrganicSurgeMinRecentVolumeSol,
      minTradeVelocityPerMin: this.broadOrganicSurgeMinTradeVelocityPerMin,
      minBuyRatio: this.broadOrganicSurgeMinBuyRatio
    };

    return {
      passed,
      thresholdOverrides,
      broadOrganicSurgeScore: this.compact(score, 2),
      broadOrganicSurgeCurveProgress: this.compact(curveProgress, 6),
      broadOrganicSurgeRecentVolumeSol: this.compact(recentVolumeSol, 4),
      broadOrganicSurgeTradeVelocityPerMin: this.compact(tradeVelocityPerMin, 2),
      broadOrganicSurgeUniqueBuyerRatio: this.compact(uniqueBuyerRatio, 4),
      broadOrganicSurgeBuyRatio: this.compact(buyRatio, 4),
      broadOrganicSurgeHasConfirmation: hasConfirmation,
      broadOrganicSurgeHasPlainAsciiSymbol: hasPlainAsciiSymbol,
      broadOrganicSurgeThresholds: {
        ...thresholdOverrides,
        minUniqueBuyerRatio: this.broadOrganicSurgeMinUniqueBuyerRatio,
        requiresRepeatBuyerHolderOrSocial: true,
        requiresPlainAsciiSymbol: true
      }
    };
  }

  evaluateFirstCurveSnapshotScalp(state = {}, timestamp = null) {
    if (!this.firstCurveSnapshotScalpEnabled) {
      return { passed: false };
    }

    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);
    const interestSignalCount = Number(state.interestSignalCount || 0);
    const uniqueBuyerCount = Number(state.uniqueBuyerCount || 0);
    const riskWalletCount = Number(state.riskWalletCount || 0);
    const sniperWalletCount = Number(state.sniperWalletCount || 0);
    const buyRatio = this.computeBuyRatio(state);
    const price = this.getPrice(state);
    const curveSnapshotAgeSeconds = this.curveSnapshotAgeSeconds(state, timestamp);
    const staleCurveBlocked = Number.isFinite(this.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds)
      && this.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds > 0
      && curveSnapshotAgeSeconds !== null
      && curveSnapshotAgeSeconds > this.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds;
    const sniperCrowdingBlocked = this.firstCurveSnapshotScalpSniperCrowdingGuardEnabled
      && Number.isFinite(sniperWalletCount)
      && Number.isFinite(this.firstCurveSnapshotScalpMaxSniperWalletCount)
      && sniperWalletCount > this.firstCurveSnapshotScalpMaxSniperWalletCount;

    const passed = Number.isFinite(price)
      && price > 0
      && Number.isFinite(score)
      && score >= this.firstCurveSnapshotScalpMinScore
      && Number.isFinite(curveProgress)
      && curveProgress >= this.firstCurveSnapshotScalpMinCurveProgress
      && curveProgress <= this.firstCurveSnapshotScalpMaxCurveProgress
      && Number.isFinite(recentVolumeSol)
      && recentVolumeSol >= this.firstCurveSnapshotScalpMinRecentVolumeSol
      && Number.isFinite(tradeVelocityPerMin)
      && tradeVelocityPerMin >= this.firstCurveSnapshotScalpMinTradeVelocityPerMin
      && interestSignalCount >= this.firstCurveSnapshotScalpMinInterestCount
      && uniqueBuyerCount >= this.firstCurveSnapshotScalpMinUniqueBuyerCount
      && riskWalletCount <= this.firstCurveSnapshotScalpMaxRiskWalletCount
      && !staleCurveBlocked
      && !sniperCrowdingBlocked
      && (buyRatio === null || buyRatio >= this.firstCurveSnapshotScalpMinBuyRatio);

    const failedChecks = [];
    if (!Number.isFinite(price) || price <= 0) failedChecks.push('MISSING_PRICE');
    if (!Number.isFinite(score) || score < this.firstCurveSnapshotScalpMinScore) failedChecks.push('LOW_SCORE');
    if (!Number.isFinite(curveProgress)) failedChecks.push('MISSING_CURVE_PROGRESS');
    if (Number.isFinite(curveProgress) && curveProgress < this.firstCurveSnapshotScalpMinCurveProgress) failedChecks.push('LOW_CURVE_PROGRESS');
    if (Number.isFinite(curveProgress) && curveProgress > this.firstCurveSnapshotScalpMaxCurveProgress) failedChecks.push('HIGH_CURVE_PROGRESS');
    if (!Number.isFinite(recentVolumeSol) || recentVolumeSol < this.firstCurveSnapshotScalpMinRecentVolumeSol) failedChecks.push('LOW_VOLUME');
    if (!Number.isFinite(tradeVelocityPerMin) || tradeVelocityPerMin < this.firstCurveSnapshotScalpMinTradeVelocityPerMin) failedChecks.push('LOW_VELOCITY');
    if (interestSignalCount < this.firstCurveSnapshotScalpMinInterestCount) failedChecks.push('LOW_INTEREST_COUNT');
    if (uniqueBuyerCount < this.firstCurveSnapshotScalpMinUniqueBuyerCount) failedChecks.push('LOW_UNIQUE_BUYERS');
    if (riskWalletCount > this.firstCurveSnapshotScalpMaxRiskWalletCount) failedChecks.push('RISK_WALLET_COUNT');
    if (staleCurveBlocked) failedChecks.push('STALE_CURVE_UPDATE');
    if (sniperCrowdingBlocked) failedChecks.push('SNIPER_CROWDING_8_PLUS');
    if (buyRatio !== null && buyRatio < this.firstCurveSnapshotScalpMinBuyRatio) failedChecks.push('LOW_BUY_RATIO');

    const thresholdOverrides = {
      minScore: this.firstCurveSnapshotScalpMinScore,
      minCurveProgress: this.firstCurveSnapshotScalpMinCurveProgress,
      maxCurveProgress: this.firstCurveSnapshotScalpMaxCurveProgress,
      minRecentVolumeSol: this.firstCurveSnapshotScalpMinRecentVolumeSol,
      minTradeVelocityPerMin: this.firstCurveSnapshotScalpMinTradeVelocityPerMin,
      minBuyRatio: this.firstCurveSnapshotScalpMinBuyRatio
    };

    return {
      passed,
      failedChecks,
      thresholdOverrides,
      firstCurveSnapshotScalpScore: this.compact(score, 2),
      firstCurveSnapshotScalpCurveProgress: this.compact(curveProgress, 6),
      firstCurveSnapshotScalpRecentVolumeSol: this.compact(recentVolumeSol, 4),
      firstCurveSnapshotScalpTradeVelocityPerMin: this.compact(tradeVelocityPerMin, 2),
      firstCurveSnapshotScalpInterestSignalCount: interestSignalCount,
      firstCurveSnapshotScalpUniqueBuyerCount: uniqueBuyerCount,
      firstCurveSnapshotScalpRiskWalletCount: riskWalletCount,
      firstCurveSnapshotScalpSniperWalletCount: Number.isFinite(sniperWalletCount) ? sniperWalletCount : null,
      firstCurveSnapshotScalpCurveSnapshotAgeSeconds: this.compact(curveSnapshotAgeSeconds, 2),
      firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds: this.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds,
      firstCurveSnapshotScalpStaleCurveBlocked: staleCurveBlocked,
      firstCurveSnapshotScalpSniperCrowdingBlocked: sniperCrowdingBlocked,
      firstCurveSnapshotScalpBuyRatio: this.compact(buyRatio, 4),
      firstCurveSnapshotScalpHasPrice: Number.isFinite(price) && price > 0,
      firstCurveSnapshotScalpThresholds: {
        ...thresholdOverrides,
        minInterestSignalCount: this.firstCurveSnapshotScalpMinInterestCount,
        minUniqueBuyerCount: this.firstCurveSnapshotScalpMinUniqueBuyerCount,
        maxRiskWalletCount: this.firstCurveSnapshotScalpMaxRiskWalletCount,
        maxSniperWalletCount: this.firstCurveSnapshotScalpMaxSniperWalletCount,
        maxCurveSnapshotAgeSeconds: this.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds,
        sniperCrowdingGuardEnabled: this.firstCurveSnapshotScalpSniperCrowdingGuardEnabled
      }
    };
  }

  evaluateHighCurveStaleSnapshotGuard(state = {}, timestamp = null, guardOverride = null) {
    const curveProgress = Number(state.curveProgress);
    const curveSnapshotAgeSeconds = this.curveSnapshotAgeSeconds(state, timestamp);
    const blocked = this.highCurveStaleSnapshotGuardEnabled
      && Number.isFinite(curveProgress)
      && Number.isFinite(this.highCurveStaleSnapshotMinCurveProgress)
      && curveProgress >= this.highCurveStaleSnapshotMinCurveProgress
      && Number.isFinite(this.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds)
      && this.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds > 0
      && curveSnapshotAgeSeconds !== null
      && curveSnapshotAgeSeconds > this.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds;

    return {
      blocked,
      highCurveStaleSnapshotBlocked: blocked,
      highCurveStaleSnapshotGuardEnabled: this.highCurveStaleSnapshotGuardEnabled,
      highCurveStaleSnapshotGuardOverride: guardOverride,
      highCurveStaleSnapshotCurveProgress: this.compact(curveProgress, 6),
      highCurveStaleSnapshotCurveSnapshotAgeSeconds: this.compact(curveSnapshotAgeSeconds, 2),
      highCurveStaleSnapshotMinCurveProgress: this.highCurveStaleSnapshotMinCurveProgress,
      highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds: this.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds
    };
  }

  curveSnapshotAgeSeconds(state = {}, timestamp = null) {
    const parsedNow = Date.parse(timestamp);
    const nowMs = Number.isFinite(parsedNow) ? parsedNow : Date.now();
    const snapshotTimestamp = state.bondingCurveState?.lastFetchAtIso
      || state.bondingCurveState?.lastFetchAt
      || state.bondingCurveState?.lastUpdateAt
      || state.bondingCurveState?.lastFetchedAt
      || state.lastCurveUpdateAt
      || state.bondingCurveUpdatedAt;
    const parsed = Date.parse(snapshotTimestamp);
    if (Number.isFinite(parsed)) {
      return this.compact((nowMs - parsed) / 1000, 2);
    }

    const numericTimestamp = Number(state.bondingCurveState?.lastFetchAt || state.lastCurveUpdateMs);
    if (Number.isFinite(numericTimestamp) && numericTimestamp > 0) {
      return this.compact((nowMs - numericTimestamp) / 1000, 2);
    }

    return null;
  }

  firstCurveSnapshotNearMissEvent(state = {}, history = [], timestamp) {
    if (!this.firstCurveSnapshotScalpEnabled || this.hasValidCurveHistory(history)) {
      return null;
    }

    const curveProgress = this.toCurveProgress(state.curveProgress);
    if (!Number.isFinite(curveProgress)) {
      return null;
    }

    const snapshot = this.evaluateFirstCurveSnapshotScalp(state, timestamp);
    if (snapshot.passed) {
      return null;
    }
    const priceSol = this.compact(this.getPrice(state), 15);

    return {
      type: 'diagnostic',
      telemetryType: 'pre_migration_paper.first_curve_snapshot_near_miss',
      payload: {
        mint: state.mint,
        symbol: state.symbol || null,
        timestamp,
        score: this.compact(state.score, 2),
        curveProgress: this.compact(state.curveProgress, 6),
        recentVolumeSol: this.compact(state.recentVolumeSol, 4),
        tradeVelocityPerMin: this.compact(state.tradeVelocityPerMin, 2),
        priceSol,
        bondingCurvePriceSol: priceSol,
        curvePriceSol: priceSol,
        ...this.reservesPayload(state),
        interestSignalCount: Number.isFinite(Number(state.interestSignalCount)) ? Number(state.interestSignalCount) : 0,
        uniqueBuyerCount: Number.isFinite(Number(state.uniqueBuyerCount)) ? Number(state.uniqueBuyerCount) : 0,
        riskWalletCount: Number.isFinite(Number(state.riskWalletCount)) ? Number(state.riskWalletCount) : 0,
        sniperWalletCount: Number.isFinite(Number(state.sniperWalletCount)) ? Number(state.sniperWalletCount) : null,
        curveSnapshotAgeSeconds: this.compact(snapshot.firstCurveSnapshotScalpCurveSnapshotAgeSeconds, 2),
        maxCurveSnapshotAgeSeconds: this.compact(snapshot.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds, 2),
        buyRatio: this.compact(this.computeBuyRatio(state), 4),
        hasPrice: Boolean(snapshot.firstCurveSnapshotScalpHasPrice),
        staleCurveBlocked: Boolean(snapshot.firstCurveSnapshotScalpStaleCurveBlocked),
        sniperCrowdingBlocked: Boolean(snapshot.firstCurveSnapshotScalpSniperCrowdingBlocked),
        failedChecks: snapshot.failedChecks || [],
        thresholds: snapshot.firstCurveSnapshotScalpThresholds || null,
        nearMiss: true
      }
    };
  }

  evaluateFirstSightOverride(state = {}) {
    if (!this.firstSightOverrideEnabled) {
      return { passed: false };
    }

    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);
    const buyRatio = this.computeBuyRatio(state);
    const hasConfirmation = this.hasFirstSightConfirmation(state);

    const passed = Number.isFinite(score)
      && score >= this.firstSightMinScore
      && Number.isFinite(curveProgress)
      && curveProgress >= this.firstSightMinCurveProgress
      && curveProgress <= this.firstSightMaxCurveProgress
      && Number.isFinite(recentVolumeSol)
      && recentVolumeSol >= this.firstSightMinRecentVolumeSol
      && Number.isFinite(tradeVelocityPerMin)
      && tradeVelocityPerMin >= this.firstSightMinTradeVelocityPerMin
      && hasConfirmation
      && Number.isFinite(buyRatio)
      && buyRatio >= this.firstSightMinBuyRatio;

    return {
      passed,
      firstSightScore: this.compact(score, 2),
      firstSightCurveProgress: this.compact(curveProgress, 6),
      firstSightRecentVolumeSol: this.compact(recentVolumeSol, 4),
      firstSightTradeVelocityPerMin: this.compact(tradeVelocityPerMin, 2),
      firstSightBuyRatio: this.compact(buyRatio, 4),
      firstSightHasConfirmation: hasConfirmation,
      firstSightThresholds: {
        minScore: this.firstSightMinScore,
        minCurveProgress: this.firstSightMinCurveProgress,
        maxCurveProgress: this.firstSightMaxCurveProgress,
        minRecentVolumeSol: this.firstSightMinRecentVolumeSol,
        minTradeVelocityPerMin: this.firstSightMinTradeVelocityPerMin,
        minBuyRatio: this.firstSightMinBuyRatio,
        requiresRepeatBuyerHolderOrSocial: true
      }
    };
  }

  evaluateCurvePauseOverride(state = {}) {
    if (!this.curvePauseOverrideEnabled) {
      return { passed: false };
    }

    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);
    const buyRatio = this.computeBuyRatio(state);
    const hasConfirmation = this.hasFirstSightConfirmation(state);

    const passed = Number.isFinite(score)
      && score >= this.curvePauseMinScore
      && Number.isFinite(curveProgress)
      && curveProgress >= this.curvePauseMinCurveProgress
      && (!Number.isFinite(this.curvePauseMaxCurveProgress) || curveProgress <= this.curvePauseMaxCurveProgress)
      && Number.isFinite(recentVolumeSol)
      && recentVolumeSol >= this.curvePauseMinRecentVolumeSol
      && Number.isFinite(tradeVelocityPerMin)
      && tradeVelocityPerMin >= this.curvePauseMinTradeVelocityPerMin
      && hasConfirmation
      && (buyRatio === null || buyRatio >= this.curvePauseMinBuyRatio);

    return {
      passed,
      curvePauseScore: this.compact(score, 2),
      curvePauseCurveProgress: this.compact(curveProgress, 6),
      curvePauseRecentVolumeSol: this.compact(recentVolumeSol, 4),
      curvePauseTradeVelocityPerMin: this.compact(tradeVelocityPerMin, 2),
      curvePauseBuyRatio: this.compact(buyRatio, 4),
      curvePauseHasConfirmation: hasConfirmation,
      curvePauseThresholds: {
        minScore: this.curvePauseMinScore,
        minCurveProgress: this.curvePauseMinCurveProgress,
        maxCurveProgress: this.curvePauseMaxCurveProgress,
        minRecentVolumeSol: this.curvePauseMinRecentVolumeSol,
        minTradeVelocityPerMin: this.curvePauseMinTradeVelocityPerMin,
        minBuyRatio: this.curvePauseMinBuyRatio,
        requiresRepeatBuyerHolderOrSocial: true
      }
    };
  }

  evaluateEarlyAccelerationFastTrack(state = {}) {
    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);
    const repeatedEarlyBuyerCount = Number(state.repeatedEarlyBuyerCount || 0);
    const holderProxy = Number(state.holderProxy || 0);
    const buyRatio = this.computeBuyRatio(state);
    const hasBuyerQuality = repeatedEarlyBuyerCount > 0 || holderProxy >= 50;

    const passed = Number.isFinite(score)
      && score >= this.earlyAccelerationMinScore
      && Number.isFinite(curveProgress)
      && curveProgress >= this.earlyAccelerationMinCurveProgress
      && Number.isFinite(recentVolumeSol)
      && recentVolumeSol >= this.earlyAccelerationMinRecentVolumeSol
      && Number.isFinite(tradeVelocityPerMin)
      && tradeVelocityPerMin >= this.earlyAccelerationMinTradeVelocityPerMin
      && hasBuyerQuality
      && (buyRatio === null || buyRatio >= 0.55);

    return {
      passed,
      earlyAccelerationScore: this.compact(score, 2),
      earlyAccelerationCurveProgress: this.compact(curveProgress, 6),
      earlyAccelerationRecentVolumeSol: this.compact(recentVolumeSol, 4),
      earlyAccelerationTradeVelocityPerMin: this.compact(tradeVelocityPerMin, 2),
      earlyAccelerationBuyRatio: this.compact(buyRatio, 4),
      earlyAccelerationRepeatedEarlyBuyerCount: Number.isFinite(repeatedEarlyBuyerCount) ? repeatedEarlyBuyerCount : null,
      earlyAccelerationHolderProxy: Number.isFinite(holderProxy) ? holderProxy : null,
      earlyAccelerationThresholds: {
        minScore: this.earlyAccelerationMinScore,
        minCurveProgress: this.earlyAccelerationMinCurveProgress,
        minRecentVolumeSol: this.earlyAccelerationMinRecentVolumeSol,
        minTradeVelocityPerMin: this.earlyAccelerationMinTradeVelocityPerMin,
        minBuyRatio: 0.55,
        minHolderProxyWithoutRepeatBuyers: 50
      }
    };
  }

  evaluateEarlyAccelerationWeakWalletFlowGuard(state = {}, preset = {}, entryGuards = {}) {
    if (!this.earlyAccelerationWeakWalletFlowGuardEnabled && !this.earlyAccelerationAvoidWalletContextGuardEnabled) {
      return { passed: true };
    }

    if (preset.name !== 'earlyAccelerationRunner' || entryGuards.guardOverride !== 'EARLY_ACCELERATION_FAST_TRACK') {
      return { passed: true };
    }

    const context = state.walletClassificationContext || {};
    const labelCounts = context.labelCounts || {};
    const observedTouches = Number(context.observedWalletTradeCount || 0);
    const lowSignalTouches =
      Number(labelCounts.LOW_SIGNAL || 0)
      + Number(labelCounts.LOW_SIGNAL_AVOID || 0);
    const positiveWalletSignals =
      Number(context.earlySniperCount || 0)
      + Number(context.alphaScalperCount || 0)
      + Number(context.convictionWhaleCount || 0);
    const wallets = Array.isArray(context.wallets) ? context.wallets : [];
    const avoidWalletTouches = wallets.filter((wallet) => this.isAvoidOrNegativeWalletTouch(wallet));
    if (this.earlyAccelerationAvoidWalletContextGuardEnabled && avoidWalletTouches.length > 0) {
      return {
        passed: false,
        reason: 'EARLY_ACCELERATION_AVOID_WALLET_CONTEXT',
        earlyAccelerationAvoidWalletContextBlocked: true,
        earlyAccelerationAvoidWalletContextTouchCount: avoidWalletTouches.length,
        earlyAccelerationAvoidWalletContextTouches: avoidWalletTouches.slice(0, 5).map((wallet) => this.walletTouchPayload(wallet)),
        earlyAccelerationAvoidWalletContextThresholds: {
          maxAvoidOrNegativeTouches: 0
        }
      };
    }

    const lateSellSol = wallets.reduce((sum, wallet) => {
      const side = String(wallet.side || '').toLowerCase();
      const phase = String(wallet.phase || '').toLowerCase();
      const solAmount = Number(wallet.solAmount || 0);
      if (side === 'sell' && phase.includes('late') && Number.isFinite(solAmount)) {
        return sum + solAmount;
      }
      return sum;
    }, 0);

    const lowSignalDominant = Number.isFinite(observedTouches)
      && observedTouches > 0
      && Number.isFinite(lowSignalTouches)
      && lowSignalTouches >= this.earlyAccelerationWeakWalletFlowMinLowSignalTouches
      && lowSignalTouches / observedTouches >= 0.75;
    const blocked = observedTouches >= this.earlyAccelerationWeakWalletFlowMinLowSignalTouches
      && lowSignalDominant
      && positiveWalletSignals <= 0
      && lateSellSol >= this.earlyAccelerationWeakWalletFlowMinLateSellSol;

    return {
      passed: !blocked,
      reason: blocked ? 'EARLY_ACCELERATION_WEAK_WALLET_FLOW' : null,
      earlyAccelerationWeakWalletFlowBlocked: blocked,
      earlyAccelerationWeakWalletFlowObservedTouches: Number.isFinite(observedTouches) ? observedTouches : null,
      earlyAccelerationWeakWalletFlowLowSignalTouches: Number.isFinite(lowSignalTouches) ? lowSignalTouches : null,
      earlyAccelerationWeakWalletFlowLateSellSol: this.compact(lateSellSol, 4),
      earlyAccelerationWeakWalletFlowPositiveSignals: Number.isFinite(positiveWalletSignals) ? positiveWalletSignals : null,
      earlyAccelerationWeakWalletFlowThresholds: {
        minLowSignalTouches: this.earlyAccelerationWeakWalletFlowMinLowSignalTouches,
        minLateSellSol: this.earlyAccelerationWeakWalletFlowMinLateSellSol,
        minLowSignalShare: 0.75
      }
    };
  }

  evaluateAvoidWalletContextGuard(state = {}, preset = {}) {
    if (!this.avoidWalletContextGuardEnabled || preset.name === 'curveFalseNegativeWalletBridge') {
      return { passed: true };
    }

    const context = state.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets : [];
    const avoidWalletTouches = wallets.filter((wallet) => this.isAvoidOrNegativeWalletTouch(wallet));
    const blocked = avoidWalletTouches.length > 0;
    return {
      passed: !blocked,
      reason: blocked ? 'AVOID_WALLET_CONTEXT' : null,
      avoidWalletContextBlocked: blocked,
      avoidWalletContextTouchCount: avoidWalletTouches.length,
      avoidWalletContextTouches: avoidWalletTouches.slice(0, 5).map((wallet) => this.walletTouchPayload(wallet)),
      avoidWalletContextThresholds: {
        maxAvoidOrNegativeTouches: 0
      }
    };
  }

  evaluateRequiredWalletContextGuard(state = {}, preset = {}) {
    if (preset.name !== 'highConvictionFirstSight' || !this.highConvictionFirstSightRequireWalletContext) {
      return { passed: true };
    }

    const context = state.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets : [];
    const blocked = wallets.length === 0;
    return {
      passed: !blocked,
      reason: blocked ? 'HIGH_CONVICTION_FIRST_SIGHT_REQUIRES_WALLET_CONTEXT' : null,
      requiredWalletContextBlocked: blocked,
      requiredWalletContextPreset: preset.name,
      requiredWalletContextTouchCount: wallets.length,
      requiredWalletContextThresholds: {
        minWalletTouches: 1
      }
    };
  }

  evaluateHighCurveRequiredWalletContextGuard(state = {}, preset = {}) {
    if (!this.highCurveRequireWalletContext || preset.name === 'curveFalseNegativeWalletBridge') {
      return { passed: true };
    }

    const curveProgress = Number(state.curveProgress);
    if (!Number.isFinite(curveProgress) || curveProgress < this.highCurveRequireWalletContextMinCurveProgress) {
      return { passed: true };
    }

    const context = state.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets : [];
    const blocked = wallets.length === 0;
    return {
      passed: !blocked,
      reason: blocked ? 'HIGH_CURVE_REQUIRES_WALLET_CONTEXT' : null,
      highCurveWalletContextBlocked: blocked,
      highCurveWalletContextPreset: preset.name,
      highCurveWalletContextTouchCount: wallets.length,
      highCurveWalletContextCurveProgress: this.compact(curveProgress, 6),
      highCurveWalletContextThresholds: {
        minCurveProgress: this.highCurveRequireWalletContextMinCurveProgress,
        minWalletTouches: 1
      }
    };
  }

  evaluateHighCurveWalletQualityGuard(state = {}, preset = {}) {
    if (!this.highCurveWalletQualityGuardEnabled || preset.name === 'curveFalseNegativeWalletBridge') {
      return { passed: true };
    }

    const curveProgress = Number(state.curveProgress);
    if (!Number.isFinite(curveProgress) || curveProgress < this.highCurveWalletQualityMinCurveProgress) {
      return { passed: true };
    }

    const context = state.walletClassificationContext || {};
    const wallets = Array.isArray(context.wallets) ? context.wallets : [];
    if (!wallets.length) {
      return { passed: true };
    }

    const sortedWallets = wallets
      .slice()
      .sort((a, b) => new Date(a.tradeAt || 0).getTime() - new Date(b.tradeAt || 0).getTime());
    const positiveTouches = sortedWallets.filter((wallet) => this.isPositiveOrProvenWalletTouch(wallet));
    const positiveFirstTouch = positiveTouches.find((wallet) => String(wallet.side || '').toLowerCase() === 'buy') || null;
    const firstPositiveBuyAtMs = new Date(positiveFirstTouch?.tradeAt || 0).getTime();
    const positiveSellAfterFirstBuy = Number.isFinite(firstPositiveBuyAtMs)
      ? positiveTouches.find((wallet) =>
          String(wallet.side || '').toLowerCase() === 'sell'
          && new Date(wallet.tradeAt || 0).getTime() > firstPositiveBuyAtMs
        )
      : null;
    const firstPositiveTouchLowSignal = positiveFirstTouch
      ? this.isLowSignalWalletTouch(positiveFirstTouch)
      : false;
    const sniperWalletCount = Number(state.sniperWalletCount);
    const sniperCrowdingBlocked = Number.isFinite(sniperWalletCount)
      && Number.isFinite(this.highCurveWalletQualityMaxSniperWalletCount)
      && this.highCurveWalletQualityMaxSniperWalletCount >= 0
      && sniperWalletCount > this.highCurveWalletQualityMaxSniperWalletCount;

    let reason = null;
    if (this.highCurveWalletQualityBlockPositiveSellAfterBuy && positiveSellAfterFirstBuy) {
      reason = 'HIGH_CURVE_WALLET_SELL_AFTER_FIRST_TOUCH';
    } else if (this.highCurveWalletQualityBlockLowSignalFirstTouch && firstPositiveTouchLowSignal) {
      reason = 'HIGH_CURVE_WALLET_LOW_SIGNAL_FIRST_TOUCH';
    } else if (sniperCrowdingBlocked) {
      reason = 'HIGH_CURVE_WALLET_SNIPER_CROWDING';
    }

    return {
      passed: !reason,
      reason,
      highCurveWalletQualityBlocked: Boolean(reason),
      highCurveWalletQualityPreset: preset.name,
      highCurveWalletQualityCurveProgress: this.compact(curveProgress, 6),
      highCurveWalletQualityPositiveTouchCount: positiveTouches.length,
      highCurveWalletQualityFirstPositiveTouch: positiveFirstTouch ? this.walletTouchPayload(positiveFirstTouch) : null,
      highCurveWalletQualityPositiveSellAfterFirstBuy: positiveSellAfterFirstBuy ? this.walletTouchPayload(positiveSellAfterFirstBuy) : null,
      highCurveWalletQualityFirstPositiveTouchLowSignal: firstPositiveTouchLowSignal,
      highCurveWalletQualitySniperWalletCount: Number.isFinite(sniperWalletCount) ? sniperWalletCount : null,
      highCurveWalletQualityThresholds: {
        minCurveProgress: this.highCurveWalletQualityMinCurveProgress,
        blockPositiveSellAfterBuy: this.highCurveWalletQualityBlockPositiveSellAfterBuy,
        blockLowSignalFirstTouch: this.highCurveWalletQualityBlockLowSignalFirstTouch,
        maxSniperWalletCount: this.highCurveWalletQualityMaxSniperWalletCount
      }
    };
  }

  isPositiveOrProvenWalletTouch(wallet = {}) {
    return ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(wallet.evidenceTier)
      || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(wallet.reviewTier);
  }

  isLowSignalWalletTouch(wallet = {}) {
    const label = String(wallet.label || '').toUpperCase();
    return label === 'LOW_SIGNAL'
      || label === 'LOW_SIGNAL_AVOID'
      || label === 'INSUFFICIENT_DATA';
  }

  isAvoidOrNegativeWalletTouch(wallet = {}) {
    const reviewTier = String(wallet.reviewTier || '').toUpperCase();
    const evidenceTier = String(wallet.evidenceTier || '').toUpperCase();
    const label = String(wallet.label || '').toUpperCase();
    return reviewTier === 'AVOID_REVIEW'
      || evidenceTier === 'NEGATIVE_EVIDENCE'
      || label === 'LOW_SIGNAL_AVOID'
      || label === 'AVOID';
  }

  computeBuyRatio(state = {}) {
    const recentBuys = Number(state.recentBuys);
    const recentSells = Number(state.recentSells);
    if (!Number.isFinite(recentBuys) || !Number.isFinite(recentSells)) {
      return null;
    }
    const total = recentBuys + recentSells;
    return total > 0 ? recentBuys / total : null;
  }

  computeUniqueBuyerRatio(state = {}) {
    const uniqueBuyerCount = Number(state.uniqueBuyerCount);
    if (!Number.isFinite(uniqueBuyerCount) || uniqueBuyerCount < 0) {
      return null;
    }

    const recentBuys = Number(state.recentBuys);
    const buys = Number(state.buys);
    const denominator = Number.isFinite(recentBuys) && recentBuys > 0
      ? recentBuys
      : buys;

    if (!Number.isFinite(denominator) || denominator <= 0) {
      return null;
    }

    return Math.min(uniqueBuyerCount / denominator, 1);
  }

  hasPlainAsciiSymbol(symbol) {
    if (!symbol) return false;
    if (!/^[\x20-\x7E]+$/.test(symbol)) return false;
    return /^[A-Za-z0-9$._-]{2,16}$/.test(symbol);
  }

  hasFirstSightConfirmation(state = {}) {
    const repeatedEarlyBuyerCount = Number(state.repeatedEarlyBuyerCount || 0);
    const holderProxy = Number(state.holderProxy || 0);
    const renownedProxy = Number(state.renownedProxy || 0);
    const externalMentionCount = Number(state.externalMentionCount || 0);
    const externalChatCount = Number(state.externalChatCount || 0);
    const reasons = Array.isArray(state.reasons)
      ? state.reasons.map((reason) => String(reason).toLowerCase())
      : [];

    return repeatedEarlyBuyerCount > 0
      || holderProxy >= 50
      || renownedProxy > 0
      || externalMentionCount > 0
      || externalChatCount > 0
      || reasons.some((reason) => (
        reason.includes('kol')
        || reason.includes('rick')
        || reason.includes('telegram')
        || reason.includes('social')
        || reason.includes('repeat_early_buyer')
      ));
  }

  evaluateLateFastTrack(state = {}) {
    if (!this.lateFastTrackEnabled) {
      return { passed: false };
    }

    const score = Number(state.score);
    const curveProgress = Number(state.curveProgress);
    const recentVolumeSol = Number(state.recentVolumeSol);
    const tradeVelocityPerMin = Number(state.tradeVelocityPerMin);

    const passed = Number.isFinite(score)
      && score >= this.lateFastTrackMinScore
      && Number.isFinite(curveProgress)
      && curveProgress >= this.lateFastTrackMinCurveProgress
      && Number.isFinite(recentVolumeSol)
      && recentVolumeSol >= this.lateFastTrackMinRecentVolumeSol
      && Number.isFinite(tradeVelocityPerMin)
      && tradeVelocityPerMin >= this.lateFastTrackMinTradeVelocityPerMin;

    return {
      passed,
      lateFastTrackScore: this.compact(score, 2),
      lateFastTrackCurveProgress: this.compact(curveProgress, 6),
      lateFastTrackRecentVolumeSol: this.compact(recentVolumeSol, 4),
      lateFastTrackTradeVelocityPerMin: this.compact(tradeVelocityPerMin, 2),
      lateFastTrackThresholds: {
        minScore: this.lateFastTrackMinScore,
        minCurveProgress: this.lateFastTrackMinCurveProgress,
        minRecentVolumeSol: this.lateFastTrackMinRecentVolumeSol,
        minTradeVelocityPerMin: this.lateFastTrackMinTradeVelocityPerMin
      }
    };
  }

  findCurveProgressBaseline(history, curveProgress, timestamp) {
    if (!Array.isArray(history) || history.length === 0) {
      return null;
    }

    const nowMs = new Date(timestamp).getTime();
    const lookbackMs = Number.isFinite(this.curveProgressLookbackMs)
      ? this.curveProgressLookbackMs
      : 2 * 60 * 1000;
    const minDistinctDelta = 0.000001;

    for (let index = history.length - 1; index >= 0; index -= 1) {
      const item = history[index];
      const itemProgress = this.toCurveProgress(item?.curveProgress);
      if (!Number.isFinite(itemProgress)) continue;

      const itemMs = new Date(item.timestamp).getTime();
      if (Number.isFinite(nowMs) && Number.isFinite(itemMs) && lookbackMs > 0 && nowMs - itemMs > lookbackMs) {
        break;
      }

      if (Math.abs(curveProgress - itemProgress) >= minDistinctDelta) {
        return item;
      }
    }

    return null;
  }

  computeCurveProgressDeltaForWindow(history, curveProgress, timestamp, windowMs = 60 * 1000) {
    if (!Array.isArray(history) || history.length === 0) {
      return null;
    }

    const nowMs = new Date(timestamp).getTime();
    if (!Number.isFinite(nowMs) || !Number.isFinite(windowMs) || windowMs <= 0) {
      return null;
    }

    let baseline = null;
    for (const item of history) {
      const itemProgress = this.toCurveProgress(item?.curveProgress);
      const itemMs = new Date(item?.timestamp).getTime();
      if (!Number.isFinite(itemProgress) || !Number.isFinite(itemMs)) continue;
      if (itemMs > nowMs || nowMs - itemMs > windowMs) continue;
      if (!baseline || itemMs < new Date(baseline.timestamp).getTime()) {
        baseline = item;
      }
    }

    const baselineProgress = this.toCurveProgress(baseline?.curveProgress);
    if (!Number.isFinite(baselineProgress) || !Number.isFinite(curveProgress)) {
      return null;
    }

    return {
      curveProgressDelta60s: curveProgress - baselineProgress,
      baselineCurveProgress60s: baselineProgress,
      baselineAt60s: baseline.timestamp
    };
  }

  evaluateCloneGuard(state, timestamp) {
    const normalizedSymbol = this.normalizeSymbol(state.symbol || state.name);
    if (!normalizedSymbol || this.cloneGuardMaxEntriesPerSymbol <= 0 || this.cloneGuardWindowMs <= 0) {
      return { passed: true };
    }

    this.pruneSymbolEntryHistory(timestamp);
    const recentEntries = (this.symbolEntryHistory.get(normalizedSymbol) || [])
      .filter((entry) => entry.mint !== state.mint);

    if (recentEntries.length >= this.cloneGuardMaxEntriesPerSymbol) {
      return {
        passed: false,
        reason: 'CLONE_SYMBOL_GUARD',
        normalizedSymbol,
        recentEntries: recentEntries.length,
        threshold: this.cloneGuardMaxEntriesPerSymbol
      };
    }

    return { passed: true, normalizedSymbol };
  }

  enter(state, timestamp, preset, details = {}) {
    const entryPriceSol = this.getPrice(state);
    const strategy = details.effectiveStrategy || preset.strategy;
    const exitProfile = preset.exitProfile || this.buildExitProfile(preset.profileName, strategy);
    const position = {
      presetName: preset.name,
      lane: preset.lane || 'PRE_MIGRATION_RUNNER_WATCH',
      profileName: preset.profileName || exitProfile.profileName,
      exitProfile,
      positionKey: this.positionKey(preset.name, state.mint),
      mint: state.mint,
      symbol: state.symbol || null,
      entryAt: timestamp,
      entryPriceSol,
      amountSol: strategy.amountSol,
      entryScore: this.compact(state.score, 2),
      entryCurveProgress: this.compact(state.curveProgress, 6),
      entryRecentVolumeSol: this.compact(state.recentVolumeSol, 4),
      entryTradeVelocityPerMin: this.compact(state.tradeVelocityPerMin, 2),
      entryUniqueBuyerCount: Number.isFinite(Number(state.uniqueBuyerCount)) ? Number(state.uniqueBuyerCount) : null,
      entryUniqueBuyerRatio: this.compact(this.computeUniqueBuyerRatio(state), 4),
      entrySniperWalletCount: Number.isFinite(Number(state.sniperWalletCount)) ? Number(state.sniperWalletCount) : null,
      entryReasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 10) : [],
      guardOverride: details.guardOverride || null,
      walletClassificationContext: state.walletClassificationContext || null,
      lastPriceSol: entryPriceSol,
      maxPriceSol: entryPriceSol,
      minPriceSol: entryPriceSol,
      maxCurveProgress: Number(state.curveProgress || 0),
      peakReturnPct: 0,
      lastObservedAt: timestamp
    };

    this.openPositions.set(position.positionKey, position);
    this.recordSymbolEntry(position, timestamp);
    this.recordDecision('PAPER_ENTERED', preset.name);
    this.stats.entries += 1;
    this.stats.lastEntryAt = timestamp;
    this.updatePresetEntryStats(preset.name);
    this.updateLaneEntryStats(position.lane);
    this.updateProfileEntryStats(position.profileName, exitProfile);

    return {
      type: 'entry',
      telemetryType: 'pre_migration_paper.entry',
      payload: {
        ...this.basePayload(position),
        decision: 'PAPER_ENTERED',
        preset: preset.name,
        lane: position.lane,
        profileName: position.profileName,
        strategy,
        exitProfile,
        walletClassificationContext: position.walletClassificationContext,
        score: position.entryScore,
        curveProgress: position.entryCurveProgress,
        recentVolumeSol: position.entryRecentVolumeSol,
        tradeVelocityPerMin: position.entryTradeVelocityPerMin,
        guardOverride: position.guardOverride,
        reasons: position.entryReasons,
        ...this.reservesPayload(state)
      }
    };
  }

  getActivePositionForMint(mint) {
    if (!mint) {
      return null;
    }

    return Array.from(this.openPositions.values())
      .find((position) => position.mint === mint) || null;
  }

  buildShadowDecision(details = {}, activePosition = {}) {
    return {
      ...details,
      passed: false,
      reason: 'ACTIVE_PRE_MIGRATION_POSITION',
      shadowPresetWouldEnter: true,
      activePreset: activePosition.presetName || null,
      activePositionKey: activePosition.positionKey || null,
      activeEntryAt: activePosition.entryAt || null,
      activeEntryPriceSol: this.compact(activePosition.entryPriceSol, 15),
      activeEntryScore: this.compact(activePosition.entryScore, 2),
      activeEntryCurveProgress: this.compact(activePosition.entryCurveProgress, 6),
      activeGuardOverride: activePosition.guardOverride || null
    };
  }

  evaluateExit(position, state, timestamp, price) {
    position.lastPriceSol = price;
    position.maxPriceSol = Math.max(position.maxPriceSol || price, price);
    position.minPriceSol = Math.min(position.minPriceSol || price, price);

    const curveProgress = Number(state.curveProgress);
    if (Number.isFinite(curveProgress)) {
      position.maxCurveProgress = Math.max(position.maxCurveProgress || 0, curveProgress);
    }
    position.lastObservedAt = timestamp;

    const returnPct = (price - position.entryPriceSol) / position.entryPriceSol;
    const holdSeconds = this.secondsBetween(position.entryAt, timestamp);
    const strategy = this.getStrategy(position.presetName);
    const exitProfile = position.exitProfile || this.getExitProfile(position.presetName);
    position.peakReturnPct = Math.max(Number(position.peakReturnPct || 0), returnPct);

    if (
      exitProfile.trailingGivebackEnabled
      && Number(position.peakReturnPct || 0) >= Number(exitProfile.trailingActivationPct)
      && Number(position.peakReturnPct || 0) - returnPct >= Number(exitProfile.trailingGivebackPct)
    ) {
      return this.exitPosition(position, timestamp, price, 'TRAILING_GIVEBACK', state);
    }

    if (
      exitProfile.breakevenStopEnabled
      && Number(position.peakReturnPct || 0) >= Number(exitProfile.breakevenActivationPct)
      && returnPct <= Number(exitProfile.breakevenStopPct)
    ) {
      return this.exitPosition(position, timestamp, price, 'BREAKEVEN_STOP', state);
    }

    if (
      exitProfile.sellPressureExitEnabled
      && Number.isFinite(holdSeconds)
      && holdSeconds >= Number(exitProfile.sellPressureMinHoldSeconds)
    ) {
      const buyRatio = this.computeBuyRatio(state);
      if (Number.isFinite(buyRatio) && buyRatio <= Number(exitProfile.sellPressureBuyRatioThreshold)) {
        return this.exitPosition(position, timestamp, price, 'SELL_PRESSURE_FLIP', state);
      }
    }

    if (
      exitProfile.curveStallExitEnabled
      && Number.isFinite(holdSeconds)
      && holdSeconds >= Number(exitProfile.curveStallSeconds)
    ) {
      const entryProgress = Number(position.entryCurveProgress);
      const maxProgress = Number(position.maxCurveProgress);
      const progressAdvance = Number.isFinite(entryProgress) && Number.isFinite(maxProgress)
        ? maxProgress - entryProgress
        : null;
      if (Number.isFinite(progressAdvance) && progressAdvance < Number(exitProfile.curveStallMinProgressAdvance)) {
        return this.exitPosition(position, timestamp, price, 'CURVE_STALL', state);
      }
    }

    if (returnPct >= strategy.takeProfitPct) {
      return this.exitPosition(position, timestamp, price, 'TAKE_PROFIT', state);
    }

    if (returnPct <= -strategy.stopLossPct) {
      return this.exitPosition(position, timestamp, price, 'STOP_LOSS', state);
    }

    if (Number.isFinite(holdSeconds) && holdSeconds >= strategy.maxHoldSeconds) {
      return this.exitPosition(position, timestamp, price, 'TIME_LIMIT', state);
    }

    return null;
  }

  checkOpenPositionTimeouts(timestamp = new Date().toISOString()) {
    const events = [];

    for (const position of Array.from(this.openPositions.values())) {
      const strategy = this.getStrategy(position.presetName);
      const holdSeconds = this.secondsBetween(position.entryAt, timestamp);

      if (!Number.isFinite(holdSeconds) || holdSeconds < strategy.maxHoldSeconds) {
        continue;
      }

      const fallbackPrice = Number.isFinite(Number(position.lastPriceSol)) && Number(position.lastPriceSol) > 0
        ? Number(position.lastPriceSol)
        : Number(position.entryPriceSol);
      const event = this.exitPosition(position, timestamp, fallbackPrice, 'TIME_LIMIT', {
        curveProgress: position.maxCurveProgress
      });
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  exit(mint, timestamp, price, reason, state = {}) {
    const position = Array.from(this.openPositions.values()).find((openPosition) => openPosition.mint === mint);
    if (!position) {
      return null;
    }
    return this.exitPosition(position, timestamp, price, reason, state);
  }

  exitPosition(position, timestamp, price, reason, state = {}) {
    const strategy = this.getStrategy(position.presetName);

    const returnPct = price > 0 && position.entryPriceSol > 0
      ? (price - position.entryPriceSol) / position.entryPriceSol
      : 0;
    const pnlSol = strategy.amountSol * returnPct;
    const closed = {
      ...position,
      exitAt: timestamp,
      exitPriceSol: price,
      exitReason: reason,
      exitCurveProgress: this.compact(state.curveProgress, 6),
      returnPct: this.compact(returnPct, 6),
      pnlSol: this.compact(pnlSol, 9),
      holdSeconds: this.secondsBetween(position.entryAt, timestamp),
      maxPriceSol: this.compact(position.maxPriceSol, 15),
      minPriceSol: this.compact(position.minPriceSol, 15),
      maxCurveProgress: this.compact(position.maxCurveProgress, 6)
    };

    this.openPositions.delete(position.positionKey);
    this.closedPositions.push(closed);
    this.recordSameMintExitCooldown(closed, timestamp);
    this.recordBadExitCooldown(closed, timestamp);
    this.recordDecision('PAPER_EXITED', position.presetName);
    this.stats.exits += 1;
    this.stats.lastExitAt = timestamp;
    this.stats.totalPnlSol = this.compact(Number(this.stats.totalPnlSol || 0) + pnlSol, 9);
    this.stats.exitReasonCounts[reason] = (this.stats.exitReasonCounts[reason] || 0) + 1;
    if (pnlSol > 0) this.stats.wins += 1;
    if (pnlSol < 0) this.stats.losses += 1;
    this.updatePresetExitStats(position.presetName, reason, pnlSol);
    this.updateLaneExitStats(position.lane, reason, pnlSol);
    this.updateProfileExitStats(position.profileName, reason, pnlSol);

    return {
      type: 'exit',
      telemetryType: 'pre_migration_paper.exit',
      payload: {
        ...this.basePayload(closed),
        decision: 'PAPER_EXITED',
        preset: position.presetName,
        lane: position.lane || null,
        profileName: position.profileName || null,
        reason,
        exitProfile: position.exitProfile || this.getExitProfile(position.presetName),
        walletClassificationContext: position.walletClassificationContext || null,
        exitPriceSol: this.compact(price, 15),
        exitCurveProgress: closed.exitCurveProgress,
        returnPct: closed.returnPct,
        pnlSol: closed.pnlSol,
        holdSeconds: closed.holdSeconds,
        maxCurveProgress: closed.maxCurveProgress,
        peakReturnPct: this.compact(position.peakReturnPct, 6),
        ...this.reservesPayload(state)
      }
    };
  }

  closeAll(reason = 'SESSION_END') {
    const timestamp = new Date().toISOString();
    const events = [];

    for (const position of Array.from(this.openPositions.values())) {
      const fallbackPrice = Number.isFinite(Number(position.lastPriceSol))
        ? Number(position.lastPriceSol)
        : Number(position.entryPriceSol);
      const event = this.exitPosition(position, timestamp, fallbackPrice, reason, {
        curveProgress: position.maxCurveProgress
      });
      if (event) {
        events.push(event);
      }
    }

    return events;
  }

  recordBadExitCooldown(closed, timestamp) {
    if (!closed?.mint || this.badExitCooldownMs <= 0) {
      return;
    }

    const pnlSol = Number(closed.pnlSol);
    const shouldCooldown = closed.exitReason === 'STOP_LOSS' || (Number.isFinite(pnlSol) && pnlSol < 0);
    if (!shouldCooldown) {
      return;
    }

    const nowMs = new Date(timestamp).getTime();
    if (!Number.isFinite(nowMs)) {
      return;
    }

    this.badExitCooldowns.set(closed.mint, {
      mint: closed.mint,
      symbol: closed.symbol || null,
      presetName: closed.presetName || null,
      reason: closed.exitReason || 'BAD_EXIT',
      pnlSol: closed.pnlSol,
      startedAt: timestamp,
      until: new Date(nowMs + this.badExitCooldownMs).toISOString()
    });
  }

  recordSameMintExitCooldown(closed, timestamp) {
    if (!closed?.mint || this.sameMintReentryCooldownMs <= 0) {
      return;
    }

    const nowMs = new Date(timestamp).getTime();
    if (!Number.isFinite(nowMs)) {
      return;
    }

    this.sameMintExitCooldowns.set(closed.mint, {
      mint: closed.mint,
      presetName: closed.presetName || null,
      reason: closed.exitReason || 'RECENT_EXIT',
      pnlSol: closed.pnlSol,
      until: new Date(nowMs + this.sameMintReentryCooldownMs).toISOString()
    });
  }

  getSameMintExitCooldown(mint, timestamp) {
    if (!mint || this.sameMintReentryCooldownMs <= 0) {
      return { active: false };
    }

    const cooldown = this.sameMintExitCooldowns.get(mint);
    if (!cooldown?.until) {
      return { active: false };
    }

    const nowMs = new Date(timestamp).getTime();
    const untilMs = new Date(cooldown.until).getTime();
    if (!Number.isFinite(nowMs) || !Number.isFinite(untilMs)) {
      this.sameMintExitCooldowns.delete(mint);
      return { active: false };
    }

    if (nowMs >= untilMs) {
      this.sameMintExitCooldowns.delete(mint);
      return { active: false };
    }

    return {
      active: true,
      until: cooldown.until,
      remainingMs: untilMs - nowMs,
      reason: cooldown.reason || null,
      presetName: cooldown.presetName || null
    };
  }

  getBadExitCooldown(mint, timestamp) {
    if (!mint || this.badExitCooldownMs <= 0) {
      return { active: false };
    }

    const cooldown = this.badExitCooldowns.get(mint);
    if (!cooldown?.until) {
      return { active: false };
    }

    const nowMs = new Date(timestamp).getTime();
    const untilMs = new Date(cooldown.until).getTime();
    if (!Number.isFinite(nowMs) || !Number.isFinite(untilMs)) {
      this.badExitCooldowns.delete(mint);
      return { active: false };
    }

    if (nowMs >= untilMs) {
      this.badExitCooldowns.delete(mint);
      return { active: false };
    }

    return {
      active: true,
      until: cooldown.until,
      remainingMs: Math.max(0, untilMs - nowMs),
      reason: cooldown.reason || null,
      presetName: cooldown.presetName || null
    };
  }

  getPrice(state = {}) {
    const price = Number(
      state.bondingCurvePriceSol
      ?? state.priceSol
      ?? state.curvePriceSol
      ?? state.bondingCurveState?.priceSol
    );
    if (Number.isFinite(price) && price > 0) {
      return price;
    }
    const derived = this.derivePriceFromReserves(state);
    if (Number.isFinite(derived) && derived > 0) {
      return derived;
    }
    return Number.isFinite(price) ? price : null;
  }

  derivePriceFromReserves(state = {}) {
    const sol = Number(
      state.virtualSolReservesSol
      ?? state.bondingCurveState?.virtualSolReservesSol
    );
    const tokens = Number(
      state.virtualTokenReservesTokens
      ?? state.bondingCurveState?.virtualTokenReservesTokens
    );
    if (!Number.isFinite(sol) || sol <= 0 || !Number.isFinite(tokens) || tokens <= 0) {
      return null;
    }
    return sol / tokens;
  }

  reservesPayload(state = {}) {
    const virtualSolReservesSol = Number(
      state.virtualSolReservesSol
      ?? state.bondingCurveState?.virtualSolReservesSol
    );
    const virtualTokenReservesTokens = Number(
      state.virtualTokenReservesTokens
      ?? state.bondingCurveState?.virtualTokenReservesTokens
    );
    const realSolReservesSol = Number(
      state.realSolReservesSol
      ?? state.bondingCurveState?.realSolReservesSol
    );
    return {
      quoteMint: state.quoteMint || state.bondingCurveState?.quoteMint || null,
      pairBase: state.pairBase || state.bondingCurveState?.pairBase || null,
      virtualSolReservesSol: Number.isFinite(virtualSolReservesSol) ? this.compact(virtualSolReservesSol, 6) : null,
      virtualTokenReservesTokens: Number.isFinite(virtualTokenReservesTokens) ? this.compact(virtualTokenReservesTokens, 6) : null,
      realSolReservesSol: Number.isFinite(realSolReservesSol) ? this.compact(realSolReservesSol, 6) : null
    };
  }

  toCurveProgress(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const progress = Number(value);
    return Number.isFinite(progress) ? progress : null;
  }

  hasValidCurveHistory(history = []) {
    return Array.isArray(history) && history.some((item) => Number.isFinite(this.toCurveProgress(item?.curveProgress)));
  }

  rememberObservation(state, timestamp, price) {
    if (!state?.mint) {
      return;
    }

    const curveProgress = this.toCurveProgress(state.curveProgress);
    this.lastObservedStates.set(state.mint, {
      timestamp,
      curveProgress,
      price
    });

    const history = this.observationHistory.get(state.mint) || [];
    if (Number.isFinite(curveProgress)) {
      history.push({
        timestamp,
        curveProgress,
        price
      });
    }

    const nowMs = new Date(timestamp).getTime();
    const maxAgeMs = Math.max(Number(this.curveProgressLookbackMs || 0), 5 * 60 * 1000);
    const freshHistory = history
      .filter((item) => {
        const itemMs = new Date(item.timestamp).getTime();
        return !Number.isFinite(nowMs) || !Number.isFinite(itemMs) || nowMs - itemMs <= maxAgeMs;
      })
      .slice(-25);
    this.observationHistory.set(state.mint, freshHistory);

    const maxTracked = Number(this.config.preMigrationPaperMaxObservedStates || 5000);
    if (this.lastObservedStates.size > maxTracked) {
      const oldestKey = this.lastObservedStates.keys().next().value;
      if (oldestKey) {
        this.lastObservedStates.delete(oldestKey);
        this.observationHistory.delete(oldestKey);
      }
    }
  }

  decisionEvent(decision, state, timestamp, preset, details = {}) {
    this.recordDecision(decision, preset.name, details.reason);
    const priceSol = this.compact(this.getPrice(state), 15);

    return {
      type: 'decision',
      telemetryType: 'pre_migration_paper.decision',
      payload: {
        decision,
        preset: preset.name,
        lane: preset.lane || null,
        profileName: preset.profileName || null,
        mint: state.mint,
        symbol: state.symbol || null,
        timestamp,
        reason: details.reason || null,
        score: this.compact(state.score, 2),
        curveProgress: this.compact(state.curveProgress, 6),
        recentVolumeSol: this.compact(state.recentVolumeSol, 4),
        tradeVelocityPerMin: this.compact(state.tradeVelocityPerMin, 2),
        uniqueBuyerCount: Number.isFinite(Number(state.uniqueBuyerCount)) ? Number(state.uniqueBuyerCount) : null,
        uniqueBuyerRatio: this.compact(this.computeUniqueBuyerRatio(state), 4),
        sniperWalletCount: Number.isFinite(Number(state.sniperWalletCount)) ? Number(state.sniperWalletCount) : null,
        priceSol,
        bondingCurvePriceSol: priceSol,
        curvePriceSol: priceSol,
        ...this.reservesPayload(state),
        curveProgressDelta: this.compact(details.curveProgressDelta, 6),
        curveProgressDelta60s: this.compact(details.curveProgressDelta60s, 6),
        baselineCurveProgress: this.compact(details.baselineCurveProgress, 6),
        baselineCurveProgress60s: this.compact(details.baselineCurveProgress60s, 6),
        baselineAt: details.baselineAt || null,
        baselineAt60s: details.baselineAt60s || null,
        guardOverride: details.guardOverride || null,
        lateFastTrackScore: this.compact(details.lateFastTrackScore, 2),
        lateFastTrackCurveProgress: this.compact(details.lateFastTrackCurveProgress, 6),
        lateFastTrackRecentVolumeSol: this.compact(details.lateFastTrackRecentVolumeSol, 4),
        lateFastTrackTradeVelocityPerMin: this.compact(details.lateFastTrackTradeVelocityPerMin, 2),
        lateFastTrackThresholds: details.lateFastTrackThresholds || null,
        firstSightScore: this.compact(details.firstSightScore, 2),
        firstSightCurveProgress: this.compact(details.firstSightCurveProgress, 6),
        firstSightRecentVolumeSol: this.compact(details.firstSightRecentVolumeSol, 4),
        firstSightTradeVelocityPerMin: this.compact(details.firstSightTradeVelocityPerMin, 2),
        firstSightBuyRatio: this.compact(details.firstSightBuyRatio, 4),
        firstSightHasConfirmation: details.firstSightHasConfirmation ?? null,
        firstSightThresholds: details.firstSightThresholds || null,
        firstCurveSnapshotScalpScore: this.compact(details.firstCurveSnapshotScalpScore, 2),
        firstCurveSnapshotScalpCurveProgress: this.compact(details.firstCurveSnapshotScalpCurveProgress, 6),
        firstCurveSnapshotScalpRecentVolumeSol: this.compact(details.firstCurveSnapshotScalpRecentVolumeSol, 4),
        firstCurveSnapshotScalpTradeVelocityPerMin: this.compact(details.firstCurveSnapshotScalpTradeVelocityPerMin, 2),
        firstCurveSnapshotScalpInterestSignalCount: Number.isFinite(Number(details.firstCurveSnapshotScalpInterestSignalCount)) ? Number(details.firstCurveSnapshotScalpInterestSignalCount) : null,
        firstCurveSnapshotScalpUniqueBuyerCount: Number.isFinite(Number(details.firstCurveSnapshotScalpUniqueBuyerCount)) ? Number(details.firstCurveSnapshotScalpUniqueBuyerCount) : null,
        firstCurveSnapshotScalpRiskWalletCount: Number.isFinite(Number(details.firstCurveSnapshotScalpRiskWalletCount)) ? Number(details.firstCurveSnapshotScalpRiskWalletCount) : null,
        firstCurveSnapshotScalpSniperWalletCount: Number.isFinite(Number(details.firstCurveSnapshotScalpSniperWalletCount)) ? Number(details.firstCurveSnapshotScalpSniperWalletCount) : null,
        firstCurveSnapshotScalpCurveSnapshotAgeSeconds: this.compact(details.firstCurveSnapshotScalpCurveSnapshotAgeSeconds, 2),
        firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds: this.compact(details.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds, 2),
        firstCurveSnapshotScalpStaleCurveBlocked: details.firstCurveSnapshotScalpStaleCurveBlocked ?? null,
        firstCurveSnapshotScalpSniperCrowdingBlocked: details.firstCurveSnapshotScalpSniperCrowdingBlocked ?? null,
        firstCurveSnapshotScalpBuyRatio: this.compact(details.firstCurveSnapshotScalpBuyRatio, 4),
        firstCurveSnapshotScalpHasPrice: details.firstCurveSnapshotScalpHasPrice ?? null,
        firstCurveSnapshotScalpThresholds: details.firstCurveSnapshotScalpThresholds || null,
        highCurveStaleSnapshotBlocked: details.highCurveStaleSnapshotBlocked ?? null,
        highCurveStaleSnapshotGuardEnabled: details.highCurveStaleSnapshotGuardEnabled ?? null,
        highCurveStaleSnapshotGuardOverride: details.highCurveStaleSnapshotGuardOverride || null,
        highCurveStaleSnapshotCurveProgress: this.compact(details.highCurveStaleSnapshotCurveProgress, 6),
        highCurveStaleSnapshotCurveSnapshotAgeSeconds: this.compact(details.highCurveStaleSnapshotCurveSnapshotAgeSeconds, 2),
        highCurveStaleSnapshotMinCurveProgress: this.compact(details.highCurveStaleSnapshotMinCurveProgress, 6),
        highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds: this.compact(details.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds, 2),
        walletBridgeProof: this.walletBridgeProofPayload(details),
        curvePauseScore: this.compact(details.curvePauseScore, 2),
        curvePauseCurveProgress: this.compact(details.curvePauseCurveProgress, 6),
        curvePauseRecentVolumeSol: this.compact(details.curvePauseRecentVolumeSol, 4),
        curvePauseTradeVelocityPerMin: this.compact(details.curvePauseTradeVelocityPerMin, 2),
        curvePauseBuyRatio: this.compact(details.curvePauseBuyRatio, 4),
        curvePauseHasConfirmation: details.curvePauseHasConfirmation ?? null,
        curvePauseThresholds: details.curvePauseThresholds || null,
        earlyAccelerationScore: this.compact(details.earlyAccelerationScore, 2),
        earlyAccelerationCurveProgress: this.compact(details.earlyAccelerationCurveProgress, 6),
        earlyAccelerationRecentVolumeSol: this.compact(details.earlyAccelerationRecentVolumeSol, 4),
        earlyAccelerationTradeVelocityPerMin: this.compact(details.earlyAccelerationTradeVelocityPerMin, 2),
        earlyAccelerationBuyRatio: this.compact(details.earlyAccelerationBuyRatio, 4),
        earlyAccelerationRepeatedEarlyBuyerCount: details.earlyAccelerationRepeatedEarlyBuyerCount ?? null,
        earlyAccelerationHolderProxy: details.earlyAccelerationHolderProxy ?? null,
        earlyAccelerationThresholds: details.earlyAccelerationThresholds || null,
        earlyAccelerationWeakWalletFlowBlocked: details.earlyAccelerationWeakWalletFlowBlocked ?? null,
        earlyAccelerationWeakWalletFlowObservedTouches: details.earlyAccelerationWeakWalletFlowObservedTouches ?? null,
        earlyAccelerationWeakWalletFlowLowSignalTouches: details.earlyAccelerationWeakWalletFlowLowSignalTouches ?? null,
        earlyAccelerationWeakWalletFlowLateSellSol: this.compact(details.earlyAccelerationWeakWalletFlowLateSellSol, 4),
        earlyAccelerationWeakWalletFlowPositiveSignals: details.earlyAccelerationWeakWalletFlowPositiveSignals ?? null,
        earlyAccelerationWeakWalletFlowThresholds: details.earlyAccelerationWeakWalletFlowThresholds || null,
        earlyAccelerationAvoidWalletContextBlocked: details.earlyAccelerationAvoidWalletContextBlocked ?? null,
        earlyAccelerationAvoidWalletContextTouchCount: details.earlyAccelerationAvoidWalletContextTouchCount ?? null,
        earlyAccelerationAvoidWalletContextTouches: details.earlyAccelerationAvoidWalletContextTouches || null,
        earlyAccelerationAvoidWalletContextThresholds: details.earlyAccelerationAvoidWalletContextThresholds || null,
        earlySurgeScore: this.compact(details.earlySurgeScore, 2),
        earlySurgeCurveProgress: this.compact(details.earlySurgeCurveProgress, 6),
        earlySurgeRecentVolumeSol: this.compact(details.earlySurgeRecentVolumeSol, 4),
        earlySurgeTradeVelocityPerMin: this.compact(details.earlySurgeTradeVelocityPerMin, 2),
        earlySurgeBuyRatio: this.compact(details.earlySurgeBuyRatio, 4),
        earlySurgeHasConfirmation: details.earlySurgeHasConfirmation ?? null,
        earlySurgeDeltaGuardMode: details.earlySurgeDeltaGuardMode || null,
        earlySurgeCurveProgressDelta: this.compact(details.earlySurgeCurveProgressDelta, 6),
        earlySurgeCurveProgressDelta60s: this.compact(details.earlySurgeCurveProgressDelta60s, 6),
        earlySurgeBaselineCurveProgress: this.compact(details.earlySurgeBaselineCurveProgress, 6),
        earlySurgeBaselineCurveProgress60s: this.compact(details.earlySurgeBaselineCurveProgress60s, 6),
        earlySurgeBaselineAt: details.earlySurgeBaselineAt || null,
        earlySurgeBaselineAt60s: details.earlySurgeBaselineAt60s || null,
        earlySurgePassesCurveDeltaGuard: details.earlySurgePassesCurveDeltaGuard ?? null,
        earlySurgeThresholds: details.earlySurgeThresholds || null,
        thresholdOverrides: details.thresholdOverrides || null,
        value: details.value ?? null,
        threshold: details.threshold ?? null,
        normalizedSymbol: details.normalizedSymbol || null,
        recentEntries: details.recentEntries ?? null,
        shadowPresetWouldEnter: Boolean(details.shadowPresetWouldEnter),
        activePreset: details.activePreset || null,
        activePositionKey: details.activePositionKey || null,
        activeEntryAt: details.activeEntryAt || null,
        activeEntryPriceSol: this.compact(details.activeEntryPriceSol, 15),
        activeEntryScore: this.compact(details.activeEntryScore, 2),
        activeEntryCurveProgress: this.compact(details.activeEntryCurveProgress, 6),
        activeGuardOverride: details.activeGuardOverride || null,
        badExitCooldownUntil: details.badExitCooldownUntil || null,
        badExitCooldownRemainingMs: details.badExitCooldownRemainingMs ?? null,
        badExitCooldownReason: details.badExitCooldownReason || null,
        badExitCooldownPreset: details.badExitCooldownPreset || null,
        sameMintCooldownUntil: details.sameMintCooldownUntil || null,
        sameMintCooldownRemainingMs: details.sameMintCooldownRemainingMs ?? null,
        sameMintCooldownReason: details.sameMintCooldownReason || null,
        sameMintCooldownPreset: details.sameMintCooldownPreset || null,
        requiredWalletContextBlocked: details.requiredWalletContextBlocked ?? null,
        requiredWalletContextPreset: details.requiredWalletContextPreset || null,
        requiredWalletContextTouchCount: details.requiredWalletContextTouchCount ?? null,
        requiredWalletContextThresholds: details.requiredWalletContextThresholds || null,
        highCurveWalletContextBlocked: details.highCurveWalletContextBlocked ?? null,
        highCurveWalletContextPreset: details.highCurveWalletContextPreset || null,
        highCurveWalletContextTouchCount: details.highCurveWalletContextTouchCount ?? null,
        highCurveWalletContextCurveProgress: details.highCurveWalletContextCurveProgress ?? null,
        highCurveWalletContextThresholds: details.highCurveWalletContextThresholds || null,
        highCurveWalletQualityBlocked: details.highCurveWalletQualityBlocked ?? null,
        highCurveWalletQualityPreset: details.highCurveWalletQualityPreset || null,
        highCurveWalletQualityCurveProgress: details.highCurveWalletQualityCurveProgress ?? null,
        highCurveWalletQualityPositiveTouchCount: details.highCurveWalletQualityPositiveTouchCount ?? null,
        highCurveWalletQualityFirstPositiveTouch: details.highCurveWalletQualityFirstPositiveTouch || null,
        highCurveWalletQualityPositiveSellAfterFirstBuy: details.highCurveWalletQualityPositiveSellAfterFirstBuy || null,
        highCurveWalletQualityFirstPositiveTouchLowSignal: details.highCurveWalletQualityFirstPositiveTouchLowSignal ?? null,
        highCurveWalletQualitySniperWalletCount: details.highCurveWalletQualitySniperWalletCount ?? null,
        highCurveWalletQualityThresholds: details.highCurveWalletQualityThresholds || null,
        avoidWalletContextBlocked: details.avoidWalletContextBlocked ?? null,
        avoidWalletContextTouchCount: details.avoidWalletContextTouchCount ?? null,
        avoidWalletContextTouches: details.avoidWalletContextTouches || null,
        avoidWalletContextThresholds: details.avoidWalletContextThresholds || null,
        walletClassificationContext: state.walletClassificationContext || null,
        reasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 10) : []
      }
    };
  }

  guardAttributionEvent(state, timestamp, preset, decision = {}, entryGuards = {}, meta = {}) {
    const priceSol = this.compact(this.getPrice(state), 15);
    const allowedPresetNames = Array.isArray(entryGuards.allowedPresetNames)
      ? entryGuards.allowedPresetNames.slice()
      : null;
    const presetEligibleForGuardOverride = !allowedPresetNames || allowedPresetNames.includes(preset.name);
    const failedChecks = this.collectAttributionFailedChecks(decision, entryGuards);

    return {
      type: 'diagnostic',
      telemetryType: 'pre_migration_paper.guard_attribution',
      payload: {
        mint: state.mint,
        symbol: state.symbol || null,
        timestamp,
        flagged: meta.flagged === true,
        shadowOnly: meta.shadowOnly === true,
        shadowReason: meta.shadowReason || null,
        preset: preset.name,
        lane: preset.lane || null,
        profileName: preset.profileName || null,
        outcome: decision.passed ? 'PAPER_WOULD_ENTER' : 'PAPER_WOULD_SKIP',
        reason: decision.reason || null,
        suppressedPresetIneligible: meta.suppressedPresetIneligible === true,
        guardPassed: entryGuards.passed === true,
        guardReason: entryGuards.reason || null,
        guardOverride: entryGuards.guardOverride || decision.guardOverride || null,
        allowedPresetNames,
        presetEligibleForGuardOverride,
        thresholdOverrides: decision.thresholdOverrides || entryGuards.thresholdOverrides || null,
        failedChecks,
        score: this.compact(state.score, 2),
        curveProgress: this.compact(state.curveProgress, 6),
        recentVolumeSol: this.compact(state.recentVolumeSol, 4),
        tradeVelocityPerMin: this.compact(state.tradeVelocityPerMin, 2),
        buyRatio: this.compact(this.computeBuyRatio(state), 4),
        uniqueBuyerCount: Number.isFinite(Number(state.uniqueBuyerCount)) ? Number(state.uniqueBuyerCount) : null,
        uniqueBuyerRatio: this.compact(this.computeUniqueBuyerRatio(state), 4),
        sniperWalletCount: Number.isFinite(Number(state.sniperWalletCount)) ? Number(state.sniperWalletCount) : null,
        priceSol,
        bondingCurvePriceSol: priceSol,
        curvePriceSol: priceSol,
        ...this.reservesPayload(state),
        curveProgressDelta: this.compact(decision.curveProgressDelta ?? entryGuards.curveProgressDelta, 6),
        curveProgressDelta60s: this.compact(decision.curveProgressDelta60s ?? entryGuards.curveProgressDelta60s, 6),
        baselineCurveProgress: this.compact(decision.baselineCurveProgress ?? entryGuards.baselineCurveProgress, 6),
        baselineCurveProgress60s: this.compact(decision.baselineCurveProgress60s ?? entryGuards.baselineCurveProgress60s, 6),
        baselineAt: decision.baselineAt || entryGuards.baselineAt || null,
        baselineAt60s: decision.baselineAt60s || entryGuards.baselineAt60s || null,
        highCurveStaleSnapshotBlocked: decision.highCurveStaleSnapshotBlocked ?? entryGuards.highCurveStaleSnapshotBlocked ?? null,
        highCurveStaleSnapshotGuardEnabled: decision.highCurveStaleSnapshotGuardEnabled ?? entryGuards.highCurveStaleSnapshotGuardEnabled ?? null,
        highCurveStaleSnapshotGuardOverride: decision.highCurveStaleSnapshotGuardOverride || entryGuards.highCurveStaleSnapshotGuardOverride || null,
        highCurveStaleSnapshotCurveProgress: this.compact(decision.highCurveStaleSnapshotCurveProgress ?? entryGuards.highCurveStaleSnapshotCurveProgress, 6),
        highCurveStaleSnapshotCurveSnapshotAgeSeconds: this.compact(decision.highCurveStaleSnapshotCurveSnapshotAgeSeconds ?? entryGuards.highCurveStaleSnapshotCurveSnapshotAgeSeconds, 2),
        highCurveStaleSnapshotMinCurveProgress: this.compact(decision.highCurveStaleSnapshotMinCurveProgress ?? entryGuards.highCurveStaleSnapshotMinCurveProgress, 6),
        highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds: this.compact(decision.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds ?? entryGuards.highCurveStaleSnapshotMaxCurveSnapshotAgeSeconds, 2),
        firstCurveSnapshotScalpCurveSnapshotAgeSeconds: this.compact(decision.firstCurveSnapshotScalpCurveSnapshotAgeSeconds ?? entryGuards.firstCurveSnapshotScalpCurveSnapshotAgeSeconds, 2),
        firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds: this.compact(decision.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds ?? entryGuards.firstCurveSnapshotScalpMaxCurveSnapshotAgeSeconds, 2),
        firstCurveSnapshotScalpStaleCurveBlocked: decision.firstCurveSnapshotScalpStaleCurveBlocked ?? entryGuards.firstCurveSnapshotScalpStaleCurveBlocked ?? null,
        firstCurveSnapshotScalpSniperCrowdingBlocked: decision.firstCurveSnapshotScalpSniperCrowdingBlocked ?? entryGuards.firstCurveSnapshotScalpSniperCrowdingBlocked ?? null,
        firstSightHasConfirmation: decision.firstSightHasConfirmation ?? entryGuards.firstSightHasConfirmation ?? null,
        earlySurgeHasConfirmation: decision.earlySurgeHasConfirmation ?? entryGuards.earlySurgeHasConfirmation ?? null,
        broadOrganicSurgeHasConfirmation: decision.broadOrganicSurgeHasConfirmation ?? entryGuards.broadOrganicSurgeHasConfirmation ?? null,
        curvePauseHasConfirmation: decision.curvePauseHasConfirmation ?? entryGuards.curvePauseHasConfirmation ?? null,
        firstCurveSnapshotScalpFailedChecks: Array.isArray(decision.failedChecks || entryGuards.failedChecks)
          ? (decision.failedChecks || entryGuards.failedChecks)
          : [],
        value: decision.value ?? null,
        threshold: decision.threshold ?? null,
        badExitCooldownUntil: decision.badExitCooldownUntil || null,
        badExitCooldownRemainingMs: decision.badExitCooldownRemainingMs ?? null,
        badExitCooldownReason: decision.badExitCooldownReason || null,
        badExitCooldownPreset: decision.badExitCooldownPreset || null,
        sameMintCooldownUntil: decision.sameMintCooldownUntil || null,
        sameMintCooldownRemainingMs: decision.sameMintCooldownRemainingMs ?? null,
        sameMintCooldownReason: decision.sameMintCooldownReason || null,
        sameMintCooldownPreset: decision.sameMintCooldownPreset || null,
        requiredWalletContextBlocked: decision.requiredWalletContextBlocked ?? entryGuards.requiredWalletContextBlocked ?? null,
        requiredWalletContextPreset: decision.requiredWalletContextPreset || entryGuards.requiredWalletContextPreset || null,
        requiredWalletContextTouchCount: decision.requiredWalletContextTouchCount ?? entryGuards.requiredWalletContextTouchCount ?? null,
        requiredWalletContextThresholds: decision.requiredWalletContextThresholds || entryGuards.requiredWalletContextThresholds || null,
        highCurveWalletContextBlocked: decision.highCurveWalletContextBlocked ?? entryGuards.highCurveWalletContextBlocked ?? null,
        highCurveWalletContextPreset: decision.highCurveWalletContextPreset || entryGuards.highCurveWalletContextPreset || null,
        highCurveWalletContextTouchCount: decision.highCurveWalletContextTouchCount ?? entryGuards.highCurveWalletContextTouchCount ?? null,
        highCurveWalletContextCurveProgress: decision.highCurveWalletContextCurveProgress ?? entryGuards.highCurveWalletContextCurveProgress ?? null,
        highCurveWalletContextThresholds: decision.highCurveWalletContextThresholds || entryGuards.highCurveWalletContextThresholds || null,
        highCurveWalletQualityBlocked: decision.highCurveWalletQualityBlocked ?? entryGuards.highCurveWalletQualityBlocked ?? null,
        highCurveWalletQualityPreset: decision.highCurveWalletQualityPreset || entryGuards.highCurveWalletQualityPreset || null,
        highCurveWalletQualityCurveProgress: decision.highCurveWalletQualityCurveProgress ?? entryGuards.highCurveWalletQualityCurveProgress ?? null,
        highCurveWalletQualityPositiveTouchCount: decision.highCurveWalletQualityPositiveTouchCount ?? entryGuards.highCurveWalletQualityPositiveTouchCount ?? null,
        highCurveWalletQualityFirstPositiveTouch: decision.highCurveWalletQualityFirstPositiveTouch || entryGuards.highCurveWalletQualityFirstPositiveTouch || null,
        highCurveWalletQualityPositiveSellAfterFirstBuy: decision.highCurveWalletQualityPositiveSellAfterFirstBuy || entryGuards.highCurveWalletQualityPositiveSellAfterFirstBuy || null,
        highCurveWalletQualityFirstPositiveTouchLowSignal: decision.highCurveWalletQualityFirstPositiveTouchLowSignal ?? entryGuards.highCurveWalletQualityFirstPositiveTouchLowSignal ?? null,
        highCurveWalletQualitySniperWalletCount: decision.highCurveWalletQualitySniperWalletCount ?? entryGuards.highCurveWalletQualitySniperWalletCount ?? null,
        highCurveWalletQualityThresholds: decision.highCurveWalletQualityThresholds || entryGuards.highCurveWalletQualityThresholds || null,
        avoidWalletContextBlocked: decision.avoidWalletContextBlocked ?? entryGuards.avoidWalletContextBlocked ?? null,
        avoidWalletContextTouchCount: decision.avoidWalletContextTouchCount ?? entryGuards.avoidWalletContextTouchCount ?? null,
        avoidWalletContextTouches: decision.avoidWalletContextTouches || entryGuards.avoidWalletContextTouches || null,
        avoidWalletContextThresholds: decision.avoidWalletContextThresholds || entryGuards.avoidWalletContextThresholds || null,
        earlyAccelerationAvoidWalletContextBlocked: decision.earlyAccelerationAvoidWalletContextBlocked ?? entryGuards.earlyAccelerationAvoidWalletContextBlocked ?? null,
        earlyAccelerationAvoidWalletContextTouchCount: decision.earlyAccelerationAvoidWalletContextTouchCount ?? entryGuards.earlyAccelerationAvoidWalletContextTouchCount ?? null,
        earlyAccelerationAvoidWalletContextTouches: decision.earlyAccelerationAvoidWalletContextTouches || entryGuards.earlyAccelerationAvoidWalletContextTouches || null,
        earlyAccelerationAvoidWalletContextThresholds: decision.earlyAccelerationAvoidWalletContextThresholds || entryGuards.earlyAccelerationAvoidWalletContextThresholds || null,
        walletBridgeProof: this.walletBridgeProofPayload(decision, entryGuards),
        walletClassificationContext: state.walletClassificationContext || null,
        reasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 10) : []
      }
    };
  }

  walletBridgeProofPayload(...sources) {
    const pick = (key) => {
      for (const source of sources) {
        if (!source || typeof source !== 'object') continue;
        const value = source[key];
        if (value !== undefined && value !== null) return value;
      }
      return null;
    };

    const hasBridgeContext = sources.some((source) => (
      source
      && typeof source === 'object'
      && (
        source.trackedFirstTouchBuy
        || source.positiveFirstTouchBuy
        || source.earliestWalletTouch
        || source.earliestWalletBuy
        || source.earliestPre85BuyTouch
        || source.firstAvoidTouch
        || source.walletTouchCount !== undefined
        || source.walletBuyTouchCount !== undefined
        || source.pre85BuyTouchCount !== undefined
      )
    ));
    if (!hasBridgeContext) return null;

    return {
      walletTouchCount: pick('walletTouchCount'),
      walletBuyTouchCount: pick('walletBuyTouchCount'),
      pre85BuyTouchCount: pick('pre85BuyTouchCount'),
      positiveOrProvenTouchCount: pick('positiveOrProvenTouchCount'),
      avoidTouchCount: pick('avoidTouchCount'),
      bridgeRequiresPositiveWallet: pick('bridgeRequiresPositiveWallet'),
      trackedFirstTouchBuy: pick('trackedFirstTouchBuy'),
      positiveFirstTouchBuy: pick('positiveFirstTouchBuy'),
      earliestWalletTouch: pick('earliestWalletTouch'),
      earliestWalletBuy: pick('earliestWalletBuy'),
      earliestPre85BuyTouch: pick('earliestPre85BuyTouch'),
      firstAvoidTouch: pick('firstAvoidTouch'),
      walletContextSource: pick('walletContextSource'),
      walletContextEarliestTouchAt: pick('walletContextEarliestTouchAt'),
      walletContextEarliestBuyAt: pick('walletContextEarliestBuyAt')
    };
  }

  collectAttributionFailedChecks(decision = {}, entryGuards = {}) {
    const checks = new Set();
    for (const details of [entryGuards, decision]) {
      if (!details || typeof details !== 'object') continue;
      if (details.reason) checks.add(details.reason);
      if (Array.isArray(details.failedChecks)) {
        for (const check of details.failedChecks) {
          if (check) checks.add(check);
        }
      }
      if (details.highCurveStaleSnapshotBlocked) checks.add('HIGH_CURVE_STALE_CURVE_UPDATE');
      if (details.requiredWalletContextBlocked) checks.add('HIGH_CONVICTION_FIRST_SIGHT_REQUIRES_WALLET_CONTEXT');
      if (details.highCurveWalletContextBlocked) checks.add('HIGH_CURVE_REQUIRES_WALLET_CONTEXT');
      if (details.highCurveWalletQualityBlocked) checks.add(details.reason || 'HIGH_CURVE_WALLET_QUALITY');
      if (details.earlyAccelerationWeakWalletFlowBlocked) checks.add('EARLY_ACCELERATION_WEAK_WALLET_FLOW');
      if (details.avoidWalletContextBlocked) checks.add('AVOID_WALLET_CONTEXT');
      if (details.earlyAccelerationAvoidWalletContextBlocked) checks.add('EARLY_ACCELERATION_AVOID_WALLET_CONTEXT');
      if (details.firstCurveSnapshotScalpSniperCrowdingBlocked) checks.add('FIRST_CURVE_SNAPSHOT_SCALP_SNIPER_CROWDING');
      if (details.firstCurveSnapshotScalpStaleCurveBlocked) checks.add('FIRST_CURVE_SNAPSHOT_SCALP_STALE_CURVE_UPDATE');
    }
    return Array.from(checks);
  }

  recordDecision(decision, presetName, reason = null) {
    this.stats.decisionCounts[decision] = (this.stats.decisionCounts[decision] || 0) + 1;

    if (reason) {
      this.stats.skipReasonCounts[reason] = (this.stats.skipReasonCounts[reason] || 0) + 1;
    }

    if (decision === 'PAPER_ELIGIBLE') {
      this.stats.eligibleCounts[presetName] = (this.stats.eligibleCounts[presetName] || 0) + 1;
    }

    const presetStats = this.stats.presets[presetName];
    if (!presetStats) return;
    presetStats.decisionCounts[decision] = (presetStats.decisionCounts[decision] || 0) + 1;
    if (reason) {
      presetStats.skipReasonCounts[reason] = (presetStats.skipReasonCounts[reason] || 0) + 1;
    }
    if (decision === 'PAPER_ELIGIBLE') {
      presetStats.eligibleCount += 1;
    }
  }

  recordSymbolEntry(position, timestamp) {
    const normalizedSymbol = this.normalizeSymbol(position.symbol);
    if (!normalizedSymbol) {
      return;
    }

    const entries = this.symbolEntryHistory.get(normalizedSymbol) || [];
    entries.push({
      mint: position.mint,
      preset: position.presetName,
      timestamp
    });
    this.symbolEntryHistory.set(normalizedSymbol, entries);
  }

  pruneSymbolEntryHistory(timestamp) {
    const nowMs = new Date(timestamp).getTime();
    if (!Number.isFinite(nowMs)) {
      return;
    }

    for (const [symbol, entries] of this.symbolEntryHistory.entries()) {
      const freshEntries = entries.filter((entry) => {
        const entryMs = new Date(entry.timestamp).getTime();
        return Number.isFinite(entryMs) && nowMs - entryMs <= this.cloneGuardWindowMs;
      });

      if (freshEntries.length === 0) {
        this.symbolEntryHistory.delete(symbol);
      } else {
        this.symbolEntryHistory.set(symbol, freshEntries);
      }
    }
  }

  normalizeSymbol(value) {
    if (!value) {
      return null;
    }

    const normalized = String(value)
      .normalize('NFKD')
      .replace(/[^\w$]+/g, '')
      .toLowerCase();

    return normalized || null;
  }

  basePayload(position) {
    return {
      preset: position.presetName,
      lane: position.lane || null,
      profileName: position.profileName || null,
      mint: position.mint,
      symbol: position.symbol || null,
      entryAt: position.entryAt,
      entryPriceSol: this.compact(position.entryPriceSol, 15),
      amountSol: position.amountSol,
      entryScore: position.entryScore,
      entryCurveProgress: position.entryCurveProgress,
      entryUniqueBuyerCount: position.entryUniqueBuyerCount,
      entryUniqueBuyerRatio: position.entryUniqueBuyerRatio,
      entrySniperWalletCount: position.entrySniperWalletCount,
      exitProfile: position.exitProfile || null,
      walletClassificationContext: position.walletClassificationContext || null
    };
  }

  positionKey(presetName, mint) {
    return `${presetName}:${mint}`;
  }

  getStrategy(presetName) {
    return this.presets.find((preset) => preset.name === presetName)?.strategy || this.strategy;
  }

  getExitProfile(presetName) {
    const preset = this.presets.find((candidate) => candidate.name === presetName);
    return preset?.exitProfile || this.buildExitProfile(preset?.profileName, preset?.strategy || this.strategy);
  }

  updatePresetEntryStats(presetName) {
    const presetStats = this.stats.presets[presetName];
    if (!presetStats) return;
    presetStats.entries += 1;
    presetStats.openPositions += 1;
  }

  updatePresetExitStats(presetName, reason, pnlSol) {
    const presetStats = this.stats.presets[presetName];
    if (!presetStats) return;
    presetStats.exits += 1;
    presetStats.openPositions = Math.max(0, presetStats.openPositions - 1);
    presetStats.closedTrades += 1;
    presetStats.totalPnlSol = this.compact(Number(presetStats.totalPnlSol || 0) + pnlSol, 9);
    presetStats.exitReasonCounts[reason] = (presetStats.exitReasonCounts[reason] || 0) + 1;
    if (pnlSol > 0) presetStats.wins += 1;
    if (pnlSol < 0) presetStats.losses += 1;
    presetStats.winRate = presetStats.closedTrades > 0
      ? this.compact(presetStats.wins / presetStats.closedTrades, 4)
      : null;
  }

  ensureLaneStats(lane) {
    const key = lane || 'UNKNOWN';
    if (!this.stats.lanes[key]) {
      this.stats.lanes[key] = this.createGroupedStats();
    }
    return this.stats.lanes[key];
  }

  ensureProfileStats(profileName, exitProfile = null) {
    const key = profileName || 'unknown';
    if (!this.stats.profiles[key]) {
      this.stats.profiles[key] = {
        ...this.createGroupedStats(),
        exitProfile
      };
    } else if (exitProfile && !this.stats.profiles[key].exitProfile) {
      this.stats.profiles[key].exitProfile = exitProfile;
    }
    return this.stats.profiles[key];
  }

  createGroupedStats() {
    return {
      entries: 0,
      exits: 0,
      wins: 0,
      losses: 0,
      totalPnlSol: 0,
      openPositions: 0,
      closedTrades: 0,
      winRate: null,
      exitReasonCounts: {}
    };
  }

  updateLaneEntryStats(lane) {
    const laneStats = this.ensureLaneStats(lane);
    laneStats.entries += 1;
    laneStats.openPositions += 1;
  }

  updateLaneExitStats(lane, reason, pnlSol) {
    this.applyGroupedExitStats(this.ensureLaneStats(lane), reason, pnlSol);
  }

  updateProfileEntryStats(profileName, exitProfile) {
    const profileStats = this.ensureProfileStats(profileName, exitProfile);
    profileStats.entries += 1;
    profileStats.openPositions += 1;
  }

  updateProfileExitStats(profileName, reason, pnlSol) {
    this.applyGroupedExitStats(this.ensureProfileStats(profileName), reason, pnlSol);
  }

  applyGroupedExitStats(groupStats, reason, pnlSol) {
    groupStats.exits += 1;
    groupStats.openPositions = Math.max(0, groupStats.openPositions - 1);
    groupStats.closedTrades += 1;
    groupStats.totalPnlSol = this.compact(Number(groupStats.totalPnlSol || 0) + pnlSol, 9);
    groupStats.exitReasonCounts[reason] = (groupStats.exitReasonCounts[reason] || 0) + 1;
    if (pnlSol > 0) groupStats.wins += 1;
    if (pnlSol < 0) groupStats.losses += 1;
    groupStats.winRate = groupStats.closedTrades > 0
      ? this.compact(groupStats.wins / groupStats.closedTrades, 4)
      : null;
  }

  secondsBetween(startIso, endIso) {
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      return null;
    }
    return this.compact((endMs - startMs) / 1000, 2);
  }

  compact(value, decimals = 6) {
    if (value === null || value === undefined) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
  }

  getStats() {
    const closedTrades = this.closedPositions.length;
    return {
      ...this.stats,
      strategy: this.strategy,
      presets: this.stats.presets,
      openPositions: this.openPositions.size,
      closedTrades,
      badExitCooldowns: this.badExitCooldowns.size,
      winRate: closedTrades > 0 ? this.compact(this.stats.wins / closedTrades, 4) : null,
      totalPnlSol: this.compact(this.stats.totalPnlSol, 9),
      recentOpenPositions: Array.from(this.openPositions.values()).slice(-5).map((position) => ({
        mint: position.mint,
        symbol: position.symbol,
        entryAt: position.entryAt,
        entryScore: position.entryScore,
        entryCurveProgress: position.entryCurveProgress
      })),
      recentClosedPositions: this.closedPositions.slice(-5)
    };
  }
}

module.exports = PreMigrationPaperLane;
