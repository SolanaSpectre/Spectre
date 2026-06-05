#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-same-mint-reentry-impact-latest.json');
const DEFAULT_MAX_FILES = 24;
const DEFAULT_COOLDOWN_MS = Number(process.env.PRE_MIGRATION_PAPER_SAME_MINT_REENTRY_COOLDOWN_MS || 120000);

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

function telemetryFiles(maxFiles = DEFAULT_MAX_FILES) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((item) => item.filePath)
    .reverse();
}

function payloadOf(event) {
  return event.payload || event.data || {};
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

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function entryKey(row) {
  return `${row.telemetryPath}:${row.mint}:${row.profileName || ''}:${row.entryPriceSol || ''}`;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function stats(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, sum: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: num(finite[0], digits),
    median: num(pick(0.5), digits),
    p90: num(pick(0.9), digits),
    max: num(finite[finite.length - 1], digits),
    sum: num(sum, digits),
    avg: num(sum / finite.length, digits)
  };
}

async function readTelemetry(filePath) {
  const entries = [];
  const exits = [];
  const cooldownSkips = [];
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
    const type = event.type || event.event;
    if (!['pre_migration_paper.entry', 'pre_migration_paper.exit', 'pre_migration_paper.decision'].includes(type)) continue;

    const payload = payloadOf(event);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    const mint = mintOf(payload);
    if (!mint || !Number.isFinite(atMs)) continue;
    startMs = Math.min(startMs, atMs);
    endMs = Math.max(endMs, atMs);

    if (type === 'pre_migration_paper.entry') {
      entries.push({
        telemetryPath: filePath,
        mint,
        symbol: payload.symbol || null,
        atMs,
        at: new Date(atMs).toISOString(),
        preset: payload.preset || null,
        lane: payload.lane || null,
        profileName: payload.profileName || null,
        score: num(payload.score, 2),
        curveProgress: num(payload.curveProgress, 6),
        entryPriceSol: num(payload.entryPriceSol, 15),
        amountSol: num(payload.amountSol, 6)
      });
    } else if (type === 'pre_migration_paper.exit') {
      exits.push({
        telemetryPath: filePath,
        mint,
        symbol: payload.symbol || null,
        atMs,
        at: new Date(atMs).toISOString(),
        preset: payload.preset || null,
        lane: payload.lane || null,
        profileName: payload.profileName || null,
        entryPriceSol: num(payload.entryPriceSol, 15),
        exitPriceSol: num(payload.exitPriceSol, 15),
        reason: payload.reason || payload.exitReason || null,
        pnlSol: num(payload.pnlSol, 9),
        returnPct: num(payload.returnPct, 6),
        holdSeconds: num(payload.holdSeconds, 2)
      });
    } else if (payload.reason === 'RECENT_SAME_MINT_EXIT_COOLDOWN') {
      cooldownSkips.push({
        telemetryPath: filePath,
        mint,
        symbol: payload.symbol || null,
        atMs,
        at: new Date(atMs).toISOString(),
        preset: payload.preset || null,
        remainingMs: num(payload.sameMintCooldownRemainingMs, 0),
        until: payload.sameMintCooldownUntil || null,
        previousReason: payload.sameMintCooldownReason || null,
        previousPreset: payload.sameMintCooldownPreset || null
      });
    }
  }

  return {
    filePath,
    malformedLines,
    startAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    endAt: Number.isFinite(endMs) ? new Date(endMs).toISOString() : null,
    entries,
    exits,
    cooldownSkips
  };
}

