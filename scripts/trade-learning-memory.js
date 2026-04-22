const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DOSSIER_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_CONTINUATION_STATE_PATH = path.join(REPO_ROOT, 'data', 'continuation-paper', 'state.json');
const DEFAULT_WALLET_BATTLEFIELD_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-battlefield-latest.json');
const DEFAULT_WALLET_OUTCOMES_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-outcomes-latest.json');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'trade-learning-memory');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'trade-learning-memory-latest.json');

const DEFAULT_LIMITS = {
  dossierFiles: 80,
  recentTradeSamples: 50,
  minPatternCount: 2
};

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
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function listRecentFiles(dir, prefix, limit) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => path.join(dir, name))
    .map((filePath) => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstFinite(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function curveBand(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) return 'curve:unknown';
  if (value < 0.5) return 'curve:<50';
  if (value < 0.7) return 'curve:50-70';
  if (value < 0.85) return 'curve:70-85';
  if (value < 0.92) return 'curve:85-92';
  if (value < 0.97) return 'curve:92-97';
  return 'curve:97+';
}

function scoreBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return 'score:unknown';
  if (value < 70) return 'score:<70';
  if (value < 80) return 'score:70-80';
  if (value < 84) return 'score:80-84';
  if (value < 90) return 'score:84-90';
  return 'score:90+';
}

function buyerRatioBand(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return 'buy_ratio:unknown';
  if (value < 0.45) return 'buy_ratio:<45';
  if (value < 0.58) return 'buy_ratio:45-58';
  if (value < 0.7) return 'buy_ratio:58-70';
  return 'buy_ratio:70+';
}

function uniqueBuyerRatioBand(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return 'unique_buyer_ratio:unknown';
  if (value < 0.4) return 'unique_buyer_ratio:<40';
  if (value < 0.6) return 'unique_buyer_ratio:40-60';
  if (value < 0.8) return 'unique_buyer_ratio:60-80';
  return 'unique_buyer_ratio:80+';
}

function sniperBand(count) {
  const value = Number(count);
  if (!Number.isFinite(value)) return 'snipers:unknown';
  if (value <= 0) return 'snipers:0';
  if (value <= 3) return 'snipers:1-3';
  if (value <= 7) return 'snipers:4-7';
  return 'snipers:8+';
}

function volumeToLiquidityBand(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'vol_liq:unknown';
  if (numeric < 0.75) return 'vol_liq:<0.75';
  if (numeric < 1.5) return 'vol_liq:0.75-1.5';
  if (numeric < 3) return 'vol_liq:1.5-3';
  return 'vol_liq:3+';
}

function ageBand(hours) {
  const value = Number(hours);
  if (!Number.isFinite(value)) return 'age:unknown';
  if (value < 1) return 'age:<1h';
  if (value < 6) return 'age:1-6h';
  if (value < 24) return 'age:6-24h';
  if (value < 72) return 'age:1-3d';
  return 'age:3d+';
}

function classifyOutcome(returnPct, pnl) {
  const ret = Number(returnPct);
  const pnlValue = Number(pnl);
  if ((Number.isFinite(ret) && ret > 0) || (Number.isFinite(pnlValue) && pnlValue > 0)) return 'winner';
  if ((Number.isFinite(ret) && ret < 0) || (Number.isFinite(pnlValue) && pnlValue < 0)) return 'loser';
  return 'flat';
}

function hasUglyEntrySignals(record) {
  const tags = asArray(record.tags);
  const reasons = asArray(record.reasons);
  const riskFlags = asArray(record.riskFlags);
  const sniperCount = Number(record.sniperWalletCount);
  const buyRatio = Number(record.buyRatio);
  const uniqueBuyerRatio = Number(record.uniqueBuyerRatio);
  const maxDrawdownPct = Number(record.maxDrawdownPct);

  return Boolean(
    tags.includes('sniper_presence')
    || riskFlags.length > 0
    || reasons.includes('old_coin_caution')
    || (Number.isFinite(sniperCount) && sniperCount >= 4)
    || (Number.isFinite(buyRatio) && buyRatio < 0.58)
    || (Number.isFinite(uniqueBuyerRatio) && uniqueBuyerRatio < 0.6)
    || (Number.isFinite(maxDrawdownPct) && maxDrawdownPct < -0.1)
  );
}

