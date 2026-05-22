const axios = require('axios');
const { VersionedTransaction } = require('@solana/web3.js');

class MarketData {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.raydiumApi = config.raydiumApiBaseUrl || 'https://api-v3.raydium.io';
    this.meteoraApi = config.meteoraApiBaseUrl || 'https://dlmm.datapi.meteora.ag';
    this.moonshotApi = config.moonshotApiBaseUrl || 'https://api.moonshot.cc';
    this.birdeyeApi = config.birdeyeApiBaseUrl || 'https://public-api.birdeye.so';
    this.dexScreenerApi = config.dexScreenerApiBaseUrl || 'https://api.dexscreener.com';
    this.jupiterApiBaseUrl = config.jupiterApiBaseUrl;
    this.lastQuoteTime = new Map();
    this.solPriceCache = null;
    this.solPriceInFlight = null;
    this.solPriceFailureUntil = 0;
    this.tokenPriceCache = new Map();
    this.lastJupiterRequestAt = 0;
    this.birdeyeCache = new Map();
    this.birdeyeRequestTimestamps = [];
    this.birdeyeCooldownUntil = 0;
    this.birdeyeSuppressedTokens = new Map();
    this.dexScreenerCache = new Map();
    this.raydiumPoolCache = null;
    this.meteoraPoolCache = null;
    this.warnLogTimestamps = new Map();
    this.http = axios.create({
      proxy: config.disableEnvProxy ? false : undefined,
      timeout: 10000
    });
  }

  warnOnce(key, ttlMs, message, details = undefined) {
    const now = Date.now();
    const lastAt = this.warnLogTimestamps.get(key) || 0;
    if (now - lastAt < ttlMs) {
      return false;
    }

    this.warnLogTimestamps.set(key, now);
    if (details === undefined) {
      this.logger.warn(message);
    } else {
      this.logger.warn(message, details);
    }
    return true;
  }

  getJupiterHeaders() {
    const headers = {};

    if (this.config.jupiterApiKey) {
      headers['x-api-key'] = this.config.jupiterApiKey;
    }

    return headers;
  }

  getBirdeyeHeaders() {
    return {
      'x-chain': 'solana',
      ...(this.config.birdeyeApiKey ? { 'X-API-KEY': this.config.birdeyeApiKey } : {})
    };
  }

  getFreshCache(cache, ttlMs) {
    if (!cache) {
      return null;
    }

    const ageMs = Date.now() - cache.timestamp;
    return ageMs <= ttlMs ? cache.value : null;
  }

  getStaleCache(cache, staleTtlMs) {
    if (!cache) {
      return null;
    }

    const ageMs = Date.now() - cache.timestamp;
    return ageMs <= staleTtlMs ? { value: cache.value, ageMs } : null;
  }

  async getSolanaPrice() {
    const cached = this.getFreshCache(this.solPriceCache, this.config.solPriceCacheTtlMs);
    if (cached !== null) {
      return cached;
    }

    if (this.solPriceInFlight) {
      return this.solPriceInFlight;
    }

    const stale = this.getStaleCache(this.solPriceCache, this.config.solPriceStaleTtlMs);
    const now = Date.now();
    if (
      stale &&
      this.solPriceCache.lastErrorAt &&
      now - this.solPriceCache.lastErrorAt <= this.config.solPriceFailureCooldownMs
    ) {
      return stale.value;
    }

    if (now < this.solPriceFailureUntil) {
      if (stale) {
        return stale.value;
      }

      if (this.config.executionMode !== 'LIVE') {
        return 0;
      }
    }

    this.solPriceInFlight = this.fetchSolanaPrice(stale);
    try {
      return await this.solPriceInFlight;
    } finally {
      this.solPriceInFlight = null;
    }
  }

  async fetchSolanaPrice(stale = null) {
    try {
      await this.waitForJupiterSlot();
      const response = await this.http.get(
        `${this.jupiterApiBaseUrl}/price/v3`,
        {
          params: { ids: this.config.baseTokenMint },
          headers: this.getJupiterHeaders()
        }
      );

      const value = response.data?.[this.config.baseTokenMint]?.usdPrice || 0;
      this.solPriceCache = {
        value,
        timestamp: Date.now(),
        lastErrorAt: null,
        lastErrorMessage: null
      };
      return value;
    } catch (error) {
      const fallback = stale || this.getStaleCache(this.solPriceCache, this.config.solPriceStaleTtlMs);
      this.solPriceFailureUntil = Date.now() + Math.max(Number(this.config.solPriceFailureCooldownMs || 0), 1000);
      if (this.solPriceCache) {
        this.solPriceCache.lastErrorAt = Date.now();
        this.solPriceCache.lastErrorMessage = error.message;
      }

      if (fallback) {
        this.logger.warn('Failed to fetch SOL price; using cached SOL price', {
          error: error.message,
          ageMs: Math.round(fallback.ageMs)
        });
        return fallback.value;
      }

      this.warnOnce(
        'sol-price:no-cache',
        Math.max(Number(this.config.solPriceFailureCooldownMs || 0), 1000),
        'Failed to fetch SOL price',
        error.message
      );
      if (this.config.executionMode !== 'LIVE') {
        return 0;
      }
      throw error;
    }
  }

  getCachedSolanaPrice(maxAgeMs = null) {
    if (!this.solPriceCache) {
      return null;
    }

    const ageMs = Date.now() - this.solPriceCache.timestamp;
    if (Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && ageMs > maxAgeMs) {
      return null;
    }

    return {
      value: this.solPriceCache.value,
      timestamp: this.solPriceCache.timestamp,
      ageMs
    };
  }

  async getRaydiumPools() {
    const cached = this.getFreshCache(this.raydiumPoolCache, this.config.raydiumPoolCacheTtlMs);
    if (cached) {
      return cached;
    }

    const stale = this.getStaleCache(this.raydiumPoolCache, this.config.raydiumPoolStaleTtlMs);
    if (
      stale &&
      this.raydiumPoolCache.lastErrorAt &&
      Date.now() - this.raydiumPoolCache.lastErrorAt <= this.config.raydiumPoolCacheTtlMs
    ) {
      return stale.value;
    }

    try {
      const response = await this.http.get(`${this.raydiumApi}/pools/info/list`, {
        params: {
          poolType: 'all',
          poolSortField: 'default',
          sortType: 'desc',
          pageSize: 100,
          page: 1
        }
      });

      const pools = response.data?.data?.data || [];
      const normalized = pools.map((pool) => this.normalizeRaydiumPool(pool)).filter(Boolean);
      this.raydiumPoolCache = {
        timestamp: Date.now(),
        value: normalized,
        lastErrorAt: null
      };
      return normalized;
    } catch (error) {
      const fallback = this.getStaleCache(this.raydiumPoolCache, this.config.raydiumPoolStaleTtlMs);
      if (this.raydiumPoolCache) {
        this.raydiumPoolCache.lastErrorAt = Date.now();
      }

      if (fallback) {
        this.warnOnce('raydium-pools:cached-fallback', this.config.raydiumPoolCacheTtlMs, 'Failed to fetch Raydium pools; using cached Raydium pool snapshot', {
          error: error.message,
          ageMs: Math.round(fallback.ageMs)
        });
        return fallback.value;
      }

      this.warnOnce('raydium-pools:no-snapshot', this.config.raydiumPoolCacheTtlMs, 'Failed to fetch Raydium pools; continuing without Raydium pool snapshot', error.message);
      return [];
    }
  }

  async getMeteoraPools() {
    if (!this.config.meteoraEnabled) {
      return [];
    }

    const cached = this.getFreshCache(this.meteoraPoolCache, this.config.meteoraPoolCacheTtlMs);
    if (cached) {
      return cached;
    }

    const stale = this.getStaleCache(this.meteoraPoolCache, this.config.meteoraPoolStaleTtlMs);
    if (
      stale &&
      this.meteoraPoolCache.lastErrorAt &&
      Date.now() - this.meteoraPoolCache.lastErrorAt <= this.config.meteoraPoolCacheTtlMs
    ) {
      return stale.value;
    }

    try {
      const response = await this.http.get(`${this.meteoraApi}/pools`, {
        params: {
          limit: 100,
          offset: 0
        }
      });

      const pools = Array.isArray(response.data)
        ? response.data
        : response.data?.data || response.data?.pools || [];

      const normalized = pools.map((pool) => this.normalizeMeteoraPool(pool)).filter(Boolean);
      this.meteoraPoolCache = {
        timestamp: Date.now(),
        value: normalized,
        lastErrorAt: null
      };
      return normalized;
    } catch (error) {
      const fallback = this.getStaleCache(this.meteoraPoolCache, this.config.meteoraPoolStaleTtlMs);
      if (this.meteoraPoolCache) {
        this.meteoraPoolCache.lastErrorAt = Date.now();
      }

      if (fallback) {
        this.warnOnce('meteora-pools:cached-fallback', this.config.meteoraPoolCacheTtlMs, 'Failed to fetch Meteora pools; using cached Meteora pool snapshot', {
          error: error.message,
          ageMs: Math.round(fallback.ageMs)
        });
        return fallback.value;
      }

      this.warnOnce('meteora-pools:no-snapshot', this.config.meteoraPoolCacheTtlMs, 'Failed to fetch Meteora pools; continuing without Meteora pool snapshot', error.message);
      return [];
    }
  }

  normalizeMeteoraPool(pool) {
    const baseMint = this.config.baseTokenMint;
    const tokenX = pool.mint_x || pool.token_x || pool.tokenX || pool.base_token || {};
    const tokenY = pool.mint_y || pool.token_y || pool.tokenY || pool.quote_token || {};
    const mintX = tokenX.address || tokenX.mint || pool.mint_x;
    const mintY = tokenY.address || tokenY.mint || pool.mint_y;
    const tokenMint = mintX === baseMint ? mintY : mintX;

    if (!tokenMint || tokenMint === baseMint) {
      return null;
    }

    return {
      id: pool.address || pool.pool_address || pool.id,
      source: 'meteora',
      type: 'dlmm',
      mintAddress: tokenMint,
      baseMintAddress: mintX === baseMint ? mintX : mintY,
      symbol: tokenX.address === tokenMint ? tokenX.symbol : tokenY.symbol,
      name: pool.name || undefined,
      liquidity: Number(pool.liquidity || pool.tvl || 0),
      liquidityUsd: Number(pool.liquidity || pool.tvl || 0),
      volume24h: Number(pool.volume_24h || pool.volume24h || pool.fees?.['24h'] || 0),
      price: Number(pool.current_price || pool.price || 0),
      feeRate: Number(pool.dynamic_fee_pct || pool.base_fee_pct || 0),
      openTime: Number(pool.created_at || 0),
      raw: pool
    };
  }

  async getMoonshotTokens() {
    if (!this.config.moonshotEnabled) {
      return [];
    }

    const candidatePaths = [
      '/tokens/v1/new/solana',
      '/tokens/v1/trending/solana',
      '/v1/solana/tokens'
    ];

    for (const path of candidatePaths) {
      try {
        const response = await this.http.get(`${this.moonshotApi}${path}`);
        const tokens = Array.isArray(response.data)
          ? response.data
          : response.data?.data || response.data?.tokens || [];

        if (tokens.length > 0) {
          return tokens.map((token) => this.normalizeMoonshotToken(token)).filter(Boolean);
        }
      } catch (error) {
        this.logger.warn(`Moonshot feed path unavailable: ${path}`, error.message);
      }
    }

    return [];
  }

  async getDexScreenerTokenPairs(mintAddress) {
    if (!mintAddress) {
      return [];
    }

    const cached = this.dexScreenerCache.get(mintAddress);
    if (cached && Date.now() - cached.timestamp <= this.config.dexScreenerCacheTtlMs) {
      return cached.value;
    }

    try {
      const response = await this.http.get(`${this.dexScreenerApi}/latest/dex/tokens/${mintAddress}`);
      const pairs = Array.isArray(response.data?.pairs) ? response.data.pairs : [];
      const solanaPairs = pairs.filter((pair) => pair?.chainId === 'solana');
      this.dexScreenerCache.set(mintAddress, {
        timestamp: Date.now(),
        value: solanaPairs
      });
      return solanaPairs;
    } catch (error) {
      this.logger.warn(`DexScreener token snapshot unavailable for ${mintAddress}`, error.message);
      this.dexScreenerCache.set(mintAddress, {
        timestamp: Date.now(),
        value: []
      });
      return [];
    }
  }

  normalizeMoonshotToken(token) {
    const mintAddress = token.mint || token.address || token.tokenAddress || token.contractAddress;
    if (!mintAddress) {
      return null;
    }

    return {
      id: token.id || mintAddress,
      source: 'moonshot',
      type: 'launch',
      mintAddress,
      symbol: token.symbol,
      name: token.name,
      liquidity: Number(token.liquidity || token.liquidityUsd || 0),
      liquidityUsd: Number(token.liquidityUsd || token.liquidity || 0),
      volume24h: Number(token.volume24h || token.volume || 0),
      marketCap: Number(token.marketCap || token.fdv || 0),
      price: Number(token.price || token.priceUsd || 0),
      openTime: Number(token.createdAt || token.created_at || 0),
      raw: token
    };
  }

  async getBirdeyePrice(mintAddress) {
    return this.getBirdeyeResource(mintAddress, 'price', '/defi/price', {
      address: mintAddress,
      include_liquidity: true
    });
  }

  async getBirdeyeTokenOverview(mintAddress) {
    return this.getBirdeyeResource(mintAddress, 'overview', '/defi/token_overview', {
      address: mintAddress
    });
  }

  async getBirdeyeTokenSecurity(mintAddress) {
    if (!this.config.birdeyeSecurityEnabled) {
      return null;
    }

    return this.getBirdeyeResource(mintAddress, 'security', '/defi/token_security', {
      address: mintAddress
    });
  }

  async getBirdeyeHolderDistribution(mintAddress) {
    if (!this.config.birdeyeHolderDistributionEnabled) {
      return null;
    }

    return this.getBirdeyeResource(mintAddress, 'holder_distribution', '/holder/v1/distribution', {
      address: mintAddress
    });
  }

  async getBirdeyeResource(mintAddress, type, endpoint, params) {
    if (!this.config.birdeyeEnabled) {
      return null;
    }

    const suppression = this.getBirdeyeTokenSuppression(mintAddress, type);
    if (suppression) {
      return null;
    }

    const cached = this.getBirdeyeCached(mintAddress, type);
    if (cached !== undefined) {
      return cached;
    }

    const availability = this.getBirdeyeAvailability();
    if (!availability.allowed) {
      if (availability.reason === 'cooldown') {
        this.logger.warn(`Birdeye cooldown skipped ${type} request for ${mintAddress}`);
      } else {
        this.logger.warn(`Birdeye rate limit guard skipped ${type} request for ${mintAddress}`);
      }
      return null;
    }

    try {
      const response = await this.executeBirdeyeRequest(() => this.http.get(`${this.birdeyeApi}${endpoint}`, {
        params,
        headers: this.getBirdeyeHeaders()
      }));

      const data = response.data?.data || null;
      this.clearBirdeyeTokenSuppression(mintAddress, type);
      this.setBirdeyeCached(mintAddress, type, data);
      return data;
    } catch (error) {
      const ttlMs = this.handleBirdeyeResourceError(mintAddress, type, error);
      this.setBirdeyeCached(mintAddress, type, null, ttlMs);
      return null;
    }
  }

  async enrichWithBirdeye(tokenInfo) {
    const overviewData = await this.getBirdeyeTokenOverview(tokenInfo.mintAddress);
    const securityData = await this.getBirdeyeTokenSecurity(tokenInfo.mintAddress);
    const holderDistribution = await this.getBirdeyeHolderDistribution(tokenInfo.mintAddress);
    const priceData = overviewData?.price
      ? null
      : await this.getBirdeyePrice(tokenInfo.mintAddress);

    const holderMetrics = this.normalizeHolderDistribution(holderDistribution);
    const securityMetrics = this.normalizeTokenSecurity(securityData);

    return {
      ...tokenInfo,
      birdeye: {
        price: priceData,
        overview: overviewData,
        security: securityData,
        holderDistribution
      },
      priceUsd: Number(overviewData?.price || priceData?.value || tokenInfo.priceUsd || 0),
      liquidityUsd: Number(priceData?.liquidity || overviewData?.liquidity || tokenInfo.liquidityUsd || 0),
      volume: Number(overviewData?.v24hUSD || overviewData?.volume24h || tokenInfo.volume || 0),
      marketCap: Number(overviewData?.mc || overviewData?.marketCap || tokenInfo.marketCap || 0),
      top10HolderPercent: holderMetrics.top10HolderPercent ?? tokenInfo.top10HolderPercent,
      holderCount: holderMetrics.holderCount ?? tokenInfo.holderCount,
      mintAuthority: securityMetrics.mintAuthority ?? tokenInfo.mintAuthority,
      freezeAuthority: securityMetrics.freezeAuthority ?? tokenInfo.freezeAuthority,
      devHoldingPercent: securityMetrics.devHoldingPercent ?? tokenInfo.devHoldingPercent,
      token2022Extensions: securityMetrics.token2022Extensions || tokenInfo.token2022Extensions,
      quoteable: tokenInfo.quoteable !== false
    };
  }

  normalizeHolderDistribution(holderDistribution) {
    if (!holderDistribution) {
      return {};
    }

    const holders = holderDistribution.items || holderDistribution.holders || holderDistribution.distribution || [];
    const top10HolderPercentRaw = holderDistribution.top10HolderPercent
      ?? holderDistribution.top10Percent
      ?? holderDistribution.top10
      ?? holderDistribution.top_10_holder_percent;

    if (typeof top10HolderPercentRaw === 'number') {
      return {
        top10HolderPercent: this.normalizePercent(top10HolderPercentRaw),
        holderCount: holderDistribution.holder || holderDistribution.holderCount || holders.length || undefined
      };
    }

    if (!Array.isArray(holders) || holders.length === 0) {
      return {
        holderCount: holderDistribution.holder || holderDistribution.holderCount || undefined
      };
    }

    const top10 = holders.slice(0, 10).reduce((sum, holder) => {
      const percent = holder.percentage ?? holder.percent ?? holder.amountPercent ?? holder.uiAmountPercent ?? 0;
      return sum + this.normalizePercent(Number(percent || 0));
    }, 0);

    return {
      top10HolderPercent: top10,
      holderCount: holderDistribution.holder || holderDistribution.holderCount || holders.length
    };
  }

  normalizeTokenSecurity(securityData) {
    if (!securityData) {
      return {};
    }

    const mintAuthority = securityData.mintAuthority
      ?? securityData.mint_authority
      ?? (securityData.mutableMetadata === false ? null : undefined);
    const freezeAuthority = securityData.freezeAuthority ?? securityData.freeze_authority;
    const devHoldingPercentRaw = securityData.creatorBalancePercent
      ?? securityData.creator_percentage
      ?? securityData.ownerPercentage
      ?? securityData.owner_percentage;

    return {
      mintAuthority,
      freezeAuthority,
      devHoldingPercent: typeof devHoldingPercentRaw === 'number'
        ? this.normalizePercent(devHoldingPercentRaw)
        : undefined,
      token2022Extensions: {
        transferHook: Boolean(securityData.transferHook || securityData.transfer_hook),
        transferFee: Boolean(securityData.transferFee || securityData.transfer_fee)
      }
    };
  }

  normalizePercent(value) {
    if (!Number.isFinite(value)) {
      return undefined;
    }

    return value > 1 ? value / 100 : value;
  }

  getBirdeyeCached(mintAddress, type) {
    const key = `${type}:${mintAddress}`;
    const cached = this.birdeyeCache.get(key);
    if (!cached) {
      return undefined;
    }

    if (Date.now() > cached.expiresAt) {
      this.birdeyeCache.delete(key);
      return undefined;
    }

    return cached.data;
  }

  setBirdeyeCached(mintAddress, type, data, ttlMs = this.config.birdeyeCacheTtlMs) {
    this.birdeyeCache.set(`${type}:${mintAddress}`, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttlMs
    });
  }

  getBirdeyeTokenSuppression(mintAddress, type) {
    const key = `${type}:${mintAddress}`;
    const suppression = this.birdeyeSuppressedTokens.get(key);
    if (!suppression) {
      return null;
    }

    if (Date.now() >= suppression.until) {
      this.birdeyeSuppressedTokens.delete(key);
      return null;
    }

    return suppression;
  }

  clearBirdeyeTokenSuppression(mintAddress, type) {
    this.birdeyeSuppressedTokens.delete(`${type}:${mintAddress}`);
  }

  handleBirdeyeResourceError(mintAddress, type, error) {
    const status = Number(error?.response?.status || 0);

    if (status === 400 || status === 404) {
      const cooldownMs = this.config.birdeyeInvalidTokenCooldownMs;
      const until = Date.now() + cooldownMs;
      this.birdeyeSuppressedTokens.set(`${type}:${mintAddress}`, {
        until,
        status
      });
      this.logger.warn(
        `Suppressing Birdeye ${type} for ${mintAddress} after ${status} for ${cooldownMs}ms`
      );
      return Math.max(this.config.birdeyeErrorCacheTtlMs, cooldownMs);
    }

    this.logger.warn(`Failed to fetch Birdeye ${type} for ${mintAddress}`, error.message);
    return this.config.birdeyeErrorCacheTtlMs;
  }

  getBirdeyeAvailability() {
    if (Date.now() < this.birdeyeCooldownUntil) {
      return {
        allowed: false,
        reason: 'cooldown',
        retryInMs: this.birdeyeCooldownUntil - Date.now()
      };
    }

    const oneMinuteAgo = Date.now() - 60_000;
    this.birdeyeRequestTimestamps = this.birdeyeRequestTimestamps
      .filter((timestamp) => timestamp >= oneMinuteAgo);

    if (this.birdeyeRequestTimestamps.length >= this.config.birdeyeTargetRpm) {
      const oldestTimestamp = this.birdeyeRequestTimestamps[0] || Date.now();
      return {
        allowed: false,
        reason: 'rpm_guard',
        retryInMs: Math.max((oldestTimestamp + 60_000) - Date.now(), 250)
      };
    }

    return { allowed: true };
  }

  recordBirdeyeRequest() {
    this.birdeyeRequestTimestamps.push(Date.now());
  }

  async executeBirdeyeRequest(requestFactory) {
    let delayMs = this.config.birdeyeRetryBaseDelayMs;
    const maxRetries = this.config.birdeyeMaxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const availability = this.getBirdeyeAvailability();
      if (!availability.allowed) {
        await this.sleep(availability.retryInMs || delayMs);
        continue;
      }

      this.recordBirdeyeRequest();

      try {
        return await requestFactory();
      } catch (error) {
        if (error.response?.status !== 429 || attempt === maxRetries) {
          throw error;
        }

        this.birdeyeCooldownUntil = Date.now() + delayMs;
        this.logger.warn(`Birdeye 429 received, backing off for ${delayMs}ms`);
        await this.sleep(delayMs);
        delayMs *= 2;
      }
    }

    throw new Error('Birdeye request failed after retry budget was exhausted');
  }

  normalizeRaydiumPool(pool) {
    const baseMint = this.config.baseTokenMint;
    const mintA = pool.mintA || {};
    const mintB = pool.mintB || {};
    const tokenMint = mintA.address === baseMint ? mintB.address : mintA.address;

    if (!tokenMint || tokenMint === baseMint) {
      return null;
    }

    return {
      id: pool.id,
      type: pool.type || pool.pooltype?.[0] || 'unknown',
      programId: pool.programId,
      mintAddress: tokenMint,
      baseMintAddress: mintA.address === baseMint ? mintA.address : mintB.address,
      symbol: mintA.address === tokenMint ? mintA.symbol : mintB.symbol,
      name: mintA.address === tokenMint ? mintA.name : mintB.name,
      liquidity: Number(pool.tvl || 0),
      liquidityUsd: Number(pool.tvl || 0),
      volume24h: Number(pool.day?.volume || pool.day?.volumeQuote || 0),
      price: Number(pool.price || 0),
      feeRate: Number(pool.feeRate || 0),
      openTime: Number(pool.openTime || 0),
      raw: pool
    };
  }

  async getPoolInfo(poolId) {
    try {
      const response = await this.http.get(`${this.raydiumApi}/v2/sdk/liquidity/mainnet/${poolId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch pool info for ${poolId}`, error.message);
      throw error;
    }
  }

  async getRecentTrades() {
    return {
      trades: [],
      volume: 0,
      avgPrice: 0
    };
  }

  async getJupiterOrder(inputMint, outputMint, amount, taker = null) {
    try {
      await this.waitForJupiterSlot();
      const response = await this.http.get(
        `${this.jupiterApiBaseUrl}/ultra/v1/order`,
        {
          params: {
            inputMint,
            outputMint,
            amount,
            taker: taker || undefined
          },
          headers: this.getJupiterHeaders()
        }
      );

      return {
        ...response.data,
        _fetchTimestamp: Date.now(),
        _inputMint: inputMint,
        _outputMint: outputMint,
        _amount: amount
      };
    } catch (error) {
      this.logger.error('Failed to get Jupiter order', error.message);
      throw error;
    }
  }

  async waitForJupiterSlot() {
    const minInterval = this.config.jupiterMinRequestIntervalMs;
    if (!minInterval) {
      return;
    }

    const elapsed = Date.now() - this.lastJupiterRequestAt;
    if (elapsed < minInterval) {
      await new Promise((resolve) => setTimeout(resolve, minInterval - elapsed));
    }

    this.lastJupiterRequestAt = Date.now();
  }

  async getQuoteWithStalenessCheck(inputMint, outputMint, amount, taker = null) {
    const quote = await this.getJupiterOrder(inputMint, outputMint, amount, taker);
    this.lastQuoteTime.set(`${inputMint}:${outputMint}:${amount}`, quote._fetchTimestamp);
    return quote;
  }

  isQuoteStale(quote) {
    const fetchTime = quote?._fetchTimestamp;
    if (!fetchTime) {
      return { stale: true, ageMs: null, reason: 'MISSING_QUOTE_TIMESTAMP' };
    }

    const ageMs = Date.now() - fetchTime;
    if (ageMs > this.config.maxQuoteAgeMs) {
      return { stale: true, ageMs, reason: 'QUOTE_TOO_OLD' };
    }

    const slotsElapsedEstimate = ageMs / 400;
    if (slotsElapsedEstimate > 5) {
      return { stale: true, ageMs, reason: 'SLOT_ADVANCED', slotsElapsedEstimate };
    }

    return { stale: false, ageMs };
  }

  async executeJupiterOrder(connection, walletManager, orderResponse) {
    if (!orderResponse?.transaction || !orderResponse?.requestId) {
      throw new Error('Jupiter order response did not include transaction or requestId');
    }

    const transaction = VersionedTransaction.deserialize(
      Buffer.from(orderResponse.transaction, 'base64')
    );

    transaction.sign([walletManager.getKeypair()]);

    const signedTransaction = Buffer.from(transaction.serialize()).toString('base64');

    try {
      const response = await this.http.post(
        `${this.jupiterApiBaseUrl}/ultra/v1/execute`,
        {
          signedTransaction,
          requestId: orderResponse.requestId
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...this.getJupiterHeaders()
          }
        }
      );

      if (!response.data?.status || response.data.status === 'Failed') {
        throw new Error(`Jupiter execute failed with response: ${JSON.stringify(response.data)}`);
      }

      return response.data;
    } catch (error) {
      this.logger.error('Failed to execute Jupiter order', error.message);
      throw error;
    }
  }

  async getTokenValueInSol(mintAddress, amountRaw) {
    if (!amountRaw || BigInt(amountRaw) <= 0n) {
      return 0;
    }

    const order = await this.getJupiterOrder(
      mintAddress,
      this.config.baseTokenMint,
      amountRaw.toString()
    );

    const totalOutputAmount = Number(order?.outAmount || order?.outputAmount || order?.totalOutputAmount || 0);
    return totalOutputAmount / 1_000_000_000;
  }

  async analyzeToken(mintAddress) {
    try {
      const [price, volume, liquidity, solPrice] = await Promise.all([
        this.getTokenPrice(mintAddress),
        this.getTokenVolume(mintAddress),
        this.getTokenLiquidity(mintAddress),
        this.getSolanaPrice()
      ]);

      const liquidityUsd = liquidity * solPrice;
      return {
        mintAddress,
        price,
        volume,
        liquidity,
        liquidityUsd,
        marketCap: price * liquidity,
        riskScore: this.calculateRiskScore(price, volume, liquidity),
        program: 'spl-token',
        mintAuthority: null,
        freezeAuthority: null,
        quoteable: price > 0
      };
    } catch (error) {
      this.logger.error(`Failed to analyze token ${mintAddress}`, error.message);
      throw error;
    }
  }

  async getTokenPrice(mintAddress) {
    const cached = this.getTokenPriceCached(mintAddress);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const [tokenPriceResponse, solPrice] = await Promise.all([
        this.http.get(
          `${this.jupiterApiBaseUrl}/price/v3`,
          {
            params: { ids: mintAddress },
            headers: this.getJupiterHeaders()
          }
        ),
        this.getSolanaPrice()
      ]);

      const tokenUsdPrice = tokenPriceResponse.data?.[mintAddress]?.usdPrice;
      if (!tokenUsdPrice || !solPrice) {
        return 0;
      }

      const value = tokenUsdPrice / solPrice;
      this.setTokenPriceCached(mintAddress, value);
      return value;
    } catch (error) {
      this.warnOnce(
        `token-price:${mintAddress}`,
        this.config.tokenPriceCacheTtlMs,
        `Failed to fetch token price for ${mintAddress}`,
        error.message
      );
      const birdeyePrice = await this.getBirdeyePrice(mintAddress);
      if (birdeyePrice?.value) {
        const solPrice = await this.getSolanaPrice();
        const value = solPrice ? birdeyePrice.value / solPrice : 0;
        this.setTokenPriceCached(mintAddress, value);
        return value;
      }

      this.setTokenPriceCached(mintAddress, 0);
      return 0;
    }
  }

  getTokenPriceCached(mintAddress) {
    const cached = this.tokenPriceCache.get(mintAddress);
    if (!cached) {
      return undefined;
    }

    if (Date.now() - cached.timestamp > this.config.tokenPriceCacheTtlMs) {
      this.tokenPriceCache.delete(mintAddress);
      return undefined;
    }

    return cached.value;
  }

  setTokenPriceCached(mintAddress, value) {
    this.tokenPriceCache.set(mintAddress, {
      value,
      timestamp: Date.now()
    });
  }

  async getTokenVolume() {
    return 0;
  }

  async getTokenLiquidity() {
    return 0;
  }

  calculateRiskScore(price, volume, liquidity) {
    const volumeScore = Math.min(volume / 1000, 1);
    const liquidityScore = Math.min(liquidity / 500, 1);
    const priceAvailabilityScore = price > 0 ? 0.25 : 0.75;

    return (priceAvailabilityScore * 0.5) + (volumeScore * 0.25) + (liquidityScore * 0.25);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = MarketData;
