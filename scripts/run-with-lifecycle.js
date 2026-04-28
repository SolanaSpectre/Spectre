require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const path = require('path');
const appendOutcomeSessionEvent = require('./append-outcome-session-event');

const REPO_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const sessionId = `run_${Date.now()}`;
process.env.SPECTRE_SESSION_ID = sessionId;

let child = null;
let interrupted = false;
let wroteInterrupted = false;

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

function markInterrupted(signal) {
  interrupted = true;
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

child = spawn(NODE, [path.join('scripts', 'run-with-context-and-reports.js'), ...process.argv.slice(2)], {
  cwd: REPO_ROOT,
  env: process.env,
  stdio: 'inherit',
  windowsHide: false
});

child.on('error', (error) => {
  write('session.interrupted', {
    reason: `SPAWN_ERROR:${error.message}`,
    interruptedAt: new Date().toISOString(),
    shutdownClean: false
  });
  process.exitCode = 1;
});

child.on('close', (code, signal) => {
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
