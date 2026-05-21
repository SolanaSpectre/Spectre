const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'data', 'reports', 'latest-run-summary.txt');

const FILES = {
  battlefield: 'data/reports/run-battlefield-latest.json',
  simpleRuntimeAiEvidence: 'data/reports/simple-runtime-ai-evidence-latest.json',
  outcomeLedger: 'data/reports/outcome-ledger-latest.json',
  falseNegatives: 'data/watchlists/outcome-ledger-false-negative-latest.json',
  preMigrationOutcomes: 'data/reports/pre-migration-outcomes-latest.json',
  preMigrationPaper: 'data/reports/pre-migration-paper-sim-latest.json',
  preMigrationEntryLossAttribution: 'data/reports/pre-migration-entry-loss-attribution-latest.json',
  preMigrationEntryParity: 'data/reports/pre-migration-entry-parity-latest.json',
  preMigrationDelayedEntryTiming: 'data/reports/pre-migration-delayed-entry-timing-latest.json',
  preMigrationDelayedEntryPressureShadow: 'data/reports/pre-migration-delayed-entry-pressure-shadow-latest.json',
  preMigrationDelayedEntryRecheck: 'data/reports/pre-migration-delayed-entry-recheck-latest.json',
  preMigrationSimStrategyDelta: 'data/reports/pre-migration-sim-strategy-delta-latest.json',
  preMigrationSimRuntimeDivergenceTrend: 'data/reports/pre-migration-sim-runtime-divergence-trend-latest.json',
  preMigrationEntryTimingPressure: 'data/reports/pre-migration-entry-timing-pressure-latest.json',
  preMigrationRollingEntryTrend: 'data/reports/pre-migration-rolling-entry-trend-latest.json',
  preMigrationEntryShape: 'data/reports/pre-migration-entry-shape-latest.json',
  signalQuality: 'data/reports/pre-migration-signal-quality-latest.json',
  learning: 'data/reports/learning-orchestrator-latest.json',
  continuationPaper: 'data/reports/continuation-paper-latest.json',
  continuationExitReplay: 'data/reports/continuation-exit-replay-latest.json',
  continuationSlippageDecomposition: 'data/reports/continuation-slippage-decomposition-latest.json',
  noPriorRecovery: 'data/reports/no-prior-curve-recovery-latest.json',
  noPriorReplay: 'data/reports/no-prior-replay-latest.json',
  noPriorHistoricalReplay: 'data/reports/no-prior-historical-replay-latest.json',
  noPriorFirstObservedCurve: 'data/reports/no-prior-first-observed-curve-latest.json',
  noPriorFirstObservedCurveLatency: 'data/reports/no-prior-first-observed-curve-latency-latest.json',
  noPriorBondingCurveNullStateLatency: 'data/reports/no-prior-bonding-curve-null-state-latency-latest.json',
  noPriorFirstUpdateLatencyDecomposition: 'data/reports/no-prior-first-update-latency-decomposition-latest.json',
  noPriorPaperDecisionCurveSource: 'data/reports/no-prior-paper-decision-curve-source-latest.json',
  noPriorDecisionTimeAlternativeState: 'data/reports/no-prior-decision-time-alternative-state-latest.json',
  noPriorDecisionTimeStateAge: 'data/reports/no-prior-decision-time-state-age-latest.json',
  noPriorFollowThrough: 'data/reports/no-prior-follow-through-latest.json',
  noPriorDelayedEntry: 'data/reports/no-prior-delayed-entry-replay-latest.json',
  runnerRaydiumShadow: 'data/reports/runner-raydium-shadow-latest.json',
  runnerRaydiumShadowFixedHorizon: 'data/reports/runner-raydium-shadow-fixed-horizon-latest.json',
  runnerRaydiumShadowHistoricalHorizon: 'data/reports/runner-raydium-shadow-historical-horizon-latest.json',
  runnerRaydiumShadowOutcomeJoin: 'data/reports/runner-raydium-shadow-outcome-join-latest.json',
  walletFirstTouchOutcomeCorr: 'data/reports/wallet-first-touch-outcome-corr-latest.json',
  walletSniperCrowdedReplay: 'data/reports/wallet-sniper-crowded-replay-latest.json',
  walletPnlEvidence: 'data/reports/wallet-pnl-evidence-latest.json',
  walletPromotionReview: 'data/reports/wallet-promotion-review-latest.json',
  walletReviewOutcomeLift: 'data/reports/wallet-review-outcome-lift-latest.json',
  walletPerWalletLift: 'data/reports/wallet-per-wallet-lift-latest.json',
  walletDaumenCohort: 'data/reports/wallet-daumen-cohort-latest.json',
  walletHistoricalRetrospective: 'data/reports/wallet-historical-run-retrospective-latest.json',
  walletCoalition: 'data/reports/wallet-coalition-latest.json',
  walletTimeblockedStability: 'data/reports/wallet-timeblocked-stability-latest.json',
  walletPaperEntryConditional: 'data/reports/wallet-paper-entry-conditional-latest.json',
  walletFalseNegativeBridge: 'data/reports/wallet-false-negative-bridge-latest.json',
  walletFalseNegativeEntryReplay: 'data/reports/wallet-false-negative-entry-replay-latest.json',
  walletFalseNegativeShape: 'data/reports/wallet-false-negative-shape-latest.json'
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function repoPath(relativePath) {
  return path.join(REPO_ROOT, relativePath);
}

function readJson(relativePath) {
  const filePath = repoPath(relativePath);
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, path: relativePath, error: 'missing file', data: null };
    }
    return {
      ok: true,
      path: relativePath,
      error: null,
      data: JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
    };
  } catch (error) {
    return { ok: false, path: relativePath, error: error.message, data: null };
  }
}

function resolveRepoFile(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function get(obj, paths, fallback = null) {
  const candidates = Array.isArray(paths) ? paths : [paths];
  for (const candidate of candidates) {
    const parts = String(candidate).split('.');
    let current = obj;
    let found = true;
    for (const part of parts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        found = false;
        break;
      }
    }
    if (found && current !== undefined && current !== null) return current;
  }
  return fallback;
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numericStats(values = []) {
  const sorted = values
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length) {
    return { count: 0, min: null, median: null, p90: null, max: null };
  }
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    p90: pick(0.9),
    max: sorted[sorted.length - 1]
  };
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number(n.toFixed(digits)).toString();
}

function ms(value, digits = 0) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const n = Number(value);
  return Number.isFinite(n) ? `${fmt(n, digits)}ms` : 'n/a';
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${Number((n * 100).toFixed(digits))}%`;
}

function sol(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)} SOL`;
}

function money(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}$${n.toFixed(digits)}`;
}

function compactValue(value) {
  if (value === null || value === undefined || value === '') return 'n/a';
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value !== 'object') return String(value);
  const parts = Object.entries(value)
    .filter(([, child]) => child === null || typeof child !== 'object')
    .slice(0, 5)
    .map(([key, child]) => `${key}=${child}`);
  return parts.length ? parts.join(', ') : `${Object.keys(value).length} field(s)`;
}

function topArray(value, limit = 5) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function objectLines(obj, limit = 12) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['none'];
  const entries = Object.entries(obj)
    .sort((a, b) => number(b[1], 0) - number(a[1], 0))
    .slice(0, limit);
  return entries.length ? entries.map(([k, v]) => `${k}: ${compactValue(v)}`) : ['none'];
}

function findArrayDeep(obj, keyHints = []) {
  const queue = [{ value: obj, path: '' }];
  const matches = [];
  while (queue.length) {
    const { value, path: p } = queue.shift();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      if (value.length && keyHints.some((hint) => p.toLowerCase().includes(hint.toLowerCase()))) {
        matches.push({ path: p, value });
      }
      value.slice(0, 20).forEach((item, index) => queue.push({ value: item, path: `${p}[${index}]` }));
      continue;
    }
    Object.entries(value).forEach(([key, child]) => queue.push({ value: child, path: p ? `${p}.${key}` : key }));
  }
  return matches;
}

function candidateLabel(item = {}) {
  const symbol = item.symbol || item.tokenSymbol || item.name || item.token?.symbol || 'UNKNOWN';
  const mint = item.mint || item.tokenMint || item.address || item.token?.mint || item.id || '';
  return mint ? `${symbol} ${mint}` : symbol;
}

function summarizeFalseNegative(item = {}) {
  const label = candidateLabel(item);
  const outcome = item.outcome || item.classification || item.status || item.result || '';
  const score = item.score ?? item.maxScore ?? item.bestScore ?? item.falseNegativeScore ?? item.fnScore;
  const curve = item.curveProgress ?? item.maxCurveProgress ?? item.bestCurveProgress ?? item.curve;
  const reason = item.reason || item.reasons || item.skipReasons || item.rejectReasons || '';
  const reasonText = Array.isArray(reason) ? reason.join(',') : typeof reason === 'object' ? JSON.stringify(reason) : String(reason || '');
  return `${label}${outcome ? ` | ${outcome}` : ''}${score !== undefined ? ` | score=${fmt(score)}` : ''}${curve !== undefined ? ` | curve=${fmt(curve, 4)}` : ''}${reasonText ? ` | ${reasonText.slice(0, 160)}` : ''}`;
}

function summarizeRecoveryCandidate(item = {}) {
  const label = candidateLabel(item);
  const outcome = item.outcome || item.classification || item.status || '';
  const priority = item.priority ?? item.falseNegativePriority;
  const score = item.maxScore ?? item.score;
  const curve = item.maxCurveProgress ?? item.curveProgress;
  const vol = item.maxRecentVolumeSol ?? item.recentVolumeSol;
  const vel = item.maxTradeVelocityPerMin ?? item.tradeVelocityPerMin;
  const noPrior = item.noPriorSkips ?? item.paperSkips?.NO_PRIOR_CURVE_PROGRESS;
  const failures = Array.isArray(item.failures) && item.failures.length ? ` | failures=${item.failures.join(',')}` : '';
  return `${label}${outcome ? ` | ${outcome}` : ''}${priority !== undefined ? ` | priority=${fmt(priority)}` : ''}${score !== undefined ? ` | score=${fmt(score)}` : ''}${curve !== undefined ? ` | curve=${fmt(curve, 4)}` : ''}${vol !== undefined ? ` | vol=${fmt(vol, 2)}` : ''}${vel !== undefined ? ` | vel=${fmt(vel, 2)}` : ''}${noPrior !== undefined ? ` | noPrior=${noPrior}` : ''}${failures}`;
}

function summarizeNoPriorReplay(item = {}) {
  const label = candidateLabel(item);
  const needed = item.neededEarlierSnapshot || {};
  return `${label} | diagnosis=${item.diagnosis || 'n/a'} | decisions=${item.noPriorDecisionCount ?? 'n/a'} | firstCurve=${fmt(item.firstNoPriorCurveProgress, 4)} | neededBaseline<=${fmt(needed.maxBaselineCurveProgressForMinDelta, 4)}`;
}

function summarizeNoPriorFirstObservedCurve(item = {}) {
  return `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
    + ` | diagnosis=${item.diagnosis || 'n/a'}`
    + ` | firstCurve=${fmt(item.firstObservedCurveProgress, 4)}`
    + ` | bucket=${item.firstObservedCurveBucket || 'n/a'}`
    + ` | firstSeenToCurve=${item.secondsFirstSeenToFirstObservedCurve ?? 'n/a'}s`
    + ` | source=${item.firstObservedSource || 'n/a'}`;
}

function summarizeNoPriorFollowThrough(item = {}) {
  const label = candidateLabel(item);
  return `${label} | decisions=${item.noPriorDecisionCount ?? 'n/a'} | firstCurve=${fmt(item.firstNoPriorCurveProgress, 4)} | bestDelta120s=${fmt(item.bestCurveDelta120s, 4)} | max120s=${fmt(item.maxCurveProgressWithin120s, 4)} | classes=${compactValue(item.followThroughClasses)}`;
}

function summarizeDelayedEntryReplay(item = {}) {
  const label = item.symbol || item.mint || 'UNKNOWN';
  return `${label} | delay=${item.delay || 'n/a'} | ${item.class || 'n/a'} | pnl=${item.pnlSol === null || item.pnlSol === undefined ? 'n/a' : sol(item.pnlSol, 6)} | hold=${item.holdSeconds ?? 'n/a'}s | curve@entry=${fmt(item.entryCurveProgress, 4)} | maxCurve=${fmt(item.maxCurveProgressInWindow, 4)}`;
}

function summarizeRunnerReject(item = {}) {
  const label = item.symbol || item.mint || 'UNKNOWN';
  const details = [
    item.reason ? `reason=${item.reason}` : null,
    item.source ? `source=${item.source}` : null,
    item.momentumScore !== null && item.momentumScore !== undefined ? `momentum=${fmt(item.momentumScore, 4)}` : null,
    item.qualityScore !== null && item.qualityScore !== undefined ? `quality=${fmt(item.qualityScore, 4)}` : null,
    item.rankScore !== null && item.rankScore !== undefined ? `rank=${fmt(item.rankScore, 4)}` : null,
    item.pumpFailureReason ? `pumpFailure=${item.pumpFailureReason}` : null
  ].filter(Boolean);
  return `${label}${details.length ? ` | ${details.join(' | ')}` : ''}`;
}

function summarizeRaydiumShadow(item = {}) {
  const label = item.symbol || item.mint || 'UNKNOWN';
  const continuation = item.continuation
    ? ` | continuation=${item.continuation.verdict || item.continuation.rejectReason || 'observed'}`
    : '';
  const age = item.poolAgeKnown
    ? `age=${fmt(item.poolAgeHours, 2)}h`
    : 'age=unknown';
  const bucket = item.ageBucket ? ` | bucket=${item.ageBucket}` : '';
  return `${label} | BLOCKED report-only | rank=${fmt(item.rankScore)} | quality=${fmt(item.qualityScore)} | liq=${money(item.liquidityUsd, 0)} | vol24h=${money(item.volume24h, 0)} | risk=${fmt(item.riskScore, 3)} | ${age}${bucket}${continuation}`;
}

function summarizeRaydiumShadowOutcome(item = {}) {
  const label = item.symbol || item.mint || 'UNKNOWN';
  return `${label} | obs=${item.observationCount ?? 'n/a'} | window=${fmt(item.observedMinutes, 2)}m | last=${pct(item.lastReturnPct)} | maxRunup=${pct(item.maxRunupPct)} | maxDrawdown=${pct(item.maxDrawdownPct)} | verdict=${item.continuationVerdict || item.continuationRejectReason || 'n/a'}`;
}

function summarizeRaydiumShadowOutcomeJoin(item = {}) {
  const label = item.symbol || item.mint || 'UNKNOWN';
  return `${label} | outcome=${item.outcomeLabel || 'UNKNOWN'} | age=${item.ageBucket || 'UNKNOWN'} | last=${pct(item.lastReturnPct)} | maxRunup=${pct(item.maxRunupPct)} | continuation=${item.continuationVerdict || item.continuationRejectReason || 'n/a'}`;
}

function summarizeWalletFirstTouchOutcome(item = {}) {
  const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
  const outcome = item.outcomeLabel || item.outcome?.outcome || 'UNKNOWN';
  const curve = item.outcome?.maxCurveProgress;
  const priority = item.outcome?.falseNegativePriority;
  const source = item.outcomeDetailSource ? ` | source=${item.outcomeDetailSource}` : '';
  return `${label} | outcome=${outcome} | score=${fmt(item.firstTouchScore)} | wallets=${item.uniqueWalletCount ?? 'n/a'} | sol=${fmt(item.totalFirstTouchSol, 4)} | curve=${curve === null || curve === undefined ? 'n/a' : fmt(curve, 4)}${priority === null || priority === undefined ? '' : ` | fnPriority=${fmt(priority)}`}${source}`;
}

function summarizeWalletCohortComparison(name, item = {}) {
  return `${name}: clusters=${item.clusters ?? 'n/a'}, matched=${item.matchedClusters ?? 'n/a'} (${pct(item.outcomeCoverageRate)} coverage), migrationOrNear=${item.migrationOrNearCount ?? 'n/a'} (${pct(item.migrationOrNearRate)} vs base ${pct(item.baseMigrationOrNearRate)}, lift=${fmt(item.migrationOrNearLiftVsBase)}x), matchedMigrationOrNear=${item.matchedMigrationOrNearCount ?? 'n/a'} (${pct(item.matchedMigrationOrNearRate)} matched-only, lift=${fmt(item.matchedMigrationOrNearLiftVsBase)}x), interestingOrBetter=${item.interestingOrBetterCount ?? 'n/a'} (${pct(item.interestingOrBetterRate)} vs base ${pct(item.baseInterestingOrBetterRate)}, lift=${fmt(item.interestingOrBetterLiftVsBase)}x)${item.tinyDenominatorWarning ? ' | tiny denominator' : ''}`;
}

function summarizeWalletArchetypePnl(name, item = {}) {
  const flag = item.movementWithoutPaperProfit ? ' | movement without paper profit' : '';
  return `${name}: clusters=${item.clusters ?? 'n/a'}, entered=${item.paperEnteredClusters ?? 'n/a'}, paper W/L=${item.paperWins ?? 'n/a'}/${item.paperLosses ?? 'n/a'}, entries=${item.totalPaperEntries ?? 'n/a'}, pnl=${sol(item.totalPaperPnlSol ?? 0, 6)}, avg=${item.averagePaperPnlSol === null || item.averagePaperPnlSol === undefined ? 'n/a' : sol(item.averagePaperPnlSol, 6)}, movement=${item.interestingOrBetterCount ?? 'n/a'}${flag}`;
}

function summarizeWalletSniperReplayBucket(name, item = {}) {
  return `${name}: clusters=${item.clusters ?? 'n/a'}, entered=${item.paperEnteredClusters ?? 'n/a'}, paper W/L=${item.paperWins ?? 'n/a'}/${item.paperLosses ?? 'n/a'}, entries=${item.totalPaperEntries ?? 'n/a'}, pnl=${sol(item.totalPaperPnlSol ?? 0, 6)}, avg=${item.averagePaperPnlSol === null || item.averagePaperPnlSol === undefined ? 'n/a' : sol(item.averagePaperPnlSol, 6)}, movement=${item.interestingOrBetterCount ?? 'n/a'}`;
}

function summarizeWalletSniperReplayRow(item = {}) {
  const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
  const failed = Array.isArray(item.failedChecks) && item.failedChecks.length
    ? ` | fails=${item.failedChecks.join(',')}`
    : '';
  return `${label} | gate=${item.passesCurrentGate ? 'pass' : 'fail'} | outcome=${item.outcomeLabel || 'n/a'} | pnl=${item.paperPnlSol === null || item.paperPnlSol === undefined ? 'n/a' : sol(item.paperPnlSol, 6)} | score=${fmt(item.maxScore)} | curve=${fmt(item.maxCurveProgress, 4)} | vol=${fmt(item.maxRecentVolumeSol, 2)} | vel=${fmt(item.maxTradeVelocityPerMin, 2)}${failed}`;
}

