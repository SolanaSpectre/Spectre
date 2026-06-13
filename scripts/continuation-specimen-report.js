const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { readJsonl } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_RICK_CONTEXT = path.join(REPO_ROOT, 'data', 'rick-context', 'latest.json');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'continuation-specimens');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'continuation-specimens-latest.json');

const DEFAULT_SPECIMEN_SYMBOLS = ['BRO', 'XBT', 'ELONBOAR', 'ROCCO', 'ZENOVA', 'PRINTA', 'MONITOR'];
const RICK_REPORT_WEIGHTS = {
  runnersReport: 3,
  trendingDex: 3,
  burpLeaderboard: 2,
  trendingPump: 1
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args._.push(arg);
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

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function listJsonl(logDir, prefix, limit = 10) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return { name, fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, limit);
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function normalizeSymbol(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) || 0), 0);
}

function minPositive(items, selector) {
  const values = items
    .map((item) => Number(selector(item) || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : null;
}

function maxValue(items, selector) {
  const values = items
    .map((item) => Number(selector(item)))
    .filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function parseAgeHintToHours(ageHint) {
  const value = String(ageHint || '').trim().toLowerCase();
  const match = value.match(/^(\d+(?:\.\d+)?)(m|h|d|mo|y)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount)) return null;
  if (unit === 'm') return amount / 60;
  if (unit === 'h') return amount;
  if (unit === 'd') return amount * 24;
  if (unit === 'mo') return amount * 24 * 30;
  if (unit === 'y') return amount * 24 * 365;
  return null;
}

function ageHoursFromPairCreatedAt(pairCreatedAt, nowMs) {
  const createdAt = Number(pairCreatedAt || 0);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  return (nowMs - createdAt) / 3600000;
}

function uniqueValues(items, selector) {
  return Array.from(new Set(items.map(selector).filter(Boolean)));
}

function txnsFor(pairs, window) {
  const buys = sum(pairs, (pair) => pair?.txns?.[window]?.buys);
  const sells = sum(pairs, (pair) => pair?.txns?.[window]?.sells);
  const total = buys + sells;
  return {
    buys,
    sells,
    total,
    buyRatio: total > 0 ? buys / total : null,
    sellRatio: total > 0 ? sells / total : null
  };
}

function socialLinksFromPair(pair) {
  const websites = Array.isArray(pair?.info?.websites) ? pair.info.websites : [];
  const socials = Array.isArray(pair?.info?.socials) ? pair.info.socials : [];
  const websiteUrl = websites.find((item) => item?.url)?.url || null;
  const twitterUrl = socials.find((item) => {
    const type = String(item?.type || '').toLowerCase();
    const url = String(item?.url || '').toLowerCase();
    return type === 'twitter' || type === 'x' || url.includes('x.com') || url.includes('twitter.com');
  })?.url || null;
  const telegramUrl = socials.find((item) => {
    const type = String(item?.type || '').toLowerCase();
    const url = String(item?.url || '').toLowerCase();
    return type === 'telegram' || url.includes('t.me');
  })?.url || null;

  return {
    websiteUrl,
    twitterUrl,
    telegramUrl,
    socialLinkCount: [websiteUrl, twitterUrl, telegramUrl].filter(Boolean).length
  };
}

function summarizeRickOverlap(overlap = {}) {
  const reportTypes = Array.isArray(overlap.reportTypes) ? overlap.reportTypes : [];
  const weightedScore = reportTypes.reduce((total, type) => total + Number(RICK_REPORT_WEIGHTS[type] || 1), 0);
  const ageHintHours = parseAgeHintToHours(overlap.latestAgeHint);
  return {
    symbol: overlap.symbol || null,
    symbolKey: overlap.symbolKey || normalizeSymbol(overlap.symbol),
    mentions: Number(overlap.mentions || 0),
    socialOverlapScore: Number(overlap.socialOverlapScore || 0),
    weightedReportScore: weightedScore,
    reportTypes,
    firstSeen: overlap.firstSeen || null,
    lastSeen: overlap.lastSeen || null,
    latestAgeHint: overlap.latestAgeHint || null,
    latestAgeHintHours: compact(ageHintHours, 4),
    latestCapUsd: Number(overlap.latestCapUsd || 0) || null,
    maxCapUsd: Number(overlap.maxCapUsd || 0) || null,
    maxTargetCapUsd: Number(overlap.maxTargetCapUsd || 0) || null,
    lines: Array.isArray(overlap.lines) ? overlap.lines : []
  };
}

function chooseTargetSymbols(rickContext, args) {
  const explicit = args.symbols
    ? String(args.symbols).split(',').map((item) => normalizeSymbol(item)).filter(Boolean)
    : args._.map((item) => normalizeSymbol(item)).filter(Boolean);

  if (explicit.length > 0) return Array.from(new Set(explicit));

  const overlapSymbols = (rickContext?.tokenOverlap || [])
    .filter((item) => Number(item.mentions || 0) >= 2 || Number(item.socialOverlapScore || 0) >= 3)
    .map((item) => normalizeSymbol(item.symbolKey || item.symbol));

  return Array.from(new Set([...DEFAULT_SPECIMEN_SYMBOLS, ...overlapSymbols])).filter(Boolean);
}

async function fetchDexPairs(symbol) {
  const url = `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(`${symbol} SOL`)}`;
  const response = await axios.get(url, {
    timeout: 12000,
    headers: { 'User-Agent': 'SpectreContinuationSpecimen/1.0' }
  });
  return Array.isArray(response.data?.pairs) ? response.data.pairs : [];
}

function groupPairsByBaseMint(pairs) {
  const groups = new Map();
  for (const pair of pairs) {
    const mint = pair?.baseToken?.address;
    if (!mint) continue;
    if (!groups.has(mint)) groups.set(mint, []);
    groups.get(mint).push(pair);
  }
  return Array.from(groups.entries()).map(([mint, groupPairs]) => ({ mint, pairs: groupPairs }));
}

function rankPairGroup(group, targetSymbol, rickOverlap, nowMs) {
  const primary = [...group.pairs].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || {};
  const exactSymbol = normalizeSymbol(primary?.baseToken?.symbol) === targetSymbol;
  const liquidityUsd = sum(group.pairs, (pair) => pair?.liquidity?.usd);
  const volume1hUsd = sum(group.pairs, (pair) => pair?.volume?.h1);
  const volume6hUsd = sum(group.pairs, (pair) => pair?.volume?.h6);
  const priceChange1hPct = maxValue(group.pairs, (pair) => pair?.priceChange?.h1) ?? 0;
  const firstPairCreatedAt = minPositive(group.pairs, (pair) => pair?.pairCreatedAt);
  const ageHours = ageHoursFromPairCreatedAt(firstPairCreatedAt, nowMs);
  const ageHintHours = Number(rickOverlap?.latestAgeHintHours);
  const ageHintPenalty = Number.isFinite(ageHintHours) && ageHours !== null
    ? Math.min(Math.abs(ageHours - ageHintHours) / Math.max(ageHintHours, 1), 4)
    : 0;

  return (
    (exactSymbol ? 1000 : 0) +
    Math.min(liquidityUsd / 1000, 180) +
    Math.min(volume1hUsd / 1000, 120) +
    Math.min(volume6hUsd / 5000, 80) +
    Math.min(Math.max(priceChange1hPct, 0), 100) +
    Number(rickOverlap?.weightedReportScore || 0) * 10 -
    ageHintPenalty * 30
  );
}

function summarizePairGroup(group, targetSymbol, rickOverlap, nowMs) {
  const sortedPairs = [...group.pairs].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  const primary = sortedPairs[0] || {};
  const firstPairCreatedAt = minPositive(sortedPairs, (pair) => pair?.pairCreatedAt);
  const ageHours = ageHoursFromPairCreatedAt(firstPairCreatedAt, nowMs);
  const liquidityUsd = sum(sortedPairs, (pair) => pair?.liquidity?.usd);
  const volumeM5Usd = sum(sortedPairs, (pair) => pair?.volume?.m5);
  const volume1hUsd = sum(sortedPairs, (pair) => pair?.volume?.h1);
  const volume6hUsd = sum(sortedPairs, (pair) => pair?.volume?.h6);
  const volume24hUsd = sum(sortedPairs, (pair) => pair?.volume?.h24);
  const txnsM5 = txnsFor(sortedPairs, 'm5');
  const txns1h = txnsFor(sortedPairs, 'h1');
  const txns24h = txnsFor(sortedPairs, 'h24');
  const socials = socialLinksFromPair(primary);

  return {
    mint: group.mint,
    symbol: primary?.baseToken?.symbol || targetSymbol,
    name: primary?.baseToken?.name || null,
    exactSymbolMatch: normalizeSymbol(primary?.baseToken?.symbol) === targetSymbol,
    primaryPairAddress: primary?.pairAddress || null,
    primaryDexId: primary?.dexId || null,
    dexscreenerUrl: primary?.url || null,
    pairCount: sortedPairs.length,
    dexCount: uniqueValues(sortedPairs, (pair) => pair.dexId).length,
    dexes: uniqueValues(sortedPairs, (pair) => pair.dexId),
    firstPairCreatedAt,
    ageHours: compact(ageHours, 4),
    ageDays: ageHours === null ? null : compact(ageHours / 24, 4),
    priceUsd: compact(primary?.priceUsd, 12),
    priceNative: compact(primary?.priceNative, 12),
    liquidityUsd: compact(liquidityUsd, 2),
    fdv: compact(primary?.fdv, 2),
    marketCap: compact(primary?.marketCap, 2),
    volumeM5Usd: compact(volumeM5Usd, 2),
    volume1hUsd: compact(volume1hUsd, 2),
    volume6hUsd: compact(volume6hUsd, 2),
    volume24hUsd: compact(volume24hUsd, 2),
    volumeToLiquidity1h: liquidityUsd > 0 ? compact(volume1hUsd / liquidityUsd, 4) : null,
    volumeToLiquidity6h: liquidityUsd > 0 ? compact(volume6hUsd / liquidityUsd, 4) : null,
    volumeToLiquidity24h: liquidityUsd > 0 ? compact(volume24hUsd / liquidityUsd, 4) : null,
    volumeExpansion1hVs6h: volume6hUsd > 0 ? compact((volume1hUsd * 6) / volume6hUsd, 4) : null,
    volumeExpansion6hVs24h: volume24hUsd > 0 ? compact((volume6hUsd * 4) / volume24hUsd, 4) : null,
    priceChangeM5Pct: compact(primary?.priceChange?.m5, 2),
    priceChange1hPct: compact(primary?.priceChange?.h1, 2),
    priceChange6hPct: compact(primary?.priceChange?.h6, 2),
    priceChange24hPct: compact(primary?.priceChange?.h24, 2),
    txnsM5,
    txns1h,
    txns24h,
    socials,
    rickOverlap,
    topPairs: sortedPairs.slice(0, 5).map((pair) => ({
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
      url: pair.url,
      liquidityUsd: compact(pair?.liquidity?.usd, 2),
      volume1hUsd: compact(pair?.volume?.h1, 2),
      priceChange1hPct: compact(pair?.priceChange?.h1, 2)
    }))
  };
}

function loadRecentDossiers(logDir, limitRuns) {
  return listJsonl(logDir, 'candidate-dossiers-', limitRuns)
    .flatMap((item) => readJsonl(item.fullPath));
}

function summarizeInternalContext(specimen, dossiers) {
  const symbolKey = normalizeSymbol(specimen.symbol);
  const relevant = dossiers.filter((dossier) => {
    const mint = dossier.identity?.mint || dossier.mint;
    const symbol = normalizeSymbol(dossier.identity?.symbol || dossier.symbol);
    return mint === specimen.mint || (symbolKey && symbol === symbolKey);
  });

  const byMint = relevant.filter((dossier) => (dossier.identity?.mint || dossier.mint) === specimen.mint);
  const watch = latestByScore(relevant.filter((dossier) => dossier.source === 'pre_migration_watch'));
  const paper = latestByTime(relevant.filter((dossier) => dossier.source === 'pre_migration_paper'));
  const continuation = latestByScore(byMint.filter((dossier) => dossier.source === 'post_migration_continuation'));

  return {
    matchedDossiers: relevant.length,
    matchedByMint: byMint.length,
    watchLane: watch ? summarizeDossier(watch) : null,
    preMigrationPaper: paper ? summarizeDossier(paper) : null,
    continuationLane: continuation ? summarizeDossier(continuation) : null,
    symbolCollisionInOurLogs: uniqueValues(relevant, (dossier) => dossier.identity?.mint || dossier.mint).length > 1
  };
}

function latestByScore(items) {
  return [...items].sort((a, b) => {
    const scoreDiff = Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
  })[0] || null;
}

function latestByTime(items) {
  return [...items].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))[0] || null;
}

