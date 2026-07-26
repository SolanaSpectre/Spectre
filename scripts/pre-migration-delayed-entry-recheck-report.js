const fs = require('fs');
const path = require('path');
const { indexJsonlEventsByMint } = require('./lib/jsonl-mint-index');

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

function summarizeIndexes(indexes) {
  const files = [...indexes.entries()].map(([telemetryPath, index]) => ({
    telemetryPath,
    rows: index.rows,
    malformedLines: index.malformedLines,
    candidateEvents: index.candidateEvents,
    candidateEventsWithoutMint: index.candidateEventsWithoutMint,
    candidateEventsOutsideTargetSet: index.candidateEventsOutsideTargetSet,
    indexedEvents: index.indexedEvents
  }));
  return {
    telemetryFiles: files.length,
    rows: files.reduce((sum, row) => sum + Number(row.rows || 0), 0),
    malformedLines: files.reduce((sum, row) => sum + Number(row.malformedLines || 0), 0),
    candidateEvents: files.reduce((sum, row) => sum + Number(row.candidateEvents || 0), 0),
    candidateEventsWithoutMint: files.reduce(
      (sum, row) => sum + Number(row.candidateEventsWithoutMint || 0),
      0
    ),
    candidateEventsOutsideTargetSet: files.reduce(
      (sum, row) => sum + Number(row.candidateEventsOutsideTargetSet || 0),
      0
    ),
    indexedEvents: files.reduce((sum, row) => sum + Number(row.indexedEvents || 0), 0),
    files
  };
}

