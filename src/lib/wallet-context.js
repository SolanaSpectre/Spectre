const fs = require('fs');

class WalletContext {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.walletIntelEnabled !== false;
    this.filePath = config.walletIntelFilePath;
    this.refreshIntervalMs = config.walletIntelRefreshIntervalMs;
    this.lastLoadedAt = 0;
    this.lastMtimeMs = 0;
    this.mintIntel = new Map();
  }

  refreshIfNeeded() {
    if (!this.enabled || !this.filePath) {
      return;
    }

    const now = Date.now();
    if ((now - this.lastLoadedAt) < this.refreshIntervalMs) {
      return;
    }

    this.lastLoadedAt = now;

    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }

      const stat = fs.statSync(this.filePath);
      if (stat.mtimeMs <= this.lastMtimeMs) {
        return;
      }

      const payload = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const nextMintIntel = new Map();
      for (const item of payload.mintIntel || []) {
        if (item?.mint) {
          nextMintIntel.set(item.mint, item);
        }
      }

      this.mintIntel = nextMintIntel;
      this.lastMtimeMs = stat.mtimeMs;
      this.logger.info(`Wallet intel loaded: ${this.mintIntel.size} mints`);
    } catch (error) {
      this.logger.warn('Failed to refresh wallet intel', error.message);
    }
  }

  getMintSummary(mint) {
    this.refreshIfNeeded();

    if (!mint) {
      return null;
    }

    const item = this.mintIntel.get(mint);
    if (!item) {
      return null;
    }

    const topWallets = (item.topWallets || []).slice(0, 3).map((wallet) => ({
      name: wallet.name || null,
      rank: wallet.rank || null,
      score: Number(wallet.score || 0),
      profile: wallet.profile || null,
      trustTier: wallet.trustTier || 'MIXED',
      flags: Array.isArray(wallet.flags) ? wallet.flags.slice(0, 5) : [],
      touchCount: Number(wallet.touchCount || 0)
    }));

    const trustTierCounts = topWallets.reduce((acc, wallet) => {
      const tier = wallet.trustTier || 'MIXED';
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {});

    const profileCounts = topWallets.reduce((acc, wallet) => {
      const profile = wallet.profile || 'unknown';
      acc[profile] = (acc[profile] || 0) + 1;
      return acc;
    }, {});

    const learningSignals = [];
    const cautionSignals = [];

    const trustedAggressive = topWallets.filter((wallet) =>
      wallet.trustTier === 'TRUSTED' && wallet.profile === 'aggressive_pump_trader'
    ).length;
    const trustedRotators = topWallets.filter((wallet) =>
      wallet.trustTier === 'TRUSTED' && wallet.profile === 'active_rotator'
    ).length;
    const avoidOps = topWallets.filter((wallet) =>
      wallet.trustTier === 'AVOID' && wallet.profile === 'ops_or_funder'
    ).length;
    const rejectOverlap = topWallets.filter((wallet) =>
      Array.isArray(wallet.flags) && wallet.flags.includes('HIGH_REJECT_OVERLAP')
    ).length;
    const transferHeavyAvoid = topWallets.filter((wallet) =>
      wallet.trustTier === 'AVOID' &&
      Array.isArray(wallet.flags) &&
      wallet.flags.includes('TRANSFER_HEAVY')
    ).length;

    if (trustedAggressive > 0) {
      learningSignals.push('trusted_aggressive_pump_traders_present');
    }
    if (trustedRotators > 0) {
      learningSignals.push('trusted_active_rotators_present');
    }
    if ((trustTierCounts.TRUSTED || 0) >= 2) {
      learningSignals.push('multi_wallet_trusted_convergence');
    }

    if (avoidOps > 0) {
      cautionSignals.push('ops_heavy_avoid_wallets_present');
    }
    if (transferHeavyAvoid > 0) {
      cautionSignals.push('transfer_heavy_avoid_flow');
    }
    if (rejectOverlap > 0) {
      cautionSignals.push('historically_rejected_wallet_overlap');
    }
    if ((trustTierCounts.AVOID || 0) > 0 && !(trustTierCounts.TRUSTED > 0)) {
      cautionSignals.push('avoid_flow_dominant');
    }

    return {
      topWalletCount: Number(item.topWalletCount || 0),
      totalWalletTouches: Number(item.totalWalletTouches || 0),
      weightedWalletScore: Number(item.weightedWalletScore || 0),
      trustTierCounts,
      profileCounts,
      supportTier: trustTierCounts.TRUSTED > 0
        ? 'TRUSTED_FLOW'
        : (trustTierCounts.AVOID > 0 && !trustTierCounts.TRUSTED ? 'AVOID_FLOW' : 'MIXED_FLOW'),
      learningSignals,
      cautionSignals,
      topWallets,
      overlap: {
        botRejectedCount: Number(item.overlap?.botRejectedCount || 0),
        botExecutedCount: Number(item.overlap?.botExecutedCount || 0),
        botClosedCount: Number(item.overlap?.botClosedCount || 0),
        topRejectReason: item.overlap?.topRejectReason || null
      }
    };
  }
}

module.exports = WalletContext;
