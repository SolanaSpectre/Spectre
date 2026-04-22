require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');

const DEFAULT_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'rick-context', 'latest.json');
const DEFAULT_TELEGRAM_CONTEXT_PATH = path.join(__dirname, '..', 'data', 'telegram-context', 'latest.json');
const REPO_ROOT = path.join(__dirname, '..');

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

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) {
    return fallback;
  }

  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function inferCategories(text) {
  const lowered = String(text || '').toLowerCase();
  const categories = [];

  if (lowered.includes('deployer')) {
    categories.push('deployerHistory');
  }

  if (
    lowered.includes('/dev')
    || lowered.includes('recent launches')
    || lowered.includes('top launches')
    || lowered.includes('rewards:')
  ) {
    categories.push('deployerHistory');
  }

  if (
    lowered.includes('holder')
    || lowered.includes('holders')
    || lowered.includes('top holder')
    || lowered.includes('notable holder')
    || lowered.includes('known holders')
    || lowered.includes('/nh')
    || lowered.includes('/h')
    || lowered.includes('no labeled wallets')
    || lowered.includes('bundle')
    || lowered.includes('bundler')
    || lowered.includes('farmer')
  ) {
    categories.push('holderContext');
  }

  if (
    lowered.includes('market stats')
    || lowered.includes('state of the trenches')
    || lowered.includes('/vol')
    || lowered.includes('runners report')
    || lowered.includes('trending dex tokens')
    || lowered.includes('trending pump tokens')
    || lowered.includes('leaderboard [1h]')
    || lowered.includes('/dt@rick')
    || lowered.includes('/pft@rick')
    || lowered.includes('/burp@rick')
    || lowered.includes('hot tokens')
    || lowered.includes('market overview')
    || lowered.includes('heatmap')
  ) {
    categories.push('marketStats');
  }

  return categories;
}

function detectReportType(text) {
  const lowered = String(text || '').toLowerCase();

  if (lowered.includes('/runners@rick') || lowered.includes('runners report')) {
    return 'runnersReport';
  }

  if (lowered.includes('/dt@rick') || lowered.includes('trending dex tokens')) {
    return 'trendingDex';
  }

  if (lowered.includes('/pft@rick') || lowered.includes('trending pump tokens')) {
    return 'trendingPump';
  }

  if (lowered.includes('/burp@rick') || lowered.includes('leaderboard [1h]')) {
    return 'burpLeaderboard';
  }

  if (lowered.includes('/vol@rick') || lowered.includes('/vol') || lowered.includes('market stats')) {
    return 'marketStats';
  }

  if (lowered.includes('/dev') || lowered.includes('recent launches') || lowered.includes('top launches')) {
    return 'deployerHistory';
  }

  if (lowered.includes('/nh') || lowered.includes('/h') || lowered.includes('known holders') || lowered.includes('notable holders')) {
    return 'holderContext';
  }

  return null;
}

function extractMintCandidates(text) {
  const matches = String(text || '').match(/\b[1-9A-HJ-NP-Za-km-z]{20,}(?:pump)?\b/g) || [];
  return Array.from(new Set(matches));
}

function isRickCommandOnly(text) {
  return /^\/(?:runners|vol|dt|pft|burp)(?:@rick)?$/i.test(String(text || '').trim());
}

function extractFirstNumber(text, pattern) {
  const match = String(text || '').match(pattern);
  return match ? Number(match[1]) : null;
}

function compactMoneyToUsd(amount, suffix) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalizedSuffix = String(suffix || '').toUpperCase();
  if (normalizedSuffix === 'B') return numeric * 1_000_000_000;
  if (normalizedSuffix === 'M') return numeric * 1_000_000;
  if (normalizedSuffix === 'K') return numeric * 1_000;
  return numeric;
}

function extractAgeHint(line, startIndex) {
  const tail = String(line || '').slice(startIndex);
  const tailMatch = tail.match(/(?:\b|[^\w])(\d+(?:\.\d+)?\s*(?:mo|[mhd]))\b/);
  if (tailMatch) {
    return tailMatch[1].replace(/\s+/g, '');
  }

  const head = String(line || '').slice(0, startIndex);
  const headMatch = head.match(/(?:^|\s)(\d+(?:\.\d+)?\s*(?:mo|[mhd]))\b/);
  return headMatch ? headMatch[1].replace(/\s+/g, '') : null;
}

function extractRunnerTargetUsd(line, startIndex) {
  const tail = String(line || '').slice(startIndex);
  const match = tail.match(/(?:⇨|->|=>|â‡¨)\s*\$?\s*(\d+(?:\.\d+)?)\s*([KMB])/i);
  return match ? compactMoneyToUsd(match[1], match[2]) : null;
}