function analyzeRows(rows, cooldownMs) {
  const entries = rows.flatMap((row) => row.entries).sort((a, b) => a.atMs - b.atMs);
  const exits = rows.flatMap((row) => row.exits).sort((a, b) => a.atMs - b.atMs);
  const exitByEntryKey = new Map(exits.map((exit) => [entryKey(exit), exit]));
  const priorExitsByMint = new Map();
  const reentries = [];

  for (const entry of entries) {
    const priorExits = priorExitsByMint.get(entry.mint) || [];
    const previousExit = [...priorExits].reverse().find((exit) => exit.atMs < entry.atMs);
    const gapMs = previousExit ? entry.atMs - previousExit.atMs : null;
    const exit = exitByEntryKey.get(entryKey(entry)) || null;
    if (previousExit && gapMs >= 0 && gapMs <= cooldownMs) {
      reentries.push({
        ...entry,
        gapMs,
        gapSeconds: num(gapMs / 1000, 2),
        previousExit: {
          at: previousExit.at,
          preset: previousExit.preset,
          profileName: previousExit.profileName,
          reason: previousExit.reason,
          pnlSol: previousExit.pnlSol,
          returnPct: previousExit.returnPct,
          holdSeconds: previousExit.holdSeconds
        },
        exit: exit ? {
          at: exit.at,
          reason: exit.reason,
          pnlSol: exit.pnlSol,
          returnPct: exit.returnPct,
          holdSeconds: exit.holdSeconds
        } : null
      });
    }
    const entryExit = exitByEntryKey.get(entryKey(entry));
    if (entryExit) {
      const list = priorExitsByMint.get(entry.mint) || [];
      list.push(entryExit);
      priorExitsByMint.set(entry.mint, list);
    }
  }

  const reentryPnl = reentries.map((row) => row.exit?.pnlSol);
  const blockedHistoricalPnlSol = reentryPnl.reduce((sum, value) => (
    Number.isFinite(Number(value)) ? sum + Number(value) : sum
  ), 0);

  return {
    entries,
    exits,
    reentries,
    summary: {
      telemetryFiles: rows.length,
      malformedLines: rows.reduce((sum, row) => sum + Number(row.malformedLines || 0), 0),
      cooldownMs,
      totalEntries: entries.length,
      totalExits: exits.length,
      reentryWithinCooldown: reentries.length,
      reentryUniqueMints: new Set(reentries.map((row) => row.mint)).size,
      reentryPnlSol: num(blockedHistoricalPnlSol, 9),
      reentryPnlStats: stats(reentryPnl, 9),
      reentryWinLoss: {
        wins: reentries.filter((row) => Number(row.exit?.pnlSol) > 0).length,
        losses: reentries.filter((row) => Number(row.exit?.pnlSol) < 0).length,
        flatOrMissing: reentries.filter((row) => !Number.isFinite(Number(row.exit?.pnlSol)) || Number(row.exit?.pnlSol) === 0).length
      },
      reentryByPreviousExitReason: countBy(reentries, (row) => row.previousExit?.reason),
      reentryByEntryProfile: countBy(reentries, (row) => row.profileName),
      observedCooldownSkips: rows.reduce((sum, row) => sum + row.cooldownSkips.length, 0)
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cooldownMs = Number(args.cooldownMs || DEFAULT_COOLDOWN_MS);
  const explicitTelemetry = args.telemetry ? [repoPath(args.telemetry)] : [];
  const files = explicitTelemetry.length
    ? explicitTelemetry
    : telemetryFiles(Number(args.maxFiles || DEFAULT_MAX_FILES));
  const rows = [];
  for (const filePath of files) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    rows.push(await readTelemetry(filePath));
  }

  const analyzed = analyzeRows(rows, Number.isFinite(cooldownMs) ? cooldownMs : DEFAULT_COOLDOWN_MS);
  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_same_mint_reentry_impact',
    note: 'Estimates historical impact of the paper-only same-mint re-entry cooldown. Negative reentryPnlSol means the cooldown would have avoided losses in the scanned telemetry.',
    inputs: {
      telemetryFiles: files.map((filePath) => path.relative(ROOT, filePath)),
      cooldownMs: analyzed.summary.cooldownMs
    },
    summary: analyzed.summary,
    topReentries: analyzed.reentries
      .sort((a, b) => Number(a.exit?.pnlSol || 0) - Number(b.exit?.pnlSol || 0))
      .slice(0, 20)
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
