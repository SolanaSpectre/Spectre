#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'pre-migration-observed-coverage');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-observed-coverage-latest.json');

const WATCH_REFERENCE = {
  interestMinScore: Number(process.env.PRE_MIGRATION_WATCH_MIN_SCORE || 45),
  confirmMinScore: Number(process.env.PRE_MIGRATION_WATCH_CONFIRM_MIN_SCORE || process.env.PRE_MIGRATION_WATCH_MIN_SCORE || 45),
  fastTrackScore: Number(process.env.PRE_MIGRATION_WATCH_FAST_TRACK_SCORE || 75),
  minCurveProgress: Number(process.env.PRE_MIGRATION_WATCH_MIN_CURVE_PROGRESS || 0.45),
  interestMinCurveProgress: Number(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_CURVE_PROGRESS || 0.45),
  interestMinRecentVolumeSol: Number(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_RECENT_VOLUME_SOL || 0.15),
  interestMinTradeVelocityPerMin: Number(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_TRADE_VELOCITY_PER_MIN || 1.5),
  interestMinUniqueBuyerCount: Number(process.env.PRE_MIGRATION_WATCH_INTEREST_MIN_UNIQUE_BUYER_COUNT || 4)
};

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

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function eventType(event = {}) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload = {}) {
  const direct = Number(payload.providerCurvePriceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? payload.priceSol ?? payload.market?.priceSol);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const sol = Number(payload.virtualSolReservesSol);
  const tokens = Number(payload.virtualTokenReservesTokens);
  return Number.isFinite(sol) && sol > 0 && Number.isFinite(tokens) && tokens > 0 ? sol / tokens : null;
}

function getRow(rowsByMint, mint, payload = {}, atMs = null) {
  let row = rowsByMint.get(mint);
  if (!row) {
    row = {
      mint,
      symbol: payload.symbol || null,
      firstSeenAtMs: atMs,
      lastSeenAtMs: atMs,
      lastObservedAtMs: null,
      lastObservedPriceSol: null,
      observedRows: 0,
      flaggedRows: 0,
      guardRows: 0,
      shadowGuardRows: 0,
      decisionRows: 0,
      entryRows: 0,
      maxScore: null,
      maxCurveProgress: null,
      maxRecentVolumeSol: null,
      maxTradeVelocityPerMin: null,
      maxUniqueBuyerCount: null,
      maxRecentBuys: null,
      maxRecentSells: null,
      maxConvictionWhaleCount: null,
      maxAlphaScalperCount: null,
      maxEarlySniperCount: null,
      maxRiskWalletCount: null,
      everObservedInterest: false,
      everObservedSignal: false,
      everConfirmed: false,
      firstInterestAtMs: null,
      firstSignalAtMs: null,
      firstConfirmedAtMs: null,
      firstFlaggedAtMs: null,
      reasons: {},
      flagReasons: {}
    };
    rowsByMint.set(mint, row);
  }
  if (!row.symbol && payload.symbol) row.symbol = payload.symbol;
  if (Number.isFinite(atMs)) {
    row.firstSeenAtMs = row.firstSeenAtMs === null ? atMs : Math.min(row.firstSeenAtMs, atMs);
    row.lastSeenAtMs = row.lastSeenAtMs === null ? atMs : Math.max(row.lastSeenAtMs, atMs);
  }
  return row;
}

function bump(counts, key, amount = 1) {
  const label = key || 'unknown';
  counts[label] = (counts[label] || 0) + amount;
}

function updateMax(row, key, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  row[key] = row[key] === null ? number : Math.max(row[key], number);
}

function addSnapshot(snapshotsByMint, mint, event, payload, atMs) {
  const curveProgress = curveOf(payload);
  const priceSol = priceOf(payload);
  if (!Number.isFinite(atMs) || !Number.isFinite(curveProgress) || !Number.isFinite(priceSol)) return;
  if (!snapshotsByMint.has(mint)) snapshotsByMint.set(mint, []);
  snapshotsByMint.get(mint).push({
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: eventType(event),
    curveProgress: compact(curveProgress, 6),
    priceSol: compact(priceSol, 15)
  });
}

