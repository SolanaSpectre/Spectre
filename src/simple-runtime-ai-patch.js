const Module = require('module');
const axios = require('axios');
const crypto = require('crypto');

const ORIGINAL_LOAD = Module._load;
const ENABLED = process.env.SIMPLE_RUNTIME_AI_ENABLED !== 'false';
const RUNTIME_MODEL = process.env.SIMPLE_RUNTIME_AI_MODEL || process.env.RUNTIME_AI_MODEL || process.env.OLLAMA_MODEL || 'llama3.2:3b';
const RUNTIME_TIMEOUT_MS = Number(process.env.SIMPLE_RUNTIME_AI_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 4000);
const RUNTIME_NUM_PREDICT = Number(process.env.SIMPLE_RUNTIME_AI_NUM_PREDICT || 80);
const RUNTIME_CONFIDENCE_ENTER_MIN = Number(process.env.SIMPLE_RUNTIME_AI_ENTER_CONFIDENCE_MIN || 60);
const PROMPT_VERSION = 'simple_runtime_guard_v2';
const SCHEMA_VERSION = 'simple_runtime_review_v2';
const QWEN_V2_TRIAL_PAUSE_REASON = 'IDENTICAL_RESPONSE_ACROSS_DISTINCT_PACKETS';

function trialEvidenceDisposition(model = RUNTIME_MODEL, promptVersion = PROMPT_VERSION) {
  const paused = model === 'qwen2.5:7b-instruct' && promptVersion === 'simple_runtime_guard_v2';
  return {
    trialEvidenceEligible: !paused,
    trialEvidenceDisposition: paused
      ? 'PAUSED_IDENTICAL_RESPONSE_DEGENERACY'
      : 'ELIGIBLE_FOR_CURRENT_MODEL_PROMPT_TRIAL',
    trialEvidencePauseReason: paused ? QWEN_V2_TRIAL_PAUSE_REASON : null
  };
}

function mergeNodeOptions() {
  const preloadArg = '--require ./src/simple-runtime-ai-patch.js';
  const current = process.env.NODE_OPTIONS || '';
  if (!current.includes('simple-runtime-ai-patch.js')) {
    process.env.NODE_OPTIONS = `${current} ${preloadArg}`.trim();
  }
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function normalizeAction(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['ENTER', 'WATCH', 'REJECT'].includes(normalized)) return normalized;
  if (['BUY', 'APPROVE', 'APPROVED', 'YES', 'TRADE'].includes(normalized)) return 'ENTER';
  if (['HOLD', 'WAIT', 'MONITOR', 'CAUTION'].includes(normalized)) return 'WATCH';
  if (['PASS', 'SKIP', 'NO', 'NO_TRADE', 'VETO', 'DENY', 'DENIED'].includes(normalized)) return 'REJECT';
  return 'WATCH';
}

function normalizeRisk(value, action, confidence) {
  const normalized = String(value || '').trim().toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH'].includes(normalized)) return normalized;
  if (action === 'REJECT' || confidence < 40) return 'HIGH';
  if (action === 'ENTER' && confidence >= 75) return 'LOW';
  return 'MEDIUM';
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty response');

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object found');
    return JSON.parse(raw.slice(start, end + 1));
  }
}

function classifyRuntimeError(error) {
  const message = String(error?.message || '').trim();
  const code = String(error?.code || '').trim();
  const status = Number(error?.response?.status || 0);
  const lower = `${message} ${code}`.toLowerCase();

  if (code === 'ECONNABORTED' || lower.includes('timeout')) {
    return {
      failureType: 'timeout',
      reason: 'SIMPLE_RUNTIME_AI_TIMEOUT'
    };
  }

  if (
    ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(code) ||
    lower.includes('connect') ||
    lower.includes('socket hang up')
  ) {
    return {
      failureType: 'unavailable',
      reason: 'SIMPLE_RUNTIME_AI_UNAVAILABLE'
    };
  }

  if (
    lower.includes('json') ||
    lower.includes('empty response') ||
    lower.includes('no json object found') ||
    error instanceof SyntaxError
  ) {
    return {
      failureType: 'malformed_json',
      reason: 'SIMPLE_RUNTIME_AI_MALFORMED_JSON'
    };
  }

  if (Number.isFinite(status) && status > 0) {
    return {
      failureType: 'http_error',
      reason: `SIMPLE_RUNTIME_AI_HTTP_${status}`
    };
  }

  return {
    failureType: 'unknown',
    reason: 'SIMPLE_RUNTIME_AI_FAILED'
  };
}

