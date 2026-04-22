const fs = require('fs');

class TelegramContext {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.telegramContextEnabled !== false;
    this.filePath = config.telegramContextFilePath;
    this.refreshIntervalMs = config.telegramContextRefreshIntervalMs;
    this.maxSnippets = config.telegramSummaryMaxSnippets;
    this.lastLoadedAt = 0;
    this.lastMtimeMs = 0;
    this.messages = [];
  }

  static get MINT_CANDIDATE_REGEX() {
    return /[1-9A-HJ-NP-Za-km-z]{32,48}/g;
  }

  refreshIfNeeded() {
    if (!this.enabled || !this.filePath) {
      return;
    }

    const now = Date.now();
    if ((now - this.lastLoadedAt) < this.refreshIntervalMs) {
      return;
    }

    this.lastLoadedAt = now;

    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }

      const stat = fs.statSync(this.filePath);
      if (stat.mtimeMs <= this.lastMtimeMs) {
        return;
      }

      const payload = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      this.messages = Array.isArray(payload.messages) ? payload.messages : [];
      this.lastMtimeMs = stat.mtimeMs;
      this.logger.info(`Telegram context loaded: ${this.messages.length} messages`);
    } catch (error) {
      this.logger.warn('Failed to refresh Telegram context', error.message);
    }
  }

  getTokenSummary(tokenInfo = {}) {
    this.refreshIfNeeded();
    if (!this.enabled || this.messages.length === 0) {
      return null;
    }

    const searchTerms = this.buildSearchTerms(tokenInfo);
    if (searchTerms.length === 0) {
      return null;
    }

    const matches = this.messages.filter((message) => {
      const haystack = String(message.text || '').toLowerCase();
      return searchTerms.some((term) => haystack.includes(term));
    });

    if (matches.length === 0) {
      return null;
    }

    const snippets = matches.slice(-this.maxSnippets).map((message) => ({
      chatTitle: message.chatTitle,
      date: message.date,
      text: String(message.text || '').slice(0, 220)
    }));

    const joinedText = matches.map((message) => String(message.text || '').toLowerCase()).join('\n');
    const bullishKeywordHits = this.countKeywords(joinedText, ['runner', 'send', 'moon', 'bid', 'strong', 'bull', 'ape']);
    const bearishKeywordHits = this.countKeywords(joinedText, ['rug', 'dump', 'avoid', 'scam', 'farm', 'dead', 'sell']);

    return {
      mentionCount: matches.length,
      uniqueChatCount: new Set(matches.map((message) => message.chatId)).size,
      latestMentionAt: matches[matches.length - 1]?.date || null,
      bullishKeywordHits,
      bearishKeywordHits,
      matchedTerms: searchTerms,
      snippets
    };
  }

  getRecentMintSightings(since = null, options = {}) {
    this.refreshIfNeeded();
    if (!this.enabled || this.messages.length === 0) {
      return [];
    }

    const sinceMs = this.normalizeSinceMs(since);
    const maxSnippets = Number.isFinite(options.maxSnippets)
      ? options.maxSnippets
      : this.maxSnippets;
    const maxSightings = Number.isFinite(options.maxSightings)
      ? options.maxSightings
      : 250;
    const sightings = new Map();

    for (const message of this.messages) {
      const messageDateMs = Date.parse(message.date || '');
      if (Number.isFinite(sinceMs) && Number.isFinite(messageDateMs) && messageDateMs <= sinceMs) {
        continue;
      }

      const text = String(message.text || '');
      const mintCandidates = this.extractMintCandidates(text);
      if (mintCandidates.length === 0) {
        continue;
      }

      for (const mint of mintCandidates) {
        const existing = sightings.get(mint) || {
          mint,
          source: 'telegram_context',
          mentionCount: 0,
          firstSeenAt: message.date || null,
          lastSeenAt: message.date || null,
          chats: new Map(),
          refs: [],
          snippets: []
        };

        existing.mentionCount += 1;
        existing.firstSeenAt = this.minIso(existing.firstSeenAt, message.date);
        existing.lastSeenAt = this.maxIso(existing.lastSeenAt, message.date);

        const chatKey = String(message.chatId || message.chatTitle || 'unknown');
        const chatState = existing.chats.get(chatKey) || {
          chatId: message.chatId || null,
          chatTitle: message.chatTitle || null,
          count: 0,
          lastSeenAt: message.date || null
        };
        chatState.count += 1;
        chatState.lastSeenAt = this.maxIso(chatState.lastSeenAt, message.date);
        existing.chats.set(chatKey, chatState);

        existing.refs.push({
          id: `${message.chatId || 'chat'}:${message.messageId || 'message'}:${mint}`,
          chatId: message.chatId || null,
          messageId: message.messageId || null,
          date: message.date || null
        });

        if (existing.snippets.length < maxSnippets) {
          existing.snippets.push({
            chatId: message.chatId || null,
            chatTitle: message.chatTitle || null,
            date: message.date || null,
            text: text.slice(0, 220)
          });
        }

        sightings.set(mint, existing);
      }
    }

    return [...sightings.values()]
      .map((entry) => ({
        mint: entry.mint,
        source: entry.source,
        mentionCount: entry.mentionCount,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        uniqueChatCount: entry.chats.size,
        chats: [...entry.chats.values()]
          .sort((a, b) => (b.count || 0) - (a.count || 0))
          .slice(0, 8),
        refs: entry.refs.slice(0, 64),
        snippets: entry.snippets
      }))
      .sort((a, b) => new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime())
      .slice(0, maxSightings);
  }

  buildSearchTerms(tokenInfo = {}) {
    const terms = new Set();
    const mint = String(tokenInfo.mintAddress || '').trim().toLowerCase();
    const symbol = String(tokenInfo.symbol || '').trim().toLowerCase();
    const name = String(tokenInfo.name || '').trim().toLowerCase();

    if (mint && mint.length >= 12) {
      terms.add(mint);
    }
    if (symbol && symbol.length >= 2) {
      terms.add(symbol);
    }
    if (name && name.length >= 3) {
      terms.add(name);
    }

    return Array.from(terms);
  }

  extractMintCandidates(text) {
    const raw = String(text || '');
    const matches = raw.match(TelegramContext.MINT_CANDIDATE_REGEX) || [];
    return [...new Set(matches.filter((candidate) => candidate.length >= 32 && candidate.length <= 48))];
  }

  normalizeSinceMs(since) {
    if (since === null || since === undefined) {
      return null;
    }

    if (typeof since === 'number' && Number.isFinite(since)) {
      return since;
    }

    const parsed = Date.parse(String(since));
    return Number.isFinite(parsed) ? parsed : null;
  }

  minIso(a, b) {
    if (!a) {
      return b || null;
    }
    if (!b) {
      return a;
    }
    return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
  }

  maxIso(a, b) {
    if (!a) {
      return b || null;
    }
    if (!b) {
      return a;
    }
    return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
  }

  countKeywords(text, keywords) {
    return keywords.reduce((sum, keyword) => {
      return sum + (text.includes(keyword) ? 1 : 0);
    }, 0);
  }
}

module.exports = TelegramContext;
