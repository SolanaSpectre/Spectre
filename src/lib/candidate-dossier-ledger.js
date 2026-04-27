const fs = require('fs');
const path = require('path');

class CandidateDossierLedger {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.candidateDossierEnabled !== false;
    this.includeObserved = config.candidateDossierIncludeObserved === true;
    this.maxRecent = Number(config.candidateDossierMaxRecent || 25);
    this.filePath = null;
    this.recent = [];
    this.stats = {
      enabled: this.enabled,
      totalDossiers: 0,
      watchDossiers: 0,
      paperDossiers: 0,
      continuationDossiers: 0,
      eventCounts: {},
      decisionCounts: {},
      reasonCounts: {}
    };

    if (this.enabled) {
      const logDir = config.strategyLedgerDir || config.telemetryLogDir;
      fs.mkdirSync(logDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      this.filePath = path.join(logDir, `candidate-dossiers-${stamp}.jsonl`);
    }
  }

  recordWatchState(state = {}, meta = {}) {
    if (!this.enabled || !state?.mint) {
      return null;
    }

    const eventType = meta.eventType || (meta.flagged ? 'watch.flagged' : 'watch.observed');
    if (eventType === 'watch.observed' && !this.includeObserved) {
      return null;
    }

    return this.record(this.buildDossier({
      source: 'pre_migration_watch',
      eventType,
      state,
      watch: {
        flagged: Boolean(meta.flagged ?? state.flagged),
        observedSignal: Boolean(meta.observedSignal),
        confirmed: Boolean(meta.confirmed ?? state.confirmed),
        newlyConfirmed: Boolean(meta.newlyConfirmed),
        confirmationReason: meta.confirmationReason || state.confirmationReason || null
      }
    }));
  }

  recordPaperEvent(event = {}, state = {}) {
    if (!this.enabled || !event?.payload?.mint) {
      return null;
    }

    const payload = event.payload || {};
    const mergedState = {
      ...state,
      mint: payload.mint,
      symbol: payload.symbol ?? state.symbol,
      score: payload.score ?? state.score,
      curveProgress: payload.curveProgress ?? state.curveProgress,
      recentVolumeSol: payload.recentVolumeSol ?? state.recentVolumeSol,
      tradeVelocityPerMin: payload.tradeVelocityPerMin ?? state.tradeVelocityPerMin,
      bondingCurvePriceSol: payload.priceSol ?? payload.entryPriceSol ?? payload.exitPriceSol ?? state.bondingCurvePriceSol,
      reasons: Array.isArray(payload.reasons) ? payload.reasons : state.reasons
    };

    return this.record(this.buildDossier({
      source: 'pre_migration_paper',
      eventType: event.telemetryType || `pre_migration_paper.${event.type || 'event'}`,
      state: mergedState,
      paper: this.buildPaperSummary(event)
    }));
  }

  recordContinuationState(state = {}, meta = {}) {
    if (!this.enabled || !state?.mint) {
      return null;
    }

    return this.record(this.buildDossier({
      source: 'post_migration_continuation',
      eventType: meta.eventType || state.lastEventType || 'continuation.observed',
      state,
      continuation: this.buildContinuationSummary(state, meta)
    }));
  }

