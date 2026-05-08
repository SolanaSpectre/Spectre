const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RUN_LOGS_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-rolling-entry-trend-latest.json');
const DEFAULT_RUNS = 8;

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

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function eventType(event) {
  return event.type || event.event || event.name || null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function keyOf(payload = {}) {
  return payload.positionKey || `${payload.preset || payload.presetName || 'unknown'}:${payload.mint || payload.token || 'unknown'}:${payload.entryAt || 'unknown'}`;
}

function curveBand(curveProgress) {
  const curve = num(curveProgress, -1);
  if (curve < 0) return 'unknown';
  if (curve < 0.7) return 'under_70';
  if (curve < 0.75) return '70_75';
  if (curve < 0.85) return '75_85';
  if (curve < 0.9) return '85_90';
  if (curve < 0.95) return '90_95';
  return '95_plus';
}

function pnlClass(pnlSol) {
  const pnl = num(pnlSol, 0);
  if (pnl > 0) return 'win';
  if (pnl < 0) return 'loss';
  return 'flat';
}

function sniperCrowdingBucket(sniperWalletCount) {
  const count = num(sniperWalletCount, 0);
  if (count >= 8) return 'sniper_crowded_8_plus';
  if (count >= 4) return 'sniper_crowded_4_7';
  if (count >= 1) return 'sniper_present_1_3';
  return 'no_snipers';
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function latestTelemetryFiles(limit) {
  if (!fs.existsSync(RUN_LOGS_DIR)) return [];
  return fs.readdirSync(RUN_LOGS_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/.test(name))
    .map((name) => {
      const filePath = path.join(RUN_LOGS_DIR, name);
      return { filePath, stat: fs.statSync(filePath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function compactEntry(payload = {}, exitPayload = {}, telemetryPath, runWindow = {}) {
  const walletContext = payload.walletClassificationContext || {};
  const pnlSol = nullableNum(exitPayload.pnlSol);
  const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
  const sniperWalletCount = nullableNum(payload.entrySniperWalletCount);

  return {
    telemetryPath: rel(telemetryPath),
    runId: path.basename(telemetryPath, '.jsonl'),
    runStartedAt: runWindow.startedAt || null,
    runStoppedAt: runWindow.stoppedAt || null,
    positionKey: keyOf(payload),
    mint: payload.mint || payload.token || null,
    symbol: payload.symbol || null,
    preset: payload.preset || payload.presetName || null,
    lane: payload.lane || null,
    profileName: payload.profileName || null,
    entryAt: payload.entryAt || null,
    exitAt: exitPayload.exitAt || null,
    entryScore: compact(payload.entryScore ?? payload.score, 2),
    entryCurveProgress: compact(payload.entryCurveProgress ?? payload.curveProgress, 6),
    curveBand: curveBand(payload.entryCurveProgress ?? payload.curveProgress),
    entryRecentVolumeSol: compact(payload.recentVolumeSol ?? payload.entryRecentVolumeSol, 4),
    entryTradeVelocityPerMin: compact(payload.tradeVelocityPerMin ?? payload.entryTradeVelocityPerMin, 2),
    entryUniqueBuyerCount: nullableNum(payload.entryUniqueBuyerCount),
    entrySniperWalletCount: sniperWalletCount,
    sniperCrowdingBucket: sniperCrowdingBucket(sniperWalletCount),
    guardOverride: payload.guardOverride || 'none',
    entryReasons: reasons,
    firstSightGuard: payload.guardOverride === 'FIRST_CURVE_SNAPSHOT_SCALP' || reasons.includes('FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE'),
    walletTouched: Boolean(walletContext.touched),
    walletAlphaScalperCount: num(walletContext.alphaScalperCount, 0),
    walletRiskCount: num(walletContext.riskWalletCount, 0),
    exitReason: exitPayload.reason || null,
    exitCurveProgress: compact(exitPayload.exitCurveProgress, 6),
    returnPct: compact(exitPayload.returnPct, 6),
    pnlSol,
    pnlClass: pnlClass(pnlSol),
    holdSeconds: compact(exitPayload.holdSeconds, 2),
    peakReturnPct: compact(exitPayload.peakReturnPct, 6),
    maxCurveProgress: compact(exitPayload.maxCurveProgress, 6)
  };
}

function parseTelemetryRun(telemetryPath) {
  const events = readJsonl(telemetryPath);
  const runWindow = {
    startedAt: events[0]?.timestamp || null,
    stoppedAt: events[events.length - 1]?.timestamp || null
  };
  const exitsByKey = new Map();
  const rows = [];

  for (const event of events) {
    if (eventType(event) !== 'pre_migration_paper.exit') continue;
    const payload = payloadOf(event);
    exitsByKey.set(keyOf(payload), { ...payload, exitAt: payload.exitAt || event.timestamp });
  }

  const entries = events
    .filter((event) => eventType(event) === 'pre_migration_paper.entry')
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  for (const event of entries) {
    const payload = payloadOf(event);
    rows.push(compactEntry(payload, exitsByKey.get(keyOf(payload)) || {}, telemetryPath, runWindow));
  }

  return {
    telemetryPath: rel(telemetryPath),
    runId: path.basename(telemetryPath, '.jsonl'),
    startedAt: runWindow.startedAt,
    stoppedAt: runWindow.stoppedAt,
    eventCount: events.length,
    rows
  };
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function summarizeRows(rows) {
  const entries = rows.length;
  const closedRows = rows.filter((row) => row.exitAt);
  const pnlRows = rows.filter((row) => row.pnlSol !== null);
  const wins = rows.filter((row) => row.pnlClass === 'win').length;
  const losses = rows.filter((row) => row.pnlClass === 'loss').length;
  const flats = rows.filter((row) => row.pnlClass === 'flat').length;
  const totalPnlSol = compact(pnlRows.reduce((sum, row) => sum + num(row.pnlSol, 0), 0), 6);
  return {
    entries,
    closed: closedRows.length,
    wins,
    losses,
    flats,
    winRate: pct(wins, wins + losses),
    totalPnlSol,
    averagePnlSol: entries ? compact(num(totalPnlSol, 0) / entries, 6) : null,
    averageHoldSeconds: closedRows.length
      ? compact(closedRows.reduce((sum, row) => sum + num(row.holdSeconds, 0), 0) / closedRows.length, 2)
      : null,
    stopLosses: rows.filter((row) => row.exitReason === 'STOP_LOSS').length,
    curveStalls: rows.filter((row) => row.exitReason === 'CURVE_STALL').length,
    sellPressureFlips: rows.filter((row) => row.exitReason === 'SELL_PRESSURE_FLIP').length,
    takeProfits: rows.filter((row) => row.exitReason === 'TAKE_PROFIT').length,
    exitReasonCounts: countBy(rows, (row) => row.exitReason || 'OPEN')
  };
}

function summarizeGroups(rows, key) {
  const groups = {};
  for (const row of rows) {
    const groupKey = row[key] || 'UNKNOWN';
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(row);
  }
  return Object.fromEntries(
    Object.entries(groups)
      .map(([groupKey, members]) => [groupKey, summarizeRows(members)])
      .sort((a, b) => num(a[1].totalPnlSol, 0) - num(b[1].totalPnlSol, 0))
  );
}

function summarizeRuns(runs) {
  return runs.map((run) => ({
    telemetryPath: run.telemetryPath,
    runId: run.runId,
    startedAt: run.startedAt,
    stoppedAt: run.stoppedAt,
    eventCount: run.eventCount,
    ...summarizeRows(run.rows),
    firstSight: summarizeRows(run.rows.filter((row) => row.firstSightGuard)),
    sniperCrowded: summarizeRows(run.rows.filter((row) => ['sniper_crowded_4_7', 'sniper_crowded_8_plus'].includes(row.sniperCrowdingBucket)))
  }));
}

function compactRow(row) {
  return {
    runId: row.runId,
    mint: row.mint,
    symbol: row.symbol,
    preset: row.preset,
    guardOverride: row.guardOverride,
    curveBand: row.curveBand,
    sniperCrowdingBucket: row.sniperCrowdingBucket,
    walletTouched: row.walletTouched,
    entryAt: row.entryAt,
    entryScore: row.entryScore,
    entryCurveProgress: row.entryCurveProgress,
    exitReason: row.exitReason,
    pnlSol: row.pnlSol,
    holdSeconds: row.holdSeconds,
    peakReturnPct: row.peakReturnPct
  };
}

function buildReport(options = {}) {
  const runLimit = Math.max(1, Math.min(50, Number(options.runs || DEFAULT_RUNS)));
  const telemetryFiles = latestTelemetryFiles(runLimit);
  const runs = telemetryFiles.map(parseTelemetryRun).sort((a, b) => Date.parse(a.startedAt || 0) - Date.parse(b.startedAt || 0));
  const rows = runs.flatMap((run) => run.rows);
  const firstSightRows = rows.filter((row) => row.firstSightGuard);
  const sniperCrowdedRows = rows.filter((row) => ['sniper_crowded_4_7', 'sniper_crowded_8_plus'].includes(row.sniperCrowdingBucket));
  const walletTouchedRows = rows.filter((row) => row.walletTouched);
  const highCurveRows = rows.filter((row) => num(row.entryCurveProgress, 0) >= 0.9);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      runLogsDir: rel(RUN_LOGS_DIR),
      telemetryFilesRead: runs.map((run) => run.telemetryPath)
    },
    config: {
      runLimit,
      defaultRunLimit: DEFAULT_RUNS
    },
    summary: {
      runsRead: runs.length,
      ...summarizeRows(rows),
      firstSightGuard: summarizeRows(firstSightRows),
      sniperCrowded: summarizeRows(sniperCrowdedRows),
      walletTouched: summarizeRows(walletTouchedRows),
      highCurveEntries: summarizeRows(highCurveRows),
      byGuardOverride: summarizeGroups(rows, 'guardOverride'),
      byPreset: summarizeGroups(rows, 'preset'),
      byCurveBand: summarizeGroups(rows, 'curveBand'),
      bySniperCrowdingBucket: summarizeGroups(rows, 'sniperCrowdingBucket'),
      byWalletTouched: {
        wallet_touched: summarizeRows(walletTouchedRows),
        wallet_not_touched: summarizeRows(rows.filter((row) => !row.walletTouched))
      },
      interpretation: rows.length
        ? 'rolling actual pre-migration paper entries grouped by guard, preset, curve band, wallet touch, and sniper crowding; report-only, no gate changes'
        : 'no pre-migration paper entries were found in the selected telemetry files'
    },
    runs: summarizeRuns(runs),
    worstRuns: summarizeRuns(runs).sort((a, b) => num(a.totalPnlSol, 0) - num(b.totalPnlSol, 0)).slice(0, 5),
    bestRuns: summarizeRuns(runs).sort((a, b) => num(b.totalPnlSol, 0) - num(a.totalPnlSol, 0)).slice(0, 5),
    worstEntries: rows.slice().sort((a, b) => num(a.pnlSol, 0) - num(b.pnlSol, 0)).slice(0, 15).map(compactRow),
    bestEntries: rows.slice().sort((a, b) => num(b.pnlSol, 0) - num(a.pnlSol, 0)).slice(0, 15).map(compactRow),
    note: 'Report-only rolling pre-migration entry trend. Reads recent telemetry JSONL files and does not change presets, thresholds, entries, exits, scoring, AI review, quotes, or live behavior.'
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    runsRead: report.summary.runsRead,
    entries: report.summary.entries,
    wins: report.summary.wins,
    losses: report.summary.losses,
    flats: report.summary.flats,
    totalPnlSol: report.summary.totalPnlSol,
    firstSightPnlSol: report.summary.firstSightGuard.totalPnlSol,
    sniperCrowdedPnlSol: report.summary.sniperCrowded.totalPnlSol
  }, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

main();
