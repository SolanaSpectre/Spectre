const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RETROSPECTIVE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-historical-run-retrospective-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-coalition');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-coalition-latest.json');

const POSITIVE_OUTCOMES = new Set(['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85', 'PAPER_WIN']);
const INTERESTING_OUTCOMES = new Set([...POSITIVE_OUTCOMES, 'INTERESTING_75']);

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function lift(rate, baseline) {
  return rate !== null && baseline !== null && baseline > 0
    ? Number((rate / baseline).toFixed(4))
    : null;
}

function pairKey(a, b) {
  return [a, b].sort().join(' + ');
}

function combinations(values) {
  const pairs = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      pairs.push([values[left], values[right]]);
    }
  }
  return pairs;
}

function summarize(label, rows, baselinePositiveRate, baselineInterestingRate) {
  const outcomeCounts = {};
  let positiveCount = 0;
  let interestingCount = 0;
  let paperEntries = 0;
  let paperWins = 0;
  let paperLosses = 0;
  let paperPnlSol = 0;
  const sessions = new Set();

  for (const row of rows) {
    outcomeCounts[row.outcome] = (outcomeCounts[row.outcome] || 0) + 1;
    if (POSITIVE_OUTCOMES.has(row.outcome)) positiveCount += 1;
    if (INTERESTING_OUTCOMES.has(row.outcome)) interestingCount += 1;
    paperEntries += Number(row.paperEntries || 0);
    if (row.outcome === 'PAPER_WIN') paperWins += 1;
    if (row.outcome === 'PAPER_LOSS') paperLosses += 1;
    paperPnlSol += Number(row.paperPnlSol || 0);
    if (row.sessionId) sessions.add(row.sessionId);
  }

  const positiveRate = pct(positiveCount, rows.length);
  const interestingRate = pct(interestingCount, rows.length);
  return {
    label,
    clusters: rows.length,
    sessions: sessions.size,
    outcomeCounts,
    positiveCount,
    positiveRate,
    positiveLiftVsLedger: lift(positiveRate, baselinePositiveRate),
    interestingCount,
    interestingRate,
    interestingLiftVsLedger: lift(interestingRate, baselineInterestingRate),
    paperEntries,
    paperWins,
    paperLosses,
    paperPnlSol: Number(paperPnlSol.toFixed(6)),
    tinyDenominatorWarning: rows.length < 5 || positiveCount < 2
  };
}

function buildReport(retrospective) {
  const baselinePositiveRate = retrospective?.summary?.ledgerPositiveRate ?? null;
  const baselineInterestingRate = retrospective?.summary?.ledgerInterestingRate ?? null;
  const rowsByPair = new Map();

  for (const row of retrospective?.rows || []) {
    const names = Array.from(new Set(row.walletNames || [])).sort();
    if (names.length < 2) continue;
    for (const [left, right] of combinations(names)) {
      const key = pairKey(left, right);
      if (!rowsByPair.has(key)) {
        rowsByPair.set(key, {
          pair: key,
          walletNames: [left, right],
          rows: []
        });
      }
      rowsByPair.get(key).rows.push(row);
    }
  }

  const pairs = Array.from(rowsByPair.values()).map((pair) => ({
    pair: pair.pair,
    walletNames: pair.walletNames,
    ...summarize(pair.pair, pair.rows, baselinePositiveRate, baselineInterestingRate),
    sampleMints: pair.rows.slice(0, 12).map((row) => ({
      sessionId: row.sessionId,
      mint: row.mint,
      symbol: row.symbol,
      outcome: row.outcome,
      paperPnlSol: row.paperPnlSol
    }))
  })).sort((a, b) => {
    if (Number(b.clusters || 0) !== Number(a.clusters || 0)) {
      return Number(b.clusters || 0) - Number(a.clusters || 0);
    }
    return Number(b.positiveRate || 0) - Number(a.positiveRate || 0);
  });

  const repeatPairs = pairs.filter((pair) => pair.clusters >= 2);
  const stablePairs = pairs.filter((pair) => pair.clusters >= 3 && !pair.tinyDenominatorWarning);
  const strongestPositivePairs = stablePairs
    .filter((pair) => Number(pair.positiveRate || 0) > Number(baselinePositiveRate || 0))
    .sort((a, b) => {
      if (Number(b.positiveRate || 0) !== Number(a.positiveRate || 0)) {
        return Number(b.positiveRate || 0) - Number(a.positiveRate || 0);
      }
      return Number(b.clusters || 0) - Number(a.clusters || 0);
    });
  const worstPnlPairs = repeatPairs
    .filter((pair) => pair.paperEntries > 0)
    .sort((a, b) => Number(a.paperPnlSol || 0) - Number(b.paperPnlSol || 0));

  return {
    summary: {
      totalPairs: pairs.length,
      repeatPairs: repeatPairs.length,
      stablePairs: stablePairs.length,
      baselinePositiveRate,
      baselineInterestingRate
    },
    strongestPositivePairs,
    worstPnlPairs,
    repeatPairs,
    pairs
  };
}

function main() {
  const retrospective = readJson(RETROSPECTIVE_PATH, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport(retrospective);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_coalition',
    sources: {
      retrospectiveGeneratedAt: retrospective.generatedAt || null
    },
    note: 'Report-only wallet-pair analysis across historical wallet-touched clusters. Repeated pair lift is a prioritization signal, not an automatic runtime rule.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-coalition-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet coalition report: ${reportPath}`);
  console.log(`Wrote latest wallet coalition report: ${LATEST_PATH}`);
  console.log(`pairs=${payload.summary.totalPairs} repeat=${payload.summary.repeatPairs} stable=${payload.summary.stablePairs}`);
}

main();
