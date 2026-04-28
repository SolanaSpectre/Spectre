require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'runtime-model-benchmark-latest.json');
const DEFAULT_MODELS = [
  'qwen2.5-coder:7b',
  'qwen2.5:7b-instruct',
  'llama3.1:8b',
  'mistral:7b'
];

const REQUIRED_STRATEGIES = ['RUNNER_HUNTER', 'SNIPER', 'SCALPER', 'MIGRATION_HUNTER', 'WALLET_FLOW'];
const REQUIRED_ACTIONS = ['ENTER', 'WATCH', 'REJECT'];
const REQUIRED_ENTRY_URGENCY = ['low', 'medium', 'high'];
const REQUIRED_EXPECTED_HOLD = ['scalp', 'short', 'short_to_medium', 'medium'];
const REQUIRED_EXIT_STYLE = ['fixed', 'tight_invalidation', 'trailing_runner', 'migration_hold', 'flow_follow'];

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

function toList(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function percentile(values, pct) {
  const cleaned = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!cleaned.length) return null;
  const index = Math.min(cleaned.length - 1, Math.ceil((pct / 100) * cleaned.length) - 1);
  return Number(cleaned[index].toFixed(2));
}

function avg(values) {
  const cleaned = values.filter((value) => Number.isFinite(value));
  if (!cleaned.length) return null;
  return Number((cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length).toFixed(2));
}

function numberOrNull(value, decimals = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty response');

  try {
    return JSON.parse(raw);
  } catch {
    // Continue to extraction below.
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('no JSON object found');
  }

  return JSON.parse(raw.slice(start, end + 1));
}

function isUnitNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1;
}

function validateReviewSchema(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['response is not an object'];
  }

  if (typeof value.approved !== 'boolean') errors.push('approved must be boolean');
  if (!Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 100) {
    errors.push('confidence must be 0-100');
  }
  if (typeof value.reason !== 'string' || value.reason.length < 1) errors.push('reason must be non-empty string');
  if (!REQUIRED_STRATEGIES.includes(value.primaryStrategy)) errors.push('primaryStrategy invalid');
  if (!isUnitNumber(value.convergenceScore)) errors.push('convergenceScore must be 0-1');
  if (!REQUIRED_ACTIONS.includes(value.action)) errors.push('action invalid');

  if (!value.strategyScores || typeof value.strategyScores !== 'object') {
    errors.push('strategyScores missing');
  } else {
    for (const strategy of REQUIRED_STRATEGIES) {
      if (!isUnitNumber(value.strategyScores[strategy])) {
        errors.push(`strategyScores.${strategy} must be 0-1`);
      }
    }
  }

  if (!Array.isArray(value.contradictions)) errors.push('contradictions must be array');

  const profile = value.executionProfile || {};
  if (!REQUIRED_ENTRY_URGENCY.includes(profile.entryUrgency)) errors.push('executionProfile.entryUrgency invalid');
  if (!REQUIRED_EXPECTED_HOLD.includes(profile.expectedHold)) errors.push('executionProfile.expectedHold invalid');
  if (!REQUIRED_EXIT_STYLE.includes(profile.exitStyle)) errors.push('executionProfile.exitStyle invalid');

  return errors;
}

function buildSystemPrompt() {
  return `You are a fast JSON-only Solana memecoin trade auditor.
Return exactly one compact JSON object. Do not use markdown. Do not include text before or after JSON.
Use only the candidate JSON. Do not invent external facts.

Required schema:
{"approved":true,"confidence":0,"reason":"short","primaryStrategy":"RUNNER_HUNTER","convergenceScore":0,"action":"ENTER","strategyScores":{"RUNNER_HUNTER":0,"SNIPER":0,"SCALPER":0,"MIGRATION_HUNTER":0,"WALLET_FLOW":0},"contradictions":[],"executionProfile":{"entryUrgency":"high","expectedHold":"short_to_medium","exitStyle":"trailing_runner"}}

Allowed actions: ENTER, WATCH, REJECT.
Allowed strategies: RUNNER_HUNTER, SNIPER, SCALPER, MIGRATION_HUNTER, WALLET_FLOW.
Scores must be numbers from 0 to 1. Confidence must be 0 to 100.`;
}

