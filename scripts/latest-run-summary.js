const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'data', 'reports', 'latest-run-summary.txt');

const FILES = {
  battlefield: 'data/reports/run-battlefield-latest.json',
  paidTapeCoverageEpoch: 'data/reports/paid-tape-coverage-epoch-latest.json',
  telemetryPathAudit: 'data/reports/report-telemetry-path-audit-latest.json',
  simpleRuntimeAiEvidence: 'data/reports/simple-runtime-ai-evidence-latest.json',
  liveReadiness: 'data/reports/live-readiness-latest.json',
  pumpDevCurveParity: 'data/reports/pumpdev-curve-parity-latest.json',
  pumpDevTargetedCurveParity: 'data/reports/pumpdev-targeted-curve-parity-latest.json',
  eventLoopLagDiagnostic: 'data/reports/event-loop-lag-diagnostic-latest.json',
  pumpDevSubscriptionLifecycle: 'data/reports/pumpdev-subscription-lifecycle-latest.json',
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
  preMigrationEntryFunnel: 'data/reports/pre-migration-entry-funnel-latest.json',
  preMigrationObservedCoverage: 'data/reports/pre-migration-observed-coverage-latest.json',
  preMigrationFlaggedCandidateAttribution: 'data/reports/pre-migration-flagged-candidate-attribution-latest.json',
  preMigrationFlaggedAttributionTrend: 'data/reports/pre-migration-flagged-attribution-trend-latest.json',
  preMigrationFlaggedFollowThroughSlices: 'data/reports/pre-migration-flagged-follow-through-slices-latest.json',
  preMigrationFlaggedFollowThroughSliceShadow: 'data/reports/pre-migration-flagged-follow-through-slice-shadow-latest.json',
  preMigrationFlaggedFollowThroughSliceShadowReplay: 'data/reports/pre-migration-flagged-follow-through-slice-shadow-replay-latest.json',
  preMigrationCandidateSupplyFunnel: 'data/reports/pre-migration-candidate-supply-funnel-latest.json',
  preMigrationCurve60SupplyDecomposition: 'data/reports/pre-migration-curve60-supply-decomposition-latest.json',
  preMigrationWatchVsCrosserSupply: 'data/reports/pre-migration-watch-vs-crosser-supply-latest.json',
  preMigrationRunnerNoEntryAutopsy: 'data/reports/pre-migration-runner-no-entry-autopsy-latest.json',
  preMigrationAdvancingHighCurveLaneGap: 'data/reports/pre-migration-advancing-high-curve-lane-gap-latest.json',
  preMigrationPre60SnapshotCoverage: 'data/reports/pre-migration-pre60-snapshot-coverage-latest.json',
  preMigrationPreCurve60RunnerDiscovery: 'data/reports/pre-migration-pre-curve60-runner-discovery-latest.json',
  preMigrationEarlySignalBaseRate: 'data/reports/pre-migration-early-signal-base-rate-latest.json',
  preMigrationEarlySignalFirstHitReplay: 'data/reports/pre-migration-early-signal-first-hit-replay-latest.json',
  preMigrationEarlySignalEntryTimingReplay: 'data/reports/pre-migration-early-signal-entry-timing-replay-latest.json',
  preMigrationOriginPathAutopsy: 'data/reports/pre-migration-origin-path-autopsy-latest.json',
  preMigrationEntryGateMargin: 'data/reports/pre-migration-entry-gate-margin-latest.json',
  preMigrationHighReadinessRejectReplay: 'data/reports/pre-migration-high-readiness-reject-replay-latest.json',
  preMigrationSingleGateShadow: 'data/reports/pre-migration-single-gate-shadow-latest.json',
  preMigrationCurveAdvanceDiagnostic: 'data/reports/pre-migration-curve-advance-diagnostic-latest.json',
  preMigrationCurveNotAdvancingSeparability: 'data/reports/pre-migration-curve-not-advancing-separability-latest.json',
  preMigrationCurveNotAdvancingSeparatorShadow: 'data/reports/pre-migration-curve-not-advancing-separator-shadow-latest.json',
  preMigrationCurveNotAdvancingSeparatorShadowLedger: 'data/reports/pre-migration-curve-not-advancing-separator-shadow-ledger-latest.json',
  preMigrationGuardAttribution: 'data/reports/pre-migration-guard-attribution-latest.json',
  preMigrationSkipFollowThrough: 'data/reports/pre-migration-skip-follow-through-latest.json',
  preMigrationGatedCrosserFollowThrough: 'data/reports/pre-migration-gated-crosser-follow-through-latest.json',
  preMigrationCrosserPrecursorDiscovery: 'data/reports/pre-migration-crosser-precursor-discovery-latest.json',
  preMigrationSkipNear90Watchlist: 'data/reports/pre-migration-skip-near-90-watchlist-latest.json',
  preMigrationHighConvictionWatchFollowThrough: 'data/reports/pre-migration-high-conviction-watch-follow-through-latest.json',
  preMigrationDryRunOutcome: 'data/reports/pre-migration-dry-run-outcome-latest.json',
  preMigrationDryRunEntryReplay: 'data/reports/pre-migration-dry-run-entry-replay-latest.json',
  preMigrationCurveConfirmationReplay: 'data/reports/pre-migration-curve-confirmation-replay-latest.json',
  preMigrationCurveConfirmationShadow: 'data/reports/pre-migration-curve-confirmation-shadow-latest.json',
  preMigrationRelaxedGateReplay: 'data/reports/pre-migration-relaxed-gate-replay-latest.json',
  preMigrationCurveStallRelaxedReplay: 'data/reports/pre-migration-curve-stall-relaxed-replay-latest.json',
  preMigrationCurveFalseNegativeReplay: 'data/reports/pre-migration-curve-false-negative-replay-latest.json',
  preMigrationCurveFalseNegativeShadow: 'data/reports/pre-migration-curve-false-negative-shadow-latest.json',
  preMigrationCurveFalseNegativeShadowReplay: 'data/reports/pre-migration-curve-false-negative-shadow-replay-latest.json',
  preMigrationCurveFalseNegativeRecoveryShadow: 'data/reports/pre-migration-curve-false-negative-recovery-shadow-latest.json',
  preMigrationFreshCurveOverrideShadow: 'data/reports/pre-migration-fresh-curve-override-shadow-latest.json',
  preMigrationWalletConditionedRelaxedGateReplay: 'data/reports/pre-migration-wallet-conditioned-relaxed-gate-replay-latest.json',
  preMigrationWalletRelaxedShadowOutcome: 'data/reports/pre-migration-wallet-relaxed-shadow-outcome-latest.json',
  preMigrationWalletContextCoverage: 'data/reports/pre-migration-wallet-context-coverage-latest.json',
  preMigrationWalletContextFollowThrough: 'data/reports/pre-migration-wallet-context-follow-through-latest.json',
  preMigrationWalletChannelHealth: 'data/reports/pre-migration-wallet-channel-health-latest.json',
  preMigrationEntryCandidateReview: 'data/reports/pre-migration-entry-candidate-review-latest.json',
  preMigrationWalletSupportedNearMissReplay: 'data/reports/pre-migration-wallet-supported-near-miss-replay-latest.json',
  preMigrationSameMintReentryImpact: 'data/reports/pre-migration-same-mint-reentry-impact-latest.json',
  preMigrationBreakevenStopGap: 'data/reports/pre-migration-breakeven-stop-gap-latest.json',
  preMigrationExitProtectionReplay: 'data/reports/pre-migration-exit-protection-replay-latest.json',
  preMigrationMfeMaeCapture: 'data/reports/pre-migration-mfe-mae-capture-latest.json',
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
  strategyCandidateScorecard: 'data/reports/strategy-candidate-scorecard-latest.json',
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
  walletUntrackedReview: 'data/reports/wallet-untracked-review-latest.json',
  walletLaunchIntelBridge: 'data/reports/wallet-launch-intel-bridge-latest.json',
  walletLaunchIntelStability: 'data/reports/wallet-launch-intel-stability-latest.json',
  walletLaunchIntelShortlistEntryReplay: 'data/reports/wallet-launch-intel-shortlist-entry-replay-latest.json',
  walletLaunchIntelShortlistShadow: 'data/reports/wallet-launch-intel-shortlist-shadow-latest.json',
  walletUntrackedShadowImpact: 'data/reports/wallet-untracked-shadow-impact-latest.json',
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

function summarizeCurveAdvanceDiagnostic(item = {}) {
  const label = candidateLabel(item);
  const w120 = item.window120s || {};
  const w300 = item.window300s || {};
  const wallet = item.walletContext?.bucket || 'wallet?n/a';
  const parity = item.nearestTargetedParity
    ? ` | parityDelta=${fmt(item.nearestTargetedParity.absCurveDelta, 4)}`
    : '';
  return `${label} | verdict=${item.curveEvidenceVerdict || 'n/a'} | class=${item.classification || 'n/a'} | wallet=${wallet} | ready=${fmt(item.readinessPct, 2)}% | delta=${fmt(item.curveProgressDelta, 4)}/${fmt(item.threshold, 4)} gap=${fmt(item.deltaGap, 4)} | curve=${fmt(item.curveProgress, 4)} | max120=${fmt(w120.maxCurveProgress, 4)} d120=${fmt(w120.curveDelta, 4)} | max300=${fmt(w300.maxCurveProgress, 4)} | price120=${w120.maxPriceDeltaPct === null || w120.maxPriceDeltaPct === undefined ? 'n/a' : `${fmt(w120.maxPriceDeltaPct, 2)}%`}${parity}`;
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
  const score = item.score ?? item.skipScore ?? item.entryScore ?? null;
  const reason = item.reasonAtEntry || item.reasonAtSkip || item.reason || 'n/a';
  return `${label} | ${item.exitReason || 'n/a'} | pnl=${sol(item.pnlSol, 6)} | net=${fmt(item.netReturnPct, 2)}% | hold=${fmt(item.holdSeconds, 2)}s | curve=${fmt(item.entryCurveProgress, 4)}->${fmt(item.exitCurveProgress, 4)} | score=${fmt(score, 2)} | reason=${reason}`;
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

function summarizeRunnerRejectReplayStress(name, item = {}) {
  const winRatePct = item.winRate === null || item.winRate === undefined ? 'n/a' : `${fmt(Number(item.winRate) * 100, 1)}%`;
  return `${name}: trades=${item.trades ?? 'n/a'} wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'} winRate=${winRatePct} pnl=${sol(item.totalPnlSol, 9)} fillHaircut=${sol(item.pnlAfterFillFailureHaircutSol, 9)} missedWinners=${item.missedWinnerCount ?? 'n/a'} (${sol(item.missedWinnerPnlSol, 9)}) exTop1=${sol(item.pnlAfterRemovingTopWinnerSol, 9)} medianReturn=${fmt(item.returnPct?.median, 2)}% exits=${JSON.stringify(item.exitReasons || {})}`;
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
    forEachJsonlSync(resolvedPath, (event) => {
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
    });
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
    forEachJsonlSync(resolvedPath, (event) => {
        const candidate = get(event, [
          'payload.stats',
          'data.stats'
        ], null);
        if (candidate) stats = candidate;
    });
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
  const meteredTradeEvents = number(stats.meteredTradeEvents, trades);
  const unmatchedAccountTrades = number(stats.unmatchedAccountTrades, 0);
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
  const accountTradeUnsubscribeFrames = number(stats.accountTradeUnsubscribeFrames, 0);
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
  const tradeSubscriptionsSkippedBudget = number(stats.tradeSubscriptionsSkippedBudget, 0);
  const accountSubscriptionsSkippedBudget = number(stats.accountSubscriptionsSkippedBudget, 0);
  const maxMeteredTradeEventsPerSession = Object.prototype.hasOwnProperty.call(stats, 'maxMeteredTradeEventsPerSession')
    ? number(stats.maxMeteredTradeEventsPerSession, 0)
    : null;
  const meteredTradeBudgetReached = stats.meteredTradeBudgetReached === true;
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
    meteredTradeEvents,
    unmatchedAccountTrades,
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
    accountTradeUnsubscribeFrames,
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
    tradeSubscriptionsSkippedBudget,
    accountSubscriptionsSkippedBudget,
    maxMeteredTradeEventsPerSession,
    meteredTradeBudgetReached,
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
      forEachJsonlSync(telemetryPath, (event) => {
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
      });
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
    tokenTradeReconnectResubscribeScheduled: number(stats.tokenTradeReconnectResubscribeScheduled, 0),
    tokenTradeReconnectResubscribeSent: number(stats.tokenTradeReconnectResubscribeSent, 0),
    tokenTradeReconnectResubscribeDropped: number(stats.tokenTradeReconnectResubscribeDropped, 0),
    tokenTradeSubscribesSuppressedDuringCooldown: number(stats.tokenTradeSubscribesSuppressedDuringCooldown, 0),
    tokenTradeDeferredSubscribeSent: number(stats.tokenTradeDeferredSubscribeSent, 0),
    tokenTradeDeferredSubscribeDropped: number(stats.tokenTradeDeferredSubscribeDropped, 0),
    reconnectResubscribeMaxMints: number(stats.reconnectResubscribeMaxMints, 0),
    reconnectResubscribeBatchSize: number(stats.reconnectResubscribeBatchSize, 0),
    reconnectResubscribeBatchDelayMs: number(stats.reconnectResubscribeBatchDelayMs, 0),
    rateLimitCloseEvents: number(stats.rateLimitCloseEvents, 0),
    rateLimitCooldownMs: number(stats.rateLimitCooldownMs, 0),
    rateLimitCooldownUntilMs: number(stats.rateLimitCooldownUntilMs, 0),
    reconnectDelayStableResets: number(stats.reconnectDelayStableResets, 0),
    reconnectDelayResetAfterStableMs: number(stats.reconnectDelayResetAfterStableMs, 0),
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
    forEachJsonlSync(resolvedPath, (event) => {
      if (!String(event.type || '').startsWith('solana_rpc.call_')) {
        return;
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
    });
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
    forEachJsonlSync(resolvedPath, (event) => {
      const type = String(event.type || '');
      if (type === 'session.stopping' || type === 'session.stopped') {
        const stopStats = event.payload?.stats?.finalistAccountVerifier || null;
        if (stopStats) summary.stopStats = stopStats;
      }
      if (!type.startsWith('finalist_account_verifier.')) return;
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
    });
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
    forEachJsonlSync(resolvedPath, (event) => {
      const type = String(event.type || '');
      if (!type.startsWith('live_dry_run.')) return;
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
    });
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
    forEachJsonlSync(resolvedPath, (event) => {
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
    });
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

function summarizeStrategyCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== 'object' || !Object.keys(candidate).length) return 'none';
  const blockers = Array.isArray(candidate.promotionBlockers)
    ? candidate.promotionBlockers.slice(0, 3).join('; ')
    : 'none';
  const nextNeed = Array.isArray(candidate.nextDataNeed) && candidate.nextDataNeed.length
    ? ` | next=${candidate.nextDataNeed[0]}`
    : '';
  return `${candidate.name || 'unknown'} (${candidate.lane || 'n/a'}) | status=${candidate.status || 'n/a'} | score=${fmt(candidate.score, 0)} | trades=${candidate.trades ?? 'n/a'} | PnL=${sol(candidate.pnlSol, 6)} | blockers=${blockers || 'none'}${nextNeed}`;
}

function summarizeEntryCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== 'object' || !Object.keys(candidate).length) return 'none';
  const flags = Array.isArray(candidate.flags) && candidate.flags.length ? candidate.flags.slice(0, 4).join(',') : 'none';
  const future120 = candidate.windows?.['120s'] || {};
  const exitText = candidate.exit
    ? ` exit=${candidate.exit.reason || 'n/a'} ${sol(candidate.exit.pnlSol, 6)}`
    : '';
  const touch = candidate.qualifyingFirstTouch
    ? ` touch=${candidate.qualifyingFirstTouch.name || 'wallet'}:${candidate.qualifyingFirstTouch.reviewTier || candidate.qualifyingFirstTouch.evidenceTier || 'tier?'}`
    : '';
  return `${candidate.kind || 'candidate'} ${candidate.symbol || 'UNKNOWN'} ${candidate.mint || ''} | verdict=${candidate.verdict || 'n/a'} | score=${fmt(candidate.score, 2)} | curve=${fmt(candidate.curveProgress, 4)} | max120=${fmt(future120.maxCurveProgress, 4)} | price120=${fmt(future120.maxPriceDeltaPct, 2)}%${exitText}${touch} | flags=${flags}`;
}

function summarizeWalletSupportedNearMissReplay(row = {}) {
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return 'none';
  const label = `${row.symbol || 'UNKNOWN'} ${row.mint || ''}`.trim();
  return `${label} | profile=${row.profile || 'n/a'} | wallet=${row.walletName || row.wallet || 'n/a'} | wait=${fmt(row.waitSeconds, 1)}s | hold=${fmt(row.holdSeconds, 1)}s | curve=${fmt(row.candidateCurve, 4)}->${fmt(row.confirmCurve, 4)} | exit=${row.exitReason || 'n/a'} | pnl=${sol(row.pnlSol, 6)} | return=${pct(Number(row.returnPct) / 100, 1)}`;
}

function summarizeEntryFunnelRow(row = {}) {
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return 'none';
  const reason = Object.keys(row.topSkipReasons || {})[0]
    || Object.keys(row.topGuardReasons || {})[0]
    || row.bestReadinessReason
    || 'n/a';
  return `${row.symbol || 'UNKNOWN'} ${row.mint || ''} | stage=${row.terminalStage || 'n/a'} | score=${fmt(row.maxScore, 2)} | curve=${fmt(row.maxCurveProgress, 4)} | vol=${fmt(row.maxRecentVolumeSol, 2)} | vel=${fmt(row.maxTradeVelocityPerMin, 2)} | readiness=${fmt(row.bestReadinessPct, 2)}% | reason=${reason}`;
}

function summarizeSameMintReentry(row = {}) {
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return 'none';
  const previous = row.previousExit
    ? `prev=${row.previousExit.reason || 'exit'} ${sol(row.previousExit.pnlSol, 6)}`
    : 'prev=n/a';
  const exit = row.exit
    ? `exit=${row.exit.reason || 'n/a'} ${sol(row.exit.pnlSol, 6)}`
    : 'exit=n/a';
  return `${row.symbol || 'UNKNOWN'} ${row.mint || ''} | gap=${fmt(row.gapSeconds, 1)}s | profile=${row.profileName || 'n/a'} | ${previous} | ${exit}`;
}

function summarizeBreakevenStopGap(row = {}) {
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return 'none';
  const flags = Array.isArray(row.gapFlags) && row.gapFlags.length ? row.gapFlags.slice(0, 3).join(',') : 'none';
  const obs = row.observation || {};
  return `${row.symbol || 'UNKNOWN'} ${row.mint || ''} | profile=${row.profileName || 'n/a'} | PnL=${sol(row.pnlSol, 6)} | return=${pct(row.returnPct, 2)} | peak=${pct(row.peakReturnPct, 2)} | giveback=${pct(row.givebackPct, 2)} | hold=${fmt(row.holdSeconds, 1)}s | priceObs=${obs.priceSnapshotCount ?? 'n/a'} | gap=${ms(obs.exitObservationGapMs)} | flags=${flags}`;
}

function summarizeExitProtectionScenario(row = {}) {
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return 'none';
  return `${row.name || 'unknown'}: entries=${row.entries ?? 'n/a'}, PnL=${sol(row.totalPnlSol, 6)}, delta=${sol(row.pnlDeltaVsCurrentSol, 6)}, wins/losses=${row.wins ?? 'n/a'}/${row.losses ?? 'n/a'}, exits=${formatTopCounts(row.exitReasonCounts)}`;
}

function summarizeExitProtectionExample(row = {}) {
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return 'none';
  const current = row.current
    ? `current=${row.current.reason || 'n/a'} ${sol(row.current.pnlSol, 6)}`
    : 'current=n/a';
  return `${row.symbol || 'UNKNOWN'} ${row.mint || ''} | replay=${row.reason || 'n/a'} ${sol(row.pnlSol, 6)} | delta=${sol(row.pnlDeltaVsCurrentSol, 6)} | ${current} | hold=${fmt(row.holdSeconds, 1)}s`;
}

function summarizeMfeMaeCapture(row = {}) {
  if (!row || typeof row !== 'object' || !Object.keys(row).length) return 'none';
  return `${row.symbol || 'UNKNOWN'} ${row.mint || ''} | class=${row.captureClass || 'n/a'} | exit=${row.exitReason || 'n/a'} ${sol(row.pnlSol, 6)} | MFE=${pct(row.mfePct, 2)} | MAE=${pct(row.maePct, 2)} | realized=${pct(row.realizedReturnPct, 2)} | capture=${pct(row.captureRatio, 1)} | peakAt=${fmt(row.secondsToPeak, 1)}s`;
}

