#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-entry-candidate-review-latest.json');
const WINDOWS_SECONDS = [30, 60, 120, 300];

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

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function num(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return digits === null ? parsed : Number(parsed.toFixed(digits));
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
    ?? payload.entryPriceSol
    ?? payload.exitPriceSol
    ?? payload.market?.priceSol;
  const price = Number(raw);
  return Number.isFinite(price) && price > 0 ? price : null;
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
    curveProgress: num(curveProgress, 6),
    priceSol: num(priceOf(payload), 15)
  };
}

function makeCandidate(kind, event) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  const touch = payload.qualifyingFirstTouch || null;
  const positiveTouch = payload.positiveFirstTouch || null;
  return {
    kind,
    mint,
    symbol: payload.symbol || null,
    atMs,
    at: new Date(atMs).toISOString(),
    preset: payload.preset || payload.sourcePreset || null,
    lane: payload.lane || payload.sourceLane || null,
    profileName: payload.profileName || null,
    sourceReason: payload.sourceReason || payload.reason || null,
    score: num(payload.score, 2),
    curveProgress: num(curveOf(payload), 6),
    priceSol: num(priceOf(payload), 15),
    entryPriceSol: num(payload.entryPriceSol, 15),
    amountSol: num(payload.amountSol, 6),
    qualifyingFirstTouch: touch ? {
      name: touch.name || null,
      reviewTier: touch.reviewTier || null,
      evidenceTier: touch.evidenceTier || null,
      label: touch.label || null,
      side: touch.side || null,
      phase: touch.phase || null,
      curveProgress: num(touch.curveProgress, 6),
      solAmount: num(touch.solAmount, 6),
      positiveOrProven: touch.positiveOrProven === true,
      avoidOrNegative: touch.avoidOrNegative === true
    } : null,
    positiveFirstTouch: positiveTouch ? {
      name: positiveTouch.name || null,
      reviewTier: positiveTouch.reviewTier || null,
      evidenceTier: positiveTouch.evidenceTier || null,
      label: positiveTouch.label || null,
      side: positiveTouch.side || null,
      phase: positiveTouch.phase || null,
      curveProgress: num(positiveTouch.curveProgress, 6),
      solAmount: num(positiveTouch.solAmount, 6)
    } : null
  };
}

function summarizeFuture(candidate, snapshots) {
  const baseCurve = Number(candidate.curveProgress);
  const basePrice = Number(candidate.entryPriceSol ?? candidate.priceSol);
  const windows = {};
  for (const seconds of WINDOWS_SECONDS) {
    const endMs = candidate.atMs + seconds * 1000;
    const rows = snapshots.filter((snapshot) => snapshot.atMs > candidate.atMs && snapshot.atMs <= endMs);
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
    windows[`${seconds}s`] = {
      snapshotCount: rows.length,
      maxCurveProgress: num(maxCurve, 6),
      curveDelta: Number.isFinite(baseCurve) && Number.isFinite(maxCurve) ? num(maxCurve - baseCurve, 6) : null,
      crossed85: Number.isFinite(maxCurve) && maxCurve >= 0.85,
      crossed90: Number.isFinite(maxCurve) && maxCurve >= 0.9,
      crossed95: Number.isFinite(maxCurve) && maxCurve >= 0.95,
      maxPriceDeltaPct: num(maxPriceDeltaPct, 4)
    };
  }
  return windows;
}

function classifyCandidate(candidate, exitsByEntryKey, dryRunByMint, priorEntryByMint) {
  const flags = [];
  const exit = exitsByEntryKey.get(entryKey(candidate)) || null;
  const future120 = candidate.windows?.['120s'] || {};
  const dryRuns = dryRunByMint.get(candidate.mint) || [];
  const dryBlocks = dryRuns.filter((row) => row.type === 'live_dry_run.would_block');
  const drySends = dryRuns.filter((row) => row.type === 'live_dry_run.would_send');
  const prior = priorEntryByMint.get(candidate.mint);

  if (candidate.kind === 'paper_entry' && exit?.pnlSol < 0) flags.push('NEGATIVE_PAPER_EXIT');
  if (candidate.kind === 'paper_entry' && exit?.reason === 'BREAKEVEN_STOP' && exit?.pnlSol < 0) flags.push('BREAKEVEN_STOP_LOSS');
  if (candidate.kind === 'paper_entry' && prior && prior.atMs < candidate.atMs) flags.push('REPEAT_SAME_MINT_ENTRY');
  if (candidate.kind === 'wallet_shadow_would_enter' && candidate.qualifyingFirstTouch?.avoidOrNegative) flags.push('AVOID_OR_NEGATIVE_FIRST_TOUCH');
  if (candidate.kind === 'wallet_shadow_would_enter' && !candidate.qualifyingFirstTouch?.positiveOrProven) flags.push('NO_POSITIVE_FIRST_TOUCH');
  if (candidate.kind === 'wallet_shadow_would_enter' && future120.crossed85 !== true) flags.push('NO_85_CROSS_WITHIN_120S');
  if (dryBlocks.some((row) => row.reason === 'UNSUPPORTED_QUOTE_MINT')) flags.push('DRY_RUN_UNSUPPORTED_QUOTE_MINT');
  if (!drySends.length && dryBlocks.length) flags.push('DRY_RUN_POLICY_BLOCKED');
  if (candidate.kind === 'paper_entry' && candidate.qualifyingFirstTouch === null) flags.push('NO_WALLET_CONTEXT_ON_ENTRY');

  let verdict = 'WATCH';
  if (flags.includes('NEGATIVE_PAPER_EXIT') || flags.includes('AVOID_OR_NEGATIVE_FIRST_TOUCH') || flags.includes('DRY_RUN_UNSUPPORTED_QUOTE_MINT')) {
    verdict = 'REJECT_OR_KEEP_GATED';
  } else if (flags.includes('REPEAT_SAME_MINT_ENTRY') || flags.includes('NO_85_CROSS_WITHIN_120S')) {
    verdict = 'COLLECT_MORE_WITH_GUARD';
  }

  return {
    ...candidate,
    exit,
    dryRun: {
      wouldSend: drySends.length,
      wouldBlock: dryBlocks.length,
      blockReasons: countBy(dryBlocks, (row) => row.reason || 'unknown')
    },
    flags,
    verdict
  };
}

