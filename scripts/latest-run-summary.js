const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'data', 'reports', 'latest-run-summary.txt');

const FILES = {
  battlefield: 'data/reports/run-battlefield-latest.json',
  simpleRuntimeAiEvidence: 'data/reports/simple-runtime-ai-evidence-latest.json',
  liveReadiness: 'data/reports/live-readiness-latest.json',
  pumpDevCurveParity: 'data/reports/pumpdev-curve-parity-latest.json',
  pumpDevTargetedCurveParity: 'data/reports/pumpdev-targeted-curve-parity-latest.json',
  eventLoopLagDiagnostic: 'data/reports/event-loop-lag-diagnostic-latest.json',
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
  preMigrationEntryGateMargin: 'data/reports/pre-migration-entry-gate-margin-latest.json',
  preMigrationGuardAttribution: 'data/reports/pre-migration-guard-attribution-latest.json',
  preMigrationSkipFollowThrough: 'data/reports/pre-migration-skip-follow-through-latest.json',
  preMigrationSkipNear90Watchlist: 'data/reports/pre-migration-skip-near-90-watchlist-latest.json',
  preMigrationHighConvictionWatchFollowThrough: 'data/reports/pre-migration-high-conviction-watch-follow-through-latest.json',
  preMigrationDryRunOutcome: 'data/reports/pre-migration-dry-run-outcome-latest.json',
  preMigrationDryRunEntryReplay: 'data/reports/pre-migration-dry-run-entry-replay-latest.json',
  preMigrationCurveConfirmationReplay: 'data/reports/pre-migration-curve-confirmation-replay-latest.json',
  preMigrationRelaxedGateReplay: 'data/reports/pre-migration-relaxed-gate-replay-latest.json',
  preMigrationCurveStallRelaxedReplay: 'data/reports/pre-migration-curve-stall-relaxed-replay-latest.json',
  preMigrationWalletConditionedRelaxedGateReplay: 'data/reports/pre-migration-wallet-conditioned-relaxed-gate-replay-latest.json',
  preMigrationWalletRelaxedShadowOutcome: 'data/reports/pre-migration-wallet-relaxed-shadow-outcome-latest.json',
  preMigrationWalletContextCoverage: 'data/reports/pre-migration-wallet-context-coverage-latest.json',
  preMigrationWalletContextFollowThrough: 'data/reports/pre-migration-wallet-context-follow-through-latest.json',
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
  runnerRejectFollowThrough: 'data/reports/runner-reject-follow-through-latest.json',
  runnerRejectEntryReplay: 'data/reports/runner-reject-entry-replay-latest.json',
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
  walletFalseNegativeShape: 'data/reports/wallet-false-negative-shape-latest.json',
  rickSightingFollowThrough: 'data/reports/rick-sighting-follow-through-latest.json'
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

function bucketCounts(values = [], buckets = []) {
  const counts = {};
  for (const bucket of buckets) counts[bucket.label] = 0;
  for (const value of values) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) continue;
    const bucket = buckets.find((candidate) => (
      (candidate.min === null || parsed >= candidate.min)
      && (candidate.max === null || parsed < candidate.max)
    ));
    if (bucket) counts[bucket.label] += 1;
  }
  return counts;
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

function summarizeSkipFollowThrough(item = {}) {
  const label = candidateLabel(item);
  const w120 = item.window120s || {};
  return `${label} | reason=${item.reason || 'n/a'} | class=${item.followThroughClass || 'n/a'} | curve=${fmt(item.curveProgress, 4)} | delta120=${fmt(w120.curveDelta, 4)} | max120=${fmt(w120.maxCurveProgress, 4)} | priceDelta120=${w120.maxPriceDeltaPct === null || w120.maxPriceDeltaPct === undefined ? 'n/a' : `${fmt(w120.maxPriceDeltaPct, 2)}%`}`;
}

function summarizeSkipNear90Watchlist(item = {}) {
  const label = candidateLabel(item);
  const reasons = Array.isArray(item.reasons) ? item.reasons.join('+') : item.reason || 'n/a';
  const w120 = item.window120s || {};
  const w300 = item.window300s || {};
  return `${label} | reasons=${reasons} | curve=${fmt(item.curveProgress, 4)} | score=${fmt(item.score, 2)} | max120=${fmt(w120.maxCurveProgress, 4)} | cross90_120=${w120.crossed90AfterSkip === true} | priceDelta120=${w120.maxPriceDeltaPct === null || w120.maxPriceDeltaPct === undefined ? 'n/a' : `${fmt(w120.maxPriceDeltaPct, 2)}%`} | max300=${fmt(w300.maxCurveProgress, 4)}`;
}

function summarizeEntryGateMargin(item = {}) {
  const label = candidateLabel(item);
  const gate = item.tightestGate || {};
  const actual = gate.actual === null || gate.actual === undefined ? 'n/a' : fmt(gate.actual, 4);
  const threshold = gate.threshold === null || gate.threshold === undefined ? 'n/a' : fmt(gate.threshold, 4);
  const gateText = gate.name ? `gate=${gate.name} ${actual}/${threshold}` : 'gate=n/a';
  return `${label} | preset=${item.preset || 'n/a'} | reason=${item.reason || 'n/a'} | ready=${fmt(item.readinessPct, 2)}% | ${gateText} | score=${fmt(item.score, 2)} | curve=${fmt(item.curveProgress, 4)} | vol=${fmt(item.recentVolumeSol, 2)} | vel=${fmt(item.tradeVelocityPerMin, 2)}`;
}

function summarizeEntryGateNearMissFollowThrough(name, item = {}) {
  return `${name}: decisions=${item.decisions ?? 'n/a'}, unique=${item.uniqueMints ?? 'n/a'}, future120=${item.decisionsWithFuture120s ?? 'n/a'}, reached85/90/95 unique=${item.uniqueMintsReached85Within120s ?? 'n/a'}/${item.uniqueMintsReached90Within120s ?? 'n/a'}/${item.uniqueMintsReached95Within120s ?? 'n/a'}, crossed95 unique=${item.uniqueMintsCrossed95Within120s ?? 'n/a'}, delta120 med/p90/max=${fmt(item.curveDelta120s?.median, 4)}/${fmt(item.curveDelta120s?.p90, 4)}/${fmt(item.curveDelta120s?.max, 4)}, price120 med/p90/max=${fmt(item.maxPriceDeltaPct120s?.median, 2)}%/${fmt(item.maxPriceDeltaPct120s?.p90, 2)}%/${fmt(item.maxPriceDeltaPct120s?.max, 2)}%`;
}

function summarizeHighConvictionWatchFollowThrough(item = {}) {
  const label = candidateLabel(item);
  const w120 = item.window120s || {};
  const w300 = item.window300s || {};
  const tags = Array.isArray(item.tags) && item.tags.length ? ` | tags=${item.tags.slice(0, 4).join(',')}` : '';
  return `${label} | verdict=${item.verdict || 'n/a'} | score=${fmt(item.score, 2)} | curve=${fmt(item.curveProgress, 4)} | max120=${fmt(w120.maxCurveProgress, 4)} | cross85/90_120=${w120.crossed85AfterWatch === true}/${w120.crossed90AfterWatch === true} | priceDelta120=${w120.maxPriceDeltaPct === null || w120.maxPriceDeltaPct === undefined ? 'n/a' : `${fmt(w120.maxPriceDeltaPct, 2)}%`} | max300=${fmt(w300.maxCurveProgress, 4)}${tags}`;
}

function summarizeHighConvictionWatchDrilldown(item = {}) {
  return `${item.selectionClass || 'n/a'} / ${item.scoreBand || 'n/a'} / ${item.curveBand || 'n/a'}`
    + ` | rows=${item.count ?? 'n/a'} unique=${item.uniqueMints ?? 'n/a'}`
    + ` | cross85/90_120=${item.crossed85Within120s ?? 'n/a'}/${item.crossed90Within120s ?? 'n/a'}`
    + ` | cross85/90_300=${item.crossed85Within300s ?? 'n/a'}/${item.crossed90Within300s ?? 'n/a'}`
    + ` | curveDelta120 med/p90/max=${fmt(item.curveDelta120s?.median, 4)}/${fmt(item.curveDelta120s?.p90, 4)}/${fmt(item.curveDelta120s?.max, 4)}`
    + ` | priceDelta120 med/p90/max=${fmt(item.maxPriceDeltaPct120s?.median, 2)}%/${fmt(item.maxPriceDeltaPct120s?.p90, 2)}%/${fmt(item.maxPriceDeltaPct120s?.max, 2)}%`;
}

