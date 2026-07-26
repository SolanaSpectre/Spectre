const { PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const DEFAULT_PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const BONDING_CURVE_DISCRIMINATOR = 6966180631402821399n;
const PUMP_TOKEN_DECIMALS = 6;
const PUMP_TOKEN_TOTAL_SUPPLY = 1_000_000_000;
const PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET = 279_900_000;
const SENTINEL_NON_BONDING_CURVE_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);
const ALLOWED_RPC_COMMITMENTS = new Set(['processed', 'confirmed', 'finalized']);

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
    this.globalBackoffHighCurveBypassProgress = Number.isFinite(config.pumpBondingCurveGlobalBackoffHighCurveBypassProgress)
      ? config.pumpBondingCurveGlobalBackoffHighCurveBypassProgress
      : 0.85;
    this.maxTrackedMints = config.pumpBondingCurveMaxTrackedMints;
    this.maxFetchesPerCycle = config.pumpBondingCurveMaxFetchesPerCycle;
    this.batchFetchEnabled = config.pumpBondingCurveBatchFetchEnabled !== false;
    this.batchFlushMs = Number.isFinite(config.pumpBondingCurveBatchFlushMs)
      ? Math.max(0, config.pumpBondingCurveBatchFlushMs)
      : 150;
    this.batchMaxAccounts = Number.isFinite(config.pumpBondingCurveBatchMaxAccounts)
      ? Math.max(1, config.pumpBondingCurveBatchMaxAccounts)
      : 25;
    this.rpcCommitment = this.normalizeRpcCommitment(config.pumpBondingCurveRpcCommitment);
    this.programId = new PublicKey(config.pumpBondingCurveProgramId || DEFAULT_PUMP_FUN_PROGRAM_ID);
    this.states = new Map();
    this.inFlight = new Set();
    this.pendingAccountFetches = new Map();
    this.batchTimer = null;
    this.completeMints = new Set();
    this.recentFailureTimestamps = [];
    this.globalBackoffUntil = 0;
    this.stats = {
      enabled: this.enabled,
      trackedMints: 0,
      fetches: 0,
      rpcBatches: 0,
      batchAccounts: 0,
      batchDedupedRequests: 0,
      updates: 0,
      decoded: 0,
      missingAccounts: 0,
      invalidAccounts: 0,
      skipped: 0,
      skippedFailureCooldown: 0,
      skippedGlobalBackoff: 0,
      skippedGlobalBackoffHighCurveBypass: 0,
      globalBackoffActivations: 0,
      globalBackoffUntil: null,
      lastGlobalBackoffActivatedAt: null,
      lastGlobalBackoffErrorsInWindow: 0,
      lastGlobalBackoffWindowMs: null,
      errors: 0,
      rpcBatchErrors: 0,
      rpcSingleErrors: 0,
      errorReasonCounts: {},
      errorMethodCounts: {},
      lastErrorDiagnostic: null,
      invalidBondingCurveAddresses: 0,
      completeMintsObserved: 0,
      lastCompleteMint: null,
      lastCompleteAt: null,
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

  normalizeRpcCommitment(value) {
    const commitment = String(value || '').trim().toLowerCase();
    return ALLOWED_RPC_COMMITMENTS.has(commitment) ? commitment : 'processed';
  }

  async observeMint(mint, tokenMeta = {}, options = {}) {
    if (!this.enabled || !mint || !this.connection) {
      return null;
    }

    const forceRefresh = Boolean(options.forceRefresh);
    const now = Date.now();
    const existing = this.states.get(mint);

    const bypassGlobalBackoff = Boolean(options.bypassGlobalBackoff)
      || this.shouldBypassGlobalBackoff(existing);

    if (!bypassGlobalBackoff && this.isGlobalBackoffActive(now)) {
      this.stats.skipped += 1;
      this.stats.skippedGlobalBackoff += 1;
      this.stats.globalBackoffUntil = new Date(this.globalBackoffUntil).toISOString();
      return existing ? {
        ...this.toSummary(existing),
        refreshed: false,
        skipReason: 'GLOBAL_BACKOFF'
      } : null;
    }

    if (!options.bypassGlobalBackoff && this.isGlobalBackoffActive(now) && bypassGlobalBackoff) {
      this.stats.skippedGlobalBackoffHighCurveBypass += 1;
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
      const fetchStartedAt = Date.now();
      const bondingCurveAddress = this.deriveBondingCurveAddress(mint);
      const bondingCurveAddressBase58 = bondingCurveAddress.toBase58();
      const sentinelReason = this.validateBondingCurveAddressCandidate(bondingCurveAddressBase58);
      if (sentinelReason) {
        const fetchCompletedAt = Date.now();
        const invalidAddress = this.mergeState(mint, tokenMeta, {
          bondingCurveAddress: bondingCurveAddressBase58,
          bondingCurveValidated: false,
          bondingCurveValidationReason: sentinelReason,
          bondingCurveAccountOwner: null,
          accountFound: false,
          invalidAccountData: true,
          invalidAccountReason: sentinelReason,
          lastErrorAt: null,
          lastErrorAtIso: null,
          lastErrorMessage: null,
          lastFetchStartedAt: fetchStartedAt,
          lastFetchStartedAtIso: new Date(fetchStartedAt).toISOString(),
          lastFetchAt: fetchCompletedAt,
          lastFetchAtIso: new Date(fetchCompletedAt).toISOString(),
          fetchLatencyMs: fetchCompletedAt - fetchStartedAt
        });
        this.stats.invalidAccounts += 1;
        this.stats.invalidBondingCurveAddresses += 1;
        return {
          ...this.toSummary(invalidAddress),
          refreshed: true
        };
      }
      const accountInfo = await this.fetchBondingCurveAccount(bondingCurveAddress);
      const fetchCompletedAt = Date.now();
      this.stats.fetches += 1;
      this.noteSuccessfulFetch();

      if (!accountInfo?.data) {
        const missing = this.mergeState(mint, tokenMeta, {
          bondingCurveAddress: bondingCurveAddressBase58,
          bondingCurveValidated: false,
          bondingCurveValidationReason: 'ACCOUNT_NOT_FOUND',
          bondingCurveAccountOwner: null,
          accountFound: false,
          invalidAccountData: false,
          invalidAccountReason: null,
          lastErrorAt: null,
          lastErrorAtIso: null,
          lastErrorMessage: null,
          lastFetchStartedAt: fetchStartedAt,
          lastFetchStartedAtIso: new Date(fetchStartedAt).toISOString(),
          lastFetchAt: fetchCompletedAt,
          lastFetchAtIso: new Date(fetchCompletedAt).toISOString(),
          fetchLatencyMs: fetchCompletedAt - fetchStartedAt
        });
        this.stats.missingAccounts += 1;
        return {
          ...this.toSummary(missing),
          refreshed: true
        };
      }

      const owner = accountInfo.owner?.toBase58?.() || String(accountInfo.owner || '');
      if (owner !== this.programId.toBase58()) {
        const invalidOwner = this.mergeState(mint, tokenMeta, {
          bondingCurveAddress: bondingCurveAddressBase58,
          bondingCurveValidated: false,
          bondingCurveValidationReason: `UNEXPECTED_OWNER:${owner || 'unknown'}`,
          bondingCurveAccountOwner: owner || null,
          accountFound: true,
          invalidAccountData: true,
          invalidAccountReason: `Unexpected bonding curve owner: ${owner || 'unknown'}`,
          lastErrorAt: null,
          lastErrorAtIso: null,
          lastErrorMessage: null,
          lastFetchStartedAt: fetchStartedAt,
          lastFetchStartedAtIso: new Date(fetchStartedAt).toISOString(),
          lastFetchAt: fetchCompletedAt,
          lastFetchAtIso: new Date(fetchCompletedAt).toISOString(),
          fetchLatencyMs: fetchCompletedAt - fetchStartedAt
        });
        this.stats.invalidAccounts += 1;
        this.stats.invalidBondingCurveAddresses += 1;
        return {
          ...this.toSummary(invalidOwner),
          refreshed: true
        };
      }

      let decoded;
      try {
        decoded = this.decodeBondingCurveAccount(accountInfo.data);
      } catch (error) {
        if (!this.isInvalidBondingCurveAccountError(error)) {
          throw error;
        }

        const invalid = this.mergeState(mint, tokenMeta, {
          bondingCurveAddress: bondingCurveAddressBase58,
          bondingCurveValidated: false,
          bondingCurveValidationReason: error.message,
          bondingCurveAccountOwner: owner || null,
          accountFound: false,
          invalidAccountData: true,
          invalidAccountReason: error.message,
          lastErrorAt: null,
          lastErrorAtIso: null,
          lastErrorMessage: null,
          lastFetchStartedAt: fetchStartedAt,
          lastFetchStartedAtIso: new Date(fetchStartedAt).toISOString(),
          lastFetchAt: fetchCompletedAt,
          lastFetchAtIso: new Date(fetchCompletedAt).toISOString(),
          fetchLatencyMs: fetchCompletedAt - fetchStartedAt
        });
        this.stats.invalidAccounts += 1;
        return {
          ...this.toSummary(invalid),
          refreshed: true
        };
      }

      const next = this.mergeState(mint, tokenMeta, {
        ...decoded,
        bondingCurveAddress: bondingCurveAddressBase58,
        bondingCurveValidated: true,
        bondingCurveValidationReason: 'OWNER_AND_DISCRIMINATOR_OK',
        bondingCurveAccountOwner: owner || null,
        accountFound: true,
        invalidAccountData: false,
        invalidAccountReason: null,
        accountLamports: accountInfo.lamports,
        lastErrorAt: null,
        lastErrorAtIso: null,
        lastErrorMessage: null,
        lastFetchStartedAt: fetchStartedAt,
        lastFetchStartedAtIso: new Date(fetchStartedAt).toISOString(),
        lastFetchAt: fetchCompletedAt,
        lastFetchAtIso: new Date(fetchCompletedAt).toISOString(),
        fetchLatencyMs: fetchCompletedAt - fetchStartedAt
      });

      this.stats.decoded += 1;
      this.stats.updates += 1;
      this.stats.lastUpdateAt = next.lastFetchAtIso;
      if (next.complete && !this.completeMints.has(mint)) {
        this.completeMints.add(mint);
        this.stats.completeMintsObserved = this.completeMints.size;
        this.stats.lastCompleteMint = mint;
        this.stats.lastCompleteAt = next.lastFetchAtIso;
      }
      this.compactIfNeeded();
      this.stats.trackedMints = this.states.size;
      return {
        ...this.toSummary(next),
        refreshed: true
      };
    } catch (error) {
      const failedAt = Date.now();
      const diagnostic = this.classifyFetchError(error);
      this.stats.errors += 1;
      this.recordFetchError(diagnostic, failedAt);
      this.noteFailedFetch(failedAt);
      const failed = this.mergeState(mint, tokenMeta, {
        bondingCurveAddress: this.safeDeriveBondingCurveAddress(mint),
        lastErrorAt: failedAt,
        lastErrorAtIso: new Date(failedAt).toISOString(),
        lastErrorMessage: diagnostic.reason,
        lastErrorDiagnostic: diagnostic
      });
      this.logger?.warn?.('Pump bonding curve lookup failed', {
        mint,
        ...diagnostic
      });
      return failed ? {
        ...this.toSummary(failed),
        refreshed: false
      } : null;
    } finally {
      this.inFlight.delete(mint);
    }
  }

  fetchBondingCurveAccount(bondingCurveAddress) {
    if (!this.batchFetchEnabled || typeof this.connection.getMultipleAccountsInfo !== 'function') {
      return Promise.resolve()
        .then(() => this.connection.getAccountInfo(bondingCurveAddress, this.rpcCommitment))
        .catch((error) => {
          this.stats.rpcSingleErrors += 1;
          throw this.wrapRpcFailure(error, {
            method: 'getAccountInfo',
            batchSize: 1,
            commitment: this.rpcCommitment
          });
        });
    }

    const key = bondingCurveAddress.toBase58();
    return new Promise((resolve, reject) => {
      const existing = this.pendingAccountFetches.get(key);
      if (existing) {
        existing.requests.push({ resolve, reject });
        this.stats.batchDedupedRequests += 1;
      } else {
        this.pendingAccountFetches.set(key, {
          bondingCurveAddress,
          requests: [{ resolve, reject }]
        });
      }

      if (this.pendingAccountFetches.size >= this.batchMaxAccounts) {
        this.flushPendingAccountFetches();
        return;
      }

      this.scheduleAccountFetchBatch();
    });
  }

  scheduleAccountFetchBatch() {
    if (this.batchTimer) {
      return;
    }

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushPendingAccountFetches();
    }, this.batchFlushMs);
  }

  flushPendingAccountFetches() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (!this.pendingAccountFetches.size) {
      return;
    }

    const entries = [...this.pendingAccountFetches.entries()].slice(0, this.batchMaxAccounts);
    for (const [key] of entries) {
      this.pendingAccountFetches.delete(key);
    }

    this.executeAccountFetchBatch(entries);
  }

  async executeAccountFetchBatch(entries) {
    const addresses = entries.map(([, entry]) => entry.bondingCurveAddress);

    try {
      this.stats.rpcBatches += 1;
      this.stats.batchAccounts += addresses.length;
      const results = await this.connection.getMultipleAccountsInfo(addresses, {
        commitment: this.rpcCommitment
      });

      entries.forEach(([, entry], index) => {
        for (const request of entry.requests) {
          request.resolve(results?.[index] || null);
        }
      });
    } catch (error) {
      this.stats.rpcBatchErrors += 1;
      const wrapped = this.wrapRpcFailure(error, {
        method: 'getMultipleAccountsInfo',
        batchSize: addresses.length,
        commitment: this.rpcCommitment
      });
      for (const [, entry] of entries) {
        for (const request of entry.requests) {
          request.reject(wrapped);
        }
      }
    } finally {
      if (this.pendingAccountFetches.size) {
        this.scheduleAccountFetchBatch();
      }
    }
  }

  shouldRefresh(state, now) {
    if (this.isGlobalBackoffActive(now) && !this.shouldBypassGlobalBackoff(state)) {
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

    const existing = this.states.get(mint);
    if (this.isGlobalBackoffActive(now) && !this.shouldBypassGlobalBackoff(existing)) {
      return false;
    }

    return !existing || this.shouldRefresh(existing, now);
  }

  isGlobalBackoffActive(now) {
    return Number.isFinite(this.globalBackoffUntil) && this.globalBackoffUntil > now;
  }

  shouldBypassGlobalBackoff(state) {
    if (!state || !Number.isFinite(this.globalBackoffHighCurveBypassProgress)) {
      return false;
    }

    const curveProgress = Number(state.curveProgress);
    return Number.isFinite(curveProgress) && curveProgress >= this.globalBackoffHighCurveBypassProgress;
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

  isInvalidBondingCurveAccountError(error) {
    const message = String(error?.message || '');
    return message.startsWith('Bonding curve account too short:')
      || message.startsWith('Unexpected bonding curve discriminator:');
  }

  safeErrorType(error) {
    const name = String(error?.name || '');
    return new Set([
      'AbortError',
      'Error',
      'FetchError',
      'RangeError',
      'TypeError'
    ]).has(name) ? name : 'Error';
  }

  classifyRpcFailure(error) {
    const upstreamClasses = Array.isArray(error?.rpcFailureClasses)
      ? error.rpcFailureClasses.map((row) => row?.errorClass).filter(Boolean)
      : [];
    if (upstreamClasses.includes('rate_limit')) return 'RATE_LIMITED';
    if (upstreamClasses.includes('timeout')) return 'TIMEOUT';
    if (upstreamClasses.includes('network')) return 'NETWORK_TRANSPORT';
    if (upstreamClasses.includes('server_error')) return 'RPC_SERVER_ERROR';
    const code = String(error?.code || '');
    const status = Number(error?.status || error?.response?.status || 0);
    if (status === 429 || code === '429' || code === '-32005') return 'RATE_LIMITED';
    if (['ABORT_ERR', 'ECONNABORTED', 'ETIMEDOUT'].includes(code) || error?.name === 'AbortError') {
      return 'TIMEOUT';
    }
    if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH'].includes(code)) {
      return 'NETWORK_TRANSPORT';
    }
    if (status >= 500 || code === '-32603') return 'RPC_SERVER_ERROR';
    return 'RPC_REQUEST_FAILED';
  }

  wrapRpcFailure(error, context = {}) {
    const upstreamFailureClasses = Array.isArray(error?.rpcFailureClasses)
      ? [...new Set(error.rpcFailureClasses.map((row) => row?.errorClass).filter((value) => (
        ['timeout', 'rate_limit', 'server_error', 'network', 'rpc_error'].includes(value)
      )))]
      : [];
    const wrapped = new Error('Pump bonding curve RPC request failed');
    wrapped.name = 'PumpBondingCurveRpcError';
    wrapped.pumpBondingCurveDiagnostic = {
      reason: this.classifyRpcFailure(error),
      errorType: this.safeErrorType(error),
      method: context.method || 'unknown',
      batchSize: Number.isFinite(Number(context.batchSize)) ? Number(context.batchSize) : null,
      commitment: context.commitment || this.rpcCommitment,
      upstreamFailureClasses
    };
    return wrapped;
  }

  classifyFetchError(error) {
    const rpcDiagnostic = error?.pumpBondingCurveDiagnostic;
    if (rpcDiagnostic) return { ...rpcDiagnostic };
    return {
      reason: 'LOCAL_CURVE_PROCESSING_ERROR',
      errorType: this.safeErrorType(error),
      method: 'local',
      batchSize: null,
      commitment: this.rpcCommitment
    };
  }

  recordFetchError(diagnostic, atMs) {
    const reason = diagnostic.reason || 'UNKNOWN';
    const method = diagnostic.method || 'unknown';
    this.stats.errorReasonCounts[reason] = (this.stats.errorReasonCounts[reason] || 0) + 1;
    this.stats.errorMethodCounts[method] = (this.stats.errorMethodCounts[method] || 0) + 1;
    this.stats.lastErrorDiagnostic = {
      at: new Date(atMs).toISOString(),
      ...diagnostic
    };
  }

  validateBondingCurveAddressCandidate(address) {
    if (!address) {
      return 'MISSING_BONDING_CURVE_ADDRESS';
    }

    if (SENTINEL_NON_BONDING_CURVE_ADDRESSES.has(address)) {
      return `SENTINEL_NON_BONDING_CURVE_ADDRESS:${address}`;
    }

    try {
      new PublicKey(address);
      return null;
    } catch (_) {
      return `INVALID_BONDING_CURVE_ADDRESS:${address}`;
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
    const curveProgressByVirtualTokenReserves = this.computeVirtualReserveCurveProgress({
      complete,
      virtualTokenReservesTokens
    });
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
      curveProgressByRealTokenSupply: curveProgress,
      curveProgressByVirtualTokenReserves,
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

  computeVirtualReserveCurveProgress({ complete, virtualTokenReservesTokens }) {
    if (complete) {
      return 1;
    }

    const virtualTokens = Number(virtualTokenReservesTokens);
    if (!Number.isFinite(virtualTokens) || virtualTokens <= 0) {
      return null;
    }

    const realTokenReservesTokens = virtualTokens - PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET;
    const progress = 1 - (realTokenReservesTokens / PUMP_TOKEN_TOTAL_SUPPLY);
    return Number(clamp(progress, 0, 1).toFixed(6));
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
      bondingCurveValidated: state.bondingCurveValidated === true,
      bondingCurveValidationReason: state.bondingCurveValidationReason || null,
      bondingCurveAccountOwner: state.bondingCurveAccountOwner || null,
      accountFound: Boolean(state.accountFound),
      complete: Boolean(state.complete),
      bondingStage: state.bondingStage || null,
      curveProgress: state.curveProgress ?? null,
      invalidAccountData: Boolean(state.invalidAccountData),
      invalidAccountReason: state.invalidAccountReason || null,
      virtualSolReservesSol: state.virtualSolReservesSol ?? null,
      realSolReservesSol: state.realSolReservesSol ?? null,
      virtualTokenReservesTokens: state.virtualTokenReservesTokens ?? null,
      curveProgressByRealTokenSupply: state.curveProgressByRealTokenSupply ?? state.curveProgress ?? null,
      curveProgressByVirtualTokenReserves: state.curveProgressByVirtualTokenReserves ?? null,
      virtualTokenReserves: state.virtualTokenReserves ?? null,
      virtualSolReserves: state.virtualSolReserves ?? null,
      realTokenReserves: state.realTokenReserves ?? null,
      realSolReserves: state.realSolReserves ?? null,
      tokenTotalSupply: state.tokenTotalSupply ?? null,
      priceSol: state.priceSol ?? null,
      creator: state.creator || null,
      isMayhemMode: Boolean(state.isMayhemMode),
      lastErrorAt: state.lastErrorAtIso || null,
      lastErrorMessage: state.lastErrorMessage || null,
      lastErrorDiagnostic: state.lastErrorDiagnostic || null,
      lastFetchStartedAt: state.lastFetchStartedAtIso || null,
      lastFetchAt: state.lastFetchAtIso || null,
      fetchLatencyMs: state.fetchLatencyMs ?? null
    };
  }

  getStats() {
    return {
      ...this.stats,
      batchFetchEnabled: this.batchFetchEnabled,
      batchFlushMs: this.batchFlushMs,
      batchMaxAccounts: this.batchMaxAccounts,
      rpcCommitment: this.rpcCommitment,
      trackedMints: this.states.size,
      inFlight: this.inFlight.size,
      pendingAccountFetches: this.pendingAccountFetches.size,
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