  buildPaperSummary(event = {}) {
    const payload = event.payload || {};
    return this.pruneNullish({
      eventType: event.type || null,
      decision: payload.decision || null,
      preset: payload.preset || null,
      lane: payload.lane || null,
      profileName: payload.profileName || null,
      reason: payload.reason || null,
      threshold: payload.threshold ?? null,
      value: payload.value ?? null,
      guardOverride: payload.guardOverride || null,
      baselineCurveProgress: payload.baselineCurveProgress ?? null,
      curveProgressDelta: payload.curveProgressDelta ?? null,
      baselineAt: payload.baselineAt || null,
      lateFastTrack: payload.guardOverride === 'LATE_NEAR_COMPLETION_FAST_TRACK'
        ? this.pruneNullish({
          score: payload.lateFastTrackScore ?? null,
          curveProgress: payload.lateFastTrackCurveProgress ?? null,
          recentVolumeSol: payload.lateFastTrackRecentVolumeSol ?? null,
          tradeVelocityPerMin: payload.lateFastTrackTradeVelocityPerMin ?? null,
          thresholds: payload.lateFastTrackThresholds || null
        })
        : null,
      earlyAcceleration: payload.guardOverride === 'EARLY_ACCELERATION_FAST_TRACK'
        ? this.pruneNullish({
          score: payload.earlyAccelerationScore ?? null,
          curveProgress: payload.earlyAccelerationCurveProgress ?? null,
          recentVolumeSol: payload.earlyAccelerationRecentVolumeSol ?? null,
          tradeVelocityPerMin: payload.earlyAccelerationTradeVelocityPerMin ?? null,
          buyRatio: payload.earlyAccelerationBuyRatio ?? null,
          repeatedEarlyBuyerCount: payload.earlyAccelerationRepeatedEarlyBuyerCount ?? null,
          holderProxy: payload.earlyAccelerationHolderProxy ?? null,
          thresholds: payload.earlyAccelerationThresholds || null
        })
        : null,
      strategy: payload.strategy || null,
      exitProfile: payload.exitProfile || null,
      walletClassificationContext: payload.walletClassificationContext || null,
      amountSol: payload.amountSol ?? null,
      entryPriceSol: payload.entryPriceSol ?? null,
      exitPriceSol: payload.exitPriceSol ?? null,
      returnPct: payload.returnPct ?? null,
      pnlSol: payload.pnlSol ?? null,
      holdSeconds: payload.holdSeconds ?? null,
      maxCurveProgress: payload.maxCurveProgress ?? null,
      normalizedSymbol: payload.normalizedSymbol || null,
      recentEntries: payload.recentEntries ?? null
    });
  }

