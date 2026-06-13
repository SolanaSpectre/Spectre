const fs = require('fs');
const path = require('path');
const { readJsonl } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_BATTLEFIELD_PATH = path.join(REPO_ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'internal-continuation-specimens');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'internal-continuation-specimens-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;

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

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function socialLinksFromDossier(dossier) {
  const continuation = dossier.continuation || {};
  const market = dossier.market || {};
  const websiteUrl = continuation.websiteUrl || null;
  const twitterUrl = continuation.twitterUrl || null;
  const telegramUrl = continuation.telegramUrl || null;
  const socialLinkCount = Number(market.socialLinkCount ?? [websiteUrl, twitterUrl, telegramUrl].filter(Boolean).length);
  return {
    websiteUrl,
    twitterUrl,
    telegramUrl,
    socialLinkCount: Number.isFinite(socialLinkCount) ? socialLinkCount : 0
  };
}

function txns24hFromDossier(dossier) {
  const market = dossier.market || {};
  const buys = Number(market.buys24h || 0);
  const sells = Number(market.sells24h || 0);
  const total = buys + sells;
  return {
    buys,
    sells,
    total,
    buyRatio: total > 0 ? buys / total : null,
    sellRatio: total > 0 ? sells / total : null
  };
}

function riskFlagsFromDossier(dossier) {
  const market = dossier.market || {};
  const flags = new Set();
  const liquidityUsd = Number(market.liquidityUsd || 0);
  const volume1hUsd = Number(market.volume1hUsd || 0);
  const volumeToLiquidity1h = liquidityUsd > 0 ? volume1hUsd / liquidityUsd : null;
  const volumeToLiquidity24h = Number(market.volumeToLiquidity24h || 0);
  const priceChange1hPct = Number(market.priceChange1hPct || 0);
  const priceChange6hPct = Number(market.priceChange6hPct || 0);
  const priceChange24hPct = Number(market.priceChange24hPct || 0);
  const txns24h = txns24hFromDossier(dossier);

  if (liquidityUsd > 0 && liquidityUsd < 15000) flags.add('thin_liquidity');
  if (volumeToLiquidity1h !== null && volumeToLiquidity1h >= 10) flags.add('high_churn');
  if (priceChange1hPct < -10) flags.add('negative_one_hour');
  if (txns24h.buyRatio !== null && txns24h.buyRatio < 0.45) flags.add('sell_pressure');

  const verticalChase = (
    (priceChange1hPct >= 175 && Number(volumeToLiquidity1h || 0) >= 3) ||
    (priceChange6hPct >= 500 && volumeToLiquidity24h >= 8) ||
    (priceChange24hPct >= 900 && volumeToLiquidity24h >= 8)
  );
  if (verticalChase) flags.add('late_vertical_chase');

  return Array.from(flags);
}

function buildShadowPaper(specimen) {
  const priceUsd = Number(specimen.priceUsd || 0);
  if (specimen.label !== 'continuation_confirmed' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return {
      enabled: false,
      reason: specimen.label === 'continuation_confirmed' ? 'NO_PRICE' : 'VERDICT_NOT_ELIGIBLE'
    };
  }

  const entrySlippagePct = Number(process.env.CONTINUATION_PAPER_ENTRY_SLIPPAGE_PCT || 0.01);
  const exitSlippagePct = Number(process.env.CONTINUATION_PAPER_EXIT_SLIPPAGE_PCT || 0.015);
  return {
    enabled: true,
    status: 'OPEN_SNAPSHOT_ONLY',
    entryTime: specimen.lastSeenAt || new Date().toISOString(),
    entryPriceUsd: compact(priceUsd, 12),
    effectiveEntryPriceUsd: compact(priceUsd * (1 + entrySlippagePct), 12),
    entrySlippagePct,
    exitSlippagePct,
    plannedTakeProfitPct: 0.35,
    plannedStopLossPct: 0.22,
    plannedTrailingStopPct: 0.18,
    maxHoldHours: 6,
    note: 'Shadow paper only. Built from SPECTRE internal continuation confirmation.'
  };
}

