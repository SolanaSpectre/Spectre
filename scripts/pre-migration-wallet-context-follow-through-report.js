#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { normalizeDryRunReason } = require('../src/lib/simulation-error-classifier');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-context-follow-through-latest.json');
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

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
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

function isPositiveOrProven(wallet = {}) {
  return ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(wallet.evidenceTier)
    || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(wallet.reviewTier);
}

function isAvoid(wallet = {}) {
  return wallet.evidenceTier === 'NEGATIVE_EVIDENCE' || wallet.reviewTier === 'AVOID_REVIEW';
}

function walletContextSummary(context = {}) {
  const wallets = Array.isArray(context.wallets) ? context.wallets : [];
  const sorted = wallets.slice().sort((a, b) => timestampMs(a.tradeAt) - timestampMs(b.tradeAt));
  const qualifyingFirstTouch = sorted.find((wallet) => String(wallet.side || '').toLowerCase() === 'buy') || null;
  const positiveFirstTouch = sorted.find((wallet) => String(wallet.side || '').toLowerCase() === 'buy' && isPositiveOrProven(wallet)) || null;
  return {
    wallets,
    touchCount: wallets.length,
    positiveOrProvenTouchCount: wallets.filter(isPositiveOrProven).length,
    avoidTouchCount: wallets.filter(isAvoid).length,
    contextSource: context.contextSource || null,
    earliestTouchAt: context.earliestTouchAt || null,
    earliestBuyAt: context.earliestBuyAt || null,
    qualifyingFirstTouch,
    positiveFirstTouch
  };
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
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    eventType: event.type || event.event || 'unknown'
  };
}

function decisionFromEvent(event) {
  const eventType = event.type || event.event;
  if (eventType !== 'pre_migration_paper.decision') return null;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  const context = walletContextSummary(payload.walletClassificationContext || {});
  if (!mint || !Number.isFinite(atMs) || context.touchCount <= 0) return null;
  return {
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    reason: payload.reason || payload.skipReason || payload.decision || 'unknown',
    decision: payload.decision || null,
    preset: payload.preset || null,
    lane: payload.lane || null,
    score: numberOrNull(payload.score, 2),
    curveProgress: numberOrNull(curveOf(payload), 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    context
  };
}

function eventMarkerFromEvent(event) {
  const type = event.type || event.event;
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;

  if (type === 'live_dry_run.would_send' || type === 'live_dry_run.would_block') {
    return {
      kind: type === 'live_dry_run.would_send' ? 'dry_run_would_send' : 'dry_run_would_block',
      mint,
      atMs,
      at: new Date(atMs).toISOString(),
      reason: normalizeDryRunReason(payload)
    };
  }
  if (type === 'pre_migration_paper.entry') {
    return { kind: 'paper_entry', mint, atMs, at: new Date(atMs).toISOString(), reason: payload.reason || payload.preset || null };
  }
  if (type === 'pre_migration_paper.exit') {
    return {
      kind: 'paper_exit',
      mint,
      atMs,
      at: new Date(atMs).toISOString(),
      reason: payload.reason || null,
      pnlSol: numberOrNull(payload.pnlSol, 9),
      returnPct: numberOrNull(payload.returnPct, 4)
    };
  }
  return null;
}

function futureForWindow(decision, snapshots, markers, seconds) {
  const endMs = decision.atMs + seconds * 1000;
  const rows = snapshots.filter((snapshot) => snapshot.atMs > decision.atMs && snapshot.atMs <= endMs);
  const markerRows = markers.filter((marker) => marker.atMs >= decision.atMs && marker.atMs <= endMs);
  const markerKeysByKind = {
    dry_run_would_send: [],
    dry_run_would_block: [],
    paper_entry: [],
    paper_exit: []
  };
  for (const marker of markerRows) {
    if (!markerKeysByKind[marker.kind]) continue;
    markerKeysByKind[marker.kind].push(`${marker.kind}:${marker.mint}:${marker.atMs}:${marker.reason || ''}`);
  }
  const baseCurve = Number(decision.curveProgress);
  const basePrice = Number(decision.priceSol);
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
    maxCurveProgress: Number.isFinite(maxCurve) ? numberOrNull(maxCurve, 6) : null,
    maxCurveAt: maxCurveRow?.at || null,
    curveDelta: Number.isFinite(baseCurve) && Number.isFinite(maxCurve) ? numberOrNull(maxCurve - baseCurve, 6) : null,
    crossed85: Number.isFinite(maxCurve) && maxCurve >= 0.85,
    crossed90: Number.isFinite(maxCurve) && maxCurve >= 0.9,
    crossed95: Number.isFinite(maxCurve) && maxCurve >= 0.95,
    maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 4),
    dryRunWouldSend: markerKeysByKind.dry_run_would_send.length > 0,
    dryRunWouldBlock: markerKeysByKind.dry_run_would_block.length > 0,
    paperEntry: markerKeysByKind.paper_entry.length > 0,
    paperExit: markerKeysByKind.paper_exit.length > 0,
    markerKeys: markerKeysByKind
  };
}