function summarizeDossier(dossier) {
  return {
    timestamp: dossier.timestamp,
    source: dossier.source,
    mint: dossier.identity?.mint || dossier.mint || null,
    symbol: dossier.identity?.symbol || dossier.symbol || null,
    verdict: dossier.gmgnStyle?.verdict || null,
    score: compact(dossier.gmgnStyle?.score, 2),
    reasons: Array.isArray(dossier.gmgnStyle?.reasons) ? dossier.gmgnStyle.reasons.slice(0, 10) : [],
    tags: Array.isArray(dossier.gmgnStyle?.tags) ? dossier.gmgnStyle.tags.slice(0, 10) : [],
    curveProgress: compact(dossier.curve?.progress, 6),
    rejectReason: dossier.continuation?.rejectReason || dossier.paper?.reason || null
  };
}

function scoreContinuation(specimen, internalContext) {
  let score = 0;
  const reasons = [];
  const riskFlags = [];
  const liq = Number(specimen.liquidityUsd || 0);
  const vol1h = Number(specimen.volume1hUsd || 0);
  const vol6h = Number(specimen.volume6hUsd || 0);
  const vtl1h = Number(specimen.volumeToLiquidity1h || 0);
  const vtl24h = Number(specimen.volumeToLiquidity24h || 0);
  const change1h = Number(specimen.priceChange1hPct || 0);
  const change6h = Number(specimen.priceChange6hPct || 0);
  const change24h = Number(specimen.priceChange24hPct || 0);
  const buyRatio1h = Number(specimen.txns1h?.buyRatio || 0);
  const ageHours = Number(specimen.ageHours);
  const rickScore = Number(specimen.rickOverlap?.weightedReportScore || specimen.rickOverlap?.socialOverlapScore || 0);

  score += Math.min(liq / 5000, 18);
  if (liq >= 25000) reasons.push('liquidity_depth');
  if (liq < 15000) riskFlags.push('thin_liquidity');

  score += Math.min(vol1h / 10000, 14);
  if (vol1h >= 25000) reasons.push('one_hour_volume');

  score += Math.min(vtl1h * 4, 14);
  if (vtl1h >= 1) reasons.push('one_hour_volume_to_liquidity');
  if (vtl1h >= 10) riskFlags.push('high_churn');

  score += Math.min(Math.max(change1h, 0) / 3, 13);
  score += Math.min(Math.max(change6h, 0) / 12, 8);
  score += Math.min(Math.max(change24h, 0) / 25, 7);
  if (change1h > 0 && change6h > 0) reasons.push('positive_trend');
  if (change1h < -10) riskFlags.push('negative_one_hour');

  score += Math.min(Math.max(buyRatio1h - 0.45, 0) * 35, 8);
  if (buyRatio1h >= 0.52) reasons.push('buy_pressure');
  if (buyRatio1h < 0.45) riskFlags.push('sell_pressure');

  score += Math.min(rickScore * 2.5, 12);
  if (rickScore >= 3) reasons.push('rick_overlap');

  score += Math.min(Math.max(Number(specimen.pairCount || 0) - 1, 0) * 2.5, 5);
  score += Math.min(Math.max(Number(specimen.dexCount || 0) - 1, 0) * 3, 6);
  if (Number(specimen.pairCount || 0) >= 2) reasons.push('multi_pool');
  if (Number(specimen.dexCount || 0) >= 2) reasons.push('multi_dex');

  score += Math.min(Number(specimen.socials?.socialLinkCount || 0) * 2, 6);
  if (Number(specimen.socials?.socialLinkCount || 0) > 0) reasons.push('social_links');

  if (internalContext?.watchLane) {
    score += 4;
    reasons.push('seen_by_pre_migration_watch');
  }
  if (internalContext?.continuationLane) {
    score += 5;
    reasons.push('seen_by_continuation_observer');
  }

  if (Number.isFinite(ageHours)) {
    if (ageHours < 0.25) {
      riskFlags.push('too_new_caution');
      score -= 2;
    } else if (ageHours >= 24 * 7) {
      reasons.push('legacy_revived');
      score += change1h > 5 && change6h > 10 ? 5 : 1;
    } else if (ageHours >= 24) {
      reasons.push('old_coin_revival');
      score += change1h > 5 ? 4 : 1;
    } else if (ageHours >= 1) {
      score += 3;
    }
  }

  const verticalChase = (
    (change1h >= 175 && vtl1h >= 3) ||
    (change6h >= 500 && vtl24h >= 8) ||
    (change24h >= 900 && vtl24h >= 8)
  );
  if (verticalChase) {
    riskFlags.push('late_vertical_chase');
    score -= 18;
  }

  if (specimen.symbolCollision) {
    riskFlags.push('symbol_collision_unresolved');
    score -= 25;
  }

  return {
    score: compact(Math.max(0, Math.min(score, 100)), 2),
    reasons: Array.from(new Set(reasons)),
    riskFlags: Array.from(new Set(riskFlags))
  };
}

