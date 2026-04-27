const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'macro-posture');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'macro-posture-latest.json');
const DEFAULT_EVENTS_PATH = path.join(REPO_ROOT, 'data', 'macro', 'macro-events.json');

const SOURCES = {
  binanceTicker: 'https://api.binance.com/api/v3/ticker/24hr',
  binanceKlines: 'https://api.binance.com/api/v3/klines',
  coinGeckoMarketChart: 'https://api.coingecko.com/api/v3/coins',
  fearGreed: 'https://api.alternative.me/fng/?limit=1',
  solanaPublicRpc: 'https://api.mainnet-beta.solana.com'
};

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
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpsJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 8000;
  const method = options.method || 'GET';
  const body = options.body ? JSON.stringify(options.body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'user-agent': 'SpectreMacroPosture/1.0'
      },
      timeout: timeoutMs
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${res.statusCode} ${res.statusMessage || 'HTTP error'}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function fetchWithFallback(label, fetcher, fallback = null) {
  try {
    return { ok: true, label, value: await fetcher(), error: null };
  } catch (error) {
    return { ok: false, label, value: fallback, error: error.message };
  }
}

async function fetchBinanceMarket(symbol) {
  const tickerUrl = `${SOURCES.binanceTicker}?symbol=${encodeURIComponent(symbol)}`;
  const klinesUrl = `${SOURCES.binanceKlines}?symbol=${encodeURIComponent(symbol)}&interval=1h&limit=25`;
  const [ticker, klines] = await Promise.all([
    httpsJson(tickerUrl),
    httpsJson(klinesUrl)
  ]);
  return normalizeBinanceMarket(symbol, ticker, klines);
}

async function fetchCoinGeckoMarket(id, symbol) {
  const url = `${SOURCES.coinGeckoMarketChart}/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=1&interval=hourly`;
  const payload = await httpsJson(url);
  return normalizeCoinGeckoMarket(symbol, payload);
}

async function fetchMarket(symbol, coinGeckoId) {
  try {
    return await fetchBinanceMarket(symbol);
  } catch (binanceError) {
    const market = await fetchCoinGeckoMarket(coinGeckoId, symbol);
    return {
      ...market,
      source: 'coingecko_public_market_chart',
      fallbackReason: `binance failed: ${binanceError.message}`
    };
  }
}

function normalizeBinanceMarket(symbol, ticker, klines) {
  const closes = (klines || []).map((row) => number(row[4], null)).filter((value) => value !== null);
  const highs = (klines || []).map((row) => number(row[2], null)).filter((value) => value !== null);
  const lows = (klines || []).map((row) => number(row[3], null)).filter((value) => value !== null);
  const now = closes[closes.length - 1] || number(ticker.lastPrice);
  const oneHourAgo = closes[closes.length - 2] || now;
  const fourHoursAgo = closes[closes.length - 5] || closes[0] || now;
  const twentyFourHoursAgo = closes[0] || now;
  const high24h = Math.max(...highs, number(ticker.highPrice));
  const low24h = Math.min(...lows, number(ticker.lowPrice));
  const hourlyReturns = [];

  for (let index = 1; index < closes.length; index += 1) {
    if (closes[index - 1] > 0 && closes[index] > 0) {
      hourlyReturns.push(Math.log(closes[index] / closes[index - 1]));
    }
  }

  return {
    symbol,
    source: 'binance_public_spot',
    price: compact(now, 6),
    change1hPct: pctChange(now, oneHourAgo),
    change4hPct: pctChange(now, fourHoursAgo),
    change24hPct: compact(number(ticker.priceChangePercent), 4) ?? pctChange(now, twentyFourHoursAgo),
    range24hPct: now > 0 ? compact(((high24h - low24h) / now) * 100, 4) : null,
    drawdownFrom24hHighPct: high24h > 0 ? compact(((now - high24h) / high24h) * 100, 4) : null,
    bounceFrom24hLowPct: low24h > 0 ? compact(((now - low24h) / low24h) * 100, 4) : null,
    realizedVolHourlyPct: compact(stdDev(hourlyReturns) * 100, 4),
    quoteVolume: compact(number(ticker.quoteVolume), 2),
    sampleHours: closes.length
  };
}

