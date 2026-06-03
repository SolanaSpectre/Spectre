require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { POST_RUN_REPORTS } = require('./post-run-report-plan');

const REPO_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const DEFAULT_RICK_STATE_PATH = path.join(REPO_ROOT, 'data', 'rick-context', 'command-state.json');
const DEFAULT_RICK_CONTEXT_PATH = path.join(REPO_ROOT, 'data', 'rick-context', 'latest.json');
const RUN_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const REPORT_NODE_OPTIONS = String(process.env.POST_RUN_NODE_OPTIONS || '--max-old-space-size=8192').trim();
const SKIPPED_POST_RUN_REPORTS = new Set(
  String(process.env.POST_RUN_SKIP_REPORTS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

const DEFAULT_RICK_COMMANDS = ['vol', 'runners', 'dt', 'pft', 'burp'];
const DEFAULT_RICK_REPLY_WAIT_MS = 10000;
const DEFAULT_RICK_COMMAND_DELAY_MS = 1000;
const RICK_COMMAND_TEXT = {
  vol: '/vol',
  runners: '/runners@rick',
  dt: '/dt@rick',
  pft: '/pft@rick',
  burp: '/burp@rick'
};

let activeChild = null;
let interrupted = false;

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toList(value, fallback) {
  const raw = String(value || '').trim();
  if (!raw) {
    return fallback;
  }

  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function fileExists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function latestTelemetrySignature() {
  if (!fs.existsSync(RUN_LOG_DIR)) return null;
  const latest = fs.readdirSync(RUN_LOG_DIR)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(RUN_LOG_DIR, name);
      const stat = fs.statSync(fullPath);
      return { name, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return latest ? `${latest.name}:${latest.mtimeMs}:${latest.size}` : null;
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLifecycleArgs(argv) {
  const botArgs = [];
  const options = {
    skipContext: toBool(process.env.SKIP_PRE_RUN_CONTEXT, false),
    skipReports: toBool(process.env.SKIP_POST_RUN_REPORTS, false),
    telegramSyncMode: String(process.env.PRE_RUN_TELEGRAM_SYNC_MODE || 'if_missing').trim().toLowerCase(),
    telegramContextPath: resolveRepoPath(process.env.TELEGRAM_CONTEXT_FILE_PATH, path.join(REPO_ROOT, 'data', 'telegram-context', 'latest.json')),
    rickCommands: toList(process.env.PRE_RUN_RICK_COMMANDS, DEFAULT_RICK_COMMANDS),
    rickReplyWaitMs: toNumber(process.env.PRE_RUN_RICK_REPLY_WAIT_MS, DEFAULT_RICK_REPLY_WAIT_MS),
    rickCommandDelayMs: toNumber(process.env.PRE_RUN_RICK_COMMAND_DELAY_MS, DEFAULT_RICK_COMMAND_DELAY_MS),
    rickCooldownHours: toNumber(process.env.RICK_COMMAND_COOLDOWN_HOURS, 4),
    rickStatePath: resolveRepoPath(process.env.RICK_COMMAND_STATE_FILE_PATH, DEFAULT_RICK_STATE_PATH),
    rickContextPath: resolveRepoPath(process.env.RICK_CONTEXT_PATH, DEFAULT_RICK_CONTEXT_PATH),
    rickTargetChatName: String(process.env.RICK_COMMAND_TARGET_CHAT_NAME || 'weRvENum').trim(),
    forceRick: toBool(process.env.PRE_RUN_RICK_FORCE, false)
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--skipContext') {
      options.skipContext = true;
      continue;
    }

    if (arg === '--skipReports') {
      options.skipReports = true;
      continue;
    }

    if (arg === '--forceRick') {
      options.forceRick = true;
      continue;
    }

    if (arg === '--rickCommands') {
      options.rickCommands = toList(argv[index + 1], DEFAULT_RICK_COMMANDS);
      index += 1;
      continue;
    }

    if (arg === '--rickReplyWaitMs') {
      options.rickReplyWaitMs = toNumber(argv[index + 1], DEFAULT_RICK_REPLY_WAIT_MS);
      index += 1;
      continue;
    }

    if (arg === '--rickCommandDelayMs') {
      options.rickCommandDelayMs = toNumber(argv[index + 1], DEFAULT_RICK_COMMAND_DELAY_MS);
      index += 1;
      continue;
    }

    botArgs.push(arg);
  }

  return {
    botArgs,
    options
  };
}

function printSection(title) {
  console.log('');
  console.log(`========== ${title} ==========`);
}

function killProcessTree(child) {
  if (!child || !child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
    killer.on('error', () => {});
    return;
  }

  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }, 5000).unref?.();
}

function runProcess(title, command, args, { allowFailure = false, timeoutMs = 0, timeoutExitCode = 0, env = process.env } = {}) {
  printSection(title);
  console.log(`> ${[command, ...args].join(' ')}`);

  return new Promise((resolve, reject) => {
    let timedOut = false;
    let timeoutTimer = null;
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: 'inherit',
      windowsHide: false
    });

    activeChild = child;

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        console.warn(`[WARN] ${title} exceeded wall-clock timeout (${Math.round(timeoutMs / 1000)}s); terminating child process tree.`);
        killProcessTree(child);
      }, timeoutMs);
    }

    child.on('error', (error) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      activeChild = null;
      if (allowFailure) {
        console.warn(`[WARN] ${title} failed to start: ${error.message}`);
        resolve(1);
        return;
      }
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      activeChild = null;

      if (timedOut) {
        console.warn(`[WARN] ${title} was stopped by lifecycle timeout; continuing with post-run reports.`);
        resolve(timeoutExitCode);
        return;
      }

      const exitCode = Number.isFinite(code) ? code : 1;

      if (signal) {
        console.warn(`[WARN] ${title} exited from signal ${signal}`);
      }

      if (exitCode !== 0 && !allowFailure) {
        reject(new Error(`${title} exited with code ${exitCode}`));
        return;
      }

      if (exitCode !== 0 && allowFailure) {
        console.warn(`[WARN] ${title} exited with code ${exitCode}; continuing.`);
      }

      resolve(exitCode);
    });
  });
}