function updateObserved(row, payload, atMs) {
  row.observedRows += 1;
  if (Number.isFinite(atMs)) row.lastObservedAtMs = row.lastObservedAtMs === null ? atMs : Math.max(row.lastObservedAtMs, atMs);
  const observedPrice = priceOf(payload);
  if (Number.isFinite(observedPrice) && observedPrice > 0) row.lastObservedPriceSol = observedPrice;
  updateMax(row, 'maxScore', payload.score);
  updateMax(row, 'maxCurveProgress', curveOf(payload));
  updateMax(row, 'maxRecentVolumeSol', payload.recentVolumeSol);
  updateMax(row, 'maxTradeVelocityPerMin', payload.tradeVelocityPerMin);
  updateMax(row, 'maxUniqueBuyerCount', payload.uniqueBuyerCount);
  updateMax(row, 'maxRecentBuys', payload.recentBuys);
  updateMax(row, 'maxRecentSells', payload.recentSells);
  updateMax(row, 'maxConvictionWhaleCount', payload.convictionWhaleCount);
  updateMax(row, 'maxAlphaScalperCount', payload.alphaScalperCount);
  updateMax(row, 'maxEarlySniperCount', payload.earlySniperCount);
  updateMax(row, 'maxRiskWalletCount', payload.riskWalletCount);
  for (const reason of payload.reasons || []) bump(row.reasons, reason);

  if (payload.observedInterest === true) {
    row.everObservedInterest = true;
    row.firstInterestAtMs = row.firstInterestAtMs === null ? atMs : Math.min(row.firstInterestAtMs, atMs);
  }
  if (payload.observedSignal === true) {
    row.everObservedSignal = true;
    row.firstSignalAtMs = row.firstSignalAtMs === null ? atMs : Math.min(row.firstSignalAtMs, atMs);
  }
  if (payload.confirmed === true || payload.newlyConfirmed === true) {
    row.everConfirmed = true;
    row.firstConfirmedAtMs = row.firstConfirmedAtMs === null ? atMs : Math.min(row.firstConfirmedAtMs, atMs);
  }
}

function classifyUnflagged(row) {
  const score = Number(row.maxScore || 0);
  const curve = Number(row.maxCurveProgress || 0);
  const volume = Number(row.maxRecentVolumeSol || 0);
  const velocity = Number(row.maxTradeVelocityPerMin || 0);
  const buyers = Number(row.maxUniqueBuyerCount || 0);
  const walletTouches = Number(row.maxConvictionWhaleCount || 0)
    + Number(row.maxAlphaScalperCount || 0)
    + Number(row.maxEarlySniperCount || 0)
    + Number(row.maxRiskWalletCount || 0);

  if (!row.everObservedInterest && !row.everObservedSignal) {
    if (score < WATCH_REFERENCE.interestMinScore) return 'LOW_SCORE_NO_INTEREST';
    if (curve < WATCH_REFERENCE.interestMinCurveProgress
      && volume < WATCH_REFERENCE.interestMinRecentVolumeSol
      && velocity < WATCH_REFERENCE.interestMinTradeVelocityPerMin
      && buyers < WATCH_REFERENCE.interestMinUniqueBuyerCount
      && walletTouches <= 0) {
      return 'NO_SECONDARY_INTEREST_INPUT';
    }
    return 'INTEREST_GATE_NOT_EMITTED';
  }
  if (row.everObservedInterest && !row.everObservedSignal) return 'INTEREST_ONLY_NO_CONFIRM_SIGNAL';
  if (row.everObservedSignal && !row.everConfirmed) return 'SIGNAL_NOT_CONFIRMED';
  if (row.everConfirmed) return 'CONFIRMED_BUT_NOT_FLAGGED';
  return 'UNCLASSIFIED_UNFLAGGED';
}

function scoreBand(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 'unknown';
  if (score >= 75) return 'score_75_plus';
  if (score >= 60) return 'score_60_75';
  if (score >= 45) return 'score_45_60';
  if (score >= 30) return 'score_30_45';
  return 'score_lt30';
}

function curveBand(value) {
  const curve = Number(value);
  if (!Number.isFinite(curve)) return 'unknown';
  if (curve >= 0.85) return 'curve_85_plus';
  if (curve >= 0.7) return 'curve_70_85';
  if (curve >= 0.55) return 'curve_55_70';
  if (curve >= 0.45) return 'curve_45_55';
  if (curve >= 0.25) return 'curve_25_45';
  return 'curve_lt25';
}

function firstCross(snapshots, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function followThrough(row, snapshotsByMint, seconds) {
  const startAtMs = row.lastObservedAtMs;
  if (!Number.isFinite(startAtMs)) {
    return {
      seconds,
      futureSnapshotCount: 0,
      maxCurveProgress: null,
      curveDelta: null,
      maxPriceDeltaPct: null,
      crossed85AfterLastObserved: false,
      crossed90AfterLastObserved: false
    };
  }
  const snapshots = (snapshotsByMint.get(row.mint) || [])
    .filter((snapshot) => snapshot.atMs > startAtMs && snapshot.atMs <= startAtMs + seconds * 1000);
  const curves = snapshots.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite);
  const prices = snapshots.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0);
  const maxCurve = curves.length ? Math.max(...curves) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const startPrice = Number(row.lastObservedPriceSol);
  const priceDeltaPct = Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null
    ? ((maxPrice - startPrice) / startPrice) * 100
    : null;
  return {
    seconds,
    futureSnapshotCount: snapshots.length,
    maxCurveProgress: compact(maxCurve, 6),
    curveDelta: maxCurve !== null && Number.isFinite(Number(row.maxCurveProgress))
      ? compact(maxCurve - Number(row.maxCurveProgress), 6)
      : null,
    maxPriceDeltaPct: compact(priceDeltaPct, 2),
    crossed85AfterLastObserved: Boolean(firstCross(snapshots, 0.85, row.maxCurveProgress)),
    crossed90AfterLastObserved: Boolean(firstCross(snapshots, 0.9, row.maxCurveProgress))
  };
}

