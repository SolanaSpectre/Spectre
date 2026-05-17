const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHADOW_PATH = path.join(ROOT, 'data', 'reports', 'runner-raydium-shadow-latest.json');
const OUTCOME_LEDGER_PATH = path.join(ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const FALSE_NEGATIVE_PATH = path.join(ROOT, 'data', 'watchlists', 'outcome-ledger-false-negative-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'runner-raydium-shadow-outcome-join-latest.json');

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function list(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
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

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'UNKNOWN';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function pct(part, total) {
  return total > 0 ? compact(part / total, 4) : null;
}

function compactOutcome(item = {}, detailSource = 'unknown') {
  return {
    mint: item.mint || null,
    symbol: item.symbol || null,
    outcome: item.outcome || null,
    detailSource,
    falseNegativePriority: nullableNum(item.falseNegativePriority),
    firstSeenAt: item.firstSeenAt || null,
    firstFlagAt: item.firstFlagAt || null,
    maxScore: nullableNum(item.maxScore),
    maxCurveProgress: nullableNum(item.maxCurveProgress),
    paperEntries: num(item.paperEntries, 0),
    paperPnlSol: nullableNum(item.paperPnlSol)
  };
}

function buildOutcomeMap(outcomeLedger, falseNegativePayload) {
  const byMint = new Map();
  const broadLedgerItems = list(outcomeLedger, ['outcomes']);
  const detailedLedgerItems = [
    ...list(outcomeLedger, ['topMigratedOrNearRunner']),
    ...list(outcomeLedger, ['topFalseNegativeCandidates', 'falseNegativeCandidates', 'topFalseNegatives'])
  ];
  const falseNegativeItems = list(falseNegativePayload, ['watchlist', 'candidates', 'items']);

  for (const item of broadLedgerItems) {
    if (item?.mint) byMint.set(item.mint, compactOutcome(item, 'outcome_ledger'));
  }
  for (const item of detailedLedgerItems) {
    if (item?.mint) byMint.set(item.mint, compactOutcome(item, 'outcome_ledger_detail'));
  }
  for (const item of falseNegativeItems) {
    if (item?.mint) byMint.set(item.mint, compactOutcome(item, 'false_negative_detail'));
  }
  return byMint;
}

function buildRows(shadow, outcomeByMint) {
  const latestByMint = new Map();
  const groups = ['topByRank', 'topByLiquidity', 'freshPools', 'matureOrEstablished', 'ageUnknown', 'continuationOverlap'];
  for (const key of groups) {
    for (const row of list(shadow, [key])) {
      if (row?.mint) latestByMint.set(row.mint, row);
    }
  }
  for (const row of list(shadow, ['outcomeRows'])) {
    if (!row?.mint) continue;
    const existing = latestByMint.get(row.mint) || {};
    latestByMint.set(row.mint, { ...existing, ...row });
  }

  return Array.from(latestByMint.values())
    .map((row) => {
      const outcome = outcomeByMint.get(row.mint) || null;
      return {
        mint: row.mint || null,
        symbol: row.symbol || null,
        ageBucket: row.ageBucket || null,
        reason: row.reason || null,
        continuationVerdict: row.continuationVerdict || row.continuation?.verdict || null,
        continuationRejectReason: row.continuationRejectReason || row.continuation?.rejectReason || null,
        observationCount: nullableNum(row.observationCount),
        observedMinutes: nullableNum(row.observedMinutes),
        lastReturnPct: nullableNum(row.lastReturnPct),
        maxRunupPct: nullableNum(row.maxRunupPct),
        maxDrawdownPct: nullableNum(row.maxDrawdownPct),
        matchedOutcome: Boolean(outcome),
        outcomeLabel: outcome?.outcome || 'UNKNOWN_IN_OUTCOME_LEDGER',
        outcomeDetailSource: outcome?.detailSource || 'missing',
        outcome
      };
    })
    .sort((a, b) => String(a.symbol || a.mint).localeCompare(String(b.symbol || b.mint)));
}

function summarizeBy(rows, key) {
  const groups = {};
  for (const row of rows) {
    const value = row[key] || 'UNKNOWN';
    const members = groups[value] || [];
    members.push(row);
    groups[value] = members;
  }

  return Object.fromEntries(
    Object.entries(groups).map(([group, members]) => [
      group,
      {
        rows: members.length,
        matchedOutcomes: members.filter((row) => row.matchedOutcome).length,
        outcomeCounts: countBy(members, (row) => row.outcomeLabel),
        averageLastReturnPct: members.length
          ? compact(members.reduce((sum, row) => sum + num(row.lastReturnPct, 0), 0) / members.length, 6)
          : null
      }
    ])
  );
}

function buildReport() {
  const shadow = readJson(SHADOW_PATH);
  const outcomeLedger = readJson(OUTCOME_LEDGER_PATH);
  const falseNegativePayload = readJson(FALSE_NEGATIVE_PATH);
  const rows = buildRows(shadow, buildOutcomeMap(outcomeLedger, falseNegativePayload));
  const matchedRows = rows.filter((row) => row.matchedOutcome);
  const migrationOrNearRows = matchedRows.filter((row) => ['MIGRATED_OR_COMPLETED', 'NEAR_MIGRATION_85', 'NEAR_RUNNER_95'].includes(row.outcomeLabel));

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      shadowPath: rel(SHADOW_PATH),
      outcomeLedgerPath: rel(OUTCOME_LEDGER_PATH),
      falseNegativePath: rel(FALSE_NEGATIVE_PATH)
    },
    summary: {
      shadowMints: rows.length,
      matchedOutcomes: matchedRows.length,
      unmatchedOutcomes: rows.length - matchedRows.length,
      outcomeCoverageRate: pct(matchedRows.length, rows.length),
      migrationOrNearCount: migrationOrNearRows.length,
      migrationOrNearRateAmongMatched: pct(migrationOrNearRows.length, matchedRows.length),
      outcomeCounts: countBy(rows, (row) => row.outcomeLabel),
      outcomeDetailSourceCounts: countBy(rows, (row) => row.outcomeDetailSource)
    },
    byAgeBucket: summarizeBy(rows, 'ageBucket'),
    byContinuationVerdict: summarizeBy(rows, 'continuationVerdict'),
    rows,
    migrationOrNearRows,
    note: 'Report-only join between blocked Raydium shadow mints and broad outcome-ledger labels. It does not emit signals, quotes, AI reviews, entries, or runtime gates.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(`Wrote Raydium shadow outcome join report: ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildOutcomeMap,
  buildReport,
  buildRows
};
