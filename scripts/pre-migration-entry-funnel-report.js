#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-funnel-latest.json');

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

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
}

function pct(part, total, digits = 4) {
  return total > 0 ? num(part / total, digits) : null;
}

function bump(target, key, amount = 1) {
  const label = key || 'unknown';
  target[label] = (target[label] || 0) + amount;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) bump(counts, keyFn(row));
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function topObject(object = {}, limit = 12) {
  return Object.fromEntries(Object.entries(object)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit));
}

function getMintRow(rowsByMint, mint, seed = {}) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: seed.symbol || null,
      firstSeenAtMs: null,
      lastSeenAtMs: null,
      eventTypes: {},
      observedRows: 0,
      firstCurveNearMissRows: 0,
      firstCurveFailedChecks: {},
      flaggedRows: 0,
      confirmedFlagRows: 0,
      flagReasons: {},
      guardRows: 0,
      wouldEnterRows: 0,
      wouldSkipRows: 0,
      guardReasons: {},
      guardOverrides: {},
      guardFailedChecks: {},
      decisionRows: 0,
      skipDecisionRows: 0,
      skipReasons: {},
      entries: 0,
      exits: 0,
      maxScore: null,
      maxCurveProgress: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxCurveProgressDelta: null,
      maxCurveProgressDelta60s: null,
      bestReadinessPct: null,
      bestReadinessReason: null
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && seed.symbol) row.symbol = seed.symbol;
  return row;
}

function updateWindow(row, atMs) {
  if (!Number.isFinite(atMs)) return;
  row.firstSeenAtMs = row.firstSeenAtMs === null ? atMs : Math.min(row.firstSeenAtMs, atMs);
  row.lastSeenAtMs = row.lastSeenAtMs === null ? atMs : Math.max(row.lastSeenAtMs, atMs);
}

function updateMax(row, key, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return;
  row[key] = row[key] === null ? parsed : Math.max(row[key], parsed);
}

function ratio(value, threshold, mode = 'min') {
  const actual = Number(value);
  const target = Number(threshold);
  if (!Number.isFinite(actual) || !Number.isFinite(target)) return null;
  if (mode === 'max') {
    if (target < 0) return null;
    return Math.max(0, actual <= target ? 1 : target / Math.max(actual, 1e-12));
  }
  if (target <= 0) return actual >= target ? 1 : 0;
  return Math.min(1, Math.max(0, actual / target));
}

function decisionReadiness(payload = {}) {
  const candidates = [];
  if (payload.reason === 'LOW_SCORE' && Number(payload.threshold) >= 10) {
    candidates.push(ratio(payload.value ?? payload.score, payload.threshold, 'min'));
  }
  if (payload.reason === 'CURVE_NOT_ADVANCING') {
    candidates.push(ratio(payload.curveProgressDelta, payload.threshold, 'min'));
  }
  const firstCurve = payload.firstCurveSnapshotScalpThresholds || null;
  if (firstCurve) {
    candidates.push(ratio(payload.firstCurveSnapshotScalpScore, firstCurve.minScore, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpCurveProgress, firstCurve.minCurveProgress, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpRecentVolumeSol, firstCurve.minRecentVolumeSol, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpTradeVelocityPerMin, firstCurve.minTradeVelocityPerMin, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpInterestSignalCount, firstCurve.minInterestCount, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpUniqueBuyerCount, firstCurve.minUniqueBuyerCount, 'min'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpRiskWalletCount, firstCurve.maxRiskWalletCount, 'max'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpSniperWalletCount, firstCurve.maxSniperWalletCount, 'max'));
    candidates.push(ratio(payload.firstCurveSnapshotScalpBuyRatio, firstCurve.minBuyRatio, 'min'));
  }
  const usable = candidates.filter(Number.isFinite);
  if (!usable.length) return null;
  return num(Math.min(...usable) * 100, 2);
}

function terminalStage(row) {
  if (row.entries > 0) return 'ENTERED';
  if (row.wouldEnterRows > 0) return 'WOULD_ENTER_NO_ENTRY';
  if (row.guardRows > 0 || row.decisionRows > 0) return 'EVALUATED_AND_BLOCKED';
  if (row.flaggedRows > 0) return 'FLAGGED_NOT_EVALUATED';
  if (row.firstCurveNearMissRows > 0) return 'FIRST_CURVE_NEAR_MISS_ONLY';
  if (row.observedRows > 0) return 'OBSERVED_ONLY';
  return 'UNKNOWN';
}

