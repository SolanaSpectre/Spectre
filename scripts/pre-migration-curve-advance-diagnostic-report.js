#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-curve-advance-diagnostic-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];
const TARGET_REASON = 'CURVE_NOT_ADVANCING';

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

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.progress
    ?? payload.market?.maxCurveProgress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function priceOf(payload) {
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function pctDelta(start, end, digits = 2) {
  if (start === null || start === undefined || end === null || end === undefined) return null;
  const startNumber = Number(start);
  const endNumber = Number(end);
  if (!Number.isFinite(startNumber) || !Number.isFinite(endNumber) || startNumber <= 0) return null;
  return num(((endNumber - startNumber) / startNumber) * 100, digits);
}

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: num(finite[0], digits),
    median: num(pick(0.5), digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    avg: num(sum / finite.length, digits)
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
    at: new Date(atMs).toISOString(),
    atMs,
    eventType: eventType(event),
    source: payload.providerCurveSource || payload.source || payload.provider || eventType(event),
    curveProgress: num(curveProgress, 6),
    priceSol: num(priceOf(payload), 12)
  };
}

function decisionFromEvent(event) {
  if (eventType(event) !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  if (payload.decision !== 'PAPER_SKIPPED' || payload.reason !== TARGET_REASON) return null;
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const curveProgress = curveOf(payload);
  const baselineAtMs = timestampMs(payload.baselineAt);
  const curveProgressDelta = num(payload.curveProgressDelta, 6);
  const threshold = num(payload.threshold, 6);
  const deltaGap = Number.isFinite(Number(threshold)) && Number.isFinite(Number(curveProgressDelta))
    ? Number(threshold) - Number(curveProgressDelta)
    : null;
  const baselineCurveProgress = num(payload.baselineCurveProgress, 6);
  const baselineToNow = Number.isFinite(Number(curveProgress)) && Number.isFinite(Number(baselineCurveProgress))
    ? Number(curveProgress) - Number(baselineCurveProgress)
    : null;

  return {
    mint,
    symbol: payload.symbol || null,
    at: new Date(atMs).toISOString(),
    atMs,
    baselineAt: payload.baselineAt || null,
    baselineAgeMs: Number.isFinite(baselineAtMs) ? atMs - baselineAtMs : null,
    baselineCurveProgress,
    curveProgress: num(curveProgress, 6),
    curveProgressDelta,
    curveProgressDelta60s: num(payload.curveProgressDelta60s, 6),
    threshold,
    deltaGap: num(deltaGap, 6),
    baselineToNowDelta: num(baselineToNow, 6),
    priceSol: num(priceOf(payload), 12),
    readinessPct: Number.isFinite(Number(curveProgressDelta)) && Number.isFinite(Number(threshold)) && Number(threshold) > 0
      ? num(Math.max(0, Math.min(1, Number(curveProgressDelta) / Number(threshold))) * 100, 2)
      : null,
    score: num(payload.score, 2),
    preset: payload.preset || null,
    profileName: payload.profileName || null,
    recentVolumeSol: num(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: num(payload.tradeVelocityPerMin, 2),
    buyRatio: num(payload.buyRatio, 4),
    uniqueBuyerCount: num(payload.uniqueBuyerCount, 0),
    sniperWalletCount: num(payload.sniperWalletCount, 0),
    guardOverride: payload.guardOverride || null,
    failedChecks: Array.isArray(payload.failedChecks) ? payload.failedChecks : []
  };
}

async function readTelemetry(filePath) {
  const decisions = [];
  const snapshotsByMint = new Map();
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
    const type = eventType(event);
    eventCounts[type] = (eventCounts[type] || 0) + 1;
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
    const decision = decisionFromEvent(event);
    if (decision) decisions.push(decision);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  return {
    decisions,
    snapshotsByMint,
    eventCounts,
    malformedLines,
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null
  };
}

function firstCross(rows, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return rows.find((row) => Number(row.curveProgress) >= threshold) || null;
}

function windowAnalysis(decision, snapshots, seconds) {
  const future = snapshots.filter((row) => row.atMs > decision.atMs && row.atMs <= decision.atMs + seconds * 1000);
  const maxCurve = stat(future.map((row) => row.curveProgress), 6).max;
  const maxPrice = stat(future.map((row) => row.priceSol), 12).max;
  const minPrice = stat(future.map((row) => row.priceSol), 12).min;
  const curveDelta = maxCurve !== null && decision.curveProgress !== null
    ? Number(maxCurve) - Number(decision.curveProgress)
    : null;
  const cross85 = firstCross(future, 0.85, decision.curveProgress);
  const cross90 = firstCross(future, 0.9, decision.curveProgress);
  const cross95 = firstCross(future, 0.95, decision.curveProgress);
  const cross100 = firstCross(future, 1, decision.curveProgress);
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: maxCurve,
    curveDelta: num(curveDelta, 6),
    maxPriceSol: maxPrice,
    maxPriceDeltaPct: pctDelta(decision.priceSol, maxPrice, 2),
    minPriceDeltaPct: pctDelta(decision.priceSol, minPrice, 2),
    crossed85AfterSkip: Boolean(cross85),
    crossed90AfterSkip: Boolean(cross90),
    crossed95AfterSkip: Boolean(cross95),
    crossed100AfterSkip: Boolean(cross100),
    first85CrossAt: cross85?.at || null,
    first90CrossAt: cross90?.at || null,
    first95CrossAt: cross95?.at || null,
    first100CrossAt: cross100?.at || null
  };
}

function classify(decision) {
  const w120 = decision.windows['120s'] || {};
  const w300 = decision.windows['300s'] || {};
  if (!Object.values(decision.windows).some((row) => Number(row.futureSnapshotCount) > 0)) return 'NO_FUTURE_SNAPSHOTS';
  if (w120.crossed90AfterSkip || Number(w120.curveDelta) >= 0.1) return 'BLOCKED_STRONG_FOLLOW_THROUGH_120S';
  if (w120.crossed85AfterSkip || Number(w120.curveDelta) >= 0.05) return 'BLOCKED_USEFUL_FOLLOW_THROUGH_120S';
  if (w300.crossed90AfterSkip || Number(w300.curveDelta) >= 0.1) return 'DELAYED_STRONG_FOLLOW_THROUGH_300S';
  if (w300.crossed85AfterSkip || Number(w300.curveDelta) >= 0.05) return 'DELAYED_USEFUL_FOLLOW_THROUGH_300S';
  if (Number(w120.curveDelta) <= 0.005) return 'CORRECTLY_BLOCKED_FLAT_120S';
  return 'MODEST_FOLLOW_THROUGH';
}

function analyzeDecision(decision, snapshots) {
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = windowAnalysis(decision, snapshots, seconds);
  }
  return {
    ...decision,
    windows,
    classification: classify({ ...decision, windows })
  };
}