function makePatternStats() {
  return {
    count: 0,
    wins: 0,
    losses: 0,
    flats: 0,
    totalReturnPct: 0,
    totalPnlSol: 0,
    totalPnlUsd: 0,
    recoveredBadTrades: 0,
    maxWinPct: null,
    maxLossPct: null,
    examples: []
  };
}

function addPattern(patterns, key, record) {
  if (!key) return;
  if (!patterns[key]) patterns[key] = makePatternStats();
  const stats = patterns[key];
  const returnPct = Number(record.returnPct);
  const pnlSol = Number(record.pnlSol);
  const pnlUsd = Number(record.pnlUsd);

  stats.count += 1;
  if (record.outcome === 'winner') stats.wins += 1;
  else if (record.outcome === 'loser') stats.losses += 1;
  else stats.flats += 1;

  if (Number.isFinite(returnPct)) {
    stats.totalReturnPct += returnPct;
    stats.maxWinPct = stats.maxWinPct === null ? returnPct : Math.max(stats.maxWinPct, returnPct);
    stats.maxLossPct = stats.maxLossPct === null ? returnPct : Math.min(stats.maxLossPct, returnPct);
  }
  if (Number.isFinite(pnlSol)) stats.totalPnlSol += pnlSol;
  if (Number.isFinite(pnlUsd)) stats.totalPnlUsd += pnlUsd;
  if (record.recoveredBadTrade) stats.recoveredBadTrades += 1;

  if (stats.examples.length < 5) {
    stats.examples.push({
      lane: record.lane,
      symbol: record.symbol,
      mint: record.mint,
      outcome: record.outcome,
      returnPct: compact(record.returnPct, 4),
      exitReason: record.exitReason,
      preset: record.preset,
      guardOverride: record.guardOverride
    });
  }
}

function finalizePatternStats(patterns, minCount) {
  return Object.entries(patterns)
    .map(([key, stats]) => ({
      key,
      count: stats.count,
      wins: stats.wins,
      losses: stats.losses,
      flats: stats.flats,
      winRate: compact(stats.count > 0 ? stats.wins / stats.count : null, 4),
      avgReturnPct: compact(stats.count > 0 ? stats.totalReturnPct / stats.count : null, 4),
      totalPnlSol: compact(stats.totalPnlSol, 6),
      totalPnlUsd: compact(stats.totalPnlUsd, 4),
      recoveredBadTrades: stats.recoveredBadTrades,
      maxWinPct: compact(stats.maxWinPct, 4),
      maxLossPct: compact(stats.maxLossPct, 4),
      examples: stats.examples
    }))
    .filter((stats) => stats.count >= minCount)
    .sort((a, b) => {
      const scoreA = (Number(a.avgReturnPct) || 0) + (Number(a.winRate) || 0) * 0.2;
      const scoreB = (Number(b.avgReturnPct) || 0) + (Number(b.winRate) || 0) * 0.2;
      return scoreB - scoreA;
    });
}

function normalizeDossierTrade(entry, exit) {
  const identity = exit.identity || entry.identity || {};
  const paper = exit.paper || {};
  const entryPaper = entry.paper || {};
  const gmgn = entry.gmgnStyle || exit.gmgnStyle || {};
  const curve = entry.curve || exit.curve || {};
  const activity = entry.activity || exit.activity || {};
  const walletQuality = entry.walletQuality || exit.walletQuality || {};
  const risk = entry.risk || exit.risk || {};
  const returnPct = firstFinite(paper.returnPct, paper.pnlPercent);
  const pnlSol = firstFinite(paper.pnlSol);
  const outcome = classifyOutcome(returnPct, pnlSol);

  const record = {
    lane: 'pre_migration',
    mint: identity.mint || null,
    symbol: identity.symbol || null,
    name: identity.name || null,
    enteredAt: entry.timestamp || null,
    exitedAt: exit.timestamp || null,
    preset: paper.preset || entryPaper.preset || null,
    guardOverride: entryPaper.guardOverride || entry.paper?.guard?.override || null,
    exitReason: paper.reason || null,
    outcome,
    returnPct,
    pnlSol,
    score: firstFinite(entry.gmgnStyle?.score, exit.gmgnStyle?.score),
    curveProgress: firstFinite(entry.curve?.progress, entry.curve?.progressPct ? entry.curve.progressPct / 100 : null),
    maxCurveProgress: firstFinite(paper.maxCurveProgress, exit.curve?.progress),
    buyRatio: firstFinite(activity.buyRatio),
    uniqueBuyerRatio: firstFinite(activity.uniqueBuyerRatio, walletQuality.uniqueBuyerRatio),
    recentVolumeSol: firstFinite(activity.recentVolumeSol),
    tradeVelocityPerMin: firstFinite(activity.tradeVelocityPerMin),
    repeatedEarlyBuyerCount: firstFinite(walletQuality.repeatedEarlyBuyerCount),
    externalMentionCount: firstFinite(walletQuality.externalMentionCount),
    kolTrustedCount: firstFinite(walletQuality.kolTrustedCount, walletQuality.renownedProxy),
    sniperWalletCount: firstFinite(risk.sniperWalletCount),
    bundlerCandidate: Boolean(risk.bundlerCandidate),
    tags: asArray(gmgn.tags),
    reasons: asArray(gmgn.reasons),
    riskFlags: [],
    sourceFile: entry.__file || exit.__file || null
  };
  record.recoveredBadTrade = record.outcome === 'winner' && hasUglyEntrySignals(record);
  return record;
}