function normalizeCoinGeckoMarket(symbol, payload) {
  const prices = (payload?.prices || [])
    .map((row) => ({ at: row[0], price: number(row[1], null) }))
    .filter((row) => row.price !== null);
  const closes = prices.map((row) => row.price);
  const volumes = (payload?.total_volumes || [])
    .map((row) => number(row[1], null))
    .filter((value) => value !== null);
  const now = closes[closes.length - 1];
  const oneHourAgo = closes[closes.length - 2] || now;
  const fourHoursAgo = closes[closes.length - 5] || closes[0] || now;
  const twentyFourHoursAgo = closes[0] || now;
  const high24h = Math.max(...closes);
  const low24h = Math.min(...closes);
  const hourlyReturns = [];

  for (let index = 1; index < closes.length; index += 1) {
    if (closes[index - 1] > 0 && closes[index] > 0) {
      hourlyReturns.push(Math.log(closes[index] / closes[index - 1]));
    }
  }

  return {
    symbol,
    source: 'coingecko_public_market_chart',
    price: compact(now, 6),
    change1hPct: pctChange(now, oneHourAgo),
    change4hPct: pctChange(now, fourHoursAgo),
    change24hPct: pctChange(now, twentyFourHoursAgo),
    range24hPct: now > 0 ? compact(((high24h - low24h) / now) * 100, 4) : null,
    drawdownFrom24hHighPct: high24h > 0 ? compact(((now - high24h) / high24h) * 100, 4) : null,
    bounceFrom24hLowPct: low24h > 0 ? compact(((now - low24h) / low24h) * 100, 4) : null,
    realizedVolHourlyPct: compact(stdDev(hourlyReturns) * 100, 4),
    quoteVolume: compact(volumes[volumes.length - 1], 2),
    sampleHours: closes.length
  };
}

function pctChange(now, previous) {
  if (!Number.isFinite(now) || !Number.isFinite(previous) || previous === 0) return null;
  return compact(((now - previous) / previous) * 100, 4);
}

function stdDev(values) {
  if (!values.length) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

async function fetchFearGreed() {
  const payload = await httpsJson(SOURCES.fearGreed);
  const latest = payload?.data?.[0] || {};
  return {
    source: 'alternative_me_fear_greed',
    value: number(latest.value, null),
    classification: latest.value_classification || null,
    timestamp: latest.timestamp || null
  };
}

async function fetchSolanaHealth() {
  const payload = await httpsJson(SOURCES.solanaPublicRpc, {
    method: 'POST',
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'getHealth'
    }
  });
  return {
    source: 'solana_public_rpc_getHealth',
    status: payload?.result || 'unknown',
    error: payload?.error || null
  };
}

function loadEvents(eventsPath, now = new Date()) {
  const payload = readJson(eventsPath, { events: [] });
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const nowMs = now.getTime();
  const horizonBeforeMs = 12 * 60 * 60 * 1000;
  const horizonAfterMs = 36 * 60 * 60 * 1000;

  return events
    .map((event) => {
      const eventAt = new Date(event.at);
      if (Number.isNaN(eventAt.getTime())) return null;
      const hoursFromNow = (eventAt.getTime() - nowMs) / (60 * 60 * 1000);
      return {
        id: event.id || `${event.title || 'event'}-${event.at}`,
        title: event.title || 'Macro event',
        at: eventAt.toISOString(),
        category: event.category || 'macro',
        severity: event.severity || 'medium',
        expectedImpact: event.expectedImpact || 'unknown',
        hoursFromNow: compact(hoursFromNow, 2)
      };
    })
    .filter(Boolean)
    .filter((event) => {
      const deltaMs = new Date(event.at).getTime() - nowMs;
      return deltaMs >= -horizonBeforeMs && deltaMs <= horizonAfterMs;
    })
    .sort((a, b) => Math.abs(a.hoursFromNow) - Math.abs(b.hoursFromNow));
}

