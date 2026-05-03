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
    this.reconnectTimer = null;
    this.healthCheckTimer = null;
    this.subscribedMints = new Set();
    this.subscribedAccounts = new Set();
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
      lastErrorAt: null,
      lastErrorMessage: null,
      staleReconnects: 0,
      paidTradeStreamsEnabled: Boolean(config.pumpPortalApiKey),
      tradeSubscriptionsSkippedNoApiKey: 0,
      accountSubscriptionsSkippedNoApiKey: 0
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

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

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
      this.logger.info('PumpPortal websocket connected');
      this.send({ method: 'subscribeNewToken' });
      this.send({ method: 'subscribeMigration' });
      this.subscribeTrackedAccounts();
      this.subscribeTrackedMints();
      this.startHealthCheck();
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
      this.stats.lastCloseCode = Number(code || 0) || 0;
      this.stats.lastCloseReason = reasonBuffer ? reasonBuffer.toString() : '';
      this.stopHealthCheck();
      this.logger.warn('PumpPortal websocket closed', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        reconnectDelayMs: this.reconnectDelayMs
      });
      if (this.ws === socket) {
        this.ws = null;
      }
      if (this.running) {
        this.stats.reconnectAttempts += 1;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, this.reconnectDelayMs);
      }
    });

    socket.on('error', (error) => {
      this.stats.lastErrorAt = Date.now();
      this.stats.lastErrorMessage = error.message;
      this.logger.warn('PumpPortal websocket error', error.message);
    });
  }

  async handleMessage(payload) {
    const method = payload.method || payload.type || payload.txType || '';
    const mint = payload.mint || payload.token || payload.mintAddress;
    const account = payload.traderPublicKey || payload.wallet || payload.account;

    if (method === 'newToken' || method === 'subscribeNewToken' || payload.txType === 'create') {
      this.stats.newTokens += 1;
      this.captureSample('newToken', payload);

      if (mint && !this.subscribedMints.has(mint)) {
        if (this.canUsePaidTradeStreams()) {
          this.subscribedMints.add(mint);
          this.send({
            method: 'subscribeTokenTrade',
            keys: [mint]
          });
        } else {
          this.stats.tradeSubscriptionsSkippedNoApiKey += 1;
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

    const mints = Array.from(this.subscribedMints);
    if (mints.length === 0) {
      return;
    }

    for (const mint of mints) {
      this.send({
        method: 'subscribeTokenTrade',
        keys: [mint]
      });
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
      return;
    }

    this.stats.staleReconnects += 1;
    this.logger.warn('PumpPortal websocket stale; recycling connection', {
      ageMs,
      staleConnectionMs: this.staleConnectionMs,
      subscribedMints: this.subscribedMints.size
    });

    const socket = this.ws;
    this.ws = null;
    socket.removeAllListeners('close');
    socket.on('close', () => {});
    socket.terminate();
    this.stats.connected = false;
    this.stats.lastDisconnectedAt = Date.now();
    this.stopHealthCheck();

    if (this.running && !this.reconnectTimer) {
      this.stats.reconnectAttempts += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 250);
    }
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(message));
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
      subscribedAccounts: this.subscribedAccounts.size
    };
  }
}

module.exports = PumpPortalListener;