async function readTelemetry(filePath) {
  const rowsByMint = new Map();
  const eventCounts = {};
  let malformedLines = 0;
  let eventRows = 0;
  let startMs = Infinity;
  let endMs = -Infinity;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    eventRows += 1;
    const type = eventType(event);
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    bump(eventCounts, type);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }
    if (!mint) continue;

    const row = getMintRow(rowsByMint, mint, { symbol: payload.symbol });
    updateWindow(row, atMs);
    bump(row.eventTypes, type);
    row.observedRows += 1;
    updateMax(row, 'maxScore', payload.score ?? payload.entryScore);
    updateMax(row, 'maxCurveProgress', payload.curveProgress ?? payload.providerCurveProgress ?? payload.bondingCurveProgress);
    updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
    updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
    updateMax(row, 'maxCurveProgressDelta', payload.curveProgressDelta);
    updateMax(row, 'maxCurveProgressDelta60s', payload.curveProgressDelta60s);

    if (type === 'pre_migration_paper.first_curve_snapshot_near_miss') {
      row.firstCurveNearMissRows += 1;
      for (const check of payload.failedChecks || []) bump(row.firstCurveFailedChecks, check);
    } else if (type === 'pre_migration.flagged') {
      row.flaggedRows += 1;
      if (payload.confirmed === true || payload.newlyConfirmed === true) row.confirmedFlagRows += 1;
      for (const reason of payload.reasons || []) bump(row.flagReasons, reason);
    } else if (type === 'pre_migration_paper.guard_attribution') {
      row.guardRows += 1;
      if (payload.outcome === 'PAPER_WOULD_ENTER') row.wouldEnterRows += 1;
      if (payload.outcome === 'PAPER_WOULD_SKIP') row.wouldSkipRows += 1;
      bump(row.guardReasons, payload.guardReason || payload.reason);
      bump(row.guardOverrides, payload.guardOverride || 'none');
      for (const check of payload.failedChecks || []) bump(row.guardFailedChecks, check);
    } else if (type === 'pre_migration_paper.decision') {
      row.decisionRows += 1;
      if (payload.decision === 'PAPER_SKIPPED') {
        row.skipDecisionRows += 1;
        bump(row.skipReasons, payload.reason);
      }
      const readinessPct = decisionReadiness(payload);
      if (Number.isFinite(readinessPct) && (row.bestReadinessPct === null || readinessPct > row.bestReadinessPct)) {
        row.bestReadinessPct = readinessPct;
        row.bestReadinessReason = payload.reason || null;
      }
    } else if (type === 'pre_migration_paper.entry') {
      row.entries += 1;
    } else if (type === 'pre_migration_paper.exit') {
      row.exits += 1;
    }
  }

  return {
    filePath,
    eventRows,
    malformedLines,
    eventCounts,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    rows: Array.from(rowsByMint.values()).map((row) => ({
      ...row,
      firstSeenAt: row.firstSeenAtMs === null ? null : new Date(row.firstSeenAtMs).toISOString(),
      lastSeenAt: row.lastSeenAtMs === null ? null : new Date(row.lastSeenAtMs).toISOString(),
      terminalStage: terminalStage(row),
      topFlagReasons: topObject(row.flagReasons, 6),
      topGuardReasons: topObject(row.guardReasons, 6),
      topGuardFailedChecks: topObject(row.guardFailedChecks, 6),
      topSkipReasons: topObject(row.skipReasons, 6),
      topFirstCurveFailedChecks: topObject(row.firstCurveFailedChecks, 6),
      maxScore: num(row.maxScore, 2),
      maxCurveProgress: num(row.maxCurveProgress, 6),
      maxRecentVolumeSol: num(row.maxRecentVolumeSol, 4),
      maxTradeVelocityPerMin: num(row.maxTradeVelocityPerMin, 2),
      maxCurveProgressDelta: num(row.maxCurveProgressDelta, 6),
      maxCurveProgressDelta60s: num(row.maxCurveProgressDelta60s, 6)
    }))
  };
}

