class PreMigrationWatchLane {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.preMigrationWatchEnabled !== false;
    this.minScoreToFlag = config.preMigrationWatchMinScore;
    this.confirmMinScore = config.preMigrationWatchConfirmMinScore ?? this.minScoreToFlag;
    this.interestMinTradeVelocityPerMin = config.preMigrationWatchInterestMinTradeVelocityPerMin ?? 1.5;
    this.interestMinRecentVolumeSol = config.preMigrationWatchInterestMinRecentVolumeSol ?? 0.15;
    this.interestMinCurveProgress = config.preMigrationWatchInterestMinCurveProgress ?? 0.45;
    this.interestMinUniqueBuyerCount = config.preMigrationWatchInterestMinUniqueBuyerCount ?? 4;
    this.confirmMinObservations = config.preMigrationWatchConfirmMinObservations ?? 2;
    this.confirmMinGapMs = config.preMigrationWatchConfirmMinGapMs ?? 30000;
    this.fastTrackScore = config.preMigrationWatchFastTrackScore ?? 75;
    this.requireSecondarySignal = config.preMigrationWatchRequireSecondarySignal !== false;
    this.strongNoSecondaryScore = config.preMigrationWatchStrongNoSecondaryScore ?? 80;
    this.minCurveProgress = config.preMigrationWatchMinCurveProgress;
    this.flagCooldownMs = config.preMigrationWatchFlagCooldownMs;
    this.maxTrackedMints = config.preMigrationWatchMaxTrackedMints;
    this.states = new Map();
    this.stats = {
      enabled: this.enabled,
      trackedMints: 0,
      updates: 0,
      observedSignals: 0,
      confirmedFlags: 0,
      flags: 0,
      migrations: 0,
      lastFlagAt: null
    };
  }

  observeToken(token = {}, launchIntelSummary = null, walletClassificationContext = null) {
    if (!this.enabled) {
      return { updated: false, flagged: false, state: null };
    }

    const mint = token.mint || token.mintAddress || token.token || token.id;
    if (!mint) {
      return { updated: false, flagged: false, state: null };
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const existing = this.states.get(mint) || this.createInitialState(mint, token, nowIso);
    const next = this.mergeObservation(existing, token, launchIntelSummary, walletClassificationContext, now, nowIso);
    const score = this.computeScore(next);
    const signal = this.updateSignalState(next, score, now, nowIso);
    const reasons = this.buildReasons(next, score);

    next.score = score;
    next.reasons = reasons;
    next.flagged = Boolean(next.flagged || signal.shouldFlag);

    if (signal.observedInterest) {
      this.stats.observedSignals += 1;
    } else if (signal.observedSignal) {
      this.stats.observedSignals += 1;
    }

    if (signal.newlyConfirmed) {
      this.stats.confirmedFlags += 1;
    }

    if (signal.shouldFlag) {
      next.lastFlaggedAt = nowIso;
      next.lastFlagType = signal.flagType || 'confirmed';
      next.flagCount = Number(next.flagCount || 0) + 1;
      this.stats.flags += 1;
      this.stats.lastFlagAt = nowIso;
    }

    this.states.set(mint, next);
    this.compactIfNeeded();
    this.stats.updates += 1;
    this.stats.trackedMints = this.states.size;

    return {
      updated: true,
      flagged: signal.shouldFlag,
      flagType: signal.flagType,
      observedInterest: signal.observedInterest,
      observedSignal: signal.observedSignal,
      confirmed: Boolean(next.confirmed),
      newlyConfirmed: signal.newlyConfirmed,
      state: this.toSummary(next)
    };
  }

  markMigrated(mint, event = {}) {
    if (!this.enabled || !mint) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const existing = this.states.get(mint) || this.createInitialState(mint, event, nowIso);
    const next = {
      ...existing,
      migratedAt: nowIso,
      migrationEvent: {
        signature: event.signature || event.txSignature || event.sig || null,
        source: event.source || 'pumpportal_migration'
      }
    };

    this.states.set(mint, next);
    this.stats.migrations += 1;
    this.stats.trackedMints = this.states.size;
    return this.toSummary(next);
  }

  createInitialState(mint, token, nowIso) {
    return {
      mint,
      symbol: token.symbol || null,
      name: token.name || null,
      source: token.source || 'pumpportal',
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      createdAt: token.createdAt || nowIso,
      firstTradeAt: null,
      migratedAt: null,
      tradeCount: 0,
      buys: 0,
      sells: 0,
      volumeSol: 0,
      quoteMint: token.quoteMint || null,
      pairBase: token.pairBase || null,
      recentTradeCount: 0,
      recentBuys: 0,
      recentSells: 0,
      recentVolumeSol: 0,
      tradeVelocityPerMin: 0,
      buyRatioCaptured: false,
      liquiditySol: 0,
      marketCapSol: 0,
      bondingCurveAddress: null,
      bondingCurveComplete: false,
      virtualSolReservesSol: null,
      realSolReservesSol: null,
      virtualTokenReservesTokens: null,
      bondingCurvePriceSol: null,
      bondingStage: null,
      curveProgress: null,
      curveProgressSource: null,
      providerCurveProgress: null,
      providerCurvePriceSol: null,
      providerCurveSnapshotAt: null,
      holderProxy: 0,
      uniqueBuyerCount: 0,
      uniqueBuyerCountCaptured: false,
      uniqueBuyerRatio: null,
      externalMentionCount: 0,
      externalChatCount: 0,
      kolFirstWaveCount: 0,
      kolTrustedCount: 0,
      repeatedEarlyBuyerCount: 0,
      earlySniperCount: 0,
      alphaScalperCount: 0,
      convictionWhaleCount: 0,
      riskWalletCount: 0,
      lateChaserCount: 0,
      sniperWalletCount: 0,
      sniperWalletCountCaptured: false,
      bundlerCandidate: false,
      score: 0,
      reasons: [],
      flagged: false,
      lastFlagType: null,
      flagCount: 0,
      interestSignalCount: 0,
      lastInterestAt: null,
      observedSignalCount: 0,
      firstSignalAt: null,
      lastSignalAt: null,
      confirmed: false,
      confirmedAt: null,
      confirmationReason: null,
      confirmCount: 0,
      lastFlaggedAt: null,
      lastSignificantAt: nowIso
    };
  }

  mergeObservation(existing, token, launchIntelSummary, walletClassificationContext, now, nowIso) {
    const curveProgress = this.extractCurveProgress(token);
    const tradeCount = Number(token.tradeCount || existing.tradeCount || 0);
    const buys = Number(token.buys || existing.buys || 0);
    const sells = Number(token.sells || existing.sells || 0);
    const recentTradeCount = Number(token.recentTradeCount || existing.recentTradeCount || 0);
    const recentBuys = Number(token.recentBuys || existing.recentBuys || 0);
    const recentSells = Number(token.recentSells || existing.recentSells || 0);
    const recentVolumeSol = Number(token.recentVolumeSol || existing.recentVolumeSol || 0);
    const tradeVelocityPerMin = Number(token.tradeVelocityPerMin || existing.tradeVelocityPerMin || 0);
    const recentFlowCount = recentBuys + recentSells;
    const buyRatioCaptured = recentFlowCount > 0;
    const volumeSol = Number(token.volumeSol || token.volume24h || existing.volumeSol || 0);
    const liquiditySol = Number(token.liquiditySol || token.liquidity || existing.liquiditySol || 0);
    const marketCapSol = Number(token.marketCapSol || token.marketCap || existing.marketCapSol || 0);
    const bondingCurveState = token.bondingCurveState || {};
    const externalVisibility = launchIntelSummary?.heuristics?.externalVisibility || {};
    const kolOverlap = launchIntelSummary?.heuristics?.kolOverlap || {};
    const walletContext = walletClassificationContext || {};
    const launchUniqueBuyerCountRaw = launchIntelSummary?.uniqueBuyerCount;
    const tokenUniqueBuyerCountRaw = token.uniqueBuyerCount;
    const hasLaunchUniqueBuyerCount = launchUniqueBuyerCountRaw !== undefined
      && launchUniqueBuyerCountRaw !== null
      && launchUniqueBuyerCountRaw !== ''
      && Number.isFinite(Number(launchUniqueBuyerCountRaw));
    const hasTokenUniqueBuyerCount = tokenUniqueBuyerCountRaw !== undefined
      && tokenUniqueBuyerCountRaw !== null
      && tokenUniqueBuyerCountRaw !== ''
      && Number.isFinite(Number(tokenUniqueBuyerCountRaw));
    const launchUniqueBuyerCount = hasLaunchUniqueBuyerCount ? Number(launchUniqueBuyerCountRaw) : null;
    const tokenUniqueBuyerCount = hasTokenUniqueBuyerCount ? Number(tokenUniqueBuyerCountRaw) : null;
    const uniqueBuyerCountCaptured = Boolean(existing.uniqueBuyerCountCaptured)
      || hasLaunchUniqueBuyerCount
      || hasTokenUniqueBuyerCount;
    const uniqueBuyerCount = Math.max(
      Number(existing.uniqueBuyerCount || 0),
      hasLaunchUniqueBuyerCount ? launchUniqueBuyerCount : 0,
      hasTokenUniqueBuyerCount ? tokenUniqueBuyerCount : 0
    );
    const launchSniperWalletCountRaw = launchIntelSummary?.heuristics?.sniperWalletCount;
    const hasLaunchSniperWalletCount = launchSniperWalletCountRaw !== undefined
      && launchSniperWalletCountRaw !== null
      && launchSniperWalletCountRaw !== ''
      && Number.isFinite(Number(launchSniperWalletCountRaw));
    const launchSniperWalletCount = hasLaunchSniperWalletCount ? Number(launchSniperWalletCountRaw) : null;
    const sniperWalletCountCaptured = Boolean(existing.sniperWalletCountCaptured)
      || hasLaunchSniperWalletCount;
    const uniqueBuyerRatio = this.computeUniqueBuyerRatio(uniqueBuyerCount, recentBuys, buys, existing.uniqueBuyerRatio);

    const next = {
      ...existing,
      symbol: existing.symbol || token.symbol || launchIntelSummary?.symbol || null,
      name: existing.name || token.name || launchIntelSummary?.name || null,
      source: token.source || existing.source || 'pumpportal',
      lastSeenAt: nowIso,
      createdAt: existing.createdAt || token.createdAt || launchIntelSummary?.createdAt || nowIso,
      firstTradeAt: existing.firstTradeAt || token.firstTradeAt || launchIntelSummary?.firstTradeAt || null,
      migratedAt: existing.migratedAt || token.migratedAt || launchIntelSummary?.migratedAt || null,
      tradeCount,
      buys,
      sells,
      volumeSol,
      quoteMint: token.quoteMint || bondingCurveState.quoteMint || existing.quoteMint || null,
      pairBase: token.pairBase || bondingCurveState.pairBase || existing.pairBase || null,
      recentTradeCount,
      recentBuys,
      recentSells,
      recentVolumeSol,
      tradeVelocityPerMin,
      buyRatioCaptured,
      liquiditySol,
      marketCapSol,
      bondingCurveAddress: token.bondingCurveAddress || bondingCurveState.bondingCurveAddress || existing.bondingCurveAddress || null,
      bondingCurveAccountFound: Boolean(
        token.bondingCurveAccountFound
        || bondingCurveState.accountFound
        || existing.bondingCurveAccountFound
      ),
      bondingCurveComplete: Boolean(token.bondingCurveComplete || bondingCurveState.complete || existing.bondingCurveComplete),
      virtualSolReservesSol: token.virtualSolReservesSol ?? bondingCurveState.virtualSolReservesSol ?? existing.virtualSolReservesSol ?? null,
      realSolReservesSol: token.realSolReservesSol ?? bondingCurveState.realSolReservesSol ?? existing.realSolReservesSol ?? null,
      virtualTokenReservesTokens: token.virtualTokenReservesTokens ?? bondingCurveState.virtualTokenReservesTokens ?? existing.virtualTokenReservesTokens ?? null,
      bondingCurvePriceSol: token.bondingCurvePriceSol ?? bondingCurveState.priceSol ?? existing.bondingCurvePriceSol ?? null,
      lastCurveUpdateAt: token.lastCurveUpdateAt
        || token.bondingCurveLastFetchAt
        || bondingCurveState.lastFetchAt
        || bondingCurveState.lastFetchAtIso
        || existing.lastCurveUpdateAt
        || null,
      bondingStage: token.bondingStage || existing.bondingStage || null,
      curveProgress: curveProgress ?? existing.curveProgress ?? null,
      curveProgressSource: token.curveProgressSource
        || token.providerCurveSource
        || bondingCurveState.curveProgressSource
        || existing.curveProgressSource
        || null,
      providerCurveProgress: token.providerCurveProgress
        ?? bondingCurveState.providerCurveProgress
        ?? existing.providerCurveProgress
        ?? null,
      providerCurvePriceSol: token.providerCurvePriceSol
        ?? bondingCurveState.providerCurvePriceSol
        ?? existing.providerCurvePriceSol
        ?? null,
      providerCurveSnapshotAt: token.providerCurveSnapshotAt
        || bondingCurveState.providerCurveSnapshotAt
        || existing.providerCurveSnapshotAt
        || null,
      holderProxy: Math.max(
        Number(existing.holderProxy || 0),
        uniqueBuyerCount,
        Number(token.uniqueBuyerCount || 0)
      ),
      uniqueBuyerCount,
      uniqueBuyerCountCaptured,
      uniqueBuyerRatio,
      externalMentionCount: Number(externalVisibility.mentionCount || launchIntelSummary?.externalSightings?.mentionCount || existing.externalMentionCount || 0),
      externalChatCount: Number(externalVisibility.uniqueChatCount || launchIntelSummary?.externalSightings?.uniqueChatCount || existing.externalChatCount || 0),
      kolFirstWaveCount: Number(kolOverlap.firstWaveCount || existing.kolFirstWaveCount || 0),
      kolTrustedCount: Number(kolOverlap.trustedCount || existing.kolTrustedCount || 0),
      repeatedEarlyBuyerCount: Number(launchIntelSummary?.heuristics?.repeatedEarlyBuyerCount || existing.repeatedEarlyBuyerCount || 0),
      earlySniperCount: Math.max(Number(existing.earlySniperCount || 0), Number(walletContext.earlySniperCount || 0)),
      alphaScalperCount: Math.max(Number(existing.alphaScalperCount || 0), Number(walletContext.alphaScalperCount || 0)),
      convictionWhaleCount: Math.max(Number(existing.convictionWhaleCount || 0), Number(walletContext.convictionWhaleCount || 0)),
      riskWalletCount: Math.max(Number(existing.riskWalletCount || 0), Number(walletContext.riskWalletCount || 0)),
      lateChaserCount: Math.max(Number(existing.lateChaserCount || 0), Number(walletContext.lateChaserCount || 0)),
      sniperWalletCount: hasLaunchSniperWalletCount
        ? launchSniperWalletCount
        : Number(existing.sniperWalletCount || 0),
      sniperWalletCountCaptured,
      bundlerCandidate: Boolean(launchIntelSummary?.heuristics?.bundlerCandidate || existing.bundlerCandidate)
    };

    const changedEnough = (
      next.curveProgress !== existing.curveProgress ||
      next.tradeCount !== existing.tradeCount ||
      next.recentTradeCount !== existing.recentTradeCount ||
      next.uniqueBuyerCount !== existing.uniqueBuyerCount ||
      next.externalMentionCount !== existing.externalMentionCount ||
      next.kolFirstWaveCount !== existing.kolFirstWaveCount ||
      next.convictionWhaleCount !== existing.convictionWhaleCount ||
      next.riskWalletCount !== existing.riskWalletCount ||
      next.earlySniperCount !== existing.earlySniperCount ||
      next.migratedAt !== existing.migratedAt
    );

    if (changedEnough) {
      next.lastSignificantAt = nowIso;
    }

    return next;
  }

  extractCurveProgress(token = {}) {
    const raw = token.bondingCurveProgress
      ?? token.curveProgress
      ?? token.bondingCurveState?.curveProgress
      ?? token.progress
      ?? token.bondingProgress
      ?? token.rawEvent?.bondingCurveProgress
      ?? token.rawEvent?.progress
      ?? token.rawTrade?.bondingCurveProgress
      ?? token.rawTrade?.progress;

    if (raw === undefined || raw === null || raw === '') {
      return null;
    }

    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric > 1 ? Math.max(0, Math.min(numeric / 100, 1)) : Math.max(0, Math.min(numeric, 1));
  }

  computeUniqueBuyerRatio(uniqueBuyerCount, recentBuys, buys, fallback = null) {
    const uniqueBuyers = Number(uniqueBuyerCount);
    const recentBuyCount = Number(recentBuys);
    const buyCount = Number(buys);
    const denominator = Number.isFinite(recentBuyCount) && recentBuyCount > 0
      ? recentBuyCount
      : buyCount;

    if (!Number.isFinite(uniqueBuyers) || uniqueBuyers < 0 || !Number.isFinite(denominator) || denominator <= 0) {
      return fallback ?? null;
    }

    return Math.min(uniqueBuyers / denominator, 1);
  }

  computeScore(state) {
    const buyTotal = Number(state.recentBuys || 0) + Number(state.recentSells || 0);
    const buyRatio = buyTotal > 0 ? Number(state.recentBuys || 0) / buyTotal : 0.5;
    const curveScore = state.curveProgress === null
      ? this.stageProgressProxy(state) * 25
      : Number(state.curveProgress || 0) * 40;
    const activityScore = Math.min(Number(state.tradeVelocityPerMin || 0) * 3, 18)
      + Math.min(Number(state.recentVolumeSol || 0) * 3, 12);
    const holderScore = Math.min(Number(state.holderProxy || 0) / 2, 12);
    const socialScore = Math.min(Number(state.externalMentionCount || 0) * 2, 10)
      + Math.min(Number(state.externalChatCount || 0) * 3, 6);
    const walletScore = Math.min(Number(state.kolFirstWaveCount || 0) * 7, 14)
      + Math.min(Number(state.kolTrustedCount || 0) * 8, 12)
      + Math.min(Number(state.repeatedEarlyBuyerCount || 0) * 2, 6)
      + Math.min(Number(state.convictionWhaleCount || 0) * 5, 10)
      + Math.min(Number(state.alphaScalperCount || 0) * 3, 6)
      + Math.min(Number(state.earlySniperCount || 0) * 2, 4);
    const flowScore = buyRatio >= 0.58 ? 8 : (buyRatio >= 0.5 ? 4 : 0);
    const riskPenalty = Math.min(Number(state.sniperWalletCount || 0), 10)
      + Math.min(Number(state.riskWalletCount || 0) * 2, 10)
      + Math.min(Number(state.lateChaserCount || 0), 4)
      + (state.bundlerCandidate ? 8 : 0)
      + (state.migratedAt ? 20 : 0);

    return Number(Math.max(0, Math.min(100, curveScore + activityScore + holderScore + socialScore + walletScore + flowScore - riskPenalty)).toFixed(2));
  }

  stageProgressProxy(state) {
    if (state.bondingStage === 'almost_bonded') {
      return 0.85;
    }

    if (state.bondingStage === 'recently_bonded' || state.migratedAt) {
      return 1;
    }

    if (Number(state.marketCapSol || 0) > 0 || Number(state.liquiditySol || 0) > 0) {
      return 0.45;
    }

    return 0.2;
  }

  buildReasons(state, score) {
    const reasons = [];
    if (state.curveProgress !== null && state.curveProgress >= this.minCurveProgress) {
      reasons.push(`curve_${Math.round(state.curveProgress * 100)}pct`);
    } else if (state.bondingStage === 'almost_bonded') {
      reasons.push('almost_bonded');
    }

    if (Number(state.tradeVelocityPerMin || 0) >= 4) {
      reasons.push('fast_trade_velocity');
    } else if (Number(state.tradeVelocityPerMin || 0) >= this.interestMinTradeVelocityPerMin) {
      reasons.push('moderate_trade_velocity');
    }

    if (Number(state.recentVolumeSol || 0) >= 1) {
      reasons.push('recent_volume');
    } else if (Number(state.recentVolumeSol || 0) >= this.interestMinRecentVolumeSol) {
      reasons.push('moderate_recent_volume');
    }

    if (Number(state.externalMentionCount || 0) > 0) {
      reasons.push('telegram_sighted');
    }

    if (Number(state.kolFirstWaveCount || 0) > 0 || Number(state.kolTrustedCount || 0) > 0) {
      reasons.push('kol_overlap');
    }

    if (Number(state.repeatedEarlyBuyerCount || 0) > 0) {
      reasons.push('repeat_early_buyers');
    }

    if (Number(state.convictionWhaleCount || 0) > 0) {
      reasons.push('conviction_wallets');
    }

    if (Number(state.alphaScalperCount || 0) > 0) {
      reasons.push('alpha_scalper_touch');
    }

    if (Number(state.earlySniperCount || 0) > 0) {
      reasons.push('early_sniper_touch');
    }

    if (Number(state.riskWalletCount || 0) > 0) {
      reasons.push('risk_wallet_touch');
    }

    if (Number(state.lateChaserCount || 0) > 0) {
      reasons.push('late_chaser_touch');
    }

    if (Number(state.uniqueBuyerCount || 0) >= this.interestMinUniqueBuyerCount) {
      reasons.push('buyer_spread_building');
    }

    if (state.bundlerCandidate) {
      reasons.push('bundler_caution');
    }

    if (score >= this.minScoreToFlag) {
      reasons.push('score_threshold');
    }

    if (state.confirmed) {
      reasons.push(state.confirmationReason || 'confirmed_watch');
    } else if (Number(state.interestSignalCount || 0) > 0) {
      reasons.push(`watch_interest_${state.interestSignalCount}x`);
    } else if (Number(state.observedSignalCount || 0) > 0) {
      reasons.push(`observed_${state.observedSignalCount}x`);
    }

    if (this.requireSecondarySignal && score >= this.confirmMinScore && !this.hasSecondaryConfirmationSignal(state)) {
      reasons.push('needs_secondary_signal');
    }

    return reasons.slice(0, 10);
  }

  hasSecondaryConfirmationSignal(state) {
    const hasCurveSignal = state.curveProgress === null
      ? state.bondingStage === 'almost_bonded'
      : state.curveProgress >= this.minCurveProgress;
    const hasExternalSignal = Number(state.externalMentionCount || 0) > 0
      || Number(state.externalChatCount || 0) > 0;
    const hasKolSignal = Number(state.kolFirstWaveCount || 0) > 0
      || Number(state.kolTrustedCount || 0) > 0;
    const hasHolderDepth = Number(state.holderProxy || 0) >= 25;

    return Boolean(hasCurveSignal || hasExternalSignal || hasKolSignal || hasHolderDepth);
  }

  passesSignalGate(state, score) {
    if (state.migratedAt) {
      return false;
    }

    if (score < this.confirmMinScore) {
      return false;
    }

    const hasCurveSignal = state.curveProgress === null
      ? state.bondingStage === 'almost_bonded'
      : state.curveProgress >= this.minCurveProgress;
    const hasActivitySignal = Number(state.tradeVelocityPerMin || 0) >= 4 || Number(state.recentVolumeSol || 0) >= 1;
    const hasSocialSignal = Number(state.externalMentionCount || 0) > 0 || Number(state.kolFirstWaveCount || 0) > 0;

    if (!hasCurveSignal && !hasActivitySignal && !hasSocialSignal) {
      return false;
    }

    return true;
  }

  passesInterestGate(state, score) {
    if (state.migratedAt) {
      return false;
    }

    if (score < this.minScoreToFlag) {
      return false;
    }

    const hasCurveInterest = state.curveProgress === null
      ? state.bondingStage === 'almost_bonded'
      : state.curveProgress >= this.interestMinCurveProgress;
    const hasActivityInterest = Number(state.tradeVelocityPerMin || 0) >= this.interestMinTradeVelocityPerMin
      || Number(state.recentVolumeSol || 0) >= this.interestMinRecentVolumeSol;
    const hasSocialInterest = Number(state.externalMentionCount || 0) > 0
      || Number(state.externalChatCount || 0) > 0
      || Number(state.kolFirstWaveCount || 0) > 0
      || Number(state.kolTrustedCount || 0) > 0;
    const hasBuyerInterest = Number(state.repeatedEarlyBuyerCount || 0) > 0
      || Number(state.uniqueBuyerCount || 0) >= this.interestMinUniqueBuyerCount;
    const hasWalletInterest = Number(state.convictionWhaleCount || 0) > 0
      || Number(state.alphaScalperCount || 0) > 0
      || Number(state.earlySniperCount || 0) > 0
      || Number(state.riskWalletCount || 0) > 0
      || Number(state.lateChaserCount || 0) > 0;

    return Boolean(
      hasCurveInterest ||
      hasActivityInterest ||
      hasSocialInterest ||
      hasBuyerInterest ||
      hasWalletInterest
    );
  }

  updateSignalState(state, score, now, nowIso) {
    const observedInterest = this.passesInterestGate(state, score);
    const observedSignal = this.passesSignalGate(state, score);
    if (!observedInterest && !observedSignal) {
      return {
        observedInterest: false,
        observedSignal: false,
        newlyConfirmed: false,
        shouldFlag: false,
        flagType: null
      };
    }

    const lastInterestMs = state.lastInterestAt ? new Date(state.lastInterestAt).getTime() : 0;
    const interestGapElapsed = !lastInterestMs || now - lastInterestMs >= this.confirmMinGapMs;

    if (observedInterest && interestGapElapsed) {
      state.lastInterestAt = nowIso;
      state.interestSignalCount = Number(state.interestSignalCount || 0) + 1;
    }

    if (!observedSignal) {
      const shouldFlag = !state.lastFlaggedAt
        || now - new Date(state.lastFlaggedAt).getTime() >= this.flagCooldownMs;
      return {
        observedInterest: true,
        observedSignal: false,
        newlyConfirmed: false,
        shouldFlag,
        flagType: shouldFlag ? 'interest' : null
      };
    }

    const lastSignalMs = state.lastSignalAt ? new Date(state.lastSignalAt).getTime() : 0;
    const signalGapElapsed = !lastSignalMs || now - lastSignalMs >= this.confirmMinGapMs;

    if (!state.firstSignalAt) {
      state.firstSignalAt = nowIso;
    }

    if (signalGapElapsed) {
      state.lastSignalAt = nowIso;
      state.observedSignalCount = Number(state.observedSignalCount || 0) + 1;
    }

    const firstSignalMs = state.firstSignalAt ? new Date(state.firstSignalAt).getTime() : now;
    const hasPersistentSignal = Number(state.observedSignalCount || 0) >= this.confirmMinObservations
      && now - firstSignalMs >= this.confirmMinGapMs;
    const hasFastTrackSignal = score >= this.fastTrackScore;
    const hasSecondarySignal = this.hasSecondaryConfirmationSignal(state);
    const canConfirmWithoutSecondary = !this.requireSecondarySignal || score >= this.strongNoSecondaryScore;
    const canConfirm = hasSecondarySignal || canConfirmWithoutSecondary;
    let newlyConfirmed = false;

    if (!state.confirmed && canConfirm && (hasFastTrackSignal || hasPersistentSignal)) {
      state.confirmed = true;
      state.confirmedAt = nowIso;
      state.confirmCount = Number(state.confirmCount || 0) + 1;
      state.confirmationReason = hasFastTrackSignal
        ? (hasSecondarySignal ? 'fast_track_score' : 'strong_fast_track_score')
        : 'persistent_signal';
      newlyConfirmed = true;
    }

    if (!state.confirmed) {
      return {
        observedInterest: true,
        observedSignal: true,
        newlyConfirmed: false,
        shouldFlag: false,
        flagType: null
      };
    }

    if (!state.lastFlaggedAt) {
      return {
        observedInterest: true,
        observedSignal: true,
        newlyConfirmed,
        shouldFlag: true,
        flagType: 'confirmed'
      };
    }

    return {
      observedInterest: true,
      observedSignal: true,
      newlyConfirmed,
      shouldFlag: now - new Date(state.lastFlaggedAt).getTime() >= this.flagCooldownMs,
      flagType: 'confirmed'
    };
  }

  toSummary(state) {
    return {
      mint: state.mint,
      symbol: state.symbol,
      name: state.name,
      source: state.source,
      firstSeenAt: state.firstSeenAt,
      lastSeenAt: state.lastSeenAt,
      firstTradeAt: state.firstTradeAt,
      migratedAt: state.migratedAt,
      score: state.score,
      reasons: state.reasons,
      flagged: state.flagged,
      flagCount: state.flagCount,
      observedSignalCount: Number(state.observedSignalCount || 0),
      interestSignalCount: Number(state.interestSignalCount || 0),
      firstSignalAt: state.firstSignalAt,
      lastSignalAt: state.lastSignalAt,
      lastInterestAt: state.lastInterestAt,
      confirmed: Boolean(state.confirmed),
      confirmedAt: state.confirmedAt,
      confirmationReason: state.confirmationReason,
      confirmCount: Number(state.confirmCount || 0),
      lastFlaggedAt: state.lastFlaggedAt,
      lastFlagType: state.lastFlagType,
      curveProgress: state.curveProgress,
      curveProgressSource: state.curveProgressSource || null,
      bondingCurveAccountFound: Boolean(state.bondingCurveAccountFound),
      providerCurveProgress: state.providerCurveProgress ?? null,
      providerCurvePriceSol: state.providerCurvePriceSol ?? null,
      providerCurveSnapshotAt: state.providerCurveSnapshotAt || null,
      bondingStage: state.bondingStage,
      tradeCount: state.tradeCount,
      recentTradeCount: state.recentTradeCount,
      recentBuys: state.recentBuys,
      recentSells: state.recentSells,
      buyRatio: Number(state.recentBuys || 0) + Number(state.recentSells || 0) > 0
        ? Number(state.recentBuys || 0) / (Number(state.recentBuys || 0) + Number(state.recentSells || 0))
        : null,
      buyRatioCaptured: Boolean(state.buyRatioCaptured),
      recentVolumeSol: Number(state.recentVolumeSol || 0),
      tradeVelocityPerMin: Number(state.tradeVelocityPerMin || 0),
      holderProxy: Number(state.holderProxy || 0),
      uniqueBuyerCount: Number(state.uniqueBuyerCount || 0),
      uniqueBuyerCountCaptured: Boolean(state.uniqueBuyerCountCaptured),
      uniqueBuyerRatio: state.uniqueBuyerRatio !== null && state.uniqueBuyerRatio !== undefined
        ? Number(state.uniqueBuyerRatio)
        : null,
      bondingCurveAddress: state.bondingCurveAddress,
      quoteMint: state.quoteMint || null,
      pairBase: state.pairBase || null,
      bondingCurveComplete: Boolean(state.bondingCurveComplete),
      virtualSolReservesSol: state.virtualSolReservesSol,
      realSolReservesSol: state.realSolReservesSol,
      virtualTokenReservesTokens: state.virtualTokenReservesTokens,
      bondingCurvePriceSol: state.bondingCurvePriceSol,
      lastCurveUpdateAt: state.lastCurveUpdateAt || null,
      externalMentionCount: Number(state.externalMentionCount || 0),
      externalChatCount: Number(state.externalChatCount || 0),
      kolFirstWaveCount: Number(state.kolFirstWaveCount || 0),
      kolTrustedCount: Number(state.kolTrustedCount || 0),
      repeatedEarlyBuyerCount: Number(state.repeatedEarlyBuyerCount || 0),
      earlySniperCount: Number(state.earlySniperCount || 0),
      alphaScalperCount: Number(state.alphaScalperCount || 0),
      convictionWhaleCount: Number(state.convictionWhaleCount || 0),
      riskWalletCount: Number(state.riskWalletCount || 0),
      lateChaserCount: Number(state.lateChaserCount || 0),
      sniperWalletCount: Number(state.sniperWalletCount || 0),
      sniperWalletCountCaptured: Boolean(state.sniperWalletCountCaptured),
      bundlerCandidate: Boolean(state.bundlerCandidate)
    };
  }

  getTopFlags(limit = 8) {
    return Array.from(this.states.values())
      .filter((state) => state.flagged)
      .sort((a, b) => {
        const timeDelta = new Date(b.lastFlaggedAt || b.lastSeenAt || 0).getTime()
          - new Date(a.lastFlaggedAt || a.lastSeenAt || 0).getTime();
        return timeDelta || Number(b.score || 0) - Number(a.score || 0);
      })
      .slice(0, limit)
      .map((state) => this.toSummary(state));
  }

  getMintSummary(mint) {
    if (!mint) {
      return null;
    }

    const state = this.states.get(mint);
    return state ? this.toSummary(state) : null;
  }

  compactIfNeeded() {
    if (!Number.isFinite(this.maxTrackedMints) || this.maxTrackedMints <= 0) {
      return;
    }

    if (this.states.size <= this.maxTrackedMints) {
      return;
    }

    const ordered = [...this.states.entries()]
      .sort((a, b) => new Date(b[1].lastSeenAt || 0).getTime() - new Date(a[1].lastSeenAt || 0).getTime())
      .slice(0, this.maxTrackedMints);
    this.states = new Map(ordered);
  }

  getStats() {
    return {
      ...this.stats,
      trackedMints: this.states.size,
      recentFlags: this.getTopFlags(5)
    };
  }
}

module.exports = PreMigrationWatchLane;
