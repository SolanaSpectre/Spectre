const WebSocket = require('ws');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'.toUpperCase();
const SOL_MINT = 'So11111111111111111111111111111111111111112'.toUpperCase();
const PUMP_TOKEN_DECIMALS = 6;
const PUMP_TOKEN_TOTAL_SUPPLY = 1_000_000_000;
const PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET = 279_900_000;
const LAMPORTS_PER_SOL = 1_000_000_000;

class PumpDevListener {
  constructor(config, logger, handlers = {}) {
    this.config = config;
    this.logger = logger;
    this.handlers = handlers;
    this.ws = null;
    this.running = false;
    this.url = config.pumpDevWebsocketUrl || 'wss://pumpdev.io/ws';
    this.feedMode = config.pumpDevFeedMode || 'shadow';
    this.drivesPreMigration = config.pumpDevDrivesPreMigration === true;
    this.maxSubscribedMints = Number(config.pumpDevMaxSubscribedMints || 100);
    this.pingIntervalMs = Number(config.pumpDevPingIntervalMs || 25000);
    this.reconnectDelayMs = Number(config.pumpDevReconnectDelayMs || 5000);
    this.maxReconnectDelayMs = Number(config.pumpDevMaxReconnectDelayMs || 30000);
    this.eventHandlerConcurrency = Math.max(1, Number(config.pumpDevEventHandlerConcurrency || 4));
    this.eventQueueMaxSize = Math.max(1, Number(config.pumpDevEventQueueMaxSize || 10000));
    this.currentReconnectDelayMs = this.reconnectDelayMs;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.eventQueue = [];
    this.activeEventHandlers = 0;
    this.eventQueueDrainScheduled = false;
    this.pendingTradeQueueByMint = new Map();
    this.tradeCoalesceQueueDepth = Math.max(0, Number(config.pumpDevTradeCoalesceQueueDepth || 500));
    this.subscribedMints = new Set();
    this.knownMints = new Set();
    this.stats = {
      enabled: Boolean(config.pumpDevShadowEnabled),
      feedMode: this.feedMode,
      drivesPreMigration: this.drivesPreMigration,
      connected: false,
      messages: 0,
      systemMessages: 0,
      newTokens: 0,
      trades: 0,
      migrations: 0,
      mintEvents: 0,
      providerCurveSnapshots: 0,
      providerCurveSolSnapshots: 0,
      providerCurveUsdcSnapshots: 0,
      unknownMessages: 0,
      parseErrors: 0,
      knownMints: 0,
      subscribedMints: 0,
      maxSubscribedMints: this.maxSubscribedMints,
      openEvents: 0,
      closeEvents: 0,
      errorEvents: 0,
      reconnectAttempts: 0,
      controlFramesSent: 0,
      tokenTradeSubscribeFrames: 0,
      eventQueueActive: 0,
      eventQueueDepth: 0,
      eventQueueMaxDepth: 0,
      eventQueueMaxSize: this.eventQueueMaxSize,
      eventHandlerConcurrency: this.eventHandlerConcurrency,
      eventQueueProcessed: 0,
      eventQueueDropped: 0,
      eventQueueTradeCoalesced: 0,
      eventQueueErrors: 0,
      eventQueueDiscardedOnStop: 0,
      pingsSent: 0,
      pongsReceived: 0,
      pingIntervalMs: this.pingIntervalMs,
      reconnectDelayMs: this.currentReconnectDelayMs,
      maxReconnectDelayMs: this.maxReconnectDelayMs,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastMessageAt: null,
      lastPingAt: null,
      lastPongAt: null,
      lastConnectionAgeMs: null,
      lastCloseCode: null,
      lastCloseReason: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      pairSolEvents: 0,
      pairUsdcEvents: 0,
      pairUnknownEvents: 0,
      newTokenPairSolEvents: 0,
      newTokenPairUsdcEvents: 0,
      newTokenPairUnknownEvents: 0,
      tradePairSolEvents: 0,
      tradePairUsdcEvents: 0,
      tradePairUnknownEvents: 0,
      mintEventPairSolEvents: 0,
      mintEventPairUsdcEvents: 0,
      mintEventPairUnknownEvents: 0,
      lastDetectedPairBase: null,
      lastDetectedPairAt: null,
      messageTypeCounts: {},
      firstSamples: {}
    };
  }