function extractTokenMentions(text, reportType) {
  const mentions = [];
  const seen = new Set();
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    const matches = line.matchAll(/\b([A-Za-z][A-Za-z0-9&._-]{1,31})\s*@\s*\$?\s*(\d+(?:\.\d+)?)\s*([KMB])\b/g);

    for (const match of matches) {
      const symbol = match[1].replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9&._-]+$/g, '');
      if (!symbol || ['Volume', 'Market', 'Median'].includes(symbol)) {
        continue;
      }

      const symbolKey = symbol.toUpperCase();
      const key = `${reportType || 'unknown'}:${symbolKey}:${match.index}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      mentions.push({
        symbol,
        symbolKey,
        reportType,
        capUsd: compactMoneyToUsd(match[2], match[3]),
        capLabel: `${match[2]}${String(match[3]).toUpperCase()}`,
        targetCapUsd: extractRunnerTargetUsd(line, match.index + match[0].length),
        ageHint: extractAgeHint(line, match.index + match[0].length),
        line: line.trim()
      });
    }
  }

  return mentions;
}

function extractReportMetrics(text, reportType) {
  const normalized = String(text || '').replace(/[^\x20-\x7E\n]/g, ' ');
  const lowered = normalized.toLowerCase();

  if (reportType === 'runnersReport') {
    return {
      runnersGlobalCount: extractFirstNumber(normalized, /Global:\s*[\s\S]*?Runners:\s*(\d+)/i),
      medianAthKUsd: extractFirstNumber(normalized, /Median ATH:\s*\$?(\d+(?:\.\d+)?)K/i),
      medianFirstScanKUsd: extractFirstNumber(normalized, /Median first scan:\s*\$?(\d+(?:\.\d+)?)K/i),
      solDominancePct: extractFirstNumber(normalized, /SOL dominance:\s*(\d+(?:\.\d+)?)%/i),
      mentionCapsKUsd: Array.from(
        normalized.matchAll(/@ ?(\d+(?:\.\d+)?)K/gi),
        (match) => Number(match[1])
      ).slice(0, 10)
    };
  }

  if (reportType === 'burpLeaderboard') {
    return {
      averageGainPct: extractFirstNumber(normalized, /Average gain:\s*(\d+(?:\.\d+)?)%/i),
      medianGainPct: extractFirstNumber(normalized, /Median:\s*(\d+(?:\.\d+)?)%/i),
      tokensTracked: extractFirstNumber(normalized, /Tokens tracked in the last 1H:\s*(\d+)/i),
      mentionCapsKUsd: Array.from(
        normalized.matchAll(/@ ?(\d+(?:\.\d+)?)K/gi),
        (match) => Number(match[1])
      ).slice(0, 10)
    };
  }

  if (reportType === 'trendingDex' || reportType === 'trendingPump') {
    return {
      mentionCapsKUsd: Array.from(
        normalized.matchAll(/@ ?(\d+(?:\.\d+)?)K/gi),
        (match) => Number(match[1])
      ).slice(0, 10),
      itemCount: (normalized.match(/@\s*\d+(?:\.\d+)?K/gi) || []).length
    };
  }

  return {};
}

function classifySentiment(text) {
  const lowered = String(text || '').toLowerCase();
  const positiveHits = ['runner', 'send', 'strong', 'bull', 'good', 'based', 'clean']
    .reduce((sum, keyword) => sum + (lowered.includes(keyword) ? 1 : 0), 0);
  const negativeHits = ['rug', 'scam', 'farm', 'avoid', 'bad', 'dump', 'toxic']
    .reduce((sum, keyword) => sum + (lowered.includes(keyword) ? 1 : 0), 0);

  if (negativeHits > positiveHits) return 'NEGATIVE';
  if (positiveHits > negativeHits) return 'POSITIVE';
  return 'NEUTRAL';
}

function normalizeMessage(message) {
  const text = String(message?.text || '').trim();
  if (!text) {
    return null;
  }

  if (isRickCommandOnly(text)) {
    return null;
  }

  const categories = inferCategories(text);
  if (categories.length === 0) {
    return null;
  }

  const reportType = detectReportType(text);
  const tokenMentions = extractTokenMentions(text, reportType);

  return {
    chatId: message.chatId || null,
    chatTitle: message.chatTitle || 'unknown',
    messageId: message.messageId || null,
    date: message.date || new Date().toISOString(),
    text,
    categories,
    sentiment: classifySentiment(text),
    reportType,
    mintCandidates: extractMintCandidates(text),
    tokenMentions,
    metrics: extractReportMetrics(text, reportType)
  };
}

function buildTokenOverlap(messages) {
  const bySymbol = new Map();

  for (const message of messages) {
    for (const mention of message.tokenMentions || []) {
      const key = mention.symbolKey;
      if (!bySymbol.has(key)) {
        bySymbol.set(key, {
          symbol: mention.symbol,
          symbolKey: key,
          mentions: 0,
          reportTypes: new Set(),
          categories: new Set(),
          firstSeen: message.date,
          lastSeen: message.date,
          latestAgeHint: mention.ageHint || null,
          latestCapUsd: mention.capUsd,
          maxCapUsd: mention.capUsd,
          maxTargetCapUsd: mention.targetCapUsd,
          lines: []
        });
      }

      const item = bySymbol.get(key);
      item.mentions += 1;
      if (mention.reportType) item.reportTypes.add(mention.reportType);
      for (const category of message.categories || []) item.categories.add(category);
      if (new Date(message.date).getTime() < new Date(item.firstSeen).getTime()) item.firstSeen = message.date;
      if (new Date(message.date).getTime() >= new Date(item.lastSeen).getTime()) {
        item.lastSeen = message.date;
        item.latestAgeHint = mention.ageHint || item.latestAgeHint;
        item.latestCapUsd = mention.capUsd;
      }
      if (mention.capUsd !== null && (item.maxCapUsd === null || mention.capUsd > item.maxCapUsd)) item.maxCapUsd = mention.capUsd;
      if (mention.targetCapUsd !== null && (item.maxTargetCapUsd === null || mention.targetCapUsd > item.maxTargetCapUsd)) item.maxTargetCapUsd = mention.targetCapUsd;
      if (item.lines.length < 5) item.lines.push(mention.line);
    }
  }

  return Array.from(bySymbol.values())
    .map((item) => {
      const reportTypes = Array.from(item.reportTypes).sort();
      const categories = Array.from(item.categories).sort();
      const categoryCount = Math.max(reportTypes.length, categories.length);
      const multiplier = categoryCount >= 4 ? 2.5 : categoryCount >= 3 ? 2 : categoryCount >= 2 ? 1.5 : 1;
      const socialOverlapScore = Math.min(10, Number((item.mentions * multiplier).toFixed(2)));

      return {
        symbol: item.symbol,
        symbolKey: item.symbolKey,
        mentions: item.mentions,
        reportTypes,
        categories,
        socialOverlapScore,
        firstSeen: item.firstSeen,
        lastSeen: item.lastSeen,
        latestAgeHint: item.latestAgeHint,
        latestCapUsd: item.latestCapUsd,
        maxCapUsd: item.maxCapUsd,
        maxTargetCapUsd: item.maxTargetCapUsd,
        lines: item.lines
      };
    })
    .sort((a, b) => b.socialOverlapScore - a.socialOverlapScore || b.mentions - a.mentions || String(a.symbolKey).localeCompare(String(b.symbolKey)));
}

function main() {
  const outputPath = resolveRepoPath(process.env.RICK_CONTEXT_FILE_PATH, DEFAULT_OUTPUT_PATH);
  const telegramContextPath = resolveRepoPath(process.env.TELEGRAM_CONTEXT_FILE_PATH, DEFAULT_TELEGRAM_CONTEXT_PATH);
  const sourceChatNames = toStringList(process.env.RICK_CONTEXT_SOURCE_CHAT_NAMES || 'weRvENum');

  const telegramPayload = readJson(telegramContextPath, { messages: [] });
  const dedupeKeys = new Set();
  const sourceMessages = (telegramPayload.messages || [])
    .filter((message) => {
      const haystack = `${message.chatTitle || ''} ${message.username || ''}`.toLowerCase();
      return sourceChatNames.some((name) => haystack.includes(name.toLowerCase()));
    })
    .map(normalizeMessage)
    .filter(Boolean)
    .filter((message) => {
      const key = `${message.chatId}:${message.messageId || ''}:${message.date}:${message.text}`;
      if (dedupeKeys.has(key)) {
        return false;
      }
      dedupeKeys.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const categoryCounts = sourceMessages.reduce((acc, message) => {
    for (const category of message.categories) {
      acc[category] = (acc[category] || 0) + 1;
    }
    return acc;
  }, {});

  const reportTypeCounts = sourceMessages.reduce((acc, message) => {
    if (message.reportType) {
      acc[message.reportType] = (acc[message.reportType] || 0) + 1;
    }
    return acc;
  }, {});

  const tokenOverlap = buildTokenOverlap(sourceMessages);

  writeJson(outputPath, {
    source: 'telegram_rick_sidecar',
    generatedAt: new Date().toISOString(),
    sourceChatNames,
    messageCount: sourceMessages.length,
    categoryCounts,
    reportTypeCounts,
    tokenOverlap,
    messages: sourceMessages
  });

  console.log(`Built Rick context with ${sourceMessages.length} categorized messages from ${sourceChatNames.join(', ')}.`);
}

main();