function summarizeRelaxedGateTrade(item = {}) {
  const label = candidateLabel(item);
  return `${label} | ${item.exitReason || 'n/a'} | pnl=${sol(item.pnlSol, 6)} | net=${fmt(item.netReturnPct, 2)}% | hold=${fmt(item.holdSeconds, 2)}s | curve=${fmt(item.entryCurveProgress, 4)}->${fmt(item.exitCurveProgress, 4)} | score=${fmt(item.score, 2)} | reason=${item.reasonAtEntry || 'n/a'}`;
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

function summarizeRunnerRejectWakeup(item = {}) {
  const label = item.symbol || item.mint || 'UNKNOWN';
  const w120 = item.windows?.['120s'] || {};
  const w300 = item.windows?.['300s'] || {};
  return `${label} | reason=${item.reason || 'n/a'} | pump=${item.pumpFailureReason || 'n/a'} | momentum=${fmt(item.momentumScore, 4)} | startCurve=${fmt(item.curveProgress, 4)} | max120=${fmt(w120.maxCurveProgress, 4)} | cross85/90_120=${w120.crossed85 === true}/${w120.crossed90 === true} | price120=${w120.maxPriceDeltaPct === null || w120.maxPriceDeltaPct === undefined ? 'n/a' : `${fmt(w120.maxPriceDeltaPct, 2)}%`} | max300=${fmt(w300.maxCurveProgress, 4)}`;
}

function summarizeRunnerRejectReplayProfile(name, item = {}) {
  const winRatePct = item.winRate === null || item.winRate === undefined ? 'n/a' : `${fmt(Number(item.winRate) * 100, 1)}%`;
  const tags = Array.isArray(item.verdictTags) && item.verdictTags.length ? ` tags=${item.verdictTags.join(',')}` : '';
  return `${name}: trades=${item.trades ?? 'n/a'} wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'} winRate=${winRatePct} totalPnlSol=${fmt(item.totalPnlSol, 9)} exTop1Sol=${fmt(item.pnlAfterRemovingTopWinnerSol, 9)} exTop3Sol=${fmt(item.pnlAfterRemovingTop3WinnersSol, 9)} top1GrossShare=${pct(item.topWinnerShareOfGrossProfit)}${tags} returnMed/p90=${fmt(item.returnPct?.median, 2)}%/${fmt(item.returnPct?.p90, 2)}% rawReturnMed=${fmt(item.rawReturnPct?.median, 2)}% exits=${JSON.stringify(item.exitReasons || {})}`;
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

function summarizeEvidencePaths(paths = [], limit = 5) {
  if (!Array.isArray(paths) || paths.length === 0) return 'not found in run logs/outcome ledger';
  const sample = paths.slice(0, limit).join(', ');
  const suffix = paths.length > limit ? `, ... ${paths.length - limit} more` : '';
  return `found ${paths.length} file(s): ${sample}${suffix}`;
}

function buildAiReachability(battlefield = {}) {
  const runner = battlefield.runnerLane || {};
  const eventCounts = battlefield.eventCounts || {};
  const diag = runner.scalperDiagnostics || {};
  const lifecycle = runner.simpleRuntimeAiLifecycle || {};
  const generatedSignals = number(runner.generatedSignals ?? diag.generatedSignals, 0);
  const executedSignals = number(runner.executedSignals ?? diag.executedSignals, 0);
  const rejectedTrades = number(runner.rejectedTrades, 0);
  const quoteRejects = number(diag.quoteRejects, 0);
  const aiRejects = number(diag.aiRejects, 0);
  const lifecycleAttempts = number(lifecycle.attempts, number(eventCounts['simple_runtime_ai.review_started'], 0));
  const lifecycleCompleted = number(lifecycle.completed, number(eventCounts['simple_runtime_ai.review_completed'], 0));
  const lifecycleFailed = number(lifecycle.failed, number(eventCounts['simple_runtime_ai.review_failed'], 0));
  const lifecycleAttemptsExceedingOuterTimeout = number(lifecycle.attemptsExceedingOuterTimeout, 0);
  const lifecycleCompletedLatencyMs = lifecycle.completedLatencyMs || {};
  const lifecycleFailedLatencyMs = lifecycle.failedLatencyMs || {};
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
    lifecycleAttemptsExceedingOuterTimeout,
    lifecycleCompletedLatencyMs,
    lifecycleFailedLatencyMs,
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
    closeConnectionPingsSent: [],
    closeConnectionPongsReceived: [],
    closeConnectionMessages: [],
    closeConnectionNewTokens: [],
    closeConnectionTrades: [],
    closeConnectionMigrations: [],
    closeConnectionControlFrames: [],
    closeConnectionMessagesPerMinute: [],
    closeLastMessageAgeMs: [],
    closeConnectionPairSolEvents: [],
    closeConnectionPairUsdcEvents: [],
    closeConnectionPairUnknownEvents: [],
    lastCloseCode: null,
    lastCloseReason: null
  };
  const makeRoleLifecycle = () => ({
    connected: 0,
    closed: 0,
    websocketErrors: 0,
    staleReconnects: 0,
    closeConnectionAgeMs: [],
    closeSubscribedMints: [],
    closeConnectionPingsSent: [],
    closeConnectionPongsReceived: [],
    closeConnectionMessages: [],
    closeConnectionNewTokens: [],
    closeConnectionTrades: [],
    closeConnectionMigrations: [],
    closeConnectionControlFrames: [],
    closeConnectionMessagesPerMinute: [],
    closeLastMessageAgeMs: [],
    closeConnectionPairSolEvents: [],
    closeConnectionPairUsdcEvents: [],
    closeConnectionPairUnknownEvents: [],
    lastCloseCode: null,
    lastCloseReason: null
  });
  const lifecycleByRole = {
    discovery: makeRoleLifecycle(),
    tradestream: makeRoleLifecycle()
  };
  const pushCloseLifecycle = (target, payload) => {
    target.closed += 1;
    target.closeConnectionAgeMs.push(payload.connectionAgeMs);
    target.closeSubscribedMints.push(payload.subscribedMints);
    target.closeConnectionPingsSent.push(payload.connectionPingsSent);
    target.closeConnectionPongsReceived.push(payload.connectionPongsReceived);
    target.closeConnectionMessages.push(payload.connectionMessages);
    target.closeConnectionNewTokens.push(payload.connectionNewTokens);
    target.closeConnectionTrades.push(payload.connectionTrades);
    target.closeConnectionMigrations.push(payload.connectionMigrations);
    target.closeConnectionControlFrames.push(payload.connectionControlFramesSent);
    target.closeConnectionMessagesPerMinute.push(payload.connectionMessagesPerMinute);
    target.closeLastMessageAgeMs.push(payload.lastMessageAgeMsAtClose);
    target.closeConnectionPairSolEvents.push(payload.connectionPairSolEvents);
    target.closeConnectionPairUsdcEvents.push(payload.connectionPairUsdcEvents);
    target.closeConnectionPairUnknownEvents.push(payload.connectionPairUnknownEvents);
    target.lastCloseCode = payload.code ?? target.lastCloseCode;
    target.lastCloseReason = payload.reason || target.lastCloseReason;
  };
  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'provider.pumpportal.connected') {
          lifecycle.connected += 1;
          const payload = event.payload || event.data || {};
          if (lifecycleByRole[payload.role]) lifecycleByRole[payload.role].connected += 1;
        } else if (event.type === 'provider.pumpportal.closed') {
          const payload = event.payload || event.data || {};
          pushCloseLifecycle(lifecycle, payload);
          if (lifecycleByRole[payload.role]) pushCloseLifecycle(lifecycleByRole[payload.role], payload);
        } else if (event.type === 'provider.pumpportal.websocket_error') {
          lifecycle.websocketErrors += 1;
          const payload = event.payload || event.data || {};
          if (lifecycleByRole[payload.role]) lifecycleByRole[payload.role].websocketErrors += 1;
        } else if (event.type === 'provider.pumpportal.stale_reconnect') {
          lifecycle.staleReconnects += 1;
          const payload = event.payload || event.data || {};
          if (lifecycleByRole[payload.role]) lifecycleByRole[payload.role].staleReconnects += 1;
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
    lifecycle,
    lifecycleByRole
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
  const closeAgeBucketsFor = (values) => bucketCounts(values || [], [
    { label: '<30s', min: null, max: 30_000 },
    { label: '30-90s', min: 30_000, max: 90_000 },
    { label: '90-180s', min: 90_000, max: 180_000 },
    { label: '180-300s', min: 180_000, max: 300_000 },
    { label: '>300s', min: 300_000, max: null }
  ]);
  const lifecycleSummary = (source = {}) => ({
    connected: number(source.connected, 0),
    closed: number(source.closed, 0),
    websocketErrors: number(source.websocketErrors, 0),
    staleReconnects: number(source.staleReconnects, 0),
    closeAgeStats: numericStats(source.closeConnectionAgeMs || []),
    closeAgeBuckets: closeAgeBucketsFor(source.closeConnectionAgeMs || []),
    closeSubscribedMintStats: numericStats(source.closeSubscribedMints || []),
    closeConnectionPingStats: numericStats(source.closeConnectionPingsSent || []),
    closeConnectionPongStats: numericStats(source.closeConnectionPongsReceived || []),
    closeConnectionMessageStats: numericStats(source.closeConnectionMessages || []),
    closeConnectionNewTokenStats: numericStats(source.closeConnectionNewTokens || []),
    closeConnectionTradeStats: numericStats(source.closeConnectionTrades || []),
    closeConnectionMigrationStats: numericStats(source.closeConnectionMigrations || []),
    closeConnectionControlFrameStats: numericStats(source.closeConnectionControlFrames || []),
    closeConnectionMessagesPerMinuteStats: numericStats(source.closeConnectionMessagesPerMinute || []),
    closeLastMessageAgeStats: numericStats(source.closeLastMessageAgeMs || []),
    closeConnectionPairSolStats: numericStats(source.closeConnectionPairSolEvents || []),
    closeConnectionPairUsdcStats: numericStats(source.closeConnectionPairUsdcEvents || []),
    closeConnectionPairUnknownStats: numericStats(source.closeConnectionPairUnknownEvents || [])
  });
  const aggregateLifecycle = lifecycleSummary(lifecycle);
  const roleLifecycle = {
    discovery: lifecycleSummary(telemetry.lifecycleByRole?.discovery || {}),
    tradestream: lifecycleSummary(telemetry.lifecycleByRole?.tradestream || {})
  };
  const closeAgeStats = aggregateLifecycle.closeAgeStats;
  const closeAgeBuckets = aggregateLifecycle.closeAgeBuckets;
  const closeSubscribedMintStats = numericStats(lifecycle.closeSubscribedMints || []);
  const closeConnectionPingStats = numericStats(lifecycle.closeConnectionPingsSent || []);
  const closeConnectionPongStats = numericStats(lifecycle.closeConnectionPongsReceived || []);
  const closeConnectionMessageStats = numericStats(lifecycle.closeConnectionMessages || []);
  const closeConnectionNewTokenStats = numericStats(lifecycle.closeConnectionNewTokens || []);
  const closeConnectionTradeStats = numericStats(lifecycle.closeConnectionTrades || []);
  const closeConnectionMigrationStats = numericStats(lifecycle.closeConnectionMigrations || []);
  const closeConnectionControlFrameStats = numericStats(lifecycle.closeConnectionControlFrames || []);
  const closeConnectionMessagesPerMinuteStats = numericStats(lifecycle.closeConnectionMessagesPerMinute || []);
  const closeLastMessageAgeStats = numericStats(lifecycle.closeLastMessageAgeMs || []);
  const closeConnectionPairSolStats = numericStats(lifecycle.closeConnectionPairSolEvents || []);
  const closeConnectionPairUsdcStats = numericStats(lifecycle.closeConnectionPairUsdcEvents || []);
  const closeConnectionPairUnknownStats = numericStats(lifecycle.closeConnectionPairUnknownEvents || []);
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
  const controlFramesSent = number(stats.controlFramesSent, 0);
  const tokenTradeSubscribeFrames = number(stats.tokenTradeSubscribeFrames, 0);
  const tokenTradeUnsubscribeFrames = number(stats.tokenTradeUnsubscribeFrames, 0);
  const pairSolEvents = number(stats.pairSolEvents, 0);
  const pairUsdcEvents = number(stats.pairUsdcEvents, 0);
  const pairUnknownEvents = number(stats.pairUnknownEvents, 0);
  const newTokenPairSolEvents = number(stats.newTokenPairSolEvents, 0);
  const newTokenPairUsdcEvents = number(stats.newTokenPairUsdcEvents, 0);
  const newTokenPairUnknownEvents = number(stats.newTokenPairUnknownEvents, 0);
  const tradePairSolEvents = number(stats.tradePairSolEvents, 0);
  const tradePairUsdcEvents = number(stats.tradePairUsdcEvents, 0);
  const tradePairUnknownEvents = number(stats.tradePairUnknownEvents, 0);
  const migrationPairSolEvents = number(stats.migrationPairSolEvents, 0);
  const migrationPairUsdcEvents = number(stats.migrationPairUsdcEvents, 0);
  const migrationPairUnknownEvents = number(stats.migrationPairUnknownEvents, 0);
  const lastDetectedPairBase = stats.lastDetectedPairBase || null;
  const lastDetectedPairAt = stats.lastDetectedPairAt
    ? new Date(stats.lastDetectedPairAt).toISOString()
    : null;
  const tradeSubscriptionsSkippedMaxActive = number(stats.tradeSubscriptionsSkippedMaxActive, 0);
  const tokenTradeReconnectResubscribeScheduled = number(stats.tokenTradeReconnectResubscribeScheduled, 0);
  const tokenTradeReconnectResubscribeSent = number(stats.tokenTradeReconnectResubscribeSent, 0);
  const tokenTradeReconnectResubscribeDropped = number(stats.tokenTradeReconnectResubscribeDropped, 0);
  const reconnectResubscribeMaxMints = number(stats.reconnectResubscribeMaxMints, 0);
  const reconnectResubscribeBatchSize = number(stats.reconnectResubscribeBatchSize, 0);
  const reconnectResubscribeBatchDelayMs = number(stats.reconnectResubscribeBatchDelayMs, 0);
  const splitSocketsEnabled = Object.prototype.hasOwnProperty.call(stats, 'splitSocketsEnabled')
    ? stats.splitSocketsEnabled === true
    : null;
  const backupOnly = stats.backupOnly === true;
  const postCloseTradestreamDelayMs = number(stats.postCloseTradestreamDelayMs, 0);
  const postCloseTradestreamGateUntilMs = number(stats.postCloseTradestreamGateUntilMs, 0);
  const eventHandlerConcurrency = number(stats.eventHandlerConcurrency, 0);
  const eventQueueMaxSize = number(stats.eventQueueMaxSize, 0);
  const eventQueueDepth = number(stats.eventQueueDepth, 0);
  const eventQueueMaxDepth = number(stats.eventQueueMaxDepth, 0);
  const eventQueueDropped = number(stats.eventQueueDropped, 0);
  const eventQueueDiscardedOnStop = number(stats.eventQueueDiscardedOnStop, 0);
  const eventQueueProcessed = number(stats.eventQueueProcessed, 0);
  const eventQueueHandlerErrors = number(stats.eventQueueHandlerErrors, 0);
  const eventQueueProcessingActive = number(stats.eventQueueProcessingActive, 0);
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

  if (telemetry.ok) {
    const queueSaturation = eventQueueMaxSize > 0 ? eventQueueMaxDepth / eventQueueMaxSize : 0;
    if (eventQueueDropped > 0) {
      interpretation += ` PumpPortal message handler queue overflowed (${eventQueueDropped} dropped); intake throughput is a bottleneck.`;
    } else if (eventQueueDiscardedOnStop > 0) {
      interpretation += ` PumpPortal message handler queue still had ${eventQueueDiscardedOnStop} queued events at stop; intake throughput is lagging live feed volume.`;
    } else if (queueSaturation >= 0.8) {
      interpretation += ` PumpPortal message handler queue reached ${Math.round(queueSaturation * 100)}% capacity; monitor intake throughput.`;
    }
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
    controlFramesSent,
    tokenTradeSubscribeFrames,
    tokenTradeUnsubscribeFrames,
    pairSolEvents,
    pairUsdcEvents,
    pairUnknownEvents,
    newTokenPairSolEvents,
    newTokenPairUsdcEvents,
    newTokenPairUnknownEvents,
    tradePairSolEvents,
    tradePairUsdcEvents,
    tradePairUnknownEvents,
    migrationPairSolEvents,
    migrationPairUsdcEvents,
    migrationPairUnknownEvents,
    lastDetectedPairBase,
    lastDetectedPairAt,
    tradeSubscriptionsSkippedMaxActive,
    tokenTradeReconnectResubscribeScheduled,
    tokenTradeReconnectResubscribeSent,
    tokenTradeReconnectResubscribeDropped,
    reconnectResubscribeMaxMints,
    reconnectResubscribeBatchSize,
    reconnectResubscribeBatchDelayMs,
    splitSocketsEnabled,
    backupOnly,
    postCloseTradestreamDelayMs,
    postCloseTradestreamGateUntilMs,
    eventHandlerConcurrency,
    eventQueueMaxSize,
    eventQueueDepth,
    eventQueueMaxDepth,
    eventQueueDropped,
    eventQueueDiscardedOnStop,
    eventQueueProcessed,
    eventQueueHandlerErrors,
    eventQueueProcessingActive,
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
      closeAgeBuckets,
      closeSubscribedMintStats,
      closeConnectionPingStats,
      closeConnectionPongStats,
      closeConnectionMessageStats,
      closeConnectionNewTokenStats,
      closeConnectionTradeStats,
      closeConnectionMigrationStats,
      closeConnectionControlFrameStats,
      closeConnectionMessagesPerMinuteStats,
      closeLastMessageAgeStats,
      closeConnectionPairSolStats,
      closeConnectionPairUsdcStats,
      closeConnectionPairUnknownStats
    },
    roles: {
      discovery: {
        ...(stats.discovery || {}),
        lifecycle: roleLifecycle.discovery
      },
      tradestream: {
        ...(stats.tradestream || {}),
        lifecycle: roleLifecycle.tradestream
      }
    },
    crossSocket: {
      bothConnectionsDownCount: number(stats.bothConnectionsDownCount, 0),
      bothConnectionsDownMs: number(stats.bothConnectionsDownMs, 0),
      discoveryEventsWhileTradestreamDown: number(stats.discoveryEventsWhileTradestreamDown, 0),
      tradestreamEventsWhileDiscoveryDown: number(stats.tradestreamEventsWhileDiscoveryDown, 0)
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

function readPumpDevStatsFromTelemetry(battlefield = {}) {
  const telemetryPath = battlefield.telemetryPath || battlefield.files?.telemetryPath;
  let stats = readRuntimeStatsFromTelemetry(battlefield).stats?.pumpDev || null;
  const aggregate = {
    enabled: false,
    connected: false,
    messages: 0,
    newTokens: 0,
    trades: 0,
    migrations: 0,
    mintEvents: 0,
    pairSolEvents: 0,
    pairUsdcEvents: 0,
    pairUnknownEvents: 0,
    newTokenPairSolEvents: 0,
    newTokenPairUsdcEvents: 0,
    newTokenPairUnknownEvents: 0,
    tradePairSolEvents: 0,
    tradePairUsdcEvents: 0,
    tradePairUnknownEvents: 0,
    mintEventPairSolEvents: 0,
    mintEventPairUsdcEvents: 0,
    mintEventPairUnknownEvents: 0,
    openEvents: 0,
    closeEvents: 0,
    errorEvents: 0,
    feedMode: 'unknown',
    drivesPreMigration: false,
    providerCurveSnapshots: 0,
    providerCurveSolSnapshots: 0,
    providerCurveUsdcSnapshots: 0
  };
  const lifecycle = {
    connected: 0,
    closed: 0,
    websocketErrors: 0,
    closeConnectionAgeMs: [],
    closeSubscribedMints: [],
    closeConnectionMessages: [],
    closeConnectionNewTokens: [],
    closeConnectionTrades: [],
    closeConnectionMintEvents: [],
    closeConnectionControlFrames: [],
    closeConnectionMessagesPerMinute: [],
    closeLastMessageAgeMs: [],
    lastCloseCode: null,
    lastCloseReason: null
  };

  if (telemetryPath && fs.existsSync(telemetryPath)) {
    try {
      const lines = fs.readFileSync(telemetryPath, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        const payload = event.payload || event.data || {};
        if (event.type === 'provider.pumpdev.connected') {
          lifecycle.connected += 1;
          aggregate.enabled = true;
          aggregate.connected = true;
          aggregate.openEvents += 1;
        } else if (event.type === 'provider.pumpdev.closed') {
          lifecycle.closed += 1;
          aggregate.enabled = true;
          aggregate.connected = false;
          aggregate.closeEvents += 1;
          lifecycle.closeConnectionAgeMs.push(payload.connectionAgeMs);
          lifecycle.closeSubscribedMints.push(payload.subscribedMints);
          lifecycle.closeConnectionMessages.push(payload.connectionMessages);
          lifecycle.closeConnectionNewTokens.push(payload.connectionNewTokens);
          lifecycle.closeConnectionTrades.push(payload.connectionTrades);
          lifecycle.closeConnectionMintEvents.push(payload.connectionMintEvents);
          lifecycle.closeConnectionControlFrames.push(payload.connectionControlFramesSent);
          lifecycle.closeConnectionMessagesPerMinute.push(payload.connectionMessagesPerMinute);
          lifecycle.closeLastMessageAgeMs.push(payload.lastMessageAgeMsAtClose);
          lifecycle.lastCloseCode = payload.code ?? lifecycle.lastCloseCode;
          lifecycle.lastCloseReason = payload.reason || lifecycle.lastCloseReason;
        } else if (event.type === 'provider.pumpdev.websocket_error') {
          lifecycle.websocketErrors += 1;
          aggregate.enabled = true;
          aggregate.errorEvents += 1;
        } else if (String(event.type || '').startsWith('provider.pumpdev.')) {
          aggregate.enabled = true;
          if (event.type === 'provider.pumpdev.runtime_new_token') {
            aggregate.drivesPreMigration = true;
            aggregate.feedMode = 'primary';
          } else if (event.type === 'provider.pumpdev.runtime_trade') {
            aggregate.drivesPreMigration = true;
            aggregate.feedMode = 'primary';
          }
          if (Number.isFinite(Number(payload.providerCurveProgress))) {
            aggregate.providerCurveSnapshots += 1;
            const providerPairBase = String(payload.pairBase || '').toUpperCase();
            if (providerPairBase === 'SOL') aggregate.providerCurveSolSnapshots += 1;
            else if (providerPairBase === 'USDC') aggregate.providerCurveUsdcSnapshots += 1;
          }
          if (event.type === 'provider.pumpdev.shadow_new_token') {
            aggregate.messages += 1;
            aggregate.newTokens += 1;
            const pairBase = String(payload.pairBase || '').toUpperCase();
            if (pairBase === 'SOL') {
              aggregate.pairSolEvents += 1;
              aggregate.newTokenPairSolEvents += 1;
            } else if (pairBase === 'USDC') {
              aggregate.pairUsdcEvents += 1;
              aggregate.newTokenPairUsdcEvents += 1;
            } else {
              aggregate.pairUnknownEvents += 1;
              aggregate.newTokenPairUnknownEvents += 1;
            }
          } else if (event.type === 'provider.pumpdev.shadow_trade') {
            aggregate.messages += 1;
            aggregate.trades += 1;
            const pairBase = String(payload.pairBase || '').toUpperCase();
            if (pairBase === 'SOL') {
              aggregate.pairSolEvents += 1;
              aggregate.tradePairSolEvents += 1;
            } else if (pairBase === 'USDC') {
              aggregate.pairUsdcEvents += 1;
              aggregate.tradePairUsdcEvents += 1;
            } else {
              aggregate.pairUnknownEvents += 1;
              aggregate.tradePairUnknownEvents += 1;
            }
          } else if (event.type === 'provider.pumpdev.shadow_mint_event') {
            aggregate.messages += 1;
            aggregate.mintEvents += 1;
            const pairBase = String(payload.pairBase || '').toUpperCase();
            if (pairBase === 'SOL') {
              aggregate.pairSolEvents += 1;
              aggregate.mintEventPairSolEvents += 1;
            } else if (pairBase === 'USDC') {
              aggregate.pairUsdcEvents += 1;
              aggregate.mintEventPairUsdcEvents += 1;
            } else {
              aggregate.pairUnknownEvents += 1;
              aggregate.mintEventPairUnknownEvents += 1;
            }
          } else if (event.type === 'provider.pumpdev.shadow_migration') {
            aggregate.messages += 1;
            aggregate.migrations += 1;
          }
        }
        const pumpDev = get(event, [
          'payload.stats.pumpDev',
          'data.stats.pumpDev',
          'payload.pumpDev',
          'data.pumpDev'
        ]);
        if (pumpDev) stats = pumpDev;
      }
    } catch {}
  }

  if (aggregate.enabled) {
    stats = {
      ...(stats || {}),
      enabled: true,
      connected: stats?.connected === true,
      feedMode: aggregate.feedMode !== 'unknown' ? aggregate.feedMode : (stats?.feedMode || 'shadow'),
      drivesPreMigration: Boolean(stats?.drivesPreMigration || aggregate.drivesPreMigration),
      messages: Math.max(number(stats?.messages, 0), aggregate.messages),
      newTokens: Math.max(number(stats?.newTokens, 0), aggregate.newTokens),
      trades: Math.max(number(stats?.trades, 0), aggregate.trades),
      migrations: Math.max(number(stats?.migrations, 0), aggregate.migrations),
      mintEvents: Math.max(number(stats?.mintEvents, 0), aggregate.mintEvents),
      pairSolEvents: Math.max(number(stats?.pairSolEvents, 0), aggregate.pairSolEvents),
      pairUsdcEvents: Math.max(number(stats?.pairUsdcEvents, 0), aggregate.pairUsdcEvents),
      pairUnknownEvents: Math.max(number(stats?.pairUnknownEvents, 0), aggregate.pairUnknownEvents),
      newTokenPairSolEvents: Math.max(number(stats?.newTokenPairSolEvents, 0), aggregate.newTokenPairSolEvents),
      newTokenPairUsdcEvents: Math.max(number(stats?.newTokenPairUsdcEvents, 0), aggregate.newTokenPairUsdcEvents),
      newTokenPairUnknownEvents: Math.max(number(stats?.newTokenPairUnknownEvents, 0), aggregate.newTokenPairUnknownEvents),
      tradePairSolEvents: Math.max(number(stats?.tradePairSolEvents, 0), aggregate.tradePairSolEvents),
      tradePairUsdcEvents: Math.max(number(stats?.tradePairUsdcEvents, 0), aggregate.tradePairUsdcEvents),
      tradePairUnknownEvents: Math.max(number(stats?.tradePairUnknownEvents, 0), aggregate.tradePairUnknownEvents),
      mintEventPairSolEvents: Math.max(number(stats?.mintEventPairSolEvents, 0), aggregate.mintEventPairSolEvents),
      mintEventPairUsdcEvents: Math.max(number(stats?.mintEventPairUsdcEvents, 0), aggregate.mintEventPairUsdcEvents),
      mintEventPairUnknownEvents: Math.max(number(stats?.mintEventPairUnknownEvents, 0), aggregate.mintEventPairUnknownEvents),
      openEvents: Math.max(number(stats?.openEvents, 0), aggregate.openEvents),
      closeEvents: Math.max(number(stats?.closeEvents, 0), aggregate.closeEvents),
      errorEvents: Math.max(number(stats?.errorEvents, 0), aggregate.errorEvents),
      providerCurveSnapshots: Math.max(number(stats?.providerCurveSnapshots, 0), aggregate.providerCurveSnapshots),
      providerCurveSolSnapshots: Math.max(number(stats?.providerCurveSolSnapshots, 0), aggregate.providerCurveSolSnapshots),
      providerCurveUsdcSnapshots: Math.max(number(stats?.providerCurveUsdcSnapshots, 0), aggregate.providerCurveUsdcSnapshots)
    };
  }

  return {
    telemetryPath,
    stats,
    lifecycle,
    error: stats ? null : 'pumpDev stats not found'
  };
}

function buildPumpDevHealth(battlefield = {}) {
  const telemetry = readPumpDevStatsFromTelemetry(battlefield);
  const stats = telemetry.stats || {};
  const lifecycle = telemetry.lifecycle || {};
  const eventCounts = battlefield.eventCounts || {};
  const newTokens = number(stats.newTokens, number(eventCounts['provider.pumpdev.shadow_new_token'], 0));
  const trades = number(stats.trades, number(eventCounts['provider.pumpdev.shadow_trade'], 0));
  const migrations = number(stats.migrations, number(eventCounts['provider.pumpdev.shadow_migration'], 0));
  const mintEvents = number(stats.mintEvents, number(eventCounts['provider.pumpdev.shadow_mint_event'], 0));
  const closeAgeBuckets = bucketCounts(lifecycle.closeConnectionAgeMs || [], [
    { label: '<30s', min: null, max: 30_000 },
    { label: '30-90s', min: 30_000, max: 90_000 },
    { label: '90-180s', min: 90_000, max: 180_000 },
    { label: '180-300s', min: 180_000, max: 300_000 },
    { label: '>300s', min: 300_000, max: null }
  ]);
  const closed = number(lifecycle.closed, number(stats.closeEvents, 0));
  const errors = number(lifecycle.websocketErrors, number(stats.errorEvents, 0));
  const connected = stats.connected === true;
  const enabled = stats.enabled === true || newTokens > 0 || trades > 0 || mintEvents > 0 || migrations > 0;
  const status = !enabled
    ? 'disabled'
    : errors > 0 || closed > 0
      ? 'churn'
      : connected || newTokens > 0 || trades > 0
        ? 'healthy'
        : 'idle';
  let interpretation = 'PumpDev shadow feed is disabled.';
  const drivesPreMigration = stats.drivesPreMigration === true
    || number(eventCounts['provider.pumpdev.runtime_new_token'], 0) > 0
    || number(eventCounts['provider.pumpdev.runtime_trade'], 0) > 0;
  const feedMode = stats.feedMode || (drivesPreMigration ? 'primary' : 'shadow');
  const label = drivesPreMigration ? 'primary' : 'shadow';
  const primarySilenceTimeouts = number(eventCounts['provider.pumpdev.primary_silence_timeout'], 0);
  const marketEvents = newTokens + trades + migrations + mintEvents;
  if (enabled && errors === 0 && closed === 0 && newTokens > 0 && trades > 0) {
    interpretation = `PumpDev ${label} feed delivered new-token and token-trade events without connection failure.`;
  } else if (primarySilenceTimeouts > 0) {
    interpretation = `PumpDev ${label} feed produced no market events before the fail-fast silence timeout; treat this run as a provider/feed-health test, not strategy evidence.`;
  } else if (enabled && closed > 0) {
    interpretation = `PumpDev ${label} feed closed during the run; compare closeAge and close traffic against PumpPortal.`;
  } else if (enabled && newTokens > 0 && trades === 0) {
    interpretation = `PumpDev ${label} new-token stream is working, but token-trade sampling did not produce trades.`;
  } else if (enabled && marketEvents === 0 && number(stats.systemMessages, 0) > 0) {
    interpretation = `PumpDev ${label} websocket opened but delivered only system/subscription messages; no strategy conclusions should be drawn.`;
  }

  return {
    ok: Boolean(stats),
    error: telemetry.error,
    status,
    enabled,
    feedMode,
    drivesPreMigration,
    connected,
    messages: number(stats.messages, 0),
    systemMessages: number(stats.systemMessages, 0),
    newTokens,
    trades,
    migrations,
    mintEvents,
    unknownMessages: number(stats.unknownMessages, 0),
    knownMints: number(stats.knownMints, 0),
    subscribedMints: number(stats.subscribedMints, 0),
    maxSubscribedMints: number(stats.maxSubscribedMints, 0),
    controlFramesSent: number(stats.controlFramesSent, 0),
    tokenTradeSubscribeFrames: number(stats.tokenTradeSubscribeFrames, 0),
    eventQueueActive: number(stats.eventQueueActive, 0),
    eventQueueDepth: number(stats.eventQueueDepth, 0),
    eventQueueMaxDepth: number(stats.eventQueueMaxDepth, 0),
    eventQueueMaxSize: number(stats.eventQueueMaxSize, 0),
    eventHandlerConcurrency: number(stats.eventHandlerConcurrency, 0),
    eventQueueProcessed: number(stats.eventQueueProcessed, 0),
    eventQueueDropped: number(stats.eventQueueDropped, 0),
    eventQueueDiscardedOnStop: number(stats.eventQueueDiscardedOnStop, 0),
    eventQueueErrors: number(stats.eventQueueErrors, 0),
    pairSolEvents: number(stats.pairSolEvents, 0),
    pairUsdcEvents: number(stats.pairUsdcEvents, 0),
    pairUnknownEvents: number(stats.pairUnknownEvents, 0),
    newTokenPairSolEvents: number(stats.newTokenPairSolEvents, 0),
    newTokenPairUsdcEvents: number(stats.newTokenPairUsdcEvents, 0),
    newTokenPairUnknownEvents: number(stats.newTokenPairUnknownEvents, 0),
    tradePairSolEvents: number(stats.tradePairSolEvents, 0),
    tradePairUsdcEvents: number(stats.tradePairUsdcEvents, 0),
    tradePairUnknownEvents: number(stats.tradePairUnknownEvents, 0),
    mintEventPairSolEvents: number(stats.mintEventPairSolEvents, 0),
    mintEventPairUsdcEvents: number(stats.mintEventPairUsdcEvents, 0),
    mintEventPairUnknownEvents: number(stats.mintEventPairUnknownEvents, 0),
    providerCurveSnapshots: number(stats.providerCurveSnapshots, 0),
    providerCurveSolSnapshots: number(stats.providerCurveSolSnapshots, 0),
    providerCurveUsdcSnapshots: number(stats.providerCurveUsdcSnapshots, 0),
    primarySilenceFailFastEnabled: stats.primarySilenceFailFastEnabled === true,
    primarySilenceTimeoutMs: number(stats.primarySilenceTimeoutMs, 0),
    primarySilenceElapsedMs: number(stats.primarySilenceElapsedMs, null),
    primarySilenceTripped: stats.primarySilenceTripped === true || primarySilenceTimeouts > 0,
    primarySilenceTimeouts,
    pingsSent: number(stats.pingsSent, 0),
    pongsReceived: number(stats.pongsReceived, 0),
    pingIntervalMs: number(stats.pingIntervalMs, 0),
    reconnectAttempts: number(stats.reconnectAttempts, 0),
    closeEvents: closed,
    errorEvents: errors,
    lastCloseCode: stats.lastCloseCode ?? lifecycle.lastCloseCode ?? null,
    lastCloseReason: stats.lastCloseReason || lifecycle.lastCloseReason || null,
    lastErrorMessage: stats.lastErrorMessage || null,
    lifecycle: {
      connected: number(lifecycle.connected, 0),
      closed,
      websocketErrors: errors,
      closeAgeStats: numericStats(lifecycle.closeConnectionAgeMs || []),
      closeAgeBuckets,
      closeSubscribedMintStats: numericStats(lifecycle.closeSubscribedMints || []),
      closeConnectionMessageStats: numericStats(lifecycle.closeConnectionMessages || []),
      closeConnectionNewTokenStats: numericStats(lifecycle.closeConnectionNewTokens || []),
      closeConnectionTradeStats: numericStats(lifecycle.closeConnectionTrades || []),
      closeConnectionMintEventStats: numericStats(lifecycle.closeConnectionMintEvents || []),
      closeConnectionControlFrameStats: numericStats(lifecycle.closeConnectionControlFrames || []),
      closeConnectionMessagesPerMinuteStats: numericStats(lifecycle.closeConnectionMessagesPerMinute || []),
      closeLastMessageAgeStats: numericStats(lifecycle.closeLastMessageAgeMs || [])
    },
    eventCounts: {
      newTokens: number(eventCounts['provider.pumpdev.shadow_new_token'], newTokens),
      trades: number(eventCounts['provider.pumpdev.shadow_trade'], trades),
      migrations: number(eventCounts['provider.pumpdev.shadow_migration'], migrations),
      mintEvents: number(eventCounts['provider.pumpdev.shadow_mint_event'], mintEvents),
      runtimeNewTokens: number(eventCounts['provider.pumpdev.runtime_new_token'], 0),
      runtimeTrades: number(eventCounts['provider.pumpdev.runtime_trade'], 0)
    },
    interpretation
  };
}

function buildBondingCurvePressure(battlefield = {}) {
  const telemetry = readRuntimeStatsFromTelemetry(battlefield);
  const stats = telemetry.stats?.pumpBondingCurveLane || {};
  const eventCounts = battlefield.eventCounts || {};
  const updateEvents = number(eventCounts['pump_bonding_curve.updated'], 0);
  const providerSnapshotEvents = number(eventCounts['pump_bonding_curve.provider_snapshot'], 0);
  const completeEvents = number(eventCounts['pump_bonding_curve.complete'], 0)
    + number(eventCounts['pump_bonding_curve.synthetic_migration'], 0);
  return {
    ok: telemetry.ok && Boolean(telemetry.stats?.pumpBondingCurveLane),
      error: telemetry.ok ? null : telemetry.error,
      fetches: number(stats.fetches, 0),
      rpcBatches: number(stats.rpcBatches, 0),
      batchAccounts: number(stats.batchAccounts, 0),
      batchDedupedRequests: number(stats.batchDedupedRequests, 0),
      batchFetchEnabled: stats.batchFetchEnabled === true,
      batchFlushMs: number(stats.batchFlushMs, 0),
      batchMaxAccounts: number(stats.batchMaxAccounts, 0),
      rpcCommitment: stats.rpcCommitment || 'unknown',
      pendingAccountFetches: number(stats.pendingAccountFetches, 0),
      updates: number(stats.updates, updateEvents),
    providerSnapshots: providerSnapshotEvents,
    errors: number(stats.errors, 0),
    missingAccounts: number(stats.missingAccounts, 0),
    invalidAccounts: number(stats.invalidAccounts, 0),
    completeMintsObserved: number(stats.completeMintsObserved, completeEvents),
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
    inFlight: number(stats.inFlight, 0),
      engineQueueSize: number(stats.engineQueueSize, 0),
      enginePendingSyncs: number(stats.enginePendingSyncs, 0),
      pumpDevTargetedCurveParitySamples: number(stats.pumpDevTargetedCurveParitySamples, 0),
      pumpDevTargetedCurveParityInFlight: number(stats.pumpDevTargetedCurveParityInFlight, 0),
      pumpDevTargetedCurveParitySampleWatchEnabled: stats.pumpDevTargetedCurveParitySampleWatchEnabled === true,
      pumpDevTargetedCurveParitySampleSkipsEnabled: stats.pumpDevTargetedCurveParitySampleSkipsEnabled === true,
      pumpDevTargetedCurveParitySampleEligibleEnabled: stats.pumpDevTargetedCurveParitySampleEligibleEnabled !== false
    };
  }

function buildSolanaRpcPressure(battlefield = {}) {
  const telemetry = readRuntimeStatsFromTelemetry(battlefield);
  const callTelemetry = readSolanaRpcCallTelemetry(battlefield);
  const stats = telemetry.stats?.solanaRpc || {};
  const queue = stats.queue || {};
  const callStats = stats.stats || {};
  const breaker = stats.circuitBreaker || {};
  const transport = stats.transport || {};
  return {
    ok: telemetry.ok && Boolean(telemetry.stats?.solanaRpc),
    error: telemetry.ok ? null : telemetry.error,
    primaryProvider: stats.primary?.httpUrl?.provider || null,
    fallbackProvider: stats.fallback?.httpUrl?.provider || null,
    httpAgentMode: transport.httpAgentMode || 'unknown',
    accountReadTransport: transport.accountReadTransport || 'unknown',
    accountReadProvider: transport.accountReadUrl?.provider || null,
    accountReadOverride: transport.accountReadUrl?.redacted || null,
    httpAgentConfigured: transport.httpAgentConfigured === true,
    httpAgentKeepAliveMsecs: number(transport.keepAliveMsecs, 0),
    httpAgentMaxSockets: number(transport.maxSockets, 0),
    httpAgentMaxFreeSockets: number(transport.maxFreeSockets, 0),
    httpAgentTimeoutMs: number(transport.timeoutMs, 0),
    httpAgentScheduling: transport.scheduling || 'unknown',
    primaryDegraded: stats.primaryDegraded === true,
    primaryDegradedUntil: stats.primaryDegradedUntil || null,
    fallbackDegraded: stats.fallbackDegraded === true,
    fallbackDegradedUntil: stats.fallbackDegradedUntil || null,
    sameVendorFallback: breaker.sameVendorFallback === true
      || (stats.primary?.httpUrl?.provider && stats.primary?.httpUrl?.provider === stats.fallback?.httpUrl?.provider),
    sameVendorFallbackEnabled: breaker.sameVendorFallbackEnabled === true,
    primaryFailureStreak: number(breaker.primaryFailureStreak, 0),
    fallbackFailureStreak: number(breaker.fallbackFailureStreak, 0),
    primaryFailureThreshold: number(breaker.primaryFailureThreshold, 0),
    fallbackFailureThreshold: number(breaker.fallbackFailureThreshold, 0),
    primaryDowngradeLevel: number(breaker.primaryDowngradeLevel, 0),
    fallbackDowngradeLevel: number(breaker.fallbackDowngradeLevel, 0),
    lastPrimaryFailureAt: stats.lastPrimaryFailureAt || null,
    lastPrimaryFailureReason: stats.lastPrimaryFailureReason || null,
    lastFallbackFailureAt: stats.lastFallbackFailureAt || null,
    lastFallbackFailureReason: stats.lastFallbackFailureReason || null,
    accountInfoCacheTtlMs: number(queue.accountInfoCacheTtlMs, 0),
    accountInfoCacheSize: number(queue.accountInfoCacheSize, 0),
    accountInfoInFlight: number(queue.accountInfoInFlight, 0),
    active: number(queue.active, 0),
    pending: number(queue.pending, 0),
    maxConcurrentRequests: number(queue.maxConcurrentRequests, 0),
    minRequestIntervalMs: number(queue.minRequestIntervalMs, 0),
    primaryCalls: number(callStats.primaryCalls, 0),
    fallbackCalls: number(callStats.fallbackCalls, 0),
    primaryFailures: number(callStats.primaryFailures, 0),
    primaryDegradations: number(callStats.primaryDegradations, 0),
    primaryFailuresSuppressed: number(callStats.primaryFailuresSuppressed, 0),
    fallbackSuccesses: number(callStats.fallbackSuccesses, 0),
    fallbackFailures: number(callStats.fallbackFailures, 0),
    fallbackDegradations: number(callStats.fallbackDegradations, 0),
    fallbackFailuresSuppressed: number(callStats.fallbackFailuresSuppressed, 0),
    failureClasses: callStats.failureClasses || {},
    startedByMethod: callTelemetry.startedByMethod,
    completedByMethod: callTelemetry.completedByMethod,
    failedByMethod: callTelemetry.failedByMethod,
    failedByCommitment: callTelemetry.failedByCommitment,
    callTelemetryStarted: number(callStats.callTelemetryStarted, 0),
    callTelemetryCompleted: number(callStats.callTelemetryCompleted, 0),
    callTelemetryFailed: number(callStats.callTelemetryFailed, 0),
    accountInfoCacheHits: number(callStats.accountInfoCacheHits, 0),
    accountInfoInFlightHits: number(callStats.accountInfoInFlightHits, 0),
    accountInfoCacheWrites: number(callStats.accountInfoCacheWrites, 0),
    queuedCalls: number(callStats.queuedCalls, 0),
    maxQueueDepth: number(callStats.maxQueueDepth, 0)
  };
}

function readSolanaRpcCallTelemetry(battlefield = {}) {
  const telemetryPath = get(battlefield, 'files.telemetryPath', null);
  const resolvedPath = resolveRepoFile(telemetryPath);
  const summary = {
    startedByMethod: {},
    completedByMethod: {},
    failedByMethod: {},
    failedByCommitment: {}
  };

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return summary;
  }

  const bump = (target, key) => {
    const label = key || 'unknown';
    target[label] = (target[label] || 0) + 1;
  };

  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_) {
        continue;
      }

      if (!String(event.type || '').startsWith('solana_rpc.call_')) {
        continue;
      }

      const payload = event.payload || event.data || {};
      if (event.type === 'solana_rpc.call_started') {
        bump(summary.startedByMethod, payload.methodName);
      } else if (event.type === 'solana_rpc.call_completed') {
        bump(summary.completedByMethod, payload.methodName);
      } else if (event.type === 'solana_rpc.call_failed') {
        bump(summary.failedByMethod, payload.methodName);
        bump(summary.failedByCommitment, payload.commitment);
      }
    }
  } catch (_) {
    return summary;
  }

  return summary;
}

