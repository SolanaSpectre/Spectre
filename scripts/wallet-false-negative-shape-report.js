const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPLAY_PATH = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-entry-replay-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-shape');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-shape-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function round(value, digits = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(digits)) : null;
}

function pct(numerator, denominator) {
  return denominator ? round(numerator / denominator, 4) : null;
}

function isWouldEnter(row) {
  return String(row.replayClass || '').startsWith('WOULD_ENTER_');
}

function pre85Touches(row) {
  return (row.touches || []).filter((touch) => ['BEFORE_FIRST_FLAG', 'BEFORE_85'].includes(touch.leadClass));
}

function classifyEarlyMix(row) {
  const pre85 = pre85Touches(row);
  const strong = pre85.filter((touch) => touch.reviewTierAtRun === 'TRUST_REVIEW');
  const avoid = pre85.filter((touch) => touch.reviewTierAtRun === 'AVOID_REVIEW');
  const watch = pre85.filter((touch) => touch.reviewTierAtRun === 'WATCH_REVIEW');
  const hold = pre85.filter((touch) => touch.reviewTierAtRun === 'HOLD');
  if (strong.length >= 2 && avoid.length === 0) return 'multi_strong_clean';
  if (strong.length >= 1 && avoid.length === 0 && watch.length === 0 && hold.length === 0) return 'single_strong_clean';
  if (strong.length >= 1 && avoid.length === 0) return 'strong_plus_neutral';
  if (strong.length >= 1 && avoid.length > 0) return 'strong_plus_avoid';
  return 'other';
}

function enrich(row) {
  const pre85 = pre85Touches(row);
  const strong = pre85.filter((touch) => touch.reviewTierAtRun === 'TRUST_REVIEW');
  const avoid = pre85.filter((touch) => touch.reviewTierAtRun === 'AVOID_REVIEW');
  const firstStrong = strong.slice().sort((a, b) => new Date(a.touchAt || 0) - new Date(b.touchAt || 0))[0] || null;
  return {
    ...row,
    earlyMix: classifyEarlyMix(row),
    pre85StrongTouchCount: strong.length,
    pre85AvoidTouchCount: avoid.length,
    firstStrongLeadSecondsTo85: firstStrong?.secondsTouchTo85 ?? null,
    firstStrongSide: firstStrong?.side || null
  };
}

function summarizeRows(rows) {
  const entered = rows.filter(isWouldEnter);
  const totalPnlSol = entered.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  return {
    rows: rows.length,
    wouldEnter: entered.length,
    noGateConfirmAfterTouch: rows.filter((row) => row.replayClass === 'NO_GATE_CONFIRM_AFTER_TOUCH').length,
    takeProfits: entered.filter((row) => row.exitReason === 'TAKE_PROFIT').length,
    endOfRun: entered.filter((row) => row.exitReason === 'END_OF_RUN').length,
    stopLosses: entered.filter((row) => row.exitReason === 'STOP_LOSS').length,
    totalPnlSol: round(totalPnlSol, 9),
    averagePnlSol: entered.length ? round(totalPnlSol / entered.length, 9) : null,
    winRate: entered.length ? pct(entered.filter((row) => row.exitReason === 'TAKE_PROFIT').length, entered.length) : null
  };
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .map(([key, group]) => [key, summarizeRows(group)])
      .sort((a, b) => Number(b[1].totalPnlSol || 0) - Number(a[1].totalPnlSol || 0))
  );
}

function buildReport(replay) {
  const rows = (replay.rows || []).map(enrich);
  return {
    summary: {
      ...summarizeRows(rows),
      cleanStrongRows: rows.filter((row) => ['single_strong_clean', 'multi_strong_clean'].includes(row.earlyMix)).length,
      contaminatedStrongRows: rows.filter((row) => row.earlyMix === 'strong_plus_avoid').length
    },
    byEarlyMix: groupBy(rows, (row) => row.earlyMix),
    byTriggerWallet: groupBy(rows, (row) => row.triggerWallet),
    byStrongTouchCount: groupBy(rows, (row) => String(row.pre85StrongTouchCount || 0)),
    byFirstStrongSide: groupBy(rows, (row) => row.firstStrongSide),
    topCleanRows: rows
      .filter((row) => ['single_strong_clean', 'multi_strong_clean'].includes(row.earlyMix))
      .sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0))
      .slice(0, 10),
    topContaminatedRows: rows
      .filter((row) => row.earlyMix === 'strong_plus_avoid')
      .sort((a, b) => Number(b.pnlSol || 0) - Number(a.pnlSol || 0))
      .slice(0, 10),
    rows
  };
}

function main() {
  const replay = readJson(REPLAY_PATH, {});
  const generatedAt = new Date().toISOString();
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_false_negative_shape',
    sources: {
      replayGeneratedAt: replay.generatedAt || null
    },
    note: 'Report-only shape split for strong wallet-led false negatives. Compares clean strong leads, strong-plus-neutral mixes, and strong-plus-avoid mixes without changing wallet weights, entries, or live behavior.',
    ...buildReport(replay)
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-false-negative-shape-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet false-negative shape report: ${reportPath}`);
  console.log(`Wrote latest wallet false-negative shape report: ${LATEST_PATH}`);
  console.log(`rows=${payload.summary.rows} clean=${payload.summary.cleanStrongRows} contaminated=${payload.summary.contaminatedStrongRows}`);
}

main();
