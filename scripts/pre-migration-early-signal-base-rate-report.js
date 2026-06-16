#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildReport } = require('./pre-migration-pre-curve60-runner-discovery-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-early-signal-base-rate-latest.json');
const DEFAULT_LIMIT = 8;

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

function telemetryFiles(limit = DEFAULT_LIMIT) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath)
    .reverse();
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function pct(part, total) {
  return total > 0 ? compact(part / total, 6) : null;
}

function pre60Number(row, key) {
  const number = Number(row.lastPre60Snapshot?.[key]);
  return Number.isFinite(number) ? number : null;
}

function numericStats(values, digits = 6) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    count: sorted.length,
    min: compact(sorted[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(sorted[sorted.length - 1], digits),
    avg: compact(sum / sorted.length, digits)
  };
}

function featureDefinitions() {
  const wallet = [
    ['any_wallet_before60', (row) => row.walletBefore60?.anyWalletTouch === true],
    ['trusted_touch_before60', (row) => row.walletBefore60?.trustedTouch === true],
    ['trusted_pre85_buy_before60', (row) => row.walletBefore60?.trustedPre85Buy === true],
    ['positive_or_proven_before60', (row) => row.walletBefore60?.positiveOrProvenTouch === true],
    ['positive_or_proven_pre85_buy_before60', (row) => row.walletBefore60?.positiveOrProvenPre85Buy === true],
    ['prospective_touch_before60', (row) => row.walletBefore60?.prospectiveTouch === true],
    ['prospective_pre85_buy_before60', (row) => row.walletBefore60?.prospectivePre85Buy === true],
    ['raw_untrusted_before60', (row) => row.walletBefore60?.rawUntrustedTouch === true],
    ['raw_untrusted_pre85_buy_before60', (row) => row.walletBefore60?.rawUntrustedPre85Buy === true],
    ['no_wallet_before60', (row) => row.walletBefore60?.anyWalletTouch !== true]
  ].map(([name, test]) => ({ name, family: 'wallet', timing: 'before_cross60', test }));

  const pre60Market = [
    ['pre60_score_70_plus', (row) => Number(pre60Number(row, 'score')) >= 70],
    ['pre60_score_85_plus', (row) => Number(pre60Number(row, 'score')) >= 85],
    ['pre60_volume_10_plus', (row) => Number(pre60Number(row, 'recentVolumeSol')) >= 10],
    ['pre60_volume_25_plus', (row) => Number(pre60Number(row, 'recentVolumeSol')) >= 25],
    ['pre60_velocity_10_plus', (row) => Number(pre60Number(row, 'tradeVelocityPerMin')) >= 10],
    ['pre60_velocity_25_plus', (row) => Number(pre60Number(row, 'tradeVelocityPerMin')) >= 25],
    ['pre60_buyers_15_plus', (row) => Number(pre60Number(row, 'uniqueBuyerCount')) >= 15],
    ['pre60_buyers_25_plus', (row) => Number(pre60Number(row, 'uniqueBuyerCount')) >= 25],
    ['pre60_snipers_8_or_less', (row) => {
      const snipers = pre60Number(row, 'sniperWalletCount');
      return Number.isFinite(snipers) && snipers <= 8;
    }]
  ].map(([name, test]) => ({ name, family: 'market', timing: 'last_snapshot_before_cross60', test }));

  const pre60Combos = [
    ['raw_pre85_buy_pre60_velocity25', (row) => (
      row.walletBefore60?.rawUntrustedPre85Buy === true
      && Number(pre60Number(row, 'tradeVelocityPerMin')) >= 25
    )],
    ['raw_pre85_buy_pre60_velocity25_buyers15', (row) => (
      row.walletBefore60?.rawUntrustedPre85Buy === true
      && Number(pre60Number(row, 'tradeVelocityPerMin')) >= 25
      && Number(pre60Number(row, 'uniqueBuyerCount')) >= 15
    )],
    ['raw_pre85_buy_pre60_velocity25_buyers15_no_avoid', (row) => (
      row.walletBefore60?.rawUntrustedPre85Buy === true
      && row.walletBefore60?.avoidTouch !== true
      && Number(pre60Number(row, 'tradeVelocityPerMin')) >= 25
      && Number(pre60Number(row, 'uniqueBuyerCount')) >= 15
    )],
    ['pre60_buyers15_velocity25', (row) => (
      Number(pre60Number(row, 'uniqueBuyerCount')) >= 15
      && Number(pre60Number(row, 'tradeVelocityPerMin')) >= 25
    )],
    ['pre60_buyers25_score70', (row) => (
      Number(pre60Number(row, 'uniqueBuyerCount')) >= 25
      && Number(pre60Number(row, 'score')) >= 70
    )],
    ['trusted_pre85_buy_pre60_buyers15_snipers8', (row) => {
      const snipers = pre60Number(row, 'sniperWalletCount');
      return row.walletBefore60?.trustedPre85Buy === true
        && Number(pre60Number(row, 'uniqueBuyerCount')) >= 15
        && Number.isFinite(snipers)
        && snipers <= 8;
    }]
  ].map(([name, test]) => ({ name, family: 'combo', timing: 'last_snapshot_before_cross60', test }));

  const maxOverRun = [
    ['max_score_70_plus', (row) => Number(row.maxScore) >= 70],
    ['max_score_85_plus', (row) => Number(row.maxScore) >= 85],
    ['max_volume_10_plus', (row) => Number(row.maxRecentVolumeSol) >= 10],
    ['max_volume_25_plus', (row) => Number(row.maxRecentVolumeSol) >= 25],
    ['max_velocity_10_plus', (row) => Number(row.maxTradeVelocityPerMin) >= 10],
    ['max_velocity_25_plus', (row) => Number(row.maxTradeVelocityPerMin) >= 25],
    ['max_buyers_25_plus', (row) => Number(row.maxUniqueBuyerCount) >= 25],
    ['raw_pre85_buy_and_max_velocity_25', (row) => (
      row.walletBefore60?.rawUntrustedPre85Buy === true
      && Number(row.maxTradeVelocityPerMin) >= 25
    )]
  ].map(([name, test]) => ({ name, family: 'max_over_run_diagnostic', timing: 'future_leaky_max_over_run', test }));

  return [...wallet, ...pre60Market, ...pre60Combos, ...maxOverRun];
}

