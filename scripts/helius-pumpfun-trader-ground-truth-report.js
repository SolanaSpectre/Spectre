#!/usr/bin/env node
'use strict';

if (process.env.SPECTRE_SKIP_DOTENV !== 'true') {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
}

const fs = require('fs');
const path = require('path');
const { Connection } = require('@solana/web3.js');
const { decodePumpTradeEventLog } = require('../src/lib/pump-trade-event-decoder');

const ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-recall-autopsy-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-trader-ground-truth');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-trader-ground-truth-latest.json');

const DEFAULT_PARITY_INPUT = path.join(ROOT, 'data', 'reports', 'helius-pumpfun-shadow-parity-latest.json');

const METHODOLOGY = Object.freeze({
  id: 'helius_pumpfun_trader_ground_truth_v2_2026-08-03',
  mode: 'read_only_rpc_report',
  sampleLimitDefault: 12,
  sampling: 'deterministic_round_robin_across_identity_residue_and_trader_disagreement_cohorts',
  groundTruth: 'TradeEvent_user_fields_decoded_from_getTransaction_logMessages_plus_transaction_fee_payer',
  endpointPersistence: 'forbidden',
  strategyConsumptionAllowed: false,
  // v1 sampled only IDENTITY_RESIDUE rows from the recall autopsy, so a run with perfect
  // recall starved the cohort and produced zero adjudications. traderGroundTruthRule needs
  // the trader disagreements themselves, which the parity report now emits.
  v2CohortAmendment:
    'add_trader_identity_disagreement_cohort_from_parity_report_so_perfect_recall_runs_still_adjudicate',
  v2AmendedAt: '2026-08-03T02:20:00.000-05:00'
});

