const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'.toUpperCase();
const SOL_MINT = 'So11111111111111111111111111111111111111112'.toUpperCase();

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
    this.maxSubscribedMints = Number(config.pumpPortalMaxSubscribedMints || 100);
    this.tokenTradeSubscriptionTtlMs = Number(config.pumpPortalTokenTradeSubscriptionTtlMs || 30 * 60 * 1000);
    this.reconnectResubscribeMaxMints = Number(config.pumpPortalReconnectResubscribeMaxMints || 25);
    this.reconnectResubscribeBatchSize = Number(config.pumpPortalReconnectResubscribeBatchSize || 10);
    this.reconnectResubscribeBatchDelayMs = Number(config.pumpPortalReconnectResubscribeBatchDelayMs || 1000);
    this.eventHandlerConcurrency = Math.max(1, Number(config.pumpPortalEventHandlerConcurrency || 6));
    this.eventQueueMaxSize = Math.max(1, Number(config.pumpPortalEventQueueMaxSize || 10000));
    this.eventQueue = [];
    this.processingEvents = 0;
    this.reconnectTimer = null;
    this.reconnectDelayResetTimer = null;
    this.resubscribeTimer = null;
    this.pendingResubscribeMints = [];
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
      trade: path.join(this.debugDir, 'latest-trade-sample.json'),
      usdcPair: path.join(this.debugDir, 'latest-usdc-pair-sample.json'),
      unknownPair: path.join(this.debugDir, 'latest-unknown-pair-sample.json')
    };
    this.hasCapturedSamples = {
      newToken: false,
      migration: false,
      trade: false,
      usdcPair: false,
      unknownPair: false
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
      controlFramesSent: 0,
      tokenTradeSubscribeFrames: 0,
      tokenTradeUnsubscribeFrames: 0,
      pairSolEvents: 0,
      pairUsdcEvents: 0,
      pairUnknownEvents: 0,
      newTokenPairSolEvents: 0,
      newTokenPairUsdcEvents: 0,
      newTokenPairUnknownEvents: 0,
      tradePairSolEvents: 0,
      tradePairUsdcEvents: 0,
      tradePairUnknownEvents: 0,
      migrationPairSolEvents: 0,
      migrationPairUsdcEvents: 0,
      migrationPairUnknownEvents: 0,
      lastDetectedPairBase: null,
      lastDetectedPairAt: null,
      tokenTradeReconnectResubscribeScheduled: 0,
      tokenTradeReconnectResubscribeSent: 0,
      tokenTradeReconnectResubscribeDropped: 0,
      reconnectResubscribeMaxMints: this.reconnectResubscribeMaxMints,
      reconnectResubscribeBatchSize: this.reconnectResubscribeBatchSize,
      reconnectResubscribeBatchDelayMs: this.reconnectResubscribeBatchDelayMs,
      eventHandlerConcurrency: this.eventHandlerConcurrency,
      eventQueueMaxSize: this.eventQueueMaxSize,
      eventQueueDepth: 0,
      eventQueueMaxDepth: 0,
      eventQueueDropped: 0,
      eventQueueDiscardedOnStop: 0,
      eventQueueProcessed: 0,
      eventQueueHandlerErrors: 0,
      eventQueueProcessingActive: 0,
      eventQueueLastDroppedAt: null,
      eventQueueLastProcessedAt: null,
      subscriptionAckMessages: 0,
      newTokenSubscriptionAcks: 0,
      migrationSubscriptionAcks: 0,
      tokenTradeSubscriptionAcks: 0,
      accountTradeSubscriptionAcks: 0,
      unknownSubscriptionAcks: 0,
      lastSubscriptionAckAt: null,
      lastSubscriptionAckMessage: null,
      lastSubscriptionAckKind: null,
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
    this.clearResubscribeTimer();

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    this.stopHeartbeat();
    if (this.eventQueue.length > 0) {
      this.stats.eventQueueDiscardedOnStop += this.eventQueue.length;
    }
    this.eventQueue = [];
    this.stats.eventQueueDepth = 0;

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
    socket.pumpPortalHeartbeat = {
      pingsSent: 0,
      pongsReceived: 0,
      lastPingAt: null,
      lastPongAt: null
    };
    socket.pumpPortalConnection = this.buildConnectionStats();
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

    socket.on('message', (raw) => {
      this.stats.messages += 1;
      this.stats.lastMessageAt = Date.now();
      if (socket.pumpPortalConnection) {
        socket.pumpPortalConnection.messages += 1;
        socket.pumpPortalConnection.lastMessageAt = this.stats.lastMessageAt;
      }

      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (error) {
        this.logger.warn('PumpPortal message parse failed', error.message);
        return;
      }

      this.recordConnectionMessage(socket, payload);
      this.enqueueMessage(payload);
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
      const connectionStats = this.finalizeConnectionStats(socket);
      this.stopHealthCheck();
      this.stopHeartbeat();
      this.clearReconnectDelayResetTimer();
      this.clearResubscribeTimer();
      this.logger.warn('PumpPortal websocket closed', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        reconnectDelayMs: this.currentReconnectDelayMs,
        connectionPingsSent: socket.pumpPortalHeartbeat?.pingsSent || 0,
        connectionPongsReceived: socket.pumpPortalHeartbeat?.pongsReceived || 0,
        connectionMessages: connectionStats.messages,
        connectionMessagesPerMinute: connectionStats.messagesPerMinute,
        lastMessageAgeMsAtClose: connectionStats.lastMessageAgeMsAtClose
      });
      this.emitLifecycle('provider.pumpportal.closed', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        reconnectDelayMs: this.currentReconnectDelayMs,
        subscribedMints: this.subscribedMints.size,
        subscribedAccounts: this.subscribedAccounts.size,
        connectionMessages: connectionStats.messages,
        connectionNewTokens: connectionStats.newTokens,
        connectionTrades: connectionStats.trades,
        connectionMigrations: connectionStats.migrations,
        connectionSubscriptionAcks: connectionStats.subscriptionAcks,
        connectionControlFramesSent: connectionStats.controlFramesSent,
        connectionMessagesPerMinute: connectionStats.messagesPerMinute,
        lastMessageAgeMsAtClose: connectionStats.lastMessageAgeMsAtClose,
        connectionPairSolEvents: connectionStats.pairSolEvents,
        connectionPairUsdcEvents: connectionStats.pairUsdcEvents,
        connectionPairUnknownEvents: connectionStats.pairUnknownEvents,
        connectionPingsSent: socket.pumpPortalHeartbeat?.pingsSent || 0,
        connectionPongsReceived: socket.pumpPortalHeartbeat?.pongsReceived || 0,
        connectionLastPingAt: socket.pumpPortalHeartbeat?.lastPingAt
          ? new Date(socket.pumpPortalHeartbeat.lastPingAt).toISOString()
          : null,
        connectionLastPongAt: socket.pumpPortalHeartbeat?.lastPongAt
          ? new Date(socket.pumpPortalHeartbeat.lastPongAt).toISOString()
          : null,
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
      if (socket.pumpPortalHeartbeat) {
        socket.pumpPortalHeartbeat.pongsReceived += 1;
        socket.pumpPortalHeartbeat.lastPongAt = this.stats.lastPongAt;
      }
    });
  }

  enqueueMessage(payload) {
    if (this.eventQueue.length >= this.eventQueueMaxSize) {
      this.eventQueue.shift();
      this.stats.eventQueueDropped += 1;
      this.stats.eventQueueLastDroppedAt = Date.now();
    }

    this.eventQueue.push(payload);
    this.stats.eventQueueDepth = this.eventQueue.length;
    this.stats.eventQueueMaxDepth = Math.max(this.stats.eventQueueMaxDepth || 0, this.eventQueue.length);
    this.drainEventQueue();
  }

  drainEventQueue() {
    while (this.processingEvents < this.eventHandlerConcurrency && this.eventQueue.length > 0) {
      const payload = this.eventQueue.shift();
      this.stats.eventQueueDepth = this.eventQueue.length;
      this.processingEvents += 1;
      this.stats.eventQueueProcessingActive = this.processingEvents;

      Promise.resolve()
        .then(() => this.handleMessage(payload))
        .then(() => {
          this.stats.eventQueueProcessed += 1;
          this.stats.eventQueueLastProcessedAt = Date.now();
        })
        .catch((error) => {
          this.stats.eventQueueHandlerErrors += 1;
          this.logger.warn('PumpPortal message handler failed', error.message);
        })
        .finally(() => {
          this.processingEvents -= 1;
          this.stats.eventQueueProcessingActive = this.processingEvents;
          this.stats.eventQueueDepth = this.eventQueue.length;
          if (this.eventQueue.length > 0) {
            setImmediate(() => this.drainEventQueue());
          }
        });
    }
  }

  async handleMessage(payload) {
    this.recordSubscriptionAck(payload);

    const method = payload.method || payload.type || payload.txType || '';
    const mint = payload.mint || payload.token || payload.mintAddress;
    const account = payload.traderPublicKey || payload.wallet || payload.account;

    if (method === 'newToken' || method === 'subscribeNewToken' || payload.txType === 'create') {
      this.stats.newTokens += 1;
      this.recordPairShape('newToken', payload);
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

    if (this.isMigrationPayload(payload, method)) {
      this.stats.migrations += 1;
      this.recordPairShape('migration', payload);
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
      this.recordPairShape('trade', payload);
      this.captureSample('trade', payload);
      if (this.handlers.onTrade) {
        await this.handlers.onTrade({
          ...payload,
          source: 'pumpportal_trade'
        });
      }
    }
  }

  isMigrationPayload(payload = {}, method = '') {
    const normalizedMethod = String(method || payload.method || payload.type || '').toLowerCase();
    const txType = String(payload.txType || '').toLowerCase();
    return normalizedMethod === 'migration'
      || normalizedMethod === 'subscribemigration'
      || txType === 'migrate'
      || txType === 'migration';
  }

  recordSubscriptionAck(payload) {
    const message = typeof payload?.message === 'string' ? payload.message : '';
    if (!message) return;

    const normalized = message.toLowerCase();
    if (!normalized.includes('subscribed') && !normalized.includes('unsubscribed')) {
      return;
    }

    const kind = this.classifySubscriptionAck(message, payload);
    this.stats.subscriptionAckMessages += 1;
    this.stats.lastSubscriptionAckAt = Date.now();
    this.stats.lastSubscriptionAckMessage = message;
    this.stats.lastSubscriptionAckKind = kind;

    if (kind === 'new_token') {
      this.stats.newTokenSubscriptionAcks += 1;
    } else if (kind === 'migration') {
      this.stats.migrationSubscriptionAcks += 1;
    } else if (kind === 'token_trade') {
      this.stats.tokenTradeSubscriptionAcks += 1;
    } else if (kind === 'account_trade') {
      this.stats.accountTradeSubscriptionAcks += 1;
    } else {
      this.stats.unknownSubscriptionAcks += 1;
    }
  }

  buildConnectionStats() {
    return {
      openedAt: Date.now(),
      messages: 0,
      newTokens: 0,
      trades: 0,
      migrations: 0,
      subscriptionAcks: 0,
      controlFramesSent: 0,
      pairSolEvents: 0,
      pairUsdcEvents: 0,
      pairUnknownEvents: 0,
      lastMessageAt: null
    };
  }

  recordConnectionMessage(socket, payload = {}) {
    const connection = socket?.pumpPortalConnection;
    if (!connection) return;

    const message = typeof payload?.message === 'string' ? payload.message : '';
    if (message && (message.toLowerCase().includes('subscribed') || message.toLowerCase().includes('unsubscribed'))) {
      connection.subscriptionAcks += 1;
      return;
    }

    const method = payload.method || payload.type || payload.txType || '';
    if (method === 'newToken' || method === 'subscribeNewToken' || payload.txType === 'create') {
      connection.newTokens += 1;
    } else if (this.isMigrationPayload(payload, method)) {
      connection.migrations += 1;
    } else if (payload.mint || payload.token || payload.mintAddress) {
      connection.trades += 1;
    }

    const pairBase = this.detectPairBase(payload);
    if (pairBase === 'USDC') {
      connection.pairUsdcEvents += 1;
    } else if (pairBase === 'SOL') {
      connection.pairSolEvents += 1;
    } else {
      connection.pairUnknownEvents += 1;
    }
  }

  finalizeConnectionStats(socket) {
    const connection = socket?.pumpPortalConnection || this.buildConnectionStats();
    const closedAt = Date.now();
    const ageMs = Number.isFinite(this.stats.lastConnectionAgeMs)
      ? this.stats.lastConnectionAgeMs
      : closedAt - Number(connection.openedAt || closedAt);
    const minutes = ageMs > 0 ? ageMs / 60000 : 0;
    return {
      ...connection,
      messagesPerMinute: minutes > 0 ? Number((Number(connection.messages || 0) / minutes).toFixed(4)) : null,
      lastMessageAgeMsAtClose: connection.lastMessageAt ? closedAt - connection.lastMessageAt : null
    };
  }

  recordPairShape(kind, payload = {}) {
    const pairBase = this.detectPairBase(payload);
    if (pairBase === 'USDC') {
      this.stats.pairUsdcEvents += 1;
      this.stats[`${kind}PairUsdcEvents`] += 1;
      this.stats.lastDetectedPairBase = 'USDC';
      this.stats.lastDetectedPairAt = Date.now();
      this.captureSample('usdcPair', {
        kind,
        detectedPairBase: pairBase,
        payload
      });
      return;
    }

    if (pairBase === 'SOL') {
      this.stats.pairSolEvents += 1;
      this.stats[`${kind}PairSolEvents`] += 1;
      this.stats.lastDetectedPairBase = 'SOL';
      this.stats.lastDetectedPairAt = Date.now();
      return;
    }

    this.stats.pairUnknownEvents += 1;
    this.stats[`${kind}PairUnknownEvents`] += 1;
    this.captureSample('unknownPair', {
      kind,
      detectedPairBase: pairBase,
      payload
    });
  }

  detectPairBase(payload = {}) {
    const flattened = this.flattenPayloadTokens(payload);
    const hasUsdc = flattened.some((value) => (
      value === USDC_MINT
      || value === 'USDC'
      || value.includes('USDC')
      || value.includes('USD COIN')
    ));
    if (hasUsdc) return 'USDC';

    const hasSol = flattened.some((value) => (
      value === SOL_MINT
      || value === 'SOL'
      || value === 'WSOL'
      || value.includes('SOLANA')
    ));
    if (hasSol) return 'SOL';

    const keys = Object.keys(payload || {}).map((key) => key.toLowerCase());
    const hasSolCurveShape = keys.includes('solamount')
      || keys.includes('vsolinbondingcurve')
      || keys.includes('marketcapsol');
    if (hasSolCurveShape) return 'SOL';

    return 'UNKNOWN';
  }

  flattenPayloadTokens(value, depth = 0, output = []) {
    if (depth > 4 || value === null || value === undefined) return output;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      output.push(String(value).trim().toUpperCase());
      return output;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) {
        this.flattenPayloadTokens(item, depth + 1, output);
      }
      return output;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value).slice(0, 100)) {
        output.push(String(key).trim().toUpperCase());
        this.flattenPayloadTokens(item, depth + 1, output);
      }
    }
    return output;
  }

  classifySubscriptionAck(message, payload = {}) {
    const normalized = String(message || '').toLowerCase();
    const method = String(payload.method || payload.type || '').toLowerCase();

    if (method.includes('migration') || normalized.includes('migration')) {
      return 'migration';
    }
    if (
      method.includes('newtoken')
      || method.includes('new_token')
      || normalized.includes('token creation')
      || normalized.includes('new token')
    ) {
      return 'new_token';
    }
    if (method.includes('account') || normalized.includes('account') || normalized.includes('wallet')) {
      return 'account_trade';
    }
    if (method.includes('tokentrade') || normalized.includes('token trade') || normalized.includes('keys')) {
      return 'token_trade';
    }

    return 'unknown';
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
    const sent = this.send({
      method: 'subscribeTokenTrade',
      keys: [mint]
    });
    if (sent) this.stats.tokenTradeSubscribeFrames += 1;
  }

  unsubscribeTokenTrade(mint, reason = 'unknown') {
    if (!this.subscribedMints.has(mint)) return;
    this.dropMintSubscription(mint);
    this.stats.tokenTradeUnsubscriptions += 1;
    this.stats.tokenTradeSubscriptionPrunes += 1;
    if (reason === 'ttl') {
      this.stats.tokenTradeTtlPrunes += 1;
    }
    if (reason === 'max_active') {
      this.stats.tokenTradeMaxActivePrunes += 1;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const sent = this.send({
        method: 'unsubscribeTokenTrade',
        keys: [mint]
      });
      if (sent) this.stats.tokenTradeUnsubscribeFrames += 1;
    }
  }

  dropMintSubscription(mint) {
    this.subscribedMints.delete(mint);
    this.subscribedMintMeta.delete(mint);
    this.skippedPaidStreamMints.delete(mint);
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
    const ranked = Array.from(this.subscribedMints)
      .map((mint) => ({
        mint,
        lastSeenAt: Number(this.subscribedMintMeta.get(mint)?.lastSeenAt || 0),
        subscribedAt: Number(this.subscribedMintMeta.get(mint)?.subscribedAt || 0)
      }))
      .sort((a, b) => (b.lastSeenAt || b.subscribedAt) - (a.lastSeenAt || a.subscribedAt));
    const limit = Number.isFinite(this.reconnectResubscribeMaxMints) && this.reconnectResubscribeMaxMints > 0
      ? this.reconnectResubscribeMaxMints
      : ranked.length;
    const selected = ranked.slice(0, limit).map((item) => item.mint);
    const dropped = ranked.slice(limit).map((item) => item.mint);

    for (const mint of dropped) {
      this.dropMintSubscription(mint);
    }

    if (dropped.length > 0) {
      this.stats.tokenTradeReconnectResubscribeDropped += dropped.length;
    }

    const mints = selected.filter((mint) => this.subscribedMints.has(mint));
    if (mints.length === 0) {
      return;
    }

    const scheduledMints = mints.length;
    this.pendingResubscribeMints = mints;
    this.stats.tokenTradeReconnectResubscribeScheduled += scheduledMints;
    this.flushResubscribeBatch();

    this.logger.info('Scheduled PumpPortal trade stream re-subscriptions', {
      trackedMints: ranked.length,
      scheduledMints,
      droppedMints: dropped.length,
      batchSize: this.reconnectResubscribeBatchSize,
      batchDelayMs: this.reconnectResubscribeBatchDelayMs
    });
  }

  clearResubscribeTimer() {
    if (this.resubscribeTimer) {
      clearTimeout(this.resubscribeTimer);
      this.resubscribeTimer = null;
    }
    this.pendingResubscribeMints = [];
  }

  flushResubscribeBatch() {
    this.resubscribeTimer = null;

    if (!this.running || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingResubscribeMints = [];
      return;
    }

    const batchSize = Number.isFinite(this.reconnectResubscribeBatchSize) && this.reconnectResubscribeBatchSize > 0
      ? this.reconnectResubscribeBatchSize
      : this.pendingResubscribeMints.length;
    const batch = this.pendingResubscribeMints.splice(0, batchSize);

    for (const mint of batch) {
      if (!this.subscribedMints.has(mint)) continue;
      this.subscribeTokenTrade(mint);
      this.stats.tokenTradeReconnectResubscribeSent += 1;
    }

    if (this.pendingResubscribeMints.length === 0) {
      return;
    }

    const delayMs = Number.isFinite(this.reconnectResubscribeBatchDelayMs) && this.reconnectResubscribeBatchDelayMs >= 0
      ? this.reconnectResubscribeBatchDelayMs
      : 0;
    this.resubscribeTimer = setTimeout(() => this.flushResubscribeBatch(), delayMs);
    if (typeof this.resubscribeTimer.unref === 'function') {
      this.resubscribeTimer.unref();
    }
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
        if (socket.pumpPortalHeartbeat) {
          socket.pumpPortalHeartbeat.pingsSent += 1;
          socket.pumpPortalHeartbeat.lastPingAt = this.stats.lastPingAt;
        }
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

    const baselineAt = Math.max(
      Number(this.stats.lastMessageAt || 0),
      Number(this.stats.lastPongAt || 0),
      Number(this.stats.lastConnectedAt || 0)
    );
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
      return false;
    }

    this.ws.send(JSON.stringify(message));
    this.stats.controlFramesSent += 1;
    if (this.ws.pumpPortalConnection) {
      this.ws.pumpPortalConnection.controlFramesSent += 1;
    }
    return true;
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
      tokenTradeSubscriptionTtlMs: this.tokenTradeSubscriptionTtlMs,
      eventQueueDepth: this.eventQueue.length,
      eventQueueProcessingActive: this.processingEvents
    };
  }
}

module.exports = PumpPortalListener;
