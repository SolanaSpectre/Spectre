require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const path = require('path');
const { POST_RUN_REPORTS } = require('./post-run-report-plan');

const REPO_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const DEFAULT_REPORT_TIMEOUT_MS = Number(process.env.POST_RUN_REPORT_TIMEOUT_MS || 120000);
const REPORT_NODE_OPTIONS = String(process.env.POST_RUN_NODE_OPTIONS || '--max-old-space-size=8192').trim();
const SKIPPED_REPORTS = new Set(
  String(process.env.POST_RUN_SKIP_REPORTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

function buildReportEnv() {
  if (!REPORT_NODE_OPTIONS) return process.env;
  const existing = String(process.env.NODE_OPTIONS || '').trim();
  const nodeOptions = existing.includes(REPORT_NODE_OPTIONS)
    ? existing
    : `${existing} ${REPORT_NODE_OPTIONS}`.trim();
  return { ...process.env, NODE_OPTIONS: nodeOptions };
}

function reportTimeoutMs(report) {
  const timeout = Number(report.timeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS);
  return Number.isFinite(timeout) ? timeout : DEFAULT_REPORT_TIMEOUT_MS;
}

function runReport(report) {
  const { title, script } = report;
  return new Promise((resolve) => {
    console.log(`\n=== ${title} ===`);
    let settled = false;
    let timeoutTimer = null;
    const timeoutMs = reportTimeoutMs(report);
    const child = spawn(NODE, [path.join('scripts', script)], {
      cwd: REPO_ROOT,
      env: buildReportEnv(),
      stdio: 'inherit',
      windowsHide: false
    });

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve(code || 0);
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        console.warn(`[WARN] ${title} exceeded report timeout (${Math.round(timeoutMs / 1000)}s); terminating and continuing.`);
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true
            });
          } else {
            child.kill('SIGTERM');
          }
        } catch {}
        finish(1);
      }, timeoutMs);
      if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
    }

    child.on('error', (error) => {
      console.warn(`[WARN] ${title} failed to start: ${error.message}`);
      finish(1);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[WARN] ${title} exited with code ${code}; continuing.`);
      }
      finish(code || 0);
    });
  });
}

async function main() {
  let failures = 0;
  for (const report of POST_RUN_REPORTS) {
    if (SKIPPED_REPORTS.has(report.script) || SKIPPED_REPORTS.has(report.title)) {
      console.log(`\n=== ${report.title} ===`);
      console.log(`[SKIP] ${report.script} skipped by POST_RUN_SKIP_REPORTS`);
      continue;
    }
    const code = await runReport(report);
    if (code !== 0) failures += 1;
  }

  if (failures > 0) {
    console.warn(`Post-run reports completed with ${failures} warning(s).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
