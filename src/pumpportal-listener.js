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
    this.reconnectDelayMs = 5000;
    this.reconnectTimer = null;
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
      lastMessageAt: null
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
      this.logger.info('PumpPortal websocket connected');
      this.send({ method: 'subscribeNewToken' });
      this.send({ method: 'subscribeMigration' });
      this.subscribeTrackedAccounts();
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

    socket.on('close', () => {
      this.stats.connected = false;
      this.logger.warn('PumpPortal websocket closed');
      if (this.ws === socket) {
        this.ws = null;
      }
      if (this.running) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, this.reconnectDelayMs);
      }
    });

    socket.on('error', (error) => {
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
        this.subscribedMints.add(mint);
        this.send({
          method: 'subscribeTokenTrade',
          keys: [mint]
        });
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

  subscribeTrackedAccounts() {
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
