const fs = require('fs');
const path = require('path');

const TELEGRAM_CONTEXT_DIR = path.join(__dirname, '..', 'data', 'telegram-context');
const WALLET_COMPARISON_DIR = path.join(__dirname, '..', 'data', 'wallet-comparison');
const WALLET_INTEL_DIR = path.join(__dirname, '..', 'data', 'wallet-intel');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'convergence');
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const BASE58_MINT_PATTERN = /\b[1-9A-HJ-NP-Za-km-z]{32,48}\b/g;

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function getLatestFile(dirPath, pattern) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const matches = fs.readdirSync(dirPath)
    .filter((fileName) => pattern.test(fileName))
    .map((fileName) => path.join(dirPath, fileName))
    .map((filePath) => ({
      filePath,
      stat: fs.statSync(filePath)
    }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return matches[0]?.filePath || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeText(text) {
  return typeof text === 'string' ? text.normalize('NFKD') : '';
}

function extractMints(text) {
  const normalized = normalizeText(text);
  const matches = normalized.match(BASE58_MINT_PATTERN) || [];

  return Array.from(new Set(matches.filter((mint) => mint !== SOL_MINT)));
}

function incrementMap(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function buildTelegramMintMap(telegramContext) {
  const mintMap = new Map();
  const messages = Array.isArray(telegramContext.messages) ? telegramContext.messages : [];

  for (const message of messages) {
    const mints = extractMints(message.text || '');
    if (mints.length === 0) {
      continue;
    }

    for (const mint of mints) {
      if (!mintMap.has(mint)) {
        mintMap.set(mint, {
          mint,
          mentionCount: 0,
          uniqueChatCount: 0,
          chats: new Map(),
          snippets: [],
          firstMentionAt: null,
          lastMentionAt: null
        });
      }

      const bucket = mintMap.get(mint);
      bucket.mentionCount += 1;
      incrementMap(bucket.chats, message.chatTitle || message.username || 'Unknown');

      if (!bucket.firstMentionAt || message.date < bucket.firstMentionAt) {
        bucket.firstMentionAt = message.date;
      }

      if (!bucket.lastMentionAt || message.date > bucket.lastMentionAt) {
        bucket.lastMentionAt = message.date;
      }

      if (bucket.snippets.length < 5) {
        bucket.snippets.push({
          date: message.date,
          chatTitle: message.chatTitle || null,
          username: message.username || null,
          text: normalizeText(message.text || '').slice(0, 280)
        });
      }
    }
  }

  for (const bucket of mintMap.values()) {
    bucket.uniqueChatCount = bucket.chats.size;
    bucket.chats = Array.from(bucket.chats.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([chatTitle, count]) => ({ chatTitle, count }));
  }

  return mintMap;
}

function buildWalletOverlapMap(comparisonData) {
  return new Map(
    (comparisonData.topOverlappingMints || []).map((item) => [item.mint, item])
  );
}

function buildWalletIntelMap(walletIntelData) {
  return new Map(
    (walletIntelData.mintIntel || []).map((item) => [item.mint, item])
  );
}

function scoreConvergence(telegramBucket, overlapBucket, intelBucket) {
  const telegramScore = (telegramBucket.mentionCount * 2) + (telegramBucket.uniqueChatCount * 4);
  const walletTouchCount = Number(overlapBucket?.walletTouchCount || intelBucket?.totalWalletTouches || 0);
  const walletCount = Number(overlapBucket?.walletCount || intelBucket?.topWalletCount || 0);
  const weightedWalletScore = Number(intelBucket?.weightedWalletScore || overlapBucket?.weightedTouchScore || 0);
  const botRejectedCount = Number(overlapBucket?.botRejectedCount || intelBucket?.overlap?.botRejectedCount || 0);
  const botExecutedCount = Number(overlapBucket?.botExecutedCount || intelBucket?.overlap?.botExecutedCount || 0);

  return Number((
    telegramScore +
    walletTouchCount +
    (walletCount * 8) +
    (weightedWalletScore / 25) +
    (botRejectedCount * 0.5) +
    (botExecutedCount * 2)
  ).toFixed(2));
}

function buildReport(telegramContext, comparisonData, walletIntelData) {
  const telegramMintMap = buildTelegramMintMap(telegramContext);
  const walletOverlapMap = buildWalletOverlapMap(comparisonData);
  const walletIntelMap = buildWalletIntelMap(walletIntelData);
  const allMints = new Set([
    ...telegramMintMap.keys(),
    ...walletOverlapMap.keys(),
    ...walletIntelMap.keys()
  ]);

  const convergenceMints = [];
  const telegramOnly = [];
  const walletOnly = [];

  for (const mint of allMints) {
    const telegramBucket = telegramMintMap.get(mint);
    const overlapBucket = walletOverlapMap.get(mint);
    const intelBucket = walletIntelMap.get(mint);

    const hasTelegram = Boolean(telegramBucket);
    const hasWallet = Boolean(overlapBucket || intelBucket);
    const hasBotOverlap = Boolean(overlapBucket);

    const record = {
      mint,
      score: hasTelegram && hasWallet ? scoreConvergence(telegramBucket, overlapBucket, intelBucket) : 0,
      telegram: telegramBucket ? {
        mentionCount: telegramBucket.mentionCount,
        uniqueChatCount: telegramBucket.uniqueChatCount,
        chats: telegramBucket.chats,
        firstMentionAt: telegramBucket.firstMentionAt,
        lastMentionAt: telegramBucket.lastMentionAt,
        snippets: telegramBucket.snippets
      } : null,
      wallet: (overlapBucket || intelBucket) ? {
        walletTouchCount: Number(overlapBucket?.walletTouchCount || intelBucket?.totalWalletTouches || 0),
        walletCount: Number(overlapBucket?.walletCount || intelBucket?.topWalletCount || 0),
        weightedWalletScore: Number(intelBucket?.weightedWalletScore || overlapBucket?.weightedTouchScore || 0),
        topWallets: (overlapBucket?.topWallets || intelBucket?.topWallets || []).slice(0, 5)
      } : null,
      bot: overlapBucket ? {
        botEventCount: overlapBucket.botEventCount || 0,
        botRejectedCount: overlapBucket.botRejectedCount || 0,
        botExecutedCount: overlapBucket.botExecutedCount || 0,
        botClosedCount: overlapBucket.botClosedCount || 0,
        topRejectReason: overlapBucket.rejectionReasons?.[0]?.reason || intelBucket?.overlap?.topRejectReason || null,
        rejectionReasons: overlapBucket.rejectionReasons || intelBucket?.overlap?.rejectionReasons || [],
        pumpFailureReasons: overlapBucket.pumpFailureReasons || []
      } : null
    };

    if (hasTelegram && hasWallet) {
      convergenceMints.push(record);
    } else if (hasTelegram) {
      telegramOnly.push(record);
    } else if (hasWallet) {
      walletOnly.push(record);
    }

    if (hasBotOverlap && !record.bot.topRejectReason && Array.isArray(record.bot.rejectionReasons) && record.bot.rejectionReasons.length > 0) {
      record.bot.topRejectReason = record.bot.rejectionReasons[0].reason;
    }
  }

  convergenceMints.sort((a, b) => b.score - a.score);
  telegramOnly.sort((a, b) => {
    if (b.telegram.mentionCount !== a.telegram.mentionCount) {
      return b.telegram.mentionCount - a.telegram.mentionCount;
    }
    return b.telegram.uniqueChatCount - a.telegram.uniqueChatCount;
  });
  walletOnly.sort((a, b) => {
    if (b.wallet.weightedWalletScore !== a.wallet.weightedWalletScore) {
      return b.wallet.weightedWalletScore - a.wallet.weightedWalletScore;
    }
    return b.wallet.walletTouchCount - a.wallet.walletTouchCount;
  });

  return {
    counts: {
      telegramUniqueMints: telegramMintMap.size,
      walletOverlapMints: walletOverlapMap.size,
      walletIntelMints: walletIntelMap.size,
      convergenceMints: convergenceMints.length,
      telegramOnlyMints: telegramOnly.length,
      walletOnlyMints: walletOnly.length
    },
    topConvergenceMints: convergenceMints.slice(0, 50),
    topTelegramOnlyMints: telegramOnly.slice(0, 25),
    topWalletOnlyMints: walletOnly.slice(0, 25)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const topLimit = Math.max(parseInt(args.top || args._[0] || '15', 10), 1);

  const telegramPath = args.telegram
    ? path.resolve(args.telegram)
    : path.join(TELEGRAM_CONTEXT_DIR, 'latest.json');
  const comparisonPath = args.comparison
    ? path.resolve(args.comparison)
    : getLatestFile(WALLET_COMPARISON_DIR, /^kolscan-paper-overlap-.*\.json$/i);
  const walletIntelPath = args.walletIntel
    ? path.resolve(args.walletIntel)
    : path.join(WALLET_INTEL_DIR, 'latest.json');

  if (!fs.existsSync(telegramPath)) {
    throw new Error('Could not find Telegram context. Run sync:telegram first.');
  }
  if (!comparisonPath || !fs.existsSync(comparisonPath)) {
    throw new Error('Could not find wallet comparison file. Run compare:kolscan first.');
  }
  if (!fs.existsSync(walletIntelPath)) {
    throw new Error('Could not find wallet intel file. Run build:wallet-intel first.');
  }

  const telegramContext = readJson(telegramPath);
  const comparisonData = readJson(comparisonPath);
  const walletIntelData = readJson(walletIntelPath);
  const report = buildReport(telegramContext, comparisonData, walletIntelData);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const payload = {
    source: 'telegram_wallet_paper_convergence',
    generatedAt: new Date().toISOString(),
    telegramContextFile: telegramPath,
    walletComparisonFile: comparisonPath,
    walletIntelFile: walletIntelPath,
    ...report
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `convergence-report-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, 'latest.json');

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Saved convergence report to ${outputPath}`);
  console.log(`Updated latest convergence report at ${latestPath}`);
  console.log(
    `telegramUniqueMints=${payload.counts.telegramUniqueMints} | walletOverlapMints=${payload.counts.walletOverlapMints} | convergenceMints=${payload.counts.convergenceMints}`
  );

  payload.topConvergenceMints.slice(0, topLimit).forEach((item, index) => {
    const topReason = item.bot?.topRejectReason || 'none';
    console.log(
      `${index + 1}. ${item.mint} | score=${item.score} mentions=${item.telegram?.mentionCount || 0} wallets=${item.wallet?.walletCount || 0} botRejected=${item.bot?.botRejectedCount || 0} topReason=${topReason}`
    );
  });
}

try {
  main();
} catch (error) {
  console.error(`Failed to build convergence report: ${error.message}`);
  process.exit(1);
}
