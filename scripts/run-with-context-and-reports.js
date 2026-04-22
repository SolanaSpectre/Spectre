require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const DEFAULT_RICK_STATE_PATH = path.join(REPO_ROOT, 'data', 'rick-context', 'command-state.json');
const DEFAULT_RICK_CONTEXT_PATH = path.join(REPO_ROOT, 'data', 'rick-context', 'latest.json');

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

function runProcess(title, command, args, { allowFailure = false } = {}) {
  printSection(title);
  console.log(`> ${[command, ...args].join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false
    });

    activeChild = child;

    child.on('error', (error) => {
      activeChild = null;
      if (allowFailure) {
        console.warn(`[WARN] ${title} failed to start: ${error.message}`);
        resolve(1);
        return;
      }
      reject(error);
    });

    child.on('close', (code, signal) => {
      activeChild = null;
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

async function refreshRunContext(options) {
  if (options.skipContext) {
    console.log('Skipping pre-run context refresh (--skipContext).');
    return;
  }

  printSection('Pre-Run Context Refresh');
  console.log('Refreshing Telegram, requesting Rick reports, then rebuilding Rick context.');

  await runNode('Sync Telegram Context', 'sync-telegram-context.js', [], { allowFailure: true });
  await runNode('Build Rick Context Before Commands', 'build-rick-context.js', [], { allowFailure: true });

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

  await runNode('Sync Telegram Context After Rick Replies', 'sync-telegram-context.js', [], { allowFailure: true });
  await runNode('Build Fresh Rick Context', 'build-rick-context.js', [], { allowFailure: true });
  await runNode('Wallet Battlefield Report', 'wallet-battlefield-report.js', [], { allowFailure: true });
}

async function generatePostRunReports(options) {
  if (options.skipReports) {
    console.log('Skipping post-run reports (--skipReports).');
    return;
  }

  printSection('Post-Run Reports');
  await runNode('Battlefield Report', 'run-battlefield-report.js', [], { allowFailure: true });
  await runNode('Wallet Battlefield Report', 'wallet-battlefield-report.js', [], { allowFailure: true });
  await runNode('Wallet Outcome Audit', 'wallet-outcome-audit.js', [], { allowFailure: true });
  await runNode('Watch Lane Validation Report', 'watch-lane-validation-report.js', [], { allowFailure: true });
  await runNode('Pre-Migration Outcome Report', 'pre-migration-outcome-report.js', [], { allowFailure: true });
  await runNode('Pre-Migration Paper Simulation Report', 'pre-migration-paper-sim-report.js', [], { allowFailure: true });
  await runNode('Pre-Migration Preset Replay Report', 'pre-migration-preset-replay-report.js', [], { allowFailure: true });
  await runNode('Pre-Migration Signal Quality Report', 'pre-migration-signal-quality-report.js', [], { allowFailure: true });
  await runNode('Broad Organic Surge Replay Report', 'broad-organic-surge-replay-report.js', [], { allowFailure: true });
  await runNode('Continuation Specimen Report', 'continuation-specimen-report.js', [], { allowFailure: true });
  await runNode('Internal Continuation Specimen Report', 'internal-continuation-specimen-report.js', [], { allowFailure: true });
  await runNode('Continuation Paper Ledger', 'continuation-paper-ledger.js', [], { allowFailure: true });
  await runNode('Trade Learning Memory', 'trade-learning-memory.js', [], { allowFailure: true });
  await runNode('Learning Orchestrator Report', 'learning-orchestrator-report.js', [], { allowFailure: true });
}

process.on('SIGINT', () => {
  interrupted = true;
  if (activeChild) {
    activeChild.kill('SIGINT');
    return;
  }
  process.exit(130);
});

process.on('SIGTERM', () => {
  interrupted = true;
  if (activeChild) {
    activeChild.kill('SIGTERM');
    return;
  }
  process.exit(143);
});

async function main() {
  const { botArgs, options } = parseLifecycleArgs(process.argv.slice(2));

  await refreshRunContext(options);

  let botExitCode = 0;
  try {
    botExitCode = await runProcess('Trading Bot Foreground Run', NODE, [path.join('src', 'index.js'), ...botArgs]);
  } catch (error) {
    botExitCode = 1;
    console.error(`[ERROR] Trading bot failed: ${error.message}`);
  }

  await generatePostRunReports(options);

  if (interrupted && botExitCode === 0) {
    process.exit(130);
  }

  process.exit(botExitCode);
}

main().catch((error) => {
  console.error(`[ERROR] Run lifecycle failed: ${error.message}`);
  process.exit(1);
});
