#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STABILITY_PATH = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-stability-latest.json');
const REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-observation-only-tier');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-observation-only-tier-latest.json');
const SHADOW_WALLET_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'shadow-untracked-wallets.json');

const ERA = 'observation_only_v2_2026-07-09';
const MAX_ROWS_PER_MINT = 5;
const MAX_DISTINCT_MINTS_PER_HOUR = 15;
const MAX_WALLETS = 100;

function readJson(filePath, fallback = null) {
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

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function hoursBetween(startIso, endIso) {
  const start = new Date(startIso || 0).getTime();
  const end = new Date(endIso || 0).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return (end - start) / 3600000;
}

function candidateRows(stability = {}) {
  return [
    ...(Array.isArray(stability.repeatShortlistCandidates) ? stability.repeatShortlistCandidates : []),
    ...(Array.isArray(stability.repeatManualReviewCandidates) ? stability.repeatManualReviewCandidates : []),
    ...(Array.isArray(stability.repeatObserveNextRun) ? stability.repeatObserveNextRun : [])
  ];
}

function normalizeCandidate(row = {}) {
  const launch = row.launchIntel || {};
  const totalLaunches = Number(launch.totalLaunches || 0);
  const avgBuysPerLaunch = Number(launch.avgBuysPerLaunch);
  const activeHours = hoursBetween(launch.firstSeen, launch.lastSeen);
  const distinctMintsPerHour = activeHours ? totalLaunches / activeHours : null;
  const runCount = Number(row.runCount || 0);
  const pre85BuyRows = Number(row.pre85BuyRows || 0);
  const busyFlowReasons = [
    Number.isFinite(avgBuysPerLaunch) && avgBuysPerLaunch > MAX_ROWS_PER_MINT ? 'ROWS_PER_MINT_GT_5' : null,
    Number.isFinite(Number(distinctMintsPerHour)) && distinctMintsPerHour > MAX_DISTINCT_MINTS_PER_HOUR ? 'MINTS_PER_HOUR_GT_15' : null,
    Array.isArray(row.flags) && row.flags.includes('BUSY_FLOW_RISK') ? 'SOURCE_BUSY_FLOW_RISK' : null,
    row.classification === 'BUSY_FLOW_RISK' ? 'CLASSIFIED_BUSY_FLOW_RISK' : null
  ].filter(Boolean);
  const stage0Qualified = (
    runCount >= 2
    && pre85BuyRows > 0
    && busyFlowReasons.length === 0
  );
  const score = Math.max(0, Math.min(100,
    Number(row.score || 0)
    + Math.min(runCount, 4) * 2
    + Math.min(Number(row.decisionRunCount || 0), 4)
    - (Number.isFinite(avgBuysPerLaunch) ? Math.max(0, avgBuysPerLaunch - 1.5) * 3 : 0)
  ));

  return {
    wallet: row.wallet,
    stage: stage0Qualified ? 'observation_only' : 'excluded',
    era: ERA,
    sourceClassification: row.classification || null,
    score: compact(score, 2),
    stage0Qualified,
    exclusionReasons: busyFlowReasons,
    runCount,
    decisionRunCount: Number(row.decisionRunCount || 0),
    buyRows: Number(row.buyRows || 0),
    pre85BuyRows,
    noTrackedFirstTouchLinks: Number(row.noTrackedFirstTouchLinks || 0),
    nearPriorDecisionLinks: Number(row.nearPriorDecisionLinks || 0),
    rowsPerMint: Number.isFinite(avgBuysPerLaunch) ? compact(avgBuysPerLaunch, 4) : null,
    distinctMintsPerHour: Number.isFinite(Number(distinctMintsPerHour)) ? compact(distinctMintsPerHour, 4) : null,
    launchIntel: {
      totalLaunches,
      totalBuyCount: Number(launch.totalBuyCount || 0),
      totalVolumeSol: compact(launch.totalVolumeSol, 6),
      firstSeen: launch.firstSeen || null,
      lastSeen: launch.lastSeen || null
    },
    flags: Array.from(new Set([
      'OBSERVATION_ONLY_V2',
      'REPORT_ONLY_SHADOW',
      'NO_RUNTIME_TRUST',
      'NO_ENTRY_GATE_EFFECT',
      ...(Array.isArray(row.flags) ? row.flags : [])
    ])),
    runIds: Array.isArray(row.runIds) ? row.runIds : [],
    sampleMints: Array.isArray(row.sampleMints) ? row.sampleMints : []
  };
}

function buildWatchlist(rows, generatedAt) {
  return {
    source: 'wallet_observation_only_tier_report',
    updatedAt: generatedAt,
    mode: 'report_only_shadow_profiles',
    era: ERA,
    note: 'Observation-only wallets are used for telemetry and shadow validation. They must not satisfy real wallet-proof entry guards.',
    wallets: rows.map((row) => ({
      walletAddress: row.wallet,
      name: `obs_v2_${String(row.wallet || '').slice(0, 6)}`,
      source: 'observation_only_v2_launch_intel_stability',
      trustTier: null,
      profile: 'observation_only_v2',
      score: row.score,
      twitter: null,
      telegram: null,
      flags: row.flags.slice(0, 12),
      era: row.era,
      evidence: {
        runCount: row.runCount,
        decisionRunCount: row.decisionRunCount,
        pre85BuyRows: row.pre85BuyRows,
        rowsPerMint: row.rowsPerMint,
        distinctMintsPerHour: row.distinctMintsPerHour,
        sourceClassification: row.sourceClassification
      }
    }))
  };
}

function main() {
  const stability = readJson(STABILITY_PATH, null);
  if (!stability) throw new Error(`Missing launch-intel stability report: ${STABILITY_PATH}`);

  const normalized = candidateRows(stability)
    .filter((row) => row.wallet)
    .map(normalizeCandidate)
    .sort((a, b) => (
      Number(b.stage0Qualified) - Number(a.stage0Qualified)
      || Number(b.score || 0) - Number(a.score || 0)
      || Number(b.runCount || 0) - Number(a.runCount || 0)
      || Number(a.rowsPerMint || 999) - Number(b.rowsPerMint || 999)
    ));
  const selected = normalized
    .filter((row) => row.stage0Qualified)
    .slice(0, MAX_WALLETS);
  const excluded = normalized.filter((row) => !row.stage0Qualified);
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    mode: 'report_only_wallet_observation_only_tier',
    era: ERA,
    sources: {
      stabilityPath: STABILITY_PATH,
      stabilityGeneratedAt: stability.generatedAt || null,
      shadowWalletPath: SHADOW_WALLET_PATH
    },
    thresholds: {
      stage0: {
        minDistinctRuns: 2,
        requirePre85BuyRows: true,
        maxRowsPerMint: MAX_ROWS_PER_MINT,
        maxDistinctMintsPerHour: MAX_DISTINCT_MINTS_PER_HOUR
      },
      promotionNotImplemented: {
        observationOnlyToShadowTracked: 'requires temporal OOS lift report across future runs',
        shadowTrackedToTrusted: 'requires positive frozen-rule OOS replay across >=3 runs with fee stress'
      }
    },
    summary: {
      sourceRows: normalized.length,
      selectedObservationOnly: selected.length,
      excluded: excluded.length,
      busyFlowExcluded: excluded.filter((row) => row.exclusionReasons.length > 0).length,
      maxWallets: MAX_WALLETS,
      liveBroadcastImplication: 'none_report_only',
      runtimeTrustImplication: 'none_shadow_only'
    },
    selectedObservationOnly: selected,
    excludedSamples: excluded.slice(0, 50),
    requiredBeforePromotion: [
      'per-wallet temporal OOS lift with qualification runs separated from evaluation runs',
      'cohort half-life report',
      'coalition/sybil clustering on observation cohort',
      'frozen-slice v2 stability report using only OOS observation-cohort touches',
      'scorecard rows separated by cohort provenance'
    ]
  };

  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `wallet-observation-only-tier-${stamp}.json`);
  writeJson(reportPath, report);
  writeJson(LATEST_PATH, report);
  writeJson(SHADOW_WALLET_PATH, buildWatchlist(selected, generatedAt));
  console.log(`Wrote observation-only tier report: ${reportPath}`);
  console.log(`Wrote latest observation-only tier report: ${LATEST_PATH}`);
  console.log(`Updated shadow wallet watchlist: ${SHADOW_WALLET_PATH}`);
  console.log(`selected=${selected.length} excluded=${excluded.length} busyFlowExcluded=${report.summary.busyFlowExcluded}`);
}

main();
