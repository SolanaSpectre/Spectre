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
    this.curvePauseOverrideEnabled = config.preMigrationPaperCurvePauseOverrideEnabled !== false;
    this.curvePauseMinScore = Number(config.preMigrationPaperCurvePauseMinScore ?? 82);
    this.curvePauseMinCurveProgress = Number(config.preMigrationPaperCurvePauseMinCurveProgress ?? 0.75);
    this.curvePauseMinRecentVolumeSol = Number(config.preMigrationPaperCurvePauseMinRecentVolumeSol ?? 12);
    this.curvePauseMinTradeVelocityPerMin = Number(config.preMigrationPaperCurvePauseMinTradeVelocityPerMin ?? 12);
    this.curvePauseMinBuyRatio = Number(config.preMigrationPaperCurvePauseMinBuyRatio ?? 0.4);
    this.earlyAccelerationMinScore = Number(config.preMigrationPaperEarlyAccelerationRunnerMinScore ?? 84.5);
    this.earlyAccelerationMinCurveProgress = Number(config.preMigrationPaperEarlyAccelerationRunnerMinCurveProgress ?? 0.88);
    this.earlyAccelerationMinRecentVolumeSol = Number(config.preMigrationPaperEarlyAccelerationRunnerMinRecentVolumeSol ?? 60);
    this.earlyAccelerationMinTradeVelocityPerMin = Number(config.preMigrationPaperEarlyAccelerationRunnerMinTradeVelocityPerMin ?? 40);
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
      presets: {}
    };
    this.lastObservedStates = new Map();
    this.observationHistory = new Map();
    this.symbolEntryHistory = new Map();
    this.badExitCooldowns = new Map();

    for (const preset of this.presets) {
      this.stats.presets[preset.name] = this.createPresetStats(preset.strategy);
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
    const entryGuards = this.evaluateEntryGuards(state, history, timestamp);

    for (const preset of this.presets) {
      const key = this.positionKey(preset.name, mint);
      const position = this.openPositions.get(key);
      let exitedThisObservation = false;

      if (position && Number.isFinite(price) && price > 0) {
        const exit = this.evaluateExit(position, state, timestamp, price);
        if (exit) {
          events.push(exit);
          exitedThisObservation = true;
        }
      }

      if (
        !exitedThisObservation
        && !this.openPositions.has(key)
        && options.flagged === true
      ) {
        const cooldown = this.getBadExitCooldown(mint, timestamp);
        if (cooldown.active) {
          events.push(this.decisionEvent('PAPER_SKIPPED', state, timestamp, preset, {
            passed: false,
            reason: 'RECENT_BAD_EXIT_COOLDOWN',
            badExitCooldownUntil: cooldown.until,
            badExitCooldownRemainingMs: cooldown.remainingMs,
            badExitCooldownReason: cooldown.reason,
            badExitCooldownPreset: cooldown.presetName
          }));
          continue;
        }

        const decision = this.evaluateEntryDecision(state, preset, entryGuards);
        if (decision.passed) {
          const activePosition = this.getActivePositionForMint(mint);
          if (activePosition) {
            events.push(this.decisionEvent(
              'PAPER_SHADOWED',
              state,
              timestamp,
              preset,
              this.buildShadowDecision(decision, activePosition)
            ));
          } else {
            events.push(this.decisionEvent('PAPER_ELIGIBLE', state, timestamp, preset, decision));
            events.push(this.enter(state, timestamp, preset, decision));
          }
        } else if (decision.reason !== 'PRESET_NOT_ELIGIBLE_FOR_GUARD_OVERRIDE') {
          events.push(this.decisionEvent('PAPER_SKIPPED', state, timestamp, preset, decision));
        }
      }
    }

    this.rememberObservation(state, timestamp, price);
    return events;
  }

  buildPresets(config) {
    const strictMigration = {
      name: 'strictMigration',
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
      strategy: {
        minScore: config.preMigrationPaperEarlyAccelerationRunnerMinScore,
        minCurveProgress: config.preMigrationPaperEarlyAccelerationRunnerMinCurveProgress,
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

    const enabled = String(config.preMigrationPaperEnabledPresets || 'strictMigration,highConfidenceRunner,earlyAccelerationRunner,highConvictionFirstSight')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const presets = [strictMigration, highConfidenceRunner, earlyAccelerationRunner, highConvictionFirstSight]
      .filter((preset) => enabled.includes(preset.name));
    return presets.length > 0 ? presets : [strictMigration];
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

  evaluateEntryDecision(state, preset, entryGuards) {
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

    const cloneGuard = this.evaluateCloneGuard(state, timestamp);
    if (!cloneGuard.passed) {
      return cloneGuard;
    }

    return {
      ...curveGuard,
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
        return {
          passed: true,
          guardOverride: 'LATE_NEAR_COMPLETION_FAST_TRACK',
          ...lateFastTrack
        };
      }

      const earlyAcceleration = this.evaluateEarlyAccelerationFastTrack(state);
      if (earlyAcceleration.passed) {
        return {
          passed: true,
          guardOverride: 'EARLY_ACCELERATION_FAST_TRACK',
          allowedPresetNames: ['earlyAccelerationRunner'],
          ...earlyAcceleration
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
      const itemProgress = Number(item?.curveProgress);
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
      const itemProgress = Number(item?.curveProgress);
      const itemMs = new Date(item?.timestamp).getTime();
      if (!Number.isFinite(itemProgress) || !Number.isFinite(itemMs)) continue;
      if (itemMs > nowMs || nowMs - itemMs > windowMs) continue;
      if (!baseline || itemMs < new Date(baseline.timestamp).getTime()) {
        baseline = item;
      }
    }

    const baselineProgress = Number(baseline?.curveProgress);
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
    const position = {
      presetName: preset.name,
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
      lastPriceSol: entryPriceSol,
      maxPriceSol: entryPriceSol,
      minPriceSol: entryPriceSol,
      maxCurveProgress: Number(state.curveProgress || 0),
      lastObservedAt: timestamp
    };

    this.openPositions.set(position.positionKey, position);
    this.recordSymbolEntry(position, timestamp);
    this.recordDecision('PAPER_ENTERED', preset.name);
    this.stats.entries += 1;
    this.stats.lastEntryAt = timestamp;
    this.updatePresetEntryStats(preset.name);

    return {
      type: 'entry',
      telemetryType: 'pre_migration_paper.entry',
      payload: {
        ...this.basePayload(position),
        decision: 'PAPER_ENTERED',
        preset: preset.name,
        strategy,
        score: position.entryScore,
        curveProgress: position.entryCurveProgress,
        recentVolumeSol: position.entryRecentVolumeSol,
        tradeVelocityPerMin: position.entryTradeVelocityPerMin,
        guardOverride: position.guardOverride,
        reasons: position.entryReasons
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
    this.recordBadExitCooldown(closed, timestamp);
    this.recordDecision('PAPER_EXITED', position.presetName);
    this.stats.exits += 1;
    this.stats.lastExitAt = timestamp;
    this.stats.totalPnlSol = this.compact(Number(this.stats.totalPnlSol || 0) + pnlSol, 9);
    this.stats.exitReasonCounts[reason] = (this.stats.exitReasonCounts[reason] || 0) + 1;
    if (pnlSol > 0) this.stats.wins += 1;
    if (pnlSol < 0) this.stats.losses += 1;
    this.updatePresetExitStats(position.presetName, reason, pnlSol);

    return {
      type: 'exit',
      telemetryType: 'pre_migration_paper.exit',
      payload: {
        ...this.basePayload(closed),
        decision: 'PAPER_EXITED',
        preset: position.presetName,
        reason,
        exitPriceSol: this.compact(price, 15),
        exitCurveProgress: closed.exitCurveProgress,
        returnPct: closed.returnPct,
        pnlSol: closed.pnlSol,
        holdSeconds: closed.holdSeconds,
        maxCurveProgress: closed.maxCurveProgress
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
    return Number.isFinite(price) ? price : null;
  }

  rememberObservation(state, timestamp, price) {
    if (!state?.mint) {
      return;
    }

    this.lastObservedStates.set(state.mint, {
      timestamp,
      curveProgress: Number(state.curveProgress),
      price
    });

    const history = this.observationHistory.get(state.mint) || [];
    history.push({
      timestamp,
      curveProgress: Number(state.curveProgress),
      price
    });

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

    return {
      type: 'decision',
      telemetryType: 'pre_migration_paper.decision',
      payload: {
        decision,
        preset: preset.name,
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
        priceSol: this.compact(this.getPrice(state), 15),
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
        reasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 10) : []
      }
    };
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
      mint: position.mint,
      symbol: position.symbol || null,
      entryAt: position.entryAt,
      entryPriceSol: this.compact(position.entryPriceSol, 15),
      amountSol: position.amountSol,
      entryScore: position.entryScore,
      entryCurveProgress: position.entryCurveProgress,
      entryUniqueBuyerCount: position.entryUniqueBuyerCount,
      entryUniqueBuyerRatio: position.entryUniqueBuyerRatio,
      entrySniperWalletCount: position.entrySniperWalletCount
    };
  }

  positionKey(presetName, mint) {
    return `${presetName}:${mint}`;
  }

  getStrategy(presetName) {
    return this.presets.find((preset) => preset.name === presetName)?.strategy || this.strategy;
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