function collectPreMigrationTrades(dossierDir, limit) {
  const files = listRecentFiles(dossierDir, 'candidate-dossiers-', limit);
  const entriesByKey = {};
  const trades = [];
  const unmatchedExits = [];

  for (const filePath of files.reverse()) {
    const rows = readJsonl(filePath).map((row) => ({ ...row, __file: filePath }));
    for (const row of rows) {
      if (row.source !== 'pre_migration_paper') continue;
      const mint = row.identity?.mint;
      const preset = row.paper?.preset || 'unknown';
      const key = `${mint || 'unknown'}::${preset}`;
      if (row.eventType === 'pre_migration_paper.entry') {
        if (!entriesByKey[key]) entriesByKey[key] = [];
        entriesByKey[key].push(row);
        continue;
      }
      if (row.eventType !== 'pre_migration_paper.exit') continue;

      const entries = entriesByKey[key] || [];
      const entry = entries.length > 0 ? entries.shift() : null;
      if (!entry) {
        unmatchedExits.push(row);
        continue;
      }
      trades.push(normalizeDossierTrade(entry, row));
    }
  }

  return { trades, unmatchedExits: unmatchedExits.length, files };
}

function collectContinuationTrades(statePath) {
  const state = readJson(statePath, { positions: [] });
  return asArray(state.positions).map((position) => {
    const returnPct = firstFinite(position.returnPct);
    const pnlUsd = firstFinite(position.pnlUsd);
    const outcome = classifyOutcome(returnPct, pnlUsd);
    const snapshot = position.entrySnapshot || {};
    const rickOverlap = snapshot.rickOverlap || {};
    const record = {
      lane: 'continuation',
      mint: position.mint || null,
      symbol: position.symbol || null,
      name: position.name || null,
      enteredAt: position.openedAt || null,
      exitedAt: position.closedAt || null,
      status: position.status || null,
      preset: position.sourceLabel || null,
      guardOverride: null,
      exitReason: position.exitReason || null,
      outcome,
      returnPct,
      pnlUsd,
      score: firstFinite(position.entryScore),
      liquidityUsd: firstFinite(snapshot.liquidityUsd),
      volume1hUsd: firstFinite(snapshot.volume1hUsd),
      volumeToLiquidity1h: firstFinite(snapshot.volumeToLiquidity1h),
      priceChange1hPct: firstFinite(snapshot.priceChange1hPct),
      ageHours: firstFinite(snapshot.ageHours),
      rickMentions: firstFinite(rickOverlap.mentions),
      rickWeightedReportScore: firstFinite(rickOverlap.weightedReportScore),
      rickReportTypes: asArray(rickOverlap.reportTypes),
      tags: asArray(position.entryReasons),
      reasons: asArray(position.entryReasons),
      riskFlags: asArray(position.entryRiskFlags),
      maxDrawdownPct: firstFinite(position.maxDrawdownPct),
      maxUnrealizedReturnPct: firstFinite(position.maxUnrealizedReturnPct)
    };
    record.recoveredBadTrade = record.outcome === 'winner' && hasUglyEntrySignals(record);
    return record;
  });
}

