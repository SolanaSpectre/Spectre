#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-relaxed-shadow-outcome-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];

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

function telemetryFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return report.files?.telemetryPath || report.telemetryPath || null;
  } catch {
    return null;
  }
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.accountCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  if (curve > 1 && curve <= 100) return curve / 100;
  return curve;
}

function priceOf(payload) {
  const raw = payload.quote?.spotPriceSol
    ?? payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: numberOrNull(pick(0.5), digits),
    p90: numberOrNull(pick(0.9), digits),
    max: numberOrNull(finite[finite.length - 1], digits),
    avg: numberOrNull(sum / finite.length, digits)
  };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function snapshotFromEvent(event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOf(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: event.type || event.event || 'unknown',
    source: payload.source || payload.provider || event.type || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12)
  };
}

function shadowAttemptFromEvent(event) {
  const eventType = event.type || event.event;
  if (!['pre_migration_wallet_relaxed_shadow.would_enter', 'pre_migration_wallet_relaxed_shadow.would_skip'].includes(eventType)) return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    eventType,
    wouldEnter: eventType === 'pre_migration_wallet_relaxed_shadow.would_enter',
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    shadowProfile: payload.shadowProfile || null,
    shadowReason: payload.shadowReason || null,
    sourceDecision: payload.sourceDecision || null,
    sourceReason: payload.sourceReason || null,
    sourcePreset: payload.sourcePreset || null,
    sourceLane: payload.sourceLane || null,
    score: numberOrNull(payload.score, 2),
    curveProgress: numberOrNull(payload.curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    walletTouchCount: numberOrNull(payload.walletTouchCount, 0),
    walletContextSource: payload.walletContextSource || null,
    earliestWalletTouchAt: payload.earliestWalletTouchAt || null,
    earliestWalletBuyAt: payload.earliestWalletBuyAt || null,
    positiveOrProvenTouchCount: numberOrNull(payload.positiveOrProvenTouchCount, 0),
    avoidTouchCount: numberOrNull(payload.avoidTouchCount, 0),
    qualifyingFirstTouch: payload.qualifyingFirstTouch || null,
    positiveFirstTouch: payload.positiveFirstTouch || null
  };
}

function futureForWindow(attempt, snapshots, seconds) {
  const endMs = attempt.atMs + seconds * 1000;
  const rows = snapshots.filter((snapshot) => snapshot.atMs > attempt.atMs && snapshot.atMs <= endMs);
  if (!rows.length) {
    return {
      snapshotCount: 0,
      maxCurveProgress: null,
      maxCurveAt: null,
      curveDelta: null,
      crossed85: false,
      crossed90: false,
      crossed95: false,
      crossed100: false,
      maxPriceDeltaPct: null
    };
  }
  const baseCurve = Number(attempt.curveProgress);
  const basePrice = Number(attempt.priceSol);
  let maxCurveRow = null;
  let maxPriceDeltaPct = null;
  for (const row of rows) {
    if (!maxCurveRow || Number(row.curveProgress) > Number(maxCurveRow.curveProgress)) maxCurveRow = row;
    if (Number.isFinite(basePrice) && basePrice > 0 && Number.isFinite(Number(row.priceSol))) {
      const deltaPct = ((Number(row.priceSol) - basePrice) / basePrice) * 100;
      if (maxPriceDeltaPct === null || deltaPct > maxPriceDeltaPct) maxPriceDeltaPct = deltaPct;
    }
  }
  const maxCurve = Number(maxCurveRow?.curveProgress);
  return {
    snapshotCount: rows.length,
    maxCurveProgress: numberOrNull(maxCurve, 6),
    maxCurveAt: maxCurveRow?.at || null,
    curveDelta: Number.isFinite(baseCurve) ? numberOrNull(maxCurve - baseCurve, 6) : null,
    crossed85: maxCurve >= 0.85,
    crossed90: maxCurve >= 0.9,
    crossed95: maxCurve >= 0.95,
    crossed100: maxCurve >= 1,
    maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 4)
  };
}

function addOutcomes(attempt, snapshotsByMint) {
  const snapshots = snapshotsByMint.get(attempt.mint) || [];
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = futureForWindow(attempt, snapshots, seconds);
  }
  return { ...attempt, windows };
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const attempts = [];
  const eventCounts = {};
  let malformedLines = 0;
  let startMs = Infinity;
  let endMs = -Infinity;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    const eventType = event.type || event.event || 'unknown';
    eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
    const atMs = timestampMs(payloadOf(event).timestamp || event.timestamp);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }

    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      const rows = snapshotsByMint.get(snapshot.mint) || [];
      rows.push(snapshot);
      snapshotsByMint.set(snapshot.mint, rows);
    }

    const attempt = shadowAttemptFromEvent(event);
    if (attempt) attempts.push(attempt);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  attempts.sort((a, b) => a.atMs - b.atMs);

  return {
    snapshotsByMint,
    attempts,
    eventCounts,
    malformedLines,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null
  };
}

