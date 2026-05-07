const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const FIRST_TOUCH_PATH = path.join(ROOT, 'data', 'reports', 'wallet-first-touch-latest.json');
const WALLET_CORR_PATH = path.join(ROOT, 'data', 'reports', 'wallet-first-touch-outcome-corr-latest.json');
const PRE_MIGRATION_SIM_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-paper-sim-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'wallet-sniper-crowded-replay-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function list(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function parseTime(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function runWindow(battlefield = {}) {
  const session = battlefield.session || {};
  const startedAt = session.firstEventAt || session.sessionStartedAt || null;
  const stoppedAt = session.lastEventAt || session.stoppedAt || null;
  return {
    startedAt,
    stoppedAt,
    startedMs: parseTime(startedAt),
    stoppedMs: parseTime(stoppedAt)
  };
}

function buildFirstTouchByMint(firstTouch = {}) {
  const byMint = new Map();
  for (const cluster of list(firstTouch, ['clusters'])) {
    if (!cluster?.mint) continue;
    byMint.set(cluster.mint, {
      firstSeenAt: cluster.firstSeenAt || null,
      lastFirstTouchAt: cluster.lastFirstTouchAt || null
    });
  }
  return byMint;
}

function inRunScope(touch = {}, window = {}) {
  if (!window.startedMs || !window.stoppedMs) return false;
  const firstMs = parseTime(touch.firstSeenAt);
  const lastMs = parseTime(touch.lastFirstTouchAt) || firstMs;
  if (!firstMs && !lastMs) return false;
  return (lastMs || firstMs) >= window.startedMs && (firstMs || lastMs) <= window.stoppedMs;
}

function currentStrategy(preMigrationSim = {}) {
  const strategy = preMigrationSim.strategy || {};
  return {
    minScore: num(strategy.minScore, 75),
    minCurveProgress: num(strategy.minCurveProgress, 0.7),
    minRecentVolumeSol: num(strategy.minRecentVolumeSol, 25),
    minTradeVelocityPerMin: num(strategy.minTradeVelocityPerMin, 25)
  };
}

function outcome(row = {}) {
  return row.outcome || {};
}

function failedChecks(row, strategy) {
  const detail = outcome(row);
  const checks = [];
  if (num(detail.maxScore, 0) < strategy.minScore) checks.push('LOW_SCORE');
  if (num(detail.maxCurveProgress, 0) < strategy.minCurveProgress) checks.push('LOW_CURVE_PROGRESS');
  if (num(detail.maxRecentVolumeSol, 0) < strategy.minRecentVolumeSol) checks.push('LOW_RECENT_VOLUME_SOL');
  if (num(detail.maxTradeVelocityPerMin, 0) < strategy.minTradeVelocityPerMin) checks.push('LOW_TRADE_VELOCITY');
  return checks;
}

function compactRow(row, strategy, touch = {}, window = {}) {
  const detail = outcome(row);
  const failures = failedChecks(row, strategy);
  const paperEntries = num(detail.paperEntries, 0);
  const paperPnlSol = nullableNum(detail.paperPnlSol);
  const paperEntered = paperEntries > 0 || ['PAPER_WIN', 'PAPER_LOSS'].includes(row.outcomeLabel);
  const currentRun = inRunScope(touch, window);

  return {
    mint: row.mint || null,
    symbol: row.symbol || null,
    name: row.name || null,
    clusterArchetype: row.clusterArchetype || null,
    firstTouchScore: num(row.firstTouchScore, 0),
    uniqueWalletCount: num(row.uniqueWalletCount, 0),
    buyWalletCount: num(row.buyWalletCount, 0),
    sellWalletCount: num(row.sellWalletCount, 0),
    totalFirstTouchSol: num(row.totalFirstTouchSol, 0),
    earliestSecondsSinceCreate: nullableNum(row.earliestSecondsSinceCreate),
    firstTouchWindowSeconds: nullableNum(row.firstTouchWindowSeconds),
    firstSeenAt: touch.firstSeenAt || null,
    lastFirstTouchAt: touch.lastFirstTouchAt || null,
    currentRun,
    riskFlags: Array.isArray(row.riskFlags) ? row.riskFlags : [],
    outcomeLabel: row.outcomeLabel || 'UNKNOWN',
    maxScore: nullableNum(detail.maxScore),
    maxCurveProgress: nullableNum(detail.maxCurveProgress),
    maxRecentVolumeSol: nullableNum(detail.maxRecentVolumeSol),
    maxTradeVelocityPerMin: nullableNum(detail.maxTradeVelocityPerMin),
    paperEntries,
    paperEntered,
    paperPnlSol,
    paperResult: row.outcomeLabel === 'PAPER_WIN' ? 'WIN' : row.outcomeLabel === 'PAPER_LOSS' ? 'LOSS' : 'NO_PAPER_RESULT',
    reasons: Array.isArray(detail.reasons) ? detail.reasons.slice(0, 12) : [],
    failedChecks: failures,
    passesCurrentGate: failures.length === 0
  };
}

