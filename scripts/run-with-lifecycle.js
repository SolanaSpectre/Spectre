require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const appendOutcomeSessionEvent = require('./append-outcome-session-event');

const REPO_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const DEFAULT_LEDGER_PATH = path.join(REPO_ROOT, 'data', 'outcomes', 'outcome-ledger.jsonl');
const sessionId = `run_${Date.now()}`;
process.env.SPECTRE_SESSION_ID = sessionId;

let child = null;
let interrupted = false;
let wroteInterrupted = false;
let paperSnapshotTimer = null;
let lastSnapshotSignature = '';

function write(kind, meta = {}) {
  try {
    appendOutcomeSessionEvent(kind, {
      sessionId,
      source: 'run_lifecycle_wrapper',
      mode: process.env.EXECUTION_MODE || null,
      ...meta
    });
  } catch (error) {
    console.warn(`[WARN] failed to write ${kind}: ${error.message}`);
  }
}

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function getLedgerPath() {
  return resolveRepoPath(process.env.OUTCOME_LEDGER_FILE_PATH, DEFAULT_LEDGER_PATH);
}

function buildChildEnv() {
  const env = { ...process.env };
  if (env.SIMPLE_RUNTIME_AI_ENABLED !== 'false') {
    const preload = '--require ./src/simple-runtime-ai-patch.js';
    env.SIMPLE_RUNTIME_AI_ENABLED = env.SIMPLE_RUNTIME_AI_ENABLED || 'true';
    env.SIMPLE_RUNTIME_AI_MODEL = env.SIMPLE_RUNTIME_AI_MODEL || env.RUNTIME_AI_MODEL || 'llama3.2:3b';
    env.SIMPLE_RUNTIME_AI_TIMEOUT_MS = env.SIMPLE_RUNTIME_AI_TIMEOUT_MS || env.AI_TIMEOUT_MS || '4000';
    env.SIMPLE_RUNTIME_AI_NUM_PREDICT = env.SIMPLE_RUNTIME_AI_NUM_PREDICT || '80';
    env.NODE_OPTIONS = String(env.NODE_OPTIONS || '').includes('simple-runtime-ai-patch.js')
      ? env.NODE_OPTIONS
      : `${env.NODE_OPTIONS || ''} ${preload}`.trim();
  }
  return env;
}

function readLedgerEvents() {
  const ledgerPath = getLedgerPath();
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return [];

  return fs.readFileSync(ledgerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function paperPositionKey(event) {
  const preset = event?.paper?.preset || event?.preset || 'default';
  return `${event.mint}:${preset}`;
}

function buildOpenPaperPositions(events) {
  const open = new Map();

  for (const event of events) {
    if (!event?.mint || String(event.mint).startsWith('SESSION:')) continue;

    if (event.kind === 'paper.entry') {
      open.set(paperPositionKey(event), {
        mint: event.mint,
        symbol: event.symbol || null,
        name: event.name || null,
        entryAt: event.timestamp || null,
        lastSeenAt: event.timestamp || null,
        score: event.score ?? null,
        curveProgress: event.curveProgress ?? null,
        priceSol: event.priceSol ?? event.paper?.entryPriceSol ?? null,
        market: event.market || {},
        paper: event.paper || {}
      });
      continue;
    }

    if (event.kind === 'paper.exit') {
      open.delete(paperPositionKey(event));
      continue;
    }

    if (['paper.open_snapshot', 'paper.eligible', 'paper.skipped', 'paper.near_miss'].includes(event.kind)) {
      const key = paperPositionKey(event);
      const existing = open.get(key);
      if (existing) {
        open.set(key, {
          ...existing,
          lastSeenAt: event.timestamp || existing.lastSeenAt,
          score: event.score ?? existing.score,
          curveProgress: event.curveProgress ?? existing.curveProgress,
          priceSol: event.priceSol ?? existing.priceSol,
          market: { ...existing.market, ...(event.market || {}) },
          paper: { ...existing.paper, ...(event.paper || {}) }
        });
      }
    }
  }

  return Array.from(open.values());
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 1000));
}

