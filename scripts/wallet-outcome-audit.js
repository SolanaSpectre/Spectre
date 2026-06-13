const fs = require('fs');
const path = require('path');
const { readJsonl } = require('./lib/jsonl');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_WALLET_INTEL_PATH = path.join(REPO_ROOT, 'data', 'wallet-intel', 'latest.json');
const DEFAULT_WALLET_REALIZED_PNL_PATH = path.join(REPO_ROOT, 'data', 'wallet-realized-pnl', 'latest.json');
const DEFAULT_CONTINUATION_STATE_PATH = path.join(REPO_ROOT, 'data', 'continuation-paper', 'state.json');
const DEFAULT_DOSSIER_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'wallet-outcomes');
const DEFAULT_LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'wallet-outcomes-latest.json');
const SOL_MINT = 'So11111111111111111111111111111111111111112';

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
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

function increment(map, key, amount = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function sortedMap(map, limit = 10, keyName = 'key', countName = 'count') {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, [countName]: count }));
}

function classifyPnl(returnPct, pnlSol, pnlUsd) {
  const ret = Number(returnPct);
  const sol = Number(pnlSol);
  const usd = Number(pnlUsd);
  if ((Number.isFinite(ret) && ret > 0) || (Number.isFinite(sol) && sol > 0) || (Number.isFinite(usd) && usd > 0)) return 'winner';
  if ((Number.isFinite(ret) && ret < 0) || (Number.isFinite(sol) && sol < 0) || (Number.isFinite(usd) && usd < 0)) return 'loser';
  return 'flat_or_unknown';
}

function ensureMint(map, mint) {
  if (!map.has(mint)) {
    map.set(mint, {
      mint,
      symbol: null,
      name: null,
      firstSeenAt: null,
      lastSeenAt: null,
      bestWatchScore: null,
      latestWatchScore: null,
      latestCurveProgress: null,
      decisions: new Map(),
      skipReasons: new Map(),
      entries: [],
      exits: [],
      tags: new Map(),
      reasons: new Map()
    });
  }
  return map.get(mint);
}

function updateWindow(bucket, timestamp) {
  if (!timestamp) return;
  if (!bucket.firstSeenAt || timestamp < bucket.firstSeenAt) bucket.firstSeenAt = timestamp;
  if (!bucket.lastSeenAt || timestamp > bucket.lastSeenAt) bucket.lastSeenAt = timestamp;
}

function collectDossierMintOutcomes(dossierDir, limit) {
  const files = listRecentFiles(dossierDir, 'candidate-dossiers-', limit);
  const mintMap = new Map();

  for (const filePath of files.reverse()) {
    for (const row of readJsonl(filePath)) {
      const mint = row.identity?.mint;
      if (!mint || mint === SOL_MINT) continue;
      const bucket = ensureMint(mintMap, mint);
      bucket.symbol = row.identity?.symbol || bucket.symbol;
      bucket.name = row.identity?.name || bucket.name;
      updateWindow(bucket, row.timestamp);

      const score = Number(row.gmgnStyle?.score);
      if (Number.isFinite(score)) {
        bucket.latestWatchScore = score;
        bucket.bestWatchScore = bucket.bestWatchScore === null ? score : Math.max(bucket.bestWatchScore, score);
      }
      const progress = Number(row.curve?.progress);
      if (Number.isFinite(progress)) bucket.latestCurveProgress = progress;

      for (const tag of asArray(row.gmgnStyle?.tags)) increment(bucket.tags, tag);
      for (const reason of asArray(row.gmgnStyle?.reasons)) increment(bucket.reasons, reason);

      if (row.source === 'pre_migration_paper') {
        increment(bucket.decisions, row.paper?.decision || row.eventType || 'UNKNOWN');
        if (row.paper?.reason && row.paper?.decision === 'PAPER_SKIPPED') increment(bucket.skipReasons, row.paper.reason);
        if (row.eventType === 'pre_migration_paper.entry') {
          bucket.entries.push({
            timestamp: row.timestamp,
            preset: row.paper?.preset || null,
            guardOverride: row.paper?.guardOverride || row.paper?.guard?.override || null,
            score: compact(score, 2),
            curveProgress: compact(progress, 6),
            buyRatio: compact(row.activity?.buyRatio, 4),
            uniqueBuyerRatio: compact(row.activity?.uniqueBuyerRatio, 4)
          });
        }
        if (row.eventType === 'pre_migration_paper.exit') {
          const paper = row.paper || {};
          bucket.exits.push({
            timestamp: row.timestamp,
            preset: paper.preset || null,
            reason: paper.reason || null,
            returnPct: compact(paper.returnPct, 6),
            pnlSol: compact(paper.pnlSol, 6),
            outcome: classifyPnl(paper.returnPct, paper.pnlSol, null)
          });
        }
      }
    }
  }

  return { mintMap, files };
}

