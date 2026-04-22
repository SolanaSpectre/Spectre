const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'pre-migration-outcomes-latest.json');

const THRESHOLDS = [
  { key: 'curve75At', label: '75%', value: 0.75 },
  { key: 'curve85At', label: '85%', value: 0.85 },
  { key: 'curve95At', label: '95%', value: 0.95 },
  { key: 'curve100At', label: '100%', value: 1 }
];

function resolveRepoPath(filePath) {
  if (!filePath) {
    return null;
  }

  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

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

function resolveLatestTelemetry(logDir) {
  const candidates = fs.readdirSync(logDir)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return { fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return candidates[0]?.fullPath || null;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) {
    return null;
  }

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }

  return Number(((endMs - startMs) / 1000).toFixed(2));
}

function compactNumber(value, decimals = 2) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function formatDeltaSeconds(value, label) {
  if (!Number.isFinite(value)) {
    return `${label} n/a`;
  }

  if (value < 0) {
    return `already ${label} at flag`;
  }

  return `${value}s to ${label}`;
}

function createRecord(mint) {
  return {
    mint,
    symbol: null,
    name: null,
    firstSeenAt: null,
    firstFlagAt: null,
    lastFlagAt: null,
    flagCount: 0,
    observedCount: 0,
    curveUpdateCount: 0,
    maxScore: 0,
    maxCurveProgress: null,
    firstFlagCurveProgress: null,
    lastCurveProgress: null,
    maxTradeVelocityPerMin: 0,
    maxRecentVolumeSol: 0,
    maxVirtualSolReservesSol: null,
    maxRealSolReservesSol: null,
    completeAt: null,
    curve75At: null,
    curve85At: null,
    curve95At: null,
    curve100At: null,
    pumpFails: {},
    tradeRejections: {},
    reasons: new Set(),
    curveSamples: []
  };
}

function getRecord(records, mint) {
  if (!records.has(mint)) {
    records.set(mint, createRecord(mint));
  }

  return records.get(mint);
}

function updateThresholdTimes(record, timestamp, curveProgress) {
  if (!Number.isFinite(curveProgress)) {
    return;
  }

  for (const threshold of THRESHOLDS) {
    if (!record[threshold.key] && curveProgress >= threshold.value) {
      record[threshold.key] = timestamp;
    }
  }
}

function classifyOutcome(record) {
  if (record.completeAt || record.curve100At || Number(record.maxCurveProgress || 0) >= 1) {
    return 'COMPLETED_CURVE';
  }

  if (record.curve95At || Number(record.maxCurveProgress || 0) >= 0.95) {
    return 'NEAR_COMPLETE_95';
  }

  if (record.curve85At || Number(record.maxCurveProgress || 0) >= 0.85) {
    return 'NEAR_MIGRATION_85';
  }

  if (Object.keys(record.pumpFails).length > 0 || Object.keys(record.tradeRejections).length > 0) {
    return 'RUNNER_REJECTED_AFTER_FLAG';
  }

  if (Number(record.maxCurveProgress || 0) >= 0.75) {
    return 'WATCHLIST_75';
  }

  return 'WATCH_ONLY';
}

