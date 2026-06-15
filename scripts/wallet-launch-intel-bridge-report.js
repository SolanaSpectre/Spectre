#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { forEachJsonlSync } = require('./lib/jsonl');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const LAUNCH_INTEL_WALLET_INDEX_PATH = path.join(ROOT, 'data', 'launch-intel', 'wallet-index.json');
const MANUAL_KOL_WALLET_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');
const PROMOTION_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const WALLET_PNL_EVIDENCE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-pnl-evidence-latest.json');
const REPORT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-bridge');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-bridge-latest.json');

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
  return path.isAbsolute(selected) ? selected : path.join(ROOT, selected);
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function telemetryFromBattlefield() {
  try {
    const report = JSON.parse(fs.readFileSync(BATTLEFIELD_PATH, 'utf8').replace(/^\uFEFF/, ''));
    return report.files?.telemetryPath || report.telemetryPath || null;
  } catch {
    return null;
  }
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

function priceOf(payload = {}) {
  const price = Number(payload.providerCurvePriceSol ?? payload.bondingCurvePriceSol ?? payload.curvePriceSol ?? payload.priceSol);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function addWalletToSet(target, value) {
  const wallet = typeof value === 'string' ? value.trim() : '';
  if (wallet) target.add(wallet);
}

function addWalletRowsToSet(target, rows = []) {
  for (const row of Array.isArray(rows) ? rows : []) {
    addWalletToSet(target, walletOf(row));
  }
}

function walletSetFromManualKol(filePath = MANUAL_KOL_WALLET_PATH) {
  const parsed = readJson(filePath, {});
  const wallets = new Set();
  addWalletRowsToSet(wallets, parsed.wallets || parsed.trackedWallets || []);
  return wallets;
}

function walletSetFromPromotionReview(filePath = PROMOTION_PATH) {
  const parsed = readJson(filePath, {});
  const wallets = new Set();
  for (const key of ['trustReview', 'profitableNeedsFirstTouchEvidence', 'watchReview', 'avoidReview', 'hold', 'wallets']) {
    addWalletRowsToSet(wallets, parsed[key]);
  }
  return wallets;
}

function walletSetFromPnlEvidence(filePath = WALLET_PNL_EVIDENCE_PATH) {
  const parsed = readJson(filePath, {});
  const wallets = new Set();
  for (const key of ['wallets', 'topPositiveWallets', 'topNegativeWallets']) {
    addWalletRowsToSet(wallets, parsed[key]);
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

function stat(values, digits = 6) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: compact(finite[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(finite[finite.length - 1], digits),
    avg: compact(sum / finite.length, digits)
  };
}

function emptyRuntimeWallet(wallet) {
  return {
    wallet,
    rows: 0,
    buyRows: 0,
    sellRows: 0,
    pre85BuyRows: 0,
    mints: new Set(),
    pre85BuyMints: new Set(),
    decisionOverlapMints: new Set(),
    noTrackedFirstTouchLinks: 0,
    nearPriorDecisionLinks: 0,
    curveDelta300s: [],
    priceDelta300s: [],
    cross90Rows300s: 0,
    cross90Mints300s: new Set(),
    sampleMints: new Set()
  };
}

function summarizeRuntimeWallet(row) {
  return {
    wallet: row.wallet,
    rows: row.rows,
    buyRows: row.buyRows,
    sellRows: row.sellRows,
    pre85BuyRows: row.pre85BuyRows,
    uniqueMints: row.mints.size,
    uniquePre85BuyMints: row.pre85BuyMints.size,
    decisionOverlapMints: row.decisionOverlapMints.size,
    nearPriorDecisionLinks: row.nearPriorDecisionLinks,
    noTrackedFirstTouchLinks: row.noTrackedFirstTouchLinks,
    cross90Rows300s: row.cross90Rows300s,
    uniqueCross90Mints300s: row.cross90Mints300s.size,
    curveDelta300s: stat(row.curveDelta300s, 6),
    priceDelta300s: stat(row.priceDelta300s, 2),
    rowsPerMint: row.mints.size ? compact(row.rows / row.mints.size, 2) : null,
    buyRatio: row.rows ? compact(row.buyRows / row.rows, 4) : null,
    sampleMints: Array.from(row.sampleMints).slice(0, 12)
  };
}

function collectRuntimeUntracked(telemetryPath) {
  const untrackedRows = [];
  const snapshotsByMint = new Map();
  const decisionsByMint = new Map();
  const decisionMints = new Set();
  const eventCounts = {};
  const stats = forEachJsonlSync(telemetryPath, (event) => {
    const type = event.type || event.event || 'unknown';
    eventCounts[type] = (eventCounts[type] || 0) + 1;
    const payload = payloadOf(event);
    const atMs = timestampMs(payload.timestamp || event.timestamp);

    if (type === 'pump_bonding_curve.provider_snapshot' || type === 'pre_migration.observed') {
      const mint = mintOf(payload);
      const curveProgress = curveOf(payload);
      if (mint && Number.isFinite(atMs) && Number.isFinite(Number(curveProgress))) {
        if (!snapshotsByMint.has(mint)) snapshotsByMint.set(mint, []);
        snapshotsByMint.get(mint).push({ atMs, curveProgress, priceSol: priceOf(payload) });
      }
      return;
    }

    if (type === 'pre_migration_paper.decision') {
      const mint = mintOf(payload);
      if (mint && Number.isFinite(atMs)) {
        const row = {
          atMs,
          mint,
          symbol: payload.symbol || null,
          reason: payload.reason || payload.skipReason || payload.decision || 'unknown',
          score: compact(payload.score, 2),
          curveProgress: compact(payload.curveProgress ?? payload.providerCurveProgress ?? payload.paperCurveProgress, 6)
        };
        decisionMints.add(mint);
        if (!decisionsByMint.has(mint)) decisionsByMint.set(mint, []);
        decisionsByMint.get(mint).push(row);
      }
      return;
    }

    if (type !== 'wallet.trade_gate_diagnostic') return;
    if ((payload.dropReason || 'unknown') !== 'UNTRACKED_WALLET') return;
    const wallet = walletOf(payload);
    const mint = mintOf(payload);
    if (!wallet || !mint || !Number.isFinite(atMs)) return;
    const txType = String(payload.txType || '').toLowerCase();
    const curveProgress = curveOf(payload);
    untrackedRows.push({
      atMs,
      wallet,
      mint,
      symbol: payload.symbol || null,
      txType,
      curveProgress,
      priceSol: priceOf(payload)
    });
  });

  for (const snapshots of snapshotsByMint.values()) {
    snapshots.sort((a, b) => a.atMs - b.atMs);
  }
  for (const decisions of decisionsByMint.values()) {
    decisions.sort((a, b) => a.atMs - b.atMs);
  }

  const wallets = new Map();
  for (const row of untrackedRows) {
    const bucket = wallets.get(row.wallet) || emptyRuntimeWallet(row.wallet);
    bucket.rows += 1;
    if (row.txType === 'buy') bucket.buyRows += 1;
    if (row.txType === 'sell') bucket.sellRows += 1;
    bucket.mints.add(row.mint);
    bucket.sampleMints.add(row.mint);
    if (decisionMints.has(row.mint)) bucket.decisionOverlapMints.add(row.mint);
    if (row.txType === 'buy' && (!Number.isFinite(Number(row.curveProgress)) || Number(row.curveProgress) < 0.85)) {
      bucket.pre85BuyRows += 1;
      bucket.pre85BuyMints.add(row.mint);
    }

    if (row.txType === 'buy') {
      const futureSnapshots = (snapshotsByMint.get(row.mint) || [])
        .filter((snapshot) => snapshot.atMs > row.atMs && snapshot.atMs <= row.atMs + 300_000);
      if (futureSnapshots.length) {
        const maxCurve = Math.max(...futureSnapshots.map((snapshot) => Number(snapshot.curveProgress)).filter(Number.isFinite));
        const maxPrice = Math.max(...futureSnapshots.map((snapshot) => Number(snapshot.priceSol)).filter((value) => Number.isFinite(value) && value > 0));
        if (Number.isFinite(maxCurve) && Number.isFinite(Number(row.curveProgress))) {
          bucket.curveDelta300s.push(maxCurve - Number(row.curveProgress));
        }
        if (Number.isFinite(maxPrice) && Number.isFinite(Number(row.priceSol)) && Number(row.priceSol) > 0) {
          bucket.priceDelta300s.push(((maxPrice - Number(row.priceSol)) / Number(row.priceSol)) * 100);
        }
        if (Number.isFinite(maxCurve) && maxCurve >= 0.9) {
          bucket.cross90Rows300s += 1;
          bucket.cross90Mints300s.add(row.mint);
        }
      }
    }
    wallets.set(row.wallet, bucket);
  }

  for (const decision of Array.from(decisionsByMint.values()).flat()) {
    const priorWindowStart = decision.atMs - 120_000;
    const nearPrior = untrackedRows.filter((row) => (
      row.mint === decision.mint
      && row.txType === 'buy'
      && row.atMs <= decision.atMs
      && row.atMs >= priorWindowStart
    ));
    for (const row of nearPrior) {
      const bucket = wallets.get(row.wallet);
      if (!bucket) continue;
      bucket.nearPriorDecisionLinks += 1;
      if (decision.reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') {
        bucket.noTrackedFirstTouchLinks += 1;
      }
    }
  }

  return {
    telemetryStats: stats,
    eventCounts,
    untrackedRows: untrackedRows.length,
    uniqueUntrackedWallets: wallets.size,
    uniqueUntrackedMints: new Set(untrackedRows.map((row) => row.mint)).size,
    paperDecisionRows: Array.from(decisionsByMint.values()).reduce((sum, rows) => sum + rows.length, 0),
    paperDecisionMints: decisionMints.size,
    wallets: new Map(Array.from(wallets.entries()).map(([wallet, row]) => [wallet, summarizeRuntimeWallet(row)]))
  };
}

function indexLaunchIntel(targetWallets, filePath) {
  const parsed = readJson(filePath, { items: [] });
  const targets = new Set(targetWallets);
  const byWallet = new Map();
  for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
    if (targets.has(item.wallet)) byWallet.set(item.wallet, item);
  }
  return {
    generatedAt: parsed.generatedAt || null,
    totalItems: Array.isArray(parsed.items) ? parsed.items.length : 0,
    byWallet
  };
}

function daysSince(iso) {
  const ms = new Date(iso || 0).getTime();
  if (!Number.isFinite(ms)) return null;
  return compact((Date.now() - ms) / 86_400_000, 2);
}

function launchMetrics(item = {}) {
  const launches = Number(item.totalLaunches || 0);
  const buys = Number(item.totalBuyCount || 0);
  const volume = Number(item.totalVolumeSol || 0);
  return {
    totalLaunches: launches,
    totalBuyCount: buys,
    totalVolumeSol: compact(volume, 6),
    avgBuysPerLaunch: launches > 0 ? compact(buys / launches, 4) : null,
    avgVolumeSolPerLaunch: launches > 0 ? compact(volume / launches, 6) : null,
    recencyDays: daysSince(item.lastSeen)
  };
}

function scoreCandidate(runtime, launch) {
  const metrics = launchMetrics(launch);
  const launches = Number(metrics.totalLaunches || 0);
  const buys = Number(metrics.totalBuyCount || 0);
  const avgBuys = Number(metrics.avgBuysPerLaunch || 0);
  const runtimeMints = Number(runtime.uniqueMints || 0);
  const rowsPerMint = Number(runtime.rowsPerMint || 0);
  const buyRatio = Number(runtime.buyRatio || 0);
  const p90CurveDelta = Number(runtime.curveDelta300s?.p90 || 0);
  const decisionOverlap = Number(runtime.decisionOverlapMints || 0);
  const noTrackedLinks = Number(runtime.noTrackedFirstTouchLinks || 0);
  const recency = Number(metrics.recencyDays);

  const busyFlowRisk = launches >= 1000
    || buys >= 5000
    || avgBuys >= 8
    || runtime.buyRows >= 250
    || rowsPerMint >= 12;
  const staleRisk = Number.isFinite(recency) && recency > 14;
  const thinEvidence = launches < 5 || runtime.buyRows < 2;

  let score = 0;
  score += Math.min(runtimeMints, 12) * 3;
  score += Math.min(decisionOverlap, 8) * 4;
  score += Math.min(noTrackedLinks, 8) * 3;
  score += Math.min(Math.max(p90CurveDelta, 0), 0.5) * 40;
  score += buyRatio >= 0.65 ? 10 : (buyRatio >= 0.5 ? 4 : -5);
  score += launches >= 10 && launches <= 300 ? 14 : 0;
  score += launches > 300 && launches < 1000 ? 4 : 0;
  score += avgBuys >= 1 && avgBuys <= 5 ? 8 : 0;
  if (busyFlowRisk) score -= 35;
  if (staleRisk) score -= 10;
  if (thinEvidence) score -= 12;
  score = Math.max(0, Math.min(100, score));

  let classification = 'LOW_PRIORITY';
  if (busyFlowRisk) classification = 'BUSY_FLOW_RISK';
  else if (score >= 70 && decisionOverlap >= 2 && runtimeMints >= 2) classification = 'MANUAL_REVIEW_CANDIDATE';
  else if (score >= 50 && (decisionOverlap >= 1 || noTrackedLinks >= 1)) classification = 'OBSERVE_NEXT_RUN';
  else if (score >= 40) classification = 'BACKGROUND_WATCH';

  return {
    score: compact(score, 2),
    classification,
    flags: [
      busyFlowRisk ? 'BUSY_FLOW_RISK' : null,
      staleRisk ? 'STALE_LAUNCH_INTEL' : null,
      thinEvidence ? 'THIN_EVIDENCE' : null,
      decisionOverlap > 0 ? 'OVERLAPS_PAPER_DECISION_MINTS' : null,
      noTrackedLinks > 0 ? 'NEAR_NO_TRACKED_FIRST_TOUCH_DECISION' : null
    ].filter(Boolean)
  };
}

function compactLaunchSamples(item = {}, runtime = {}) {
  const runtimeMints = new Set(runtime.sampleMints || []);
  const launches = Array.isArray(item.launches) ? item.launches : [];
  return launches
    .filter((launch) => runtimeMints.has(launch.mint))
    .slice(0, 8)
    .map((launch) => ({
      mint: launch.mint,
      symbol: launch.symbol || null,
      firstSeen: launch.firstSeen || null,
      lastSeen: launch.lastSeen || null,
      buyCount: Number(launch.buyCount || 0),
      totalVolumeSol: compact(launch.totalVolumeSol, 6)
    }));
}

function buildReport({ telemetryPath, launchIntelPath }) {
  const runtime = collectRuntimeUntracked(telemetryPath);
  const manualKol = walletSetFromManualKol();
  const promotionReview = walletSetFromPromotionReview();
  const pnlEvidence = walletSetFromPnlEvidence();
  const launchIndex = indexLaunchIntel(runtime.wallets.keys(), launchIntelPath);

  const candidates = [];
  for (const [wallet, runtimeSummary] of runtime.wallets.entries()) {
    const launch = launchIndex.byWallet.get(wallet);
    if (!launch) continue;
    const alreadyPromoted = manualKol.has(wallet) || promotionReview.has(wallet) || pnlEvidence.has(wallet);
    if (alreadyPromoted) continue;
    const scored = scoreCandidate(runtimeSummary, launch);
    const metrics = launchMetrics(launch);
    candidates.push({
      wallet,
      classification: scored.classification,
      score: scored.score,
      flags: scored.flags,
      runtime: runtimeSummary,
      launchIntel: {
        firstSeen: launch.firstSeen || null,
        lastSeen: launch.lastSeen || null,
        ...metrics,
        overlapLaunchSamples: compactLaunchSamples(launch, runtimeSummary)
      }
    });
  }

  candidates.sort((a, b) => (
    Number(b.score || 0) - Number(a.score || 0)
    || Number(b.runtime?.decisionOverlapMints || 0) - Number(a.runtime?.decisionOverlapMints || 0)
    || Number(b.runtime?.uniqueMints || 0) - Number(a.runtime?.uniqueMints || 0)
  ));

  const summary = {
    telemetryPath,
    launchIntelGeneratedAt: launchIndex.generatedAt,
    runtimeUntrackedWallets: runtime.uniqueUntrackedWallets,
    runtimeUntrackedMints: runtime.uniqueUntrackedMints,
    launchIntelWalletIndexItems: launchIndex.totalItems,
    knownInLaunchIntel: launchIndex.byWallet.size,
    knownUnpromotedCandidates: candidates.length,
    classificationCounts: countBy(candidates, (row) => row.classification),
    flagCounts: countBy(candidates.flatMap((row) => row.flags || []), (flag) => flag),
    runtimePaperDecisionRows: runtime.paperDecisionRows,
    runtimePaperDecisionMints: runtime.paperDecisionMints,
    recommendation: 'report_only_review_queue_no_runtime_trust_change'
  };

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_launch_intel_wallet_bridge',
    sources: {
      telemetryPath,
      launchIntelWalletIndexPath: launchIntelPath,
      manualKolWalletPath: MANUAL_KOL_WALLET_PATH,
      walletPromotionReviewPath: PROMOTION_PATH,
      walletPnlEvidencePath: WALLET_PNL_EVIDENCE_PATH
    },
    note: 'Report-only bridge from runtime untracked wallets to launch-intel history. These rows are not trusted wallet proof and do not alter runtime gates, trust tiers, or live behavior.',
    summary,
    manualReviewCandidates: candidates.filter((row) => row.classification === 'MANUAL_REVIEW_CANDIDATE').slice(0, 50),
    observeNextRun: candidates.filter((row) => row.classification === 'OBSERVE_NEXT_RUN').slice(0, 50),
    busyFlowRisk: candidates.filter((row) => row.classification === 'BUSY_FLOW_RISK').slice(0, 50),
    backgroundWatch: candidates.filter((row) => row.classification === 'BACKGROUND_WATCH').slice(0, 50),
    lowPriority: candidates.filter((row) => row.classification === 'LOW_PRIORITY').slice(0, 50),
    topCandidates: candidates.slice(0, 100)
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = resolveRepoPath(args.telemetry, telemetryFromBattlefield() || latestTelemetryFile());
  const launchIntelPath = resolveRepoPath(args.launchIntel, LAUNCH_INTEL_WALLET_INDEX_PATH);
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error(`Telemetry file not found: ${telemetryPath || '(none)'}`);
  if (!launchIntelPath || !fs.existsSync(launchIntelPath)) throw new Error(`Launch-intel wallet index not found: ${launchIntelPath || '(none)'}`);

  const report = buildReport({ telemetryPath, launchIntelPath });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `wallet-launch-intel-bridge-${stamp}.json`);
  writeJson(reportPath, report);
  writeJson(LATEST_PATH, report);
  console.log(`Wrote launch-intel wallet bridge report: ${reportPath}`);
  console.log(`Wrote latest launch-intel wallet bridge report: ${LATEST_PATH}`);
  console.log(`known=${report.summary.knownInLaunchIntel} candidates=${report.summary.knownUnpromotedCandidates} classifications=${JSON.stringify(report.summary.classificationCounts)}`);
}

main();