function summarize(rows, telemetry) {
  const observed = rows.length;
  const firstCurve = rows.filter((row) => row.firstCurveNearMissRows > 0);
  const flagged = rows.filter((row) => row.flaggedRows > 0);
  const confirmed = rows.filter((row) => row.confirmedFlagRows > 0);
  const evaluated = rows.filter((row) => row.guardRows > 0 || row.decisionRows > 0);
  const wouldEnter = rows.filter((row) => row.wouldEnterRows > 0);
  const entered = rows.filter((row) => row.entries > 0);
  const guardRows = rows.reduce((sum, row) => sum + row.guardRows, 0);
  const decisionRows = rows.reduce((sum, row) => sum + row.decisionRows, 0);
  const skippedRows = rows.reduce((sum, row) => sum + row.skipDecisionRows, 0);

  const allGuardReasons = {};
  const allSkipReasons = {};
  const allGuardFailedChecks = {};
  const allFirstCurveFailedChecks = {};
  const allFlagReasons = {};
  for (const row of rows) {
    Object.entries(row.guardReasons).forEach(([key, value]) => bump(allGuardReasons, key, value));
    Object.entries(row.skipReasons).forEach(([key, value]) => bump(allSkipReasons, key, value));
    Object.entries(row.guardFailedChecks).forEach(([key, value]) => bump(allGuardFailedChecks, key, value));
    Object.entries(row.firstCurveFailedChecks).forEach(([key, value]) => bump(allFirstCurveFailedChecks, key, value));
    Object.entries(row.flagReasons).forEach(([key, value]) => bump(allFlagReasons, key, value));
  }

  return {
    telemetryPath: path.relative(ROOT, telemetry.filePath),
    startAt: telemetry.startAt,
    endAt: telemetry.endAt,
    telemetryEvents: telemetry.eventRows,
    malformedLines: telemetry.malformedLines,
    observedMints: observed,
    firstCurveNearMissMints: firstCurve.length,
    flaggedMints: flagged.length,
    confirmedFlagMints: confirmed.length,
    evaluatedMints: evaluated.length,
    wouldEnterMints: wouldEnter.length,
    enteredMints: entered.length,
    guardRows,
    decisionRows,
    skippedRows,
    funnelRates: {
      flaggedPerObserved: pct(flagged.length, observed),
      evaluatedPerFlagged: pct(evaluated.length, flagged.length),
      wouldEnterPerEvaluated: pct(wouldEnter.length, evaluated.length),
      enteredPerEvaluated: pct(entered.length, evaluated.length)
    },
    dropoffs: {
      observedNotFlaggedMints: observed - flagged.length,
      flaggedNotEvaluatedMints: flagged.filter((row) => row.guardRows === 0 && row.decisionRows === 0).length,
      evaluatedNeverWouldEnterMints: evaluated.length - wouldEnter.length,
      wouldEnterNoEntryMints: wouldEnter.length - entered.length
    },
    terminalStageCounts: countBy(rows, (row) => row.terminalStage),
    topFlagReasons: topObject(allFlagReasons),
    topGuardReasons: topObject(allGuardReasons),
    topSkipReasons: topObject(allSkipReasons),
    topGuardFailedChecks: topObject(allGuardFailedChecks),
    topFirstCurveFailedChecks: topObject(allFirstCurveFailedChecks)
  };
}

function selectRows(rows) {
  const blocked = rows
    .filter((row) => row.terminalStage === 'EVALUATED_AND_BLOCKED')
    .sort((a, b) => Number(b.bestReadinessPct ?? -1) - Number(a.bestReadinessPct ?? -1))
    .slice(0, 20);
  const highScoreBlocked = rows
    .filter((row) => row.terminalStage === 'EVALUATED_AND_BLOCKED')
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  const flaggedNotEvaluated = rows
    .filter((row) => row.flaggedRows > 0 && row.guardRows === 0 && row.decisionRows === 0)
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  const firstCurveOnly = rows
    .filter((row) => row.terminalStage === 'FIRST_CURVE_NEAR_MISS_ONLY')
    .sort((a, b) => Number(b.maxScore ?? -1) - Number(a.maxScore ?? -1))
    .slice(0, 20);
  return { closestBlocked: blocked, highScoreBlocked, flaggedNotEvaluated, firstCurveOnly };
}

function printReport(report) {
  const s = report.summary;
  console.log('Pre-Migration Entry Funnel');
  console.log(`Telemetry: ${s.telemetryPath}`);
  console.log(`Observed/flagged/evaluated/wouldEnter/entered mints: ${s.observedMints}/${s.flaggedMints}/${s.evaluatedMints}/${s.wouldEnterMints}/${s.enteredMints}`);
  console.log(`Guard/decision/skipped rows: ${s.guardRows}/${s.decisionRows}/${s.skippedRows}`);
  console.log(`Dropoffs: observedNotFlagged=${s.dropoffs.observedNotFlaggedMints}, flaggedNotEvaluated=${s.dropoffs.flaggedNotEvaluatedMints}, evaluatedNeverWouldEnter=${s.dropoffs.evaluatedNeverWouldEnterMints}`);
  console.log('Top skip reasons:');
  Object.entries(s.topSkipReasons).slice(0, 8).forEach(([key, value]) => console.log(`  - ${key}: ${value}`));
  console.log('Top guard failed checks:');
  Object.entries(s.topGuardFailedChecks).slice(0, 8).forEach(([key, value]) => console.log(`  - ${key}: ${value}`));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  const telemetry = await readTelemetry(telemetryPath);
  const summary = summarize(telemetry.rows, telemetry);
  const selections = selectRows(telemetry.rows);
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_migration_entry_funnel',
    note: 'Counts the pre-migration entry funnel from observed mint telemetry through flags, guard evaluation, paper decisions, would-enter rows, and actual paper entries. Does not change gates or live behavior.',
    summary,
    ...selections
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  printReport(output);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
