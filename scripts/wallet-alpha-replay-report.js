const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_WALLET_OUTCOMES_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-outcomes-latest.json');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'wallet-alpha-replay');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-alpha-replay-latest.json');

const BOOST_SCENARIOS = [
  { label: 'wallet_soft_plus_2', boost: 2 },
  { label: 'wallet_soft_plus_4', boost: 4 },
  { label: 'wallet_aggressive_plus_6', boost: 6 }
];

const WATCH_THRESHOLDS = [
  { lane: 'first_sight', threshold: 84 },
  { lane: 'early_surge', threshold: 84 },
  { lane: 'early_acceleration', threshold: 84.5 },
  { lane: 'strict_premigration', threshold: 85 }
];

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function scoreAfterBoost(score, boost) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;
  return compact(numeric + boost, 4);
}

function closestThreshold(score) {
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return null;

  return WATCH_THRESHOLDS
    .map((item) => ({
      ...item,
      distance: compact(item.threshold - numeric, 4)
    }))
    .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))[0] || null;
}

function crossesThreshold(score, boost) {
  const boosted = scoreAfterBoost(score, boost);
  if (boosted === null) return [];

  return WATCH_THRESHOLDS
    .filter((item) => boosted >= item.threshold)
    .map((item) => item.lane);
}

function classifySafety(record) {
  const flags = [];
  const wallet = record.wallet || {};
  const spectre = record.spectre || {};
  const walletPnl = record.walletRealizedPnl || {};
  const score = Number(spectre.bestWatchScore);
  const curve = Number(spectre.latestCurveProgress);
  const pnl = Number(walletPnl.totalRealizedPnlSol || 0);
  const winners = Number(walletPnl.winnerWalletCount || 0);
  const losers = Number(walletPnl.loserWalletCount || 0);

  if (!Number.isFinite(score)) flags.push('missing_watch_score');
  if (!Number.isFinite(curve)) flags.push('missing_curve_progress');
  if (Number(wallet.avoidTouches || 0) > Number(wallet.trustedTouches || 0)) flags.push('avoid_wallet_dominated');
  if (pnl <= 0 || winners <= losers) flags.push('wallet_pnl_not_clean_positive');
  if (asArray(spectre.skipReasons).some((item) => item.reason === 'CURVE_NOT_ADVANCING')) flags.push('curve_not_advancing');
  if (asArray(spectre.tags).some((item) => item.tag === 'sniper_presence')) flags.push('sniper_presence');
  if (Number.isFinite(curve) && curve < 0.7) flags.push('early_curve');
  if (Number.isFinite(curve) && curve > 0.92) flags.push('late_curve');

  return flags;
}

function buildReplayItem(record) {
  const spectre = record.spectre || {};
  const walletPnl = record.walletRealizedPnl || {};
  const score = Number(spectre.bestWatchScore);
  const validScore = Number.isFinite(score) ? score : null;
  const nearest = closestThreshold(validScore);
  const safetyFlags = classifySafety(record);
  const scenarios = BOOST_SCENARIOS.map((scenario) => {
    const boostedScore = scoreAfterBoost(validScore, scenario.boost);
    return {
      ...scenario,
      boostedScore,
      crossedLanes: crossesThreshold(validScore, scenario.boost),
      wouldCrossAnyThreshold: crossesThreshold(validScore, scenario.boost).length > 0
    };
  });

  const actionableScenarios = scenarios.filter((scenario) => scenario.wouldCrossAnyThreshold);
  const cleanWalletPositive = Number(walletPnl.totalRealizedPnlSol || 0) > 0
    && Number(walletPnl.winnerWalletCount || 0) > Number(walletPnl.loserWalletCount || 0);

  let replayVerdict = 'collect_more_evidence';
  if (record.recommendation === 'review_wallet_pnl_positive_skip' && actionableScenarios.length > 0) {
    replayVerdict = safetyFlags.includes('avoid_wallet_dominated')
      ? 'wallet_boost_crosses_threshold_but_avoid_caution'
      : 'wallet_boost_would_have_crossed_threshold';
  } else if (record.recommendation === 'review_wallet_pnl_positive_skip' && cleanWalletPositive) {
    replayVerdict = 'wallet_positive_but_boost_insufficient';
  } else if (record.recommendation === 'reinforce_wallet_supported_trade') {
    replayVerdict = 'reinforce_existing_trade_overlap';
  } else if (record.recommendation === 'study_profitable_avoid_wallet_behavior') {
    replayVerdict = 'study_profitable_avoid_wallet_separately';
  }

  return {
    mint: record.mint,
    symbol: record.symbol || null,
    sourceRecommendation: record.recommendation,
    replayVerdict,
    spectre: {
      traded: Boolean(spectre.traded),
      skipped: Boolean(spectre.skipped),
      bestWatchScore: validScore,
      latestWatchScore: compact(spectre.latestWatchScore, 4),
      latestCurveProgress: compact(spectre.latestCurveProgress, 6),
      nearestThreshold: nearest,
      skipReasons: asArray(spectre.skipReasons).slice(0, 8),
      tags: asArray(spectre.tags).slice(0, 12)
    },
    walletRealizedPnl: {
      walletCount: Number(walletPnl.walletCount || 0),
      realizedWalletCount: Number(walletPnl.realizedWalletCount || 0),
      winnerWalletCount: Number(walletPnl.winnerWalletCount || 0),
      loserWalletCount: Number(walletPnl.loserWalletCount || 0),
      totalRealizedPnlSol: compact(walletPnl.totalRealizedPnlSol, 8),
      topWallets: asArray(walletPnl.topWallets).slice(0, 5)
    },
    walletTouchContext: {
      trustedTouches: Number(record.wallet?.trustedTouches || 0),
      avoidTouches: Number(record.wallet?.avoidTouches || 0),
      mixedTouches: Number(record.wallet?.mixedTouches || 0),
      unknownTouches: Number(record.wallet?.unknownTouches || 0),
      topWallets: asArray(record.wallet?.topWallets).slice(0, 5)
    },
    safetyFlags,
    boostScenarios: scenarios
  };
}