function labelContinuation(specimen, scoreSummary) {
  const riskFlags = new Set(scoreSummary.riskFlags);
  const score = Number(scoreSummary.score || 0);
  const change1h = Number(specimen.priceChange1hPct || 0);
  const ageHours = Number(specimen.ageHours);

  if (riskFlags.has('symbol_collision_unresolved')) return 'continuation_rejected:symbol_collision_unresolved';
  if (riskFlags.has('late_vertical_chase') && score < 78) return 'continuation_rejected:late_vertical_chase';
  if (riskFlags.has('negative_one_hour') && score < 72) return 'continuation_rejected:weak_price_action_after_attention';
  if (riskFlags.has('sell_pressure') && score < 70) return 'continuation_rejected:sell_pressure';
  if (score >= 78) return 'continuation_confirmed';
  if (score >= 65 && Number.isFinite(ageHours) && ageHours >= 24 && change1h > 0) return 'legacy_revived_watch';
  if (score >= 62) return 'continuation_watch';
  return 'continuation_rejected:low_score';
}

function buildShadowPaper(specimen, verdict) {
  const allowed = ['continuation_confirmed', 'continuation_watch', 'legacy_revived_watch'].includes(verdict);
  const priceUsd = Number(specimen.priceUsd || 0);
  if (!allowed || !Number.isFinite(priceUsd) || priceUsd <= 0) {
    return {
      enabled: false,
      reason: allowed ? 'NO_PRICE' : 'VERDICT_NOT_ELIGIBLE'
    };
  }

  const legacy = verdict === 'legacy_revived_watch';
  const entrySlippagePct = Number(process.env.CONTINUATION_PAPER_ENTRY_SLIPPAGE_PCT || 0.01);
  const exitSlippagePct = Number(process.env.CONTINUATION_PAPER_EXIT_SLIPPAGE_PCT || 0.015);
  return {
    enabled: true,
    status: 'OPEN_SNAPSHOT_ONLY',
    entryTime: new Date().toISOString(),
    entryPriceUsd: compact(priceUsd, 12),
    effectiveEntryPriceUsd: compact(priceUsd * (1 + entrySlippagePct), 12),
    entrySlippagePct,
    exitSlippagePct,
    plannedTakeProfitPct: legacy ? 0.6 : 0.35,
    plannedStopLossPct: legacy ? 0.28 : 0.22,
    plannedTrailingStopPct: legacy ? 0.24 : 0.18,
    maxHoldHours: legacy ? 24 : 6,
    note: 'Shadow paper only. No trade execution.'
  };
}

