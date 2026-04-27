const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_EVENT_FILE = path.join(REPO_ROOT, 'data', 'wallet-events', 'events.jsonl');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'wallet-first-touch');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-first-touch-latest.json');
const DEFAULT_WATCHLIST_PATH = path.join(REPO_ROOT, 'data', 'watchlists', 'wallet-first-touch-watchlist-latest.json');

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
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
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

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, decimals = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : null;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().replace(/^\$/, '').replace(/^\//, '').toUpperCase();
}

function normalizeEvent(event) {
  const wallet = event.wallet || event.payload?.wallet || null;
  const mint = event.mint || event.payload?.mint || null;
  if (!wallet || !mint) return null;

  return {
    wallet,
    mint,
    symbol: event.symbol || event.payload?.symbol || null,
    name: event.name || event.payload?.name || null,
    side: event.side || event.payload?.side || 'unknown',
    tradeAt: event.tradeAt || event.timestamp || event.payload?.tradeAt || null,
    observedAt: event.observedAt || event.timestamp || null,
    watchedReason: event.watchedReason || event.payload?.watchedReason || null,
    walletProfile: event.walletProfile || event.payload?.walletProfile || null,
    amountSol: number(event.amount?.sol ?? event.payload?.solAmount ?? event.payload?.amountSol, 0),
    phase: event.phase || event.payload?.phase || null,
    secondsSinceCreate: number(event.timing?.secondsSinceCreate ?? event.payload?.secondsSinceCreate, null),
    secondsSinceFirstTrade: number(event.timing?.secondsSinceFirstTrade ?? event.payload?.secondsSinceFirstTrade, null),
    marketCapSol: number(event.market?.marketCapSol ?? event.payload?.marketCapSol, null),
    curveProgress: number(event.market?.curveProgress ?? event.payload?.curveProgress, null),
    migrated: Boolean(event.market?.migrated ?? event.payload?.migrated),
    isDeployerTrade: Boolean(event.risk?.isDeployerTrade ?? event.payload?.isDeployerTrade),
    deployerWallet: event.risk?.deployerWallet || event.payload?.deployerWallet || null,
    bundlerCandidate: Boolean(event.risk?.bundlerCandidate ?? event.payload?.bundlerCandidate),
    sniperWalletCount: number(event.risk?.sniperWalletCount ?? event.payload?.sniperWalletCount, 0),
    kolTrustedCount: number(event.risk?.kolTrustedCount ?? event.payload?.kolTrustedCount, 0),
    kolAvoidCount: number(event.risk?.kolAvoidCount ?? event.payload?.kolAvoidCount, 0)
  };
}

function profileWeight(profile = {}) {
  const trustTier = String(profile.trustTier || '').toUpperCase();
  const profileName = String(profile.profile || '').toLowerCase();
  const flags = Array.isArray(profile.flags) ? profile.flags : [];
  let score = 8;

  if (trustTier === 'TRUSTED') score += 25;
  if (trustTier === 'AVOID') score -= 25;
  if (profileName.includes('tracker')) score += 8;
  if (profileName.includes('alpha')) score += 14;
  if (profileName.includes('sniper')) score += 8;
  if (profileName.includes('funder') || profileName.includes('ops')) score -= 12;
  if (flags.includes('TRACKER_ALERTS_ON')) score += 8;
  if (flags.includes('TRACKER_ALERTS_OFF')) score -= 4;
  if (flags.includes('HIGH_REJECT_OVERLAP')) score -= 10;
  if (flags.includes('PUMP_FOCUSED')) score += 8;

  return score;
}

