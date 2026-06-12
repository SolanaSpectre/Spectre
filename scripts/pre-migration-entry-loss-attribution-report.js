const fs = require('fs');
const path = require('path');
const { readJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-loss-attribution-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function readJsonl(filePath) {
  return readJsonlSync(filePath);
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

function badExit(reason) {
  return ['STOP_LOSS', 'BREAKEVEN_STOP', 'SELL_PRESSURE_FLIP', 'CURVE_STALL'].includes(reason);
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
  const pnlRows = rows.filter((row) => row.pnlSol !== null);
  const totalPnlSol = compact(pnlRows.reduce((sum, row) => sum + num(row.pnlSol, 0), 0), 6);
  const wins = rows.filter((row) => row.pnlClass === 'win').length;
  const losses = rows.filter((row) => row.pnlClass === 'loss').length;
  const flats = rows.filter((row) => row.pnlClass === 'flat').length;
  const closed = rows.filter((row) => row.exitAt).length;

  return {
    entries: rows.length,
    closed,
    wins,
    losses,
    flats,
    winRate: pct(wins, wins + losses),
    totalPnlSol,
    averagePnlSol: rows.length ? compact(num(totalPnlSol, 0) / rows.length, 6) : null,
    averageHoldSeconds: closed ? compact(rows.reduce((sum, row) => sum + num(row.holdSeconds, 0), 0) / closed, 2) : null,
    exitReasonCounts: countBy(rows, (row) => row.exitReason || 'OPEN'),
    curveBandCounts: countBy(rows, (row) => row.curveBand),
    guardOverrideCounts: countBy(rows, (row) => row.guardOverride || 'none')
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

function reasonCounts(rows) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row.entryReasons || []) {
      counts[reason] = (counts[reason] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function compactEntry(payload = {}, exitPayload = {}, priorBadExitCount = 0) {
  const exitReason = exitPayload.reason || null;
  const pnlSol = nullableNum(exitPayload.pnlSol);
  const reasons = Array.isArray(payload.reasons) ? payload.reasons : [];
  const walletContext = payload.walletClassificationContext || null;

  return {
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
    entrySniperWalletCount: nullableNum(payload.entrySniperWalletCount),
    guardOverride: payload.guardOverride || null,
    entryReasons: reasons,
    hasNoPriorContext: reasons.includes('NO_PRIOR_CURVE_PROGRESS'),
    hasCurveNotAdvancingContext: reasons.includes('CURVE_NOT_ADVANCING'),
    hasFirstSightGuardOverride: payload.guardOverride === 'FIRST_CURVE_SNAPSHOT_SCALP' || reasons.includes('FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE'),
    walletTouched: Boolean(walletContext?.touched),
    walletRiskCount: num(walletContext?.riskWalletCount, 0),
    walletAlphaScalperCount: num(walletContext?.alphaScalperCount, 0),
    priorBadExitCount,
    exitReason,
    exitCurveProgress: compact(exitPayload.exitCurveProgress, 6),
    returnPct: compact(exitPayload.returnPct, 6),
    pnlSol,
    pnlClass: pnlClass(pnlSol),
    holdSeconds: compact(exitPayload.holdSeconds, 2),
    peakReturnPct: compact(exitPayload.peakReturnPct, 6),
    maxCurveProgress: compact(exitPayload.maxCurveProgress, 6)
  };
}

function buildReport() {
  const battlefield = readJson(BATTLEFIELD_PATH);
  const telemetryPath = battlefield.files?.telemetryPath || null;
  const events = readJsonl(telemetryPath);
  const entries = events.filter((event) => eventType(event) === 'pre_migration_paper.entry');
  const exits = events.filter((event) => eventType(event) === 'pre_migration_paper.exit');
  const exitsByKey = new Map();
  const priorBadExitsByMint = new Map();
  const rows = [];

  for (const event of exits) {
    const payload = payloadOf(event);
    exitsByKey.set(keyOf(payload), { ...payload, exitAt: payload.exitAt || event.timestamp });
  }

  for (const event of entries.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    const payload = payloadOf(event);
    const mint = payload.mint || payload.token || null;
    const priorBadExitCount = mint ? num(priorBadExitsByMint.get(mint), 0) : 0;
    const exit = exitsByKey.get(keyOf(payload)) || {};
    const row = compactEntry(payload, exit, priorBadExitCount);
    rows.push(row);
    if (mint && badExit(row.exitReason)) {
      priorBadExitsByMint.set(mint, priorBadExitCount + 1);
    }
  }

  const losers = rows
    .filter((row) => row.pnlClass === 'loss')
    .sort((a, b) => num(a.pnlSol, 0) - num(b.pnlSol, 0));
  const winners = rows
    .filter((row) => row.pnlClass === 'win')
    .sort((a, b) => num(b.pnlSol, 0) - num(a.pnlSol, 0));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      battlefieldPath: rel(BATTLEFIELD_PATH),
      telemetryPath: telemetryPath ? rel(telemetryPath) : null
    },
    runWindow: {
      startedAt: battlefield.session?.firstEventAt || battlefield.session?.sessionStartedAt || null,
      stoppedAt: battlefield.session?.lastEventAt || battlefield.session?.stoppedAt || null
    },
    summary: {
      ...summarizeRows(rows),
      byPreset: summarizeGroups(rows, 'preset'),
      byCurveBand: summarizeGroups(rows, 'curveBand'),
      byExitReason: summarizeGroups(rows, 'exitReason'),
      byGuardOverride: summarizeGroups(rows, 'guardOverride'),
      entryReasonCounts: reasonCounts(rows),
      losingEntryReasonCounts: reasonCounts(losers),
      firstSightGuardEntries: rows.filter((row) => row.hasFirstSightGuardOverride).length,
      firstSightGuardPnlSol: compact(rows.filter((row) => row.hasFirstSightGuardOverride).reduce((sum, row) => sum + num(row.pnlSol, 0), 0), 6),
      highCurveEntries: rows.filter((row) => num(row.entryCurveProgress, 0) >= 0.9).length,
      highCurvePnlSol: compact(rows.filter((row) => num(row.entryCurveProgress, 0) >= 0.9).reduce((sum, row) => sum + num(row.pnlSol, 0), 0), 6),
      lowCurveEntries: rows.filter((row) => num(row.entryCurveProgress, 0) < 0.75).length,
      lowCurvePnlSol: compact(rows.filter((row) => num(row.entryCurveProgress, 0) < 0.75).reduce((sum, row) => sum + num(row.pnlSol, 0), 0), 6),
      priorBadExitEntries: rows.filter((row) => row.priorBadExitCount > 0).length,
      interpretation: rows.length
        ? 'actual pre-migration paper entries were attributed by preset, curve band, exit reason, guard override, and entry reasons; report-only, no gate changes'
        : 'no actual pre-migration paper entries were found in the latest telemetry'
    },
    rows,
    topLosers: losers.slice(0, 10),
    topWinners: winners.slice(0, 10),
    note: 'Report-only pre-migration entry loss attribution. Uses actual pre_migration_paper.entry/exit telemetry and does not change presets, thresholds, entries, exits, scoring, AI review, or live behavior.'
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
