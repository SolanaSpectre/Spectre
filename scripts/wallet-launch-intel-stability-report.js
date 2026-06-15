#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const LAUNCH_INTEL_WALLET_INDEX_PATH = path.join(ROOT, 'data', 'launch-intel', 'wallet-index.json');
const MANUAL_KOL_WALLET_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const PROMOTION_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const WALLET_PNL_EVIDENCE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-pnl-evidence-latest.json');
const REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-stability');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-stability-latest.json');

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

function readJson(filePath, fallback = null) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function latestTelemetryFiles(limit = 6) {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.filePath);
}

function walletOf(payload = {}) {
  return payload.wallet || payload.walletAddress || payload.traderPublicKey || payload.account || payload.address || null;
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function curveOf(payload = {}) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.progress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function addWalletRowsToSet(target, rows = []) {
  for (const row of Array.isArray(rows) ? rows : []) {
    const wallet = walletOf(row);
    if (wallet) target.add(wallet);
  }
}

function promotedWalletSet() {
  const wallets = new Set();
  const manual = readJson(MANUAL_KOL_WALLET_PATH, {});
  addWalletRowsToSet(wallets, manual.wallets || manual.trackedWallets || []);
  const promotion = readJson(PROMOTION_PATH, {});
  for (const key of ['trustReview', 'profitableNeedsFirstTouchEvidence', 'watchReview', 'avoidReview', 'hold', 'wallets']) {
    addWalletRowsToSet(wallets, promotion[key]);
  }
  const pnl = readJson(WALLET_PNL_EVIDENCE_PATH, {});
  for (const key of ['wallets', 'topPositiveWallets', 'topNegativeWallets']) {
    addWalletRowsToSet(wallets, pnl[key]);
  }
  return wallets;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function scanTelemetry(filePath) {
  const runId = path.basename(filePath, '.jsonl');
  const buysByMint = new Map();
  const decisions = [];
  const stats = forEachJsonlSync(filePath, (event) => {
    const type = event.type || event.event || 'unknown';
    const payload = payloadOf(event);
    const atMs = timestampMs(payload.timestamp || event.timestamp);

    if (type === 'pre_migration_paper.decision') {
      const mint = mintOf(payload);
      if (!mint || !Number.isFinite(atMs)) return;
      decisions.push({
        atMs,
        mint,
        symbol: payload.symbol || null,
        reason: payload.reason || payload.skipReason || payload.decision || 'unknown'
      });
      return;
    }

    if (type !== 'wallet.trade_gate_diagnostic') return;
    if ((payload.dropReason || 'unknown') !== 'UNTRACKED_WALLET') return;
    if (String(payload.txType || '').toLowerCase() !== 'buy') return;
    const wallet = walletOf(payload);
    const mint = mintOf(payload);
    if (!wallet || !mint || !Number.isFinite(atMs)) return;
    const row = {
      atMs,
      wallet,
      mint,
      symbol: payload.symbol || null,
      curveProgress: curveOf(payload)
    };
    if (!buysByMint.has(mint)) buysByMint.set(mint, []);
    buysByMint.get(mint).push(row);
  });

  for (const rows of buysByMint.values()) rows.sort((a, b) => a.atMs - b.atMs);
  decisions.sort((a, b) => a.atMs - b.atMs);

  const wallets = new Map();
  const touchWallet = (wallet) => {
    if (!wallets.has(wallet)) {
      wallets.set(wallet, {
        wallet,
        buyRows: 0,
        pre85BuyRows: 0,
        mints: new Set(),
        decisionMints: new Set(),
        nearPriorDecisionLinks: 0,
        noTrackedFirstTouchLinks: 0,
        reasonCounts: {},
        sampleMints: new Set()
      });
    }
    return wallets.get(wallet);
  };

  for (const rows of buysByMint.values()) {
    for (const buy of rows) {
      const item = touchWallet(buy.wallet);
      item.buyRows += 1;
      item.mints.add(buy.mint);
      item.sampleMints.add(buy.mint);
      if (!Number.isFinite(Number(buy.curveProgress)) || Number(buy.curveProgress) < 0.85) {
        item.pre85BuyRows += 1;
      }
    }
  }

  for (const decision of decisions) {
    const buys = buysByMint.get(decision.mint) || [];
    const nearPrior = buys.filter((buy) => buy.atMs <= decision.atMs && buy.atMs >= decision.atMs - 120_000);
    for (const buy of nearPrior) {
      const item = touchWallet(buy.wallet);
      item.decisionMints.add(decision.mint);
      item.nearPriorDecisionLinks += 1;
      item.reasonCounts[decision.reason] = (item.reasonCounts[decision.reason] || 0) + 1;
      if (decision.reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') {
        item.noTrackedFirstTouchLinks += 1;
      }
    }
  }

  return {
    runId,
    filePath,
    rowsRead: stats.rows,
    malformedLines: stats.malformedLines,
    paperDecisionRows: decisions.length,
    uniqueDecisionMints: new Set(decisions.map((row) => row.mint)).size,
    wallets: Array.from(wallets.values()).map((row) => ({
      wallet: row.wallet,
      buyRows: row.buyRows,
      pre85BuyRows: row.pre85BuyRows,
      uniqueMints: row.mints.size,
      decisionMints: row.decisionMints.size,
      nearPriorDecisionLinks: row.nearPriorDecisionLinks,
      noTrackedFirstTouchLinks: row.noTrackedFirstTouchLinks,
      reasonCounts: row.reasonCounts,
      sampleMints: Array.from(row.sampleMints).slice(0, 12)
    }))
  };
}

function indexLaunchIntel(wallets) {
  const parsed = readJson(LAUNCH_INTEL_WALLET_INDEX_PATH, { items: [] });
  const wanted = new Set(wallets);
  const byWallet = new Map();
  for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
    if (wanted.has(item.wallet)) byWallet.set(item.wallet, item);
  }
  return {
    generatedAt: parsed.generatedAt || null,
    totalItems: Array.isArray(parsed.items) ? parsed.items.length : 0,
    byWallet
  };
}

function launchMetrics(item = {}) {
  const totalLaunches = Number(item.totalLaunches || 0);
  const totalBuyCount = Number(item.totalBuyCount || 0);
  const totalVolumeSol = Number(item.totalVolumeSol || 0);
  return {
    totalLaunches,
    totalBuyCount,
    totalVolumeSol: compact(totalVolumeSol, 6),
    avgBuysPerLaunch: totalLaunches ? compact(totalBuyCount / totalLaunches, 4) : null,
    avgVolumeSolPerLaunch: totalLaunches ? compact(totalVolumeSol / totalLaunches, 6) : null,
    firstSeen: item.firstSeen || null,
    lastSeen: item.lastSeen || null
  };
}

function aggregateRuns(scannedRuns, launchIndex, promoted) {
  const byWallet = new Map();
  for (const run of scannedRuns) {
    for (const row of run.wallets) {
      if (!launchIndex.byWallet.has(row.wallet)) continue;
      if (promoted.has(row.wallet)) continue;
      if (!byWallet.has(row.wallet)) {
        byWallet.set(row.wallet, {
          wallet: row.wallet,
          runIds: new Set(),
          buyRows: 0,
          pre85BuyRows: 0,
          uniqueMints: new Set(),
          decisionMints: new Set(),
          nearPriorDecisionLinks: 0,
          noTrackedFirstTouchLinks: 0,
          reasonCounts: {},
          sampleMints: new Set()
        });
      }
      const item = byWallet.get(row.wallet);
      item.runIds.add(run.runId);
      item.buyRows += Number(row.buyRows || 0);
      item.pre85BuyRows += Number(row.pre85BuyRows || 0);
      for (const mint of row.sampleMints || []) {
        item.uniqueMints.add(`${run.runId}:${mint}`);
        item.sampleMints.add(mint);
      }
      if (row.decisionMints > 0) item.decisionMints.add(run.runId);
      item.nearPriorDecisionLinks += Number(row.nearPriorDecisionLinks || 0);
      item.noTrackedFirstTouchLinks += Number(row.noTrackedFirstTouchLinks || 0);
      for (const [reason, count] of Object.entries(row.reasonCounts || {})) {
        item.reasonCounts[reason] = (item.reasonCounts[reason] || 0) + Number(count || 0);
      }
    }
  }

  return Array.from(byWallet.values()).map((row) => {
    const launch = launchMetrics(launchIndex.byWallet.get(row.wallet));
    const runCount = row.runIds.size;
    const decisionRunCount = row.decisionMints.size;
    const avgBuys = Number(launch.avgBuysPerLaunch || 0);
    const busyFlowRisk = launch.totalLaunches >= 1000
      || launch.totalBuyCount >= 5000
      || avgBuys >= 8
      || row.buyRows >= 500;
    let score = 0;
    score += Math.min(runCount, 4) * 15;
    score += Math.min(decisionRunCount, 4) * 12;
    score += Math.min(row.noTrackedFirstTouchLinks, 20) * 1.5;
    score += Math.min(row.nearPriorDecisionLinks, 80) * 0.25;
    score += launch.totalLaunches >= 10 && launch.totalLaunches <= 500 ? 12 : 0;
    score += avgBuys >= 1 && avgBuys <= 5 ? 8 : 0;
    if (busyFlowRisk) score -= 35;
    score = Math.max(0, Math.min(100, score));

    const shortlistCandidate = runCount >= 3
      && decisionRunCount >= 3
      && row.noTrackedFirstTouchLinks >= 5
      && launch.totalLaunches >= 5
      && launch.totalLaunches <= 500
      && avgBuys >= 1
      && avgBuys <= 3
      && score >= 85
      && !busyFlowRisk;

    let classification = 'LOW_PRIORITY';
    if (busyFlowRisk) classification = 'BUSY_FLOW_RISK';
    else if (shortlistCandidate) classification = 'REPEAT_SHORTLIST_CANDIDATE';
    else if (runCount >= 2 && decisionRunCount >= 2 && row.noTrackedFirstTouchLinks >= 3 && score >= 70) {
      classification = 'REPEAT_MANUAL_REVIEW_CANDIDATE';
    } else if (runCount >= 2 && (decisionRunCount >= 1 || row.noTrackedFirstTouchLinks >= 1)) {
      classification = 'REPEAT_OBSERVE_NEXT_RUN';
    } else if (runCount >= 2) {
      classification = 'REPEAT_BACKGROUND_WATCH';
    }

    return {
      wallet: row.wallet,
      classification,
      score: compact(score, 2),
      runCount,
      decisionRunCount,
      buyRows: row.buyRows,
      pre85BuyRows: row.pre85BuyRows,
      noTrackedFirstTouchLinks: row.noTrackedFirstTouchLinks,
      nearPriorDecisionLinks: row.nearPriorDecisionLinks,
      reasonCounts: row.reasonCounts,
      launchIntel: launch,
      flags: [
        busyFlowRisk ? 'BUSY_FLOW_RISK' : null,
        shortlistCandidate ? 'REPEAT_SHORTLIST_CANDIDATE' : null,
        runCount >= 2 ? 'REPEATED_ACROSS_RUNS' : null,
        decisionRunCount >= 2 ? 'REPEATED_DECISION_OVERLAP' : null,
        row.noTrackedFirstTouchLinks > 0 ? 'NEAR_NO_TRACKED_FIRST_TOUCH_DECISION' : null
      ].filter(Boolean),
      runIds: Array.from(row.runIds).slice(0, 12),
      sampleMints: Array.from(row.sampleMints).slice(0, 12)
    };
  }).sort((a, b) => (
    Number(b.score || 0) - Number(a.score || 0)
    || Number(b.runCount || 0) - Number(a.runCount || 0)
    || Number(b.noTrackedFirstTouchLinks || 0) - Number(a.noTrackedFirstTouchLinks || 0)
  ));
}

function buildReport(telemetryFiles) {
  const scannedRuns = telemetryFiles.map(scanTelemetry);
  const allWallets = new Set(scannedRuns.flatMap((run) => run.wallets.map((row) => row.wallet)));
  const launchIndex = indexLaunchIntel(allWallets);
  const promoted = promotedWalletSet();
  const candidates = aggregateRuns(scannedRuns, launchIndex, promoted);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_launch_intel_wallet_stability',
    sources: {
      telemetryFiles,
      launchIntelWalletIndexPath: LAUNCH_INTEL_WALLET_INDEX_PATH,
      manualKolWalletPath: MANUAL_KOL_WALLET_PATH,
      walletPromotionReviewPath: PROMOTION_PATH,
      walletPnlEvidencePath: WALLET_PNL_EVIDENCE_PATH
    },
    note: 'Report-only repeat-run stability check for launch-intel-backed untracked wallets. Does not alter wallet trust, entry gates, or live behavior.',
    summary: {
      telemetryFilesRead: telemetryFiles.length,
      launchIntelGeneratedAt: launchIndex.generatedAt,
      launchIntelWalletIndexItems: launchIndex.totalItems,
      untrackedWalletsSeen: allWallets.size,
      knownInLaunchIntel: launchIndex.byWallet.size,
      knownUnpromotedCandidates: candidates.length,
      classificationCounts: countBy(candidates, (row) => row.classification),
      repeatWallets: candidates.filter((row) => row.runCount >= 2).length,
      repeatDecisionOverlapWallets: candidates.filter((row) => row.decisionRunCount >= 2).length,
      repeatShortlistCandidates: candidates.filter((row) => row.classification === 'REPEAT_SHORTLIST_CANDIDATE').length,
      repeatManualReviewCandidates: candidates.filter((row) => row.classification === 'REPEAT_MANUAL_REVIEW_CANDIDATE').length,
      recommendation: 'require repeat-run review before any wallet-proof promotion'
    },
    repeatShortlistCandidates: candidates.filter((row) => row.classification === 'REPEAT_SHORTLIST_CANDIDATE').slice(0, 50),
    repeatManualReviewCandidates: candidates.filter((row) => row.classification === 'REPEAT_MANUAL_REVIEW_CANDIDATE').slice(0, 100),
    repeatObserveNextRun: candidates.filter((row) => row.classification === 'REPEAT_OBSERVE_NEXT_RUN').slice(0, 100),
    busyFlowRisk: candidates.filter((row) => row.classification === 'BUSY_FLOW_RISK').slice(0, 100),
    topCandidates: candidates.slice(0, 150),
    runSummaries: scannedRuns.map((run) => ({
      runId: run.runId,
      filePath: run.filePath,
      rowsRead: run.rowsRead,
      malformedLines: run.malformedLines,
      paperDecisionRows: run.paperDecisionRows,
      uniqueDecisionMints: run.uniqueDecisionMints,
      untrackedWalletRows: run.wallets.reduce((sum, row) => sum + Number(row.buyRows || 0), 0),
      untrackedWallets: run.wallets.length
    }))
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const maxFiles = Math.max(1, Number(args.maxFiles || process.env.WALLET_LAUNCH_INTEL_STABILITY_MAX_FILES || 6));
  const telemetryFiles = args.telemetryFiles
    ? String(args.telemetryFiles).split(',').map((item) => repoPath(item.trim())).filter(Boolean)
    : latestTelemetryFiles(maxFiles);
  if (!telemetryFiles.length) throw new Error('No telemetry files found');
  const missing = telemetryFiles.filter((filePath) => !fs.existsSync(filePath));
  if (missing.length) throw new Error(`Telemetry file(s) not found: ${missing.join(', ')}`);

  const report = buildReport(telemetryFiles);
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `wallet-launch-intel-stability-${stamp}.json`);
  writeJson(reportPath, report);
  writeJson(LATEST_PATH, report);
  console.log(`Wrote launch-intel wallet stability report: ${reportPath}`);
  console.log(`Wrote latest launch-intel wallet stability report: ${LATEST_PATH}`);
  console.log(`files=${report.summary.telemetryFilesRead} known=${report.summary.knownInLaunchIntel} repeat=${report.summary.repeatWallets} shortlist=${report.summary.repeatShortlistCandidates} manual=${report.summary.repeatManualReviewCandidates}`);
}

main();
