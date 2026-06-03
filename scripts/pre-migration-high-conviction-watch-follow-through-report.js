#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-high-conviction-watch-follow-through-latest.json');

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

function latestFile(pattern) {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function pathsFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return {
      telemetryPath: report.files?.telemetryPath || null,
      dossierPath: report.files?.dossierPath || null
    };
  } catch {
    return { telemetryPath: null, dossierPath: null };
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
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOfPayload(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function curveOfPayload(payload) {
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

function priceOfPayload(payload) {
  const raw = payload.providerCurvePriceSol
    ?? payload.bondingCurvePriceSol
    ?? payload.curvePriceSol
    ?? payload.priceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function curveSnapshotFromTelemetry(event) {
  const payload = payloadOf(event);
  const mint = mintOfPayload(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const curveProgress = curveOfPayload(payload);
  if (!mint || !Number.isFinite(atMs) || !Number.isFinite(curveProgress)) return null;
  return {
    mint,
    atMs,
    at: new Date(atMs).toISOString(),
    eventType: event.type || event.event || 'unknown',
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOfPayload(payload), 12)
  };
}

function classifyWatchCandidate(dossier) {
  if (dossier?.source !== 'pre_migration_watch') return false;
  const watch = dossier.watch || {};
  const gmgn = dossier.gmgnStyle || {};
  const tags = new Set(Array.isArray(gmgn.tags) ? gmgn.tags : []);
  const score = Number(gmgn.score);
  const curve = Number(dossier.curve?.progress);
  const sniperWalletCount = Number(dossier.risk?.sniperWalletCount || 0);
  const repeatedEarlyBuyerCount = Number(dossier.walletQuality?.repeatedEarlyBuyerCount || 0);
  const isWatch = ['watch', 'high_conviction_watch'].includes(gmgn.verdict);
  const confirmed = watch.confirmed === true || tags.has('watch_confirmed') || gmgn.verdict === 'high_conviction_watch';
  const flagged = watch.flagged === true || tags.has('watch_flagged');
  if (!isWatch || (!confirmed && !flagged)) return false;

  if (confirmed && (score >= 70 || curve >= 0.6)) return 'confirmed_high_conviction';
  if (score >= 70 || curve >= 0.6) return 'flagged_high_conviction';
  if (curve >= 0.55) return 'flagged_near_finalist_curve';
  if (score >= 55 && (sniperWalletCount > 0 || repeatedEarlyBuyerCount > 0)) return 'flagged_wallet_supported_score';
  return false;
}

function watchRowFromDossier(dossier, selectionClass) {
  const atMs = timestampMs(dossier.timestamp);
  const mint = dossier.identity?.mint;
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    symbol: dossier.identity?.symbol || null,
    at: new Date(atMs).toISOString(),
    atMs,
    sourceDossierPath: null,
    selectionClass,
    verdict: dossier.gmgnStyle?.verdict || null,
    score: numberOrNull(dossier.gmgnStyle?.score, 2),
    reasons: Array.isArray(dossier.gmgnStyle?.reasons) ? dossier.gmgnStyle.reasons : [],
    tags: Array.isArray(dossier.gmgnStyle?.tags) ? dossier.gmgnStyle.tags : [],
    curveProgress: numberOrNull(dossier.curve?.progress, 6),
    priceSol: numberOrNull(dossier.curve?.priceSol, 12),
    recentVolumeSol: numberOrNull(dossier.activity?.recentVolumeSol, 4),
    tradeVelocityPerMin: numberOrNull(dossier.activity?.tradeVelocityPerMin, 2),
    buyRatio: numberOrNull(dossier.activity?.buyRatio, 4),
    recentTradeCount: numberOrNull(dossier.activity?.recentTradeCount, 0),
    interestSignalCount: numberOrNull(dossier.timing?.interestSignalCount ?? dossier.watch?.interestSignalCount, 0),
    observedSignalCount: numberOrNull(dossier.watch?.observedSignalCount, 0),
    confirmCount: numberOrNull(dossier.watch?.confirmCount, 0),
    sniperWalletCount: numberOrNull(dossier.risk?.sniperWalletCount, 0),
    repeatedEarlyBuyerCount: numberOrNull(dossier.walletQuality?.repeatedEarlyBuyerCount, 0)
  };
}

async function readTelemetrySnapshots(filePath) {
  const snapshotsByMint = new Map();
  let malformedLines = 0;
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
    const snapshot = curveSnapshotFromTelemetry(event);
    if (!snapshot) continue;
    const rows = snapshotsByMint.get(snapshot.mint) || [];
    rows.push(snapshot);
    snapshotsByMint.set(snapshot.mint, rows);
  }
  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  return { snapshotsByMint, malformedLines };
}

async function readWatchRows(filePath) {
  const rows = [];
  let malformedLines = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let dossier;
    try {
      dossier = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    const selectionClass = classifyWatchCandidate(dossier);
    if (!selectionClass) continue;
    const row = watchRowFromDossier(dossier, selectionClass);
    if (row) rows.push(row);
  }
  return { rows, malformedLines };
}

function firstCross(snapshots, threshold, startCurve) {
  if (Number.isFinite(Number(startCurve)) && Number(startCurve) >= threshold) return null;
  return snapshots.find((snapshot) => Number(snapshot.curveProgress) >= threshold) || null;
}

function analyzeWindow(row, snapshots, seconds) {
  const endMs = row.atMs + seconds * 1000;
  const future = snapshots.filter((snapshot) => snapshot.atMs > row.atMs && snapshot.atMs <= endMs);
  const maxCurve = stat(future.map((snapshot) => snapshot.curveProgress), 6).max;
  const maxPrice = stat(future.map((snapshot) => snapshot.priceSol), 12).max;
  const startPrice = Number(row.priceSol);
  const priceDelta = Number.isFinite(startPrice) && startPrice > 0 && maxPrice !== null
    ? ((Number(maxPrice) - startPrice) / startPrice) * 100
    : null;
  const startCurve = Number(row.curveProgress);
  const crossed85 = firstCross(future, 0.85, startCurve);
  const crossed90 = firstCross(future, 0.9, startCurve);
  const crossed95 = firstCross(future, 0.95, startCurve);
  const crossed100 = firstCross(future, 1, startCurve);
  return {
    seconds,
    futureSnapshotCount: future.length,
    maxCurveProgress: maxCurve,
    curveDelta: maxCurve !== null && Number.isFinite(startCurve) ? numberOrNull(Number(maxCurve) - startCurve, 6) : null,
    maxPriceDeltaPct: numberOrNull(priceDelta, 2),
    crossed85AfterWatch: Boolean(crossed85),
    crossed90AfterWatch: Boolean(crossed90),
    crossed95AfterWatch: Boolean(crossed95),
    crossed100AfterWatch: Boolean(crossed100),
    first85CrossAt: crossed85?.at || null,
    first90CrossAt: crossed90?.at || null,
    first95CrossAt: crossed95?.at || null,
    first100CrossAt: crossed100?.at || null
  };
}

function analyzeRow(row, snapshotsByMint) {
  const snapshots = snapshotsByMint.get(row.mint) || [];
  return {
    ...row,
    window120s: analyzeWindow(row, snapshots, 120),
    window300s: analyzeWindow(row, snapshots, 300)
  };
}

function dedupeLatestByMint(rows) {
  const latest = new Map();
  for (const row of rows) {
    const current = latest.get(row.mint);
    if (!current || row.atMs > current.atMs) latest.set(row.mint, row);
  }
  return Array.from(latest.values());
}

function compact(row) {
  return {
    mint: row.mint,
    symbol: row.symbol,
    at: row.at,
    selectionClass: row.selectionClass,
    verdict: row.verdict,
    score: row.score,
    curveProgress: row.curveProgress,
    recentVolumeSol: row.recentVolumeSol,
    tradeVelocityPerMin: row.tradeVelocityPerMin,
    buyRatio: row.buyRatio,
    recentTradeCount: row.recentTradeCount,
    sniperWalletCount: row.sniperWalletCount,
    repeatedEarlyBuyerCount: row.repeatedEarlyBuyerCount,
    tags: row.tags,
    window120s: row.window120s,
    window300s: row.window300s
  };
}

function buildReport({ telemetryPath, dossierPath, snapshotsByMint, watchRows, malformedTelemetry, malformedDossiers }) {
  const analyzed = watchRows.map((row) => analyzeRow(row, snapshotsByMint));
  const uniqueRows = dedupeLatestByMint(analyzed);
  const crossed85_120 = uniqueRows.filter((row) => row.window120s.crossed85AfterWatch);
  const crossed90_120 = uniqueRows.filter((row) => row.window120s.crossed90AfterWatch);
  const crossed85_300 = uniqueRows.filter((row) => row.window300s.crossed85AfterWatch);
  const crossed90_300 = uniqueRows.filter((row) => row.window300s.crossed90AfterWatch);
  const topFollowThrough = [...uniqueRows]
    .sort((a, b) => {
      const delta = Number(b.window120s.curveDelta ?? -Infinity) - Number(a.window120s.curveDelta ?? -Infinity);
      if (delta !== 0) return delta;
      return Number(b.window120s.maxPriceDeltaPct ?? -Infinity) - Number(a.window120s.maxPriceDeltaPct ?? -Infinity);
    })
    .slice(0, 20)
    .map(compact);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    inputs: {
      telemetryPath: path.relative(ROOT, telemetryPath),
      dossierPath: path.relative(ROOT, dossierPath),
      malformedTelemetry,
      malformedDossiers
    },
    selection: {
      source: 'candidate dossiers',
      criteria: [
        'source=pre_migration_watch',
        'watch_flagged OR watch_confirmed',
        'confirmed_high_conviction: confirmed AND (score>=70 OR curveProgress>=0.6)',
        'flagged_high_conviction: flagged AND (score>=70 OR curveProgress>=0.6)',
        'flagged_near_finalist_curve: flagged AND curveProgress>=0.55',
        'flagged_wallet_supported_score: flagged AND score>=55 AND wallet support'
      ].join(' AND/OR ')
    },
    summary: {
      rawWatchRows: analyzed.length,
      uniqueMints: uniqueRows.length,
      selectionClassCounts: countBy(uniqueRows, (row) => row.selectionClass),
      verdictCounts: countBy(uniqueRows, (row) => row.verdict),
      tagCounts: countBy(uniqueRows.flatMap((row) => row.tags || []), (tag) => tag),
      crossed85Within120s: crossed85_120.length,
      crossed90Within120s: crossed90_120.length,
      crossed85Within300s: crossed85_300.length,
      crossed90Within300s: crossed90_300.length,
      curveDelta120s: stat(uniqueRows.map((row) => row.window120s.curveDelta), 6),
      maxPriceDeltaPct120s: stat(uniqueRows.map((row) => row.window120s.maxPriceDeltaPct), 2),
      score: stat(uniqueRows.map((row) => row.score), 2),
      curveProgress: stat(uniqueRows.map((row) => row.curveProgress), 6)
    },
    crossed90Within120s: crossed90_120.map(compact),
    crossed85Within120s: crossed85_120.map(compact),
    topFollowThrough,
    note: 'Report-only diagnostic for high-conviction and near-finalist watch candidates. It does not change thresholds, paper entries, exits, AI review, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fromBattlefield = pathsFromBattlefield();
  const telemetryPath = repoPath(args.telemetry) || repoPath(fromBattlefield.telemetryPath) || latestFile(/^telemetry-.*\.jsonl$/i);
  const dossierPath = repoPath(args.dossiers) || repoPath(fromBattlefield.dossierPath) || latestFile(/^candidate-dossiers-.*\.jsonl$/i);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found.');
  if (!dossierPath || !fs.existsSync(dossierPath)) throw new Error('No candidate dossier file found.');

  const telemetry = await readTelemetrySnapshots(telemetryPath);
  const dossiers = await readWatchRows(dossierPath);
  const report = buildReport({
    telemetryPath,
    dossierPath,
    snapshotsByMint: telemetry.snapshotsByMint,
    watchRows: dossiers.rows,
    malformedTelemetry: telemetry.malformedLines,
    malformedDossiers: dossiers.malformedLines
  });
  writeJson(outputPath, report);
  console.log('Pre-Migration High-Conviction Watch Follow-through');
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Dossiers: ${dossierPath}`);
  console.log(`Raw watch rows: ${report.summary.rawWatchRows}`);
  console.log(`Unique mints: ${report.summary.uniqueMints}`);
  console.log(`Crossed 85/90 within 120s: ${report.summary.crossed85Within120s}/${report.summary.crossed90Within120s}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