function buildCandidate(index) {
  const candidates = [
    {
      token: { mint: 'BenchRunner111111111111111111111111111111111', symbol: 'RUN', source: 'pumpportal_new_token', bondingStage: 'mid_curve' },
      market: { priceSol: 0.00000042, liquidityUsd: 22000, minLiquidityUsd: 15000, recentTradeCount: 86, recentBuys: 67, recentSells: 19, recentVolumeSol: 92, tradeVelocityPerMin: 46, buyRatio: 0.7791, tokenAgeSeconds: 240 },
      preMigration: { score: 88, flagged: true, reasons: ['HIGH_TRADE_VELOCITY', 'BUY_PRESSURE', 'CURVE_ADVANCING'], curveProgress: 0.82, recentVolumeSol: 92, tradeVelocityPerMin: 46 },
      deterministicSignal: { action: 'BUY', amountSol: 0.05, qualityScore: 0.84, momentumScore: 0.88, reasoning: 'Strong pre-migration runner candidate with clean buy pressure.' },
      walletFlow: { supportTier: 'TRUSTED_FLOW', learningSignals: ['trusted active rotator touched early'], cautionSignals: [] }
    },
    {
      token: { mint: 'BenchWatch222222222222222222222222222222222', symbol: 'MID', source: 'pumpportal_trade', bondingStage: 'early_curve' },
      market: { priceSol: 0.00000012, liquidityUsd: 17000, minLiquidityUsd: 15000, recentTradeCount: 32, recentBuys: 18, recentSells: 14, recentVolumeSol: 18, tradeVelocityPerMin: 9, buyRatio: 0.5625, tokenAgeSeconds: 420 },
      preMigration: { score: 66, flagged: true, reasons: ['MIXED_FLOW', 'SLOW_CURVE'], curveProgress: 0.44, recentVolumeSol: 18, tradeVelocityPerMin: 9 },
      deterministicSignal: { action: 'BUY', amountSol: 0.03, qualityScore: 0.61, momentumScore: 0.55, reasoning: 'Possible setup but momentum is not clean.' },
      walletFlow: { supportTier: 'MIXED_FLOW', learningSignals: ['some repeated buyers'], cautionSignals: ['one avoid wallet overlap'] }
    },
    {
      token: { mint: 'BenchReject3333333333333333333333333333333', symbol: 'BAD', source: 'pumpportal_new_token', bondingStage: 'early_curve' },
      market: { priceSol: 0.00000004, liquidityUsd: 9000, minLiquidityUsd: 15000, recentTradeCount: 20, recentBuys: 7, recentSells: 13, recentVolumeSol: 8, tradeVelocityPerMin: 6, buyRatio: 0.35, tokenAgeSeconds: 180 },
      preMigration: { score: 41, flagged: false, reasons: ['SELL_PRESSURE', 'LOW_LIQUIDITY'], curveProgress: 0.22, recentVolumeSol: 8, tradeVelocityPerMin: 6 },
      deterministicSignal: { action: 'BUY', amountSol: 0.02, qualityScore: 0.38, momentumScore: 0.29, reasoning: 'Weak structure and below liquidity floor.' },
      walletFlow: { supportTier: 'AVOID_FLOW', learningSignals: [], cautionSignals: ['risk wallet overlap', 'sell pressure'] }
    }
  ];

  return candidates[index % candidates.length];
}

function buildPrompt(iteration) {
  return `Review this Spectre runtime candidate. Return JSON only.\n\nCandidate JSON:\n${JSON.stringify(buildCandidate(iteration))}`;
}