function collisionSummary(groups, targetSymbol) {
  const exactGroups = groups
    .map((group) => {
      const primary = [...group.pairs].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || {};
      const exactSymbol = normalizeSymbol(primary?.baseToken?.symbol) === targetSymbol;
      const liquidityUsd = sum(group.pairs, (pair) => pair?.liquidity?.usd);
      const volume1hUsd = sum(group.pairs, (pair) => pair?.volume?.h1);
      return {
        mint: group.mint,
        symbol: primary?.baseToken?.symbol,
        exactSymbol,
        liquidityUsd,
        volume1hUsd
      };
    })
    .filter((item) => item.exactSymbol && (item.liquidityUsd >= 5000 || item.volume1hUsd >= 5000));

  return {
    exactActiveMintCount: exactGroups.length,
    activeExactMints: exactGroups
      .sort((a, b) => b.volume1hUsd - a.volume1hUsd)
      .slice(0, 8)
      .map((item) => ({
        mint: item.mint,
        symbol: item.symbol,
        liquidityUsd: compact(item.liquidityUsd, 2),
        volume1hUsd: compact(item.volume1hUsd, 2)
      })),
    unresolved: exactGroups.length > 1
  };
}

async function buildSpecimen(symbol, rickOverlap, dossiers, nowMs) {
  const pairs = (await fetchDexPairs(symbol)).filter((pair) => pair?.chainId === 'solana');
  const groups = groupPairsByBaseMint(pairs);
  const exactGroups = groups.filter((group) => {
    const primary = [...group.pairs].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || {};
    return normalizeSymbol(primary?.baseToken?.symbol) === symbol;
  });
  const ranked = exactGroups
    .map((group) => ({
      group,
      rank: rankPairGroup(group, symbol, rickOverlap, nowMs)
    }))
    .sort((a, b) => b.rank - a.rank);
  const best = ranked[0]?.group || null;
  const collision = collisionSummary(groups, symbol);

  if (!best) {
    return {
      symbol,
      status: 'unresolved',
      rickOverlap,
      label: pairs.length > 0 ? 'continuation_rejected:no_exact_symbol_match' : 'continuation_rejected:no_dex_pair_found',
      score: 0,
      reasons: [],
      riskFlags: [pairs.length > 0 ? 'no_exact_symbol_match' : 'no_dex_pair_found'],
      topSearchMatches: pairs.slice(0, 5).map((pair) => ({
        symbol: pair?.baseToken?.symbol || null,
        name: pair?.baseToken?.name || null,
        mint: pair?.baseToken?.address || null,
        dexId: pair?.dexId || null,
        liquidityUsd: compact(pair?.liquidity?.usd, 2),
        volume1hUsd: compact(pair?.volume?.h1, 2),
        url: pair?.url || null
      })),
      shadowPaper: { enabled: false, reason: pairs.length > 0 ? 'NO_EXACT_SYMBOL_MATCH' : 'NO_DEX_PAIR_FOUND' }
    };
  }

  const specimen = summarizePairGroup(best, symbol, rickOverlap, nowMs);
  specimen.symbolCollision = collision.unresolved && !collision.activeExactMints.some((item) => item.mint === specimen.mint && item.volume1hUsd === specimen.volume1hUsd);
  specimen.collision = collision;

  const internalContext = summarizeInternalContext(specimen, dossiers);
  const scoreSummary = scoreContinuation(specimen, internalContext);
  const label = labelContinuation(specimen, scoreSummary);

  return {
    ...specimen,
    status: 'resolved',
    label,
    continuationScore: scoreSummary.score,
    reasons: scoreSummary.reasons,
    riskFlags: scoreSummary.riskFlags,
    internalContext,
    shadowPaper: buildShadowPaper(specimen, label)
  };
}

