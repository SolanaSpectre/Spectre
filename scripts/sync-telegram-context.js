require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const input = require('input');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'telegram-context');

function toNumberList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function toStringList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
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

function normalizeTelegramDate(value) {
  if (value === null || value === undefined) {
    return new Date().toISOString();
  }

  if (typeof value === 'number') {
    const normalized = value < 10_000_000_000 ? value * 1000 : value;
    return new Date(normalized).toISOString();
  }

  return new Date(value).toISOString();
}

function getConfig() {
  return {
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0', 10),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    phone: process.env.TELEGRAM_PHONE || '',
    password: process.env.TELEGRAM_PASSWORD || '',
    allowedChatIds: toNumberList(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
    allowedChatNames: toStringList(process.env.TELEGRAM_ALLOWED_CHAT_NAMES),
    contextWindowHours: parseInt(process.env.TELEGRAM_CONTEXT_WINDOW_HOURS || '12', 10),
    maxMessagesPerChat: parseInt(process.env.TELEGRAM_MAX_MESSAGES_PER_CHAT || '40', 10),
    maxStoredMessages: parseInt(process.env.TELEGRAM_MAX_STORED_MESSAGES || '300', 10),
    outputPath: process.env.TELEGRAM_CONTEXT_FILE_PATH || path.join(OUTPUT_DIR, 'latest.json'),
    statePath: process.env.TELEGRAM_STATE_FILE_PATH || path.join(OUTPUT_DIR, 'state.json'),
    stringSessionPath: process.env.TELEGRAM_STRING_SESSION_FILE_PATH || path.join(OUTPUT_DIR, 'string-session.txt')
  };
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

function shouldKeepDialog(dialog, config) {
  const entity = dialog.entity || {};
  const chatId = Number(entity.id || 0);
  const username = String(entity.username || '').trim();
  const title = String(entity.title || entity.firstName || entity.lastName || '').trim();

  if (config.allowedChatIds.length === 0 && config.allowedChatNames.length === 0) {
    return true;
  }

  if (config.allowedChatIds.includes(chatId)) {
    return true;
  }

  const haystack = [username, title].filter(Boolean).join(' ').toLowerCase();
  return config.allowedChatNames.some((name) => haystack.includes(name.toLowerCase()));
}

function normalizeMessage(message, dialog) {
  const text = String(message.message || '').trim();
  if (!text) {
    return null;
  }

  const entity = dialog.entity || {};
  return {
    messageId: Number(message.id || 0),
    chatId: Number(entity.id || 0),
    chatTitle: entity.title || entity.username || entity.firstName || entity.lastName || 'unknown',
    username: message.sender?.username || null,
    date: normalizeTelegramDate(message.date),
    text
  };
}

function pruneMessages(messages, config) {
  const cutoff = Date.now() - (config.contextWindowHours * 60 * 60 * 1000);
  return messages
    .filter((message) => {
      const timestamp = new Date(message.date).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-config.maxStoredMessages);
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

async function collectMessages(client, config) {
  const messages = [];
  const dialogs = await client.getDialogs({});

  for (const dialog of dialogs) {
    if (!shouldKeepDialog(dialog, config)) {
      continue;
    }

    let count = 0;
    for await (const message of client.iterMessages(dialog.entity, { limit: config.maxMessagesPerChat })) {
      const normalized = normalizeMessage(message, dialog);
      if (normalized) {
        messages.push(normalized);
      }
      count += 1;
      if (count >= config.maxMessagesPerChat) {
        break;
      }
    }
  }

  return messages;
}

async function main() {
  const config = getConfig();
  if (!config.apiId || !config.apiHash || !config.phone) {
    throw new Error('TELEGRAM_API_ID, TELEGRAM_API_HASH, and TELEGRAM_PHONE are required');
  }

  const existing = readJson(config.outputPath, { messages: [] });
  const client = await connectClient(config);

  try {
    const freshMessages = await collectMessages(client, config);
    const merged = pruneMessages([...(existing.messages || []), ...freshMessages], config);

    writeJson(config.outputPath, {
      source: 'telegram_user_client',
      generatedAt: new Date().toISOString(),
      contextWindowHours: config.contextWindowHours,
      messageCount: merged.length,
      chats: Array.from(new Set(merged.map((message) => `${message.chatId}:${message.chatTitle}`))).sort(),
      messages: merged
    });

    writeJson(config.statePath, {
      updatedAt: new Date().toISOString(),
      storedMessages: merged.length
    });

    console.log(`Collected ${freshMessages.length} messages, stored ${merged.length} rolling messages.`);
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`Failed to sync Telegram context: ${error.message}`);
  process.exit(1);
});