function appendPaperSnapshotEvent(position, reason) {
  const ledgerPath = getLedgerPath();
  if (!ledgerPath) return;

  const now = new Date().toISOString();
  const holdSeconds = secondsBetween(position.entryAt, now);
  const event = {
    schemaVersion: 1,
    timestamp: now,
    kind: 'paper.open_snapshot',
    source: 'run_lifecycle_wrapper',
    stage: 'paper',
    sessionId,
    mint: position.mint,
    symbol: position.symbol || null,
    name: position.name || null,
    decision: 'PAPER_OPEN_SNAPSHOT',
    reason,
    score: position.score ?? null,
    curveProgress: position.curveProgress ?? null,
    priceSol: position.priceSol ?? null,
    market: position.market || {},
    paper: {
      ...(position.paper || {}),
      entryAt: position.entryAt || null,
      lastSeenAt: position.lastSeenAt || null,
      holdSeconds
    }
  };

  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
}

function snapshotOpenPaperPositions(reason = 'PERIODIC_SNAPSHOT') {
  try {
    const positions = buildOpenPaperPositions(readLedgerEvents());
    const signature = positions
      .map((position) => `${position.mint}:${position.paper?.preset || 'default'}:${position.lastSeenAt || ''}`)
      .sort()
      .join('|');

    if (!positions.length || signature === lastSnapshotSignature && reason === 'PERIODIC_SNAPSHOT') {
      return;
    }

    lastSnapshotSignature = signature;
    positions.forEach((position) => appendPaperSnapshotEvent(position, reason));
  } catch (error) {
    console.warn(`[WARN] failed to snapshot open paper positions: ${error.message}`);
  }
}

function startPaperSnapshotTimer() {
  const intervalMs = Number(process.env.PAPER_POSITION_SNAPSHOT_INTERVAL_MS || 60000);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;

  paperSnapshotTimer = setInterval(() => snapshotOpenPaperPositions('PERIODIC_SNAPSHOT'), intervalMs);
  if (typeof paperSnapshotTimer.unref === 'function') {
    paperSnapshotTimer.unref();
  }
}

function stopPaperSnapshotTimer() {
  if (paperSnapshotTimer) {
    clearInterval(paperSnapshotTimer);
    paperSnapshotTimer = null;
  }
}

function markInterrupted(signal) {
  interrupted = true;
  snapshotOpenPaperPositions('INTERRUPTED_SNAPSHOT');
  if (!wroteInterrupted) {
    wroteInterrupted = true;
    write('session.interrupted', {
      reason: signal,
      signal,
      interruptedAt: new Date().toISOString(),
      shutdownClean: false
    });
  }

  if (child && !child.killed) {
    child.kill(signal);
  }
}

process.on('SIGINT', () => markInterrupted('SIGINT'));
process.on('SIGTERM', () => markInterrupted('SIGTERM'));

write('session.started', {
  reason: 'RUN_START',
  startedAt: new Date().toISOString(),
  shutdownClean: null
});

startPaperSnapshotTimer();

child = spawn(NODE, [path.join('scripts', 'run-with-context-and-reports.js'), ...process.argv.slice(2)], {
  cwd: REPO_ROOT,
  env: buildChildEnv(),
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (error) => {
  snapshotOpenPaperPositions('SPAWN_ERROR_SNAPSHOT');
  stopPaperSnapshotTimer();
  write('session.interrupted', {
    reason: `SPAWN_ERROR:${error.message}`,
    interruptedAt: new Date().toISOString(),
    shutdownClean: false
  });
  process.exitCode = 1;
});

child.on('close', (code, signal) => {
  stopPaperSnapshotTimer();
  snapshotOpenPaperPositions('FINAL_SNAPSHOT');

  const exitCode = Number.isFinite(code) ? code : interrupted ? 130 : 1;
  if (signal && !wroteInterrupted) {
    wroteInterrupted = true;
    write('session.interrupted', {
      reason: `CHILD_SIGNAL:${signal}`,
      signal,
      interruptedAt: new Date().toISOString(),
      shutdownClean: false
    });
  }

  write('session.stopped', {
    reason: signal || `EXIT_${exitCode}`,
    stoppedAt: new Date().toISOString(),
    shutdownClean: exitCode === 0 && !interrupted && !signal,
    botExitCode: exitCode,
    signal: signal || null
  });

  process.exitCode = exitCode;
});
