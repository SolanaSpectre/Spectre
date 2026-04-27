const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_BATTLEFIELD = path.join(REPO_ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'early-organic-interest');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'early-organic-interest-latest.json');
const DEFAULT_WATCHLIST_PATH = path.join(REPO_ROOT, 'data', 'watchlists', 'early-organic-interest-watchlist-latest.json');

const DEFAULT_THRESHOLDS = {
  minScore: 20,
  maxScore: 65,
  minCurveProgress: 0.12,
  maxCurveProgress: 0.45,
  minRecentVolumeSol: 0.1,
  minTradeVelocityPerMin: 1,
  minInterestSignalCount: 8,
  minUniqueBuyerCount: 5,
  minBuyRatio: 0.6,
  maxRiskWalletCount: 1
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

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, decimals = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : null;
}

function bool(value) {
  return value === true;
}

function thresholdsFromArgs(args) {
  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(thresholds)) {
    if (args[key] !== undefined) {
      thresholds[key] = number(args[key], thresholds[key]);
    }
  }
  return thresholds;
}

function evaluateCandidate(item, thresholds) {
  const score = number(item.score);
  const curveProgress = number(item.curveProgress, null);
  const recentVolumeSol = number(item.recentVolumeSol);
  const tradeVelocityPerMin = number(item.tradeVelocityPerMin);
  const interestSignalCount = number(item.interestSignalCount);
  const uniqueBuyerCount = number(item.uniqueBuyerCount);
  const riskWalletCount = number(item.riskWalletCount);
  const buyRatio = number(item.buyRatio, null);
  const hasPrice = bool(item.hasPrice);
  const failedChecks = Array.isArray(item.failedChecks) ? item.failedChecks : [];

  const pass = {
    scoreFloor: score >= thresholds.minScore,
    scoreCeiling: score <= thresholds.maxScore,
    curveFloor: curveProgress !== null && curveProgress >= thresholds.minCurveProgress,
    curveCeiling: curveProgress !== null && curveProgress <= thresholds.maxCurveProgress,
    volume: recentVolumeSol >= thresholds.minRecentVolumeSol,
    velocity: tradeVelocityPerMin >= thresholds.minTradeVelocityPerMin,
    interest: interestSignalCount >= thresholds.minInterestSignalCount,
    buyers: uniqueBuyerCount >= thresholds.minUniqueBuyerCount,
    buyRatio: buyRatio !== null && buyRatio >= thresholds.minBuyRatio,
    risk: riskWalletCount <= thresholds.maxRiskWalletCount,
    price: hasPrice
  };

  const failed = Object.entries(pass)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  let organicScore = 0;
  organicScore += pass.scoreFloor ? 10 : 0;
  organicScore += pass.scoreCeiling ? 6 : 0;
  organicScore += pass.curveFloor ? 10 : 0;
  organicScore += pass.curveCeiling ? 8 : 0;
  organicScore += pass.volume ? Math.min(14, 6 + recentVolumeSol * 4) : 0;
  organicScore += pass.velocity ? Math.min(12, 6 + tradeVelocityPerMin * 2) : 0;
  organicScore += pass.interest ? Math.min(14, interestSignalCount) : 0;
  organicScore += pass.buyers ? Math.min(14, uniqueBuyerCount * 2) : 0;
  organicScore += pass.buyRatio ? Math.min(10, buyRatio * 10) : 0;
  organicScore += pass.risk ? 6 : -10;
  organicScore += pass.price ? 6 : -12;

  const organicPassCount = Object.values(pass).filter(Boolean).length;
  let verdict = 'reject_noise';
  if (failed.length === 0) {
    verdict = 'shadow_candidate';
  } else if (
    pass.interest
    && pass.buyers
    && pass.buyRatio
    && pass.price
    && failed.length <= 3
  ) {
    verdict = 'monitor_only';
  }

  const reasons = [];
  if (pass.interest) reasons.push(`interest signals ${interestSignalCount}`);
  if (pass.buyers) reasons.push(`unique buyers ${uniqueBuyerCount}`);
  if (pass.buyRatio) reasons.push(`buy ratio ${(buyRatio * 100).toFixed(1)}%`);
  if (pass.volume) reasons.push(`recent volume ${recentVolumeSol.toFixed(4)} SOL`);
  if (pass.velocity) reasons.push(`velocity ${tradeVelocityPerMin.toFixed(2)}/min`);
  if (pass.curveFloor && pass.curveCeiling) reasons.push(`early curve ${(curveProgress * 100).toFixed(1)}%`);
  if (!pass.scoreFloor) reasons.push('low score keeps this shadow-only');
  if (!pass.curveFloor) reasons.push('curve still too early for main lane');
  if (!pass.curveCeiling) reasons.push('curve too late for early-organic lane');
  if (!pass.price) reasons.push('missing price');
  if (!pass.risk) reasons.push('risk wallet count too high');

  return {
    verdict,
    organicScore: Math.max(0, Math.min(100, Math.round(organicScore))),
    organicPassCount,
    failedOrganicChecks: failed,
    originalFailedChecks: failedChecks,
    reasons
  };
}