function scoreFirstTouch(firstTouch, cluster) {
  let score = 20;
  const reasons = [];

  if (firstTouch.side === 'buy') {
    score += 12;
    reasons.push('first touch was a buy');
  } else if (firstTouch.side === 'sell') {
    score -= 8;
    reasons.push('first touch was a sell');
  }

  if (firstTouch.phase === 'fresh_launch') {
    score += 10;
    reasons.push('fresh-launch touch');
  } else if (String(firstTouch.phase || '').includes('pre_migration')) {
    score += 8;
    reasons.push('pre-migration touch');
  } else if (firstTouch.phase === 'post_migration') {
    score -= 4;
    reasons.push('post-migration touch');
  }

  const seconds = firstTouch.secondsSinceCreate;
  if (seconds !== null) {
    if (seconds <= 60) {
      score += 16;
      reasons.push('touched within first minute');
    } else if (seconds <= 300) {
      score += 10;
      reasons.push('touched within first five minutes');
    } else if (seconds <= 900) {
      score += 4;
      reasons.push('touched within first fifteen minutes');
    } else {
      score -= 3;
      reasons.push('late first touch');
    }
  }

  if (firstTouch.amountSol >= 2) {
    score += 14;
    reasons.push('large SOL touch');
  } else if (firstTouch.amountSol >= 0.75) {
    score += 8;
    reasons.push('meaningful SOL touch');
  } else if (firstTouch.amountSol > 0 && firstTouch.amountSol < 0.05) {
    score -= 20;
    reasons.push('dust-sized touch');
  }

  score += profileWeight(firstTouch.walletProfile);
  if (firstTouch.walletProfile?.trustTier) reasons.push(`wallet tier ${firstTouch.walletProfile.trustTier}`);
  if (firstTouch.walletProfile?.name) reasons.push(`wallet ${firstTouch.walletProfile.name}`);

  if (firstTouch.isDeployerTrade) {
    score -= 18;
    reasons.push('deployer-side trade');
  }
  if (firstTouch.bundlerCandidate) {
    score -= 10;
    reasons.push('bundler context');
  }
  if (firstTouch.sniperWalletCount >= 4) {
    score -= 8;
    reasons.push('sniper crowding');
  }
  if (firstTouch.kolTrustedCount > 0) {
    score += Math.min(16, firstTouch.kolTrustedCount * 4);
    reasons.push('trusted KOL wallet overlap');
  }
  if (firstTouch.kolAvoidCount > 0) {
    score -= Math.min(16, firstTouch.kolAvoidCount * 4);
    reasons.push('avoid KOL wallet overlap');
  }

  if (cluster.uniqueWalletCount >= 3) {
    score += 20;
    reasons.push('multi-wallet first-touch cluster');
  } else if (cluster.uniqueWalletCount >= 2) {
    score += 10;
    reasons.push('two-wallet first-touch cluster');
  }
  if (cluster.buyWalletCount >= 3) {
    score += 12;
    reasons.push('cluster has multiple first-buy wallets');
  }
  if (cluster.firstTouchWindowSeconds !== null && cluster.firstTouchWindowSeconds <= 120 && cluster.uniqueWalletCount >= 2) {
    score += 12;
    reasons.push('tight first-touch window');
  }
  if (cluster.totalFirstTouchSol >= 3) {
    score += 12;
    reasons.push('cluster SOL size is meaningful');
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons: Array.from(new Set(reasons)).slice(0, 12)
  };
}

function buildFirstTouches(events) {
  const byWalletMint = new Map();

  for (const raw of events) {
    const event = normalizeEvent(raw);
    if (!event) continue;
    const key = `${event.wallet}|${event.mint}`;
    const existing = byWalletMint.get(key);
    if (!existing || String(event.tradeAt || event.observedAt || '') < String(existing.tradeAt || existing.observedAt || '')) {
      byWalletMint.set(key, event);
    }
  }

  return Array.from(byWalletMint.values());
}

function buildClusters(firstTouches) {
  const byMint = new Map();
  for (const touch of firstTouches) {
    if (!byMint.has(touch.mint)) byMint.set(touch.mint, []);
    byMint.get(touch.mint).push(touch);
  }

  const clusters = [];
  for (const [mint, touches] of byMint.entries()) {
    const sorted = touches.sort((a, b) => String(a.tradeAt || '').localeCompare(String(b.tradeAt || '')));
    const times = sorted
      .map((touch) => new Date(touch.tradeAt || touch.observedAt || 0).getTime())
      .filter((time) => Number.isFinite(time) && time > 0);
    const firstTime = times.length ? Math.min(...times) : null;
    const lastTime = times.length ? Math.max(...times) : null;
    const buyTouches = sorted.filter((touch) => touch.side === 'buy');
    const cluster = {
      mint,
      symbol: sorted.find((touch) => touch.symbol)?.symbol || null,
      normalizedSymbol: normalizeSymbol(sorted.find((touch) => touch.symbol)?.symbol),
      name: sorted.find((touch) => touch.name)?.name || null,
      firstSeenAt: firstTime ? new Date(firstTime).toISOString() : null,
      lastFirstTouchAt: lastTime ? new Date(lastTime).toISOString() : null,
      firstTouchWindowSeconds: firstTime && lastTime ? compact((lastTime - firstTime) / 1000, 3) : null,
      uniqueWalletCount: new Set(sorted.map((touch) => touch.wallet)).size,
      buyWalletCount: new Set(buyTouches.map((touch) => touch.wallet)).size,
      sellWalletCount: new Set(sorted.filter((touch) => touch.side === 'sell').map((touch) => touch.wallet)).size,
      totalFirstTouchSol: compact(sorted.reduce((sum, touch) => sum + number(touch.amountSol), 0), 6),
      earliestSecondsSinceCreate: compact(Math.min(...sorted.map((touch) => number(touch.secondsSinceCreate, Infinity))), 3),
      phases: Array.from(new Set(sorted.map((touch) => touch.phase).filter(Boolean))),
      walletNames: Array.from(new Set(sorted.map((touch) => touch.walletProfile?.name).filter(Boolean))).slice(0, 12),
      riskFlags: [],
      firstTouches: sorted
    };

    if (!Number.isFinite(cluster.earliestSecondsSinceCreate)) cluster.earliestSecondsSinceCreate = null;
    if (sorted.some((touch) => touch.bundlerCandidate)) cluster.riskFlags.push('bundler_context');
    if (sorted.some((touch) => touch.isDeployerTrade)) cluster.riskFlags.push('deployer_side_trade');
    if (sorted.some((touch) => touch.sniperWalletCount >= 4)) cluster.riskFlags.push('sniper_crowding');
    clusters.push(cluster);
  }

  for (const cluster of clusters) {
    let bestScore = 0;
    let bestReasons = [];
    cluster.firstTouches = cluster.firstTouches.map((touch) => {
      const scored = scoreFirstTouch(touch, cluster);
      if (scored.score > bestScore) {
        bestScore = scored.score;
        bestReasons = scored.reasons;
      }
      return {
        wallet: touch.wallet,
        walletName: touch.walletProfile?.name || null,
        trustTier: touch.walletProfile?.trustTier || null,
        profile: touch.walletProfile?.profile || null,
        side: touch.side,
        amountSol: compact(touch.amountSol, 6),
        phase: touch.phase,
        tradeAt: touch.tradeAt,
        secondsSinceCreate: compact(touch.secondsSinceCreate, 3),
        marketCapSol: compact(touch.marketCapSol, 6),
        watchedReason: touch.watchedReason,
        reasons: scored.reasons,
        score: scored.score
      };
    });
    cluster.firstTouchScore = bestScore;
    cluster.reasons = bestReasons;
    cluster.recommendation = classifyCluster(cluster);
  }

  return clusters.sort((a, b) => b.firstTouchScore - a.firstTouchScore || b.uniqueWalletCount - a.uniqueWalletCount);
}