function collectRechecks(events, row, scope = 'delayWindow') {
  return events
    .filter((event) => {
      const type = eventType(event);
      if (!type || !type.startsWith('pre_migration_paper.recheck_')) return false;
      const payload = payloadOf(event);
      if (mintOf(payload) !== row.mint) return false;
      if (scope === 'beforeActualEntry') {
        const at = timeMs(event.timestamp);
        const actualEntry = timeMs(row.actualEntryAt);
        return Number.isFinite(at) && Number.isFinite(actualEntry) && at <= actualEntry;
      }
      return inWindow(event.timestamp, row.simEntryAt, row.actualEntryAt);
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

function summarizeRechecks(rechecks, anchorAt, actualEntryAt) {
  const scheduled = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_scheduled');
  const executed = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_executed');
  const cancelled = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_cancelled');
  const skipped = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_skipped');
  const failed = rechecks.filter((item) => item.type === 'pre_migration_paper.recheck_failed');
  const firstScheduled = scheduled[0] || null;
  const firstExecuted = executed[0] || null;
  const lastExecuted = executed[executed.length - 1] || null;

  return {
    scheduledCount: scheduled.length,
    executedCount: executed.length,
    cancelledCount: cancelled.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    firstScheduledAt: firstScheduled?.timestamp || null,
    firstExecutedAt: firstExecuted?.timestamp || null,
    firstScheduleLagSeconds: firstScheduled ? secondsBetween(anchorAt, firstScheduled.timestamp) : null,
    firstExecutionLagSeconds: firstExecuted ? secondsBetween(anchorAt, firstExecuted.timestamp) : null,
    scheduledToExecutedSeconds: firstScheduled && firstExecuted
      ? secondsBetween(firstScheduled.timestamp, firstExecuted.timestamp)
      : null,
    lastExecutionBeforeEntrySeconds: lastExecuted ? secondsBetween(lastExecuted.timestamp, actualEntryAt) : null,
    scheduledReasonCounts: countBy(scheduled, (item) => item.reason),
    executionRefreshCounts: {
      refreshed: executed.filter((item) => item.refreshed === true).length,
      notRefreshed: executed.filter((item) => item.refreshed === false).length,
      unknown: executed.filter((item) => item.refreshed === null).length
    },
    rechecks
  };
}

function summarizeRow(row, delayWindowRechecks, beforeEntryRechecks) {
  const delayWindow = summarizeRechecks(delayWindowRechecks, row.simEntryAt, row.actualEntryAt);
  const beforeActualEntry = summarizeRechecks(beforeEntryRechecks, row.simEntryAt, row.actualEntryAt);

  return {
    telemetryPath: row.telemetryPath,
    runId: row.runId,
    mint: row.mint,
    symbol: row.symbol,
    runtimeDelaySeconds: row.runtimeDelaySeconds,
    actualExitReason: row.actualExitReason,
    simPnlSol: row.simPnlSol,
    actualPnlSol: row.actualPnlSol,
    ...delayWindow,
    beforeActualEntry
  };
}

function buildReport() {
  const delayedReport = readJson(DELAYED_ENTRY_PATH, {});
  const delayedRows = delayedReport.rows || [];
  const rowsByTelemetryPath = new Map();
  for (const row of delayedRows) {
    if (!row.telemetryPath || !row.mint) continue;
    if (!rowsByTelemetryPath.has(row.telemetryPath)) {
      rowsByTelemetryPath.set(row.telemetryPath, []);
    }
    rowsByTelemetryPath.get(row.telemetryPath).push(row);
  }

  const indexes = new Map();
  for (const [telemetryPath, telemetryRows] of rowsByTelemetryPath) {
    const targetMints = new Set(telemetryRows.map((row) => row.mint));
    indexes.set(telemetryPath, indexJsonlEventsByMint(repoPath(telemetryPath), targetMints, {
      includeEvent: (event) => String(eventType(event) || '').startsWith('pre_migration_paper.recheck_')
    }));
  }

  const rows = delayedRows.map((row) => {
    const events = indexes.get(row.telemetryPath)?.eventsByMint.get(row.mint) || [];
    return summarizeRow(
      row,
      collectRechecks(events, row, 'delayWindow'),
      collectRechecks(events, row, 'beforeActualEntry')
    );
  });
  const allRechecks = rows.flatMap((row) => row.rechecks);
  const allBeforeEntryRechecks = rows.flatMap((row) => row.beforeActualEntry.rechecks);
  const executedRows = rows.filter((row) => row.executedCount > 0);
  const beforeEntryExecutedRows = rows.filter((row) => row.beforeActualEntry.executedCount > 0);
  const telemetryIndex = summarizeIndexes(indexes);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      delayedEntryTimingPath: path.relative(ROOT, DELAYED_ENTRY_PATH).replace(/\\/g, '/'),
      delayedRows: rows.length,
      telemetryIndex
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
      scheduledReasonCounts: countBy(allRechecks.filter((row) => row.type === 'pre_migration_paper.recheck_scheduled'), (row) => row.reason),
      rowsWithAnyRechecksBeforeActualEntry: rows.filter((row) => row.beforeActualEntry.rechecks.length > 0).length,
      rowsWithExecutedRechecksBeforeActualEntry: beforeEntryExecutedRows.length,
      scheduledRechecksBeforeActualEntry: allBeforeEntryRechecks.filter((row) => row.type === 'pre_migration_paper.recheck_scheduled').length,
      executedRechecksBeforeActualEntry: allBeforeEntryRechecks.filter((row) => row.type === 'pre_migration_paper.recheck_executed').length,
      averageLastExecutionBeforeActualEntrySeconds: beforeEntryExecutedRows.length
        ? Number((beforeEntryExecutedRows.reduce((sum, row) => sum + Number(row.beforeActualEntry.lastExecutionBeforeEntrySeconds || 0), 0) / beforeEntryExecutedRows.length).toFixed(3))
        : null,
      telemetryIndexIntegrity: telemetryIndex.candidateEventsWithoutMint === 0
        ? 'NO_RELEVANT_EVENTS_WITHOUT_MINT'
        : 'RELEVANT_EVENTS_WITHOUT_MINT'
    },
    rows,
    note: 'Report-only diagnostic. Separates explicit rechecks inside each delayed row simEntryAt-to-actualEntryAt window from any rechecks that happened earlier in the mint lifecycle before actual entry. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
  };
}

if (require.main === module) {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(`Wrote delayed-entry recheck report: ${OUTPUT_PATH}`);
}

module.exports = { buildReport };
