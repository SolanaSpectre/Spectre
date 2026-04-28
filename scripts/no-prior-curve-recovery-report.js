const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const out = path.join(ROOT, 'data', 'reports', 'no-prior-curve-recovery-latest.json');

const thresholds = {
  minScore: Number(process.env.NO_PRIOR_RECOVERY_MIN_SCORE || 75),
  minCurveProgress: Number(process.env.NO_PRIOR_RECOVERY_MIN_CURVE_PROGRESS || 0.75),
  minRecentVolumeSol: Number(process.env.NO_PRIOR_RECOVERY_MIN_RECENT_VOLUME_SOL || 75),
  minTradeVelocityPerMin: Number(process.env.NO_PRIOR_RECOVERY_MIN_TRADE_VELOCITY_PER_MIN || 50),
  minFlags: Number(process.env.NO_PRIOR_RECOVERY_MIN_FLAGS || 2),
  minNoPriorSkips: Number(process.env.NO_PRIOR_RECOVERY_MIN_NO_PRIOR_SKIPS || 1)
};

function readJson(file) {
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return []; }
}

function list(payload) {
  if (Array.isArray(payload)) return payload;
  return payload.candidates || payload.falseNegatives || payload.watchlist || payload.items || [];
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function failuresFor({ noPrior, score, curve, volume, velocity, flags }) {
  const failures = [];
  if (noPrior < thresholds.minNoPriorSkips) failures.push('LOW_NO_PRIOR_SKIPS');
  if (score < thresholds.minScore) failures.push('LOW_SCORE');
  if (curve < thresholds.minCurveProgress) failures.push('LOW_CURVE_PROGRESS');
  if (volume < thresholds.minRecentVolumeSol) failures.push('LOW_RECENT_VOLUME_SOL');
  if (velocity < thresholds.minTradeVelocityPerMin) failures.push('LOW_TRADE_VELOCITY');
  if (flags < thresholds.minFlags) failures.push('LOW_FLAG_COUNT');
  return failures;
}

function compact(item) {
  const skips = item.paperSkips || {};
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  const noPrior = num(skips.NO_PRIOR_CURVE_PROGRESS);
  const score = num(item.maxScore);
  const curve = num(item.maxCurveProgress);
  const volume = num(item.maxRecentVolumeSol);
  const velocity = num(item.maxTradeVelocityPerMin);
  const flags = num(item.flags);
  const failures = failuresFor({ noPrior, score, curve, volume, velocity, flags });
  const passed = failures.length === 0;
  return {
    label: passed ? 'RECOVERY_CANDIDATE' : 'WATCH_ONLY',
    failures,
    priority: Number((score + curve * 100 + Math.min(30, volume / 8) + Math.min(30, velocity / 4) + flags).toFixed(2)),
    symbol: item.symbol || null,
    mint: item.mint || null,
    outcome: item.outcome || null,
    maxScore: score,
    maxCurveProgress: curve,
    maxRecentVolumeSol: volume,
    maxTradeVelocityPerMin: velocity,
    flags,
    noPriorSkips: noPrior,
    curveNotAdvancingSkips: num(skips.CURVE_NOT_ADVANCING),
    secondsFlagTo85: item.secondsFlagTo85 ?? null,
    signals: reasons.filter((r) => ['repeat_early_buyers','recent_volume','moderate_trade_velocity','fast_trade_velocity','buyer_spread_building','confirmed'].includes(r))
  };
}

const items = list(readJson(src)).map(compact).sort((a, b) => b.priority - a.priority);
const recovery = items.filter((x) => x.label === 'RECOVERY_CANDIDATE');
const watchOnly = items.filter((x) => x.label !== 'RECOVERY_CANDIDATE');
const failureCounts = {};
for (const item of watchOnly) {
  for (const failure of item.failures) {
    failureCounts[failure] = (failureCounts[failure] || 0) + 1;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'report_only',
  thresholds,
  summary: {
    sourceCount: items.length,
    recoveryCount: recovery.length,
    watchOnlyCount: watchOnly.length,
    failureCounts
  },
  recovery,
  watchOnly
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));
for (const item of watchOnly) {
  console.log(`${item.symbol || 'UNKNOWN'} ${item.outcome || ''} failures=${item.failures.join(',') || 'none'} score=${item.maxScore} curve=${item.maxCurveProgress} vol=${item.maxRecentVolumeSol} vel=${item.maxTradeVelocityPerMin} flags=${item.flags} noPrior=${item.noPriorSkips}`);
}
console.log(`Wrote ${path.relative(ROOT, out)}`);