function entryKey(candidate) {
  return `${candidate.mint}:${candidate.profileName || ''}:${candidate.entryPriceSol || ''}`;
}

function exitEntryKey(exit) {
  return `${exit.mint}:${exit.profileName || ''}:${exit.entryPriceSol || ''}`;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const candidates = [];
  const exits = [];
  const dryRunByMint = new Map();
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
    const type = event.type || event.event || 'unknown';
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    const payload = payloadOf(event);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
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

    if (type === 'pre_migration_paper.entry') {
      const candidate = makeCandidate('paper_entry', event);
      if (candidate) candidates.push(candidate);
    } else if (type === 'pre_migration_wallet_relaxed_shadow.would_enter') {
      const candidate = makeCandidate('wallet_shadow_would_enter', event);
      if (candidate) candidates.push(candidate);
    } else if (type === 'pre_migration_paper.exit') {
      const exit = makeCandidate('paper_exit', event);
      if (exit) {
        exit.exitPriceSol = num(payload.exitPriceSol, 15);
        exit.pnlSol = num(payload.pnlSol, 9);
        exit.returnPct = num(payload.returnPct, 6);
        exit.reason = payload.reason || payload.exitReason || null;
        exit.holdSeconds = num(payload.holdSeconds, 2);
        exits.push(exit);
      }
    } else if (type === 'live_dry_run.would_send' || type === 'live_dry_run.would_block') {
      const mint = mintOf(payload);
      if (mint) {
        const rows = dryRunByMint.get(mint) || [];
        rows.push({
          type,
          atMs,
          reason: payload.reason || null,
          sourceReason: payload.sourceReason || null,
          pairBase: payload.pairBase || null,
          quoteMint: payload.quoteMint || null,
          accountCurveProgress: num(payload.accountCurveProgress, 6),
          priceImpactPct: num(payload.quote?.priceImpactPct, 4)
        });
        dryRunByMint.set(mint, rows);
      }
    }
  }

  return {
    telemetry: {
      path: filePath,
      malformedLines,
      startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
      endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
      eventCounts
    },
    snapshotsByMint,
    candidates,
    exits,
    dryRunByMint
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry || telemetryFromBattlefield() || latestTelemetryFile());
  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    throw new Error(`Telemetry file not found: ${telemetryPath || '(none)'}`);
  }

  const read = await readTelemetry(telemetryPath);
  for (const rows of read.snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  const exitsByEntryKey = new Map(read.exits.map((exit) => [exitEntryKey(exit), exit]));
  const priorEntryByMint = new Map();

  const reviewed = read.candidates
    .sort((a, b) => a.atMs - b.atMs)
    .map((candidate) => {
      const withFuture = {
        ...candidate,
        windows: summarizeFuture(candidate, read.snapshotsByMint.get(candidate.mint) || [])
      };
      const reviewedCandidate = classifyCandidate(withFuture, exitsByEntryKey, read.dryRunByMint, priorEntryByMint);
      if (candidate.kind === 'paper_entry' && !priorEntryByMint.has(candidate.mint)) {
        priorEntryByMint.set(candidate.mint, candidate);
      }
      return reviewedCandidate;
    });

  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_pre_migration_entry_candidate_review',
    note: 'Joins actual paper entries and wallet-relaxed would-enter attempts to exits, dry-run policy, and future curve/price movement. Does not alter gates, sizing, or live behavior.',
    telemetry: read.telemetry,
    summary: {
      candidates: reviewed.length,
      paperEntries: reviewed.filter((row) => row.kind === 'paper_entry').length,
      walletShadowWouldEnter: reviewed.filter((row) => row.kind === 'wallet_shadow_would_enter').length,
      paperPnlSol: num(reviewed.reduce((sum, row) => sum + Number(row.exit?.pnlSol || 0), 0), 9),
      verdictCounts: countBy(reviewed, (row) => row.verdict),
      flagCounts: countBy(reviewed.flatMap((row) => row.flags || []), (flag) => flag),
      uniqueMints: new Set(reviewed.map((row) => row.mint)).size
    },
    candidates: reviewed
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(JSON.stringify(output.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
