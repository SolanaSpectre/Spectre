const fs = require('fs');

class RickContext {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.rickContextEnabled !== false;
    this.filePath = config.rickContextFilePath;
    this.refreshIntervalMs = config.rickContextRefreshIntervalMs;
    this.lastLoadedAt = 0;
    this.lastMtimeMs = 0;
    this.messages = [];
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
      this.logger.info(`Rick context loaded: ${this.messages.length} messages`);
    } catch (error) {
      this.logger.warn('Failed to refresh Rick context', error.message);
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

    const categoryCounts = matches.reduce((acc, message) => {
      for (const category of message.categories || []) {
        acc[category] = (acc[category] || 0) + 1;
      }
      return acc;
    }, {});

    const sentimentCounts = matches.reduce((acc, message) => {
      const sentiment = message.sentiment || 'NEUTRAL';
      acc[sentiment] = (acc[sentiment] || 0) + 1;
      return acc;
    }, {});

    const reportTypeCounts = matches.reduce((acc, message) => {
      const reportType = message.reportType || 'unknown';
      acc[reportType] = (acc[reportType] || 0) + 1;
      return acc;
    }, {});

    const joinedText = matches.map((message) => String(message.text || '').toLowerCase()).join('\n');
    const noLabeledWallets = joinedText.includes('no labeled wallets');
    const recentLaunchesCount = this.extractBracketCount(joinedText, 'recent launches');
    const topLaunchesCount = this.extractLineCount(joinedText, 'top launches');
    const rewardsMentioned = joinedText.includes('rewards:');
    const graduatedMentioned = joinedText.includes('graduated');
    const launchpadsMentioned = joinedText.includes('top 5 launchpads');

    const deployerSummary = {
      thinHistory: Boolean(categoryCounts.deployerHistory) && recentLaunchesCount <= 1,
      recentLaunchesCount,
      topLaunchesCount,
      rewardsMentioned
    };

    const holderSummary = {
      noLabeledWallets,
      trustedHolderSignals: noLabeledWallets ? 0 : Number(categoryCounts.holderContext || 0)
    };

    const marketSummary = {
      launchpadsMentioned,
      graduatedMentioned,
      runnersReportSeen: Boolean(reportTypeCounts.runnersReport),
      trendingDexSeen: Boolean(reportTypeCounts.trendingDex),
      trendingPumpSeen: Boolean(reportTypeCounts.trendingPump),
      burpLeaderboardSeen: Boolean(reportTypeCounts.burpLeaderboard),
      strongestBurpGainPct: this.maxMetric(matches, 'averageGainPct'),
      runnersGlobalCount: this.maxMetric(matches, 'runnersGlobalCount'),
      medianRunnerAthKUsd: this.maxMetric(matches, 'medianAthKUsd'),
      medianRunnerFirstScanKUsd: this.maxMetric(matches, 'medianFirstScanKUsd'),
      solDominancePct: this.maxMetric(matches, 'solDominancePct'),
      burpTrackedTokens: this.maxMetric(matches, 'tokensTracked'),
      trendingDexItemCount: this.maxMetric(matches, 'itemCount', 'trendingDex'),
      trendingPumpItemCount: this.maxMetric(matches, 'itemCount', 'trendingPump'),
      mentionCapsKUsd: this.collectMetricArray(matches, 'mentionCapsKUsd')
    };

    return {
      mentionCount: matches.length,
      latestMentionAt: matches[matches.length - 1]?.date || null,
      categoryCounts,
      sentimentCounts,
      reportTypeCounts,
      hasDeployerHistory: Boolean(categoryCounts.deployerHistory),
      hasHolderContext: Boolean(categoryCounts.holderContext),
      hasMarketStats: Boolean(categoryCounts.marketStats),
      supportTier: this.buildSupportTier(categoryCounts, sentimentCounts, deployerSummary, holderSummary),
      deployerSummary,
      holderSummary,
      marketSummary,
      snippets: matches.slice(-3).map((message) => ({
        chatTitle: message.chatTitle,
        date: message.date,
        categories: message.categories || [],
        text: String(message.text || '').slice(0, 240)
      }))
    };
  }

  buildSupportTier(categoryCounts, sentimentCounts, deployerSummary = {}, holderSummary = {}) {
    const positive = Number(sentimentCounts.POSITIVE || 0);
    const negative = Number(sentimentCounts.NEGATIVE || 0);
    const structureSignals =
      Number(categoryCounts.deployerHistory || 0)
      + Number(categoryCounts.holderContext || 0)
      + Number(categoryCounts.marketStats || 0);

    const cautionSignals =
      (deployerSummary.thinHistory ? 1 : 0)
      + (holderSummary.noLabeledWallets ? 1 : 0);

    if (cautionSignals >= 2) {
      return 'STRUCTURED_CAUTION';
    }

    if (cautionSignals >= 1 && positive <= 1) {
      return 'STRUCTURED_MIXED';
    }

    if (structureSignals >= 2 && positive >= negative) {
      return 'STRUCTURED_SUPPORT';
    }

    if (negative > positive) {
      return 'STRUCTURED_CAUTION';
    }

    return 'STRUCTURED_MIXED';
  }

  extractBracketCount(text, label) {
    const pattern = new RegExp(`${label}\\s*\\[(\\d+)\\]`, 'i');
    const match = String(text || '').match(pattern);
    return match ? Number(match[1] || 0) : 0;
  }

  extractLineCount(text, label) {
    const lowered = String(text || '').toLowerCase();
    const index = lowered.indexOf(label.toLowerCase());
    if (index === -1) {
      return 0;
    }

    const slice = lowered.slice(index).split('\n').slice(1, 6);
    return slice.filter((line) => /\d+m|\d+h|\d+d/.test(line)).length;
  }

  maxMetric(matches, metricName, reportType = null) {
    const values = matches
      .filter((message) => !reportType || message.reportType === reportType)
      .map((message) => message?.metrics?.[metricName])
      .filter((value) => Number.isFinite(value));

    return values.length > 0 ? Math.max(...values) : null;
  }

  collectMetricArray(matches, metricName) {
    const values = matches.flatMap((message) => {
      const metric = message?.metrics?.[metricName];
      return Array.isArray(metric) ? metric : [];
    });

    if (values.length === 0) {
      return [];
    }

    return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((a, b) => a - b);
  }

  buildSearchTerms(tokenInfo = {}) {
    const terms = new Set();
    const mint = String(tokenInfo.mintAddress || '').trim().toLowerCase();
    const symbol = String(tokenInfo.symbol || '').trim().toLowerCase();
    const name = String(tokenInfo.name || '').trim().toLowerCase();

    if (mint && mint.length >= 12) terms.add(mint);
    if (symbol && symbol.length >= 2) terms.add(symbol);
    if (name && name.length >= 3) terms.add(name);

    return Array.from(terms);
  }
}

module.exports = RickContext;