function marketRiskContribution(label, market) {
  const risks = [];
  const change1h = number(market?.change1hPct);
  const change4h = number(market?.change4hPct);
  const change24h = number(market?.change24hPct);
  const range24h = number(market?.range24hPct);
  const volHourly = number(market?.realizedVolHourlyPct);
  const drawdown = number(market?.drawdownFrom24hHighPct);

  let score = 0;
  if (change1h <= -2.5) {
    score += 14;
    risks.push(`${label} sharp 1h selloff`);
  } else if (change1h <= -1.2) {
    score += 8;
    risks.push(`${label} weak 1h tape`);
  } else if (change1h >= 3.5) {
    score += 6;
    risks.push(`${label} overheated 1h move`);
  }

  if (change4h <= -5) {
    score += 14;
    risks.push(`${label} heavy 4h drawdown`);
  } else if (change4h <= -2.5) {
    score += 8;
    risks.push(`${label} negative 4h trend`);
  }

  if (change24h <= -7) {
    score += 12;
    risks.push(`${label} risk-off 24h trend`);
  } else if (change24h >= 12) {
    score += 8;
    risks.push(`${label} extended 24h move`);
  }

  if (range24h >= 18) {
    score += 14;
    risks.push(`${label} very wide 24h range`);
  } else if (range24h >= 10) {
    score += 8;
    risks.push(`${label} elevated 24h range`);
  }

  if (volHourly >= 2.2) {
    score += 12;
    risks.push(`${label} elevated realized volatility`);
  } else if (volHourly >= 1.4) {
    score += 6;
    risks.push(`${label} choppy hourly volatility`);
  }

  if (drawdown <= -10) {
    score += 10;
    risks.push(`${label} trading far below 24h high`);
  }

  return { score, risks };
}

function classifyTrend(market) {
  const change1h = number(market?.change1hPct);
  const change4h = number(market?.change4hPct);
  const change24h = number(market?.change24hPct);

  if (change1h <= -2 || change4h <= -4 || change24h <= -7) return 'weak';
  if (change1h >= 2.5 || change4h >= 5 || change24h >= 9) return 'extended';
  if (change4h > 1 && change24h > 1) return 'constructive';
  if (change4h < -1 && change24h < -1) return 'soft';
  return 'neutral';
}

function scorePosture({ solMarket, btcMarket, fearGreed, solanaHealth, events, fetchErrors }) {
  const reasons = [];
  let riskScore = 20;

  const solRisk = marketRiskContribution('SOL', solMarket);
  const btcRisk = marketRiskContribution('BTC', btcMarket);
  riskScore += solRisk.score;
  riskScore += Math.round(btcRisk.score * 0.7);
  reasons.push(...solRisk.risks, ...btcRisk.risks);

  const fng = number(fearGreed?.value, null);
  if (fng !== null) {
    if (fng <= 20) {
      riskScore += 12;
      reasons.push('crypto fear/greed is extreme fear');
    } else if (fng <= 35) {
      riskScore += 7;
      reasons.push('crypto fear/greed is cautious');
    } else if (fng >= 80) {
      riskScore += 10;
      reasons.push('crypto fear/greed is overheated');
    }
  }

  if (solanaHealth?.status && solanaHealth.status !== 'ok') {
    riskScore += 18;
    reasons.push('Solana public RPC health is not ok');
  }

  for (const event of events || []) {
    if (event.severity === 'high') {
      riskScore += 12;
      reasons.push(`high-impact event near session: ${event.title}`);
    } else if (event.severity === 'medium') {
      riskScore += 6;
      reasons.push(`medium-impact event near session: ${event.title}`);
    }
  }

  if ((fetchErrors || []).length >= 3) {
    riskScore += 20;
    reasons.push('most macro data sources failed; defaulting to selective posture');
  } else if ((fetchErrors || []).length >= 2) {
    riskScore += 8;
    reasons.push('multiple macro data sources failed; posture confidence reduced');
  }

  riskScore = clamp(riskScore, 0, 100);
  let posture = 'aggressive_paper_ok';
  let recommendation = 'Paper runs can stay normal; keep standard guards and watch for fresh runner confirmation.';

  if (riskScore >= 80) {
    posture = 'research_only';
    recommendation = 'Do not loosen filters. Favor observation, Venum narrative hunting, and report review over new paper aggression.';
  } else if (riskScore >= 60) {
    posture = 'defensive_paper_only';
    recommendation = 'Keep paper-only. Avoid new loosened guards, require stronger convergence, and expect chop.';
  } else if (riskScore >= 40) {
    posture = 'selective_paper_only';
    recommendation = 'Run paper selectively. Favor clean continuation and high-conviction candidates only.';
  }

  return {
    posture,
    riskScore,
    confidence: compact(fetchErrors.length ? Math.max(0.45, 0.82 - (fetchErrors.length * 0.1)) : 0.82, 2),
    reasons: reasons.length ? reasons : ['market inputs are calm enough for normal paper posture'],
    recommendation,
    solTrend: classifyTrend(solMarket),
    btcTrend: classifyTrend(btcMarket)
  };
}