function summarizeRows(rows, baseline = null) {
  const total = rows.length;
  const crossed60 = rows.filter((row) => row.crossed60).length;
  const crossed85 = rows.filter((row) => row.crossed85).length;
  const crossed90 = rows.filter((row) => row.crossed90).length;
  const cross60Rate = pct(crossed60, total);
  const cross85Rate = pct(crossed85, total);
  const cross90Rate = pct(crossed90, total);
  return {
    total,
    uniqueMints: new Set(rows.map((row) => row.mint)).size,
    crossed60,
    crossed85,
    crossed90,
    cross60Rate,
    cross85Rate,
    cross90Rate,
    precision90: cross90Rate,
    capture90: baseline?.crossed90 ? compact(crossed90 / baseline.crossed90, 6) : null,
    lift60: baseline?.cross60Rate ? compact(cross60Rate / baseline.cross60Rate, 3) : null,
    lift85: baseline?.cross85Rate ? compact(cross85Rate / baseline.cross85Rate, 3) : null,
    lift90: baseline?.cross90Rate ? compact(cross90Rate / baseline.cross90Rate, 3) : null,
    maxPriceDeltaCross60: numericStats(rows.filter((row) => row.crossed60).map((row) => row.maxPriceDeltaFromFirstPricePct), 2),
    secondsToCross60: numericStats(rows.filter((row) => row.crossed60).map((row) => row.secondsFirstSeenToCross60), 2)
  };
}

