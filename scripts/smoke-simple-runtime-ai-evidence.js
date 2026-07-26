process.env.SIMPLE_RUNTIME_AI_ENABLED = 'true';
process.env.SIMPLE_RUNTIME_AI_MODEL = 'fixture-model';
process.env.SIMPLE_RUNTIME_AI_TIMEOUT_MS = '3000';

const axios = require('axios');
const originalPost = axios.post;
let responseContent = '{"action":"ENTER","confidence":85,"risk":"LOW","reason":"clean fixture"}';
let postHandler = async () => ({
  data: { message: { content: responseContent } }
});
axios.post = (...args) => postHandler(...args);

function deferredResponse(content) {
  let resolve;
  const promise = new Promise((done) => {
    resolve = () => done({
      data: {
        message: { content }
      }
    });
  });
  return { promise, resolve };
}

function findLifecycle(events, type, signalId) {
  return events.find((row) => (
    row.type === type && row.payload.signalId === signalId
  ));
}
const runtimePatch = require('../src/simple-runtime-ai-patch');
const evidenceReport = require('./simple-runtime-ai-evidence-report');
const AIAgent = require('../src/ai-agent');
const TradingEngine = require('../src/trading-engine');

const pausedQwenTrial = runtimePatch.trialEvidenceDisposition(
  'qwen2.5:7b-instruct',
  'simple_runtime_guard_v2'
);
if (
  pausedQwenTrial.trialEvidenceEligible !== false ||
  pausedQwenTrial.trialEvidenceDisposition !== 'PAUSED_IDENTICAL_RESPONSE_DEGENERACY'
) {
  throw new Error('Qwen V2 trial pause disposition is not frozen.');
}

const incompleteEnter = runtimePatch.normalizeSimpleReview({ action: 'ENTER' });
if (incompleteEnter.action !== 'WATCH' || incompleteEnter.approved !== false) {
  throw new Error('Incomplete ENTER response did not degrade to WATCH.');
}
if (incompleteEnter.strategyScores.WALLET_FLOW !== 0) {
  throw new Error('Review without wallet evidence received a synthetic WALLET_FLOW score.');
}

const trustedWalletReview = runtimePatch.normalizeSimpleReview(
  { action: 'ENTER', confidence: 85, risk: 'LOW', reason: 'trusted fixture' },
  { walletSupportTier: 'TRUSTED_FLOW', walletSupport: ['trusted touch'], walletCautions: [] }
);
if (trustedWalletReview.strategyScores.WALLET_FLOW !== 0.85) {
  throw new Error('Trusted wallet evidence was not reflected in WALLET_FLOW score.');
}
const avoidWalletReview = runtimePatch.normalizeSimpleReview(
  { action: 'ENTER', confidence: 85, risk: 'LOW', reason: 'avoid fixture' },
  { walletSupportTier: 'AVOID_FLOW', walletSupport: [], walletCautions: ['avoid touch'] }
);
if (avoidWalletReview.strategyScores.WALLET_FLOW !== 0) {
  throw new Error('Avoid wallet evidence produced positive WALLET_FLOW score.');
}