function summarizeWalletPnlEvidence(item = {}) {
  return `${item.name || 'UNKNOWN'} | tier=${item.evidenceTier || 'n/a'} | realized=${item.realizedPositionCount ?? 'n/a'} | win=${pct(item.winRate)} | pnl=${sol(item.realizedPnlSol ?? 0, 4)} | median=${sol(item.medianRealizedPnlSol ?? 0, 4)}`;
}

function summarizeWalletLift(item = {}) {
  return `${item.name || 'UNKNOWN'} | mints=${item.uniqueMintCount ?? 'n/a'} | positive=${pct(item.positiveRate)} | interesting=${pct(item.interestingRate)} | buys=${pct(item.firstBuyRate)}${item.tinyDenominatorWarning ? ' | tiny denominator' : ''}`;
}

function summarizeDaumenWallet(item = {}) {
  return `${item.name || 'UNKNOWN'} | ${item.daumenCohortClass || 'n/a'} | tier=${item.reviewTier || 'n/a'} | mints=${item.uniqueMintCount ?? 'n/a'} | priority=${item.priorityClusterCount ?? 'n/a'} | positive=${pct(item.positiveRate)} | pnl=${sol(item.realizedPnlSol ?? 0, 4)}${item.tinyDenominatorWarning ? ' | tiny denominator' : ''}`;
}

function summarizeWalletTimeblocked(item = {}) {
  return `${item.canonicalWallet || 'UNKNOWN'} | eligible=${item.trustEligibleMints ?? 'n/a'} | positive=${pct(item.trustEligible?.positiveRate)} | pnl=${sol(item.trustEligible?.paperPnlSol ?? 0, 6)}`;
}

function summarizeWalletPaperEntry(item = {}) {
  return `${item.canonicalWallet || 'UNKNOWN'} | entered=${item.uniqueEnteredMints ?? 'n/a'} | W/L=${item.paperWins ?? 'n/a'}/${item.paperLosses ?? 'n/a'} | pnl=${sol(item.paperPnlSol ?? 0, 6)} | avg=${item.averagePaperPnlSol === null || item.averagePaperPnlSol === undefined ? 'n/a' : sol(item.averagePaperPnlSol, 6)}`;
}

function summarizeWalletFalseNegativeBridge(item = {}) {
  const leads = item.strongLeadWallets?.length ? item.strongLeadWallets.join(',') : item.leadWallets?.join(',') || 'none';
  return `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
    + ` | outcome=${item.outcome || 'n/a'} | priority=${fmt(item.falseNegativePriority)}`
    + ` | pre85=${item.pre85WalletTouchCount ?? 'n/a'} | strongPre85=${item.strongPre85WalletTouchCount ?? 'n/a'} | leads=${leads}`;
}

function summarizeWalletFalseNegativeEntryReplay(item = {}) {
  return `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
    + ` | trigger=${item.triggerWallet || 'n/a'} | ${item.replayClass || 'n/a'}`
    + ` | pnl=${item.pnlSol === null || item.pnlSol === undefined ? 'n/a' : sol(item.pnlSol, 6)}`
    + ` | touchToEntry=${item.secondsTouchToEntry ?? 'n/a'}s | curve=${fmt(item.entryCurveProgress, 4)}`;
}

function summarizeWalletShapeBucket(item = {}) {
  return `rows=${item.rows ?? 'n/a'}, enter=${item.wouldEnter ?? 'n/a'}, pnl=${item.totalPnlSol === null || item.totalPnlSol === undefined ? 'n/a' : sol(item.totalPnlSol, 6)}, win=${pct(item.winRate)}`;
}

function summarizeEntryLossBucket(name, item = {}) {
  return `${name}: entries=${item.entries ?? 'n/a'}, W/L/F=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}/${item.flats ?? 'n/a'}, pnl=${sol(item.totalPnlSol ?? 0, 6)}, avg=${item.averagePnlSol === null || item.averagePnlSol === undefined ? 'n/a' : sol(item.averagePnlSol, 6)}, exits=${compactValue(item.exitReasonCounts)}`;
}

function summarizeEntryLossRow(item = {}) {
  const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
  const guard = item.guardOverride ? ` | guard=${item.guardOverride}` : '';
  return `${label} | preset=${item.preset || 'n/a'} | band=${item.curveBand || 'n/a'} | exit=${item.exitReason || 'OPEN'} | pnl=${item.pnlSol === null || item.pnlSol === undefined ? 'n/a' : sol(item.pnlSol, 6)} | score=${fmt(item.entryScore)} | curve=${fmt(item.entryCurveProgress, 4)} | hold=${item.holdSeconds ?? 'n/a'}s${guard}`;
}

function summarizeEntryTimingPressureRow(item = {}) {
  const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
  const actual = item.actual || {};
  const sim = item.sim || {};
  const comparison = item.comparison || {};
  const flags = Array.isArray(comparison.pressureFlags) && comparison.pressureFlags.length
    ? ` | flags=${comparison.pressureFlags.join(',')}`
    : '';
  return `${label} | band=${item.curveBand || 'n/a'} | actual=${actual.exitReason || 'n/a'} ${actual.pnlSol === null || actual.pnlSol === undefined ? 'n/a' : sol(actual.pnlSol, 6)} | sim=${sim.exitReason || 'n/a'} ${sim.pnlSol === null || sim.pnlSol === undefined ? 'n/a' : sol(sim.pnlSol, 6)} | delta=${comparison.deltaPnlSol === null || comparison.deltaPnlSol === undefined ? 'n/a' : sol(comparison.deltaPnlSol, 6)} | simMin=${fmt(sim.unrealizedMinReturnPct, 4)} | simMax=${fmt(sim.unrealizedMaxReturnPct, 4)}${flags}`;
}

function summarizeEntryInfraBucket(name, item = {}) {
  return `${name}: entries=${item.entries ?? 'n/a'}, W/L/F=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}/${item.flats ?? 'n/a'}, pnl=${sol(item.totalPnlSol ?? 0, 6)}, avg=${item.averagePnlSol === null || item.averagePnlSol === undefined ? 'n/a' : sol(item.averagePnlSol, 6)}, stale=${item.staleCurveUpdates ?? 'n/a'}, backoff=${item.recentBondingBackoff ?? 'n/a'}, disconnect=${item.recentPumpPortalDisconnect ?? 'n/a'}`;
}

function summarizeEntryInfraRow(item = {}) {
  const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
  const age = item.curveUpdateAgeSeconds === null || item.curveUpdateAgeSeconds === undefined
    ? 'n/a'
    : `${item.curveUpdateAgeSeconds}s`;
  const flags = Array.isArray(item.pressureFlags) && item.pressureFlags.length
    ? ` | flags=${item.pressureFlags.join(',')}`
    : '';
  return `${label} | bucket=${item.infraBucket || 'n/a'} | preset=${item.preset || 'n/a'} | guard=${item.guardOverride || 'none'} | band=${item.curveBand || 'n/a'} | exit=${item.exitReason || 'n/a'} | pnl=${item.pnlSol === null || item.pnlSol === undefined ? 'n/a' : sol(item.pnlSol, 6)} | curve=${fmt(item.entryCurveProgress, 4)} | curveAge=${age} | backoff=${item.recentBondingBackoff ? 'yes' : 'no'} | disconnect=${item.recentPumpPortalDisconnect ? 'yes' : 'no'}${flags}`;
}

function summarizeRollingEntryBucket(name, item = {}) {
  return `${name}: entries=${item.entries ?? 'n/a'}, W/L/F=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}/${item.flats ?? 'n/a'}, pnl=${sol(item.totalPnlSol ?? 0, 6)}, avg=${item.averagePnlSol === null || item.averagePnlSol === undefined ? 'n/a' : sol(item.averagePnlSol, 6)}, stop=${item.stopLosses ?? 'n/a'}, stall=${item.curveStalls ?? 'n/a'}, take=${item.takeProfits ?? 'n/a'}, stale=${item.staleCurveUpdates ?? 'n/a'}, fresh=${item.freshCurveUpdates ?? 'n/a'}, missing=${item.missingCurveUpdates ?? 'n/a'}`;
}

function summarizeFirstSightCohortBucket(name, item = {}) {
  return `${name}: entries=${item.entries ?? 'n/a'}, W/L/F=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}/${item.flats ?? 'n/a'}, pnl=${sol(item.totalPnlSol ?? 0, 6)}, avg=${item.averagePnlSol === null || item.averagePnlSol === undefined ? 'n/a' : sol(item.averagePnlSol, 6)}, stale=${item.staleCurveUpdates ?? 'n/a'}, exit_saved=${item.actualOutperformedSim ?? 'n/a'}`;
}

function summarizeHighCurveCohortBucket(name, item = {}) {
  return `${name}: entries=${item.entries ?? 'n/a'}, W/L/F=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}/${item.flats ?? 'n/a'}, pnl=${sol(item.totalPnlSol ?? 0, 6)}, avg=${item.averagePnlSol === null || item.averagePnlSol === undefined ? 'n/a' : sol(item.averagePnlSol, 6)}, stale=${item.staleCurveUpdates ?? 'n/a'}, backoff=${item.recentBondingBackoff ?? 'n/a'}, disconnect=${item.recentPumpPortalDisconnect ?? 'n/a'}`;
}

function summarizeRollingRun(item = {}) {
  return `${item.runId || item.telemetryPath || 'run'} | entries=${item.entries ?? 'n/a'} W/L/F=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}/${item.flats ?? 'n/a'} pnl=${sol(item.totalPnlSol ?? 0, 6)} firstSight=${sol(item.firstSight?.totalPnlSol ?? 0, 6)} sniper=${sol(item.sniperCrowded?.totalPnlSol ?? 0, 6)}`;
}

function summarizeRollingEntryRow(item = {}) {
  const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
  const age = item.curveUpdateAgeSeconds === null || item.curveUpdateAgeSeconds === undefined
    ? 'n/a'
    : `${item.curveUpdateAgeSeconds}s`;
  return `${label} | run=${item.runId || 'n/a'} | preset=${item.preset || 'n/a'} | guard=${item.guardOverride || 'n/a'} | band=${item.curveBand || 'n/a'} | freshness=${item.curveUpdateFreshnessBucket || 'n/a'} | curveAge=${age} | sniper=${item.sniperCrowdingBucket || 'n/a'} | exit=${item.exitReason || 'n/a'} | pnl=${item.pnlSol === null || item.pnlSol === undefined ? 'n/a' : sol(item.pnlSol, 6)} | curve=${fmt(item.entryCurveProgress, 4)}`;
}

function summarizeContinuationExitScenario(name, summary = {}) {
  const deltaSol = summary.deltaVsCurrentConfigSol === null || summary.deltaVsCurrentConfigSol === undefined
    ? 'n/a'
    : sol(summary.deltaVsCurrentConfigSol, 6);
  const deltaUsd = summary.deltaVsCurrentConfigUsd === null || summary.deltaVsCurrentConfigUsd === undefined
    ? 'n/a'
    : money(summary.deltaVsCurrentConfigUsd, 2);
  return `${name}: pnl=${summary.totalPnlSol === null || summary.totalPnlSol === undefined ? 'n/a' : sol(summary.totalPnlSol, 6)} (${summary.totalPnlUsd === null || summary.totalPnlUsd === undefined ? 'n/a' : money(summary.totalPnlUsd, 2)}), deltaVsCurrent=${deltaSol} (${deltaUsd}), exits=${compactValue(summary.exitReasons)}, winRate=${summary.winRate === null || summary.winRate === undefined ? 'n/a' : pct(summary.winRate)}`;
}

function summarizeLesson(lesson = {}) {
  if (!lesson || typeof lesson !== 'object') return String(lesson || '');
  const parts = [];
  if (lesson.type) parts.push(lesson.type);
  if (lesson.severity) parts.push(`severity=${lesson.severity}`);
  if (lesson.text) parts.push(lesson.text);
  if (lesson.evidence && typeof lesson.evidence === 'object' && !Array.isArray(lesson.evidence)) {
    parts.push(`evidence=${compactValue(lesson.evidence)}`);
  } else if (Array.isArray(lesson.evidence)) {
    parts.push(`evidence=${lesson.evidence.length} item(s)`);
  }
  return parts.join(' | ');
}

function collectSimpleRuntimeEvidence() {
  const evidence = [];
  const paths = [path.join(REPO_ROOT, 'run-logs'), path.join(REPO_ROOT, 'data', 'outcomes')];
  const patterns = ['Simple runtime AI', 'SIMPLE_RUNTIME_AI', 'llama3.2'];
  const maxWholeFileBytes = 32 * 1024 * 1024;
  const tailBytes = 4 * 1024 * 1024;

  for (const base of paths) {
    if (!fs.existsSync(base)) continue;
    const files = fs.readdirSync(base)
      .filter((name) => name.endsWith('.jsonl') || name.endsWith('.log') || name.endsWith('.txt'))
      .map((name) => path.join(base, name));
    for (const file of files) {
      let content = '';
      try {
        const stat = fs.statSync(file);
        if (stat.size > maxWholeFileBytes) {
          const fd = fs.openSync(file, 'r');
          const length = Math.min(tailBytes, stat.size);
          const buffer = Buffer.alloc(length);
          fs.readSync(fd, buffer, 0, length, stat.size - length);
          fs.closeSync(fd);
          content = buffer.toString('utf8');
        } else {
          content = fs.readFileSync(file, 'utf8');
        }
      } catch {
        continue;
      }
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          evidence.push(path.relative(REPO_ROOT, file));
          break;
        }
      }
    }
  }

  return Array.from(new Set(evidence));
}

function buildAiReachability(battlefield = {}) {
  const runner = battlefield.runnerLane || {};
  const eventCounts = battlefield.eventCounts || {};
  const diag = runner.scalperDiagnostics || {};
  const generatedSignals = number(runner.generatedSignals ?? diag.generatedSignals, 0);
  const executedSignals = number(runner.executedSignals ?? diag.executedSignals, 0);
  const rejectedTrades = number(runner.rejectedTrades, 0);
  const quoteRejects = number(diag.quoteRejects, 0);
  const aiRejects = number(diag.aiRejects, 0);
  const lifecycleAttempts = number(eventCounts['simple_runtime_ai.review_started'], 0);
  const lifecycleCompleted = number(eventCounts['simple_runtime_ai.review_completed'], 0);
  const lifecycleFailed = number(eventCounts['simple_runtime_ai.review_failed'], 0);
  const aiDecisionEvents = number(eventCounts['signal.ai_decision'], 0)
    + number(eventCounts['ai.veto'], 0)
    + number(eventCounts['ai.caution'], 0);
  const aiTimeoutFallbacks = Array.isArray(runner.aiTimeoutFallback) ? runner.aiTimeoutFallback.length : 0;
  const nearMiss = runner.nearMissDiagnostic || {};
  const aiFailureTypes = nearMiss.aiFailureTypes || {};
  const aiFailureReasons = nearMiss.aiFailureReasons || {};

  let interpretation = 'AI path status is inconclusive from the available report fields.';
  if (generatedSignals === 0) {
    interpretation = 'No runner/scalper signals were generated, so no real candidate reached runtime AI review.';
  } else if (lifecycleAttempts > 0) {
    interpretation = 'At least one real candidate reached Simple Runtime AI review lifecycle instrumentation.';
  } else if (generatedSignals > 0 && rejectedTrades >= generatedSignals && aiDecisionEvents === 0) {
    interpretation = 'Signals were generated but rejected before AI review, likely by momentum or quality gates.';
  } else if (aiDecisionEvents === 0 && quoteRejects > 0) {
    interpretation = 'Signals were generated but stopped at quote/quality handling before AI review.';
  } else if (aiDecisionEvents > 0) {
    interpretation = 'At least one real candidate reached AI decision handling.';
  }

  return {
    generatedSignals,
    executedSignals,
    rejectedTrades,
    quoteRejects,
    lifecycleAttempts,
    lifecycleCompleted,
    lifecycleFailed,
    aiRejects,
    aiDecisionEvents,
    aiTimeoutFallbacks,
    aiFailureTypes,
    aiFailureReasons,
    interpretation
  };
}

function readPumpPortalStatsFromTelemetry(battlefield = {}) {
  const telemetryPath = get(battlefield, 'files.telemetryPath', null);
  const resolvedPath = resolveRepoFile(telemetryPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      telemetryPath,
      error: telemetryPath ? 'telemetry file missing' : 'telemetry path missing',
      stats: null
    };
  }

  let stats = null;
  const lifecycle = {
    connected: 0,
    closed: 0,
    websocketErrors: 0,
    staleReconnects: 0,
    closeConnectionAgeMs: [],
    closeSubscribedMints: [],
    lastCloseCode: null,
    lastCloseReason: null
  };
  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'provider.pumpportal.connected') {
          lifecycle.connected += 1;
        } else if (event.type === 'provider.pumpportal.closed') {
          lifecycle.closed += 1;
          const payload = event.payload || event.data || {};
          lifecycle.closeConnectionAgeMs.push(payload.connectionAgeMs);
          lifecycle.closeSubscribedMints.push(payload.subscribedMints);
          lifecycle.lastCloseCode = payload.code ?? lifecycle.lastCloseCode;
          lifecycle.lastCloseReason = payload.reason || lifecycle.lastCloseReason;
        } else if (event.type === 'provider.pumpportal.websocket_error') {
          lifecycle.websocketErrors += 1;
        } else if (event.type === 'provider.pumpportal.stale_reconnect') {
          lifecycle.staleReconnects += 1;
        }
        const pumpPortal = get(event, [
          'payload.stats.pumpPortal',
          'data.stats.pumpPortal',
          'payload.pumpPortal',
          'data.pumpPortal'
        ], null);
        if (pumpPortal) stats = pumpPortal;
      } catch (_) {
        // Ignore malformed telemetry rows; the report should stay best-effort.
      }
    }
  } catch (error) {
    return {
      ok: false,
      telemetryPath,
      error: error.message,
      stats: null
    };
  }

  return {
    ok: Boolean(stats),
    telemetryPath,
    error: stats ? null : 'pumpPortal stats not found',
    stats,
    lifecycle
  };
}

function readRuntimeStatsFromTelemetry(battlefield = {}) {
  const telemetryPath = get(battlefield, 'files.telemetryPath', null);
  const resolvedPath = resolveRepoFile(telemetryPath);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      telemetryPath,
      error: 'telemetry file missing',
      stats: null
    };
  }

  let stats = null;
  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const candidate = get(event, [
          'payload.stats',
          'data.stats'
        ], null);
        if (candidate) stats = candidate;
      } catch (_) {
        // Ignore malformed telemetry rows; this is best-effort report context.
      }
    }
  } catch (error) {
    return {
      ok: false,
      telemetryPath,
      error: error.message,
      stats: null
    };
  }

  return {
    ok: Boolean(stats),
    telemetryPath,
    error: stats ? null : 'runtime stats not found',
    stats
  };
}

