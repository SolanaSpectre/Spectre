#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { scan, buildReport } = require('./pre-migration-flagged-candidate-attribution-report');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-follow-through-slices');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-flagged-follow-through-slices-latest.json');
const DEFAULT_LIMIT = 8;
const MIN_MEASURED_FOR_PROMOTION = 20;

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

function primaryCountKey(counts = {}) {
  return Object.entries(counts || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || 'unknown';
}

function scoreBand(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 'score_unknown';
  if (score >= 90) return 'score_90_plus';
  if (score >= 80) return 'score_80_90';
  if (score >= 70) return 'score_70_80';
  if (score >= 60) return 'score_60_70';
  if (score >= 45) return 'score_45_60';
  return 'score_lt45';
}

function curveBand(value) {
  const curve = Number(value);
  if (!Number.isFinite(curve)) return 'curve_unknown';
  if (curve >= 0.85) return 'curve_85_plus';
  if (curve >= 0.75) return 'curve_75_85';
  if (curve >= 0.6) return 'curve_60_75';
  if (curve >= 0.45) return 'curve_45_60';
  if (curve >= 0.3) return 'curve_30_45';
  return 'curve_lt30';
}

function volumeBand(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return 'volume_unknown';
  if (volume >= 100) return 'volume_100_plus';
  if (volume >= 50) return 'volume_50_100';
  if (volume >= 20) return 'volume_20_50';
  if (volume >= 5) return 'volume_5_20';
  if (volume > 0) return 'volume_0_5';
  return 'volume_zero';
}

function velocityBand(value) {
  const velocity = Number(value);
  if (!Number.isFinite(velocity)) return 'velocity_unknown';
  if (velocity >= 100) return 'velocity_100_plus';
  if (velocity >= 50) return 'velocity_50_100';
  if (velocity >= 20) return 'velocity_20_50';
  if (velocity >= 5) return 'velocity_5_20';
  if (velocity > 0) return 'velocity_0_5';
  return 'velocity_zero';
}

function walletBucket(wallet = {}) {
  if (wallet.positiveOrProvenTouch) return 'wallet_positive_or_proven';
  if (wallet.anyTrustedTouch) return 'wallet_trusted_touch';
  if (wallet.rawUntrustedPre85Buy) return 'wallet_raw_untrusted_pre85';
  if (wallet.rawUntrustedTouch) return 'wallet_raw_untrusted_touch';
  return 'wallet_no_touch';
}

function outcomeBucket(row = {}) {
  if (row.classification === 'BLOCKED_STRONG_FOLLOW_THROUGH') return 'strong';
  if (row.classification === 'BLOCKED_USEFUL_FOLLOW_THROUGH') return 'useful';
  if (row.classification === 'CORRECTLY_BLOCKED_FLAT') return 'flat';
  return 'insufficient';
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

function summarizeRows(rows, label) {
  const measured = rows.filter((row) => row.classification !== 'INSUFFICIENT_OUTCOME_DATA');
  const strong = rows.filter((row) => row.classification === 'BLOCKED_STRONG_FOLLOW_THROUGH');
  const useful = rows.filter((row) => row.classification === 'BLOCKED_USEFUL_FOLLOW_THROUGH');
  const flat = rows.filter((row) => row.classification === 'CORRECTLY_BLOCKED_FLAT');
  const replayed = rows.filter((row) => row.replay?.replayClass === 'REPLAYED');
  const wins = replayed.filter((row) => Number(row.replay.pnlSol) > 0);
  const totalPnl = replayed.reduce((sum, row) => sum + Number(row.replay.pnlSol || 0), 0);
  const stressedPnl = replayed.reduce((sum, row) => sum + Number(row.replay.stressedPnlSol || 0), 0);
  const top3Pnl = replayed.map((row) => Number(row.replay.pnlSol) || 0)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((sum, value) => sum + value, 0);
  const measuredCount = measured.length;
  return {
    label,
    rows: rows.length,
    measured: measuredCount,
    insufficient: rows.length - measuredCount,
    strong: strong.length,
    useful: useful.length,
    flat: flat.length,
    strongOrUsefulRateMeasured: measuredCount ? compact((strong.length + useful.length) / measuredCount, 4) : null,
    replayed: replayed.length,
    wins: wins.length,
    losses: replayed.filter((row) => Number(row.replay.pnlSol) < 0).length,
    winRate: replayed.length ? compact(wins.length / replayed.length, 4) : null,
    totalPnlSol: compact(totalPnl, 9),
    stressedPnlSol: compact(stressedPnl, 9),
    medianPnlSol: numericStats(replayed.map((row) => row.replay.pnlSol), 9).median,
    top3RemovedPnlSol: compact(totalPnl - top3Pnl, 9),
    priceDelta300s: numericStats(measured.map((row) => row.window300s?.maxPriceDeltaPct), 2),
    curveDelta300s: numericStats(measured.map((row) => row.window300s?.curveDelta), 6)
  };
}

function groupBy(rows, keyFn, limit = 20) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return Array.from(groups.entries())
    .map(([key, groupRows]) => summarizeRows(groupRows, key))
    .sort((a, b) => {
      const rateDelta = Number(b.strongOrUsefulRateMeasured || 0) - Number(a.strongOrUsefulRateMeasured || 0);
      if (rateDelta !== 0) return rateDelta;
      return Number(b.measured || 0) - Number(a.measured || 0);
    })
    .slice(0, limit);
}

function profilePredicates() {
  return {
    curve_gate_raw_pre85_score45_70_curve_lt45: (row) => (
      primaryCountKey(row.tightestGates) === 'curveProgressDelta'
      && walletBucket(row.wallet) === 'wallet_raw_untrusted_pre85'
      && Number(row.maxScore) >= 45
      && Number(row.maxScore) < 70
      && Number(row.maxCurveProgress) < 0.45
    ),
    curve_gate_score70_plus_curve60_plus: (row) => (
      primaryCountKey(row.tightestGates) === 'curveProgressDelta'
      && Number(row.maxScore) >= 70
      && Number(row.maxCurveProgress) >= 0.6
    ),
    score_gate_curve75_plus: (row) => (
      primaryCountKey(row.tightestGates) === 'score'
      && Number(row.maxCurveProgress) >= 0.75
    ),
    trusted_wallet_curve60_plus: (row) => (
      row.wallet?.anyTrustedTouch === true
      && Number(row.maxCurveProgress) >= 0.6
    ),
    positive_wallet_any: (row) => row.wallet?.positiveOrProvenTouch === true,
    high_volume_velocity: (row) => (
      Number(row.maxRecentVolumeSol) >= 50
      && Number(row.maxTradeVelocityPerMin) >= 50
    ),
    low_curve_outlier_chase: (row) => (
      Number(row.maxCurveProgress) < 0.3
      && Number(row.maxScore) >= 45
    )
  };
}

function evaluateProfiles(rows) {
  return Object.entries(profilePredicates())
    .map(([name, predicate]) => summarizeRows(rows.filter(predicate), name))
    .sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0));
}