function classifyCluster(cluster) {
  if (cluster.riskFlags.includes('deployer_side_trade') || cluster.riskFlags.includes('bundler_context')) {
    return 'watch_only_risk_context';
  }
  if (cluster.firstTouchScore >= 75 && cluster.buyWalletCount >= 2) {
    return 'paper_watch_priority';
  }
  if (cluster.firstTouchScore >= 55) {
    return 'paper_watch';
  }
  return 'archive_signal';
}

function buildWatchlist(clusters, limit) {
  const candidates = clusters
    .filter((cluster) => ['paper_watch_priority', 'paper_watch', 'watch_only_risk_context'].includes(cluster.recommendation))
    .slice(0, limit)
    .map((cluster, index) => ({
      rank: index + 1,
      mint: cluster.mint,
      symbol: cluster.symbol,
      name: cluster.name,
      source: 'wallet_first_touch',
      mode: 'paper_watch_only',
      score: cluster.firstTouchScore,
      recommendation: cluster.recommendation,
      firstSeenAt: cluster.firstSeenAt,
      uniqueWalletCount: cluster.uniqueWalletCount,
      buyWalletCount: cluster.buyWalletCount,
      totalFirstTouchSol: cluster.totalFirstTouchSol,
      walletNames: cluster.walletNames,
      riskFlags: cluster.riskFlags,
      reasons: cluster.reasons
    }));

  return {
    generatedAt: new Date().toISOString(),
    source: 'wallet_first_touch_report',
    mode: 'paper_watch_only',
    count: candidates.length,
    candidates
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const eventFile = resolveRepoPath(args.events, DEFAULT_EVENT_FILE);
  const latestPath = resolveRepoPath(args.output, DEFAULT_LATEST_PATH);
  const watchlistPath = resolveRepoPath(args.watchlist, DEFAULT_WATCHLIST_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const limit = Math.max(parseInt(args.limit || '25', 10), 1);
  const events = readJsonl(eventFile);
  const firstTouches = buildFirstTouches(events);
  const clusters = buildClusters(firstTouches);
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    mode: 'report_only',
    inputs: {
      eventFile,
      eventCount: events.length,
      firstTouchCount: firstTouches.length,
      mintClusterCount: clusters.length
    },
    summary: {
      priorityCount: clusters.filter((cluster) => cluster.recommendation === 'paper_watch_priority').length,
      watchCount: clusters.filter((cluster) => cluster.recommendation === 'paper_watch').length,
      riskContextCount: clusters.filter((cluster) => cluster.recommendation === 'watch_only_risk_context').length,
      archiveCount: clusters.filter((cluster) => cluster.recommendation === 'archive_signal').length
    },
    clusters: clusters.slice(0, limit)
  };
  const archivePath = path.join(reportDir, `wallet-first-touch-${generatedAt.replace(/[:.]/g, '-')}.json`);
  const watchlist = buildWatchlist(clusters, limit);

  writeJson(latestPath, report);
  writeJson(archivePath, report);
  writeJson(watchlistPath, watchlist);

  console.log(`Wallet first-touch clusters: ${clusters.length}`);
  console.log(`Priority paper-watch clusters: ${report.summary.priorityCount}`);
  console.log(`Wrote JSON report: ${latestPath}`);
  console.log(`Wrote watchlist: ${watchlistPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Failed to build wallet first-touch report: ${error.message}`);
  process.exit(1);
}