function specimenFromDossier(dossier) {
  const market = dossier.market || {};
  const identity = dossier.identity || {};
  const score = Number(dossier.gmgnStyle?.score ?? dossier.continuation?.score ?? 0);
  const label = dossier.gmgnStyle?.verdict || null;
  const liquidityUsd = Number(market.liquidityUsd || 0);
  const volume1hUsd = Number(market.volume1hUsd || 0);
  const txns24h = txns24hFromDossier(dossier);
  const specimen = {
    mint: identity.mint || null,
    symbol: identity.symbol || null,
    name: identity.name || null,
    source: 'internal_continuation_lane',
    exactSymbolMatch: true,
    primaryPairAddress: null,
    primaryDexId: market.primaryDexId || null,
    dexscreenerUrl: identity.dexscreenerUrl || dossier.continuation?.dexscreenerUrl || null,
    pairCount: Number(market.pairCount || 0),
    dexCount: Number(market.dexCount || 0),
    dexes: Array.isArray(market.dexes) ? market.dexes : [],
    firstPairCreatedAt: null,
    ageHours: compact(market.ageHours, 4),
    ageDays: compact(Number(market.ageHours || 0) / 24, 4),
    priceUsd: Number(market.priceUsd || 0),
    priceNative: Number(market.priceNative || 0),
    liquidityUsd,
    fdv: null,
    marketCap: null,
    volumeM5Usd: Number(market.volumeM5Usd || 0),
    volume1hUsd,
    volume6hUsd: Number(market.volume6hUsd || 0),
    volume24hUsd: Number(market.volume24hUsd || 0),
    volumeToLiquidity1h: liquidityUsd > 0 ? compact(volume1hUsd / liquidityUsd, 4) : null,
    volumeToLiquidity6h: liquidityUsd > 0 ? compact(Number(market.volume6hUsd || 0) / liquidityUsd, 4) : null,
    volumeToLiquidity24h: compact(market.volumeToLiquidity24h, 4),
    volumeExpansion1hVs6h: compact(market.volumeExpansion1hVs6h, 4),
    volumeExpansion6hVs24h: compact(market.volumeExpansion6hVs24h, 4),
    priceChangeM5Pct: compact(market.priceChangeM5Pct, 4),
    priceChange1hPct: compact(market.priceChange1hPct, 4),
    priceChange6hPct: compact(market.priceChange6hPct, 4),
    priceChange24hPct: compact(market.priceChange24hPct, 4),
    txnsM5: { buys: 0, sells: 0, total: 0, buyRatio: null, sellRatio: null },
    txns1h: { buys: 0, sells: 0, total: 0, buyRatio: null, sellRatio: null },
    txns24h,
    socials: socialLinksFromDossier(dossier),
    rickOverlap: {
      symbol: identity.symbol || null,
      symbolKey: String(identity.symbol || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
      mentions: Number(dossier.walletQuality?.rickMentionCount || 0),
      socialOverlapScore: Number(dossier.walletQuality?.externalMentionCount || 0),
      weightedReportScore: Number(dossier.walletQuality?.externalChatCount || 0),
      reportTypes: ['internalContinuation'],
      firstSeen: dossier.timestamp || null,
      lastSeen: dossier.timestamp || null,
      latestAgeHint: null,
      latestAgeHintHours: null,
      latestCapUsd: null,
      maxCapUsd: null,
      maxTargetCapUsd: null,
      lines: []
    },
    topPairs: [],
    symbolCollision: false,
    collision: { exactActiveMintCount: 1, activeExactMints: [], unresolved: false },
    status: 'resolved',
    label,
    continuationScore: compact(score, 2),
    reasons: Array.isArray(dossier.gmgnStyle?.reasons) ? dossier.gmgnStyle.reasons : [],
    riskFlags: riskFlagsFromDossier(dossier),
    internalContext: {
      matchedDossiers: 1,
      matchedByMint: 1,
      watchLane: null,
      preMigrationPaper: null,
      continuationLane: {
        timestamp: dossier.timestamp,
        source: dossier.source,
        mint: identity.mint || null,
        symbol: identity.symbol || null,
        verdict: label,
        score: compact(score, 2),
        reasons: Array.isArray(dossier.gmgnStyle?.reasons) ? dossier.gmgnStyle.reasons.slice(0, 10) : [],
        tags: Array.isArray(dossier.gmgnStyle?.tags) ? dossier.gmgnStyle.tags.slice(0, 10) : []
      },
      symbolCollisionInOurLogs: false
    },
    lastSeenAt: dossier.timestamp || null
  };

  return {
    ...specimen,
    shadowPaper: buildShadowPaper(specimen)
  };
}

function latestByMint(specimens) {
  const byMint = new Map();
  for (const specimen of specimens) {
    if (!specimen.mint) continue;
    const previous = byMint.get(specimen.mint);
    const previousConfirmed = previous?.label === 'continuation_confirmed';
    const confirmed = specimen.label === 'continuation_confirmed';
    const previousScore = Number(previous?.continuationScore || 0);
    const score = Number(specimen.continuationScore || 0);
    if (!previous || (confirmed && !previousConfirmed) || (confirmed === previousConfirmed && score >= previousScore)) {
      byMint.set(specimen.mint, specimen);
    }
  }
  return Array.from(byMint.values());
}

function buildReport(args) {
  const battlefieldPath = resolveRepoPath(args.battlefield, DEFAULT_BATTLEFIELD_PATH);
  const battlefield = readJson(battlefieldPath, {});
  const dossierPath = resolveRepoPath(args.dossiers, battlefield?.files?.dossierPath);
  const latestPath = resolveRepoPath(args.out, DEFAULT_LATEST_PATH);
  const outputDir = resolveRepoPath(args.outputDir, DEFAULT_OUTPUT_DIR);
  const dossiers = readJsonl(dossierPath);
  const continuationDossiers = dossiers.filter((dossier) => (
    dossier.source === 'post_migration_continuation'
    && ['continuation_confirmed', 'continuation_watch'].includes(dossier.gmgnStyle?.verdict)
  ));
  const specimens = latestByMint(continuationDossiers.map(specimenFromDossier))
    .sort((a, b) => Number(b.continuationScore || 0) - Number(a.continuationScore || 0));
  const generatedAt = new Date().toISOString();
  const timestampedPath = path.join(outputDir, `internal-continuation-specimens-${generatedAt.replace(/[:.]/g, '-')}.json`);
  const report = {
    generatedAt,
    files: {
      battlefieldPath,
      dossierPath,
      latestPath,
      outputDir,
      timestampedPath
    },
    source: {
      continuationDossiers: continuationDossiers.length
    },
    summary: {
      byLabel: specimens.reduce((counts, specimen) => {
        const label = specimen.label || 'unknown';
        counts[label] = (counts[label] || 0) + 1;
        return counts;
      }, {}),
      shadowPaperEnabled: specimens.filter((specimen) => specimen.shadowPaper?.enabled).length
    },
    specimens
  };

  writeJson(latestPath, report);
  writeJson(timestampedPath, report);
  return report;
}

function printReport(report) {
  console.log('Internal Continuation Specimen Report');
  console.log('=====================================');
  console.log(`Continuation dossiers: ${report.source.continuationDossiers}`);
  console.log(`Specimens: ${report.specimens.length}`);
  console.log(`Shadow paper enabled: ${report.summary.shadowPaperEnabled}`);
  for (const specimen of report.specimens.slice(0, 10)) {
    console.log(`  ${specimen.symbol || specimen.mint}: ${specimen.label} score=${specimen.continuationScore} risks=${specimen.riskFlags.join(',') || 'none'}`);
  }
  console.log(`Wrote JSON report: ${report.files.latestPath}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`internal-continuation-specimen-report failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildReport,
  specimenFromDossier
};
