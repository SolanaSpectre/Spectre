const fs = require('fs');
const path = require('path');

const WALLET_ANALYSIS_DIR = path.join(__dirname, '..', 'data', 'wallet-analysis');
const WALLET_COMPARISON_DIR = path.join(__dirname, '..', 'data', 'wallet-comparison');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'wallet-intel');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

function getLatestFile(dirPath, pattern) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const matches = fs.readdirSync(dirPath)
    .filter((fileName) => pattern.test(fileName))
    .map((fileName) => path.join(dirPath, fileName))
    .map((filePath) => ({ filePath, stat: fs.statSync(filePath) }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return matches[0]?.filePath || null;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function daysSince(isoDate) {
  if (!isoDate) {
    return Number.POSITIVE_INFINITY;
  }

  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - ts) / (24 * 60 * 60 * 1000);
}

function getSourceCount(summary, source) {
  return Number((summary.topSources || []).find((item) => item.source === source)?.count || 0);
}

function getTypeCount(summary, type) {
  return Number((summary.topTypes || []).find((item) => item.type === type)?.count || 0);
}

function buildWalletBehavior(summary, walletScore, overlapIndex) {
  const transactionsFetched = Number(summary.transactionsFetched || 0);
  const swapCount = Number(summary.swapCount || 0);
  const transferCount = getTypeCount(summary, 'TRANSFER');
  const unknownCount = getTypeCount(summary, 'UNKNOWN');
  const pumpFunCount = getSourceCount(summary, 'PUMP_FUN');
  const pumpAmmCount = getSourceCount(summary, 'PUMP_AMM');
  const launchlabCount = getSourceCount(summary, 'RAYDIUM_LAUNCHLAB');
  const meteoraCount = getSourceCount(summary, 'METEORA_DAMM_V2');
  const systemCount = getSourceCount(summary, 'SYSTEM_PROGRAM');
  const swapRate = transactionsFetched > 0 ? swapCount / transactionsFetched : 0;
  const transferRate = transactionsFetched > 0 ? transferCount / transactionsFetched : 0;
  const pumpRate = transactionsFetched > 0 ? (pumpFunCount + pumpAmmCount + launchlabCount) / transactionsFetched : 0;
  const recencyDays = daysSince(summary.lastSeenAt);
  const uniqueMintCount = Number((summary.topMints || []).length || 0);
  const topMintCount = Number(summary.topMints?.[0]?.count || 0);
  const concentration = swapCount > 0 ? topMintCount / swapCount : 0;
  const overlap = overlapIndex.get(summary.walletAddress) || null;
  const overlapRejectRate = overlap && overlap.overlapTouchCount > 0
    ? overlap.overlappingMints.reduce((sum, item) => sum + Number(item.botRejectedCount || 0), 0) / overlap.overlapTouchCount
    : 0;

  const flags = [];

  if (recencyDays > 14) {
    flags.push('STALE_ACTIVITY');
  }
  if (swapRate < 0.2) {
    flags.push('LOW_SWAP_ACTIVITY');
  }
  if (transferRate >= 0.5) {
    flags.push('TRANSFER_HEAVY');
  }
  if (pumpRate >= 0.6) {
    flags.push('PUMP_FOCUSED');
  }
  if (pumpRate < 0.2) {
    flags.push('LOW_PUMP_FOCUS');
  }
  if (concentration >= 0.35) {
    flags.push('HIGH_CONCENTRATION');
  }
  if (systemCount >= Math.max(10, transactionsFetched * 0.35)) {
    flags.push('OPS_HEAVY');
  }
  if (unknownCount >= Math.max(8, transactionsFetched * 0.15)) {
    flags.push('UNKNOWN_ACTIVITY');
  }
  if (meteoraCount > 0) {
    flags.push('MULTI_VENUE');
  }
  if (overlapRejectRate >= 3) {
    flags.push('HIGH_REJECT_OVERLAP');
  }

  let behaviorProfile = 'observer';
  if (recencyDays > 30) {
    behaviorProfile = 'stale_wallet';
  } else if (swapRate >= 0.6 && pumpRate >= 0.65) {
    behaviorProfile = 'aggressive_pump_trader';
  } else if (swapRate >= 0.45 && (pumpRate >= 0.35 || launchlabCount > 0 || meteoraCount > 0)) {
    behaviorProfile = 'active_rotator';
  } else if (transferRate >= 0.5 && swapRate < 0.2) {
    behaviorProfile = 'ops_or_funder';
  } else if (pumpRate >= 0.3) {
    behaviorProfile = 'pump_focused';
  }

  let trustTier = 'MIXED';
  if (
    recencyDays <= 7 &&
    swapRate >= 0.45 &&
    pumpRate >= 0.35 &&
    !flags.includes('TRANSFER_HEAVY') &&
    !flags.includes('HIGH_REJECT_OVERLAP') &&
    walletScore.score >= 70
  ) {
    trustTier = 'TRUSTED';
  } else if (
    recencyDays > 30 ||
    behaviorProfile === 'ops_or_funder' ||
    (flags.includes('TRANSFER_HEAVY') && flags.includes('LOW_SWAP_ACTIVITY')) ||
    flags.includes('HIGH_REJECT_OVERLAP')
  ) {
    trustTier = 'AVOID';
  }

  return {
    trustTier,
    behaviorProfile,
    flags,
    metrics: {
      swapRate: Number(swapRate.toFixed(4)),
      transferRate: Number(transferRate.toFixed(4)),
      pumpRate: Number(pumpRate.toFixed(4)),
      recencyDays: Number.isFinite(recencyDays) ? Number(recencyDays.toFixed(2)) : null,
      uniqueMintCount,
      concentration: Number(concentration.toFixed(4)),
      overlapRejectRate: Number(overlapRejectRate.toFixed(4))
    }
  };
}

function computeWalletScore(summary) {
  const rank = Number(summary.rank || 999);
  const rankScore = clamp((101 - Math.min(rank, 100)) / 100, 0, 1);
  const activityScore = clamp(Number(summary.swapCount || 0) / 80, 0, 1);
  const successRate = Number(summary.transactionsFetched || 0) > 0
    ? Number(summary.successCount || 0) / Number(summary.transactionsFetched || 1)
    : 0;
  const uniqueMintScore = clamp((summary.topMints || []).length / 12, 0, 1);

  const pumpRelatedCount = (summary.topSources || [])
    .filter((item) => ['PUMP_FUN', 'PUMP_AMM', 'RAYDIUM_LAUNCHLAB'].includes(item.source))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
  const pumpFocusScore = clamp(
    Number(summary.transactionsFetched || 0) > 0
      ? pumpRelatedCount / Number(summary.transactionsFetched || 1)
      : 0,
    0,
    1
  );

  const composite = (
    (rankScore * 0.35) +
    (activityScore * 0.25) +
    (pumpFocusScore * 0.2) +
    (successRate * 0.1) +
    (uniqueMintScore * 0.1)
  );

  let profile = 'observer';
  if (pumpFocusScore >= 0.5 && activityScore >= 0.65) {
    profile = 'aggressive_pump_trader';
  } else if (activityScore >= 0.55 && uniqueMintScore >= 0.45) {
    profile = 'active_rotator';
  } else if (pumpFocusScore >= 0.35) {
    profile = 'pump_focused';
  }

  return {
    walletAddress: summary.walletAddress,
    name: summary.name || null,
    rank: summary.rank || null,
    score: Number((composite * 100).toFixed(2)),
    profile,
    metrics: {
      rankScore: Number(rankScore.toFixed(4)),
      activityScore: Number(activityScore.toFixed(4)),
      pumpFocusScore: Number(pumpFocusScore.toFixed(4)),
      successRate: Number(successRate.toFixed(4)),
      uniqueMintScore: Number(uniqueMintScore.toFixed(4))
    }
  };
}

function buildMintIntel(walletAnalysis, comparisonData) {
  const walletScores = new Map();
  const walletBehaviors = new Map();
  const mintMap = new Map();
  const walletOverlapIndex = new Map(
    (comparisonData?.topWalletOverlap || []).map((item) => [item.walletAddress, item])
  );

  for (const summary of walletAnalysis.summaries || []) {
    if (!summary || summary.error) {
      continue;
    }

    const walletScore = computeWalletScore(summary);
    walletScores.set(summary.walletAddress, walletScore);
    const walletBehavior = buildWalletBehavior(summary, walletScore, walletOverlapIndex);
    walletBehaviors.set(summary.walletAddress, walletBehavior);

    for (const item of summary.topMints || []) {
      const mint = item.mint;
      if (!mint || mint === SOL_MINT) {
        continue;
      }

      if (!mintMap.has(mint)) {
        mintMap.set(mint, {
          mint,
          topWalletCount: 0,
          totalWalletTouches: 0,
          weightedWalletScore: 0,
          topWallets: [],
          overlap: {
            botRejectedCount: 0,
            botExecutedCount: 0,
            botClosedCount: 0,
            topRejectReason: null,
            rejectionReasons: []
          }
        });
      }

      const bucket = mintMap.get(mint);
      const touchCount = Number(item.count || 0);
      bucket.topWalletCount += 1;
      bucket.totalWalletTouches += touchCount;
      bucket.weightedWalletScore += touchCount * walletScore.score;
      bucket.topWallets.push({
        walletAddress: summary.walletAddress,
        name: summary.name || null,
        rank: summary.rank || null,
        score: walletScore.score,
        profile: walletBehavior.behaviorProfile,
        trustTier: walletBehavior.trustTier,
        flags: walletBehavior.flags,
        touchCount
      });
    }
  }

  const overlapByMint = new Map(
    (comparisonData?.topOverlappingMints || []).map((item) => [item.mint, item])
  );

  for (const bucket of mintMap.values()) {
    bucket.topWallets.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.touchCount - a.touchCount;
    });
    bucket.topWallets = bucket.topWallets.slice(0, 5);
    bucket.weightedWalletScore = Number(bucket.weightedWalletScore.toFixed(2));

    const overlap = overlapByMint.get(bucket.mint);
    if (overlap) {
      bucket.overlap = {
        botRejectedCount: overlap.botRejectedCount || 0,
        botExecutedCount: overlap.botExecutedCount || 0,
        botClosedCount: overlap.botClosedCount || 0,
        topRejectReason: overlap.rejectionReasons?.[0]?.reason || null,
        rejectionReasons: overlap.rejectionReasons || []
      };
    }
  }

  return {
    walletScores: Array.from(walletScores.values())
      .map((walletScore) => ({
        ...walletScore,
        behavior: walletBehaviors.get(walletScore.walletAddress) || null
      }))
      .sort((a, b) => b.score - a.score),
    mintIntel: Array.from(mintMap.values()).sort((a, b) => {
      if (b.weightedWalletScore !== a.weightedWalletScore) {
        return b.weightedWalletScore - a.weightedWalletScore;
      }
      return b.totalWalletTouches - a.totalWalletTouches;
    })
  };
}