function mintOf(tokenInfo = {}, signal = {}) {
  return tokenInfo.mintAddress || tokenInfo.mint || signal.token || signal.mint || null;
}

function emitSimpleRuntimeTelemetry(instance, type, payload) {
  try {
    if (typeof instance.telemetryHook === 'function') {
      instance.telemetryHook(type, payload);
    }
  } catch {
    // Observability must never alter AI review behavior.
  }
}

function attemptId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `simple_runtime_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function buildFailureDecision(instance, failure, errorMessage = null) {
  return {
    approved: false,
    confidence: 0,
    reason: failure.reason,
    primaryStrategy: 'NONE',
    convergenceScore: 0,
    action: 'WATCH',
    timeout: failure.failureType === 'timeout',
    strategyScores: instance.buildEmptyStrategyScores(),
    contradictions: [`simple runtime AI ${failure.failureType}`],
    executionProfile: instance.buildDefaultExecutionProfile(),
    simpleRuntime: {
      model: RUNTIME_MODEL,
      risk: 'HIGH',
      error: errorMessage,
      failureType: failure.failureType
    }
  };
}

function timeoutError(timeoutMs) {
  const error = new Error(`timeout of ${timeoutMs}ms exceeded`);
  error.code = 'ECONNABORTED';
  error.isHardTimeout = true;
  return error;
}

function postWithHardTimeout(url, body, config = {}, timeoutMs = RUNTIME_TIMEOUT_MS) {
  const controller = new AbortController();
  let timeout = null;

  const request = axios.post(url, body, {
    ...config,
    timeout: timeoutMs,
    signal: controller.signal
  });
  request.catch(() => {
    // The race below may reject first; keep late axios rejections handled.
  });

  const hardTimeout = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // Ignore abort failures; the hard timeout still controls the caller.
      }
      reject(timeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([request, hardTimeout]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function simpleSystemPrompt() {
  return `You are a fast JSON-only Solana memecoin runtime guard.
Return exactly one compact JSON object. Do not use markdown. Do not include text before or after JSON.
Use only the candidate JSON. Do not invent external facts.

Required schema:
{"action":"ENTER","confidence":80,"risk":"LOW","reason":"clean runner flow"}

