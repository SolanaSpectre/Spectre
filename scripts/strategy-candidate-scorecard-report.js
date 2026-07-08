#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'data', 'reports');
const OUTPUT_PATH = path.join(REPORT_DIR, 'strategy-candidate-scorecard-latest.json');

const REPORTS = {
  liveReadiness: 'live-readiness-latest.json',
  battlefield: 'run-battlefield-latest.json',
  dryRunEntryReplay: 'pre-migration-dry-run-entry-replay-latest.json',
  relaxedGateReplay: 'pre-migration-relaxed-gate-replay-latest.json',
  curveStallRelaxedReplay: 'pre-migration-curve-stall-relaxed-replay-latest.json',
  curveConfirmationReplay: 'pre-migration-curve-confirmation-replay-latest.json',
  walletConditionedRelaxedGateReplay: 'pre-migration-wallet-conditioned-relaxed-gate-replay-latest.json',
  walletConditionedSliceStability: 'pre-migration-wallet-conditioned-slice-stability-latest.json',
  walletContextCoverage: 'pre-migration-wallet-context-coverage-latest.json',
  runnerRejectEntryReplay: 'runner-reject-entry-replay-latest.json',
  walletFalseNegativeEntryReplay: 'wallet-false-negative-entry-replay-latest.json'
};

function readJson(name) {
  const filePath = path.join(REPORT_DIR, name);
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, path: path.relative(ROOT, filePath), error: 'missing file', data: null };
    }
    return {
      ok: true,
      path: path.relative(ROOT, filePath),
      error: null,
      data: JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
    };
  } catch (error) {
    return { ok: false, path: path.relative(ROOT, filePath), error: error.message, data: null };
  }
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 9) {
  const parsed = number(value);
  return parsed === null ? null : Number(parsed.toFixed(digits));
}

function topArray(value, limit = 12) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function hasPositive(value) {
  const parsed = number(value);
  return parsed !== null && parsed > 0;
}

function hasNonPositive(value) {
  const parsed = number(value);
  return parsed !== null && parsed <= 0;
}

function candidateBase({
  lane,
  name,
  sourceReport,
  mode = 'report_only',
  trades,
  wins,
  losses,
  winRate,
  pnlSol,
  stressedPnlSol,
  medianPnlSol,
  p90PnlSol,
  top3RemovedPnlSol,
  firstHalfPnlSol,
  secondHalfPnlSol,
  uniqueMints,
  verdict,
  outlierDominated,
  notes = []
}) {
  return {
    lane,
    name,
    sourceReport,
    mode,
    trades: number(trades, 0),
    uniqueMints: number(uniqueMints),
    wins: number(wins),
    losses: number(losses),
    winRate: round(winRate, 4),
    pnlSol: round(pnlSol),
    stressedPnlSol: round(stressedPnlSol),
    medianPnlSol: round(medianPnlSol),
    p90PnlSol: round(p90PnlSol),
    top3RemovedPnlSol: round(top3RemovedPnlSol),
    firstHalfPnlSol: round(firstHalfPnlSol),
    secondHalfPnlSol: round(secondHalfPnlSol),
    verdict: verdict || null,
    outlierDominated: Boolean(outlierDominated),
    notes
  };
}

function normalizeSummaryCandidate(lane, name, sourceReport, summary = {}, extra = {}) {
  return candidateBase({
    lane,
    name,
    sourceReport,
    trades: summary.trades ?? summary.confirmedEntries ?? summary.candidates,
    wins: summary.wins,
    losses: summary.losses,
    winRate: summary.winRate,
    pnlSol: summary.totalPnlSol ?? summary.pnlSol,
    stressedPnlSol: summary.stressedPnlSol,
    medianPnlSol: summary.pnlStats?.median ?? summary.pnlSol?.median,
    p90PnlSol: summary.pnlStats?.p90 ?? summary.pnlSol?.p90,
    top3RemovedPnlSol: summary.top3RemovedPnlSol ?? summary.pnlAfterRemovingTop3WinnersSol,
    uniqueMints: summary.uniqueMints,
    verdict: summary.verdict,
    outlierDominated: summary.outlierDominated || (summary.verdictTags || []).includes('OUTLIER_DOMINATED'),
    notes: extra.notes || []
  });
}

function addSummaryByProfile(candidates, lane, sourceReport, summaryByProfile = {}) {
  Object.entries(summaryByProfile || {}).forEach(([name, summary]) => {
    candidates.push(normalizeSummaryCandidate(lane, name, sourceReport, summary));
  });
}

