#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const DEFAULT_RICK_CONTEXT = path.join(ROOT, 'data', 'rick-context', 'latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'rick-sighting-follow-through-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'rick-sighting-follow-through');
const HORIZON_MINUTES = [30, 60, 120, 300];
const LOOKBACK_MINUTES = 60;
const LOOKFORWARD_MINUTES = 300;

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

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function numberOrNull(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function normalizeSymbol(value) {
  return String(value || '')
    .replace(/^\$/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function normalizeName(value) {
  return String(value || '')
    .replace(/^\$/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function displayText(value) {
  return String(value || '').replace(/[^\x20-\x7E\n]/g, ' ').replace(/[ \t]+/g, ' ').trim();
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

function stat(values, digits = 4) {
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

function exactMintMentionsFromText(text) {
  return Array.from(new Set(displayText(text).match(/\b[1-9A-HJ-NP-Za-km-z]{20,}(?:pump)?\b/g) || []));
}

function extractRickSightings(rickContext) {
  const messages = Array.isArray(rickContext.messages) ? rickContext.messages : [];
  const sightings = [];
  let index = 0;

  for (const message of messages) {
    const reportType = message.reportType || null;
    const sightedAtMs = timestampMs(message.date);
    if (!reportType || !Number.isFinite(sightedAtMs)) continue;
    const text = displayText(message.text || '');
    const explicitMints = exactMintMentionsFromText(text);
    const mentionRows = Array.isArray(message.tokenMentions) && message.tokenMentions.length
      ? message.tokenMentions
      : [];

    for (const mention of mentionRows) {
      const symbol = mention.symbol || mention.name || null;
      const symbolKey = normalizeSymbol(mention.symbolKey || symbol);
      if (!symbolKey) continue;
      index += 1;
      sightings.push({
        id: `rick_${index}`,
        symbol,
        symbolKey,
        normalizedNameKey: normalizeName(symbol),
        reportType,
        sightedAt: new Date(sightedAtMs).toISOString(),
        sightedAtMs,
        ageHint: mention.ageHint || null,
        capUsd: numberOrNull(mention.capUsd, 2),
        targetCapUsd: numberOrNull(mention.targetCapUsd, 2),
        line: mention.line || null,
        chatTitle: message.chatTitle || null,
        messageId: message.messageId || null,
        explicitMints
      });
    }
  }

  return sightings;
}

function addSymbolIndex(index, row) {
  if (!row.symbolKey) return;
  const rows = index.get(row.symbolKey) || [];
  rows.push(row);
  index.set(row.symbolKey, rows);
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
    symbol: payload.symbol || payload.name || null,
    symbolKey: normalizeSymbol(payload.symbol || payload.name || ''),
    curveProgress: numberOrNull(curveProgress, 6),
    priceSol: numberOrNull(priceOf(payload), 12),
    eventType: event.type || event.event || 'unknown'
  };
}

function actionFromEvent(event) {
  const type = event.type || event.event || 'unknown';
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(payload.timestamp || event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  if (type === 'pre_migration_paper.decision') {
    return {
      kind: payload.decision === 'PAPER_SKIPPED' ? 'paper_skip' : 'paper_decision',
      type,
      mint,
      atMs,
      at: new Date(atMs).toISOString(),
      symbol: payload.symbol || null,
      symbolKey: normalizeSymbol(payload.symbol || ''),
      reason: payload.reason || payload.skipReason || payload.decision || null,
      decision: payload.decision || null,
      score: numberOrNull(payload.score, 2),
      curveProgress: numberOrNull(curveOf(payload), 6),
      priceSol: numberOrNull(priceOf(payload), 12)
    };
  }
  if (type === 'live_dry_run.would_send' || type === 'live_dry_run.would_block') {
    return {
      kind: type === 'live_dry_run.would_send' ? 'dry_run_would_send' : 'dry_run_would_block',
      type,
      mint,
      atMs,
      at: new Date(atMs).toISOString(),
      symbol: payload.symbol || null,
      symbolKey: normalizeSymbol(payload.symbol || ''),
      reason: payload.reason || payload.blockReason || payload.sourceReason || null,
      decision: payload.sourceDecision || payload.decision || null,
      score: numberOrNull(payload.score, 2),
      curveProgress: numberOrNull(curveOf(payload), 6),
      priceSol: numberOrNull(priceOf(payload), 12)
    };
  }
  if (type === 'pre_migration_paper.entry' || type === 'pre_migration_paper.exit') {
    return {
      kind: type === 'pre_migration_paper.entry' ? 'paper_entry' : 'paper_exit',
      type,
      mint,
      atMs,
      at: new Date(atMs).toISOString(),
      symbol: payload.symbol || null,
      symbolKey: normalizeSymbol(payload.symbol || ''),
      reason: payload.reason || payload.preset || null,
      decision: null,
      score: numberOrNull(payload.score, 2),
      curveProgress: numberOrNull(curveOf(payload), 6),
      priceSol: numberOrNull(priceOf(payload), 12)
    };
  }
  if (type === 'pre_migration.flagged' || type === 'pre_migration.observed') {
    return {
      kind: type === 'pre_migration.flagged' ? 'watch_flagged' : 'watch_observed',
      type,
      mint,
      atMs,
      at: new Date(atMs).toISOString(),
      symbol: payload.symbol || null,
      symbolKey: normalizeSymbol(payload.symbol || ''),
      reason: Array.isArray(payload.reasons) ? payload.reasons.join(',') : payload.reason || null,
      decision: null,
      score: numberOrNull(payload.score, 2),
      curveProgress: numberOrNull(curveOf(payload), 6),
      priceSol: numberOrNull(priceOf(payload), 12)
    };
  }
  return null;
}

async function readTelemetry(filePath) {
  const snapshotsByMint = new Map();
  const actionsByMint = new Map();
  const symbols = new Map();
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
      if (snapshot.symbolKey) {
        addSymbolIndex(symbols, {
          mint: snapshot.mint,
          symbol: snapshot.symbol,
          symbolKey: snapshot.symbolKey,
          nameKey: normalizeName(snapshot.symbol),
          atMs: snapshot.atMs,
          source: 'telemetry_snapshot'
        });
      }
    }

    const action = actionFromEvent(event);
    if (action) {
      const rows = actionsByMint.get(action.mint) || [];
      rows.push(action);
      actionsByMint.set(action.mint, rows);
      if (action.symbolKey) {
        addSymbolIndex(symbols, {
          mint: action.mint,
          symbol: action.symbol,
          symbolKey: action.symbolKey,
          nameKey: normalizeName(action.symbol),
          atMs: action.atMs,
          source: action.kind
        });
      }
    }
  }

  for (const rows of snapshotsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  for (const rows of actionsByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);

  return {
    snapshotsByMint,
    actionsByMint,
    symbols,
    eventCounts,
    malformedLines,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null
  };
}

async function readDossiers(filePath, symbolIndex) {
  if (!filePath || !fs.existsSync(filePath)) return { rows: 0, malformedLines: 0 };
  let rows = 0;
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
    rows += 1;
    const mint = dossier.identity?.mint || dossier.mint || null;
    const symbol = dossier.identity?.symbol || dossier.symbol || null;
    const name = dossier.identity?.name || dossier.name || symbol;
    const atMs = timestampMs(dossier.timestamp || dossier.at);
    const symbolKey = normalizeSymbol(symbol);
    if (mint && symbolKey) {
      addSymbolIndex(symbolIndex, {
        mint,
        symbol,
        symbolKey,
        nameKey: normalizeName(name),
        atMs,
        source: 'candidate_dossier',
        rickMentionCount: numberOrNull(dossier.walletQuality?.rickMentionCount, 0),
        repeatedEarlyBuyerCount: numberOrNull(dossier.walletQuality?.repeatedEarlyBuyerCount, 0),
        score: numberOrNull(dossier.gmgnStyle?.score, 2)
      });
    }
  }
  return { rows, malformedLines };
}

function distinctMints(rows) {
  return Array.from(new Set((rows || []).map((row) => row.mint).filter(Boolean)));
}

function classifyMatch(sighting, candidateRows, exactMintRows) {
  if (exactMintRows.length > 0) return 'exact_mint';
  const symbolSightings = Number(sighting.collision?.symbolSightings || 0);
  const distinctMintCount = Number(sighting.collision?.distinctMintsForSymbol || 0);
  if (symbolSightings >= 4 || distinctMintCount >= 3) return 'symbol_only_spammy_ticker';
  const sameName = candidateRows.filter((row) => row.nameKey && row.nameKey === sighting.normalizedNameKey);
  if (sameName.length > 0 && distinctMintCount <= 2) return 'name_and_symbol';
  if (symbolSightings === 1 && distinctMintCount <= 1) return 'symbol_collision_clean';
  return 'symbol_only_collision_risk';
}

function analyzeOutcome(sighting, matchedMints, telemetry) {
  const windows = {};
  const allFutureSnapshots = [];
  for (const mint of matchedMints) {
    const rows = telemetry.snapshotsByMint.get(mint) || [];
    for (const row of rows) {
      if (row.atMs >= sighting.sightedAtMs) allFutureSnapshots.push(row);
    }
  }
  allFutureSnapshots.sort((a, b) => a.atMs - b.atMs);

  for (const minutes of HORIZON_MINUTES) {
    const endMs = sighting.sightedAtMs + minutes * 60 * 1000;
    const rows = allFutureSnapshots.filter((row) => row.atMs <= endMs);
    const curveValues = rows.map((row) => row.curveProgress);
    const priceRows = rows.filter((row) => Number.isFinite(Number(row.priceSol)));
    const firstPrice = priceRows[0]?.priceSol;
    const maxPrice = stat(priceRows.map((row) => row.priceSol), 12).max;
    const maxPriceDeltaPct = Number.isFinite(Number(firstPrice)) && Number(firstPrice) > 0 && Number.isFinite(Number(maxPrice))
      ? ((Number(maxPrice) - Number(firstPrice)) / Number(firstPrice)) * 100
      : null;
    const first85 = rows.find((row) => Number(row.curveProgress) >= 0.85) || null;
    const first90 = rows.find((row) => Number(row.curveProgress) >= 0.9) || null;
    const first100 = rows.find((row) => Number(row.curveProgress) >= 1) || null;
    windows[`${minutes}m`] = {
      snapshotCount: rows.length,
      maxCurveProgress: stat(curveValues, 6).max,
      maxPriceDeltaPct: numberOrNull(maxPriceDeltaPct, 4),
      crossed85: Boolean(first85),
      crossed90: Boolean(first90),
      migrated: Boolean(first100),
      crossed85AtAgeMs: first85 ? first85.atMs - sighting.sightedAtMs : null,
      crossed90AtAgeMs: first90 ? first90.atMs - sighting.sightedAtMs : null,
      migrationAtAgeMs: first100 ? first100.atMs - sighting.sightedAtMs : null
    };
  }
  return windows;
}

function analyzeActions(sighting, matchedMints, telemetry) {
  const startLookback = sighting.sightedAtMs - LOOKBACK_MINUTES * 60 * 1000;
  const endForward = sighting.sightedAtMs + LOOKFORWARD_MINUTES * 60 * 1000;
  const all = [];
  for (const mint of matchedMints) {
    const rows = telemetry.actionsByMint.get(mint) || [];
    for (const row of rows) {
      if (row.atMs >= startLookback && row.atMs <= endForward) all.push(row);
    }
  }
  all.sort((a, b) => a.atMs - b.atMs);
  const lookback = all.filter((row) => row.atMs <= sighting.sightedAtMs);
  const lookforward = all.filter((row) => row.atMs >= sighting.sightedAtMs);
  const uniqueKindMints = (kind, rows) => new Set(rows.filter((row) => row.kind === kind).map((row) => row.mint)).size;
  return {
    lookbackMatched: {
      actions: lookback.length,
      uniqueMints: distinctMints(lookback).length,
      dryRunWouldSend: uniqueKindMints('dry_run_would_send', lookback),
      paperEntries: uniqueKindMints('paper_entry', lookback),
      paperSkips: uniqueKindMints('paper_skip', lookback),
      skipReasons: countBy(lookback.filter((row) => row.kind === 'paper_skip'), (row) => row.reason)
    },
    lookforwardMatched: {
      actions: lookforward.length,
      uniqueMints: distinctMints(lookforward).length,
      dryRunWouldSend: uniqueKindMints('dry_run_would_send', lookforward),
      dryRunWouldBlock: uniqueKindMints('dry_run_would_block', lookforward),
      paperEntries: uniqueKindMints('paper_entry', lookforward),
      paperSkips: uniqueKindMints('paper_skip', lookforward),
      skipReasons: countBy(lookforward.filter((row) => row.kind === 'paper_skip'), (row) => row.reason)
    },
    sampleActions: all.slice(0, 12)
  };
}

function summarizeRows(rows) {
  const collisionClean = rows.filter((row) => ['exact_mint', 'name_and_symbol', 'symbol_collision_clean'].includes(row.matchTier));
  const clean300 = collisionClean.map((row) => row.outcomeWithinHorizon['300m'] || {});
  const leadTimes = collisionClean.map((row) => row.derivedFlags.leadTimeMinutes).filter(Number.isFinite);
  const cleanCross90 = clean300.filter((row) => row.crossed90).length;
  return {
    sightings: rows.length,
    uniqueSymbols: new Set(rows.map((row) => row.identification.symbolKey).filter(Boolean)).size,
    matchedSightings: rows.filter((row) => row.matchTier !== 'unmatched').length,
    collisionCleanSightings: collisionClean.length,
    matchTierCounts: countBy(rows, (row) => row.matchTier),
    reportTypeCounts: countBy(rows, (row) => row.identification.reportType),
    derivedFlagCounts: countBy(rows, (row) => row.derivedFlags.classification),
    collisionCleanCross90Within300m: cleanCross90,
    collisionCleanCross90Within300mRate: collisionClean.length ? numberOrNull(cleanCross90 / collisionClean.length, 4) : null,
    collisionCleanPaperEntryAfterSighting: collisionClean.filter((row) => row.spectreOverlap.lookforwardMatched.paperEntries > 0).length,
    collisionCleanPaperSkippedAfterSighting: collisionClean.filter((row) => row.spectreOverlap.lookforwardMatched.paperSkips > 0).length,
    medianLeadTimeMinutes: stat(leadTimes, 2).median
  };
}

function buildReport({ rickPath, telemetryPath, dossierPath, rickContext, telemetry, dossierStats }) {
  const sightings = extractRickSightings(rickContext);
  const sightingCollisionCounts = countBy(sightings, (row) => row.symbolKey);
  const rows = sightings.map((sighting) => {
    const candidateRows = telemetry.symbols.get(sighting.symbolKey) || [];
    const exactMintRows = candidateRows.filter((row) => sighting.explicitMints.includes(row.mint));
    const matchedMints = distinctMints(exactMintRows.length ? exactMintRows : candidateRows);
    const collision = {
      symbolSightings: sightingCollisionCounts[sighting.symbolKey] || 0,
      isSpammyTicker: Number(sightingCollisionCounts[sighting.symbolKey] || 0) >= 4,
      distinctMintsForSymbol: distinctMints(candidateRows).length,
      distinctMintsForSymbolSample: distinctMints(candidateRows).slice(0, 8)
    };
    const withCollision = { ...sighting, collision };
    const matchTier = matchedMints.length ? classifyMatch(withCollision, candidateRows, exactMintRows) : 'unmatched';
    const outcomeWithinHorizon = analyzeOutcome(sighting, matchedMints, telemetry);
    const spectreOverlap = analyzeActions(sighting, matchedMints, telemetry);
    const firstSpectreAtMs = Math.min(...candidateRows.map((row) => row.atMs).filter(Number.isFinite));
    const leadTimeMinutes = Number.isFinite(firstSpectreAtMs)
      ? numberOrNull((firstSpectreAtMs - sighting.sightedAtMs) / 60000, 2)
      : null;
    const w300 = outcomeWithinHorizon['300m'] || {};
    const classification = matchedMints.length === 0
      ? 'rick_unmatched'
      : Number.isFinite(leadTimeMinutes) && leadTimeMinutes >= 5
        ? 'rick_lead_observed'
        : Number.isFinite(leadTimeMinutes) && leadTimeMinutes <= -5
          ? 'rick_lag_observed'
          : 'rick_coincident';

    return {
      identification: {
        symbol: sighting.symbol,
        symbolKey: sighting.symbolKey,
        normalizedNameKey: sighting.normalizedNameKey,
        sightedAt: sighting.sightedAt,
        reportType: sighting.reportType,
        ageHint: sighting.ageHint,
        capUsd: sighting.capUsd,
        targetCapUsd: sighting.targetCapUsd,
        explicitMintCount: sighting.explicitMints.length,
        line: sighting.line
      },
      collision,
      matchTier,
      matchedMints,
      matchedMintCount: matchedMints.length,
      spectreOverlap,
      outcomeWithinHorizon,
      derivedFlags: {
        classification,
        leadTimeMinutes,
        crossed90Within300m: Boolean(w300.crossed90),
        maxCurveProgress300m: w300.maxCurveProgress,
        maxPriceDeltaPct300m: w300.maxPriceDeltaPct
      }
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_rick_sighting_follow_through',
    note: 'Joins Rick token mentions to Spectre telemetry/dossiers/actions with explicit match tiers and forward outcomes. Does not alter runtime gates, scoring, AI, sizing, or live broadcast.',
    sources: {
      rickContextPath: rickPath,
      rickGeneratedAt: rickContext.generatedAt || null,
      telemetryPath,
      dossierPath
    },
    inputs: {
      rickMessages: Array.isArray(rickContext.messages) ? rickContext.messages.length : 0,
      rickReportTypeCounts: rickContext.reportTypeCounts || {},
      rickSightings: sightings.length,
      telemetry: {
        startAt: telemetry.startAt,
        endAt: telemetry.endAt,
        malformedLines: telemetry.malformedLines,
        eventCounts: telemetry.eventCounts
      },
      dossiers: dossierStats
    },
    summary: summarizeRows(rows),
    byReportType: Object.fromEntries(
      Object.entries(Object.groupBy ? Object.groupBy(rows, (row) => row.identification.reportType || 'unknown') : rows.reduce((acc, row) => {
        const key = row.identification.reportType || 'unknown';
        acc[key] = acc[key] || [];
        acc[key].push(row);
        return acc;
      }, {})).map(([key, value]) => [key, summarizeRows(value)])
    ),
    rows,
    topCollisionCleanFollowThrough: rows
      .filter((row) => ['exact_mint', 'name_and_symbol', 'symbol_collision_clean'].includes(row.matchTier))
      .sort((a, b) => Number(b.derivedFlags.maxCurveProgress300m || 0) - Number(a.derivedFlags.maxCurveProgress300m || 0))
      .slice(0, 20)
  };
}

function writeReport(outputPath, report) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(OUTPUT_DIR, `rick-sighting-follow-through-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rickPath = repoPath(args.rick) || DEFAULT_RICK_CONTEXT;
  const telemetryPath = repoPath(args.telemetry) || latestFile(/^telemetry-.*\.jsonl$/i);
  const dossierPath = repoPath(args.dossiers) || latestFile(/^candidate-dossiers-.*\.jsonl$/i);
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!rickPath || !fs.existsSync(rickPath)) throw new Error(`Rick context not found: ${rickPath || 'none'}`);
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error(`Telemetry not found: ${telemetryPath || 'none'}`);

  const rickContext = readJson(rickPath, { messages: [], tokenOverlap: [] });
  const telemetry = await readTelemetry(telemetryPath);
  const dossierStats = await readDossiers(dossierPath, telemetry.symbols);
  const report = buildReport({ rickPath, telemetryPath, dossierPath, rickContext, telemetry, dossierStats });
  writeReport(outputPath, report);

  console.log('Rick Sighting Follow-through Report');
  console.log(`Rick context: ${rickPath}`);
  console.log(`Telemetry: ${telemetryPath}`);
  console.log(`Rick sightings / matched / collision-clean: ${report.summary.sightings} / ${report.summary.matchedSightings} / ${report.summary.collisionCleanSightings}`);
  console.log(`Collision-clean cross90 within 300m: ${report.summary.collisionCleanCross90Within300m} (${report.summary.collisionCleanCross90Within300mRate ?? 'n/a'})`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