function buildPumpPortalHealth(battlefield = {}) {
  const eventCounts = battlefield.eventCounts || {};
  const telemetry = readPumpPortalStatsFromTelemetry(battlefield);
  const stats = telemetry.stats || {};
  const lifecycle = telemetry.lifecycle || {};
  const closeAgeStats = numericStats(lifecycle.closeConnectionAgeMs || []);
  const closeSubscribedMintStats = numericStats(lifecycle.closeSubscribedMints || []);
  const messages = number(stats.messages, 0);
  const newTokens = number(stats.newTokens, number(eventCounts['provider.pumpportal.new_token'], 0));
  const trades = number(stats.trades, number(eventCounts['provider.pumpportal.trade'], 0));
  const migrations = number(stats.migrations, number(eventCounts['provider.pumpportal.migration'], 0));
  const reconnectAttempts = number(stats.reconnectAttempts, 0);
  const closeEvents = number(stats.closeEvents, 0);
  const staleReconnects = number(stats.staleReconnects, 0);
  const subscribedMints = number(stats.subscribedMints, 0);
  const skippedPaidStreamMints = number(stats.skippedPaidStreamMints, 0);
  const tradeSubscriptionsSkippedNoApiKey = number(stats.tradeSubscriptionsSkippedNoApiKey, 0);
  const accountSubscriptionsSkippedNoApiKey = number(stats.accountSubscriptionsSkippedNoApiKey, 0);
  const maxSubscribedMints = number(stats.maxSubscribedMints, 0);
  const tokenTradeSubscriptionTtlMs = number(stats.tokenTradeSubscriptionTtlMs, 0);
  const tokenTradeUnsubscriptions = number(stats.tokenTradeUnsubscriptions, 0);
  const tokenTradeSubscriptionPrunes = number(stats.tokenTradeSubscriptionPrunes, 0);
  const tokenTradeTtlPrunes = number(stats.tokenTradeTtlPrunes, 0);
  const tokenTradeMaxActivePrunes = number(stats.tokenTradeMaxActivePrunes, 0);
  const tradeSubscriptionsSkippedMaxActive = number(stats.tradeSubscriptionsSkippedMaxActive, 0);
  const tokenTradeReconnectResubscribeScheduled = number(stats.tokenTradeReconnectResubscribeScheduled, 0);
  const tokenTradeReconnectResubscribeSent = number(stats.tokenTradeReconnectResubscribeSent, 0);
  const tokenTradeReconnectResubscribeDropped = number(stats.tokenTradeReconnectResubscribeDropped, 0);
  const reconnectResubscribeMaxMints = number(stats.reconnectResubscribeMaxMints, 0);
  const reconnectResubscribeBatchSize = number(stats.reconnectResubscribeBatchSize, 0);
  const reconnectResubscribeBatchDelayMs = number(stats.reconnectResubscribeBatchDelayMs, 0);
  const subscriptionAckMessages = number(stats.subscriptionAckMessages, 0);
  const newTokenSubscriptionAcks = number(stats.newTokenSubscriptionAcks, 0);
  const migrationSubscriptionAcks = number(stats.migrationSubscriptionAcks, 0);
  const tokenTradeSubscriptionAcks = number(stats.tokenTradeSubscriptionAcks, 0);
  const accountTradeSubscriptionAcks = number(stats.accountTradeSubscriptionAcks, 0);
  const unknownSubscriptionAcks = number(stats.unknownSubscriptionAcks, 0);
  const lastSubscriptionAckMessage = stats.lastSubscriptionAckMessage || null;
  const lastSubscriptionAckKind = stats.lastSubscriptionAckKind || null;
  const reconnectDelayMs = number(stats.reconnectDelayMs, 0);
  const maxReconnectDelayMs = number(stats.maxReconnectDelayMs, 0);
  const reconnectDelayStableResets = number(stats.reconnectDelayStableResets, 0);
  const reconnectDelayResetAfterStableMs = number(stats.reconnectDelayResetAfterStableMs, 0);
  const pingIntervalMs = number(stats.pingIntervalMs, 0);
  const pingsSent = number(stats.pingsSent, 0);
  const pongsReceived = number(stats.pongsReceived, 0);
  const lastConnectionAgeMs = number(stats.lastConnectionAgeMs, null);
  const connected = stats.connected === true;
  const paidTradeStreamsEnabled = stats.paidTradeStreamsEnabled === true;
  const lastCloseCode = stats.lastCloseCode ?? lifecycle.lastCloseCode ?? null;
  const lastCloseReason = stats.lastCloseReason || lifecycle.lastCloseReason || 'none';
  const lastErrorMessage = stats.lastErrorMessage || null;
  const tradeEventCount = number(eventCounts['provider.pumpportal.trade'], trades);
  const newTokenEventCount = number(eventCounts['provider.pumpportal.new_token'], newTokens);
  const syntheticMigrationEventCount = number(eventCounts['pump_bonding_curve.synthetic_migration'], 0);

  let status = 'unknown';
  let interpretation = telemetry.ok
    ? 'PumpPortal telemetry was captured, but health is inconclusive.'
    : `PumpPortal stats unavailable: ${telemetry.error}.`;

  if (telemetry.ok) {
    if (messages === 0 && newTokens === 0 && trades === 0) {
      status = 'outage';
      interpretation = 'No PumpPortal feed data was captured; treat PumpPortal-dependent evidence as unavailable.';
    } else if (closeEvents >= 20 || reconnectAttempts >= 20 || lastErrorMessage) {
      const tradeStreamSparse = newTokens > 0 && trades <= Math.max(2, Math.floor(newTokens * 0.02));
      status = tradeStreamSparse ? 'degraded_trade_stream' : 'degraded';
      interpretation = tradeStreamSparse
        ? 'New-token feed was active, but trade stream was sparse while websocket reconnects/errors were high; treat pre-migration evidence as partial.'
        : 'PumpPortal feed captured data but had heavy websocket churn/errors; treat feed-dependent conclusions with caution.';
    } else if (closeEvents > 3 || reconnectAttempts > 3) {
      status = 'churn';
      interpretation = 'PumpPortal feed was usable but reconnecting repeatedly; review if this persists.';
    } else {
      status = connected || messages > 0 ? 'healthy' : 'quiet';
      interpretation = 'PumpPortal feed health looked acceptable for this run.';
    }
  }

  if (telemetry.ok && migrationSubscriptionAcks > 0 && migrations === 0) {
    interpretation += ' Migration subscription was acknowledged, but no migration events were delivered in this window.';
  }

  return {
    status,
    interpretation,
    telemetryPath: telemetry.telemetryPath,
    telemetryError: telemetry.error,
    messages,
    newTokens,
    trades,
    migrations,
    reconnectAttempts,
    closeEvents,
    staleReconnects,
    subscribedMints,
    skippedPaidStreamMints,
    tradeSubscriptionsSkippedNoApiKey,
    accountSubscriptionsSkippedNoApiKey,
    maxSubscribedMints,
    tokenTradeSubscriptionTtlMs,
    tokenTradeUnsubscriptions,
    tokenTradeSubscriptionPrunes,
    tokenTradeTtlPrunes,
    tokenTradeMaxActivePrunes,
    tradeSubscriptionsSkippedMaxActive,
    tokenTradeReconnectResubscribeScheduled,
    tokenTradeReconnectResubscribeSent,
    tokenTradeReconnectResubscribeDropped,
    reconnectResubscribeMaxMints,
    reconnectResubscribeBatchSize,
    reconnectResubscribeBatchDelayMs,
    subscriptionAckMessages,
    newTokenSubscriptionAcks,
    migrationSubscriptionAcks,
    tokenTradeSubscriptionAcks,
    accountTradeSubscriptionAcks,
    unknownSubscriptionAcks,
    lastSubscriptionAckMessage,
    lastSubscriptionAckKind,
    reconnectDelayMs,
    maxReconnectDelayMs,
    reconnectDelayStableResets,
    reconnectDelayResetAfterStableMs,
    pingIntervalMs,
    pingsSent,
    pongsReceived,
    lastConnectionAgeMs,
    lifecycle: {
      connected: number(lifecycle.connected, 0),
      closed: number(lifecycle.closed, 0),
      websocketErrors: number(lifecycle.websocketErrors, 0),
      staleReconnects: number(lifecycle.staleReconnects, 0),
      closeAgeStats,
      closeSubscribedMintStats
    },
    connected,
    paidTradeStreamsEnabled,
    lastCloseCode,
    lastCloseReason,
    lastErrorMessage,
    eventCounts: {
      newTokens: newTokenEventCount,
      trades: tradeEventCount,
      migrations: number(eventCounts['provider.pumpportal.migration'], migrations),
      syntheticMigrations: syntheticMigrationEventCount
    }
  };
}

function buildBondingCurvePressure(battlefield = {}) {
  const telemetry = readRuntimeStatsFromTelemetry(battlefield);
  const stats = telemetry.stats?.pumpBondingCurveLane || {};
  return {
    ok: telemetry.ok && Boolean(telemetry.stats?.pumpBondingCurveLane),
    error: telemetry.ok ? null : telemetry.error,
    fetches: number(stats.fetches, 0),
    updates: number(stats.updates, 0),
    errors: number(stats.errors, 0),
    completeMintsObserved: number(stats.completeMintsObserved, 0),
    lastCompleteMint: stats.lastCompleteMint || null,
    lastCompleteAt: stats.lastCompleteAt || null,
    skippedGlobalBackoff: number(stats.skippedGlobalBackoff, 0),
    skippedGlobalBackoffHighCurveBypass: number(stats.skippedGlobalBackoffHighCurveBypass, 0),
    globalBackoffActivations: number(stats.globalBackoffActivations, 0),
    globalBackoffActive: stats.globalBackoffActive === true,
    globalBackoffRemainingMs: number(stats.globalBackoffRemainingMs, 0),
    lastGlobalBackoffActivatedAt: stats.lastGlobalBackoffActivatedAt || null,
    lastGlobalBackoffErrorsInWindow: number(stats.lastGlobalBackoffErrorsInWindow, 0),
    recentFailuresInWindow: number(stats.recentFailuresInWindow, 0),
    inFlight: number(stats.inFlight, 0)
  };
}

function buildSolanaRpcPressure(battlefield = {}) {
  const telemetry = readRuntimeStatsFromTelemetry(battlefield);
  const stats = telemetry.stats?.solanaRpc || {};
  const queue = stats.queue || {};
  const callStats = stats.stats || {};
  return {
    ok: telemetry.ok && Boolean(telemetry.stats?.solanaRpc),
    error: telemetry.ok ? null : telemetry.error,
    primaryProvider: stats.primary?.httpUrl?.provider || null,
    fallbackProvider: stats.fallback?.httpUrl?.provider || null,
    primaryDegraded: stats.primaryDegraded === true,
    primaryDegradedUntil: stats.primaryDegradedUntil || null,
    active: number(queue.active, 0),
    pending: number(queue.pending, 0),
    maxConcurrentRequests: number(queue.maxConcurrentRequests, 0),
    minRequestIntervalMs: number(queue.minRequestIntervalMs, 0),
    primaryCalls: number(callStats.primaryCalls, 0),
    fallbackCalls: number(callStats.fallbackCalls, 0),
    primaryFailures: number(callStats.primaryFailures, 0),
    fallbackSuccesses: number(callStats.fallbackSuccesses, 0),
    fallbackFailures: number(callStats.fallbackFailures, 0),
    queuedCalls: number(callStats.queuedCalls, 0),
    maxQueueDepth: number(callStats.maxQueueDepth, 0)
  };
}

