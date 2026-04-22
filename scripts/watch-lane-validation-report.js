const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_RICK_CONTEXT_PATH = path.join(REPO_ROOT, 'data', 'rick-context', 'latest.json');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'watch-lane-validation-latest.json');

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

function resolveRepoPath(filePath) {
  if (!filePath) {
    return null;
  }

  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

function resolveLatestTelemetry(logDir) {
  const candidates = fs.readdirSync(logDir)
    .filter((name) => name.startsWith('telemetry-') && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return {
        name,
        fullPath,
        stat: fs.statSync(fullPath)
      };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return candidates[0]?.fullPath || null;
}

function parseJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function normalizeName(value) {
  return String(value || '')
    .replace(/^\$/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function displayText(value) {
  return String(value || '').replace(/[^\x20-\x7E\n]/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function parseMarketCap(rawNumber, rawSuffix) {
  const number = Number(rawNumber);
  if (!Number.isFinite(number)) {
    return null;
  }

  const suffix = String(rawSuffix || '').toUpperCase();
  if (suffix === 'B') return number * 1_000_000_000;
  if (suffix === 'M') return number * 1_000_000;
  if (suffix === 'K') return number * 1_000;
  return number;
}

function formatUsdCompact(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function extractRickItems(rickContext) {
  const messages = Array.isArray(rickContext?.messages) ? rickContext.messages : [];
  const items = [];

  for (const message of messages) {
    if (!message.reportType) {
      continue;
    }

    const reportDate = message.date || null;
    const reportType = message.reportType;
    const text = displayText(message.text || '');

    for (const rawLine of text.split('\n')) {
      const line = displayText(rawLine);
      if (!line.includes('@')) {
        continue;
      }

      const match = line.match(/(?:^|\s)([A-Za-z0-9_$?.!-]{2,})\s*@\s*([0-9]+(?:\.[0-9]+)?)\s*([KMB]?)/i);
      if (!match) {
        continue;
      }

      const name = match[1].replace(/^\$/, '');
      const startCapUsd = parseMarketCap(match[2], match[3]);
      const shouldParseMoveCaps = reportType === 'burpLeaderboard' || reportType === 'runnersReport';
      const laterCapMatches = shouldParseMoveCaps
        ? Array.from(line.slice(match.index + match[0].length).matchAll(/([0-9]+(?:\.[0-9]+)?)\s*([KMB])\b/gi))
        : [];
      const laterCaps = laterCapMatches
        .map((capMatch) => parseMarketCap(capMatch[1], capMatch[2]))
        .filter((cap) => Number.isFinite(cap));
      const endCapUsd = laterCaps.length > 0 ? Math.max(...laterCaps) : null;
      const multiplier = Number.isFinite(startCapUsd) && Number.isFinite(endCapUsd) && startCapUsd > 0
        ? endCapUsd / startCapUsd
        : null;

      items.push({
        name,
        normalizedName: normalizeName(name),
        reportType,
        reportDate,
        line,
        startCapUsd,
        endCapUsd,
        multiplier
      });
    }
  }

  return items;
}

function extractExactMintMentions(rickContext) {
  const messages = Array.isArray(rickContext?.messages) ? rickContext.messages : [];
  const mentions = new Map();

  for (const message of messages) {
    const text = displayText(message.text || '');
    const mintMatches = text.match(/\b[1-9A-HJ-NP-Za-km-z]{20,}(?:pump)?\b/g) || [];
    for (const mint of mintMatches) {
      const existing = mentions.get(mint) || [];
      existing.push({
        date: message.date || null,
        reportType: message.reportType || null,
        chatTitle: message.chatTitle || null,
        messageId: message.messageId || null,
        excerpt: text.slice(0, 260)
      });
      mentions.set(mint, existing);
    }
  }

  return mentions;
}

function collectWatchFlags(events) {
  const flags = new Map();
  const counts = new Map();
  let firstTimestamp = null;
  let lastTimestamp = null;
  let sessionStarted = null;
  let sessionStopped = null;

  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) || 0) + 1);
    if (event.timestamp && (!firstTimestamp || event.timestamp < firstTimestamp)) {
      firstTimestamp = event.timestamp;
    }

    if (event.timestamp && (!lastTimestamp || event.timestamp > lastTimestamp)) {
      lastTimestamp = event.timestamp;
    }

    if (event.type === 'session.started') {
      sessionStarted = event.payload || {};
    }

    if (event.type === 'session.stopped') {
      sessionStopped = event.payload || {};
    }

    if (event.type !== 'pre_migration.flagged') {
      continue;
    }

    const payload = event.payload || {};
    const mint = payload.mint || payload.token || 'unknown';
    const existing = flags.get(mint) || {
      mint,
      symbol: payload.symbol || '',
      normalizedSymbol: normalizeName(payload.symbol || ''),
      firstFlagAt: event.timestamp,
      lastFlagAt: event.timestamp,
      maxScore: 0,
      flagCount: 0,
      reasons: new Set(),
      maxRecentVolumeSol: 0,
      maxTradeVelocityPerMin: 0
    };

    existing.symbol = payload.symbol || existing.symbol;
    existing.normalizedSymbol = normalizeName(existing.symbol);
    existing.firstFlagAt = existing.firstFlagAt && existing.firstFlagAt < event.timestamp
      ? existing.firstFlagAt
      : event.timestamp;
    existing.lastFlagAt = existing.lastFlagAt && existing.lastFlagAt > event.timestamp
      ? existing.lastFlagAt
      : event.timestamp;
    existing.maxScore = Math.max(existing.maxScore, Number(payload.score || 0));
    existing.flagCount += 1;
    existing.maxRecentVolumeSol = Math.max(existing.maxRecentVolumeSol, Number(payload.recentVolumeSol || 0));
    existing.maxTradeVelocityPerMin = Math.max(existing.maxTradeVelocityPerMin, Number(payload.tradeVelocityPerMin || 0));
    (payload.reasons || []).forEach((reason) => existing.reasons.add(reason));

    flags.set(mint, existing);
  }

  const runDurationMinutes = firstTimestamp && lastTimestamp
    ? (new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()) / 60000
    : null;

  return {
    summary: {
      firstTimestamp,
      lastTimestamp,
      runDurationMinutes,
      sessionStarted,
      sessionStopped,
      eventCounts: Object.fromEntries(Array.from(counts.entries()).sort((a, b) => b[1] - a[1])),
      uniqueWatchFlags: flags.size,
      totalWatchFlagEvents: counts.get('pre_migration.flagged') || 0
    },
    flags: Array.from(flags.values()).map((flag) => ({
      ...flag,
      reasons: Array.from(flag.reasons)
    }))
  };
}

function matchFlagToRick(flag, rickItems) {
  if (!flag.normalizedSymbol) {
    return [];
  }

  return rickItems
    .map((item) => {
      const exact = flag.normalizedSymbol === item.normalizedName;
      const fuzzy = !exact
        && flag.normalizedSymbol.length >= 4
        && item.normalizedName.length >= 4
        && (flag.normalizedSymbol.includes(item.normalizedName) || item.normalizedName.includes(flag.normalizedSymbol));

      if (!exact && !fuzzy) {
        return null;
      }

      const leadTimeMinutes = item.reportDate && flag.firstFlagAt
        ? (new Date(item.reportDate).getTime() - new Date(flag.firstFlagAt).getTime()) / 60000
        : null;
      const reportWeight = item.reportType === 'runnersReport' ? 4
        : item.reportType === 'burpLeaderboard' ? 3
          : item.reportType === 'trendingDex' ? 2
            : item.reportType === 'trendingPump' ? 2
              : 1;
      const validationScore = (exact ? 4 : 2)
        + reportWeight
        + (leadTimeMinutes !== null && leadTimeMinutes >= 0 ? 2 : -2)
        + (Number.isFinite(item.multiplier) && item.multiplier >= 2 ? 2 : 0)
        + (flag.flagCount > 1 ? 1 : 0);

      return {
        matchType: exact ? 'exact' : 'fuzzy',
        validationScore,
        leadTimeMinutes,
        rick: item
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.validationScore - a.validationScore);
}

function summarizeNameCollisions(rickItems) {
  const buckets = new Map();
  for (const item of rickItems) {
    if (!item.normalizedName) {
      continue;
    }

    const bucket = buckets.get(item.normalizedName) || {
      count: 0,
      reportTypes: new Set(),
      lines: []
    };

    bucket.count += 1;
    bucket.reportTypes.add(item.reportType);
    if (bucket.lines.length < 5) {
      bucket.lines.push(item.line);
    }

    buckets.set(item.normalizedName, bucket);
  }

  return new Map(Array.from(buckets.entries()).map(([name, bucket]) => [
    name,
    {
      count: bucket.count,
      reportTypes: Array.from(bucket.reportTypes),
      lines: bucket.lines
    }
  ]));
}

function classifyValidation(flag, laterMatches, exactMintMentions, nameCollisions) {
  const exactMentions = exactMintMentions.get(flag.mint) || [];
  const laterExactMention = exactMentions.find((mention) => (
    mention.date && flag.firstFlagAt && new Date(mention.date).getTime() >= new Date(flag.firstFlagAt).getTime()
  ));

  if (laterExactMention) {
    return {
      confidence: 'HIGH',
      reason: 'exact_mint_confirmed_after_flag',
      exactMintMentions: exactMentions
    };
  }

  if (exactMentions.length > 0) {
    return {
      confidence: 'HIGH',
      reason: 'exact_mint_confirmed_in_context',
      exactMintMentions: exactMentions
    };
  }

  const exactTickerMatches = laterMatches.filter((match) => match.matchType === 'exact');
  const normalizedSymbol = flag.normalizedSymbol;
  const collision = nameCollisions.get(normalizedSymbol);
  const isSpammyTicker = collision && collision.count >= 4;
  const hasStrongMove = exactTickerMatches.some((match) => Number.isFinite(match.rick.multiplier) && match.rick.multiplier >= 2);
  const hasUsefulLeadTime = exactTickerMatches.some((match) => (
    Number.isFinite(match.leadTimeMinutes) && match.leadTimeMinutes >= 5
  ));

  if (exactTickerMatches.length > 0 && !isSpammyTicker && hasUsefulLeadTime && hasStrongMove) {
    return {
      confidence: 'MEDIUM',
      reason: 'clean_ticker_match_after_flag',
      exactMintMentions,
      nameCollision: collision || null
    };
  }

  if (laterMatches.length > 0) {
    return {
      confidence: 'LOW',
      reason: isSpammyTicker ? 'ticker_reused_or_spammy' : 'weak_or_fuzzy_ticker_match',
      exactMintMentions,
      nameCollision: collision || null
    };
  }

  return {
    confidence: 'UNMATCHED',
    reason: 'no_later_rick_match',
    exactMintMentions,
    nameCollision: collision || null
  };
}

function buildReport(telemetryPath, rickContextPath) {
  const events = parseJsonl(telemetryPath);
  const rickContext = readJson(rickContextPath, { messages: [] });
  const rickItems = extractRickItems(rickContext);
  const exactMintMentions = extractExactMintMentions(rickContext);
  const nameCollisions = summarizeNameCollisions(rickItems);
  const { summary, flags } = collectWatchFlags(events);

  const validations = flags
    .map((flag) => {
      const matches = matchFlagToRick(flag, rickItems);
      const laterMatches = matches.filter((match) => match.leadTimeMinutes !== null && match.leadTimeMinutes >= 0);
      const bestMatch = laterMatches[0] || matches[0] || null;
      const confidence = classifyValidation(flag, laterMatches, exactMintMentions, nameCollisions);

      return {
        ...flag,
        bestMatch,
        confidence: confidence.confidence,
        confidenceReason: confidence.reason,
        exactMintMentions: confidence.exactMintMentions,
        nameCollision: confidence.nameCollision,
        laterMatches,
        allMatches: matches
      };
    })
    .sort((a, b) => {
      const aScore = a.bestMatch?.validationScore || 0;
      const bScore = b.bestMatch?.validationScore || 0;
      if (bScore !== aScore) return bScore - aScore;
      return b.maxScore - a.maxScore;
    });

  const validatedFlags = validations.filter((validation) => validation.laterMatches.length > 0);
  const confidenceCounts = validations.reduce((accumulator, validation) => {
    accumulator[validation.confidence] = (accumulator[validation.confidence] || 0) + 1;
    return accumulator;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    telemetryPath,
    rickContextPath,
    rickGeneratedAt: rickContext.generatedAt || null,
    run: summary,
    rickItems,
    confidenceCounts,
    validatedFlags,
    topUnmatchedFlags: validations
      .filter((validation) => validation.laterMatches.length === 0)
      .sort((a, b) => b.maxScore - a.maxScore)
      .slice(0, 25),
    validations
  };
}

function printReport(report) {
  console.log('Watch Lane Validation Report');
  console.log(`Telemetry: ${report.telemetryPath}`);
  console.log(`Rick context: ${report.rickContextPath}`);
  console.log(`Run duration: ${(report.run.runDurationMinutes || 0).toFixed(2)} min`);
  console.log(`Watch flags: ${report.run.uniqueWatchFlags} unique / ${report.run.totalWatchFlagEvents} events`);
  console.log(`Rick items parsed: ${report.rickItems.length}`);
  console.log(`Validated later matches: ${report.validatedFlags.length}`);
  console.log(`Confidence: ${Object.entries(report.confidenceCounts || {}).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  console.log('');

  const topValidated = report.validatedFlags
    .filter((flag) => flag.confidence !== 'UNMATCHED')
    .sort((a, b) => {
      const weights = { HIGH: 3, MEDIUM: 2, LOW: 1, UNMATCHED: 0 };
      const confidenceDelta = (weights[b.confidence] || 0) - (weights[a.confidence] || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      const aScore = a.bestMatch?.validationScore || 0;
      const bScore = b.bestMatch?.validationScore || 0;
      if (bScore !== aScore) return bScore - aScore;
      return b.maxScore - a.maxScore;
    })
    .slice(0, 12);
  if (topValidated.length === 0) {
    console.log('No later Rick matches found for watch-lane flags.');
  } else {
    console.log('Top Validated Flags:');
    topValidated.forEach((flag, index) => {
      const match = flag.bestMatch;
      const rick = match.rick;
      const lead = Number.isFinite(match.leadTimeMinutes) ? `${match.leadTimeMinutes.toFixed(1)}m lead` : 'lead n/a';
      const move = Number.isFinite(rick.multiplier)
        ? `${rick.multiplier.toFixed(2)}x (${formatUsdCompact(rick.startCapUsd)} -> ${formatUsdCompact(rick.endCapUsd)})`
        : formatUsdCompact(rick.startCapUsd);

      console.log(
        `${index + 1}. [${flag.confidence}] ${flag.symbol || 'unknown'} ${flag.mint} | score=${flag.maxScore.toFixed(2)} flags=${flag.flagCount} | ${lead} | Rick ${rick.reportType}: ${rick.name} ${move}`
      );
      console.log(`   confidence=${flag.confidenceReason}`);
      console.log(`   first=${flag.firstFlagAt} velocity=${flag.maxTradeVelocityPerMin.toFixed(2)}/min volume=${flag.maxRecentVolumeSol.toFixed(4)} SOL`);
      console.log(`   reasons=${flag.reasons.join(', ')}`);
      console.log(`   ${rick.line}`);
    });
  }

  const unmatched = report.topUnmatchedFlags.slice(0, 8);
  if (unmatched.length > 0) {
    console.log('');
    console.log('Top Unmatched Flags:');
    unmatched.forEach((flag, index) => {
      console.log(
        `${index + 1}. ${flag.symbol || 'unknown'} ${flag.mint} | score=${flag.maxScore.toFixed(2)} flags=${flag.flagCount} velocity=${flag.maxTradeVelocityPerMin.toFixed(2)}/min volume=${flag.maxRecentVolumeSol.toFixed(4)} SOL`
      );
    });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveRepoPath(args.telemetry) || resolveLatestTelemetry(DEFAULT_LOG_DIR);
  const rickContextPath = resolveRepoPath(args.rick) || DEFAULT_RICK_CONTEXT_PATH;
  const outputPath = resolveRepoPath(args.output) || DEFAULT_OUTPUT_PATH;

  if (!telemetryPath || !fs.existsSync(telemetryPath)) {
    console.error('No telemetry file found. Pass --telemetry <path> or run a paper session first.');
    process.exit(1);
  }

  if (!fs.existsSync(rickContextPath)) {
    console.error(`Rick context not found at ${rickContextPath}. Run npm run build:rick-context first.`);
    process.exit(1);
  }

  const report = buildReport(telemetryPath, rickContextPath);
  writeJson(outputPath, report);
  printReport(report);
  console.log('');
  console.log(`Wrote JSON report: ${outputPath}`);
}

main();