function profileVerdict(profile) {
  if (Number(profile.measured || 0) < MIN_MEASURED_FOR_PROMOTION) return 'INSUFFICIENT_MEASURED_SAMPLE';
  if (Number(profile.rows || 0) > 0 && Number(profile.insufficient || 0) / Number(profile.rows) > 0.4) return 'OUTCOME_COVERAGE_TOO_LOW';
  if (Number(profile.replayed || 0) < MIN_MEASURED_FOR_PROMOTION) return 'INSUFFICIENT_REPLAY_SAMPLE';
  if (Number(profile.totalPnlSol || 0) <= 0 || Number(profile.stressedPnlSol || 0) <= 0) return 'NEGATIVE_OR_STRESS_NEGATIVE';
  if (Number(profile.medianPnlSol || 0) <= 0) return 'MEDIAN_NEGATIVE';
  if (Number(profile.top3RemovedPnlSol || 0) <= 0) return 'OUTLIER_DOMINATED';
  return 'PROMISING_REPORT_ONLY';
}

function loadRows(filePaths) {
  const rows = [];
  const errors = [];
  for (const filePath of filePaths) {
    try {
      const report = buildReport(scan(filePath));
      for (const row of report.rows || []) {
        rows.push({ ...row, telemetryPath: path.relative(ROOT, filePath) });
      }
    } catch (error) {
      errors.push({ telemetryPath: path.relative(ROOT, filePath), error: error.message });
    }
  }
  return { rows, errors };
}