function summarizeRows(rows) {
  const enteredRows = rows.filter((row) => row.paperEntered);
  const pnlRows = rows.filter((row) => row.paperPnlSol !== null);
  const wins = rows.filter((row) => row.outcomeLabel === 'PAPER_WIN').length;
  const losses = rows.filter((row) => row.outcomeLabel === 'PAPER_LOSS').length;
  const totalPaperPnlSol = Number(pnlRows.reduce((sum, row) => sum + row.paperPnlSol, 0).toFixed(6));
  const movementOutcomes = ['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85', 'PAPER_WIN'];
  const interestingOutcomes = [...movementOutcomes, 'INTERESTING_75'];

  return {
    clusters: rows.length,
    paperEnteredClusters: enteredRows.length,
    totalPaperEntries: rows.reduce((sum, row) => sum + row.paperEntries, 0),
    paperWins: wins,
    paperLosses: losses,
    paperWinRate: pct(wins, wins + losses),
    totalPaperPnlSol,
    averagePaperPnlSol: enteredRows.length ? Number((totalPaperPnlSol / enteredRows.length).toFixed(6)) : null,
    migrationOrNearCount: rows.filter((row) => movementOutcomes.includes(row.outcomeLabel)).length,
    interestingOrBetterCount: rows.filter((row) => interestingOutcomes.includes(row.outcomeLabel)).length,
    outcomeCounts: countBy(rows, (row) => row.outcomeLabel)
  };
}