function buildPatterns(trades, minPatternCount) {
  const patterns = {};
  for (const trade of trades) {
    const keys = [
      `lane:${trade.lane}`,
      trade.preset ? `preset:${trade.preset}` : null,
      trade.guardOverride ? `guard:${trade.guardOverride}` : null,
      trade.exitReason ? `exit:${trade.exitReason}` : null,
      scoreBand(trade.score),
      trade.lane === 'pre_migration' ? curveBand(trade.curveProgress) : null,
      trade.lane === 'pre_migration' ? buyerRatioBand(trade.buyRatio) : null,
      trade.lane === 'pre_migration' ? uniqueBuyerRatioBand(trade.uniqueBuyerRatio) : null,
      trade.lane === 'pre_migration' ? sniperBand(trade.sniperWalletCount) : null,
      trade.lane === 'continuation' ? volumeToLiquidityBand(trade.volumeToLiquidity1h) : null,
      trade.lane === 'continuation' ? ageBand(trade.ageHours) : null,
      Number(trade.repeatedEarlyBuyerCount) >= 3 ? 'wallet:repeat_early_buyers' : null,
      Number(trade.kolTrustedCount) > 0 ? 'wallet:kol_or_renowned' : null,
      Number(trade.rickMentions) > 0 ? 'social:rick_overlap' : null,
      trade.riskFlags.length > 0 ? 'risk:flagged' : null,
      trade.recoveredBadTrade ? 'outcome:recovered_bad_trade' : null
    ].filter(Boolean);

    for (const tag of asArray(trade.tags).slice(0, 12)) {
      keys.push(`tag:${tag}`);
    }
    for (const reportType of asArray(trade.rickReportTypes)) {
      keys.push(`rick:${reportType}`);
    }
    for (const key of keys) addPattern(patterns, key, trade);
  }
  return finalizePatternStats(patterns, minPatternCount);
}

function summarizeTrades(trades) {
  const closed = trades.filter((trade) => trade.status !== 'OPEN');
  const wins = closed.filter((trade) => trade.outcome === 'winner').length;
  const losses = closed.filter((trade) => trade.outcome === 'loser').length;
  const recoveredBadTrades = closed.filter((trade) => trade.recoveredBadTrade).length;
  const totalPnlSol = closed.reduce((sum, trade) => sum + (Number(trade.pnlSol) || 0), 0);
  const totalPnlUsd = closed.reduce((sum, trade) => sum + (Number(trade.pnlUsd) || 0), 0);
  const totalReturnPct = closed.reduce((sum, trade) => sum + (Number(trade.returnPct) || 0), 0);
  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    wins,
    losses,
    flats: closed.length - wins - losses,
    winRate: compact(closed.length > 0 ? wins / closed.length : null, 4),
    avgReturnPct: compact(closed.length > 0 ? totalReturnPct / closed.length : null, 4),
    totalPnlSol: compact(totalPnlSol, 6),
    totalPnlUsd: compact(totalPnlUsd, 4),
    recoveredBadTrades
  };
}

function buildLessons(patterns) {
  const reward = patterns
    .filter((pattern) => pattern.count >= 2 && (Number(pattern.avgReturnPct) > 0.05 || Number(pattern.winRate) >= 0.6))
    .slice(0, 12)
    .map((pattern) => ({
      action: 'reward',
      pattern: pattern.key,
      evidence: {
        count: pattern.count,
        winRate: pattern.winRate,
        avgReturnPct: pattern.avgReturnPct,
        totalPnlSol: pattern.totalPnlSol,
        totalPnlUsd: pattern.totalPnlUsd
      }
    }));

  const penalize = patterns
    .filter((pattern) => pattern.count >= 2 && (Number(pattern.avgReturnPct) < -0.08 || Number(pattern.winRate) <= 0.35))
    .sort((a, b) => (Number(a.avgReturnPct) || 0) - (Number(b.avgReturnPct) || 0))
    .slice(0, 12)
    .map((pattern) => ({
      action: 'penalize',
      pattern: pattern.key,
      evidence: {
        count: pattern.count,
        winRate: pattern.winRate,
        avgReturnPct: pattern.avgReturnPct,
        totalPnlSol: pattern.totalPnlSol,
        totalPnlUsd: pattern.totalPnlUsd
      }
    }));

  return {
    reward,
    penalize,
    guidance: [
      'Report-only memory: do not mutate live or paper config automatically from this file.',
      'Recovered-bad trades should be studied separately: they often reveal rough entries with useful survivor traits.',
      'Patterns with fewer than two examples are intentionally withheld from reward/penalty recommendations.'
    ]
  };
}

