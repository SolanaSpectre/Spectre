class PostMigrationContinuationLane {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.postMigrationContinuationEnabled !== false;
    this.minScore = Number(config.postMigrationContinuationMinScore ?? 65);
    this.confirmMinScore = Number(config.postMigrationContinuationConfirmMinScore ?? 75);
    this.minLiquidityUsd = Number(config.postMigrationContinuationMinLiquidityUsd ?? 25000);
    this.minVolumeToLiquidity = Number(config.postMigrationContinuationMinVolumeToLiquidity ?? 2);
    this.minVolume1hUsd = Number(config.postMigrationContinuationMinVolume1hUsd ?? 10000);
    this.minAgeHours = Number(config.postMigrationContinuationMinAgeHours ?? 0.25);
    this.maxAgeHours = Number(config.postMigrationContinuationMaxAgeHours ?? 168);
    this.maxSellTxnRatio = Number(config.postMigrationContinuationMaxSellTxnRatio ?? 0.72);
    this.flagCooldownMs = Number(config.postMigrationContinuationFlagCooldownMs ?? 300000);
    this.maxTrackedMints = Number(config.postMigrationContinuationMaxTrackedMints ?? 2500);
    this.states = new Map();
    this.stats = {
      enabled: this.enabled,
      trackedMints: 0,
      updates: 0,
      observed: 0,
      watches: 0,
      confirmed: 0,
      rejected: 0,
      rejectionCounts: {},
      lastWatchAt: null,
      lastConfirmedAt: null
    };
  }

  observe(snapshot = {}) {
    const mint = snapshot.mint || snapshot.mintAddress || snapshot.token || snapshot.id;
    if (!this.enabled || !mint) {
      return { updated: false, eventType: null, state: null };
    }

    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const existing = this.states.get(mint) || this.createInitialState(mint, snapshot, nowIso);
    const next = this.mergeSnapshot(existing, snapshot, now, nowIso);
    next.score = this.computeScore(next);
    next.reasons = this.buildReasons(next);
    next.rejectReason = this.getRejectReason(next);

    const signal = this.computeSignal(next, now, nowIso);
    next.observationCount = Number(next.observationCount || 0) + 1;
    next.lastEventType = signal.eventType;

    if (signal.eventType === 'continuation.watch') {
      next.lastWatchAt = nowIso;
      next.watchCount = Number(next.watchCount || 0) + 1;
      this.stats.watches += 1;
      this.stats.lastWatchAt = nowIso;
    } else if (signal.eventType === 'continuation.confirmed') {
      next.lastConfirmedAt = nowIso;
      next.confirmed = true;
      next.confirmedCount = Number(next.confirmedCount || 0) + 1;
      this.stats.confirmed += 1;
      this.stats.lastConfirmedAt = nowIso;
    } else if (signal.eventType === 'continuation.rejected') {
      next.lastRejectedAt = nowIso;
      next.rejectCount = Number(next.rejectCount || 0) + 1;
      this.stats.rejected += 1;
      this.increment(this.stats.rejectionCounts, next.rejectReason || 'UNKNOWN');
    } else {
      this.stats.observed += 1;
    }

    this.states.set(mint, next);
    this.compactIfNeeded();
    this.stats.updates += 1;
    this.stats.trackedMints = this.states.size;

    return {
      updated: true,
      eventType: signal.eventType,
      shouldEmit: signal.shouldEmit,
      state: this.toSummary(next)
    };
  }

  createInitialState(mint, snapshot, nowIso) {
    return {
      mint,
      symbol: snapshot.symbol || null,
      name: snapshot.name || null,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      firstPairCreatedAt: null,
      ageHours: null,
      observationCount: 0,
      score: 0,
      reasons: [],
      rejectReason: null,
      confirmed: false,
      watchCount: 0,
      confirmedCount: 0,
      lastWatchAt: null,
      lastConfirmedAt: null,
      lastRejectedAt: null,
      rejectCount: 0,
      lastEventType: null,
      liquidityUsd: 0,
      previousLiquidityUsd: null,
      liquidityGrowthPct: null,
      fdv: 0,
      marketCap: 0,
      volumeM5Usd: 0,
      volume1hUsd: 0,
      volume6hUsd: 0,
      volume24hUsd: 0,
      volumeToLiquidity24h: 0,
      volumeExpansion1hVs6h: null,
      volumeExpansion6hVs24h: null,
      priceUsd: null,
      priceNative: null,
      priceChangeM5Pct: null,
      priceChange1hPct: null,
      priceChange6hPct: null,
      priceChange24hPct: null,
      buysM5: 0,
      sellsM5: 0,
      buys1h: 0,
      sells1h: 0,
      buys6h: 0,
      sells6h: 0,
      buys24h: 0,
      sells24h: 0,
      buyTxnRatio24h: null,
      sellTxnRatio24h: null,
      pairCount: 0,
      dexCount: 0,
      dexes: [],
      primaryDexId: null,
      primaryPairAddress: null,
      dexscreenerUrl: null,
      hasWebsite: false,
      hasTwitter: false,
      hasTelegram: false,
      websiteUrl: null,
      twitterUrl: null,
      telegramUrl: null,
      socialLinkCount: 0,
      externalMentionCount: 0,
      externalChatCount: 0,
      rickMentionCount: 0,
      kolFirstWaveCount: 0,
      kolTrustedCount: 0,
      holderCount: null,
      topHolderPercent: null,
      rawPairSample: null
    };
  }

  mergeSnapshot(existing, snapshot, now, nowIso) {
    const pairs = Array.isArray(snapshot.pairs) ? snapshot.pairs : [];
    const solPairs = pairs.filter((pair) => pair?.chainId === 'solana');
    const sortedPairs = [...solPairs].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
    const primary = sortedPairs[0] || snapshot.primaryPair || {};
    const dexes = Array.from(new Set(sortedPairs.map((pair) => pair.dexId).filter(Boolean)));
    const totalLiquidityUsd = this.sum(sortedPairs, (pair) => pair?.liquidity?.usd);
    const volumeM5Usd = this.sum(sortedPairs, (pair) => pair?.volume?.m5);
    const volume1hUsd = this.sum(sortedPairs, (pair) => pair?.volume?.h1);
    const volume6hUsd = this.sum(sortedPairs, (pair) => pair?.volume?.h6);
    const volume24hUsd = this.sum(sortedPairs, (pair) => pair?.volume?.h24);
    const txns = this.aggregateTxns(sortedPairs);
    const firstPairCreatedAt = this.minPairCreatedAt(sortedPairs) || existing.firstPairCreatedAt;
    const ageHours = firstPairCreatedAt ? (now - Number(firstPairCreatedAt)) / 3600000 : existing.ageHours;
    const social = this.extractSocial(primary, sortedPairs);
    const external = snapshot.telegramSummary || snapshot.narrativeSummary || {};
    const rick = snapshot.rickContextSummary || {};
    const launchIntel = snapshot.launchIntelSummary || {};
    const externalVisibility = launchIntel?.heuristics?.externalVisibility || {};
    const kolOverlap = launchIntel?.heuristics?.kolOverlap || {};
    const previousLiquidityUsd = Number(existing.liquidityUsd || 0) > 0 ? Number(existing.liquidityUsd) : null;

    return {
      ...existing,
      symbol: existing.symbol || snapshot.symbol || primary?.baseToken?.symbol || null,
      name: existing.name || snapshot.name || primary?.baseToken?.name || null,
      lastSeenAt: nowIso,
      firstPairCreatedAt,
      ageHours: Number.isFinite(ageHours) ? ageHours : null,
      liquidityUsd: totalLiquidityUsd,
      previousLiquidityUsd,
      liquidityGrowthPct: previousLiquidityUsd ? ((totalLiquidityUsd - previousLiquidityUsd) / previousLiquidityUsd) * 100 : null,
      fdv: Number(primary?.fdv || existing.fdv || 0),
      marketCap: Number(primary?.marketCap || existing.marketCap || 0),
      volumeM5Usd,
      volume1hUsd,
      volume6hUsd,
      volume24hUsd,
      volumeToLiquidity24h: totalLiquidityUsd > 0 ? volume24hUsd / totalLiquidityUsd : 0,
      volumeExpansion1hVs6h: volume6hUsd > 0 ? (volume1hUsd * 6) / volume6hUsd : null,
      volumeExpansion6hVs24h: volume24hUsd > 0 ? (volume6hUsd * 4) / volume24hUsd : null,
      priceUsd: this.numberOrNull(primary?.priceUsd),
      priceNative: this.numberOrNull(primary?.priceNative),
      priceChangeM5Pct: this.numberOrNull(primary?.priceChange?.m5),
      priceChange1hPct: this.numberOrNull(primary?.priceChange?.h1),
      priceChange6hPct: this.numberOrNull(primary?.priceChange?.h6),
      priceChange24hPct: this.numberOrNull(primary?.priceChange?.h24),
      buysM5: txns.m5.buys,
      sellsM5: txns.m5.sells,
      buys1h: txns.h1.buys,
      sells1h: txns.h1.sells,
      buys6h: txns.h6.buys,
      sells6h: txns.h6.sells,
      buys24h: txns.h24.buys,
      sells24h: txns.h24.sells,
      buyTxnRatio24h: txns.h24.total > 0 ? txns.h24.buys / txns.h24.total : null,
      sellTxnRatio24h: txns.h24.total > 0 ? txns.h24.sells / txns.h24.total : null,
      pairCount: sortedPairs.length,
      dexCount: dexes.length,
      dexes,
      primaryDexId: primary?.dexId || null,
      primaryPairAddress: primary?.pairAddress || null,
      dexscreenerUrl: primary?.url || null,
      ...social,
      externalMentionCount: Math.max(
        Number(existing.externalMentionCount || 0),
        Number(external.mentionCount || externalVisibility.mentionCount || 0)
      ),
      externalChatCount: Math.max(
        Number(existing.externalChatCount || 0),
        Number(external.uniqueChatCount || externalVisibility.uniqueChatCount || 0)
      ),
      rickMentionCount: Math.max(
        Number(existing.rickMentionCount || 0),
        Number(rick.matches || rick.mentionCount || 0)
      ),
      kolFirstWaveCount: Math.max(Number(existing.kolFirstWaveCount || 0), Number(kolOverlap.firstWaveCount || 0)),
      kolTrustedCount: Math.max(Number(existing.kolTrustedCount || 0), Number(kolOverlap.trustedCount || 0)),
      holderCount: snapshot.holderCount ?? existing.holderCount ?? null,
      topHolderPercent: snapshot.topHolderPercent ?? existing.topHolderPercent ?? null,
      rawPairSample: primary ? {
        dexId: primary.dexId,
        pairAddress: primary.pairAddress,
        url: primary.url
      } : existing.rawPairSample
    };
  }

  computeScore(state) {
    let score = 0;
    score += Math.min((state.liquidityUsd / Math.max(this.minLiquidityUsd, 1)) * 18, 18);
    score += Math.min((state.volumeToLiquidity24h / Math.max(this.minVolumeToLiquidity, 0.1)) * 16, 16);
    score += Math.min((state.volume1hUsd / Math.max(this.minVolume1hUsd, 1)) * 10, 10);
    score += Math.min(Number(state.volumeExpansion1hVs6h || 0) * 6, 8);
    score += Math.min(Number(state.volumeExpansion6hVs24h || 0) * 5, 7);
    score += this.priceTrendScore(state);
    score += Math.min(Math.max(state.pairCount - 1, 0) * 3, 6);
    score += Math.min(Math.max(state.dexCount - 1, 0) * 4, 8);
    score += this.socialScore(state);
    score += this.localSignalScore(state);
    score += this.ageScore(state);

    if (this.hasMatureLiquidityBase(state)) {
      score += 6;
    }

    if (this.hasReclaimContinuation(state)) {
      score += 4;
    }

    if (Number(state.sellTxnRatio24h || 0) > this.maxSellTxnRatio) {
      score -= 8;
    }

    return this.compact(Math.max(0, Math.min(score, 100)), 2);
  }

  priceTrendScore(state) {
    let score = 0;
    if (Number(state.priceChange1hPct || 0) > 0) score += Math.min(Number(state.priceChange1hPct) / 2, 6);
    if (Number(state.priceChange6hPct || 0) > 0) score += Math.min(Number(state.priceChange6hPct) / 6, 6);
    if (Number(state.priceChange24hPct || 0) > 0) score += Math.min(Number(state.priceChange24hPct) / 10, 5);
    return Math.min(score, 15);
  }

  socialScore(state) {
    let score = 0;
    if (state.hasWebsite) score += 4;
    if (state.hasTwitter) score += 5;
    if (state.hasTelegram) score += 4;
    if (Number(state.socialLinkCount || 0) >= 3) score += 2;
    return Math.min(score, 12);
  }

  localSignalScore(state) {
    let score = 0;
    if (Number(state.externalMentionCount || 0) > 0) score += 4;
    if (Number(state.externalChatCount || 0) > 0) score += 3;
    if (Number(state.rickMentionCount || 0) > 0) score += 4;
    if (Number(state.kolFirstWaveCount || 0) > 0) score += 4;
    if (Number(state.kolTrustedCount || 0) > 0) score += 3;
    return Math.min(score, 12);
  }

  ageScore(state) {
    const age = Number(state.ageHours);
    if (!Number.isFinite(age)) return 0;
    if (age < this.minAgeHours) return this.hasStrongFreshMomentum(state) ? 2 : 0;
    if (age > this.maxAgeHours) return this.hasStrongRevivalMomentum(state) ? 6 : 1;
    if (age >= 24 && age <= 120) return 7;
    if (age >= 2 && age <= 168) return 5;
    return 3;
  }

  hasStrongFreshMomentum(state) {
    return (
      Number(state.volumeToLiquidity24h || 0) >= this.minVolumeToLiquidity * 1.5 &&
      Number(state.volume1hUsd || 0) >= this.minVolume1hUsd * 1.5 &&
      Number(state.priceChange1hPct || 0) > 10 &&
      (state.hasTwitter || state.hasTelegram)
    );
  }

  hasStrongRevivalMomentum(state) {
    return (
      Number(state.volumeToLiquidity24h || 0) >= this.minVolumeToLiquidity &&
      Number(state.volume1hUsd || 0) >= this.minVolume1hUsd &&
      Number(state.priceChange1hPct || 0) > 5 &&
      Number(state.priceChange6hPct || 0) > 15 &&
      Number(state.priceChange24hPct || 0) > 25 &&
      (state.hasWebsite || state.hasTwitter || state.hasTelegram)
    );
  }

  hasMatureLiquidityBase(state) {
    return (
      Number(state.liquidityUsd || 0) >= 150000 &&
      Number(state.marketCap || state.fdv || 0) >= 1000000 &&
      Number(state.pairCount || 0) >= 3 &&
      Number(state.dexCount || 0) >= 2 &&
      Number(state.volumeToLiquidity24h || 0) >= 0.5 &&
      Number(state.priceChange1hPct || 0) > 0 &&
      Number(state.priceChange6hPct || 0) > 0 &&
      state.hasWebsite &&
      state.hasTwitter &&
      state.hasTelegram
    );
  }

  hasReclaimContinuation(state) {
    return (
      !this.hasVerticalExtension(state) &&
      Number(state.priceChangeM5Pct || 0) > 0 &&
      Number(state.priceChange1hPct || 0) >= 10 &&
      Number(state.priceChange6hPct || 0) >= 20 &&
      Number(state.priceChange24hPct || 0) >= 20 &&
      Number(state.volumeToLiquidity24h || 0) >= this.minVolumeToLiquidity * 4 &&
      Number(state.buyTxnRatio24h || 0) >= 0.55
    );
  }

  hasVerticalExtension(state) {
    return (
      Number(state.priceChange6hPct || 0) >= 150 &&
      Number(state.priceChange24hPct || 0) >= 300 &&
      Number(state.priceChange1hPct || 0) > 0 &&
      Number(state.volumeToLiquidity24h || 0) >= this.minVolumeToLiquidity * 3 &&
      Number(state.volume1hUsd || 0) >= this.minVolume1hUsd * 2
    );
  }

  hasLateChaseCaution(state) {
    return (
      this.hasVerticalExtension(state) &&
      Number(state.priceChange24hPct || 0) >= 500
    );
  }

  buildReasons(state) {
    const reasons = [];
    if (state.liquidityUsd >= this.minLiquidityUsd) reasons.push('liquidity_depth');
    if (state.volumeToLiquidity24h >= this.minVolumeToLiquidity) reasons.push('volume_to_liquidity');
    if (state.volume1hUsd >= this.minVolume1hUsd) reasons.push('one_hour_volume');
    if (Number(state.volumeExpansion1hVs6h || 0) >= 1) reasons.push('volume_accelerating_1h');
    if (Number(state.volumeExpansion6hVs24h || 0) >= 1) reasons.push('volume_accelerating_6h');
    if (Number(state.priceChange1hPct || 0) > 0 && Number(state.priceChange6hPct || 0) > 0) reasons.push('positive_trend');
    if (Number(state.ageHours) < this.minAgeHours) reasons.push('too_new_caution');
    if (Number(state.ageHours) > this.maxAgeHours && this.hasStrongRevivalMomentum(state)) reasons.push('legacy_revived');
    if (Number(state.ageHours) > this.maxAgeHours && !this.hasStrongRevivalMomentum(state)) reasons.push('old_coin_caution');
    if (this.hasMatureLiquidityBase(state)) reasons.push('mature_liquidity_base');
    if (this.hasReclaimContinuation(state)) reasons.push('reclaim_continuation');
    if (this.hasReclaimContinuation(state) && Number(state.ageHours) > this.maxAgeHours) reasons.push('legacy_reclaim');
    if (this.hasVerticalExtension(state)) reasons.push('vertical_extension');
    if (this.hasLateChaseCaution(state)) reasons.push('late_chase_caution');
    if (state.pairCount >= 2) reasons.push('multi_pool');
    if (state.dexCount >= 2) reasons.push('multi_dex');
    if (state.hasWebsite) reasons.push('website_present');
    if (state.hasTwitter) reasons.push('twitter_present');
    if (state.hasTelegram) reasons.push('telegram_present');
    if (state.externalMentionCount > 0 || state.rickMentionCount > 0) reasons.push('external_sighted');
    return reasons;
  }

  getRejectReason(state) {
    if (state.liquidityUsd < this.minLiquidityUsd) return 'LOW_LIQUIDITY';
    if (state.volumeToLiquidity24h < this.minVolumeToLiquidity && !this.hasMatureLiquidityBase(state)) return 'LOW_VOLUME_TO_LIQUIDITY';
    if (state.volume1hUsd < this.minVolume1hUsd) return 'LOW_1H_VOLUME';
    if (Number(state.sellTxnRatio24h || 0) > this.maxSellTxnRatio) return 'SELL_TXN_RATIO_TOO_HIGH';
    if (Number(state.ageHours) < this.minAgeHours && !this.hasStrongFreshMomentum(state)) return 'TOO_NEW';
    if (!state.hasWebsite && !state.hasTwitter && !state.hasTelegram) return 'NO_SOCIAL_INFRA';
    if (state.score < this.minScore) return 'LOW_SCORE';
    return null;
  }

  computeSignal(state, now) {
    if (state.rejectReason) {
      const sinceReject = state.lastRejectedAt ? now - new Date(state.lastRejectedAt).getTime() : Infinity;
      if (sinceReject < this.flagCooldownMs) {
        return { eventType: 'continuation.observed', shouldEmit: false };
      }
      return { eventType: 'continuation.rejected', shouldEmit: true };
    }

    const sinceWatch = state.lastWatchAt ? now - new Date(state.lastWatchAt).getTime() : Infinity;
    const sinceConfirm = state.lastConfirmedAt ? now - new Date(state.lastConfirmedAt).getTime() : Infinity;

    if (state.score >= this.confirmMinScore && sinceConfirm >= this.flagCooldownMs) {
      return { eventType: 'continuation.confirmed', shouldEmit: true };
    }

    if (state.score >= this.minScore && sinceWatch >= this.flagCooldownMs) {
      return { eventType: 'continuation.watch', shouldEmit: true };
    }

    return { eventType: 'continuation.observed', shouldEmit: false };
  }

  toSummary(state) {
    return {
      ...state,
      liquidityUsd: this.compact(state.liquidityUsd, 2),
      liquidityGrowthPct: this.numberOrNull(state.liquidityGrowthPct, 2),
      volumeM5Usd: this.compact(state.volumeM5Usd, 2),
      volume1hUsd: this.compact(state.volume1hUsd, 2),
      volume6hUsd: this.compact(state.volume6hUsd, 2),
      volume24hUsd: this.compact(state.volume24hUsd, 2),
      volumeToLiquidity24h: this.compact(state.volumeToLiquidity24h, 4),
      volumeExpansion1hVs6h: this.numberOrNull(state.volumeExpansion1hVs6h, 4),
      volumeExpansion6hVs24h: this.numberOrNull(state.volumeExpansion6hVs24h, 4),
      ageHours: this.numberOrNull(state.ageHours, 2),
      buyTxnRatio24h: this.numberOrNull(state.buyTxnRatio24h, 4),
      sellTxnRatio24h: this.numberOrNull(state.sellTxnRatio24h, 4)
    };
  }

  aggregateTxns(pairs) {
    const windows = {
      m5: { buys: 0, sells: 0, total: 0 },
      h1: { buys: 0, sells: 0, total: 0 },
      h6: { buys: 0, sells: 0, total: 0 },
      h24: { buys: 0, sells: 0, total: 0 }
    };

    for (const pair of pairs) {
      for (const key of Object.keys(windows)) {
        const buys = Number(pair?.txns?.[key]?.buys || 0);
        const sells = Number(pair?.txns?.[key]?.sells || 0);
        windows[key].buys += buys;
        windows[key].sells += sells;
        windows[key].total += buys + sells;
      }
    }

    return windows;
  }

  extractSocial(primary, pairs) {
    const websites = [];
    const socials = [];
    for (const pair of [primary, ...pairs]) {
      for (const website of pair?.info?.websites || []) {
        if (website?.url) websites.push(website.url);
      }
      for (const social of pair?.info?.socials || []) {
        if (social?.url) socials.push(social);
      }
    }

    const websiteUrl = websites[0] || null;
    const twitter = socials.find((item) => ['twitter', 'x'].includes(String(item.type || '').toLowerCase()) || String(item.url || '').includes('x.com'));
    const telegram = socials.find((item) => String(item.type || '').toLowerCase() === 'telegram' || String(item.url || '').includes('t.me'));
    const uniqueSocialUrls = new Set([...websites, ...socials.map((item) => item.url).filter(Boolean)]);

    return {
      hasWebsite: Boolean(websiteUrl),
      hasTwitter: Boolean(twitter?.url),
      hasTelegram: Boolean(telegram?.url),
      websiteUrl,
      twitterUrl: twitter?.url || null,
      telegramUrl: telegram?.url || null,
      socialLinkCount: uniqueSocialUrls.size
    };
  }

  minPairCreatedAt(pairs) {
    const times = pairs
      .map((pair) => Number(pair?.pairCreatedAt || 0))
      .filter((time) => Number.isFinite(time) && time > 0);
    return times.length > 0 ? Math.min(...times) : null;
  }

  sum(items, selector) {
    return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
  }

  increment(bucket, key) {
    if (!key) return;
    bucket[key] = (bucket[key] || 0) + 1;
  }

  compactIfNeeded() {
    if (this.states.size <= this.maxTrackedMints) {
      return;
    }

    const sorted = Array.from(this.states.entries())
      .sort(([, a], [, b]) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime());
    const removeCount = this.states.size - this.maxTrackedMints;
    for (const [mint] of sorted.slice(0, removeCount)) {
      this.states.delete(mint);
    }
  }

  getStats() {
    const recent = Array.from(this.states.values())
      .filter((state) => ['continuation.watch', 'continuation.confirmed', 'continuation.rejected'].includes(state.lastEventType))
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
      .slice(0, 10)
      .map((state) => ({
        mint: state.mint,
        symbol: state.symbol,
        score: state.score,
        eventType: state.lastEventType,
        rejectReason: state.rejectReason,
        liquidityUsd: this.compact(state.liquidityUsd, 2),
        volumeToLiquidity24h: this.compact(state.volumeToLiquidity24h, 3),
        priceChange6hPct: this.numberOrNull(state.priceChange6hPct, 2)
      }));

    return {
      ...this.stats,
      recent
    };
  }

  numberOrNull(value, decimals = 4) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return this.compact(numeric, decimals);
  }

  compact(value, decimals = 4) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return Number(numeric.toFixed(decimals));
  }
}

module.exports = PostMigrationContinuationLane;