function summarizeByRun(rows, feature) {
  const byRun = new Map();
  for (const row of rows) {
    const key = row.telemetryPath || 'unknown';
    if (!byRun.has(key)) byRun.set(key, []);
    byRun.get(key).push(row);
  }
  return Array.from(byRun.entries()).map(([telemetryPath, runRows]) => {
    const matched = runRows.filter(feature.test);
    const baseline = summarizeRows(runRows);
    return {
      telemetryPath,
      baseline,
      matched: summarizeRows(matched, baseline)
    };
  });
}

function verdictForFeature(summary, feature) {
  if (feature.timing === 'future_leaky_max_over_run') return 'LEAKY_MAX_OVER_RUN_DIAGNOSTIC_ONLY';
  if (summary.total < 20) return 'INSUFFICIENT_SAMPLE';
  if (summary.cross90Rate !== null && summary.crossed90 < 5) return 'INSUFFICIENT_CROSS90_OUTCOMES';
  if (summary.cross90Rate === null || summary.lift90 === null) return 'NO_CROSS90_LIFT';
  if (summary.crossed90 < 20 && summary.lift90 >= 3 && summary.cross90Rate >= 0.01) return 'BASE_RATE_LEAD_REPLAY_REQUIRED';
  if (summary.lift90 >= 3 && summary.cross90Rate >= 0.01) return 'PROMISING_AFTER_REPLAY';
  if (summary.lift90 >= 1.5) return 'WEAK_BASE_RATE_LIFT';
  return 'NO_BASE_RATE_LIFT';
}

function buildOverlapMatrix(rows, features) {
  const selectedNames = [
    'raw_untrusted_pre85_buy_before60',
    'any_wallet_before60',
    'pre60_buyers_15_plus',
    'pre60_buyers_25_plus',
    'pre60_velocity_25_plus',
    'pre60_volume_25_plus',
    'pre60_score_70_plus',
    'raw_pre85_buy_pre60_velocity25_buyers15_no_avoid'
  ];
  const selected = features.filter((feature) => selectedNames.includes(feature.name));
  const rowsByFeature = new Map(selected.map((feature) => [feature.name, rows.filter(feature.test)]));
  const matrix = [];
  for (let a = 0; a < selected.length; a += 1) {
    for (let b = a + 1; b < selected.length; b += 1) {
      const left = selected[a];
      const right = selected[b];
      const leftKeys = new Set(rowsByFeature.get(left.name).map((row) => `${row.telemetryPath}:${row.mint}`));
      const rightKeys = new Set(rowsByFeature.get(right.name).map((row) => `${row.telemetryPath}:${row.mint}`));
      const overlapRows = rows.filter((row) => leftKeys.has(`${row.telemetryPath}:${row.mint}`) && rightKeys.has(`${row.telemetryPath}:${row.mint}`));
      const union = new Set([...leftKeys, ...rightKeys]).size;
      matrix.push({
        featureA: left.name,
        featureB: right.name,
        featureATotal: leftKeys.size,
        featureBTotal: rightKeys.size,
        overlapTotal: overlapRows.length,
        overlapCross90: overlapRows.filter((row) => row.crossed90).length,
        overlapCross90Rate: pct(overlapRows.filter((row) => row.crossed90).length, overlapRows.length),
        jaccard: union ? compact(overlapRows.length / union, 6) : null,
        featureAShare: leftKeys.size ? compact(overlapRows.length / leftKeys.size, 6) : null,
        featureBShare: rightKeys.size ? compact(overlapRows.length / rightKeys.size, 6) : null
      });
    }
  }
  return matrix.sort((a, b) => b.overlapCross90 - a.overlapCross90 || b.overlapTotal - a.overlapTotal);
}