function main() {
  const walletAnalysisPath = getLatestFile(WALLET_ANALYSIS_DIR, /^kolscan-wallet-analysis-.*\.json$/i);
  if (!walletAnalysisPath) {
    throw new Error('No wallet analysis file found. Run analyze:kolscan first.');
  }

  const comparisonPath = getLatestFile(WALLET_COMPARISON_DIR, /^kolscan-paper-overlap-.*\.json$/i);
  const walletAnalysis = readJson(walletAnalysisPath);
  const comparisonData = comparisonPath ? readJson(comparisonPath) : null;
  const intel = buildMintIntel(walletAnalysis, comparisonData);

  const payload = {
    source: 'kolscan_wallet_intel',
    generatedAt: new Date().toISOString(),
    walletAnalysisFile: walletAnalysisPath,
    comparisonFile: comparisonPath,
    walletCount: intel.walletScores.length,
    mintCount: intel.mintIntel.length,
    trustTierCounts: intel.walletScores.reduce((acc, item) => {
      const tier = item.behavior?.trustTier || 'UNKNOWN';
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {}),
    topWallets: intel.walletScores.slice(0, 50),
    mintIntel: intel.mintIntel
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `wallet-intel-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, 'latest.json');

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Saved wallet intel to ${outputPath}`);
  console.log(`Updated latest wallet intel at ${latestPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Failed to build wallet intel: ${error.message}`);
  process.exit(1);
}