function addRelaxedProfiles(candidates, lane, sourceReport, report = {}) {
  const rankingNames = new Set(topArray(report.ranking, 20).map((item) => item.name).filter(Boolean));
  Object.entries(report.profiles || {}).forEach(([name, profile]) => {
    if (rankingNames.size && !rankingNames.has(name)) return;
    candidates.push(normalizeSummaryCandidate(lane, name, sourceReport, profile.summary || {}, {
      notes: [profile.profile?.description].filter(Boolean)
    }));
  });
}

function addRanking(candidates, lane, sourceReport, ranking = {}) {
  topArray(ranking, 20).forEach((item) => {
    candidates.push(candidateBase({
      lane,
      name: item.name || item.profileName || item.profile || 'unknown',
      sourceReport,
      trades: item.trades ?? item.confirmedEntries,
      uniqueMints: item.uniqueMints,
      wins: item.wins,
      losses: item.losses,
      winRate: item.winRate,
      pnlSol: item.totalPnlSol ?? item.pnlSol,
      stressedPnlSol: item.stressedPnlSol,
      medianPnlSol: item.pnlStats?.median ?? item.pnlSol?.median,
      p90PnlSol: item.pnlStats?.p90 ?? item.pnlSol?.p90,
      top3RemovedPnlSol: item.top3RemovedPnlSol ?? item.pnlAfterRemovingTop3WinnersSol,
      firstHalfPnlSol: item.firstHalfPnlSol,
      secondHalfPnlSol: item.secondHalfPnlSol,
      verdict: item.verdict,
      outlierDominated: item.outlierDominated || (item.verdictTags || []).includes('OUTLIER_DOMINATED'),
      notes: [item.condition, item.profileName].filter(Boolean)
    }));
  });
}

function promotionBlockers(candidate, context) {
  const blockers = [];
  const trades = number(candidate.trades, 0);
  const winRate = number(candidate.winRate);
  const minSample = candidate.lane === 'wallet_conditioned_relaxed_gate' ? 60 : 20;

  if (context.paperEntries <= 0) blockers.push('no runtime paper entries in latest evaluated run');
  if (candidate.mode === 'report_only') blockers.push('candidate comes from report-only replay/shadow evidence');
  if (trades < minSample) blockers.push(`sample too small: ${trades}/${minSample} trades`);
  if (!hasPositive(candidate.pnlSol)) blockers.push('total PnL is not positive');
  if (candidate.stressedPnlSol !== null && !hasPositive(candidate.stressedPnlSol)) blockers.push('stressed PnL is not positive');
  if (candidate.medianPnlSol === null && trades > 0) blockers.push('median trade PnL is unavailable');
  else if (hasNonPositive(candidate.medianPnlSol)) blockers.push('median trade PnL is not positive');
  if (candidate.top3RemovedPnlSol === null && trades >= 4) blockers.push('PnL after removing top 3 winners is unavailable');
  else if (candidate.top3RemovedPnlSol !== null && !hasPositive(candidate.top3RemovedPnlSol)) blockers.push('PnL after removing top 3 winners is not positive');
  if (candidate.firstHalfPnlSol !== null && !hasPositive(candidate.firstHalfPnlSol)) blockers.push('first-half PnL is not positive');
  if (candidate.secondHalfPnlSol !== null && !hasPositive(candidate.secondHalfPnlSol)) blockers.push('second-half PnL is not positive');
  if (winRate !== null && winRate < 0.45) blockers.push(`win rate below 45%: ${(winRate * 100).toFixed(1)}%`);
  if (candidate.outlierDominated) blockers.push('outlier dominated');
  if (context.broadcastBlocked) blockers.push('broadcast path remains report-only');

  return [...new Set(blockers)];
}

function scoreCandidate(candidate, blockers) {
  let score = 0;
  const trades = number(candidate.trades, 0);
  const winRate = number(candidate.winRate, 0);

  if (trades >= 60) score += 18;
  else if (trades >= 20) score += 12;
  else if (trades >= 10) score += 5;
  if (hasPositive(candidate.pnlSol)) score += 18;
  if (hasPositive(candidate.stressedPnlSol)) score += 14;
  if (hasPositive(candidate.medianPnlSol)) score += 12;
  if (hasPositive(candidate.top3RemovedPnlSol)) score += 12;
  if (hasPositive(candidate.firstHalfPnlSol) && hasPositive(candidate.secondHalfPnlSol)) score += 10;
  if (winRate >= 0.5) score += 10;
  else if (winRate >= 0.45) score += 6;
  if (candidate.outlierDominated) score -= 20;
  if (candidate.mode === 'report_only') score -= 12;
  score -= Math.min(24, blockers.length * 3);
  return score;
}