function summarizeGlobalMints(rows) {
  const byMint = new Map();
  for (const row of rows) {
    if (!byMint.has(row.mint)) byMint.set(row.mint, []);
    byMint.get(row.mint).push(row);
  }
  const mintRows = Array.from(byMint.values()).map((mintRowsForOneMint) => ({
    mint: mintRowsForOneMint[0].mint,
    runObservations: mintRowsForOneMint.length,
    crossed60: mintRowsForOneMint.some((row) => row.crossed60),
    crossed85: mintRowsForOneMint.some((row) => row.crossed85),
    crossed90: mintRowsForOneMint.some((row) => row.crossed90)
  }));
  return summarizeRows(mintRows);
}

function buildBaseRateReport(filePaths) {
  const discovery = buildReport(filePaths, { includeAllRows: true });
  const rows = discovery.rows || [];
  const baseline = summarizeRows(rows);
  const definitions = featureDefinitions();
  const features = definitions.map((feature) => {
    const matchedRows = rows.filter(feature.test);
    const summary = summarizeRows(matchedRows, baseline);
    return {
      name: feature.name,
      family: feature.family,
      timing: feature.timing,
      summary: {
        ...summary,
        verdict: verdictForFeature(summary, feature)
      },
      perRun: summarizeByRun(rows, feature)
    };
  }).sort((a, b) => Number(b.summary.lift90 || 0) - Number(a.summary.lift90 || 0)
    || Number(b.summary.cross90Rate || 0) - Number(a.summary.cross90Rate || 0)
    || Number(b.summary.total || 0) - Number(a.summary.total || 0));

  const topWallet = features.filter((row) => row.family === 'wallet').slice(0, 8);
  const topPre60 = features.filter((row) => row.timing === 'last_snapshot_before_cross60').slice(0, 12);
  const topMaxOverRunDiagnostics = features.filter((row) => row.timing === 'future_leaky_max_over_run').slice(0, 8);
  const replayRequired = features.filter((row) => row.summary.verdict === 'BASE_RATE_LEAD_REPLAY_REQUIRED' || row.summary.verdict === 'PROMISING_AFTER_REPLAY');
  const bestReplayCandidate = replayRequired.find((row) => row.timing !== 'future_leaky_max_over_run') || topPre60[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_curve60_early_signal_base_rate',
    inputs: {
      telemetryFiles: filePaths.map((filePath) => path.relative(ROOT, filePath)),
      sourceReport: 'pre-migration-pre-curve60-runner-discovery-report',
      rowUnit: 'run_mint',
      note: 'Rows are run-mint observations. Market features prefixed pre60 use only the last known snapshot before the first 60% curve crossing; max_* features are future-leaky diagnostics only.'
    },
    summary: {
      baseline,
      globalMintBaseline: summarizeGlobalMints(rows),
      features: features.length,
      replayRequiredFeatures: replayRequired.map((row) => row.name),
      bestReplayCandidate: bestReplayCandidate?.name || null,
      bestReplayCandidateVerdict: bestReplayCandidate?.summary?.verdict || null,
      bestReplayCandidateLift90: bestReplayCandidate?.summary?.lift90 ?? null,
      leakyDiagnosticsCount: topMaxOverRunDiagnostics.length,
      recommendation: replayRequired.length
        ? 'run_first_hit_replay_before_shadow_lane'
        : 'collect_more_pre60_signal_data_before_shadow_lane'
    },
    topWallet,
    topPre60,
    topMaxOverRunDiagnostics,
    featureOverlapMatrix: buildOverlapMatrix(rows, definitions),
    features
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const explicit = args.telemetry || args.file;
  const filePaths = explicit
    ? String(explicit).split(',').map((item) => repoPath(item.trim())).filter(Boolean)
    : telemetryFiles(Number(args.limit || DEFAULT_LIMIT));
  if (!filePaths.length) {
    console.error('No telemetry files found. Pass --telemetry <path[,path]> or run paper sessions first.');
    process.exit(1);
  }
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  const report = buildBaseRateReport(filePaths);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
}

if (require.main === module) main();

module.exports = { buildBaseRateReport, featureDefinitions };