async function callOllama({ host, model, timeoutMs, iteration, numPredict }) {
  const startedAt = Date.now();
  const response = await axios.post(`${host.replace(/\/$/, '')}/api/chat`, {
    model,
    stream: false,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildPrompt(iteration) }
    ],
    options: {
      temperature: 0,
      num_predict: numPredict
    }
  }, {
    timeout: timeoutMs
  });

  const latencyMs = Date.now() - startedAt;
  const text = response.data?.message?.content || response.data?.response || '';
  const evalCount = Number(response.data?.eval_count || 0);
  const evalDurationNs = Number(response.data?.eval_duration || 0);
  const promptEvalDurationNs = Number(response.data?.prompt_eval_duration || 0);
  const totalDurationNs = Number(response.data?.total_duration || 0);
  const tokPerSec = evalCount > 0 && evalDurationNs > 0
    ? (evalCount / (evalDurationNs / 1e9))
    : null;

  return {
    latencyMs,
    text,
    evalCount: Number.isFinite(evalCount) ? evalCount : null,
    tokPerSec: numberOrNull(tokPerSec, 2),
    promptEvalMs: promptEvalDurationNs > 0 ? numberOrNull(promptEvalDurationNs / 1e6, 2) : null,
    totalDurationMs: totalDurationNs > 0 ? numberOrNull(totalDurationNs / 1e6, 2) : null
  };
}

async function benchmarkModel(model, options) {
  const runs = [];
  for (let iteration = 0; iteration < options.runs; iteration += 1) {
    const result = {
      iteration,
      model,
      ok: false,
      validJson: false,
      schemaValid: false,
      latencyMs: null,
      tokPerSec: null,
      action: null,
      error: null,
      schemaErrors: [],
      extraCommentary: false
    };

    try {
      const response = await callOllama({
        host: options.host,
        model,
        timeoutMs: options.timeoutMs,
        iteration,
        numPredict: options.numPredict
      });
      result.latencyMs = response.latencyMs;
      result.tokPerSec = response.tokPerSec;
      result.evalCount = response.evalCount;
      result.promptEvalMs = response.promptEvalMs;
      result.totalDurationMs = response.totalDurationMs;

      const trimmed = String(response.text || '').trim();
      result.extraCommentary = !(trimmed.startsWith('{') && trimmed.endsWith('}'));
      const parsed = extractJsonObject(response.text);
      result.validJson = true;
      result.action = parsed.action || null;
      result.schemaErrors = validateReviewSchema(parsed);
      result.schemaValid = result.schemaErrors.length === 0;
      result.ok = result.validJson && result.schemaValid && !result.extraCommentary;
      result.response = options.keepResponses ? parsed : undefined;
      result.raw = options.keepResponses ? response.text : undefined;
    } catch (error) {
      result.error = error.code === 'ECONNABORTED'
        ? `TIMEOUT_${options.timeoutMs}MS`
        : error.message;
    }

    runs.push(result);
    const status = result.ok ? 'ok' : 'fail';
    console.log(`${model} run ${iteration + 1}/${options.runs}: ${status} ${result.latencyMs ?? '-'}ms ${result.error || result.schemaErrors.slice(0, 2).join('; ')}`);
  }

  return summarizeModel(model, runs);
}