function addOutcomes(decision, snapshotsByMint, markersByMint) {
  const snapshots = snapshotsByMint.get(decision.mint) || [];
  const markers = markersByMint.get(decision.mint) || [];
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    windows[`${seconds}s`] = futureForWindow(decision, snapshots, markers, seconds);
  }
  return { ...decision, windows };
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const markersByMint = new Map();
  const decisions = [];
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
    const payload = payloadOf(event);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    if (Number.isFinite(atMs)) {
      startMs = Math.min(startMs, atMs);
      endMs = Math.max(endMs, atMs);
    }

    const snapshot = snapshotFromEvent(event);
    if (snapshot) {
      if (!snapshotsByMint.has(snapshot.mint)) snapshotsByMint.set(snapshot.mint, []);
      snapshotsByMint.get(snapshot.mint).push(snapshot);
    }

    const marker = eventMarkerFromEvent(event);
    if (marker) {
      if (!markersByMint.has(marker.mint)) markersByMint.set(marker.mint, []);
      markersByMint.get(marker.mint).push(marker);
    }

    const decision = decisionFromEvent(event);
    if (decision) decisions.push(decision);
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  for (const rows of markersByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  decisions.sort((a, b) => a.atMs - b.atMs);

  return {
    snapshotsByMint,
    markersByMint,
    decisions,
    eventCounts,
    malformedLines,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null
  };
}

function summarizeRows(rows) {
  const unique = new Map();
  for (const row of rows) {
    if (!unique.has(row.mint)) unique.set(row.mint, row);
  }
  const uniqueRows = [...unique.values()];
  const windowSummary = {};
  for (const seconds of WINDOWS_SECONDS) {
    const key = `${seconds}s`;
    const uniqueCrossed85 = new Set();
    const uniqueCrossed90 = new Set();
    const markerMints = {
      dryRunWouldSend: new Set(),
      dryRunWouldBlock: new Set(),
      paperEntry: new Set(),
      paperExit: new Set()
    };
    const markerEvents = {
      dryRunWouldSend: new Set(),
      dryRunWouldBlock: new Set(),
      paperEntry: new Set(),
      paperExit: new Set()
    };
    for (const row of rows) {
      if (row.windows[key]?.crossed85) uniqueCrossed85.add(row.mint);
      if (row.windows[key]?.crossed90) uniqueCrossed90.add(row.mint);
      if (row.windows[key]?.dryRunWouldSend) markerMints.dryRunWouldSend.add(row.mint);
      if (row.windows[key]?.dryRunWouldBlock) markerMints.dryRunWouldBlock.add(row.mint);
      if (row.windows[key]?.paperEntry) markerMints.paperEntry.add(row.mint);
      if (row.windows[key]?.paperExit) markerMints.paperExit.add(row.mint);
      for (const markerKey of row.windows[key]?.markerKeys?.dry_run_would_send || []) markerEvents.dryRunWouldSend.add(markerKey);
      for (const markerKey of row.windows[key]?.markerKeys?.dry_run_would_block || []) markerEvents.dryRunWouldBlock.add(markerKey);
      for (const markerKey of row.windows[key]?.markerKeys?.paper_entry || []) markerEvents.paperEntry.add(markerKey);
      for (const markerKey of row.windows[key]?.markerKeys?.paper_exit || []) markerEvents.paperExit.add(markerKey);
    }
    windowSummary[key] = {
      crossed85: rows.filter((row) => row.windows[key]?.crossed85).length,
      crossed90: rows.filter((row) => row.windows[key]?.crossed90).length,
      uniqueCrossed85: uniqueCrossed85.size,
      uniqueCrossed90: uniqueCrossed90.size,
      dryRunWouldSend: rows.filter((row) => row.windows[key]?.dryRunWouldSend).length,
      dryRunWouldBlock: rows.filter((row) => row.windows[key]?.dryRunWouldBlock).length,
      paperEntry: rows.filter((row) => row.windows[key]?.paperEntry).length,
      paperExit: rows.filter((row) => row.windows[key]?.paperExit).length,
      uniqueDryRunWouldSendMints: markerMints.dryRunWouldSend.size,
      uniqueDryRunWouldBlockMints: markerMints.dryRunWouldBlock.size,
      uniquePaperEntryMints: markerMints.paperEntry.size,
      uniquePaperExitMints: markerMints.paperExit.size,
      uniqueDryRunWouldSendEvents: markerEvents.dryRunWouldSend.size,
      uniqueDryRunWouldBlockEvents: markerEvents.dryRunWouldBlock.size,
      uniquePaperEntryEvents: markerEvents.paperEntry.size,
      uniquePaperExitEvents: markerEvents.paperExit.size,
      curveDelta: stat(rows.map((row) => row.windows[key]?.curveDelta), 6),
      maxPriceDeltaPct: stat(rows.map((row) => row.windows[key]?.maxPriceDeltaPct), 4)
    };
  }
  return {
    decisions: rows.length,
    uniqueMints: uniqueRows.length,
    withPositiveOrProvenTouch: rows.filter((row) => row.context.positiveOrProvenTouchCount > 0).length,
    withAvoidTouch: rows.filter((row) => row.context.avoidTouchCount > 0).length,
    touchCount: stat(rows.map((row) => row.context.touchCount), 2),
    sourceCounts: countBy(rows, (row) => row.context.contextSource || 'none'),
    windowSummary
  };
}