function scan(filePath) {
  const rowsByMint = new Map();
  const snapshotsByMint = new Map();
  const eventCounts = {};
  let startMs = Infinity;
  let endMs = -Infinity;

  const stats = forEachJsonlSync(filePath, (event) => {
    const type = eventType(event);
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    bump(eventCounts, type);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }
    if (!mint) return;

    const row = getRow(rowsByMint, mint, payload, atMs);
    addSnapshot(snapshotsByMint, mint, event, payload, atMs);
    const priceSol = priceOf(payload);
    if (Number.isFinite(priceSol) && priceSol > 0) row.lastPriceSol = priceSol;

    if (type === 'pre_migration.observed' || type === 'pre_migration.flagged') {
      updateObserved(row, payload, atMs);
      if (type === 'pre_migration.flagged') {
        row.flaggedRows += 1;
        row.firstFlaggedAtMs = row.firstFlaggedAtMs === null ? atMs : Math.min(row.firstFlaggedAtMs, atMs);
        for (const reason of payload.reasons || []) bump(row.flagReasons, reason);
      }
    } else if (type === 'pre_migration_paper.guard_attribution') {
      row.guardRows += 1;
      if (payload.shadowOnly === true) row.shadowGuardRows += 1;
    } else if (type === 'pre_migration_paper.decision') {
      row.decisionRows += 1;
    } else if (type === 'pre_migration_paper.entry') {
      row.entryRows += 1;
    }
  });

  for (const snapshots of snapshotsByMint.values()) snapshots.sort((a, b) => a.atMs - b.atMs);
  const rows = Array.from(rowsByMint.values())
    .filter((row) => row.observedRows > 0)
    .map((row) => ({
      ...row,
      firstSeenAt: row.firstSeenAtMs === null ? null : new Date(row.firstSeenAtMs).toISOString(),
      lastSeenAt: row.lastSeenAtMs === null ? null : new Date(row.lastSeenAtMs).toISOString(),
      classification: row.flaggedRows > 0 ? 'FLAGGED' : classifyUnflagged(row),
      scoreBand: scoreBand(row.maxScore),
      curveBand: curveBand(row.maxCurveProgress),
      maxScore: compact(row.maxScore, 2),
      maxCurveProgress: compact(row.maxCurveProgress, 6),
      maxRecentVolumeSol: compact(row.maxRecentVolumeSol, 4),
      maxTradeVelocityPerMin: compact(row.maxTradeVelocityPerMin, 2),
      maxUniqueBuyerCount: compact(row.maxUniqueBuyerCount, 0),
      maxConvictionWhaleCount: compact(row.maxConvictionWhaleCount, 0),
      maxAlphaScalperCount: compact(row.maxAlphaScalperCount, 0),
      maxEarlySniperCount: compact(row.maxEarlySniperCount, 0),
      maxRiskWalletCount: compact(row.maxRiskWalletCount, 0),
      followThrough120s: followThrough(row, snapshotsByMint, 120),
      followThrough300s: followThrough(row, snapshotsByMint, 300)
    }));

  return {
    filePath,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    stats,
    eventCounts,
    rows
  };
}

function numericStats(values, digits = 4) {
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

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) bump(counts, keyFn(row));
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function topRows(rows, sorter, limit = 12) {
  return rows.slice().sort(sorter).slice(0, limit).map((row) => ({
    mint: row.mint,
    symbol: row.symbol,
    classification: row.classification,
    scoreBand: row.scoreBand,
    curveBand: row.curveBand,
    maxScore: row.maxScore,
    maxCurveProgress: row.maxCurveProgress,
    maxRecentVolumeSol: row.maxRecentVolumeSol,
    maxTradeVelocityPerMin: row.maxTradeVelocityPerMin,
    maxUniqueBuyerCount: row.maxUniqueBuyerCount,
    observedRows: row.observedRows,
    everObservedInterest: row.everObservedInterest,
    everObservedSignal: row.everObservedSignal,
    everConfirmed: row.everConfirmed,
    guardRows: row.guardRows,
    shadowGuardRows: row.shadowGuardRows,
    followThrough120s: row.followThrough120s,
    followThrough300s: row.followThrough300s,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt
  }));
}