function collectContinuationOutcomes(statePath) {
  const state = readJson(statePath, { positions: [] });
  const map = new Map();
  for (const position of asArray(state.positions)) {
    if (!position.mint || position.mint === SOL_MINT) continue;
    if (!map.has(position.mint)) map.set(position.mint, []);
    map.get(position.mint).push({
      status: position.status || null,
      symbol: position.symbol || null,
      sourceLabel: position.sourceLabel || null,
      openedAt: position.openedAt || null,
      closedAt: position.closedAt || null,
      exitReason: position.exitReason || null,
      entryScore: compact(position.entryScore, 2),
      returnPct: compact(position.returnPct, 6),
      pnlUsd: compact(position.pnlUsd, 4),
      maxDrawdownPct: compact(position.maxDrawdownPct, 6),
      maxUnrealizedReturnPct: compact(position.maxUnrealizedReturnPct, 6),
      outcome: position.status === 'OPEN' ? 'open' : classifyPnl(position.returnPct, null, position.pnlUsd)
    });
  }
  return map;
}

function buildWalletRealizedPnlMap(realizedPnlReport) {
  return new Map(
    asArray(realizedPnlReport?.mintIndex).map((item) => [item.mint, item])
  );
}

function summarizeWallets(topWallets) {
  const summary = {
    trustedTouches: 0,
    avoidTouches: 0,
    mixedTouches: 0,
    unknownTouches: 0,
    trustedWallets: 0,
    avoidWallets: 0,
    topWallets: []
  };

  for (const wallet of asArray(topWallets)) {
    const touches = Number(wallet.touchCount || wallet.count || 0);
    const tier = wallet.trustTier || 'UNKNOWN';
    if (tier === 'TRUSTED') {
      summary.trustedTouches += touches;
      summary.trustedWallets += 1;
    } else if (tier === 'AVOID') {
      summary.avoidTouches += touches;
      summary.avoidWallets += 1;
    } else if (tier === 'MIXED') {
      summary.mixedTouches += touches;
    } else {
      summary.unknownTouches += touches;
    }
    summary.topWallets.push({
      walletAddress: wallet.walletAddress,
      name: wallet.name || null,
      rank: wallet.rank || null,
      score: wallet.score ?? null,
      trustTier: tier,
      touchCount: touches,
      flags: wallet.flags || []
    });
  }

  return summary;
}

function chooseRecommendation(record) {
  const traded = record.spectre.traded;
  const skipped = record.spectre.skipped;
  const hasWinner = record.outcome.bestOutcome === 'winner';
  const hasLoser = record.outcome.worstOutcome === 'loser';
  const trustedDominant = record.wallet.trustedTouches > record.wallet.avoidTouches;
  const avoidDominant = record.wallet.avoidTouches >= record.wallet.trustedTouches && record.wallet.avoidTouches > 0;
  const bestWatchScore = Number(record.spectre.bestWatchScore || 0);
  const trackedWalletPnl = Number(record.walletRealizedPnl?.totalRealizedPnlSol || 0);
  const trackedWalletWinners = Number(record.walletRealizedPnl?.winnerWalletCount || 0);
  const trackedWalletLosers = Number(record.walletRealizedPnl?.loserWalletCount || 0);

  if (skipped && trackedWalletPnl > 0 && trackedWalletWinners > trackedWalletLosers) return 'review_wallet_pnl_positive_skip';
  if (traded && trackedWalletPnl < 0 && trackedWalletLosers >= trackedWalletWinners) return 'penalize_wallet_pnl_negative_trade';
  if (!traded && !skipped && trackedWalletPnl > 0 && avoidDominant) return 'study_profitable_avoid_wallet_behavior';
  if (!traded && !skipped && trackedWalletPnl > 0 && trustedDominant) return 'monitor_profitable_trusted_wallet_behavior';
  if (traded && hasWinner) return 'reinforce_wallet_supported_trade';
  if (traded && hasLoser && avoidDominant) return 'penalize_avoid_wallet_supported_trade';
  if (skipped && hasWinner) return 'review_possible_false_negative';
  if (skipped && !hasWinner && avoidDominant) return 'respect_skip_avoid_wallet_dominated';
  if (!traded && !skipped && trustedDominant && bestWatchScore >= 80) return 'monitor_wallet_supported_untraded_candidate';
  if (trustedDominant && bestWatchScore >= 84) return 'escalate_wallet_supported_high_score';
  if (avoidDominant) return 'caution_avoid_wallet_dominated';
  return 'collect_more_evidence';
}

