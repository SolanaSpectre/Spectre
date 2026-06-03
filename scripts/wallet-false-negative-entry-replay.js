const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BRIDGE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-bridge-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-entry-replay');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-entry-replay-latest.json');

const STRATEGY = {
  minScore: 75,
  minCurveProgress: 0.7,
  minRecentVolumeSol: 25,
  minTradeVelocityPerMin: 25,
  takeProfitPct: 0.5,
  stopLossPct: 0.25,
  maxHoldSeconds: 600,
  amountSol: 0.1,
  stressExtraSlippagePct: 3
};

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function numberOrNull(value, digits = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return digits === null ? numeric : Number(numeric.toFixed(digits));
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function secondsBetween(start, end) {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  return Number.isFinite(startMs) && Number.isFinite(endMs)
    ? numberOrNull((endMs - startMs) / 1000, 3)
    : null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function priceOf(payload) {
  const direct = numberOrNull(payload.bondingCurvePriceSol ?? payload.priceSol ?? payload.curvePriceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = numberOrNull(payload.virtualSolReservesSol);
  const tokens = numberOrNull(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
}

function telemetryFiles() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => path.join(LOG_DIR, name));
}

function buildSamplesByMint(mints) {
  const wanted = new Set(mints);
  const samples = new Map();
  const sourceFiles = new Map();
  for (const filePath of telemetryFiles()) {
    const events = readJsonl(filePath);
    let fileHit = false;
    for (const event of events) {
      const payload = payloadOf(event);
      const mint = mintOf(payload);
      if (!wanted.has(mint)) continue;
      const timestamp = payload.timestamp || event.timestamp || null;
      const priceSol = priceOf(payload);
      if (!timestamp || !Number.isFinite(priceSol) || priceSol <= 0) continue;
      if (!samples.has(mint)) samples.set(mint, []);
      samples.get(mint).push({
        timestamp,
        priceSol,
        score: numberOrNull(payload.score, 4),
        curveProgress: numberOrNull(payload.curveProgress, 6),
        recentVolumeSol: numberOrNull(payload.recentVolumeSol, 6),
        tradeVelocityPerMin: numberOrNull(payload.tradeVelocityPerMin, 6)
      });
      fileHit = true;
      sourceFiles.set(mint, path.basename(filePath));
    }
    if (fileHit) continue;
  }
  for (const rows of samples.values()) rows.sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
  return { samples, sourceFiles };
}

function firstStrongTouch(row) {
  return (row.touches || [])
    .filter((touch) => touch.reviewTierAtRun === 'TRUST_REVIEW' && ['BEFORE_FIRST_FLAG', 'BEFORE_85'].includes(touch.leadClass))
    .sort((a, b) => timestampMs(a.touchAt) - timestampMs(b.touchAt))[0] || null;
}

function passesGate(sample) {
  return Number(sample.score) >= STRATEGY.minScore
    && Number(sample.curveProgress) >= STRATEGY.minCurveProgress
    && Number(sample.recentVolumeSol) >= STRATEGY.minRecentVolumeSol
    && Number(sample.tradeVelocityPerMin) >= STRATEGY.minTradeVelocityPerMin
    && Number(sample.priceSol) > 0;
}

function simulateExit(entry, samples) {
  let latest = entry;
  for (const sample of samples.filter((item) => timestampMs(item.timestamp) >= timestampMs(entry.timestamp))) {
    latest = sample;
    const returnPct = (sample.priceSol - entry.priceSol) / entry.priceSol;
    if (returnPct >= STRATEGY.takeProfitPct) return buildExit(entry, sample, 'TAKE_PROFIT');
    if (returnPct <= -STRATEGY.stopLossPct) return buildExit(entry, sample, 'STOP_LOSS');
    if (secondsBetween(entry.timestamp, sample.timestamp) >= STRATEGY.maxHoldSeconds) return buildExit(entry, sample, 'MAX_HOLD');
  }
  return buildExit(entry, latest, 'END_OF_RUN');
}

function buildExit(entry, exit, exitReason) {
  const returnPct = (exit.priceSol - entry.priceSol) / entry.priceSol;
  const stressReturnPct = returnPct - (STRATEGY.stressExtraSlippagePct / 100);
  return {
    exitReason,
    exitAt: exit.timestamp,
    exitPriceSol: numberOrNull(exit.priceSol, 12),
    holdSeconds: secondsBetween(entry.timestamp, exit.timestamp),
    returnPct: numberOrNull(returnPct, 6),
    pnlSol: numberOrNull(STRATEGY.amountSol * returnPct, 9),
    stressReturnPct: numberOrNull(stressReturnPct, 6),
    stressedPnlSol: numberOrNull(STRATEGY.amountSol * stressReturnPct, 9)
  };
}

function replayRow(row, samples, sourceFile) {
  const touch = firstStrongTouch(row);
  if (!touch) return { ...row, replayClass: 'NO_STRONG_TOUCH', sourceFile: sourceFile || null };
  const afterTouch = samples.filter((sample) => timestampMs(sample.timestamp) >= timestampMs(touch.touchAt));
  const entry = afterTouch.find(passesGate) || null;
  if (!entry) {
    return {
      ...row,
      sourceFile: sourceFile || null,
      triggerWallet: touch.canonicalWallet,
      triggerAt: touch.touchAt,
      replayClass: 'NO_GATE_CONFIRM_AFTER_TOUCH'
    };
  }
  const exit = simulateExit(entry, afterTouch);
  return {
    ...row,
    sourceFile: sourceFile || null,
    triggerWallet: touch.canonicalWallet,
    triggerAt: touch.touchAt,
    secondsTouchToEntry: secondsBetween(touch.touchAt, entry.timestamp),
    replayClass: `WOULD_ENTER_${exit.exitReason}`,
    entryAt: entry.timestamp,
    entryPriceSol: numberOrNull(entry.priceSol, 12),
    entryScore: entry.score,
    entryCurveProgress: entry.curveProgress,
    entryRecentVolumeSol: entry.recentVolumeSol,
    entryTradeVelocityPerMin: entry.tradeVelocityPerMin,
    ...exit
  };
}

function summarize(rows) {
  const entered = rows.filter((row) => String(row.replayClass || '').startsWith('WOULD_ENTER_'));
  const wins = entered.filter((row) => row.exitReason === 'TAKE_PROFIT');
  const totalPnlSol = entered.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const stressedPnlSol = entered.reduce((sum, row) => sum + Number(row.stressedPnlSol || 0), 0);
  const sortedByEntry = entered.slice().sort((a, b) => timestampMs(a.entryAt) - timestampMs(b.entryAt));
  const splitIndex = Math.ceil(sortedByEntry.length / 2);
  const firstHalfPnlSol = sortedByEntry.slice(0, splitIndex).reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const secondHalfPnlSol = sortedByEntry.slice(splitIndex).reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const sortedWinners = entered.filter((row) => Number(row.pnlSol) > 0).sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol));
  const grossWinnerPnlSol = sortedWinners.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const topWinnerPnlSol = sortedWinners[0] ? Number(sortedWinners[0].pnlSol || 0) : 0;
  const top3WinnerPnlSol = sortedWinners.slice(0, 3).reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  const pnlAfterTopWinnerSol = totalPnlSol - topWinnerPnlSol;
  const pnlAfterTop3WinnersSol = totalPnlSol - top3WinnerPnlSol;
  const verdict = classifySummary({
    entered: entered.length,
    totalPnlSol,
    stressedPnlSol,
    winRate: entered.length ? wins.length / entered.length : null,
    firstHalfPnlSol,
    secondHalfPnlSol,
    pnlAfterTopWinnerSol,
    pnlAfterTop3WinnersSol
  });
  return {
    strongWalletLedMisses: rows.length,
    wouldEnter: entered.length,
    noGateConfirmAfterTouch: rows.filter((row) => row.replayClass === 'NO_GATE_CONFIRM_AFTER_TOUCH').length,
    takeProfits: wins.length,
    stopLosses: entered.filter((row) => row.exitReason === 'STOP_LOSS').length,
    maxHolds: entered.filter((row) => row.exitReason === 'MAX_HOLD').length,
    endOfRun: entered.filter((row) => row.exitReason === 'END_OF_RUN').length,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    stressedPnlSol: numberOrNull(stressedPnlSol, 9),
    averagePnlSol: entered.length ? numberOrNull(totalPnlSol / entered.length, 9) : null,
    winRate: entered.length ? numberOrNull(wins.length / entered.length, 4) : null,
    firstHalfPnlSol: entered.length ? numberOrNull(firstHalfPnlSol, 9) : null,
    secondHalfPnlSol: entered.length > 1 ? numberOrNull(secondHalfPnlSol, 9) : null,
    grossWinnerPnlSol: numberOrNull(grossWinnerPnlSol, 9),
    topWinnerPnlSol: numberOrNull(topWinnerPnlSol, 9),
    top3WinnerPnlSol: numberOrNull(top3WinnerPnlSol, 9),
    pnlAfterTopWinnerSol: numberOrNull(pnlAfterTopWinnerSol, 9),
    pnlAfterTop3WinnersSol: numberOrNull(pnlAfterTop3WinnersSol, 9),
    topWinnerShareOfGrossProfit: grossWinnerPnlSol > 0 ? numberOrNull(topWinnerPnlSol / grossWinnerPnlSol, 4) : null,
    verdict,
    shadowLaneEligible: verdict === 'PROMISING',
    verdictReason: verdictReason(verdict)
  };
}