  async start() {
    if (!this.config.pumpDevShadowEnabled) {
      this.logger.info('PumpDev shadow listener disabled by config');
      return;
    }
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  async stop() {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.eventQueue.length > 0) {
      this.stats.eventQueueDiscardedOnStop += this.eventQueue.length;
      this.eventQueue = [];
      this.pendingTradeQueueByMint.clear();
      this.stats.eventQueueDepth = 0;
    }
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      socket.removeAllListeners();
      socket.on('error', () => {});
      try {
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) socket.close(1000, 'shutdown');
      } catch {}
    }
    this.stats.connected = false;
    this.stats.lastDisconnectedAt = Date.now();
  }

  connect() {
    if (!this.running) return;
    this.logger.info('Connecting to PumpDev shadow websocket...');
    const socket = new WebSocket(this.url);
    socket.pumpDevConnection = this.buildConnectionStats();
    this.ws = socket;

    socket.on('open', () => {
      const now = Date.now();
      this.stats.connected = true;
      this.stats.openEvents += 1;
      this.stats.lastConnectedAt = now;
      this.stats.lastCloseCode = null;
      this.stats.lastCloseReason = null;
      this.currentReconnectDelayMs = this.reconnectDelayMs;
      this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
      this.logger.info('PumpDev shadow websocket connected');
      this.send({ method: 'subscribeNewToken' });
      this.resubscribeTrackedMints();
      this.startHeartbeat(socket);
      this.emitLifecycle('provider.pumpdev.connected', {
        subscribedMints: this.subscribedMints.size,
        maxSubscribedMints: this.maxSubscribedMints,
        pingIntervalMs: this.pingIntervalMs
      });
    });

    socket.on('message', (raw) => {
      const now = Date.now();
      this.stats.messages += 1;
      this.stats.lastMessageAt = now;
      if (socket.pumpDevConnection) {
        socket.pumpDevConnection.messages += 1;
        socket.pumpDevConnection.lastMessageAt = now;
      }

      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        this.stats.parseErrors += 1;
        return;
      }

      this.enqueueMessage(payload, socket);
    });

    socket.on('close', (code, reasonBuffer) => {
      const now = Date.now();
      this.stats.connected = false;
      this.stats.closeEvents += 1;
      this.stats.lastDisconnectedAt = now;
      this.stats.lastConnectionAgeMs = this.stats.lastConnectedAt
        ? now - this.stats.lastConnectedAt
        : null;
      this.stats.lastCloseCode = Number(code || 0) || 0;
      this.stats.lastCloseReason = reasonBuffer ? reasonBuffer.toString() : '';
      const connectionStats = this.finalizeConnectionStats(socket);
      this.stopHeartbeat();
      this.logger.warn('PumpDev shadow websocket closed', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        connectionMessages: connectionStats.messages,
        connectionNewTokens: connectionStats.newTokens,
        connectionTrades: connectionStats.trades,
        connectionControlFramesSent: connectionStats.controlFramesSent
      });
      this.emitLifecycle('provider.pumpdev.closed', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason || 'none',
        connectionAgeMs: this.stats.lastConnectionAgeMs,
        subscribedMints: this.subscribedMints.size,
        connectionMessages: connectionStats.messages,
        connectionNewTokens: connectionStats.newTokens,
        connectionTrades: connectionStats.trades,
        connectionMintEvents: connectionStats.mintEvents,
        connectionControlFramesSent: connectionStats.controlFramesSent,
        connectionMessagesPerMinute: connectionStats.messagesPerMinute,
        lastMessageAgeMsAtClose: connectionStats.lastMessageAgeMsAtClose
      });
      if (this.ws === socket) this.ws = null;
      if (this.running) {
        this.stats.reconnectAttempts += 1;
        const delayMs = this.nextReconnectDelayMs();
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, delayMs);
        if (typeof this.reconnectTimer.unref === 'function') this.reconnectTimer.unref();
      }
    });

    socket.on('error', (error) => {
      this.stats.errorEvents += 1;
      this.stats.lastErrorAt = Date.now();
      this.stats.lastErrorMessage = error.message;
      this.logger.warn('PumpDev shadow websocket error', error.message);
      this.emitLifecycle('provider.pumpdev.websocket_error', {
        errorMessage: error.message,
        subscribedMints: this.subscribedMints.size
      });
    });

    socket.on('pong', () => {
      this.stats.pongsReceived += 1;
      this.stats.lastPongAt = Date.now();
      if (socket.pumpDevConnection) {
        socket.pumpDevConnection.pongsReceived += 1;
        socket.pumpDevConnection.lastPongAt = this.stats.lastPongAt;
      }
    });
  }

  enqueueMessage(payload, socket) {
    const txType = String(payload?.txType || '').toLowerCase();
    const mint = payload?.mint || payload?.token || payload?.mintAddress || null;
    if (
      this.tradeCoalesceQueueDepth > 0
      && this.eventQueue.length >= this.tradeCoalesceQueueDepth
      && mint
      && (txType === 'buy' || txType === 'sell')
    ) {
      const pending = this.pendingTradeQueueByMint.get(mint);
      if (pending) {
        pending.payload = payload;
        pending.socket = socket;
        pending.coalescedCount = (pending.coalescedCount || 0) + 1;
        this.stats.eventQueueTradeCoalesced += 1;
        return true;
      }
    }

    if (this.eventQueue.length >= this.eventQueueMaxSize) {
      this.stats.eventQueueDropped += 1;
      return false;
    }

    const item = {
      payload,
      socket,
      kind: (txType === 'buy' || txType === 'sell') ? 'trade' : 'other',
      mint,
      coalescedCount: 0
    };
    this.eventQueue.push(item);
    if (item.kind === 'trade' && item.mint) {
      this.pendingTradeQueueByMint.set(item.mint, item);
    }
    this.stats.eventQueueDepth = this.eventQueue.length;
    this.stats.eventQueueMaxDepth = Math.max(this.stats.eventQueueMaxDepth, this.eventQueue.length);
    this.scheduleDrainEventQueue();
    return true;
  }

  scheduleDrainEventQueue() {
    if (this.eventQueueDrainScheduled) {
      return;
    }

    this.eventQueueDrainScheduled = true;
    setImmediate(() => {
      this.eventQueueDrainScheduled = false;
      this.drainEventQueue();
    });
  }

  drainEventQueue() {
    let started = 0;
    while (
      this.running
      && this.activeEventHandlers < this.eventHandlerConcurrency
      && this.eventQueue.length > 0
    ) {
      const item = this.eventQueue.shift();
      if (item?.kind === 'trade' && item.mint && this.pendingTradeQueueByMint.get(item.mint) === item) {
        this.pendingTradeQueueByMint.delete(item.mint);
      }
      this.stats.eventQueueDepth = this.eventQueue.length;
      this.activeEventHandlers += 1;
      this.stats.eventQueueActive = this.activeEventHandlers;
      started += 1;
      new Promise((resolve) => setImmediate(resolve))
        .then(() => this.handleMessage(item.payload, item.socket))
        .then(() => {
          this.stats.eventQueueProcessed += 1;
        })
        .catch((error) => {
          this.stats.eventQueueErrors += 1;
          this.stats.errorEvents += 1;
          this.stats.lastErrorAt = Date.now();
          this.stats.lastErrorMessage = error.message;
          this.logger.warn('PumpDev shadow message handler failed', error.message);
        })
        .finally(() => {
          this.activeEventHandlers -= 1;
          this.stats.eventQueueActive = this.activeEventHandlers;
          this.stats.eventQueueDepth = this.eventQueue.length;
          if (this.eventQueue.length > 0) {
            this.scheduleDrainEventQueue();
          }
        });

      if (started >= this.eventHandlerConcurrency) {
        break;
      }
    }
  }

  async handleMessage(payload, socket) {
    const type = this.classifyMessage(payload);
    this.stats.messageTypeCounts[type] = (this.stats.messageTypeCounts[type] || 0) + 1;
    this.recordSample(type, payload);
    this.recordPairShape(type, payload);

    if (socket?.pumpDevConnection) {
      if (type === 'newToken') socket.pumpDevConnection.newTokens += 1;
      else if (type === 'trade') socket.pumpDevConnection.trades += 1;
      else if (type === 'mintEvent') socket.pumpDevConnection.mintEvents += 1;
    }

    if (type === 'system') {
      this.stats.systemMessages += 1;
      return;
    }

    const normalized = this.normalizePayload(payload, type);
    if (type === 'newToken') {
      this.stats.newTokens += 1;
      if (normalized.mint) {
        this.knownMints.add(normalized.mint);
        this.stats.knownMints = this.knownMints.size;
        this.maybeSubscribeMint(normalized.mint);
      }
      this.emitShadowEvent('provider.pumpdev.shadow_new_token', normalized);
      if (this.drivesPreMigration && typeof this.handlers.onNewToken === 'function') {
        await this.safeRuntimeHandler('onNewToken', normalized);
      }
      return;
    }

    if (type === 'trade') {
      this.stats.trades += 1;
      this.emitShadowEvent('provider.pumpdev.shadow_trade', normalized);
      if (this.drivesPreMigration && typeof this.handlers.onTrade === 'function') {
        await this.safeRuntimeHandler('onTrade', normalized);
      }
      return;
    }

    if (type === 'migration') {
      this.stats.migrations += 1;
      this.emitShadowEvent('provider.pumpdev.shadow_migration', normalized);
      return;
    }

    if (type === 'mintEvent') {
      this.stats.mintEvents += 1;
      this.emitShadowEvent('provider.pumpdev.shadow_mint_event', normalized);
      return;
    }

    this.stats.unknownMessages += 1;
    this.emitShadowEvent('provider.pumpdev.shadow_unknown', normalized);
  }

  classifyMessage(payload = {}) {
    const type = String(payload.type || '').toLowerCase();
    if (type === 'connected' || type === 'subscribed' || type === 'unsubscribed' || type === 'error') {
      return 'system';
    }
    const txType = String(payload.txType || '').toLowerCase();
    if (txType === 'create') return 'newToken';
    if (txType === 'buy' || txType === 'sell') return 'trade';
    if (txType === 'migrate' || txType === 'migration') return 'migration';
    if (payload.mint || payload.token || payload.mintAddress) return 'mintEvent';
    return 'unknown';
  }

  normalizePayload(payload = {}, type = 'unknown') {
    const quoteMint = payload.quoteMint || payload.poolQuoteMint || payload.baseMint || null;
    const pairBase = this.detectPairBase(payload);
    const providerCurveSnapshot = this.extractProviderCurveSnapshot(payload, pairBase);
    const source = payload.source || (type === 'newToken'
      ? 'pumpdev_create'
      : type === 'trade'
        ? 'pumpdev_trade'
        : type === 'mintEvent'
          ? 'pumpdev_mint_event'
          : 'pumpdev');
    return {
      provider: 'pumpdev',
      eventType: type,
      signature: payload.signature || null,
      mint: payload.mint || payload.token || payload.mintAddress || null,
      traderPublicKey: payload.traderPublicKey || payload.wallet || payload.account || payload.creator || null,
      txType: payload.txType || null,
      name: payload.name || null,
      symbol: payload.symbol || null,
      uri: payload.uri || null,
      bondingCurveKey: payload.bondingCurveKey || null,
      pool: payload.pool || null,
      source,
      tokenAmount: this.finiteOrNull(payload.tokenAmount || payload.initialBuy),
      quoteMint,
      quoteTokenDecimals: this.finiteOrNull(payload.quoteTokenDecimals),
      quoteAmount: this.finiteOrNull(payload.quoteAmount || payload.initialQuoteAmount),
      quoteAmountRaw: this.finiteOrNull(payload.quoteAmountRaw),
      solAmount: this.finiteOrNull(payload.solAmount),
      marketCapSol: this.finiteOrNull(payload.marketCapSol),
      marketCapQuote: this.finiteOrNull(payload.marketCapQuote),
      pairBase,
      ...providerCurveSnapshot,
      raw: payload
    };
  }

  extractProviderCurveSnapshot(payload = {}, pairBase = 'unknown') {
    const virtualTokenReservesRaw = this.finiteOrNull(payload.vTokensInBondingCurve);
    const virtualQuoteReservesRaw = this.finiteOrNull(payload.vQuoteInBondingCurve);
    const virtualSolReservesRaw = this.finiteOrNull(payload.vSolInBondingCurve);
    const quoteTokenDecimals = this.finiteOrNull(payload.quoteTokenDecimals);
    const quoteDecimals = Number.isFinite(quoteTokenDecimals)
      ? quoteTokenDecimals
      : (pairBase === 'SOL' ? 9 : 6);
    const virtualTokenReservesTokens = Number.isFinite(virtualTokenReservesRaw)
      ? virtualTokenReservesRaw / (10 ** PUMP_TOKEN_DECIMALS)
      : null;
    const virtualQuoteReservesUi = Number.isFinite(virtualQuoteReservesRaw)
      ? virtualQuoteReservesRaw / (10 ** quoteDecimals)
      : null;
    const virtualSolReservesSol = Number.isFinite(virtualSolReservesRaw)
      ? virtualSolReservesRaw / LAMPORTS_PER_SOL
      : (pairBase === 'SOL' && Number.isFinite(virtualQuoteReservesUi) ? virtualQuoteReservesUi : null);
    const providerCurveProgress = this.computeProviderCurveProgress(virtualTokenReservesTokens);
    const providerCurvePriceSol = Number.isFinite(virtualSolReservesSol)
      && Number.isFinite(virtualTokenReservesTokens)
      && virtualTokenReservesTokens > 0
      ? virtualSolReservesSol / virtualTokenReservesTokens
      : null;

    if (!Number.isFinite(providerCurveProgress)) {
      return {};
    }

    this.stats.providerCurveSnapshots += 1;
    if (pairBase === 'SOL') this.stats.providerCurveSolSnapshots += 1;
    else if (pairBase === 'USDC') this.stats.providerCurveUsdcSnapshots += 1;

    return {
      providerCurveProgress,
      providerCurveSource: 'pumpdev_virtual_reserves',
      providerCurveSnapshotAt: Date.now(),
      providerVirtualTokenReservesRaw: virtualTokenReservesRaw,
      providerVirtualQuoteReservesRaw: virtualQuoteReservesRaw,
      providerVirtualSolReservesRaw: virtualSolReservesRaw,
      virtualTokenReservesTokens,
      virtualQuoteReservesUi,
      virtualSolReservesSol,
      providerCurvePriceSol,
      providerCurveQuoteDecimals: quoteDecimals
    };
  }

  computeProviderCurveProgress(virtualTokenReservesTokens) {
    if (!Number.isFinite(virtualTokenReservesTokens) || virtualTokenReservesTokens <= 0) {
      return null;
    }

    const realTokenReservesTokens = virtualTokenReservesTokens - PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET;
    const progress = 1 - (realTokenReservesTokens / PUMP_TOKEN_TOTAL_SUPPLY);
    return Number(Math.max(0, Math.min(progress, 1)).toFixed(6));
  }

  finiteOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  maybeSubscribeMint(mint) {
    if (!mint || this.subscribedMints.has(mint)) return;
    if (this.subscribedMints.size >= this.maxSubscribedMints) return;
    this.subscribedMints.add(mint);
    this.stats.subscribedMints = this.subscribedMints.size;
    const sent = this.send({ method: 'subscribeTokenTrade', keys: [mint] });
    if (sent) this.stats.tokenTradeSubscribeFrames += 1;
  }

  resubscribeTrackedMints() {
    for (const mint of this.subscribedMints) {
      this.send({ method: 'subscribeTokenTrade', keys: [mint] });
    }
  }

  recordPairShape(type, payload) {
    const pairBase = this.detectPairBase(payload);
    const normalizedType = type === 'mintEvent' ? 'mintEvent' : type;
    if (pairBase === 'SOL') {
      this.stats.pairSolEvents += 1;
      if (this.stats[`${normalizedType}PairSolEvents`] !== undefined) {
        this.stats[`${normalizedType}PairSolEvents`] += 1;
      }
      this.stats.lastDetectedPairBase = 'SOL';
      this.stats.lastDetectedPairAt = Date.now();
    } else if (pairBase === 'USDC') {
      this.stats.pairUsdcEvents += 1;
      if (this.stats[`${normalizedType}PairUsdcEvents`] !== undefined) {
        this.stats[`${normalizedType}PairUsdcEvents`] += 1;
      }
      this.stats.lastDetectedPairBase = 'USDC';
      this.stats.lastDetectedPairAt = Date.now();
      this.recordSample('usdcPair', payload);
    } else {
      this.stats.pairUnknownEvents += 1;
      if (this.stats[`${normalizedType}PairUnknownEvents`] !== undefined) {
        this.stats[`${normalizedType}PairUnknownEvents`] += 1;
      }
      this.recordSample('unknownPair', payload);
    }
  }

  detectPairBase(payload = {}) {
    const quoteMint = String(payload.quoteMint || payload.poolQuoteMint || payload.quote || '').trim().toUpperCase();
    if (quoteMint === SOL_MINT) return 'SOL';
    if (quoteMint === USDC_MINT) return 'USDC';
    if (Number.isFinite(Number(payload.solAmount)) || Number.isFinite(Number(payload.marketCapSol))) return 'SOL';
    if (Number.isFinite(Number(payload.usdcAmount)) || Number.isFinite(Number(payload.marketCapUsdc))) return 'USDC';
    return 'unknown';
  }

  recordSample(type, payload) {
    if (!type || this.stats.firstSamples[type]) return;
    this.stats.firstSamples[type] = {
      capturedAt: new Date().toISOString(),
      keys: Object.keys(payload || {}).sort(),
      payload
    };
  }

  startHeartbeat(socket) {
    this.stopHeartbeat();
    if (!Number.isFinite(this.pingIntervalMs) || this.pingIntervalMs <= 0) return;
    this.pingTimer = setInterval(() => {
      if (!this.running || this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.ping();
        this.stats.pingsSent += 1;
        this.stats.lastPingAt = Date.now();
        if (socket.pumpDevConnection) {
          socket.pumpDevConnection.pingsSent += 1;
          socket.pumpDevConnection.lastPingAt = this.stats.lastPingAt;
        }
      } catch (error) {
        this.stats.errorEvents += 1;
        this.stats.lastErrorAt = Date.now();
        this.stats.lastErrorMessage = error.message;
        this.logger.warn('PumpDev shadow websocket ping failed', error.message);
      }
    }, this.pingIntervalMs);
    if (typeof this.pingTimer.unref === 'function') this.pingTimer.unref();
  }

  stopHeartbeat() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
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

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    this.stats.controlFramesSent += 1;
    if (this.ws.pumpDevConnection) this.ws.pumpDevConnection.controlFramesSent += 1;
    return true;
  }

  buildConnectionStats() {
    return {
      openedAt: Date.now(),
      messages: 0,
      newTokens: 0,
      trades: 0,
      mintEvents: 0,
      controlFramesSent: 0,
      pingsSent: 0,
      pongsReceived: 0,
      lastMessageAt: null,
      lastPingAt: null,
      lastPongAt: null
    };
  }

  finalizeConnectionStats(socket) {
    const closedAt = Date.now();
    const connection = socket?.pumpDevConnection || this.buildConnectionStats();
    const ageMs = closedAt - Number(connection.openedAt || closedAt);
    const minutes = ageMs > 0 ? ageMs / 60000 : 0;
    return {
      ...connection,
      ageMs,
      messagesPerMinute: minutes > 0 ? connection.messages / minutes : null,
      lastMessageAgeMsAtClose: connection.lastMessageAt ? closedAt - connection.lastMessageAt : null
    };
  }

  emitLifecycle(type, payload = {}) {
    if (typeof this.handlers.onLifecycle !== 'function') return;
    try {
      this.handlers.onLifecycle(type, {
        ...payload,
        provider: 'pumpdev',
        reportOnly: true
      });
    } catch {
      // Shadow telemetry must never affect runtime intake.
    }
  }

  emitShadowEvent(type, payload = {}) {
    if (typeof this.handlers.onShadowEvent !== 'function') return;
    try {
      this.handlers.onShadowEvent(type, {
        ...payload,
        reportOnly: true
      });
    } catch {
      // Shadow telemetry must never affect runtime intake.
    }
  }

  async safeRuntimeHandler(handlerName, payload = {}) {
    const handler = this.handlers[handlerName];
    if (typeof handler !== 'function') return;
    try {
      await handler({
        ...payload,
        provider: 'pumpdev',
        source: payload.source || 'pumpdev',
        rawEvent: payload.raw || payload
      });
    } catch (error) {
      this.stats.errorEvents += 1;
      this.stats.lastErrorAt = Date.now();
      this.stats.lastErrorMessage = error.message;
      this.logger.warn('PumpDev runtime handler failed', {
        handlerName,
        mint: payload.mint || null,
        error: error.message
      });
      this.emitLifecycle('provider.pumpdev.runtime_handler_error', {
        handlerName,
        mint: payload.mint || null,
        errorMessage: error.message
      });
    }
  }

  getStats() {
    return {
      ...this.stats,
      connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN),
      knownMints: this.knownMints.size,
      subscribedMints: this.subscribedMints.size,
      eventQueueActive: this.activeEventHandlers,
      eventQueueDepth: this.eventQueue.length,
      currentReconnectDelayMs: this.currentReconnectDelayMs
    };
  }
}

module.exports = PumpDevListener;
