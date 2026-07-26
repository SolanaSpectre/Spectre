'use strict';

const WebSocket = require('ws');
const {
  NATIVE_SOL_MINT,
  USDC_MINT,
  WRAPPED_SOL_MINT,
  base64DataFromLog,
  decodePumpEventLog,
  isPumpTradeEventLog
} = require('./lib/pump-trade-event-decoder');

const PUMP_TOKEN_DECIMALS = 6;
const PUMP_TOKEN_TOTAL_SUPPLY = 1_000_000_000;
const PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET = 279_900_000;

class HeliusPumpfunShadowListener {
  constructor(config, logger, handlers = {}) {
    this.config = config;
    this.logger = logger;
    this.handlers = handlers;
    this.url = config.heliusStandardWebsocketUrl || config.heliusEnhancedWebsocketUrl || null;
    this.programId = config.pumpBondingCurveProgramId;
    this.commitment = config.heliusPumpfunShadowCommitment || 'processed';
    this.pingIntervalMs = Number(config.heliusPumpfunShadowPingIntervalMs || 25000);
    this.reconnectDelayMs = Number(config.heliusPumpfunShadowReconnectDelayMs || 1000);
    this.maxReconnectDelayMs = Number(config.heliusPumpfunShadowMaxReconnectDelayMs || 30000);
    this.currentReconnectDelayMs = this.reconnectDelayMs;
    this.ws = null;
    this.running = false;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.subscriptionRequestId = 7101;
    this.eventQueue = [];
    this.eventQueueHead = 0;
    this.eventQueueDrainScheduled = false;
    this.eventQueueDraining = false;
    this.eventQueueMaxSize = Math.max(100, Number(config.heliusPumpfunShadowEventQueueMaxSize || 20_000));
    this.eventQueueBatchSize = Math.max(1, Number(config.heliusPumpfunShadowEventQueueBatchSize || 64));
    this.stats = {
      enabled: config.heliusPumpfunShadowEnabled === true,
      reportOnly: true,
      strategyConsumptionEnabled: false,
      commitment: this.commitment,
      connected: false,
      connectionAttempts: 0,
      openEvents: 0,
      closeEvents: 0,
      reconnects: 0,
      errorEvents: 0,
      parseErrors: 0,
      subscriptionAcks: 0,
      subscriptionErrors: 0,
      messages: 0,
      eventQueueEnqueued: 0,
      eventQueueProcessed: 0,
      eventQueueDropped: 0,
      eventQueueDepth: 0,
      eventQueueMaxDepth: 0,
      eventQueueDrainYields: 0,
      eventQueueDrainCalls: 0,
      eventQueueDrainItems: 0,
      eventQueueDrainTotalMs: 0,
      eventQueueDrainMaxMs: 0,
      eventQueueDrainOver50Ms: 0,
      eventQueueHandlerErrors: 0,
      eventQueueLatencySamples: 0,
      eventQueueLatencyTotalMs: 0,
      eventQueueLatencyMaxMs: 0,
      eventQueueLastDroppedAt: null,
      eventQueueStopDrainTimedOut: false,
      eventQueueMaxSize: this.eventQueueMaxSize,
      eventQueueBatchSize: this.eventQueueBatchSize,
      notifications: 0,
      successfulNotifications: 0,
      failedNotifications: 0,
      bytes: 0,
      failedNotificationBytes: 0,
      logLines: 0,
      programDataLines: 0,
      pumpProgramDataLines: 0,
      foreignProgramDataLines: 0,
      tradeDiscriminatorCollisions: 0,
      unmatchedProgramDataLines: 0,
      tradeDecodeErrors: 0,
      decodedEvents: 0,
      tradeEvents: 0,
      createEvents: 0,
      completeEvents: 0,
      migrationEvents: 0,
      tradeTailDecoded: 0,
      tradeTailDecodeErrors: 0,
      quoteSolEvents: 0,
      quoteUsdcEvents: 0,
      quoteOtherEvents: 0,
      quoteUnsupportedEvents: 0,
      pingsSent: 0,
      pongsReceived: 0,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastMessageAt: null,
      lastPingAt: null,
      lastPongAt: null,
      lastCloseCode: null,
      lastCloseReason: null,
      lastErrorAt: null,
      lastErrorMessage: null,
      eventByteLengths: {}
    };
  }

