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
  const wins = joined.filter((row) => Number(row.replay?.pnlSol) > 0).length;
  const losses = joined.filter((row) => Number(row.replay?.pnlSol) < 0).length;
  const totalPnlSol = joined.reduce((sum, row) => sum + Number(row.replay?.pnlSol || 0), 0);

  return {
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
    byExitReason: joined.reduce((counts, row) => {
      const key = row.replay?.exitReason || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {})
  };
}

module.exports = {
  LEDGER_PATH,
  appendSamples,
  readJsonl,
  sampleKey,
  summarizeLedger
};