function classifySummary(summary) {
  if (summary.entered < 20) return 'INSUFFICIENT_SAMPLE';
  if (summary.totalPnlSol <= 0 || summary.stressedPnlSol <= 0) return 'NEGATIVE';
  if (summary.winRate < 0.45) return 'INCONCLUSIVE_LOW_WIN_RATE';
  if (summary.firstHalfPnlSol <= 0 || summary.secondHalfPnlSol <= 0) return 'INCONCLUSIVE_UNSTABLE_SPLIT';
  if (summary.pnlAfterTopWinnerSol <= 0 || summary.pnlAfterTop3WinnersSol <= 0) return 'INCONCLUSIVE_WINNER_CONCENTRATED';
  return 'PROMISING';
}

function verdictReason(verdict) {
  switch (verdict) {
    case 'PROMISING':
      return 'Sample clears positive/stressed PnL, win-rate, split-half, and winner-concentration checks.';
    case 'INSUFFICIENT_SAMPLE':
      return 'Fewer than 20 hypothetical entries; keep collecting report-only evidence before creating a runtime shadow lane.';
    case 'NEGATIVE':
      return 'Raw or stressed PnL is non-positive.';
    case 'INCONCLUSIVE_LOW_WIN_RATE':
      return 'PnL is positive but win rate is below the durability threshold.';
    case 'INCONCLUSIVE_UNSTABLE_SPLIT':
      return 'PnL is positive but does not persist across split halves.';
    case 'INCONCLUSIVE_WINNER_CONCENTRATED':
      return 'PnL is positive but depends too heavily on the largest winners.';
    default:
      return 'Replay did not meet shadow-lane durability requirements.';
  }
}

