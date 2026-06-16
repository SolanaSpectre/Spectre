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
  return [
    {
      name: 'any_wallet_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.anyWalletTouch === true
    },
    {
      name: 'trusted_touch_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.trustedTouch === true
    },
    {
      name: 'trusted_pre85_buy_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.trustedPre85Buy === true
    },
    {
      name: 'positive_or_proven_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.positiveOrProvenTouch === true
    },
    {
      name: 'positive_or_proven_pre85_buy_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.positiveOrProvenPre85Buy === true
    },
    {
      name: 'prospective_touch_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.prospectiveTouch === true
    },
    {
      name: 'prospective_pre85_buy_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.prospectivePre85Buy === true
    },
    {
      name: 'raw_untrusted_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.rawUntrustedTouch === true
    },
    {
      name: 'raw_untrusted_pre85_buy_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.rawUntrustedPre85Buy === true
    },
    {
      name: 'no_wallet_before60',
      family: 'wallet',
      test: (row) => row.walletBefore60?.anyWalletTouch !== true
    },
    {
      name: 'score_70_plus',
      family: 'market',
      test: (row) => Number(row.maxScore) >= 70
    },
    {
      name: 'score_85_plus',
      family: 'market',
      test: (row) => Number(row.maxScore) >= 85
    },
    {
      name: 'volume_10_plus',
      family: 'market',
      test: (row) => Number(row.maxRecentVolumeSol) >= 10
    },
    {
      name: 'volume_25_plus',
      family: 'market',
      test: (row) => Number(row.maxRecentVolumeSol) >= 25
    },
    {
      name: 'velocity_10_plus',
      family: 'market',
      test: (row) => Number(row.maxTradeVelocityPerMin) >= 10
    },
    {
      name: 'velocity_25_plus',
      family: 'market',
      test: (row) => Number(row.maxTradeVelocityPerMin) >= 25
    },
    {
      name: 'buyers_25_plus',
      family: 'market',
      test: (row) => Number(row.maxUniqueBuyerCount) >= 25
    },
    {
      name: 'snipers_5_or_less',
      family: 'risk',
      test: (row) => Number.isFinite(Number(row.maxSniperWalletCount)) && Number(row.maxSniperWalletCount) <= 5
    },
    {
      name: 'trusted_pre85_buy_and_velocity_10',
      family: 'combo',
      test: (row) => row.walletBefore60?.trustedPre85Buy === true && Number(row.maxTradeVelocityPerMin) >= 10
    },
    {
      name: 'positive_pre85_buy_and_velocity_10',
      family: 'combo',
      test: (row) => row.walletBefore60?.positiveOrProvenPre85Buy === true && Number(row.maxTradeVelocityPerMin) >= 10
    },
    {
      name: 'raw_pre85_buy_and_velocity_25',
      family: 'combo',
      test: (row) => row.walletBefore60?.rawUntrustedPre85Buy === true && Number(row.maxTradeVelocityPerMin) >= 25
    }
  ];
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

function verdictForFeature(summary) {
  if (summary.total < 20) return 'INSUFFICIENT_SAMPLE';
  if (summary.cross90Rate !== null && summary.crossed90 < 5) return 'INSUFFICIENT_CROSS90_OUTCOMES';
  if (summary.cross90Rate === null || summary.lift90 === null) return 'NO_CROSS90_LIFT';
  if (summary.lift90 >= 3 && summary.cross90Rate >= 0.01) return 'PROMISING_BASE_RATE_LIFT';
  if (summary.lift90 >= 1.5) return 'WEAK_BASE_RATE_LIFT';
  return 'NO_BASE_RATE_LIFT';
}

function buildBaseRateReport(filePaths) {
  const discovery = buildReport(filePaths, { includeAllRows: true });
  const rows = discovery.rows || [];
  const baseline = summarizeRows(rows);
  const features = featureDefinitions().map((feature) => {
    const matchedRows = rows.filter(feature.test);
    const summary = summarizeRows(matchedRows, baseline);
    return {
      name: feature.name,
      family: feature.family,
      summary: {
        ...summary,
        verdict: verdictForFeature(summary)
      },
      perRun: summarizeByRun(rows, feature)
    };
  }).sort((a, b) => Number(b.summary.lift90 || 0) - Number(a.summary.lift90 || 0)
    || Number(b.summary.cross90Rate || 0) - Number(a.summary.cross90Rate || 0)
    || Number(b.summary.total || 0) - Number(a.summary.total || 0));

  const topWallet = features.filter((row) => row.family === 'wallet').slice(0, 8);
  const topMarket = features.filter((row) => row.family !== 'wallet').slice(0, 8);
  const promising = features.filter((row) => row.summary.verdict === 'PROMISING_BASE_RATE_LIFT');
  const bestPromisingWallet = features.find((row) => row.family === 'wallet' && row.summary.verdict === 'PROMISING_BASE_RATE_LIFT') || topWallet[0] || null;
  const bestPromisingMarket = features.find((row) => row.family !== 'wallet' && row.summary.verdict === 'PROMISING_BASE_RATE_LIFT') || topMarket[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_curve60_early_signal_base_rate',
    inputs: {
      telemetryFiles: filePaths.map((filePath) => path.relative(ROOT, filePath)),
      sourceReport: 'pre-migration-pre-curve60-runner-discovery-report',
      rowUnit: 'run_mint',
      note: 'Rows are run-mint observations, not globally deduped unique mints.'
    },
    summary: {
      baseline,
      features: features.length,
      promisingFeatures: promising.map((row) => row.name),
      bestWalletFeature: bestPromisingWallet?.name || null,
      bestWalletFeatureVerdict: bestPromisingWallet?.summary?.verdict || null,
      bestWalletFeatureLift90: bestPromisingWallet?.summary?.lift90 ?? null,
      bestMarketFeature: bestPromisingMarket?.name || null,
      bestMarketFeatureVerdict: bestPromisingMarket?.summary?.verdict || null,
      bestMarketFeatureLift90: bestPromisingMarket?.summary?.lift90 ?? null,
      recommendation: promising.length
        ? 'inspect_promising_features_before_shadow_lane'
        : 'no_shadow_lane_until_feature_lift_improves'
    },
    topWallet,
    topMarket,
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

module.exports = { buildBaseRateReport };
