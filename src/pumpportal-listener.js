const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

class PumpPortalListener {
  constructor(config, logger, handlers = {}) {
    this.config = config;
    this.logger = logger;
    this.handlers = handlers;
    this.ws = null;
    this.running = false;
    this.reconnectDelayMs = Number(config.pumpPortalReconnectDelayMs || 5000);
    this.staleConnectionMs = Number(config.pumpPortalStaleConnectionMs || 90000);
    this.healthCheckIntervalMs = Number(config.pumpPortalHealthCheckIntervalMs || 15000);
    this.pingIntervalMs = Number(config.pumpPortalPingIntervalMs || 25000);
    this.maxReconnectDelayMs = Number(config.pumpPortalMaxReconnectDelayMs || 60000);
    this.maxSubscribedMints = Number(config.pumpPortalMaxSubscribedMints || 750);
    this.tokenTradeSubscriptionTtlMs = Number(config.pumpPortalTokenTradeSubscriptionTtlMs || 30 * 60 * 1000);
    this.reconnectTimer = null;
    this.reconnectDelayResetTimer = null;
    this.reconnectDelayResetAfterStableMs = 30000;
    this.healthCheckTimer = null;
    this.pingTimer = null;
    this.subscribedMints = new Set();
    this.subscribedMintMeta = new Map();
    this.skippedPaidStreamMints = new Set();
    this.subscribedAccounts = new Set();
    this.currentReconnectDelayMs = this.reconnectDelayMs;
    this.debugDir = path.join(process.cwd(), 'data', 'pumpportal-debug');
    this.sampleFiles = {
      newToken: path.join(this.debugDir, 'latest-new-token-sample.json'),
      migration: path.join(this.debugDir, 'latest-migration-sample.json'),
      trade: path.join(this.debugDir, 'latest-trade-sample.json')
    };
    this.hasCapturedSamples = {
      newToken: false,
      migration: false,
      trade: false
    };
    this.stats = {
      connected: false,
      messages: 0,
      newTokens: 0,
      trades: 0,
      accountTrades: 0,
      migrations: 0,
      lastMessageAt: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      reconnectAttempts: 0,
      closeEvents: 0,
      lastCloseCode: null,
      lastCloseReason: null,
      lastConnectionAgeMs: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      staleReconnects: 0,
      reconnectDelayStableResets: 0,
      reconnectDelayResetAfterStableMs: this.reconnectDelayResetAfterStableMs,
      maxReconnectDelayMs: this.maxReconnectDelayMs,
      pingIntervalMs: this.pingIntervalMs,
      pingsSent: 0,
      pongsReceived: 0,
      lastPingAt: null,
      lastPongAt: null,
      paidTradeStreamsEnabled: Boolean(config.pumpPortalApiKey),
      tradeSubscriptionsSkippedNoApiKey: 0,
      accountSubscriptionsSkippedNoApiKey: 0,
      tradeSubscriptionsSkippedMaxActive: 0,
      tokenTradeUnsubscriptions: 0,
      tokenTradeSubscriptionPrunes: 0,
      tokenTradeTtlPrunes: 0,
      tokenTradeMaxActivePrunes: 0,
      maxSubscribedMints: this.maxSubscribedMints,
      tokenTradeSubscriptionTtlMs: this.tokenTradeSubscriptionTtlMs,
      reconnectDelayMs: this.currentReconnectDelayMs
    };
  }

  async start() {
    if (!this.config.pumpPortalEnabled) {
      this.logger.info('PumpPortal listener disabled by config');
      return;
    }

    if (this.running) {
      return;
    }

    this.running = true;
    await this.connect();
  }

