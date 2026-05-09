const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const DEFAULT_PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const BONDING_CURVE_DISCRIMINATOR = 6966180631402821399n;
const PUMP_TOKEN_DECIMALS = 6;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function bigIntToNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return Number(value.toString());
}

class PumpBondingCurveLane {
  constructor(config, logger, connection) {
    this.config = config;
    this.logger = logger;
    this.connection = connection;
    this.enabled = config.pumpBondingCurveLaneEnabled !== false;
    this.refreshIntervalMs = config.pumpBondingCurveRefreshIntervalMs;
    this.failureCooldownMs = config.pumpBondingCurveFailureCooldownMs;
    this.globalBackoffMs = config.pumpBondingCurveGlobalBackoffMs;
    this.globalBackoffErrorThreshold = config.pumpBondingCurveGlobalBackoffErrorThreshold;
    this.globalBackoffWindowMs = config.pumpBondingCurveGlobalBackoffWindowMs;
    this.maxTrackedMints = config.pumpBondingCurveMaxTrackedMints;
    this.maxFetchesPerCycle = config.pumpBondingCurveMaxFetchesPerCycle;
    this.programId = new PublicKey(config.pumpBondingCurveProgramId || DEFAULT_PUMP_FUN_PROGRAM_ID);
    this.states = new Map();
    this.inFlight = new Set();
    this.recentFailureTimestamps = [];
    this.globalBackoffUntil = 0;
    this.stats = {
      enabled: this.enabled,
      trackedMints: 0,
      fetches: 0,
      updates: 0,
      decoded: 0,
      missingAccounts: 0,
      skipped: 0,
      skippedFailureCooldown: 0,
      skippedGlobalBackoff: 0,
      globalBackoffActivations: 0,
      globalBackoffUntil: null,
      lastGlobalBackoffActivatedAt: null,
      lastGlobalBackoffErrorsInWindow: 0,
      lastGlobalBackoffWindowMs: null,
      errors: 0,
      lastUpdateAt: null
    };
  }