function readFinalistAccountVerifierTelemetry(battlefield = {}) {
  const telemetryPath = get(battlefield, 'files.telemetryPath', null);
  const resolvedPath = resolveRepoFile(telemetryPath);
  const summary = {
    subscribed: 0,
    skipped: 0,
    subscribeErrors: 0,
    updates: 0,
    invalidUpdates: 0,
    initialSnapshots: 0,
    initialSnapshotMissing: 0,
    initialSnapshotErrors: 0,
    initialSnapshotMethods: {},
    unsubscribed: 0,
    uniqueSubscribedMints: 0,
    uniqueUpdatedMints: 0,
    uniqueInvalidMints: 0,
    selectionClassCounts: {},
    skipReasons: {},
    invalidReasons: {},
    updateStages: {},
    updateSources: {},
    shadowGateChecks: 0,
    shadowGateReady: 0,
    shadowGateBlocked: 0,
    shadowGateStatuses: {},
    shadowGateBlockedReasons: {},
    shadowGateByDecision: {},
    firstUpdateLatencyMs: { count: 0, min: null, median: null, p90: null, max: null },
    subscribedWithoutUpdate: 0,
    updatesPerMint: {},
    latestUpdates: [],
    latestInvalidUpdates: [],
    latestShadowGateRows: [],
    latestSkips: [],
    stopStats: null,
    rawUpdatesProcessed: 0,
    updateTelemetrySuppressed: 0,
    updateTelemetryMinIntervalMs: 0,
    updateTelemetryMinCurveDelta: 0
  };

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return summary;
  }

  const subscribedMints = new Set();
  const updatedMints = new Set();
  const invalidMints = new Set();
  const subscribedAtByMint = new Map();
  const firstUpdateLatencyValues = [];
  const updateCountsByMint = {};
  const bump = (target, key) => {
    const label = key || 'unknown';
    target[label] = (target[label] || 0) + 1;
  };
  const pushLimited = (target, item, limit = 6) => {
    target.push(item);
    if (target.length > limit) target.shift();
  };

  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_) {
        continue;
      }

      const type = String(event.type || '');
      if (type === 'session.stopping' || type === 'session.stopped') {
        const stopStats = event.payload?.stats?.finalistAccountVerifier || null;
        if (stopStats) summary.stopStats = stopStats;
      }
      if (!type.startsWith('finalist_account_verifier.')) continue;
      const payload = event.payload || event.data || {};
      const mint = payload.mint || null;
      const symbol = payload.symbol || null;

      if (type === 'finalist_account_verifier.subscribed') {
        summary.subscribed += 1;
        if (mint) subscribedMints.add(mint);
        if (mint) {
          const subscribedAtMs = Date.parse(event.timestamp || payload.subscribedAt || '');
          if (Number.isFinite(subscribedAtMs)) subscribedAtByMint.set(mint, subscribedAtMs);
        }
        bump(summary.selectionClassCounts, payload.selectionClass);
      } else if (type === 'finalist_account_verifier.skipped') {
        summary.skipped += 1;
        bump(summary.selectionClassCounts, payload.selectionClass);
        bump(summary.skipReasons, payload.reason);
        pushLimited(summary.latestSkips, {
          mint,
          symbol,
          reason: payload.reason || null,
          selectionClass: payload.selectionClass || null
        });
      } else if (type === 'finalist_account_verifier.subscribe_error') {
        summary.subscribeErrors += 1;
        bump(summary.selectionClassCounts, payload.selectionClass);
      } else if (type === 'finalist_account_verifier.initial_snapshot') {
        summary.initialSnapshots += 1;
        bump(summary.initialSnapshotMethods, payload.method);
      } else if (type === 'finalist_account_verifier.initial_snapshot_missing') {
        summary.initialSnapshotMissing += 1;
        bump(summary.initialSnapshotMethods, payload.method);
      } else if (type === 'finalist_account_verifier.initial_snapshot_error') {
        summary.initialSnapshotErrors += 1;
        bump(summary.initialSnapshotMethods, payload.method);
      } else if (type === 'finalist_account_verifier.update') {
        summary.updates += 1;
        if (mint) updatedMints.add(mint);
        if (mint) {
          updateCountsByMint[mint] = (updateCountsByMint[mint] || 0) + 1;
          if (updateCountsByMint[mint] === 1 && subscribedAtByMint.has(mint)) {
            const updateAtMs = Number(payload.receivedAtMs) || Date.parse(event.timestamp || payload.receivedAt || '');
            const latencyMs = updateAtMs - subscribedAtByMint.get(mint);
            if (Number.isFinite(latencyMs) && latencyMs >= 0) {
              firstUpdateLatencyValues.push(latencyMs);
            }
          }
        }
        bump(summary.updateStages, payload.bondingStage);
        bump(summary.updateSources, payload.updateSource);
        pushLimited(summary.latestUpdates, {
          mint,
          symbol,
          slot: payload.slot ?? null,
          curveProgress: payload.curveProgress ?? null,
          providerCurveProgressAtSubscribe: payload.providerCurveProgressAtSubscribe ?? null,
          subscriptionCurveDelta: payload.subscriptionCurveDelta ?? null,
          updateSource: payload.updateSource || null,
          priceSol: payload.priceSol ?? null,
          bondingStage: payload.bondingStage || null,
          complete: payload.complete === true
        });
      } else if (type === 'finalist_account_verifier.update_invalid') {
        summary.invalidUpdates += 1;
        if (mint) invalidMints.add(mint);
        bump(summary.invalidReasons, payload.reason);
        pushLimited(summary.latestInvalidUpdates, {
          mint,
          symbol,
          slot: payload.slot ?? null,
          reason: payload.reason || null,
          owner: payload.owner || null
        });
      } else if (type === 'finalist_account_verifier.unsubscribed') {
        summary.unsubscribed += 1;
      } else if (type === 'finalist_account_verifier.shadow_live_gate') {
        summary.shadowGateChecks += 1;
        if (payload.status === 'LIVE_SHADOW_READY_FRESH_ACCOUNT_STATE') {
          summary.shadowGateReady += 1;
        } else {
          summary.shadowGateBlocked += 1;
        }
        bump(summary.shadowGateStatuses, payload.status);
        if (payload.blockedReason) {
          bump(summary.shadowGateBlockedReasons, payload.blockedReason);
        }
        bump(summary.shadowGateByDecision, payload.decision);
        pushLimited(summary.latestShadowGateRows, {
          mint,
          symbol,
          decision: payload.decision || null,
          reason: payload.reason || null,
          status: payload.status || null,
          blockedReason: payload.blockedReason || null,
          accountAgeMs: payload.accountAgeMs ?? null,
          paperCurveProgress: payload.paperCurveProgress ?? null,
          accountCurveProgress: payload.accountCurveProgress ?? null,
          curveDelta: payload.curveDelta ?? null,
          absCurveDelta: payload.absCurveDelta ?? null,
          maxCurveDelta: payload.maxCurveDelta ?? null
        });
      }
    }
  } catch (_) {
    return summary;
  }

  summary.uniqueSubscribedMints = subscribedMints.size;
  summary.uniqueUpdatedMints = updatedMints.size;
  summary.uniqueInvalidMints = invalidMints.size;
  summary.firstUpdateLatencyMs = numericStats(firstUpdateLatencyValues);
  summary.subscribedWithoutUpdate = Array.from(subscribedMints).filter((mint) => !updatedMints.has(mint)).length;
  summary.updatesPerMint = updateCountsByMint;
  if (summary.stopStats) {
    summary.rawUpdatesProcessed = Number(summary.stopStats.updates || summary.updates || 0);
    summary.updateTelemetrySuppressed = Number(summary.stopStats.updateTelemetrySuppressed || 0);
    summary.updateTelemetryMinIntervalMs = Number(summary.stopStats.updateTelemetryMinIntervalMs || 0);
    summary.updateTelemetryMinCurveDelta = Number(summary.stopStats.updateTelemetryMinCurveDelta || 0);
  } else {
    summary.rawUpdatesProcessed = summary.updates;
  }
  return summary;
}

function readLiveExecutionDryRunTelemetry(battlefield = {}) {
  const telemetryPath = get(battlefield, 'files.telemetryPath', null);
  const resolvedPath = resolveRepoFile(telemetryPath);
  const summary = {
    attempts: 0,
    wouldSend: 0,
    wouldBlock: 0,
    skipped: 0,
    errors: 0,
    uniqueMints: 0,
    blockReasons: {},
    skipReasons: {},
    byDecision: {},
    txBuildStatuses: {},
    blockhashOk: { true: 0, false: 0 },
    simulationOk: { true: 0, false: 0, null: 0 },
    simulationErrors: {},
    simulationMissingAccounts: {},
    simulationPassedWithPreflightMissingAccounts: {},
    accountAgeMs: { count: 0, min: null, median: null, p90: null, max: null },
    priceImpactPct: { count: 0, min: null, median: null, p90: null, max: null },
    postTradePriceMovePct: { count: 0, min: null, median: null, p90: null, max: null },
    blockhashLatencyMs: { count: 0, min: null, median: null, p90: null, max: null },
    latestRows: []
  };

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return summary;
  }

  const mints = new Set();
  const accountAges = [];
  const priceImpacts = [];
  const postTradeMoves = [];
  const blockhashLatencies = [];
  const bump = (target, key) => {
    const label = key === true || key === false ? String(key) : (key || 'unknown');
    target[label] = (target[label] || 0) + 1;
  };
  const classifySimulationFailure = (payload = {}) => {
    const text = [
      payload.simulationErrorClass,
      payload.simulationError,
      payload.reason,
      ...(Array.isArray(payload.simulationLogs) ? payload.simulationLogs : [])
    ].filter(Boolean).join('\n');
    if (/MintDoesNotMatchBondingCurve/i.test(text) || /Error Number:\s*6004/i.test(text) || /custom program error:\s*0x1774/i.test(text)) {
      return 'BONDING_CURVE_MINT_MISMATCH';
    }
    if (/Slippage/i.test(text)) return 'SIMULATION_SLIPPAGE';
    if (/insufficient funds|custom program error:\s*0x1/i.test(text)) return 'SIMULATION_INSUFFICIENT_FUNDS';
    return payload.simulationErrorClass || payload.simulationError || payload.reason || 'SIMULATION_FAILED';
  };
  const pushLimited = (target, item, limit = 8) => {
    target.push(item);
    if (target.length > limit) target.shift();
  };

  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_) {
        continue;
      }
      const type = String(event.type || '');
      if (!type.startsWith('live_dry_run.')) continue;
      const payload = event.payload || event.data || {};
      const mint = payload.mint || null;
      if (mint) mints.add(mint);

      if (type === 'live_dry_run.would_send') {
        summary.attempts += 1;
        summary.wouldSend += 1;
      } else if (type === 'live_dry_run.would_block') {
        summary.attempts += 1;
        summary.wouldBlock += 1;
        bump(summary.blockReasons, payload.reason);
      } else if (type === 'live_dry_run.skipped') {
        summary.skipped += 1;
        bump(summary.skipReasons, payload.reason);
      } else if (type === 'live_dry_run.error') {
        summary.errors += 1;
      }

      bump(summary.byDecision, payload.sourceDecision);
      bump(summary.txBuildStatuses, payload.txBuildStatus);
      if (payload.blockhashOk === true || payload.blockhashOk === false) {
        bump(summary.blockhashOk, payload.blockhashOk);
      }
      if (payload.simulationOk === true || payload.simulationOk === false) {
        bump(summary.simulationOk, payload.simulationOk);
        if (payload.simulationOk === false) bump(summary.simulationErrors, classifySimulationFailure(payload));
      } else if (type === 'live_dry_run.would_send' || type === 'live_dry_run.would_block') {
        bump(summary.simulationOk, 'null');
      }
      const missingAccounts = payload.simulationAccountDiagnostic?.missingAccounts;
      if (Array.isArray(missingAccounts)) {
        const target = payload.simulationOk === true
          ? summary.simulationPassedWithPreflightMissingAccounts
          : summary.simulationMissingAccounts;
        for (const account of missingAccounts) {
          bump(target, account?.name || account?.pubkey || 'unknown');
        }
      }

      const accountAge = Number(payload.accountAgeMs);
      if (Number.isFinite(accountAge)) accountAges.push(accountAge);
      const priceImpact = Number(payload.quote?.priceImpactPct ?? payload.priceImpactPct);
      if (Number.isFinite(priceImpact)) priceImpacts.push(priceImpact);
      const postTradeMove = Number(payload.quote?.postTradePriceMovePct ?? payload.postTradePriceMovePct);
      if (Number.isFinite(postTradeMove)) postTradeMoves.push(postTradeMove);
      const blockhashLatency = Number(payload.blockhashLatencyMs);
      if (Number.isFinite(blockhashLatency)) blockhashLatencies.push(blockhashLatency);

      if (type === 'live_dry_run.would_send' || type === 'live_dry_run.would_block') {
        pushLimited(summary.latestRows, {
          mint,
          symbol: payload.symbol || null,
          eventType: type,
          reason: payload.reason || null,
          sourceDecision: payload.sourceDecision || null,
          accountAgeMs: payload.accountAgeMs ?? null,
          accountCurveProgress: payload.accountCurveProgress ?? null,
          amountSol: payload.amountSol ?? null,
          priceImpactPct: payload.quote?.priceImpactPct ?? null,
          postTradePriceMovePct: payload.quote?.postTradePriceMovePct ?? null,
          estimatedTokensOut: payload.quote?.estimatedTokensOut ?? null,
          blockhashOk: payload.blockhashOk ?? null,
          blockhashLatencyMs: payload.blockhashLatencyMs ?? null,
          simulationOk: payload.simulationOk ?? null,
          simulationError: payload.simulationOk === false ? classifySimulationFailure(payload) : (payload.simulationError || null),
          signatureMode: payload.signatureMode || null,
          signedOk: payload.signedOk ?? null,
          broadcastEnabled: payload.broadcastEnabled ?? null,
          simulationLogs: Array.isArray(payload.simulationLogs) ? payload.simulationLogs.slice(-4) : [],
          missingAccounts: payload.simulationOk !== true && Array.isArray(payload.simulationAccountDiagnostic?.missingAccounts)
            ? payload.simulationAccountDiagnostic.missingAccounts.slice(0, 6)
            : [],
          preflightMissingAccountCount: payload.simulationOk === true && Array.isArray(payload.simulationAccountDiagnostic?.missingAccounts)
            ? payload.simulationAccountDiagnostic.missingAccounts.length
            : 0,
          txBuildStatus: payload.txBuildStatus || null
        });
      }
    }
  } catch (_) {
    return summary;
  }

  summary.uniqueMints = mints.size;
  summary.accountAgeMs = numericStats(accountAges);
  summary.priceImpactPct = numericStats(priceImpacts);
  summary.postTradePriceMovePct = numericStats(postTradeMoves);
  summary.blockhashLatencyMs = numericStats(blockhashLatencies);
  return summary;
}