function buildAudit(walletIntel, walletRealizedPnlMap, dossierOutcomes, continuationOutcomes) {
  const records = [];
  const walletIntelByMint = new Map(asArray(walletIntel.mintIntel).map((item) => [item.mint, item]));
  const allMints = new Set([
    ...walletIntelByMint.keys(),
    ...walletRealizedPnlMap.keys()
  ]);

  for (const mint of allMints) {
    if (!mint || mint === SOL_MINT) continue;
    const item = walletIntelByMint.get(mint) || {
      mint,
      totalWalletTouches: 0,
      topWalletCount: 0,
      weightedWalletScore: 0,
      topWallets: [],
      overlap: {}
    };
    const dossier = dossierOutcomes.get(mint);
    const continuation = continuationOutcomes.get(mint) || [];
    const wallet = summarizeWallets(item.topWallets);
    const realizedPnl = walletRealizedPnlMap.get(mint) || null;
    const exits = dossier?.exits || [];
    const allOutcomes = [
      ...exits.map((exit) => exit.outcome),
      ...continuation.map((position) => position.outcome).filter((outcome) => outcome !== 'open')
    ];
    const traded = exits.length > 0 || continuation.length > 0 || Number(item.overlap?.botExecutedCount || 0) > 0;
    const skipped = Number(item.overlap?.botRejectedCount || 0) > 0 || Number(dossier?.skipReasons?.size || 0) > 0;
    const bestOutcome = allOutcomes.includes('winner') ? 'winner' : (allOutcomes.includes('loser') ? 'loser' : 'unknown');
    const worstOutcome = allOutcomes.includes('loser') ? 'loser' : (allOutcomes.includes('winner') ? 'winner' : 'unknown');

    const record = {
      mint,
      symbol: dossier?.symbol || continuation[0]?.symbol || null,
      wallet: {
        totalWalletTouches: Number(item.totalWalletTouches || 0),
        topWalletCount: Number(item.topWalletCount || 0),
        weightedWalletScore: compact(item.weightedWalletScore, 2),
        ...wallet
      },
      walletRealizedPnl: realizedPnl ? {
        walletCount: realizedPnl.walletCount,
        realizedWalletCount: realizedPnl.realizedWalletCount,
        winnerWalletCount: realizedPnl.winnerWalletCount,
        loserWalletCount: realizedPnl.loserWalletCount,
        totalRealizedPnlSol: realizedPnl.totalRealizedPnlSol,
        topWallets: asArray(realizedPnl.wallets).slice(0, 8)
      } : null,
      spectre: {
        traded,
        skipped,
        botRejectedCount: Number(item.overlap?.botRejectedCount || 0),
        botExecutedCount: Number(item.overlap?.botExecutedCount || 0),
        botClosedCount: Number(item.overlap?.botClosedCount || 0),
        topRejectReason: item.overlap?.topRejectReason || null,
        rejectionReasons: item.overlap?.rejectionReasons || [],
        bestWatchScore: compact(dossier?.bestWatchScore, 2),
        latestWatchScore: compact(dossier?.latestWatchScore, 2),
        latestCurveProgress: compact(dossier?.latestCurveProgress, 6),
        decisions: sortedMap(dossier?.decisions || new Map(), 10, 'decision', 'count'),
        skipReasons: sortedMap(dossier?.skipReasons || new Map(), 10, 'reason', 'count'),
        tags: sortedMap(dossier?.tags || new Map(), 12, 'tag', 'count')
      },
      outcome: {
        bestOutcome,
        worstOutcome,
        preMigrationExits: exits,
        continuationPositions: continuation
      }
    };
    record.recommendation = chooseRecommendation(record);
    records.push(record);
  }

  records.sort((a, b) => {
    const priority = {
      review_possible_false_negative: 0,
      escalate_wallet_supported_high_score: 1,
      monitor_wallet_supported_untraded_candidate: 2,
      reinforce_wallet_supported_trade: 3,
      penalize_avoid_wallet_supported_trade: 4,
      respect_skip_avoid_wallet_dominated: 5,
      caution_avoid_wallet_dominated: 6,
      collect_more_evidence: 7
    };
    const p = (priority[a.recommendation] ?? 99) - (priority[b.recommendation] ?? 99);
    if (p !== 0) return p;
    return (b.wallet.weightedWalletScore || 0) - (a.wallet.weightedWalletScore || 0);
  });

  const byRecommendation = records.reduce((acc, record) => {
    acc[record.recommendation] = (acc[record.recommendation] || 0) + 1;
    return acc;
  }, {});

  return {
    byRecommendation,
    records
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const walletIntelPath = resolveRepoPath(args.walletIntel, DEFAULT_WALLET_INTEL_PATH);
  const walletRealizedPnlPath = resolveRepoPath(args.walletRealizedPnl, DEFAULT_WALLET_REALIZED_PNL_PATH);
  const continuationStatePath = resolveRepoPath(args.continuationState, DEFAULT_CONTINUATION_STATE_PATH);
  const dossierDir = resolveRepoPath(args.dossierDir, DEFAULT_DOSSIER_DIR);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const latestPath = resolveRepoPath(args.latestPath, DEFAULT_LATEST_PATH);
  const dossierFiles = Number(args.dossierFiles || 100);
  const generatedAt = new Date().toISOString();

  const walletIntel = readJson(walletIntelPath, {});
  const walletRealizedPnl = readJson(walletRealizedPnlPath, {});
  const walletRealizedPnlMap = buildWalletRealizedPnlMap(walletRealizedPnl);
  const { mintMap, files } = collectDossierMintOutcomes(dossierDir, dossierFiles);
  const continuationOutcomes = collectContinuationOutcomes(continuationStatePath);
  const audit = buildAudit(walletIntel, walletRealizedPnlMap, mintMap, continuationOutcomes);

  const report = {
    generatedAt,
    mode: 'wallet_outcome_audit_report_only',
    caveat: 'Current Kolscan wallet intel has wallet touches/trust tiers, not exact wallet realized PnL. This report audits Spectre decisions and token/paper outcomes around those wallet-touched mints.',
    inputs: {
      walletIntelPath,
      walletIntelGeneratedAt: walletIntel.generatedAt || null,
      walletRealizedPnlPath,
      walletRealizedPnlGeneratedAt: walletRealizedPnl.generatedAt || null,
      continuationStatePath,
      dossierDir,
      dossierFilesScanned: files.length
    },
    summary: {
      walletMints: asArray(walletIntel.mintIntel).length,
      realizedPnlMints: walletRealizedPnlMap.size,
      auditedMints: audit.records.length,
      byRecommendation: audit.byRecommendation
    },
    topReview: audit.records.slice(0, 50),
    allRecords: audit.records,
    files: {
      latestPath,
      reportDir
    }
  };

  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(reportDir, `wallet-outcomes-${stamp}.json`);
  writeJson(reportPath, report);
  writeJson(latestPath, report);

  console.log(`Wrote wallet outcome audit: ${reportPath}`);
  console.log(`Wrote latest wallet outcome audit: ${latestPath}`);
  console.log(`Audited wallet mints: ${report.summary.auditedMints}`);
  console.log(`Recommendations: ${JSON.stringify(report.summary.byRecommendation)}`);
  report.topReview.slice(0, 10).forEach((item, index) => {
    console.log(`${index + 1}. ${item.symbol || item.mint} | ${item.recommendation} | trusted=${item.wallet.trustedTouches} avoid=${item.wallet.avoidTouches} | skipped=${item.spectre.skipped} traded=${item.spectre.traded} | outcome=${item.outcome.bestOutcome}/${item.outcome.worstOutcome}`);
  });
}

main();