  deriveBondingCurveAddress(mint) {
    const mintPublicKey = new PublicKey(mint);
    const [address] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPublicKey.toBuffer()],
      this.programId
    );
    return address;
  }

  async observeMint(mint, tokenMeta = {}, options = {}) {
    if (!this.enabled || !mint || !this.connection) {
      return null;
    }

    const forceRefresh = Boolean(options.forceRefresh);
    const now = Date.now();
    const existing = this.states.get(mint);

    if (!options.bypassGlobalBackoff && this.isGlobalBackoffActive(now)) {
      this.stats.skipped += 1;
      this.stats.skippedGlobalBackoff += 1;
      this.stats.globalBackoffUntil = new Date(this.globalBackoffUntil).toISOString();
      return existing ? {
        ...this.toSummary(existing),
        refreshed: false,
        skipReason: 'GLOBAL_BACKOFF'
      } : null;
    }

    if (existing && !options.bypassFailureCooldown && this.isFailureCooldownActive(existing, now)) {
      this.stats.skipped += 1;
      this.stats.skippedFailureCooldown += 1;
      return {
        ...this.toSummary(existing),
        refreshed: false,
        skipReason: 'FAILURE_COOLDOWN'
      };
    }

    if (existing && !forceRefresh && !this.shouldRefresh(existing, now)) {
      this.stats.skipped += 1;
      return {
        ...this.toSummary(existing),
        refreshed: false,
        skipReason: 'REFRESH_INTERVAL'
      };
    }

    if (this.inFlight.has(mint) || this.inFlight.size >= this.maxFetchesPerCycle) {
      this.stats.skipped += 1;
      return existing ? {
        ...this.toSummary(existing),
        refreshed: false,
        skipReason: this.inFlight.has(mint) ? 'FETCH_IN_FLIGHT' : 'FETCH_LIMIT'
      } : null;
    }

    this.inFlight.add(mint);

    try {
      const bondingCurveAddress = this.deriveBondingCurveAddress(mint);
      const accountInfo = await this.connection.getAccountInfo(bondingCurveAddress, 'confirmed');
      this.stats.fetches += 1;
      this.noteSuccessfulFetch();

      if (!accountInfo?.data) {
        const missing = this.mergeState(mint, tokenMeta, {
          bondingCurveAddress: bondingCurveAddress.toBase58(),
          accountFound: false,
          lastFetchAt: now,
          lastFetchAtIso: new Date(now).toISOString()
        });
        this.stats.missingAccounts += 1;
        return {
          ...this.toSummary(missing),
          refreshed: true
        };
      }

      const decoded = this.decodeBondingCurveAccount(accountInfo.data);
      const next = this.mergeState(mint, tokenMeta, {
        ...decoded,
        bondingCurveAddress: bondingCurveAddress.toBase58(),
        accountFound: true,
        accountLamports: accountInfo.lamports,
        lastFetchAt: now,
        lastFetchAtIso: new Date(now).toISOString()
      });

      this.stats.decoded += 1;
      this.stats.updates += 1;
      this.stats.lastUpdateAt = next.lastFetchAtIso;
      this.compactIfNeeded();
      this.stats.trackedMints = this.states.size;
      return {
        ...this.toSummary(next),
        refreshed: true
      };
    } catch (error) {
      this.stats.errors += 1;
      this.noteFailedFetch(now);
      const failed = this.mergeState(mint, tokenMeta, {
        bondingCurveAddress: this.safeDeriveBondingCurveAddress(mint),
        lastErrorAt: now,
        lastErrorAtIso: new Date(now).toISOString(),
        lastErrorMessage: error.message
      });
      this.logger?.warn?.('Pump bonding curve lookup failed', {
        mint,
        error: error.message
      });
      return failed ? {
        ...this.toSummary(failed),
        refreshed: false
      } : null;
    } finally {
      this.inFlight.delete(mint);
    }
  }

  shouldRefresh(state, now) {
    if (this.isGlobalBackoffActive(now)) {
      return false;
    }

    if (this.isFailureCooldownActive(state, now)) {
      return false;
    }

    if (!state.lastFetchAt) {
      return true;
    }

    if (state.complete) {
      return now - state.lastFetchAt >= Math.max(this.refreshIntervalMs * 6, 60000);
    }

    return now - state.lastFetchAt >= this.refreshIntervalMs;
  }

  isRefreshDue(mint, now = Date.now()) {
    if (!this.enabled || !mint || this.inFlight.has(mint) || this.inFlight.size >= this.maxFetchesPerCycle) {
      return false;
    }

    if (this.isGlobalBackoffActive(now)) {
      return false;
    }

    const existing = this.states.get(mint);
    return !existing || this.shouldRefresh(existing, now);
  }

  isGlobalBackoffActive(now) {
    return Number.isFinite(this.globalBackoffUntil) && this.globalBackoffUntil > now;
  }

  noteSuccessfulFetch() {
    this.recentFailureTimestamps = [];
  }

  noteFailedFetch(now) {
    if (
      !Number.isFinite(this.globalBackoffMs) ||
      this.globalBackoffMs <= 0 ||
      !Number.isFinite(this.globalBackoffWindowMs) ||
      this.globalBackoffWindowMs <= 0 ||
      !Number.isFinite(this.globalBackoffErrorThreshold) ||
      this.globalBackoffErrorThreshold <= 0
    ) {
      return;
    }

    const windowStart = now - this.globalBackoffWindowMs;
    this.recentFailureTimestamps = this.recentFailureTimestamps
      .filter((timestamp) => timestamp >= windowStart);
    this.recentFailureTimestamps.push(now);

    if (this.recentFailureTimestamps.length < this.globalBackoffErrorThreshold) {
      return;
    }

    const nextBackoffUntil = now + this.globalBackoffMs;
    if (nextBackoffUntil > this.globalBackoffUntil) {
      this.globalBackoffUntil = nextBackoffUntil;
      this.stats.globalBackoffActivations += 1;
      this.stats.globalBackoffUntil = new Date(this.globalBackoffUntil).toISOString();
      this.stats.lastGlobalBackoffActivatedAt = new Date(now).toISOString();
      this.stats.lastGlobalBackoffErrorsInWindow = this.recentFailureTimestamps.length;
      this.stats.lastGlobalBackoffWindowMs = this.globalBackoffWindowMs;
      this.logger?.warn?.('Pump bonding curve global backoff activated', {
        backoffMs: this.globalBackoffMs,
        errorsInWindow: this.recentFailureTimestamps.length,
        windowMs: this.globalBackoffWindowMs
      });
    }

    this.recentFailureTimestamps = [];
  }

  isFailureCooldownActive(state, now) {
    if (!state?.lastErrorAt || !Number.isFinite(this.failureCooldownMs) || this.failureCooldownMs <= 0) {
      return false;
    }

    return now - Number(state.lastErrorAt) < this.failureCooldownMs;
  }

  safeDeriveBondingCurveAddress(mint) {
    try {
      return this.deriveBondingCurveAddress(mint).toBase58();
    } catch (_) {
      return null;
    }
  }

  decodeBondingCurveAccount(data) {
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }

    if (data.length < 49) {
      throw new Error(`Bonding curve account too short: ${data.length} bytes`);
    }

    const discriminator = data.readBigUInt64LE(0);
    if (discriminator !== BONDING_CURVE_DISCRIMINATOR) {
      throw new Error(`Unexpected bonding curve discriminator: ${discriminator.toString()}`);
    }

    let offset = 8;
    const readU64 = () => {
      const value = data.readBigUInt64LE(offset);
      offset += 8;
      return value;
    };

    const virtualTokenReserves = readU64();
    const virtualSolReserves = readU64();
    const realTokenReserves = readU64();
    const realSolReserves = readU64();
    const tokenTotalSupply = readU64();
    const complete = data[offset] === 1;
    offset += 1;

    let creator = null;
    if (data.length >= offset + 32) {
      creator = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
      offset += 32;
    }

    const isMayhemMode = data.length > offset ? data[offset] === 1 : false;
    const curveProgress = this.computeCurveProgress({
      complete,
      realTokenReserves,
      tokenTotalSupply
    });
    const virtualSolReservesSol = bigIntToNumber(virtualSolReserves) / LAMPORTS_PER_SOL;
    const realSolReservesSol = bigIntToNumber(realSolReserves) / LAMPORTS_PER_SOL;
    const virtualTokenReservesTokens = bigIntToNumber(virtualTokenReserves) / (10 ** PUMP_TOKEN_DECIMALS);
    const priceSol = virtualTokenReservesTokens > 0
      ? virtualSolReservesSol / virtualTokenReservesTokens
      : null;

    return {
      discriminator: discriminator.toString(),
      virtualTokenReserves: virtualTokenReserves.toString(),
      virtualSolReserves: virtualSolReserves.toString(),
      realTokenReserves: realTokenReserves.toString(),
      realSolReserves: realSolReserves.toString(),
      tokenTotalSupply: tokenTotalSupply.toString(),
      virtualSolReservesSol,
      realSolReservesSol,
      virtualTokenReservesTokens,
      priceSol,
      complete,
      creator,
      isMayhemMode,
      curveProgress,
      bondingStage: complete
        ? 'recently_bonded'
        : (curveProgress !== null && curveProgress >= this.config.preMigrationWatchMinCurveProgress ? 'almost_bonded' : 'bonding_curve')
    };
  }

  computeCurveProgress({ complete, realTokenReserves, tokenTotalSupply }) {
    if (complete) {
      return 1;
    }

    const totalSupply = bigIntToNumber(tokenTotalSupply);
    const remainingTokens = bigIntToNumber(realTokenReserves);
    if (!Number.isFinite(totalSupply) || totalSupply <= 0 || !Number.isFinite(remainingTokens)) {
      return null;
    }

    return Number(clamp(1 - (remainingTokens / totalSupply), 0, 1).toFixed(6));
  }

  mergeState(mint, tokenMeta, update) {
    const previous = this.states.get(mint) || {};
    const nowIso = update.lastFetchAtIso || new Date().toISOString();
    const next = {
      ...previous,
      ...update,
      mint,
      symbol: previous.symbol || tokenMeta.symbol || null,
      name: previous.name || tokenMeta.name || null,
      source: tokenMeta.source || previous.source || 'pump_bonding_curve',
      firstSeenAt: previous.firstSeenAt || tokenMeta.createdAt || nowIso,
      lastSeenAt: nowIso
    };

    this.states.set(mint, next);
    this.stats.trackedMints = this.states.size;
    return next;
  }

  compactIfNeeded() {
    if (!Number.isFinite(this.maxTrackedMints) || this.maxTrackedMints <= 0 || this.states.size <= this.maxTrackedMints) {
      return;
    }

    const ordered = [...this.states.entries()]
      .sort((a, b) => Number(b[1].lastFetchAt || 0) - Number(a[1].lastFetchAt || 0))
      .slice(0, this.maxTrackedMints);
    this.states = new Map(ordered);
  }

  getMintSummary(mint) {
    const state = this.states.get(mint);
    return state ? this.toSummary(state) : null;
  }

  toSummary(state) {
    return {
      mint: state.mint,
      symbol: state.symbol,
      name: state.name,
      source: state.source,
      bondingCurveAddress: state.bondingCurveAddress,
      accountFound: Boolean(state.accountFound),
      complete: Boolean(state.complete),
      bondingStage: state.bondingStage || null,
      curveProgress: state.curveProgress ?? null,
      virtualSolReservesSol: state.virtualSolReservesSol ?? null,
      realSolReservesSol: state.realSolReservesSol ?? null,
      virtualTokenReservesTokens: state.virtualTokenReservesTokens ?? null,
      priceSol: state.priceSol ?? null,
      creator: state.creator || null,
      isMayhemMode: Boolean(state.isMayhemMode),
      lastErrorAt: state.lastErrorAtIso || null,
      lastErrorMessage: state.lastErrorMessage || null,
      lastFetchAt: state.lastFetchAtIso || null
    };
  }

  getStats() {
    return {
      ...this.stats,
      trackedMints: this.states.size,
      inFlight: this.inFlight.size,
      recentFailuresInWindow: this.recentFailureTimestamps.length,
      globalBackoffActive: this.isGlobalBackoffActive(Date.now()),
      globalBackoffRemainingMs: this.isGlobalBackoffActive(Date.now())
        ? Math.max(0, this.globalBackoffUntil - Date.now())
        : 0,
      globalBackoffUntil: this.globalBackoffUntil
        ? new Date(this.globalBackoffUntil).toISOString()
        : null
    };
  }
}

module.exports = PumpBondingCurveLane;
