require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

require('../src/simple-runtime-ai-patch');

const AIAgent = require('../src/ai-agent');

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};

const config = {
  ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  aiTimeoutMs: numberEnv('AI_TIMEOUT_MS', 4000),
  aiWarmupTimeoutMs: numberEnv('AI_WARMUP_TIMEOUT_MS', 20000),
  aiTimeoutDefaultsToVeto: boolEnv('AI_TIMEOUT_DEFAULTS_TO_VETO', true),
  aiFastRunnerReviewEnabled: true,
  aiFastReviewTimeoutMs: numberEnv('SIMPLE_RUNTIME_AI_TIMEOUT_MS', numberEnv('AI_FAST_REVIEW_TIMEOUT_MS', 4000)),
  aiFastReviewNumPredict: numberEnv('SIMPLE_RUNTIME_AI_NUM_PREDICT', numberEnv('AI_FAST_REVIEW_NUM_PREDICT', 80)),
  minLiquidityUsd: numberEnv('MIN_LIQUIDITY_USD', 15000)
};

const tokenInfo = {
  mintAddress: 'SmokeRuntime111111111111111111111111111111111',
  symbol: 'SMOKE',
  name: 'Smoke Runtime Test',
  source: 'pumpportal_new_token',
  bondingStage: 'bonding_curve',
  routeType: 'pre_migration',
  price: 0.00000042,
  liquidityUsd: 24000,
  liquidity: 120,
  quoteable: true,
  tokenAgeSeconds: 240,
  recentTradeCount: 96,
  recentBuys: 76,
  recentSells: 20,
  recentVolumeSol: 112,
  tradeVelocityPerMin: 48,
  riskScore: 12,
  preMigrationState: {
    score: 88,
    flagged: true,
    reasons: ['HIGH_TRADE_VELOCITY', 'BUY_PRESSURE', 'CURVE_ADVANCING'],
    curveProgress: 0.82,
    bondingStage: 'bonding_curve',
    recentTradeCount: 96,
    recentBuys: 76,
    recentSells: 20,
    recentVolumeSol: 112,
    tradeVelocityPerMin: 48
  },
  walletFlowSummary: {
    supportTier: 'TRUSTED_FLOW',
    learningSignals: ['trusted active rotator touched early'],
    cautionSignals: []
  }
};

const signal = {
  source: 'pumpportal_new_token',
  action: 'BUY',
  amount: 0.05,
  qualityScore: 0.86,
  momentumScore: 0.88,
  reasoning: 'Synthetic high-momentum PumpPortal runner candidate for simple runtime AI smoke test.'
};

async function main() {
  console.log('Simple Runtime AI Smoke Test');
  console.log(`OLLAMA_HOST=${config.ollamaHost}`);
  console.log(`OLLAMA_MODEL=${config.ollamaModel}`);
  console.log(`SIMPLE_RUNTIME_AI_ENABLED=${process.env.SIMPLE_RUNTIME_AI_ENABLED || 'true/default'}`);
  const expectedModel = process.env.SIMPLE_RUNTIME_AI_MODEL || process.env.RUNTIME_AI_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b';
  console.log(`SIMPLE_RUNTIME_AI_MODEL=${expectedModel}`);
  console.log('');

  const agent = new AIAgent(config, logger);
  await agent.warmup();

  const startedAt = Date.now();
  const result = await agent.reviewTrade(tokenInfo, signal);
  const elapsedMs = Date.now() - startedAt;

  console.log('Smoke review result:');
  console.log(JSON.stringify(result, null, 2));
  console.log(`Elapsed: ${elapsedMs}ms`);

  if (!result?.simpleRuntime) {
    throw new Error('Simple runtime patch did not handle reviewTrade(); result.simpleRuntime missing');
  }

  if (result.simpleRuntime.model !== expectedModel) {
    throw new Error(`Unexpected simple runtime model: ${result.simpleRuntime.model}`);
  }

  if (!String(result.reason || '').startsWith('SIMPLE_RUNTIME_AI:')) {
    throw new Error(`Unexpected reason prefix: ${result.reason}`);
  }

  if (!['ENTER', 'WATCH', 'REJECT'].includes(result.action)) {
    throw new Error(`Invalid action: ${result.action}`);
  }

  console.log('SIMPLE_RUNTIME_AI_SMOKE_OK');
}

main().catch((error) => {
  console.error('[ERROR] Simple runtime AI smoke failed:', error.message);
  process.exit(1);
});
