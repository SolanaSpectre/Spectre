const fs = require('fs');
const path = require('path');
const { isRuntimeProviderEvent } = require('./lib/runtime-provider-events');

const TELEMETRY_DIR = path.join(__dirname, '..', 'run-logs');
const WALLET_ANALYSIS_DIR = path.join(__dirname, '..', 'data', 'wallet-analysis');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'wallet-comparison');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

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

function getTelemetryFiles(limit) {
  return fs.readdirSync(TELEMETRY_DIR)
    .filter((fileName) => /^telemetry-.*\.jsonl$/i.test(fileName))
    .map((fileName) => path.join(TELEMETRY_DIR, fileName))
    .map((filePath) => ({
      filePath,
      stat: fs.statSync(filePath)
    }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit)
    .map((entry) => entry.filePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function ensureMintBucket(target, mint) {
  if (!target.has(mint)) {
    target.set(mint, {
      mint,
      eventCount: 0,
      newTokenCount: 0,
      tradeTickCount: 0,
      rejectedCount: 0,
      executedCount: 0,
      closedCount: 0,
      quarantineSkipCount: 0,
      rejectionReasons: new Map(),
      pumpFailureReasons: new Map(),
      sources: new Map(),
      firstSeenAt: null,
      lastSeenAt: null
    });
  }

  return target.get(mint);
}

function incrementMap(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function updateSeenWindow(bucket, timestamp) {
  if (!timestamp) {
    return;
  }

  if (!bucket.firstSeenAt || timestamp < bucket.firstSeenAt) {
    bucket.firstSeenAt = timestamp;
  }

  if (!bucket.lastSeenAt || timestamp > bucket.lastSeenAt) {
    bucket.lastSeenAt = timestamp;
  }
}

function collectBotMintData(telemetryFiles) {
  const botMints = new Map();

  for (const filePath of telemetryFiles) {
    const events = readJsonl(filePath);
    for (const event of events) {
      const payload = event.payload || {};
      const mint = payload.token || payload.mint;
      if (!mint) {
        continue;
      }

      const bucket = ensureMintBucket(botMints, mint);
      bucket.eventCount += 1;
      updateSeenWindow(bucket, event.timestamp);

      if (payload.source) {
        incrementMap(bucket.sources, payload.source);
      }

      if (isRuntimeProviderEvent(event, 'newToken')) bucket.newTokenCount += 1;
      if (isRuntimeProviderEvent(event, 'trade')) bucket.tradeTickCount += 1;

      switch (event.type) {
        case 'trade.rejected':
          bucket.rejectedCount += 1;
          if (payload.reason) {
            incrementMap(bucket.rejectionReasons, payload.reason);
          }
          break;
        case 'trade.executed':
          bucket.executedCount += 1;
          break;
        case 'paper.position.closed':
          bucket.closedCount += 1;
          break;
        case 'pump.momentum_gate_failed':
          if (payload.reason) {
            incrementMap(bucket.pumpFailureReasons, payload.reason);
          }
          break;
        case 'candidate.quarantine_skipped':
          bucket.quarantineSkipCount += 1;
          break;
        default:
          break;
      }
    }
  }

  return botMints;
}

function collectWalletMintData(walletAnalysis) {
  const walletMints = new Map();
  const walletSummaries = Array.isArray(walletAnalysis.summaries) ? walletAnalysis.summaries : [];

  for (const summary of walletSummaries) {
    if (!summary || summary.error) {
      continue;
    }

    const topMints = Array.isArray(summary.topMints) ? summary.topMints : [];
    for (const item of topMints) {
      const mint = item.mint;
      if (!mint || mint === SOL_MINT) {
        continue;
      }

      if (!walletMints.has(mint)) {
        walletMints.set(mint, {
          mint,
          touchCount: 0,
          weightedTouchScore: 0,
          wallets: []
        });
      }

      const bucket = walletMints.get(mint);
      const count = Number(item.count || 0);
      bucket.touchCount += count;
      bucket.weightedTouchScore += count * Math.max(1, 100 - Number(summary.rank || 100));
      bucket.wallets.push({
        walletAddress: summary.walletAddress,
        name: summary.name || null,
        rank: summary.rank || null,
        count
      });
    }
  }

  for (const bucket of walletMints.values()) {
    bucket.wallets.sort((a, b) => {
      if ((a.rank || 9999) !== (b.rank || 9999)) {
        return (a.rank || 9999) - (b.rank || 9999);
      }
      return b.count - a.count;
    });
  }

  return walletMints;
}

function toSortedObject(map, limit = 10, keyName = 'key', valueName = 'count') {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => ({ [keyName]: key, [valueName]: value }));
}

function compare(walletAnalysis, botMints) {
  const walletMints = collectWalletMintData(walletAnalysis);
  const overlaps = [];
  const walletOverlapStats = new Map();

  for (const [mint, walletBucket] of walletMints.entries()) {
    const botBucket = botMints.get(mint);
    if (!botBucket) {
      continue;
    }

    overlaps.push({
      mint,
      walletTouchCount: walletBucket.touchCount,
      weightedTouchScore: Number(walletBucket.weightedTouchScore.toFixed(2)),
      walletCount: walletBucket.wallets.length,
      topWallets: walletBucket.wallets.slice(0, 5),
      botEventCount: botBucket.eventCount,
      botRejectedCount: botBucket.rejectedCount,
      botExecutedCount: botBucket.executedCount,
      botClosedCount: botBucket.closedCount,
      botTradeTickCount: botBucket.tradeTickCount,
      quarantineSkipCount: botBucket.quarantineSkipCount,
      rejectionReasons: toSortedObject(botBucket.rejectionReasons, 10, 'reason', 'count'),
      pumpFailureReasons: toSortedObject(botBucket.pumpFailureReasons, 10, 'reason', 'count'),
      sources: toSortedObject(botBucket.sources, 10, 'source', 'count'),
      firstSeenAt: botBucket.firstSeenAt,
      lastSeenAt: botBucket.lastSeenAt
    });

    for (const wallet of walletBucket.wallets) {
      const key = wallet.walletAddress;
      if (!walletOverlapStats.has(key)) {
        walletOverlapStats.set(key, {
          walletAddress: wallet.walletAddress,
          name: wallet.name || null,
          rank: wallet.rank || null,
          overlapMintCount: 0,
          overlapTouchCount: 0,
          overlappingMints: []
        });
      }

      const stats = walletOverlapStats.get(key);
      stats.overlapMintCount += 1;
      stats.overlapTouchCount += wallet.count;
      stats.overlappingMints.push({
        mint,
        walletTouchCount: wallet.count,
        botRejectedCount: botBucket.rejectedCount,
        botExecutedCount: botBucket.executedCount
      });
    }
  }

  overlaps.sort((a, b) => {
    if (b.walletTouchCount !== a.walletTouchCount) {
      return b.walletTouchCount - a.walletTouchCount;
    }
    return b.botEventCount - a.botEventCount;
  });

  const walletOverlap = Array.from(walletOverlapStats.values())
    .map((wallet) => ({
      ...wallet,
      overlappingMints: wallet.overlappingMints
        .sort((a, b) => b.walletTouchCount - a.walletTouchCount)
        .slice(0, 10)
    }))
    .sort((a, b) => {
      if (b.overlapMintCount !== a.overlapMintCount) {
        return b.overlapMintCount - a.overlapMintCount;
      }
      return b.overlapTouchCount - a.overlapTouchCount;
    });

  const overlapRejectionReasons = new Map();
  const overlapPumpFailureReasons = new Map();

  for (const overlap of overlaps) {
    for (const item of overlap.rejectionReasons) {
      incrementMap(overlapRejectionReasons, item.reason, item.count);
    }
    for (const item of overlap.pumpFailureReasons) {
      incrementMap(overlapPumpFailureReasons, item.reason, item.count);
    }
  }

  return {
    walletMints,
    overlaps,
    walletOverlap,
    overlapRejectionReasons,
    overlapPumpFailureReasons
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryLimit = Math.max(parseInt(args.telemetryLimit || args._[0] || '20', 10), 1);
  const overlapLimit = Math.max(parseInt(args.overlapLimit || args._[1] || '50', 10), 1);
  const walletOverlapLimit = Math.max(parseInt(args.walletOverlapLimit || args._[2] || '25', 10), 1);

  const walletAnalysisPath = args.walletAnalysis
    ? path.resolve(args.walletAnalysis)
    : getLatestFile(WALLET_ANALYSIS_DIR, /^kolscan-wallet-analysis-.*\.json$/i);

  if (!walletAnalysisPath || !fs.existsSync(walletAnalysisPath)) {
    throw new Error('Could not find a Kolscan wallet analysis file. Run analyze:kolscan first.');
  }

  const telemetryFiles = getTelemetryFiles(telemetryLimit);
  if (telemetryFiles.length === 0) {
    throw new Error('Could not find telemetry files to compare against.');
  }

  const walletAnalysis = readJson(walletAnalysisPath);
  const botMints = collectBotMintData(telemetryFiles);
  const comparison = compare(walletAnalysis, botMints);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const payload = {
    source: 'kolscan_wallet_analysis_vs_paper_telemetry',
    generatedAt: new Date().toISOString(),
    walletAnalysisFile: walletAnalysisPath,
    telemetryFiles,
    counts: {
      walletsAnalyzed: Number(walletAnalysis.count || 0),
      uniqueWalletMints: comparison.walletMints.size,
      uniqueBotMints: botMints.size,
      overlappingMints: comparison.overlaps.length
    },
    overlapRejectionReasons: toSortedObject(comparison.overlapRejectionReasons, 15, 'reason', 'count'),
    overlapPumpFailureReasons: toSortedObject(comparison.overlapPumpFailureReasons, 15, 'reason', 'count'),
    topOverlappingMints: comparison.overlaps.slice(0, overlapLimit),
    topWalletOverlap: comparison.walletOverlap.slice(0, walletOverlapLimit)
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `kolscan-paper-overlap-${stamp}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Saved Kolscan vs paper comparison to ${outputPath}`);
  console.log(
    `Wallets analyzed=${payload.counts.walletsAnalyzed} | unique wallet mints=${payload.counts.uniqueWalletMints} | unique bot mints=${payload.counts.uniqueBotMints} | overlaps=${payload.counts.overlappingMints}`
  );

  payload.topOverlappingMints.slice(0, 10).forEach((item, index) => {
    const topReason = item.rejectionReasons[0]?.reason || 'none';
    console.log(
      `${index + 1}. ${item.mint} | walletTouches=${item.walletTouchCount} wallets=${item.walletCount} botRejected=${item.botRejectedCount} topReason=${topReason}`
    );
  });
}

try {
  main();
} catch (error) {
  console.error(`Failed to compare Kolscan wallets to paper telemetry: ${error.message}`);
  process.exit(1);
}
