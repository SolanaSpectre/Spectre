const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const CONTINUATION_PAPER_PATH = path.join(ROOT, 'data', 'reports', 'continuation-paper-latest.json');
const HISTORY_PATH = path.join(ROOT, 'data', 'reports', 'overlay-run-history.json');
const OUTPUT_PATH = path.join(ROOT, 'paper-results.json');

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sumObjectValues(object = {}) {
  return Object.values(object || {}).reduce((sum, value) => sum + number(value), 0);
}

function topKey(object = {}) {
  let best = null;
  for (const [key, value] of Object.entries(object || {})) {
    if (!best || number(value) > best.count) {
      best = { key, count: number(value) };
    }
  }
  return best;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return null;
}

function computeBottleneck(report) {
  const continuationPaper = report.continuationPaper || {};
  if (number(continuationPaper.openPositions) > 0) {
    return 'CONTINUATION_PAPER_OPEN';
  }

  const paperSkips = topKey(report.preMigrationPaper?.skipReasons);
  if (paperSkips) {
    return paperSkips.key;
  }

  const firstCurveChecks = topKey(report.preMigrationPaper?.firstCurveSnapshotNearMissFailedChecks);
  if (firstCurveChecks) {
    return firstCurveChecks.key;
  }

  const runnerRejects = topKey(report.runnerLane?.rejectionReasons);
  if (runnerRejects) {
    return runnerRejects.key;
  }

  const continuationRejects = topKey(report.continuationLane?.rejectedReasons);
  if (continuationRejects) {
    return continuationRejects.key;
  }

  return 'No active bottleneck';
}

function computeActivityCount(report) {
  const paper = report.preMigrationPaper || {};
  const continuationPaper = report.continuationPaper || {};
  const continuationVerdicts = sumObjectValues(report.continuationLane?.verdicts);
  const runnerRejects = number(report.runnerLane?.rejectedTrades);
  const watchCandidates = number(report.watchLane?.uniqueWatchCandidates);
  return number(paper.entries)
    + number(paper.exits)
    + sumObjectValues(paper.decisionCounts)
    + number(paper.firstCurveSnapshotNearMisses)
    + number(paper.rechecks?.scheduled)
    + number(paper.rechecks?.executed)
    + number(paper.rechecks?.skipped)
    + number(paper.rechecks?.failed)
    + number(paper.rechecks?.cancelled)
    + continuationVerdicts
    + number(continuationPaper.openedThisRun)
    + number(continuationPaper.updatedThisRun)
    + number(continuationPaper.closedThisRun)
    + runnerRejects
    + watchCandidates;
}

function computeWinRate(report) {
  const continuationPaper = report.continuationPaper || {};
  const continuationClosed = number(continuationPaper.closedPositions);
  if (continuationClosed > 0) {
    const wins = number(continuationPaper.winningClosedPositions);
    return (wins / continuationClosed) * 100;
  }

  const paper = report.preMigrationPaper || {};
  const wins = number(paper.wins);
  const losses = number(paper.losses);
  const total = wins + losses;
  if (total <= 0) {
    return 0;
  }
  return (wins / total) * 100;
}

function computeAvgPnl(report) {
  const continuationPaper = report.continuationPaper || {};
  const continuationClosed = number(continuationPaper.closedPositions);
  if (continuationClosed > 0) {
    return number(continuationPaper.closedPnlSol) / continuationClosed;
  }

  const paper = report.preMigrationPaper || {};
  const exits = number(paper.exits);
  if (exits <= 0) {
    return 0;
  }
  return number(paper.pnlSol) / exits;
}

function computeAvgPnlUnit(report) {
  return 'SOL';
}

function computeImprovementPct(currentAvgPnl, previousAvgPnl) {
  if (!Number.isFinite(previousAvgPnl) || previousAvgPnl === 0) {
    if (currentAvgPnl > 0) return 100;
    if (currentAvgPnl < 0) return -100;
    return 0;
  }
  return ((currentAvgPnl - previousAvgPnl) / Math.abs(previousAvgPnl)) * 100;
}

