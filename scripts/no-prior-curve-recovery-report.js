const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const out = path.join(ROOT, 'data', 'reports', 'no-prior-curve-recovery-latest.json');

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

function compact(item) {
  const skips = item.paperSkips || {};
  const reasons = Array.isArray(item.reasons) ? item.reasons : [];
  const noPrior = num(skips.NO_PRIOR_CURVE_PROGRESS);
  const score = num(item.maxScore);
  const curve = num(item.maxCurveProgress);
  const volume = num(item.maxRecentVolumeSol);
  const velocity = num(item.maxTradeVelocityPerMin);
  const flags = num(item.flags);
  const passed = noPrior > 0 && score >= 75 && curve >= 0.75 && volume >= 75 && velocity >= 50 && flags >= 2;
  return {
    label: passed ? 'RECOVERY_CANDIDATE' : 'WATCH_ONLY',
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
const report = {
  generatedAt: new Date().toISOString(),
  mode: 'report_only',
  thresholds: { minScore: 75, minCurveProgress: 0.75, minRecentVolumeSol: 75, minTradeVelocityPerMin: 50, minFlags: 2 },
  summary: {
    sourceCount: items.length,
    recoveryCount: items.filter((x) => x.label === 'RECOVERY_CANDIDATE').length,
    watchOnlyCount: items.filter((x) => x.label !== 'RECOVERY_CANDIDATE').length
  },
  recovery: items.filter((x) => x.label === 'RECOVERY_CANDIDATE'),
  watchOnly: items.filter((x) => x.label !== 'RECOVERY_CANDIDATE')
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Wrote ${path.relative(ROOT, out)}`);
