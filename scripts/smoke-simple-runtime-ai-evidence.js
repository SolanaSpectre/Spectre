process.env.SIMPLE_RUNTIME_AI_ENABLED = 'true';
process.env.SIMPLE_RUNTIME_AI_MODEL = 'fixture-model';
process.env.SIMPLE_RUNTIME_AI_TIMEOUT_MS = '3000';

const axios = require('axios');
const originalPost = axios.post;
let responseContent = '{"action":"ENTER","confidence":85,"risk":"LOW","reason":"clean fixture"}';
axios.post = async () => ({
  data: {
    message: {
      content: responseContent
    }
  }
});

const runtimePatch = require('../src/simple-runtime-ai-patch');
const AIAgent = require('../src/ai-agent');
const TradingEngine = require('../src/trading-engine');

const incompleteEnter = runtimePatch.normalizeSimpleReview({ action: 'ENTER' });
if (incompleteEnter.action !== 'WATCH' || incompleteEnter.approved !== false) {
  throw new Error('Incomplete ENTER response did not degrade to WATCH.');
}

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {}
};
const config = {
  ollamaHost: 'http://127.0.0.1:11434',
  ollamaModel: 'unused-model',
  ollamaKeepAlive: '2h',
  aiTimeoutMs: 3000,
  aiWarmupTimeoutMs: 90000,
  minLiquidityUsd: 5000
};
const tokenInfo = {
  mintAddress: 'FixtureMint11111111111111111111111111111111',
  symbol: 'FIX',
  source: 'pumpportal_create',
  liquidityUsd: 25000,
  recentBuys: 18,
  recentSells: 4,
  recentVolumeSol: 30,
  tradeVelocityPerMin: 12,
  preMigrationState: { score: 80, flagged: true, curveProgress: 0.7 }
};
const signal = {
  id: 'fixture-signal',
  token: tokenInfo.mintAddress,
  action: 'BUY',
  amount: 0.05,
  qualityScore: 0.8,
  momentumScore: 0.9,
  reasoning: 'fixture'
};

async function main() {
  const events = [];
  const agent = new AIAgent(config, logger);
  agent.telemetryHook = (type, payload) => events.push({ type, payload });
  const result = await agent.reviewTrade(tokenInfo, signal);
  const started = events.find((row) => row.type === 'simple_runtime_ai.review_started');
  const completed = events.find((row) => row.type === 'simple_runtime_ai.review_completed');

  if (result.action !== 'ENTER') throw new Error('Fixture review did not ENTER.');
  if (!started?.payload?.packet || !started.payload.packetHash) throw new Error('Started telemetry omitted packet evidence.');
  if (!started.payload.promptVersion || !started.payload.promptHash || !started.payload.schemaVersion) {
    throw new Error('Started telemetry omitted prompt/schema provenance.');
  }
  if (!completed?.payload?.rawResponseHash || !completed.payload.normalizedReview) {
    throw new Error('Completed telemetry omitted response/normalization evidence.');
  }
  if (Object.prototype.hasOwnProperty.call(completed.payload, 'packet')) {
    throw new Error('Completed telemetry duplicated the full review packet.');
  }
  if (started.payload.packetHash !== runtimePatch.sha256Text(JSON.stringify(started.payload.packet))) {
    throw new Error('Packet hash does not match the persisted packet.');
  }

  responseContent = 'not-json';
  const malformedResult = await agent.reviewTrade(tokenInfo, { ...signal, id: 'fixture-malformed' });
  const malformedFailure = events.find((row) => (
    row.type === 'simple_runtime_ai.review_failed' && row.payload.signalId === 'fixture-malformed'
  ));
  if (malformedResult.action !== 'WATCH' || malformedResult.simpleRuntime?.failureType !== 'malformed_json') {
    throw new Error('Malformed response did not fail closed as WATCH.');
  }
  if (malformedFailure?.payload?.rawResponseHash !== runtimePatch.sha256Text('not-json')) {
    throw new Error('Malformed response failure omitted its raw-response hash.');
  }
  if (Object.prototype.hasOwnProperty.call(malformedFailure.payload, 'packet')) {
    throw new Error('Failed telemetry duplicated the full review packet.');
  }

  const fallbackContext = {
    config: {
      minLiquidityUsd: 5000,
      minQualityScore: 0.42,
      minPumpMomentumScore: 0.68,
      aiTimeoutFallbackEnabled: true,
      aiTimeoutFallbackPaperOnly: true,
      aiTimeoutFallbackMinQualityScore: 0.48,
      aiTimeoutFallbackMinMomentumScore: 0.78
    },
    executionModeManager: { isPaper: () => true },
    logger,
    buildEmptyStrategyScores: () => ({
      RUNNER_HUNTER: 0,
      SNIPER: 0,
      SCALPER: 0,
      MIGRATION_HUNTER: 0,
      WALLET_FLOW: 0
    })
  };
  const fallbackDecision = TradingEngine.prototype.applyAiDecisionGuards.call(
    fallbackContext,
    {
      action: 'WATCH',
      reason: 'SIMPLE_RUNTIME_AI_UNAVAILABLE',
      confidence: 0,
      strategyScores: {},
      simpleRuntime: { failureType: 'unavailable', risk: 'HIGH' }
    },
    { ...signal, tokenInfo }
  );
  if (
    fallbackDecision.action !== 'ENTER' ||
    !fallbackDecision.reason.startsWith('AI_FAILURE_FALLBACK_ALLOW:') ||
    fallbackDecision.fallbackTrigger !== 'unavailable'
  ) {
    throw new Error('Non-timeout Simple Runtime failure did not use deterministic PAPER fallback.');
  }

  console.log('SIMPLE_RUNTIME_AI_EVIDENCE_SMOKE_OK');
}

main()
  .finally(() => {
    axios.post = originalPost;
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