  buildContinuationSummary(state = {}, meta = {}) {
    return this.pruneNullish({
      eventType: meta.eventType || state.lastEventType || null,
      score: this.numberOrNull(state.score, 2),
      rejectReason: state.rejectReason || null,
      reasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 12) : [],
      confirmed: Boolean(state.confirmed),
      watchCount: this.numberOrNull(state.watchCount, 0),
      confirmedCount: this.numberOrNull(state.confirmedCount, 0),
      dexscreenerUrl: state.dexscreenerUrl || null,
      websiteUrl: state.websiteUrl || null,
      twitterUrl: state.twitterUrl || null,
      telegramUrl: state.telegramUrl || null
    });
  }

  buildDossier({ source, eventType, state = {}, watch = null, paper = null, continuation = null }) {
    const buySell = this.buySellSummary(state);
    const score = this.numberOrNull(state.score, 2);
    const curveProgress = this.numberOrNull(state.curveProgress, 6);
    const risk = this.riskSummary(state, paper);
    const tags = this.buildTags(state, watch, paper, risk, continuation);

    return this.pruneNullish({
      schemaVersion: 1,
      source,
      eventType,
      timestamp: new Date().toISOString(),
      identity: this.pruneNullish({
        mint: state.mint,
        symbol: state.symbol || null,
        name: state.name || null,
        source: state.source || null,
        pumpFunUrl: state.mint ? `https://pump.fun/coin/${state.mint}` : null,
        dexscreenerUrl: state.dexscreenerUrl || continuation?.dexscreenerUrl || null
      }),
      timing: this.pruneNullish({
        firstSeenAt: state.firstSeenAt || null,
        lastSeenAt: state.lastSeenAt || null,
        firstTradeAt: state.firstTradeAt || null,
        migratedAt: state.migratedAt || null,
        lastFlaggedAt: state.lastFlaggedAt || null,
        ageSecondsAtEvent: this.ageSeconds(state.firstSeenAt)
      }),
      gmgnStyle: this.pruneNullish({
        score,
        verdict: this.verdict(source, eventType, score, watch, paper, risk, continuation),
        reasons: Array.isArray(state.reasons) ? state.reasons.slice(0, 12) : [],
        tags
      }),
      curve: this.pruneNullish({
        progress: curveProgress,
        progressPct: curveProgress === null ? null : this.compact(curveProgress * 100, 2),
        stage: state.bondingStage || null,
        complete: state.bondingCurveComplete ?? null,
        bondingCurveAddress: state.bondingCurveAddress || null,
        priceSol: this.numberOrNull(
          state.bondingCurvePriceSol ?? state.priceSol ?? state.curvePriceSol,
          15
        ),
        virtualSolReservesSol: this.numberOrNull(state.virtualSolReservesSol, 6),
        realSolReservesSol: this.numberOrNull(state.realSolReservesSol, 6),
        virtualTokenReservesTokens: this.numberOrNull(state.virtualTokenReservesTokens, 2)
      }),
      activity: this.pruneNullish({
        tradeCount: this.numberOrNull(state.tradeCount, 0),
        recentTradeCount: this.numberOrNull(state.recentTradeCount, 0),
        recentBuys: this.numberOrNull(state.recentBuys, 0),
        recentSells: this.numberOrNull(state.recentSells, 0),
        buyRatio: buySell.buyRatio,
        sellRatio: buySell.sellRatio,
        recentVolumeSol: this.numberOrNull(state.recentVolumeSol, 4),
        tradeVelocityPerMin: this.numberOrNull(state.tradeVelocityPerMin, 2)
      }),
      walletQuality: this.pruneNullish({
        holderProxy: this.numberOrNull(state.holderProxy, 0),
        holderCount: this.numberOrNull(state.holderCount, 0),
        topHolderPercent: this.numberOrNull(state.topHolderPercent, 4),
        smartMoneyProxy: this.numberOrNull(state.kolTrustedCount, 0),
        renownedProxy: this.numberOrNull(state.kolFirstWaveCount, 0),
        repeatedEarlyBuyerCount: this.numberOrNull(state.repeatedEarlyBuyerCount, 0),
        externalMentionCount: this.numberOrNull(state.externalMentionCount, 0),
        externalChatCount: this.numberOrNull(state.externalChatCount, 0),
        rickMentionCount: this.numberOrNull(state.rickMentionCount, 0)
      }),
      market: this.pruneNullish({
        liquidityUsd: this.numberOrNull(state.liquidityUsd, 2),
        liquidityGrowthPct: this.numberOrNull(state.liquidityGrowthPct, 2),
        volumeM5Usd: this.numberOrNull(state.volumeM5Usd, 2),
        volume1hUsd: this.numberOrNull(state.volume1hUsd, 2),
        volume6hUsd: this.numberOrNull(state.volume6hUsd, 2),
        volume24hUsd: this.numberOrNull(state.volume24hUsd, 2),
        volumeToLiquidity24h: this.numberOrNull(state.volumeToLiquidity24h, 4),
        volumeExpansion1hVs6h: this.numberOrNull(state.volumeExpansion1hVs6h, 4),
        volumeExpansion6hVs24h: this.numberOrNull(state.volumeExpansion6hVs24h, 4),
        priceUsd: this.numberOrNull(state.priceUsd, 12),
        priceNative: this.numberOrNull(state.priceNative, 15),
        priceChangeM5Pct: this.numberOrNull(state.priceChangeM5Pct, 2),
        priceChange1hPct: this.numberOrNull(state.priceChange1hPct, 2),
        priceChange6hPct: this.numberOrNull(state.priceChange6hPct, 2),
        priceChange24hPct: this.numberOrNull(state.priceChange24hPct, 2),
        buys24h: this.numberOrNull(state.buys24h, 0),
        sells24h: this.numberOrNull(state.sells24h, 0),
        buyTxnRatio24h: this.numberOrNull(state.buyTxnRatio24h, 4),
        sellTxnRatio24h: this.numberOrNull(state.sellTxnRatio24h, 4),
        pairCount: this.numberOrNull(state.pairCount, 0),
        dexCount: this.numberOrNull(state.dexCount, 0),
        dexes: Array.isArray(state.dexes) ? state.dexes : null,
        primaryDexId: state.primaryDexId || null,
        ageHours: this.numberOrNull(state.ageHours, 2),
        hasWebsite: state.hasWebsite ?? null,
        hasTwitter: state.hasTwitter ?? null,
        hasTelegram: state.hasTelegram ?? null,
        socialLinkCount: this.numberOrNull(state.socialLinkCount, 0)
      }),
      risk,
      watch: watch ? this.pruneNullish({
        ...watch,
        observedSignalCount: this.numberOrNull(state.observedSignalCount, 0),
        confirmedAt: state.confirmedAt || null,
        confirmCount: this.numberOrNull(state.confirmCount, 0)
      }) : null,
      paper,
      continuation
    });
  }

  buildTags(state, watch, paper, risk, continuation) {
    const tags = new Set();

    if (watch?.flagged) tags.add('watch_flagged');
    if (watch?.confirmed) tags.add('watch_confirmed');
    if (paper?.decision) tags.add(String(paper.decision).toLowerCase());
    if (paper?.reason) tags.add(String(paper.reason).toLowerCase());
    if (paper?.guardOverride) tags.add(String(paper.guardOverride).toLowerCase());
    if (paper?.lane) tags.add(String(paper.lane).toLowerCase());
    if (paper?.profileName) tags.add(String(paper.profileName).toLowerCase());
    if (continuation?.eventType) tags.add(String(continuation.eventType).replace(/^continuation\./, 'continuation_'));
    if (continuation?.rejectReason) tags.add(String(continuation.rejectReason).toLowerCase());

    const curveProgress = Number(state.curveProgress);
    if (Number.isFinite(curveProgress)) {
      if (curveProgress >= 0.95) tags.add('curve_95_plus');
      else if (curveProgress >= 0.85) tags.add('near_completion');
      else if (curveProgress >= 0.5) tags.add('mid_curve');
    }

    if (Number(state.tradeVelocityPerMin || 0) >= 25) tags.add('fast_velocity');
    if (Number(state.recentVolumeSol || 0) >= 25) tags.add('high_recent_volume');
    if (Number(state.externalMentionCount || 0) > 0) tags.add('social_sighted');
    if (Number(state.kolFirstWaveCount || 0) > 0 || Number(state.kolTrustedCount || 0) > 0) tags.add('kol_overlap');
    if (Number(state.repeatedEarlyBuyerCount || 0) > 0) tags.add('repeat_buyers');
    if (risk?.bundlerCandidate) tags.add('bundler_caution');
    if (Number(risk?.sniperWalletCount || 0) > 0) tags.add('sniper_presence');
    if (Number(state.liquidityUsd || 0) >= 25000) tags.add('liquidity_depth');
    if (Number(state.volumeToLiquidity24h || 0) >= 2) tags.add('volume_to_liquidity');
    if (
      Number(state.priceChange6hPct || 0) >= 150 &&
      Number(state.priceChange24hPct || 0) >= 300 &&
      Number(state.priceChange1hPct || 0) > 0 &&
      Number(state.volumeToLiquidity24h || 0) >= 6 &&
      Number(state.volume1hUsd || 0) >= 20000
    ) tags.add('vertical_extension');
    if (
      Number(state.priceChangeM5Pct || 0) > 0 &&
      Number(state.priceChange1hPct || 0) >= 10 &&
      Number(state.priceChange6hPct || 0) >= 20 &&
      Number(state.priceChange24hPct || 0) >= 20 &&
      Number(state.volumeToLiquidity24h || 0) >= 8 &&
      Number(state.buyTxnRatio24h || 0) >= 0.55 &&
      !tags.has('vertical_extension')
    ) tags.add('reclaim_continuation');
    if (
      Number(state.priceChange6hPct || 0) >= 150 &&
      Number(state.priceChange24hPct || 0) >= 500 &&
      Number(state.priceChange1hPct || 0) > 0
    ) tags.add('late_chase_caution');
    if (Number(state.pairCount || 0) >= 2) tags.add('multi_pool');
    if (Number(state.dexCount || 0) >= 2) tags.add('multi_dex');
    if (
      Number(state.liquidityUsd || 0) >= 150000 &&
      Number(state.marketCap || state.fdv || 0) >= 1000000 &&
      Number(state.volumeToLiquidity24h || 0) >= 0.5 &&
      Number(state.pairCount || 0) >= 3 &&
      Number(state.dexCount || 0) >= 2
    ) tags.add('mature_liquidity_base');
    if (Number(state.ageHours || 0) > 168) tags.add('legacy_revived');
    if (Number(state.ageHours || 0) > 168 && Number(state.priceChange24hPct || 0) > 25) tags.add('old_coin_revival');
    if (Number(state.ageHours || 0) > 168 && tags.has('reclaim_continuation')) tags.add('legacy_reclaim');
    if (Number(state.ageHours || 0) > 168 && Number(state.priceChange24hPct || 0) <= 25) tags.add('old_coin_caution');
    if (Number.isFinite(Number(state.ageHours)) && Number(state.ageHours) < 0.25) tags.add('too_new_caution');
    if (state.hasWebsite) tags.add('website_present');
    if (state.hasTwitter) tags.add('twitter_present');
    if (state.hasTelegram) tags.add('telegram_present');

    return Array.from(tags).slice(0, 16);
  }

  riskSummary(state, paper) {
    return this.pruneNullish({
      bundlerCandidate: Boolean(state.bundlerCandidate),
      sniperWalletCount: this.numberOrNull(state.sniperWalletCount, 0),
      cloneSymbolGuard: paper?.reason === 'CLONE_SYMBOL_GUARD' || null,
      missingPrice: paper?.reason === 'MISSING_PRICE' || null,
      staleOrFlatCurve: paper?.reason === 'CURVE_NOT_ADVANCING' || null,
      lowCurveProgress: paper?.reason === 'LOW_CURVE_PROGRESS' || null,
      lowRecentVolume: paper?.reason === 'LOW_RECENT_VOLUME' || null,
      lowTradeVelocity: paper?.reason === 'LOW_TRADE_VELOCITY' || null
    });
  }

  buySellSummary(state) {
    const buys = Number(state.recentBuys || 0);
    const sells = Number(state.recentSells || 0);
    const total = buys + sells;
    if (total <= 0) {
      return { buyRatio: null, sellRatio: null };
    }

    const buyRatio = buys / total;
    return {
      buyRatio: this.compact(buyRatio, 4),
      sellRatio: this.compact(1 - buyRatio, 4)
    };
  }

  verdict(source, eventType, score, watch, paper, risk, continuation) {
    if (paper?.decision === 'PAPER_ENTERED') return 'paper_entered';
    if (paper?.decision === 'PAPER_EXITED') return 'paper_exited';
    if (paper?.decision === 'PAPER_ELIGIBLE') return 'paper_eligible';
    if (paper?.decision === 'PAPER_SKIPPED') return `paper_skipped:${paper.reason || 'unknown'}`;
    if (risk?.cloneSymbolGuard) return 'skip_clone_guard';
    if (watch?.flagged && score >= 80) return 'high_conviction_watch';
    if (watch?.flagged) return 'watch';
    if (source === 'post_migration_continuation' && eventType === 'continuation.confirmed') return 'continuation_confirmed';
    if (source === 'post_migration_continuation' && eventType === 'continuation.watch') return 'continuation_watch';
    if (source === 'post_migration_continuation' && eventType === 'continuation.rejected') return `continuation_rejected:${continuation?.rejectReason || 'unknown'}`;
    if (source === 'pre_migration_watch' && eventType === 'watch.observed') return 'observed';
    return 'unknown';
  }

  record(dossier) {
    this.stats.totalDossiers += 1;
    if (dossier.source === 'pre_migration_watch') this.stats.watchDossiers += 1;
    if (dossier.source === 'pre_migration_paper') this.stats.paperDossiers += 1;
    if (dossier.source === 'post_migration_continuation') this.stats.continuationDossiers += 1;
    this.increment(this.stats.eventCounts, dossier.eventType);
    if (dossier.paper?.decision) this.increment(this.stats.decisionCounts, dossier.paper.decision);
    if (dossier.paper?.reason) this.increment(this.stats.reasonCounts, dossier.paper.reason);

    this.recent.push(this.summarizeForStats(dossier));
    if (this.recent.length > this.maxRecent) {
      this.recent = this.recent.slice(-this.maxRecent);
    }

    if (this.filePath) {
      try {
        fs.appendFileSync(this.filePath, `${JSON.stringify(dossier)}\n`);
      } catch (error) {
        this.logger.warn('Failed to write candidate dossier', error.message);
      }
    }

    return dossier;
  }

  summarizeForStats(dossier) {
    return {
      timestamp: dossier.timestamp,
      eventType: dossier.eventType,
      mint: dossier.identity?.mint,
      symbol: dossier.identity?.symbol || null,
      score: dossier.gmgnStyle?.score ?? null,
      verdict: dossier.gmgnStyle?.verdict || null,
      reason: dossier.paper?.reason || dossier.continuation?.rejectReason || null,
      curveProgress: dossier.curve?.progress ?? null
    };
  }

  getStats() {
    return {
      ...this.stats,
      filePath: this.filePath,
      recent: this.recent.slice(-Math.min(this.maxRecent, 10))
    };
  }

  increment(bucket, key) {
    if (!key) return;
    bucket[key] = (bucket[key] || 0) + 1;
  }

  ageSeconds(isoTimestamp) {
    if (!isoTimestamp) return null;
    const start = new Date(isoTimestamp).getTime();
    if (!Number.isFinite(start)) return null;
    return this.compact((Date.now() - start) / 1000, 2);
  }

  numberOrNull(value, decimals = 4) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return this.compact(numeric, decimals);
  }

  compact(value, decimals = 6) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Number(numeric.toFixed(decimals));
  }

  pruneNullish(value) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== null && item !== undefined)
    );
  }
}

module.exports = CandidateDossierLedger;
