const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const STABILITY_PATH = path.join(ROOT, 'data', 'reports', 'wallet-timeblocked-stability-latest.json');
const WALLET_EVENTS_PATH = path.join(ROOT, 'data', 'wallet-events', 'events.jsonl');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-bridge');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-bridge-latest.json');

const STRONG_TIERS = new Set(['TRUST_REVIEW']);
const POSITIVE_OUTCOMES = new Set(['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85', 'PAPER_WIN']);

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

function canonicalName(name, walletAddress) {
  const label = String(name || walletAddress || '').trim();
  if (/^Cupsey(?:\s+\d+)?$/i.test(label)) return 'Cupsey';
  return label || walletAddress;
}

function compareIso(a, b) {
  return new Date(a || 0).getTime() - new Date(b || 0).getTime();
}

function secondsBetween(start, end) {
  const deltaMs = new Date(end || 0).getTime() - new Date(start || 0).getTime();
  return Number.isFinite(deltaMs) ? Number((deltaMs / 1000).toFixed(3)) : null;
}

function firstTouchesByMint(walletEvents) {
  const firstByWalletMint = new Map();
  for (const event of walletEvents) {
    if (!event.wallet || !event.mint) continue;
    const canonicalWallet = canonicalName(event.walletProfile?.name, event.wallet);
    const key = `${canonicalWallet}:${event.mint}`;
    const prior = firstByWalletMint.get(key);
    if (!prior || compareIso(event.tradeAt || event.observedAt, prior.tradeAt || prior.observedAt) < 0) {
      firstByWalletMint.set(key, { ...event, canonicalWallet });
    }
  }
  const byMint = new Map();
  for (const touch of firstByWalletMint.values()) {
    if (!byMint.has(touch.mint)) byMint.set(touch.mint, []);
    byMint.get(touch.mint).push(touch);
  }
  return byMint;
}

function stabilityRowsByMint(stability) {
  const byMint = new Map();
  for (const row of stability?.rows || []) {
    if (!row.mint || !row.canonicalWallet) continue;
    if (!byMint.has(row.mint)) byMint.set(row.mint, []);
    byMint.get(row.mint).push(row);
  }
  return byMint;
}

function leadClass(touchAt, candidate) {
  if (!touchAt) return 'UNKNOWN';
  if (candidate.firstFlagAt && compareIso(touchAt, candidate.firstFlagAt) <= 0) return 'BEFORE_FIRST_FLAG';
  if (candidate.curve85At && compareIso(touchAt, candidate.curve85At) <= 0) return 'BEFORE_85';
  if (candidate.curve95At && compareIso(touchAt, candidate.curve95At) <= 0) return 'BEFORE_95';
  return 'AFTER_95_OR_UNKNOWN';
}

