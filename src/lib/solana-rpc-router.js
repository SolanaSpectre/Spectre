const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { Connection, PublicKey } = require('@solana/web3.js');

class SolanaRpcRouter {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.primaryDowngradeMs = Number.isFinite(config.solanaRpcPrimaryDowngradeMs)
      ? Math.max(config.solanaRpcPrimaryDowngradeMs, 30000)
      : 300000;
    this.fallbackDowngradeMs = Number.isFinite(config.solanaRpcFallbackDowngradeMs)
      ? Math.max(config.solanaRpcFallbackDowngradeMs, 1000)
      : 300000;
    this.primaryFailureThreshold = Number.isFinite(config.solanaRpcPrimaryFailureThreshold)
      ? Math.max(1, Math.floor(config.solanaRpcPrimaryFailureThreshold))
      : 2;
    this.fallbackFailureThreshold = Number.isFinite(config.solanaRpcFallbackFailureThreshold)
      ? Math.max(1, Math.floor(config.solanaRpcFallbackFailureThreshold))
      : 2;
    this.sameVendorFallbackEnabled = config.solanaRpcSameVendorFallbackEnabled === true;
    this.accountInfoCacheTtlMs = Number.isFinite(config.solanaRpcAccountInfoCacheTtlMs)
      ? Math.max(0, Math.floor(config.solanaRpcAccountInfoCacheTtlMs))
      : 3000;
    this.maxConcurrentRequests = Number.isFinite(config.solanaRpcMaxConcurrentRequests)
      ? Math.max(1, Math.floor(config.solanaRpcMaxConcurrentRequests))
      : 2;
    this.minRequestIntervalMs = Number.isFinite(config.solanaRpcMinRequestIntervalMs)
      ? Math.max(0, Math.floor(config.solanaRpcMinRequestIntervalMs))
      : 150;
    this.callTimeoutMs = Number.isFinite(config.solanaRpcCallTimeoutMs)
      ? Math.max(1000, Math.floor(config.solanaRpcCallTimeoutMs))
      : 10000;
    this.httpAgentMode = this.normalizeHttpAgentMode(config.solanaRpcHttpAgentMode);
    this.accountReadTransport = this.normalizeAccountReadTransport(config.solanaRpcAccountReadTransport);
    this.accountReadUrl = String(config.solanaRpcAccountReadUrl || '').trim() || null;
    this.childRpcScript = path.join(__dirname, '..', '..', 'scripts', 'rpc-account-read-worker.js');
    this.httpAgentConfig = {
      keepAliveMsecs: Number.isFinite(config.solanaRpcHttpAgentKeepAliveMsecs)
        ? Math.max(1, Math.floor(config.solanaRpcHttpAgentKeepAliveMsecs))
        : 1000,
      maxSockets: Number.isFinite(config.solanaRpcHttpAgentMaxSockets)
        ? Math.max(1, Math.floor(config.solanaRpcHttpAgentMaxSockets))
        : 16,
      maxFreeSockets: Number.isFinite(config.solanaRpcHttpAgentMaxFreeSockets)
        ? Math.max(0, Math.floor(config.solanaRpcHttpAgentMaxFreeSockets))
        : 8,
      timeoutMs: Number.isFinite(config.solanaRpcHttpAgentTimeoutMs)
        ? Math.max(1000, Math.floor(config.solanaRpcHttpAgentTimeoutMs))
        : 5000,
      scheduling: String(config.solanaRpcHttpAgentScheduling || 'lifo').toLowerCase() === 'fifo' ? 'fifo' : 'lifo'
    };
    this.httpAgent = this.createHttpAgent();
    this.primaryDegradedUntil = 0;
    this.lastPrimaryFailureAt = null;
    this.lastPrimaryFailureReason = null;
    this.lastFallbackSuccessAt = null;
    this.fallbackDegradedUntil = 0;
    this.lastFallbackFailureAt = null;
    this.lastFallbackFailureReason = null;
    this.lastRecoveryAt = null;
    this.primaryFailureStreak = 0;
    this.fallbackFailureStreak = 0;
    this.primaryDowngradeLevel = 0;
    this.fallbackDowngradeLevel = 0;
    this.activeRequests = 0;
    this.queue = [];
    this.lastRequestStartedAt = 0;
    this.queueTimer = null;
    this.accountInfoCache = new Map();
    this.accountInfoInFlight = new Map();
    this.telemetryHook = null;
    this.callSequence = 0;
    this.stats = {
      primaryCalls: 0,
      fallbackCalls: 0,
      primaryFailures: 0,
      fallbackSuccesses: 0,
      fallbackFailures: 0,
      fallbackDegradations: 0,
      primaryDegradations: 0,
      primaryFailuresSuppressed: 0,
      fallbackFailuresSuppressed: 0,
      failureClasses: {},
      recoveries: 0,
      queuedCalls: 0,
      maxQueueDepth: 0,
      callTelemetryStarted: 0,
      callTelemetryCompleted: 0,
      callTelemetryFailed: 0,
      accountInfoCacheHits: 0,
      accountInfoInFlightHits: 0,
      accountInfoCacheWrites: 0
    };