action must be one of: ENTER, WATCH, REJECT
confidence must be a number from 0 to 100
risk must be one of: LOW, MEDIUM, HIGH
reason must be a short string under 12 words`;
}

function buildSimplePacket(instance, tokenInfo = {}, signal = {}) {
  const recentBuys = Number(tokenInfo.recentBuys || tokenInfo.buys || 0);
  const recentSells = Number(tokenInfo.recentSells || tokenInfo.sells || 0);
  const totalRecent = recentBuys + recentSells;
  const buyRatio = totalRecent > 0 ? recentBuys / totalRecent : null;
  const walletFlow = tokenInfo.walletFlowSummary || null;
  const rickContext = tokenInfo.rickContextSummary || null;
  const launchIntel = tokenInfo.launchIntelSummary || null;
  const preMigrationState = tokenInfo.preMigrationState || launchIntel?.preMigrationState || null;

  return {
    token: {
      mint: tokenInfo.mintAddress || tokenInfo.mint || signal.token || null,
      symbol: tokenInfo.symbol || null,
      source: tokenInfo.source || signal.source || 'unknown',
      bondingStage: tokenInfo.bondingStage || null,
      routeType: tokenInfo.routeType || null
    },
    market: {
      liquidityUsd: Number(tokenInfo.liquidityUsd || 0),
      minLiquidityUsd: Number(instance.config.minLiquidityUsd || 0),
      quoteable: tokenInfo.quoteable !== false,
      tokenAgeSeconds: Number(tokenInfo.tokenAgeSeconds || 0),
      recentTradeCount: Number(tokenInfo.recentTradeCount || 0),
      recentBuys,
      recentSells,
      recentVolumeSol: Number(tokenInfo.recentVolumeSol || 0),
      tradeVelocityPerMin: Number(tokenInfo.tradeVelocityPerMin || 0),
      buyRatio: Number.isFinite(buyRatio) ? Number(buyRatio.toFixed(4)) : null,
      riskScore: Number(tokenInfo.riskScore || 0)
    },
    preMigration: preMigrationState
      ? {
          score: Number(preMigrationState.score || 0),
          flagged: Boolean(preMigrationState.flagged),
          reasons: Array.isArray(preMigrationState.reasons) ? preMigrationState.reasons.slice(0, 6) : [],
          curveProgress: preMigrationState.curveProgress ?? null,
          recentVolumeSol: Number(preMigrationState.recentVolumeSol || 0),
          tradeVelocityPerMin: Number(preMigrationState.tradeVelocityPerMin || 0)
        }
      : null,
    deterministicSignal: {
      action: signal.action || null,
      amountSol: Number(signal.amount || 0),
      qualityScore: Number(signal.qualityScore || 0),
      momentumScore: Number(signal.momentumScore || 0),
      reasoning: String(signal.reasoning || '').slice(0, 240)
    },
    walletSupportTier: walletFlow?.supportTier || null,
    walletCautions: Array.isArray(walletFlow?.cautionSignals) ? walletFlow.cautionSignals.slice(0, 3) : [],
    walletSupport: Array.isArray(walletFlow?.learningSignals) ? walletFlow.learningSignals.slice(0, 3) : [],
    rickSupportTier: rickContext?.supportTier || null
  };
}

function walletFlowScore(packet = {}, convergenceScore = 0) {
  const tier = String(packet?.walletSupportTier || '').trim().toUpperCase();
  const supportCount = Array.isArray(packet?.walletSupport) ? packet.walletSupport.length : 0;
  const cautionCount = Array.isArray(packet?.walletCautions) ? packet.walletCautions.length : 0;
  if (tier === 'TRUSTED_FLOW' && supportCount > 0) {
    return Number(Math.min(convergenceScore, 0.85).toFixed(4));
  }
  if (tier === 'MIXED_FLOW' && supportCount > cautionCount) {
    return Number(Math.min(convergenceScore, 0.5).toFixed(4));
  }
  return 0;
}

function normalizeSimpleReview(parsed = {}, packet = {}) {
  const requestedAction = normalizeAction(parsed.action);
  const confidence = clampNumber(parsed.confidence, 0, 100, 0);
  const risk = normalizeRisk(parsed.risk, requestedAction, confidence);
  const approved = requestedAction === 'ENTER' && confidence >= RUNTIME_CONFIDENCE_ENTER_MIN && risk !== 'HIGH';
  const action = requestedAction === 'ENTER' && !approved ? 'WATCH' : requestedAction;
  const reason = String(parsed.reason || `AI_${action}`).trim().slice(0, 96) || `AI_${action}`;
  const riskPenalty = risk === 'LOW' ? 0 : risk === 'MEDIUM' ? 0.15 : 0.35;
  const convergenceScore = Number(Math.max(0, Math.min(1, (confidence / 100) - riskPenalty)).toFixed(4));

  return {
    approved,
    confidence,
    reason: `SIMPLE_RUNTIME_AI:${reason}`,
    primaryStrategy: 'RUNNER_HUNTER',
    convergenceScore,
    action,
    strategyScores: {
      RUNNER_HUNTER: convergenceScore,
      SNIPER: 0,
      SCALPER: action === 'WATCH' ? convergenceScore : 0,
      MIGRATION_HUNTER: 0,
      WALLET_FLOW: walletFlowScore(packet, convergenceScore)
    },
    contradictions: risk === 'HIGH' ? ['simple runtime guard risk HIGH'] : [],
    executionProfile: {
      entryUrgency: action === 'ENTER' ? 'high' : 'medium',
      expectedHold: action === 'ENTER' ? 'short_to_medium' : 'short',
      exitStyle: action === 'ENTER' ? 'trailing_runner' : 'fixed'
    },
    simpleRuntime: {
      model: RUNTIME_MODEL,
      risk,
      requestedAction,
      walletSupportTier: packet?.walletSupportTier || null,
      walletEvidencePresent: Boolean(
        (Array.isArray(packet?.walletSupport) && packet.walletSupport.length) ||
        (Array.isArray(packet?.walletCautions) && packet.walletCautions.length)
      )
    }
  };
}

async function callSimpleRuntimeReview(instance, tokenInfo, signal, packet = null) {
  const reviewPacket = packet || buildSimplePacket(instance, tokenInfo, signal);
  const response = await postWithHardTimeout(instance.apiEndpoint, {
    model: RUNTIME_MODEL,
    stream: false,
    format: 'json',
    think: false,
    keep_alive: instance.config?.ollamaKeepAlive || '30m',
    messages: [
      { role: 'system', content: simpleSystemPrompt() },
      { role: 'user', content: `Review this Spectre runtime candidate. Return JSON only.\n\nCandidate JSON:\n${JSON.stringify(reviewPacket)}` }
    ],
    options: {
      temperature: 0,
      num_predict: RUNTIME_NUM_PREDICT
    }
  }, {
    timeout: RUNTIME_TIMEOUT_MS
  }, RUNTIME_TIMEOUT_MS);

  const text = response.data?.message?.content || response.data?.response || '';
  const rawResponseHash = sha256Text(text);
  try {
    return {
      review: normalizeSimpleReview(extractJsonObject(text), reviewPacket),
      rawResponseHash
    };
  } catch (error) {
    error.rawResponseHash = rawResponseHash;
    throw error;
  }
}

function patchAIAgent(AIAgent) {
  if (!ENABLED || !AIAgent || AIAgent.__simpleRuntimePatched) return AIAgent;

  class SimpleRuntimeAIAgent extends AIAgent {
    constructor(config, logger) {
      super(config, logger);
      this.model = RUNTIME_MODEL;
      this.simpleRuntimeInFlight = null;
      this.simpleRuntimeGuardState = {
        activeRequests: 0,
        singleFlightAcquisitions: 0,
        dedupJoins: 0,
        busyRejects: 0,
        maxObservedConcurrentRequests: 0
      };
    }

    simpleRuntimeGuardSnapshot() {
      return { ...this.simpleRuntimeGuardState };
    }

    async warmup() {
      if (!ENABLED) return super.warmup();
      const startedAt = Date.now();
      const warmupTimeoutMs = Number(
        process.env.SIMPLE_RUNTIME_AI_WARMUP_TIMEOUT_MS ||
        this.config?.aiWarmupTimeoutMs ||
        90000
      );
      try {
        await postWithHardTimeout(this.apiEndpoint, {
          model: RUNTIME_MODEL,
          stream: false,
          format: 'json',
          think: false,
          keep_alive: this.config?.ollamaKeepAlive || '30m',
          messages: [
            { role: 'system', content: simpleSystemPrompt() },
            { role: 'user', content: 'Return {"action":"WATCH","confidence":10,"risk":"MEDIUM","reason":"warm"}' }
          ],
          options: { temperature: 0, num_predict: 48 }
        }, {
          timeout: warmupTimeoutMs
        }, warmupTimeoutMs);
        this.logger.info(`Simple runtime AI warmed: ${RUNTIME_MODEL} (${Date.now() - startedAt}ms)`);
        return true;
      } catch (error) {
        this.logger.warn('Simple runtime AI warmup failed', error.message);
        return false;
      }
    }

    async reviewTrade(tokenInfo, signal) {
      if (process.env.SIMPLE_RUNTIME_AI_ENABLED === 'false') {
        return super.reviewTrade(tokenInfo, signal);
      }

      return this.callTradeReviewer(tokenInfo, signal);
    }

    async callTradeReviewer(tokenInfo, signal, options = {}) {
      if (process.env.SIMPLE_RUNTIME_AI_ENABLED === 'false') {
        return super.callTradeReviewer(tokenInfo, signal, options);
      }

      const id = attemptId();
      const startedAt = Date.now();
      const attemptType = options.lightweight ? 'lightweight_retry' : 'primary';
      const packet = buildSimplePacket(this, tokenInfo, signal);
      const packetJson = JSON.stringify(packet);
      const packetHash = sha256Text(packetJson);
      const mint = mintOf(tokenInfo, signal);
      this.simpleRuntimeGuardState.activeRequests += 1;
      this.simpleRuntimeGuardState.maxObservedConcurrentRequests = Math.max(
        this.simpleRuntimeGuardState.maxObservedConcurrentRequests,
        this.simpleRuntimeGuardState.activeRequests
      );
      const baseTelemetry = {
        attemptId: id,
        signalId: signal?.id || signal?.signalId || null,
        mint,
        symbol: tokenInfo?.symbol || null,
        source: tokenInfo?.source || signal?.source || 'unknown',
        attemptType,
        model: RUNTIME_MODEL,
        promptVersion: PROMPT_VERSION,
        promptHash: sha256Text(simpleSystemPrompt()),
        schemaVersion: SCHEMA_VERSION,
        ...trialEvidenceDisposition(RUNTIME_MODEL, PROMPT_VERSION),
        packetHash,
        packet,
        timeoutMs: RUNTIME_TIMEOUT_MS,
        outerTimeoutMs: Number(this.config?.aiTimeoutMs || 0) || null
      };
      const terminalTelemetry = { ...baseTelemetry };
      delete terminalTelemetry.packet;

      try {
        const existing = this.simpleRuntimeInFlight;
        if (existing) {
          const sameMint = Boolean(mint && existing.mint && mint === existing.mint);
          if (!sameMint) {
            this.simpleRuntimeGuardState.busyRejects += 1;
            const failure = { failureType: 'busy', reason: 'SIMPLE_RUNTIME_AI_BUSY' };
            const guard = {
              guardOutcome: 'busy_rejected',
              inFlightAttemptId: existing.attemptId,
              reviewedPacketHash: null,
              waitedMs: 0,
              modelReviewed: false,
              guardCounters: this.simpleRuntimeGuardSnapshot()
            };
            emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_started', { ...baseTelemetry, ...guard });
            emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_failed', {
              ...terminalTelemetry,
              ...guard,
              latencyMs: Date.now() - startedAt,
              failureType: failure.failureType,
              reason: failure.reason,
              rawResponseHash: null,
              errorMessage: 'Simple Runtime AI single-flight guard is busy with another mint.',
              errorCode: 'SIMPLE_RUNTIME_AI_BUSY',
              httpStatus: null
            });
            return buildFailureDecision(this, failure, 'single-flight guard busy');
          }

          this.simpleRuntimeGuardState.dedupJoins += 1;
          const guardStarted = {
            guardOutcome: 'deduped_joined',
            inFlightAttemptId: existing.attemptId,
            reviewedPacketHash: existing.packetHash,
            waitedMs: 0,
            modelReviewed: false,
            guardCounters: this.simpleRuntimeGuardSnapshot()
          };
          emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_started', { ...baseTelemetry, ...guardStarted });
          try {
            const { review: result, rawResponseHash } = await existing.promise;
            const waitedMs = Date.now() - startedAt;
            emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_completed', {
              ...terminalTelemetry,
              ...guardStarted,
              waitedMs,
              latencyMs: waitedMs,
              action: result.action || null,
              approved: result.approved === true,
              confidence: result.confidence ?? null,
              risk: result.simpleRuntime?.risk || null,
              reason: result.reason || null,
              convergenceScore: result.convergenceScore ?? null,
              rawResponseHash,
              normalizedReview: result,
              guardCounters: this.simpleRuntimeGuardSnapshot()
            });
            return result;
          } catch (error) {
            const failure = classifyRuntimeError(error);
            const waitedMs = Date.now() - startedAt;
            emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_failed', {
              ...terminalTelemetry,
              ...guardStarted,
              waitedMs,
              latencyMs: waitedMs,
              failureType: failure.failureType,
              reason: failure.reason,
              rawResponseHash: error.rawResponseHash || null,
              errorMessage: error.message,
              errorCode: error.code || null,
              httpStatus: Number(error?.response?.status || 0) || null,
              guardCounters: this.simpleRuntimeGuardSnapshot()
            });
            return buildFailureDecision(this, failure, error.message);
          }
        }

        this.simpleRuntimeGuardState.singleFlightAcquisitions += 1;
        const guard = {
          guardOutcome: 'acquired',
          inFlightAttemptId: null,
          reviewedPacketHash: packetHash,
          waitedMs: 0,
          modelReviewed: true,
          guardCounters: this.simpleRuntimeGuardSnapshot()
        };
        emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_started', { ...baseTelemetry, ...guard });
        const reviewPromise = callSimpleRuntimeReview(this, tokenInfo, signal, packet);
        this.simpleRuntimeInFlight = { attemptId: id, mint, packetHash, promise: reviewPromise };

        try {
          const { review: result, rawResponseHash } = await reviewPromise;
          const latencyMs = Date.now() - startedAt;
          emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_completed', {
            ...terminalTelemetry,
            ...guard,
            latencyMs,
            action: result.action || null,
            approved: result.approved === true,
            confidence: result.confidence ?? null,
            risk: result.simpleRuntime?.risk || null,
            reason: result.reason || null,
            convergenceScore: result.convergenceScore ?? null,
            rawResponseHash,
            normalizedReview: result,
            guardCounters: this.simpleRuntimeGuardSnapshot()
          });
          this.logger.info(`Simple runtime AI review ${result.action} ${result.confidence}% ${result.simpleRuntime.risk} (${latencyMs}ms)`);
          return result;
        } catch (error) {
          const failure = classifyRuntimeError(error);
          emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_failed', {
            ...terminalTelemetry,
            ...guard,
            latencyMs: Date.now() - startedAt,
            failureType: failure.failureType,
            reason: failure.reason,
            rawResponseHash: error.rawResponseHash || null,
            errorMessage: error.message,
            errorCode: error.code || null,
            httpStatus: Number(error?.response?.status || 0) || null,
            guardCounters: this.simpleRuntimeGuardSnapshot()
          });
          this.logger.warn('Simple runtime AI review failed', {
            failureType: failure.failureType,
            reason: failure.reason,
            message: error.message
          });
          return buildFailureDecision(this, failure, error.message);
        } finally {
          if (this.simpleRuntimeInFlight?.attemptId === id) {
            this.simpleRuntimeInFlight = null;
          }
        }
      } finally {
        this.simpleRuntimeGuardState.activeRequests = Math.max(
          0,
          this.simpleRuntimeGuardState.activeRequests - 1
        );
      }
    }
  }

  SimpleRuntimeAIAgent.__simpleRuntimePatched = true;
  return SimpleRuntimeAIAgent;
}

if (ENABLED) {
  mergeNodeOptions();
  Module._load = function patchedLoad(request, parent, isMain) {
    const loaded = ORIGINAL_LOAD.apply(this, arguments);
    try {
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (String(resolved).replace(/\\/g, '/').endsWith('/src/ai-agent.js')) {
        return patchAIAgent(loaded);
      }
    } catch {
      // Ignore resolution errors for built-ins and non-file requests.
    }
    return loaded;
  };
}

module.exports = {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  buildSimplePacket,
  normalizeSimpleReview,
  walletFlowScore,
  sha256Text,
  trialEvidenceDisposition
};