function buildWalletMemory(walletBattlefield) {
  const walletIntel = walletBattlefield?.walletIntel || {};
  const activeSignals = asArray(walletBattlefield?.activeWalletSignals);
  const overlap = asArray(walletBattlefield?.rickWalletSymbolOverlap);
  return {
    sourceGeneratedAt: walletBattlefield?.generatedAt || null,
    walletIntelGeneratedAt: walletIntel.generatedAt || null,
    trustTierCounts: walletIntel.trustTierCounts || {},
    activeWalletSignalCount: activeSignals.length,
    activeSignals: activeSignals.slice(0, 20).map((item) => ({
      symbol: item.symbol || null,
      mint: item.mint || null,
      score: item.score ?? null,
      walletSignalScore: item.walletSignalScore ?? item.walletSignal ?? null,
      verdict: item.verdict || null,
      reasons: item.reasons || []
    })),
    rickWalletSymbolOverlap: overlap.slice(0, 20),
    caution: walletIntel.generatedAt
      ? 'Wallet intel is useful memory, but refresh cadence matters before promoting wallet signals into hard gates.'
      : 'Wallet intel unavailable.'
  };
}

function buildWalletOutcomeMemory(walletOutcomes) {
  const records = asArray(walletOutcomes?.allRecords);
  const byRecommendation = walletOutcomes?.summary?.byRecommendation || {};
  const realizedRecords = records.filter((record) => record.walletRealizedPnl);
  const positiveSkipReviews = records.filter((record) => record.recommendation === 'review_wallet_pnl_positive_skip');
  const reinforcedTrades = records.filter((record) => record.recommendation === 'reinforce_wallet_supported_trade');
  const profitableAvoid = records.filter((record) => record.recommendation === 'study_profitable_avoid_wallet_behavior');
  const negativeTradePenalties = records.filter((record) => record.recommendation === 'penalize_wallet_pnl_negative_trade');

  function summarizeRecord(record) {
    return {
      mint: record.mint,
      symbol: record.symbol || null,
      recommendation: record.recommendation,
      trustedTouches: record.wallet?.trustedTouches || 0,
      avoidTouches: record.wallet?.avoidTouches || 0,
      spectreSkipped: Boolean(record.spectre?.skipped),
      spectreTraded: Boolean(record.spectre?.traded),
      topRejectReason: record.spectre?.topRejectReason || null,
      bestWatchScore: record.spectre?.bestWatchScore ?? null,
      walletRealizedPnl: record.walletRealizedPnl ? {
        walletCount: record.walletRealizedPnl.walletCount,
        realizedWalletCount: record.walletRealizedPnl.realizedWalletCount,
        winnerWalletCount: record.walletRealizedPnl.winnerWalletCount,
        loserWalletCount: record.walletRealizedPnl.loserWalletCount,
        totalRealizedPnlSol: record.walletRealizedPnl.totalRealizedPnlSol,
        topWallets: asArray(record.walletRealizedPnl.topWallets).slice(0, 5)
      } : null,
      spectreOutcome: record.outcome ? `${record.outcome.bestOutcome}/${record.outcome.worstOutcome}` : null
    };
  }

  return {
    sourceGeneratedAt: walletOutcomes?.generatedAt || null,
    realizedPnlMints: walletOutcomes?.summary?.realizedPnlMints || 0,
    auditedMints: walletOutcomes?.summary?.auditedMints || 0,
    byRecommendation,
    realizedRecordCount: realizedRecords.length,
    ruleSignals: {
      trusted_wallet_profit_overlap: reinforcedTrades.length,
      wallet_positive_pnl_skip_review: positiveSkipReviews.length,
      profitable_avoid_wallet_behavior: profitableAvoid.length,
      wallet_negative_pnl_trade_penalty: negativeTradePenalties.length
    },
    reinforceTrades: reinforcedTrades.slice(0, 12).map(summarizeRecord),
    positiveSkipped: positiveSkipReviews.slice(0, 12).map(summarizeRecord),
    profitableAvoidBehavior: profitableAvoid.slice(0, 12).map(summarizeRecord),
    negativeTradePenalties: negativeTradePenalties.slice(0, 12).map(summarizeRecord),
    guidance: [
      'trusted_wallet_profit_overlap can become a future soft boost only after repeated overlap with Spectre-positive outcomes.',
      'wallet_positive_pnl_skip_review is a false-negative review queue, not an immediate trade permission.',
      'profitable_avoid_wallet_behavior should be studied for behavior patterns, not promoted directly into trust.',
      'wallet_negative_pnl_trade_penalty should remain a caution until sample size grows.'
    ]
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dossierDir = resolveRepoPath(args.dossierDir, DEFAULT_DOSSIER_DIR);
  const continuationStatePath = resolveRepoPath(args.continuationState, DEFAULT_CONTINUATION_STATE_PATH);
  const walletBattlefieldPath = resolveRepoPath(args.walletBattlefield, DEFAULT_WALLET_BATTLEFIELD_PATH);
  const walletOutcomesPath = resolveRepoPath(args.walletOutcomes, DEFAULT_WALLET_OUTCOMES_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const dossierFileLimit = Number(args.dossierFiles || DEFAULT_LIMITS.dossierFiles);
  const minPatternCount = Number(args.minPatternCount || DEFAULT_LIMITS.minPatternCount);
  const generatedAt = new Date().toISOString();

  const preMigration = collectPreMigrationTrades(dossierDir, dossierFileLimit);
  const continuationTrades = collectContinuationTrades(continuationStatePath);
  const trades = [...preMigration.trades, ...continuationTrades]
    .sort((a, b) => new Date(a.enteredAt || a.exitedAt || 0) - new Date(b.enteredAt || b.exitedAt || 0));
  const patterns = buildPatterns(trades, minPatternCount);
  const walletBattlefield = readJson(walletBattlefieldPath, {});
  const walletOutcomes = readJson(walletOutcomesPath, {});
  const report = {
    generatedAt,
    mode: 'report_only_learning_memory',
    inputs: {
      dossierDir,
      dossierFilesScanned: preMigration.files.length,
      continuationStatePath,
      walletBattlefieldPath,
      walletOutcomesPath
    },
    summary: {
      all: summarizeTrades(trades),
      preMigration: summarizeTrades(preMigration.trades),
      continuation: summarizeTrades(continuationTrades),
      unmatchedPreMigrationExits: preMigration.unmatchedExits
    },
    lessons: buildLessons(patterns),
    patterns,
    recoveredBadTrades: trades
      .filter((trade) => trade.recoveredBadTrade)
      .slice(-DEFAULT_LIMITS.recentTradeSamples)
      .map((trade) => ({
        lane: trade.lane,
        symbol: trade.symbol,
        mint: trade.mint,
        preset: trade.preset,
        guardOverride: trade.guardOverride,
        exitReason: trade.exitReason,
        returnPct: compact(trade.returnPct, 4),
        pnlSol: compact(trade.pnlSol, 6),
        pnlUsd: compact(trade.pnlUsd, 4),
        reasons: trade.reasons,
        tags: trade.tags,
        riskFlags: trade.riskFlags
      })),
    recentTrades: trades.slice(-DEFAULT_LIMITS.recentTradeSamples).map((trade) => ({
      lane: trade.lane,
      symbol: trade.symbol,
      mint: trade.mint,
      enteredAt: trade.enteredAt,
      exitedAt: trade.exitedAt,
      status: trade.status || 'CLOSED',
      preset: trade.preset,
      guardOverride: trade.guardOverride,
      outcome: trade.outcome,
      exitReason: trade.exitReason,
      returnPct: compact(trade.returnPct, 4),
      pnlSol: compact(trade.pnlSol, 6),
      pnlUsd: compact(trade.pnlUsd, 4),
      score: compact(trade.score, 2)
    })),
    walletMemory: buildWalletMemory(walletBattlefield),
    walletOutcomeMemory: buildWalletOutcomeMemory(walletOutcomes),
    files: {
      latestPath,
      reportDir
    }
  };

  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `trade-learning-memory-${stamp}.json`);
  writeJson(reportPath, report);
  writeJson(latestPath, report);

  console.log(`Wrote trade learning memory: ${reportPath}`);
  console.log(`Wrote latest trade learning memory: ${latestPath}`);
  console.log(`Trades learned from: ${report.summary.all.closedTrades} closed / ${report.summary.all.totalTrades} total`);
  console.log(`Recovered-bad trades found: ${report.summary.all.recoveredBadTrades}`);
  console.log(`Reward patterns: ${report.lessons.reward.length}; penalty patterns: ${report.lessons.penalize.length}`);
}

main();
