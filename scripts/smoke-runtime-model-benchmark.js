const {
  buildSyntheticCase,
  replayCaseToBenchmarkCase,
  summarizeModel
} = require('./benchmark-runtime-models');
const { buildReport } = require('./runtime-model-readiness-report');

const synthetic = buildSyntheticCase(0, 'simple');
if (synthetic.id !== 'synthetic:runner' || synthetic.acceptableActions[0] !== 'ENTER') {
  throw new Error('Synthetic runner case lost its preregistered ENTER label.');
}

const replay = replayCaseToBenchmarkCase({
  id: 'replay:reject',
  category: 'rejected',
  token: 'mint',
  deterministicSignal: { source: 'pumpportal_create', qualityScore: 0.5, momentumScore: 0.8 },
  rejectionReasons: [{ reason: 'LOW_PUMP_MOMENTUM' }]
}, 'simple');
if (replay.acceptableActions.includes('ENTER')) {
  throw new Error('Historical rejected replay case incorrectly permits ENTER.');
}
if (JSON.stringify(replay.candidate).includes('LOW_PUMP_MOMENTUM')) {
  throw new Error('Historical rejection reason leaked into the replay candidate.');
}

const runs = ['ENTER', 'ENTER', 'ENTER'].map((action, iteration) => ({
  iteration,
  caseId: 'synthetic:runner',
  category: 'winner_like',
  acceptableActions: ['ENTER'],
  action,
  ok: true,
  validJson: true,
  schemaValid: true,
  decisionMatch: true,
  latencyMs: 500,
  tokPerSec: 100,
  extraCommentary: false,
  error: null,
  schemaErrors: []
}));
const summary = summarizeModel('fixture', runs).summary;
if (summary.decisionMatchRate !== 1 || summary.falseVetoRate !== 0) {
  throw new Error('Model benchmark summary misclassified a clean runner decision.');
}

const qualifyingSummary = {
  runs: 12,
  uniqueCases: 3,
  okRate: 1,
  timeoutRate: 0,
  decisionMatchRate: 1,
  falseVetoRate: 0,
  unsafeEnterRate: 0,
  consistentCaseRate: 1,
  p95LatencyMs: 800
};
const report = buildReport(
  { results: [{ model: 'fixture', summary: qualifyingSummary, warmups: [{ ok: true, latencyMs: 5000 }] }] },
  { results: [{ model: 'fixture', summary: { runs: 12, okRate: 1, unsafeEnterRate: 0 } }] }
);
if (report.verdict !== 'ONE_PAPER_INLINE_AUDITOR_CANDIDATE') {
  throw new Error('Readiness report failed a qualifying PAPER shadow fixture.');
}

console.log('RUNTIME_MODEL_BENCHMARK_SMOKE_OK');