function printReport(report) {
  console.log('Continuation Specimen Report');
  console.log('============================');
  console.log(`Rick context: ${report.files.rickContextPath || 'n/a'}`);
  console.log(`Generated:    ${report.generatedAt}`);
  console.log(`Specimens:    ${report.specimens.length}`);

  for (const item of report.specimens) {
    const label = item.label || 'unknown';
    const score = item.continuationScore ?? item.score ?? 'n/a';
    const liq = item.liquidityUsd === null || item.liquidityUsd === undefined ? 'n/a' : `$${Math.round(item.liquidityUsd).toLocaleString()}`;
    const vol1h = item.volume1hUsd === null || item.volume1hUsd === undefined ? 'n/a' : `$${Math.round(item.volume1hUsd).toLocaleString()}`;
    const ch1 = item.priceChange1hPct === null || item.priceChange1hPct === undefined ? 'n/a' : `${item.priceChange1hPct}%`;
    console.log(`\n${item.symbol || 'UNKNOWN'} -> ${label} score=${score}`);
    if (item.mint) console.log(`  mint=${item.mint}`);
    if (item.dexscreenerUrl) console.log(`  dex=${item.dexscreenerUrl}`);
    console.log(`  liq=${liq} vol1h=${vol1h} ch1h=${ch1} age=${item.ageHours ?? 'n/a'}h shadow=${item.shadowPaper?.enabled ? 'yes' : 'no'}`);
    if (item.reasons?.length) console.log(`  reasons=${item.reasons.join(',')}`);
    if (item.riskFlags?.length) console.log(`  risks=${item.riskFlags.join(',')}`);
  }

  console.log(`\nWrote JSON report: ${report.files.latestOutputPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rickContextPath = resolveRepoPath(args.rickContext) || DEFAULT_RICK_CONTEXT;
  const logDir = resolveRepoPath(args.logDir) || DEFAULT_LOG_DIR;
  const outputDir = resolveRepoPath(args.outputDir) || DEFAULT_OUTPUT_DIR;
  const latestOutputPath = resolveRepoPath(args.out) || DEFAULT_LATEST_PATH;
  const rickContext = readJson(rickContextPath, { tokenOverlap: [] });
  const nowMs = Date.now();
  const limitRuns = Number(args.limitRuns || 8);
  const dossiers = loadRecentDossiers(logDir, limitRuns);
  const overlapBySymbol = new Map((rickContext.tokenOverlap || []).map((item) => [
    normalizeSymbol(item.symbolKey || item.symbol),
    summarizeRickOverlap(item)
  ]));
  const symbols = chooseTargetSymbols(rickContext, args);
  const specimens = [];

  for (const symbol of symbols) {
    const rickOverlap = overlapBySymbol.get(symbol) || {
      symbol,
      symbolKey: symbol,
      mentions: 0,
      socialOverlapScore: 0,
      weightedReportScore: 0,
      reportTypes: [],
      firstSeen: null,
      lastSeen: null,
      latestAgeHint: null,
      latestAgeHintHours: null,
      lines: []
    };
    try {
      specimens.push(await buildSpecimen(symbol, rickOverlap, dossiers, nowMs));
    } catch (error) {
      specimens.push({
        symbol,
        status: 'error',
        label: 'continuation_rejected:fetch_error',
        error: error.message,
        rickOverlap,
        continuationScore: 0,
        reasons: [],
        riskFlags: ['fetch_error'],
        shadowPaper: { enabled: false, reason: 'FETCH_ERROR' }
      });
    }
    await sleep(Number(args.delayMs || 250));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    files: {
      rickContextPath,
      latestOutputPath,
      outputDir,
      logDir
    },
    source: {
      rickGeneratedAt: rickContext.generatedAt || null,
      rickMessageCount: rickContext.messageCount || 0,
      rickReportTypeCounts: rickContext.reportTypeCounts || {}
    },
    summary: {
      byLabel: specimens.reduce((counts, item) => {
        counts[item.label] = (counts[item.label] || 0) + 1;
        return counts;
      }, {}),
      shadowPaperEnabled: specimens.filter((item) => item.shadowPaper?.enabled).length
    },
    specimens: specimens.sort((a, b) => Number(b.continuationScore || 0) - Number(a.continuationScore || 0))
  };

  const timestampedPath = path.join(outputDir, `continuation-specimens-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeJson(timestampedPath, report);
  writeJson(latestOutputPath, report);
  report.files.timestampedOutputPath = timestampedPath;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`continuation-specimen-report failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildSpecimen,
  scoreContinuation,
  labelContinuation,
  parseAgeHintToHours
};