function summarize(outcomes) {
  const byReason = {};
  for (const row of outcomes) {
    if (!byReason[row.reason]) byReason[row.reason] = [];
    byReason[row.reason].push(row);
  }
  const reasonSummaries = Object.fromEntries(
    Object.entries(byReason)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([reason, rows]) => [reason, summarizeRows(rows)])
  );
  const topFollowThrough = outcomes
    .slice()
    .sort((a, b) => {
      const bCross = b.windows['120s']?.crossed90 ? 1 : 0;
      const aCross = a.windows['120s']?.crossed90 ? 1 : 0;
      if (bCross !== aCross) return bCross - aCross;
      return Number(b.windows['120s']?.curveDelta || 0) - Number(a.windows['120s']?.curveDelta || 0);
    })
    .slice(0, 16)
    .map((row) => ({
      mint: row.mint,
      symbol: row.symbol,
      at: row.at,
      reason: row.reason,
      score: row.score,
      curveProgress: row.curveProgress,
      touchCount: row.context.touchCount,
      positiveOrProvenTouchCount: row.context.positiveOrProvenTouchCount,
      avoidTouchCount: row.context.avoidTouchCount,
      firstTouch: row.context.qualifyingFirstTouch ? {
        wallet: row.context.qualifyingFirstTouch.wallet || null,
        name: row.context.qualifyingFirstTouch.name || null,
        reviewTier: row.context.qualifyingFirstTouch.reviewTier || null,
        evidenceTier: row.context.qualifyingFirstTouch.evidenceTier || null,
        side: row.context.qualifyingFirstTouch.side || null,
        tradeAt: row.context.qualifyingFirstTouch.tradeAt || null
      } : null,
      max120: row.windows['120s']?.maxCurveProgress,
      delta120: row.windows['120s']?.curveDelta,
      crossed90Within120s: row.windows['120s']?.crossed90,
      dryRunWouldSendWithin120s: row.windows['120s']?.dryRunWouldSend,
      paperEntryWithin120s: row.windows['120s']?.paperEntry
    }));
  return {
    all: summarizeRows(outcomes),
    byReason: reasonSummaries,
    topFollowThrough
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || 'none'}`);
  }
  const outputPath = args.output ? path.resolve(ROOT, args.output) : OUTPUT_PATH;
  const telemetry = await readTelemetry(telemetryPath);
  const outcomes = telemetry.decisions.map((decision) => addOutcomes(decision, telemetry.snapshotsByMint, telemetry.markersByMint));
  const summary = summarize(outcomes);
  const lowScoreFirstSightRows = outcomes.filter((row) => ['LOW_SCORE', 'FIRST_SIGHT_REQUIRES_GUARD_OVERRIDE'].includes(row.reason));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_context_follow_through',
    note: 'Follows paper decisions that had wallet context, grouped by skip/decision reason. Does not alter runtime gates or live broadcast.',
    sources: {
      telemetryPath
    },
    telemetry: {
      startAt: telemetry.startAt,
      endAt: telemetry.endAt,
      malformedLines: telemetry.malformedLines,
      eventCounts: telemetry.eventCounts
    },
    summary,
    lowScoreFirstSightSummary: summarizeRows(lowScoreFirstSightRows)
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`Wrote wallet context follow-through report: ${path.relative(ROOT, outputPath)}`);
  console.log(`Wallet-context decisions: ${outcomes.length}; LOW_SCORE/FIRST_SIGHT with wallet context: ${lowScoreFirstSightRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
