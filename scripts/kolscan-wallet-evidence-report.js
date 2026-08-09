'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_POLICY,
  buildFreshWalletFlow,
  gradeWalletEvidence
} = require('../src/lib/kolscan-wallet-evidence');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_WATCHLIST_PATH = path.join(REPO_ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const DEFAULT_PNL_PATH = path.join(REPO_ROOT, 'data', 'wallet-realized-pnl', 'latest.json');
const SNAPSHOT_DIR = path.join(REPO_ROOT, 'data', 'kolscan', 'leaderboard-snapshots');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'kolscan', 'wallet-evidence');
const LATEST_PATH = path.join(REPO_ROOT, 'data', 'reports', 'kolscan-wallet-evidence-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
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

function loadSnapshotHistory(snapshotDir = SNAPSHOT_DIR) {
  const history = new Map();
  if (!fs.existsSync(snapshotDir)) return history;
  const files = fs.readdirSync(snapshotDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .slice(-90);

  for (const name of files) {
    const payload = readJson(path.join(snapshotDir, name), null);
    if (!payload || !Array.isArray(payload.wallets)) continue;
    const fetchedAt = payload.fetchedAt || null;
    const day = String(fetchedAt || '').slice(0, 10);
    for (const wallet of payload.wallets) {
      if (!wallet.walletAddress) continue;
      if (!history.has(wallet.walletAddress)) {
        history.set(wallet.walletAddress, {
          dates: new Set(),
          firstSeenAt: null,
          lastSeenAt: null
        });
      }
      const row = history.get(wallet.walletAddress);
      if (day) row.dates.add(day);
      if (fetchedAt && (!row.firstSeenAt || fetchedAt < row.firstSeenAt)) row.firstSeenAt = fetchedAt;
      if (fetchedAt && (!row.lastSeenAt || fetchedAt > row.lastSeenAt)) row.lastSeenAt = fetchedAt;
    }
  }

  return new Map(Array.from(history.entries()).map(([walletAddress, row]) => [walletAddress, {
    snapshotDayCount: row.dates.size,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt
  }]));
}

function buildReport(watchlist, pnlReport, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const nowMs = Date.parse(generatedAt);
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const snapshotHistory = options.snapshotHistory || new Map();
  const pnlByWallet = new Map(
    (pnlReport?.wallets || []).map((wallet) => [wallet.walletAddress, wallet])
  );
  const assessments = (watchlist?.wallets || []).map((wallet) => gradeWalletEvidence(
    wallet,
    pnlByWallet.get(wallet.walletAddress) || null,
    { policy, snapshotHistory: snapshotHistory.get(wallet.walletAddress) || {} }
  ));
  const freshWalletFlow = buildFreshWalletFlow(assessments, { policy, nowMs });
  const gradeCounts = assessments.reduce((counts, assessment) => {
    counts[assessment.grade] = (counts[assessment.grade] || 0) + 1;
    return counts;
  }, {});

  return {
    schemaVersion: 1,
    generatedAt,
    mode: 'READ_ONLY',
    purpose: 'Outlier-resistant Helius wallet history and fresh-buy evidence for Milo candidate scouting',
    methodology: {
      thirdPartyPerformanceClaimsAreDiscoveryOnly: true,
      thirdPartyPerformanceClaimRequiredForQualification: false,
      heliusKnownCostBasisRequiredForPnl: true,
      durabilityChecks: ['median_realized_pnl_positive', 'ex_top3_realized_pnl_positive', 'win_rate'],
      freshFlowRequiresLastActionBuy: true,
      freshFlowRequiresOpenTokenBalance: true,
      noAutomaticCopyTrading: true,
      walletIdentityRelationshipScreen: 'unavailable_caps_grade_at_B'
    },
    policy,
    inputs: {
      watchlistUpdatedAt: watchlist?.updatedAt || watchlist?.fetchedAt || null,
      watchlistSource: watchlist?.source || null,
      pnlGeneratedAt: pnlReport?.generatedAt || null,
      pnlTxLimit: pnlReport?.txLimit || null
    },
    summary: {
      leaderboardWallets: (watchlist?.wallets || []).length,
      walletsAnalyzedByHelius: (pnlReport?.wallets || []).length,
      gradeCounts,
      qualifiedWallets: assessments.filter((row) => ['A', 'B'].includes(row.grade)).length,
      freshBuyMints: freshWalletFlow.length,
      walletAuditEligibleMints: freshWalletFlow.filter((row) => row.walletAuditEligible).length
    },
    qualifiedWallets: assessments.filter((row) => ['A', 'B'].includes(row.grade)),
    freshWalletFlow,
    assessments
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const watchlistPath = resolveRepoPath(args.watchlist) || DEFAULT_WATCHLIST_PATH;
  const pnlPath = resolveRepoPath(args.pnl) || DEFAULT_PNL_PATH;
  const watchlist = readJson(watchlistPath, null);
  const pnlReport = readJson(pnlPath, null);
  if (!watchlist || !Array.isArray(watchlist.wallets)) {
    throw new Error(`Wallet watchlist is unavailable at ${watchlistPath}`);
  }
  if (!pnlReport || !Array.isArray(pnlReport.wallets)) {
    throw new Error(`Wallet realized-PnL report is unavailable at ${pnlPath}`);
  }

  const report = buildReport(watchlist, pnlReport, {
    snapshotHistory: loadSnapshotHistory()
  });
  const outputPath = path.join(
    OUTPUT_DIR,
    `kolscan-wallet-evidence-${report.generatedAt.replace(/[:.]/g, '-')}.json`
  );
  writeJson(outputPath, report);
  writeJson(LATEST_PATH, report);

  console.log('Helius Wallet Evidence');
  console.log('======================');
  console.log(`Analyzed=${report.summary.walletsAnalyzedByHelius}/${report.summary.leaderboardWallets} grades=${JSON.stringify(report.summary.gradeCounts)}`);
  console.log(`Qualified wallets=${report.summary.qualifiedWallets} fresh-buy mints=${report.summary.freshBuyMints} wallet-audit eligible=${report.summary.walletAuditEligibleMints}`);
  for (const row of report.freshWalletFlow.slice(0, 10)) {
    console.log(`${row.walletAuditEligible ? 'AUDIT' : 'WATCH'} mint=${row.mint} wallets=${row.qualifiedWalletCount} ageMin=${row.ageMinutes}`);
  }
  console.log(`Report: ${LATEST_PATH}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Wallet evidence failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildReport,
  loadSnapshotHistory,
  main
};
