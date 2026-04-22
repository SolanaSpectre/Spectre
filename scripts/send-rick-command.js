require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const input = require('input');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, 'data', 'rick-context', 'command-state.json');
const DEFAULT_SESSION_PATH = path.join(REPO_ROOT, 'data', 'telegram-context', 'string-session.txt');

const COMMAND_SPECS = {
  vol: {
    command: '/vol',
    requiresArg: false
  },
  runners: {
    command: '/runners@rick',
    requiresArg: false
  },
  dt: {
    command: '/dt@rick',
    requiresArg: false
  },
  pft: {
    command: '/pft@rick',
    requiresArg: false
  },
  burp: {
    command: '/burp@rick',
    requiresArg: false
  },
  dev: {
    command: '/dev',
    requiresArg: true
  },
  nh: {
    command: '/nh',
    requiresArg: true
  },
  h: {
    command: '/h',
    requiresArg: true
  },
  w: {
    command: '/w',
    requiresArg: true
  }
};

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) {
    return fallback;
  }

  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function loadStringSession(filePath) {
  if (!fs.existsSync(filePath)) {
    return '';
  }

  return fs.readFileSync(filePath, 'utf8').trim();
}

function saveStringSession(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function getConfig() {
  return {
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    phone: process.env.TELEGRAM_PHONE || '',
    password: process.env.TELEGRAM_PASSWORD || '',
    stringSessionPath: resolveRepoPath(process.env.TELEGRAM_STRING_SESSION_FILE_PATH, DEFAULT_SESSION_PATH),
    statePath: resolveRepoPath(process.env.RICK_COMMAND_STATE_FILE_PATH, DEFAULT_STATE_PATH),
    targetChatName: String(process.env.RICK_COMMAND_TARGET_CHAT_NAME || 'weRvENum').trim(),
    cooldownHours: parseInt(process.env.RICK_COMMAND_COOLDOWN_HOURS || '4', 10)
  };
}

function parseArgs(argv) {
  const force = argv.includes('--force');
  const positional = argv.filter((item) => item !== '--force');
  const [rawCommand, rawArgument] = positional;
  const commandKey = String(rawCommand || '').trim().toLowerCase();
  const spec = COMMAND_SPECS[commandKey];

  if (!spec) {
    throw new Error(`Unsupported Rick command "${rawCommand}". Allowed: ${Object.keys(COMMAND_SPECS).join(', ')}`);
  }

  const argument = String(rawArgument || '').trim();
  if (spec.requiresArg && !argument) {
    throw new Error(`Rick command "${commandKey}" requires an argument`);
  }

  if (!spec.requiresArg && argument) {
    throw new Error(`Rick command "${commandKey}" does not accept an argument`);
  }

  if (argument && !/^[1-9A-HJ-NP-Za-km-z._-]{3,}$/.test(argument)) {
    throw new Error('Rick command argument must look like a token address, wallet, or label-safe identifier');
  }

  const text = spec.requiresArg ? `${spec.command} ${argument}` : spec.command;

  return {
    commandKey,
    text,
    force
  };
}

function getCooldownKey(targetChatName, commandText) {
  return `${targetChatName.toLowerCase()}::${commandText.toLowerCase()}`;
}

function ensureCooldown(config, commandText, force) {
  const state = readJson(config.statePath, { sent: {} });
  const key = getCooldownKey(config.targetChatName, commandText);
  const lastSentAt = state.sent[key] || null;

  if (!force && lastSentAt) {
    const elapsedMs = Date.now() - new Date(lastSentAt).getTime();
    const cooldownMs = config.cooldownHours * 60 * 60 * 1000;
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < cooldownMs) {
      const remainingMinutes = Math.ceil((cooldownMs - elapsedMs) / 60000);
      throw new Error(`Cooldown active for "${commandText}". Try again in about ${remainingMinutes} minute(s) or pass --force`);
    }
  }

  return {
    state,
    key
  };
}

async function connectClient(config) {
  const stringSession = new StringSession(loadStringSession(config.stringSessionPath));
  const client = new TelegramClient(stringSession, config.apiId, config.apiHash, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => config.phone || input.text('Telegram phone number: '),
    password: async () => config.password || input.text('Telegram 2FA password (if any): '),
    phoneCode: async () => input.text('Telegram login code: '),
    onError: (error) => {
      console.error(`Telegram auth error: ${error.message}`);
    }
  });

  saveStringSession(config.stringSessionPath, client.session.save());
  return client;
}

async function findTargetDialog(client, targetChatName) {
  const dialogs = await client.getDialogs({});
  const target = dialogs.find((dialog) => {
    const entity = dialog.entity || {};
    const haystack = `${entity.title || ''} ${entity.username || ''} ${entity.firstName || ''} ${entity.lastName || ''}`.toLowerCase();
    return haystack.includes(targetChatName.toLowerCase());
  });

  if (!target) {
    throw new Error(`Could not find target Telegram chat "${targetChatName}"`);
  }

  return target;
}

async function main() {
  const config = getConfig();
  if (!config.apiId || !config.apiHash || !config.phone) {
    throw new Error('TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_PHONE are required');
  }

  const parsed = parseArgs(process.argv.slice(2));
  const { state, key } = ensureCooldown(config, parsed.text, parsed.force);

  const client = await connectClient(config);
  try {
    const dialog = await findTargetDialog(client, config.targetChatName);
    await client.sendMessage(dialog.entity, { message: parsed.text });

    state.sent[key] = new Date().toISOString();
    writeJson(config.statePath, state);

    console.log(`Sent Rick command to ${config.targetChatName}: ${parsed.text}`);
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`Failed to send Rick command: ${error.message}`);
  process.exit(1);
});
