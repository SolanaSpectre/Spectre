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
    this.runtimeEnabled = config.heliusPumpfunRuntimeEnabled === true;
    this.programId = config.pumpBondingCurveProgramId;
    this.commitment = config.heliusPumpfunShadowCommitment || 'processed';
    this.pingIntervalMs = Number(config.heliusPumpfunShadowPingIntervalMs || 25000);
    this.pongTimeoutMs = Math.max(1000, Number(config.heliusPumpfunShadowPongTimeoutMs || 10000));
    this.subscriptionAckTimeoutMs = Math.max(
      1000,
      Number(config.heliusPumpfunShadowSubscriptionAckTimeoutMs || 5000)
    );
    this.reconnectDelayMs = Number(config.heliusPumpfunShadowReconnectDelayMs || 1000);
    this.maxReconnectDelayMs = Number(config.heliusPumpfunShadowMaxReconnectDelayMs || 30000);
    this.currentReconnectDelayMs = this.reconnectDelayMs;
    this.ws = null;
    this.running = false;
    this.stopInProgress = false;
    this.stopInitiatedAtMs = null;
    this.shutdownGraceMs = 1000;
    this.pingTimer = null;
    this.pongDeadlineTimer = null;
    this.awaitingPong = false;
    this.reconnectTimer = null;
    this.subscriptionAckTimer = null;
    this.subscriptionRequestId = 7100;
    this.activeSubscriptionRequestId = null;
    this.subscriptionReady = false;
    this.currentSubscriptionId = null;
    this.connectionEpoch = 0;
    this.currentEpochOpenedAtMs = null;
    this.currentEpochAckAtMs = null;
    this.transportGapSequence = 0;
    this.transportGapStartedAtMs = null;
    this.transportGapStartedAfterEpoch = null;
    this.lastRecoveredGapAtMs = null;
    this.lastRecoveredGapDurationMs = null;
    this.pendingFirstNotificationGap = null;
    this.highestNotificationSlot = null;
    this.seenNotificationKeys = new Map();
    this.maxSeenNotificationKeys = 100_000;
    this.eventQueue = [];
    this.eventQueueHead = 0;
    this.eventQueueDrainScheduled = false;
    this.eventQueueDraining = false;
    this.eventQueueMaxSize = Math.max(100, Number(config.heliusPumpfunShadowEventQueueMaxSize || 20_000));
    this.eventQueueBatchSize = Math.max(1, Number(config.heliusPumpfunShadowEventQueueBatchSize || 64));
    this.stats = {
      enabled: config.heliusPumpfunShadowEnabled === true,
      reportOnly: !this.runtimeEnabled,
      strategyConsumptionEnabled: this.runtimeEnabled,
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
      subscriptionAckTimeouts: 0,
      staleSubscriptionResponses: 0,
      notificationsBeforeSubscriptionAck: 0,
      subscriptionReady: false,
      subscriptionAckTimeoutMs: this.subscriptionAckTimeoutMs,
      subscriptionAckLatencySamples: 0,
      subscriptionAckLatencyTotalMs: 0,
      subscriptionAckLatencyMaxMs: 0,
      messages: 0,
      eventQueueEnqueued: 0,
      eventQueueProcessed: 0,
      eventQueueDropped: 0,
      eventQueueDepth: 0,
      eventQueueMaxDepth: 0,
      eventQueueDrainYields: 0,
      eventQueueDrainCalls: 0,
      eventQueueDrainItems: 0,
      eventQueueDrainMaxBatch: 0,
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
      pongTimeouts: 0,
      pongTimeoutMs: this.pongTimeoutMs,
      connectionEpoch: 0,
      transportGapsStarted: 0,
      transportGapsRecovered: 0,
      transportGapActive: false,
      transportGapDurationSamples: 0,
      transportGapDurationTotalMs: 0,
      transportGapDurationMaxMs: 0,
      lastTransportGapSequence: null,
      lastTransportGapStartedAt: null,
      lastTransportGapRecoveredAt: null,
      lastTransportGapDurationMs: null,
      firstNotificationsAfterGap: 0,
      duplicateNotifications: 0,
      notificationsWithoutDedupKey: 0,
      outOfOrderNotifications: 0,
      highestNotificationSlot: null,
      notificationDedupMaxKeys: this.maxSeenNotificationKeys,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      lastMessageAt: null,
      lastPingAt: null,
      lastPongAt: null,
      lastCloseCode: null,
      lastCloseReason: null,
      shutdownPhaseDisconnects: 0,
      shutdownPhaseErrors: 0,
      stopCloseTimedOut: false,
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
    this.stopInProgress = false;
    this.stopInitiatedAtMs = null;
    this.running = true;
    this.connect();
  }

  async stop() {
    this.stopInProgress = true;
    this.stopInitiatedAtMs = Date.now();
    this.running = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    this.clearSubscriptionAckTimer();
    const socket = this.ws;
    this.ws = null;
    this.subscriptionReady = false;
    this.currentSubscriptionId = null;
    this.activeSubscriptionRequestId = null;
    this.stats.connected = false;
    this.stats.subscriptionReady = false;
    try {
      if (socket) await this.closeSocketForStop(socket);
      await this.drainEventQueueBeforeStop();
    } finally {
      this.stopInProgress = false;
    }
  }

  connect() {
    if (!this.running || !this.url) return;
    this.stats.connectionAttempts += 1;
    const socket = new WebSocket(this.url, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
    this.ws = socket;
    let socketEpoch = null;
    let socketSubscriptionRequestId = null;

    socket.on('open', () => {
      if (!this.running || this.ws !== socket) return;
      socketEpoch = this.connectionEpoch + 1;
      this.connectionEpoch = socketEpoch;
      socketSubscriptionRequestId = this.subscriptionRequestId + 1;
      this.subscriptionRequestId = socketSubscriptionRequestId;
      this.activeSubscriptionRequestId = socketSubscriptionRequestId;
      this.subscriptionReady = false;
      this.currentSubscriptionId = null;
      this.currentEpochOpenedAtMs = Date.now();
      this.currentEpochAckAtMs = null;
      this.stats.connected = true;
      this.stats.subscriptionReady = false;
      this.stats.connectionEpoch = socketEpoch;
      this.stats.openEvents += 1;
      this.stats.lastConnectedAt = new Date().toISOString();
      this.currentReconnectDelayMs = this.reconnectDelayMs;
      this.sendSubscriptionRequest(socket, socketEpoch, socketSubscriptionRequestId);
      this.startHeartbeat(socket, socketEpoch);
      this.emitLifecycle('provider.helius_pumpfun.shadow_connected', {
        commitment: this.commitment,
        programId: this.programId,
        connectionEpoch: socketEpoch,
        subscriptionRequestId: socketSubscriptionRequestId,
        subscriptionReady: false
      });
    });

    socket.on('message', (raw) => this.enqueueRawMessage(raw, Date.now(), {
      connectionEpoch: socketEpoch,
      subscriptionRequestId: socketSubscriptionRequestId
    }));
    socket.on('pong', () => this.handlePong(socket, socketEpoch));
    socket.on('error', (error) => {
      const lifecycle = this.lifecyclePhase();
      const errorMessage = this.sanitizeErrorMessage(error);
      if (lifecycle.shutdownPhase) this.stats.shutdownPhaseErrors += 1;
      else this.stats.errorEvents += 1;
      this.stats.lastErrorAt = new Date().toISOString();
      this.stats.lastErrorMessage = errorMessage;
      this.emitLifecycle('provider.helius_pumpfun.shadow_error', {
        errorMessage,
        sessionPhase: lifecycle.sessionPhase,
        shutdownError: lifecycle.shutdownPhase,
        shutdownAgeMs: lifecycle.shutdownAgeMs,
        connectionEpoch: socketEpoch,
        subscriptionReady: socketEpoch === this.connectionEpoch && this.subscriptionReady
      });
    });
    socket.on('close', (code, reasonBuffer) => {
      const lifecycle = this.lifecyclePhase();
      const isCurrentSocket = this.ws === socket;
      if (isCurrentSocket) {
        this.stopHeartbeat();
        this.clearSubscriptionAckTimer();
        this.subscriptionReady = false;
        this.currentSubscriptionId = null;
        this.stats.connected = false;
        this.stats.subscriptionReady = false;
      }
      this.stats.closeEvents += 1;
      this.stats.lastDisconnectedAt = new Date().toISOString();
      this.stats.lastCloseCode = Number(code || 0) || 0;
      this.stats.lastCloseReason = reasonBuffer ? reasonBuffer.toString() : '';
      if (lifecycle.shutdownPhase) this.stats.shutdownPhaseDisconnects += 1;
      const gap = !lifecycle.shutdownPhase && this.running && isCurrentSocket
        ? this.startTransportGap(socketEpoch)
        : null;
      this.emitLifecycle('provider.helius_pumpfun.shadow_disconnected', {
        code: this.stats.lastCloseCode,
        reason: this.stats.lastCloseReason,
        sessionPhase: lifecycle.sessionPhase,
        shutdownDisconnect: lifecycle.shutdownPhase,
        shutdownInitiatedAt: Number.isFinite(this.stopInitiatedAtMs)
          ? new Date(this.stopInitiatedAtMs).toISOString()
          : null,
        shutdownAgeMs: lifecycle.shutdownAgeMs,
        connectionEpoch: socketEpoch,
        subscriptionRequestId: socketSubscriptionRequestId,
        subscriptionReadyAtClose: this.currentEpochAckAtMs !== null,
        transportGapSequence: gap?.sequence ?? null,
        transportGapStartedAt: gap?.startedAt ?? null,
        lastNotificationSlot: this.highestNotificationSlot
      });
      if (this.running && isCurrentSocket) this.scheduleReconnect();
    });
  }

  sendSubscriptionRequest(socket, connectionEpoch, requestId) {
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method: 'logsSubscribe',
      params: [
        { mentions: [this.programId] },
        { commitment: this.commitment }
      ]
    });
    try {
      socket.send(request, (error) => {
        if (!error) return;
        this.recordSubscriptionFailure('SEND_FAILED', connectionEpoch, requestId, null);
        if (this.ws === socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
      });
      this.armSubscriptionAckTimer(socket, connectionEpoch, requestId);
    } catch {
      this.recordSubscriptionFailure('SEND_FAILED', connectionEpoch, requestId, null);
      if (this.ws === socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
    }
  }

  armSubscriptionAckTimer(socket, connectionEpoch, requestId) {
    this.clearSubscriptionAckTimer();
    this.subscriptionAckTimer = setTimeout(
      () => this.handleSubscriptionAckTimeout(socket, connectionEpoch, requestId),
      this.subscriptionAckTimeoutMs
    );
    this.subscriptionAckTimer.unref?.();
  }

  handleSubscriptionAckTimeout(socket, connectionEpoch, requestId) {
    if (
      !this.running
      || this.ws !== socket
      || this.connectionEpoch !== connectionEpoch
      || this.activeSubscriptionRequestId !== requestId
      || this.subscriptionReady
    ) return false;
    this.stats.subscriptionAckTimeouts += 1;
    const recorded = this.recordSubscriptionFailure('ACK_TIMEOUT', connectionEpoch, requestId, null);
    if (!recorded) return false;
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    return true;
  }

  clearSubscriptionAckTimer() {
    clearTimeout(this.subscriptionAckTimer);
    this.subscriptionAckTimer = null;
  }

  recordSubscriptionFailure(reason, connectionEpoch, requestId, code = null) {
    if (
      connectionEpoch !== this.connectionEpoch
      || requestId !== this.activeSubscriptionRequestId
      || this.subscriptionReady
    ) return false;
    this.clearSubscriptionAckTimer();
    this.activeSubscriptionRequestId = null;
    this.stats.subscriptionErrors += 1;
    this.emitLifecycle('provider.helius_pumpfun.shadow_subscription_error', {
      reason,
      code,
      connectionEpoch,
      subscriptionRequestId: requestId,
      subscriptionReady: false
    });
    return true;
  }

  handleSubscriptionResponse(payload, transport = {}) {
    const connectionEpoch = Number(transport.connectionEpoch);
    const requestId = Number(payload.id);
    const current = Number.isFinite(connectionEpoch)
      && connectionEpoch === this.connectionEpoch
      && requestId === this.activeSubscriptionRequestId;
    if (!current) {
      this.stats.staleSubscriptionResponses += 1;
      return false;
    }
    if (payload.error || payload.result === null || payload.result === undefined) {
      this.recordSubscriptionFailure(
        payload.error ? 'JSON_RPC_REJECTED' : 'MISSING_SUBSCRIPTION_ID',
        connectionEpoch,
        requestId,
        payload.error?.code ?? null
      );
      const socket = this.ws;
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.terminate();
      return false;
    }

    this.clearSubscriptionAckTimer();
    const now = Date.now();
    const ackLatencyMs = Number.isFinite(this.currentEpochOpenedAtMs)
      ? Math.max(0, now - this.currentEpochOpenedAtMs)
      : null;
    this.subscriptionReady = true;
    this.currentSubscriptionId = payload.result;
    this.activeSubscriptionRequestId = null;
    this.currentEpochAckAtMs = now;
    this.stats.subscriptionReady = true;
    this.stats.subscriptionAcks += 1;
    if (ackLatencyMs !== null) {
      this.stats.subscriptionAckLatencySamples += 1;
      this.stats.subscriptionAckLatencyTotalMs += ackLatencyMs;
      this.stats.subscriptionAckLatencyMaxMs = Math.max(
        this.stats.subscriptionAckLatencyMaxMs,
        ackLatencyMs
      );
    }
    const recoveredGap = this.recoverTransportGap(connectionEpoch, now);
    this.emitLifecycle('provider.helius_pumpfun.shadow_subscription_ack', {
      connectionEpoch,
      subscriptionRequestId: requestId,
      subscriptionId: payload.result,
      ackLatencyMs,
      subscriptionReady: true,
      recoveredTransportGapSequence: recoveredGap?.sequence ?? null,
      recoveredTransportGapDurationMs: recoveredGap?.durationMs ?? null
    });
    if (recoveredGap) {
      this.emitLifecycle('provider.helius_pumpfun.shadow_transport_gap_closed', recoveredGap);
    }
    return true;
  }

  startTransportGap(afterEpoch, now = Date.now()) {
    if (Number.isFinite(this.transportGapStartedAtMs)) {
      return {
        sequence: this.transportGapSequence,
        startedAt: new Date(this.transportGapStartedAtMs).toISOString()
      };
    }
    this.transportGapSequence += 1;
    this.transportGapStartedAtMs = now;
    this.transportGapStartedAfterEpoch = afterEpoch;
    this.stats.transportGapsStarted += 1;
    this.stats.transportGapActive = true;
    this.stats.lastTransportGapSequence = this.transportGapSequence;
    this.stats.lastTransportGapStartedAt = new Date(now).toISOString();
    return {
      sequence: this.transportGapSequence,
      startedAt: new Date(now).toISOString()
    };
  }

  recoverTransportGap(connectionEpoch, now = Date.now()) {
    if (!Number.isFinite(this.transportGapStartedAtMs)) return null;
    const durationMs = Math.max(0, now - this.transportGapStartedAtMs);
    const gap = {
      sequence: this.transportGapSequence,
      startedAt: new Date(this.transportGapStartedAtMs).toISOString(),
      recoveredAt: new Date(now).toISOString(),
      durationMs,
      disconnectedAfterEpoch: this.transportGapStartedAfterEpoch,
      recoveredConnectionEpoch: connectionEpoch,
      lastNotificationSlotBeforeGap: this.highestNotificationSlot
    };
    this.lastRecoveredGapAtMs = now;
    this.lastRecoveredGapDurationMs = durationMs;
    this.pendingFirstNotificationGap = gap;
    this.transportGapStartedAtMs = null;
    this.transportGapStartedAfterEpoch = null;
    this.stats.transportGapsRecovered += 1;
    this.stats.transportGapActive = false;
    this.stats.transportGapDurationSamples += 1;
    this.stats.transportGapDurationTotalMs += durationMs;
    this.stats.transportGapDurationMaxMs = Math.max(this.stats.transportGapDurationMaxMs, durationMs);
    this.stats.lastTransportGapRecoveredAt = gap.recoveredAt;
    this.stats.lastTransportGapDurationMs = durationMs;
    return gap;
  }

  lifecyclePhase(nowMs = Date.now()) {
    const shutdownAgeMs = Number.isFinite(this.stopInitiatedAtMs)
      ? Math.max(0, nowMs - this.stopInitiatedAtMs)
      : null;
    const shutdownPhase = this.stopInProgress
      && shutdownAgeMs !== null
      && shutdownAgeMs <= this.shutdownGraceMs;
    return {
      sessionPhase: this.running ? 'ACTIVE' : (shutdownPhase ? 'STOPPING' : 'STOPPED'),
      shutdownPhase,
      shutdownAgeMs
    };
  }

  sanitizeErrorMessage(error) {
    let message = String(error?.message || error || 'unknown websocket error');
    if (this.url && message.includes(this.url)) {
      message = message.split(this.url).join('<redacted-websocket-url>');
    }
    return message
      .replace(/\b(?:wss?|https?):\/\/[^\s"'`<>)\]}]+/gi, '<redacted-url>')
      .replace(
        /([?&](?:api-key|apikey|key|token|access_token)=)[^&\s"'`<>)\]}]+/gi,
        '$1<redacted>'
      )
      .replace(
        /\b(api[-_]?key|apikey|token|access[_-]?token)(\s*[:=]\s*)[^\s,;]+/gi,
        '$1$2<redacted>'
      )
      .slice(0, 500);
  }

  async closeSocketForStop(socket, timeoutMs = 750) {
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(() => {
        this.stats.stopCloseTimedOut = true;
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
        finish();
      }, timeoutMs);
      socket.once('close', finish);
      if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'shadow listener stop');
    });
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const delayMs = this.currentReconnectDelayMs;
    this.stats.reconnects += 1;
    this.currentReconnectDelayMs = Math.min(this.maxReconnectDelayMs, Math.max(1000, delayMs * 2));
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  startHeartbeat(socket, connectionEpoch) {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (!this.running || this.ws !== socket || socket.readyState !== WebSocket.OPEN) return;
      if (this.awaitingPong) {
        this.handlePongTimeout(socket, connectionEpoch);
        return;
      }
      this.awaitingPong = true;
      this.stats.pingsSent += 1;
      this.stats.lastPingAt = new Date().toISOString();
      socket.ping();
      this.pongDeadlineTimer = setTimeout(
        () => this.handlePongTimeout(socket, connectionEpoch),
        this.pongTimeoutMs
      );
      this.pongDeadlineTimer.unref?.();
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  handlePong(socket, connectionEpoch) {
    if (this.ws !== socket || connectionEpoch !== this.connectionEpoch) return;
    this.awaitingPong = false;
    clearTimeout(this.pongDeadlineTimer);
    this.pongDeadlineTimer = null;
    this.stats.pongsReceived += 1;
    this.stats.lastPongAt = new Date().toISOString();
  }

  handlePongTimeout(socket, connectionEpoch) {
    if (
      !this.running
      || this.ws !== socket
      || connectionEpoch !== this.connectionEpoch
      || !this.awaitingPong
    ) return false;
    this.awaitingPong = false;
    clearTimeout(this.pongDeadlineTimer);
    this.pongDeadlineTimer = null;
    this.stats.pongTimeouts += 1;
    this.emitLifecycle('provider.helius_pumpfun.shadow_pong_timeout', {
      connectionEpoch,
      pongTimeoutMs: this.pongTimeoutMs,
      lastPingAt: this.stats.lastPingAt,
      lastPongAt: this.stats.lastPongAt
    });
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
    return true;
  }

  stopHeartbeat() {
    clearInterval(this.pingTimer);
    clearTimeout(this.pongDeadlineTimer);
    this.pingTimer = null;
    this.pongDeadlineTimer = null;
    this.awaitingPong = false;
  }

  enqueueRawMessage(raw, receivedAtMs = Date.now(), transport = {}) {
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
    this.eventQueue.push({ raw, receivedAtMs, bytes, transport });
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
        this.handleRawMessage(item.raw, item.receivedAtMs, item.bytes, item.transport);
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
    this.stats.eventQueueDrainMaxBatch = Math.max(this.stats.eventQueueDrainMaxBatch, processed);
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

  handleRawMessage(raw, receivedAtMs = Date.now(), rawBytes = null, transport = {}) {
    const bytes = Number.isFinite(Number(rawBytes)) ? Number(rawBytes) : Buffer.byteLength(raw);
    let payload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      this.stats.parseErrors += 1;
      return;
    }

    if (payload.id !== null && payload.id !== undefined) {
      this.handleSubscriptionResponse(payload, transport);
      return;
    }
    if (payload.method !== 'logsNotification') return;
    const transportEpoch = Number(transport.connectionEpoch);
    if (Number.isFinite(transportEpoch) && (
      transportEpoch !== this.connectionEpoch || !this.subscriptionReady
    )) {
      this.stats.notificationsBeforeSubscriptionAck += 1;
      return;
    }
    this.stats.notifications += 1;
    const result = payload.params?.result;
    const value = result?.value;
    if (!value) return;
    if (value.err !== null && value.err !== undefined) {
      this.stats.failedNotifications += 1;
      this.stats.failedNotificationBytes += bytes;
      return;
    }

    const slot = Number(result?.context?.slot);
    const signature = value.signature || null;
    const notificationKey = Number.isFinite(slot) && signature ? `${slot}|${signature}` : null;
    if (!notificationKey) this.stats.notificationsWithoutDedupKey += 1;
    if (notificationKey && this.seenNotificationKeys.has(notificationKey)) {
      this.stats.duplicateNotifications += 1;
      return;
    }
    if (notificationKey) {
      this.seenNotificationKeys.set(notificationKey, true);
      while (this.seenNotificationKeys.size > this.maxSeenNotificationKeys) {
        this.seenNotificationKeys.delete(this.seenNotificationKeys.keys().next().value);
      }
    }
    const notificationOutOfOrder = Number.isFinite(slot)
      && Number.isFinite(this.highestNotificationSlot)
      && slot < this.highestNotificationSlot;
    if (notificationOutOfOrder) this.stats.outOfOrderNotifications += 1;
    if (Number.isFinite(slot)) {
      this.highestNotificationSlot = Number.isFinite(this.highestNotificationSlot)
        ? Math.max(this.highestNotificationSlot, slot)
        : slot;
      this.stats.highestNotificationSlot = this.highestNotificationSlot;
    }

    if (this.pendingFirstNotificationGap) {
      const recoveredGap = this.pendingFirstNotificationGap;
      this.pendingFirstNotificationGap = null;
      this.stats.firstNotificationsAfterGap += 1;
      this.emitLifecycle('provider.helius_pumpfun.shadow_transport_gap_first_notification', {
        ...recoveredGap,
        firstNotificationAt: new Date(receivedAtMs).toISOString(),
        firstNotificationSlot: Number.isFinite(slot) ? slot : null,
        slotDelta: Number.isFinite(slot) && Number.isFinite(recoveredGap.lastNotificationSlotBeforeGap)
          ? slot - recoveredGap.lastNotificationSlotBeforeGap
          : null
      });
    }

    this.stats.successfulNotifications += 1;
    const context = {
      signature,
      slot: Number.isFinite(slot) ? slot : null,
      receivedAt: new Date(receivedAtMs).toISOString(),
      queueDelayMs: Math.max(0, Date.now() - receivedAtMs),
      connectionEpoch: Number.isFinite(transportEpoch) ? transportEpoch : null,
      subscriptionId: this.currentSubscriptionId,
      transportGapSequence: this.transportGapSequence || null,
      notificationOutOfOrder,
      slotLagFromHighWater: notificationOutOfOrder && Number.isFinite(slot)
        ? this.highestNotificationSlot - slot
        : null
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
      source: this.runtimeEnabled ? 'helius_logs_trade_runtime' : 'helius_logs_trade_shadow',
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
      source: this.runtimeEnabled ? 'helius_logs_create_runtime' : 'helius_logs_create_shadow',
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
        ? (this.runtimeEnabled ? 'helius_logs_complete_runtime' : 'helius_logs_complete_shadow')
        : (this.runtimeEnabled ? 'helius_logs_migration_runtime' : 'helius_logs_migration_shadow'),
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
      this.handlers.onLifecycle?.(type, {
        ...payload,
        provider: 'helius_pumpfun',
        reportOnly: !this.runtimeEnabled,
        strategyConsumptionEnabled: this.runtimeEnabled
      });
    } catch {
      // Provider lifecycle telemetry must never affect runtime behavior.
    }
  }

  emitShadowEvent(type, payload = {}) {
    try {
      this.handlers.onShadowEvent?.(type, {
        ...payload,
        reportOnly: !this.runtimeEnabled,
        strategyConsumptionEnabled: this.runtimeEnabled
      });
    } catch {
      // Provider callbacks are isolated from the websocket decoder and reconnect loop.
    }
  }

  getStats() {
    this.syncEventQueueStats();
    return {
      ...this.stats,
      connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN),
      subscriptionReady: this.subscriptionReady,
      connectionEpoch: this.connectionEpoch,
      activeSubscriptionRequestId: this.activeSubscriptionRequestId,
      currentSubscriptionId: this.currentSubscriptionId,
      transportGapActive: Number.isFinite(this.transportGapStartedAtMs),
      activeTransportGapDurationMs: Number.isFinite(this.transportGapStartedAtMs)
        ? Math.max(0, Date.now() - this.transportGapStartedAtMs)
        : null,
      currentReconnectDelayMs: this.currentReconnectDelayMs,
      subscriptionAckLatencyMeanMs: this.stats.subscriptionAckLatencySamples > 0
        ? this.stats.subscriptionAckLatencyTotalMs / this.stats.subscriptionAckLatencySamples
        : null,
      eventQueueLatencyMeanMs: this.stats.eventQueueLatencySamples > 0
        ? this.stats.eventQueueLatencyTotalMs / this.stats.eventQueueLatencySamples
        : null,
      eventQueueDrainMeanMs: this.stats.eventQueueDrainCalls > 0
        ? this.stats.eventQueueDrainTotalMs / this.stats.eventQueueDrainCalls
        : null
    };
  }

  getTransportStatus() {
    return {
      connected: Boolean(this.ws && this.ws.readyState === WebSocket.OPEN),
      subscriptionReady: this.subscriptionReady === true,
      connectionEpoch: this.connectionEpoch,
      subscriptionId: this.currentSubscriptionId,
      transportGapActive: Number.isFinite(this.transportGapStartedAtMs),
      transportGapSequence: this.transportGapSequence || null,
      transportGapStartedAtMs: this.transportGapStartedAtMs,
      lastRecoveredGapAtMs: this.lastRecoveredGapAtMs,
      lastRecoveredGapDurationMs: this.lastRecoveredGapDurationMs
    };
  }
}

module.exports = HeliusPumpfunShadowListener;
