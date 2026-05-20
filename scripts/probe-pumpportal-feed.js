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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
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
  if (method === 'migration' || method === 'subscribeMigration') return 'migration';
  if (payload.mint || payload.token || payload.mintAddress) return 'tradeOrMintEvent';
  return method || 'unknown';
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function send(socket, message) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function buildEmptyStats(mode, url, durationMs, sampleTokenTrades, pingIntervalMs) {
  const paidSamplingEnabled = mode === 'configured' && Boolean(Config.pumpPortalApiKey) && sampleTokenTrades > 0;
  return {
    mode,
    sanitizedUrl: sanitizeUrl(url),
    durationMs,
    sampleTokenTrades,
    pingIntervalMs,
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

function runProbe({ mode, durationMs, sampleTokenTrades, pingIntervalMs }) {
  return new Promise((resolve) => {
    const url = urlForMode(mode);
    const stats = buildEmptyStats(mode, url, durationMs, sampleTokenTrades, pingIntervalMs);
    const subscribedMints = new Set();
    let settled = false;
    let pingTimer = null;
    const socket = new WebSocket(url);

    const finish = () => {
      if (settled) return;
      settled = true;
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      stats.stoppedAt = nowIso();
      stats.connectedAtStop = socket.readyState === WebSocket.OPEN;
      if (stats.openedAt) {
        stats.connectionAgeMs = new Date(stats.stoppedAt).getTime() - new Date(stats.openedAt).getTime();
      }
      stats.subscribedMints = Array.from(subscribedMints);
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
      send(socket, { method: 'subscribeNewToken' });
      send(socket, { method: 'subscribeMigration' });
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
        if (mint && stats.paidSamplingEnabled && subscribedMints.size < sampleTokenTrades && !subscribedMints.has(mint)) {
          subscribedMints.add(mint);
          stats.subscribedTokenTrades = subscribedMints.size;
          send(socket, { method: 'subscribeTokenTrade', keys: [mint] });
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
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const generatedAt = nowIso();

  console.log(`Starting PumpPortal feed probe: modes=${modes.join(',')} durationMs=${durationMs} sampleTokenTrades=${sampleTokenTrades} pingIntervalMs=${pingIntervalMs}`);
  const probes = await Promise.all(modes.map((mode) => runProbe({
    mode,
    durationMs,
    sampleTokenTrades,
    pingIntervalMs
  })));
  for (const probe of probes) {
    probe.interpretation = interpretProbe(probe);
    console.log(`${probe.mode}: opened=${probe.openEvents} messages=${probe.messages} newTokens=${probe.newTokens} migrations=${probe.migrations} pings=${probe.pingsSent}/${probe.pongsReceived} errors=${probe.errorEvents} closes=${probe.closeEvents} lastError=${probe.lastErrorMessage || 'none'}`);
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
      pingIntervalMs
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