function summarize(outcomes) {
  const wouldEnterRows = outcomes.filter((row) => row.wouldEnter);
  const wouldSkipRows = outcomes.filter((row) => !row.wouldEnter);
  const withAnyWalletTouch = outcomes.filter((row) => Number(row.walletTouchCount || 0) > 0);
  const withQualifyingFirstTouch = outcomes.filter((row) => row.qualifyingFirstTouch);
  const withPositiveOrProvenTouch = outcomes.filter((row) => Number(row.positiveOrProvenTouchCount || 0) > 0);
  const withAvoidTouch = outcomes.filter((row) => Number(row.avoidTouchCount || 0) > 0);
  const uniqueFirstByMint = new Map();
  for (const row of wouldEnterRows) {
    if (!uniqueFirstByMint.has(row.mint)) uniqueFirstByMint.set(row.mint, row);
  }
  const uniqueRows = Array.from(uniqueFirstByMint.values());
  const windowSummary = {};
  for (const seconds of WINDOWS_SECONDS) {
    const key = `${seconds}s`;
    windowSummary[key] = {
      attemptsWithFuture: wouldEnterRows.filter((row) => (row.windows[key]?.snapshotCount || 0) > 0).length,
      crossed85: wouldEnterRows.filter((row) => row.windows[key]?.crossed85).length,
      crossed90: wouldEnterRows.filter((row) => row.windows[key]?.crossed90).length,
      crossed95: wouldEnterRows.filter((row) => row.windows[key]?.crossed95).length,
      uniqueCrossed85: uniqueRows.filter((row) => row.windows[key]?.crossed85).length,
      uniqueCrossed90: uniqueRows.filter((row) => row.windows[key]?.crossed90).length,
      curveDelta: stat(wouldEnterRows.map((row) => row.windows[key]?.curveDelta), 6),
      maxPriceDeltaPct: stat(wouldEnterRows.map((row) => row.windows[key]?.maxPriceDeltaPct), 4)
    };
  }

  return {
    attempts: outcomes.length,
    wouldEnter: wouldEnterRows.length,
    wouldSkip: wouldSkipRows.length,
    uniqueWouldEnterMints: uniqueRows.length,
    contextCoverage: {
      withAnyWalletTouch: withAnyWalletTouch.length,
      withNoWalletTouch: outcomes.length - withAnyWalletTouch.length,
      withQualifyingFirstTouch: withQualifyingFirstTouch.length,
      withPositiveOrProvenTouch: withPositiveOrProvenTouch.length,
      withAvoidTouch: withAvoidTouch.length,
      walletContextSources: countBy(outcomes, (row) => row.walletContextSource || (Number(row.walletTouchCount || 0) > 0 ? 'unknown_context' : 'none'))
    },
    sourceReasonCounts: countBy(outcomes, (row) => row.sourceReason),
    wouldEnterSourceReasonCounts: countBy(wouldEnterRows, (row) => row.sourceReason),
    wouldSkipSourceReasonCounts: countBy(wouldSkipRows, (row) => row.sourceReason),
    shadowReasonCounts: countBy(outcomes, (row) => row.shadowReason),
    qualifyingFirstTouchReviewTierCounts: countBy(wouldEnterRows, (row) => row.qualifyingFirstTouch?.reviewTier),
    qualifyingFirstTouchEvidenceTierCounts: countBy(wouldEnterRows, (row) => row.qualifyingFirstTouch?.evidenceTier),
    positiveFirstTouchReviewTierCounts: countBy(wouldEnterRows, (row) => row.positiveFirstTouch?.reviewTier),
    positiveFirstTouchEvidenceTierCounts: countBy(wouldEnterRows, (row) => row.positiveFirstTouch?.evidenceTier),
    windowSummary
  };
}

function topRows(outcomes, limit = 12) {
  return outcomes
    .filter((row) => row.wouldEnter)
    .slice()
    .sort((a, b) => {
      const bCross = b.windows['120s']?.crossed90 ? 1 : 0;
      const aCross = a.windows['120s']?.crossed90 ? 1 : 0;
      if (bCross !== aCross) return bCross - aCross;
      return Number(b.windows['120s']?.curveDelta || 0) - Number(a.windows['120s']?.curveDelta || 0);
    })
    .slice(0, limit)
    .map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      at: row.at,
      sourceReason: row.sourceReason,
      score: row.score,
      curveProgress: row.curveProgress,
      qualifyingFirstTouch: row.qualifyingFirstTouch,
      positiveFirstTouch: row.positiveFirstTouch,
      max30: row.windows['30s']?.maxCurveProgress,
      max120: row.windows['120s']?.maxCurveProgress,
      max300: row.windows['300s']?.maxCurveProgress,
      curveDelta120s: row.windows['120s']?.curveDelta,
      priceDelta120sPct: row.windows['120s']?.maxPriceDeltaPct,
      crossed90Within120s: row.windows['120s']?.crossed90
    }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  }
  const outputPath = args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH;
  const telemetry = await readTelemetry(telemetryPath);
  const outcomes = telemetry.attempts.map((attempt) => addOutcomes(attempt, telemetry.snapshotsByMint));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_relaxed_shadow_outcome',
    note: 'Report-only follow-through for pre_migration_wallet_relaxed_shadow would-enter/would-skip telemetry. Does not alter runtime gates.',
    sources: {
      telemetryPath: path.relative(ROOT, telemetryPath).replace(/\\/g, '/')
    },
    inputs: {
      startAt: telemetry.startAt,
      endAt: telemetry.endAt,
      malformedLines: telemetry.malformedLines,
      shadowEvents: telemetry.attempts.length,
      snapshotMints: telemetry.snapshotsByMint.size
    },
    summary: summarize(outcomes),
    topWouldEnterFollowThrough: topRows(outcomes),
    rows: outcomes
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(ROOT, outputPath)}`);
  console.log(`Wallet-relaxed shadow would_enter follow-through: ${report.summary.wouldEnter} attempts, ${report.summary.uniqueWouldEnterMints} unique mints`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