function runNode(title, script, args = [], options = {}) {
  return runProcess(title, NODE, [path.join('scripts', script), ...args], options);
}

function buildPostRunReportEnv() {
  if (!REPORT_NODE_OPTIONS) return process.env;
  const existing = String(process.env.NODE_OPTIONS || '').trim();
  const nodeOptions = existing.includes(REPORT_NODE_OPTIONS)
    ? existing
    : `${existing} ${REPORT_NODE_OPTIONS}`.trim();
  return { ...process.env, NODE_OPTIONS: nodeOptions };
}

function getBotSessionTimeoutMs(botArgs) {
  const positional = [];
  let sessionValue = null;

  for (let index = 0; index < botArgs.length; index += 1) {
    const arg = botArgs[index];
    if (arg === '--session') {
      sessionValue = botArgs[index + 1];
      index += 1;
      continue;
    }

    if (!String(arg).startsWith('--')) {
      positional.push(arg);
    }
  }

  if (!sessionValue && positional[1]) {
    sessionValue = positional[1];
  }

  if (!sessionValue && positional[0]) {
    const compactPaperMatch = String(positional[0]).match(/^PAPER(\d+)$/i);
    if (compactPaperMatch) {
      sessionValue = compactPaperMatch[1];
    }
  }

  const sessionMinutes = Number(sessionValue || process.env.SESSION_DURATION_MINUTES || 0);
  if (!Number.isFinite(sessionMinutes) || sessionMinutes <= 0) {
    return 0;
  }

  const graceMs = toNumber(process.env.BOT_SESSION_TIMEOUT_GRACE_MS, 10 * 60 * 1000);
  return Math.ceil(sessionMinutes * 60 * 1000 + Math.max(0, graceMs));
}

function getRickCooldownKey(targetChatName, commandText) {
  return `${targetChatName.toLowerCase()}::${commandText.toLowerCase()}`;
}

function getRickCooldown(commandKey, options) {
  if (options.forceRick) return { active: false, remainingMinutes: 0, commandText: RICK_COMMAND_TEXT[commandKey] || null };

  const commandText = RICK_COMMAND_TEXT[commandKey];
  if (!commandText) return { active: false, remainingMinutes: 0, commandText: null };

  const state = readJson(options.rickStatePath, { sent: {} });
  const lastSentAt = state.sent?.[getRickCooldownKey(options.rickTargetChatName, commandText)] || null;
  if (!lastSentAt) return { active: false, remainingMinutes: 0, commandText };

  const elapsedMs = Date.now() - new Date(lastSentAt).getTime();
  const cooldownMs = options.rickCooldownHours * 60 * 60 * 1000;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs >= cooldownMs) {
    return { active: false, remainingMinutes: 0, commandText };
  }

  return {
    active: true,
    commandText,
    remainingMinutes: Math.ceil((cooldownMs - elapsedMs) / 60000),
    lastSentAt
  };
}

function summarizeCachedRickContext(options) {
  const context = readJson(options.rickContextPath, null);
  if (!context) {
    console.log('Cached Rick context unavailable; continuing without fresh Rick context.');
    return;
  }

  const generatedAt = context.generatedAt || null;
  const ageMinutes = generatedAt
    ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000)
    : null;
  const overlapCount = Array.isArray(context.tokenOverlap) ? context.tokenOverlap.length : 0;
  const ageText = Number.isFinite(ageMinutes) ? `${ageMinutes} min old` : 'age unknown';
  console.log(`Using cached Rick context: ${generatedAt || 'unknown time'} (${ageText}), ${overlapCount} token overlaps.`);
}

function shouldRunTelegramSync(options, phase = 'pre') {
  if (options.telegramSyncMode === 'always') {
    return true;
  }

  if (options.telegramSyncMode === 'never') {
    return false;
  }

  if (phase === 'post_rick') {
    return false;
  }

  return !fileExists(options.telegramContextPath);
}

