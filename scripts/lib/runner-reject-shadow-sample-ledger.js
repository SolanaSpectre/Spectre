'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LEDGER_PATH = path.join(ROOT, 'data', 'runner-reject-shadow-ledgers', 'frozen-profile-samples.jsonl');

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
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

function sampleKey(sample) {
  // Telemetry filenames are timestamped run identities; do not rename them before re-reporting.
  return [
    sample.era || 'unknown_era',
    sample.frozenProfile || 'unknown_profile',
    sample.telemetryPath || 'unknown_telemetry',
    sample.mint || 'unknown_mint',
    sample.at || sample.atMs || 'unknown_at'
  ].join('|');
}

function normalizeSample(sample) {
  const normalized = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    ...sample
  };
  normalized.sampleKey = sample.sampleKey || sampleKey(normalized);
  return normalized;
}

function numberOrNull(value, digits = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
}

function stat(values, digits = 9) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: numberOrNull(finite[0], digits),
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function sumAfterRemovingTopWinners(values, winnerCount = 3) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  if (!sorted.length) return null;
  return numberOrNull(sorted.slice(winnerCount).reduce((sum, value) => sum + value, 0), 9);
}

function checkpointDisposition(summary) {
  const sampleTarget = 20;
  const uniqueMints = Number(summary.uniqueMints || 0);
  const medianPnlSol = numberOrNull(summary.pnlSol?.median);
  const pnlAfterRemovingTop3WinnersSol = numberOrNull(summary.pnlAfterRemovingTop3WinnersSol);
  const totalPnlSol = numberOrNull(summary.totalPnlSol);
  const reached = uniqueMints >= sampleTarget;
  const requirements = {
    sampleTargetUniqueMints: sampleTarget,
    reachedSampleTarget: reached,
    positiveTotalPnlSol: totalPnlSol !== null && totalPnlSol > 0,
    positiveMedianPnlSol: medianPnlSol !== null && medianPnlSol > 0,
    positivePnlAfterRemovingTop3WinnersSol: pnlAfterRemovingTop3WinnersSol !== null && pnlAfterRemovingTop3WinnersSol > 0
  };
  const failedRequirements = Object.entries(requirements)
    .filter(([key, value]) => key !== 'sampleTargetUniqueMints' && value !== true)
    .map(([key]) => key);
  const passed = reached
    && requirements.positiveTotalPnlSol
    && requirements.positiveMedianPnlSol
    && requirements.positivePnlAfterRemovingTop3WinnersSol;

  return {
    disposition: passed ? 'PASSED_AT_CHECKPOINT' : (reached ? 'FAILED_AT_CHECKPOINT' : 'COLLECTING'),
    sampleTargetUniqueMints: sampleTarget,
    uniqueMints,
    requirements,
    failedRequirements: reached ? failedRequirements : [],
    frozenRuleQuote: 'fast_300s_replay_had_negative_median; runtime evaluation must require median and ex-top-winner robustness, not total_pnl_only',
    decidedBy: reached ? 'pre_registered_runner_reject_runtime_shadow_checkpoint' : null,
    nextAction: passed
      ? 'manual_review_before_any_promotion'
      : (reached
        ? 'close_lane; do_not_extend_without_new_pre_registration'
        : `collect ${sampleTarget - uniqueMints} more unique mint sample(s)`)
  };
}

function appendSamples(samples, ledgerPath = LEDGER_PATH) {
  const normalized = (samples || []).map(normalizeSample);
  const existingRows = readJsonl(ledgerPath);
  if (!normalized.length) {
    return {
      ledgerPath,
      appended: 0,
      existing: existingRows.length,
      total: existingRows.length
    };
  }

  const existingKeys = new Set();
  for (const row of existingRows) {
    if (row.sampleKey) existingKeys.add(row.sampleKey);
    existingKeys.add(sampleKey(row));
  }
  const newRows = normalized.filter((row) => !existingKeys.has(row.sampleKey));

  if (newRows.length) {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(
      ledgerPath,
      newRows.map((row) => JSON.stringify(row)).join('\n') + '\n',
      'utf8'
    );
  }

  return {
    ledgerPath,
    appended: newRows.length,
    existing: existingRows.length,
    total: existingRows.length + newRows.length
  };
}

function summarizeLedger(filters = {}, ledgerPath = LEDGER_PATH) {
  const rows = readJsonl(ledgerPath);
  const selected = rows.filter((row) => {
    if (filters.era && row.era !== filters.era) return false;
    if (filters.frozenProfile && row.frozenProfile !== filters.frozenProfile) return false;
    return true;
  });

  const joined = selected.filter((row) => row.replay?.outcomeJoined === true);
  const pnlValues = joined.map((row) => Number(row.replay?.pnlSol)).filter(Number.isFinite);
  const wins = joined.filter((row) => Number(row.replay?.pnlSol) > 0).length;
  const losses = joined.filter((row) => Number(row.replay?.pnlSol) < 0).length;
  const totalPnlSol = pnlValues.reduce((sum, value) => sum + value, 0);
  const baseSummary = {
    ledgerPath,
    totalRows: rows.length,
    filteredRows: selected.length,
    filters,
    uniqueMints: new Set(selected.map((row) => row.mint).filter(Boolean)).size,
    outcomeJoinedProfileHold: joined.length,
    outcomeMissingProfileHold: selected.length - joined.length,
    wins,
    losses,
    winRate: joined.length ? Number((wins / joined.length).toFixed(4)) : null,
    totalPnlSol: Number(totalPnlSol.toFixed(9)),
    pnlSol: stat(pnlValues, 9),
    pnlAfterRemovingTop1WinnerSol: sumAfterRemovingTopWinners(pnlValues, 1),
    pnlAfterRemovingTop3WinnersSol: sumAfterRemovingTopWinners(pnlValues, 3),
    byExitReason: joined.reduce((counts, row) => {
      const key = row.replay?.exitReason || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {})
  };

  return {
    ...baseSummary,
    checkpointDisposition: checkpointDisposition(baseSummary)
  };
}

module.exports = {
  LEDGER_PATH,
  appendSamples,
  readJsonl,
  sampleKey,
  summarizeLedger
};