function summarizeCandidate(item, thresholds) {
  const evaluated = evaluateCandidate(item, thresholds);
  return {
    timestamp: item.timestamp || null,
    mint: item.mint || null,
    symbol: item.symbol || null,
    source: 'first_curve_snapshot_near_miss',
    mode: 'paper_shadow_only',
    score: compact(item.score, 2),
    organicScore: evaluated.organicScore,
    verdict: evaluated.verdict,
    curveProgress: compact(item.curveProgress, 6),
    recentVolumeSol: compact(item.recentVolumeSol, 6),
    tradeVelocityPerMin: compact(item.tradeVelocityPerMin, 3),
    interestSignalCount: item.interestSignalCount ?? null,
    uniqueBuyerCount: item.uniqueBuyerCount ?? null,
    riskWalletCount: item.riskWalletCount ?? null,
    buyRatio: compact(item.buyRatio, 4),
    hasPrice: item.hasPrice ?? null,
    failedOrganicChecks: evaluated.failedOrganicChecks,
    originalFailedChecks: evaluated.originalFailedChecks,
    reasons: evaluated.reasons
  };
}

function buildReport(battlefield, thresholds) {
  const nearMisses = battlefield?.preMigrationPaper?.firstCurveSnapshotNearMissDetail || [];
  const candidates = nearMisses
    .map((item) => summarizeCandidate(item, thresholds))
    .sort((a, b) => b.organicScore - a.organicScore || number(b.score) - number(a.score));
  const shadowCandidates = candidates.filter((item) => item.verdict === 'shadow_candidate');
  const monitorOnly = candidates.filter((item) => item.verdict === 'monitor_only');
  const rejected = candidates.filter((item) => item.verdict === 'reject_noise');

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    lane: 'early_organic_interest_shadow',
    inputs: {
      battlefieldGeneratedAt: battlefield?.generatedAt || null,
      telemetryPath: battlefield?.files?.telemetryPath || null,
      nearMissCount: nearMisses.length,
      thresholds
    },
    summary: {
      shadowCandidates: shadowCandidates.length,
      monitorOnly: monitorOnly.length,
      rejectedNoise: rejected.length,
      topSymbol: candidates[0]?.symbol || null,
      topOrganicScore: candidates[0]?.organicScore || null
    },
    recommendation: shadowCandidates.length > 0
      ? 'Track these paper-shadow candidates through later reports before loosening the main pre-migration gates.'
      : 'No early organic candidate cleared the shadow profile; keep collecting near-miss telemetry.',
    shadowCandidates,
    monitorOnly,
    rejectedNoise: rejected.slice(0, 20)
  };
}

function buildWatchlist(report) {
  const candidates = [...report.shadowCandidates, ...report.monitorOnly]
    .map((item, index) => ({
      rank: index + 1,
      mint: item.mint,
      symbol: item.symbol,
      source: 'early_organic_interest_shadow',
      mode: 'paper_shadow_only',
      verdict: item.verdict,
      score: item.score,
      organicScore: item.organicScore,
      curveProgress: item.curveProgress,
      recentVolumeSol: item.recentVolumeSol,
      tradeVelocityPerMin: item.tradeVelocityPerMin,
      interestSignalCount: item.interestSignalCount,
      uniqueBuyerCount: item.uniqueBuyerCount,
      buyRatio: item.buyRatio,
      reasons: item.reasons
    }));

  return {
    generatedAt: new Date().toISOString(),
    source: 'early_organic_interest_report',
    mode: 'paper_shadow_only',
    count: candidates.length,
    candidates
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const battlefieldPath = resolveRepoPath(args.battlefield, DEFAULT_BATTLEFIELD);
  const latestPath = resolveRepoPath(args.output, DEFAULT_LATEST_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const watchlistPath = resolveRepoPath(args.watchlist, DEFAULT_WATCHLIST_PATH);
  const battlefield = readJson(battlefieldPath, null);

  if (!battlefield) {
    throw new Error(`Battlefield report not found or invalid: ${battlefieldPath}`);
  }

  const thresholds = thresholdsFromArgs(args);
  const report = buildReport(battlefield, thresholds);
  const watchlist = buildWatchlist(report);
  const archivePath = path.join(reportDir, `early-organic-interest-${report.generatedAt.replace(/[:.]/g, '-')}.json`);

  writeJson(latestPath, report);
  writeJson(archivePath, report);
  writeJson(watchlistPath, watchlist);

  console.log(`Early organic shadow candidates: ${report.summary.shadowCandidates}`);
  console.log(`Monitor-only early organic candidates: ${report.summary.monitorOnly}`);
  console.log(report.recommendation);
  console.log(`Wrote JSON report: ${latestPath}`);
  console.log(`Wrote watchlist: ${watchlistPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Failed to build early organic interest report: ${error.message}`);
  process.exit(1);
}
