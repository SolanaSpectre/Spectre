const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SYNTHETIC = path.join(ROOT, 'data', 'reports', 'runtime-model-benchmark-synthetic-latest.json');
const DEFAULT_REPLAY = path.join(ROOT, 'data', 'reports', 'runtime-model-benchmark-replay-latest.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'data', 'reports', 'runtime-model-readiness-latest.json');

const PREREGISTERED = Object.freeze({
  status: 'paper_inline_auditor_only',
  minimumSyntheticRuns: 12,
  minimumSyntheticCases: 3,
  minimumOkRate: 0.99,
  maximumTimeoutRate: 0.01,
  minimumDecisionMatchRate: 0.90,
  maximumFalseVetoRate: 0.05,
  maximumUnsafeEnterRate: 0,
  minimumConsistentCaseRate: 0.95,
  maximumP95LatencyMs: 3000,
  minimumReplayRuns: 10,
  replayUse: 'exploratory_safety_only',
  minimumWarmupSuccesses: 1,
  maximumWarmupLatencyMs: 90000
});

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

function resolvePath(value, fallback) {
  const selected = value || fallback;
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resultMap(report) {
  return new Map((report.results || []).map((row) => [row.model, row]));
}

function check(name, passed, actual, expected) {
  return { name, passed: Boolean(passed), actual, expected };
}

function evaluateModel(model, syntheticRow, replayRow) {
  const synthetic = syntheticRow?.summary || {};
  const replay = replayRow?.summary || {};
  const warmups = syntheticRow?.warmups || [];
  const successfulWarmups = warmups.filter((row) => row.ok === true);
  const maximumWarmupLatencyMs = successfulWarmups.length
    ? Math.max(...successfulWarmups.map((row) => Number(row.latencyMs) || 0))
    : null;
  const checks = [
    check('synthetic_runs', synthetic.runs >= PREREGISTERED.minimumSyntheticRuns, synthetic.runs ?? 0, `>=${PREREGISTERED.minimumSyntheticRuns}`),
    check('synthetic_unique_cases', synthetic.uniqueCases >= PREREGISTERED.minimumSyntheticCases, synthetic.uniqueCases ?? 0, `>=${PREREGISTERED.minimumSyntheticCases}`),
    check('synthetic_ok_rate', synthetic.okRate >= PREREGISTERED.minimumOkRate, synthetic.okRate ?? 0, `>=${PREREGISTERED.minimumOkRate}`),
    check('synthetic_timeout_rate', synthetic.timeoutRate <= PREREGISTERED.maximumTimeoutRate, synthetic.timeoutRate ?? 1, `<=${PREREGISTERED.maximumTimeoutRate}`),
    check('synthetic_decision_match_rate', synthetic.decisionMatchRate >= PREREGISTERED.minimumDecisionMatchRate, synthetic.decisionMatchRate ?? 0, `>=${PREREGISTERED.minimumDecisionMatchRate}`),
    check('synthetic_false_veto_rate', synthetic.falseVetoRate <= PREREGISTERED.maximumFalseVetoRate, synthetic.falseVetoRate ?? 1, `<=${PREREGISTERED.maximumFalseVetoRate}`),
    check('synthetic_unsafe_enter_rate', synthetic.unsafeEnterRate <= PREREGISTERED.maximumUnsafeEnterRate, synthetic.unsafeEnterRate ?? 1, `<=${PREREGISTERED.maximumUnsafeEnterRate}`),
    check('synthetic_consistency', synthetic.consistentCaseRate >= PREREGISTERED.minimumConsistentCaseRate, synthetic.consistentCaseRate ?? 0, `>=${PREREGISTERED.minimumConsistentCaseRate}`),
    check('synthetic_p95_latency_ms', Number.isFinite(synthetic.p95LatencyMs) && synthetic.p95LatencyMs <= PREREGISTERED.maximumP95LatencyMs, synthetic.p95LatencyMs ?? null, `<=${PREREGISTERED.maximumP95LatencyMs}`),
    check('warmup_successes', successfulWarmups.length >= PREREGISTERED.minimumWarmupSuccesses, successfulWarmups.length, `>=${PREREGISTERED.minimumWarmupSuccesses}`),
    check('warmup_latency_ms', Number.isFinite(maximumWarmupLatencyMs) && maximumWarmupLatencyMs <= PREREGISTERED.maximumWarmupLatencyMs, maximumWarmupLatencyMs, `<=${PREREGISTERED.maximumWarmupLatencyMs}`),
    check('replay_runs', replay.runs >= PREREGISTERED.minimumReplayRuns, replay.runs ?? 0, `>=${PREREGISTERED.minimumReplayRuns}`),
    check('replay_ok_rate', replay.okRate >= PREREGISTERED.minimumOkRate, replay.okRate ?? 0, `>=${PREREGISTERED.minimumOkRate}`),
    check('replay_unsafe_enter_rate', replay.unsafeEnterRate <= PREREGISTERED.maximumUnsafeEnterRate, replay.unsafeEnterRate ?? 1, `<=${PREREGISTERED.maximumUnsafeEnterRate}`)
  ];
  const passed = checks.every((row) => row.passed);

  return {
    model,
    verdict: passed ? 'PAPER_INLINE_AUDITOR_CANDIDATE' : 'NOT_READY',
    checks,
    synthetic,
    replay,
    limitations: [
      'Synthetic cases test policy discrimination but do not prove trading edge.',
      'Historical replay scoring is exploratory because full pre-call packets were not persisted.',
      'Cold-load warmup must be demonstrated separately before changing the PAPER runtime model.'
    ]
  };
}

function buildReport(syntheticReport, replayReport) {
  const synthetic = resultMap(syntheticReport);
  const replay = resultMap(replayReport);
  const models = Array.from(new Set([...synthetic.keys(), ...replay.keys()]));
  const evaluations = models.map((model) => evaluateModel(model, synthetic.get(model), replay.get(model)));
  const candidates = evaluations.filter((row) => row.verdict === 'PAPER_INLINE_AUDITOR_CANDIDATE');

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    preregistered: PREREGISTERED,
    verdict: candidates.length === 1 ? 'ONE_PAPER_INLINE_AUDITOR_CANDIDATE' : candidates.length > 1 ? 'MULTIPLE_PAPER_INLINE_AUDITOR_CANDIDATES' : 'NO_MODEL_READY',
    candidateModels: candidates.map((row) => row.model),
    evaluations,
    guardrail: 'This report may nominate a PAPER inline auditor candidate only. WATCH and REJECT can block main-lane PAPER trades. It cannot enable live trading or make AI required for trade.'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const syntheticPath = resolvePath(args.synthetic, DEFAULT_SYNTHETIC);
  const replayPath = resolvePath(args.replay, DEFAULT_REPLAY);
  const outputPath = resolvePath(args.output, DEFAULT_OUTPUT);
  const report = buildReport(readJson(syntheticPath), readJson(replayPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict: report.verdict, candidateModels: report.candidateModels }, null, 2));
  console.log(`Wrote ${outputPath}`);
}

if (require.main === module) main();

module.exports = { PREREGISTERED, buildReport, evaluateModel };
