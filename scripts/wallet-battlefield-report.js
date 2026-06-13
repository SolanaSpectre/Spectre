const fs = require('fs');
const path = require('path');
const { readJsonl } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_WALLET_INTEL = path.join(REPO_ROOT, 'data', 'wallet-intel', 'latest.json');
const DEFAULT_RICK_CONTEXT = path.join(REPO_ROOT, 'data', 'rick-context', 'latest.json');
const DEFAULT_BATTLEFIELD = path.join(REPO_ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'data', 'reports', 'wallet-battlefield-latest.json');

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

function resolveRepoPath(filePath, fallback = null) {
  if (!filePath) return fallback;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function readJson(filePath, fallback = {}) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function getLatestFile(dirPath, pattern) {
  if (!fs.existsSync(dirPath)) return null;
  return fs.readdirSync(dirPath)
    .filter((fileName) => pattern.test(fileName))
    .map((fileName) => {
      const filePath = path.join(dirPath, fileName);
      return { filePath, stat: fs.statSync(filePath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0]?.filePath || null;
}

function compact(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(decimals));
}

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .trim()
    .replace(/^\$/, '')
    .toUpperCase();
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function latestDossiersByMint(dossiers) {
  const byMint = new Map();
  for (const dossier of dossiers) {
    const mint = dossier.identity?.mint;
    if (!mint) continue;
    const current = byMint.get(mint);
    if (!current || String(dossier.timestamp || '') > String(current.timestamp || '')) {
      byMint.set(mint, dossier);
    }
  }
  return byMint;
}

function buildDossierSymbolIndex(dossiersByMint) {
  const bySymbol = new Map();
  for (const dossier of dossiersByMint.values()) {
    const symbol = normalizeSymbol(dossier.identity?.symbol);
    if (!symbol) continue;
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol).push(dossier);
  }
  for (const list of bySymbol.values()) {
    list.sort((a, b) => Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0));
  }
  return bySymbol;
}

function summarizeDossier(dossier) {
  if (!dossier) return null;
  return {
    mint: dossier.identity?.mint || null,
    symbol: dossier.identity?.symbol || null,
    source: dossier.source || null,
    score: compact(dossier.gmgnStyle?.score, 2),
    verdict: dossier.gmgnStyle?.verdict || null,
    tags: Array.isArray(dossier.gmgnStyle?.tags) ? dossier.gmgnStyle.tags.slice(0, 10) : [],
    curveProgress: compact(dossier.curve?.progress, 4),
    liquidityUsd: compact(dossier.market?.liquidityUsd, 2),
    volume1hUsd: compact(dossier.market?.volume1hUsd, 2),
    priceChange1hPct: compact(dossier.market?.priceChange1hPct, 2),
    walletQuality: {
      smartMoneyProxy: compact(dossier.walletQuality?.smartMoneyProxy, 0),
      renownedProxy: compact(dossier.walletQuality?.renownedProxy, 0),
      repeatedEarlyBuyerCount: compact(dossier.walletQuality?.repeatedEarlyBuyerCount, 0),
      rickMentionCount: compact(dossier.walletQuality?.rickMentionCount, 0)
    },
    risk: {
      sniperWalletCount: compact(dossier.risk?.sniperWalletCount, 0),
      bundlerCandidate: dossier.risk?.bundlerCandidate ?? null
    }
  };
}

function summarizeWallet(wallet) {
  return {
    walletAddress: wallet.walletAddress || null,
    name: wallet.name || null,
    rank: wallet.rank || null,
    score: compact(wallet.score, 2),
    trustTier: wallet.behavior?.trustTier || wallet.trustTier || null,
    profile: wallet.behavior?.behaviorProfile || wallet.profile || null,
    flags: Array.isArray(wallet.behavior?.flags)
      ? wallet.behavior.flags
      : (Array.isArray(wallet.flags) ? wallet.flags : [])
  };
}

function summarizeWalletMint(item, dossiersByMint, dossiersBySymbol, rickBySymbol) {
  const topWallets = Array.isArray(item.topWallets) ? item.topWallets : [];
  const trustedWallets = topWallets.filter((wallet) => wallet.trustTier === 'TRUSTED');
  const avoidWallets = topWallets.filter((wallet) => wallet.trustTier === 'AVOID');
  const mixedWallets = topWallets.filter((wallet) => !['TRUSTED', 'AVOID'].includes(wallet.trustTier));
  const activeDossier = dossiersByMint.get(item.mint) || null;
  const activeSymbol = normalizeSymbol(activeDossier?.identity?.symbol);
  const rickOverlap = activeSymbol ? rickBySymbol.get(activeSymbol) || null : null;
  const walletScore = (
    (trustedWallets.length * 25) +
    (mixedWallets.length * 8) -
    (avoidWallets.length * 15) +
    Math.min(Number(item.totalWalletTouches || 0), 60) +
    Math.min(Number(item.weightedWalletScore || 0) / 150, 40)
  );

  let verdict = 'wallet_watch';
  const flags = [];
  if (avoidWallets.length > trustedWallets.length) {
    verdict = 'wallet_caution';
    flags.push('avoid_wallet_dominated');
  }
  if (activeDossier) flags.push('active_in_latest_dossiers');
  if (rickOverlap) flags.push('rick_symbol_overlap');
  if (Number(item.overlap?.botRejectedCount || 0) > 0) flags.push('bot_rejected_before');
  if (Number(item.overlap?.botExecutedCount || 0) > 0) flags.push('bot_executed_before');

  return {
    mint: item.mint,
    symbol: activeDossier?.identity?.symbol || null,
    verdict,
    score: compact(walletScore, 2),
    walletTouchCount: Number(item.totalWalletTouches || 0),
    walletCount: Number(item.topWalletCount || topWallets.length || 0),
    trustedWalletCount: trustedWallets.length,
    avoidWalletCount: avoidWallets.length,
    weightedWalletScore: compact(item.weightedWalletScore, 2),
    topWallets: topWallets.slice(0, 5),
    botOverlap: item.overlap || null,
    activeDossier: summarizeDossier(activeDossier),
    rickOverlap,
    flags
  };
}

function buildRickIndex(rickContext) {
  const bySymbol = new Map();
  for (const item of rickContext.tokenOverlap || []) {
    const symbol = normalizeSymbol(item.symbol);
    if (!symbol) continue;
    bySymbol.set(symbol, {
      symbol: item.symbol,
      reports: item.reportTypes || [],
      mentions: Number(item.mentions || 0),
      socialOverlapScore: Number(item.socialOverlapScore || 0),
      weightedReportScore: Number(item.weightedReportScore || 0),
      latestAgeHintHours: item.latestAgeHintHours ?? null
    });
  }
  return bySymbol;
}

function buildActiveWalletSignals(dossiersByMint, rickBySymbol) {
  return Array.from(dossiersByMint.values())
    .map((dossier) => {
      const walletQuality = dossier.walletQuality || {};
      const risk = dossier.risk || {};
      const symbol = normalizeSymbol(dossier.identity?.symbol);
      const rickOverlap = rickBySymbol.get(symbol) || null;
      const walletSignalScore =
        (Number(walletQuality.smartMoneyProxy || 0) * 18) +
        (Number(walletQuality.renownedProxy || 0) * 8) +
        (Number(walletQuality.repeatedEarlyBuyerCount || 0) * 5) +
        (rickOverlap ? Number(rickOverlap.socialOverlapScore || 0) * 4 : 0) -
        (Number(risk.sniperWalletCount || 0) * 2);

      return {
        ...summarizeDossier(dossier),
        walletSignalScore: compact(walletSignalScore, 2),
        rickOverlap
      };
    })
    .filter((item) => Number(item.walletSignalScore || 0) > 0)
    .sort((a, b) => Number(b.walletSignalScore || 0) - Number(a.walletSignalScore || 0))
    .slice(0, 25);
}

function buildReport(paths, limit = 12) {
  const walletIntel = readJson(paths.walletIntel, { topWallets: [], mintIntel: [] });
  const rickContext = readJson(paths.rickContext, { tokenOverlap: [] });
  const battlefield = readJson(paths.battlefield, {});
  const dossierPath = paths.dossiers
    || resolveRepoPath(battlefield?.files?.dossierPath)
    || getLatestFile(DEFAULT_LOG_DIR, /^candidate-dossiers-.*\.jsonl$/i);
  const dossiers = readJsonl(dossierPath);
  const dossiersByMint = latestDossiersByMint(dossiers);
  const dossiersBySymbol = buildDossierSymbolIndex(dossiersByMint);
  const rickBySymbol = buildRickIndex(rickContext);

  const topTrustedWallets = (walletIntel.topWallets || [])
    .filter((wallet) => (wallet.behavior?.trustTier || wallet.trustTier) === 'TRUSTED')
    .slice(0, limit)
    .map(summarizeWallet);
  const topAvoidWallets = (walletIntel.topWallets || [])
    .filter((wallet) => (wallet.behavior?.trustTier || wallet.trustTier) === 'AVOID')
    .slice(0, limit)
    .map(summarizeWallet);

  const walletMints = (walletIntel.mintIntel || [])
    .map((item) => summarizeWalletMint(item, dossiersByMint, dossiersBySymbol, rickBySymbol))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  const exactActiveWalletMints = walletMints.filter((item) => item.activeDossier).slice(0, limit);
  const cautionWalletMints = walletMints.filter((item) => item.verdict === 'wallet_caution').slice(0, limit);
  const activeWalletSignals = buildActiveWalletSignals(dossiersByMint, rickBySymbol).slice(0, limit);

  const rickWalletSymbolOverlap = Array.from(rickBySymbol.values())
    .map((rick) => {
      const matches = dossiersBySymbol.get(normalizeSymbol(rick.symbol)) || [];
      return {
        ...rick,
        activeDossierCount: matches.length,
        topActiveDossiers: matches.slice(0, 4).map(summarizeDossier)
      };
    })
    .filter((item) => item.activeDossierCount > 0)
    .sort((a, b) => Number(b.socialOverlapScore || 0) - Number(a.socialOverlapScore || 0))
    .slice(0, limit);

  const verdictCounts = countBy(walletMints.slice(0, 100), (item) => item.verdict);

  return {
    generatedAt: new Date().toISOString(),
    files: {
      walletIntelPath: paths.walletIntel,
      rickContextPath: paths.rickContext,
      battlefieldPath: paths.battlefield,
      dossierPath
    },
    walletIntel: {
      generatedAt: walletIntel.generatedAt || null,
      walletCount: walletIntel.walletCount || 0,
      mintCount: walletIntel.mintCount || 0,
      trustTierCounts: walletIntel.trustTierCounts || {},
      topTrustedWallets,
      topAvoidWallets
    },
    context: {
      rickGeneratedAt: rickContext.generatedAt || null,
      rickReportTypeCounts: rickContext.reportTypeCounts || {},
      latestBattlefieldGeneratedAt: battlefield.generatedAt || null,
      latestDossierCount: dossiers.length,
      latestUniqueDossierMints: dossiersByMint.size
    },
    walletMints: {
      verdictCounts,
      exactActiveWalletMints,
      cautionWalletMints,
      topWalletTouchedMints: walletMints.slice(0, limit)
    },
    activeWalletSignals,
    rickWalletSymbolOverlap,
    recommendations: buildRecommendations({
      exactActiveWalletMints,
      activeWalletSignals,
      rickWalletSymbolOverlap,
      cautionWalletMints
    })
  };
}

function buildRecommendations({ exactActiveWalletMints, activeWalletSignals, rickWalletSymbolOverlap, cautionWalletMints }) {
  const recommendations = [];
  if (exactActiveWalletMints.length > 0) {
    recommendations.push({
      posture: 'inspect_exact_wallet_overlap',
      rationale: 'At least one wallet-intel mint is active in latest dossiers; inspect before using it as positive signal.'
    });
  }
  if (activeWalletSignals.some((item) => Number(item.walletSignalScore || 0) >= 20)) {
    recommendations.push({
      posture: 'watch_wallet_supported_candidates',
      rationale: 'Latest dossiers include KOL/repeat-buyer/Rick-supported candidates worth tracking across lanes.'
    });
  }
  if (rickWalletSymbolOverlap.length > 0) {
    recommendations.push({
      posture: 'monitor_symbol_overlap',
      rationale: 'Rick symbols overlap with latest dossiers; useful for continuation/scalper context, but symbol collisions require caution.'
    });
  }
  if (cautionWalletMints.length > 0) {
    recommendations.push({
      posture: 'avoid_dominated_wallet_caution',
      rationale: 'Some historical wallet-touched mints are dominated by AVOID-tier wallets; treat as caution, not alpha.'
    });
  }
  if (recommendations.length === 0) {
    recommendations.push({
      posture: 'no_wallet_edge_detected',
      rationale: 'Wallet intel did not line up with the latest battlefield snapshot.'
    });
  }
  return recommendations;
}

function printReport(report) {
  console.log('Wallet Battlefield Report');
  console.log('=========================');
  console.log(`Wallet intel: ${report.walletIntel.generatedAt || 'n/a'} | wallets=${report.walletIntel.walletCount} mints=${report.walletIntel.mintCount}`);
  console.log(`Rick context: ${report.context.rickGeneratedAt || 'n/a'}`);
  console.log(`Latest dossiers: ${report.context.latestDossierCount} rows / ${report.context.latestUniqueDossierMints} mints`);
  console.log('Trust tiers:', JSON.stringify(report.walletIntel.trustTierCounts));

  console.log('\nActive wallet signals');
  if (report.activeWalletSignals.length === 0) {
    console.log('  none');
  }
  for (const item of report.activeWalletSignals.slice(0, 10)) {
    console.log(`  ${item.symbol || 'unknown'} score=${item.score} walletSignal=${item.walletSignalScore} verdict=${item.verdict || 'n/a'}`);
    console.log(`    ${item.mint}`);
  }

  console.log('\nRick x latest-dossier symbol overlap');
  if (report.rickWalletSymbolOverlap.length === 0) {
    console.log('  none');
  }
  for (const item of report.rickWalletSymbolOverlap.slice(0, 8)) {
    console.log(`  ${item.symbol}: reports=${item.reports.join(',')} activeMatches=${item.activeDossierCount}`);
  }

  console.log('\nWallet-touched exact active mints');
  if (report.walletMints.exactActiveWalletMints.length === 0) {
    console.log('  none');
  }
  for (const item of report.walletMints.exactActiveWalletMints.slice(0, 8)) {
    console.log(`  ${item.symbol || item.mint}: verdict=${item.verdict} trusted=${item.trustedWalletCount} avoid=${item.avoidWalletCount} touches=${item.walletTouchCount}`);
    console.log(`    ${item.mint}`);
  }

  console.log('\nRecommendations');
  for (const item of report.recommendations) {
    console.log(`  ${item.posture}: ${item.rationale}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = {
    walletIntel: resolveRepoPath(args.walletIntel, DEFAULT_WALLET_INTEL),
    rickContext: resolveRepoPath(args.rickContext, DEFAULT_RICK_CONTEXT),
    battlefield: resolveRepoPath(args.battlefield, DEFAULT_BATTLEFIELD),
    dossiers: resolveRepoPath(args.dossiers, null)
  };
  const outputPath = resolveRepoPath(args.output, DEFAULT_OUTPUT);
  const limit = Math.max(parseInt(args.limit || '12', 10), 1);
  const report = buildReport(paths, limit);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  printReport(report);
  console.log(`\nWrote JSON report: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(`wallet-battlefield-report failed: ${error.message}`);
  process.exit(1);
}