function main() {
  const bridge = readJson(BRIDGE_PATH, {});
  const candidates = bridge.topStrongWalletLedMisses || [];
  const { samples, sourceFiles } = buildSamplesByMint(candidates.map((row) => row.mint));
  const rows = candidates.map((row) => replayRow(row, samples.get(row.mint) || [], sourceFiles.get(row.mint)));
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_false_negative_entry_replay',
    sources: {
      bridgeGeneratedAt: bridge.generatedAt || null
    },
    strategy: STRATEGY,
    criteria: {
      promising: '>=20 hypothetical entries, positive raw/stressed PnL, winRate >=45%, both split halves positive, and PnL remains positive after removing top-1 and top-3 winners.',
      insufficientSample: '<20 hypothetical entries.',
      caveat: 'Report-only replay; still not a quote-fill, MEV, liquidity, or broadcast-latency model.'
    },
    note: 'Report-only replay. A strong wallet-led miss only becomes a hypothetical entry after the existing score/curve/volume/velocity gate is satisfied after the first strong wallet touch. Does not change entries, wallet weighting, or live behavior.',
    summary: summarize(rows),
    topWouldWinners: rows.filter((row) => row.pnlSol !== null && row.pnlSol !== undefined).slice().sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol)).slice(0, 10),
    topWouldLosers: rows.filter((row) => row.pnlSol !== null && row.pnlSol !== undefined).slice().sort((a, b) => Number(a.pnlSol) - Number(b.pnlSol)).slice(0, 10),
    rows
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-false-negative-entry-replay-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet false-negative entry replay: ${reportPath}`);
  console.log(`Wrote latest wallet false-negative entry replay: ${LATEST_PATH}`);
  console.log(`strongMisses=${payload.summary.strongWalletLedMisses} wouldEnter=${payload.summary.wouldEnter} pnl=${payload.summary.totalPnlSol}`);
}

main();