function summarize(scanned) {
  const rows = scanned.rows;
  const flagged = rows.filter((row) => row.flaggedRows > 0);
  const unflagged = rows.filter((row) => row.flaggedRows <= 0);
  const strongUnflagged = unflagged.filter((row) => (
    Number(row.maxScore) >= 60
    || Number(row.maxCurveProgress) >= 0.55
    || Number(row.maxRecentVolumeSol) >= 10
    || Number(row.maxTradeVelocityPerMin) >= 10
  ));
  const unflaggedCross90 = unflagged.filter((row) => row.followThrough300s?.crossed90AfterLastObserved);
  return {
    telemetryPath: path.relative(ROOT, scanned.filePath),
    startAt: scanned.startAt,
    endAt: scanned.endAt,
    telemetryRowsRead: scanned.stats.rows,
    malformedLines: scanned.stats.malformedLines,
    observedMints: rows.length,
    flaggedMints: flagged.length,
    unflaggedMints: unflagged.length,
    flaggedPerObserved: rows.length ? compact(flagged.length / rows.length, 4) : null,
    unflaggedStrongMints: strongUnflagged.length,
    unflaggedCrossed90Within300s: unflaggedCross90.length,
    classificationCounts: countBy(rows, (row) => row.classification),
    unflaggedClassificationCounts: countBy(unflagged, (row) => row.classification),
    scoreBands: countBy(rows, (row) => row.scoreBand),
    unflaggedScoreBands: countBy(unflagged, (row) => row.scoreBand),
    unflaggedCurveBands: countBy(unflagged, (row) => row.curveBand),
    maxScore: numericStats(rows.map((row) => row.maxScore), 2),
    unflaggedMaxScore: numericStats(unflagged.map((row) => row.maxScore), 2),
    unflaggedMaxCurveProgress: numericStats(unflagged.map((row) => row.maxCurveProgress), 6),
    unflaggedMaxRecentVolumeSol: numericStats(unflagged.map((row) => row.maxRecentVolumeSol), 4),
    unflaggedMaxTradeVelocityPerMin: numericStats(unflagged.map((row) => row.maxTradeVelocityPerMin), 2),
    watchReference: WATCH_REFERENCE
  };
}

function buildReport(scanned) {
  const rows = scanned.rows;
  const unflagged = rows.filter((row) => row.flaggedRows <= 0);
  const strongUnflagged = unflagged.filter((row) => (
    Number(row.maxScore) >= 60
    || Number(row.maxCurveProgress) >= 0.55
    || Number(row.maxRecentVolumeSol) >= 10
    || Number(row.maxTradeVelocityPerMin) >= 10
  ));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_migration_observed_coverage',
    summary: summarize(scanned),
    topUnflaggedByScore: topRows(unflagged, (a, b) => Number(b.maxScore || 0) - Number(a.maxScore || 0), 20),
    topUnflaggedByCurve: topRows(unflagged, (a, b) => Number(b.maxCurveProgress || 0) - Number(a.maxCurveProgress || 0), 20),
    topUnflaggedByVolume: topRows(unflagged, (a, b) => Number(b.maxRecentVolumeSol || 0) - Number(a.maxRecentVolumeSol || 0), 20),
    topUnflaggedFollowThrough: topRows(
      unflagged,
      (a, b) => Number(b.followThrough300s?.curveDelta || 0) - Number(a.followThrough300s?.curveDelta || 0),
      20
    ),
    strongUnflagged,
    eventCounts: scanned.eventCounts,
    note: 'Report-only watch-lane coverage audit. It explains observed mints that never became pre_migration.flagged and checks whether the strongest unflagged observations later moved. It does not alter watch flags, paper gates, entries, exits, scoring, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found for observed coverage report.');

  const scanned = scan(telemetryPath);
  const report = buildReport(scanned);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = repoPath(args.output) || path.join(OUTPUT_DIR, `pre-migration-observed-coverage-${stamp}.json`);
  writeJson(outputPath, report);
  writeJson(LATEST_PATH, report);

  console.log('Pre-Migration Observed Coverage');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Observed/flagged/unflagged: ${report.summary.observedMints}/${report.summary.flaggedMints}/${report.summary.unflaggedMints}`);
  console.log(`Unflagged strong/cross90_300s: ${report.summary.unflaggedStrongMints}/${report.summary.unflaggedCrossed90Within300s}`);
  console.log(`Top unflagged classes: ${JSON.stringify(report.summary.unflaggedClassificationCounts)}`);
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
  buildReport,
  scan
};