function buildReport(events, telemetryPath) {
  const records = new Map();
  const eventCounts = {};
  let firstTimestamp = null;
  let lastTimestamp = null;
  let sessionStarted = null;
  let sessionStopped = null;

  for (const event of events) {
    const type = event.type || event.event || event.name;
    const payload = event.payload || event.data || {};
    const timestamp = event.timestamp || payload.timestamp || null;

    if (type) {
      eventCounts[type] = (eventCounts[type] || 0) + 1;
    }

    if (timestamp && (!firstTimestamp || timestamp < firstTimestamp)) {
      firstTimestamp = timestamp;
    }

    if (timestamp && (!lastTimestamp || timestamp > lastTimestamp)) {
      lastTimestamp = timestamp;
    }

    if (type === 'session.started') {
      sessionStarted = payload;
    } else if (type === 'session.stopped') {
      sessionStopped = payload;
    }

    const mint = payload.mint || payload.token || payload.mintAddress;
    if (!mint) {
      continue;
    }

    const record = getRecord(records, mint);
    record.firstSeenAt = record.firstSeenAt || timestamp;
    record.symbol = record.symbol || payload.symbol || null;
    record.name = record.name || payload.name || null;

    const score = Number(payload.score);
    const curveProgress = Number(payload.curveProgress);
    const velocity = Number(payload.tradeVelocityPerMin);
    const volume = Number(payload.recentVolumeSol);
    const virtualSol = Number(payload.virtualSolReservesSol);
    const realSol = Number(payload.realSolReservesSol);

    if (Number.isFinite(score)) {
      record.maxScore = Math.max(record.maxScore, score);
    }

    if (Number.isFinite(curveProgress)) {
      record.maxCurveProgress = Math.max(record.maxCurveProgress ?? 0, curveProgress);
      record.lastCurveProgress = curveProgress;
      updateThresholdTimes(record, timestamp, curveProgress);

      if (record.curveSamples.length < 30 || type === 'pre_migration.flagged' || curveProgress >= 0.85) {
        record.curveSamples.push({
          timestamp,
          type,
          curveProgress: compactNumber(curveProgress, 6),
          score: compactNumber(score, 2),
          velocity: compactNumber(velocity, 2),
          recentVolumeSol: compactNumber(volume, 4)
        });
      }
    }

    if (Number.isFinite(velocity)) {
      record.maxTradeVelocityPerMin = Math.max(record.maxTradeVelocityPerMin, velocity);
    }

    if (Number.isFinite(volume)) {
      record.maxRecentVolumeSol = Math.max(record.maxRecentVolumeSol, volume);
    }

    if (Number.isFinite(virtualSol)) {
      record.maxVirtualSolReservesSol = Math.max(record.maxVirtualSolReservesSol ?? 0, virtualSol);
    }

    if (Number.isFinite(realSol)) {
      record.maxRealSolReservesSol = Math.max(record.maxRealSolReservesSol ?? 0, realSol);
    }

    if (Array.isArray(payload.reasons)) {
      payload.reasons.forEach((reason) => record.reasons.add(reason));
    }

    if (type === 'pre_migration.observed') {
      record.observedCount += 1;
    } else if (type === 'pre_migration.flagged') {
      record.flagCount += 1;
      record.firstFlagAt = record.firstFlagAt || timestamp;
      record.lastFlagAt = timestamp;
      if (record.firstFlagCurveProgress === null && Number.isFinite(curveProgress)) {
        record.firstFlagCurveProgress = curveProgress;
      }
    } else if (type === 'pump_bonding_curve.updated') {
      record.curveUpdateCount += 1;
      if (payload.complete && !record.completeAt) {
        record.completeAt = timestamp;
      }
    } else if (type === 'pump.momentum_gate_failed') {
      const reason = payload.reason || 'UNKNOWN';
      record.pumpFails[reason] = (record.pumpFails[reason] || 0) + 1;
    } else if (type === 'trade.rejected') {
      const reason = payload.reason || 'UNKNOWN';
      record.tradeRejections[reason] = (record.tradeRejections[reason] || 0) + 1;
    }
  }

  const outcomes = Array.from(records.values())
    .filter((record) => record.flagCount > 0)
    .map((record) => {
      const outcome = classifyOutcome(record);
      return {
        mint: record.mint,
        symbol: record.symbol,
        name: record.name,
        outcome,
        firstSeenAt: record.firstSeenAt,
        firstFlagAt: record.firstFlagAt,
        lastFlagAt: record.lastFlagAt,
        flagCount: record.flagCount,
        observedCount: record.observedCount,
        curveUpdateCount: record.curveUpdateCount,
        maxScore: compactNumber(record.maxScore, 2),
        firstFlagCurveProgress: compactNumber(record.firstFlagCurveProgress, 6),
        maxCurveProgress: compactNumber(record.maxCurveProgress, 6),
        lastCurveProgress: compactNumber(record.lastCurveProgress, 6),
        maxTradeVelocityPerMin: compactNumber(record.maxTradeVelocityPerMin, 2),
        maxRecentVolumeSol: compactNumber(record.maxRecentVolumeSol, 4),
        maxVirtualSolReservesSol: compactNumber(record.maxVirtualSolReservesSol, 6),
        maxRealSolReservesSol: compactNumber(record.maxRealSolReservesSol, 6),
        completeAt: record.completeAt,
        curve75At: record.curve75At,
        curve85At: record.curve85At,
        curve95At: record.curve95At,
        curve100At: record.curve100At,
        secondsFlagTo75: secondsBetween(record.firstFlagAt, record.curve75At),
        secondsFlagTo85: secondsBetween(record.firstFlagAt, record.curve85At),
        secondsFlagTo95: secondsBetween(record.firstFlagAt, record.curve95At),
        secondsFlagTo100: secondsBetween(record.firstFlagAt, record.curve100At || record.completeAt),
        pumpFails: record.pumpFails,
        tradeRejections: record.tradeRejections,
        reasons: Array.from(record.reasons),
        curveSamples: record.curveSamples.slice(-40)
      };
    })
    .sort((a, b) => {
      const outcomeWeight = {
        COMPLETED_CURVE: 5,
        NEAR_COMPLETE_95: 4,
        NEAR_MIGRATION_85: 3,
        WATCHLIST_75: 2,
        RUNNER_REJECTED_AFTER_FLAG: 1,
        WATCH_ONLY: 0
      };
      const weightDelta = (outcomeWeight[b.outcome] || 0) - (outcomeWeight[a.outcome] || 0);
      if (weightDelta !== 0) return weightDelta;
      return Number(b.maxScore || 0) - Number(a.maxScore || 0);
    });

  const runDurationMinutes = firstTimestamp && lastTimestamp
    ? compactNumber((new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 60000, 2)
    : null;
  const outcomeCounts = outcomes.reduce((accumulator, row) => {
    accumulator[row.outcome] = (accumulator[row.outcome] || 0) + 1;
    return accumulator;
  }, {});
  const leadSamples85 = outcomes
    .map((row) => row.secondsFlagTo85)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const leadSamples100 = outcomes
    .map((row) => row.secondsFlagTo100)
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath,
    run: {
      firstTimestamp,
      lastTimestamp,
      runDurationMinutes,
      sessionStarted,
      sessionStopped,
      eventCounts
    },
    summary: {
      uniqueFlags: outcomes.length,
      totalFlagEvents: eventCounts['pre_migration.flagged'] || 0,
      curveUpdates: eventCounts['pump_bonding_curve.updated'] || 0,
      outcomeCounts,
      leadTimeTo85Seconds: summarizeNumeric(leadSamples85),
      leadTimeTo100Seconds: summarizeNumeric(leadSamples100)
    },
    topCompletedOrNearMigration: outcomes
      .filter((row) => ['COMPLETED_CURVE', 'NEAR_COMPLETE_95', 'NEAR_MIGRATION_85'].includes(row.outcome))
      .slice(0, 25),
    topRunnerRejectedAfterFlag: outcomes
      .filter((row) => Object.keys(row.pumpFails || {}).length > 0 || Object.keys(row.tradeRejections || {}).length > 0)
      .sort((a, b) => Number(b.maxScore || 0) - Number(a.maxScore || 0))
      .slice(0, 25),
    outcomes
  };
}