function buildRunRecord(report, history) {
  const runIdentity = report.files?.telemetryPath || report.session?.firstEventAt || report.generatedAt;
  const existingIndex = history.findIndex((item) => (item.runIdentity || item.telemetryPath || item.reportGeneratedAt) === runIdentity);
  const previous = existingIndex > 0
    ? history[existingIndex - 1]
    : history[history.length - 1];
  const runNumber = existingIndex >= 0
    ? history[existingIndex].runNumber
    : number(history[history.length - 1]?.runNumber) + 1 || 1;
  const avgPnlSol = computeAvgPnl(report);

  return {
    runNumber,
    runIdentity,
    reportGeneratedAt: report.generatedAt,
    telemetryPath: report.files?.telemetryPath || null,
    startedAt: report.session?.firstEventAt || null,
    endedAt: report.session?.lastEventAt || null,
    durationMinutes: number(report.session?.durationMinutes),
    winRatePct: computeWinRate(report),
    avgPnlSol,
    avgPnlUnit: computeAvgPnlUnit(report),
    improvementPct: computeImprovementPct(avgPnlSol, number(previous?.avgPnlSol, 0)),
    simulationsDone: computeActivityCount(report),
    bottleneck: computeBottleneck(report),
    entries: number(report.preMigrationPaper?.entries),
    exits: number(report.preMigrationPaper?.exits),
    wins: number(report.preMigrationPaper?.wins),
    losses: number(report.preMigrationPaper?.losses),
    paperPnlSol: number(report.preMigrationPaper?.pnlSol),
    nearMisses: number(report.preMigrationPaper?.firstCurveSnapshotNearMisses),
    watchCandidates: number(report.watchLane?.uniqueWatchCandidates),
    continuationConfirmed: number(report.eventCounts?.['post_migration_continuation.confirmed']),
    continuationWatch: number(report.eventCounts?.['post_migration_continuation.watch']),
    continuationPaperOpened: number(report.continuationPaper?.openedThisRun),
    continuationPaperUpdated: number(report.continuationPaper?.updatedThisRun),
    continuationPaperClosed: number(report.continuationPaper?.closedThisRun),
    continuationPaperOpenPositions: number(report.continuationPaper?.openPositions),
    continuationPaperPnlUsd: number(report.continuationPaper?.totalMarkedPnlUsd),
    continuationPaperPnlSol: number(report.continuationPaper?.totalMarkedPnlSol),
    continuationPaperSolUsdPrice: number(report.continuationPaper?.solUsdPrice),
    runnerRejected: number(report.runnerLane?.rejectedTrades)
  };
}

function buildStatus(record) {
  if (record.continuationPaperOpened > 0) {
    return 'CONTINUATION PAPER OPENED';
  }

  if (record.continuationPaperOpenPositions > 0) {
    return 'CONTINUATION PAPER OPEN';
  }

  if (record.continuationConfirmed > 0) {
    return 'CONTINUATION CONFIRMED';
  }

  if (record.entries > 0 || record.exits > 0) {
    return 'PAPER TRADES TRACKED';
  }

  if (record.nearMisses > 0) {
    return 'PAPER NEAR MISSES';
  }

  if (record.watchCandidates > 0) {
    return 'WATCH CANDIDATES';
  }

  return 'PAPER MODE';
}

function runTimestamp(record) {
  return new Date(record.startedAt || record.reportGeneratedAt || 0).getTime();
}

function runIdentity(record) {
  return record.runIdentity || record.telemetryPath || record.startedAt || record.reportGeneratedAt;
}

function normalizeHistory(history) {
  const byIdentity = new Map();

  for (const item of history) {
    if (!item?.reportGeneratedAt) {
      continue;
    }

    const identity = runIdentity(item);
    if (!identity) {
      continue;
    }

    const existing = byIdentity.get(identity);
    byIdentity.set(identity, {
      ...existing,
      ...item,
      runIdentity: identity
    });
  }

  return Array.from(byIdentity.values())
    .sort((a, b) => runTimestamp(a) - runTimestamp(b))
    .map((item, index) => ({
      ...item,
      runNumber: index + 1
    }));
}

function migrateHistoryPnlToSol(history, solUsdPrice) {
  const price = Number(solUsdPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return history;
  }

  return history.map((item) => {
    if (item?.avgPnlUnit !== 'USD') {
      return item;
    }

    const avgPnlUsd = Number(item.avgPnlSol);
    const totalPnlUsd = Number(item.continuationPaperPnlUsd);
    return {
      ...item,
      avgPnlSol: Number.isFinite(avgPnlUsd) ? avgPnlUsd / price : item.avgPnlSol,
      avgPnlUnit: 'SOL',
      continuationPaperPnlSol: Number.isFinite(totalPnlUsd) ? totalPnlUsd / price : item.continuationPaperPnlSol,
      continuationPaperSolUsdPrice: price
    };
  });
}