function nextDataNeed(candidate, blockers, context) {
  const needs = [];
  const trades = number(candidate.trades, 0);
  const minSample = candidate.lane === 'wallet_conditioned_relaxed_gate' ? 60 : 20;
  if (candidate.lane === 'wallet_conditioned_relaxed_gate' && context.runtimeWalletEvents <= 0) {
    needs.push('restore or validate runtime wallet.trade_observed coverage so wallet-conditioned lanes can collect fresh evidence');
  }
  if (candidate.lane === 'wallet_conditioned_relaxed_gate' && context.paperDecisionsWithWalletContext <= 0) {
    needs.push('produce paper decisions with wallet context attached');
  }
  if (candidate.name === context.walletShadowCollectingSlice && context.walletShadowCollectingReady) {
    needs.push('collect out-of-sample runtime shadow would-enter/exit evidence for the pre-registered frozen wallet slice');
  }
  if (trades < minSample) needs.push(`collect ${minSample - trades} more trade(s) for this lane to reach the ${minSample}-trade floor`);
  if (context.paperEntries <= 0) needs.push('produce nonzero runtime paper entries before any live promotion review');
  if (candidate.mode === 'report_only') needs.push('confirm the lane through runtime paper/shadow telemetry, not historical replay alone');
  if (context.broadcastBlocked) needs.push('keep broadcast disabled until strategy evidence clears launch review');
  if (blockers.some((blocker) => blocker.includes('median trade PnL'))) needs.push('prove median trade PnL turns positive under the same rules');
  if (blockers.some((blocker) => blocker.includes('top 3 winners'))) needs.push('prove PnL survives removing the top 3 winners');
  if (blockers.some((blocker) => blocker.includes('unavailable'))) needs.push('add/report the missing robustness metric before promotion review');
  if (blockers.some((blocker) => blocker.includes('win rate below'))) needs.push('improve or further sample win rate above 45%');
  return [...new Set(needs)].slice(0, 6);
}

function statusFor(candidate, blockers, context) {
  if (
    candidate.lane === 'wallet_conditioned_relaxed_gate'
    && candidate.name === context.walletShadowCollectingSlice
    && context.walletShadowCollectingReady
  ) {
    return 'SHADOW_COLLECTING';
  }
  if (!blockers.length) return candidate.mode === 'report_only' ? 'PROMISING_REPORT_ONLY' : 'PROMOTION_CANDIDATE';
  const candidateBlockers = blockers.filter((blocker) => ![
    'no runtime paper entries in latest evaluated run',
    'candidate comes from report-only replay/shadow evidence',
    'broadcast path remains report-only'
  ].includes(blocker));
  if (!candidateBlockers.length && (context.paperEntries <= 0 || context.broadcastBlocked || candidate.mode === 'report_only')) {
    return 'WATCHLIST_ONLY';
  }
  if (candidateBlockers.some((blocker) => (
    blocker.includes('not positive')
    || blocker.includes('outlier')
    || blocker.includes('median trade PnL is unavailable')
    || blocker.includes('PnL after removing top 3 winners is unavailable')
  ))) return 'REJECTED';
  return 'COLLECT_MORE';
}

