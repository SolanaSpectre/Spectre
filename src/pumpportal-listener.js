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
    this.backupOnly = config.pumpPortalBackupOnly === true;
    this.useSplitSockets = config.pumpPortalSplitSockets === true;
    this.postCloseTradestreamDelayMs = Number(config.pumpPortalPostCloseTradestreamDelayMs || 15000);
    this.postCloseTradestreamGateUntilMs = 0;
    const sharedConnection = this.createConnectionState('combined');
    this.connections = {
      discovery: this.useSplitSockets ? this.createConnectionState('discovery') : sharedConnection,
      tradestream: this.useSplitSockets ? this.createConnectionState('tradestream') : sharedConnection
    };
    this.running = false;
    this.reconnectDelayMs = Number(config.pumpPortalReconnectDelayMs || 5000);
    this.staleConnectionMs = Number(config.pumpPortalStaleConnectionMs || 90000);
    this.healthCheckIntervalMs = Number(config.pumpPortalHealthCheckIntervalMs || 15000);
    this.pingIntervalMs = Number(config.pumpPortalPingIntervalMs || 25000);
    this.maxReconnectDelayMs = Number(config.pumpPortalMaxReconnectDelayMs || 60000);
    this.maxSubscribedMints = Number(config.pumpPortalMaxSubscribedMints || 100);
    this.tokenTradeSubscriptionTtlMs = Number(config.pumpPortalTokenTradeSubscriptionTtlMs || 30 * 60 * 1000);
    this.tradeSubscriptionMode = String(config.pumpPortalTradeSubscriptionMode || 'targeted_curve').trim().toLowerCase();
    const configuredMeteredTradeLimit = config.pumpPortalMaxMeteredTradeEventsPerSession;
    const parsedMeteredTradeLimit = configuredMeteredTradeLimit === undefined
      || configuredMeteredTradeLimit === null
      || configuredMeteredTradeLimit === ''
      ? 30000
      : Number(configuredMeteredTradeLimit);
    this.maxMeteredTradeEventsPerSession = Number.isFinite(parsedMeteredTradeLimit) && parsedMeteredTradeLimit >= 0
      ? parsedMeteredTradeLimit
      : 10000;
    this.meteredTradeBudgetReached = false;
    this.reconnectResubscribeMaxMints = Number(config.pumpPortalReconnectResubscribeMaxMints || 25);
    this.reconnectResubscribeBatchSize = Number(config.pumpPortalReconnectResubscribeBatchSize || 10);
    this.reconnectResubscribeBatchDelayMs = Number(config.pumpPortalReconnectResubscribeBatchDelayMs || 1000);
    for (const state of Object.values(this.connections)) {
      state.currentReconnectDelayMs = this.reconnectDelayMs;
    }
    this.eventHandlerConcurrency = Math.max(1, Number(config.pumpPortalEventHandlerConcurrency || 6));
    this.eventQueueMaxSize = Math.max(1, Number(config.pumpPortalEventQueueMaxSize || 10000));
    this.eventQueue = [];
    this.processingEvents = 0;
    this.reconnectDelayResetAfterStableMs = 30000;
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
      unmatchedAccountTrades: 0,
      meteredTradeEvents: 0,
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
      tradeSubscriptionsSkippedBudget: 0,
      accountSubscriptionsSkippedBudget: 0,
      tradeSubscriptionMode: this.tradeSubscriptionMode,
      targetedTradeSubscriptionsDeferredAtDiscovery: 0,
      targetedTradeSubscriptionCandidates: 0,
      targetedTradeSubscriptionAccepted: 0,
      targetedTradeSubscriptionAlreadyActive: 0,
      targetedTradeSubscriptionSkippedNoApiKey: 0,
      targetedTradeSubscriptionSkippedBudget: 0,
      targetedTradeSubscriptionSkippedMaxActive: 0,
      targetedTradeSubscriptionReasonCounts: {},
      meteredTradeBudgetReached: false,
      meteredTradeBudgetReachedAt: null,
      maxMeteredTradeEventsPerSession: this.maxMeteredTradeEventsPerSession,
      tokenTradeUnsubscriptions: 0,
      tokenTradeSubscriptionPrunes: 0,
      tokenTradeTtlPrunes: 0,
      tokenTradeMaxActivePrunes: 0,
      tokenTradeTerminalPrunes: 0,
      controlFramesSent: 0,
      tokenTradeSubscribeFrames: 0,
      tokenTradeUnsubscribeFrames: 0,
      accountTradeUnsubscribeFrames: 0,
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
      reconnectDelayMs: this.currentReconnectDelayMs,
      splitSocketsEnabled: this.useSplitSockets,
      backupOnly: this.backupOnly,
      postCloseTradestreamDelayMs: this.postCloseTradestreamDelayMs,
      postCloseTradestreamGateUntilMs: this.postCloseTradestreamGateUntilMs,
      discovery: this.createRoleStats('discovery'),
      tradestream: this.createRoleStats('tradestream'),
      bothConnectionsDownCount: 0,
      bothConnectionsDownMs: 0,
      bothConnectionsDownStartedAt: null,
      discoveryEventsWhileTradestreamDown: 0,
      tradestreamEventsWhileDiscoveryDown: 0
    };
  }

  createConnectionState(role) {
    return {
      role,
      ws: null,
      reconnectTimer: null,
      reconnectDelayResetTimer: null,
      resubscribeTimer: null,
      pendingResubscribeMints: [],
      healthCheckTimer: null,
      pingTimer: null,
      currentReconnectDelayMs: this?.reconnectDelayMs || 5000,
      connected: false,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastMessageAt: null,
      lastPongAt: null
    };
  }

  createRoleStats(role) {
    return {
      role,
      connected: false,
      messages: 0,
      newTokens: 0,
      trades: 0,
      accountTrades: 0,
      unmatchedAccountTrades: 0,
      meteredTradeEvents: 0,
      migrations: 0,
      reconnectAttempts: 0,
      closeEvents: 0,
      staleReconnects: 0,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastMessageAt: null,
      lastConnectionAgeMs: null,
      lastCloseCode: null,
      lastCloseReason: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      reconnectDelayStableResets: 0,
      reconnectDelayMs: this?.reconnectDelayMs || 5000,
      pingsSent: 0,
      pongsReceived: 0,
      lastPingAt: null,
      lastPongAt: null,
      controlFramesSent: 0,
      subscriptionAckMessages: 0,
      newTokenSubscriptionAcks: 0,
      migrationSubscriptionAcks: 0,
      tokenTradeSubscriptionAcks: 0,
      accountTradeSubscriptionAcks: 0,
      unknownSubscriptionAcks: 0,
      pairSolEvents: 0,
      pairUsdcEvents: 0,
      pairUnknownEvents: 0,
      tokenTradeSubscribeFrames: 0,
      tokenTradeUnsubscribeFrames: 0,
      subscribedMints: 0,
      subscribedAccounts: 0
    };
  }

  logicalRoles(connectionRole) {
    return connectionRole === 'combined'
      ? ['discovery', 'tradestream']
      : [connectionRole].filter((role) => this.stats?.[role]);
  }

  forLogicalRoles(connectionRole, fn) {
    for (const role of this.logicalRoles(connectionRole)) {
      if (this.stats?.[role]) fn(this.stats[role], role);
    }
  }

  markRoleConnected(connectionRole, now) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].connected = true;
      this.stats[role].lastConnectedAt = now;
      this.stats[role].lastCloseCode = null;
      this.stats[role].lastCloseReason = null;
    }
  }

  markRoleDisconnected(connectionRole, now) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].connected = false;
      this.stats[role].lastDisconnectedAt = now;
    }
  }

  incrementRoleClose(connectionRole) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].closeEvents += 1;
    }
  }

  incrementRoleReconnect(connectionRole) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].reconnectAttempts += 1;
    }
  }

  incrementRolePong(connectionRole, now) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].pongsReceived += 1;
      this.stats[role].lastPongAt = now;
    }
  }

  setRoleCloseReason(connectionRole, code, reason) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].lastCloseCode = code;
      this.stats[role].lastCloseReason = reason;
    }
  }

  setRoleLastConnectionAge(connectionRole, ageMs) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].lastConnectionAgeMs = ageMs;
    }
  }

  setRoleError(connectionRole, now, message) {
    for (const role of this.logicalRoles(connectionRole)) {
      this.stats[role].lastErrorAt = now;
      this.stats[role].lastErrorMessage = message;
    }
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
    if (this.useSplitSockets) {
      await Promise.all([
        this.connectRole('discovery'),
        this.connectRole('tradestream')
      ]);
      return;
    }

    await this.connectRole('combined');
  }

  async stop() {
    this.running = false;

    for (const state of Object.values(this.connections)) {
      this.clearConnectionTimers(state);
    }

    if (this.eventQueue.length > 0) {
      this.stats.eventQueueDiscardedOnStop += this.eventQueue.length;
    }
    this.eventQueue = [];
    this.stats.eventQueueDepth = 0;

    for (const state of Object.values(this.connections)) {
      if (!state.ws) continue;
      const socket = state.ws;
      state.ws = null;
      state.connected = false;
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
    this.refreshConnectionState();
  }

  async connect() {
    return this.connectRole(this.useSplitSockets ? 'discovery' : 'combined');
  }

  async connectRole(role) {
    if (!this.running) {
      return;
    }

    const state = role === 'combined'
      ? this.connections.discovery
      : this.connections[role];
    if (!state) {
      throw new Error(`Unknown PumpPortal connection role: ${role}`);
    }

    this.logger.info('Connecting to PumpPortal websocket', { role });
    const socket = new WebSocket(this.getWebsocketUrl());
    socket.pumpPortalHeartbeat = {
      pingsSent: 0,
      pongsReceived: 0,
      lastPingAt: null,
      lastPongAt: null
    };
    socket.pumpPortalRole = role;
    socket.pumpPortalConnection = this.buildConnectionStats(role);
    state.ws = socket;

    socket.on('open', async () => {
      const now = Date.now();
      state.connected = true;
      state.lastConnectedAt = now;
      state.lastDisconnectedAt = null;
      this.markRoleConnected(role, now);
      this.stats.lastConnectedAt = now;
      this.stats.lastCloseCode = null;
      this.stats.lastCloseReason = null;
      this.refreshConnectionState();
      this.scheduleReconnectDelayReset(state, socket);
      this.logger.info('PumpPortal websocket connected', { role });
      if (role === 'combined') {
        this.send({ method: 'subscribeMigration' }, 'discovery');
        if (!this.backupOnly) {
          this.send({ method: 'subscribeNewToken' }, 'discovery');
          this.subscribeTrackedAccounts();
          this.subscribeTrackedMints();
        }
      } else if (role === 'discovery') {
        this.send({ method: 'subscribeMigration' }, 'discovery');
        if (!this.backupOnly) {
          this.send({ method: 'subscribeNewToken' }, 'discovery');
          this.subscribeTrackedAccounts();
        }
      } else if (role === 'tradestream') {
        if (!this.backupOnly) this.subscribeTrackedMints();
      }
      this.startHealthCheck(state);
      this.startHeartbeat(state, socket);
      this.emitLifecycle('provider.pumpportal.connected', {
        role,
        splitSocketsEnabled: this.useSplitSockets,
        subscribedMints: this.subscribedMints.size,
        subscribedAccounts: this.subscribedAccounts.size,
        pingIntervalMs: this.pingIntervalMs
      });
    });

    socket.on('message', (raw) => {
      const now = Date.now();
      this.stats.messages += 1;
      this.stats.lastMessageAt = now;
      state.lastMessageAt = now;
      const connectionRole = role;
      if (this.stats[connectionRole]) {
        this.stats[connectionRole].messages += 1;
        this.stats[connectionRole].lastMessageAt = now;
      }
      if (connectionRole === 'discovery' && !this.connections.tradestream.connected) {
        this.stats.discoveryEventsWhileTradestreamDown += 1;
      } else if (connectionRole === 'tradestream' && !this.connections.discovery.connected) {
        this.stats.tradestreamEventsWhileDiscoveryDown += 1;
      }
      if (socket.pumpPortalConnection) {
        socket.pumpPortalConnection.messages += 1;
        socket.pumpPortalConnection.lastMessageAt = now;
      }

      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (error) {
        this.logger.warn('PumpPortal message parse failed', error.message);
        return;
      }

      this.recordConnectionMessage(socket, payload);
      this.enqueueMessage(payload, connectionRole);
    });

    socket.on('close', (code, reasonBuffer) => {
      const now = Date.now();
      state.connected = false;
      state.lastDisconnectedAt = now;
      this.markRoleDisconnected(role, now);
      this.stats.closeEvents += 1;
      this.incrementRoleClose(role);
      this.stats.lastDisconnectedAt = now;
      this.stats.lastConnectionAgeMs = state.lastConnectedAt
        ? now - state.lastConnectedAt
        : null;
      this.setRoleLastConnectionAge(role, this.stats.lastConnectionAgeMs);
      this.stats.lastCloseCode = Number(code || 0) || 0;
      this.stats.lastCloseReason = reasonBuffer ? reasonBuffer.toString() : '';
      this.setRoleCloseReason(role, this.stats.lastCloseCode, this.stats.lastCloseReason);
      if (this.stats.lastCloseCode === 1006) {
        this.postCloseTradestreamGateUntilMs = now + this.postCloseTradestreamDelayMs;
        this.stats.postCloseTradestreamGateUntilMs = this.postCloseTradestreamGateUntilMs;
      }
      const connectionStats = this.finalizeConnectionStats(socket);
      this.stopHealthCheck(state);
      this.stopHeartbeat(state);
      this.clearReconnectDelayResetTimer(state);
      this.clearResubscribeTimer(state);
      this.logger.warn('PumpPortal websocket closed', {
        role,
        splitSocketsEnabled: this.useSplitSockets,
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        reconnectDelayMs: state.currentReconnectDelayMs,
        connectionPingsSent: socket.pumpPortalHeartbeat?.pingsSent || 0,
        connectionPongsReceived: socket.pumpPortalHeartbeat?.pongsReceived || 0,
        connectionMessages: connectionStats.messages,
        connectionMessagesPerMinute: connectionStats.messagesPerMinute,
        lastMessageAgeMsAtClose: connectionStats.lastMessageAgeMsAtClose
      });
      this.emitLifecycle('provider.pumpportal.closed', {
        role,
        splitSocketsEnabled: this.useSplitSockets,
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        reconnectDelayMs: state.currentReconnectDelayMs,
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
      if (state.ws === socket) {
        state.ws = null;
      }
      this.refreshConnectionState();
      if (this.running) {
        this.stats.reconnectAttempts += 1;
        this.incrementRoleReconnect(role);
        const delayMs = this.nextReconnectDelayMs(state);
        state.reconnectTimer = setTimeout(() => {
          state.reconnectTimer = null;
          this.connectRole(role);
        }, delayMs);
        if (typeof state.reconnectTimer.unref === 'function') {
          state.reconnectTimer.unref();
        }
      }
    });

    socket.on('error', (error) => {
      const now = Date.now();
      this.stats.lastErrorAt = now;
      this.stats.lastErrorMessage = error.message;
      this.setRoleError(role, now, error.message);
      this.logger.warn('PumpPortal websocket error', { role, errorMessage: error.message });
      this.emitLifecycle('provider.pumpportal.websocket_error', {
        role,
        splitSocketsEnabled: this.useSplitSockets,
        errorMessage: error.message,
        subscribedMints: this.subscribedMints.size,
        subscribedAccounts: this.subscribedAccounts.size
      });
    });

    socket.on('pong', () => {
      if (state.ws !== socket) return;
      this.stats.pongsReceived += 1;
      this.stats.lastPongAt = Date.now();
      state.lastPongAt = this.stats.lastPongAt;
      this.incrementRolePong(role, this.stats.lastPongAt);
      if (socket.pumpPortalHeartbeat) {
        socket.pumpPortalHeartbeat.pongsReceived += 1;
        socket.pumpPortalHeartbeat.lastPongAt = this.stats.lastPongAt;
      }
    });
  }

  enqueueMessage(payload, sourceRole = 'unknown') {
    if (this.eventQueue.length >= this.eventQueueMaxSize) {
      this.eventQueue.shift();
      this.stats.eventQueueDropped += 1;
      this.stats.eventQueueLastDroppedAt = Date.now();
    }

    this.eventQueue.push({ payload, sourceRole });
    this.stats.eventQueueDepth = this.eventQueue.length;
    this.stats.eventQueueMaxDepth = Math.max(this.stats.eventQueueMaxDepth || 0, this.eventQueue.length);
    this.drainEventQueue();
  }

  drainEventQueue() {
    while (this.processingEvents < this.eventHandlerConcurrency && this.eventQueue.length > 0) {
      const item = this.eventQueue.shift();
      const payload = item?.payload ?? item;
      const sourceRole = item?.sourceRole || 'unknown';
      this.stats.eventQueueDepth = this.eventQueue.length;
      this.processingEvents += 1;
      this.stats.eventQueueProcessingActive = this.processingEvents;

      Promise.resolve()
        .then(() => this.handleMessage(payload, sourceRole))
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

  async handleMessage(payload, sourceRole = 'unknown') {
    const method = payload.method || payload.type || payload.txType || '';
    const mint = payload.mint || payload.token || payload.mintAddress;
    const account = payload.traderPublicKey || payload.wallet || payload.account;
    const eventRole = sourceRole === 'combined' || sourceRole === 'unknown'
      ? this.classifyPayloadRole(payload, method, mint, account)
      : sourceRole;

    if (this.stats[eventRole]) {
      this.stats[eventRole].messages += 1;
      this.stats[eventRole].lastMessageAt = Date.now();
    }

    this.recordSubscriptionAck(payload, eventRole);

    if (method === 'newToken' || method === 'subscribeNewToken' || payload.txType === 'create') {
      this.stats.newTokens += 1;
      if (this.stats[eventRole]) this.stats[eventRole].newTokens += 1;
      this.recordPairShape('newToken', payload, eventRole);
      this.captureSample('newToken', payload);

      if (mint) {
        this.touchSubscribedMint(mint);
      }

      if (!this.backupOnly && mint && !this.subscribedMints.has(mint) && this.tradeSubscriptionMode === 'all_discovered') {
        if (this.canUsePaidTradeStreams() && this.meteredTradeBudgetAllowsSubscriptions() && this.reserveMintSubscriptionSlot(mint)) {
          this.subscribeTokenTrade(mint);
        } else if (this.canUsePaidTradeStreams() && !this.meteredTradeBudgetAllowsSubscriptions()) {
          this.stats.tradeSubscriptionsSkippedBudget += 1;
        } else if (!this.canUsePaidTradeStreams() && !this.skippedPaidStreamMints.has(mint)) {
          this.skippedPaidStreamMints.add(mint);
          this.subscribedMints.add(mint);
          this.stats.tradeSubscriptionsSkippedNoApiKey = this.skippedPaidStreamMints.size;
        }
      } else if (!this.backupOnly && mint && !this.subscribedMints.has(mint) && this.tradeSubscriptionMode === 'targeted_curve') {
        this.stats.targetedTradeSubscriptionsDeferredAtDiscovery += 1;
      }

      if (!this.backupOnly && this.handlers.onNewToken) {
        await this.handlers.onNewToken({
          ...payload,
          source: 'pumpportal_create'
        });
      }

      return;
    }

    if (this.isMigrationPayload(payload, method)) {
      this.stats.migrations += 1;
      if (this.stats[eventRole]) this.stats[eventRole].migrations += 1;
      this.recordPairShape('migration', payload, eventRole);
      this.captureSample('migration', payload);
      if (this.handlers.onMigration) {
        await this.handlers.onMigration({
          ...payload,
          source: 'pumpportal_migration'
        });
      }
      return;
    }

    const isTrackedAccountTrade = Boolean(account && this.subscribedAccounts.has(account));
    if (isTrackedAccountTrade) {
      this.stats.accountTrades += 1;
      if (this.stats[eventRole]) this.stats[eventRole].accountTrades += 1;
      if (!mint) this.stats.unmatchedAccountTrades += 1;
    }

    if (mint) {
      this.touchSubscribedMint(mint);
      this.stats.trades += 1;
      if (this.stats[eventRole]) this.stats[eventRole].trades += 1;
      this.recordPairShape('trade', payload, eventRole);
      this.captureSample('trade', payload);
      if (!this.backupOnly && this.handlers.onTrade) {
        await this.handlers.onTrade({
          ...payload,
          source: 'pumpportal_trade'
        });
      }
    }

    if (mint || isTrackedAccountTrade) {
      this.stats.meteredTradeEvents += 1;
      this.enforceMeteredTradeBudget();
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

  classifyPayloadRole(payload = {}, method = '', mint = null, account = null) {
    const message = typeof payload?.message === 'string' ? payload.message : '';
    if (message && (message.toLowerCase().includes('subscribed') || message.toLowerCase().includes('unsubscribed'))) {
      return this.roleForSubscriptionAckKind(this.classifySubscriptionAck(message, payload));
    }
    if (method === 'newToken' || method === 'subscribeNewToken' || payload.txType === 'create') {
      return 'discovery';
    }
    if (this.isMigrationPayload(payload, method)) {
      return 'discovery';
    }
    if (account && this.subscribedAccounts.has(account) && !mint) {
      return 'discovery';
    }
    return mint ? 'tradestream' : 'discovery';
  }

  roleForSubscriptionAckKind(kind) {
    return kind === 'token_trade' ? 'tradestream' : 'discovery';
  }

  recordSubscriptionAck(payload, sourceRole = 'unknown') {
    const message = typeof payload?.message === 'string' ? payload.message : '';
    if (!message) return;

    const normalized = message.toLowerCase();
    if (!normalized.includes('subscribed') && !normalized.includes('unsubscribed')) {
      return;
    }

    const kind = this.classifySubscriptionAck(message, payload);
    const targetRole = this.stats[sourceRole]
      ? sourceRole
      : this.roleForSubscriptionAckKind(kind);
    this.stats.subscriptionAckMessages += 1;
    this.stats.lastSubscriptionAckAt = Date.now();
    this.stats.lastSubscriptionAckMessage = message;
    this.stats.lastSubscriptionAckKind = kind;
    if (this.stats[targetRole]) {
      this.stats[targetRole].subscriptionAckMessages += 1;
    }

    if (kind === 'new_token') {
      this.stats.newTokenSubscriptionAcks += 1;
      if (this.stats[targetRole]) this.stats[targetRole].newTokenSubscriptionAcks += 1;
    } else if (kind === 'migration') {
      this.stats.migrationSubscriptionAcks += 1;
      if (this.stats[targetRole]) this.stats[targetRole].migrationSubscriptionAcks += 1;
    } else if (kind === 'token_trade') {
      this.stats.tokenTradeSubscriptionAcks += 1;
      if (this.stats[targetRole]) this.stats[targetRole].tokenTradeSubscriptionAcks += 1;
    } else if (kind === 'account_trade') {
      this.stats.accountTradeSubscriptionAcks += 1;
      if (this.stats[targetRole]) this.stats[targetRole].accountTradeSubscriptionAcks += 1;
    } else {
      this.stats.unknownSubscriptionAcks += 1;
      if (this.stats[targetRole]) this.stats[targetRole].unknownSubscriptionAcks += 1;
    }
  }

  buildConnectionStats(role = 'unknown') {
    return {
      role,
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
    const ageMs = closedAt - Number(connection.openedAt || closedAt);
    const minutes = ageMs > 0 ? ageMs / 60000 : 0;
    return {
      ...connection,
      messagesPerMinute: minutes > 0 ? Number((Number(connection.messages || 0) / minutes).toFixed(4)) : null,
      lastMessageAgeMsAtClose: connection.lastMessageAt ? closedAt - connection.lastMessageAt : null
    };
  }

  recordPairShape(kind, payload = {}, sourceRole = 'unknown') {
    const pairBase = this.detectPairBase(payload);
    if (pairBase === 'USDC') {
      this.stats.pairUsdcEvents += 1;
      this.stats[`${kind}PairUsdcEvents`] += 1;
      if (this.stats[sourceRole]) this.stats[sourceRole].pairUsdcEvents += 1;
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
      if (this.stats[sourceRole]) this.stats[sourceRole].pairSolEvents += 1;
      this.stats.lastDetectedPairBase = 'SOL';
      this.stats.lastDetectedPairAt = Date.now();
      return;
    }

    this.stats.pairUnknownEvents += 1;
    this.stats[`${kind}PairUnknownEvents`] += 1;
    if (this.stats[sourceRole]) this.stats[sourceRole].pairUnknownEvents += 1;
    this.captureSample('unknownPair', {
      kind,
      detectedPairBase: pairBase,
      payload
    });
  }

  detectPairBase(payload = {}) {
    const pairHints = this.flattenPairHintTokens(payload);
    const hasUsdc = pairHints.some((value) => (
      value === USDC_MINT
      || value === 'USDC'
      || value.includes('USDC')
      || value.includes('USD COIN')
    ));
    if (hasUsdc) return 'USDC';

    const hasSol = pairHints.some((value) => (
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

  flattenPairHintTokens(value, depth = 0, output = [], parentKey = '') {
    if (depth > 4 || value === null || value === undefined) return output;
    const key = String(parentKey || '').toLowerCase();
    const isPairHintKey = key.includes('quote')
      || key.includes('pair')
      || key.includes('base')
      || key.includes('currency')
      || key.includes('denom')
      || key.includes('asset')
      || key.includes('tokena')
      || key.includes('tokenb')
      || key.includes('minta')
      || key.includes('mintb');

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      if (isPairHintKey) output.push(String(value).trim().toUpperCase());
      return output;
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 50)) {
        this.flattenPairHintTokens(item, depth + 1, output, parentKey);
      }
      return output;
    }
    if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value).slice(0, 100)) {
        this.flattenPairHintTokens(item, depth + 1, output, key);
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

  meteredTradeBudgetAllowsSubscriptions() {
    return !this.meteredTradeBudgetReached;
  }

  enforceMeteredTradeBudget() {
    const limit = this.maxMeteredTradeEventsPerSession;
    if (this.meteredTradeBudgetReached || !Number.isFinite(limit) || limit <= 0 || this.stats.meteredTradeEvents < limit) {
      return false;
    }

    this.meteredTradeBudgetReached = true;
    this.stats.meteredTradeBudgetReached = true;
    this.stats.meteredTradeBudgetReachedAt = Date.now();
    const subscribedMints = Array.from(this.subscribedMints);
    const subscribedAccounts = Array.from(this.subscribedAccounts);
    const tradeState = this.connections.tradestream;
    const accountState = this.connections.discovery;
    this.clearResubscribeTimer(tradeState);
    if (accountState !== tradeState) this.clearResubscribeTimer(accountState);

    let tokenUnsubscribeSent = false;
    let accountUnsubscribeSent = false;
    if (subscribedMints.length > 0 && tradeState.ws && tradeState.ws.readyState === WebSocket.OPEN) {
      this.send({ method: 'unsubscribeTokenTrade', keys: subscribedMints }, 'tradestream');
      this.stats.tokenTradeUnsubscribeFrames += 1;
      this.stats.tradestream.tokenTradeUnsubscribeFrames += 1;
      tokenUnsubscribeSent = true;
    }
    if (subscribedAccounts.length > 0 && accountState.ws && accountState.ws.readyState === WebSocket.OPEN) {
      this.send({ method: 'unsubscribeAccountTrade', keys: subscribedAccounts }, 'discovery');
      this.stats.accountTradeUnsubscribeFrames += 1;
      this.stats.discovery.accountTradeUnsubscribeFrames = Number(this.stats.discovery.accountTradeUnsubscribeFrames || 0) + 1;
      accountUnsubscribeSent = true;
    }

    this.subscribedMints.clear();
    this.subscribedMintMeta.clear();
    this.subscribedAccounts.clear();
    this.emitLifecycle('provider.pumpportal.metered_budget_reached', {
      trades: this.stats.trades,
      meteredTradeEvents: this.stats.meteredTradeEvents,
      maxMeteredTradeEventsPerSession: limit,
      estimatedChargeSol: Number((Math.floor(this.stats.meteredTradeEvents / 10000) * 0.01).toFixed(4)),
      unsubscribedMints: subscribedMints.length,
      unsubscribedAccounts: subscribedAccounts.length,
      tokenUnsubscribeSent,
      accountUnsubscribeSent
    });
    this.logger.warn('PumpPortal metered trade-event budget reached; paid streams disabled for this session', {
      trades: this.stats.trades,
      meteredTradeEvents: this.stats.meteredTradeEvents,
      maxMeteredTradeEventsPerSession: limit,
      unsubscribedMints: subscribedMints.length,
      unsubscribedAccounts: subscribedAccounts.length,
      tokenUnsubscribeSent,
      accountUnsubscribeSent
    });
    return true;
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
    }, 'tradestream');
    if (sent) {
      this.stats.tokenTradeSubscribeFrames += 1;
      this.stats.tradestream.tokenTradeSubscribeFrames += 1;
    }
  }

  targetMint(mint, metadata = {}) {
    if (!mint || this.backupOnly || this.tradeSubscriptionMode !== 'targeted_curve') return false;
    this.stats.targetedTradeSubscriptionCandidates += 1;
    if (this.subscribedMints.has(mint)) {
      this.touchSubscribedMint(mint);
      this.stats.targetedTradeSubscriptionAlreadyActive += 1;
      return true;
    }
    if (!this.canUsePaidTradeStreams()) {
      this.stats.targetedTradeSubscriptionSkippedNoApiKey += 1;
      return false;
    }
    if (!this.meteredTradeBudgetAllowsSubscriptions()) {
      this.stats.targetedTradeSubscriptionSkippedBudget += 1;
      this.stats.tradeSubscriptionsSkippedBudget += 1;
      return false;
    }
    if (!this.reserveMintSubscriptionSlot(mint)) {
      this.stats.targetedTradeSubscriptionSkippedMaxActive += 1;
      return false;
    }
    this.subscribeTokenTrade(mint);
    this.stats.targetedTradeSubscriptionAccepted += 1;
    const reason = String(metadata.reason || 'curve_prefilter');
    this.stats.targetedTradeSubscriptionReasonCounts[reason] = (this.stats.targetedTradeSubscriptionReasonCounts[reason] || 0) + 1;
    this.emitLifecycle('provider.pumpportal.targeted_subscription', {
      mint,
      reason,
      curveProgress: Number.isFinite(Number(metadata.curveProgress)) ? Number(metadata.curveProgress) : null,
      curveProgressSource: metadata.curveProgressSource || null,
      score: Number.isFinite(Number(metadata.score)) ? Number(metadata.score) : null,
      activeSubscriptions: this.subscribedMints.size,
      meteredTradeEvents: this.stats.meteredTradeEvents,
      maxMeteredTradeEventsPerSession: this.maxMeteredTradeEventsPerSession
    });
    return true;
  }

  unsubscribeTokenTrade(mint, reason = 'unknown') {
    if (!this.subscribedMints.has(mint)) return false;
    this.dropMintSubscription(mint);
    this.stats.tokenTradeUnsubscriptions += 1;
    this.stats.tokenTradeSubscriptionPrunes += 1;
    if (reason === 'ttl') {
      this.stats.tokenTradeTtlPrunes += 1;
    }
    if (reason === 'max_active') {
      this.stats.tokenTradeMaxActivePrunes += 1;
    }
    if (reason === 'migration' || reason === 'bonding_curve_complete') {
      this.stats.tokenTradeTerminalPrunes += 1;
    }
    const state = this.connections.tradestream;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      const sent = this.send({
        method: 'unsubscribeTokenTrade',
        keys: [mint]
      }, 'tradestream');
      if (sent) {
        this.stats.tokenTradeUnsubscribeFrames += 1;
        this.stats.tradestream.tokenTradeUnsubscribeFrames += 1;
      }
    }
    this.emitLifecycle('provider.pumpportal.targeted_unsubscription', {
      mint,
      reason,
      activeSubscriptions: this.subscribedMints.size,
      meteredTradeEvents: this.stats.meteredTradeEvents,
      maxMeteredTradeEventsPerSession: this.maxMeteredTradeEventsPerSession
    });
    return true;
  }

  dropMintSubscription(mint) {
    this.subscribedMints.delete(mint);
    this.subscribedMintMeta.delete(mint);
    this.skippedPaidStreamMints.delete(mint);
  }

  resetReconnectDelay(state = this.connections.discovery) {
    state.currentReconnectDelayMs = this.reconnectDelayMs;
    this.currentReconnectDelayMs = Math.max(...Object.values(this.connections).map((connection) => (
      Number(connection.currentReconnectDelayMs || this.reconnectDelayMs)
    )));
    this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
    this.forLogicalRoles(state.role, (roleStats) => {
      roleStats.reconnectDelayMs = state.currentReconnectDelayMs;
    });
  }

  scheduleReconnectDelayReset(state, socket) {
    this.clearReconnectDelayResetTimer(state);

    state.reconnectDelayResetTimer = setTimeout(() => {
      state.reconnectDelayResetTimer = null;
      if (!this.running || state.ws !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      this.resetReconnectDelay(state);
      this.stats.reconnectDelayStableResets += 1;
      this.forLogicalRoles(state.role, (roleStats) => {
        roleStats.reconnectDelayStableResets += 1;
      });
    }, this.reconnectDelayResetAfterStableMs);

    if (typeof state.reconnectDelayResetTimer.unref === 'function') {
      state.reconnectDelayResetTimer.unref();
    }
  }

  clearReconnectDelayResetTimer(state) {
    if (state?.reconnectDelayResetTimer) {
      clearTimeout(state.reconnectDelayResetTimer);
      state.reconnectDelayResetTimer = null;
    }
  }

  nextReconnectDelayMs(state = this.connections.discovery) {
    if (this.useSplitSockets && state.role === 'discovery') {
      const base = Math.min(
        2000,
        Math.max(500, Number(this.reconnectDelayMs) || 1000)
      );
      const jitterMs = Math.floor(Math.random() * 500);
      state.currentReconnectDelayMs = base;
      this.currentReconnectDelayMs = Math.max(...Object.values(this.connections).map((connection) => (
        Number(connection.currentReconnectDelayMs || this.reconnectDelayMs)
      )));
      this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
      this.forLogicalRoles(state.role, (roleStats) => {
        roleStats.reconnectDelayMs = state.currentReconnectDelayMs;
      });
      return base + jitterMs;
    }

    const base = Number.isFinite(state.currentReconnectDelayMs) && state.currentReconnectDelayMs > 0
      ? state.currentReconnectDelayMs
      : this.reconnectDelayMs;
    const maxDelay = Number.isFinite(this.maxReconnectDelayMs) && this.maxReconnectDelayMs > 0
      ? Math.max(base, this.maxReconnectDelayMs)
      : base;
    const jitterMs = Math.floor(Math.random() * Math.min(1000, base));
    const delayMs = Math.min(maxDelay, base + jitterMs);
    state.currentReconnectDelayMs = Math.min(maxDelay, Math.max(this.reconnectDelayMs, base * 2));
    this.currentReconnectDelayMs = Math.max(...Object.values(this.connections).map((connection) => (
      Number(connection.currentReconnectDelayMs || this.reconnectDelayMs)
    )));
    this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
    this.forLogicalRoles(state.role, (roleStats) => {
      roleStats.reconnectDelayMs = state.currentReconnectDelayMs;
    });
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

    if (!this.meteredTradeBudgetAllowsSubscriptions()) {
      this.stats.accountSubscriptionsSkippedBudget += this.config.pumpPortalTrackedAccounts.length;
      return;
    }

    for (const account of this.config.pumpPortalTrackedAccounts) {
      this.subscribedAccounts.add(account);
      this.send({
        method: 'subscribeAccountTrade',
        keys: [account]
      }, 'discovery');
    }
  }

  subscribeTrackedMints() {
    if (!this.canUsePaidTradeStreams() || !this.meteredTradeBudgetAllowsSubscriptions()) {
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
    const state = this.connections.tradestream;
    state.pendingResubscribeMints = mints;
    this.stats.tokenTradeReconnectResubscribeScheduled += scheduledMints;
    this.flushResubscribeBatch(state);

    this.logger.info('Scheduled PumpPortal trade stream re-subscriptions', {
      trackedMints: ranked.length,
      scheduledMints,
      droppedMints: dropped.length,
      batchSize: this.reconnectResubscribeBatchSize,
      batchDelayMs: this.reconnectResubscribeBatchDelayMs
    });
  }

  clearResubscribeTimer(state = this.connections.tradestream) {
    if (state.resubscribeTimer) {
      clearTimeout(state.resubscribeTimer);
      state.resubscribeTimer = null;
    }
    state.pendingResubscribeMints = [];
  }

  flushResubscribeBatch(state = this.connections.tradestream) {
    state.resubscribeTimer = null;

    if (!this.running || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
      state.pendingResubscribeMints = [];
      return;
    }

    const waitMs = this.postCloseTradestreamGateUntilMs - Date.now();
    if (waitMs > 0) {
      state.resubscribeTimer = setTimeout(() => this.flushResubscribeBatch(state), waitMs);
      if (typeof state.resubscribeTimer.unref === 'function') {
        state.resubscribeTimer.unref();
      }
      return;
    }

    const batchSize = Number.isFinite(this.reconnectResubscribeBatchSize) && this.reconnectResubscribeBatchSize > 0
      ? this.reconnectResubscribeBatchSize
      : state.pendingResubscribeMints.length;
    const batch = state.pendingResubscribeMints.splice(0, batchSize);

    for (const mint of batch) {
      if (!this.subscribedMints.has(mint)) continue;
      this.subscribeTokenTrade(mint);
      this.stats.tokenTradeReconnectResubscribeSent += 1;
    }

    if (state.pendingResubscribeMints.length === 0) {
      return;
    }

    const delayMs = Number.isFinite(this.reconnectResubscribeBatchDelayMs) && this.reconnectResubscribeBatchDelayMs >= 0
      ? this.reconnectResubscribeBatchDelayMs
      : 0;
    state.resubscribeTimer = setTimeout(() => this.flushResubscribeBatch(state), delayMs);
    if (typeof state.resubscribeTimer.unref === 'function') {
      state.resubscribeTimer.unref();
    }
  }

  startHealthCheck(state) {
    this.stopHealthCheck(state);

    if (!Number.isFinite(this.healthCheckIntervalMs) || this.healthCheckIntervalMs <= 0) {
      return;
    }

    state.healthCheckTimer = setInterval(() => {
      this.checkConnectionHealth(state);
    }, this.healthCheckIntervalMs);

    if (typeof state.healthCheckTimer.unref === 'function') {
      state.healthCheckTimer.unref();
    }
  }

  stopHealthCheck(state) {
    if (state?.healthCheckTimer) {
      clearInterval(state.healthCheckTimer);
      state.healthCheckTimer = null;
    }
  }

  startHeartbeat(state, socket) {
    this.stopHeartbeat(state);

    if (!Number.isFinite(this.pingIntervalMs) || this.pingIntervalMs <= 0) {
      return;
    }

    state.pingTimer = setInterval(() => {
      if (!this.running || state.ws !== socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socket.ping();
        this.stats.pingsSent += 1;
        this.stats.lastPingAt = Date.now();
        this.forLogicalRoles(state.role, (roleStats) => {
          roleStats.pingsSent += 1;
          roleStats.lastPingAt = this.stats.lastPingAt;
        });
        if (socket.pumpPortalHeartbeat) {
          socket.pumpPortalHeartbeat.pingsSent += 1;
          socket.pumpPortalHeartbeat.lastPingAt = this.stats.lastPingAt;
        }
      } catch (error) {
        this.stats.lastErrorAt = Date.now();
        this.stats.lastErrorMessage = error.message;
        this.forLogicalRoles(state.role, (roleStats) => {
          roleStats.lastErrorAt = this.stats.lastErrorAt;
          roleStats.lastErrorMessage = error.message;
        });
        this.logger.warn('PumpPortal websocket ping failed', { role: state.role, errorMessage: error.message });
      }
    }, this.pingIntervalMs);

    if (typeof state.pingTimer.unref === 'function') {
      state.pingTimer.unref();
    }
  }

  stopHeartbeat(state) {
    if (state?.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = null;
    }
  }

  checkConnectionHealth(state) {
    if (!this.running || !state?.ws || state.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const staleConnectionMs = this.staleConnectionThresholdMs(state);
    if (!Number.isFinite(staleConnectionMs) || staleConnectionMs <= 0) {
      return;
    }

    const baselineAt = Math.max(
      Number(state.lastMessageAt || 0),
      Number(state.lastPongAt || 0),
      Number(state.lastConnectedAt || 0)
    );
    if (!baselineAt) {
      return;
    }

    const ageMs = Date.now() - baselineAt;
    if (ageMs < staleConnectionMs) {
      if (state.role === 'tradestream') this.pruneMintSubscriptions();
      return;
    }

    this.stats.staleReconnects += 1;
    this.forLogicalRoles(state.role, (roleStats) => {
      roleStats.staleReconnects += 1;
    });
    this.logger.warn('PumpPortal websocket stale; recycling connection', {
      role: state.role,
      ageMs,
      staleConnectionMs,
      subscribedMints: this.subscribedMints.size
    });
    this.emitLifecycle('provider.pumpportal.stale_reconnect', {
      role: state.role,
      ageMs,
      staleConnectionMs,
      subscribedMints: this.subscribedMints.size,
      subscribedAccounts: this.subscribedAccounts.size
    });

    const socket = state.ws;
    state.ws = null;
    state.connected = false;
    this.forLogicalRoles(state.role, (roleStats) => {
      roleStats.connected = false;
    });
    socket.removeAllListeners('close');
    socket.on('close', () => {});
    socket.terminate();
    this.stats.lastDisconnectedAt = Date.now();
    state.lastDisconnectedAt = this.stats.lastDisconnectedAt;
    this.stats.lastConnectionAgeMs = state.lastConnectedAt
      ? this.stats.lastDisconnectedAt - state.lastConnectedAt
      : null;
    this.forLogicalRoles(state.role, (roleStats) => {
      roleStats.lastConnectionAgeMs = this.stats.lastConnectionAgeMs;
    });
    this.stopHealthCheck(state);
    this.stopHeartbeat(state);
    this.refreshConnectionState();

    if (this.running && !state.reconnectTimer) {
      this.stats.reconnectAttempts += 1;
      this.forLogicalRoles(state.role, (roleStats) => {
        roleStats.reconnectAttempts += 1;
      });
      const delayMs = this.nextReconnectDelayMs(state);
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        this.connectRole(state.role);
      }, delayMs);
      if (typeof state.reconnectTimer.unref === 'function') {
        state.reconnectTimer.unref();
      }
    }
  }

  staleConnectionThresholdMs(state) {
    const configured = Number(this.staleConnectionMs);
    if (!Number.isFinite(configured) || configured <= 0) {
      return configured;
    }
    if (this.backupOnly) {
      return Math.max(configured, 5 * 60 * 1000);
    }
    if (this.useSplitSockets && state?.role === 'discovery') {
      return Math.max(configured, 5 * 60 * 1000);
    }
    return configured;
  }

  send(message, role = 'discovery') {
    const state = this.connections[role] || this.connections.discovery;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    state.ws.send(JSON.stringify(message));
    this.stats.controlFramesSent += 1;
    if (this.stats[role]) this.stats[role].controlFramesSent += 1;
    if (state.ws.pumpPortalConnection) {
      state.ws.pumpPortalConnection.controlFramesSent += 1;
    }
    return true;
  }

  clearConnectionTimers(state) {
    if (!state) return;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    this.clearReconnectDelayResetTimer(state);
    this.clearResubscribeTimer(state);
    this.stopHealthCheck(state);
    this.stopHeartbeat(state);
  }

  refreshConnectionState() {
    const sharedConnected = !this.useSplitSockets && this.connections.discovery.connected === true;
    const discoveryConnected = this.useSplitSockets
      ? this.connections.discovery.connected === true
      : sharedConnected;
    const tradestreamConnected = this.useSplitSockets
      ? this.connections.tradestream.connected === true
      : sharedConnected;
    const anyConnected = discoveryConnected || tradestreamConnected;
    const bothDown = !discoveryConnected && !tradestreamConnected;
    const now = Date.now();

    this.stats.connected = anyConnected;
    this.stats.discovery.connected = discoveryConnected;
    this.stats.tradestream.connected = tradestreamConnected;
    this.stats.discovery.subscribedAccounts = this.subscribedAccounts.size;
    this.stats.tradestream.subscribedMints = this.subscribedMints.size;

    if (bothDown && this.running && !this.stats.bothConnectionsDownStartedAt) {
      this.stats.bothConnectionsDownStartedAt = now;
      this.stats.bothConnectionsDownCount += 1;
    } else if (!bothDown && this.stats.bothConnectionsDownStartedAt) {
      this.stats.bothConnectionsDownMs += now - this.stats.bothConnectionsDownStartedAt;
      this.stats.bothConnectionsDownStartedAt = null;
    }
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
    this.refreshConnectionState();
    const bothConnectionsDownMs = this.stats.bothConnectionsDownStartedAt
      ? this.stats.bothConnectionsDownMs + (Date.now() - this.stats.bothConnectionsDownStartedAt)
      : this.stats.bothConnectionsDownMs;
    return {
      ...this.stats,
      backupOnly: this.backupOnly,
      bothConnectionsDownMs,
      splitSocketsEnabled: this.useSplitSockets,
      postCloseTradestreamDelayMs: this.postCloseTradestreamDelayMs,
      postCloseTradestreamGateUntilMs: this.postCloseTradestreamGateUntilMs,
      subscribedMints: this.subscribedMints.size,
      subscribedAccounts: this.subscribedAccounts.size,
      skippedPaidStreamMints: this.skippedPaidStreamMints.size,
      maxSubscribedMints: this.maxSubscribedMints,
      tradeSubscriptionMode: this.tradeSubscriptionMode,
      maxMeteredTradeEventsPerSession: this.maxMeteredTradeEventsPerSession,
      meteredTradeBudgetReached: this.meteredTradeBudgetReached,
      maxReconnectDelayMs: this.maxReconnectDelayMs,
      tokenTradeSubscriptionTtlMs: this.tokenTradeSubscriptionTtlMs,
      eventQueueDepth: this.eventQueue.length,
      eventQueueProcessingActive: this.processingEvents
    };
  }
}

module.exports = PumpPortalListener;