async function buildReport(args) {
  const generatedAt = new Date();
  const eventsPath = resolveRepoPath(args.events, DEFAULT_EVENTS_PATH);
  const offline = Boolean(args.offline);
  const fetchResults = offline
    ? [
      { ok: false, label: 'SOLUSDT', value: null, error: 'offline mode' },
      { ok: false, label: 'BTCUSDT', value: null, error: 'offline mode' },
      { ok: false, label: 'fearGreed', value: null, error: 'offline mode' },
      { ok: false, label: 'solanaHealth', value: null, error: 'offline mode' }
    ]
    : await Promise.all([
      fetchWithFallback('SOLUSDT', () => fetchMarket('SOLUSDT', 'solana')),
      fetchWithFallback('BTCUSDT', () => fetchMarket('BTCUSDT', 'bitcoin')),
      fetchWithFallback('fearGreed', fetchFearGreed),
      fetchWithFallback('solanaHealth', fetchSolanaHealth)
    ]);

  await sleep(10);

  const byLabel = Object.fromEntries(fetchResults.map((result) => [result.label, result]));
  const fetchErrors = fetchResults
    .filter((result) => !result.ok)
    .map((result) => ({ source: result.label, error: result.error }));
  const events = loadEvents(eventsPath, generatedAt);
  const posture = scorePosture({
    solMarket: byLabel.SOLUSDT?.value,
    btcMarket: byLabel.BTCUSDT?.value,
    fearGreed: byLabel.fearGreed?.value,
    solanaHealth: byLabel.solanaHealth?.value,
    events,
    fetchErrors
  });

  return {
    generatedAt: generatedAt.toISOString(),
    mode: 'report_only',
    posture,
    inputs: {
      sources: {
        solMarket: SOURCES.binanceTicker,
        btcMarket: SOURCES.binanceTicker,
        klines: SOURCES.binanceKlines,
        marketFallback: SOURCES.coinGeckoMarketChart,
        fearGreed: SOURCES.fearGreed,
        solanaHealth: SOURCES.solanaPublicRpc,
        eventsPath
      },
      fetchErrors
    },
    market: {
      sol: byLabel.SOLUSDT?.value,
      btc: byLabel.BTCUSDT?.value,
      fearGreed: byLabel.fearGreed?.value,
      solanaHealth: byLabel.solanaHealth?.value
    },
    events,
    laneGuidance: {
      runnerScalper: posture.riskScore >= 60 ? 'keep_frozen_or_highest_conviction_only' : 'standard_paper_filters',
      continuation: posture.riskScore >= 80 ? 'observe_only' : posture.riskScore >= 60 ? 'confirmed_no_churn_only' : 'selective_paper_ok',
      preMigration: posture.riskScore >= 60 ? 'exceptional_only' : 'standard_watch_then_paper_rules',
      venum: posture.riskScore >= 60 ? 'watch_narratives_more_post_less' : 'normal_budgeted_research'
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const latestPath = resolveRepoPath(args.output, DEFAULT_LATEST_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const report = await buildReport(args);
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const archivePath = path.join(reportDir, `macro-posture-${stamp}.json`);

  writeJson(latestPath, report);
  writeJson(archivePath, report);

  console.log(`Macro posture: ${report.posture.posture} (${report.posture.riskScore}/100 risk)`);
  console.log(report.posture.recommendation);
  if (report.inputs.fetchErrors.length) {
    console.log(`Data warnings: ${report.inputs.fetchErrors.map((item) => `${item.source}: ${item.error}`).join('; ')}`);
  }
  console.log(`Wrote JSON report: ${latestPath}`);
}

main().catch((error) => {
  console.error(`Failed to build macro posture report: ${error.message}`);
  process.exit(1);
});
