const { Connection } = require('@solana/web3.js');

class SolanaRpcRouter {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.primaryDowngradeMs = Number.isFinite(config.solanaRpcPrimaryDowngradeMs)
      ? Math.max(config.solanaRpcPrimaryDowngradeMs, 30000)
      : 300000;
    this.maxConcurrentRequests = Number.isFinite(config.solanaRpcMaxConcurrentRequests)
      ? Math.max(1, Math.floor(config.solanaRpcMaxConcurrentRequests))
      : 2;
    this.minRequestIntervalMs = Number.isFinite(config.solanaRpcMinRequestIntervalMs)
      ? Math.max(0, Math.floor(config.solanaRpcMinRequestIntervalMs))
      : 150;
    this.primaryDegradedUntil = 0;
    this.lastPrimaryFailureAt = null;
    this.lastPrimaryFailureReason = null;
    this.lastFallbackSuccessAt = null;
    this.lastRecoveryAt = null;
    this.activeRequests = 0;
    this.queue = [];
    this.lastRequestStartedAt = 0;
    this.queueTimer = null;
    this.stats = {
      primaryCalls: 0,
      fallbackCalls: 0,
      primaryFailures: 0,
      fallbackSuccesses: 0,
      fallbackFailures: 0,
      recoveries: 0,
      queuedCalls: 0,
      maxQueueDepth: 0
    };

    this.primary = this.createTarget('primary', config.solanaRpcUrl, config.solanaRpcWebsocketUrl);
    this.fallback = this.shouldEnableFallback(config)
      ? this.createTarget('fallback', config.solanaRpcFallback, config.solanaRpcFallbackWebsocketUrl)
      : null;
  }

  shouldEnableFallback(config) {
    const fallbackUrl = String(config.solanaRpcFallback || '').trim();
    const primaryUrl = String(config.solanaRpcUrl || '').trim();
    return Boolean(fallbackUrl && fallbackUrl !== primaryUrl);
  }

  createTarget(label, httpUrl, wsUrl) {
    const connectionConfig = {
      commitment: 'confirmed'
    };

    if (wsUrl) {
      connectionConfig.wsEndpoint = wsUrl;
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
      lastPrimaryFailureAt: this.lastPrimaryFailureAt,
      lastPrimaryFailureReason: this.lastPrimaryFailureReason,
      lastFallbackSuccessAt: this.lastFallbackSuccessAt,
      lastRecoveryAt: this.lastRecoveryAt,
      queue: {
        active: this.activeRequests,
        pending: this.queue.length,
        maxConcurrentRequests: this.maxConcurrentRequests,
        minRequestIntervalMs: this.minRequestIntervalMs
      },
      stats: { ...this.stats }
    };
  }

  getPreferredTargets() {
    if (!this.fallback) {
      return [this.primary];
    }

    if (Date.now() < this.primaryDegradedUntil) {
      return [this.fallback];
    }

    return [this.primary, this.fallback];
  }

  markPrimaryFailure(error) {
    this.primaryDegradedUntil = Date.now() + this.primaryDowngradeMs;
    this.lastPrimaryFailureAt = new Date().toISOString();
    this.lastPrimaryFailureReason = error?.message || String(error || 'unknown error');
    this.stats.primaryFailures += 1;
    this.logger?.warn?.('Primary Solana RPC failed; degrading to fallback', {
      reason: this.lastPrimaryFailureReason,
      primaryHttpUrl: this.redactEndpoint(this.primary.httpUrl),
      fallbackHttpUrl: this.redactEndpoint(this.fallback?.httpUrl || null),
      degradedForMs: this.primaryDowngradeMs
    });
  }

  markPrimaryRecovery() {
    if (this.primaryDegradedUntil > 0) {
      this.lastRecoveryAt = new Date().toISOString();
      this.stats.recoveries += 1;
      this.logger?.info?.('Primary Solana RPC recovered');
    }

    this.primaryDegradedUntil = 0;
  }

  enqueue(work) {
    return new Promise((resolve, reject) => {
      this.queue.push({ work, resolve, reject });
      this.stats.queuedCalls += 1;
      this.stats.maxQueueDepth = Math.max(this.stats.maxQueueDepth, this.queue.length);
      this.processQueue();
    });
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
      this.activeRequests += 1;
      this.lastRequestStartedAt = Date.now();

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

  async executeCall(methodName, args = []) {
    const targets = this.getPreferredTargets();
    const failures = [];

    for (const target of targets) {
      try {
        if (target.label === 'primary') {
          this.stats.primaryCalls += 1;
        } else {
          this.stats.fallbackCalls += 1;
        }

        const result = await target.connection[methodName](...args);

        if (target.label === 'primary') {
          this.markPrimaryRecovery();
        } else {
          this.lastFallbackSuccessAt = new Date().toISOString();
          this.stats.fallbackSuccesses += 1;
        }

        return result;
      } catch (error) {
        failures.push(`${target.label}:${error?.message || String(error || 'unknown error')}`);

        if (target.label === 'primary') {
          if (this.fallback) {
            this.markPrimaryFailure(error);
            continue;
          }
          this.stats.primaryFailures += 1;
        }

        if (target.label === 'fallback') {
          this.stats.fallbackFailures += 1;
        }
      }
    }

    throw new Error(`Solana RPC ${methodName} failed across all configured endpoints: ${failures.join(' | ')}`);
  }

  async call(methodName, args = []) {
    return this.enqueue(() => this.executeCall(methodName, args));
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
    return this.call('getAccountInfo', args);
  }

  simulateTransaction(...args) {
    return this.call('simulateTransaction', args);
  }
}

module.exports = SolanaRpcRouter;