const joinedFixture = evidenceReport.joinLifecycleAttempts([
  {
    type: 'simple_runtime_ai.review_started',
    timestamp: '2026-07-22T12:00:00.000Z',
    attemptId: 'joined-fixture',
    signalId: 'joined-signal',
    mint: 'JoinedMint',
    packetHash: 'packet-a',
    rawResponseHash: null,
    normalizedReview: null,
    outerTimeoutMs: 3000
  },
  {
    type: 'simple_runtime_ai.review_completed',
    timestamp: '2026-07-22T12:00:00.900Z',
    attemptId: 'joined-fixture',
    latencyMs: 900,
    action: 'ENTER',
    confidence: 85,
    risk: 'LOW',
    rawResponseHash: 'response-a',
    normalizedReview: { action: 'ENTER' }
  }
]);
if (
  joinedFixture[0]?.rawResponseHash !== 'response-a' ||
  joinedFixture[0]?.normalizedReview?.action !== 'ENTER'
) {
  throw new Error('Lifecycle attempt join dropped terminal response evidence.');
}
const repeatedResponseFixture = evidenceReport.summarizeResponseDiversity([
  { ...joinedFixture[0], mint: 'MintA', packetHash: 'packet-a' },
  { ...joinedFixture[0], attemptId: 'joined-fixture-b', mint: 'MintB', packetHash: 'packet-b' }
]);
if (!repeatedResponseFixture.identicalResponseAcrossDistinctPackets) {
  throw new Error('Response-diversity diagnostic missed an identical response across distinct packets.');
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
  if (result.strategyScores?.WALLET_FLOW !== 0 || result.simpleRuntime?.walletEvidencePresent !== false) {
    throw new Error('Runtime review invented wallet support for a packet without wallet evidence.');
  }
  if (!started?.payload?.packet || !started.payload.packetHash) throw new Error('Started telemetry omitted packet evidence.');
  if (!started.payload.promptVersion || !started.payload.promptHash || !started.payload.schemaVersion) {
    throw new Error('Started telemetry omitted prompt/schema provenance.');
  }
  if (started.payload.trialEvidenceEligible !== true) {
    throw new Error('Non-Qwen fixture was incorrectly excluded from trial evidence.');
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

  responseContent = '{"action":"ENTER","confidence":85,"risk":"LOW","reason":"concurrency fixture"}';
  const deferred = deferredResponse(responseContent);
  postHandler = () => deferred.promise;
  const primarySignal = { ...signal, id: 'fixture-guard-primary' };
  const dedupSignal = { ...signal, id: 'fixture-guard-dedup' };
  const busyToken = {
    ...tokenInfo,
    mintAddress: 'BusyMint1111111111111111111111111111111111',
    symbol: 'BUSY'
  };
  const busySignal = { ...signal, id: 'fixture-guard-busy', token: busyToken.mintAddress };
  const primaryPromise = agent.reviewTrade(tokenInfo, primarySignal);
  const dedupPromise = agent.reviewTrade(tokenInfo, dedupSignal);
  const busyResult = await agent.reviewTrade(busyToken, busySignal);

  if (busyResult.simpleRuntime?.failureType !== 'busy' || busyResult.reason !== 'SIMPLE_RUNTIME_AI_BUSY') {
    throw new Error('Distinct-mint concurrent review did not fail as BUSY.');
  }
  deferred.resolve();
  const [primaryResult, dedupResult] = await Promise.all([primaryPromise, dedupPromise]);
  if (primaryResult.reason !== dedupResult.reason || primaryResult.action !== dedupResult.action) {
    throw new Error('Same-mint concurrent review did not share the primary result.');
  }

  const primaryStarted = findLifecycle(events, 'simple_runtime_ai.review_started', primarySignal.id);
  const dedupStarted = findLifecycle(events, 'simple_runtime_ai.review_started', dedupSignal.id);
  const dedupCompleted = findLifecycle(events, 'simple_runtime_ai.review_completed', dedupSignal.id);
  const busyFailure = findLifecycle(events, 'simple_runtime_ai.review_failed', busySignal.id);
  if (primaryStarted?.payload?.guardOutcome !== 'acquired') {
    throw new Error('Primary review did not record guard acquisition.');
  }
  if (
    dedupStarted?.payload?.guardOutcome !== 'deduped_joined' ||
    dedupStarted.payload.inFlightAttemptId !== primaryStarted.payload.attemptId ||
    dedupCompleted?.payload?.modelReviewed !== false ||
    dedupCompleted?.payload?.reviewedPacketHash !== primaryStarted.payload.packetHash
  ) {
    throw new Error('Same-mint dedup telemetry lost primary-attempt provenance.');
  }
  if (
    busyFailure?.payload?.guardOutcome !== 'busy_rejected' ||
    busyFailure.payload.failureType !== 'busy' ||
    busyFailure.payload.inFlightAttemptId !== primaryStarted.payload.attemptId
  ) {
    throw new Error('BUSY telemetry did not preserve single-flight provenance.');
  }
  if (Number(primaryStarted.payload.guardCounters?.maxObservedConcurrentRequests || 0) !== 1) {
    throw new Error('Primary guard telemetry did not start at one active request.');
  }
  if (Number(busyFailure.payload.guardCounters?.maxObservedConcurrentRequests || 0) < 3) {
    throw new Error('Guard telemetry did not record peak concurrent demand.');
  }

  postHandler = async () => ({ data: { message: { content: responseContent } } });
  const releasedResult = await agent.reviewTrade(busyToken, { ...busySignal, id: 'fixture-guard-released' });
  const releasedStarted = findLifecycle(events, 'simple_runtime_ai.review_started', 'fixture-guard-released');
  if (releasedResult.action !== 'ENTER' || releasedStarted?.payload?.guardOutcome !== 'acquired') {
    throw new Error('Single-flight guard did not release after the primary review completed.');
  }

  const timeoutError = new Error('fixture timeout');
  timeoutError.code = 'ECONNABORTED';
  postHandler = async () => {
    throw timeoutError;
  };
  const timeoutResult = await agent.reviewTrade(tokenInfo, { ...signal, id: 'fixture-guard-timeout' });
  if (timeoutResult.simpleRuntime?.failureType !== 'timeout') {
    throw new Error('Timeout fixture did not preserve timeout failure classification.');
  }
  postHandler = async () => ({ data: { message: { content: responseContent } } });
  const postTimeoutResult = await agent.reviewTrade(busyToken, { ...busySignal, id: 'fixture-guard-post-timeout' });
  const postTimeoutStarted = findLifecycle(events, 'simple_runtime_ai.review_started', 'fixture-guard-post-timeout');
  if (postTimeoutResult.action !== 'ENTER' || postTimeoutStarted?.payload?.guardOutcome !== 'acquired') {
    throw new Error('Single-flight guard did not release after a timeout failure.');
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

  const busyFallbackDecision = TradingEngine.prototype.applyAiDecisionGuards.call(
    fallbackContext,
    {
      action: 'WATCH',
      reason: 'SIMPLE_RUNTIME_AI_BUSY',
      confidence: 0,
      strategyScores: {},
      simpleRuntime: { failureType: 'busy', risk: 'HIGH' }
    },
    { ...signal, tokenInfo }
  );
  if (busyFallbackDecision.action !== 'ENTER' || busyFallbackDecision.fallbackTrigger !== 'busy') {
    throw new Error('BUSY did not inherit the guarded deterministic PAPER fallback.');
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