function topBlockers(candidates) {
  const counts = {};
  candidates.forEach((candidate) => {
    (candidate.promotionBlockers || []).forEach((blocker) => {
      counts[blocker] = (counts[blocker] || 0) + 1;
    });
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([blocker, count]) => ({ blocker, count }));
}

function main() {
  const docs = Object.fromEntries(
    Object.entries(REPORTS).map(([key, fileName]) => [key, readJson(fileName)])
  );
  const candidates = [];

  addSummaryByProfile(
    candidates,
    'dry_run_first_eligible',
    docs.dryRunEntryReplay.path,
    docs.dryRunEntryReplay.data?.firstPerMint?.summaryByProfile
  );
  addRelaxedProfiles(candidates, 'low_score_first_sight_relaxed_gate', docs.relaxedGateReplay.path, docs.relaxedGateReplay.data);
  addRanking(candidates, 'curve_confirmation', docs.curveConfirmationReplay.path, docs.curveConfirmationReplay.data?.ranking);
  addRelaxedProfiles(candidates, 'curve_stall_relaxed_gate', docs.curveStallRelaxedReplay.path, docs.curveStallRelaxedReplay.data);
  addRanking(candidates, 'wallet_conditioned_relaxed_gate', docs.walletConditionedRelaxedGateReplay.path, docs.walletConditionedRelaxedGateReplay.data?.ranking);
  addSummaryByProfile(candidates, 'runner_reject_entry_replay', docs.runnerRejectEntryReplay.path, docs.runnerRejectEntryReplay.data?.summaryByProfile);
  addRanking(candidates, 'wallet_false_negative_entry_replay', docs.walletFalseNegativeEntryReplay.path, docs.walletFalseNegativeEntryReplay.data?.ranking);

  const paperEntries = number(
    docs.liveReadiness.data?.metrics?.paperEntries,
    number(docs.battlefield.data?.preMigrationPaper?.entries, 0)
  );
  const paperPnl = number(
    docs.liveReadiness.data?.metrics?.paperPnl,
    number(docs.battlefield.data?.preMigrationPaper?.pnlSol, 0)
  );
  const launchBlocks = Array.isArray(docs.liveReadiness.data?.launchBlocks) ? docs.liveReadiness.data.launchBlocks : [];
  const broadcastBlocked = launchBlocks.some((line) => String(line).toLowerCase().includes('broadcast'));
  const walletCoverageRuntime = docs.walletContextCoverage.data?.runtime || {};
  const frozenStability = docs.walletConditionedSliceStability.data || {};
  const context = {
    paperEntries,
    paperPnl,
    broadcastBlocked,
    runtimeWalletEvents: number(walletCoverageRuntime.walletEvents?.rows, 0),
    paperDecisionsWithWalletContext: number(walletCoverageRuntime.decisionCoverage?.withAnyWalletTouch, 0),
    walletCoverageVerdict: docs.walletContextCoverage.data?.verdict || null,
    walletShadowCollectingSlice: frozenStability.frozenHypothesis?.name || null,
    walletShadowCollectingReady: frozenStability.stability?.verdict === 'STABILITY_PASSED_FREEZE_SHADOW_NEXT'
  };

  const scored = candidates.map((candidate) => {
    const blockers = promotionBlockers(candidate, context);
    const status = statusFor(candidate, blockers, context);
    return {
      ...candidate,
      status,
      score: scoreCandidate(candidate, blockers),
      nextDataNeed: nextDataNeed(candidate, blockers, context),
      promotionBlockers: blockers
    };
  }).sort((a, b) => b.score - a.score || number(b.pnlSol, -Infinity) - number(a.pnlSol, -Infinity));

  const statusCounts = scored.reduce((acc, candidate) => {
    acc[candidate.status] = (acc[candidate.status] || 0) + 1;
    return acc;
  }, {});
  const promotionEligible = scored.filter((candidate) => candidate.status === 'PROMOTION_CANDIDATE');
  const reportOnlyPromising = scored.filter((candidate) => candidate.status === 'PROMISING_REPORT_ONLY');

  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_strategy_candidate_scorecard',
    note: 'Ranks report-only replay/shadow candidates and explains why none should graduate to live without runtime paper proof.',
    inputs: Object.fromEntries(Object.entries(docs).map(([key, doc]) => [key, { path: doc.path, ok: doc.ok, error: doc.error }])),
    criteria: {
      runtimePromotion: 'Requires live-readiness infra, broadcast decision review, nonzero runtime paper entries, positive durable PnL, positive median, positive top-3-removed PnL when available, and adequate sample.',
      replayPromotion: 'Report-only replay candidates may enter watchlist/research only; they cannot enable live trading by themselves.',
      minSample: {
        defaultReplayTrades: 20,
        walletConditionedTrades: 60
      }
    },
    summary: {
      liveReadinessVerdict: docs.liveReadiness.data?.verdict || 'unknown',
      bestAction: 'KEEP_LIVE_DISABLED',
      paperEntries,
      paperPnlSol: round(paperPnl),
      launchBlocks,
      candidateCount: scored.length,
      promotionEligibleCount: promotionEligible.length,
      reportOnlyPromisingCount: reportOnlyPromising.length,
      statusCounts,
      walletContextCoverage: {
        verdict: context.walletCoverageVerdict,
        runtimeWalletEvents: context.runtimeWalletEvents,
        paperDecisionsWithWalletContext: context.paperDecisionsWithWalletContext
      },
      walletShadowCollection: {
        frozenSlice: context.walletShadowCollectingSlice,
        stabilityVerdict: frozenStability.stability?.verdict || null,
        collecting: context.walletShadowCollectingReady,
        artifact: docs.walletConditionedSliceStability.path
      },
      topBlockers: topBlockers(scored),
      bestCandidateNextDataNeed: scored[0]?.nextDataNeed || [],
      interpretation: promotionEligible.length
        ? 'At least one runtime candidate cleared the scorecard; review sizing/broadcast controls manually before any live change.'
        : (paperEntries > 0
          ? 'No strategy candidate clears promotion gates. Infrastructure is close, but live trading remains blocked by negative or undersized runtime paper evidence plus replay-only/fragile candidate evidence.'
          : 'No strategy candidate clears promotion gates. Infrastructure is close, but live trading remains blocked by missing runtime paper entries and replay-only/fragile strategy evidence.')
    },
    bestCandidates: scored.slice(0, 12),
    candidates: scored
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output.summary, null, 2));
}

if (require.main === module) {
  main();
}