function compactDecision(row) {
  return {
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    classification: row.classification,
    score: row.score,
    curveProgress: row.curveProgress,
    baselineCurveProgress: row.baselineCurveProgress,
    curveProgressDelta: row.curveProgressDelta,
    curveProgressDelta60s: row.curveProgressDelta60s,
    threshold: row.threshold,
    deltaGap: row.deltaGap,
    readinessPct: row.readinessPct,
    baselineAgeMs: row.baselineAgeMs,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    window120s: row.windows['120s'],
    window300s: row.windows['300s']
  };
}

function uniqueBest(rows, scoreFn, limit) {
  const picked = new Map();
  for (const row of rows) {
    const current = picked.get(row.mint);
    if (!current || scoreFn(row) > scoreFn(current)) picked.set(row.mint, row);
  }
  return Array.from(picked.values())
    .sort((a, b) => scoreFn(b) - scoreFn(a))
    .slice(0, limit)
    .map(compactDecision);
}

function buildReport(filePath, telemetry) {
  const analyzed = telemetry.decisions.map((decision) => (
    analyzeDecision(decision, telemetry.snapshotsByMint.get(decision.mint) || [])
  ));
  const uniqueMints = new Set(analyzed.map((row) => row.mint));
  const w120 = analyzed.map((row) => row.windows['120s'] || {});
  const w300 = analyzed.map((row) => row.windows['300s'] || {});
  const likelyFalseNegatives = analyzed.filter((row) => (
    row.classification === 'BLOCKED_STRONG_FOLLOW_THROUGH_120S'
    || row.classification === 'BLOCKED_USEFUL_FOLLOW_THROUGH_120S'
  ));
  const correctlyBlocked = analyzed.filter((row) => row.classification === 'CORRECTLY_BLOCKED_FLAT_120S');
  const nearThreshold = analyzed.filter((row) => Number(row.readinessPct) >= 80);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    telemetryPath: path.relative(ROOT, filePath),
    telemetryWindow: {
      startAt: telemetry.startMs ? new Date(telemetry.startMs).toISOString() : null,
      endAt: telemetry.endMs ? new Date(telemetry.endMs).toISOString() : null
    },
    summary: {
      reason: TARGET_REASON,
      decisions: analyzed.length,
      uniqueMints: uniqueMints.size,
      nearThresholdDecisions80Pct: nearThreshold.length,
      likelyFalseNegativeDecisions120s: likelyFalseNegatives.length,
      correctlyBlockedFlat120s: correctlyBlocked.length,
      crossed85Within120s: w120.filter((row) => row.crossed85AfterSkip).length,
      crossed90Within120s: w120.filter((row) => row.crossed90AfterSkip).length,
      crossed85Within300s: w300.filter((row) => row.crossed85AfterSkip).length,
      crossed90Within300s: w300.filter((row) => row.crossed90AfterSkip).length,
      classificationCounts: countBy(analyzed, (row) => row.classification),
      readinessPct: stat(analyzed.map((row) => row.readinessPct), 2),
      curveProgressDelta: stat(analyzed.map((row) => row.curveProgressDelta), 6),
      curveProgressDelta60s: stat(analyzed.map((row) => row.curveProgressDelta60s), 6),
      deltaGap: stat(analyzed.map((row) => row.deltaGap), 6),
      baselineAgeMs: stat(analyzed.map((row) => row.baselineAgeMs), 0),
      curveDelta120s: stat(w120.map((row) => row.curveDelta), 6),
      curveDelta300s: stat(w300.map((row) => row.curveDelta), 6),
      maxPriceDeltaPct120s: stat(w120.map((row) => row.maxPriceDeltaPct), 2)
    },
    topLikelyFalseNegatives: uniqueBest(likelyFalseNegatives, (row) => Number(row.windows['120s']?.curveDelta ?? -Infinity), 12),
    closestThresholdMisses: uniqueBest(nearThreshold, (row) => Number(row.readinessPct ?? -Infinity), 12),
    topDelayedWakeups: uniqueBest(analyzed, (row) => Number(row.windows['300s']?.curveDelta ?? -Infinity), 12),
    topCorrectlyBlockedFlat: uniqueBest(correctlyBlocked, (row) => Number(row.score ?? -Infinity), 12),
    sourceCoverage: {
      eventCounts: telemetry.eventCounts,
      malformedLines: telemetry.malformedLines,
      mintsWithCurveSnapshots: telemetry.snapshotsByMint.size
    },
    note: 'Report-only CURVE_NOT_ADVANCING diagnostic. It compares decision-time baseline/delta fields to later curve and price snapshots. It does not alter gates, thresholds, entries, exits, AI review, quotes, broadcasts, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error('No telemetry file found for curve advance diagnostic.');
  }
  const telemetry = await readTelemetry(telemetryPath);
  const report = buildReport(telemetryPath, telemetry);
  writeJson(outputPath, report);
  console.log('Pre-Migration Curve Advance Diagnostic');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Decisions / unique mints: ${report.summary.decisions} / ${report.summary.uniqueMints}`);
  console.log(`Likely false negatives 120s: ${report.summary.likelyFalseNegativeDecisions120s}`);
  console.log(`Classification counts: ${JSON.stringify(report.summary.classificationCounts)}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
