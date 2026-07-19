const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const DEFAULT_WS_URL = 'wss://pumpdev.io/ws';
const DEFAULT_REPORT_DIR = path.join(ROOT, 'data', 'reports', 'pumpdev-feed-probe');
const DEFAULT_LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-feed-probe-latest.json');

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

function nowIso() {
  return new Date().toISOString();
}

function sanitizeUrl(url) {
  return String(url || '').replace(/([?&](?:api-key|apikey|key|token|access_token)=)[^&]+/gi, '$1<redacted>');
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function classifyMessage(payload = {}) {
  const type = String(payload.type || '').toLowerCase();
  if (type === 'connected' || type === 'subscribed' || type === 'unsubscribed' || type === 'error') {
    return 'system';
  }
  const method = String(payload.method || payload.type || payload.txType || '').toLowerCase();
  if (payload.txType === 'create') return 'newToken';
  if (payload.txType === 'buy' || payload.txType === 'sell') return 'trade';
  if (method === 'migrate' || method === 'migration' || payload.txType === 'migrate' || payload.txType === 'migration') {
    return 'migration';
  }
  if (mintOf(payload)) return 'mintEvent';
  return method || 'unknown';
}

function detectPairBase(payload = {}) {
  const quoteMint = String(payload.quoteMint || payload.poolQuoteMint || payload.quote || '').trim();
  if (quoteMint === 'So11111111111111111111111111111111111111112') return 'SOL';
  if (quoteMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') return 'USDC';
  if (Number.isFinite(Number(payload.solAmount)) || Number.isFinite(Number(payload.marketCapSol))) return 'SOL';
  if (Number.isFinite(Number(payload.usdcAmount)) || Number.isFinite(Number(payload.marketCapUsdc))) return 'USDC';
  return 'unknown';
}

function recordSample(stats, type, payload) {
  if (stats.firstSamples[type]) return;
  stats.firstSamples[type] = {
    capturedAt: nowIso(),
    keys: Object.keys(payload || {}).sort(),
    payload
  };
}

function buildEmptyStats(url, durationMs, sampleTokenTrades, pingIntervalMs) {
  return {
    provider: 'pumpdev',
    sanitizedUrl: sanitizeUrl(url),
    durationMs,
    sampleTokenTrades,
    pingIntervalMs,
    startedAt: nowIso(),
    stoppedAt: null,
    openedAt: null,
    connectedAtStop: false,
    openEvents: 0,
    closeEvents: 0,
    errorEvents: 0,
    parseErrors: 0,
    messages: 0,
    systemMessages: 0,
    newTokens: 0,
    trades: 0,
    migrations: 0,
    mintEvents: 0,
    unknownMessages: 0,
    knownMints: 0,
    subscribedTokenTrades: 0,
    requestedTokenTrades: 0,
    acknowledgedTokenTrades: 0,
    subscriptionAckMessages: 0,
    subscriptionErrorMessages: 0,
    subscriptionErrors: [],
    tokenTradeSubscribeFrames: 0,
    tokenTradeUnsubscribeFrames: 0,
    controlFramesSent: 0,
    pairSolEvents: 0,
    pairUsdcEvents: 0,
    pairUnknownEvents: 0,
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
    requestedMints: [],
    acknowledgedMints: []
  };
}

function runProbe({ url, durationMs, sampleTokenTrades, pingIntervalMs }) {
  return new Promise((resolve) => {
    const stats = buildEmptyStats(url, durationMs, sampleTokenTrades, pingIntervalMs);
    const subscribedMints = new Set();
    const acknowledgedMints = new Set();
    const knownMints = new Set();
    let settled = false;
    let pingTimer = null;
    const socket = new WebSocket(url);

    const sendControlFrame = (message, counterName) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify(message));
      stats.controlFramesSent += 1;
      if (counterName) stats[counterName] += 1;
      return true;
    };

    const subscribeMint = (mint) => {
      if (!mint || subscribedMints.has(mint)) return false;
      subscribedMints.add(mint);
      stats.subscribedTokenTrades = subscribedMints.size;
      return sendControlFrame({ method: 'subscribeTokenTrade', keys: [mint] }, 'tokenTradeSubscribeFrames');
    };

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
      stats.requestedMints = Array.from(subscribedMints);
      stats.acknowledgedMints = Array.from(acknowledgedMints);
      stats.requestedTokenTrades = subscribedMints.size;
      stats.acknowledgedTokenTrades = acknowledgedMints.size;
      stats.knownMints = knownMints.size;
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

      const pairBase = detectPairBase(payload);
      if (pairBase === 'SOL') {
        stats.pairSolEvents += 1;
        recordSample(stats, 'solPair', payload);
      } else if (pairBase === 'USDC') {
        stats.pairUsdcEvents += 1;
        recordSample(stats, 'usdcPair', payload);
      } else {
        stats.pairUnknownEvents += 1;
        recordSample(stats, 'unknownPair', payload);
      }

      if (type === 'system') {
        stats.systemMessages += 1;
        const systemType = String(payload.type || '').toLowerCase();
        if (systemType === 'subscribed' && payload.method === 'subscribeTokenTrade') {
          stats.subscriptionAckMessages += 1;
          const keys = Array.isArray(payload.keys) ? payload.keys.filter(Boolean) : [];
          for (const mint of keys) acknowledgedMints.add(mint);
          stats.acknowledgedTokenTrades = acknowledgedMints.size;
        } else if (systemType === 'error') {
          stats.subscriptionErrorMessages += 1;
          const message = String(payload.message || payload.error || 'unknown error').slice(0, 500);
          if (!stats.subscriptionErrors.includes(message)) stats.subscriptionErrors.push(message);
        }
      } else if (type === 'newToken') {
        stats.newTokens += 1;
        const mint = mintOf(payload);
        if (mint && !knownMints.has(mint)) {
          knownMints.add(mint);
          stats.knownMints = knownMints.size;
        }
        if (mint && subscribedMints.size < sampleTokenTrades) {
          subscribeMint(mint);
        }
      } else if (type === 'trade') {
        stats.trades += 1;
      } else if (type === 'migration') {
        stats.migrations += 1;
      } else if (type === 'mintEvent') {
        stats.mintEvents += 1;
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

function assessCapacity(stats, requirements = {}) {
  const requiredSubscriptions = Math.max(1, Number(requirements.requiredSubscriptions || 162));
  const expectedPlanSubscriptions = requirements.expectedPlanSubscriptions === null
    || requirements.expectedPlanSubscriptions === undefined
    ? null
    : Number(requirements.expectedPlanSubscriptions);
  const expectedMonthlyTradeQuota = requirements.expectedMonthlyTradeQuota === null
    || requirements.expectedMonthlyTradeQuota === undefined
    ? null
    : Number(requirements.expectedMonthlyTradeQuota);
  const requiredTradeMessagesPerHour = Math.max(1, Number(requirements.requiredTradeMessagesPerHour || 96000));
  const capacityError = stats.subscriptionErrors.find((message) => /subscription|tier|limit|capacity/i.test(message)) || null;
  const observedEnoughCandidates = Number(stats.knownMints || 0) >= requiredSubscriptions;
  let verdict = 'PROBE_INCONCLUSIVE';
  if (Number.isFinite(expectedPlanSubscriptions) && expectedPlanSubscriptions < requiredSubscriptions) {
    verdict = 'DECLARED_PLAN_CAPACITY_BELOW_REQUIREMENT';
  } else if (Number(stats.acknowledgedTokenTrades || 0) >= requiredSubscriptions) {
    verdict = 'ACKNOWLEDGED_CAPACITY_MEETS_REQUIREMENT';
  } else if (capacityError || observedEnoughCandidates) {
    verdict = 'OBSERVED_CAPACITY_BELOW_REQUIREMENT';
  } else {
    verdict = 'PROBE_INCONCLUSIVE_INSUFFICIENT_NEW_TOKENS';
  }
  return {
    verdict,
    requiredSubscriptions,
    acknowledgedSubscriptions: Number(stats.acknowledgedTokenTrades || 0),
    requestedSubscriptions: Number(stats.requestedTokenTrades || 0),
    knownMints: Number(stats.knownMints || 0),
    capacityError,
    expectedPlanSubscriptions: Number.isFinite(expectedPlanSubscriptions) ? expectedPlanSubscriptions : null,
    requiredTradeMessagesPerHour,
    expectedMonthlyTradeQuota: Number.isFinite(expectedMonthlyTradeQuota) ? expectedMonthlyTradeQuota : null,
    projectedFullCoverageHoursPerMonth: Number.isFinite(expectedMonthlyTradeQuota)
      ? Number((expectedMonthlyTradeQuota / requiredTradeMessagesPerHour).toFixed(2))
      : null
  };
}

function interpretProbe(stats) {
  const marketMessages = Number(stats.newTokens || 0)
    + Number(stats.trades || 0)
    + Number(stats.migrations || 0)
    + Number(stats.mintEvents || 0);
  if (!stats.openEvents) {
    return 'websocket did not open; check endpoint, DNS, IP/rate-limit, or provider availability';
  }
  if (stats.errorEvents || stats.closeEvents) {
    return 'websocket opened but errored/closed during probe; compare close code and age with PumpPortal churn';
  }
  if (stats.newTokens > 0 && stats.trades > 0) {
    return 'new-token and sampled token-trade streams worked without connection failure';
  }
  if (stats.newTokens > 0) {
    return 'new-token stream worked; enable sampleTokenTrades or run longer to validate token-trade stream';
  }
  if (stats.messages === 0) {
    return 'connection stayed open but no data arrived; check subscription method names or provider feed availability';
  }
  if (marketMessages === 0 && stats.systemMessages === stats.messages) {
    return 'connection stayed open but only system/subscription messages arrived; PumpDev market stream is silent or subscription was not activated';
  }
  return 'probe received non-market data without connection failure';
}

async function main() {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const args = parseArgs(process.argv.slice(2));
  const durationMs = Number(args.durationMs || args.ms || 300000);
  const sampleTokenTrades = Number(args.sampleTokenTrades || 25);
  const pingIntervalMs = Number(args.pingIntervalMs || process.env.PUMPDEV_PING_INTERVAL_MS || 25000);
  const url = String(args.url || process.env.PUMPDEV_WS_URL || DEFAULT_WS_URL);
  const requiredSubscriptions = Number(args.requiredSubscriptions || 162);
  const requiredTradeMessagesPerHour = Number(args.requiredTradeMessagesPerHour || 96000);
  const expectedPlanSubscriptions = args.expectedPlanSubscriptions === undefined
    ? null
    : Number(args.expectedPlanSubscriptions);
  const expectedMonthlyTradeQuota = args.expectedMonthlyTradeQuota === undefined
    ? null
    : Number(args.expectedMonthlyTradeQuota);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const generatedAt = nowIso();

  console.log(`Starting PumpDev feed probe: durationMs=${durationMs} sampleTokenTrades=${sampleTokenTrades} pingIntervalMs=${pingIntervalMs} url=${sanitizeUrl(url)}`);
  const probe = await runProbe({ url, durationMs, sampleTokenTrades, pingIntervalMs });
  probe.interpretation = interpretProbe(probe);
  const capacityAssessment = assessCapacity(probe, {
    requiredSubscriptions,
    requiredTradeMessagesPerHour,
    expectedPlanSubscriptions,
    expectedMonthlyTradeQuota
  });
  console.log(`pumpdev: opened=${probe.openEvents} messages=${probe.messages} newTokens=${probe.newTokens} trades=${probe.trades} migrations=${probe.migrations} tokenSubFrames=${probe.tokenTradeSubscribeFrames} pings=${probe.pingsSent}/${probe.pongsReceived} errors=${probe.errorEvents} closes=${probe.closeEvents} lastClose=${probe.lastCloseCode || 'none'} lastError=${probe.lastErrorMessage || 'none'}`);

  const payload = {
    generatedAt,
    mode: 'report_only_pumpdev_feed_probe',
    note: 'Standalone PumpDev websocket probe. It subscribes to subscribeNewToken, optionally samples token-trade streams, redacts key material, and does not invoke trading, scoring, AI review, entries, or exits. PumpDev docs say PumpSwap migration data is not yet available over WebSocket, so migrations=0 is not treated as a failure.',
    docs: {
      websocketUrl: 'wss://pumpdev.io/ws',
      migrationCaveat: 'PumpSwap migration token data is not yet available via WebSocket per PumpDev README/docs at time of implementation.'
    },
    config: {
      configuredUrl: sanitizeUrl(url),
      sampleTokenTrades,
      pingIntervalMs
    },
    summary: {
      opened: probe.openEvents > 0,
      healthyConnection: probe.openEvents > 0 && probe.errorEvents === 0 && probe.closeEvents === 0,
      messages: probe.messages,
      marketMessages: probe.newTokens + probe.trades + probe.migrations + probe.mintEvents,
      newTokens: probe.newTokens,
      trades: probe.trades,
      migrations: probe.migrations,
      knownMints: probe.knownMints,
      subscribedTokenTrades: probe.subscribedTokenTrades,
      requestedTokenTrades: probe.requestedTokenTrades,
      acknowledgedTokenTrades: probe.acknowledgedTokenTrades,
      pairSolEvents: probe.pairSolEvents,
      pairUsdcEvents: probe.pairUsdcEvents,
      pairUnknownEvents: probe.pairUnknownEvents,
      interpretation: probe.interpretation
    },
    capacityAssessment,
    probe
  };

  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `pumpdev-feed-probe-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(latestPath, payload);
  console.log(`Wrote PumpDev feed probe: ${reportPath}`);
  console.log(`Wrote latest PumpDev feed probe: ${latestPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`PumpDev feed probe failed: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, sanitizeUrl, classifyMessage, interpretProbe, assessCapacity, runProbe };