function readRuntimeHealthTelemetry(battlefield = {}) {
  const telemetryPath = get(battlefield, 'files.telemetryPath', null);
  const resolvedPath = resolveRepoFile(telemetryPath);
  const summary = {
    eventLoopLagEvents: 0,
    eventLoopLagStats: { count: 0, min: null, median: null, p90: null, max: null },
    eventLoopSummary: null
  };

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return summary;
  }

  const lagValues = [];
  try {
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_) {
        continue;
      }

      const type = String(event.type || '');
      const payload = event.payload || event.data || {};
      if (type === 'runtime.event_loop_lag') {
        summary.eventLoopLagEvents += 1;
        if (Number.isFinite(Number(payload.lagMs))) {
          lagValues.push(Number(payload.lagMs));
        }
      } else if (type === 'runtime.event_loop_monitor_summary') {
        summary.eventLoopSummary = payload;
      }
    }
  } catch (_) {
    return summary;
  }

  summary.eventLoopLagStats = numericStats(lagValues);
  return summary;
}

function bestProfileFromSummary(summaryByProfile = {}) {
  return Object.entries(summaryByProfile || {})
    .map(([name, summary]) => ({ name, ...(summary || {}) }))
    .filter((item) => Number.isFinite(Number(item.totalPnlSol)))
    .sort((a, b) => Number(b.totalPnlSol) - Number(a.totalPnlSol))[0] || null;
}

function formatReplayProfile(item, tradeLabel = 'trades') {
  if (!item) return 'none';
  const trades = item.trades ?? item.confirmedEntries ?? item.decisions ?? 'n/a';
  const wins = item.wins ?? 'n/a';
  const losses = item.losses ?? 'n/a';
  const pnl = sol(item.totalPnlSol, 6);
  const median = item.pnlStats?.median !== undefined ? `, median=${sol(item.pnlStats.median, 6)}` : '';
  return `${item.name}: ${tradeLabel}=${trades}, wins/losses=${wins}/${losses}, winRate=${pct(item.winRate, 1)}, pnl=${pnl}${median}`;
}

function formatTopCounts(obj, limit = 4) {
  if (!obj || typeof obj !== 'object') return 'none';
  const entries = Array.isArray(obj)
    ? obj.map((item) => [item.key || item.name || item.reason || 'unknown', item.count ?? item.value ?? item.decisions])
    : Object.entries(obj);
  return entries
    .filter(([, value]) => Number.isFinite(Number(value)))
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || 'none';
}

function summarizeClosestGateMiss(item = {}) {
  if (!item || typeof item !== 'object' || !Object.keys(item).length) return 'none';
  const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
  const gate = item.tightestGate || {};
  const gateText = gate.name
    ? `${gate.name} ${fmt(gate.actual, 6)}/${fmt(gate.threshold, 6)}`
    : 'gate=n/a';
  return `${label} | preset=${item.preset || 'n/a'} | reason=${item.reason || 'n/a'} | readiness=${fmt(item.readinessPct, 2)}% | ${gateText}`;
}

function buildLaunchDecisionLines({
  liveReadiness,
  paperEntries,
  paperPnl,
  aiReachability,
  preMigrationGuardAttribution,
  preMigrationEntryGateMargin,
  preMigrationDryRunEntryReplay,
  preMigrationRelaxedGateReplay,
  preMigrationCurveStallRelaxedReplay,
  preMigrationCurveConfirmationReplay,
  runnerRejectEntryReplay
}) {
  const lines = [];
  const readinessVerdict = liveReadiness.verdict || 'unknown';
  const infraBlockers = Array.isArray(liveReadiness.blockers) ? liveReadiness.blockers : [];
  const launchBlocks = Array.isArray(liveReadiness.launchBlocks) ? liveReadiness.launchBlocks : [];
  const dryBest = bestProfileFromSummary(preMigrationDryRunEntryReplay.firstPerMint?.summaryByProfile);
  const relaxedBest = topArray(preMigrationRelaxedGateReplay.ranking, 1)[0] || null;
  const curveStallBest = topArray(preMigrationCurveStallRelaxedReplay.ranking, 1)[0] || null;
  const curveConfirmationBest = topArray(preMigrationCurveConfirmationReplay.ranking, 1)[0] || null;
  const runnerRejectBest = bestProfileFromSummary(runnerRejectEntryReplay.summaryByProfile);
  const guardSummary = preMigrationGuardAttribution.summary || {};
  const marginSummary = preMigrationEntryGateMargin.summary || {};
  const nearMissSummary = preMigrationEntryGateMargin.nearMissFollowThrough?.summary || {};
  const closestGateMiss = topArray(preMigrationEntryGateMargin.closestByMint, 1)[0] || {};
  const strategyEvidenceBlocked = Number(paperEntries || 0) === 0 || Number(paperPnl || 0) < 0;
  const broadcastBlocked = launchBlocks.some((line) => String(line).toLowerCase().includes('broadcast'));
  const aiNotReached = Number(aiReachability.generatedSignals || 0) === 0
    && Number(aiReachability.lifecycleAttempts || 0) === 0;
  const relaxedPositiveButTiny = curveStallBest
    && Number(curveStallBest.totalPnlSol) > 0
    && Number(curveStallBest.trades || 0) < 20;
  const curveConfirmationTiny = curveConfirmationBest
    && Number(curveConfirmationBest.totalPnlSol) > 0
    && Number(curveConfirmationBest.confirmedEntries || curveConfirmationBest.trades || 0) < 20;
  const relaxedWarning = Number(relaxedBest?.totalPnlSol || 0) < 0
    || Number(dryBest?.totalPnlSol || 0) < 0
    || relaxedPositiveButTiny
    || curveConfirmationTiny;

  lines.push('0. Launch Decision');
  lines.push('------------------');
  lines.push(`- Decision: KEEP_LIVE_DISABLED (${readinessVerdict}).`);
  lines.push(`- Infrastructure: ${infraBlockers.length ? `${infraBlockers.length} blocker(s) remain` : 'no infrastructure blockers in the latest readiness report'}.`);
  lines.push(`- Strategy evidence: paper entries/PnL=${paperEntries ?? 'n/a'} / ${paperPnl === null || paperPnl === undefined ? 'n/a' : sol(paperPnl, 6)}; ${strategyEvidenceBlocked ? 'not live-launchable' : 'sample needs live-review sizing checks'}.`);
  lines.push(`- AI reachability: signals/lifecycle attempts=${aiReachability.generatedSignals}/${aiReachability.lifecycleAttempts}; ${aiNotReached ? 'no real candidate reached runtime AI review this run' : 'runtime AI path was exercised'}.`);
  lines.push(`- Broadcast: ${broadcastBlocked ? 'still report-only; do not enable live broadcast from this evidence' : 'no broadcast launch block reported'}.`);
  lines.push(`- Current entry gate bottleneck: wouldEnter/wouldSkip=${guardSummary.wouldEnter ?? 'n/a'}/${guardSummary.wouldSkip ?? 'n/a'}; top reasons=${formatTopCounts(guardSummary.byReason)}.`);
  lines.push(`- Rolling tightest gates: decisions=${marginSummary.decisions ?? 'n/a'}, readiness median/p90/max=${fmt(marginSummary.readinessPct?.median, 2)}%/${fmt(marginSummary.readinessPct?.p90, 2)}%/${fmt(marginSummary.readinessPct?.max, 2)}%; gates=${formatTopCounts(marginSummary.tightestGateCounts)}.`);
  if (nearMissSummary.decisions !== undefined) {
    lines.push(`- Near-miss follow-through: >=${preMigrationEntryGateMargin.nearMissFollowThrough?.minReadinessPct ?? 'n/a'}% readiness decisions=${nearMissSummary.decisions}, unique=${nearMissSummary.uniqueMints}, reached90 unique=${nearMissSummary.uniqueMintsReached90Within120s ?? 'n/a'}, crossed95 unique=${nearMissSummary.uniqueMintsCrossed95Within120s ?? 'n/a'}, delta120 median/p90=${fmt(nearMissSummary.curveDelta120s?.median, 4)}/${fmt(nearMissSummary.curveDelta120s?.p90, 4)}.`);
  }
  lines.push(`- Closest gate miss: ${summarizeClosestGateMiss(closestGateMiss)}.`);
  if (launchBlocks.length) {
    lines.push('- Launch blockers:');
    launchBlocks.forEach((line) => lines.push(`  - ${line}`));
  }
  lines.push('- Shadow replay read-through:');
  lines.push(`  - dry-run first-eligible replay best: ${formatReplayProfile(dryBest)}`);
  lines.push(`  - LOW_SCORE/FIRST_SIGHT relaxed best: ${formatReplayProfile(relaxedBest)}`);
  lines.push(`  - CURVE_NOT_ADVANCING relaxed best: ${formatReplayProfile(curveStallBest)}`);
  lines.push(`  - curve-confirmation best: ${formatReplayProfile(curveConfirmationBest, 'confirmed')}`);
  lines.push(`  - runner-reject replay best: ${formatReplayProfile(runnerRejectBest)} (report-only; not a live-entry proof)`);
  lines.push(`- Tuning posture: ${relaxedWarning ? 'do not loosen runtime gates from this evidence; the broad relaxed lanes are negative and the positive slices are tiny/median-weak' : 'candidate for deeper review, not automatic live tuning'}.`);
  lines.push('- Next engineering target: improve candidate-generation/near-miss instrumentation so the next paper run can explain exactly which condition prevents real entries.');
  lines.push('');
  return lines;
}

