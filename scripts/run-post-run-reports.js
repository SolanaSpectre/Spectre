if (process.env.SPECTRE_SKIP_DOTENV !== 'true') {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
}

const { spawn } = require('child_process');
const path = require('path');
const {
  normalizeReportProfile,
  reportsForProfile
} = require('./post-run-report-plan');
const {
  buildReportArgs,
  inspectReportArtifact,
  writeReportLedger
} = require('./lib/post-run-report-ledger');
const { latestTelemetryFile } = require('./lib/report-telemetry');

const REPO_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const DEFAULT_REPORT_TIMEOUT_MS = Number(process.env.POST_RUN_REPORT_TIMEOUT_MS || 180000);
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

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    profile: process.env.POST_RUN_REPORT_PROFILE || 'decisive',
    telemetryPath: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      options.profile = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length);
    } else if (arg === '--telemetry') {
      options.telemetryPath = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--telemetry=')) {
      options.telemetryPath = arg.slice('--telemetry='.length);
    }
  }
  options.profile = normalizeReportProfile(options.profile);
  options.telemetryPath = options.telemetryPath
    ? path.resolve(REPO_ROOT, options.telemetryPath)
    : latestTelemetryFile(REPO_ROOT);
  return options;
}

function runReport(report, telemetryPath) {
  const { title, script } = report;
  return new Promise((resolve) => {
    console.log(`\n=== ${title} ===`);
    const startedAtMs = Date.now();
    let settled = false;
    let timeoutTimer = null;
    const timeoutMs = reportTimeoutMs(report);
    const child = spawn(NODE, [
      path.join('scripts', script),
      ...buildReportArgs(report, telemetryPath)
    ], {
      cwd: REPO_ROOT,
      env: buildReportEnv(),
      stdio: 'inherit',
      windowsHide: false
    });

    const finish = (code, timedOut = false) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const finishedAtMs = Date.now();
      resolve({
        code: Number.isFinite(Number(code)) ? Number(code) : 1,
        timedOut,
        startedAtMs,
        finishedAtMs,
        durationMs: finishedAtMs - startedAtMs
      });
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
        finish(124, true);
      }, timeoutMs);
      if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
    }

    child.on('error', (error) => {
      console.warn(`[WARN] ${title} failed to start: ${error.message}`);
      finish(1);
    });

    child.on('close', (code, signal) => {
      const exitCode = Number.isFinite(code) ? code : 1;
      if (signal) {
        console.warn(`[WARN] ${title} exited from signal ${signal}.`);
      }
      if (exitCode !== 0) {
        console.warn(`[WARN] ${title} exited with code ${exitCode}; continuing.`);
      }
      finish(exitCode);
    });
  });
}

async function main() {
  const options = parseArgs();
  if (!options.telemetryPath) {
    throw new Error('No telemetry file is available for post-run reporting.');
  }
  const reports = reportsForProfile(options.profile);
  const startedAt = new Date().toISOString();
  const ledger = {
    schemaVersion: 1,
    mode: 'post_run_report_execution_ledger',
    profile: options.profile,
    telemetryPath: path.relative(REPO_ROOT, options.telemetryPath).replace(/\\/g, '/'),
    startedAt,
    finishedAt: null,
    durationMs: null,
    status: 'RUNNING',
    currentReport: null,
    reports: []
  };
  const persistLedger = () => writeReportLedger(REPO_ROOT, ledger);
  persistLedger();

  let failures = 0;
  let requiredFailures = 0;
  for (const report of reports) {
    if (SKIPPED_REPORTS.has(report.script) || SKIPPED_REPORTS.has(report.title)) {
      console.log(`\n=== ${report.title} ===`);
      console.log(`[SKIP] ${report.script} skipped by POST_RUN_SKIP_REPORTS`);
      ledger.reports.push({
        title: report.title,
        script: report.script,
        tier: report.tier,
        status: 'SKIPPED',
        exitCode: null,
        durationMs: 0
      });
      persistLedger();
      continue;
    }
    ledger.currentReport = {
      title: report.title,
      script: report.script,
      startedAt: new Date().toISOString()
    };
    persistLedger();
    const result = await runReport(report, options.telemetryPath);
    const artifact = inspectReportArtifact(
      REPO_ROOT,
      report,
      options.telemetryPath,
      result.startedAtMs
    );
    const artifactPassed = ['CURRENT', 'NOT_DECLARED'].includes(artifact.status);
    const passed = result.code === 0 && artifactPassed;
    const row = {
      title: report.title,
      script: report.script,
      tier: report.tier,
      required: report.required === true,
      status: result.timedOut ? 'TIMED_OUT' : passed ? 'PASSED' : 'FAILED',
      exitCode: result.code,
      startedAt: new Date(result.startedAtMs).toISOString(),
      finishedAt: new Date(result.finishedAtMs).toISOString(),
      durationMs: result.durationMs,
      artifact
    };
    ledger.reports.push(row);
    ledger.currentReport = null;
    if (!passed) {
      failures += 1;
      if (report.required === true) requiredFailures += 1;
    }
    persistLedger();
    if (!passed && report.required === true) break;
  }

  ledger.finishedAt = new Date().toISOString();
  ledger.durationMs = Date.parse(ledger.finishedAt) - Date.parse(ledger.startedAt);
  ledger.status = requiredFailures > 0
    ? 'FAILED'
    : failures > 0
      ? 'COMPLETED_WITH_WARNINGS'
      : 'PASSED';
  const ledgerFiles = persistLedger();
  console.log(`Post-run ${options.profile} ledger: ${ledgerFiles.latestPath}`);
  if (requiredFailures > 0) {
    throw new Error(`Post-run ${options.profile} required reports failed (${requiredFailures}).`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main, parseArgs, reportTimeoutMs, runReport };