function main() {
  const report = readJson(REPORT_PATH);
  if (!report) {
    throw new Error(`Missing battlefield report: ${REPORT_PATH}`);
  }
  const continuationPaper = readJson(CONTINUATION_PAPER_PATH, null);
  if (continuationPaper?.summary) {
    report.continuationPaper = {
      openedThisRun: number(continuationPaper.summary.openedThisRun),
      updatedThisRun: number(continuationPaper.summary.updatedThisRun),
      closedThisRun: number(continuationPaper.summary.closedThisRun),
      openPositions: number(continuationPaper.summary.openPositions),
      closedPositions: number(continuationPaper.summary.closedPositions),
      winningClosedPositions: Array.isArray(continuationPaper.recentClosedPositions)
        ? continuationPaper.recentClosedPositions.filter((position) => number(position.pnlUsd) > 0).length
        : 0,
      openPnlUsd: number(continuationPaper.summary.openPnlUsd),
      closedPnlUsd: number(continuationPaper.summary.closedPnlUsd),
      totalMarkedPnlUsd: number(continuationPaper.summary.totalMarkedPnlUsd),
      openPnlSol: number(continuationPaper.summary.openPnlSol),
      closedPnlSol: number(continuationPaper.summary.closedPnlSol),
      totalMarkedPnlSol: number(continuationPaper.summary.totalMarkedPnlSol),
      solUsdPrice: number(continuationPaper.solUsdPrice),
      positionsByProfile: continuationPaper.summary.positionsByProfile || {},
      openedByProfile: continuationPaper.summary.openedByProfile || {},
      exitsByReason: continuationPaper.summary.exitsByReason || {},
      openSymbols: Array.isArray(continuationPaper.openPositions)
        ? continuationPaper.openPositions.slice(0, 5).map((position) => position.symbol || position.mint)
        : []
    };
  }

  const historyFile = readJson(HISTORY_PATH, { runs: [] });
  const history = migrateHistoryPnlToSol(
    normalizeHistory(Array.isArray(historyFile?.runs) ? historyFile.runs : []),
    report.continuationPaper?.solUsdPrice
  );
  const record = buildRunRecord(report, history);
  const existingIndex = history.findIndex((item) => runIdentity(item) === record.runIdentity);

  if (existingIndex >= 0) {
    history[existingIndex] = record;
  } else {
    history.push(record);
  }

  const sortedHistory = migrateHistoryPnlToSol(normalizeHistory(history), record.continuationPaperSolUsdPrice);
  const lastRuns = sortedHistory.slice(-5).reverse();
  const latest = lastRuns[0] || record;

  const overlay = {
    status: buildStatus(latest),
    lastUpdated: firstNonEmpty(report.generatedAt, latest.endedAt, new Date().toISOString()),
    currentRun: {
      runNumber: latest.runNumber,
      winRatePct: Number(latest.winRatePct.toFixed(2)),
      avgPnlSol: Number(latest.avgPnlSol.toFixed(6)),
      avgPnlUnit: latest.avgPnlUnit || 'SOL',
      improvementPct: Number(latest.improvementPct.toFixed(2)),
      simulationsDone: latest.simulationsDone,
      bottleneck: latest.bottleneck,
      mode: 'PAPER RUNS ONLY',
      note: latest.continuationPaperOpenPositions > 0
        ? `${latest.continuationPaperOpenPositions} continuation paper open`
        : latest.exits > 0
        ? `${latest.exits} paper exits tracked`
        : `${latest.simulationsDone} paper/research events tracked`
    },
    lastRuns: lastRuns.map((item) => ({
      runNumber: item.runNumber,
      winRatePct: Number(number(item.winRatePct).toFixed(2)),
      avgPnlSol: Number(number(item.avgPnlSol).toFixed(6)),
      avgPnlUnit: item.avgPnlUnit || 'SOL',
      bottleneck: item.bottleneck || 'None'
    }))
  };

  writeJson(HISTORY_PATH, { runs: sortedHistory });
  writeJson(OUTPUT_PATH, overlay);

  console.log(`Updated overlay JSON: ${OUTPUT_PATH}`);
  console.log(`Run #${latest.runNumber}: winRate=${overlay.currentRun.winRatePct}% avgPnl=${overlay.currentRun.avgPnlSol} bottleneck=${latest.bottleneck}`);
}

main();
