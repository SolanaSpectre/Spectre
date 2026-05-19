const Module = require('module');
const axios = require('axios');
const crypto = require('crypto');

const ORIGINAL_LOAD = Module._load;
const ENABLED = process.env.SIMPLE_RUNTIME_AI_ENABLED !== 'false';
const RUNTIME_MODEL = process.env.SIMPLE_RUNTIME_AI_MODEL || process.env.RUNTIME_AI_MODEL || 'llama3.2:3b';
const RUNTIME_TIMEOUT_MS = Number(process.env.SIMPLE_RUNTIME_AI_TIMEOUT_MS || process.env.AI_TIMEOUT_MS || 4000);
const RUNTIME_NUM_PREDICT = Number(process.env.SIMPLE_RUNTIME_AI_NUM_PREDICT || 80);
const RUNTIME_CONFIDENCE_ENTER_MIN = Number(process.env.SIMPLE_RUNTIME_AI_ENTER_CONFIDENCE_MIN || 60);

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

function normalizeSimpleReview(parsed = {}) {
  const action = normalizeAction(parsed.action);
  const confidence = clampNumber(parsed.confidence, 0, 100, action === 'ENTER' ? 60 : 35);
  const risk = normalizeRisk(parsed.risk, action, confidence);
  const reason = String(parsed.reason || `AI_${action}`).trim().slice(0, 96) || `AI_${action}`;
  const approved = action === 'ENTER' && confidence >= RUNTIME_CONFIDENCE_ENTER_MIN && risk !== 'HIGH';
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
      WALLET_FLOW: risk === 'LOW' ? Math.min(1, convergenceScore + 0.1) : convergenceScore
    },
    contradictions: risk === 'HIGH' ? ['simple runtime guard risk HIGH'] : [],
    executionProfile: {
      entryUrgency: action === 'ENTER' ? 'high' : 'medium',
      expectedHold: action === 'ENTER' ? 'short_to_medium' : 'short',
      exitStyle: action === 'ENTER' ? 'trailing_runner' : 'fixed'
    },
    simpleRuntime: {
      model: RUNTIME_MODEL,
      risk
    }
  };
}

async function callSimpleRuntimeReview(instance, tokenInfo, signal) {
  const packet = buildSimplePacket(instance, tokenInfo, signal);
  const response = await axios.post(instance.apiEndpoint, {
    model: RUNTIME_MODEL,
    stream: false,
    format: 'json',
    messages: [
      { role: 'system', content: simpleSystemPrompt() },
      { role: 'user', content: `Review this Spectre runtime candidate. Return JSON only.\n\nCandidate JSON:\n${JSON.stringify(packet)}` }
    ],
    options: {
      temperature: 0,
      num_predict: RUNTIME_NUM_PREDICT
    }
  }, {
    timeout: RUNTIME_TIMEOUT_MS
  });

  const text = response.data?.message?.content || response.data?.response || '';
  return normalizeSimpleReview(extractJsonObject(text));
}

function patchAIAgent(AIAgent) {
  if (!ENABLED || !AIAgent || AIAgent.__simpleRuntimePatched) return AIAgent;

  class SimpleRuntimeAIAgent extends AIAgent {
    constructor(config, logger) {
      super(config, logger);
      if (process.env.SIMPLE_RUNTIME_AI_MODEL || process.env.RUNTIME_AI_MODEL || process.env.OLLAMA_MODEL === undefined) {
        this.model = RUNTIME_MODEL;
      }
    }

    async warmup() {
      if (!ENABLED) return super.warmup();
      const startedAt = Date.now();
      try {
        await axios.post(this.apiEndpoint, {
          model: RUNTIME_MODEL,
          stream: false,
          format: 'json',
          messages: [
            { role: 'system', content: simpleSystemPrompt() },
            { role: 'user', content: 'Return {"action":"WATCH","confidence":10,"risk":"MEDIUM","reason":"warm"}' }
          ],
          options: { temperature: 0, num_predict: 48 }
        }, { timeout: Number(process.env.SIMPLE_RUNTIME_AI_WARMUP_TIMEOUT_MS || 20000) });
        this.logger.info(`Simple runtime AI warmed: ${RUNTIME_MODEL} (${Date.now() - startedAt}ms)`);
        return true;
      } catch (error) {
        this.logger.warn('Simple runtime AI warmup failed', error.message);
        return false;
      }
    }

    async callTradeReviewer(tokenInfo, signal, options = {}) {
      if (process.env.SIMPLE_RUNTIME_AI_ENABLED === 'false') {
        return super.callTradeReviewer(tokenInfo, signal, options);
      }

      const id = attemptId();
      const startedAt = Date.now();
      const attemptType = options.lightweight ? 'lightweight_retry' : 'primary';
      const baseTelemetry = {
        attemptId: id,
        signalId: signal?.id || signal?.signalId || null,
        mint: mintOf(tokenInfo, signal),
        symbol: tokenInfo?.symbol || null,
        source: tokenInfo?.source || signal?.source || 'unknown',
        attemptType,
        model: RUNTIME_MODEL,
        timeoutMs: RUNTIME_TIMEOUT_MS,
        outerTimeoutMs: Number(this.config?.aiTimeoutMs || 0) || null
      };
      emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_started', baseTelemetry);

      try {
        const result = await callSimpleRuntimeReview(this, tokenInfo, signal);
        const latencyMs = Date.now() - startedAt;
        emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_completed', {
          ...baseTelemetry,
          latencyMs,
          action: result.action || null,
          approved: result.approved === true,
          confidence: result.confidence ?? null,
          risk: result.simpleRuntime?.risk || null,
          reason: result.reason || null,
          convergenceScore: result.convergenceScore ?? null
        });
        this.logger.info(`Simple runtime AI review ${result.action} ${result.confidence}% ${result.simpleRuntime.risk} (${Date.now() - startedAt}ms)`);
        return result;
      } catch (error) {
        const failure = classifyRuntimeError(error);
        emitSimpleRuntimeTelemetry(this, 'simple_runtime_ai.review_failed', {
          ...baseTelemetry,
          latencyMs: Date.now() - startedAt,
          failureType: failure.failureType,
          reason: failure.reason,
          errorMessage: error.message,
          errorCode: error.code || null,
          httpStatus: Number(error?.response?.status || 0) || null
        });
        this.logger.warn('Simple runtime AI review failed', {
          failureType: failure.failureType,
          reason: failure.reason,
          message: error.message
        });
        return {
          approved: false,
          confidence: 0,
          reason: failure.reason,
          primaryStrategy: 'NONE',
          convergenceScore: 0,
          action: 'WATCH',
          strategyScores: this.buildEmptyStrategyScores(),
          contradictions: [`simple runtime AI ${failure.failureType}`],
          executionProfile: this.buildDefaultExecutionProfile(),
          simpleRuntime: {
            model: RUNTIME_MODEL,
            risk: 'HIGH',
            error: error.message,
            failureType: failure.failureType
          }
        };
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