function buildReport() {
  const battlefield = readJson(BATTLEFIELD_PATH);
  const firstTouch = readJson(FIRST_TOUCH_PATH);
  const walletCorr = readJson(WALLET_CORR_PATH);
  const preMigrationSim = readJson(PRE_MIGRATION_SIM_PATH);
  const strategy = currentStrategy(preMigrationSim);
  const window = runWindow(battlefield);
  const firstTouchByMint = buildFirstTouchByMint(firstTouch);
  const clusters = Array.isArray(walletCorr.clusters) ? walletCorr.clusters : [];
  const rows = clusters
    .filter((row) => row.clusterArchetype === 'sniper_crowded_cluster')
    .map((row) => compactRow(row, strategy, firstTouchByMint.get(row.mint), window));
  const gatePassRows = rows.filter((row) => row.passesCurrentGate);
  const gateFailRows = rows.filter((row) => !row.passesCurrentGate);
  const currentRunRows = rows.filter((row) => row.currentRun);
  const currentRunGatePassRows = currentRunRows.filter((row) => row.passesCurrentGate);
  const currentRunGateFailRows = currentRunRows.filter((row) => !row.passesCurrentGate);
  const failureCounts = {};
  const currentRunFailureCounts = {};

  for (const row of gateFailRows) {
    for (const failure of row.failedChecks) {
      failureCounts[failure] = (failureCounts[failure] || 0) + 1;
    }
  }
  for (const row of currentRunGateFailRows) {
    for (const failure of row.failedChecks) {
      currentRunFailureCounts[failure] = (currentRunFailureCounts[failure] || 0) + 1;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      battlefieldPath: rel(BATTLEFIELD_PATH),
      walletFirstTouchPath: rel(FIRST_TOUCH_PATH),
      walletFirstTouchOutcomeCorrPath: rel(WALLET_CORR_PATH),
      preMigrationPaperSimPath: rel(PRE_MIGRATION_SIM_PATH)
    },
    runWindow: {
      startedAt: window.startedAt,
      stoppedAt: window.stoppedAt,
      scopeRule: 'currentRun=true when wallet first-touch window overlaps run-battlefield session.firstEventAt..session.lastEventAt'
    },
    strategy: {
      ...strategy,
      source: 'data/reports/pre-migration-paper-sim-latest.json.strategy',
      evaluatedFields: [
        'outcome.maxScore',
        'outcome.maxCurveProgress',
        'outcome.maxRecentVolumeSol',
        'outcome.maxTradeVelocityPerMin'
      ]
    },
    summary: {
      sniperCrowdedClusters: rows.length,
      currentRunSniperCrowdedClusters: currentRunRows.length,
      gatePassClusters: gatePassRows.length,
      gateFailClusters: gateFailRows.length,
      gatePassRate: pct(gatePassRows.length, rows.length),
      currentRunGatePassClusters: currentRunGatePassRows.length,
      currentRunGateFailClusters: currentRunGateFailRows.length,
      currentRunGatePassRate: pct(currentRunGatePassRows.length, currentRunRows.length),
      currentRun: summarizeRows(currentRunRows),
      currentRunGatePass: summarizeRows(currentRunGatePassRows),
      currentRunGateFail: summarizeRows(currentRunGateFailRows),
      allSniperCrowded: summarizeRows(rows),
      gatePass: summarizeRows(gatePassRows),
      gateFail: summarizeRows(gateFailRows),
      failureCounts,
      currentRunFailureCounts,
      tinyDenominatorWarning: rows.length < 30 || gatePassRows.length < 10,
      currentRunTinyDenominatorWarning: currentRunRows.length < 10 || currentRunGatePassRows.length < 5,
      interpretation: currentRunRows.length
        ? 'current-run sniper-crowded wallet clusters are available; treat currentRun fields as the clean validation view and cumulative fields as context only'
        : 'no sniper-crowded wallet clusters overlap this run window; cumulative fields are historical context only and should not be treated as repeated run evidence'
    },
    rows,
    currentRunRows,
    topCurrentRunGatePassRows: currentRunGatePassRows
      .slice()
      .sort((a, b) => num(b.paperPnlSol, -999) - num(a.paperPnlSol, -999)
        || num(b.maxCurveProgress, 0) - num(a.maxCurveProgress, 0)
        || b.firstTouchScore - a.firstTouchScore)
      .slice(0, 15),
    topGatePassRows: gatePassRows
      .slice()
      .sort((a, b) => num(b.paperPnlSol, -999) - num(a.paperPnlSol, -999)
        || num(b.maxCurveProgress, 0) - num(a.maxCurveProgress, 0)
        || b.firstTouchScore - a.firstTouchScore)
      .slice(0, 15),
    topGateFailRows: gateFailRows
      .slice()
      .sort((a, b) => num(b.maxCurveProgress, 0) - num(a.maxCurveProgress, 0)
        || num(b.maxScore, 0) - num(a.maxScore, 0)
        || b.firstTouchScore - a.firstTouchScore)
      .slice(0, 15),
    note: 'Report-only sniper-crowded wallet replay. It filters existing wallet first-touch rows by current pre-migration report strategy fields and summarizes paper outcomes. It does not change wallet trust tiers, score weights, thresholds, entries, signals, AI review, quotes, or live behavior.'
  };
}

function main() {
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

main();
