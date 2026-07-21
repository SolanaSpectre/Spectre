const fs = require('fs');
const path = require('path');
const axios = require('axios');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'runtime-model-benchmark-latest.json');
const DEFAULT_MODELS = ['qwen2.5:7b-instruct', 'llama3.1:8b', 'llama3.2:3b'];
const ACTIONS = ['ENTER', 'WATCH', 'REJECT'];
const RISKS = ['LOW', 'MEDIUM', 'HIGH'];
const STRATEGIES = ['RUNNER_HUNTER', 'SNIPER', 'SCALPER', 'MIGRATION_HUNTER', 'WALLET_FLOW'];
const ENTRY_URGENCY = ['low', 'medium', 'high'];
const EXPECTED_HOLD = ['scalp', 'short', 'short_to_medium', 'medium'];
const EXIT_STYLE = ['fixed', 'tight_invalidation', 'trailing_runner', 'migration_hold', 'flow_follow'];

function parseArgs(argv) {
  const args = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  if (!args.models && positionals[0]) args.models = positionals[0];
  if (!args.runs && positionals[1]) args.runs = positionals[1];
  if (!args.timeoutMs && positionals[2]) args.timeoutMs = positionals[2];
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

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function numberOrNull(value, decimals = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function avg(values) {
  const cleaned = values.filter((value) => Number.isFinite(value));
  if (!cleaned.length) return null;
  return numberOrNull(cleaned.reduce((sum, value) => sum + value, 0) / cleaned.length, 2);
}

function percentile(values, pct) {
  const cleaned = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!cleaned.length) return null;
  const index = Math.min(cleaned.length - 1, Math.ceil((pct / 100) * cleaned.length) - 1);
  return numberOrNull(cleaned[index], 2);
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty response');

  try {
    return JSON.parse(raw);
  } catch {
    // Try extraction below.
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return JSON.parse(fenced[1].trim());

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object found');
  return JSON.parse(raw.slice(start, end + 1));
}

function isUnitNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 1;
}

function validateSimpleSchema(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['response is not an object'];
  if (!ACTIONS.includes(value.action)) errors.push('action invalid');
  if (!Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 100) errors.push('confidence must be 0-100');
  if (!RISKS.includes(value.risk)) errors.push('risk invalid');
  if (typeof value.reason !== 'string' || value.reason.trim().length < 1) errors.push('reason must be non-empty string');
  return errors;
}

function validateFullSchema(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['response is not an object'];
  if (typeof value.approved !== 'boolean') errors.push('approved must be boolean');
  if (!Number.isFinite(Number(value.confidence)) || Number(value.confidence) < 0 || Number(value.confidence) > 100) errors.push('confidence must be 0-100');
  if (typeof value.reason !== 'string' || value.reason.trim().length < 1) errors.push('reason must be non-empty string');
  if (!STRATEGIES.includes(value.primaryStrategy)) errors.push('primaryStrategy invalid');
  if (!isUnitNumber(value.convergenceScore)) errors.push('convergenceScore must be 0-1');
  if (!ACTIONS.includes(value.action)) errors.push('action invalid');
  if (!value.strategyScores || typeof value.strategyScores !== 'object') {
    errors.push('strategyScores missing');
  } else {
    for (const strategy of STRATEGIES) {
      if (!isUnitNumber(value.strategyScores[strategy])) errors.push(`strategyScores.${strategy} must be 0-1`);
    }
  }
  if (!Array.isArray(value.contradictions)) errors.push('contradictions must be array');
  const profile = value.executionProfile || {};
  if (!ENTRY_URGENCY.includes(profile.entryUrgency)) errors.push('executionProfile.entryUrgency invalid');
  if (!EXPECTED_HOLD.includes(profile.expectedHold)) errors.push('executionProfile.expectedHold invalid');
  if (!EXIT_STYLE.includes(profile.exitStyle)) errors.push('executionProfile.exitStyle invalid');
  return errors;
}

function validateSchema(value, schema) {
  return schema === 'simple' ? validateSimpleSchema(value) : validateFullSchema(value);
}

function buildSystemPrompt(schema) {
  if (schema === 'simple') {
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

  return `You are a fast JSON-only Solana memecoin trade auditor.
Return exactly one compact JSON object. Do not use markdown. Do not include text before or after JSON.
Use only the candidate JSON. Do not invent external facts.

Required JSON keys:
approved boolean
confidence number 0-100
reason short string
primaryStrategy one of RUNNER_HUNTER, SNIPER, SCALPER, MIGRATION_HUNTER, WALLET_FLOW
convergenceScore number 0-1
action one of ENTER, WATCH, REJECT
strategyScores object with RUNNER_HUNTER, SNIPER, SCALPER, MIGRATION_HUNTER, WALLET_FLOW numbers 0-1
contradictions array of short strings
executionProfile object with exact enum values

Return this exact shape with valid values:
{"approved":true,"confidence":80,"reason":"short","primaryStrategy":"RUNNER_HUNTER","convergenceScore":0.8,"action":"ENTER","strategyScores":{"RUNNER_HUNTER":0.8,"SNIPER":0.2,"SCALPER":0.3,"MIGRATION_HUNTER":0.1,"WALLET_FLOW":0.5},"contradictions":[],"executionProfile":{"entryUrgency":"high","expectedHold":"short_to_medium","exitStyle":"trailing_runner"}}`;
}

function buildSyntheticCase(index, schema) {
  const candidates = [
    {
      id: 'synthetic:runner',
      category: 'winner_like',
      acceptableActions: ['ENTER'],
      token: { mint: 'BenchRunner111111111111111111111111111111111', symbol: 'RUN', source: 'pumpportal_new_token', bondingStage: 'mid_curve' },
      market: { liquidityUsd: 22000, minLiquidityUsd: 15000, recentTradeCount: 86, recentBuys: 67, recentSells: 19, recentVolumeSol: 92, tradeVelocityPerMin: 46, buyRatio: 0.7791, tokenAgeSeconds: 240 },
      preMigration: { score: 88, flagged: true, reasons: ['HIGH_TRADE_VELOCITY', 'BUY_PRESSURE', 'CURVE_ADVANCING'], curveProgress: 0.82 },
      deterministicSignal: { action: 'BUY', amountSol: 0.05, qualityScore: 0.84, momentumScore: 0.88, reasoning: 'Strong pre-migration runner candidate with clean buy pressure.' },
      walletFlow: { supportTier: 'TRUSTED_FLOW', learningSignals: ['trusted active rotator touched early'], cautionSignals: [] }
    },
    {
      id: 'synthetic:watch',
      category: 'ambiguous',
      acceptableActions: ['WATCH'],
      token: { mint: 'BenchWatch222222222222222222222222222222222', symbol: 'MID', source: 'pumpportal_trade', bondingStage: 'early_curve' },
      market: { liquidityUsd: 17000, minLiquidityUsd: 15000, recentTradeCount: 32, recentBuys: 18, recentSells: 14, recentVolumeSol: 18, tradeVelocityPerMin: 9, buyRatio: 0.5625, tokenAgeSeconds: 420 },
      preMigration: { score: 66, flagged: true, reasons: ['MIXED_FLOW', 'SLOW_CURVE'], curveProgress: 0.44 },
      deterministicSignal: { action: 'BUY', amountSol: 0.03, qualityScore: 0.61, momentumScore: 0.55, reasoning: 'Possible setup but momentum is not clean.' },
      walletFlow: { supportTier: 'MIXED_FLOW', learningSignals: ['some repeated buyers'], cautionSignals: ['one avoid wallet overlap'] }
    },
    {
      id: 'synthetic:reject',
      category: 'reject_like',
      acceptableActions: ['REJECT'],
      token: { mint: 'BenchReject3333333333333333333333333333333', symbol: 'BAD', source: 'pumpportal_new_token', bondingStage: 'early_curve' },
      market: { liquidityUsd: 9000, minLiquidityUsd: 15000, recentTradeCount: 20, recentBuys: 7, recentSells: 13, recentVolumeSol: 8, tradeVelocityPerMin: 6, buyRatio: 0.35, tokenAgeSeconds: 180 },
      preMigration: { score: 41, flagged: false, reasons: ['SELL_PRESSURE', 'LOW_LIQUIDITY'], curveProgress: 0.22 },
      deterministicSignal: { action: 'BUY', amountSol: 0.02, qualityScore: 0.38, momentumScore: 0.29, reasoning: 'Weak structure and below liquidity floor.' },
      walletFlow: { supportTier: 'AVOID_FLOW', learningSignals: [], cautionSignals: ['risk wallet overlap', 'sell pressure'] }
    }
  ];

  const selected = candidates[index % candidates.length];
  const { id, category, acceptableActions, ...candidate } = selected;
  if (schema !== 'simple') return { id, category, acceptableActions, candidate };

  return { id, category, acceptableActions, candidate: {
    token: candidate.token,
    market: candidate.market,
    preMigration: candidate.preMigration,
    deterministicSignal: candidate.deterministicSignal,
    walletSupportTier: candidate.walletFlow.supportTier,
    walletCautions: candidate.walletFlow.cautionSignals
  } };
}

function replayCaseToBenchmarkCase(item, schema) {
  const signal = item.deterministicSignal || {};
  const category = String(item.category || 'unknown');
  const acceptableActions = category === 'winner'
    ? ['ENTER']
    : ['WATCH', 'REJECT'];
  const fullCandidate = {
    token: {
      mint: item.token || null,
      symbol: null,
      source: signal.source || 'unknown',
      bondingStage: null
    },
    market: {
      liquidityUsd: null,
      recentTradeCount: null,
      recentVolumeSol: null,
      tradeVelocityPerMin: null,
      buyRatio: null
    },
    preMigration: null,
    deterministicSignal: {
      action: 'BUY',
      amountSol: signal.amountSol ?? 0,
      qualityScore: signal.qualityScore ?? 0,
      momentumScore: signal.momentumScore ?? 0,
      rankScore: signal.rankScore ?? 0,
      reasoning: 'Historical candidate reconstructed from decision-time telemetry.'
    }
  };

  const candidate = schema === 'simple'
    ? {
        token: fullCandidate.token,
        market: fullCandidate.market,
        preMigration: fullCandidate.preMigration,
        deterministicSignal: fullCandidate.deterministicSignal,
        walletSupportTier: null,
        walletCautions: []
      }
    : fullCandidate;

  return {
    id: item.id || `replay:${item.runStamp || 'unknown'}:${item.token || 'unknown'}`,
    category,
    acceptableActions,
    candidate,
    labelSource: category === 'winner' || category === 'loser'
      ? 'realized_paper_outcome'
      : 'historical_deterministic_rejection'
  };
}

function loadReplayCases(filePath, schema) {
  if (!filePath) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return (Array.isArray(parsed.cases) ? parsed.cases : [])
    .map((item) => replayCaseToBenchmarkCase(item, schema));
}

function benchmarkCaseAt(iteration, schema, replayCases = []) {
  if (replayCases.length) return replayCases[iteration % replayCases.length];
  return buildSyntheticCase(iteration, schema);
}

function buildPrompt(benchmarkCase) {
  return `Review this Spectre runtime candidate. Return JSON only.\n\nCandidate JSON:\n${JSON.stringify(benchmarkCase.candidate)}`;
}

async function callOllama({ host, model, timeoutMs, benchmarkCase, numPredict, useJsonMode, schema, keepAlive }) {
  const startedAt = Date.now();
  const body = {
    model,
    stream: false,
    messages: [
      { role: 'system', content: buildSystemPrompt(schema) },
      { role: 'user', content: buildPrompt(benchmarkCase) }
    ],
    think: false,
    keep_alive: keepAlive,
    options: {
      temperature: 0,
      num_predict: numPredict
    }
  };
  if (useJsonMode) body.format = 'json';

  const response = await axios.post(`${host.replace(/\/$/, '')}/api/chat`, body, { timeout: timeoutMs });
  const latencyMs = Date.now() - startedAt;
  const text = response.data?.message?.content || response.data?.response || '';
  const evalCount = Number(response.data?.eval_count || 0);
  const evalDurationNs = Number(response.data?.eval_duration || 0);
  const tokPerSec = evalCount > 0 && evalDurationNs > 0 ? evalCount / (evalDurationNs / 1e9) : null;

  return {
    latencyMs,
    text,
    evalCount: Number.isFinite(evalCount) ? evalCount : null,
    tokPerSec: numberOrNull(tokPerSec, 2),
    promptEvalMs: response.data?.prompt_eval_duration ? numberOrNull(Number(response.data.prompt_eval_duration) / 1e6, 2) : null,
    totalDurationMs: response.data?.total_duration ? numberOrNull(Number(response.data.total_duration) / 1e6, 2) : null,
    loadDurationMs: response.data?.load_duration ? numberOrNull(Number(response.data.load_duration) / 1e6, 2) : null
  };
}

async function warmupModel(model, options) {
  const attempts = Math.max(0, Number(options.warmupRuns || 0));
  const warmups = [];
  if (attempts <= 0) return warmups;

  console.log(`${model} warmup: ${attempts} run(s)`);
  for (let i = 0; i < attempts; i += 1) {
    const startedAt = Date.now();
    try {
      await callOllama({
        ...options,
        model,
        timeoutMs: options.warmupTimeoutMs,
        benchmarkCase: benchmarkCaseAt(i, options.schema, options.replayCases),
        numPredict: Math.min(options.numPredict, 96)
      });
      const latencyMs = Date.now() - startedAt;
      warmups.push({ ok: true, latencyMs });
      console.log(`${model} warmup ${i + 1}/${attempts}: ok ${latencyMs}ms`);
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error.code === 'ECONNABORTED' ? `TIMEOUT_${options.warmupTimeoutMs}MS` : error.message;
      warmups.push({ ok: false, latencyMs, error: message });
      console.log(`${model} warmup ${i + 1}/${attempts}: fail ${latencyMs}ms ${message}`);
    }
  }
  return warmups;
}

async function benchmarkModel(model, options) {
  const warmups = await warmupModel(model, options);
  const runs = [];

  for (let iteration = 0; iteration < options.runs; iteration += 1) {
    const benchmarkCase = benchmarkCaseAt(iteration, options.schema, options.replayCases);
    const result = {
      iteration,
      model,
      caseId: benchmarkCase.id,
      category: benchmarkCase.category,
      acceptableActions: benchmarkCase.acceptableActions,
      labelSource: benchmarkCase.labelSource || 'synthetic_preregistered',
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
      const response = await callOllama({ ...options, model, benchmarkCase });
      Object.assign(result, {
        latencyMs: response.latencyMs,
        tokPerSec: response.tokPerSec,
        evalCount: response.evalCount,
        promptEvalMs: response.promptEvalMs,
        totalDurationMs: response.totalDurationMs,
        loadDurationMs: response.loadDurationMs
      });

      const trimmed = String(response.text || '').trim();
      result.extraCommentary = !(trimmed.startsWith('{') && trimmed.endsWith('}'));
      const parsed = extractJsonObject(response.text);
      result.validJson = true;
      result.action = parsed.action || null;
      result.decisionMatch = benchmarkCase.acceptableActions.includes(result.action);
      result.falseVeto = ['winner', 'winner_like'].includes(benchmarkCase.category) && result.action !== 'ENTER';
      result.unsafeEnter = !['winner', 'winner_like'].includes(benchmarkCase.category) && result.action === 'ENTER';
      result.schemaErrors = validateSchema(parsed, options.schema);
      result.schemaValid = result.schemaErrors.length === 0;
      result.ok = result.validJson && result.schemaValid && !result.extraCommentary;
      if (options.keepResponses) {
        result.response = parsed;
        result.raw = response.text;
      }
    } catch (error) {
      result.error = error.code === 'ECONNABORTED' ? `TIMEOUT_${options.timeoutMs}MS` : error.message;
    }

    runs.push(result);
    const status = result.ok ? 'ok' : 'fail';
    console.log(`${model} run ${iteration + 1}/${options.runs}: ${status} ${result.latencyMs ?? '-'}ms ${result.error || result.schemaErrors.slice(0, 2).join('; ')}`);
  }

  return summarizeModel(model, runs, warmups);
}

function summarizeModel(model, runs, warmups = []) {
  const latencies = runs.map((run) => run.latencyMs).filter(Number.isFinite);
  const tokPerSecValues = runs.map((run) => run.tokPerSec).filter(Number.isFinite);
  const okCount = runs.filter((run) => run.ok).length;
  const validJsonCount = runs.filter((run) => run.validJson).length;
  const schemaValidCount = runs.filter((run) => run.schemaValid).length;
  const timeoutCount = runs.filter((run) => String(run.error || '').startsWith('TIMEOUT')).length;
  const extraCommentaryCount = runs.filter((run) => run.extraCommentary).length;
  const scoredRuns = runs.filter((run) => run.schemaValid && Array.isArray(run.acceptableActions));
  const decisionMatchCount = scoredRuns.filter((run) => run.decisionMatch).length;
  const winnerRuns = scoredRuns.filter((run) => ['winner', 'winner_like'].includes(run.category));
  const nonWinnerRuns = scoredRuns.filter((run) => !['winner', 'winner_like'].includes(run.category));
  const falseVetoCount = winnerRuns.filter((run) => run.action !== 'ENTER').length;
  const unsafeEnterCount = nonWinnerRuns.filter((run) => run.action === 'ENTER').length;
  const actionsByCase = new Map();
  for (const run of scoredRuns) {
    if (!actionsByCase.has(run.caseId)) actionsByCase.set(run.caseId, new Set());
    actionsByCase.get(run.caseId).add(run.action);
  }
  const inconsistentCaseCount = Array.from(actionsByCase.values()).filter((actions) => actions.size > 1).length;

  return {
    model,
    summary: {
      runs: runs.length,
      warmupRuns: warmups.length,
      warmupOkCount: warmups.filter((run) => run.ok).length,
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
      decisionMatchRate: numberOrNull(decisionMatchCount / Math.max(scoredRuns.length, 1), 4),
      falseVetoCount,
      falseVetoRate: numberOrNull(falseVetoCount / Math.max(winnerRuns.length, 1), 4),
      unsafeEnterCount,
      unsafeEnterRate: numberOrNull(unsafeEnterCount / Math.max(nonWinnerRuns.length, 1), 4),
      uniqueCases: actionsByCase.size,
      inconsistentCaseCount,
      consistentCaseRate: numberOrNull((actionsByCase.size - inconsistentCaseCount) / Math.max(actionsByCase.size, 1), 4),
      avgLatencyMs: avg(latencies),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      avgTokPerSec: avg(tokPerSecValues),
      p50TokPerSec: percentile(tokPerSecValues, 50)
    },
    warmups,
    failures: runs.filter((run) => !run.ok).slice(0, 10).map((run) => ({
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
    if (b.summary.okRate !== a.summary.okRate) return b.summary.okRate - a.summary.okRate;
    if (a.summary.unsafeEnterRate !== b.summary.unsafeEnterRate) return a.summary.unsafeEnterRate - b.summary.unsafeEnterRate;
    if (a.summary.falseVetoRate !== b.summary.falseVetoRate) return a.summary.falseVetoRate - b.summary.falseVetoRate;
    if (b.summary.decisionMatchRate !== a.summary.decisionMatchRate) return b.summary.decisionMatchRate - a.summary.decisionMatchRate;
    if (a.summary.timeoutRate !== b.summary.timeoutRate) return a.summary.timeoutRate - b.summary.timeoutRate;
    return (a.summary.p95LatencyMs || Infinity) - (b.summary.p95LatencyMs || Infinity);
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
  const warmupRuns = toNumber(args.warmupRuns || process.env.MODEL_BENCHMARK_WARMUP_RUNS, 1);
  const warmupTimeoutMs = toNumber(args.warmupTimeoutMs || process.env.MODEL_BENCHMARK_WARMUP_TIMEOUT_MS, Math.max(timeoutMs * 4, 20000));
  const schema = ['simple', 'full'].includes(String(args.schema || '').toLowerCase()) ? String(args.schema).toLowerCase() : 'full';
  const defaultNumPredict = schema === 'simple' ? 80 : 160;
  const numPredict = toNumber(args.numPredict || process.env.MODEL_BENCHMARK_NUM_PREDICT, defaultNumPredict);
  const outputPath = resolveRepoPath(args.output, DEFAULT_OUTPUT_PATH);
  const keepResponses = args.keepResponses === true || args.keepResponses === 'true';
  const useJsonMode = !toBool(args.noJsonMode || process.env.MODEL_BENCHMARK_DISABLE_JSON_MODE, false);
  const keepAlive = String(args.keepAlive || process.env.OLLAMA_KEEP_ALIVE || '2h');
  const replayPath = args.replay
    ? resolveRepoPath(args.replay)
    : null;
  const replayCases = loadReplayCases(replayPath, schema);

  console.log('Runtime Model Benchmark');
  console.log(`Host: ${host}`);
  console.log(`Models: ${models.join(', ')}`);
  console.log(`Schema: ${schema}`);
  console.log(`Runs/model: ${runs}`);
  console.log(`Warmup runs/model: ${warmupRuns}`);
  console.log(`Timeout: ${timeoutMs}ms`);
  console.log(`Warmup timeout: ${warmupTimeoutMs}ms`);
  console.log(`Num predict: ${numPredict}`);
  console.log(`Ollama JSON mode: ${useJsonMode ? 'on' : 'off'}`);
  console.log(`Keep alive: ${keepAlive}`);
  console.log(`Case source: ${replayCases.length ? `${replayCases.length} replay cases from ${replayPath}` : '3 preregistered synthetic cases'}`);
  console.log('');

  const results = [];
  for (const model of models) {
    console.log(`--- ${model} ---`);
    results.push(await benchmarkModel(model, {
      host,
      runs,
      timeoutMs,
      warmupRuns,
      warmupTimeoutMs,
      numPredict,
      keepResponses,
      useJsonMode,
      schema,
      keepAlive,
      replayCases
    }));
    console.log('');
  }

  const ranked = rankResults(results);
  const report = {
    generatedAt: new Date().toISOString(),
    host,
    schema,
    runsPerModel: runs,
    warmupRunsPerModel: warmupRuns,
    timeoutMs,
    warmupTimeoutMs,
    numPredict,
    useJsonMode,
    keepAlive,
    caseSource: replayCases.length ? 'historical_replay_seed' : 'preregistered_synthetic',
    replayPath,
    replayQualityWarning: replayCases.length
      ? 'Exploratory only: historical full AI packets were not persisted, and rejected cases use prior deterministic decisions as labels.'
      : null,
    ranking: ranked.map((item, index) => ({ rank: index + 1, model: item.model, ...item.summary })),
    results
  };

  writeJson(outputPath, report);
  console.log('Ranking:');
  report.ranking.forEach((row) => {
    console.log(`${row.rank}. ${row.model} ok=${row.okRate} match=${row.decisionMatchRate} falseVeto=${row.falseVetoRate} unsafeEnter=${row.unsafeEnterRate} timeout=${row.timeoutRate} p95=${row.p95LatencyMs}ms`);
  });
  console.log(`\nWrote ${outputPath}`);
}

if (require.main === module) main().catch((error) => {
  console.error(`[ERROR] Runtime model benchmark failed: ${error.message}`);
  process.exit(1);
});

module.exports = {
  benchmarkCaseAt,
  buildSyntheticCase,
  loadReplayCases,
  replayCaseToBenchmarkCase,
  summarizeModel,
  validateSchema
};