function summarizeNumeric(values) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];

  return {
    count: sorted.length,
    min: compactNumber(sorted[0], 2),
    p50: compactNumber(percentile(0.5), 2),
    p90: compactNumber(percentile(0.9), 2),
    max: compactNumber(sorted[sorted.length - 1], 2),
    avg: compactNumber(sum / sorted.length, 2)
  };
}

function printReport(report) {
  console.log('Pre-Migration Outcome Report');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Run duration: ${report.run.runDurationMinutes || 0} min`);
  console.log(`Flags: ${report.summary.uniqueFlags} unique / ${report.summary.totalFlagEvents} events`);
  console.log(`Curve updates: ${report.summary.curveUpdates}`);
  console.log(`Outcomes: ${Object.entries(report.summary.outcomeCounts).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  console.log(`Lead to 85%: ${report.summary.leadTimeTo85Seconds ? JSON.stringify(report.summary.leadTimeTo85Seconds) : 'n/a'}`);
  console.log(`Lead to 100%: ${report.summary.leadTimeTo100Seconds ? JSON.stringify(report.summary.leadTimeTo100Seconds) : 'n/a'}`);
  console.log('');

  if (report.topCompletedOrNearMigration.length > 0) {
    console.log('Top Completed / Near-Migration Flags:');
    report.topCompletedOrNearMigration.slice(0, 12).forEach((row, index) => {
      const lead85 = formatDeltaSeconds(row.secondsFlagTo85, '85%');
      const lead100 = formatDeltaSeconds(row.secondsFlagTo100, '100%');
      console.log(`${index + 1}. ${row.symbol || 'unknown'} ${row.mint} | ${row.outcome} | score=${row.maxScore} curve=${row.maxCurveProgress} | ${lead85}, ${lead100}`);
      console.log(`   flags=${row.flagCount} velocity=${row.maxTradeVelocityPerMin}/min volume=${row.maxRecentVolumeSol} SOL reasons=${row.reasons.slice(0, 6).join(',')}`);
    });
  }

  if (report.topRunnerRejectedAfterFlag.length > 0) {
    console.log('');
    console.log('Top Runner Rejections After Watch Flag:');
    report.topRunnerRejectedAfterFlag.slice(0, 10).forEach((row, index) => {
      console.log(`${index + 1}. ${row.symbol || 'unknown'} ${row.mint} | score=${row.maxScore} curve=${row.maxCurveProgress} | pumpFails=${JSON.stringify(row.pumpFails)} rejections=${JSON.stringify(row.tradeRejections)}`);
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveRepoPath(args.telemetry) || resolveLatestTelemetry(DEFAULT_LOG_DIR);
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;

  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  const report = buildReport(readJsonl(telemetryPath), telemetryPath);
  writeJson(outputPath, report);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

main();
