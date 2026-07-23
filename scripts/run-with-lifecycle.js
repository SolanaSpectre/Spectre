require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const appendOutcomeSessionEvent = require('./append-outcome-session-event');
const { cleanup, formatBytes, statfsFreeBytes } = require('./cleanup-generated-artifacts');
const { checkPumpPortalFunding } = require('./lib/pumpportal-funding-preflight');

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
let ledgerSnapshotStartOffset = 0;

function runPreRunDiskGuard() {
  if (process.env.SPECTRE_PRE_RUN_CLEANUP_ENABLED === 'false') {
    return;
  }

  const minFreeGb = Number(process.env.SPECTRE_MIN_FREE_GB || 8);
  const beforeFree = statfsFreeBytes(REPO_ROOT);
  console.log(`[lifecycle] pre-run free space: ${formatBytes(beforeFree)}; target >= ${minFreeGb} GB`);

  const result = cleanup({
    dryRun: false,
    archiveRoot: process.env.SPECTRE_ARCHIVE_ROOT || 'C:\\Spectre-archives\\Spectre-clean',
    minFreeGb,
    keepTelemetry: Number(process.env.SPECTRE_KEEP_TELEMETRY_LOGS || 8),
    keepDossiers: Number(process.env.SPECTRE_KEEP_CANDIDATE_DOSSIERS || 8),
    keepStrategyLedgers: Number(process.env.SPECTRE_KEEP_STRATEGY_LEDGERS || 8),
    keepReportDays: Number(process.env.SPECTRE_KEEP_REPORT_DAYS || 2),
    rotateOutcomeLedger: process.env.SPECTRE_ROTATE_OUTCOME_LEDGER === 'true'
  });

  if (result.failures.length > 0) {
    throw new Error(`pre-run cleanup failed for ${result.failures.length} artifact(s)`);
  }

  if (result.enoughFreeSpace === false) {
    throw new Error(`free space remains below ${minFreeGb} GB after cleanup (${formatBytes(result.afterFreeBytes)} available)`);
  }
}

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
    env.SIMPLE_RUNTIME_AI_MODEL = env.SIMPLE_RUNTIME_AI_MODEL || env.RUNTIME_AI_MODEL || env.OLLAMA_MODEL || 'llama3.2:3b';
    env.SIMPLE_RUNTIME_AI_TIMEOUT_MS = env.SIMPLE_RUNTIME_AI_TIMEOUT_MS || env.AI_TIMEOUT_MS || '4000';
    env.SIMPLE_RUNTIME_AI_NUM_PREDICT = env.SIMPLE_RUNTIME_AI_NUM_PREDICT || '80';
    env.SIMPLE_RUNTIME_AI_WARMUP_TIMEOUT_MS = env.SIMPLE_RUNTIME_AI_WARMUP_TIMEOUT_MS || env.AI_WARMUP_TIMEOUT_MS || '90000';
    env.NODE_OPTIONS = String(env.NODE_OPTIONS || '').includes('simple-runtime-ai-patch.js')
      ? env.NODE_OPTIONS
      : `${env.NODE_OPTIONS || ''} ${preload}`.trim();
  }
  return env;
}

function readLedgerEvents() {
  const ledgerPath = getLedgerPath();
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return [];

  const events = [];
  forEachLedgerEvent(ledgerPath, (event) => events.push(event));
  return events;
}

async function runPreRunProviderGuards() {
  const result = await checkPumpPortalFunding();
  if (result.status === 'PASS') {
    console.log(
      `[lifecycle] PumpPortal funding preflight: ${result.addressLabel} has `
      + `${result.balanceSol.toFixed(6)} SOL; target >= ${result.requiredBalanceSol.toFixed(6)} SOL`
    );
    return result;
  }

  if (result.status === 'SKIPPED_NO_PUBLIC_WALLET_ADDRESS') {
    console.warn(
      '[lifecycle] PumpPortal funding preflight skipped: '
      + 'set the public PUMPPORTAL_FUNDED_WALLET_ADDRESS to protect paid-tape runs'
    );
  }
  return result;
}

function forEachLedgerEvent(ledgerPath, onEvent, startOffset = 0) {
  if (!ledgerPath || !fs.existsSync(ledgerPath)) return 0;

  const fd = fs.openSync(ledgerPath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let carry = '';
  let count = 0;
  let position = Math.max(0, Number(startOffset) || 0);

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;

      carry += buffer.toString('utf8', 0, bytesRead);
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() || '';

      for (const line of lines) {
        if (!line) continue;
        try {
          const event = JSON.parse(line.replace(/^\uFEFF/, ''));
          if (event) {
            onEvent(event);
            count += 1;
          }
        } catch {
          // Ignore malformed rows so an interrupted append cannot break shutdown.
        }
      }
    }

    if (carry.trim()) {
      try {
        const event = JSON.parse(carry.replace(/^\uFEFF/, ''));
        if (event) {
          onEvent(event);
          count += 1;
        }
      } catch {
        // Ignore a partial final row from an interrupted append.
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return count;
}

function paperPositionKey(event) {
  const preset = event?.paper?.preset || event?.preset || 'default';
  return `${event.mint}:${preset}`;
}

function buildOpenPaperPositions(events) {
  const open = new Map();

  for (const event of events) {
    applyOpenPaperPositionEvent(open, event);
  }

  return Array.from(open.values());
}

function applyOpenPaperPositionEvent(open, event) {
  if (!event?.mint || String(event.mint).startsWith('SESSION:')) return;

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
    return;
  }

  if (event.kind === 'paper.exit') {
    open.delete(paperPositionKey(event));
    return;
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

function buildOpenPaperPositionsFromLedger() {
  const open = new Map();
  const ledgerPath = getLedgerPath();
  forEachLedgerEvent(ledgerPath, (event) => applyOpenPaperPositionEvent(open, event), ledgerSnapshotStartOffset);
  return Array.from(open.values());
}

function rememberLedgerSnapshotStartOffset() {
  const ledgerPath = getLedgerPath();
  if (!ledgerPath || !fs.existsSync(ledgerPath)) {
    ledgerSnapshotStartOffset = 0;
    return;
  }

  ledgerSnapshotStartOffset = fs.statSync(ledgerPath).size;
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
    const positions = buildOpenPaperPositionsFromLedger();
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

async function main() {
  process.on('SIGINT', () => markInterrupted('SIGINT'));
  process.on('SIGTERM', () => markInterrupted('SIGTERM'));

  try {
    runPreRunDiskGuard();
  } catch (error) {
    console.error(`[lifecycle] disk guard blocked run: ${error.message}`);
    write('session.interrupted', {
      reason: `DISK_GUARD:${error.message}`,
      interruptedAt: new Date().toISOString(),
      shutdownClean: false
    });
    process.exitCode = 1;
    return;
  }

  try {
    await runPreRunProviderGuards();
  } catch (error) {
    console.error(`[lifecycle] provider guard blocked run: ${error.message}`);
    write('session.interrupted', {
      reason: `PUMPPORTAL_FUNDING_GUARD:${error.message}`,
      interruptedAt: new Date().toISOString(),
      shutdownClean: false
    });
    process.exitCode = 1;
    return;
  }

  write('session.started', {
    reason: 'RUN_START',
    startedAt: new Date().toISOString(),
    shutdownClean: null
  });
  rememberLedgerSnapshotStartOffset();

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
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[lifecycle] pre-run lifecycle failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, runPreRunDiskGuard, runPreRunProviderGuards };