    this.primary = this.createTarget('primary', config.solanaRpcUrl, config.solanaRpcWebsocketUrl);
    this.fallback = this.shouldEnableFallback(config)
      ? this.createTarget('fallback', config.solanaRpcFallback, config.solanaRpcFallbackWebsocketUrl)
      : null;
  }

  normalizeHttpAgentMode(value) {
    const mode = String(value || 'keepalive').trim().toLowerCase();
    if (mode === 'default' || mode === 'false' || mode === 'keepalive') {
      return mode;
    }
    return 'keepalive';
  }

  normalizeAccountReadTransport(value) {
    const mode = String(value || 'web3').trim().toLowerCase();
    if (
      mode === 'web3'
      || mode === 'raw-fetch'
      || mode === 'native-https'
      || mode === 'node-https'
      || mode === 'child-https'
      || mode === 'child-native-https'
    ) {
      if (mode === 'node-https') return 'native-https';
      if (mode === 'child-native-https') return 'child-https';
      return mode;
    }
    return 'web3';
  }

  createHttpAgent() {
    if (this.httpAgentMode === 'default') {
      return null;
    }

    if (this.httpAgentMode === 'false') {
      return false;
    }

    return new https.Agent({
      keepAlive: true,
      keepAliveMsecs: this.httpAgentConfig.keepAliveMsecs,
      maxSockets: this.httpAgentConfig.maxSockets,
      maxFreeSockets: this.httpAgentConfig.maxFreeSockets,
      timeout: this.httpAgentConfig.timeoutMs,
      scheduling: this.httpAgentConfig.scheduling
    });
  }

  shouldEnableFallback(config) {
    const fallbackUrl = String(config.solanaRpcFallback || '').trim();
    const primaryUrl = String(config.solanaRpcUrl || '').trim();
    if (!fallbackUrl || fallbackUrl === primaryUrl) {
      return false;
    }
    const sameVendor = this.endpointIdentity(primaryUrl) === this.endpointIdentity(fallbackUrl);
    return !sameVendor || this.sameVendorFallbackEnabled;
  }

  endpointIdentity(endpoint) {
    if (!endpoint) return null;
    try {
      const parsed = new URL(endpoint);
      const host = parsed.hostname || '';
      if (host.endsWith('helius-rpc.com')) return 'helius-rpc.com';
      if (host === 'api.mainnet-beta.solana.com' || host === 'api.devnet.solana.com') return 'public-solana';
      return host;
    } catch {
      return String(endpoint || '').trim() || null;
    }
  }

  isSameVendorFallback() {
    if (!this.fallback) return false;
    return this.endpointIdentity(this.primary.httpUrl) === this.endpointIdentity(this.fallback.httpUrl);
  }

  createTarget(label, httpUrl, wsUrl) {
    const connectionConfig = {
      commitment: 'confirmed'
    };

    if (wsUrl) {
      connectionConfig.wsEndpoint = wsUrl;
    }

    if (this.httpAgent !== null) {
      connectionConfig.httpAgent = this.httpAgent;
    }

    return {
      label,
      httpUrl,
      wsUrl: wsUrl || null,
      connection: new Connection(httpUrl, connectionConfig)
    };
  }

  redactEndpoint(endpoint) {
    if (!endpoint) {
      return null;
    }

    try {
      const parsed = new URL(endpoint);
      const host = parsed.hostname || '';
      let provider = 'custom-rpc';
      if (host === 'api.mainnet-beta.solana.com' || host === 'api.devnet.solana.com') {
        provider = 'public-solana';
      } else if (host.endsWith('helius-rpc.com')) {
        provider = 'helius-rpc.com';
      } else if (host.endsWith('getblock.io')) {
        provider = 'getblock.io';
      }

      return {
        protocol: parsed.protocol.replace(':', ''),
        provider,
        hasPath: Boolean(parsed.pathname && parsed.pathname !== '/'),
        hasQuery: Boolean(parsed.search),
        redacted: `${parsed.protocol}//${provider}${parsed.pathname && parsed.pathname !== '/' ? '/...' : ''}${parsed.search ? '?<redacted>' : ''}`
      };
    } catch {
      return {
        protocol: null,
        provider: '<invalid-or-non-url>',
        hasPath: false,
        hasQuery: false,
        redacted: '<redacted>'
      };
    }
  }

  getStatus() {
    return {
      primary: {
        httpUrl: this.redactEndpoint(this.primary.httpUrl),
        wsUrl: this.redactEndpoint(this.primary.wsUrl)
      },
      fallback: this.fallback
        ? {
            httpUrl: this.redactEndpoint(this.fallback.httpUrl),
            wsUrl: this.redactEndpoint(this.fallback.wsUrl)
          }
        : null,
      primaryDegraded: Date.now() < this.primaryDegradedUntil,
      primaryDegradedUntil: this.primaryDegradedUntil ? new Date(this.primaryDegradedUntil).toISOString() : null,
      fallbackDegraded: Date.now() < this.fallbackDegradedUntil,
      fallbackDegradedUntil: this.fallbackDegradedUntil ? new Date(this.fallbackDegradedUntil).toISOString() : null,
      lastPrimaryFailureAt: this.lastPrimaryFailureAt,
      lastPrimaryFailureReason: this.lastPrimaryFailureReason,
      lastFallbackFailureAt: this.lastFallbackFailureAt,
      lastFallbackFailureReason: this.lastFallbackFailureReason,
      lastFallbackSuccessAt: this.lastFallbackSuccessAt,
      lastRecoveryAt: this.lastRecoveryAt,
      queue: {
        active: this.activeRequests,
        pending: this.queue.length,
        maxConcurrentRequests: this.maxConcurrentRequests,
        minRequestIntervalMs: this.minRequestIntervalMs,
        callTimeoutMs: this.callTimeoutMs,
        accountInfoCacheTtlMs: this.accountInfoCacheTtlMs,
        accountInfoCacheSize: this.accountInfoCache.size,
        accountInfoInFlight: this.accountInfoInFlight.size
      },
      circuitBreaker: {
        primaryFailureStreak: this.primaryFailureStreak,
        fallbackFailureStreak: this.fallbackFailureStreak,
        primaryFailureThreshold: this.primaryFailureThreshold,
        fallbackFailureThreshold: this.fallbackFailureThreshold,
        primaryDowngradeLevel: this.primaryDowngradeLevel,
        fallbackDowngradeLevel: this.fallbackDowngradeLevel,
        sameVendorFallback: this.isSameVendorFallback(),
        sameVendorFallbackEnabled: this.sameVendorFallbackEnabled
      },
      stats: {
        ...this.stats,
        failureClasses: { ...this.stats.failureClasses }
      },
      transport: {
        httpAgentMode: this.httpAgentMode,
        accountReadTransport: this.accountReadTransport,
        accountReadUrl: this.accountReadUrl ? this.redactEndpoint(this.accountReadUrl) : null,
        httpAgentConfigured: this.httpAgent !== null,
        ...this.httpAgentConfig
      }
    };
  }

  setTelemetryHook(hook) {
    this.telemetryHook = typeof hook === 'function' ? hook : null;
  }

  getSubscriptionConnection() {
    return this.primary?.connection || null;
  }

  emitTelemetry(type, payload = {}) {
    if (!this.telemetryHook) {
      return;
    }

    try {
      this.telemetryHook(type, payload);
    } catch {
      // RPC telemetry is report-only and must never affect RPC behavior.
    }
  }

  summarizeCallArgs(methodName, args = []) {
    const first = args[0];
    const second = args[1];
    const pubkeys = Array.isArray(first) ? first : first ? [first] : [];
    const commitment = typeof second === 'string'
      ? second
      : second?.commitment || null;

    return {
      methodName,
      commitment,
      pubkeyCount: pubkeys.length,
      firstPubkey: pubkeys[0]?.toBase58?.() || (pubkeys[0] ? String(pubkeys[0]) : null)
    };
  }

  clearQueue(reason = 'CLEARED') {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }

    if (!this.queue.length) {
      return 0;
    }

    const queued = this.queue.splice(0);
    const error = new Error(`Solana RPC queue cleared: ${reason}`);
    for (const item of queued) {
      item.reject(error);
    }
    return queued.length;
  }

  getPreferredTargets() {
    if (!this.fallback) {
      return [this.primary];
    }

    const now = Date.now();
    const primaryDegraded = now < this.primaryDegradedUntil;
    const fallbackDegraded = now < this.fallbackDegradedUntil;
    const sameVendorFallback = this.isSameVendorFallback();

    if (primaryDegraded && !fallbackDegraded) {
      if (sameVendorFallback) {
        return [this.primary, this.fallback];
      }
      return [this.fallback];
    }

    if (primaryDegraded && fallbackDegraded) {
      return [this.primary];
    }

    if (fallbackDegraded) {
      return [this.primary];
    }

    return [this.primary, this.fallback];
  }

  markPrimaryFailure(error) {
    this.lastPrimaryFailureAt = new Date().toISOString();
    this.lastPrimaryFailureReason = error?.message || String(error || 'unknown error');
    this.stats.primaryFailures += 1;
    this.primaryFailureStreak += 1;
    this.recordFailureClass('primary', error);

    if (this.primaryFailureStreak < this.primaryFailureThreshold) {
      this.stats.primaryFailuresSuppressed += 1;
      this.logger?.warn?.('Primary Solana RPC failed; keeping primary preferred until threshold', {
        reason: this.lastPrimaryFailureReason,
        failureStreak: this.primaryFailureStreak,
        failureThreshold: this.primaryFailureThreshold,
        primaryHttpUrl: this.redactEndpoint(this.primary.httpUrl),
        fallbackHttpUrl: this.redactEndpoint(this.fallback?.httpUrl || null)
      });
      return false;
    }

    this.primaryDowngradeLevel = Math.min(this.primaryDowngradeLevel + 1, 3);
    const downgradeMs = this.scaledDowngradeMs(this.primaryDowngradeMs, this.primaryDowngradeLevel);
    this.primaryDegradedUntil = Date.now() + downgradeMs;
    this.stats.primaryDegradations += 1;
    this.logger?.warn?.('Primary Solana RPC failed; degrading after failure threshold', {
      reason: this.lastPrimaryFailureReason,
      failureStreak: this.primaryFailureStreak,
      failureThreshold: this.primaryFailureThreshold,
      primaryHttpUrl: this.redactEndpoint(this.primary.httpUrl),
      fallbackHttpUrl: this.redactEndpoint(this.fallback?.httpUrl || null),
      sameVendorFallback: this.isSameVendorFallback(),
      degradedForMs: downgradeMs
    });
    return true;
  }

  markPrimaryRecovery() {
    if (this.primaryDegradedUntil > 0 || this.primaryFailureStreak > 0) {
      this.lastRecoveryAt = new Date().toISOString();
      this.stats.recoveries += 1;
      this.logger?.info?.('Primary Solana RPC recovered');
    }

    this.primaryDegradedUntil = 0;
    this.primaryFailureStreak = 0;
    this.primaryDowngradeLevel = 0;
  }

  enqueue(work, meta = {}) {
    return new Promise((resolve, reject) => {
      meta.enqueuedAt = Date.now();
      this.queue.push({
        work,
        resolve,
        reject,
        meta
      });
      this.stats.queuedCalls += 1;
      this.stats.maxQueueDepth = Math.max(this.stats.maxQueueDepth, this.queue.length);
      this.processQueue();
    });
  }

  markFallbackFailure(error) {
    this.lastFallbackFailureAt = new Date().toISOString();
    this.lastFallbackFailureReason = error?.message || String(error || 'unknown error');
    this.stats.fallbackFailures += 1;
    this.fallbackFailureStreak += 1;
    this.recordFailureClass('fallback', error);

    if (this.fallbackFailureStreak < this.fallbackFailureThreshold) {
      this.stats.fallbackFailuresSuppressed += 1;
      this.logger?.warn?.('Fallback Solana RPC failed; keeping fallback available until threshold', {
        reason: this.lastFallbackFailureReason,
        failureStreak: this.fallbackFailureStreak,
        failureThreshold: this.fallbackFailureThreshold,
        fallbackHttpUrl: this.redactEndpoint(this.fallback?.httpUrl || null)
      });
      return false;
    }

    this.fallbackDowngradeLevel = Math.min(this.fallbackDowngradeLevel + 1, 3);
    const downgradeMs = this.scaledDowngradeMs(this.fallbackDowngradeMs, this.fallbackDowngradeLevel);
    this.fallbackDegradedUntil = Date.now() + downgradeMs;
    this.stats.fallbackDegradations += 1;
    this.logger?.warn?.('Fallback Solana RPC failed; temporarily suppressing fallback', {
      reason: this.lastFallbackFailureReason,
      failureStreak: this.fallbackFailureStreak,
      failureThreshold: this.fallbackFailureThreshold,
      fallbackHttpUrl: this.redactEndpoint(this.fallback?.httpUrl || null),
      degradedForMs: downgradeMs
    });
    return true;
  }

  markFallbackSuccess() {
    this.fallbackDegradedUntil = 0;
    this.lastFallbackSuccessAt = new Date().toISOString();
    this.fallbackFailureStreak = 0;
    this.fallbackDowngradeLevel = 0;
    this.stats.fallbackSuccesses += 1;
  }

  classifyFailure(error) {
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('timed out') || message.includes('timeout') || message.includes('abort')) return 'timeout';
    if (message.includes('429') || message.includes('too many requests') || message.includes('rate limit')) return 'rate_limit';
    if (/(^|\D)5\d\d(\D|$)/.test(message)) return 'server_error';
    if (message.includes('fetch failed') || message.includes('network') || message.includes('econn') || message.includes('enotfound') || message.includes('etimedout')) return 'network';
    return 'rpc_error';
  }

  recordFailureClass(label, error) {
    const klass = this.classifyFailure(error);
    const key = `${label}.${klass}`;
    this.stats.failureClasses[key] = (this.stats.failureClasses[key] || 0) + 1;
  }

  scaledDowngradeMs(baseMs, level) {
    const base = Math.max(1000, Number(baseMs || 0));
    const exponent = Math.max(0, Number(level || 1) - 1);
    return Math.min(300000, Math.floor(base * (2 ** exponent)));
  }

  processQueue() {
    if (this.queueTimer) {
      return;
    }

    if (!this.queue.length || this.activeRequests >= this.maxConcurrentRequests) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastRequestStartedAt;
    const waitMs = this.minRequestIntervalMs > 0
      ? Math.max(0, this.minRequestIntervalMs - elapsed)
      : 0;

    if (waitMs > 0) {
      this.queueTimer = setTimeout(() => {
        this.queueTimer = null;
        this.processQueue();
      }, waitMs);
      return;
    }

    while (this.queue.length && this.activeRequests < this.maxConcurrentRequests) {
      const item = this.queue.shift();
      const activeBeforeStart = this.activeRequests;
      this.activeRequests += 1;
      this.lastRequestStartedAt = Date.now();
      item.meta.startedAt = this.lastRequestStartedAt;
      item.meta.queueWaitMs = Number.isFinite(item.meta.enqueuedAt)
        ? this.lastRequestStartedAt - item.meta.enqueuedAt
        : null;
      item.meta.activeRequestsBeforeStart = activeBeforeStart;
      item.meta.pendingQueueDepthAtStart = this.queue.length;

      Promise.resolve()
        .then(item.work)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.activeRequests -= 1;
          this.processQueue();
        });

      if (this.minRequestIntervalMs > 0) {
        break;
      }
    }
  }

  async executeCall(methodName, args = [], meta = {}) {
    const targets = this.getPreferredTargets();
    const failures = [];
    const failureDiagnostics = [];
    const callId = `${Date.now()}-${++this.callSequence}`;
    const callSummary = this.summarizeCallArgs(methodName, args);

    for (const target of targets) {
      const targetStartedAt = Date.now();
      const baseTelemetry = {
        callId,
        target: target.label,
        targetProvider: this.redactEndpoint(target.httpUrl)?.provider || null,
        methodName,
        commitment: callSummary.commitment,
        pubkeyCount: callSummary.pubkeyCount,
        firstPubkey: callSummary.firstPubkey,
        queueWaitMs: meta.queueWaitMs ?? null,
        activeRequestsBeforeStart: meta.activeRequestsBeforeStart ?? null,
        pendingQueueDepthAtStart: meta.pendingQueueDepthAtStart ?? null,
        callTimeoutMs: this.callTimeoutMs,
        primaryDegraded: Date.now() < this.primaryDegradedUntil,
        fallbackDegraded: Date.now() < this.fallbackDegradedUntil
      };

      try {
        if (target.label === 'primary') {
          this.stats.primaryCalls += 1;
        } else {
          this.stats.fallbackCalls += 1;
        }

        this.stats.callTelemetryStarted += 1;
        this.emitTelemetry('solana_rpc.call_started', {
          ...baseTelemetry,
          startedAt: new Date(targetStartedAt).toISOString()
        });

        const result = await this.withTimeout(
          this.executeTargetMethod(target, methodName, args),
          this.callTimeoutMs,
          `${target.label}.${methodName}`
        );

        if (target.label === 'primary') {
          this.markPrimaryRecovery();
        } else {
          this.markFallbackSuccess();
        }

        const latencyMs = Date.now() - targetStartedAt;
        this.stats.callTelemetryCompleted += 1;
        this.emitTelemetry('solana_rpc.call_completed', {
          ...baseTelemetry,
          latencyMs,
          completedAt: new Date().toISOString(),
          resultCount: Array.isArray(result) ? result.filter(Boolean).length : result ? 1 : 0
        });

        return result;
      } catch (error) {
        const latencyMs = Date.now() - targetStartedAt;
        failures.push(`${target.label}:${error?.message || String(error || 'unknown error')}`);
        failureDiagnostics.push({
          target: target.label,
          errorClass: this.classifyFailure(error)
        });
        this.stats.callTelemetryFailed += 1;
        this.emitTelemetry('solana_rpc.call_failed', {
          ...baseTelemetry,
          latencyMs,
          failedAt: new Date().toISOString(),
          errorClass: this.classifyFailure(error),
          errorMessage: error?.message || String(error || 'unknown error')
        });

        if (target.label === 'primary') {
          if (this.fallback) {
            this.markPrimaryFailure(error);
            continue;
          }
          this.markPrimaryFailure(error);
        }

        if (target.label === 'fallback') {
          this.markFallbackFailure(error);
        }
      }
    }

    const terminalError = new Error(`Solana RPC ${methodName} failed across all configured endpoints: ${failures.join(' | ')}`);
    terminalError.name = 'SolanaRpcRouteError';
    terminalError.rpcMethod = methodName;
    terminalError.rpcFailureClasses = failureDiagnostics;
    throw terminalError;
  }

  executeTargetMethod(target, methodName, args = []) {
    if (
      this.accountReadTransport === 'raw-fetch'
      || this.accountReadTransport === 'native-https'
      || this.accountReadTransport === 'child-https'
    ) {
      if (methodName === 'getMultipleAccountsInfo') {
        return this.rawGetMultipleAccountsInfo(target, args);
      }
      if (methodName === 'getAccountInfo') {
        return this.rawGetAccountInfo(target, args);
      }
    }

    return target.connection[methodName](...args);
  }

  async rawRpc(target, rpcMethod, params) {
    if (this.accountReadTransport === 'child-https') {
      return this.childHttpsRpc(target, rpcMethod, params);
    }

    if (this.accountReadTransport === 'native-https') {
      return this.nativeHttpsRpc(target, rpcMethod, params);
    }

    if (typeof fetch !== 'function') {
      throw new Error('raw fetch transport unavailable: global fetch is not defined');
    }

    const response = await fetch(this.accountReadUrl || target.httpUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `${Date.now()}-${++this.callSequence}`,
        method: rpcMethod,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`raw ${rpcMethod} HTTP ${response.status}`);
    }

    const payload = await response.json();
    if (payload?.error) {
      const message = payload.error.message || JSON.stringify(payload.error);
      throw new Error(`raw ${rpcMethod} RPC error: ${message}`);
    }

    return payload?.result;
  }

  nativeHttpsRpc(target, rpcMethod, params) {
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(this.accountReadUrl || target.httpUrl);
      } catch (error) {
        reject(new Error(`native ${rpcMethod} invalid URL: ${error.message}`));
        return;
      }

      if (parsed.protocol !== 'https:') {
        reject(new Error(`native ${rpcMethod} only supports https RPC URLs`));
        return;
      }

      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: `${Date.now()}-${++this.callSequence}`,
        method: rpcMethod,
        params
      });

      const request = https.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname || '/'}${parsed.search || ''}`,
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        }
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`native ${rpcMethod} HTTP ${response.statusCode}: ${text.slice(0, 200)}`));
            return;
          }

          let payload;
          try {
            payload = JSON.parse(text);
          } catch (error) {
            reject(new Error(`native ${rpcMethod} invalid JSON: ${error.message}`));
            return;
          }

          if (payload?.error) {
            const message = payload.error.message || JSON.stringify(payload.error);
            reject(new Error(`native ${rpcMethod} RPC error: ${message}`));
            return;
          }

          resolve(payload?.result);
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.setTimeout(this.callTimeoutMs, () => {
        request.destroy(new Error(`native ${rpcMethod} socket timed out after ${this.callTimeoutMs}ms`));
      });

      request.end(body);
    });
  }

  childHttpsRpc(target, rpcMethod, params) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.childRpcScript], {
        cwd: path.join(__dirname, '..', '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const cleanup = () => {
        child.stdout?.removeAllListeners();
        child.stderr?.removeAllListeners();
        child.removeAllListeners();
      };

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };

      const timer = setTimeout(() => {
        child.kill();
        finish(new Error(`child ${rpcMethod} timed out after ${this.callTimeoutMs}ms`));
      }, this.callTimeoutMs);
      if (typeof timer.unref === 'function') timer.unref();

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        finish(error);
      });
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(new Error(`child ${rpcMethod} exited ${code}: ${stderr.slice(0, 300)}`));
          return;
        }

        try {
          const payload = JSON.parse(stdout);
          if (payload?.error) {
            finish(new Error(payload.error));
            return;
          }
          finish(null, payload.result);
        } catch (error) {
          finish(new Error(`child ${rpcMethod} invalid JSON: ${error.message}`));
        }
      });

      child.stdin.end(JSON.stringify({
        url: this.accountReadUrl || target.httpUrl,
        method: rpcMethod,
        params,
        timeoutMs: this.callTimeoutMs
      }));
    });
  }

  rawCommitmentConfig(configOrCommitment) {
    if (typeof configOrCommitment === 'string') {
      return { commitment: configOrCommitment, encoding: 'base64' };
    }

    return {
      ...(configOrCommitment || {}),
      encoding: 'base64'
    };
  }

  decodeRawAccountInfo(raw) {
    if (!raw) {
      return null;
    }

    const encoded = Array.isArray(raw.data) ? raw.data[0] : raw.data;
    return {
      data: Buffer.from(encoded || '', 'base64'),
      executable: Boolean(raw.executable),
      lamports: raw.lamports,
      owner: new PublicKey(raw.owner),
      rentEpoch: raw.rentEpoch
    };
  }

  async rawGetMultipleAccountsInfo(target, args = []) {
    const pubkeys = Array.isArray(args[0]) ? args[0] : [];
    const config = this.rawCommitmentConfig(args[1]);
    const result = await this.rawRpc(target, 'getMultipleAccounts', [
      pubkeys.map((pubkey) => pubkey.toBase58?.() || String(pubkey)),
      config
    ]);

    return (result?.value || []).map((account) => this.decodeRawAccountInfo(account));
  }

  async rawGetAccountInfo(target, args = []) {
    const pubkey = args[0];
    const config = this.rawCommitmentConfig(args[1]);
    const result = await this.rawRpc(target, 'getAccountInfo', [
      pubkey.toBase58?.() || String(pubkey),
      config
    ]);

    return this.decodeRawAccountInfo(result?.value || null);
  }

  withTimeout(promise, timeoutMs, label) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return promise;
    }

    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    });

    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  async call(methodName, args = []) {
    const meta = {
      methodName,
      ...this.summarizeCallArgs(methodName, args)
    };
    return this.enqueue(() => this.executeCall(methodName, args, meta), meta);
  }

  accountInfoCacheKey(args = []) {
    const publicKey = args[0];
    const commitmentOrConfig = args[1];
    const key = typeof publicKey?.toBase58 === 'function'
      ? publicKey.toBase58()
      : String(publicKey || '');
    const commitment = typeof commitmentOrConfig === 'string'
      ? commitmentOrConfig
      : JSON.stringify(commitmentOrConfig || {});
    return `${key}:${commitment}`;
  }

  pruneAccountInfoCache(now = Date.now()) {
    for (const [key, entry] of this.accountInfoCache.entries()) {
      if (!entry || Number(entry.expiresAt || 0) <= now) {
        this.accountInfoCache.delete(key);
      }
    }
  }

  getVersion() {
    return this.call('getVersion');
  }

  getBalance(...args) {
    return this.call('getBalance', args);
  }

  getParsedTokenAccountsByOwner(...args) {
    return this.call('getParsedTokenAccountsByOwner', args);
  }

  getLatestBlockhash(...args) {
    return this.call('getLatestBlockhash', args);
  }

  sendRawTransaction(...args) {
    return this.call('sendRawTransaction', args);
  }

  confirmTransaction(...args) {
    return this.call('confirmTransaction', args);
  }

  getAccountInfo(...args) {
    if (this.accountInfoCacheTtlMs <= 0) {
      return this.call('getAccountInfo', args);
    }

    const now = Date.now();
    const key = this.accountInfoCacheKey(args);
    this.pruneAccountInfoCache(now);
    const cached = this.accountInfoCache.get(key);
    if (cached && cached.expiresAt > now) {
      this.stats.accountInfoCacheHits += 1;
      return Promise.resolve(cached.value);
    }

    const inFlight = this.accountInfoInFlight.get(key);
    if (inFlight) {
      this.stats.accountInfoInFlightHits += 1;
      return inFlight;
    }

    const promise = this.call('getAccountInfo', args)
      .then((value) => {
        this.accountInfoCache.set(key, {
          value,
          expiresAt: Date.now() + this.accountInfoCacheTtlMs
        });
        this.stats.accountInfoCacheWrites += 1;
        return value;
      })
      .finally(() => {
        this.accountInfoInFlight.delete(key);
      });
    this.accountInfoInFlight.set(key, promise);
    return promise;
  }

  getMultipleAccountsInfo(...args) {
    return this.call('getMultipleAccountsInfo', args);
  }

  simulateTransaction(...args) {
    return this.call('simulateTransaction', args);
  }
}

module.exports = SolanaRpcRouter;
