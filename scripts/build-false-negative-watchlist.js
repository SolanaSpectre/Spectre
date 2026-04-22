const fs = require('fs');
const path = require('path');

const CONVERGENCE_DIR = path.join(__dirname, '..', 'data', 'convergence');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'watchlists');

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeWatchScore(item) {
  const mentionScore = (item.telegram?.mentionCount || 0) * 5;
  const chatScore = (item.telegram?.uniqueChatCount || 0) * 8;
  const walletTouchScore = Math.min(item.wallet?.walletTouchCount || 0, 25) * 2;
  const weightedWalletScore = (item.wallet?.weightedWalletScore || 0) / 80;
  const rejectionScore = Math.min(item.bot?.botRejectedCount || 0, 250) * 0.2;
  const momentumPenaltyBonus = item.bot?.topRejectReason === 'LOW_PUMP_MOMENTUM' ? 20 : 0;

  return Number((mentionScore + chatScore + walletTouchScore + weightedWalletScore + rejectionScore + momentumPenaltyBonus).toFixed(2));
}

function buildWatchlist(convergenceData, limit) {
  const candidates = (convergenceData.topConvergenceMints || [])
    .filter((item) => item.bot && (item.bot.botRejectedCount || 0) > 0)
    .map((item) => ({
      mint: item.mint,
      watchScore: computeWatchScore(item),
      whyInteresting: [
        `${item.telegram?.mentionCount || 0} Telegram mention(s) across ${item.telegram?.uniqueChatCount || 0} chat(s)`,
        `${item.wallet?.walletCount || 0} tracked wallet(s), ${item.wallet?.walletTouchCount || 0} wallet touch(es)`,
        `${item.bot?.botRejectedCount || 0} bot rejection(s), top reason ${item.bot?.topRejectReason || 'unknown'}`
      ],
      telegram: {
        mentionCount: item.telegram?.mentionCount || 0,
        uniqueChatCount: item.telegram?.uniqueChatCount || 0,
        chats: item.telegram?.chats || [],
        latestMentionAt: item.telegram?.lastMentionAt || null,
        snippets: item.telegram?.snippets || []
      },
      wallet: {
        walletTouchCount: item.wallet?.walletTouchCount || 0,
        walletCount: item.wallet?.walletCount || 0,
        weightedWalletScore: item.wallet?.weightedWalletScore || 0,
        topWallets: item.wallet?.topWallets || []
      },
      bot: {
        botRejectedCount: item.bot?.botRejectedCount || 0,
        botExecutedCount: item.bot?.botExecutedCount || 0,
        topRejectReason: item.bot?.topRejectReason || null,
        rejectionReasons: item.bot?.rejectionReasons || [],
        pumpFailureReasons: item.bot?.pumpFailureReasons || []
      }
    }))
    .sort((a, b) => {
      if (b.watchScore !== a.watchScore) {
        return b.watchScore - a.watchScore;
      }
      return b.bot.botRejectedCount - a.bot.botRejectedCount;
    })
    .slice(0, limit);

  const byReason = new Map();
  for (const item of candidates) {
    const reason = item.bot.topRejectReason || 'UNKNOWN';
    byReason.set(reason, (byReason.get(reason) || 0) + 1);
  }

  return {
    source: 'convergence_false_negative_watchlist',
    generatedAt: new Date().toISOString(),
    count: candidates.length,
    topReasons: Array.from(byReason.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    watchlist: candidates
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = clamp(parseInt(args.limit || args._[0] || '20', 10), 1, 100);
  const convergencePath = args.convergence
    ? path.resolve(args.convergence)
    : path.join(CONVERGENCE_DIR, 'latest.json');

  if (!fs.existsSync(convergencePath)) {
    throw new Error('Could not find convergence report. Run report:convergence first.');
  }

  const convergenceData = readJson(convergencePath);
  const payload = buildWatchlist(convergenceData, limit);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `false-negative-watchlist-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, 'false-negative-watchlist-latest.json');

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Saved false-negative watchlist to ${outputPath}`);
  console.log(`Updated latest false-negative watchlist at ${latestPath}`);
  console.log(`count=${payload.count}`);

  payload.watchlist.slice(0, 10).forEach((item, index) => {
    console.log(
      `${index + 1}. ${item.mint} | watchScore=${item.watchScore} | mentions=${item.telegram.mentionCount} | wallets=${item.wallet.walletCount} | rejected=${item.bot.botRejectedCount} | reason=${item.bot.topRejectReason || 'none'}`
    );
  });
}

try {
  main();
} catch (error) {
  console.error(`Failed to build false-negative watchlist: ${error.message}`);
  process.exit(1);
}