function buildSummary(docs) {
  const battlefield = docs.battlefield.data || {};
  const simpleRuntimeAiEvidence = docs.simpleRuntimeAiEvidence.data || {};
  const ledger = docs.outcomeLedger.data || {};
  const falseNeg = docs.falseNegatives.data || {};
  const preOutcomes = docs.preMigrationOutcomes.data || {};
  const paper = docs.preMigrationPaper.data || {};
  const entryLoss = docs.preMigrationEntryLossAttribution.data || {};
  const entryParity = docs.preMigrationEntryParity.data || {};
  const delayedEntryTiming = docs.preMigrationDelayedEntryTiming.data || {};
  const delayedEntryPressureShadow = docs.preMigrationDelayedEntryPressureShadow.data || {};
  const delayedEntryRecheck = docs.preMigrationDelayedEntryRecheck.data || {};
  const simStrategyDelta = docs.preMigrationSimStrategyDelta.data || {};
  const simRuntimeDivergenceTrend = docs.preMigrationSimRuntimeDivergenceTrend.data || {};
  const entryTimingPressure = docs.preMigrationEntryTimingPressure.data || {};
  const rollingEntryTrend = docs.preMigrationRollingEntryTrend.data || {};
  const entryShape = docs.preMigrationEntryShape.data || {};
  const signal = docs.signalQuality.data || {};
  const learning = docs.learning.data || {};
  const continuation = docs.continuationPaper.data || {};
  const continuationExitReplay = docs.continuationExitReplay.data || {};
  const continuationSlippageDecomposition = docs.continuationSlippageDecomposition.data || {};
  const noPriorRecovery = docs.noPriorRecovery.data || {};
  const noPriorReplay = docs.noPriorReplay.data || {};
  const noPriorHistoricalReplay = docs.noPriorHistoricalReplay.data || {};
  const noPriorFirstObservedCurve = docs.noPriorFirstObservedCurve.data || {};
  const noPriorFirstObservedCurveLatency = docs.noPriorFirstObservedCurveLatency.data || {};
  const noPriorBondingCurveNullStateLatency = docs.noPriorBondingCurveNullStateLatency.data || {};
  const noPriorFirstUpdateLatencyDecomposition = docs.noPriorFirstUpdateLatencyDecomposition.data || {};
  const noPriorPaperDecisionCurveSource = docs.noPriorPaperDecisionCurveSource.data || {};
  const noPriorDecisionTimeAlternativeState = docs.noPriorDecisionTimeAlternativeState.data || {};
  const noPriorDecisionTimeStateAge = docs.noPriorDecisionTimeStateAge.data || {};
  const noPriorFollowThrough = docs.noPriorFollowThrough.data || {};
  const noPriorDelayedEntry = docs.noPriorDelayedEntry.data || {};
  const runnerRaydiumShadow = docs.runnerRaydiumShadow.data || {};
  const runnerRaydiumShadowFixedHorizon = docs.runnerRaydiumShadowFixedHorizon.data || {};
  const runnerRaydiumShadowHistoricalHorizon = docs.runnerRaydiumShadowHistoricalHorizon.data || {};
  const runnerRaydiumShadowOutcomeJoin = docs.runnerRaydiumShadowOutcomeJoin.data || {};
  const walletFirstTouchOutcomeCorr = docs.walletFirstTouchOutcomeCorr.data || {};
  const walletSniperCrowdedReplay = docs.walletSniperCrowdedReplay.data || {};
  const walletPnlEvidence = docs.walletPnlEvidence.data || {};
  const walletPromotionReview = docs.walletPromotionReview.data || {};
  const walletReviewOutcomeLift = docs.walletReviewOutcomeLift.data || {};
  const walletPerWalletLift = docs.walletPerWalletLift.data || {};
  const walletDaumenCohort = docs.walletDaumenCohort.data || {};
  const walletHistoricalRetrospective = docs.walletHistoricalRetrospective.data || {};
  const walletCoalition = docs.walletCoalition.data || {};
  const walletTimeblockedStability = docs.walletTimeblockedStability.data || {};
  const walletPaperEntryConditional = docs.walletPaperEntryConditional.data || {};
  const walletFalseNegativeBridge = docs.walletFalseNegativeBridge.data || {};
  const walletFalseNegativeEntryReplay = docs.walletFalseNegativeEntryReplay.data || {};
  const walletFalseNegativeShape = docs.walletFalseNegativeShape.data || {};
  const lines = [];

  const generatedAt = new Date().toISOString();
  lines.push('Latest Run Summary');
  lines.push('==================');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');

  const missing = Object.values(docs).filter((doc) => !doc.ok);
  if (missing.length) {
    lines.push('Missing / unreadable inputs');
    lines.push('---------------------------');
    missing.forEach((doc) => lines.push(`- ${doc.path}: ${doc.error}`));
    lines.push('');
  }

  const duration = get(battlefield, [
    'session.activeDurationMinutes',
    'session.durationMinutes',
    'window.activeTelemetryMinutes',
    'durationMinutes',
    'runDurationMinutes',
    'summary.durationMinutes',
    'session.activeTelemetryMinutes'
  ], get(preOutcomes, ['runDurationMinutes', 'durationMinutes'], null));
  const events = get(battlefield, ['session.eventCount', 'events', 'eventCount', 'summary.events'], null);
  const dossiers = get(battlefield, ['session.dossierCount', 'dossierCount', 'summary.dossiers'], null);
  const paperEntries = get(battlefield, [
    'preMigrationPaper.entries',
    'pre_migration_paper.entries',
    'paper.entries',
    'summary.paperEntries'
  ], get(paper, ['actual.entries', 'actualPaper.entries', 'entries'], null));
  const paperExits = get(battlefield, [
    'preMigrationPaper.exits',
    'pre_migration_paper.exits',
    'paper.exits',
    'summary.paperExits'
  ], get(paper, ['actual.exits', 'actualPaper.exits', 'exits'], null));
  const paperPnl = get(battlefield, [
    'preMigrationPaper.pnlSol',
    'pre_migration_paper.pnlSol',
    'paper.pnlSol',
    'summary.paperPnlSol'
  ], null);
  const aiEvidence = collectSimpleRuntimeEvidence();
  const aiReachability = buildAiReachability(battlefield);
  const aiHistoricalSummary = simpleRuntimeAiEvidence.summary || {};
  const pumpPortalHealth = buildPumpPortalHealth(battlefield);
  const bondingCurvePressure = buildBondingCurvePressure(battlefield);
  const solanaRpcPressure = buildSolanaRpcPressure(battlefield);
  const runnerLifecycle = battlefield.runnerLane?.simpleRuntimeAiLifecycle || {};
  const signalExecutionLatency = battlefield.runnerLane?.signalExecutionLatencyMs || {};

  lines.push('1. Run Summary');
  lines.push('--------------');
  lines.push(`- Duration: ${duration === null ? 'n/a' : `${fmt(duration)} min`}`);
  lines.push(`- Events: ${events ?? 'n/a'}`);
  lines.push(`- Dossiers: ${dossiers ?? 'n/a'}`);
  lines.push(`- Pre-migration paper entries/exits: ${paperEntries ?? 'n/a'} / ${paperExits ?? 'n/a'}`);
  lines.push(`- Pre-migration paper PnL: ${paperPnl === null ? 'n/a' : sol(paperPnl)}`);
  lines.push(`- Simple Runtime AI string evidence in logs (legacy/warmup included): ${aiEvidence.length ? `found in ${aiEvidence.join(', ')}` : 'not found in run logs/outcome ledger'}`);
  lines.push(`- Historical Simple Runtime AI lifecycle attempts/completed/failed/dangling: ${aiHistoricalSummary.reviewAttempts ?? 'n/a'} / ${aiHistoricalSummary.completedAttempts ?? 'n/a'} / ${aiHistoricalSummary.failedAttempts ?? 'n/a'} / ${aiHistoricalSummary.danglingAttempts ?? 'n/a'}`);
  lines.push(`- Historical Simple Runtime AI legacy telemetry / positive-confidence / live failures: ${aiHistoricalSummary.telemetryEvidenceRows ?? 'n/a'} / ${aiHistoricalSummary.positiveConfidenceRows ?? 'n/a'} / ${aiHistoricalSummary.liveIssueFailureRows ?? 'n/a'}`);
  lines.push('- AI path reachability:');
  lines.push(`  - runner/scalper signals generated/executed: ${aiReachability.generatedSignals} / ${aiReachability.executedSignals}`);
  lines.push(`  - trade rejects before signal execution: ${aiReachability.rejectedTrades}`);
  lines.push(`  - Simple Runtime lifecycle attempts/completed/failed this run: ${aiReachability.lifecycleAttempts} / ${aiReachability.lifecycleCompleted} / ${aiReachability.lifecycleFailed}`);
  if (runnerLifecycle.attempts !== undefined) {
    const completedLatency = runnerLifecycle.completedLatencyMs || {};
    const failedLatency = runnerLifecycle.failedLatencyMs || {};
    lines.push(`  - Simple Runtime latency completed median/p90/max: ${ms(completedLatency.median)} / ${ms(completedLatency.p90)} / ${ms(completedLatency.max)}`);
    lines.push(`  - Simple Runtime latency failed median/p90/max: ${ms(failedLatency.median)} / ${ms(failedLatency.p90)} / ${ms(failedLatency.max)}`);
    lines.push(`  - Simple Runtime attempts exceeding outer timeout: ${runnerLifecycle.attemptsExceedingOuterTimeout ?? 'n/a'}`);
  }
  lines.push(`  - AI decision events / AI rejects / timeout fallbacks: ${aiReachability.aiDecisionEvents} / ${aiReachability.aiRejects} / ${aiReachability.aiTimeoutFallbacks}`);
  if (signalExecutionLatency.count) {
    lines.push(`  - signal->execution latency median/p90/max: ${ms(signalExecutionLatency.median)} / ${ms(signalExecutionLatency.p90)} / ${ms(signalExecutionLatency.max)}`);
  }
  const aiFailureTypeSummary = Object.entries(aiReachability.aiFailureTypes || {})
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
  if (aiFailureTypeSummary) {
    lines.push(`  - AI failure types: ${aiFailureTypeSummary}`);
  }
  lines.push(`  - interpretation: ${aiReachability.interpretation}`);
  lines.push('- PumpPortal feed health:');
  lines.push(`  - status: ${pumpPortalHealth.status}`);
  lines.push(`  - messages / new tokens / trades / migrations: ${pumpPortalHealth.messages} / ${pumpPortalHealth.newTokens} / ${pumpPortalHealth.trades} / ${pumpPortalHealth.migrations}`);
  lines.push(`  - reconnects / closes / stale reconnects: ${pumpPortalHealth.reconnectAttempts} / ${pumpPortalHealth.closeEvents} / ${pumpPortalHealth.staleReconnects}`);
  lines.push(`  - paid trade streams enabled / skipped mints / skipped accounts: ${pumpPortalHealth.paidTradeStreamsEnabled} / ${pumpPortalHealth.tradeSubscriptionsSkippedNoApiKey || pumpPortalHealth.skippedPaidStreamMints} / ${pumpPortalHealth.accountSubscriptionsSkippedNoApiKey}`);
  lines.push(`  - token trade subscription load: active=${pumpPortalHealth.subscribedMints}, max=${pumpPortalHealth.maxSubscribedMints || 'n/a'}, ttl=${pumpPortalHealth.tokenTradeSubscriptionTtlMs ? `${pumpPortalHealth.tokenTradeSubscriptionTtlMs}ms` : 'n/a'}, pruned=${pumpPortalHealth.tokenTradeSubscriptionPrunes || 0} (ttl=${pumpPortalHealth.tokenTradeTtlPrunes || 0}, max=${pumpPortalHealth.tokenTradeMaxActivePrunes || 0}), skippedMax=${pumpPortalHealth.tradeSubscriptionsSkippedMaxActive || 0}`);
  const reconnectDelay = pumpPortalHealth.reconnectResubscribeBatchDelayMs === undefined
    ? 'n/a'
    : `${pumpPortalHealth.reconnectResubscribeBatchDelayMs}ms`;
  lines.push(`  - reconnect resubscribe pressure: max=${pumpPortalHealth.reconnectResubscribeMaxMints || 'n/a'}, batch=${pumpPortalHealth.reconnectResubscribeBatchSize || 'n/a'}, delay=${reconnectDelay}, scheduled/sent/dropped=${pumpPortalHealth.tokenTradeReconnectResubscribeScheduled || 0} / ${pumpPortalHealth.tokenTradeReconnectResubscribeSent || 0} / ${pumpPortalHealth.tokenTradeReconnectResubscribeDropped || 0}`);
  lines.push(`  - subscription ACKs total/new/migration/token/account/unknown: ${pumpPortalHealth.subscriptionAckMessages || 0} / ${pumpPortalHealth.newTokenSubscriptionAcks || 0} / ${pumpPortalHealth.migrationSubscriptionAcks || 0} / ${pumpPortalHealth.tokenTradeSubscriptionAcks || 0} / ${pumpPortalHealth.accountTradeSubscriptionAcks || 0} / ${pumpPortalHealth.unknownSubscriptionAcks || 0}`);
  if (pumpPortalHealth.lastSubscriptionAckMessage) {
    lines.push(`  - last subscription ACK: kind=${pumpPortalHealth.lastSubscriptionAckKind || 'unknown'} message="${pumpPortalHealth.lastSubscriptionAckMessage}"`);
  }
  lines.push(`  - websocket heartbeat: pingInterval=${pumpPortalHealth.pingIntervalMs ? `${pumpPortalHealth.pingIntervalMs}ms` : 'off'}, pings/pongs=${pumpPortalHealth.pingsSent || 0} / ${pumpPortalHealth.pongsReceived || 0}, lastConnectionAge=${pumpPortalHealth.lastConnectionAgeMs === null ? 'n/a' : `${pumpPortalHealth.lastConnectionAgeMs}ms`}`);
  if ((pumpPortalHealth.lifecycle?.closed || 0) > 0) {
    const age = pumpPortalHealth.lifecycle.closeAgeStats || {};
    const subs = pumpPortalHealth.lifecycle.closeSubscribedMintStats || {};
    lines.push(`  - structured close lifecycle: connected/closed/errors=${pumpPortalHealth.lifecycle.connected} / ${pumpPortalHealth.lifecycle.closed} / ${pumpPortalHealth.lifecycle.websocketErrors}, closeAge median/p90/max=${age.median === null ? 'n/a' : `${fmt(age.median, 0)}ms`} / ${age.p90 === null ? 'n/a' : `${fmt(age.p90, 0)}ms`} / ${age.max === null ? 'n/a' : `${fmt(age.max, 0)}ms`}, close subscribedMints median/max=${subs.median === null ? 'n/a' : fmt(subs.median, 0)} / ${subs.max === null ? 'n/a' : fmt(subs.max, 0)}`);
  }
  lines.push(`  - current/max reconnect backoff delay: ${pumpPortalHealth.reconnectDelayMs ? `${pumpPortalHealth.reconnectDelayMs}ms` : 'n/a'} / ${pumpPortalHealth.maxReconnectDelayMs ? `${pumpPortalHealth.maxReconnectDelayMs}ms` : 'n/a'}`);
  lines.push(`  - stable reconnect resets / reset window: ${pumpPortalHealth.reconnectDelayStableResets} / ${pumpPortalHealth.reconnectDelayResetAfterStableMs ? `${pumpPortalHealth.reconnectDelayResetAfterStableMs}ms` : 'n/a'}`);
  lines.push(`  - connected at stop: ${pumpPortalHealth.connected}`);
  lines.push(`  - last close: code=${pumpPortalHealth.lastCloseCode ?? 'n/a'} reason=${pumpPortalHealth.lastCloseReason || 'none'}`);
  lines.push(`  - last websocket error: ${pumpPortalHealth.lastErrorMessage || 'none'}`);
  lines.push(`  - event counts new_token/trade/migration/synthetic_migration: ${pumpPortalHealth.eventCounts.newTokens} / ${pumpPortalHealth.eventCounts.trades} / ${pumpPortalHealth.eventCounts.migrations} / ${pumpPortalHealth.eventCounts.syntheticMigrations}`);
  lines.push(`  - interpretation: ${pumpPortalHealth.interpretation}`);
  lines.push('- Bonding curve pressure:');
  lines.push(`  - fetches / updates / errors: ${bondingCurvePressure.fetches} / ${bondingCurvePressure.updates} / ${bondingCurvePressure.errors}`);
  lines.push(`  - unique complete mints observed / last complete: ${bondingCurvePressure.completeMintsObserved || 0} / ${bondingCurvePressure.lastCompleteMint || 'none'}${bondingCurvePressure.lastCompleteAt ? ` at ${bondingCurvePressure.lastCompleteAt}` : ''}`);
  lines.push(`  - global backoff activations / skipped / high-curve bypasses: ${bondingCurvePressure.globalBackoffActivations} / ${bondingCurvePressure.skippedGlobalBackoff} / ${bondingCurvePressure.skippedGlobalBackoffHighCurveBypass}`);
  lines.push(`  - active / remaining: ${bondingCurvePressure.globalBackoffActive} / ${bondingCurvePressure.globalBackoffRemainingMs}ms`);
  lines.push(`  - last activation: ${bondingCurvePressure.lastGlobalBackoffActivatedAt || 'none'} (${bondingCurvePressure.lastGlobalBackoffErrorsInWindow} errors in window)`);
  lines.push('- Solana RPC pressure:');
  lines.push(`  - primary/fallback providers: ${solanaRpcPressure.primaryProvider || 'n/a'} / ${solanaRpcPressure.fallbackProvider || 'none'}`);
  lines.push(`  - calls primary/fallback: ${solanaRpcPressure.primaryCalls} / ${solanaRpcPressure.fallbackCalls}; failures primary/fallback: ${solanaRpcPressure.primaryFailures} / ${solanaRpcPressure.fallbackFailures}`);
  lines.push(`  - queue active/pending/maxDepth: ${solanaRpcPressure.active} / ${solanaRpcPressure.pending} / ${solanaRpcPressure.maxQueueDepth}; limits maxConcurrent=${solanaRpcPressure.maxConcurrentRequests || 'n/a'}, minInterval=${solanaRpcPressure.minRequestIntervalMs || 0}ms`);
  lines.push('');

  const runnerNearMiss = battlefield.runnerLane?.nearMissDiagnostic || {};
  lines.push('2. Runner / AI Near-Miss Diagnostic');
  lines.push('-----------------------------------');
  lines.push(`- Posture: ${runnerNearMiss.posture || 'n/a'}`);
  lines.push(`- Interpretation: ${runnerNearMiss.interpretation || aiReachability.interpretation}`);
  lines.push('- Rejection reasons:');
  objectLines(runnerNearMiss.rejectionReasons || battlefield.runnerLane?.rejectionReasons, 8)
    .forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Rejection sources:');
  objectLines(runnerNearMiss.rejectionSources || battlefield.runnerLane?.rejectionSources, 8)
    .forEach((line) => lines.push(`  - ${line}`));
  const closestRunnerRejects = topArray(runnerNearMiss.closestRejected, 5);
  lines.push('- Closest rejected candidates:');
  if (closestRunnerRejects.length) {
    closestRunnerRejects.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRunnerReject(item)}`));
  } else {
    lines.push('  - none captured');
  }
  lines.push('');

  const shadowSummary = runnerRaydiumShadow.summary || {};
  const shadowTop = topArray(runnerRaydiumShadow.topByRank, 5);
  const shadowFreshPools = topArray(runnerRaydiumShadow.freshPools, 5);
  const shadowOutcomeRows = topArray(runnerRaydiumShadow.outcomeRows, 5);
  const shadowOutcomeJoinSummary = runnerRaydiumShadowOutcomeJoin.summary || {};
  const shadowMigrationOrNearRows = topArray(runnerRaydiumShadowOutcomeJoin.migrationOrNearRows, 5);
  lines.push('3. Runner Raydium Shadow');
  lines.push('------------------------');
  lines.push('- Mode: report-only; blocked candidates did not generate signals, quotes, AI reviews, or entries.');
  lines.push(`- Observations / unique mints: ${shadowSummary.observations ?? 'n/a'} / ${shadowSummary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Would pass quality/risk counter: ${shadowSummary.wouldPassQualityRiskCount ?? 'n/a'}`);
  lines.push(`- Continuation overlap: ${shadowSummary.continuationOverlapCount ?? 'n/a'}`);
  lines.push(`- Fresh / mature-or-established / age-unknown: ${shadowSummary.freshPoolCount ?? 'n/a'} / ${shadowSummary.matureOrEstablishedCount ?? 'n/a'} / ${shadowSummary.ageUnknownCount ?? 'n/a'}`);
  lines.push(`- Outcome coverage / positive-last / negative-last: ${shadowSummary.outcomeCoverageCount ?? 'n/a'} / ${shadowSummary.positiveLastReturnCount ?? 'n/a'} / ${shadowSummary.negativeLastReturnCount ?? 'n/a'}`);
  const fixedHorizonSummary = runnerRaydiumShadowFixedHorizon.summary?.horizonSummaries || {};
  lines.push('- Fixed-horizon blocked outcomes:');
  ['t5m', 't15m', 't30m'].forEach((key) => {
    const summary = fixedHorizonSummary[key] || {};
    lines.push(`  - ${key}: covered=${summary.coveredMints ?? 'n/a'}, avg=${summary.averageReturnPct === null || summary.averageReturnPct === undefined ? 'n/a' : pct(summary.averageReturnPct, 2)}, median=${summary.medianReturnPct === null || summary.medianReturnPct === undefined ? 'n/a' : pct(summary.medianReturnPct, 2)}, medianLag=${summary.medianSampleLagMinutes === null || summary.medianSampleLagMinutes === undefined ? 'n/a' : `${summary.medianSampleLagMinutes}m`}`);
  });
  const historicalHorizonSummary = runnerRaydiumShadowHistoricalHorizon.summary || {};
  lines.push(`- Historical shadow horizon base: ${historicalHorizonSummary.mintRunPairs ?? 'n/a'} mint-run pairs / ${historicalHorizonSummary.uniqueMints ?? 'n/a'} unique mints.`);
  ['t5m', 't15m', 't30m'].forEach((key) => {
    const summary = historicalHorizonSummary.horizonSummaries?.[key] || {};
    lines.push(`  - historical ${key}: covered=${summary.coveredMints ?? 'n/a'}, avg=${summary.averageReturnPct === null || summary.averageReturnPct === undefined ? 'n/a' : pct(summary.averageReturnPct, 2)}, median=${summary.medianReturnPct === null || summary.medianReturnPct === undefined ? 'n/a' : pct(summary.medianReturnPct, 2)}`);
  });
  lines.push('- Age buckets:');
  objectLines(shadowSummary.ageBuckets, 6).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Source counts:');
  objectLines(shadowSummary.sourceCounts, 6).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Fresh pool rows:');
  if (shadowFreshPools.length) {
    shadowFreshPools.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRaydiumShadow(item)}`));
  } else {
    lines.push('  - none observed');
  }
  lines.push('- Top in-run blocked outcomes:');
  if (shadowOutcomeRows.length) {
    shadowOutcomeRows.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRaydiumShadowOutcome(item)}`));
  } else {
    lines.push('  - none observed');
  }
  lines.push('- Outcome-ledger join:');
  lines.push(`  - Matched / unmatched / migration-or-near: ${shadowOutcomeJoinSummary.matchedOutcomes ?? 'n/a'} / ${shadowOutcomeJoinSummary.unmatchedOutcomes ?? 'n/a'} / ${shadowOutcomeJoinSummary.migrationOrNearCount ?? 'n/a'}`);
  objectLines(shadowOutcomeJoinSummary.outcomeCounts, 5).forEach((line) => lines.push(`  - Joined outcome: ${line}`));
  if (shadowMigrationOrNearRows.length) {
    shadowMigrationOrNearRows.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRaydiumShadowOutcomeJoin(item)}`));
  } else {
    lines.push('  - No blocked shadow mint joined to migration-or-near in this run.');
  }
  lines.push('- Top blocked Raydium shadow rows:');
  if (shadowTop.length) {
    shadowTop.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRaydiumShadow(item)}`));
  } else {
    lines.push('  - none observed; enable RUNNER_RAYDIUM_SHADOW_ENABLED=true for the next PAPER run to collect this diagnostic.');
  }
  lines.push('');

  const walletCorrSummary = walletFirstTouchOutcomeCorr.summary || {};
  const walletMatched = topArray(walletFirstTouchOutcomeCorr.topMatchedOutcomes, 5);
  const walletUnmatched = topArray(walletFirstTouchOutcomeCorr.topUnmatchedClusters, 5);

  lines.push('4. Wallet First-Touch Outcome Correlation');
  lines.push('-----------------------------------------');
  lines.push('- Mode: report-only; joins wallet first-touch clusters to broad outcome labels and does not affect wallet scoring or entries.');
  lines.push(`- Clusters / priority / matched outcomes: ${walletCorrSummary.clusters ?? 'n/a'} / ${walletCorrSummary.priorityClusters ?? 'n/a'} / ${walletCorrSummary.matchedOutcomeDetails ?? 'n/a'}`);
  lines.push(`- Broad-only / false-negative-detail / unknown: ${walletCorrSummary.broadOutcomeMatches ?? 'n/a'} / ${walletCorrSummary.matchedFalseNegativeDetails ?? 'n/a'} / ${walletCorrSummary.unknownOutcomeDetails ?? 'n/a'}`);
  lines.push(`- High-score / multi-wallet / sniper-crowding clusters: ${walletCorrSummary.highScoreClusters ?? 'n/a'} / ${walletCorrSummary.multiWalletClusters ?? 'n/a'} / ${walletCorrSummary.sniperCrowdingClusters ?? 'n/a'}`);
  lines.push(`- Clean early support / mixed-or-late clusters: ${walletCorrSummary.cleanEarlySupportClusters ?? 'n/a'} / ${walletCorrSummary.mixedOrLateClusters ?? 'n/a'}`);
  lines.push(`- Interpretation: ${walletCorrSummary.interpretation || 'n/a'}`);
  if (walletCorrSummary.clusterArchetypeCounts && Object.keys(walletCorrSummary.clusterArchetypeCounts).length) {
    lines.push('- Cluster archetypes:');
    objectLines(walletCorrSummary.clusterArchetypeCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  }
  const walletArchetypePnl = walletCorrSummary.paperPnlByArchetype || {};
  if (Object.keys(walletArchetypePnl).length) {
    lines.push('- Paper PnL by archetype:');
    ['sniper_crowded_cluster', 'clean_early_support_cluster', 'mixed_or_late_cluster', 'multi_wallet_watch_cluster', 'pair_watch_cluster']
      .filter((key) => walletArchetypePnl[key])
      .forEach((key) => lines.push(`  - ${summarizeWalletArchetypePnl(key, walletArchetypePnl[key])}`));
  }
  const walletSniperSummary = walletSniperCrowdedReplay.summary || {};
  if (walletSniperSummary.sniperCrowdedClusters !== undefined) {
    lines.push('- Sniper-crowded current-gate replay:');
    lines.push(`  - Strategy gate: score>=${fmt(walletSniperCrowdedReplay.strategy?.minScore)}, curve>=${fmt(walletSniperCrowdedReplay.strategy?.minCurveProgress, 4)}, vol>=${fmt(walletSniperCrowdedReplay.strategy?.minRecentVolumeSol, 2)} SOL, velocity>=${fmt(walletSniperCrowdedReplay.strategy?.minTradeVelocityPerMin, 2)}/min`);
    lines.push(`  - Current-run clusters / gate pass / gate fail: ${walletSniperSummary.currentRunSniperCrowdedClusters ?? 'n/a'} / ${walletSniperSummary.currentRunGatePassClusters ?? 'n/a'} / ${walletSniperSummary.currentRunGateFailClusters ?? 'n/a'} (${pct(walletSniperSummary.currentRunGatePassRate)} pass)${walletSniperSummary.currentRunTinyDenominatorWarning ? ' | tiny denominator' : ''}`);
    lines.push(`  - ${summarizeWalletSniperReplayBucket('currentRunGatePass', walletSniperSummary.currentRunGatePass || {})}`);
    lines.push(`  - ${summarizeWalletSniperReplayBucket('currentRunGateFail', walletSniperSummary.currentRunGateFail || {})}`);
    lines.push(`  - Cumulative context gate pass/fail: ${walletSniperSummary.gatePassClusters ?? 'n/a'} / ${walletSniperSummary.gateFailClusters ?? 'n/a'} of ${walletSniperSummary.sniperCrowdedClusters ?? 'n/a'} (${pct(walletSniperSummary.gatePassRate)} pass)`);
    lines.push('- Current-run sniper gate failure counts:');
    objectLines(walletSniperSummary.currentRunFailureCounts, 6).forEach((line) => lines.push(`  - ${line}`));
    lines.push(`  - Interpretation: ${walletSniperSummary.interpretation || 'n/a'}`);
    const topSniperPass = topArray(walletSniperCrowdedReplay.topCurrentRunGatePassRows, 3);
    if (topSniperPass.length) {
      lines.push('- Top current-run sniper-crowded gate-pass rows:');
      topSniperPass.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletSniperReplayRow(item)}`));
    }
  }
  lines.push('- Outcome detail sources:');
  objectLines(walletCorrSummary.outcomeDetailSourceCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Matched outcome counts:');
  objectLines(walletCorrSummary.knownOutcomeCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  const walletCohorts = walletCorrSummary.cohortComparisons || {};
  if (Object.keys(walletCohorts).length) {
    lines.push('- Cohort lift vs full outcome ledger:');
    ['allClusters', 'priorityClusters', 'cleanEarlySupportClusters', 'sniperCrowdingClusters', 'mixedOrLateClusters']
      .filter((key) => walletCohorts[key])
      .forEach((key) => lines.push(`  - ${summarizeWalletCohortComparison(key, walletCohorts[key])}`));
  }
  if (walletMatched.length) {
    lines.push('- Top matched clusters:');
    walletMatched.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletFirstTouchOutcome(item)}`));
  } else {
    lines.push('- Top matched clusters: none');
  }
  if (walletUnmatched.length) {
    lines.push('- Top unmatched clusters:');
    walletUnmatched.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletFirstTouchOutcome(item)}`));
  }
  lines.push('');

  const walletPnlSummary = walletPnlEvidence.summary || {};
  const walletPromotionSummary = walletPromotionReview.summary || {};
  const walletLiftSummary = walletPerWalletLift.summary || {};
  const daumenSummary = walletDaumenCohort.summary || {};
  const stableTrustCandidates = topArray(walletPerWalletLift.stableTrustCandidates, 6);
  const stableAvoidCandidates = topArray(walletPerWalletLift.stableAvoidCandidates, 6);
  const topDaumenWallets = topArray(walletDaumenCohort.topDaumenWallets, 8);
  const daumenUseful = topArray(walletDaumenCohort.usefulFirstTouchCandidates, 5);
  const topWalletPnl = topArray(walletPnlEvidence.topPositiveWallets, 5);

  lines.push('4b. Wallet PnL / Promotion Evidence');
  lines.push('------------------------------------');
  lines.push('- Mode: report-only; realized wallet PnL and promotion review do not mutate runtime trust tiers.');
  lines.push(`- PnL evidence wallets / proven / promising / negative: ${walletPnlSummary.wallets ?? 'n/a'} / ${walletPnlSummary.provenPositiveWallets ?? 'n/a'} / ${walletPnlSummary.promisingPositiveWallets ?? 'n/a'} / ${walletPnlSummary.negativeEvidenceWallets ?? 'n/a'}`);
  lines.push(`- Promotion review trust / profitable-needs-touch / watch / avoid / hold: ${walletPromotionSummary.trustReviewWallets ?? 'n/a'} / ${walletPromotionSummary.profitableNeedsFirstTouchEvidenceWallets ?? 'n/a'} / ${walletPromotionSummary.watchReviewWallets ?? 'n/a'} / ${walletPromotionSummary.avoidReviewWallets ?? 'n/a'} / ${walletPromotionSummary.holdWallets ?? 'n/a'}`);
  lines.push(`- Per-wallet lift baselines: ledger positive=${pct(walletLiftSummary.ledgerPositiveRate)}, first-touch positive=${pct(walletLiftSummary.firstTouchPositiveRate)}`);
  if (topWalletPnl.length) {
    lines.push('- Top realized PnL evidence wallets:');
    topWalletPnl.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletPnlEvidence(item)}`));
  }
  lines.push('- Stable trust candidates:');
  if (stableTrustCandidates.length) {
    stableTrustCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletLift(item)}`));
  } else {
    lines.push('  - none yet');
  }
  lines.push('- Stable avoid candidates:');
  if (stableAvoidCandidates.length) {
    stableAvoidCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletLift(item)}`));
  } else {
    lines.push('  - none yet');
  }
  lines.push('- Daumen tracker cohort:');
  lines.push(`  - Wallets / first-touch evidence / no local evidence: ${daumenSummary.daumenWallets ?? 'n/a'} / ${daumenSummary.walletsWithFirstTouchEvidence ?? 'n/a'} / ${daumenSummary.walletsWithoutFirstTouchEvidence ?? 'n/a'}`);
  lines.push(`  - Trust-review / useful-first-touch / watch-review / avoid-review: ${daumenSummary.trustReviewWallets ?? 'n/a'} / ${daumenSummary.usefulFirstTouchCandidates ?? 'n/a'} / ${daumenSummary.watchReviewWallets ?? 'n/a'} / ${daumenSummary.avoidReviewWallets ?? 'n/a'}`);
  lines.push(`  - Touched mints positive / interesting: ${daumenSummary.positiveTouchedMints ?? 'n/a'} of ${daumenSummary.daumenTouchedMints ?? 'n/a'} (${pct(daumenSummary.positiveTouchedMintRate)}) / ${daumenSummary.interestingTouchedMints ?? 'n/a'} of ${daumenSummary.daumenTouchedMints ?? 'n/a'} (${pct(daumenSummary.interestingTouchedMintRate)})`);
  lines.push('  - Cohort classes:');
  objectLines(daumenSummary.byCohortClass, 8).forEach((line) => lines.push(`    - ${line}`));
  if (topDaumenWallets.length) {
    lines.push('  - Top Daumen evidence rows:');
    topDaumenWallets.forEach((item, index) => lines.push(`    ${index + 1}. ${summarizeDaumenWallet(item)}`));
  }
  if (daumenUseful.length) {
    lines.push('  - Useful first-touch candidates needing more review:');
    daumenUseful.forEach((item, index) => lines.push(`    ${index + 1}. ${summarizeDaumenWallet(item)}`));
  }
  lines.push('');

  const walletHistoricalSummary = walletHistoricalRetrospective.summary || {};
  const walletHistoricalAggregate = walletHistoricalRetrospective.aggregate || {};
  const walletCoalitionSummary = walletCoalition.summary || {};
  const timeblockedSummary = walletTimeblockedStability.summary || {};
  const timeblockedAliases = topArray(walletTimeblockedStability.aliasGroups, 4);
  const stableTimeblocked = topArray(walletTimeblockedStability.stableTrustEligibleWallets, 6);
  const paperEntrySummary = walletPaperEntryConditional.summary || {};
  const topMonetizableWallets = topArray(walletPaperEntryConditional.topProfitableWallets, 6);
  const worstMonetizableWallets = topArray(walletPaperEntryConditional.worstWallets, 6);
  const walletBridgeSummary = walletFalseNegativeBridge.summary || {};
  const topStrongWalletLedMisses = topArray(walletFalseNegativeBridge.topStrongWalletLedMisses, 6);
  const walletEntryReplaySummary = walletFalseNegativeEntryReplay.summary || {};
  const topWalletEntryReplayWinners = topArray(walletFalseNegativeEntryReplay.topWouldWinners, 6);
  const walletShapeSummary = walletFalseNegativeShape.summary || {};
  const walletShapeByEarlyMix = walletFalseNegativeShape.byEarlyMix || {};

  lines.push('4c. Wallet Historical / Monetization Check');
  lines.push('------------------------------------------');
  lines.push('- Mode: report-only; historical wallet evidence remains separate from runtime weighting.');
  lines.push(`- Historical sessions / touched sessions / wallet clusters: ${walletHistoricalSummary.sessions ?? 'n/a'} / ${walletHistoricalSummary.sessionsWithWalletTouches ?? 'n/a'} / ${walletHistoricalSummary.historicalWalletClusters ?? 'n/a'}`);
  lines.push(`- Any wallet-touched cluster: positive=${pct(walletHistoricalAggregate.allWalletTouched?.positiveRate)}, interesting=${pct(walletHistoricalAggregate.allWalletTouched?.interestingRate)}, paper pnl=${sol(walletHistoricalAggregate.allWalletTouched?.paperPnlSol ?? 0, 6)}`);
  lines.push(`- Time-blocked canonical wallets / first touches / evaluated rows: ${timeblockedSummary.canonicalWallets ?? 'n/a'} / ${timeblockedSummary.canonicalFirstTouches ?? 'n/a'} / ${timeblockedSummary.evaluatedWalletMintRows ?? 'n/a'}`);
  if (timeblockedAliases.length) {
    lines.push('- Canonical alias groups merged:');
    timeblockedAliases.forEach((item) => lines.push(`  - ${item.canonicalWallet}: ${item.memberWallets?.map((wallet) => wallet.name).join(', ') || 'n/a'}`));
  }
  lines.push('- Stable time-blocked trust-eligible wallets:');
  if (stableTimeblocked.length) {
    stableTimeblocked.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletTimeblocked(item)}`));
  } else {
    lines.push('  - none yet');
  }
  lines.push(`- Coalition pairs / repeated / stable: ${walletCoalitionSummary.totalPairs ?? 'n/a'} / ${walletCoalitionSummary.repeatPairs ?? 'n/a'} / ${walletCoalitionSummary.stablePairs ?? 'n/a'}`);
  lines.push(`- Paper-entry conditional wallet rows / unique entered mints / wallets: ${paperEntrySummary.enteredWalletMintRows ?? 'n/a'} / ${paperEntrySummary.uniqueEnteredMints ?? 'n/a'} / ${paperEntrySummary.walletsWithEnteredMints ?? 'n/a'}`);
  lines.push('- Top monetized wallets on actually-entered mints:');
  if (topMonetizableWallets.length) {
    topMonetizableWallets.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletPaperEntry(item)}`));
  } else {
    lines.push('  - none yet');
  }
  lines.push('- Worst monetized wallets on actually-entered mints:');
  if (worstMonetizableWallets.length) {
    worstMonetizableWallets.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletPaperEntry(item)}`));
  } else {
    lines.push('  - none yet');
  }
  lines.push(`- Wallet-led false-negative bridge: candidates=${walletBridgeSummary.falseNegativeCandidates ?? 'n/a'}, walletTouched=${walletBridgeSummary.walletTouchedCandidates ?? 'n/a'}, pre85Touched=${walletBridgeSummary.pre85WalletTouchedCandidates ?? 'n/a'}, walletLedMisses=${walletBridgeSummary.walletLedMisses ?? 'n/a'}, strongWalletLedMisses=${walletBridgeSummary.strongWalletLedMisses ?? 'n/a'}`);
  lines.push('- Top strong wallet-led skipped winners:');
  if (topStrongWalletLedMisses.length) {
    topStrongWalletLedMisses.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletFalseNegativeBridge(item)}`));
  } else {
    lines.push('  - none yet');
  }
  lines.push(`- Wallet-led entry replay: strongMisses=${walletEntryReplaySummary.strongWalletLedMisses ?? 'n/a'}, wouldEnter=${walletEntryReplaySummary.wouldEnter ?? 'n/a'}, noGateConfirm=${walletEntryReplaySummary.noGateConfirmAfterTouch ?? 'n/a'}, pnl=${walletEntryReplaySummary.totalPnlSol === null || walletEntryReplaySummary.totalPnlSol === undefined ? 'n/a' : sol(walletEntryReplaySummary.totalPnlSol, 6)}, winRate=${pct(walletEntryReplaySummary.winRate)}`);
  lines.push('- Top wallet-led replay rows:');
  if (topWalletEntryReplayWinners.length) {
    topWalletEntryReplayWinners.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeWalletFalseNegativeEntryReplay(item)}`));
  } else {
    lines.push('  - none yet');
  }
  lines.push(`- Wallet-led miss shapes: rows=${walletShapeSummary.rows ?? 'n/a'}, cleanStrong=${walletShapeSummary.cleanStrongRows ?? 'n/a'}, contaminatedStrong=${walletShapeSummary.contaminatedStrongRows ?? 'n/a'}`);
  lines.push(`  - single strong clean: ${summarizeWalletShapeBucket(walletShapeByEarlyMix.single_strong_clean)}`);
  lines.push(`  - strong plus neutral: ${summarizeWalletShapeBucket(walletShapeByEarlyMix.strong_plus_neutral)}`);
  lines.push(`  - strong plus avoid: ${summarizeWalletShapeBucket(walletShapeByEarlyMix.strong_plus_avoid)}`);
  lines.push('');

  const watchFlags = get(battlefield, [
    'watchLane.uniqueCandidates',
    'watch.uniqueCandidates',
    'preMigrationWatch.flags',
    'summary.watchFlags'
  ], get(preOutcomes, ['flags.unique', 'uniqueFlags', 'flags'], null));
  const confirmedWatch = get(battlefield, [
    'preMigrationWatch.confirmed',
    'watch.confirmed',
    'watchLane.confirmed'
  ], get(preOutcomes, ['confirmed', 'watchConfirmed'], null));
  const outcomeCounts = get(ledger, ['summary.outcomeCounts', 'outcomeCounts'], get(preOutcomes, ['summary.outcomeCounts', 'outcomeCounts', 'outcomes'], {}));
  const skipReasons = get(battlefield, [
    'preMigrationPaper.skipReasons',
    'pre_migration_paper.skipReasons',
    'skipReasons'
  ], get(paper, ['skipReasons'], {}));
  const topWatch = topArray(get(battlefield, ['watchLane.topWatch', 'watch.top', 'topWatch'], []), 8);
  const falseNegArray = Array.isArray(falseNeg)
    ? falseNeg
    : topArray(get(falseNeg, ['candidates', 'falseNegatives', 'watchlist', 'items', 'mints'], []), 10);
  const ledgerFalseNegArray = topArray(get(ledger, ['falseNegativeCandidates', 'falseNegatives', 'topFalseNegatives'], []), 10);
  const falseNegatives = falseNegArray.length ? falseNegArray : ledgerFalseNegArray;

  lines.push('5. Pre-Migration Findings');
  lines.push('-------------------------');
  lines.push(`- Watch flags / unique candidates: ${watchFlags ?? 'n/a'}`);
  lines.push(`- Confirmed watch count: ${confirmedWatch ?? 'n/a'}`);
  lines.push('- Outcomes:');
  objectLines(outcomeCounts).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top skip reasons:');
  objectLines(skipReasons).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top false negatives / missed runners:');
  (falseNegatives.length ? falseNegatives : []).slice(0, 8).forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  if (!falseNegatives.length) lines.push('  - none found in false-negative watchlist/report');
  if (topWatch.length) {
    lines.push('- Top watch candidates:');
    topWatch.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  const entryLossSummary = entryLoss.summary || {};
  if (entryLossSummary.entries !== undefined) {
    lines.push('- Entry loss attribution:');
    lines.push(`  - Actual entries/closed W/L/F: ${entryLossSummary.entries ?? 'n/a'} / ${entryLossSummary.closed ?? 'n/a'} ${entryLossSummary.wins ?? 'n/a'}/${entryLossSummary.losses ?? 'n/a'}/${entryLossSummary.flats ?? 'n/a'}, pnl=${sol(entryLossSummary.totalPnlSol ?? 0, 6)}, avg=${entryLossSummary.averagePnlSol === null || entryLossSummary.averagePnlSol === undefined ? 'n/a' : sol(entryLossSummary.averagePnlSol, 6)}`);
    lines.push(`  - First-sight guard entries/PnL: ${entryLossSummary.firstSightGuardEntries ?? 'n/a'} / ${sol(entryLossSummary.firstSightGuardPnlSol ?? 0, 6)}`);
    lines.push(`  - Low-curve(<75%) entries/PnL: ${entryLossSummary.lowCurveEntries ?? 'n/a'} / ${sol(entryLossSummary.lowCurvePnlSol ?? 0, 6)}; high-curve(>=90%) entries/PnL: ${entryLossSummary.highCurveEntries ?? 'n/a'} / ${sol(entryLossSummary.highCurvePnlSol ?? 0, 6)}`);
    lines.push('  - By preset:');
    Object.entries(entryLossSummary.byPreset || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - ${summarizeEntryLossBucket(key, value)}`));
    lines.push('  - By curve band:');
    Object.entries(entryLossSummary.byCurveBand || {}).slice(0, 6).forEach(([key, value]) => lines.push(`    - ${summarizeEntryLossBucket(key, value)}`));
    const topEntryLosers = topArray(entryLoss.topLosers, 5);
    if (topEntryLosers.length) {
      lines.push('  - Worst actual entries:');
      topEntryLosers.forEach((item, index) => lines.push(`    ${index + 1}. ${summarizeEntryLossRow(item)}`));
    }
  }
  const entryTimingSummary = entryTimingPressure.summary || {};
  if (entryTimingSummary.actualEntries !== undefined) {
    lines.push('- Entry timing / exit-pressure comparison:');
    lines.push(`  - Actual/matched/unmatched sim: ${entryTimingSummary.actualEntries ?? 'n/a'} / ${entryTimingSummary.matchedActualToSim ?? 'n/a'} / ${entryTimingSummary.unmatchedSimTrades ?? 'n/a'}`);
    lines.push(`  - Actual better vs sim better: ${entryTimingSummary.actualBetterThanSim ?? 'n/a'} / ${entryTimingSummary.simBetterThanActual ?? 'n/a'}, total actual-minus-sim=${entryTimingSummary.totalActualMinusSimPnlSol === null || entryTimingSummary.totalActualMinusSimPnlSol === undefined ? 'n/a' : sol(entryTimingSummary.totalActualMinusSimPnlSol, 6)}`);
    lines.push(`  - Actual win / sim loss: ${entryTimingSummary.actualWinSimLoss ?? 'n/a'}; sim held to stop: ${entryTimingSummary.simHeldToStop ?? 'n/a'}; avoided deep drawdown: ${entryTimingSummary.actualAvoidedDeepDrawdown ?? 'n/a'}; high-curve pressure: ${entryTimingSummary.highCurveEntryPressure ?? 'n/a'}`);
    const entryInfraContext = entryTimingSummary.entryInfraContext || {};
    if (entryInfraContext.totalEntries !== undefined) {
      lines.push('  - Entry infra context:');
      lines.push(`    - entries fresh/stale/missing curve: ${entryInfraContext.freshCurveUpdateEntries ?? 'n/a'} / ${entryInfraContext.staleCurveUpdateEntries ?? 'n/a'} / ${entryInfraContext.missingCurveUpdateEntries ?? 'n/a'}`);
      lines.push(`    - recent bonding backoff / PumpPortal disconnect: ${entryInfraContext.recentBondingBackoffEntries ?? 'n/a'} / ${entryInfraContext.recentPumpPortalDisconnectEntries ?? 'n/a'}`);
      lines.push(`    - avg/max curve update age: ${entryInfraContext.avgCurveUpdateAgeSeconds === null || entryInfraContext.avgCurveUpdateAgeSeconds === undefined ? 'n/a' : `${entryInfraContext.avgCurveUpdateAgeSeconds}s`} / ${entryInfraContext.maxCurveUpdateAgeSeconds === null || entryInfraContext.maxCurveUpdateAgeSeconds === undefined ? 'n/a' : `${entryInfraContext.maxCurveUpdateAgeSeconds}s`}`);
      lines.push(`    - stale/fresh curve PnL: ${sol(entryInfraContext.staleCurvePnlSol ?? 0, 6)} / ${sol(entryInfraContext.freshCurvePnlSol ?? 0, 6)}`);
      Object.entries(entryInfraContext.byInfraBucket || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - bucket ${summarizeEntryInfraBucket(key, value)}`));
      const infraRows = topArray(entryInfraContext.entryRows, 5);
      if (infraRows.length) {
        lines.push('    - Entry rows:');
        infraRows.forEach((item, index) => lines.push(`      ${index + 1}. ${summarizeEntryInfraRow(item)}`));
      }
    }
    const firstSightFreshness = entryTimingSummary.firstSightScalpFreshness || {};
    if (firstSightFreshness.firstSightEntries !== undefined) {
      lines.push('  - First-sight scalp freshness:');
      lines.push(`    - entries/losses/fast stopouts: ${firstSightFreshness.firstSightEntries ?? 'n/a'} / ${firstSightFreshness.firstSightLosses ?? 'n/a'} / ${firstSightFreshness.firstSightFastStopouts ?? 'n/a'}, pnl=${firstSightFreshness.firstSightPnlSol === null || firstSightFreshness.firstSightPnlSol === undefined ? 'n/a' : sol(firstSightFreshness.firstSightPnlSol, 6)}`);
      lines.push(`    - stale curve updates / recent bonding backoff / recent PumpPortal disconnect: ${firstSightFreshness.staleCurveUpdateEntries ?? 'n/a'} / ${firstSightFreshness.recentBondingBackoffEntries ?? 'n/a'} / ${firstSightFreshness.recentPumpPortalDisconnectEntries ?? 'n/a'}`);
      lines.push(`    - avg curve update age: ${firstSightFreshness.averageCurveUpdateAgeSeconds === null || firstSightFreshness.averageCurveUpdateAgeSeconds === undefined ? 'n/a' : `${firstSightFreshness.averageCurveUpdateAgeSeconds}s`}`);
    }
    const firstSightCohorts = entryTimingSummary.firstSightScalpCohorts || {};
    if (firstSightCohorts.entries !== undefined) {
      lines.push('  - First-sight scalp cohorts:');
      Object.entries(firstSightCohorts.byQualityBucket || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - quality ${summarizeFirstSightCohortBucket(key, value)}`));
      Object.entries(firstSightCohorts.byCurveFreshness || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - freshness ${summarizeFirstSightCohortBucket(key, value)}`));
      Object.entries(firstSightCohorts.byVolumeBucket || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - volume ${summarizeFirstSightCohortBucket(key, value)}`));
      Object.entries(firstSightCohorts.byVelocityBucket || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - velocity ${summarizeFirstSightCohortBucket(key, value)}`));
    }
    const highCurveCohorts = entryTimingSummary.highCurveEntryCohorts || {};
    if (highCurveCohorts.entries !== undefined) {
      lines.push('  - High-curve entry cohorts:');
      Object.entries(highCurveCohorts.byPressureBucket || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - pressure ${summarizeHighCurveCohortBucket(key, value)}`));
      Object.entries(highCurveCohorts.byGuardOverride || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - guard ${summarizeHighCurveCohortBucket(key, value)}`));
      Object.entries(highCurveCohorts.byExitReason || {}).slice(0, 5).forEach(([key, value]) => lines.push(`    - exit ${summarizeHighCurveCohortBucket(key, value)}`));
    }
    lines.push('  - Pressure flags:');
    objectLines(entryTimingSummary.pressureFlagCounts, 8).forEach((line) => lines.push(`    - ${line}`));
    const timingPressureRows = topArray(entryTimingPressure.pressureRows, 5);
    if (timingPressureRows.length) {
      lines.push('  - Top pressure rows:');
      timingPressureRows.forEach((item, index) => lines.push(`    ${index + 1}. ${summarizeEntryTimingPressureRow(item)}`));
    }
  }
  const rollingSummary = rollingEntryTrend.summary || {};
  if (rollingSummary.runsRead !== undefined) {
    lines.push('- Rolling entry trend:');
    lines.push(`  - Runs/entries W/L/F: ${rollingSummary.runsRead ?? 'n/a'} / ${rollingSummary.entries ?? 'n/a'} ${rollingSummary.wins ?? 'n/a'}/${rollingSummary.losses ?? 'n/a'}/${rollingSummary.flats ?? 'n/a'}, pnl=${sol(rollingSummary.totalPnlSol ?? 0, 6)}, avg=${rollingSummary.averagePnlSol === null || rollingSummary.averagePnlSol === undefined ? 'n/a' : sol(rollingSummary.averagePnlSol, 6)}`);
    lines.push(`  - First-sight guard: ${summarizeRollingEntryBucket('FIRST_CURVE_SNAPSHOT_SCALP', rollingSummary.firstSightGuard || {})}`);
    lines.push(`  - Sniper crowded: ${summarizeRollingEntryBucket('sniper_crowded', rollingSummary.sniperCrowded || {})}`);
    lines.push(`  - Wallet touched: ${summarizeRollingEntryBucket('wallet_touched', rollingSummary.walletTouched || {})}`);
    lines.push('  - By guard override:');
    Object.entries(rollingSummary.byGuardOverride || {}).slice(0, 6).forEach(([key, value]) => lines.push(`    - ${summarizeRollingEntryBucket(key, value)}`));
    lines.push('  - By curve band:');
    Object.entries(rollingSummary.byCurveBand || {}).slice(0, 6).forEach(([key, value]) => lines.push(`    - ${summarizeRollingEntryBucket(key, value)}`));
    lines.push('  - By curve freshness:');
    Object.entries(rollingSummary.byCurveFreshness || {}).slice(0, 6).forEach(([key, value]) => lines.push(`    - ${summarizeRollingEntryBucket(key, value)}`));
    lines.push('  - By curve band + freshness:');
    Object.entries(rollingSummary.byCurveBandAndFreshness || {}).slice(0, 6).forEach(([band, freshnessRows]) => {
      Object.entries(freshnessRows || {}).slice(0, 6).forEach(([freshness, value]) => {
        lines.push(`    - ${band}/${summarizeRollingEntryBucket(freshness, value)}`);
      });
    });
    lines.push('  - By sniper crowding:');
    Object.entries(rollingSummary.bySniperCrowdingBucket || {}).slice(0, 6).forEach(([key, value]) => lines.push(`    - ${summarizeRollingEntryBucket(key, value)}`));
    const worstTrendRuns = topArray(rollingEntryTrend.worstRuns, 3);
    if (worstTrendRuns.length) {
      lines.push('  - Worst rolling runs:');
      worstTrendRuns.forEach((item, index) => lines.push(`    ${index + 1}. ${summarizeRollingRun(item)}`));
    }
    const worstTrendEntries = topArray(rollingEntryTrend.worstEntries, 5);
    if (worstTrendEntries.length) {
      lines.push('  - Worst rolling entries:');
      worstTrendEntries.forEach((item, index) => lines.push(`    ${index + 1}. ${summarizeRollingEntryRow(item)}`));
    }
  }
  const entryShapeSummary = entryShape.summary || {};
  if (entryShapeSummary.trades !== undefined) {
    lines.push('- Entry-shape diagnostic:');
    lines.push(`  - Trades W/L: ${entryShapeSummary.trades ?? 'n/a'} ${entryShapeSummary.winners ?? 'n/a'}/${entryShapeSummary.losers ?? 'n/a'}, recurringShapes=${entryShapeSummary.recurringShapeCount ?? 'n/a'}`);
    topArray(entryShape.topPositiveShapes, 3).forEach((item) => {
      lines.push(`  - Positive shape: ${item.shape} | trades=${item.trades ?? 'n/a'} | pnl=${sol(item.pnlSol ?? 0, 6)} | winRate=${pct(item.winRate)}`);
    });
    topArray(entryShape.topNegativeShapes, 3).forEach((item) => {
      lines.push(`  - Negative shape: ${item.shape} | trades=${item.trades ?? 'n/a'} | pnl=${sol(item.pnlSol ?? 0, 6)} | winRate=${pct(item.winRate)}`);
    });
  }
  const entryParitySummary = entryParity.summary || {};
  if (entryParitySummary.simulatedEntries !== undefined) {
    lines.push('- Same-run sim/actual parity:');
    lines.push(`  - Sim / actual / matched / delayed / sim-only / actual-only: ${entryParitySummary.simulatedEntries ?? 'n/a'} / ${entryParitySummary.actualEntries ?? 'n/a'} / ${entryParitySummary.matchedEntries ?? 'n/a'} / ${entryParitySummary.delayedSameMintEntries ?? entryParitySummary.sameMintLaterRuntimeEntries ?? 'n/a'} / ${entryParitySummary.simOnlyEntries ?? 'n/a'} / ${entryParitySummary.actualOnlyEntries ?? 'n/a'}`);
    lines.push(`  - Same-mint later runtime entries: ${entryParitySummary.sameMintLaterRuntimeEntries ?? 'n/a'}`);
    lines.push(`  - Sim-only PnL: ${entryParitySummary.simOnlyPnl?.totalPnlSol === null || entryParitySummary.simOnlyPnl?.totalPnlSol === undefined ? 'n/a' : sol(entryParitySummary.simOnlyPnl.totalPnlSol, 6)} | actual-only PnL: ${entryParitySummary.actualOnlyPnl?.totalPnlSol === null || entryParitySummary.actualOnlyPnl?.totalPnlSol === undefined ? 'n/a' : sol(entryParitySummary.actualOnlyPnl.totalPnlSol, 6)}`);
    const topSimOnly = topArray(entryParity.simOnlyEntries, 3);
    if (topSimOnly.length) {
      topSimOnly.forEach((item) => {
        lines.push(`  - Sim-only: ${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
          + ` | pnl=${item.simPnlSol === null || item.simPnlSol === undefined ? 'n/a' : sol(item.simPnlSol, 6)}`
          + ` | reasons=${Array.isArray(item.nearbyDecisionReasons) && item.nearbyDecisionReasons.length ? item.nearbyDecisionReasons.join(',') : 'none'}`);
      });
    }
    const topLaterRuntime = topArray(entryParity.sameMintLaterRuntimeEntries, 3);
    if (topLaterRuntime.length) {
      topLaterRuntime.forEach((item) => {
        lines.push(`  - Same mint later: ${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
          + ` | delay=${item.runtimeDelaySeconds ?? 'n/a'}s`
          + ` | sim=${item.simPnlSol === null || item.simPnlSol === undefined ? 'n/a' : sol(item.simPnlSol, 6)}`
          + ` | actual=${item.actualPnlSol === null || item.actualPnlSol === undefined ? 'n/a' : sol(item.actualPnlSol, 6)}`);
      });
    }
  }
  const delayedEntryTimingSummary = delayedEntryTiming.summary || {};
  if (delayedEntryTimingSummary.delayedRuntimeEntries !== undefined) {
    lines.push('- Rolling delayed-entry timing:');
    lines.push(`  - Delayed runtime entries / sim-win-actual-loss: ${delayedEntryTimingSummary.delayedRuntimeEntries ?? 'n/a'} / ${delayedEntryTimingSummary.simWonActualLost ?? 'n/a'}`);
    lines.push(`  - Sim PnL / actual PnL / actual-minus-sim: ${delayedEntryTimingSummary.simPnl?.totalPnlSol === null || delayedEntryTimingSummary.simPnl?.totalPnlSol === undefined ? 'n/a' : sol(delayedEntryTimingSummary.simPnl.totalPnlSol, 6)} / ${delayedEntryTimingSummary.actualPnl?.totalPnlSol === null || delayedEntryTimingSummary.actualPnl?.totalPnlSol === undefined ? 'n/a' : sol(delayedEntryTimingSummary.actualPnl.totalPnlSol, 6)} / ${delayedEntryTimingSummary.totalActualMinusSimPnlSol === null || delayedEntryTimingSummary.totalActualMinusSimPnlSol === undefined ? 'n/a' : sol(delayedEntryTimingSummary.totalActualMinusSimPnlSol, 6)}`);
    objectLines(delayedEntryTimingSummary.delayBucketCounts, 4).forEach((line) => lines.push(`  - Delay bucket: ${line}`));
    objectLines(delayedEntryTimingSummary.blockingReasonCountsDuringDelay, 4).forEach((line) => lines.push(`  - Blocking reason during delay: ${line}`));
    topArray(delayedEntryTiming.worstRows, 3).forEach((item) => {
      lines.push(`  - Worst delay: ${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
        + ` | delay=${item.runtimeDelaySeconds ?? 'n/a'}s`
        + ` | sim=${item.simPnlSol === null || item.simPnlSol === undefined ? 'n/a' : sol(item.simPnlSol, 6)}`
        + ` | actual=${item.actualPnlSol === null || item.actualPnlSol === undefined ? 'n/a' : sol(item.actualPnlSol, 6)}`
        + ` | delta=${item.pnlDeltaSol === null || item.pnlDeltaSol === undefined ? 'n/a' : sol(item.pnlDeltaSol, 6)}`);
    });
  }
  const delayedEntryPressureShadowSummary = delayedEntryPressureShadow.summary || {};
  if (delayedEntryPressureShadowSummary.delayedRows !== undefined) {
    lines.push('- Delayed-entry runtime pressure shadow:');
    lines.push(`  - Rows / actual PnL / earlier-anchor replay PnL: ${delayedEntryPressureShadowSummary.delayedRows ?? 'n/a'} / ${delayedEntryPressureShadowSummary.actualPnl?.totalPnlSol === null || delayedEntryPressureShadowSummary.actualPnl?.totalPnlSol === undefined ? 'n/a' : sol(delayedEntryPressureShadowSummary.actualPnl.totalPnlSol, 6)} / ${delayedEntryPressureShadowSummary.simEntryReplayPnl?.totalPnlSol === null || delayedEntryPressureShadowSummary.simEntryReplayPnl?.totalPnlSol === undefined ? 'n/a' : sol(delayedEntryPressureShadowSummary.simEntryReplayPnl.totalPnlSol, 6)}`);
    lines.push(`  - Earlier-anchor gate passed / failed / unavailable: ${delayedEntryPressureShadowSummary.gatePassedEarlierAnchors ?? 'n/a'} / ${delayedEntryPressureShadowSummary.gateFailedEarlierAnchors ?? 'n/a'} / ${delayedEntryPressureShadowSummary.gateEvidenceUnavailableEarlierAnchors ?? 'n/a'}`);
    lines.push(`  - First-recheck replay PnL / actual-minus-early replay: ${delayedEntryPressureShadowSummary.firstRecheckReplayPnl?.totalPnlSol === null || delayedEntryPressureShadowSummary.firstRecheckReplayPnl?.totalPnlSol === undefined ? 'n/a' : sol(delayedEntryPressureShadowSummary.firstRecheckReplayPnl.totalPnlSol, 6)} / ${delayedEntryPressureShadowSummary.actualMinusSimEntryReplayPnlSol === null || delayedEntryPressureShadowSummary.actualMinusSimEntryReplayPnlSol === undefined ? 'n/a' : sol(delayedEntryPressureShadowSummary.actualMinusSimEntryReplayPnlSol, 6)}`);
    topArray(delayedEntryPressureShadow.rows, 3).forEach((item) => {
      lines.push(`  - Pressure shadow: ${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
        + ` | preset=${item.actualPreset || 'n/a'}`
        + ` | early=${item.replays?.simEntry?.pnlSol === null || item.replays?.simEntry?.pnlSol === undefined ? 'n/a' : sol(item.replays.simEntry.pnlSol, 6)}`
        + ` | actual=${item.actualPnlSol === null || item.actualPnlSol === undefined ? 'n/a' : sol(item.actualPnlSol, 6)}`);
    });
  }

  const delayedEntryRecheckSummary = delayedEntryRecheck.summary || {};
  if (delayedEntryRecheckSummary.delayedRows !== undefined) {
    lines.push('- Delayed-entry recheck cadence within sim-to-runtime delay window:');
    lines.push(`  - Rows / with scheduled / with executed: ${delayedEntryRecheckSummary.delayedRows ?? 'n/a'} / ${delayedEntryRecheckSummary.rowsWithScheduledRechecks ?? 'n/a'} / ${delayedEntryRecheckSummary.rowsWithExecutedRechecks ?? 'n/a'}`);
    lines.push(`  - Scheduled / executed / cancelled: ${delayedEntryRecheckSummary.scheduledRechecks ?? 'n/a'} / ${delayedEntryRecheckSummary.executedRechecks ?? 'n/a'} / ${delayedEntryRecheckSummary.cancelledRechecks ?? 'n/a'}`);
    lines.push(`  - Avg first execution lag / avg last execution before entry: ${delayedEntryRecheckSummary.averageFirstExecutionLagSeconds ?? 'n/a'}s / ${delayedEntryRecheckSummary.averageLastExecutionBeforeEntrySeconds ?? 'n/a'}s`);
    lines.push(`  - Any rechecks before actual entry / executed before actual entry: ${delayedEntryRecheckSummary.rowsWithAnyRechecksBeforeActualEntry ?? 'n/a'} / ${delayedEntryRecheckSummary.rowsWithExecutedRechecksBeforeActualEntry ?? 'n/a'}`);
  }
  const simStrategyDeltaSummary = simStrategyDelta.summary || {};
  if (simStrategyDeltaSummary.simulatedTrades !== undefined) {
    lines.push('- Rolling sim/runtime strategy delta:');
    lines.push(`  - Simulated / runtime-comparable / runtime-rejected / no-runtime-decision: ${simStrategyDeltaSummary.simulatedTrades ?? 'n/a'} / ${simStrategyDeltaSummary.runtimeComparableTrades ?? 'n/a'} / ${simStrategyDeltaSummary.runtimeRejectedTrades ?? 'n/a'} / ${simStrategyDeltaSummary.noRuntimeDecisionTrades ?? 'n/a'}`);
    lines.push(`  - All sim PnL: ${simStrategyDeltaSummary.allSimulatedPnl?.totalPnlSol === null || simStrategyDeltaSummary.allSimulatedPnl?.totalPnlSol === undefined ? 'n/a' : sol(simStrategyDeltaSummary.allSimulatedPnl.totalPnlSol, 6)} | comparable sim PnL: ${simStrategyDeltaSummary.comparableSimulatedPnl?.totalPnlSol === null || simStrategyDeltaSummary.comparableSimulatedPnl?.totalPnlSol === undefined ? 'n/a' : sol(simStrategyDeltaSummary.comparableSimulatedPnl.totalPnlSol, 6)} | rejected sim PnL: ${simStrategyDeltaSummary.runtimeRejectedSimulatedPnl?.totalPnlSol === null || simStrategyDeltaSummary.runtimeRejectedSimulatedPnl?.totalPnlSol === undefined ? 'n/a' : sol(simStrategyDeltaSummary.runtimeRejectedSimulatedPnl.totalPnlSol, 6)}`);
    objectLines(simStrategyDeltaSummary.rejectReasonCounts, 4).forEach((line) => lines.push(`  - Rejected sim reason: ${line}`));
  }
  const simRuntimeDivergenceTrendSummary = simRuntimeDivergenceTrend.summary || {};
  if (simRuntimeDivergenceTrendSummary.simulatedTrades !== undefined) {
    lines.push('- Rolling sim/runtime divergence trend:');
    lines.push(`  - Runs / simulated / runtime-comparable / runtime-rejected: ${simRuntimeDivergenceTrend.inputs?.telemetryFilesRead ?? 'n/a'} / ${simRuntimeDivergenceTrendSummary.simulatedTrades ?? 'n/a'} / ${simRuntimeDivergenceTrendSummary.runtimeComparableTrades ?? 'n/a'} / ${simRuntimeDivergenceTrendSummary.runtimeRejectedTrades ?? 'n/a'}`);
    lines.push(`  - Comparable rate: ${pct(simRuntimeDivergenceTrendSummary.comparableRate)}`);
    objectLines(simRuntimeDivergenceTrendSummary.runComparableClassCounts, 4).forEach((line) => lines.push(`  - Run class: ${line}`));
  }
  lines.push('');

  const recoverySummary = noPriorRecovery.summary || {};
  const recoveryCandidates = topArray(noPriorRecovery.recovery, 5);
  const watchOnlyCandidates = topArray(noPriorRecovery.watchOnly, 3);

  lines.push('6. NO_PRIOR Recovery Diagnostic');
  lines.push('-------------------------------');
  lines.push(`- Source candidates: ${recoverySummary.sourceCount ?? 'n/a'}`);
  lines.push(`- Recovery candidates: ${recoverySummary.recoveryCount ?? 'n/a'}`);
  lines.push(`- Watch-only: ${recoverySummary.watchOnlyCount ?? 'n/a'}`);
  lines.push('- Top recovery candidates:');
  if (recoveryCandidates.length) {
    recoveryCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRecoveryCandidate(item)}`));
  } else {
    lines.push('  - none');
  }
  lines.push('- Top failure counts:');
  objectLines(recoverySummary.failureCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (watchOnlyCandidates.length) {
    lines.push('- Watch-only examples:');
    watchOnlyCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRecoveryCandidate(item)}`));
  }
  lines.push('');

  const replaySummary = noPriorReplay.summary || {};
  const replayCandidates = topArray(noPriorReplay.candidates, 5);

  lines.push('7. NO_PRIOR Replay Diagnostic');
  lines.push('-----------------------------');
  lines.push('- Mode: report-only; reconstructs prior curve evidence and does not affect entries.');
  lines.push(`- Recovery candidates / reconstructed NO_PRIOR decisions: ${replaySummary.recoveryCandidates ?? 'n/a'} / ${replaySummary.noPriorDecisionCount ?? 'n/a'}`);
  lines.push(`- Latest-telemetry-backed / historical sample-only candidates: ${replaySummary.sourceCoverage?.telemetryBackedCandidates ?? 'n/a'} / ${replaySummary.sourceCoverage?.sampleOnlyCandidates ?? 'n/a'}`);
  lines.push('- Replay classes:');
  objectLines(replaySummary.replayClassCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Candidate diagnoses:');
  objectLines(replaySummary.diagnosisCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top replay candidates:');
  if (replayCandidates.length) {
    replayCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeNoPriorReplay(item)}`));
  } else {
    lines.push('  - none');
  }
  lines.push('');

  const historicalReplaySummary = noPriorHistoricalReplay.summary || {};
  const historicalReplayRows = topArray(noPriorHistoricalReplay.topReconstructableRows, 5);
  lines.push('7b. NO_PRIOR Historical Replay');
  lines.push('-------------------------------');
  lines.push('- Mode: report-only; maps false negatives back to their own historical telemetry windows before replaying NO_PRIOR evidence.');
  lines.push(`- False negatives / with telemetry window / reconstructable NO_PRIOR rows: ${historicalReplaySummary.falseNegativeCandidates ?? 'n/a'} / ${historicalReplaySummary.candidatesWithTelemetryWindow ?? 'n/a'} / ${historicalReplaySummary.candidatesWithNoPriorDecisions ?? 'n/a'}`);
  lines.push('- Historical diagnoses:');
  objectLines(historicalReplaySummary.diagnosisCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top reconstructable historical rows:');
  if (historicalReplayRows.length) {
    historicalReplayRows.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeNoPriorReplay(item)}`));
  } else {
    lines.push('  - none');
  }
  lines.push('');

  const firstObservedCurveSummary = noPriorFirstObservedCurve.summary || {};
  const firstObservedCurveRows = topArray(noPriorFirstObservedCurve.topFullyBondedRows, 3);
  const firstObservedMidCurveRows = topArray(noPriorFirstObservedCurve.topMidCurveRows, 3);
  lines.push('7c. NO_PRIOR First-Observed Curve');
  lines.push('-----------------------------------');
  lines.push('- Mode: report-only; separates false negatives first seen already fully bonded from those first seen mid-curve.');
  lines.push(`- False negatives / with first curve / fully bonded at first curve / not fully bonded: ${firstObservedCurveSummary.falseNegativeCandidates ?? 'n/a'} / ${firstObservedCurveSummary.candidatesWithFirstObservedCurve ?? 'n/a'} / ${firstObservedCurveSummary.fullyBondedAtFirstObservedCurve ?? 'n/a'} / ${firstObservedCurveSummary.notFullyBondedAtFirstObservedCurve ?? 'n/a'}`);
  lines.push('- First-observed curve buckets:');
  objectLines(firstObservedCurveSummary.firstObservedCurveBucketCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top fully bonded at first observed curve:');
  if (firstObservedCurveRows.length) {
    firstObservedCurveRows.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeNoPriorFirstObservedCurve(item)}`));
  } else {
    lines.push('  - none');
  }
  lines.push('- Top mid-curve at first observed curve:');
  if (firstObservedMidCurveRows.length) {
    firstObservedMidCurveRows.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeNoPriorFirstObservedCurve(item)}`));
  } else {
    lines.push('  - none');
  }
  lines.push('');

  const firstObservedCurveLatencySummary = noPriorFirstObservedCurveLatency.summary || {};
  const fullyBondedLatency = firstObservedCurveLatencySummary.fullyBondedAtFirstObservedCurve || {};
  const midCurveLatency = firstObservedCurveLatencySummary.midCurveAtFirstObservedCurve || {};
  const slowestFirstCurveRows = topArray(noPriorFirstObservedCurveLatency.slowestFirstCurveRows, 3);
  lines.push('7d. NO_PRIOR First-Observed Curve Latency');
  lines.push('-------------------------------------------');
  lines.push('- Mode: report-only; separates discovery timing from first usable curve-state timing.');
  lines.push(`- Rows / fully bonded / mid-curve: ${firstObservedCurveLatencySummary.rows ?? 'n/a'} / ${firstObservedCurveLatencySummary.fullyBondedRows ?? 'n/a'} / ${firstObservedCurveLatencySummary.midCurveRows ?? 'n/a'}`);
  lines.push(`- Fully bonded first-curve delay median / avg / max: ${fullyBondedLatency.firstCurveDelaySeconds?.median ?? 'n/a'}s / ${fullyBondedLatency.firstCurveDelaySeconds?.average ?? 'n/a'}s / ${fullyBondedLatency.firstCurveDelaySeconds?.max ?? 'n/a'}s`);
  lines.push(`- Mid-curve first-curve delay median / avg / max: ${midCurveLatency.firstCurveDelaySeconds?.median ?? 'n/a'}s / ${midCurveLatency.firstCurveDelaySeconds?.average ?? 'n/a'}s / ${midCurveLatency.firstCurveDelaySeconds?.max ?? 'n/a'}s`);
  lines.push('- First usable curve source types:');
  objectLines(firstObservedCurveLatencySummary.firstObservedCurveTypeCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Slowest first usable curve rows:');
  if (slowestFirstCurveRows.length) {
    slowestFirstCurveRows.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
        + ` | firstCurve=${fmt(item.firstObservedCurveProgress, 4)}`
        + ` | bonded=${item.fullyBondedAtFirstObservedCurve ? 'yes' : 'no'}`
        + ` | firstSeenToCurve=${item.secondsFirstCurveAfterFirstSeen ?? 'n/a'}s`
        + ` | source=${item.firstObservedCurveType || 'n/a'}`);
    });
  } else {
    lines.push('  - none');
  }
  lines.push('');

  const nullStateLatencySummary = noPriorBondingCurveNullStateLatency.summary || {};
  const midCurveNullState = nullStateLatencySummary.midCurveAtFirstObservedCurve || {};
  const fullyBondedNullState = nullStateLatencySummary.fullyBondedAtFirstObservedCurve || {};
  const topMidCurveNullRows = topArray(noPriorBondingCurveNullStateLatency.topMidCurveNullBeforeFiniteRows, 3);
  lines.push('7e. NO_PRIOR Bonding-Curve Null-State Latency');
  lines.push('------------------------------------------------');
  lines.push('- Mode: report-only; separates first bonding-curve lane activation from first finite curve availability.');
  lines.push(`- Mid-curve null-before-finite / finite-on-first-update: ${midCurveNullState.nullStateClassCounts?.NULL_BEFORE_FINITE ?? 0} / ${midCurveNullState.nullStateClassCounts?.FINITE_ON_FIRST_UPDATE ?? 0}`);
  lines.push(`- Fully bonded null-before-finite / finite-on-first-update: ${fullyBondedNullState.nullStateClassCounts?.NULL_BEFORE_FINITE ?? 0} / ${fullyBondedNullState.nullStateClassCounts?.FINITE_ON_FIRST_UPDATE ?? 0}`);
  lines.push(`- Mid-curve null-state gap median / avg / max: ${midCurveNullState.nullStateGapSeconds?.median ?? 'n/a'}s / ${midCurveNullState.nullStateGapSeconds?.average ?? 'n/a'}s / ${midCurveNullState.nullStateGapSeconds?.max ?? 'n/a'}s`);
  lines.push(`- Mid-curve rows with accountNotFound before first finite curve: ${midCurveNullState.accountNotFoundBeforeFiniteRows ?? 'n/a'}`);
  lines.push('- Top mid-curve null-before-finite rows:');
  if (topMidCurveNullRows.length) {
    topMidCurveNullRows.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
        + ` | firstCurve=${fmt(item.firstObservedCurveProgress, 4)}`
        + ` | firstUpdateDelay=${item.secondsFirstUpdateAfterFirstSeen ?? 'n/a'}s`
        + ` | nullGap=${item.nullStateGapSeconds ?? 'n/a'}s`
        + ` | nullUpdates=${item.nonFiniteUpdateCountBeforeFirstFinite ?? 'n/a'}`
        + ` | accountNotFound=${item.accountNotFoundCountBeforeFirstFinite ?? 'n/a'}`);
    });
  } else {
    lines.push('  - none');
  }
  lines.push('');

  const latencyDecompositionSummary = noPriorFirstUpdateLatencyDecomposition.summary || {};
  const bondedDecomposition = latencyDecompositionSummary.fullyBondedAtFirstObservedCurve || {};
  const midCurveDecomposition = latencyDecompositionSummary.midCurveAtFirstObservedCurve || {};
  lines.push('7f. NO_PRIOR First-Update Latency Decomposition');
  lines.push('-------------------------------------------------');
  lines.push('- Mode: report-only; splits first-seen -> provider new-token -> first bonding update -> first finite curve -> first paper decision.');
  lines.push(`- Fully bonded provider->bonding median / finite->decision median: ${bondedDecomposition.providerNewTokenToFirstBondingUpdateSeconds?.median ?? 'n/a'}s / ${bondedDecomposition.firstFiniteCurveToFirstPaperDecisionSeconds?.median ?? 'n/a'}s`);
  lines.push(`- Mid-curve provider->bonding median / finite->decision median: ${midCurveDecomposition.providerNewTokenToFirstBondingUpdateSeconds?.median ?? 'n/a'}s / ${midCurveDecomposition.firstFiniteCurveToFirstPaperDecisionSeconds?.median ?? 'n/a'}s`);
  lines.push(`- Fully bonded firstSeen->bonding median / firstSeen->decision median: ${bondedDecomposition.firstSeenToFirstBondingUpdateSeconds?.median ?? 'n/a'}s / ${bondedDecomposition.firstSeenToFirstPaperDecisionSeconds?.median ?? 'n/a'}s`);
  lines.push(`- Mid-curve firstSeen->bonding median / firstSeen->decision median: ${midCurveDecomposition.firstSeenToFirstBondingUpdateSeconds?.median ?? 'n/a'}s / ${midCurveDecomposition.firstSeenToFirstPaperDecisionSeconds?.median ?? 'n/a'}s`);
  lines.push('');

  const paperDecisionCurveSourceSummary = noPriorPaperDecisionCurveSource.summary || {};
  const midCurvePaperDecisionCurveSource = paperDecisionCurveSourceSummary.midCurveAtFirstObservedCurve || {};
  const bondedPaperDecisionCurveSource = paperDecisionCurveSourceSummary.fullyBondedAtFirstObservedCurve || {};
  lines.push('7g. NO_PRIOR Paper-Decision Curve State');
  lines.push('----------------------------------------');
  lines.push('- Mode: report-only; checks whether the first paper decision itself carried a finite curve value.');
  lines.push(`- Mid-curve first decision finite / missing curve: ${midCurvePaperDecisionCurveSource.rowsWithFiniteDecisionCurve ?? 'n/a'} / ${midCurvePaperDecisionCurveSource.rowsWithoutFiniteDecisionCurve ?? 'n/a'}`);
  lines.push(`- Fully bonded first decision finite / missing curve: ${bondedPaperDecisionCurveSource.rowsWithFiniteDecisionCurve ?? 'n/a'} / ${bondedPaperDecisionCurveSource.rowsWithoutFiniteDecisionCurve ?? 'n/a'}`);
  lines.push('- Mid-curve prior finite curve sources before first decision:');
  objectLines(midCurvePaperDecisionCurveSource.priorFiniteCurveSourceTypeCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('');

  const decisionTimeAlternativeStateSummary = noPriorDecisionTimeAlternativeState.summary || {};
  const midCurveAlternativeState = decisionTimeAlternativeStateSummary.midCurveAtFirstObservedCurve || {};
  const bondedAlternativeState = decisionTimeAlternativeStateSummary.fullyBondedAtFirstObservedCurve || {};
  lines.push('7h. NO_PRIOR Decision-Time Alternative State');
  lines.push('---------------------------------------------');
  lines.push('- Mode: report-only; inspects what non-curve state existed when first paper decision curve was missing.');
  lines.push(`- Missing-curve rows / with alternative market state: ${decisionTimeAlternativeStateSummary.rows ?? 'n/a'} / ${decisionTimeAlternativeStateSummary.overall?.rowsWithAlternativeMarketState ?? 'n/a'}`);
  lines.push(`- Mid-curve rows with alternative market state / flagged / new-token / bonding update before decision: ${midCurveAlternativeState.rowsWithAlternativeMarketState ?? 'n/a'} / ${midCurveAlternativeState.rowsWithFlaggedBeforeDecision ?? 'n/a'} / ${midCurveAlternativeState.rowsWithNewTokenBeforeDecision ?? 'n/a'} / ${midCurveAlternativeState.rowsWithBondingUpdateBeforeDecision ?? 'n/a'}`);
  lines.push(`- Fully bonded rows with alternative market state / flagged / new-token / bonding update before decision: ${bondedAlternativeState.rowsWithAlternativeMarketState ?? 'n/a'} / ${bondedAlternativeState.rowsWithFlaggedBeforeDecision ?? 'n/a'} / ${bondedAlternativeState.rowsWithNewTokenBeforeDecision ?? 'n/a'} / ${bondedAlternativeState.rowsWithBondingUpdateBeforeDecision ?? 'n/a'}`);
  lines.push('- Mid-curve alternative state shapes:');
  objectLines(midCurveAlternativeState.alternativeStateShapeCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('');

  const decisionTimeStateAgeSummary = noPriorDecisionTimeStateAge.summary || {};
  const midCurveStateAge = decisionTimeStateAgeSummary.midCurveAtFirstObservedCurve || {};
  const bondedStateAge = decisionTimeStateAgeSummary.fullyBondedAtFirstObservedCurve || {};
  lines.push('7i. NO_PRIOR Decision-Time State Age');
  lines.push('-------------------------------------');
  lines.push('- Mode: report-only; splits missing-curve rows by freshness, trade activity, and bonding-lane coverage.');
  lines.push(`- Mid-curve trade-signal states: ${compactValue(midCurveStateAge.tradeSignalStateCounts)}`);
  lines.push(`- Mid-curve bonding-lane states: ${compactValue(midCurveStateAge.bondingLaneStateCounts)}`);
  lines.push(`- Mid-curve observed age median / flagged age median: ${midCurveStateAge.observedAgeSeconds?.median ?? 'n/a'}s / ${midCurveStateAge.flaggedAgeSeconds?.median ?? 'n/a'}s`);
  lines.push(`- Fully bonded trade-signal states: ${compactValue(bondedStateAge.tradeSignalStateCounts)}`);
  lines.push(`- Fully bonded bonding-lane states: ${compactValue(bondedStateAge.bondingLaneStateCounts)}`);
  lines.push('');

  const followThroughSummary = noPriorFollowThrough.summary || {};
  const followThroughCandidates = topArray(noPriorFollowThrough.candidates, 5);

  lines.push('8. NO_PRIOR Follow-through Diagnostic');
  lines.push('-------------------------------------');
  lines.push('- Mode: report-only; measures 30/60/120s behavior after NO_PRIOR skips and does not affect entries.');
  lines.push(`- NO_PRIOR decisions / unique mints: ${followThroughSummary.noPriorDecisionCount ?? 'n/a'} / ${followThroughSummary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Mints crossing 85/95/100 after skip within 120s: ${followThroughSummary.mintsCrossed85Within120s ?? 'n/a'} / ${followThroughSummary.mintsCrossed95Within120s ?? 'n/a'} / ${followThroughSummary.mintsCrossed100Within120s ?? 'n/a'}`);
  lines.push('- Follow-through classes:');
  objectLines(followThroughSummary.followThroughClassCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top follow-through candidates:');
  if (followThroughCandidates.length) {
    followThroughCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeNoPriorFollowThrough(item)}`));
  } else {
    lines.push('  - none');
  }
  lines.push('');

  const delayedSummary = noPriorDelayedEntry.summary || {};
  const delayedByDelay = delayedSummary.byDelay || {};
  const delayedUniqueMintByDelay = delayedSummary.byDelayUniqueMintEntries || {};
  const delayed120 = delayedByDelay['120s'] || {};
  const delayedUniqueMint120 = delayedUniqueMintByDelay['120s'] || {};
  const delayedPriceUnavailable = Object.values(delayedByDelay)
    .reduce((sum, row) => sum + number(row?.priceUnavailableCount, 0), 0);
  const delayedWinners = topArray(noPriorDelayedEntry.topWouldWinners, 5);
  const delayedLosers = topArray(noPriorDelayedEntry.topWouldLosers, 5);

  lines.push('9. NO_PRIOR Delayed-Entry Replay');
  lines.push('---------------------------------');
  lines.push('- Mode: report-only; reconstructs delayed-entry decisions and does not affect entries.');
  lines.push(`- Decisions / unique mints considered: ${delayedSummary.decisionsConsidered ?? 'n/a'} / ${delayedSummary.uniqueMintsConsidered ?? 'n/a'}`);
  lines.push(`- Would-enter by delay: 30s=${delayedByDelay['30s']?.wouldEnterCount ?? 'n/a'}, 60s=${delayedByDelay['60s']?.wouldEnterCount ?? 'n/a'}, 120s=${delayedByDelay['120s']?.wouldEnterCount ?? 'n/a'}`);
  lines.push(`- Unique-mint would-enter by delay: 30s=${delayedUniqueMintByDelay['30s']?.wouldEnterCount ?? 'n/a'}, 60s=${delayedUniqueMintByDelay['60s']?.wouldEnterCount ?? 'n/a'}, 120s=${delayedUniqueMintByDelay['120s']?.wouldEnterCount ?? 'n/a'}`);
  lines.push(`- Simulated outcomes (delay=120s): TP=${delayed120.wouldExitTpCount ?? 'n/a'}, SL=${delayed120.wouldExitSlCount ?? 'n/a'}, MAX_HOLD=${delayed120.wouldExitMaxHoldCount ?? 'n/a'}, END_OF_RUN=${delayed120.wouldExitEndOfRunCount ?? 'n/a'}, totalPnl=${delayed120.totalPnlSol === null || delayed120.totalPnlSol === undefined ? 'n/a' : sol(delayed120.totalPnlSol, 6)}, winRate=${delayed120.winRate === null || delayed120.winRate === undefined ? 'n/a' : pct(delayed120.winRate)}`);
  lines.push(`- Unique-mint outcomes (delay=120s): TP=${delayedUniqueMint120.wouldExitTpCount ?? 'n/a'}, SL=${delayedUniqueMint120.wouldExitSlCount ?? 'n/a'}, MAX_HOLD=${delayedUniqueMint120.wouldExitMaxHoldCount ?? 'n/a'}, END_OF_RUN=${delayedUniqueMint120.wouldExitEndOfRunCount ?? 'n/a'}, totalPnl=${delayedUniqueMint120.totalPnlSol === null || delayedUniqueMint120.totalPnlSol === undefined ? 'n/a' : sol(delayedUniqueMint120.totalPnlSol, 6)}, winRate=${delayedUniqueMint120.winRate === null || delayedUniqueMint120.winRate === undefined ? 'n/a' : pct(delayedUniqueMint120.winRate)}`);
  lines.push(`- Coverage: priceFound=${delayedSummary.priceCoverage?.decisionsWithPostConfirmPriceSnapshot ?? 'n/a'}, PRICE_UNAVAILABLE=${delayedPriceUnavailable}`);
  if (delayedWinners.length) {
    lines.push('- Top would-winners:');
    delayedWinners.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeDelayedEntryReplay(item)}`));
  } else {
    lines.push('- Top would-winners: none');
  }
  if (delayedLosers.length) {
    lines.push('- Top would-losers:');
    delayedLosers.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeDelayedEntryReplay(item)}`));
  } else {
    lines.push('- Top would-losers: none');
  }
  lines.push('');

  const paperSummary = paper.summary || {};
  const simTrades = Object.prototype.hasOwnProperty.call(paperSummary, 'simulatedTrades')
    ? paperSummary.simulatedTrades
    : get(paper, ['trades', 'simulatedTrades', 'summary.trades'], get(signal, ['summary.trades', 'trades'], null));
  const simWins = Object.prototype.hasOwnProperty.call(paperSummary, 'wins')
    ? paperSummary.wins
    : get(paper, ['wins'], get(signal, ['summary.wins', 'wins'], null));
  const simLosses = Object.prototype.hasOwnProperty.call(paperSummary, 'losses')
    ? paperSummary.losses
    : get(paper, ['losses'], get(signal, ['summary.losses', 'losses'], null));
  const simWinRate = Object.prototype.hasOwnProperty.call(paperSummary, 'winRate')
    ? paperSummary.winRate
    : get(paper, ['winRate'], get(signal, ['summary.winRate', 'winRate'], null));
  const simPnl = Object.prototype.hasOwnProperty.call(paperSummary, 'totalPnlSol')
    ? paperSummary.totalPnlSol
    : get(paper, ['summary.pnlSol', 'pnlSol', 'pnl'], get(signal, ['summary.pnlSol', 'pnlSol', 'pnl'], null));
  const topTrades = topArray(get(paper, ['topTrades', 'tradesDetail', 'tradesList'], []), 5);
  const topWinners = topArray(get(signal, ['topWinners', 'winners'], []), 3);
  const topLosers = topArray(get(signal, ['topLosers', 'losers'], []), 3);

  lines.push('10. Exploratory Candidate Generator Findings');
  lines.push('---------------------------------------------');
  lines.push('- Legacy single-preset exploratory sim; do not read raw sim PnL as runtime-equivalent without the comparable counts above.');
  lines.push(`- Simulated trades: ${simTrades ?? 'n/a'}`);
  lines.push(`- Wins/losses: ${simWins ?? 'n/a'} / ${simLosses ?? 'n/a'}`);
  lines.push(`- Win rate: ${simWinRate === null ? 'n/a' : pct(simWinRate)}`);
  lines.push(`- PnL: ${simPnl === null ? 'n/a' : sol(simPnl, 6)}`);
  if (topTrades.length) {
    lines.push('- Top simulated trades:');
    topTrades.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  if (topWinners.length) {
    lines.push('- Top winners:');
    topWinners.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  if (topLosers.length) {
    lines.push('- Top losers:');
    topLosers.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  lines.push('');

  const opened = get(continuation, ['summary.openedThisRun', 'openedThisRun', 'summary.opened'], null);
  const closed = get(continuation, ['summary.closedThisRun', 'closedThisRun', 'summary.closed'], null);
  const openPositions = get(continuation, ['summary.openPositions', 'openPositions', 'open'], null);
  const openPnlSol = get(continuation, ['summary.openPnlSol', 'openPnlSol', 'openPnlSOL', 'openPnl.sol'], null);
  const openPnlUsd = get(continuation, ['summary.openPnlUsd', 'openPnlUsd', 'openPnlUSD', 'openPnl.usd'], null);
  const continuationOpened = topArray(get(continuation, ['opened', 'openedPositions', 'positionsOpened'], []), 8);
  const continuationSkipped = topArray(get(continuation, ['skippedIneligible', 'skipped', 'ineligible'], []), 8);

  lines.push('11. Continuation Findings');
  lines.push('------------------------');
  lines.push(`- Opened this run: ${opened ?? 'n/a'}`);
  lines.push(`- Closed this run: ${closed ?? 'n/a'}`);
  lines.push(`- Open positions: ${Array.isArray(openPositions) ? openPositions.length : openPositions ?? 'n/a'}`);
  lines.push(`- Open PnL: ${openPnlSol === null ? 'n/a' : sol(openPnlSol, 6)}${openPnlUsd === null ? '' : ` (${money(openPnlUsd, 2)})`}`);
  if (continuationOpened.length) {
    lines.push('- Opened positions:');
    continuationOpened.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  if (continuationSkipped.length) {
    lines.push('- Skipped / ineligible examples:');
    continuationSkipped.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  lines.push('');

  const exitReplaySummary = continuationExitReplay.summary || {};
  const scenarioSummaries = exitReplaySummary.scenarioSummaries || {};
  const currentScenario = scenarioSummaries.current_config_replay || {};
  const noSlipScenario = scenarioSummaries.no_slippage_reference || {};
  const reducedSlippageScenario = scenarioSummaries.reduced_paper_slippage_1_1p5pct || {};
  const oneHourScenario = scenarioSummaries.max_hold_1h || {};
  const twoHourScenario = scenarioSummaries.max_hold_2h || {};
  const fastFade3mScenario = scenarioSummaries.fast_fade_3m || {};
  const fastFade5mScenario = scenarioSummaries.fast_fade_5m || {};
  const fastFade10mScenario = scenarioSummaries.fast_fade_10m || {};
  const trailing5PctScenario = scenarioSummaries.trailing_stop_5pct_new_slippage || {};
  const stagedExitScenario = scenarioSummaries.staged_exit_50_40_10 || {};

  lines.push('12. Continuation Exit Replay');
  lines.push('----------------------------');
  lines.push('- Mode: report-only; replays continuation paper exits from observed state timeline samples and does not affect entries or exits.');
  lines.push(`- Actual positions closed/open: ${exitReplaySummary.actualClosed ?? 'n/a'} / ${exitReplaySummary.actualOpen ?? 'n/a'}`);
  lines.push(`- Actual marked PnL: ${exitReplaySummary.actualPnlSol === null || exitReplaySummary.actualPnlSol === undefined ? 'n/a' : sol(exitReplaySummary.actualPnlSol, 6)}${exitReplaySummary.actualPnlUsd === null || exitReplaySummary.actualPnlUsd === undefined ? '' : ` (${money(exitReplaySummary.actualPnlUsd, 2)})`}`);
  lines.push(`- Actual exit reasons: ${compactValue(exitReplaySummary.actualExitReasons)}`);
  lines.push(`- Stale exit risk count (>24h held): ${exitReplaySummary.staleExitRiskCount ?? 'n/a'}`);
  lines.push(`- Slippage tax likely dominant: ${exitReplaySummary.slippageTaxLikelyDominant === undefined ? 'n/a' : exitReplaySummary.slippageTaxLikelyDominant}`);
  lines.push('- Scenario checks:');
  [
    ['current_config_replay', currentScenario],
    ['reduced_paper_slippage_1_1p5pct', reducedSlippageScenario],
    ['fast_fade_3m', fastFade3mScenario],
    ['fast_fade_5m', fastFade5mScenario],
    ['fast_fade_10m', fastFade10mScenario],
    ['trailing_stop_5pct_new_slippage', trailing5PctScenario],
    ['staged_exit_50_40_10', stagedExitScenario],
    ['max_hold_1h', oneHourScenario],
    ['max_hold_2h', twoHourScenario],
    ['no_slippage_reference', noSlipScenario]
  ].forEach(([name, summary]) => lines.push(`  - ${summarizeContinuationExitScenario(name, summary)}`));
  lines.push(`- Best scenario by total PnL: ${exitReplaySummary.bestScenarioByTotalPnlUsd || 'n/a'}`);
  const slippageSummary = continuationSlippageDecomposition.summary || {};
  lines.push(`- Slippage decomposition: total delta ${slippageSummary.totalSlippageDeltaPnlSol === null || slippageSummary.totalSlippageDeltaPnlSol === undefined ? 'n/a' : sol(slippageSummary.totalSlippageDeltaPnlSol, 6)} across ${slippageSummary.positionsCompared ?? 'n/a'} positions; ratio vs absolute current-config loss ${slippageSummary.slippageDeltaVsAbsoluteCurrentConfigLossRatio ?? 'n/a'}.`);
  lines.push(`- Slippage concentration: top-1 share ${slippageSummary.top1ShareOfTotalDelta ?? 'n/a'}, top-3 share ${slippageSummary.top3ShareOfTotalDelta ?? 'n/a'}, residual after removing top-3 ${slippageSummary.residualAfterTop3DeltaPnlSol === null || slippageSummary.residualAfterTop3DeltaPnlSol === undefined ? 'n/a' : sol(slippageSummary.residualAfterTop3DeltaPnlSol, 6)}.`);
  lines.push('');

  const regime = get(learning, ['regime', 'summary.regime'], null);
  const posture = get(learning, ['recommendations.recommendedPosture', 'recommendedPosture', 'posture', 'summary.recommendedPosture'], null);
  const laneScores = get(learning, ['laneScores'], null);
  const laneRecs = get(learning, ['recommendations.laneRecommendations', 'laneRecommendations', 'recommendations.lanes'], {});
  const lessons = topArray(get(learning, ['lessons'], []), 8);
  const proposals = topArray(get(learning, ['proposals', 'recommendations.proposals'], []), 8);

  lines.push('13. Learning Orchestrator');
  lines.push('------------------------');
  lines.push(`- Regime: ${compactValue(regime)}`);
  lines.push(`- Recommended posture: ${compactValue(posture)}`);
  if (laneScores && typeof laneScores === 'object') {
    lines.push('- Lane scores:');
    objectLines(laneScores).forEach((line) => lines.push(`  - ${line}`));
  }
  if (Array.isArray(laneRecs) && laneRecs.length) {
    lines.push('- Lane recommendations:');
    laneRecs.forEach((rec) => {
      const lane = rec.lane || 'unknown';
      const recPosture = rec.posture || compactValue(rec);
      const rationale = rec.rationale ? ` | ${rec.rationale}` : '';
      lines.push(`  - ${lane}: ${recPosture}${rationale}`);
    });
  } else if (laneRecs && typeof laneRecs === 'object') {
    lines.push('- Lane recommendations:');
    Object.entries(laneRecs).forEach(([lane, rec]) => lines.push(`  - ${lane}: ${compactValue(rec)}`));
  }
  if (lessons.length) {
    lines.push('- Lessons:');
    lessons.forEach((lesson) => lines.push(`  - ${summarizeLesson(lesson)}`));
  }
  if (proposals.length) {
    lines.push('- Proposals from learning report:');
    proposals.forEach((proposal) => lines.push(`  - ${typeof proposal === 'object' ? JSON.stringify(proposal) : proposal}`));
  }
  lines.push('');

  const noPriorCount = number(skipReasons?.NO_PRIOR_CURVE_PROGRESS, null);
  const curveNotAdvancingCount = number(skipReasons?.CURVE_NOT_ADVANCING, null);
  const hasFalseNegatives = falseNegatives.length > 0;
  const continuationOpenNegative = openPnlSol !== null && number(openPnlSol) < 0;
  const simNegative = simPnl !== null && number(simPnl) < 0;
  const simpleRuntimeFired = aiReachability.lifecycleAttempts > 0 || aiReachability.aiDecisionEvents > 0;

  lines.push('14. Evidence-backed Recommendations');
  lines.push('------------------------------------');
  lines.push('1. Keep pre-migration thresholds unchanged for the next validation run.');
  lines.push(`   Evidence: false negatives=${falseNegatives.length}; NO_PRIOR_CURVE_PROGRESS=${noPriorCount ?? 'n/a'}; CURVE_NOT_ADVANCING=${curveNotAdvancingCount ?? 'n/a'}; sim PnL=${simPnl === null ? 'n/a' : sol(simPnl, 6)}.`);
  lines.push('   Risk of changing now: overfitting to one short window and admitting weak first-curve setups.');
  lines.push(`   Status: ${hasFalseNegatives ? 'collect more data before loosening' : 'maintain until stronger false-negative sample appears'}.`);
  lines.push('');

  lines.push('2. Track false negatives explicitly, especially high-score watch candidates that approach 85% migration.');
  lines.push(`   Evidence: false-negative watchlist count=${falseNegatives.length}; outcome distribution=${compactValue(outcomeCounts)}.`);
  lines.push('   Risk of changing now: low if report-only; high if converted directly into entries.');
  lines.push('   Status: implement as analysis/reporting discipline, not entry logic loosening.');
  lines.push('');

  lines.push('3. Keep continuation paper selective and block high-churn / late vertical chase candidates.');
  lines.push(`   Evidence: continuation opened=${opened ?? 'n/a'}, open PnL=${openPnlSol === null ? 'n/a' : sol(openPnlSol, 6)}, skipped/ineligible examples=${continuationSkipped.length}.`);
  lines.push('   Risk of changing now: continuation can bleed quickly in churn regimes.');
  lines.push(`   Status: ${continuationOpenNegative ? 'tighten/maintain caution' : 'maintain current selective bridge'}.`);
  lines.push('');

  lines.push('4. Validate Simple Runtime AI in real candidate flow, not only synthetic smoke.');
  lines.push(`   Evidence: real Simple Runtime AI review path=${simpleRuntimeFired ? 'reached' : 'not reached'}; lifecycle attempts=${aiReachability.lifecycleAttempts}; AI decision events=${aiReachability.aiDecisionEvents}; ${aiReachability.interpretation}`);
  lines.push('   Risk of changing now: treating AI as validated for live decisions before enough real review samples.');
  lines.push('   Status: keep paper-only and monitor for real Simple runtime AI review lines.');
  lines.push('');

  lines.push('5. Prefer deterministic summaries over Cline report interpretation until Cline file-path behavior is reliable.');
  lines.push('   Evidence: this script reads fixed report paths and produces stable fields without asking for missing optional files.');
  lines.push('   Risk of changing now: low; improves repeatability and reduces model drift.');
  lines.push('   Status: use this script after every run before asking any model for review.');
  lines.push('');

  lines.push('Files read');
  lines.push('----------');
  Object.values(docs).forEach((doc) => lines.push(`- ${doc.ok ? 'OK' : 'ERR'} ${doc.path}${doc.error ? ` (${doc.error})` : ''}`));
  lines.push('');

  return lines.join('\n');
}

function writeOutput(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = args.output ? path.resolve(REPO_ROOT, args.output) : DEFAULT_OUTPUT;
  const docs = Object.fromEntries(
    Object.entries(FILES).map(([key, relativePath]) => [key, readJson(relativePath)])
  );
  const summary = buildSummary(docs);
  writeOutput(output, summary);
  console.log(summary);
  console.log(`Wrote summary: ${output}`);
}

main();