function shouldReplay(record) {
  if (!record || !record.walletRealizedPnl) return false;
  const recommendation = record.recommendation || '';
  return [
    'review_wallet_pnl_positive_skip',
    'reinforce_wallet_supported_trade',
    'study_profitable_avoid_wallet_behavior',
    'monitor_profitable_trusted_wallet_behavior',
    'monitor_wallet_supported_untraded_candidate',
    'escalate_wallet_supported_high_score',
    'penalize_wallet_pnl_negative_trade'
  ].includes(recommendation);
}

function buildReport(args = {}) {
  const walletOutcomesPath = resolveRepoPath(args.walletOutcomes, DEFAULT_WALLET_OUTCOMES_PATH);
  const walletOutcomes = readJson(walletOutcomesPath, {});
  const records = asArray(walletOutcomes.allRecords).filter(shouldReplay).map(buildReplayItem);

  const byVerdict = records.reduce((acc, item) => {
    acc[item.replayVerdict] = (acc[item.replayVerdict] || 0) + 1;
    return acc;
  }, {});

  const thresholdCrossCandidates = records.filter((item) => (
    item.boostScenarios.some((scenario) => scenario.wouldCrossAnyThreshold)
  ));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_alpha_replay',
    caveat: 'Wallet realized PnL is a soft research signal only. This report does not mutate trading config or approve live entries.',
    inputs: {
      walletOutcomesPath,
      walletOutcomesGeneratedAt: walletOutcomes.generatedAt || null
    },
    assumptions: {
      boostScenarios: BOOST_SCENARIOS,
      thresholds: WATCH_THRESHOLDS,
      rule: 'Apply hypothetical wallet score boost to Spectre bestWatchScore and report whether the boosted score would cross known pre-migration watch/paper thresholds.'
    },
    summary: {
      replayedMints: records.length,
      thresholdCrossCandidates: thresholdCrossCandidates.length,
      byVerdict
    },
    priorityReview: records
      .filter((item) => [
        'wallet_boost_would_have_crossed_threshold',
        'wallet_boost_crosses_threshold_but_avoid_caution',
        'wallet_positive_but_boost_insufficient',
        'reinforce_existing_trade_overlap'
      ].includes(item.replayVerdict))
      .sort((a, b) => Number(b.walletRealizedPnl.totalRealizedPnlSol || 0) - Number(a.walletRealizedPnl.totalRealizedPnlSol || 0)),
    allReplays: records
  };
}

function printReport(report) {
  console.log('============================');
  console.log('Wallet Alpha Replay Report');
  console.log('============================');
  console.log(`Replayed mints: ${report.summary.replayedMints}`);
  console.log(`Threshold-cross candidates: ${report.summary.thresholdCrossCandidates}`);
  console.log(`Verdicts: ${JSON.stringify(report.summary.byVerdict)}`);

  if (report.priorityReview.length > 0) {
    console.log('\nPriority Review');
    report.priorityReview.slice(0, 10).forEach((item, index) => {
      const bestScenario = item.boostScenarios.find((scenario) => scenario.wouldCrossAnyThreshold);
      const scenarioText = bestScenario
        ? `${bestScenario.label}->${bestScenario.boostedScore}`
        : 'no threshold cross';
      console.log(
        `${index + 1}. ${item.symbol || item.mint} | ${item.replayVerdict} | score=${item.spectre.bestWatchScore} | ${scenarioText} | walletPnl=${item.walletRealizedPnl.totalRealizedPnlSol} SOL`
      );
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latest, DEFAULT_LATEST_PATH);
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-alpha-replay-${stamp}.json`);

  writeJson(reportPath, report);
  writeJson(latestPath, {
    ...report,
    files: {
      reportPath,
      latestPath
    }
  });

  printReport(report);
  console.log(`\nWrote wallet alpha replay: ${reportPath}`);
  console.log(`Wrote latest wallet alpha replay: ${latestPath}`);
}

main();
