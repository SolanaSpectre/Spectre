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
    this.tradeSubscriptionMode = config.pumpDevTradeSubscriptionMode
      || (this.feedMode === 'primary' ? 'all_new_tokens' : 'targeted_candidates');
    this.targetedSubscriptionTtlMs = Number(config.pumpDevTargetedSubscriptionTtlMs || 180000);
    this.reconnectResubscribeMaxMints = Number(config.pumpDevReconnectResubscribeMaxMints || 25);
    this.reconnectResubscribeBatchSize = Number(config.pumpDevReconnectResubscribeBatchSize || 5);
    this.reconnectResubscribeBatchDelayMs = Number(config.pumpDevReconnectResubscribeBatchDelayMs || 2000);
    this.rateLimitCooldownMs = Number(config.pumpDevRateLimitCooldownMs || 60000);
    this.reconnectDelayResetAfterStableMs = Number(config.pumpDevReconnectDelayResetAfterStableMs || 120000);
    this.pingIntervalMs = Number(config.pumpDevPingIntervalMs || 25000);
    this.reconnectDelayMs = Number(config.pumpDevReconnectDelayMs || 5000);
    this.maxReconnectDelayMs = Number(config.pumpDevMaxReconnectDelayMs || 30000);
    this.eventHandlerConcurrency = Math.max(1, Number(config.pumpDevEventHandlerConcurrency || 4));
    this.eventQueueMaxSize = Math.max(1, Number(config.pumpDevEventQueueMaxSize || 10000));
    this.currentReconnectDelayMs = this.reconnectDelayMs;
    this.reconnectTimer = null;
    this.reconnectDelayResetTimer = null;
    this.resubscribeTimer = null;
    this.deferredSubscribeTimer = null;
    this.pendingResubscribeMints = [];
    this.deferredSubscribeMints = new Set();
    this.rateLimitCooldownUntilMs = 0;
    this.pingTimer = null;
    this.eventQueue = [];
    this.activeEventHandlers = 0;
    this.eventQueueDrainScheduled = false;
    this.pendingTradeQueueByMint = new Map();
    this.tradeCoalesceQueueDepth = Math.max(0, Number(config.pumpDevTradeCoalesceQueueDepth || 500));
    this.subscribedMints = new Set();
    this.subscribedMintMeta = new Map();
    this.pendingSubscriptionMints = new Map();
    this.queuedSubscriptionMints = new Set();
    this.subscriptionIntentMeta = new Map();
    this.effectiveMaxSubscribedMints = this.maxSubscribedMints;
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
      tradeSubscriptionMode: this.tradeSubscriptionMode,
      targetedSubscriptionTtlMs: this.targetedSubscriptionTtlMs,
      effectiveMaxSubscribedMints: this.effectiveMaxSubscribedMints,
      pendingSubscriptionMints: 0,
      queuedSubscriptionMints: 0,
      openEvents: 0,
      closeEvents: 0,
      errorEvents: 0,
      reconnectAttempts: 0,
      controlFramesSent: 0,
      tokenTradeSubscribeFrames: 0,
      tokenTradeSubscribeCandidates: 0,
      tokenTradeSubscribeSkippedAtCap: 0,
      tokenTradeSubscribeSkippedDuplicate: 0,
      tokenTradeSubscribeSendFailures: 0,
      tokenTradeSubscriptionAcks: 0,
      tokenTradeSubscriptionRejects: 0,
      targetedSubscriptionRequests: 0,
      targetedSubscriptionRefreshes: 0,
      targetedSubscriptionEvictions: 0,
      subscriptionAckMessages: 0,
      subscriptionErrorMessages: 0,
      unsubscriptionAckMessages: 0,
      lastSubscriptionAckAt: null,
      lastSubscriptionAckMessage: null,
      tokenTradeReconnectResubscribeScheduled: 0,
      tokenTradeReconnectResubscribeSent: 0,
      tokenTradeReconnectResubscribeDropped: 0,
      tokenTradeSubscribesSuppressedDuringCooldown: 0,
      tokenTradeDeferredSubscribeSent: 0,
      tokenTradeDeferredSubscribeDropped: 0,
      reconnectResubscribeMaxMints: this.reconnectResubscribeMaxMints,
      reconnectResubscribeBatchSize: this.reconnectResubscribeBatchSize,
      reconnectResubscribeBatchDelayMs: this.reconnectResubscribeBatchDelayMs,
      rateLimitCloseEvents: 0,
      rateLimitCooldownMs: this.rateLimitCooldownMs,
      rateLimitCooldownUntilMs: 0,
      reconnectDelayStableResets: 0,
      reconnectDelayResetAfterStableMs: this.reconnectDelayResetAfterStableMs,
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
    this.clearReconnectDelayResetTimer();
    this.clearResubscribeTimer();
    this.clearDeferredSubscribeTimer();
    this.pendingSubscriptionMints.clear();
    this.queuedSubscriptionMints.clear();
    this.subscriptionIntentMeta.clear();
    this.syncSubscriptionStats();
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
      this.logger.info('PumpDev shadow websocket connected');
      this.send({ method: 'subscribeNewToken' });
      this.scheduleReconnectDelayReset(socket);
      this.scheduleResubscribeTrackedMints();
      this.scheduleDeferredSubscribeFlush();
      this.flushQueuedSubscription();
      this.startHeartbeat(socket);
      this.emitLifecycle('provider.pumpdev.connected', {
        subscribedMints: this.subscribedMints.size,
        maxSubscribedMints: this.maxSubscribedMints,
        reconnectResubscribeMaxMints: this.reconnectResubscribeMaxMints,
        reconnectResubscribeBatchSize: this.reconnectResubscribeBatchSize,
        reconnectResubscribeBatchDelayMs: this.reconnectResubscribeBatchDelayMs,
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
      const rateLimited = this.isRateLimitClose(this.stats.lastCloseCode, this.stats.lastCloseReason);
      if (rateLimited) {
        this.stats.rateLimitCloseEvents += 1;
        this.rateLimitCooldownUntilMs = Math.max(
          this.rateLimitCooldownUntilMs,
          now + Math.max(0, this.rateLimitCooldownMs)
        );
        this.stats.rateLimitCooldownUntilMs = this.rateLimitCooldownUntilMs;
        this.currentReconnectDelayMs = Math.max(
          this.currentReconnectDelayMs,
          Math.max(this.reconnectDelayMs, this.rateLimitCooldownMs)
        );
        this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
      }
      this.clearReconnectDelayResetTimer();
      this.clearResubscribeTimer();
      this.stopHeartbeat();
      this.resetSubscriptionsAfterDisconnect();
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
        lastMessageAgeMsAtClose: connectionStats.lastMessageAgeMsAtClose,
        rateLimited,
        rateLimitCooldownUntilMs: this.rateLimitCooldownUntilMs || null
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
      this.recordSystemSubscriptionMessage(payload);
      return;
    }

    const normalized = this.normalizePayload(payload, type);
    if (type === 'newToken') {
      this.stats.newTokens += 1;
      if (normalized.mint) {
        this.knownMints.add(normalized.mint);
        this.stats.knownMints = this.knownMints.size;
        this.touchSubscribedMint(normalized.mint, 'new_token');
        if (this.tradeSubscriptionMode === 'all_new_tokens') {
          this.maybeSubscribeMint(normalized.mint, { reason: 'new_token_breadth' });
        }
      }
      this.emitShadowEvent('provider.pumpdev.shadow_new_token', normalized);
      if (this.drivesPreMigration && typeof this.handlers.onNewToken === 'function') {
        await this.safeRuntimeHandler('onNewToken', normalized);
      }
      return;
    }

    if (type === 'trade') {
      this.stats.trades += 1;
      this.touchSubscribedMint(normalized.mint, 'trade');
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
    const traderPublicKey = payload.traderPublicKey
      || payload.wallet
      || payload.account
      || payload.trader
      || payload.user
      || payload.buyer
      || payload.seller
      || payload.signer
      || payload.maker
      || payload.owner
      || payload.creator
      || null;
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
      traderPublicKey,
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

  recordSystemSubscriptionMessage(payload = {}) {
    const type = String(payload.type || '').toLowerCase();
    const message = String(payload.message || payload.error || '').slice(0, 500) || null;
    const method = payload.method || payload.subscription || null;
    const keys = Array.isArray(payload.keys) ? payload.keys.filter(Boolean) : [];
    if (type === 'subscribed') {
      this.stats.subscriptionAckMessages += 1;
      this.stats.lastSubscriptionAckAt = Date.now();
      this.stats.lastSubscriptionAckMessage = message;
      if (method === 'subscribeTokenTrade') {
        this.acknowledgePendingSubscriptions(keys);
      }
      this.emitLifecycle('provider.pumpdev.subscription_ack', {
        message,
        method,
        keys: keys.length || null,
        activeMints: this.subscribedMints.size,
        pendingMints: this.pendingSubscriptionMints.size,
        effectiveMaxSubscribedMints: this.effectiveMaxSubscribedMints
      });
    } else if (type === 'unsubscribed') {
      this.stats.unsubscriptionAckMessages += 1;
      this.emitLifecycle('provider.pumpdev.unsubscription_ack', { message });
    } else if (type === 'error') {
      this.stats.subscriptionErrorMessages += 1;
      this.rejectPendingSubscription(message);
      this.emitLifecycle('provider.pumpdev.subscription_error', {
        message,
        activeMints: this.subscribedMints.size,
        pendingMints: this.pendingSubscriptionMints.size,
        effectiveMaxSubscribedMints: this.effectiveMaxSubscribedMints
      });
    }
  }

  acknowledgePendingSubscriptions(keys = []) {
    const pendingKeys = keys.filter((mint) => this.pendingSubscriptionMints.has(mint));
    const resolved = pendingKeys.length
      ? pendingKeys
      : Array.from(this.pendingSubscriptionMints.keys()).slice(0, 1);
    const now = Date.now();
    for (const mint of resolved) {
      const pending = this.pendingSubscriptionMints.get(mint);
      if (!pending) continue;
      this.pendingSubscriptionMints.delete(mint);
      this.subscribedMints.add(mint);
      this.subscribedMintMeta.set(mint, {
        subscribedAt: now,
        lastSeenAt: now,
        lastTradeAt: null,
        tradeCount: 0,
        requestedAt: pending.requestedAt,
        lastTargetedAt: pending.lastTargetedAt || pending.requestedAt,
        targetReason: pending.reason || null
      });
      this.subscriptionIntentMeta.delete(mint);
      this.stats.tokenTradeSubscriptionAcks += 1;
    }
    this.syncSubscriptionStats();
    this.flushQueuedSubscription();
  }

  rejectPendingSubscription(message = null) {
    const mint = this.pendingSubscriptionMints.keys().next().value || null;
    if (mint) {
      this.pendingSubscriptionMints.delete(mint);
      this.subscriptionIntentMeta.delete(mint);
      this.stats.tokenTradeSubscriptionRejects += 1;
    }
    if (/anonymous tier allows 5 live subscriptions/i.test(String(message || ''))) {
      this.effectiveMaxSubscribedMints = Math.min(
        this.effectiveMaxSubscribedMints,
        Math.max(1, this.subscribedMints.size)
      );
      this.dropQueuedSubscriptionsAtCapacity();
    }
    this.syncSubscriptionStats();
    this.flushQueuedSubscription();
  }

  syncSubscriptionStats() {
    this.stats.subscribedMints = this.subscribedMints.size;
    this.stats.pendingSubscriptionMints = this.pendingSubscriptionMints.size;
    this.stats.queuedSubscriptionMints = this.queuedSubscriptionMints.size;
    this.stats.effectiveMaxSubscribedMints = this.effectiveMaxSubscribedMints;
  }

  subscriptionProductivity(now = Date.now()) {
    const rows = Array.from(this.subscribedMintMeta.values()).map((meta) => ({
      ageMs: Math.max(0, now - Number(meta.subscribedAt || now)),
      idleMs: Math.max(0, now - Number(meta.lastTradeAt || meta.subscribedAt || now)),
      tradeCount: Number(meta.tradeCount || 0)
    }));
    const stats = (values) => {
      const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
      if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null };
      const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
      return {
        count: sorted.length,
        min: sorted[0],
        median: pick(0.5),
        p90: pick(0.9),
        max: sorted[sorted.length - 1]
      };
    };
    return {
      slots: rows.length,
      zeroTradeSlots: rows.filter((row) => row.tradeCount === 0).length,
      tradedSlots: rows.filter((row) => row.tradeCount > 0).length,
      totalTrades: rows.reduce((sum, row) => sum + row.tradeCount, 0),
      ageMs: stats(rows.map((row) => row.ageMs)),
      idleMs: stats(rows.map((row) => row.idleMs)),
      tradesPerSlot: stats(rows.map((row) => row.tradeCount))
    };
  }

  targetMint(mint, meta = {}) {
    if (!mint || !this.config.pumpDevShadowEnabled) return false;
    const now = Date.now();
    this.pruneExpiredTargetedSubscriptions(now);
    const activeMeta = this.subscribedMintMeta.get(mint);
    if (activeMeta) {
      activeMeta.lastTargetedAt = now;
      activeMeta.targetReason = meta.reason || activeMeta.targetReason || null;
      this.stats.targetedSubscriptionRefreshes += 1;
      return true;
    }
    this.stats.targetedSubscriptionRequests += 1;
    this.emitLifecycle('provider.pumpdev.targeted_subscription_requested', {
      mint,
      reason: meta.reason || null,
      score: Number.isFinite(Number(meta.score)) ? Number(meta.score) : null,
      curveProgress: Number.isFinite(Number(meta.curveProgress)) ? Number(meta.curveProgress) : null
    });
    return this.maybeSubscribeMint(mint, { ...meta, lastTargetedAt: now });
  }

  maybeSubscribeMint(mint, meta = {}) {
    if (!mint) return;
    this.stats.tokenTradeSubscribeCandidates += 1;
    if (
      this.subscribedMints.has(mint)
      || this.pendingSubscriptionMints.has(mint)
      || this.queuedSubscriptionMints.has(mint)
    ) {
      this.stats.tokenTradeSubscribeSkippedDuplicate += 1;
      this.subscriptionIntentMeta.set(mint, {
        ...(this.subscriptionIntentMeta.get(mint) || {}),
        ...meta
      });
      return;
    }
    if (this.subscribedMints.size >= this.effectiveMaxSubscribedMints) {
      this.recordSubscriptionCapacitySkip(1);
      return;
    }
    this.queuedSubscriptionMints.add(mint);
    this.subscriptionIntentMeta.set(mint, meta);
    this.syncSubscriptionStats();
    this.flushQueuedSubscription();
  }

  subscribeMintNow(mint, now = Date.now(), meta = {}) {
    if (!mint || this.subscribedMints.has(mint) || this.pendingSubscriptionMints.has(mint)) return false;
    if (this.subscribedMints.size + this.pendingSubscriptionMints.size >= this.effectiveMaxSubscribedMints) {
      if (meta.deferred) this.stats.tokenTradeDeferredSubscribeDropped += 1;
      return false;
    }
    const intent = this.subscriptionIntentMeta.get(mint) || {};
    this.pendingSubscriptionMints.set(mint, { requestedAt: now, ...intent });
    this.syncSubscriptionStats();
    const sent = this.send({ method: 'subscribeTokenTrade', keys: [mint] });
    if (sent) {
      this.stats.tokenTradeSubscribeFrames += 1;
      if (meta.deferred) this.stats.tokenTradeDeferredSubscribeSent += 1;
    } else {
      this.stats.tokenTradeSubscribeSendFailures += 1;
      this.pendingSubscriptionMints.delete(mint);
      this.subscriptionIntentMeta.delete(mint);
      this.syncSubscriptionStats();
    }
    return sent;
  }

  flushQueuedSubscription() {
    if (this.pendingSubscriptionMints.size > 0 || this.queuedSubscriptionMints.size === 0) return;
    if (this.subscribedMints.size >= this.effectiveMaxSubscribedMints) {
      this.dropQueuedSubscriptionsAtCapacity();
      return;
    }
    const now = Date.now();
    if (this.rateLimitCooldownUntilMs > now) return;
    const mint = this.queuedSubscriptionMints.values().next().value;
    if (!mint) return;
    this.queuedSubscriptionMints.delete(mint);
    this.syncSubscriptionStats();
    this.subscribeMintNow(mint, now);
  }

  dropQueuedSubscriptionsAtCapacity() {
    const dropped = this.queuedSubscriptionMints.size;
    if (dropped === 0) return;
    for (const mint of this.queuedSubscriptionMints) this.subscriptionIntentMeta.delete(mint);
    this.queuedSubscriptionMints.clear();
    this.recordSubscriptionCapacitySkip(dropped);
    this.syncSubscriptionStats();
  }

  recordSubscriptionCapacitySkip(count = 1) {
    this.stats.tokenTradeSubscribeSkippedAtCap += count;
    const skipped = this.stats.tokenTradeSubscribeSkippedAtCap;
    if (skipped === count || skipped % 1000 < count) {
      this.emitLifecycle('provider.pumpdev.subscription_capacity', {
        subscribedMints: this.subscribedMints.size,
        pendingMints: this.pendingSubscriptionMints.size,
        configuredMaxSubscribedMints: this.maxSubscribedMints,
        effectiveMaxSubscribedMints: this.effectiveMaxSubscribedMints,
        skippedAtCap: skipped,
        productivity: this.subscriptionProductivity()
      });
    }
  }

  resetSubscriptionsAfterDisconnect() {
    const reconnectMints = [...this.subscribedMints, ...this.pendingSubscriptionMints.keys()];
    for (const mint of reconnectMints) {
      const meta = this.subscribedMintMeta.get(mint) || this.pendingSubscriptionMints.get(mint) || {};
      this.subscriptionIntentMeta.set(mint, {
        reason: meta.targetReason || meta.reason || 'reconnect',
        lastTargetedAt: meta.lastTargetedAt || meta.requestedAt || Date.now()
      });
    }
    this.subscribedMints.clear();
    this.subscribedMintMeta.clear();
    this.pendingSubscriptionMints.clear();
    for (const mint of reconnectMints.slice(0, this.reconnectResubscribeMaxMints)) {
      this.queuedSubscriptionMints.add(mint);
    }
    this.syncSubscriptionStats();
  }

  pruneExpiredTargetedSubscriptions(now = Date.now()) {
    if (this.tradeSubscriptionMode !== 'targeted_candidates') return 0;
    if (!Number.isFinite(this.targetedSubscriptionTtlMs) || this.targetedSubscriptionTtlMs <= 0) return 0;
    const expired = Array.from(this.subscribedMintMeta.entries())
      .filter(([, meta]) => now - Number(meta.lastTargetedAt || meta.subscribedAt || now) >= this.targetedSubscriptionTtlMs)
      .map(([mint]) => mint);
    for (const mint of expired) this.unsubscribeMint(mint, 'target_ttl');
    return expired.length;
  }

  unsubscribeMint(mint, reason = 'unknown') {
    if (!this.subscribedMints.has(mint)) return false;
    const sent = this.send({ method: 'unsubscribeTokenTrade', keys: [mint] });
    this.subscribedMints.delete(mint);
    this.subscribedMintMeta.delete(mint);
    this.subscriptionIntentMeta.delete(mint);
    if (reason === 'target_ttl') this.stats.targetedSubscriptionEvictions += 1;
    this.syncSubscriptionStats();
    this.emitLifecycle('provider.pumpdev.targeted_subscription_evicted', {
      mint,
      reason,
      unsubscribeFrameSent: sent
    });
    return sent;
  }

  deferSubscribeMint(mint) {
    if (
      !mint
      || this.subscribedMints.has(mint)
      || this.pendingSubscriptionMints.has(mint)
      || this.queuedSubscriptionMints.has(mint)
    ) return;
    if (!this.deferredSubscribeMints.has(mint)) {
      this.stats.tokenTradeSubscribesSuppressedDuringCooldown += 1;
    }
    this.deferredSubscribeMints.add(mint);
    this.scheduleDeferredSubscribeFlush();
  }

  scheduleDeferredSubscribeFlush(delayOverrideMs = null) {
    if (this.deferredSubscribeTimer || this.deferredSubscribeMints.size === 0) return;
    const cooldownWaitMs = this.rateLimitCooldownUntilMs - Date.now();
    const delayMs = Number.isFinite(delayOverrideMs)
      ? Math.max(0, delayOverrideMs)
      : Math.max(0, cooldownWaitMs);
    this.deferredSubscribeTimer = setTimeout(() => this.flushDeferredSubscribeBatch(), delayMs);
    if (typeof this.deferredSubscribeTimer.unref === 'function') this.deferredSubscribeTimer.unref();
  }

  clearDeferredSubscribeTimer() {
    if (this.deferredSubscribeTimer) {
      clearTimeout(this.deferredSubscribeTimer);
      this.deferredSubscribeTimer = null;
    }
    this.deferredSubscribeMints.clear();
  }

  flushDeferredSubscribeBatch() {
    this.deferredSubscribeTimer = null;
    if (!this.running || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.scheduleDeferredSubscribeFlush(1000);
      return;
    }

    const cooldownWaitMs = this.rateLimitCooldownUntilMs - Date.now();
    if (cooldownWaitMs > 0) {
      this.scheduleDeferredSubscribeFlush(cooldownWaitMs);
      return;
    }

    const batchSize = Number.isFinite(this.reconnectResubscribeBatchSize) && this.reconnectResubscribeBatchSize > 0
      ? this.reconnectResubscribeBatchSize
      : this.deferredSubscribeMints.size;
    const batch = Array.from(this.deferredSubscribeMints).slice(0, batchSize);
    for (const mint of batch) {
      this.deferredSubscribeMints.delete(mint);
      this.queuedSubscriptionMints.add(mint);
    }
    this.syncSubscriptionStats();
    this.flushQueuedSubscription();
    if (this.deferredSubscribeMints.size > 0) {
      this.scheduleDeferredSubscribeFlush(this.reconnectResubscribeBatchDelayMs);
    }
  }

  touchSubscribedMint(mint, kind = 'event') {
    if (!mint) return;
    const meta = this.subscribedMintMeta.get(mint);
    if (!meta) return;
    meta.lastSeenAt = Date.now();
    if (kind === 'trade') {
      meta.lastTradeAt = meta.lastSeenAt;
      meta.tradeCount = Number(meta.tradeCount || 0) + 1;
    }
  }

  scheduleResubscribeTrackedMints() {
    this.clearResubscribeTimer();
    const ranked = Array.from(this.subscribedMints)
      .map((mint) => {
        const meta = this.subscribedMintMeta.get(mint) || {};
        return {
          mint,
          subscribedAt: Number(meta.subscribedAt || 0),
          lastSeenAt: Number(meta.lastSeenAt || 0)
        };
      })
      .sort((a, b) => (b.lastSeenAt || b.subscribedAt) - (a.lastSeenAt || a.subscribedAt));
    const limit = Number.isFinite(this.reconnectResubscribeMaxMints) && this.reconnectResubscribeMaxMints > 0
      ? this.reconnectResubscribeMaxMints
      : ranked.length;
    const selected = ranked.slice(0, limit).map((item) => item.mint);
    const droppedItems = ranked.slice(limit);
    const dropped = droppedItems.length;
    if (dropped > 0) {
      this.stats.tokenTradeReconnectResubscribeDropped += dropped;
      for (const item of droppedItems) {
        this.subscribedMints.delete(item.mint);
        this.subscribedMintMeta.delete(item.mint);
      }
      this.stats.subscribedMints = this.subscribedMints.size;
    }
    this.pendingResubscribeMints = selected.filter((mint) => this.subscribedMints.has(mint));
    this.stats.tokenTradeReconnectResubscribeScheduled += this.pendingResubscribeMints.length;
    if (this.pendingResubscribeMints.length === 0) return;
    this.flushResubscribeBatch();
    this.logger.info('Scheduled PumpDev trade re-subscriptions', {
      trackedMints: ranked.length,
      scheduledMints: this.pendingResubscribeMints.length,
      droppedMints: dropped,
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

    const cooldownWaitMs = this.rateLimitCooldownUntilMs - Date.now();
    if (cooldownWaitMs > 0) {
      this.resubscribeTimer = setTimeout(() => this.flushResubscribeBatch(), cooldownWaitMs);
      if (typeof this.resubscribeTimer.unref === 'function') this.resubscribeTimer.unref();
      return;
    }

    const batchSize = Number.isFinite(this.reconnectResubscribeBatchSize) && this.reconnectResubscribeBatchSize > 0
      ? this.reconnectResubscribeBatchSize
      : this.pendingResubscribeMints.length;
    const batch = this.pendingResubscribeMints.splice(0, batchSize);
    for (const mint of batch) {
      if (!this.subscribedMints.has(mint)) continue;
      const sent = this.send({ method: 'subscribeTokenTrade', keys: [mint] });
      if (sent) {
        this.stats.tokenTradeSubscribeFrames += 1;
        this.stats.tokenTradeReconnectResubscribeSent += 1;
      }
    }

    if (this.pendingResubscribeMints.length === 0) return;
    const delayMs = Number.isFinite(this.reconnectResubscribeBatchDelayMs) && this.reconnectResubscribeBatchDelayMs >= 0
      ? this.reconnectResubscribeBatchDelayMs
      : 0;
    this.resubscribeTimer = setTimeout(() => this.flushResubscribeBatch(), delayMs);
    if (typeof this.resubscribeTimer.unref === 'function') this.resubscribeTimer.unref();
  }

  resetReconnectDelay() {
    this.currentReconnectDelayMs = this.reconnectDelayMs;
    this.stats.reconnectDelayMs = this.currentReconnectDelayMs;
  }

  scheduleReconnectDelayReset(socket) {
    this.clearReconnectDelayResetTimer();
    if (!Number.isFinite(this.reconnectDelayResetAfterStableMs) || this.reconnectDelayResetAfterStableMs <= 0) return;
    this.reconnectDelayResetTimer = setTimeout(() => {
      this.reconnectDelayResetTimer = null;
      if (!this.running || this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      this.resetReconnectDelay();
      this.stats.reconnectDelayStableResets += 1;
    }, this.reconnectDelayResetAfterStableMs);
    if (typeof this.reconnectDelayResetTimer.unref === 'function') this.reconnectDelayResetTimer.unref();
  }

  clearReconnectDelayResetTimer() {
    if (this.reconnectDelayResetTimer) {
      clearTimeout(this.reconnectDelayResetTimer);
      this.reconnectDelayResetTimer = null;
    }
  }

  isRateLimitClose(code, reason = '') {
    return Number(code) === 1008 || /rate\s*limit/i.test(String(reason || ''));
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
    this.syncSubscriptionStats();
    return {
      ...this.stats,
      connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN),
      knownMints: this.knownMints.size,
      subscribedMints: this.subscribedMints.size,
      pendingSubscriptionMints: this.pendingSubscriptionMints.size,
      queuedSubscriptionMints: this.queuedSubscriptionMints.size,
      effectiveMaxSubscribedMints: this.effectiveMaxSubscribedMints,
      eventQueueActive: this.activeEventHandlers,
      eventQueueDepth: this.eventQueue.length,
      subscriptionProductivity: this.subscriptionProductivity(),
      currentReconnectDelayMs: this.currentReconnectDelayMs
    };
  }
}

module.exports = PumpDevListener;