function parseCli(argv = process.argv.slice(2)) {
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    inputPath: path.resolve(valueAfter('--input') || DEFAULT_INPUT),
    parityPath: path.resolve(valueAfter('--parity') || DEFAULT_PARITY_INPUT),
    limit: Math.max(1, Number(valueAfter('--limit')) || METHODOLOGY.sampleLimitDefault)
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function groupDisagreementsByMint(parityReport) {
  const byMint = new Map();
  for (const row of parityReport?.traderIdentityDisagreementCohort || []) {
    if (!row?.mint || !row?.signature) continue;
    const rows = byMint.get(row.mint) || [];
    rows.push(row);
    byMint.set(row.mint, rows);
  }
  return [...byMint.entries()].map(([mint, rows]) => ({ mint, rows, index: 0 }));
}

function selectSamples(report, limit, parityReport = null) {
  const residueCohorts = (report.cohorts || []).map((cohort) => ({
    mint: cohort.mint,
    rows: (cohort.samples || []).filter((row) => row.classification === 'IDENTITY_RESIDUE'),
    index: 0
  }));
  const cohorts = [...residueCohorts, ...groupDisagreementsByMint(parityReport)]
    .filter((cohort) => cohort.rows.length);
  const selected = [];
  const seen = new Set();
  while (selected.length < limit && cohorts.some((cohort) => cohort.index < cohort.rows.length)) {
    for (const cohort of cohorts) {
      const row = cohort.rows[cohort.index];
      cohort.index += 1;
      if (!row || !row.signature || seen.has(row.signature)) continue;
      seen.add(row.signature);
      selected.push({ ...row, mint: cohort.mint });
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function feePayerOf(transaction) {
  const message = transaction?.transaction?.message;
  const key = message?.staticAccountKeys?.[0] || message?.accountKeys?.[0] || null;
  return key?.pubkey?.toBase58?.() || key?.toBase58?.() || String(key || '') || null;
}

function decodedTradeEvents(transaction) {
  return (transaction?.meta?.logMessages || []).map((line) => decodePumpTradeEventLog(line)).filter(Boolean);
}

function classifyAttribution(sample, transaction) {
  if (!transaction) return { classification: 'TRANSACTION_UNAVAILABLE', feePayer: null, events: [] };
  const feePayer = feePayerOf(transaction);
  const events = decodedTradeEvents(transaction).filter((event) => event.mint === sample.mint).map((event) => ({
    user: event.user,
    side: event.isBuy ? 'buy' : 'sell',
    solAmountRaw: event.solAmount
  }));
  const sameSideEvents = events.filter((event) => event.side === sample.side);
  const portalMatchesEventUser = sameSideEvents.some((event) => event.user === sample.trader);
  const heliusTraders = new Set(sample.heliusTraderSamples || []);
  const heliusMatchesEventUser = sameSideEvents.some((event) => heliusTraders.has(event.user));
  const portalMatchesFeePayer = Boolean(feePayer && feePayer === sample.trader);
  const heliusMatchesFeePayer = Boolean(feePayer && heliusTraders.has(feePayer));
  let classification = 'INCONCLUSIVE';
  if (heliusMatchesEventUser && heliusMatchesFeePayer && !portalMatchesEventUser) {
    classification = 'HELIUS_MATCHES_EVENT_USER_AND_FEE_PAYER';
  } else if (portalMatchesEventUser && heliusMatchesEventUser) classification = 'BOTH_MATCH_ONCHAIN_EVENT_USERS';
  else if (heliusMatchesEventUser && portalMatchesFeePayer) classification = 'HELIUS_MATCHES_EVENT_USER_PORTAL_MATCHES_FEE_PAYER';
  else if (heliusMatchesEventUser) classification = 'HELIUS_MATCHES_EVENT_USER_ONLY';
  else if (portalMatchesEventUser) classification = 'PUMPPORTAL_MATCHES_EVENT_USER_ONLY';
  else if (portalMatchesFeePayer) classification = 'PUMPPORTAL_MATCHES_FEE_PAYER_ONLY';
  else if (heliusMatchesFeePayer) classification = 'HELIUS_MATCHES_FEE_PAYER_ONLY';
  return {
    classification,
    feePayer,
    portalMatchesEventUser,
    heliusMatchesEventUser,
    portalMatchesFeePayer,
    heliusMatchesFeePayer,
    events
  };
}

async function fetchWithRetry(connection, signature, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const transaction = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (transaction) return { transaction, attempts: attempt, error: null };
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  return { transaction: null, attempts, error: lastError?.message || 'transaction_not_found' };
}

async function mapBounded(rows, concurrency, mapper) {
  const results = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  return results;
}

async function buildReport(inputReport, connection, limit, parityReport = null) {
  const samples = selectSamples(inputReport, limit, parityReport);
  const rows = await mapBounded(samples, 3, async (sample) => {
    const fetched = await fetchWithRetry(connection, sample.signature);
    const attribution = classifyAttribution(sample, fetched.transaction);
    return {
      mint: sample.mint,
      signature: sample.signature,
      pumpPortalTrader: sample.trader,
      pumpPortalSide: sample.side,
      heliusTraderSamples: sample.heliusTraderSamples || [],
      attempts: fetched.attempts,
      fetchError: fetched.error,
      ...attribution
    };
  });
  const classifications = rows.reduce((counts, row) => {
    counts[row.classification] = (counts[row.classification] || 0) + 1;
    return counts;
  }, {});
  return {
    generatedAt: new Date().toISOString(),
    sourceAutopsy: inputReport.sourceTelemetry || null,
    methodology: METHODOLOGY,
    sourceParity: parityReport?.sourceTelemetry || null,
    counts: {
      requested: limit,
      sampled: samples.length,
      fetched: rows.filter((row) => !row.fetchError).length,
      identityResidueAvailable: (inputReport.cohorts || [])
        .reduce((sum, cohort) => sum + (cohort.samples || [])
          .filter((row) => row.classification === 'IDENTITY_RESIDUE').length, 0),
      traderDisagreementsAvailable: (parityReport?.traderIdentityDisagreementCohort || []).length
    },
    classifications,
    rows,
    interpretation: 'Read-only ground truth for comparator semantics. This artifact cannot authorize runtime source promotion.'
  };
}

function writeReport(report) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stampedPath = path.join(OUTPUT_DIR, `helius-pumpfun-trader-ground-truth-${stamp}.json`);
  fs.writeFileSync(stampedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { stampedPath, latestPath: LATEST_PATH };
}

async function main() {
  const { inputPath, parityPath, limit } = parseCli();
  if (!fs.existsSync(inputPath)) throw new Error(`Autopsy report not found: ${inputPath}`);
  const parityReport = fs.existsSync(parityPath) ? readJson(parityPath) : null;
  const endpoint = String(process.env.SOLANA_RPC_URL || '').trim();
  if (!endpoint) throw new Error('SOLANA_RPC_URL is required in the private .env.');
  const report = await buildReport(readJson(inputPath), new Connection(endpoint, 'confirmed'), limit, parityReport);
  const paths = writeReport(report);
  console.log(`Wrote Helius trader ground-truth report: ${paths.stampedPath}`);
  console.log(`Wrote latest Helius trader ground-truth report: ${paths.latestPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Helius trader ground-truth report failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { METHODOLOGY, classifyAttribution, selectSamples };