function summarizeModel(model, runs) {
  const latencies = runs.map((run) => run.latencyMs).filter((value) => Number.isFinite(value));
  const tokPerSecValues = runs.map((run) => run.tokPerSec).filter((value) => Number.isFinite(value));
  const okCount = runs.filter((run) => run.ok).length;
  const validJsonCount = runs.filter((run) => run.validJson).length;
  const schemaValidCount = runs.filter((run) => run.schemaValid).length;
  const timeoutCount = runs.filter((run) => String(run.error || '').startsWith('TIMEOUT')).length;
  const extraCommentaryCount = runs.filter((run) => run.extraCommentary).length;

  return {
    model,
    summary: {
      runs: runs.length,
      okCount,
      okRate: numberOrNull(okCount / Math.max(runs.length, 1), 4),
      validJsonCount,
      validJsonRate: numberOrNull(validJsonCount / Math.max(runs.length, 1), 4),
      schemaValidCount,
      schemaValidRate: numberOrNull(schemaValidCount / Math.max(runs.length, 1), 4),
      timeoutCount,
      timeoutRate: numberOrNull(timeoutCount / Math.max(runs.length, 1), 4),
      extraCommentaryCount,
      extraCommentaryRate: numberOrNull(extraCommentaryCount / Math.max(runs.length, 1), 4),
      avgLatencyMs: avg(latencies),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      avgTokPerSec: avg(tokPerSecValues),
      p50TokPerSec: percentile(tokPerSecValues, 50)
    },
    failures: runs
      .filter((run) => !run.ok)
      .slice(0, 10)
      .map((run) => ({
        iteration: run.iteration,
        latencyMs: run.latencyMs,
        error: run.error,
        validJson: run.validJson,
        schemaValid: run.schemaValid,
        schemaErrors: run.schemaErrors,
        extraCommentary: run.extraCommentary
      })),
    runs
  };
}

function rankResults(results) {
  return results.slice().sort((a, b) => {
    const aSummary = a.summary;
    const bSummary = b.summary;
    if (bSummary.okRate !== aSummary.okRate) return bSummary.okRate - aSummary.okRate;
    if (aSummary.timeoutRate !== bSummary.timeoutRate) return aSummary.timeoutRate - bSummary.timeoutRate;
    return (aSummary.p95LatencyMs || Infinity) - (bSummary.p95LatencyMs || Infinity);
  });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = String(args.host || process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim();
  const models = toList(args.models || process.env.MODEL_BENCHMARK_MODELS, DEFAULT_MODELS);
  const runs = toNumber(args.runs || process.env.MODEL_BENCHMARK_RUNS, 10);
  const timeoutMs = toNumber(args.timeoutMs || process.env.MODEL_BENCHMARK_TIMEOUT_MS || process.env.AI_TIMEOUT_MS, 5000);
  const numPredict = toNumber(args.numPredict || process.env.MODEL_BENCHMARK_NUM_PREDICT, 160);
  const outputPath = resolveRepoPath(args.output, DEFAULT_OUTPUT_PATH);
  const keepResponses = args.keepResponses === true || args.keepResponses === 'true';

  console.log('Runtime Model Benchmark');
  console.log(`Host: ${host}`);
  console.log(`Models: ${models.join(', ')}`);
  console.log(`Runs/model: ${runs}`);
  console.log(`Timeout: ${timeoutMs}ms`);
  console.log('');

  const results = [];
  for (const model of models) {
    console.log(`--- ${model} ---`);
    results.push(await benchmarkModel(model, {
      host,
      runs,
      timeoutMs,
      numPredict,
      keepResponses
    }));
    console.log('');
  }

  const ranked = rankResults(results);
  const report = {
    generatedAt: new Date().toISOString(),
    host,
    runsPerModel: runs,
    timeoutMs,
    numPredict,
    ranking: ranked.map((item, index) => ({ rank: index + 1, model: item.model, ...item.summary })),
    results
  };

  writeJson(outputPath, report);
  console.log('Ranking:');
  report.ranking.forEach((row) => {
    console.log(`${row.rank}. ${row.model} ok=${row.okRate} json=${row.validJsonRate} schema=${row.schemaValidRate} timeout=${row.timeoutRate} p95=${row.p95LatencyMs}ms`);
  });
  console.log(`\nWrote ${outputPath}`);
}

main().catch((error) => {
  console.error(`[ERROR] Runtime model benchmark failed: ${error.message}`);
  process.exit(1);
});
