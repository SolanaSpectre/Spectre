const fs = require('fs');
const path = require('path');
const AsyncJsonlWriter = require('./async-jsonl-writer');

class WalletEventLedger {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.walletEventLedgerEnabled !== false;
    this.eventFilePath = config.walletEventLedgerFilePath;
    this.latestFilePath = config.walletEventLedgerLatestFilePath;
    this.maxRecentEvents = config.walletEventLedgerMaxRecentEvents;
    this.maxEventsPerMint = Number(config.walletEventLedgerMaxEventsPerMint || 50);
    this.recentEvents = [];
    this.eventsByMint = new Map();
    this.recentUntrustedEvents = [];
    this.untrustedEventsByMint = new Map();
    this.walletStats = new Map();
    this.latestFlushIntervalMs = Number(process.env.WALLET_EVENT_LATEST_FLUSH_INTERVAL_MS || 5000);
    this.lastLatestFlushAt = 0;
    this.latestWritePending = Promise.resolve();
    this.latestWriteInFlight = 0;

    if (this.enabled) {
      fs.mkdirSync(path.dirname(this.eventFilePath), { recursive: true });
      fs.mkdirSync(path.dirname(this.latestFilePath), { recursive: true });
      this.eventWriter = new AsyncJsonlWriter(this.eventFilePath, this.logger);
    }
  }

  recordTrade({
    event = {},
    tokenState = {},
    launchIntelSummary = null,
    walletProfile = null,
    watchedReason = null
  } = {}) {
    if (!this.enabled) {
      return null;
    }

    const wallet = this.extractWallet(event);
    const mint = event.mint || event.token || event.mintAddress || tokenState.mint || null;
    if (!wallet || !mint) {
      return null;
    }

    const timestampMs = this.normalizeTimestampMs(event.timestamp || event.blockTime || tokenState.lastTradeAt || Date.now());
    const createdAtMs = Number(tokenState.createdAt || 0) || null;
    const firstTradeAtMs = Number(tokenState.firstTradeAt || 0) || null;
    const preMigration = launchIntelSummary?.preMigration || launchIntelSummary?.preMigrationState || {};
    const heuristics = launchIntelSummary?.heuristics || {};
    const deployer = heuristics.deployer || {};
    const side = event.txType === 'sell' ? 'sell' : 'buy';
    const phase = this.classifyPhase(tokenState, preMigration);
    const volumeSol = this.numberOrNull(event.solAmount || event.vSolInBondingCurve || event.sol || 0, 8);

    const record = {
      schemaVersion: 1,
      source: 'wallet_event_ledger',
      eventType: 'wallet.trade_observed',
      observedAt: new Date().toISOString(),
      tradeAt: new Date(timestampMs).toISOString(),
      wallet,
      watchedReason,
      walletProfile: walletProfile ? {
        name: walletProfile.name || null,
        source: walletProfile.source || null,
        trustTier: walletProfile.trustTier || null,
        profile: walletProfile.profile || null,
        score: this.numberOrNull(walletProfile.score, 4),
        shadowOnly: walletProfile.shadowOnly === true,
        flags: Array.isArray(walletProfile.flags) ? walletProfile.flags.slice(0, 8) : []
      } : null,
      mint,
      symbol: tokenState.symbol || event.symbol || launchIntelSummary?.symbol || null,
      name: tokenState.name || event.name || launchIntelSummary?.name || null,
      side,
      signature: event.signature || event.txSignature || event.sig || null,
      slot: this.numberOrNull(event.slot ?? event.blockSlot ?? event.slotNumber, 0),
      amount: {
        sol: volumeSol,
        token: this.numberOrNull(event.tokenAmount || event.tokens || event.amount, 8)
      },
      phase,
      timing: {
        secondsSinceCreate: createdAtMs ? this.numberOrNull((timestampMs - createdAtMs) / 1000, 3) : null,
        secondsSinceFirstTrade: firstTradeAtMs ? this.numberOrNull((timestampMs - firstTradeAtMs) / 1000, 3) : null
      },
      market: {
        marketCapSol: this.numberOrNull(event.marketCapSol || tokenState.marketCapSol || tokenState.marketCap, 6),
        liquiditySol: this.numberOrNull(event.vSolInBondingCurve || tokenState.liquiditySol, 6),
        bondingStage: tokenState.bondingStage || preMigration.bondingStage || null,
        curveProgress: this.numberOrNull(preMigration.curveProgress ?? event.bondingCurveProgress ?? event.progress, 4),
        migrated: Boolean(tokenState.migratedAt || phase === 'post_migration')
      },
      tape: {
        tradeCount: this.numberOrNull(tokenState.tradeCount, 0),
        recentTradeCount: this.numberOrNull(preMigration.recentTradeCount ?? tokenState.recentTradeCount, 0),
        buys: this.numberOrNull(tokenState.buys, 0),
        sells: this.numberOrNull(tokenState.sells, 0),
        recentBuys: this.numberOrNull(preMigration.recentBuys ?? tokenState.recentBuys, 0),
        recentSells: this.numberOrNull(preMigration.recentSells ?? tokenState.recentSells, 0),
        recentVolumeSol: this.numberOrNull(preMigration.recentVolumeSol ?? tokenState.recentVolumeSol, 6),
        tradeVelocityPerMin: this.numberOrNull(preMigration.tradeVelocityPerMin ?? tokenState.tradeVelocityPerMin, 4)
      },
      risk: {
        deployerWallet: deployer.wallet || launchIntelSummary?.deployerWallet || null,
        isDeployerTrade: Boolean((deployer.wallet || launchIntelSummary?.deployerWallet) === wallet),
        sniperWalletCount: this.numberOrNull(heuristics.sniperWalletCount ?? preMigration.sniperWalletCount, 0),
        sniperCrowdingLevel: heuristics.sniperCrowdingLevel || null,
        bundlerCandidate: Boolean(heuristics.bundlerCandidate || preMigration.bundlerCandidate),
        bundlerWalletCount: this.numberOrNull(heuristics.bundlerWalletCount, 0),
        firstWaveDistinctWalletCount: this.numberOrNull(heuristics.firstWaveDistinctWalletCount, 0),
        kolTrustedCount: this.numberOrNull(launchIntelSummary?.kolOverlap?.trustedCount, 0),
        kolAvoidCount: this.numberOrNull(launchIntelSummary?.kolOverlap?.avoidCount, 0)
      }
    };

    this.appendRecord(record);
    this.updateStats(record);
    this.updateLatest(record);
    return record;
  }

  recordUntrustedTradeTape({
    event = {},
    tokenState = {},
    launchIntelSummary = null,
    reason = 'UNTRACKED_WALLET'
  } = {}) {
    if (!this.enabled) {
      return null;
    }

    const wallet = this.extractWallet(event);
    const mint = event.mint || event.token || event.mintAddress || tokenState.mint || null;
    if (!wallet || !mint) {
      return null;
    }

    const timestampMs = this.normalizeTimestampMs(event.timestamp || event.blockTime || tokenState.lastTradeAt || Date.now());
    const createdAtMs = Number(tokenState.createdAt || 0) || null;
    const preMigration = launchIntelSummary?.preMigration || launchIntelSummary?.preMigrationState || {};
    const side = event.txType === 'sell' ? 'sell' : 'buy';
    const phase = this.classifyPhase(tokenState, preMigration);
    const volumeSol = this.numberOrNull(event.solAmount || event.vSolInBondingCurve || event.sol || 0, 8);

    const record = {
      schemaVersion: 1,
      source: 'wallet_event_ledger_untrusted_tape',
      eventType: 'wallet.trade_untrusted_tape',
      observedAt: new Date().toISOString(),
      tradeAt: new Date(timestampMs).toISOString(),
      wallet,
      trustedSignal: false,
      reason,
      mint,
      symbol: tokenState.symbol || event.symbol || launchIntelSummary?.symbol || null,
      name: tokenState.name || event.name || launchIntelSummary?.name || null,
      side,
      signature: event.signature || event.txSignature || event.sig || null,
      slot: this.numberOrNull(event.slot ?? event.blockSlot ?? event.slotNumber, 0),
      amount: {
        sol: volumeSol,
        token: this.numberOrNull(event.tokenAmount || event.tokens || event.amount, 8)
      },
      phase,
      timing: {
        secondsSinceCreate: createdAtMs ? this.numberOrNull((timestampMs - createdAtMs) / 1000, 3) : null
      },
      market: {
        marketCapSol: this.numberOrNull(event.marketCapSol || tokenState.marketCapSol || tokenState.marketCap, 6),
        liquiditySol: this.numberOrNull(event.vSolInBondingCurve || tokenState.liquiditySol, 6),
        bondingStage: tokenState.bondingStage || preMigration.bondingStage || null,
        curveProgress: this.numberOrNull(preMigration.curveProgress ?? event.bondingCurveProgress ?? event.progress, 4),
        migrated: Boolean(tokenState.migratedAt || phase === 'post_migration')
      }
    };

    this.updateUntrustedLatest(record);
    return record;
  }

  classifyPhase(tokenState = {}, preMigration = {}) {
    if (tokenState.migratedAt || tokenState.bondingStage === 'recently_bonded') {
      return 'post_migration';
    }

    const curveProgress = Number(preMigration.curveProgress ?? tokenState.curveProgress ?? 0);
    if (curveProgress >= 0.85 || tokenState.bondingStage === 'almost_bonded') {
      return 'late_pre_migration';
    }

    if (curveProgress > 0) {
      return 'pre_migration';
    }

    return 'fresh_launch';
  }

  appendRecord(record) {
    this.eventWriter?.append(record, 'wallet event');
  }

  updateStats(record) {
    const existing = this.walletStats.get(record.wallet) || {
      wallet: record.wallet,
      walletProfile: record.walletProfile,
      touches: 0,
      buys: 0,
      sells: 0,
      totalSol: 0,
      preMigrationTouches: 0,
      postMigrationTouches: 0,
      earliestTouchSeconds: null,
      lastSeenAt: null,
      recentMints: []
    };

    existing.walletProfile = record.walletProfile || existing.walletProfile || null;
    existing.touches += 1;
    existing.buys += record.side === 'buy' ? 1 : 0;
    existing.sells += record.side === 'sell' ? 1 : 0;
    existing.totalSol = this.compact(Number(existing.totalSol || 0) + Number(record.amount?.sol || 0), 8);
    existing.preMigrationTouches += record.phase === 'fresh_launch' || record.phase.includes('pre_migration') ? 1 : 0;
    existing.postMigrationTouches += record.phase === 'post_migration' ? 1 : 0;
    existing.deployerTrades = Number(existing.deployerTrades || 0) + (record.risk?.isDeployerTrade ? 1 : 0);
    existing.bundlerTouches = Number(existing.bundlerTouches || 0) + (record.risk?.bundlerCandidate ? 1 : 0);
    existing.sniperCrowdedTouches = Number(existing.sniperCrowdedTouches || 0)
      + (Number(record.risk?.sniperWalletCount || 0) >= 4 ? 1 : 0);
    if (record.timing.secondsSinceCreate !== null) {
      existing.earliestTouchSeconds = existing.earliestTouchSeconds === null
        ? record.timing.secondsSinceCreate
        : Math.min(existing.earliestTouchSeconds, record.timing.secondsSinceCreate);
    }
    existing.lastSeenAt = record.tradeAt;
    existing.recentMints = [
      {
        mint: record.mint,
        symbol: record.symbol,
        side: record.side,
        phase: record.phase,
        sol: record.amount?.sol,
        marketCapSol: record.market?.marketCapSol,
        secondsSinceCreate: record.timing?.secondsSinceCreate,
        tradeAt: record.tradeAt
      },
      ...existing.recentMints.filter((item) => item.mint !== record.mint)
    ].slice(0, 10);

    existing.classification = this.classifyWallet(existing);
    this.walletStats.set(record.wallet, existing);
  }

  classifyWallet(stats = {}) {
    const touches = Number(stats.touches || 0);
    const buys = Number(stats.buys || 0);
    const sells = Number(stats.sells || 0);
    const preMigrationTouches = Number(stats.preMigrationTouches || 0);
    const postMigrationTouches = Number(stats.postMigrationTouches || 0);
    const deployerTrades = Number(stats.deployerTrades || 0);
    const bundlerTouches = Number(stats.bundlerTouches || 0);
    const sniperCrowdedTouches = Number(stats.sniperCrowdedTouches || 0);
    const averageSol = touches > 0 ? Number(stats.totalSol || 0) / touches : 0;
    const earlySeconds = stats.earliestTouchSeconds;
    const buyRatio = touches > 0 ? buys / touches : 0;
    const sellRatio = touches > 0 ? sells / touches : 0;
    const preMigrationRatio = touches > 0 ? preMigrationTouches / touches : 0;
    const postMigrationRatio = touches > 0 ? postMigrationTouches / touches : 0;
    const bundlerRatio = touches > 0 ? bundlerTouches / touches : 0;
    const sniperCrowdedRatio = touches > 0 ? sniperCrowdedTouches / touches : 0;
    const deployerRatio = touches > 0 ? deployerTrades / touches : 0;
    const profileName = String(stats.walletProfile?.profile || '').toLowerCase();
    const trustTier = String(stats.walletProfile?.trustTier || '').toUpperCase();
    const flags = Array.isArray(stats.walletProfile?.flags) ? stats.walletProfile.flags : [];

    const reasons = [];
    let label = 'LOW_SIGNAL';
    let confidence = touches >= 8 ? 0.55 : (touches >= 4 ? 0.4 : 0.2);

    if (touches < 3) {
      reasons.push('insufficient_observations');
      return {
        label: 'INSUFFICIENT_DATA',
        confidence,
        reasons,
        metrics: this.walletClassificationMetrics({
          touches,
          buyRatio,
          sellRatio,
          preMigrationRatio,
          postMigrationRatio,
          averageSol,
          earlySeconds,
          bundlerRatio,
          sniperCrowdedRatio,
          deployerRatio
        })
      };
    }

    if (deployerRatio >= 0.35 || flags.includes('OPS_OR_FUNDER') || profileName.includes('funder')) {
      label = 'DEV_SIDE_WALLET';
      confidence += 0.25;
      reasons.push('deployer_or_funder_overlap');
    } else if (bundlerRatio >= 0.4) {
      label = 'BUNDLE_CLUSTER';
      confidence += 0.2;
      reasons.push('frequent_bundle_context');
    } else if (
      earlySeconds !== null &&
      earlySeconds <= 5 &&
      preMigrationRatio >= 0.65 &&
      sniperCrowdedRatio >= 0.35
    ) {
      label = 'EARLY_SNIPER';
      confidence += 0.25;
      reasons.push('very_early_pre_migration_sniper_context');
    } else if (
      earlySeconds !== null &&
      earlySeconds <= 30 &&
      preMigrationRatio >= 0.55 &&
      buyRatio >= 0.55
    ) {
      label = 'EARLY_ALPHA_SCALPER';
      confidence += 0.18;
      reasons.push('early_pre_migration_buy_bias');
    } else if (
      averageSol >= 2 &&
      postMigrationRatio >= 0.5 &&
      buyRatio >= 0.55
    ) {
      label = 'CONVICTION_WHALE';
      confidence += 0.2;
      reasons.push('large_post_migration_buy_bias');
    } else if (
      averageSol >= 0.75 &&
      postMigrationRatio >= 0.4 &&
      profileName.includes('runner')
    ) {
      label = 'RUNNER_HUNTER';
      confidence += 0.15;
      reasons.push('runner_profile_with_size');
    } else if (
      sellRatio >= 0.55 &&
      preMigrationRatio >= 0.5
    ) {
      label = 'INSIDER_DUMPER';
      confidence += 0.15;
      reasons.push('pre_migration_sell_bias');
    } else if (
      averageSol >= 0.5 &&
      buyRatio >= 0.65 &&
      postMigrationRatio >= 0.35
    ) {
      label = 'DIP_SUPPORT_BUYER';
      confidence += 0.12;
      reasons.push('repeated_buy_support_with_size');
    } else if (
      earlySeconds !== null &&
      earlySeconds > 120 &&
      buyRatio >= 0.6 &&
      averageSol < 0.75
    ) {
      label = 'LATE_CHASER';
      confidence += 0.1;
      reasons.push('later_small_buy_bias');
    } else {
      reasons.push('mixed_or_low_sample_signal');
    }

    if (trustTier === 'TRUSTED') {
      confidence += 0.08;
      reasons.push('trusted_watchlist_tier');
    } else if (trustTier === 'AVOID') {
      confidence += 0.05;
      reasons.push('avoid_watchlist_tier');
      if (label === 'LOW_SIGNAL') {
        label = 'LOW_SIGNAL_AVOID';
      }
    }

    return {
      label,
      confidence: this.compact(Math.max(0, Math.min(confidence, 0.95)), 4),
      reasons,
      metrics: this.walletClassificationMetrics({
        touches,
        buyRatio,
        sellRatio,
        preMigrationRatio,
        postMigrationRatio,
        averageSol,
        earlySeconds,
        bundlerRatio,
        sniperCrowdedRatio,
        deployerRatio
      })
    };
  }

  walletClassificationMetrics(metrics = {}) {
    return {
      touches: metrics.touches,
      buyRatio: this.compact(metrics.buyRatio, 4),
      sellRatio: this.compact(metrics.sellRatio, 4),
      preMigrationRatio: this.compact(metrics.preMigrationRatio, 4),
      postMigrationRatio: this.compact(metrics.postMigrationRatio, 4),
      averageSol: this.compact(metrics.averageSol, 8),
      earliestTouchSeconds: metrics.earlySeconds === null ? null : this.compact(metrics.earlySeconds, 3),
      bundlerRatio: this.compact(metrics.bundlerRatio, 4),
      sniperCrowdedRatio: this.compact(metrics.sniperCrowdedRatio, 4),
      deployerRatio: this.compact(metrics.deployerRatio, 4)
    };
  }

  updateLatest(record) {
    this.recentEvents.unshift(record);
    this.recentEvents = this.recentEvents.slice(0, this.maxRecentEvents);

    const mintEvents = this.eventsByMint.get(record.mint) || [];
    mintEvents.push(record);
    mintEvents.sort((a, b) => this.normalizeTimestampMs(a.tradeAt || a.observedAt) - this.normalizeTimestampMs(b.tradeAt || b.observedAt));
    this.eventsByMint.set(record.mint, mintEvents.slice(0, Math.max(1, this.maxEventsPerMint)));

    this.flushLatest(false);
  }

  updateUntrustedLatest(record) {
    this.recentUntrustedEvents.unshift(record);
    this.recentUntrustedEvents = this.recentUntrustedEvents.slice(0, this.maxRecentEvents);

    const mintEvents = this.untrustedEventsByMint.get(record.mint) || [];
    mintEvents.push(record);
    mintEvents.sort((a, b) => this.normalizeTimestampMs(a.tradeAt || a.observedAt) - this.normalizeTimestampMs(b.tradeAt || b.observedAt));
    this.untrustedEventsByMint.set(record.mint, mintEvents.slice(0, Math.max(1, this.maxEventsPerMint)));
  }

  recentEventsForMint(mint, limit = this.maxEventsPerMint) {
    if (!mint) return [];
    const rows = this.eventsByMint.get(mint) || [];
    return rows.slice(0, Math.max(1, Number(limit || this.maxEventsPerMint)));
  }

  recentUntrustedEventsForMint(mint, limit = this.maxEventsPerMint) {
    if (!mint) return [];
    const rows = this.untrustedEventsByMint.get(mint) || [];
    return rows.slice(0, Math.max(1, Number(limit || this.maxEventsPerMint)));
  }

  flushLatest(force = false) {
    if (!this.enabled) {
      return;
    }

    const now = Date.now();
    if (!force && Number.isFinite(this.latestFlushIntervalMs) && this.latestFlushIntervalMs > 0) {
      if (now - this.lastLatestFlushAt < this.latestFlushIntervalMs) {
        return;
      }
    }

    const topWallets = [...this.walletStats.values()]
      .sort((a, b) => b.touches - a.touches || new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0))
      .slice(0, 50);

    let payload = '';
    try {
      payload = JSON.stringify({
      generatedAt: new Date().toISOString(),
      eventFilePath: this.eventFilePath,
      recentEventCount: this.recentEvents.length,
      recentUntrustedEventCount: this.recentUntrustedEvents.length,
      mintContextCount: this.eventsByMint.size,
      untrustedMintContextCount: this.untrustedEventsByMint.size,
      walletCount: this.walletStats.size,
      classificationCounts: this.countClassifications(topWallets),
      topWallets,
      recentEvents: this.recentEvents,
      recentUntrustedEvents: this.recentUntrustedEvents.slice(0, 50)
      }, null, 2);
    } catch (error) {
      this.logger.warn('Failed to serialize wallet event latest snapshot', error.message);
      return;
    }

    this.lastLatestFlushAt = now;
    this.latestWriteInFlight += 1;
    this.latestWritePending = this.latestWritePending
      .then(() => fs.promises.writeFile(this.latestFilePath, payload, 'utf8'))
      .catch((error) => {
        this.logger.warn('Failed to write wallet event latest snapshot', error.message);
      })
      .finally(() => {
        this.latestWriteInFlight = Math.max(0, this.latestWriteInFlight - 1);
      });
  }

  async flushAsync() {
    this.flushLatest(true);
    await Promise.all([
      this.eventWriter?.flush?.(),
      this.latestWritePending
    ]);
  }

  countClassifications(wallets = []) {
    return wallets.reduce((acc, wallet) => {
      const label = wallet.classification?.label || 'UNCLASSIFIED';
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {});
  }

  getStats() {
    return {
      enabled: this.enabled,
      eventFilePath: this.eventFilePath,
      latestFilePath: this.latestFilePath,
      recentEventCount: this.recentEvents.length,
      recentUntrustedEventCount: this.recentUntrustedEvents.length,
      mintContextCount: this.eventsByMint.size,
      untrustedMintContextCount: this.untrustedEventsByMint.size,
      walletCount: this.walletStats.size,
      maxEventsPerMint: this.maxEventsPerMint,
      latestWriteInFlight: this.latestWriteInFlight,
      eventWritePending: this.eventWriter?.getStats?.().pending || 0
    };
  }

  numberOrNull(value, decimals = 4) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return null;
    }
    return this.compact(number, decimals);
  }

  normalizeTimestampMs(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
      return Date.now();
    }

    return number < 10_000_000_000 ? number * 1000 : number;
  }

  extractWallet(event = {}) {
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

  compact(value, decimals = 4) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Number(number.toFixed(decimals));
  }
}

module.exports = WalletEventLedger;