async function refreshRunContext(options) {
  if (options.skipContext) {
    console.log('Skipping pre-run context refresh (--skipContext).');
    return;
  }

  printSection('Pre-Run Context Refresh');
  console.log('Refreshing Telegram, requesting Rick reports, then rebuilding Rick context.');
  await runNode('Macro Posture Report', 'macro-posture-report.js', [], { allowFailure: true });

  if (shouldRunTelegramSync(options, 'pre')) {
    await runNode('Sync Telegram Context', 'sync-telegram-context.js', [], { allowFailure: true });
  } else {
    console.log('Using cached Telegram context; skipping heavy pre-run Telegram sync.');
  }
  await runNode('Build Rick Context Before Commands', 'build-rick-context.js', [], { allowFailure: true });
  await runNode('Wallet Behavior Report', 'report-wallet-behavior.js', [], { allowFailure: true });

  let sentRickCommands = 0;
  let skippedCooldownCommands = 0;
  for (const command of options.rickCommands) {
    const cooldown = getRickCooldown(command, options);
    if (cooldown.active) {
      skippedCooldownCommands += 1;
      console.log(`Rick command ${command} skipped: cooldown active for ${cooldown.commandText}; about ${cooldown.remainingMinutes} min remaining.`);
      continue;
    }

    const commandArgs = options.forceRick ? [command, '--force'] : [command];
    const exitCode = await runNode(`Send Rick Command: ${command}`, 'send-rick-command.js', commandArgs, { allowFailure: true });
    if (exitCode === 0) {
      sentRickCommands += 1;
    }
    if (options.rickCommandDelayMs > 0) {
      await sleep(options.rickCommandDelayMs);
    }
  }

  if (sentRickCommands > 0 && options.rickReplyWaitMs > 0) {
    console.log(`Waiting ${Math.round(options.rickReplyWaitMs / 1000)}s for Rick replies before syncing.`);
    await sleep(options.rickReplyWaitMs);
  } else if (skippedCooldownCommands > 0) {
    console.log('Rick refresh skipped by cooldown; not waiting for new replies.');
    summarizeCachedRickContext(options);
  }

  if (shouldRunTelegramSync(options, 'post_rick')) {
    await runNode('Sync Telegram Context After Rick Replies', 'sync-telegram-context.js', [], { allowFailure: true });
  } else {
    console.log('Skipping post-Rick Telegram sync; rebuilding context from cached Telegram data.');
  }
  await runNode('Build Fresh Rick Context', 'build-rick-context.js', [], { allowFailure: true });
  await runNode('Wallet Battlefield Report', 'wallet-battlefield-report.js', [], { allowFailure: true });
}

async function generatePostRunReports(options) {
  if (options.skipReports) {
    console.log('Skipping post-run reports (--skipReports).');
    return;
  }

  printSection('Post-Run Reports');
  for (const report of POST_RUN_REPORTS) {
    if (SKIPPED_POST_RUN_REPORTS.has(report.script) || SKIPPED_POST_RUN_REPORTS.has(report.title)) {
      printSection(report.title);
      console.log(`[SKIP] ${report.script} skipped by POST_RUN_SKIP_REPORTS`);
      continue;
    }
    await runNode(report.title, report.script, [], {
      allowFailure: true,
      env: buildPostRunReportEnv()
    });
  }
}

process.on('SIGINT', () => {
  interrupted = true;
  if (activeChild) {
    killProcessTree(activeChild);
    return;
  }
  process.exit(130);
});

process.on('SIGTERM', () => {
  interrupted = true;
  if (activeChild) {
    killProcessTree(activeChild);
    return;
  }
  process.exit(143);
});

async function main() {
  const { botArgs, options } = parseLifecycleArgs(process.argv.slice(2));

  await refreshRunContext(options);

  const telemetryBeforeRun = latestTelemetrySignature();
  let botExitCode = 0;
  try {
    botExitCode = await runProcess('Trading Bot Foreground Run', NODE, [path.join('src', 'index.js'), ...botArgs], {
      timeoutMs: getBotSessionTimeoutMs(botArgs),
      timeoutExitCode: 0
    });
  } catch (error) {
    botExitCode = 1;
    console.error(`[ERROR] Trading bot failed: ${error.message}`);
  }

  const telemetryAfterRun = latestTelemetrySignature();
  const freshTelemetryObserved = telemetryAfterRun && telemetryAfterRun !== telemetryBeforeRun;
  if (botExitCode === 0 || freshTelemetryObserved) {
    await generatePostRunReports(options);
  } else {
    console.warn('[WARN] Skipping post-run reports because the bot exited before producing fresh telemetry.');
  }

  if (interrupted && botExitCode === 0) {
    process.exit(130);
  }

  process.exit(botExitCode);
}

main().catch((error) => {
  console.error(`[ERROR] Run lifecycle failed: ${error.message}`);
  process.exit(1);
});