  async stop() {
    this.running = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.clearReconnectDelayResetTimer();

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.removeAllListeners();
      socket.on('error', () => {});

      if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate();
      } else if (
        socket.readyState === WebSocket.OPEN
        || socket.readyState === WebSocket.CLOSING
      ) {
        socket.close();
      }
    }

    this.stats.connected = false;
    this.stats.lastDisconnectedAt = Date.now();
  }

  async connect() {
    if (!this.running) {
      return;
    }

    this.logger.info('Connecting to PumpPortal websocket...');
    const socket = new WebSocket(this.getWebsocketUrl());
    this.ws = socket;

    socket.on('open', async () => {
      this.stats.connected = true;
      this.stats.lastConnectedAt = Date.now();
      this.stats.lastCloseCode = null;
      this.stats.lastCloseReason = null;
      this.scheduleReconnectDelayReset(socket);
      this.logger.info('PumpPortal websocket connected');
      this.send({ method: 'subscribeNewToken' });
      this.send({ method: 'subscribeMigration' });
      this.subscribeTrackedAccounts();
      this.subscribeTrackedMints();
      this.startHealthCheck();
      this.startHeartbeat(socket);
      this.emitLifecycle('provider.pumpportal.connected', {
        subscribedMints: this.subscribedMints.size,
        subscribedAccounts: this.subscribedAccounts.size,
        pingIntervalMs: this.pingIntervalMs
      });
    });

    socket.on('message', async (raw) => {
      this.stats.messages += 1;
      this.stats.lastMessageAt = Date.now();

      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (error) {
        this.logger.warn('PumpPortal message parse failed', error.message);
        return;
      }

      try {
        await this.handleMessage(payload);
      } catch (error) {
        this.logger.warn('PumpPortal message handler failed', error.message);
      }
    });

    socket.on('close', (code, reasonBuffer) => {
      this.stats.connected = false;
      this.stats.lastDisconnectedAt = Date.now();
      this.stats.closeEvents += 1;
      this.stats.lastConnectionAgeMs = this.stats.lastConnectedAt
        ? this.stats.lastDisconnectedAt - this.stats.lastConnectedAt
        : null;
      this.stats.lastCloseCode = Number(code || 0) || 0;
      this.stats.lastCloseReason = reasonBuffer ? reasonBuffer.toString() : '';
      this.stopHealthCheck();
      this.stopHeartbeat();
      this.clearReconnectDelayResetTimer();
      this.logger.warn('PumpPortal websocket closed', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        reconnectDelayMs: this.currentReconnectDelayMs
      });
      this.emitLifecycle('provider.pumpportal.closed', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        reconnectDelayMs: this.currentReconnectDelayMs,
        subscribedMints: this.subscribedMints.size,
        subscribedAccounts: this.subscribedAccounts.size,
        pingsSent: this.stats.pingsSent,
        pongsReceived: this.stats.pongsReceived,
        lastPingAt: this.stats.lastPingAt ? new Date(this.stats.lastPingAt).toISOString() : null,
        lastPongAt: this.stats.lastPongAt ? new Date(this.stats.lastPongAt).toISOString() : null
      });
      if (this.ws === socket) {
        this.ws = null;
      }
      if (this.running) {
        this.stats.reconnectAttempts += 1;
        const delayMs = this.nextReconnectDelayMs();
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, delayMs);
      }
    });

    socket.on('error', (error) => {
      this.stats.lastErrorAt = Date.now();
      this.stats.lastErrorMessage = error.message;
      this.logger.warn('PumpPortal websocket error', error.message);
      this.emitLifecycle('provider.pumpportal.websocket_error', {
        errorMessage: error.message,
        subscribedMints: this.subscribedMints.size,
        subscribedAccounts: this.subscribedAccounts.size
      });
    });

    socket.on('pong', () => {
      if (this.ws !== socket) return;
      this.stats.pongsReceived += 1;
      this.stats.lastPongAt = Date.now();
    });
  }

  async handleMessage(payload) {
    const method = payload.method || payload.type || payload.txType || '';
    const mint = payload.mint || payload.token || payload.mintAddress;
    const account = payload.traderPublicKey || payload.wallet || payload.account;

    if (method === 'newToken' || method === 'subscribeNewToken' || payload.txType === 'create') {
      this.stats.newTokens += 1;
      this.captureSample('newToken', payload);

      if (mint) {
        this.touchSubscribedMint(mint);
      }

      if (mint && !this.subscribedMints.has(mint)) {
        if (this.canUsePaidTradeStreams() && this.reserveMintSubscriptionSlot(mint)) {
          this.subscribeTokenTrade(mint);
        } else if (!this.canUsePaidTradeStreams() && !this.skippedPaidStreamMints.has(mint)) {
          this.skippedPaidStreamMints.add(mint);
          this.subscribedMints.add(mint);
          this.stats.tradeSubscriptionsSkippedNoApiKey = this.skippedPaidStreamMints.size;
        }
      }

      if (this.handlers.onNewToken) {
        await this.handlers.onNewToken({
          ...payload,
          source: 'pumpportal_create'
        });
      }

      return;
    }

    if (method === 'migration' || method === 'subscribeMigration') {
      this.stats.migrations += 1;
      this.captureSample('migration', payload);
      if (this.handlers.onMigration) {
        await this.handlers.onMigration({
          ...payload,
          source: 'pumpportal_migration'
        });
      }
      return;
    }

    if (account && this.subscribedAccounts.has(account)) {
      this.stats.accountTrades += 1;
    }

    if (mint) {
      this.touchSubscribedMint(mint);
      this.stats.trades += 1;
      this.captureSample('trade', payload);
      if (this.handlers.onTrade) {
        await this.handlers.onTrade({
          ...payload,
          source: 'pumpportal_trade'
        });
      }
    }
  }

  getWebsocketUrl() {
    if (!this.config.pumpPortalApiKey || !this.config.pumpPortalUseApiKeyQuery) {
      return this.config.pumpPortalWebsocketUrl;
    }

    const separator = this.config.pumpPortalWebsocketUrl.includes('?') ? '&' : '?';
    return `${this.config.pumpPortalWebsocketUrl}${separator}api-key=${encodeURIComponent(this.config.pumpPortalApiKey)}`;
  }

  canUsePaidTradeStreams() {
    return Boolean(this.config.pumpPortalApiKey);
  }

  activeMintLimit() {
    return Number.isFinite(this.maxSubscribedMints) && this.maxSubscribedMints > 0
      ? this.maxSubscribedMints
      : Infinity;
  }

  reserveMintSubscriptionSlot(mint) {
    this.pruneMintSubscriptions();
    const limit = this.activeMintLimit();
    if (this.subscribedMints.size >= limit) {
      this.pruneOldestMintSubscriptions(this.subscribedMints.size - limit + 1);
    }
    if (this.subscribedMints.size >= limit) {
      this.stats.tradeSubscriptionsSkippedMaxActive += 1;
      return false;
    }
    const now = Date.now();
    this.subscribedMints.add(mint);
    this.skippedPaidStreamMints.delete(mint);
    this.subscribedMintMeta.set(mint, {
      subscribedAt: now,
      lastSeenAt: now
    });
    return true;
  }

  touchSubscribedMint(mint) {
    const meta = this.subscribedMintMeta.get(mint);
    if (!meta) return;
    meta.lastSeenAt = Date.now();
  }

  pruneMintSubscriptions() {
    if (!this.canUsePaidTradeStreams()) return;
    if (!Number.isFinite(this.tokenTradeSubscriptionTtlMs) || this.tokenTradeSubscriptionTtlMs <= 0) return;
    const now = Date.now();
    for (const [mint, meta] of this.subscribedMintMeta.entries()) {
      const subscribedAt = Number(meta.subscribedAt || 0);
      if (subscribedAt > 0 && now - subscribedAt >= this.tokenTradeSubscriptionTtlMs) {
        this.unsubscribeTokenTrade(mint, 'ttl');
      }
    }
  }

  pruneOldestMintSubscriptions(count) {
    if (!Number.isFinite(count) || count <= 0) return;
    const oldest = Array.from(this.subscribedMintMeta.entries())
      .sort((a, b) => Number(a[1]?.subscribedAt || 0) - Number(b[1]?.subscribedAt || 0))
      .slice(0, count);
    for (const [mint] of oldest) {
      this.unsubscribeTokenTrade(mint, 'max_active');
    }
  }

  subscribeTokenTrade(mint) {
    this.send({
      method: 'subscribeTokenTrade',
      keys: [mint]
    });
  }

  unsubscribeTokenTrade(mint, reason = 'unknown') {
    if (!this.subscribedMints.has(mint)) return;
    this.subscribedMints.delete(mint);
    this.subscribedMintMeta.delete(mint);
    this.skippedPaidStreamMints.delete(mint);
    this.stats.tokenTradeUnsubscriptions += 1;
    this.stats.tokenTradeSubscriptionPrunes += 1;
    if (reason === 'ttl') {
      this.stats.tokenTradeTtlPrunes += 1;
    }
    if (reason === 'max_active') {
      this.stats.tokenTradeMaxActivePrunes += 1;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        method: 'unsubscribeTokenTrade',
        keys: [mint]
      });
    }
  }

  resetReconnectDelay() {
    this.currentReconnectDelayMs = this.reconnectDelayMs;
    this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
  }

  scheduleReconnectDelayReset(socket) {
    this.clearReconnectDelayResetTimer();

    this.reconnectDelayResetTimer = setTimeout(() => {
      this.reconnectDelayResetTimer = null;
      if (!this.running || this.ws !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      this.resetReconnectDelay();
      this.stats.reconnectDelayStableResets += 1;
    }, this.reconnectDelayResetAfterStableMs);

    if (typeof this.reconnectDelayResetTimer.unref === 'function') {
      this.reconnectDelayResetTimer.unref();
    }
  }

  clearReconnectDelayResetTimer() {
    if (this.reconnectDelayResetTimer) {
      clearTimeout(this.reconnectDelayResetTimer);
      this.reconnectDelayResetTimer = null;
    }
  }

  nextReconnectDelayMs() {
    const base = Number.isFinite(this.currentReconnectDelayMs) && this.currentReconnectDelayMs > 0
      ? this.currentReconnectDelayMs
      : this.reconnectDelayMs;
    const maxDelay = Number.isFinite(this.maxReconnectDelayMs) && this.maxReconnectDelayMs > 0
      ? Math.max(base, this.maxReconnectDelayMs)
      : base;
    const jitterMs = Math.floor(Math.random() * Math.min(1000, base));
    const delayMs = Math.min(maxDelay, base + jitterMs);
    this.currentReconnectDelayMs = Math.min(maxDelay, Math.max(this.reconnectDelayMs, base * 2));
    this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
    return delayMs;
  }

  subscribeTrackedAccounts() {
    if (!this.canUsePaidTradeStreams()) {
      this.stats.accountSubscriptionsSkippedNoApiKey += this.config.pumpPortalTrackedAccounts.length;
      if (this.config.pumpPortalTrackedAccounts.length) {
        this.logger.warn('Skipping PumpPortal account trade subscriptions because PUMP_PORTAL_API_KEY is not configured');
      }
      return;
    }

    for (const account of this.config.pumpPortalTrackedAccounts) {
      if (this.subscribedAccounts.has(account)) {
        continue;
      }

      this.subscribedAccounts.add(account);
      this.send({
        method: 'subscribeAccountTrade',
        keys: [account]
      });
    }
  }

  subscribeTrackedMints() {
    if (!this.canUsePaidTradeStreams()) {
      return;
    }

    this.pruneMintSubscriptions();
    const mints = Array.from(this.subscribedMints);
    if (mints.length === 0) {
      return;
    }

    for (const mint of mints) {
      this.subscribeTokenTrade(mint);
    }

    this.logger.info(`Re-subscribed PumpPortal trade streams for ${mints.length} tracked mint(s)`);
  }

  startHealthCheck() {
    this.stopHealthCheck();

    if (!Number.isFinite(this.healthCheckIntervalMs) || this.healthCheckIntervalMs <= 0) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.checkConnectionHealth();
    }, this.healthCheckIntervalMs);

    if (typeof this.healthCheckTimer.unref === 'function') {
      this.healthCheckTimer.unref();
    }
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  startHeartbeat(socket) {
    this.stopHeartbeat();

    if (!Number.isFinite(this.pingIntervalMs) || this.pingIntervalMs <= 0) {
      return;
    }

    this.pingTimer = setInterval(() => {
      if (!this.running || this.ws !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socket.ping();
        this.stats.pingsSent += 1;
        this.stats.lastPingAt = Date.now();
      } catch (error) {
        this.stats.lastErrorAt = Date.now();
        this.stats.lastErrorMessage = error.message;
        this.logger.warn('PumpPortal websocket ping failed', error.message);
      }
    }, this.pingIntervalMs);

    if (typeof this.pingTimer.unref === 'function') {
      this.pingTimer.unref();
    }
  }

  stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  checkConnectionHealth() {
    if (!this.running || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!Number.isFinite(this.staleConnectionMs) || this.staleConnectionMs <= 0) {
      return;
    }

    const baselineAt = this.stats.lastMessageAt || this.stats.lastConnectedAt;
    if (!baselineAt) {
      return;
    }

    const ageMs = Date.now() - baselineAt;
    if (ageMs < this.staleConnectionMs) {
      this.pruneMintSubscriptions();
      return;
    }

    this.stats.staleReconnects += 1;
    this.logger.warn('PumpPortal websocket stale; recycling connection', {
      ageMs,
      staleConnectionMs: this.staleConnectionMs,
      subscribedMints: this.subscribedMints.size
    });
    this.emitLifecycle('provider.pumpportal.stale_reconnect', {
      ageMs,
      staleConnectionMs: this.staleConnectionMs,
      subscribedMints: this.subscribedMints.size,
      subscribedAccounts: this.subscribedAccounts.size
    });

    const socket = this.ws;
    this.ws = null;
    socket.removeAllListeners('close');
    socket.on('close', () => {});
    socket.terminate();
    this.stats.connected = false;
    this.stats.lastDisconnectedAt = Date.now();
    this.stats.lastConnectionAgeMs = this.stats.lastConnectedAt
      ? this.stats.lastDisconnectedAt - this.stats.lastConnectedAt
      : null;
    this.stopHealthCheck();
    this.stopHeartbeat();

    if (this.running && !this.reconnectTimer) {
      this.stats.reconnectAttempts += 1;
      const delayMs = this.nextReconnectDelayMs();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delayMs);
    }
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  emitLifecycle(type, payload = {}) {
    if (typeof this.handlers.onLifecycle !== 'function') {
      return;
    }
    try {
      this.handlers.onLifecycle(type, payload);
    } catch {
      // Provider lifecycle telemetry is best-effort.
    }
  }

  captureSample(kind, payload) {
    if (this.hasCapturedSamples[kind]) {
      return;
    }

    const targetPath = this.sampleFiles[kind];
    if (!targetPath) {
      return;
    }

    try {
      fs.mkdirSync(this.debugDir, { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify({
        capturedAt: new Date().toISOString(),
        kind,
        keys: Object.keys(payload || {}).sort(),
        payload
      }, null, 2), 'utf8');
      this.hasCapturedSamples[kind] = true;
    } catch (error) {
      this.logger.warn(`PumpPortal ${kind} sample capture failed`, error.message);
    }
  }

  getStats() {
    return {
      ...this.stats,
      subscribedMints: this.subscribedMints.size,
      subscribedAccounts: this.subscribedAccounts.size,
      skippedPaidStreamMints: this.skippedPaidStreamMints.size,
      maxSubscribedMints: this.maxSubscribedMints,
      maxReconnectDelayMs: this.maxReconnectDelayMs,
      tokenTradeSubscriptionTtlMs: this.tokenTradeSubscriptionTtlMs
    };
  }
}

module.exports = PumpPortalListener;
