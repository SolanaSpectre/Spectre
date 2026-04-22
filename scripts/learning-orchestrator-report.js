const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'learning-orchestrator');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'learning-orchestrator-latest.json');

const INPUTS = {
  battlefield: path.join(REPO_ROOT, 'data', 'reports', 'run-battlefield-latest.json'),
  continuationPaper: path.join(REPO_ROOT, 'data', 'reports', 'continuation-paper-latest.json'),
  continuationSpecimens: path.join(REPO_ROOT, 'data', 'reports', 'continuation-specimens-latest.json'),
  preMigrationSignalQuality: path.join(REPO_ROOT, 'data', 'reports', 'pre-migration-signal-quality-latest.json'),
  tradeLearningMemory: path.join(REPO_ROOT, 'data', 'reports', 'trade-learning-memory-latest.json'),
  rickContext: path.join(REPO_ROOT, 'data', 'rick-context', 'latest.json')
};

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

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function countBy(items, selectKey) {
  return (items || []).reduce((counts, item) => {
    const key = selectKey(item) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildLaneScores(battlefield, continuationPaper, continuationSpecimens) {
  const pre = battlefield?.preMigrationPaper || {};
  const watch = battlefield?.watchLane || {};
  const runner = battlefield?.runnerLane || {};
  const continuationSummary = continuationPaper?.summary || {};
  const specimens = continuationSpecimens?.specimens || [];

  const highConvictionWatch = Number(watch.verdicts?.high_conviction_watch || 0);
  const preEntries = Number(pre.entries || 0);
  const preWins = Number(pre.wins || 0);
  const prePnlSol = Number(pre.pnlSol || 0);
  const runnerGenerated = Number(runner.generatedSignals || 0);
  const runnerExecuted = Number(runner.executedSignals || 0);
  const continuationOpened = Number(continuationSummary.openedThisRun || 0);
  const continuationClosed = continuationPaper?.closed || [];
  const continuationStopLosses = continuationClosed.filter((item) => item.exitReason === 'STOP_LOSS').length;
  const continuationTakeProfits = continuationClosed.filter((item) => item.exitReason === 'TAKE_PROFIT').length;
  const skippedIneligible = continuationPaper?.skippedIneligible || [];
  const highChurnSkips = skippedIneligible.filter((item) => item.reason === 'HIGH_CHURN').length;
  const cleanConfirmedSpecimens = specimens.filter((specimen) => (
    specimen.label === 'continuation_confirmed'
    && !(specimen.riskFlags || []).includes('high_churn')
    && !(specimen.riskFlags || []).includes('late_vertical_chase')
    && !(specimen.riskFlags || []).includes('negative_one_hour')
  )).length;

  const preMigration = compact(
    Math.max(0, Math.min(1,
      (preEntries > 0 ? 0.35 : 0)
      + (preWins > 0 ? 0.25 : 0)
      + (prePnlSol > 0 ? 0.2 : 0)
      + (highConvictionWatch >= 4 ? 0.12 : highConvictionWatch * 0.02)
      - (Number(pre.skipReasons?.LOW_SCORE || 0) > 50 ? 0.08 : 0)
    )),
    3
  );

  const runnerScalper = compact(
    Math.max(0, Math.min(1,
      (runnerExecuted > 0 ? 0.55 : 0)
      + (runnerGenerated > 0 ? 0.22 : 0)
      - (Number(runner.rejectionReasons?.LOW_PUMP_MOMENTUM || 0) > 10 ? 0.08 : 0)
      - (Number(runner.rejectionReasons?.QUOTE_PRICE_IMPACT_TOO_HIGH || 0) > 0 ? 0.08 : 0)
    )),
    3
  );

  const continuation = compact(
    Math.max(0, Math.min(1,
      (continuationOpened > 0 ? 0.2 : 0)
      + (continuationTakeProfits > 0 ? 0.35 : 0)
      + (cleanConfirmedSpecimens > 0 ? 0.16 : 0)
      - (continuationStopLosses > 0 ? 0.35 : 0)
      - (highChurnSkips > 0 ? 0.12 : 0)
    )),
    3
  );

  return {
    preMigration,
    runnerScalper,
    continuation,
    raw: {
      highConvictionWatch,
      preEntries,
      preWins,
      prePnlSol: compact(prePnlSol, 6),
      runnerGenerated,
      runnerExecuted,
      continuationOpened,
      continuationStopLosses,
      continuationTakeProfits,
      highChurnSkips,
      cleanConfirmedSpecimens
    }
  };
}

function classifyRegime(battlefield, continuationPaper, continuationSpecimens, laneScores) {
  const pre = battlefield?.preMigrationPaper || {};
  const runner = battlefield?.runnerLane || {};
  const continuationSummary = continuationPaper?.summary || {};
  const specimens = continuationSpecimens?.specimens || [];
  const highChurnSkips = (continuationPaper?.skippedIneligible || []).filter((item) => item.reason === 'HIGH_CHURN').length;
  const continuationStopLosses = (continuationPaper?.closed || []).filter((item) => item.exitReason === 'STOP_LOSS').length;
  const negativeContinuationSpecimens = specimens.filter((specimen) => (
    (specimen.riskFlags || []).includes('negative_one_hour')
    || (specimen.riskFlags || []).includes('sell_pressure')
    || String(specimen.label || '').includes('weak_price_action')
  )).length;
  const preEntries = Number(pre.entries || 0);
  const prePnlSol = Number(pre.pnlSol || 0);
  const runnerGenerated = Number(runner.generatedSignals || 0);
  const continuationOpened = Number(continuationSummary.openedThisRun || 0);

  if (continuationStopLosses > 0 && preEntries === 0) {
    return {
      marketRegime: 'chop_fade',
      confidence: 0.82,
      reason: 'Continuation paper stopped out while pre-migration produced no confirmed entries.'
    };
  }

  if (preEntries > 0 && prePnlSol > 0 && laneScores.preMigration >= laneScores.continuation) {
    return {
      marketRegime: 'fresh_launch_selective',
      confidence: 0.76,
      reason: 'Pre-migration paper produced positive PnL while other lanes stayed constrained.'
    };
  }

  if (highChurnSkips > 0 || negativeContinuationSpecimens >= 4) {
    return {
      marketRegime: 'continuation_churn',
      confidence: 0.74,
      reason: 'Continuation attention is present but dominated by high churn, sell pressure, or weak post-attention action.'
    };
  }

  if (runnerGenerated > 0 && preEntries === 0 && continuationOpened === 0) {
    return {
      marketRegime: 'runner_borderline',
      confidence: 0.66,
      reason: 'Runner/scalper generated a signal but execution gates rejected it.'
    };
  }

  return {
    marketRegime: 'observe_only',
    confidence: 0.64,
    reason: 'No lane produced a clean enough opportunity to justify paper aggression.'
  };
}

function buildRecommendations(battlefield, continuationPaper, tradeLearningMemory, laneScores, regime) {
  const pre = battlefield?.preMigrationPaper || {};
  const runner = battlefield?.runnerLane || {};
  const continuationClosed = continuationPaper?.closed || [];
  const highChurnSkips = (continuationPaper?.skippedIneligible || []).filter((item) => item.reason === 'HIGH_CHURN');
  const continuationStopLosses = continuationClosed.filter((item) => item.exitReason === 'STOP_LOSS');
  const recommendations = [];

  const continuationPosture = continuationStopLosses.length > 0
    ? 'pause_paper_entries'
    : 'allow_confirmed_no_churn_only';

  recommendations.push({
    lane: 'pre_migration',
    posture: Number(pre.entries || 0) > 0 ? 'active_selective' : 'allow_only_exceptional',
    rationale: Number(pre.entries || 0) > 0
      ? 'Pre-migration found at least one eligible paper trade in the latest run.'
      : 'Watch lane produced candidates, but paper bridge rejected all borderline setups.'
  });

  recommendations.push({
    lane: 'runner_scalper',
    posture: Number(runner.generatedSignals || 0) > 0 ? 'monitor_borderline_signals' : 'keep_frozen',
    rationale: Number(runner.generatedSignals || 0) > 0
      ? 'Runner/scalper generated a candidate but execution gates or AI fallback blocked it.'
      : (Number(runner.scalperDiagnostics?.migratedLiquidityRejects || 0) > 0
        ? 'Runner/scalper found migrated candidates, but the migrated-pool liquidity guard filtered ghost liquidity.'
        : 'Runner/scalper produced no executable edge.')
  });

  recommendations.push({
    lane: 'continuation',
    posture: continuationPosture,
    rationale: continuationStopLosses.length > 0
      ? 'Latest continuation paper cohort produced a stop loss; require more confirmation before new continuation paper entries.'
      : 'No latest continuation stop loss; keep the tightened confirmed/no-high-churn bridge only.'
  });

  const proposedChanges = [];
  if (continuationStopLosses.length > 0) {
    proposedChanges.push({
      change: 'Temporarily pause continuation paper entries or raise continuation paper threshold above the last losing clean-confirmed score.',
      confidence: 'medium',
      status: 'proposal_only',
      evidence: continuationStopLosses.map((item) => ({
        symbol: item.symbol,
        score: item.entryScore,
        returnPct: item.returnPct,
        exitReason: item.exitReason
      }))
    });
  }

  if (highChurnSkips.length > 0) {
    proposedChanges.push({
      change: 'Keep high_churn blocked from continuation paper.',
      confidence: 'high',
      status: 'maintain',
      evidence: highChurnSkips.map((item) => ({
        symbol: item.symbol,
        score: item.score,
        reason: item.reason
      }))
    });
  }

  if (Number(pre.entries || 0) === 0 && Number(pre.skipReasons?.NO_PRIOR_CURVE_PROGRESS || 0) > 50) {
    proposedChanges.push({
      change: 'Do not loosen NO_PRIOR_CURVE_PROGRESS yet; continue collecting false-negative outcomes for high-score watch candidates.',
      confidence: 'medium',
      status: 'proposal_only',
      evidence: {
        noPriorSkips: pre.skipReasons.NO_PRIOR_CURVE_PROGRESS,
        highConvictionWatch: battlefield?.watchLane?.verdicts?.high_conviction_watch || 0
      }
    });
  }

  const memoryPenalties = tradeLearningMemory?.lessons?.penalize || [];
  const memoryRewards = tradeLearningMemory?.lessons?.reward || [];
  const continuationConfirmedPenalty = memoryPenalties.find((item) => item.pattern === 'preset:continuation_confirmed');
  if (continuationConfirmedPenalty) {
    proposedChanges.push({
      change: 'Keep continuation_confirmed selective; historical memory says this preset is still negative until cleaner confirmation appears.',
      confidence: 'medium',
      status: 'proposal_only',
      evidence: continuationConfirmedPenalty.evidence
    });
  }

  const recoveredBadReward = memoryRewards.find((item) => item.pattern === 'outcome:recovered_bad_trade');
  if (recoveredBadReward) {
    proposedChanges.push({
      change: 'Preserve recovered-bad-trade cohort for review; do not auto-penalize every ugly entry because some rough setups recovered profitably.',
      confidence: 'medium',
      status: 'maintain_observation',
      evidence: recoveredBadReward.evidence
    });
  }

  return {
    recommendedPosture: regime.marketRegime === 'chop_fade' ? 'observe_only' : 'selective_paper_only',
    laneRecommendations: recommendations,
    proposedChanges,
  doNotChange: [
      'Do not mutate live trading config automatically.',
      'Do not loosen runner/scalper gates from this report alone.',
      'Do not lower global quality score.',
      'Do not reopen previously traded continuation mints by default.',
      'Do not promote wallet realized-PnL overlaps into hard gates until repeated with fresh Spectre outcomes.'
    ]
  };
}

function buildLessons(battlefield, continuationPaper, continuationSpecimens, tradeLearningMemory) {
  const lessons = [];
  const pre = battlefield?.preMigrationPaper || {};
  const runner = battlefield?.runnerLane || {};
  const continuationClosed = continuationPaper?.closed || [];
  const skippedIneligible = continuationPaper?.skippedIneligible || [];
  const specimens = continuationSpecimens?.specimens || [];

  if (Number(pre.entries || 0) > 0) {
    for (const entry of pre.entriesDetail || []) {
      lessons.push({
        type: 'pre_migration_entry',
        severity: Number(pre.pnlSol || 0) > 0 ? 'positive' : 'neutral',
        text: `${entry.symbol || entry.mint} entered via ${entry.preset} at curve ${compact(Number(entry.curveProgress || 0) * 100, 2)}%.`,
        evidence: entry
      });
    }
  } else {
    lessons.push({
      type: 'pre_migration_discipline',
      severity: 'neutral',
      text: 'Pre-migration paper stayed out; borderline watch candidates did not clear guard overrides.',
      evidence: {
        skipReasons: pre.skipReasons || {},
        topWatch: (battlefield?.watchLane?.topWatch || []).slice(0, 3)
      }
    });
  }

  if (Number(runner.generatedSignals || 0) > 0) {
    lessons.push({
      type: 'runner_borderline',
      severity: 'caution',
      text: 'Runner/scalper generated a candidate but did not execute.',
      evidence: {
        generated: runner.generated || [],
        rejectionReasons: runner.rejectionReasons || {},
        aiTimeoutFallback: runner.aiTimeoutFallback || []
      }
    });
  }

  for (const closed of continuationClosed) {
    lessons.push({
      type: 'continuation_outcome',
      severity: closed.exitReason === 'TAKE_PROFIT' ? 'positive' : 'negative',
      text: `${closed.symbol || closed.mint} continuation paper closed by ${closed.exitReason} at ${compact(Number(closed.returnPct || 0) * 100, 2)}%.`,
      evidence: closed
    });
  }

  const highChurnSkips = skippedIneligible.filter((item) => item.reason === 'HIGH_CHURN');
  if (highChurnSkips.length > 0) {
    lessons.push({
      type: 'risk_guard_saved_entry',
      severity: 'positive',
      text: `Continuation bridge skipped ${highChurnSkips.length} high-churn confirmed candidate(s).`,
      evidence: highChurnSkips
    });
  }

  const dangerousContinuation = specimens
    .filter((specimen) => (specimen.riskFlags || []).some((flag) => ['high_churn', 'sell_pressure', 'negative_one_hour', 'late_vertical_chase'].includes(flag)))
    .slice(0, 5)
    .map((specimen) => ({
      symbol: specimen.symbol,
      label: specimen.label,
      score: specimen.continuationScore,
      riskFlags: specimen.riskFlags
    }));

  if (dangerousContinuation.length > 0) {
    lessons.push({
      type: 'continuation_tape_quality',
      severity: 'caution',
      text: 'Continuation tape contains multiple risk-flagged specimens.',
      evidence: dangerousContinuation
    });
  }

  const memorySummary = tradeLearningMemory?.summary?.all;
  if (memorySummary) {
    lessons.push({
      type: 'trade_memory_summary',
      severity: Number(memorySummary.avgReturnPct || 0) >= 0 ? 'neutral' : 'caution',
      text: `Trade memory has ${memorySummary.closedTrades} closed trades, win rate ${compact(Number(memorySummary.winRate || 0) * 100, 2)}%, and ${memorySummary.recoveredBadTrades} recovered-bad trade(s).`,
      evidence: memorySummary
    });
  }

  const topPenalties = (tradeLearningMemory?.lessons?.penalize || []).slice(0, 3);
  if (topPenalties.length > 0) {
    lessons.push({
      type: 'trade_memory_penalties',
      severity: 'caution',
      text: 'Historical trade memory has active penalty patterns that should stay report-only until they repeat cleanly.',
      evidence: topPenalties
    });
  }

  const topRewards = (tradeLearningMemory?.lessons?.reward || []).slice(0, 3);
  if (topRewards.length > 0) {
    lessons.push({
      type: 'trade_memory_rewards',
      severity: 'positive',
      text: 'Historical trade memory has reward patterns worth preserving for replay and future scoring.',
      evidence: topRewards
    });
  }

  const walletOutcomeMemory = tradeLearningMemory?.walletOutcomeMemory || {};
  const walletSignals = walletOutcomeMemory.ruleSignals || {};
  if (Number(walletSignals.wallet_positive_pnl_skip_review || 0) > 0) {
    lessons.push({
      type: 'wallet_false_negative_review',
      severity: 'caution',
      text: `${walletSignals.wallet_positive_pnl_skip_review} wallet-PnL-positive skipped mint(s) need false-negative review.`,
      evidence: walletOutcomeMemory.positiveSkipped || []
    });
  }

  if (Number(walletSignals.trusted_wallet_profit_overlap || 0) > 0) {
    lessons.push({
      type: 'wallet_profit_overlap',
      severity: 'positive',
      text: `${walletSignals.trusted_wallet_profit_overlap} Spectre trade(s) overlapped with profitable tracked-wallet behavior.`,
      evidence: walletOutcomeMemory.reinforceTrades || []
    });
  }

  if (Number(walletSignals.profitable_avoid_wallet_behavior || 0) > 0) {
    lessons.push({
      type: 'profitable_avoid_wallet_behavior',
      severity: 'neutral',
      text: `${walletSignals.profitable_avoid_wallet_behavior} avoid-dominated wallet winner(s) should be studied, not blindly trusted.`,
      evidence: walletOutcomeMemory.profitableAvoidBehavior || []
    });
  }

  return lessons;
}

function buildReport(args = {}) {
  const paths = {
    battlefield: resolveRepoPath(args.battlefield, INPUTS.battlefield),
    continuationPaper: resolveRepoPath(args.continuationPaper, INPUTS.continuationPaper),
    continuationSpecimens: resolveRepoPath(args.continuationSpecimens, INPUTS.continuationSpecimens),
    preMigrationSignalQuality: resolveRepoPath(args.preMigrationSignalQuality, INPUTS.preMigrationSignalQuality),
    tradeLearningMemory: resolveRepoPath(args.tradeLearningMemory, INPUTS.tradeLearningMemory),
    rickContext: resolveRepoPath(args.rickContext, INPUTS.rickContext)
  };

  const battlefield = readJson(paths.battlefield, {});
  const continuationPaper = readJson(paths.continuationPaper, {});
  const continuationSpecimens = readJson(paths.continuationSpecimens, {});
  const preMigrationSignalQuality = readJson(paths.preMigrationSignalQuality, {});
  const tradeLearningMemory = readJson(paths.tradeLearningMemory, {});
  const rickContext = readJson(paths.rickContext, {});
  const laneScores = buildLaneScores(battlefield, continuationPaper, continuationSpecimens);
  const regime = classifyRegime(battlefield, continuationPaper, continuationSpecimens, laneScores);
  const recommendations = buildRecommendations(battlefield, continuationPaper, tradeLearningMemory, laneScores, regime);
  const lessons = buildLessons(battlefield, continuationPaper, continuationSpecimens, tradeLearningMemory);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'proposal_only',
    inputs: {
      paths,
      battlefieldGeneratedAt: battlefield.generatedAt || null,
      continuationPaperGeneratedAt: continuationPaper.generatedAt || null,
      continuationSpecimensGeneratedAt: continuationSpecimens.generatedAt || null,
      preMigrationSignalQualityGeneratedAt: preMigrationSignalQuality.generatedAt || null,
      tradeLearningMemoryGeneratedAt: tradeLearningMemory.generatedAt || null,
      rickContextGeneratedAt: rickContext.generatedAt || null
    },
    regime,
    laneScores,
    recommendations,
    lessons,
    runSnapshot: {
      session: battlefield.session || null,
      eventCounts: battlefield.eventCounts || {},
      preMigrationPaper: battlefield.preMigrationPaper || {},
      runnerLane: {
        generatedSignals: battlefield.runnerLane?.generatedSignals || 0,
        executedSignals: battlefield.runnerLane?.executedSignals || 0,
        rejectionReasons: battlefield.runnerLane?.rejectionReasons || {},
        pumpGateFailures: battlefield.runnerLane?.pumpGateFailures || {},
        scalperDiagnostics: battlefield.runnerLane?.scalperDiagnostics || {},
        aiTimeoutFallback: battlefield.runnerLane?.aiTimeoutFallback || []
      },
      continuationPaperSummary: continuationPaper.summary || {},
      continuationSpecimenSummary: continuationSpecimens.summary || {},
      tradeLearningMemorySummary: tradeLearningMemory.summary || {},
      walletOutcomeMemory: tradeLearningMemory.walletOutcomeMemory || {},
      topWatch: (battlefield.watchLane?.topWatch || []).slice(0, 8)
    }
  };
}

function printReport(report) {
  console.log('Learning Orchestrator Report');
  console.log('============================');
  console.log(`Regime: ${report.regime.marketRegime} (${Math.round(report.regime.confidence * 100)}%)`);
  console.log(`Reason: ${report.regime.reason}`);
  console.log(`Recommended posture: ${report.recommendations.recommendedPosture}`);
  console.log(`Lane scores: pre=${report.laneScores.preMigration} runner=${report.laneScores.runnerScalper} continuation=${report.laneScores.continuation}`);

  console.log('\nLane Recommendations');
  for (const item of report.recommendations.laneRecommendations) {
    console.log(`  ${item.lane}: ${item.posture} - ${item.rationale}`);
  }

  console.log('\nLessons');
  for (const lesson of report.lessons.slice(0, 8)) {
    console.log(`  [${lesson.severity}] ${lesson.text}`);
  }

  if (report.recommendations.proposedChanges.length > 0) {
    console.log('\nProposals');
    for (const proposal of report.recommendations.proposedChanges) {
      console.log(`  [${proposal.status}/${proposal.confidence}] ${proposal.change}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const latestPath = resolveRepoPath(args.out, DEFAULT_LATEST_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const report = buildReport(args);
  const timestampedPath = path.join(reportDir, `learning-orchestrator-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
  report.files = {
    latestPath,
    timestampedPath
  };
  writeJson(latestPath, report);
  writeJson(timestampedPath, report);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
    console.log(`\nWrote JSON report: ${latestPath}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildReport,
  classifyRegime,
  buildLaneScores
};