function buildReportFromRows(rows, errors, filePaths) {
  const profiles = evaluateProfiles(rows).map((profile) => ({
    ...profile,
    verdict: profileVerdict(profile)
  })).sort((a, b) => {
    const verdictRank = (value) => (value === 'PROMISING_REPORT_ONLY' ? 0 : 1);
    const rankDelta = verdictRank(a.verdict) - verdictRank(b.verdict);
    if (rankDelta !== 0) return rankDelta;
    return Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0);
  });
  const promisingProfiles = profiles.filter((profile) => profile.verdict === 'PROMISING_REPORT_ONLY');
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_flagged_follow_through_slices',
    inputs: {
      telemetryFiles: filePaths.map((filePath) => path.relative(ROOT, filePath)),
      minMeasuredForPromotion: MIN_MEASURED_FOR_PROMOTION
    },
    summary: {
      ...summarizeRows(rows, 'all_flagged_candidates'),
      verdict: promisingProfiles.length ? 'PROMISING_SLICES_REPORT_ONLY' : 'NO_PROMOTABLE_SLICE',
      promisingProfiles: promisingProfiles.map((profile) => profile.label)
    },
    bySkipReason: groupBy(rows, (row) => primaryCountKey(row.skipReasons)),
    byTightestGate: groupBy(rows, (row) => primaryCountKey(row.tightestGates)),
    byScoreBand: groupBy(rows, (row) => scoreBand(row.maxScore)),
    byCurveBand: groupBy(rows, (row) => curveBand(row.maxCurveProgress)),
    byVolumeBand: groupBy(rows, (row) => volumeBand(row.maxRecentVolumeSol)),
    byVelocityBand: groupBy(rows, (row) => velocityBand(row.maxTradeVelocityPerMin)),
    byWalletBucket: groupBy(rows, (row) => walletBucket(row.wallet)),
    profiles,
    topStrongRows: rows
      .filter((row) => row.classification === 'BLOCKED_STRONG_FOLLOW_THROUGH')
      .sort((a, b) => Number(b.replay?.pnlSol || 0) - Number(a.replay?.pnlSol || 0))
      .slice(0, 20),
    errors,
    note: 'Report-only slice analysis over flagged/evaluated candidates. It looks for repeatable pre-entry patterns among blocked follow-through mints across recent telemetry. It does not alter watch flags, gates, scoring, trust tiers, entries, exits, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseFiles(args) {
  if (args.telemetry) {
    return String(args.telemetry)
      .split(',')
      .map((item) => repoPath(item.trim()))
      .filter((item) => item && fs.existsSync(item));
  }
  return telemetryFiles(Number(args.limit) || DEFAULT_LIMIT);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = parseFiles(args);
  if (!files.length) throw new Error('No telemetry files found for flagged follow-through slice report.');

  const { rows, errors } = loadRows(files);
  const report = buildReportFromRows(rows, errors, files);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = repoPath(args.output) || path.join(OUTPUT_DIR, `pre-migration-flagged-follow-through-slices-${stamp}.json`);
  writeJson(outputPath, report);
  writeJson(LATEST_PATH, report);

  console.log('Pre-Migration Flagged Follow-through Slices');
  console.log(`Rows=${report.summary.rows}, measured=${report.summary.measured}, verdict=${report.summary.verdict}`);
  console.log(`Replay n=${report.summary.replayed}, pnl=${report.summary.totalPnlSol}, median=${report.summary.medianPnlSol}, top3Removed=${report.summary.top3RemovedPnlSol}`);
  console.log(`Best profile=${report.profiles[0]?.label || 'n/a'} verdict=${report.profiles[0]?.verdict || 'n/a'} pnl=${report.profiles[0]?.totalPnlSol ?? 'n/a'}`);
  console.log(`Wrote JSON report: ${outputPath}`);
  console.log(`Wrote latest JSON report: ${LATEST_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = {
  buildReportFromRows,
  loadRows
};