function buildCandidate(candidate, touches, rows) {
  const rowsByWallet = new Map(rows.map((row) => [row.canonicalWallet, row]));
  const joinedTouches = touches.map((touch) => {
    const touchAt = touch.tradeAt || touch.observedAt || null;
    const row = rowsByWallet.get(touch.canonicalWallet) || null;
    return {
      canonicalWallet: touch.canonicalWallet,
      touchAt,
      side: touch.side || null,
      reviewTierAtRun: row?.reviewTierAtRun || null,
      evidenceTier: row?.evidenceTier || null,
      leadClass: leadClass(touchAt, candidate),
      secondsTouchToFirstFlag: candidate.firstFlagAt ? secondsBetween(touchAt, candidate.firstFlagAt) : null,
      secondsTouchTo85: candidate.curve85At ? secondsBetween(touchAt, candidate.curve85At) : null,
      secondsTouchTo95: candidate.curve95At ? secondsBetween(touchAt, candidate.curve95At) : null
    };
  });
  const pre85Touches = joinedTouches.filter((touch) => ['BEFORE_FIRST_FLAG', 'BEFORE_85'].includes(touch.leadClass));
  const strongPre85Touches = pre85Touches.filter((touch) => STRONG_TIERS.has(touch.reviewTierAtRun));
  const positiveOutcome = POSITIVE_OUTCOMES.has(candidate.outcome);
  const skippedWinner = positiveOutcome && Number(candidate.paperEntries || 0) === 0;
  return {
    mint: candidate.mint,
    symbol: candidate.symbol || null,
    outcome: candidate.outcome || null,
    falseNegativePriority: candidate.falseNegativePriority ?? null,
    paperEntries: candidate.paperEntries || 0,
    maxScore: candidate.maxScore ?? null,
    maxCurveProgress: candidate.maxCurveProgress ?? null,
    walletTouchCount: joinedTouches.length,
    pre85WalletTouchCount: pre85Touches.length,
    strongPre85WalletTouchCount: strongPre85Touches.length,
    walletLedMiss: skippedWinner && pre85Touches.length > 0,
    strongWalletLedMiss: skippedWinner && strongPre85Touches.length > 0,
    leadWallets: pre85Touches.map((touch) => touch.canonicalWallet),
    strongLeadWallets: strongPre85Touches.map((touch) => touch.canonicalWallet),
    touches: joinedTouches
  };
}

function buildReport(falseNegative, stability, walletEvents) {
  const touchesByMint = firstTouchesByMint(walletEvents);
  const rowsByMint = stabilityRowsByMint(stability);
  const rows = (falseNegative?.watchlist || []).map((candidate) => buildCandidate(
    candidate,
    touchesByMint.get(candidate.mint) || [],
    rowsByMint.get(candidate.mint) || []
  ));
  const walletTouched = rows.filter((row) => row.walletTouchCount > 0);
  const pre85Touched = rows.filter((row) => row.pre85WalletTouchCount > 0);
  const walletLedMisses = rows.filter((row) => row.walletLedMiss);
  const strongWalletLedMisses = rows.filter((row) => row.strongWalletLedMiss);
  return {
    summary: {
      falseNegativeCandidates: rows.length,
      walletTouchedCandidates: walletTouched.length,
      pre85WalletTouchedCandidates: pre85Touched.length,
      walletLedMisses: walletLedMisses.length,
      strongWalletLedMisses: strongWalletLedMisses.length
    },
    topWalletLedMisses: walletLedMisses.slice().sort((a, b) => Number(b.falseNegativePriority || 0) - Number(a.falseNegativePriority || 0)).slice(0, 20),
    topStrongWalletLedMisses: strongWalletLedMisses.slice().sort((a, b) => Number(b.falseNegativePriority || 0) - Number(a.falseNegativePriority || 0)).slice(0, 20),
    rows
  };
}

function main() {
  const falseNegative = readJson(FALSE_NEGATIVE_PATH, {});
  const stability = readJson(STABILITY_PATH, {});
  const walletEvents = readJsonl(WALLET_EVENTS_PATH);
  const generatedAt = new Date().toISOString();
  const report = buildReport(falseNegative, stability, walletEvents);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_false_negative_bridge',
    note: 'Report-only bridge from skipped positive outcomes to wallet timing. walletLedMiss requires a wallet touch before 85% curve progress; strongWalletLedMiss additionally requires a time-blocked TRUST_REVIEW wallet before 85%.',
    sources: {
      falseNegativeGeneratedAt: falseNegative.generatedAt || null,
      stabilityGeneratedAt: stability.generatedAt || null,
      walletEventCount: walletEvents.length
    },
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-false-negative-bridge-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet false-negative bridge report: ${reportPath}`);
  console.log(`Wrote latest wallet false-negative bridge report: ${LATEST_PATH}`);
  console.log(`candidates=${payload.summary.falseNegativeCandidates} walletLed=${payload.summary.walletLedMisses} strongWalletLed=${payload.summary.strongWalletLedMisses}`);
}

main();
