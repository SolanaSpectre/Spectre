require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const Config = require('../src/config');

const ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_DIR = path.join(ROOT, 'data', 'reports', 'pumpportal-feed-probe');
const DEFAULT_LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pumpportal-feed-probe-latest.json');

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  if (positional.length > 0 && args.durationMs === undefined && args.ms === undefined) args.durationMs = positional[0];
  if (positional.length > 1 && args.sampleTokenTrades === undefined) args.sampleTokenTrades = positional[1];
  if (positional.length > 2 && args.pingIntervalMs === undefined) args.pingIntervalMs = positional[2];
  return args;
}

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : null;
}

function nowIso() {
  return new Date().toISOString();
}

function urlForMode(mode) {
  const baseUrl = Config.pumpPortalWebsocketUrl;
  const apiKey = Config.pumpPortalApiKey;
  if (mode === 'no-key' || !apiKey || !Config.pumpPortalUseApiKeyQuery) {
    return baseUrl;
  }
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}api-key=${encodeURIComponent(apiKey)}`;
}

function sanitizeUrl(url) {
  return String(url || '').replace(/([?&]api-key=)[^&]+/i, '$1<redacted>');
}

function classifyMessage(payload = {}) {
  const method = payload.method || payload.type || payload.txType || '';
  if (method === 'newToken' || method === 'subscribeNewToken' || payload.txType === 'create') return 'newToken';
  if (isMigrationPayload(payload, method)) return 'migration';
  if (payload.mint || payload.token || payload.mintAddress) return 'tradeOrMintEvent';
  return method || 'unknown';
}

function isMigrationPayload(payload = {}, method = '') {
  const normalizedMethod = String(method || payload.method || payload.type || '').toLowerCase();
  const txType = String(payload.txType || '').toLowerCase();
  return normalizedMethod === 'migration'
    || normalizedMethod === 'subscribemigration'
    || txType === 'migrate'
    || txType === 'migration';
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function buildEmptyStats(mode, url, durationMs, sampleTokenTrades, pingIntervalMs) {
  const paidSamplingEnabled = mode === 'configured' && Boolean(Config.pumpPortalApiKey) && sampleTokenTrades > 0;
  return {
    mode,
    sanitizedUrl: sanitizeUrl(url),
    durationMs,
    sampleTokenTrades,
    pingIntervalMs,
    mimicRuntimeChurn: false,
    churnIntervalMs: null,
    churnUnsubscribeCount: null,
    churnBurstIntervalMs: null,
    churnBurstSize: null,
    paidSamplingEnabled,
    startedAt: nowIso(),
    stoppedAt: null,
    openedAt: null,
    connectedAtStop: false,
    openEvents: 0,
    closeEvents: 0,
    errorEvents: 0,
    parseErrors: 0,
    messages: 0,
    newTokens: 0,
    migrations: 0,
    tradeOrMintEvents: 0,
    unknownMessages: 0,
    subscribedTokenTrades: 0,
    knownMints: 0,
    queuedMints: 0,
    tokenTradeSubscribeFrames: 0,
    tokenTradeUnsubscribeFrames: 0,
    tokenTradeResubscribeFrames: 0,
    controlFramesSent: 0,
    churnRotations: 0,
    churnBurstEvents: 0,
    lastMessageAt: null,
    lastPingAt: null,
    lastPongAt: null,
    pingsSent: 0,
    pongsReceived: 0,
    connectionAgeMs: null,
    lastCloseCode: null,
    lastCloseReason: null,
    lastErrorMessage: null,
    messageTypeCounts: {},
    messageTextCounts: {},
    firstSamples: {},
    subscribedMints: []
  };
}

function recordSample(stats, type, payload) {
  if (stats.firstSamples[type]) return;
  stats.firstSamples[type] = {
    capturedAt: nowIso(),
    keys: Object.keys(payload || {}).sort(),
    payload
  };
}

function runProbe({
  mode,
  durationMs,
  sampleTokenTrades,
  pingIntervalMs,
  mimicRuntimeChurn,
  churnIntervalMs,
  churnUnsubscribeCount,
  churnBurstIntervalMs,
  churnBurstSize
}) {
  return new Promise((resolve) => {
    const url = urlForMode(mode);
    const stats = buildEmptyStats(mode, url, durationMs, sampleTokenTrades, pingIntervalMs);
    stats.mimicRuntimeChurn = Boolean(mimicRuntimeChurn);
    stats.churnIntervalMs = Number.isFinite(churnIntervalMs) && churnIntervalMs > 0 ? churnIntervalMs : null;
    stats.churnUnsubscribeCount = Number.isFinite(churnUnsubscribeCount) && churnUnsubscribeCount > 0 ? churnUnsubscribeCount : null;
    stats.churnBurstIntervalMs = Number.isFinite(churnBurstIntervalMs) && churnBurstIntervalMs > 0 ? churnBurstIntervalMs : null;
    stats.churnBurstSize = Number.isFinite(churnBurstSize) && churnBurstSize > 0 ? churnBurstSize : null;
    const subscribedMints = new Set();
    const knownMints = new Set();
    const queuedMints = [];
    const subscriptionOrder = [];
    let settled = false;
    let pingTimer = null;
    let churnTimer = null;
    let burstTimer = null;
    const socket = new WebSocket(url);

    const sendControlFrame = (message, counterName) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      stats.controlFramesSent += 1;
      if (counterName) stats[counterName] += 1;
      return true;
    };

    const subscribeMint = (mint, counterName = 'tokenTradeSubscribeFrames') => {
      if (!mint || subscribedMints.has(mint)) return false;
      subscribedMints.add(mint);
      subscriptionOrder.push(mint);
      stats.subscribedTokenTrades = subscribedMints.size;
      return sendControlFrame({ method: 'subscribeTokenTrade', keys: [mint] }, counterName);
    };

    const unsubscribeMint = (mint) => {
      if (!mint || !subscribedMints.has(mint)) return false;
      subscribedMints.delete(mint);
      stats.subscribedTokenTrades = subscribedMints.size;
      return sendControlFrame({ method: 'unsubscribeTokenTrade', keys: [mint] }, 'tokenTradeUnsubscribeFrames');
    };

    const nextQueuedMint = () => {
      while (queuedMints.length > 0) {
        const mint = queuedMints.shift();
        if (mint && !subscribedMints.has(mint)) return mint;
      }
      return null;
    };

    const rotateChurnMints = () => {
      if (!stats.mimicRuntimeChurn || socket.readyState !== WebSocket.OPEN) return;
      let rotated = 0;
      const maxRotations = stats.churnUnsubscribeCount || 1;
      while (rotated < maxRotations && subscriptionOrder.length > 0) {
        const mint = subscriptionOrder.shift();
        if (!mint || !subscribedMints.has(mint)) continue;
        unsubscribeMint(mint);
        const replacement = nextQueuedMint();
        if (replacement) subscribeMint(replacement);
        rotated += 1;
      }
      stats.queuedMints = queuedMints.length;
      if (rotated > 0) stats.churnRotations += 1;
    };

    const sendResubscribeBurst = () => {
      if (!stats.mimicRuntimeChurn || socket.readyState !== WebSocket.OPEN) return;
      const mints = Array.from(subscribedMints).slice(-1 * (stats.churnBurstSize || 10));
      for (const mint of mints) {
        sendControlFrame({ method: 'subscribeTokenTrade', keys: [mint] }, 'tokenTradeResubscribeFrames');
      }
      if (mints.length > 0) stats.churnBurstEvents += 1;
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (churnTimer) {
        clearInterval(churnTimer);
        churnTimer = null;
      }
      if (burstTimer) {
        clearInterval(burstTimer);
        burstTimer = null;
      }
      stats.stoppedAt = nowIso();
      stats.connectedAtStop = socket.readyState === WebSocket.OPEN;
      if (stats.openedAt) {
        stats.connectionAgeMs = new Date(stats.stoppedAt).getTime() - new Date(stats.openedAt).getTime();
      }
      stats.subscribedMints = Array.from(subscribedMints);
      stats.knownMints = knownMints.size;
      stats.queuedMints = queuedMints.length;
      try {
        socket.removeAllListeners();
        socket.on('error', () => {});
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) socket.close();
      } catch {}
      resolve(stats);
    };

    const timer = setTimeout(finish, durationMs);
    if (typeof timer.unref === 'function') timer.unref();

    socket.on('open', () => {
      stats.openEvents += 1;
      stats.openedAt = nowIso();
      sendControlFrame({ method: 'subscribeNewToken' });
      sendControlFrame({ method: 'subscribeMigration' });
      if (Number.isFinite(pingIntervalMs) && pingIntervalMs > 0) {
        pingTimer = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          try {
            socket.ping();
            stats.pingsSent += 1;
            stats.lastPingAt = nowIso();
          } catch (error) {
            stats.errorEvents += 1;
            stats.lastErrorMessage = error.message;
          }
        }, pingIntervalMs);
        if (typeof pingTimer.unref === 'function') pingTimer.unref();
      }
      if (stats.mimicRuntimeChurn && stats.churnIntervalMs) {
        churnTimer = setInterval(rotateChurnMints, stats.churnIntervalMs);
        if (typeof churnTimer.unref === 'function') churnTimer.unref();
      }
      if (stats.mimicRuntimeChurn && stats.churnBurstIntervalMs) {
        burstTimer = setInterval(sendResubscribeBurst, stats.churnBurstIntervalMs);
        if (typeof burstTimer.unref === 'function') burstTimer.unref();
      }
    });

    socket.on('message', (raw) => {
      stats.messages += 1;
      stats.lastMessageAt = nowIso();

      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        stats.parseErrors += 1;
        return;
      }

      const type = classifyMessage(payload);
      stats.messageTypeCounts[type] = (stats.messageTypeCounts[type] || 0) + 1;
      if (payload.message) {
        stats.messageTextCounts[payload.message] = (stats.messageTextCounts[payload.message] || 0) + 1;
      }
      recordSample(stats, type, payload);

      if (type === 'newToken') {
        stats.newTokens += 1;
        const mint = mintOf(payload);
        if (mint && !knownMints.has(mint)) {
          knownMints.add(mint);
          stats.knownMints = knownMints.size;
        }
        if (mint && stats.paidSamplingEnabled && !subscribedMints.has(mint)) {
          if (subscribedMints.size < sampleTokenTrades) {
            subscribeMint(mint);
          } else if (stats.mimicRuntimeChurn) {
            queuedMints.push(mint);
            stats.queuedMints = queuedMints.length;
          }
        }
      } else if (type === 'migration') {
        stats.migrations += 1;
      } else if (type === 'tradeOrMintEvent') {
        stats.tradeOrMintEvents += 1;
      } else {
        stats.unknownMessages += 1;
      }
    });

    socket.on('close', (code, reasonBuffer) => {
      stats.closeEvents += 1;
      stats.lastCloseCode = Number(code || 0) || 0;
      stats.lastCloseReason = reasonBuffer ? reasonBuffer.toString() : '';
      clearTimeout(timer);
      finish();
    });

    socket.on('error', (error) => {
      stats.errorEvents += 1;
      stats.lastErrorMessage = error.message;
    });

    socket.on('pong', () => {
      stats.pongsReceived += 1;
      stats.lastPongAt = nowIso();
    });
  });
}

function interpretProbe(stats) {
  const paidSubscriptionRejections = Object.entries(stats.messageTextCounts || {})
    .filter(([message]) => /subscribeTokenTrade|subscribeAccountTrade/i.test(message)
      && /only available|funded|api key/i.test(message))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  if (paidSubscriptionRejections > 0) {
    return `provider rejected ${paidSubscriptionRejections} paid trade subscription request(s)`;
  }
  if (!stats.openEvents) {
    return 'websocket did not open; check endpoint, API key, IP/rate-limit, or provider availability';
  }
  if (stats.errorEvents || stats.closeEvents) {
    return 'websocket opened but errored/closed during probe; compare close code and error with runtime churn';
  }
  if (stats.newTokens > 0 && stats.migrations === 0) {
    return 'new-token stream works, but no migration event arrived during probe window; longer probe or provider migration-subscription check needed';
  }
  if (stats.newTokens === 0 && stats.messages === 0) {
    return 'connection stayed open but no data arrived; check subscription method names or provider feed availability';
  }
  return 'probe received data without connection failure';
}

function buildSummary(probes) {
  const configured = probes.find((probe) => probe.mode === 'configured') || null;
  const noKey = probes.find((probe) => probe.mode === 'no-key') || null;
  const modeComparison = configured && noKey ? {
    configuredOpened: configured.openEvents > 0,
    noKeyOpened: noKey.openEvents > 0,
    configuredErrored: configured.errorEvents > 0 || configured.closeEvents > 0,
    noKeyErrored: noKey.errorEvents > 0 || noKey.closeEvents > 0,
    configuredNewTokens: configured.newTokens,
    noKeyNewTokens: noKey.newTokens,
    configuredMigrations: configured.migrations,
    noKeyMigrations: noKey.migrations,
    interpretation: configured.errorEvents > 0 && noKey.openEvents > 0 && noKey.errorEvents === 0
      ? 'configured API-key connection is less healthy than no-key free-stream connection; suspect key/auth/rate-limit'
      : 'compare configured vs no-key rows before changing runtime config'
  } : null;

  return {
    modes: probes.length,
    totalMessages: probes.reduce((sum, probe) => sum + probe.messages, 0),
    totalNewTokens: probes.reduce((sum, probe) => sum + probe.newTokens, 0),
    totalMigrations: probes.reduce((sum, probe) => sum + probe.migrations, 0),
    modesOpened: probes.filter((probe) => probe.openEvents > 0).length,
    modesWithErrorsOrCloses: probes.filter((probe) => probe.errorEvents > 0 || probe.closeEvents > 0).length,
    modeComparison
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const durationMs = Number(args.durationMs || args.ms || 300000);
  const modes = String(args.modes || args.mode || 'configured')
    .split(',')
    .map((mode) => mode.trim())
    .filter(Boolean);
  const sampleTokenTrades = Number(args.sampleTokenTrades || 0);
  const pingIntervalMs = Number(args.pingIntervalMs || Config.pumpPortalPingIntervalMs || 0);
  const mimicRuntimeChurn = Boolean(args.mimicRuntimeChurn || args.churn);
  const churnIntervalMs = Number(args.churnIntervalMs || 60000);
  const churnUnsubscribeCount = Number(args.churnUnsubscribeCount || 1);
  const churnBurstIntervalMs = Number(args.churnBurstIntervalMs || 300000);
  const churnBurstSize = Number(args.churnBurstSize || 10);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const generatedAt = nowIso();

  console.log(`Starting PumpPortal feed probe: modes=${modes.join(',')} durationMs=${durationMs} sampleTokenTrades=${sampleTokenTrades} pingIntervalMs=${pingIntervalMs} mimicRuntimeChurn=${mimicRuntimeChurn}`);
  const probes = await Promise.all(modes.map((mode) => runProbe({
    mode,
    durationMs,
    sampleTokenTrades,
    pingIntervalMs,
    mimicRuntimeChurn,
    churnIntervalMs,
    churnUnsubscribeCount,
    churnBurstIntervalMs,
    churnBurstSize
  })));
  for (const probe of probes) {
    probe.interpretation = interpretProbe(probe);
    console.log(`${probe.mode}: opened=${probe.openEvents} messages=${probe.messages} newTokens=${probe.newTokens} migrations=${probe.migrations} tokenSubFrames=${probe.tokenTradeSubscribeFrames} tokenUnsubFrames=${probe.tokenTradeUnsubscribeFrames} tokenResubFrames=${probe.tokenTradeResubscribeFrames} pings=${probe.pingsSent}/${probe.pongsReceived} errors=${probe.errorEvents} closes=${probe.closeEvents} lastError=${probe.lastErrorMessage || 'none'}`);
  }

  const payload = {
    generatedAt,
    mode: 'report_only_pumpportal_feed_probe',
    note: 'Standalone PumpPortal websocket probe. It subscribes to subscribeNewToken and subscribeMigration, optionally samples a small number of token-trade streams, redacts API-key material, and does not invoke trading, scoring, AI review, entries, or exits.',
    config: {
      configuredUrl: sanitizeUrl(urlForMode('configured')),
      noKeyUrl: sanitizeUrl(urlForMode('no-key')),
      hasApiKey: Boolean(Config.pumpPortalApiKey),
      useApiKeyQuery: Boolean(Config.pumpPortalUseApiKeyQuery),
      pingIntervalMs,
      mimicRuntimeChurn,
      churnIntervalMs: mimicRuntimeChurn ? churnIntervalMs : null,
      churnUnsubscribeCount: mimicRuntimeChurn ? churnUnsubscribeCount : null,
      churnBurstIntervalMs: mimicRuntimeChurn ? churnBurstIntervalMs : null,
      churnBurstSize: mimicRuntimeChurn ? churnBurstSize : null
    },
    summary: buildSummary(probes),
    probes
  };

  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `pumpportal-feed-probe-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(latestPath, payload);
  console.log(`Wrote PumpPortal feed probe: ${reportPath}`);
  console.log(`Wrote latest PumpPortal feed probe: ${latestPath}`);
}

main().catch((error) => {
  console.error(`PumpPortal feed probe failed: ${error.stack || error.message}`);
  process.exit(1);
});