function buildSummary(docs) {
  const battlefield = docs.battlefield.data || {};
  const simpleRuntimeAiEvidence = docs.simpleRuntimeAiEvidence.data || {};
  const liveReadiness = docs.liveReadiness.data || {};
  const pumpDevCurveParity = docs.pumpDevCurveParity.data || {};
  const pumpDevTargetedCurveParity = docs.pumpDevTargetedCurveParity.data || {};
  const eventLoopLagDiagnostic = docs.eventLoopLagDiagnostic.data || {};
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
  const skipFollowThrough = docs.preMigrationSkipFollowThrough.data || {};
  const skipNear90Watchlist = docs.preMigrationSkipNear90Watchlist.data || {};
  const highConvictionWatchFollowThrough = docs.preMigrationHighConvictionWatchFollowThrough.data || {};
  const dryRunOutcome = docs.preMigrationDryRunOutcome.data || {};
  const relaxedGateReplay = docs.preMigrationRelaxedGateReplay.data || {};
  const curveStallRelaxedReplay = docs.preMigrationCurveStallRelaxedReplay.data || {};
  const walletConditionedRelaxedGateReplay = docs.preMigrationWalletConditionedRelaxedGateReplay.data || {};
  const walletRelaxedShadowOutcome = docs.preMigrationWalletRelaxedShadowOutcome.data || {};
  const walletContextCoverage = docs.preMigrationWalletContextCoverage.data || {};
  const walletContextFollowThrough = docs.preMigrationWalletContextFollowThrough.data || {};
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
  const runnerRejectFollowThrough = docs.runnerRejectFollowThrough.data || {};
  const runnerRejectEntryReplay = docs.runnerRejectEntryReplay.data || {};
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
  const rickSightingFollowThrough = docs.rickSightingFollowThrough.data || {};
  const finalistAccountVerifierTelemetry = readFinalistAccountVerifierTelemetry(battlefield);
  const liveExecutionDryRunTelemetry = readLiveExecutionDryRunTelemetry(battlefield);
  const runtimeHealthTelemetry = readRuntimeHealthTelemetry(battlefield);
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
  const pumpDevHealth = buildPumpDevHealth(battlefield);
  const bondingCurvePressure = buildBondingCurvePressure(battlefield);
  const solanaRpcPressure = buildSolanaRpcPressure(battlefield);
  const runnerLifecycle = battlefield.runnerLane?.simpleRuntimeAiLifecycle || {};
  const signalExecutionLatency = battlefield.runnerLane?.signalExecutionLatencyMs || {};

  lines.push(...buildLaunchDecisionLines({
    liveReadiness,
    paperEntries,
    paperPnl,
    aiReachability,
    preMigrationGuardAttribution: docs.preMigrationGuardAttribution.data || {},
    preMigrationEntryGateMargin: docs.preMigrationEntryGateMargin.data || {},
    preMigrationDryRunEntryReplay: docs.preMigrationDryRunEntryReplay.data || {},
    preMigrationRelaxedGateReplay: docs.preMigrationRelaxedGateReplay.data || {},
    preMigrationCurveStallRelaxedReplay: docs.preMigrationCurveStallRelaxedReplay.data || {},
    preMigrationCurveConfirmationReplay: docs.preMigrationCurveConfirmationReplay?.data || {},
    runnerRejectEntryReplay: docs.runnerRejectEntryReplay.data || {}
  }));

  lines.push('1. Run Summary');
  lines.push('--------------');
  lines.push(`- Duration: ${duration === null ? 'n/a' : `${fmt(duration)} min`}`);
  lines.push(`- Events: ${events ?? 'n/a'}`);
  lines.push(`- Dossiers: ${dossiers ?? 'n/a'}`);
  lines.push(`- Pre-migration paper entries/exits: ${paperEntries ?? 'n/a'} / ${paperExits ?? 'n/a'}`);
  lines.push(`- Pre-migration paper PnL: ${paperPnl === null ? 'n/a' : sol(paperPnl)}`);
  lines.push(`- Simple Runtime AI string evidence in logs (legacy/warmup included): ${summarizeEvidencePaths(aiEvidence)}`);
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
  lines.push(`  - control frames sent / token subscribe / token unsubscribe: ${pumpPortalHealth.controlFramesSent || 0} / ${pumpPortalHealth.tokenTradeSubscribeFrames || 0} / ${pumpPortalHealth.tokenTradeUnsubscribeFrames || 0}`);
  lines.push(`  - split sockets enabled / backup-only / post-1006 tradestream delay: ${pumpPortalHealth.splitSocketsEnabled === null ? 'unknown' : pumpPortalHealth.splitSocketsEnabled === true} / ${pumpPortalHealth.backupOnly === true} / ${pumpPortalHealth.postCloseTradestreamDelayMs || 0}ms`);
  lines.push(`  - pair-base detection total SOL/USDC/unknown: ${pumpPortalHealth.pairSolEvents || 0} / ${pumpPortalHealth.pairUsdcEvents || 0} / ${pumpPortalHealth.pairUnknownEvents || 0}${pumpPortalHealth.lastDetectedPairBase ? ` (last=${pumpPortalHealth.lastDetectedPairBase}${pumpPortalHealth.lastDetectedPairAt ? ` at ${pumpPortalHealth.lastDetectedPairAt}` : ''})` : ''}`);
  lines.push(`  - pair-base by event newToken SOL/USDC/unknown: ${pumpPortalHealth.newTokenPairSolEvents || 0} / ${pumpPortalHealth.newTokenPairUsdcEvents || 0} / ${pumpPortalHealth.newTokenPairUnknownEvents || 0}`);
  lines.push(`  - pair-base by event trade SOL/USDC/unknown: ${pumpPortalHealth.tradePairSolEvents || 0} / ${pumpPortalHealth.tradePairUsdcEvents || 0} / ${pumpPortalHealth.tradePairUnknownEvents || 0}; migration SOL/USDC/unknown: ${pumpPortalHealth.migrationPairSolEvents || 0} / ${pumpPortalHealth.migrationPairUsdcEvents || 0} / ${pumpPortalHealth.migrationPairUnknownEvents || 0}`);
  const reconnectDelay = pumpPortalHealth.reconnectResubscribeBatchDelayMs === undefined
    ? 'n/a'
    : `${pumpPortalHealth.reconnectResubscribeBatchDelayMs}ms`;
  lines.push(`  - reconnect resubscribe pressure: max=${pumpPortalHealth.reconnectResubscribeMaxMints || 'n/a'}, batch=${pumpPortalHealth.reconnectResubscribeBatchSize || 'n/a'}, delay=${reconnectDelay}, scheduled/sent/dropped=${pumpPortalHealth.tokenTradeReconnectResubscribeScheduled || 0} / ${pumpPortalHealth.tokenTradeReconnectResubscribeSent || 0} / ${pumpPortalHealth.tokenTradeReconnectResubscribeDropped || 0}`);
  lines.push(`  - message handler queue: active=${pumpPortalHealth.eventQueueProcessingActive || 0}, depth/max=${pumpPortalHealth.eventQueueDepth || 0} / ${pumpPortalHealth.eventQueueMaxDepth || 0}, processed/dropped/stop-discarded/errors=${pumpPortalHealth.eventQueueProcessed || 0} / ${pumpPortalHealth.eventQueueDropped || 0} / ${pumpPortalHealth.eventQueueDiscardedOnStop || 0} / ${pumpPortalHealth.eventQueueHandlerErrors || 0}, concurrency=${pumpPortalHealth.eventHandlerConcurrency || 'n/a'}, max=${pumpPortalHealth.eventQueueMaxSize || 'n/a'}`);
  lines.push(`  - subscription ACKs total/new/migration/token/account/unknown: ${pumpPortalHealth.subscriptionAckMessages || 0} / ${pumpPortalHealth.newTokenSubscriptionAcks || 0} / ${pumpPortalHealth.migrationSubscriptionAcks || 0} / ${pumpPortalHealth.tokenTradeSubscriptionAcks || 0} / ${pumpPortalHealth.accountTradeSubscriptionAcks || 0} / ${pumpPortalHealth.unknownSubscriptionAcks || 0}`);
  if (pumpPortalHealth.lastSubscriptionAckMessage) {
    lines.push(`  - last subscription ACK: kind=${pumpPortalHealth.lastSubscriptionAckKind || 'unknown'} message="${pumpPortalHealth.lastSubscriptionAckMessage}"`);
  }
  lines.push(`  - websocket heartbeat: pingInterval=${pumpPortalHealth.pingIntervalMs ? `${pumpPortalHealth.pingIntervalMs}ms` : 'off'}, pings/pongs=${pumpPortalHealth.pingsSent || 0} / ${pumpPortalHealth.pongsReceived || 0}, lastConnectionAge=${pumpPortalHealth.lastConnectionAgeMs === null ? 'n/a' : `${pumpPortalHealth.lastConnectionAgeMs}ms`}`);
  if ((pumpPortalHealth.lifecycle?.closed || 0) > 0) {
    const age = pumpPortalHealth.lifecycle.closeAgeStats || {};
    const ageBuckets = pumpPortalHealth.lifecycle.closeAgeBuckets || {};
    const subs = pumpPortalHealth.lifecycle.closeSubscribedMintStats || {};
    const closePings = pumpPortalHealth.lifecycle.closeConnectionPingStats || {};
    const closePongs = pumpPortalHealth.lifecycle.closeConnectionPongStats || {};
    const closeMessages = pumpPortalHealth.lifecycle.closeConnectionMessageStats || {};
    const closeTrades = pumpPortalHealth.lifecycle.closeConnectionTradeStats || {};
    const closeControlFrames = pumpPortalHealth.lifecycle.closeConnectionControlFrameStats || {};
    const closeMessagesPerMinute = pumpPortalHealth.lifecycle.closeConnectionMessagesPerMinuteStats || {};
    const closeLastMessageAge = pumpPortalHealth.lifecycle.closeLastMessageAgeStats || {};
    const closeUsdc = pumpPortalHealth.lifecycle.closeConnectionPairUsdcStats || {};
    const closeUnknownPair = pumpPortalHealth.lifecycle.closeConnectionPairUnknownStats || {};
    lines.push(`  - structured close lifecycle: connected/closed/errors=${pumpPortalHealth.lifecycle.connected} / ${pumpPortalHealth.lifecycle.closed} / ${pumpPortalHealth.lifecycle.websocketErrors}, closeAge median/p90/max=${age.median === null ? 'n/a' : `${fmt(age.median, 0)}ms`} / ${age.p90 === null ? 'n/a' : `${fmt(age.p90, 0)}ms`} / ${age.max === null ? 'n/a' : `${fmt(age.max, 0)}ms`}, close subscribedMints median/max=${subs.median === null ? 'n/a' : fmt(subs.median, 0)} / ${subs.max === null ? 'n/a' : fmt(subs.max, 0)}, close pings/pongs median=${closePings.median === null ? 'n/a' : fmt(closePings.median, 0)} / ${closePongs.median === null ? 'n/a' : fmt(closePongs.median, 0)}`);
    lines.push(`  - closeAge buckets <30s/30-90s/90-180s/180-300s/>300s: ${ageBuckets['<30s'] || 0} / ${ageBuckets['30-90s'] || 0} / ${ageBuckets['90-180s'] || 0} / ${ageBuckets['180-300s'] || 0} / ${ageBuckets['>300s'] || 0}`);
    lines.push(`  - close connection traffic median messages/trades/controlFrames/msgPerMin/lastMsgAge: ${closeMessages.median === null ? 'n/a' : fmt(closeMessages.median, 0)} / ${closeTrades.median === null ? 'n/a' : fmt(closeTrades.median, 0)} / ${closeControlFrames.median === null ? 'n/a' : fmt(closeControlFrames.median, 0)} / ${closeMessagesPerMinute.median === null ? 'n/a' : fmt(closeMessagesPerMinute.median, 2)} / ${closeLastMessageAge.median === null ? 'n/a' : `${fmt(closeLastMessageAge.median, 0)}ms`}`);
    lines.push(`  - close pair-base median USDC/unknown events: ${closeUsdc.median === null ? 'n/a' : fmt(closeUsdc.median, 0)} / ${closeUnknownPair.median === null ? 'n/a' : fmt(closeUnknownPair.median, 0)}`);
  }
  lines.push('  - split-socket roles:');
  ['discovery', 'tradestream'].forEach((role) => {
    const roleStats = pumpPortalHealth.roles?.[role] || {};
    const roleLifecycle = roleStats.lifecycle || {};
    const age = roleLifecycle.closeAgeStats || {};
    const buckets = roleLifecycle.closeAgeBuckets || {};
    const messagesAtClose = roleLifecycle.closeConnectionMessageStats || {};
    const tradesAtClose = roleLifecycle.closeConnectionTradeStats || {};
    const controlAtClose = roleLifecycle.closeConnectionControlFrameStats || {};
    lines.push(`    - ${role}: connected=${roleStats.connected === true}, messages/new/trade/migration=${roleStats.messages || 0} / ${roleStats.newTokens || 0} / ${roleStats.trades || 0} / ${roleStats.migrations || 0}, closes/errors/stale=${roleLifecycle.closed || roleStats.closeEvents || 0} / ${roleLifecycle.websocketErrors || 0} / ${roleLifecycle.staleReconnects || roleStats.staleReconnects || 0}, closeAge median/p90/max=${age.median === null || age.median === undefined ? 'n/a' : `${fmt(age.median, 0)}ms`} / ${age.p90 === null || age.p90 === undefined ? 'n/a' : `${fmt(age.p90, 0)}ms`} / ${age.max === null || age.max === undefined ? 'n/a' : `${fmt(age.max, 0)}ms`}, buckets=${buckets['<30s'] || 0}/${buckets['30-90s'] || 0}/${buckets['90-180s'] || 0}/${buckets['180-300s'] || 0}/${buckets['>300s'] || 0}, close median msg/trade/control=${messagesAtClose.median === null || messagesAtClose.median === undefined ? 'n/a' : fmt(messagesAtClose.median, 0)} / ${tradesAtClose.median === null || tradesAtClose.median === undefined ? 'n/a' : fmt(tradesAtClose.median, 0)} / ${controlAtClose.median === null || controlAtClose.median === undefined ? 'n/a' : fmt(controlAtClose.median, 0)}`);
  });
  lines.push(`  - split-socket isolation: bothDown count/ms=${pumpPortalHealth.crossSocket?.bothConnectionsDownCount || 0} / ${pumpPortalHealth.crossSocket?.bothConnectionsDownMs || 0}, discoveryEventsWhileTradestreamDown=${pumpPortalHealth.crossSocket?.discoveryEventsWhileTradestreamDown || 0}, tradestreamEventsWhileDiscoveryDown=${pumpPortalHealth.crossSocket?.tradestreamEventsWhileDiscoveryDown || 0}`);
  lines.push(`  - current/max reconnect backoff delay: ${pumpPortalHealth.reconnectDelayMs ? `${pumpPortalHealth.reconnectDelayMs}ms` : 'n/a'} / ${pumpPortalHealth.maxReconnectDelayMs ? `${pumpPortalHealth.maxReconnectDelayMs}ms` : 'n/a'}`);
  lines.push(`  - stable reconnect resets / reset window: ${pumpPortalHealth.reconnectDelayStableResets} / ${pumpPortalHealth.reconnectDelayResetAfterStableMs ? `${pumpPortalHealth.reconnectDelayResetAfterStableMs}ms` : 'n/a'}`);
  lines.push(`  - connected at stop: ${pumpPortalHealth.connected}`);
  lines.push(`  - last close: code=${pumpPortalHealth.lastCloseCode ?? 'n/a'} reason=${pumpPortalHealth.lastCloseReason || 'none'}`);
  lines.push(`  - last websocket error: ${pumpPortalHealth.lastErrorMessage || 'none'}`);
  lines.push(`  - event counts new_token/trade/migration/synthetic_migration: ${pumpPortalHealth.eventCounts.newTokens} / ${pumpPortalHealth.eventCounts.trades} / ${pumpPortalHealth.eventCounts.migrations} / ${pumpPortalHealth.eventCounts.syntheticMigrations}`);
  lines.push(`  - interpretation: ${pumpPortalHealth.interpretation}`);
  lines.push('- PumpDev shadow feed health:');
  lines.push(`  - status / enabled / connected / mode / drivesPreMigration: ${pumpDevHealth.status} / ${pumpDevHealth.enabled} / ${pumpDevHealth.connected} / ${pumpDevHealth.feedMode} / ${pumpDevHealth.drivesPreMigration}`);
  lines.push(`  - messages / new tokens / trades / mint events / migrations: ${pumpDevHealth.messages} / ${pumpDevHealth.newTokens} / ${pumpDevHealth.trades} / ${pumpDevHealth.mintEvents} / ${pumpDevHealth.migrations}`);
  lines.push(`  - reconnects / closes / errors: ${pumpDevHealth.reconnectAttempts} / ${pumpDevHealth.closeEvents} / ${pumpDevHealth.errorEvents}`);
  lines.push(`  - token trade subscription load: active=${pumpDevHealth.subscribedMints}, max=${pumpDevHealth.maxSubscribedMints || 'n/a'}, subscribeFrames=${pumpDevHealth.tokenTradeSubscribeFrames || 0}, controlFrames=${pumpDevHealth.controlFramesSent || 0}`);
  lines.push(`  - message handler queue: active=${pumpDevHealth.eventQueueActive}, depth/max=${pumpDevHealth.eventQueueDepth} / ${pumpDevHealth.eventQueueMaxDepth}, processed/dropped/coalesced/stop-discarded/errors=${pumpDevHealth.eventQueueProcessed} / ${pumpDevHealth.eventQueueDropped} / ${pumpDevHealth.eventQueueTradeCoalesced || 0} / ${pumpDevHealth.eventQueueDiscardedOnStop} / ${pumpDevHealth.eventQueueErrors}, concurrency=${pumpDevHealth.eventHandlerConcurrency || 'n/a'}, max=${pumpDevHealth.eventQueueMaxSize || 'n/a'}`);
  lines.push(`  - pair-base total SOL/USDC/unknown: ${pumpDevHealth.pairSolEvents || 0} / ${pumpDevHealth.pairUsdcEvents || 0} / ${pumpDevHealth.pairUnknownEvents || 0}`);
  lines.push(`  - pair-base by event newToken SOL/USDC/unknown: ${pumpDevHealth.newTokenPairSolEvents || 0} / ${pumpDevHealth.newTokenPairUsdcEvents || 0} / ${pumpDevHealth.newTokenPairUnknownEvents || 0}`);
  lines.push(`  - pair-base by event trade SOL/USDC/unknown: ${pumpDevHealth.tradePairSolEvents || 0} / ${pumpDevHealth.tradePairUsdcEvents || 0} / ${pumpDevHealth.tradePairUnknownEvents || 0}; mintEvent SOL/USDC/unknown: ${pumpDevHealth.mintEventPairSolEvents || 0} / ${pumpDevHealth.mintEventPairUsdcEvents || 0} / ${pumpDevHealth.mintEventPairUnknownEvents || 0}`);
  lines.push(`  - provider curve snapshots total/SOL/USDC: ${pumpDevHealth.providerCurveSnapshots || 0} / ${pumpDevHealth.providerCurveSolSnapshots || 0} / ${pumpDevHealth.providerCurveUsdcSnapshots || 0}`);
  lines.push(`  - websocket heartbeat: pingInterval=${pumpDevHealth.pingIntervalMs ? `${pumpDevHealth.pingIntervalMs}ms` : 'off'}, pings/pongs=${pumpDevHealth.pingsSent || 0} / ${pumpDevHealth.pongsReceived || 0}`);
  lines.push(`  - primary silence fail-fast: enabled=${pumpDevHealth.primarySilenceFailFastEnabled} timeout=${pumpDevHealth.primarySilenceTimeoutMs || 0}ms tripped=${pumpDevHealth.primarySilenceTripped} events=${pumpDevHealth.primarySilenceTimeouts || 0} elapsed=${pumpDevHealth.primarySilenceElapsedMs === null ? 'n/a' : `${fmt(pumpDevHealth.primarySilenceElapsedMs, 0)}ms`}`);
  if ((pumpDevHealth.lifecycle?.closed || 0) > 0) {
    const age = pumpDevHealth.lifecycle.closeAgeStats || {};
    const ageBuckets = pumpDevHealth.lifecycle.closeAgeBuckets || {};
    const closeMessages = pumpDevHealth.lifecycle.closeConnectionMessageStats || {};
    const closeTrades = pumpDevHealth.lifecycle.closeConnectionTradeStats || {};
    const closeControlFrames = pumpDevHealth.lifecycle.closeConnectionControlFrameStats || {};
    const closeMessagesPerMinute = pumpDevHealth.lifecycle.closeConnectionMessagesPerMinuteStats || {};
    const closeLastMessageAge = pumpDevHealth.lifecycle.closeLastMessageAgeStats || {};
    lines.push(`  - structured close lifecycle: connected/closed/errors=${pumpDevHealth.lifecycle.connected} / ${pumpDevHealth.lifecycle.closed} / ${pumpDevHealth.lifecycle.websocketErrors}, closeAge median/p90/max=${age.median === null ? 'n/a' : `${fmt(age.median, 0)}ms`} / ${age.p90 === null ? 'n/a' : `${fmt(age.p90, 0)}ms`} / ${age.max === null ? 'n/a' : `${fmt(age.max, 0)}ms`}`);
    lines.push(`  - closeAge buckets <30s/30-90s/90-180s/180-300s/>300s: ${ageBuckets['<30s'] || 0} / ${ageBuckets['30-90s'] || 0} / ${ageBuckets['90-180s'] || 0} / ${ageBuckets['180-300s'] || 0} / ${ageBuckets['>300s'] || 0}`);
    lines.push(`  - close connection traffic median messages/trades/controlFrames/msgPerMin/lastMsgAge: ${closeMessages.median === null ? 'n/a' : fmt(closeMessages.median, 0)} / ${closeTrades.median === null ? 'n/a' : fmt(closeTrades.median, 0)} / ${closeControlFrames.median === null ? 'n/a' : fmt(closeControlFrames.median, 0)} / ${closeMessagesPerMinute.median === null ? 'n/a' : fmt(closeMessagesPerMinute.median, 2)} / ${closeLastMessageAge.median === null ? 'n/a' : `${fmt(closeLastMessageAge.median, 0)}ms`}`);
  }
  lines.push(`  - event counts shadow_new/trade/mint/migration: ${pumpDevHealth.eventCounts.newTokens} / ${pumpDevHealth.eventCounts.trades} / ${pumpDevHealth.eventCounts.mintEvents} / ${pumpDevHealth.eventCounts.migrations}; runtime_new/trade=${pumpDevHealth.eventCounts.runtimeNewTokens} / ${pumpDevHealth.eventCounts.runtimeTrades}`);
  lines.push(`  - interpretation: ${pumpDevHealth.interpretation}`);
  lines.push('- PumpDev curve parity:');
  lines.push(`  - verdict: ${pumpDevCurveParity.verdict || 'n/a'}`);
  lines.push(`  - provider snapshots / on-chain updates / matched pairs: ${get(pumpDevCurveParity, 'counts.providerSnapshots', 0)} / ${get(pumpDevCurveParity, 'counts.onchainUpdates', 0)} / ${get(pumpDevCurveParity, 'counts.matchedPairs', 0)}`);
  lines.push(`  - completion-race / non-completion matched pairs: ${get(pumpDevCurveParity, 'counts.completionRaceMatches', 'n/a')} / ${get(pumpDevCurveParity, 'counts.nonCompletionRaceMatches', 'n/a')}`);
  lines.push(`  - match window / provider->onchain median age: ${pumpDevCurveParity.matchWindowMs || 'n/a'}ms / ${get(pumpDevCurveParity, 'deltas.providerToOnchainAgeMs.median', 'n/a')}ms`);
  lines.push(`  - abs curve delta median/p90/max: ${get(pumpDevCurveParity, 'deltas.absCurveDelta.median', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.absCurveDelta.p90', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.absCurveDelta.max', 'n/a')}`);
  lines.push(`  - non-completion abs curve delta median/p90/max: ${get(pumpDevCurveParity, 'deltas.nonCompletionRaceAbsCurveDelta.median', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.nonCompletionRaceAbsCurveDelta.p90', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.nonCompletionRaceAbsCurveDelta.max', 'n/a')}`);
  lines.push(`  - virtual-reserve formula abs delta median/p90/max: ${get(pumpDevCurveParity, 'deltas.virtualReserveAbsCurveDelta.median', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.virtualReserveAbsCurveDelta.p90', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.virtualReserveAbsCurveDelta.max', 'n/a')}`);
  lines.push(`  - abs price delta pct median/p90/max: ${get(pumpDevCurveParity, 'deltas.absPriceDeltaPct.median', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.absPriceDeltaPct.p90', 'n/a')} / ${get(pumpDevCurveParity, 'deltas.absPriceDeltaPct.max', 'n/a')}`);
  if (Array.isArray(pumpDevCurveParity.recommendations) && pumpDevCurveParity.recommendations.length) {
    lines.push(`  - recommendation: ${pumpDevCurveParity.recommendations[0]}`);
  }
  const targetedParitySummary = pumpDevTargetedCurveParity.summary || {};
  lines.push('- PumpDev targeted curve parity:');
  lines.push(`  - mode: ${pumpDevTargetedCurveParity.mode || 'n/a'}`);
  lines.push(`  - runtime decision-time samples: ${get(pumpDevTargetedCurveParity, 'inputs.runtimeSamples', 0)}`);
  lines.push(`  - candidate targets / sampled / comparable/fresh/stale: ${targetedParitySummary.candidateTargets ?? 'n/a'} / ${targetedParitySummary.sampledTargets ?? 'n/a'} / ${targetedParitySummary.comparableRows ?? 'n/a'} / ${targetedParitySummary.freshComparableRows ?? 'n/a'} / ${targetedParitySummary.staleComparableRows ?? 'n/a'}`);
  lines.push(`  - accountFound / missingProvider / fetchErrors: ${targetedParitySummary.accountFound ?? 'n/a'} / ${targetedParitySummary.missingProvider ?? 'n/a'} / ${targetedParitySummary.fetchErrors ?? 'n/a'}`);
  lines.push(`  - bonding-curve validated / invalid / unvalidated: ${targetedParitySummary.validatedBondingCurveRows ?? 'n/a'} / ${targetedParitySummary.invalidBondingCurveRows ?? 'n/a'} / ${targetedParitySummary.unvalidatedBondingCurveRows ?? 'n/a'}`);
  lines.push(`  - fresh abs curve delta median/p90/max (age<=${targetedParitySummary.maxFreshProviderToOnchainAgeMs ?? 'n/a'}ms): ${get(targetedParitySummary, 'freshAbsCurveDelta.median', 'n/a')} / ${get(targetedParitySummary, 'freshAbsCurveDelta.p90', 'n/a')} / ${get(targetedParitySummary, 'freshAbsCurveDelta.max', 'n/a')}`);
  lines.push(`  - abs curve delta median/p90/max: ${get(targetedParitySummary, 'absCurveDelta.median', 'n/a')} / ${get(targetedParitySummary, 'absCurveDelta.p90', 'n/a')} / ${get(targetedParitySummary, 'absCurveDelta.max', 'n/a')}`);
  lines.push(`  - fresh virtual-reserve formula abs delta median/p90/max: ${get(targetedParitySummary, 'freshVirtualReserveAbsCurveDelta.median', 'n/a')} / ${get(targetedParitySummary, 'freshVirtualReserveAbsCurveDelta.p90', 'n/a')} / ${get(targetedParitySummary, 'freshVirtualReserveAbsCurveDelta.max', 'n/a')}`);
  lines.push(`  - virtual-reserve formula abs delta median/p90/max: ${get(targetedParitySummary, 'virtualReserveAbsCurveDelta.median', 'n/a')} / ${get(targetedParitySummary, 'virtualReserveAbsCurveDelta.p90', 'n/a')} / ${get(targetedParitySummary, 'virtualReserveAbsCurveDelta.max', 'n/a')}`);
  lines.push(`  - provider->onchain age median/p90/max: ${get(targetedParitySummary, 'providerToOnchainAgeMs.median', 'n/a')} / ${get(targetedParitySummary, 'providerToOnchainAgeMs.p90', 'n/a')} / ${get(targetedParitySummary, 'providerToOnchainAgeMs.max', 'n/a')}ms`);
  lines.push(`  - virtual token reserve delta pct median/p90/max: ${get(targetedParitySummary, 'providerToOnchainVirtualTokenReserveDeltaPct.median', 'n/a')} / ${get(targetedParitySummary, 'providerToOnchainVirtualTokenReserveDeltaPct.p90', 'n/a')} / ${get(targetedParitySummary, 'providerToOnchainVirtualTokenReserveDeltaPct.max', 'n/a')}`);
  lines.push(`  - formula curve delta provider/onchain median: ${get(targetedParitySummary, 'providerFormulaCurveDelta.median', 'n/a')} / ${get(targetedParitySummary, 'onchainFormulaCurveDelta.median', 'n/a')}`);
  lines.push(`  - high delta rows >0.05 fresh/all: ${targetedParitySummary.freshHighDeltaCountGt005 ?? 'n/a'} / ${targetedParitySummary.highDeltaCountGt005 ?? 'n/a'}`);
  objectLines(targetedParitySummary.targetClassCounts, 5).forEach((line) => lines.push(`  - target class: ${line}`));
  objectLines(targetedParitySummary.semanticDiagnosisCounts, 6).forEach((line) => lines.push(`  - semantic diagnosis: ${line}`));
  const targetedHighDeltas = topArray(
    (pumpDevTargetedCurveParity.freshHighDeltaRows || []).length
      ? pumpDevTargetedCurveParity.freshHighDeltaRows
      : pumpDevTargetedCurveParity.highDeltaRows,
    5
  );
  if (targetedHighDeltas.length) {
    lines.push(`  - largest targeted deltas${(pumpDevTargetedCurveParity.freshHighDeltaRows || []).length ? '' : ' (stale post-run samples)' }:`);
    targetedHighDeltas.forEach((item, index) => {
      lines.push(`    ${index + 1}. ${candidateLabel(item)} | classes=${Array.isArray(item.targetClasses) ? item.targetClasses.join('+') : 'n/a'} | provider=${fmt(item.providerCurveProgress, 4)} | onchain=${fmt(item.onchainCurveProgress, 4)} | virtualFormula=${fmt(item.onchainCurveProgressByVirtualTokenReserves, 4)} | absDelta=${fmt(item.absCurveDelta, 4)} | reserveDelta=${fmt(item.providerToOnchainVirtualTokenReserveDeltaPct, 2)}% | age=${item.providerToOnchainAgeMs ?? 'n/a'}ms | diagnosis=${item.semanticDiagnosis || 'n/a'} | validated=${item.bondingCurveValidated === true} | complete=${item.complete === true}`);
    });
  }
  lines.push('- PumpPortal vs PumpDev shadow comparison:');
  lines.push(`  - new tokens / trades / migrations-or-mint-events: ${pumpPortalHealth.newTokens} vs ${pumpDevHealth.newTokens} / ${pumpPortalHealth.trades} vs ${pumpDevHealth.trades} / ${pumpPortalHealth.migrations} vs ${pumpDevHealth.mintEvents}`);
  lines.push(`  - closes / errors: ${pumpPortalHealth.closeEvents} / ${pumpPortalHealth.lifecycle?.websocketErrors || 0} vs ${pumpDevHealth.closeEvents} / ${pumpDevHealth.errorEvents}`);
  lines.push(`  - USDC pair events: ${pumpPortalHealth.pairUsdcEvents || 0} vs ${pumpDevHealth.pairUsdcEvents || 0}`);
  lines.push('- Bonding curve pressure:');
  lines.push(`  - fetches / updates / errors: ${bondingCurvePressure.fetches} / ${bondingCurvePressure.updates} / ${bondingCurvePressure.errors}`);
  lines.push(`  - batched RPC: enabled=${bondingCurvePressure.batchFetchEnabled} commitment=${bondingCurvePressure.rpcCommitment} batches/accounts/deduped/pending=${bondingCurvePressure.rpcBatches} / ${bondingCurvePressure.batchAccounts} / ${bondingCurvePressure.batchDedupedRequests} / ${bondingCurvePressure.pendingAccountFetches} (flush=${bondingCurvePressure.batchFlushMs}ms max=${bondingCurvePressure.batchMaxAccounts})`);
  lines.push(`  - provider reserve snapshots: ${bondingCurvePressure.providerSnapshots || 0}`);
  lines.push(`  - missing / invalid accounts: ${bondingCurvePressure.missingAccounts} / ${bondingCurvePressure.invalidAccounts}`);
  lines.push(`  - unique complete mints observed / last complete: ${bondingCurvePressure.completeMintsObserved || 0} / ${bondingCurvePressure.lastCompleteMint || 'none'}${bondingCurvePressure.lastCompleteAt ? ` at ${bondingCurvePressure.lastCompleteAt}` : ''}`);
  lines.push(`  - global backoff activations / skipped / high-curve bypasses: ${bondingCurvePressure.globalBackoffActivations} / ${bondingCurvePressure.skippedGlobalBackoff} / ${bondingCurvePressure.skippedGlobalBackoffHighCurveBypass}`);
  lines.push(`  - engine queue / pending syncs: ${bondingCurvePressure.engineQueueSize} / ${bondingCurvePressure.enginePendingSyncs}`);
  lines.push(`  - targeted parity runtime scope: samples/inFlight=${bondingCurvePressure.pumpDevTargetedCurveParitySamples} / ${bondingCurvePressure.pumpDevTargetedCurveParityInFlight}, watch=${bondingCurvePressure.pumpDevTargetedCurveParitySampleWatchEnabled}, skips=${bondingCurvePressure.pumpDevTargetedCurveParitySampleSkipsEnabled}, eligible=${bondingCurvePressure.pumpDevTargetedCurveParitySampleEligibleEnabled}`);
  lines.push(`  - active / remaining: ${bondingCurvePressure.globalBackoffActive} / ${bondingCurvePressure.globalBackoffRemainingMs}ms`);
  lines.push(`  - last activation: ${bondingCurvePressure.lastGlobalBackoffActivatedAt || 'none'} (${bondingCurvePressure.lastGlobalBackoffErrorsInWindow} errors in window)`);
  lines.push('- Solana RPC pressure:');
  lines.push(`  - primary/fallback providers: ${solanaRpcPressure.primaryProvider || 'n/a'} / ${solanaRpcPressure.fallbackProvider || 'none'}`);
  lines.push(`  - HTTP agent: mode=${solanaRpcPressure.httpAgentMode}, accountReadTransport=${solanaRpcPressure.accountReadTransport}, accountReadProvider=${solanaRpcPressure.accountReadProvider || 'primary'}, configured=${solanaRpcPressure.httpAgentConfigured}, keepAlive=${solanaRpcPressure.httpAgentKeepAliveMsecs}ms, maxSockets=${solanaRpcPressure.httpAgentMaxSockets}, maxFree=${solanaRpcPressure.httpAgentMaxFreeSockets}, socketTimeout=${solanaRpcPressure.httpAgentTimeoutMs}ms, scheduling=${solanaRpcPressure.httpAgentScheduling}`);
  lines.push(`  - calls primary/fallback: ${solanaRpcPressure.primaryCalls} / ${solanaRpcPressure.fallbackCalls}; failures primary/fallback: ${solanaRpcPressure.primaryFailures} / ${solanaRpcPressure.fallbackFailures}`);
  lines.push(`  - degraded primary/fallback: ${solanaRpcPressure.primaryDegraded} / ${solanaRpcPressure.fallbackDegraded}; same-vendor fallback=${solanaRpcPressure.sameVendorFallback}; same-vendor enabled=${solanaRpcPressure.sameVendorFallbackEnabled}`);
  lines.push(`  - breaker streaks primary/fallback: ${solanaRpcPressure.primaryFailureStreak}/${solanaRpcPressure.primaryFailureThreshold} / ${solanaRpcPressure.fallbackFailureStreak}/${solanaRpcPressure.fallbackFailureThreshold}; levels=${solanaRpcPressure.primaryDowngradeLevel}/${solanaRpcPressure.fallbackDowngradeLevel}`);
  lines.push(`  - degradations primary/fallback: ${solanaRpcPressure.primaryDegradations} / ${solanaRpcPressure.fallbackDegradations}; suppressed primary/fallback failures: ${solanaRpcPressure.primaryFailuresSuppressed} / ${solanaRpcPressure.fallbackFailuresSuppressed}`);
  objectLines(solanaRpcPressure.failureClasses, 6).forEach((line) => lines.push(`  - failure class: ${line}`));
  lines.push(`  - last primary failure: ${solanaRpcPressure.lastPrimaryFailureAt || 'none'} | ${solanaRpcPressure.lastPrimaryFailureReason || 'n/a'}`);
  lines.push(`  - last fallback failure: ${solanaRpcPressure.lastFallbackFailureAt || 'none'} | ${solanaRpcPressure.lastFallbackFailureReason || 'n/a'}`);
  lines.push(`  - call telemetry started/completed/failed: ${solanaRpcPressure.callTelemetryStarted} / ${solanaRpcPressure.callTelemetryCompleted} / ${solanaRpcPressure.callTelemetryFailed}`);
  objectLines(solanaRpcPressure.startedByMethod, 4).forEach((line) => lines.push(`  - started method: ${line}`));
  objectLines(solanaRpcPressure.completedByMethod, 4).forEach((line) => lines.push(`  - completed method: ${line}`));
  objectLines(solanaRpcPressure.failedByMethod, 4).forEach((line) => lines.push(`  - failed method: ${line}`));
  objectLines(solanaRpcPressure.failedByCommitment, 4).forEach((line) => lines.push(`  - failed commitment: ${line}`));
  lines.push(`  - queue active/pending/maxDepth: ${solanaRpcPressure.active} / ${solanaRpcPressure.pending} / ${solanaRpcPressure.maxQueueDepth}; limits maxConcurrent=${solanaRpcPressure.maxConcurrentRequests || 'n/a'}, minInterval=${solanaRpcPressure.minRequestIntervalMs || 0}ms`);
  lines.push(`  - accountInfo cache hits/inFlightHits/writes/size/ttl: ${solanaRpcPressure.accountInfoCacheHits} / ${solanaRpcPressure.accountInfoInFlightHits} / ${solanaRpcPressure.accountInfoCacheWrites} / ${solanaRpcPressure.accountInfoCacheSize} / ${solanaRpcPressure.accountInfoCacheTtlMs}ms`);
  lines.push('- Runtime event-loop health:');
  const eventLoopSummary = runtimeHealthTelemetry.eventLoopSummary || {};
  lines.push(`  - monitor samples / lag events / max lag: ${eventLoopSummary.samples ?? 'n/a'} / ${eventLoopSummary.lagEvents ?? runtimeHealthTelemetry.eventLoopLagEvents} / ${ms(eventLoopSummary.maxLagMs ?? runtimeHealthTelemetry.eventLoopLagStats?.max)}`);
  lines.push(`  - lag event median/p90/max: ${ms(runtimeHealthTelemetry.eventLoopLagStats?.median)} / ${ms(runtimeHealthTelemetry.eventLoopLagStats?.p90)} / ${ms(runtimeHealthTelemetry.eventLoopLagStats?.max)} (n=${runtimeHealthTelemetry.eventLoopLagStats?.count ?? 0})`);
  if (eventLoopLagDiagnostic.summary) {
    const lagDiag = eventLoopLagDiagnostic.summary;
    const topGap = Object.entries(lagDiag.lagGapSecondBuckets || {})[0];
    lines.push(`  - diagnostic: ${lagDiag.diagnosis || 'n/a'}; 15s cadence share=${pct(lagDiag.fifteenSecondCadenceShare, 1)} (${lagDiag.fifteenSecondGapCount ?? 'n/a'} / ${lagDiag.lagGapCount ?? 'n/a'} gaps); top gap=${topGap ? `${topGap[0]}=${topGap[1]}` : 'n/a'}`);
    const preceding = Object.entries(lagDiag.topPrecedingEventTypes5s || {}).slice(0, 5);
    if (preceding.length) {
      lines.push(`  - top event types in 5s before lag: ${preceding.map(([type, count]) => `${type}=${count}`).join(', ')}`);
    }
  }
  lines.push('- Finalist account verifier:');
  lines.push('  - Mode: report-only accountSubscribe lane for near-finalist bonding curves; does not drive decisions.');
  lines.push(`  - subscribed/updates/invalid/skipped/errors/unsubscribed: ${finalistAccountVerifierTelemetry.subscribed} / ${finalistAccountVerifierTelemetry.updates} / ${finalistAccountVerifierTelemetry.invalidUpdates} / ${finalistAccountVerifierTelemetry.skipped} / ${finalistAccountVerifierTelemetry.subscribeErrors} / ${finalistAccountVerifierTelemetry.unsubscribed}`);
  lines.push(`  - raw updates processed / telemetry emitted / suppressed: ${finalistAccountVerifierTelemetry.rawUpdatesProcessed} / ${finalistAccountVerifierTelemetry.updates} / ${finalistAccountVerifierTelemetry.updateTelemetrySuppressed} (minInterval=${finalistAccountVerifierTelemetry.updateTelemetryMinIntervalMs || 'n/a'}ms, minCurveDelta=${fmt(finalistAccountVerifierTelemetry.updateTelemetryMinCurveDelta, 4)})`);
  lines.push(`  - initial snapshots/missing/errors: ${finalistAccountVerifierTelemetry.initialSnapshots} / ${finalistAccountVerifierTelemetry.initialSnapshotMissing} / ${finalistAccountVerifierTelemetry.initialSnapshotErrors}`);
  objectLines(finalistAccountVerifierTelemetry.initialSnapshotMethods, 3).forEach((line) => lines.push(`  - initial snapshot method: ${line}`));
  lines.push(`  - unique subscribed/updated/invalid mints: ${finalistAccountVerifierTelemetry.uniqueSubscribedMints} / ${finalistAccountVerifierTelemetry.uniqueUpdatedMints} / ${finalistAccountVerifierTelemetry.uniqueInvalidMints}`);
  lines.push(`  - subscribed without account update: ${finalistAccountVerifierTelemetry.subscribedWithoutUpdate}`);
  lines.push(`  - first account update latency median/p90/max: ${ms(finalistAccountVerifierTelemetry.firstUpdateLatencyMs?.median)} / ${ms(finalistAccountVerifierTelemetry.firstUpdateLatencyMs?.p90)} / ${ms(finalistAccountVerifierTelemetry.firstUpdateLatencyMs?.max)} (n=${finalistAccountVerifierTelemetry.firstUpdateLatencyMs?.count ?? 0})`);
  lines.push(`  - shadow live-gate ready/blocked/checks: ${finalistAccountVerifierTelemetry.shadowGateReady} / ${finalistAccountVerifierTelemetry.shadowGateBlocked} / ${finalistAccountVerifierTelemetry.shadowGateChecks}`);
  objectLines(finalistAccountVerifierTelemetry.selectionClassCounts, 5).forEach((line) => lines.push(`  - selection class: ${line}`));
  objectLines(finalistAccountVerifierTelemetry.updateStages, 5).forEach((line) => lines.push(`  - update stage: ${line}`));
  objectLines(finalistAccountVerifierTelemetry.updateSources, 5).forEach((line) => lines.push(`  - update source: ${line}`));
  objectLines(finalistAccountVerifierTelemetry.shadowGateStatuses, 5).forEach((line) => lines.push(`  - shadow gate status: ${line}`));
  objectLines(finalistAccountVerifierTelemetry.shadowGateBlockedReasons, 5).forEach((line) => lines.push(`  - shadow gate block: ${line}`));
  objectLines(finalistAccountVerifierTelemetry.shadowGateByDecision, 5).forEach((line) => lines.push(`  - shadow gate decision: ${line}`));
  objectLines(finalistAccountVerifierTelemetry.skipReasons, 5).forEach((line) => lines.push(`  - skip reason: ${line}`));
  objectLines(finalistAccountVerifierTelemetry.invalidReasons, 5).forEach((line) => lines.push(`  - invalid reason: ${line}`));
  if (finalistAccountVerifierTelemetry.latestUpdates.length) {
    lines.push('  - latest account updates:');
    finalistAccountVerifierTelemetry.latestUpdates.slice(-5).forEach((item, index) => {
      const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
      lines.push(`    ${index + 1}. ${label} | source=${item.updateSource || 'n/a'} | slot=${item.slot ?? 'n/a'} | subCurve=${fmt(item.providerCurveProgressAtSubscribe, 4)} | wsCurve=${fmt(item.curveProgress, 4)} | delta=${fmt(item.subscriptionCurveDelta, 4)} | stage=${item.bondingStage || 'n/a'} | complete=${item.complete === true}`);
    });
  }
  if (finalistAccountVerifierTelemetry.latestShadowGateRows.length) {
    lines.push('  - latest shadow gate rows:');
    finalistAccountVerifierTelemetry.latestShadowGateRows.slice(-5).forEach((item, index) => {
      const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
      lines.push(`    ${index + 1}. ${label} | decision=${item.decision || 'n/a'} | status=${item.status || 'n/a'} | block=${item.blockedReason || 'none'} | age=${ms(item.accountAgeMs)} | paperCurve=${fmt(item.paperCurveProgress, 4)} | accountCurve=${fmt(item.accountCurveProgress, 4)} | delta=${fmt(item.curveDelta, 4)} | absDelta=${fmt(item.absCurveDelta, 4)} | maxDelta=${fmt(item.maxCurveDelta, 4)}`);
    });
  }
  lines.push('- Live execution dry-run:');
  lines.push('  - Mode: report-only; verifies finalist account state and economics, never broadcasts.');
  if (liveReadiness.verdict) {
    lines.push(`  - live-readiness verdict: ${liveReadiness.verdict}; infra blockers=${Array.isArray(liveReadiness.blockers) ? liveReadiness.blockers.length : 'n/a'}; launch blocks=${Array.isArray(liveReadiness.launchBlocks) ? liveReadiness.launchBlocks.length : 'n/a'}`);
    topArray(liveReadiness.launchBlocks, 4).forEach((line) => lines.push(`  - launch block: ${line}`));
  }
  lines.push(`  - attempts / would_send / would_block / skipped / errors / unique mints: ${liveExecutionDryRunTelemetry.attempts} / ${liveExecutionDryRunTelemetry.wouldSend} / ${liveExecutionDryRunTelemetry.wouldBlock} / ${liveExecutionDryRunTelemetry.skipped} / ${liveExecutionDryRunTelemetry.errors} / ${liveExecutionDryRunTelemetry.uniqueMints}`);
  lines.push(`  - account age median/p90/max: ${ms(liveExecutionDryRunTelemetry.accountAgeMs?.median)} / ${ms(liveExecutionDryRunTelemetry.accountAgeMs?.p90)} / ${ms(liveExecutionDryRunTelemetry.accountAgeMs?.max)} (n=${liveExecutionDryRunTelemetry.accountAgeMs?.count ?? 0})`);
  lines.push(`  - price impact pct median/p90/max: ${fmt(liveExecutionDryRunTelemetry.priceImpactPct?.median, 4)}% / ${fmt(liveExecutionDryRunTelemetry.priceImpactPct?.p90, 4)}% / ${fmt(liveExecutionDryRunTelemetry.priceImpactPct?.max, 4)}% (n=${liveExecutionDryRunTelemetry.priceImpactPct?.count ?? 0})`);
  lines.push(`  - post-trade price move pct median/p90/max: ${fmt(liveExecutionDryRunTelemetry.postTradePriceMovePct?.median, 4)}% / ${fmt(liveExecutionDryRunTelemetry.postTradePriceMovePct?.p90, 4)}% / ${fmt(liveExecutionDryRunTelemetry.postTradePriceMovePct?.max, 4)}% (n=${liveExecutionDryRunTelemetry.postTradePriceMovePct?.count ?? 0})`);
  lines.push(`  - blockhash ok true/false; latency median/p90/max: ${liveExecutionDryRunTelemetry.blockhashOk.true || 0} / ${liveExecutionDryRunTelemetry.blockhashOk.false || 0}; ${ms(liveExecutionDryRunTelemetry.blockhashLatencyMs?.median)} / ${ms(liveExecutionDryRunTelemetry.blockhashLatencyMs?.p90)} / ${ms(liveExecutionDryRunTelemetry.blockhashLatencyMs?.max)}`);
  lines.push(`  - simulation ok true/false/null: ${liveExecutionDryRunTelemetry.simulationOk.true || 0} / ${liveExecutionDryRunTelemetry.simulationOk.false || 0} / ${liveExecutionDryRunTelemetry.simulationOk.null || 0}`);
  objectLines(liveExecutionDryRunTelemetry.simulationErrors, 4).forEach((line) => lines.push(`  - simulation error: ${line}`));
  objectLines(liveExecutionDryRunTelemetry.simulationMissingAccounts, 8).forEach((line) => lines.push(`  - simulation missing account: ${line}`));
  objectLines(liveExecutionDryRunTelemetry.simulationPassedWithPreflightMissingAccounts, 5).forEach((line) => lines.push(`  - pre-sim absent/created by tx and sim ok: ${line}`));
  objectLines(liveExecutionDryRunTelemetry.blockReasons, 6).forEach((line) => lines.push(`  - would_block reason: ${line}`));
  objectLines(liveExecutionDryRunTelemetry.skipReasons, 4).forEach((line) => lines.push(`  - skipped reason: ${line}`));
  objectLines(liveExecutionDryRunTelemetry.byDecision, 5).forEach((line) => lines.push(`  - source decision: ${line}`));
  objectLines(liveExecutionDryRunTelemetry.txBuildStatuses, 4).forEach((line) => lines.push(`  - tx build status: ${line}`));
  if (liveExecutionDryRunTelemetry.latestRows.length) {
    lines.push('  - latest dry-run rows:');
    liveExecutionDryRunTelemetry.latestRows.slice(-5).forEach((item, index) => {
      const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
      lines.push(`    ${index + 1}. ${label} | event=${item.eventType || 'n/a'} | reason=${item.reason || 'none'} | decision=${item.sourceDecision || 'n/a'} | age=${ms(item.accountAgeMs)} | curve=${fmt(item.accountCurveProgress, 4)} | amount=${fmt(item.amountSol, 4)} SOL | impact=${fmt(item.priceImpactPct, 4)}% | postMove=${fmt(item.postTradePriceMovePct, 4)}% | blockhash=${item.blockhashOk === true} | sim=${item.simulationOk === null ? 'n/a' : item.simulationOk === true} | signed=${item.signedOk === null || item.signedOk === undefined ? 'n/a' : item.signedOk === true} | broadcast=${item.broadcastEnabled === true} | sig=${item.signatureMode || 'n/a'} | tx=${item.txBuildStatus || 'n/a'}`);
      if (item.simulationError) lines.push(`       simError=${item.simulationError}`);
      if (item.missingAccounts?.length) lines.push(`       missing=${item.missingAccounts.map((account) => account.name || account.pubkey).join(', ')}`);
      if (item.simulationLogs?.length) lines.push(`       simLogs=${item.simulationLogs.join(' | ')}`);
    });
  }
  if (dryRunOutcome.summary) {
    const dryRunOutcomeSummary = dryRunOutcome.summary || {};
    const dryRunWindow120 = dryRunOutcomeSummary.windowSummary?.['120s'] || {};
    const dryRunWindow300 = dryRunOutcomeSummary.windowSummary?.['300s'] || {};
    lines.push('  - dry-run outcome follow-through:');
    lines.push(`    - would_send attempts / unique mints: ${dryRunOutcomeSummary.wouldSend ?? 'n/a'} / ${dryRunOutcomeSummary.uniqueWouldSendMints ?? 'n/a'}`);
    lines.push(`    - crossed 85/90 within 120s: ${dryRunWindow120.crossed85 ?? 'n/a'} / ${dryRunWindow120.crossed90 ?? 'n/a'}; uniqueCross85/90=${dryRunWindow120.uniqueCrossed85 ?? 'n/a'} / ${dryRunWindow120.uniqueCrossed90 ?? 'n/a'}`);
    lines.push(`    - crossed 85/90 within 300s: ${dryRunWindow300.crossed85 ?? 'n/a'} / ${dryRunWindow300.crossed90 ?? 'n/a'}; uniqueCross85/90=${dryRunWindow300.uniqueCrossed85 ?? 'n/a'} / ${dryRunWindow300.uniqueCrossed90 ?? 'n/a'}`);
    lines.push(`    - curve delta 120s median/p90/max: ${fmt(dryRunWindow120.curveDelta?.median, 4)} / ${fmt(dryRunWindow120.curveDelta?.p90, 4)} / ${fmt(dryRunWindow120.curveDelta?.max, 4)}`);
    lines.push(`    - price delta 120s median/p90/max: ${fmt(dryRunWindow120.maxPriceDeltaPct?.median, 2)}% / ${fmt(dryRunWindow120.maxPriceDeltaPct?.p90, 2)}% / ${fmt(dryRunWindow120.maxPriceDeltaPct?.max, 2)}%`);
    objectLines(dryRunOutcomeSummary.sourceReasonCounts, 4).forEach((line) => lines.push(`    - source reason: ${line}`));
    const topDryRunFollowThrough = topArray(dryRunOutcome.topWouldSendFollowThrough, 5);
    if (topDryRunFollowThrough.length) {
      lines.push('    - top would_send follow-through:');
      topDryRunFollowThrough.forEach((item, index) => {
        const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
        lines.push(`      ${index + 1}. ${label} | reason=${item.sourceReason || 'n/a'} | curve=${fmt(item.accountCurveProgress, 4)} | max120=${fmt(item.max120, 4)} | max300=${fmt(item.max300, 4)} | delta120=${fmt(item.curveDelta120s, 4)} | priceDelta120=${fmt(item.priceDelta120sPct, 2)}% | cross90_120=${item.crossed90Within120s === true}`);
      });
    }
  }
  const dryRunEntryReplay = docs.preMigrationDryRunEntryReplay.data || {};
  const dryRunEntryProfiles = dryRunEntryReplay.firstPerMint?.summaryByProfile || {};
  if (Object.keys(dryRunEntryProfiles).length) {
    lines.push('  - dry-run entry replay, first eligible attempt per mint:');
    lines.push(`    - candidates / size / fee: ${dryRunEntryReplay.firstPerMint?.candidates ?? 'n/a'} / ${sol(dryRunEntryReplay.assumptions?.sizeSol, 4)} / ${sol(dryRunEntryReplay.assumptions?.feeSol, 4)}`);
    Object.entries(dryRunEntryProfiles).forEach(([profile, summary]) => {
      const tags = Array.isArray(summary.verdictTags) && summary.verdictTags.length
        ? `, tags=${summary.verdictTags.join(',')}`
        : '';
      lines.push(`    - ${profile}: trades=${summary.trades ?? 'n/a'}, wins/losses=${summary.wins ?? 'n/a'}/${summary.losses ?? 'n/a'}, winRate=${pct(summary.winRate, 1)}, pnl=${sol(summary.totalPnlSol, 9)}, exTop1=${sol(summary.pnlAfterRemovingTopWinnerSol, 9)}, exTop3=${sol(summary.pnlAfterRemovingTop3WinnersSol, 9)}, top1GrossShare=${pct(summary.topWinnerShareOfGrossProfit, 1)}${tags}`);
    });
  }
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

  const runnerRejectSummary = runnerRejectFollowThrough.summary || {};
  const runnerRejectTop = topArray(runnerRejectFollowThrough.topPre90Wakeups || runnerRejectFollowThrough.topWakeups, 8);
  const runnerRejectReplay = runnerRejectFollowThrough.pre90MigrationRequiredReplay || {};
  const runnerRejectReplaySummary = runnerRejectReplay.summary || {};
  lines.push('2b. Runner Reject Follow-through');
  lines.push('---------------------------------');
  lines.push('- Mode: report-only; joins trade.rejected rows to later PumpDev curve/price snapshots.');
  lines.push(`- Deduped rejects / raw rejects / unique mints: ${runnerRejectSummary.rejects ?? 'n/a'} / ${runnerRejectSummary.rawRejects ?? 'n/a'} / ${runnerRejectSummary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Crossed 85/90 within 120s: ${runnerRejectSummary.crossed85Within120s ?? 'n/a'} / ${runnerRejectSummary.crossed90Within120s ?? 'n/a'}`);
  lines.push(`- Actionable pre-90 rejects / unique / crossed85/90 within 120s: ${runnerRejectSummary.pre90Rejects ?? 'n/a'} / ${runnerRejectSummary.pre90UniqueMints ?? 'n/a'} / ${runnerRejectSummary.pre90Crossed85Within120s ?? 'n/a'} / ${runnerRejectSummary.pre90Crossed90Within120s ?? 'n/a'}`);
  lines.push(`- Max curve 120s median/p90/max: ${fmt(runnerRejectSummary.maxCurve120s?.median, 4)} / ${fmt(runnerRejectSummary.maxCurve120s?.p90, 4)} / ${fmt(runnerRejectSummary.maxCurve120s?.max, 4)}`);
  lines.push(`- Pre-90 price delta 120s median/p90/max: ${fmt(runnerRejectSummary.pre90MaxPriceDeltaPct120s?.median, 2)}% / ${fmt(runnerRejectSummary.pre90MaxPriceDeltaPct120s?.p90, 2)}% / ${fmt(runnerRejectSummary.pre90MaxPriceDeltaPct120s?.max, 2)}%`);
  lines.push(`- Pre-90 migration-required replay: trades=${runnerRejectReplaySummary.trades ?? 'n/a'}, wins/losses=${runnerRejectReplaySummary.wins ?? 'n/a'}/${runnerRejectReplaySummary.losses ?? 'n/a'}, winRate=${pct(runnerRejectReplaySummary.winRate, 1)}, pnl=${sol(runnerRejectReplaySummary.totalPnlSol, 6)}, exits=${compactValue(runnerRejectReplaySummary.exitReasonCounts)}`);
  lines.push('- Reject reason counts:');
  objectLines(runnerRejectSummary.reasonCounts, 6).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Pump failure reason counts:');
  objectLines(runnerRejectSummary.pumpFailureReasonCounts, 6).forEach((line) => lines.push(`  - ${line}`));
  if (runnerRejectTop.length) {
    lines.push('- Top pre-90 rejected wakeups:');
    runnerRejectTop.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRunnerRejectWakeup(item)}`));
  } else {
    lines.push('- Top pre-90 rejected wakeups: none');
  }
  lines.push('');

  const runnerRejectReplayProfiles = runnerRejectEntryReplay.summaryByProfile || {};
  lines.push('2c. Runner Reject Entry Replay');
  lines.push('------------------------------');
  lines.push('- Mode: report-only; simulates rejected pre-90 runner entries from later telemetry snapshots.');
  lines.push(`- Candidates: ${runnerRejectEntryReplay.inputs?.candidates ?? 'n/a'} | size SOL: ${fmt(runnerRejectEntryReplay.assumptions?.sizeSol, 4)} | fee SOL: ${fmt(runnerRejectEntryReplay.assumptions?.feeSol, 6)} | default slippage entry/exit: ${fmt(runnerRejectEntryReplay.assumptions?.defaultEntrySlippagePct, 2)}%/${fmt(runnerRejectEntryReplay.assumptions?.defaultExitSlippagePct, 2)}%`);
  const replayLines = Object.entries(runnerRejectReplayProfiles).map(([name, item]) => summarizeRunnerRejectReplayProfile(name, item));
  if (replayLines.length) replayLines.forEach((line) => lines.push(`- ${line}`));
  else lines.push('- Profiles: none');
  lines.push('- Caveat: replay applies configured slippage stress but still does not model quote fill, MEV, liquidity, or broadcast latency.');
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
  lines.push(`- Wallet-led entry replay: verdict=${walletEntryReplaySummary.verdict || 'n/a'}, eligible=${walletEntryReplaySummary.shadowLaneEligible === true ? 'yes' : 'no'}, strongMisses=${walletEntryReplaySummary.strongWalletLedMisses ?? 'n/a'}, wouldEnter=${walletEntryReplaySummary.wouldEnter ?? 'n/a'}, noGateConfirm=${walletEntryReplaySummary.noGateConfirmAfterTouch ?? 'n/a'}, pnl=${walletEntryReplaySummary.totalPnlSol === null || walletEntryReplaySummary.totalPnlSol === undefined ? 'n/a' : sol(walletEntryReplaySummary.totalPnlSol, 6)}, stressed=${walletEntryReplaySummary.stressedPnlSol === null || walletEntryReplaySummary.stressedPnlSol === undefined ? 'n/a' : sol(walletEntryReplaySummary.stressedPnlSol, 6)}, winRate=${pct(walletEntryReplaySummary.winRate)}`);
  if (walletEntryReplaySummary.verdictReason) lines.push(`  - verdict reason: ${walletEntryReplaySummary.verdictReason}`);
  const walletReplayTags = Array.isArray(walletEntryReplaySummary.verdictTags) && walletEntryReplaySummary.verdictTags.length
    ? `, tags=${walletEntryReplaySummary.verdictTags.join(',')}`
    : '';
  lines.push(`  - durability: firstHalf=${walletEntryReplaySummary.firstHalfPnlSol === null || walletEntryReplaySummary.firstHalfPnlSol === undefined ? 'n/a' : sol(walletEntryReplaySummary.firstHalfPnlSol, 6)}, secondHalf=${walletEntryReplaySummary.secondHalfPnlSol === null || walletEntryReplaySummary.secondHalfPnlSol === undefined ? 'n/a' : sol(walletEntryReplaySummary.secondHalfPnlSol, 6)}, exTop1=${walletEntryReplaySummary.pnlAfterTopWinnerSol === null || walletEntryReplaySummary.pnlAfterTopWinnerSol === undefined ? 'n/a' : sol(walletEntryReplaySummary.pnlAfterTopWinnerSol, 6)}, exTop3=${walletEntryReplaySummary.pnlAfterTop3WinnersSol === null || walletEntryReplaySummary.pnlAfterTop3WinnersSol === undefined ? 'n/a' : sol(walletEntryReplaySummary.pnlAfterTop3WinnersSol, 6)}, top1GrossShare=${pct(walletEntryReplaySummary.topWinnerShareOfGrossProfit)}${walletReplayTags}`);
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
  if (ledger.summary) {
    lines.push(`- Outcome ledger coverage: events=${ledger.summary.rawEvents ?? 'n/a'}, uniqueMints=${ledger.summary.uniqueMints ?? 'n/a'}, emittedOutcomes=${ledger.summary.emittedOutcomes ?? 'n/a'}${ledger.summary.outcomesTruncated ? ` (truncated at ${ledger.summary.maxOutcomes ?? 'configured limit'})` : ''}`);
  }
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
    objectLines(entryParitySummary.liveReadinessCounts, 6).forEach((line) => lines.push(`  - Live readiness: ${line}`));
    topArray(entryParity.actualEntries, 5).forEach((item) => {
      lines.push(`  - Actual entry live gate: ${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim()
        + ` | ${item.liveReadiness || 'n/a'}`
        + ` | ${item.liveReadinessReason || 'n/a'}`
        + ` | pnl=${item.pnlSol === null || item.pnlSol === undefined ? 'n/a' : sol(item.pnlSol, 6)}`);
    });
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

  const skipFollowSummary = skipFollowThrough.summary || {};
  const skipReasonSummaries = topArray(skipFollowThrough.reasonSummaries, 8);
  const skipTopWakeups = topArray(skipFollowThrough.topWakeups, 8);
  const entryGateMargin = docs.preMigrationEntryGateMargin.data || {};
  const entryGateMarginSummary = entryGateMargin.summary || {};
  const entryGateClosest = topArray(entryGateMargin.closestByMint, 8);

  lines.push('9b. Pre-Migration Skip Follow-through');
  lines.push('-------------------------------------');
  lines.push('- Mode: report-only; joins every PAPER_SKIPPED reason to later PumpDev curve/price snapshots.');
  lines.push(`- Skip decisions / unique mints: ${skipFollowSummary.skipDecisionCount ?? 'n/a'} / ${skipFollowSummary.uniqueSkippedMints ?? 'n/a'}`);
  lines.push(`- Reasons with any 85/90 curve cross within 120s: ${Array.isArray(skipFollowSummary.reasonsWithAnyCross85Within120s) ? skipFollowSummary.reasonsWithAnyCross85Within120s.join(', ') || 'none' : 'n/a'} / ${Array.isArray(skipFollowSummary.reasonsWithAnyCross90Within120s) ? skipFollowSummary.reasonsWithAnyCross90Within120s.join(', ') || 'none' : 'n/a'}`);
  lines.push('- Skip reason counts:');
  objectLines(skipFollowSummary.skipReasonCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Follow-through classes:');
  objectLines(skipFollowSummary.followThroughClassCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (skipReasonSummaries.length) {
    lines.push('- Reason summaries:');
    skipReasonSummaries.forEach((item) => {
      lines.push(`  - ${item.reason}: decisions=${item.decisionCount ?? 'n/a'}, unique=${item.uniqueMints ?? 'n/a'}, future120=${item.decisionsWithFuture120s ?? 'n/a'}, crossed85/90/95/100=${item.crossed85Within120s ?? 'n/a'}/${item.crossed90Within120s ?? 'n/a'}/${item.crossed95Within120s ?? 'n/a'}/${item.crossed100Within120s ?? 'n/a'}, uniqueCross85/90=${item.uniqueMintsCrossed85Within120s ?? 'n/a'}/${item.uniqueMintsCrossed90Within120s ?? 'n/a'}, delta120 median/p90/max=${fmt(item.curveDelta120s?.median, 4)}/${fmt(item.curveDelta120s?.p90, 4)}/${fmt(item.curveDelta120s?.max, 4)}`);
    });
  }
  if (skipTopWakeups.length) {
    lines.push('- Top post-skip wakeups:');
    skipTopWakeups.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeSkipFollowThrough(item)}`));
  } else {
    lines.push('- Top post-skip wakeups: none');
  }
  lines.push('');

  lines.push('9b2. Pre-Migration Entry Gate Margin');
  lines.push('------------------------------------');
  lines.push('- Mode: report-only; ranks the tightest measurable skipped-entry gate by preset/reason.');
  lines.push(`- Skip decisions / unique mints: ${entryGateMarginSummary.decisions ?? 'n/a'} / ${entryGateMarginSummary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Readiness pct median/p90/max: ${fmt(entryGateMarginSummary.readinessPct?.median, 2)}% / ${fmt(entryGateMarginSummary.readinessPct?.p90, 2)}% / ${fmt(entryGateMarginSummary.readinessPct?.max, 2)}%`);
  lines.push('- Tightest measurable gates:');
  objectLines(entryGateMarginSummary.tightestGateCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Preset counts:');
  objectLines(entryGateMarginSummary.presetCounts, 6).forEach((line) => lines.push(`  - ${line}`));
  const entryGateNearMiss = entryGateMargin.nearMissFollowThrough || {};
  const entryGateNearMissSummary = entryGateNearMiss.summary || {};
  const entryGateNearMissByGate = entryGateNearMiss.byTightestGate || {};
  if (entryGateNearMissSummary.decisions !== undefined) {
    lines.push(`- Near-miss follow-through >=${entryGateNearMiss.minReadinessPct ?? 'n/a'}% readiness: decisions=${entryGateNearMissSummary.decisions ?? 'n/a'}, unique=${entryGateNearMissSummary.uniqueMints ?? 'n/a'}, future120=${entryGateNearMissSummary.decisionsWithFuture120s ?? 'n/a'}, reached85/90/95 unique=${entryGateNearMissSummary.uniqueMintsReached85Within120s ?? 'n/a'}/${entryGateNearMissSummary.uniqueMintsReached90Within120s ?? 'n/a'}/${entryGateNearMissSummary.uniqueMintsReached95Within120s ?? 'n/a'}, crossed95 unique=${entryGateNearMissSummary.uniqueMintsCrossed95Within120s ?? 'n/a'}`);
    lines.push('- Near-miss follow-through by tightest gate:');
    Object.entries(entryGateNearMissByGate)
      .slice(0, 6)
      .forEach(([name, item]) => lines.push(`  - ${summarizeEntryGateNearMissFollowThrough(name, item)}`));
  }
  if (entryGateClosest.length) {
    lines.push('- Closest skipped mints:');
    entryGateClosest.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeEntryGateMargin(item)}`));
  } else {
    lines.push('- Closest skipped mints: none');
  }
  lines.push('');

  const skipNear90Summary = skipNear90Watchlist.summary || {};
  const skipNear90Top = topArray(skipNear90Watchlist.topWakeups, 8);
  const skipNear90Crossed = topArray(skipNear90Watchlist.crossed90Within120s, 8);

  lines.push('9c. LOW_SCORE / FIRST_SIGHT Near-90 Watchlist');
  lines.push('---------------------------------------------');
  lines.push('- Mode: report-only; dedupes LOW_SCORE and FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE skips by run + mint.');
  lines.push(`- Telemetry files / runs with target skips: ${skipNear90Watchlist.inputs?.telemetryFilesRead ?? 'n/a'} / ${skipNear90Summary.runCountWithTargetSkips ?? 'n/a'}`);
  lines.push(`- Raw decisions / deduped run-mints / unique mints: ${skipNear90Summary.rawDecisionCount ?? 'n/a'} / ${skipNear90Summary.dedupedRunMintCount ?? 'n/a'} / ${skipNear90Summary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Unique crossed 90 within 120s / 300s: ${skipNear90Summary.uniqueCross90Within120s ?? 'n/a'} / ${skipNear90Summary.uniqueCross90Within300s ?? 'n/a'}`);
  lines.push(`- Curve delta 120s median/p90/max: ${fmt(skipNear90Summary.curveDelta120s?.median, 4)} / ${fmt(skipNear90Summary.curveDelta120s?.p90, 4)} / ${fmt(skipNear90Summary.curveDelta120s?.max, 4)}`);
  lines.push(`- Price delta 120s median/p90/max: ${fmt(skipNear90Summary.maxPriceDeltaPct120s?.median, 2)}% / ${fmt(skipNear90Summary.maxPriceDeltaPct120s?.p90, 2)}% / ${fmt(skipNear90Summary.maxPriceDeltaPct120s?.max, 2)}%`);
  lines.push('- Target reason counts, raw:');
  objectLines(skipNear90Summary.reasonCountsRaw, 4).forEach((line) => lines.push(`  - ${line}`));
  if (skipNear90Crossed.length) {
    lines.push('- Crossed 90 within 120s:');
    skipNear90Crossed.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeSkipNear90Watchlist(item)}`));
  } else {
    lines.push('- Crossed 90 within 120s: none');
  }
  if (skipNear90Top.length) {
    lines.push('- Top near-90 wakeups:');
    skipNear90Top.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeSkipNear90Watchlist(item)}`));
  } else {
    lines.push('- Top near-90 wakeups: none');
  }
  lines.push('');

  const relaxedRanking = topArray(relaxedGateReplay.ranking, 8);
  const bestRelaxedProfileName = relaxedRanking[0]?.name;
  const bestRelaxedProfile = bestRelaxedProfileName ? relaxedGateReplay.profiles?.[bestRelaxedProfileName] : null;

  lines.push('9c2. Relaxed-Gate Replay');
  lines.push('------------------------');
  lines.push('- Mode: report-only; replays relaxed LOW_SCORE/FIRST_SIGHT entry archetypes from historical skips. Does not alter runtime gates.');
  lines.push(`- Telemetry files / target reasons: ${relaxedGateReplay.inputs?.telemetryFilesRead ?? 'n/a'} / ${Array.isArray(relaxedGateReplay.inputs?.targetReasons) ? relaxedGateReplay.inputs.targetReasons.join(', ') : 'n/a'}`);
  lines.push(`- Base trade: amount=${fmt(relaxedGateReplay.inputs?.baseTrade?.amountSol, 4)} SOL, entry/exit slippage=${fmt(relaxedGateReplay.inputs?.baseTrade?.entrySlippagePct, 2)}% / ${fmt(relaxedGateReplay.inputs?.baseTrade?.exitSlippagePct, 2)}%`);
  if (relaxedRanking.length) {
    lines.push('- Profile ranking:');
    relaxedRanking.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.name}: trades=${item.trades ?? 'n/a'}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, avg=${sol(item.averagePnlSol, 6)}, exits=${Object.entries(item.exitReasonCounts || {}).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
    });
  } else {
    lines.push('- Profile ranking: none');
  }
  if (bestRelaxedProfile) {
    const bestWinners = topArray(bestRelaxedProfile.topWinners, 5);
    const bestLosers = topArray(bestRelaxedProfile.topLosers, 5);
    lines.push(`- Best profile detail: ${bestRelaxedProfileName} | ${bestRelaxedProfile.profile?.description || 'n/a'}`);
    if (bestWinners.length) {
      lines.push('- Best-profile top winners:');
      bestWinners.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRelaxedGateTrade(item)}`));
    }
    if (bestLosers.length) {
      lines.push('- Best-profile top losers:');
      bestLosers.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRelaxedGateTrade(item)}`));
    }
  }
  lines.push('');

  const curveStallRanking = topArray(curveStallRelaxedReplay.ranking, 8);
  const bestCurveStallProfileName = curveStallRanking[0]?.name;
  const bestCurveStallProfile = bestCurveStallProfileName ? curveStallRelaxedReplay.profiles?.[bestCurveStallProfileName] : null;

  lines.push('9c2b. Curve-Stall Relaxed Replay');
  lines.push('---------------------------------');
  lines.push('- Mode: report-only; replays CURVE_NOT_ADVANCING skips to test whether curve-stall discipline is blocking a real paper lane. Does not alter runtime gates.');
  lines.push(`- Telemetry files / target reasons: ${curveStallRelaxedReplay.inputs?.telemetryFilesRead ?? 'n/a'} / ${Array.isArray(curveStallRelaxedReplay.inputs?.targetReasons) ? curveStallRelaxedReplay.inputs.targetReasons.join(', ') : 'n/a'}`);
  if (curveStallRanking.length) {
    lines.push('- Profile ranking:');
    curveStallRanking.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.name}: trades=${item.trades ?? 'n/a'}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, avg=${sol(item.averagePnlSol, 6)}, exits=${Object.entries(item.exitReasonCounts || {}).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
    });
  } else {
    lines.push('- Profile ranking: none');
  }
  if (bestCurveStallProfile) {
    const bestWinners = topArray(bestCurveStallProfile.topWinners, 5);
    const bestLosers = topArray(bestCurveStallProfile.topLosers, 5);
    lines.push(`- Best profile detail: ${bestCurveStallProfileName} | ${bestCurveStallProfile.profile?.description || 'n/a'}`);
    if (bestWinners.length) {
      lines.push('- Best-profile top winners:');
      bestWinners.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRelaxedGateTrade(item)}`));
    }
    if (bestLosers.length) {
      lines.push('- Best-profile top losers:');
      bestLosers.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRelaxedGateTrade(item)}`));
    }
  }
  lines.push('');

  const walletConditionedRanking = topArray(walletConditionedRelaxedGateReplay.ranking, 10);
  const walletConditionedSummary = walletConditionedRelaxedGateReplay.summary || {};
  const walletAvoidLift = topArray(walletConditionedRelaxedGateReplay.avoidNegativeLift, 8);
  const walletPositiveControls = Object.values(walletConditionedRelaxedGateReplay.slices || {})
    .filter((slice) => ['tracked_first_touch_buy_avoid_only', 'tracked_first_touch_buy_negative_only'].includes(slice.condition))
    .sort((a, b) => Number(b.trades || 0) - Number(a.trades || 0))
    .slice(0, 8);
  const walletProfiles = Array.isArray(walletConditionedRelaxedGateReplay.inputs?.profiles)
    ? walletConditionedRelaxedGateReplay.inputs.profiles.join(', ')
    : 'n/a';

  lines.push('9c3. Wallet-Conditioned Relaxed-Gate Replay');
  lines.push('--------------------------------------------');
  lines.push('- Mode: report-only; slices all relaxed-gate replay profiles by wallet-touch conditions. Does not alter runtime gates or live broadcast.');
  lines.push(`- Profiles: ${walletProfiles}`);
  lines.push(`- Total base trades / wallet events: ${walletConditionedRelaxedGateReplay.inputs?.totalBaseTrades ?? 'n/a'} / ${walletConditionedRelaxedGateReplay.inputs?.walletEvents ?? 'n/a'}`);
  lines.push(`- Slice verdicts: promising=${walletConditionedSummary.promisingSlices ?? 'n/a'}, inconclusive=${walletConditionedSummary.inconclusiveSlices ?? 'n/a'}, negative=${walletConditionedSummary.negativeSlices ?? 'n/a'}, insufficient=${walletConditionedSummary.insufficientSampleSlices ?? 'n/a'}, shadowEligible=${walletConditionedSummary.shadowLaneEligibleSlices ?? 'n/a'}`);
  lines.push(`- Avoid/negative exclusion improved/worsened profiles by stressed PnL: ${walletConditionedSummary.avoidNegativeImprovedProfiles ?? 'n/a'} / ${walletConditionedSummary.avoidNegativeWorsenedProfiles ?? 'n/a'}`);
  if (walletAvoidLift.length) {
    lines.push('- Avoid/negative exclusion lift by profile:');
    walletAvoidLift.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.profileName}: base=${item.baselineTrades ?? 'n/a'} -> kept=${item.conditionedTrades ?? 'n/a'} removed=${item.removedTrades ?? 'n/a'}, pnlDelta=${sol(item.pnlDeltaSol, 6)}, stressedDelta=${sol(item.stressedDeltaSol, 6)}, winRateDelta=${pct(item.winRateDelta, 1)}, verdict=${item.baselineVerdict || 'n/a'} -> ${item.conditionedVerdict || 'n/a'}`);
    });
  }
  if (walletPositiveControls.length) {
    lines.push('- AVOID/NEGATIVE first-touch-buy positive-control slices:');
    walletPositiveControls.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.name}: verdict=${item.verdict || 'n/a'}, trades=${item.trades ?? 'n/a'}, unique=${item.uniqueMints ?? 'n/a'}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, pnl=${sol(item.totalPnlSol, 6)}, stressed=${sol(item.stressedPnlSol, 6)}`);
    });
  }
  if (walletConditionedRanking.length) {
    lines.push('- Slice ranking:');
    walletConditionedRanking.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.name}: verdict=${item.verdict || 'n/a'}, eligible=${item.shadowLaneEligible ? 'yes' : 'no'}, trades=${item.trades ?? 'n/a'}, unique=${item.uniqueMints ?? 'n/a'}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, pnl/trade=${sol(item.averagePnlSol, 6)}, stressed=${sol(item.stressedPnlSol, 6)}, halves=${sol(item.firstHalfPnlSol, 6)} / ${sol(item.secondHalfPnlSol, 6)}, top3Removed=${sol(item.top3RemovedPnlSol, 6)}`);
    });
  } else {
    lines.push('- Slice ranking: none');
  }
  lines.push('');

  const walletShadowSummary = walletRelaxedShadowOutcome.summary || {};
  const walletShadowWindow120 = walletShadowSummary.windowSummary?.['120s'] || {};
  const walletShadowWindow300 = walletShadowSummary.windowSummary?.['300s'] || {};
  const walletShadowTop = topArray(walletRelaxedShadowOutcome.topWouldEnterFollowThrough, 8);

  lines.push('9c4. Wallet-Relaxed Shadow Outcome');
  lines.push('-----------------------------------');
  lines.push('- Mode: report-only; follows prospective wallet-conditioned LOW_SCORE/FIRST_SIGHT shadow would-enter rows. Does not alter runtime gates or live broadcast.');
  lines.push(`- Shadow attempts / would_enter / would_skip / unique would_enter mints: ${walletShadowSummary.attempts ?? 'n/a'} / ${walletShadowSummary.wouldEnter ?? 'n/a'} / ${walletShadowSummary.wouldSkip ?? 'n/a'} / ${walletShadowSummary.uniqueWouldEnterMints ?? 'n/a'}`);
  lines.push(`- Wallet context coverage any/no-touch/qualifying-first-touch/positive-or-proven/avoid: ${walletShadowSummary.contextCoverage?.withAnyWalletTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withNoWalletTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withQualifyingFirstTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withPositiveOrProvenTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withAvoidTouch ?? 'n/a'}`);
  lines.push(`- Crossed 85/90 within 120s: ${walletShadowWindow120.crossed85 ?? 'n/a'} / ${walletShadowWindow120.crossed90 ?? 'n/a'}; uniqueCross85/90=${walletShadowWindow120.uniqueCrossed85 ?? 'n/a'} / ${walletShadowWindow120.uniqueCrossed90 ?? 'n/a'}`);
  lines.push(`- Crossed 85/90 within 300s: ${walletShadowWindow300.crossed85 ?? 'n/a'} / ${walletShadowWindow300.crossed90 ?? 'n/a'}; uniqueCross85/90=${walletShadowWindow300.uniqueCrossed85 ?? 'n/a'} / ${walletShadowWindow300.uniqueCrossed90 ?? 'n/a'}`);
  lines.push(`- Curve delta 120s median/p90/max: ${fmt(walletShadowWindow120.curveDelta?.median, 4)} / ${fmt(walletShadowWindow120.curveDelta?.p90, 4)} / ${fmt(walletShadowWindow120.curveDelta?.max, 4)}`);
  lines.push(`- Price delta 120s median/p90/max: ${fmt(walletShadowWindow120.maxPriceDeltaPct?.median, 2)}% / ${fmt(walletShadowWindow120.maxPriceDeltaPct?.p90, 2)}% / ${fmt(walletShadowWindow120.maxPriceDeltaPct?.max, 2)}%`);
  lines.push('- Source reasons:');
  objectLines(walletShadowSummary.sourceReasonCounts, 4).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Wallet context sources:');
  objectLines(walletShadowSummary.contextCoverage?.walletContextSources, 4).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Positive first-touch review tiers:');
  objectLines(walletShadowSummary.positiveFirstTouchReviewTierCounts, 4).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Positive first-touch evidence tiers:');
  objectLines(walletShadowSummary.positiveFirstTouchEvidenceTierCounts, 4).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Qualifying first-touch review tiers:');
  objectLines(walletShadowSummary.qualifyingFirstTouchReviewTierCounts, 4).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Qualifying first-touch evidence tiers:');
  objectLines(walletShadowSummary.qualifyingFirstTouchEvidenceTierCounts, 4).forEach((line) => lines.push(`  - ${line}`));
  if (walletShadowTop.length) {
    lines.push('- Top wallet-relaxed shadow follow-through:');
    walletShadowTop.forEach((item, index) => {
      const label = `${item.symbol || 'UNKNOWN'} ${item.mint || ''}`.trim();
      const firstTouchRow = item.qualifyingFirstTouch || item.positiveFirstTouch;
      const firstTouch = firstTouchRow
        ? `${firstTouchRow.name || firstTouchRow.wallet || 'wallet'}:${firstTouchRow.reviewTier || firstTouchRow.evidenceTier || 'tier?'}/${firstTouchRow.side || 'side?'}`
        : 'none';
      lines.push(`  ${index + 1}. ${label} | reason=${item.sourceReason || 'n/a'} | curve=${fmt(item.curveProgress, 4)} | max120=${fmt(item.max120, 4)} | max300=${fmt(item.max300, 4)} | delta120=${fmt(item.curveDelta120s, 4)} | priceDelta120=${fmt(item.priceDelta120sPct, 2)}% | cross90_120=${item.crossed90Within120s === true} | firstTouch=${firstTouch}`);
    });
  } else {
    lines.push('- Top wallet-relaxed shadow follow-through: none');
  }
  lines.push('');

  const walletContextRuntime = walletContextCoverage.runtime || {};
  const walletContextRuntimeEvents = walletContextRuntime.walletEvents || {};
  const walletContextDecision = walletContextRuntime.decisionCoverage || {};
  const walletContextOverlap = walletContextRuntime.walletDecisionMintOverlap || {};
  const walletContextShadow = walletContextRuntime.walletRelaxedShadowCoverage || {};
  const walletContextLedger = walletContextCoverage.historicalLedger || {};
  const walletRuntimeToHistoricalRatio = Number(walletContextLedger.uniqueWallets) > 0 && Number(walletContextRuntimeEvents.uniqueWallets) >= 0
    ? Number(walletContextRuntimeEvents.uniqueWallets) / Number(walletContextLedger.uniqueWallets)
    : null;
  const walletHistoricalToRuntimeRatio = Number(walletContextRuntimeEvents.uniqueWallets) > 0 && Number(walletContextLedger.uniqueWallets) >= 0
    ? Number(walletContextLedger.uniqueWallets) / Number(walletContextRuntimeEvents.uniqueWallets)
    : null;
  const walletContextByReason = Object.entries(walletContextDecision.byReason || {})
    .sort((a, b) => Number(b[1]?.decisions || 0) - Number(a[1]?.decisions || 0))
    .slice(0, 6);

  lines.push('9c5. Wallet Context Coverage');
  lines.push('----------------------------');
  lines.push('- Mode: report-only; audits whether wallet-conditioned replay signals are actually present in current runtime decisions.');
  lines.push(`- Verdict: ${walletContextCoverage.verdict || 'n/a'}`);
  lines.push(`- Historical ledger events / wallets / mints: ${walletContextLedger.rows ?? 'n/a'} / ${walletContextLedger.uniqueWallets ?? 'n/a'} / ${walletContextLedger.uniqueMints ?? 'n/a'}`);
  lines.push(`- Runtime wallet touches rows / wallets / mints: ${walletContextRuntimeEvents.rows ?? 'n/a'} / ${walletContextRuntimeEvents.uniqueWallets ?? 'n/a'} / ${walletContextRuntimeEvents.uniqueMints ?? 'n/a'}`);
  lines.push(`- Runtime-vs-historical wallet coverage: ${pct(walletRuntimeToHistoricalRatio, 1)} of tracked historical wallets active this run; historical/runtime wallet ratio=${fmt(walletHistoricalToRuntimeRatio, 1)}x`);
  lines.push(`- Runtime promoted rows positive-or-proven / avoid / any promotion: ${walletContextRuntimeEvents.promotionCoverage?.positiveOrProvenRows ?? 'n/a'} / ${walletContextRuntimeEvents.promotionCoverage?.avoidRows ?? 'n/a'} / ${walletContextRuntimeEvents.promotionCoverage?.rowsWithPromotion ?? 'n/a'}`);
  lines.push(`- Paper decision wallet context any / positive-or-proven / avoid: ${walletContextDecision.withAnyWalletTouch ?? 'n/a'} / ${walletContextDecision.withPositiveOrProvenTouch ?? 'n/a'} / ${walletContextDecision.withAvoidTouch ?? 'n/a'} of ${walletContextDecision.decisions ?? 'n/a'} decisions`);
  lines.push(`- Wallet-event mints / decision mints / overlap: ${walletContextOverlap.uniqueWalletEventMints ?? 'n/a'} / ${walletContextOverlap.uniqueDecisionMints ?? 'n/a'} / ${walletContextOverlap.overlapMints ?? 'n/a'}`);
  lines.push(`- Wallet-relaxed shadow coverage attempts / withAny / positive-or-proven / avoid: ${walletContextShadow.attempts ?? 'n/a'} / ${walletContextShadow.withAnyWalletTouch ?? 'n/a'} / ${walletContextShadow.withPositiveOrProvenTouch ?? 'n/a'} / ${walletContextShadow.withAvoidTouch ?? 'n/a'}`);
  lines.push('- Decision context by reason:');
  if (walletContextByReason.length) {
    walletContextByReason.forEach(([reason, item]) => {
      lines.push(`  - ${reason}: decisions=${item.decisions ?? 'n/a'}, unique=${item.uniqueMints ?? 'n/a'}, any=${item.withAnyWalletTouch ?? 'n/a'}, positive=${item.withPositiveOrProvenTouch ?? 'n/a'}, avoid=${item.withAvoidTouch ?? 'n/a'}`);
    });
  } else {
    lines.push('  - none');
  }
  lines.push('- Runtime wallet promotion tiers:');
  objectLines(walletContextRuntimeEvents.promotionCoverage?.reviewTierCounts, 5).forEach((line) => lines.push(`  - ${line}`));
  lines.push('');

  const walletFollowSummary = walletContextFollowThrough.summary || {};
  const walletFollowAll = walletFollowSummary.all || {};
  const walletFollowAll120 = walletFollowAll.windowSummary?.['120s'] || {};
  const walletFollowLowScoreFirstSight = walletContextFollowThrough.lowScoreFirstSightSummary || {};
  const walletFollowLowScoreFirstSight120 = walletFollowLowScoreFirstSight.windowSummary?.['120s'] || {};
  const walletFollowReasons = Object.entries(walletFollowSummary.byReason || {})
    .sort((a, b) => Number(b[1]?.decisions || 0) - Number(a[1]?.decisions || 0))
    .slice(0, 6);
  const walletFollowTop = topArray(walletFollowSummary.topFollowThrough, 8);

  lines.push('9c6. Wallet Context Follow-through');
  lines.push('-----------------------------------');
  lines.push('- Mode: report-only; follows paper decisions with wallet context by skip/decision reason. Does not alter runtime gates or live broadcast.');
  lines.push(`- Wallet-context decisions / unique mints / positive-or-proven / avoid: ${walletFollowAll.decisions ?? 'n/a'} / ${walletFollowAll.uniqueMints ?? 'n/a'} / ${walletFollowAll.withPositiveOrProvenTouch ?? 'n/a'} / ${walletFollowAll.withAvoidTouch ?? 'n/a'}`);
  lines.push(`- All wallet-context crossed 85/90 within 120s: ${walletFollowAll120.crossed85 ?? 'n/a'} / ${walletFollowAll120.crossed90 ?? 'n/a'}; uniqueCross85/90=${walletFollowAll120.uniqueCrossed85 ?? 'n/a'} / ${walletFollowAll120.uniqueCrossed90 ?? 'n/a'}`);
  lines.push(`- 120s marker rows / unique mints / unique events: dryRunWouldSend=${walletFollowAll120.dryRunWouldSend ?? 'n/a'} / ${walletFollowAll120.uniqueDryRunWouldSendMints ?? 'n/a'} / ${walletFollowAll120.uniqueDryRunWouldSendEvents ?? 'n/a'}; paperEntry=${walletFollowAll120.paperEntry ?? 'n/a'} / ${walletFollowAll120.uniquePaperEntryMints ?? 'n/a'} / ${walletFollowAll120.uniquePaperEntryEvents ?? 'n/a'}`);
  lines.push(`- LOW_SCORE/FIRST_SIGHT wallet-context decisions / unique / crossed90_120 / dryRun rows/mints/events_120: ${walletFollowLowScoreFirstSight.decisions ?? 'n/a'} / ${walletFollowLowScoreFirstSight.uniqueMints ?? 'n/a'} / ${walletFollowLowScoreFirstSight120.uniqueCrossed90 ?? 'n/a'} / ${walletFollowLowScoreFirstSight120.dryRunWouldSend ?? 'n/a'} / ${walletFollowLowScoreFirstSight120.uniqueDryRunWouldSendMints ?? 'n/a'} / ${walletFollowLowScoreFirstSight120.uniqueDryRunWouldSendEvents ?? 'n/a'}`);
  lines.push('- Wallet-context follow-through by reason:');
  if (walletFollowReasons.length) {
    walletFollowReasons.forEach(([reason, item]) => {
      const win120 = item.windowSummary?.['120s'] || {};
      lines.push(`  - ${reason}: decisions=${item.decisions ?? 'n/a'}, unique=${item.uniqueMints ?? 'n/a'}, positive=${item.withPositiveOrProvenTouch ?? 'n/a'}, avoid=${item.withAvoidTouch ?? 'n/a'}, cross85/90_120=${win120.uniqueCrossed85 ?? 'n/a'} / ${win120.uniqueCrossed90 ?? 'n/a'}, dryRun rows/mints/events=${win120.dryRunWouldSend ?? 'n/a'} / ${win120.uniqueDryRunWouldSendMints ?? 'n/a'} / ${win120.uniqueDryRunWouldSendEvents ?? 'n/a'}, entry rows/mints/events=${win120.paperEntry ?? 'n/a'} / ${win120.uniquePaperEntryMints ?? 'n/a'} / ${win120.uniquePaperEntryEvents ?? 'n/a'}, delta120 med/max=${fmt(win120.curveDelta?.median, 4)} / ${fmt(win120.curveDelta?.max, 4)}`);
    });
  } else {
    lines.push('  - none');
  }
  if (walletFollowTop.length) {
    lines.push('- Top wallet-context follow-through:');
    walletFollowTop.forEach((item, index) => {
      const firstTouch = item.firstTouch
        ? `${item.firstTouch.name || item.firstTouch.wallet || 'wallet'}:${item.firstTouch.reviewTier || item.firstTouch.evidenceTier || 'tier?'}/${item.firstTouch.side || 'side?'}`
        : 'none';
      lines.push(`  ${index + 1}. ${item.symbol || 'UNKNOWN'} ${item.mint || ''} | reason=${item.reason || 'n/a'} | curve=${fmt(item.curveProgress, 4)} | max120=${fmt(item.max120, 4)} | delta120=${fmt(item.delta120, 4)} | cross90_120=${item.crossed90Within120s === true} | dryRun120=${item.dryRunWouldSendWithin120s === true} | entry120=${item.paperEntryWithin120s === true} | firstTouch=${firstTouch}`);
    });
  } else {
    lines.push('- Top wallet-context follow-through: none');
  }
  lines.push('');

  const rickSummary = rickSightingFollowThrough.summary || {};
  const rickTop = topArray(rickSightingFollowThrough.topCollisionCleanFollowThrough, 8);
  const rickByReportType = Object.entries(rickSightingFollowThrough.byReportType || {})
    .sort((a, b) => Number(b[1]?.collisionCleanSightings || 0) - Number(a[1]?.collisionCleanSightings || 0))
    .slice(0, 5);

  lines.push('9c7. Rick Sighting Follow-through');
  lines.push('----------------------------------');
  lines.push('- Mode: report-only; joins Rick token mentions to Spectre telemetry/dossiers/actions with match-tier collision controls. Does not alter runtime gates.');
  lines.push(`- Rick generated / sightings / matched / collision-clean: ${rickSightingFollowThrough.sources?.rickGeneratedAt || 'n/a'} / ${rickSummary.sightings ?? 'n/a'} / ${rickSummary.matchedSightings ?? 'n/a'} / ${rickSummary.collisionCleanSightings ?? 'n/a'}`);
  lines.push(`- Collision-clean cross90 within 300m: ${rickSummary.collisionCleanCross90Within300m ?? 'n/a'} / ${rickSummary.collisionCleanSightings ?? 'n/a'} (${rickSummary.collisionCleanCross90Within300mRate === null || rickSummary.collisionCleanCross90Within300mRate === undefined ? 'n/a' : pct(rickSummary.collisionCleanCross90Within300mRate, 1)})`);
  lines.push(`- Collision-clean paper entry/skipped after sighting: ${rickSummary.collisionCleanPaperEntryAfterSighting ?? 'n/a'} / ${rickSummary.collisionCleanPaperSkippedAfterSighting ?? 'n/a'}; median lead=${fmt(rickSummary.medianLeadTimeMinutes, 2)}m`);
  lines.push('- Match tiers:');
  objectLines(rickSummary.matchTierCounts, 7).forEach((line) => lines.push(`  - ${line}`));
  if (rickByReportType.length) {
    lines.push('- By Rick report type:');
    rickByReportType.forEach(([reportType, item]) => {
      lines.push(`  - ${reportType}: sightings=${item.sightings ?? 'n/a'}, clean=${item.collisionCleanSightings ?? 'n/a'}, cleanCross90_300m=${item.collisionCleanCross90Within300m ?? 'n/a'}, rate=${item.collisionCleanCross90Within300mRate === null || item.collisionCleanCross90Within300mRate === undefined ? 'n/a' : pct(item.collisionCleanCross90Within300mRate, 1)}`);
    });
  }
  if (rickTop.length) {
    lines.push('- Top collision-clean Rick follow-through:');
    rickTop.forEach((item, index) => {
      const id = item.identification || {};
      const d = item.derivedFlags || {};
      lines.push(`  ${index + 1}. ${id.symbol || id.symbolKey || 'UNKNOWN'} | report=${id.reportType || 'n/a'} | tier=${item.matchTier || 'n/a'} | mints=${item.matchedMintCount ?? 'n/a'} | class=${d.classification || 'n/a'} | max300=${fmt(d.maxCurveProgress300m, 4)} | price300=${fmt(d.maxPriceDeltaPct300m, 2)}% | cross90=${d.crossed90Within300m === true}`);
    });
  } else {
    lines.push('- Top collision-clean Rick follow-through: none');
  }
  lines.push('');

  const highConvictionWatchSummary = highConvictionWatchFollowThrough.summary || {};
  const highConvictionWatchTop = topArray(highConvictionWatchFollowThrough.topFollowThrough, 8);
  const highConvictionWatchCross90 = topArray(highConvictionWatchFollowThrough.crossed90Within120s, 8);
  const highConvictionWatchDrilldown = topArray(highConvictionWatchFollowThrough.drilldown, 8);

  lines.push('9d. High-Conviction Watch Follow-through');
  lines.push('-----------------------------------------');
  lines.push('- Mode: report-only; joins confirmed/high-conviction watch rows to later PumpDev curve/price snapshots.');
  lines.push(`- Raw watch rows / unique mints: ${highConvictionWatchSummary.rawWatchRows ?? 'n/a'} / ${highConvictionWatchSummary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Crossed 85/90 within 120s: ${highConvictionWatchSummary.crossed85Within120s ?? 'n/a'} / ${highConvictionWatchSummary.crossed90Within120s ?? 'n/a'}`);
  lines.push(`- Crossed 85/90 within 300s: ${highConvictionWatchSummary.crossed85Within300s ?? 'n/a'} / ${highConvictionWatchSummary.crossed90Within300s ?? 'n/a'}`);
  lines.push(`- Curve delta 120s median/p90/max: ${fmt(highConvictionWatchSummary.curveDelta120s?.median, 4)} / ${fmt(highConvictionWatchSummary.curveDelta120s?.p90, 4)} / ${fmt(highConvictionWatchSummary.curveDelta120s?.max, 4)}`);
  lines.push(`- Price delta 120s median/p90/max: ${fmt(highConvictionWatchSummary.maxPriceDeltaPct120s?.median, 2)}% / ${fmt(highConvictionWatchSummary.maxPriceDeltaPct120s?.p90, 2)}% / ${fmt(highConvictionWatchSummary.maxPriceDeltaPct120s?.max, 2)}%`);
  lines.push('- Selection classes:');
  objectLines(highConvictionWatchSummary.selectionClassCounts, 4).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Verdict counts:');
  objectLines(highConvictionWatchSummary.verdictCounts, 4).forEach((line) => lines.push(`  - ${line}`));
  if (highConvictionWatchDrilldown.length) {
    lines.push('- Drilldown by selection/score/curve band:');
    highConvictionWatchDrilldown.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeHighConvictionWatchDrilldown(item)}`));
  } else {
    lines.push('- Drilldown by selection/score/curve band: none');
  }
  if (highConvictionWatchCross90.length) {
    lines.push('- Crossed 90 within 120s:');
    highConvictionWatchCross90.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeHighConvictionWatchFollowThrough(item)}`));
  } else {
    lines.push('- Crossed 90 within 120s: none');
  }
  if (highConvictionWatchTop.length) {
    lines.push('- Top high-conviction watch follow-through:');
    highConvictionWatchTop.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeHighConvictionWatchFollowThrough(item)}`));
  } else {
    lines.push('- Top high-conviction watch follow-through: none');
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
