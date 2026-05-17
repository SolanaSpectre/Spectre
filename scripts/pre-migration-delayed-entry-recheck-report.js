const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DELAYED_ENTRY_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-delayed-entry-timing-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-delayed-entry-recheck-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
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

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function repoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function eventType(event) {
  return event.type || event.event || event.name || null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function timeMs(value) {
  const parsed = Date.parse(value || 0);
  return Number.isFinite(parsed) ? parsed : null;
}

function secondsBetween(start, end) {
  const left = timeMs(start);
  const right = timeMs(end);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Number(((right - left) / 1000).toFixed(3));
}

function inWindow(timestamp, startAt, endAt) {
  const at = timeMs(timestamp);
  const start = timeMs(startAt);
  const end = timeMs(endAt);
  return Number.isFinite(at) && Number.isFinite(start) && Number.isFinite(end) && at >= start && at <= end;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function collectRechecks(events, row) {
  return events
    .filter((event) => {
      const type = eventType(event);
      if (!type || !type.startsWith('pre_migration_paper.recheck_')) return false;
      const payload = payloadOf(event);
      return mintOf(payload) === row.mint && inWindow(event.timestamp, row.simEntryAt, row.actualEntryAt);
    })
    .map((event) => {
      const payload = payloadOf(event);
      return {
        type: eventType(event),
        timestamp: event.timestamp || null,
        secondsAfterSimEntry: secondsBetween(row.simEntryAt, event.timestamp),
        secondsBeforeActualEntry: secondsBetween(event.timestamp, row.actualEntryAt),
        attempt: payload.attempt ?? null,
        maxAttempts: payload.maxAttempts ?? null,
        delayMs: payload.delayMs ?? null,
        reason: payload.reason || null,
        refreshed: payload.refreshed ?? null,
        refreshSkipReason: payload.refreshSkipReason || null,
        accountFound: payload.accountFound ?? null,
        curveProgress: payload.curveProgress ?? null
      };
    })
    .sort((a, b) => timeMs(a.timestamp) - timeMs(b.timestamp));
}

function summarizeRow(row, rechecks) {
  const scheduled = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_scheduled');
  const executed = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_executed');
  const cancelled = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_cancelled');
  const firstScheduled = scheduled[0] || null;
  const firstExecuted = executed[0] || null;
  const lastExecuted = executed[executed.length - 1] || null;

  return {
    telemetryPath: row.telemetryPath,
    runId: row.runId,
    mint: row.mint,
    symbol: row.symbol,
    runtimeDelaySeconds: row.runtimeDelaySeconds,
    actualExitReason: row.actualExitReason,
    simPnlSol: row.simPnlSol,
    actualPnlSol: row.actualPnlSol,
    scheduledCount: scheduled.length,
    executedCount: executed.length,
    cancelledCount: cancelled.length,
    firstScheduledAt: firstScheduled?.timestamp || null,
    firstExecutedAt: firstExecuted?.timestamp || null,
    firstScheduleLagSeconds: firstScheduled ? secondsBetween(row.simEntryAt, firstScheduled.timestamp) : null,
    firstExecutionLagSeconds: firstExecuted ? secondsBetween(row.simEntryAt, firstExecuted.timestamp) : null,
    scheduledToExecutedSeconds: firstScheduled && firstExecuted
      ? secondsBetween(firstScheduled.timestamp, firstExecuted.timestamp)
      : null,
    lastExecutionBeforeEntrySeconds: lastExecuted ? secondsBetween(lastExecuted.timestamp, row.actualEntryAt) : null,
    scheduledReasonCounts: countBy(scheduled, (item) => item.reason),
    executionRefreshCounts: {
      refreshed: executed.filter((item) => item.refreshed === true).length,
      notRefreshed: executed.filter((item) => item.refreshed === false).length,
      unknown: executed.filter((item) => item.refreshed === null).length
    },
    rechecks
  };
}

function buildReport() {
  const delayedReport = readJson(DELAYED_ENTRY_PATH, {});
  const rows = (delayedReport.rows || []).map((row) => {
    const events = readJsonl(repoPath(row.telemetryPath));
    return summarizeRow(row, collectRechecks(events, row));
  });
  const allRechecks = rows.flatMap((row) => row.rechecks);
  const executedRows = rows.filter((row) => row.executedCount > 0);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      delayedEntryTimingPath: path.relative(ROOT, DELAYED_ENTRY_PATH).replace(/\\/g, '/'),
      delayedRows: rows.length
    },
    summary: {
      delayedRows: rows.length,
      rowsWithScheduledRechecks: rows.filter((row) => row.scheduledCount > 0).length,
      rowsWithExecutedRechecks: executedRows.length,
      scheduledRechecks: allRechecks.filter((row) => row.type === 'pre_migration_paper.recheck_scheduled').length,
      executedRechecks: allRechecks.filter((row) => row.type === 'pre_migration_paper.recheck_executed').length,
      cancelledRechecks: allRechecks.filter((row) => row.type === 'pre_migration_paper.recheck_cancelled').length,
      averageFirstExecutionLagSeconds: executedRows.length
        ? Number((executedRows.reduce((sum, row) => sum + Number(row.firstExecutionLagSeconds || 0), 0) / executedRows.length).toFixed(3))
        : null,
      averageLastExecutionBeforeEntrySeconds: executedRows.length
        ? Number((executedRows.reduce((sum, row) => sum + Number(row.lastExecutionBeforeEntrySeconds || 0), 0) / executedRows.length).toFixed(3))
        : null,
      scheduledReasonCounts: countBy(allRechecks.filter((row) => row.type === 'pre_migration_paper.recheck_scheduled'), (row) => row.reason)
    },
    rows,
    note: 'Report-only diagnostic. Measures explicit recheck cadence only inside each delayed row simEntryAt-to-actualEntryAt window and does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
  };
}

if (require.main === module) {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(`Wrote delayed-entry recheck report: ${OUTPUT_PATH}`);
}

module.exports = { buildReport };