function buildLaunchDecisionLines({
  battlefield,
  liveReadiness,
  paperEntries,
  paperPnl,
  aiReachability,
  preMigrationGuardAttribution,
  preMigrationEntryGateMargin,
  preMigrationDryRunEntryReplay,
  preMigrationRelaxedGateReplay,
  preMigrationHighReadinessRejectReplay,
  preMigrationCurveStallRelaxedReplay,
  preMigrationCurveAdvanceDiagnostic,
  preMigrationCurveNotAdvancingSeparability,
  preMigrationCurveNotAdvancingSeparatorShadow,
  preMigrationCurveConfirmationReplay,
  preMigrationCurveConfirmationShadow,
  preMigrationEntryFunnel,
  preMigrationWalletChannelHealth,
  runnerRejectEntryReplay,
  strategyCandidateScorecard
}) {
  const lines = [];
  const readinessVerdict = liveReadiness.verdict || 'unknown';
  const infraBlockers = Array.isArray(liveReadiness.blockers) ? liveReadiness.blockers : [];
  const launchBlocks = Array.isArray(liveReadiness.launchBlocks) ? liveReadiness.launchBlocks : [];
  const dryBest = bestProfileFromSummary(preMigrationDryRunEntryReplay.firstPerMint?.summaryByProfile);
  const relaxedBest = topArray(preMigrationRelaxedGateReplay.ranking, 1)[0] || null;
  const curveStallBest = topArray(preMigrationCurveStallRelaxedReplay.ranking, 1)[0] || null;
  const curveAdvanceLikelyBest = bestProfileFromSummary(preMigrationCurveAdvanceDiagnostic.replay?.likelyFalseNegativeUniqueByProfile);
  const separatorSummary = preMigrationCurveNotAdvancingSeparatorShadow.summary || {};
  const separatorBest = separatorSummary.bestRun || null;
  const separabilitySummary = preMigrationCurveNotAdvancingSeparability.summary || {};
  const walletChannelSummary = preMigrationWalletChannelHealth.summary || {};
  const curveConfirmationBest = topArray(preMigrationCurveConfirmationReplay.ranking, 1)[0] || null;
  const runnerRejectBest = bestProfileFromSummary(runnerRejectEntryReplay.summaryByProfile);
  const scorecardSummary = strategyCandidateScorecard.summary || {};
  const scorecardBest = topArray(strategyCandidateScorecard.bestCandidates, 1)[0] || null;
  const curveConfirmationShadowSummary = preMigrationCurveConfirmationShadow.summary || {};
  const curveConfirmationShadowAll = curveConfirmationShadowSummary.all || {};
  const guardSummary = preMigrationGuardAttribution.summary || {};
  const funnelSummary = preMigrationEntryFunnel.summary || {};
  const paperDecisionCounts = battlefield?.preMigrationPaper?.decisionCounts || {};
  const paperSkipReasons = battlefield?.preMigrationPaper?.skipReasons || {};
  const paperSkipped = paperDecisionCounts.PAPER_SKIPPED ?? paperDecisionCounts.paper_skipped ?? null;
  const paperEntered = battlefield?.preMigrationPaper?.entries ?? paperEntries;
  const paperBottleneckLine = Object.keys(funnelSummary).length
    ? `observed/flagged/evaluated/wouldEnter/entered=${funnelSummary.observedMints ?? 'n/a'}/${funnelSummary.flaggedMints ?? 'n/a'}/${funnelSummary.evaluatedMints ?? 'n/a'}/${funnelSummary.wouldEnterMints ?? 'n/a'}/${funnelSummary.enteredMints ?? 'n/a'}; top skip reasons=${formatTopCounts(funnelSummary.topSkipReasons)}`
    : Object.keys(paperDecisionCounts).length || Object.keys(paperSkipReasons).length
    ? `paperEntries/skipped=${paperEntered ?? 'n/a'}/${paperSkipped ?? 'n/a'}; top skip reasons=${formatTopCounts(paperSkipReasons)}`
    : `wouldEnter/wouldSkip=${guardSummary.wouldEnter ?? 'n/a'}/${guardSummary.wouldSkip ?? 'n/a'}; top reasons=${formatTopCounts(guardSummary.byReason)}`;
  const marginSummary = preMigrationEntryGateMargin.summary || {};
  const highReadinessRejectSummary = preMigrationHighReadinessRejectReplay.summary || {};
  const highReadinessRejectBest = topArray(preMigrationHighReadinessRejectReplay.rankings, 1)[0] || null;
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
  lines.push(`- Current entry gate bottleneck: ${paperBottleneckLine}.`);
  if (scorecardSummary.candidateCount !== undefined) {
    lines.push(`- Strategy scorecard: candidates=${scorecardSummary.candidateCount}, promotionEligible=${scorecardSummary.promotionEligibleCount ?? 'n/a'}, best=${summarizeStrategyCandidate(scorecardBest)}.`);
  }
  if (curveConfirmationShadowSummary.shadowRows !== undefined) {
    lines.push(`- Delayed-confirmation shadow: rows/wouldEnter/unique=${curveConfirmationShadowSummary.shadowRows ?? 'n/a'}/${curveConfirmationShadowSummary.wouldEnter ?? 'n/a'}/${curveConfirmationShadowSummary.uniqueWouldEnterMints ?? 'n/a'}; entryRate=${pct(curveConfirmationShadowSummary.entryRate, 1)}; delta median=${fmt(curveConfirmationShadowAll.confirmedDelta?.median, 4)}.`);
  }
  if (separatorBest) {
    lines.push(`- CURVE_NOT_ADVANCING separator shadow: ${separatorSummary.verdict || 'n/a'}; best=${separatorBest.rule || 'n/a'} / ${separatorBest.exitProfile || 'n/a'} | trades=${separatorBest.replayedTrades ?? 'n/a'} | pnl=${sol(separatorBest.totalPnlSol, 6)} | median=${sol(separatorBest.medianPnlSol, 6)} | exTop3=${sol(separatorBest.pnlAfterRemovingTop3WinnersSol, 6)}.`);
  } else if (separatorSummary.verdict) {
    lines.push(`- CURVE_NOT_ADVANCING separator shadow: ${separatorSummary.verdict}; no best run available.`);
  }
  if (separabilitySummary.verdict) {
    lines.push(`- CURVE_NOT_ADVANCING separability: ${separabilitySummary.verdict}; strong/useful/flat=${separabilitySummary.strongFollowThroughRows ?? 'n/a'}/${separabilitySummary.usefulFollowThroughRows ?? 'n/a'}/${separabilitySummary.correctlyBlockedFlatRows ?? 'n/a'}.`);
  }
  if (walletChannelSummary.channelVerdict) {
    lines.push(`- Wallet proof coverage: ${walletChannelSummary.channelVerdict}; decisions/prospectivePre85/rawUntrustedPre85=${walletChannelSummary.paperDecisionRows ?? 'n/a'}/${walletChannelSummary.noTrackedFirstTouchWithProspectivePre85Buy ?? 'n/a'}/${walletChannelSummary.noTrackedFirstTouchWithRawUntrustedPre85Buy ?? 'n/a'}.`);
  }
  lines.push(`- Rolling tightest gates: decisions=${marginSummary.decisions ?? 'n/a'}, readiness median/p90/max=${fmt(marginSummary.readinessPct?.median, 2)}%/${fmt(marginSummary.readinessPct?.p90, 2)}%/${fmt(marginSummary.readinessPct?.max, 2)}%; gates=${formatTopCounts(marginSummary.tightestGateCounts)}.`);
  if (nearMissSummary.decisions !== undefined) {
    lines.push(`- Near-miss follow-through: >=${preMigrationEntryGateMargin.nearMissFollowThrough?.minReadinessPct ?? 'n/a'}% readiness decisions=${nearMissSummary.decisions}, unique=${nearMissSummary.uniqueMints}, reached90 unique=${nearMissSummary.uniqueMintsReached90Within120s ?? 'n/a'}, crossed95 unique=${nearMissSummary.uniqueMintsCrossed95Within120s ?? 'n/a'}, delta120 median/p90=${fmt(nearMissSummary.curveDelta120s?.median, 4)}/${fmt(nearMissSummary.curveDelta120s?.p90, 4)}.`);
  }
  if (highReadinessRejectBest) {
    lines.push(`- High-readiness reject replay: best=${highReadinessRejectBest.name || 'n/a'} verdict=${highReadinessRejectBest.verdict || 'n/a'} trades=${highReadinessRejectBest.trades ?? 'n/a'} pnl=${sol(highReadinessRejectBest.totalPnlSol, 6)} median=${sol(highReadinessRejectBest.medianPnlSol, 6)} exTop3=${sol(highReadinessRejectBest.top3RemovedPnlSol, 6)}.`);
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
  lines.push(`  - CURVE_NOT_ADVANCING diagnostic replay best: ${formatReplayProfile(curveAdvanceLikelyBest)}`);
  lines.push(`  - curve-confirmation best: ${formatReplayProfile(curveConfirmationBest, 'confirmed')}`);
  lines.push(`  - runner-reject replay best: ${formatReplayProfile(runnerRejectBest)} (report-only; not a live-entry proof)`);
  lines.push(`- Tuning posture: ${separatorSummary.verdict === 'PROMISING_SEPARATOR_SHADOW_FOUND' ? 'promote the separator rule to a runtime shadow lane only; keep live and actual paper-entry gates unchanged until it repeats' : relaxedWarning || highReadinessRejectSummary.promisingProfiles?.length === 0 ? 'do not loosen runtime gates from this evidence; the broad relaxed lanes are negative and the positive slices are tiny/median-weak' : 'candidate for deeper review, not automatic live tuning'}.`);
  lines.push(`- Next engineering target: ${separatorSummary.verdict === 'PROMISING_SEPARATOR_SHADOW_FOUND' ? 'add a runtime shadow-only lane for the best CURVE_NOT_ADVANCING separator and collect fresh would-enter evidence on the next paper run' : 'improve candidate-generation/near-miss instrumentation so the next paper run can explain exactly which condition prevents real entries'}.`);
  lines.push('');
  return lines;
}

function buildSummary(docs) {
  const battlefield = docs.battlefield.data || {};
  const telemetryPathAudit = docs.telemetryPathAudit.data || {};
  const simpleRuntimeAiEvidence = docs.simpleRuntimeAiEvidence.data || {};
  const liveReadiness = docs.liveReadiness.data || {};
  const pumpDevCurveParity = docs.pumpDevCurveParity.data || {};
  const pumpDevTargetedCurveParity = docs.pumpDevTargetedCurveParity.data || {};
  const eventLoopLagDiagnostic = docs.eventLoopLagDiagnostic.data || {};
  const pumpDevSubscriptionLifecycle = docs.pumpDevSubscriptionLifecycle.data || {};
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
  const entryFunnel = docs.preMigrationEntryFunnel.data || {};
  const observedCoverage = docs.preMigrationObservedCoverage.data || {};
  const flaggedCandidateAttribution = docs.preMigrationFlaggedCandidateAttribution.data || {};
  const flaggedAttributionTrend = docs.preMigrationFlaggedAttributionTrend.data || {};
  const flaggedFollowThroughSlices = docs.preMigrationFlaggedFollowThroughSlices.data || {};
  const flaggedFollowThroughSliceShadow = docs.preMigrationFlaggedFollowThroughSliceShadow.data || {};
  const flaggedFollowThroughSliceShadowReplay = docs.preMigrationFlaggedFollowThroughSliceShadowReplay.data || {};
  const candidateSupplyFunnel = docs.preMigrationCandidateSupplyFunnel.data || {};
  const curve60SupplyDecomposition = docs.preMigrationCurve60SupplyDecomposition.data || {};
  const watchVsCrosserSupply = docs.preMigrationWatchVsCrosserSupply.data || {};
  const runnerNoEntryAutopsy = docs.preMigrationRunnerNoEntryAutopsy.data || {};
  const advancingHighCurveLaneGap = docs.preMigrationAdvancingHighCurveLaneGap.data || {};
  const pre60SnapshotCoverage = docs.preMigrationPre60SnapshotCoverage.data || {};
  const preCurve60RunnerDiscovery = docs.preMigrationPreCurve60RunnerDiscovery.data || {};
  const earlySignalBaseRate = docs.preMigrationEarlySignalBaseRate.data || {};
  const earlySignalFirstHitReplay = docs.preMigrationEarlySignalFirstHitReplay.data || {};
  const earlySignalEntryTimingReplay = docs.preMigrationEarlySignalEntryTimingReplay.data || {};
  const originPathAutopsy = docs.preMigrationOriginPathAutopsy.data || {};
  const curveAdvanceDiagnostic = docs.preMigrationCurveAdvanceDiagnostic.data || {};
  const curveNotAdvancingSeparability = docs.preMigrationCurveNotAdvancingSeparability.data || {};
  const curveNotAdvancingSeparatorShadow = docs.preMigrationCurveNotAdvancingSeparatorShadow.data || {};
  const curveNotAdvancingSeparatorShadowLedger = docs.preMigrationCurveNotAdvancingSeparatorShadowLedger.data || {};
  const skipFollowThrough = docs.preMigrationSkipFollowThrough.data || {};
  const gatedCrosserFollowThrough = docs.preMigrationGatedCrosserFollowThrough.data || {};
  const crosserPrecursorDiscovery = docs.preMigrationCrosserPrecursorDiscovery.data || {};
  const skipNear90Watchlist = docs.preMigrationSkipNear90Watchlist.data || {};
  const highConvictionWatchFollowThrough = docs.preMigrationHighConvictionWatchFollowThrough.data || {};
  const dryRunOutcome = docs.preMigrationDryRunOutcome.data || {};
  const relaxedGateReplay = docs.preMigrationRelaxedGateReplay.data || {};
  const curveStallRelaxedReplay = docs.preMigrationCurveStallRelaxedReplay.data || {};
  const curveConfirmationReplay = docs.preMigrationCurveConfirmationReplay.data || {};
  const curveConfirmationShadow = docs.preMigrationCurveConfirmationShadow.data || {};
  const curveFalseNegativeReplay = docs.preMigrationCurveFalseNegativeReplay.data || {};
  const curveFalseNegativeShadow = docs.preMigrationCurveFalseNegativeShadow.data || {};
  const curveFalseNegativeShadowReplay = docs.preMigrationCurveFalseNegativeShadowReplay.data || {};
  const curveFalseNegativeRecoveryShadow = docs.preMigrationCurveFalseNegativeRecoveryShadow.data || {};
  const freshCurveOverrideShadow = docs.preMigrationFreshCurveOverrideShadow.data || {};
  const walletConditionedRelaxedGateReplay = docs.preMigrationWalletConditionedRelaxedGateReplay.data || {};
  const walletRelaxedShadowOutcome = docs.preMigrationWalletRelaxedShadowOutcome.data || {};
  const paidTapeCoverageEpoch = docs.paidTapeCoverageEpoch.data || {};
  const walletContextCoverage = docs.preMigrationWalletContextCoverage.data || {};
  const walletContextFollowThrough = docs.preMigrationWalletContextFollowThrough.data || {};
  const walletChannelHealth = docs.preMigrationWalletChannelHealth.data || {};
  const entryCandidateReview = docs.preMigrationEntryCandidateReview.data || {};
  const walletSupportedNearMissReplay = docs.preMigrationWalletSupportedNearMissReplay.data || {};
  const sameMintReentryImpact = docs.preMigrationSameMintReentryImpact.data || {};
  const breakevenStopGap = docs.preMigrationBreakevenStopGap.data || {};
  const exitProtectionReplay = docs.preMigrationExitProtectionReplay.data || {};
  const mfeMaeCapture = docs.preMigrationMfeMaeCapture.data || {};
  const signal = docs.signalQuality.data || {};
  const learning = docs.learning.data || {};
  const strategyCandidateScorecard = docs.strategyCandidateScorecard.data || {};
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
  const walletUntrackedReview = docs.walletUntrackedReview.data || {};
  const walletLaunchIntelBridge = docs.walletLaunchIntelBridge.data || {};
  const walletLaunchIntelStability = docs.walletLaunchIntelStability.data || {};
  const walletLaunchIntelShortlistEntryReplay = docs.walletLaunchIntelShortlistEntryReplay.data || {};
  const walletLaunchIntelShortlistShadow = docs.walletLaunchIntelShortlistShadow.data || {};
  const walletUntrackedShadowImpact = docs.walletUntrackedShadowImpact.data || {};
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
  const paperEntries = get(liveReadiness, ['metrics.paperEntries'], get(battlefield, [
    'preMigrationPaper.entries',
    'pre_migration_paper.entries',
    'paper.entries',
    'summary.paperEntries'
  ], get(paper, ['actual.entries', 'actualPaper.entries', 'entries'], null)));
  const paperExits = get(liveReadiness, ['metrics.paperExits'], get(battlefield, [
    'preMigrationPaper.exits',
    'pre_migration_paper.exits',
    'paper.exits',
    'summary.paperExits'
  ], get(paper, ['actual.exits', 'actualPaper.exits', 'exits'], null)));
  const paperPnl = get(liveReadiness, ['metrics.paperPnl'], get(battlefield, [
    'preMigrationPaper.pnlSol',
    'pre_migration_paper.pnlSol',
    'paper.pnlSol',
    'summary.paperPnlSol'
  ], null));
  const aiEvidence = collectSimpleRuntimeEvidence();
  const aiReachability = buildAiReachability(battlefield);
  const aiHistoricalSummary = simpleRuntimeAiEvidence.summary || {};
  const pumpPortalHealth = buildPumpPortalHealth(battlefield);
  const pumpDevHealth = buildPumpDevHealth(battlefield);
  const bondingCurvePressure = buildBondingCurvePressure(battlefield);
  const solanaRpcPressure = buildSolanaRpcPressure(battlefield);
  const runnerLifecycle = battlefield.runnerLane?.simpleRuntimeAiLifecycle || {};
  const signalExecutionLatency = battlefield.runnerLane?.signalExecutionLatencyMs || {};
  const eventCounts = battlefield.eventCounts || {};

  lines.push(...buildLaunchDecisionLines({
    battlefield,
    liveReadiness,
    paperEntries,
    paperPnl,
    aiReachability,
    preMigrationGuardAttribution: docs.preMigrationGuardAttribution.data || {},
    preMigrationEntryGateMargin: docs.preMigrationEntryGateMargin.data || {},
    preMigrationDryRunEntryReplay: docs.preMigrationDryRunEntryReplay.data || {},
    preMigrationRelaxedGateReplay: docs.preMigrationRelaxedGateReplay.data || {},
    preMigrationHighReadinessRejectReplay: docs.preMigrationHighReadinessRejectReplay.data || {},
    preMigrationCurveStallRelaxedReplay: docs.preMigrationCurveStallRelaxedReplay.data || {},
    preMigrationCurveAdvanceDiagnostic: docs.preMigrationCurveAdvanceDiagnostic.data || {},
    preMigrationCurveNotAdvancingSeparability: docs.preMigrationCurveNotAdvancingSeparability?.data || {},
    preMigrationCurveNotAdvancingSeparatorShadow: docs.preMigrationCurveNotAdvancingSeparatorShadow?.data || {},
    preMigrationCurveConfirmationReplay: docs.preMigrationCurveConfirmationReplay?.data || {},
    preMigrationCurveConfirmationShadow: docs.preMigrationCurveConfirmationShadow?.data || {},
    preMigrationEntryFunnel: docs.preMigrationEntryFunnel?.data || {},
    preMigrationWalletChannelHealth: docs.preMigrationWalletChannelHealth?.data || {},
    runnerRejectEntryReplay: docs.runnerRejectEntryReplay.data || {},
    strategyCandidateScorecard
  }));

  const telemetryAuditSummary = telemetryPathAudit.summary || {};
  if (Object.keys(telemetryAuditSummary).length) {
    lines.push('0a. Telemetry Path Audit');
    lines.push('------------------------');
    lines.push(`- Newest telemetry: ${telemetryPathAudit.newestTelemetryPath || 'n/a'}.`);
    lines.push(`- Reports scanned / with issues: ${telemetryAuditSummary.reportsScanned ?? 'n/a'} / ${telemetryAuditSummary.reportsWithIssues ?? 'n/a'}.`);
    lines.push(`- Issue counts: ${formatTopCounts(telemetryAuditSummary.issueCounts)}.`);
    const auditRows = topArray(telemetryPathAudit.issueRows, 5);
    if (auditRows.length) {
      lines.push('- Top issue rows:');
      auditRows.forEach((row, index) => {
        lines.push(`  ${index + 1}. ${row.reportPath || 'unknown'} | issues=${Array.isArray(row.issues) ? row.issues.join(',') : 'n/a'}`);
      });
    }
    lines.push('');
  }

  if (strategyCandidateScorecard.summary) {
    const scorecardSummary = strategyCandidateScorecard.summary;
    const scorecardWalletCoverage = scorecardSummary.walletContextCoverage || {};
    lines.push('0b. Strategy Candidate Scorecard');
    lines.push('--------------------------------');
    lines.push(`- Best action: ${scorecardSummary.bestAction || 'n/a'}; promotion eligible=${scorecardSummary.promotionEligibleCount ?? 'n/a'} / ${scorecardSummary.candidateCount ?? 'n/a'} candidates.`);
    if (scorecardWalletCoverage.verdict !== undefined) {
      lines.push(`- Wallet context coverage: ${scorecardWalletCoverage.verdict || 'n/a'}; runtime wallet events=${scorecardWalletCoverage.runtimeWalletEvents ?? 'n/a'}, paper decisions with wallet context=${scorecardWalletCoverage.paperDecisionsWithWalletContext ?? 'n/a'}.`);
    }
    lines.push(`- Interpretation: ${scorecardSummary.interpretation || 'n/a'}`);
    const bestCandidates = topArray(strategyCandidateScorecard.bestCandidates, 5);
    if (bestCandidates.length) {
      lines.push('- Top candidates:');
      bestCandidates.forEach((candidate, index) => {
        lines.push(`  ${index + 1}. ${summarizeStrategyCandidate(candidate)}`);
      });
    }
    const topBlockers = topArray(scorecardSummary.topBlockers, 5);
    if (topBlockers.length) {
      lines.push('- Top promotion blockers:');
      topBlockers.forEach((item) => lines.push(`  - ${item.blocker}: ${item.count}`));
    }
    lines.push('');
  }

  if (entryFunnel.summary) {
    const funnel = entryFunnel.summary || {};
    const rates = funnel.funnelRates || {};
    const shadowRates = funnel.shadowRates || {};
    const dropoffs = funnel.dropoffs || {};
    lines.push('0b2. Entry Funnel');
    lines.push('-----------------');
    lines.push(`- Observed/flagged/evaluated/wouldEnter/entered mints: ${funnel.observedMints ?? 'n/a'} / ${funnel.flaggedMints ?? 'n/a'} / ${funnel.evaluatedMints ?? 'n/a'} / ${funnel.wouldEnterMints ?? 'n/a'} / ${funnel.enteredMints ?? 'n/a'}.`);
    lines.push(`- Unflagged shadow evaluated/wouldEnter mints: ${funnel.unflaggedShadowEvaluatedMints ?? 'n/a'} / ${funnel.unflaggedShadowWouldEnterMints ?? 'n/a'}; shadow rates evaluated/observed-not-flagged=${pct(shadowRates.unflaggedShadowEvaluatedPerObservedNotFlagged, 1)}, wouldEnter/shadow=${pct(shadowRates.unflaggedShadowWouldEnterPerShadowEvaluated, 1)}.`);
    lines.push(`- Funnel rates flagged/observed=${pct(rates.flaggedPerObserved, 1)}, evaluated/flagged=${pct(rates.evaluatedPerFlagged, 1)}, wouldEnter/evaluated=${pct(rates.wouldEnterPerEvaluated, 1)}, entered/evaluated=${pct(rates.enteredPerEvaluated, 1)}.`);
    lines.push(`- Dropoffs: observed-not-flagged=${dropoffs.observedNotFlaggedMints ?? 'n/a'}, flagged-not-evaluated=${dropoffs.flaggedNotEvaluatedMints ?? 'n/a'}, evaluated-never-would-enter=${dropoffs.evaluatedNeverWouldEnterMints ?? 'n/a'}, wouldEnter-no-entry=${dropoffs.wouldEnterNoEntryMints ?? 'n/a'}, unflagged-shadow-would-enter=${dropoffs.unflaggedShadowWouldEnterMints ?? 'n/a'}.`);
    lines.push(`- Top skip reasons: ${formatTopCounts(funnel.topSkipReasons)}.`);
    if (funnel.curveNotAdvancingDiagnostics) {
      const curve = funnel.curveNotAdvancingDiagnostics || {};
      lines.push(`- CURVE_NOT_ADVANCING diagnostics: rows=${curve.rows ?? 'n/a'}, mints=${curve.mints ?? 'n/a'}, near-threshold=${curve.nearThresholdRows ?? 'n/a'}, positive-60s=${curve.positive60sRows ?? 'n/a'}, candidate-60s=${curve.positive60sCandidateRows ?? 'n/a'}, high-score-60s=${curve.positive60sHighScoreRows ?? 'n/a'}, high-volume-60s=${curve.positive60sHighVolumeRows ?? 'n/a'}, no-negative-delta-60s=${curve.positive60sNoNegativeDeltaRows ?? 'n/a'}, negative-delta=${curve.negativeDeltaRows ?? 'n/a'}; readiness=${formatTopCounts(curve.readinessBuckets)}.`);
    }
    if (funnel.firstTouchDiagnostics) {
      const touch = funnel.firstTouchDiagnostics || {};
      lines.push(`- First-touch proof diagnostics: rows=${touch.rows ?? 'n/a'}, mints=${touch.mints ?? 'n/a'}, proof rows=${touch.proofRows ?? 'n/a'}, zero-touch=${touch.zeroTouchRows ?? 'n/a'}, any-touch=${touch.anyTouchRows ?? 'n/a'}, buy-touch=${touch.buyTouchRows ?? 'n/a'}, pre85-buy=${touch.pre85BuyTouchRows ?? 'n/a'}, untrusted-touch=${touch.untrustedTouchRows ?? 'n/a'}, untrusted-buy=${touch.untrustedBuyTouchRows ?? 'n/a'}, untrusted-pre85=${touch.untrustedPre85BuyTouchRows ?? 'n/a'}, positive-touch=${touch.withPositiveTouchRows ?? 'n/a'}, avoid-touch=${touch.withAvoidTouchRows ?? 'n/a'}; proof buckets=${formatTopCounts(touch.proofBuckets)}.`);
    }
    if (funnel.staleCurveDiagnostics) {
      const stale = funnel.staleCurveDiagnostics || {};
      lines.push(`- Stale curve diagnostics: rows=${stale.rows ?? 'n/a'}, first-curve=${stale.firstCurveStaleRows ?? 'n/a'}, high-curve=${stale.highCurveStaleRows ?? 'n/a'}; age buckets=${formatTopCounts(stale.ageBuckets)}.`);
    }
    if (funnel.targetedParityDiagnostics) {
      const parity = funnel.targetedParityDiagnostics || {};
      lines.push(`- Targeted parity join: joined=${parity.joinedMints ?? 'n/a'}, high-delta=${parity.joinedHighDeltaMints ?? 'n/a'}, sampled=${parity.sampledTargets ?? 'n/a'}, comparable=${parity.comparableRows ?? 'n/a'}; diagnoses=${formatTopCounts(parity.semanticDiagnosisCounts)}.`);
    }
    lines.push(`- Top guard failed checks: ${formatTopCounts(funnel.topGuardFailedChecks)}.`);
    lines.push(`- Top unflagged shadow failed checks: ${formatTopCounts(funnel.topShadowGuardFailedChecks)}.`);
    const closest = topArray(entryFunnel.closestBlocked, 5);
    if (closest.length) {
      lines.push('- Closest blocked candidates:');
      closest.forEach((row, index) => lines.push(`  ${index + 1}. ${summarizeEntryFunnelRow(row)}`));
    }
    lines.push('');
  }

  if (observedCoverage.summary) {
    const coverage = observedCoverage.summary || {};
    lines.push('0b3. Observed Coverage');
    lines.push('----------------------');
    lines.push('- Mode: report-only; audits watch-lane observed mints that never became flagged candidates.');
    lines.push(`- Observed/flagged/unflagged: ${coverage.observedMints ?? 'n/a'} / ${coverage.flaggedMints ?? 'n/a'} / ${coverage.unflaggedMints ?? 'n/a'}; flagged rate=${pct(coverage.flaggedPerObserved, 1)}.`);
    lines.push(`- Unflagged strong-at-observation: ${coverage.unflaggedStrongMints ?? 'n/a'}; unflagged follow-through is under-measured, so crossed90=${coverage.unflaggedCrossed90Within300s ?? 'n/a'} is coverage-limited rather than proof of no runners.`);
    lines.push(`- Unflagged classes: ${formatTopCounts(coverage.unflaggedClassificationCounts)}.`);
    lines.push(`- Unflagged max score median/p90/max: ${fmt(coverage.unflaggedMaxScore?.median, 2)} / ${fmt(coverage.unflaggedMaxScore?.p90, 2)} / ${fmt(coverage.unflaggedMaxScore?.max, 2)}; curve median/p90/max=${fmt(coverage.unflaggedMaxCurveProgress?.median, 4)} / ${fmt(coverage.unflaggedMaxCurveProgress?.p90, 4)} / ${fmt(coverage.unflaggedMaxCurveProgress?.max, 4)}.`);
    const topUnflagged = topArray(observedCoverage.topUnflaggedByScore, 5);
    if (topUnflagged.length) {
      lines.push('- Top unflagged by score:');
      topUnflagged.forEach((row, index) => {
        lines.push(`  ${index + 1}. ${row.symbol || 'UNKNOWN'} ${row.mint || ''} | class=${row.classification || 'n/a'} | score=${fmt(row.maxScore, 2)} | curve=${fmt(row.maxCurveProgress, 4)} | vol=${fmt(row.maxRecentVolumeSol, 2)} | vel=${fmt(row.maxTradeVelocityPerMin, 2)} | cross90_300=${row.followThrough300s?.crossed90AfterLastObserved === true}`);
      });
    }
    lines.push('');
  }

  if (flaggedCandidateAttribution.summary) {
    const flaggedSummary = flaggedCandidateAttribution.summary || {};
    const replay = flaggedSummary.replay || {};
    const topStrong = topArray(flaggedCandidateAttribution.topStrongFollowThrough, 5);
    lines.push('0b4. Flagged Candidate Attribution');
    lines.push('-----------------------------------');
    lines.push('- Mode: report-only; joins flagged/evaluated mints to finalist-verifier future snapshots and counterfactual replay.');
    lines.push(`- Candidates/flagged/evaluated/finalist-measured: ${flaggedSummary.candidates ?? 'n/a'} / ${flaggedSummary.flaggedMints ?? 'n/a'} / ${flaggedSummary.evaluatedMints ?? 'n/a'} / ${flaggedSummary.mintsWithFinalistSnapshots ?? 'n/a'}.`);
    lines.push(`- Attribution classes: ${formatTopCounts(flaggedSummary.classificationCounts)}.`);
    lines.push(`- Skip reasons / tightest gates: ${formatTopCounts(flaggedSummary.skipReasonCounts)} / ${formatTopCounts(flaggedSummary.tightestGateCounts)}.`);
    lines.push(`- Wallet channel trusted/positive/rawUntrusted/pre85/noTrackedFirstTouch: ${flaggedSummary.walletCounts?.anyTrustedTouch ?? 'n/a'} / ${flaggedSummary.walletCounts?.positiveOrProvenTouch ?? 'n/a'} / ${flaggedSummary.walletCounts?.rawUntrustedTouch ?? 'n/a'} / ${flaggedSummary.walletCounts?.rawUntrustedPre85Buy ?? 'n/a'} / ${flaggedSummary.walletCounts?.noTrackedFirstTouch ?? 'n/a'}.`);
    lines.push(`- Replay: n=${replay.replayed ?? 'n/a'}, wins/losses=${replay.wins ?? 'n/a'}/${replay.losses ?? 'n/a'}, pnl=${sol(replay.totalPnlSol, 6)}, median=${sol(replay.medianPnlSol, 6)}, exTop3=${sol(replay.top3RemovedPnlSol, 6)}, stressed=${sol(replay.stressedPnlSol, 6)}.`);
    if (topStrong.length) {
      lines.push('- Strong blocked follow-through examples:');
      topStrong.forEach((row, index) => {
        lines.push(`  ${index + 1}. ${row.symbol || 'UNKNOWN'} ${row.mint || ''} | reason=${row.firstDecision?.reason || 'n/a'} | score=${fmt(row.maxScore, 2)} | curve=${fmt(row.maxCurveProgress, 4)} | w120 price=${fmt(row.window120s?.maxPriceDeltaPct, 2)}% | replay=${sol(row.replay?.pnlSol, 6)} | walletPositive=${row.wallet?.positiveOrProvenTouch === true}`);
      });
    }
    lines.push('');
  }

  if (flaggedAttributionTrend.summary) {
    const trend = flaggedAttributionTrend.summary || {};
    lines.push('0b5. Flagged Attribution Trend');
    lines.push('--------------------------------');
    lines.push('- Mode: report-only; aggregates flagged-candidate attribution across recent telemetry runs to avoid one-run outlier bias.');
    lines.push(`- Verdict: ${trend.verdict || 'n/a'}; runs=${trend.runCount ?? 'n/a'}, candidates=${trend.candidates ?? 'n/a'}, measured=${trend.measuredMints ?? 'n/a'} (${pct(trend.measuredRate, 1)}), insufficient=${pct(trend.insufficientRate, 1)}.`);
    lines.push(`- Strong/useful follow-through: ${trend.strongFollowThrough ?? 'n/a'} / ${trend.usefulFollowThrough ?? 'n/a'}; rate among measured=${pct(trend.strongOrUsefulRateMeasured, 1)}.`);
    lines.push(`- Replay aggregate: n=${trend.replayed ?? 'n/a'}, wins/losses=${trend.replayWins ?? 'n/a'}/${trend.replayLosses ?? 'n/a'}, total=${sol(trend.replayTotalPnlSol, 6)}, stressed=${sol(trend.replayStressedPnlSol, 6)}, top3-removed-sum=${sol(trend.replayTop3RemovedPnlSolSum, 6)}.`);
    lines.push(`- Replay by run median: total=${sol(trend.replayTotalPnlSolByRun?.median, 6)}, medianTrade=${sol(trend.replayMedianPnlSolByRun?.median, 6)}, top3Removed=${sol(trend.replayTop3RemovedPnlSolByRun?.median, 6)}.`);
    lines.push(`- Classifications: ${formatTopCounts(trend.classificationCounts)}.`);
    lines.push('');
  }

  if (flaggedFollowThroughSlices.summary) {
    const slices = flaggedFollowThroughSlices.summary || {};
    const topProfiles = topArray(flaggedFollowThroughSlices.profiles, 6);
    lines.push('0b6. Flagged Follow-Through Slices');
    lines.push('-----------------------------------');
    lines.push('- Mode: report-only; searches for repeatable pre-entry patterns among blocked flagged candidates with later follow-through.');
    lines.push(`- Verdict: ${slices.verdict || 'n/a'}; rows/measured=${slices.rows ?? 'n/a'} / ${slices.measured ?? 'n/a'}; strong/useful/flat=${slices.strong ?? 'n/a'} / ${slices.useful ?? 'n/a'} / ${slices.flat ?? 'n/a'}.`);
    lines.push(`- Replay all slices: n=${slices.replayed ?? 'n/a'}, wins/losses=${slices.wins ?? 'n/a'}/${slices.losses ?? 'n/a'}, pnl=${sol(slices.totalPnlSol, 6)}, median=${sol(slices.medianPnlSol, 6)}, top3Removed=${sol(slices.top3RemovedPnlSol, 6)}.`);
    lines.push(`- Promising report-only profiles: ${Array.isArray(slices.promisingProfiles) && slices.promisingProfiles.length ? slices.promisingProfiles.join(', ') : 'none'}.`);
    if (topProfiles.length) {
      lines.push('- Profile leaderboard:');
      topProfiles.forEach((profile) => {
        lines.push(`  - ${profile.label}: verdict=${profile.verdict || 'n/a'}, measured=${profile.measured ?? 'n/a'}, wins/losses=${profile.wins ?? 'n/a'}/${profile.losses ?? 'n/a'}, pnl=${sol(profile.totalPnlSol, 6)}, median=${sol(profile.medianPnlSol, 6)}, top3Removed=${sol(profile.top3RemovedPnlSol, 6)}`);
      });
    }
    lines.push('');
  }

  if (flaggedFollowThroughSliceShadow.summary) {
    const shadow = flaggedFollowThroughSliceShadow.summary || {};
    const topProfiles = topArray(flaggedFollowThroughSliceShadow.profiles, 6);
    lines.push('0b7. Flagged Follow-Through Slice Shadow');
    lines.push('------------------------------------------');
    lines.push('- Mode: runtime shadow-only; evaluates the promising report-only profiles on blocked flagged paper decisions. Does not change entries.');
    lines.push(`- Verdict: ${shadow.verdict || 'n/a'}; rows=${shadow.rows ?? 'n/a'}, wouldEnter=${shadow.wouldEnterRows ?? 'n/a'}, wouldSkip=${shadow.wouldSkipRows ?? 'n/a'}, uniqueMints=${shadow.uniqueMints ?? 'n/a'}, wouldEnterUniqueMints=${shadow.wouldEnterUniqueMints ?? 'n/a'}.`);
    lines.push(`- Profile matches: ${formatTopCounts(shadow.profileMatches)}.`);
    lines.push(`- Source reasons: ${formatTopCounts(shadow.sourceReasons)}.`);
    if (topProfiles.length) {
      lines.push('- Runtime profile coverage:');
      topProfiles.forEach((profile) => {
        lines.push(`  - ${profile.name}: rows=${profile.rows ?? 'n/a'}, uniqueMints=${profile.uniqueMints ?? 'n/a'}, scoreMedian=${fmt(profile.score?.median, 2)}, curveMedian=${fmt(profile.curveProgress?.median, 3)}, volumeMedian=${fmt(profile.recentVolumeSol?.median, 2)}, velocityMedian=${fmt(profile.tradeVelocityPerMin?.median, 2)}`);
      });
    }
    lines.push('');
  }

  if (flaggedFollowThroughSliceShadowReplay.summary) {
    const replay = flaggedFollowThroughSliceShadowReplay.summary || {};
    const topProfiles = topArray(flaggedFollowThroughSliceShadowReplay.profiles, 6);
    lines.push('0b8. Flagged Slice Shadow Replay');
    lines.push('---------------------------------');
    lines.push('- Mode: report-only; dedupes runtime slice-shadow would-enter rows by mint/profile and replays observed follow-through. Does not change entries.');
    lines.push(`- Verdict: ${replay.verdict || 'n/a'}; rawEvents=${replay.rawWouldEnterEvents ?? 'n/a'}, profileRows=${replay.rawProfileMatchRows ?? replay.rawWouldEnterRows ?? 'n/a'}, mintProfileRows=${replay.dedupedMintProfileRows ?? 'n/a'}, uniqueMints=${replay.dedupedMintRows ?? replay.uniqueMints ?? 'n/a'}, measured=${replay.measured ?? 'n/a'}, actualPaperEntryMints=${replay.actualPaperEntryMints ?? 'n/a'}.`);
    lines.push(`- Replay: n=${replay.replayed ?? 'n/a'}, wins/losses=${replay.wins ?? 'n/a'}/${replay.losses ?? 'n/a'}, pnl=${sol(replay.pnlSol, 6)}, stressed=${sol(replay.stressedPnlSol, 6)}, median=${sol(replay.medianPnlSol, 6)}, exTop3=${sol(replay.exTop3PnlSol, 6)}, topMintShare=${pct(replay.topMintRowShare, 1)}.`);
    if (topProfiles.length) {
      lines.push('- Runtime replay by profile:');
      topProfiles.forEach((profile) => {
        lines.push(`  - ${profile.label || profile.name || 'unknown'}: verdict=${profile.verdict || 'n/a'}, uniqueMints=${profile.uniqueMints ?? 'n/a'}, measured=${profile.measured ?? 'n/a'}, wins/losses=${profile.wins ?? 'n/a'}/${profile.losses ?? 'n/a'}, pnl=${sol(profile.pnlSol, 6)}, median=${sol(profile.medianPnlSol, 6)}, exTop3=${sol(profile.exTop3PnlSol, 6)}, topMintShare=${pct(profile.topMintRowShare, 1)}`);
      });
    }
    lines.push('');
  }

  if (candidateSupplyFunnel.summary) {
    const supply = candidateSupplyFunnel.summary || {};
    const funnelRows = topArray(candidateSupplyFunnel.funnel, 12);
    lines.push('0b9. Candidate Supply Funnel');
    lines.push('----------------------------');
    lines.push('- Mode: distinct-mint supply diagnostic; measures where pre-migration candidate supply is lost before paper entry.');
    lines.push(`- Verdict: ${supply.verdict || 'n/a'}; observed=${supply.observedMints ?? 'n/a'} (${fmt(supply.observedPerHour, 2)}/hr), curve60+=${supply.curve60PlusMints ?? 'n/a'} (${fmt(supply.curve60PlusPerHour, 2)}/hr), trustedCurve60+=${supply.curve60PlusWithTrustedWalletMints ?? 'n/a'}, positiveCurve60+=${supply.curve60PlusWithPositiveWalletMints ?? 'n/a'}, flagged=${supply.flaggedMints ?? 'n/a'}, shadowWouldEnter=${supply.sliceShadowWouldEnterMints ?? 'n/a'}, paperEntered=${supply.paperEnteredMints ?? 'n/a'}.`);
    lines.push(`- Top reasons: ${formatTopCounts(supply.topReasons)}.`);
    if (funnelRows.length) {
      lines.push('- Funnel stages:');
      funnelRows.forEach((row) => {
        lines.push(`  - ${row.stage}: ${row.uniqueMints ?? 'n/a'} mints, ${fmt(row.perHour, 2)}/hr, retain=${pct(row.retentionFromPrevious, 1)}`);
      });
    }
    lines.push('');
  }

  if (curve60SupplyDecomposition.summary) {
    const supply = curve60SupplyDecomposition.summary || {};
    const cohorts = topArray(curve60SupplyDecomposition.cohorts, 6);
    lines.push('0b9a. Curve60 Supply Decomposition');
    lines.push('-----------------------------------');
    lines.push('- Mode: report-only; decomposes curve60+ supply loss into scarcity, observation latency, flagging misses, and post-flag gating.');
    lines.push(`- Verdicts: baseRate=${supply.baseRateVerdict || supply.verdict || 'n/a'}, conditionalLoss=${supply.conditionalLossVerdict || 'n/a'}; observed=${supply.observedMints ?? 'n/a'} (${fmt(supply.observedPerHour, 2)}/hr), curve60+=${supply.curve60PlusMints ?? 'n/a'} (${fmt(supply.curve60PlusPerHour, 2)}/hr), observedPre60ThenCurve60=${supply.observedPre60ThenCurve60Mints ?? 'n/a'}, lateObserved=${supply.lateObservedCurve60Mints ?? 'n/a'}, neverFlagged=${supply.neverFlaggedObservedPre60Mints ?? 'n/a'}, flaggedLate=${supply.flaggedLateAfterCurve60Mints ?? 'n/a'}, gatedAfterFlag=${(Number(supply.flaggedButGatedMints || 0) + Number(supply.shadowWouldEnterNotPaperMints || 0)) || 'n/a'}, paperEntered=${supply.paperEnteredCurve60Mints ?? 'n/a'}.`);
    lines.push(`- Rates: curve60Observed=${pct(supply.curve60ObservedRate, 2)}, lateObserved=${pct(supply.curve60LateObservedRate, 2)}, flaggingMiss=${pct(supply.curve60FlaggingMissRate, 2)}, gatedAfterFlag=${pct(supply.curve60GatedAfterFlagRate, 2)}.`);
    lines.push(`- Curve60 classifications: ${formatTopCounts(supply.curve60ClassificationCounts)}.`);
    lines.push(`- Timing observedPre60->curve60 median/p90=${fmt(supply.secondsObservedPre60ToCurve60?.median, 2)}s / ${fmt(supply.secondsObservedPre60ToCurve60?.p90, 2)}s; flagged->curve60 median/p90=${fmt(supply.secondsFlaggedToCurve60?.median, 2)}s / ${fmt(supply.secondsFlaggedToCurve60?.p90, 2)}s.`);
    if (cohorts.length) {
      lines.push('- Cohorts:');
      cohorts.forEach((row) => {
        lines.push(`  - ${row.cohort}: mints=${row.mints ?? 'n/a'}.`);
      });
    }
    lines.push('');
  }

  if (watchVsCrosserSupply.summary) {
    const supply = watchVsCrosserSupply.summary || {};
    const cohorts = topArray(watchVsCrosserSupply.cohorts, 8);
    lines.push('0b9b. Watch-vs-Crosser Supply');
    lines.push('-----------------------------');
    lines.push('- Mode: report-only provenance autopsy; classifies cross60/cross90 mints as missed, observed-not-flagged, flagged-but-gated, shadow-enterable, or entered.');
    lines.push(`- Verdict: ${supply.verdict || 'n/a'}; observed=${supply.observedMints ?? 'n/a'} (${fmt(supply.observedPerHour, 2)}/hr), flagged=${supply.flaggedMints ?? 'n/a'}, evaluated=${supply.evaluatedMints ?? 'n/a'}, curve60/85/90=${supply.curve60PlusMints ?? 'n/a'} / ${supply.curve85PlusMints ?? 'n/a'} / ${supply.curve90PlusMints ?? 'n/a'}, paperEntered=${supply.paperEnteredMints ?? 'n/a'}.`);
    lines.push(`- Supply side-effects: flaggedNeverCurve60=${supply.flaggedNeverCurve60Mints ?? 'n/a'}, unflaggedNearMiss=${supply.unflaggedNearMissMints ?? 'n/a'}, sliceShadowWouldEnter=${supply.sliceShadowWouldEnterMints ?? 'n/a'}, separatorShadowWouldEnter=${supply.separatorShadowWouldEnterMints ?? 'n/a'}.`);
    lines.push(`- Crosser provenance: ${formatTopCounts(supply.cross60ProvenanceCounts)}.`);
    lines.push(`- Runner provenance: ${formatTopCounts(supply.runnerProvenanceCounts)}.`);
    lines.push(`- Top reasons/checks: reasons=${formatTopCounts(supply.topReasons)}, failed=${formatTopCounts(supply.topFailedChecks)}.`);
    if (cohorts.length) {
      lines.push('- Cohorts:');
      cohorts.forEach((row) => {
        lines.push(`  - ${row.cohort}: mints=${row.mints ?? 'n/a'}, crossed60/90=${row.crossed60 ?? 'n/a'} / ${row.crossed90 ?? 'n/a'}, flagged=${row.flagged ?? 'n/a'}, wouldEnter=${row.wouldEnter ?? 'n/a'}, scoreMed=${fmt(row.score?.median, 2)}, velMed=${fmt(row.tradeVelocityPerMin?.median, 2)}, maxCurveMed=${fmt(row.curveProgress?.median, 4)}.`);
      });
    }
    lines.push('');
  }

  if (runnerNoEntryAutopsy.summary) {
    const autopsy = runnerNoEntryAutopsy.summary || {};
    const runners = topArray(runnerNoEntryAutopsy.runners, 5);
    lines.push('0b9c. Runner No-Entry Autopsy');
    lines.push('-------------------------------');
    lines.push('- Mode: report-only; audits why curve90 runners did not become paper entries by joining gate inputs, blocker co-fires, and nearby verifier/parity truth.');
    lines.push(`- Verdict: ${autopsy.verdict || 'n/a'}; curve60/90=${autopsy.curve60PlusMints ?? 'n/a'} / ${autopsy.curve90PlusMints ?? 'n/a'}, noEntryRunners=${autopsy.noEntryRunnerMints ?? 'n/a'}, enteredRunners=${autopsy.paperEnteredRunnerMints ?? 'n/a'}.`);
    lines.push(`- Binding gates: ${formatTopCounts(autopsy.bindingGates)}; stale verdicts=${formatTopCounts(autopsy.staleGateVerdicts)}.`);
    if (autopsy.blockerCoFire) {
      const co = autopsy.blockerCoFire;
      lines.push(`- Blocker co-fire rows: stale=${co.staleRows ?? 'n/a'}, sniper=${co.sniperCrowdingRows ?? 'n/a'}, stale+sniper=${co.staleAndSniperCrowdingRows ?? 'n/a'}; runner buyer/sniper ratio median/p90=${fmt(autopsy.runnerBuyerSniperRatio?.median, 2)} / ${fmt(autopsy.runnerBuyerSniperRatio?.p90, 2)}.`);
    }
    if (runners.length) {
      lines.push('- Runner no-entry rows:');
      runners.forEach((row, index) => {
        lines.push(`  ${index + 1}. ${row.symbol || 'UNKNOWN'} ${row.mint || ''} | gate=${row.bindingGate || 'n/a'} | stale=${row.staleGateVerdict || 'n/a'} | decisionCurve=${fmt(row.decisionCurveProgress, 4)} | decisionScore=${fmt(row.decisionScore, 2)} | decisionBuyers/snipers=${fmt(row.decisionUniqueBuyerCount, 0)} / ${fmt(row.decisionSniperWalletCount, 0)} | decisionRatio=${fmt(row.decisionBuyerSniperRatio, 2)} | obs->90=${fmt(row.secondsObservedToCross90, 2)}s.`);
      });
    }
    lines.push('');
  }

  if (advancingHighCurveLaneGap.summary) {
    const gap = advancingHighCurveLaneGap.summary || {};
    const all = gap.all || {};
    const byReason = gap.byReason || {};
    const buckets = topArray(gap.byCrowdingBreadth, 5);
    lines.push('0b9d. Advancing High-Curve Lane Gap');
    lines.push('-------------------------------------');
    lines.push('- Mode: report-only; tests decision-time high-curve advancing candidates blocked by first-sight override or curve-false-negative stalled-curve policy. No future max fields are used for filtering.');
    lines.push(`- Verdict: ${gap.verdict || 'n/a'}; raw/deduped=${gap.rawCandidateRows ?? 'n/a'} / ${gap.dedupedCandidateRows ?? 'n/a'}, uniqueMints=${gap.uniqueMints ?? 'n/a'}, replayed=${all.replayed ?? 'n/a'}, crossed90_300=${all.crossed90Within300s ?? 'n/a'}.`);
    lines.push(`- Replay: wins/losses=${all.wins ?? 'n/a'} / ${all.losses ?? 'n/a'}, winRate=${pct(all.winRate, 1)}, pnlSum=${fmt(all.pnl?.sum, 6)} SOL, median=${fmt(all.pnl?.median, 6)} SOL, exTop3=${fmt(all.exTop3PnlSol, 6)} SOL, outlierDominated=${all.outlierDominated === null || all.outlierDominated === undefined ? 'n/a' : all.outlierDominated}.`);
    if (Object.keys(byReason).length) {
      lines.push('- By blocker:');
      Object.entries(byReason).forEach(([reason, row]) => {
        lines.push(`  - ${reason}: verdict=${row.verdict || 'n/a'}, rows=${row.rows ?? 'n/a'}, replayed=${row.replayed ?? 'n/a'}, crossed90=${row.crossed90Within300s ?? 'n/a'}, median=${fmt(row.pnl?.median, 6)} SOL, exTop3=${fmt(row.exTop3PnlSol, 6)} SOL.`);
      });
    }
    if (buckets.length) {
      lines.push('- Breadth/crowding buckets:');
      buckets.forEach((row) => {
        lines.push(`  - ${row.name}: rows=${row.rows ?? 'n/a'}, replayed=${row.replayed ?? 'n/a'}, crossed90=${row.crossed90Within300s ?? 'n/a'}, median=${fmt(row.pnl?.median, 6)} SOL, exTop3=${fmt(row.exTop3PnlSol, 6)} SOL.`);
      });
    }
    lines.push('');
  }

  if (pre60SnapshotCoverage.summary) {
    const coverage = pre60SnapshotCoverage.summary || {};
    const field = coverage.pre60FieldCoverage || {};
    const byType = topArray(coverage.pre60CoverageByType, 6);
    const timelines = topArray(pre60SnapshotCoverage.rawPre85Cross90Timelines, 5);
    lines.push('0b9e. Pre60 Snapshot Coverage');
    lines.push('-----------------------------');
    lines.push('- Mode: report-only; audits whether pre60 snapshots actually contain the market fields needed for entry timing, and whether observed curve rows lag finalist curve crossings.');
    lines.push(`- Verdict: ${coverage.verdict || 'n/a'}; mints=${coverage.mints ?? 'n/a'}, crossed60/90=${coverage.crossed60 ?? 'n/a'} / ${coverage.crossed90 ?? 'n/a'}, pre60Snapshots=${coverage.pre60Snapshots ?? 'n/a'}, recommendation=${coverage.recommendation || 'n/a'}.`);
    lines.push(`- Field rates: buyers=${pct(field.uniqueBuyerCount?.rate, 2)}, velocity=${pct(field.tradeVelocityPerMin?.rate, 2)}, volume=${pct(field.recentVolumeSol?.rate, 2)}, score=${pct(field.score?.rate, 2)}, price=${pct(field.priceSol?.rate, 2)}, curve=${pct(field.curveProgress?.rate, 2)}.`);
    lines.push(`- Mint coverage: mintsWithBuyerCount=${coverage.mintsWithPre60BuyerCount ?? 'n/a'}, mintsWithVelocity=${coverage.mintsWithPre60Velocity ?? 'n/a'}; staleObservedAfterCross60 mints/rows=${coverage.staleObservedAfterCross60Mints ?? 'n/a'} / ${coverage.staleObservedAfterCross60Rows ?? 'n/a'}.`);
    if (coverage.pre60MarketContextSources) {
      lines.push(`- Market context sources: ${formatTopCounts(coverage.pre60MarketContextSources)}.`);
    }
    if (coverage.staleObservedBuckets) {
      lines.push(`- Stale observed buckets: ${formatTopCounts(coverage.staleObservedBuckets)}.`);
    }
    if (coverage.pre60ProviderDivergence) {
      const div = coverage.pre60ProviderDivergence;
      lines.push(`- Provider/observed pairs: ${div.withProviderAndObserved ?? 'n/a'} / ${div.snapshots ?? 'n/a'} (${pct(div.withProviderAndObservedRate, 2)}); providerAheadCurve60=${div.providerAheadOfObservedCurve60 ?? 'n/a'} (${pct(div.providerAheadOfObservedCurve60Rate, 2)}).`);
    }
    lines.push(`- Timing: rawPre85->cross60 median/p90=${fmt(coverage.secondsRawPre85ToCross60?.median, 2)}s / ${fmt(coverage.secondsRawPre85ToCross60?.p90, 2)}s; cross60->observedVel25 median/p90=${fmt(coverage.secondsCross60ToObservedVel25?.median, 2)}s / ${fmt(coverage.secondsCross60ToObservedVel25?.p90, 2)}s.`);
    if (byType.length) {
      lines.push('- Pre60 coverage by snapshot type:');
      byType.forEach((row) => {
        const c = row.fieldCoverage || {};
        lines.push(`  - ${row.type}: snapshots=${row.snapshots ?? 'n/a'}, buyers=${pct(c.uniqueBuyerCount?.rate, 2)}, velocity=${pct(c.tradeVelocityPerMin?.rate, 2)}, volume=${pct(c.recentVolumeSol?.rate, 2)}, score=${pct(c.score?.rate, 2)}`);
      });
    }
    if (timelines.length) {
      lines.push('- Raw-pre85 cross90 timelines:');
      timelines.forEach((row, index) => {
        lines.push(`  ${index + 1}. ${row.symbol || 'unknown'} ${row.mint || 'n/a'}: rawPre85=${row.firstRawPre85BuyAt || 'n/a'}, cross60=${row.firstCross60At || 'n/a'} (${row.firstCross60Type || 'n/a'}), vel25Pre60=${row.firstPre60Vel25At || 'none'}, observedVel25AfterCross60=${row.firstObservedVel25AfterCross60At || 'none'}, staleObserved=${row.staleObservedAfterCross60 ?? 'n/a'}`);
      });
    }
    lines.push('');
  }

  if (preCurve60RunnerDiscovery.summary) {
    const discovery = preCurve60RunnerDiscovery.summary || {};
    const topCrossers = topArray(preCurve60RunnerDiscovery.topCross60, 5);
    lines.push('0b10. Pre-Curve60 Runner Discovery');
    lines.push('-----------------------------------');
    lines.push('- Mode: report-only, multi-run; asks whether future runners were visible before curve60 or whether the feed only sees them after the move.');
    lines.push(`- Verdict: ${discovery.verdict || 'n/a'}; mints=${discovery.mints ?? 'n/a'}, observedBelow60=${discovery.observedBelow60 ?? 'n/a'}, crossed60/85/90=${discovery.crossed60 ?? 'n/a'} / ${discovery.crossed85 ?? 'n/a'} / ${discovery.crossed90 ?? 'n/a'}, actionableMissedCross85=${discovery.actionableMissedCross85 ?? 'n/a'}, feedBlindCross60=${discovery.feedBlindCross60 ?? 'n/a'}.`);
    lines.push(`- Pre-60 visibility: observationsBeforeCross60 median/p90=${fmt(discovery.observationsBeforeCross60?.median, 2)} / ${fmt(discovery.observationsBeforeCross60?.p90, 2)}, priceBearingBeforeCross60 median/p90=${fmt(discovery.priceBearingBeforeCross60?.median, 2)} / ${fmt(discovery.priceBearingBeforeCross60?.p90, 2)}.`);
    lines.push(`- Timing to curve60: median/p90=${fmt(discovery.secondsFirstSeenToCross60?.median, 2)}s / ${fmt(discovery.secondsFirstSeenToCross60?.p90, 2)}s; velocity median/p90=${fmt(discovery.curveVelocityTo60PerSec?.median, 5)} / ${fmt(discovery.curveVelocityTo60PerSec?.p90, 5)} curve/sec.`);
    const wallet = discovery.walletBefore60Crossers || {};
    lines.push(`- Wallet before60 on crossers: any/trusted/positive/prospective/raw=${wallet.any ?? discovery.cross60WithAnyWalletBefore60 ?? 'n/a'} / ${wallet.trusted ?? 'n/a'} / ${wallet.positive ?? discovery.cross60WithPositiveWalletBefore60 ?? 'n/a'} / ${wallet.prospective ?? 'n/a'} / ${wallet.rawUntrusted ?? 'n/a'}; ledgerEventsAttached=${discovery.walletLedgerEventsAttached ?? 'n/a'}.`);
    lines.push(`- Terminal stages: ${formatTopCounts(discovery.terminalStages)}.`);
    if (topCrossers.length) {
      lines.push('- Top curve60 crossers:');
      topCrossers.forEach((row, index) => {
        lines.push(`  ${index + 1}. ${row.symbol || 'unknown'} ${row.mint || 'n/a'}: firstCurve=${fmt(row.firstSeenCurve, 3)}, cross60=${fmt(row.secondsFirstSeenToCross60, 2)}s, obsBefore60=${row.observationsBeforeCross60 ?? 'n/a'}, maxCurve=${fmt(row.maxCurveReached, 3)}, maxPriceDelta=${pct(row.maxPriceDeltaFromFirstPricePct, 1)}, stage=${row.terminalStage || 'n/a'}`);
      });
    }
    lines.push('');
  }

  if (earlySignalBaseRate.summary) {
    const base = earlySignalBaseRate.summary || {};
    const baseline = base.baseline || {};
    const walletRows = topArray(earlySignalBaseRate.topWallet, 6);
    const pre60Rows = topArray(earlySignalBaseRate.topPre60, 8);
    const leakyRows = topArray(earlySignalBaseRate.topMaxOverRunDiagnostics, 4);
    const overlapRows = topArray(earlySignalBaseRate.featureOverlapMatrix, 5);
    lines.push('0b10b. Early-Signal Base Rate');
    lines.push('-----------------------------');
    lines.push('- Mode: report-only; compares wallet and non-leaky pre60 market features against the full denominator of run-mints, including non-crossers.');
    lines.push(`- Baseline: rows=${baseline.total ?? 'n/a'}, uniqueMints=${baseline.uniqueMints ?? 'n/a'}, crossed60/85/90=${baseline.crossed60 ?? 'n/a'} / ${baseline.crossed85 ?? 'n/a'} / ${baseline.crossed90 ?? 'n/a'}, rates=${pct(baseline.cross60Rate, 2)} / ${pct(baseline.cross85Rate, 2)} / ${pct(baseline.cross90Rate, 2)}.`);
    lines.push(`- Global mint baseline: uniqueMints=${base.globalMintBaseline?.total ?? 'n/a'}, crossed60/85/90=${base.globalMintBaseline?.crossed60 ?? 'n/a'} / ${base.globalMintBaseline?.crossed85 ?? 'n/a'} / ${base.globalMintBaseline?.crossed90 ?? 'n/a'}.`);
    lines.push(`- Recommendation: ${base.recommendation || 'n/a'}; replayRequired=${Array.isArray(base.replayRequiredFeatures) && base.replayRequiredFeatures.length ? base.replayRequiredFeatures.join(', ') : 'none'}.`);
    lines.push(`- Best replay candidate: ${base.bestReplayCandidate || 'n/a'} verdict=${base.bestReplayCandidateVerdict || 'n/a'} lift90=${fmt(base.bestReplayCandidateLift90, 2)}; leaky max-over-run diagnostics=${base.leakyDiagnosticsCount ?? 'n/a'}.`);
    if (walletRows.length) {
      lines.push('- Wallet feature lift:');
      walletRows.forEach((row) => {
        const s = row.summary || {};
        lines.push(`  - ${row.name}: verdict=${s.verdict || 'n/a'}, n=${s.total ?? 'n/a'}, c60/85/90=${s.crossed60 ?? 'n/a'} / ${s.crossed85 ?? 'n/a'} / ${s.crossed90 ?? 'n/a'}, rates=${pct(s.cross60Rate, 2)} / ${pct(s.cross85Rate, 2)} / ${pct(s.cross90Rate, 2)}, lift90=${fmt(s.lift90, 2)}`);
      });
    }
    if (pre60Rows.length) {
      lines.push('- Non-leaky pre60 market/combo feature lift:');
      pre60Rows.forEach((row) => {
        const s = row.summary || {};
        lines.push(`  - ${row.name}: verdict=${s.verdict || 'n/a'}, n=${s.total ?? 'n/a'}, c90=${s.crossed90 ?? 'n/a'}, rate90=${pct(s.cross90Rate, 2)}, lift90=${fmt(s.lift90, 2)}`);
      });
    }
    if (overlapRows.length) {
      lines.push('- Feature overlap checks:');
      overlapRows.forEach((row) => {
        lines.push(`  - ${row.featureA} x ${row.featureB}: overlap=${row.overlapTotal ?? 'n/a'}, c90=${row.overlapCross90 ?? 'n/a'}, rate90=${pct(row.overlapCross90Rate, 2)}, jaccard=${fmt(row.jaccard, 3)}`);
      });
    }
    if (leakyRows.length) {
      lines.push('- Max-over-run diagnostics only:');
      leakyRows.forEach((row) => {
        const s = row.summary || {};
        lines.push(`  - ${row.name}: verdict=${s.verdict || 'n/a'}, n=${s.total ?? 'n/a'}, c90=${s.crossed90 ?? 'n/a'}, lift90=${fmt(s.lift90, 2)}`);
      });
    }
    lines.push('');
  }

  if (earlySignalFirstHitReplay.summary) {
    const replay = earlySignalFirstHitReplay.summary || {};
    const combos = topArray(earlySignalFirstHitReplay.byCombo, 6);
    lines.push('0b10c. Early-Signal First-Hit Replay');
    lines.push('-------------------------------------');
    lines.push('- Mode: report-only; enters at the first price-bearing pre60 snapshot where a signal combo is true, then applies the same conservative 300s TP/SL/slippage profile.');
    lines.push(`- Rows=${replay.rows ?? 'n/a'}, combos=${replay.combos ?? 'n/a'}, best=${replay.bestCombo || 'n/a'} verdict=${replay.bestComboVerdict || 'n/a'}, pnl=${sol(replay.bestComboPnlSol, 6)}.`);
    lines.push(`- Recommendation: ${replay.recommendation || 'n/a'}; promising=${Array.isArray(replay.promisingCombos) && replay.promisingCombos.length ? replay.promisingCombos.join(', ') : 'none'}.`);
    if (combos.length) {
      lines.push('- Combo replay summaries:');
      combos.forEach((row) => {
        const s = row.summary || {};
        lines.push(`  - ${row.combo}: verdict=${s.verdict || 'n/a'}, candidates=${s.candidates ?? 'n/a'}, replayed=${s.replayed ?? 'n/a'}, wins/losses=${s.wins ?? 'n/a'}/${s.losses ?? 'n/a'}, c90=${s.crossed90 ?? 'n/a'}, pnl=${sol(s.pnlSol, 6)}, median=${sol(s.medianPnlSol, 6)}, top3Removed=${sol(s.pnlWithoutTop3Sol, 6)}`);
      });
    }
    lines.push('');
  }

  if (earlySignalEntryTimingReplay.summary) {
    const timing = earlySignalEntryTimingReplay.summary || {};
    const modes = topArray(earlySignalEntryTimingReplay.byMode, 6);
    lines.push('0b10d. Early-Signal Entry-Timing Replay');
    lines.push('----------------------------------------');
    lines.push('- Mode: report-only; tests raw-untrusted pre85 wallet signal timing variants: first hit, confirmation delays, curve-advancing hit, and last pre60 hit.');
    lines.push(`- Rows=${timing.rows ?? 'n/a'}, modes=${timing.modes ?? 'n/a'}, best=${timing.bestMode || 'n/a'} verdict=${timing.bestModeVerdict || 'n/a'}, pnl=${sol(timing.bestModePnlSol, 6)}.`);
    lines.push(`- Recommendation: ${timing.recommendation || 'n/a'}; promising=${Array.isArray(timing.promisingModes) && timing.promisingModes.length ? timing.promisingModes.join(', ') : 'none'}.`);
    if (modes.length) {
      lines.push('- Timing replay summaries:');
      modes.forEach((row) => {
        const s = row.summary || {};
        lines.push(`  - ${row.mode}: verdict=${s.verdict || 'n/a'}, candidates=${s.candidates ?? 'n/a'}, replayed=${s.replayed ?? 'n/a'}, wins/losses=${s.wins ?? 'n/a'}/${s.losses ?? 'n/a'}, c90=${s.crossed90 ?? 'n/a'}, pnl=${sol(s.pnlSol, 6)}, median=${sol(s.medianPnlSol, 6)}, top3Removed=${sol(s.pnlWithoutTop3Sol, 6)}`);
      });
    }
    lines.push('');
  }

  if (originPathAutopsy.summary) {
    const origin = originPathAutopsy.summary || {};
    const comparable = originPathAutopsy.replayComparableSummary || {};
    const rows = topArray(originPathAutopsy.rows, 5);
    lines.push('0b11. Origin Path Autopsy');
    lines.push('-------------------------');
    lines.push('- Mode: report-only; isolates the highConvictionFirstSight / positive-wallet path that produced the latest real paper winner and audits near misses.');
    lines.push(`- Verdict: ${origin.verdict || 'n/a'}; rows=${origin.rows ?? 'n/a'}, uniqueMints=${origin.uniqueMints ?? 'n/a'}, paperEntries=${origin.paperEntries ?? 'n/a'}, nearMisses=${origin.nearMisses ?? 'n/a'}, replayed=${origin.replayed ?? 'n/a'}, wins/losses=${origin.wins ?? 'n/a'}/${origin.losses ?? 'n/a'}, pnl=${sol(origin.pnlSol, 6)}, median=${sol(origin.medianPnlSol, 6)}.`);
    lines.push(`- Replay-comparable all rows: replayed=${comparable.replayed ?? 'n/a'}, wins/losses=${comparable.wins ?? 'n/a'}/${comparable.losses ?? 'n/a'}, pnl=${sol(comparable.pnlSol, 6)}, median=${sol(comparable.medianPnlSol, 6)}, top3Removed=${sol(comparable.top3RemovedPnlSol, 6)}.`);
    lines.push(`- Shape: highConviction=${origin.highConvictionRows ?? 'n/a'}, positiveWallet=${origin.positiveWalletRows ?? 'n/a'}, provenWallet=${origin.provenWalletRows ?? 'n/a'}, readiness median/p90=${fmt(origin.readinessPct?.median, 2)} / ${fmt(origin.readinessPct?.p90, 2)}, curve median/p90=${fmt(origin.curveProgress?.median, 3)} / ${fmt(origin.curveProgress?.p90, 3)}.`);
    lines.push(`- Reasons: ${formatTopCounts(origin.reasons)}.`);
    if (rows.length) {
      lines.push('- Origin-path rows:');
      rows.forEach((row, index) => {
        const walletLabel = row.wallet?.positiveOrProvenTouch ? 'positive/proven' : row.wallet?.anyTrustedTouch ? 'trusted/any' : 'none';
        lines.push(`  ${index + 1}. ${row.symbol || 'unknown'} ${row.mint || 'n/a'}: kind=${row.kind || 'n/a'}, reason=${row.reason || 'n/a'}, curve=${fmt(row.curveProgress, 3)}, readiness=${fmt(row.readinessPct, 2)}%, wallet=${walletLabel}, replay=${row.replay?.replayClass || 'n/a'}, pnl=${sol(row.replay?.pnlSol, 6)}`);
      });
    }
    lines.push('');
  }

  if (entryCandidateReview.summary) {
    const entryReviewSummary = entryCandidateReview.summary || {};
    const reviewedCandidates = topArray(entryCandidateReview.candidates, 6);
    lines.push('0c. Entry Candidate Review');
    lines.push('--------------------------');
    lines.push(`- Reviewed paper entries / wallet-shadow would-enter: ${entryReviewSummary.paperEntries ?? 'n/a'} / ${entryReviewSummary.walletShadowWouldEnter ?? 'n/a'}; paper PnL=${sol(entryReviewSummary.paperPnlSol, 6)}; unique mints=${entryReviewSummary.uniqueMints ?? 'n/a'}.`);
    if (entryReviewSummary.paperEntryWalletContext || entryReviewSummary.paperEntryCurveBands) {
      const wallet = entryReviewSummary.paperEntryWalletContext || {};
      const curves = entryReviewSummary.paperEntryCurveBands || {};
      lines.push(`- Paper-entry wallet context any/positive/avoid: ${wallet.withAny ?? 'n/a'} / ${wallet.withPositiveOrProven ?? 'n/a'} / ${wallet.withAvoidOrNegative ?? 'n/a'}; curve bands 85-90/90-95/95+=${curves.curve85to90 ?? 'n/a'} / ${curves.curve90to95 ?? 'n/a'} / ${curves.curve95plus ?? 'n/a'}.`);
    }
    lines.push(`- Verdict counts: ${formatTopCounts(entryReviewSummary.verdictCounts)}.`);
    lines.push(`- Flag counts: ${formatTopCounts(entryReviewSummary.flagCounts)}.`);
    if (reviewedCandidates.length) {
      lines.push('- Candidates:');
      reviewedCandidates.forEach((candidate, index) => lines.push(`  ${index + 1}. ${summarizeEntryCandidate(candidate)}`));
    }
    lines.push('');
  }

  if (walletSupportedNearMissReplay.summary) {
    const replaySummary = walletSupportedNearMissReplay.summary || {};
    const best = replaySummary.bestProfile ? replaySummary.byProfile?.[replaySummary.bestProfile] : null;
    const topRows = topArray(walletSupportedNearMissReplay.rows, 5);
    lines.push('0c2. Wallet-Supported Near-Miss Replay');
    lines.push('--------------------------------------');
    lines.push('- Mode: report-only; replays wallet-shadow would-enter near misses with positive wallet support and optional fresh curve confirmation. Does not alter runtime gates.');
    lines.push(`- Wallet-shadow candidates / eligible / replay rows: ${replaySummary.walletShadowWouldEnter ?? 'n/a'} / ${replaySummary.eligibleCandidates ?? 'n/a'} / ${replaySummary.replayRows ?? 'n/a'}.`);
    lines.push(`- Best profile: ${replaySummary.bestProfile || 'none'} | verdict=${replaySummary.bestProfileVerdict || 'n/a'} | trades=${best?.trades ?? 'n/a'} | wins/losses=${best?.wins ?? 'n/a'}/${best?.losses ?? 'n/a'} | pnl=${best?.totalPnlSol === null || best?.totalPnlSol === undefined ? 'n/a' : sol(best.totalPnlSol, 6)} | median=${best?.medianPnlSol === null || best?.medianPnlSol === undefined ? 'n/a' : sol(best.medianPnlSol, 6)} | top3-removed=${best?.pnlAfterRemovingTop3WinnersSol === null || best?.pnlAfterRemovingTop3WinnersSol === undefined ? 'n/a' : sol(best.pnlAfterRemovingTop3WinnersSol, 6)}.`);
    if (topRows.length) {
      lines.push('- Top replay rows:');
      topRows.forEach((row, index) => lines.push(`  ${index + 1}. ${summarizeWalletSupportedNearMissReplay(row)}`));
    }
    lines.push('');
  }

  if (sameMintReentryImpact.summary) {
    const impactSummary = sameMintReentryImpact.summary || {};
    lines.push('0d. Same-Mint Reentry Impact');
    lines.push('----------------------------');
    lines.push(`- Cooldown window: ${fmt(Number(impactSummary.cooldownMs || 0) / 1000, 0)}s; historical reentries=${impactSummary.reentryWithinCooldown ?? 'n/a'} / ${impactSummary.totalEntries ?? 'n/a'} entries; unique mints=${impactSummary.reentryUniqueMints ?? 'n/a'}.`);
    lines.push(`- Reentry PnL in scanned telemetry: ${sol(impactSummary.reentryPnlSol, 6)}; wins/losses/flat=${impactSummary.reentryWinLoss?.wins ?? 'n/a'} / ${impactSummary.reentryWinLoss?.losses ?? 'n/a'} / ${impactSummary.reentryWinLoss?.flatOrMissing ?? 'n/a'}.`);
    lines.push(`- Reentry by previous exit: ${formatTopCounts(impactSummary.reentryByPreviousExitReason)}.`);
    const windowImpacts = topArray(impactSummary.windowImpacts, 6);
    if (windowImpacts.length) {
      lines.push('- Reentry cooldown window impacts:');
      windowImpacts.forEach((row) => {
        lines.push(`  - ${fmt(Number(row.cooldownMs || 0) / 60000, 1)}m: reentries=${row.reentryWithinCooldown ?? 'n/a'}, unique=${row.reentryUniqueMints ?? 'n/a'}, pnl=${sol(row.reentryPnlSol, 6)}, wins/losses=${row.reentryWinLoss?.wins ?? 'n/a'} / ${row.reentryWinLoss?.losses ?? 'n/a'}`);
      });
    }
    const topReentries = topArray(sameMintReentryImpact.topReentries, 5);
    if (topReentries.length) {
      lines.push('- Worst/closest reentries:');
      topReentries.forEach((row, index) => lines.push(`  ${index + 1}. ${summarizeSameMintReentry(row)}`));
    }
    lines.push('');
  }

  if (breakevenStopGap.summary) {
    const gapSummary = breakevenStopGap.summary || {};
    lines.push('0e. Breakeven Stop Gap');
    lines.push('-----------------------');
    lines.push(`- BREAKEVEN_STOP exits: ${gapSummary.breakevenStops ?? 'n/a'}; losses=${gapSummary.breakevenStopLosses ?? 'n/a'}; below-entry gap losses=${gapSummary.breakevenGapLosses ?? 'n/a'}; unique mints=${gapSummary.uniqueMints ?? 'n/a'}.`);
    lines.push(`- BREAKEVEN_STOP PnL: total=${sol(gapSummary.totalPnlSol, 6)}, losses=${sol(gapSummary.lossPnlSol, 6)}; return median/p90/max=${pct(gapSummary.returnPct?.median, 2)} / ${pct(gapSummary.returnPct?.p90, 2)} / ${pct(gapSummary.returnPct?.max, 2)}.`);
    lines.push(`- Peak giveback median/p90/max=${pct(gapSummary.givebackPct?.median, 2)} / ${pct(gapSummary.givebackPct?.p90, 2)} / ${pct(gapSummary.givebackPct?.max, 2)}; exit observation gap median/p90/max=${ms(gapSummary.exitObservationGapMs?.median)} / ${ms(gapSummary.exitObservationGapMs?.p90)} / ${ms(gapSummary.exitObservationGapMs?.max)}.`);
    lines.push(`- Flags: ${formatTopCounts(gapSummary.flagCounts)}.`);
    const worstBreakevenStops = topArray(breakevenStopGap.worstBreakevenStops, 5);
    if (worstBreakevenStops.length) {
      lines.push('- Worst BREAKEVEN_STOP exits:');
      worstBreakevenStops.forEach((row, index) => lines.push(`  ${index + 1}. ${summarizeBreakevenStopGap(row)}`));
    }
    lines.push('');
  }

  if (exitProtectionReplay.summary) {
    const replaySummary = exitProtectionReplay.summary || {};
    lines.push('0f. Exit Protection Replay');
    lines.push('--------------------------');
    lines.push('- Mode: report-only observed-path stress replay; it may see more price-bearing events than the exact runtime paper-lane cadence.');
    lines.push(`- Entries / unique mints: ${replaySummary.entries ?? 'n/a'} / ${replaySummary.uniqueMints ?? 'n/a'}; current=${sol(replaySummary.currentProfilePnlSol, 6)}; best=${replaySummary.bestScenario || 'n/a'} ${sol(replaySummary.bestScenarioPnlSol, 6)}; delta=${sol(replaySummary.bestScenarioDeltaVsCurrentSol, 6)}.`);
    const scenarios = topArray(exitProtectionReplay.scenarioSummaries, 6);
    if (scenarios.length) {
      lines.push('- Scenario leaderboard:');
      scenarios.forEach((row, index) => lines.push(`  ${index + 1}. ${summarizeExitProtectionScenario(row)}`));
    }
    const examples = topArray(exitProtectionReplay.bestScenarioExamples, 3);
    if (examples.length) {
      lines.push('- Best-scenario positive deltas:');
      examples.forEach((row, index) => lines.push(`  ${index + 1}. ${summarizeExitProtectionExample(row)}`));
    }
    const trailingValidation = exitProtectionReplay.trailingGivebackMfe8Validation || {};
    if (trailingValidation.comparedEntries !== undefined) {
      lines.push(`- TRAILING_GIVEBACK MFE>=8 validation: compared=${trailingValidation.comparedEntries ?? 'n/a'} eligible=${trailingValidation.eligibleEntries ?? 'n/a'} current=${sol(trailingValidation.currentPnlSol, 6)} trailing=${sol(trailingValidation.trailingPnlSol, 6)} delta=${sol(trailingValidation.deltaPnlSol, 6)} improved/worsened/unchanged=${trailingValidation.improvedVsCurrent ?? 'n/a'} / ${trailingValidation.worsenedVsCurrent ?? 'n/a'} / ${trailingValidation.unchangedVsCurrent ?? 'n/a'} trailingW/L=${trailingValidation.trailingWins ?? 'n/a'} / ${trailingValidation.trailingLosses ?? 'n/a'} exits=${compactValue(trailingValidation.trailingExitReasonCounts)}`);
    }
    lines.push('');
  }

  if (mfeMaeCapture.summary) {
    const captureSummary = mfeMaeCapture.summary || {};
    lines.push('0g. MFE/MAE Capture Attribution');
    lines.push('--------------------------------');
    lines.push('- Mode: report-only; separates entry quality from exit capture by measuring max favorable/adverse excursion for every actual pre-migration paper entry.');
    lines.push(`- Entries / unique mints: ${captureSummary.entries ?? 'n/a'} / ${captureSummary.uniqueMints ?? 'n/a'}; total PnL=${sol(captureSummary.totalPnlSol, 6)}; wins/losses=${captureSummary.wins ?? 'n/a'} / ${captureSummary.losses ?? 'n/a'}.`);
    lines.push(`- MFE median/p90/max=${pct(captureSummary.mfePct?.median, 2)} / ${pct(captureSummary.mfePct?.p90, 2)} / ${pct(captureSummary.mfePct?.max, 2)}; MAE median/p90/min=${pct(captureSummary.maePct?.median, 2)} / ${pct(captureSummary.maePct?.p90, 2)} / ${pct(captureSummary.maePct?.min, 2)}.`);
    lines.push(`- Capture median/p90=${pct(captureSummary.captureRatio?.median, 1)} / ${pct(captureSummary.captureRatio?.p90, 1)}; high-MFE entries=${captureSummary.highMfeEntries ?? 'n/a'}, low-MFE entries=${captureSummary.lowMfeEntries ?? 'n/a'}, high-MFE gave-back-to-loss=${captureSummary.gaveBackToLossEntries ?? 'n/a'}.`);
    lines.push(`- Capture classes: ${formatTopCounts(captureSummary.captureClassCounts)}.`);
    lines.push(`- Wallet quality counts: ${formatTopCounts(captureSummary.walletQualityCounts)}.`);
    lines.push(`- Entry curve bands: ${formatTopCounts(captureSummary.entryCurveBandCounts)}.`);
    const walletCurveGroups = Object.entries(mfeMaeCapture.byWalletQualityAndCurveBand || {})
      .sort((a, b) => Number(a[1]?.totalPnlSol || 0) - Number(b[1]?.totalPnlSol || 0))
      .slice(0, 4);
    if (walletCurveGroups.length) {
      lines.push('- Worst wallet/curve groups:');
      walletCurveGroups.forEach(([key, row], index) => {
        lines.push(`  ${index + 1}. ${key}: entries=${row.entries ?? 'n/a'}, pnl=${sol(row.totalPnlSol, 6)}, wins/losses=${row.wins ?? 'n/a'} / ${row.losses ?? 'n/a'}, mfeMed=${pct(row.mfePct?.median, 2)}, maeMed=${pct(row.maePct?.median, 2)}`);
      });
    }
    const worstCapture = topArray(mfeMaeCapture.worstCapture, 4);
    if (worstCapture.length) {
      lines.push('- Worst capture rows:');
      worstCapture.forEach((row, index) => lines.push(`  ${index + 1}. ${summarizeMfeMaeCapture(row)}`));
    }
    lines.push('');
  }

  lines.push('1. Run Summary');
  lines.push('--------------');
  lines.push(`- Duration: ${duration === null ? 'n/a' : `${fmt(duration)} min`}`);
  lines.push(`- Events: ${events ?? 'n/a'}`);
  lines.push(`- Dossiers: ${dossiers ?? 'n/a'}`);
  lines.push(`- Pre-migration paper entries/exits: ${paperEntries ?? 'n/a'} / ${paperExits ?? 'n/a'}`);
  lines.push(`- Replay lane-input coverage: inputs=${eventCounts['pre_migration.lane_input'] || 0}, dropped=${eventCounts['pre_migration.lane_input_dropped'] || 0}, paper decisions=${eventCounts['pre_migration_paper.decision'] || 0}, coverage=${Number(eventCounts['pre_migration.lane_input'] || 0) >= Number(eventCounts['pre_migration_paper.decision'] || 0) ? 'ok' : 'short'}`);
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
  const meteredTradeLimitRaw = pumpPortalHealth.maxMeteredTradeEventsPerSession;
  const meteredTradeLimit = meteredTradeLimitRaw === null || meteredTradeLimitRaw === undefined
    ? null
    : Number(meteredTradeLimitRaw);
  const meteredTradeLimitLabel = meteredTradeLimit === null
    ? 'unknown'
    : meteredTradeLimit > 0 ? meteredTradeLimit : 'unlimited';
  const estimatedPumpPortalChargeSol = Math.floor((pumpPortalHealth.meteredTradeEvents || 0) / 10000) * 0.01;
  lines.push(`  - metered trade budget: events=${pumpPortalHealth.meteredTradeEvents || 0} (mint=${pumpPortalHealth.trades || 0}, account-only=${pumpPortalHealth.unmatchedAccountTrades || 0}), max=${meteredTradeLimitLabel}, reached=${pumpPortalHealth.meteredTradeBudgetReached === true}, skippedTokenSubscriptions=${pumpPortalHealth.tradeSubscriptionsSkippedBudget || 0}, skippedAccountSubscriptions=${pumpPortalHealth.accountSubscriptionsSkippedBudget || 0}, estimatedCompletedBlockCharge=${fmt(estimatedPumpPortalChargeSol, 4)} SOL`);
  if (paidTapeCoverageEpoch.coverage) {
    lines.push(`  - paid-tape coverage epoch: ${paidTapeCoverageEpoch.verdict || 'unknown'}; fullPaid=${paidTapeCoverageEpoch.coverage.fullPaidTapeMinutes ?? 'n/a'}m, discoveryRpcOnly=${paidTapeCoverageEpoch.coverage.discoveryRpcOnlyMinutes ?? 'n/a'}m, capAt=${paidTapeCoverageEpoch.coverage.budgetReachedAt || 'none'}`);
  }
  lines.push(`  - control frames sent / token subscribe / token unsubscribe / account unsubscribe: ${pumpPortalHealth.controlFramesSent || 0} / ${pumpPortalHealth.tokenTradeSubscribeFrames || 0} / ${pumpPortalHealth.tokenTradeUnsubscribeFrames || 0} / ${pumpPortalHealth.accountTradeUnsubscribeFrames || 0}`);
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
  lines.push(`  - reconnect resubscribe throttle: scheduled/sent/dropped=${pumpDevHealth.tokenTradeReconnectResubscribeScheduled || 0} / ${pumpDevHealth.tokenTradeReconnectResubscribeSent || 0} / ${pumpDevHealth.tokenTradeReconnectResubscribeDropped || 0}, cap=${pumpDevHealth.reconnectResubscribeMaxMints || 'n/a'}, batch=${pumpDevHealth.reconnectResubscribeBatchSize || 'n/a'} every ${pumpDevHealth.reconnectResubscribeBatchDelayMs || 0}ms`);
  lines.push(`  - cooldown fresh-subscribe deferral: suppressed/sent/dropped=${pumpDevHealth.tokenTradeSubscribesSuppressedDuringCooldown || 0} / ${pumpDevHealth.tokenTradeDeferredSubscribeSent || 0} / ${pumpDevHealth.tokenTradeDeferredSubscribeDropped || 0}`);
  lines.push(`  - rate-limit backoff: 1008 closes=${pumpDevHealth.rateLimitCloseEvents || 0}, cooldown=${pumpDevHealth.rateLimitCooldownMs || 0}ms, cooldownUntilMs=${pumpDevHealth.rateLimitCooldownUntilMs || 0}, stableDelayResets=${pumpDevHealth.reconnectDelayStableResets || 0} after ${pumpDevHealth.reconnectDelayResetAfterStableMs || 0}ms`);
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
  if (pumpDevSubscriptionLifecycle.summary) {
    const sub = pumpDevSubscriptionLifecycle.summary;
    lines.push('- PumpDev subscription lifecycle:');
    lines.push(`  - verdict: ${sub.verdict || 'n/a'}; candidates/requested/acked/rejected/active/cap-skips=${sub.subscribeCandidates ?? 'n/a'} / ${sub.requestedSubscriptions ?? sub.subscribeFrames ?? 'n/a'} / ${sub.acknowledgedSubscriptions ?? 'n/a'} / ${sub.rejectedSubscriptions ?? 'n/a'} / ${sub.subscribedMints ?? 'n/a'} / ${sub.skippedAtCap ?? 'n/a'}`);
    lines.push(`  - trades/acks/send-failures/queue-drops: ${sub.trades ?? 'n/a'} / ${sub.ackMessages ?? 'n/a'} / ${sub.sendFailures ?? 'n/a'} / ${sub.queueDropped ?? 'n/a'}`);
    lines.push(`  - mode/targeted requests/refreshes/evictions: ${sub.tradeSubscriptionMode || 'n/a'} / ${sub.targetedSubscriptionRequests ?? 'n/a'} / ${sub.targetedSubscriptionRefreshes ?? 'n/a'} / ${sub.targetedSubscriptionEvictions ?? 'n/a'}`);
    if (sub.featureSourceDependency?.verdict) {
      lines.push(`  - decision feature dependency: ${sub.featureSourceDependency.verdict}; pumpdev=${sub.featureSourceDependency.pumpDevFeedMode || 'n/a'}, portalBackupOnly=${sub.featureSourceDependency.pumpPortalBackupOnly ?? 'n/a'}`);
    }
    if (sub.productivity) {
      lines.push(`  - slot productivity (${sub.productivityTrust || 'unknown trust'}): slots=${sub.productivity.slots ?? 'n/a'}, zero-trade=${sub.productivity.zeroTradeSlots ?? 'n/a'}, traded=${sub.productivity.tradedSlots ?? 'n/a'}, totalTrades=${sub.productivity.totalTrades ?? 'n/a'}`);
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
  const runnerRejectReplayStress = runnerRejectEntryReplay.stressSummaryByProfile || {};
  lines.push('2c. Runner Reject Entry Replay');
  lines.push('------------------------------');
  lines.push('- Mode: report-only; simulates rejected pre-90 runner entries from later telemetry snapshots.');
  lines.push(`- Candidates: ${runnerRejectEntryReplay.inputs?.candidates ?? 'n/a'} | size SOL: ${fmt(runnerRejectEntryReplay.assumptions?.sizeSol, 4)} | fee SOL: ${fmt(runnerRejectEntryReplay.assumptions?.feeSol, 6)} | default slippage entry/exit: ${fmt(runnerRejectEntryReplay.assumptions?.defaultEntrySlippagePct, 2)}%/${fmt(runnerRejectEntryReplay.assumptions?.defaultExitSlippagePct, 2)}%`);
  const replayLines = Object.entries(runnerRejectReplayProfiles).map(([name, item]) => summarizeRunnerRejectReplayProfile(name, item));
  if (replayLines.length) replayLines.forEach((line) => lines.push(`- ${line}`));
  else lines.push('- Profiles: none');
  const bestRunnerRejectProfile = Object.entries(runnerRejectReplayProfiles)
    .sort((a, b) => Number(b[1]?.totalPnlSol || 0) - Number(a[1]?.totalPnlSol || 0))[0]?.[0];
  const bestStressRows = bestRunnerRejectProfile ? runnerRejectReplayStress[bestRunnerRejectProfile] || {} : {};
  const stressLines = Object.entries(bestStressRows).map(([name, item]) => summarizeRunnerRejectReplayStress(name, item));
  if (stressLines.length) {
    lines.push(`- Stress scenarios for best profile (${bestRunnerRejectProfile}):`);
    stressLines.forEach((line) => lines.push(`  - ${line}`));
  }
  lines.push('- Caveat: stress scenarios approximate latency, wider slippage, and missed winning fills, but still do not model MEV, exact liquidity, or broadcast landing.');
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
  const walletUntrackedSummary = walletUntrackedReview.summary || {};
  const walletLaunchIntelSummary = walletLaunchIntelBridge.summary || {};
  const walletLaunchIntelStabilitySummary = walletLaunchIntelStability.summary || {};
  const walletLaunchIntelShortlistReplaySummary = walletLaunchIntelShortlistEntryReplay.summary || {};
  const walletLaunchIntelShortlistShadowSummary = walletLaunchIntelShortlistShadow.summary || {};
  const walletUntrackedImpactSummary = walletUntrackedShadowImpact.summary || {};
  const walletLiftSummary = walletPerWalletLift.summary || {};
  const daumenSummary = walletDaumenCohort.summary || {};
  const stableTrustCandidates = topArray(walletPerWalletLift.stableTrustCandidates, 6);
  const stableAvoidCandidates = topArray(walletPerWalletLift.stableAvoidCandidates, 6);
  const untrackedManualReview = topArray(walletUntrackedReview.manualReviewNow, 5);
  const untrackedCaution = topArray(walletUntrackedReview.cautionBusyFlow, 3);
  const launchIntelManualReview = topArray(walletLaunchIntelBridge.manualReviewCandidates, 5);
  const launchIntelObserve = topArray(walletLaunchIntelBridge.observeNextRun, 5);
  const launchIntelBusy = topArray(walletLaunchIntelBridge.busyFlowRisk, 3);
  const launchIntelShortlist = topArray(walletLaunchIntelStability.repeatShortlistCandidates, 5);
  const launchIntelRepeatManual = topArray(walletLaunchIntelStability.repeatManualReviewCandidates, 5);
  const launchIntelRepeatObserve = topArray(walletLaunchIntelStability.repeatObserveNextRun, 5);
  const launchIntelShortlistWinners = topArray(walletLaunchIntelShortlistEntryReplay.topWouldWinners, 5);
  const launchIntelRuntimeShadowWinners = topArray(walletLaunchIntelShortlistShadow.topWinners, 5);
  const launchIntelRuntimeShadowProfiles = topArray(walletLaunchIntelShortlistShadow.thresholdProfiles, 5);
  const untrackedPromotionTests = topArray(walletUntrackedShadowImpact.promotionTestCandidates, 5);
  const untrackedRepeatConfirm = topArray(walletUntrackedShadowImpact.needsRepeatConfirmation, 5);
  const topDaumenWallets = topArray(walletDaumenCohort.topDaumenWallets, 8);
  const daumenUseful = topArray(walletDaumenCohort.usefulFirstTouchCandidates, 5);
  const topWalletPnl = topArray(walletPnlEvidence.topPositiveWallets, 5);

  lines.push('4b. Wallet PnL / Promotion Evidence');
  lines.push('------------------------------------');
  lines.push('- Mode: report-only; realized wallet PnL and promotion review do not mutate runtime trust tiers.');
  lines.push(`- PnL evidence wallets / proven / promising / negative: ${walletPnlSummary.wallets ?? 'n/a'} / ${walletPnlSummary.provenPositiveWallets ?? 'n/a'} / ${walletPnlSummary.promisingPositiveWallets ?? 'n/a'} / ${walletPnlSummary.negativeEvidenceWallets ?? 'n/a'}`);
  lines.push(`- Promotion review trust / profitable-needs-touch / watch / avoid / hold: ${walletPromotionSummary.trustReviewWallets ?? 'n/a'} / ${walletPromotionSummary.profitableNeedsFirstTouchEvidenceWallets ?? 'n/a'} / ${walletPromotionSummary.watchReviewWallets ?? 'n/a'} / ${walletPromotionSummary.avoidReviewWallets ?? 'n/a'} / ${walletPromotionSummary.holdWallets ?? 'n/a'}`);
  if (walletUntrackedSummary.candidates !== undefined) {
    lines.push(`- Untracked runtime wallet review queue: candidates=${walletUntrackedSummary.candidates ?? 'n/a'}, actionable=${walletUntrackedSummary.actionable ?? 'n/a'}, manualReviewNow=${walletUntrackedSummary.manualReviewNow ?? 'n/a'}; NO_TRACKED_FIRST_TOUCH_BUY near-prior=${walletUntrackedSummary.noTrackedFirstTouchBuyWithNearPriorUntrackedBuy ?? 'n/a'} / ${walletUntrackedSummary.noTrackedFirstTouchBuyDecisions ?? 'n/a'}`);
    if (untrackedManualReview.length) {
      lines.push('- Top untracked manual-review rows:');
      untrackedManualReview.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.reviewScore, 1)} | buys/sells=${item.buyRows ?? 'n/a'}/${item.sellRows ?? 'n/a'} | mints=${item.uniqueMints ?? 'n/a'} | nearPrior=${item.decisionNearPriorCount ?? 'n/a'} decisions/${item.decisionNearPriorMints ?? 'n/a'} mints | noTrackedLinks=${item.noTrackedFirstTouchBuyLinks ?? 'n/a'} | topReason=${item.topDecisionReason || 'n/a'}`);
      });
    }
    if (untrackedCaution.length) {
      lines.push('- Busy-flow caution rows, review before importing:');
      untrackedCaution.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.reviewScore, 1)} | rowsPerMint=${fmt(item.rowsPerMint, 2)} | buys=${item.buyRows ?? 'n/a'} | nearPriorLinks=${item.nearPriorBuyDecisionLinks ?? 'n/a'} | reason=${item.reasons?.[0] || 'n/a'}`);
      });
    }
    if (walletUntrackedImpactSummary.candidateWallets !== undefined) {
      lines.push(`- Untracked wallet shadow impact: candidateWallets=${walletUntrackedImpactSummary.candidateWallets ?? 'n/a'}, fullMatchWallets=${walletUntrackedImpactSummary.walletsWithRecoveryFullMatch ?? 'n/a'}, nonBusyNoTrackedLinks=${walletUntrackedImpactSummary.nonBusyCandidateNoTrackedFirstTouchBuyLinks ?? 'n/a'}, bestNonBusyFullMatch=${walletUntrackedImpactSummary.bestNonBusyFullMatchWallet || 'none'}`);
      if (untrackedPromotionTests.length) {
        lines.push('- Shadow-promotion test candidates:');
        untrackedPromotionTests.forEach((item, index) => {
          lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.reviewScore, 1)} | fullMatchRows=${item.recoveryFullMatchRows ?? 'n/a'} | noTrackedLinks=${item.noTrackedFirstTouchBuyLinks ?? 'n/a'} | rowsPerMint=${fmt(item.rowsPerMint, 2)}`);
        });
      }
      if (untrackedRepeatConfirm.length) {
        lines.push('- Needs repeat confirmation before watchlist import:');
        untrackedRepeatConfirm.forEach((item, index) => {
          lines.push(`  ${index + 1}. ${item.wallet} | class=${item.impactClass || 'n/a'} | fullMatchRows=${item.recoveryFullMatchRows ?? 'n/a'} | noTrackedLinks=${item.noTrackedFirstTouchBuyLinks ?? 'n/a'} | action=${item.suggestedAction || 'n/a'}`);
        });
      }
    }
  }
  if (walletLaunchIntelSummary.knownInLaunchIntel !== undefined) {
    lines.push(`- Launch-intel bridge: runtimeUntracked=${walletLaunchIntelSummary.runtimeUntrackedWallets ?? 'n/a'}, knownInLaunchIntel=${walletLaunchIntelSummary.knownInLaunchIntel ?? 'n/a'}, knownUnpromoted=${walletLaunchIntelSummary.knownUnpromotedCandidates ?? 'n/a'}; classes=${formatTopCounts(walletLaunchIntelSummary.classificationCounts)}.`);
    if (launchIntelManualReview.length) {
      lines.push('- Launch-intel manual-review candidates:');
      launchIntelManualReview.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.score, 1)} | runtime buys/mints=${item.runtime?.buyRows ?? 'n/a'}/${item.runtime?.uniqueMints ?? 'n/a'} | overlap=${item.runtime?.decisionOverlapMints ?? 'n/a'} | noTrackedLinks=${item.runtime?.noTrackedFirstTouchLinks ?? 'n/a'} | hist launches/buys=${item.launchIntel?.totalLaunches ?? 'n/a'}/${item.launchIntel?.totalBuyCount ?? 'n/a'} | flags=${Array.isArray(item.flags) ? item.flags.join(',') : 'n/a'}`);
      });
    }
    if (launchIntelObserve.length) {
      lines.push('- Launch-intel observe-next-run candidates:');
      launchIntelObserve.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.score, 1)} | runtime buys/mints=${item.runtime?.buyRows ?? 'n/a'}/${item.runtime?.uniqueMints ?? 'n/a'} | overlap=${item.runtime?.decisionOverlapMints ?? 'n/a'} | hist launches=${item.launchIntel?.totalLaunches ?? 'n/a'} | flags=${Array.isArray(item.flags) ? item.flags.join(',') : 'n/a'}`);
      });
    }
    if (launchIntelBusy.length) {
      lines.push('- Launch-intel busy-flow examples, do not promote blindly:');
      launchIntelBusy.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.score, 1)} | runtime rows/mints=${item.runtime?.rows ?? 'n/a'}/${item.runtime?.uniqueMints ?? 'n/a'} | hist launches/buys=${item.launchIntel?.totalLaunches ?? 'n/a'}/${item.launchIntel?.totalBuyCount ?? 'n/a'} | avgBuysLaunch=${fmt(item.launchIntel?.avgBuysPerLaunch, 2)}`);
      });
    }
  }
  if (walletLaunchIntelStabilitySummary.telemetryFilesRead !== undefined) {
    lines.push(`- Launch-intel stability: files=${walletLaunchIntelStabilitySummary.telemetryFilesRead ?? 'n/a'}, known=${walletLaunchIntelStabilitySummary.knownInLaunchIntel ?? 'n/a'}, repeat=${walletLaunchIntelStabilitySummary.repeatWallets ?? 'n/a'}, repeatDecisionOverlap=${walletLaunchIntelStabilitySummary.repeatDecisionOverlapWallets ?? 'n/a'}, repeatShortlist=${walletLaunchIntelStabilitySummary.repeatShortlistCandidates ?? 'n/a'}, repeatManual=${walletLaunchIntelStabilitySummary.repeatManualReviewCandidates ?? 'n/a'}; classes=${formatTopCounts(walletLaunchIntelStabilitySummary.classificationCounts)}.`);
    if (launchIntelShortlist.length) {
      lines.push('- Repeat launch-intel shortlist candidates:');
      launchIntelShortlist.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.score, 1)} | runs=${item.runCount ?? 'n/a'} decisionRuns=${item.decisionRunCount ?? 'n/a'} | buys=${item.buyRows ?? 'n/a'} | noTrackedLinks=${item.noTrackedFirstTouchLinks ?? 'n/a'} | hist launches/buys=${item.launchIntel?.totalLaunches ?? 'n/a'}/${item.launchIntel?.totalBuyCount ?? 'n/a'} | flags=${Array.isArray(item.flags) ? item.flags.join(',') : 'n/a'}`);
      });
    }
    if (launchIntelRepeatManual.length) {
      lines.push('- Repeat launch-intel manual-review candidates:');
      launchIntelRepeatManual.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.score, 1)} | runs=${item.runCount ?? 'n/a'} decisionRuns=${item.decisionRunCount ?? 'n/a'} | buys=${item.buyRows ?? 'n/a'} | noTrackedLinks=${item.noTrackedFirstTouchLinks ?? 'n/a'} | hist launches/buys=${item.launchIntel?.totalLaunches ?? 'n/a'}/${item.launchIntel?.totalBuyCount ?? 'n/a'} | flags=${Array.isArray(item.flags) ? item.flags.join(',') : 'n/a'}`);
      });
    }
    if (launchIntelRepeatObserve.length) {
      lines.push('- Repeat launch-intel observe-next-run candidates:');
      launchIntelRepeatObserve.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.score, 1)} | runs=${item.runCount ?? 'n/a'} decisionRuns=${item.decisionRunCount ?? 'n/a'} | noTrackedLinks=${item.noTrackedFirstTouchLinks ?? 'n/a'} | hist launches=${item.launchIntel?.totalLaunches ?? 'n/a'}`);
      });
    }
  }
  if (walletLaunchIntelShortlistReplaySummary.decisionsWithShortlistTouch !== undefined) {
    lines.push(`- Launch-intel shortlist entry replay: verdict=${walletLaunchIntelShortlistReplaySummary.verdict || 'n/a'}, decisionsWithTouch=${walletLaunchIntelShortlistReplaySummary.decisionsWithShortlistTouch ?? 'n/a'}, wouldEnter=${walletLaunchIntelShortlistReplaySummary.wouldEnter ?? 'n/a'}, noConfirm=${walletLaunchIntelShortlistReplaySummary.noGateConfirmAfterTouch ?? 'n/a'}, winRate=${pct(walletLaunchIntelShortlistReplaySummary.winRate)}, pnl=${sol(walletLaunchIntelShortlistReplaySummary.totalPnlSol)}, stressed=${sol(walletLaunchIntelShortlistReplaySummary.stressedPnlSol)}, firstHalf=${sol(walletLaunchIntelShortlistReplaySummary.firstHalfPnlSol)}, secondHalf=${sol(walletLaunchIntelShortlistReplaySummary.secondHalfPnlSol)}, top3Removed=${sol(walletLaunchIntelShortlistReplaySummary.top3RemovedPnlSol)}, shadowEligible=${walletLaunchIntelShortlistReplaySummary.shadowLaneEligible === true}.`);
    if (launchIntelShortlistWinners.length) {
      lines.push('- Top launch-intel shortlist replay winners:');
      launchIntelShortlistWinners.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.symbol || 'UNKNOWN'} ${item.mint || ''} | wallet=${item.triggerWallet || 'n/a'} | entryCurve=${fmt(item.entryCurveProgress, 4)} | exit=${item.exitReason || 'n/a'} | pnl=${sol(item.pnlSol)} | stressed=${sol(item.stressedPnlSol)}`);
      });
    }
  }
  if (walletLaunchIntelShortlistShadowSummary.shadowRows !== undefined) {
    lines.push(`- Runtime launch-intel shortlist shadow: rows=${walletLaunchIntelShortlistShadowSummary.shadowRows ?? 'n/a'}, wouldEnter=${walletLaunchIntelShortlistShadowSummary.wouldEnter ?? 'n/a'}, replayed=${walletLaunchIntelShortlistShadowSummary.replayed ?? 'n/a'}, winRate=${pct(walletLaunchIntelShortlistShadowSummary.winRate)}, pnl=${sol(walletLaunchIntelShortlistShadowSummary.totalPnlSol)}, stressed=${sol(walletLaunchIntelShortlistShadowSummary.stressedPnlSol)}.`);
    if (launchIntelRuntimeShadowProfiles.length) {
      lines.push('- Runtime launch-intel shortlist threshold profiles:');
      launchIntelRuntimeShadowProfiles.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.name} | candidates=${item.candidates ?? 'n/a'} replayed=${item.replayed ?? 'n/a'} | W/L=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'} | pnl=${sol(item.totalPnlSol)} | stressed=${sol(item.stressedPnlSol)} | top3Removed=${sol(item.top3RemovedPnlSol)}`);
      });
    }
    if (launchIntelRuntimeShadowWinners.length) {
      lines.push('- Top runtime launch-intel shortlist shadow winners:');
      launchIntelRuntimeShadowWinners.forEach((item, index) => {
        lines.push(`  ${index + 1}. ${item.symbol || 'UNKNOWN'} ${item.mint || ''} | wallet=${item.triggerWallet || 'n/a'} | curve=${fmt(item.curveProgress, 4)} | exit=${item.exitReason || 'n/a'} | pnl=${sol(item.pnlSol)} | stressed=${sol(item.stressedPnlSol)}`);
      });
    }
  }
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
  const highReadinessReject = docs.preMigrationHighReadinessRejectReplay.data || {};
  const singleGateShadow = docs.preMigrationSingleGateShadow.data || {};
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

  if (gatedCrosserFollowThrough.summary) {
    const gated = gatedCrosserFollowThrough.summary || {};
    const cohorts = topArray(gatedCrosserFollowThrough.cohorts, 6);
    const blockers = topArray(gatedCrosserFollowThrough.crosserBlockers, 6);
    lines.push('9b1. Gated Crosser Follow-through');
    lines.push('----------------------------------');
    lines.push('- Mode: report-only diagnostic. Future-crosser cohort is selected on future curve movement, so it is hypothesis-generation only and cannot directly promote a runtime shadow lane.');
    lines.push('- Metric note: MFE fields are max favorable excursion under stress assumptions, not a realizable exit simulation.');
    lines.push(`- Verdict: ${gated.verdict || 'n/a'}; rows=${gated.rows ?? 'n/a'}, unique=${gated.uniqueMints ?? 'n/a'}, crosserMeasured=${gated.crosserMeasured ?? 'n/a'} / unique=${gated.crosserMeasuredUniqueMints ?? 'n/a'}, crosserMedianMFE=${sol(gated.crosserMedianMfePnlSol, 6)}, crosserExTop3MeanMFE=${sol(gated.crosserMfePnlAfterRemovingTop3WinnersMeanSol, 6)}.`);
    const medianDelta = gated.medianMfePnlDeltaVsControlSol === null || gated.medianMfePnlDeltaVsControlSol === undefined
      ? 'n/a'
      : sol(gated.medianMfePnlDeltaVsControlSol, 6);
    const exTop3Delta = gated.exTop3MeanMfePnlDeltaVsControlSol === null || gated.exTop3MeanMfePnlDeltaVsControlSol === undefined
      ? 'n/a'
      : sol(gated.exTop3MeanMfePnlDeltaVsControlSol, 6);
    lines.push(`- Control: measured=${gated.controlMeasured ?? 'n/a'} / unique=${gated.controlMeasuredUniqueMints ?? 'n/a'}, medianMFE=${sol(gated.controlMedianMfePnlSol, 6)}, exTop3MeanMFE=${sol(gated.controlMfePnlAfterRemovingTop3WinnersMeanSol, 6)}, deltaMedian=${medianDelta}, deltaExTop3Mean=${exTop3Delta}.`);
    lines.push(`- Cohorts: ${formatTopCounts(gated.cohortCounts)}.`);
    if (cohorts.length) {
      lines.push('- Cohort summaries:');
      cohorts.forEach((row) => {
        lines.push(`  - ${row.label}: verdict=${row.verdict || 'n/a'}, rows=${row.rows ?? 'n/a'}, unique=${row.uniqueMints ?? 'n/a'}, measured=${row.measured ?? 'n/a'}, mfePositive/non=${row.mfePositiveCount ?? 'n/a'}/${row.mfeNonPositiveCount ?? 'n/a'}, medianMFE=${sol(row.medianMfePnlSol, 6)}, exTop3MeanMFE=${sol(row.mfePnlAfterRemovingTop3WinnersMeanSol, 6)}, cross85/90_120=${row.crossed85Within120s ?? 'n/a'}/${row.crossed90Within120s ?? 'n/a'}.`);
      });
    }
    if (blockers.length) {
      lines.push('- Future-crosser blockers, descriptive only:');
      blockers.forEach((row) => {
        lines.push(`  - ${row.label}: rows=${row.rows ?? 'n/a'}, unique=${row.uniqueMints ?? 'n/a'}, measured=${row.measured ?? 'n/a'}, medianMFE=${sol(row.medianMfePnlSol, 6)}, exTop3MeanMFE=${sol(row.mfePnlAfterRemovingTop3WinnersMeanSol, 6)}.`);
      });
    }
    lines.push('');
  }

  if (crosserPrecursorDiscovery.summary) {
    const precursor = crosserPrecursorDiscovery.summary || {};
    const pinned = crosserPrecursorDiscovery.pinnedConfirmation || {};
    const candidates = topArray(crosserPrecursorDiscovery.candidateSlices, 5);
    const pinnedCandidates = topArray(pinned.candidates, 3);
    const singles = topArray(crosserPrecursorDiscovery.singleThresholds, 5);
    lines.push('9b2. Crosser Precursor Discovery');
    lines.push('---------------------------------');
    lines.push('- Mode: report-only; bounded decision-time feature search. Future-crosser labels are hypothesis-generation only.');
    lines.push(`- Verdict: ${precursor.verdict || 'n/a'}; rows=${precursor.rows ?? 'n/a'}, futureCrossers=${precursor.futureCrossers ?? 'n/a'}, controls=${precursor.controls ?? 'n/a'}, baseCrossRate=${pct(precursor.baseCrossRate, 1)}.`);
    lines.push(`- Hypotheses tested: total=${precursor.hypothesesTested ?? 'n/a'}, singles=${precursor.singleThresholdHypotheses ?? 'n/a'}, conjunctions=${precursor.conjunctionHypotheses ?? 'n/a'}; candidateSlices=${precursor.candidateSlices ?? 'n/a'}, runsUntilPark=${precursor.runsUntilPark ?? 'n/a'}.`);
    lines.push(`- Pinned OOS confirmation: ${pinned.verdict || precursor.pinnedConfirmationVerdict || 'n/a'}; pinnedAt=${pinned.pinnedAt || 'n/a'}, rows=${pinned.rows ?? 'n/a'}, baseCrossRate=${pct(pinned.baseCrossRate, 1)}, pass/fail=${pinned.passCount ?? 'n/a'}/${pinned.failCount ?? 'n/a'}.`);
    if (pinnedCandidates.length) {
      lines.push('- Pinned candidates:');
      pinnedCandidates.forEach((row, index) => {
        const replay = row.replay || {};
        const enrichment = row.enrichmentVsBaseRate === null || row.enrichmentVsBaseRate === undefined
          ? 'n/a'
          : `${fmt(row.enrichmentVsBaseRate, 2)}x`;
        const medianPnl = replay.medianPnlSol === null || replay.medianPnlSol === undefined
          ? 'n/a'
          : sol(replay.medianPnlSol, 6);
        const exTop3Mean = replay.pnlAfterRemovingTop3WinnersMeanSol === null || replay.pnlAfterRemovingTop3WinnersMeanSol === undefined
          ? 'n/a'
          : sol(replay.pnlAfterRemovingTop3WinnersMeanSol, 6);
        lines.push(`  ${index + 1}. ${row.pinnedLabel || row.label || 'unknown'} | verdict=${row.confirmationVerdict || 'n/a'}, matched=${row.matchedUniqueMints ?? row.matched ?? 'n/a'}, enrich=${enrichment}, medianPnl=${medianPnl}, exTop3Mean=${exTop3Mean}`);
      });
    }
    if (candidates.length) {
      lines.push('- Candidate slices, report-only:');
      candidates.forEach((row, index) => {
        const replay = row.replay || {};
        lines.push(`  ${index + 1}. ${row.label || 'unknown'} | matched=${row.matchedUniqueMints ?? row.matched ?? 'n/a'}, enrich=${fmt(row.enrichmentVsBaseRate, 2)}x, precision=${pct(row.precision, 1)}, medianPnl=${sol(replay.medianPnlSol, 6)}, exTop3Mean=${sol(replay.pnlAfterRemovingTop3WinnersMeanSol, 6)}`);
      });
    } else if (singles.length) {
      lines.push('- Top single-threshold precursors:');
      singles.forEach((row, index) => {
        const replay = row.replay || {};
        lines.push(`  ${index + 1}. ${row.label || 'unknown'} | matched=${row.matchedUniqueMints ?? row.matched ?? 'n/a'}, enrich=${fmt(row.enrichmentVsBaseRate, 2)}x, precision=${pct(row.precision, 1)}, medianPnl=${sol(replay.medianPnlSol, 6)}, exTop3Mean=${sol(replay.pnlAfterRemovingTop3WinnersMeanSol, 6)}`);
      });
    }
    lines.push('');
  }

  lines.push('9b3. Pre-Migration Entry Gate Margin');
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

  if (highReadinessReject.summary) {
    const rejectSummary = highReadinessReject.summary || {};
    const topProfiles = topArray(highReadinessReject.rankings, 8);
    lines.push('9b2b. High-Readiness Reject Replay');
    lines.push('----------------------------------');
    lines.push('- Mode: report-only; replays first matching high-readiness rejected decision per mint with observed later curve-price snapshots. Does not alter runtime gates.');
    lines.push(`- Skipped decisions / unique mints: ${rejectSummary.skippedDecisions ?? 'n/a'} / ${rejectSummary.uniqueSkippedMints ?? 'n/a'}`);
    lines.push(`- Readiness pct median/p90/max: ${fmt(rejectSummary.readinessPct?.median, 2)}% / ${fmt(rejectSummary.readinessPct?.p90, 2)}% / ${fmt(rejectSummary.readinessPct?.max, 2)}%`);
    lines.push(`- Promising profiles: ${Array.isArray(rejectSummary.promisingProfiles) && rejectSummary.promisingProfiles.length ? rejectSummary.promisingProfiles.join(', ') : 'none'}`);
    if (topProfiles.length) {
      lines.push('- Top replay profiles:');
      topProfiles.forEach((row) => {
        lines.push(`  - ${row.name}: verdict=${row.verdict || 'n/a'}, trades=${row.trades ?? 'n/a'}, wins/losses=${row.wins ?? 'n/a'}/${row.losses ?? 'n/a'}, pnl=${sol(row.totalPnlSol, 6)}, stressed=${sol(row.stressedPnlSol, 6)}, median=${sol(row.medianPnlSol, 6)}, top3-removed=${sol(row.top3RemovedPnlSol, 6)}`);
      });
    }
    lines.push('');
  }

  const singleGateSummary = singleGateShadow.summary || {};
  const singleGatePaper = singleGateShadow.bySource?.paperDecision || {};
  const singleGateRecovery = singleGateShadow.bySource?.recoveryShadow || {};
  const singleGateSafe = singleGateSummary.safeTestCandidates || {};
  const singleGateSafeUnique = singleGateSummary.safeTestCandidatesUniqueMints || {};
  const singleGateReplay = singleGateShadow.replay || {};
  const singleGateSafeReplay = singleGateReplay.safeTestUniqueMintsByProfile || {};
  const singleGateByGateReplay = singleGateReplay.unprotectedSingleGateUniqueByGateProfile || {};
  const singleGateTop = topArray(singleGateShadow.topSafeTestCandidates, 8);
  const singleGateTopMints = topArray(singleGateShadow.topSafeTestMints, 8);

  lines.push('9b2a. Single-Gate Shadow');
  lines.push('------------------------');
  lines.push('- Mode: report-only leave-one-out diagnostic; isolates PAPER_SKIPPED and recovery-shadow rows that fail exactly one recorded gate. Does not alter entries or live behavior.');
  lines.push(`- Rows / single-gate / multi-gate / safe-test rows: ${singleGateSummary.rows ?? 'n/a'} / ${singleGateSummary.singleGateRows ?? 'n/a'} / ${singleGateSummary.multiGateRows ?? 'n/a'} / ${singleGateSummary.safeTestCandidateRows ?? 'n/a'}`);
  lines.push(`- Paper decision single/multi/safe: ${singleGatePaper.singleGateRows ?? 'n/a'} / ${singleGatePaper.multiGateRows ?? 'n/a'} / ${singleGatePaper.safeTestCandidateRows ?? 'n/a'}; recovery-shadow single/multi/safe: ${singleGateRecovery.singleGateRows ?? 'n/a'} / ${singleGateRecovery.multiGateRows ?? 'n/a'} / ${singleGateRecovery.safeTestCandidateRows ?? 'n/a'}`);
  lines.push(`- Protected vs unprotected single-gate rows: ${singleGateSummary.protectedSingleGateRows ?? 'n/a'} / ${singleGateSummary.unprotectedSingleGateRows ?? 'n/a'}`);
  lines.push(`- Safe-test follow-through rows/unique/cross90_300/rate: ${singleGateSafe.rows ?? 'n/a'} / ${singleGateSafe.uniqueMints ?? 'n/a'} / ${singleGateSafe.crossed90Within300s ?? 'n/a'} / ${singleGateSafe.crossed90Within300sRate === null || singleGateSafe.crossed90Within300sRate === undefined ? 'n/a' : pct(singleGateSafe.crossed90Within300sRate, 1)}`);
  lines.push(`- Safe-test unique-mint follow-through unique/cross90_300/rate: ${singleGateSafeUnique.uniqueMints ?? singleGateSafeUnique.rows ?? 'n/a'} / ${singleGateSafeUnique.uniqueMintsCrossed90Within300s ?? 'n/a'} / ${singleGateSafeUnique.crossed90Within300sRate === null || singleGateSafeUnique.crossed90Within300sRate === undefined ? 'n/a' : pct(singleGateSafeUnique.crossed90Within300sRate, 1)}; duplicate rows collapsed=${singleGateSafeUnique.duplicateRowsCollapsed ?? 'n/a'}`);
  lines.push(`- Safe-test curve delta 300s median/p90/max: ${fmt(singleGateSafe.curveDelta300s?.median, 4)} / ${fmt(singleGateSafe.curveDelta300s?.p90, 4)} / ${fmt(singleGateSafe.curveDelta300s?.max, 4)}`);
  const safeReplayLines = Object.entries(singleGateSafeReplay)
    .sort((a, b) => Number(b[1]?.totalPnlSol || 0) - Number(a[1]?.totalPnlSol || 0))
    .slice(0, 4);
  if (safeReplayLines.length) {
    lines.push('- Safe-test unique-mint replay:');
    safeReplayLines.forEach(([profile, row]) => {
      lines.push(`  - ${profile}: trades=${row.trades ?? 'n/a'}, unique=${row.uniqueMints ?? 'n/a'}, W/L=${row.wins ?? 'n/a'} / ${row.losses ?? 'n/a'}, pnl=${sol(row.totalPnlSol, 9)}, exTop1=${sol(row.pnlAfterRemovingTopWinnerSol, 9)}, median=${sol(row.pnlSol?.median, 9)}, exits=${compactValue(row.exitReasons)}`);
    });
  }
  const gateReplayLines = Object.entries(singleGateByGateReplay)
    .map(([gate, group]) => {
      const best = Object.entries(group.profiles || {})
        .sort((a, b) => Number(b[1]?.totalPnlSol || 0) - Number(a[1]?.totalPnlSol || 0))[0];
      return best ? { gate, group, profile: best[0], summary: best[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.summary?.totalPnlSol || 0) - Number(a.summary?.totalPnlSol || 0))
    .slice(0, 5);
  if (gateReplayLines.length) {
    lines.push('- Best unique-mint replay by unprotected single gate:');
    gateReplayLines.forEach((item) => {
      lines.push(`  - ${item.gate}: profile=${item.profile}, gateRows=${item.group.rows ?? 'n/a'}, unique=${item.group.uniqueMints ?? 'n/a'}, trades=${item.summary.trades ?? 'n/a'}, W/L=${item.summary.wins ?? 'n/a'} / ${item.summary.losses ?? 'n/a'}, pnl=${sol(item.summary.totalPnlSol, 9)}, exTop1=${sol(item.summary.pnlAfterRemovingTopWinnerSol, 9)}, median=${sol(item.summary.pnlSol?.median, 9)}`);
    });
  }
  lines.push('- Single-gate counts:');
  objectLines(singleGateSummary.singleGateCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Protected single-gate counts:');
  objectLines(singleGateSummary.protectedSingleGateCounts, 6).forEach((line) => lines.push(`  - ${line}`));
  if (singleGateTop.length) {
    lines.push('- Top safe-test candidates:');
    singleGateTop.forEach((item, index) => {
      const w300 = item.window300s || {};
      const margin = item.margin || {};
      lines.push(`  ${index + 1}. ${candidateLabel(item)} | gate=${item.singleGate || 'n/a'} | protected=${item.protectedGate === true} | ready=${fmt(item.readinessPct, 2)}% | gap=${fmt(margin.absoluteGap, 4)} | curve=${fmt(item.curveProgress, 4)} | max300=${fmt(w300.maxCurveProgress, 4)} | cross90_300=${w300.crossed90AfterSkip === true}`);
    });
  } else {
    lines.push('- Top safe-test candidates: none');
  }
  if (singleGateTopMints.length) {
    lines.push('- Top safe-test unique mints:');
    singleGateTopMints.forEach((item, index) => {
      const w300 = item.window300s || {};
      const margin = item.margin || {};
      lines.push(`  ${index + 1}. ${candidateLabel(item)} | gate=${item.singleGate || 'n/a'} | ready=${fmt(item.readinessPct, 2)}% | gap=${fmt(margin.absoluteGap, 4)} | curve=${fmt(item.curveProgress, 4)} | max300=${fmt(w300.maxCurveProgress, 4)} | cross90_300=${w300.crossed90AfterSkip === true}`);
    });
  }
  lines.push('');

  const curveAdvanceSummary = curveAdvanceDiagnostic.summary || {};
  const curveAdvanceReplay = curveAdvanceDiagnostic.replay || {};
  const curveAdvanceFalseNegatives = topArray(curveAdvanceDiagnostic.topLikelyFalseNegatives, 8);
  const curveAdvanceClosest = topArray(curveAdvanceDiagnostic.closestThresholdMisses, 8);
  const curveAdvanceActionable = topArray(curveAdvanceDiagnostic.topActionableDataConcerns, 8);

  lines.push('9b4. CURVE_NOT_ADVANCING Diagnostic');
  lines.push('-----------------------------------');
  lines.push('- Mode: report-only; compares curve-stall gate deltas with later curve/price follow-through.');
  lines.push(`- Decisions / unique mints: ${curveAdvanceSummary.decisions ?? 'n/a'} / ${curveAdvanceSummary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Near-threshold decisions >=80% / likely false negatives 120s / flat blocks: ${curveAdvanceSummary.nearThresholdDecisions80Pct ?? 'n/a'} / ${curveAdvanceSummary.likelyFalseNegativeDecisions120s ?? 'n/a'} / ${curveAdvanceSummary.correctlyBlockedFlat120s ?? 'n/a'}`);
  lines.push(`- Crossed 85/90 within 120s: ${curveAdvanceSummary.crossed85Within120s ?? 'n/a'} / ${curveAdvanceSummary.crossed90Within120s ?? 'n/a'}; within 300s: ${curveAdvanceSummary.crossed85Within300s ?? 'n/a'} / ${curveAdvanceSummary.crossed90Within300s ?? 'n/a'}`);
  lines.push(`- Readiness pct median/p90/max: ${fmt(curveAdvanceSummary.readinessPct?.median, 2)}% / ${fmt(curveAdvanceSummary.readinessPct?.p90, 2)}% / ${fmt(curveAdvanceSummary.readinessPct?.max, 2)}%`);
  lines.push(`- Curve delta 120s median/p90/max: ${fmt(curveAdvanceSummary.curveDelta120s?.median, 4)} / ${fmt(curveAdvanceSummary.curveDelta120s?.p90, 4)} / ${fmt(curveAdvanceSummary.curveDelta120s?.max, 4)}`);
  if (curveAdvanceSummary.curveEvidenceVerdictCounts) {
    lines.push('- Curve evidence verdicts:');
    objectLines(curveAdvanceSummary.curveEvidenceVerdictCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  }
  if (curveAdvanceSummary.walletBucketCounts) {
    const walletContext = curveAdvanceSummary.walletContext || {};
    lines.push(`- Wallet buckets: touched/positive/avoid=${walletContext.touched ?? 'n/a'} / ${walletContext.positiveOrProven ?? 'n/a'} / ${walletContext.avoidOrNegative ?? 'n/a'}; ${objectLines(curveAdvanceSummary.walletBucketCounts, 4).join(', ') || 'n/a'}`);
  }
  if (curveAdvanceSummary.targetedParityNearDecision) {
    const parity = curveAdvanceSummary.targetedParityNearDecision;
    lines.push(`- Targeted parity near decision: samples=${parity.decisionsWithSample ?? 'n/a'}, absDelta median/p90/max=${fmt(parity.absCurveDelta?.median, 4)} / ${fmt(parity.absCurveDelta?.p90, 4)} / ${fmt(parity.absCurveDelta?.max, 4)}, fetchErrors=${parity.fetchErrors ?? 'n/a'}`);
  }
  const curveLikelyReplay = Object.entries(curveAdvanceReplay.likelyFalseNegativeUniqueByProfile || {})
    .sort((a, b) => Number(b[1]?.totalPnlSol || 0) - Number(a[1]?.totalPnlSol || 0))
    .slice(0, 4);
  if (curveLikelyReplay.length) {
    lines.push('- Likely false-negative unique-mint replay:');
    curveLikelyReplay.forEach(([profile, row]) => {
      lines.push(`  - ${profile}: trades=${row.trades ?? 'n/a'}, unique=${row.uniqueMints ?? 'n/a'}, W/L=${row.wins ?? 'n/a'} / ${row.losses ?? 'n/a'}, pnl=${sol(row.totalPnlSol, 9)}, exTop1=${sol(row.pnlAfterRemovingTopWinnerSol, 9)}, exTop3=${sol(row.pnlAfterRemovingTop3WinnersSol, 9)}, median=${sol(row.pnlSol?.median, 9)}, exits=${compactValue(row.exitReasons)}`);
    });
  }
  const curveNearReplay = Object.entries(curveAdvanceReplay.nearThresholdUniqueByProfile || {})
    .sort((a, b) => Number(b[1]?.totalPnlSol || 0) - Number(a[1]?.totalPnlSol || 0))
    .slice(0, 2);
  if (curveNearReplay.length) {
    lines.push('- Near-threshold unique-mint replay:');
    curveNearReplay.forEach(([profile, row]) => {
      lines.push(`  - ${profile}: trades=${row.trades ?? 'n/a'}, unique=${row.uniqueMints ?? 'n/a'}, W/L=${row.wins ?? 'n/a'} / ${row.losses ?? 'n/a'}, pnl=${sol(row.totalPnlSol, 9)}, exTop1=${sol(row.pnlAfterRemovingTopWinnerSol, 9)}, median=${sol(row.pnlSol?.median, 9)}`);
    });
  }
  lines.push('- Classification counts:');
  objectLines(curveAdvanceSummary.classificationCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (curveAdvanceFalseNegatives.length) {
    lines.push('- Top likely false negatives:');
    curveAdvanceFalseNegatives.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeCurveAdvanceDiagnostic(item)}`));
  } else {
    lines.push('- Top likely false negatives: none');
  }
  if (curveAdvanceActionable.length) {
    lines.push('- Top actionable data concerns:');
    curveAdvanceActionable.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeCurveAdvanceDiagnostic(item)}`));
  } else {
    lines.push('- Top actionable data concerns: none');
  }
  if (curveAdvanceClosest.length) {
    lines.push('- Closest threshold misses:');
    curveAdvanceClosest.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeCurveAdvanceDiagnostic(item)}`));
  }
  lines.push('');

  const separabilitySummary = curveNotAdvancingSeparability.summary || {};
  const separabilityConcentration = curveNotAdvancingSeparability.concentration || {};
  const mintFirstHit = curveNotAdvancingSeparability.mintFirstHit || {};
  const mintFirstHitTopSeparators = topArray(mintFirstHit.topSeparators, 5);
  const ageBandSeparabilityRows = topArray(curveNotAdvancingSeparability.ageBandSeparability, 8);
  const topSeparators = topArray(curveNotAdvancingSeparability.topSeparators, 8);
  const featureRows = topArray(curveNotAdvancingSeparability.features, 8);
  lines.push('9b3a. CURVE_NOT_ADVANCING Separability');
  lines.push('--------------------------------------');
  lines.push('- Mode: report-only; compares decision-time features for strong follow-through vs correctly blocked flat CURVE_NOT_ADVANCING rows.');
  lines.push(`- Verdict: ${separabilitySummary.verdict || 'n/a'}; strong/useful/flat rows=${separabilitySummary.strongFollowThroughRows ?? 'n/a'} / ${separabilitySummary.usefulFollowThroughRows ?? 'n/a'} / ${separabilitySummary.correctlyBlockedFlatRows ?? 'n/a'}; unique mints=${separabilitySummary.uniqueStrongMints ?? 'n/a'} / ${separabilitySummary.uniqueUsefulMints ?? 'n/a'} / ${separabilitySummary.uniqueFlatMints ?? 'n/a'}.`);
  lines.push(`- Mint-first-hit view: decisions=${separabilitySummary.mintFirstHitDecisions ?? 'n/a'}, strong/useful/flat=${separabilitySummary.mintFirstHitStrongMints ?? 'n/a'} / ${separabilitySummary.mintFirstHitUsefulMints ?? 'n/a'} / ${separabilitySummary.mintFirstHitFlatMints ?? 'n/a'}; row duplicate collapse=${separabilityConcentration.allRows?.duplicateRowsCollapsed ?? 'n/a'}.`);
  lines.push(`- Row concentration: all top1/top3=${pct(separabilityConcentration.allRows?.topMintRowShare, 1)} / ${pct(separabilityConcentration.allRows?.top3MintRowShare, 1)}; strong top1/top3=${pct(separabilityConcentration.strongRows?.topMintRowShare, 1)} / ${pct(separabilityConcentration.strongRows?.top3MintRowShare, 1)}.`);
  lines.push(`- Strong wallet buckets: ${formatTopCounts(separabilitySummary.strongWalletBuckets)}; flat wallet buckets: ${formatTopCounts(separabilitySummary.flatWalletBuckets)}.`);
  lines.push(`- Curve delta 120s strong median/p90/max: ${fmt(separabilitySummary.strongCurveDelta120s?.median, 4)} / ${fmt(separabilitySummary.strongCurveDelta120s?.p90, 4)} / ${fmt(separabilitySummary.strongCurveDelta120s?.max, 4)}; flat median/p90/max: ${fmt(separabilitySummary.flatCurveDelta120s?.median, 4)} / ${fmt(separabilitySummary.flatCurveDelta120s?.p90, 4)} / ${fmt(separabilitySummary.flatCurveDelta120s?.max, 4)}.`);
  if (topSeparators.length) {
    lines.push('- Potential separators:');
    topSeparators.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.key || item.label || 'unknown'} | score=${fmt(item.separationScore, 4)} | dir=${item.bestDirection || 'n/a'} | strongMed=${fmt(item.strong?.median, 4)} | flatMed=${fmt(item.flat?.median, 4)} | iqrOverlap=${fmt(item.iqrOverlap, 4)}`);
    });
  } else {
    lines.push('- Potential separators: none above threshold.');
  }
  if (mintFirstHitTopSeparators.length) {
    lines.push('- Mint-first-hit potential separators:');
    mintFirstHitTopSeparators.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.key || item.label || 'unknown'} | score=${fmt(item.separationScore, 4)} | dir=${item.bestDirection || 'n/a'} | strongMed=${fmt(item.strong?.median, 4)} | flatMed=${fmt(item.flat?.median, 4)} | iqrOverlap=${fmt(item.iqrOverlap, 4)}`);
    });
  } else {
    lines.push('- Mint-first-hit potential separators: none above threshold.');
  }
  if (ageBandSeparabilityRows.length) {
    lines.push('- Age-banded mint-first-hit separability:');
    ageBandSeparabilityRows.forEach((band) => {
      const best = Array.isArray(band.topSeparators) ? band.topSeparators[0] : null;
      lines.push(`  - ${band.band || 'unknown'}: strong/flat rows=${band.strongRows ?? 'n/a'} / ${band.flatRows ?? 'n/a'}, mints=${band.strongUniqueMints ?? 'n/a'} / ${band.flatUniqueMints ?? 'n/a'}, best=${best ? `${best.key || best.label}:${fmt(best.separationScore, 4)} ${best.bestDirection || ''}` : 'none'}`);
    });
  }
  if (featureRows.length) {
    lines.push('- Top feature scores:');
    featureRows.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.key || item.label || 'unknown'} | score=${fmt(item.separationScore, 4)} | dir=${item.bestDirection || 'n/a'} | strongMed=${fmt(item.strong?.median, 4)} | flatMed=${fmt(item.flat?.median, 4)}`);
    });
  }
  lines.push('');

  const separatorShadowSummary = curveNotAdvancingSeparatorShadow.summary || {};
  const separatorRuntimeShadow = curveNotAdvancingSeparatorShadow.runtimeShadow || {};
  const separatorShadowRanked = topArray(curveNotAdvancingSeparatorShadow.rankedRuns, 8);
  const separatorShadowRobust = topArray(curveNotAdvancingSeparatorShadow.robustPositiveRuns, 8);
  const separatorShadowSamples = curveNotAdvancingSeparatorShadow.bestRunSamples || {};

  lines.push('9b3b. CURVE_NOT_ADVANCING Separator Shadow');
  lines.push('------------------------------------------');
  lines.push('- Mode: report-only; replays candidate separator rules against observed price paths. No runtime gates are changed.');
  lines.push(`- Verdict: ${separatorShadowSummary.verdict || 'n/a'}; analyzed rows=${separatorShadowSummary.analyzedRows ?? 'n/a'}; rules/profile tests=${separatorShadowSummary.evaluatedRuleProfileCount ?? 'n/a'}; robust positive=${separatorShadowSummary.robustPositiveCount ?? 'n/a'}.`);
  if (separatorRuntimeShadow.rows !== undefined) {
    lines.push(`- Runtime shadow telemetry: rows=${separatorRuntimeShadow.rows ?? 'n/a'}; wouldEnter/wouldSkip=${separatorRuntimeShadow.wouldEnterRows ?? 'n/a'} / ${separatorRuntimeShadow.wouldSkipRows ?? 'n/a'}; unique would-enter mints=${separatorRuntimeShadow.uniqueWouldEnterMints ?? 'n/a'}; top skip reasons=${formatTopCounts(separatorRuntimeShadow.topSkipReasons)}.`);
    lines.push(`- Runtime shadow concentration: would-enter top1/top3=${pct(separatorRuntimeShadow.wouldEnterConcentration?.topMintRowShare, 1)} / ${pct(separatorRuntimeShadow.wouldEnterConcentration?.top3MintRowShare, 1)}; duplicate rows collapsed=${separatorRuntimeShadow.wouldEnterConcentration?.duplicateRowsCollapsed ?? 'n/a'}.`);
  }
  if (separatorShadowSummary.bestRun) {
    const best = separatorShadowSummary.bestRun;
    lines.push(`- Best run: ${best.rule || 'n/a'} / ${best.exitProfile || 'n/a'} | matchedRows/mints=${best.matchedRows ?? 'n/a'} / ${best.matchedUniqueMints ?? 'n/a'} | trades=${best.replayedTrades ?? 'n/a'} | pnl=${sol(best.totalPnlSol, 4)} | median=${sol(best.medianPnlSol, 4)} | exTop3=${sol(best.pnlAfterRemovingTop3WinnersSol, 4)} | topMintShare=${pct(best.topMintRowShare, 1)} | eligible=${best.promotionEligible === true ? 'yes' : 'no'}.`);
  } else {
    lines.push('- Best run: n/a');
  }
  if (separatorShadowRobust.length) {
    lines.push('- Robust positive runs:');
    separatorShadowRobust.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.rule || 'unknown'} / ${item.exitProfile || 'unknown'} | trades=${item.replayedTrades ?? 'n/a'} | winRate=${pct(item.winRate, 1)} | pnl=${sol(item.totalPnlSol, 4)} | exTop3=${sol(item.pnlAfterRemovingTop3WinnersSol, 4)}`);
    });
  } else {
    lines.push('- Robust positive runs: none');
  }
  if (separatorShadowRanked.length) {
    lines.push('- Top ranked shadow tests:');
    separatorShadowRanked.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.rule || 'unknown'} / ${item.exitProfile || 'unknown'} | trades=${item.replayedTrades ?? 'n/a'} | winRate=${pct(item.winRate, 1)} | pnl=${sol(item.totalPnlSol, 4)} | median=${sol(item.medianPnlSol, 4)} | exTop3=${sol(item.pnlAfterRemovingTop3WinnersSol, 4)}`);
    });
  }
  if (Array.isArray(separatorShadowSamples.topWinners) && separatorShadowSamples.topWinners.length) {
    lines.push('- Best-run top winners/losers are captured in the JSON report for mint-level inspection.');
  }
  lines.push('');

  const separatorLedgerSummary = curveNotAdvancingSeparatorShadowLedger.summary || {};
  const separatorLedgerHypothesis = curveNotAdvancingSeparatorShadowLedger.hypothesis || {};
  const separatorLedgerOut = separatorLedgerSummary.outOfSample || {};
  const separatorLedgerBackfill = separatorLedgerSummary.backfill || {};
  const separatorLedgerPromotion = separatorLedgerSummary.promotion || {};

  lines.push('9b3c. Pre-Registered Separator Shadow Ledger');
  lines.push('---------------------------------------------');
  lines.push('- Mode: report-only cumulative ledger for the frozen CURVE_NOT_ADVANCING separator hypothesis. Promotion checks use out-of-sample rows only.');
  lines.push(`- Hypothesis: ${separatorLedgerHypothesis.rule || 'n/a'} / ${separatorLedgerHypothesis.exitProfile || 'n/a'}; preRegisteredAt=${curveNotAdvancingSeparatorShadowLedger.preRegisteredAt || 'n/a'}.`);
  lines.push(`- Verdict: ${separatorLedgerSummary.verdict || 'n/a'}; status=${separatorLedgerSummary.hypothesisStatus || 'n/a'}; eligible=${separatorLedgerPromotion.eligible === true ? 'yes' : 'no'}; next=${separatorLedgerPromotion.next || 'n/a'}`);
  if (separatorLedgerSummary.hypothesisReason) {
    lines.push(`- Hypothesis reason: ${separatorLedgerSummary.hypothesisReason}`);
  }
  lines.push(`- Out-of-sample: trades=${separatorLedgerOut.trades ?? 'n/a'}, wins/losses=${separatorLedgerOut.wins ?? 'n/a'} / ${separatorLedgerOut.losses ?? 'n/a'}, winRate=${pct(separatorLedgerOut.winRate, 1)}, pnl=${sol(separatorLedgerOut.totalPnlSol, 6)}, median=${sol(separatorLedgerOut.medianPnlSol, 6)}, exTop3=${sol(separatorLedgerOut.pnlAfterRemovingTop3WinnersSol, 6)}, outlierDominated=${separatorLedgerOut.outlierDominated === undefined ? 'n/a' : separatorLedgerOut.outlierDominated}.`);
  lines.push(`- Backfill/in-sample orientation only: trades=${separatorLedgerBackfill.trades ?? 'n/a'}, wins/losses=${separatorLedgerBackfill.wins ?? 'n/a'} / ${separatorLedgerBackfill.losses ?? 'n/a'}, pnl=${sol(separatorLedgerBackfill.totalPnlSol, 6)}, median=${sol(separatorLedgerBackfill.medianPnlSol, 6)}, exTop3=${sol(separatorLedgerBackfill.pnlAfterRemovingTop3WinnersSol, 6)}.`);
  if (separatorLedgerPromotion.checks) {
    lines.push(`- Promotion checks: minTrades=${separatorLedgerPromotion.checks.minTrades ? 'pass' : 'fail'}, total=${separatorLedgerPromotion.checks.totalPnlPositive ? 'pass' : 'fail'}, median=${separatorLedgerPromotion.checks.medianPnlPositive ? 'pass' : 'fail'}, exTop3=${separatorLedgerPromotion.checks.exTop3NonNegative ? 'pass' : 'fail'}, outlier=${separatorLedgerPromotion.checks.notOutlierDominated ? 'pass' : 'fail'}, runBreadth=${separatorLedgerPromotion.checks.positiveInAtLeastHalfRuns ? 'pass' : 'fail'}.`);
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

  const curveConfirmationRanking = topArray(curveConfirmationReplay.ranking, 8);
  const curveConfirmationSlices = topArray(curveConfirmationReplay.sliceRanking, 8);
  const bestCurveConfirmationProfileName = curveConfirmationRanking[0]?.name;
  const bestCurveConfirmationProfile = bestCurveConfirmationProfileName ? curveConfirmationReplay.profiles?.[bestCurveConfirmationProfileName] : null;

  lines.push('9c2b2. Curve Confirmation Replay');
  lines.push('---------------------------------');
  lines.push('- Mode: report-only; waits for later curve confirmation after CURVE_NOT_ADVANCING/NO_PRIOR skips, then replays exits. Does not alter runtime gates.');
  lines.push(`- Telemetry files / target reasons: ${curveConfirmationReplay.inputs?.telemetryFilesRead ?? 'n/a'} / ${Array.isArray(curveConfirmationReplay.inputs?.targetReasons) ? curveConfirmationReplay.inputs.targetReasons.join(', ') : 'n/a'}`);
  if (curveConfirmationRanking.length) {
    lines.push('- Profile ranking:');
    curveConfirmationRanking.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.name}: decisions=${item.decisions ?? 'n/a'}, confirmed=${item.confirmedEntries ?? 'n/a'}, closed=${item.closed ?? 'n/a'}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, median=${sol(item.pnlStats?.median, 6)}, exits=${Object.entries(item.exitReasonCounts || {}).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
    });
  } else {
    lines.push('- Profile ranking: none');
  }
  if (curveConfirmationSlices.length) {
    lines.push('- Best ex-ante slices:');
    curveConfirmationSlices.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.profileName || 'n/a'} / ${item.name || 'n/a'}: decisions=${item.decisions ?? 'n/a'}, confirmed=${item.confirmedEntries ?? 'n/a'}, closed=${item.closed ?? 'n/a'}, kept=${pct(item.keptShare, 1)}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, median=${sol(item.pnlStats?.median, 6)}, avg=${sol(item.averagePnlSol, 6)} | ${item.description || 'n/a'}`);
    });
  }
  if (bestCurveConfirmationProfile) {
    const bestWinners = topArray(bestCurveConfirmationProfile.topWinners, 5);
    const bestLosers = topArray(bestCurveConfirmationProfile.topLosers, 5);
    lines.push(`- Best profile detail: ${bestCurveConfirmationProfileName} | ${bestCurveConfirmationProfile.profile?.description || 'n/a'}`);
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

  const curveConfirmationShadowSummary = curveConfirmationShadow.summary || {};
  const curveConfirmationShadowAll = curveConfirmationShadowSummary.all || {};
  const curveConfirmationShadowNoAvoid = curveConfirmationShadowSummary.noAvoidWalletTouch || {};
  const curveConfirmationShadowTop = topArray(curveConfirmationShadow.confirmedRows, 6);

  lines.push('9c2b3. Curve Confirmation Prospective Shadow');
  lines.push('--------------------------------------------');
  lines.push('- Mode: report-only; logs strict delayed confirmation rows during runtime after CURVE_NOT_ADVANCING skips. Does not alter runtime gates.');
  lines.push(`- Rows / would_enter / would_skip: ${curveConfirmationShadowSummary.shadowRows ?? 'n/a'} / ${curveConfirmationShadowSummary.wouldEnter ?? 'n/a'} / ${curveConfirmationShadowSummary.wouldSkip ?? 'n/a'}; entryRate=${pct(curveConfirmationShadowSummary.entryRate, 1)}`);
  lines.push(`- Unique would_enter / would_skip mints: ${curveConfirmationShadowSummary.uniqueWouldEnterMints ?? 'n/a'} / ${curveConfirmationShadowSummary.uniqueWouldSkipMints ?? 'n/a'}`);
  lines.push(`- Confirmed delta median/p90/max: ${fmt(curveConfirmationShadowAll.confirmedDelta?.median, 4)} / ${fmt(curveConfirmationShadowAll.confirmedDelta?.p90, 4)} / ${fmt(curveConfirmationShadowAll.confirmedDelta?.max, 4)}; secondsToConfirm median/p90/max=${fmt(curveConfirmationShadowAll.secondsToConfirm?.median, 1)} / ${fmt(curveConfirmationShadowAll.secondsToConfirm?.p90, 1)} / ${fmt(curveConfirmationShadowAll.secondsToConfirm?.max, 1)}`);
  lines.push(`- No-avoid wallet slice: rows=${curveConfirmationShadowNoAvoid.rows ?? 'n/a'}, would_enter=${curveConfirmationShadowNoAvoid.wouldEnter ?? 'n/a'}, entryRate=${pct(curveConfirmationShadowNoAvoid.entryRate, 1)}, delta median/p90/max=${fmt(curveConfirmationShadowNoAvoid.confirmedDelta?.median, 4)} / ${fmt(curveConfirmationShadowNoAvoid.confirmedDelta?.p90, 4)} / ${fmt(curveConfirmationShadowNoAvoid.confirmedDelta?.max, 4)}`);
  lines.push('- Shadow reason counts:');
  objectLines(curveConfirmationShadowSummary.shadowReasonCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (curveConfirmationShadowTop.length) {
    lines.push('- Fastest confirmed rows:');
    curveConfirmationShadowTop.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${candidateLabel(item)} | score=${fmt(item.score, 2)} | sourceCurve=${fmt(item.curveProgress, 4)} | confirmCurve=${fmt(item.confirmCurveProgress, 4)} | delta=${fmt(item.curveProgressDeltaFromSource, 4)} | t=${fmt(item.secondsToConfirm, 1)}s | noAvoid=${item.noAvoidWalletTouch === true}`);
    });
  }
  lines.push('');

  const curveFalseNegativeRanking = topArray(curveFalseNegativeReplay.ranking, 8);
  const curveFalseNegativeSlices = topArray(curveFalseNegativeReplay.sliceRanking, 8);
  const bestCurveFalseNegativeProfileName = curveFalseNegativeRanking[0]?.name;
  const bestCurveFalseNegativeProfile = bestCurveFalseNegativeProfileName ? curveFalseNegativeReplay.profiles?.[bestCurveFalseNegativeProfileName] : null;

  lines.push('9c2c. Curve False-Negative Replay');
  lines.push('----------------------------------');
  lines.push('- Mode: report-only; replays CURVE_NOT_ADVANCING rows that later showed useful/strong curve follow-through. Does not alter runtime gates.');
  lines.push('- Interpretation: positive immediate-shadow PnL is hindsight-selected; treat it as pocket evidence only. Confirmation-profile slices remain median-weak, so this is not runtime-actionable yet.');
  lines.push(`- Telemetry files / target reason: ${curveFalseNegativeReplay.inputs?.telemetryFilesRead ?? 'n/a'} / ${curveFalseNegativeReplay.inputs?.targetReason || 'n/a'}`);
  lines.push('- Candidate classes:');
  objectLines(curveFalseNegativeReplay.candidateClassCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (curveFalseNegativeRanking.length) {
    lines.push('- Profile ranking:');
    curveFalseNegativeRanking.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.name}: eligible=${item.eligibleCandidates ?? 'n/a'}, entered=${item.confirmedEntries ?? 'n/a'}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, median=${sol(item.medianPnlSol, 6)}, exits=${Object.entries(item.exitReasonCounts || {}).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
    });
  } else {
    lines.push('- Profile ranking: none');
  }
  if (bestCurveFalseNegativeProfile) {
    const bestWinners = topArray(bestCurveFalseNegativeProfile.topWinners, 5);
    const bestLosers = topArray(bestCurveFalseNegativeProfile.topLosers, 5);
    lines.push(`- Best profile detail: ${bestCurveFalseNegativeProfileName} | ${bestCurveFalseNegativeProfile.profile?.description || 'n/a'}`);
    if (bestWinners.length) {
      lines.push('- Best-profile top winners:');
      bestWinners.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRelaxedGateTrade(item)}`));
    }
    if (bestLosers.length) {
      lines.push('- Best-profile top losers:');
      bestLosers.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRelaxedGateTrade(item)}`));
    }
  }
  if (curveFalseNegativeSlices.length) {
    lines.push('- Best ex-ante slices:');
    curveFalseNegativeSlices.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.profileName || 'n/a'} / ${item.name || 'n/a'}: closed=${item.closed ?? 'n/a'}, kept=${pct(item.keptShare, 1)}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, median=${sol(item.medianPnlSol, 6)}, avg=${sol(item.averagePnlSol, 6)} | ${item.description || 'n/a'}`);
    });
  }
  lines.push('');

  const curveFalseNegativeShadowSummary = curveFalseNegativeShadow.summary || {};
  const curveFalseNegativeShadowWatched = curveFalseNegativeShadowSummary.watched || {};
  const curveFalseNegativeShadowNarrowCore = curveFalseNegativeShadowSummary.narrowCore || {};
  const curveFalseNegativeShadowNarrowVolume = curveFalseNegativeShadowSummary.narrowCoreVolume || {};
  const curveFalseNegativeShadowNarrowWallet = curveFalseNegativeShadowSummary.narrowCorePositiveWallet || {};
  const curveFalseNegativeShadowTop = topArray(curveFalseNegativeShadow.watchedTopFollowThrough, 6);

  lines.push('9c2d. Curve False-Negative Prospective Shadow');
  lines.push('---------------------------------------------');
  lines.push('- Mode: report-only; measures runtime would_watch rows from the curve false-negative ex-ante filter lane. Does not alter runtime gates.');
  lines.push(`- Rows / would_watch / would_skip: ${curveFalseNegativeShadowSummary.shadowRows ?? 'n/a'} / ${curveFalseNegativeShadowSummary.wouldWatch ?? 'n/a'} / ${curveFalseNegativeShadowSummary.wouldSkip ?? 'n/a'}`);
  lines.push(`- Unique would_watch / would_skip mints: ${curveFalseNegativeShadowSummary.uniqueWouldWatchMints ?? 'n/a'} / ${curveFalseNegativeShadowSummary.uniqueWouldSkipMints ?? 'n/a'}`);
  lines.push(`- Would-watch crossed85/90 within 120s: ${curveFalseNegativeShadowWatched.crossed85Within120s ?? 'n/a'} / ${curveFalseNegativeShadowWatched.crossed90Within120s ?? 'n/a'}; within 300s: ${curveFalseNegativeShadowWatched.crossed85Within300s ?? 'n/a'} / ${curveFalseNegativeShadowWatched.crossed90Within300s ?? 'n/a'}`);
  lines.push(`- Would-watch delta120 median/p90/max: ${fmt(curveFalseNegativeShadowWatched.curveDelta120s?.median, 4)} / ${fmt(curveFalseNegativeShadowWatched.curveDelta120s?.p90, 4)} / ${fmt(curveFalseNegativeShadowWatched.curveDelta120s?.max, 4)}`);
  lines.push(`- Narrow core score>=50 curve>=30: rows=${curveFalseNegativeShadowNarrowCore.rows ?? 'n/a'}, cross85/90_120=${curveFalseNegativeShadowNarrowCore.crossed85Within120s ?? 'n/a'}/${curveFalseNegativeShadowNarrowCore.crossed90Within120s ?? 'n/a'}, delta120 med/p90/max=${fmt(curveFalseNegativeShadowNarrowCore.curveDelta120s?.median, 4)} / ${fmt(curveFalseNegativeShadowNarrowCore.curveDelta120s?.p90, 4)} / ${fmt(curveFalseNegativeShadowNarrowCore.curveDelta120s?.max, 4)}, price120 med/p90/max=${fmt(curveFalseNegativeShadowNarrowCore.maxPriceDeltaPct120s?.median, 2)}% / ${fmt(curveFalseNegativeShadowNarrowCore.maxPriceDeltaPct120s?.p90, 2)}% / ${fmt(curveFalseNegativeShadowNarrowCore.maxPriceDeltaPct120s?.max, 2)}%`);
  lines.push(`- Narrow+volume rows=${curveFalseNegativeShadowNarrowVolume.rows ?? 'n/a'}, cross85/90_120=${curveFalseNegativeShadowNarrowVolume.crossed85Within120s ?? 'n/a'}/${curveFalseNegativeShadowNarrowVolume.crossed90Within120s ?? 'n/a'}, delta120 med/p90/max=${fmt(curveFalseNegativeShadowNarrowVolume.curveDelta120s?.median, 4)} / ${fmt(curveFalseNegativeShadowNarrowVolume.curveDelta120s?.p90, 4)} / ${fmt(curveFalseNegativeShadowNarrowVolume.curveDelta120s?.max, 4)}; narrow+positive-wallet rows=${curveFalseNegativeShadowNarrowWallet.rows ?? 'n/a'}, delta120 max=${fmt(curveFalseNegativeShadowNarrowWallet.curveDelta120s?.max, 4)}`);
  lines.push('- Shadow tier counts:');
  objectLines(curveFalseNegativeShadowSummary.shadowTierCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Matched filter counts:');
  objectLines(curveFalseNegativeShadowSummary.matchedFilterCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (curveFalseNegativeShadowTop.length) {
    lines.push('- Top prospective follow-through:');
    curveFalseNegativeShadowTop.forEach((item, index) => {
      const w120 = item.windows?.['120s'] || {};
      lines.push(`  ${index + 1}. ${candidateLabel(item)} | filters=${Array.isArray(item.matchedFilters) ? item.matchedFilters.slice(0, 4).join(',') : 'n/a'} | score=${fmt(item.score, 2)} | curve=${fmt(item.curveProgress, 4)} | delta120=${fmt(w120.curveDelta, 4)} | max120=${fmt(w120.maxCurveProgress, 4)} | price120=${w120.maxPriceDeltaPct === null || w120.maxPriceDeltaPct === undefined ? 'n/a' : `${fmt(w120.maxPriceDeltaPct, 2)}%`}`);
    });
  }
  lines.push('');

  const curveFalseNegativeShadowReplayRanking = topArray(curveFalseNegativeShadowReplay.ranking, 8);
  const bestCurveFalseNegativeShadowReplayName = curveFalseNegativeShadowReplayRanking[0]?.name;
  const bestCurveFalseNegativeShadowReplay = bestCurveFalseNegativeShadowReplayName ? curveFalseNegativeShadowReplay.profiles?.[bestCurveFalseNegativeShadowReplayName] : null;

  lines.push('9c2d2. Curve False-Negative Shadow Replay');
  lines.push('-----------------------------------------');
  lines.push('- Mode: report-only; replays prospective runtime would_watch rows from the curve false-negative shadow lane. Does not alter runtime gates.');
  lines.push(`- Telemetry files / shadow rows: ${curveFalseNegativeShadowReplay.inputs?.telemetryFilesRead ?? 'n/a'} / ${curveFalseNegativeShadowReplay.inputs?.shadowRows ?? 'n/a'}`);
  lines.push(`- Base profile: amount=${sol(curveFalseNegativeShadowReplay.inputs?.baseProfile?.amountSol, 4)}, TP=${pct(curveFalseNegativeShadowReplay.inputs?.baseProfile?.takeProfitPct, 1)}, SL=${pct(curveFalseNegativeShadowReplay.inputs?.baseProfile?.stopLossPct, 1)}, maxHold=${curveFalseNegativeShadowReplay.inputs?.baseProfile?.maxHoldSeconds ?? 'n/a'}s, slippage=${fmt(curveFalseNegativeShadowReplay.inputs?.baseProfile?.entrySlippagePct, 2)}%/${fmt(curveFalseNegativeShadowReplay.inputs?.baseProfile?.exitSlippagePct, 2)}%`);
  if (curveFalseNegativeShadowReplayRanking.length) {
    lines.push('- Profile ranking:');
    curveFalseNegativeShadowReplayRanking.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.name}: trades=${item.trades ?? 'n/a'}, closed=${item.closed ?? 'n/a'}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, median=${sol(item.medianPnlSol, 6)}, exits=${Object.entries(item.exitReasonCounts || {}).map(([key, value]) => `${key}=${value}`).join(', ') || 'n/a'}`);
    });
  } else {
    lines.push('- Profile ranking: none');
  }
  const curveFalseNegativeShadowReplaySlices = topArray(curveFalseNegativeShadowReplay.sliceRanking, 8);
  if (curveFalseNegativeShadowReplaySlices.length) {
    lines.push('- Best ex-ante slices:');
    curveFalseNegativeShadowReplaySlices.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.profileName || 'n/a'} / ${item.name || 'n/a'}: closed=${item.closed ?? 'n/a'}, kept=${pct(item.keptShare, 1)}, wins/losses=${item.wins ?? 'n/a'}/${item.losses ?? 'n/a'}, winRate=${pct(item.winRate, 1)}, pnl=${sol(item.totalPnlSol, 6)}, median=${sol(item.medianPnlSol, 6)}, avg=${sol(item.averagePnlSol, 6)} | ${item.description || 'n/a'}`);
    });
  }
  if (bestCurveFalseNegativeShadowReplay) {
    const bestWinners = topArray(bestCurveFalseNegativeShadowReplay.topWinners, 5);
    const bestLosers = topArray(bestCurveFalseNegativeShadowReplay.topLosers, 5);
    lines.push(`- Best profile detail: ${bestCurveFalseNegativeShadowReplayName} | ${bestCurveFalseNegativeShadowReplay.profile?.description || 'n/a'}`);
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

  const recoveryShadowSummary = curveFalseNegativeRecoveryShadow.summary || {};
  const recoveryShadowWouldEnter = curveFalseNegativeRecoveryShadow.groups?.wouldEnter || {};
  const recoveryShadowTop = topArray(curveFalseNegativeRecoveryShadow.topWouldEnterFollowThrough, 6);

  lines.push('9c2e. Curve False-Negative Recovery Shadow');
  lines.push('------------------------------------------');
  lines.push('- Mode: report-only; measures the paused bridge replacement requiring curve recovery, no qualifying-wallet sell, and curve parity. Does not spend paper or alter live broadcast.');
  lines.push(`- Rows / would_enter / would_skip / unique mints: ${recoveryShadowSummary.rows ?? 'n/a'} / ${recoveryShadowSummary.wouldEnter ?? 'n/a'} / ${recoveryShadowSummary.wouldSkip ?? 'n/a'} / ${recoveryShadowSummary.uniqueMints ?? 'n/a'}`);
  lines.push(`- Paper-entry paused rows: ${recoveryShadowSummary.paperEntryPausedRows ?? 'n/a'}`);
  lines.push(`- Would-enter crossed85/90 within 120s: ${recoveryShadowWouldEnter.crossed85Within120s ?? 'n/a'} / ${recoveryShadowWouldEnter.crossed90Within120s ?? 'n/a'}; within 300s: ${recoveryShadowWouldEnter.crossed85Within300s ?? 'n/a'} / ${recoveryShadowWouldEnter.crossed90Within300s ?? 'n/a'}`);
  lines.push(`- Would-enter delta120 median/p90/max: ${fmt(recoveryShadowWouldEnter.curveDelta120s?.median, 4)} / ${fmt(recoveryShadowWouldEnter.curveDelta120s?.p90, 4)} / ${fmt(recoveryShadowWouldEnter.curveDelta120s?.max, 4)}; price120 median/p90/max=${fmt(recoveryShadowWouldEnter.maxPriceDeltaPct120s?.median, 2)}% / ${fmt(recoveryShadowWouldEnter.maxPriceDeltaPct120s?.p90, 2)}% / ${fmt(recoveryShadowWouldEnter.maxPriceDeltaPct120s?.max, 2)}%`);
  lines.push('- Recovery-shadow failed checks:');
  objectLines(recoveryShadowSummary.failedCheckCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  lines.push(`- Parity sampled rows: ${recoveryShadowSummary.paritySampledRows ?? 'n/a'}`);
  lines.push(`- Would-enter if parity verified / full-match still blocked: ${recoveryShadowSummary.wouldEnterIfParityVerified ?? 'n/a'} / ${recoveryShadowSummary.fullMatchStillBlockedRows ?? 'n/a'}`);
  lines.push('- Parity status counts:');
  objectLines(recoveryShadowSummary.parityStatusCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (recoveryShadowSummary.fullMatchStillBlockedCheckCounts) {
    lines.push('- Full-match still-blocked checks:');
    objectLines(recoveryShadowSummary.fullMatchStillBlockedCheckCounts, 6).forEach((line) => lines.push(`  - ${line}`));
  }
  const recoveryWalletCoverage = recoveryShadowSummary.walletCoverage || {};
  const recoveryWalletCoverageFullMatch = recoveryShadowSummary.walletCoverageFullMatch || {};
  const recoveryUntrackedCoverage = recoveryShadowSummary.untrackedWalletCoverage || {};
  const recoveryUntrackedCoverageFullMatch = recoveryShadowSummary.untrackedWalletCoverageFullMatch || {};
  lines.push(`- Wallet coverage all rows any/positive/tracked-first/recovery-pass: ${recoveryWalletCoverage.withAnyWalletTouch ?? 'n/a'} / ${recoveryWalletCoverage.withPositiveOrProvenTouch ?? 'n/a'} / ${recoveryWalletCoverage.withTrackedFirstTouchBuy ?? 'n/a'} / ${recoveryWalletCoverage.recoveryPassed ?? 'n/a'}`);
  lines.push(`- Wallet coverage FULL_MATCH any/positive/tracked-first/recovery-pass: ${recoveryWalletCoverageFullMatch.withAnyWalletTouch ?? 'n/a'} / ${recoveryWalletCoverageFullMatch.withPositiveOrProvenTouch ?? 'n/a'} / ${recoveryWalletCoverageFullMatch.withTrackedFirstTouchBuy ?? 'n/a'} / ${recoveryWalletCoverageFullMatch.recoveryPassed ?? 'n/a'}`);
  lines.push(`- Untracked buyer context all/FULL_MATCH rows: ${recoveryUntrackedCoverage.withUntrackedBuy ?? 'n/a'} / ${recoveryUntrackedCoverageFullMatch.withUntrackedBuy ?? 'n/a'}; two-plus buyers all/FULL_MATCH=${recoveryUntrackedCoverage.withTwoPlusUntrackedBuyWallets ?? 'n/a'} / ${recoveryUntrackedCoverageFullMatch.withTwoPlusUntrackedBuyWallets ?? 'n/a'}`);
  const topUntrackedByFollowThrough = topArray(recoveryUntrackedCoverage.topUntrackedBuyWalletsByFollowThrough, 5);
  if (topUntrackedByFollowThrough.length) {
    lines.push('- Top untracked buyer follow-through candidates:');
    topUntrackedByFollowThrough.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.wallet || 'unknown'} | rows=${item.rows ?? 'n/a'} | unique=${item.uniqueMints ?? 'n/a'} | fullMatch=${item.fullMatchRows ?? 'n/a'} | cross85/90_120=${item.crossed85Within120s ?? 'n/a'} / ${item.crossed90Within120s ?? 'n/a'} | delta120 p90/max=${fmt(item.curveDelta120s?.p90, 4)} / ${fmt(item.curveDelta120s?.max, 4)}`);
    });
  }
  if (recoveryShadowTop.length) {
    lines.push('- Top recovery-shadow would-enter follow-through:');
    recoveryShadowTop.forEach((item, index) => {
      const w120 = item.windows?.['120s'] || {};
      lines.push(`  ${index + 1}. ${candidateLabel(item)} | score=${fmt(item.score, 2)} | curve=${fmt(item.curveProgress, 4)} | delta120=${fmt(w120.curveDelta, 4)} | max120=${fmt(w120.maxCurveProgress, 4)} | reason=${item.reason || 'n/a'}`);
    });
  }
  const recoveryShadowParityTop = topArray(curveFalseNegativeRecoveryShadow.topParityExplainRows, 5);
  if (recoveryShadowParityTop.length) {
    lines.push('- Top recovery-shadow parity explain rows:');
    recoveryShadowParityTop.forEach((item, index) => {
      const w120 = item.window120 || {};
      const parity = item.parityExplain || {};
      lines.push(`  ${index + 1}. ${candidateLabel(item)} | status=${parity.status || 'n/a'} | parityOnlyEnter=${item.wouldEnterIfParityVerified ? 'yes' : 'no'} | source=${parity.source || 'n/a'} | provider=${fmt(parity.providerCurveProgress, 4)} | onchain=${fmt(parity.onchainCurveProgress, 4)} | delta=${fmt(parity.curveDelta, 4)} | max120=${fmt(w120.maxCurveProgress, 4)} | reason=${item.reason || 'n/a'}`);
    });
  }
  lines.push('');

  const freshCurveOverrideSummary = freshCurveOverrideShadow.summary || {};
  const freshCurveOverrideChanged = topArray(freshCurveOverrideShadow.changedOutcomeRows, 8);
  const freshCurveOverrideDelta = freshCurveOverrideSummary.curveDelta || {};
  const freshCurveOverrideAge = freshCurveOverrideSummary.originalCurveSnapshotAgeSeconds || {};
  const freshCurveOverrideAccountAge = freshCurveOverrideSummary.accountAgeMs || {};
  lines.push('9c2f. Fresh Curve Override Shadow');
  lines.push('----------------------------------');
  lines.push('- Mode: report-only; replays stale/CURVE_NOT_ADVANCING paper decisions using fresh finalist account curve state. Does not alter runtime gates or entries.');
  lines.push(`- Rows / unique / would_enter / changed_outcome / still_blocked: ${freshCurveOverrideSummary.rows ?? 'n/a'} / ${freshCurveOverrideSummary.uniqueMints ?? 'n/a'} / ${freshCurveOverrideSummary.wouldEnter ?? 'n/a'} / ${freshCurveOverrideSummary.changedOutcome ?? 'n/a'} / ${freshCurveOverrideSummary.stillBlocked ?? 'n/a'}`);
  lines.push(`- Entry guard passed: ${freshCurveOverrideSummary.entryGuardPassed ?? 'n/a'}; account age median/p90/max=${ms(freshCurveOverrideAccountAge.median)} / ${ms(freshCurveOverrideAccountAge.p90)} / ${ms(freshCurveOverrideAccountAge.max)}`);
  lines.push(`- Curve delta median/p90/max/min: ${fmt(freshCurveOverrideDelta.median, 4)} / ${fmt(freshCurveOverrideDelta.p90, 4)} / ${fmt(freshCurveOverrideDelta.max, 4)} / ${fmt(freshCurveOverrideDelta.min, 4)}; original stale age median/p90/max=${fmt(freshCurveOverrideAge.median, 1)}s / ${fmt(freshCurveOverrideAge.p90, 1)}s / ${fmt(freshCurveOverrideAge.max, 1)}s`);
  lines.push(`- Source reasons: ${formatTopCounts(freshCurveOverrideSummary.bySourceReason)}.`);
  lines.push(`- Decision reasons after fresh curve: ${formatTopCounts(freshCurveOverrideSummary.byDecisionReason)}.`);
  lines.push(`- Entry guard reasons after fresh curve: ${formatTopCounts(freshCurveOverrideSummary.byEntryGuardReason)}.`);
  if (freshCurveOverrideChanged.length) {
    lines.push('- Changed-outcome rows:');
    freshCurveOverrideChanged.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.symbol || 'UNKNOWN'} ${item.mint || ''} | source=${item.sourceReason || 'n/a'} | preset=${item.preset || 'n/a'} | score=${fmt(item.score, 2)} | provider=${fmt(item.originalCurveProgress, 4)} -> account=${fmt(item.accountCurveProgress, 4)} | delta=${fmt(item.curveDelta, 4)} | staleAge=${fmt(item.originalCurveSnapshotAgeSeconds, 1)}s | guard=${item.entryGuardReason || 'pass'} | decision=${item.decisionReason || 'pass'}`);
    });
  } else {
    lines.push('- Changed-outcome rows: none observed.');
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
  const walletShadowLedgerSummary = walletRelaxedShadowOutcome.ledger?.summary || {};
  const walletShadowDisposition = walletRelaxedShadowOutcome.checkpointDisposition || {};
  const walletShadowCheckpoint = walletRelaxedShadowOutcome.checkpointEvaluation || {};
  const walletShadowWindow120 = walletShadowSummary.windowSummary?.['120s'] || {};
  const walletShadowWindow300 = walletShadowSummary.windowSummary?.['300s'] || {};
  const walletShadowTop = topArray(walletRelaxedShadowOutcome.topWouldEnterFollowThrough, 8);

  lines.push('9c4. Wallet-Relaxed Shadow Outcome');
  lines.push('-----------------------------------');
  lines.push('- Mode: report-only; follows prospective wallet-conditioned LOW_SCORE/FIRST_SIGHT shadow would-enter rows. Does not alter runtime gates or live broadcast.');
  if (walletShadowDisposition.disposition) {
    lines.push(`- Checkpoint disposition: ${walletShadowDisposition.disposition}; post-fix target additional samples=${walletShadowDisposition.postFixTargetAdditionalSamples ?? 'n/a'}; clean era=${walletShadowDisposition.postFixSampleEra || 'n/a'}`);
  }
  if (walletShadowCheckpoint.checkpoint?.disposition) {
    lines.push(`- Clean checkpoint verdict: ${walletShadowCheckpoint.checkpoint.disposition}; evaluated=${walletShadowCheckpoint.cleanSamplesEvaluated ?? 'n/a'}/${walletShadowCheckpoint.samplePolicy?.target ?? 'n/a'}, W/L=${walletShadowCheckpoint.summary?.wins ?? 'n/a'}/${walletShadowCheckpoint.summary?.losses ?? 'n/a'}, pnl=${sol(walletShadowCheckpoint.summary?.totalPnlSol ?? 0, 6)}, median=${sol(walletShadowCheckpoint.summary?.medianPnlSol ?? 0, 6)}, exTop3=${sol(walletShadowCheckpoint.summary?.pnlAfterRemovingTop3WinnersSol ?? 0, 6)}`);
    lines.push(`- Clean checkpoint failed checks: ${(walletShadowCheckpoint.checkpoint.failedChecks || []).join(', ') || 'none'}`);
  }
  lines.push(`- Shadow attempts / would_enter / would_skip / unique would_enter mints: ${walletShadowSummary.attempts ?? 'n/a'} / ${walletShadowSummary.wouldEnter ?? 'n/a'} / ${walletShadowSummary.wouldSkip ?? 'n/a'} / ${walletShadowSummary.uniqueWouldEnterMints ?? 'n/a'}`);
  lines.push(`- Wallet context coverage any/no-touch/qualifying-first-touch/positive-or-proven/avoid: ${walletShadowSummary.contextCoverage?.withAnyWalletTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withNoWalletTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withQualifyingFirstTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withPositiveOrProvenTouch ?? 'n/a'} / ${walletShadowSummary.contextCoverage?.withAvoidTouch ?? 'n/a'}`);
  const walletShadowIntegrity = walletShadowSummary.qualifyingFirstTouchIntegrity || {};
  if (walletShadowIntegrity.qualifyingSamples !== undefined) {
    lines.push(`- Frozen slice integrity: ${walletShadowIntegrity.frozenCondition || 'n/a'} counts any tracked-wallet first-touch buy; qualifying/positive-first/avoid-first/neither=${walletShadowIntegrity.qualifyingSamples ?? 'n/a'} / ${walletShadowIntegrity.qualifyingFirstTouchPositiveOrProven ?? 'n/a'} / ${walletShadowIntegrity.qualifyingFirstTouchAvoidOrNegative ?? 'n/a'} / ${walletShadowIntegrity.qualifyingFirstTouchNeitherPositiveNorAvoid ?? 'n/a'}`);
    lines.push(`- Positive-only sibling samples / exclude-avoid sibling samples: ${walletShadowIntegrity.positiveOnlySiblingSamples ?? 'n/a'} / ${walletShadowIntegrity.excludeAvoidSiblingSamples ?? 'n/a'}`);
  }
  const walletShadowLedgerIntegrity = walletShadowLedgerSummary.qualifyingFirstTouchIntegrity || {};
  const walletShadowLedgerWindow300 = walletShadowLedgerSummary.windowDiagnostics?.['300s'] || {};
  if (walletShadowLedgerIntegrity.qualifyingSamples !== undefined) {
    lines.push(`- Cumulative ledger checkpoint: rows=${walletShadowLedgerSummary.filteredRows ?? 'n/a'}; qualifying/positive-first/avoid-first/neither=${walletShadowLedgerIntegrity.qualifyingSamples ?? 'n/a'} / ${walletShadowLedgerIntegrity.qualifyingFirstTouchPositiveOrProven ?? 'n/a'} / ${walletShadowLedgerIntegrity.qualifyingFirstTouchAvoidOrNegative ?? 'n/a'} / ${walletShadowLedgerIntegrity.qualifyingFirstTouchNeitherPositiveNorAvoid ?? 'n/a'}; 300s staticPrice/touchCurveAboveMax=${walletShadowLedgerWindow300.staticFuturePriceSeries ?? 'n/a'} / ${walletShadowLedgerWindow300.touchCurveAboveWindowMax ?? 'n/a'}`);
    lines.push(`- Post-fix clean wallet samples: ${walletShadowLedgerSummary.postFixCleanSamples ?? 'n/a'} / ${walletShadowLedgerSummary.postFixTargetAdditionalSamples ?? 'n/a'}; joined120=${walletShadowLedgerSummary.postFixOutcomeJoined120s ?? 'n/a'}`);
  }
  if (walletShadowSummary.preDecisionContextSummary || walletShadowLedgerSummary.preDecisionContextSummary) {
    const latestPreDecision = walletShadowSummary.preDecisionContextSummary || {};
    const ledgerPreDecision = walletShadowLedgerSummary.preDecisionContextSummary || {};
    lines.push(`- Pre-decision touch context latest fadedFromTouch/preMax=${latestPreDecision.fadedFromTouchBeforeDecision ?? 'n/a'} / ${latestPreDecision.fadedFromPreDecisionMax ?? 'n/a'}; ledger fadedFromTouch/preMax=${ledgerPreDecision.fadedFromTouchBeforeDecision ?? 'n/a'} / ${ledgerPreDecision.fadedFromPreDecisionMax ?? 'n/a'}`);
  }
  lines.push(`- Crossed 85/90 within 120s: ${walletShadowWindow120.crossed85 ?? 'n/a'} / ${walletShadowWindow120.crossed90 ?? 'n/a'}; uniqueCross85/90=${walletShadowWindow120.uniqueCrossed85 ?? 'n/a'} / ${walletShadowWindow120.uniqueCrossed90 ?? 'n/a'}`);
  lines.push(`- Crossed 85/90 within 300s: ${walletShadowWindow300.crossed85 ?? 'n/a'} / ${walletShadowWindow300.crossed90 ?? 'n/a'}; uniqueCross85/90=${walletShadowWindow300.uniqueCrossed85 ?? 'n/a'} / ${walletShadowWindow300.uniqueCrossed90 ?? 'n/a'}`);
  lines.push(`- Curve delta 120s median/p90/max: ${fmt(walletShadowWindow120.curveDelta?.median, 4)} / ${fmt(walletShadowWindow120.curveDelta?.p90, 4)} / ${fmt(walletShadowWindow120.curveDelta?.max, 4)}`);
  lines.push(`- Price delta 120s median/p90/max: ${fmt(walletShadowWindow120.maxPriceDeltaPct?.median, 2)}% / ${fmt(walletShadowWindow120.maxPriceDeltaPct?.p90, 2)}% / ${fmt(walletShadowWindow120.maxPriceDeltaPct?.max, 2)}%`);
  if (walletShadowWindow120.priceJoinStatusCounts || walletShadowWindow300.priceJoinStatusCounts) {
    lines.push(`- Price join status 120s: ${JSON.stringify(walletShadowWindow120.priceJoinStatusCounts || {})}; static/missing/touchCurveAboveMax=${walletShadowWindow120.staticFuturePriceSeries ?? 'n/a'} / ${walletShadowWindow120.missingPriceJoin ?? 'n/a'} / ${walletShadowWindow120.touchCurveAboveWindowMax ?? 'n/a'}`);
    lines.push(`- Price join status 300s: ${JSON.stringify(walletShadowWindow300.priceJoinStatusCounts || {})}; static/missing/touchCurveAboveMax=${walletShadowWindow300.staticFuturePriceSeries ?? 'n/a'} / ${walletShadowWindow300.missingPriceJoin ?? 'n/a'} / ${walletShadowWindow300.touchCurveAboveWindowMax ?? 'n/a'}`);
  }
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
  const walletContextTrackingOpportunity = walletContextRuntime.trackingOpportunity || {};
  const walletContextDecision = walletContextRuntime.decisionCoverage || {};
  const walletContextGuardAttribution = walletContextRuntime.guardAttributionCoverage || {};
  const walletContextUnflaggedShadowGuard = walletContextRuntime.unflaggedEntryShadowGuardCoverage || {};
  const walletContextOverlap = walletContextRuntime.walletDecisionMintOverlap || {};
  const walletContextJoin = walletContextRuntime.walletDecisionJoin || {};
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
  if (walletContextTrackingOpportunity.providerTradeEvents !== undefined) {
    lines.push(`- Runtime wallet tracking opportunity: provider trade events=${walletContextTrackingOpportunity.providerTradeEvents ?? 'n/a'}, wallet.trade_observed=${walletContextTrackingOpportunity.walletTradeObservedEvents ?? 'n/a'}, hitRate=${pct(walletContextTrackingOpportunity.walletObservedHitRate, 2)}`);
    const providerTradeDiagnostics = walletContextTrackingOpportunity.providerTradeDiagnostics || {};
    if (providerTradeDiagnostics.withTraderFieldKnown > 0) {
      lines.push(`- Runtime provider trade wallet fields: traderPresent=${providerTradeDiagnostics.traderPresent ?? 'n/a'}/${providerTradeDiagnostics.withTraderFieldKnown}, trackedAccountMatch=${providerTradeDiagnostics.trackedAccountMatch ?? 'n/a'}, kolWalletProfileMatch=${providerTradeDiagnostics.kolWalletProfileMatch ?? 'n/a'}, shadowWalletProfileMatch=${providerTradeDiagnostics.shadowWalletProfileMatch ?? 'n/a'}, watchedWalletFlag=${providerTradeDiagnostics.watchedWalletFlag ?? 'n/a'}`);
    }
    const walletGateDiagnostics = walletContextTrackingOpportunity.walletGateDiagnostics || {};
    if (walletGateDiagnostics.rows > 0) {
      lines.push(`- Wallet trade gate diagnostics: rows=${walletGateDiagnostics.rows}, noTrader=${walletGateDiagnostics.noTraderField ?? 'n/a'}, untracked=${walletGateDiagnostics.untrackedWallet ?? 'n/a'}, untrustedTape=${walletGateDiagnostics.untrustedTapeRecords ?? 'n/a'}, recorded=${walletGateDiagnostics.recorded ?? 'n/a'}, shadowRecorded=${walletGateDiagnostics.shadowWalletProfileMatch ?? 'n/a'}, uniqueTraderWallets=${walletGateDiagnostics.uniqueWalletsWithTrader ?? 'n/a'}`);
      lines.push(`- Wallet observation channel: ${walletContextTrackingOpportunity.walletObservationChannel || 'n/a'}; bridge validation=${walletContextTrackingOpportunity.bridgeValidationStatus || 'n/a'}`);
    }
    const walletChannelPartition = walletContextTrackingOpportunity.walletChannelPartition || {};
    const trustedRecorded = walletChannelPartition.trustedRecorded || {};
    const shadowRecorded = walletChannelPartition.shadowRecorded || {};
    const untrackedDropped = walletChannelPartition.untrackedDropped || {};
    if (walletChannelPartition.totals) {
      lines.push(`- Wallet channel partition: trusted rows/pre85 buys=${trustedRecorded.rows ?? 'n/a'}/${trustedRecorded.pre85BuyRows ?? 'n/a'}, shadow rows/pre85 buys=${shadowRecorded.rows ?? 'n/a'}/${shadowRecorded.pre85BuyRows ?? 'n/a'}, raw-untracked rows/pre85 buys=${untrackedDropped.rows ?? 'n/a'}/${untrackedDropped.pre85BuyRows ?? 'n/a'}.`);
      lines.push(`- Wallet channel unique wallets: trusted=${trustedRecorded.uniqueWallets ?? 'n/a'}, shadow=${shadowRecorded.uniqueWallets ?? 'n/a'}, raw-untracked=${untrackedDropped.uniqueWallets ?? 'n/a'}; pre85 buy wallets trusted/shadow/raw=${trustedRecorded.uniquePre85BuyWallets ?? 'n/a'} / ${shadowRecorded.uniquePre85BuyWallets ?? 'n/a'} / ${untrackedDropped.uniquePre85BuyWallets ?? 'n/a'}.`);
    }
    const untrackedOverlap = walletContextTrackingOpportunity.untrackedSubstrateOverlap || {};
    if (untrackedOverlap.uniqueUntrackedWallets !== undefined) {
      lines.push(`- Untracked substrate overlap: unique=${untrackedOverlap.uniqueUntrackedWallets ?? 'n/a'}, anyKnown=${untrackedOverlap.inAnySubstrateSource ?? 'n/a'} (${pct(untrackedOverlap.inAnySubstrateSourceRate, 2)}), trulyNovel=${untrackedOverlap.trulyNovelAnonymous ?? 'n/a'} (${pct(untrackedOverlap.trulyNovelAnonymousRate, 2)}), substrateLeaks=${untrackedOverlap.substrateLeakUntrackedCount ?? 'n/a'}.`);
      lines.push(`- Untracked overlap sources: manual=${untrackedOverlap.inManualKol ?? 'n/a'}, promotion=${untrackedOverlap.inPromotionReview ?? 'n/a'}, launchIntel=${untrackedOverlap.inLaunchIntelWalletIndex ?? 'n/a'}, historicalLedger=${untrackedOverlap.inHistoricalWalletEventsLedger ?? 'n/a'}, pnlEvidence=${untrackedOverlap.inWalletIntelOrRealizedPnl ?? 'n/a'}.`);
    }
    const untrackedOpportunity = walletContextTrackingOpportunity.untrackedWalletOpportunity || {};
    if (untrackedOpportunity.rows !== undefined) {
      lines.push(`- Untracked wallet opportunity: buys=${untrackedOpportunity.buyRows ?? 'n/a'} wallets=${untrackedOpportunity.uniqueWallets ?? 'n/a'} mints=${untrackedOpportunity.uniqueBuyMints ?? 'n/a'} decisionOverlapRows=${untrackedOpportunity.buyRowsWithDecisionOverlap ?? 'n/a'} cross90_300 rows/mints=${untrackedOpportunity.buyRowsCrossed90Within300s ?? 'n/a'} / ${untrackedOpportunity.uniqueBuyMintsCrossed90Within300s ?? 'n/a'}`);
      lines.push(`- Untracked wallet curve delta 300s median/p90/max: ${fmt(untrackedOpportunity.curveDelta300s?.median, 4)} / ${fmt(untrackedOpportunity.curveDelta300s?.p90, 4)} / ${fmt(untrackedOpportunity.curveDelta300s?.max, 4)}; price delta 300s median/p90/max=${fmt(untrackedOpportunity.maxPriceDeltaPct300s?.median, 2)}% / ${fmt(untrackedOpportunity.maxPriceDeltaPct300s?.p90, 2)}% / ${fmt(untrackedOpportunity.maxPriceDeltaPct300s?.max, 2)}%`);
      const topUntrackedReviewCandidates = topArray(untrackedOpportunity.topReviewCandidates, 5);
      if (topUntrackedReviewCandidates.length) {
        lines.push('- Top untracked wallet review candidates:');
        topUntrackedReviewCandidates.forEach((item, index) => {
          lines.push(`  ${index + 1}. ${item.wallet} | score=${fmt(item.reviewScore, 1)} ${item.reviewReason || 'n/a'} | buys/sells=${item.buyRows ?? item.rows ?? 'n/a'}/${item.sellRows ?? 'n/a'} ratio=${pct(item.buyRatio, 1)} | mints=${item.uniqueMints} overlap=${item.decisionOverlapMints} | delta300 med/p90/max=${fmt(item.curveDelta300s?.median, 4)}/${fmt(item.curveDelta300s?.p90, 4)}/${fmt(item.curveDelta300s?.max, 4)}`);
        });
      }
      const topUntrackedRuntime = topArray(untrackedOpportunity.topByFollowThrough, 5);
      if (topUntrackedRuntime.length) {
        lines.push('- Top runtime untracked wallet follow-through:');
        topUntrackedRuntime.forEach((item, index) => {
          lines.push(`  ${index + 1}. ${item.wallet} | rows=${item.rows} mints=${item.uniqueMints} overlap=${item.decisionOverlapMints} cross90_300=${item.crossed90Within300s}/${item.uniqueMintsCrossed90Within300s} | delta300 med/p90/max=${fmt(item.curveDelta300s?.median, 4)}/${fmt(item.curveDelta300s?.p90, 4)}/${fmt(item.curveDelta300s?.max, 4)} | price300 med/p90/max=${fmt(item.maxPriceDeltaPct300s?.median, 2)}%/${fmt(item.maxPriceDeltaPct300s?.p90, 2)}%/${fmt(item.maxPriceDeltaPct300s?.max, 2)}%`);
        });
      }
    }
    const untrackedDecisionJoin = walletContextTrackingOpportunity.untrackedWalletDecisionJoin || {};
    if (untrackedDecisionJoin.paperDecisionRows !== undefined) {
      lines.push(`- Untracked wallet decision join (${untrackedDecisionJoin.windowSeconds ?? 'n/a'}s prior): decisionsWithPrior=${untrackedDecisionJoin.decisionsWithPriorUntrackedBuy ?? 'n/a'}, nearPrior=${untrackedDecisionJoin.decisionsWithNearPriorUntrackedBuy ?? 'n/a'}, nearPriorWallets=${untrackedDecisionJoin.uniqueNearPriorUntrackedWallets ?? 'n/a'}`);
      lines.push(`- NO_TRACKED_FIRST_TOUCH_BUY with untracked prior/near-prior: ${untrackedDecisionJoin.noTrackedFirstTouchBuyWithPriorUntrackedBuy ?? 'n/a'} / ${untrackedDecisionJoin.noTrackedFirstTouchBuyWithNearPriorUntrackedBuy ?? 'n/a'} of ${untrackedDecisionJoin.noTrackedFirstTouchBuyDecisions ?? 'n/a'}`);
      const topUntrackedJoinWallets = topArray(untrackedDecisionJoin.topNearPriorWallets, 5);
      if (topUntrackedJoinWallets.length) {
        lines.push('- Top untracked near-prior decision wallets:');
        topUntrackedJoinWallets.forEach((item, index) => {
          const topReason = Object.entries(item.reasonCounts || {}).sort((a, b) => b[1] - a[1])[0];
          lines.push(`  ${index + 1}. ${item.wallet} | decisions=${item.decisions ?? 'n/a'} buys=${item.nearPriorBuyRows ?? 'n/a'} links=${item.nearPriorBuyDecisionLinks ?? 'n/a'} mints=${item.uniqueMints ?? 'n/a'} topReason=${topReason ? `${topReason[0]}:${topReason[1]}` : 'n/a'}`);
        });
      }
    }
  }
  lines.push(`- Runtime-vs-historical wallet coverage: ${pct(walletRuntimeToHistoricalRatio, 1)} of tracked historical wallets active this run; historical/runtime wallet ratio=${fmt(walletHistoricalToRuntimeRatio, 1)}x`);
  lines.push(`- Runtime promoted rows positive-or-proven / avoid / any promotion: ${walletContextRuntimeEvents.promotionCoverage?.positiveOrProvenRows ?? 'n/a'} / ${walletContextRuntimeEvents.promotionCoverage?.avoidRows ?? 'n/a'} / ${walletContextRuntimeEvents.promotionCoverage?.rowsWithPromotion ?? 'n/a'}`);
  lines.push(`- Paper decision wallet context any / positive-or-proven / avoid: ${walletContextDecision.withAnyWalletTouch ?? 'n/a'} / ${walletContextDecision.withPositiveOrProvenTouch ?? 'n/a'} / ${walletContextDecision.withAvoidTouch ?? 'n/a'} of ${walletContextDecision.decisions ?? 'n/a'} decisions`);
  lines.push(`- Guard attribution wallet context any / positive-or-proven / avoid: ${walletContextGuardAttribution.withAnyWalletTouch ?? 'n/a'} / ${walletContextGuardAttribution.withPositiveOrProvenTouch ?? 'n/a'} / ${walletContextGuardAttribution.withAvoidTouch ?? 'n/a'} of ${walletContextGuardAttribution.decisions ?? 'n/a'} rows`);
  lines.push(`- Unflagged entry-shadow wallet context any / positive-or-proven / avoid: ${walletContextUnflaggedShadowGuard.withAnyWalletTouch ?? 'n/a'} / ${walletContextUnflaggedShadowGuard.withPositiveOrProvenTouch ?? 'n/a'} / ${walletContextUnflaggedShadowGuard.withAvoidTouch ?? 'n/a'} of ${walletContextUnflaggedShadowGuard.decisions ?? 'n/a'} rows`);
  lines.push(`- Wallet-event mints / decision mints / overlap: ${walletContextOverlap.uniqueWalletEventMints ?? 'n/a'} / ${walletContextOverlap.uniqueDecisionMints ?? 'n/a'} / ${walletContextOverlap.overlapMints ?? 'n/a'}`);
  if (walletContextJoin.walletTouchRows !== undefined) {
    lines.push(`- Wallet proof join: touches=${walletContextJoin.walletTouchRows ?? 'n/a'} touchMints=${walletContextJoin.walletTouchUniqueMints ?? 'n/a'} decisionRows=${walletContextJoin.paperDecisionRows ?? 'n/a'} decisionMints=${walletContextJoin.paperDecisionUniqueMints ?? 'n/a'} overlapMints=${walletContextJoin.overlapMints ?? 'n/a'}`);
    lines.push(`- Wallet proof join misses: noDecisionMint=${walletContextJoin.touchRowsWithNoPaperDecisionForMint ?? 'n/a'}, afterLastDecision=${walletContextJoin.touchRowsAfterLastPaperDecision ?? 'n/a'}, beforeDecisionButNoContext=${walletContextJoin.touchRowsBeforePaperDecisionButContextAbsent ?? 'n/a'}, sameMintContextPresent=${walletContextJoin.touchRowsWithSameMintContextPresent ?? 'n/a'}, decisionsPriorTouchNoContext=${walletContextJoin.decisionsWithPriorOrSameWalletTouchButNoContext ?? 'n/a'}`);
    const joinStatus = walletContextJoin.joinStatusCounts || {};
    const statusLines = objectLines(joinStatus, 5);
    if (statusLines.length) {
      lines.push('- Wallet proof join status:');
      statusLines.forEach((line) => lines.push(`  - ${line}`));
    }
    const joinSamples = topArray(walletContextJoin.touchExplanations, 5);
    if (joinSamples.length) {
      lines.push('- Wallet proof join samples:');
      joinSamples.forEach((sample, index) => {
        lines.push(`  ${index + 1}. ${sample.wallet || 'unknown'} ${sample.side || 'n/a'} ${sample.mint || 'unknown'} | ${sample.joinStatus || 'unknown'} | touch=${sample.touchAt || 'n/a'} firstDecision=${sample.firstDecisionAt || 'n/a'} reason=${sample.firstDecisionReason || 'n/a'} deltaMs=${sample.firstDecisionMinusTouchMs ?? 'n/a'}`);
      });
    }
  }
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

  const walletChannelSummary = walletChannelHealth.summary || {};
  const walletChannelProvider = walletChannelSummary.provider || {};
  const walletChannelTopProspective = topArray(walletChannelHealth.topProspectiveWallets, 5);
  const walletChannelTopMints = topArray(walletChannelHealth.topMintsByProspectivePre85, 5);
  lines.push('9c5a. Wallet Channel Health');
  lines.push('----------------------------');
  lines.push('- Mode: report-only; splits paper-decision wallet evidence into trusted, prospective promotion/manual-substrate, and raw untrusted channels. Does not alter gates or trust tiers.');
  lines.push(`- Verdict: ${walletChannelSummary.channelVerdict || 'n/a'}`);
  lines.push(`- Provider trades / gate rows / recorded trusted / untracked: ${walletChannelProvider.providerTradeEvents ?? 'n/a'} / ${walletChannelProvider.walletGateDiagnosticRows ?? 'n/a'} / ${walletChannelProvider.recordedTrustedRows ?? 'n/a'} / ${walletChannelProvider.untrackedRows ?? 'n/a'}; untrustedTape=${walletChannelProvider.untrustedTapeRecords ?? 'n/a'}`);
  lines.push(`- Paper decisions / NO_TRACKED_FIRST_TOUCH_BUY: ${walletChannelSummary.paperDecisionRows ?? 'n/a'} / ${walletChannelSummary.noTrackedFirstTouchBuyDecisionRows ?? 'n/a'}`);
  lines.push(`- Decisions with trusted/prospective/raw-untrusted pre85 buys: ${walletChannelSummary.decisionsWithTrustedPre85Buy ?? 'n/a'} / ${walletChannelSummary.decisionsWithProspectivePre85Buy ?? 'n/a'} / ${walletChannelSummary.decisionsWithRawUntrustedPre85Buy ?? 'n/a'}`);
  lines.push(`- NO_TRACKED_FIRST_TOUCH_BUY with prospective/raw-untrusted pre85: ${walletChannelSummary.noTrackedFirstTouchWithProspectivePre85Buy ?? 'n/a'} / ${walletChannelSummary.noTrackedFirstTouchWithRawUntrustedPre85Buy ?? 'n/a'}; prospective coverage if accepted=${pct(walletChannelSummary.projectedNoTrackedCoverageRateIfProspectiveAccepted, 1)}`);
  if (walletChannelTopProspective.length) {
    lines.push('- Top prospective wallet-channel rows:');
    walletChannelTopProspective.forEach((item, index) => {
      lines.push(`  ${index + 1}. ${item.wallet || 'unknown'} | tier=${item.reviewTier || item.evidenceTier || 'n/a'} | decisions=${item.decisionRows ?? 'n/a'} | noTracked=${item.noTrackedFirstTouchBuyRows ?? 'n/a'} | pre85=${item.pre85BuyRows ?? 'n/a'} | mints=${item.uniqueMints ?? 'n/a'}`);
    });
  } else {
    lines.push('- Top prospective wallet-channel rows: none');
  }
  if (walletChannelTopMints.length) {
    lines.push('- Top mints by prospective pre85 decision coverage:');
    walletChannelTopMints.forEach((item, index) => {
      const topReason = Object.entries(item.skipReasons || {}).sort((a, b) => b[1] - a[1])[0];
      lines.push(`  ${index + 1}. ${item.symbol || 'UNKNOWN'} ${item.mint || ''} | prospectivePre85=${item.prospectivePre85BuyDecisions ?? 'n/a'} | noTracked=${item.noTrackedFirstTouchBuyDecisions ?? 'n/a'} | topReason=${topReason ? `${topReason[0]}:${topReason[1]}` : 'n/a'}`);
    });
  }
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