  async start() {
    if (!this.config.heliusPumpfunShadowEnabled) {
      this.logger.info('Helius Pump.fun shadow listener disabled by config');
      return;
    }
    if (!this.url) {
      this.logger.warn('Helius Pump.fun shadow listener has no websocket URL');
      this.emitLifecycle('provider.helius_pumpfun.shadow_config_error', { reason: 'MISSING_WEBSOCKET_URL' });
      return;
    }
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  async stop() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.close(1000, 'shadow listener stop');
      }
    }
    await this.drainEventQueueBeforeStop();
  }

  connect() {
    if (!this.running || !this.url) return;
    this.stats.connectionAttempts += 1;
    const socket = new WebSocket(this.url, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
    this.ws = socket;

    socket.on('open', () => {
      if (!this.running || this.ws !== socket) return;
      this.stats.connected = true;
      this.stats.openEvents += 1;
      this.stats.lastConnectedAt = new Date().toISOString();
      this.currentReconnectDelayMs = this.reconnectDelayMs;
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: this.subscriptionRequestId,
        method: 'logsSubscribe',
        params: [
          { mentions: [this.programId] },
          { commitment: this.commitment }
        ]
      }));
      this.startHeartbeat(socket);
      this.emitLifecycle('provider.helius_pumpfun.shadow_connected', {
        commitment: this.commitment,
        programId: this.programId
      });
    });

    socket.on('message', (raw) => this.enqueueRawMessage(raw, Date.now()));
    socket.on('pong', () => {
      this.stats.pongsReceived += 1;
      this.stats.lastPongAt = new Date().toISOString();
    });
    socket.on('error', (error) => {
      this.stats.errorEvents += 1;
      this.stats.lastErrorAt = new Date().toISOString();
      this.stats.lastErrorMessage = error.message;
      this.emitLifecycle('provider.helius_pumpfun.shadow_error', { errorMessage: error.message });
    });
    socket.on('close', (code, reasonBuffer) => {
      this.stopHeartbeat();
      this.stats.connected = false;
      this.stats.closeEvents += 1;
      this.stats.lastDisconnectedAt = new Date().toISOString();
      this.stats.lastCloseCode = Number(code || 0) || 0;
      this.stats.lastCloseReason = reasonBuffer ? reasonBuffer.toString() : '';
      this.emitLifecycle('provider.helius_pumpfun.shadow_disconnected', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason
      });
      if (this.running && this.ws === socket) this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delayMs = this.currentReconnectDelayMs;
    this.stats.reconnects += 1;
    this.currentReconnectDelayMs = Math.min(this.maxReconnectDelayMs, Math.max(1000, delayMs * 2));
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  startHeartbeat(socket) {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (!this.running || this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      this.stats.pingsSent += 1;
      this.stats.lastPingAt = new Date().toISOString();
      socket.ping();
    }, this.pingIntervalMs);
  }

  stopHeartbeat() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  enqueueRawMessage(raw, receivedAtMs = Date.now()) {
    const bytes = Buffer.byteLength(raw);
    this.stats.messages += 1;
    this.stats.bytes += bytes;
    this.stats.lastMessageAt = new Date(receivedAtMs).toISOString();
    if (this.eventQueueDepth() >= this.eventQueueMaxSize) {
      this.stats.eventQueueDropped += 1;
      this.stats.eventQueueLastDroppedAt = new Date(receivedAtMs).toISOString();
      if (this.stats.eventQueueDropped === 1 || this.stats.eventQueueDropped % 1000 === 0) {
        this.emitLifecycle('provider.helius_pumpfun.shadow_event_queue_overflow', {
          dropped: this.stats.eventQueueDropped,
          queueDepth: this.eventQueueDepth(),
          maxQueueSize: this.eventQueueMaxSize
        });
      }
      return false;
    }
    this.eventQueue.push({ raw, receivedAtMs, bytes });
    this.stats.eventQueueEnqueued += 1;
    this.syncEventQueueStats();
    this.scheduleEventQueueDrain();
    return true;
  }

  scheduleEventQueueDrain() {
    if (this.eventQueueDrainScheduled || this.eventQueueDraining || this.eventQueueDepth() === 0) return;
    this.eventQueueDrainScheduled = true;
    setImmediate(() => {
      this.eventQueueDrainScheduled = false;
      this.drainEventQueue();
    });
  }

  drainEventQueue() {
    if (this.eventQueueDraining) return;
    const drainStartedAt = process.hrtime.bigint();
    this.eventQueueDraining = true;
    let processed = 0;
    while (processed < this.eventQueueBatchSize && this.eventQueueDepth() > 0) {
      const item = this.eventQueue[this.eventQueueHead];
      this.eventQueue[this.eventQueueHead] = null;
      this.eventQueueHead += 1;
      processed += 1;
      const latencyMs = Math.max(0, Date.now() - Number(item.receivedAtMs || Date.now()));
      this.stats.eventQueueLatencySamples += 1;
      this.stats.eventQueueLatencyTotalMs += latencyMs;
      this.stats.eventQueueLatencyMaxMs = Math.max(this.stats.eventQueueLatencyMaxMs, latencyMs);
      try {
        this.handleRawMessage(item.raw, item.receivedAtMs, item.bytes);
        this.stats.eventQueueProcessed += 1;
      } catch (error) {
        this.stats.eventQueueHandlerErrors += 1;
        this.logger.warn('Helius Pump.fun shadow message handler failed', error.message);
      }
    }
    this.compactEventQueue();
    const drainDurationMs = Number(process.hrtime.bigint() - drainStartedAt) / 1e6;
    this.stats.eventQueueDrainCalls += 1;
    this.stats.eventQueueDrainItems += processed;
    this.stats.eventQueueDrainTotalMs += drainDurationMs;
    this.stats.eventQueueDrainMaxMs = Math.max(this.stats.eventQueueDrainMaxMs, drainDurationMs);
    if (drainDurationMs >= 50) this.stats.eventQueueDrainOver50Ms += 1;
    this.eventQueueDraining = false;
    this.syncEventQueueStats();
    if (this.eventQueueDepth() > 0) {
      this.stats.eventQueueDrainYields += 1;
      this.scheduleEventQueueDrain();
    }
  }

  eventQueueDepth() {
    return Math.max(0, this.eventQueue.length - this.eventQueueHead);
  }

  compactEventQueue() {
    if (this.eventQueueHead === 0) return;
    if (this.eventQueueHead < 4096 && this.eventQueueHead * 2 < this.eventQueue.length) return;
    this.eventQueue = this.eventQueue.slice(this.eventQueueHead);
    this.eventQueueHead = 0;
  }

  syncEventQueueStats() {
    const depth = this.eventQueueDepth();
    this.stats.eventQueueDepth = depth;
    this.stats.eventQueueMaxDepth = Math.max(this.stats.eventQueueMaxDepth, depth);
  }

  async drainEventQueueBeforeStop(timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    this.scheduleEventQueueDrain();
    while ((this.eventQueueDraining || this.eventQueueDepth() > 0) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (this.eventQueueDepth() > 0) {
      const dropped = this.eventQueueDepth();
      this.stats.eventQueueDropped += dropped;
      this.stats.eventQueueStopDrainTimedOut = true;
      this.eventQueue = [];
      this.eventQueueHead = 0;
      this.syncEventQueueStats();
      this.emitLifecycle('provider.helius_pumpfun.shadow_event_queue_stop_timeout', {
        dropped,
        totalDropped: this.stats.eventQueueDropped,
        timeoutMs
      });
    }
  }

  handleRawMessage(raw, receivedAtMs = Date.now(), rawBytes = null) {
    const bytes = Number.isFinite(Number(rawBytes)) ? Number(rawBytes) : Buffer.byteLength(raw);
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      this.stats.parseErrors += 1;
      return;
    }

    if (payload.id === this.subscriptionRequestId) {
      if (payload.error) {
        this.stats.subscriptionErrors += 1;
        this.emitLifecycle('provider.helius_pumpfun.shadow_subscription_error', {
          code: payload.error.code ?? null,
          message: String(payload.error.message || 'unknown subscription error').slice(0, 500)
        });
      } else {
        this.stats.subscriptionAcks += 1;
      }
      return;
    }
    if (payload.method !== 'logsNotification') return;
    this.stats.notifications += 1;
    const result = payload.params?.result;
    const value = result?.value;
    if (!value) return;
    if (value.err !== null && value.err !== undefined) {
      this.stats.failedNotifications += 1;
      this.stats.failedNotificationBytes += bytes;
      return;
    }

    this.stats.successfulNotifications += 1;
    const context = {
      signature: value.signature || null,
      slot: result?.context?.slot ?? null,
      receivedAt: new Date(receivedAtMs).toISOString(),
      queueDelayMs: Math.max(0, Date.now() - receivedAtMs)
    };
    const logs = Array.isArray(value.logs) ? value.logs : [];
    this.stats.logLines += logs.length;
    const invocationStack = [];
    for (const [logIndex, line] of logs.entries()) {
      const invokeMatch = String(line).match(/^Program\s+(\S+)\s+invoke\s+\[\d+\]$/);
      if (invokeMatch) {
        invocationStack.push(invokeMatch[1]);
        continue;
      }
      const returnMatch = String(line).match(/^Program\s+(\S+)\s+(?:success|failed:.*)$/);
      if (returnMatch) {
        const matchingIndex = invocationStack.lastIndexOf(returnMatch[1]);
        if (matchingIndex >= 0) invocationStack.splice(matchingIndex);
        continue;
      }
      if (!String(line).startsWith('Program data:')) continue;
      this.stats.programDataLines += 1;
      const data = base64DataFromLog(line);
      if (data) {
        const key = String(data.length);
        this.stats.eventByteLengths[key] = (this.stats.eventByteLengths[key] || 0) + 1;
      }
      const emittingProgramId = invocationStack[invocationStack.length - 1] || null;
      if (emittingProgramId !== this.programId) {
        this.stats.foreignProgramDataLines += 1;
        if (isPumpTradeEventLog(line)) {
          this.stats.tradeDiscriminatorCollisions += 1;
          this.emitLifecycle('provider.helius_pumpfun.shadow_discriminator_collision_ignored', {
            eventType: 'TradeEvent',
            signature: context.signature,
            slot: context.slot,
            logIndex,
            emittingProgramId,
            expectedProgramId: this.programId,
            dataLength: data?.length ?? null
          });
        }
        continue;
      }
      this.stats.pumpProgramDataLines += 1;
      const event = decodePumpEventLog(line);
      if (!event) {
        this.stats.unmatchedProgramDataLines += 1;
        if (isPumpTradeEventLog(line)) {
          this.stats.tradeDecodeErrors += 1;
          this.emitLifecycle('provider.helius_pumpfun.shadow_decode_error', {
            eventType: 'TradeEvent',
            signature: context.signature,
            slot: context.slot,
            logIndex,
            dataLength: data?.length ?? null,
            rawDataBase64: data ? data.subarray(0, 512).toString('base64') : null,
            rawDataTruncated: Boolean(data && data.length > 512)
          });
        }
        continue;
      }
      this.handleDecodedEvent(event, { ...context, logIndex });
    }
  }

  handleDecodedEvent(event, context) {
    this.stats.decodedEvents += 1;
    if (event.eventType === 'TradeEvent') {
      this.stats.tradeEvents += 1;
      if (event.tailDecoded) this.stats.tradeTailDecoded += 1;
      if (event.tailDecodeError) this.stats.tradeTailDecodeErrors += 1;
      this.recordQuoteModel(event.curveModel);
      this.emitShadowEvent('provider.helius_pumpfun.shadow_trade', this.normalizeTrade(event, context));
      return;
    }
    if (event.eventType === 'CreateEvent') {
      this.stats.createEvents += 1;
      this.recordQuoteModel(event.curveModel);
      this.emitShadowEvent('provider.helius_pumpfun.shadow_new_token', this.normalizeCreate(event, context));
      return;
    }
    if (event.eventType === 'CompleteEvent') {
      this.stats.completeEvents += 1;
      this.emitShadowEvent('provider.helius_pumpfun.shadow_complete', this.normalizeLifecycleEvent(event, context));
      return;
    }
    if (event.eventType === 'CompletePumpAmmMigrationEvent') {
      this.stats.migrationEvents += 1;
      this.emitShadowEvent('provider.helius_pumpfun.shadow_migration', this.normalizeLifecycleEvent(event, context));
    }
  }

  recordQuoteModel(model) {
    if (model === 'sol_quote' || model === 'legacy_sol_quote') this.stats.quoteSolEvents += 1;
    else if (model === 'usdc_quote') this.stats.quoteUsdcEvents += 1;
    else if (model === 'quote_mint_unsupported') this.stats.quoteUnsupportedEvents += 1;
    else this.stats.quoteOtherEvents += 1;
  }

  normalizeTrade(event, context) {
    const virtualTokenReservesTokens = this.uiAmount(event.virtualTokenReserves, PUMP_TOKEN_DECIMALS);
    const quoteDecimals = event.quoteMint === NATIVE_SOL_MINT || event.quoteMint === WRAPPED_SOL_MINT
      ? 9
      : event.quoteMint === USDC_MINT ? 6 : null;
    const virtualQuoteReservesRaw = event.tailDecoded ? event.virtualQuoteReserves : event.virtualSolReserves;
    const virtualQuoteReservesUi = quoteDecimals === null ? null : this.uiAmount(virtualQuoteReservesRaw, quoteDecimals);
    const quoteAmountRaw = event.tailDecoded ? event.quoteAmount : event.solAmount;
    const quoteAmount = quoteDecimals === null ? null : this.uiAmount(quoteAmountRaw, quoteDecimals);
    const curveProgress = this.computeCurveProgress(virtualTokenReservesTokens);
    const priceQuote = Number.isFinite(virtualQuoteReservesUi) && virtualTokenReservesTokens > 0
      ? virtualQuoteReservesUi / virtualTokenReservesTokens
      : null;
    return {
      provider: 'helius_pumpfun',
      source: 'helius_logs_trade_shadow',
      eventType: event.eventType,
      mint: event.mint,
      traderPublicKey: event.user,
      txType: event.isBuy ? 'buy' : 'sell',
      eventAt: this.eventTimestamp(event.timestamp),
      ...context,
      quoteMint: event.quoteMint || null,
      ixName: event.ixName || null,
      mayhemMode: typeof event.mayhemMode === 'boolean' ? event.mayhemMode : null,
      feeBasisPoints: event.feeBasisPoints || null,
      creatorFeeBasisPoints: event.creatorFeeBasisPoints || null,
      pairBase: event.curveModel === 'sol_quote' || event.curveModel === 'legacy_sol_quote'
        ? 'SOL'
        : event.curveModel === 'usdc_quote' ? 'USDC' : 'UNKNOWN',
      curveModel: event.curveModel,
      curveProgress,
      providerCurveProgress: curveProgress,
      providerCurveSource: 'helius_pump_trade_event_virtual_token_reserves',
      tokenAmountRaw: event.tokenAmount,
      tokenAmount: this.uiAmount(event.tokenAmount, PUMP_TOKEN_DECIMALS),
      solAmountRaw: event.solAmount,
      solAmount: event.curveModel === 'sol_quote' || event.curveModel === 'legacy_sol_quote'
        ? this.uiAmount(event.solAmount, 9)
        : null,
      quoteAmountRaw,
      quoteAmount,
      virtualTokenReservesRaw: event.virtualTokenReserves,
      virtualTokenReservesTokens,
      virtualQuoteReservesRaw,
      virtualQuoteReservesUi,
      priceQuote,
      priceSol: event.curveModel === 'sol_quote' || event.curveModel === 'legacy_sol_quote' ? priceQuote : null,
      tailDecoded: event.tailDecoded,
      tailDecodeError: event.tailDecodeError,
      decodedBytes: event.decodedBytes,
      totalBytes: event.totalBytes,
      commitment: this.commitment
    };
  }

  normalizeCreate(event, context) {
    const virtualTokenReservesTokens = this.uiAmount(event.virtualTokenReserves, PUMP_TOKEN_DECIMALS);
    return {
      provider: 'helius_pumpfun',
      source: 'helius_logs_create_shadow',
      eventType: event.eventType,
      mint: event.mint,
      name: event.name,
      symbol: event.symbol,
      uri: event.uri,
      bondingCurve: event.bondingCurve,
      creator: event.creator,
      user: event.user,
      eventAt: this.eventTimestamp(event.timestamp),
      ...context,
      quoteMint: event.quoteMint,
      curveModel: event.curveModel,
      curveProgress: this.computeCurveProgress(virtualTokenReservesTokens),
      virtualTokenReservesRaw: event.virtualTokenReserves,
      virtualTokenReservesTokens,
      virtualQuoteReservesRaw: event.virtualQuoteReserves,
      tokenTotalSupplyRaw: event.tokenTotalSupply,
      isMayhemMode: event.isMayhemMode,
      isCashbackEnabled: event.isCashbackEnabled,
      decodedBytes: event.decodedBytes,
      totalBytes: event.totalBytes,
      commitment: this.commitment
    };
  }

  normalizeLifecycleEvent(event, context) {
    return {
      provider: 'helius_pumpfun',
      source: event.eventType === 'CompleteEvent'
        ? 'helius_logs_complete_shadow'
        : 'helius_logs_migration_shadow',
      ...event,
      eventAt: this.eventTimestamp(event.timestamp),
      ...context,
      commitment: this.commitment
    };
  }

  computeCurveProgress(virtualTokenReservesTokens) {
    if (!Number.isFinite(virtualTokenReservesTokens) || virtualTokenReservesTokens <= 0) return null;
    const realTokenReservesTokens = virtualTokenReservesTokens - PUMP_VIRTUAL_TO_REAL_TOKEN_OFFSET;
    const progress = 1 - (realTokenReservesTokens / PUMP_TOKEN_TOTAL_SUPPLY);
    return Number(Math.max(0, Math.min(progress, 1)).toFixed(6));
  }

  uiAmount(raw, decimals) {
    const value = Number(raw);
    return Number.isFinite(value) ? value / (10 ** decimals) : null;
  }

  eventTimestamp(seconds) {
    const value = Number(seconds);
    return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toISOString() : null;
  }

  emitLifecycle(type, payload = {}) {
    try {
      this.handlers.onLifecycle?.(type, { ...payload, provider: 'helius_pumpfun', reportOnly: true });
    } catch {
      // Shadow telemetry must never affect runtime behavior.
    }
  }

  emitShadowEvent(type, payload = {}) {
    try {
      this.handlers.onShadowEvent?.(type, { ...payload, reportOnly: true });
    } catch {
      // Shadow telemetry must never affect runtime behavior.
    }
  }

  getStats() {
    this.syncEventQueueStats();
    return {
      ...this.stats,
      connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN),
      currentReconnectDelayMs: this.currentReconnectDelayMs,
      eventQueueLatencyMeanMs: this.stats.eventQueueLatencySamples > 0
        ? this.stats.eventQueueLatencyTotalMs / this.stats.eventQueueLatencySamples
        : null,
      eventQueueDrainMeanMs: this.stats.eventQueueDrainCalls > 0
        ? this.stats.eventQueueDrainTotalMs / this.stats.eventQueueDrainCalls
        : null
    };
  }
}

module.exports = HeliusPumpfunShadowListener;
