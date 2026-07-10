'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LEDGER_PATH = path.join(ROOT, 'data', 'wallet-shadow-ledgers', 'frozen-slice-samples.jsonl');

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
    sample.frozenSlice || 'unknown_slice',
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
  if (!normalized.length) {
    return {
      ledgerPath,
      appended: 0,
      existing: readJsonl(ledgerPath).length,
      total: readJsonl(ledgerPath).length
    };
  }

  const existingRows = readJsonl(ledgerPath);
  // Post-run reports are sequential today; add file locking before parallelizing ledger writers.
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
    if (filters.frozenSlice && row.frozenSlice !== filters.frozenSlice) return false;
    if (filters.era && row.era !== filters.era) return false;
    return true;
  });
  const byCohort = {};
  let outcomeJoined120s = 0;
  let outcomeMissing120s = 0;
  for (const row of selected) {
    const cohort = row.cohort || 'unknown';
    const bucket = byCohort[cohort] || {
      samples: 0,
      uniqueMints: new Set(),
      withPositiveOrProvenTouch: 0,
      withAvoidTouch: 0,
      outcomeJoined120s: 0,
      outcomeMissing120s: 0,
      crossed85Within120s: 0,
      crossed90Within120s: 0,
      crossed90Within300s: 0
    };
    bucket.samples += 1;
    if (row.mint) bucket.uniqueMints.add(row.mint);
    if (row.withPositiveOrProvenTouch) bucket.withPositiveOrProvenTouch += 1;
    if (row.withAvoidTouch) bucket.withAvoidTouch += 1;
    if (row.windows?.['120s']?.outcomeJoined) {
      bucket.outcomeJoined120s += 1;
      outcomeJoined120s += 1;
    } else {
      bucket.outcomeMissing120s += 1;
      outcomeMissing120s += 1;
    }
    if (row.windows?.['120s']?.crossed85) bucket.crossed85Within120s += 1;
    if (row.windows?.['120s']?.crossed90) bucket.crossed90Within120s += 1;
    if (row.windows?.['300s']?.crossed90) bucket.crossed90Within300s += 1;
    byCohort[cohort] = bucket;
  }

  return {
    ledgerPath,
    totalRows: rows.length,
    filteredRows: selected.length,
    filters,
    outcomeJoined120s,
    outcomeMissing120s,
    byCohort: Object.fromEntries(Object.entries(byCohort).map(([cohort, bucket]) => [cohort, {
      ...bucket,
      uniqueMints: bucket.uniqueMints.size
    }]))
  };
}

module.exports = {
  LEDGER_PATH,
  appendSamples,
  readJsonl,
  sampleKey,
  summarizeLedger
};
