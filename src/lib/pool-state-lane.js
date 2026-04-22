class PoolStateLane {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.poolStateLaneEnabled !== false;
    this.maxTrackedMints = config.poolStateLaneMaxTrackedMints;
    this.minLiquidityUsd = config.poolStateLaneMinLiquidityUsd;
    this.states = new Map();
    this.stats = {
      enabled: this.enabled,
      trackedMints: 0,
      poolsObserved: 0,
      updates: 0,
      discoveries: 0,
      lastUpdateAt: null
    };
  }

  ingestPools(pools = []) {
    if (!this.enabled || !Array.isArray(pools) || pools.length === 0) {
      return { observed: 0, updated: 0, discovered: 0, states: [] };
    }

    const updatedStates = [];
    let discovered = 0;
    let observed = 0;

    for (const pool of pools) {
      const state = this.normalizePool(pool);
      if (!state) {
        continue;
      }

      observed += 1;
      const existing = this.states.get(state.mintAddress);
      const merged = this.mergeState(existing, state);
      const changed = this.hasMeaningfulChange(existing, merged);

      if (!existing) {
        discovered += 1;
      }

      if (changed) {
        this.states.set(state.mintAddress, merged);
        updatedStates.push(merged);
      }
    }

    this.compactIfNeeded();

    this.stats.poolsObserved += observed;
    this.stats.updates += updatedStates.length;
    this.stats.discoveries += discovered;
    this.stats.trackedMints = this.states.size;
    this.stats.lastUpdateAt = updatedStates.length > 0 ? new Date().toISOString() : this.stats.lastUpdateAt;

    return {
      observed,
      updated: updatedStates.length,
      discovered,
      states: updatedStates
    };
  }

  normalizePool(pool = {}) {
    const mintAddress = pool.mintAddress;
    if (!mintAddress) {
      return null;
    }

    const liquidityUsd = Number(pool.liquidityUsd || pool.liquidity || 0);
    if (this.minLiquidityUsd > 0 && liquidityUsd > 0 && liquidityUsd < this.minLiquidityUsd) {
      return null;
    }

    const nowIso = new Date().toISOString();
    return {
      mintAddress,
      poolAddress: pool.id || pool.poolAddress || pool.address || null,
      source: pool.source || 'unknown_pool',
      poolType: pool.type || null,
      baseMintAddress: pool.baseMintAddress || null,
      symbol: pool.symbol || null,
      name: pool.name || null,
      liquidityUsd,
      volume24h: Number(pool.volume24h || 0),
      price: Number(pool.price || 0),
      feeRate: Number(pool.feeRate || 0),
      openTime: Number(pool.openTime || 0) || null,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso
    };
  }

  mergeState(existing, next) {
    if (!existing) {
      return {
        mintAddress: next.mintAddress,
        symbol: next.symbol || null,
        name: next.name || null,
        firstSeenAt: next.firstSeenAt,
        lastSeenAt: next.lastSeenAt,
        bestLiquidityUsd: next.liquidityUsd,
        bestVolume24h: next.volume24h,
        bestPool: this.compactPool(next),
        pools: [this.compactPool(next)]
      };
    }

    const pools = [...(existing.pools || [])];
    const poolKey = this.getPoolKey(next);
    const existingIndex = pools.findIndex((pool) => this.getPoolKey(pool) === poolKey);
    const compactNext = this.compactPool(next);

    if (existingIndex >= 0) {
      pools[existingIndex] = {
        ...pools[existingIndex],
        ...compactNext,
        firstSeenAt: pools[existingIndex].firstSeenAt || compactNext.firstSeenAt,
        lastSeenAt: compactNext.lastSeenAt
      };
    } else {
      pools.push(compactNext);
    }

    const sortedPools = pools
      .sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0))
      .slice(0, 6);
    const bestPool = sortedPools[0] || compactNext;

    return {
      ...existing,
      symbol: existing.symbol || next.symbol || null,
      name: existing.name || next.name || null,
      firstSeenAt: existing.firstSeenAt || next.firstSeenAt,
      lastSeenAt: next.lastSeenAt,
      bestLiquidityUsd: Math.max(Number(existing.bestLiquidityUsd || 0), Number(next.liquidityUsd || 0)),
      bestVolume24h: Math.max(Number(existing.bestVolume24h || 0), Number(next.volume24h || 0)),
      bestPool,
      pools: sortedPools
    };
  }

  compactPool(pool) {
    return {
      poolAddress: pool.poolAddress || null,
      source: pool.source || null,
      poolType: pool.poolType || null,
      liquidityUsd: Number(pool.liquidityUsd || 0),
      volume24h: Number(pool.volume24h || 0),
      price: Number(pool.price || 0),
      feeRate: Number(pool.feeRate || 0),
      openTime: pool.openTime || null,
      firstSeenAt: pool.firstSeenAt || null,
      lastSeenAt: pool.lastSeenAt || null
    };
  }

  getPoolKey(pool) {
    return `${pool.source || 'unknown'}:${pool.poolAddress || pool.poolType || 'pool'}`;
  }

  hasMeaningfulChange(existing, next) {
    if (!existing) {
      return true;
    }

    const previousBest = Number(existing.bestLiquidityUsd || 0);
    const nextBest = Number(next.bestLiquidityUsd || 0);
    const previousPoolCount = Array.isArray(existing.pools) ? existing.pools.length : 0;
    const nextPoolCount = Array.isArray(next.pools) ? next.pools.length : 0;

    return (
      nextPoolCount !== previousPoolCount ||
      nextBest > previousBest * 1.1
    );
  }

  getMintSummary(mintAddress) {
    if (!mintAddress) {
      return null;
    }

    const state = this.states.get(mintAddress);
    if (!state) {
      return null;
    }

    return {
      mintAddress: state.mintAddress,
      firstSeenAt: state.firstSeenAt,
      lastSeenAt: state.lastSeenAt,
      bestLiquidityUsd: Number(state.bestLiquidityUsd || 0),
      bestVolume24h: Number(state.bestVolume24h || 0),
      bestPool: state.bestPool || null,
      poolCount: Array.isArray(state.pools) ? state.pools.length : 0,
      pools: Array.isArray(state.pools) ? state.pools.slice(0, 3) : []
    };
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
      trackedMints: this.states.size
    };
  }
}

module.exports = PoolStateLane;
